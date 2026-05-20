import { describe, expect, it } from "vitest";
import {
  createInitialStreamingWorkbenchState,
  reduceStreamingWorkbenchEvent
} from "./streaming-workbench-state";

describe("streaming workbench state", () => {
  it("starts idle with no active task, message, content, or error", () => {
    expect(createInitialStreamingWorkbenchState()).toEqual({
      status: "idle",
      taskId: undefined,
      assistantMessageId: undefined,
      assistantContent: "",
      errorMessage: undefined,
      fallbackMessage: undefined
    });
  });

  it("appends assistant deltas and completes the turn", () => {
    let state = createInitialStreamingWorkbenchState();

    state = reduceStreamingWorkbenchEvent(state, {
      type: "task.created",
      taskId: "task_1"
    });
    state = reduceStreamingWorkbenchEvent(state, {
      type: "assistant.delta",
      taskId: "task_1",
      messageId: "message_1",
      delta: "Hello"
    });
    state = reduceStreamingWorkbenchEvent(state, {
      type: "assistant.delta",
      taskId: "task_1",
      messageId: "message_1",
      delta: " world"
    });
    state = reduceStreamingWorkbenchEvent(state, {
      type: "run.status",
      taskId: "task_1",
      state: "completed",
      label: "Completed"
    });
    state = reduceStreamingWorkbenchEvent(state, {
      type: "assistant.completed",
      taskId: "task_1",
      messageId: "message_1",
      content: "Hello world."
    });

    expect(state).toMatchObject({
      status: "completed",
      taskId: "task_1",
      assistantMessageId: "message_1",
      assistantContent: "Hello world.",
      errorMessage: undefined
    });
  });

  it("tracks fallback_required without treating it as an error", () => {
    const state = reduceStreamingWorkbenchEvent(createInitialStreamingWorkbenchState(), {
      type: "fallback.required",
      reason: "unsupported_task_type",
      taskType: "project_setup",
      message: "Streaming is not available for this task type."
    });

    expect(state).toMatchObject({
      status: "fallback_required",
      errorMessage: undefined,
      fallbackMessage: "Streaming is not available for this task type."
    });
  });

  it("preserves streamed content and records a safe message on error", () => {
    let state = createInitialStreamingWorkbenchState();

    state = reduceStreamingWorkbenchEvent(state, {
      type: "assistant.delta",
      taskId: "task_1",
      messageId: "message_1",
      delta: "Partial answer"
    });
    state = reduceStreamingWorkbenchEvent(state, {
      type: "error",
      code: "generation_failed",
      message: "The assistant response could not be completed."
    });

    expect(state).toMatchObject({
      status: "error",
      taskId: "task_1",
      assistantMessageId: "message_1",
      assistantContent: "Partial answer",
      errorMessage: "The assistant response could not be completed."
    });
  });
});
