import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  InMemoryWorkerJobRepository,
  createJsonFileWorkerJobRepository,
  createSimulatedSandboxPolicy,
  type WorkerJobCompleteClaimedInput,
  type WorkerJobRecord
} from "./index";
import { runWorkerJobRepositoryContractTests } from "./worker-repository-contract";

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
    cancelRequestedAt: overrides.cancelRequestedAt,
    cancelledAt: overrides.cancelledAt,
    cancelReason: overrides.cancelReason,
    claimedByWorkerId: overrides.claimedByWorkerId,
    claimToken: overrides.claimToken,
    resultSummary: overrides.resultSummary,
    errorName: overrides.errorName
  };
}

async function completeClaimed(
  repository: unknown,
  input: WorkerJobCompleteClaimedInput
): Promise<WorkerJobRecord | undefined> {
  return (
    repository as {
      completeClaimed(
        input: WorkerJobCompleteClaimedInput
      ): Promise<WorkerJobRecord | undefined>;
    }
  ).completeClaimed(input);
}

async function requestRunningCancellation(
  repository: unknown,
  input: {
    jobId: string;
    cancelRequestedAt: string;
    cancelReason?: string;
  }
): Promise<WorkerJobRecord | undefined> {
  return (
    repository as {
      requestRunningCancellation(input: {
        jobId: string;
        cancelRequestedAt: string;
        cancelReason?: string;
      }): Promise<WorkerJobRecord | undefined>;
    }
  ).requestRunningCancellation(input);
}

async function cancelQueued(
  repository: unknown,
  input: {
    jobId: string;
    errorName: string;
    resultSummary: {
      state: "cancelled";
      stdout: string;
      stderr: string;
      stdoutBytes: number;
      stderrBytes: number;
      errorName?: string;
    };
    cancelRequestedAt: string;
    cancelledAt: string;
    completedAt: string;
    cancelReason?: string;
  }
): Promise<WorkerJobRecord | undefined> {
  return (
    repository as {
      cancelQueued(input: {
        jobId: string;
        errorName: string;
        resultSummary: {
          state: "cancelled";
          stdout: string;
          stderr: string;
          stdoutBytes: number;
          stderrBytes: number;
          errorName?: string;
        };
        cancelRequestedAt: string;
        cancelledAt: string;
        completedAt: string;
        cancelReason?: string;
      }): Promise<WorkerJobRecord | undefined>;
    }
  ).cancelQueued(input);
}

async function createTempFilePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "worker-job-repositories-"));
  tempDirs.push(dir);
  return join(dir, "worker-jobs.json");
}

runWorkerJobRepositoryContractTests(
  "in-memory",
  () => new InMemoryWorkerJobRepository()
);

runWorkerJobRepositoryContractTests("json-file", async () =>
  createJsonFileWorkerJobRepository({ filePath: await createTempFilePath() })
);

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

  it("completes claimed running jobs without dropping latest cancellation metadata", async () => {
    const repository = new InMemoryWorkerJobRepository();
    await repository.save(
      workerJobRecord({
        state: "running",
        startedAt: "2026-05-18T00:01:00.000Z",
        claimedByWorkerId: "worker_a",
        claimToken: "claim_token_1",
        cancelRequestedAt: "2026-05-18T00:01:30.000Z",
        cancelReason: "External stop"
      })
    );

    const completed = await completeClaimed(repository, {
      jobId: "worker_job_1",
      claimToken: "claim_token_1",
      state: "completed",
      resultSummary: {
        state: "completed",
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        stdoutBytes: 2,
        stderrBytes: 0
      },
      completedAt: "2026-05-18T00:02:00.000Z"
    });
    const stored = await repository.getById("worker_job_1");

    expect(completed).toMatchObject({
      id: "worker_job_1",
      state: "completed",
      completedAt: "2026-05-18T00:02:00.000Z",
      cancelRequestedAt: "2026-05-18T00:01:30.000Z",
      cancelReason: "External stop",
      resultSummary: {
        state: "completed",
        stdout: "ok"
      }
    });
    expect(completed?.cancelledAt).toBeUndefined();
    expect(stored).toEqual(completed);
  });

  it("requests cancellation for running jobs without replacing existing metadata", async () => {
    const repository = new InMemoryWorkerJobRepository();
    await repository.save(
      workerJobRecord({
        state: "running",
        startedAt: "2026-05-18T00:01:00.000Z",
        claimedByWorkerId: "worker_a",
        claimToken: "claim_token_1"
      })
    );

    const cancelled = await requestRunningCancellation(repository, {
      jobId: "worker_job_1",
      cancelRequestedAt: "2026-05-18T00:01:30.000Z",
      cancelReason: "External stop"
    });
    await requestRunningCancellation(repository, {
      jobId: "worker_job_1",
      cancelRequestedAt: "2026-05-18T00:01:31.000Z",
      cancelReason: "Different stop"
    });
    const stored = await repository.getById("worker_job_1");

    expect(cancelled).toMatchObject({
      id: "worker_job_1",
      state: "running",
      cancelRequestedAt: "2026-05-18T00:01:30.000Z",
      cancelReason: "External stop"
    });
    expect(stored).toMatchObject({
      id: "worker_job_1",
      state: "running",
      cancelRequestedAt: "2026-05-18T00:01:30.000Z",
      cancelReason: "External stop"
    });
  });

  it("returns completed jobs from running cancellation without reviving them", async () => {
    const repository = new InMemoryWorkerJobRepository();
    await repository.save(
      workerJobRecord({
        state: "completed",
        completedAt: "2026-05-18T00:02:00.000Z",
        resultSummary: {
          state: "completed",
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          stdoutBytes: 2,
          stderrBytes: 0
        }
      })
    );

    const completed = await requestRunningCancellation(repository, {
      jobId: "worker_job_1",
      cancelRequestedAt: "2026-05-18T00:02:30.000Z",
      cancelReason: "Too late"
    });
    const stored = await repository.getById("worker_job_1");

    expect(completed).toMatchObject({
      id: "worker_job_1",
      state: "completed",
      completedAt: "2026-05-18T00:02:00.000Z",
      resultSummary: {
        state: "completed",
        stdout: "ok"
      }
    });
    expect(completed?.cancelRequestedAt).toBeUndefined();
    expect(stored).toEqual(completed);
  });

  it("cancels queued jobs with terminal result and cancellation metadata", async () => {
    const repository = new InMemoryWorkerJobRepository();
    await repository.save(workerJobRecord());

    const cancelled = await cancelQueued(repository, {
      jobId: "worker_job_1",
      errorName: "worker_job_cancelled",
      resultSummary: {
        state: "cancelled",
        stdout: "",
        stderr: "Worker job cancelled before execution.",
        stdoutBytes: 0,
        stderrBytes: 38,
        errorName: "worker_job_cancelled"
      },
      cancelRequestedAt: "2026-05-18T00:01:00.000Z",
      cancelledAt: "2026-05-18T00:01:00.000Z",
      completedAt: "2026-05-18T00:01:00.000Z",
      cancelReason: "User stopped it"
    });
    const stored = await repository.getById("worker_job_1");

    expect(cancelled).toMatchObject({
      id: "worker_job_1",
      state: "cancelled",
      errorName: "worker_job_cancelled",
      cancelRequestedAt: "2026-05-18T00:01:00.000Z",
      cancelledAt: "2026-05-18T00:01:00.000Z",
      completedAt: "2026-05-18T00:01:00.000Z",
      cancelReason: "User stopped it",
      resultSummary: {
        state: "cancelled",
        stderr: "Worker job cancelled before execution.",
        errorName: "worker_job_cancelled"
      }
    });
    expect(stored).toEqual(cancelled);
  });

  it("returns running and completed jobs from queued cancellation without changing them", async () => {
    const repository = new InMemoryWorkerJobRepository();
    await repository.save(
      workerJobRecord({
        id: "worker_job_running",
        state: "running",
        startedAt: "2026-05-18T00:01:00.000Z",
        claimedByWorkerId: "worker_a",
        claimToken: "claim_token_1"
      })
    );
    await repository.save(
      workerJobRecord({
        id: "worker_job_completed",
        state: "completed",
        completedAt: "2026-05-18T00:02:00.000Z",
        resultSummary: {
          state: "completed",
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          stdoutBytes: 2,
          stderrBytes: 0
        }
      })
    );

    const running = await cancelQueued(repository, {
      jobId: "worker_job_running",
      errorName: "worker_job_cancelled",
      resultSummary: {
        state: "cancelled",
        stdout: "",
        stderr: "Worker job cancelled before execution.",
        stdoutBytes: 0,
        stderrBytes: 38,
        errorName: "worker_job_cancelled"
      },
      cancelRequestedAt: "2026-05-18T00:03:00.000Z",
      cancelledAt: "2026-05-18T00:03:00.000Z",
      completedAt: "2026-05-18T00:03:00.000Z",
      cancelReason: "Too late"
    });
    const completed = await cancelQueued(repository, {
      jobId: "worker_job_completed",
      errorName: "worker_job_cancelled",
      resultSummary: {
        state: "cancelled",
        stdout: "",
        stderr: "Worker job cancelled before execution.",
        stdoutBytes: 0,
        stderrBytes: 38,
        errorName: "worker_job_cancelled"
      },
      cancelRequestedAt: "2026-05-18T00:03:00.000Z",
      cancelledAt: "2026-05-18T00:03:00.000Z",
      completedAt: "2026-05-18T00:03:00.000Z",
      cancelReason: "Too late"
    });

    expect(running).toMatchObject({
      id: "worker_job_running",
      state: "running",
      claimedByWorkerId: "worker_a",
      claimToken: "claim_token_1"
    });
    expect(running?.completedAt).toBeUndefined();
    expect(completed).toMatchObject({
      id: "worker_job_completed",
      state: "completed",
      completedAt: "2026-05-18T00:02:00.000Z",
      resultSummary: {
        state: "completed",
        stdout: "ok"
      }
    });
    expect(completed?.cancelRequestedAt).toBeUndefined();
    await expect(repository.getById("worker_job_running")).resolves.toEqual(
      running
    );
    await expect(repository.getById("worker_job_completed")).resolves.toEqual(
      completed
    );
  });

  it("does not complete running jobs when the claim token does not match", async () => {
    const repository = new InMemoryWorkerJobRepository();
    await repository.save(
      workerJobRecord({
        state: "running",
        startedAt: "2026-05-18T00:01:00.000Z",
        claimedByWorkerId: "worker_a",
        claimToken: "claim_token_1"
      })
    );

    const completed = await completeClaimed(repository, {
      jobId: "worker_job_1",
      claimToken: "stale_claim_token",
      state: "completed",
      resultSummary: {
        state: "completed",
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        stdoutBytes: 2,
        stderrBytes: 0
      },
      completedAt: "2026-05-18T00:02:00.000Z"
    });
    const stored = await repository.getById("worker_job_1");

    expect(completed).toBeUndefined();
    expect(stored).toMatchObject({
      id: "worker_job_1",
      state: "running",
      claimToken: "claim_token_1"
    });
    expect(stored?.completedAt).toBeUndefined();
    expect(stored?.resultSummary).toBeUndefined();
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
        stderr: "",
        stderrBytes: 38
      }
    });
  });

  it("json-file repository strips raw result output from durable records", async () => {
    const filePath = await createTempFilePath();
    const repository = createJsonFileWorkerJobRepository({ filePath });

    await repository.save(
      workerJobRecord({
        id: "worker_job_output",
        state: "running",
        startedAt: "2026-05-17T12:00:10.000Z",
        claimedByWorkerId: "worker_a",
        claimToken: "claim_token_1"
      })
    );

    const completed = await completeClaimed(repository, {
      jobId: "worker_job_output",
      claimToken: "claim_token_1",
      state: "completed",
      resultSummary: {
        state: "completed",
        exitCode: 0,
        stdout: "raw simulated stdout text",
        stderr: "raw simulated stderr text",
        stdoutBytes: 25,
        stderrBytes: 25
      },
      completedAt: "2026-05-17T12:01:00.000Z"
    });
    const persisted = await readFile(filePath, "utf8");
    const reopened = createJsonFileWorkerJobRepository({ filePath });
    const reloaded = await reopened.getById("worker_job_output");

    expect(completed?.resultSummary?.stdout).toBe("raw simulated stdout text");
    expect(completed?.resultSummary?.stderr).toBe("raw simulated stderr text");
    expect(persisted).not.toContain("raw simulated stdout text");
    expect(persisted).not.toContain("raw simulated stderr text");
    expect(reloaded?.resultSummary).toMatchObject({
      state: "completed",
      exitCode: 0,
      stdout: "",
      stderr: "",
      stdoutBytes: 25,
      stderrBytes: 25
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

  it("json-file repository completes claimed jobs and reloads terminal metadata", async () => {
    const filePath = await createTempFilePath();
    const repository = createJsonFileWorkerJobRepository({ filePath });
    await repository.save(
      workerJobRecord({
        id: "worker_job_claimed",
        state: "running",
        startedAt: "2026-05-18T00:01:00.000Z",
        claimedByWorkerId: "worker_a",
        claimToken: "claim_token_1"
      })
    );

    const completed = await completeClaimed(repository, {
      jobId: "worker_job_claimed",
      claimToken: "claim_token_1",
      state: "cancelled",
      resultSummary: {
        state: "cancelled",
        stdout: "",
        stderr: "Worker job cancelled.",
        stdoutBytes: 0,
        stderrBytes: 21,
        errorName: "worker_job_cancelled"
      },
      errorName: "worker_job_cancelled",
      completedAt: "2026-05-18T00:02:00.000Z"
    });

    const reopened = createJsonFileWorkerJobRepository({ filePath });
    await expect(reopened.getById("worker_job_claimed")).resolves.toMatchObject({
      id: "worker_job_claimed",
      state: "cancelled",
      errorName: "worker_job_cancelled",
      cancelRequestedAt: "2026-05-18T00:02:00.000Z",
      cancelledAt: "2026-05-18T00:02:00.000Z",
      completedAt: "2026-05-18T00:02:00.000Z",
      resultSummary: {
        state: "cancelled",
        stderr: "",
        stderrBytes: 21,
        errorName: "worker_job_cancelled"
      }
    });
    expect(completed).toMatchObject({
      id: "worker_job_claimed",
      state: "cancelled",
      cancelRequestedAt: "2026-05-18T00:02:00.000Z"
    });
  });

  it("json-file repository does not revive completed jobs during running cancellation", async () => {
    const filePath = await createTempFilePath();
    const repository = createJsonFileWorkerJobRepository({ filePath });
    await repository.save(
      workerJobRecord({
        id: "worker_job_completed",
        state: "completed",
        completedAt: "2026-05-18T00:02:00.000Z",
        resultSummary: {
          state: "completed",
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          stdoutBytes: 2,
          stderrBytes: 0
        }
      })
    );

    const completed = await requestRunningCancellation(repository, {
      jobId: "worker_job_completed",
      cancelRequestedAt: "2026-05-18T00:02:30.000Z",
      cancelReason: "Too late"
    });

    const reopened = createJsonFileWorkerJobRepository({ filePath });
    const reloaded = await reopened.getById("worker_job_completed");

    expect(completed).toMatchObject({
      id: "worker_job_completed",
      state: "completed",
      completedAt: "2026-05-18T00:02:00.000Z",
      resultSummary: {
        state: "completed",
        stdout: "",
        stdoutBytes: 2
      }
    });
    expect(reloaded).toEqual(completed);
    expect(reloaded?.cancelRequestedAt).toBeUndefined();
  });

  it("json-file repository does not overwrite completed jobs during queued cancellation", async () => {
    const filePath = await createTempFilePath();
    const repository = createJsonFileWorkerJobRepository({ filePath });
    await repository.save(
      workerJobRecord({
        id: "worker_job_completed",
        state: "completed",
        completedAt: "2026-05-18T00:02:00.000Z",
        resultSummary: {
          state: "completed",
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          stdoutBytes: 2,
          stderrBytes: 0
        }
      })
    );

    const completed = await cancelQueued(repository, {
      jobId: "worker_job_completed",
      errorName: "worker_job_cancelled",
      resultSummary: {
        state: "cancelled",
        stdout: "",
        stderr: "Worker job cancelled before execution.",
        stdoutBytes: 0,
        stderrBytes: 38,
        errorName: "worker_job_cancelled"
      },
      cancelRequestedAt: "2026-05-18T00:03:00.000Z",
      cancelledAt: "2026-05-18T00:03:00.000Z",
      completedAt: "2026-05-18T00:03:00.000Z",
      cancelReason: "Too late"
    });

    const reopened = createJsonFileWorkerJobRepository({ filePath });
    const reloaded = await reopened.getById("worker_job_completed");

    expect(completed).toMatchObject({
      id: "worker_job_completed",
      state: "completed",
      completedAt: "2026-05-18T00:02:00.000Z",
      resultSummary: {
        state: "completed",
        stdout: "",
        stdoutBytes: 2
      }
    });
    expect(reloaded).toEqual(completed);
    expect(reloaded?.cancelRequestedAt).toBeUndefined();
  });
});
