import type { ChatStreamEvent } from "../lib/chat-stream";

export type StreamingWorkbenchStatus =
  | "idle"
  | "streaming"
  | "completed"
  | "error"
  | "fallback_required";

export type StreamingWorkbenchState = {
  status: StreamingWorkbenchStatus;
  taskId: string | undefined;
  assistantMessageId: string | undefined;
  assistantContent: string;
  errorMessage: string | undefined;
  fallbackMessage: string | undefined;
};

export function createInitialStreamingWorkbenchState(): StreamingWorkbenchState {
  return {
    status: "idle",
    taskId: undefined,
    assistantMessageId: undefined,
    assistantContent: "",
    errorMessage: undefined,
    fallbackMessage: undefined
  };
}

export function reduceStreamingWorkbenchEvent(
  state: StreamingWorkbenchState,
  event: ChatStreamEvent
): StreamingWorkbenchState {
  switch (event.type) {
    case "task.created":
      return {
        status: "streaming",
        taskId: event.taskId,
        assistantMessageId: undefined,
        assistantContent: "",
        errorMessage: undefined,
        fallbackMessage: undefined
      };
    case "run.status":
      if (event.state === "queued" || event.state === "running") {
        return {
          ...state,
          status: "streaming",
          taskId: event.taskId
        };
      }
      if (event.state === "completed") {
        return {
          ...state,
          status: "completed",
          taskId: event.taskId
        };
      }
      return {
        ...state,
        status: "error",
        taskId: event.taskId,
        errorMessage: event.label
      };
    case "assistant.delta":
      return {
        ...state,
        status: "streaming",
        taskId: event.taskId,
        assistantMessageId: event.messageId,
        assistantContent: `${state.assistantContent}${event.delta}`
      };
    case "assistant.completed":
      return {
        ...state,
        status: "completed",
        taskId: event.taskId,
        assistantMessageId: event.messageId,
        assistantContent: event.content,
        errorMessage: undefined
      };
    case "fallback.required":
      return {
        ...state,
        status: "fallback_required",
        errorMessage: undefined,
        fallbackMessage: event.message
      };
    case "error":
      return {
        ...state,
        status: "error",
        errorMessage: event.message
      };
  }
}
