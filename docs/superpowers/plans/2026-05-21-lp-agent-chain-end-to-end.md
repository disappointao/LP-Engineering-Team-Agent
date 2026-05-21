# LP Agent Chain End-to-End v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status:** Implemented and archived. This plan records the Stage 28 execution history; future agents should read `docs/project-roadmap.md` before choosing the next stage.
>
> **Execution record:** Completed with task-first LP chain orchestration, focused Web/API regression, `pnpm test`, and `pnpm typecheck`.

**Goal:** Build Stage 28 so Web LP prompts create a task first, run the fixed `Planner -> Builder -> Reviewer -> Deployer` chain with that `taskId`, persist durable artifacts, and preserve observable recovery facts on failure.

**Architecture:** Keep the chain fixed and synchronous in the Web/API store layer for v0. Refactor `submitTaskPrompt()` from success-only LP generation into task-first orchestration that incrementally updates the task snapshot and delegates role execution to existing `DemoWorkbenchService` methods.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, Next.js server actions, repository-backed Web workbench store, `@lp-agent/api`, `@lp-agent/db`, `@lp-agent/runtime-adapters`.

---

## Scope Guard

This plan implements only Stage 28 from `docs/superpowers/specs/2026-05-21-lp-agent-chain-end-to-end-design.md`.

It does not implement a generic DAG scheduler, MCP execution, real shell execution, real external deployment, provider token streaming, usage/cost reporting, live polling/SSE task state, auth/RBAC, object storage, or production Postgres rollout.

## File Structure

- Modify `apps/web/src/lib/workbench-store.ts` and `apps/web/src/lib/workbench-store.test.ts` for task-first LP orchestration, chain failure handling, task-bound run event loading, and continued LP modification.
- Modify `apps/web/src/app/actions.ts` and `apps/web/src/app/actions.test.ts` so `submitPromptAction()` passes the current task id and redirects to a partially created LP task on safe chain failure.
- Modify `apps/web/src/app/page.test.ts` only for UI-visible task state expectations affected by task-bound LP chain facts.
- Modify `apps/web/src/lib/web-v1-smoke.test.ts` to cover the deterministic end-to-end LP chain including Deployer handoff.
- Modify `packages/api/src/index.ts` and `packages/api/src/services.test.ts` only where API service inputs must carry previous page-version context for modification runs.
- Modify `docs/superpowers/plans/2026-05-21-lp-agent-chain-end-to-end.md`, `docs/superpowers/README.md`, `docs/project-roadmap.md`, and `docs/agent-development-learning.md` during final documentation closure.

## Task 1: Add LP Task-First Thread Helpers

**Files:**
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`

- [x] **Step 1: Write failing tests for pre-run task persistence**

Add tests to `apps/web/src/lib/workbench-store.test.ts`:

```ts
import type {
  AgentRuntimeAdapter,
  RuntimeRunRequest,
  RuntimeRunResult
} from "@lp-agent/runtime-adapters";

class StaticRuntime implements AgentRuntimeAdapter {
  constructor(private readonly result: Partial<RuntimeRunResult>) {}

  async run(request: RuntimeRunRequest): Promise<RuntimeRunResult> {
    const state = this.result.state ?? "completed";
    return {
      runId: request.runId,
      projectId: request.projectId,
      taskId: request.taskId,
      role: request.role,
      state,
      artifacts: this.result.artifacts,
      findings: this.result.findings,
      modelOutputText: this.result.modelOutputText,
      events: [
        {
          type: "run.started",
          message: `${request.role} run started.`,
          runId: request.runId,
          role: request.role
        },
        {
          type: state === "completed" ? "run.completed" : "run.failed",
          message: `${request.role} run ${state === "completed" ? "completed" : "failed"}.`,
          runId: request.runId,
          role: request.role,
          state
        }
      ]
    };
  }
}

class RecordingRuntime extends StaticRuntime {
  readonly requests: RuntimeRunRequest[] = [];

  async run(request: RuntimeRunRequest): Promise<RuntimeRunResult> {
    this.requests.push(request);
    return super.run(request);
  }
}

function completeArtifacts() {
  return {
    indexHtml: "<!doctype html><html><head><title>Spring Sale</title></head><body><main><h1>Spring Sale</h1><a href=\"#shop\">Shop now</a></main></body></html>",
    stylesCss: "body { font-family: system-ui, sans-serif; }",
    scriptJs: "window.lpAgent = true;"
  };
}

it("creates an LP task and user message before Planner runs", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const plannerRuntime = new StaticRuntime({ state: "failed" });
  const store = createWebWorkbenchStore({ repositories, plannerRuntime });

  const result = await store.submitTaskPrompt({
    prompt: "Create a landing page for a spring sale",
    implicitProjectName: "Spring Sale",
    projectId: null
  });

  expect(result).toMatchObject({
    ok: false,
    error: "generation_failed",
    taskType: "lp_generation"
  });
  if (result.ok) {
    throw new Error("expected generation failure");
  }
  expect(result.taskId).toBe("task_1");
  expect(result.projectId).toBe("project_1");

  await expect(repositories.tasks.getById("task_1")).resolves.toMatchObject({
    id: "task_1",
    type: "lp_generation",
    projectId: "project_1"
  });
  await expect(repositories.messages.listForTask("task_1")).resolves.toEqual([
    expect.objectContaining({
      id: "message_1",
      role: "user",
      content: "Create a landing page for a spring sale"
    }),
    expect.objectContaining({
      id: "message_2",
      role: "assistant",
      content: "LP generation failed. Open recovery details for the failed run."
    })
  ]);
  await expect(repositories.taskSnapshots.getByTaskId("task_1")).resolves.toMatchObject({
    taskId: "task_1",
    projectId: "project_1"
  });
});
```

Also extend `SubmitTaskResult` assertions in existing tests so failed LP generation can include `taskId`, `projectId`, and `taskType`.

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts -t "creates an LP task and user message before Planner runs"
```

Expected: FAIL because `WebWorkbenchStoreOptions` does not accept `plannerRuntime`, and `submitTaskPrompt()` currently creates the task only after the LP chain succeeds.

- [x] **Step 3: Add runtime injection options for focused store tests**

In `apps/web/src/lib/workbench-store.ts`, import the runtime type:

```ts
import type { AgentRuntimeAdapter } from "@lp-agent/runtime-adapters";
```

Extend `WebWorkbenchStoreOptions`:

```ts
export interface WebWorkbenchStoreOptions {
  repositories?: WorkbenchRepositories;
  assistantRuntime?: AgentRuntimeAdapter;
  plannerRuntime?: AgentRuntimeAdapter;
  builderRuntime?: AgentRuntimeAdapter;
  reviewerRuntime?: AgentRuntimeAdapter;
  deployerRuntime?: AgentRuntimeAdapter;
  toolCommandRunner?: ToolCommandRunner;
  workerRuntime?: TaskInterruptWorkerRuntime;
  workerQueueRuntime?: SkillCommandQueueRuntime;
  workerJobRepository?: WorkerJobRepository;
  workerLogRepository?: WorkerLogRepository;
  workerId?: string;
  currentUser?: WorkbenchUserIdentity;
}
```

Pass those options into `DemoWorkbenchService` inside `createWebWorkbenchStore()`:

```ts
const service = new DemoWorkbenchService({
  repositories,
  currentUser,
  assistantRuntime: options.assistantRuntime,
  plannerRuntime: options.plannerRuntime,
  builderRuntime: options.builderRuntime,
  reviewerRuntime: options.reviewerRuntime,
  deployerRuntime: options.deployerRuntime,
  toolCommandRunner: options.toolCommandRunner ?? new SimulatedToolCommandRunner(),
  workerQueueRuntime
});
```

- [x] **Step 4: Add helper functions for LP task thread persistence**

In `apps/web/src/lib/workbench-store.ts`, add these helpers near `saveTaskThread()`:

```ts
async function createTaskThread(input: {
  repositories: WorkbenchRepositories;
  title: string;
  type: TaskType;
  projectId?: string;
  userMessage: string;
  now?: () => Date;
}): Promise<{ task: TaskRecord; userMessage: ChatMessageRecord }> {
  return withRepositoryTaskLock(input.repositories, async () => {
    const now = (input.now ?? (() => new Date()))().toISOString();
    const existingTasks = await input.repositories.tasks.listAll();
    const existingMessages = await input.repositories.messages.listAll();
    const task: TaskRecord = {
      id: nextSequentialId("task", existingTasks.map((record) => record.id)),
      title: input.title,
      type: input.type,
      status: "complete",
      projectId: input.projectId,
      createdAt: now
    };
    const userMessage: ChatMessageRecord = {
      id: nextSequentialId("message", existingMessages.map((record) => record.id)),
      taskId: task.id,
      role: "user",
      content: input.userMessage,
      createdAt: now
    };
    await input.repositories.tasks.save(task);
    await input.repositories.messages.save(userMessage);
    return { task: { ...task }, userMessage: { ...userMessage } };
  });
}

async function appendTaskMessage(input: {
  repositories: WorkbenchRepositories;
  taskId: string;
  role: WorkbenchMessageRole;
  content: string;
  now?: () => Date;
}): Promise<ChatMessageRecord> {
  return withRepositoryTaskLock(input.repositories, async () => {
    const now = (input.now ?? (() => new Date()))().toISOString();
    const existingMessages = await input.repositories.messages.listAll();
    const message: ChatMessageRecord = {
      id: nextSequentialId("message", existingMessages.map((record) => record.id)),
      taskId: input.taskId,
      role: input.role,
      content: input.content,
      createdAt: now
    };
    await input.repositories.messages.save(message);
    return { ...message };
  });
}

async function saveTaskSnapshot(input: {
  repositories: WorkbenchRepositories;
  taskId: string;
  projectId: string;
  briefId?: string;
  pageVersionId?: string;
  now?: () => Date;
}): Promise<void> {
  const existing = await input.repositories.taskSnapshots.getByTaskId(input.taskId);
  await input.repositories.taskSnapshots.save({
    taskId: input.taskId,
    projectId: input.projectId,
    briefId: input.briefId ?? existing?.briefId,
    pageVersionId: input.pageVersionId ?? existing?.pageVersionId,
    createdAt: existing?.createdAt ?? (input.now ?? (() => new Date()))().toISOString()
  });
}
```

- [x] **Step 5: Extend `SubmitTaskResult` for safe failed task redirects**

In `apps/web/src/lib/workbench-store.ts`, update the failed result branch:

```ts
export type SubmitTaskResult =
  | {
      ok: true;
      taskId: string;
      taskType: TaskType;
      projectId?: string;
    }
  | {
      ok: false;
      error: ProjectFlowErrorCode;
      taskId?: string;
      taskType?: TaskType;
      projectId?: string;
    };
```

- [x] **Step 6: Run focused test**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts -t "creates an LP task and user message before Planner runs"
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts
git commit -m "add lp task thread helpers"
```

## Task 2: Orchestrate Full Deterministic LP Chain With Task IDs

**Files:**
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`
- Modify: `apps/web/src/lib/web-v1-smoke.test.ts`

- [x] **Step 1: Write failing end-to-end store test**

Add this test to `apps/web/src/lib/workbench-store.test.ts`:

```ts
it("runs Planner Builder Reviewer and Deployer under the same LP task", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const plannerRuntime = new RecordingRuntime({ state: "completed" });
  const builderRuntime = new RecordingRuntime({
    state: "completed",
    artifacts: completeArtifacts()
  });
  const reviewerRuntime = new RecordingRuntime({ state: "completed", findings: [] });
  const deployerRuntime = new RecordingRuntime({ state: "completed" });
  const store = createWebWorkbenchStore({
    repositories,
    plannerRuntime,
    builderRuntime,
    reviewerRuntime,
    deployerRuntime
  });

  const result = await store.submitTaskPrompt({
    prompt: "Create a landing page for a spring sale",
    implicitProjectName: "Spring Sale",
    projectId: null
  });

  expect(result).toEqual({
    ok: true,
    taskId: "task_1",
    taskType: "lp_generation",
    projectId: "project_1"
  });

  await expect(repositories.runs.listForTask("task_1")).resolves.toEqual([
    expect.objectContaining({ id: "run_planner_brief_1", role: "planner", taskId: "task_1" }),
    expect.objectContaining({ id: "run_builder_version_1", role: "builder", taskId: "task_1" }),
    expect.objectContaining({ id: "run_reviewer_version_1", role: "reviewer", taskId: "task_1" }),
    expect.objectContaining({ id: "run_deployer_version_1", role: "deployer", taskId: "task_1" })
  ]);
  await expect(repositories.taskSnapshots.getByTaskId("task_1")).resolves.toMatchObject({
    projectId: "project_1",
    briefId: "brief_1",
    pageVersionId: "version_1"
  });
  await expect(repositories.deployments.getByPageVersionId("version_1")).resolves.toMatchObject({
    pageVersionId: "version_1"
  });
  await expect(repositories.messages.listForTask("task_1")).resolves.toEqual([
    expect.objectContaining({ role: "user" }),
    expect.objectContaining({
      role: "assistant",
      content: "LP artifacts are ready for review."
    })
  ]);
});
```

Add or update `apps/web/src/lib/web-v1-smoke.test.ts` so the smoke test asserts a deployment handoff exists after deterministic LP generation:

```ts
expect(pageState.snapshot?.deployment?.pageVersionId).toBe(pageVersion?.id);
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts -t "runs Planner Builder Reviewer and Deployer under the same LP task"
pnpm exec vitest run apps/web/src/lib/web-v1-smoke.test.ts
```

Expected: FAIL because existing LP submission does not create Deployer runs and Planner / Builder / Reviewer runs do not receive task ids.

- [x] **Step 3: Add LP chain orchestration helper**

In `apps/web/src/lib/workbench-store.ts`, add this helper near `saveTaskThread()`:

```ts
async function runLpAgentChainForTask(input: {
  repositories: WorkbenchRepositories;
  service: DemoWorkbenchService;
  currentUser: WorkbenchUserIdentity;
  taskId: string;
  projectId: string;
  prompt: string;
  previousPageVersionId?: string;
  now?: () => Date;
}): Promise<{ briefId: string; pageVersionId: string }> {
  const brief = await input.service.createBriefFromPrompt({
    projectId: input.projectId,
    taskId: input.taskId,
    prompt: input.prompt
  });
  await saveTaskSnapshot({
    repositories: input.repositories,
    taskId: input.taskId,
    projectId: input.projectId,
    briefId: brief.id,
    now: input.now
  });

  const pageVersion = await input.service.generatePageVersion({
    projectId: input.projectId,
    briefId: brief.id,
    taskId: input.taskId
  });
  await saveTaskSnapshot({
    repositories: input.repositories,
    taskId: input.taskId,
    projectId: input.projectId,
    briefId: brief.id,
    pageVersionId: pageVersion.id,
    now: input.now
  });

  const reviewedPageVersion = await input.service.reviewPageVersion({
    projectId: input.projectId,
    pageVersionId: pageVersion.id,
    taskId: input.taskId
  });
  if (reviewedPageVersion.reviewStatus === "passed") {
    await input.service.approveAndCreateDeployment({
      projectId: input.projectId,
      pageVersionId: reviewedPageVersion.id,
      taskId: input.taskId,
      reviewerUserId: input.currentUser.id
    });
  }

  return {
    briefId: brief.id,
    pageVersionId: reviewedPageVersion.id
  };
}
```

Task 6 will extend this helper to pass `input.previousPageVersionId` as Builder context once the API service accepts `contextPageVersionId`.

- [x] **Step 4: Route LP prompts through task-first orchestration**

In `submitTaskPrompt()`, replace the current `if (taskType === "lp_generation" && projectId) { ... }` block with this structure:

```ts
if (taskType === "lp_generation") {
  return runLpTaskPrompt({
    repositories,
    service,
    currentUser,
    requestedProjectId,
    prompt: prompt.value,
    implicitProjectName: input.implicitProjectName
  });
}
```

Add `runLpTaskPrompt()` near the helper from Step 3:

```ts
async function runLpTaskPrompt(input: {
  repositories: WorkbenchRepositories;
  service: DemoWorkbenchService;
  currentUser: WorkbenchUserIdentity;
  requestedProjectId?: string;
  prompt: string;
  implicitProjectName: string;
}): Promise<SubmitTaskResult> {
  let projectId = input.requestedProjectId;
  if (!projectId) {
    const project = await input.service.createProject({
      name: deriveImplicitProjectName(input.prompt, input.implicitProjectName)
    });
    projectId = project.id;
  }

  const { task } = await createTaskThread({
    repositories: input.repositories,
    title: deriveTaskTitle(input.prompt),
    type: "lp_generation",
    projectId,
    userMessage: input.prompt
  });
  await saveTaskSnapshot({
    repositories: input.repositories,
    taskId: task.id,
    projectId
  });

  try {
    const chain = await runLpAgentChainForTask({
      repositories: input.repositories,
      service: input.service,
      currentUser: input.currentUser,
      taskId: task.id,
      projectId,
      prompt: input.prompt
    });
    await saveTaskSnapshot({
      repositories: input.repositories,
      taskId: task.id,
      projectId,
      briefId: chain.briefId,
      pageVersionId: chain.pageVersionId
    });
    await appendTaskMessage({
      repositories: input.repositories,
      taskId: task.id,
      role: "assistant",
      content: "LP artifacts are ready for review."
    });
    return { ok: true, taskId: task.id, taskType: "lp_generation", projectId };
  } catch {
    await appendTaskMessage({
      repositories: input.repositories,
      taskId: task.id,
      role: "assistant",
      content: "LP generation failed. Open recovery details for the failed run."
    });
    return {
      ok: false,
      error: "generation_failed",
      taskId: task.id,
      taskType: "lp_generation",
      projectId
    };
  }
}
```

- [x] **Step 5: Run focused tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts -t "runs Planner Builder Reviewer and Deployer under the same LP task"
pnpm exec vitest run apps/web/src/lib/web-v1-smoke.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/lib/web-v1-smoke.test.ts
git commit -m "run lp chain under task id"
```

## Task 3: Preserve Failed Planner and Builder Runs in Task State

**Files:**
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`
- Modify: `apps/web/src/app/actions.ts`
- Modify: `apps/web/src/app/actions.test.ts`

- [x] **Step 1: Write failing store tests for Planner and Builder failure**

Add these tests to `apps/web/src/lib/workbench-store.test.ts`:

```ts
it("returns a failed LP task with recovery facts when Planner fails", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const store = createWebWorkbenchStore({
    repositories,
    plannerRuntime: new StaticRuntime({ state: "failed" })
  });

  const result = await store.submitTaskPrompt({
    prompt: "Create a landing page for a spring sale",
    implicitProjectName: "Spring Sale",
    projectId: null
  });

  expect(result).toMatchObject({
    ok: false,
    error: "generation_failed",
    taskId: "task_1",
    projectId: "project_1"
  });
  await expect(repositories.briefs.listAll()).resolves.toEqual([]);
  await expect(repositories.pageVersions.listAll()).resolves.toEqual([]);
  const pageState = await store.getPageState({ projectId: "project_1", taskId: "task_1" });
  expect(pageState.kind).toBe("task_ready");
  if (pageState.kind !== "task_ready") {
    throw new Error("expected task state");
  }
  expect(pageState.runEvents.map((event) => event.runId)).toContain("run_planner_brief_1");
  expect(pageState.recovery.runs.map((view) => view.runId)).toContain("run_planner_brief_1");
});

it("does not save page versions when Builder fails under an LP task", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const store = createWebWorkbenchStore({
    repositories,
    builderRuntime: new StaticRuntime({ state: "failed" })
  });

  const result = await store.submitTaskPrompt({
    prompt: "Create a landing page for a spring sale",
    implicitProjectName: "Spring Sale",
    projectId: null
  });

  expect(result).toMatchObject({
    ok: false,
    error: "generation_failed",
    taskId: "task_1",
    projectId: "project_1"
  });
  await expect(repositories.briefs.listAll()).resolves.toHaveLength(1);
  await expect(repositories.pageVersions.listAll()).resolves.toEqual([]);
  await expect(repositories.artifactWorkspaces.listAll()).resolves.toEqual([]);
  await expect(repositories.taskSnapshots.getByTaskId("task_1")).resolves.toMatchObject({
    projectId: "project_1",
    briefId: "brief_1"
  });
});
```

- [x] **Step 2: Write failing action test for failed task redirect**

In `apps/web/src/app/actions.test.ts`, add:

```ts
it("keeps the failed LP task selected when generation fails after task creation", async () => {
  mocks.getCurrentProjectId.mockResolvedValue(null);
  mocks.getWebWorkbenchStore.mockResolvedValue({
    submitTaskPrompt: vi.fn().mockResolvedValue({
      ok: false,
      error: "generation_failed",
      taskId: "task_1",
      taskType: "lp_generation",
      projectId: "project_1"
    })
  });

  await expectRedirect(
    submitPromptAction(buildPromptForm({ prompt: "Create an ecommerce LP in HTML." })),
    "/?error=generation_failed"
  );

  expect(mocks.setCurrentTaskId).toHaveBeenCalledWith("task_1");
  expect(mocks.setCurrentProjectId).toHaveBeenCalledWith("project_1");
});
```

- [x] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts -t "failed LP task|Builder fails"
pnpm exec vitest run apps/web/src/app/actions.test.ts -t "keeps the failed LP task selected"
```

Expected: FAIL because `getPageState()` filters run events through snapshot-derived run ids and `submitPromptAction()` discards failed result task metadata.

- [x] **Step 4: Load LP run events by task id**

In `getPageState()`, replace the `runEvents` assignment with:

```ts
const taskRunEvents = await repositories.runEvents.listForTask(task.id);
const runEvents =
  taskRunEvents.length > 0
    ? taskRunEvents
    : activeProjectId
      ? filterRunEventsForSnapshot(
          await repositories.runEvents.listForProject(activeProjectId),
          snapshotRef
        )
      : [];
```

This keeps older snapshot-derived tasks visible while Stage 28 task-bound runs use the direct repository query.

- [x] **Step 5: Preserve failed task selection in `submitPromptAction()`**

In `apps/web/src/app/actions.ts`, change the failed branch:

```ts
if (!result.ok) {
  if (result.taskId) {
    await setCurrentTaskId(result.taskId);
  }
  if (result.projectId) {
    await setCurrentProjectId(result.projectId);
  }
  redirectWithError(result.error);
}
```

- [x] **Step 6: Run focused tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts -t "failed LP task|Builder fails"
pnpm exec vitest run apps/web/src/app/actions.test.ts -t "keeps the failed LP task selected"
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.ts apps/web/src/app/actions.test.ts
git commit -m "preserve failed lp task facts"
```

## Task 4: Handle Reviewer Blocked and Deployer Failure Boundaries

**Files:**
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`
- Modify: `apps/web/src/app/page.test.ts`

- [x] **Step 1: Write failing Reviewer blocked test**

Add to `apps/web/src/lib/workbench-store.test.ts`:

```ts
it("keeps blocked Reviewer results without creating a Deployer run", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const reviewerRuntime = new RecordingRuntime({
    state: "completed",
    findings: [
      {
        severity: "blocking",
        target: "hero.cta",
        explanation: "Missing call to action.",
        blocksDeployment: true
      }
    ]
  });
  const deployerRuntime = new RecordingRuntime({ state: "completed" });
  const store = createWebWorkbenchStore({ repositories, reviewerRuntime, deployerRuntime });

  const result = await store.submitTaskPrompt({
    prompt: "Create a landing page for a spring sale",
    implicitProjectName: "Spring Sale",
    projectId: null
  });

  expect(result).toEqual({
    ok: true,
    taskId: "task_1",
    taskType: "lp_generation",
    projectId: "project_1"
  });
  await expect(repositories.runs.getById("run_deployer_version_1")).resolves.toBeUndefined();
  await expect(repositories.pageVersions.getById("version_1")).resolves.toMatchObject({
    reviewStatus: "failed"
  });
  const pageState = await store.getPageState({ projectId: "project_1", taskId: "task_1" });
  expect(pageState.kind).toBe("task_ready");
  if (pageState.kind !== "task_ready") {
    throw new Error("expected task state");
  }
  expect(pageState.recovery.runs.some((view) => view.state === "blocked")).toBe(true);
});
```

- [x] **Step 2: Write failing Deployer failure test**

Add to `apps/web/src/lib/workbench-store.test.ts`:

```ts
it("keeps the page version when Deployer fails", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const deployerRuntime = new StaticRuntime({ state: "failed" });
  const store = createWebWorkbenchStore({ repositories, deployerRuntime });

  const result = await store.submitTaskPrompt({
    prompt: "Create a landing page for a spring sale",
    implicitProjectName: "Spring Sale",
    projectId: null
  });

  expect(result).toMatchObject({
    ok: false,
    error: "generation_failed",
    taskId: "task_1",
    projectId: "project_1"
  });
  await expect(repositories.pageVersions.getById("version_1")).resolves.toMatchObject({
    id: "version_1",
    reviewStatus: "passed"
  });
  await expect(repositories.deployments.getByPageVersionId("version_1")).resolves.toBeUndefined();
});
```

- [x] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts -t "Reviewer results|Deployer fails"
```

Expected: FAIL until `runLpAgentChainForTask()` treats Reviewer blocked as chain-complete and Deployer failure as a safe task failure with preserved page version.

- [x] **Step 4: Adjust `runLpAgentChainForTask()` blocked behavior**

In `runLpAgentChainForTask()`, keep the existing conditional:

```ts
if (reviewedPageVersion.reviewStatus === "passed") {
  await input.service.approveAndCreateDeployment({
    projectId: input.projectId,
    pageVersionId: reviewedPageVersion.id,
    taskId: input.taskId,
    reviewerUserId: input.currentUser.id
  });
}
```

Do not throw when `reviewedPageVersion.reviewStatus === "failed"`. Return the reviewed page version id so the task snapshot points at the blocked artifact.

- [x] **Step 5: Ensure task summary copy distinguishes blocked review**

In `runLpTaskPrompt()`, after `runLpAgentChainForTask()`, load the page version and choose assistant copy:

```ts
const pageVersion = await input.repositories.pageVersions.getById(chain.pageVersionId);
const assistantSummary =
  pageVersion?.reviewStatus === "failed"
    ? "LP artifacts need review attention before deployment."
    : "LP artifacts are ready for review.";
await appendTaskMessage({
  repositories: input.repositories,
  taskId: task.id,
  role: "assistant",
  content: assistantSummary
});
```

- [x] **Step 6: Run focused tests and affected page tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts -t "Reviewer results|Deployer fails"
pnpm exec vitest run apps/web/src/app/page.test.ts -t "recovery|LP"
```

Expected: PASS. If the page test filter selects no tests, run the full page test command in Task 8.

- [x] **Step 7: Commit**

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/app/page.test.ts
git commit -m "handle lp review and deployer boundaries"
```

## Task 5: Support Continued LP Modification in the Same Task

**Files:**
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`
- Modify: `apps/web/src/app/actions.ts`
- Modify: `apps/web/src/app/actions.test.ts`

- [x] **Step 1: Write failing same-task modification test**

Add to `apps/web/src/lib/workbench-store.test.ts`:

```ts
it("continues an existing LP task by creating a new page version", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const store = createWebWorkbenchStore({ repositories });

  const first = await store.submitTaskPrompt({
    prompt: "Create a landing page for a spring sale",
    implicitProjectName: "Spring Sale",
    projectId: null
  });
  expect(first).toMatchObject({ ok: true, taskId: "task_1", projectId: "project_1" });
  if (!first.ok || !first.projectId) {
    throw new Error("expected first LP task");
  }

  const second = await store.submitTaskPrompt({
    taskId: first.taskId,
    projectId: first.projectId,
    prompt: "Make the hero CTA more urgent and add a FAQ section",
    implicitProjectName: "Spring Sale"
  });

  expect(second).toEqual({
    ok: true,
    taskId: "task_1",
    taskType: "lp_generation",
    projectId: "project_1"
  });
  await expect(repositories.pageVersions.listAll()).resolves.toEqual([
    expect.objectContaining({ id: "version_1" }),
    expect.objectContaining({ id: "version_2" })
  ]);
  await expect(repositories.taskSnapshots.getByTaskId("task_1")).resolves.toMatchObject({
    briefId: "brief_2",
    pageVersionId: "version_2"
  });
  const messages = await repositories.messages.listForTask("task_1");
  expect(messages.map((message) => message.role)).toEqual([
    "user",
    "assistant",
    "user",
    "assistant"
  ]);
});
```

- [x] **Step 2: Write failing action test that passes current task id**

In `apps/web/src/app/actions.test.ts`, update the existing successful `submitPromptAction` test or add:

```ts
it("passes current task id to submitTaskPrompt", async () => {
  mocks.getCurrentProjectId.mockResolvedValue("project_1");
  mocks.getCurrentTaskId.mockResolvedValue("task_1");
  const submitTaskPrompt = vi.fn().mockResolvedValue({
    ok: true,
    taskId: "task_1",
    taskType: "lp_generation",
    projectId: "project_1"
  });
  mocks.getWebWorkbenchStore.mockResolvedValue({ submitTaskPrompt });

  await expectRedirect(
    submitPromptAction(buildPromptForm({ prompt: "Make the CTA stronger" })),
    "/"
  );

  expect(submitTaskPrompt).toHaveBeenCalledWith({
    taskId: "task_1",
    projectId: "project_1",
    prompt: "Make the CTA stronger",
    implicitProjectName: "Untitled LP Project"
  });
});
```

- [x] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts -t "continues an existing LP task"
pnpm exec vitest run apps/web/src/app/actions.test.ts -t "passes current task id"
```

Expected: FAIL because `submitTaskPrompt()` does not accept `taskId` and action does not pass it.

- [x] **Step 4: Extend store and action input**

In `WebWorkbenchStore.submitTaskPrompt` input type, add:

```ts
taskId?: string | null;
```

In `submitPromptAction()`, read and pass the current task id:

```ts
const currentTaskId = await getCurrentTaskId();
const result = await store.submitTaskPrompt({
  taskId: currentTaskId,
  projectId: currentProjectId,
  prompt,
  implicitProjectName
});
```

- [x] **Step 5: Reuse an existing LP task when ownership matches**

In `runLpTaskPrompt()`, add `requestedTaskId?: string` to the input. Before creating a new task, resolve an existing task:

```ts
const existingTask = input.requestedTaskId
  ? await input.repositories.tasks.getById(input.requestedTaskId)
  : undefined;
const reusableTask =
  existingTask &&
  existingTask.type === "lp_generation" &&
  existingTask.projectId === projectId
    ? existingTask
    : undefined;
```

If `reusableTask` exists, append the user message instead of creating a new thread:

```ts
const task = reusableTask
  ? { ...reusableTask }
  : (await createTaskThread({
      repositories: input.repositories,
      title: deriveTaskTitle(input.prompt),
      type: "lp_generation",
      projectId,
      userMessage: input.prompt
    })).task;
if (reusableTask) {
  await appendTaskMessage({
    repositories: input.repositories,
    taskId: reusableTask.id,
    role: "user",
    content: input.prompt
  });
}
```

Load previous page version id before running the chain:

```ts
const previousSnapshot = await input.repositories.taskSnapshots.getByTaskId(task.id);
const previousPageVersionId = previousSnapshot?.pageVersionId;
```

Pass it to `runLpAgentChainForTask()`:

```ts
previousPageVersionId
```

At this point the previous page version id is retained by the helper input. Task 6 wires it into Builder runtime context after the API signature is extended.

- [x] **Step 6: Run focused tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts -t "continues an existing LP task"
pnpm exec vitest run apps/web/src/app/actions.test.ts -t "passes current task id"
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.ts apps/web/src/app/actions.test.ts
git commit -m "support continued lp task edits"
```

## Task 6: Inject Previous Artifact Metadata Into Builder Context

**Files:**
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/services.test.ts`
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`

- [x] **Step 1: Write failing API context test**

Add to `packages/api/src/services.test.ts`:

```ts
it("passes previous page version artifact workspace metadata into Builder context", async () => {
  const builderRuntime = new RecordingRuntime({
    state: "completed",
    artifacts: completeArtifacts()
  });
  const service = new DemoWorkbenchService({ builderRuntime, now: fixedClock() });
  const project = await service.createProject({ name: "Project" });
  const firstBrief = await service.createBriefFromPrompt({
    projectId: project.id,
    prompt: "Create a landing page"
  });
  const firstVersion = await service.generatePageVersion({
    projectId: project.id,
    briefId: firstBrief.id
  });
  const secondBrief = await service.createBriefFromPrompt({
    projectId: project.id,
    prompt: "Add a FAQ section"
  });

  await service.generatePageVersion({
    projectId: project.id,
    briefId: secondBrief.id,
    contextPageVersionId: firstVersion.id
  });

  expect(builderRuntime.requests.at(-1)?.context?.artifactWorkspace.workspaceId).toBe(
    firstVersion.artifactWorkspaceId
  );
  expect(JSON.stringify(builderRuntime.requests.at(-1)?.context?.artifactWorkspace)).not.toContain(
    "<!doctype html"
  );
});
```

- [x] **Step 2: Run test to verify failure**

Run:

```bash
pnpm exec vitest run packages/api/src/services.test.ts -t "previous page version artifact workspace"
```

Expected: FAIL because `GeneratePageVersionInput` has no `contextPageVersionId`.

- [x] **Step 3: Add context page version input**

In `packages/api/src/index.ts`, extend `GeneratePageVersionInput`:

```ts
export interface GeneratePageVersionInput {
  projectId: string;
  briefId: string;
  taskId?: string;
  runId?: string;
  contextPageVersionId?: string;
}
```

In `generatePageVersion()`, validate the previous page version before `runAgentStep()`:

```ts
const contextPageVersionId = input.contextPageVersionId;
if (contextPageVersionId) {
  await this.getPageVersionForProjectOrThrow(input.projectId, contextPageVersionId);
}
```

Pass it into `runAgentStep()`:

```ts
pageVersionId: contextPageVersionId,
```

Keep the new page version id generated by `pageVersionId` local variable unchanged.

In `apps/web/src/lib/workbench-store.ts`, update the `generatePageVersion()` call inside `runLpAgentChainForTask()`:

```ts
const pageVersion = await input.service.generatePageVersion({
  projectId: input.projectId,
  briefId: brief.id,
  taskId: input.taskId,
  contextPageVersionId: input.previousPageVersionId
});
```

- [x] **Step 4: Run API context test**

Run:

```bash
pnpm exec vitest run packages/api/src/services.test.ts -t "previous page version artifact workspace"
```

Expected: PASS.

- [x] **Step 5: Run store continuation test again**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts -t "continues an existing LP task"
```

Expected: PASS and TypeScript accepts the `contextPageVersionId` call from `runLpAgentChainForTask()`.

- [x] **Step 6: Commit**

```bash
git add packages/api/src/index.ts packages/api/src/services.test.ts apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts
git commit -m "inject previous lp artifact context"
```

## Task 7: Cover Real Planner and Builder Runtime Through Web Store

**Files:**
- Modify: `apps/web/src/lib/workbench-store.test.ts`
- Modify: `packages/api/src/services.test.ts`

- [x] **Step 1: Write failing Web real-runtime chain test**

Add to `apps/web/src/lib/workbench-store.test.ts`:

```ts
it("uses real-runtime structured Planner and Builder output for LP tasks", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const modelFetch = createStructuredLPModelFetch();
  const store = createWebWorkbenchStore({
    repositories,
    env: {
      REAL_MODEL_RUNTIME: "1",
      OPENAI_COMPATIBLE_API_KEY: "test-key"
    },
    modelFetch
  });
  const project = await store.createProject({ name: "Spring Sale" });
  await store.createModelProvider({
    projectId: project.id,
    providerId: "provider_openai",
    name: "OpenAI Compatible",
    provider: "openai-compatible",
    api: "openai-completions",
    baseUrl: "https://models.example.test/v1",
    apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY"
  });
  await store.upsertProjectModelRoute({
    projectId: project.id,
    role: "planner",
    providerId: "provider_openai",
    model: "planner-model"
  });
  await store.upsertProjectModelRoute({
    projectId: project.id,
    role: "builder",
    providerId: "provider_openai",
    model: "builder-model"
  });

  const result = await store.submitTaskPrompt({
    projectId: project.id,
    prompt: "Create a landing page for a spring sale",
    implicitProjectName: "Spring Sale"
  });

  expect(result).toMatchObject({ ok: true, taskType: "lp_generation", projectId: project.id });
  await expect(repositories.briefs.getById("brief_1")).resolves.toMatchObject({
    brief: expect.objectContaining({ title: "Model Built LP" })
  });
  await expect(repositories.pageVersions.getById("version_1")).resolves.toMatchObject({
    artifacts: expect.objectContaining({
      indexHtml: expect.stringContaining("Model Built LP")
    })
  });
  const runs = await repositories.runs.listForTask("task_1");
  expect(runs.map((run) => run.role)).toEqual(["planner", "builder", "reviewer", "deployer"]);
});
```

Add this helper in `apps/web/src/lib/workbench-store.test.ts`:

```ts
function createStructuredLPModelFetch(): typeof fetch {
  return vi.fn(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const content = String(messages[0]?.content ?? "");
    const text = content.includes("StaticArtifactsSchema")
      ? JSON.stringify({
          indexHtml: "<!doctype html><html><head><title>Model Built LP</title></head><body><main><h1>Model Built LP</h1><a href=\"#buy\">Buy now</a></main></body></html>",
          stylesCss: "body { font-family: system-ui, sans-serif; }",
          scriptJs: "window.lpAgent = true;"
        })
      : JSON.stringify({
          title: "Model Built LP",
          audience: "Spring shoppers",
          goal: "Drive campaign conversions",
          sections: [
            { id: "hero", title: "Model Built LP", goal: "Introduce the offer" },
            { id: "proof", title: "Trusted by shoppers", goal: "Build confidence" },
            { id: "cta", title: "Buy now", goal: "Convert visitors" }
          ],
          tone: "confident",
          cta: "Buy now"
        });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: text } }],
        model: body.model ?? "test-model"
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;
}
```

- [x] **Step 2: Run test to verify failure**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts -t "real-runtime structured Planner and Builder"
```

Expected: FAIL because `WebWorkbenchStoreOptions` does not yet expose `env` and `modelFetch`.

- [x] **Step 3: Expose `env` and `modelFetch` in store options**

In `apps/web/src/lib/workbench-store.ts`, import `RuntimeEnvironment` from API and `ModelFetch` from model-gateway:

```ts
import type { ModelFetch } from "@lp-agent/model-gateway";
import type { RuntimeEnvironment } from "@lp-agent/api";
```

Extend `WebWorkbenchStoreOptions`:

```ts
env?: RuntimeEnvironment;
modelFetch?: ModelFetch;
```

Pass both into `DemoWorkbenchService`:

```ts
env: options.env,
modelFetch: options.modelFetch,
```

- [x] **Step 4: Run real-runtime focused test**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts -t "real-runtime structured Planner and Builder"
```

Expected: PASS.

- [x] **Step 5: Run API structured runtime regression**

Run:

```bash
pnpm exec vitest run packages/api/src/services.test.ts -t "REAL_MODEL_RUNTIME|parsed real Builder|parsed real Planner|repair"
```

Expected: PASS. If the test name filter selects no tests, run `pnpm exec vitest run packages/api/src/services.test.ts`.

- [x] **Step 6: Commit**

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts packages/api/src/services.test.ts
git commit -m "test real lp chain runtime"
```

## Task 8: Run UI and Store Regression Coverage

**Files:**
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/app/actions.test.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`
- Modify: `apps/web/src/lib/web-v1-smoke.test.ts`

- [x] **Step 1: Run Web-focused tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts apps/web/src/lib/web-v1-smoke.test.ts
```

Expected: PASS. Read the output and list every failing test name before editing.

- [x] **Step 2: Fix action/page expectations caused by task-first LP flow**

If page or action tests fail because LP results now include deployment handoff or failed task metadata, update the expected objects to include these exact fields:

```ts
{
  taskId: "task_1",
  taskType: "lp_generation",
  projectId: "project_1"
}
```

For page state with a completed LP, assert deployment handoff is present:

```ts
expect(pageState.snapshot?.deployment?.pageVersionId).toBe(
  pageState.snapshot?.currentPageVersion?.id
);
```

For failed LP state, assert recovery remains visible:

```ts
expect(pageState.recovery.runs.length).toBeGreaterThan(0);
```

- [x] **Step 3: Re-run Web-focused tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts apps/web/src/lib/web-v1-smoke.test.ts
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts apps/web/src/lib/web-v1-smoke.test.ts
git commit -m "cover lp chain web flow"
```

## Task 9: Documentation Closure

**Files:**
- Modify: `docs/superpowers/plans/2026-05-21-lp-agent-chain-end-to-end.md`
- Modify: `docs/superpowers/README.md`
- Modify: `docs/project-roadmap.md`
- Modify: `docs/agent-development-learning.md`

- [x] **Step 1: Mark plan execution status**

After implementation and verification, update this plan header by adding an execution record below the required sub-skill line:

```md
> **Status:** Implemented and archived. This plan records the Stage 28 execution history; future agents should read `docs/project-roadmap.md` before choosing the next stage.
>
> **Execution record:** Completed with task-first LP chain orchestration, focused Web/API regression, `pnpm test`, and `pnpm typecheck`.
```

Also change completed task checkboxes from `- [ ]` to `- [x]` only for tasks actually completed.

- [x] **Step 2: Update Superpowers README**

In `docs/superpowers/README.md`, add the implementation plan entry immediately after the Stage 28 design entry:

```md
85. `plans/2026-05-21-lp-agent-chain-end-to-end.md`
   - Stage 28 LP Agent Chain End-to-End v0 implementation plan（已实现后标记为完成）。
   - 在 Stage 28 design 后阅读，用于审计 task-first LP chain orchestration、同 task run 绑定、durable artifact workspace、Reviewer blocked / Deployer failure 边界、继续修改、测试和文档收尾。
```

- [x] **Step 3: Update roadmap**

In `docs/project-roadmap.md`, move Stage 28 from current recommended to completed once implementation is merged. Add:

```md
**实施计划：** `docs/superpowers/plans/2026-05-21-lp-agent-chain-end-to-end.md`。
```

Change the recommendation queue so Stage 29 becomes:

```md
**状态：** 当前推荐下一阶段。
```

Add a decision record:

```md
- Stage 28 已完成 LP Agent Chain End-to-End v0：LP 复杂任务现在采用 task-first orchestration，同一个 task 绑定 Planner / Builder / Reviewer / Deployer runs、handoff、artifact workspace、deployment handoff 和 recovery facts。
```

- [x] **Step 4: Update Agent learning notes**

In `docs/agent-development-learning.md`, update the Stage 28 bullets to present implementation facts:

```md
- Stage 28 LP Agent Chain End-to-End v0 已实现：Web LP 复杂任务采用 task-first fixed chain orchestration；Planner / Builder / Reviewer / Deployer 的 run、handoff、artifact workspace、deployment handoff 和 recovery facts 都绑定到同一个 task。Planner / Builder 在 `REAL_MODEL_RUNTIME=1` 下继续走真实模型 structured output；Reviewer / Deployer 仍 deterministic / policy-driven。
```

- [x] **Step 5: Commit docs**

```bash
git add docs/superpowers/plans/2026-05-21-lp-agent-chain-end-to-end.md docs/superpowers/README.md docs/project-roadmap.md docs/agent-development-learning.md
git commit -m "document lp chain implementation"
```

## Task 10: Final Verification

**Files:**
- No source edits expected unless verification finds a regression.

- [x] **Step 1: Run focused Stage 28 regression**

Run:

```bash
pnpm exec vitest run packages/api/src/services.test.ts packages/api/src/run-lifecycle.test.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts apps/web/src/lib/web-v1-smoke.test.ts
```

Expected: PASS.

- [x] **Step 2: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS with zero failed test files.

- [x] **Step 3: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS across all workspace projects.

- [x] **Step 4: Check git status**

Run:

```bash
git status --short --branch
```

Expected: clean branch or only intentional uncommitted changes that are explicitly documented.

- [x] **Step 5: Commit any verification fixes**

If verification required source or test fixes, commit them:

```bash
git add <changed-files>
git commit -m "fix lp chain regression"
```

Replace `<changed-files>` with the exact paths shown by `git status --short`.

## Self-Review

- Spec coverage: Tasks 1-3 cover task-first orchestration and failure persistence; Task 2 covers full fixed chain and Deployer handoff; Task 4 covers Reviewer blocked and Deployer failure; Task 5 covers continued LP modification; Task 6 covers previous artifact metadata context; Task 7 covers real Planner / Builder structured output; Task 8 covers Web/UI regressions; Task 9 covers required documentation updates.
- Placeholder scan: no unfinished marker words or open-ended implementation notes are intended in this plan.
- Type consistency: `contextPageVersionId` is introduced on `GeneratePageVersionInput` in Task 6 and used by `runLpAgentChainForTask()` from Task 2; workers should complete Task 6 before committing Task 2 if TypeScript blocks the intermediate state.
