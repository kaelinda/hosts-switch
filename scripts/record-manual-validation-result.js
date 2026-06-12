import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const version = packageJson.version;
const tag = `v${version}`;
const resultPath = `docs/release/manual-validation-${tag}.result.json`;
const hostsPath = "/etc/hosts";
const allowedStatuses = new Set(["pending", "pass", "fail"]);
const sha256Pattern = /^[a-f0-9]{64}$/;
const requiredChecks = [
  "status-bar-open-editor",
  "status-bar-menu-profiles",
  "status-bar-admin-prompt",
  "status-bar-active-node-noop",
  "admin-cancel-preserves-profile",
  "managed-block-only",
  "invalid-content-blocked",
  "native-json-roundtrip",
  "profiles-backup-restore",
  "delete-confirmation",
  "launch-at-login-system-setting",
  "global-shortcut-focuses-editor",
  "latest-backup-restore",
];

function fail(message) {
  console.error(`Manual validation result recording failed: ${message}`);
  process.exit(1);
}

function parseKeyValue(raw, label) {
  const separator = raw.indexOf("=");
  if (separator <= 0) {
    fail(`${label} must use key=value syntax`);
  }
  return [raw.slice(0, separator), raw.slice(separator + 1)];
}

function parseArgs(argv) {
  const options = {
    checks: [],
    checkNotes: [],
    setHostsBeforeCurrent: false,
    setHostsAfterCurrent: false,
    setEnvironmentCurrent: false,
    dryRun: false,
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

    if (arg === "--check") {
      options.checks.push(parseKeyValue(next(), "--check"));
    } else if (arg === "--check-note") {
      options.checkNotes.push(parseKeyValue(next(), "--check-note"));
    } else if (arg === "--status") {
      options.status = next();
    } else if (arg === "--tester") {
      options.tester = next();
    } else if (arg === "--date") {
      options.date = next();
    } else if (arg === "--macos") {
      options.macos = next();
    } else if (arg === "--hardware") {
      options.hardware = next();
    } else if (arg === "--hosts-before") {
      options.hostsBeforeSha256 = next();
    } else if (arg === "--hosts-after") {
      options.hostsAfterRestoredSha256 = next();
    } else if (arg === "--notes") {
      options.notes = next();
    } else if (arg === "--set-hosts-before-current") {
      options.setHostsBeforeCurrent = true;
    } else if (arg === "--set-hosts-after-current") {
      options.setHostsAfterCurrent = true;
    } else if (arg === "--set-environment-current") {
      options.setEnvironmentCurrent = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
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
  npm run record:manual-result -- --check status-bar-open-editor=pass --check-note status-bar-open-editor="opened from status-bar icon"
  npm run record:manual-result -- --status pass --tester "Name" --date 2026-06-12 --macos "macOS 15.5" --hardware "Apple Silicon" --hosts-before <sha256> --hosts-after <sha256>
  npm run record:manual-result -- --set-environment-current --set-hosts-before-current

Options:
  --check <id=pass|fail|pending>        Set one manual check status. Repeatable.
  --check-note <id=note>                Set evidence notes for one manual check. Required for pass/fail checks. Repeatable.
  --status <pending|pass|fail>          Override the derived overall status.
  --tester <name>                       Tester name for non-pending results.
  --date <date>                         Validation date for non-pending results.
  --macos <version>                     macOS environment for non-pending results.
  --hardware <description>              Hardware environment for non-pending results.
  --hosts-before <sha256>               Set hostsBeforeSha256.
  --hosts-after <sha256>                Set hostsAfterRestoredSha256.
  --set-hosts-before-current            Read current /etc/hosts and use its SHA-256 as hostsBeforeSha256.
  --set-hosts-after-current             Read current /etc/hosts and use its SHA-256 as hostsAfterRestoredSha256.
  --set-environment-current             Record the current macOS version and hardware model.
  --notes <text>                        Set top-level notes.
  --dry-run                             Print the updated JSON without writing.
  --self-test                           Run script logic self-tests.

Known check IDs:
${requiredChecks.map((checkId) => `  - ${checkId}`).join("\n")}
`);
}

function assertCheckId(checkId) {
  if (!requiredChecks.includes(checkId)) {
    fail(`unknown check id ${checkId}`);
  }
}

function assertStatus(status, label) {
  if (!allowedStatuses.has(status)) {
    fail(`${label} must be one of ${Array.from(allowedStatuses).join(", ")}`);
  }
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    fail(`${label} must be a lowercase SHA-256 digest`);
  }
}

function currentHostsSha256() {
  return createHash("sha256").update(readFileSync(hostsPath)).digest("hex");
}

function runSystemInfo(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    fail(`failed to read current environment using ${command} ${args.join(" ")}: ${error}`);
  }
}

function currentEnvironment() {
  const productName = runSystemInfo("sw_vers", ["-productName"]);
  const productVersion = runSystemInfo("sw_vers", ["-productVersion"]);
  const buildVersion = runSystemInfo("sw_vers", ["-buildVersion"]);
  const hardwareModel = runSystemInfo("sysctl", ["-n", "hw.model"]);
  const architecture = runSystemInfo("uname", ["-m"]);

  return {
    macOS: `${productName} ${productVersion} (${buildVersion})`,
    hardware: `${hardwareModel} ${architecture}`,
  };
}

function deriveStatus(checks) {
  const statuses = requiredChecks.map((checkId) => checks[checkId].status);
  if (statuses.includes("fail")) {
    return "fail";
  }
  if (statuses.every((status) => status === "pass")) {
    return "pass";
  }
  return "pending";
}

function requirePresent(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} is required when manual validation is not pending`);
  }
}

function requireCompletedCheckNotes(checks) {
  for (const checkId of requiredChecks) {
    const check = checks[checkId];
    if (
      check.status !== "pending" &&
      (typeof check.notes !== "string" || check.notes.trim().length === 0)
    ) {
      fail(`check ${checkId} notes are required when status is ${check.status}`);
    }
  }
}

function verifyResult() {
  execFileSync("node", ["scripts/verify-manual-validation-result.js"], {
    stdio: "inherit",
  });
}

function buildNextResult(
  result,
  options,
  readCurrentHostsSha256 = currentHostsSha256,
  readCurrentEnvironment = currentEnvironment,
) {
  if (result.version !== version || result.tag !== tag) {
    fail(`manual result version/tag mismatch: ${result.version} ${result.tag}`);
  }

  const next = {
    ...result,
    environment: {
      ...result.environment,
    },
    checks: Object.fromEntries(
      requiredChecks.map((checkId) => [
        checkId,
        {
          ...result.checks[checkId],
        },
      ]),
    ),
  };

  for (const [checkId, status] of options.checks) {
    assertCheckId(checkId);
    assertStatus(status, `check ${checkId} status`);
    next.checks[checkId].status = status;
  }

  for (const [checkId, note] of options.checkNotes) {
    assertCheckId(checkId);
    next.checks[checkId].notes = note;
  }

  if (options.status) {
    assertStatus(options.status, "result status");
    next.status = options.status;
  } else {
    next.status = deriveStatus(next.checks);
  }

  if (options.tester !== undefined) {
    next.tester = options.tester;
  }
  if (options.date !== undefined) {
    next.date = options.date;
  }
  if (options.setEnvironmentCurrent) {
    const environment = readCurrentEnvironment();
    next.environment.macOS = environment.macOS;
    next.environment.hardware = environment.hardware;
  }
  if (options.macos !== undefined) {
    next.environment.macOS = options.macos;
  }
  if (options.hardware !== undefined) {
    next.environment.hardware = options.hardware;
  }
  if (options.hostsBeforeSha256 !== undefined) {
    assertSha256(options.hostsBeforeSha256, "hostsBeforeSha256");
    next.hostsBeforeSha256 = options.hostsBeforeSha256;
  }
  if (options.hostsAfterRestoredSha256 !== undefined) {
    assertSha256(options.hostsAfterRestoredSha256, "hostsAfterRestoredSha256");
    next.hostsAfterRestoredSha256 = options.hostsAfterRestoredSha256;
  }
  if (options.setHostsBeforeCurrent) {
    next.hostsBeforeSha256 = readCurrentHostsSha256();
  }
  if (options.setHostsAfterCurrent) {
    next.hostsAfterRestoredSha256 = readCurrentHostsSha256();
  }
  if (options.notes !== undefined) {
    next.notes = options.notes;
  }

  if (next.status !== "pending") {
    requirePresent(next.tester, "tester");
    requirePresent(next.date, "date");
    requirePresent(next.environment.macOS, "environment.macOS");
    requirePresent(next.environment.hardware, "environment.hardware");
  }
  requireCompletedCheckNotes(next.checks);

  if (next.status === "pass" && next.hostsBeforeSha256 !== next.hostsAfterRestoredSha256) {
    fail("status pass requires hostsBeforeSha256 to equal hostsAfterRestoredSha256");
  }

  return next;
}

function sampleResult() {
  return {
    version,
    tag,
    commit: "a".repeat(40),
    releaseUrl: `https://github.com/kaelinda/hosts-switch/releases/tag/${tag}`,
    asset: `Hosts.Switch_${version}_aarch64.dmg`,
    assetSha256: "b".repeat(64),
    assetSize: 1,
    sha256Asset: "dmg.sha256",
    status: "pending",
    tester: "",
    date: "",
    environment: {
      macOS: "",
      hardware: "",
      source: "release-asset",
    },
    hostsBeforeSha256: "",
    hostsAfterRestoredSha256: "",
    checks: Object.fromEntries(
      requiredChecks.map((checkId) => [checkId, { status: "pending", notes: "" }]),
    ),
    notes: "",
  };
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

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} expected ${expected}, got ${actual}`);
  }
}

function assertIncludes(values, expected, label) {
  if (!values.includes(expected)) {
    fail(`${label} missing ${expected}`);
  }
}

function runSelfTest() {
  assertIncludes(
    requiredChecks,
    "profiles-backup-restore",
    "manual result recorder check ids",
  );

  const onePass = buildNextResult(sampleResult(), {
    checks: [["status-bar-open-editor", "pass"]],
    checkNotes: [["status-bar-open-editor", "opened from menu bar"]],
  });
  assertEqual(onePass.status, "pending", "one pass status");
  assertEqual(
    onePass.checks["status-bar-open-editor"].notes,
    "opened from menu bar",
    "check note",
  );

  const failed = buildNextResult(sampleResult(), {
    checks: [["managed-block-only", "fail"]],
    checkNotes: [["managed-block-only", "managed block changed unmanaged localhost"]],
    tester: "QA",
    date: "2026-06-12",
    macos: "macOS 15.5",
    hardware: "Apple Silicon",
  });
  assertEqual(failed.status, "fail", "failed status");

  const digest = "c".repeat(64);
  const allPass = buildNextResult(
    sampleResult(),
    {
      checks: requiredChecks.map((checkId) => [checkId, "pass"]),
      checkNotes: requiredChecks.map((checkId) => [checkId, `${checkId} evidence`]),
      tester: "QA",
      date: "2026-06-12",
      macos: "macOS 15.5",
      hardware: "Apple Silicon",
      hostsBeforeSha256: digest,
      hostsAfterRestoredSha256: digest,
    },
    () => digest,
  );
  assertEqual(allPass.status, "pass", "all pass status");

  const environment = buildNextResult(
    sampleResult(),
    {
      checks: [],
      checkNotes: [],
      setEnvironmentCurrent: true,
    },
    () => digest,
    () => ({
      macOS: "macOS 15.5 (24F74)",
      hardware: "Mac16,1 arm64",
    }),
  );
  assertEqual(environment.environment.macOS, "macOS 15.5 (24F74)", "current macOS");
  assertEqual(environment.environment.hardware, "Mac16,1 arm64", "current hardware");

  const explicitEnvironment = buildNextResult(
    sampleResult(),
    {
      checks: [],
      checkNotes: [],
      setEnvironmentCurrent: true,
      macos: "macOS override",
      hardware: "Hardware override",
    },
    () => digest,
    () => ({
      macOS: "macOS 15.5 (24F74)",
      hardware: "Mac16,1 arm64",
    }),
  );
  assertEqual(
    explicitEnvironment.environment.macOS,
    "macOS override",
    "explicit macOS overrides current macOS",
  );
  assertEqual(
    explicitEnvironment.environment.hardware,
    "Hardware override",
    "explicit hardware overrides current hardware",
  );

  expectThrows("missing tester", () =>
    buildNextResult(sampleResult(), {
      checks: [],
      checkNotes: [],
      status: "pass",
    }),
  );

  expectThrows("completed check missing notes", () =>
    buildNextResult(sampleResult(), {
      checks: [["status-bar-open-editor", "pass"]],
      checkNotes: [],
    }),
  );

  expectThrows("pass hash mismatch", () =>
    buildNextResult(sampleResult(), {
      checks: requiredChecks.map((checkId) => [checkId, "pass"]),
      checkNotes: requiredChecks.map((checkId) => [checkId, `${checkId} evidence`]),
      tester: "QA",
      date: "2026-06-12",
      macos: "macOS 15.5",
      hardware: "Apple Silicon",
      hostsBeforeSha256: "d".repeat(64),
      hostsAfterRestoredSha256: "e".repeat(64),
    }),
  );

  console.log("Manual result recording self-test passed");
}

const options = parseArgs(process.argv.slice(2));
if (options.selfTest) {
  runSelfTest();
  process.exit(0);
}

const result = JSON.parse(readFileSync(resultPath, "utf8"));
const next = buildNextResult(result, options);

const serialized = `${JSON.stringify(next, null, 2)}\n`;
if (options.dryRun) {
  process.stdout.write(serialized);
} else {
  writeFileSync(resultPath, serialized);
  verifyResult();
  console.log(`Updated ${resultPath}: ${next.status}`);
}
