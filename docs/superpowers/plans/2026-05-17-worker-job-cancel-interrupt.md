# Worker Job Cancel / Interrupt Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add runtime/API cancellation semantics for worker jobs without wiring Web interrupt UI or enabling real execution.

**Architecture:** Extend the worker job record/result model with cancellation metadata, add `WorkerRuntime.cancelJob()`, and pass an `ExecutionContext` into adapters so running jobs can be cooperatively cancelled. Keep cancellation metadata durable and bounded while raw execution payloads remain process-local.

**Tech Stack:** pnpm workspace, TypeScript, Vitest, existing `@lp-agent/worker-runtime`, `@lp-agent/api`, JSON-file worker repositories, and Superpowers docs.

---

## Scope Guard

This plan implements only `docs/superpowers/specs/2026-05-17-worker-job-cancel-interrupt-design.md`.

It must not add:

- Web interrupt button wiring;
- conversation-level task cancellation;
- real shell execution;
- `child_process`, `spawn`, `exec`, signals, process killing, shell parsing, pipes, redirects, or arbitrary command strings;
- MCP execution;
- `apps/agent-worker` queue polling or cross-process job claiming;
- cross-process cancellation guarantees;
- retry/resume behavior;
- streaming logs;
- actor/user identity in worker job records.

Cancellation is cooperative. If an adapter ignores cancellation and returns completed or failed, the runtime must persist the adapter result instead of pretending the job stopped.

## File Structure

- Modify: `packages/worker-runtime/src/index.ts`
  - Add cancel metadata/result types, `ExecutionContext`, `cancelJob()`, queued cancellation, running cancellation requests, cooperative adapter context, cancellation result persistence, and bounded cancel reasons.
- Modify: `packages/worker-runtime/src/worker-job-repositories.ts`
  - Persist/copy `cancelRequestedAt`, `cancelledAt`, and `cancelReason`.
- Modify: `packages/worker-runtime/src/index.test.ts`
  - Add runtime tests for queued cancellation, settled idempotence, running cooperative cancellation, adapter context, and bounded reasons.
- Modify: `packages/worker-runtime/src/worker-job-repositories.test.ts`
  - Add repository tests for cancel metadata defensive copies and JSON persistence.
- Modify: `packages/api/src/tool-command-runner.ts`
  - Allow `ToolCommandRunResult.state === "cancelled"`.
- Modify: `packages/api/src/worker-backed-tool-command-runner.ts`
  - Map cancelled worker jobs to cancelled tool command results.
- Modify: `packages/api/src/worker-backed-tool-command-runner.test.ts`
  - Cover worker-backed runner cancelled mapping.
- Modify: `packages/api/src/services.test.ts`
  - Cover existing skill command service behavior when a command runner returns cancelled.
- Modify: `docs/agent-development-learning.md`
  - Add current implementation status after Stage 10 is complete.
- Modify: `docs/superpowers/README.md`
  - Ensure this plan appears immediately after the Stage 10 design spec.

## Task 1: Add Cancel Metadata To Worker Records And Repositories

**Files:**

- Modify: `packages/worker-runtime/src/index.ts`
- Modify: `packages/worker-runtime/src/worker-job-repositories.ts`
- Modify: `packages/worker-runtime/src/worker-job-repositories.test.ts`

- [ ] **Step 1: Add failing repository tests for cancel metadata**

In `packages/worker-runtime/src/worker-job-repositories.test.ts`, add these tests inside `describe("InMemoryWorkerJobRepository", ...)` and `describe("JsonFileWorkerJobRepository", ...)`.

```ts
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
```

```ts
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
```

- [ ] **Step 2: Run worker-runtime tests and observe the failure**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
```

Expected: fails because repository `copyRecord()` drops cancel fields and `WorkerJobResultSummary.state` does not yet accept `"cancelled"`.

- [ ] **Step 3: Extend worker runtime record/result types**

In `packages/worker-runtime/src/index.ts`, update `WorkerJobResultSummary` and `ExecutionResult`:

```ts
export interface WorkerJobResultSummary {
  state: "completed" | "failed" | "rejected" | "cancelled";
  exitCode?: number;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  errorName?: string;
}

export interface ExecutionResult {
  state: "completed" | "failed" | "rejected" | "cancelled";
  exitCode?: number;
  stdout: string;
  stderr: string;
  errorName?: string;
}
```

Add cancel metadata to `WorkerJobRecord`:

```ts
export interface WorkerJobRecord {
  id: string;
  projectId: string;
  kind: WorkerJobKind;
  state: WorkerJobState;
  policy: SandboxPolicy;
  inputSummary: WorkerJobInputSummary;
  resultSummary?: WorkerJobResultSummary;
  errorName?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelRequestedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
}
```

- [ ] **Step 4: Persist cancel metadata in repository copies**

In `packages/worker-runtime/src/worker-job-repositories.ts`, update `copyRecord()` to include the new fields:

```ts
function copyRecord(record: WorkerJobRecord): WorkerJobRecord {
  return {
    id: record.id,
    projectId: record.projectId,
    kind: record.kind,
    state: record.state,
    policy: copyPolicy(record.policy),
    inputSummary: {
      projectId: record.inputSummary.projectId,
      kind: record.inputSummary.kind,
      commandId: record.inputSummary.commandId,
      command: record.inputSummary.command,
      argCount: record.inputSummary.argCount,
      envNames: [...record.inputSummary.envNames],
      workingDirectory: record.inputSummary.workingDirectory,
      timeoutMs: record.inputSummary.timeoutMs
    },
    resultSummary: record.resultSummary ? { ...record.resultSummary } : undefined,
    errorName: record.errorName,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    cancelRequestedAt: record.cancelRequestedAt,
    cancelledAt: record.cancelledAt,
    cancelReason: record.cancelReason
  };
}
```

- [ ] **Step 5: Run worker-runtime tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
pnpm --filter @lp-agent/worker-runtime typecheck
```

Expected: worker-runtime tests pass and TypeScript accepts the new cancel fields.

- [ ] **Step 6: Commit cancel metadata**

Run:

```bash
git add packages/worker-runtime/src/index.ts packages/worker-runtime/src/worker-job-repositories.ts packages/worker-runtime/src/worker-job-repositories.test.ts
git commit -m "add worker cancel metadata"
```

## Task 2: Implement Queued Cancellation And Settled Idempotence

**Files:**

- Modify: `packages/worker-runtime/src/index.ts`
- Modify: `packages/worker-runtime/src/index.test.ts`

- [ ] **Step 1: Add failing runtime tests for queued and settled cancellation**

In `packages/worker-runtime/src/index.test.ts`, add these tests inside `describe("InMemoryWorkerRuntime", ...)`:

```ts
  it("returns undefined when cancelling an unknown job", async () => {
    const runtime = new InMemoryWorkerRuntime();

    await expect(runtime.cancelJob("worker_job_missing", "interrupt")).resolves.toBeUndefined();
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
```

- [ ] **Step 2: Run tests and observe the failure**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
```

Expected: fails because `WorkerRuntime` and `InMemoryWorkerRuntime` do not have `cancelJob()`.

- [ ] **Step 3: Add constants and runtime API**

In `packages/worker-runtime/src/index.ts`, add constants near the top after the import:

```ts
const CANCEL_REASON_MAX_LENGTH = 200;
const WORKER_JOB_CANCELLED_ERROR = "worker_job_cancelled";
const WORKER_JOB_CANCELLED_BEFORE_EXECUTION_MESSAGE =
  "Worker job cancelled before execution.";
```

Extend `WorkerRuntime`:

```ts
export interface WorkerRuntime {
  enqueue(input: WorkerJobInput, policy?: SandboxPolicy): Promise<WorkerJobRecord>;
  runNext(): Promise<WorkerJobRecord | undefined>;
  cancelJob(id: string, reason?: string): Promise<WorkerJobRecord | undefined>;
  getJob(id: string): Promise<WorkerJobRecord | undefined>;
  listJobsForProject(projectId: string): Promise<WorkerJobRecord[]>;
}
```

- [ ] **Step 4: Implement queued cancellation helpers**

Inside `InMemoryWorkerRuntime`, add `cancelJob()` before `getJob()`:

```ts
  async cancelJob(
    id: string,
    reason?: string
  ): Promise<WorkerJobRecord | undefined> {
    const current = await this.repository.getById(id);
    if (!current) {
      return undefined;
    }

    if (current.state === "running") {
      return this.requestRunningCancellation(current, reason);
    }

    if (current.state !== "queued") {
      return copyRecord(current);
    }

    return this.withRunLock(async () => {
      const latest = await this.repository.getById(id);
      if (!latest) {
        return undefined;
      }
      if (latest.state === "running") {
        return this.requestRunningCancellation(latest, reason);
      }
      if (latest.state !== "queued") {
        return copyRecord(latest);
      }
      return this.cancelQueuedJob(latest, reason);
    });
  }
```

Add these private methods inside `InMemoryWorkerRuntime` before `completeJob()`:

```ts
  private async cancelQueuedJob(
    record: WorkerJobRecord,
    reason?: string
  ): Promise<WorkerJobRecord> {
    const now = this.nowIso();
    const stderr = WORKER_JOB_CANCELLED_BEFORE_EXECUTION_MESSAGE;
    const cancelledRecord: WorkerJobRecord = {
      ...copyRecord(record),
      state: "cancelled",
      errorName: WORKER_JOB_CANCELLED_ERROR,
      resultSummary: {
        state: "cancelled",
        stdout: "",
        stderr,
        stdoutBytes: 0,
        stderrBytes: byteLength(stderr),
        errorName: WORKER_JOB_CANCELLED_ERROR
      },
      cancelRequestedAt: record.cancelRequestedAt ?? now,
      cancelledAt: now,
      completedAt: now,
      cancelReason: normalizeCancelReason(reason) ?? record.cancelReason
    };

    this.payloadsByJobId.delete(record.id);
    await this.repository.save(cancelledRecord);
    return copyRecord(cancelledRecord);
  }

  private async requestRunningCancellation(
    record: WorkerJobRecord,
    reason?: string
  ): Promise<WorkerJobRecord> {
    const updatedRecord: WorkerJobRecord = {
      ...copyRecord(record),
      cancelRequestedAt: record.cancelRequestedAt ?? this.nowIso(),
      cancelReason: record.cancelReason ?? normalizeCancelReason(reason)
    };
    await this.repository.save(updatedRecord);
    return copyRecord(updatedRecord);
  }
```

Add `normalizeCancelReason()` near other helpers:

```ts
function normalizeCancelReason(reason: string | undefined): string | undefined {
  const trimmed = reason?.trim();
  if (!trimmed) {
    return undefined;
  }
  return [...trimmed].slice(0, CANCEL_REASON_MAX_LENGTH).join("");
}
```

- [ ] **Step 5: Run worker-runtime tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
pnpm --filter @lp-agent/worker-runtime typecheck
```

Expected: new queued cancellation tests pass and existing worker-runtime tests remain green.

- [ ] **Step 6: Commit queued cancellation**

Run:

```bash
git add packages/worker-runtime/src/index.ts packages/worker-runtime/src/index.test.ts
git commit -m "add worker queued cancellation"
```

## Task 3: Add Cooperative Running Cancellation Context

**Files:**

- Modify: `packages/worker-runtime/src/index.ts`
- Modify: `packages/worker-runtime/src/index.test.ts`

- [ ] **Step 1: Add a failing cooperative cancellation test**

In `packages/worker-runtime/src/index.test.ts`, add this test inside `describe("InMemoryWorkerRuntime", ...)`:

```ts
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
```

Add this helper near the existing `deferred()` helper:

```ts
function createClock(values: string[]): () => Date {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)]!;
    index += 1;
    return new Date(value);
  };
}
```

- [ ] **Step 2: Run tests and observe the failure**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
```

Expected: fails because `ExecutionAdapter.execute()` does not receive an `ExecutionContext` and `completeJob()` does not persist cancelled execution results.

- [ ] **Step 3: Add the execution context contract**

In `packages/worker-runtime/src/index.ts`, add:

```ts
export interface ExecutionContext {
  isCancellationRequested(): Promise<boolean>;
}
```

Update `ExecutionAdapter`:

```ts
export interface ExecutionAdapter {
  execute(
    input: ExecutionInput,
    policy: SandboxPolicy,
    context: ExecutionContext
  ): Promise<ExecutionResult>;
}
```

- [ ] **Step 4: Pass cancellation context to adapters**

In `runNext()`, replace the adapter call with:

```ts
      const result = await this.adapter.execute(
        toExecutionInput(runningRecord, payload),
        copyPolicy(runningRecord.policy),
        this.createExecutionContext(runningRecord.id)
      );
```

Add this private method inside `InMemoryWorkerRuntime` before `completeJob()`:

```ts
  private createExecutionContext(jobId: string): ExecutionContext {
    return {
      isCancellationRequested: async () => {
        const record = await this.repository.getById(jobId);
        return Boolean(
          record &&
            (record.state === "cancelled" || record.cancelRequestedAt !== undefined)
        );
      }
    };
  }
```

- [ ] **Step 5: Preserve cancel metadata when completing jobs**

Replace `completeJob()` with:

```ts
  private async completeJob(
    record: WorkerJobRecord,
    result: ExecutionResult,
    sensitiveValues: string[]
  ): Promise<WorkerJobRecord> {
    const latestRecord = (await this.repository.getById(record.id)) ?? record;
    const completedAt = this.nowIso();
    const completedRecord: WorkerJobRecord = {
      ...copyRecord(latestRecord),
      state: result.state,
      resultSummary: summarizeResult(result, latestRecord.policy, sensitiveValues),
      errorName: result.errorName,
      completedAt,
      ...(result.state === "cancelled"
        ? {
            cancelRequestedAt: latestRecord.cancelRequestedAt ?? completedAt,
            cancelledAt: completedAt,
            cancelReason: latestRecord.cancelReason
          }
        : {})
    };

    await this.repository.save(completedRecord);

    return copyRecord(completedRecord);
  }
```

- [ ] **Step 6: Update deterministic adapters**

Update `RejectingExecutionAdapter` signature:

```ts
  async execute(
    _input: ExecutionInput,
    _policy: SandboxPolicy,
    _context: ExecutionContext
  ): Promise<ExecutionResult> {
```

Update `SimulatedExecutionAdapter` signature and beginning:

```ts
  async execute(
    input: ExecutionInput,
    _policy: SandboxPolicy,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    if (await context.isCancellationRequested()) {
      return {
        state: "cancelled",
        stdout: "",
        stderr: "Worker job cancelled.",
        errorName: WORKER_JOB_CANCELLED_ERROR
      };
    }

    if (this.failCommands.has(input.command)) {
```

- [ ] **Step 7: Run worker-runtime tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
pnpm --filter @lp-agent/worker-runtime typecheck
```

Expected: worker-runtime tests pass. Existing adapter tests compile because adapters can ignore the third parameter when they do not need it.

- [ ] **Step 8: Commit cooperative cancellation**

Run:

```bash
git add packages/worker-runtime/src/index.ts packages/worker-runtime/src/index.test.ts
git commit -m "add cooperative worker cancellation"
```

## Task 4: Map Cancelled Worker Jobs Through API Runners

**Files:**

- Modify: `packages/api/src/tool-command-runner.ts`
- Modify: `packages/api/src/worker-backed-tool-command-runner.ts`
- Modify: `packages/api/src/worker-backed-tool-command-runner.test.ts`
- Modify: `packages/api/src/services.test.ts`

- [ ] **Step 1: Add failing worker-backed runner cancelled mapping test**

In `packages/api/src/worker-backed-tool-command-runner.test.ts`, add this test:

```ts
  it("maps cancelled worker jobs to cancelled tool command results", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: {
        execute: vi.fn(async () => ({
          state: "cancelled" as const,
          stdout: "",
          stderr: "Worker job cancelled.",
          errorName: "worker_job_cancelled"
        }))
      }
    });
    const runner = new WorkerBackedToolCommandRunner(runtime, (input) =>
      createSimulatedSandboxPolicy({
        allowedCommands: [input.command],
        allowedEnvNames: Object.keys(input.env),
        timeoutMs: input.timeoutMs
      })
    );

    const result = await runner.run(baseInput());

    expect(result).toEqual({
      state: "cancelled",
      exitCode: undefined,
      stdout: "",
      stderr: "Worker job cancelled.",
      errorName: "worker_job_cancelled"
    });
  });
```

- [ ] **Step 2: Add failing service-level cancelled command behavior test**

In `packages/api/src/services.test.ts`, add this test after `persists failed deployment skill command results`:

```ts
  it("persists cancelled deployment skill command results as failed service runs", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const runner = new RecordingToolCommandRunner({
      state: "cancelled",
      exitCode: undefined,
      stdout: "",
      stderr: "Worker job cancelled.",
      errorName: "worker_job_cancelled"
    });
    const service = new DemoWorkbenchService({
      repositories,
      toolCommandRunner: runner,
      env: { STATIC_DEPLOY_TOKEN: "secret-token" },
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const skill = await service.createSkillDraft({
      manifestJson: JSON.stringify(
        deploymentSkillManifest({ commands: [commandWithoutArtifacts()] })
      ),
      content: "# Static deploy",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: skill.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: skill.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });

    const result = await service.executeProjectSkillCommand({
      projectId: project.id,
      skillVersionId: published.id,
      commandId: "publish_static",
      approvedByUserId: "user_1"
    });
    const events = await repositories.runEvents.listForRun(result.run.id);

    expect(result.run.state).toBe("failed");
    expect(result.observation).toMatchObject({
      state: "failed",
      errorName: "worker_job_cancelled",
      outputSummary: "stderr: 21 chars"
    });
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.failed",
      "run.failed"
    ]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool.failed",
          payload: expect.objectContaining({
            errorName: "worker_job_cancelled",
            outputSummary: "stderr: 21 chars"
          })
        }),
        expect.objectContaining({
          type: "run.failed",
          payload: expect.objectContaining({
            errorName: "worker_job_cancelled",
            outputSummary: "stderr: 21 chars"
          })
        })
      ])
    );
  });
```

- [ ] **Step 3: Run API tests and observe the failure**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: fails because `ToolCommandRunResult.state` does not accept `"cancelled"` and the worker-backed runner maps non-completed worker jobs to failed.

- [ ] **Step 4: Extend tool command result state**

In `packages/api/src/tool-command-runner.ts`, update `ToolCommandRunResult`:

```ts
export interface ToolCommandRunResult {
  state: "completed" | "failed" | "cancelled";
  exitCode?: number;
  stdout: string;
  stderr: string;
  errorName?: string;
}
```

- [ ] **Step 5: Map cancelled worker jobs in the worker-backed runner**

In `packages/api/src/worker-backed-tool-command-runner.ts`, update `toToolCommandRunResult()` between the completed branch and the failed branch:

```ts
  if (record.state === "cancelled") {
    return {
      state: "cancelled",
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      errorName: record.errorName ?? "worker_job_cancelled"
    };
  }
```

Keep `isSettled()` unchanged because it already treats `cancelled` as settled.

- [ ] **Step 6: Run API tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/api test
pnpm --filter @lp-agent/api typecheck
```

Expected: API tests pass. `DemoWorkbenchService` continues mapping non-completed command results to failed run/tool observations.

- [ ] **Step 7: Commit API cancelled mapping**

Run:

```bash
git add packages/api/src/tool-command-runner.ts packages/api/src/worker-backed-tool-command-runner.ts packages/api/src/worker-backed-tool-command-runner.test.ts packages/api/src/services.test.ts
git commit -m "map cancelled worker command results"
```

## Task 5: Documentation And Full Verification

**Files:**

- Modify: `docs/agent-development-learning.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Update Stage 10 learning docs after implementation**

In `docs/agent-development-learning.md`, under `### 阶段 10：Worker Job Cancel / Interrupt Foundation`, add this section after `当前计划`:

```md
当前实现状态：

- Stage 10 v0 已实现 `WorkerRuntime.cancelJob()`。
- queued worker job 可立即落到 `cancelled`，并持久化 `cancelRequestedAt`、`cancelledAt`、`completedAt` 和 bounded `cancelReason`。
- running worker job 采用协作式取消：runtime 记录 `cancelRequestedAt`，adapter 通过 `ExecutionContext.isCancellationRequested()` 感知取消请求。
- `WorkerBackedToolCommandRunner` 已能把 cancelled worker job 映射为 `ToolCommandRunResult.state === "cancelled"`；现有 skill command service 仍把非 completed 命令结果落为 failed run/tool observation。
```

- [ ] **Step 2: Confirm Superpowers reading order**

In `docs/superpowers/README.md`, confirm these entries exist in this order:

```md
48. `specs/2026-05-17-worker-job-cancel-interrupt-design.md`
49. `plans/2026-05-17-worker-job-cancel-interrupt.md`
```

If entry 49 is missing, add:

```md
49. `plans/2026-05-17-worker-job-cancel-interrupt.md`
   - Stage 10 worker job cancel and interrupt foundation implementation plan.
   - Read this after the worker job cancel design when implementing or auditing runtime cancellation state, cooperative adapter cancellation context, repository persistence of cancellation metadata, and API cancelled-result mapping.
```

- [ ] **Step 3: Run targeted verification**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
pnpm --filter @lp-agent/api test
pnpm --filter @lp-agent/worker-runtime typecheck
pnpm --filter @lp-agent/api typecheck
```

Expected:

```text
@lp-agent/worker-runtime test: all worker-runtime tests pass
@lp-agent/api test: all API tests pass
@lp-agent/worker-runtime typecheck: no TypeScript errors
@lp-agent/api typecheck: no TypeScript errors
```

- [ ] **Step 4: Run full repository verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected:

```text
pnpm test: all non-skipped tests pass
pnpm typecheck: all workspace typechecks pass
pnpm build: Next.js/app build passes
git diff --check: no whitespace errors
```

- [ ] **Step 5: Check git status before committing docs**

Run:

```bash
git status --short
```

Expected: only intentional Stage 10 files are modified or staged.

- [ ] **Step 6: Commit docs and final verification updates**

Run:

```bash
git add docs/agent-development-learning.md docs/superpowers/README.md
git commit -m "document worker cancellation implementation"
```

If the only docs changes were already committed with this plan, skip this commit and report that no final docs commit was needed.

## Final Handoff

After all tasks pass, report:

- commits created;
- verification commands and results;
- whether queued jobs cancel without adapter execution;
- whether running jobs use cooperative cancellation through `ExecutionContext`;
- whether cancellation metadata persists through both worker repositories;
- whether API worker-backed command results can return `cancelled`;
- whether Web interrupt wiring, real execution, MCP execution, and agent-worker queue remain out of scope.

## Self-Review

- Spec coverage: this plan implements runtime/API cancellation state, cancel metadata, queued cancellation, cooperative running cancellation, adapter context, repository persistence, API cancelled mapping, docs, and verification.
- Scope check: the plan explicitly excludes Web interrupt wiring, conversation-level cancellation, real shell/process execution, MCP execution, agent-worker queue polling, cross-process cancellation guarantees, retry/resume, streaming logs, and actor identity in worker records.
- Type consistency: `cancelJob`, `cancelRequestedAt`, `cancelledAt`, `cancelReason`, `ExecutionContext`, `isCancellationRequested`, `worker_job_cancelled`, and `ToolCommandRunResult.state === "cancelled"` are used consistently across tasks.
- Safety check: cancellation reason is bounded to 200 characters, raw args/env remain process-local, and cancellation does not enable real command execution.
