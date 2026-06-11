use crate::commands::CommandError;
use crate::hosts::normalize_state;
use crate::models::AppState;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

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
    fs::write(&path, raw).map_err(|source| CommandError::IoWithPath { path, source })?;
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

    fs::write(&path, content).map_err(|source| CommandError::IoWithPath {
        path: path.clone(),
        source,
    })?;
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
