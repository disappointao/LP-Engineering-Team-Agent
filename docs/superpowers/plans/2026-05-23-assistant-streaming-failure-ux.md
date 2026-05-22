# Stage 38 Assistant Streaming Failure UX Hardening v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ordinary chat provider streaming failures understandable, safe, and refresh-consistent for internal alpha users.

**Architecture:** Keep provider token chunks transient and classify only terminal failures. `packages/api` owns runtime failure classification, `/api/chat/stream` maps it to safe NDJSON events, and Web state renders localized typed errors without turning partial deltas into persisted facts.

**Tech Stack:** TypeScript, Vitest, Next.js route handlers, existing `@lp-agent/api` service/runtime adapters, existing Web reducer/i18n patterns.

---

## File Structure

- Modify `packages/api/src/index.ts`
  - Add `AssistantChatStreamFailureCode` and `AssistantChatStreamError`.
  - Classify streaming terminal failures from safe run events.
  - Normalize completed-but-empty streaming results to failed terminal facts.
- Modify `packages/api/src/services.test.ts`
  - Add streaming failure regressions for provider configuration, interrupted stream, and empty terminal output.
- Modify `apps/web/src/lib/chat-stream.ts`
  - Add typed chat stream error codes and parser validation.
- Modify `apps/web/src/lib/chat-stream.test.ts`
  - Lock valid/invalid typed stream error decoding.
- Modify `apps/web/src/lib/i18n.ts`
  - Add localized `chat.streamingErrorMessages`.
- Modify `apps/web/src/lib/i18n.test.ts`
  - Lock English and Chinese typed error copy.
- Modify `apps/web/src/app/api/chat/stream/route.ts`
  - Emit typed terminal errors and avoid persisting cancelled/empty stream content.
- Modify `apps/web/src/app/api/chat/stream/route.test.ts`
  - Cover stream interruption, empty response, persistence failure, and cancellation.
- Modify `apps/web/src/app/streaming-workbench-state.ts`
  - Store typed error code and running status label.
- Modify `apps/web/src/app/streaming-workbench-state.test.ts`
  - Cover typed error and running status state.
- Modify `apps/web/src/app/streaming-workbench.tsx`
  - Render localized typed error copy and status-only slow-token assistant turns.
- Modify `apps/web/src/app/streaming-workbench.test.ts`
  - Cover visible status copy and localized typed error rendering helpers.
- Modify `apps/web/src/app/page.tsx`
  - Pass typed error copy map to `StreamingWorkbench`.
- Modify `apps/web/src/app/page.test.ts`
  - Update prop assertions for the new copy map.
- Modify `docs/real-provider-alpha-smoke.md`
  - Add ordinary chat streaming failure troubleshooting.
- Modify `docs/project-roadmap.md`
  - Close Stage 38 and refresh recommended queue.
- Modify `docs/superpowers/README.md`
  - Add this plan to the reading order.
- Modify `docs/agent-development-learning.md`
  - Only adjust if implementation changes the learning note written in the spec commit.

## Task 1: Chat Stream Contract And Localized Copy

**Files:**
- Modify: `apps/web/src/lib/chat-stream.ts`
- Modify: `apps/web/src/lib/chat-stream.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`

- [ ] **Step 1: Write failing chat stream contract tests**

Add these tests to `apps/web/src/lib/chat-stream.test.ts` inside `describe("chat stream contract", ...)`:

```ts
  it("decodes typed streaming failure errors", () => {
    const decoded = decodeChatStreamLines(
      '{"type":"error","code":"stream_interrupted","message":"The provider stream stopped before the response completed."}\n'
    );

    expect(decoded.events).toEqual([
      {
        type: "error",
        code: "stream_interrupted",
        message: "The provider stream stopped before the response completed."
      }
    ]);
  });

  it("rejects unknown streaming failure error codes", () => {
    expect(() =>
      decodeChatStreamLines(
        '{"type":"error","code":"raw_provider_body","message":"unsafe"}\n'
      )
    ).toThrow("chat_stream_event_invalid");
  });
```

- [ ] **Step 2: Run contract tests and verify they fail**

Run:

```bash
pnpm vitest run apps/web/src/lib/chat-stream.test.ts
```

Expected: the first new test fails because `stream_interrupted` is not accepted by `isErrorCode`.

- [ ] **Step 3: Implement typed stream error codes**

Update `apps/web/src/lib/chat-stream.ts` by introducing a reusable error code type and extending the existing error event:

```ts
export type ChatStreamErrorCode =
  | "prompt_required"
  | "project_not_found"
  | "generation_failed"
  | "provider_configuration_failed"
  | "stream_interrupted"
  | "empty_response"
  | "persistence_failed";
```

Change the `ChatStreamEvent` error branch to:

```ts
  | {
      type: "error";
      code: ChatStreamErrorCode;
      message: string;
    };
```

Replace `isErrorCode()` with:

```ts
function isErrorCode(value: unknown): value is ChatStreamErrorCode {
  return (
    value === "prompt_required" ||
    value === "project_not_found" ||
    value === "generation_failed" ||
    value === "provider_configuration_failed" ||
    value === "stream_interrupted" ||
    value === "empty_response" ||
    value === "persistence_failed"
  );
}
```

- [ ] **Step 4: Run contract tests and verify they pass**

Run:

```bash
pnpm vitest run apps/web/src/lib/chat-stream.test.ts
```

Expected: all `chat-stream.test.ts` tests pass.

- [ ] **Step 5: Write failing i18n copy tests**

Update `apps/web/src/lib/i18n.test.ts` in the existing English and Chinese copy tests:

```ts
    expect(en.chat.streamingErrorMessages).toEqual({
      prompt_required: "Enter a prompt before sending.",
      project_not_found: "The selected project is unavailable.",
      generation_failed: "The chat response could not be generated.",
      provider_configuration_failed: "Check the project model provider configuration before retrying.",
      stream_interrupted: "The provider stream stopped before the response completed.",
      empty_response: "The provider completed without usable assistant text.",
      persistence_failed: "The response was generated but could not be saved."
    });
```

```ts
    expect(zh.chat.streamingErrorMessages).toEqual({
      prompt_required: "请先输入提示词。",
      project_not_found: "当前项目不可用。",
      generation_failed: "聊天回复生成失败。",
      provider_configuration_failed: "请检查项目模型 provider 配置后重试。",
      stream_interrupted: "Provider stream 在回复完成前中断。",
      empty_response: "Provider 已结束，但没有返回可用的 assistant 文本。",
      persistence_failed: "回复已生成，但无法保存。"
    });
```

- [ ] **Step 6: Run i18n tests and verify they fail**

Run:

```bash
pnpm vitest run apps/web/src/lib/i18n.test.ts
```

Expected: TypeScript/Vitest fails because `streamingErrorMessages` does not exist.

- [ ] **Step 7: Implement localized streaming error maps**

In `apps/web/src/lib/i18n.ts`, add a type-only import:

```ts
import type { ChatStreamErrorCode } from "./chat-stream";
```

Extend `WorkbenchCopy["chat"]` with:

```ts
    streamingErrorMessages: Record<ChatStreamErrorCode, string>;
```

Add the English map next to `streamingErrorLabel`:

```ts
      streamingErrorMessages: {
        prompt_required: "Enter a prompt before sending.",
        project_not_found: "The selected project is unavailable.",
        generation_failed: "The chat response could not be generated.",
        provider_configuration_failed: "Check the project model provider configuration before retrying.",
        stream_interrupted: "The provider stream stopped before the response completed.",
        empty_response: "The provider completed without usable assistant text.",
        persistence_failed: "The response was generated but could not be saved."
      },
```

Add the Chinese map next to `streamingErrorLabel`:

```ts
      streamingErrorMessages: {
        prompt_required: "请先输入提示词。",
        project_not_found: "当前项目不可用。",
        generation_failed: "聊天回复生成失败。",
        provider_configuration_failed: "请检查项目模型 provider 配置后重试。",
        stream_interrupted: "Provider stream 在回复完成前中断。",
        empty_response: "Provider 已结束，但没有返回可用的 assistant 文本。",
        persistence_failed: "回复已生成，但无法保存。"
      },
```

- [ ] **Step 8: Run focused tests**

Run:

```bash
pnpm vitest run apps/web/src/lib/chat-stream.test.ts apps/web/src/lib/i18n.test.ts
```

Expected: both files pass.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/chat-stream.ts apps/web/src/lib/chat-stream.test.ts apps/web/src/lib/i18n.ts apps/web/src/lib/i18n.test.ts
git commit -m "add typed streaming chat errors"
```

## Task 2: API Runtime Failure Classification

**Files:**
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/services.test.ts`

- [ ] **Step 1: Write failing service tests**

In `packages/api/src/services.test.ts`, add a helper runtime near `StreamingRuntime`:

```ts
class FailingStreamingRuntime implements AgentRuntimeAdapter {
  readonly requests: RuntimeRunRequest[] = [];

  constructor(
    private readonly deltas: string[],
    private readonly result: RuntimeRunResult
  ) {}

  async run(): Promise<RuntimeRunResult> {
    throw new Error("run_should_not_be_called_for_streaming");
  }

  async *stream(request: RuntimeRunRequest): AsyncIterable<RuntimeStreamEvent> {
    this.requests.push(request);
    for (const delta of this.deltas) {
      yield { type: "model.delta", text: delta };
    }
    yield {
      type: "completed",
      result: {
        ...this.result,
        runId: request.runId,
        projectId: request.projectId,
        role: request.role
      }
    };
  }
}
```

Add a test after the existing successful streaming assistant test:

```ts
  it("classifies interrupted assistant streams without persisting token chunks as facts", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const assistantRuntime = new FailingStreamingRuntime(["Partial "], {
      runId: "placeholder",
      projectId: "placeholder",
      role: "assistant",
      state: "failed",
      modelOutputText: undefined,
      events: [
        {
          type: "run.started",
          message: "assistant run started",
          runId: "placeholder",
          role: "assistant"
        },
        {
          type: "run.failed",
          message: "assistant model provider failed",
          runId: "placeholder",
          role: "assistant",
          state: "failed",
          errorCode: "model_provider_response_shape_invalid"
        }
      ]
    });
    const service = new DemoWorkbenchService({
      repositories,
      assistantRuntime,
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Spring Campaign" });
    await repositories.tasks.save({
      id: "task_1",
      title: "Provider chat",
      type: "general_chat",
      status: "complete",
      projectId: project.id,
      createdAt: "2026-05-12T00:00:00.000Z"
    });
    await saveStreamingAssistantRoute(repositories, project.id);

    const started = await service.runAssistantChatStream({
      projectId: project.id,
      taskId: "task_1",
      prompt: "Hello"
    });

    if (!started.ok || !started.stream) {
      throw new Error("Expected streaming assistant result");
    }
    const deltas: string[] = [];
    await expect(async () => {
      for await (const delta of started.stream) {
        deltas.push(delta);
      }
    }).rejects.toMatchObject({ code: "stream_interrupted" });

    expect(deltas).toEqual(["Partial "]);
    const events = await repositories.runEvents.listForTask("task_1");
    expect(events.map((event) => event.type)).toContain("run.failed");
    expect(JSON.stringify(events)).not.toContain("Partial ");
  });
```

Add a completed-but-empty test:

```ts
  it("classifies completed assistant streams with empty terminal text as empty_response", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const assistantRuntime = new StreamingRuntime([], "   ");
    const service = new DemoWorkbenchService({
      repositories,
      assistantRuntime,
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Empty Provider" });
    await repositories.tasks.save({
      id: "task_1",
      title: "Provider chat",
      type: "general_chat",
      status: "complete",
      projectId: project.id,
      createdAt: "2026-05-12T00:00:00.000Z"
    });
    await saveStreamingAssistantRoute(repositories, project.id);

    const started = await service.runAssistantChatStream({
      projectId: project.id,
      taskId: "task_1",
      prompt: "Hello"
    });

    if (!started.ok || !started.stream) {
      throw new Error("Expected streaming assistant result");
    }
    await expect(async () => {
      for await (const delta of started.stream) {
        expect(delta).toBe("");
      }
    }).rejects.toMatchObject({ code: "empty_response" });

    const events = await repositories.runEvents.listForTask("task_1");
    expect(events.some((event) => event.type === "run.failed")).toBe(true);
    expect(events.some((event) => event.type === "run.completed")).toBe(false);
  });
```

Update the existing missing-key test expectation:

```ts
    await expect(async () => {
      for await (const delta of stream) {
        deltas.push(delta);
      }
    }).rejects.toMatchObject({ code: "provider_configuration_failed" });
```

- [ ] **Step 2: Run service tests and verify they fail**

Run:

```bash
pnpm vitest run packages/api/src/services.test.ts
```

Expected: tests fail because stream errors are generic `assistant_stream_failed`, and empty completed streams are persisted as completed before throwing.

- [ ] **Step 3: Implement API stream failure types**

In `packages/api/src/index.ts`, add near `RunAssistantChatStreamResult`:

```ts
export type AssistantChatStreamFailureCode =
  | "provider_configuration_failed"
  | "stream_interrupted"
  | "empty_response"
  | "generation_failed";

export class AssistantChatStreamError extends Error {
  readonly code: AssistantChatStreamFailureCode;

  constructor(code: AssistantChatStreamFailureCode, message = "assistant stream failed") {
    super(message);
    this.name = "AssistantChatStreamError";
    this.code = code;
  }
}
```

- [ ] **Step 4: Normalize and classify streaming terminal results**

In `packages/api/src/index.ts`, replace the terminal handling inside `streamAssistantChatDeltas()` with this structure:

```ts
      if (!terminalResult) {
        terminalResult = createAssistantStreamFailedResult(
          input.runtimeRequest,
          "assistant_stream_interrupted"
        );
      }
      terminalResult = normalizeAssistantStreamingTerminalResult(terminalResult);
      await this.persistStreamingAssistantRun({
        startedRun,
        result: terminalResult
      });
      persistedTerminal = true;
      if (terminalResult.state !== "completed") {
        throw new AssistantChatStreamError(
          classifyAssistantStreamFailure(terminalResult)
        );
      }
```

Replace the `catch` block persistence call with:

```ts
      const failedResult = createAssistantStreamFailedResult(
        input.runtimeRequest,
        error instanceof AssistantChatStreamError
          ? `assistant_${error.code}`
          : "assistant_stream_interrupted"
      );
      if (!persistedTerminal) {
        await this.persistStreamingAssistantRun({
          startedRun,
          result: failedResult
        });
      }
      throw error instanceof AssistantChatStreamError
        ? error
        : new AssistantChatStreamError("stream_interrupted");
```

Change `createAssistantStreamFailedResult()` signature:

```ts
function createAssistantStreamFailedResult(
  request: RuntimeRunRequest,
  errorCode = "assistant_stream_failed"
): RuntimeRunResult {
```

and use the parameter in the event:

```ts
        errorCode
```

Add helpers near `createAssistantStreamFailedResult()`:

```ts
function normalizeAssistantStreamingTerminalResult(result: RuntimeRunResult): RuntimeRunResult {
  if (result.state !== "completed" || result.modelOutputText?.trim()) {
    return result;
  }

  return {
    ...result,
    state: "failed",
    events: [
      ...result.events.filter((event) => event.type !== "run.completed"),
      {
        type: "run.failed",
        message: "assistant stream completed without usable text",
        runId: result.runId,
        role: result.role ?? "assistant",
        state: "failed",
        errorCode: "assistant_empty_response"
      }
    ],
    modelOutputText: undefined
  };
}

function classifyAssistantStreamFailure(
  result: RuntimeRunResult
): AssistantChatStreamFailureCode {
  const errorCode = [...result.events]
    .reverse()
    .map((event) => event.errorCode)
    .find((code): code is string => typeof code === "string" && code.length > 0);

  if (errorCode === "assistant_empty_response") {
    return "empty_response";
  }
  if (
    errorCode === "model_provider_api_key_missing" ||
    errorCode === "model_provider_api_key_env_missing" ||
    errorCode === "model_provider_base_url_missing" ||
    errorCode === "model_provider_fetch_unavailable" ||
    errorCode === "model_route_not_configured"
  ) {
    return "provider_configuration_failed";
  }
  if (result.state === "failed") {
    return "stream_interrupted";
  }
  return "generation_failed";
}
```

- [ ] **Step 5: Run service tests and verify they pass**

Run:

```bash
pnpm vitest run packages/api/src/services.test.ts
```

Expected: all `services.test.ts` tests pass; no event JSON contains partial delta text or secrets.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/index.ts packages/api/src/services.test.ts
git commit -m "classify assistant stream failures"
```

## Task 3: Route-Level Typed Terminal Errors And Cancel Guard

**Files:**
- Modify: `apps/web/src/app/api/chat/stream/route.ts`
- Modify: `apps/web/src/app/api/chat/stream/route.test.ts`

- [ ] **Step 1: Write failing route tests**

Add this test to `apps/web/src/app/api/chat/stream/route.test.ts` near the existing provider stream test:

```ts
  it("emits stream_interrupted after partial provider deltas without completing the assistant message", async () => {
    mocks.startStreamingChatPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_stream",
      taskType: "general_chat",
      projectId: "project_1",
      userMessageId: "message_1",
      assistantMessageId: "message_2",
      assistantContent: "",
      chunks: [],
      assistantStream: (async function* () {
        yield "Partial ";
        throw Object.assign(new Error("assistant_stream_failed"), {
          code: "stream_interrupted"
        });
      })(),
      contextSummary: {
        projectId: "project_1",
        projectName: "Spring Campaign",
        runtimeMode: "real",
        skillCount: 0,
        skills: []
      }
    });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        body: JSON.stringify({ projectId: "project_1", prompt: "Hello" })
      })
    );

    const decoded = decodeChatStreamLines(await response.text());
    expect(decoded.events).toContainEqual({
      type: "assistant.delta",
      taskId: "task_stream",
      messageId: "message_2",
      delta: "Partial "
    });
    expect(decoded.events).toContainEqual({
      type: "run.status",
      taskId: "task_stream",
      state: "failed",
      label: "Provider stream interrupted"
    });
    expect(decoded.events).toContainEqual({
      type: "error",
      code: "stream_interrupted",
      message: "The provider stream stopped before the response completed."
    });
    expect(decoded.events.some((event) => event.type === "assistant.completed")).toBe(false);
    expect(mocks.completeStreamingChatPrompt).not.toHaveBeenCalled();
  });
```

Add an empty response test:

```ts
  it("emits empty_response without persisting blank assistant content", async () => {
    mocks.startStreamingChatPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_1",
      taskType: "general_chat",
      userMessageId: "message_1",
      assistantMessageId: "message_2",
      assistantContent: "   ",
      chunks: ["   "],
      contextSummary: deterministicContextSummary
    });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        body: JSON.stringify({ prompt: "Hello" })
      })
    );

    const decoded = decodeChatStreamLines(await response.text());
    expect(decoded.events).toContainEqual({
      type: "error",
      code: "empty_response",
      message: "The provider completed without usable assistant text."
    });
    expect(decoded.events.some((event) => event.type === "assistant.completed")).toBe(false);
    expect(mocks.completeStreamingChatPrompt).not.toHaveBeenCalled();
  });
```

Update the existing persistence reject test to expect:

```ts
      events: [
        {
          type: "run.status",
          taskId: "task_1",
          state: "failed",
          label: "Response persistence failed"
        },
        {
          type: "error",
          code: "persistence_failed",
          message: "The response was generated but could not be saved."
        }
      ],
```

Add a cancel guard test:

```ts
  it("does not persist provider content after the client cancels the response stream", async () => {
    const continueStream = deferred<void>();
    mocks.startStreamingChatPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_1",
      taskType: "general_chat",
      userMessageId: "message_1",
      assistantMessageId: "message_2",
      assistantContent: "",
      chunks: [],
      assistantStream: (async function* () {
        yield "Partial ";
        await continueStream.promise;
        yield "content";
      })(),
      contextSummary: deterministicContextSummary
    });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        body: JSON.stringify({ prompt: "Hello" })
      })
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) {
      return;
    }

    const initialText = await readEventTextUntil(reader, 4);
    expect(decodeChatStreamLines(initialText).events.map((event) => event.type)).toEqual([
      "task.created",
      "context.summary",
      "run.status",
      "assistant.delta"
    ]);

    await reader.cancel();
    continueStream.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.completeStreamingChatPrompt).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run route tests and verify they fail**

Run:

```bash
pnpm vitest run apps/web/src/app/api/chat/stream/route.test.ts
```

Expected: new tests fail because the route emits generic `generation_failed`, persists blank content, and does not expose a cancel guard.

- [ ] **Step 3: Add stream producer cancellation state**

In `apps/web/src/app/api/chat/stream/route.ts`, add:

```ts
type ChatStreamProducerState = {
  isClosed: () => boolean;
};
```

Change `createEventStream()` signature:

```ts
function createEventStream(
  produceEvents: (
    enqueue: ChatStreamEnqueue,
    state: ChatStreamProducerState
  ) => Promise<void> | void
): ReadableStream<Uint8Array> {
```

Call producer with the state:

```ts
        .then(() => produceEvents(enqueue, { isClosed: () => closed }))
```

Keep existing `createStreamResponse()` callers valid by accepting the second argument only where needed.

- [ ] **Step 4: Add typed route error helpers**

In `route.ts`, update the `chat-stream` import to include the exported error code type:

```ts
import {
  encodeChatStreamEvent,
  type ChatStreamErrorCode,
  type ChatStreamEvent
} from "../../../../lib/chat-stream";
```

Then extend `getSafeErrorMessage()`:

```ts
function getSafeErrorMessage(error: ChatStreamErrorCode) {
  switch (error) {
    case "prompt_required":
      return "Enter a prompt before sending.";
    case "project_not_found":
      return "The selected project is unavailable.";
    case "provider_configuration_failed":
      return "Check the project model provider configuration before retrying.";
    case "stream_interrupted":
      return "The provider stream stopped before the response completed.";
    case "empty_response":
      return "The provider completed without usable assistant text.";
    case "persistence_failed":
      return "The response was generated but could not be saved.";
    case "generation_failed":
      return "The chat response could not be generated.";
  }
}
```

Add helpers:

```ts
function toChatStreamErrorCodeFromUnknown(error: unknown): ChatStreamErrorCode {
  const code = (error as { code?: unknown })?.code;
  if (
    code === "provider_configuration_failed" ||
    code === "stream_interrupted" ||
    code === "empty_response"
  ) {
    return code;
  }
  return "generation_failed";
}

function getTerminalErrorLabel(code: ChatStreamErrorCode): string {
  switch (code) {
    case "provider_configuration_failed":
      return "Provider configuration failed";
    case "stream_interrupted":
      return "Provider stream interrupted";
    case "empty_response":
      return "Provider returned empty response";
    case "persistence_failed":
      return "Response persistence failed";
    default:
      return "Response generation failed";
  }
}

function enqueueTerminalError(
  enqueue: ChatStreamEnqueue,
  taskId: string | undefined,
  code: ChatStreamErrorCode
): void {
  if (taskId) {
    enqueue({
      type: "run.status",
      taskId,
      state: "failed",
      label: getTerminalErrorLabel(code)
    });
  }
  enqueue({
    type: "error",
    code,
    message: getSafeErrorMessage(code)
  });
}
```

- [ ] **Step 5: Guard streaming, empty content, persistence, and cancel**

In the success `createStreamResponse(async (enqueue, streamState) => { ... })` block:

1. Wrap the `assistantStream` loop in `try/catch`.
2. After each delta, return early if `streamState.isClosed()`.
3. Before persistence, return early if closed.
4. If `!assistantContent.trim()`, emit `empty_response` and return.
5. Wrap `completeStreamingChatPrompt()` in `try/catch` and emit `persistence_failed` on reject or `{ ok: false }`.

Use this structure:

```ts
    try {
      if (started.assistantStream) {
        for await (const delta of started.assistantStream) {
          assistantContent += delta;
          enqueue({
            type: "assistant.delta",
            taskId: started.taskId,
            messageId: started.assistantMessageId,
            delta
          });
          if (streamState.isClosed()) {
            return;
          }
        }
      } else {
        for (const delta of started.chunks) {
          enqueue({
            type: "assistant.delta",
            taskId: started.taskId,
            messageId: started.assistantMessageId,
            delta
          });
          if (streamState.isClosed()) {
            return;
          }
        }
      }
    } catch (error) {
      enqueueTerminalError(
        enqueue,
        started.taskId,
        toChatStreamErrorCodeFromUnknown(error)
      );
      return;
    }

    if (streamState.isClosed()) {
      return;
    }
    if (!assistantContent.trim()) {
      enqueueTerminalError(enqueue, started.taskId, "empty_response");
      return;
    }

    let completed: Awaited<ReturnType<typeof store.completeStreamingChatPrompt>>;
    try {
      completed = await store.completeStreamingChatPrompt({
        taskId: started.taskId,
        messageId: started.assistantMessageId,
        content: assistantContent
      });
    } catch {
      enqueueTerminalError(enqueue, started.taskId, "persistence_failed");
      return;
    }

    if (!completed.ok) {
      enqueueTerminalError(enqueue, started.taskId, "persistence_failed");
      return;
    }
```

When applying this snippet, keep the existing non-stream `assistantContent = started.assistantContent` behavior. Do not double-append deterministic chunks into `assistantContent`.

- [ ] **Step 6: Run route tests and verify they pass**

Run:

```bash
pnpm vitest run apps/web/src/app/api/chat/stream/route.test.ts
```

Expected: route tests pass, including existing cancellation unhandled-rejection coverage.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/api/chat/stream/route.ts apps/web/src/app/api/chat/stream/route.test.ts
git commit -m "emit typed chat stream failures"
```

## Task 4: Web Streaming State And Visible Error UX

**Files:**
- Modify: `apps/web/src/app/streaming-workbench-state.ts`
- Modify: `apps/web/src/app/streaming-workbench-state.test.ts`
- Modify: `apps/web/src/app/streaming-workbench.tsx`
- Modify: `apps/web/src/app/streaming-workbench.test.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`

- [ ] **Step 1: Write failing reducer tests**

In `apps/web/src/app/streaming-workbench-state.test.ts`, update the initial state expectation to include:

```ts
      statusMessage: undefined,
      errorCode: undefined,
```

Add:

```ts
  it("stores running status labels for slow first-token streams", () => {
    const state = reduceStreamingWorkbenchEvent(createInitialStreamingWorkbenchState(), {
      type: "run.status",
      taskId: "task_1",
      state: "running",
      label: "Connecting to model provider"
    });

    expect(state).toMatchObject({
      status: "streaming",
      taskId: "task_1",
      statusMessage: "Connecting to model provider"
    });
  });

  it("stores typed stream errors while preserving partial content", () => {
    let state = createInitialStreamingWorkbenchState();
    state = reduceStreamingWorkbenchEvent(state, {
      type: "assistant.delta",
      taskId: "task_1",
      messageId: "message_1",
      delta: "Partial answer"
    });
    state = reduceStreamingWorkbenchEvent(state, {
      type: "error",
      code: "stream_interrupted",
      message: "The provider stream stopped before the response completed."
    });

    expect(state).toMatchObject({
      status: "error",
      taskId: "task_1",
      assistantMessageId: "message_1",
      assistantContent: "Partial answer",
      errorCode: "stream_interrupted",
      errorMessage: "The provider stream stopped before the response completed."
    });
  });
```

- [ ] **Step 2: Run reducer tests and verify they fail**

Run:

```bash
pnpm vitest run apps/web/src/app/streaming-workbench-state.test.ts
```

Expected: tests fail because `statusMessage` and `errorCode` are not in state.

- [ ] **Step 3: Implement typed state fields**

In `apps/web/src/app/streaming-workbench-state.ts`, import the error type:

```ts
import type { ChatStreamErrorCode, ChatStreamEvent } from "../lib/chat-stream";
```

Extend `StreamingWorkbenchState`:

```ts
  statusMessage: string | undefined;
  errorCode: ChatStreamErrorCode | undefined;
```

Add both fields to `createInitialStreamingWorkbenchState()` as `undefined`.

In `task.created`, clear them:

```ts
        statusMessage: undefined,
        errorCode: undefined,
```

In the running `run.status` branch:

```ts
          statusMessage: event.label
```

In the completed `run.status` branch:

```ts
          statusMessage: event.label
```

In the failed/cancelled `run.status` branch:

```ts
        statusMessage: event.label,
        errorMessage: event.label
```

In `assistant.delta`, clear stale status message only if desired; keep it if no delta-specific text is needed:

```ts
        statusMessage: undefined,
```

In `assistant.completed`, clear `errorCode` and `statusMessage`.

In `error`, store:

```ts
        errorCode: event.code,
        errorMessage: event.message
```

- [ ] **Step 4: Run reducer tests and verify they pass**

Run:

```bash
pnpm vitest run apps/web/src/app/streaming-workbench-state.test.ts
```

Expected: all reducer tests pass.

- [ ] **Step 5: Write failing visible status tests**

In `apps/web/src/app/streaming-workbench.test.ts`, import `getVisibleStreamingStatus` after exporting it in the implementation step. Add:

```ts
describe("streaming workbench visible status", () => {
  const errorMessages = {
    prompt_required: "Enter a prompt before sending.",
    project_not_found: "The selected project is unavailable.",
    generation_failed: "The chat response could not be generated.",
    provider_configuration_failed: "Check the project model provider configuration before retrying.",
    stream_interrupted: "The provider stream stopped before the response completed.",
    empty_response: "The provider completed without usable assistant text.",
    persistence_failed: "The response was generated but could not be saved."
  };

  it("uses running stream status labels before the first token arrives", () => {
    const state: StreamingWorkbenchState = {
      ...createInitialStreamingWorkbenchState(),
      status: "streaming",
      statusMessage: "Connecting to model provider"
    };

    expect(
      getVisibleStreamingStatus(
        state,
        "Generating response",
        "The chat response could not be generated.",
        errorMessages
      )
    ).toBe("Connecting to model provider");
  });

  it("uses localized typed error messages instead of raw server messages", () => {
    const state: StreamingWorkbenchState = {
      ...createInitialStreamingWorkbenchState(),
      status: "error",
      errorCode: "stream_interrupted",
      errorMessage: "server safe fallback"
    };

    expect(
      getVisibleStreamingStatus(
        state,
        "Generating response",
        "The chat response could not be generated.",
        errorMessages
      )
    ).toBe("The provider stream stopped before the response completed.");
  });
});
```

- [ ] **Step 6: Run workbench tests and verify they fail**

Run:

```bash
pnpm vitest run apps/web/src/app/streaming-workbench.test.ts
```

Expected: tests fail because `getVisibleStreamingStatus` is not exported and does not accept the map.

- [ ] **Step 7: Implement visible status and prop wiring**

In `apps/web/src/app/streaming-workbench.tsx`, import the error code type:

```ts
import type { ChatStreamErrorCode, ChatStreamEvent } from "../lib/chat-stream";
```

Extend `StreamingWorkbenchProps`:

```ts
  streamingErrorMessages: Record<ChatStreamErrorCode, string>;
```

Export and update `getVisibleStreamingStatus()`:

```ts
export function getVisibleStreamingStatus(
  state: StreamingWorkbenchState,
  streamingStatusLabel: string,
  streamingErrorLabel: string,
  streamingErrorMessages: Record<ChatStreamErrorCode, string>
): string | undefined {
  if (state.status === "streaming") {
    return state.statusMessage ?? streamingStatusLabel;
  }
  if (state.status === "error") {
    return state.errorCode
      ? streamingErrorMessages[state.errorCode]
      : state.errorMessage ?? streamingErrorLabel;
  }
  if (state.status === "fallback_required") {
    return state.fallbackMessage ?? streamingErrorLabel;
  }
  return undefined;
}
```

Update the call site:

```ts
  const visibleStatus = getVisibleStreamingStatus(
    state,
    streamingStatusLabel,
    streamingErrorLabel,
    streamingErrorMessages
  );
```

Update `dispatchError()` to leave `errorCode` undefined:

```ts
      errorCode: undefined,
```

In `apps/web/src/app/page.tsx`, pass the new prop:

```tsx
            streamingErrorMessages={copy.chat.streamingErrorMessages}
```

Update `apps/web/src/app/page.test.ts` prop assertions that inspect `StreamingWorkbench` props to include:

```ts
      streamingErrorMessages: expect.objectContaining({
        generation_failed: "The chat response could not be generated.",
        stream_interrupted: "The provider stream stopped before the response completed."
      })
```

- [ ] **Step 8: Run focused Web tests**

Run:

```bash
pnpm vitest run apps/web/src/app/streaming-workbench-state.test.ts apps/web/src/app/streaming-workbench.test.ts apps/web/src/app/page.test.ts
```

Expected: all focused Web tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app/streaming-workbench-state.ts apps/web/src/app/streaming-workbench-state.test.ts apps/web/src/app/streaming-workbench.tsx apps/web/src/app/streaming-workbench.test.ts apps/web/src/app/page.tsx apps/web/src/app/page.test.ts
git commit -m "show typed streaming failure copy"
```

## Task 5: Documentation And Roadmap Closeout

**Files:**
- Modify: `docs/real-provider-alpha-smoke.md`
- Modify: `docs/project-roadmap.md`
- Modify: `docs/superpowers/README.md`
- Modify: `docs/agent-development-learning.md` if the implementation changed the concept wording

- [ ] **Step 1: Update real provider troubleshooting docs**

In `docs/real-provider-alpha-smoke.md`, add a section near troubleshooting:

```md
### Ordinary Chat Streaming Failures

普通聊天 provider streaming 的 Web/API failure copy 会把异常分成以下安全类别：

| Code | Meaning | Operator check |
| --- | --- | --- |
| `provider_configuration_failed` | Provider route、base URL、API protocol 或 key env 缺失。 | 检查 Models view、`.env.local`、`REAL_MODEL_RUNTIME=1` 和 provider `apiKeyEnv`，不要记录 key value。 |
| `stream_interrupted` | SSE stream 中断、malformed frame、provider 网络失败或 runtime 没有 terminal event。 | 确认 provider 支持当前 API protocol 的 streaming；用 fake-provider regression 或 provider dashboard 的 safe summary 复核。 |
| `empty_response` | Provider 完成但没有可用 assistant 文本。 | 复核 prompt、model id 和 provider response summary；不要复制 raw provider body。 |
| `persistence_failed` | Assistant text 已生成但本地 repository placeholder 保存失败。 | 检查 Web server log summary 和 repository backend 配置。 |

提交反馈时继续使用 `docs/alpha-release-candidate.md` 的 safe evidence 模板，不附带 secret、raw provider response、raw SSE frame、本机路径或完整 artifact 内容。
```

- [ ] **Step 2: Update roadmap after implementation**

In `docs/project-roadmap.md`:

1. Add Stage 38 to current status snapshot:

```md
- Assistant streaming failure UX hardening v0：Stage 38 已为 ordinary chat provider streaming 增加 typed failure codes、localized Web failure copy、empty response guard、persistence failure copy 和 cancel-safe stream persistence guard。
```

2. Move Stage 38 from recommended queue to completed stage record with implemented scope, design, and plan links.
3. Change recommended queue to Stage 39 / Stage 40 / Stage 41.
4. Add Stage 41:

```md
### Stage 41：Alpha RC Trial Fix Batch v0

**状态：** Stage 40 后推荐，可按内部 RC 反馈提前。

**为什么现在做：** Stage 37/40 会让内部试用反馈变成批次化输入。第一轮 RC 后需要一个小范围修复批次，只处理阻塞和高频 alpha 摩擦，避免把反馈直接扩成无边界 roadmap。

**建议范围：**

- 从 `docs/alpha-feedback-log.md` 或同等反馈批次中挑选 blocker/high priority。
- 修复普通聊天、LP artifact、Skills 或 docs 的小范围 alpha blocker。
- 保持每个修复都有 regression test 或明确人工验证步骤。

**非目标：**

- 不引入 production auth/RBAC、真实部署、billing/quota、MCP write tools、真实 shell runner 或 hosted observability。
- 不把所有 feedback 一次性清空。
- 不改变 LP artifact static HTML/CSS/JS contract。
```

- [ ] **Step 3: Update Superpowers README**

In `docs/superpowers/README.md`, add this plan after item 104:

```md
105. `plans/2026-05-23-assistant-streaming-failure-ux.md`
   - Stage 38 Assistant Streaming Failure UX Hardening v0 implementation plan（当前阶段）。
   - 在 Stage 38 design 后阅读，用于按 TDD 实现 typed chat stream errors、API/runtime failure classification、route terminal error mapping、localized Web failure copy、operator docs 和 roadmap closeout。
```

- [ ] **Step 4: Run docs checks**

Run:

```bash
rg -n "Stage 38|Assistant Streaming Failure|assistant-streaming-failure" docs/project-roadmap.md docs/superpowers/README.md docs/real-provider-alpha-smoke.md docs/agent-development-learning.md
git diff --check
```

Expected: Stage 38 design and plan are linked, roadmap has Stage 39/40/41 recommendations, and no whitespace errors.

- [ ] **Step 5: Commit**

```bash
git add docs/real-provider-alpha-smoke.md docs/project-roadmap.md docs/superpowers/README.md docs/agent-development-learning.md
git commit -m "document streaming failure troubleshooting"
```

## Task 6: Final Verification

**Files:**
- No production files unless verification exposes a bug.

- [ ] **Step 1: Run alpha check**

Run:

```bash
pnpm alpha:check
```

Expected: all deterministic alpha unit tests pass.

- [ ] **Step 2: Run smoke**

Run:

```bash
pnpm smoke
```

Expected: Web V1 smoke tests pass.

- [ ] **Step 3: Run full tests**

Run:

```bash
pnpm test
```

Expected: all Vitest tests pass, with only existing opt-in provider integration tests skipped.

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: every workspace typecheck script passes.

- [ ] **Step 5: Run build**

Run:

```bash
pnpm build
```

Expected: all build scripts pass.

- [ ] **Step 6: Run browser E2E**

Run:

```bash
pnpm alpha:e2e
```

Expected: deterministic Playwright alpha E2E passes. If Chromium is missing, run `pnpm alpha:e2e:install` and rerun. If local sandbox blocks port binding, rerun with approved command escalation and record the reason.

- [ ] **Step 7: Run diff check and inspect status**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. Worktree either clean after commits or only contains intentional uncommitted verification artifacts that should not be committed.

- [ ] **Step 8: Confirm implementation commits are focused**

Run:

```bash
git log --oneline main..HEAD
git status --short
```

Expected: branch contains focused commits for the Stage 38 spec, plan, implementation, docs, and any verification fixes. `git status --short` is clean.
