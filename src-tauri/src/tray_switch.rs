use crate::commands;
use crate::models::AppState;
use crate::store;
use serde::Serialize;
use tauri::menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::TrayIcon;
use tauri::{AppHandle, Emitter, Manager, Wry};

const SWITCH_PREFIX: &str = "switch-node:";
const DISABLE_GROUP_PREFIX: &str = "disable-group:";
const SHOW_ID: &str = "show";
const REFRESH_ID: &str = "refresh-menu";
const QUIT_ID: &str = "quit";
const STALE_MENU_GROUP_MESSAGE: &str =
    "Status menu group is stale. Refresh the menu and try again.";
const STALE_MENU_NODE_MESSAGE: &str = "Status menu node is stale. Refresh the menu and try again.";

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

                let no_active_item = CheckMenuItemBuilder::with_id(
                    disable_group_item_id(&group.id),
                    "No Active Node",
                )
                .checked(group.nodes.iter().all(|node| !node.enabled))
                .build(app)?;
                group_builder = group_builder.separator().item(&no_active_item);
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
        _ if id.starts_with(DISABLE_GROUP_PREFIX) => disable_group_from_menu(app, tray, id),
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

pub fn disable_group(state: &mut AppState, group_id: &str) -> bool {
    let Some(group) = state.groups.iter_mut().find(|group| group.id == group_id) else {
        return false;
    };

    let mut changed = false;
    for node in &mut group.nodes {
        if node.enabled {
            node.enabled = false;
            changed = true;
        }
    }
    changed
}

fn switch_node_from_menu(app: &AppHandle, tray: &TrayIcon<Wry>, id: &str) {
    let Some((group_id, node_id)) = parse_switch_item_id(id) else {
        return;
    };

    match switch_and_apply(app, &group_id, &node_id) {
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

fn disable_group_from_menu(app: &AppHandle, tray: &TrayIcon<Wry>, id: &str) {
    let Some(group_id) = parse_disable_group_item_id(id) else {
        return;
    };

    match disable_group_and_apply(app, &group_id) {
        Ok(state) => {
            refresh_menu(app, tray);
            emit_status(
                app,
                Some(state),
                "Hosts group disabled from status menu",
                None,
            );
        }
        Err(error) => {
            refresh_menu(app, tray);
            let current_state = store::load_state(app).ok();
            emit_status(
                app,
                current_state,
                "Failed to disable hosts group from status menu",
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
    let state = store::load_state(app)?;
    switch_and_apply_loaded(state, group_id, node_id, |state| {
        commands::apply_hosts_state(app, state)
    })
}

fn disable_group_and_apply(app: &AppHandle, group_id: &str) -> commands::CommandResult<AppState> {
    let state = store::load_state(app)?;
    disable_group_and_apply_loaded(state, group_id, |state| {
        commands::apply_hosts_state(app, state)
    })
}

fn switch_and_apply_loaded<F>(
    mut state: AppState,
    group_id: &str,
    node_id: &str,
    apply: F,
) -> commands::CommandResult<AppState>
where
    F: FnOnce(AppState) -> commands::CommandResult<AppState>,
{
    ensure_node_exists(&state, group_id, node_id)?;
    if !switch_node(&mut state, group_id, node_id) {
        return Ok(state);
    }
    apply(state)
}

fn disable_group_and_apply_loaded<F>(
    mut state: AppState,
    group_id: &str,
    apply: F,
) -> commands::CommandResult<AppState>
where
    F: FnOnce(AppState) -> commands::CommandResult<AppState>,
{
    ensure_group_exists(&state, group_id)?;
    if !disable_group(&mut state, group_id) {
        return Ok(state);
    }
    apply(state)
}

fn ensure_node_exists(
    state: &AppState,
    group_id: &str,
    node_id: &str,
) -> commands::CommandResult<()> {
    let Some(group) = state.groups.iter().find(|group| group.id == group_id) else {
        return Err(commands::CommandError::Validation(
            STALE_MENU_GROUP_MESSAGE.to_string(),
        ));
    };

    if group.nodes.iter().any(|node| node.id == node_id) {
        return Ok(());
    }

    Err(commands::CommandError::Validation(
        STALE_MENU_NODE_MESSAGE.to_string(),
    ))
}

fn ensure_group_exists(state: &AppState, group_id: &str) -> commands::CommandResult<()> {
    if state.groups.iter().any(|group| group.id == group_id) {
        return Ok(());
    }

    Err(commands::CommandError::Validation(
        STALE_MENU_GROUP_MESSAGE.to_string(),
    ))
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
    format!("{SWITCH_PREFIX}{}:{group_id}:{node_id}", group_id.len())
}

fn disable_group_item_id(group_id: &str) -> String {
    format!("{DISABLE_GROUP_PREFIX}{group_id}")
}

fn parse_switch_item_id(id: &str) -> Option<(String, String)> {
    let rest = id.strip_prefix(SWITCH_PREFIX)?;
    let (group_len_raw, payload) = rest.split_once(':')?;
    let group_len = group_len_raw.parse::<usize>().ok()?;
    if !payload.is_char_boundary(group_len) {
        return None;
    }
    let group_id = payload.get(..group_len)?.to_string();
    let node_id = payload.get(group_len..)?.strip_prefix(':')?.to_string();
    if node_id.is_empty() {
        return None;
    }
    Some((group_id, node_id))
}

fn parse_disable_group_item_id(id: &str) -> Option<String> {
    let group_id = id.strip_prefix(DISABLE_GROUP_PREFIX)?;
    if group_id.is_empty() {
        return None;
    }
    Some(group_id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::CommandError;
    use crate::models::{HostGroup, HostNode, Preferences};
    use std::cell::RefCell;
    use std::rc::Rc;

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
    fn disables_all_nodes_in_group() {
        let mut state = state();

        assert!(disable_group(&mut state, "g1"));

        assert!(!state.groups[0].nodes[0].enabled);
        assert!(!state.groups[0].nodes[1].enabled);
    }

    #[test]
    fn returns_false_when_group_is_already_disabled() {
        let mut state = state();
        state.groups[0].nodes[1].enabled = false;

        assert!(!disable_group(&mut state, "g1"));
    }

    #[test]
    fn returns_false_for_unknown_node() {
        let mut state = state();

        assert!(!switch_node(&mut state, "g1", "missing"));
    }

    #[test]
    fn returns_false_for_unknown_group_disable() {
        let mut state = state();

        assert!(!disable_group(&mut state, "missing"));
    }

    #[test]
    fn applies_switched_state_after_status_menu_selection() {
        let observed = Rc::new(RefCell::new(None::<AppState>));
        let observed_apply = Rc::clone(&observed);

        let result = switch_and_apply_loaded(state(), "g1", "n1", move |next| {
            *observed_apply.borrow_mut() = Some(next.clone());
            Ok(next)
        })
        .unwrap();

        assert!(result.groups[0].nodes[0].enabled);
        assert!(!result.groups[0].nodes[1].enabled);
        assert_eq!(observed.borrow().clone().unwrap(), result);
    }

    #[test]
    fn applies_disabled_group_after_status_menu_selection() {
        let observed = Rc::new(RefCell::new(None::<AppState>));
        let observed_apply = Rc::clone(&observed);

        let result = disable_group_and_apply_loaded(state(), "g1", move |next| {
            *observed_apply.borrow_mut() = Some(next.clone());
            Ok(next)
        })
        .unwrap();

        assert!(!result.groups[0].nodes[0].enabled);
        assert!(!result.groups[0].nodes[1].enabled);
        assert_eq!(observed.borrow().clone().unwrap(), result);
    }

    #[test]
    fn propagates_apply_failure_without_returning_switched_state() {
        let error = switch_and_apply_loaded(state(), "g1", "n1", |_| {
            Err(CommandError::Apply("cancelled".to_string()))
        })
        .unwrap_err();

        assert!(matches!(error, CommandError::Apply(message) if message == "cancelled"));
    }

    #[test]
    fn propagates_disable_group_apply_failure() {
        let error = disable_group_and_apply_loaded(state(), "g1", |_| {
            Err(CommandError::Apply("cancelled".to_string()))
        })
        .unwrap_err();

        assert!(matches!(error, CommandError::Apply(message) if message == "cancelled"));
    }

    #[test]
    fn rejects_unknown_status_menu_node_selection() {
        let called = Rc::new(RefCell::new(false));
        let called_apply = Rc::clone(&called);

        let error = switch_and_apply_loaded(state(), "g1", "missing", move |next| {
            *called_apply.borrow_mut() = true;
            Ok(next)
        })
        .unwrap_err();

        assert!(!*called.borrow());
        assert!(
            matches!(error, CommandError::Validation(message) if message == STALE_MENU_NODE_MESSAGE)
        );
    }

    #[test]
    fn rejects_unknown_status_menu_group_selection() {
        let called = Rc::new(RefCell::new(false));
        let called_apply = Rc::clone(&called);

        let error = switch_and_apply_loaded(state(), "missing", "n1", move |next| {
            *called_apply.borrow_mut() = true;
            Ok(next)
        })
        .unwrap_err();

        assert!(!*called.borrow());
        assert!(
            matches!(error, CommandError::Validation(message) if message == STALE_MENU_GROUP_MESSAGE)
        );
    }

    #[test]
    fn rejects_unknown_status_menu_group_disable_selection() {
        let called = Rc::new(RefCell::new(false));
        let called_apply = Rc::clone(&called);

        let error = disable_group_and_apply_loaded(state(), "missing", move |next| {
            *called_apply.borrow_mut() = true;
            Ok(next)
        })
        .unwrap_err();

        assert!(!*called.borrow());
        assert!(
            matches!(error, CommandError::Validation(message) if message == STALE_MENU_GROUP_MESSAGE)
        );
    }

    #[test]
    fn does_not_apply_already_disabled_group_selection() {
        let mut disabled = state();
        disabled.groups[0].nodes[1].enabled = false;
        let called = Rc::new(RefCell::new(false));
        let called_apply = Rc::clone(&called);

        let result = disable_group_and_apply_loaded(disabled, "g1", move |next| {
            *called_apply.borrow_mut() = true;
            Ok(next)
        })
        .unwrap();

        assert!(!*called.borrow());
        assert!(!result.groups[0].nodes[0].enabled);
        assert!(!result.groups[0].nodes[1].enabled);
    }

    #[test]
    fn parses_switch_item_ids() {
        let id = switch_item_id("group-a", "node-b");
        assert_eq!(
            parse_switch_item_id(&id),
            Some(("group-a".to_string(), "node-b".to_string()))
        );
        let id_with_separator = switch_item_id("group:a", "node:b");
        assert_eq!(
            parse_switch_item_id(&id_with_separator),
            Some(("group:a".to_string(), "node:b".to_string()))
        );
        let id_with_unicode = switch_item_id("研发:一组", "节点:本地");
        assert_eq!(
            parse_switch_item_id(&id_with_unicode),
            Some(("研发:一组".to_string(), "节点:本地".to_string()))
        );
        assert_eq!(parse_switch_item_id("show"), None);
        assert_eq!(parse_switch_item_id("switch-node:9:short"), None);
        assert_eq!(parse_switch_item_id("switch-node:1:研发:一组:节点"), None);
        assert_eq!(parse_switch_item_id("switch-node:7:group-a"), None);
    }

    #[test]
    fn parses_disable_group_item_ids() {
        let id = disable_group_item_id("group:a");

        assert_eq!(
            parse_disable_group_item_id(&id),
            Some("group:a".to_string())
        );
        assert_eq!(parse_disable_group_item_id("disable-group:"), None);
        assert_eq!(parse_disable_group_item_id("show"), None);
    }
}
