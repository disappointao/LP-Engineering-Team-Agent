import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:31031";
const stateDir = resolve("test-results", "alpha-e2e-state");
const stateFile = resolve(stateDir, "workbench-state.json");
const workerJobsFile = resolve(stateDir, "worker-jobs.json");
const workerPayloadsFile = resolve(stateDir, "worker-payloads.json");
const workerLogsFile = resolve(stateDir, "worker-logs.json");

rmSync(stateDir, { recursive: true, force: true });
mkdirSync(stateDir, { recursive: true });

export default defineConfig({
  testDir: "apps/web/e2e",
  outputDir: resolve("test-results", "alpha-e2e-artifacts"),
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
      WORKER_REPOSITORY_BACKEND: "json",
      WORKER_JOBS_FILE: workerJobsFile,
      WORKER_PAYLOADS_FILE: workerPayloadsFile,
      WORKER_LOGS_FILE: workerLogsFile,
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
