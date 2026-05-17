# Worker Queue Handoff v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe worker queue handoff path where a queued worker job can be persisted by one process-like runtime and claimed/executed by `apps/agent-worker` through shared repositories.

**Architecture:** Keep the existing API-process `runNext()` path intact, and add an opt-in safe queue path to `@lp-agent/worker-runtime`. Persist only bounded deterministic payloads without raw env values or secrets, add claim metadata plus claim-token completion, then wire `apps/agent-worker` to run one claimed safe job.

**Tech Stack:** pnpm workspace, TypeScript, Vitest, `@lp-agent/worker-runtime`, JSON-file repositories, `apps/agent-worker`, existing deterministic `ExecutionAdapter` boundary.

---

## Scope Guard

This plan implements only `docs/superpowers/specs/2026-05-17-worker-queue-handoff-design.md`.

It must not add:

- real shell execution;
- `child_process`, `spawn`, `exec`, shell parsing, shell signals, process killing, pipes, redirects, or arbitrary command strings;
- MCP execution;
- Web interrupt button wiring;
- product-level run cancellation events;
- streaming stdout/stderr;
- retry/resume, worker heartbeat, stale lease recovery, or daemon polling loops;
- secret manager integration;
- deployment skill execution through the external worker;
- persisted raw env values, secret values, cookies, API keys, or artifact content.

The Stage 11 payload is only for safe deterministic `simulate` / `reject` worker jobs. If a job needs raw env values or secrets, it remains on the existing in-process path.

## File Structure

- Modify: `packages/worker-runtime/src/index.ts`
  - Add safe payload types, queue claim types, claim metadata on worker records, queue methods on `InMemoryWorkerRuntime`, and claimed-job execution/finalization.
- Create: `packages/worker-runtime/src/worker-job-payload-repositories.ts`
  - Add in-memory and JSON-file repositories for safe worker payload records.
- Modify: `packages/worker-runtime/src/worker-job-repositories.ts`
  - Persist/copy `claimedByWorkerId` and `claimToken`.
- Modify: `packages/worker-runtime/src/index.test.ts`
  - Add safe queue, claim, claimed execution, claim conflict, missing payload, cancellation, and JSON cross-instance tests.
- Create: `packages/worker-runtime/src/worker-job-payload-repositories.test.ts`
  - Add payload repository defensive copy, JSON persistence, delete, and validation tests.
- Modify: `packages/worker-runtime/package.json`
  - Include the new payload repository test in the package test script.
- Modify: `apps/agent-worker/package.json`
  - Add `@lp-agent/worker-runtime` dependency.
- Modify: `apps/agent-worker/src/worker.ts`
  - Add `runWorkerOnce()` while keeping `runDemoWorkerJob()` available.
- Modify: `apps/agent-worker/src/index.ts`
  - Add minimal JSON-file worker queue CLI entry point.
- Modify: `apps/agent-worker/src/worker.test.ts`
  - Add worker queue handoff tests.
- Modify: `docs/agent-development-learning.md`
  - Add Stage 11 implementation status after the code is complete.
- Modify: `docs/superpowers/README.md`
  - Ensure this plan appears immediately after the Stage 11 design spec.

## Task 1: Add Safe Worker Payload Repositories

**Files:**

- Modify: `packages/worker-runtime/src/index.ts`
- Create: `packages/worker-runtime/src/worker-job-payload-repositories.ts`
- Create: `packages/worker-runtime/src/worker-job-payload-repositories.test.ts`
- Modify: `packages/worker-runtime/package.json`

- [ ] **Step 1: Add failing payload repository tests**

Create `packages/worker-runtime/src/worker-job-payload-repositories.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  InMemoryWorkerJobPayloadRepository,
  createJsonFileWorkerJobPayloadRepository,
  type WorkerJobPayloadRecord
} from "./index";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

function payloadRecord(
  overrides: Partial<WorkerJobPayloadRecord> = {}
): WorkerJobPayloadRecord {
  return {
    jobId: "worker_job_1",
    kind: "safe_simulated_tool_command",
    projectId: "project_a",
    commandId: "publish_static",
    command: "static-deploy",
    args: ["--target", "preview"],
    envNames: ["LP_PROJECT_ID"],
    timeoutMs: 1000,
    createdAt: "2026-05-18T00:00:00.000Z",
    ...overrides
  };
}

async function createTempFilePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "worker-job-payloads-"));
  tempDirs.push(dir);
  return join(dir, "worker-job-payloads.json");
}

describe("InMemoryWorkerJobPayloadRepository", () => {
  it("returns defensive copies from save and get operations", async () => {
    const repository = new InMemoryWorkerJobPayloadRepository();
    const payload = payloadRecord();

    await repository.save(payload);
    payload.args.push("mutated-after-save");
    payload.envNames.push("MUTATED_AFTER_SAVE");

    const saved = await repository.getByJobId(payload.jobId);
    saved?.args.push("mutated-from-get");
    saved?.envNames.push("MUTATED_FROM_GET");

    await expect(repository.getByJobId(payload.jobId)).resolves.toMatchObject({
      jobId: "worker_job_1",
      args: ["--target", "preview"],
      envNames: ["LP_PROJECT_ID"]
    });
  });

  it("deletes payloads by job id", async () => {
    const repository = new InMemoryWorkerJobPayloadRepository();
    await repository.save(payloadRecord());

    await repository.deleteByJobId("worker_job_1");

    await expect(repository.getByJobId("worker_job_1")).resolves.toBeUndefined();
  });
});

describe("JsonFileWorkerJobPayloadRepository", () => {
  it("persists and reloads safe payloads without env values", async () => {
    const filePath = await createTempFilePath();
    const repository = createJsonFileWorkerJobPayloadRepository({ filePath });

    await repository.save(payloadRecord());

    const reopened = createJsonFileWorkerJobPayloadRepository({ filePath });
    const saved = await reopened.getByJobId("worker_job_1");
    const persisted = await readFile(filePath, "utf8");

    expect(saved).toMatchObject({
      jobId: "worker_job_1",
      kind: "safe_simulated_tool_command",
      command: "static-deploy",
      args: ["--target", "preview"],
      envNames: ["LP_PROJECT_ID"]
    });
    expect(persisted).toContain("LP_PROJECT_ID");
    expect(persisted).not.toContain("secret-token");
  });

  it("deletes persisted payloads", async () => {
    const filePath = await createTempFilePath();
    const repository = createJsonFileWorkerJobPayloadRepository({ filePath });
    await repository.save(payloadRecord());

    await repository.deleteByJobId("worker_job_1");

    await expect(repository.getByJobId("worker_job_1")).resolves.toBeUndefined();
  });

  it("rejects unsafe payload bounds", async () => {
    const filePath = await createTempFilePath();
    const repository = createJsonFileWorkerJobPayloadRepository({ filePath });

    await expect(
      repository.save(
        payloadRecord({
          args: ["a".repeat(1025)]
        })
      )
    ).rejects.toThrow("worker_job_payload_arg_too_long");
    await expect(
      repository.save(
        payloadRecord({
          envNames: Array.from({ length: 101 }, (_, index) => `ENV_${index}`)
        })
      )
    ).rejects.toThrow("worker_job_payload_env_names_limit_exceeded");
  });
});
```

- [ ] **Step 2: Update the worker-runtime test script and observe failure**

In `packages/worker-runtime/package.json`, update the test script:

```json
"test": "vitest run src/index.test.ts src/worker-job-repositories.test.ts src/worker-job-payload-repositories.test.ts"
```

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
```

Expected: fails because `InMemoryWorkerJobPayloadRepository`, `createJsonFileWorkerJobPayloadRepository`, and `WorkerJobPayloadRecord` do not exist.

- [ ] **Step 3: Add payload types to the runtime public API**

In `packages/worker-runtime/src/index.ts`, add the constants and types near the existing worker job types:

```ts
export const SAFE_WORKER_PAYLOAD_MAX_ARGS = 100;
export const SAFE_WORKER_PAYLOAD_MAX_ARG_LENGTH = 1024;
export const SAFE_WORKER_PAYLOAD_MAX_ENV_NAMES = 100;

export type WorkerJobPayloadKind = "safe_simulated_tool_command";

export interface WorkerJobPayloadRecord {
  jobId: string;
  kind: WorkerJobPayloadKind;
  projectId: string;
  commandId?: string;
  command: string;
  args: string[];
  envNames: string[];
  workingDirectory?: string;
  timeoutMs: number;
  createdAt: string;
}

export interface WorkerJobPayloadRepository {
  save(record: WorkerJobPayloadRecord): Promise<void>;
  getByJobId(jobId: string): Promise<WorkerJobPayloadRecord | undefined>;
  deleteByJobId(jobId: string): Promise<void>;
}
```

- [ ] **Step 4: Implement payload repositories**

Create `packages/worker-runtime/src/worker-job-payload-repositories.ts`:

```ts
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  SAFE_WORKER_PAYLOAD_MAX_ARG_LENGTH,
  SAFE_WORKER_PAYLOAD_MAX_ARGS,
  SAFE_WORKER_PAYLOAD_MAX_ENV_NAMES,
  type WorkerJobPayloadRecord,
  type WorkerJobPayloadRepository
} from "./index";

export interface JsonFileWorkerJobPayloadRepositoryOptions {
  filePath: string;
}

interface WorkerJobPayloadFileState {
  workerJobPayloads: WorkerJobPayloadRecord[];
}

const jsonFileSaveQueues = new Map<string, Promise<void>>();

export class InMemoryWorkerJobPayloadRepository
  implements WorkerJobPayloadRepository
{
  private readonly recordsByJobId = new Map<string, WorkerJobPayloadRecord>();

  async save(record: WorkerJobPayloadRecord): Promise<void> {
    this.recordsByJobId.set(record.jobId, copyPayloadRecord(record));
  }

  async getByJobId(
    jobId: string
  ): Promise<WorkerJobPayloadRecord | undefined> {
    const record = this.recordsByJobId.get(jobId);
    return record ? copyPayloadRecord(record) : undefined;
  }

  async deleteByJobId(jobId: string): Promise<void> {
    this.recordsByJobId.delete(jobId);
  }
}

export class JsonFileWorkerJobPayloadRepository
  implements WorkerJobPayloadRepository
{
  private readonly filePath: string;

  constructor(options: JsonFileWorkerJobPayloadRepositoryOptions) {
    this.filePath = resolve(options.filePath);
  }

  async save(record: WorkerJobPayloadRecord): Promise<void> {
    const previousSave = jsonFileSaveQueues.get(this.filePath) ?? Promise.resolve();
    const nextSave = previousSave
      .catch(() => undefined)
      .then(async () => {
        const records = await this.readRecords();
        const copiedRecord = copyPayloadRecord(record);
        const recordIndex = records.findIndex(
          (stored) => stored.jobId === record.jobId
        );

        if (recordIndex === -1) {
          records.push(copiedRecord);
        } else {
          records[recordIndex] = copiedRecord;
        }

        await this.writeRecords(records);
      });

    jsonFileSaveQueues.set(this.filePath, nextSave);

    try {
      await nextSave;
    } finally {
      if (jsonFileSaveQueues.get(this.filePath) === nextSave) {
        jsonFileSaveQueues.delete(this.filePath);
      }
    }
  }

  async getByJobId(
    jobId: string
  ): Promise<WorkerJobPayloadRecord | undefined> {
    const record = (await this.readRecords()).find(
      (stored) => stored.jobId === jobId
    );
    return record ? copyPayloadRecord(record) : undefined;
  }

  async deleteByJobId(jobId: string): Promise<void> {
    const previousSave = jsonFileSaveQueues.get(this.filePath) ?? Promise.resolve();
    const nextSave = previousSave
      .catch(() => undefined)
      .then(async () => {
        const records = (await this.readRecords()).filter(
          (record) => record.jobId !== jobId
        );
        await this.writeRecords(records);
      });

    jsonFileSaveQueues.set(this.filePath, nextSave);

    try {
      await nextSave;
    } finally {
      if (jsonFileSaveQueues.get(this.filePath) === nextSave) {
        jsonFileSaveQueues.delete(this.filePath);
      }
    }
  }

  private async readRecords(): Promise<WorkerJobPayloadRecord[]> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const parsed = JSON.parse(contents) as Partial<WorkerJobPayloadFileState> | null;
    if (!parsed || !Array.isArray(parsed.workerJobPayloads)) {
      return [];
    }

    return parsed.workerJobPayloads.map((record) => copyPayloadRecord(record));
  }

  private async writeRecords(records: WorkerJobPayloadRecord[]): Promise<void> {
    const directory = dirname(this.filePath);
    const tempFilePath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    const state: WorkerJobPayloadFileState = {
      workerJobPayloads: records.map((record) => copyPayloadRecord(record))
    };

    await mkdir(directory, { recursive: true });
    await writeFile(tempFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempFilePath, this.filePath);
  }
}

export function createJsonFileWorkerJobPayloadRepository(
  options: JsonFileWorkerJobPayloadRepositoryOptions
): JsonFileWorkerJobPayloadRepository {
  return new JsonFileWorkerJobPayloadRepository(options);
}

function copyPayloadRecord(record: WorkerJobPayloadRecord): WorkerJobPayloadRecord {
  assertSafeWorkerJobPayloadRecord(record);
  return {
    jobId: record.jobId,
    kind: record.kind,
    projectId: record.projectId,
    commandId: record.commandId,
    command: record.command,
    args: [...record.args],
    envNames: [...record.envNames].sort(),
    workingDirectory: record.workingDirectory,
    timeoutMs: record.timeoutMs,
    createdAt: record.createdAt
  };
}

function assertSafeWorkerJobPayloadRecord(
  record: WorkerJobPayloadRecord
): void {
  if (record.kind !== "safe_simulated_tool_command") {
    throw new Error("worker_job_payload_kind_not_supported");
  }
  if (record.args.length > SAFE_WORKER_PAYLOAD_MAX_ARGS) {
    throw new Error("worker_job_payload_args_limit_exceeded");
  }
  const tooLongArg = record.args.find(
    (arg) => [...arg].length > SAFE_WORKER_PAYLOAD_MAX_ARG_LENGTH
  );
  if (tooLongArg !== undefined) {
    throw new Error("worker_job_payload_arg_too_long");
  }
  if (record.envNames.length > SAFE_WORKER_PAYLOAD_MAX_ENV_NAMES) {
    throw new Error("worker_job_payload_env_names_limit_exceeded");
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
```

- [ ] **Step 5: Export payload repositories**

In `packages/worker-runtime/src/index.ts`, extend the export block at the bottom:

```ts
export {
  InMemoryWorkerJobPayloadRepository,
  JsonFileWorkerJobPayloadRepository,
  createJsonFileWorkerJobPayloadRepository,
  type JsonFileWorkerJobPayloadRepositoryOptions
} from "./worker-job-payload-repositories";
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
pnpm --filter @lp-agent/worker-runtime typecheck
```

Expected: worker-runtime tests and typecheck pass.

- [ ] **Step 7: Commit payload repositories**

Run:

```bash
git add packages/worker-runtime/package.json packages/worker-runtime/src/index.ts packages/worker-runtime/src/worker-job-payload-repositories.ts packages/worker-runtime/src/worker-job-payload-repositories.test.ts
git commit -m "add safe worker payload repositories"
```

## Task 2: Add Safe Queue Enqueue And Claim Metadata

**Files:**

- Modify: `packages/worker-runtime/src/index.ts`
- Modify: `packages/worker-runtime/src/index.test.ts`
- Modify: `packages/worker-runtime/src/worker-job-repositories.ts`
- Modify: `packages/worker-runtime/src/worker-job-repositories.test.ts`

- [ ] **Step 1: Add failing repository copy tests for claim metadata**

In `packages/worker-runtime/src/worker-job-repositories.test.ts`, add an in-memory repository test:

```ts
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
```

Add a JSON-file repository test:

```ts
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
```

- [ ] **Step 2: Add failing safe enqueue and claim tests**

In `packages/worker-runtime/src/index.test.ts`, import the payload repository:

```ts
  InMemoryWorkerJobPayloadRepository,
```

Add these tests inside `describe("InMemoryWorkerRuntime", ...)`:

```ts
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
```

Add this helper near `baseInput()`:

```ts
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
```

Add `type SafeWorkerJobInput` to the imports.

- [ ] **Step 3: Run tests and observe the failure**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
```

Expected: fails because claim metadata, `payloadRepository`, `enqueueSafe()`, and `claimOldestQueued()` are not implemented.

- [ ] **Step 4: Add claim metadata and queue types**

In `packages/worker-runtime/src/index.ts`, add:

```ts
const WORKER_ID_MAX_LENGTH = 120;
```

Extend `WorkerJobRecord`:

```ts
  claimedByWorkerId?: string;
  claimToken?: string;
```

Add safe input and claim interfaces near `WorkerJobInput`:

```ts
export interface SafeWorkerJobInput {
  projectId: string;
  kind: WorkerJobKind;
  commandId?: string;
  command: string;
  args: string[];
  envNames: string[];
  workingDirectory?: string;
  timeoutMs: number;
}

export interface WorkerJobClaim {
  record: WorkerJobRecord;
  claimToken: string;
}
```

Extend `InMemoryWorkerRuntimeOptions`:

```ts
  payloadRepository?: WorkerJobPayloadRepository;
  claimTokenFactory?: () => string;
```

In the constructor, add:

```ts
    this.payloadRepository = options.payloadRepository;
    this.claimTokenFactory = options.claimTokenFactory ?? (() => randomUUID());
```

Add private fields:

```ts
  private readonly payloadRepository?: WorkerJobPayloadRepository;
  private readonly claimTokenFactory: () => string;
```

Also import `randomUUID` at the top:

```ts
import { randomUUID } from "node:crypto";
```

- [ ] **Step 5: Persist claim metadata in job repositories**

In `packages/worker-runtime/src/worker-job-repositories.ts`, update `copyRecord()`:

```ts
    claimedByWorkerId: record.claimedByWorkerId,
    claimToken: record.claimToken
```

- [ ] **Step 6: Implement safe enqueue**

In `packages/worker-runtime/src/index.ts`, add this method before `runNext()`:

```ts
  async enqueueSafe(
    input: SafeWorkerJobInput,
    policy: SandboxPolicy = createRejectSandboxPolicy()
  ): Promise<WorkerJobRecord> {
    if (!this.payloadRepository) {
      throw new Error("worker_job_payload_repository_required");
    }

    return this.withEnqueueLock(async () => {
      const copiedPolicy = copyPolicy(policy);
      const id = await this.allocateJobId();
      const createdAt = this.nowIso();
      const record: WorkerJobRecord = {
        id,
        projectId: input.projectId,
        kind: input.kind,
        state: "queued",
        policy: copyPolicy(copiedPolicy),
        inputSummary: summarizeSafeInput(input),
        createdAt
      };
      const payload: WorkerJobPayloadRecord = {
        jobId: id,
        kind: "safe_simulated_tool_command",
        projectId: input.projectId,
        commandId: input.commandId,
        command: input.command,
        args: [...input.args],
        envNames: [...input.envNames].sort(),
        workingDirectory: input.workingDirectory,
        timeoutMs: input.timeoutMs,
        createdAt
      };

      await this.payloadRepository.save(payload);
      try {
        await this.repository.save(record);
      } catch (error) {
        await this.payloadRepository.deleteByJobId(id);
        throw error;
      }

      return copyRecord(record);
    });
  }
```

Add helper near `summarizeInput()`:

```ts
function summarizeSafeInput(input: SafeWorkerJobInput): WorkerJobInputSummary {
  return {
    projectId: input.projectId,
    kind: input.kind,
    commandId: input.commandId,
    command: input.command,
    argCount: input.args.length,
    envNames: [...input.envNames].sort(),
    workingDirectory: input.workingDirectory,
    timeoutMs: input.timeoutMs
  };
}
```

- [ ] **Step 7: Implement claim operation**

In `packages/worker-runtime/src/index.ts`, add this public method before `cancelJob()`:

```ts
  async claimOldestQueued(input: {
    workerId: string;
  }): Promise<WorkerJobClaim | undefined> {
    const workerId = normalizeWorkerId(input.workerId);
    if (!workerId) {
      throw new Error("worker_id_required");
    }

    return this.withRunLock(async () => this.claimOldestQueuedForWorker(workerId));
  }
```

Add private helper before `claimOldestQueuedJob()`:

```ts
  private async claimOldestQueuedForWorker(
    workerId: string
  ): Promise<WorkerJobClaim | undefined> {
    while (true) {
      const queuedRecord = await this.repository.findOldestQueued();
      if (!queuedRecord) {
        return undefined;
      }

      const claimed = await this.withJobMutationLock(
        queuedRecord.id,
        async () => {
          const latest = await this.repository.getById(queuedRecord.id);
          if (!latest || latest.state !== "queued") {
            return undefined;
          }

          const claimToken = this.claimTokenFactory();
          const runningRecord: WorkerJobRecord = {
            ...copyRecord(latest),
            state: "running",
            startedAt: this.nowIso(),
            claimedByWorkerId: workerId,
            claimToken
          };
          await this.repository.save(runningRecord);
          return {
            record: copyRecord(runningRecord),
            claimToken
          };
        }
      );
      if (claimed) {
        return claimed;
      }
    }
  }
```

Add helper near `normalizeCancelReason()`:

```ts
function normalizeWorkerId(workerId: string): string | undefined {
  const trimmed = workerId.trim();
  if (!trimmed) {
    return undefined;
  }
  return [...trimmed].slice(0, WORKER_ID_MAX_LENGTH).join("");
}
```

- [ ] **Step 8: Run tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
pnpm --filter @lp-agent/worker-runtime typecheck
```

Expected: worker-runtime tests and typecheck pass.

- [ ] **Step 9: Commit safe enqueue and claim metadata**

Run:

```bash
git add packages/worker-runtime/src/index.ts packages/worker-runtime/src/index.test.ts packages/worker-runtime/src/worker-job-repositories.ts packages/worker-runtime/src/worker-job-repositories.test.ts
git commit -m "add worker safe queue claims"
```

## Task 3: Execute And Complete Claimed Jobs

**Files:**

- Modify: `packages/worker-runtime/src/index.ts`
- Modify: `packages/worker-runtime/src/index.test.ts`

- [ ] **Step 1: Add failing claimed-job execution tests**

In `packages/worker-runtime/src/index.test.ts`, add these tests inside `describe("InMemoryWorkerRuntime", ...)`:

```ts
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
```

- [ ] **Step 2: Run tests and observe the failure**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
```

Expected: fails because `runClaimedJob()` does not exist.

- [ ] **Step 3: Implement claimed-job execution**

In `packages/worker-runtime/src/index.ts`, add this public method before `cancelJob()`:

```ts
  async runClaimedJob(claim: WorkerJobClaim): Promise<WorkerJobRecord> {
    if (!this.payloadRepository) {
      throw new Error("worker_job_payload_repository_required");
    }

    const latest = await this.repository.getById(claim.record.id);
    if (
      !latest ||
      latest.state !== "running" ||
      latest.claimToken !== claim.claimToken
    ) {
      throw new Error("worker_job_claim_conflict");
    }

    const validation = validateSandboxPolicy(latest.inputSummary, latest.policy);
    if (!validation.valid) {
      return this.completeClaimedJob({
        jobId: latest.id,
        claimToken: claim.claimToken,
        result: {
          state: "rejected",
          stdout: "",
          stderr: validation.reason,
          errorName: validation.errorName
        },
        sensitiveValues: []
      });
    }

    const payload = await this.payloadRepository.getByJobId(latest.id);
    if (!payload) {
      return this.completeClaimedJob({
        jobId: latest.id,
        claimToken: claim.claimToken,
        result: {
          state: "failed",
          stdout: "",
          stderr: "Worker job execution payload is unavailable after restart.",
          errorName: "worker_job_payload_unavailable"
        },
        sensitiveValues: []
      });
    }

    try {
      const result = await this.adapter.execute(
        toExecutionInputFromSafePayload(latest, payload),
        copyPolicy(latest.policy),
        this.createExecutionContext(latest.id)
      );

      return this.completeClaimedJob({
        jobId: latest.id,
        claimToken: claim.claimToken,
        result,
        sensitiveValues: []
      });
    } catch (error) {
      return this.completeClaimedJob({
        jobId: latest.id,
        claimToken: claim.claimToken,
        result: {
          state: "failed",
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
          errorName:
            error instanceof Error && error.name
              ? error.name
              : "execution_adapter_failed"
        },
        sensitiveValues: []
      });
    }
  }
```

- [ ] **Step 4: Implement claim-token completion**

In `packages/worker-runtime/src/index.ts`, add this private method before `completeJob()`:

```ts
  private async completeClaimedJob(input: {
    jobId: string;
    claimToken: string;
    result: ExecutionResult;
    sensitiveValues: string[];
  }): Promise<WorkerJobRecord> {
    return this.withJobMutationLock(input.jobId, async () => {
      const latest = await this.repository.getById(input.jobId);
      if (
        !latest ||
        latest.state !== "running" ||
        latest.claimToken !== input.claimToken
      ) {
        throw new Error("worker_job_claim_conflict");
      }

      const completedAt = this.nowIso();
      const completedRecord: WorkerJobRecord = {
        ...copyRecord(latest),
        state: input.result.state,
        resultSummary: summarizeResult(
          input.result,
          latest.policy,
          input.sensitiveValues
        ),
        errorName: input.result.errorName,
        completedAt,
        ...(input.result.state === "cancelled"
          ? {
              cancelRequestedAt: latest.cancelRequestedAt ?? completedAt,
              cancelledAt: completedAt,
              cancelReason: latest.cancelReason
            }
          : {})
      };

      await this.repository.save(completedRecord);
      await this.payloadRepository?.deleteByJobId(input.jobId);

      return copyRecord(completedRecord);
    });
  }
```

Add helper near `toExecutionInput()`:

```ts
function toExecutionInputFromSafePayload(
  record: WorkerJobRecord,
  payload: WorkerJobPayloadRecord
): ExecutionInput {
  return {
    jobId: record.id,
    projectId: record.projectId,
    kind: record.kind,
    commandId: record.inputSummary.commandId,
    command: payload.command,
    args: [...payload.args],
    env: {},
    envNames: [...payload.envNames],
    workingDirectory: payload.workingDirectory,
    timeoutMs: payload.timeoutMs
  };
}
```

- [ ] **Step 5: Delete safe payloads after queued cancellation**

In `cancelQueuedJob()`, after `await this.repository.save(cancelledRecord);`, add:

```ts
    await this.payloadRepository?.deleteByJobId(record.id);
```

Keep the existing process-local payload cleanup:

```ts
    this.payloadsByJobId.delete(record.id);
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
pnpm --filter @lp-agent/worker-runtime typecheck
```

Expected: worker-runtime tests and typecheck pass.

- [ ] **Step 7: Commit claimed-job execution**

Run:

```bash
git add packages/worker-runtime/src/index.ts packages/worker-runtime/src/index.test.ts
git commit -m "execute claimed safe worker jobs"
```

## Task 4: Verify JSON-File Queue Handoff Across Runtime Instances

**Files:**

- Modify: `packages/worker-runtime/src/index.test.ts`

- [ ] **Step 1: Add failing JSON cross-instance handoff test**

In `packages/worker-runtime/src/index.test.ts`, add this test inside `describe("InMemoryWorkerRuntime", ...)`:

```ts
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
      expect(apiVisibleJob).toEqual(completed);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run the cross-instance test**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
```

Expected: passes if Tasks 1-3 were implemented correctly. If it fails because imports are missing, add:

```ts
  createJsonFileWorkerJobPayloadRepository,
```

to the test imports from `./index`.

- [ ] **Step 3: Add queued cancellation payload cleanup test**

In `packages/worker-runtime/src/index.test.ts`, add:

```ts
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
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
pnpm --filter @lp-agent/worker-runtime typecheck
```

Expected: worker-runtime tests and typecheck pass.

- [ ] **Step 5: Commit JSON queue handoff coverage**

Run:

```bash
git add packages/worker-runtime/src/index.test.ts
git commit -m "cover json worker queue handoff"
```

## Task 5: Add Agent Worker Run-Once Handoff

**Files:**

- Modify: `apps/agent-worker/package.json`
- Modify: `apps/agent-worker/src/worker.ts`
- Modify: `apps/agent-worker/src/index.ts`
- Modify: `apps/agent-worker/src/worker.test.ts`

- [ ] **Step 1: Add worker-runtime dependency**

In `apps/agent-worker/package.json`, add:

```json
"@lp-agent/worker-runtime": "workspace:*"
```

under `dependencies`.

- [ ] **Step 2: Add failing `runWorkerOnce()` tests**

In `apps/agent-worker/src/worker.test.ts`, update imports:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter,
  createJsonFileWorkerJobPayloadRepository,
  createJsonFileWorkerJobRepository,
  createSimulatedSandboxPolicy,
  type SafeWorkerJobInput
} from "@lp-agent/worker-runtime";
import { describe, expect, it } from "vitest";
import { runDemoWorkerJob, runWorkerOnce } from "./worker";
```

Add tests after the existing demo test:

```ts
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
      expect(stored).toEqual(result);
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

function createClock(values: string[]): () => Date {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)]!;
    index += 1;
    return new Date(value);
  };
}
```

- [ ] **Step 3: Run agent-worker tests and observe failure**

Run:

```bash
pnpm --filter @lp-agent/agent-worker test
```

Expected: fails because `runWorkerOnce()` is not exported.

- [ ] **Step 4: Implement `runWorkerOnce()`**

In `apps/agent-worker/src/worker.ts`, add imports:

```ts
import {
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter,
  type ExecutionAdapter,
  type WorkerJobPayloadRepository,
  type WorkerJobRecord,
  type WorkerJobRepository
} from "@lp-agent/worker-runtime";
```

Add the interface and function after `runDemoWorkerJob()`:

```ts
export interface RunWorkerOnceInput {
  workerId: string;
  jobRepository: WorkerJobRepository;
  payloadRepository: WorkerJobPayloadRepository;
  adapter?: ExecutionAdapter;
  now?: () => Date;
  claimTokenFactory?: () => string;
}

export async function runWorkerOnce(
  input: RunWorkerOnceInput
): Promise<WorkerJobRecord | undefined> {
  const runtime = new InMemoryWorkerRuntime({
    repository: input.jobRepository,
    payloadRepository: input.payloadRepository,
    adapter: input.adapter ?? new SimulatedExecutionAdapter(),
    now: input.now,
    claimTokenFactory: input.claimTokenFactory
  });
  const claim = await runtime.claimOldestQueued({
    workerId: input.workerId
  });

  if (!claim) {
    return undefined;
  }

  return runtime.runClaimedJob(claim);
}
```

- [ ] **Step 5: Add minimal CLI path**

In `apps/agent-worker/src/index.ts`, replace the file with:

```ts
import {
  createJsonFileWorkerJobPayloadRepository,
  createJsonFileWorkerJobRepository
} from "@lp-agent/worker-runtime";
import { runDemoWorkerJob, runWorkerOnce } from "./worker";

const jobsFilePath = process.env.WORKER_JOBS_FILE;
const payloadsFilePath = process.env.WORKER_PAYLOADS_FILE;
const workerId = process.env.WORKER_ID ?? "local-agent-worker";

if (jobsFilePath && payloadsFilePath) {
  const result = await runWorkerOnce({
    workerId,
    jobRepository: createJsonFileWorkerJobRepository({ filePath: jobsFilePath }),
    payloadRepository: createJsonFileWorkerJobPayloadRepository({
      filePath: payloadsFilePath
    })
  });

  console.log(
    JSON.stringify(
      {
        workerId,
        jobId: result?.id,
        state: result?.state
      },
      null,
      2
    )
  );
} else {
  const { project, brief, pageVersion, deployment } = await runDemoWorkerJob();

  console.log(
    JSON.stringify(
      {
        project,
        briefId: brief.id,
        pageVersionId: pageVersion.id,
        deployment
      },
      null,
      2
    )
  );
}
```

- [ ] **Step 6: Run agent-worker tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/agent-worker test
pnpm --filter @lp-agent/agent-worker typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 7: Commit agent worker handoff**

Run:

```bash
git add apps/agent-worker/package.json apps/agent-worker/src/worker.ts apps/agent-worker/src/index.ts apps/agent-worker/src/worker.test.ts
git commit -m "add agent worker queue handoff"
```

## Task 6: Documentation And Full Verification

**Files:**

- Modify: `docs/agent-development-learning.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Update Stage 11 learning docs after implementation**

In `docs/agent-development-learning.md`, under `### 阶段 11：Worker Queue Handoff v0`, add this section after the current design bullets and before `学习重点`:

```md
当前实现状态：

- Stage 11 v0 已实现安全 worker queue handoff：一个 runtime 可以入队 safe simulated worker job，另一个 runtime 或 `apps/agent-worker` 可以通过共享 repository claim 并完成该 job。
- safe worker payload 只持久化 bounded args、env names 和 command metadata，不持久化 raw env value、secret 或 artifact 内容。
- worker claim 会写入 `claimedByWorkerId` 和 `claimToken`；claimed job completion 必须匹配 claim token，避免 stale worker 覆盖状态。
- `apps/agent-worker` 已提供 `runWorkerOnce()`，但仍不做 daemon polling、真实 shell、MCP execution、streaming logs 或 deployment skill worker execution。
```

- [ ] **Step 2: Confirm Superpowers reading order**

In `docs/superpowers/README.md`, ensure these entries exist in this order:

```md
50. `specs/2026-05-17-worker-queue-handoff-design.md`
51. `plans/2026-05-18-worker-queue-handoff.md`
```

If entry 51 is missing, add:

```md
51. `plans/2026-05-18-worker-queue-handoff.md`
   - Stage 11 worker queue handoff v0 implementation plan.
   - Read this after the worker queue handoff design when implementing or auditing safe persisted worker payloads, claim-token worker handoff, `apps/agent-worker` run-once execution, and verification that no real shell, MCP execution, or Web interrupt wiring was introduced.
```

- [ ] **Step 3: Run targeted verification**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
pnpm --filter @lp-agent/agent-worker test
pnpm --filter @lp-agent/worker-runtime typecheck
pnpm --filter @lp-agent/agent-worker typecheck
```

Expected:

```text
@lp-agent/worker-runtime test: all worker-runtime tests pass
@lp-agent/agent-worker test: all agent-worker tests pass
@lp-agent/worker-runtime typecheck: no TypeScript errors
@lp-agent/agent-worker typecheck: no TypeScript errors
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
pnpm build: all builds pass
git diff --check: no whitespace errors
```

- [ ] **Step 5: Commit documentation updates**

Run:

```bash
git add docs/agent-development-learning.md docs/superpowers/README.md
git commit -m "document worker queue handoff implementation"
```

If `docs/superpowers/README.md` was already updated with entry 51 during plan creation and no implementation-time README change is needed, commit only the learning doc.

## Final Handoff

After all tasks pass, report:

- commits created;
- verification commands and results;
- whether safe payloads persist without raw env values or secrets;
- whether claim metadata prevents stale completion;
- whether `apps/agent-worker.runWorkerOnce()` can execute one safe queued job;
- whether Stage 10 cancellation tests still pass;
- whether real shell execution, MCP execution, Web interrupt wiring, streaming logs, and deployment worker execution remain out of scope.

## Self-Review

- Spec coverage: this plan covers safe payload repositories, safe enqueue, worker claim metadata, claim-token completion, JSON-file cross-instance handoff, agent-worker run-once execution, docs, and verification.
- Scope check: this plan explicitly excludes real shell execution, MCP execution, Web interrupt wiring, streaming logs, retry/resume, secret manager integration, and deployment worker execution.
- Type consistency: `WorkerJobPayloadRecord`, `WorkerJobPayloadRepository`, `SafeWorkerJobInput`, `WorkerJobClaim`, `claimOldestQueued`, `runClaimedJob`, `claimedByWorkerId`, and `claimToken` are used consistently across tasks.
- Safety check: persisted safe payloads contain bounded args and env names only; raw env values, secrets, artifact contents, and executable payloads remain out of persisted queue handoff.
