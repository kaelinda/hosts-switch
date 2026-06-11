import { readFileSync } from "node:fs";

const readme = readFileSync("README.md", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const version = packageJson.version;
const templatePath = `docs/release/manual-validation-v${version}.md`;
const template = readFileSync(templatePath, "utf8");

const requiredChecks = [
  {
    id: "status-bar-open-editor",
    readmeText: "left-click opens the editor",
  },
  {
    id: "status-bar-menu-profiles",
    readmeText: "status-bar menu lists saved groups/nodes",
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
    readmeText: "native dialogs",
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
    readmeText: "Restore the latest hosts backup",
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
  `DMG: \`Hosts Switch_${version}_aarch64.dmg\``,
  `https://github.com/kaelinda/hosts-switch/releases/tag/v${version}`,
]) {
  if (!template.includes(requiredText)) {
    fail(`template missing version text ${JSON.stringify(requiredText)}`);
  }
}

if (!readme.includes(templatePath)) {
  fail(`README missing manual validation template path ${templatePath}`);
}

for (const requiredText of [
  "Save a copy of the current `/etc/hosts`.",
  "Restore the original `/etc/hosts` if it was changed.",
  "Disable Launch at login if it was enabled only for testing.",
]) {
  if (!template.includes(requiredText)) {
    fail(`template missing safety step ${JSON.stringify(requiredText)}`);
  }
}

console.log(`Verified ${requiredChecks.length} manual validation checks for ${version}`);
