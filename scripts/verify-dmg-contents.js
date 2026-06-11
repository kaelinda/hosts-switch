import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const version = packageJson.version;
const dmgPath =
  process.env.HOSTS_SWITCH_DMG_PATH ??
  join("src-tauri", "target", "release", "bundle", "dmg", `Hosts Switch_${version}_aarch64.dmg`);
const appName = "Hosts Switch.app";

function fail(message) {
  console.error(`DMG verification failed: ${message}`);
  process.exit(1);
}

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8" }).trim();
  } catch (error) {
    fail(`${command} ${args.join(" ")} failed: ${error.stderr?.toString().trim() || error}`);
  }
}

function runWithInput(command, args, input) {
  try {
    return execFileSync(command, args, { encoding: "utf8", input }).trim();
  } catch (error) {
    fail(`${command} ${args.join(" ")} failed: ${error.stderr?.toString().trim() || error}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    fail(`${label} missing at ${path}`);
  }
}

function assertIncludes(text, snippet, label) {
  if (!text.includes(snippet)) {
    fail(`${label} missing ${JSON.stringify(snippet)}`);
  }
}

function attachDmg(path, mountRoot) {
  const output = run("hdiutil", [
    "attach",
    path,
    "-nobrowse",
    "-readonly",
    "-mountroot",
    mountRoot,
    "-plist",
  ]);
  const parsed = JSON.parse(runWithInput("plutil", ["-convert", "json", "-o", "-", "-"], output));
  const entities = Array.isArray(parsed["system-entities"]) ? parsed["system-entities"] : [];
  const mountPoint = entities.find((entity) => entity["mount-point"])?.["mount-point"];
  if (!mountPoint) {
    fail("mounted DMG did not report a mount point");
  }
  return mountPoint;
}

function detachDmg(mountPoint) {
  run("hdiutil", ["detach", mountPoint, "-quiet"]);
}

if (!existsSync(dmgPath)) {
  fail(`DMG not found at ${dmgPath}`);
}

const mountRoot = mkdtempSync(join(tmpdir(), "hosts-switch-dmg-"));
let mountPoint = null;
try {
  mountPoint = attachDmg(dmgPath, mountRoot);
  const appPath = join(mountPoint, appName);
  const infoPlistPath = join(appPath, "Contents", "Info.plist");
  const executablePath = join(appPath, "Contents", "MacOS", "hosts-switch");
  const iconPath = join(appPath, "Contents", "Resources", "icon.icns");

  assertExists(appPath, "DMG app bundle");
  assertExists(infoPlistPath, "DMG Info.plist");
  assertExists(executablePath, "DMG executable");
  assertExists(iconPath, "DMG icon");

  const info = JSON.parse(
    run("plutil", ["-convert", "json", "-o", "-", infoPlistPath]),
  );
  const fileInfo = run("file", [executablePath]);

  assertEqual(info.CFBundleDisplayName, tauriConfig.productName, "DMG display name");
  assertEqual(info.CFBundleName, tauriConfig.productName, "DMG bundle name");
  assertEqual(info.CFBundleIdentifier, tauriConfig.identifier, "DMG bundle identifier");
  assertEqual(info.CFBundleShortVersionString, version, "DMG short version");
  assertEqual(info.CFBundleVersion, version, "DMG bundle version");
  assertEqual(info.LSUIElement, true, "DMG LSUIElement");
  assertIncludes(fileInfo, "Mach-O", "DMG executable format");
  assertIncludes(fileInfo, "arm64", "DMG executable architecture");
} finally {
  if (mountPoint) {
    detachDmg(mountPoint);
  }
  rmSync(mountRoot, { recursive: true, force: true });
}

console.log(`Verified DMG contents for Hosts Switch ${version}: ${dmgPath}`);
