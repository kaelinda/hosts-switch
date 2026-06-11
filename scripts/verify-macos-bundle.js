import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const appPath = "src-tauri/target/release/bundle/macos/Hosts Switch.app";
const infoPlistPath = join(appPath, "Contents", "Info.plist");
const executablePath = join(appPath, "Contents", "MacOS", "hosts-switch");

function fail(message) {
  console.error(`Bundle verification failed: ${message}`);
  process.exit(1);
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

assertExists(infoPlistPath, "Info.plist");
assertExists(executablePath, "Executable");

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const info = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", infoPlistPath], {
  encoding: "utf8",
}));

const mainWindow = tauriConfig.app?.windows?.find((windowConfig) => windowConfig.label === "main");
if (!mainWindow) {
  fail("main window config not found");
}

assertEqual(packageJson.version, tauriConfig.version, "package and Tauri version");
assertEqual(info.CFBundleDisplayName, tauriConfig.productName, "display name");
assertEqual(info.CFBundleName, tauriConfig.productName, "bundle name");
assertEqual(info.CFBundleIdentifier, tauriConfig.identifier, "bundle identifier");
assertEqual(info.CFBundleShortVersionString, packageJson.version, "short version");
assertEqual(info.CFBundleVersion, packageJson.version, "bundle version");
assertEqual(info.LSUIElement, true, "LSUIElement");
assertEqual(info.LSMinimumSystemVersion, tauriConfig.bundle.macOS.minimumSystemVersion, "minimum macOS version");
assertEqual(mainWindow.visible, false, "main window visible on launch");

console.log(`Verified macOS bundle metadata for ${tauriConfig.productName} ${packageJson.version}`);
