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
