# Worker Job Postgres Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit `WORKER_REPOSITORY_BACKEND=postgres` path for worker job, safe persisted payload, and bounded worker lifecycle log repositories without changing the default JSON-file worker queue.

**Architecture:** `@lp-agent/worker-runtime` keeps repository contracts, in-memory/JSON repositories, safety validators, and runtime state transitions. `@lp-agent/db` owns Prisma schema, Prisma mappers, and Prisma-backed adapters that implement worker-runtime interfaces. `@lp-agent/api` exposes one async worker queue runtime factory used by Web and `apps/agent-worker`, so enqueue and claim/run always resolve the same backend from the same rules.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Prisma schema validation, Next.js server actions, existing worker-runtime contracts, optional dynamic `@prisma/client`.

---

## Scope Boundary

This plan implements the Stage 24 design:

- `WORKER_REPOSITORY_BACKEND=json|memory|postgres`.
- Default unset backend remains JSON-file.
- Postgres backend requires `DATABASE_URL` and fails closed.
- Postgres covers `WorkerJobRepository`, `WorkerJobPayloadRepository`, and `WorkerLogRepository`.
- Safe payload storage remains limited to current `WorkerJobPayloadRecord` fields.
- Worker lifecycle logs remain bounded and sanitized.
- Web enqueue and `apps/agent-worker` claim/run share one factory.

This plan does not add a real shell runner, production process manager, hosted worker fleet, MCP worker execution, raw stdout/stderr streaming, JSON queue migration, or production Prisma migration strategy.

## File Structure

Create:

- `packages/worker-runtime/src/worker-repository-contract.ts` - Shared Vitest contract helpers for worker job, payload, and log repositories.
- `packages/db/src/prisma-worker-mappers.ts` - Pure mapping and sanitization boundary between Prisma rows and worker-runtime records.
- `packages/db/src/prisma-worker-mappers.test.ts` - Mapper round-trip and safety tests.
- `packages/db/src/prisma-worker-repositories.ts` - Prisma-backed worker job, safe payload, and log repositories.
- `packages/db/src/prisma-worker-repositories.test.ts` - Fake Prisma delegate tests, including shared repository contracts.
- `packages/db/src/prisma-worker-repositories.integration.test.ts` - Opt-in real Postgres test gated by `POSTGRES_WORKER_REPOSITORY_TEST=1`.
- `packages/api/src/worker-queue-repository-factory.ts` - Shared worker queue backend selection and runtime factory.
- `packages/api/src/worker-queue-repository-factory.test.ts` - Backend selection tests using injected repository/client factories.
- `apps/agent-worker/src/config.ts` - Agent worker queue config parsing helpers that keep demo fallback and backend opt-in behavior explicit.
- `apps/agent-worker/src/config.test.ts` - Agent worker config behavior tests.

Modify:

- `packages/db/package.json` - Add `@lp-agent/worker-runtime` workspace dependency.
- `packages/db/prisma/schema.prisma` - Add `WorkerJob`, `WorkerJobPayload`, and `WorkerLog`.
- `packages/db/src/index.ts` - Export Prisma worker repository factories and mapper helpers.
- `packages/db/src/prisma-schema-contract.test.ts` - Assert Stage 24 Prisma models, fields, and indexes.
- `packages/worker-runtime/src/index.ts` - Export shared contract helpers only if tests in other packages need the package public entry.
- `packages/worker-runtime/src/worker-job-repositories.test.ts` - Reuse shared job repository contract for in-memory and JSON implementations.
- `packages/worker-runtime/src/worker-job-payload-repositories.test.ts` - Reuse shared payload repository contract for in-memory and JSON implementations.
- `packages/worker-runtime/src/worker-log-repositories.test.ts` - Reuse shared log repository contract for in-memory and JSON implementations.
- `packages/api/src/index.ts` - Export worker queue backend factory types/functions.
- `packages/api/src/skill-command-worker-queue.ts` - Keep JSON helper behavior, or delegate to the shared factory where it avoids duplicate construction.
- `apps/web/src/lib/workbench-store.ts` - Use shared async worker queue factory in default Web store construction.
- `apps/web/src/lib/workbench-store.test.ts` - Cover default JSON behavior and injected worker queue backend selection behavior.
- `apps/agent-worker/src/index.ts` - Use shared worker queue factory; allow postgres backend without `WORKER_JOBS_FILE` and `WORKER_PAYLOADS_FILE`.
- `apps/agent-worker/src/worker.test.ts` - Cover run-once behavior through injected/shared worker queue runtime where needed.
- `README.md` - Document the opt-in worker queue Postgres backend.
- `docs/development.md` - Document env vars, safety boundary, and default JSON backend.
- `docs/project-roadmap.md` - Mark Stage 24 implementation status after code lands and keep Stage 25/26 queue accurate.
- `docs/agent-development-learning.md` - Record durable worker queue concepts and safety tradeoffs.
- `docs/superpowers/README.md` - Add this implementation plan to reading order.

## Task 1: Prisma Schema Contract

**Files:**

- Modify: `packages/db/src/prisma-schema-contract.test.ts`
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Write failing schema contract tests**

Add tests that inspect the Prisma schema text for all Stage 24 models, fields, and indexes. Use the existing helpers in `packages/db/src/prisma-schema-contract.test.ts`; if the file currently has local helpers for `expectModel` or `expectField`, extend those instead of adding a second parser.

```ts
it("defines the worker job postgres backend models", () => {
  const workerJob = expectModel(schema, "WorkerJob");
  expect(workerJob).toContain("id String @id");
  expect(workerJob).toContain("projectId String");
  expect(workerJob).toContain("kind String");
  expect(workerJob).toContain("state String");
  expect(workerJob).toContain("payloadSource String?");
  expect(workerJob).toContain("policy Json");
  expect(workerJob).toContain("inputSummary Json");
  expect(workerJob).toContain("resultSummary Json?");
  expect(workerJob).toContain("errorName String?");
  expect(workerJob).toContain("createdAt DateTime");
  expect(workerJob).toContain("startedAt DateTime?");
  expect(workerJob).toContain("completedAt DateTime?");
  expect(workerJob).toContain("cancelRequestedAt DateTime?");
  expect(workerJob).toContain("cancelledAt DateTime?");
  expect(workerJob).toContain("cancelReason String?");
  expect(workerJob).toContain("claimedByWorkerId String?");
  expect(workerJob).toContain("claimToken String?");
  expect(workerJob).toContain("lastHeartbeatAt DateTime?");
  expect(workerJob).toContain("heartbeatExpiresAt DateTime?");
  expect(workerJob).toContain("staleRecoveredAt DateTime?");
  expect(workerJob).toContain("staleRecoveryCount Int?");
  expect(workerJob).toContain("lastWorkerLogAt DateTime?");
  expect(workerJob).toContain("@@index([projectId, createdAt, id])");
  expect(workerJob).toContain("@@index([state, payloadSource, createdAt, id])");
  expect(workerJob).toContain("@@index([claimedByWorkerId])");
  expect(workerJob).toContain("@@index([heartbeatExpiresAt])");

  const payload = expectModel(schema, "WorkerJobPayload");
  expect(payload).toContain("jobId String @id");
  expect(payload).toContain("kind String");
  expect(payload).toContain("projectId String");
  expect(payload).toContain("commandId String?");
  expect(payload).toContain("command String");
  expect(payload).toContain("args Json");
  expect(payload).toContain("envNames Json");
  expect(payload).toContain("workingDirectory String?");
  expect(payload).toContain("timeoutMs Int");
  expect(payload).toContain("createdAt DateTime");
  expect(payload).toContain("@@index([projectId, createdAt])");
  expect(payload).toContain("@@index([kind])");
  expect(payload).not.toContain("@relation");

  const log = expectModel(schema, "WorkerLog");
  expect(log).toContain("id String @id");
  expect(log).toContain("type String");
  expect(log).toContain("message String");
  expect(log).toContain("workerId String?");
  expect(log).toContain("workerJobId String?");
  expect(log).toContain("projectId String?");
  expect(log).toContain("payload Json");
  expect(log).toContain("createdAt DateTime");
  expect(log).toContain("@@index([projectId, createdAt, id])");
  expect(log).toContain("@@index([workerId, createdAt, id])");
  expect(log).toContain("@@index([workerJobId, createdAt, id])");
  expect(log).toContain("@@index([type, createdAt])");
});
```

- [ ] **Step 2: Run the schema contract test and verify it fails**

Run:

```bash
pnpm --filter @lp-agent/db test -- prisma-schema-contract.test.ts
```

Expected: fail because `WorkerJob`, `WorkerJobPayload`, and `WorkerLog` are not in `packages/db/prisma/schema.prisma`.

- [ ] **Step 3: Add the Prisma models**

Append these models to `packages/db/prisma/schema.prisma` near the other Agent runtime persistence models:

```prisma
model WorkerJob {
  id                 String    @id
  projectId          String
  kind               String
  state              String
  payloadSource      String?
  policy             Json
  inputSummary       Json
  resultSummary      Json?
  errorName          String?
  createdAt          DateTime
  startedAt          DateTime?
  completedAt        DateTime?
  cancelRequestedAt  DateTime?
  cancelledAt        DateTime?
  cancelReason       String?
  claimedByWorkerId  String?
  claimToken         String?
  lastHeartbeatAt    DateTime?
  heartbeatExpiresAt DateTime?
  staleRecoveredAt   DateTime?
  staleRecoveryCount Int?
  lastWorkerLogAt    DateTime?

  @@index([projectId, createdAt, id])
  @@index([state, payloadSource, createdAt, id])
  @@index([claimedByWorkerId])
  @@index([heartbeatExpiresAt])
}

model WorkerJobPayload {
  jobId            String   @id
  kind             String
  projectId        String
  commandId        String?
  command          String
  args             Json
  envNames         Json
  workingDirectory String?
  timeoutMs        Int
  createdAt        DateTime

  @@index([projectId, createdAt])
  @@index([kind])
}

model WorkerLog {
  id          String   @id
  type        String
  message     String
  workerId    String?
  workerJobId String?
  projectId   String?
  payload     Json
  createdAt   DateTime

  @@index([projectId, createdAt, id])
  @@index([workerId, createdAt, id])
  @@index([workerJobId, createdAt, id])
  @@index([type, createdAt])
}
```

- [ ] **Step 4: Validate schema and tests**

Run:

```bash
pnpm --filter @lp-agent/db test -- prisma-schema-contract.test.ts
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm --filter @lp-agent/db db:validate
```

Expected: schema contract test passes and Prisma reports the schema is valid. The validate command does not connect to a real database.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/src/prisma-schema-contract.test.ts
git commit -m "align worker postgres schema contract"
```

## Task 2: Shared Worker Repository Contract Tests

**Files:**

- Create: `packages/worker-runtime/src/worker-repository-contract.ts`
- Modify: `packages/worker-runtime/src/index.ts`
- Modify: `packages/worker-runtime/src/worker-job-repositories.test.ts`
- Modify: `packages/worker-runtime/src/worker-job-payload-repositories.test.ts`
- Modify: `packages/worker-runtime/src/worker-log-repositories.test.ts`

- [ ] **Step 1: Create contract helper skeleton with explicit factory types**

Create `packages/worker-runtime/src/worker-repository-contract.ts`:

```ts
import { describe, expect, it } from "vitest";
import type {
  WorkerJobPayloadRecord,
  WorkerJobPayloadRepository,
  WorkerJobRecord,
  WorkerJobRepository,
  WorkerLogRecord,
  WorkerLogRepository,
} from "./index";

type MaybePromise<T> = T | Promise<T>;

export type WorkerJobRepositoryFactory = () => MaybePromise<WorkerJobRepository>;
export type WorkerJobPayloadRepositoryFactory = () => MaybePromise<WorkerJobPayloadRepository>;
export type WorkerLogRepositoryFactory = () => MaybePromise<WorkerLogRepository>;

export function createContractWorkerJobRecord(overrides: Partial<WorkerJobRecord> = {}): WorkerJobRecord {
  return {
    id: "worker-job-1",
    projectId: "project-1",
    kind: "skill_command",
    state: "queued",
    payloadSource: "safe_persisted",
    policy: { sandbox: "none" },
    inputSummary: { commandId: "deploy-preview", argCount: 1, envNames: ["DEPLOY_TOKEN"] },
    createdAt: new Date("2026-05-20T00:00:00.000Z"),
    ...overrides,
  };
}

export function createContractWorkerJobPayloadRecord(
  overrides: Partial<WorkerJobPayloadRecord> = {},
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
    createdAt: new Date("2026-05-20T00:00:01.000Z"),
    ...overrides,
  };
}

export function createContractWorkerLogRecord(overrides: Partial<WorkerLogRecord> = {}): WorkerLogRecord {
  return {
    id: "worker-log-1",
    type: "worker.job.completed",
    message: "Worker job completed",
    workerId: "worker-1",
    workerJobId: "worker-job-1",
    projectId: "project-1",
    payload: { workerJobId: "worker-job-1", state: "completed", outputSummary: "ok" },
    createdAt: new Date("2026-05-20T00:00:02.000Z"),
    ...overrides,
  };
}
```

- [ ] **Step 2: Add job repository contract cases**

In the same file, add `runWorkerJobRepositoryContractTests`:

```ts
export function runWorkerJobRepositoryContractTests(
  name: string,
  createRepository: WorkerJobRepositoryFactory,
): void {
  describe(`${name} worker job repository contract`, () => {
    it("saves defensive copies and lists jobs in created order", async () => {
      const repository = await createRepository();
      const later = createContractWorkerJobRecord({
        id: "job-later",
        createdAt: new Date("2026-05-20T00:00:03.000Z"),
      });
      const earlier = createContractWorkerJobRecord({
        id: "job-earlier",
        createdAt: new Date("2026-05-20T00:00:01.000Z"),
      });

      await repository.save(later);
      await repository.save(earlier);
      earlier.state = "failed";

      expect((await repository.getById("job-earlier"))?.state).toBe("queued");
      expect((await repository.listForProject("project-1")).map((job) => job.id)).toEqual([
        "job-earlier",
        "job-later",
      ]);
    });

    it("claims only queued jobs matching payload source and claim token", async () => {
      const repository = await createRepository();
      await repository.save(createContractWorkerJobRecord({ id: "job-memory", payloadSource: undefined }));
      await repository.save(createContractWorkerJobRecord({ id: "job-safe", payloadSource: "safe_persisted" }));

      const claimed = await repository.claimOldestQueued({
        workerId: "worker-1",
        claimToken: "claim-token-1",
        payloadSource: "safe_persisted",
        heartbeatExpiresAt: new Date("2026-05-20T00:05:00.000Z"),
        now: new Date("2026-05-20T00:01:00.000Z"),
      });

      expect(claimed?.id).toBe("job-safe");
      expect(claimed?.state).toBe("running");
      expect(claimed?.claimedByWorkerId).toBe("worker-1");
      expect(claimed?.claimToken).toBe("claim-token-1");
      expect((await repository.claimOldestQueued({
        workerId: "worker-2",
        claimToken: "claim-token-2",
        payloadSource: "safe_persisted",
        heartbeatExpiresAt: new Date("2026-05-20T00:05:00.000Z"),
        now: new Date("2026-05-20T00:01:01.000Z"),
      }))?.id).not.toBe("job-safe");
    });

    it("heartbeats and completes only the matching claimed running job", async () => {
      const repository = await createRepository();
      await repository.save(createContractWorkerJobRecord({ id: "job-1" }));
      const claimed = await repository.claimOldestQueued({
        workerId: "worker-1",
        claimToken: "claim-token-1",
        payloadSource: "safe_persisted",
        heartbeatExpiresAt: new Date("2026-05-20T00:05:00.000Z"),
        now: new Date("2026-05-20T00:01:00.000Z"),
      });

      expect(claimed?.id).toBe("job-1");
      await expect(repository.heartbeatClaimed({
        jobId: "job-1",
        workerId: "worker-1",
        claimToken: "wrong-token",
        now: new Date("2026-05-20T00:02:00.000Z"),
        heartbeatExpiresAt: new Date("2026-05-20T00:07:00.000Z"),
      })).rejects.toThrow(/claim/i);

      const heartbeat = await repository.heartbeatClaimed({
        jobId: "job-1",
        workerId: "worker-1",
        claimToken: "claim-token-1",
        now: new Date("2026-05-20T00:02:00.000Z"),
        heartbeatExpiresAt: new Date("2026-05-20T00:07:00.000Z"),
      });
      expect(heartbeat.lastHeartbeatAt?.toISOString()).toBe("2026-05-20T00:02:00.000Z");

      const completed = await repository.completeClaimed({
        jobId: "job-1",
        workerId: "worker-1",
        claimToken: "claim-token-1",
        resultSummary: { exitCode: 0, outputSummary: "ok" },
        completedAt: new Date("2026-05-20T00:03:00.000Z"),
      });
      expect(completed.state).toBe("completed");
      expect(completed.claimToken).toBe("claim-token-1");
    });

    it("handles queued cancellation, running cancellation, and stale safe recovery", async () => {
      const repository = await createRepository();
      await repository.save(createContractWorkerJobRecord({ id: "queued-job" }));
      const cancelled = await repository.cancelQueued({
        jobId: "queued-job",
        reason: "user_requested",
        now: new Date("2026-05-20T00:02:00.000Z"),
      });
      expect(cancelled.state).toBe("cancelled");

      await repository.save(createContractWorkerJobRecord({ id: "running-job" }));
      await repository.claimOldestQueued({
        workerId: "worker-1",
        claimToken: "claim-token-1",
        payloadSource: "safe_persisted",
        heartbeatExpiresAt: new Date("2026-05-20T00:02:00.000Z"),
        now: new Date("2026-05-20T00:01:00.000Z"),
      });
      const requested = await repository.requestRunningCancellation({
        jobId: "running-job",
        reason: "user_requested",
        now: new Date("2026-05-20T00:01:30.000Z"),
      });
      expect(requested.cancelRequestedAt?.toISOString()).toBe("2026-05-20T00:01:30.000Z");

      const recovered = await repository.recoverStale({
        now: new Date("2026-05-20T00:03:00.000Z"),
        maxRecoveries: 1,
      });
      expect(recovered.map((job) => job.id)).toContain("running-job");
      expect((await repository.getById("running-job"))?.state).toBe("cancelled");
    });
  });
}
```

Adjust the input property names to the exact repository contract in `packages/worker-runtime/src/index.ts`. Preserve the assertions and timestamps.

- [ ] **Step 3: Add payload and log repository contract cases**

Add these helpers to the same contract file:

```ts
export function runWorkerJobPayloadRepositoryContractTests(
  name: string,
  createRepository: WorkerJobPayloadRepositoryFactory,
): void {
  describe(`${name} worker job payload repository contract`, () => {
    it("stores defensive copies and canonical env names", async () => {
      const repository = await createRepository();
      const payload = createContractWorkerJobPayloadRecord({
        envNames: ["Z_TOKEN", "A_TOKEN", "A_TOKEN"],
      });

      await repository.save(payload);
      payload.args.push("--mutated");

      const stored = await repository.getByJobId("worker-job-1");
      expect(stored?.args).toEqual(["--preview"]);
      expect(stored?.envNames).toEqual(["A_TOKEN", "Z_TOKEN"]);
    });

    it("rejects unsafe payloads and deletes idempotently", async () => {
      const repository = await createRepository();
      await expect(repository.save({
        ...createContractWorkerJobPayloadRecord(),
        kind: "raw_shell_command",
      } as WorkerJobPayloadRecord)).rejects.toThrow(/safe_simulated_tool_command|payload/i);

      await repository.deleteByJobId("missing-job");
      await repository.save(createContractWorkerJobPayloadRecord());
      await repository.deleteByJobId("worker-job-1");
      expect(await repository.getByJobId("worker-job-1")).toBeUndefined();
    });
  });
}

export function runWorkerLogRepositoryContractTests(
  name: string,
  createRepository: WorkerLogRepositoryFactory,
): void {
  describe(`${name} worker log repository contract`, () => {
    it("sanitizes payload and lists newest first with filters", async () => {
      const repository = await createRepository();
      await repository.append(createContractWorkerLogRecord({
        id: "older",
        createdAt: new Date("2026-05-20T00:00:01.000Z"),
        payload: {
          workerJobId: "worker-job-1",
          state: "running",
          rawStdout: "must not persist",
          secret: "must not persist",
        },
      }));
      await repository.append(createContractWorkerLogRecord({
        id: "newer",
        workerJobId: "worker-job-2",
        createdAt: new Date("2026-05-20T00:00:02.000Z"),
      }));

      const all = await repository.list({ projectId: "project-1", limit: 10 });
      expect(all.map((log) => log.id)).toEqual(["newer", "older"]);
      expect(all[1]?.payload).toEqual({ workerJobId: "worker-job-1", state: "running" });

      const filtered = await repository.list({ workerJobId: "worker-job-2", limit: 10 });
      expect(filtered.map((log) => log.id)).toEqual(["newer"]);
    });

    it("trims to maxRecords after append", async () => {
      const repository = await createRepository();
      for (let index = 0; index < 3; index += 1) {
        await repository.append(createContractWorkerLogRecord({
          id: `log-${index}`,
          createdAt: new Date(`2026-05-20T00:00:0${index}.000Z`),
        }));
      }

      const logs = await repository.list({ limit: 10 });
      expect(logs.length).toBeLessThanOrEqual(3);
    });
  });
}
```

For the max-records assertion, instantiate one concrete repository with `maxRecords: 2` in each current repository test file and assert `["log-2", "log-1"]`.

- [ ] **Step 4: Refactor existing worker-runtime tests to call the contract helpers**

In each existing worker-runtime repository test file, keep repository-specific malformed JSON and filesystem tests, but replace duplicated happy-path behavior tests with contract calls. Example:

```ts
import {
  runWorkerJobPayloadRepositoryContractTests,
  runWorkerJobRepositoryContractTests,
  runWorkerLogRepositoryContractTests,
} from "./worker-repository-contract";

runWorkerJobRepositoryContractTests("in-memory", async () => new InMemoryWorkerJobRepository());
runWorkerJobRepositoryContractTests("json-file", async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), "worker-jobs-")), "jobs.json");
  return new JsonFileWorkerJobRepository(filePath);
});
```

Export the helpers from `packages/worker-runtime/src/index.ts` only if `packages/db` cannot import them through the package source path in tests. If exported, use names that make the testing purpose clear:

```ts
export {
  createContractWorkerJobPayloadRecord,
  createContractWorkerJobRecord,
  createContractWorkerLogRecord,
  runWorkerJobPayloadRepositoryContractTests,
  runWorkerJobRepositoryContractTests,
  runWorkerLogRepositoryContractTests,
} from "./worker-repository-contract";
```

- [ ] **Step 5: Run worker-runtime tests**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
```

Expected: existing in-memory and JSON repository behavior passes through shared contracts.

- [ ] **Step 6: Commit**

```bash
git add packages/worker-runtime/src/index.ts packages/worker-runtime/src/worker-repository-contract.ts packages/worker-runtime/src/worker-job-repositories.test.ts packages/worker-runtime/src/worker-job-payload-repositories.test.ts packages/worker-runtime/src/worker-log-repositories.test.ts
git commit -m "extract worker repository contracts"
```

## Task 3: Prisma Worker Mappers

**Files:**

- Create: `packages/db/src/prisma-worker-mappers.ts`
- Create: `packages/db/src/prisma-worker-mappers.test.ts`
- Modify: `packages/db/package.json`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Add worker-runtime dependency to db**

In `packages/db/package.json`, add:

```json
"@lp-agent/worker-runtime": "workspace:*"
```

Place it with other workspace dependencies and keep the existing JSON ordering style.

- [ ] **Step 2: Write mapper tests**

Create `packages/db/src/prisma-worker-mappers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  mapPrismaWorkerJobPayloadToRecord,
  mapPrismaWorkerJobToRecord,
  mapPrismaWorkerLogToRecord,
  mapWorkerJobPayloadRecordToPrisma,
  mapWorkerJobRecordToPrisma,
  mapWorkerLogRecordToPrisma,
} from "./prisma-worker-mappers";

const createdAt = new Date("2026-05-20T00:00:00.000Z");

describe("prisma worker mappers", () => {
  it("round-trips worker job records with dates and json summaries", () => {
    const record = {
      id: "job-1",
      projectId: "project-1",
      kind: "skill_command",
      state: "running",
      payloadSource: "safe_persisted",
      policy: { sandbox: "none" },
      inputSummary: { commandId: "deploy-preview" },
      resultSummary: { exitCode: 0, outputSummary: "ok" },
      errorName: undefined,
      createdAt,
      startedAt: new Date("2026-05-20T00:00:01.000Z"),
      completedAt: undefined,
      cancelRequestedAt: undefined,
      cancelledAt: undefined,
      cancelReason: undefined,
      claimedByWorkerId: "worker-1",
      claimToken: "claim-token",
      lastHeartbeatAt: new Date("2026-05-20T00:00:02.000Z"),
      heartbeatExpiresAt: new Date("2026-05-20T00:05:02.000Z"),
      staleRecoveredAt: undefined,
      staleRecoveryCount: 0,
      lastWorkerLogAt: undefined,
    };

    expect(mapPrismaWorkerJobToRecord(mapWorkerJobRecordToPrisma(record))).toEqual(record);
  });

  it("round-trips safe payload records and canonicalizes env names", () => {
    const record = {
      jobId: "job-1",
      kind: "safe_simulated_tool_command",
      projectId: "project-1",
      commandId: "deploy-preview",
      command: "deploy preview",
      args: ["--preview"],
      envNames: ["Z_TOKEN", "A_TOKEN", "A_TOKEN"],
      workingDirectory: "workspace",
      timeoutMs: 30_000,
      createdAt,
    };

    const prisma = mapWorkerJobPayloadRecordToPrisma(record);
    expect(prisma.envNames).toEqual(["A_TOKEN", "Z_TOKEN"]);
    expect(JSON.stringify(prisma)).not.toContain("secret-value");
    expect(mapPrismaWorkerJobPayloadToRecord(prisma)).toEqual({
      ...record,
      envNames: ["A_TOKEN", "Z_TOKEN"],
    });
  });

  it("sanitizes worker log payloads before persistence", () => {
    const record = {
      id: "log-1",
      type: "worker.job.completed",
      message: "completed",
      workerId: "worker-1",
      workerJobId: "job-1",
      projectId: "project-1",
      payload: {
        workerJobId: "job-1",
        projectId: "project-1",
        state: "completed",
        rawStdout: "must not persist",
        secret: "must not persist",
      },
      createdAt,
    };

    const prisma = mapWorkerLogRecordToPrisma(record);
    expect(prisma.payload).toEqual({
      workerJobId: "job-1",
      projectId: "project-1",
      state: "completed",
    });
    expect(mapPrismaWorkerLogToRecord(prisma)).toEqual({
      ...record,
      payload: {
        workerJobId: "job-1",
        projectId: "project-1",
        state: "completed",
      },
    });
  });
});
```

- [ ] **Step 3: Run mapper tests and verify they fail**

Run:

```bash
pnpm --filter @lp-agent/db test -- prisma-worker-mappers.test.ts
```

Expected: fail because `packages/db/src/prisma-worker-mappers.ts` does not exist.

- [ ] **Step 4: Implement mapper functions**

Create `packages/db/src/prisma-worker-mappers.ts` with pure functions. Import worker-runtime types and reuse exported safety helpers if available; if current validators are private, mirror the same allowlist in this file and cover it with tests.

```ts
import type {
  WorkerJobPayloadRecord,
  WorkerJobRecord,
  WorkerLogRecord,
} from "@lp-agent/worker-runtime";

const WORKER_LOG_PAYLOAD_KEYS = new Set([
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
  "createdAt",
]);

function undefinedFromNull<T>(value: T | null | undefined): T | undefined {
  return value === null ? undefined : value;
}

function canonicalEnvNames(envNames: readonly string[]): string[] {
  return [...new Set(envNames)].sort();
}

function sanitizeWorkerLogPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => WORKER_LOG_PAYLOAD_KEYS.has(key)),
  );
}

export function mapWorkerJobRecordToPrisma(record: WorkerJobRecord) {
  return {
    id: record.id,
    projectId: record.projectId,
    kind: record.kind,
    state: record.state,
    payloadSource: record.payloadSource ?? null,
    policy: record.policy,
    inputSummary: record.inputSummary,
    resultSummary: record.resultSummary ?? null,
    errorName: record.errorName ?? null,
    createdAt: record.createdAt,
    startedAt: record.startedAt ?? null,
    completedAt: record.completedAt ?? null,
    cancelRequestedAt: record.cancelRequestedAt ?? null,
    cancelledAt: record.cancelledAt ?? null,
    cancelReason: record.cancelReason ?? null,
    claimedByWorkerId: record.claimedByWorkerId ?? null,
    claimToken: record.claimToken ?? null,
    lastHeartbeatAt: record.lastHeartbeatAt ?? null,
    heartbeatExpiresAt: record.heartbeatExpiresAt ?? null,
    staleRecoveredAt: record.staleRecoveredAt ?? null,
    staleRecoveryCount: record.staleRecoveryCount ?? null,
    lastWorkerLogAt: record.lastWorkerLogAt ?? null,
  };
}

export function mapPrismaWorkerJobToRecord(row: ReturnType<typeof mapWorkerJobRecordToPrisma>): WorkerJobRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    state: row.state as WorkerJobRecord["state"],
    payloadSource: undefinedFromNull(row.payloadSource),
    policy: row.policy as WorkerJobRecord["policy"],
    inputSummary: row.inputSummary as WorkerJobRecord["inputSummary"],
    resultSummary: undefinedFromNull(row.resultSummary) as WorkerJobRecord["resultSummary"],
    errorName: undefinedFromNull(row.errorName),
    createdAt: row.createdAt,
    startedAt: undefinedFromNull(row.startedAt),
    completedAt: undefinedFromNull(row.completedAt),
    cancelRequestedAt: undefinedFromNull(row.cancelRequestedAt),
    cancelledAt: undefinedFromNull(row.cancelledAt),
    cancelReason: undefinedFromNull(row.cancelReason),
    claimedByWorkerId: undefinedFromNull(row.claimedByWorkerId),
    claimToken: undefinedFromNull(row.claimToken),
    lastHeartbeatAt: undefinedFromNull(row.lastHeartbeatAt),
    heartbeatExpiresAt: undefinedFromNull(row.heartbeatExpiresAt),
    staleRecoveredAt: undefinedFromNull(row.staleRecoveredAt),
    staleRecoveryCount: undefinedFromNull(row.staleRecoveryCount),
    lastWorkerLogAt: undefinedFromNull(row.lastWorkerLogAt),
  };
}

export function mapWorkerJobPayloadRecordToPrisma(record: WorkerJobPayloadRecord) {
  return {
    jobId: record.jobId,
    kind: record.kind,
    projectId: record.projectId,
    commandId: record.commandId ?? null,
    command: record.command,
    args: [...record.args],
    envNames: canonicalEnvNames(record.envNames),
    workingDirectory: record.workingDirectory ?? null,
    timeoutMs: record.timeoutMs,
    createdAt: record.createdAt,
  };
}

export function mapPrismaWorkerJobPayloadToRecord(
  row: ReturnType<typeof mapWorkerJobPayloadRecordToPrisma>,
): WorkerJobPayloadRecord {
  return {
    jobId: row.jobId,
    kind: row.kind as WorkerJobPayloadRecord["kind"],
    projectId: row.projectId,
    commandId: undefinedFromNull(row.commandId),
    command: row.command,
    args: [...(row.args as string[])],
    envNames: canonicalEnvNames(row.envNames as string[]),
    workingDirectory: undefinedFromNull(row.workingDirectory),
    timeoutMs: row.timeoutMs,
    createdAt: row.createdAt,
  };
}

export function mapWorkerLogRecordToPrisma(record: WorkerLogRecord) {
  return {
    id: record.id,
    type: record.type,
    message: record.message,
    workerId: record.workerId ?? null,
    workerJobId: record.workerJobId ?? null,
    projectId: record.projectId ?? null,
    payload: sanitizeWorkerLogPayload(record.payload),
    createdAt: record.createdAt,
  };
}

export function mapPrismaWorkerLogToRecord(row: ReturnType<typeof mapWorkerLogRecordToPrisma>): WorkerLogRecord {
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    workerId: undefinedFromNull(row.workerId),
    workerJobId: undefinedFromNull(row.workerJobId),
    projectId: undefinedFromNull(row.projectId),
    payload: sanitizeWorkerLogPayload(row.payload as Record<string, unknown>),
    createdAt: row.createdAt,
  };
}
```

If current worker-runtime types use different names for `resultSummary`, `policy`, or `inputSummary`, adapt these mapper field names to the actual type names and update tests in the same step.

- [ ] **Step 5: Export mappers and run tests**

Add exports in `packages/db/src/index.ts`:

```ts
export * from "./prisma-worker-mappers";
```

Run:

```bash
pnpm --filter @lp-agent/db test -- prisma-worker-mappers.test.ts
pnpm --filter @lp-agent/db test -- prisma-schema-contract.test.ts
```

Expected: mapper tests and schema contract tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/db/package.json packages/db/src/index.ts packages/db/src/prisma-worker-mappers.ts packages/db/src/prisma-worker-mappers.test.ts
git commit -m "add prisma worker mappers"
```

## Task 4: Prisma Worker Repositories

**Files:**

- Create: `packages/db/src/prisma-worker-repositories.ts`
- Create: `packages/db/src/prisma-worker-repositories.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write fake Prisma delegate contract tests**

Create `packages/db/src/prisma-worker-repositories.test.ts`. Use in-memory fake delegates that implement the Prisma methods used by the adapter: `upsert`, `findUnique`, `findMany`, `updateMany`, `deleteMany`, `count`. The fake delegate must apply `where` filters narrowly enough to catch claim token and stale recovery mistakes.

```ts
import { describe, expect, it } from "vitest";
import {
  createContractWorkerJobPayloadRecord,
  createContractWorkerJobRecord,
  createContractWorkerLogRecord,
  runWorkerJobPayloadRepositoryContractTests,
  runWorkerJobRepositoryContractTests,
  runWorkerLogRepositoryContractTests,
} from "@lp-agent/worker-runtime";
import {
  createPrismaWorkerJobPayloadRepository,
  createPrismaWorkerJobRepository,
  createPrismaWorkerLogRepository,
} from "./prisma-worker-repositories";

function createFakeWorkerClient() {
  return {
    workerJob: createFakeDelegate("id"),
    workerJobPayload: createFakeDelegate("jobId"),
    workerLog: createFakeDelegate("id"),
  };
}

runWorkerJobRepositoryContractTests("fake-prisma", () => {
  const client = createFakeWorkerClient();
  return createPrismaWorkerJobRepository(client);
});

runWorkerJobPayloadRepositoryContractTests("fake-prisma", () => {
  const client = createFakeWorkerClient();
  return createPrismaWorkerJobPayloadRepository(client);
});

runWorkerLogRepositoryContractTests("fake-prisma", () => {
  const client = createFakeWorkerClient();
  return createPrismaWorkerLogRepository(client, { maxRecords: 2 });
});

describe("prisma worker repositories", () => {
  it("does not let a stale claim token complete a recovered job", async () => {
    const client = createFakeWorkerClient();
    const repository = createPrismaWorkerJobRepository(client);
    await repository.save(createContractWorkerJobRecord({ id: "job-1" }));
    await repository.claimOldestQueued({
      workerId: "worker-1",
      claimToken: "old-token",
      payloadSource: "safe_persisted",
      heartbeatExpiresAt: new Date("2026-05-20T00:01:00.000Z"),
      now: new Date("2026-05-20T00:00:00.000Z"),
    });
    await repository.recoverStale({
      now: new Date("2026-05-20T00:02:00.000Z"),
      maxRecoveries: 2,
    });

    await expect(repository.completeClaimed({
      jobId: "job-1",
      workerId: "worker-1",
      claimToken: "old-token",
      resultSummary: { exitCode: 0, outputSummary: "late" },
      completedAt: new Date("2026-05-20T00:03:00.000Z"),
    })).rejects.toThrow(/claim/i);
  });

  it("does not persist extra payload properties", async () => {
    const client = createFakeWorkerClient();
    const repository = createPrismaWorkerJobPayloadRepository(client);
    await repository.save({
      ...createContractWorkerJobPayloadRecord(),
      env: { DEPLOY_TOKEN: "secret-value" },
      rawStdout: "must not persist",
    } as never);

    const stored = await repository.getByJobId("worker-job-1");
    expect(JSON.stringify(stored)).not.toContain("secret-value");
    expect(JSON.stringify(stored)).not.toContain("rawStdout");
  });

  it("trims worker logs to the configured max records", async () => {
    const client = createFakeWorkerClient();
    const repository = createPrismaWorkerLogRepository(client, { maxRecords: 2 });
    await repository.append(createContractWorkerLogRecord({ id: "log-1", createdAt: new Date("2026-05-20T00:00:01.000Z") }));
    await repository.append(createContractWorkerLogRecord({ id: "log-2", createdAt: new Date("2026-05-20T00:00:02.000Z") }));
    await repository.append(createContractWorkerLogRecord({ id: "log-3", createdAt: new Date("2026-05-20T00:00:03.000Z") }));

    expect((await repository.list({ limit: 10 })).map((log) => log.id)).toEqual(["log-3", "log-2"]);
  });
});
```

Implement `createFakeDelegate(primaryKey)` inside the test file with a `Map<string, Record<string, unknown>>`. Its `updateMany` must update only rows matching every scalar condition in `where`. Its `findMany` must support `where`, `orderBy`, `take`, and simple `OR` clauses used by stale recovery.

- [ ] **Step 2: Run repository tests and verify they fail**

Run:

```bash
pnpm --filter @lp-agent/db test -- prisma-worker-repositories.test.ts
```

Expected: fail because `packages/db/src/prisma-worker-repositories.ts` does not exist.

- [ ] **Step 3: Implement Prisma worker repository adapters**

Create `packages/db/src/prisma-worker-repositories.ts`. Keep the client type structural so unit tests can inject fake delegates and production can pass a real Prisma client.

```ts
import type {
  WorkerJobPayloadRecord,
  WorkerJobPayloadRepository,
  WorkerJobRecord,
  WorkerJobRepository,
  WorkerLogRecord,
  WorkerLogRepository,
} from "@lp-agent/worker-runtime";
import {
  mapPrismaWorkerJobPayloadToRecord,
  mapPrismaWorkerJobToRecord,
  mapPrismaWorkerLogToRecord,
  mapWorkerJobPayloadRecordToPrisma,
  mapWorkerJobRecordToPrisma,
  mapWorkerLogRecordToPrisma,
} from "./prisma-worker-mappers";

export interface PrismaWorkerClient {
  workerJob: PrismaWorkerJobDelegate;
  workerJobPayload: PrismaWorkerJobPayloadDelegate;
  workerLog: PrismaWorkerLogDelegate;
}

interface PrismaWorkerJobDelegate {
  upsert(input: unknown): Promise<unknown>;
  findUnique(input: unknown): Promise<unknown | null>;
  findMany(input?: unknown): Promise<unknown[]>;
  updateMany(input: unknown): Promise<{ count: number }>;
}

interface PrismaWorkerJobPayloadDelegate {
  upsert(input: unknown): Promise<unknown>;
  findUnique(input: unknown): Promise<unknown | null>;
  deleteMany(input: unknown): Promise<{ count: number }>;
}

interface PrismaWorkerLogDelegate {
  upsert(input: unknown): Promise<unknown>;
  findMany(input?: unknown): Promise<unknown[]>;
  deleteMany(input: unknown): Promise<{ count: number }>;
}
```

Implement repository functions with these critical rules:

```ts
export function createPrismaWorkerJobRepository(client: PrismaWorkerClient): WorkerJobRepository {
  return {
    async save(record) {
      const data = mapWorkerJobRecordToPrisma(record);
      await client.workerJob.upsert({
        where: { id: record.id },
        create: data,
        update: data,
      });
    },

    async getById(id) {
      const row = await client.workerJob.findUnique({ where: { id } });
      return row ? mapPrismaWorkerJobToRecord(row as ReturnType<typeof mapWorkerJobRecordToPrisma>) : undefined;
    },

    async listForProject(projectId) {
      const rows = await client.workerJob.findMany({
        where: { projectId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return rows.map((row) => mapPrismaWorkerJobToRecord(row as ReturnType<typeof mapWorkerJobRecordToPrisma>));
    },

    async listAll() {
      const rows = await client.workerJob.findMany({
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return rows.map((row) => mapPrismaWorkerJobToRecord(row as ReturnType<typeof mapWorkerJobRecordToPrisma>));
    },

    async findOldestQueued() {
      const [row] = await client.workerJob.findMany({
        where: { state: "queued" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 1,
      });
      return row ? mapPrismaWorkerJobToRecord(row as ReturnType<typeof mapWorkerJobRecordToPrisma>) : undefined;
    },
  };
}
```

Then add methods required by the exact `WorkerJobRepository` interface. For methods that transition claimed jobs, use `updateMany` with scalar guards and then refetch:

```ts
const update = await client.workerJob.updateMany({
  where: {
    id: input.jobId,
    state: "running",
    claimToken: input.claimToken,
    claimedByWorkerId: input.workerId,
  },
  data: {
    state: "completed",
    resultSummary: input.resultSummary,
    completedAt: input.completedAt,
  },
});
if (update.count !== 1) {
  throw new Error("worker_job_claim_conflict");
}
```

For `claimOldestQueued`, loop over candidates ordered by `createdAt asc, id asc`, then use `updateMany` with `id`, `state: "queued"`, optional `projectId`, and payload source compatibility:

```ts
const rows = await client.workerJob.findMany({
  where: {
    state: "queued",
    ...(input.projectId ? { projectId: input.projectId } : {}),
  },
  orderBy: [{ createdAt: "asc" }, { id: "asc" }],
});
for (const row of rows) {
  const record = mapPrismaWorkerJobToRecord(row as ReturnType<typeof mapWorkerJobRecordToPrisma>);
  const source = record.payloadSource ?? "process_memory";
  if (source !== input.payloadSource) {
    continue;
  }
  const update = await client.workerJob.updateMany({
    where: { id: record.id, state: "queued", ...(input.projectId ? { projectId: input.projectId } : {}) },
    data: {
      state: "running",
      startedAt: input.now,
      claimedByWorkerId: input.workerId,
      claimToken: input.claimToken,
      lastHeartbeatAt: input.now,
      heartbeatExpiresAt: input.heartbeatExpiresAt,
    },
  });
  if (update.count === 1) {
    return this.getById(record.id);
  }
}
return undefined;
```

Do not use `this` from an object literal if the codebase avoids it; capture `getById` in a local helper instead.

For `createPrismaWorkerJobPayloadRepository`, persist only mapped safe fields and make delete idempotent:

```ts
export function createPrismaWorkerJobPayloadRepository(client: PrismaWorkerClient): WorkerJobPayloadRepository {
  return {
    async save(record) {
      const data = mapWorkerJobPayloadRecordToPrisma(record);
      await client.workerJobPayload.upsert({
        where: { jobId: record.jobId },
        create: data,
        update: data,
      });
    },
    async getByJobId(jobId) {
      const row = await client.workerJobPayload.findUnique({ where: { jobId } });
      return row ? mapPrismaWorkerJobPayloadToRecord(row as ReturnType<typeof mapWorkerJobPayloadRecordToPrisma>) : undefined;
    },
    async deleteByJobId(jobId) {
      await client.workerJobPayload.deleteMany({ where: { jobId } });
    },
  };
}
```

For `createPrismaWorkerLogRepository`, sanitize through mapper, sort newest first, and trim after append:

```ts
export function createPrismaWorkerLogRepository(
  client: PrismaWorkerClient,
  options: { maxRecords?: number } = {},
): WorkerLogRepository {
  const maxRecords = options.maxRecords ?? 500;
  return {
    async append(record) {
      const data = mapWorkerLogRecordToPrisma(record);
      await client.workerLog.upsert({ where: { id: record.id }, create: data, update: data });
      const rows = await client.workerLog.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      const excess = rows.slice(maxRecords);
      if (excess.length > 0) {
        await client.workerLog.deleteMany({ where: { id: { in: excess.map((row) => (row as { id: string }).id) } } });
      }
      return mapPrismaWorkerLogToRecord(data);
    },
    async list(input = {}) {
      const rows = await client.workerLog.findMany({
        where: {
          ...(input.projectId ? { projectId: input.projectId } : {}),
          ...(input.workerId ? { workerId: input.workerId } : {}),
          ...(input.workerJobId ? { workerJobId: input.workerJobId } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit,
      });
      return rows.map((row) => mapPrismaWorkerLogToRecord(row as ReturnType<typeof mapWorkerLogRecordToPrisma>));
    },
  };
}
```

Adapt method names and input shapes to the exact repository interfaces. Keep all claim/heartbeat/complete updates conditional on claim token and running state.

- [ ] **Step 4: Export repositories and run tests**

Add to `packages/db/src/index.ts`:

```ts
export * from "./prisma-worker-repositories";
```

Run:

```bash
pnpm --filter @lp-agent/db test -- prisma-worker-mappers.test.ts prisma-worker-repositories.test.ts
pnpm --filter @lp-agent/worker-runtime test
```

Expected: db mapper/repository tests and worker-runtime contracts pass.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/index.ts packages/db/src/prisma-worker-repositories.ts packages/db/src/prisma-worker-repositories.test.ts
git commit -m "add prisma worker repositories"
```

## Task 5: Opt-in Postgres Integration Coverage

**Files:**

- Create: `packages/db/src/prisma-worker-repositories.integration.test.ts`

- [ ] **Step 1: Write gated integration test**

Create an integration test that skips unless both `POSTGRES_WORKER_REPOSITORY_TEST=1` and `DATABASE_URL` are set.

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter,
} from "@lp-agent/worker-runtime";
import {
  createPrismaClient,
  createPrismaWorkerJobPayloadRepository,
  createPrismaWorkerJobRepository,
  createPrismaWorkerLogRepository,
} from "./index";

const runIntegration = process.env.POSTGRES_WORKER_REPOSITORY_TEST === "1" && process.env.DATABASE_URL;
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration("prisma worker repositories integration", () => {
  const prisma = createPrismaClient();

  beforeEach(async () => {
    await prisma.workerLog.deleteMany({});
    await prisma.workerJobPayload.deleteMany({});
    await prisma.workerJob.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("runs a safe persisted worker job through postgres repositories", async () => {
    const jobRepository = createPrismaWorkerJobRepository(prisma);
    const payloadRepository = createPrismaWorkerJobPayloadRepository(prisma);
    const logRepository = createPrismaWorkerLogRepository(prisma, { maxRecords: 50 });
    const runtime = new InMemoryWorkerRuntime({
      repository: jobRepository,
      payloadRepository,
      logRepository,
      adapter: new SimulatedExecutionAdapter(),
    });

    const queued = await runtime.enqueueSafe({
      projectId: "project-postgres-worker",
      commandId: "deploy-preview",
      command: "deploy preview",
      args: ["--preview"],
      envNames: ["DEPLOY_TOKEN"],
      workingDirectory: "workspace",
      timeoutMs: 30_000,
      policy: { sandbox: "none" },
    });

    const claimed = await runtime.claimOldestQueued({
      workerId: "worker-postgres",
      claimToken: "claim-postgres",
      payloadSource: "safe_persisted",
    });
    expect(claimed?.id).toBe(queued.id);

    const completed = await runtime.runClaimedJob({
      jobId: queued.id,
      workerId: "worker-postgres",
      claimToken: "claim-postgres",
    });

    expect(completed.state).toBe("completed");
    expect(await payloadRepository.getByJobId(queued.id)).toBeUndefined();
    expect((await logRepository.list({ projectId: "project-postgres-worker", limit: 10 })).length).toBeGreaterThan(0);
  });
});
```

Adapt `createPrismaClient()` to the existing db package client creation helper. If the current db package only has `getPrismaClient()` or a dynamic loader helper, use that existing API.

- [ ] **Step 2: Run skipped-path test**

Run without integration env:

```bash
pnpm --filter @lp-agent/db test -- prisma-worker-repositories.integration.test.ts
```

Expected: test file passes with the integration suite skipped.

- [ ] **Step 3: Document the opt-in real Postgres command in the test comments**

At the top of the integration test, include this comment:

```ts
// Opt-in real Postgres verification:
// POSTGRES_WORKER_REPOSITORY_TEST=1 DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm exec vitest run packages/db/src/prisma-worker-repositories.integration.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/prisma-worker-repositories.integration.test.ts
git commit -m "add worker postgres integration coverage"
```

## Task 6: Shared Worker Queue Backend Factory

**Files:**

- Create: `packages/api/src/worker-queue-repository-factory.ts`
- Create: `packages/api/src/worker-queue-repository-factory.test.ts`
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/skill-command-worker-queue.ts`

- [ ] **Step 1: Write backend selection tests**

Create `packages/api/src/worker-queue-repository-factory.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  createWorkerQueueRuntime,
  resolveWorkerRepositoryBackend,
} from "./worker-queue-repository-factory";

describe("worker queue repository factory", () => {
  it("defaults to json backend", () => {
    expect(resolveWorkerRepositoryBackend({})).toBe("json");
    expect(resolveWorkerRepositoryBackend({ WORKER_REPOSITORY_BACKEND: "json" })).toBe("json");
  });

  it("accepts memory and postgres backend values", () => {
    expect(resolveWorkerRepositoryBackend({ WORKER_REPOSITORY_BACKEND: "memory" })).toBe("memory");
    expect(resolveWorkerRepositoryBackend({ WORKER_REPOSITORY_BACKEND: "postgres" })).toBe("postgres");
  });

  it("fails closed for unsupported backend values", () => {
    expect(() => resolveWorkerRepositoryBackend({ WORKER_REPOSITORY_BACKEND: "sqlite" })).toThrow(
      /Unsupported WORKER_REPOSITORY_BACKEND/,
    );
  });

  it("creates a memory runtime without file paths", async () => {
    const runtime = await createWorkerQueueRuntime({
      env: { WORKER_REPOSITORY_BACKEND: "memory" },
    });
    const queued = await runtime.enqueueSafe({
      projectId: "project-1",
      commandId: "deploy-preview",
      command: "deploy preview",
      args: [],
      envNames: [],
      timeoutMs: 30_000,
      policy: { sandbox: "none" },
    });
    expect(queued.state).toBe("queued");
  });

  it("fails closed for postgres without DATABASE_URL", async () => {
    await expect(createWorkerQueueRuntime({
      env: { WORKER_REPOSITORY_BACKEND: "postgres" },
      loadPrismaClient: vi.fn(),
    })).rejects.toThrow(/DATABASE_URL/);
  });

  it("uses injected postgres repositories without loading generated client in unit tests", async () => {
    const createPrismaWorkerRepositories = vi.fn(() => ({
      jobRepository: new InMemoryWorkerJobRepository(),
      payloadRepository: new InMemoryWorkerJobPayloadRepository(),
      logRepository: new InMemoryWorkerLogRepository(),
    }));

    const runtime = await createWorkerQueueRuntime({
      env: {
        WORKER_REPOSITORY_BACKEND: "postgres",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/lp_agent",
      },
      loadPrismaClient: async () => ({ prisma: true }),
      createPrismaWorkerRepositories,
    });

    expect(createPrismaWorkerRepositories).toHaveBeenCalledWith({ prisma: true });
    expect((await runtime.createWorkerQueueSnapshot()).counts.queued).toBe(0);
  });
});
```

Import `InMemoryWorkerJobRepository`, `InMemoryWorkerJobPayloadRepository`, and `InMemoryWorkerLogRepository` from `@lp-agent/worker-runtime`. If the runtime object does not expose `createWorkerQueueSnapshot()`, assert on `runtime.repository` or use the existing API returned by `createLocalWorkerQueueRuntime`.

- [ ] **Step 2: Run factory tests and verify they fail**

Run:

```bash
pnpm --filter @lp-agent/api test -- worker-queue-repository-factory.test.ts
```

Expected: fail because the factory file does not exist.

- [ ] **Step 3: Implement backend resolver and runtime factory**

Create `packages/api/src/worker-queue-repository-factory.ts`:

```ts
import {
  InMemoryWorkerJobPayloadRepository,
  InMemoryWorkerJobRepository,
  InMemoryWorkerLogRepository,
  InMemoryWorkerRuntime,
  JsonFileWorkerJobPayloadRepository,
  JsonFileWorkerJobRepository,
  JsonFileWorkerLogRepository,
  SimulatedExecutionAdapter,
} from "@lp-agent/worker-runtime";
import type {
  WorkerJobPayloadRepository,
  WorkerJobRepository,
  WorkerLogRepository,
} from "@lp-agent/worker-runtime";
import { createLocalWorkerQueueRuntime } from "./skill-command-worker-queue";

export type WorkerRepositoryBackend = "json" | "memory" | "postgres";

export interface WorkerQueueRuntimeRepositories {
  jobRepository: WorkerJobRepository;
  payloadRepository: WorkerJobPayloadRepository;
  logRepository?: WorkerLogRepository;
}

export interface CreateWorkerQueueRuntimeOptions {
  env?: Partial<Record<string, string | undefined>>;
  loadPrismaClient?: () => Promise<unknown>;
  createPrismaWorkerRepositories?: (client: unknown) => WorkerQueueRuntimeRepositories;
}

export function resolveWorkerRepositoryBackend(env: Partial<Record<string, string | undefined>>): WorkerRepositoryBackend {
  const value = env.WORKER_REPOSITORY_BACKEND ?? "json";
  if (value === "json" || value === "memory" || value === "postgres") {
    return value;
  }
  throw new Error(`Unsupported WORKER_REPOSITORY_BACKEND: ${value}`);
}
```

Then implement runtime creation:

```ts
export async function createWorkerQueueRuntime(options: CreateWorkerQueueRuntimeOptions = {}) {
  const env = options.env ?? process.env;
  const backend = resolveWorkerRepositoryBackend(env);

  if (backend === "json") {
    return createLocalWorkerQueueRuntime({
      jobsFilePath: env.WORKER_JOBS_FILE ?? ".lp-agent/worker-jobs.json",
      payloadsFilePath: env.WORKER_PAYLOADS_FILE ?? ".lp-agent/worker-payloads.json",
      logsFilePath: env.WORKER_LOGS_FILE,
    });
  }

  if (backend === "memory") {
    return new InMemoryWorkerRuntime({
      repository: new InMemoryWorkerJobRepository(),
      payloadRepository: new InMemoryWorkerJobPayloadRepository(),
      logRepository: new InMemoryWorkerLogRepository(),
      adapter: new SimulatedExecutionAdapter(),
    });
  }

  if (!env.DATABASE_URL) {
    throw new Error("WORKER_REPOSITORY_BACKEND=postgres requires DATABASE_URL");
  }

  const client = await (options.loadPrismaClient ?? loadDefaultPrismaClient)();
  const repositories = (options.createPrismaWorkerRepositories ?? createDefaultPrismaWorkerRepositories)(client);
  return new InMemoryWorkerRuntime({
    repository: repositories.jobRepository,
    payloadRepository: repositories.payloadRepository,
    logRepository: repositories.logRepository,
    adapter: new SimulatedExecutionAdapter(),
  });
}
```

Add dynamic default loaders at the bottom:

```ts
let cachedPrismaClient: unknown;

async function loadDefaultPrismaClient(): Promise<unknown> {
  if (!cachedPrismaClient) {
    const db = await import("@lp-agent/db");
    cachedPrismaClient = db.createPrismaClient();
  }
  return cachedPrismaClient;
}

function createDefaultPrismaWorkerRepositories(client: unknown): WorkerQueueRuntimeRepositories {
  const db = require("@lp-agent/db") as typeof import("@lp-agent/db");
  return {
    jobRepository: db.createPrismaWorkerJobRepository(client as never),
    payloadRepository: db.createPrismaWorkerJobPayloadRepository(client as never),
    logRepository: db.createPrismaWorkerLogRepository(client as never),
  };
}
```

If the repo is ESM-only and `require` is not allowed, replace the sync default factory with an async path:

```ts
const db = await import("@lp-agent/db");
return new InMemoryWorkerRuntime({
  repository: db.createPrismaWorkerJobRepository(client as never),
  payloadRepository: db.createPrismaWorkerJobPayloadRepository(client as never),
  logRepository: db.createPrismaWorkerLogRepository(client as never),
  adapter: new SimulatedExecutionAdapter(),
});
```

Keep generated Prisma import inside these functions so default JSON tests do not load `@prisma/client`.

- [ ] **Step 4: Export factory and run tests**

In `packages/api/src/index.ts`:

```ts
export * from "./worker-queue-repository-factory";
```

Run:

```bash
pnpm --filter @lp-agent/api test -- worker-queue-repository-factory.test.ts
```

Expected: backend resolver and injected postgres factory tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/index.ts packages/api/src/worker-queue-repository-factory.ts packages/api/src/worker-queue-repository-factory.test.ts packages/api/src/skill-command-worker-queue.ts
git commit -m "add worker queue backend factory"
```

## Task 7: Wire Web Worker Queue Backend Selection

**Files:**

- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`
- Modify: `apps/web/src/app/actions.test.ts`
- Modify: `apps/web/src/app/page.test.ts`

- [ ] **Step 1: Write Web store tests for worker backend selection**

In `apps/web/src/lib/workbench-store.test.ts`, add cases around `createDefaultWebWorkbenchStore()` or the current exported store initializer:

```ts
it("creates default web store with memory worker queue backend when configured", async () => {
  const store = await createDefaultWebWorkbenchStore({
    env: {
      WORKBENCH_REPOSITORY_BACKEND: "memory",
      WORKER_REPOSITORY_BACKEND: "memory",
    },
  });

  const service = store.service;
  const result = await service.submitTask({
    projectId: "project-1",
    prompt: "Deploy this generated LP preview",
    locale: "en",
  });

  expect(result.workerJob?.state).toBe("queued");
});

it("fails closed when web worker postgres backend is missing DATABASE_URL", async () => {
  await expect(createDefaultWebWorkbenchStore({
    env: {
      WORKBENCH_REPOSITORY_BACKEND: "memory",
      WORKER_REPOSITORY_BACKEND: "postgres",
    },
  })).rejects.toThrow(/DATABASE_URL/);
});
```

Adapt the task submission helper to the existing service API. Keep the assertion tied to a queued worker job or worker queue snapshot already exposed by the store.

- [ ] **Step 2: Run targeted Web store tests and verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts
```

Expected: fail because Web store still constructs JSON worker queue directly and does not accept or pass worker backend env injection.

- [ ] **Step 3: Use the shared async worker queue factory**

In `apps/web/src/lib/workbench-store.ts`, replace direct `createLocalWorkerQueueRuntime({ jobsFilePath, payloadsFilePath, logsFilePath })` construction with:

```ts
import { createWorkerQueueRuntime } from "@lp-agent/api";
```

Inside the async store initializer:

```ts
const workerQueueRuntime = await createWorkerQueueRuntime({ env });
```

If `env` is not currently accepted by the initializer, add an optional `env?: Partial<Record<string, string | undefined>>` to the same options object used by Stage 23 backend tests. Preserve rejected Promise cache cleanup for failed async initialization.

- [ ] **Step 4: Run targeted Web tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts
```

Expected: Web store, server action, and page tests pass with default JSON behavior and memory worker backend injection.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts
git commit -m "wire web worker queue backend selection"
```

## Task 8: Wire Agent Worker Backend Selection

**Files:**

- Create: `apps/agent-worker/src/config.ts`
- Create: `apps/agent-worker/src/config.test.ts`
- Modify: `apps/agent-worker/src/index.ts`
- Modify: `apps/agent-worker/src/worker.test.ts`

- [ ] **Step 1: Write config tests for demo fallback and explicit backends**

Create `apps/agent-worker/src/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveAgentWorkerMode } from "./config";

describe("agent worker config", () => {
  it("keeps demo mode when no worker queue backend or files are configured", () => {
    expect(resolveAgentWorkerMode({})).toEqual({ mode: "demo" });
  });

  it("runs queue mode for legacy json file configuration", () => {
    expect(resolveAgentWorkerMode({
      WORKER_JOBS_FILE: ".lp-agent/worker-jobs.json",
      WORKER_PAYLOADS_FILE: ".lp-agent/worker-payloads.json",
    })).toEqual({ mode: "queue" });
  });

  it("runs queue mode for explicit postgres backend without json file paths", () => {
    expect(resolveAgentWorkerMode({
      WORKER_REPOSITORY_BACKEND: "postgres",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/lp_agent",
    })).toEqual({ mode: "queue" });
  });

  it("runs queue mode for explicit memory backend without json file paths", () => {
    expect(resolveAgentWorkerMode({ WORKER_REPOSITORY_BACKEND: "memory" })).toEqual({ mode: "queue" });
  });

  it("fails closed for partial legacy json file configuration", () => {
    expect(() => resolveAgentWorkerMode({
      WORKER_JOBS_FILE: ".lp-agent/worker-jobs.json",
    })).toThrow(/WORKER_PAYLOADS_FILE/);
  });
});
```

- [ ] **Step 2: Run config tests and verify they fail**

Run:

```bash
pnpm --filter @lp-agent/agent-worker test -- config.test.ts
```

Expected: fail because config helper does not exist.

- [ ] **Step 3: Implement config helper**

Create `apps/agent-worker/src/config.ts`:

```ts
export type AgentWorkerMode = { mode: "demo" } | { mode: "queue" };

export function resolveAgentWorkerMode(env: Partial<Record<string, string | undefined>>): AgentWorkerMode {
  if (env.WORKER_REPOSITORY_BACKEND) {
    return { mode: "queue" };
  }

  const hasJobsFile = Boolean(env.WORKER_JOBS_FILE);
  const hasPayloadsFile = Boolean(env.WORKER_PAYLOADS_FILE);
  if (hasJobsFile && hasPayloadsFile) {
    return { mode: "queue" };
  }
  if (hasJobsFile && !hasPayloadsFile) {
    throw new Error("WORKER_PAYLOADS_FILE is required when WORKER_JOBS_FILE is set");
  }
  if (!hasJobsFile && hasPayloadsFile) {
    throw new Error("WORKER_JOBS_FILE is required when WORKER_PAYLOADS_FILE is set");
  }
  return { mode: "demo" };
}
```

- [ ] **Step 4: Wire `apps/agent-worker/src/index.ts` to shared factory**

Replace direct JSON repository construction with:

```ts
import { createWorkerQueueRuntime } from "@lp-agent/api";
import { resolveAgentWorkerMode } from "./config";
```

At startup:

```ts
const mode = resolveAgentWorkerMode(process.env);
if (mode.mode === "demo") {
  await runDemo();
} else {
  const runtime = await createWorkerQueueRuntime({ env: process.env });
  await runWorkerFromRuntime(runtime, process.env);
}
```

Keep existing run-once / daemon selection behavior. Preserve optional workbench finalizer wiring through `LP_AGENT_WORKBENCH_STATE_FILE`; Stage 24 only changes worker queue repository selection.

- [ ] **Step 5: Add worker run-once coverage for explicit postgres backend injection**

In `apps/agent-worker/src/worker.test.ts`, add a test that calls the exported run helper with a runtime created from injected memory repositories while env says postgres:

```ts
it("does not require worker json files for explicit postgres backend", async () => {
  const runtime = await createWorkerQueueRuntime({
    env: {
      WORKER_REPOSITORY_BACKEND: "postgres",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/lp_agent",
    },
    loadPrismaClient: async () => ({ prisma: true }),
    createPrismaWorkerRepositories: () => ({
      jobRepository: new InMemoryWorkerJobRepository(),
      payloadRepository: new InMemoryWorkerJobPayloadRepository(),
      logRepository: new InMemoryWorkerLogRepository(),
    }),
  });

  const queued = await runtime.enqueueSafe({
    projectId: "project-1",
    commandId: "deploy-preview",
    command: "deploy preview",
    args: [],
    envNames: [],
    timeoutMs: 30_000,
    policy: { sandbox: "none" },
  });

  const result = await runWorkerOnce({ runtime, workerId: "worker-1" });
  expect(result.jobId).toBe(queued.id);
});
```

Adapt imports and `runWorkerOnce` input shape to the current `apps/agent-worker/src/index.ts` exports. If top-level script exports are awkward, move run helpers into a small testable module without changing behavior.

- [ ] **Step 6: Run agent-worker tests**

Run:

```bash
pnpm --filter @lp-agent/agent-worker test
```

Expected: config and worker tests pass; demo fallback remains covered.

- [ ] **Step 7: Commit**

```bash
git add apps/agent-worker/src/config.ts apps/agent-worker/src/config.test.ts apps/agent-worker/src/index.ts apps/agent-worker/src/worker.test.ts
git commit -m "wire agent worker queue backend selection"
```

## Task 9: Cross-process Worker Queue Regression

**Files:**

- Modify: `packages/api/src/worker-queue-repository-factory.test.ts`
- Modify: `apps/agent-worker/src/worker.test.ts`

- [ ] **Step 1: Add regression for shared backend selection across enqueue and run**

Add a test that builds two runtimes from the same injected repository instances to simulate Web enqueue and agent-worker claim/run:

```ts
it("lets web enqueue and worker run through the same postgres repository set", async () => {
  const repositories = {
    jobRepository: new InMemoryWorkerJobRepository(),
    payloadRepository: new InMemoryWorkerJobPayloadRepository(),
    logRepository: new InMemoryWorkerLogRepository(),
  };
  const options = {
    env: {
      WORKER_REPOSITORY_BACKEND: "postgres",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/lp_agent",
    },
    loadPrismaClient: async () => ({ prisma: true }),
    createPrismaWorkerRepositories: () => repositories,
  };

  const webRuntime = await createWorkerQueueRuntime(options);
  const workerRuntime = await createWorkerQueueRuntime(options);

  const queued = await webRuntime.enqueueSafe({
    projectId: "project-1",
    commandId: "deploy-preview",
    command: "deploy preview",
    args: ["--preview"],
    envNames: ["DEPLOY_TOKEN"],
    timeoutMs: 30_000,
    policy: { sandbox: "none" },
  });
  const claimed = await workerRuntime.claimOldestQueued({
    workerId: "worker-1",
    claimToken: "claim-token-1",
    payloadSource: "safe_persisted",
  });
  expect(claimed?.id).toBe(queued.id);

  const completed = await workerRuntime.runClaimedJob({
    jobId: queued.id,
    workerId: "worker-1",
    claimToken: "claim-token-1",
  });
  expect(completed.state).toBe("completed");
  expect(await repositories.payloadRepository.getByJobId(queued.id)).toBeUndefined();
});
```

- [ ] **Step 2: Run regression tests**

Run:

```bash
pnpm --filter @lp-agent/api test -- worker-queue-repository-factory.test.ts
pnpm --filter @lp-agent/agent-worker test -- worker.test.ts
```

Expected: shared backend regression passes in both API and agent-worker coverage.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/worker-queue-repository-factory.test.ts apps/agent-worker/src/worker.test.ts
git commit -m "cover worker postgres queue flow"
```

## Task 10: Documentation and Roadmap

**Files:**

- Modify: `README.md`
- Modify: `docs/development.md`
- Modify: `docs/project-roadmap.md`
- Modify: `docs/agent-development-learning.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Update README worker backend entry**

Add a short opt-in section near existing Postgres backend documentation:

````md
### Optional worker queue Postgres backend

The worker queue defaults to local JSON files. To run worker jobs, safe persisted worker payloads, and bounded worker lifecycle logs against Postgres, set:

```bash
WORKER_REPOSITORY_BACKEND=postgres \
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" \
pnpm dev
```

Start the worker with the same `WORKER_REPOSITORY_BACKEND` and `DATABASE_URL`. In `postgres` mode, `WORKER_JOBS_FILE` and `WORKER_PAYLOADS_FILE` are not required. The backend fails closed if `DATABASE_URL` is missing or the Prisma client cannot initialize.
````

- [ ] **Step 2: Update development docs**

In `docs/development.md`, add:

```md
## Worker Queue Repository Backend

`WORKER_REPOSITORY_BACKEND` controls only worker queue storage:

- unset or `json`: use `.lp-agent/worker-jobs.json`, `.lp-agent/worker-payloads.json`, and `.lp-agent/worker-logs.json`.
- `memory`: process-local test backend.
- `postgres`: use Prisma-backed worker job, safe payload, and lifecycle log repositories.

`WORKER_REPOSITORY_BACKEND=postgres` requires `DATABASE_URL`. It does not require `WORKER_JOBS_FILE` or `WORKER_PAYLOADS_FILE`.

Worker payload safety does not change in Postgres mode. The payload repository stores only safe simulated command payload fields: command id, command summary, bounded args, canonical env names, optional working directory, timeout, project id, job id, kind, and created time. It never stores env values, secrets, raw stdout/stderr, full artifact content, or arbitrary shell execution payloads.
```

- [ ] **Step 3: Update roadmap status**

In `docs/project-roadmap.md`, after implementation lands:

```md
### Stage 24：Worker Job Postgres Backend v0

**状态：** 已实现。
```

Add implemented scope bullets:

```md
- `WORKER_REPOSITORY_BACKEND=json|memory|postgres` worker queue backend factory。
- Prisma-backed worker job、safe persisted payload 和 bounded worker lifecycle log repositories。
- Web enqueue 与 `apps/agent-worker` claim/run 使用同一 backend selection helper。
- 默认 JSON-file worker queue 保持不变。
```

Keep Stage 25 as the recommended next phase and keep Stage 26 after it.

- [ ] **Step 4: Update Agent learning notes**

In `docs/agent-development-learning.md`, update the Stage 24 section from design-confirmed to implemented after code lands:

```md
已实现的 Stage 24 Worker Job Postgres Backend v0：

- [2026-05-20-worker-job-postgres-backend-design.md](./superpowers/specs/2026-05-20-worker-job-postgres-backend-design.md)
- 当前实现计划：[2026-05-20-worker-job-postgres-backend.md](./superpowers/plans/2026-05-20-worker-job-postgres-backend.md)
- worker queue backend selection 现在是独立 runtime boundary：`WORKER_REPOSITORY_BACKEND=postgres` 只迁移 worker job/payload/log，不强制切换 workbench state backend。
- durable worker queue 的关键不是把 JSON 换成 SQL，而是保持 claim token 条件更新、heartbeat、stale recovery、payload cleanup 和 bounded log sanitizer 的语义不变。
- safe persisted payload 进入 Postgres 后仍不是 raw execution transcript。它只能支持当前 safe simulated worker job 恢复，不能保存 secret、env values、raw stdout/stderr、artifact content 或任意 shell payload。
```

- [ ] **Step 5: Update Superpowers README**

Add this plan after the Stage 24 design entry:

```md
77. `plans/2026-05-20-worker-job-postgres-backend.md`
   - Stage 24 Worker Job Postgres Backend v0 implementation plan。
   - 在 Stage 24 design 后阅读，用于按 TDD 实现 Prisma worker job/payload/log schema、shared repository contracts、Prisma adapters、shared worker queue backend factory、Web/agent-worker opt-in wiring、integration coverage 和文档收尾。
```

- [ ] **Step 6: Run documentation checks**

Run:

```bash
rg -n "2026-05-20-worker-job-postgres-backend" docs/superpowers/README.md docs/project-roadmap.md docs/agent-development-learning.md README.md docs/development.md
rg -n "WORKER_REPOSITORY_BACKEND|POSTGRES_WORKER_REPOSITORY_TEST|WorkerJobPayload" docs/superpowers/plans/2026-05-20-worker-job-postgres-backend.md README.md docs/development.md docs/project-roadmap.md docs/agent-development-learning.md
```

Expected: all new plan/spec/doc references are present, and worker backend env names appear in roadmap and development docs.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/development.md docs/project-roadmap.md docs/agent-development-learning.md docs/superpowers/README.md
git commit -m "document worker postgres backend opt in"
```

## Task 11: Final Verification

**Files:**

- No new files.

- [ ] **Step 1: Run package tests**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
pnpm --filter @lp-agent/db test
pnpm --filter @lp-agent/api test
pnpm --filter @lp-agent/agent-worker test
```

Expected: all tests pass. The real Postgres integration test remains skipped unless opt-in env vars are set.

- [ ] **Step 2: Run targeted Web tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts
```

Expected: targeted Web tests pass with default JSON behavior and worker backend selection coverage.

- [ ] **Step 3: Validate Prisma schema**

Run:

```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm --filter @lp-agent/db db:validate
```

Expected: Prisma schema is valid. This command validates schema shape and does not require a reachable Postgres server.

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: TypeScript checks pass across all workspace packages/apps.

- [ ] **Step 5: Run optional real Postgres integration if a database is available**

Run only when a local Postgres database is available:

```bash
POSTGRES_WORKER_REPOSITORY_TEST=1 DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm exec vitest run packages/db/src/prisma-worker-repositories.integration.test.ts
```

Expected: enqueue, claim, heartbeat/run, payload cleanup, and log listing pass against real Postgres.

- [ ] **Step 6: Inspect final worktree**

Run:

```bash
git status --short --branch
git log --oneline -5
```

Expected: branch contains the Stage 24 commits, worktree has only intentional changes, and no unrelated user changes were reverted.

- [ ] **Step 7: Confirm roadmap queue is not empty**

Run:

```bash
rg -n "Stage 25|Stage 26|推荐下一阶段队列" docs/project-roadmap.md
```

Expected: Stage 25 and Stage 26 remain visible after Stage 24.

## Acceptance Checklist

- [ ] Default unset `WORKER_REPOSITORY_BACKEND` keeps Web and `apps/agent-worker` on JSON-file worker queue.
- [ ] `WORKER_REPOSITORY_BACKEND=postgres` without `DATABASE_URL` fails closed.
- [ ] Web enqueue and `apps/agent-worker` claim/run can use the same Postgres-backed job/payload/log repository set.
- [ ] Prisma worker job repository preserves claim token conditional updates and stale recovery semantics.
- [ ] Prisma worker payload repository stores only safe payload fields and canonical env names.
- [ ] Prisma worker log repository stores bounded sanitized lifecycle logs.
- [ ] Existing worker-runtime, agent-worker, and Web queue behavior remains covered.
- [ ] Prisma schema validation, package tests, targeted Web tests, and typecheck pass.
- [ ] Roadmap, Superpowers index, and Agent learning notes reflect Stage 24 implementation facts and next-stage priority.
