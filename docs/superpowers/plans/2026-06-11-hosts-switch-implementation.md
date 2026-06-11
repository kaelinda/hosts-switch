# Hosts Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a usable Tauri 2 + React macOS hosts switcher with safe managed-block writes.

**Architecture:** Rust provides tested hosts rendering, persistence, and privileged apply commands. React provides a compact menu-bar style editor with group/node activation, preview, and status feedback.

**Tech Stack:** Tauri 2.11, React 18, Vite 5, TypeScript, Rust 2024, serde.

---

### Task 1: Scaffold Project

**Files:**
- Create: `package.json`, `index.html`, `tsconfig.json`, `vite.config.ts`
- Create: `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`

- [x] Add frontend and Tauri package metadata.
- [x] Add Vite and TypeScript config.
- [x] Add Tauri v2 config and default command capability.

### Task 2: Hosts Core

**Files:**
- Create: `src-tauri/src/models.rs`
- Create: `src-tauri/src/hosts.rs`

- [x] Define app state, group, node, and preference models.
- [x] Implement render/merge/extract helpers.
- [x] Add unit tests for managed-block behavior and one-active-per-group enforcement.

### Task 3: Tauri Commands

**Files:**
- Create: `src-tauri/src/store.rs`
- Create: `src-tauri/src/commands.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/main.rs`

- [x] Implement load/save app state.
- [x] Implement read current hosts, preview, save, apply, and restore commands.
- [x] Register commands and macOS tray behavior.

### Task 4: React UI

**Files:**
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`

- [x] Build the compact editor surface.
- [x] Support groups, nodes, activation, editing, preview, revert, restore, and apply.
- [x] Surface loading, dirty state, and errors.

### Task 5: Verification

**Commands:**
- `npm install`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run build`
- `npm run tauri:build`
- Browser smoke: run Vite dev server, open the app, activate a node, confirm preview updates, and use browser demo Apply without touching `/etc/hosts`.

- [x] Install dependencies.
- [x] Run Rust unit tests.
- [x] Run frontend build.
- [x] Run native app build or report blocking dependency errors.
- [x] Run browser UI smoke.

### Task 6: Status-Bar Hosts Switching

**Files:**
- Create: `src-tauri/src/tray_switch.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src/api.ts`
- Modify: `src/App.tsx`

- [x] Build status-bar submenus from saved groups and nodes.
- [x] Use check menu items to show active nodes.
- [x] Switch a selected node from the status-bar menu and apply through the existing privileged hosts writer.
- [x] Refresh the status-bar menu after switching.
- [x] Emit status events so the editor window refreshes when a tray switch succeeds or reports errors when it fails.
- [x] Add unit tests for node switching rules.

### Task 7: Apply Consistency and Tray Sync

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/store.rs`
- Modify: `src-tauri/src/tray_switch.rs`

- [x] Save profile state only after privileged `/etc/hosts` write succeeds.
- [x] Keep the saved profile state unchanged when Apply is cancelled or fails.
- [x] Refresh the status-bar menu after editor Save.
- [x] Refresh the status-bar menu after editor Apply.
- [x] On status-bar Apply failure, emit the last saved state back to the editor window.

### Task 8: Hosts Content Validation

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/hosts.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types.ts`
- Modify: `src/hostsPreview.ts`
- Modify: `src/api.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [x] Add structured validation issues for enabled hosts node content.
- [x] Allow comments and blank lines.
- [x] Require every enabled non-comment line to contain a valid IP address plus at least one hostname.
- [x] Block editor Apply and status-bar switching before writing `/etc/hosts` when validation errors exist.
- [x] Mirror validation in the browser demo.
- [x] Surface node-level validation issues in the editor.
- [x] Add Rust unit tests for valid IPv4/IPv6/comments and invalid IP/hostname cases.

### Task 9: Restore Profiles From Managed Block

**Files:**
- Modify: `src-tauri/src/hosts.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/hostsPreview.ts`
- Modify: `src/api.ts`
- Modify: `src/App.tsx`

- [x] Parse the app managed block back into editable groups and nodes.
- [x] Preserve `# Group:` and `# Node:` boundaries when restoring.
- [x] Import legacy heading-less managed content into a default Imported profile.
- [x] Save restored profiles and refresh the status-bar menu.
- [x] Mirror restore behavior in the browser demo.
- [x] Change the Restore toolbar action to restore profiles instead of only previewing raw text.
- [x] Add Rust unit tests for grouped, legacy, and empty managed blocks.

### Task 10: Profiles JSON Import and Export

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/api.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [x] Export normalized profiles as pretty JSON.
- [x] Import pasted profiles JSON, normalize it, save it, and refresh the status-bar menu.
- [x] Mirror import/export behavior in the browser demo.
- [x] Add toolbar actions for Import and Export.
- [x] Add a focused JSON panel for import/export text.
- [x] Add Rust unit tests for export normalization and invalid import JSON handling.

### Task 11: Hover Preview

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [x] Add transient hover preview state that does not mutate profiles.
- [x] Render the preview as if the hovered node were active for its group.
- [x] Restore the draft preview when hover/focus leaves the node.
- [x] Respect the `previewOnHover` preference.
- [x] Surface hover preview status in the status line and preview header.
- [x] Add a visual marker for the node being previewed.

### Task 12: Hosts Backup and Restore

**Files:**
- Modify: `src-tauri/src/store.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/api.ts`
- Modify: `src/App.tsx`

- [x] Save the current hosts file as the latest app backup before Apply writes `/etc/hosts`.
- [x] Add a command to restore the latest hosts backup through the privileged writer.
- [x] Mirror backup and restore behavior in the browser demo without touching `/etc/hosts`.
- [x] Add a toolbar action to restore the last hosts backup.
- [x] Refresh the current snapshot after a backup restore.

### Task 13: Profile Search

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [x] Add a sidebar search field for profiles.
- [x] Filter groups by group name.
- [x] Filter nodes by node name and hosts content.
- [x] Keep filtering display-only without mutating profiles or saved state.
- [x] Show an empty search result state.

### Task 14: Native Profiles File Import and Export

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src/api.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [x] Add Tauri dialog and filesystem plugins.
- [x] Register plugins in the Tauri builder.
- [x] Grant the main window only the dialog open/save and text-file read/write permissions needed for profiles JSON files.
- [x] Export profiles through a native save dialog in the Tauri runtime.
- [x] Import profiles through a native open dialog in the Tauri runtime.
- [x] Keep the existing JSON copy/paste panel as the browser demo fallback.
- [x] Surface cancelled native dialogs without treating them as errors.

### Task 15: Launch at Login

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/hosts.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/tray_switch.rs`
- Modify: `src/types.ts`
- Modify: `src/hostsPreview.ts`
- Modify: `src/api.ts`
- Modify: `src/App.tsx`

- [x] Add Tauri autostart plugin dependencies.
- [x] Register the autostart plugin with the macOS LaunchAgent launcher.
- [x] Grant the main window the autostart enable, disable, and is-enabled permissions.
- [x] Add a persisted `launchAtLogin` preference with backwards-compatible defaults.
- [x] Read the actual system login item state when profiles load.
- [x] Add a settings-bar toggle that enables or disables the login item immediately.
- [x] Keep unsaved hosts profile edits as drafts when only the login-item preference is toggled.

### Task 16: Global Editor Shortcut

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/hosts.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/tray_switch.rs`
- Modify: `src/types.ts`
- Modify: `src/hostsPreview.ts`
- Modify: `src/api.ts`
- Modify: `src/App.tsx`

- [x] Add Tauri global-shortcut plugin dependencies.
- [x] Register the global-shortcut plugin in the Tauri builder.
- [x] Grant the main window global shortcut register, unregister, and is-registered permissions.
- [x] Add a persisted `enableGlobalShortcut` preference with backwards-compatible defaults.
- [x] Register `CommandOrControl+Shift+H` to show and focus the editor window.
- [x] Read the actual shortcut registration state when profiles load.
- [x] Add a settings-bar toggle that registers or unregisters the shortcut immediately.
- [x] Keep unsaved hosts profile edits as drafts when only the shortcut preference is toggled.

### Task 17: DMG Distribution and Release Docs

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `docs/superpowers/specs/2026-06-11-hosts-switch-design.md`
- Create: `README.md`

- [x] Add a `tauri:build:dmg` npm script.
- [x] Configure Tauri bundle targets for both `.app` and `.dmg`.
- [x] Build the DMG release artifact.
- [x] Document features, safety model, development commands, bundle outputs, and release checklist.
- [x] Note that external distribution still needs signing and notarization.

### Task 18: Status-Bar Group Disable

**Files:**
- Modify: `src-tauri/src/tray_switch.rs`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-06-11-hosts-switch-design.md`
- Modify: `docs/release/manual-validation-v0.1.10.md`

- [x] Add a per-group No Active Node item to the status-bar menu.
- [x] Apply group disable through the same privileged hosts writer used by node switching.
- [x] Keep profile state unchanged when the privileged apply path fails.
- [x] Emit status events so an open editor refreshes after status-bar group disable.
- [x] Add Rust unit tests for disabling a group from the status menu.
- [x] Update product and release validation docs for the visible status-bar disable path.
