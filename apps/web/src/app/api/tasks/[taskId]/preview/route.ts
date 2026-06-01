import { createPreviewHtmlDocument } from "../../../../../lib/lp-preview-html";
import {
  jsonResponse,
  loadCurrentTaskArtifacts,
  type TaskArtifactRouteContext
} from "../artifact-route-helpers";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: TaskArtifactRouteContext
): Promise<Response> {
  const result = await loadCurrentTaskArtifacts(request, context);
  if (!result.ok) {
    return jsonResponse(result, 404);
  }

  const url = new URL(request.url);
  const body = createPreviewHtmlDocument({
    artifacts: result.artifacts,
    inspectMode: url.searchParams.get("inspect") === "1"
  });

  return new Response(body, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8"
    }
  });
}
