"use client";

import React, { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  decodeChatStreamLines,
  type ChatStreamErrorCode,
  type ChatStreamEvent
} from "../lib/chat-stream";
import {
  createInitialStreamingWorkbenchState,
  reduceStreamingWorkbenchEvent,
  type StreamingWorkbenchState
} from "./streaming-workbench-state";

export interface StreamingWorkbenchProps {
  children: React.ReactNode;
  action: (formData: FormData) => Promise<void>;
  projectId?: string;
  taskId?: string;
  implicitProjectName: string;
  promptLabel: string;
  placeholder: string;
  addAttachmentLabel: string;
  runtimeChip: string;
  sendLabel: string;
  streamingStatusLabel: string;
  streamingErrorLabel: string;
  streamingErrorMessages: Record<ChatStreamErrorCode, string>;
  interruptControl?: React.ReactNode;
}

type StreamingWorkbenchAction =
  | { type: "start" }
  | { type: "event"; event: ChatStreamEvent }
  | { type: "error"; message: string }
  | { type: "clear_transient_after_refresh" };

function streamingWorkbenchReducer(
  state: StreamingWorkbenchState,
  action: StreamingWorkbenchAction
): StreamingWorkbenchState {
  switch (action.type) {
    case "start":
      return {
        ...createInitialStreamingWorkbenchState(),
        status: "streaming"
      };
    case "event":
      return reduceStreamingWorkbenchEvent(state, action.event);
    case "error":
      return {
        ...state,
        status: "error",
        errorCode: undefined,
        errorMessage: action.message
      };
    case "clear_transient_after_refresh":
      return getTerminalStreamingStateAfterRefresh(state, true);
  }
}

function shouldRenderStreamingTurn(state: StreamingWorkbenchState): boolean {
  return (
    state.assistantContent.length > 0 ||
    state.status === "streaming" ||
    state.status === "completed" ||
    state.status === "error" ||
    state.status === "fallback_required"
  );
}

function shouldRefreshAfterStream(state: StreamingWorkbenchState): boolean {
  return state.status === "completed" || state.status === "error";
}

export function getTerminalStreamingStateAfterRefresh(
  state: StreamingWorkbenchState,
  didRequestRefresh: boolean
): StreamingWorkbenchState {
  if (!didRequestRefresh) {
    return state;
  }

  if (state.status === "error") {
    return state;
  }

  if (state.status === "completed" || state.status === "fallback_required") {
    return createInitialStreamingWorkbenchState();
  }

  return state;
}

export function getVisibleStreamingStatus(
  state: StreamingWorkbenchState,
  streamingStatusLabel: string,
  streamingErrorLabel: string,
  streamingErrorMessages: Record<ChatStreamErrorCode, string>
): string | undefined {
  if (state.status === "streaming") {
    return state.statusMessage ?? streamingStatusLabel;
  }
  if (state.status === "error") {
    return state.errorCode
      ? streamingErrorMessages[state.errorCode] ?? state.errorMessage ?? streamingErrorLabel
      : state.errorMessage ?? streamingErrorLabel;
  }
  if (state.status === "fallback_required") {
    return state.fallbackMessage ?? streamingErrorLabel;
  }
  return undefined;
}

export function StreamingContextSummary({
  state
}: {
  state: StreamingWorkbenchState;
}) {
  return state.contextSummary ? (
    <p className="streamingContext">
      {[
        state.contextSummary.projectName
          ? `Project: ${state.contextSummary.projectName}`
          : "No project context",
        `Skills: ${state.contextSummary.skillCount}`,
        `Runtime: ${state.contextSummary.runtimeMode}`
      ].join(" · ")}
    </p>
  ) : null;
}

export interface PromptSubmissionControlState {
  visiblePromptDisabled: boolean;
  hiddenPromptValue?: string;
}

export function getPromptSubmissionControlState({
  fallbackPrompt,
  isStreaming,
  liveTaskSubmitPending = false
}: {
  fallbackPrompt?: string;
  isStreaming: boolean;
  liveTaskSubmitPending?: boolean;
}): PromptSubmissionControlState {
  const hiddenPromptValue =
    fallbackPrompt === undefined || fallbackPrompt.length === 0 ? undefined : fallbackPrompt;
  const visiblePromptDisabled =
    isStreaming || liveTaskSubmitPending || hiddenPromptValue !== undefined;

  if (hiddenPromptValue === undefined) {
    return { visiblePromptDisabled };
  }

  return {
    hiddenPromptValue,
    visiblePromptDisabled
  };
}

export interface StreamingSubmitDecision {
  allowNativeSubmit: boolean;
  fallbackPrompt?: string;
  preventDefault: boolean;
  streamPrompt?: string;
}

export function getStreamingSubmitDecision({
  promptValue,
  skipStreamingOnce
}: {
  promptValue: string;
  skipStreamingOnce: boolean;
}): StreamingSubmitDecision {
  if (skipStreamingOnce) {
    return {
      allowNativeSubmit: true,
      preventDefault: false
    };
  }

  const streamPrompt = promptValue.trim();
  if (streamPrompt.length === 0) {
    return {
      allowNativeSubmit: false,
      preventDefault: true
    };
  }

  return {
    allowNativeSubmit: false,
    fallbackPrompt: promptValue,
    preventDefault: true,
    streamPrompt
  };
}

export interface StreamingChatRequestBody {
  prompt: string;
  projectId: string | null;
  taskId: string | null;
}

export function createStreamingChatRequestBody({
  prompt,
  projectId,
  taskId
}: {
  prompt: string;
  projectId?: string;
  taskId?: string;
}): StreamingChatRequestBody {
  return {
    prompt,
    projectId: projectId ?? null,
    taskId: taskId ?? null
  };
}

export interface LiveTaskSubmitRequestBody {
  prompt: string;
  implicitProjectName: string;
}

export const liveTaskSubmitEndpoint = "/api/tasks/submit";

export function createLiveTaskSubmitRequestBody({
  prompt,
  implicitProjectName
}: LiveTaskSubmitRequestBody): LiveTaskSubmitRequestBody {
  return { prompt, implicitProjectName };
}

export function shouldStartLiveTaskAfterFallback({
  fallbackReason,
  taskType
}: {
  fallbackReason: string;
  taskType?: string;
}): boolean {
  return fallbackReason === "unsupported_task_type" && taskType === "lp_generation";
}

export interface LiveTaskFallbackHandoffState {
  nextToken: number;
  pendingToken?: number;
  fallbackSubmitted: boolean;
}

export type LiveTaskFallbackHandoffStartAction =
  | { endpoint: typeof liveTaskSubmitEndpoint; type: "start_live_task"; token: number }
  | { type: "start_native_fallback" }
  | { type: "ignore" };

export interface LiveTaskFallbackHandoffStartResult {
  action: LiveTaskFallbackHandoffStartAction;
  state: LiveTaskFallbackHandoffState;
}

export type LiveTaskFallbackHandoffCompletionAction =
  | { type: "refresh_and_clear_transient" }
  | { type: "dispatch_error" }
  | { type: "ignore" };

export interface LiveTaskFallbackHandoffCompletionResult {
  action: LiveTaskFallbackHandoffCompletionAction;
  state: LiveTaskFallbackHandoffState;
}

export function createInitialLiveTaskFallbackHandoffState(): LiveTaskFallbackHandoffState {
  return {
    fallbackSubmitted: false,
    nextToken: 1
  };
}

export function resetLiveTaskFallbackHandoff(
  state: LiveTaskFallbackHandoffState
): LiveTaskFallbackHandoffState {
  return {
    fallbackSubmitted: false,
    nextToken: state.nextToken
  };
}

export function isLiveTaskFallbackHandoffPending(
  state: LiveTaskFallbackHandoffState
): boolean {
  return state.pendingToken !== undefined;
}

export function startLiveTaskFallbackHandoff({
  state,
  fallbackReason,
  taskType
}: {
  state: LiveTaskFallbackHandoffState;
  fallbackReason: string;
  taskType?: string;
}): LiveTaskFallbackHandoffStartResult {
  if (state.fallbackSubmitted) {
    return {
      action: { type: "ignore" },
      state
    };
  }

  if (
    shouldStartLiveTaskAfterFallback({
      fallbackReason,
      taskType
    })
  ) {
    const token = state.nextToken;
    return {
      action: { endpoint: liveTaskSubmitEndpoint, type: "start_live_task", token },
      state: {
        fallbackSubmitted: true,
        nextToken: token + 1,
        pendingToken: token
      }
    };
  }

  return {
    action: { type: "start_native_fallback" },
    state: {
      fallbackSubmitted: true,
      nextToken: state.nextToken
    }
  };
}

export function completeLiveTaskFallbackHandoff({
  state,
  token,
  ok
}: {
  state: LiveTaskFallbackHandoffState;
  token: number;
  ok: boolean;
}): LiveTaskFallbackHandoffCompletionResult {
  if (state.pendingToken !== token) {
    return {
      action: { type: "ignore" },
      state
    };
  }

  const nextState: LiveTaskFallbackHandoffState = {
    fallbackSubmitted: state.fallbackSubmitted,
    nextToken: state.nextToken
  };

  return {
    action: { type: ok ? "refresh_and_clear_transient" : "dispatch_error" },
    state: nextState
  };
}

export interface FallbackSubmitAfterCommitState {
  fallbackPrompt: string | undefined;
  fallbackSubmitPending: boolean;
  skipStreamingOnce: boolean;
}

export function shouldRequestFallbackSubmitAfterCommit({
  fallbackPrompt,
  fallbackSubmitPending,
  skipStreamingOnce
}: FallbackSubmitAfterCommitState): boolean {
  return (
    fallbackSubmitPending &&
    skipStreamingOnce &&
    fallbackPrompt !== undefined &&
    fallbackPrompt.length > 0
  );
}

export function StreamingWorkbench({
  children,
  action,
  projectId,
  taskId,
  implicitProjectName,
  promptLabel,
  placeholder,
  addAttachmentLabel,
  runtimeChip,
  sendLabel,
  streamingStatusLabel,
  streamingErrorLabel,
  streamingErrorMessages,
  interruptControl
}: StreamingWorkbenchProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const skipStreamingOnceRef = useRef(false);
  const fallbackSubmitPendingRef = useRef(false);
  const liveTaskFallbackHandoffRef = useRef(
    createInitialLiveTaskFallbackHandoffState()
  );
  const submittedPromptRef = useRef("");
  const stateRef = useRef(createInitialStreamingWorkbenchState());
  const [fallbackPrompt, setFallbackPrompt] = useState<string | undefined>(undefined);
  const [liveTaskSubmitPending, setLiveTaskSubmitPending] = useState(false);
  const [state, dispatch] = useReducer(
    streamingWorkbenchReducer,
    createInitialStreamingWorkbenchState()
  );
  const isStreaming = state.status === "streaming";
  const promptSubmissionControls = getPromptSubmissionControlState({
    fallbackPrompt,
    isStreaming,
    liveTaskSubmitPending
  });
  const visibleStatus = getVisibleStreamingStatus(
    state,
    streamingStatusLabel,
    streamingErrorLabel,
    streamingErrorMessages
  );

  useEffect(() => {
    if (
      !shouldRequestFallbackSubmitAfterCommit({
        fallbackPrompt,
        fallbackSubmitPending: fallbackSubmitPendingRef.current,
        skipStreamingOnce: skipStreamingOnceRef.current
      })
    ) {
      return;
    }

    fallbackSubmitPendingRef.current = false;
    formRef.current?.requestSubmit();
  }, [fallbackPrompt]);

  const applyState = (nextState: StreamingWorkbenchState) => {
    stateRef.current = nextState;
  };

  const applyLiveTaskFallbackHandoffState = (
    nextState: LiveTaskFallbackHandoffState
  ) => {
    liveTaskFallbackHandoffRef.current = nextState;
    setLiveTaskSubmitPending(isLiveTaskFallbackHandoffPending(nextState));
  };

  const dispatchError = () => {
    const nextState: StreamingWorkbenchState = {
      ...stateRef.current,
      status: "error",
      errorCode: undefined,
      errorMessage: streamingErrorLabel
    };
    applyState(nextState);
    dispatch({ type: "error", message: streamingErrorLabel });
  };

  const completeLiveTaskFromFallback = ({
    token,
    ok
  }: {
    token: number;
    ok: boolean;
  }) => {
    const completed = completeLiveTaskFallbackHandoff({
      state: liveTaskFallbackHandoffRef.current,
      token,
      ok
    });
    applyLiveTaskFallbackHandoffState(completed.state);

    if (completed.action.type === "ignore") {
      return;
    }

    if (completed.action.type === "dispatch_error") {
      dispatchError();
      return;
    }

    router.refresh();
    const nextState = getTerminalStreamingStateAfterRefresh(stateRef.current, true);
    applyState(nextState);
    dispatch({ type: "clear_transient_after_refresh" });
  };

  const startLiveTaskFromFallback = async ({
    endpoint,
    token,
    prompt
  }: {
    endpoint: typeof liveTaskSubmitEndpoint;
    token: number;
    prompt: string;
  }) => {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(
          createLiveTaskSubmitRequestBody({
            prompt,
            implicitProjectName
          })
        )
      });

      if (!response.ok) {
        completeLiveTaskFromFallback({ token, ok: false });
        return;
      }

      completeLiveTaskFromFallback({ token, ok: true });
    } catch {
      completeLiveTaskFromFallback({ token, ok: false });
    }
  };

  const dispatchEvent = (event: ChatStreamEvent) => {
    const nextState = reduceStreamingWorkbenchEvent(stateRef.current, event);
    applyState(nextState);
    dispatch({ type: "event", event });

    if (event.type === "fallback.required") {
      const handoff = startLiveTaskFallbackHandoff({
        state: liveTaskFallbackHandoffRef.current,
        fallbackReason: event.reason,
        taskType: event.taskType
      });
      applyLiveTaskFallbackHandoffState(handoff.state);

      if (handoff.action.type === "ignore") {
        return;
      }

      if (handoff.action.type === "start_live_task") {
        void startLiveTaskFromFallback({
          endpoint: handoff.action.endpoint,
          token: handoff.action.token,
          prompt: submittedPromptRef.current
        });
        return;
      }

      skipStreamingOnceRef.current = true;
      fallbackSubmitPendingRef.current = true;
      setFallbackPrompt(submittedPromptRef.current);
    }
  };

  const refreshAndClearTerminalState = () => {
    router.refresh();
    const nextState = getTerminalStreamingStateAfterRefresh(stateRef.current, true);
    applyState(nextState);
    dispatch({ type: "clear_transient_after_refresh" });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    const formData = new FormData(event.currentTarget);
    const decision = getStreamingSubmitDecision({
      promptValue: String(formData.get("prompt") ?? ""),
      skipStreamingOnce: skipStreamingOnceRef.current
    });

    if (decision.allowNativeSubmit) {
      skipStreamingOnceRef.current = false;
      return;
    }

    if (decision.preventDefault) {
      event.preventDefault();
    }

    if (decision.streamPrompt === undefined) {
      return;
    }

    const prompt = decision.streamPrompt;
    const initialState = {
      ...createInitialStreamingWorkbenchState(),
      status: "streaming" as const
    };
    applyLiveTaskFallbackHandoffState(
      resetLiveTaskFallbackHandoff(liveTaskFallbackHandoffRef.current)
    );
    fallbackSubmitPendingRef.current = false;
    submittedPromptRef.current = decision.fallbackPrompt ?? prompt;
    setFallbackPrompt(undefined);
    applyState(initialState);
    dispatch({ type: "start" });

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(createStreamingChatRequestBody({ prompt, projectId, taskId }))
      });

      if (!response.ok || !response.body) {
        dispatchError();
        refreshAndClearTerminalState();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let remainder = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const decoded = decodeChatStreamLines(
          `${remainder}${decoder.decode(value, { stream: true })}`
        );
        remainder = decoded.remainder;
        for (const streamEvent of decoded.events) {
          dispatchEvent(streamEvent);
        }
      }

      const finalText = decoder.decode();
      if (finalText.length > 0) {
        const decoded = decodeChatStreamLines(`${remainder}${finalText}`);
        remainder = decoded.remainder;
        for (const streamEvent of decoded.events) {
          dispatchEvent(streamEvent);
        }
      }

      if (remainder.length > 0) {
        try {
          const decoded = decodeChatStreamLines(`${remainder}\n`);
          for (const streamEvent of decoded.events) {
            dispatchEvent(streamEvent);
          }
          remainder = decoded.remainder;
        } catch {
          dispatchError();
        }
      }

      if (shouldRefreshAfterStream(stateRef.current)) {
        refreshAndClearTerminalState();
      }
    } catch {
      dispatchError();
      refreshAndClearTerminalState();
    }
  };

  return (
    <>
      <div className="conversationViewport">
        <div className="conversationStack">
          {children}
          {shouldRenderStreamingTurn(state) ? (
            <article className="assistantTurn streamingTurn" aria-live="polite">
              <div className="assistantIdentity">
                <div className="assistantAvatar">LP</div>
                <strong>LP Agent</strong>
              </div>
              <div className="assistantMessage">
                <StreamingContextSummary state={state} />
                {state.assistantContent ? <p>{state.assistantContent}</p> : null}
                {visibleStatus ? <p className="streamingStatus">{visibleStatus}</p> : null}
              </div>
            </article>
          ) : null}
        </div>
      </div>
      <form
        action={action}
        className="composerDock"
        onSubmit={handleSubmit}
        ref={formRef}
      >
        {projectId ? <input name="projectId" type="hidden" value={projectId} /> : null}
        {taskId ? <input name="taskId" type="hidden" value={taskId} /> : null}
        <input name="implicitProjectName" type="hidden" value={implicitProjectName} />
        {promptSubmissionControls.hiddenPromptValue === undefined ? null : (
          <input
            name="prompt"
            type="hidden"
            value={promptSubmissionControls.hiddenPromptValue}
          />
        )}
        <div className="composer">
          <button type="button" aria-label={addAttachmentLabel}>
            +
          </button>
          <input
            aria-label={promptLabel}
            disabled={promptSubmissionControls.visiblePromptDisabled}
            name="prompt"
            placeholder={placeholder}
          />
          <span>{runtimeChip}</span>
          {interruptControl}
          <button
            type="submit"
            className="sendButton"
            disabled={promptSubmissionControls.visiblePromptDisabled}
          >
            {sendLabel}
          </button>
        </div>
      </form>
    </>
  );
}
