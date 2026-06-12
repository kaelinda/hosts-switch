mod commands;
mod hosts;
mod models;
mod store;
mod tray_switch;

use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, WindowEvent};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            crate::tray_switch::show_main_window(app);
        }))
        .on_window_event(|window, event| {
            if window.label() == "main" {
                hide_main_window_on_close(window, event);
            }
        })
        .setup(|app| {
            build_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_app_state,
            commands::save_app_state,
            commands::export_profiles,
            commands::export_profiles_to_file,
            commands::import_profiles,
            commands::import_profiles_from_file,
            commands::read_hosts_snapshot,
            commands::preview_hosts,
            commands::validate_hosts_state,
            commands::apply_hosts,
            commands::restore_managed_block,
            commands::restore_profiles_from_hosts,
            commands::restore_last_profiles_backup,
            commands::restore_last_hosts_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running Hosts Switch");
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = tray_switch::build_menu(app)?;

    TrayIconBuilder::with_id("main")
        .tooltip("Hosts Switch")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if let Some(tray) = app.tray_by_id("main") {
                tray_switch::handle_menu_event(app, &tray, event.id().as_ref());
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                tray_switch::show_main_window(&tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn hide_main_window_on_close(window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
}
