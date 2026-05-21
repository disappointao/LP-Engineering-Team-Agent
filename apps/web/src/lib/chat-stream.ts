export type ChatStreamEvent =
  | {
      type: "task.created";
      taskId: string;
      projectId?: string;
    }
  | {
      type: "assistant.delta";
      taskId: string;
      messageId: string;
      delta: string;
    }
  | {
      type: "assistant.completed";
      taskId: string;
      messageId: string;
      content: string;
    }
  | {
      type: "run.status";
      taskId: string;
      state: "queued" | "running" | "completed" | "failed" | "cancelled";
      label: string;
    }
  | {
      type: "context.summary";
      taskId: string;
      projectId?: string;
      projectName?: string;
      runtimeMode: "deterministic" | "real";
      skillCount: number;
      skills: Array<{ id: string; name: string; version: string }>;
    }
  | {
      type: "fallback.required";
      reason: "unsupported_task_type";
      taskType: "lp_generation" | "project_setup";
      message: string;
    }
  | {
      type: "error";
      code: "prompt_required" | "project_not_found" | "generation_failed";
      message: string;
    };

export function encodeChatStreamEvent(event: ChatStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isRunState(
  value: unknown
): value is Extract<ChatStreamEvent, { type: "run.status" }>["state"] {
  return (
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function isRuntimeMode(value: unknown): value is "deterministic" | "real" {
  return value === "deterministic" || value === "real";
}

function isContextSummarySkill(
  value: unknown
): value is { id: string; name: string; version: string } {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["id", "name", "version"]) &&
    isString(value.id) &&
    isString(value.name) &&
    isString(value.version)
  );
}

function isFallbackReason(
  value: unknown
): value is Extract<ChatStreamEvent, { type: "fallback.required" }>["reason"] {
  return value === "unsupported_task_type";
}

function isFallbackTaskType(
  value: unknown
): value is Extract<ChatStreamEvent, { type: "fallback.required" }>["taskType"] {
  return value === "lp_generation" || value === "project_setup";
}

function isErrorCode(
  value: unknown
): value is Extract<ChatStreamEvent, { type: "error" }>["code"] {
  return (
    value === "prompt_required" ||
    value === "project_not_found" ||
    value === "generation_failed"
  );
}

function isChatStreamEvent(value: unknown): value is ChatStreamEvent {
  if (!isRecord(value) || !isString(value.type)) {
    return false;
  }

  switch (value.type) {
    case "task.created":
      return (
        isString(value.taskId) &&
        (value.projectId === undefined || isString(value.projectId))
      );
    case "assistant.delta":
      return isString(value.taskId) && isString(value.messageId) && isString(value.delta);
    case "assistant.completed":
      return isString(value.taskId) && isString(value.messageId) && isString(value.content);
    case "run.status":
      return isString(value.taskId) && isRunState(value.state) && isString(value.label);
    case "context.summary":
      return (
        hasOnlyKeys(value, [
          "type",
          "taskId",
          "projectId",
          "projectName",
          "runtimeMode",
          "skillCount",
          "skills"
        ]) &&
        isString(value.taskId) &&
        (value.projectId === undefined || isString(value.projectId)) &&
        (value.projectName === undefined || isString(value.projectName)) &&
        isRuntimeMode(value.runtimeMode) &&
        isNonNegativeSafeInteger(value.skillCount) &&
        Array.isArray(value.skills) &&
        value.skillCount === value.skills.length &&
        value.skills.every(isContextSummarySkill)
      );
    case "fallback.required":
      return (
        isFallbackReason(value.reason) &&
        isFallbackTaskType(value.taskType) &&
        isString(value.message)
      );
    case "error":
      return isErrorCode(value.code) && isString(value.message);
    default:
      return false;
  }
}

function parseChatStreamEvent(line: string): ChatStreamEvent {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isChatStreamEvent(parsed)) {
      throw new Error("chat_stream_event_invalid");
    }
    return parsed;
  } catch {
    throw new Error("chat_stream_event_invalid");
  }
}

export function decodeChatStreamLines(input: string): {
  events: ChatStreamEvent[];
  remainder: string;
} {
  const lines = input.split("\n");
  const remainder = lines.pop() ?? "";
  const events = lines
    .filter((line) => line.length > 0)
    .map((line) => parseChatStreamEvent(line));
  return { events, remainder };
}

export function chunkAssistantText(content: string, chunkSize = 16): string[] {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
    throw new Error("chat_stream_chunk_size_invalid");
  }
  const chunks: string[] = [];
  for (let index = 0; index < content.length; index += chunkSize) {
    chunks.push(content.slice(index, index + chunkSize));
  }
  return chunks.length > 0 ? chunks : [""];
}
