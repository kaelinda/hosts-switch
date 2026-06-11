import type { AppState } from "./types";

type GlobalShortcutHydrationDeps = {
  readStatus: () => Promise<boolean | null>;
  syncPreference: (state: AppState) => Promise<boolean>;
  saveState: (state: AppState) => Promise<AppState>;
  reportError: (message: string) => void;
  reportStatus: (message: string) => void;
};

export async function hydrateGlobalShortcutPreference(
  loaded: AppState,
  deps: GlobalShortcutHydrationDeps,
): Promise<AppState> {
  let runtimeRegistered: boolean | null = null;
  try {
    runtimeRegistered = await deps.readStatus();
  } catch (reason) {
    reportHydrationError(deps, "Could not read global shortcut status", reason);
  }

  if (loaded.preferences.enableGlobalShortcut || runtimeRegistered === true) {
    try {
      const effective = await deps.syncPreference(loaded);
      if (effective === loaded.preferences.enableGlobalShortcut) {
        return loaded;
      }
      return deps.saveState({
        ...loaded,
        preferences: {
          ...loaded.preferences,
          enableGlobalShortcut: effective,
        },
      });
    } catch (reason) {
      reportHydrationError(deps, "Could not register global shortcut", reason);
    }
  }

  return loaded;
}

function reportHydrationError(
  deps: GlobalShortcutHydrationDeps,
  status: string,
  reason: unknown,
) {
  deps.reportError(String(reason));
  deps.reportStatus(status);
}
