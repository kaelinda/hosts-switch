import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 1420);
const baseURL = `http://127.0.0.1:${port}`;
const browserChannel = process.env.CI ? undefined : "chrome";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
    timeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        channel: browserChannel,
      },
    },
  ],
});
