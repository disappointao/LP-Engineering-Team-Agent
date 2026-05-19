import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  InMemoryWorkerLogRepository,
  createJsonFileWorkerLogRepository,
  type WorkerLogRecord
} from "./index";

describe("worker log repositories", () => {
  it("stores bounded in-memory logs sorted by timeline", async () => {
    const repository = new InMemoryWorkerLogRepository({ maxRecords: 2 });
    await repository.append(logRecord({ id: "log_1", projectId: "project_a" }));
    await repository.append(logRecord({ id: "log_2", projectId: "project_b" }));
    await repository.append(logRecord({ id: "log_3", projectId: "project_a" }));

    await expect(repository.list({ limit: 10 })).resolves.toEqual([
      expect.objectContaining({ id: "log_3" }),
      expect.objectContaining({ id: "log_2" })
    ]);
    await expect(
      repository.list({ projectId: "project_a", limit: 10 })
    ).resolves.toEqual([expect.objectContaining({ id: "log_3" })]);
  });

  it("persists bounded JSON-file logs without leaking disallowed payload fields", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worker-logs-"));
    try {
      const filePath = join(directory, "worker-logs.json");
      const first = createJsonFileWorkerLogRepository({
        filePath,
        maxRecords: 2
      });
      await first.append(
        logRecord({
          id: "log_1",
          payload: {
            workerId: "worker_a",
            workerJobId: "worker_job_1",
            projectId: "project_a",
            outputSummary: "safe",
            secret: "must-not-persist",
            args: ["must-not-persist"]
          }
        })
      );
      await first.append(logRecord({ id: "log_2" }));
      await first.append(logRecord({ id: "log_3" }));

      const second = createJsonFileWorkerLogRepository({
        filePath,
        maxRecords: 2
      });
      const logs = await second.list({ limit: 10 });

      expect(logs.map((log) => log.id)).toEqual(["log_3", "log_2"]);
      expect(JSON.stringify(logs)).not.toContain("must-not-persist");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function logRecord(overrides: Partial<WorkerLogRecord> = {}): WorkerLogRecord {
  return {
    id: overrides.id ?? "log_1",
    type: overrides.type ?? "worker.job.claimed",
    message: overrides.message ?? "Worker job claimed.",
    workerId: overrides.workerId ?? "worker_a",
    workerJobId: overrides.workerJobId ?? "worker_job_1",
    projectId: overrides.projectId ?? "project_a",
    payload: overrides.payload ?? {
      workerId: "worker_a",
      workerJobId: "worker_job_1",
      projectId: "project_a"
    },
    createdAt:
      overrides.createdAt ??
      `2026-05-19T00:00:0${overrides.id?.at(-1) ?? "1"}.000Z`
  };
}
