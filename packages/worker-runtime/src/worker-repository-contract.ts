import { describe, expect, it } from "vitest";

import type {
  SandboxPolicy,
  WorkerJobPayloadRecord,
  WorkerJobPayloadRepository,
  WorkerJobRecord,
  WorkerJobRepository,
  WorkerJobResultSummary,
  WorkerLogRecord,
  WorkerLogRepository
} from "./index";

type MaybePromise<T> = T | Promise<T>;

export type WorkerJobRepositoryFactory = () => MaybePromise<WorkerJobRepository>;
export type WorkerJobPayloadRepositoryFactory =
  () => MaybePromise<WorkerJobPayloadRepository>;
export type WorkerLogRepositoryFactory = () => MaybePromise<WorkerLogRepository>;

export function createContractWorkerJobRecord(
  overrides: Partial<WorkerJobRecord> = {}
): WorkerJobRecord {
  const projectId = overrides.projectId ?? "project-1";
  const command = overrides.inputSummary?.command ?? "deploy preview";
  const envNames = overrides.inputSummary?.envNames ?? ["DEPLOY_TOKEN"];

  return {
    id: "worker-job-1",
    projectId,
    kind: "tool_command",
    state: "queued",
    payloadSource: "safe_persisted",
    policy: createContractSandboxPolicy(command, envNames),
    inputSummary: {
      projectId,
      kind: "tool_command",
      commandId: "deploy-preview",
      command,
      argCount: 1,
      envNames,
      timeoutMs: 30_000,
      ...overrides.inputSummary
    },
    createdAt: "2026-05-20T00:00:00.000Z",
    ...overrides
  };
}

export function createContractWorkerJobPayloadRecord(
  overrides: Partial<WorkerJobPayloadRecord> = {}
): WorkerJobPayloadRecord {
  return {
    jobId: "worker-job-1",
    kind: "safe_simulated_tool_command",
    projectId: "project-1",
    commandId: "deploy-preview",
    command: "deploy preview",
    args: ["--preview"],
    envNames: ["DEPLOY_TOKEN"],
    workingDirectory: "workspace",
    timeoutMs: 30_000,
    createdAt: "2026-05-20T00:00:01.000Z",
    ...overrides
  };
}

export function createContractWorkerLogRecord(
  overrides: Partial<WorkerLogRecord> = {}
): WorkerLogRecord {
  return {
    id: "worker-log-1",
    type: "worker.job.completed",
    message: "Worker job completed",
    workerId: "worker-1",
    workerJobId: "worker-job-1",
    projectId: "project-1",
    payload: {
      workerJobId: "worker-job-1",
      state: "completed",
      outputSummary: "ok"
    },
    createdAt: "2026-05-20T00:00:02.000Z",
    ...overrides
  };
}

export function runWorkerJobRepositoryContractTests(
  name: string,
  createRepository: WorkerJobRepositoryFactory
): void {
  describe(`${name} worker job repository contract`, () => {
    it("saves defensive copies and lists jobs in created order", async () => {
      const repository = await createRepository();
      const later = createContractWorkerJobRecord({
        id: "job-later",
        createdAt: "2026-05-20T00:00:03.000Z"
      });
      const earlier = createContractWorkerJobRecord({
        id: "job-earlier",
        createdAt: "2026-05-20T00:00:01.000Z"
      });

      await repository.save(later);
      await repository.save(earlier);
      earlier.state = "failed";
      earlier.inputSummary.envNames.push("MUTATED");

      expect((await repository.getById("job-earlier"))?.state).toBe("queued");
      expect(
        (await repository.getById("job-earlier"))?.inputSummary.envNames
      ).toEqual(["DEPLOY_TOKEN"]);
      expect((await repository.listForProject("project-1")).map((job) => job.id))
        .toEqual(["job-earlier", "job-later"]);
    });

    it("claims only queued jobs matching payload source and project", async () => {
      const repository = await createRepository();
      await repository.save(
        createContractWorkerJobRecord({
          id: "job-memory",
          createdAt: "2026-05-20T00:00:00.000Z",
          payloadSource: "process_memory"
        })
      );
      await repository.save(
        createContractWorkerJobRecord({
          id: "job-safe",
          createdAt: "2026-05-20T00:00:01.000Z",
          payloadSource: "safe_persisted"
        })
      );
      await repository.save(
        createContractWorkerJobRecord({
          id: "job-other-project",
          projectId: "project-2",
          createdAt: "2026-05-20T00:00:02.000Z",
          payloadSource: "safe_persisted"
        })
      );

      const claimed = await repository.claimOldestQueued({
        payloadSource: "safe_persisted",
        startedAt: "2026-05-20T00:01:00.000Z",
        claimedByWorkerId: "worker-1",
        claimToken: "claim-token-1",
        projectId: "project-1"
      });

      expect(claimed).toMatchObject({
        id: "job-safe",
        state: "running",
        claimedByWorkerId: "worker-1",
        claimToken: "claim-token-1"
      });
      expect(
        await repository.claimOldestQueued({
          payloadSource: "safe_persisted",
          startedAt: "2026-05-20T00:01:01.000Z",
          claimedByWorkerId: "worker-2",
          claimToken: "claim-token-2",
          projectId: "project-1"
        })
      ).toBeUndefined();
      expect((await repository.getById("job-memory"))?.state).toBe("queued");
      expect((await repository.getById("job-other-project"))?.state).toBe(
        "queued"
      );
    });

    it("heartbeats and completes only matching claimed running jobs", async () => {
      const repository = await createRepository();
      await repository.save(createContractWorkerJobRecord({ id: "job-1" }));
      const claimed = await repository.claimOldestQueued({
        payloadSource: "safe_persisted",
        startedAt: "2026-05-20T00:01:00.000Z",
        claimedByWorkerId: "worker-1",
        claimToken: "claim-token-1"
      });

      expect(claimed?.id).toBe("job-1");
      expect(
        await repository.heartbeatClaimed({
          jobId: "job-1",
          workerId: "worker-1",
          claimToken: "wrong-token",
          heartbeatAt: "2026-05-20T00:02:00.000Z",
          heartbeatExpiresAt: "2026-05-20T00:07:00.000Z"
        })
      ).toBeUndefined();

      const heartbeat = await repository.heartbeatClaimed({
        jobId: "job-1",
        workerId: "worker-1",
        claimToken: "claim-token-1",
        heartbeatAt: "2026-05-20T00:02:00.000Z",
        heartbeatExpiresAt: "2026-05-20T00:07:00.000Z"
      });
      expect(heartbeat?.lastHeartbeatAt).toBe("2026-05-20T00:02:00.000Z");

      expect(
        await repository.completeClaimed({
          jobId: "job-1",
          claimToken: "wrong-token",
          state: "completed",
          resultSummary: createContractResultSummary("completed"),
          completedAt: "2026-05-20T00:03:00.000Z"
        })
      ).toBeUndefined();

      const completed = await repository.completeClaimed({
        jobId: "job-1",
        claimToken: "claim-token-1",
        state: "completed",
        resultSummary: createContractResultSummary("completed"),
        completedAt: "2026-05-20T00:03:00.000Z"
      });
      expect(completed).toMatchObject({
        state: "completed",
        claimToken: "claim-token-1",
        completedAt: "2026-05-20T00:03:00.000Z",
        resultSummary: {
          state: "completed",
          exitCode: 0
        }
      });
    });

    it("handles queued cancellation, running cancellation, and stale safe recovery", async () => {
      const repository = await createRepository();
      await repository.save(createContractWorkerJobRecord({ id: "queued-job" }));
      const cancelled = await repository.cancelQueued({
        jobId: "queued-job",
        errorName: "worker_job_cancelled",
        resultSummary: createContractResultSummary("cancelled"),
        cancelRequestedAt: "2026-05-20T00:02:00.000Z",
        cancelledAt: "2026-05-20T00:02:00.000Z",
        completedAt: "2026-05-20T00:02:00.000Z",
        cancelReason: "user_requested"
      });
      expect(cancelled).toMatchObject({
        state: "cancelled",
        cancelReason: "user_requested"
      });

      await repository.save(createContractWorkerJobRecord({ id: "running-job" }));
      await repository.claimOldestQueued({
        payloadSource: "safe_persisted",
        startedAt: "2026-05-20T00:01:00.000Z",
        claimedByWorkerId: "worker-1",
        claimToken: "claim-token-1"
      });
      const requested = await repository.requestRunningCancellation({
        jobId: "running-job",
        cancelRequestedAt: "2026-05-20T00:01:30.000Z",
        cancelReason: "user_requested"
      });
      expect(requested?.cancelRequestedAt).toBe("2026-05-20T00:01:30.000Z");

      const recovered = await repository.recoverStale({
        staleBefore: "2026-05-20T00:03:00.000Z",
        recoveredAt: "2026-05-20T00:03:00.000Z",
        staleClaimTimeoutMs: 1000,
        maxStaleRecoveryCount: 1
      });
      expect(recovered.map((job) => job.jobId)).toContain("running-job");
      expect((await repository.getById("running-job"))?.state).toBe("cancelled");
    });
  });
}

export function runWorkerJobPayloadRepositoryContractTests(
  name: string,
  createRepository: WorkerJobPayloadRepositoryFactory
): void {
  describe(`${name} worker job payload repository contract`, () => {
    it("stores defensive copies and canonical env names", async () => {
      const repository = await createRepository();
      const payload = createContractWorkerJobPayloadRecord({
        envNames: ["Z_TOKEN", "A_TOKEN", "A_TOKEN"]
      });

      await repository.save(payload);
      payload.args.push("--mutated");

      const stored = await repository.getByJobId("worker-job-1");
      expect(stored?.args).toEqual(["--preview"]);
      expect(stored?.envNames).toEqual(["A_TOKEN", "Z_TOKEN"]);
    });

    it("rejects unsafe payloads and deletes idempotently", async () => {
      const repository = await createRepository();
      await expect(
        repository.save({
          ...createContractWorkerJobPayloadRecord(),
          kind: "raw_shell_command"
        } as unknown as WorkerJobPayloadRecord)
      ).rejects.toMatchObject({ code: "worker_job_payload_kind_not_supported" });

      await repository.deleteByJobId("missing-job");
      await repository.save(createContractWorkerJobPayloadRecord());
      await repository.deleteByJobId("worker-job-1");
      expect(await repository.getByJobId("worker-job-1")).toBeUndefined();
    });
  });
}

export function runWorkerLogRepositoryContractTests(
  name: string,
  createRepository: WorkerLogRepositoryFactory
): void {
  describe(`${name} worker log repository contract`, () => {
    it("sanitizes payload and lists newest first with filters", async () => {
      const repository = await createRepository();
      await repository.append(
        createContractWorkerLogRecord({
          id: "older",
          createdAt: "2026-05-20T00:00:01.000Z",
          payload: {
            workerJobId: "worker-job-1",
            state: "running",
            rawStdout: "must not persist",
            secret: "must not persist"
          }
        })
      );
      await repository.append(
        createContractWorkerLogRecord({
          id: "newer",
          workerJobId: "worker-job-2",
          createdAt: "2026-05-20T00:00:02.000Z"
        })
      );

      const all = await repository.list({ projectId: "project-1", limit: 10 });
      expect(all.map((log) => log.id)).toEqual(["newer", "older"]);
      expect(all[1]?.payload).toEqual({
        workerJobId: "worker-job-1",
        state: "running"
      });

      const filtered = await repository.list({
        workerJobId: "worker-job-2",
        limit: 10
      });
      expect(filtered.map((log) => log.id)).toEqual(["newer"]);
    });
  });
}

function createContractSandboxPolicy(
  command: string,
  envNames: string[]
): SandboxPolicy {
  return {
    mode: "simulate",
    allowedCommands: [command],
    allowedEnvNames: [...envNames],
    timeoutMs: 30_000,
    maxStdoutBytes: 1024,
    maxStderrBytes: 1024,
    network: "disabled"
  };
}

function createContractResultSummary(
  state: "completed" | "cancelled"
): WorkerJobResultSummary {
  return {
    state,
    exitCode: state === "completed" ? 0 : undefined,
    stdout: "",
    stderr: state === "completed" ? "" : "Worker job cancelled before execution.",
    stdoutBytes: 0,
    stderrBytes: state === "completed" ? 0 : 38,
    errorName: state === "cancelled" ? "worker_job_cancelled" : undefined
  };
}
