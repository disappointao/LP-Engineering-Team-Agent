# Stage 29 Live Run Timeline and Artifact Progress v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Web task panel 在不手动刷新页面的情况下展示 LP run timeline、recovery view、worker state 和 artifact progress，并在新 page version 可用后自动刷新 preview/export。

**Architecture:** API/Web store 继续是事实派生边界，新增 safe `LiveTaskStatePayload` 和 polling route；客户端只轮询 repository-derived facts，不保存新的长期事实源。LP prompt 仍先走 ordinary chat stream 入口，收到 unsupported fallback 后改为调用 live task submit route，该 route 创建 task 后立即返回并在进程内启动现有 task-first LP chain，随后由 polling route 投影进度。

**Tech Stack:** Next.js App Router route handlers、React client component、Vitest、现有 `@lp-agent/api` / `@lp-agent/db` repository contracts、现有 `workbench-store` 和 `StreamingWorkbench`。

---

## File Structure

- Modify `apps/web/src/lib/workbench-store.ts`
  - Add `LiveTaskStatePayload`, `LiveTaskStateResult`, `LiveTaskPromptStartResult`.
  - Add `getLiveTaskState()` and `startLiveTaskPrompt()` to `WebWorkbenchStore`.
  - Split LP task preparation from LP chain execution so the live submit route can return after task creation.
- Modify `apps/web/src/lib/workbench-store.test.ts`
  - Add store-level tests for live payload safety, artifact progress, terminal hints, project mismatch, and in-process LP live start.
- Create `apps/web/src/app/api/tasks/[taskId]/state/route.ts`
  - Return safe live task state JSON with `cache-control: no-store`.
- Create `apps/web/src/app/api/tasks/[taskId]/state/route.test.ts`
  - Route tests for success, ownership mismatch, missing task, no-store headers, and raw data safety.
- Create `apps/web/src/app/api/tasks/submit/route.ts`
  - Start live non-chat task flow after chat stream fallback, set current project/task cookies, return task id immediately.
- Create `apps/web/src/app/api/tasks/submit/route.test.ts`
  - Route tests for prompt validation, LP start, cookies, project mismatch, and safe errors.
- Create `apps/web/src/app/live-task-state.ts`
  - Pure reducer/helpers for polling state, polling hints, and refresh decisions.
- Create `apps/web/src/app/live-task-state.test.ts`
  - Unit tests for helper behavior without React DOM.
- Create `apps/web/src/app/live-task-panel.tsx`
  - Client component that polls task state, renders compact live status, and calls `router.refresh()` when artifact/page version changes.
- Create `apps/web/src/app/live-task-panel.test.ts`
  - Render-by-function tests for visible copy and payload safety.
- Modify `apps/web/src/app/streaming-workbench.tsx`
  - Replace hidden native fallback submit for non-chat tasks with live task submit route and polling activation.
- Modify `apps/web/src/app/streaming-workbench.test.ts`
  - Add pure helper tests for live fallback submit request bodies and decisions.
- Modify `apps/web/src/app/page.tsx`
  - Render `LiveTaskPanel` for task-ready pages and pass active task/project ids to the streaming shell.
- Modify `apps/web/src/app/page.test.ts`
  - Assert page wires live panel props and ordinary chat streaming remains unchanged.
- Modify `apps/web/src/lib/i18n.ts` and `apps/web/src/lib/i18n.test.ts`
  - Add localized live timeline/progress/polling error copy.
- Modify `apps/web/src/app/globals.css`
  - Add compact, workbench-style live panel styles.
- Modify `apps/web/src/lib/web-v1-smoke.test.ts`
  - Add store-level smoke coverage for live state payload and artifact progress.
- Modify `docs/superpowers/README.md`
  - Add Stage 29 implementation plan entry.
- Modify `docs/project-roadmap.md`
  - Link this plan and keep Stage 29 marked as current implementation stage.

---

### Task 1: Store-Level Live Task State Contract

**Files:**
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`

**Purpose:** Expose a safe, repository-derived payload that route handlers and polling UI can consume without leaking raw model/tool/artifact data.

- [ ] **Step 1: Write failing tests for live task state payload**

Add these tests near the existing task-ready/recovery/artifact tests in `apps/web/src/lib/workbench-store.test.ts`:

```ts
describe("live task state", () => {
  it("returns safe live state with lifecycle, recovery, worker queue, and artifact progress", async () => {
    const store = createWebWorkbenchStore();
    const result = await store.submitTaskPrompt({
      prompt: "Create a spring launch LP with static HTML CSS JS",
      implicitProjectName: "Live State Project"
    });

    expect(result.ok).toBe(true);
    if (!result.ok || !result.projectId) {
      throw new Error("expected LP task");
    }

    const live = await store.getLiveTaskState({
      taskId: result.taskId,
      projectId: result.projectId
    });

    expect(live.ok).toBe(true);
    if (!live.ok) {
      throw new Error("expected live state");
    }

    expect(live.value).toMatchObject({
      taskId: result.taskId,
      projectId: result.projectId,
      taskType: "lp_generation",
      isTerminal: true,
      nextPollMs: 0
    });
    expect(live.value.runs.map((run) => run.role)).toEqual([
      "planner",
      "builder",
      "reviewer",
      "deployer"
    ]);
    expect(live.value.artifactProgress?.pageVersionId).toBe(
      live.value.snapshot?.currentPageVersion?.id
    );
    expect(live.value.artifactProgress?.artifactWorkspaceId).toBe(
      live.value.snapshot?.currentPageVersion?.artifactWorkspaceId
    );
    expect(live.value.workerQueue.counts).toMatchObject({
      queued: 0,
      running: 0
    });
    expect(JSON.stringify(live.value)).not.toContain("<!doctype html");
    expect(JSON.stringify(live.value)).not.toContain("window.lpAgent");
  });

  it("fails closed when the requested project does not own the task", async () => {
    const store = createWebWorkbenchStore();
    const first = await store.submitTaskPrompt({
      prompt: "Create an LP for one project",
      implicitProjectName: "First Project"
    });
    const secondProject = await store.createProject({ name: "Second Project" });

    if (!first.ok) {
      throw new Error("expected first task");
    }

    await expect(
      store.getLiveTaskState({
        taskId: first.taskId,
        projectId: secondProject.id
      })
    ).resolves.toEqual({ ok: false, error: "project_not_found" });
  });
});
```

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts --testNamePattern "live task state"
```

Expected: FAIL because `getLiveTaskState` does not exist on `WebWorkbenchStore`.

- [ ] **Step 3: Add live payload types and store method**

In `apps/web/src/lib/workbench-store.ts`, add these exports after `WorkbenchPageState`:

```ts
export type LiveTaskStateErrorCode = "task_not_found" | "project_not_found";

export interface LiveTaskArtifactProgress {
  pageVersionId: string;
  artifactWorkspaceId?: string;
  fileCount: number;
  changedFileCount: number;
  previewVersionKey: string;
}

export interface LiveTaskStatePayload {
  taskId: string;
  projectId?: string;
  taskType: TaskType;
  taskStatus: TaskStatus;
  stateVersion: string;
  isTerminal: boolean;
  nextPollMs: number;
  updatedAt: string;
  messages: ChatMessageRecord[];
  runs: RunLifecycleView[];
  runEvents: RunEventRecord[];
  recovery: WorkbenchTaskRecoveryState;
  workerQueue: WorkerQueueSnapshot;
  interrupt: TaskInterrupt;
  snapshot?: WorkbenchSnapshot;
  artifactDiff?: WebArtifactDiffState;
  artifactProgress?: LiveTaskArtifactProgress;
}

export type LiveTaskStateResult =
  | { ok: true; value: LiveTaskStatePayload }
  | { ok: false; error: LiveTaskStateErrorCode };
```

Extend `WebWorkbenchStore`:

```ts
  getLiveTaskState(input: {
    taskId: string;
    projectId?: string | null;
    artifactPath?: string | null;
  }): Promise<LiveTaskStateResult>;
```

Add helper functions near `emptyWorkerQueueSnapshot()`:

```ts
function isLiveTaskTerminal(pageState: TaskReadyPageState): boolean {
  const runningRun = pageState.recovery.runs.some((run) =>
    ["queued", "running", "waiting_for_approval", "cancelling"].includes(run.state)
  );
  const activeWorkerCount =
    pageState.workerQueue.counts.queued + pageState.workerQueue.counts.running;
  return !runningRun && activeWorkerCount === 0;
}

function buildLiveTaskStateVersion(pageState: TaskReadyPageState): string {
  const parts = [
    pageState.task.createdAt,
    pageState.messages.at(-1)?.id ?? "no-message",
    pageState.runEvents.at(-1)?.id ?? "no-event",
    pageState.snapshot?.currentPageVersion?.id ?? "no-page",
    pageState.artifactDiff?.artifactWorkspaceId ?? "no-workspace",
    String(pageState.workerQueue.counts.queued),
    String(pageState.workerQueue.counts.running)
  ];
  return parts.join(":");
}

function buildArtifactProgress(
  artifactDiff: WebArtifactDiffState | undefined
): LiveTaskArtifactProgress | undefined {
  if (!artifactDiff) {
    return undefined;
  }
  const changedFileCount = artifactDiff.files.filter(
    (file) => file.state !== "unchanged"
  ).length;
  return {
    pageVersionId: artifactDiff.pageVersionId,
    artifactWorkspaceId: artifactDiff.artifactWorkspaceId,
    fileCount: artifactDiff.files.length,
    changedFileCount,
    previewVersionKey: [
      artifactDiff.pageVersionId,
      artifactDiff.artifactWorkspaceId ?? "no-workspace",
      ...artifactDiff.files.map((file) => `${file.path}:${file.shortSha256 ?? "no-hash"}`)
    ].join("|")
  };
}
```

Add the store method by reusing `getPageState()`:

```ts
    async getLiveTaskState(input) {
      const pageState = await this.getPageState(input);
      if (pageState.kind !== "task_ready") {
        const task = await repositories.tasks.getById(input.taskId);
        return {
          ok: false,
          error: task ? "project_not_found" : "task_not_found"
        };
      }

      const isTerminal = isLiveTaskTerminal(pageState);
      return {
        ok: true,
        value: {
          taskId: pageState.task.id,
          ...(pageState.task.projectId ? { projectId: pageState.task.projectId } : {}),
          taskType: pageState.task.type,
          taskStatus: pageState.task.status,
          stateVersion: buildLiveTaskStateVersion(pageState),
          isTerminal,
          nextPollMs: isTerminal ? 0 : 1200,
          updatedAt: new Date().toISOString(),
          messages: pageState.messages,
          runs: pageState.recovery.runs,
          runEvents: pageState.runEvents,
          recovery: pageState.recovery,
          workerQueue: pageState.workerQueue,
          interrupt: pageState.interrupt,
          snapshot: pageState.snapshot,
          artifactDiff: pageState.artifactDiff,
          artifactProgress: buildArtifactProgress(pageState.artifactDiff)
        }
      };
    },
```

- [ ] **Step 4: Run the targeted tests and verify they pass**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts --testNamePattern "live task state"
```

Expected: PASS for the live task state tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts
git commit -m "add live task state payload"
```

---

### Task 2: Live LP Task Start Boundary

**Files:**
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`

**Purpose:** Let the Web route create an LP task and return immediately, while the existing LP chain continues in process and polling observes repository facts.

- [ ] **Step 1: Write failing tests for live LP task start**

Add this test near the Stage 28 LP chain tests in `apps/web/src/lib/workbench-store.test.ts`:

```ts
describe("live task prompt start", () => {
  it("returns an LP task before the async chain finishes", async () => {
    let releaseBuilder!: () => void;
    const builderGate = new Promise<void>((resolve) => {
      releaseBuilder = resolve;
    });
    const runtime = {
      async run(input) {
        if (input.role === "builder") {
          await builderGate;
        }
        return {
          state: "completed" as const,
          content: input.role === "planner"
            ? JSON.stringify({
                objective: "Launch a live LP",
                audience: "Operators",
                offer: "No-refresh progress",
                primaryCta: "Start",
                sections: [
                  { heading: "Hero", body: "Live progress", cta: "Start" }
                ]
              })
            : JSON.stringify({
                indexHtml: "<!doctype html><html><head><title>Live</title></head><body><main><h1>Live</h1></main></body></html>",
                stylesCss: ":root { color-scheme: light; } body { margin: 0; }",
                scriptJs: "window.lpAgent = { ready: true };"
              })
        };
      }
    };
    const store = createWebWorkbenchStore({
      env: { REAL_MODEL_RUNTIME: "1" },
      modelFetch: async () => new Response("{}"),
      plannerRuntime: runtime,
      builderRuntime: runtime
    });

    const started = await store.startLiveTaskPrompt({
      projectId: null,
      taskId: null,
      prompt: "Create a live progress LP",
      implicitProjectName: "Live Progress"
    });

    expect(started).toMatchObject({
      ok: true,
      taskType: "lp_generation"
    });
    if (!started.ok || !started.projectId) {
      throw new Error("expected started LP task");
    }

    const runningState = await store.getLiveTaskState({
      projectId: started.projectId,
      taskId: started.taskId
    });
    expect(runningState.ok).toBe(true);
    if (!runningState.ok) {
      throw new Error("expected running state");
    }
    expect(runningState.value.messages[0]?.content).toBe("Create a live progress LP");
    expect(runningState.value.snapshot?.currentPageVersion).toBeUndefined();

    releaseBuilder();
    await started.completion;

    const completedState = await store.getLiveTaskState({
      projectId: started.projectId,
      taskId: started.taskId
    });
    expect(completedState.ok).toBe(true);
    if (!completedState.ok) {
      throw new Error("expected completed state");
    }
    expect(completedState.value.artifactProgress?.fileCount).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts --testNamePattern "live task prompt start"
```

Expected: FAIL because `startLiveTaskPrompt` does not exist.

- [ ] **Step 3: Add start result type and split LP preparation/execution**

In `apps/web/src/lib/workbench-store.ts`, add:

```ts
export type LiveTaskPromptStartResult =
  | {
      ok: true;
      taskId: string;
      taskType: TaskType;
      projectId?: string;
      completion: Promise<SubmitTaskResult>;
    }
  | { ok: false; error: ProjectFlowErrorCode };
```

Extend `WebWorkbenchStore`:

```ts
  startLiveTaskPrompt(input: {
    taskId?: string | null;
    projectId?: string | null;
    prompt: string;
    implicitProjectName: string;
  }): Promise<LiveTaskPromptStartResult>;
```

Refactor the existing `runLpTaskPrompt()` by extracting this helper before it:

```ts
async function prepareLpTaskPrompt(input: {
  repositories: WorkbenchRepositories;
  service: DemoWorkbenchService;
  requestedTaskId?: string;
  requestedProjectId?: string;
  prompt: string;
  implicitProjectName: string;
}): Promise<{
  task: TaskRecord;
  projectId: string;
  previousPageVersionId?: string;
}> {
  let projectId = input.requestedProjectId;
  if (!projectId) {
    const project = await input.service.createProject({
      name: deriveImplicitProjectName(input.prompt, input.implicitProjectName)
    });
    projectId = project.id;
  }

  const existingTask = input.requestedTaskId
    ? await input.repositories.tasks.getById(input.requestedTaskId)
    : undefined;
  const reusableTask =
    existingTask && existingTask.type === "lp_generation" && existingTask.projectId === projectId
      ? existingTask
      : undefined;
  const task = reusableTask
    ? { ...reusableTask }
    : (
        await createTaskThread({
          repositories: input.repositories,
          title: deriveTaskTitle(input.prompt),
          type: "lp_generation",
          projectId,
          userMessage: input.prompt
        })
      ).task;

  if (reusableTask) {
    await appendTaskMessage({
      repositories: input.repositories,
      taskId: reusableTask.id,
      role: "user",
      content: input.prompt
    });
  } else {
    await saveTaskSnapshot({
      repositories: input.repositories,
      taskId: task.id,
      projectId
    });
  }

  const previousSnapshot = await input.repositories.taskSnapshots.getByTaskId(task.id);
  return {
    task,
    projectId,
    previousPageVersionId: previousSnapshot?.pageVersionId
  };
}

async function completePreparedLpTaskPrompt(input: {
  repositories: WorkbenchRepositories;
  service: DemoWorkbenchService;
  currentUser: WorkbenchUserIdentity;
  task: TaskRecord;
  projectId: string;
  prompt: string;
  previousPageVersionId?: string;
}): Promise<SubmitTaskResult> {
  try {
    const chain = await runLpAgentChainForTask({
      repositories: input.repositories,
      service: input.service,
      currentUser: input.currentUser,
      taskId: input.task.id,
      projectId: input.projectId,
      prompt: input.prompt,
      previousPageVersionId: input.previousPageVersionId
    });
    await saveTaskSnapshot({
      repositories: input.repositories,
      taskId: input.task.id,
      projectId: input.projectId,
      briefId: chain.briefId,
      pageVersionId: chain.pageVersionId
    });
    const pageVersion = await input.repositories.pageVersions.getById(chain.pageVersionId);
    await appendTaskMessage({
      repositories: input.repositories,
      taskId: input.task.id,
      role: "assistant",
      content: pageVersion?.reviewStatus === "failed"
        ? "LP artifacts need review attention before deployment."
        : "LP artifacts are ready for review."
    });
    return {
      ok: true,
      taskId: input.task.id,
      taskType: "lp_generation",
      projectId: input.projectId
    };
  } catch {
    await appendTaskMessage({
      repositories: input.repositories,
      taskId: input.task.id,
      role: "assistant",
      content: "LP generation failed. Open recovery details for the failed run."
    });
    return {
      ok: false,
      error: "generation_failed",
      taskId: input.task.id,
      taskType: "lp_generation",
      projectId: input.projectId
    };
  }
}
```

Make `runLpTaskPrompt()` call the two helpers and await completion.

- [ ] **Step 4: Add `startLiveTaskPrompt()` implementation**

Inside the store return object, add:

```ts
    async startLiveTaskPrompt(input) {
      const prompt = validatePromptInput(input.prompt);
      if (!prompt.ok) {
        return { ok: false, error: prompt.error };
      }

      const requestedProjectId = input.projectId ?? undefined;
      if (requestedProjectId && !(await repositories.projects.getById(requestedProjectId))) {
        return { ok: false, error: "project_not_found" };
      }

      const taskType = classifyTaskPrompt(prompt.value);
      if (taskType !== "lp_generation") {
        return { ok: false, error: "generation_failed" };
      }

      const prepared = await prepareLpTaskPrompt({
        repositories,
        service,
        requestedTaskId: input.taskId ?? undefined,
        requestedProjectId,
        prompt: prompt.value,
        implicitProjectName: input.implicitProjectName
      });
      const completion = completePreparedLpTaskPrompt({
        repositories,
        service,
        currentUser,
        task: prepared.task,
        projectId: prepared.projectId,
        prompt: prompt.value,
        previousPageVersionId: prepared.previousPageVersionId
      });
      completion.catch(() => undefined);

      return {
        ok: true,
        taskId: prepared.task.id,
        taskType: "lp_generation",
        projectId: prepared.projectId,
        completion
      };
    },
```

- [ ] **Step 5: Run the targeted tests and verify they pass**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts --testNamePattern "live task prompt start"
```

Expected: PASS.

- [ ] **Step 6: Run Stage 28 LP store regression**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts --testNamePattern "LP"
```

Expected: existing LP tests remain PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts
git commit -m "start lp tasks for live polling"
```

---

### Task 3: Live Task State Route

**Files:**
- Create: `apps/web/src/app/api/tasks/[taskId]/state/route.ts`
- Create: `apps/web/src/app/api/tasks/[taskId]/state/route.test.ts`

**Purpose:** Let the client poll fresh repository facts through a no-store JSON route.

- [ ] **Step 1: Write failing route tests**

Create `apps/web/src/app/api/tasks/[taskId]/state/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLiveTaskState: vi.fn(),
  getCurrentProjectId: vi.fn()
}));

vi.mock("../../../../../lib/workbench-store", () => ({
  getWebWorkbenchStore: vi.fn(async () => ({
    getLiveTaskState: mocks.getLiveTaskState
  }))
}));

vi.mock("../../../../../lib/workbench-session", () => ({
  getCurrentProjectId: mocks.getCurrentProjectId
}));

describe("GET /api/tasks/[taskId]/state", () => {
  beforeEach(() => {
    mocks.getLiveTaskState.mockReset();
    mocks.getCurrentProjectId.mockReset();
    mocks.getCurrentProjectId.mockResolvedValue("project_1");
  });

  it("returns no-store safe live task state", async () => {
    mocks.getLiveTaskState.mockResolvedValue({
      ok: true,
      value: {
        taskId: "task_1",
        projectId: "project_1",
        taskType: "lp_generation",
        taskStatus: "complete",
        stateVersion: "v1",
        isTerminal: false,
        nextPollMs: 1200,
        updatedAt: "2026-05-21T00:00:00.000Z",
        messages: [],
        runs: [],
        runEvents: [],
        recovery: { runs: [] },
        workerQueue: {
          projectId: "project_1",
          counts: {
            queued: 0,
            running: 1,
            stale: 0,
            completed: 0,
            failed: 0,
            rejected: 0,
            cancelled: 0
          },
          heartbeat: { status: "active" },
          logs: []
        },
        interrupt: { state: "interruptible", targets: [] }
      }
    });
    const { GET } = await import("./route");

    const response = await GET(
      new Request("http://localhost/api/tasks/task_1/state?artifactPath=styles.css"),
      { params: Promise.resolve({ taskId: "task_1" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      ok: true,
      value: {
        taskId: "task_1",
        nextPollMs: 1200
      }
    });
    expect(mocks.getLiveTaskState).toHaveBeenCalledWith({
      taskId: "task_1",
      projectId: "project_1",
      artifactPath: "styles.css"
    });
  });

  it("returns stable safe error codes", async () => {
    mocks.getLiveTaskState.mockResolvedValue({ ok: false, error: "task_not_found" });
    const { GET } = await import("./route");

    const response = await GET(
      new Request("http://localhost/api/tasks/missing/state"),
      { params: Promise.resolve({ taskId: "missing" }) }
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ok: false,
      error: "task_not_found"
    });
  });
});
```

- [ ] **Step 2: Run route tests and verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/app/api/tasks/[taskId]/state/route.test.ts
```

Expected: FAIL because the route file does not exist.

- [ ] **Step 3: Implement route**

Create `apps/web/src/app/api/tasks/[taskId]/state/route.ts`:

```ts
import { getWebWorkbenchStore } from "../../../../../lib/workbench-store";
import { getCurrentProjectId } from "../../../../../lib/workbench-session";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ taskId: string }>;
};

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store"
    }
  });
}

function toStatus(error: "task_not_found" | "project_not_found"): number {
  switch (error) {
    case "task_not_found":
      return 404;
    case "project_not_found":
      return 403;
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const [{ taskId }, sessionProjectId] = await Promise.all([
    context.params,
    getCurrentProjectId()
  ]);
  const url = new URL(request.url);
  const artifactPath = url.searchParams.get("artifactPath");
  const store = await getWebWorkbenchStore();
  const result = await store.getLiveTaskState({
    taskId,
    projectId: sessionProjectId ?? null,
    artifactPath
  });

  if (!result.ok) {
    return jsonResponse(result, toStatus(result.error));
  }

  return jsonResponse(result);
}
```

- [ ] **Step 4: Run route tests and verify they pass**

Run:

```bash
pnpm exec vitest run apps/web/src/app/api/tasks/[taskId]/state/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/tasks/[taskId]/state/route.ts apps/web/src/app/api/tasks/[taskId]/state/route.test.ts
git commit -m "add live task state route"
```

---

### Task 4: Live Task Submit Route

**Files:**
- Create: `apps/web/src/app/api/tasks/submit/route.ts`
- Create: `apps/web/src/app/api/tasks/submit/route.test.ts`

**Purpose:** Replace hidden native fallback navigation for LP prompts with a JSON route that creates the task, sets cookies, and starts LP chain execution.

- [ ] **Step 1: Write failing submit route tests**

Create `apps/web/src/app/api/tasks/submit/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startLiveTaskPrompt: vi.fn(),
  getCurrentProjectId: vi.fn(),
  getCurrentTaskId: vi.fn()
}));

vi.mock("../../../../lib/workbench-store", () => ({
  getWebWorkbenchStore: vi.fn(async () => ({
    startLiveTaskPrompt: mocks.startLiveTaskPrompt
  }))
}));

vi.mock("../../../../lib/workbench-session", () => ({
  CURRENT_PROJECT_COOKIE: "lp-agent-current-project",
  CURRENT_TASK_COOKIE: "lp-agent-current-task",
  getCurrentProjectId: mocks.getCurrentProjectId,
  getCurrentTaskId: mocks.getCurrentTaskId
}));

function getSetCookieHeaderText(response: Response): string {
  const getSetCookie = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.bind(response.headers);
  return getSetCookie ? getSetCookie().join("\n") : response.headers.get("set-cookie") ?? "";
}

describe("POST /api/tasks/submit", () => {
  beforeEach(() => {
    mocks.startLiveTaskPrompt.mockReset();
    mocks.getCurrentProjectId.mockReset();
    mocks.getCurrentTaskId.mockReset();
    mocks.getCurrentProjectId.mockResolvedValue("project_1");
    mocks.getCurrentTaskId.mockResolvedValue("task_old");
  });

  it("starts a live LP task and sets current task cookies", async () => {
    mocks.startLiveTaskPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_lp",
      taskType: "lp_generation",
      projectId: "project_1",
      completion: Promise.resolve({
        ok: true,
        taskId: "task_lp",
        taskType: "lp_generation",
        projectId: "project_1"
      })
    });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/tasks/submit", {
        method: "POST",
        body: JSON.stringify({
          prompt: "Create a live LP",
          implicitProjectName: "Live Project"
        })
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      taskId: "task_lp",
      taskType: "lp_generation",
      projectId: "project_1"
    });
    expect(getSetCookieHeaderText(response)).toContain("lp-agent-current-task=task_lp");
    expect(getSetCookieHeaderText(response)).toContain("lp-agent-current-project=project_1");
    expect(mocks.startLiveTaskPrompt).toHaveBeenCalledWith({
      taskId: "task_old",
      projectId: "project_1",
      prompt: "Create a live LP",
      implicitProjectName: "Live Project"
    });
  });

  it("returns a safe error for invalid JSON", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/tasks/submit", {
        method: "POST",
        body: "{"
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: "generation_failed"
    });
  });
});
```

- [ ] **Step 2: Run submit route tests and verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/app/api/tasks/submit/route.test.ts
```

Expected: FAIL because the route file does not exist.

- [ ] **Step 3: Implement submit route**

Create `apps/web/src/app/api/tasks/submit/route.ts`:

```ts
import {
  getWebWorkbenchStore,
  type ProjectFlowErrorCode
} from "../../../../lib/workbench-store";
import {
  CURRENT_PROJECT_COOKIE,
  CURRENT_TASK_COOKIE,
  getCurrentProjectId,
  getCurrentTaskId
} from "../../../../lib/workbench-session";

export const dynamic = "force-dynamic";

type LiveTaskSubmitRequest = {
  prompt?: unknown;
  implicitProjectName?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readRequest(request: Request): Promise<LiveTaskSubmitRequest | undefined> {
  try {
    const payload: unknown = await request.json();
    return isRecord(payload) ? payload : {};
  } catch {
    return undefined;
  }
}

function createCookie(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
}

function jsonResponse(body: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({
    "cache-control": "no-store"
  });
  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }
  return Response.json(body, { status, headers });
}

function toStatus(error: ProjectFlowErrorCode): number {
  switch (error) {
    case "prompt_required":
      return 400;
    case "project_not_found":
      return 404;
    default:
      return 500;
  }
}

export async function POST(request: Request): Promise<Response> {
  const payload = await readRequest(request);
  if (!payload) {
    return jsonResponse({ ok: false, error: "generation_failed" }, 400);
  }

  const [projectId, taskId] = await Promise.all([
    getCurrentProjectId(),
    getCurrentTaskId()
  ]);
  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  const implicitProjectName =
    typeof payload.implicitProjectName === "string"
      ? payload.implicitProjectName
      : "Untitled LP Project";
  const store = await getWebWorkbenchStore();
  const started = await store.startLiveTaskPrompt({
    taskId: taskId ?? null,
    projectId: projectId ?? null,
    prompt,
    implicitProjectName
  });

  if (!started.ok) {
    return jsonResponse(started, toStatus(started.error));
  }

  const cookies = [createCookie(CURRENT_TASK_COOKIE, started.taskId)];
  if (started.projectId) {
    cookies.push(createCookie(CURRENT_PROJECT_COOKIE, started.projectId));
  }

  return jsonResponse(
    {
      ok: true,
      taskId: started.taskId,
      taskType: started.taskType,
      ...(started.projectId ? { projectId: started.projectId } : {})
    },
    200,
    cookies
  );
}
```

- [ ] **Step 4: Run submit route tests and verify they pass**

Run:

```bash
pnpm exec vitest run apps/web/src/app/api/tasks/submit/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/tasks/submit/route.ts apps/web/src/app/api/tasks/submit/route.test.ts
git commit -m "add live task submit route"
```

---

### Task 5: Client Polling Helpers

**Files:**
- Create: `apps/web/src/app/live-task-state.ts`
- Create: `apps/web/src/app/live-task-state.test.ts`

**Purpose:** Keep polling decisions testable without React DOM.

- [ ] **Step 1: Write failing helper tests**

Create `apps/web/src/app/live-task-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createInitialLiveTaskState,
  reduceLiveTaskState,
  shouldPollLiveTask,
  shouldRefreshForLiveArtifact
} from "./live-task-state";

const payload = {
  taskId: "task_1",
  projectId: "project_1",
  taskType: "lp_generation" as const,
  taskStatus: "complete" as const,
  stateVersion: "v1",
  isTerminal: false,
  nextPollMs: 1200,
  updatedAt: "2026-05-21T00:00:00.000Z",
  messages: [],
  runs: [],
  runEvents: [],
  recovery: { runs: [] },
  workerQueue: {
    projectId: "project_1",
    counts: {
      queued: 0,
      running: 1,
      stale: 0,
      completed: 0,
      failed: 0,
      rejected: 0,
      cancelled: 0
    },
    heartbeat: { status: "active" as const },
    logs: []
  },
  interrupt: { state: "interruptible" as const, targets: [] }
};

describe("live task state helpers", () => {
  it("stores the latest payload and keeps polling while non-terminal", () => {
    const state = reduceLiveTaskState(createInitialLiveTaskState(), {
      type: "payload",
      payload
    });

    expect(state.status).toBe("ready");
    expect(state.payload?.stateVersion).toBe("v1");
    expect(shouldPollLiveTask(state)).toBe(true);
  });

  it("stops polling after terminal payload without active refresh reason", () => {
    const state = reduceLiveTaskState(createInitialLiveTaskState(), {
      type: "payload",
      payload: {
        ...payload,
        isTerminal: true,
        nextPollMs: 0
      }
    });

    expect(shouldPollLiveTask(state)).toBe(false);
  });

  it("requests router refresh when artifact version key changes", () => {
    expect(
      shouldRefreshForLiveArtifact({
        previousPreviewVersionKey: "page_1|workspace_1|index.html:aaa",
        nextPreviewVersionKey: "page_2|workspace_2|index.html:bbb"
      })
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run helper tests and verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/app/live-task-state.test.ts
```

Expected: FAIL because `live-task-state.ts` does not exist.

- [ ] **Step 3: Implement helper module**

Create `apps/web/src/app/live-task-state.ts`:

```ts
import type { LiveTaskStatePayload } from "../lib/workbench-store";

export type LiveTaskPanelStatus = "idle" | "loading" | "ready" | "error";

export interface LiveTaskPanelState {
  status: LiveTaskPanelStatus;
  payload?: LiveTaskStatePayload;
  errorMessage?: string;
  lastPreviewVersionKey?: string;
}

export type LiveTaskPanelAction =
  | { type: "loading" }
  | { type: "payload"; payload: LiveTaskStatePayload }
  | { type: "error"; message: string };

export function createInitialLiveTaskState(): LiveTaskPanelState {
  return {
    status: "idle"
  };
}

export function reduceLiveTaskState(
  state: LiveTaskPanelState,
  action: LiveTaskPanelAction
): LiveTaskPanelState {
  switch (action.type) {
    case "loading":
      return {
        ...state,
        status: state.payload ? "ready" : "loading",
        errorMessage: undefined
      };
    case "payload":
      return {
        status: "ready",
        payload: action.payload,
        lastPreviewVersionKey:
          action.payload.artifactProgress?.previewVersionKey ??
          state.lastPreviewVersionKey,
        errorMessage: undefined
      };
    case "error":
      return {
        ...state,
        status: "error",
        errorMessage: action.message
      };
  }
}

export function shouldPollLiveTask(state: LiveTaskPanelState): boolean {
  if (!state.payload) {
    return true;
  }
  return !state.payload.isTerminal && state.payload.nextPollMs > 0;
}

export function getNextPollMs(state: LiveTaskPanelState, fallbackMs = 1200): number {
  if (!state.payload) {
    return fallbackMs;
  }
  return state.payload.nextPollMs > 0 ? state.payload.nextPollMs : fallbackMs;
}

export function shouldRefreshForLiveArtifact({
  previousPreviewVersionKey,
  nextPreviewVersionKey
}: {
  previousPreviewVersionKey?: string;
  nextPreviewVersionKey?: string;
}): boolean {
  return (
    previousPreviewVersionKey !== undefined &&
    nextPreviewVersionKey !== undefined &&
    previousPreviewVersionKey !== nextPreviewVersionKey
  );
}
```

- [ ] **Step 4: Run helper tests and verify they pass**

Run:

```bash
pnpm exec vitest run apps/web/src/app/live-task-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/live-task-state.ts apps/web/src/app/live-task-state.test.ts
git commit -m "add live task polling state helpers"
```

---

### Task 6: Live Task Panel Component

**Files:**
- Create: `apps/web/src/app/live-task-panel.tsx`
- Create: `apps/web/src/app/live-task-panel.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`
- Modify: `apps/web/src/app/globals.css`

**Purpose:** Render compact live task status and poll the state route.

- [ ] **Step 1: Add failing i18n tests**

In `apps/web/src/lib/i18n.test.ts`, add:

```ts
it("exposes localized live task labels in both locales", () => {
  const en = getWorkbenchCopy("en");
  const zh = getWorkbenchCopy("zh-CN");

  expect(en.chat.liveTaskTitle).toBe("Live task progress");
  expect(en.chat.liveTaskRefreshError).toBe("Task progress could not be refreshed.");
  expect(zh.chat.liveTaskTitle).toBe("实时任务进度");
  expect(zh.chat.liveTaskRefreshError).toBe("任务进度刷新失败。");
});
```

- [ ] **Step 2: Update i18n copy**

In `apps/web/src/lib/i18n.ts`, add these fields to `WorkbenchCopy["chat"]`:

```ts
    liveTaskTitle: string;
    liveTaskIdle: string;
    liveTaskRunning: string;
    liveTaskCompleted: string;
    liveTaskArtifactReady: string;
    liveTaskRefreshError: string;
```

Add English values:

```ts
      liveTaskTitle: "Live task progress",
      liveTaskIdle: "Waiting for task activity",
      liveTaskRunning: "Task is running",
      liveTaskCompleted: "Task facts are current",
      liveTaskArtifactReady: "Artifact workspace ready",
      liveTaskRefreshError: "Task progress could not be refreshed.",
```

Add Chinese values:

```ts
      liveTaskTitle: "实时任务进度",
      liveTaskIdle: "等待任务活动",
      liveTaskRunning: "任务正在运行",
      liveTaskCompleted: "任务事实已更新",
      liveTaskArtifactReady: "产物工作区已就绪",
      liveTaskRefreshError: "任务进度刷新失败。",
```

- [ ] **Step 3: Write failing component tests**

Create `apps/web/src/app/live-task-panel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LiveTaskStatusSummary } from "./live-task-panel";
import { getWorkbenchCopy } from "../lib/i18n";

function collectText(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === "boolean") {
    return [];
  }
  if (typeof node === "string" || typeof node === "number") {
    return [String(node)];
  }
  if (Array.isArray(node)) {
    return node.flatMap(collectText);
  }
  if (typeof node === "object" && "props" in node) {
    const element = node as { props?: { children?: unknown } };
    return collectText(element.props?.children);
  }
  return [];
}

describe("live task panel", () => {
  it("renders safe status summary without raw artifacts", () => {
    const rendered = LiveTaskStatusSummary({
      copy: getWorkbenchCopy("en").chat,
      payload: {
        taskId: "task_1",
        projectId: "project_1",
        taskType: "lp_generation",
        taskStatus: "complete",
        stateVersion: "v1",
        isTerminal: false,
        nextPollMs: 1200,
        updatedAt: "2026-05-21T00:00:00.000Z",
        messages: [],
        runs: [{ role: "builder", state: "running", runId: "run_builder_1", recoveryActions: [] }],
        runEvents: [],
        recovery: { runs: [] },
        workerQueue: {
          projectId: "project_1",
          counts: {
            queued: 0,
            running: 1,
            stale: 0,
            completed: 0,
            failed: 0,
            rejected: 0,
            cancelled: 0
          },
          heartbeat: { status: "active" },
          logs: []
        },
        interrupt: { state: "interruptible", targets: [] },
        artifactProgress: {
          pageVersionId: "page_1",
          artifactWorkspaceId: "workspace_1",
          fileCount: 3,
          changedFileCount: 3,
          previewVersionKey: "page_1|workspace_1"
        }
      }
    });

    const text = collectText(rendered).join(" ");
    expect(text).toContain("Live task progress");
    expect(text).toContain("Task is running");
    expect(text).toContain("Artifact workspace ready");
    expect(text).not.toContain("<!doctype html");
  });
});
```

- [ ] **Step 4: Implement component**

Create `apps/web/src/app/live-task-panel.tsx`:

```tsx
"use client";

import { useEffect, useReducer, useRef } from "react";
import { useRouter } from "next/navigation";
import type { LiveTaskStatePayload } from "../lib/workbench-store";
import type { WorkbenchCopy } from "../lib/i18n";
import {
  createInitialLiveTaskState,
  getNextPollMs,
  reduceLiveTaskState,
  shouldPollLiveTask,
  shouldRefreshForLiveArtifact
} from "./live-task-state";

export interface LiveTaskPanelProps {
  taskId?: string;
  initialProjectId?: string;
  initialPreviewVersionKey?: string;
  copy: WorkbenchCopy["chat"];
}

type LiveTaskStateResponse =
  | { ok: true; value: LiveTaskStatePayload }
  | { ok: false; error: string };

export function LiveTaskStatusSummary({
  payload,
  copy
}: {
  payload?: LiveTaskStatePayload;
  copy: WorkbenchCopy["chat"];
}) {
  const activeRun = payload?.runs.find((run) =>
    ["queued", "running", "waiting_for_approval", "cancelling"].includes(run.state)
  );
  const title = payload?.isTerminal
    ? copy.liveTaskCompleted
    : activeRun
      ? copy.liveTaskRunning
      : copy.liveTaskIdle;
  const artifactReady = payload?.artifactProgress?.artifactWorkspaceId
    ? copy.liveTaskArtifactReady
    : undefined;

  return (
    <section className="liveTaskPanel" aria-label={copy.liveTaskTitle}>
      <div className="liveTaskHeader">
        <strong>{copy.liveTaskTitle}</strong>
        <span>{title}</span>
      </div>
      {activeRun ? (
        <p>{`${activeRun.role} · ${activeRun.state}`}</p>
      ) : null}
      {artifactReady ? <p>{artifactReady}</p> : null}
      {payload?.artifactProgress ? (
        <small>
          {`${payload.artifactProgress.fileCount} files · ${payload.artifactProgress.changedFileCount} changed`}
        </small>
      ) : null}
    </section>
  );
}

export function LiveTaskPanel({
  taskId,
  initialPreviewVersionKey,
  copy
}: LiveTaskPanelProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(
    reduceLiveTaskState,
    createInitialLiveTaskState()
  );
  const previewVersionKeyRef = useRef(initialPreviewVersionKey);

  useEffect(() => {
    if (!taskId) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      dispatch({ type: "loading" });
      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/state`, {
          cache: "no-store"
        });
        const json = (await response.json()) as LiveTaskStateResponse;
        if (cancelled) {
          return;
        }
        if (!response.ok || !json.ok) {
          dispatch({ type: "error", message: copy.liveTaskRefreshError });
          timer = setTimeout(poll, 3000);
          return;
        }

        const nextPreviewVersionKey = json.value.artifactProgress?.previewVersionKey;
        if (
          shouldRefreshForLiveArtifact({
            previousPreviewVersionKey: previewVersionKeyRef.current,
            nextPreviewVersionKey
          })
        ) {
          router.refresh();
        }
        previewVersionKeyRef.current =
          nextPreviewVersionKey ?? previewVersionKeyRef.current;
        dispatch({ type: "payload", payload: json.value });

        if (shouldPollLiveTask({ status: "ready", payload: json.value })) {
          timer = setTimeout(poll, getNextPollMs({ status: "ready", payload: json.value }));
        }
      } catch {
        if (!cancelled) {
          dispatch({ type: "error", message: copy.liveTaskRefreshError });
          timer = setTimeout(poll, 3000);
        }
      }
    };

    timer = setTimeout(poll, 0);
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [copy.liveTaskRefreshError, router, taskId]);

  return (
    <>
      <LiveTaskStatusSummary payload={state.payload} copy={copy} />
      {state.status === "error" && state.errorMessage ? (
        <p className="liveTaskError" role="alert">{state.errorMessage}</p>
      ) : null}
    </>
  );
}
```

- [ ] **Step 5: Add styles**

Append to `apps/web/src/app/globals.css` near other timeline/recovery styles:

```css
.liveTaskPanel {
  display: grid;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-soft);
  padding: 12px;
}

.liveTaskHeader {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.liveTaskHeader strong {
  font-size: 0.88rem;
}

.liveTaskHeader span,
.liveTaskPanel small {
  color: var(--muted);
  font-size: 0.75rem;
}

.liveTaskPanel p,
.liveTaskError {
  margin: 0;
  color: var(--muted);
  font-size: 0.82rem;
  line-height: 1.45;
}

.liveTaskError {
  color: var(--danger);
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm exec vitest run apps/web/src/app/live-task-state.test.ts apps/web/src/app/live-task-panel.test.ts apps/web/src/lib/i18n.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/live-task-state.ts apps/web/src/app/live-task-state.test.ts apps/web/src/app/live-task-panel.tsx apps/web/src/app/live-task-panel.test.ts apps/web/src/lib/i18n.ts apps/web/src/lib/i18n.test.ts apps/web/src/app/globals.css
git commit -m "add live task panel"
```

---

### Task 7: Wire Streaming Fallback to Live Task Submit

**Files:**
- Modify: `apps/web/src/app/streaming-workbench.tsx`
- Modify: `apps/web/src/app/streaming-workbench.test.ts`

**Purpose:** When ordinary chat stream reports `fallback.required`, start the LP task through the live submit route instead of submitting a blocking server action form.

- [ ] **Step 1: Write failing helper tests**

Add to `apps/web/src/app/streaming-workbench.test.ts`:

```ts
import {
  createLiveTaskSubmitRequestBody,
  shouldStartLiveTaskAfterFallback
} from "./streaming-workbench";

describe("streaming workbench live task fallback", () => {
  it("starts live task submit after unsupported task fallback", () => {
    expect(
      shouldStartLiveTaskAfterFallback({
        fallbackReason: "unsupported_task_type",
        taskType: "lp_generation"
      })
    ).toBe(true);
  });

  it("keeps non-LP fallback outside live submit", () => {
    expect(
      shouldStartLiveTaskAfterFallback({
        fallbackReason: "unsupported_task_type",
        taskType: "project_setup"
      })
    ).toBe(false);
  });

  it("creates a bounded live task submit body", () => {
    expect(
      createLiveTaskSubmitRequestBody({
        prompt: "Build an LP",
        implicitProjectName: "Untitled LP Project"
      })
    ).toEqual({
      prompt: "Build an LP",
      implicitProjectName: "Untitled LP Project"
    });
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/app/streaming-workbench.test.ts --testNamePattern "live task fallback"
```

Expected: FAIL because helper exports do not exist.

- [ ] **Step 3: Add helpers**

In `apps/web/src/app/streaming-workbench.tsx`, add:

```ts
export interface LiveTaskSubmitRequestBody {
  prompt: string;
  implicitProjectName: string;
}

export function createLiveTaskSubmitRequestBody({
  prompt,
  implicitProjectName
}: LiveTaskSubmitRequestBody): LiveTaskSubmitRequestBody {
  return {
    prompt,
    implicitProjectName
  };
}

export function shouldStartLiveTaskAfterFallback({
  fallbackReason,
  taskType
}: {
  fallbackReason: string;
  taskType?: string;
}): boolean {
  return fallbackReason === "unsupported_task_type" && taskType === "lp_generation";
}
```

- [ ] **Step 4: Replace hidden fallback submit with live task route**

In `dispatchEvent`, change the `fallback.required` branch so LP fallback calls a new async helper instead of setting `fallbackSubmitPendingRef`:

```ts
  const startLiveTaskFromFallback = async () => {
    try {
      const response = await fetch("/api/tasks/submit", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(
          createLiveTaskSubmitRequestBody({
            prompt: submittedPromptRef.current,
            implicitProjectName
          })
        )
      });
      if (!response.ok) {
        dispatchError();
        return;
      }
      router.refresh();
    } catch {
      dispatchError();
    }
  };
```

Then use it:

```ts
    if (event.type === "fallback.required" && !fallbackSubmittedRef.current) {
      fallbackSubmittedRef.current = true;
      if (
        shouldStartLiveTaskAfterFallback({
          fallbackReason: event.reason,
          taskType: event.taskType
        })
      ) {
        void startLiveTaskFromFallback();
        return;
      }
      skipStreamingOnceRef.current = true;
      fallbackSubmitPendingRef.current = true;
      setFallbackPrompt(submittedPromptRef.current);
    }
```

- [ ] **Step 5: Run streaming tests**

Run:

```bash
pnpm exec vitest run apps/web/src/app/streaming-workbench.test.ts apps/web/src/app/streaming-workbench-state.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/streaming-workbench.tsx apps/web/src/app/streaming-workbench.test.ts
git commit -m "route lp fallback through live task submit"
```

---

### Task 8: Render Live Panel in Workbench Page

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`

**Purpose:** Show live task progress inside the existing conversation stack and refresh preview/export when polling observes a new artifact version.

- [ ] **Step 1: Write failing page test**

In `apps/web/src/app/page.test.ts`, add a mock for the live panel beside existing component mocks if needed:

```ts
vi.mock("./live-task-panel", () => ({
  LiveTaskPanel: (props: unknown) => ({
    type: "LiveTaskPanel",
    props
  })
}));
```

Add a collector helper if no generic collector exists:

```ts
function collectComponentProps(node: unknown, type: string): unknown[] {
  if (node === null || node === undefined || typeof node === "boolean") {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((child) => collectComponentProps(child, type));
  }
  if (typeof node === "object" && "type" in node && "props" in node) {
    const element = node as { type?: unknown; props?: { children?: unknown } };
    return [
      element.type === type ? element.props : undefined,
      ...collectComponentProps(element.props?.children, type)
    ].filter((value): value is unknown => value !== undefined);
  }
  return [];
}
```

Add the test:

```ts
it("renders the live task panel for task-ready LP state", async () => {
  pageMocks.pageState = createCompletedLpPageState();
  const page = await HomePage({ searchParams: Promise.resolve({}) });

  const props = collectComponentProps(page, "LiveTaskPanel");
  expect(props).toEqual([
    expect.objectContaining({
      taskId: "task_1",
      initialProjectId: "project_1",
      initialPreviewVersionKey: expect.any(String)
    })
  ]);
});
```

- [ ] **Step 2: Run page test and verify it fails**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts --testNamePattern "live task panel"
```

Expected: FAIL because `LiveTaskPanel` is not rendered.

- [ ] **Step 3: Wire page component**

In `apps/web/src/app/page.tsx`, import:

```ts
import { LiveTaskPanel } from "./live-task-panel";
```

Compute the initial key near `completedSnapshot`:

```ts
  const initialPreviewVersionKey =
    pageState.kind === "task_ready"
      ? pageState.artifactDiff
        ? [
            pageState.artifactDiff.pageVersionId,
            pageState.artifactDiff.artifactWorkspaceId ?? "no-workspace",
            ...pageState.artifactDiff.files.map((file) =>
              `${file.path}:${file.shortSha256 ?? "no-hash"}`
            )
          ].join("|")
        : undefined
      : undefined;
```

Render inside the conversation stack before recovery:

```tsx
                            {turnIndex === chat.turns.length - 1 &&
                            pageState.kind === "task_ready" ? (
                              <LiveTaskPanel
                                taskId={pageState.task.id}
                                initialProjectId={pageState.task.projectId}
                                initialPreviewVersionKey={initialPreviewVersionKey}
                                copy={copy.chat}
                              />
                            ) : null}
```

- [ ] **Step 4: Run page tests**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/page.tsx apps/web/src/app/page.test.ts
git commit -m "render live task progress panel"
```

---

### Task 9: Smoke Coverage and Documentation

**Files:**
- Modify: `apps/web/src/lib/web-v1-smoke.test.ts`
- Modify: `docs/superpowers/README.md`
- Modify: `docs/project-roadmap.md`
- Modify: `docs/agent-development-learning.md`

**Purpose:** Keep readiness checks and stage docs aligned with the new live task state boundary.

- [ ] **Step 1: Add smoke assertions**

In `apps/web/src/lib/web-v1-smoke.test.ts`, after the existing LP page state assertions, add:

```ts
    const liveState = await store.getLiveTaskState({
      projectId: result.projectId,
      taskId: result.taskId
    });

    expect(liveState.ok).toBe(true);
    if (!liveState.ok) {
      throw new Error("expected live smoke state");
    }
    expect(liveState.value.artifactProgress?.fileCount).toBe(3);
    expect(liveState.value.runs.map((run) => run.role)).toEqual([
      "planner",
      "builder",
      "reviewer",
      "deployer"
    ]);
    expect(JSON.stringify(liveState.value)).not.toContain("<!doctype html");
```

- [ ] **Step 2: Run smoke test**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/web-v1-smoke.test.ts
```

Expected: PASS.

- [ ] **Step 3: Update Superpowers index**

In `docs/superpowers/README.md`, add after Stage 29 spec:

```md
87. `plans/2026-05-21-live-run-timeline-artifact-progress.md`
   - Stage 29 Live Run Timeline and Artifact Progress v0 implementation plan（当前执行）。
   - 在 Stage 29 design 后阅读，用于按 TDD 实现 safe task state refresh、live LP task submit route、client polling panel、artifact progress auto-refresh、smoke coverage 和文档收尾；本计划仍排除 SSE、raw stdout/stderr streaming、MCP streaming、实时多人协作和生产 observability stack。
```

- [ ] **Step 4: Update roadmap**

In `docs/project-roadmap.md`, update the Stage 29 status line to:

```md
**状态：** 当前实施中；设计和实施计划已创建。
```

Add the plan link after the design link:

```md
**实施计划：** `docs/superpowers/plans/2026-05-21-live-run-timeline-artifact-progress.md`。
```

- [ ] **Step 5: Update Agent learning notes**

In `docs/agent-development-learning.md`, add one implementation note under section `2.14`:

```md
Stage 29 implementation plan 采用两段式体验：普通聊天仍先尝试 `/api/chat/stream`；当服务端判断 prompt 是 LP 任务并返回 `fallback.required` 时，客户端调用 live task submit route 创建 task 并启动 in-process LP chain，然后通过 task state polling 观察 repository facts。这个边界保留了 Stage 26 的 text streaming，同时让 LP workflow 不再依赖阻塞式表单提交才能回到页面。
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/web-v1-smoke.test.ts docs/superpowers/README.md docs/project-roadmap.md docs/agent-development-learning.md
git commit -m "document live task progress implementation"
```

---

### Task 10: Final Verification and Stage Closeout

**Files:**
- Verify all modified files

**Purpose:** Prove the stage is ready before merging or asking for PR/cleanup choice.

- [ ] **Step 1: Run focused Stage 29 regression**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/api/tasks/[taskId]/state/route.test.ts apps/web/src/app/api/tasks/submit/route.test.ts apps/web/src/app/live-task-state.test.ts apps/web/src/app/live-task-panel.test.ts apps/web/src/app/streaming-workbench.test.ts apps/web/src/app/streaming-workbench-state.test.ts apps/web/src/app/page.test.ts apps/web/src/lib/i18n.test.ts apps/web/src/lib/web-v1-smoke.test.ts
```

Expected: all listed test files PASS.

- [ ] **Step 2: Run broader affected regression**

Run:

```bash
pnpm exec vitest run apps/web/src/app/api/chat/stream/route.test.ts apps/web/src/app/actions.test.ts packages/api/src/run-lifecycle.test.ts packages/api/src/run-recovery.test.ts packages/api/src/services.test.ts
```

Expected: all listed test files PASS.

- [ ] **Step 3: Run full tests**

Run:

```bash
pnpm test
```

Expected: full Vitest suite PASS with only existing skipped provider integration tests.

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: all workspace typechecks PASS.

- [ ] **Step 5: Check docs and diff hygiene**

Run:

```bash
git diff --check
git status --short --branch
```

Expected: `git diff --check` prints no output. `git status` shows only intentional committed changes or a clean working tree.

- [ ] **Step 6: Commit any final doc/test adjustments**

If Task 10 required small fixes, commit them:

```bash
git add apps/web/src docs/project-roadmap.md docs/superpowers/README.md docs/agent-development-learning.md
git commit -m "finish live task progress stage"
```

Expected: commit succeeds, or there are no remaining changes to commit.

---

## Self-Review

- Spec coverage:
  - Task state refresh contract: Tasks 1 and 3.
  - Client polling shell: Tasks 5 and 6.
  - LP prompt no-refresh start: Tasks 2, 4, and 7.
  - Artifact preview/export refresh: Tasks 1, 6, and 8.
  - Ordinary chat boundary: Task 7 plus existing chat route regression in Task 10.
  - Safety and raw data redaction: Tasks 1, 3, 6, and 9.
  - Smoke / acceptance coverage: Task 9 and Task 10.
- Scope check:
  - This plan does not introduce SSE, provider token streaming, raw stdout/stderr streaming, MCP streaming, production observability, auth/RBAC, object storage, real deployment, or a general DAG scheduler.
- Type consistency:
  - `LiveTaskStatePayload`, `LiveTaskStateResult`, `LiveTaskPromptStartResult`, `LiveTaskArtifactProgress`, and `LiveTaskStateErrorCode` are defined in Task 1 or Task 2 before later tasks use them.
  - Route tests and component tests import from the files created in earlier tasks.
