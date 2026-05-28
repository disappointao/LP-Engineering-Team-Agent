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
import { ChatMessageContent } from "./chat-message-content";

export interface StreamingWorkbenchProps {
  children: React.ReactNode;
  action: (formData: FormData) => Promise<void>;
  projectId?: string;
  taskId?: string;
  liveTaskId?: string;
  implicitProjectName: string;
  promptLabel: string;
  placeholder: string;
  sendLabel: string;
  streamingStatusLabel: string;
  streamingErrorLabel: string;
  streamingErrorMessages: Record<ChatStreamErrorCode, string>;
  interruptAction: (formData: FormData) => Promise<void>;
  interruptState: "idle" | "stopping" | "cancelled" | "not_interruptible";
  interruptLabels: {
    idle: string;
    stopping: string;
  };
}

type StreamingWorkbenchAction =
  | { type: "start" }
  | { type: "event"; event: ChatStreamEvent }
  | { type: "error"; message: string }
  | { type: "clear_transient_after_refresh" }
  | { type: "clear_live_task_submit_after_refresh" };

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
    case "clear_live_task_submit_after_refresh":
      return getLiveTaskSubmitAcceptedStreamingState();
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

export function getLiveTaskSubmitAcceptedStreamingState(): StreamingWorkbenchState {
  return createInitialStreamingWorkbenchState();
}

export function createStreamingTerminalHref({
  currentSearch,
  projectId,
  taskId
}: {
  currentSearch: string;
  projectId?: string;
  taskId?: string;
}): string {
  // Parse the current query so malformed inputs follow URLSearchParams behavior,
  // then build a clean task URL without stale transient flags.
  new URLSearchParams(currentSearch);
  const query = new URLSearchParams();
  if (projectId) {
    query.set("projectId", projectId);
  }
  if (taskId) {
    query.set("taskId", taskId);
  }
  const serialized = query.toString();
  return serialized.length > 0 ? `/?${serialized}` : "/";
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
  state: _state
}: {
  state: StreamingWorkbenchState;
}) {
  return null;
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

export type ComposerPrimaryAction = "send" | "stop" | "stopping";
export type ComposerSubmitIntent = "prompt" | "interrupt";

export function getComposerSubmitIntent(submitter: unknown): ComposerSubmitIntent {
  if (
    submitter &&
    typeof submitter === "object" &&
    "getAttribute" in submitter &&
    typeof submitter.getAttribute === "function" &&
    submitter.getAttribute("data-composer-action") === "interrupt"
  ) {
    return "interrupt";
  }
  return "prompt";
}

export function getComposerPrimaryAction({
  interruptState
}: {
  interruptState: "idle" | "stopping" | "cancelled" | "not_interruptible";
  isPromptDisabled: boolean;
}): ComposerPrimaryAction {
  if (interruptState === "stopping") {
    return "stopping";
  }
  if (interruptState === "idle") {
    return "stop";
  }
  return "send";
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
  projectId?: string;
  taskId?: string;
}

interface LiveTaskSubmitSuccessPayload {
  ok: true;
  taskId: string;
  projectId?: string;
}

export const liveTaskSubmitEndpoint = "/api/tasks/submit";

export function createLiveTaskSubmitRequestBody({
  prompt,
  implicitProjectName,
  projectId,
  taskId
}: LiveTaskSubmitRequestBody): LiveTaskSubmitRequestBody {
  return {
    prompt,
    implicitProjectName,
    ...(projectId ? { projectId } : {}),
    ...(taskId ? { taskId } : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toLiveTaskSubmitSuccessPayload(value: unknown): LiveTaskSubmitSuccessPayload | undefined {
  if (!isRecord(value) || value.ok !== true || typeof value.taskId !== "string") {
    return undefined;
  }
  return {
    ok: true,
    taskId: value.taskId,
    ...(typeof value.projectId === "string" ? { projectId: value.projectId } : {})
  };
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

export function shouldSubmitDirectlyToLiveTask({
  liveTaskId,
  streamingTaskId
}: {
  liveTaskId?: string;
  streamingTaskId?: string;
}): boolean {
  return Boolean(liveTaskId) && !streamingTaskId;
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
    return startLiveTaskSubmitHandoff({ state });
  }

  return {
    action: { type: "start_native_fallback" },
    state: {
      fallbackSubmitted: true,
      nextToken: state.nextToken
    }
  };
}

export function startLiveTaskSubmitHandoff({
  state
}: {
  state: LiveTaskFallbackHandoffState;
}): LiveTaskFallbackHandoffStartResult {
  if (state.fallbackSubmitted) {
    return {
      action: { type: "ignore" },
      state
    };
  }

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
  liveTaskId,
  implicitProjectName,
  promptLabel,
  placeholder,
  sendLabel,
  streamingStatusLabel,
  streamingErrorLabel,
  streamingErrorMessages,
  interruptAction,
  interruptState,
  interruptLabels
}: StreamingWorkbenchProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const conversationViewportRef = useRef<HTMLDivElement>(null);
  const sendButtonRef = useRef<HTMLButtonElement>(null);
  const skipStreamingOnceRef = useRef(false);
  const fallbackSubmitPendingRef = useRef(false);
  const liveTaskFallbackHandoffRef = useRef(
    createInitialLiveTaskFallbackHandoffState()
  );
  const submittedPromptRef = useRef("");
  const stateRef = useRef(createInitialStreamingWorkbenchState());
  const [fallbackPrompt, setFallbackPrompt] = useState<string | undefined>(undefined);
  const [liveTaskSubmitPending, setLiveTaskSubmitPending] = useState(false);
  const [visibleSubmittedPrompt, setVisibleSubmittedPrompt] = useState<string | undefined>();
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
  const primaryAction = getComposerPrimaryAction({
    interruptState,
    isPromptDisabled: promptSubmissionControls.visiblePromptDisabled
  });

  useEffect(() => {
    const viewport = conversationViewportRef.current;
    if (!viewport) {
      return;
    }
    viewport.scrollTop = viewport.scrollHeight;
  }, [
    liveTaskId,
    projectId,
    state.assistantContent,
    state.status,
    taskId,
    visibleStatus,
    visibleSubmittedPrompt
  ]);

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

  const replaceWithTerminalTaskRoute = ({
    projectId: nextProjectId,
    taskId: nextTaskId
  }: {
    projectId?: string;
    taskId?: string;
  } = {}) => {
    const terminalProjectId =
      nextProjectId ?? stateRef.current.contextSummary?.projectId ?? projectId;
    const terminalTaskId = nextTaskId ?? stateRef.current.taskId ?? taskId ?? liveTaskId;
    if (!terminalProjectId && !terminalTaskId) {
      return;
    }
    router.replace(
      createStreamingTerminalHref({
        currentSearch: window.location.search,
        ...(terminalProjectId ? { projectId: terminalProjectId } : {}),
        ...(terminalTaskId ? { taskId: terminalTaskId } : {})
      })
    );
  };

  const completeLiveTaskFromFallback = ({
    token,
    ok,
    projectId: completedProjectId,
    taskId: completedTaskId
  }: {
    token: number;
    ok: boolean;
    projectId?: string;
    taskId?: string;
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

    setVisibleSubmittedPrompt(undefined);
    replaceWithTerminalTaskRoute({
      ...(completedProjectId ? { projectId: completedProjectId } : {}),
      ...(completedTaskId ? { taskId: completedTaskId } : {})
    });
    router.refresh();
    const nextState = getLiveTaskSubmitAcceptedStreamingState();
    applyState(nextState);
    dispatch({ type: "clear_live_task_submit_after_refresh" });
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
            implicitProjectName,
            ...(projectId ? { projectId } : {}),
            ...(liveTaskId ? { taskId: liveTaskId } : {})
          })
        )
      });

      if (!response.ok) {
        completeLiveTaskFromFallback({ token, ok: false });
        return;
      }

      const payload = toLiveTaskSubmitSuccessPayload(await response.json().catch(() => undefined));
      completeLiveTaskFromFallback({
        token,
        ok: true,
        ...(payload?.projectId ? { projectId: payload.projectId } : {}),
        ...(payload?.taskId ? { taskId: payload.taskId } : {})
      });
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
    setVisibleSubmittedPrompt(undefined);
    replaceWithTerminalTaskRoute();
    router.refresh();
    const nextState = getTerminalStreamingStateAfterRefresh(stateRef.current, true);
    applyState(nextState);
    dispatch({ type: "clear_transient_after_refresh" });
  };

  const submitStreamingPrompt = async (decision: StreamingSubmitDecision) => {
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
    setVisibleSubmittedPrompt(submittedPromptRef.current);
    setFallbackPrompt(undefined);
    formRef.current?.reset();
    applyState(initialState);
    dispatch({ type: "start" });

    if (shouldSubmitDirectlyToLiveTask({ liveTaskId, streamingTaskId: taskId })) {
      const handoff = startLiveTaskSubmitHandoff({
        state: liveTaskFallbackHandoffRef.current
      });
      applyLiveTaskFallbackHandoffState(handoff.state);

      if (handoff.action.type === "start_live_task") {
        void startLiveTaskFromFallback({
          endpoint: handoff.action.endpoint,
          token: handoff.action.token,
          prompt: submittedPromptRef.current
        });
      }
      return;
    }

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

  const createSubmitDecisionFromForm = (form: HTMLFormElement) => {
    const formData = new FormData(form);
    return getStreamingSubmitDecision({
      promptValue: String(formData.get("prompt") ?? ""),
      skipStreamingOnce: skipStreamingOnceRef.current
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (getComposerSubmitIntent(submitter) === "interrupt") {
      return;
    }

    const decision = createSubmitDecisionFromForm(event.currentTarget);

    if (decision.allowNativeSubmit) {
      skipStreamingOnceRef.current = false;
      return;
    }

    if (decision.preventDefault) {
      event.preventDefault();
    }

    await submitStreamingPrompt(decision);
  };

  const handlePromptKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    if (primaryAction !== "send") {
      return;
    }

    const form = event.currentTarget.form;
    if (!form) {
      return;
    }

    const decision = createSubmitDecisionFromForm(form);
    if (decision.allowNativeSubmit) {
      form.requestSubmit(sendButtonRef.current ?? undefined);
      return;
    }

    void submitStreamingPrompt(decision);
  };

  return (
    <>
      <div className="conversationViewport" ref={conversationViewportRef}>
        <div className="conversationStack">
          {children}
          {visibleSubmittedPrompt ? (
            <div className="userTurn streamingUserTurn" aria-label="You">
              <div className="messageBubble userMessage">
                <ChatMessageContent content={visibleSubmittedPrompt} />
              </div>
            </div>
          ) : null}
          {shouldRenderStreamingTurn(state) ? (
            <article className="assistantTurn streamingTurn" aria-live="polite">
              <div className="assistantIdentity">
                <div className="assistantAvatar">LP</div>
                <strong>LP Agent</strong>
              </div>
              <div className="assistantMessage">
                <StreamingContextSummary state={state} />
                {state.assistantContent ? (
                  <ChatMessageContent content={state.assistantContent} />
                ) : null}
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
          <textarea
            aria-label={promptLabel}
            disabled={promptSubmissionControls.visiblePromptDisabled}
            name="prompt"
            onKeyDown={handlePromptKeyDown}
            placeholder={placeholder}
            rows={1}
          />
          {primaryAction === "send" ? (
            <button
              type="submit"
              className="sendButton"
              disabled={promptSubmissionControls.visiblePromptDisabled}
              ref={sendButtonRef}
            >
              {sendLabel}
            </button>
          ) : (
            <button
              type="submit"
              formAction={interruptAction}
              className="sendButton stopButton"
              data-composer-action="interrupt"
              disabled={primaryAction === "stopping"}
              aria-busy={primaryAction === "stopping" ? true : undefined}
            >
              {primaryAction === "stopping"
                ? interruptLabels.stopping
                : interruptLabels.idle}
            </button>
          )}
        </div>
      </form>
    </>
  );
}
