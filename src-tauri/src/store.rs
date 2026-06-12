use crate::commands::CommandError;
use crate::hosts::normalize_state;
use crate::models::AppState;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const STORE_FILE: &str = "profiles.json";
const BACKUP_DIR: &str = "backups";
const LAST_HOSTS_BACKUP_FILE: &str = "hosts-last-backup";
const LAST_PROFILES_BACKUP_FILE: &str = "profiles-last-backup.json";

pub fn load_state(app: &AppHandle) -> Result<AppState, CommandError> {
    let path = state_path(app)?;
    let backup_path = profiles_backup_path(app)?;
    load_state_from_paths(&path, &backup_path)
}

pub fn save_state(app: &AppHandle, state: &AppState) -> Result<AppState, CommandError> {
    let path = state_path(app)?;
    write_state_to_path(&path, state)
}

pub fn save_profiles_backup(app: &AppHandle, state: &AppState) -> Result<PathBuf, CommandError> {
    let path = profiles_backup_path(app)?;
    write_state_to_path(&path, state)?;
    Ok(path)
}

pub fn load_profiles_backup(app: &AppHandle) -> Result<AppState, CommandError> {
    let path = profiles_backup_path(app)?;
    read_state_from_path(&path)
}

fn read_state_from_path(path: &Path) -> Result<AppState, CommandError> {
    let raw = fs::read_to_string(&path).map_err(|source| CommandError::IoWithPath {
        path: path.to_path_buf(),
        source,
    })?;
    let state: AppState = serde_json::from_str(&raw).map_err(|source| CommandError::StoreJson {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(normalize_state(state))
}

fn load_state_from_paths(path: &Path, backup_path: &Path) -> Result<AppState, CommandError> {
    match read_state_from_path(path) {
        Ok(state) => Ok(state),
        Err(error) if is_missing_file_error(&error) => recreate_default_state(path),
        Err(error) if is_recoverable_state_file_error(&error) => {
            recover_state_from_backup_or_default(path, backup_path)
        }
        Err(error) => Err(error),
    }
}

fn recover_state_from_backup_or_default(
    path: &Path,
    backup_path: &Path,
) -> Result<AppState, CommandError> {
    if let Ok(backup) = read_state_from_path(backup_path) {
        return write_state_to_path(path, &backup);
    }

    preserve_corrupted_state_file(path)?;
    recreate_default_state(path)
}

fn recreate_default_state(path: &Path) -> Result<AppState, CommandError> {
    write_state_to_path(path, &AppState::default())
}

fn preserve_corrupted_state_file(path: &Path) -> Result<PathBuf, CommandError> {
    let parent = path.parent().ok_or_else(|| {
        CommandError::Path(format!(
            "failed to resolve parent directory for {}",
            path.display()
        ))
    })?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| CommandError::Path(format!("invalid file name {}", path.display())))?;
    let corrupt_path = parent.join(format!("{file_name}.corrupt-{}", Uuid::new_v4()));

    fs::copy(path, &corrupt_path).map_err(|source| CommandError::IoWithPath {
        path: corrupt_path.clone(),
        source,
    })?;
    Ok(corrupt_path)
}

fn is_missing_file_error(error: &CommandError) -> bool {
    matches!(
        error,
        CommandError::IoWithPath { source, .. } if source.kind() == std::io::ErrorKind::NotFound
    )
}

fn is_recoverable_state_file_error(error: &CommandError) -> bool {
    match error {
        CommandError::StoreJson { .. } => true,
        CommandError::IoWithPath { source, .. } => source.kind() == std::io::ErrorKind::InvalidData,
        _ => false,
    }
}

fn write_state_to_path(path: &Path, state: &AppState) -> Result<AppState, CommandError> {
    let normalized = normalize_app_state(state);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| CommandError::IoWithPath {
            path: parent.to_path_buf(),
            source,
        })?;
    }

    let raw = serde_json::to_string_pretty(&normalized).map_err(CommandError::Json)?;
    write_file_atomically(path, raw.as_bytes())?;
    Ok(normalized)
}

pub fn save_hosts_backup(app: &AppHandle, content: &str) -> Result<PathBuf, CommandError> {
    let path = hosts_backup_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| CommandError::IoWithPath {
            path: parent.to_path_buf(),
            source,
        })?;
    }

    write_file_atomically(&path, content.as_bytes())?;
    Ok(path)
}

pub fn load_hosts_backup(app: &AppHandle) -> Result<String, CommandError> {
    let path = hosts_backup_path(app)?;
    fs::read_to_string(&path).map_err(|source| CommandError::IoWithPath { path, source })
}

pub fn normalize_app_state(state: &AppState) -> AppState {
    normalize_state(state.clone())
}

fn state_path(app: &AppHandle) -> Result<PathBuf, CommandError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|message| CommandError::Path(message.to_string()))?;
    Ok(dir.join(STORE_FILE))
}

fn hosts_backup_path(app: &AppHandle) -> Result<PathBuf, CommandError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|message| CommandError::Path(message.to_string()))?;
    Ok(dir.join(BACKUP_DIR).join(LAST_HOSTS_BACKUP_FILE))
}

fn profiles_backup_path(app: &AppHandle) -> Result<PathBuf, CommandError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|message| CommandError::Path(message.to_string()))?;
    Ok(dir.join(BACKUP_DIR).join(LAST_PROFILES_BACKUP_FILE))
}

fn write_file_atomically(path: &Path, content: &[u8]) -> Result<(), CommandError> {
    let parent = path.parent().ok_or_else(|| {
        CommandError::Path(format!(
            "failed to resolve parent directory for {}",
            path.display()
        ))
    })?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| CommandError::Path(format!("invalid file name {}", path.display())))?;
    let temp_path = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));

    let result = write_temp_file(&temp_path, content)
        .and_then(|()| {
            fs::rename(&temp_path, path).map_err(|source| CommandError::IoWithPath {
                path: path.to_path_buf(),
                source,
            })
        })
        .and_then(|()| sync_parent_dir(parent));

    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }

    result
}

fn write_temp_file(path: &Path, content: &[u8]) -> Result<(), CommandError> {
    let mut file = File::create(path).map_err(|source| CommandError::IoWithPath {
        path: path.to_path_buf(),
        source,
    })?;
    file.write_all(content)
        .and_then(|()| file.sync_all())
        .map_err(|source| CommandError::IoWithPath {
            path: path.to_path_buf(),
            source,
        })
}

fn sync_parent_dir(path: &Path) -> Result<(), CommandError> {
    File::open(path)
        .and_then(|dir| dir.sync_all())
        .map_err(|source| CommandError::IoWithPath {
            path: path.to_path_buf(),
            source,
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{HostGroup, HostNode, Preferences};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "hosts-switch-store-{label}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

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
    fn atomic_write_replaces_existing_file() {
        let dir = temp_dir("replace");
        let path = dir.join("profiles.json");
        fs::write(&path, b"old").unwrap();

        write_file_atomically(&path, b"new").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        let temp_files = fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(temp_files, 0);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn atomic_write_cleans_temp_file_after_failure() {
        let dir = temp_dir("failure");
        let path = dir.join("profiles.json");
        fs::create_dir(&path).unwrap();

        let error = write_file_atomically(&path, b"new").unwrap_err();

        assert!(matches!(error, CommandError::IoWithPath { .. }));
        let temp_files = fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(temp_files, 0);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn profile_state_backup_round_trips_normalized_json() {
        let dir = temp_dir("profile-backup");
        let path = dir.join("backups").join("profiles-last-backup.json");

        let written = write_state_to_path(&path, &state()).unwrap();
        let restored = read_state_from_path(&path).unwrap();

        assert!(written.groups[0].nodes[0].enabled);
        assert!(!written.groups[0].nodes[1].enabled);
        assert_eq!(restored, written);
        assert!(fs::read_to_string(&path).unwrap().contains("\"groups\""));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn corrupted_profile_store_recovers_from_last_profiles_backup() {
        let dir = temp_dir("recover-backup");
        let path = dir.join("profiles.json");
        let backup_path = dir.join("backups").join("profiles-last-backup.json");
        fs::write(&path, "{not json").unwrap();
        let backup = write_state_to_path(&backup_path, &state()).unwrap();

        let recovered = load_state_from_paths(&path, &backup_path).unwrap();

        assert_eq!(recovered, backup);
        assert_eq!(read_state_from_path(&path).unwrap(), backup);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn corrupted_profile_store_is_preserved_when_default_state_is_recreated() {
        let dir = temp_dir("recover-default");
        let path = dir.join("profiles.json");
        let backup_path = dir.join("backups").join("profiles-last-backup.json");
        fs::write(&path, "{not json").unwrap();

        let recovered = load_state_from_paths(&path, &backup_path).unwrap();

        assert_eq!(recovered.version, AppState::default().version);
        assert_eq!(read_state_from_path(&path).unwrap(), recovered);
        let corrupt_files: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".corrupt-"))
            .collect();
        assert_eq!(corrupt_files.len(), 1);
        assert_eq!(
            fs::read_to_string(corrupt_files[0].path()).unwrap(),
            "{not json"
        );
        let _ = fs::remove_dir_all(dir);
    }
}
