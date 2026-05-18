# Web Worker Queue Integration v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local Web worker queue loop where approved queueable deployment skill commands enqueue safe worker jobs, the Web workbench can run one local worker pass, and completed worker jobs finalize back into run/tool timeline state.

**Architecture:** Keep the existing synchronous `executeProjectSkillCommand()` path for compatibility, and add an explicit queued path for the Web skill command action. API owns skill command validation, safe worker enqueueing, `worker.job.linked` events, and idempotent worker finalization. Web owns local queue configuration, a `Run local worker once` server action, localized controls, and timeline rendering.

**Tech Stack:** pnpm workspace, TypeScript, Vitest, Next.js server actions, `@lp-agent/api`, `@lp-agent/db`, `@lp-agent/worker-runtime`, JSON-file repositories.

---

## Scope Guard

This plan implements only `docs/superpowers/specs/2026-05-18-web-worker-queue-integration-design.md`.

It must not add:

- worker daemon polling;
- background processes started by the Web server;
- real shell execution;
- `child_process`, `spawn`, `exec`, shell parsing, shell signals, process killing, pipes, redirects, or arbitrary shell strings;
- MCP execution;
- real deployment adapters;
- streaming stdout/stderr or token streaming;
- retry/resume controls;
- worker heartbeat, lease renewal, or stale worker recovery;
- persisted raw env values, secret values, cookies, API keys, full artifact content, or ephemeral artifact workspace paths in worker payloads.

The first queue path supports only safe simulated worker payloads for queueable deployment skill commands.

## File Structure

- Modify: `packages/db/src/workbench-repositories.ts`
  - Extend `ToolObservationState` to include `running` and `cancelled`.
- Modify: `packages/db/src/workbench-repositories.test.ts`
  - Cover in-memory observation persistence for `running` and `cancelled`.
- Modify: `packages/db/src/json-file-workbench-repositories.test.ts`
  - Cover JSON-file observation persistence for `running` and `cancelled`.
- Create: `packages/api/src/skill-command-worker-queue.ts`
  - Own safe queue runtime interfaces, queueable command assertions, worker finalizer, and one-job local worker runner.
- Create: `packages/api/src/skill-command-worker-queue.test.ts`
  - Cover finalization, idempotency, safety, cancellation, missing runtime, and stale terminal behavior.
- Modify: `packages/api/src/index.ts`
  - Export queue types/helpers, add `workerQueueRuntime` option, add `enqueueProjectSkillCommand()`, and wire queueable validation to existing skill command validation flow.
- Modify: `packages/api/package.json`
  - Include the new API test file.
- Modify: `apps/web/src/lib/workbench-store.ts`
  - Add local worker queue options, queued skill command execution, `runLocalWorkerOnce()`, worker queue state, and new stable error codes.
- Modify: `apps/web/src/lib/workbench-store.test.ts`
  - Cover queued skill command behavior, worker once behavior, and error mapping.
- Modify: `apps/web/package.json`
  - Add `@lp-agent/worker-runtime` for Web-side worker queue tests.
- Modify: `apps/web/src/app/actions.ts`
  - Add `runLocalWorkerOnceAction()` and keep skill command action browser inputs bounded.
- Modify: `apps/web/src/app/actions.test.ts`
  - Cover skill command enqueue redirect and worker once action redirects/errors.
- Modify: `apps/web/src/lib/i18n.ts`
  - Add queue labels, worker button labels, worker errors, and queued/cancelled command copy in English and Chinese.
- Modify: `apps/web/src/lib/i18n.test.ts`
  - Cover new localized labels.
- Modify: `apps/web/src/lib/chat-workbench.ts`
  - Render `worker.job.linked`, queued/running/cancelled worker states, and terminal finalizer events with existing statuses.
- Modify: `apps/web/src/lib/chat-workbench.test.ts`
  - Cover queued, running, completed, failed, and cancelled worker-backed skill command timeline rows.
- Modify: `apps/web/src/app/page.tsx`
  - Update Skills command copy from simulation to queue wording and add a local worker panel/form.
- Modify: `apps/web/src/app/page.test.ts`
  - Cover queue copy, local worker form, disabled/no-job state, and localized worker errors.
- Modify: `apps/web/src/app/globals.css`
  - Add small styling for the local worker panel and queued worker process rows.
- Modify: `.env.example`
  - Add local worker queue file path variables.
- Modify: `docs/agent-development-learning.md`
  - Update Stage 13 current plan and implementation status after code is complete.
- Modify: `docs/superpowers/README.md`
  - Add this plan immediately after the Stage 13 spec.

## Task 1: Extend Tool Observation States

**Files:**

- Modify: `packages/db/src/workbench-repositories.ts`
- Modify: `packages/db/src/workbench-repositories.test.ts`
- Modify: `packages/db/src/json-file-workbench-repositories.test.ts`

- [ ] **Step 1: Write failing in-memory observation state tests**

Add this test near the existing tool observation tests in `packages/db/src/workbench-repositories.test.ts`:

```ts
it("persists running and cancelled tool observation states", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const running: ToolObservationRecord = {
    id: "tool_observation_running",
    runId: "run_1",
    projectId: "project_1",
    taskId: "task_1",
    toolName: "skill:skill_static_deploy:publish_static",
    input: { commandId: "publish_static" },
    outputSummary: "",
    state: "running",
    createdAt: "2026-05-18T00:00:00.000Z"
  };
  const cancelled: ToolObservationRecord = {
    ...running,
    id: "tool_observation_cancelled",
    outputSummary: "Worker job cancelled.",
    state: "cancelled",
    completedAt: "2026-05-18T00:00:01.000Z"
  };

  await repositories.toolObservations.save(running);
  await repositories.toolObservations.save(cancelled);

  await expect(repositories.toolObservations.listForRun("run_1")).resolves.toEqual([
    running,
    cancelled
  ]);
});
```

- [ ] **Step 2: Write failing JSON-file observation state tests**

Add this test near the existing JSON-file tool observation tests in `packages/db/src/json-file-workbench-repositories.test.ts`:

```ts
it("persists running and cancelled tool observations through JSON storage", async () => {
  const filePath = await createTempFilePath();
  const first = createJsonFileWorkbenchRepositories({ filePath });
  const running: ToolObservationRecord = {
    id: "tool_observation_running",
    runId: "run_1",
    projectId: "project_1",
    taskId: "task_1",
    toolName: "skill:skill_static_deploy:publish_static",
    input: { commandId: "publish_static" },
    outputSummary: "",
    state: "running",
    createdAt: "2026-05-18T00:00:00.000Z"
  };
  const cancelled: ToolObservationRecord = {
    ...running,
    id: "tool_observation_cancelled",
    outputSummary: "Worker job cancelled.",
    state: "cancelled",
    completedAt: "2026-05-18T00:00:01.000Z"
  };

  await first.toolObservations.save(running);
  await first.toolObservations.save(cancelled);

  const second = createJsonFileWorkbenchRepositories({ filePath });
  await expect(second.toolObservations.listForRun("run_1")).resolves.toEqual([
    running,
    cancelled
  ]);
});
```

- [ ] **Step 3: Run DB tests and observe the type failure**

Run:

```bash
pnpm --filter @lp-agent/db test
```

Expected: TypeScript/Vitest fails because `ToolObservationState` does not include `running` or `cancelled`.

- [ ] **Step 4: Extend the observation state type**

Change `packages/db/src/workbench-repositories.ts`:

```ts
export type ToolObservationState = "running" | "completed" | "failed" | "cancelled";
```

- [ ] **Step 5: Run DB verification**

Run:

```bash
pnpm --filter @lp-agent/db test
pnpm --filter @lp-agent/db typecheck
```

Expected: both commands pass.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/workbench-repositories.ts packages/db/src/workbench-repositories.test.ts packages/db/src/json-file-workbench-repositories.test.ts
git commit -m "add running tool observation state"
```

## Task 2: Add API Worker Queue Contracts and Finalizer

**Files:**

- Create: `packages/api/src/skill-command-worker-queue.ts`
- Create: `packages/api/src/skill-command-worker-queue.test.ts`
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/package.json`

- [ ] **Step 1: Add the API test file to the package script**

Modify `packages/api/package.json`:

```json
"test": "vitest run src/task-interrupts.test.ts src/skill-command-worker-queue.test.ts src/structured-lp-brief.test.ts src/structured-static-artifacts.test.ts src/skill-command-execution.test.ts src/worker-backed-tool-command-runner.test.ts src/run-orchestrator.test.ts src/context-memory.test.ts src/agent-handoffs.test.ts src/services.test.ts"
```

- [ ] **Step 2: Write failing worker finalizer tests**

Create `packages/api/src/skill-command-worker-queue.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  createInMemoryWorkbenchRepositories,
  type RunRecord,
  type ToolObservationRecord
} from "@lp-agent/db";
import {
  InMemoryWorkerJobPayloadRepository,
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter,
  createSimulatedSandboxPolicy,
  type WorkerJobRecord
} from "@lp-agent/worker-runtime";
import {
  finalizeWorkerBackedSkillCommand,
  runLocalWorkerOnceAndFinalize
} from "./skill-command-worker-queue";

function runningRun(): RunRecord {
  return {
    id: "run_skill_command_1",
    projectId: "project_1",
    taskId: "task_1",
    role: "deployer",
    state: "running",
    startedAt: "2026-05-18T00:00:00.000Z",
    contextSummary: {
      injected: ["skillCommand:skill_static_deploy:publish_static"],
      omitted: []
    }
  };
}

function runningObservation(): ToolObservationRecord {
  return {
    id: "tool_observation_1",
    runId: "run_skill_command_1",
    projectId: "project_1",
    taskId: "task_1",
    toolName: "skill:skill_static_deploy:publish_static",
    input: {
      skillId: "skill_static_deploy",
      skillVersionId: "skill_version_1",
      commandId: "publish_static",
      permission: "deploy:simulate",
      approvedByUserId: "local-web-user",
      argCount: 2,
      envNames: ["LP_PROJECT_ID"]
    },
    outputSummary: "",
    state: "running",
    createdAt: "2026-05-18T00:00:00.000Z"
  };
}

async function linkedWorkerJob(input: {
  state?: "completed" | "failed" | "rejected" | "cancelled";
  errorName?: string;
} = {}): Promise<{
  repositories: ReturnType<typeof createInMemoryWorkbenchRepositories>;
  workerRuntime: InMemoryWorkerRuntime;
  workerJob: WorkerJobRecord;
}> {
  const repositories = createInMemoryWorkbenchRepositories();
  await repositories.runs.save(runningRun());
  await repositories.toolObservations.save(runningObservation());
  await repositories.runEvents.save({
    id: "run_skill_command_1_event_1",
    runId: "run_skill_command_1",
    projectId: "project_1",
    taskId: "task_1",
    sequence: 1,
    type: "run.started",
    message: "Deployment skill command run started.",
    payload: { commandId: "publish_static", observationId: "tool_observation_1" },
    createdAt: "2026-05-18T00:00:00.000Z"
  });
  await repositories.runEvents.save({
    id: "run_skill_command_1_event_2",
    runId: "run_skill_command_1",
    projectId: "project_1",
    taskId: "task_1",
    sequence: 2,
    type: "tool.started",
    message: "Deployment skill command queued.",
    payload: { commandId: "publish_static", observationId: "tool_observation_1" },
    createdAt: "2026-05-18T00:00:01.000Z"
  });

  const workerRuntime = new InMemoryWorkerRuntime({
    now: () => new Date("2026-05-18T00:00:02.000Z")
  });
  const queued = await workerRuntime.enqueue(
    {
      projectId: "project_1",
      kind: "tool_command",
      commandId: "publish_static",
      command: "static-deploy",
      args: ["--project", "project_1"],
      env: { LP_PROJECT_ID: "project_1" },
      timeoutMs: 30000
    },
    createSimulatedSandboxPolicy({
      allowedCommands: ["static-deploy"],
      allowedEnvNames: ["LP_PROJECT_ID"]
    })
  );
  const workerJob = input.state
    ? {
        ...queued,
        state: input.state,
        completedAt: "2026-05-18T00:00:03.000Z",
        errorName: input.errorName,
        resultSummary: {
          state: input.state,
          exitCode: input.state === "completed" ? 0 : 1,
          stdout: input.state === "completed" ? "published" : "",
          stderr: input.state === "completed" ? "" : "failed",
          stdoutBytes: input.state === "completed" ? 9 : 0,
          stderrBytes: input.state === "completed" ? 0 : 6,
          errorName: input.errorName
        }
      }
    : await workerRuntime.runNext();
  if (!workerJob) {
    throw new Error("Expected worker job.");
  }
  await repositories.runEvents.save({
    id: "run_skill_command_1_event_3",
    runId: "run_skill_command_1",
    projectId: "project_1",
    taskId: "task_1",
    sequence: 3,
    type: "worker.job.linked",
    message: "Worker job linked to task.",
    payload: {
      taskId: "task_1",
      runId: "run_skill_command_1",
      workerJobId: workerJob.id,
      observationId: "tool_observation_1"
    },
    createdAt: "2026-05-18T00:00:02.000Z"
  });
  return { repositories, workerRuntime, workerJob };
}

describe("worker-backed skill command finalization", () => {
  it("finalizes a completed worker job into completed tool and run events", async () => {
    const { repositories, workerJob } = await linkedWorkerJob({ state: "completed" });

    const result = await finalizeWorkerBackedSkillCommand({
      repositories,
      workerJob,
      now: () => new Date("2026-05-18T00:00:04.000Z")
    });

    expect(result).toMatchObject({
      ok: true,
      state: "completed",
      workerJobId: workerJob.id,
      runId: "run_skill_command_1"
    });
    await expect(repositories.runs.getById("run_skill_command_1")).resolves.toMatchObject({
      state: "completed",
      completedAt: "2026-05-18T00:00:04.000Z"
    });
    await expect(repositories.toolObservations.listForRun("run_skill_command_1")).resolves.toEqual([
      expect.objectContaining({
        id: "tool_observation_1",
        state: "completed",
        outputSummary: expect.stringContaining("stdout: 9 chars")
      })
    ]);
    await expect(repositories.runEvents.listForRun("run_skill_command_1")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool.completed" }),
        expect.objectContaining({ type: "run.completed" })
      ])
    );
  });

  it("is idempotent when a terminal run event already exists", async () => {
    const { repositories, workerJob } = await linkedWorkerJob({ state: "completed" });
    await finalizeWorkerBackedSkillCommand({
      repositories,
      workerJob,
      now: () => new Date("2026-05-18T00:00:04.000Z")
    });

    const second = await finalizeWorkerBackedSkillCommand({
      repositories,
      workerJob,
      now: () => new Date("2026-05-18T00:00:05.000Z")
    });

    const terminalEvents = (await repositories.runEvents.listForRun("run_skill_command_1")).filter(
      (event) => event.type === "run.completed"
    );
    expect(second).toMatchObject({ ok: true, state: "completed" });
    expect(terminalEvents).toHaveLength(1);
  });

  it("finalizes cancelled worker jobs as cancelled instead of failed", async () => {
    const { repositories, workerJob } = await linkedWorkerJob({
      state: "cancelled",
      errorName: "worker_job_cancelled"
    });

    await finalizeWorkerBackedSkillCommand({
      repositories,
      workerJob,
      now: () => new Date("2026-05-18T00:00:04.000Z")
    });

    await expect(repositories.runs.getById("run_skill_command_1")).resolves.toMatchObject({
      state: "cancelled"
    });
    await expect(repositories.toolObservations.listForRun("run_skill_command_1")).resolves.toEqual([
      expect.objectContaining({
        state: "cancelled",
        errorName: "worker_job_cancelled"
      })
    ]);
  });

  it("runs one safe queued worker job and finalizes the linked run", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.runs.save(runningRun());
    await repositories.toolObservations.save(runningObservation());
    const workerRuntime = new InMemoryWorkerRuntime({
      payloadRepository: new InMemoryWorkerJobPayloadRepository(),
      adapter: new SimulatedExecutionAdapter(),
      now: () => new Date("2026-05-18T00:00:02.000Z")
    });
    const workerJob = await workerRuntime.enqueueSafe(
      {
        projectId: "project_1",
        kind: "tool_command",
        commandId: "publish_static",
        command: "static-deploy",
        args: ["--project", "project_1"],
        envNames: ["LP_PROJECT_ID"],
        timeoutMs: 30000
      },
      createSimulatedSandboxPolicy({
        allowedCommands: ["static-deploy"],
        allowedEnvNames: ["LP_PROJECT_ID"]
      })
    );
    await repositories.runEvents.save({
      id: "run_skill_command_1_event_1",
      runId: "run_skill_command_1",
      projectId: "project_1",
      taskId: "task_1",
      sequence: 1,
      type: "worker.job.linked",
      message: "Worker job linked to task.",
      payload: {
        taskId: "task_1",
        runId: "run_skill_command_1",
        workerJobId: workerJob.id,
        observationId: "tool_observation_1"
      },
      createdAt: "2026-05-18T00:00:02.000Z"
    });
    const finalizeSpy = vi.fn();

    const result = await runLocalWorkerOnceAndFinalize({
      repositories,
      workerRuntime,
      workerId: "local-web-worker",
      afterFinalize: finalizeSpy,
      now: () => new Date("2026-05-18T00:00:04.000Z")
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected worker result.");
    }
    expect(result.state).toBe("completed");
    expect(finalizeSpy).toHaveBeenCalledOnce();
  });

  it("returns idle when there is no queued worker job", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const workerRuntime = new InMemoryWorkerRuntime();

    await expect(
      runLocalWorkerOnceAndFinalize({
        repositories,
        workerRuntime,
        workerId: "local-web-worker"
      })
    ).resolves.toEqual({ ok: true, state: "idle" });
  });
});
```

- [ ] **Step 3: Run the new API test and observe failure**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: fails because `skill-command-worker-queue.ts` does not exist and exports are missing.

- [ ] **Step 4: Create the worker queue helper module**

Create `packages/api/src/skill-command-worker-queue.ts`:

```ts
import type {
  RunEventRecord,
  RunRecord,
  ToolObservationRecord,
  WorkbenchRepositories
} from "@lp-agent/db";
import type {
  SafeWorkerJobInput,
  SandboxPolicy,
  WorkerJobRecord
} from "@lp-agent/worker-runtime";

export interface SkillCommandQueueRuntime {
  enqueueSafe(input: SafeWorkerJobInput, policy?: SandboxPolicy): Promise<WorkerJobRecord>;
  claimOldestQueued(input: { workerId: string }): Promise<{ record: WorkerJobRecord; claimToken: string } | undefined>;
  runClaimedJob(claim: { record: WorkerJobRecord; claimToken: string }): Promise<WorkerJobRecord>;
  getJob(id: string): Promise<WorkerJobRecord | undefined>;
}

export type RunLocalWorkerOnceResult =
  | {
      ok: true;
      state: "completed" | "failed" | "rejected" | "cancelled" | "idle";
      workerJobId?: string;
      runId?: string;
    }
  | {
      ok: false;
      error:
        | "worker_runtime_not_configured"
        | "worker_job_execution_failed"
        | "worker_job_finalization_failed";
    };

export async function runLocalWorkerOnceAndFinalize(input: {
  repositories: WorkbenchRepositories;
  workerRuntime?: SkillCommandQueueRuntime;
  workerId: string;
  now?: () => Date;
  afterFinalize?: () => void;
}): Promise<RunLocalWorkerOnceResult> {
  if (!input.workerRuntime) {
    return { ok: false, error: "worker_runtime_not_configured" };
  }
  let workerJob: WorkerJobRecord | undefined;
  try {
    const claim = await input.workerRuntime.claimOldestQueued({ workerId: input.workerId });
    if (!claim) {
      return { ok: true, state: "idle" };
    }
    workerJob = await input.workerRuntime.runClaimedJob(claim);
  } catch {
    return { ok: false, error: "worker_job_execution_failed" };
  }
  try {
    const finalized = await finalizeWorkerBackedSkillCommand({
      repositories: input.repositories,
      workerJob,
      now: input.now
    });
    input.afterFinalize?.();
    return finalized;
  } catch {
    return { ok: false, error: "worker_job_finalization_failed" };
  }
}

export async function finalizeWorkerBackedSkillCommand(input: {
  repositories: WorkbenchRepositories;
  workerJob: WorkerJobRecord;
  now?: () => Date;
}): Promise<RunLocalWorkerOnceResult> {
  const link = await findWorkerLinkEvent(input.repositories, input.workerJob.id);
  if (!link) {
    return {
      ok: true,
      state: toFinalState(input.workerJob),
      workerJobId: input.workerJob.id
    };
  }
  const runId = String(link.payload.runId ?? "");
  const observationId = String(link.payload.observationId ?? "");
  const run = await input.repositories.runs.getById(runId);
  if (!run) {
    return {
      ok: false,
      error: "worker_job_finalization_failed"
    };
  }
  const existingEvents = await input.repositories.runEvents.listForRun(run.id);
  const terminalEvent = existingEvents.find((event) => isTerminalRunEvent(event.type));
  if (terminalEvent) {
    return {
      ok: true,
      state: terminalEvent.type === "run.completed"
        ? "completed"
        : terminalEvent.type === "run.cancelled"
          ? "cancelled"
          : "failed",
      workerJobId: input.workerJob.id,
      runId: run.id
    };
  }

  const finalState = toFinalState(input.workerJob);
  const now = (input.now ?? (() => new Date()))().toISOString();
  const outputSummary = summarizeWorkerResult(input.workerJob);
  const errorName = sanitizeWorkerErrorName(input.workerJob.errorName ?? input.workerJob.resultSummary?.errorName);
  const nextSequence = existingEvents.reduce((max, event) => Math.max(max, event.sequence), 0) + 1;
  const basePayload = {
    workerJobId: input.workerJob.id,
    observationId,
    outputSummary,
    ...(input.workerJob.resultSummary?.exitCode !== undefined
      ? { exitCode: input.workerJob.resultSummary.exitCode }
      : {}),
    ...(errorName ? { errorName } : {})
  };

  await input.repositories.runEvents.save({
    id: `${run.id}_event_${nextSequence}`,
    runId: run.id,
    projectId: run.projectId,
    taskId: run.taskId,
    sequence: nextSequence,
    type: finalState === "completed" ? "tool.completed" : finalState === "cancelled" ? "tool.cancelled" : "tool.failed",
    message: finalState === "completed"
      ? "Deployment skill command completed."
      : finalState === "cancelled"
        ? "Deployment skill command cancelled."
        : "Deployment skill command failed.",
    payload: basePayload,
    createdAt: now
  });
  await input.repositories.runEvents.save({
    id: `${run.id}_event_${nextSequence + 1}`,
    runId: run.id,
    projectId: run.projectId,
    taskId: run.taskId,
    sequence: nextSequence + 1,
    type: finalState === "completed" ? "run.completed" : finalState === "cancelled" ? "run.cancelled" : "run.failed",
    message: finalState === "completed"
      ? "Deployment skill command run completed."
      : finalState === "cancelled"
        ? "Deployment skill command run cancelled."
        : "Deployment skill command run failed.",
    payload: basePayload,
    createdAt: now
  });

  const observations = await input.repositories.toolObservations.listForRun(run.id);
  const existingObservation = observations.find((candidate) => candidate.id === observationId);
  if (existingObservation) {
    const observation: ToolObservationRecord = {
      ...existingObservation,
      outputSummary,
      state: finalState === "rejected" ? "failed" : finalState,
      ...(input.workerJob.resultSummary?.exitCode !== undefined
        ? { exitCode: input.workerJob.resultSummary.exitCode }
        : {}),
      ...(errorName ? { errorName } : {}),
      completedAt: now
    };
    await input.repositories.toolObservations.save(observation);
  }

  const finalRun: RunRecord = {
    ...run,
    state: finalState === "rejected" ? "failed" : finalState,
    completedAt: now
  };
  await input.repositories.runs.save(finalRun);

  return {
    ok: true,
    state: finalState,
    workerJobId: input.workerJob.id,
    runId: run.id
  };
}

async function findWorkerLinkEvent(
  repositories: WorkbenchRepositories,
  workerJobId: string
): Promise<RunEventRecord | undefined> {
  const events = await repositories.runEvents.listAll();
  return events
    .filter(
      (event) =>
        event.type === "worker.job.linked" &&
        event.payload.workerJobId === workerJobId
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.sequence - left.sequence)
    .at(0);
}

function toFinalState(
  workerJob: WorkerJobRecord
): "completed" | "failed" | "rejected" | "cancelled" {
  if (
    workerJob.state === "completed" ||
    workerJob.state === "failed" ||
    workerJob.state === "rejected" ||
    workerJob.state === "cancelled"
  ) {
    return workerJob.state;
  }
  return "failed";
}

function summarizeWorkerResult(workerJob: WorkerJobRecord): string {
  const result = workerJob.resultSummary;
  if (!result) {
    return "Worker job did not produce a result.";
  }
  return [
    `stdout: ${result.stdoutBytes} chars`,
    `stderr: ${result.stderrBytes} chars`
  ].join("\n");
}

function sanitizeWorkerErrorName(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed !== value ||
    trimmed.length > 80 ||
    /\s/.test(trimmed) ||
    !/^[A-Za-z0-9_.:-]+$/.test(trimmed)
  ) {
    return "worker_job_error";
  }
  return trimmed;
}

function isTerminalRunEvent(type: string): boolean {
  return type === "run.completed" || type === "run.failed" || type === "run.cancelled";
}
```

- [ ] **Step 5: Export the helper**

Add this export block to `packages/api/src/index.ts` near the existing task interrupt exports:

```ts
export {
  finalizeWorkerBackedSkillCommand,
  runLocalWorkerOnceAndFinalize,
  type RunLocalWorkerOnceResult,
  type SkillCommandQueueRuntime
} from "./skill-command-worker-queue";
```

- [ ] **Step 6: Run API verification for the helper**

Run:

```bash
pnpm --filter @lp-agent/api test
pnpm --filter @lp-agent/api typecheck
```

Expected: both commands pass after adjusting imports for any exact TypeScript formatting issues.

- [ ] **Step 7: Commit**

```bash
git add packages/api/package.json packages/api/src/index.ts packages/api/src/skill-command-worker-queue.ts packages/api/src/skill-command-worker-queue.test.ts
git commit -m "add worker backed skill command finalizer"
```

## Task 3: Add Queued Skill Command Enqueueing in API Service

**Files:**

- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/skill-command-worker-queue.test.ts`

- [ ] **Step 1: Add failing service queue tests**

Append these tests to `packages/api/src/skill-command-worker-queue.test.ts`:

```ts
import { DemoWorkbenchService } from "./index";

function deploymentSkillManifest() {
  return {
    id: "skill_static_deploy",
    name: "Static deploy",
    version: "1.0.0",
    type: "deployment" as const,
    scope: "project" as const,
    description: "Simulates static LP publishing.",
    permissions: ["deploy:simulate"],
    requiredSecrets: [],
    entrypoints: ["deploy.md"],
    commands: [
      {
        id: "publish_static",
        name: "Publish static",
        permission: "deploy:simulate",
        requiresApproval: true,
        command: "static-deploy",
        args: ["--project", "{{projectId}}"],
        env: [{ name: "LP_PROJECT_ID", value: "{{projectId}}" }],
        timeoutMs: 30000
      }
    ],
    reviewState: "published" as const
  };
}

async function savePublishedBoundSkill(
  repositories: ReturnType<typeof createInMemoryWorkbenchRepositories>
) {
  await repositories.projects.save({
    id: "project_1",
    name: "Project",
    createdAt: "2026-05-18T00:00:00.000Z"
  });
  await repositories.skills.save({
    id: "skill_static_deploy",
    name: "Static deploy",
    scope: "project",
    createdAt: "2026-05-18T00:00:00.000Z"
  });
  await repositories.skillVersions.save({
    id: "skill_version_1",
    skillId: "skill_static_deploy",
    manifest: deploymentSkillManifest(),
    content: "Deploy static files.",
    contentType: "text/markdown",
    reviewState: "published",
    createdAt: "2026-05-18T00:00:00.000Z"
  });
  await repositories.skillBindings.save({
    id: "skill_binding_1",
    projectId: "project_1",
    skillId: "skill_static_deploy",
    skillVersionId: "skill_version_1",
    enabled: true,
    createdAt: "2026-05-18T00:00:00.000Z"
  });
}

describe("queued deployment skill commands", () => {
  it("enqueues a safe worker job and leaves the run running", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await savePublishedBoundSkill(repositories);
    const workerRuntime = new InMemoryWorkerRuntime({
      payloadRepository: new InMemoryWorkerJobPayloadRepository(),
      adapter: new SimulatedExecutionAdapter(),
      now: () => new Date("2026-05-18T00:00:03.000Z")
    });
    const service = new DemoWorkbenchService({
      repositories,
      workerQueueRuntime: workerRuntime,
      now: () => new Date("2026-05-18T00:00:01.000Z")
    });

    const result = await service.enqueueProjectSkillCommand({
      projectId: "project_1",
      skillVersionId: "skill_version_1",
      commandId: "publish_static",
      approvedByUserId: "local-web-user",
      taskId: "task_1"
    });

    expect(result.workerJobId).toMatch(/^worker_job_/);
    expect(result.run).toMatchObject({
      state: "running",
      taskId: "task_1"
    });
    expect(result.observation).toMatchObject({
      state: "running",
      outputSummary: "",
      taskId: "task_1"
    });
    await expect(workerRuntime.getJob(result.workerJobId)).resolves.toMatchObject({
      state: "queued",
      payloadSource: "safe_persisted",
      inputSummary: {
        command: "static-deploy",
        envNames: ["LP_PROJECT_ID"]
      }
    });
    await expect(repositories.runEvents.listForRun(result.run.id)).resolves.toEqual([
      expect.objectContaining({ type: "run.started" }),
      expect.objectContaining({ type: "tool.started" }),
      expect.objectContaining({
        type: "worker.job.linked",
        payload: expect.objectContaining({
          taskId: "task_1",
          workerJobId: result.workerJobId,
          observationId: result.observation.id
        })
      })
    ]);
  });

  it("rejects non-queueable commands that require secrets", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await savePublishedBoundSkill(repositories);
    const version = await repositories.skillVersions.getById("skill_version_1");
    if (!version) {
      throw new Error("Expected skill version.");
    }
    await repositories.skillVersions.save({
      ...version,
      manifest: {
        ...version.manifest,
        requiredSecrets: ["DEPLOY_TOKEN"],
        commands: [
          {
            ...version.manifest.commands![0]!,
            env: [{ name: "DEPLOY_TOKEN", secretRef: "DEPLOY_TOKEN" }]
          }
        ]
      }
    });
    const service = new DemoWorkbenchService({
      repositories,
      workerQueueRuntime: new InMemoryWorkerRuntime()
    });

    await expect(
      service.enqueueProjectSkillCommand({
        projectId: "project_1",
        skillVersionId: "skill_version_1",
        commandId: "publish_static",
        approvedByUserId: "local-web-user"
      })
    ).rejects.toThrow("skill_command_not_queueable");
  });
});
```

- [ ] **Step 2: Run API tests and observe missing method failure**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: fails because `DemoWorkbenchServiceOptions.workerQueueRuntime` and `enqueueProjectSkillCommand()` do not exist.

- [ ] **Step 3: Add API types and option**

In `packages/api/src/index.ts`, add imports from worker runtime near other imports:

```ts
import {
  createSimulatedSandboxPolicy,
  type SafeWorkerJobInput,
  type SandboxPolicy,
  type WorkerJobRecord
} from "@lp-agent/worker-runtime";
```

Add these interfaces after `ExecuteProjectSkillCommandInput`:

```ts
export interface EnqueueProjectSkillCommandInput extends ExecuteProjectSkillCommandInput {
  taskId?: string;
}

export interface QueuedSkillCommandExecutionResult extends SkillCommandExecutionResult {
  workerJobId: string;
}
```

Add to `DemoWorkbenchServiceOptions`:

```ts
workerQueueRuntime?: SkillCommandQueueRuntime;
```

Add to the class fields:

```ts
private readonly workerQueueRuntime?: SkillCommandQueueRuntime;
```

Set it in the constructor:

```ts
this.workerQueueRuntime = options.workerQueueRuntime;
```

- [ ] **Step 4: Add queueability assertions**

Add these helper functions near the existing skill command helper functions in `packages/api/src/index.ts`:

```ts
function assertSkillCommandQueueable(
  command: NonNullable<SkillManifest["commands"]>[number]
): void {
  if ((command.env ?? []).some((binding) => binding.secretRef)) {
    throw new Error("skill_command_not_queueable");
  }
  if (command.workingDirectory) {
    throw new Error("skill_command_not_queueable");
  }
  const templateValues = collectSkillCommandTemplateValues(command).join("\n");
  if (
    templateValues.includes("artifactDir") ||
    templateValues.includes("artifact.indexHtmlPath") ||
    templateValues.includes("artifact.stylesCssPath") ||
    templateValues.includes("artifact.scriptJsPath")
  ) {
    throw new Error("skill_command_not_queueable");
  }
}

function createSafeWorkerJobInput(input: {
  projectId: string;
  commandId: string;
  command: NonNullable<SkillManifest["commands"]>[number];
  args: string[];
  envNames: string[];
}): SafeWorkerJobInput {
  return {
    projectId: input.projectId,
    kind: "tool_command",
    commandId: input.commandId,
    command: input.command.command,
    args: [...input.args],
    envNames: [...input.envNames].sort(),
    timeoutMs: resolveSkillCommandTimeout(input.command)
  };
}

function createQueueSandboxPolicy(input: {
  command: NonNullable<SkillManifest["commands"]>[number];
  envNames: string[];
}): SandboxPolicy {
  return createSimulatedSandboxPolicy({
    allowedCommands: [input.command.command],
    allowedEnvNames: [...input.envNames].sort(),
    timeoutMs: resolveSkillCommandTimeout(input.command),
    maxStdoutBytes: 300,
    maxStderrBytes: 300,
    network: "disabled"
  });
}
```

- [ ] **Step 5: Implement `enqueueProjectSkillCommand()`**

Add this method to `DemoWorkbenchService` immediately after `executeProjectSkillCommand()`:

```ts
async enqueueProjectSkillCommand(
  input: EnqueueProjectSkillCommandInput
): Promise<QueuedSkillCommandExecutionResult> {
  if (!this.workerQueueRuntime) {
    throw new Error("worker_runtime_not_configured");
  }
  await this.getProjectOrThrow(input.projectId);
  if (input.approvedByUserId.trim().length === 0) {
    throw new Error("skill_command_approval_required");
  }
  const version = await this.getSkillVersionOrThrow(input.skillVersionId);
  const bindings = await this.repositories.skillBindings.listForProject(input.projectId);
  const binding = bindings.find(
    (candidate) =>
      isProjectSkillBindingForProject(candidate, input.projectId) &&
      candidate.skillVersionId === input.skillVersionId &&
      candidate.enabled
  );
  if (!binding) {
    throw new Error("skill_command_not_bound");
  }
  if (version.manifest.type !== "deployment") {
    throw new Error("skill_command_not_deployment");
  }
  if (version.reviewState !== "published" || version.manifest.reviewState !== "published") {
    throw new Error("skill_command_not_published");
  }
  const command = (version.manifest.commands ?? []).find(
    (candidate) => candidate.id === input.commandId
  );
  if (!command) {
    throw new Error("skill_command_not_found");
  }
  if (!version.manifest.permissions.includes(command.permission)) {
    throw new Error("skill_command_permission_denied");
  }
  assertSkillCommandSecretRefsDeclared(version.manifest, command);
  const pageVersion = input.pageVersionId
    ? await this.repositories.pageVersions.getById(input.pageVersionId)
    : undefined;
  if (input.pageVersionId && (!pageVersion || pageVersion.projectId !== input.projectId)) {
    throw new Error("skill_command_page_version_not_found");
  }
  assertSkillCommandQueueable(command);
  preflightSkillCommandTemplates({
    command,
    hasPageVersion: Boolean(input.pageVersionId)
  });

  const runId = await reserveRepositoryId(this.repositories, "run_skill_command", async () => {
    const existingRuns = await this.repositories.runs.listAll();
    return existingRuns.map((record) => record.id);
  });
  const observationId = await reserveRepositoryId(
    this.repositories,
    "tool_observation",
    async () => {
      const observations = await this.repositories.toolObservations.listAll();
      return observations.map((record) => record.id);
    }
  );

  try {
    const variables: CommandTemplateVariables = {
      projectId: input.projectId,
      skillId: version.skillId,
      skillVersionId: version.id,
      commandId: command.id,
      runId,
      ...(input.pageVersionId ? { pageVersionId: input.pageVersionId } : {})
    };
    const env = resolveSkillCommandEnvironment({
      manifest: version.manifest,
      command,
      runtimeEnv: this.env,
      variables
    });
    const args = command.args.map((arg) => resolveCommandTemplate(arg, variables));
    const envNames = Object.keys(env).sort();
    const startedAt = this.timestamp();
    const run: RunRecord = {
      id: runId,
      projectId: input.projectId,
      taskId: input.taskId,
      role: "deployer",
      state: "running",
      startedAt,
      contextSummary: {
        injected: [`skillCommand:${version.skillId}:${command.id}`, "workerQueue:safe"],
        omitted: []
      }
    };
    await this.repositories.runs.save(run);

    const observation: ToolObservationRecord = {
      id: observationId,
      runId,
      projectId: input.projectId,
      taskId: input.taskId,
      toolName: `skill:${version.skillId}:${command.id}`,
      input: {
        skillId: version.skillId,
        skillVersionId: version.id,
        commandId: command.id,
        permission: command.permission,
        approvedByUserId: input.approvedByUserId,
        ...(input.pageVersionId ? { pageVersionId: input.pageVersionId } : {}),
        argCount: args.length,
        envNames
      },
      outputSummary: "",
      state: "running",
      createdAt: startedAt
    };
    await this.repositories.toolObservations.save(observation);

    let sequence = 1;
    const saveEvent = async (
      type: string,
      message: string,
      payload: Record<string, unknown>
    ): Promise<void> => {
      await this.repositories.runEvents.save({
        id: `${runId}_event_${sequence}`,
        runId,
        projectId: input.projectId,
        taskId: input.taskId,
        sequence,
        type,
        message,
        payload,
        createdAt: this.timestamp()
      });
      sequence += 1;
    };
    const basePayload = {
      skillId: version.skillId,
      skillVersionId: version.id,
      commandId: command.id,
      permission: command.permission,
      approvedByUserId: input.approvedByUserId,
      observationId,
      ...(input.pageVersionId ? { pageVersionId: input.pageVersionId } : {})
    };
    await saveEvent("run.started", "Deployment skill command run started.", basePayload);
    await saveEvent("tool.started", "Deployment skill command queued.", basePayload);

    const workerJob = await this.workerQueueRuntime.enqueueSafe(
      createSafeWorkerJobInput({
        projectId: input.projectId,
        commandId: command.id,
        command,
        args,
        envNames
      }),
      createQueueSandboxPolicy({ command, envNames })
    );
    await saveEvent("worker.job.linked", "Worker job linked to task.", {
      ...basePayload,
      taskId: input.taskId,
      runId,
      workerJobId: workerJob.id
    });

    return {
      run: copyRunRecord(run),
      observation: copyToolObservationRecord(observation),
      workerJobId: workerJob.id
    };
  } finally {
    releaseRepositoryId(this.repositories, runId);
    releaseRepositoryId(this.repositories, observationId);
  }
}
```

- [ ] **Step 6: Run API verification**

Run:

```bash
pnpm --filter @lp-agent/api test
pnpm --filter @lp-agent/api typecheck
```

Expected: both commands pass.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/index.ts packages/api/src/skill-command-worker-queue.test.ts
git commit -m "queue deployment skill commands"
```

## Task 4: Wire Web Store and Server Actions

**Files:**

- Modify: `apps/web/package.json`
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`
- Modify: `apps/web/src/app/actions.ts`
- Modify: `apps/web/src/app/actions.test.ts`

- [ ] **Step 1: Add Web worker-runtime test dependency**

Add the dependency to `apps/web/package.json`:

```json
"@lp-agent/worker-runtime": "workspace:*"
```

- [ ] **Step 2: Add failing Web store tests**

Add these imports to `apps/web/src/lib/workbench-store.test.ts`:

```ts
import type { WorkbenchRepositories } from "@lp-agent/db";
import {
  InMemoryWorkerJobPayloadRepository,
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter
} from "@lp-agent/worker-runtime";
```

Add tests to `apps/web/src/lib/workbench-store.test.ts`:

```ts
it("queues deployment skill commands through the worker queue runtime", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const workerRuntime = new InMemoryWorkerRuntime({
    payloadRepository: new InMemoryWorkerJobPayloadRepository(),
    adapter: new SimulatedExecutionAdapter()
  });
  const store = createWebWorkbenchStore({
    repositories,
    workerQueueRuntime: workerRuntime,
    currentUser: { id: "web-reviewer", displayName: "Reviewer" }
  });
  const project = await store.createProject({ name: "Spring Campaign" });
  await savePublishedDeploymentSkill(repositories, project.id);

  const result = await store.executeSkillCommand({
    projectId: project.id,
    skillVersionId: "skill_version_deploy",
    commandId: "publish_static"
  });

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error("Expected queued command.");
  }
  expect(result.value.run.state).toBe("running");
  expect(result.value.observation.state).toBe("running");
  await expect(workerRuntime.listJobsForProject(project.id)).resolves.toEqual([
    expect.objectContaining({
      state: "queued",
      payloadSource: "safe_persisted"
    })
  ]);
});

it("runs one local worker job and finalizes the queued command", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const workerRuntime = new InMemoryWorkerRuntime({
    payloadRepository: new InMemoryWorkerJobPayloadRepository(),
    adapter: new SimulatedExecutionAdapter()
  });
  const store = createWebWorkbenchStore({
    repositories,
    workerQueueRuntime: workerRuntime
  });
  const project = await store.createProject({ name: "Spring Campaign" });
  await savePublishedDeploymentSkill(repositories, project.id);
  await store.executeSkillCommand({
    projectId: project.id,
    skillVersionId: "skill_version_deploy",
    commandId: "publish_static"
  });

  const result = await store.runLocalWorkerOnce({ projectId: project.id });

  expect(result).toMatchObject({
    ok: true,
    state: "completed"
  });
  const pageState = await store.getPageState({ projectId: project.id });
  expect(pageState.kind).toBe("empty");
  const runs = await repositories.runs.listAll();
  expect(runs.at(-1)).toMatchObject({ state: "completed" });
});
```

If the helper name `savePublishedDeploymentSkill` does not exist in the test file, add this wrapper near existing skill fixtures:

```ts
async function savePublishedDeploymentSkill(
  repositories: WorkbenchRepositories,
  projectId: string
): Promise<void> {
  await repositories.skills.save({
    id: "skill_static_deploy",
    name: "Static deploy",
    scope: "project",
    createdAt: "2026-05-18T00:00:00.000Z"
  });
  await repositories.skillVersions.save({
    id: "skill_version_deploy",
    skillId: "skill_static_deploy",
    manifest: publishedProjectSkill.version.manifest,
    content: "Deploy static files.",
    contentType: "text/markdown",
    reviewState: "published",
    createdAt: "2026-05-18T00:00:00.000Z"
  });
  await repositories.skillBindings.save({
    id: "skill_binding_deploy",
    projectId,
    skillId: "skill_static_deploy",
    skillVersionId: "skill_version_deploy",
    enabled: true,
    createdAt: "2026-05-18T00:00:00.000Z"
  });
}
```

- [ ] **Step 3: Add failing action tests**

Update the mocked store in `apps/web/src/app/actions.test.ts` to include:

```ts
runLocalWorkerOnce: vi.fn()
```

Add `runLocalWorkerOnceAction` to the existing action import:

```ts
import {
  runLocalWorkerOnceAction
} from "./actions";
```

Add tests:

```ts
it("runs one local worker pass and redirects to skills", async () => {
  mocks.runLocalWorkerOnce.mockResolvedValue({
    ok: true,
    state: "completed",
    workerJobId: "worker_job_1",
    runId: "run_skill_command_1"
  });

  const formData = new FormData();
  formData.set("projectId", "project_1");

  await expectRedirect(runLocalWorkerOnceAction(formData), "/?view=skills");

  expect(mocks.runLocalWorkerOnce).toHaveBeenCalledWith({ projectId: "project_1" });
});

it("redirects local worker errors with stable codes", async () => {
  mocks.runLocalWorkerOnce.mockResolvedValue({
    ok: false,
    error: "worker_runtime_not_configured"
  });
  const formData = new FormData();
  formData.set("projectId", "project_1");

  await expectRedirect(
    runLocalWorkerOnceAction(formData),
    "/?view=skills&workerError=worker_runtime_not_configured"
  );
});
```

- [ ] **Step 4: Run Web tests and observe failures**

Run:

```bash
pnpm test apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts
```

Expected: fails because Web store options, `runLocalWorkerOnce()`, and `runLocalWorkerOnceAction()` do not exist.

- [ ] **Step 5: Update Web store types and options**

In `apps/web/src/lib/workbench-store.ts`, import the API queue types:

```ts
import {
  runLocalWorkerOnceAndFinalize,
  type RunLocalWorkerOnceResult,
  type SkillCommandQueueRuntime
} from "@lp-agent/api";
```

Add error type:

```ts
export type WorkerQueueFlowErrorCode =
  | "worker_runtime_not_configured"
  | "worker_job_execution_failed"
  | "worker_job_finalization_failed";
```

Add to `WebWorkbenchStore`:

```ts
runLocalWorkerOnce(input?: { projectId?: string }): Promise<RunLocalWorkerOnceResult>;
```

Add to `WebWorkbenchStoreOptions`:

```ts
workerQueueRuntime?: SkillCommandQueueRuntime;
workerId?: string;
```

Pass queue runtime to the service:

```ts
const workerQueueRuntime = options.workerQueueRuntime;
const workerId = options.workerId ?? "local-web-worker";
const service = new DemoWorkbenchService({
  repositories,
  currentUser,
  toolCommandRunner: options.toolCommandRunner ?? new SimulatedToolCommandRunner(),
  workerQueueRuntime
});
```

- [ ] **Step 6: Make Web skill command execution queue by default when configured**

Replace the `executeSkillCommand` method body in `apps/web/src/lib/workbench-store.ts` with:

```ts
async executeSkillCommand(input) {
  try {
    const value = workerQueueRuntime
      ? await service.enqueueProjectSkillCommand({
          ...input,
          approvedByUserId: currentUser.id
        })
      : await service.executeProjectSkillCommand({
          ...input,
          approvedByUserId: currentUser.id
        });
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: toSkillCommandFlowError(error) };
  }
},
```

Add `skill_command_not_queueable` to `SkillCommandFlowErrorCode` and `toSkillCommandFlowError()`.

- [ ] **Step 7: Add the Web local worker method**

Add this method in the returned store object:

```ts
async runLocalWorkerOnce(input = {}) {
  const result = await runLocalWorkerOnceAndFinalize({
    repositories,
    workerRuntime: workerQueueRuntime,
    workerId
  });
  if (result.ok && input.projectId) {
    await ensureProjectMember({
      repositories,
      projectId: input.projectId,
      user: currentUser
    });
  }
  return result;
},
```

If `ensureProjectMember()` is currently scoped inside `createProject`, extract the existing member-save logic into a small helper in the same file:

```ts
async function ensureProjectMember(input: {
  repositories: WorkbenchRepositories;
  projectId: string;
  user: WorkbenchUserIdentity;
}): Promise<void> {
  const existing = await input.repositories.projectMembers.listForProject(input.projectId);
  if (existing.some((member) => member.userId === input.user.id)) {
    return;
  }
  const now = new Date().toISOString();
  await input.repositories.projectMembers.save({
    id: `project_member_${input.projectId}_${input.user.id}`,
    projectId: input.projectId,
    userId: input.user.id,
    displayName: input.user.displayName,
    role: "owner",
    createdAt: now,
    updatedAt: now
  });
}
```

- [ ] **Step 8: Add the server action**

In `apps/web/src/app/actions.ts`, import the worker error type:

```ts
type WorkerQueueFlowErrorCode
```

Add redirect helper:

```ts
function redirectToSkillsWithWorkerError(error: WorkerQueueFlowErrorCode): never {
  redirect(`/?view=skills&workerError=${encodeURIComponent(error)}`);
}
```

Add the action:

```ts
export async function runLocalWorkerOnceAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  const result = await getWebWorkbenchStore().runLocalWorkerOnce(
    projectId ? { projectId } : {}
  );
  if (!result.ok) {
    redirectToSkillsWithWorkerError(result.error);
  }
  if (projectId) {
    await setCurrentProjectId(projectId);
  }
  revalidatePath("/");
  redirect("/?view=skills");
}
```

- [ ] **Step 9: Run Web verification**

Run:

```bash
pnpm test apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts
pnpm --filter @lp-agent/web typecheck
```

Expected: both commands pass.

- [ ] **Step 10: Commit**

```bash
git add apps/web/package.json apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.ts apps/web/src/app/actions.test.ts
git commit -m "wire web skill commands to worker queue"
```

## Task 5: Add Local Worker Queue Configuration

**Files:**

- Modify: `packages/api/src/skill-command-worker-queue.ts`
- Modify: `packages/api/src/skill-command-worker-queue.test.ts`
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add failing local queue factory tests**

Add these Node imports at the top of `packages/api/src/skill-command-worker-queue.test.ts` before the Vitest import:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
```

Merge `afterEach` into the existing Vitest import:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
```

Add `createLocalWorkerQueueRuntime` to the existing local helper import:

```ts
import { createLocalWorkerQueueRuntime } from "./skill-command-worker-queue";
```

Add this temp cleanup and test below the existing imports and before `describe(...)`:

```ts
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempQueueFiles() {
  const dir = await mkdtemp(join(tmpdir(), "web-worker-queue-"));
  tempDirs.push(dir);
  return {
    jobsFilePath: join(dir, "worker-jobs.json"),
    payloadsFilePath: join(dir, "worker-payloads.json")
  };
}

it("creates a shared JSON-file worker queue runtime", async () => {
  const files = await tempQueueFiles();
  const first = createLocalWorkerQueueRuntime(files);
  await first.runtime.enqueueSafe(
    {
      projectId: "project_1",
      kind: "tool_command",
      commandId: "publish_static",
      command: "static-deploy",
      args: ["--project", "project_1"],
      envNames: ["LP_PROJECT_ID"],
      timeoutMs: 30000
    },
    createSimulatedSandboxPolicy({
      allowedCommands: ["static-deploy"],
      allowedEnvNames: ["LP_PROJECT_ID"]
    })
  );

  const second = createLocalWorkerQueueRuntime(files);
  const claim = await second.runtime.claimOldestQueued({ workerId: "worker_a" });

  expect(claim?.record.id).toBe("worker_job_1");
  expect(await readFile(files.jobsFilePath, "utf8")).toContain("worker_job_1");
  expect(await readFile(files.payloadsFilePath, "utf8")).not.toContain("secret-token");
});
```

- [ ] **Step 2: Run API tests and observe missing factory failure**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: fails because `createLocalWorkerQueueRuntime()` does not exist.

- [ ] **Step 3: Implement the local queue factory**

Add to `packages/api/src/skill-command-worker-queue.ts`:

```ts
import {
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter,
  createJsonFileWorkerJobPayloadRepository,
  createJsonFileWorkerJobRepository,
  type WorkerJobPayloadRepository,
  type WorkerJobRepository
} from "@lp-agent/worker-runtime";

export interface LocalWorkerQueueRuntime {
  runtime: InMemoryWorkerRuntime;
  jobRepository: WorkerJobRepository;
  payloadRepository: WorkerJobPayloadRepository;
}

export function createLocalWorkerQueueRuntime(input: {
  jobsFilePath: string;
  payloadsFilePath: string;
}): LocalWorkerQueueRuntime {
  const jobRepository = createJsonFileWorkerJobRepository({
    filePath: input.jobsFilePath
  });
  const payloadRepository = createJsonFileWorkerJobPayloadRepository({
    filePath: input.payloadsFilePath
  });
  const runtime = new InMemoryWorkerRuntime({
    repository: jobRepository,
    payloadRepository,
    adapter: new SimulatedExecutionAdapter()
  });
  return {
    runtime,
    jobRepository,
    payloadRepository
  };
}
```

Export `createLocalWorkerQueueRuntime` and `LocalWorkerQueueRuntime` from `packages/api/src/index.ts`.

- [ ] **Step 4: Wire default Web store queue config**

In `apps/web/src/lib/workbench-store.ts`, import:

```ts
createLocalWorkerQueueRuntime
```

Add helpers near `defaultWorkbenchStateFilePath()`:

```ts
function defaultWorkerJobsFilePath(): string {
  return process.env.WORKER_JOBS_FILE ?? ".lp-agent/worker-jobs.json";
}

function defaultWorkerPayloadsFilePath(): string {
  return process.env.WORKER_PAYLOADS_FILE ?? ".lp-agent/worker-payloads.json";
}

function defaultWorkerId(): string {
  return process.env.WORKER_ID ?? "local-web-worker";
}
```

Update `getWebWorkbenchStore()`:

```ts
export function getWebWorkbenchStore(): WebWorkbenchStore {
  if (!globalStore.__lpAgentWebWorkbenchStore) {
    const workerQueue = createLocalWorkerQueueRuntime({
      jobsFilePath: defaultWorkerJobsFilePath(),
      payloadsFilePath: defaultWorkerPayloadsFilePath()
    });
    globalStore.__lpAgentWebWorkbenchStore = createWebWorkbenchStore({
      repositories: createJsonFileWorkbenchRepositories({
        filePath: defaultWorkbenchStateFilePath()
      }),
      workerQueueRuntime: workerQueue.runtime,
      workerRuntime: workerQueue.runtime,
      workerId: defaultWorkerId()
    });
  }
  return globalStore.__lpAgentWebWorkbenchStore;
}
```

This shares one local runtime for Web enqueue, Web interrupt, and the Web run-once action.

- [ ] **Step 5: Update `.env.example`**

Add:

```bash
# Local Web worker queue files used by the Stage 13 local worker queue loop.
WORKER_JOBS_FILE=.lp-agent/worker-jobs.json
WORKER_PAYLOADS_FILE=.lp-agent/worker-payloads.json
WORKER_ID=local-web-worker
```

- [ ] **Step 6: Run verification**

Run:

```bash
pnpm --filter @lp-agent/api test
pnpm test apps/web/src/lib/workbench-store.test.ts
pnpm typecheck
```

Expected: all commands pass.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/index.ts packages/api/src/skill-command-worker-queue.ts packages/api/src/skill-command-worker-queue.test.ts apps/web/src/lib/workbench-store.ts .env.example
git commit -m "add local worker queue configuration"
```

## Task 6: Update Web Copy, Timeline, and Skills UI

**Files:**

- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`
- Modify: `apps/web/src/lib/chat-workbench.ts`
- Modify: `apps/web/src/lib/chat-workbench.test.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Add failing i18n tests**

Add to `apps/web/src/lib/i18n.test.ts`:

```ts
it("exposes localized worker queue copy for both locales", () => {
  expect(en.skillsView.approveAndQueue).toBe("Approve and queue");
  expect(zh.skillsView.approveAndQueue).toBe("批准并入队");
  expect(en.skillsView.runLocalWorkerOnce).toBe("Run local worker once");
  expect(zh.skillsView.runLocalWorkerOnce).toBe("运行一次本地 Worker");
  expect(en.skillsView.workerErrors.worker_runtime_not_configured).toContain("Worker");
  expect(zh.skillsView.workerErrors.worker_runtime_not_configured).toContain("Worker");
});
```

- [ ] **Step 2: Add failing timeline tests**

Add to `apps/web/src/lib/chat-workbench.test.ts`:

```ts
it("renders worker linked and cancelled skill command events", () => {
  const thread = createChatThread({
    task: taskRecord(),
    messages: [],
    runEvents: [
      {
        id: "event_1",
        runId: "run_skill_command_1",
        projectId: "project_1",
        taskId: "task_1",
        sequence: 1,
        type: "tool.started",
        message: "Deployment skill command queued.",
        payload: { commandId: "publish_static" },
        createdAt: "2026-05-18T00:00:00.000Z"
      },
      {
        id: "event_2",
        runId: "run_skill_command_1",
        projectId: "project_1",
        taskId: "task_1",
        sequence: 2,
        type: "worker.job.linked",
        message: "Worker job linked to task.",
        payload: { commandId: "publish_static", workerJobId: "worker_job_1" },
        createdAt: "2026-05-18T00:00:01.000Z"
      },
      {
        id: "event_3",
        runId: "run_skill_command_1",
        projectId: "project_1",
        taskId: "task_1",
        sequence: 3,
        type: "tool.cancelled",
        message: "Deployment skill command cancelled.",
        payload: { commandId: "publish_static", workerJobId: "worker_job_1" },
        createdAt: "2026-05-18T00:00:02.000Z"
      }
    ],
    snapshot: undefined,
    copy: en
  });

  expect(thread.tools.map((tool) => tool.status)).toEqual([
    "running",
    "running",
    "cancelled"
  ]);
  expect(thread.tools.map((tool) => tool.meta)).toContain(
    "worker.job.linked - publish_static - worker_job_1"
  );
});
```

- [ ] **Step 3: Add failing page tests**

Update the action import in `apps/web/src/app/page.test.ts`:

```ts
import {
  executeSkillCommandAction,
  runLocalWorkerOnceAction
} from "./actions";
```

Add to `apps/web/src/app/page.test.ts`:

```ts
it("renders queued skill command copy and local worker form", async () => {
  setActiveEmptyProjectState();
  pageMocks.pageState.skillCommands = [
    {
      skillId: "skill_static_deploy",
      skillName: "Static deploy",
      skillVersionId: "skill_version_deploy",
      commandId: "publish_static",
      commandName: "Publish static",
      permission: "deploy:simulate",
      requiresApproval: true
    }
  ];

  const page = await HomePage({ searchParams: Promise.resolve({ view: "skills" }) });
  const text = collectText(page).join(" ");

  expect(text).toContain("Approve and queue");
  expect(text).toContain("Run local worker once");
  expect(
    collectElements(page, "form").some((form) => form.props?.action === runLocalWorkerOnceAction)
  ).toBe(true);
});

it("renders worker queue errors", async () => {
  setActiveEmptyProjectState();

  const page = await HomePage({
    searchParams: Promise.resolve({
      view: "skills",
      workerError: "worker_runtime_not_configured"
    })
  });

  expect(collectText(page).join(" ")).toContain("Local worker runtime is not configured.");
});
```

- [ ] **Step 4: Run Web tests and observe failures**

Run:

```bash
pnpm test apps/web/src/lib/i18n.test.ts apps/web/src/lib/chat-workbench.test.ts apps/web/src/app/page.test.ts
```

Expected: fails because copy keys, timeline mappings, and page UI do not exist.

- [ ] **Step 5: Add localized copy**

In `apps/web/src/lib/i18n.ts`, add these keys under `skillsView` for English:

```ts
approveAndQueue: "Approve and queue",
commandQueueLabel: "Local worker queue",
runLocalWorkerOnce: "Run local worker once",
localWorkerIdle: "No queued worker jobs",
workerErrors: {
  worker_runtime_not_configured: "Local worker runtime is not configured.",
  worker_job_execution_failed: "Local worker job execution failed.",
  worker_job_finalization_failed: "Worker result could not be finalized."
}
```

Add Chinese equivalents:

```ts
approveAndQueue: "批准并入队",
commandQueueLabel: "本地 Worker 队列",
runLocalWorkerOnce: "运行一次本地 Worker",
localWorkerIdle: "当前没有排队的 Worker 任务",
workerErrors: {
  worker_runtime_not_configured: "本地 Worker runtime 未配置。",
  worker_job_execution_failed: "本地 Worker 任务执行失败。",
  worker_job_finalization_failed: "Worker 结果无法写回运行状态。"
}
```

- [ ] **Step 6: Render worker events in chat timeline**

In `apps/web/src/lib/chat-workbench.ts`, update the event mapping:

```ts
if (event.type === "worker.job.linked") {
  return {
    id: event.id,
    title: copy.chat.toolTitles.workerLinked,
    meta: createToolMeta(event),
    status: "running"
  };
}

if (event.type === "tool.cancelled" || event.type === "run.cancelled") {
  return {
    id: event.id,
    title: copy.chat.toolTitles.cancelled,
    meta: createToolMeta(event),
    status: "cancelled"
  };
}
```

If `toolTitles.workerLinked` does not exist, add it to the chat copy:

```ts
workerLinked: "Worker job linked"
```

and Chinese:

```ts
workerLinked: "Worker 任务已关联"
```

Update `createToolMeta()` so `workerJobId` is appended:

```ts
const workerJobId = toDisplayValue(event.payload.workerJobId);
if (workerJobId) {
  parts.push(workerJobId);
}
```

- [ ] **Step 7: Update Skills page UI**

In `apps/web/src/app/page.tsx`, import:

```ts
runLocalWorkerOnceAction
```

Parse worker error:

```ts
const workerError = parseWorkerQueueError(search.workerError);
```

Add parser near existing error parsers:

```ts
function parseWorkerQueueError(value: unknown): WorkerQueueFlowErrorCode | undefined {
  return value === "worker_runtime_not_configured" ||
    value === "worker_job_execution_failed" ||
    value === "worker_job_finalization_failed"
    ? value
    : undefined;
}
```

Change the skill command button label:

```tsx
{copy.skillsView.approveAndQueue}
```

Add the local worker panel inside the Skills view:

```tsx
<section className="localWorkerPanel" aria-labelledby="local-worker-title">
  <div>
    <h2 id="local-worker-title">{copy.skillsView.commandQueueLabel}</h2>
    <p>{copy.skillsView.localWorkerIdle}</p>
  </div>
  {activeProjectId ? (
    <form action={runLocalWorkerOnceAction}>
      <input type="hidden" name="projectId" value={activeProjectId} />
      <button type="submit">{copy.skillsView.runLocalWorkerOnce}</button>
    </form>
  ) : null}
</section>
{workerError ? (
  <p className="formError">{copy.skillsView.workerErrors[workerError]}</p>
) : null}
```

- [ ] **Step 8: Add styling**

In `apps/web/src/app/globals.css`, add:

```css
.localWorkerPanel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 14px 16px;
  background: var(--surface-raised);
}

.localWorkerPanel h2 {
  margin: 0;
  font-size: 0.95rem;
}

.localWorkerPanel p {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 0.85rem;
}
```

- [ ] **Step 9: Run Web verification**

Run:

```bash
pnpm test apps/web/src/lib/i18n.test.ts apps/web/src/lib/chat-workbench.test.ts apps/web/src/app/page.test.ts
pnpm --filter @lp-agent/web typecheck
```

Expected: both commands pass.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/i18n.ts apps/web/src/lib/i18n.test.ts apps/web/src/lib/chat-workbench.ts apps/web/src/lib/chat-workbench.test.ts apps/web/src/app/page.tsx apps/web/src/app/page.test.ts apps/web/src/app/globals.css
git commit -m "add web worker queue controls"
```

## Task 7: Documentation and Final Verification

**Files:**

- Modify: `docs/agent-development-learning.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Update Stage 13 learning status**

In `docs/agent-development-learning.md`, replace the Stage 13 current plan text:

```md
当前计划：

- [2026-05-18-web-worker-queue-integration.md](./superpowers/plans/2026-05-18-web-worker-queue-integration.md)

当前实现状态：

- Stage 13 v0 已把 Web deployment skill command 接到本地 safe worker queue：Web 负责批准并入队，API 写入 run/tool/worker link，`Run local worker once` 最多执行一个 queued job 并把结果 finalization 回 run 和 observation。
- 当前仍只支持 safe simulated worker payload，不做 daemon、真实 shell、MCP execution、真实部署、streaming logs、secret payload 或 durable artifact workspace replay。
```

- [ ] **Step 2: Add the plan to the Superpowers index**

In `docs/superpowers/README.md`, add after item 54:

```md
55. `plans/2026-05-18-web-worker-queue-integration.md`
   - Stage 13 Web worker queue integration v0 implementation plan.
   - Read this after the Stage 13 design when implementing or auditing queued Web skill command execution, local worker run-once action, worker result finalization, localized queue controls, and safe worker queue configuration.
```

- [ ] **Step 3: Run targeted verification**

Run:

```bash
pnpm --filter @lp-agent/db test
pnpm --filter @lp-agent/api test
pnpm test apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts apps/web/src/lib/i18n.test.ts apps/web/src/lib/chat-workbench.test.ts apps/web/src/app/page.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected:

- all Vitest suites pass, except existing opt-in integration tests remain skipped;
- typecheck passes;
- build passes;
- `git diff --check` prints no output.

- [ ] **Step 5: Commit docs**

```bash
git add docs/agent-development-learning.md docs/superpowers/README.md
git commit -m "document web worker queue implementation"
```

## Plan Self-Review

- Spec coverage: the plan covers queued Web skill commands, safe worker payloads, `worker.job.linked`, local run-once action, finalization, timeline rendering, interrupt compatibility through the existing worker link event, localized errors, and queue configuration.
- Scope guard: the plan explicitly excludes daemon workers, real shell, MCP execution, real deployment, streaming logs, secret payloads, and durable artifact workspace replay.
- Type consistency: `RunLocalWorkerOnceResult`, `SkillCommandQueueRuntime`, `enqueueProjectSkillCommand()`, `workerQueueRuntime`, `runLocalWorkerOnce()`, and `runLocalWorkerOnceAction()` are defined before later tasks use them.
- Testability: each task starts with failing tests, then implementation, then targeted verification and commit.
