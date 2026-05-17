# Worker Job Persistence Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable worker job record persistence to `@lp-agent/worker-runtime` without persisting raw execution payloads or enabling real execution.

**Architecture:** Introduce a `WorkerJobRepository` boundary in `packages/worker-runtime`, add in-memory and JSON-file implementations, and refactor `InMemoryWorkerRuntime` to persist safe `WorkerJobRecord` objects through that repository while keeping raw args/env in a process-local payload map. Existing API callers keep using the same `WorkerRuntime` interface; JSON persistence is opt-in through runtime construction.

**Tech Stack:** pnpm workspace, TypeScript, Vitest, Node `fs/promises`, Node `path`, Node `crypto`, existing `@lp-agent/worker-runtime` and `@lp-agent/api` contracts.

---

## Scope Guard

This plan implements only `docs/superpowers/specs/2026-05-17-worker-job-persistence-design.md`.

It must not add:

- real shell execution;
- `child_process`, `spawn`, `exec`, shell parsing, pipes, redirects, or arbitrary command strings;
- MCP execution;
- `apps/agent-worker` queue polling;
- Web UI for worker jobs;
- Postgres/Prisma worker job tables;
- cross-process atomic job claiming;
- durable raw args, env values, secrets, cookies, API keys, or artifact contents.

Persisted queued jobs from a previous process must be observable but not resumable. `runNext()` should fail them closed with `worker_job_payload_unavailable`.

## File Structure

- Modify: `packages/worker-runtime/package.json`
  - Include new repository test file in the package test script.
- Modify: `packages/worker-runtime/src/index.ts`
  - Export `WorkerJobRepository`, add repository-backed runtime internals, preserve current public `WorkerRuntime` API, re-export repository implementations.
- Create: `packages/worker-runtime/src/worker-job-repositories.ts`
  - Implement `InMemoryWorkerJobRepository`, `JsonFileWorkerJobRepository`, and `createJsonFileWorkerJobRepository`.
- Create: `packages/worker-runtime/src/worker-job-repositories.test.ts`
  - Contract tests for in-memory and JSON-file repositories.
- Modify: `packages/worker-runtime/src/index.test.ts`
  - Update runtime tests for repository-backed behavior, id allocation, parallel enqueue uniqueness, restart-safe missing payload failure, and existing safety behavior.
- Modify: `packages/api/src/worker-backed-tool-command-runner.test.ts`
  - Add one API compatibility test using a repository-backed runtime.
- Modify: `docs/agent-development-learning.md`
  - Add Stage 9 implementation plan link and note the implemented persistence boundary.
- Modify: `docs/superpowers/README.md`
  - Add this plan to reading order immediately after the Stage 9 design spec.

## Task 1: Add Worker Job Repository Contract And In-Memory Repository

**Files:**

- Modify: `packages/worker-runtime/package.json`
- Modify: `packages/worker-runtime/src/index.ts`
- Create: `packages/worker-runtime/src/worker-job-repositories.ts`
- Create: `packages/worker-runtime/src/worker-job-repositories.test.ts`

- [ ] **Step 1: Update the worker-runtime test script**

Modify `packages/worker-runtime/package.json` so the test script runs both test files:

```json
{
  "name": "@lp-agent/worker-runtime",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run src/index.test.ts src/worker-job-repositories.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Add the repository contract exports**

In `packages/worker-runtime/src/index.ts`, add this interface after `WorkerRuntime`:

```ts
export interface WorkerJobRepository {
  save(record: WorkerJobRecord): Promise<void>;
  getById(id: string): Promise<WorkerJobRecord | undefined>;
  listForProject(projectId: string): Promise<WorkerJobRecord[]>;
  listAll(): Promise<WorkerJobRecord[]>;
  findOldestQueued(): Promise<WorkerJobRecord | undefined>;
}
```

At the top of `packages/worker-runtime/src/index.ts`, import the default in-memory repository:

```ts
import { InMemoryWorkerJobRepository } from "./worker-job-repositories";
```

At the bottom of `packages/worker-runtime/src/index.ts`, export repository implementations:

```ts
export {
  InMemoryWorkerJobRepository,
  JsonFileWorkerJobRepository,
  createJsonFileWorkerJobRepository,
  type JsonFileWorkerJobRepositoryOptions
} from "./worker-job-repositories";
```

This will not fully compile until `worker-job-repositories.ts` exists in Step 4.

- [ ] **Step 3: Write failing repository tests**

Create `packages/worker-runtime/src/worker-job-repositories.test.ts`:

```ts
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  InMemoryWorkerJobRepository,
  createJsonFileWorkerJobRepository,
  createSimulatedSandboxPolicy,
  type WorkerJobRecord
} from "./index";

describe("worker job repositories", () => {
  it("in-memory repository saves, updates, lists, and returns defensive copies", async () => {
    const repository = new InMemoryWorkerJobRepository();
    await repository.save(workerJob({ id: "worker_job_2", createdAt: "2026-05-17T00:00:02.000Z" }));
    await repository.save(workerJob({ id: "worker_job_1", createdAt: "2026-05-17T00:00:01.000Z" }));
    await repository.save(workerJob({ id: "worker_job_3", projectId: "project_b" }));

    const first = await repository.getById("worker_job_1");
    first!.state = "failed";
    first!.policy.allowedCommands.push("mutated");
    await repository.save({
      ...workerJob({ id: "worker_job_2" }),
      state: "completed",
      completedAt: "2026-05-17T00:01:00.000Z"
    });

    const projectJobs = await repository.listForProject("project_a");
    const allJobs = await repository.listAll();
    const queued = await repository.findOldestQueued();

    expect((await repository.getById("worker_job_1"))).toMatchObject({
      state: "queued",
      policy: {
        allowedCommands: ["build"]
      }
    });
    expect(projectJobs.map((job) => job.id)).toEqual(["worker_job_1", "worker_job_2"]);
    expect(allJobs.map((job) => job.id)).toEqual(["worker_job_1", "worker_job_2", "worker_job_3"]);
    expect(queued?.id).toBe("worker_job_1");
  });

  it("json-file repository persists records across instances and sorts deterministically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worker-jobs-"));
    const filePath = join(directory, "worker-jobs.json");

    try {
      const first = createJsonFileWorkerJobRepository({ filePath });
      await first.save(workerJob({ id: "worker_job_2", createdAt: "2026-05-17T00:00:02.000Z" }));
      await first.save(workerJob({ id: "worker_job_1", createdAt: "2026-05-17T00:00:01.000Z" }));
      await first.save(workerJob({ id: "worker_job_3", projectId: "project_b" }));

      const second = createJsonFileWorkerJobRepository({ filePath });
      const projectJobs = await second.listForProject("project_a");
      const allJobs = await second.listAll();
      const queued = await second.findOldestQueued();

      expect(projectJobs.map((job) => job.id)).toEqual(["worker_job_1", "worker_job_2"]);
      expect(allJobs.map((job) => job.id)).toEqual(["worker_job_1", "worker_job_2", "worker_job_3"]);
      expect(queued?.id).toBe("worker_job_1");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("json-file repository treats missing files and old shapes as empty state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worker-jobs-"));
    const filePath = join(directory, "worker-jobs.json");

    try {
      const repository = createJsonFileWorkerJobRepository({ filePath });
      expect(await repository.listAll()).toEqual([]);
      expect(await repository.findOldestQueued()).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("json-file repository upserts records and does not persist env secret values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worker-jobs-"));
    const filePath = join(directory, "worker-jobs.json");

    try {
      const repository = createJsonFileWorkerJobRepository({ filePath });
      await repository.save(workerJob({
        inputSummary: {
          ...workerJob().inputSummary,
          envNames: ["STATIC_DEPLOY_TOKEN"]
        }
      }));
      await repository.save({
        ...workerJob(),
        state: "completed",
        resultSummary: {
          state: "completed",
          exitCode: 0,
          stdout: "published [redacted]",
          stderr: "",
          stdoutBytes: 22,
          stderrBytes: 0
        },
        completedAt: "2026-05-17T00:02:00.000Z"
      });

      const raw = await readFile(filePath, "utf8");
      const saved = await repository.getById("worker_job_1");

      expect(saved).toMatchObject({
        state: "completed",
        resultSummary: {
          stdout: "published [redacted]"
        }
      });
      expect(raw).toContain("STATIC_DEPLOY_TOKEN");
      expect(raw).not.toContain("secret-token");
      expect((await repository.listAll())).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function workerJob(overrides: Partial<WorkerJobRecord> = {}): WorkerJobRecord {
  return {
    id: "worker_job_1",
    projectId: "project_a",
    kind: "tool_command",
    state: "queued",
    policy: createSimulatedSandboxPolicy({
      allowedCommands: ["build"],
      allowedEnvNames: ["LP_PROJECT_ID"]
    }),
    inputSummary: {
      projectId: "project_a",
      kind: "tool_command",
      commandId: "publish_static",
      command: "build",
      argCount: 1,
      envNames: ["LP_PROJECT_ID"],
      timeoutMs: 1000
    },
    createdAt: "2026-05-17T00:00:00.000Z",
    ...overrides
  };
}
```

- [ ] **Step 4: Run repository tests to verify they fail**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
```

Expected:

```text
FAIL  src/worker-job-repositories.test.ts
Cannot find module './worker-job-repositories'
```

- [ ] **Step 5: Implement in-memory and JSON-file repositories**

Create `packages/worker-runtime/src/worker-job-repositories.ts`:

```ts
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { WorkerJobRecord, WorkerJobRepository } from "./index";

export interface JsonFileWorkerJobRepositoryOptions {
  filePath: string;
}

interface JsonFileWorkerJobState {
  workerJobs: WorkerJobRecord[];
}

const writeQueuesByFilePath = new Map<string, Promise<void>>();

export class InMemoryWorkerJobRepository implements WorkerJobRepository {
  private records: WorkerJobRecord[] = [];

  async save(record: WorkerJobRecord): Promise<void> {
    this.records = upsertBy(this.records, copyRecord(record), (candidate) => candidate.id === record.id);
  }

  async getById(id: string): Promise<WorkerJobRecord | undefined> {
    return copyOptional(this.records.find((record) => record.id === id));
  }

  async listForProject(projectId: string): Promise<WorkerJobRecord[]> {
    return sortWorkerJobs(this.records.filter((record) => record.projectId === projectId)).map(copyRecord);
  }

  async listAll(): Promise<WorkerJobRecord[]> {
    return sortWorkerJobs(this.records).map(copyRecord);
  }

  async findOldestQueued(): Promise<WorkerJobRecord | undefined> {
    return copyOptional(sortWorkerJobs(this.records).find((record) => record.state === "queued"));
  }
}

export class JsonFileWorkerJobRepository implements WorkerJobRepository {
  private readonly filePath: string;

  constructor(options: JsonFileWorkerJobRepositoryOptions) {
    this.filePath = resolve(options.filePath);
  }

  async save(record: WorkerJobRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.workerJobs = upsertBy(state.workerJobs, copyRecord(record), (candidate) => candidate.id === record.id);
    });
  }

  async getById(id: string): Promise<WorkerJobRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.workerJobs.find((record) => record.id === id));
  }

  async listForProject(projectId: string): Promise<WorkerJobRecord[]> {
    const state = await readState(this.filePath);
    return sortWorkerJobs(state.workerJobs.filter((record) => record.projectId === projectId)).map(copyRecord);
  }

  async listAll(): Promise<WorkerJobRecord[]> {
    const state = await readState(this.filePath);
    return sortWorkerJobs(state.workerJobs).map(copyRecord);
  }

  async findOldestQueued(): Promise<WorkerJobRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(sortWorkerJobs(state.workerJobs).find((record) => record.state === "queued"));
  }
}

export function createJsonFileWorkerJobRepository(
  options: JsonFileWorkerJobRepositoryOptions
): WorkerJobRepository {
  return new JsonFileWorkerJobRepository(options);
}

async function updateState(
  filePath: string,
  update: (state: JsonFileWorkerJobState) => void
): Promise<void> {
  await enqueueWrite(filePath, async () => {
    const state = await readState(filePath);
    update(state);
    await writeState(filePath, state);
  });
}

async function enqueueWrite(filePath: string, write: () => Promise<void>): Promise<void> {
  const previousWrite = writeQueuesByFilePath.get(filePath) ?? Promise.resolve();
  const nextWrite = previousWrite.catch(() => undefined).then(write);
  writeQueuesByFilePath.set(filePath, nextWrite);

  try {
    await nextWrite;
  } finally {
    if (writeQueuesByFilePath.get(filePath) === nextWrite) {
      writeQueuesByFilePath.delete(filePath);
    }
  }
}

async function readState(filePath: string): Promise<JsonFileWorkerJobState> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<JsonFileWorkerJobState>;
    return {
      workerJobs: Array.isArray(parsed.workerJobs) ? parsed.workerJobs.map(copyRecord) : []
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return emptyState();
    }
    throw error;
  }
}

async function writeState(filePath: string, state: JsonFileWorkerJobState): Promise<void> {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });
  const tempPath = join(directory, `.${process.pid}.${randomUUID()}.worker-jobs.tmp`);
  await writeFile(tempPath, `${JSON.stringify({ workerJobs: sortWorkerJobs(state.workerJobs) }, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function emptyState(): JsonFileWorkerJobState {
  return {
    workerJobs: []
  };
}

function sortWorkerJobs(records: WorkerJobRecord[]): WorkerJobRecord[] {
  return [...records].sort((left, right) => {
    const byCreatedAt = left.createdAt.localeCompare(right.createdAt);
    if (byCreatedAt !== 0) {
      return byCreatedAt;
    }
    return left.id.localeCompare(right.id);
  });
}

function upsertBy<T>(records: T[], record: T, matches: (candidate: T) => boolean): T[] {
  const next = [...records];
  const index = next.findIndex(matches);
  if (index === -1) {
    next.push(record);
    return next;
  }
  next[index] = record;
  return next;
}

function copyOptional(record: WorkerJobRecord | undefined): WorkerJobRecord | undefined {
  return record ? copyRecord(record) : undefined;
}

function copyRecord(record: WorkerJobRecord): WorkerJobRecord {
  return JSON.parse(JSON.stringify(record)) as WorkerJobRecord;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
  );
}
```

- [ ] **Step 6: Run repository tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
pnpm --filter @lp-agent/worker-runtime typecheck
```

Expected:

```text
Test Files  2 passed
```

and no TypeScript errors.

- [ ] **Step 7: Commit repository contract and implementations**

Run:

```bash
git add packages/worker-runtime/package.json packages/worker-runtime/src/index.ts packages/worker-runtime/src/worker-job-repositories.ts packages/worker-runtime/src/worker-job-repositories.test.ts
git commit -m "add worker job repositories"
```

## Task 2: Refactor Runtime To Persist Records Through Repository

**Files:**

- Modify: `packages/worker-runtime/src/index.ts`
- Modify: `packages/worker-runtime/src/index.test.ts`

- [ ] **Step 1: Write runtime repository tests**

In `packages/worker-runtime/src/index.test.ts`, update imports to include repository helpers:

```ts
import {
  InMemoryWorkerJobRepository,
  InMemoryWorkerRuntime,
  RejectingExecutionAdapter,
  SimulatedExecutionAdapter,
  createRejectSandboxPolicy,
  createSimulatedSandboxPolicy,
  type ExecutionAdapter,
  type ExecutionInput,
  type SandboxPolicy,
  type WorkerJobInput,
  type WorkerJobRecord
} from "./index";
```

Add these tests inside `describe("InMemoryWorkerRuntime", () => { ... })`:

```ts
  it("persists worker records through an injected repository", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const runtime = new InMemoryWorkerRuntime({
      repository,
      adapter: new SimulatedExecutionAdapter()
    });

    const queued = await runtime.enqueue(baseInput(), simulatedPolicy());
    const completed = await runtime.runNext();
    const saved = await repository.getById(queued.id);

    expect(completed?.state).toBe("completed");
    expect(saved).toMatchObject({
      id: "worker_job_1",
      state: "completed",
      resultSummary: {
        stdout: "Simulated build for project project_a."
      }
    });
  });

  it("allocates the next id after existing repository records", async () => {
    const repository = new InMemoryWorkerJobRepository();
    await repository.save(workerJobRecord({ id: "worker_job_3" }));
    await repository.save(workerJobRecord({ id: "other_prefix_9" }));
    const runtime = new InMemoryWorkerRuntime({ repository });

    const queued = await runtime.enqueue(baseInput());

    expect(queued.id).toBe("worker_job_4");
  });

  it("allocates unique ids for parallel enqueues in one runtime instance", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const runtime = new InMemoryWorkerRuntime({ repository });

    const records = await Promise.all([
      runtime.enqueue(baseInput({ commandId: "first" })),
      runtime.enqueue(baseInput({ commandId: "second" })),
      runtime.enqueue(baseInput({ commandId: "third" }))
    ]);

    expect(records.map((record) => record.id).sort()).toEqual([
      "worker_job_1",
      "worker_job_2",
      "worker_job_3"
    ]);
    expect((await repository.listAll()).map((record) => record.id)).toEqual([
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
    const newer = await runtime.enqueue(baseInput({ commandId: "newer" }), simulatedPolicy());
    const older = await runtime.enqueue(baseInput({ commandId: "older" }), simulatedPolicy());
    await repository.save({
      ...older,
      createdAt: "2026-05-17T00:00:00.000Z"
    });
    await repository.save({
      ...newer,
      createdAt: "2026-05-17T00:00:01.000Z"
    });

    const completed = await runtime.runNext();

    expect(completed?.id).toBe(older.id);
    expect((await repository.getById(older.id))?.state).toBe("completed");
    expect((await repository.getById(newer.id))?.state).toBe("queued");
  });

  it("fails persisted queued jobs when process-local payload is unavailable", async () => {
    const repository = new InMemoryWorkerJobRepository();
    await repository.save(workerJobRecord({
      id: "worker_job_9",
      state: "queued",
      createdAt: "2026-05-17T00:00:00.000Z"
    }));
    const adapter: ExecutionAdapter = {
      execute: vi.fn(async () => ({
        state: "completed" as const,
        exitCode: 0,
        stdout: "should not run",
        stderr: ""
      }))
    };
    const restartedRuntime = new InMemoryWorkerRuntime({
      repository,
      adapter,
      now: () => new Date("2026-05-17T00:01:00.000Z")
    });

    const failed = await restartedRuntime.runNext();

    expect(failed).toMatchObject({
      id: "worker_job_9",
      state: "failed",
      errorName: "worker_job_payload_unavailable",
      completedAt: "2026-05-17T00:01:00.000Z",
      resultSummary: {
        state: "failed",
        stdout: "",
        stderr: "Worker job execution payload is unavailable after restart.",
        errorName: "worker_job_payload_unavailable"
      }
    });
    expect(adapter.execute).not.toHaveBeenCalled();
  });
```

Add this helper near the existing `baseInput` helper:

```ts
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
```

- [ ] **Step 2: Run tests to verify runtime refactor is still needed**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
```

Expected:

```text
FAIL  src/index.test.ts
```

with failures around `repository` not existing in `InMemoryWorkerRuntimeOptions` or repository state not updating.

- [ ] **Step 3: Refactor runtime internals**

In `packages/worker-runtime/src/index.ts`, change `StoredJob` into a process-local payload shape:

```ts
interface WorkerJobExecutionPayload {
  args: string[];
  env: Record<string, string>;
}
```

Update `InMemoryWorkerRuntimeOptions`:

```ts
export interface InMemoryWorkerRuntimeOptions {
  adapter?: ExecutionAdapter;
  now?: () => Date;
  idPrefix?: string;
  repository?: WorkerJobRepository;
}
```

Replace the `InMemoryWorkerRuntime` fields and constructor with:

```ts
export class InMemoryWorkerRuntime implements WorkerRuntime {
  private readonly adapter: ExecutionAdapter;
  private readonly now: () => Date;
  private readonly idPrefix: string;
  private readonly repository: WorkerJobRepository;
  private readonly payloadsByJobId = new Map<string, WorkerJobExecutionPayload>();
  private nextJobNumber = 1;
  private nextJobNumberInitialized = false;
  private enqueueLock: Promise<void> = Promise.resolve();

  constructor(options: InMemoryWorkerRuntimeOptions = {}) {
    this.adapter = options.adapter ?? new RejectingExecutionAdapter();
    this.now = options.now ?? (() => new Date());
    this.idPrefix = options.idPrefix ?? "worker_job";
    this.repository = options.repository ?? new InMemoryWorkerJobRepository();
  }
```

Replace `enqueue()` with:

```ts
  async enqueue(
    input: WorkerJobInput,
    policy: SandboxPolicy = createRejectSandboxPolicy()
  ): Promise<WorkerJobRecord> {
    return this.withEnqueueLock(async () => {
      const copiedPolicy = copyPolicy(policy);
      const id = await this.allocateJobId();
      const record: WorkerJobRecord = {
        id,
        projectId: input.projectId,
        kind: input.kind,
        state: "queued",
        policy: copyPolicy(copiedPolicy),
        inputSummary: summarizeInput(input),
        createdAt: this.nowIso()
      };
      this.payloadsByJobId.set(id, {
        args: [...input.args],
        env: { ...input.env }
      });
      await this.repository.save(record);
      return copyRecord(record);
    });
  }
```

Replace `runNext()`, `getJob()`, `listJobsForProject()`, and `completeJob()` with:

```ts
  async runNext(): Promise<WorkerJobRecord | undefined> {
    const record = await this.repository.findOldestQueued();
    if (!record) {
      return undefined;
    }

    const runningRecord: WorkerJobRecord = {
      ...record,
      state: "running",
      startedAt: this.nowIso()
    };
    await this.repository.save(runningRecord);

    const validation = validateSandboxPolicy(runningRecord.inputSummary, runningRecord.policy);
    if (!validation.valid) {
      return this.completeJob(runningRecord, {
        state: "rejected",
        stdout: "",
        stderr: validation.reason,
        errorName: validation.errorName
      });
    }

    const payload = this.payloadsByJobId.get(runningRecord.id);
    if (!payload) {
      return this.completeJob(runningRecord, {
        state: "failed",
        stdout: "",
        stderr: "Worker job execution payload is unavailable after restart.",
        errorName: "worker_job_payload_unavailable"
      });
    }

    try {
      const result = await this.adapter.execute(
        toExecutionInput(runningRecord, payload),
        copyPolicy(runningRecord.policy)
      );
      return this.completeJob(runningRecord, result, getSensitiveValues(payload.env));
    } catch (error) {
      return this.completeJob(
        runningRecord,
        {
          state: "failed",
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
          errorName: error instanceof Error && error.name ? error.name : "execution_adapter_failed"
        },
        getSensitiveValues(payload.env)
      );
    } finally {
      this.payloadsByJobId.delete(runningRecord.id);
    }
  }

  async getJob(id: string): Promise<WorkerJobRecord | undefined> {
    return this.repository.getById(id);
  }

  async listJobsForProject(projectId: string): Promise<WorkerJobRecord[]> {
    return this.repository.listForProject(projectId);
  }

  private async completeJob(
    record: WorkerJobRecord,
    result: ExecutionResult,
    sensitiveValues: string[] = []
  ): Promise<WorkerJobRecord> {
    const completedRecord: WorkerJobRecord = {
      ...record,
      state: result.state,
      resultSummary: summarizeResult(result, record.policy, sensitiveValues),
      errorName: result.errorName,
      completedAt: this.nowIso()
    };
    await this.repository.save(completedRecord);
    return copyRecord(completedRecord);
  }
```

Add the runtime helper methods:

```ts
  private async allocateJobId(): Promise<string> {
    if (!this.nextJobNumberInitialized) {
      const existing = await this.repository.listAll();
      const prefixPattern = new RegExp(`^${escapeRegExp(this.idPrefix)}_(\\d+)$`);
      const maxExisting = existing.reduce((max, record) => {
        const match = prefixPattern.exec(record.id);
        if (!match) {
          return max;
        }
        const parsed = Number.parseInt(match[1]!, 10);
        return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
      }, 0);
      this.nextJobNumber = Math.max(this.nextJobNumber, maxExisting + 1);
      this.nextJobNumberInitialized = true;
    }

    const id = `${this.idPrefix}_${this.nextJobNumber}`;
    this.nextJobNumber += 1;
    return id;
  }

  private async withEnqueueLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.enqueueLock.catch(() => undefined);
    let release!: () => void;
    this.enqueueLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
```

Replace `toExecutionInput()` with:

```ts
function toExecutionInput(
  record: WorkerJobRecord,
  payload: WorkerJobExecutionPayload
): ExecutionInput {
  return {
    jobId: record.id,
    projectId: record.projectId,
    kind: record.kind,
    commandId: record.inputSummary.commandId,
    command: record.inputSummary.command,
    args: [...payload.args],
    env: { ...payload.env },
    envNames: [...record.inputSummary.envNames],
    workingDirectory: record.inputSummary.workingDirectory,
    timeoutMs: record.inputSummary.timeoutMs
  };
}
```

Add `escapeRegExp()` near other helpers:

```ts
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

Remove the old `StoredJob` interface and private `jobs` array.

- [ ] **Step 4: Run runtime tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
pnpm --filter @lp-agent/worker-runtime typecheck
```

Expected:

```text
Test Files  2 passed
```

and no TypeScript errors.

- [ ] **Step 5: Commit repository-backed runtime**

Run:

```bash
git add packages/worker-runtime/src/index.ts packages/worker-runtime/src/index.test.ts
git commit -m "persist worker runtime records through repository"
```

## Task 3: Add JSON-Backed Runtime Coverage

**Files:**

- Modify: `packages/worker-runtime/src/index.test.ts`
- Modify: `packages/worker-runtime/src/worker-job-repositories.test.ts`

- [ ] **Step 1: Add JSON-backed runtime tests**

In `packages/worker-runtime/src/index.test.ts`, add imports:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
```

Also import `createJsonFileWorkerJobRepository` from `./index`:

```ts
import {
  InMemoryWorkerJobRepository,
  InMemoryWorkerRuntime,
  RejectingExecutionAdapter,
  SimulatedExecutionAdapter,
  createJsonFileWorkerJobRepository,
  createRejectSandboxPolicy,
  createSimulatedSandboxPolicy,
  type ExecutionAdapter,
  type ExecutionInput,
  type SandboxPolicy,
  type WorkerJobInput,
  type WorkerJobRecord
} from "./index";
```

Add these tests:

```ts
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
      const completed = await runtime.runNext();
      const reopenedRepository = createJsonFileWorkerJobRepository({ filePath });

      expect(completed?.state).toBe("completed");
      await expect(reopenedRepository.getById(queued.id)).resolves.toMatchObject({
        id: queued.id,
        state: "completed",
        resultSummary: {
          stdout: "Simulated build for project project_a."
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
      const firstRuntime = new InMemoryWorkerRuntime({ repository: firstRepository });
      const queued = await firstRuntime.enqueue(baseInput(), simulatedPolicy());
      const adapter: ExecutionAdapter = {
        execute: vi.fn(async () => ({
          state: "completed" as const,
          exitCode: 0,
          stdout: "should not run",
          stderr: ""
        }))
      };
      const restartedRuntime = new InMemoryWorkerRuntime({
        repository: createJsonFileWorkerJobRepository({ filePath }),
        adapter,
        now: () => new Date("2026-05-17T00:01:00.000Z")
      });

      const failed = await restartedRuntime.runNext();

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
```

- [ ] **Step 2: Add JSON repository concurrent write coverage**

In `packages/worker-runtime/src/worker-job-repositories.test.ts`, add:

```ts
  it("json-file repository serializes concurrent saves for one file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worker-jobs-"));
    const filePath = join(directory, "worker-jobs.json");

    try {
      const repository = createJsonFileWorkerJobRepository({ filePath });
      await Promise.all([
        repository.save(workerJob({ id: "worker_job_1", createdAt: "2026-05-17T00:00:01.000Z" })),
        repository.save(workerJob({ id: "worker_job_2", createdAt: "2026-05-17T00:00:02.000Z" })),
        repository.save(workerJob({ id: "worker_job_3", createdAt: "2026-05-17T00:00:03.000Z" }))
      ]);

      expect((await repository.listAll()).map((record) => record.id)).toEqual([
        "worker_job_1",
        "worker_job_2",
        "worker_job_3"
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 3: Run worker-runtime tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
pnpm --filter @lp-agent/worker-runtime typecheck
```

Expected:

```text
Test Files  2 passed
```

and no TypeScript errors.

- [ ] **Step 4: Commit JSON-backed runtime coverage**

Run:

```bash
git add packages/worker-runtime/src/index.test.ts packages/worker-runtime/src/worker-job-repositories.test.ts
git commit -m "cover json backed worker runtime persistence"
```

## Task 4: Add API Compatibility Coverage

**Files:**

- Modify: `packages/api/src/worker-backed-tool-command-runner.test.ts`

- [ ] **Step 1: Add repository-backed API adapter test**

In `packages/api/src/worker-backed-tool-command-runner.test.ts`, import `InMemoryWorkerJobRepository`:

```ts
import {
  type ExecutionAdapter,
  InMemoryWorkerJobRepository,
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter,
  createSimulatedSandboxPolicy
} from "@lp-agent/worker-runtime";
```

Add this test inside `describe("WorkerBackedToolCommandRunner", () => { ... })`:

```ts
  it("runs against a repository-backed worker runtime", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const runtime = new InMemoryWorkerRuntime({
      repository,
      adapter: new SimulatedExecutionAdapter()
    });
    const runner = new WorkerBackedToolCommandRunner(runtime, (input) =>
      createSandboxPolicyForToolCommand(input, {
        mode: "simulate",
        allowedCommands: [input.command],
        allowedEnvNames: Object.keys(input.env)
      })
    );

    const result = await runner.run(baseInput());
    const savedJobs = await repository.listForProject("project_1");

    expect(result).toEqual({
      state: "completed",
      exitCode: 0,
      stdout: "Simulated static-deploy for project [redacted].",
      stderr: ""
    });
    expect(savedJobs).toHaveLength(1);
    expect(savedJobs[0]).toMatchObject({
      state: "completed",
      inputSummary: {
        command: "static-deploy",
        envNames: ["LP_PROJECT_ID", "STATIC_DEPLOY_TOKEN"]
      }
    });
    expect(JSON.stringify(savedJobs)).not.toContain("secret-token");
  });
```

- [ ] **Step 2: Run API tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/api test
pnpm --filter @lp-agent/api typecheck
```

Expected:

```text
Test Files  8 passed
```

and no TypeScript errors.

- [ ] **Step 3: Commit API compatibility coverage**

Run:

```bash
git add packages/api/src/worker-backed-tool-command-runner.test.ts
git commit -m "cover repository backed worker command runner"
```

## Task 5: Documentation And Full Verification

**Files:**

- Modify: `docs/agent-development-learning.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Update Stage 9 learning docs**

In `docs/agent-development-learning.md`, under `### 阶段 9：Worker Job Persistence Foundation`, add a current plan section after the design link:

```md
当前计划：

- [2026-05-17-worker-job-persistence.md](./superpowers/plans/2026-05-17-worker-job-persistence.md)
```

After implementation is complete, add this current implementation status:

```md
当前实现状态：

- Stage 9 v0 已实现 `WorkerJobRepository`、`InMemoryWorkerJobRepository` 和 `JsonFileWorkerJobRepository`。
- `InMemoryWorkerRuntime` 已改为通过 repository 持久化安全 job record，raw args/env 仍只保留在进程内 payload map。
- JSON-file worker job persistence 只保存 bounded/redacted record，不保存执行 payload；重启后 queued job 会以 `worker_job_payload_unavailable` fail-closed。
```

- [ ] **Step 2: Update Superpowers reading order**

In `docs/superpowers/README.md`, add this entry immediately after the Stage 9 design spec:

```md
47. `plans/2026-05-17-worker-job-persistence.md`
   - Stage 9 worker job persistence foundation implementation plan.
   - Read this after the worker job persistence design when implementing or auditing worker job repositories, repository-backed runtime internals, JSON-file persistence, restart-safe missing-payload behavior, and API compatibility.
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
@lp-agent/worker-runtime test: 2 test files passed
@lp-agent/api test: 8 test files passed
```

and no TypeScript errors.

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

- [ ] **Step 5: Check git status before committing**

Run:

```bash
git status --short
```

Expected: only intentional Stage 9 files are modified or staged. Leave the existing root image files untracked if they are still present:

```text
?? 微信图片_20260512094225_26_894.png
?? 微信图片_20260512171758_27_894.png
```

- [ ] **Step 6: Commit docs and final verification updates**

Run:

```bash
git add docs/agent-development-learning.md docs/superpowers/README.md
git commit -m "document worker job persistence implementation"
```

If no docs changed because they were already updated during plan writing, skip this commit and note that in the final handoff.

## Final Handoff

After all tasks pass, report:

- commits created;
- verification commands and results;
- whether worker job records persist through JSON-file repository;
- whether raw execution payload remains process-local;
- whether restart behavior fails queued jobs with `worker_job_payload_unavailable`;
- whether default API/Web behavior remains unchanged.

## Self-Review

- Spec coverage: this plan implements `WorkerJobRepository`, in-memory repository, JSON-file repository, repository-backed runtime internals, id allocation from persisted records, same-process enqueue serialization, missing payload fail-closed behavior, API compatibility, docs, and verification.
- Scope check: the plan explicitly excludes real shell execution, MCP execution, Web UI, agent-worker queue polling, database persistence, cross-process claims, and durable raw payload storage.
- Type consistency: `WorkerJobRepository`, `InMemoryWorkerJobRepository`, `JsonFileWorkerJobRepository`, `JsonFileWorkerJobRepositoryOptions`, `createJsonFileWorkerJobRepository`, `WorkerJobExecutionPayload`, and `worker_job_payload_unavailable` are used consistently across tasks.
- Safety check: JSON-file persistence stores only `WorkerJobRecord`; raw args/env remain process-local and queued jobs from previous processes fail closed.
