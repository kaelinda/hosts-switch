import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const readme = readFileSync("README.md", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const version = packageJson.version;
const checklistPath = `docs/release/manual-validation-v${version}.md`;
const checklist = readFileSync(checklistPath, "utf8");
const help = execFileSync("node", ["scripts/record-manual-validation-result.js", "--help"], {
  encoding: "utf8",
});
const prepareReleaseAssetHelp = execFileSync(
  "node",
  ["scripts/prepare-manual-release-asset.js", "--help"],
  {
    encoding: "utf8",
  },
);

function fail(message) {
  console.error(`Manual recording help verification failed: ${message}`);
  process.exit(1);
}

function assertIncludes(text, snippet, label) {
  if (!text.includes(snippet)) {
    fail(`${label} missing ${JSON.stringify(snippet)}`);
  }
}

for (const [label, text] of [
  ["README", readme],
  ["manual checklist", checklist],
  ["recording help", help],
]) {
  assertIncludes(text, "--check-note", label);
  assertIncludes(text, "--set-environment-current", label);
  assertIncludes(text, "evidence", label);
}

assertIncludes(
  help,
  "--check-note <id=note>                Set evidence notes for one manual check. Required for pass/fail checks. Repeatable.",
  "recording help",
);
assertIncludes(
  help,
  "--set-environment-current             Record the current macOS version and hardware model.",
  "recording help",
);

assertIncludes(prepareReleaseAssetHelp, "download", "release asset preparation help");
assertIncludes(prepareReleaseAssetHelp, "does not launch the app", "release asset preparation help");
assertIncludes(prepareReleaseAssetHelp, "modify /etc/hosts", "release asset preparation help");

console.log("Verified manual result recording help");
