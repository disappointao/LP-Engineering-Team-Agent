import {
  encodeChatStreamEvent,
  type ChatStreamEvent
} from "../../../../lib/chat-stream";
import {
  getWebWorkbenchStore,
  type ProjectFlowErrorCode
} from "../../../../lib/workbench-store";
import {
  CURRENT_PROJECT_COOKIE,
  CURRENT_TASK_COOKIE,
  getCurrentProjectId,
  getCurrentTaskId
} from "../../../../lib/workbench-session";

export const dynamic = "force-dynamic";

type ChatStreamRequest = {
  projectId?: string | null;
  taskId?: string | null;
  prompt?: unknown;
};

type ChatStreamErrorCode = Extract<ChatStreamEvent, { type: "error" }>["code"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readChatStreamRequest(request: Request): Promise<ChatStreamRequest | undefined> {
  try {
    const json: unknown = await request.json();
    return isRecord(json) ? json : {};
  } catch {
    return undefined;
  }
}

type ChatStreamEnqueue = (event: ChatStreamEvent) => void;

function createEventStream(
  produceEvents: (enqueue: ChatStreamEnqueue) => Promise<void> | void
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;
  return new ReadableStream({
    start(controller) {
      const enqueue: ChatStreamEnqueue = (event) => {
        if (closed) {
          return;
        }
        const chunk = encoder.encode(encodeChatStreamEvent(event));
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        try {
          controller.close();
        } catch {
          // The client can cancel between the closed check and close attempt.
        }
      };
      void Promise.resolve()
        .then(() => produceEvents(enqueue))
        .catch(() => {
          enqueue({
            type: "error",
            code: "generation_failed",
            message: getSafeErrorMessage("generation_failed")
          });
        })
        .finally(() => {
          close();
        });
    },
    cancel() {
      closed = true;
    }
  });
}

function createStreamResponse(
  produceEvents: (enqueue: ChatStreamEnqueue) => Promise<void> | void,
  cookies: string[] = []
): Response {
  const headers = new Headers({
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store"
  });
  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }
  return new Response(createEventStream(produceEvents), { headers });
}

function createSingleEventResponse(event: ChatStreamEvent): Response {
  return createStreamResponse((enqueue) => {
    enqueue(event);
  });
}

function createCookie(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
}

function createExpiredCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function getSafeErrorMessage(error: "prompt_required" | "project_not_found" | "generation_failed") {
  switch (error) {
    case "prompt_required":
      return "Enter a prompt before sending.";
    case "project_not_found":
      return "The selected project is unavailable.";
    case "generation_failed":
      return "The chat response could not be generated.";
  }
}

function toChatStreamErrorCode(error: ProjectFlowErrorCode): ChatStreamErrorCode {
  switch (error) {
    case "prompt_required":
    case "project_not_found":
    case "generation_failed":
      return error;
    default:
      return "generation_failed";
  }
}

function hasOwnField(payload: ChatStreamRequest, field: keyof ChatStreamRequest): boolean {
  return Object.prototype.hasOwnProperty.call(payload, field);
}

function getStringOrNullOrSessionValue({
  hasValue,
  value,
  sessionValue
}: {
  hasValue: boolean;
  value: unknown;
  sessionValue: string | undefined;
}): string | null {
  if (!hasValue || value === undefined) {
    return sessionValue ?? null;
  }
  if (value === null) {
    return null;
  }
  return typeof value === "string" ? value : sessionValue ?? null;
}

export async function POST(request: Request): Promise<Response> {
  const payload = await readChatStreamRequest(request);
  if (!payload) {
    return createSingleEventResponse({
      type: "error",
      code: "generation_failed",
      message: "Unable to read chat request."
    });
  }

  const [sessionProjectId, sessionTaskId] = await Promise.all([
    getCurrentProjectId(),
    getCurrentTaskId()
  ]);
  const projectId = getStringOrNullOrSessionValue({
    hasValue: hasOwnField(payload, "projectId"),
    value: payload.projectId,
    sessionValue: sessionProjectId
  });
  const taskId = getStringOrNullOrSessionValue({
    hasValue: hasOwnField(payload, "taskId"),
    value: payload.taskId,
    sessionValue: sessionTaskId
  });
  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  const store = await getWebWorkbenchStore();
  const started = await store.startStreamingChatPrompt({
    projectId,
    taskId,
    prompt
  });

  if (!started.ok) {
    if (started.error === "fallback_required") {
      return createSingleEventResponse({
        type: "fallback.required",
        reason: "unsupported_task_type",
        taskType: started.taskType,
        message: "Use the standard task flow for this prompt."
      });
    }

    const errorCode = toChatStreamErrorCode(started.error);
    if (started.taskId) {
      const taskId = started.taskId;
      const projectId = started.projectId;
      const cookies = [createCookie(CURRENT_TASK_COOKIE, taskId)];
      if (projectId) {
        cookies.push(createCookie(CURRENT_PROJECT_COOKIE, projectId));
      }
      return createStreamResponse((enqueue) => {
        enqueue({
          type: "task.created",
          taskId,
          ...(projectId ? { projectId } : {})
        });
        enqueue({
          type: "error",
          code: errorCode,
          message: getSafeErrorMessage(errorCode)
        });
      }, cookies);
    }
    return createSingleEventResponse({
      type: "error",
      code: errorCode,
      message: getSafeErrorMessage(errorCode)
    });
  }

  const cookies = [createCookie(CURRENT_TASK_COOKIE, started.taskId)];
  if (started.projectId) {
    cookies.push(createCookie(CURRENT_PROJECT_COOKIE, started.projectId));
  } else if (hasOwnField(payload, "projectId") && payload.projectId === null) {
    cookies.push(createExpiredCookie(CURRENT_PROJECT_COOKIE));
  }
  return createStreamResponse(async (enqueue) => {
    enqueue({
      type: "task.created",
      taskId: started.taskId,
      ...(started.projectId ? { projectId: started.projectId } : {})
    });
    enqueue({
      type: "context.summary",
      taskId: started.taskId,
      ...started.contextSummary
    });
    enqueue({
      type: "run.status",
      taskId: started.taskId,
      state: "running",
      label: "Generating response"
    });
    let assistantContent = started.assistantStream ? "" : started.assistantContent;
    if (started.assistantStream) {
      for await (const delta of started.assistantStream) {
        assistantContent += delta;
        enqueue({
          type: "assistant.delta",
          taskId: started.taskId,
          messageId: started.assistantMessageId,
          delta
        });
      }
    } else {
      for (const delta of started.chunks) {
        enqueue({
          type: "assistant.delta",
          taskId: started.taskId,
          messageId: started.assistantMessageId,
          delta
        });
      }
    }

    const completed = await store.completeStreamingChatPrompt({
      taskId: started.taskId,
      messageId: started.assistantMessageId,
      content: assistantContent
    });

    if (completed.ok) {
      enqueue({
        type: "assistant.completed",
        taskId: started.taskId,
        messageId: started.assistantMessageId,
        content: assistantContent
      });
      enqueue({
        type: "run.status",
        taskId: started.taskId,
        state: "completed",
        label: "Response complete"
      });
      return;
    }

    const errorCode = toChatStreamErrorCode(completed.error);
    enqueue({
      type: "error",
      code: errorCode,
      message: getSafeErrorMessage(errorCode)
    });
  }, cookies);
}
