import { describe, expect, it } from "vitest";
import { decodeChatStreamLines } from "../lib/chat-stream";
import {
  createInitialStreamingWorkbenchState,
  reduceStreamingWorkbenchEvent,
  type StreamingWorkbenchState
} from "./streaming-workbench-state";
import {
  createStreamingChatRequestBody,
  getTerminalStreamingStateAfterRefresh,
  getPromptSubmissionControlState,
  shouldRequestFallbackSubmitAfterCommit,
  getStreamingSubmitDecision,
  StreamingContextSummary
} from "./streaming-workbench";

function collectText(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === "boolean") {
    return [];
  }

  if (typeof node === "string" || typeof node === "number") {
    return [String(node)];
  }

  if (Array.isArray(node)) {
    return node.flatMap(collectText);
  }

  if (typeof node === "object" && "props" in node) {
    const element = node as { props?: { children?: unknown } };
    return collectText(element.props?.children);
  }

  return [];
}

function collectEnabledPromptPayload({
  visiblePromptDisabled,
  hiddenPromptValue
}: {
  visiblePromptDisabled: boolean;
  hiddenPromptValue?: string;
}): string[] {
  return [
    {
      disabled: visiblePromptDisabled,
      name: "prompt",
      value: ""
    },
    hiddenPromptValue === undefined
      ? undefined
      : {
          disabled: false,
          name: "prompt",
          value: hiddenPromptValue
        }
  ]
    .filter(
      (control): control is { disabled: boolean; name: string; value: string } =>
        control !== undefined
    )
    .filter((control) => control.name === "prompt" && !control.disabled)
    .map((control) => control.value);
}

describe("streaming workbench prompt submission controls", () => {
  it("keeps an enabled prompt payload available for fallback submission while the visible prompt is disabled", () => {
    const controls = getPromptSubmissionControlState({
      fallbackPrompt: "Build a launch page",
      isStreaming: false
    });

    expect(controls.visiblePromptDisabled).toBe(true);
    expect(collectEnabledPromptPayload(controls)).toEqual(["Build a launch page"]);
  });

  it("does not add a duplicate hidden prompt during ordinary non-fallback submission", () => {
    const controls = getPromptSubmissionControlState({
      fallbackPrompt: undefined,
      isStreaming: false
    });

    expect(controls.visiblePromptDisabled).toBe(false);
    expect(controls.hiddenPromptValue).toBeUndefined();
    expect(collectEnabledPromptPayload(controls)).toEqual([""]);
  });
});

describe("streaming workbench submit interception", () => {
  it("intercepts blank ordinary chat submits without starting stream handling", () => {
    const decision = getStreamingSubmitDecision({
      promptValue: "   ",
      skipStreamingOnce: false
    });

    expect(decision).toEqual({
      allowNativeSubmit: false,
      preventDefault: true,
      streamPrompt: undefined
    });
  });

  it("uses a trimmed prompt for streaming while preserving the original value for fallback", () => {
    const decision = getStreamingSubmitDecision({
      promptValue: "  Build a spring launch page  ",
      skipStreamingOnce: false
    });

    expect(decision).toMatchObject({
      allowNativeSubmit: false,
      preventDefault: true,
      streamPrompt: "Build a spring launch page",
      fallbackPrompt: "  Build a spring launch page  "
    });
  });
});

describe("streaming workbench terminal refresh state", () => {
  it("clears completed transient assistant state after requesting a refresh", () => {
    const completedState: StreamingWorkbenchState = {
      ...createInitialStreamingWorkbenchState(),
      status: "completed",
      assistantContent: "Persisted assistant reply"
    };

    expect(getTerminalStreamingStateAfterRefresh(completedState, true)).toEqual(
      createInitialStreamingWorkbenchState()
    );
  });

  it("keeps terminal error state visible after requesting a refresh", () => {
    const errorState: StreamingWorkbenchState = {
      ...createInitialStreamingWorkbenchState(),
      status: "error",
      assistantContent: "Partial assistant reply",
      errorMessage: "Stream failed"
    };

    expect(getTerminalStreamingStateAfterRefresh(errorState, true)).toEqual(
      errorState
    );
  });

  it("keeps terminal error state visible when no refresh was requested", () => {
    const errorState: StreamingWorkbenchState = {
      ...createInitialStreamingWorkbenchState(),
      status: "error",
      assistantContent: "Partial assistant reply",
      errorMessage: "Stream failed"
    };

    expect(getTerminalStreamingStateAfterRefresh(errorState, false)).toEqual(errorState);
  });
});

describe("streaming workbench chat stream request body", () => {
  it("sends explicit null project and task ids when no streaming context is available", () => {
    expect(
      createStreamingChatRequestBody({
        prompt: "Hello",
        projectId: undefined,
        taskId: undefined
      })
    ).toEqual({
      prompt: "Hello",
      projectId: null,
      taskId: null
    });
  });

  it("sends an explicit null taskId when no streaming task is available", () => {
    expect(
      createStreamingChatRequestBody({
        prompt: "Hello",
        projectId: "project_1",
        taskId: undefined
      })
    ).toEqual({
      prompt: "Hello",
      projectId: "project_1",
      taskId: null
    });
  });
});

describe("streaming workbench fallback submit handoff", () => {
  it("requests a fallback submit after commit when the prompt exists and native fallback is pending", () => {
    expect(
      shouldRequestFallbackSubmitAfterCommit({
        fallbackPrompt: "Build a launch page",
        fallbackSubmitPending: true,
        skipStreamingOnce: true
      })
    ).toBe(true);
  });

  it("does not request a fallback submit before the hidden prompt payload is committed", () => {
    expect(
      shouldRequestFallbackSubmitAfterCommit({
        fallbackPrompt: undefined,
        fallbackSubmitPending: true,
        skipStreamingOnce: true
      })
    ).toBe(false);
  });

  it("does not request a fallback submit during normal streaming", () => {
    expect(
      shouldRequestFallbackSubmitAfterCommit({
        fallbackPrompt: undefined,
        fallbackSubmitPending: false,
        skipStreamingOnce: false
      })
    ).toBe(false);
  });
});

describe("streaming workbench context summary", () => {
  it("renders context summary from stream events inside the assistant turn", () => {
    const streamFixture =
      `${JSON.stringify({ type: "task.created", taskId: "task_1", projectId: "project_1" })}\n` +
      `${JSON.stringify({
        type: "context.summary",
        taskId: "task_1",
        projectId: "project_1",
        projectName: "Spring Campaign",
        runtimeMode: "real",
        skillCount: 1,
        skills: [{ id: "skill_brand", name: "Brand Voice", version: "1.0.0" }]
      })}\n` +
      `${JSON.stringify({
        type: "assistant.delta",
        taskId: "task_1",
        messageId: "message_1",
        delta: "Hello"
      })}\n`;
    const decoded = decodeChatStreamLines(streamFixture);
    const state = decoded.events.reduce(
      reduceStreamingWorkbenchEvent,
      createInitialStreamingWorkbenchState()
    );

    const rendered = StreamingContextSummary({ state });
    const text = collectText(rendered).join(" ");
    expect(text).toContain("Project: Spring Campaign");
    expect(text).toContain("Skills: 1");
    expect(text).toContain("Runtime: real");
  });
});
