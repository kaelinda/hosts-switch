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
const traySwitchRs = readFileSync("src-tauri/src/tray_switch.rs", "utf8");
const apiTs = readFileSync("src/api.ts", "utf8");
const appTsx = readFileSync("src/App.tsx", "utf8");
const systemPreferenceHydrationTs = readFileSync("src/systemPreferenceHydration.ts", "utf8");
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
assertIncludes(libRs, ".show_menu_on_left_click(false)", "Status-bar click behavior");
assertIncludes(libRs, ".on_menu_event", "Status-bar menu event handler");
assertIncludes(libRs, "tray_switch::handle_menu_event", "Status-bar menu dispatcher");
assertIncludes(libRs, ".on_tray_icon_event", "Status-bar icon click handler");
assertIncludes(libRs, "MouseButton::Left", "Status-bar left-click handling");
assertIncludes(libRs, "tray_switch::show_main_window", "Status-bar editor opener");
assertIncludes(libRs, "commands::apply_hosts", "Apply hosts command registration");
assertIncludes(libRs, "commands::export_profiles_to_file", "Native export command registration");
assertIncludes(libRs, "commands::import_profiles_from_file", "Native import command registration");
assertIncludes(traySwitchRs, "const SWITCH_PREFIX: &str = \"switch-node:\"", "Status-bar switch menu IDs");
assertIncludes(traySwitchRs, "const DISABLE_GROUP_PREFIX: &str = \"disable-group:\"", "Status-bar group disable menu IDs");
assertIncludes(traySwitchRs, "commands::apply_hosts_state", "Status-bar switch apply path");
assertIncludes(traySwitchRs, "disable_group_and_apply", "Status-bar group disable apply path");
assertIncludes(traySwitchRs, "\"hosts-switch://tray-status\"", "Status-bar switch event emission");
assertIncludes(apiTs, "export_profiles_to_file", "Frontend native export command call");
assertIncludes(apiTs, "import_profiles_from_file", "Frontend native import command call");
assertIncludes(apiTs, "listen<TrayStatusEvent>(\"hosts-switch://tray-status\"", "Frontend tray status listener");
assertIncludes(apiTs, "CommandOrControl+Shift+H", "Frontend global shortcut binding");
assertIncludes(appTsx, "hydrateGlobalShortcutPreference", "Startup global shortcut hydration");
assertIncludes(appTsx, "profileReplaceConfirmation", "Profile replacement confirmation");
assertIncludes(appTsx, "Restore profiles cancelled", "Restore profiles cancellation handling");
assertIncludes(appTsx, "Import cancelled", "Profile import cancellation handling");
assertIncludes(systemPreferenceHydrationTs, "syncPreference(loaded)", "Startup global shortcut registration");
assertIncludes(systemPreferenceHydrationTs, "Could not register global shortcut", "Startup global shortcut failure handling");
assertNotIncludes(apiTs, "@tauri-apps/plugin-fs", "Frontend dependency surface");
assertNotIncludes(apiTs, "@tauri-apps/plugin-dialog", "Frontend dependency surface");
assertNotIncludes(cargoToml, "tauri-plugin-fs", "Direct Rust dependency surface");

const requiredPermissions = [
  "core:default",
  "autostart:allow-enable",
  "autostart:allow-disable",
  "autostart:allow-is-enabled",
  "global-shortcut:allow-is-registered",
  "global-shortcut:allow-register",
  "global-shortcut:allow-unregister",
];
for (const permission of requiredPermissions) {
  if (!defaultCapability.permissions.includes(permission)) {
    fail(`Default capability is missing ${permission}`);
  }
}

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
