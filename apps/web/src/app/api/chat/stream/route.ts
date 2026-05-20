import {
  encodeChatStreamEvent,
  type ChatStreamEvent
} from "../../../../lib/chat-stream";
import { getWebWorkbenchStore } from "../../../../lib/workbench-store";
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

function createEventStream(events: ChatStreamEvent[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(encodeChatStreamEvent(event)));
      }
      controller.close();
    }
  });
}

function createStreamResponse(events: ChatStreamEvent[], cookies: string[] = []): Response {
  const headers = new Headers({
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store"
  });
  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }
  return new Response(createEventStream(events), { headers });
}

function createCookie(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
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

function getStringOrSessionValue(value: unknown, sessionValue: string | undefined): string | null {
  return typeof value === "string" ? value : sessionValue ?? null;
}

export async function POST(request: Request): Promise<Response> {
  const payload = await readChatStreamRequest(request);
  if (!payload) {
    return createStreamResponse([
      {
        type: "error",
        code: "generation_failed",
        message: "Unable to read chat request."
      }
    ]);
  }

  const [sessionProjectId, sessionTaskId] = await Promise.all([
    getCurrentProjectId(),
    getCurrentTaskId()
  ]);
  const projectId = getStringOrSessionValue(payload.projectId, sessionProjectId);
  const taskId = getStringOrSessionValue(payload.taskId, sessionTaskId);
  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  const store = getWebWorkbenchStore();
  const started = await store.startStreamingChatPrompt({
    projectId,
    taskId,
    prompt
  });

  if (!started.ok) {
    if (started.error === "fallback_required") {
      return createStreamResponse([
        {
          type: "fallback.required",
          reason: "unsupported_task_type",
          taskType: started.taskType,
          message: "Use the standard task flow for this prompt."
        }
      ]);
    }

    return createStreamResponse([
      {
        type: "error",
        code: started.error,
        message: getSafeErrorMessage(started.error)
      }
    ]);
  }

  const events: ChatStreamEvent[] = [
    {
      type: "task.created",
      taskId: started.taskId,
      ...(started.projectId ? { projectId: started.projectId } : {})
    },
    {
      type: "run.status",
      taskId: started.taskId,
      state: "running",
      label: "Generating response"
    },
    ...started.chunks.map(
      (delta): ChatStreamEvent => ({
        type: "assistant.delta",
        taskId: started.taskId,
        messageId: started.assistantMessageId,
        delta
      })
    )
  ];

  const completed = await store.completeStreamingChatPrompt({
    taskId: started.taskId,
    messageId: started.assistantMessageId,
    content: started.assistantContent
  });

  if (completed.ok) {
    events.push(
      {
        type: "assistant.completed",
        taskId: started.taskId,
        messageId: started.assistantMessageId,
        content: started.assistantContent
      },
      {
        type: "run.status",
        taskId: started.taskId,
        state: "completed",
        label: "Response complete"
      }
    );
  } else {
    events.push({
      type: "error",
      code: completed.error,
      message: getSafeErrorMessage(completed.error)
    });
  }

  const cookies = [createCookie(CURRENT_TASK_COOKIE, started.taskId)];
  if (started.projectId) {
    cookies.push(createCookie(CURRENT_PROJECT_COOKIE, started.projectId));
  }
  return createStreamResponse(events, cookies);
}
