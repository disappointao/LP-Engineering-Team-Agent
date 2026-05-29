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
      statusMessage: undefined,
      errorCode: undefined,
      fallbackMessage: undefined,
      contextSummary: undefined
    });
  });

  it("keeps running status labels out of localized visible copy", () => {
    const state = reduceStreamingWorkbenchEvent(createInitialStreamingWorkbenchState(), {
      type: "run.status",
      taskId: "task_1",
      state: "running",
      label: "Generating response"
    });

    expect(state).toMatchObject({
      status: "streaming",
      taskId: "task_1",
      statusMessage: undefined
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

  it("stores safe context summary from stream events", () => {
    const state = reduceStreamingWorkbenchEvent(createInitialStreamingWorkbenchState(), {
      type: "context.summary",
      taskId: "task_1",
      projectId: "project_1",
      projectName: "Spring Campaign",
      runtimeMode: "real",
      skillCount: 1,
      skills: [{ id: "skill_brand", name: "Brand Voice", version: "1.0.0" }]
    });

    expect(state.contextSummary).toEqual({
      taskId: "task_1",
      projectId: "project_1",
      projectName: "Spring Campaign",
      runtimeMode: "real",
      skillCount: 1,
      skills: [{ id: "skill_brand", name: "Brand Voice", version: "1.0.0" }]
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
});
