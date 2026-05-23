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

  it("decodes safe context summary events", () => {
    const decoded = decodeChatStreamLines(
      '{"type":"context.summary","taskId":"task_1","projectId":"project_1","projectName":"Spring Campaign","runtimeMode":"real","skillCount":1,"skills":[{"id":"skill_brand","name":"Brand Voice","version":"1.0.0"}]}\n'
    );

    expect(decoded.events).toEqual([
      {
        type: "context.summary",
        taskId: "task_1",
        projectId: "project_1",
        projectName: "Spring Campaign",
        runtimeMode: "real",
        skillCount: 1,
        skills: [{ id: "skill_brand", name: "Brand Voice", version: "1.0.0" }]
      }
    ]);
  });

  it("rejects context summary skill entries with raw content fields", () => {
    expect(() =>
      decodeChatStreamLines(
        '{"type":"context.summary","taskId":"task_1","runtimeMode":"real","skillCount":1,"skills":[{"id":"skill_brand","name":"Brand Voice","version":"1.0.0","content":"raw skill prompt"}]}\n'
      )
    ).toThrow("chat_stream_event_invalid");
  });

  it("rejects context summaries with mismatched skill counts", () => {
    expect(() =>
      decodeChatStreamLines(
        '{"type":"context.summary","taskId":"task_1","runtimeMode":"real","skillCount":2,"skills":[{"id":"skill_brand","name":"Brand Voice","version":"1.0.0"}]}\n'
      )
    ).toThrow("chat_stream_event_invalid");
  });

  it("rejects context summaries with unsafe top-level raw fields", () => {
    expect(() =>
      decodeChatStreamLines(
        '{"type":"context.summary","taskId":"task_1","runtimeMode":"real","skillCount":0,"skills":[],"content":"raw assembled context"}\n'
      )
    ).toThrow("chat_stream_event_invalid");
  });

  it("decodes cancelled run status events", () => {
    const decoded = decodeChatStreamLines(
      '{"type":"run.status","taskId":"task_1","state":"cancelled","label":"Cancelled"}\n'
    );

    expect(decoded.events[0]).toMatchObject({
      type: "run.status",
      state: "cancelled"
    });
  });

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
