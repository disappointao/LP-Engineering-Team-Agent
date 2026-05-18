import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  InMemoryWorkerJobPayloadRepository,
  InMemoryWorkerJobRepository,
  InMemoryWorkerRuntime,
  RejectingExecutionAdapter,
  SimulatedExecutionAdapter,
  createRejectSandboxPolicy,
  createJsonFileWorkerJobRepository,
  createJsonFileWorkerJobPayloadRepository,
  createSimulatedSandboxPolicy,
  type ExecutionAdapter,
  type ExecutionContext,
  type ExecutionInput,
  type SandboxPolicy,
  type SafeWorkerJobInput,
  type WorkerJobCompleteClaimedInput,
  type WorkerJobClaimOldestQueuedInput,
  type WorkerJobCancelQueuedInput,
  type WorkerJobPayloadRecord,
  type WorkerJobPayloadRepository,
  type WorkerJobRepository,
  type WorkerJobRequestRunningCancellationInput,
  type WorkerJobRecord,
  type WorkerJobInput
} from "./index";

const baseInput = (overrides: Partial<WorkerJobInput> = {}): WorkerJobInput => ({
  projectId: "project_a",
  kind: "tool_command",
  command: "build",
  args: ["--fast"],
  env: {},
  timeoutMs: 1000,
  ...overrides
});

const baseSafeInput = (
  overrides: Partial<SafeWorkerJobInput> = {}
): SafeWorkerJobInput => ({
  projectId: "project_a",
  kind: "tool_command",
  command: "build",
  args: ["--fast"],
  envNames: ["PUBLIC_FLAG"],
  timeoutMs: 1000,
  ...overrides
});

const simulatedPolicy = (overrides: Partial<SandboxPolicy> = {}): SandboxPolicy =>
  createSimulatedSandboxPolicy({
    allowedCommands: ["build", "test"],
    allowedEnvNames: ["PUBLIC_FLAG"],
    ...overrides
  });

function workerJobRecord(overrides: Partial<WorkerJobRecord> = {}): WorkerJobRecord {
  return {
    id: "worker_job_1",
    projectId: "project_a",
    kind: "tool_command",
    state: "queued",
    policy: simulatedPolicy(),
    inputSummary: {
      projectId: "project_a",
      kind: "tool_command",
      commandId: "publish_static",
      command: "build",
      argCount: 1,
      envNames: [],
      timeoutMs: 1000
    },
    createdAt: "2026-05-17T00:00:00.000Z",
    ...overrides
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

function createClock(values: string[]): () => Date {
  if (values.length === 0) {
    throw new Error("createClock requires at least one value");
  }

  let index = 0;
  const lastValue = values[values.length - 1] as string;
  return () => new Date(values[index++] ?? lastValue);
}

const noCancellationContext: ExecutionContext = {
  isCancellationRequested: async () => false
};

class BlockingRunningSaveRepository implements WorkerJobRepository {
  private readonly repository = new InMemoryWorkerJobRepository();
  private blockedFirstRunningSave = false;
  readonly firstRunningSaveStarted = deferred<void>();
  readonly releaseFirstRunningSave = deferred<void>();

  async save(record: WorkerJobRecord): Promise<void> {
    if (record.state === "running" && !this.blockedFirstRunningSave) {
      this.blockedFirstRunningSave = true;
      this.firstRunningSaveStarted.resolve();
      await this.releaseFirstRunningSave.promise;
    }

    return this.repository.save(record);
  }

  getById(id: string): Promise<WorkerJobRecord | undefined> {
    return this.repository.getById(id);
  }

  listForProject(projectId: string): Promise<WorkerJobRecord[]> {
    return this.repository.listForProject(projectId);
  }

  listAll(): Promise<WorkerJobRecord[]> {
    return this.repository.listAll();
  }

  findOldestQueued(): Promise<WorkerJobRecord | undefined> {
    return this.repository.findOldestQueued();
  }

  claimOldestQueued(
    input: WorkerJobClaimOldestQueuedInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.repository.claimOldestQueued(input).then(async (record) => {
      if (record?.state === "running" && !this.blockedFirstRunningSave) {
        this.blockedFirstRunningSave = true;
        this.firstRunningSaveStarted.resolve();
        await this.releaseFirstRunningSave.promise;
      }

      return record;
    });
  }

  completeClaimed(
    input: WorkerJobCompleteClaimedInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.repository.completeClaimed(input);
  }

  requestRunningCancellation(
    input: WorkerJobRequestRunningCancellationInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.repository.requestRunningCancellation(input);
  }

  cancelQueued(
    input: WorkerJobCancelQueuedInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.repository.cancelQueued(input);
  }
}

class FailAllSavesWorkerJobRepository implements WorkerJobRepository {
  async save(_record: WorkerJobRecord): Promise<void> {
    throw new Error("injected job save failure");
  }

  async getById(_id: string): Promise<WorkerJobRecord | undefined> {
    return undefined;
  }

  async listForProject(_projectId: string): Promise<WorkerJobRecord[]> {
    return [];
  }

  async listAll(): Promise<WorkerJobRecord[]> {
    return [];
  }

  async findOldestQueued(): Promise<WorkerJobRecord | undefined> {
    return undefined;
  }

  async claimOldestQueued(
    _input: WorkerJobClaimOldestQueuedInput
  ): Promise<WorkerJobRecord | undefined> {
    return undefined;
  }

  async completeClaimed(
    _input: WorkerJobCompleteClaimedInput
  ): Promise<WorkerJobRecord | undefined> {
    throw new Error("injected job save failure");
  }

  async requestRunningCancellation(
    _input: WorkerJobRequestRunningCancellationInput
  ): Promise<WorkerJobRecord | undefined> {
    throw new Error("injected job save failure");
  }

  async cancelQueued(
    _input: WorkerJobCancelQueuedInput
  ): Promise<WorkerJobRecord | undefined> {
    throw new Error("injected job save failure");
  }
}

class FailDeleteWorkerJobPayloadRepository
  implements WorkerJobPayloadRepository
{
  private readonly repository = new InMemoryWorkerJobPayloadRepository();

  save(record: WorkerJobPayloadRecord): Promise<void> {
    return this.repository.save(record);
  }

  getByJobId(jobId: string): Promise<WorkerJobPayloadRecord | undefined> {
    return this.repository.getByJobId(jobId);
  }

  async deleteByJobId(_jobId: string): Promise<void> {
    throw new Error("injected payload cleanup failure");
  }
}

class FailOnceCancelledSaveRepository implements WorkerJobRepository {
  private readonly repository = new InMemoryWorkerJobRepository();
  private hasFailedCancelledSave = false;

  async save(record: WorkerJobRecord): Promise<void> {
    if (record.state === "cancelled" && !this.hasFailedCancelledSave) {
      this.hasFailedCancelledSave = true;
      throw new Error("injected cancelled save failure");
    }

    return this.repository.save(record);
  }

  getById(id: string): Promise<WorkerJobRecord | undefined> {
    return this.repository.getById(id);
  }

  listForProject(projectId: string): Promise<WorkerJobRecord[]> {
    return this.repository.listForProject(projectId);
  }

  listAll(): Promise<WorkerJobRecord[]> {
    return this.repository.listAll();
  }

  findOldestQueued(): Promise<WorkerJobRecord | undefined> {
    return this.repository.findOldestQueued();
  }

  claimOldestQueued(
    input: WorkerJobClaimOldestQueuedInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.repository.claimOldestQueued(input);
  }

  completeClaimed(
    input: WorkerJobCompleteClaimedInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.repository.completeClaimed(input);
  }

  requestRunningCancellation(
    input: WorkerJobRequestRunningCancellationInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.repository.requestRunningCancellation(input);
  }

  cancelQueued(
    input: WorkerJobCancelQueuedInput
  ): Promise<WorkerJobRecord | undefined> {
    if (!this.hasFailedCancelledSave) {
      this.hasFailedCancelledSave = true;
      throw new Error("injected cancelled save failure");
    }

    return this.repository.cancelQueued(input);
  }
}

class ExternalCancellationBeforeClaimedCompletionRepository
  implements WorkerJobRepository
{
  private readonly repository = new InMemoryWorkerJobRepository();
  private hasInjectedCancellation = false;

  async save(record: WorkerJobRecord): Promise<void> {
    if (
      record.state !== "queued" &&
      record.state !== "running" &&
      !this.hasInjectedCancellation
    ) {
      await this.injectExternalCancellation(record.id);
    }

    return this.repository.save(record);
  }

  getById(id: string): Promise<WorkerJobRecord | undefined> {
    return this.repository.getById(id);
  }

  listForProject(projectId: string): Promise<WorkerJobRecord[]> {
    return this.repository.listForProject(projectId);
  }

  listAll(): Promise<WorkerJobRecord[]> {
    return this.repository.listAll();
  }

  findOldestQueued(): Promise<WorkerJobRecord | undefined> {
    return this.repository.findOldestQueued();
  }

  claimOldestQueued(
    input: WorkerJobClaimOldestQueuedInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.repository.claimOldestQueued(input);
  }

  async completeClaimed(
    input: WorkerJobCompleteClaimedInput
  ): Promise<WorkerJobRecord | undefined> {
    await this.injectExternalCancellation(input.jobId);
    return this.repository.completeClaimed(input);
  }

  requestRunningCancellation(
    input: WorkerJobRequestRunningCancellationInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.repository.requestRunningCancellation(input);
  }

  cancelQueued(
    input: WorkerJobCancelQueuedInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.repository.cancelQueued(input);
  }

  private async injectExternalCancellation(jobId: string): Promise<void> {
    if (this.hasInjectedCancellation) {
      return;
    }

    this.hasInjectedCancellation = true;
    const latest = await this.repository.getById(jobId);
    if (!latest || latest.state !== "running") {
      return;
    }

    await this.repository.save({
      ...latest,
      cancelRequestedAt: "2026-05-18T00:00:02.500Z",
      cancelReason: "External stop"
    });
  }
}

class CompleteBeforeStaleRunningCancellationRepository
  implements WorkerJobRepository
{
  private readonly repository = new InMemoryWorkerJobRepository();
  private targetJobId: string | undefined;
  private claimToken: string | undefined;
  private hasReturnedInitialRunningRead = false;
  private hasInjectedCompletion = false;

  armCompletion(input: { jobId: string; claimToken: string }): void {
    this.targetJobId = input.jobId;
    this.claimToken = input.claimToken;
  }

  save(record: WorkerJobRecord): Promise<void> {
    return this.repository.save(record);
  }

  async getById(id: string): Promise<WorkerJobRecord | undefined> {
    if (id !== this.targetJobId || !this.claimToken) {
      return this.repository.getById(id);
    }

    const latest = await this.repository.getById(id);
    if (!latest || latest.state !== "running") {
      return latest;
    }

    if (!this.hasReturnedInitialRunningRead) {
      this.hasReturnedInitialRunningRead = true;
      return latest;
    }

    if (!this.hasInjectedCompletion) {
      this.hasInjectedCompletion = true;
      await this.repository.completeClaimed({
        jobId: id,
        claimToken: this.claimToken,
        state: "completed",
        resultSummary: {
          state: "completed",
          exitCode: 0,
          stdout: "completed by another runtime",
          stderr: "",
          stdoutBytes: 28,
          stderrBytes: 0
        },
        completedAt: "2026-05-18T00:00:03.000Z"
      });
    }

    return latest;
  }

  listForProject(projectId: string): Promise<WorkerJobRecord[]> {
    return this.repository.listForProject(projectId);
  }

  listAll(): Promise<WorkerJobRecord[]> {
    return this.repository.listAll();
  }

  findOldestQueued(): Promise<WorkerJobRecord | undefined> {
    return this.repository.findOldestQueued();
  }

  claimOldestQueued(
    input: WorkerJobClaimOldestQueuedInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.repository.claimOldestQueued(input);
  }

  completeClaimed(
    input: WorkerJobCompleteClaimedInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.repository.completeClaimed(input);
  }

  requestRunningCancellation(
    input: WorkerJobRequestRunningCancellationInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.repository.requestRunningCancellation(input);
  }

  cancelQueued(
    input: WorkerJobCancelQueuedInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.repository.cancelQueued(input);
  }
}

class CompleteBeforeStaleQueuedCancellationRepository
  implements WorkerJobRepository
{
  private readonly repository = new InMemoryWorkerJobRepository();
  private targetJobId: string | undefined;
  private hasInjectedCompletion = false;

  armCompletion(jobId: string): void {
    this.targetJobId = jobId;
  }

  async save(record: WorkerJobRecord): Promise<void> {
    if (record.id === this.targetJobId && record.state === "cancelled") {
      await this.injectCompletion(record.id);
    }

    return this.repository.save(record);
  }

  getById(id: string): Promise<WorkerJobRecord | undefined> {
    return this.repository.getById(id);
  }

  listForProject(projectId: string): Promise<WorkerJobRecord[]> {
    return this.repository.listForProject(projectId);
  }

  listAll(): Promise<WorkerJobRecord[]> {
    return this.repository.listAll();
  }

  findOldestQueued(): Promise<WorkerJobRecord | undefined> {
    return this.repository.findOldestQueued();
  }

  claimOldestQueued(
    input: WorkerJobClaimOldestQueuedInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.repository.claimOldestQueued(input);
  }

  completeClaimed(
    input: WorkerJobCompleteClaimedInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.repository.completeClaimed(input);
  }

  requestRunningCancellation(
    input: WorkerJobRequestRunningCancellationInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.repository.requestRunningCancellation(input);
  }

  async cancelQueued(
    input: WorkerJobCancelQueuedInput
  ): Promise<WorkerJobRecord | undefined> {
    await this.injectCompletion(input.jobId);
    return (
      this.repository as unknown as {
        cancelQueued(
          input: WorkerJobCancelQueuedInput
        ): Promise<WorkerJobRecord | undefined>;
      }
    ).cancelQueued(input);
  }

  private async injectCompletion(jobId: string): Promise<void> {
    if (this.hasInjectedCompletion) {
      return;
    }

    this.hasInjectedCompletion = true;
    const latest = await this.repository.getById(jobId);
    if (!latest || latest.state !== "queued") {
      return;
    }

    await this.repository.save({
      ...latest,
      state: "completed",
      completedAt: "2026-05-18T00:00:03.000Z",
      resultSummary: {
        state: "completed",
        exitCode: 0,
        stdout: "completed by another runtime",
        stderr: "",
        stdoutBytes: 28,
        stderrBytes: 0
      }
    });
  }
}

class ClaimBeforeQueuedCancellationRepository implements WorkerJobRepository {
  private readonly repository = new InMemoryWorkerJobRepository();
  private targetJobId: string | undefined;
  private hasInjectedClaim = false;

  armClaim(jobId: string): void {
    this.targetJobId = jobId;
  }

  save(record: WorkerJobRecord): Promise<void> {
    return this.repository.save(record);
  }

  getById(id: string): Promise<WorkerJobRecord | undefined> {
    return this.repository.getById(id);
  }

  listForProject(projectId: string): Promise<WorkerJobRecord[]> {
    return this.repository.listForProject(projectId);
  }

  listAll(): Promise<WorkerJobRecord[]> {
    return this.repository.listAll();
  }

  findOldestQueued(): Promise<WorkerJobRecord | undefined> {
    return this.repository.findOldestQueued();
  }

  claimOldestQueued(
    input: WorkerJobClaimOldestQueuedInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.repository.claimOldestQueued(input);
  }

  completeClaimed(
    input: WorkerJobCompleteClaimedInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.repository.completeClaimed(input);
  }

  requestRunningCancellation(
    input: WorkerJobRequestRunningCancellationInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.repository.requestRunningCancellation(input);
  }

  async cancelQueued(
    input: WorkerJobCancelQueuedInput
  ): Promise<WorkerJobRecord | undefined> {
    await this.injectClaim(input.jobId);
    return this.repository.cancelQueued(input);
  }

  private async injectClaim(jobId: string): Promise<void> {
    if (this.hasInjectedClaim || jobId !== this.targetJobId) {
      return;
    }

    this.hasInjectedClaim = true;
    const latest = await this.repository.getById(jobId);
    if (!latest || latest.state !== "queued") {
      return;
    }

    await this.repository.save({
      ...latest,
      state: "running",
      startedAt: "2026-05-18T00:00:03.000Z",
      claimedByWorkerId: "worker_a",
      claimToken: "claim_token_1"
    });
  }
}

describe("InMemoryWorkerRuntime", () => {
  it("enqueues safe simulated jobs with persisted payloads and no raw env values", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const runtime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository,
      now: () => new Date("2026-05-18T00:00:00.000Z")
    });

    const queued = await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());
    const payload = await payloadRepository.getByJobId(queued.id);

    expect(queued).toMatchObject({
      id: "worker_job_1",
      state: "queued",
      inputSummary: {
        command: "build",
        argCount: 1,
        envNames: ["PUBLIC_FLAG"]
      }
    });
    expect(payload).toEqual({
      jobId: queued.id,
      kind: "safe_simulated_tool_command",
      projectId: "project_a",
      command: "build",
      args: ["--fast"],
      envNames: ["PUBLIC_FLAG"],
      timeoutMs: 1000,
      createdAt: "2026-05-18T00:00:00.000Z"
    });
    expect(JSON.stringify(payload)).not.toContain("secret-value");
  });

  it("canonicalizes duplicate safe env names so claimed jobs still match their payload", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const runtime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository,
      adapter: new SimulatedExecutionAdapter(),
      claimTokenFactory: () => "claim_token_1"
    });
    const queued = await runtime.enqueueSafe(
      baseSafeInput({ envNames: ["PUBLIC_FLAG", "PUBLIC_FLAG"] }),
      simulatedPolicy()
    );
    const claim = await runtime.claimOldestQueued({ workerId: "worker_a" });

    const completed = await runtime.runClaimedJob(claim!);
    const stored = await repository.getById(queued.id);

    expect(completed).toMatchObject({
      id: queued.id,
      state: "completed",
      inputSummary: {
        envNames: ["PUBLIC_FLAG"]
      },
      resultSummary: {
        state: "completed",
        stdout: "Simulated build for project project_a."
      }
    });
    expect(stored).toEqual(completed);
  });

  it("claims the oldest safe queued job with worker metadata", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const runtime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository,
      claimTokenFactory: () => "claim_token_1",
      now: createClock([
        "2026-05-18T00:00:00.000Z",
        "2026-05-18T00:00:01.000Z"
      ])
    });
    const queued = await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());

    const claim = await runtime.claimOldestQueued({
      workerId: "worker_a"
    });
    const stored = await repository.getById(queued.id);

    expect(claim).toEqual({
      record: expect.objectContaining({
        id: queued.id,
        state: "running",
        startedAt: "2026-05-18T00:00:01.000Z",
        claimedByWorkerId: "worker_a",
        claimToken: "claim_token_1"
      }),
      claimToken: "claim_token_1"
    });
    expect(stored).toEqual(claim?.record);
  });

  it("claims the oldest safe queued job for a requested project only", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const runtime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository,
      claimTokenFactory: () => "claim_token_1",
      now: createClock([
        "2026-05-18T00:00:00.000Z",
        "2026-05-18T00:00:01.000Z",
        "2026-05-18T00:00:02.000Z"
      ])
    });
    const projectBJob = await runtime.enqueueSafe(
      baseSafeInput({ projectId: "project_b" }),
      simulatedPolicy()
    );

    const projectAClaim = await runtime.claimOldestQueuedForProject({
      workerId: "worker_a",
      projectId: "project_a"
    });
    const projectBClaim = await runtime.claimOldestQueuedForProject({
      workerId: "worker_b",
      projectId: "project_b"
    });

    expect(projectAClaim).toBeUndefined();
    expect(projectBClaim).toEqual({
      record: expect.objectContaining({
        id: projectBJob.id,
        projectId: "project_b",
        state: "running",
        claimedByWorkerId: "worker_b",
        claimToken: "claim_token_1"
      }),
      claimToken: "claim_token_1"
    });
  });

  it("does not claim the same queued job twice", async () => {
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const runtime = new InMemoryWorkerRuntime({
      payloadRepository,
      claimTokenFactory: () => "claim_token_1"
    });
    await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());

    const firstClaim = await runtime.claimOldestQueued({ workerId: "worker_a" });
    const secondClaim = await runtime.claimOldestQueued({ workerId: "worker_b" });

    expect(firstClaim?.record.state).toBe("running");
    expect(secondClaim).toBeUndefined();
  });

  it("executes claimed safe simulated jobs from persisted payloads", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const runtime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository,
      adapter: new SimulatedExecutionAdapter(),
      claimTokenFactory: () => "claim_token_1",
      now: createClock([
        "2026-05-18T00:00:00.000Z",
        "2026-05-18T00:00:01.000Z",
        "2026-05-18T00:00:02.000Z"
      ])
    });
    const queued = await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());
    const claim = await runtime.claimOldestQueued({ workerId: "worker_a" });

    const completed = await runtime.runClaimedJob(claim!);
    const stored = await repository.getById(queued.id);

    expect(completed).toMatchObject({
      id: queued.id,
      state: "completed",
      claimedByWorkerId: "worker_a",
      claimToken: "claim_token_1",
      completedAt: "2026-05-18T00:00:02.000Z",
      resultSummary: {
        state: "completed",
        stdout: "Simulated build for project project_a."
      }
    });
    expect(stored).toEqual(completed);
  });

  it("executes safe queued jobs across JSON-file runtime instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worker-queue-handoff-"));
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
      const workerRuntime = new InMemoryWorkerRuntime({
        repository: createJsonFileWorkerJobRepository({ filePath: jobsFilePath }),
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
      const queued = await apiRuntime.enqueueSafe(baseSafeInput(), simulatedPolicy());

      const claim = await workerRuntime.claimOldestQueued({ workerId: "worker_a" });
      const completed = await workerRuntime.runClaimedJob(claim!);
      const apiVisibleJob = await apiRuntime.getJob(queued.id);

      expect(claim).toMatchObject({
        record: {
          id: queued.id,
          state: "running",
          claimedByWorkerId: "worker_a",
          claimToken: "claim_token_1"
        }
      });
      expect(completed).toMatchObject({
        id: queued.id,
        state: "completed",
        resultSummary: {
          state: "completed",
          stdout: "Simulated build for project project_a."
        }
      });
      expect(apiVisibleJob).toMatchObject({
        id: queued.id,
        state: "completed",
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

  it("validates claimed execution against the persisted payload before executing", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const adapter: ExecutionAdapter = {
      execute: vi.fn(async () => ({
        state: "completed" as const,
        exitCode: 0,
        stdout: "should not run",
        stderr: ""
      }))
    };
    const runtime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository,
      adapter,
      claimTokenFactory: () => "claim_token_1"
    });
    const queued = await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());
    const claim = await runtime.claimOldestQueued({ workerId: "worker_a" });
    const payload = await payloadRepository.getByJobId(queued.id);
    await payloadRepository.save({
      ...payload!,
      command: "deploy"
    });

    const rejected = await runtime.runClaimedJob(claim!);
    const stored = await repository.getById(queued.id);

    expect(rejected).toMatchObject({
      id: queued.id,
      state: "rejected",
      errorName: "sandbox_policy_command_not_allowed",
      resultSummary: {
        state: "rejected",
        stderr: "command not allowed: deploy",
        errorName: "sandbox_policy_command_not_allowed"
      }
    });
    expect(stored).toEqual(rejected);
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("rejects claimed jobs when the persisted payload differs from the queued record", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const adapter: ExecutionAdapter = {
      execute: vi.fn(async () => ({
        state: "completed" as const,
        exitCode: 0,
        stdout: "should not run",
        stderr: ""
      }))
    };
    const runtime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository,
      adapter,
      claimTokenFactory: () => "claim_token_1"
    });
    const queued = await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());
    const claim = await runtime.claimOldestQueued({ workerId: "worker_a" });
    const payload = await payloadRepository.getByJobId(queued.id);
    await payloadRepository.save({
      ...payload!,
      command: "test"
    });

    const rejected = await runtime.runClaimedJob(claim!);
    const stored = await repository.getById(queued.id);

    expect(rejected).toMatchObject({
      id: queued.id,
      state: "rejected",
      errorName: "worker_job_payload_record_mismatch",
      resultSummary: {
        state: "rejected",
        stderr: "Worker job payload does not match the queued job record.",
        errorName: "worker_job_payload_record_mismatch"
      }
    });
    expect(stored).toEqual(rejected);
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("rejects claimed jobs when persisted payload args differ without exposing raw args", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const adapter: ExecutionAdapter = {
      execute: vi.fn(async () => ({
        state: "completed" as const,
        exitCode: 0,
        stdout: "should not run",
        stderr: ""
      }))
    };
    const runtime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository,
      adapter,
      claimTokenFactory: () => "claim_token_1"
    });
    const queued = await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());
    const claim = await runtime.claimOldestQueued({ workerId: "worker_a" });
    const payload = await payloadRepository.getByJobId(queued.id);
    await payloadRepository.save({
      ...payload!,
      args: ["--slow"]
    });

    const rejected = await runtime.runClaimedJob(claim!);
    const stored = await repository.getById(queued.id);

    expect(rejected).toMatchObject({
      id: queued.id,
      state: "rejected",
      errorName: "worker_job_payload_record_mismatch",
      resultSummary: {
        state: "rejected",
        stderr: "Worker job payload does not match the queued job record.",
        errorName: "worker_job_payload_record_mismatch"
      }
    });
    expect("args" in rejected.inputSummary).toBe(false);
    expect(stored).toEqual(rejected);
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("rejects stale claim completion attempts without overwriting the job", async () => {
    const runtime = new InMemoryWorkerRuntime({
      payloadRepository: new InMemoryWorkerJobPayloadRepository(),
      adapter: new SimulatedExecutionAdapter(),
      claimTokenFactory: () => "claim_token_1"
    });
    const queued = await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());
    const claim = await runtime.claimOldestQueued({ workerId: "worker_a" });
    const staleClaim = {
      record: claim!.record,
      claimToken: "stale_claim_token"
    };

    await expect(runtime.runClaimedJob(staleClaim)).rejects.toThrow(
      "worker_job_claim_conflict"
    );
    await expect(runtime.getJob(queued.id)).resolves.toMatchObject({
      state: "running",
      claimToken: "claim_token_1"
    });
  });

  it("fails claimed jobs closed when the persisted payload is missing", async () => {
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const runtime = new InMemoryWorkerRuntime({
      payloadRepository,
      claimTokenFactory: () => "claim_token_1",
      now: createClock([
        "2026-05-18T00:00:00.000Z",
        "2026-05-18T00:00:01.000Z",
        "2026-05-18T00:00:02.000Z"
      ])
    });
    const queued = await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());
    const claim = await runtime.claimOldestQueued({ workerId: "worker_a" });
    await payloadRepository.deleteByJobId(queued.id);

    const failed = await runtime.runClaimedJob(claim!);

    expect(failed).toMatchObject({
      id: queued.id,
      state: "failed",
      errorName: "worker_job_payload_unavailable",
      resultSummary: {
        state: "failed",
        stderr: "Worker job execution payload is unavailable after restart.",
        errorName: "worker_job_payload_unavailable"
      }
    });
  });

  it("persists cancelled state when claimed adapters observe cancellation", async () => {
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const runtime = new InMemoryWorkerRuntime({
      payloadRepository,
      adapter: new SimulatedExecutionAdapter(),
      claimTokenFactory: () => "claim_token_1",
      now: createClock([
        "2026-05-18T00:00:00.000Z",
        "2026-05-18T00:00:01.000Z",
        "2026-05-18T00:00:02.000Z",
        "2026-05-18T00:00:03.000Z"
      ])
    });
    const queued = await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());
    const claim = await runtime.claimOldestQueued({ workerId: "worker_a" });
    await runtime.cancelJob(queued.id, "Stop this job");

    const completed = await runtime.runClaimedJob(claim!);

    expect(completed).toMatchObject({
      id: queued.id,
      state: "cancelled",
      cancelRequestedAt: "2026-05-18T00:00:02.000Z",
      cancelledAt: "2026-05-18T00:00:03.000Z",
      cancelReason: "Stop this job",
      resultSummary: {
        state: "cancelled",
        stderr: "Worker job cancelled."
      }
    });
  });

  it("preserves cancellation request metadata when claimed adapters ignore cancellation", async () => {
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const adapter: ExecutionAdapter = {
      execute: vi.fn(async () => ({
        state: "completed" as const,
        exitCode: 0,
        stdout: "ignored cancellation",
        stderr: ""
      }))
    };
    const runtime = new InMemoryWorkerRuntime({
      payloadRepository,
      adapter,
      claimTokenFactory: () => "claim_token_1",
      now: createClock([
        "2026-05-18T00:00:00.000Z",
        "2026-05-18T00:00:01.000Z",
        "2026-05-18T00:00:02.000Z",
        "2026-05-18T00:00:03.000Z"
      ])
    });
    const queued = await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());
    const claim = await runtime.claimOldestQueued({ workerId: "worker_a" });
    await runtime.cancelJob(queued.id, "Stop this job");

    const completed = await runtime.runClaimedJob(claim!);

    expect(completed).toMatchObject({
      id: queued.id,
      state: "completed",
      cancelRequestedAt: "2026-05-18T00:00:02.000Z",
      cancelReason: "Stop this job",
      resultSummary: {
        state: "completed",
        stdout: "ignored cancellation"
      }
    });
    expect(completed.cancelledAt).toBeUndefined();
  });

  it("preserves external cancellation metadata injected before claimed completion is persisted", async () => {
    const repository = new ExternalCancellationBeforeClaimedCompletionRepository();
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const adapter: ExecutionAdapter = {
      execute: vi.fn(async () => ({
        state: "completed" as const,
        exitCode: 0,
        stdout: "completed despite external stop",
        stderr: ""
      }))
    };
    const runtime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository,
      adapter,
      claimTokenFactory: () => "claim_token_1",
      now: createClock([
        "2026-05-18T00:00:00.000Z",
        "2026-05-18T00:00:01.000Z",
        "2026-05-18T00:00:03.000Z"
      ])
    });
    const queued = await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());
    const claim = await runtime.claimOldestQueued({ workerId: "worker_a" });

    const completed = await runtime.runClaimedJob(claim!);
    const stored = await repository.getById(queued.id);

    expect(completed).toMatchObject({
      id: queued.id,
      state: "completed",
      completedAt: "2026-05-18T00:00:03.000Z",
      cancelRequestedAt: "2026-05-18T00:00:02.500Z",
      cancelReason: "External stop",
      resultSummary: {
        state: "completed",
        stdout: "completed despite external stop"
      }
    });
    expect(completed.cancelledAt).toBeUndefined();
    expect(stored).toEqual(completed);
  });

  it("returns completed claimed jobs when persisted payload cleanup fails", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const payloadRepository = new FailDeleteWorkerJobPayloadRepository();
    const runtime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository,
      adapter: new SimulatedExecutionAdapter(),
      claimTokenFactory: () => "claim_token_1"
    });
    const queued = await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());
    const claim = await runtime.claimOldestQueued({ workerId: "worker_a" });

    const completed = await runtime.runClaimedJob(claim!);
    const stored = await repository.getById(queued.id);

    expect(completed).toMatchObject({
      id: queued.id,
      state: "completed",
      resultSummary: {
        state: "completed",
        stdout: "Simulated build for project project_a."
      }
    });
    expect(stored).toEqual(completed);
  });

  it("fails claimed jobs when adapters throw named errors", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const adapterError = new Error("injected adapter failure");
    adapterError.name = "InjectedAdapterError";
    const adapter: ExecutionAdapter = {
      execute: vi.fn(async () => {
        throw adapterError;
      })
    };
    const runtime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository,
      adapter,
      claimTokenFactory: () => "claim_token_1"
    });
    const queued = await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());
    const claim = await runtime.claimOldestQueued({ workerId: "worker_a" });

    const failed = await runtime.runClaimedJob(claim!);
    const stored = await repository.getById(queued.id);

    expect(failed).toMatchObject({
      id: queued.id,
      state: "failed",
      errorName: "InjectedAdapterError",
      resultSummary: {
        state: "failed",
        stderr: "injected adapter failure",
        errorName: "InjectedAdapterError"
      }
    });
    expect(stored).toEqual(failed);
  });

  it("returns cancelled queued safe jobs when persisted payload cleanup fails", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const payloadRepository = new FailDeleteWorkerJobPayloadRepository();
    const runtime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository,
      now: () => new Date("2026-05-18T00:00:00.000Z")
    });
    const queued = await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());

    const cancelled = await runtime.cancelJob(queued.id, "Stop this job");
    const stored = await repository.getById(queued.id);

    expect(cancelled).toMatchObject({
      id: queued.id,
      state: "cancelled",
      cancelRequestedAt: "2026-05-18T00:00:00.000Z",
      cancelledAt: "2026-05-18T00:00:00.000Z",
      cancelReason: "Stop this job"
    });
    expect(stored).toEqual(cancelled);
  });

  it("deletes persisted safe payloads after queued cancellation", async () => {
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const runtime = new InMemoryWorkerRuntime({
      payloadRepository,
      now: () => new Date("2026-05-18T00:00:00.000Z")
    });
    const queued = await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());

    const cancelled = await runtime.cancelJob(queued.id, "stop before run");

    expect(cancelled).toMatchObject({
      id: queued.id,
      state: "cancelled"
    });
    await expect(payloadRepository.getByJobId(queued.id)).resolves.toBeUndefined();
  });

  it("runNext does not consume safe persisted queued jobs", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const adapter: ExecutionAdapter = {
      execute: vi.fn(async () => ({
        state: "completed" as const,
        exitCode: 0,
        stdout: "should not run",
        stderr: ""
      }))
    };
    const runtime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository,
      adapter
    });
    const queued = await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());

    const runResult = await runtime.runNext();
    const stored = await repository.getById(queued.id);

    expect(runResult).toBeUndefined();
    expect(stored).toMatchObject({
      id: queued.id,
      state: "queued"
    });
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("claimOldestQueued does not claim legacy process-local queued jobs", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const runtime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository,
      claimTokenFactory: () => "claim_token_1"
    });
    const queued = await runtime.enqueue(baseInput(), simulatedPolicy());

    const claim = await runtime.claimOldestQueued({ workerId: "worker_a" });
    const stored = await repository.getById(queued.id);

    expect(claim).toBeUndefined();
    expect(stored).toMatchObject({
      id: queued.id,
      state: "queued"
    });
  });

  it("keeps safe persisted and process-local queues isolated in mixed queues", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const adapter: ExecutionAdapter = {
      execute: vi.fn(async () => ({
        state: "completed" as const,
        exitCode: 0,
        stdout: "legacy completed",
        stderr: ""
      }))
    };
    const runtime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository,
      adapter,
      claimTokenFactory: () => "claim_token_1",
      now: createClock([
        "2026-05-18T00:00:00.000Z",
        "2026-05-18T00:00:01.000Z",
        "2026-05-18T00:00:02.000Z",
        "2026-05-18T00:00:03.000Z"
      ])
    });
    const legacy = await runtime.enqueue(baseInput(), simulatedPolicy());
    const safe = await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());

    const claim = await runtime.claimOldestQueued({ workerId: "worker_a" });
    const completed = await runtime.runNext();
    const storedLegacy = await repository.getById(legacy.id);
    const storedSafe = await repository.getById(safe.id);

    expect(claim?.record).toMatchObject({
      id: safe.id,
      state: "running",
      claimedByWorkerId: "worker_a"
    });
    expect(completed).toMatchObject({
      id: legacy.id,
      state: "completed"
    });
    expect(storedLegacy).toEqual(completed);
    expect(storedSafe).toEqual(claim?.record);
    expect(adapter.execute).toHaveBeenCalledTimes(1);
  });

  it("claims a safe queued job once across runtime instances sharing a repository", async () => {
    const repository = new BlockingRunningSaveRepository();
    const firstRuntime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository: new InMemoryWorkerJobPayloadRepository(),
      claimTokenFactory: () => "claim_token_1"
    });
    const secondRuntime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository: new InMemoryWorkerJobPayloadRepository(),
      claimTokenFactory: () => "claim_token_2"
    });
    await firstRuntime.enqueueSafe(baseSafeInput(), simulatedPolicy());

    const firstClaimPromise = firstRuntime.claimOldestQueued({
      workerId: "worker_a"
    });
    await Promise.race([
      repository.firstRunningSaveStarted.promise,
      new Promise((resolve) => setTimeout(resolve, 10))
    ]);
    const secondClaimPromise = secondRuntime.claimOldestQueued({
      workerId: "worker_b"
    });
    repository.releaseFirstRunningSave.resolve();

    const claims = await Promise.all([firstClaimPromise, secondClaimPromise]);
    const successfulClaims = claims.filter((claim) => claim !== undefined);

    expect(successfulClaims).toHaveLength(1);
  });

  it("preserves the original job save error when safe enqueue payload cleanup fails", async () => {
    const runtime = new InMemoryWorkerRuntime({
      repository: new FailAllSavesWorkerJobRepository(),
      payloadRepository: new FailDeleteWorkerJobPayloadRepository()
    });

    await expect(
      runtime.enqueueSafe(baseSafeInput(), simulatedPolicy())
    ).rejects.toThrow("injected job save failure");
  });

  it("persists completed runtime records through a JSON-file repository", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worker-runtime-"));
    const filePath = join(directory, "worker-jobs.json");

    try {
      const repository = createJsonFileWorkerJobRepository({ filePath });
      const runtime = new InMemoryWorkerRuntime({
        repository,
        adapter: new SimulatedExecutionAdapter()
      });

      const queued = await runtime.enqueue(baseInput(), simulatedPolicy());
      await runtime.runNext();

      const reopenedRepository = createJsonFileWorkerJobRepository({ filePath });
      const persisted = await reopenedRepository.getById(queued.id);

      expect(persisted).toMatchObject({
        id: queued.id,
        state: "completed",
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

  it("does not resume JSON-persisted queued jobs without process-local payload", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worker-runtime-"));
    const filePath = join(directory, "worker-jobs.json");

    try {
      const firstRepository = createJsonFileWorkerJobRepository({ filePath });
      const firstRuntime = new InMemoryWorkerRuntime({
        repository: firstRepository,
        adapter: new SimulatedExecutionAdapter()
      });
      const queued = await firstRuntime.enqueue(baseInput(), simulatedPolicy());
      const adapter: ExecutionAdapter = {
        execute: vi.fn(async () => ({
          state: "completed" as const,
          exitCode: 0,
          stdout: "should not run",
          stderr: ""
        }))
      };
      const secondRepository = createJsonFileWorkerJobRepository({ filePath });
      const secondRuntime = new InMemoryWorkerRuntime({
        repository: secondRepository,
        adapter
      });

      const failed = await secondRuntime.runNext();

      expect(failed).toMatchObject({
        id: queued.id,
        state: "failed",
        errorName: "worker_job_payload_unavailable"
      });
      expect(adapter.execute).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists worker records through an injected repository", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const runtime = new InMemoryWorkerRuntime({
      repository,
      adapter: new SimulatedExecutionAdapter()
    });

    const queued = await runtime.enqueue(baseInput(), simulatedPolicy());
    const completed = await runtime.runNext();
    const persisted = await repository.getById(queued.id);

    expect(completed?.state).toBe("completed");
    expect(persisted).toMatchObject({
      id: queued.id,
      state: "completed",
      resultSummary: {
        state: "completed",
        stdout: "Simulated build for project project_a."
      }
    });
  });

  it("allocates the next id after existing repository records", async () => {
    const repository = new InMemoryWorkerJobRepository();
    await repository.save(workerJobRecord({ id: "worker_job_3" }));
    await repository.save(workerJobRecord({ id: "other_prefix_9" }));
    const runtime = new InMemoryWorkerRuntime({ repository });

    const queued = await runtime.enqueue(baseInput(), simulatedPolicy());

    expect(queued.id).toBe("worker_job_4");
  });

  it("ignores unsafe persisted id suffixes when allocating the next id", async () => {
    const repository = new InMemoryWorkerJobRepository();
    await repository.save(workerJobRecord({ id: "worker_job_3" }));
    await repository.save(
      workerJobRecord({
        id: "worker_job_999999999999999999999999999999999999999999999999999999"
      })
    );
    const runtime = new InMemoryWorkerRuntime({ repository });

    const queued = await runtime.enqueue(baseInput(), simulatedPolicy());

    expect(queued.id).toBe("worker_job_4");
  });

  it("allocates unique ids for parallel enqueues in one runtime instance", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const runtime = new InMemoryWorkerRuntime({ repository });

    const queued = await Promise.all([
      runtime.enqueue(baseInput(), simulatedPolicy()),
      runtime.enqueue(baseInput(), simulatedPolicy()),
      runtime.enqueue(baseInput(), simulatedPolicy())
    ]);
    const persisted = await repository.listAll();

    expect(queued.map((job) => job.id)).toEqual([
      "worker_job_1",
      "worker_job_2",
      "worker_job_3"
    ]);
    expect(persisted.map((job) => job.id)).toEqual([
      "worker_job_1",
      "worker_job_2",
      "worker_job_3"
    ]);
  });

  it("runs the oldest queued repository record before newer queued records", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const runtime = new InMemoryWorkerRuntime({
      repository,
      adapter: new SimulatedExecutionAdapter()
    });
    const newer = await runtime.enqueue(
      baseInput({ command: "test" }),
      simulatedPolicy()
    );
    const older = await runtime.enqueue(baseInput(), simulatedPolicy());
    await repository.save({
      ...older,
      createdAt: "2026-05-17T00:00:00.000Z"
    });

    const completed = await runtime.runNext();
    const persistedOlder = await repository.getById(older.id);
    const persistedNewer = await repository.getById(newer.id);

    expect(completed?.id).toBe(older.id);
    expect(persistedOlder?.state).toBe("completed");
    expect(persistedNewer?.state).toBe("queued");
  });

  it("serializes parallel runNext calls in one runtime instance", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const execution = deferred<Awaited<ReturnType<ExecutionAdapter["execute"]>>>();
    const adapter: ExecutionAdapter = {
      execute: vi.fn(() => execution.promise)
    };
    const runtime = new InMemoryWorkerRuntime({ repository, adapter });
    const queued = await runtime.enqueue(baseInput(), simulatedPolicy());

    const runResultsPromise = Promise.all([runtime.runNext(), runtime.runNext()]);
    await vi.waitFor(() => {
      expect(adapter.execute).toHaveBeenCalled();
    });
    execution.resolve({
      state: "completed",
      exitCode: 0,
      stdout: "ok",
      stderr: ""
    });

    const runResults = await runResultsPromise;
    const completedResults = runResults.filter((job) => job !== undefined);
    const persisted = await repository.getById(queued.id);

    expect(adapter.execute).toHaveBeenCalledTimes(1);
    expect(completedResults).toHaveLength(1);
    expect(completedResults[0]).toMatchObject({
      id: queued.id,
      state: "completed"
    });
    expect(runResults).toContain(undefined);
    expect(persisted?.state).toBe("completed");
  });

  it("preserves running cancellation request metadata after adapter completion", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const execution = deferred<Awaited<ReturnType<ExecutionAdapter["execute"]>>>();
    const adapter: ExecutionAdapter = {
      execute: vi.fn(() => execution.promise)
    };
    const runtime = new InMemoryWorkerRuntime({
      repository,
      adapter,
      now: createClock([
        "2026-05-17T12:00:00.000Z",
        "2026-05-17T12:00:01.000Z",
        "2026-05-17T12:00:02.000Z",
        "2026-05-17T12:00:03.000Z"
      ])
    });
    const queued = await runtime.enqueue(baseInput(), simulatedPolicy());

    const runPromise = runtime.runNext();
    await vi.waitFor(() => {
      expect(adapter.execute).toHaveBeenCalled();
    });
    const runningCancel = await runtime.cancelJob(queued.id, "Stop this job");
    execution.resolve({
      state: "completed",
      exitCode: 0,
      stdout: "ok",
      stderr: ""
    });
    const completed = await runPromise;
    const stored = await repository.getById(queued.id);

    expect(runningCancel).toMatchObject({
      id: queued.id,
      state: "running",
      cancelRequestedAt: "2026-05-17T12:00:02.000Z",
      cancelReason: "Stop this job"
    });
    expect(completed).toMatchObject({
      id: queued.id,
      state: "completed",
      completedAt: "2026-05-17T12:00:03.000Z",
      cancelRequestedAt: "2026-05-17T12:00:02.000Z",
      cancelReason: "Stop this job",
      resultSummary: {
        state: "completed",
        stdout: "ok"
      }
    });
    expect(completed?.cancelledAt).toBeUndefined();
    expect(stored).toEqual(completed);
  });

  it("does not let stale running cancellation overwrite completed claimed jobs", async () => {
    const repository = new CompleteBeforeStaleRunningCancellationRepository();
    const runtime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository: new InMemoryWorkerJobPayloadRepository(),
      claimTokenFactory: () => "claim_token_1",
      now: createClock([
        "2026-05-18T00:00:00.000Z",
        "2026-05-18T00:00:01.000Z",
        "2026-05-18T00:00:04.000Z"
      ])
    });
    const queued = await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());
    const claim = await runtime.claimOldestQueued({ workerId: "worker_a" });
    repository.armCompletion({
      jobId: queued.id,
      claimToken: claim!.claimToken
    });

    const cancelled = await runtime.cancelJob(queued.id, "Stop after completion");
    const stored = await repository.getById(queued.id);

    expect(cancelled).toMatchObject({
      id: queued.id,
      state: "completed",
      completedAt: "2026-05-18T00:00:03.000Z",
      resultSummary: {
        state: "completed",
        stdout: "completed by another runtime"
      }
    });
    expect(cancelled?.cancelRequestedAt).toBeUndefined();
    expect(stored).toEqual(cancelled);
  });

  it("does not let stale queued cancellation overwrite completed jobs", async () => {
    const repository = new CompleteBeforeStaleQueuedCancellationRepository();
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const runtime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository,
      now: createClock([
        "2026-05-18T00:00:00.000Z",
        "2026-05-18T00:00:04.000Z"
      ])
    });
    const queued = await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());
    repository.armCompletion(queued.id);

    const cancelled = await runtime.cancelJob(queued.id, "Stop too late");
    const stored = await repository.getById(queued.id);
    const payload = await payloadRepository.getByJobId(queued.id);

    expect(cancelled).toMatchObject({
      id: queued.id,
      state: "completed",
      completedAt: "2026-05-18T00:00:03.000Z",
      resultSummary: {
        state: "completed",
        stdout: "completed by another runtime"
      }
    });
    expect(cancelled?.cancelRequestedAt).toBeUndefined();
    expect(stored).toEqual(cancelled);
    expect(payload).toBeDefined();
  });

  it("does not relock when stale queued cancellation finds a running job", async () => {
    const repository = new ClaimBeforeQueuedCancellationRepository();
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const runtime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository,
      now: createClock([
        "2026-05-18T00:00:00.000Z",
        "2026-05-18T00:00:04.000Z",
        "2026-05-18T00:00:05.000Z"
      ])
    });
    const queued = await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());
    repository.armClaim(queued.id);

    const timeout = Symbol("timeout");
    const cancelPromise = runtime.cancelJob(queued.id, "Stop after claim");
    const result = await Promise.race([
      cancelPromise,
      new Promise<typeof timeout>((resolve) => {
        setTimeout(() => resolve(timeout), 20);
      })
    ]);
    const stored = await repository.getById(queued.id);
    const payload = await payloadRepository.getByJobId(queued.id);

    expect(result).not.toBe(timeout);
    expect(result).toMatchObject({
      id: queued.id,
      state: "running",
      startedAt: "2026-05-18T00:00:03.000Z",
      cancelRequestedAt: "2026-05-18T00:00:05.000Z",
      cancelReason: "Stop after claim"
    });
    expect(stored).toEqual(result);
    expect(stored?.completedAt).toBeUndefined();
    expect(stored?.resultSummary).toBeUndefined();
    expect(payload).toBeDefined();
  });

  it("lets running adapters observe cooperative cancellation requests", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const started = deferred<void>();
    const continueExecution = deferred<void>();
    const adapter: ExecutionAdapter = {
      execute: vi.fn(async (_input, _policy, context) => {
        started.resolve(undefined);
        await continueExecution.promise;
        if (await context.isCancellationRequested()) {
          return {
            state: "cancelled" as const,
            stdout: "",
            stderr: "Worker job cancelled.",
            errorName: "worker_job_cancelled"
          };
        }
        return {
          state: "completed" as const,
          exitCode: 0,
          stdout: "completed",
          stderr: ""
        };
      })
    };
    const runtime = new InMemoryWorkerRuntime({
      repository,
      adapter,
      now: createClock([
        "2026-05-17T12:00:00.000Z",
        "2026-05-17T12:00:01.000Z",
        "2026-05-17T12:00:02.000Z",
        "2026-05-17T12:00:03.000Z"
      ])
    });
    const queued = await runtime.enqueue(baseInput(), simulatedPolicy());

    const runPromise = runtime.runNext();
    await started.promise;
    const running = await runtime.cancelJob(queued.id, "Stop this job");
    continueExecution.resolve(undefined);
    const cancelled = await runPromise;
    const stored = await repository.getById(queued.id);

    expect(running).toMatchObject({
      id: queued.id,
      state: "running",
      cancelRequestedAt: "2026-05-17T12:00:02.000Z",
      cancelReason: "Stop this job"
    });
    expect(cancelled).toMatchObject({
      id: queued.id,
      state: "cancelled",
      errorName: "worker_job_cancelled",
      cancelRequestedAt: "2026-05-17T12:00:02.000Z",
      cancelReason: "Stop this job",
      cancelledAt: "2026-05-17T12:00:03.000Z",
      completedAt: "2026-05-17T12:00:03.000Z",
      resultSummary: {
        state: "cancelled",
        stderr: "Worker job cancelled.",
        errorName: "worker_job_cancelled"
      }
    });
    expect(stored).toEqual(cancelled);
    expect(adapter.execute).toHaveBeenCalledTimes(1);
  });

  it("records cancellation while a queued job is being claimed for execution", async () => {
    const repository = new BlockingRunningSaveRepository();
    const execution = deferred<Awaited<ReturnType<ExecutionAdapter["execute"]>>>();
    const adapter: ExecutionAdapter = {
      execute: vi.fn(() => execution.promise)
    };
    const runtime = new InMemoryWorkerRuntime({
      repository,
      adapter,
      now: createClock([
        "2026-05-17T12:00:00.000Z",
        "2026-05-17T12:00:01.000Z",
        "2026-05-17T12:00:02.000Z",
        "2026-05-17T12:00:03.000Z"
      ])
    });
    const queued = await runtime.enqueue(baseInput(), simulatedPolicy());

    const runPromise = runtime.runNext();
    await repository.firstRunningSaveStarted.promise;
    const cancelPromise = runtime.cancelJob(queued.id, "Stop this job");
    repository.releaseFirstRunningSave.resolve();

    try {
      await vi.waitFor(() => {
        expect(adapter.execute).toHaveBeenCalled();
      });
      const runningCancel = await vi.waitFor(async () => {
        const result = await Promise.race([
          cancelPromise,
          Promise.resolve(undefined)
        ]);
        expect(result).toBeDefined();
        return result;
      });

      execution.resolve({
        state: "completed",
        exitCode: 0,
        stdout: "ok",
        stderr: ""
      });
      const completed = await runPromise;
      const stored = await repository.getById(queued.id);

      expect(runningCancel).toMatchObject({
        id: queued.id,
        state: "running",
        cancelRequestedAt: "2026-05-17T12:00:02.000Z",
        cancelReason: "Stop this job"
      });
      expect(completed).toMatchObject({
        id: queued.id,
        state: "completed",
        completedAt: "2026-05-17T12:00:03.000Z",
        cancelRequestedAt: "2026-05-17T12:00:02.000Z",
        cancelReason: "Stop this job",
        resultSummary: {
          state: "completed",
          stdout: "ok"
        }
      });
      expect(completed?.cancelledAt).toBeUndefined();
      expect(stored).toEqual(completed);
    } finally {
      execution.resolve({
        state: "completed",
        exitCode: 0,
        stdout: "ok",
        stderr: ""
      });
      await Promise.allSettled([runPromise, cancelPromise]);
    }
  });

  it("fails persisted queued jobs when process-local payload is unavailable", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const adapter: ExecutionAdapter = {
      execute: vi.fn(async () => ({
        state: "completed" as const,
        exitCode: 0,
        stdout: "should not run",
        stderr: ""
      }))
    };
    await repository.save(workerJobRecord());
    const runtime = new InMemoryWorkerRuntime({ repository, adapter });

    const failed = await runtime.runNext();
    const persisted = await repository.getById("worker_job_1");

    expect(failed).toMatchObject({
      id: "worker_job_1",
      state: "failed",
      errorName: "worker_job_payload_unavailable",
      resultSummary: {
        state: "failed",
        stderr: "Worker job execution payload is unavailable after restart.",
        errorName: "worker_job_payload_unavailable"
      }
    });
    expect(persisted?.errorName).toBe("worker_job_payload_unavailable");
    expect(persisted?.resultSummary?.errorName).toBe(
      "worker_job_payload_unavailable"
    );
    expect(persisted?.resultSummary?.stderr).toBe(
      "Worker job execution payload is unavailable after restart."
    );
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("enqueue creates deterministic worker job ids with an injectable prefix and clock", async () => {
    const runtime = new InMemoryWorkerRuntime({
      idPrefix: "worker_job",
      now: () => new Date("2026-05-17T12:00:00.000Z")
    });

    const first = await runtime.enqueue(baseInput());
    const second = await runtime.enqueue(baseInput({ command: "test" }));

    expect(first).toMatchObject({
      id: "worker_job_1",
      createdAt: "2026-05-17T12:00:00.000Z",
      inputSummary: {
        command: "build",
        argCount: 1
      }
    });
    expect(second.id).toBe("worker_job_2");
  });

  it("listJobsForProject is project scoped and ordered", async () => {
    const runtime = new InMemoryWorkerRuntime();
    await runtime.enqueue(baseInput({ projectId: "project_a", command: "build" }));
    await runtime.enqueue(baseInput({ projectId: "project_b", command: "test" }));
    await runtime.enqueue(baseInput({ projectId: "project_a", command: "test" }));

    const jobs = await runtime.listJobsForProject("project_a");

    expect(jobs.map((job) => job.id)).toEqual(["worker_job_1", "worker_job_3"]);
    expect(jobs.map((job) => job.inputSummary.command)).toEqual(["build", "test"]);
  });

  it("returned records are defensive copies and do not expose raw args", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter({
        stdoutByCommand: { build: "ok" }
      })
    });
    const queued = await runtime.enqueue(
      baseInput({
        args: ["original"],
        env: { TOKEN: "secret-value" }
      }),
      simulatedPolicy({ allowedEnvNames: ["TOKEN"] })
    );

    queued.inputSummary.envNames.push("MUTATED");
    queued.policy.allowedCommands.push("mutated");
    const beforeRun = await runtime.getJob(queued.id);
    beforeRun?.inputSummary.envNames.push("MUTATED_AGAIN");
    beforeRun?.policy.allowedEnvNames.push("MUTATED_POLICY");

    const completed = await runtime.runNext();
    completed?.inputSummary.envNames.push("AFTER_RUN");
    completed?.policy.allowedCommands.push("after-run");
    if (completed?.resultSummary) {
      completed.resultSummary.stdout = "mutated output";
    }

    const stored = await runtime.getJob(queued.id);

    expect(stored?.inputSummary).toMatchObject({
      argCount: 1,
      envNames: ["TOKEN"]
    });
    expect("args" in (stored?.inputSummary ?? {})).toBe(false);
    expect(stored?.policy.allowedCommands).toEqual(["build", "test"]);
    expect(stored?.policy.allowedEnvNames).toEqual(["TOKEN"]);
    expect(stored?.resultSummary?.stdout).toBe("ok");
  });

  it("runNext returns undefined when no queued job exists", async () => {
    const runtime = new InMemoryWorkerRuntime();

    await expect(runtime.runNext()).resolves.toBeUndefined();
  });

  it("returns undefined when cancelling an unknown job", async () => {
    const runtime = new InMemoryWorkerRuntime();

    await expect(
      runtime.cancelJob("worker_job_missing", "interrupt")
    ).resolves.toBeUndefined();
  });

  it("cancels queued jobs without invoking the adapter", async () => {
    const adapter: ExecutionAdapter = {
      execute: vi.fn(async () => ({
        state: "completed" as const,
        exitCode: 0,
        stdout: "should not run",
        stderr: ""
      }))
    };
    const runtime = new InMemoryWorkerRuntime({
      adapter,
      now: () => new Date("2026-05-17T12:00:00.000Z")
    });
    const queued = await runtime.enqueue(baseInput(), simulatedPolicy());

    const cancelled = await runtime.cancelJob(queued.id, "User pressed stop");
    const runResult = await runtime.runNext();
    const stored = await runtime.getJob(queued.id);

    expect(cancelled).toMatchObject({
      id: queued.id,
      state: "cancelled",
      errorName: "worker_job_cancelled",
      cancelRequestedAt: "2026-05-17T12:00:00.000Z",
      cancelledAt: "2026-05-17T12:00:00.000Z",
      completedAt: "2026-05-17T12:00:00.000Z",
      cancelReason: "User pressed stop",
      resultSummary: {
        state: "cancelled",
        stdout: "",
        stderr: "Worker job cancelled before execution.",
        errorName: "worker_job_cancelled"
      }
    });
    expect(stored).toEqual(cancelled);
    expect(runResult).toBeUndefined();
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("preserves queued execution payload when cancellation persistence fails", async () => {
    const repository = new FailOnceCancelledSaveRepository();
    const adapter: ExecutionAdapter = {
      execute: vi.fn(async (input: ExecutionInput) => {
        expect(input.args).toEqual(["--target", "preview"]);
        expect(input.env).toEqual({ BUILD_MODE: "preview" });
        return {
          state: "completed" as const,
          exitCode: 0,
          stdout: "payload available",
          stderr: ""
        };
      })
    };
    const runtime = new InMemoryWorkerRuntime({ repository, adapter });
    const queued = await runtime.enqueue(
      baseInput({
        args: ["--target", "preview"],
        env: { BUILD_MODE: "preview" }
      }),
      simulatedPolicy({ allowedEnvNames: ["BUILD_MODE"] })
    );

    await expect(runtime.cancelJob(queued.id, "stop")).rejects.toThrow(
      "injected cancelled save failure"
    );
    const completed = await runtime.runNext();
    const stored = await repository.getById(queued.id);

    expect(adapter.execute).toHaveBeenCalledTimes(1);
    expect(completed).toMatchObject({
      id: queued.id,
      state: "completed",
      resultSummary: {
        state: "completed",
        stdout: "payload available"
      }
    });
    expect(completed?.errorName).not.toBe("worker_job_payload_unavailable");
    expect(stored).toEqual(completed);
  });

  it("bounds persisted cancel reasons", async () => {
    const runtime = new InMemoryWorkerRuntime({
      now: () => new Date("2026-05-17T12:00:00.000Z")
    });
    const queued = await runtime.enqueue(baseInput(), simulatedPolicy());
    const reason = "a".repeat(250);

    const cancelled = await runtime.cancelJob(queued.id, reason);

    expect(cancelled?.cancelReason).toBe("a".repeat(200));
  });

  it("does not mutate completed jobs when cancellation is requested after settlement", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter(),
      now: () => new Date("2026-05-17T12:00:00.000Z")
    });
    const queued = await runtime.enqueue(baseInput(), simulatedPolicy());
    const completed = await runtime.runNext();

    const afterCancel = await runtime.cancelJob(queued.id, "late stop");

    expect(afterCancel).toEqual(completed);
    expect(afterCancel).toMatchObject({
      state: "completed",
      cancelRequestedAt: undefined,
      cancelledAt: undefined,
      cancelReason: undefined
    });
  });

  it("policy rejects disallowed command before adapter execution", async () => {
    const adapter: ExecutionAdapter = {
      execute: vi.fn(async () => ({
        state: "completed" as const,
        exitCode: 0,
        stdout: "should not run",
        stderr: ""
      }))
    };
    const runtime = new InMemoryWorkerRuntime({ adapter });
    await runtime.enqueue(
      baseInput({ command: "deploy" }),
      simulatedPolicy({ allowedCommands: ["build"] })
    );

    const job = await runtime.runNext();

    expect(job?.state).toBe("rejected");
    expect(job?.errorName).toBe("sandbox_policy_command_not_allowed");
    expect(job?.resultSummary).toMatchObject({
      state: "rejected",
      errorName: "sandbox_policy_command_not_allowed"
    });
    expect(job?.resultSummary?.stderr).toContain("command not allowed");
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("policy rejects unsupported runtime sandbox modes before adapter execution", async () => {
    const adapter: ExecutionAdapter = {
      execute: vi.fn(async () => ({
        state: "completed" as const,
        exitCode: 0,
        stdout: "should not run",
        stderr: ""
      }))
    };
    const runtime = new InMemoryWorkerRuntime({ adapter });
    await runtime.enqueue(
      baseInput(),
      { ...simulatedPolicy(), mode: "real" as SandboxPolicy["mode"] }
    );

    const job = await runtime.runNext();

    expect(job?.state).toBe("rejected");
    expect(job?.errorName).toBe("sandbox_policy_mode_not_supported");
    expect(job?.resultSummary).toMatchObject({
      state: "rejected",
      errorName: "sandbox_policy_mode_not_supported"
    });
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("policy rejects unexpected env names without storing secret values", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter({
        stdoutByCommand: { build: "should not run" }
      })
    });
    const queued = await runtime.enqueue(
      baseInput({
        env: {
          ALLOWED: "allowed-value",
          SECRET_TOKEN: "super-secret"
        }
      }),
      simulatedPolicy({ allowedEnvNames: ["ALLOWED"] })
    );

    const job = await runtime.runNext();
    const serialized = JSON.stringify(await runtime.getJob(queued.id));

    expect(job?.state).toBe("rejected");
    expect(job?.errorName).toBe("sandbox_policy_env_not_allowed");
    expect(job?.inputSummary.envNames).toEqual(["ALLOWED", "SECRET_TOKEN"]);
    expect(job?.resultSummary?.stderr).toContain("env name not allowed");
    expect(serialized).toContain("SECRET_TOKEN");
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("allowed-value");
  });

  it("redacts known env values from stored output summaries", async () => {
    const adapterResult = {
      state: "completed" as const,
      exitCode: 0,
      stdout: "token secret-token and artifact <style>secret</style>",
      stderr: "stderr secret-token <style>secret</style>"
    };
    const runtime = new InMemoryWorkerRuntime({
      adapter: {
        execute: vi.fn(async () => adapterResult)
      }
    });
    const queued = await runtime.enqueue(
      baseInput({
        env: {
          TOKEN: "secret-token",
          ARTIFACT_FRAGMENT: "<style>secret</style>"
        }
      }),
      simulatedPolicy({
        allowedEnvNames: ["TOKEN", "ARTIFACT_FRAGMENT"],
        maxStdoutBytes: 200,
        maxStderrBytes: 200
      })
    );

    const job = await runtime.runNext();
    const serialized = JSON.stringify(await runtime.getJob(queued.id));

    expect(job?.state).toBe("completed");
    expect(job?.resultSummary?.stdout).toBe(
      "token [redacted] and artifact [redacted]"
    );
    expect(job?.resultSummary?.stderr).toBe("stderr [redacted] [redacted]");
    expect(job?.resultSummary?.stdoutBytes).toBe(
      Buffer.byteLength(adapterResult.stdout, "utf8")
    );
    expect(job?.resultSummary?.stderrBytes).toBe(
      Buffer.byteLength(adapterResult.stderr, "utf8")
    );
    expect(adapterResult.stdout).toContain("secret-token");
    expect(adapterResult.stderr).toContain("<style>secret</style>");
    expect(serialized).toContain("TOKEN");
    expect(serialized).toContain("ARTIFACT_FRAGMENT");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("<style>secret</style>");
  });

  it("policy rejects workingDirectory when the policy has no workingDirectoryRoot", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter()
    });
    await runtime.enqueue(
      baseInput({
        workingDirectory: "/tmp/project"
      }),
      simulatedPolicy()
    );

    const job = await runtime.runNext();

    expect(job?.state).toBe("rejected");
    expect(job?.errorName).toBe("sandbox_policy_working_directory_forbidden");
    expect(job?.resultSummary?.stderr).toContain("workingDirectory forbidden");
  });

  it("policy rejects workingDirectory outside workingDirectoryRoot", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter()
    });
    await runtime.enqueue(
      baseInput({
        workingDirectory: "/tmp/project-other"
      }),
      simulatedPolicy({
        workingDirectoryRoot: "/tmp/project"
      })
    );

    const job = await runtime.runNext();

    expect(job?.state).toBe("rejected");
    expect(job?.errorName).toBe("sandbox_policy_working_directory_forbidden");
    expect(job?.resultSummary?.stderr).toContain("workingDirectory outside root");
  });

  it("SimulatedExecutionAdapter completes with default stdout and bounded summaries", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter()
    });
    await runtime.enqueue(
      baseInput(),
      simulatedPolicy({
        maxStdoutBytes: 10
      })
    );

    const job = await runtime.runNext();

    expect(job?.state).toBe("completed");
    expect(job?.errorName).toBeUndefined();
    expect(job?.resultSummary).toMatchObject({
      state: "completed",
      exitCode: 0,
      stdout: "Simulated ",
      stderr: "",
      stdoutBytes: "Simulated build for project project_a.".length,
      stderrBytes: 0
    });
  });

  it("bounds multibyte stdout without exceeding max bytes", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter({
        stdoutByCommand: {
          build: "你好a"
        }
      })
    });
    await runtime.enqueue(
      baseInput(),
      simulatedPolicy({
        maxStdoutBytes: 5
      })
    );

    const job = await runtime.runNext();
    const stdout = job?.resultSummary?.stdout ?? "";

    expect(job?.state).toBe("completed");
    expect(stdout).toBe("你");
    expect(Buffer.byteLength(stdout, "utf8")).toBeLessThanOrEqual(5);
    expect(stdout).not.toContain("�");
    expect(job?.resultSummary?.stdoutBytes).toBe(Buffer.byteLength("你好a", "utf8"));
  });

  it("stores empty output summaries when output limits are zero", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter({
        stdoutByCommand: {
          build: "abcdef"
        },
        stderrByCommand: {
          build: "stderr"
        }
      })
    });
    await runtime.enqueue(
      baseInput(),
      simulatedPolicy({
        maxStdoutBytes: 0,
        maxStderrBytes: 0
      })
    );

    const job = await runtime.runNext();

    expect(job?.state).toBe("completed");
    expect(job?.resultSummary).toMatchObject({
      stdout: "",
      stderr: "",
      stdoutBytes: 6,
      stderrBytes: 6
    });
  });

  it.each([
    ["negative", { maxStdoutBytes: -1 }],
    ["non-integer", { maxStderrBytes: 1.5 }]
  ] as const)(
    "policy rejects %s output limits before adapter execution",
    async (_caseName, policyOverrides) => {
      const adapter: ExecutionAdapter = {
        execute: vi.fn(async () => ({
          state: "completed" as const,
          exitCode: 0,
          stdout: "should not run",
          stderr: ""
        }))
      };
      const runtime = new InMemoryWorkerRuntime({ adapter });
      await runtime.enqueue(baseInput(), simulatedPolicy(policyOverrides));

      const job = await runtime.runNext();

      expect(job?.state).toBe("rejected");
      expect(job?.errorName).toBe("sandbox_policy_output_limit_invalid");
      expect(job?.resultSummary?.errorName).toBe(
        "sandbox_policy_output_limit_invalid"
      );
      expect(adapter.execute).not.toHaveBeenCalled();
    }
  );

  it("SimulatedExecutionAdapter can fail configured commands with stable defaults", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter({
        failCommands: ["build"]
      })
    });
    await runtime.enqueue(baseInput(), simulatedPolicy());

    const job = await runtime.runNext();

    expect(job?.state).toBe("failed");
    expect(job?.errorName).toBe("simulated_command_failed");
    expect(job?.resultSummary).toMatchObject({
      state: "failed",
      exitCode: 1,
      stderr: "Simulated command failure.",
      errorName: "simulated_command_failed"
    });
  });

  it("RejectingExecutionAdapter returns rejected without real command execution", async () => {
    const adapter = new RejectingExecutionAdapter();
    const input: ExecutionInput = {
      jobId: "worker_job_1",
      projectId: "project_a",
      kind: "tool_command",
      command: "build",
      args: [],
      env: {},
      envNames: [],
      timeoutMs: 1000
    };
    const policy: SandboxPolicy = createRejectSandboxPolicy();

    await expect(
      adapter.execute(input, policy, noCancellationContext)
    ).resolves.toMatchObject({
      state: "rejected",
      errorName: "execution_adapter_rejected",
      stderr: expect.stringContaining("real command execution is disabled")
    });
  });
});
