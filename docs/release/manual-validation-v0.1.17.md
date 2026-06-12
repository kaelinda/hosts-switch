# Hosts Switch v0.1.17 Manual Validation

This checklist records the remaining packaged-app checks that intentionally require a real macOS session. Do not run these checks on a machine where changing `/etc/hosts`, login items, or global shortcuts would be unsafe.

Release under test:

- Tag: `v0.1.17`
- Release asset: `Hosts.Switch_0.1.17_aarch64.dmg`
- Local bundle name: `Hosts Switch_0.1.17_aarch64.dmg`
- Release: <https://github.com/kaelinda/hosts-switch/releases/tag/v0.1.17>
- Structured result: `docs/release/manual-validation-v0.1.17.result.json`

Before testing:

- [ ] Run `npm run verify:manual-readiness` and review its warnings.
- [ ] If `/etc/hosts` is empty or missing localhost entries, run `npm run print:hosts-recovery` and manually restore a safe hosts baseline before continuing; the command prints guidance only and does not modify `/etc/hosts`.
- [ ] Run `npm run prepare:manual-release-asset` to download the exact GitHub release DMG and verify its SHA-256 against this result file.
- [ ] Run `npm run prepare:manual-validation -- --write-backup` to save a copy of the current `/etc/hosts` and record `hostsBeforeSha256`; if the command refuses an empty hosts file, restore or intentionally confirm the system hosts state before continuing.
- [ ] Confirm no unrelated Hosts Switch instance is running.
- [ ] Install or open the packaged app from the verified release asset `manual-validation-artifacts/v0.1.17/Hosts.Switch_0.1.17_aarch64.dmg`.

Manual checks:

- [ ] `status-bar-open-editor`: Left-click the status-bar icon opens and focuses the editor.
- [ ] `status-bar-menu-profiles`: The status-bar menu lists saved groups and nodes with active checks, plus a per-group No Active Node item.
- [ ] `status-bar-admin-prompt`: Switching a valid node from the status-bar menu shows the macOS administrator prompt.
- [ ] `status-bar-active-node-noop`: Selecting the already-active node from the status-bar menu leaves it active and does not trigger another `/etc/hosts` write; use No Active Node to disable the group.
- [ ] `admin-cancel-preserves-profile`: Cancelling that administrator prompt leaves the saved active profile unchanged.
- [ ] `managed-block-only`: Applying a valid node changes only the Hosts Switch managed block in `/etc/hosts`.
- [ ] `invalid-content-blocked`: Invalid enabled hosts content blocks editor Apply and status-bar switching before any write.
- [ ] `native-json-roundtrip`: Export profiles to JSON and import the same JSON back through native dialogs; importing asks for confirmation, cancelling leaves current profiles unchanged, and confirming replaces profiles.
- [ ] `profiles-backup-restore`: Replace saved profiles, then restore the latest profiles backup; restoring asks for confirmation, cancelling leaves current profiles unchanged, and confirming restores the previous saved profiles.
- [ ] `delete-confirmation`: Deleting a node or group asks for confirmation, cancelling leaves the draft unchanged, and confirming removes only the draft item until Save.
- [ ] `launch-at-login-system-setting`: Toggling Launch at login is reflected in macOS System Settings.
- [ ] `global-shortcut-focuses-editor`: Toggling Global shortcut on lets `CommandOrControl+Shift+H` open and focus the editor.
- [ ] `latest-backup-restore`: Restore Latest Backup asks for confirmation, cancelling leaves `/etc/hosts` unchanged, and confirming restores the previously backed-up hosts file only after intentionally testing Apply.

After testing:

- [ ] Restore the original `/etc/hosts` if it was changed.
- [ ] Re-run `npm run prepare:manual-validation` and record `hostsAfterRestoredSha256`.
- [ ] Disable Launch at login if it was enabled only for testing.
- [ ] Quit Hosts Switch.

Result:

- Tester:
- Date:
- Outcome: `pass` / `fail`
- Notes:

Structured result:

- Update `docs/release/manual-validation-v0.1.17.result.json` with the same outcome.
- Run `npm run record:manual-result -- --help` to list valid check IDs before recording evidence.
- Prefer `npm run record:manual-result -- --set-environment-current --check <check-id>=pass --check-note <check-id>="evidence"` when recording individual checks.
- Record evidence notes for every pass/fail check; pending checks may keep empty notes.
- Keep the recorded release asset SHA-256 and tag commit tied to the artifact actually tested.
- Run `npm run sync:manual-release` after the prerelease is published to refresh artifact metadata.
- Run `npm run verify:release-assets` to verify the GitHub release asset and `dmg.sha256`.
- Run `npm run prepare:manual-release-asset` before packaged-app testing to avoid validating a different local DMG build.
- Run `npm run verify:manual-result` to validate the result file.
- Run `HOSTS_SWITCH_REQUIRE_MANUAL_PASS=1 npm run verify:manual-result` before promoting this prerelease to a production release.
