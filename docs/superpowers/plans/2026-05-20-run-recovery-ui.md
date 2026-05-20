# Run Recovery UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose run lifecycle recovery in the Web task timeline and add safe executable `resume_worker_finalization` plus controlled single-run `retry_run` actions.

**Architecture:** `packages/api` owns recovery derivation and execution because it can re-read repository state, re-derive `RunLifecycleView`, run worker finalizers, and call agent service methods without trusting browser state. `apps/web` only passes `taskId`, `runId`, and action intent through server actions, then renders safe recovery state inline in the existing task conversation. Controlled retry creates a new retry run, updates task snapshot only when the retried artifact is safely produced, and fails closed for unsupported roles, missing inputs, output conflicts, approval ambiguity, or side-effect risk.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Next.js server actions, existing `RunLifecycleView`, existing `finalizeWorkerBackedSkillCommand`, existing deterministic `DemoWorkbenchService`, existing Web workbench store and page tests.

---

## Scope Boundary

This plan implements Stage 25 Run Recovery UI v0:

- Web task state includes recovery views derived from `RunLifecycleView`.
- Web task timeline renders an inline recovery block under the existing agent process block.
- Executable recovery actions are `resume_worker_finalization` and `retry_run`.
- Guidance-only recovery actions are `request_approval`, `resolve_blocker`, and `inspect_manually`.
- Server actions re-read repository state and re-derive lifecycle before executing.
- `retry_run` is a single-run retry that creates a new retry run id and never overwrites the original failed run.
- Diagnostics and errors remain redacted and bounded.

This plan does not add a general DAG scheduler, automatic full agent-chain rerun, streaming UI, team approval queue, MCP write-tool retry, command side-effect retry, real shell retry, or deployment side-effect retry beyond the existing deterministic deployment handoff boundary.

## File Structure

Create:

- `packages/api/src/run-recovery.ts` - API-owned recovery list and execution helpers, including task/snapshot run scoping, resume finalization, controlled retry intent resolution, and safe result/error types.
- `packages/api/src/run-recovery.test.ts` - API recovery tests for task/snapshot lifecycle listing, resume finalization, controlled retry, unsupported retry, and redaction.

Modify:

- `packages/api/src/index.ts` - Export recovery helpers and allow `DemoWorkbenchService` run methods to accept optional `taskId` and `runId` for retry runs.
- `apps/web/src/lib/workbench-store.ts` - Add recovery state to `task_ready`, expose `executeRunRecoveryAction`, and call the API recovery helper.
- `apps/web/src/lib/workbench-store.test.ts` - Cover recovery views in page state and store-level execution mapping.
- `apps/web/src/app/actions.ts` - Add `executeRunRecoveryAction` server action and safe recovery error redirect.
- `apps/web/src/app/actions.test.ts` - Cover recovery form parsing, success revalidation, and error redirect.
- `apps/web/src/lib/i18n.ts` - Add English and Chinese recovery labels, state labels, action labels, and safe error messages.
- `apps/web/src/lib/i18n.test.ts` - Cover new recovery copy keys.
- `apps/web/src/app/page.tsx` - Render inline recovery block with executable forms and guidance-only chips.
- `apps/web/src/app/page.test.ts` - Cover inline rendering, executable/guidance separation, redaction, and hidden form payloads.
- `apps/web/src/app/globals.css` - Style the recovery block consistently with the existing process block without nested-card layout.
- `docs/project-roadmap.md` - Mark Stage 25 implementation status after code lands and keep Stage 26/27 queue accurate.
- `docs/agent-development-learning.md` - Record the implemented recovery-action product boundary.
- `docs/superpowers/README.md` - Keep this plan in the Superpowers reading order.

## Task 1: API Recovery Helper for Listing and Resume Finalization

**Files:**

- Create: `packages/api/src/run-recovery.ts`
- Create: `packages/api/src/run-recovery.test.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Write failing API tests for task/snapshot listing and resume finalization**

Create `packages/api/src/run-recovery.test.ts` with these initial tests and helpers:

```ts
import { describe, expect, it } from "vitest";
import {
  createInMemoryWorkbenchRepositories,
  type RunEventRecord,
  type RunRecord,
  type ToolObservationRecord,
  type WorkbenchRepositories
} from "@lp-agent/db";
import type { WorkerJobRecord } from "@lp-agent/worker-runtime";
import {
  executeRunRecoveryAction,
  listRunRecoveryViewsForTask
} from "./run-recovery";

const timestamp = "2026-05-20T00:00:00.000Z";

function terminalWorkerJob(
  overrides: Partial<WorkerJobRecord> = {}
): WorkerJobRecord {
  return {
    id: "worker_job_1",
    projectId: "project_1",
    kind: "tool_command",
    state: "completed",
    payloadSource: "safe_persisted",
    policy: {
      mode: "simulate",
      allowedCommands: ["static-deploy"],
      timeoutMs: 30000,
      allowedEnvNames: [],
      maxStdoutBytes: 300,
      maxStderrBytes: 300,
      network: "disabled"
    },
    inputSummary: {
      kind: "tool_command",
      projectId: "project_1",
      command: "static-deploy",
      argCount: 0,
      envNames: [],
      timeoutMs: 30000
    },
    resultSummary: {
      state: "completed",
      stdout: "published",
      stderr: "",
      stdoutBytes: 9,
      stderrBytes: 0,
      exitCode: 0
    },
    createdAt: timestamp,
    startedAt: "2026-05-20T00:00:01.000Z",
    completedAt: "2026-05-20T00:00:02.000Z",
    ...overrides
  };
}

async function saveTask(repositories: WorkbenchRepositories): Promise<void> {
  await repositories.projects.save({
    id: "project_1",
    name: "Recovery project",
    createdAt: timestamp
  });
  await repositories.tasks.save({
    id: "task_1",
    title: "Recover a landing page run",
    type: "lp_generation",
    status: "complete",
    projectId: "project_1",
    createdAt: timestamp
  });
  await repositories.messages.save({
    id: "message_1",
    taskId: "task_1",
    role: "user",
    content: "Build a recovery LP.",
    createdAt: timestamp
  });
}

async function saveRun(
  repositories: WorkbenchRepositories,
  overrides: Partial<RunRecord>
): Promise<RunRecord> {
  const run: RunRecord = {
    id: "run_reviewer_version_1",
    projectId: "project_1",
    taskId: "task_1",
    role: "reviewer",
    state: "running",
    startedAt: timestamp,
    contextSummary: {
      injected: [],
      omitted: []
    },
    ...overrides
  };
  await repositories.runs.save(run);
  return run;
}

async function saveEvent(
  repositories: WorkbenchRepositories,
  input: {
    runId: string;
    type: string;
    sequence: number;
    payload?: Record<string, unknown>;
    message?: string;
  }
): Promise<RunEventRecord> {
  const event: RunEventRecord = {
    id: `${input.runId}_event_${input.sequence}`,
    runId: input.runId,
    projectId: "project_1",
    taskId: "task_1",
    sequence: input.sequence,
    type: input.type,
    message: input.message ?? input.type,
    payload: input.payload ?? {},
    createdAt: `2026-05-20T00:00:0${input.sequence}.000Z`
  };
  await repositories.runEvents.save(event);
  return event;
}

async function saveObservation(
  repositories: WorkbenchRepositories,
  overrides: Partial<ToolObservationRecord> = {}
): Promise<void> {
  await repositories.toolObservations.save({
    id: "tool_observation_1",
    runId: "run_skill_command_1",
    projectId: "project_1",
    taskId: "task_1",
    toolName: "skill:skill_static_deploy:publish_static",
    input: {},
    outputSummary: "",
    state: "running",
    createdAt: timestamp,
    ...overrides
  });
}

describe("run recovery views", () => {
  it("lists direct task runs and snapshot-linked LP runs without duplicates", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await repositories.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_1",
      pageVersionId: "version_1",
      createdAt: timestamp
    });
    await saveRun(repositories, {
      id: "run_planner_brief_1",
      taskId: undefined,
      role: "planner",
      state: "completed",
      completedAt: "2026-05-20T00:00:04.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_planner_brief_1",
      type: "run.completed",
      sequence: 1
    });
    await saveRun(repositories, {
      id: "run_reviewer_version_1",
      role: "reviewer",
      state: "failed",
      completedAt: "2026-05-20T00:00:05.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_reviewer_version_1",
      type: "run.failed",
      sequence: 1,
      payload: {
        errorName: "reviewer_failed",
        rawModelOutput: "RAW_SECRET_SHOULD_NOT_RENDER"
      }
    });

    const views = await listRunRecoveryViewsForTask({
      repositories,
      taskId: "task_1"
    });

    expect(views.map((view) => view.runId)).toEqual([
      "run_planner_brief_1",
      "run_reviewer_version_1"
    ]);
    expect(JSON.stringify(views)).not.toContain("RAW_SECRET_SHOULD_NOT_RENDER");
    expect(views[1]).toMatchObject({
      state: "failed",
      recoveryActions: ["retry_run"],
      diagnosticSummary: {
        code: "run_failed",
        source: "run_event",
        errorName: "reviewer_failed"
      }
    });
  });
});

describe("execute run recovery action", () => {
  it("resumes worker finalization only when the derived action is available", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await saveRun(repositories, {
      id: "run_skill_command_1",
      role: "deployer"
    });
    await saveObservation(repositories);
    await saveEvent(repositories, {
      runId: "run_skill_command_1",
      type: "worker.job.linked",
      sequence: 1,
      payload: {
        runId: "run_skill_command_1",
        workerJobId: "worker_job_1",
        observationId: "tool_observation_1"
      }
    });

    const result = await executeRunRecoveryAction({
      repositories,
      workerRuntime: {
        getJob: async () => terminalWorkerJob()
      },
      service: {
        createBriefFromPrompt: async () => {
          throw new Error("not used");
        },
        generatePageVersion: async () => {
          throw new Error("not used");
        },
        reviewPageVersion: async () => {
          throw new Error("not used");
        },
        approveAndCreateDeployment: async () => {
          throw new Error("not used");
        }
      },
      currentUserId: "local-web-user",
      taskId: "task_1",
      runId: "run_skill_command_1",
      action: "resume_worker_finalization"
    });

    expect(result).toEqual({
      ok: true,
      action: "resume_worker_finalization",
      runId: "run_skill_command_1",
      state: "completed"
    });
    await expect(repositories.runs.getById("run_skill_command_1")).resolves.toMatchObject({
      state: "completed"
    });
    await expect(
      repositories.runEvents.listForRun("run_skill_command_1")
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool.completed" }),
        expect.objectContaining({ type: "run.completed" })
      ])
    );
  });
});
```

- [ ] **Step 2: Run the new API test and verify it fails**

Run:

```bash
pnpm --filter @lp-agent/api test -- run-recovery.test.ts
```

Expected: fail because `packages/api/src/run-recovery.ts` does not exist.

- [ ] **Step 3: Implement recovery types, task/snapshot listing, and resume finalization**

Create `packages/api/src/run-recovery.ts` with this structure:

```ts
import type {
  BriefRecord,
  PageVersionRecord,
  RunRecord,
  WorkbenchRepositories
} from "@lp-agent/db";
import type { DeploymentHandoff } from "@lp-agent/git-deployment";
import type { WorkerJobRecord } from "@lp-agent/worker-runtime";
import {
  deriveRunLifecycleView,
  listRunLifecycleViewsForTask,
  type RunLifecycleState,
  type RunLifecycleView
} from "./run-lifecycle";
import { finalizeWorkerBackedSkillCommand } from "./skill-command-worker-queue";

export type RunRecoveryExecutionAction =
  | "resume_worker_finalization"
  | "retry_run";

export type RunRecoveryExecutionErrorCode =
  | "run_not_found"
  | "task_not_found"
  | "recovery_action_not_available"
  | "worker_runtime_not_configured"
  | "worker_job_not_found"
  | "worker_job_not_terminal"
  | "worker_finalization_failed"
  | "retry_input_not_reconstructable"
  | "retry_target_conflict"
  | "retry_failed";

export type RunRecoveryExecutionResult =
  | {
      ok: true;
      action: RunRecoveryExecutionAction;
      runId: string;
      newRunId?: string;
      state: RunLifecycleState;
    }
  | {
      ok: false;
      error: RunRecoveryExecutionErrorCode;
    };

export interface RunRecoveryWorkerRuntime {
  getJob(id: string): Promise<WorkerJobRecord | undefined>;
}

export interface RunRecoveryService {
  createBriefFromPrompt(input: {
    projectId: string;
    prompt: string;
    taskId?: string;
    runId?: string;
  }): Promise<BriefRecord>;
  generatePageVersion(input: {
    projectId: string;
    briefId: string;
    taskId?: string;
    runId?: string;
  }): Promise<PageVersionRecord>;
  reviewPageVersion(input: {
    projectId: string;
    pageVersionId: string;
    taskId?: string;
    runId?: string;
  }): Promise<PageVersionRecord>;
  approveAndCreateDeployment(input: {
    projectId: string;
    pageVersionId: string;
    reviewerUserId: string;
    taskId?: string;
    runId?: string;
  }): Promise<DeploymentHandoff>;
}

export interface ListRunRecoveryViewsForTaskInput {
  repositories: WorkbenchRepositories;
  taskId: string;
  workerRuntime?: RunRecoveryWorkerRuntime;
}

export interface ExecuteRunRecoveryActionInput extends ListRunRecoveryViewsForTaskInput {
  service: RunRecoveryService;
  currentUserId: string;
  runId: string;
  action: RunRecoveryExecutionAction;
  now?: () => Date;
}

export async function listRunRecoveryViewsForTask(
  input: ListRunRecoveryViewsForTaskInput
): Promise<RunLifecycleView[]> {
  const directViews = await listRunLifecycleViewsForTask({
    repositories: input.repositories,
    taskId: input.taskId,
    workerRuntime: input.workerRuntime
  });
  const snapshot = await input.repositories.taskSnapshots.getByTaskId(input.taskId);
  const snapshotRunIds = snapshot
    ? [
        snapshot.briefId ? `run_planner_${snapshot.briefId}` : undefined,
        snapshot.pageVersionId ? `run_builder_${snapshot.pageVersionId}` : undefined,
        snapshot.pageVersionId ? `run_reviewer_${snapshot.pageVersionId}` : undefined,
        snapshot.pageVersionId ? `run_deployer_${snapshot.pageVersionId}` : undefined
      ].filter((value): value is string => value !== undefined)
    : [];

  const byRunId = new Map(directViews.map((view) => [view.runId, view]));
  for (const runId of snapshotRunIds) {
    if (byRunId.has(runId)) {
      continue;
    }
    const derived = await deriveRunLifecycleView({
      repositories: input.repositories,
      runId,
      workerRuntime: input.workerRuntime
    });
    if (derived.ok) {
      byRunId.set(derived.view.runId, derived.view);
    }
  }

  return [...byRunId.values()].sort((left, right) => {
    const startedAtOrder = left.startedAt.localeCompare(right.startedAt);
    return startedAtOrder || left.runId.localeCompare(right.runId);
  });
}

export async function executeRunRecoveryAction(
  input: ExecuteRunRecoveryActionInput
): Promise<RunRecoveryExecutionResult> {
  const run = await input.repositories.runs.getById(input.runId);
  if (!run) {
    return { ok: false, error: "run_not_found" };
  }
  if (!(await runBelongsToTaskScope(input.repositories, input.taskId, run))) {
    return { ok: false, error: "run_not_found" };
  }

  const lifecycle = await deriveRunLifecycleView({
    repositories: input.repositories,
    runId: input.runId,
    workerRuntime: input.workerRuntime
  });
  if (!lifecycle.ok) {
    return { ok: false, error: "run_not_found" };
  }
  if (!lifecycle.view.recoveryActions.includes(input.action)) {
    return { ok: false, error: "recovery_action_not_available" };
  }

  if (input.action === "resume_worker_finalization") {
    return resumeWorkerFinalization({ ...input, view: lifecycle.view });
  }

  return retryRun({ ...input, run });
}

async function resumeWorkerFinalization(
  input: ExecuteRunRecoveryActionInput & { view: RunLifecycleView }
): Promise<RunRecoveryExecutionResult> {
  if (!input.workerRuntime) {
    return { ok: false, error: "worker_runtime_not_configured" };
  }
  if (!input.view.linkedWorkerJobId) {
    return { ok: false, error: "worker_job_not_found" };
  }

  const workerJob = await input.workerRuntime.getJob(input.view.linkedWorkerJobId);
  if (!workerJob) {
    return { ok: false, error: "worker_job_not_found" };
  }
  if (
    workerJob.state !== "completed" &&
    workerJob.state !== "failed" &&
    workerJob.state !== "rejected" &&
    workerJob.state !== "cancelled"
  ) {
    return { ok: false, error: "worker_job_not_terminal" };
  }

  const finalized = await finalizeWorkerBackedSkillCommand({
    repositories: input.repositories,
    workerJob,
    now: input.now
  });
  if (!finalized.ok) {
    return { ok: false, error: "worker_finalization_failed" };
  }

  const refreshed = await deriveRunLifecycleView({
    repositories: input.repositories,
    runId: input.runId,
    workerRuntime: input.workerRuntime
  });
  return {
    ok: true,
    action: "resume_worker_finalization",
    runId: input.runId,
    state: refreshed.ok ? refreshed.view.state : finalized.state === "cancelled" ? "cancelled" : finalized.state
  };
}
```

Add local stubs at the bottom of the same file so Task 1 compiles before retry is implemented:

```ts
async function retryRun(
  _input: ExecuteRunRecoveryActionInput & { run: RunRecord }
): Promise<RunRecoveryExecutionResult> {
  return { ok: false, error: "retry_input_not_reconstructable" };
}

async function runBelongsToTaskScope(
  repositories: WorkbenchRepositories,
  taskId: string,
  run: RunRecord
): Promise<boolean> {
  if (run.taskId === taskId) {
    return true;
  }
  const snapshot = await repositories.taskSnapshots.getByTaskId(taskId);
  if (!snapshot || snapshot.projectId !== run.projectId) {
    return false;
  }
  return (
    (run.role === "planner" && run.id === `run_planner_${snapshot.briefId}`) ||
    (run.role === "builder" && run.id === `run_builder_${snapshot.pageVersionId}`) ||
    (run.role === "reviewer" && run.id === `run_reviewer_${snapshot.pageVersionId}`) ||
    (run.role === "deployer" && run.id === `run_deployer_${snapshot.pageVersionId}`)
  );
}
```

- [ ] **Step 4: Export the recovery helper from API package**

Modify `packages/api/src/index.ts` near the existing `export * from "./run-lifecycle";` line:

```ts
export * from "./run-lifecycle";
export * from "./run-recovery";
```

- [ ] **Step 5: Run Task 1 tests**

Run:

```bash
pnpm --filter @lp-agent/api test -- run-recovery.test.ts
```

Expected: pass for listing and resume finalization tests; retry tests are not added yet.

- [ ] **Step 6: Commit Task 1**

```bash
git add packages/api/src/run-recovery.ts packages/api/src/run-recovery.test.ts packages/api/src/index.ts
git commit -m "add run recovery execution helper"
```

## Task 2: Controlled Single-Run Retry

**Files:**

- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/run-recovery.ts`
- Modify: `packages/api/src/run-recovery.test.ts`

- [ ] **Step 1: Add failing tests for supported and unsupported retry**

Add this import next to the existing imports in `packages/api/src/run-recovery.test.ts`:

```ts
import { DemoWorkbenchService } from "./index";
```

Append these tests to `packages/api/src/run-recovery.test.ts`:

```ts
describe("execute run recovery retry", () => {
  it("retries a failed planner run with a new run id and task snapshot brief", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await saveRun(repositories, {
      id: "run_planner_failed",
      role: "planner",
      state: "failed",
      completedAt: "2026-05-20T00:00:03.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_planner_failed",
      type: "run.failed",
      sequence: 1,
      payload: {
        errorName: "model_output_parse_failed",
        rawModelOutput: "MODEL_SECRET_SHOULD_NOT_RENDER"
      }
    });

    const service = new DemoWorkbenchService({
      repositories,
      now: () => new Date("2026-05-20T00:10:00.000Z")
    });
    const result = await executeRunRecoveryAction({
      repositories,
      service,
      currentUserId: "local-web-user",
      taskId: "task_1",
      runId: "run_planner_failed",
      action: "retry_run",
      now: () => new Date("2026-05-20T00:10:00.000Z")
    });

    expect(result).toEqual({
      ok: true,
      action: "retry_run",
      runId: "run_planner_failed",
      newRunId: "run_planner_failed_retry_1",
      state: "completed"
    });
    await expect(repositories.runs.getById("run_planner_failed")).resolves.toMatchObject({
      state: "failed"
    });
    await expect(repositories.runs.getById("run_planner_failed_retry_1")).resolves.toMatchObject({
      role: "planner",
      state: "completed",
      taskId: "task_1"
    });
    await expect(repositories.taskSnapshots.getByTaskId("task_1")).resolves.toMatchObject({
      projectId: "project_1",
      briefId: "brief_1"
    });
    const views = await listRunRecoveryViewsForTask({ repositories, taskId: "task_1" });
    expect(JSON.stringify(views)).not.toContain("MODEL_SECRET_SHOULD_NOT_RENDER");
  });

  it("fails closed instead of retrying skill command runs", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await saveRun(repositories, {
      id: "run_skill_command_1",
      role: "deployer",
      state: "failed",
      completedAt: "2026-05-20T00:00:03.000Z",
      contextSummary: {
        injected: ["skillCommand:skill_static_deploy:publish_static"],
        omitted: []
      }
    });
    await saveEvent(repositories, {
      runId: "run_skill_command_1",
      type: "run.failed",
      sequence: 1,
      payload: {
        errorName: "skill_command_failed"
      }
    });

    const service = new DemoWorkbenchService({ repositories });
    await expect(
      executeRunRecoveryAction({
        repositories,
        service,
        currentUserId: "local-web-user",
        taskId: "task_1",
        runId: "run_skill_command_1",
        action: "retry_run"
      })
    ).resolves.toEqual({
      ok: false,
      error: "retry_input_not_reconstructable"
    });
  });

  it("fails closed when retry would overwrite an existing task snapshot output", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await repositories.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_existing",
      createdAt: timestamp
    });
    await saveRun(repositories, {
      id: "run_planner_failed",
      role: "planner",
      state: "failed",
      completedAt: "2026-05-20T00:00:03.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_planner_failed",
      type: "run.failed",
      sequence: 1
    });

    const service = new DemoWorkbenchService({ repositories });
    await expect(
      executeRunRecoveryAction({
        repositories,
        service,
        currentUserId: "local-web-user",
        taskId: "task_1",
        runId: "run_planner_failed",
        action: "retry_run"
      })
    ).resolves.toEqual({
      ok: false,
      error: "retry_target_conflict"
    });
  });
});
```

- [ ] **Step 2: Run the retry tests and verify they fail**

Run:

```bash
pnpm --filter @lp-agent/api test -- run-recovery.test.ts
```

Expected: fail because `retryRun()` currently returns `retry_input_not_reconstructable`, and `DemoWorkbenchService` does not yet accept override `taskId` / `runId` on LP run methods.

- [ ] **Step 3: Extend service input types with optional task/run overrides**

Modify the interfaces in `packages/api/src/index.ts`:

```ts
export interface CreateBriefFromPromptInput {
  projectId: string;
  prompt: string;
  taskId?: string;
  runId?: string;
}

export interface GeneratePageVersionInput {
  projectId: string;
  briefId: string;
  taskId?: string;
  runId?: string;
}

export interface ReviewPageVersionInput {
  projectId: string;
  pageVersionId: string;
  taskId?: string;
  runId?: string;
}

export interface ApproveAndCreateDeploymentInput {
  projectId: string;
  pageVersionId: string;
  reviewerUserId: string;
  taskId?: string;
  runId?: string;
}
```

- [ ] **Step 4: Pass task/run overrides through `DemoWorkbenchService` methods**

In `createBriefFromPrompt`, change the `runAgentStep` call and handoff save:

```ts
const { result, run, events } = await runAgentStep({
  repositories: this.repositories,
  service: this,
  runtime: this.plannerRuntime,
  runId: input.runId ?? `run_planner_${briefId}`,
  projectId: input.projectId,
  taskId: input.taskId,
  role: "planner",
  input: {
    prompt: plannerPrompt
  },
  now: this.now,
  finalizeResult: this.structuredPlannerOutputEnabled
    ? async ({ result, contextPack }) => {
        if (result.state !== "completed") {
          return result;
        }
        try {
          parsedPlannerBrief = parsePlannerLPBriefOutput(result.modelOutputText ?? "");
          return {
            ...result,
            events: addEventBeforeRunCompleted(
              result.events,
              toPlannerParseSuccessEvent({
                result,
                brief: parsedPlannerBrief
              })
            )
          };
        } catch (error) {
          if (error instanceof PlannerLPBriefParseError) {
            const repaired = await repairPlannerResult({
              runtime: this.plannerRuntime,
              result,
              projectId: input.projectId,
              userPrompt: input.prompt,
              context: contextPack.runtimeContext,
              error
            });
            if (repaired.brief) {
              parsedPlannerBrief = repaired.brief;
            }
            return repaired.result;
          }
          throw error;
        }
      }
    : undefined
});
```

Then include `taskId` in the handoff:

```ts
await this.saveHandoffForRun({
  runId: run.id,
  projectId: input.projectId,
  taskId: input.taskId,
  sequence: events.length + 1,
  fromRole: "planner",
  toRole: "builder",
  state: "ready",
  summary: "Planner produced LP brief",
  artifactRefs: {
    briefId: brief.id
  }
});
```

Apply the same pattern in `generatePageVersion`, `reviewPageVersion`, and `approveAndCreateDeployment`:

```ts
runId: input.runId ?? `run_builder_${pageVersionId}`,
taskId: input.taskId,
```

```ts
taskId: input.taskId,
```

```ts
runId: input.runId ?? `run_reviewer_${pageVersion.id}`,
taskId: input.taskId,
```

```ts
runId: input.runId ?? `run_deployer_${pageVersion.id}`,
taskId: input.taskId,
```

- [ ] **Step 5: Implement retry intent resolution**

Replace the Task 1 `retryRun()` stub in `packages/api/src/run-recovery.ts` with:

```ts
async function retryRun(
  input: ExecuteRunRecoveryActionInput & { run: RunRecord }
): Promise<RunRecoveryExecutionResult> {
  if (input.run.contextSummary.injected.some((entry) => entry.startsWith("skillCommand:"))) {
    return { ok: false, error: "retry_input_not_reconstructable" };
  }

  const task = await input.repositories.tasks.getById(input.taskId);
  if (!task || task.projectId !== input.run.projectId) {
    return { ok: false, error: "task_not_found" };
  }
  const snapshot = await input.repositories.taskSnapshots.getByTaskId(input.taskId);
  const retryRunId = await nextRetryRunId(input.repositories, input.run.id);

  try {
    if (input.run.role === "planner") {
      if (snapshot?.briefId) {
        return { ok: false, error: "retry_target_conflict" };
      }
      const prompt = await firstUserPrompt(input.repositories, input.taskId);
      if (!prompt) {
        return { ok: false, error: "retry_input_not_reconstructable" };
      }
      const brief = await input.service.createBriefFromPrompt({
        projectId: input.run.projectId,
        prompt,
        taskId: input.taskId,
        runId: retryRunId
      });
      await input.repositories.taskSnapshots.save({
        taskId: input.taskId,
        projectId: input.run.projectId,
        briefId: brief.id,
        createdAt: snapshot?.createdAt ?? new Date().toISOString()
      });
      return {
        ok: true,
        action: "retry_run",
        runId: input.run.id,
        newRunId: retryRunId,
        state: "completed"
      };
    }

    if (input.run.role === "builder") {
      if (!snapshot?.briefId) {
        return { ok: false, error: "retry_input_not_reconstructable" };
      }
      if (snapshot.pageVersionId) {
        return { ok: false, error: "retry_target_conflict" };
      }
      const pageVersion = await input.service.generatePageVersion({
        projectId: input.run.projectId,
        briefId: snapshot.briefId,
        taskId: input.taskId,
        runId: retryRunId
      });
      await input.repositories.taskSnapshots.save({
        taskId: input.taskId,
        projectId: input.run.projectId,
        briefId: snapshot.briefId,
        pageVersionId: pageVersion.id,
        createdAt: snapshot.createdAt
      });
      return {
        ok: true,
        action: "retry_run",
        runId: input.run.id,
        newRunId: retryRunId,
        state: "completed"
      };
    }

    if (input.run.role === "reviewer") {
      if (!snapshot?.pageVersionId) {
        return { ok: false, error: "retry_input_not_reconstructable" };
      }
      await input.service.reviewPageVersion({
        projectId: input.run.projectId,
        pageVersionId: snapshot.pageVersionId,
        taskId: input.taskId,
        runId: retryRunId
      });
      return {
        ok: true,
        action: "retry_run",
        runId: input.run.id,
        newRunId: retryRunId,
        state: "completed"
      };
    }

    if (input.run.role === "deployer") {
      if (!snapshot?.pageVersionId) {
        return { ok: false, error: "retry_input_not_reconstructable" };
      }
      const existingDeployment = await input.repositories.deployments.getByPageVersionId(
        snapshot.pageVersionId
      );
      if (existingDeployment) {
        return { ok: false, error: "retry_target_conflict" };
      }
      await input.service.approveAndCreateDeployment({
        projectId: input.run.projectId,
        pageVersionId: snapshot.pageVersionId,
        reviewerUserId: input.currentUserId,
        taskId: input.taskId,
        runId: retryRunId
      });
      return {
        ok: true,
        action: "retry_run",
        runId: input.run.id,
        newRunId: retryRunId,
        state: "completed"
      };
    }
  } catch {
    return { ok: false, error: "retry_failed" };
  }

  return { ok: false, error: "retry_input_not_reconstructable" };
}

async function nextRetryRunId(
  repositories: WorkbenchRepositories,
  baseRunId: string
): Promise<string> {
  const existing = new Set((await repositories.runs.listAll()).map((run) => run.id));
  let attempt = 1;
  while (existing.has(`${baseRunId}_retry_${attempt}`)) {
    attempt += 1;
  }
  return `${baseRunId}_retry_${attempt}`;
}

async function firstUserPrompt(
  repositories: WorkbenchRepositories,
  taskId: string
): Promise<string | undefined> {
  const messages = await repositories.messages.listForTask(taskId);
  return messages.find((message) => message.role === "user")?.content.trim() || undefined;
}
```

- [ ] **Step 6: Run API recovery and existing API tests**

Run:

```bash
pnpm --filter @lp-agent/api test -- run-recovery.test.ts run-lifecycle.test.ts services.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit Task 2**

```bash
git add packages/api/src/index.ts packages/api/src/run-recovery.ts packages/api/src/run-recovery.test.ts
git commit -m "add controlled run retry"
```

## Task 3: Web Store and Server Action Wiring

**Files:**

- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`
- Modify: `apps/web/src/app/actions.ts`
- Modify: `apps/web/src/app/actions.test.ts`

- [ ] **Step 1: Add failing Web store tests for recovery state and execution**

Add tests to `apps/web/src/lib/workbench-store.test.ts`:

```ts
it("includes task recovery views in task-ready page state", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const store = createWebWorkbenchStore({ repositories });
  const project = await store.createProject({ name: "Recovery project" });
  await repositories.tasks.save({
    id: "task_1",
    title: "Recover failed run",
    type: "lp_generation",
    status: "complete",
    projectId: project.id,
    createdAt: "2026-05-20T00:00:00.000Z"
  });
  await repositories.messages.save({
    id: "message_1",
    taskId: "task_1",
    role: "user",
    content: "Build a recovery LP.",
    createdAt: "2026-05-20T00:00:00.000Z"
  });
  await repositories.runs.save({
    id: "run_planner_failed",
    projectId: project.id,
    taskId: "task_1",
    role: "planner",
    state: "failed",
    startedAt: "2026-05-20T00:00:01.000Z",
    completedAt: "2026-05-20T00:00:02.000Z",
    contextSummary: { injected: [], omitted: [] }
  });
  await repositories.runEvents.save({
    id: "run_planner_failed_event_1",
    runId: "run_planner_failed",
    projectId: project.id,
    taskId: "task_1",
    sequence: 1,
    type: "run.failed",
    message: "Planner failed.",
    payload: {
      errorName: "model_output_parse_failed",
      rawModelOutput: "RAW_MODEL_SECRET"
    },
    createdAt: "2026-05-20T00:00:02.000Z"
  });

  const state = await store.getPageState({ taskId: "task_1" });

  expect(state.kind).toBe("task_ready");
  if (state.kind !== "task_ready") {
    throw new Error("expected task_ready state");
  }
  expect(state.recovery.runs).toEqual([
    expect.objectContaining({
      runId: "run_planner_failed",
      state: "failed",
      recoveryActions: ["retry_run"],
      diagnosticSummary: expect.objectContaining({
        errorName: "model_output_parse_failed"
      })
    })
  ]);
  expect(JSON.stringify(state.recovery)).not.toContain("RAW_MODEL_SECRET");
});

it("executes run recovery through the web store", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const store = createWebWorkbenchStore({
    repositories,
    currentUser: {
      id: "local-web-user",
      displayName: "Local user"
    }
  });
  const project = await store.createProject({ name: "Recovery project" });
  await repositories.tasks.save({
    id: "task_1",
    title: "Recover failed run",
    type: "lp_generation",
    status: "complete",
    projectId: project.id,
    createdAt: "2026-05-20T00:00:00.000Z"
  });
  await repositories.messages.save({
    id: "message_1",
    taskId: "task_1",
    role: "user",
    content: "Build a recovery LP.",
    createdAt: "2026-05-20T00:00:00.000Z"
  });
  await repositories.runs.save({
    id: "run_planner_failed",
    projectId: project.id,
    taskId: "task_1",
    role: "planner",
    state: "failed",
    startedAt: "2026-05-20T00:00:01.000Z",
    completedAt: "2026-05-20T00:00:02.000Z",
    contextSummary: { injected: [], omitted: [] }
  });
  await repositories.runEvents.save({
    id: "run_planner_failed_event_1",
    runId: "run_planner_failed",
    projectId: project.id,
    taskId: "task_1",
    sequence: 1,
    type: "run.failed",
    message: "Planner failed.",
    payload: {
      errorName: "model_output_parse_failed"
    },
    createdAt: "2026-05-20T00:00:02.000Z"
  });

  const result = await store.executeRunRecoveryAction({
    taskId: "task_1",
    runId: "run_planner_failed",
    action: "retry_run"
  });

  expect(result).toEqual({
    ok: true,
    value: expect.objectContaining({
      action: "retry_run",
      runId: "run_planner_failed",
      newRunId: "run_planner_failed_retry_1",
      state: "completed"
    })
  });
});
```

- [ ] **Step 2: Add failing server action tests**

Update the hoisted mocks in `apps/web/src/app/actions.test.ts`:

```ts
executeRunRecoveryAction: vi.fn(),
```

Expose the mocked store method:

```ts
executeRunRecoveryAction: mocks.executeRunRecoveryAction
```

Import the action:

```ts
import {
  executeRunRecoveryAction,
  bindSkillVersionAction,
  createMCPConnectorAction,
  createModelProviderAction,
  createProjectAction,
  createSkillDraftAction,
  executeMCPToolAction,
  executeSkillCommandAction,
  interruptCurrentTaskAction,
  publishSkillVersionAction,
  runLocalWorkerOnceAction,
  setMCPConnectorEnabledAction,
  setMCPToolApprovalAction,
  setModelProviderEnabledAction,
  setSkillBindingEnabledAction,
  submitPromptAction,
  upsertProjectModelRouteAction,
  validateSkillVersionAction
} from "./actions";
```

Add tests:

```ts
function buildRecoveryForm(input: {
  taskId?: string;
  runId?: string;
  action?: string;
} = {}): FormData {
  const formData = new FormData();
  formData.set("taskId", input.taskId ?? "task_1");
  formData.set("runId", input.runId ?? "run_planner_failed");
  formData.set("action", input.action ?? "retry_run");
  return formData;
}

it("executes a run recovery action and revalidates the workbench", async () => {
  mocks.executeRunRecoveryAction.mockResolvedValue({
    ok: true,
    value: {
      action: "retry_run",
      runId: "run_planner_failed",
      newRunId: "run_planner_failed_retry_1",
      state: "completed"
    }
  });

  await expect(executeRunRecoveryAction(buildRecoveryForm())).rejects.toThrow(
    "NEXT_REDIRECT:/"
  );

  expect(mocks.executeRunRecoveryAction).toHaveBeenCalledWith({
    taskId: "task_1",
    runId: "run_planner_failed",
    action: "retry_run"
  });
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
});

it("redirects recovery action failures with safe error codes", async () => {
  mocks.executeRunRecoveryAction.mockResolvedValue({
    ok: false,
    error: "retry_input_not_reconstructable"
  });

  await expect(executeRunRecoveryAction(buildRecoveryForm())).rejects.toThrow(
    "NEXT_REDIRECT:/?recoveryError=retry_input_not_reconstructable"
  );

  expect(mocks.revalidatePath).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run Web store/action tests and verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts
```

Expected: fail because Web store and actions do not expose recovery yet.

- [ ] **Step 4: Add Web store types and execution method**

Modify imports in `apps/web/src/lib/workbench-store.ts`:

```ts
  executeRunRecoveryAction as executeApiRunRecoveryAction,
  listRunRecoveryViewsForTask,
  type RunLifecycleView,
  type RunRecoveryExecutionAction,
  type RunRecoveryExecutionErrorCode,
  type RunRecoveryExecutionResult,
```

Add types:

```ts
export type RunRecoveryFlowErrorCode = RunRecoveryExecutionErrorCode;

export interface WorkbenchTaskRecoveryState {
  runs: RunLifecycleView[];
}

export type RunRecoveryActionResult =
  | { ok: true; value: RunRecoveryExecutionResult & { ok: true } }
  | { ok: false; error: RunRecoveryFlowErrorCode };

export interface ExecuteRunRecoveryFormInput {
  taskId: string;
  runId: string;
  action: RunRecoveryExecutionAction;
}
```

Add `recovery` to the `task_ready` branch of `WorkbenchPageState`:

```ts
      recovery: WorkbenchTaskRecoveryState;
```

Add the method to `WebWorkbenchStore`:

```ts
  executeRunRecoveryAction(input: ExecuteRunRecoveryFormInput): Promise<RunRecoveryActionResult>;
```

In `getPageState`, add:

```ts
const recovery = await listRunRecoveryViewsForTask({
  repositories,
  taskId: task.id,
  workerRuntime: workerQueueRuntime ?? workerRuntime
});
```

Return it in `task_ready`:

```ts
recovery: {
  runs: recovery
},
```

Add the store method:

```ts
async executeRunRecoveryAction(input) {
  const result = await executeApiRunRecoveryAction({
    repositories,
    service,
    workerRuntime: workerQueueRuntime ?? workerRuntime,
    currentUserId: currentUser.id,
    taskId: input.taskId,
    runId: input.runId,
    action: input.action
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, value: result };
}
```

- [ ] **Step 5: Add Web server action parsing and redirect**

Modify `apps/web/src/app/actions.ts` imports:

```ts
  type RunRecoveryFlowErrorCode,
```

Add redirect helper:

```ts
function redirectToRecoveryError(error: RunRecoveryFlowErrorCode): never {
  redirect(`/?recoveryError=${encodeURIComponent(error)}`);
}
```

Add parser:

```ts
function parseRunRecoveryAction(
  rawValue: FormDataEntryValue | null
): "resume_worker_finalization" | "retry_run" {
  const value = String(rawValue ?? "");
  if (value === "resume_worker_finalization" || value === "retry_run") {
    return value;
  }
  redirectToRecoveryError("recovery_action_not_available");
}
```

Add server action:

```ts
export async function executeRunRecoveryAction(formData: FormData): Promise<void> {
  const store = await getWebWorkbenchStore();
  const result = await store.executeRunRecoveryAction({
    taskId: String(formData.get("taskId") ?? "").trim(),
    runId: String(formData.get("runId") ?? "").trim(),
    action: parseRunRecoveryAction(formData.get("action"))
  });
  if (!result.ok) {
    redirectToRecoveryError(result.error);
  }
  revalidatePath("/");
  redirect("/");
}
```

- [ ] **Step 6: Run Web store/action tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit Task 3**

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.ts apps/web/src/app/actions.test.ts
git commit -m "wire run recovery server action"
```

## Task 4: Inline Recovery UI

**Files:**

- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Add failing i18n/page tests**

Add i18n assertions to `apps/web/src/lib/i18n.test.ts`:

```ts
expect(en.chat.recoveryTitle).toBe("Run recovery");
expect(en.chat.recoveryActionLabels.retry_run).toBe("Retry run");
expect(en.chat.recoveryActionLabels.resume_worker_finalization).toBe("Resume finalization");
expect(en.chat.recoveryGuidanceLabels.inspect_manually).toBe("Inspect manually");
expect(zh.chat.recoveryTitle).toBe("运行恢复");
expect(zh.chat.recoveryActionLabels.retry_run).toBe("重试运行");
expect(zh.chat.recoveryGuidanceLabels.resolve_blocker).toBe("解除阻塞");
```

Add page rendering tests to `apps/web/src/app/page.test.ts`:

```ts
it("renders inline recovery actions without raw diagnostics", async () => {
  pageMocks.currentProjectId = "project_1";
  pageMocks.currentTaskId = "task_1";
  pageMocks.pageState = createCompletedLpPageState({
    recovery: {
      runs: [
        {
          runId: "run_planner_failed",
          projectId: "project_1",
          taskId: "task_1",
          role: "planner",
          state: "failed",
          runRecordState: "failed",
          startedAt: "2026-05-20T00:00:01.000Z",
          completedAt: "2026-05-20T00:00:02.000Z",
          terminalEventType: "run.failed",
          diagnosticSummary: {
            code: "model_output_parse_failed",
            message: "Model output could not be parsed safely.",
            source: "model_parse",
            eventType: "model.output.parse_failed",
            errorName: "secret-token"
          },
          recoveryActions: ["retry_run"]
        },
        {
          runId: "run_builder_blocked",
          projectId: "project_1",
          taskId: "task_1",
          role: "builder",
          state: "blocked",
          runRecordState: "needs_input",
          startedAt: "2026-05-20T00:00:03.000Z",
          diagnosticSummary: {
            code: "input_required",
            message: "Run is waiting for input.",
            source: "lifecycle"
          },
          recoveryActions: ["resolve_blocker"]
        }
      ]
    }
  });

  const page = await HomePage({ searchParams: Promise.resolve({}) });
  const visibleText = collectText(page).join(" ");
  const forms = collectElements(page, "form");
  const recoveryForms = forms.filter((form) =>
    collectFormPayload(form).runId === "run_planner_failed"
  );

  expect(visibleText).toContain("Run recovery");
  expect(visibleText).toContain("Planner");
  expect(visibleText).toContain("Failed");
  expect(visibleText).toContain("Retry run");
  expect(visibleText).toContain("Resolve blocker");
  expect(visibleText).not.toContain("secret-token");
  expect(recoveryForms).toHaveLength(1);
  expect(collectFormPayload(recoveryForms[0])).toEqual({
    taskId: "task_1",
    runId: "run_planner_failed",
    action: "retry_run"
  });
});
```

- [ ] **Step 2: Run UI tests and verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts apps/web/src/app/page.test.ts
```

Expected: fail because copy keys and UI rendering do not exist.

- [ ] **Step 3: Add recovery copy keys**

Extend `WorkbenchCopy["chat"]` in `apps/web/src/lib/i18n.ts`:

```ts
    recoveryTitle: string;
    recoverySubtitle: string;
    recoveryStateLabels: Record<"queued" | "running" | "waiting_for_approval" | "blocked" | "cancelling" | "cancelled" | "failed" | "completed", string>;
    recoveryActionLabels: Record<"resume_worker_finalization" | "retry_run", string>;
    recoveryGuidanceLabels: Record<"request_approval" | "resolve_blocker" | "inspect_manually", string>;
    recoveryErrorLabel: string;
```

Add English copy:

```ts
      recoveryTitle: "Run recovery",
      recoverySubtitle: "Safe recovery options derived from the run lifecycle.",
      recoveryStateLabels: {
        queued: "Queued",
        running: "Running",
        waiting_for_approval: "Waiting approval",
        blocked: "Blocked",
        cancelling: "Stopping",
        cancelled: "Stopped",
        failed: "Failed",
        completed: "Completed"
      },
      recoveryActionLabels: {
        resume_worker_finalization: "Resume finalization",
        retry_run: "Retry run"
      },
      recoveryGuidanceLabels: {
        request_approval: "Request approval",
        resolve_blocker: "Resolve blocker",
        inspect_manually: "Inspect manually"
      },
      recoveryErrorLabel: "Recovery action could not be completed.",
```

Add Chinese copy:

```ts
      recoveryTitle: "运行恢复",
      recoverySubtitle: "根据运行生命周期派生的安全恢复选项。",
      recoveryStateLabels: {
        queued: "排队中",
        running: "运行中",
        waiting_for_approval: "等待审批",
        blocked: "已阻塞",
        cancelling: "正在停止",
        cancelled: "已停止",
        failed: "失败",
        completed: "完成"
      },
      recoveryActionLabels: {
        resume_worker_finalization: "继续写回",
        retry_run: "重试运行"
      },
      recoveryGuidanceLabels: {
        request_approval: "请求审批",
        resolve_blocker: "解除阻塞",
        inspect_manually: "人工检查"
      },
      recoveryErrorLabel: "恢复动作未能完成。",
```

- [ ] **Step 4: Render inline recovery block**

Modify imports in `apps/web/src/app/page.tsx`:

```ts
  executeRunRecoveryAction,
```

Add `recoveryError` parsing:

```ts
const recoveryError = getFirstSearchParam(params?.recoveryError);
const recoveryErrorMessage = recoveryError ? copy.chat.recoveryErrorLabel : undefined;
```

Show it near existing task errors:

```tsx
{recoveryErrorMessage ? (
  <div className="formError" role="alert">{recoveryErrorMessage}</div>
) : null}
```

Render the block after `processBlock` and before `chat.assistantCompletion`:

```tsx
{pageState.kind === "task_ready" && pageState.recovery.runs.length > 0 ? (
  <section className="recoveryBlock" aria-label={copy.chat.recoveryTitle}>
    <div className="recoveryHeader">
      <strong>{copy.chat.recoveryTitle}</strong>
      <span>{copy.chat.recoverySubtitle}</span>
    </div>
    <div className="recoveryList">
      {pageState.recovery.runs.map((run) => {
        const executableActions = run.recoveryActions.filter(
          (action) => action === "resume_worker_finalization" || action === "retry_run"
        );
        const guidanceActions = run.recoveryActions.filter(
          (action) =>
            action === "request_approval" ||
            action === "resolve_blocker" ||
            action === "inspect_manually"
        );
        return (
          <div className="recoveryItem" data-state={run.state} key={run.runId}>
            <div className="recoveryItemTop">
              <strong>{copy.modelsView.roleLabels[run.role]}</strong>
              <span>{copy.chat.recoveryStateLabels[run.state]}</span>
            </div>
            <p>
              {run.diagnosticSummary?.message ??
                run.terminalEventType ??
                run.runRecordState}
            </p>
            <small>{run.diagnosticSummary?.code ?? run.runId}</small>
            <div className="recoveryActions">
              {executableActions.map((action) => (
                <form action={executeRunRecoveryAction} key={action}>
                  <input name="taskId" type="hidden" value={pageState.task.id} />
                  <input name="runId" type="hidden" value={run.runId} />
                  <input name="action" type="hidden" value={action} />
                  <button type="submit">{copy.chat.recoveryActionLabels[action]}</button>
                </form>
              ))}
              {guidanceActions.map((action) => (
                <span className="recoveryGuidance" key={action}>
                  {copy.chat.recoveryGuidanceLabels[action]}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  </section>
) : null}
```

- [ ] **Step 5: Add recovery CSS**

Add to `apps/web/src/app/globals.css` near `.processBlock` and `.deliveryBlock`:

```css
.recoveryBlock {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
}

.recoveryHeader {
  display: grid;
  gap: 3px;
  min-height: 42px;
  border-bottom: 1px solid var(--line);
  padding: 10px 13px;
}

.recoveryHeader strong {
  font-size: 0.86rem;
  font-weight: 830;
}

.recoveryHeader span {
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1.4;
}

.recoveryList {
  display: grid;
  gap: 0;
}

.recoveryItem {
  display: grid;
  gap: 6px;
  padding: 11px 13px;
}

.recoveryItem:not(:last-child) {
  border-bottom: 1px solid var(--line);
}

.recoveryItemTop {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.recoveryItemTop strong {
  min-width: 0;
  font-size: 0.86rem;
  overflow-wrap: anywhere;
}

.recoveryItemTop span {
  flex: 0 0 auto;
  color: var(--accent);
  font-size: 0.75rem;
  font-weight: 800;
}

.recoveryItem[data-state="failed"] .recoveryItemTop span {
  color: #b42318;
}

.recoveryItem[data-state="blocked"] .recoveryItemTop span,
.recoveryItem[data-state="waiting_for_approval"] .recoveryItemTop span {
  color: #9a6700;
}

.recoveryItem p {
  margin: 0;
  color: #3c4147;
  font-size: 0.88rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.recoveryItem small {
  color: var(--muted);
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}

.recoveryActions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.recoveryActions form {
  margin: 0;
}

.recoveryActions button,
.recoveryGuidance {
  min-height: 30px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font-size: 0.78rem;
  font-weight: 800;
}

.recoveryActions button {
  cursor: pointer;
  padding: 0 10px;
}

.recoveryGuidance {
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
}
```

- [ ] **Step 6: Run UI tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts apps/web/src/app/page.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit Task 4**

```bash
git add apps/web/src/lib/i18n.ts apps/web/src/lib/i18n.test.ts apps/web/src/app/page.tsx apps/web/src/app/page.test.ts apps/web/src/app/globals.css
git commit -m "add inline run recovery ui"
```

## Task 5: Stage 25 Regression Coverage and Documentation

**Files:**

- Modify: `packages/api/src/run-recovery.test.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `docs/project-roadmap.md`
- Modify: `docs/agent-development-learning.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Add final regression tests**

Add compact regression tests that cover the Stage 25 named cases:

```ts
it("keeps completed repaired runs non-actionable", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  await saveTask(repositories);
  await saveRun(repositories, {
    id: "run_builder_version_1",
    role: "builder",
    state: "completed",
    completedAt: "2026-05-20T00:00:04.000Z"
  });
  await saveEvent(repositories, {
    runId: "run_builder_version_1",
    type: "model.output.parse_failed",
    sequence: 1,
    payload: { reason: "invalid_json" }
  });
  await saveEvent(repositories, {
    runId: "run_builder_version_1",
    type: "model.output.repair_started",
    sequence: 2
  });
  await saveEvent(repositories, {
    runId: "run_builder_version_1",
    type: "run.completed",
    sequence: 3
  });

  const views = await listRunRecoveryViewsForTask({ repositories, taskId: "task_1" });

  expect(views[0]).toMatchObject({
    state: "completed",
    recoveryActions: []
  });
  expect(views[0].diagnosticSummary).toBeUndefined();
});
```

Add Web page tests for `cancelled`, `blocked`, and `resume_worker_finalization` rows by using this concrete recovery state:

```ts
const recovery = {
  runs: [
    {
      runId: "run_cancelled_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      state: "cancelled",
      runRecordState: "cancelled",
      startedAt: "2026-05-20T00:00:01.000Z",
      completedAt: "2026-05-20T00:00:02.000Z",
      terminalEventType: "run.cancelled",
      recoveryActions: []
    },
    {
      runId: "run_blocked_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "reviewer",
      state: "blocked",
      runRecordState: "needs_input",
      startedAt: "2026-05-20T00:00:03.000Z",
      diagnosticSummary: {
        code: "handoff_blocked",
        message: "Run is blocked by an inbound handoff.",
        source: "handoff"
      },
      recoveryActions: ["resolve_blocker"]
    },
    {
      runId: "run_worker_gap_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "deployer",
      state: "failed",
      runRecordState: "running",
      startedAt: "2026-05-20T00:00:04.000Z",
      linkedWorkerJobId: "worker_job_1",
      diagnosticSummary: {
        code: "worker_finalization_incomplete",
        message: "Worker job completed but run finalization is incomplete.",
        source: "lifecycle",
        eventType: "worker.job.linked",
        errorName: "RAW_STDOUT_SECRET"
      },
      recoveryActions: ["resume_worker_finalization"]
    }
  ]
};
```

Then assert:

```ts
expect(visibleText).toContain("Stopped");
expect(visibleText).toContain("Resolve blocker");
expect(visibleText).toContain("Resume finalization");
expect(visibleText).not.toContain("RAW_STDOUT_SECRET");
```

- [ ] **Step 2: Update docs after implementation lands**

In `docs/project-roadmap.md`, move Stage 25 from "待 implementation plan" to "已实现" and make Stage 26 the current recommended next stage. Keep Stage 27 after Stage 26.

In `docs/agent-development-learning.md`, update the Stage 25 section from "已确认设计" to "已实现", and record:

- Web task state now includes recovery views.
- Server actions re-derive lifecycle before execution.
- `retry_run` creates a new retry run and fails closed for unsupported command side effects.

In `docs/superpowers/README.md`, ensure this plan is listed after the Stage 25 design and mark it as implemented only after verification passes.

- [ ] **Step 3: Run targeted verification**

Run:

```bash
pnpm --filter @lp-agent/api test -- run-recovery.test.ts run-lifecycle.test.ts services.test.ts
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts apps/web/src/lib/i18n.test.ts apps/web/src/app/page.test.ts
pnpm typecheck
```

Expected: all commands pass.

- [ ] **Step 4: Commit Task 5**

```bash
git add packages/api/src/run-recovery.test.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/app/page.test.ts docs/project-roadmap.md docs/agent-development-learning.md docs/superpowers/README.md
git commit -m "document run recovery ui completion"
```

## Final Verification

After all tasks are complete, run:

```bash
pnpm --filter @lp-agent/api test -- run-recovery.test.ts run-lifecycle.test.ts services.test.ts
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts apps/web/src/lib/i18n.test.ts apps/web/src/app/page.test.ts
pnpm test
pnpm typecheck
```

Expected:

- API recovery, lifecycle, and service tests pass.
- Web store, server action, i18n, and page tests pass.
- Full Vitest suite passes.
- TypeScript typecheck passes.

## Self-Review

Spec coverage:

- Inline recovery block: Task 4.
- `RunLifecycleView` in Web task state: Task 3.
- `resume_worker_finalization`: Task 1.
- Controlled `retry_run`: Task 2.
- Guidance actions: Task 4.
- Completed repaired, failed parse/retry exhausted, missing finalization, cancelled, blocked regressions: Task 1, Task 4, Task 5.
- Redaction: Task 1, Task 3, Task 4, Task 5.
- Non-goals preserved: no scheduler, no full chain rerun, no streaming UI, no team approval queue.

Placeholder scan:

- No deferred-work marker strings, deferred implementation notes, or unspecified error-handling instructions remain in this plan.
- Code snippets define the types and function names they use.

Type consistency:

- API action names use `resume_worker_finalization` and `retry_run` consistently.
- Web store error type aliases `RunRecoveryExecutionErrorCode` as `RunRecoveryFlowErrorCode`.
- Web action, store, and UI all pass only `taskId`, `runId`, and `action`.
