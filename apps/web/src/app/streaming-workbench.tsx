"use client";

import React, { useReducer, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  decodeChatStreamLines,
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
  interruptControl?: React.ReactNode;
}

type StreamingWorkbenchAction =
  | { type: "start" }
  | { type: "event"; event: ChatStreamEvent }
  | { type: "error"; message: string };

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
        errorMessage: action.message
      };
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

function getVisibleStreamingStatus(
  state: StreamingWorkbenchState,
  streamingStatusLabel: string,
  streamingErrorLabel: string
): string | undefined {
  if (state.status === "streaming") {
    return streamingStatusLabel;
  }
  if (state.status === "error") {
    return streamingErrorLabel;
  }
  if (state.status === "fallback_required") {
    return state.fallbackMessage ?? streamingErrorLabel;
  }
  return undefined;
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
  interruptControl
}: StreamingWorkbenchProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const skipStreamingOnceRef = useRef(false);
  const fallbackSubmittedRef = useRef(false);
  const stateRef = useRef(createInitialStreamingWorkbenchState());
  const [state, dispatch] = useReducer(
    streamingWorkbenchReducer,
    createInitialStreamingWorkbenchState()
  );
  const isStreaming = state.status === "streaming";
  const visibleStatus = getVisibleStreamingStatus(
    state,
    streamingStatusLabel,
    streamingErrorLabel
  );

  const applyState = (nextState: StreamingWorkbenchState) => {
    stateRef.current = nextState;
  };

  const dispatchEvent = (event: ChatStreamEvent) => {
    const nextState = reduceStreamingWorkbenchEvent(stateRef.current, event);
    applyState(nextState);
    dispatch({ type: "event", event });

    if (event.type === "fallback.required" && !fallbackSubmittedRef.current) {
      fallbackSubmittedRef.current = true;
      skipStreamingOnceRef.current = true;
      formRef.current?.requestSubmit();
    }
  };

  const dispatchError = () => {
    const nextState: StreamingWorkbenchState = {
      ...stateRef.current,
      status: "error",
      errorMessage: streamingErrorLabel
    };
    applyState(nextState);
    dispatch({ type: "error", message: streamingErrorLabel });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    if (skipStreamingOnceRef.current) {
      skipStreamingOnceRef.current = false;
      return;
    }

    const formData = new FormData(event.currentTarget);
    const prompt = String(formData.get("prompt") ?? "").trim();
    if (!prompt) {
      return;
    }

    event.preventDefault();
    const initialState = {
      ...createInitialStreamingWorkbenchState(),
      status: "streaming" as const
    };
    fallbackSubmittedRef.current = false;
    applyState(initialState);
    dispatch({ type: "start" });

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ prompt, projectId, taskId })
      });

      if (!response.ok || !response.body) {
        dispatchError();
        router.refresh();
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
        router.refresh();
      }
    } catch {
      dispatchError();
      router.refresh();
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
        <div className="composer">
          <button type="button" aria-label={addAttachmentLabel}>
            +
          </button>
          <input
            aria-label={promptLabel}
            disabled={isStreaming}
            name="prompt"
            placeholder={placeholder}
          />
          <span>{runtimeChip}</span>
          {interruptControl}
          <button type="submit" className="sendButton" disabled={isStreaming}>
            {sendLabel}
          </button>
        </div>
      </form>
    </>
  );
}
