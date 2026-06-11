import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const version = packageJson.version;
const tag = `v${version}`;
const checklistPath = `docs/release/manual-validation-${tag}.md`;
const resultPath = `docs/release/manual-validation-${tag}.result.json`;
const releaseAssetName = `Hosts.Switch_${version}_aarch64.dmg`;
const releaseUrl = `https://github.com/kaelinda/hosts-switch/releases/tag/${tag}`;
const checklist = readFileSync(checklistPath, "utf8");
const result = JSON.parse(readFileSync(resultPath, "utf8"));

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

const allowedStatuses = new Set(["pending", "pass", "fail"]);
const sha256Pattern = /^[a-f0-9]{64}$/;

function fail(message) {
  console.error(`Manual validation result verification failed: ${message}`);
  process.exit(1);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertStatus(value, label) {
  if (!allowedStatuses.has(value)) {
    fail(`${label} must be one of ${Array.from(allowedStatuses).join(", ")}`);
  }
}

function assertPresent(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} is required when manual validation is ${result.status}`);
  }
}

function assertOptionalSha256(value, label) {
  if (typeof value !== "string") {
    fail(`${label} must be a string`);
  }
  if (value.length > 0 && !sha256Pattern.test(value)) {
    fail(`${label} must be a lowercase SHA-256 digest`);
  }
}

assertEqual(result.version, version, "result version");
assertEqual(result.tag, tag, "result tag");
assertEqual(result.releaseUrl, releaseUrl, "result release URL");
assertEqual(result.asset, releaseAssetName, "result release asset");
assertStatus(result.status, "result status");

if (!checklist.includes(resultPath)) {
  fail(`manual checklist must reference ${resultPath}`);
}

if (!result.checks || typeof result.checks !== "object" || Array.isArray(result.checks)) {
  fail("result checks must be an object");
}

const actualCheckIds = Object.keys(result.checks).sort();
const expectedCheckIds = [...requiredChecks].sort();
assertEqual(JSON.stringify(actualCheckIds), JSON.stringify(expectedCheckIds), "manual check ids");

let passCount = 0;
let failCount = 0;
let pendingCount = 0;
for (const checkId of requiredChecks) {
  const check = result.checks[checkId];
  if (!check || typeof check !== "object" || Array.isArray(check)) {
    fail(`check ${checkId} must be an object`);
  }
  assertStatus(check.status, `check ${checkId} status`);
  if (typeof check.notes !== "string") {
    fail(`check ${checkId} notes must be a string`);
  }
  if (check.status === "pass") {
    passCount += 1;
  } else if (check.status === "fail") {
    failCount += 1;
  } else {
    pendingCount += 1;
  }
}

if (result.status === "pass" && (passCount !== requiredChecks.length || failCount > 0 || pendingCount > 0)) {
  fail("result status pass requires every manual check to pass");
}

if (result.status === "fail" && failCount === 0) {
  fail("result status fail requires at least one failed manual check");
}

if (result.status === "pending" && failCount > 0) {
  fail("result status pending cannot include failed manual checks");
}

if (result.status !== "pending") {
  assertPresent(result.tester, "tester");
  assertPresent(result.date, "date");
  assertPresent(result.environment?.macOS, "environment.macOS");
  assertPresent(result.environment?.hardware, "environment.hardware");
}

assertEqual(result.environment?.source, "release-asset", "environment source");
assertOptionalSha256(result.hostsBeforeSha256, "hostsBeforeSha256");
assertOptionalSha256(result.hostsAfterRestoredSha256, "hostsAfterRestoredSha256");

if (result.status === "pass" && result.hostsBeforeSha256 !== result.hostsAfterRestoredSha256) {
  fail("passing manual validation requires hostsBeforeSha256 to match hostsAfterRestoredSha256");
}

if (process.env.HOSTS_SWITCH_REQUIRE_MANUAL_PASS === "1" && result.status !== "pass") {
  fail("HOSTS_SWITCH_REQUIRE_MANUAL_PASS=1 requires result status pass");
}

console.log(
  `Verified manual validation result for ${tag}: ${result.status} (${passCount} pass, ${pendingCount} pending, ${failCount} fail)`,
);
