import {
  encodeChatStreamEvent,
  type ChatStreamErrorCode,
  type ChatStreamEvent
} from "../../../../lib/chat-stream";
import {
  getWebWorkbenchStore,
  type ProjectFlowErrorCode,
  type WebWorkbenchStore
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

type ProjectFlowChatStreamErrorCode = Extract<
  ChatStreamErrorCode,
  "prompt_required" | "project_not_found" | "generation_failed"
>;

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

type ChatStreamProducerState = {
  isClosed: () => boolean;
  cancelled: Promise<void>;
};

type StartedStreamingChatPrompt = Extract<
  Awaited<ReturnType<WebWorkbenchStore["startStreamingChatPrompt"]>>,
  { ok: true }
>;

function createEventStream(
  produceEvents: (
    enqueue: ChatStreamEnqueue,
    state: ChatStreamProducerState
  ) => Promise<void> | void
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;
  let resolveCancelled!: () => void;
  const cancelled = new Promise<void>((resolve) => {
    resolveCancelled = resolve;
  });
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
        .then(() => produceEvents(enqueue, { isClosed: () => closed, cancelled }))
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
      resolveCancelled();
    }
  });
}

function createStreamResponse(
  produceEvents: (
    enqueue: ChatStreamEnqueue,
    state: ChatStreamProducerState
  ) => Promise<void> | void,
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

function getSafeErrorMessage(error: ChatStreamErrorCode) {
  switch (error) {
    case "prompt_required":
      return "Enter a prompt before sending.";
    case "project_not_found":
      return "The selected project is unavailable.";
    case "provider_configuration_failed":
      return "Check the project model provider configuration before retrying.";
    case "stream_interrupted":
      return "The provider stream stopped before the response completed.";
    case "empty_response":
      return "The provider completed without usable assistant text.";
    case "persistence_failed":
      return "The response was generated but could not be saved.";
    case "generation_failed":
      return "The chat response could not be generated.";
  }
}

function toChatStreamErrorCode(error: ProjectFlowErrorCode): ProjectFlowChatStreamErrorCode {
  switch (error) {
    case "prompt_required":
    case "project_not_found":
    case "generation_failed":
      return error;
    default:
      return "generation_failed";
  }
}

function toChatStreamErrorCodeFromUnknown(error: unknown): ChatStreamErrorCode {
  const code = (error as { code?: unknown })?.code;
  if (
    code === "provider_configuration_failed" ||
    code === "stream_interrupted" ||
    code === "empty_response"
  ) {
    return code;
  }
  return "generation_failed";
}

function getTerminalErrorLabel(code: ChatStreamErrorCode): string {
  switch (code) {
    case "provider_configuration_failed":
      return "Provider configuration failed";
    case "stream_interrupted":
      return "Provider stream interrupted";
    case "empty_response":
      return "Provider returned empty response";
    case "persistence_failed":
      return "Response persistence failed";
    default:
      return "Response generation failed";
  }
}

function enqueueTerminalError(
  enqueue: ChatStreamEnqueue,
  taskId: string | undefined,
  code: ChatStreamErrorCode
): void {
  if (taskId) {
    enqueue({
      type: "run.status",
      taskId,
      state: "failed",
      label: getTerminalErrorLabel(code)
    });
  }
  enqueue({
    type: "error",
    code,
    message: getSafeErrorMessage(code)
  });
}

async function abandonStreamingPlaceholder(
  store: WebWorkbenchStore,
  started: StartedStreamingChatPrompt
): Promise<void> {
  try {
    await store.abandonStreamingChatPrompt({
      taskId: started.taskId,
      messageId: started.assistantMessageId
    });
  } catch {
    // Preserve the original terminal stream outcome; cleanup is best-effort.
  }
}

function cancelAssistantStream(
  started: StartedStreamingChatPrompt,
  iterator?: AsyncIterator<string>
): void {
  try {
    started.cancelAssistantStream?.();
  } catch {
    // Cancellation cleanup is best-effort.
  }
  if (iterator?.return) {
    void Promise.resolve(iterator.return()).catch(() => undefined);
  }
}

async function readAssistantStreamDelta(
  iterator: AsyncIterator<string>,
  state: ChatStreamProducerState
): Promise<
  | { type: "delta"; delta: string }
  | { type: "done" }
  | { type: "cancelled" }
> {
  const next = await Promise.race([
    iterator.next().then((result) => ({ type: "next" as const, result })),
    state.cancelled.then(() => ({ type: "cancelled" as const }))
  ]);
  if (next.type === "cancelled") {
    return { type: "cancelled" };
  }
  if (next.result.done) {
    return { type: "done" };
  }
  return { type: "delta", delta: next.result.value };
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
  return createStreamResponse(async (enqueue, streamState) => {
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
    try {
      if (started.assistantStream) {
        const iterator = started.assistantStream[Symbol.asyncIterator]();
        for (;;) {
          const read = await readAssistantStreamDelta(iterator, streamState);
          if (read.type === "cancelled") {
            cancelAssistantStream(started, iterator);
            await abandonStreamingPlaceholder(store, started);
            return;
          }
          if (read.type === "done") {
            break;
          }
          const delta = read.delta;
          assistantContent += delta;
          enqueue({
            type: "assistant.delta",
            taskId: started.taskId,
            messageId: started.assistantMessageId,
            delta
          });
          if (streamState.isClosed()) {
            cancelAssistantStream(started, iterator);
            await abandonStreamingPlaceholder(store, started);
            return;
          }
        }
      } else {
        for (const delta of started.chunks) {
          enqueue({
            type: "assistant.delta",
            taskId: started.taskId,
            messageId: started.assistantMessageId,
            delta
          });
          if (streamState.isClosed()) {
            await abandonStreamingPlaceholder(store, started);
            return;
          }
        }
      }
    } catch (error) {
      await abandonStreamingPlaceholder(store, started);
      enqueueTerminalError(enqueue, started.taskId, toChatStreamErrorCodeFromUnknown(error));
      return;
    }

    if (streamState.isClosed()) {
      await abandonStreamingPlaceholder(store, started);
      return;
    }
    if (!assistantContent.trim()) {
      await abandonStreamingPlaceholder(store, started);
      enqueueTerminalError(enqueue, started.taskId, "empty_response");
      return;
    }

    let completed: Awaited<ReturnType<typeof store.completeStreamingChatPrompt>>;
    try {
      completed = await store.completeStreamingChatPrompt({
        taskId: started.taskId,
        messageId: started.assistantMessageId,
        content: assistantContent
      });
    } catch {
      await abandonStreamingPlaceholder(store, started);
      enqueueTerminalError(enqueue, started.taskId, "persistence_failed");
      return;
    }

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

    await abandonStreamingPlaceholder(store, started);
    enqueueTerminalError(enqueue, started.taskId, "persistence_failed");
  }, cookies);
}
