import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import {
  isRegistered as isGlobalShortcutRegistered,
  register as registerGlobalShortcut,
  unregister as unregisterGlobalShortcut,
} from "@tauri-apps/plugin-global-shortcut";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  demoHostsFile,
  defaultAppState,
  extractManagedBlock,
  mergeHostsFile,
  normalizeState,
  parseManagedBlockAsState,
  renderManagedBlock,
  validateHostsState as validateBrowserHostsState,
} from "./hostsPreview";
import type { AppState, HostsSnapshot, ValidationIssue } from "./types";

const browserStoreKey = "hosts-switch.browser-state";
const browserHostsKey = "hosts-switch.browser-hosts";
const browserHostsBackupKey = "hosts-switch.browser-hosts-backup";
const emptyHostsApplyMessage =
  "Current /etc/hosts is empty. Restore or confirm the system hosts file before applying changes.";

const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

export const runtimeLabel = isTauri ? "Tauri runtime" : "Browser demo";

export const openEditorShortcut = "CommandOrControl+Shift+H";

export type TrayStatusEvent = {
  state?: AppState | null;
  status: string;
  error?: string | null;
};

export async function loadAppState(): Promise<AppState> {
  if (isTauri) {
    return invoke<AppState>("load_app_state");
  }

  const stored = window.localStorage.getItem(browserStoreKey);
  if (!stored) {
    const state = defaultAppState();
    window.localStorage.setItem(browserStoreKey, JSON.stringify(state));
    return state;
  }

  try {
    return normalizeState(JSON.parse(stored) as AppState);
  } catch {
    const state = defaultAppState();
    window.localStorage.setItem(browserStoreKey, JSON.stringify(state));
    return state;
  }
}

export async function saveAppState(state: AppState): Promise<AppState> {
  if (isTauri) {
    return invoke<AppState>("save_app_state", { state });
  }

  const normalized = normalizeState(state);
  window.localStorage.setItem(browserStoreKey, JSON.stringify(normalized));
  return normalized;
}

export async function syncLaunchAtLoginPreference(state: AppState): Promise<boolean> {
  if (!isTauri) {
    return normalizeState(state).preferences.launchAtLogin;
  }

  if (state.preferences.launchAtLogin) {
    await enableAutostart();
  } else {
    await disableAutostart();
  }

  return isAutostartEnabled();
}

export async function readLaunchAtLoginStatus(): Promise<boolean | null> {
  if (!isTauri) {
    return null;
  }

  return isAutostartEnabled();
}

export async function syncGlobalShortcutPreference(state: AppState): Promise<boolean> {
  if (!isTauri) {
    return normalizeState(state).preferences.enableGlobalShortcut;
  }

  const registered = await isGlobalShortcutRegistered(openEditorShortcut);
  if (state.preferences.enableGlobalShortcut) {
    if (!registered) {
      await registerGlobalShortcut(openEditorShortcut, (event) => {
        if (event.state === "Pressed") {
          void showEditorWindow();
        }
      });
    }
    return true;
  }

  if (registered) {
    await unregisterGlobalShortcut(openEditorShortcut);
  }
  return false;
}

export async function readGlobalShortcutStatus(): Promise<boolean | null> {
  if (!isTauri) {
    return null;
  }

  return isGlobalShortcutRegistered(openEditorShortcut);
}

async function showEditorWindow() {
  const appWindow = getCurrentWindow();
  await appWindow.unminimize();
  await appWindow.show();
  await appWindow.setFocus();
}

export async function exportProfiles(state: AppState): Promise<string> {
  if (isTauri) {
    return invoke<string>("export_profiles", { state });
  }

  return JSON.stringify(normalizeState(state), null, 2);
}

export async function importProfiles(raw: string): Promise<AppState> {
  if (isTauri) {
    return invoke<AppState>("import_profiles", { raw });
  }

  const normalized = parseProfilesJson(raw);
  window.localStorage.setItem(browserStoreKey, JSON.stringify(normalized));
  return normalized;
}

export function parseProfilesJson(raw: string): AppState {
  return normalizeState(JSON.parse(raw) as AppState);
}

export function supportsNativeProfileFiles(): boolean {
  return isTauri;
}

export async function exportProfilesToFile(state: AppState): Promise<boolean> {
  if (!isTauri) {
    return false;
  }

  return invoke<boolean>("export_profiles_to_file", { state });
}

export async function importProfilesFromFile(): Promise<AppState | null> {
  if (!isTauri) {
    return null;
  }

  return invoke<AppState | null>("import_profiles_from_file");
}

export async function readHostsSnapshot(state: AppState): Promise<HostsSnapshot> {
  if (isTauri) {
    return invoke<HostsSnapshot>("read_hosts_snapshot", { state });
  }

  const current = browserHosts();
  return {
    current,
    managed: extractManagedBlock(current),
    preview: mergeHostsFile(current, renderManagedBlock(normalizeState(state))),
  };
}

export async function previewHosts(state: AppState): Promise<string> {
  if (isTauri) {
    return invoke<string>("preview_hosts", { state });
  }

  return mergeHostsFile(browserHosts(), renderManagedBlock(normalizeState(state)));
}

export async function validateHostsState(state: AppState): Promise<ValidationIssue[]> {
  if (isTauri) {
    return invoke<ValidationIssue[]>("validate_hosts_state", { state });
  }

  return validateBrowserHostsState(normalizeState(state));
}

export async function applyHosts(state: AppState): Promise<AppState> {
  if (isTauri) {
    return invoke<AppState>("apply_hosts", { state });
  }

  const normalized = normalizeState(state);
  const issues = validateBrowserHostsState(normalized);
  if (issues.length > 0) {
    const issue = issues[0];
    throw new Error(
      `${issue.groupName} / ${issue.nodeName} line ${issue.lineNumber}: ${issue.message}`,
    );
  }

  const currentHosts = browserHosts();
  if (currentHosts.trim().length === 0) {
    throw new Error(emptyHostsApplyMessage);
  }

  const saved = await saveAppState(normalized);
  window.localStorage.setItem(browserHostsBackupKey, currentHosts);
  window.localStorage.setItem(
    browserHostsKey,
    mergeHostsFile(currentHosts, renderManagedBlock(saved)),
  );
  return saved;
}

export async function restoreManagedBlock(): Promise<string> {
  if (isTauri) {
    return invoke<string>("restore_managed_block");
  }

  return extractManagedBlock(browserHosts());
}

export async function restoreProfilesFromHosts(): Promise<AppState> {
  if (isTauri) {
    return invoke<AppState>("restore_profiles_from_hosts");
  }

  const restored = parseManagedBlockAsState(extractManagedBlock(browserHosts()));
  window.localStorage.setItem(browserStoreKey, JSON.stringify(restored));
  return restored;
}

export async function restoreLastHostsBackup(): Promise<string> {
  if (isTauri) {
    return invoke<string>("restore_last_hosts_backup");
  }

  const backup = window.localStorage.getItem(browserHostsBackupKey);
  if (!backup) {
    throw new Error("No hosts backup found.");
  }

  window.localStorage.setItem(browserHostsKey, backup);
  return "Last hosts backup restored";
}

export async function listenToTrayStatus(
  handler: (event: TrayStatusEvent) => void,
): Promise<() => void> {
  if (!isTauri) {
    return () => undefined;
  }

  return listen<TrayStatusEvent>("hosts-switch://tray-status", (event) => {
    handler(event.payload);
  });
}

function browserHosts() {
  return window.localStorage.getItem(browserHostsKey) ?? demoHostsFile;
}
