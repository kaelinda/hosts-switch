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

pub fn load_state(app: &AppHandle) -> Result<AppState, CommandError> {
    let path = state_path(app)?;
    if !path.exists() {
        let state = AppState::default();
        save_state(app, &state)?;
        return Ok(state);
    }

    let raw = fs::read_to_string(&path).map_err(|source| CommandError::IoWithPath {
        path: path.clone(),
        source,
    })?;
    let state: AppState = serde_json::from_str(&raw).map_err(|source| CommandError::StoreJson {
        path: path.clone(),
        source,
    })?;
    Ok(normalize_state(state))
}

pub fn save_state(app: &AppHandle, state: &AppState) -> Result<AppState, CommandError> {
    let normalized = normalize_app_state(state);
    let path = state_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| CommandError::IoWithPath {
            path: parent.to_path_buf(),
            source,
        })?;
    }

    let raw = serde_json::to_string_pretty(&normalized).map_err(CommandError::Json)?;
    write_file_atomically(&path, raw.as_bytes())?;
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
}
