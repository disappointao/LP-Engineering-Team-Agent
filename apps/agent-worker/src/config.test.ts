import { describe, expect, it } from "vitest";
import { resolveAgentWorkerMode } from "./config";

describe("resolveAgentWorkerMode", () => {
  it("uses demo mode when no worker queue backend is configured", () => {
    expect(resolveAgentWorkerMode({})).toEqual({ mode: "demo" });
  });

  it("uses queue mode when both legacy JSON worker files are configured", () => {
    expect(
      resolveAgentWorkerMode({
        WORKER_JOBS_FILE: "tmp/worker-jobs.json",
        WORKER_PAYLOADS_FILE: "tmp/worker-payloads.json"
      })
    ).toEqual({ mode: "queue" });
  });

  it("uses queue mode for explicit postgres backend without worker JSON files", () => {
    expect(
      resolveAgentWorkerMode({
        WORKER_REPOSITORY_BACKEND: "postgres",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/lp_agent"
      })
    ).toEqual({ mode: "queue" });
  });

  it("uses queue mode for explicit memory backend without worker JSON files", () => {
    expect(
      resolveAgentWorkerMode({
        WORKER_REPOSITORY_BACKEND: "memory"
      })
    ).toEqual({ mode: "queue" });
  });

  it("fails closed when only the legacy JSON jobs file is configured", () => {
    expect(() =>
      resolveAgentWorkerMode({
        WORKER_JOBS_FILE: "tmp/worker-jobs.json"
      })
    ).toThrow("WORKER_PAYLOADS_FILE is required when WORKER_JOBS_FILE is set");
  });

  it("fails closed when only the legacy JSON payloads file is configured", () => {
    expect(() =>
      resolveAgentWorkerMode({
        WORKER_PAYLOADS_FILE: "tmp/worker-payloads.json"
      })
    ).toThrow("WORKER_JOBS_FILE is required when WORKER_PAYLOADS_FILE is set");
  });
});
