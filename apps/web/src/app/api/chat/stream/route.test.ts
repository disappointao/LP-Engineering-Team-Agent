import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeChatStreamLines } from "../../../../lib/chat-stream";

const mocks = vi.hoisted(() => ({
  startStreamingChatPrompt: vi.fn(),
  completeStreamingChatPrompt: vi.fn(),
  getCurrentProjectId: vi.fn(),
  getCurrentTaskId: vi.fn()
}));

vi.mock("../../../../lib/workbench-store", () => ({
  getWebWorkbenchStore: vi.fn(async () => ({
    startStreamingChatPrompt: mocks.startStreamingChatPrompt,
    completeStreamingChatPrompt: mocks.completeStreamingChatPrompt
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

describe("POST /api/chat/stream", () => {
  beforeEach(() => {
    mocks.startStreamingChatPrompt.mockReset();
    mocks.completeStreamingChatPrompt.mockReset();
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
      chunks: ["Hello", " there"]
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
    expect(decoded).toEqual({
      events: [
        {
          type: "task.created",
          taskId: "task_1",
          projectId: "project_1"
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

  it("returns the response before assistant completion persistence resolves", async () => {
    const completion = deferred<{ ok: true }>();
    mocks.startStreamingChatPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_1",
      taskType: "general_chat",
      userMessageId: "message_1",
      assistantMessageId: "message_2",
      assistantContent: "Hello there",
      chunks: ["Hello", " there"]
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

    const initialText = await readEventTextUntil(reader, 4);
    expect(decodeChatStreamLines(initialText)).toEqual({
      events: [
        {
          type: "task.created",
          taskId: "task_1"
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
      chunks: ["Hello"]
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

    const initialText = await readEventTextUntil(reader, 3);
    expect(decodeChatStreamLines(initialText).events.map((event) => event.type)).toEqual([
      "task.created",
      "run.status",
      "assistant.delta"
    ]);

    completion.reject(new Error("database unavailable"));
    const remainingText = await readRemainingText(reader);
    expect(decodeChatStreamLines(remainingText)).toEqual({
      events: [
        {
          type: "error",
          code: "generation_failed",
          message: "The chat response could not be generated."
        }
      ],
      remainder: ""
    });
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
        chunks: ["Hello"]
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

      const initialText = await readEventTextUntil(reader, 3);
      expect(decodeChatStreamLines(initialText).events.map((event) => event.type)).toEqual([
        "task.created",
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
