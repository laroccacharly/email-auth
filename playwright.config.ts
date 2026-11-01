import { defineConfig, devices } from "@playwright/test"
import { origin } from "./test/browser/server.ts"

export default defineConfig({
  testDir: "test/browser",
  testMatch: "*.e2e.ts",
  timeout: 10_000,
  globalTimeout: 60_000,
  reporter: "list",
  // The test app and the demo app, on one origin, as an app serves them.
  webServer: { command: "bun test/browser/server.ts", url: `${origin}/auth/session`, reuseExistingServer: false },
  use: { baseURL: origin },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
