# Hosts Switch v0.1.8 Manual Validation

This checklist records the remaining packaged-app checks that intentionally require a real macOS session. Do not run these checks on a machine where changing `/etc/hosts`, login items, or global shortcuts would be unsafe.

Release under test:

- Tag: `v0.1.8`
- Release asset: `Hosts.Switch_0.1.8_aarch64.dmg`
- Local bundle name: `Hosts Switch_0.1.8_aarch64.dmg`
- Release: <https://github.com/kaelinda/hosts-switch/releases/tag/v0.1.8>

Before testing:

- [ ] Run `npm run verify:manual-readiness` and review its warnings.
- [ ] Save a copy of the current `/etc/hosts`.
- [ ] Confirm no unrelated Hosts Switch instance is running.
- [ ] Install or open the packaged app from the release asset `Hosts.Switch_0.1.8_aarch64.dmg`.

Manual checks:

- [ ] `status-bar-open-editor`: Left-click the status-bar icon opens and focuses the editor.
- [ ] `status-bar-menu-profiles`: The status-bar menu lists saved groups and nodes with active checks.
- [ ] `status-bar-admin-prompt`: Switching a valid node from the status-bar menu shows the macOS administrator prompt.
- [ ] `admin-cancel-preserves-profile`: Cancelling that administrator prompt leaves the saved active profile unchanged.
- [ ] `managed-block-only`: Applying a valid node changes only the Hosts Switch managed block in `/etc/hosts`.
- [ ] `invalid-content-blocked`: Invalid enabled hosts content blocks editor Apply and status-bar switching before any write.
- [ ] `native-json-roundtrip`: Export profiles to JSON and import the same JSON back through native dialogs.
- [ ] `launch-at-login-system-setting`: Toggling Launch at login is reflected in macOS System Settings.
- [ ] `global-shortcut-focuses-editor`: Toggling Global shortcut on lets `CommandOrControl+Shift+H` open and focus the editor.
- [ ] `latest-backup-restore`: Restore Latest Backup restores the previously backed-up hosts file only after intentionally testing Apply.

After testing:

- [ ] Restore the original `/etc/hosts` if it was changed.
- [ ] Disable Launch at login if it was enabled only for testing.
- [ ] Quit Hosts Switch.

Result:

- Tester:
- Date:
- Outcome: `pass` / `fail`
- Notes:
