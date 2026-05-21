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

type LiveTaskSubmitRequest = {
  projectId?: unknown;
  taskId?: unknown;
  prompt?: unknown;
  implicitProjectName?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readRequest(request: Request): Promise<LiveTaskSubmitRequest | undefined> {
  try {
    const payload: unknown = await request.json();
    return isRecord(payload) ? payload : {};
  } catch {
    return undefined;
  }
}

function createCookie(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
}

function jsonResponse(body: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({
    "cache-control": "no-store"
  });
  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }
  return Response.json(body, { status, headers });
}

function toStatus(error: ProjectFlowErrorCode): number {
  switch (error) {
    case "prompt_required":
      return 400;
    case "project_not_found":
      return 404;
    default:
      return 500;
  }
}

function hasOwnField(payload: LiveTaskSubmitRequest, field: keyof LiveTaskSubmitRequest): boolean {
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
  const payload = await readRequest(request);
  if (!payload) {
    return jsonResponse({ ok: false, error: "generation_failed" }, 400);
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
  const implicitProjectName =
    typeof payload.implicitProjectName === "string"
      ? payload.implicitProjectName
      : "Untitled LP Project";
  const store = await getWebWorkbenchStore();
  const started = await store.startLiveTaskPrompt({
    taskId,
    projectId,
    prompt,
    implicitProjectName
  });

  if (!started.ok) {
    return jsonResponse(started, toStatus(started.error));
  }

  const cookies = [createCookie(CURRENT_TASK_COOKIE, started.taskId)];
  if (started.projectId) {
    cookies.push(createCookie(CURRENT_PROJECT_COOKIE, started.projectId));
  }

  return jsonResponse(
    {
      ok: true,
      taskId: started.taskId,
      taskType: started.taskType,
      ...(started.projectId ? { projectId: started.projectId } : {})
    },
    200,
    cookies
  );
}
