import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const version = packageJson.version;
const tag = `v${version}`;
const resultPath = `docs/release/manual-validation-${tag}.result.json`;
const releaseAssetName = `Hosts.Switch_${version}_aarch64.dmg`;
const shaAssetName = "dmg.sha256";
const releaseUrl = `https://github.com/kaelinda/hosts-switch/releases/tag/${tag}`;
const defaultOutputDir = join("manual-validation-artifacts", tag);
const sha256Pattern = /^[a-f0-9]{64}$/;

function fail(message) {
  console.error(`Manual release asset preparation failed: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    outputDir: defaultOutputDir,
    selfTest: false,
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

    if (arg === "--dir") {
      options.outputDir = next();
    } else if (arg === "--self-test") {
      options.selfTest = true;
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
  npm run prepare:manual-release-asset
  npm run prepare:manual-release-asset -- --dir manual-validation-artifacts/${tag}

Options:
  --dir <path>    Download the exact GitHub release DMG and dmg.sha256 into this directory.
  --self-test     Run script logic self-tests without network access.

This command downloads release assets only. It does not launch the app, mount the DMG, or modify /etc/hosts.
`);
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

function assertSha256(value, label) {
  if (!sha256Pattern.test(value)) {
    fail(`${label} must be a lowercase SHA-256 digest`);
  }
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseShaFile(content) {
  const line = content.trim().split(/\r?\n/)[0] ?? "";
  const [digest, ...pathParts] = line.split(/\s+/);
  const artifactPath = pathParts.join(" ");
  return { digest, artifactPath };
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

function downloadReleaseAssets(outputDir) {
  mkdirSync(outputDir, { recursive: true });
  for (const pattern of [releaseAssetName, shaAssetName]) {
    run("gh", [
      "release",
      "download",
      tag,
      "--repo",
      "kaelinda/hosts-switch",
      "--pattern",
      pattern,
      "--dir",
      outputDir,
      "--clobber",
    ]);
  }
}

function verifyPreparedAsset({ result, release, outputDir }) {
  assertEqual(result.version, version, "manual result version");
  assertEqual(result.tag, tag, "manual result tag");
  assertEqual(result.releaseUrl, releaseUrl, "manual result release URL");
  assertEqual(result.asset, releaseAssetName, "manual result release asset");
  assertEqual(result.sha256Asset, shaAssetName, "manual result sha256 asset");
  assertSha256(result.assetSha256, "manual result assetSha256");
  if (!Number.isInteger(result.assetSize) || result.assetSize <= 0) {
    fail(`manual result assetSize must be positive, got ${result.assetSize}`);
  }

  assertEqual(release.tagName, tag, "release tag");
  assertEqual(release.url, releaseUrl, "release URL");
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const releaseAsset = assets.find((asset) => asset.name === releaseAssetName);
  const shaAsset = assets.find((asset) => asset.name === shaAssetName);
  if (!releaseAsset) {
    fail(`release is missing asset ${releaseAssetName}`);
  }
  if (!shaAsset) {
    fail(`release is missing asset ${shaAssetName}`);
  }
  assertEqual(normalizeDigest(releaseAsset.digest), result.assetSha256, "release asset digest");
  assertEqual(releaseAsset.size, result.assetSize, "release asset size");
  if (release.body && !release.body.includes(result.assetSha256)) {
    fail(`release body does not include digest ${result.assetSha256}`);
  }

  const dmgPath = join(outputDir, releaseAssetName);
  const shaPath = join(outputDir, shaAssetName);
  if (!existsSync(dmgPath)) {
    fail(`downloaded DMG not found at ${dmgPath}`);
  }
  if (!existsSync(shaPath)) {
    fail(`downloaded ${shaAssetName} not found at ${shaPath}`);
  }

  const actualSize = statSync(dmgPath).size;
  const actualDigest = hashFile(dmgPath);
  const shaFile = parseShaFile(readFileSync(shaPath, "utf8"));
  assertEqual(actualDigest, result.assetSha256, "downloaded DMG SHA-256");
  assertEqual(actualSize, result.assetSize, "downloaded DMG size");
  assertEqual(shaFile.digest, result.assetSha256, `${shaAssetName} digest`);
  if (!shaFile.artifactPath.endsWith(releaseAssetName)) {
    fail(`${shaAssetName} path must end with ${releaseAssetName}, got ${shaFile.artifactPath}`);
  }

  return { dmgPath, shaPath, actualDigest, actualSize };
}

function runSelfTest() {
  const outputDir = mkdtempSync(join(tmpdir(), "hosts-switch-manual-asset-"));
  const dmgPath = join(outputDir, releaseAssetName);
  const shaPath = join(outputDir, shaAssetName);
  const payload = Buffer.from("fake release dmg\n");
  const digest = createHash("sha256").update(payload).digest("hex");
  writeFileSync(dmgPath, payload);
  writeFileSync(shaPath, `${digest}  ${releaseAssetName}\n`);

  const result = {
    version,
    tag,
    releaseUrl,
    asset: releaseAssetName,
    assetSha256: digest,
    assetSize: payload.length,
    sha256Asset: shaAssetName,
  };
  const release = {
    tagName: tag,
    url: releaseUrl,
    body: `SHA-256: ${digest}`,
    assets: [
      { name: releaseAssetName, digest: `sha256:${digest}`, size: payload.length },
      { name: shaAssetName, digest: `sha256:${"a".repeat(64)}`, size: 100 },
    ],
  };
  const verified = verifyPreparedAsset({ result, release, outputDir });
  assertEqual(verified.actualDigest, digest, "self-test digest");

  const parsed = parseShaFile(`${digest}  nested/${releaseAssetName}\n`);
  assertEqual(parsed.digest, digest, "self-test parsed digest");
  assertEqual(parsed.artifactPath, `nested/${releaseAssetName}`, "self-test parsed path");

  console.log("Manual release asset preparation self-test passed");
}

const options = parseArgs(process.argv.slice(2));
if (options.selfTest) {
  runSelfTest();
  process.exit(0);
}

const result = JSON.parse(readFileSync(resultPath, "utf8"));
const release = readReleaseJson();
downloadReleaseAssets(options.outputDir);
const verified = verifyPreparedAsset({ result, release, outputDir: options.outputDir });

console.log(`Prepared release asset for manual validation: ${verified.dmgPath}`);
console.log(`Verified ${releaseAssetName}: ${verified.actualDigest} (${verified.actualSize} bytes)`);
console.log(`Verified ${shaAssetName}: ${verified.shaPath}`);
console.log("Use this downloaded release DMG for packaged-app manual validation.");
