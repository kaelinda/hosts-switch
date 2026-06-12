import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const cargoToml = readFileSync("src-tauri/Cargo.toml", "utf8");
const cargoLock = readFileSync("src-tauri/Cargo.lock", "utf8");
const readme = readFileSync("README.md", "utf8");

const version = packageJson.version;
const expectedTag = `v${version}`;
const expectedDmgName = `Hosts Switch_${version}_aarch64.dmg`;
const expectedReleaseAssetName = `Hosts.Switch_${version}_aarch64.dmg`;
const expectedReadmePath = `src-tauri/target/release/bundle/dmg/${expectedDmgName}`;
const expectedReleaseNotesPath = `docs/release/release-notes-${expectedTag}.md`;

function fail(message) {
  console.error(`Release version verification failed: ${message}`);
  process.exit(1);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(text, snippet, label) {
  if (!text.includes(snippet)) {
    fail(`${label} missing ${JSON.stringify(snippet)}`);
  }
}

assertEqual(packageLock.version, version, "package-lock root version");
assertEqual(packageLock.packages?.[""]?.version, version, "package-lock workspace version");
assertEqual(tauriConfig.version, version, "Tauri version");
assertIncludes(cargoToml, `version = "${version}"`, "Cargo manifest version");
assertIncludes(
  cargoLock,
  `name = "hosts-switch"\nversion = "${version}"`,
  "Cargo lock hosts-switch version",
);
assertIncludes(readme, expectedReadmePath, "README DMG path");
assertIncludes(readme, expectedReleaseNotesPath, "README release notes path");
assertIncludes(readme, "npm run print:hosts-recovery", "README hosts recovery command");
assertIncludes(readme, "Single-instance guard", "README single-instance feature");

const releaseTag = process.env.HOSTS_SWITCH_RELEASE_TAG;
if (releaseTag) {
  assertEqual(releaseTag, expectedTag, "release tag");
}

const dmgPath = process.env.HOSTS_SWITCH_DMG_PATH;
if (dmgPath) {
  assertEqual(basename(dmgPath), expectedDmgName, "DMG artifact name");
} else {
  const localDmgPath = join("src-tauri/target/release/bundle/dmg", expectedDmgName);
  if (existsSync(localDmgPath)) {
    assertEqual(basename(localDmgPath), expectedDmgName, "local DMG artifact name");
  }
}

const releaseAssetPath = process.env.HOSTS_SWITCH_RELEASE_ASSET_PATH;
if (releaseAssetPath) {
  assertEqual(
    basename(releaseAssetPath),
    expectedReleaseAssetName,
    "release asset artifact name",
  );
}

console.log(`Verified release version ${version}`);
