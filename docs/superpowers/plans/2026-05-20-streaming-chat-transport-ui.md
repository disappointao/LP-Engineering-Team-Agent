# Streaming Chat Transport and UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe ordinary-chat streaming route and client UI while preserving the existing server action fallback and LP generation path.

**Architecture:** Keep repository facts authoritative: the streaming route creates or reuses a `general_chat` task, saves the user message and a placeholder assistant message, streams NDJSON UI events, then updates the assistant message with final content. The client shell intercepts JavaScript submits for ordinary chat, appends streamed deltas locally, and falls back exactly once to `submitPromptAction` for LP/project setup prompts.

**Tech Stack:** Next.js App Router route handlers, React client component, TypeScript, Vitest, existing `WorkbenchRepositories`, existing Web store factory.

---

## File Structure

- Create `apps/web/src/lib/chat-stream.ts`
  - Owns `ChatStreamEvent`, NDJSON encode/decode helpers, and deterministic chunking.
- Create `apps/web/src/lib/chat-stream.test.ts`
  - Unit tests for stream event encoding, partial-line decoding, and chunking.
- Modify `apps/web/src/lib/workbench-store.ts`
  - Adds `startStreamingChatPrompt()` and `completeStreamingChatPrompt()` to the Web store.
- Modify `apps/web/src/lib/workbench-store.test.ts`
  - Covers ordinary chat streaming persistence, fallback-required behavior, project validation, and id allocation.
- Create `apps/web/src/app/api/chat/stream/route.ts`
  - Exposes the NDJSON streaming endpoint and sets current task/project cookies through response headers.
- Create `apps/web/src/app/api/chat/stream/route.test.ts`
  - Route-level tests using mocked store/session behavior.
- Create `apps/web/src/app/streaming-workbench.tsx`
  - Client shell that renders server content, transient streamed turn, and composer form with fallback action.
- Create `apps/web/src/app/streaming-workbench-state.ts`
  - Pure reducer for streamed UI state so client behavior can be tested without React DOM.
- Create `apps/web/src/app/streaming-workbench-state.test.ts`
  - Tests reducer behavior for delta append, completion, error, and fallback-required.
- Modify `apps/web/src/app/page.tsx`
  - Uses `StreamingWorkbench` for the workbench view and preserves existing fallback action.
- Modify `apps/web/src/app/page.test.ts`
  - Teaches test helpers to inspect `StreamingWorkbench` output and verifies fallback form payload remains present.
- Modify `apps/web/src/app/globals.css`
  - Adds small transient streaming turn styles.
- Modify `apps/web/src/lib/i18n.ts` and `apps/web/src/lib/i18n.test.ts`
  - Adds labels for streaming status and safe streaming error copy.
- Modify `docs/project-roadmap.md`, `docs/agent-development-learning.md`, and `docs/superpowers/README.md`
  - Mark the Stage 26 implementation plan and later completion notes.

## Task 1: Stream Event Contract

**Files:**
- Create: `apps/web/src/lib/chat-stream.ts`
- Create: `apps/web/src/lib/chat-stream.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/chat-stream.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  chunkAssistantText,
  decodeChatStreamLines,
  encodeChatStreamEvent,
  type ChatStreamEvent
} from "./chat-stream";

describe("chat stream contract", () => {
  it("encodes events as newline-delimited JSON", () => {
    const event: ChatStreamEvent = {
      type: "assistant.delta",
      taskId: "task_1",
      messageId: "message_2",
      delta: "hello"
    };

    expect(encodeChatStreamEvent(event)).toBe(
      '{"type":"assistant.delta","taskId":"task_1","messageId":"message_2","delta":"hello"}\n'
    );
  });

  it("decodes complete lines and preserves a partial remainder", () => {
    const decoded = decodeChatStreamLines(
      '{"type":"run.status","taskId":"task_1","state":"running","label":"Running"}\n{"type"'
    );

    expect(decoded.events).toEqual([
      {
        type: "run.status",
        taskId: "task_1",
        state: "running",
        label: "Running"
      }
    ]);
    expect(decoded.remainder).toBe('{"type"');
  });

  it("chunks assistant text without dropping whitespace", () => {
    expect(chunkAssistantText("hello world", 5)).toEqual(["hello", " worl", "d"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/chat-stream.test.ts
```

Expected: FAIL because `apps/web/src/lib/chat-stream.ts` does not exist.

- [ ] **Step 3: Implement the stream contract helper**

Create `apps/web/src/lib/chat-stream.ts`:

```ts
export type ChatStreamEvent =
  | {
      type: "task.created";
      taskId: string;
      projectId?: string;
    }
  | {
      type: "assistant.delta";
      taskId: string;
      messageId: string;
      delta: string;
    }
  | {
      type: "assistant.completed";
      taskId: string;
      messageId: string;
      content: string;
    }
  | {
      type: "run.status";
      taskId: string;
      state: "queued" | "running" | "completed" | "failed";
      label: string;
    }
  | {
      type: "fallback.required";
      reason: "unsupported_task_type";
      taskType: "lp_generation" | "project_setup";
      message: string;
    }
  | {
      type: "error";
      code: "prompt_required" | "project_not_found" | "generation_failed";
      message: string;
    };

export function encodeChatStreamEvent(event: ChatStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function decodeChatStreamLines(input: string): {
  events: ChatStreamEvent[];
  remainder: string;
} {
  const lines = input.split("\n");
  const remainder = lines.pop() ?? "";
  const events = lines
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ChatStreamEvent);
  return { events, remainder };
}

export function chunkAssistantText(content: string, chunkSize = 16): string[] {
  if (chunkSize < 1) {
    throw new Error("chat_stream_chunk_size_invalid");
  }
  const chunks: string[] = [];
  for (let index = 0; index < content.length; index += chunkSize) {
    chunks.push(content.slice(index, index + chunkSize));
  }
  return chunks.length > 0 ? chunks : [""];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/chat-stream.test.ts
```

Expected: PASS with 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/chat-stream.ts apps/web/src/lib/chat-stream.test.ts
git commit -m "add chat stream event contract"
```

## Task 2: Web Store Streaming Chat Helper

**Files:**
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`

- [ ] **Step 1: Write failing store tests**

Append these tests near the existing `submitTaskPrompt` tests in `apps/web/src/lib/workbench-store.test.ts`:

```ts
describe("streaming chat prompt", () => {
  it("starts an ordinary chat stream and persists refreshable messages", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });

    const started = await store.startStreamingChatPrompt({
      projectId: null,
      taskId: null,
      prompt: "Help me write a campaign plan."
    });

    expect(started.ok).toBe(true);
    if (!started.ok) {
      throw new Error("expected streaming chat start to succeed");
    }
    expect(started.taskType).toBe("general_chat");
    expect(started.chunks.join("")).toBe(started.assistantContent);

    await expect(
      store.completeStreamingChatPrompt({
        taskId: started.taskId,
        messageId: started.assistantMessageId,
        content: started.assistantContent
      })
    ).resolves.toEqual({ ok: true });

    const pageState = await store.getPageState({ taskId: started.taskId });
    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("expected task_ready page state");
    }
    expect(pageState.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(pageState.messages[0]?.content).toBe("Help me write a campaign plan.");
    expect(pageState.messages[1]?.content).toBe(started.assistantContent);
  });

  it("returns fallback_required for LP prompts without creating messages", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });

    const started = await store.startStreamingChatPrompt({
      projectId: null,
      taskId: null,
      prompt: "Create an ecommerce LP in HTML."
    });

    expect(started).toEqual({
      ok: false,
      error: "fallback_required",
      taskType: "lp_generation"
    });
    await expect(repositories.messages.listAll()).resolves.toEqual([]);
  });

  it("rejects a missing project before saving streaming messages", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });

    await expect(
      store.startStreamingChatPrompt({
        projectId: "missing_project",
        taskId: null,
        prompt: "Hello"
      })
    ).resolves.toEqual({ ok: false, error: "project_not_found" });
    await expect(repositories.messages.listAll()).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run the store tests to verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts -- -t "streaming chat prompt"
```

Expected: FAIL because `startStreamingChatPrompt` and `completeStreamingChatPrompt` are not defined on `WebWorkbenchStore`.

- [ ] **Step 3: Add store result types and interface methods**

In `apps/web/src/lib/workbench-store.ts`, add these imports and types:

```ts
import { chunkAssistantText } from "./chat-stream";
```

Add near `SubmitTaskResult`:

```ts
export type StreamingChatStartResult =
  | {
      ok: true;
      taskId: string;
      taskType: "general_chat";
      projectId?: string;
      userMessageId: string;
      assistantMessageId: string;
      assistantContent: string;
      chunks: string[];
    }
  | { ok: false; error: ProjectFlowErrorCode }
  | {
      ok: false;
      error: "fallback_required";
      taskType: Exclude<TaskType, "general_chat">;
    };

export type StreamingChatCompleteResult =
  | { ok: true }
  | { ok: false; error: ProjectFlowErrorCode };
```

Add to `WebWorkbenchStore`:

```ts
  startStreamingChatPrompt(input: {
    projectId?: string | null;
    taskId?: string | null;
    prompt: string;
  }): Promise<StreamingChatStartResult>;
  completeStreamingChatPrompt(input: {
    taskId: string;
    messageId: string;
    content: string;
  }): Promise<StreamingChatCompleteResult>;
```

- [ ] **Step 4: Implement the store methods**

Inside `createWebWorkbenchStore()` return object, add methods before `submitTaskPrompt`:

```ts
    async startStreamingChatPrompt(input) {
      const prompt = validatePromptInput(input.prompt);
      if (!prompt.ok) {
        return { ok: false, error: prompt.error };
      }

      const taskType = classifyTaskPrompt(prompt.value);
      if (taskType !== "general_chat") {
        return { ok: false, error: "fallback_required", taskType };
      }

      const requestedProjectId = input.projectId ?? undefined;
      if (requestedProjectId && !(await repositories.projects.getById(requestedProjectId))) {
        return { ok: false, error: "project_not_found" };
      }

      const assistantContent = "I created a task thread and can continue from here.";
      const started = await startStreamingChatThread({
        repositories,
        taskId: input.taskId ?? undefined,
        title: deriveTaskTitle(prompt.value),
        projectId: requestedProjectId,
        userMessage: prompt.value,
        assistantMessage: ""
      });

      return {
        ok: true,
        taskId: started.task.id,
        taskType: "general_chat",
        ...(started.task.projectId ? { projectId: started.task.projectId } : {}),
        userMessageId: started.userMessage.id,
        assistantMessageId: started.assistantMessage.id,
        assistantContent,
        chunks: chunkAssistantText(assistantContent, 12)
      };
    },

    async completeStreamingChatPrompt(input) {
      const task = await repositories.tasks.getById(input.taskId);
      if (!task) {
        return { ok: false, error: "generation_failed" };
      }
      const messages = await repositories.messages.listForTask(input.taskId);
      const assistant = messages.find(
        (message) => message.id === input.messageId && message.role === "assistant"
      );
      if (!assistant) {
        return { ok: false, error: "generation_failed" };
      }
      await repositories.messages.save({
        ...assistant,
        content: input.content,
        createdAt: assistant.createdAt
      });
      return { ok: true };
    },
```

Add helper near `saveTaskThread()`:

```ts
async function startStreamingChatThread(input: {
  repositories: WorkbenchRepositories;
  taskId?: string;
  title: string;
  projectId?: string;
  userMessage: string;
  assistantMessage: string;
}): Promise<{
  task: TaskRecord;
  userMessage: ChatMessageRecord;
  assistantMessage: ChatMessageRecord;
}> {
  return withRepositoryTaskLock(input.repositories, async () => {
    const now = new Date().toISOString();
    const existingTasks = await input.repositories.tasks.listAll();
    const existingMessages = await input.repositories.messages.listAll();
    const existingTask = input.taskId
      ? await input.repositories.tasks.getById(input.taskId)
      : undefined;
    const task: TaskRecord =
      existingTask && existingTask.type === "general_chat"
        ? existingTask
        : {
            id: nextSequentialId("task", existingTasks.map((record) => record.id)),
            title: input.title,
            type: "general_chat",
            status: "complete",
            ...(input.projectId ? { projectId: input.projectId } : {}),
            createdAt: now
          };
    const userMessage: ChatMessageRecord = {
      id: nextSequentialId("message", existingMessages.map((record) => record.id)),
      taskId: task.id,
      role: "user",
      content: input.userMessage,
      createdAt: now
    };
    const assistantMessage: ChatMessageRecord = {
      id: nextSequentialId(
        "message",
        [...existingMessages.map((record) => record.id), userMessage.id]
      ),
      taskId: task.id,
      role: "assistant",
      content: input.assistantMessage,
      createdAt: now
    };

    await input.repositories.tasks.save(task);
    await input.repositories.messages.save(userMessage);
    await input.repositories.messages.save(assistantMessage);

    return {
      task: { ...task },
      userMessage: { ...userMessage },
      assistantMessage: { ...assistantMessage }
    };
  });
}
```

- [ ] **Step 5: Run the store tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts -- -t "streaming chat prompt"
```

Expected: PASS for the new streaming chat prompt tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts
git commit -m "add streaming chat store helper"
```

## Task 3: Streaming Route Handler

**Files:**
- Create: `apps/web/src/app/api/chat/stream/route.ts`
- Create: `apps/web/src/app/api/chat/stream/route.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `apps/web/src/app/api/chat/stream/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeChatStreamLines } from "../../../../lib/chat-stream";

const routeMocks = vi.hoisted(() => ({
  currentProjectId: undefined as string | undefined,
  currentTaskId: undefined as string | undefined,
  startStreamingChatPrompt: vi.fn(),
  completeStreamingChatPrompt: vi.fn()
}));

vi.mock("../../../../lib/workbench-store", () => ({
  getWebWorkbenchStore: vi.fn(async () => ({
    startStreamingChatPrompt: routeMocks.startStreamingChatPrompt,
    completeStreamingChatPrompt: routeMocks.completeStreamingChatPrompt
  }))
}));

vi.mock("../../../../lib/workbench-session", () => ({
  CURRENT_PROJECT_COOKIE: "lp-agent-current-project",
  CURRENT_TASK_COOKIE: "lp-agent-current-task",
  getCurrentProjectId: vi.fn(async () => routeMocks.currentProjectId),
  getCurrentTaskId: vi.fn(async () => routeMocks.currentTaskId)
}));

import { POST } from "./route";

async function readEvents(response: Response) {
  const body = await response.text();
  return decodeChatStreamLines(body).events;
}

describe("chat stream route", () => {
  beforeEach(() => {
    routeMocks.currentProjectId = undefined;
    routeMocks.currentTaskId = undefined;
    routeMocks.startStreamingChatPrompt.mockReset();
    routeMocks.completeStreamingChatPrompt.mockReset();
    routeMocks.completeStreamingChatPrompt.mockResolvedValue({ ok: true });
  });

  it("streams task, status, deltas, and completion events", async () => {
    routeMocks.startStreamingChatPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_1",
      taskType: "general_chat",
      userMessageId: "message_1",
      assistantMessageId: "message_2",
      assistantContent: "Hello there",
      chunks: ["Hello", " there"]
    });

    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        body: JSON.stringify({ prompt: "Hello" })
      })
    );

    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(response.headers.get("set-cookie")).toContain("lp-agent-current-task=task_1");
    await expect(readEvents(response)).resolves.toEqual([
      { type: "task.created", taskId: "task_1" },
      { type: "run.status", taskId: "task_1", state: "running", label: "Generating response" },
      { type: "assistant.delta", taskId: "task_1", messageId: "message_2", delta: "Hello" },
      { type: "assistant.delta", taskId: "task_1", messageId: "message_2", delta: " there" },
      {
        type: "assistant.completed",
        taskId: "task_1",
        messageId: "message_2",
        content: "Hello there"
      },
      { type: "run.status", taskId: "task_1", state: "completed", label: "Response complete" }
    ]);
  });

  it("returns fallback_required for unsupported task types", async () => {
    routeMocks.startStreamingChatPrompt.mockResolvedValue({
      ok: false,
      error: "fallback_required",
      taskType: "lp_generation"
    });

    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        body: JSON.stringify({ prompt: "Create LP" })
      })
    );

    await expect(readEvents(response)).resolves.toEqual([
      {
        type: "fallback.required",
        reason: "unsupported_task_type",
        taskType: "lp_generation",
        message: "Use the standard task flow for this prompt."
      }
    ]);
    expect(routeMocks.completeStreamingChatPrompt).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run route tests to verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/app/api/chat/stream/route.test.ts
```

Expected: FAIL because the route file does not exist.

- [ ] **Step 3: Implement route handler**

Create `apps/web/src/app/api/chat/stream/route.ts`:

```ts
import {
  encodeChatStreamEvent,
  type ChatStreamEvent
} from "../../../../lib/chat-stream";
import { getWebWorkbenchStore } from "../../../../lib/workbench-store";
import {
  CURRENT_PROJECT_COOKIE,
  CURRENT_TASK_COOKIE,
  getCurrentProjectId,
  getCurrentTaskId
} from "../../../../lib/workbench-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let payload: { prompt?: unknown; projectId?: unknown; taskId?: unknown };
  try {
    payload = (await request.json()) as { prompt?: unknown; projectId?: unknown; taskId?: unknown };
  } catch {
    return streamEvents([
      { type: "error", code: "generation_failed", message: "Unable to read chat request." }
    ]);
  }

  const store = await getWebWorkbenchStore();
  const currentProjectId = await getCurrentProjectId();
  const currentTaskId = await getCurrentTaskId();
  const started = await store.startStreamingChatPrompt({
    projectId: stringOrUndefined(payload.projectId) ?? currentProjectId ?? null,
    taskId: stringOrUndefined(payload.taskId) ?? currentTaskId ?? null,
    prompt: String(payload.prompt ?? "")
  });

  if (!started.ok) {
    if (started.error === "fallback_required") {
      return streamEvents([
        {
          type: "fallback.required",
          reason: "unsupported_task_type",
          taskType: started.taskType,
          message: "Use the standard task flow for this prompt."
        }
      ]);
    }
    return streamEvents([
      {
        type: "error",
        code: started.error,
        message: safeErrorMessage(started.error)
      }
    ]);
  }

  const events: ChatStreamEvent[] = [
    {
      type: "task.created",
      taskId: started.taskId,
      ...(started.projectId ? { projectId: started.projectId } : {})
    },
    {
      type: "run.status",
      taskId: started.taskId,
      state: "running",
      label: "Generating response"
    },
    ...started.chunks.map((delta) => ({
      type: "assistant.delta" as const,
      taskId: started.taskId,
      messageId: started.assistantMessageId,
      delta
    }))
  ];

  const completed = await store.completeStreamingChatPrompt({
    taskId: started.taskId,
    messageId: started.assistantMessageId,
    content: started.assistantContent
  });
  if (!completed.ok) {
    events.push({
      type: "error",
      code: completed.error,
      message: safeErrorMessage(completed.error)
    });
  } else {
    events.push(
      {
        type: "assistant.completed",
        taskId: started.taskId,
        messageId: started.assistantMessageId,
        content: started.assistantContent
      },
      {
        type: "run.status",
        taskId: started.taskId,
        state: "completed",
        label: "Response complete"
      }
    );
  }

  return streamEvents(events, {
    taskId: started.taskId,
    projectId: started.projectId
  });
}

function streamEvents(
  events: ChatStreamEvent[],
  session?: { taskId?: string; projectId?: string }
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(encodeChatStreamEvent(event)));
      }
      controller.close();
    }
  });
  const headers = new Headers({
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store"
  });
  if (session?.taskId) {
    headers.append("set-cookie", serializeSessionCookie(CURRENT_TASK_COOKIE, session.taskId));
  }
  if (session?.projectId) {
    headers.append("set-cookie", serializeSessionCookie(CURRENT_PROJECT_COOKIE, session.projectId));
  }
  return new Response(body, { headers });
}

function serializeSessionCookie(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function safeErrorMessage(code: "prompt_required" | "project_not_found" | "generation_failed"): string {
  if (code === "prompt_required") {
    return "Enter a prompt before sending.";
  }
  if (code === "project_not_found") {
    return "The selected project is unavailable.";
  }
  return "The chat response could not be generated.";
}
```

- [ ] **Step 4: Run route tests**

Run:

```bash
pnpm exec vitest run apps/web/src/app/api/chat/stream/route.test.ts
```

Expected: PASS for the route tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/chat/stream/route.ts apps/web/src/app/api/chat/stream/route.test.ts
git commit -m "add chat streaming route"
```

## Task 4: Client Streaming State

**Files:**
- Create: `apps/web/src/app/streaming-workbench-state.ts`
- Create: `apps/web/src/app/streaming-workbench-state.test.ts`

- [ ] **Step 1: Write failing reducer tests**

Create `apps/web/src/app/streaming-workbench-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createInitialStreamingWorkbenchState,
  reduceStreamingWorkbenchEvent
} from "./streaming-workbench-state";

describe("streaming workbench state", () => {
  it("appends assistant deltas and completes the turn", () => {
    const initial = createInitialStreamingWorkbenchState();
    const withTask = reduceStreamingWorkbenchEvent(initial, {
      type: "task.created",
      taskId: "task_1"
    });
    const withDelta = reduceStreamingWorkbenchEvent(withTask, {
      type: "assistant.delta",
      taskId: "task_1",
      messageId: "message_2",
      delta: "Hello"
    });
    const completed = reduceStreamingWorkbenchEvent(withDelta, {
      type: "assistant.completed",
      taskId: "task_1",
      messageId: "message_2",
      content: "Hello"
    });

    expect(completed.status).toBe("completed");
    expect(completed.assistantContent).toBe("Hello");
  });

  it("marks fallback requests without treating them as errors", () => {
    const state = reduceStreamingWorkbenchEvent(createInitialStreamingWorkbenchState(), {
      type: "fallback.required",
      reason: "unsupported_task_type",
      taskType: "lp_generation",
      message: "Use fallback"
    });

    expect(state.status).toBe("fallback_required");
    expect(state.errorMessage).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run reducer tests to verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/app/streaming-workbench-state.test.ts
```

Expected: FAIL because `streaming-workbench-state.ts` does not exist.

- [ ] **Step 3: Implement reducer**

Create `apps/web/src/app/streaming-workbench-state.ts`:

```ts
import type { ChatStreamEvent } from "../lib/chat-stream";

export interface StreamingWorkbenchState {
  status: "idle" | "streaming" | "completed" | "error" | "fallback_required";
  taskId?: string;
  assistantMessageId?: string;
  assistantContent: string;
  errorMessage?: string;
}

export function createInitialStreamingWorkbenchState(): StreamingWorkbenchState {
  return {
    status: "idle",
    assistantContent: ""
  };
}

export function reduceStreamingWorkbenchEvent(
  state: StreamingWorkbenchState,
  event: ChatStreamEvent
): StreamingWorkbenchState {
  if (event.type === "task.created") {
    return {
      ...state,
      status: "streaming",
      taskId: event.taskId
    };
  }
  if (event.type === "assistant.delta") {
    return {
      ...state,
      status: "streaming",
      taskId: event.taskId,
      assistantMessageId: event.messageId,
      assistantContent: `${state.assistantContent}${event.delta}`
    };
  }
  if (event.type === "assistant.completed") {
    return {
      ...state,
      status: "completed",
      taskId: event.taskId,
      assistantMessageId: event.messageId,
      assistantContent: event.content
    };
  }
  if (event.type === "fallback.required") {
    return {
      ...state,
      status: "fallback_required"
    };
  }
  if (event.type === "error") {
    return {
      ...state,
      status: "error",
      errorMessage: event.message
    };
  }
  return state;
}
```

- [ ] **Step 4: Run reducer tests**

Run:

```bash
pnpm exec vitest run apps/web/src/app/streaming-workbench-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/streaming-workbench-state.ts apps/web/src/app/streaming-workbench-state.test.ts
git commit -m "add streaming workbench state reducer"
```

## Task 5: Client Streaming Workbench Shell

**Files:**
- Create: `apps/web/src/app/streaming-workbench.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`

- [ ] **Step 1: Add i18n tests**

In `apps/web/src/lib/i18n.test.ts`, add:

```ts
it("contains streaming chat labels", () => {
  expect(en.chat.streamingStatusLabel).toBe("Generating response");
  expect(zh.chat.streamingStatusLabel).toBe("正在生成回复");
  expect(en.chat.streamingErrorLabel).toBe("The chat response could not be generated.");
  expect(zh.chat.streamingErrorLabel).toBe("聊天回复生成失败。");
});
```

- [ ] **Step 2: Run i18n test to verify it fails**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts -- -t "streaming chat labels"
```

Expected: FAIL because the labels do not exist.

- [ ] **Step 3: Add i18n labels**

In both locale objects in `apps/web/src/lib/i18n.ts`, add to `chat`:

```ts
streamingStatusLabel: "Generating response",
streamingErrorLabel: "The chat response could not be generated.",
```

For Chinese:

```ts
streamingStatusLabel: "正在生成回复",
streamingErrorLabel: "聊天回复生成失败。",
```

Update the exported chat copy type if the file has an explicit interface for `chat`.

- [ ] **Step 4: Create client component**

Create `apps/web/src/app/streaming-workbench.tsx`:

```tsx
"use client";

import React, { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decodeChatStreamLines } from "../lib/chat-stream";
import {
  createInitialStreamingWorkbenchState,
  reduceStreamingWorkbenchEvent
} from "./streaming-workbench-state";

interface StreamingWorkbenchProps {
  children: React.ReactNode;
  action: (formData: FormData) => Promise<void>;
  projectId?: string;
  taskId?: string;
  implicitProjectName: string;
  promptLabel: string;
  placeholder: string;
  addAttachmentLabel: string;
  runtimeChip: string;
  sendLabel: string;
  streamingStatusLabel: string;
  streamingErrorLabel: string;
  interruptControl: React.ReactNode;
}

export function StreamingWorkbench(props: StreamingWorkbenchProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const skipStreamingOnce = useRef(false);
  const [state, setState] = useState(createInitialStreamingWorkbenchState());
  const [userPreview, setUserPreview] = useState("");
  const [isPending, startTransition] = useTransition();
  const isBusy = state.status === "streaming" || isPending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (skipStreamingOnce.current) {
      skipStreamingOnce.current = false;
      return;
    }
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const prompt = String(formData.get("prompt") ?? "");
    setUserPreview(prompt);
    setState(createInitialStreamingWorkbenchState());

    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        projectId: formData.get("projectId"),
        taskId: formData.get("taskId")
      })
    });
    const reader = response.body?.getReader();
    if (!reader) {
      setState({
        ...createInitialStreamingWorkbenchState(),
        status: "error",
        errorMessage: props.streamingErrorLabel
      });
      return;
    }
    const decoder = new TextDecoder();
    let remainder = "";
    while (true) {
      const read = await reader.read();
      if (read.done) {
        break;
      }
      const decoded = decodeChatStreamLines(`${remainder}${decoder.decode(read.value)}`);
      remainder = decoded.remainder;
      for (const streamEvent of decoded.events) {
        if (streamEvent.type === "fallback.required") {
          skipStreamingOnce.current = true;
          formRef.current?.requestSubmit();
          return;
        }
        setState((current) => reduceStreamingWorkbenchEvent(current, streamEvent));
      }
    }
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <>
      {props.children}
      {state.status !== "idle" ? (
        <section className="streamingTurn" aria-live="polite">
          {userPreview ? <div className="messageBubble userMessage">{userPreview}</div> : null}
          <article className="assistantTurn">
            <div className="assistantMessage">
              <p className="streamingStatus">{props.streamingStatusLabel}</p>
              {state.errorMessage ? (
                <div className="formError" role="alert">{state.errorMessage}</div>
              ) : (
                <p>{state.assistantContent}</p>
              )}
            </div>
          </article>
        </section>
      ) : null}
      <form ref={formRef} action={props.action} onSubmit={handleSubmit} className="composerDock">
        <input name="projectId" type="hidden" value={props.projectId ?? ""} />
        <input name="taskId" type="hidden" value={props.taskId ?? ""} />
        <input name="implicitProjectName" type="hidden" value={props.implicitProjectName} />
        <div className="composer">
          <button type="button" aria-label={props.addAttachmentLabel}>+</button>
          <input aria-label={props.promptLabel} name="prompt" placeholder={props.placeholder} />
          <span>{props.runtimeChip}</span>
          {props.interruptControl}
          <button type="submit" className="sendButton" disabled={isBusy}>
            {props.sendLabel}
          </button>
        </div>
      </form>
    </>
  );
}
```

- [ ] **Step 5: Wire `StreamingWorkbench` into page**

In `apps/web/src/app/page.tsx`, import:

```ts
import { StreamingWorkbench } from "./streaming-workbench";
```

Replace the bottom composer form with `StreamingWorkbench` around the existing workbench content. Keep non-workbench views unchanged. In practice, move the existing `activeView === "workbench"` content block into a local `workbenchContent` variable, render that variable as `StreamingWorkbench` children, and remove the old duplicate `<form action={submitPromptAction} className="composerDock">` block. The wrapper props must be:

```tsx
<StreamingWorkbench
  action={submitPromptAction}
  projectId={activeProject?.id}
  taskId={pageState.kind === "task_ready" ? pageState.activeTaskId : undefined}
  implicitProjectName={copy.entry.implicitProjectName}
  promptLabel={copy.projectFlow.promptLabel}
  placeholder={pageState.kind === "empty" ? copy.entry.placeholder : composer.placeholder}
  addAttachmentLabel={composer.addAttachmentLabel}
  runtimeChip={composer.runtimeChip}
  sendLabel={composer.sendLabel}
  streamingStatusLabel={copy.chat.streamingStatusLabel}
  streamingErrorLabel={copy.chat.streamingErrorLabel}
  interruptControl={(
    <InterruptSubmitButton
      action={interruptCurrentTaskAction}
      state={pageState.kind === "task_ready" ? pageState.interrupt.state : "not_interruptible"}
      labels={{
        idle: composer.interruptLabel,
        stopping: copy.chat.interruptStoppingLabel,
        unavailable: copy.chat.interruptUnavailableLabel
      }}
    />
  )}
>
  {workbenchContent}
</StreamingWorkbench>
```

The `workbenchContent` variable should contain the current error blocks, entry state, active task chat, recovery, artifact cards, preview, and suggestions exactly as they render today.

- [ ] **Step 6: Update page tests for the client wrapper**

In `apps/web/src/app/page.test.ts`, import `StreamingWorkbench` and add a helper that collects client component props without executing the component:

```ts
import { StreamingWorkbench } from "./streaming-workbench";
```

Add helper:

```ts
function collectStreamingWorkbenchProps(node: unknown): Array<Record<string, unknown>> {
  if (node === null || node === undefined || typeof node === "boolean") {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap(collectStreamingWorkbenchProps);
  }
  if (typeof node === "object" && "type" in node && "props" in node) {
    const element = node as { type?: unknown; props?: { children?: unknown } };
    return [
      ...(element.type === StreamingWorkbench ? [element.props as Record<string, unknown>] : []),
      ...collectStreamingWorkbenchProps(element.props?.children)
    ];
  }
  return [];
}
```

Add a page test:

```ts
it("passes fallback action and task context to the streaming workbench shell", async () => {
  pageMocks.currentProjectId = "project_1";
  pageMocks.currentTaskId = "task_1";
  pageMocks.pageState = {
    ...pageMocks.pageState,
    kind: "task_ready",
    activeTaskId: "task_1",
    task: {
      id: "task_1",
      title: "Campaign",
      type: "general_chat",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-20T00:00:00.000Z"
    },
    messages: [],
    runEvents: [],
    interrupt: unavailableInterrupt,
    recovery: { runs: [] }
  } as unknown;

  const page = await HomePage({ searchParams: Promise.resolve({}) });
  const shells = collectStreamingWorkbenchProps(page);

  expect(shells).toHaveLength(1);
  expect(shells[0]?.action).toBe(submitPromptAction);
  expect(shells[0]?.projectId).toBe("project_1");
  expect(shells[0]?.taskId).toBe("task_1");
});
```

- [ ] **Step 7: Add CSS**

In `apps/web/src/app/globals.css`, add:

```css
.streamingTurn {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.streamingStatus {
  color: #586174;
  font-size: 0.86rem;
  margin: 0 0 8px;
}

.sendButton:disabled {
  cursor: wait;
  opacity: 0.7;
}
```

- [ ] **Step 8: Run targeted page/i18n tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts apps/web/src/app/page.test.ts apps/web/src/app/streaming-workbench-state.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app/streaming-workbench.tsx apps/web/src/app/streaming-workbench-state.ts apps/web/src/app/streaming-workbench-state.test.ts apps/web/src/app/page.tsx apps/web/src/app/page.test.ts apps/web/src/app/globals.css apps/web/src/lib/i18n.ts apps/web/src/lib/i18n.test.ts
git commit -m "wire streaming chat composer"
```

## Task 6: Integration Verification and Docs

**Files:**
- Modify: `docs/project-roadmap.md`
- Modify: `docs/agent-development-learning.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Run targeted regression tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/chat-stream.test.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/app/api/chat/stream/route.test.ts apps/web/src/app/streaming-workbench-state.test.ts apps/web/src/app/page.test.ts apps/web/src/lib/i18n.test.ts
```

Expected: PASS for all listed files.

- [ ] **Step 2: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
```

Expected: `pnpm test` passes all non-skipped tests, and `pnpm typecheck` exits 0.

- [ ] **Step 3: Update roadmap completion status**

In `docs/project-roadmap.md`, update Stage 26:

```md
**状态：** 已实现。
```

Add implemented notes:

```md
已实现范围：

- 普通聊天新增 NDJSON streaming route 和 client-side composer shell。
- Stream completion 后 task/message repository 仍是刷新恢复事实来源。
- LP generation 和 project setup prompt 通过 `fallback.required` 继续走现有 `submitPromptAction`。
- Streaming payload 只包含安全 UI event，不包含 raw model/tool/artifact/secret 数据。
```

Move Stage 27 to current recommended next stage if it is not already first in the queue.

- [ ] **Step 4: Update Agent learning note**

In `docs/agent-development-learning.md`, update the Stage 26 sentence to past tense:

```md
- Stage 26 Streaming Chat Transport and UI v0 已实现普通聊天 streaming route / UI event contract，并保留现有 server action fallback。这个阶段只做 Web/API 实时反馈边界，没有把 LP chain、MCP/tool-call streaming 或真实 provider token streaming 混入同一阶段。
```

- [ ] **Step 5: Update Superpowers index with implementation plan status**

In `docs/superpowers/README.md`, add or update the Stage 26 plan entry:

```md
81. `plans/2026-05-20-streaming-chat-transport-ui.md`
   - Stage 26 Streaming Chat Transport and UI v0 implementation plan。
   - 在 Stage 26 design 后阅读，用于按 TDD 实现 chat stream event contract、Web store streaming helper、NDJSON route、client streaming composer、fallback handling、tests 和文档收尾。
```

- [ ] **Step 6: Verify docs**

Run:

```bash
git diff --check
rg -n "streaming-chat-transport-ui|Stage 26|fallback.required" docs/project-roadmap.md docs/agent-development-learning.md docs/superpowers/README.md docs/superpowers/specs/2026-05-20-streaming-chat-transport-ui-design.md docs/superpowers/plans/2026-05-20-streaming-chat-transport-ui.md
```

Expected: `git diff --check` prints no output; `rg` finds the Stage 26 spec, plan, roadmap, and learning references.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src docs/project-roadmap.md docs/agent-development-learning.md docs/superpowers/README.md docs/superpowers/plans/2026-05-20-streaming-chat-transport-ui.md
git commit -m "add streaming chat transport ui"
```

## Self-Review

- Spec coverage: The plan covers the stream event contract, route handler, store persistence, client UI, fallback handling, safety boundaries, tests, and docs required by the Stage 26 spec.
- Scope check: The plan does not implement real provider token streaming, LP agent chain streaming, MCP, tool-call streaming, raw stdout/stderr streaming, auth/RBAC, production deployment, or object storage.
- Type consistency: The plan uses `ChatStreamEvent`, `StreamingChatStartResult`, `StreamingChatCompleteResult`, `fallback.required`, `startStreamingChatPrompt()`, and `completeStreamingChatPrompt()` consistently across helper, route, reducer, and client tasks.
