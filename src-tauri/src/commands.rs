use crate::hosts::{
    extract_managed_block, hosts_path, merge_hosts_file, parse_managed_block_as_state,
    render_managed_block, validate_state,
};
use crate::models::{AppState, HostsSnapshot, ValidationIssue};
use crate::store;
use crate::tray_switch;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};
use thiserror::Error;
use uuid::Uuid;

const MAX_PROFILE_IMPORT_BYTES: u64 = 1024 * 1024;
const EMPTY_HOSTS_APPLY_MESSAGE: &str = "Current /etc/hosts is empty. Restore or confirm the system hosts file before applying changes.";

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
    let current = fs::read_to_string(hosts_path()).map_err(|source| CommandError::IoWithPath {
        path: PathBuf::from(hosts_path()),
        source,
    })?;
    apply_hosts_state_with_io(
        state,
        current,
        |current| store::save_hosts_backup(app, current).map(|_| ()),
        apply_with_admin_privileges,
        |normalized| store::save_state(app, normalized),
    )
}

#[tauri::command]
pub fn load_app_state(app: AppHandle) -> CommandResult<AppState> {
    store::load_state(&app)
}

#[tauri::command]
pub fn save_app_state(app: AppHandle, state: AppState) -> CommandResult<AppState> {
    backup_current_profiles_if_available(&app)?;
    let saved = store::save_state(&app, &state)?;
    tray_switch::refresh_main_tray_menu(&app);
    Ok(saved)
}

#[tauri::command]
pub fn export_profiles(state: AppState) -> CommandResult<String> {
    export_profiles_json(&state)
}

#[tauri::command]
pub async fn export_profiles_to_file(app: AppHandle, state: AppState) -> CommandResult<bool> {
    let Some(path) = pick_profile_export_path(&app)? else {
        return Ok(false);
    };

    export_profiles_to_path(&state, path)?;
    Ok(true)
}

#[tauri::command]
pub fn import_profiles(app: AppHandle, raw: String) -> CommandResult<AppState> {
    import_profiles_raw(&app, &raw)
}

#[tauri::command]
pub async fn import_profiles_from_file(app: AppHandle) -> CommandResult<Option<AppState>> {
    let Some(path) = pick_profile_import_path(&app)? else {
        return Ok(None);
    };

    import_profiles_from_path(&app, path).map(Some)
}

fn export_profiles_to_path(state: &AppState, path: PathBuf) -> CommandResult<()> {
    ensure_profile_json_path(&path)?;
    let exported = export_profiles_json(state)?;
    fs::write(&path, exported).map_err(|source| CommandError::IoWithPath { path, source })
}

fn import_profiles_from_path(app: &AppHandle, path: PathBuf) -> CommandResult<AppState> {
    ensure_profile_json_path(&path)?;
    ensure_profile_import_size(&path)?;
    let raw = fs::read_to_string(&path).map_err(|source| CommandError::IoWithPath {
        path: path.clone(),
        source,
    })?;
    import_profiles_raw(app, &raw)
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
    backup_current_profiles_if_available(&app)?;
    let saved = store::save_state(&app, &restored)?;
    tray_switch::refresh_main_tray_menu(&app);
    Ok(saved)
}

#[tauri::command]
pub fn restore_last_profiles_backup(app: AppHandle) -> CommandResult<AppState> {
    let backup = store::load_profiles_backup(&app)?;
    backup_current_profiles_if_available(&app)?;
    let saved = store::save_state(&app, &backup)?;
    tray_switch::refresh_main_tray_menu(&app);
    Ok(saved)
}

#[tauri::command]
pub fn restore_last_hosts_backup(app: AppHandle) -> CommandResult<String> {
    let backup = store::load_hosts_backup(&app)?;
    let message = restore_hosts_backup_with_io(&backup, apply_with_admin_privileges)?;
    tray_switch::refresh_main_tray_menu(&app);
    Ok(message)
}

fn write_temp_and_apply<F>(label: &str, content: &str, apply: F) -> CommandResult<()>
where
    F: FnOnce(&PathBuf) -> CommandResult<()>,
{
    let temp_path = std::env::temp_dir().join(format!(
        "hosts-switch-{}-{label}-{}",
        std::process::id(),
        Uuid::new_v4()
    ));
    fs::write(&temp_path, content).map_err(|source| CommandError::IoWithPath {
        path: temp_path.clone(),
        source,
    })?;

    let result = apply(&temp_path);
    let _ = fs::remove_file(&temp_path);
    result
}

fn ensure_non_empty_hosts_content(content: &str) -> CommandResult<()> {
    if content.trim().is_empty() {
        return Err(CommandError::Validation(
            EMPTY_HOSTS_APPLY_MESSAGE.to_string(),
        ));
    }

    Ok(())
}

fn restore_hosts_backup_with_io<F>(backup: &str, apply: F) -> CommandResult<String>
where
    F: FnOnce(&PathBuf) -> CommandResult<()>,
{
    ensure_non_empty_hosts_content(backup)?;
    write_temp_and_apply("restore-backup", backup, apply)?;
    Ok("Last hosts backup restored".to_string())
}

fn apply_hosts_state_with_io<B, A, S>(
    state: AppState,
    current: String,
    save_backup: B,
    apply: A,
    save_state: S,
) -> CommandResult<AppState>
where
    B: FnOnce(&str) -> CommandResult<()>,
    A: FnOnce(&PathBuf) -> CommandResult<()>,
    S: FnOnce(&AppState) -> CommandResult<AppState>,
{
    let normalized = store::normalize_app_state(&state);
    let issues = validate_state(&normalized);
    if let Some(issue) = issues.first() {
        return Err(CommandError::Validation(format!(
            "{} / {} line {}: {}",
            issue.group_name, issue.node_name, issue.line_number, issue.message
        )));
    }
    ensure_non_empty_hosts_content(&current)?;

    let next_hosts = merge_hosts_file(&current, &render_managed_block(&normalized))?;
    save_backup(&current)?;
    write_temp_and_apply("hosts", &next_hosts, apply)?;
    let saved = save_state(&normalized)?;
    Ok(saved)
}

fn export_profiles_json(state: &AppState) -> CommandResult<String> {
    let normalized = store::normalize_app_state(state);
    serde_json::to_string_pretty(&normalized).map_err(CommandError::Json)
}

fn import_profiles_raw(app: &AppHandle, raw: &str) -> CommandResult<AppState> {
    let imported = parse_imported_profiles(raw)?;
    backup_current_profiles_if_available(app)?;
    let saved = store::save_state(app, &imported)?;
    tray_switch::refresh_main_tray_menu(app);
    Ok(saved)
}

fn backup_current_profiles_if_available(app: &AppHandle) -> CommandResult<()> {
    match store::load_state(app) {
        Ok(current) => store::save_profiles_backup(app, &current).map(|_| ()),
        Err(CommandError::IoWithPath { source, .. })
            if source.kind() == std::io::ErrorKind::NotFound =>
        {
            Ok(())
        }
        Err(error) => Err(error),
    }
}

fn parse_imported_profiles(raw: &str) -> CommandResult<AppState> {
    let imported: AppState = serde_json::from_str(raw).map_err(CommandError::ImportJson)?;
    Ok(store::normalize_app_state(&imported))
}

fn pick_profile_export_path(app: &AppHandle) -> CommandResult<Option<PathBuf>> {
    app.dialog()
        .file()
        .set_title("Export Hosts Switch Profiles")
        .set_file_name("hosts-switch-profiles.json")
        .add_filter("Hosts Switch Profiles", &["json"])
        .blocking_save_file()
        .map(file_path_to_path)
        .transpose()
}

fn pick_profile_import_path(app: &AppHandle) -> CommandResult<Option<PathBuf>> {
    app.dialog()
        .file()
        .set_title("Import Hosts Switch Profiles")
        .add_filter("Hosts Switch Profiles", &["json"])
        .blocking_pick_file()
        .map(file_path_to_path)
        .transpose()
}

fn file_path_to_path(file_path: FilePath) -> CommandResult<PathBuf> {
    file_path.into_path().map_err(|error| {
        CommandError::Path(format!("failed to resolve selected file path: {error}"))
    })
}

fn ensure_profile_json_path(path: &Path) -> CommandResult<()> {
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
    {
        return Ok(());
    }

    Err(CommandError::Validation(
        "Profile files must use the .json extension.".to_string(),
    ))
}

fn ensure_profile_import_size(path: &Path) -> CommandResult<()> {
    let metadata = fs::metadata(path).map_err(|source| CommandError::IoWithPath {
        path: path.to_path_buf(),
        source,
    })?;

    if metadata.len() > MAX_PROFILE_IMPORT_BYTES {
        return Err(CommandError::Validation(format!(
            "Profile JSON must be smaller than {} bytes.",
            MAX_PROFILE_IMPORT_BYTES
        )));
    }

    Ok(())
}

fn apply_with_admin_privileges(temp_path: &PathBuf) -> CommandResult<()> {
    let script = build_admin_apply_script(temp_path);

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

fn build_admin_apply_script(temp_path: &PathBuf) -> String {
    let shell_command = format!(
        "cp {} /etc/hosts && chmod 644 /etc/hosts && dscacheutil -flushcache && killall -HUP mDNSResponder",
        shell_quote(&temp_path.to_string_lossy())
    );

    format!(
        "do shell script {} with administrator privileges",
        applescript_string_literal(&shell_command)
    )
}

fn applescript_string_literal(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;
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
    fn writes_exported_profiles_to_selected_path() {
        let path =
            std::env::temp_dir().join(format!("hosts-switch-export-test-{}.json", Uuid::new_v4()));

        export_profiles_to_path(&state(), path.clone()).unwrap();

        let exported = fs::read_to_string(&path).unwrap();
        let _ = fs::remove_file(&path);
        let parsed: AppState = serde_json::from_str(&exported).unwrap();
        assert_eq!(parsed.groups[0].nodes[0].name, "Local");
        assert!(!parsed.groups[0].nodes[1].enabled);
    }

    #[test]
    fn rejects_profile_file_paths_without_json_extension() {
        let path =
            std::env::temp_dir().join(format!("hosts-switch-export-test-{}.txt", Uuid::new_v4()));

        let error = export_profiles_to_path(&state(), path.clone()).unwrap_err();

        assert!(
            matches!(error, CommandError::Validation(message) if message == "Profile files must use the .json extension.")
        );
        assert!(!path.exists());
    }

    #[test]
    fn accepts_uppercase_json_profile_extension() {
        let path = PathBuf::from("/tmp/HOSTS-SWITCH-PROFILES.JSON");

        assert!(ensure_profile_json_path(&path).is_ok());
    }

    #[test]
    fn rejects_profile_import_files_over_size_limit() {
        let path =
            std::env::temp_dir().join(format!("hosts-switch-import-test-{}.json", Uuid::new_v4()));
        fs::write(&path, vec![b'a'; MAX_PROFILE_IMPORT_BYTES as usize + 1]).unwrap();

        let error = ensure_profile_import_size(&path).unwrap_err();

        let _ = fs::remove_file(&path);
        assert!(
            matches!(error, CommandError::Validation(message) if message == "Profile JSON must be smaller than 1048576 bytes.")
        );
    }

    #[test]
    fn rejects_invalid_import_json() {
        let error = serde_json::from_str::<AppState>("{not json").map_err(CommandError::ImportJson);

        assert!(matches!(error, Err(CommandError::ImportJson(_))));
    }

    #[test]
    fn imported_profiles_are_normalized_before_returning() {
        let raw = serde_json::to_string(&state()).unwrap();
        let imported = parse_imported_profiles(&raw).unwrap();

        assert!(imported.groups[0].nodes[0].enabled);
        assert!(!imported.groups[0].nodes[1].enabled);
    }

    #[test]
    fn apply_flow_writes_only_managed_block_and_saves_after_success() {
        let calls = Rc::new(RefCell::new(Vec::<String>::new()));
        let observed_backup = Rc::new(RefCell::new(None::<String>));
        let observed_hosts = Rc::new(RefCell::new(None::<String>));
        let observed_saved = Rc::new(RefCell::new(None::<AppState>));

        let backup_calls = Rc::clone(&calls);
        let backup_content = Rc::clone(&observed_backup);
        let apply_calls = Rc::clone(&calls);
        let applied_hosts = Rc::clone(&observed_hosts);
        let save_calls = Rc::clone(&calls);
        let saved_state = Rc::clone(&observed_saved);

        let current = [
            "127.0.0.1 localhost",
            "",
            "# >>> Hosts Switch managed block",
            "10.0.0.1 old.local.test",
            "# <<< Hosts Switch managed block",
            "",
            "192.0.2.10 unmanaged.local",
            "",
        ]
        .join("\n");

        let saved = apply_hosts_state_with_io(
            state(),
            current.clone(),
            move |content| {
                backup_calls.borrow_mut().push("backup".to_string());
                *backup_content.borrow_mut() = Some(content.to_string());
                Ok(())
            },
            move |path| {
                apply_calls.borrow_mut().push("apply".to_string());
                *applied_hosts.borrow_mut() = Some(fs::read_to_string(path).unwrap());
                Ok(())
            },
            move |state| {
                save_calls.borrow_mut().push("save".to_string());
                *saved_state.borrow_mut() = Some(state.clone());
                Ok(state.clone())
            },
        )
        .unwrap();

        assert_eq!(*calls.borrow(), vec!["backup", "apply", "save"]);
        assert_eq!(observed_backup.borrow().as_deref(), Some(current.as_str()));
        let applied = observed_hosts.borrow().clone().unwrap();
        assert!(applied.contains("127.0.0.1 localhost"));
        assert!(applied.contains("127.0.0.1 local.test"));
        assert!(applied.contains("192.0.2.10 unmanaged.local"));
        assert!(!applied.contains("10.0.0.1 old.local.test"));
        assert_eq!(observed_saved.borrow().as_ref().unwrap(), &saved);
        assert!(saved.groups[0].nodes[0].enabled);
        assert!(!saved.groups[0].nodes[1].enabled);
    }

    #[test]
    fn apply_flow_does_not_save_profile_after_admin_cancel() {
        let calls = Rc::new(RefCell::new(Vec::<String>::new()));
        let backup_calls = Rc::clone(&calls);
        let apply_calls = Rc::clone(&calls);
        let save_calls = Rc::clone(&calls);

        let error = apply_hosts_state_with_io(
            state(),
            "127.0.0.1 localhost\n".to_string(),
            move |_| {
                backup_calls.borrow_mut().push("backup".to_string());
                Ok(())
            },
            move |_| {
                apply_calls.borrow_mut().push("apply".to_string());
                Err(CommandError::Apply("User canceled.".to_string()))
            },
            move |state| {
                save_calls.borrow_mut().push("save".to_string());
                Ok(state.clone())
            },
        )
        .unwrap_err();

        assert!(matches!(error, CommandError::Apply(message) if message == "User canceled."));
        assert_eq!(*calls.borrow(), vec!["backup", "apply"]);
    }

    #[test]
    fn apply_flow_rejects_invalid_enabled_hosts_before_backup_or_write() {
        let mut invalid = state();
        invalid.groups[0].nodes[0].content = "not-an-ip local.test".to_string();
        let calls = Rc::new(RefCell::new(Vec::<String>::new()));
        let backup_calls = Rc::clone(&calls);
        let apply_calls = Rc::clone(&calls);
        let save_calls = Rc::clone(&calls);

        let error = apply_hosts_state_with_io(
            invalid,
            "127.0.0.1 localhost\n".to_string(),
            move |_| {
                backup_calls.borrow_mut().push("backup".to_string());
                Ok(())
            },
            move |_| {
                apply_calls.borrow_mut().push("apply".to_string());
                Ok(())
            },
            move |state| {
                save_calls.borrow_mut().push("save".to_string());
                Ok(state.clone())
            },
        )
        .unwrap_err();

        assert!(
            matches!(error, CommandError::Validation(message) if message.contains("Development / Local line 1"))
        );
        assert!(calls.borrow().is_empty());
    }

    #[test]
    fn apply_flow_rejects_empty_hosts_before_backup_or_write() {
        let calls = Rc::new(RefCell::new(Vec::<String>::new()));
        let backup_calls = Rc::clone(&calls);
        let apply_calls = Rc::clone(&calls);
        let save_calls = Rc::clone(&calls);

        let error = apply_hosts_state_with_io(
            state(),
            String::new(),
            move |_| {
                backup_calls.borrow_mut().push("backup".to_string());
                Ok(())
            },
            move |_| {
                apply_calls.borrow_mut().push("apply".to_string());
                Ok(())
            },
            move |state| {
                save_calls.borrow_mut().push("save".to_string());
                Ok(state.clone())
            },
        )
        .unwrap_err();

        assert!(
            matches!(error, CommandError::Validation(message) if message == "Current /etc/hosts is empty. Restore or confirm the system hosts file before applying changes.")
        );
        assert!(calls.borrow().is_empty());
    }

    #[test]
    fn restore_backup_rejects_empty_hosts_before_write() {
        let called = Rc::new(RefCell::new(false));
        let called_apply = Rc::clone(&called);

        let error = restore_hosts_backup_with_io(" \n\t", move |_| {
            *called_apply.borrow_mut() = true;
            Ok(())
        })
        .unwrap_err();

        assert!(
            matches!(error, CommandError::Validation(message) if message == "Current /etc/hosts is empty. Restore or confirm the system hosts file before applying changes.")
        );
        assert!(!*called.borrow());
    }

    #[test]
    fn restore_backup_writes_non_empty_hosts_content() {
        let observed = Rc::new(RefCell::new(None::<String>));
        let observed_apply = Rc::clone(&observed);

        let message = restore_hosts_backup_with_io("127.0.0.1 localhost\n", move |path| {
            *observed_apply.borrow_mut() = Some(fs::read_to_string(path).unwrap());
            Ok(())
        })
        .unwrap();

        assert_eq!(message, "Last hosts backup restored");
        assert_eq!(observed.borrow().as_deref(), Some("127.0.0.1 localhost\n"));
    }

    #[test]
    fn builds_admin_apply_script_with_expected_commands() {
        let script = build_admin_apply_script(&PathBuf::from("/tmp/hosts-switch-test"));

        assert_eq!(
            script,
            "do shell script \"cp '/tmp/hosts-switch-test' /etc/hosts && chmod 644 /etc/hosts && dscacheutil -flushcache && killall -HUP mDNSResponder\" with administrator privileges"
        );
    }

    #[test]
    fn admin_apply_script_quotes_paths_with_spaces() {
        let script = build_admin_apply_script(&PathBuf::from("/tmp/hosts switch/apply file"));

        assert!(script.contains("cp '/tmp/hosts switch/apply file' /etc/hosts"));
        assert!(script.ends_with(" with administrator privileges"));
    }

    #[test]
    fn admin_apply_script_quotes_paths_with_single_quotes() {
        let script = build_admin_apply_script(&PathBuf::from("/tmp/host's apply"));

        assert!(script.contains("cp '/tmp/host'\\\\''s apply' /etc/hosts"));
        assert!(script.contains("dscacheutil -flushcache"));
        assert!(script.contains("killall -HUP mDNSResponder"));
    }

    #[test]
    fn admin_apply_script_escapes_applescript_string_characters() {
        let script = build_admin_apply_script(&PathBuf::from("/tmp/hosts\"switch\\apply"));

        assert!(script.starts_with("do shell script \""));
        assert!(script.contains("cp '/tmp/hosts\\\"switch\\\\apply' /etc/hosts"));
        assert!(script.ends_with("\" with administrator privileges"));
    }

    #[test]
    fn temp_apply_writes_content_and_cleans_up_after_success() {
        let observed = Rc::new(RefCell::new(None::<(PathBuf, String)>));
        let observed_apply = Rc::clone(&observed);

        write_temp_and_apply("test-success", "127.0.0.1 local.test\n", move |path| {
            let content = fs::read_to_string(path).unwrap();
            *observed_apply.borrow_mut() = Some((path.clone(), content));
            Ok(())
        })
        .unwrap();

        let (path, content) = observed.borrow().clone().unwrap();
        assert_eq!(content, "127.0.0.1 local.test\n");
        assert!(!path.exists());
    }

    #[test]
    fn temp_apply_cleans_up_after_admin_failure() {
        let observed_path = Rc::new(RefCell::new(None::<PathBuf>));
        let observed_apply = Rc::clone(&observed_path);

        let error = write_temp_and_apply("test-failure", "127.0.0.1 local.test\n", move |path| {
            assert!(path.exists());
            *observed_apply.borrow_mut() = Some(path.clone());
            Err(CommandError::Apply("cancelled".to_string()))
        })
        .unwrap_err();

        assert!(matches!(error, CommandError::Apply(message) if message == "cancelled"));
        let path = observed_path.borrow().clone().unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn temp_apply_uses_unique_paths_for_repeated_writes() {
        let observed_paths = Rc::new(RefCell::new(Vec::<PathBuf>::new()));

        for _ in 0..2 {
            let observed_apply = Rc::clone(&observed_paths);
            write_temp_and_apply("test-unique", "127.0.0.1 local.test\n", move |path| {
                observed_apply.borrow_mut().push(path.clone());
                Ok(())
            })
            .unwrap();
        }

        let paths = observed_paths.borrow();
        assert_eq!(paths.len(), 2);
        assert_ne!(paths[0], paths[1]);
        assert!(paths.iter().all(|path| !path.exists()));
    }
}
