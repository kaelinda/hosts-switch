import { expect, test } from "@playwright/test";
import { hydrateGlobalShortcutPreference } from "../src/systemPreferenceHydration";
import type { AppState } from "../src/types";

function state(enableGlobalShortcut: boolean): AppState {
  return {
    version: 1,
    groups: [],
    preferences: {
      enforceOneActivePerGroup: true,
      previewOnHover: true,
      launchAtLogin: false,
      enableGlobalShortcut,
    },
  };
}

test("startup keeps an enabled global shortcut preference when runtime registration is missing", async () => {
  const loaded = state(true);
  const calls: string[] = [];

  const hydrated = await hydrateGlobalShortcutPreference(loaded, {
    readStatus: async () => {
      calls.push("read");
      return false;
    },
    syncPreference: async (requested) => {
      calls.push(`sync:${requested.preferences.enableGlobalShortcut}`);
      return true;
    },
    saveState: async () => {
      throw new Error("startup registration should not rewrite already-correct state");
    },
    reportError: () => {
      throw new Error("unexpected error");
    },
    reportStatus: () => {
      throw new Error("unexpected status");
    },
  });

  expect(hydrated).toBe(loaded);
  expect(hydrated.preferences.enableGlobalShortcut).toBe(true);
  expect(calls).toEqual(["read", "sync:true"]);
});

test("startup records a disabled global shortcut when runtime sync cannot keep it enabled", async () => {
  const loaded = state(true);
  let saved: AppState | null = null;

  const hydrated = await hydrateGlobalShortcutPreference(loaded, {
    readStatus: async () => false,
    syncPreference: async () => false,
    saveState: async (next) => {
      saved = next;
      return next;
    },
    reportError: () => {
      throw new Error("unexpected error");
    },
    reportStatus: () => {
      throw new Error("unexpected status");
    },
  });

  expect(hydrated.preferences.enableGlobalShortcut).toBe(false);
  expect(saved?.preferences.enableGlobalShortcut).toBe(false);
});

test("startup leaves a disabled global shortcut preference untouched", async () => {
  const loaded = state(false);
  const hydrated = await hydrateGlobalShortcutPreference(loaded, {
    readStatus: async () => false,
    syncPreference: async () => {
      throw new Error("disabled preference should not sync");
    },
    saveState: async () => {
      throw new Error("disabled preference should not save");
    },
    reportError: () => {
      throw new Error("unexpected error");
    },
    reportStatus: () => {
      throw new Error("unexpected status");
    },
  });

  expect(hydrated).toBe(loaded);
  expect(hydrated.preferences.enableGlobalShortcut).toBe(false);
});

test("startup does not disable the preference after a transient registration failure", async () => {
  const loaded = state(true);
  const errors: string[] = [];
  const statuses: string[] = [];

  const hydrated = await hydrateGlobalShortcutPreference(loaded, {
    readStatus: async () => false,
    syncPreference: async () => {
      throw new Error("shortcut already reserved");
    },
    saveState: async () => {
      throw new Error("failed sync should not save");
    },
    reportError: (message) => errors.push(message),
    reportStatus: (message) => statuses.push(message),
  });

  expect(hydrated).toBe(loaded);
  expect(hydrated.preferences.enableGlobalShortcut).toBe(true);
  expect(errors).toEqual(["Error: shortcut already reserved"]);
  expect(statuses).toEqual(["Could not register global shortcut"]);
});
