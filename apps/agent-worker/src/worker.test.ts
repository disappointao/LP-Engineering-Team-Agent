import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkerQueueRuntime } from "@lp-agent/api";
import {
  InMemoryWorkerJobPayloadRepository,
  InMemoryWorkerJobRepository,
  InMemoryWorkerLogRepository,
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter,
  createJsonFileWorkerJobPayloadRepository,
  createJsonFileWorkerJobRepository,
  createSimulatedSandboxPolicy,
  type ExecutionAdapter,
  type ExecutionContext,
  type ExecutionInput,
  type ExecutionResult,
  type SafeWorkerJobInput,
  type SandboxPolicy
} from "@lp-agent/worker-runtime";
import { describe, expect, it, vi } from "vitest";
import { runDemoWorkerJob, runWorkerDaemon, runWorkerOnce } from "./worker";

describe("agent worker", () => {
  it("runs the demo workbench flow and returns reviewed deployment records", async () => {
    const result = await runDemoWorkerJob();

    expect(result.project).toMatchObject({
      id: "project_1",
      name: "Demo LP Project"
    });
    expect(result.brief).toMatchObject({
      id: "brief_1",
      projectId: "project_1",
      prompt: "Create a lightweight spring ecommerce landing page."
    });
    expect(result.pageVersion).toMatchObject({
      id: "version_1",
      projectId: "project_1",
      briefId: "brief_1",
      reviewStatus: "passed",
      findings: []
    });
    expect(result.deployment).toMatchObject({
      id: "deployment_1",
      projectId: "project_1",
      pageVersionId: "version_1",
      branch: "lp-agent/project_1/version_1",
      status: "pr_opened"
    });
    expect(result.deployment.pullRequestUrl).toBe("https://git.example.local/pr/deployment_1");
  });
});

describe("worker queue handoff", () => {
  it("returns undefined when no queued worker job exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-worker-"));
    try {
      const result = await runWorkerOnce({
        workerId: "worker_a",
        jobRepository: createJsonFileWorkerJobRepository({
          filePath: join(directory, "worker-jobs.json")
        }),
        payloadRepository: createJsonFileWorkerJobPayloadRepository({
          filePath: join(directory, "worker-job-payloads.json")
        })
      });

      expect(result).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("claims and completes one safe simulated worker job", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-worker-"));
    const jobsFilePath = join(directory, "worker-jobs.json");
    const payloadsFilePath = join(directory, "worker-job-payloads.json");
    try {
      const apiRuntime = new InMemoryWorkerRuntime({
        repository: createJsonFileWorkerJobRepository({ filePath: jobsFilePath }),
        payloadRepository: createJsonFileWorkerJobPayloadRepository({
          filePath: payloadsFilePath
        }),
        now: () => new Date("2026-05-18T00:00:00.000Z")
      });
      const queued = await apiRuntime.enqueueSafe(
        safeInput(),
        createSimulatedSandboxPolicy({
          allowedCommands: ["build"],
          allowedEnvNames: ["PUBLIC_FLAG"],
          timeoutMs: 1000
        })
      );

      const result = await runWorkerOnce({
        workerId: "worker_a",
        jobRepository: createJsonFileWorkerJobRepository({ filePath: jobsFilePath }),
        payloadRepository: createJsonFileWorkerJobPayloadRepository({
          filePath: payloadsFilePath
        }),
        adapter: new SimulatedExecutionAdapter(),
        claimTokenFactory: () => "claim_token_1",
        now: createClock([
          "2026-05-18T00:00:01.000Z",
          "2026-05-18T00:00:02.000Z"
        ])
      });
      const stored = await apiRuntime.getJob(queued.id);

      expect(result).toMatchObject({
        id: queued.id,
        state: "completed",
        claimedByWorkerId: "worker_a",
        resultSummary: {
          stdout: "Simulated build for project project_a."
        }
      });
      expect(stored).toMatchObject({
        id: queued.id,
        state: "completed",
        claimedByWorkerId: "worker_a",
        resultSummary: {
          state: "completed",
          stdout: "",
          stderr: "",
          stdoutBytes: 38,
          stderrBytes: 0
        }
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("runs against explicit postgres backend repositories without worker JSON files", async () => {
    const repositories = {
      jobRepository: new InMemoryWorkerJobRepository(),
      payloadRepository: new InMemoryWorkerJobPayloadRepository(),
      workerLogRepository: new InMemoryWorkerLogRepository()
    };
    const loadPrismaClient = vi.fn(async () => ({ prisma: true }));
    const createPrismaWorkerRepositories = vi.fn(() => repositories);
    const queueRuntime = await createWorkerQueueRuntime({
      env: {
        WORKER_REPOSITORY_BACKEND: "postgres",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/lp_agent"
      },
      loadPrismaClient,
      createPrismaWorkerRepositories
    });
    const queued = await queueRuntime.runtime.enqueueSafe(safeInput(), simulatedPolicy());

    const result = await runWorkerOnce({
      workerId: "worker_postgres",
      jobRepository: queueRuntime.jobRepository,
      payloadRepository: queueRuntime.payloadRepository,
      workerLogRepository: queueRuntime.workerLogRepository,
      adapter: new SimulatedExecutionAdapter(),
      claimTokenFactory: () => "claim_token_postgres",
      now: createClock([
        "2026-05-20T00:00:01.000Z",
        "2026-05-20T00:00:02.000Z"
      ])
    });

    expect(loadPrismaClient).toHaveBeenCalledTimes(1);
    expect(createPrismaWorkerRepositories).toHaveBeenCalledWith({ prisma: true });
    expect(result).toMatchObject({
      id: queued.id,
      state: "completed",
      claimedByWorkerId: "worker_postgres"
    });
    await expect(queueRuntime.workerLogRepository.list({ limit: 10 })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workerJobId: queued.id,
          type: "worker.job.completed"
        })
      ])
    );
  });

  it("rejects invalid heartbeat timeout before claiming a queued worker job", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-worker-"));
    const jobsFilePath = join(directory, "worker-jobs.json");
    const payloadsFilePath = join(directory, "worker-job-payloads.json");
    try {
      const apiRuntime = new InMemoryWorkerRuntime({
        repository: createJsonFileWorkerJobRepository({ filePath: jobsFilePath }),
        payloadRepository: createJsonFileWorkerJobPayloadRepository({
          filePath: payloadsFilePath
        }),
        now: () => new Date("2026-05-19T00:00:00.000Z")
      });
      const queued = await apiRuntime.enqueueSafe(safeInput(), simulatedPolicy());

      await expect(
        runWorkerOnce({
          workerId: "worker_a",
          jobRepository: createJsonFileWorkerJobRepository({ filePath: jobsFilePath }),
          payloadRepository: createJsonFileWorkerJobPayloadRepository({
            filePath: payloadsFilePath
          }),
          heartbeatTimeoutMs: 0
        })
      ).rejects.toThrow("worker_heartbeat_timeout_invalid");
      await expect(apiRuntime.getJob(queued.id)).resolves.toMatchObject({
        id: queued.id,
        state: "queued"
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refreshes heartbeat while a claimed worker job is still executing", async () => {
    vi.useFakeTimers();
    try {
      const repository = new InMemoryWorkerJobRepository();
      const payloadRepository = new InMemoryWorkerJobPayloadRepository();
      const logs = new InMemoryWorkerLogRepository();
      const apiRuntime = new InMemoryWorkerRuntime({
        repository,
        payloadRepository,
        now: () => new Date("2026-05-19T00:00:00.000Z")
      });
      const adapter = new DeferredExecutionAdapter();
      const queued = await apiRuntime.enqueueSafe(safeInput(), simulatedPolicy());

      const run = runWorkerOnce({
        workerId: "worker_a",
        jobRepository: repository,
        payloadRepository,
        workerLogRepository: logs,
        adapter,
        claimTokenFactory: () => "claim_token_1",
        heartbeatTimeoutMs: 1000,
        heartbeatIntervalMs: 10,
        now: createClock([
          "2026-05-19T00:00:01.000Z",
          "2026-05-19T00:00:02.000Z",
          "2026-05-19T00:00:03.000Z",
          "2026-05-19T00:00:04.000Z",
          "2026-05-19T00:00:05.000Z",
          "2026-05-19T00:00:06.000Z"
        ])
      });

      await adapter.started;
      await vi.advanceTimersByTimeAsync(10);
      await expect(apiRuntime.getJob(queued.id)).resolves.toMatchObject({
        state: "running",
        lastHeartbeatAt: "2026-05-19T00:00:05.000Z",
        heartbeatExpiresAt: "2026-05-19T00:00:06.000Z"
      });

      adapter.complete({
        state: "completed",
        exitCode: 0,
        stdout: "done",
        stderr: ""
      });
      await expect(run).resolves.toMatchObject({
        id: queued.id,
        state: "completed"
      });
      await expect(logs.list({ projectId: "project_a", limit: 10 })).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "worker.job.heartbeat" }),
          expect.objectContaining({ type: "worker.job.completed" })
        ])
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("worker daemon", () => {
  it("runs bounded idle iterations and writes idle logs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-worker-daemon-"));
    try {
      const logs = new InMemoryWorkerLogRepository();
      const result = await runWorkerDaemon({
        workerId: "worker_a",
        jobRepository: createJsonFileWorkerJobRepository({
          filePath: join(directory, "worker-jobs.json")
        }),
        payloadRepository: createJsonFileWorkerJobPayloadRepository({
          filePath: join(directory, "worker-payloads.json")
        }),
        workerLogRepository: logs,
        maxIterations: 2,
        pollIntervalMs: 10,
        heartbeatTimeoutMs: 1000,
        staleClaimTimeoutMs: 1000,
        maxStaleRecoveryCount: 1,
        sleep: async () => undefined,
        now: createClock([
          "2026-05-19T00:00:00.000Z",
          "2026-05-19T00:00:01.000Z",
          "2026-05-19T00:00:02.000Z",
          "2026-05-19T00:00:03.000Z"
        ])
      });

      expect(result).toEqual({
        iterations: 2,
        processedJobs: 0,
        idleIterations: 2,
        stoppedReason: "max_iterations"
      });
      await expect(logs.list({ limit: 10 })).resolves.toEqual([
        expect.objectContaining({ type: "worker.daemon.idle" }),
        expect.objectContaining({ type: "worker.daemon.idle" })
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not sleep after the final idle iteration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-worker-daemon-"));
    try {
      const sleep = vi.fn(async () => undefined);

      await runWorkerDaemon({
        workerId: "worker_a",
        jobRepository: createJsonFileWorkerJobRepository({
          filePath: join(directory, "worker-jobs.json")
        }),
        payloadRepository: createJsonFileWorkerJobPayloadRepository({
          filePath: join(directory, "worker-payloads.json")
        }),
        maxIterations: 2,
        pollIntervalMs: 10,
        heartbeatTimeoutMs: 1000,
        staleClaimTimeoutMs: 1000,
        maxStaleRecoveryCount: 1,
        sleep
      });

      expect(sleep).toHaveBeenCalledTimes(1);
      expect(sleep).toHaveBeenCalledWith(10);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("claims, heartbeats, completes, finalizes, and logs one daemon job", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-worker-daemon-"));
    const jobsFilePath = join(directory, "worker-jobs.json");
    const payloadsFilePath = join(directory, "worker-payloads.json");
    try {
      const logs = new InMemoryWorkerLogRepository();
      const apiRuntime = new InMemoryWorkerRuntime({
        repository: createJsonFileWorkerJobRepository({ filePath: jobsFilePath }),
        payloadRepository: createJsonFileWorkerJobPayloadRepository({
          filePath: payloadsFilePath
        }),
        now: () => new Date("2026-05-19T00:00:00.000Z")
      });
      const queued = await apiRuntime.enqueueSafe(
        safeInput(),
        createSimulatedSandboxPolicy({
          allowedCommands: ["build"],
          allowedEnvNames: ["PUBLIC_FLAG"],
          timeoutMs: 1000
        })
      );
      const finalizeWorkerJob = vi.fn(async () => undefined);

      const result = await runWorkerDaemon({
        workerId: "worker_a",
        jobRepository: createJsonFileWorkerJobRepository({ filePath: jobsFilePath }),
        payloadRepository: createJsonFileWorkerJobPayloadRepository({
          filePath: payloadsFilePath
        }),
        workerLogRepository: logs,
        adapter: new SimulatedExecutionAdapter(),
        claimTokenFactory: () => "claim_token_1",
        finalizeWorkerJob,
        maxIterations: 1,
        pollIntervalMs: 10,
        heartbeatTimeoutMs: 1000,
        staleClaimTimeoutMs: 1000,
        maxStaleRecoveryCount: 1,
        sleep: async () => undefined,
        now: createClock([
          "2026-05-19T00:00:01.000Z",
          "2026-05-19T00:00:02.000Z",
          "2026-05-19T00:00:03.000Z",
          "2026-05-19T00:00:04.000Z"
        ])
      });

      expect(result.processedJobs).toBe(1);
      expect(finalizeWorkerJob).toHaveBeenCalledWith(
        expect.objectContaining({ id: queued.id, state: "completed" })
      );
      await expect(logs.list({ projectId: "project_a", limit: 10 })).resolves.toEqual([
        expect.objectContaining({ type: "worker.job.completed" }),
        expect.objectContaining({ type: "worker.job.heartbeat" }),
        expect.objectContaining({ type: "worker.job.claimed" })
      ]);
      const storedLogs = await logs.list({ projectId: "project_a", limit: 10 });
      const terminalLog = storedLogs.find((log) => log.type === "worker.job.completed");
      expect(terminalLog?.payload.outputSummary).toBe("stdout: 38 bytes\nstderr: 0 bytes");
      expect(JSON.stringify(terminalLog)).not.toContain("Simulated build for project project_a.");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("logs finalization failures without rerunning completed jobs", async () => {
    const logs = new InMemoryWorkerLogRepository();
    const directory = await mkdtemp(join(tmpdir(), "agent-worker-daemon-"));
    const jobsFilePath = join(directory, "worker-jobs.json");
    const payloadsFilePath = join(directory, "worker-payloads.json");
    try {
      const apiRuntime = new InMemoryWorkerRuntime({
        repository: createJsonFileWorkerJobRepository({ filePath: jobsFilePath }),
        payloadRepository: createJsonFileWorkerJobPayloadRepository({
          filePath: payloadsFilePath
        }),
        now: () => new Date("2026-05-19T00:00:00.000Z")
      });
      await apiRuntime.enqueueSafe(safeInput(), simulatedPolicy());

      await runWorkerDaemon({
        workerId: "worker_a",
        jobRepository: createJsonFileWorkerJobRepository({ filePath: jobsFilePath }),
        payloadRepository: createJsonFileWorkerJobPayloadRepository({
          filePath: payloadsFilePath
        }),
        workerLogRepository: logs,
        adapter: new SimulatedExecutionAdapter(),
        claimTokenFactory: () => "claim_token_1",
        finalizeWorkerJob: async () => {
          throw new Error("finalizer failed");
        },
        maxIterations: 1,
        pollIntervalMs: 10,
        heartbeatTimeoutMs: 1000,
        staleClaimTimeoutMs: 1000,
        maxStaleRecoveryCount: 1,
        sleep: async () => undefined,
        now: createClock([
          "2026-05-19T00:00:01.000Z",
          "2026-05-19T00:00:02.000Z",
          "2026-05-19T00:00:03.000Z",
          "2026-05-19T00:00:04.000Z"
        ])
      });

      await expect(logs.list({ limit: 10 })).resolves.toEqual([
        expect.objectContaining({
          type: "worker.job.finalization_failed",
          payload: expect.objectContaining({ errorName: "Error" })
        }),
        expect.objectContaining({ type: "worker.job.completed" }),
        expect.objectContaining({ type: "worker.job.heartbeat" }),
        expect.objectContaining({ type: "worker.job.claimed" })
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("recovers a stale running job, logs recovery, and processes the requeued job", async () => {
    const logs = new InMemoryWorkerLogRepository();
    const directory = await mkdtemp(join(tmpdir(), "agent-worker-daemon-"));
    const jobsFilePath = join(directory, "worker-jobs.json");
    const payloadsFilePath = join(directory, "worker-payloads.json");
    try {
      const apiRuntime = new InMemoryWorkerRuntime({
        repository: createJsonFileWorkerJobRepository({ filePath: jobsFilePath }),
        payloadRepository: createJsonFileWorkerJobPayloadRepository({
          filePath: payloadsFilePath
        }),
        claimTokenFactory: () => "stale_claim_token",
        now: createClock([
          "2026-05-19T00:00:00.000Z",
          "2026-05-19T00:00:01.000Z",
          "2026-05-19T00:00:02.000Z"
        ])
      });
      const queued = await apiRuntime.enqueueSafe(safeInput(), simulatedPolicy());
      const staleClaim = await apiRuntime.claimOldestQueued({ workerId: "worker_stale" });
      if (!staleClaim) {
        throw new Error("Expected stale claim.");
      }
      await apiRuntime.heartbeatClaimedJob({
        jobId: staleClaim.record.id,
        claimToken: staleClaim.claimToken,
        workerId: "worker_stale",
        heartbeatTimeoutMs: 1000
      });

      const result = await runWorkerDaemon({
        workerId: "worker_a",
        jobRepository: createJsonFileWorkerJobRepository({ filePath: jobsFilePath }),
        payloadRepository: createJsonFileWorkerJobPayloadRepository({
          filePath: payloadsFilePath
        }),
        workerLogRepository: logs,
        adapter: new SimulatedExecutionAdapter(),
        claimTokenFactory: () => "fresh_claim_token",
        maxIterations: 1,
        pollIntervalMs: 10,
        heartbeatTimeoutMs: 1000,
        staleClaimTimeoutMs: 1000,
        maxStaleRecoveryCount: 1,
        sleep: async () => undefined,
        now: createClock([
          "2026-05-19T00:00:04.000Z",
          "2026-05-19T00:00:05.000Z",
          "2026-05-19T00:00:06.000Z",
          "2026-05-19T00:00:07.000Z",
          "2026-05-19T00:00:08.000Z"
        ])
      });
      const stored = await apiRuntime.getJob(queued.id);

      expect(result).toMatchObject({ processedJobs: 1, idleIterations: 0 });
      expect(stored).toMatchObject({
        id: queued.id,
        state: "completed",
        staleRecoveryCount: 1,
        claimedByWorkerId: "worker_a"
      });
      await expect(logs.list({ limit: 10 })).resolves.toEqual([
        expect.objectContaining({ type: "worker.job.completed" }),
        expect.objectContaining({ type: "worker.job.heartbeat" }),
        expect.objectContaining({ type: "worker.job.claimed" }),
        expect.objectContaining({ type: "worker.job.stale_recovered" })
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects invalid daemon numbers before claiming a queued worker job", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-worker-daemon-"));
    const jobsFilePath = join(directory, "worker-jobs.json");
    const payloadsFilePath = join(directory, "worker-payloads.json");
    try {
      const apiRuntime = new InMemoryWorkerRuntime({
        repository: createJsonFileWorkerJobRepository({ filePath: jobsFilePath }),
        payloadRepository: createJsonFileWorkerJobPayloadRepository({
          filePath: payloadsFilePath
        }),
        now: () => new Date("2026-05-19T00:00:00.000Z")
      });
      const queued = await apiRuntime.enqueueSafe(safeInput(), simulatedPolicy());

      await expect(
        runWorkerDaemon({
          workerId: "worker_a",
          jobRepository: createJsonFileWorkerJobRepository({ filePath: jobsFilePath }),
          payloadRepository: createJsonFileWorkerJobPayloadRepository({
            filePath: payloadsFilePath
          }),
          maxIterations: 1,
          pollIntervalMs: 10,
          heartbeatTimeoutMs: Number.NaN,
          staleClaimTimeoutMs: 1000,
          maxStaleRecoveryCount: 1,
          sleep: async () => undefined
        })
      ).rejects.toThrow("worker_heartbeat_timeout_invalid");
      await expect(apiRuntime.getJob(queued.id)).resolves.toMatchObject({
        id: queued.id,
        state: "queued"
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function safeInput(
  overrides: Partial<SafeWorkerJobInput> = {}
): SafeWorkerJobInput {
  return {
    projectId: "project_a",
    kind: "tool_command",
    command: "build",
    args: ["--fast"],
    envNames: ["PUBLIC_FLAG"],
    timeoutMs: 1000,
    ...overrides
  };
}

function simulatedPolicy() {
  return createSimulatedSandboxPolicy({
    allowedCommands: ["build"],
    allowedEnvNames: ["PUBLIC_FLAG"],
    timeoutMs: 1000
  });
}

function createClock(values: string[]): () => Date {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)]!;
    index += 1;
    return new Date(value);
  };
}

class DeferredExecutionAdapter implements ExecutionAdapter {
  readonly started: Promise<void>;
  private readonly resolveStarted: () => void;
  private readonly result: Promise<ExecutionResult>;
  private resolveResult: (result: ExecutionResult) => void = () => undefined;

  constructor() {
    let resolveStarted: () => void = () => undefined;
    this.started = new Promise((resolve) => {
      resolveStarted = resolve;
    });
    this.resolveStarted = resolveStarted;
    this.result = new Promise((resolve) => {
      this.resolveResult = resolve;
    });
  }

  async execute(
    _input: ExecutionInput,
    _policy: SandboxPolicy,
    _context: ExecutionContext
  ): Promise<ExecutionResult> {
    this.resolveStarted();
    return this.result;
  }

  complete(result: ExecutionResult): void {
    this.resolveResult(result);
  }
}
