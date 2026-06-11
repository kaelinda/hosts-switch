# Hosts Switch

Hosts Switch is a macOS menu-bar app for managing named `/etc/hosts` profiles. It is built with Tauri 2, React, and Rust, and is inspired by iHosts' group/node workflow.

## Features

- macOS status-bar menu for direct hosts profile switching.
- Groups and nodes with one active node per group by default.
- Compact editor for creating, editing, deleting, reordering, and searching profiles.
- Exact managed-block preview before writing `/etc/hosts`.
- Hover preview without mutating draft state.
- Hosts-line validation before every Apply or status-bar switch.
- Safe managed block that preserves unmanaged `/etc/hosts` content.
- Latest `/etc/hosts` backup before Apply and one-click backup restore.
- Restore editable profiles from an existing managed block.
- Native JSON file import/export for profile migration, plus browser demo copy/paste fallback.
- Launch at login toggle backed by a macOS LaunchAgent.
- Global editor shortcut: `CommandOrControl+Shift+H`.
- DMG and `.app` bundle output for local distribution.

## Safety Model

Hosts Switch only owns the block between:

```text
# >>> Hosts Switch managed block
# <<< Hosts Switch managed block
```

Everything outside that block is preserved. Applying changes reads the current `/etc/hosts`, saves it as the latest app backup, writes the next file to a temporary path, then asks macOS for administrator privileges to copy it into `/etc/hosts`, set `0644`, and flush DNS cache.

If the administrator prompt is cancelled or the write fails, the saved active profile state is not advanced.

## Development

```bash
npm install
npm run build
npm run browser:smoke
cargo test --manifest-path src-tauri/Cargo.toml --offline
npm run tauri:build -- --ci
```

Run the browser demo without touching the real hosts file:

```bash
npm run dev -- --port 1420
```

Build release bundles:

```bash
npm run tauri:build:dmg -- --ci
```

Current bundle outputs:

- `src-tauri/target/release/bundle/macos/Hosts Switch.app`
- `src-tauri/target/release/bundle/dmg/Hosts Switch_0.1.0_aarch64.dmg`

## Manual Release Checklist

- Open the packaged `.app` or install from the DMG.
- Confirm the app launches as a status-bar utility without showing the editor window automatically.
- Confirm left-click opens the editor and the status-bar menu lists saved groups/nodes.
- Switch a valid node from the status-bar menu and confirm the administrator prompt appears.
- Confirm cancelling the administrator prompt leaves the saved active profile unchanged.
- Apply a valid node and confirm only the managed block changes in `/etc/hosts`.
- Add invalid enabled hosts content and confirm Apply/status-bar switching is blocked.
- Export profiles to JSON and import the same JSON back through the native dialogs.
- Toggle Launch at login and confirm System Settings reflects the login item.
- Toggle Global shortcut and confirm `CommandOrControl+Shift+H` opens/focuses the editor.
- Restore the latest hosts backup only after intentionally testing Apply.

## Distribution Notes

The local DMG is unsigned and not notarized. External distribution still needs a Developer ID certificate, hardened runtime signing, notarization, and stapling.
