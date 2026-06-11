import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const appPath = "src-tauri/target/release/bundle/macos/Hosts Switch.app";
const infoPlistPath = join(appPath, "Contents", "Info.plist");
const executablePath = join(appPath, "Contents", "MacOS", "hosts-switch");
const iconPath = join(appPath, "Contents", "Resources", "icon.icns");

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

function assertIncludes(text, snippet, label) {
  if (!text.includes(snippet)) {
    fail(`${label} missing ${JSON.stringify(snippet)}`);
  }
}

function assertNotIncludes(text, snippet, label) {
  if (text.includes(snippet)) {
    fail(`${label} unexpectedly includes ${JSON.stringify(snippet)}`);
  }
}

assertExists(infoPlistPath, "Info.plist");
assertExists(executablePath, "Executable");
assertExists(iconPath, "Bundle icon");

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const defaultCapability = JSON.parse(readFileSync("src-tauri/capabilities/default.json", "utf8"));
const generatedCapabilities = JSON.parse(readFileSync("src-tauri/gen/schemas/capabilities.json", "utf8"));
const libRs = readFileSync("src-tauri/src/lib.rs", "utf8");
const apiTs = readFileSync("src/api.ts", "utf8");
const cargoToml = readFileSync("src-tauri/Cargo.toml", "utf8");
const info = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", infoPlistPath], {
  encoding: "utf8",
}));
const fileInfo = execFileSync("file", [executablePath], { encoding: "utf8" });

const mainWindow = tauriConfig.app?.windows?.find((windowConfig) => windowConfig.label === "main");
if (!mainWindow) {
  fail("main window config not found");
}

assertEqual(packageJson.version, tauriConfig.version, "package and Tauri version");
assertEqual(packageLock.version, packageJson.version, "package-lock root version");
assertEqual(packageLock.packages?.[""]?.version, packageJson.version, "package-lock workspace version");
assertEqual(info.CFBundleDisplayName, tauriConfig.productName, "display name");
assertEqual(info.CFBundleName, tauriConfig.productName, "bundle name");
assertEqual(info.CFBundleIdentifier, tauriConfig.identifier, "bundle identifier");
assertEqual(info.CFBundleShortVersionString, packageJson.version, "short version");
assertEqual(info.CFBundleVersion, packageJson.version, "bundle version");
assertEqual(info.LSUIElement, true, "LSUIElement");
assertEqual(info.LSMinimumSystemVersion, tauriConfig.bundle.macOS.minimumSystemVersion, "minimum macOS version");
assertEqual(mainWindow.visible, false, "main window visible on launch");
assertEqual(tauriConfig.app?.withGlobalTauri, false, "global Tauri API exposure");

assertIncludes(fileInfo, "Mach-O", "Executable format");
assertIncludes(fileInfo, "arm64", "Executable architecture");
assertIncludes(libRs, "TrayIconBuilder::with_id(\"main\")", "Status-bar tray registration");
assertIncludes(libRs, "commands::apply_hosts", "Apply hosts command registration");
assertIncludes(libRs, "commands::export_profiles_to_file", "Native export command registration");
assertIncludes(libRs, "commands::import_profiles_from_file", "Native import command registration");
assertIncludes(apiTs, "export_profiles_to_file", "Frontend native export command call");
assertIncludes(apiTs, "import_profiles_from_file", "Frontend native import command call");
assertNotIncludes(apiTs, "@tauri-apps/plugin-fs", "Frontend dependency surface");
assertNotIncludes(apiTs, "@tauri-apps/plugin-dialog", "Frontend dependency surface");
assertNotIncludes(cargoToml, "tauri-plugin-fs", "Direct Rust dependency surface");

const deniedPermissions = [
  "dialog:allow-open",
  "dialog:allow-save",
  "fs:allow-read-text-file",
  "fs:allow-write-text-file",
];
for (const permission of deniedPermissions) {
  if (defaultCapability.permissions.includes(permission)) {
    fail(`Default capability grants ${permission}`);
  }
  if (generatedCapabilities.default?.permissions?.includes(permission)) {
    fail(`Generated capability grants ${permission}`);
  }
}

console.log(`Verified packaged macOS app for ${tauriConfig.productName} ${packageJson.version}`);
