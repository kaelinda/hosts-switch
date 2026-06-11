import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const version = packageJson.version;
const tag = `v${version}`;
const checklistPath = `docs/release/manual-validation-${tag}.md`;
const releaseAssetName = `Hosts.Switch_${version}_aarch64.dmg`;
const localDmgName = `Hosts Switch_${version}_aarch64.dmg`;
const localDmgPath = join("src-tauri", "target", "release", "bundle", "dmg", localDmgName);
const releaseAssetPath = join("src-tauri", "target", "release", "bundle", "dmg", releaseAssetName);
const hostsPath = "/etc/hosts";
const backupSuggestion = join(homedir(), `Desktop/hosts-before-hosts-switch-${tag}.txt`);

function fail(message) {
  console.error(`Manual readiness verification failed: ${message}`);
  process.exit(1);
}

function warn(message) {
  console.warn(`Warning: ${message}`);
}

function assertIncludes(text, snippet, label) {
  if (!text.includes(snippet)) {
    fail(`${label} missing ${JSON.stringify(snippet)}`);
  }
}

function readOptionalReleaseJson() {
  const raw = process.env.HOSTS_SWITCH_RELEASE_JSON;
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`HOSTS_SWITCH_RELEASE_JSON is not valid JSON: ${error}`);
  }
}

function listHostsSwitchProcesses() {
  try {
    return execFileSync("pgrep", ["-fl", "Hosts Switch.app|MacOS/Hosts Switch|/hosts-switch($| )"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

if (!existsSync(checklistPath)) {
  fail(`manual checklist not found at ${checklistPath}`);
}

const checklist = readFileSync(checklistPath, "utf8");
assertIncludes(checklist, `Tag: \`${tag}\``, "manual checklist");
assertIncludes(checklist, `Release asset: \`${releaseAssetName}\``, "manual checklist");
assertIncludes(checklist, `Local bundle name: \`${localDmgName}\``, "manual checklist");
assertIncludes(checklist, `https://github.com/kaelinda/hosts-switch/releases/tag/${tag}`, "manual checklist");

if (!existsSync(hostsPath)) {
  fail(`${hostsPath} does not exist`);
}

try {
  const hosts = readFileSync(hostsPath, "utf8");
  console.log(`Read ${hostsPath}: ${hosts.length} bytes`);
} catch (error) {
  fail(`cannot read ${hostsPath}: ${error}`);
}

const processes = listHostsSwitchProcesses();
if (processes.length > 0) {
  warn(`Hosts Switch appears to be running:\n${processes.join("\n")}`);
} else {
  console.log("No running Hosts Switch process detected");
}

if (existsSync(localDmgPath)) {
  const size = statSync(localDmgPath).size;
  console.log(`Local DMG exists: ${localDmgPath} (${size} bytes)`);
} else {
  warn(`local DMG not found at ${localDmgPath}; use the GitHub release asset for manual validation`);
}

if (existsSync(releaseAssetPath)) {
  warn(`release-named DMG exists locally at ${releaseAssetPath}; ensure you test the intended artifact`);
}

const releaseJson = readOptionalReleaseJson();
if (releaseJson) {
  if (releaseJson.tagName !== tag) {
    fail(`release tag expected ${tag}, got ${releaseJson.tagName}`);
  }
  const assets = Array.isArray(releaseJson.assets) ? releaseJson.assets : [];
  const releaseAsset = assets.find((asset) => asset.name === releaseAssetName);
  const shaAsset = assets.find((asset) => asset.name === "dmg.sha256");
  if (!releaseAsset) {
    fail(`release JSON is missing asset ${releaseAssetName}`);
  }
  if (!shaAsset) {
    fail("release JSON is missing asset dmg.sha256");
  }
  console.log(`Release asset found: ${releaseAssetName}`);
}

console.log(`Manual validation checklist: ${checklistPath}`);
console.log(`Suggested hosts backup path: ${backupSuggestion}`);
console.log("Manual readiness verification is read-only and does not modify /etc/hosts");
