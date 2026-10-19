import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      testMatch: ["**/app.spec.ts", "**/security.spec.ts", "**/workflow.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-wasm",
      testMatch: "**/ner-wasm.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--disable-features=WebGPU"] },
      },
    },
  ],
  webServer: {
    command: "npm run preview:static",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});