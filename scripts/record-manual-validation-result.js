import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const version = packageJson.version;
const tag = `v${version}`;
const resultPath = `docs/release/manual-validation-${tag}.result.json`;
const hostsPath = "/etc/hosts";
const allowedStatuses = new Set(["pending", "pass", "fail"]);
const sha256Pattern = /^[a-f0-9]{64}$/;
const requiredChecks = [
  "status-bar-open-editor",
  "status-bar-menu-profiles",
  "status-bar-admin-prompt",
  "admin-cancel-preserves-profile",
  "managed-block-only",
  "invalid-content-blocked",
  "native-json-roundtrip",
  "launch-at-login-system-setting",
  "global-shortcut-focuses-editor",
  "latest-backup-restore",
];

function fail(message) {
  console.error(`Manual validation result recording failed: ${message}`);
  process.exit(1);
}

function parseKeyValue(raw, label) {
  const separator = raw.indexOf("=");
  if (separator <= 0) {
    fail(`${label} must use key=value syntax`);
  }
  return [raw.slice(0, separator), raw.slice(separator + 1)];
}

function parseArgs(argv) {
  const options = {
    checks: [],
    checkNotes: [],
    setHostsBeforeCurrent: false,
    setHostsAfterCurrent: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        fail(`${arg} requires a value`);
      }
      return argv[index];
    };

    if (arg === "--check") {
      options.checks.push(parseKeyValue(next(), "--check"));
    } else if (arg === "--check-note") {
      options.checkNotes.push(parseKeyValue(next(), "--check-note"));
    } else if (arg === "--status") {
      options.status = next();
    } else if (arg === "--tester") {
      options.tester = next();
    } else if (arg === "--date") {
      options.date = next();
    } else if (arg === "--macos") {
      options.macos = next();
    } else if (arg === "--hardware") {
      options.hardware = next();
    } else if (arg === "--hosts-before") {
      options.hostsBeforeSha256 = next();
    } else if (arg === "--hosts-after") {
      options.hostsAfterRestoredSha256 = next();
    } else if (arg === "--notes") {
      options.notes = next();
    } else if (arg === "--set-hosts-before-current") {
      options.setHostsBeforeCurrent = true;
    } else if (arg === "--set-hosts-after-current") {
      options.setHostsAfterCurrent = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      fail(`unknown argument ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  npm run record:manual-result -- --check status-bar-open-editor=pass
  npm run record:manual-result -- --status pass --tester "Name" --date 2026-06-12 --macos "macOS 15.5" --hardware "Apple Silicon"

Options:
  --check <id=pass|fail|pending>        Set one manual check status. Repeatable.
  --check-note <id=note>                Set notes for one manual check. Repeatable.
  --status <pending|pass|fail>          Override the derived overall status.
  --tester <name>                       Tester name for non-pending results.
  --date <date>                         Validation date for non-pending results.
  --macos <version>                     macOS environment for non-pending results.
  --hardware <description>              Hardware environment for non-pending results.
  --hosts-before <sha256>               Set hostsBeforeSha256.
  --hosts-after <sha256>                Set hostsAfterRestoredSha256.
  --set-hosts-before-current            Read current /etc/hosts and use its SHA-256 as hostsBeforeSha256.
  --set-hosts-after-current             Read current /etc/hosts and use its SHA-256 as hostsAfterRestoredSha256.
  --notes <text>                        Set top-level notes.
  --dry-run                             Print the updated JSON without writing.
`);
}

function assertCheckId(checkId) {
  if (!requiredChecks.includes(checkId)) {
    fail(`unknown check id ${checkId}`);
  }
}

function assertStatus(status, label) {
  if (!allowedStatuses.has(status)) {
    fail(`${label} must be one of ${Array.from(allowedStatuses).join(", ")}`);
  }
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    fail(`${label} must be a lowercase SHA-256 digest`);
  }
}

function currentHostsSha256() {
  return createHash("sha256").update(readFileSync(hostsPath)).digest("hex");
}

function deriveStatus(checks) {
  const statuses = requiredChecks.map((checkId) => checks[checkId].status);
  if (statuses.includes("fail")) {
    return "fail";
  }
  if (statuses.every((status) => status === "pass")) {
    return "pass";
  }
  return "pending";
}

function requirePresent(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} is required when manual validation is not pending`);
  }
}

function verifyResult() {
  execFileSync("node", ["scripts/verify-manual-validation-result.js"], {
    stdio: "inherit",
  });
}

const options = parseArgs(process.argv.slice(2));
const result = JSON.parse(readFileSync(resultPath, "utf8"));

if (result.version !== version || result.tag !== tag) {
  fail(`manual result version/tag mismatch: ${result.version} ${result.tag}`);
}

const next = {
  ...result,
  environment: {
    ...result.environment,
  },
  checks: Object.fromEntries(
    requiredChecks.map((checkId) => [
      checkId,
      {
        ...result.checks[checkId],
      },
    ]),
  ),
};

for (const [checkId, status] of options.checks) {
  assertCheckId(checkId);
  assertStatus(status, `check ${checkId} status`);
  next.checks[checkId].status = status;
}

for (const [checkId, note] of options.checkNotes) {
  assertCheckId(checkId);
  next.checks[checkId].notes = note;
}

if (options.status) {
  assertStatus(options.status, "result status");
  next.status = options.status;
} else {
  next.status = deriveStatus(next.checks);
}

if (options.tester !== undefined) {
  next.tester = options.tester;
}
if (options.date !== undefined) {
  next.date = options.date;
}
if (options.macos !== undefined) {
  next.environment.macOS = options.macos;
}
if (options.hardware !== undefined) {
  next.environment.hardware = options.hardware;
}
if (options.hostsBeforeSha256 !== undefined) {
  assertSha256(options.hostsBeforeSha256, "hostsBeforeSha256");
  next.hostsBeforeSha256 = options.hostsBeforeSha256;
}
if (options.hostsAfterRestoredSha256 !== undefined) {
  assertSha256(options.hostsAfterRestoredSha256, "hostsAfterRestoredSha256");
  next.hostsAfterRestoredSha256 = options.hostsAfterRestoredSha256;
}
if (options.setHostsBeforeCurrent) {
  next.hostsBeforeSha256 = currentHostsSha256();
}
if (options.setHostsAfterCurrent) {
  next.hostsAfterRestoredSha256 = currentHostsSha256();
}
if (options.notes !== undefined) {
  next.notes = options.notes;
}

if (next.status !== "pending") {
  requirePresent(next.tester, "tester");
  requirePresent(next.date, "date");
  requirePresent(next.environment.macOS, "environment.macOS");
  requirePresent(next.environment.hardware, "environment.hardware");
}

if (next.status === "pass" && next.hostsBeforeSha256 !== next.hostsAfterRestoredSha256) {
  fail("status pass requires hostsBeforeSha256 to equal hostsAfterRestoredSha256");
}

const serialized = `${JSON.stringify(next, null, 2)}\n`;
if (options.dryRun) {
  process.stdout.write(serialized);
} else {
  writeFileSync(resultPath, serialized);
  verifyResult();
  console.log(`Updated ${resultPath}: ${next.status}`);
}
