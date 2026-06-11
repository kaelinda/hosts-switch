import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const version = packageJson.version;
const tag = `v${version}`;
const resultPath = `docs/release/manual-validation-${tag}.result.json`;
const checklistPath = `docs/release/manual-validation-${tag}.md`;
const hostsPath = "/etc/hosts";
const backupPath = join(homedir(), `Desktop/hosts-before-hosts-switch-${tag}.txt`);
const shouldWriteBackup = process.argv.includes("--write-backup");

function fail(message) {
  console.error(`Manual validation preparation failed: ${message}`);
  process.exit(1);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    fail(`${label} not found at ${path}`);
  }
}

assertExists(resultPath, "manual validation result");
assertExists(checklistPath, "manual validation checklist");
assertExists(hostsPath, "hosts file");

const result = JSON.parse(readFileSync(resultPath, "utf8"));
if (result.version !== version || result.tag !== tag) {
  fail(`manual result version/tag mismatch: ${result.version} ${result.tag}`);
}

const hosts = readFileSync(hostsPath);
const hostsDigest = sha256(hosts);
const hostsSize = hosts.length;

console.log(`Manual validation target: ${tag}`);
console.log(`Checklist: ${checklistPath}`);
console.log(`Result: ${resultPath}`);
console.log(`Release asset: ${result.asset}`);
console.log(`Release asset SHA-256: ${result.assetSha256 || "(pending)"}`);
console.log(`Read ${hostsPath}: ${hostsSize} bytes`);
console.log(`Current ${hostsPath} SHA-256: ${hostsDigest}`);
console.log(`Suggested hostsBeforeSha256: ${hostsDigest}`);
console.log(`Suggested backup path: ${backupPath}`);

if (hostsSize === 0) {
  console.warn(`Warning: ${hostsPath} is empty; confirm this is expected before testing writes`);
}

if (shouldWriteBackup) {
  mkdirSync(dirname(backupPath), { recursive: true });
  copyFileSync(hostsPath, backupPath);
  const backup = readFileSync(backupPath);
  const backupDigest = sha256(backup);
  if (backupDigest !== hostsDigest) {
    fail(`backup digest mismatch: ${backupDigest} != ${hostsDigest}`);
  }
  const size = statSync(backupPath).size;
  console.log(`Wrote backup: ${backupPath} (${size} bytes)`);
} else {
  console.log("No backup file was written. Re-run with --write-backup to copy /etc/hosts.");
}

console.log("This command does not modify /etc/hosts.");
