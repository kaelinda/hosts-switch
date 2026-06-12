# Hosts Switch

Hosts Switch is a macOS menu-bar app for managing named `/etc/hosts` profiles. It is built with Tauri 2, React, and Rust, and is inspired by iHosts' group/node workflow.

## Features

- macOS status-bar menu for direct hosts profile switching and per-group disable.
- Groups and nodes with one active node per group by default.
- Compact editor for creating, editing, confirmed deleting, reordering, and searching profiles.
- Exact managed-block preview before writing `/etc/hosts`.
- Runtime warning when the current `/etc/hosts` file is empty before applying changes.
- Hover preview without mutating draft state.
- Hosts-line validation before every Apply or status-bar switch.
- Safe managed block that preserves unmanaged `/etc/hosts` content.
- Latest `/etc/hosts` backup before Apply and confirmed backup restore.
- Restore editable profiles from an existing managed block.
- Confirmed JSON file import/export for profile migration, plus browser demo copy/paste fallback.
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

If the current `/etc/hosts` file is empty, Apply and status-bar switching are blocked before backup or write so the app does not replace a suspicious system hosts state.

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
npm run verify:dmg
```

Current bundle outputs:

- `src-tauri/target/release/bundle/macos/Hosts Switch.app`
- `src-tauri/target/release/bundle/dmg/Hosts Switch_0.1.14_aarch64.dmg`

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

`npm run verify:dmg` mounts the release DMG read-only, verifies the contained `Hosts Switch.app` metadata and arm64 executable, then detaches it. It does not launch the app or modify `/etc/hosts`.

## Manual Release Checklist

Use `docs/release/manual-validation-v0.1.14.md` and `docs/release/manual-validation-v0.1.14.result.json` to record these checks. Run `npm run verify:manual-validation` to confirm the release checklist and manual validation template stay in sync.
Run `npm run verify:manual-result` to validate the structured manual result, and run it with `HOSTS_SWITCH_REQUIRE_MANUAL_PASS=1` before promoting a prerelease to a production release.
The structured result records the release asset SHA-256 and tag commit so manual validation remains tied to the exact DMG under test.
After a prerelease is published, run `npm run sync:manual-release` to refresh those fields from GitHub before recording manual validation.
Run `npm run verify:release-assets` to confirm the GitHub release assets, `dmg.sha256`, release body, and structured result all agree.
Run `npm run prepare:manual-release-asset` to download and SHA-256 verify the exact GitHub release DMG into `manual-validation-artifacts/` before packaged-app testing.
Release notes are maintained in `docs/release/release-notes-v0.1.14.md`; `npm run verify:release-notes` checks that the Chinese version notes, asset name, manual-validation warning, and SHA-256 line stay ready for publication.
Run `npm run verify:manual-readiness` before touching the packaged app; it is read-only and checks the checklist, local/release asset names, `/etc/hosts` readability, and whether another Hosts Switch instance appears to be running.
Run `npm run prepare:manual-validation` to print the current `/etc/hosts` SHA-256 and suggested backup path. Add `-- --write-backup` to copy `/etc/hosts` to that backup path before packaged-app testing. Empty `/etc/hosts` backups are refused by default; only add `-- --write-backup --allow-empty-hosts-backup` when an empty system hosts file is intentional.
Run `npm run record:manual-result -- --set-environment-current --check <check-id>=pass --check-note <check-id>="evidence"` to update the structured result after each manual check; pass/fail checks must include evidence notes, and the command re-runs `npm run verify:manual-result` after writing.

- Open the packaged `.app` or install from the verified release asset `manual-validation-artifacts/v0.1.14/Hosts.Switch_0.1.14_aarch64.dmg`.
- Confirm left-click opens the editor and the status-bar menu lists saved groups/nodes, including the per-group No Active Node item.
- Switch a valid node from the status-bar menu and confirm the administrator prompt appears.
- Confirm cancelling the administrator prompt leaves the saved active profile unchanged.
- Apply a valid node and confirm only the managed block changes in `/etc/hosts`.
- Add invalid enabled hosts content and confirm Apply/status-bar switching is blocked.
- Export profiles to JSON and import the same JSON back through the native dialogs; confirm the replacement prompt and verify cancelling it leaves current profiles unchanged.
- Delete a node or group and confirm the deletion prompt appears; cancelling it leaves the draft unchanged.
- Toggle Launch at login and confirm System Settings reflects the login item.
- Toggle Global shortcut and confirm `CommandOrControl+Shift+H` opens/focuses the editor.
- Restore the latest hosts backup only after intentionally testing Apply; confirm the restore prompt and verify cancelling it leaves `/etc/hosts` unchanged.

## Distribution Notes

The release workflow publishes `Hosts.Switch_0.1.14_aarch64.dmg` as the downloadable asset. Local Tauri builds still produce `Hosts Switch_0.1.14_aarch64.dmg`.
GitHub release notes are rendered from `docs/release/release-notes-v0.1.14.md`, with the workflow substituting the final DMG SHA-256 before publishing.

The local DMG is unsigned and not notarized. External distribution still needs a Developer ID certificate, hardened runtime signing, notarization, and stapling.
