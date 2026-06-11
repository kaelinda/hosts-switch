use crate::hosts::{
    extract_managed_block, hosts_path, merge_hosts_file, parse_managed_block_as_state,
    render_managed_block, validate_state,
};
use crate::models::{AppState, HostsSnapshot, ValidationIssue};
use crate::store;
use crate::tray_switch;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::AppHandle;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CommandError {
    #[error("{0}")]
    Path(String),
    #[error("failed to access {path}: {source}")]
    IoWithPath {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("failed to parse profile store at {path}: {source}")]
    StoreJson {
        path: PathBuf,
        source: serde_json::Error,
    },
    #[error("failed to parse imported profiles JSON: {0}")]
    ImportJson(serde_json::Error),
    #[error("failed to serialize JSON: {0}")]
    Json(serde_json::Error),
    #[error("{0}")]
    Hosts(#[from] crate::hosts::HostsError),
    #[error("{0}")]
    Validation(String),
    #[error("administrator apply command failed: {0}")]
    Apply(String),
}

impl Serialize for CommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type CommandResult<T> = Result<T, CommandError>;

pub fn apply_hosts_state(app: &AppHandle, state: AppState) -> CommandResult<AppState> {
    let normalized = store::normalize_app_state(&state);
    let issues = validate_state(&normalized);
    if let Some(issue) = issues.first() {
        return Err(CommandError::Validation(format!(
            "{} / {} line {}: {}",
            issue.group_name, issue.node_name, issue.line_number, issue.message
        )));
    }

    let current = fs::read_to_string(hosts_path()).map_err(|source| CommandError::IoWithPath {
        path: PathBuf::from(hosts_path()),
        source,
    })?;
    let next_hosts = merge_hosts_file(&current, &render_managed_block(&normalized))?;
    store::save_hosts_backup(app, &current)?;
    let temp_path = std::env::temp_dir().join(format!("hosts-switch-{}-hosts", std::process::id()));
    fs::write(&temp_path, next_hosts).map_err(|source| CommandError::IoWithPath {
        path: temp_path.clone(),
        source,
    })?;

    apply_with_admin_privileges(&temp_path)?;
    let _ = fs::remove_file(&temp_path);
    let saved = store::save_state(app, &normalized)?;
    Ok(saved)
}

#[tauri::command]
pub fn load_app_state(app: AppHandle) -> CommandResult<AppState> {
    store::load_state(&app)
}

#[tauri::command]
pub fn save_app_state(app: AppHandle, state: AppState) -> CommandResult<AppState> {
    let saved = store::save_state(&app, &state)?;
    tray_switch::refresh_main_tray_menu(&app);
    Ok(saved)
}

#[tauri::command]
pub fn export_profiles(state: AppState) -> CommandResult<String> {
    let normalized = store::normalize_app_state(&state);
    serde_json::to_string_pretty(&normalized).map_err(CommandError::Json)
}

#[tauri::command]
pub fn import_profiles(app: AppHandle, raw: String) -> CommandResult<AppState> {
    let imported: AppState = serde_json::from_str(&raw).map_err(CommandError::ImportJson)?;
    let saved = store::save_state(&app, &imported)?;
    tray_switch::refresh_main_tray_menu(&app);
    Ok(saved)
}

#[tauri::command]
pub fn read_hosts_snapshot(state: AppState) -> CommandResult<HostsSnapshot> {
    let current = fs::read_to_string(hosts_path()).map_err(|source| CommandError::IoWithPath {
        path: PathBuf::from(hosts_path()),
        source,
    })?;
    let managed = extract_managed_block(&current)?.unwrap_or_default();
    let preview = merge_hosts_file(&current, &render_managed_block(&state))?;

    Ok(HostsSnapshot {
        current,
        managed,
        preview,
    })
}

#[tauri::command]
pub fn preview_hosts(state: AppState) -> CommandResult<String> {
    let current = fs::read_to_string(hosts_path()).unwrap_or_default();
    merge_hosts_file(&current, &render_managed_block(&state)).map_err(CommandError::from)
}

#[tauri::command]
pub fn validate_hosts_state(state: AppState) -> Vec<ValidationIssue> {
    validate_state(&store::normalize_app_state(&state))
}

#[tauri::command]
pub fn apply_hosts(app: AppHandle, state: AppState) -> CommandResult<AppState> {
    let saved = apply_hosts_state(&app, state)?;
    tray_switch::refresh_main_tray_menu(&app);
    Ok(saved)
}

#[tauri::command]
pub fn restore_managed_block() -> CommandResult<String> {
    let current = fs::read_to_string(hosts_path()).map_err(|source| CommandError::IoWithPath {
        path: PathBuf::from(hosts_path()),
        source,
    })?;
    Ok(extract_managed_block(&current)?.unwrap_or_default())
}

#[tauri::command]
pub fn restore_profiles_from_hosts(app: AppHandle) -> CommandResult<AppState> {
    let current = fs::read_to_string(hosts_path()).map_err(|source| CommandError::IoWithPath {
        path: PathBuf::from(hosts_path()),
        source,
    })?;
    let managed = extract_managed_block(&current)?.unwrap_or_default();
    let restored = parse_managed_block_as_state(&managed);
    let saved = store::save_state(&app, &restored)?;
    tray_switch::refresh_main_tray_menu(&app);
    Ok(saved)
}

#[tauri::command]
pub fn restore_last_hosts_backup(app: AppHandle) -> CommandResult<String> {
    let backup = store::load_hosts_backup(&app)?;
    let temp_path = std::env::temp_dir().join(format!(
        "hosts-switch-{}-restore-backup",
        std::process::id()
    ));
    fs::write(&temp_path, backup).map_err(|source| CommandError::IoWithPath {
        path: temp_path.clone(),
        source,
    })?;

    apply_with_admin_privileges(&temp_path)?;
    let _ = fs::remove_file(&temp_path);
    tray_switch::refresh_main_tray_menu(&app);
    Ok("Last hosts backup restored".to_string())
}

fn apply_with_admin_privileges(temp_path: &PathBuf) -> CommandResult<()> {
    let script = format!(
        "do shell script \"cp {} /etc/hosts && chmod 644 /etc/hosts && dscacheutil -flushcache && killall -HUP mDNSResponder\" with administrator privileges",
        shell_quote(&temp_path.to_string_lossy())
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|source| CommandError::IoWithPath {
            path: PathBuf::from("osascript"),
            source,
        })?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let message = if stderr.is_empty() { stdout } else { stderr };
        Err(CommandError::Apply(message))
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
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
                        enabled: true,
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
    fn exports_profiles_as_normalized_pretty_json() {
        let exported = export_profiles(state()).unwrap();

        assert!(exported.contains("\"version\": 1"));
        assert!(exported.contains("\"groups\""));
        assert!(exported.contains("\"Local\""));
        assert!(exported.contains('\n'));
        let parsed: AppState = serde_json::from_str(&exported).unwrap();
        assert!(parsed.groups[0].nodes[0].enabled);
        assert!(!parsed.groups[0].nodes[1].enabled);
    }

    #[test]
    fn rejects_invalid_import_json() {
        let error = serde_json::from_str::<AppState>("{not json").map_err(CommandError::ImportJson);

        assert!(matches!(error, Err(CommandError::ImportJson(_))));
    }
}
