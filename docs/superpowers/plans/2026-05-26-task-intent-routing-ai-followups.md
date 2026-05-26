# Task Intent Routing and AI Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Stage59 so ordinary chat stays clean, LP tasks get context-aware AI follow-ups, and every LP task composer input is routed through AI intent classification before deciding whether to chat, continue the current LP, create a new LP, or ask a clarification.

**Architecture:** Add a small API-owned task intent module for strict JSON prompts/parsing, expose service methods that call the existing `assistant` runtime with bounded context, then route LP task submits in `workbench-store` before invoking the LP agent chain. The Web projection renders suggestions only from `pageState.taskFollowupSuggestions` and hides LP progress chrome for latest LP turns that did not create planner/builder/reviewer/deployer work.

**Tech Stack:** TypeScript, Zod-style runtime validation by local functions, existing `DemoWorkbenchService`, `LocalAgentRuntimeAdapter`, Next.js server actions/API routes, Vitest, Playwright.

---

## File Structure

- Create `packages/api/src/task-intent-routing.ts`: task input intent and follow-up suggestion types, prompt builders, strict JSON parsing, confidence thresholding, deterministic fixture helpers.
- Create `packages/api/src/task-intent-routing.test.ts`: focused tests for prompt safety, parser behavior, low-confidence clarify, invalid JSON fail-closed, and sanitized follow-ups.
- Modify `packages/api/src/index.ts`: export new types/helpers and add `routeTaskInputIntent()` / `generateTaskFollowupSuggestions()` service methods that use `assistant` runtime and bounded context.
- Modify `packages/api/src/services.test.ts`: service-level tests with fake assistant runtimes for AI router, follow-up generation, parse failure, and low-confidence clarify.
- Modify `apps/web/src/lib/workbench-store.ts`: add `taskFollowupSuggestions` to `WorkbenchPageState`, call follow-up provider for LP task-ready pages, route existing LP task submits through intent router in both `submitTaskPrompt()` and `startLiveTaskPrompt()`, and append normal assistant chat turns without starting the LP chain.
- Modify `apps/web/src/lib/workbench-store.test.ts`: store tests for ordinary chat suggestions empty, LP follow-ups sourced from provider, LP chat-in-task not starting agent chain, LP continue starting agent chain, and LP new-task creating a second LP task.
- Modify `apps/web/src/lib/chat-workbench.ts`: replace static `string[]` suggestions with typed task follow-up suggestions and add turn timestamps so UI can decide whether the latest LP turn has task work.
- Modify `apps/web/src/lib/chat-workbench.test.ts`: assert general chat suggestions are empty and LP suggestions come from input state, not i18n arrays.
- Modify `apps/web/src/app/page.tsx`: render suggestion forms only when suggestions exist, include a hidden non-authoritative intent hint, and show `LiveTaskPanel` / agent details only when latest LP turn has actual LP agent work.
- Modify `apps/web/src/app/page.test.ts`: page-level assertions for ordinary chat without suggestions, LP suggestions rendering, hidden intent hint, and no progress card after a chat-in-task turn.
- Modify `apps/web/e2e/alpha-routing-conversation.spec.ts` or add a focused section there: browser-visible ordinary chat has no suggested prompts; completed LP task shows 2-3 LP follow-ups; chat-style follow-up does not show task progress; continue-style follow-up does.
- Modify `docs/project-roadmap.md`, `docs/superpowers/README.md`, and this plan during closeout to reflect Stage59 completion and next-stage routing.

## Task 1: API Intent And Follow-up Module

**Files:**
- Create: `packages/api/src/task-intent-routing.ts`
- Create: `packages/api/src/task-intent-routing.test.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Write failing parser and prompt tests**

Add `packages/api/src/task-intent-routing.test.ts` with these tests:

```ts
import { describe, expect, it } from "vitest";
import {
  buildTaskFollowupSuggestionsPrompt,
  buildTaskInputIntentPrompt,
  normalizeTaskFollowupSuggestionsOutput,
  normalizeTaskInputIntentOutput
} from "./task-intent-routing";

describe("task intent routing", () => {
  it("normalizes valid chat_in_task JSON from the assistant model", () => {
    expect(
      normalizeTaskInputIntentOutput(
        JSON.stringify({
          type: "chat_in_task",
          confidence: 0.91,
          reason: "The user is asking for an explanation."
        })
      )
    ).toEqual({
      type: "chat_in_task",
      confidence: 0.91,
      reason: "The user is asking for an explanation."
    });
  });

  it("fails closed to clarify when confidence is low", () => {
    expect(
      normalizeTaskInputIntentOutput(
        JSON.stringify({
          type: "agent_continue",
          confidence: 0.4,
          reason: "Ambiguous wording."
        })
      )
    ).toEqual({
      type: "clarify",
      confidence: 0.4,
      question: "Do you want me to answer this in chat, continue the current LP task, or create a new LP task?",
      reason: "Low confidence intent classification."
    });
  });

  it("fails closed to clarify on invalid JSON", () => {
    expect(normalizeTaskInputIntentOutput("not json")).toEqual({
      type: "clarify",
      confidence: 0,
      question: "Do you want me to answer this in chat, continue the current LP task, or create a new LP task?",
      reason: "Invalid intent router output."
    });
  });

  it("sanitizes follow-up suggestions and removes duplicate prompts", () => {
    expect(
      normalizeTaskFollowupSuggestionsOutput(
        JSON.stringify([
          { id: "a", intent: "chat_in_task", prompt: "解释页面结构" },
          { id: "b", intent: "chat_in_task", prompt: "解释页面结构" },
          { id: "c", intent: "agent_continue", prompt: "优化首屏文案" },
          { id: "d", intent: "not_allowed", prompt: "bad" }
        ])
      )
    ).toEqual([
      { id: "a", intent: "chat_in_task", prompt: "解释页面结构" },
      { id: "c", intent: "agent_continue", prompt: "优化首屏文案" }
    ]);
  });

  it("builds bounded prompts without raw artifact content", () => {
    const intentPrompt = buildTaskInputIntentPrompt({
      prompt: "为什么这样设计？",
      currentTask: {
        id: "task_1",
        type: "lp_generation",
        status: "complete",
        projectId: "project_1"
      },
      recentMessages: [
        { role: "user", content: "Create an LP" },
        { role: "assistant", content: "LP artifacts are ready." }
      ],
      artifactSummary: {
        hasPreview: true,
        files: [
          {
            path: "index.html",
            summary: "Hero and CTA sections",
            content: "<html>RAW CONTENT MUST NOT APPEAR</html>"
          }
        ]
      }
    });
    const followupPrompt = buildTaskFollowupSuggestionsPrompt({
      taskTitle: "Spring LP",
      taskStatus: "complete",
      recentMessages: [{ role: "user", content: "Create an LP" }],
      artifactSummary: { hasPreview: true, files: [{ path: "index.html", summary: "Hero" }] }
    });

    expect(intentPrompt).toContain("Return strict JSON");
    expect(intentPrompt).toContain("index.html");
    expect(intentPrompt).not.toContain("RAW CONTENT MUST NOT APPEAR");
    expect(followupPrompt).toContain("Return strict JSON array");
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @lp-agent/api test -- task-intent-routing.test.ts
```

Expected: FAIL because `packages/api/src/task-intent-routing.ts` does not exist.

- [ ] **Step 3: Implement the module**

Create `packages/api/src/task-intent-routing.ts` with these exported shapes and behavior:

```ts
export type TaskInputIntentType =
  | "chat_in_task"
  | "agent_continue"
  | "agent_new_task"
  | "clarify";

export type TaskInputIntent =
  | { type: "chat_in_task"; confidence: number; reason: string }
  | { type: "agent_continue"; confidence: number; reason: string }
  | { type: "agent_new_task"; confidence: number; reason: string }
  | { type: "clarify"; confidence: number; question: string; reason: string };

export type TaskFollowupSuggestionIntent =
  | "chat_in_task"
  | "agent_continue"
  | "agent_new_task";

export interface TaskFollowupSuggestion {
  id: string;
  intent: TaskFollowupSuggestionIntent;
  prompt: string;
}
```

Implementation requirements:

- Set `TASK_INPUT_INTENT_CONFIDENCE_THRESHOLD = 0.72`.
- `normalizeTaskInputIntentOutput(raw)` must parse JSON, accept only the four intent types, clamp confidence to `0..1`, trim reason/question to 240 chars, and return the default clarify object for invalid JSON, invalid schema, empty reason, or low confidence.
- `normalizeTaskFollowupSuggestionsOutput(raw)` must parse a JSON array, keep only `chat_in_task` / `agent_continue` / `agent_new_task`, trim prompt to 120 chars, keep 2-3 unique prompts, and return `[]` on invalid JSON or no valid items.
- `buildTaskInputIntentPrompt(input)` must include: user prompt, current task id/type/status/projectId, last 4-6 messages, artifact file paths/summaries/preview flag, and explicit instructions that the model must not execute tools or generate artifacts.
- `buildTaskFollowupSuggestionsPrompt(input)` must include: task title/status, last messages, artifact file paths/summaries/preview flag, and require a strict JSON array.
- Artifact summary input may contain extra `content`; the builder must ignore anything except `path`, `summary`, and `hasPreview`.

Export the new module from `packages/api/src/index.ts`:

```ts
export {
  buildTaskFollowupSuggestionsPrompt,
  buildTaskInputIntentPrompt,
  normalizeTaskFollowupSuggestionsOutput,
  normalizeTaskInputIntentOutput,
  type TaskFollowupSuggestion,
  type TaskFollowupSuggestionIntent,
  type TaskInputIntent,
  type TaskInputIntentType
} from "./task-intent-routing";
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter @lp-agent/api test -- task-intent-routing.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/api/src/task-intent-routing.ts packages/api/src/task-intent-routing.test.ts packages/api/src/index.ts
git commit -m "add task intent parsing helpers"
```

## Task 2: Service-level AI Router And Follow-up Provider

**Files:**
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/services.test.ts`

- [ ] **Step 1: Write failing service tests**

Add a `describe("task intent routing and follow-ups", ...)` block near existing assistant chat service tests in `packages/api/src/services.test.ts`.

Use existing `StaticRuntime` / `RecordingRuntime` test helpers. Add tests equivalent to:

```ts
it("routes task input intent through the assistant runtime with bounded context", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const assistantRuntime = new RecordingRuntime({
    modelOutputText: JSON.stringify({
      type: "chat_in_task",
      confidence: 0.93,
      reason: "The user asks for an explanation."
    })
  });
  const service = new DemoWorkbenchService({ repositories, assistantRuntime, now: fixedClock() });
  const project = await service.createProject({ name: "Spring LP" });

  const result = await service.routeTaskInputIntent({
    projectId: project.id,
    taskId: "task_1",
    prompt: "为什么这样设计？",
    currentTask: {
      id: "task_1",
      type: "lp_generation",
      status: "complete",
      projectId: project.id
    },
    recentMessages: [{ role: "user", content: "Create a page" }],
    artifactSummary: {
      hasPreview: true,
      files: [{ path: "index.html", summary: "Hero and CTA" }]
    }
  });

  expect(result).toEqual({
    type: "chat_in_task",
    confidence: 0.93,
    reason: "The user asks for an explanation."
  });
  expect(assistantRuntime.requests[0]).toMatchObject({
    projectId: project.id,
    taskId: "task_1",
    role: "assistant"
  });
  expect(assistantRuntime.requests[0]?.input.prompt).toContain("Return strict JSON");
});
```

Add two more tests:

```ts
it("fails closed to clarify when assistant intent output is invalid", async () => {
  const service = new DemoWorkbenchService({
    assistantRuntime: new StaticRuntime({ modelOutputText: "plain text" }),
    now: fixedClock()
  });
  const project = await service.createProject({ name: "Spring LP" });

  const result = await service.routeTaskInputIntent({
    projectId: project.id,
    prompt: "随便改一下",
    currentTask: { id: "task_1", type: "lp_generation", status: "complete", projectId: project.id },
    recentMessages: []
  });

  expect(result.type).toBe("clarify");
});

it("generates sanitized LP follow-up suggestions through assistant runtime", async () => {
  const service = new DemoWorkbenchService({
    assistantRuntime: new StaticRuntime({
      modelOutputText: JSON.stringify([
        { id: "explain", intent: "chat_in_task", prompt: "解释页面结构" },
        { id: "copy", intent: "agent_continue", prompt: "优化首屏文案" }
      ])
    }),
    now: fixedClock()
  });
  const project = await service.createProject({ name: "Spring LP" });

  const suggestions = await service.generateTaskFollowupSuggestions({
    projectId: project.id,
    taskId: "task_1",
    taskTitle: "Spring LP",
    taskStatus: "complete",
    recentMessages: [{ role: "assistant", content: "LP artifacts are ready." }],
    artifactSummary: { hasPreview: true, files: [{ path: "index.html", summary: "Hero" }] }
  });

  expect(suggestions).toEqual([
    { id: "explain", intent: "chat_in_task", prompt: "解释页面结构" },
    { id: "copy", intent: "agent_continue", prompt: "优化首屏文案" }
  ]);
});
```

- [ ] **Step 2: Run service tests and verify RED**

Run:

```bash
pnpm --filter @lp-agent/api test -- services.test.ts
```

Expected: FAIL because `routeTaskInputIntent` and `generateTaskFollowupSuggestions` do not exist.

- [ ] **Step 3: Implement service methods**

In `packages/api/src/index.ts`:

- Import the prompt builders and normalizers from `./task-intent-routing`.
- Add service method `routeTaskInputIntent(input)`:
  - Validate the project with `getProjectOrThrow`.
  - Resolve optional `taskId` only if supplied and belongs to project.
  - Assemble assistant context with `assembleContextPack`.
  - Reserve a `run_task_intent` id.
  - Call `runAgentStep` with `role: "assistant"` and `input.prompt = buildTaskInputIntentPrompt(input)`.
  - Parse `result.modelOutputText ?? ""` with `normalizeTaskInputIntentOutput`.
  - Catch errors and return the default clarify intent.
  - Release any reserved id in `finally`.
- Add service method `generateTaskFollowupSuggestions(input)`:
  - Validate project and optional task ownership.
  - Assemble assistant context with `role: "assistant"`.
  - Reserve a `run_task_followups` id.
  - Call `runAgentStep` using `buildTaskFollowupSuggestionsPrompt(input)`.
  - Parse output with `normalizeTaskFollowupSuggestionsOutput`.
  - Catch errors and return `[]`.

Service input types should be exported from `packages/api/src/index.ts` so Web store can use them:

```ts
export interface RouteTaskInputIntentInput { ... }
export interface GenerateTaskFollowupSuggestionsInput { ... }
```

Keep prompts metadata-only; never pass artifact file content.

- [ ] **Step 4: Run service tests and verify GREEN**

Run:

```bash
pnpm --filter @lp-agent/api test -- services.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add packages/api/src/index.ts packages/api/src/services.test.ts
git commit -m "route task intent through assistant runtime"
```

## Task 3: Web Store Routing Behavior

**Files:**
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`

- [ ] **Step 1: Write failing store tests**

Add tests around existing LP continuation tests in `apps/web/src/lib/workbench-store.test.ts`.

Test 1: LP `chat_in_task` appends user/assistant messages and does not start Planner/Builder:

```ts
it("answers ordinary questions inside an LP task without starting the LP chain", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const assistantRuntime = new MutableRuntime({
    modelOutputText: JSON.stringify({
      type: "chat_in_task",
      confidence: 0.94,
      reason: "Question about current task."
    })
  });
  const builderRuntime = new RecordingRuntime({ state: "completed", artifacts: completeArtifacts() });
  const store = createWebWorkbenchStore({ repositories, assistantRuntime, builderRuntime });

  const first = await store.submitTaskPrompt({
    prompt: "Create a landing page for a spring sale",
    implicitProjectName: "Spring Sale",
    projectId: null
  });
  if (!first.ok || !first.projectId) throw new Error("expected first LP task");

  assistantRuntime.result = { modelOutputText: "这是当前页面结构的解释。" };
  const second = await store.submitTaskPrompt({
    taskId: first.taskId,
    projectId: first.projectId,
    prompt: "为什么这样设计？",
    implicitProjectName: "Spring Sale"
  });

  expect(second).toEqual({
    ok: true,
    taskId: first.taskId,
    taskType: "lp_generation",
    projectId: first.projectId
  });
  expect(builderRuntime.requests).toHaveLength(1);
  const messages = await repositories.messages.listForTask(first.taskId);
  expect(messages.map((message) => [message.role, message.content])).toEqual([
    ["user", "Create a landing page for a spring sale"],
    ["assistant", "LP artifacts are ready for review."],
    ["user", "为什么这样设计？"],
    ["assistant", "这是当前页面结构的解释。"]
  ]);
});
```

Test 2: LP `agent_continue` still starts the continuation chain:

```ts
it("continues an LP task when the intent router returns agent_continue", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const assistantRuntime = new StaticRuntime({
    modelOutputText: JSON.stringify({
      type: "agent_continue",
      confidence: 0.95,
      reason: "User asks to modify the current LP."
    })
  });
  const builderRuntime = new RecordingRuntime({ state: "completed", artifacts: completeArtifacts() });
  const store = createWebWorkbenchStore({ repositories, assistantRuntime, builderRuntime });
  const first = await store.submitTaskPrompt({
    prompt: "Create a landing page for a spring sale",
    implicitProjectName: "Spring Sale",
    projectId: null
  });
  if (!first.ok || !first.projectId) throw new Error("expected first LP task");

  const second = await store.submitTaskPrompt({
    taskId: first.taskId,
    projectId: first.projectId,
    prompt: "把首屏文案改得更强",
    implicitProjectName: "Spring Sale"
  });

  expect(second.ok).toBe(true);
  expect(builderRuntime.requests.length).toBeGreaterThan(1);
});
```

Test 3: LP `agent_new_task` creates a new LP task:

```ts
it("creates a new LP task when an LP task prompt asks for another page", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const assistantRuntime = new StaticRuntime({
    modelOutputText: JSON.stringify({
      type: "agent_new_task",
      confidence: 0.96,
      reason: "User asks for a separate LP."
    })
  });
  const store = createWebWorkbenchStore({ repositories, assistantRuntime });
  const first = await store.submitTaskPrompt({
    prompt: "Create a landing page for a spring sale",
    implicitProjectName: "Spring Sale",
    projectId: null
  });
  if (!first.ok || !first.projectId) throw new Error("expected first LP task");

  const second = await store.submitTaskPrompt({
    taskId: first.taskId,
    projectId: first.projectId,
    prompt: "再做一个夏季活动页",
    implicitProjectName: "Spring Sale"
  });

  expect(second).toMatchObject({ ok: true, taskType: "lp_generation", projectId: first.projectId });
  if (!second.ok) throw new Error("expected second LP task");
  expect(second.taskId).not.toBe(first.taskId);
});
```

Test 4: `getPageState()` supplies follow-ups only for LP tasks:

```ts
it("adds AI follow-up suggestions only for ready LP tasks", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const assistantRuntime = new StaticRuntime({
    modelOutputText: JSON.stringify([
      { id: "explain", intent: "chat_in_task", prompt: "解释页面结构" },
      { id: "copy", intent: "agent_continue", prompt: "优化首屏文案" }
    ])
  });
  const store = createWebWorkbenchStore({ repositories, assistantRuntime });
  const result = await store.submitTaskPrompt({
    prompt: "Create a landing page for a spring sale",
    implicitProjectName: "Spring Sale",
    projectId: null
  });
  if (!result.ok) throw new Error("expected LP task");

  const lpState = await store.getPageState({ taskId: result.taskId });
  expect(lpState.kind).toBe("task_ready");
  if (lpState.kind !== "task_ready") throw new Error("expected task_ready");
  expect(lpState.taskFollowupSuggestions).toEqual([
    { id: "explain", intent: "chat_in_task", prompt: "解释页面结构" },
    { id: "copy", intent: "agent_continue", prompt: "优化首屏文案" }
  ]);

  const chat = await store.startStreamingChatPrompt({
    projectId: null,
    taskId: null,
    prompt: "Help me write a campaign plan."
  });
  if (!chat.ok) throw new Error("expected chat");
  const chatState = await store.getPageState({ taskId: chat.taskId });
  expect(chatState.kind).toBe("task_ready");
  if (chatState.kind !== "task_ready") throw new Error("expected task_ready");
  expect(chatState.taskFollowupSuggestions).toEqual([]);
});
```

- [ ] **Step 2: Run store tests and verify RED**

Run:

```bash
pnpm --filter web test -- workbench-store.test.ts
```

Expected: FAIL because `taskFollowupSuggestions` and routing behavior do not exist.

- [ ] **Step 3: Implement store routing**

In `WorkbenchPageState` task-ready branch add:

```ts
taskFollowupSuggestions: TaskFollowupSuggestion[];
```

In `getPageState()`:

- For non-LP tasks return `taskFollowupSuggestions: []`.
- For LP tasks with `task.status === "complete"` and a snapshot/artifact summary, call `service.generateTaskFollowupSuggestions()` using:
  - latest 6 messages from `listMessages(task.id)`;
  - `task.title` and `task.status`;
  - `artifactDiff.files.map(({ path, summary }) => ({ path, summary }))`;
  - `hasPreview: Boolean(snapshot?.currentPageVersion)`.
- Catch provider failures and return `[]`.

Add helper `answerLpTaskChatInPlace()`:

```ts
async function answerLpTaskChatInPlace(input: {
  repositories: WorkbenchRepositories;
  service: DemoWorkbenchService;
  task: TaskRecord;
  projectId: string;
  prompt: string;
}): Promise<SubmitTaskResult> {
  await appendTaskMessage({ repositories: input.repositories, taskId: input.task.id, role: "user", content: input.prompt });
  const assistant = await input.service.runAssistantChat({
    projectId: input.projectId,
    taskId: input.task.id,
    prompt: input.prompt
  });
  await appendTaskMessage({
    repositories: input.repositories,
    taskId: input.task.id,
    role: "assistant",
    content: assistant.ok
      ? assistant.content
      : "I need a little more context before I can answer that safely."
  });
  return { ok: true, taskId: input.task.id, taskType: "lp_generation", projectId: input.projectId };
}
```

Add helper `routeExistingLpTaskPrompt()`:

- Calls `service.routeTaskInputIntent()` with current task, recent messages, and metadata-only artifact summary.
- For `chat_in_task`: call `answerLpTaskChatInPlace()`.
- For `agent_continue`: call the existing continuation path.
- For `agent_new_task`: call `prepareLpTaskPrompt()` with `requestedTaskId: undefined` and the same project id.
- For `clarify`: append user message and assistant clarification question; return ok true with existing LP task id.

Use this helper in both `submitTaskPrompt()` and `startLiveTaskPrompt()` before the existing “existing LP task continuation” branch starts the LP chain. For `startLiveTaskPrompt()` chat/clarify paths, return:

```ts
{
  ok: true,
  taskId: existingTask.id,
  taskType: "lp_generation",
  projectId: continuationProjectId,
  completion: Promise.resolve({ ok: true, taskId: existingTask.id, taskType: "lp_generation", projectId: continuationProjectId })
}
```

- [ ] **Step 4: Run store tests and verify GREEN**

Run:

```bash
pnpm --filter web test -- workbench-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts
git commit -m "route lp task inputs before continuation"
```

## Task 4: UI Follow-up Rendering And LP Progress Visibility

**Files:**
- Modify: `apps/web/src/lib/chat-workbench.ts`
- Modify: `apps/web/src/lib/chat-workbench.test.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/app/globals.css` only if existing suggestion styles need a small state-safe adjustment.

- [ ] **Step 1: Write failing view-model tests**

In `apps/web/src/lib/chat-workbench.test.ts`, add:

```ts
it("does not expose static suggestions for general chat threads", () => {
  const thread = createGeneralTaskThread({
    copy,
    userMessage: "你好",
    assistantMessage: "你好，有什么想聊的？",
    messages: [
      { id: "message_1", role: "user", content: "你好", createdAt: "2026-05-26T00:00:00.000Z" },
      { id: "message_2", role: "assistant", content: "你好，有什么想聊的？", createdAt: "2026-05-26T00:00:01.000Z" }
    ]
  });

  expect(thread.suggestions).toEqual([]);
});

it("uses LP follow-up suggestions passed from page state", () => {
  const thread = createChatWorkbenchThread({
    copy,
    prompt: "Create LP",
    objective: "Create LP",
    pageVersion,
    downloadLinks: [],
    followupSuggestions: [
      { id: "explain", intent: "chat_in_task", prompt: "解释页面结构" },
      { id: "copy", intent: "agent_continue", prompt: "优化首屏文案" }
    ],
    messages: [
      { id: "message_1", role: "user", content: "Create LP", createdAt: "2026-05-26T00:00:00.000Z" },
      { id: "message_2", role: "assistant", content: "LP artifacts are ready.", createdAt: "2026-05-26T00:00:01.000Z" }
    ]
  });

  expect(thread.suggestions.map((suggestion) => suggestion.prompt)).toEqual([
    "解释页面结构",
    "优化首屏文案"
  ]);
  expect(thread.suggestions.map((suggestion) => suggestion.intent)).toEqual([
    "chat_in_task",
    "agent_continue"
  ]);
});
```

- [ ] **Step 2: Write failing page tests**

In `apps/web/src/app/page.test.ts`, add or extend task-ready tests:

```ts
it("does not render suggested next prompts for a general chat task", async () => {
  pageMocks.currentTaskId = "task_general";
  pageMocks.pageState = buildGeneralChatPageState({
    taskId: "task_general",
    messages: [
      { id: "message_1", role: "user", content: "你好", createdAt: "2026-05-26T00:00:00.000Z" },
      { id: "message_2", role: "assistant", content: "你好", createdAt: "2026-05-26T00:00:01.000Z" }
    ],
    taskFollowupSuggestions: []
  });

  const page = await HomePage({ searchParams: Promise.resolve({}) });
  const text = collectText(page).join(" ");

  expect(text).not.toContain("推荐追问");
  expect(text).not.toContain("Suggested next prompts");
});

it("renders LP follow-up suggestions with non-authoritative intent hints", async () => {
  pageMocks.currentTaskId = "task_lp";
  pageMocks.pageState = buildLpTaskReadyPageState({
    taskFollowupSuggestions: [
      { id: "explain", intent: "chat_in_task", prompt: "解释页面结构" },
      { id: "copy", intent: "agent_continue", prompt: "优化首屏文案" }
    ]
  });

  const page = await HomePage({ searchParams: Promise.resolve({}) });
  const text = collectText(page).join(" ");
  const inputs = collectElements(page, "input");

  expect(text).toContain("推荐追问");
  expect(text).toContain("解释页面结构");
  expect(inputs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ props: expect.objectContaining({ name: "suggestionIntent", value: "chat_in_task" }) })
    ])
  );
});
```

Add a page test for a latest LP chat-in-task turn:

```ts
it("does not show LP progress card when the latest LP turn is ordinary chat", async () => {
  pageMocks.currentTaskId = "task_lp";
  pageMocks.pageState = buildLpTaskReadyPageState({
    messages: [
      { id: "message_1", role: "user", content: "Create LP", createdAt: "2026-05-26T00:00:00.000Z" },
      { id: "message_2", role: "assistant", content: "LP artifacts are ready.", createdAt: "2026-05-26T00:00:01.000Z" },
      { id: "message_3", role: "user", content: "为什么这样设计？", createdAt: "2026-05-26T00:10:00.000Z" },
      { id: "message_4", role: "assistant", content: "这是为了提高转化。", createdAt: "2026-05-26T00:10:01.000Z" }
    ],
    runEvents: [
      { id: "event_1", runId: "run_planner_1", projectId: "project_1", taskId: "task_lp", sequence: 1, type: "run.completed", message: "planner done", payload: {}, createdAt: "2026-05-26T00:00:02.000Z" }
    ],
    taskFollowupSuggestions: []
  });

  const page = await HomePage({ searchParams: Promise.resolve({}) });
  const text = collectText(page).join(" ");

  expect(text).toContain("为什么这样设计？");
  expect(text).not.toContain("实时任务进度");
  expect(text).not.toContain("Live task progress");
});
```

- [ ] **Step 3: Run focused UI tests and verify RED**

Run:

```bash
pnpm --filter web test -- chat-workbench.test.ts page.test.ts
```

Expected: FAIL because suggestions are still static strings and LP progress visibility is not turn-aware.

- [ ] **Step 4: Implement UI projection**

In `apps/web/src/lib/chat-workbench.ts`:

- Change `ChatWorkbenchTurn` to include optional `userCreatedAt` and `assistantCreatedAt`.
- Change `ChatWorkbenchThread.suggestions` to `TaskFollowupSuggestion[]`.
- Add optional `followupSuggestions?: TaskFollowupSuggestion[]` to `CreateChatWorkbenchThreadInput`.
- Set LP suggestions from `followupSuggestions ?? []`.
- Set general chat suggestions to `[]`.
- Make `GeneralTaskMessage` include optional `createdAt`.
- In `createTaskTurns()`, copy timestamps from user/assistant messages.

In `apps/web/src/app/page.tsx`:

- Pass `pageState.taskFollowupSuggestions` to `createChatWorkbenchThread()` for LP pages.
- Render `suggestionBlock` only when `chat.suggestions.length > 0`.
- Update `QuickPromptForm` signature:

```ts
function QuickPromptForm({
  className,
  implicitProjectName,
  prompt,
  projectId,
  taskId,
  suggestionIntent
}: {
  className: string;
  implicitProjectName: string;
  prompt: string;
  projectId?: string;
  taskId?: string;
  suggestionIntent?: TaskFollowupSuggestion["intent"];
}) {
  ...
  {suggestionIntent ? <input name="suggestionIntent" type="hidden" value={suggestionIntent} /> : null}
}
```

- Add helper `hasLpAgentWorkForTurn(pageState, turn)`:
  - Return false unless `pageState.kind === "task_ready"` and `pageState.task.type === "lp_generation"`.
  - Return true only if `pageState.runEvents` includes planner/builder/reviewer/deployer work with `createdAt >= turn.userCreatedAt`.
  - Treat run ids starting with `run_planner_`, `run_builder_`, `run_reviewer_`, or `run_deployer_` as LP agent work.
- Use `hasLpAgentWorkForTurn()` for `LiveTaskPanel`, `AgentDetailsDisclosure`, `AgentProcessBlock`, `RunTimelineBlock`, and `RecoveryBlock` rendering on the latest turn.

- [ ] **Step 5: Run focused UI tests and verify GREEN**

Run:

```bash
pnpm --filter web test -- chat-workbench.test.ts page.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add apps/web/src/lib/chat-workbench.ts apps/web/src/lib/chat-workbench.test.ts apps/web/src/app/page.tsx apps/web/src/app/page.test.ts apps/web/src/app/globals.css
git commit -m "render lp followups without chat suggestions"
```

## Task 5: Browser Contract, Docs Closeout, And Verification

**Files:**
- Modify: `apps/web/e2e/alpha-routing-conversation.spec.ts`
- Modify: `docs/project-roadmap.md`
- Modify: `docs/superpowers/README.md`
- Modify: `docs/agent-development-learning.md` only if implementation changes the runtime boundary beyond the Stage59 design already recorded.

- [ ] **Step 1: Write failing browser checks**

Add focused browser expectations to `apps/web/e2e/alpha-routing-conversation.spec.ts`:

```ts
test("ordinary chat does not show suggested next prompts", async ({ page }) => {
  await openWorkbench(page);
  await sendPrompt(page, "你好");
  await expect(page.getByText(/推荐追问|Suggested next prompts/)).toHaveCount(0);
});

test("LP follow-up chat does not show task progress while continue follow-up does", async ({ page }) => {
  await openWorkbench(page);
  await sendPrompt(page, "生成一个春季促销的 HTML LP 页面");
  await expect(page.getByText(/推荐追问|Suggested next prompts/)).toBeVisible();

  const explain = page.getByRole("button", { name: /解释|Explain/ }).first();
  await explain.click();
  await expect(page.getByText(/实时任务进度|Live task progress/)).toHaveCount(0);

  const improve = page.getByRole("button", { name: /优化|Improve|copy/i }).first();
  await improve.click();
  await expect(page.getByText(/实时任务进度|Live task progress/)).toBeVisible();
});
```

Use the existing helper names in the file. If helper names differ, adapt the test to the local helpers already used there; do not introduce a second browser helper style.

- [ ] **Step 2: Run focused browser check and verify RED**

Run:

```bash
pnpm --filter web exec playwright test e2e/alpha-routing-conversation.spec.ts --project=chromium
```

Expected: FAIL before final UI/store behavior is wired or if selectors need local adjustment.

- [ ] **Step 3: Make browser checks pass**

Fix only selector/helper mismatches or deterministic fixture wiring needed by the browser test.

If no-key Playwright does not produce AI follow-ups because the runtime uses mock output, enable a deterministic fixture only for the test/runtime boundary using an explicit env flag such as:

```ts
LP_AGENT_DETERMINISTIC_AI_FIXTURES=1
```

The fixture must produce suggestions through the new task follow-up provider shape and must not reuse `copy.chat.suggestions` or `copy.chat.generalSuggestions`.

- [ ] **Step 4: Update docs closeout**

Update `docs/project-roadmap.md`:

- Move Stage59 from current recommended implementation to completed snapshot.
- Record implementation scope: AI intent router, LP-only follow-ups, chat-in-task without agent chain, continue/new-task routing, and browser-visible contract.
- Keep next recommended queue non-empty and return Stage52 to the first default slot.

Update `docs/superpowers/README.md`:

- Mark this plan as the Stage59 implementation plan after the Stage59 design spec.
- Keep reading order accurate.

Update `docs/agent-development-learning.md` only if the implemented fallback or runtime boundary differs materially from the current Stage59 notes.

- [ ] **Step 5: Run full verification**

Run:

```bash
pnpm --filter @lp-agent/api test -- task-intent-routing.test.ts services.test.ts
pnpm --filter web test -- workbench-store.test.ts chat-workbench.test.ts page.test.ts
pnpm typecheck
pnpm alpha:e2e
pnpm test
git diff --check
```

Expected:

- Focused API and Web tests pass.
- `pnpm typecheck` passes.
- `pnpm alpha:e2e` passes.
- `pnpm test` passes.
- `git diff --check` prints no output and exits 0.

- [ ] **Step 6: Commit Task 5**

```bash
git add apps/web/e2e/alpha-routing-conversation.spec.ts docs/project-roadmap.md docs/superpowers/README.md docs/agent-development-learning.md
git commit -m "complete task intent routing followups"
```

## Self-review Checklist

- Spec coverage:
  - Ordinary chat has no recommended follow-ups: Task 3 store state and Task 4 UI rendering.
  - LP task follow-ups are context/provider based, not i18n arrays: Tasks 1, 2, 3, and 4.
  - LP task composer routes ordinary question / continue / new task / clarify: Tasks 2 and 3.
  - Low-confidence or invalid model output fails closed: Tasks 1 and 2.
  - Browser-visible Manus-style behavior is preserved: Tasks 4 and 5.
- Placeholder scan:
  - No implementation step uses placeholder wording or vague edge-case instructions without exact behavior.
  - Every test step has a concrete command and expected failure/pass condition.
- Type consistency:
  - `TaskFollowupSuggestion.intent` uses only `chat_in_task | agent_continue | agent_new_task`.
  - `TaskInputIntent` includes `confidence` and `reason`, and `clarify` includes `question`.
  - Web state field is consistently `taskFollowupSuggestions`.
