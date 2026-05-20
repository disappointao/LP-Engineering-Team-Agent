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

  it("rejects decoded events with unknown types", () => {
    expect(() => decodeChatStreamLines('{"type":"unknown"}\n')).toThrow(
      "chat_stream_event_invalid"
    );
  });

  it("rejects decoded assistant deltas with missing or invalid fields", () => {
    expect(() =>
      decodeChatStreamLines(
        '{"type":"assistant.delta","taskId":"task_1","messageId":"message_1"}\n'
      )
    ).toThrow("chat_stream_event_invalid");

    expect(() =>
      decodeChatStreamLines(
        '{"type":"assistant.delta","taskId":"task_1","messageId":"message_1","delta":1}\n'
      )
    ).toThrow("chat_stream_event_invalid");
  });

  it("chunks assistant text without dropping whitespace", () => {
    expect(chunkAssistantText("hello world", 5)).toEqual(["hello", " worl", "d"]);
  });

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    "rejects invalid chunk size %s",
    (chunkSize) => {
      expect(() => chunkAssistantText("hello", chunkSize)).toThrow(
        "chat_stream_chunk_size_invalid"
      );
    }
  );
});
