import { getWebWorkbenchStore } from "../../../../../lib/workbench-store";
import { getCurrentProjectId } from "../../../../../lib/workbench-session";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ taskId: string }>;
};

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store"
    }
  });
}

function toStatus(error: "task_not_found" | "project_not_found"): number {
  switch (error) {
    case "task_not_found":
      return 404;
    case "project_not_found":
      return 403;
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const [{ taskId }, sessionProjectId] = await Promise.all([
    context.params,
    getCurrentProjectId()
  ]);
  const url = new URL(request.url);
  const artifactPath = url.searchParams.get("artifactPath");
  const store = await getWebWorkbenchStore();
  const result = await store.getLiveTaskState({
    taskId,
    projectId: sessionProjectId ?? null,
    artifactPath
  });

  if (!result.ok) {
    return jsonResponse(result, toStatus(result.error));
  }

  return jsonResponse(result);
}
