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

function normalizeDigest(digest) {
  if (typeof digest !== "string") {
    return null;
  }
  return digest.startsWith("sha256:") ? digest.slice("sha256:".length) : digest;
}

function inspectReleaseJson(releaseJson) {
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
  const releaseAssetDigest = normalizeDigest(releaseAsset.digest);
  if (!releaseAssetDigest) {
    fail(`release JSON asset ${releaseAssetName} is missing a sha256 digest`);
  }
  if (releaseJson.body && !releaseJson.body.includes(releaseAssetDigest)) {
    fail(`release body does not include digest ${releaseAssetDigest}`);
  }
  return releaseAssetDigest;
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

function inspectHostsContent(hosts) {
  const warnings = [];
  const activeLines = hosts
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (hosts.length === 0) {
    warnings.push(`${hostsPath} is empty; confirm this is expected before testing hosts writes`);
    return warnings;
  }

  if (activeLines.length === 0) {
    warnings.push(`${hostsPath} has no active host entries after comments and blank lines`);
  }

  const hasLocalhost = activeLines.some((line) => /\blocalhost\b/i.test(line));
  const hasIpv4Localhost = activeLines.some((line) => /^127\.0\.0\.1\s+.*\blocalhost\b/i.test(line));
  const hasIpv6Localhost = activeLines.some((line) => /^::1\s+.*\blocalhost\b/i.test(line));

  if (!hasLocalhost) {
    warnings.push(`${hostsPath} does not contain an active localhost entry`);
  } else if (!hasIpv4Localhost && !hasIpv6Localhost) {
    warnings.push(`${hostsPath} contains localhost, but not on a common 127.0.0.1 or ::1 entry`);
  }

  return warnings;
}

function runSelfTest() {
  const cases = [
    {
      name: "empty hosts warns",
      hosts: "",
      expected: ["is empty"],
    },
    {
      name: "comment-only hosts warns",
      hosts: "# comment\n\n",
      expected: ["no active host entries", "does not contain an active localhost entry"],
    },
    {
      name: "nonstandard localhost warns",
      hosts: "10.0.0.2 localhost\n",
      expected: ["not on a common 127.0.0.1 or ::1 entry"],
    },
    {
      name: "standard localhost does not warn",
      hosts: "127.0.0.1 localhost\n::1 localhost\n",
      expected: [],
    },
  ];

  for (const testCase of cases) {
    const warnings = inspectHostsContent(testCase.hosts);
    for (const expected of testCase.expected) {
      if (!warnings.some((message) => message.includes(expected))) {
        fail(`${testCase.name} missing warning ${JSON.stringify(expected)}`);
      }
    }
    if (testCase.expected.length === 0 && warnings.length > 0) {
      fail(`${testCase.name} expected no warnings, got ${warnings.join("; ")}`);
    }
  }

  const digest = inspectReleaseJson({
    tagName: tag,
    body: "SHA-256: abc123",
    assets: [
      { name: releaseAssetName, digest: "sha256:abc123" },
      { name: "dmg.sha256", digest: "sha256:def456" },
    ],
  });
  if (digest !== "abc123") {
    fail(`release JSON digest self-test expected abc123, got ${digest}`);
  }

  console.log(`Manual readiness self-test passed (${cases.length} cases)`);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
  process.exit(0);
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
  for (const message of inspectHostsContent(hosts)) {
    warn(message);
  }
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
  const releaseAssetDigest = inspectReleaseJson(releaseJson);
  console.log(`Release asset found: ${releaseAssetName}`);
  console.log(`Release asset digest: ${releaseAssetDigest}`);
}

console.log(`Manual validation checklist: ${checklistPath}`);
console.log(`Suggested hosts backup path: ${backupSuggestion}`);
console.log("Manual readiness verification is read-only and does not modify /etc/hosts");
