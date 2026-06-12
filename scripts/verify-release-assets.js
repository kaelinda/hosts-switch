import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const version = packageJson.version;
const tag = `v${version}`;
const releaseAssetName = `Hosts.Switch_${version}_aarch64.dmg`;
const resultPath = `docs/release/manual-validation-${tag}.result.json`;
const releaseNotesPath = `docs/release/release-notes-${tag}.md`;
const releaseUrl = `https://github.com/kaelinda/hosts-switch/releases/tag/${tag}`;
const result = JSON.parse(readFileSync(resultPath, "utf8"));
const releaseNotes = readFileSync(releaseNotesPath, "utf8");

function fail(message) {
  console.error(`Release asset verification failed: ${message}`);
  process.exit(1);
}

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8" }).trim();
  } catch (error) {
    fail(`${command} ${args.join(" ")} failed: ${error.stderr?.toString().trim() || error}`);
  }
}

function normalizeDigest(digest) {
  if (typeof digest !== "string") {
    return null;
  }
  return digest.startsWith("sha256:") ? digest.slice("sha256:".length) : digest;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function normalizeText(text) {
  return text.replace(/\r\n/g, "\n").trimEnd();
}

function readReleaseJson() {
  const raw = run("gh", [
    "release",
    "view",
    tag,
    "--repo",
    "kaelinda/hosts-switch",
    "--json",
    "tagName,url,assets,body",
  ]);
  return JSON.parse(raw);
}

function downloadShaAsset() {
  const dir = mkdtempSync(join(tmpdir(), "hosts-switch-release-assets-"));
  run("gh", [
    "release",
    "download",
    tag,
    "--repo",
    "kaelinda/hosts-switch",
    "--pattern",
    "dmg.sha256",
    "--dir",
    dir,
    "--clobber",
  ]);
  return readFileSync(join(dir, "dmg.sha256"), "utf8").trim();
}

assertEqual(result.version, version, "result version");
assertEqual(result.tag, tag, "result tag");
assertEqual(result.releaseUrl, releaseUrl, "result release URL");
assertEqual(result.asset, releaseAssetName, "result release asset");
assertEqual(result.sha256Asset, "dmg.sha256", "result sha256 asset");

const release = readReleaseJson();
assertEqual(release.tagName, tag, "release tag");
assertEqual(release.url, releaseUrl, "release URL");

const assets = Array.isArray(release.assets) ? release.assets : [];
const releaseAsset = assets.find((asset) => asset.name === releaseAssetName);
const shaAsset = assets.find((asset) => asset.name === "dmg.sha256");
if (!releaseAsset) {
  fail(`release is missing asset ${releaseAssetName}`);
}
if (!shaAsset) {
  fail("release is missing asset dmg.sha256");
}

const releaseDigest = normalizeDigest(releaseAsset.digest);
const shaAssetDigest = normalizeDigest(shaAsset.digest);
assertEqual(releaseDigest, result.assetSha256, "release asset digest");
assertEqual(releaseAsset.size, result.assetSize, "release asset size");
if (!shaAssetDigest) {
  fail("dmg.sha256 asset is missing a digest");
}
if (release.body && !release.body.includes(result.assetSha256)) {
  fail(`release body does not include digest ${result.assetSha256}`);
}
if (!release.body || !release.body.includes("## 中文版本说明")) {
  fail("release body is missing the Chinese release notes heading");
}
if (!release.body.includes("真实 `/etc/hosts` 管理员写入")) {
  fail("release body is missing the Chinese manual-validation warning");
}

const expectedReleaseBody = releaseNotes.replace(
  /^- SHA-256: .+$/m,
  `- SHA-256: \`${result.assetSha256}\``,
);
assertEqual(
  normalizeText(release.body),
  normalizeText(expectedReleaseBody),
  "release body",
);

const shaFile = downloadShaAsset();
const [shaFileDigest, ...shaFilePathParts] = shaFile.split(/\s+/);
const shaFilePath = shaFilePathParts.join(" ");
assertEqual(shaFileDigest, result.assetSha256, "dmg.sha256 digest");
if (!shaFilePath.endsWith(releaseAssetName)) {
  fail(`dmg.sha256 path must end with ${releaseAssetName}, got ${shaFilePath}`);
}

console.log(
  `Verified release assets for ${tag}: ${releaseAssetName} ${result.assetSha256}`,
);
