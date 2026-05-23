import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeChatStreamLines } from "../../../../lib/chat-stream";

const mocks = vi.hoisted(() => ({
  startStreamingChatPrompt: vi.fn(),
  completeStreamingChatPrompt: vi.fn(),
  abandonStreamingChatPrompt: vi.fn(),
  getCurrentProjectId: vi.fn(),
  getCurrentTaskId: vi.fn()
}));

vi.mock("../../../../lib/workbench-store", () => ({
  getWebWorkbenchStore: vi.fn(async () => ({
    startStreamingChatPrompt: mocks.startStreamingChatPrompt,
    completeStreamingChatPrompt: mocks.completeStreamingChatPrompt,
    abandonStreamingChatPrompt: mocks.abandonStreamingChatPrompt
  }))
}));

vi.mock("../../../../lib/workbench-session", () => ({
  CURRENT_PROJECT_COOKIE: "lp-agent-current-project",
  CURRENT_TASK_COOKIE: "lp-agent-current-task",
  getCurrentProjectId: mocks.getCurrentProjectId,
  getCurrentTaskId: mocks.getCurrentTaskId
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function readEventTextUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  eventCount: number
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";

  while (decodeChatStreamLines(text).events.length < eventCount) {
    const read = await reader.read();
    if (read.done) {
      return text;
    }
    text += decoder.decode(read.value, { stream: true });
  }
  return text;
}

async function waitForCompletionCall() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (mocks.completeStreamingChatPrompt.mock.calls.length > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("completeStreamingChatPrompt was not called");
}

async function readRemainingText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) {
            controller.close();
            return;
          }
          controller.enqueue(chunk.value);
        }
      }
    })
  ).text();
}

async function captureUnhandledRejections(action: () => Promise<void>): Promise<unknown[]> {
  const unhandledRejections: unknown[] = [];
  const recordUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };

  process.on("unhandledRejection", recordUnhandledRejection);
  try {
    await action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    process.off("unhandledRejection", recordUnhandledRejection);
  }

  return unhandledRejections;
}

function getSetCookieHeaderText(response: Response): string {
  const getSetCookie = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.bind(response.headers);
  return getSetCookie ? getSetCookie().join("\n") : response.headers.get("set-cookie") ?? "";
}

const deterministicContextSummary = {
  runtimeMode: "deterministic" as const,
  skillCount: 0,
  skills: []
};

describe("POST /api/chat/stream", () => {
  beforeEach(() => {
    mocks.startStreamingChatPrompt.mockReset();
    mocks.completeStreamingChatPrompt.mockReset();
    mocks.abandonStreamingChatPrompt.mockReset();
    mocks.getCurrentProjectId.mockReset();
    mocks.getCurrentTaskId.mockReset();
    mocks.getCurrentProjectId.mockResolvedValue(undefined);
    mocks.getCurrentTaskId.mockResolvedValue(undefined);
  });

  it("streams a successful assistant response as ndjson", async () => {
    mocks.startStreamingChatPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_1",
      taskType: "general_chat",
      projectId: "project_1",
      userMessageId: "message_1",
      assistantMessageId: "message_2",
      assistantContent: "Hello there",
      chunks: ["Hello there"],
      contextSummary: {
        projectId: "project_1",
        projectName: "Spring Campaign",
        runtimeMode: "real",
        skillCount: 1,
        skills: [{ id: "skill_brand", name: "Brand Voice", version: "1.0.0" }]
      }
    });
    mocks.completeStreamingChatPrompt.mockResolvedValue({ ok: true });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        body: JSON.stringify({ prompt: "Hello" })
      })
    );

    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(response.headers.get("set-cookie")).toContain("lp-agent-current-task=task_1");
    const getSetCookie = (
      response.headers as Headers & { getSetCookie?: () => string[] }
    ).getSetCookie?.bind(response.headers);
    if (getSetCookie) {
      expect(getSetCookie()).toEqual([
        "lp-agent-current-task=task_1; Path=/; HttpOnly; SameSite=Lax",
        "lp-agent-current-project=project_1; Path=/; HttpOnly; SameSite=Lax"
      ]);
    } else {
      expect(response.headers.get("set-cookie")).toContain("lp-agent-current-project=project_1");
    }
    const decoded = decodeChatStreamLines(await response.text());
    const { events } = decoded;
    expect(events.map((event) => event.type)).toEqual([
      "task.created",
      "context.summary",
      "run.status",
      "assistant.delta",
      "assistant.completed",
      "run.status"
    ]);
    expect(events[1]).toMatchObject({
      type: "context.summary",
      projectName: "Spring Campaign",
      skillCount: 1
    });
    expect(decoded).toEqual({
      events: [
        {
          type: "task.created",
          taskId: "task_1",
          projectId: "project_1"
        },
        {
          type: "context.summary",
          taskId: "task_1",
          projectId: "project_1",
          projectName: "Spring Campaign",
          runtimeMode: "real",
          skillCount: 1,
          skills: [{ id: "skill_brand", name: "Brand Voice", version: "1.0.0" }]
        },
        {
          type: "run.status",
          taskId: "task_1",
          state: "running",
          label: "Generating response"
        },
        {
          type: "assistant.delta",
          taskId: "task_1",
          messageId: "message_2",
          delta: "Hello there"
        },
        {
          type: "assistant.completed",
          taskId: "task_1",
          messageId: "message_2",
          content: "Hello there"
        },
        {
          type: "run.status",
          taskId: "task_1",
          state: "completed",
          label: "Response complete"
        }
      ],
      remainder: ""
    });
  });

  it("streams provider assistant deltas and persists the accumulated terminal content", async () => {
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
        yield "Provider ";
        yield "stream";
      })(),
      contextSummary: {
        projectId: "project_1",
        projectName: "Spring Campaign",
        runtimeMode: "real",
        skillCount: 0,
        skills: []
      }
    });
    mocks.completeStreamingChatPrompt.mockResolvedValue({ ok: true });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        body: JSON.stringify({ projectId: "project_1", prompt: "Hello" })
      })
    );

    const decoded = decodeChatStreamLines(await response.text());
    expect(decoded.events.filter((event) => event.type === "assistant.delta")).toEqual([
      {
        type: "assistant.delta",
        taskId: "task_stream",
        messageId: "message_2",
        delta: "Provider "
      },
      {
        type: "assistant.delta",
        taskId: "task_stream",
        messageId: "message_2",
        delta: "stream"
      }
    ]);
    expect(decoded.events).toContainEqual({
      type: "assistant.completed",
      taskId: "task_stream",
      messageId: "message_2",
      content: "Provider stream"
    });
    expect(mocks.completeStreamingChatPrompt).toHaveBeenCalledWith({
      taskId: "task_stream",
      messageId: "message_2",
      content: "Provider stream"
    });
  });

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
    expect(mocks.abandonStreamingChatPrompt).toHaveBeenCalledWith({
      taskId: "task_stream",
      messageId: "message_2"
    });
  });

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
    expect(mocks.abandonStreamingChatPrompt).toHaveBeenCalledWith({
      taskId: "task_1",
      messageId: "message_2"
    });
  });

  it("streams fallback_required without completing the assistant message", async () => {
    mocks.startStreamingChatPrompt.mockResolvedValue({
      ok: false,
      error: "fallback_required",
      taskType: "lp_generation"
    });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        body: JSON.stringify({ prompt: "Create an LP" })
      })
    );

    const decoded = decodeChatStreamLines(await response.text());
    expect(decoded).toEqual({
      events: [
        {
          type: "fallback.required",
          reason: "unsupported_task_type",
          taskType: "lp_generation",
          message: "Use the standard task flow for this prompt."
        }
      ],
      remainder: ""
    });
    expect(mocks.completeStreamingChatPrompt).not.toHaveBeenCalled();
  });

  it("does not use the session task fallback when taskId is explicitly null", async () => {
    mocks.getCurrentTaskId.mockResolvedValue("task_lp");
    mocks.startStreamingChatPrompt.mockResolvedValue({
      ok: false,
      error: "prompt_required"
    });
    const { POST } = await import("./route");

    await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        body: JSON.stringify({ prompt: "Hello", taskId: null })
      })
    );

    expect(mocks.startStreamingChatPrompt).toHaveBeenCalledWith({
      projectId: null,
      taskId: null,
      prompt: "Hello"
    });
  });

  it("announces task-scoped generation failures after a task is created", async () => {
    mocks.startStreamingChatPrompt.mockResolvedValue({
      ok: false,
      error: "generation_failed",
      taskId: "task_1",
      projectId: "project_1"
    });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        body: JSON.stringify({ projectId: "project_1", prompt: "Hello" })
      })
    );

    const setCookie = getSetCookieHeaderText(response);
    expect(setCookie).toContain("lp-agent-current-task=task_1");
    expect(setCookie).toContain("lp-agent-current-project=project_1");
    expect(decodeChatStreamLines(await response.text())).toEqual({
      events: [
        {
          type: "task.created",
          taskId: "task_1",
          projectId: "project_1"
        },
        {
          type: "error",
          code: "generation_failed",
          message: "The chat response could not be generated."
        }
      ],
      remainder: ""
    });
  });

  it("announces task-scoped provider configuration failures after a task is created", async () => {
    mocks.startStreamingChatPrompt.mockResolvedValue({
      ok: false,
      error: "provider_configuration_failed",
      taskId: "task_1",
      projectId: "project_1"
    });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        body: JSON.stringify({ projectId: "project_1", prompt: "Hello" })
      })
    );

    expect(decodeChatStreamLines(await response.text())).toEqual({
      events: [
        {
          type: "task.created",
          taskId: "task_1",
          projectId: "project_1"
        },
        {
          type: "error",
          code: "provider_configuration_failed",
          message: "Check the project model provider configuration before retrying."
        }
      ],
      remainder: ""
    });
  });

  it("uses the session task fallback when taskId is omitted", async () => {
    mocks.getCurrentTaskId.mockResolvedValue("task_general");
    mocks.startStreamingChatPrompt.mockResolvedValue({
      ok: false,
      error: "prompt_required"
    });
    const { POST } = await import("./route");

    await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        body: JSON.stringify({ prompt: "Hello" })
      })
    );

    expect(mocks.startStreamingChatPrompt).toHaveBeenCalledWith({
      projectId: null,
      taskId: "task_general",
      prompt: "Hello"
    });
  });

  it("expires the current project cookie for successful explicit projectless streams", async () => {
    mocks.getCurrentProjectId.mockResolvedValue("project_stale");
    mocks.startStreamingChatPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_projectless",
      taskType: "general_chat",
      userMessageId: "message_1",
      assistantMessageId: "message_2",
      assistantContent: "Hello there",
      chunks: ["Hello there"],
      contextSummary: deterministicContextSummary
    });
    mocks.completeStreamingChatPrompt.mockResolvedValue({ ok: true });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        body: JSON.stringify({ prompt: "Hello", projectId: null, taskId: null })
      })
    );

    expect(mocks.startStreamingChatPrompt).toHaveBeenCalledWith({
      projectId: null,
      taskId: null,
      prompt: "Hello"
    });
    const setCookie = getSetCookieHeaderText(response);
    expect(setCookie).toContain("lp-agent-current-task=task_projectless");
    expect(setCookie).toContain("lp-agent-current-project=;");
    expect(setCookie).toContain("Max-Age=0");
  });

  it("keeps the session project cookie active when projectId is omitted", async () => {
    mocks.getCurrentProjectId.mockResolvedValue("project_session");
    mocks.startStreamingChatPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_session_project",
      taskType: "general_chat",
      projectId: "project_session",
      userMessageId: "message_1",
      assistantMessageId: "message_2",
      assistantContent: "Hello there",
      chunks: ["Hello there"],
      contextSummary: deterministicContextSummary
    });
    mocks.completeStreamingChatPrompt.mockResolvedValue({ ok: true });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        body: JSON.stringify({ prompt: "Hello" })
      })
    );

    expect(mocks.startStreamingChatPrompt).toHaveBeenCalledWith({
      projectId: "project_session",
      taskId: null,
      prompt: "Hello"
    });
    const setCookie = getSetCookieHeaderText(response);
    expect(setCookie).toContain("lp-agent-current-project=project_session");
    expect(setCookie).not.toContain("lp-agent-current-project=;");
    expect(setCookie).not.toContain("Max-Age=0");
  });

  it("returns the response before assistant completion persistence resolves", async () => {
    const completion = deferred<{ ok: true }>();
    mocks.startStreamingChatPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_1",
      taskType: "general_chat",
      userMessageId: "message_1",
      assistantMessageId: "message_2",
      assistantContent: "Hello there",
      chunks: ["Hello", " there"],
      contextSummary: deterministicContextSummary
    });
    mocks.completeStreamingChatPrompt.mockReturnValue(completion.promise);
    const { POST } = await import("./route");

    const responsePromise = POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        body: JSON.stringify({ prompt: "Hello" })
      })
    );

    await waitForCompletionCall();
    const initialResult = await Promise.race([
      responsePromise.then((response) => ({ status: "returned" as const, response })),
      new Promise<{ status: "pending" }>((resolve) => {
        setTimeout(() => resolve({ status: "pending" }), 10);
      })
    ]);

    expect(initialResult.status).toBe("returned");
    if (initialResult.status !== "returned") {
      return;
    }

    const reader = initialResult.response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) {
      return;
    }

    const initialText = await readEventTextUntil(reader, 5);
    expect(decodeChatStreamLines(initialText)).toEqual({
      events: [
        {
          type: "task.created",
          taskId: "task_1"
        },
        {
          type: "context.summary",
          taskId: "task_1",
          runtimeMode: "deterministic",
          skillCount: 0,
          skills: []
        },
        {
          type: "run.status",
          taskId: "task_1",
          state: "running",
          label: "Generating response"
        },
        {
          type: "assistant.delta",
          taskId: "task_1",
          messageId: "message_2",
          delta: "Hello"
        },
        {
          type: "assistant.delta",
          taskId: "task_1",
          messageId: "message_2",
          delta: " there"
        }
      ],
      remainder: ""
    });

    completion.resolve({ ok: true });
    const remainingText = await readRemainingText(reader);
    expect(decodeChatStreamLines(remainingText)).toEqual({
      events: [
        {
          type: "assistant.completed",
          taskId: "task_1",
          messageId: "message_2",
          content: "Hello there"
        },
        {
          type: "run.status",
          taskId: "task_1",
          state: "completed",
          label: "Response complete"
        }
      ],
      remainder: ""
    });
  });

  it("emits a terminal error when completion persistence rejects after streaming starts", async () => {
    const completion = deferred<{ ok: true }>();
    mocks.startStreamingChatPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_1",
      taskType: "general_chat",
      userMessageId: "message_1",
      assistantMessageId: "message_2",
      assistantContent: "Hello there",
      chunks: ["Hello"],
      contextSummary: deterministicContextSummary
    });
    mocks.completeStreamingChatPrompt.mockReturnValue(completion.promise);
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

    completion.reject(new Error("database unavailable"));
    const remainingText = await readRemainingText(reader);
    expect(decodeChatStreamLines(remainingText)).toEqual({
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
      remainder: ""
    });
    expect(mocks.abandonStreamingChatPrompt).toHaveBeenCalledWith({
      taskId: "task_1",
      messageId: "message_2"
    });
  });

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
    expect(mocks.abandonStreamingChatPrompt).toHaveBeenCalledWith({
      taskId: "task_1",
      messageId: "message_2"
    });
  });

  it("abandons a stalled provider stream immediately after client cancellation", async () => {
    const cancelAssistantStream = vi.fn();
    const never = new Promise<void>(() => undefined);
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
        await never;
        yield "content";
      })(),
      cancelAssistantStream,
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
    await vi.waitFor(() => {
      expect(cancelAssistantStream).toHaveBeenCalledOnce();
      expect(mocks.abandonStreamingChatPrompt).toHaveBeenCalledWith({
        taskId: "task_1",
        messageId: "message_2"
      });
    });
    expect(mocks.completeStreamingChatPrompt).not.toHaveBeenCalled();
  });

  it("abandons assistant content when the client cancels while final persistence is pending", async () => {
    const completion = deferred<{ ok: true }>();
    mocks.startStreamingChatPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_1",
      taskType: "general_chat",
      userMessageId: "message_1",
      assistantMessageId: "message_2",
      assistantContent: "Hello there",
      chunks: ["Hello there"],
      contextSummary: deterministicContextSummary
    });
    mocks.completeStreamingChatPrompt.mockReturnValue(completion.promise);
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
    await waitForCompletionCall();

    await reader.cancel();
    completion.resolve({ ok: true });

    await vi.waitFor(() => {
      expect(mocks.abandonStreamingChatPrompt).toHaveBeenCalledWith({
        taskId: "task_1",
        messageId: "message_2",
        allowPersistedContent: true,
        allowStale: true
      });
    });
  });

  it("emits a provider configuration error when assistant streaming fails before deltas", async () => {
    const providerConfigurationError = Object.assign(new Error("assistant_stream_failed"), {
      code: "provider_configuration_failed"
    });
    mocks.startStreamingChatPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_1",
      taskType: "general_chat",
      userMessageId: "message_1",
      assistantMessageId: "message_2",
      assistantContent: "",
      assistantStream: (async function* () {
        throw providerConfigurationError;
      })(),
      chunks: [],
      contextSummary: deterministicContextSummary
    });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        body: JSON.stringify({ prompt: "Hello" })
      })
    );

    expect(decodeChatStreamLines(await response.text())).toEqual({
      events: [
        {
          type: "task.created",
          taskId: "task_1"
        },
        {
          type: "context.summary",
          taskId: "task_1",
          ...deterministicContextSummary
        },
        {
          type: "run.status",
          taskId: "task_1",
          state: "running",
          label: "Generating response"
        },
        {
          type: "run.status",
          taskId: "task_1",
          state: "failed",
          label: "Provider configuration failed"
        },
        {
          type: "error",
          code: "provider_configuration_failed",
          message: "Check the project model provider configuration before retrying."
        }
      ],
      remainder: ""
    });
    expect(mocks.completeStreamingChatPrompt).not.toHaveBeenCalled();
  });

  it.each([
    {
      outcome: "resolves",
      settle: (completion: ReturnType<typeof deferred<{ ok: true }>>) => {
        completion.resolve({ ok: true });
      }
    },
    {
      outcome: "rejects",
      settle: (completion: ReturnType<typeof deferred<{ ok: true }>>) => {
        completion.reject(new Error("database unavailable"));
      }
    }
  ])(
    "does not leak unhandled rejections when a canceled stream completion $outcome",
    async ({ settle }) => {
      const completion = deferred<{ ok: true }>();
      mocks.startStreamingChatPrompt.mockResolvedValue({
        ok: true,
        taskId: "task_1",
        taskType: "general_chat",
        userMessageId: "message_1",
        assistantMessageId: "message_2",
        assistantContent: "Hello there",
        chunks: ["Hello"],
        contextSummary: deterministicContextSummary
      });
      mocks.completeStreamingChatPrompt.mockReturnValue(completion.promise);
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
      const unhandledRejections = await captureUnhandledRejections(async () => {
        settle(completion);
      });

      expect(unhandledRejections).toEqual([]);
    }
  );
});
