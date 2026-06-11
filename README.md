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
npm run verify:bundle
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
- `src-tauri/target/release/bundle/dmg/Hosts Switch_0.1.8_aarch64.dmg`

## Packaged App Verification

`npm run verify:bundle` checks the packaged `.app` without touching `/etc/hosts`:

- Bundle metadata, version, identifier, icon, executable, and arm64 Mach-O output.
- `LSUIElement=true`, so the app runs as a status-bar utility.
- Main editor window is configured as `visible=false` on launch.
- Tauri global API is disabled in the WebView.
- Status-bar tray setup and required native commands are registered.
- Native profile import/export commands are used from the frontend.
- WebView capabilities do not grant dialog open/save or filesystem text-file permissions.
- The frontend does not import Tauri dialog or filesystem plugins directly.

## Manual Release Checklist

Use `docs/release/manual-validation-v0.1.8.md` and `docs/release/manual-validation-v0.1.8.result.json` to record these checks. Run `npm run verify:manual-validation` to confirm the release checklist and manual validation template stay in sync.
Run `npm run verify:manual-result` to validate the structured manual result, and run it with `HOSTS_SWITCH_REQUIRE_MANUAL_PASS=1` before promoting a prerelease to a production release.
Run `npm run verify:manual-readiness` before touching the packaged app; it is read-only and checks the checklist, local/release asset names, `/etc/hosts` readability, and whether another Hosts Switch instance appears to be running.

- Open the packaged `.app` or install from the release asset `Hosts.Switch_0.1.8_aarch64.dmg`.
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

The release workflow publishes `Hosts.Switch_0.1.8_aarch64.dmg` as the downloadable asset. Local Tauri builds still produce `Hosts Switch_0.1.8_aarch64.dmg`.

The local DMG is unsigned and not notarized. External distribution still needs a Developer ID certificate, hardened runtime signing, notarization, and stapling.
