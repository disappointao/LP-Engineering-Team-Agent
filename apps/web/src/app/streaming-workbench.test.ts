import { describe, expect, it } from "vitest";
import { decodeChatStreamLines } from "../lib/chat-stream";
import {
  createInitialStreamingWorkbenchState,
  reduceStreamingWorkbenchEvent,
  type StreamingWorkbenchState
} from "./streaming-workbench-state";
import {
  completeLiveTaskFallbackHandoff,
  createInitialLiveTaskFallbackHandoffState,
  createLiveTaskSubmitRequestBody,
  createStreamingTerminalHref,
  createStreamingChatRequestBody,
  getLiveTaskSubmitAcceptedStreamingState,
  getTerminalStreamingStateAfterRefresh,
  getPromptSubmissionControlState,
  getVisibleStreamingStatus,
  isLiveTaskFallbackHandoffPending,
  resetLiveTaskFallbackHandoff,
  startLiveTaskFallbackHandoff,
  shouldRequestFallbackSubmitAfterCommit,
  shouldStartLiveTaskAfterFallback,
  shouldSubmitDirectlyToLiveTask,
  getComposerSubmitIntent,
  getStreamingSubmitDecision,
  getComposerPrimaryAction,
  startLiveTaskSubmitHandoff,
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

  it("lets the interrupt submit button use its server action instead of chat streaming", () => {
    expect(
      getComposerSubmitIntent({
        getAttribute: (name: string) =>
          name === "data-composer-action" ? "interrupt" : null
      })
    ).toBe("interrupt");
  });
});

describe("streaming workbench composer primary action", () => {
  it("uses send when no task is interruptible", () => {
    expect(
      getComposerPrimaryAction({
        interruptState: "not_interruptible",
        isPromptDisabled: false
      })
    ).toBe("send");
  });

  it("uses stop while the selected task can be interrupted", () => {
    expect(
      getComposerPrimaryAction({
        interruptState: "idle",
        isPromptDisabled: false
      })
    ).toBe("stop");
  });

  it("uses stopping while cancellation is already in progress", () => {
    expect(
      getComposerPrimaryAction({
        interruptState: "stopping",
        isPromptDisabled: true
      })
    ).toBe("stopping");
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

  it("clears direct live task submit streaming state after the submit is accepted", () => {
    const streamingState: StreamingWorkbenchState = {
      ...createInitialStreamingWorkbenchState(),
      status: "streaming",
      statusMessage: "Generating reply"
    };

    expect(getLiveTaskSubmitAcceptedStreamingState()).toEqual(
      createInitialStreamingWorkbenchState()
    );
    expect(getLiveTaskSubmitAcceptedStreamingState()).not.toEqual(streamingState);
  });
});

describe("streaming workbench terminal navigation", () => {
  it("replaces the new-task URL with the completed task context", () => {
    expect(
      createStreamingTerminalHref({
        currentSearch: "?projectId=project_1&newTask=1",
        projectId: "project_1",
        taskId: "task_2"
      })
    ).toBe("/?projectId=project_1&taskId=task_2");
  });

  it("clears stale diagnostics when moving to the streamed task URL", () => {
    expect(
      createStreamingTerminalHref({
        currentSearch: "?newTask=1&error=generation_failed&artifactPath=styles.css",
        projectId: "project_1",
        taskId: "task_2"
      })
    ).toBe("/?projectId=project_1&taskId=task_2");
  });
});

describe("streaming workbench visible status", () => {
  const errorMessages = {
    prompt_required: "Enter a prompt before sending.",
    project_not_found: "The selected project is unavailable.",
    generation_failed: "The chat response could not be generated.",
    provider_configuration_failed:
      "Check the project model provider configuration before retrying.",
    provider_authentication_failed:
      "The model provider rejected authentication. Check the API key or permissions.",
    provider_billing_required:
      "The model provider rejected the request for billing or quota. Check provider usage or billing, then retry.",
    provider_rate_limited: "The model provider is rate limited. Wait a moment, then retry.",
    provider_unavailable: "The model provider is temporarily unavailable. Retry later.",
    provider_timeout: "The model provider timed out. Retry later.",
    provider_request_failed: "The model provider request failed. Check provider status, then retry.",
    provider_response_invalid:
      "The model provider returned a response format this app does not support yet.",
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

  it("falls back to safe error text when typed error copy is unavailable", () => {
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
        {
          generation_failed: "The chat response could not be generated."
        } as Record<keyof typeof errorMessages, string>
      )
    ).toBe("server safe fallback");
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

describe("streaming workbench live task fallback", () => {
  it("starts a live task after lp generation fallback is required", () => {
    expect(
      shouldStartLiveTaskAfterFallback({
        fallbackReason: "unsupported_task_type",
        taskType: "lp_generation"
      })
    ).toBe(true);
  });

  it("does not start a live task for non-lp fallback", () => {
    expect(
      shouldStartLiveTaskAfterFallback({
        fallbackReason: "unsupported_task_type",
        taskType: "project_setup"
      })
    ).toBe(false);
  });

  it("routes completed LP task submits directly to live task continuation", () => {
    expect(
      shouldSubmitDirectlyToLiveTask({
        liveTaskId: "task_lp",
        streamingTaskId: undefined
      })
    ).toBe(true);
    expect(
      shouldSubmitDirectlyToLiveTask({
        liveTaskId: "task_lp",
        streamingTaskId: "task_general"
      })
    ).toBe(false);
    expect(
      shouldSubmitDirectlyToLiveTask({
        liveTaskId: undefined,
        streamingTaskId: undefined
      })
    ).toBe(false);
  });

  it("creates the live task submit request body", () => {
    const prompt = "Build an LP";
    const implicitProjectName = "Untitled LP Project";

    expect(createLiveTaskSubmitRequestBody({ prompt, implicitProjectName })).toEqual({
      prompt,
      implicitProjectName
    });
  });

  it("includes explicit project and task context for live task continuation submits", () => {
    expect(
      createLiveTaskSubmitRequestBody({
        prompt: "Make the hero stronger",
        implicitProjectName: "Untitled LP Project",
        projectId: "project_1",
        taskId: "task_1"
      })
    ).toEqual({
      prompt: "Make the hero stronger",
      implicitProjectName: "Untitled LP Project",
      projectId: "project_1",
      taskId: "task_1"
    });
  });

  it("starts live task submit and skips the native fallback path for lp fallback", () => {
    const handoff = startLiveTaskFallbackHandoff({
      state: createInitialLiveTaskFallbackHandoffState(),
      fallbackReason: "unsupported_task_type",
      taskType: "lp_generation"
    });

    expect(handoff.action).toEqual({
      endpoint: "/api/tasks/submit",
      type: "start_live_task",
      token: 1
    });
    expect(isLiveTaskFallbackHandoffPending(handoff.state)).toBe(true);
  });

  it("starts direct live task submit handoff without waiting for stream fallback", () => {
    const handoff = startLiveTaskSubmitHandoff({
      state: createInitialLiveTaskFallbackHandoffState()
    });

    expect(handoff.action).toEqual({
      endpoint: "/api/tasks/submit",
      type: "start_live_task",
      token: 1
    });
    expect(isLiveTaskFallbackHandoffPending(handoff.state)).toBe(true);
  });

  it("keeps non-lp fallback on the native fallback path", () => {
    const handoff = startLiveTaskFallbackHandoff({
      state: createInitialLiveTaskFallbackHandoffState(),
      fallbackReason: "unsupported_task_type",
      taskType: "project_setup"
    });

    expect(handoff.action).toEqual({ type: "start_native_fallback" });
    expect(isLiveTaskFallbackHandoffPending(handoff.state)).toBe(false);
  });

  it("keeps prompt controls disabled while live task submit is pending", () => {
    const controls = getPromptSubmissionControlState({
      fallbackPrompt: undefined,
      isStreaming: false,
      liveTaskSubmitPending: true
    });

    expect(controls.visiblePromptDisabled).toBe(true);
    expect(controls.hiddenPromptValue).toBeUndefined();
    expect(collectEnabledPromptPayload(controls)).toEqual([]);
  });

  it("refreshes and clears transient fallback state after successful live submit", () => {
    const started = startLiveTaskFallbackHandoff({
      state: createInitialLiveTaskFallbackHandoffState(),
      fallbackReason: "unsupported_task_type",
      taskType: "lp_generation"
    });
    if (started.action.type !== "start_live_task") {
      throw new Error("expected live task start");
    }

    const completed = completeLiveTaskFallbackHandoff({
      state: started.state,
      token: started.action.token,
      ok: true
    });
    const fallbackState: StreamingWorkbenchState = {
      ...createInitialStreamingWorkbenchState(),
      status: "fallback_required",
      fallbackMessage: "Starting live task"
    };

    expect(completed.action).toEqual({ type: "refresh_and_clear_transient" });
    expect(isLiveTaskFallbackHandoffPending(completed.state)).toBe(false);
    expect(getTerminalStreamingStateAfterRefresh(fallbackState, true)).toEqual(
      createInitialStreamingWorkbenchState()
    );
  });

  it("dispatches streaming error behavior after failed live submit", () => {
    const started = startLiveTaskFallbackHandoff({
      state: createInitialLiveTaskFallbackHandoffState(),
      fallbackReason: "unsupported_task_type",
      taskType: "lp_generation"
    });
    if (started.action.type !== "start_live_task") {
      throw new Error("expected live task start");
    }

    const completed = completeLiveTaskFallbackHandoff({
      state: started.state,
      token: started.action.token,
      ok: false
    });

    expect(completed.action).toEqual({ type: "dispatch_error" });
    expect(isLiveTaskFallbackHandoffPending(completed.state)).toBe(false);
  });

  it("ignores stale completion for an older live submit token", () => {
    const first = startLiveTaskFallbackHandoff({
      state: createInitialLiveTaskFallbackHandoffState(),
      fallbackReason: "unsupported_task_type",
      taskType: "lp_generation"
    });
    if (first.action.type !== "start_live_task") {
      throw new Error("expected first live task start");
    }

    const second = startLiveTaskFallbackHandoff({
      state: resetLiveTaskFallbackHandoff(first.state),
      fallbackReason: "unsupported_task_type",
      taskType: "lp_generation"
    });
    if (second.action.type !== "start_live_task") {
      throw new Error("expected second live task start");
    }

    const staleCompletion = completeLiveTaskFallbackHandoff({
      state: second.state,
      token: first.action.token,
      ok: false
    });

    expect(staleCompletion.action).toEqual({ type: "ignore" });
    expect(staleCompletion.state).toEqual(second.state);
  });

  it("ignores duplicate fallback events for the same submit", () => {
    const first = startLiveTaskFallbackHandoff({
      state: createInitialLiveTaskFallbackHandoffState(),
      fallbackReason: "unsupported_task_type",
      taskType: "lp_generation"
    });

    const duplicate = startLiveTaskFallbackHandoff({
      state: first.state,
      fallbackReason: "unsupported_task_type",
      taskType: "lp_generation"
    });

    expect(duplicate.action).toEqual({ type: "ignore" });
    expect(duplicate.state).toEqual(first.state);
  });
});

describe("streaming workbench context summary", () => {
  it("keeps stream context summary out of the user-facing assistant turn", () => {
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
    expect(text).not.toContain("Project: Spring Campaign");
    expect(text).not.toContain("Skills: 1");
    expect(text).not.toContain("Runtime: real");
  });
});
