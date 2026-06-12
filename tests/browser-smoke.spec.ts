import { expect, test } from "@playwright/test";

const browserStoreKey = "hosts-switch.browser-state";
const browserHostsKey = "hosts-switch.browser-hosts";
const browserHostsBackupKey = "hosts-switch.browser-hosts-backup";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([storeKey, hostsKey, backupKey]) => {
      window.localStorage.removeItem(storeKey);
      window.localStorage.removeItem(hostsKey);
      window.localStorage.removeItem(backupKey);
    },
    [browserStoreKey, browserHostsKey, browserHostsBackupKey],
  );
});

test("browser demo covers safe hosts switching without touching /etc/hosts", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Hosts Switch" })).toBeVisible();
  await expect(page.getByText("Browser demo")).toBeVisible();
  await expect(page.getByText("Development")).toBeVisible();
  await expect(page.getByText("Local API")).toBeVisible();
  await expect(page.getByText("# >>> Hosts Switch managed block")).toBeVisible();

  await page.getByRole("button", { name: /Local API/ }).hover();
  await expect(page.getByText("Hover Preview", { exact: true })).toBeVisible();
  await expect(page.locator("pre")).toContainText("127.0.0.1 api.local.test");

  await page.getByRole("button", { name: /Local API/ }).click();
  await page.getByRole("button", { name: "Inactive" }).click();
  await expect(page.getByRole("button", { name: "Active" })).toBeVisible();
  await expect(page.locator("pre")).toContainText("127.0.0.1 web.local.test");

  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Hosts applied")).toBeVisible();
  await expect(page.getByText("1 active nodes")).toBeVisible();

  const demoHosts = await page.evaluate((hostsKey) => {
    return window.localStorage.getItem(hostsKey);
  }, browserHostsKey);
  expect(demoHosts).toContain("# >>> Hosts Switch managed block");
  expect(demoHosts).toContain("127.0.0.1 api.local.test");
  expect(demoHosts).toContain("# <<< Hosts Switch managed block");

  await page.locator(".node-editor textarea").fill("not-an-ip api.local.test");
  await expect(page.getByText("Fix before Apply")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply" })).toBeDisabled();

  await page.getByPlaceholder("Search profiles").fill("missing-profile");
  await expect(page.getByText("No matching profiles")).toBeVisible();
  await page.getByPlaceholder("Search profiles").fill("");

  await page.getByTitle("Export profiles JSON").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".profile-json")).toContainText("\"groups\"");
});

test("browser demo recovers from a corrupted saved profile cache", async ({ page }) => {
  await page.addInitScript((storeKey) => {
    window.localStorage.setItem(storeKey, "{not valid json");
  }, browserStoreKey);

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Hosts Switch" })).toBeVisible();
  await expect(page.getByText("Development")).toBeVisible();

  const stored = await page.evaluate((storeKey) => {
    const raw = window.localStorage.getItem(storeKey);
    return raw ? JSON.parse(raw) : null;
  }, browserStoreKey);
  expect(stored?.groups?.[0]?.name).toBe("Development");
});

test("browser demo warns before applying when the hosts file is empty", async ({ page }) => {
  await page.addInitScript((hostsKey) => {
    window.localStorage.setItem(hostsKey, "");
  }, browserHostsKey);

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Hosts Switch" })).toBeVisible();
  await expect(
    page.getByText(
      "Current /etc/hosts is empty. Confirm this machine is ready before applying changes.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: /Local API/ }).click();
  await page.getByRole("button", { name: "Inactive" }).click();
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(
    page.getByText(
      "Current /etc/hosts is empty. Restore or confirm the system hosts file before applying changes.",
    ),
  ).toBeVisible();
  const storedHosts = await page.evaluate(
    (hostsKey) => window.localStorage.getItem(hostsKey),
    browserHostsKey,
  );
  expect(storedHosts).toBe("");
});

test("browser demo confirms before restoring the latest hosts backup", async ({ page }) => {
  await page.addInitScript(([hostsKey, backupKey]) => {
    window.localStorage.setItem(hostsKey, "127.0.0.1 current.local\n");
    window.localStorage.setItem(backupKey, "127.0.0.1 backup.local\n");
  }, [browserHostsKey, browserHostsBackupKey]);

  await page.goto("/");

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Restore the latest /etc/hosts backup?");
    await dialog.dismiss();
  });
  await page.getByTitle("Restore last hosts backup").click();
  await expect(page.getByText("Restore backup cancelled")).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate((hostsKey) => window.localStorage.getItem(hostsKey), browserHostsKey),
    )
    .toBe("127.0.0.1 current.local\n");

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("replace the current hosts file");
    await dialog.accept();
  });
  await page.getByTitle("Restore last hosts backup").click();
  await expect(page.getByText("Last hosts backup restored")).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate((hostsKey) => window.localStorage.getItem(hostsKey), browserHostsKey),
    )
    .toBe("127.0.0.1 backup.local\n");
});

test("browser demo confirms before replacing profiles from JSON import", async ({ page }) => {
  await page.goto("/");

  const exported = await page.getByTitle("Export profiles JSON").click().then(async () => {
    await expect(page.getByRole("dialog")).toBeVisible();
    return page.locator(".profile-json").inputValue();
  });
  const imported = JSON.parse(exported);
  imported.groups[0].name = "Imported Development";
  await page.getByTitle("Close").click();

  await page.getByTitle("Import profiles JSON").click();
  await page.locator(".profile-json").fill(JSON.stringify(imported));

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Replace the current profiles?");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Import cancelled")).toBeVisible();
  await expect(page.getByRole("button", { name: "Development" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Imported Development" })).toHaveCount(0);

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Unsaved profile edits will be discarded");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Profiles imported")).toBeVisible();
  await expect(page.getByRole("button", { name: "Imported Development" })).toBeVisible();
});

test("browser demo confirms before deleting nodes and groups", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /Local API/ }).click();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Delete this node?");
    await dialog.dismiss();
  });
  await page.getByTitle("Delete node").click();
  await expect(page.getByText("Delete node cancelled")).toBeVisible();
  await expect(page.getByRole("button", { name: /Local API/ })).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("current draft");
    await dialog.accept();
  });
  await page.getByTitle("Delete node").click();
  await expect(page.getByRole("button", { name: /Local API/ })).toHaveCount(0);
  await expect(page.getByText("Unsaved draft")).toBeVisible();

  await page.getByRole("button", { name: "Examples" }).click();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Delete this group");
    await dialog.dismiss();
  });
  await page.getByTitle("Delete group").click();
  await expect(page.getByText("Delete group cancelled")).toBeVisible();
  await expect(page.getByRole("button", { name: "Examples" })).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("all of its nodes");
    await dialog.accept();
  });
  await page.getByTitle("Delete group").click();
  await expect(page.getByRole("button", { name: "Examples" })).toHaveCount(0);
});
