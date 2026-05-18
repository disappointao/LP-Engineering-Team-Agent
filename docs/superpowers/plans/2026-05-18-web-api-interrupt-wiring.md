# Web/API Interrupt Wiring v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a current-task Web interrupt path that routes through API-owned task/run/worker state, shows an optimistic stopping button, and renders cancellation as a normal stopped timeline state.

**Architecture:** Add a focused `@lp-agent/api` task-interrupt helper that derives interrupt targets from safe run events and calls the existing worker runtime cancellation API. Wire that helper through the Web store, server action, page model, localized copy, and chat timeline rendering without expanding Web task records into a scheduler.

**Tech Stack:** pnpm workspace, TypeScript, Vitest, Next.js server actions, React 19 `useFormStatus`, `@lp-agent/api`, `@lp-agent/db`, `@lp-agent/worker-runtime`.

---

## Scope Guard

This plan implements only `docs/superpowers/specs/2026-05-18-web-api-interrupt-wiring-design.md`.

It must not add:

- real shell execution;
- `child_process`, `spawn`, `exec`, shell signals, or process killing;
- MCP execution;
- deployment execution;
- streaming stdout/stderr or token streaming;
- worker daemon polling or lifecycle controls;
- bulk task/project cancellation;
- retry/resume semantics;
- client-supplied worker job id cancellation.

The client expresses only this intent: stop the current task. The API determines which run and worker job belong to that task.

## File Structure

- Create: `packages/api/src/task-interrupts.ts`
  - Own the interrupt result types, derived interrupt view, worker-job link event helper, and task interrupt operation.
- Create: `packages/api/src/task-interrupts.test.ts`
  - Cover queued cancellation, running cancellation request, stale terminal jobs, missing task, and missing worker target.
- Modify: `packages/api/src/index.ts`
  - Export the new task interrupt types and helpers.
- Modify: `packages/api/package.json`
  - Include `src/task-interrupts.test.ts` in the package test script.
- Modify: `apps/web/src/lib/workbench-store.ts`
  - Add `TaskInterruptView`, `InterruptTaskResult`, `InterruptFlowErrorCode`, `workerRuntime` injection, `interruptCurrentTask()`, and `pageState.interrupt`.
- Modify: `apps/web/src/lib/workbench-store.test.ts`
  - Cover default non-interruptible page state and store-level current-task interrupt routing.
- Modify: `apps/web/src/app/actions.ts`
  - Add `interruptCurrentTaskAction()` that reads the current task cookie and never accepts a client worker job id.
- Modify: `apps/web/src/app/actions.test.ts`
  - Cover successful interrupt action, missing current task, and store interrupt failure redirects.
- Modify: `apps/web/src/lib/i18n.ts`
  - Add interrupt error/status copy and chat tool running/cancelled status labels in English and Chinese.
- Modify: `apps/web/src/lib/i18n.test.ts`
  - Cover the new localized interrupt labels.
- Create: `apps/web/src/app/interrupt-submit-button.tsx`
  - Client component using `useFormStatus()` for optimistic stopping state.
- Create: `apps/web/src/app/interrupt-submit-button.test.tsx`
  - Unit test the idle, disabled, and pending stopping states by mocking `useFormStatus()`.
- Modify: `apps/web/src/app/page.tsx`
  - Parse `interruptError`, render interrupt errors, pass `pageState.interrupt` to the composer button, and add `data-status` to tool timeline rows.
- Modify: `apps/web/src/app/page.test.ts`
  - Cover enabled/disabled interrupt button rendering and localized interrupt errors.
- Modify: `apps/web/src/lib/chat-workbench.ts`
  - Expand `ChatToolStatus` with `running` and `cancelled`; map interrupt and cancelled run events separately from failures.
- Modify: `apps/web/src/lib/chat-workbench.test.ts`
  - Cover cancelled and running/stopping timeline states.
- Modify: `apps/web/src/app/globals.css`
  - Add small visual states for disabled/stopping interrupt button and cancelled/running tool timeline rows.
- Modify: `docs/agent-development-learning.md`
  - Link this plan under Stage 12.
- Modify: `docs/superpowers/README.md`
  - Add this plan as the next reading-order item after the Stage 12 spec.

## Task 1: API Task Interrupt Helper

**Files:**

- Create: `packages/api/src/task-interrupts.ts`
- Create: `packages/api/src/task-interrupts.test.ts`
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/package.json`

- [ ] **Step 1: Write failing API helper tests**

Create `packages/api/src/task-interrupts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInMemoryWorkbenchRepositories } from "@lp-agent/db";
import {
  InMemoryWorkerRuntime,
  createRejectSandboxPolicy,
  createSimulatedSandboxPolicy,
  type ExecutionAdapter,
  type ExecutionContext,
  type ExecutionInput,
  type ExecutionResult,
  type SandboxPolicy
} from "@lp-agent/worker-runtime";
import {
  deriveTaskInterruptView,
  interruptTask,
  linkWorkerJobToTask
} from "./task-interrupts";

function fixedNow(values: string[] = []) {
  const queue = [...values];
  return () => new Date(queue.shift() ?? "2026-05-18T00:00:10.000Z");
}

async function saveTaskAndRun(input: {
  repositories: ReturnType<typeof createInMemoryWorkbenchRepositories>;
  taskId?: string;
  projectId?: string;
  runId?: string;
}) {
  const taskId = input.taskId ?? "task_1";
  const projectId = input.projectId ?? "project_1";
  const runId = input.runId ?? "run_interrupt_1";
  await input.repositories.projects.save({
    id: projectId,
    name: "Project",
    createdAt: "2026-05-18T00:00:00.000Z"
  });
  await input.repositories.tasks.save({
    id: taskId,
    title: "Interruptible task",
    type: "lp_generation",
    status: "complete",
    projectId,
    createdAt: "2026-05-18T00:00:00.000Z"
  });
  await input.repositories.runs.save({
    id: runId,
    projectId,
    taskId,
    role: "deployer",
    state: "running",
    startedAt: "2026-05-18T00:00:00.000Z",
    contextSummary: {
      injected: ["workerJob:worker_job_1"],
      omitted: []
    }
  });
  return { taskId, projectId, runId };
}

describe("task interrupts", () => {
  it("cancels a queued linked worker job and records durable interrupt events", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const { taskId, projectId, runId } = await saveTaskAndRun({ repositories });
    const now = fixedNow([
      "2026-05-18T00:00:01.000Z",
      "2026-05-18T00:00:02.000Z",
      "2026-05-18T00:00:03.000Z",
      "2026-05-18T00:00:04.000Z"
    ]);
    const workerRuntime = new InMemoryWorkerRuntime({ now });
    const workerJob = await workerRuntime.enqueue(
      {
        projectId,
        kind: "tool_command",
        command: "static-deploy",
        args: [],
        env: {},
        timeoutMs: 1000
      },
      createRejectSandboxPolicy()
    );
    await linkWorkerJobToTask({
      repositories,
      taskId,
      projectId,
      runId,
      workerJobId: workerJob.id,
      now
    });

    const result = await interruptTask({
      repositories,
      workerRuntime,
      taskId,
      reason: "User interrupted the task.",
      now
    });

    await expect(workerRuntime.getJob(workerJob.id)).resolves.toMatchObject({
      state: "cancelled",
      errorName: "worker_job_cancelled",
      cancelReason: "User interrupted the task."
    });
    await expect(repositories.runs.getById(runId)).resolves.toMatchObject({
      state: "cancelled"
    });
    await expect(repositories.runEvents.listForRun(runId)).resolves.toEqual([
      expect.objectContaining({ type: "worker.job.linked" }),
      expect.objectContaining({ type: "task.interrupt.requested" }),
      expect.objectContaining({ type: "task.interrupt.cancelled" })
    ]);
    expect(result).toEqual({
      ok: true,
      taskId,
      state: "cancelled",
      runId,
      workerJobId: workerJob.id
    });
  });

  it("records a running worker cancellation request without marking the run cancelled", async () => {
    class DeferredAdapter implements ExecutionAdapter {
      private startedResolve: (() => void) | undefined;
      private finishResolve: (() => void) | undefined;
      readonly started = new Promise<void>((resolve) => {
        this.startedResolve = resolve;
      });
      readonly finish = new Promise<void>((resolve) => {
        this.finishResolve = resolve;
      });

      release() {
        this.finishResolve?.();
      }

      async execute(
        _input: ExecutionInput,
        _policy: SandboxPolicy,
        context: ExecutionContext
      ): Promise<ExecutionResult> {
        this.startedResolve?.();
        await this.finish;
        if (await context.isCancellationRequested()) {
          return {
            state: "cancelled",
            stdout: "",
            stderr: "Worker job cancelled.",
            errorName: "worker_job_cancelled"
          };
        }
        return {
          state: "completed",
          exitCode: 0,
          stdout: "done",
          stderr: ""
        };
      }
    }

    const repositories = createInMemoryWorkbenchRepositories();
    const { taskId, projectId, runId } = await saveTaskAndRun({ repositories });
    const adapter = new DeferredAdapter();
    const now = fixedNow([
      "2026-05-18T00:01:01.000Z",
      "2026-05-18T00:01:02.000Z",
      "2026-05-18T00:01:03.000Z",
      "2026-05-18T00:01:04.000Z"
    ]);
    const workerRuntime = new InMemoryWorkerRuntime({ adapter, now });
    const workerJob = await workerRuntime.enqueue(
      {
        projectId,
        kind: "tool_command",
        command: "static-deploy",
        args: [],
        env: {},
        timeoutMs: 1000
      },
      createSimulatedSandboxPolicy({ allowedCommands: ["static-deploy"] })
    );
    await linkWorkerJobToTask({
      repositories,
      taskId,
      projectId,
      runId,
      workerJobId: workerJob.id,
      now
    });

    const runPromise = workerRuntime.runNext();
    await adapter.started;
    const result = await interruptTask({
      repositories,
      workerRuntime,
      taskId,
      reason: "Stop this task.",
      now
    });
    const runningView = await deriveTaskInterruptView({
      repositories,
      workerRuntime,
      taskId
    });

    expect(result).toEqual({
      ok: true,
      taskId,
      state: "interrupt_requested",
      runId,
      workerJobId: workerJob.id
    });
    expect(runningView).toMatchObject({
      available: true,
      state: "stopping",
      runId,
      workerJobId: workerJob.id
    });
    await expect(repositories.runs.getById(runId)).resolves.toMatchObject({
      state: "running"
    });

    adapter.release();
    await expect(runPromise).resolves.toMatchObject({ state: "cancelled" });
  });

  it("does not mutate terminal completed worker jobs", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const { taskId, projectId, runId } = await saveTaskAndRun({ repositories });
    const now = fixedNow();
    const workerRuntime = new InMemoryWorkerRuntime({ now });
    const workerJob = await workerRuntime.enqueue(
      {
        projectId,
        kind: "tool_command",
        command: "static-deploy",
        args: [],
        env: {},
        timeoutMs: 1000
      },
      createSimulatedSandboxPolicy({ allowedCommands: ["static-deploy"] })
    );
    await workerRuntime.runNext();
    await linkWorkerJobToTask({
      repositories,
      taskId,
      projectId,
      runId,
      workerJobId: workerJob.id,
      now
    });

    const result = await interruptTask({
      repositories,
      workerRuntime,
      taskId,
      reason: "Too late",
      now
    });

    expect(result).toEqual({
      ok: true,
      taskId,
      state: "not_interruptible",
      runId,
      workerJobId: workerJob.id
    });
    await expect(workerRuntime.getJob(workerJob.id)).resolves.toMatchObject({
      state: "completed",
      cancelRequestedAt: undefined
    });
  });

  it("returns deterministic errors for missing tasks and missing worker targets", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const { taskId, projectId, runId } = await saveTaskAndRun({ repositories });
    const workerRuntime = new InMemoryWorkerRuntime();
    await linkWorkerJobToTask({
      repositories,
      taskId,
      projectId,
      runId,
      workerJobId: "worker_job_missing",
      now: fixedNow()
    });

    await expect(
      interruptTask({
        repositories,
        workerRuntime,
        taskId: "task_missing",
        reason: "Stop",
        now: fixedNow()
      })
    ).resolves.toEqual({
      ok: false,
      error: "task_not_found"
    });
    await expect(
      interruptTask({
        repositories,
        workerRuntime,
        taskId,
        reason: "Stop",
        now: fixedNow()
      })
    ).resolves.toEqual({
      ok: false,
      error: "interrupt_target_not_found"
    });
  });
});
```

- [ ] **Step 2: Add the new API test to the package script and verify failure**

Modify `packages/api/package.json`:

```json
"test": "vitest run src/task-interrupts.test.ts src/structured-lp-brief.test.ts src/structured-static-artifacts.test.ts src/skill-command-execution.test.ts src/worker-backed-tool-command-runner.test.ts src/run-orchestrator.test.ts src/context-memory.test.ts src/agent-handoffs.test.ts src/services.test.ts"
```

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: fails because `packages/api/src/task-interrupts.ts` does not exist.

- [ ] **Step 3: Implement the API helper**

Create `packages/api/src/task-interrupts.ts`:

```ts
import type {
  RunEventRecord,
  RunRecord,
  WorkbenchRepositories,
  WorkbenchTaskRecord
} from "@lp-agent/db";
import type { WorkerJobRecord, WorkerRuntime } from "@lp-agent/worker-runtime";

export type TaskInterruptState =
  | "idle"
  | "stopping"
  | "cancelled"
  | "not_interruptible";

export interface TaskInterruptView {
  available: boolean;
  state: TaskInterruptState;
  runId?: string;
  workerJobId?: string;
  requestedAt?: string;
}

export type InterruptTaskResult =
  | {
      ok: true;
      taskId: string;
      state: "interrupt_requested" | "cancelled" | "not_interruptible";
      runId?: string;
      workerJobId?: string;
    }
  | {
      ok: false;
      error:
        | "task_not_found"
        | "task_not_interruptible"
        | "interrupt_target_not_found"
        | "interrupt_failed";
    };

export type TaskInterruptWorkerRuntime = Pick<WorkerRuntime, "cancelJob" | "getJob">;

interface InterruptTarget {
  task: WorkbenchTaskRecord;
  runId: string;
  projectId: string;
  workerJobId: string;
  requestedAt?: string;
}

export async function linkWorkerJobToTask(input: {
  repositories: WorkbenchRepositories;
  taskId: string;
  projectId: string;
  runId: string;
  workerJobId: string;
  now?: () => Date;
}): Promise<RunEventRecord> {
  const sequence = await nextRunEventSequence(input.repositories, input.runId);
  const event: RunEventRecord = {
    id: `${input.runId}_event_${sequence}`,
    runId: input.runId,
    projectId: input.projectId,
    taskId: input.taskId,
    sequence,
    type: "worker.job.linked",
    message: "Worker job linked to task.",
    payload: {
      taskId: input.taskId,
      runId: input.runId,
      workerJobId: input.workerJobId
    },
    createdAt: timestamp(input.now)
  };
  await input.repositories.runEvents.save(event);
  return { ...event, payload: { ...event.payload } };
}

export async function deriveTaskInterruptView(input: {
  repositories: WorkbenchRepositories;
  taskId: string;
  workerRuntime?: TaskInterruptWorkerRuntime;
}): Promise<TaskInterruptView> {
  const target = await findInterruptTarget(input.repositories, input.taskId);
  if (!target || !input.workerRuntime) {
    return {
      available: false,
      state: "not_interruptible"
    };
  }

  const job = await input.workerRuntime.getJob(target.workerJobId);
  if (!job) {
    return {
      available: false,
      state: "not_interruptible",
      runId: target.runId,
      workerJobId: target.workerJobId
    };
  }

  if (job.state === "queued") {
    return {
      available: true,
      state: "idle",
      runId: target.runId,
      workerJobId: target.workerJobId
    };
  }
  if (job.state === "running") {
    return {
      available: true,
      state: job.cancelRequestedAt ? "stopping" : "idle",
      runId: target.runId,
      workerJobId: target.workerJobId,
      requestedAt: job.cancelRequestedAt
    };
  }
  if (job.state === "cancelled") {
    return {
      available: false,
      state: "cancelled",
      runId: target.runId,
      workerJobId: target.workerJobId,
      requestedAt: job.cancelRequestedAt
    };
  }

  return {
    available: false,
    state: "not_interruptible",
    runId: target.runId,
    workerJobId: target.workerJobId
  };
}

export async function interruptTask(input: {
  repositories: WorkbenchRepositories;
  workerRuntime?: TaskInterruptWorkerRuntime;
  taskId: string;
  reason?: string;
  now?: () => Date;
}): Promise<InterruptTaskResult> {
  const task = await input.repositories.tasks.getById(input.taskId);
  if (!task) {
    return { ok: false, error: "task_not_found" };
  }

  const target = await findInterruptTarget(input.repositories, task.id);
  if (!target) {
    return {
      ok: true,
      taskId: task.id,
      state: "not_interruptible"
    };
  }
  if (!input.workerRuntime) {
    return { ok: false, error: "interrupt_target_not_found" };
  }

  const before = await input.workerRuntime.getJob(target.workerJobId);
  if (!before) {
    return { ok: false, error: "interrupt_target_not_found" };
  }
  if (before.state === "completed" || before.state === "failed" || before.state === "rejected") {
    return {
      ok: true,
      taskId: task.id,
      state: "not_interruptible",
      runId: target.runId,
      workerJobId: target.workerJobId
    };
  }
  if (before.state === "cancelled") {
    await markRunCancelled(input.repositories, target.runId, timestamp(input.now));
    return {
      ok: true,
      taskId: task.id,
      state: "cancelled",
      runId: target.runId,
      workerJobId: target.workerJobId
    };
  }

  await saveInterruptEvent({
    repositories: input.repositories,
    target,
    type: "task.interrupt.requested",
    message: "Task interrupt requested.",
    now: input.now
  });

  let after: WorkerJobRecord | undefined;
  try {
    after = await input.workerRuntime.cancelJob(target.workerJobId, input.reason);
  } catch {
    return { ok: false, error: "interrupt_failed" };
  }
  if (!after) {
    return { ok: false, error: "interrupt_target_not_found" };
  }

  if (after.state === "cancelled") {
    await markRunCancelled(input.repositories, target.runId, after.completedAt ?? timestamp(input.now));
    await saveInterruptEvent({
      repositories: input.repositories,
      target,
      type: "task.interrupt.cancelled",
      message: "Task interrupted.",
      now: input.now
    });
    return {
      ok: true,
      taskId: task.id,
      state: "cancelled",
      runId: target.runId,
      workerJobId: target.workerJobId
    };
  }

  return {
    ok: true,
    taskId: task.id,
    state: "interrupt_requested",
    runId: target.runId,
    workerJobId: target.workerJobId
  };
}

async function findInterruptTarget(
  repositories: WorkbenchRepositories,
  taskId: string
): Promise<InterruptTarget | undefined> {
  const task = await repositories.tasks.getById(taskId);
  if (!task) {
    return undefined;
  }
  const events = await repositories.runEvents.listForTask(taskId);
  const linked = [...events].reverse().find((event) => event.type === "worker.job.linked");
  if (!linked) {
    return undefined;
  }
  const runId = toStringValue(linked.payload.runId) ?? linked.runId;
  const workerJobId = toStringValue(linked.payload.workerJobId);
  if (!workerJobId) {
    return undefined;
  }
  return {
    task,
    runId,
    projectId: linked.projectId,
    workerJobId
  };
}

async function saveInterruptEvent(input: {
  repositories: WorkbenchRepositories;
  target: InterruptTarget;
  type: "task.interrupt.requested" | "task.interrupt.cancelled";
  message: string;
  now?: () => Date;
}): Promise<void> {
  const sequence = await nextRunEventSequence(input.repositories, input.target.runId);
  await input.repositories.runEvents.save({
    id: `${input.target.runId}_event_${sequence}`,
    runId: input.target.runId,
    projectId: input.target.projectId,
    taskId: input.target.task.id,
    sequence,
    type: input.type,
    message: input.message,
    payload: {
      taskId: input.target.task.id,
      runId: input.target.runId,
      workerJobId: input.target.workerJobId
    },
    createdAt: timestamp(input.now)
  });
}

async function markRunCancelled(
  repositories: WorkbenchRepositories,
  runId: string,
  completedAt: string
): Promise<void> {
  const run = await repositories.runs.getById(runId);
  if (!run || isTerminalRun(run)) {
    return;
  }
  await repositories.runs.save({
    ...run,
    state: "cancelled",
    completedAt
  });
}

function isTerminalRun(run: RunRecord): boolean {
  return run.state === "completed" || run.state === "failed" || run.state === "cancelled";
}

async function nextRunEventSequence(
  repositories: WorkbenchRepositories,
  runId: string
): Promise<number> {
  const events = await repositories.runEvents.listForRun(runId);
  return Math.max(0, ...events.map((event) => event.sequence)) + 1;
}

function timestamp(now?: () => Date): string {
  return (now ?? (() => new Date()))().toISOString();
}

function toStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
```

- [ ] **Step 4: Export the helper from API**

In `packages/api/src/index.ts`, add:

```ts
export {
  deriveTaskInterruptView,
  interruptTask,
  linkWorkerJobToTask,
  type InterruptTaskResult,
  type TaskInterruptState,
  type TaskInterruptView,
  type TaskInterruptWorkerRuntime
} from "./task-interrupts";
```

- [ ] **Step 5: Run and commit API helper**

Run:

```bash
pnpm --filter @lp-agent/api test
pnpm --filter @lp-agent/api typecheck
```

Expected: both pass.

Commit:

```bash
git add packages/api/src/task-interrupts.ts packages/api/src/task-interrupts.test.ts packages/api/src/index.ts packages/api/package.json
git commit -m "add task interrupt api helper"
```

## Task 2: Web Store Interrupt Contract

**Files:**

- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`

- [ ] **Step 1: Add failing Web store tests**

Append these tests inside `describe("web workbench store", ...)` in `apps/web/src/lib/workbench-store.test.ts`:

```ts
  it("exposes a non-interruptible task interrupt view by default", async () => {
    const store = createWebWorkbenchStore();
    const result = await store.submitTaskPrompt({
      prompt: "Help me write a campaign plan.",
      implicitProjectName: "Untitled LP Project"
    });
    if (!result.ok) {
      throw new Error("Expected task submission to succeed.");
    }

    const pageState = await store.getPageState({ taskId: result.taskId });

    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageState.interrupt).toEqual({
      available: false,
      state: "not_interruptible"
    });
  });

  it("interrupts the current task through the injected worker runtime", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.projects.save({
      id: "project_1",
      name: "Project",
      createdAt: "2026-05-18T00:00:00.000Z"
    });
    await repositories.tasks.save({
      id: "task_1",
      title: "Interruptible task",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-18T00:00:00.000Z"
    });
    await repositories.messages.save({
      id: "message_1",
      taskId: "task_1",
      role: "user",
      content: "Deploy this",
      createdAt: "2026-05-18T00:00:00.000Z"
    });
    await repositories.runs.save({
      id: "run_interrupt_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "deployer",
      state: "running",
      startedAt: "2026-05-18T00:00:00.000Z",
      contextSummary: {
        injected: [],
        omitted: []
      }
    });
    await repositories.runEvents.save({
      id: "run_interrupt_1_event_1",
      runId: "run_interrupt_1",
      projectId: "project_1",
      taskId: "task_1",
      sequence: 1,
      type: "worker.job.linked",
      message: "Worker job linked to task.",
      payload: {
        taskId: "task_1",
        runId: "run_interrupt_1",
        workerJobId: "worker_job_1"
      },
      createdAt: "2026-05-18T00:00:00.000Z"
    });
    const workerJob = {
      id: "worker_job_1",
      projectId: "project_1",
      kind: "tool_command" as const,
      state: "queued" as const,
      policy: {
        mode: "reject" as const,
        allowedCommands: [],
        timeoutMs: 1000,
        allowedEnvNames: [],
        maxStdoutBytes: 300,
        maxStderrBytes: 300,
        network: "disabled" as const
      },
      inputSummary: {
        projectId: "project_1",
        kind: "tool_command" as const,
        command: "static-deploy",
        argCount: 0,
        envNames: [],
        timeoutMs: 1000
      },
      createdAt: "2026-05-18T00:00:00.000Z"
    };
    const workerRuntime = {
      getJob: vi.fn(async () => workerJob),
      cancelJob: vi.fn(async () => ({
        ...workerJob,
        state: "cancelled" as const,
        completedAt: "2026-05-18T00:00:01.000Z",
        cancelRequestedAt: "2026-05-18T00:00:01.000Z",
        cancelledAt: "2026-05-18T00:00:01.000Z",
        errorName: "worker_job_cancelled",
        resultSummary: {
          state: "cancelled" as const,
          stdout: "",
          stderr: "Worker job cancelled before execution.",
          stdoutBytes: 0,
          stderrBytes: 38,
          errorName: "worker_job_cancelled"
        }
      }))
    };
    const store = createWebWorkbenchStore({
      repositories,
      workerRuntime,
      currentUser: {
        id: "local-web-user",
        displayName: "Local user"
      }
    });

    const before = await store.getPageState({ taskId: "task_1" });
    const result = await store.interruptCurrentTask({
      taskId: "task_1",
      reason: "User interrupted the task."
    });

    expect(before.kind).toBe("task_ready");
    if (before.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(before.interrupt).toMatchObject({
      available: true,
      state: "idle",
      runId: "run_interrupt_1",
      workerJobId: "worker_job_1"
    });
    expect(result).toEqual({
      ok: true,
      taskId: "task_1",
      state: "cancelled",
      runId: "run_interrupt_1",
      workerJobId: "worker_job_1"
    });
    expect(workerRuntime.cancelJob).toHaveBeenCalledWith(
      "worker_job_1",
      "User interrupted the task."
    );
  });
```

Add `vi` to the existing import:

```ts
import { describe, expect, it, vi } from "vitest";
```

- [ ] **Step 2: Run the Web store tests and observe failure**

Run:

```bash
pnpm test -- apps/web/src/lib/workbench-store.test.ts
```

Expected: fails because `pageState.interrupt`, `workerRuntime` option, and `interruptCurrentTask()` do not exist.

- [ ] **Step 3: Add store types and worker runtime injection**

In `apps/web/src/lib/workbench-store.ts`, extend the API import:

```ts
  deriveTaskInterruptView,
  interruptTask,
  type InterruptTaskResult,
  type TaskInterruptView,
  type TaskInterruptWorkerRuntime,
```

Add exported types near the existing flow error types:

```ts
export type InterruptFlowErrorCode =
  | "task_not_found"
  | "task_not_interruptible"
  | "interrupt_target_not_found"
  | "interrupt_failed";

export type TaskInterrupt = TaskInterruptView;
export type InterruptCurrentTaskResult = InterruptTaskResult;
```

Add `interrupt` to the `task_ready` state:

```ts
      interrupt: TaskInterrupt;
```

Add the store option:

```ts
  workerRuntime?: TaskInterruptWorkerRuntime;
```

Add the method to `WebWorkbenchStore`:

```ts
  interruptCurrentTask(input: {
    taskId: string;
    reason?: string;
  }): Promise<InterruptCurrentTaskResult>;
```

Inside `createWebWorkbenchStore()`, keep:

```ts
  const workerRuntime = options.workerRuntime;
```

- [ ] **Step 4: Derive the page interrupt view and implement store action**

In the `task_ready` return object in `getPageState()`, add:

```ts
        interrupt: await deriveTaskInterruptView({
          repositories,
          workerRuntime,
          taskId: task.id
        }),
```

Add this method to the returned store object before `createSkillDraft`:

```ts
    async interruptCurrentTask(input) {
      return interruptTask({
        repositories,
        workerRuntime,
        taskId: input.taskId,
        reason: input.reason
      });
    },
```

- [ ] **Step 5: Run and commit Web store contract**

Run:

```bash
pnpm test -- apps/web/src/lib/workbench-store.test.ts
pnpm --filter @lp-agent/web typecheck
```

Expected: both pass.

Commit:

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts
git commit -m "wire task interrupt into web store"
```

## Task 3: Server Action and Localized Copy

**Files:**

- Modify: `apps/web/src/app/actions.ts`
- Modify: `apps/web/src/app/actions.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`

- [ ] **Step 1: Add failing action tests**

In `apps/web/src/app/actions.test.ts`, update the hoisted mocks:

```ts
  currentTaskId: undefined as string | undefined,
  interruptCurrentTask: vi.fn(),
```

Update the `../lib/workbench-session` mock:

```ts
  getCurrentTaskId: vi.fn(async () => mocks.currentTaskId),
```

Update the `getWebWorkbenchStore()` mock object:

```ts
    interruptCurrentTask: mocks.interruptCurrentTask,
```

Add `interruptCurrentTaskAction` to the import from `./actions`.

In the `beforeEach()` inside `describe("submitPromptAction", ...)`, add:

```ts
    mocks.currentTaskId = "task_1";
    mocks.interruptCurrentTask.mockReset();
    mocks.interruptCurrentTask.mockResolvedValue({
      ok: true,
      taskId: "task_1",
      state: "interrupt_requested"
    });
```

Append these tests:

```ts
  it("interrupts the current task from the session cookie", async () => {
    const formData = new FormData();
    formData.set("workerJobId", "worker_job_from_client");

    await expectRedirect(interruptCurrentTaskAction(formData), "/");

    expect(mocks.interruptCurrentTask).toHaveBeenCalledWith({
      taskId: "task_1",
      reason: "User interrupted the task."
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("redirects interrupt requests without a current task", async () => {
    mocks.currentTaskId = undefined;

    await expectRedirect(
      interruptCurrentTaskAction(new FormData()),
      "/?interruptError=task_not_found"
    );

    expect(mocks.interruptCurrentTask).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("redirects interrupt store errors with a bounded query code", async () => {
    mocks.interruptCurrentTask.mockResolvedValue({
      ok: false,
      error: "interrupt_failed"
    });

    await expectRedirect(
      interruptCurrentTaskAction(new FormData()),
      "/?interruptError=interrupt_failed"
    );

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Add failing i18n tests**

In `apps/web/src/lib/i18n.test.ts`, add assertions to the existing English and Chinese copy tests:

```ts
    expect(en.interruptFlow.errors.task_not_found).toBe("No current task to interrupt.");
    expect(en.chat.interruptStoppingLabel).toBe("Stopping...");
    expect(en.chat.toolStatusCancelled).toBe("Stopped");
```

```ts
    expect(zh.interruptFlow.errors.task_not_found).toBe("当前没有可打断的任务。");
    expect(zh.chat.interruptStoppingLabel).toBe("正在停止...");
    expect(zh.chat.toolStatusCancelled).toBe("已停止");
```

Run:

```bash
pnpm test -- apps/web/src/app/actions.test.ts apps/web/src/lib/i18n.test.ts
```

Expected: fails because the action and copy fields do not exist.

- [ ] **Step 3: Implement interrupt copy**

In `apps/web/src/lib/i18n.ts`, import `InterruptFlowErrorCode` from `workbench-store` and add this field to `WorkbenchCopy`:

```ts
  interruptFlow: {
    errors: Record<InterruptFlowErrorCode, string>;
  };
```

Add these fields to `chat` in the interface:

```ts
    interruptStoppingLabel: string;
    interruptUnavailableLabel: string;
    toolStatusRunning: string;
    toolStatusCancelled: string;
```

In the English copy, add:

```ts
    interruptFlow: {
      errors: {
        task_not_found: "No current task to interrupt.",
        task_not_interruptible: "Nothing is running for this task.",
        interrupt_target_not_found: "The running task could not be found.",
        interrupt_failed: "Unable to interrupt this task."
      }
    },
```

and in `chat`:

```ts
      interruptStoppingLabel: "Stopping...",
      interruptUnavailableLabel: "Nothing running",
      toolStatusRunning: "Running",
      toolStatusCancelled: "Stopped",
```

In the Chinese copy, add:

```ts
    interruptFlow: {
      errors: {
        task_not_found: "当前没有可打断的任务。",
        task_not_interruptible: "当前任务没有正在运行的内容。",
        interrupt_target_not_found: "没有找到正在运行的任务。",
        interrupt_failed: "无法打断当前任务。"
      }
    },
```

and in `chat`:

```ts
      interruptStoppingLabel: "正在停止...",
      interruptUnavailableLabel: "当前没有可打断任务",
      toolStatusRunning: "运行中",
      toolStatusCancelled: "已停止",
```

- [ ] **Step 4: Implement server action**

In `apps/web/src/app/actions.ts`, import:

```ts
  getCurrentTaskId,
```

and type:

```ts
  type InterruptFlowErrorCode,
```

Add:

```ts
function redirectToInterruptError(error: InterruptFlowErrorCode): never {
  redirect(`/?interruptError=${encodeURIComponent(error)}`);
}
```

Add the action after `submitPromptAction()`:

```ts
export async function interruptCurrentTaskAction(_formData?: FormData): Promise<void> {
  const currentTaskId = await getCurrentTaskId();
  if (!currentTaskId) {
    redirectToInterruptError("task_not_found");
  }

  const result = await getWebWorkbenchStore().interruptCurrentTask({
    taskId: currentTaskId,
    reason: "User interrupted the task."
  });
  if (!result.ok) {
    redirectToInterruptError(result.error);
  }

  revalidatePath("/");
  redirect("/");
}
```

- [ ] **Step 5: Run and commit action/copy**

Run:

```bash
pnpm test -- apps/web/src/app/actions.test.ts apps/web/src/lib/i18n.test.ts
pnpm --filter @lp-agent/web typecheck
```

Expected: both pass.

Commit:

```bash
git add apps/web/src/app/actions.ts apps/web/src/app/actions.test.ts apps/web/src/lib/i18n.ts apps/web/src/lib/i18n.test.ts
git commit -m "add web interrupt action copy"
```

## Task 4: Optimistic Interrupt Button and Page Wiring

**Files:**

- Create: `apps/web/src/app/interrupt-submit-button.tsx`
- Create: `apps/web/src/app/interrupt-submit-button.test.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Add failing button tests**

Create `apps/web/src/app/interrupt-submit-button.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { useFormStatus } from "react-dom";
import { InterruptSubmitButton } from "./interrupt-submit-button";

vi.mock("react-dom", () => ({
  useFormStatus: vi.fn()
}));

const action = async (_formData: FormData) => {};
const otherAction = async (_formData: FormData) => {};
const labels = {
  idle: "Interrupt",
  stopping: "Stopping...",
  unavailable: "Nothing running"
};

describe("InterruptSubmitButton", () => {
  it("renders an enabled interrupt submit button when available", () => {
    vi.mocked(useFormStatus).mockReturnValue({
      pending: false,
      data: null,
      method: null,
      action: null
    });

    const element = InterruptSubmitButton({ action, available: true, labels });

    expect(element.props.children).toBe("Interrupt");
    expect(element.props.disabled).toBe(false);
    expect(element.props.formAction).toBe(action);
  });

  it("renders disabled unavailable state when no interrupt target exists", () => {
    vi.mocked(useFormStatus).mockReturnValue({
      pending: false,
      data: null,
      method: null,
      action: null
    });

    const element = InterruptSubmitButton({ action, available: false, labels });

    expect(element.props.children).toBe("Nothing running");
    expect(element.props.disabled).toBe(true);
    expect(element.props.title).toBe("Nothing running");
  });

  it("renders optimistic stopping copy for the pending interrupt action", () => {
    vi.mocked(useFormStatus).mockReturnValue({
      pending: true,
      data: null,
      method: "POST",
      action
    });

    const element = InterruptSubmitButton({ action, available: true, labels });

    expect(element.props.children).toBe("Stopping...");
    expect(element.props.disabled).toBe(true);
    expect(element.props["aria-busy"]).toBe(true);
  });

  it("keeps idle copy when another form action is pending", () => {
    vi.mocked(useFormStatus).mockReturnValue({
      pending: true,
      data: null,
      method: "POST",
      action: otherAction
    });

    const element = InterruptSubmitButton({ action, available: true, labels });

    expect(element.props.children).toBe("Interrupt");
    expect(element.props.disabled).toBe(true);
  });
});
```

Run:

```bash
pnpm test -- apps/web/src/app/interrupt-submit-button.test.tsx
```

Expected: fails because `interrupt-submit-button.tsx` does not exist.

- [ ] **Step 2: Implement the client button**

Create `apps/web/src/app/interrupt-submit-button.tsx`:

```tsx
"use client";

import { useFormStatus } from "react-dom";

interface InterruptSubmitButtonProps {
  action: (formData: FormData) => Promise<void>;
  available: boolean;
  labels: {
    idle: string;
    stopping: string;
    unavailable: string;
  };
}

export function InterruptSubmitButton({
  action,
  available,
  labels
}: InterruptSubmitButtonProps) {
  const status = useFormStatus();
  const isInterruptPending = status.pending && status.action === action;
  const disabled = !available || status.pending;
  return (
    <button
      type="submit"
      formAction={action}
      className="interruptButton"
      disabled={disabled}
      aria-busy={isInterruptPending ? true : undefined}
      title={!available ? labels.unavailable : undefined}
    >
      {isInterruptPending ? labels.stopping : available ? labels.idle : labels.unavailable}
    </button>
  );
}
```

- [ ] **Step 3: Add failing page tests**

In `apps/web/src/app/page.test.ts`, add tests near the existing workbench composer tests:

```ts
  it("renders an enabled interrupt button for interruptible task state", async () => {
    pageMocks.currentTaskId = "task_1";
    pageMocks.pageState = {
      ...(pageMocks.pageState as Record<string, unknown>),
      kind: "task_ready",
      activeTaskId: "task_1",
      task: {
        id: "task_1",
        title: "Interruptible task",
        type: "general_chat",
        status: "complete",
        createdAt: "2026-05-18T00:00:00.000Z"
      },
      messages: [
        {
          id: "message_1",
          taskId: "task_1",
          role: "user",
          content: "Run something",
          createdAt: "2026-05-18T00:00:00.000Z"
        },
        {
          id: "message_2",
          taskId: "task_1",
          role: "assistant",
          content: "Working",
          createdAt: "2026-05-18T00:00:01.000Z"
        }
      ],
      runEvents: [],
      interrupt: {
        available: true,
        state: "idle",
        runId: "run_interrupt_1",
        workerJobId: "worker_job_1"
      }
    };

    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const buttons = collectElements(page, "button");
    const interruptButton = buttons.find((button) =>
      collectText(button).includes("Interrupt")
    );

    expect(interruptButton?.props?.disabled).toBe(false);
  });

  it("renders localized interrupt errors", async () => {
    const html = await renderHomePage({
      searchParams: Promise.resolve({ interruptError: "task_not_found" }),
      acceptLanguage: "zh-CN,zh;q=0.9"
    });

    expect(html).toContain("当前没有可打断的任务。");
  });
```

Update existing `task_ready` page state fixtures in this file by adding:

```ts
      interrupt: {
        available: false,
        state: "not_interruptible"
      },
```

to every mock `pageState` object whose `kind` is `"task_ready"`.

- [ ] **Step 4: Wire page search params and composer button**

In `apps/web/src/app/page.tsx`, import:

```ts
import { InterruptSubmitButton } from "./interrupt-submit-button";
```

and add `interruptCurrentTaskAction` to the existing actions import.

Extend the search params type:

```ts
    interruptError?: string;
```

Add:

```ts
  const interruptError = toInterruptFlowError(params?.interruptError);
  const interruptErrorMessage = interruptError ? copy.interruptFlow.errors[interruptError] : undefined;
```

Render `interruptErrorMessage` next to the existing workbench error message:

```tsx
                {interruptErrorMessage ? (
                  <div className="formError" role="alert">{interruptErrorMessage}</div>
                ) : null}
```

Replace the current interrupt button:

```tsx
              <InterruptSubmitButton
                action={interruptCurrentTaskAction}
                available={pageState.kind === "task_ready" && pageState.interrupt.available}
                labels={{
                  idle: composer.interruptLabel,
                  stopping: copy.chat.interruptStoppingLabel,
                  unavailable: copy.chat.interruptUnavailableLabel
                }}
              />
```

Add this parser near the other parser helpers:

```ts
function toInterruptFlowError(value: string | undefined): InterruptFlowErrorCode | undefined {
  if (
    value === "task_not_found" ||
    value === "task_not_interruptible" ||
    value === "interrupt_target_not_found" ||
    value === "interrupt_failed"
  ) {
    return value;
  }
  return undefined;
}
```

- [ ] **Step 5: Add CSS states**

In `apps/web/src/app/globals.css`, extend the interrupt button styles:

```css
.composer .interruptButton:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.composer .interruptButton[aria-busy="true"] {
  border-color: rgba(245, 158, 11, 0.55);
  color: #92400e;
  background: #fffbeb;
}
```

- [ ] **Step 6: Run and commit page wiring**

Run:

```bash
pnpm test -- apps/web/src/app/interrupt-submit-button.test.tsx apps/web/src/app/page.test.ts
pnpm --filter @lp-agent/web typecheck
```

Expected: all pass.

Commit:

```bash
git add apps/web/src/app/interrupt-submit-button.tsx apps/web/src/app/interrupt-submit-button.test.tsx apps/web/src/app/page.tsx apps/web/src/app/page.test.ts apps/web/src/app/globals.css
git commit -m "add optimistic interrupt button"
```

## Task 5: Cancelled and Running Timeline States

**Files:**

- Modify: `apps/web/src/lib/chat-workbench.ts`
- Modify: `apps/web/src/lib/chat-workbench.test.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Add failing chat timeline tests**

Append these tests to `apps/web/src/lib/chat-workbench.test.ts`:

```ts
  it("marks task interrupt requested events as running timeline state", () => {
    const thread = createChatWorkbenchThread({
      copy: getWorkbenchCopy("en"),
      prompt: "Create LP",
      objective: "Convert shoppers",
      pageVersion: pageVersionFixture(),
      downloadLinks: [],
      runEvents: [
        {
          id: "run_interrupt_1_event_2",
          runId: "run_interrupt_1",
          projectId: "project_1",
          taskId: "task_1",
          sequence: 2,
          type: "task.interrupt.requested",
          message: "Task interrupt requested.",
          payload: {
            role: "deployer",
            workerJobId: "worker_job_1"
          },
          createdAt: "2026-05-18T00:00:01.000Z"
        }
      ]
    });

    expect(thread.toolEvents[0]).toMatchObject({
      status: "running",
      statusLabel: "Running"
    });
  });

  it("marks cancelled tool and task events as cancelled timeline state", () => {
    const thread = createChatWorkbenchThread({
      copy: getWorkbenchCopy("en"),
      prompt: "Create LP",
      objective: "Convert shoppers",
      pageVersion: pageVersionFixture(),
      downloadLinks: [],
      runEvents: [
        {
          id: "run_interrupt_1_event_3",
          runId: "run_interrupt_1",
          projectId: "project_1",
          taskId: "task_1",
          sequence: 3,
          type: "task.interrupt.cancelled",
          message: "Task interrupted.",
          payload: {
            role: "deployer",
            workerJobId: "worker_job_1"
          },
          createdAt: "2026-05-18T00:00:02.000Z"
        },
        {
          id: "run_interrupt_1_event_4",
          runId: "run_interrupt_1",
          projectId: "project_1",
          taskId: "task_1",
          sequence: 4,
          type: "tool.cancelled",
          message: "Deployment skill command cancelled.",
          payload: {
            role: "deployer",
            commandId: "publish_static",
            errorName: "worker_job_cancelled",
            outputSummary: "stdout: 0 chars\nstderr: 21 chars"
          },
          createdAt: "2026-05-18T00:00:03.000Z"
        }
      ]
    });

    expect(thread.toolEvents.map((event) => event.status)).toEqual([
      "cancelled",
      "cancelled"
    ]);
    expect(thread.toolEvents.every((event) => event.statusLabel === "Stopped")).toBe(true);
  });
```

Run:

```bash
pnpm test -- apps/web/src/lib/chat-workbench.test.ts
```

Expected: fails because `ChatToolStatus` does not include `running` or `cancelled`.

- [ ] **Step 2: Implement chat status mapping**

In `apps/web/src/lib/chat-workbench.ts`, change:

```ts
export type ChatToolStatus = "complete" | "failed";
```

to:

```ts
export type ChatToolStatus = "complete" | "failed" | "running" | "cancelled";
```

Replace the status logic in `toChatToolEvent()`:

```ts
  const status = toChatToolStatus(event);
```

and add:

```ts
function toChatToolStatus(event: RunEventRecord): ChatToolStatus {
  if (event.type.endsWith(".failed")) {
    return "failed";
  }
  if (event.type.endsWith(".cancelled") || event.type === "task.interrupt.cancelled") {
    return "cancelled";
  }
  if (
    event.type.endsWith(".started") ||
    event.type === "task.interrupt.requested" ||
    event.type === "worker.job.linked"
  ) {
    return "running";
  }
  return "complete";
}

function toStatusLabel(status: ChatToolStatus, copy: WorkbenchCopy): string {
  if (status === "failed") {
    return copy.status.failed;
  }
  if (status === "running") {
    return copy.chat.toolStatusRunning;
  }
  if (status === "cancelled") {
    return copy.chat.toolStatusCancelled;
  }
  return copy.chat.toolStatusComplete;
}
```

Then use:

```ts
    statusLabel: toStatusLabel(status, copy),
```

- [ ] **Step 3: Add timeline status data attributes and CSS**

In `apps/web/src/app/page.tsx`, change:

```tsx
                          <div className="toolEvent" key={event.id}>
```

to:

```tsx
                          <div className="toolEvent" data-status={event.status} key={event.id}>
```

In `apps/web/src/app/globals.css`, add:

```css
.toolEvent[data-status="running"] .toolStatusDot {
  background: #f59e0b;
  box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.12);
}

.toolEvent[data-status="cancelled"] .toolStatusDot {
  background: #94a3b8;
  box-shadow: 0 0 0 4px rgba(148, 163, 184, 0.14);
}
```

- [ ] **Step 4: Run and commit timeline states**

Run:

```bash
pnpm test -- apps/web/src/lib/chat-workbench.test.ts apps/web/src/app/page.test.ts
pnpm --filter @lp-agent/web typecheck
```

Expected: all pass.

Commit:

```bash
git add apps/web/src/lib/chat-workbench.ts apps/web/src/lib/chat-workbench.test.ts apps/web/src/app/page.tsx apps/web/src/app/globals.css
git commit -m "render interrupt timeline states"
```

## Task 6: Documentation and Full Verification

**Files:**

- Modify: `docs/superpowers/README.md`
- Modify: `docs/agent-development-learning.md`

- [ ] **Step 1: Update Superpowers reading order**

In `docs/superpowers/README.md`, add item 53 after the Stage 12 spec:

```md
53. `plans/2026-05-18-web-api-interrupt-wiring.md`
   - Stage 12 Web/API interrupt wiring v0 implementation plan.
   - Read this after the Web/API interrupt design when implementing or auditing the current-task interrupt action, optimistic stopping UI, API task/run/worker cancellation routing, and cancelled timeline rendering.
```

- [ ] **Step 2: Update Agent learning document**

In `docs/agent-development-learning.md`, replace the Stage 12 "当前计划" line with:

```md
- [2026-05-18-web-api-interrupt-wiring.md](./superpowers/plans/2026-05-18-web-api-interrupt-wiring.md)
```

After implementation, replace the Stage 12 "当前实现状态" bullet with:

```md
- Stage 12 v0 已实现当前任务 Web/API interrupt wiring：Web action 从当前 task cookie 读取任务，API 根据 task/run/worker link 推导取消目标，前端按钮支持 optimistic `正在停止...`，chat timeline 能区分 running、cancelled 和 failed。
- 这一阶段仍不做真实 shell signal、MCP execution、deployment execution、streaming logs、worker daemon 控制或批量取消。
```

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected:

- `pnpm test`: all tests pass.
- `pnpm typecheck`: all workspace typechecks pass.
- `pnpm build`: all build scripts pass.
- `git diff --check`: no whitespace errors.

- [ ] **Step 4: Commit documentation**

Commit:

```bash
git add docs/superpowers/README.md docs/agent-development-learning.md
git commit -m "document web interrupt implementation"
```

## Implementation Order

1. Task 1 gives the API a testable cancellation operation without Web coupling.
2. Task 2 exposes that operation through the Web store and page model.
3. Task 3 adds the server action and copy.
4. Task 4 makes the composer stop button functional and optimistic.
5. Task 5 makes cancellation visually distinct from failure.
6. Task 6 updates the docs and runs full verification.

Do not begin Task 4 before Task 3 passes, because the page needs a real server action and copy keys. Do not begin Task 5 before Task 2 passes, because timeline cancellation depends on durable interrupt events.
