import type { StaticArtifacts } from "@lp-agent/artifacts";
import {
  getWebWorkbenchStore,
  type WorkbenchPageState
} from "../../../../lib/workbench-store";
import { getCurrentProjectId } from "../../../../lib/workbench-session";

export type TaskArtifactRouteContext = {
  params: Promise<{ taskId: string }>;
};

export type TaskArtifactsResult =
  | {
      ok: true;
      taskId: string;
      pageVersionId: string;
      artifacts: StaticArtifacts;
    }
  | {
      ok: false;
      error: "preview_not_ready";
    };

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store"
    }
  });
}

export async function loadCurrentTaskArtifacts(
  request: Request,
  context: TaskArtifactRouteContext
): Promise<TaskArtifactsResult> {
  const [{ taskId }, sessionProjectId] = await Promise.all([
    context.params,
    getCurrentProjectId()
  ]);
  const url = new URL(request.url);
  const explicitProjectId = url.searchParams.get("projectId")?.trim() || null;
  const store = await getWebWorkbenchStore();
  const pageState = await store.getPageState({
    taskId,
    projectId: explicitProjectId ?? sessionProjectId ?? null
  });
  const pageVersion = getCurrentPageVersionWithArtifacts(pageState);

  if (!pageVersion) {
    return {
      ok: false,
      error: "preview_not_ready"
    };
  }

  return {
    ok: true,
    taskId,
    pageVersionId: pageVersion.id,
    artifacts: pageVersion.artifacts
  };
}

function getCurrentPageVersionWithArtifacts(
  pageState: WorkbenchPageState
): { id: string; artifacts: StaticArtifacts } | undefined {
  if (pageState.kind !== "task_ready") {
    return undefined;
  }

  const pageVersion = pageState.snapshot?.currentPageVersion;
  if (!pageVersion?.artifacts) {
    return undefined;
  }

  return {
    id: pageVersion.id,
    artifacts: pageVersion.artifacts
  };
}
