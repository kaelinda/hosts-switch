import { existsSync, readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const version = packageJson.version;
const tag = `v${version}`;
const releaseAssetName = `Hosts.Switch_${version}_aarch64.dmg`;
const releaseNotesPath =
  process.env.HOSTS_SWITCH_RELEASE_NOTES_PATH ?? `docs/release/release-notes-${tag}.md`;
const resultPath = `docs/release/manual-validation-${tag}.result.json`;
const sha256Pattern = /^[a-f0-9]{64}$/;

function fail(message) {
  console.error(`Release notes verification failed: ${message}`);
  process.exit(1);
}

function assertIncludes(text, snippet, label) {
  if (!text.includes(snippet)) {
    fail(`${label} missing ${JSON.stringify(snippet)}`);
  }
}

function assertSha256(value, label) {
  if (!sha256Pattern.test(value)) {
    fail(`${label} must be a lowercase SHA-256 digest`);
  }
}

if (!existsSync(releaseNotesPath)) {
  fail(`release notes not found at ${releaseNotesPath}`);
}

const notes = readFileSync(releaseNotesPath, "utf8");
let result = null;
if (existsSync(resultPath)) {
  result = JSON.parse(readFileSync(resultPath, "utf8"));
}

if (result) {
  if (result.version !== version || result.tag !== tag) {
    fail(`manual validation result version/tag mismatch: ${result.version} ${result.tag}`);
  }
  if (result.asset && result.asset !== releaseAssetName) {
    fail(`manual validation result asset expected ${releaseAssetName}, got ${result.asset}`);
  }
}

for (const requiredText of [
  "## 中文版本说明",
  `Hosts Switch`,
  tag,
  "本版本重点：",
  "使用前请注意：",
  "真实 `/etc/hosts` 管理员写入",
  "manual validation checklist",
  "## English Summary",
  `Automated prerelease build for ${tag}.`,
  releaseAssetName,
  "This DMG is unsigned and not notarized.",
  "Real `/etc/hosts` administrator-write flows still require manual packaged-app validation",
]) {
  assertIncludes(notes, requiredText, "release notes");
}

const shaLines = notes.match(/^- SHA-256: .+$/gm) ?? [];
if (shaLines.length !== 1) {
  fail(`release notes must contain exactly one SHA-256 artifact line, got ${shaLines.length}`);
}

const expectedSha256 = process.env.HOSTS_SWITCH_RELEASE_SHA256 || result?.assetSha256 || "";
if (expectedSha256) {
  assertSha256(expectedSha256, "expected release SHA-256");
  assertIncludes(notes, expectedSha256, "release notes");
  if (notes.includes("pending until release publication")) {
    fail("release notes still contain the pending SHA-256 placeholder");
  }
} else if (!notes.includes("SHA-256: pending until release publication")) {
  const digestMatch = shaLines[0].match(/`([a-f0-9]{64})`/);
  if (!digestMatch) {
    fail("release notes SHA-256 line must contain a digest or the pending placeholder");
  }
}

console.log(`Verified release notes for ${tag}: ${releaseNotesPath}`);
