use crate::commands;
use crate::models::AppState;
use crate::store;
use serde::Serialize;
use tauri::menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::TrayIcon;
use tauri::{AppHandle, Emitter, Manager, Wry};

const SWITCH_PREFIX: &str = "switch-node:";
const SHOW_ID: &str = "show";
const REFRESH_ID: &str = "refresh-menu";
const QUIT_ID: &str = "quit";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TraySwitchEvent {
    state: Option<AppState>,
    status: String,
    error: Option<String>,
}

pub fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let state = load_state_for_menu(app);
    let mut builder = MenuBuilder::new(app);

    if state.groups.is_empty() {
        let empty = MenuItemBuilder::with_id("empty-profiles", "No profiles")
            .enabled(false)
            .build(app)?;
        builder = builder.item(&empty);
    } else {
        for group in &state.groups {
            let mut group_builder =
                SubmenuBuilder::with_id(app, format!("group:{}", group.id), &group.name);

            if group.nodes.is_empty() {
                let empty =
                    MenuItemBuilder::with_id(format!("empty-group:{}", group.id), "No nodes")
                        .enabled(false)
                        .build(app)?;
                group_builder = group_builder.item(&empty);
            } else {
                for node in &group.nodes {
                    let item = CheckMenuItemBuilder::with_id(
                        switch_item_id(&group.id, &node.id),
                        &node.name,
                    )
                    .checked(node.enabled)
                    .build(app)?;
                    group_builder = group_builder.item(&item);
                }
            }

            let submenu = group_builder.build()?;
            builder = builder.item(&submenu);
        }
    }

    builder = builder
        .separator()
        .text(REFRESH_ID, "Refresh Menu")
        .text(SHOW_ID, "Open Editor")
        .separator()
        .text(QUIT_ID, "Quit");

    builder.build()
}

pub fn handle_menu_event(app: &AppHandle, tray: &TrayIcon<Wry>, id: &str) {
    match id {
        SHOW_ID => show_main_window(app),
        REFRESH_ID => refresh_menu(app, tray),
        QUIT_ID => app.exit(0),
        _ if id.starts_with(SWITCH_PREFIX) => switch_node_from_menu(app, tray, id),
        _ => {}
    }
}

pub fn refresh_menu(app: &AppHandle, tray: &TrayIcon<Wry>) {
    match build_menu(app) {
        Ok(menu) => {
            if let Err(error) = tray.set_menu(Some(menu)) {
                emit_status(
                    app,
                    None,
                    "Failed to refresh status menu",
                    Some(error.to_string()),
                );
            }
        }
        Err(error) => {
            emit_status(
                app,
                None,
                "Failed to build status menu",
                Some(error.to_string()),
            );
        }
    }
}

pub fn refresh_main_tray_menu(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id("main") {
        refresh_menu(app, &tray);
    }
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn switch_node(state: &mut AppState, group_id: &str, node_id: &str) -> bool {
    let Some(group) = state.groups.iter_mut().find(|group| group.id == group_id) else {
        return false;
    };

    let Some(target_index) = group.nodes.iter().position(|node| node.id == node_id) else {
        return false;
    };

    let next_enabled = !group.nodes[target_index].enabled;
    if state.preferences.enforce_one_active_per_group && next_enabled {
        for node in &mut group.nodes {
            node.enabled = false;
        }
    }
    group.nodes[target_index].enabled = next_enabled;
    true
}

fn switch_node_from_menu(app: &AppHandle, tray: &TrayIcon<Wry>, id: &str) {
    let Some((group_id, node_id)) = parse_switch_item_id(id) else {
        return;
    };

    match switch_and_apply(app, group_id, node_id) {
        Ok(state) => {
            refresh_menu(app, tray);
            emit_status(app, Some(state), "Hosts switched from status menu", None);
        }
        Err(error) => {
            refresh_menu(app, tray);
            let current_state = store::load_state(app).ok();
            emit_status(
                app,
                current_state,
                "Failed to switch hosts from status menu",
                Some(error.to_string()),
            );
            show_main_window(app);
        }
    }
}

fn switch_and_apply(
    app: &AppHandle,
    group_id: &str,
    node_id: &str,
) -> commands::CommandResult<AppState> {
    let mut state = store::load_state(app)?;
    if !switch_node(&mut state, group_id, node_id) {
        return Ok(state);
    }
    commands::apply_hosts_state(app, state)
}

fn load_state_for_menu(app: &AppHandle) -> AppState {
    match store::load_state(app) {
        Ok(state) => state,
        Err(_) => AppState::default(),
    }
}

fn emit_status(app: &AppHandle, state: Option<AppState>, status: &str, error: Option<String>) {
    let _ = app.emit(
        "hosts-switch://tray-status",
        TraySwitchEvent {
            state,
            status: status.to_string(),
            error,
        },
    );
}

fn switch_item_id(group_id: &str, node_id: &str) -> String {
    format!("{SWITCH_PREFIX}{group_id}:{node_id}")
}

fn parse_switch_item_id(id: &str) -> Option<(&str, &str)> {
    let rest = id.strip_prefix(SWITCH_PREFIX)?;
    rest.split_once(':')
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{HostGroup, HostNode, Preferences};

    fn state() -> AppState {
        AppState {
            version: 1,
            preferences: Preferences {
                enforce_one_active_per_group: true,
                preview_on_hover: true,
                launch_at_login: false,
                enable_global_shortcut: true,
            },
            groups: vec![HostGroup {
                id: "g1".to_string(),
                name: "Development".to_string(),
                nodes: vec![
                    HostNode {
                        id: "n1".to_string(),
                        name: "Local".to_string(),
                        enabled: false,
                        content: "127.0.0.1 local.test".to_string(),
                    },
                    HostNode {
                        id: "n2".to_string(),
                        name: "Staging".to_string(),
                        enabled: true,
                        content: "10.0.0.1 local.test".to_string(),
                    },
                ],
            }],
        }
    }

    #[test]
    fn switches_node_and_deactivates_peer_in_same_group() {
        let mut state = state();

        assert!(switch_node(&mut state, "g1", "n1"));

        assert!(state.groups[0].nodes[0].enabled);
        assert!(!state.groups[0].nodes[1].enabled);
    }

    #[test]
    fn toggles_active_node_off() {
        let mut state = state();

        assert!(switch_node(&mut state, "g1", "n2"));

        assert!(!state.groups[0].nodes[0].enabled);
        assert!(!state.groups[0].nodes[1].enabled);
    }

    #[test]
    fn returns_false_for_unknown_node() {
        let mut state = state();

        assert!(!switch_node(&mut state, "g1", "missing"));
    }

    #[test]
    fn parses_switch_item_ids() {
        assert_eq!(
            parse_switch_item_id("switch-node:group-a:node-b"),
            Some(("group-a", "node-b"))
        );
        assert_eq!(parse_switch_item_id("show"), None);
    }
}
