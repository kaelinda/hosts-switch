import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const version = packageJson.version;
const tag = `v${version}`;
const sourcePath = `docs/release/release-notes-${tag}.md`;
const outputPath = process.argv[2] ?? "release-notes.md";
const sha256 = process.env.HOSTS_SWITCH_RELEASE_SHA256;
const sha256Pattern = /^[a-f0-9]{64}$/;

function fail(message) {
  console.error(`Release notes rendering failed: ${message}`);
  process.exit(1);
}

if (!sha256 || !sha256Pattern.test(sha256)) {
  fail("HOSTS_SWITCH_RELEASE_SHA256 must be a lowercase SHA-256 digest");
}

const source = readFileSync(sourcePath, "utf8");
const rendered = source.replace(/^- SHA-256: .+$/m, `- SHA-256: \`${sha256}\``);
if (rendered === source && !source.includes(sha256)) {
  fail("could not replace the release SHA-256 line");
}

writeFileSync(outputPath, rendered);

execFileSync("node", ["scripts/verify-release-notes.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    HOSTS_SWITCH_RELEASE_NOTES_PATH: outputPath,
    HOSTS_SWITCH_RELEASE_SHA256: sha256,
  },
});

console.log(`Rendered release notes for ${tag}: ${outputPath}`);
