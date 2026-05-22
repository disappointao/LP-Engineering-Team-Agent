import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:31031";
const stateDir = join("test-results", "alpha-e2e-state");
const stateFile = join(stateDir, "workbench-state.json");

mkdirSync(stateDir, { recursive: true });
rmSync(stateFile, { force: true });

export default defineConfig({
  testDir: "apps/web/e2e",
  outputDir: join("test-results", "alpha-e2e-artifacts"),
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 15_000
  },
  use: {
    baseURL,
    locale: "en-US",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9"
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure"
  },
  reporter: [["list"], ["html", { open: "never" }]],
  webServer: {
    command: "pnpm --filter @lp-agent/web dev --hostname 127.0.0.1 --port 31031",
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      REAL_MODEL_RUNTIME: "0",
      REAL_MODEL_PROVIDER_TEST: "0",
      WORKBENCH_REPOSITORY_BACKEND: "json",
      LP_AGENT_WORKBENCH_STATE_FILE: stateFile,
      NEXT_TELEMETRY_DISABLED: "1"
    }
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ]
});
