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
      state: "queued" | "running" | "completed" | "failed";
      label: string;
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

export function decodeChatStreamLines(input: string): {
  events: ChatStreamEvent[];
  remainder: string;
} {
  const lines = input.split("\n");
  const remainder = lines.pop() ?? "";
  const events = lines
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ChatStreamEvent);
  return { events, remainder };
}

export function chunkAssistantText(content: string, chunkSize = 16): string[] {
  if (chunkSize < 1) {
    throw new Error("chat_stream_chunk_size_invalid");
  }
  const chunks: string[] = [];
  for (let index = 0; index < content.length; index += chunkSize) {
    chunks.push(content.slice(index, index + chunkSize));
  }
  return chunks.length > 0 ? chunks : [""];
}
