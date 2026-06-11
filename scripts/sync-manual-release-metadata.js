import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const version = packageJson.version;
const tag = `v${version}`;
const resultPath = `docs/release/manual-validation-${tag}.result.json`;
const releaseAssetName = `Hosts.Switch_${version}_aarch64.dmg`;
const releaseUrl = `https://github.com/kaelinda/hosts-switch/releases/tag/${tag}`;

function fail(message) {
  console.error(`Manual release metadata sync failed: ${message}`);
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

function readTagCommit() {
  return run("git", ["rev-parse", `${tag}^{commit}`]);
}

const result = JSON.parse(readFileSync(resultPath, "utf8"));
const release = readReleaseJson();

if (release.tagName !== tag) {
  fail(`release tag expected ${tag}, got ${release.tagName}`);
}
if (release.url !== releaseUrl) {
  fail(`release URL expected ${releaseUrl}, got ${release.url}`);
}

const assets = Array.isArray(release.assets) ? release.assets : [];
const releaseAsset = assets.find((asset) => asset.name === releaseAssetName);
const shaAsset = assets.find((asset) => asset.name === "dmg.sha256");
if (!releaseAsset) {
  fail(`release is missing asset ${releaseAssetName}`);
}
if (!shaAsset) {
  fail("release is missing asset dmg.sha256");
}

const assetSha256 = normalizeDigest(releaseAsset.digest);
if (!assetSha256) {
  fail(`release asset ${releaseAssetName} is missing a SHA-256 digest`);
}
if (release.body && !release.body.includes(assetSha256)) {
  fail(`release body does not include digest ${assetSha256}`);
}
if (!Number.isInteger(releaseAsset.size) || releaseAsset.size <= 0) {
  fail(`release asset ${releaseAssetName} has invalid size ${releaseAsset.size}`);
}

const next = {
  ...result,
  version,
  tag,
  commit: readTagCommit(),
  releaseUrl,
  asset: releaseAssetName,
  assetSha256,
  assetSize: releaseAsset.size,
  sha256Asset: "dmg.sha256",
};

writeFileSync(resultPath, `${JSON.stringify(next, null, 2)}\n`);

console.log(
  `Synced ${resultPath}: ${releaseAssetName} ${assetSha256} (${releaseAsset.size} bytes)`,
);
