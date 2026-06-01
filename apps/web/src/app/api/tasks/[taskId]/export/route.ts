import { bundleSingleFileHtml } from "@lp-agent/artifacts";
import {
  jsonResponse,
  loadCurrentTaskArtifacts,
  type TaskArtifactRouteContext
} from "../artifact-route-helpers";

export const dynamic = "force-dynamic";

type ExportFormat = "single-html" | "index-html" | "styles-css" | "script-js";

type ExportSpec = {
  filename: string;
  contentType: string;
  content: string;
};

export async function GET(
  request: Request,
  context: TaskArtifactRouteContext
): Promise<Response> {
  const url = new URL(request.url);
  const format = parseExportFormat(url.searchParams.get("file"));
  if (!format) {
    return jsonResponse({ ok: false, error: "unsupported_export" }, 400);
  }

  const result = await loadCurrentTaskArtifacts(request, context);
  if (!result.ok) {
    return jsonResponse(result, 404);
  }

  const spec = createExportSpec(format, result.artifacts);
  return new Response(spec.content, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${spec.filename}"`,
      "content-type": `${spec.contentType}; charset=utf-8`
    }
  });
}

function parseExportFormat(value: string | null): ExportFormat | undefined {
  switch (value) {
    case "single-html":
    case "index-html":
    case "styles-css":
    case "script-js":
      return value;
    default:
      return undefined;
  }
}

function createExportSpec(
  format: ExportFormat,
  artifacts: Parameters<typeof bundleSingleFileHtml>[0]
): ExportSpec {
  switch (format) {
    case "single-html":
      return {
        filename: "index.single.html",
        contentType: "text/html",
        content: bundleSingleFileHtml(artifacts)
      };
    case "index-html":
      return {
        filename: "index.html",
        contentType: "text/html",
        content: artifacts.indexHtml
      };
    case "styles-css":
      return {
        filename: "styles.css",
        contentType: "text/css",
        content: artifacts.stylesCss
      };
    case "script-js":
      return {
        filename: "script.js",
        contentType: "application/javascript",
        content: artifacts.scriptJs
      };
  }
}
