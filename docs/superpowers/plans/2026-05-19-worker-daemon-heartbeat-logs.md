# Worker Daemon Heartbeat Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Stage 19 worker daemon, heartbeat, stale claim recovery, bounded worker lifecycle logs, optional daemon finalization, and Web read-only worker queue visibility.

**Architecture:** Keep durable worker state in `packages/worker-runtime`, add a bounded worker log repository beside worker job repositories, and expose daemon behavior through `apps/agent-worker`. API composes worker queue snapshots and reuses the existing idempotent finalizer; Web only renders read-only queue health in the existing Skills local worker panel.

**Tech Stack:** TypeScript, Vitest, pnpm monorepo, JSON-file repositories, Next.js server components, existing `@lp-agent/api` and `@lp-agent/worker-runtime` package boundaries.

---

## File Structure

- Modify: `packages/worker-runtime/src/index.ts`
  - Add heartbeat/stale recovery record fields, repository input/output types, runtime methods, and copy/sanitize support.
- Modify: `packages/worker-runtime/src/worker-job-repositories.ts`
  - Implement `heartbeatClaimed()` and `recoverStale()` for in-memory and JSON-file repositories.
- Create: `packages/worker-runtime/src/worker-log-repositories.ts`
  - Add `WorkerLogRepository`, `InMemoryWorkerLogRepository`, `JsonFileWorkerLogRepository`, and factory helpers.
- Modify: `packages/worker-runtime/src/index.test.ts`
  - Cover runtime heartbeat, stale recovery, cancellation priority, recovery limit, and claim-token conflict behavior.
- Create: `packages/worker-runtime/src/worker-log-repositories.test.ts`
  - Cover bounded in-memory and JSON-file worker logs.
- Modify: `packages/worker-runtime/package.json`
  - Add the new worker log repository test file to the package test script.
- Modify: `apps/agent-worker/src/worker.ts`
  - Add `runWorkerDaemon()`, worker log writing, heartbeat during run-once/daemon, stale recovery before claim, and optional finalizer injection.
- Modify: `apps/agent-worker/src/index.ts`
  - Add explicit daemon mode env parsing and optional workbench finalizer wiring.
- Modify: `apps/agent-worker/src/worker.test.ts`
  - Cover daemon idle loop, bounded iterations, job execution with heartbeat/logs, stale recovery, and finalization failure logging.
- Modify: `apps/agent-worker/package.json`
  - Add `@lp-agent/db` dependency if CLI finalization creates JSON-file workbench repositories directly.
- Modify: `packages/api/src/skill-command-worker-queue.ts`
  - Add local queue runtime log repository support, `createWorkerQueueSnapshot()`, snapshot types, and worker log support in `runLocalWorkerOnceAndFinalize()`.
- Modify: `packages/api/src/skill-command-worker-queue.test.ts`
  - Cover snapshot counts, heartbeat status, recent log filtering, and run-once log behavior.
- Modify: `packages/api/src/index.ts`
  - Export new snapshot types/helpers.
- Modify: `apps/web/src/lib/workbench-store.ts`
  - Add `workerQueue` to `WorkbenchPageState`, pass worker job/log repositories, and load snapshots for active projects.
- Modify: `apps/web/src/app/page.tsx`
  - Render queue counts, heartbeat, and recent logs inside the existing `localWorkerPanel`.
- Modify: `apps/web/src/lib/i18n.ts`
  - Add English and Chinese labels for worker queue counts, heartbeat statuses, and empty logs.
- Modify: `apps/web/src/app/globals.css`
  - Style dense worker queue status lists without introducing a new page layout.
- Modify: `apps/web/src/app/page.test.ts`, `apps/web/src/lib/workbench-store.test.ts`, `apps/web/src/lib/i18n.test.ts`
  - Cover Web snapshot loading and rendering.
- Modify: `docs/superpowers/README.md`, `docs/project-roadmap.md`, `docs/agent-development-learning.md`
  - Mark Stage 19 implementation plan as the current execution artifact; final implementation will update status again.

## Task 1: Worker Runtime Heartbeat And Stale Recovery

**Files:**
- Modify: `packages/worker-runtime/src/index.ts`
- Modify: `packages/worker-runtime/src/worker-job-repositories.ts`
- Test: `packages/worker-runtime/src/index.test.ts`

- [ ] **Step 1: Write failing runtime tests**

Append these tests to `packages/worker-runtime/src/index.test.ts` near the worker queue handoff tests:

```ts
describe("worker heartbeat and stale recovery", () => {
  it("updates heartbeat only for the matching running claim", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const runtime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository,
      claimTokenFactory: () => "claim_token_1",
      now: createClock([
        "2026-05-19T00:00:00.000Z",
        "2026-05-19T00:00:01.000Z",
        "2026-05-19T00:00:02.000Z"
      ])
    });

    await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());
    const claim = await runtime.claimOldestQueued({ workerId: "worker_a" });
    if (!claim) {
      throw new Error("Expected claim.");
    }

    await expect(
      runtime.heartbeatClaimedJob({
        jobId: claim.record.id,
        claimToken: "wrong_token",
        workerId: "worker_a",
        heartbeatTimeoutMs: 30000
      })
    ).resolves.toBeUndefined();

    await expect(
      runtime.heartbeatClaimedJob({
        jobId: claim.record.id,
        claimToken: claim.claimToken,
        workerId: "worker_a",
        heartbeatTimeoutMs: 30000
      })
    ).resolves.toMatchObject({
      id: claim.record.id,
      state: "running",
      lastHeartbeatAt: "2026-05-19T00:00:02.000Z",
      heartbeatExpiresAt: "2026-05-19T00:00:32.000Z"
    });
  });

  it("requeues one stale safe persisted job and rejects stale completions", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const runtime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository,
      adapter: new SimulatedExecutionAdapter(),
      claimTokenFactory: createTokenFactory(["claim_token_1", "claim_token_2"]),
      now: createClock([
        "2026-05-19T00:00:00.000Z",
        "2026-05-19T00:00:01.000Z",
        "2026-05-19T00:00:06.000Z",
        "2026-05-19T00:00:07.000Z",
        "2026-05-19T00:00:08.000Z"
      ])
    });

    await runtime.enqueueSafe(baseSafeInput(), simulatedPolicy());
    const staleClaim = await runtime.claimOldestQueued({ workerId: "worker_a" });
    if (!staleClaim) {
      throw new Error("Expected stale claim.");
    }
    await runtime.heartbeatClaimedJob({
      jobId: staleClaim.record.id,
      claimToken: staleClaim.claimToken,
      workerId: "worker_a",
      heartbeatTimeoutMs: 1000
    });

    await expect(
      runtime.recoverStaleJobs({
        staleBefore: "2026-05-19T00:00:06.000Z",
        maxStaleRecoveryCount: 1
      })
    ).resolves.toEqual([
      expect.objectContaining({
        type: "requeued",
        jobId: staleClaim.record.id,
        record: expect.objectContaining({
          state: "queued",
          staleRecoveredAt: "2026-05-19T00:00:06.000Z",
          staleRecoveryCount: 1,
          claimToken: undefined
        })
      })
    ]);

    await expect(runtime.runClaimedJob(staleClaim)).rejects.toThrow(
      "worker_job_claim_conflict"
    );

    const freshClaim = await runtime.claimOldestQueued({ workerId: "worker_b" });
    if (!freshClaim) {
      throw new Error("Expected fresh claim.");
    }
    await expect(runtime.runClaimedJob(freshClaim)).resolves.toMatchObject({
      id: staleClaim.record.id,
      state: "completed",
      claimedByWorkerId: "worker_b"
    });
  });

  it("cancels requested stale jobs and fails jobs over the stale recovery limit", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const runtime = new InMemoryWorkerRuntime({
      repository,
      payloadRepository,
      claimTokenFactory: createTokenFactory(["claim_token_1", "claim_token_2"]),
      now: createClock([
        "2026-05-19T00:00:00.000Z",
        "2026-05-19T00:00:01.000Z",
        "2026-05-19T00:00:02.000Z",
        "2026-05-19T00:00:03.000Z",
        "2026-05-19T00:00:04.000Z",
        "2026-05-19T00:00:05.000Z"
      ])
    });

    await runtime.enqueueSafe(baseSafeInput({ commandId: "cancel_me" }), simulatedPolicy());
    const cancelClaim = await runtime.claimOldestQueued({ workerId: "worker_a" });
    if (!cancelClaim) {
      throw new Error("Expected cancel claim.");
    }
    await runtime.cancelJob(cancelClaim.record.id, "User stopped job.");

    await expect(
      runtime.recoverStaleJobs({
        staleBefore: "2026-05-19T00:00:04.000Z",
        staleClaimTimeoutMs: 1,
        maxStaleRecoveryCount: 1
      })
    ).resolves.toEqual([
      expect.objectContaining({
        type: "cancelled",
        record: expect.objectContaining({
          state: "cancelled",
          errorName: "worker_job_cancelled"
        })
      })
    ]);

    await runtime.enqueueSafe(baseSafeInput({ commandId: "fail_me" }), simulatedPolicy());
    const failClaim = await runtime.claimOldestQueued({ workerId: "worker_a" });
    if (!failClaim) {
      throw new Error("Expected fail claim.");
    }
    await repository.save({
      ...failClaim.record,
      staleRecoveryCount: 1,
      startedAt: "2026-05-19T00:00:00.000Z"
    });

    await expect(
      runtime.recoverStaleJobs({
        staleBefore: "2026-05-19T00:00:05.000Z",
        staleClaimTimeoutMs: 1,
        maxStaleRecoveryCount: 1
      })
    ).resolves.toEqual([
      expect.objectContaining({
        type: "failed",
        record: expect.objectContaining({
          state: "failed",
          errorName: "worker_job_stale_recovery_limit_exceeded"
        })
      })
    ]);
  });
});

function createTokenFactory(values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? values[values.length - 1] ?? "claim_token";
}
```

- [ ] **Step 2: Run the worker-runtime tests and verify failure**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
```

Expected: FAIL with TypeScript errors for missing `heartbeatClaimedJob()`, `recoverStaleJobs()`, stale recovery types, and repository methods.

- [ ] **Step 3: Add runtime types and methods**

In `packages/worker-runtime/src/index.ts`, extend `WorkerJobRecord` and repository contracts:

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
  payloadSource?: WorkerJobPayloadSource;
  claimedByWorkerId?: string;
  claimToken?: string;
  lastHeartbeatAt?: string;
  heartbeatExpiresAt?: string;
  staleRecoveredAt?: string;
  staleRecoveryCount?: number;
  lastWorkerLogAt?: string;
}

export interface WorkerJobRepository {
  save(record: WorkerJobRecord): Promise<void>;
  getById(id: string): Promise<WorkerJobRecord | undefined>;
  listForProject(projectId: string): Promise<WorkerJobRecord[]>;
  listAll(): Promise<WorkerJobRecord[]>;
  findOldestQueued(): Promise<WorkerJobRecord | undefined>;
  claimOldestQueued(
    input: WorkerJobClaimOldestQueuedInput
  ): Promise<WorkerJobRecord | undefined>;
  heartbeatClaimed(
    input: WorkerJobHeartbeatClaimedInput
  ): Promise<WorkerJobRecord | undefined>;
  recoverStale(
    input: WorkerJobRecoverStaleInput
  ): Promise<WorkerJobStaleRecoveryResult[]>;
  completeClaimed(
    input: WorkerJobCompleteClaimedInput
  ): Promise<WorkerJobRecord | undefined>;
  requestRunningCancellation(
    input: WorkerJobRequestRunningCancellationInput
  ): Promise<WorkerJobRecord | undefined>;
  cancelQueued(
    input: WorkerJobCancelQueuedInput
  ): Promise<WorkerJobRecord | undefined>;
}

export interface WorkerJobHeartbeatClaimedInput {
  jobId: string;
  claimToken: string;
  workerId: string;
  heartbeatAt: string;
  heartbeatExpiresAt: string;
}

export interface WorkerJobRecoverStaleInput {
  staleBefore: string;
  recoveredAt: string;
  staleClaimTimeoutMs?: number;
  maxStaleRecoveryCount: number;
  projectId?: string;
}

export type WorkerJobStaleRecoveryType = "requeued" | "cancelled" | "failed";

export interface WorkerJobStaleRecoveryResult {
  type: WorkerJobStaleRecoveryType;
  jobId: string;
  projectId: string;
  record: WorkerJobRecord;
  errorName?: string;
}
```

Add public runtime methods to `InMemoryWorkerRuntime`:

```ts
async heartbeatClaimedJob(input: {
  jobId: string;
  claimToken: string;
  workerId: string;
  heartbeatTimeoutMs: number;
}): Promise<WorkerJobRecord | undefined> {
  const workerId = normalizeWorkerId(input.workerId);
  if (!workerId) {
    throw new Error("worker_id_required");
  }
  if (!Number.isInteger(input.heartbeatTimeoutMs) || input.heartbeatTimeoutMs <= 0) {
    throw new Error("worker_heartbeat_timeout_invalid");
  }

  const heartbeatAt = this.now();
  return this.repository.heartbeatClaimed({
    jobId: input.jobId,
    claimToken: input.claimToken,
    workerId,
    heartbeatAt: heartbeatAt.toISOString(),
    heartbeatExpiresAt: new Date(
      heartbeatAt.getTime() + input.heartbeatTimeoutMs
    ).toISOString()
  });
}

async recoverStaleJobs(input: {
  staleBefore: string;
  staleClaimTimeoutMs?: number;
  maxStaleRecoveryCount: number;
  projectId?: string;
}): Promise<WorkerJobStaleRecoveryResult[]> {
  if (
    !Number.isInteger(input.maxStaleRecoveryCount) ||
    input.maxStaleRecoveryCount < 0
  ) {
    throw new Error("worker_stale_recovery_limit_invalid");
  }
  return this.repository.recoverStale({
    staleBefore: input.staleBefore,
    staleClaimTimeoutMs: input.staleClaimTimeoutMs,
    maxStaleRecoveryCount: input.maxStaleRecoveryCount,
    projectId: input.projectId,
    recoveredAt: this.nowIso()
  });
}
```

Update `claimOldestQueuedForWorker()` so each claim uses one stable `startedAt` value before later heartbeat calls update heartbeat fields:

```ts
const startedAt = this.now();
const claimed = await this.repository.claimOldestQueued({
  payloadSource: "safe_persisted",
  startedAt: startedAt.toISOString(),
  claimedByWorkerId: workerId,
  claimToken,
  projectId
});
```

Update `copyRecord()` in `packages/worker-runtime/src/worker-job-repositories.ts` and the private `copyRecord()` in `packages/worker-runtime/src/index.ts` to copy all new optional fields.

- [ ] **Step 4: Implement repository heartbeat and stale recovery**

In `packages/worker-runtime/src/worker-job-repositories.ts`, add methods to both repository classes. The in-memory implementation should follow this shape:

```ts
async heartbeatClaimed(
  input: WorkerJobHeartbeatClaimedInput
): Promise<WorkerJobRecord | undefined> {
  const record = this.recordsById.get(input.jobId);
  if (
    !record ||
    record.state !== "running" ||
    record.claimToken !== input.claimToken ||
    (record.claimedByWorkerId && record.claimedByWorkerId !== input.workerId)
  ) {
    return undefined;
  }

  const updatedRecord: WorkerJobRecord = {
    ...copyRecord(record),
    lastHeartbeatAt: input.heartbeatAt,
    heartbeatExpiresAt: input.heartbeatExpiresAt
  };
  this.recordsById.set(record.id, copyRecord(updatedRecord));
  return copyRecord(updatedRecord);
}

async recoverStale(
  input: WorkerJobRecoverStaleInput
): Promise<WorkerJobStaleRecoveryResult[]> {
  const results: WorkerJobStaleRecoveryResult[] = [];
  for (const record of this.sortedRecords()) {
    const result = recoverStaleRecord(record, input);
    if (!result) {
      continue;
    }
    this.recordsById.set(record.id, copyRecord(result.record));
    results.push(copyStaleRecoveryResult(result));
  }
  return results;
}
```

Use the same helper for JSON-file recovery inside `withMutationLock()`:

```ts
async recoverStale(
  input: WorkerJobRecoverStaleInput
): Promise<WorkerJobStaleRecoveryResult[]> {
  return this.withMutationLock(async () => {
    const records = await this.readRecords();
    const results: WorkerJobStaleRecoveryResult[] = [];
    for (const record of [...records].sort(compareRecords)) {
      const recordIndex = records.findIndex((stored) => stored.id === record.id);
      if (recordIndex === -1) {
        continue;
      }
      const result = recoverStaleRecord(record, input);
      if (!result) {
        continue;
      }
      records[recordIndex] = copyRecord(result.record);
      results.push(copyStaleRecoveryResult(result));
    }
    if (results.length > 0) {
      await this.writeRecords(records);
    }
    return results;
  });
}
```

Add helper functions in the same file:

```ts
const WORKER_JOB_CANCELLED_ERROR = "worker_job_cancelled";
const WORKER_JOB_STALE_LIMIT_ERROR = "worker_job_stale_recovery_limit_exceeded";

function recoverStaleRecord(
  record: WorkerJobRecord,
  input: WorkerJobRecoverStaleInput
): WorkerJobStaleRecoveryResult | undefined {
  if (
    record.state !== "running" ||
    getPayloadSource(record) !== "safe_persisted" ||
    (input.projectId && record.projectId !== input.projectId) ||
    !isRecordStale(record, input)
  ) {
    return undefined;
  }

  if (record.cancelRequestedAt) {
    const cancelledRecord = createStaleCancelledRecord(record, input.recoveredAt);
    return {
      type: "cancelled",
      jobId: record.id,
      projectId: record.projectId,
      record: cancelledRecord,
      errorName: WORKER_JOB_CANCELLED_ERROR
    };
  }

  const staleRecoveryCount = record.staleRecoveryCount ?? 0;
  if (staleRecoveryCount >= input.maxStaleRecoveryCount) {
    const failedRecord = createStaleFailedRecord(record, input.recoveredAt);
    return {
      type: "failed",
      jobId: record.id,
      projectId: record.projectId,
      record: failedRecord,
      errorName: WORKER_JOB_STALE_LIMIT_ERROR
    };
  }

  const requeuedRecord: WorkerJobRecord = {
    ...copyRecord(record),
    state: "queued",
    startedAt: undefined,
    claimedByWorkerId: undefined,
    claimToken: undefined,
    lastHeartbeatAt: undefined,
    heartbeatExpiresAt: undefined,
    staleRecoveredAt: input.recoveredAt,
    staleRecoveryCount: staleRecoveryCount + 1
  };
  return {
    type: "requeued",
    jobId: record.id,
    projectId: record.projectId,
    record: requeuedRecord
  };
}

function isRecordStale(record: WorkerJobRecord, input: WorkerJobRecoverStaleInput): boolean {
  if (record.heartbeatExpiresAt) {
    return record.heartbeatExpiresAt < input.staleBefore;
  }
  if (!record.startedAt || input.staleClaimTimeoutMs === undefined) {
    return false;
  }
  return new Date(record.startedAt).getTime() + input.staleClaimTimeoutMs <
    new Date(input.staleBefore).getTime();
}
```

Implement `createStaleCancelledRecord()` and `createStaleFailedRecord()` using bounded `WorkerJobResultSummary` with empty stdout/stderr and the stable error names above.

- [ ] **Step 5: Run worker-runtime tests**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
```

Expected: PASS for the package.

- [ ] **Step 6: Commit Task 1**

```bash
git add packages/worker-runtime/src/index.ts packages/worker-runtime/src/worker-job-repositories.ts packages/worker-runtime/src/index.test.ts
git commit -m "add worker heartbeat stale recovery"
```

## Task 2: Bounded Worker Log Repositories

**Files:**
- Create: `packages/worker-runtime/src/worker-log-repositories.ts`
- Create: `packages/worker-runtime/src/worker-log-repositories.test.ts`
- Modify: `packages/worker-runtime/src/index.ts`
- Modify: `packages/worker-runtime/package.json`

- [ ] **Step 1: Write failing worker log repository tests**

Create `packages/worker-runtime/src/worker-log-repositories.test.ts`:

```ts
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
    await expect(repository.list({ projectId: "project_a", limit: 10 })).resolves.toEqual([
      expect.objectContaining({ id: "log_3" })
    ]);
  });

  it("persists bounded JSON-file logs without leaking disallowed payload fields", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worker-logs-"));
    try {
      const filePath = join(directory, "worker-logs.json");
      const first = createJsonFileWorkerLogRepository({ filePath, maxRecords: 2 });
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

      const second = createJsonFileWorkerLogRepository({ filePath, maxRecords: 2 });
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
    createdAt: overrides.createdAt ?? `2026-05-19T00:00:0${overrides.id?.at(-1) ?? "1"}.000Z`
  };
}
```

- [ ] **Step 2: Run the new test and verify failure**

Run:

```bash
pnpm exec vitest run packages/worker-runtime/src/worker-log-repositories.test.ts
```

Expected: FAIL because `worker-log-repositories.ts` and exports do not exist.

- [ ] **Step 3: Implement worker log repositories**

Create `packages/worker-runtime/src/worker-log-repositories.ts`:

```ts
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type WorkerLogType =
  | "worker.daemon.started"
  | "worker.daemon.idle"
  | "worker.daemon.stopped"
  | "worker.job.claimed"
  | "worker.job.heartbeat"
  | "worker.job.completed"
  | "worker.job.failed"
  | "worker.job.cancelled"
  | "worker.job.finalization_failed"
  | "worker.job.stale_recovered"
  | "worker.job.stale_cancelled"
  | "worker.job.stale_failed"
  | "worker.job.claim_conflict";

export interface WorkerLogRecord {
  id: string;
  type: WorkerLogType;
  message: string;
  workerId?: string;
  workerJobId?: string;
  projectId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface WorkerLogListInput {
  projectId?: string;
  workerId?: string;
  workerJobId?: string;
  limit?: number;
}

export interface WorkerLogRepository {
  append(record: WorkerLogRecord): Promise<WorkerLogRecord>;
  list(input?: WorkerLogListInput): Promise<WorkerLogRecord[]>;
}

export interface InMemoryWorkerLogRepositoryOptions {
  maxRecords?: number;
}

export interface JsonFileWorkerLogRepositoryOptions {
  filePath: string;
  maxRecords?: number;
}

interface WorkerLogFileState {
  workerLogs: WorkerLogRecord[];
}

const DEFAULT_MAX_RECORDS = 200;
const jsonFileSaveQueues = new Map<string, Promise<void>>();

export class InMemoryWorkerLogRepository implements WorkerLogRepository {
  private readonly maxRecords: number;
  private readonly recordsById = new Map<string, WorkerLogRecord>();

  constructor(options: InMemoryWorkerLogRepositoryOptions = {}) {
    this.maxRecords = normalizeMaxRecords(options.maxRecords);
  }

  async append(record: WorkerLogRecord): Promise<WorkerLogRecord> {
    const sanitized = sanitizeLogRecord(record);
    this.recordsById.set(sanitized.id, sanitized);
    this.trim();
    return copyLogRecord(sanitized);
  }

  async list(input: WorkerLogListInput = {}): Promise<WorkerLogRecord[]> {
    return filterAndSortLogs([...this.recordsById.values()], input).map(copyLogRecord);
  }

  private trim(): void {
    const sorted = sortLogsNewestFirst([...this.recordsById.values()]);
    for (const stale of sorted.slice(this.maxRecords)) {
      this.recordsById.delete(stale.id);
    }
  }
}

export class JsonFileWorkerLogRepository implements WorkerLogRepository {
  private readonly filePath: string;
  private readonly maxRecords: number;

  constructor(options: JsonFileWorkerLogRepositoryOptions) {
    this.filePath = resolve(options.filePath);
    this.maxRecords = normalizeMaxRecords(options.maxRecords);
  }

  async append(record: WorkerLogRecord): Promise<WorkerLogRecord> {
    return this.withMutationLock(async () => {
      const records = await this.readRecords();
      const sanitized = sanitizeLogRecord(record);
      const index = records.findIndex((stored) => stored.id === sanitized.id);
      if (index === -1) {
        records.push(sanitized);
      } else {
        records[index] = sanitized;
      }
      await this.writeRecords(sortLogsNewestFirst(records).slice(0, this.maxRecords));
      return copyLogRecord(sanitized);
    });
  }

  async list(input: WorkerLogListInput = {}): Promise<WorkerLogRecord[]> {
    return filterAndSortLogs(await this.readRecords(), input).map(copyLogRecord);
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const previousSave = jsonFileSaveQueues.get(this.filePath) ?? Promise.resolve();
    const nextSave = previousSave.catch(() => undefined).then(operation);
    const trackedSave = nextSave.then(
      () => undefined,
      () => undefined
    );
    jsonFileSaveQueues.set(this.filePath, trackedSave);
    try {
      return await nextSave;
    } finally {
      if (jsonFileSaveQueues.get(this.filePath) === trackedSave) {
        jsonFileSaveQueues.delete(this.filePath);
      }
    }
  }

  private async readRecords(): Promise<WorkerLogRecord[]> {
    try {
      const contents = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(contents) as Partial<WorkerLogFileState> | null;
      return Array.isArray(parsed?.workerLogs)
        ? parsed.workerLogs.map(sanitizeLogRecord)
        : [];
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async writeRecords(records: WorkerLogRecord[]): Promise<void> {
    const directory = dirname(this.filePath);
    const tempFilePath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(directory, { recursive: true });
    await writeFile(
      tempFilePath,
      `${JSON.stringify({ workerLogs: records.map(sanitizeLogRecord) }, null, 2)}\n`,
      "utf8"
    );
    await rename(tempFilePath, this.filePath);
  }
}

export function createJsonFileWorkerLogRepository(
  options: JsonFileWorkerLogRepositoryOptions
): JsonFileWorkerLogRepository {
  return new JsonFileWorkerLogRepository(options);
}

function sanitizeLogRecord(record: WorkerLogRecord): WorkerLogRecord {
  return {
    id: String(record.id),
    type: record.type,
    message: String(record.message),
    workerId: toOptionalString(record.workerId),
    workerJobId: toOptionalString(record.workerJobId),
    projectId: toOptionalString(record.projectId),
    payload: sanitizePayload(record.payload),
    createdAt: String(record.createdAt)
  };
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const allowedKeys = [
    "workerId",
    "workerJobId",
    "projectId",
    "state",
    "previousState",
    "nextState",
    "staleRecoveryCount",
    "errorName",
    "exitCode",
    "outputSummary",
    "createdAt"
  ];
  return Object.fromEntries(
    allowedKeys
      .filter((key) => payload[key] !== undefined)
      .map((key) => [key, payload[key]])
  );
}

function filterAndSortLogs(
  records: WorkerLogRecord[],
  input: WorkerLogListInput
): WorkerLogRecord[] {
  const limit = normalizeLimit(input.limit);
  return sortLogsNewestFirst(records)
    .filter((record) => !input.projectId || record.projectId === input.projectId)
    .filter((record) => !input.workerId || record.workerId === input.workerId)
    .filter((record) => !input.workerJobId || record.workerJobId === input.workerJobId)
    .slice(0, limit);
}

function sortLogsNewestFirst(records: WorkerLogRecord[]): WorkerLogRecord[] {
  return [...records].sort((left, right) => {
    const createdAtCompare = right.createdAt.localeCompare(left.createdAt);
    return createdAtCompare !== 0 ? createdAtCompare : right.id.localeCompare(left.id);
  });
}

function normalizeMaxRecords(value: number | undefined): number {
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_RECORDS;
}

function normalizeLimit(value: number | undefined): number {
  return Number.isInteger(value) && value > 0 ? value : 20;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function copyLogRecord(record: WorkerLogRecord): WorkerLogRecord {
  return {
    ...record,
    payload: { ...record.payload }
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
```

Export the new repository from `packages/worker-runtime/src/index.ts`:

```ts
export {
  InMemoryWorkerLogRepository,
  JsonFileWorkerLogRepository,
  createJsonFileWorkerLogRepository,
  type InMemoryWorkerLogRepositoryOptions,
  type JsonFileWorkerLogRepositoryOptions,
  type WorkerLogListInput,
  type WorkerLogRecord,
  type WorkerLogRepository,
  type WorkerLogType
} from "./worker-log-repositories";
```

Update `packages/worker-runtime/package.json`:

```json
"test": "vitest run src/index.test.ts src/worker-job-repositories.test.ts src/worker-job-payload-repositories.test.ts src/worker-log-repositories.test.ts"
```

- [ ] **Step 4: Run worker-runtime tests**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add packages/worker-runtime/src/index.ts packages/worker-runtime/src/worker-log-repositories.ts packages/worker-runtime/src/worker-log-repositories.test.ts packages/worker-runtime/package.json
git commit -m "add bounded worker log repository"
```

## Task 3: Agent Worker Daemon Loop

**Files:**
- Modify: `apps/agent-worker/src/worker.ts`
- Modify: `apps/agent-worker/src/index.ts`
- Modify: `apps/agent-worker/src/worker.test.ts`
- Modify: `apps/agent-worker/package.json`

- [ ] **Step 1: Write failing daemon tests**

Append to `apps/agent-worker/src/worker.test.ts`:

```ts
// Update the existing Vitest import to include vi:
// import { describe, expect, it, vi } from "vitest";
import {
  InMemoryWorkerLogRepository,
  type WorkerLogRepository
} from "@lp-agent/worker-runtime";

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
});
```

Add helper `simulatedPolicy()` if the file does not already have it:

```ts
function simulatedPolicy() {
  return createSimulatedSandboxPolicy({
    allowedCommands: ["build"],
    allowedEnvNames: ["PUBLIC_FLAG"],
    timeoutMs: 1000
  });
}
```

- [ ] **Step 2: Run agent-worker tests and verify failure**

Run:

```bash
pnpm --filter @lp-agent/agent-worker test
```

Expected: FAIL because `runWorkerDaemon()` and log integration do not exist.

- [ ] **Step 3: Implement daemon loop and log helper**

In `apps/agent-worker/src/worker.ts`, extend imports and inputs:

```ts
import {
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter,
  type ExecutionAdapter,
  type WorkerJobPayloadRepository,
  type WorkerJobRecord,
  type WorkerJobRepository,
  type WorkerLogRepository,
  type WorkerLogType
} from "@lp-agent/worker-runtime";

export interface RunWorkerOnceInput {
  workerId: string;
  jobRepository: WorkerJobRepository;
  payloadRepository: WorkerJobPayloadRepository;
  workerLogRepository?: WorkerLogRepository;
  adapter?: ExecutionAdapter;
  now?: () => Date;
  claimTokenFactory?: () => string;
  heartbeatTimeoutMs?: number;
}

export interface RunWorkerDaemonInput extends RunWorkerOnceInput {
  finalizeWorkerJob?: (workerJob: WorkerJobRecord) => Promise<void>;
  maxIterations: number;
  pollIntervalMs: number;
  heartbeatTimeoutMs: number;
  staleClaimTimeoutMs: number;
  maxStaleRecoveryCount: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RunWorkerDaemonResult {
  iterations: number;
  processedJobs: number;
  idleIterations: number;
  stoppedReason: "max_iterations";
}
```

Add a shared runtime factory and log helper:

```ts
function createWorkerRuntime(input: RunWorkerOnceInput): InMemoryWorkerRuntime {
  return new InMemoryWorkerRuntime({
    repository: input.jobRepository,
    payloadRepository: input.payloadRepository,
    adapter: input.adapter ?? new SimulatedExecutionAdapter(),
    now: input.now,
    claimTokenFactory: input.claimTokenFactory
  });
}

async function appendWorkerLog(input: {
  repository?: WorkerLogRepository;
  type: WorkerLogType;
  message: string;
  workerId: string;
  workerJob?: WorkerJobRecord;
  payload?: Record<string, unknown>;
  now?: () => Date;
}): Promise<void> {
  if (!input.repository) {
    return;
  }
  const createdAt = (input.now ?? (() => new Date()))().toISOString();
  await input.repository.append({
    id: `${input.workerJob?.id ?? input.workerId}_${input.type}_${createdAt}`,
    type: input.type,
    message: input.message,
    workerId: input.workerId,
    workerJobId: input.workerJob?.id,
    projectId: input.workerJob?.projectId,
    payload: {
      workerId: input.workerId,
      workerJobId: input.workerJob?.id,
      projectId: input.workerJob?.projectId,
      state: input.workerJob?.state,
      errorName: input.workerJob?.errorName,
      outputSummary: input.workerJob?.resultSummary?.stdout,
      createdAt,
      ...(input.payload ?? {})
    },
    createdAt
  });
}
```

Update `runWorkerOnce()` to heartbeat and log if a log repository is passed:

```ts
const runtime = createWorkerRuntime(input);
const claim = await runtime.claimOldestQueued({ workerId: input.workerId });
if (!claim) {
  return undefined;
}
await appendWorkerLog({
  repository: input.workerLogRepository,
  type: "worker.job.claimed",
  message: "Worker job claimed.",
  workerId: input.workerId,
  workerJob: claim.record,
  now: input.now
});
await runtime.heartbeatClaimedJob({
  jobId: claim.record.id,
  claimToken: claim.claimToken,
  workerId: input.workerId,
  heartbeatTimeoutMs: input.heartbeatTimeoutMs ?? 30000
});
await appendWorkerLog({
  repository: input.workerLogRepository,
  type: "worker.job.heartbeat",
  message: "Worker job heartbeat recorded.",
  workerId: input.workerId,
  workerJob: claim.record,
  now: input.now
});
const completed = await runtime.runClaimedJob(claim);
await appendWorkerLog({
  repository: input.workerLogRepository,
  type: toTerminalWorkerLogType(completed),
  message: "Worker job reached a terminal state.",
  workerId: input.workerId,
  workerJob: completed,
  now: input.now
});
return completed;
```

Add `runWorkerDaemon()`:

```ts
export async function runWorkerDaemon(
  input: RunWorkerDaemonInput
): Promise<RunWorkerDaemonResult> {
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const runtime = createWorkerRuntime(input);
  let processedJobs = 0;
  let idleIterations = 0;

  for (let iteration = 0; iteration < input.maxIterations; iteration += 1) {
    const recovered = await runtime.recoverStaleJobs({
      staleBefore: (input.now ?? (() => new Date()))().toISOString(),
      staleClaimTimeoutMs: input.staleClaimTimeoutMs,
      maxStaleRecoveryCount: input.maxStaleRecoveryCount
    });
    for (const result of recovered) {
      await appendWorkerLog({
        repository: input.workerLogRepository,
        type: toStaleWorkerLogType(result.type),
        message: "Worker stale job recovered.",
        workerId: input.workerId,
        workerJob: result.record,
        payload: { staleRecoveryCount: result.record.staleRecoveryCount },
        now: input.now
      });
    }

    const workerJob = await runWorkerOnce(input);
    if (!workerJob) {
      idleIterations += 1;
      await appendWorkerLog({
        repository: input.workerLogRepository,
        type: "worker.daemon.idle",
        message: "Worker daemon found no queued jobs.",
        workerId: input.workerId,
        now: input.now
      });
      await sleep(input.pollIntervalMs);
      continue;
    }

    processedJobs += 1;
    if (input.finalizeWorkerJob) {
      try {
        await input.finalizeWorkerJob(workerJob);
      } catch (error) {
        await appendWorkerLog({
          repository: input.workerLogRepository,
          type: "worker.job.finalization_failed",
          message: "Worker job finalization failed.",
          workerId: input.workerId,
          workerJob,
          payload: {
            errorName: error instanceof Error ? error.name : "worker_job_finalization_failed"
          },
          now: input.now
        });
      }
    }
  }

  return {
    iterations: input.maxIterations,
    processedJobs,
    idleIterations,
    stoppedReason: "max_iterations"
  };
}
```

Add terminal log mapping helpers:

```ts
function toTerminalWorkerLogType(record: WorkerJobRecord): WorkerLogType {
  if (record.state === "cancelled") {
    return "worker.job.cancelled";
  }
  if (record.state === "completed") {
    return "worker.job.completed";
  }
  return "worker.job.failed";
}

function toStaleWorkerLogType(type: "requeued" | "cancelled" | "failed"): WorkerLogType {
  if (type === "requeued") {
    return "worker.job.stale_recovered";
  }
  if (type === "cancelled") {
    return "worker.job.stale_cancelled";
  }
  return "worker.job.stale_failed";
}
```

- [ ] **Step 4: Wire CLI daemon mode**

In `apps/agent-worker/src/index.ts`, import worker logs and optional workbench repositories:

```ts
import { createJsonFileWorkbenchRepositories } from "@lp-agent/db";
import {
  createJsonFileWorkerJobPayloadRepository,
  createJsonFileWorkerJobRepository,
  createJsonFileWorkerLogRepository
} from "@lp-agent/worker-runtime";
import { finalizeWorkerBackedSkillCommand } from "@lp-agent/api";
import { runDemoWorkerJob, runWorkerDaemon, runWorkerOnce } from "./worker";
```

Parse env:

```ts
const logsFilePath = process.env.WORKER_LOGS_FILE;
const workbenchStateFilePath = process.env.LP_AGENT_WORKBENCH_STATE_FILE;
const workerMode = process.env.WORKER_MODE ?? (process.env.WORKER_DAEMON === "1" ? "daemon" : "once");
```

When `jobsFilePath && payloadsFilePath`, create repositories:

```ts
const jobRepository = createJsonFileWorkerJobRepository({ filePath: jobsFilePath });
const payloadRepository = createJsonFileWorkerJobPayloadRepository({ filePath: payloadsFilePath });
const workerLogRepository = logsFilePath
  ? createJsonFileWorkerLogRepository({ filePath: logsFilePath })
  : undefined;
const workbenchRepositories = workbenchStateFilePath
  ? createJsonFileWorkbenchRepositories({ filePath: workbenchStateFilePath })
  : undefined;
const finalizeWorkerJob = workbenchRepositories
  ? async (workerJob: WorkerJobRecord) => {
      const result = await finalizeWorkerBackedSkillCommand({
        repositories: workbenchRepositories,
        workerJob
      });
      if (!result.ok) {
        throw new Error(result.error);
      }
    }
  : undefined;
```

Use daemon mode:

```ts
if (workerMode === "daemon") {
  const result = await runWorkerDaemon({
    workerId,
    jobRepository,
    payloadRepository,
    workerLogRepository,
    finalizeWorkerJob,
    maxIterations: Number.parseInt(process.env.WORKER_DAEMON_MAX_ITERATIONS ?? "100", 10),
    pollIntervalMs: Number.parseInt(process.env.WORKER_POLL_INTERVAL_MS ?? "1000", 10),
    heartbeatTimeoutMs: Number.parseInt(process.env.WORKER_HEARTBEAT_TIMEOUT_MS ?? "30000", 10),
    staleClaimTimeoutMs: Number.parseInt(process.env.WORKER_STALE_CLAIM_TIMEOUT_MS ?? "60000", 10),
    maxStaleRecoveryCount: Number.parseInt(process.env.WORKER_MAX_STALE_RECOVERY_COUNT ?? "1", 10)
  });
  console.log(JSON.stringify({ workerId, mode: "daemon", result }, null, 2));
} else {
  const result = await runWorkerOnce({
    workerId,
    jobRepository,
    payloadRepository,
    workerLogRepository
  });
  console.log(JSON.stringify({ workerId, mode: "once", jobId: result?.id, state: result?.state }, null, 2));
}
```

Add `@lp-agent/db` to `apps/agent-worker/package.json` dependencies if direct import is used:

```json
"@lp-agent/db": "workspace:*"
```

- [ ] **Step 5: Run agent-worker tests**

Run:

```bash
pnpm --filter @lp-agent/agent-worker test
pnpm --filter @lp-agent/agent-worker typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add apps/agent-worker/src/worker.ts apps/agent-worker/src/index.ts apps/agent-worker/src/worker.test.ts apps/agent-worker/package.json
git commit -m "add worker daemon loop"
```

## Task 4: API Worker Queue Snapshot

**Files:**
- Modify: `packages/api/src/skill-command-worker-queue.ts`
- Modify: `packages/api/src/skill-command-worker-queue.test.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Write failing API tests**

Add these imports to `packages/api/src/skill-command-worker-queue.test.ts`:

```ts
import {
  InMemoryWorkerJobRepository,
  InMemoryWorkerLogRepository,
  type SafeWorkerJobInput,
  type WorkerLogRepository
} from "@lp-agent/worker-runtime";
```

Update the existing local import from `./skill-command-worker-queue` so it includes `createWorkerQueueSnapshot` next to `createLocalWorkerQueueRuntime`, `finalizeWorkerBackedSkillCommand`, and `runLocalWorkerOnceAndFinalize`.

Add tests near the existing `createLocalWorkerQueueRuntime` tests:

```ts
describe("worker queue snapshot", () => {
  it("summarizes project-scoped queue counts, stale jobs, heartbeat, and logs", async () => {
    const jobRepository = new InMemoryWorkerJobRepository();
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const workerLogRepository = new InMemoryWorkerLogRepository();
    const runtime = new InMemoryWorkerRuntime({
      repository: jobRepository,
      payloadRepository,
      claimTokenFactory: () => "claim_token_1",
      now: createClock([
        "2026-05-19T00:00:00.000Z",
        "2026-05-19T00:00:01.000Z",
        "2026-05-19T00:00:02.000Z"
      ])
    });
    await runtime.enqueueSafe(baseSafeWorkerInput("project_1"), simulatedPolicy());
    await runtime.enqueueSafe(baseSafeWorkerInput("project_2"), simulatedPolicy());
    const claim = await runtime.claimOldestQueuedForProject({
      workerId: "worker_a",
      projectId: "project_1"
    });
    if (!claim) {
      throw new Error("Expected claim.");
    }
    await runtime.heartbeatClaimedJob({
      jobId: claim.record.id,
      claimToken: claim.claimToken,
      workerId: "worker_a",
      heartbeatTimeoutMs: 1000
    });
    await workerLogRepository.append({
      id: "log_1",
      type: "worker.job.claimed",
      message: "Worker job claimed.",
      workerId: "worker_a",
      workerJobId: claim.record.id,
      projectId: "project_1",
      payload: {
        workerId: "worker_a",
        workerJobId: claim.record.id,
        projectId: "project_1",
        state: "running"
      },
      createdAt: "2026-05-19T00:00:01.000Z"
    });

    const snapshot = await createWorkerQueueSnapshot({
      jobRepository,
      workerLogRepository,
      projectId: "project_1",
      now: () => new Date("2026-05-19T00:00:03.000Z"),
      recentLogLimit: 5
    });

    expect(snapshot.counts).toMatchObject({
      queued: 0,
      running: 1,
      stale: 1,
      completed: 0,
      failed: 0,
      rejected: 0,
      cancelled: 0
    });
    expect(snapshot.heartbeat).toMatchObject({
      workerId: "worker_a",
      status: "stale"
    });
    expect(snapshot.logs).toEqual([
      expect.objectContaining({
        type: "worker.job.claimed",
        workerJobId: claim.record.id,
        projectId: "project_1"
      })
    ]);
  });

  it("writes safe worker logs during local worker run-once", async () => {
    const workerLogRepository = new InMemoryWorkerLogRepository();
    const { repositories, workerJob } = await linkedWorkerJob({ state: "completed" });
    const workerRuntime: SkillCommandQueueRuntime = {
      enqueueSafe: async () => workerJob,
      claimOldestQueued: async () => ({
        record: workerJob,
        claimToken: "claim_token_1"
      }),
      heartbeatClaimedJob: async () => workerJob,
      runClaimedJob: async () => workerJob,
      getJob: async () => workerJob
    };

    await runLocalWorkerOnceAndFinalize({
      repositories,
      workerRuntime,
      workerLogRepository,
      workerId: "local-web-worker",
      now: () => new Date("2026-05-19T00:00:04.000Z")
    });

    await expect(workerLogRepository.list({ limit: 10 })).resolves.toEqual([
      expect.objectContaining({ type: "worker.job.completed" }),
      expect.objectContaining({ type: "worker.job.heartbeat" }),
      expect.objectContaining({ type: "worker.job.claimed" })
    ]);
  });
});

function baseSafeWorkerInput(projectId: string): SafeWorkerJobInput {
  return {
    projectId,
    kind: "tool_command",
    command: "build",
    args: ["--fast"],
    envNames: ["PUBLIC_FLAG"],
    timeoutMs: 1000
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
  return () => new Date(values[index++] ?? values[values.length - 1] ?? values[0]);
}
```

Update `tempQueueFiles()` in the same test file:

```ts
return {
  jobsFilePath: join(dir, "worker-jobs.json"),
  payloadsFilePath: join(dir, "worker-payloads.json"),
  logsFilePath: join(dir, "worker-logs.json")
};
```

- [ ] **Step 2: Run API tests and verify failure**

Run:

```bash
pnpm exec vitest run packages/api/src/skill-command-worker-queue.test.ts
```

Expected: FAIL because `createWorkerQueueSnapshot`, `workerLogRepository` support, and `logsFilePath` support do not exist.

- [ ] **Step 3: Add snapshot types and local runtime log repository**

In `packages/api/src/skill-command-worker-queue.ts`, extend imports:

```ts
import type {
  WorkerJobPayloadRepository,
  WorkerJobRepository,
  WorkerLogRecord,
  WorkerLogRepository,
  SafeWorkerJobInput,
  SandboxPolicy,
  WorkerJobRecord
} from "@lp-agent/worker-runtime";
import {
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter,
  createJsonFileWorkerJobPayloadRepository,
  createJsonFileWorkerJobRepository,
  createJsonFileWorkerLogRepository
} from "@lp-agent/worker-runtime";
```

Add snapshot types:

```ts
export type WorkerHeartbeatStatus = "active" | "idle" | "stale" | "unknown";

export interface WorkerQueueSnapshotLog {
  id: string;
  type: string;
  message: string;
  workerId?: string;
  workerJobId?: string;
  projectId?: string;
  createdAt: string;
}

export interface WorkerQueueSnapshot {
  counts: {
    queued: number;
    running: number;
    stale: number;
    completed: number;
    failed: number;
    rejected: number;
    cancelled: number;
  };
  heartbeat: {
    workerId?: string;
    lastHeartbeatAt?: string;
    status: WorkerHeartbeatStatus;
  };
  logs: WorkerQueueSnapshotLog[];
}
```

Extend local runtime:

```ts
export interface LocalWorkerQueueRuntime {
  runtime: InMemoryWorkerRuntime;
  jobRepository: WorkerJobRepository;
  payloadRepository: WorkerJobPayloadRepository;
  workerLogRepository: WorkerLogRepository;
}

export function createLocalWorkerQueueRuntime(input: {
  jobsFilePath: string;
  payloadsFilePath: string;
  logsFilePath?: string;
}): LocalWorkerQueueRuntime {
  const jobRepository = createJsonFileWorkerJobRepository({ filePath: input.jobsFilePath });
  const payloadRepository = createJsonFileWorkerJobPayloadRepository({
    filePath: input.payloadsFilePath
  });
  const workerLogRepository = createJsonFileWorkerLogRepository({
    filePath: input.logsFilePath ?? input.jobsFilePath.replace(/worker-jobs\.json$/, "worker-logs.json")
  });
  const runtime = new InMemoryWorkerRuntime({
    repository: jobRepository,
    payloadRepository,
    adapter: new SimulatedExecutionAdapter()
  });
  return { runtime, jobRepository, payloadRepository, workerLogRepository };
}
```

- [ ] **Step 4: Implement snapshot and run-once logging**

Add optional log repository to `runLocalWorkerOnceAndFinalize()` input:

```ts
workerLogRepository?: WorkerLogRepository;
heartbeatTimeoutMs?: number;
```

After claim and before `runClaimedJob()`, record heartbeat/logs:

```ts
await appendWorkerLog({
  repository: input.workerLogRepository,
  type: "worker.job.claimed",
  message: "Worker job claimed.",
  workerId: input.workerId,
  workerJob: claim.record,
  now: input.now
});
if ("heartbeatClaimedJob" in input.workerRuntime) {
  await input.workerRuntime.heartbeatClaimedJob({
    jobId: claim.record.id,
    claimToken: claim.claimToken,
    workerId: input.workerId,
    heartbeatTimeoutMs: input.heartbeatTimeoutMs ?? 30000
  });
}
await appendWorkerLog({
  repository: input.workerLogRepository,
  type: "worker.job.heartbeat",
  message: "Worker job heartbeat recorded.",
  workerId: input.workerId,
  workerJob: claim.record,
  now: input.now
});
```

After terminal job returns, append the terminal log:

```ts
await appendWorkerLog({
  repository: input.workerLogRepository,
  type: toTerminalWorkerLogType(workerJob),
  message: "Worker job reached a terminal state.",
  workerId: input.workerId,
  workerJob,
  now: input.now
});
```

Add `createWorkerQueueSnapshot()`:

```ts
export async function createWorkerQueueSnapshot(input: {
  jobRepository: WorkerJobRepository;
  workerLogRepository?: WorkerLogRepository;
  projectId: string;
  now?: () => Date;
  staleClaimTimeoutMs?: number;
  recentLogLimit?: number;
}): Promise<WorkerQueueSnapshot> {
  const now = input.now ?? (() => new Date());
  const records = await input.jobRepository.listForProject(input.projectId);
  const staleRecords = records.filter((record) =>
    isStaleWorkerJob(record, now(), input.staleClaimTimeoutMs ?? 60000)
  );
  const logs = input.workerLogRepository
    ? await input.workerLogRepository.list({
        projectId: input.projectId,
        limit: input.recentLogLimit ?? 10
      })
    : [];
  const heartbeat = deriveHeartbeat(records, logs, now());

  return {
    counts: {
      queued: records.filter((record) => record.state === "queued").length,
      running: records.filter((record) => record.state === "running").length,
      stale: staleRecords.length,
      completed: records.filter((record) => record.state === "completed").length,
      failed: records.filter((record) => record.state === "failed").length,
      rejected: records.filter((record) => record.state === "rejected").length,
      cancelled: records.filter((record) => record.state === "cancelled").length
    },
    heartbeat,
    logs: logs.map(toSnapshotLog)
  };
}
```

Implement helpers in the same file:

```ts
function isStaleWorkerJob(record: WorkerJobRecord, now: Date, timeoutMs: number): boolean {
  if (record.state !== "running") {
    return false;
  }
  if (record.heartbeatExpiresAt) {
    return record.heartbeatExpiresAt < now.toISOString();
  }
  if (!record.startedAt) {
    return false;
  }
  return new Date(record.startedAt).getTime() + timeoutMs < now.getTime();
}

function deriveHeartbeat(
  records: WorkerJobRecord[],
  logs: WorkerLogRecord[],
  now: Date
): WorkerQueueSnapshot["heartbeat"] {
  const latestRunning = records
    .filter((record) => record.state === "running" && record.lastHeartbeatAt)
    .sort((left, right) => right.lastHeartbeatAt!.localeCompare(left.lastHeartbeatAt!))
    .at(0);
  if (latestRunning) {
    return {
      workerId: latestRunning.claimedByWorkerId,
      lastHeartbeatAt: latestRunning.lastHeartbeatAt,
      status: isStaleWorkerJob(latestRunning, now, 60000) ? "stale" : "active"
    };
  }
  const latestLog = logs.at(0);
  if (!latestLog) {
    return { status: "unknown" };
  }
  return {
    workerId: latestLog.workerId,
    lastHeartbeatAt: latestLog.createdAt,
    status: latestLog.type === "worker.daemon.idle" ? "idle" : "active"
  };
}

function toSnapshotLog(log: WorkerLogRecord): WorkerQueueSnapshotLog {
  return {
    id: log.id,
    type: log.type,
    message: log.message,
    workerId: log.workerId,
    workerJobId: log.workerJobId,
    projectId: log.projectId,
    createdAt: log.createdAt
  };
}
```

Update `SkillCommandQueueRuntime` to include optional `heartbeatClaimedJob()` so API can call it without casting:

```ts
heartbeatClaimedJob?(input: {
  jobId: string;
  claimToken: string;
  workerId: string;
  heartbeatTimeoutMs: number;
}): Promise<WorkerJobRecord | undefined>;
```

Export from `packages/api/src/index.ts`:

```ts
export {
  createLocalWorkerQueueRuntime,
  createWorkerQueueSnapshot,
  finalizeWorkerBackedSkillCommand,
  runLocalWorkerOnceAndFinalize,
  type LocalWorkerQueueRuntime,
  type RunLocalWorkerOnceResult,
  type SkillCommandQueueRuntime,
  type WorkerHeartbeatStatus,
  type WorkerQueueSnapshot,
  type WorkerQueueSnapshotLog
} from "./skill-command-worker-queue";
```

- [ ] **Step 5: Run API tests**

Run:

```bash
pnpm --filter @lp-agent/api test
pnpm --filter @lp-agent/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add packages/api/src/skill-command-worker-queue.ts packages/api/src/skill-command-worker-queue.test.ts packages/api/src/index.ts
git commit -m "add worker queue snapshot api"
```

## Task 5: Web Read-Only Worker Queue Visibility

**Files:**
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`

- [ ] **Step 1: Write failing Web rendering test**

In `apps/web/src/app/page.test.ts`, update `pageMocks.pageState` to include a default `workerQueue`:

```ts
workerQueue: {
  counts: {
    queued: 0,
    running: 0,
    stale: 0,
    completed: 0,
    failed: 0,
    rejected: 0,
    cancelled: 0
  },
  heartbeat: { status: "unknown" },
  logs: []
}
```

Add a rendering test near the existing local worker form test:

```ts
it("renders worker queue snapshot counts, heartbeat, and recent logs", async () => {
  setActiveEmptyProjectState();
  pageMocks.pageState = {
    ...(pageMocks.pageState as Record<string, unknown>),
    workerQueue: {
      counts: {
        queued: 2,
        running: 1,
        stale: 1,
        completed: 3,
        failed: 1,
        rejected: 0,
        cancelled: 1
      },
      heartbeat: {
        workerId: "worker_a",
        lastHeartbeatAt: "2026-05-19T00:00:03.000Z",
        status: "stale"
      },
      logs: [
        {
          id: "log_1",
          type: "worker.job.stale_recovered",
          message: "Worker stale job recovered.",
          workerId: "worker_a",
          workerJobId: "worker_job_1",
          projectId: "project_1",
          createdAt: "2026-05-19T00:00:03.000Z"
        }
      ]
    }
  };

  const html = await renderHomePage({
    searchParams: Promise.resolve({ view: "skills" }),
    acceptLanguage: "en"
  });

  expect(html).toContain("Queued: 2");
  expect(html).toContain("Running: 1");
  expect(html).toContain("Stale: 1");
  expect(html).toContain("Heartbeat: stale");
  expect(html).toContain("worker.job.stale_recovered");
});
```

- [ ] **Step 2: Write failing store snapshot test**

In `apps/web/src/lib/workbench-store.test.ts`, add a test after the worker queue setup tests:

```ts
it("loads worker queue snapshot for the active project", async () => {
  const directory = await mkdtemp(join(tmpdir(), "web-worker-snapshot-"));
  try {
    const workerQueue = createLocalWorkerQueueRuntime({
      jobsFilePath: join(directory, "worker-jobs.json"),
      payloadsFilePath: join(directory, "worker-payloads.json"),
      logsFilePath: join(directory, "worker-logs.json")
    });
    await workerQueue.runtime.enqueueSafe(
      {
        projectId: "project_1",
        kind: "tool_command",
        command: "build",
        args: ["--fast"],
        envNames: ["PUBLIC_FLAG"],
        timeoutMs: 1000
      },
      createSimulatedSandboxPolicy({
        allowedCommands: ["build"],
        allowedEnvNames: ["PUBLIC_FLAG"]
      })
    );
    const store = createWebWorkbenchStore({
      repositories: createInMemoryWorkbenchRepositories(),
      workerQueueRuntime: workerQueue.runtime,
      workerRuntime: workerQueue.runtime,
      workerJobRepository: workerQueue.jobRepository,
      workerLogRepository: workerQueue.workerLogRepository
    });
    await store.createProject({ name: "Project A" });

    const state = await store.getPageState({ projectId: "project_1" });

    expect(state.workerQueue.counts.queued).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Add store types and snapshot loading**

In `apps/web/src/lib/workbench-store.ts`, import snapshot helper/types:

```ts
import {
  createWorkerQueueSnapshot,
  type WorkerQueueSnapshot
} from "@lp-agent/api";
import type {
  WorkerJobRepository,
  WorkerLogRepository
} from "@lp-agent/worker-runtime";
```

Keep the imports grouped with the existing `@lp-agent/api` and `@lp-agent/worker-runtime` imports. Do not import worker repository types from `@lp-agent/api`.

The new symbols are:

```ts
createWorkerQueueSnapshot,
type WorkerQueueSnapshot
```

Add to `WorkbenchPageState` variants:

```ts
workerQueue: WorkerQueueSnapshot;
```

Extend `WebWorkbenchStoreOptions`:

```ts
workerJobRepository?: WorkerJobRepository;
workerLogRepository?: WorkerLogRepository;
```

Define an empty snapshot helper:

```ts
function emptyWorkerQueueSnapshot(): WorkerQueueSnapshot {
  return {
    counts: {
      queued: 0,
      running: 0,
      stale: 0,
      completed: 0,
      failed: 0,
      rejected: 0,
      cancelled: 0
    },
    heartbeat: { status: "unknown" },
    logs: []
  };
}
```

Inside `createWebWorkbenchStore()`, capture repositories:

```ts
const workerJobRepository = options.workerJobRepository;
const workerLogRepository = options.workerLogRepository;
```

Add loader:

```ts
const loadWorkerQueueSnapshot = async (
  projectId?: string | null
): Promise<WorkerQueueSnapshot> => {
  if (!projectId || !workerJobRepository) {
    return emptyWorkerQueueSnapshot();
  }
  try {
    return await createWorkerQueueSnapshot({
      jobRepository: workerJobRepository,
      workerLogRepository,
      projectId,
      recentLogLimit: 10
    });
  } catch {
    return emptyWorkerQueueSnapshot();
  }
};
```

Add `workerQueue: await loadWorkerQueueSnapshot(requestedProject?.id)` in the empty state return and `workerQueue: await loadWorkerQueueSnapshot(activeProjectId)` in the task-ready return.

Update `getWebWorkbenchStore()`:

```ts
function defaultWorkerLogsFilePath(): string {
  return process.env.WORKER_LOGS_FILE ?? ".lp-agent/worker-logs.json";
}

const workerQueue = createLocalWorkerQueueRuntime({
  jobsFilePath: defaultWorkerJobsFilePath(),
  payloadsFilePath: defaultWorkerPayloadsFilePath(),
  logsFilePath: defaultWorkerLogsFilePath()
});
globalStore.__lpAgentWebWorkbenchStore = createWebWorkbenchStore({
  repositories: createJsonFileWorkbenchRepositories({
    filePath: defaultWorkbenchStateFilePath()
  }),
  workerQueueRuntime: workerQueue.runtime,
  workerRuntime: workerQueue.runtime,
  workerJobRepository: workerQueue.jobRepository,
  workerLogRepository: workerQueue.workerLogRepository,
  workerId: defaultWorkerId()
});
```

- [ ] **Step 4: Add i18n labels**

In `apps/web/src/lib/i18n.ts`, extend `skillsView` type:

```ts
workerQueueCounts: {
  queued: string;
  running: string;
  stale: string;
  completed: string;
  failed: string;
  rejected: string;
  cancelled: string;
};
workerHeartbeatLabel: string;
workerHeartbeatUnknown: string;
workerRecentLogsTitle: string;
workerNoLogs: string;
workerHeartbeatStatuses: Record<"active" | "idle" | "stale" | "unknown", string>;
```

Add English copy:

```ts
workerQueueCounts: {
  queued: "Queued",
  running: "Running",
  stale: "Stale",
  completed: "Completed",
  failed: "Failed",
  rejected: "Rejected",
  cancelled: "Cancelled"
},
workerHeartbeatLabel: "Heartbeat",
workerHeartbeatUnknown: "No worker heartbeat yet",
workerRecentLogsTitle: "Recent worker logs",
workerNoLogs: "No worker logs yet.",
workerHeartbeatStatuses: {
  active: "active",
  idle: "idle",
  stale: "stale",
  unknown: "unknown"
}
```

Add Chinese copy:

```ts
workerQueueCounts: {
  queued: "排队",
  running: "运行中",
  stale: "过期",
  completed: "已完成",
  failed: "失败",
  rejected: "已拒绝",
  cancelled: "已取消"
},
workerHeartbeatLabel: "心跳",
workerHeartbeatUnknown: "暂无 Worker 心跳",
workerRecentLogsTitle: "最近 Worker 日志",
workerNoLogs: "暂无 Worker 日志。",
workerHeartbeatStatuses: {
  active: "活跃",
  idle: "空闲",
  stale: "过期",
  unknown: "未知"
}
```

- [ ] **Step 5: Render snapshot in Skills local worker panel**

In `apps/web/src/app/page.tsx`, derive:

```ts
const workerQueue = pageState.workerQueue;
const workerQueueCountItems = [
  ["queued", workerQueue.counts.queued],
  ["running", workerQueue.counts.running],
  ["stale", workerQueue.counts.stale],
  ["completed", workerQueue.counts.completed],
  ["failed", workerQueue.counts.failed],
  ["rejected", workerQueue.counts.rejected],
  ["cancelled", workerQueue.counts.cancelled]
] as const;
```

Replace the local worker panel body with:

```tsx
<section className="localWorkerPanel" aria-labelledby="local-worker-title">
  <div className="localWorkerSummary">
    <h2 id="local-worker-title">{copy.skillsView.commandQueueLabel}</h2>
    <p>{copy.skillsView.localWorkerIdle}</p>
    <dl className="workerQueueCounts">
      {workerQueueCountItems.map(([key, value]) => (
        <div key={key}>
          <dt>{copy.skillsView.workerQueueCounts[key]}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
    <p className="workerHeartbeat">
      {copy.skillsView.workerHeartbeatLabel}:{" "}
      {copy.skillsView.workerHeartbeatStatuses[workerQueue.heartbeat.status]}
      {workerQueue.heartbeat.workerId ? ` - ${workerQueue.heartbeat.workerId}` : ""}
    </p>
    <div className="workerLogSummary">
      <strong>{copy.skillsView.workerRecentLogsTitle}</strong>
      {workerQueue.logs.length > 0 ? (
        <ul>
          {workerQueue.logs.map((log) => (
            <li key={log.id}>
              <span>{log.type}</span>
              <small>{log.workerJobId ?? log.workerId ?? log.createdAt}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p>{copy.skillsView.workerNoLogs}</p>
      )}
    </div>
  </div>
  <form action={runLocalWorkerOnceAction}>
    <input type="hidden" name="projectId" value={activeProject.id} />
    <button type="submit">{copy.skillsView.runLocalWorkerOnce}</button>
  </form>
</section>
```

Update `apps/web/src/app/globals.css` with compact styles:

```css
.localWorkerSummary {
  display: grid;
  gap: 12px;
}

.workerQueueCounts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
  gap: 8px;
  margin: 0;
}

.workerQueueCounts div {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-raised);
  padding: 8px;
}

.workerQueueCounts dt {
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 760;
}

.workerQueueCounts dd {
  margin: 4px 0 0;
  color: var(--text);
  font-size: 1rem;
  font-weight: 820;
}

.workerHeartbeat,
.workerLogSummary p {
  margin: 0;
}

.workerLogSummary {
  display: grid;
  gap: 8px;
}

.workerLogSummary strong {
  font-size: 0.78rem;
}

.workerLogSummary ul {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.workerLogSummary li {
  display: flex;
  min-width: 0;
  justify-content: space-between;
  gap: 10px;
  border-top: 1px solid var(--line);
  padding-top: 6px;
}

.workerLogSummary span,
.workerLogSummary small {
  min-width: 0;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 6: Run Web tests**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/lib/i18n.test.ts
pnpm --filter @lp-agent/web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/app/page.tsx apps/web/src/lib/i18n.ts apps/web/src/app/globals.css apps/web/src/app/page.test.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/lib/i18n.test.ts
git commit -m "show worker queue health in web"
```

## Task 6: Final Verification And Documentation

**Files:**
- Modify: `docs/superpowers/README.md`
- Modify: `docs/project-roadmap.md`
- Modify: `docs/agent-development-learning.md`

- [ ] **Step 1: Run focused package verification**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
pnpm --filter @lp-agent/agent-worker test
pnpm --filter @lp-agent/api test
pnpm exec vitest run apps/web/src/app/page.test.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/lib/i18n.test.ts
```

Expected: all selected tests PASS.

- [ ] **Step 2: Run workspace verification**

Run:

```bash
pnpm test
pnpm typecheck
```

Expected: both commands PASS.

If package exports or Next build behavior changed, also run:

```bash
pnpm build
```

Expected: build PASS.

- [ ] **Step 3: Update docs for completed implementation**

Update `docs/project-roadmap.md` Stage 19 status from planned to implemented and move worker daemon/heartbeat/stale claim recovery out of the “current still missing” list. Keep “streaming stdout/stderr summaries” as backlog because Stage 19 logs are lifecycle summaries only.

Update `docs/agent-development-learning.md` Stage 19 status to describe actual implemented behavior:

```md
当前实现状态：

- Stage 19 v0 已实现 worker daemon / polling loop、heartbeat metadata、stale safe claim recovery、bounded worker lifecycle logs 和 Web 只读 worker queue visibility。
- daemon 配置 workbench repository 时会复用幂等 finalizer 回写 terminal run/tool events；未配置时只更新 worker job 和 worker logs。
- Stage 19 的 logs 仍是 lifecycle summary，不是 raw stdout/stderr streaming。
```

Update `docs/superpowers/README.md` only if the implementation introduced new plan/spec links or changed reading order.

- [ ] **Step 4: Inspect git diff**

Run:

```bash
git diff --stat
git diff --check
git status --short
```

Expected: no whitespace errors; changed files match this plan.

- [ ] **Step 5: Commit documentation and final implementation state**

```bash
git add docs/superpowers/README.md docs/project-roadmap.md docs/agent-development-learning.md
git commit -m "document worker daemon heartbeat completion"
```

If the documentation updates are already included in the previous implementation commits, run `git status --short` and skip this commit when there is nothing to commit.
