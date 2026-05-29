import type { ChatStreamErrorCode, ChatStreamEvent } from "../lib/chat-stream";

export type StreamingWorkbenchStatus =
  | "idle"
  | "streaming"
  | "completed"
  | "error"
  | "fallback_required";

export interface StreamingContextSummary {
  taskId: string;
  projectId?: string;
  projectName?: string;
  runtimeMode: "deterministic" | "real";
  skillCount: number;
  skills: Array<{ id: string; name: string; version: string }>;
}

export type StreamingWorkbenchState = {
  status: StreamingWorkbenchStatus;
  taskId: string | undefined;
  assistantMessageId: string | undefined;
  assistantContent: string;
  errorMessage: string | undefined;
  statusMessage: string | undefined;
  errorCode: ChatStreamErrorCode | undefined;
  fallbackMessage: string | undefined;
  contextSummary: StreamingContextSummary | undefined;
};

export function createInitialStreamingWorkbenchState(): StreamingWorkbenchState {
  return {
    status: "idle",
    taskId: undefined,
    assistantMessageId: undefined,
    assistantContent: "",
    errorMessage: undefined,
    statusMessage: undefined,
    errorCode: undefined,
    fallbackMessage: undefined,
    contextSummary: undefined
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
        statusMessage: undefined,
        errorCode: undefined,
        fallbackMessage: undefined,
        contextSummary: undefined
      };
    case "context.summary":
      return {
        ...state,
        taskId: event.taskId,
        contextSummary: {
          taskId: event.taskId,
          ...(event.projectId ? { projectId: event.projectId } : {}),
          ...(event.projectName ? { projectName: event.projectName } : {}),
          runtimeMode: event.runtimeMode,
          skillCount: event.skillCount,
          skills: event.skills.map((skill) => ({ ...skill }))
        }
      };
    case "run.status":
      if (event.state === "queued" || event.state === "running") {
        return {
          ...state,
          status: "streaming",
          taskId: event.taskId,
          statusMessage: undefined
        };
      }
      if (event.state === "completed") {
        return {
          ...state,
          status: "completed",
          taskId: event.taskId,
          statusMessage: event.label
        };
      }
      return {
        ...state,
        status: "error",
        taskId: event.taskId,
        statusMessage: event.label,
        errorMessage: event.label
      };
    case "assistant.delta":
      return {
        ...state,
        status: "streaming",
        taskId: event.taskId,
        assistantMessageId: event.messageId,
        assistantContent: `${state.assistantContent}${event.delta}`,
        statusMessage: undefined
      };
    case "assistant.completed":
      return {
        ...state,
        status: "completed",
        taskId: event.taskId,
        assistantMessageId: event.messageId,
        assistantContent: event.content,
        errorMessage: undefined,
        statusMessage: undefined,
        errorCode: undefined
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
        errorCode: event.code,
        errorMessage: event.message
      };
  }
}
