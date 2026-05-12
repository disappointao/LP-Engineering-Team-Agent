# Conversation-First Workbench Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the project-first Web entry with a Manus-style conversation-first workbench where users can start ordinary tasks or LP generation from the main composer without first creating a project.

**Architecture:** Extend the current process-local Web store from project-only state to task/thread state while keeping the existing LP generation pipeline intact. The composer submits a task prompt, deterministic routing classifies it as general chat, LP generation, or project setup, and LP tasks can create an implicit local project when no project is active. The page renders an enabled empty-state composer, general conversation threads, and existing LP artifact completion threads from one shared task model.

**Tech Stack:** Next.js 15 server components/actions, TypeScript, React server-rendered JSX, Vitest, existing in-memory `@lp-agent/api` workbench service, CSS in `apps/web/src/app/globals.css`.

---

## File Structure

- Modify `apps/web/src/lib/workbench-store.ts`
  - Add task records, chat message records, deterministic task routing, implicit LP project creation, and task-aware page state.

- Modify `apps/web/src/lib/workbench-store.test.ts`
  - Cover routing, general task submission without a project, LP submission without a project, implicit project creation, and project/task list ordering.

- Modify `apps/web/src/lib/workbench-session.ts`
  - Add a current task cookie beside the current project cookie.

- Modify `apps/web/src/app/actions.ts`
  - Change prompt submission so it can run without a current project and set the current task cookie after task creation.

- Modify `apps/web/src/app/actions.test.ts`
  - Cover no-project general submission, no-project LP submission, current task cookie writes, and explicit project creation behavior.

- Modify `apps/web/src/lib/chat-workbench.ts`
  - Add a general-task conversation view model while preserving the LP thread view model.

- Modify `apps/web/src/lib/chat-workbench.test.ts`
  - Cover general thread rendering and preserve LP planner/builder/reviewer behavior.

- Modify `apps/web/src/lib/i18n.ts`
  - Add empty-state, task, quick-chip, implicit-project, and general-assistant copy in English and Chinese.

- Modify `apps/web/src/lib/i18n.test.ts`
  - Cover localized conversation-first labels and ensure repository/deployment copy stays out of the default Web flow.

- Modify `apps/web/src/app/page.tsx`
  - Render the large empty-state composer when no task is active, keep sidebar project creation available, render tasks in the sidebar, and render general or LP task threads.

- Modify `apps/web/src/app/page.test.ts`
  - Cover enabled empty-state composer, no blocking project form, sidebar projects/tasks, general task thread, and existing LP completion.

- Modify `apps/web/src/app/globals.css`
  - Add Manus-style empty-state composer layout, quick chips, compact sidebar project creation, and general task message styles.

## Task 1: Add Task Routing and Store State

**Files:**
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`

- [ ] **Step 1: Write failing routing and task-state tests**

Add imports for the new helpers in `apps/web/src/lib/workbench-store.test.ts`:

```ts
import {
  classifyTaskPrompt,
  createWebWorkbenchStore,
  deriveImplicitProjectName,
  validateProjectInput,
  validatePromptInput
} from "./workbench-store";
```

Add these tests after the validation test:

```ts
it("routes first prompts into deterministic task types", () => {
  expect(classifyTaskPrompt("帮我写一个双 11 活动方案")).toBe("general_chat");
  expect(classifyTaskPrompt("生成一个电商春季促销 LP，输出单文件 HTML")).toBe("lp_generation");
  expect(classifyTaskPrompt("Create a landing page for a spring sale")).toBe("lp_generation");
  expect(classifyTaskPrompt("创建项目 春季活动")).toBe("project_setup");
  expect(classifyTaskPrompt("new project for spring campaign")).toBe("project_setup");
});

it("derives implicit LP project names from the prompt with a fallback", () => {
  expect(
    deriveImplicitProjectName(
      "生成一个电商春季促销 LP，输出单文件 HTML",
      "未命名 LP 项目"
    )
  ).toBe("生成一个电商春季促销 LP");
  expect(deriveImplicitProjectName("   ", "Untitled LP Project")).toBe("Untitled LP Project");
});

it("submits a general task without a project and exposes a task thread", async () => {
  const store = createWebWorkbenchStore();

  const result = await store.submitTaskPrompt({
    prompt: "帮我写一个双 11 活动方案",
    implicitProjectName: "未命名 LP 项目"
  });

  expect(result).toEqual({
    ok: true,
    taskId: "task_1",
    taskType: "general_chat",
    projectId: undefined
  });

  const pageState = await store.getPageState({
    taskId: "task_1"
  });

  expect(pageState.kind).toBe("task_ready");
  if (pageState.kind !== "task_ready") {
    throw new Error("Expected task-ready state.");
  }
  expect(pageState.task).toMatchObject({
    id: "task_1",
    type: "general_chat",
    projectId: undefined,
    title: "帮我写一个双 11 活动方案"
  });
  expect(pageState.projects).toEqual([]);
  expect(pageState.tasks.map((task) => task.id)).toEqual(["task_1"]);
  expect(pageState.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  expect(pageState.messages[0]?.content).toBe("帮我写一个双 11 活动方案");
});

it("submits an LP task without a project by creating an implicit local project", async () => {
  const store = createWebWorkbenchStore();

  const result = await store.submitTaskPrompt({
    prompt: "生成一个电商春季促销 LP，输出单文件 HTML",
    implicitProjectName: "未命名 LP 项目"
  });

  expect(result).toEqual({
    ok: true,
    taskId: "task_1",
    taskType: "lp_generation",
    projectId: "project_1"
  });

  const pageState = await store.getPageState({
    projectId: "project_1",
    taskId: "task_1"
  });

  expect(pageState.kind).toBe("task_ready");
  if (pageState.kind !== "task_ready") {
    throw new Error("Expected task-ready state.");
  }
  expect(pageState.task).toMatchObject({
    id: "task_1",
    type: "lp_generation",
    projectId: "project_1"
  });
  expect(pageState.projects[0]).toMatchObject({
    id: "project_1",
    name: "生成一个电商春季促销 LP"
  });
  expect(pageState.snapshot?.brief?.prompt).toBe("生成一个电商春季促销 LP，输出单文件 HTML");
  expect(pageState.snapshot?.currentPageVersion?.reviewStatus).toBe("passed");
  expect(pageState.snapshot?.deployment).toBeUndefined();
});
```

- [ ] **Step 2: Run the store tests and verify they fail**

Run:

```bash
pnpm test apps/web/src/lib/workbench-store.test.ts
```

Expected: fail with missing exports such as `classifyTaskPrompt`, `deriveImplicitProjectName`, and `submitTaskPrompt`.

- [ ] **Step 3: Add task types and helpers to the store**

In `apps/web/src/lib/workbench-store.ts`, add these exported types after `CreateProjectFormInput`:

```ts
export type TaskType = "general_chat" | "lp_generation" | "project_setup";
export type TaskStatus = "complete";
export type ChatMessageRole = "user" | "assistant";

export interface TaskRecord {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  projectId?: string;
  createdAt: string;
}

export interface ChatMessageRecord {
  id: string;
  taskId: string;
  role: ChatMessageRole;
  content: string;
  createdAt: string;
}
```

Replace `SubmitPromptResult` with this result type:

```ts
export type SubmitTaskResult =
  | {
      ok: true;
      taskId: string;
      taskType: TaskType;
      projectId?: string;
    }
  | { ok: false; error: ProjectFlowErrorCode };
```

Add these helper functions below `validatePromptInput`:

```ts
const lpKeywords = [
  "lp",
  "landing page",
  "落地页",
  "页面",
  "html",
  "官网",
  "活动页",
  "电商"
];

const projectKeywords = ["创建项目", "new project", "project"];

export function classifyTaskPrompt(prompt: string): TaskType {
  const normalized = prompt.trim().toLowerCase();
  if (normalized.length === 0) {
    return "general_chat";
  }

  if (projectKeywords.some((keyword) => normalized.includes(keyword))) {
    return "project_setup";
  }

  if (lpKeywords.some((keyword) => normalized.includes(keyword))) {
    return "lp_generation";
  }

  return "general_chat";
}

export function deriveTaskTitle(prompt: string): string {
  const title = prompt.trim().replace(/\s+/g, " ");
  return title.length > 48 ? `${title.slice(0, 48)}...` : title;
}

export function deriveImplicitProjectName(prompt: string, fallback: string): string {
  const title = deriveTaskTitle(prompt)
    .replace(/[,，。.!！?？].*$/, "")
    .trim();
  return title.length > 0 ? title : fallback;
}
```

- [ ] **Step 4: Replace page state and store interface with task-aware state**

In `apps/web/src/lib/workbench-store.ts`, replace `WorkbenchPageState` with:

```ts
export type WorkbenchPageState =
  | {
      kind: "empty";
      projects: ProjectRecord[];
      tasks: TaskRecord[];
    }
  | {
      kind: "task_ready";
      projects: ProjectRecord[];
      tasks: TaskRecord[];
      activeTaskId: string;
      task: TaskRecord;
      messages: ChatMessageRecord[];
      snapshot?: WorkbenchSnapshot;
    };
```

Replace `WebWorkbenchStore` with:

```ts
export interface WebWorkbenchStore {
  createProject(input: CreateProjectFormInput): Promise<ProjectRecord>;
  listProjects(): ProjectRecord[];
  listTasks(): TaskRecord[];
  getPageState(input?: {
    projectId?: string | null;
    taskId?: string | null;
  }): Promise<WorkbenchPageState>;
  submitTaskPrompt(input: {
    projectId?: string | null;
    prompt: string;
    implicitProjectName: string;
  }): Promise<SubmitTaskResult>;
}
```

- [ ] **Step 5: Implement task storage and prompt submission**

Inside `createWebWorkbenchStore()`, add task maps beside the existing project maps:

```ts
let taskSequence = 0;
let messageSequence = 0;
const tasks = new Map<string, TaskRecord>();
const taskOrder: string[] = [];
const messagesByTask = new Map<string, ChatMessageRecord[]>();
```

Add list helpers below `listProjects`:

```ts
const listTasks = () =>
  taskOrder
    .map((taskId) => tasks.get(taskId))
    .filter((task): task is TaskRecord => Boolean(task))
    .map((task) => ({ ...task }));

const saveMessage = (taskId: string, role: ChatMessageRole, content: string) => {
  messageSequence += 1;
  const message: ChatMessageRecord = {
    id: `message_${messageSequence}`,
    taskId,
    role,
    content,
    createdAt: new Date().toISOString()
  };
  const existing = messagesByTask.get(taskId) ?? [];
  messagesByTask.set(taskId, [...existing, message]);
  return message;
};
```

Return `listTasks` from the store, update `getPageState`, and add `submitTaskPrompt`:

```ts
listTasks,

async getPageState(input) {
  const currentProjects = listProjects();
  const currentTasks = listTasks();
  const requestedTaskId = input?.taskId?.trim();
  const task = requestedTaskId ? tasks.get(requestedTaskId) : undefined;

  if (!task) {
    return {
      kind: "empty",
      projects: currentProjects,
      tasks: currentTasks
    };
  }

  const snapshot = task.projectId
    ? await service.getSnapshot(task.projectId)
    : undefined;

  return {
    kind: "task_ready",
    projects: currentProjects,
    tasks: currentTasks,
    activeTaskId: task.id,
    task: { ...task },
    messages: (messagesByTask.get(task.id) ?? []).map((message) => ({ ...message })),
    snapshot
  };
},

async submitTaskPrompt(input) {
  const prompt = validatePromptInput(input.prompt);
  if (!prompt.ok) {
    return { ok: false, error: prompt.error };
  }

  const taskType = classifyTaskPrompt(prompt.value);
  let projectId = input.projectId?.trim() || undefined;

  if (projectId && !projects.has(projectId)) {
    return { ok: false, error: "project_not_found" };
  }

  if (taskType === "lp_generation" && !projectId) {
    const project = await service.createProject({
      name: deriveImplicitProjectName(prompt.value, input.implicitProjectName)
    });
    projects.set(project.id, project);
    projectOrder.push(project.id);
    projectId = project.id;
  }

  taskSequence += 1;
  const task: TaskRecord = {
    id: `task_${taskSequence}`,
    title: deriveTaskTitle(prompt.value),
    type: taskType,
    status: "complete",
    projectId,
    createdAt: new Date().toISOString()
  };
  tasks.set(task.id, task);
  taskOrder.push(task.id);
  saveMessage(task.id, "user", prompt.value);

  if (taskType === "lp_generation") {
    if (!projectId) {
      return { ok: false, error: "project_not_found" };
    }
    try {
      const brief = await service.createBriefFromPrompt({
        projectId,
        prompt: prompt.value
      });
      const pageVersion = await service.generatePageVersion({
        projectId,
        briefId: brief.id
      });
      await service.reviewPageVersion({
        projectId,
        pageVersionId: pageVersion.id
      });
      saveMessage(task.id, "assistant", "LP artifacts are ready for review.");
    } catch {
      return { ok: false, error: "generation_failed" };
    }
  } else {
    saveMessage(task.id, "assistant", "I created a task thread and can continue from here.");
  }

  return {
    ok: true,
    taskId: task.id,
    taskType,
    projectId
  };
}
```

- [ ] **Step 6: Run store tests and commit**

Run:

```bash
pnpm test apps/web/src/lib/workbench-store.test.ts
```

Expected: pass.

Commit:

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts
git commit -m "feat: add conversation task store"
```

## Task 2: Add Current Task Session and Server Action Flow

**Files:**
- Modify: `apps/web/src/lib/workbench-session.ts`
- Modify: `apps/web/src/app/actions.ts`
- Modify: `apps/web/src/app/actions.test.ts`

- [ ] **Step 1: Write failing server action tests**

In `apps/web/src/app/actions.test.ts`, extend hoisted mocks:

```ts
setCurrentTaskId: vi.fn(),
submitTaskPrompt: vi.fn()
```

Update the `workbench-session` mock:

```ts
vi.mock("../lib/workbench-session", () => ({
  getCurrentProjectId: vi.fn(async () => mocks.currentProjectId),
  setCurrentProjectId: mocks.setCurrentProjectId,
  setCurrentTaskId: mocks.setCurrentTaskId
}));
```

Update the `workbench-store` mock:

```ts
vi.mock("../lib/workbench-store", () => ({
  getWebWorkbenchStore: vi.fn(() => ({
    createProject: mocks.createProject,
    submitTaskPrompt: mocks.submitTaskPrompt
  }))
}));
```

Update `buildPromptForm` to include the implicit project name:

```ts
function buildPromptForm(input: {
  projectId?: string;
  prompt?: string;
  implicitProjectName?: string;
} = {}): FormData {
  const formData = new FormData();
  if (input.projectId !== undefined) {
    formData.set("projectId", input.projectId);
  }
  formData.set("prompt", input.prompt ?? "Build a spring landing page.");
  formData.set("implicitProjectName", input.implicitProjectName ?? "Untitled LP Project");
  return formData;
}
```

Add these tests:

```ts
it("submits a general task without a current project", async () => {
  mocks.currentProjectId = undefined;
  mocks.submitTaskPrompt.mockResolvedValue({
    ok: true,
    taskId: "task_1",
    taskType: "general_chat",
    projectId: undefined
  });

  await expectRedirect(
    submitPromptAction(buildPromptForm({ prompt: "Help me write a campaign plan." })),
    "/"
  );

  expect(mocks.submitTaskPrompt).toHaveBeenCalledWith({
    projectId: undefined,
    prompt: "Help me write a campaign plan.",
    implicitProjectName: "Untitled LP Project"
  });
  expect(mocks.setCurrentTaskId).toHaveBeenCalledWith("task_1");
  expect(mocks.setCurrentProjectId).not.toHaveBeenCalled();
});

it("stores the implicit project id returned from an LP task", async () => {
  mocks.currentProjectId = undefined;
  mocks.submitTaskPrompt.mockResolvedValue({
    ok: true,
    taskId: "task_2",
    taskType: "lp_generation",
    projectId: "project_1"
  });

  await expectRedirect(
    submitPromptAction(buildPromptForm({ prompt: "Create an ecommerce LP in HTML." })),
    "/"
  );

  expect(mocks.setCurrentTaskId).toHaveBeenCalledWith("task_2");
  expect(mocks.setCurrentProjectId).toHaveBeenCalledWith("project_1");
});
```

- [ ] **Step 2: Run action tests and verify failure**

Run:

```bash
pnpm test apps/web/src/app/actions.test.ts
```

Expected: fail because `setCurrentTaskId` and `submitTaskPrompt` are not implemented.

- [ ] **Step 3: Add current task cookie helpers**

In `apps/web/src/lib/workbench-session.ts`, add:

```ts
export const CURRENT_TASK_COOKIE = "lp-agent-current-task";

export async function getCurrentTaskId(): Promise<string | undefined> {
  const cookieStore = await cookies();
  const value = cookieStore.get(CURRENT_TASK_COOKIE)?.value.trim();
  return value && value.length > 0 ? value : undefined;
}

export async function setCurrentTaskId(taskId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(CURRENT_TASK_COOKIE, taskId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/"
  });
}
```

- [ ] **Step 4: Update prompt action to submit task prompts**

In `apps/web/src/app/actions.ts`, update imports:

```ts
import { getCurrentProjectId, setCurrentProjectId, setCurrentTaskId } from "../lib/workbench-session";
```

Replace `submitPromptAction` with:

```ts
export async function submitPromptAction(formData: FormData): Promise<void> {
  const currentProjectId = await getCurrentProjectId();
  const store = getWebWorkbenchStore();
  const prompt = String(formData.get("prompt") ?? "");
  const implicitProjectName = String(
    formData.get("implicitProjectName") ?? "Untitled LP Project"
  );
  const submittedProjectId = String(formData.get("projectId") ?? "").trim();
  const projectId =
    submittedProjectId.length > 0 && submittedProjectId === currentProjectId
      ? currentProjectId
      : currentProjectId;

  const result = await store.submitTaskPrompt({
    projectId,
    prompt,
    implicitProjectName
  });
  if (!result.ok) {
    redirectWithError(result.error);
  }

  await setCurrentTaskId(result.taskId);
  if (result.projectId) {
    await setCurrentProjectId(result.projectId);
  }

  revalidatePath("/");
  redirect("/");
}
```

Remove `resolveSubmittedProjectId` if no longer used.

- [ ] **Step 5: Run action tests and commit**

Run:

```bash
pnpm test apps/web/src/app/actions.test.ts
```

Expected: pass.

Commit:

```bash
git add apps/web/src/lib/workbench-session.ts apps/web/src/app/actions.ts apps/web/src/app/actions.test.ts
git commit -m "feat: submit conversation tasks from composer"
```

## Task 3: Add General Task Chat View Model

**Files:**
- Modify: `apps/web/src/lib/chat-workbench.ts`
- Modify: `apps/web/src/lib/chat-workbench.test.ts`

- [ ] **Step 1: Write failing general thread test**

In `apps/web/src/lib/chat-workbench.test.ts`, import `createGeneralTaskThread` and add:

```ts
it("creates a general task conversation without artifacts", () => {
  const copy = getWorkbenchCopy("en");
  const thread = createGeneralTaskThread({
    copy,
    userMessage: "Help me write a campaign plan.",
    assistantMessage: "I created a task thread and can continue from here."
  });

  expect(thread.userMessage).toBe("Help me write a campaign plan.");
  expect(thread.assistantIntro).toBe(copy.chat.generalIntro);
  expect(thread.assistantCompletion).toBe("I created a task thread and can continue from here.");
  expect(thread.toolEvents.map((event) => event.role)).toEqual(["assistant"]);
  expect(thread.artifacts).toEqual([]);
});
```

- [ ] **Step 2: Run chat view-model tests and verify failure**

Run:

```bash
pnpm test apps/web/src/lib/chat-workbench.test.ts
```

Expected: fail because `createGeneralTaskThread` and `copy.chat.generalIntro` do not exist.

- [ ] **Step 3: Extend chat types and add the general thread builder**

In `apps/web/src/lib/chat-workbench.ts`, change the role type:

```ts
export type ChatToolRole = "planner" | "builder" | "reviewer" | "assistant";
```

Add this function below `createChatWorkbenchThread`:

```ts
export function createGeneralTaskThread({
  copy,
  userMessage,
  assistantMessage
}: {
  copy: WorkbenchCopy;
  userMessage: string;
  assistantMessage: string;
}): ChatWorkbenchThread {
  return {
    userMessage,
    assistantName: copy.chat.assistantName,
    assistantBadge: copy.chat.assistantBadge,
    assistantIntro: copy.chat.generalIntro,
    assistantCompletion: assistantMessage,
    toolEvents: [
      {
        id: "assistant",
        role: "assistant",
        label: copy.chat.generalToolLabel,
        operation: copy.chat.generalToolOperation,
        status: "complete",
        statusLabel: copy.chat.toolStatusComplete,
        meta: copy.chat.generalToolMeta
      }
    ],
    artifacts: [],
    suggestions: copy.chat.generalSuggestions,
    composer: {
      placeholder: copy.chat.composerPlaceholder,
      addAttachmentLabel: copy.chat.addAttachmentLabel,
      runtimeChip: copy.chat.runtimeChip,
      interruptLabel: copy.chat.interruptLabel,
      sendLabel: copy.chat.sendLabel
    }
  };
}
```

- [ ] **Step 4: Add the required i18n fields temporarily for tests**

In `apps/web/src/lib/i18n.ts`, extend `WorkbenchCopy["chat"]` with:

```ts
generalIntro: string;
generalToolLabel: string;
generalToolOperation: string;
generalToolMeta: string;
generalSuggestions: string[];
```

Add English values:

```ts
generalIntro: "I created a normal task thread. You can continue the conversation from here.",
generalToolLabel: "Assistant",
generalToolOperation: "Created a general task thread.",
generalToolMeta: "No project required",
generalSuggestions: [
  "Turn this into a checklist",
  "Make this more concise",
  "Create an LP from this idea"
],
```

Add Chinese values:

```ts
generalIntro: "我已经创建了一个普通任务对话，你可以继续补充上下文。",
generalToolLabel: "助手",
generalToolOperation: "已创建普通任务对话。",
generalToolMeta: "无需项目",
generalSuggestions: [
  "整理成执行清单",
  "把内容写得更简洁",
  "基于这个想法生成 LP"
],
```

- [ ] **Step 5: Run chat view-model tests and commit**

Run:

```bash
pnpm test apps/web/src/lib/chat-workbench.test.ts
```

Expected: pass.

Commit:

```bash
git add apps/web/src/lib/chat-workbench.ts apps/web/src/lib/chat-workbench.test.ts apps/web/src/lib/i18n.ts
git commit -m "feat: add general task chat thread"
```

## Task 4: Render Conversation-First Empty State and Task Threads

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Add failing page tests for the new empty state and general task state**

In `apps/web/src/app/page.test.ts`, update the default mocked page state to:

```ts
pageState: {
  kind: "empty",
  projects: [],
  tasks: []
} as unknown
```

Add a helper to inspect input disabled state:

```ts
function collectElements(node: unknown, type: string): Array<{ props?: Record<string, unknown> }> {
  if (node === null || node === undefined || typeof node === "boolean") {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((child) => collectElements(child, type));
  }
  if (typeof node === "object" && "type" in node && "props" in node) {
    const element = node as { type?: unknown; props?: { children?: unknown } };
    return [
      ...(element.type === type ? [element as { props?: Record<string, unknown> }] : []),
      ...collectElements(element.props?.children, type)
    ];
  }
  return [];
}
```

Add these tests:

```ts
it("renders a conversation-first empty state with an enabled composer", async () => {
  const page = await HomePage({
    searchParams: Promise.resolve({})
  });
  const text = collectText(page);
  const inputs = collectElements(page, "input");

  expect(text).toContain("What can I help you build?");
  expect(text).toContain("Create static LP");
  expect(text).toContain("Plan a campaign");
  expect(text).not.toContain("Start with a local project");
  expect(text).not.toContain("Repository URL");
  expect(
    inputs.some((input) => input.props?.name === "prompt" && input.props?.disabled === true)
  ).toBe(false);
});

it("renders a general task thread without static artifact cards", async () => {
  pageMocks.currentTaskId = "task_1";
  pageMocks.pageState = {
    kind: "task_ready",
    projects: [],
    tasks: [
      {
        id: "task_1",
        title: "Help me write a campaign plan.",
        type: "general_chat",
        status: "complete",
        createdAt: "2026-05-12T08:00:00.000Z"
      }
    ],
    activeTaskId: "task_1",
    task: {
      id: "task_1",
      title: "Help me write a campaign plan.",
      type: "general_chat",
      status: "complete",
      createdAt: "2026-05-12T08:00:00.000Z"
    },
    messages: [
      {
        id: "message_1",
        taskId: "task_1",
        role: "user",
        content: "Help me write a campaign plan.",
        createdAt: "2026-05-12T08:00:00.000Z"
      },
      {
        id: "message_2",
        taskId: "task_1",
        role: "assistant",
        content: "I created a task thread and can continue from here.",
        createdAt: "2026-05-12T08:00:01.000Z"
      }
    ]
  };

  const page = await HomePage({
    searchParams: Promise.resolve({})
  });
  const text = collectText(page).join(" ");

  expect(text).toContain("Help me write a campaign plan.");
  expect(text).toContain("I created a task thread and can continue from here.");
  expect(text).toContain("Assistant");
  expect(text).not.toContain("index.single.html");
  expect(text).not.toContain("Static LP preview");
});
```

- [ ] **Step 2: Run page tests and verify failure**

Run:

```bash
pnpm test apps/web/src/app/page.test.ts
```

Expected: fail because `page.tsx` still renders the project-first setup panel and does not know `task_ready`.

- [ ] **Step 3: Add empty-state copy and i18n tests**

In `apps/web/src/lib/i18n.ts`, add this section to `WorkbenchCopy`:

```ts
entry: {
  title: string;
  placeholder: string;
  chips: string[];
  implicitProjectName: string;
  createStaticLp: string;
};
```

Add English values:

```ts
entry: {
  title: "What can I help you build?",
  placeholder: "Assign a task or ask anything",
  chips: ["Create static LP", "Plan a campaign", "Create website", "Design", "More"],
  implicitProjectName: "Untitled LP Project",
  createStaticLp: "Create static LP"
},
```

Add Chinese values:

```ts
entry: {
  title: "我能为你做什么？",
  placeholder: "分配一个任务或提问任何问题",
  chips: ["创建静态 LP", "策划活动", "创建网站", "设计", "更多"],
  implicitProjectName: "未命名 LP 项目",
  createStaticLp: "创建静态 LP"
},
```

In `apps/web/src/lib/i18n.test.ts`, add:

```ts
expect(getWorkbenchCopy("zh-CN").entry.title).toBe("我能为你做什么？");
expect(getWorkbenchCopy("zh-CN").entry.implicitProjectName).toBe("未命名 LP 项目");
expect(getWorkbenchCopy("en").entry.title).toBe("What can I help you build?");
expect(getWorkbenchCopy("en").entry.implicitProjectName).toBe("Untitled LP Project");
```

- [ ] **Step 4: Update page data flow and render branches**

In `apps/web/src/app/page.tsx`, update imports:

```ts
import {
  createChatWorkbenchThread,
  createGeneralTaskThread
} from "../lib/chat-workbench";
import { getCurrentProjectId, getCurrentTaskId } from "../lib/workbench-session";
```

Update page state loading:

```ts
const currentProjectId = await getCurrentProjectId();
const currentTaskId = await getCurrentTaskId();
const pageState = await getWebWorkbenchStore().getPageState({
  projectId: currentProjectId,
  taskId: currentTaskId
});
```

Derive active project and task:

```ts
const activeTask = pageState.kind === "task_ready" ? pageState.task : undefined;
const activeProject =
  pageState.kind === "task_ready" && pageState.snapshot
    ? pageState.snapshot.project
    : pageState.projects.find((project) => project.id === currentProjectId);
```

Create `chat` by branching on task type:

```ts
const completedSnapshot =
  pageState.kind === "task_ready" &&
  pageState.snapshot?.brief &&
  pageState.snapshot.currentPageVersion
    ? {
        brief: pageState.snapshot.brief,
        pageVersion: pageState.snapshot.currentPageVersion
      }
    : undefined;
const downloadLinks = completedSnapshot
  ? createArtifactDownloadLinks(completedSnapshot.pageVersion.artifacts, copy.exports)
  : undefined;
const chat =
  pageState.kind === "task_ready" && activeTask?.type === "general_chat"
    ? createGeneralTaskThread({
        copy,
        userMessage: pageState.messages.find((message) => message.role === "user")?.content ?? activeTask.title,
        assistantMessage:
          pageState.messages.find((message) => message.role === "assistant")?.content ??
          copy.chat.generalToolOperation
      })
    : completedSnapshot && downloadLinks
      ? createChatWorkbenchThread({
          copy,
          prompt: completedSnapshot.brief.prompt,
          objective: completedSnapshot.brief.brief.objective,
          pageVersion: completedSnapshot.pageVersion,
          downloadLinks
        })
      : undefined;
```

Replace the no-project setup panel with an empty composer section:

```tsx
{pageState.kind === "empty" ? (
  <section className="entryPanel" aria-labelledby="entry-title">
    <h1 id="entry-title">{copy.entry.title}</h1>
    {errorMessage ? <div className="formError" role="alert">{errorMessage}</div> : null}
    <div className="entryComposerShell">
      <p>{copy.entry.placeholder}</p>
      <div className="entryChipRow">
        {copy.entry.chips.map((chip) => (
          <button type="button" key={chip}>{chip}</button>
        ))}
      </div>
    </div>
  </section>
) : null}
```

Render the task sidebar from `pageState.tasks`:

```tsx
{pageState.tasks.length > 0
  ? pageState.tasks.map((task) => (
      <button
        className={task.id === activeTask?.id ? "taskItem taskItemActive" : "taskItem"}
        type="button"
        key={task.id}
      >
        {task.title}
      </button>
    ))
  : copy.sidebar.taskTitles.map((taskTitle, index) => (
      <button
        className={index === 0 ? "taskItem taskItemActive" : "taskItem"}
        type="button"
        key={taskTitle}
      >
        {taskTitle}
      </button>
    ))}
```

Update the composer so it is always enabled and includes implicit project name:

```tsx
<form action={submitPromptAction} className="composerDock">
  <input name="projectId" type="hidden" value={activeProject?.id ?? ""} />
  <input name="implicitProjectName" type="hidden" value={copy.entry.implicitProjectName} />
  <div className="composer">
    <button type="button" aria-label={composer.addAttachmentLabel}>+</button>
    <input
      aria-label={copy.projectFlow.promptLabel}
      name="prompt"
      placeholder={pageState.kind === "empty" ? copy.entry.placeholder : composer.placeholder}
    />
    <span>{composer.runtimeChip}</span>
    <button type="button" className="interruptButton">{composer.interruptLabel}</button>
    <button type="submit" className="sendButton">{composer.sendLabel}</button>
  </div>
</form>
```

- [ ] **Step 5: Add empty-state CSS**

In `apps/web/src/app/globals.css`, add:

```css
.entryPanel {
  min-height: calc(100vh - 190px);
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 22px;
  padding: 48px 0;
}

.entryPanel h1 {
  margin: 0;
  color: #2d3035;
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.1;
  text-align: center;
  letter-spacing: 0;
}

.entryComposerShell {
  width: min(100%, 720px);
  display: grid;
  gap: 18px;
}

.entryComposerShell p {
  min-height: 96px;
  margin: 0;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
  color: var(--subtle);
  box-shadow: var(--shadow);
  padding: 18px;
  font-size: 0.96rem;
}

.entryChipRow {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}

.entryChipRow button {
  min-height: 36px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: #4a4e54;
  padding: 0 14px;
  font-size: 0.86rem;
  font-weight: 760;
}

.entryChipRow button:hover {
  border-color: var(--accent-line);
  color: var(--accent);
  background: var(--accent-soft);
}
```

- [ ] **Step 6: Run page and i18n tests and commit**

Run:

```bash
pnpm test apps/web/src/app/page.test.ts apps/web/src/lib/i18n.test.ts
```

Expected: pass.

Commit:

```bash
git add apps/web/src/app/page.tsx apps/web/src/app/page.test.ts apps/web/src/lib/i18n.ts apps/web/src/lib/i18n.test.ts apps/web/src/app/globals.css
git commit -m "feat: render conversation-first workbench entry"
```

## Task 5: Preserve LP Completion Behavior Under Task State

**Files:**
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/lib/chat-workbench.test.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`

- [ ] **Step 1: Update existing LP tests to use task-ready state**

In `apps/web/src/app/page.test.ts`, change the completed LP fixture from `kind: "project_ready"` to:

```ts
kind: "task_ready",
tasks: [
  {
    id: "task_1",
    title: "Create a no git spring ecommerce landing page.",
    type: "lp_generation",
    status: "complete",
    projectId: "project_1",
    createdAt: "2026-05-12T08:00:00.000Z"
  }
],
activeTaskId: "task_1",
task: {
  id: "task_1",
  title: "Create a no git spring ecommerce landing page.",
  type: "lp_generation",
  status: "complete",
  projectId: "project_1",
  createdAt: "2026-05-12T08:00:00.000Z"
},
messages: [
  {
    id: "message_1",
    taskId: "task_1",
    role: "user",
    content: "Create a no git spring ecommerce landing page.",
    createdAt: "2026-05-12T08:00:00.000Z"
  }
],
snapshot: {
  project: {
    id: "project_1",
    name: "Completed LP",
    createdAt: "2026-05-12T08:00:00.000Z"
  },
  brief: {
    id: "brief_1",
    projectId: "project_1",
    prompt: "Create a no git spring ecommerce landing page.",
    brief: {
      objective: "Convert paid traffic into spring campaign purchases.",
      audience: "Returning ecommerce shoppers",
      offer: "Save 25% through Sunday.",
      primaryCta: "Shop the sale"
    },
    createdAt: "2026-05-12T08:00:00.000Z"
  },
  currentPageVersion: {
    id: "version_1",
    projectId: "project_1",
    briefId: "brief_1",
    artifacts: {
      indexHtml: [
        "<!doctype html><html><head>",
        "<link rel=\"stylesheet\" href=\"styles.css\">",
        "</head><body>",
        "<main><h1>Spring essentials</h1></main>",
        "  <script src=\"script.js\"></script>",
        "</body></html>"
      ].join(""),
      stylesCss: "body { color: #111827; }",
      scriptJs: "window.lpAgent = true;"
    },
    reviewStatus: "passed",
    findings: [],
    createdAt: "2026-05-12T08:01:00.000Z"
  },
  deployment: undefined
}
```

- [ ] **Step 2: Run the focused LP preservation tests**

Run:

```bash
pnpm test apps/web/src/app/page.test.ts apps/web/src/lib/chat-workbench.test.ts apps/web/src/lib/workbench-store.test.ts
```

Expected: pass. The LP assertions must still include `3/3`, `index.single.html`, `index.html`, `styles.css`, `script.js`, and `Static LP preview`.

- [ ] **Step 3: Commit LP compatibility**

Commit:

```bash
git add apps/web/src/app/page.test.ts apps/web/src/lib/chat-workbench.test.ts apps/web/src/lib/workbench-store.test.ts
git commit -m "test: preserve lp completion in task state"
```

## Task 6: Full Verification and Manual Smoke Test

**Files:**
- No planned source edits.

- [ ] **Step 1: Run full automated verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected:

- `pnpm test`: all Vitest files pass.
- `pnpm typecheck`: all workspace packages pass `tsc --noEmit` and Next route type generation.
- `pnpm build`: Next production build succeeds.

- [ ] **Step 2: Start the Web app for manual verification**

Run:

```bash
pnpm --filter @lp-agent/web dev --port 3002 --hostname 127.0.0.1
```

Expected: dev server prints `http://127.0.0.1:3002`.

- [ ] **Step 3: Verify empty state in the browser**

Open:

```text
http://127.0.0.1:3002
```

Expected:

- The main panel shows the large title `What can I help you build?` or `我能为你做什么？` depending on browser language.
- The large composer is enabled before any project exists.
- Sidebar projects section exists with project creation affordance.
- Sidebar tasks section exists.
- No repository URL field appears.
- No deployment navigation appears.

- [ ] **Step 4: Verify general task flow**

Submit:

```text
Help me write a campaign plan.
```

Expected:

- A user message appears.
- A general assistant message appears.
- The task appears in the sidebar task list.
- No project is created.
- No static artifact cards appear.

- [ ] **Step 5: Verify LP task flow without explicit project**

Submit from a fresh dev-server state:

```text
Create an ecommerce spring sale LP in single-file HTML.
```

Expected:

- The task appears in the sidebar.
- An implicit local project appears in the sidebar projects section.
- The assistant timeline shows planner, builder, reviewer.
- The artifact cards include `index.single.html`, `index.html`, `styles.css`, and `script.js`.
- Static preview renders.
- No `deployment-handoff.json`, PR link, branch, repository URL, or deployment navigation appears.

- [ ] **Step 6: Stop dev server and commit any final fixes**

If the dev server was started in a terminal session, stop it with `Ctrl-C`.

If final fixes were needed, run:

```bash
pnpm test
pnpm typecheck
pnpm build
git add apps/web/src docs/superpowers
git commit -m "fix: complete conversation-first workbench verification"
```

Expected: only commit if there were actual fixes after the previous commits.

## Self-Review

- Spec coverage: empty composer, ordinary task mode, LP routing, implicit project creation, sidebar projects/tasks, no Git, no deployment, and static LP completion are each covered by tasks.
- Placeholder scan: this plan contains concrete file paths, function names, test cases, and commands; there are no unresolved placeholders.
- Type consistency: `TaskType`, `TaskRecord`, `ChatMessageRecord`, `SubmitTaskResult`, `submitTaskPrompt`, `getCurrentTaskId`, and `setCurrentTaskId` are introduced once and reused consistently.
