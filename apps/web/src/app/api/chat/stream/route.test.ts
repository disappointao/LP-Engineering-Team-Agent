import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeChatStreamLines } from "../../../../lib/chat-stream";

const startStreamingChatPrompt = vi.fn();
const completeStreamingChatPrompt = vi.fn();
const getCurrentProjectId = vi.fn();
const getCurrentTaskId = vi.fn();

vi.mock("../../../../lib/workbench-store", () => ({
  getWebWorkbenchStore: () => ({
    startStreamingChatPrompt,
    completeStreamingChatPrompt
  })
}));

vi.mock("../../../../lib/workbench-session", () => ({
  CURRENT_PROJECT_COOKIE: "lp-agent-current-project",
  CURRENT_TASK_COOKIE: "lp-agent-current-task",
  getCurrentProjectId,
  getCurrentTaskId
}));

describe("POST /api/chat/stream", () => {
  beforeEach(() => {
    startStreamingChatPrompt.mockReset();
    completeStreamingChatPrompt.mockReset();
    getCurrentProjectId.mockReset();
    getCurrentTaskId.mockReset();
    getCurrentProjectId.mockResolvedValue(undefined);
    getCurrentTaskId.mockResolvedValue(undefined);
  });

  it("streams a successful assistant response as ndjson", async () => {
    startStreamingChatPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_1",
      taskType: "general_chat",
      userMessageId: "message_1",
      assistantMessageId: "message_2",
      assistantContent: "Hello there",
      chunks: ["Hello", " there"]
    });
    completeStreamingChatPrompt.mockResolvedValue({ ok: true });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        body: JSON.stringify({ prompt: "Hello" })
      })
    );

    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(response.headers.get("set-cookie")).toContain("lp-agent-current-task=task_1");
    const decoded = decodeChatStreamLines(await response.text());
    expect(decoded).toEqual({
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
    startStreamingChatPrompt.mockResolvedValue({
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
    expect(completeStreamingChatPrompt).not.toHaveBeenCalled();
  });
});
