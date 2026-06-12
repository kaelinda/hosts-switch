import { readFileSync } from "node:fs";

const readme = readFileSync("README.md", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const version = packageJson.version;
const templatePath = `docs/release/manual-validation-v${version}.md`;
const resultPath = `docs/release/manual-validation-v${version}.result.json`;
const localDmgName = `Hosts Switch_${version}_aarch64.dmg`;
const releaseAssetName = `Hosts.Switch_${version}_aarch64.dmg`;
const template = readFileSync(templatePath, "utf8");

const requiredChecks = [
  {
    id: "status-bar-open-editor",
    readmeText: "left-click opens the editor",
  },
  {
    id: "status-bar-menu-profiles",
    readmeText: "status-bar menu lists saved groups/nodes, including the per-group No Active Node item",
  },
  {
    id: "status-bar-admin-prompt",
    readmeText: "administrator prompt appears",
  },
  {
    id: "admin-cancel-preserves-profile",
    readmeText: "cancelling the administrator prompt leaves the saved active profile unchanged",
  },
  {
    id: "managed-block-only",
    readmeText: "only the managed block changes",
  },
  {
    id: "invalid-content-blocked",
    readmeText: "Apply/status-bar switching is blocked",
  },
  {
    id: "native-json-roundtrip",
    readmeText: "confirm the replacement prompt",
  },
  {
    id: "delete-confirmation",
    readmeText: "confirmed deleting",
  },
  {
    id: "launch-at-login-system-setting",
    readmeText: "System Settings reflects the login item",
  },
  {
    id: "global-shortcut-focuses-editor",
    readmeText: "opens/focuses the editor",
  },
  {
    id: "latest-backup-restore",
    readmeText: "confirm the restore prompt",
  },
];

function fail(message) {
  console.error(`Manual validation template verification failed: ${message}`);
  process.exit(1);
}

for (const check of requiredChecks) {
  if (!template.includes(`\`${check.id}\``)) {
    fail(`template missing check id ${check.id}`);
  }
  if (!readme.includes(check.readmeText)) {
    fail(`README missing checklist text ${JSON.stringify(check.readmeText)}`);
  }
}

for (const requiredText of [
  `# Hosts Switch v${version} Manual Validation`,
  `Tag: \`v${version}\``,
  `Release asset: \`${releaseAssetName}\``,
  `Local bundle name: \`${localDmgName}\``,
  `https://github.com/kaelinda/hosts-switch/releases/tag/v${version}`,
  `Structured result: \`${resultPath}\``,
]) {
  if (!template.includes(requiredText)) {
    fail(`template missing version text ${JSON.stringify(requiredText)}`);
  }
}

if (!readme.includes(templatePath)) {
  fail(`README missing manual validation template path ${templatePath}`);
}

if (!readme.includes(resultPath)) {
  fail(`README missing manual validation result path ${resultPath}`);
}

if (!readme.includes("npm run verify:manual-readiness")) {
  fail("README missing manual readiness preflight command");
}

if (!readme.includes("npm run verify:manual-result")) {
  fail("README missing manual result verification command");
}

if (!readme.includes("npm run sync:manual-release")) {
  fail("README missing manual release metadata sync command");
}

if (!readme.includes("npm run verify:release-assets")) {
  fail("README missing release asset verification command");
}

if (!readme.includes("npm run prepare:manual-validation")) {
  fail("README missing manual validation preparation command");
}

if (!readme.includes("npm run prepare:manual-release-asset")) {
  fail("README missing manual release asset preparation command");
}

if (!readme.includes("npm run record:manual-result")) {
  fail("README missing manual result recording command");
}

for (const requiredText of [localDmgName, releaseAssetName]) {
  if (!readme.includes(requiredText)) {
    fail(`README missing DMG name ${JSON.stringify(requiredText)}`);
  }
}

for (const requiredText of [
  "Run `npm run verify:manual-readiness` and review its warnings.",
  "Run `npm run prepare:manual-release-asset` to download the exact GitHub release DMG and verify its SHA-256 against this result file.",
  "Run `npm run prepare:manual-validation -- --write-backup` to save a copy of the current `/etc/hosts` and record `hostsBeforeSha256`; if the command refuses an empty hosts file, restore or intentionally confirm the system hosts state before continuing.",
  "`delete-confirmation`: Deleting a node or group asks for confirmation",
  "Run `npm run sync:manual-release` after the prerelease is published to refresh artifact metadata.",
  "Run `npm run verify:release-assets` to verify the GitHub release asset and `dmg.sha256`.",
  "Run `npm run prepare:manual-release-asset` before packaged-app testing to avoid validating a different local DMG build.",
  "Prefer `npm run record:manual-result -- --check <check-id>=pass --check-note <check-id>=\"evidence\"` when recording individual checks.",
  "Record evidence notes for every pass/fail check; pending checks may keep empty notes.",
  "Re-run `npm run prepare:manual-validation` and record `hostsAfterRestoredSha256`.",
  "Restore the original `/etc/hosts` if it was changed.",
  "Disable Launch at login if it was enabled only for testing.",
]) {
  if (!template.includes(requiredText)) {
    fail(`template missing safety step ${JSON.stringify(requiredText)}`);
  }
}

console.log(`Verified ${requiredChecks.length} manual validation checks for ${version}`);
