import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  InMemoryWorkerJobRepository,
  createJsonFileWorkerJobRepository,
  createSimulatedSandboxPolicy,
  type WorkerJobRecord
} from "./index";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

function workerJobRecord(
  overrides: Partial<WorkerJobRecord> = {}
): WorkerJobRecord {
  const id = overrides.id ?? "worker_job_1";
  const projectId = overrides.projectId ?? "project_a";
  const command = overrides.inputSummary?.command ?? "build";
  const envNames = overrides.inputSummary?.envNames ?? ["STATIC_DEPLOY_TOKEN"];

  return {
    id,
    projectId,
    kind: "tool_command",
    state: overrides.state ?? "queued",
    policy:
      overrides.policy ??
      createSimulatedSandboxPolicy({
        allowedCommands: [command],
        allowedEnvNames: envNames
      }),
    inputSummary: {
      projectId,
      kind: "tool_command",
      command,
      argCount: 1,
      envNames,
      timeoutMs: 1000,
      ...overrides.inputSummary
    },
    createdAt: overrides.createdAt ?? "2026-05-17T12:00:00.000Z",
    startedAt: overrides.startedAt,
    completedAt: overrides.completedAt,
    resultSummary: overrides.resultSummary,
    errorName: overrides.errorName
  };
}

async function createTempFilePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "worker-job-repositories-"));
  tempDirs.push(dir);
  return join(dir, "worker-jobs.json");
}

describe("InMemoryWorkerJobRepository", () => {
  it("saves, updates, lists, gets, and finds the oldest queued job", async () => {
    const repository = new InMemoryWorkerJobRepository();

    await repository.save(
      workerJobRecord({
        id: "worker_job_b",
        createdAt: "2026-05-17T12:00:00.000Z"
      })
    );
    await repository.save(
      workerJobRecord({
        id: "worker_job_a",
        createdAt: "2026-05-17T12:00:00.000Z"
      })
    );
    await repository.save(
      workerJobRecord({
        id: "worker_job_c",
        projectId: "project_b",
        createdAt: "2026-05-17T11:00:00.000Z"
      })
    );
    await repository.save(
      workerJobRecord({
        id: "worker_job_c",
        projectId: "project_b",
        state: "running",
        createdAt: "2026-05-17T11:00:00.000Z"
      })
    );

    await expect(repository.getById("worker_job_c")).resolves.toMatchObject({
      id: "worker_job_c",
      state: "running"
    });
    await expect(repository.listForProject("project_a")).resolves.toEqual([
      expect.objectContaining({ id: "worker_job_a" }),
      expect.objectContaining({ id: "worker_job_b" })
    ]);
    await expect(repository.listAll()).resolves.toEqual([
      expect.objectContaining({ id: "worker_job_c" }),
      expect.objectContaining({ id: "worker_job_a" }),
      expect.objectContaining({ id: "worker_job_b" })
    ]);
    await expect(repository.findOldestQueued()).resolves.toMatchObject({
      id: "worker_job_a"
    });
  });

  it("returns defensive copies from save, get, list, and find operations", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const record = workerJobRecord();

    await repository.save(record);
    record.policy.allowedCommands.push("mutated-after-save");
    record.inputSummary.envNames.push("MUTATED_AFTER_SAVE");

    const fromGet = await repository.getById(record.id);
    fromGet?.policy.allowedCommands.push("mutated-from-get");
    fromGet?.inputSummary.envNames.push("MUTATED_FROM_GET");

    const fromList = await repository.listAll();
    fromList[0]?.policy.allowedEnvNames.push("MUTATED_FROM_LIST");
    fromList[0]?.inputSummary.envNames.push("MUTATED_FROM_LIST");

    const fromFind = await repository.findOldestQueued();
    fromFind?.policy.allowedCommands.push("mutated-from-find");
    fromFind?.inputSummary.envNames.push("MUTATED_FROM_FIND");

    await expect(repository.getById(record.id)).resolves.toMatchObject({
      policy: {
        allowedCommands: ["build"],
        allowedEnvNames: ["STATIC_DEPLOY_TOKEN"]
      },
      inputSummary: {
        envNames: ["STATIC_DEPLOY_TOKEN"]
      }
    });
  });

  it("returns defensive copies of cancel metadata", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const record = {
      ...workerJobRecord({
        id: "worker_job_cancelled",
        state: "cancelled",
        completedAt: "2026-05-17T12:01:00.000Z",
        errorName: "worker_job_cancelled",
        resultSummary: {
          state: "cancelled",
          stdout: "",
          stderr: "Worker job cancelled before execution.",
          stdoutBytes: 0,
          stderrBytes: 38,
          errorName: "worker_job_cancelled"
        }
      }),
      cancelRequestedAt: "2026-05-17T12:00:30.000Z",
      cancelledAt: "2026-05-17T12:01:00.000Z",
      cancelReason: "User interrupted the job."
    };

    await repository.save(record);
    const saved = await repository.getById(record.id);
    if (saved) {
      saved.cancelReason = "mutated";
    }

    await expect(repository.getById(record.id)).resolves.toMatchObject({
      cancelRequestedAt: "2026-05-17T12:00:30.000Z",
      cancelledAt: "2026-05-17T12:01:00.000Z",
      cancelReason: "User interrupted the job.",
      resultSummary: {
        state: "cancelled",
        errorName: "worker_job_cancelled"
      }
    });
  });

  it("returns defensive copies of claim metadata", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const record = workerJobRecord({
      state: "running",
      startedAt: "2026-05-18T00:01:00.000Z"
    });
    const runningRecord = {
      ...record,
      claimedByWorkerId: "worker_a",
      claimToken: "claim_token_1"
    };

    await repository.save(runningRecord);
    const saved = await repository.getById(record.id);
    if (saved) {
      saved.claimedByWorkerId = "mutated";
      saved.claimToken = "mutated";
    }

    await expect(repository.getById(record.id)).resolves.toMatchObject({
      claimedByWorkerId: "worker_a",
      claimToken: "claim_token_1"
    });
  });

  it("atomically claims only queued jobs for the requested payload source", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const legacyRecord = workerJobRecord({
      id: "worker_job_legacy",
      createdAt: "2026-05-18T00:00:00.000Z"
    });
    const safeRecord = {
      ...workerJobRecord({
        id: "worker_job_safe",
        createdAt: "2026-05-18T00:00:01.000Z"
      }),
      payloadSource: "safe_persisted" as const
    };

    await repository.save(legacyRecord);
    await repository.save(safeRecord);

    const safeClaim = await repository.claimOldestQueued({
      payloadSource: "safe_persisted",
      startedAt: "2026-05-18T00:01:00.000Z",
      claimedByWorkerId: "worker_a",
      claimToken: "claim_token_1"
    });
    const legacyClaim = await repository.claimOldestQueued({
      payloadSource: "process_memory",
      startedAt: "2026-05-18T00:01:01.000Z",
      claimedByWorkerId: "worker_b",
      claimToken: "claim_token_2"
    });

    safeClaim?.inputSummary.envNames.push("MUTATED_SAFE");
    legacyClaim?.inputSummary.envNames.push("MUTATED_LEGACY");

    await expect(repository.getById("worker_job_safe")).resolves.toMatchObject({
      id: "worker_job_safe",
      state: "running",
      payloadSource: "safe_persisted",
      claimedByWorkerId: "worker_a",
      claimToken: "claim_token_1",
      inputSummary: {
        envNames: ["STATIC_DEPLOY_TOKEN"]
      }
    });
    await expect(repository.getById("worker_job_legacy")).resolves.toMatchObject({
      id: "worker_job_legacy",
      state: "running",
      payloadSource: "process_memory",
      claimedByWorkerId: "worker_b",
      claimToken: "claim_token_2",
      inputSummary: {
        envNames: ["STATIC_DEPLOY_TOKEN"]
      }
    });
  });
});

describe("JsonFileWorkerJobRepository", () => {
  it("persists records across instances and lists with stable createdAt and id sorting", async () => {
    const filePath = await createTempFilePath();
    const firstRepository = createJsonFileWorkerJobRepository({ filePath });

    await firstRepository.save(
      workerJobRecord({
        id: "worker_job_b",
        createdAt: "2026-05-17T12:00:00.000Z"
      })
    );
    await firstRepository.save(
      workerJobRecord({
        id: "worker_job_a",
        createdAt: "2026-05-17T12:00:00.000Z"
      })
    );
    await firstRepository.save(
      workerJobRecord({
        id: "worker_job_old",
        createdAt: "2026-05-17T11:00:00.000Z"
      })
    );

    const secondRepository = createJsonFileWorkerJobRepository({ filePath });

    await expect(secondRepository.listAll()).resolves.toEqual([
      expect.objectContaining({ id: "worker_job_old" }),
      expect.objectContaining({ id: "worker_job_a" }),
      expect.objectContaining({ id: "worker_job_b" })
    ]);
  });

  it("serializes concurrent saves through absolute and relative paths to the same file", async () => {
    const filePath = await createTempFilePath();
    const absolutePathRepository = createJsonFileWorkerJobRepository({ filePath });
    const relativePathRepository = createJsonFileWorkerJobRepository({
      filePath: relative(process.cwd(), filePath)
    });

    await Promise.all([
      absolutePathRepository.save(
        workerJobRecord({
          id: "worker_job_absolute",
          createdAt: "2026-05-17T12:00:00.000Z"
        })
      ),
      relativePathRepository.save(
        workerJobRecord({
          id: "worker_job_relative",
          createdAt: "2026-05-17T12:01:00.000Z"
        })
      )
    ]);

    await expect(absolutePathRepository.listAll()).resolves.toEqual([
      expect.objectContaining({ id: "worker_job_absolute" }),
      expect.objectContaining({ id: "worker_job_relative" })
    ]);
  });

  it("json-file repository serializes concurrent saves for one file", async () => {
    const filePath = await createTempFilePath();
    const repository = createJsonFileWorkerJobRepository({ filePath });

    await Promise.all([
      repository.save(
        workerJobRecord({
          id: "worker_job_1",
          createdAt: "2026-05-17T12:00:00.000Z"
        })
      ),
      repository.save(
        workerJobRecord({
          id: "worker_job_2",
          createdAt: "2026-05-17T12:01:00.000Z"
        })
      ),
      repository.save(
        workerJobRecord({
          id: "worker_job_3",
          createdAt: "2026-05-17T12:02:00.000Z"
        })
      )
    ]);

    const records = await repository.listAll();

    expect(records.map((record) => record.id)).toEqual([
      "worker_job_1",
      "worker_job_2",
      "worker_job_3"
    ]);
  });

  it("treats a missing file, old shape, or null JSON as empty state", async () => {
    const filePath = await createTempFilePath();
    const repository = createJsonFileWorkerJobRepository({ filePath });

    await expect(repository.listAll()).resolves.toEqual([]);

    await writeFile(filePath, JSON.stringify({ jobs: [workerJobRecord()] }), "utf8");

    await expect(repository.listAll()).resolves.toEqual([]);

    await writeFile(filePath, "null", "utf8");

    await expect(repository.listAll()).resolves.toEqual([]);
  });

  it("upserts records and persists env names without raw secret values", async () => {
    const filePath = await createTempFilePath();
    const repository = createJsonFileWorkerJobRepository({ filePath });

    await repository.save(
      workerJobRecord({
        id: "worker_job_secret",
        state: "queued",
        inputSummary: {
          projectId: "project_a",
          kind: "tool_command",
          command: "build",
          argCount: 0,
          envNames: ["STATIC_DEPLOY_TOKEN"],
          timeoutMs: 1000
        }
      })
    );
    await repository.save(
      workerJobRecord({
        id: "worker_job_secret",
        state: "completed",
        inputSummary: {
          projectId: "project_a",
          kind: "tool_command",
          command: "build",
          argCount: 0,
          envNames: ["STATIC_DEPLOY_TOKEN"],
          timeoutMs: 1000
        },
        completedAt: "2026-05-17T12:01:00.000Z"
      })
    );

    const persisted = await readFile(filePath, "utf8");
    const records = await repository.listAll();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "worker_job_secret",
      state: "completed",
      inputSummary: {
        envNames: ["STATIC_DEPLOY_TOKEN"]
      }
    });
    expect(persisted).toContain("STATIC_DEPLOY_TOKEN");
    expect(persisted).not.toContain("secret-value");
  });

  it("json-file repository persists and reloads cancel metadata", async () => {
    const filePath = await createTempFilePath();
    const repository = createJsonFileWorkerJobRepository({ filePath });
    const record = {
      ...workerJobRecord({
        id: "worker_job_cancelled",
        state: "cancelled",
        completedAt: "2026-05-17T12:01:00.000Z",
        errorName: "worker_job_cancelled",
        resultSummary: {
          state: "cancelled",
          stdout: "",
          stderr: "Worker job cancelled before execution.",
          stdoutBytes: 0,
          stderrBytes: 38,
          errorName: "worker_job_cancelled"
        }
      }),
      cancelRequestedAt: "2026-05-17T12:00:30.000Z",
      cancelledAt: "2026-05-17T12:01:00.000Z",
      cancelReason: "User interrupted the job."
    };

    await repository.save(record);

    const reopened = createJsonFileWorkerJobRepository({ filePath });
    await expect(reopened.getById(record.id)).resolves.toMatchObject({
      id: "worker_job_cancelled",
      state: "cancelled",
      cancelRequestedAt: "2026-05-17T12:00:30.000Z",
      cancelledAt: "2026-05-17T12:01:00.000Z",
      cancelReason: "User interrupted the job.",
      resultSummary: {
        state: "cancelled",
        stderr: "Worker job cancelled before execution."
      }
    });
  });

  it("json-file repository persists and reloads claim metadata", async () => {
    const filePath = await createTempFilePath();
    const repository = createJsonFileWorkerJobRepository({ filePath });

    await repository.save({
      ...workerJobRecord({
        id: "worker_job_claimed",
        state: "running",
        startedAt: "2026-05-18T00:01:00.000Z"
      }),
      claimedByWorkerId: "worker_a",
      claimToken: "claim_token_1"
    });

    const reopened = createJsonFileWorkerJobRepository({ filePath });
    await expect(reopened.getById("worker_job_claimed")).resolves.toMatchObject({
      state: "running",
      claimedByWorkerId: "worker_a",
      claimToken: "claim_token_1"
    });
  });

  it("json-file repository atomically claims and reloads source-scoped claim metadata", async () => {
    const filePath = await createTempFilePath();
    const repository = createJsonFileWorkerJobRepository({ filePath });

    await repository.save(
      workerJobRecord({
        id: "worker_job_legacy",
        createdAt: "2026-05-18T00:00:00.000Z"
      })
    );
    await repository.save({
      ...workerJobRecord({
        id: "worker_job_safe",
        createdAt: "2026-05-18T00:00:01.000Z"
      }),
      payloadSource: "safe_persisted" as const
    });

    const claim = await repository.claimOldestQueued({
      payloadSource: "safe_persisted",
      startedAt: "2026-05-18T00:01:00.000Z",
      claimedByWorkerId: "worker_a",
      claimToken: "claim_token_1"
    });
    const legacy = await repository.getById("worker_job_legacy");

    claim?.inputSummary.envNames.push("MUTATED");

    const reopened = createJsonFileWorkerJobRepository({ filePath });
    await expect(reopened.getById("worker_job_safe")).resolves.toMatchObject({
      id: "worker_job_safe",
      state: "running",
      payloadSource: "safe_persisted",
      startedAt: "2026-05-18T00:01:00.000Z",
      claimedByWorkerId: "worker_a",
      claimToken: "claim_token_1",
      inputSummary: {
        envNames: ["STATIC_DEPLOY_TOKEN"]
      }
    });
    expect(legacy).toMatchObject({
      id: "worker_job_legacy",
      state: "queued",
      payloadSource: "process_memory"
    });
  });
});
