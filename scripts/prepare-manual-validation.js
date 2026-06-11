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

function fail(message) {
  console.error(`Manual validation preparation failed: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    writeBackup: false,
    allowEmptyHostsBackup: false,
    selfTest: false,
  };

  for (const arg of argv) {
    if (arg === "--write-backup") {
      options.writeBackup = true;
    } else if (arg === "--allow-empty-hosts-backup") {
      options.allowEmptyHostsBackup = true;
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
  npm run prepare:manual-validation
  npm run prepare:manual-validation -- --write-backup

Options:
  --write-backup                Copy /etc/hosts to the suggested backup path.
  --allow-empty-hosts-backup    Allow --write-backup when /etc/hosts is empty.
  --self-test                   Run script logic self-tests.
`);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function assertExists(path, label, exists = existsSync) {
  if (!exists(path)) {
    fail(`${label} not found at ${path}`);
  }
}

function loadManualResult(path, expectedVersion, expectedTag, readText = readFileSync) {
  const result = JSON.parse(readText(path, "utf8"));
  if (result.version !== expectedVersion || result.tag !== expectedTag) {
    fail(`manual result version/tag mismatch: ${result.version} ${result.tag}`);
  }
  return result;
}

function inspectHosts(hosts) {
  const size = hosts.length;
  return {
    size,
    digest: sha256(hosts),
    empty: size === 0,
  };
}

function ensureHostsBackupAllowed(hostsInfo, options) {
  if (options.writeBackup && hostsInfo.empty && !options.allowEmptyHostsBackup) {
    fail(
      `${hostsPath} is empty; refusing to write an empty validation backup. Restore or confirm the system hosts file first, or pass --allow-empty-hosts-backup if this is intentional.`,
    );
  }
}

function writeHostsBackup({ sourcePath, targetPath, hostsDigest }, io = {}) {
  const mkdir = io.mkdirSync ?? mkdirSync;
  const copy = io.copyFileSync ?? copyFileSync;
  const read = io.readFileSync ?? readFileSync;
  const stat = io.statSync ?? statSync;

  mkdir(dirname(targetPath), { recursive: true });
  copy(sourcePath, targetPath);
  const backup = read(targetPath);
  const backupDigest = sha256(backup);
  if (backupDigest !== hostsDigest) {
    fail(`backup digest mismatch: ${backupDigest} != ${hostsDigest}`);
  }
  return stat(targetPath).size;
}

function runSelfTest() {
  const nonEmpty = inspectHosts(Buffer.from("127.0.0.1 localhost\n"));
  if (nonEmpty.empty || nonEmpty.size !== 20) {
    fail("non-empty hosts self-test failed");
  }

  const empty = inspectHosts(Buffer.alloc(0));
  if (!empty.empty || empty.size !== 0) {
    fail("empty hosts self-test failed");
  }

  expectThrows("empty backup is blocked", () =>
    ensureHostsBackupAllowed(empty, {
      writeBackup: true,
      allowEmptyHostsBackup: false,
    }),
  );

  ensureHostsBackupAllowed(empty, {
    writeBackup: true,
    allowEmptyHostsBackup: true,
  });
  ensureHostsBackupAllowed(empty, {
    writeBackup: false,
    allowEmptyHostsBackup: false,
  });

  const result = loadManualResult(
    "result.json",
    "1.2.3",
    "v1.2.3",
    () => JSON.stringify({ version: "1.2.3", tag: "v1.2.3" }),
  );
  if (result.tag !== "v1.2.3") {
    fail("manual result self-test failed");
  }

  console.log("Manual validation preparation self-test passed");
}

function expectThrows(label, action) {
  const originalExit = process.exit;
  const originalError = console.error;
  let failed = false;
  process.exit = () => {
    throw new Error("__expected_exit__");
  };
  console.error = () => {};
  try {
    action();
  } catch (error) {
    if (error.message === "__expected_exit__") {
      failed = true;
    } else {
      throw error;
    }
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }
  if (!failed) {
    fail(`${label} expected failure`);
  }
}

const options = parseArgs(process.argv.slice(2));
if (options.selfTest) {
  runSelfTest();
  process.exit(0);
}

assertExists(resultPath, "manual validation result");
assertExists(checklistPath, "manual validation checklist");
assertExists(hostsPath, "hosts file");

const result = loadManualResult(resultPath, version, tag);
const hosts = readFileSync(hostsPath);
const hostsInfo = inspectHosts(hosts);
ensureHostsBackupAllowed(hostsInfo, options);

console.log(`Manual validation target: ${tag}`);
console.log(`Checklist: ${checklistPath}`);
console.log(`Result: ${resultPath}`);
console.log(`Release asset: ${result.asset}`);
console.log(`Release asset SHA-256: ${result.assetSha256 || "(pending)"}`);
console.log(`Read ${hostsPath}: ${hostsInfo.size} bytes`);
console.log(`Current ${hostsPath} SHA-256: ${hostsInfo.digest}`);
console.log(`Suggested hostsBeforeSha256: ${hostsInfo.digest}`);
console.log(`Suggested backup path: ${backupPath}`);

if (hostsInfo.empty) {
  console.warn(`Warning: ${hostsPath} is empty; confirm this is expected before testing writes`);
}

if (options.writeBackup) {
  const size = writeHostsBackup({
    sourcePath: hostsPath,
    targetPath: backupPath,
    hostsDigest: hostsInfo.digest,
  });
  console.log(`Wrote backup: ${backupPath} (${size} bytes)`);
} else {
  console.log("No backup file was written. Re-run with --write-backup to copy /etc/hosts.");
}

console.log("This command does not modify /etc/hosts.");
