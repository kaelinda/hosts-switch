# Hosts Switch Product Design

**Goal:** Build a macOS menu-bar app for managing and applying named `/etc/hosts` profiles, inspired by the installed iHosts app.

**Reference Evidence:** `/Applications/iHosts.app` is a sandboxed menu-bar utility (`LSUIElement=true`) with Chinese strings and runtime symbols for Hosts groups, nodes, one-active-node-per-group, hover preview, apply/revert/restore, startup login, open-menu shortcut, and security-scoped access to `/private/etc/hosts`.

## Product Scope

The first product-grade slice will be a Tauri 2 + React app with a compact menu-bar style window. It supports:

- Viewing current `/etc/hosts`.
- Switching hosts directly from the macOS status-bar menu.
- Creating, editing, deleting, and reordering groups and nodes.
- Searching profiles by group name, node name, or hosts content.
- Activating at most one node per group by default.
- Rendering a preview of the exact managed hosts block before applying.
- Hover-previewing a node's hosts effect without changing the draft state.
- Validating enabled hosts lines before Apply or status-bar switching.
- Applying selected nodes to `/etc/hosts` while preserving all unmanaged content.
- Automatically backing up the current hosts file before Apply and restoring that last backup.
- Reverting draft edits in the app state.
- Restoring editable profiles from the managed block in `/etc/hosts`.
- Importing and exporting profiles as JSON files for backup and migration, with a paste/copy JSON panel fallback in the browser demo.
- Registering or unregistering the native macOS login item from the settings bar.
- Registering or unregistering a global shortcut to open the editor window.
- Persisting profiles and preferences locally.

Out of scope for this slice: paid account limits, StoreKit, editable shortcut capture, syntax highlighting parity with SyntaxKit, and App Store sandbox security-scoped bookmarks. Those are later hardening tasks.

## Data Model

The app stores a JSON document under the Tauri app data directory:

- `groups`: ordered list of groups.
- `nodes`: ordered children under each group.
- `node.content`: raw hosts lines for that node.
- `node.enabled`: whether it contributes to the managed block.
- `preferences.enforceOneActivePerGroup`: defaults to true.
- `preferences.previewOnHover`: defaults to true.
- `preferences.launchAtLogin`: mirrors the macOS login item status and defaults to false.
- `preferences.enableGlobalShortcut`: controls the editor-opening shortcut and defaults to true.

The renderer combines all enabled node contents inside:

```text
# >>> Hosts Switch managed block
...
# <<< Hosts Switch managed block
```

Everything outside that block remains unchanged when applying.

The restore flow parses `# Group:` and `# Node:` headings in the managed block back into editable groups and nodes. Legacy managed content without headings is imported into a single `Imported / Imported Hosts` profile so existing app-owned hosts entries are not stranded in preview-only text. If restored content contains multiple active nodes in the same group, the one-active-node preference is disabled for that restored state so the app does not silently drop entries that are currently present in `/etc/hosts`.

The import/export flow uses the same `AppState` JSON schema as persistence. In the native app, export opens a macOS save dialog and writes normalized, pretty JSON to the selected file. Import opens a macOS file picker, reads the selected JSON file, normalizes it, saves it as the current profile store, and refreshes the status-bar menu. In the browser demo, the same JSON contract remains available through a copy/paste panel.

When `previewOnHover` is enabled, hovering or focusing a node temporarily renders the preview as if that node were the active node for its group. This does not mutate the draft profile state, does not save profiles, and does not write `/etc/hosts`; moving away restores the draft preview.

The sidebar search filters visible groups and nodes by group name, node name, or node content. Filtering changes only the rendered list; it does not mutate profiles, activation state, preview state, or saved data.

The launch-at-login setting uses Tauri's autostart plugin with a macOS LaunchAgent. The app reads the actual system registration during startup and updates the persisted preference if they differ. Toggling the setting immediately enables or disables the system login item; existing unsaved hosts profile edits remain a draft.

The global shortcut setting uses Tauri's global-shortcut plugin. The first slice ships a fixed `CommandOrControl+Shift+H` shortcut that shows, unminimizes, and focuses the editor window. Toggling the setting immediately registers or unregisters that shortcut; configurable capture UI is deferred.

## Architecture

Rust owns file-system and hosts rendering behavior. React owns interactive editing and preview. The frontend calls Tauri commands through `@tauri-apps/api/core`.

Rust modules:

- `models.rs`: serializable app state and DTOs.
- `hosts.rs`: parse, render, merge, extract, and validate hosts content.
- `store.rs`: load/save JSON state.
- `commands.rs`: Tauri command boundary.
- `tray_switch.rs`: status-bar menu construction and direct node switching.
- `main.rs`/`lib.rs`: Tauri setup, tray, and command registration.

Frontend modules:

- `src/App.tsx`: app state, command calls, and layout.
- `src/styles.css`: compact macOS-like interface.
- `src/main.tsx`: React entry.

## Safety

Applying to `/etc/hosts` may require admin privileges. The app first writes to a temporary file and then uses macOS `osascript` with administrator privileges to copy that file to `/etc/hosts` and flush DNS cache. The command is only used from the explicit Apply action. Preview and state operations never touch system files.

Before each Apply, the current hosts file is copied into the app data directory as the latest backup. The Restore Last Hosts Backup action writes that backup back to `/etc/hosts` through the same administrator-privileged path. It restores the system hosts file only; it does not change the saved profiles.

If applying fails, the UI shows the exact error message returned by Rust and keeps the draft state.

The app saves profile state only after a hosts apply succeeds. If the user cancels administrator authorization or the system write fails, the saved active profile still reflects the last successfully applied state.

Status-bar node switching uses the same apply path as the window Apply button. Selecting a node from the menu prompts for administrator privileges when `/etc/hosts` must be written, saves the new profile state only after that write succeeds, refreshes the status-bar menu, and emits an event so an open editor window can refresh itself.

Enabled node contents are validated before any Apply path writes `/etc/hosts`. Blank lines and comments are allowed. Non-comment lines must start with a valid IPv4 or IPv6 address and include at least one valid hostname. The editor surfaces validation issues by node and line number; the status-bar switch path reports the same validation error back to the editor window and does not write the hosts file.

## Verification

Core hosts behavior is covered by Rust unit tests:

- Render active nodes with group/node headings.
- Preserve unmanaged content around the managed block.
- Replace an existing managed block.
- Extract the managed block from a real hosts file.
- Restore groups and nodes from an existing managed block.
- Export and import normalized profiles JSON.
- Preview a node on hover without mutating state.
- Back up current hosts before Apply and restore the last backup.
- Filter profiles without mutating saved state.
- Enforce one active node per group.
- Reject malformed enabled hosts lines before Apply.

Build verification:

- `npm install`
- `npm run build`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run tauri:build` for the macOS `.app` bundle.
- `npm run tauri:build:dmg -- --ci` for `.app` and `.dmg` release bundles.
- Browser smoke runs through a demo localStorage hosts file to verify UI switching without modifying `/etc/hosts`.
