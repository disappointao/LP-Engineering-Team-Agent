import { bundleSingleFileHtml, type StaticArtifacts } from "@lp-agent/artifacts";
import type { DeploymentHandoff } from "@lp-agent/git-deployment";
import type { ExportLabels } from "./i18n";

export interface ArtifactDownloadLink {
  label: string;
  filename: string;
  href: string;
  bytes?: number;
}

export interface ArtifactExportDescriptor {
  label: string;
  filename: string;
  mimeType: string;
  content: string;
  bytes: number;
}

export interface TaskArtifactRouteLinkInput {
  labels?: Pick<ExportLabels, "singleHtml" | "separatedFiles">;
  pageVersionId?: string;
  projectId?: string;
  taskId: string;
}

export function createArtifactDownloadLinks(
  artifacts: StaticArtifacts,
  labels: Pick<ExportLabels, "singleHtml" | "indexHtml" | "stylesCss" | "scriptJs"> = {
    singleHtml: "Export Single HTML",
    indexHtml: "Export index.html",
    stylesCss: "Export styles.css",
    scriptJs: "Export script.js"
  }
): ArtifactDownloadLink[] {
  return createArtifactExportDescriptors(artifacts, labels).map((descriptor) =>
    toDownloadLink(
      descriptor.label,
      descriptor.filename,
      descriptor.mimeType,
      descriptor.content
    )
  );
}

export function createTaskArtifactRouteDownloadLinks({
  labels = {
    singleHtml: "Export Single HTML",
    separatedFiles: "Export HTML/CSS/JS ZIP"
  },
  pageVersionId,
  projectId,
  taskId
}: TaskArtifactRouteLinkInput): ArtifactDownloadLink[] {
  const taskPath = `/api/tasks/${encodeURIComponent(taskId)}/export`;
  return [
    {
      label: labels.singleHtml,
      filename: "index.single.html",
      href: createTaskArtifactRouteHref({
        file: "single-html",
        pageVersionId,
        projectId,
        taskPath
      })
    },
    {
      label: labels.separatedFiles,
      filename: "lp-static-files.zip",
      href: createTaskArtifactRouteHref({
        file: "split-zip",
        pageVersionId,
        projectId,
        taskPath
      })
    }
  ];
}

export function createTaskArtifactPreviewUrl({
  pageVersionId,
  projectId,
  taskId
}: {
  pageVersionId?: string;
  projectId?: string;
  taskId: string;
}): string {
  const params = createTaskArtifactRouteParams({ pageVersionId, projectId });
  const query = params.toString();
  return `/api/tasks/${encodeURIComponent(taskId)}/preview${query ? `?${query}` : ""}`;
}

export function createArtifactExportDescriptors(
  artifacts: StaticArtifacts,
  labels: Pick<ExportLabels, "singleHtml" | "indexHtml" | "stylesCss" | "scriptJs"> = {
    singleHtml: "Export Single HTML",
    indexHtml: "Export index.html",
    stylesCss: "Export styles.css",
    scriptJs: "Export script.js"
  }
): ArtifactExportDescriptor[] {
  const singleFileHtml = bundleSingleFileHtml(artifacts);
  return [
    toExportDescriptor(labels.singleHtml, "index.single.html", "text/html", singleFileHtml),
    toExportDescriptor(labels.indexHtml, "index.html", "text/html", artifacts.indexHtml),
    toExportDescriptor(labels.stylesCss, "styles.css", "text/css", artifacts.stylesCss),
    toExportDescriptor(labels.scriptJs, "script.js", "text/javascript", artifacts.scriptJs)
  ];
}

export function createDeploymentHandoffLink(
  handoff: DeploymentHandoff,
  labels: Pick<ExportLabels, "handoff" | "handoffNextAction"> = {
    handoff: "Export PR Handoff",
    handoffNextAction: "Apply these files to the target repository branch and open a provider PR."
  }
): ArtifactDownloadLink {
  const manifest = {
    id: handoff.id,
    projectId: handoff.projectId,
    pageVersionId: handoff.pageVersionId,
    branch: handoff.branch,
    commitSha: handoff.commitSha,
    pullRequestUrl: handoff.pullRequestUrl,
    files: [...handoff.files],
    status: handoff.status,
    nextAction: labels.handoffNextAction
  };

  return toDownloadLink(
    labels.handoff,
    "deployment-handoff.json",
    "application/json",
    JSON.stringify(manifest, null, 2)
  );
}

function toDownloadLink(
  label: string,
  filename: string,
  mimeType: string,
  content: string
): ArtifactDownloadLink {
  return {
    label,
    filename,
    href: `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`,
    bytes: content.length
  };
}

function toExportDescriptor(
  label: string,
  filename: string,
  mimeType: string,
  content: string
): ArtifactExportDescriptor {
  return {
    label,
    filename,
    mimeType,
    content,
    bytes: content.length
  };
}

function createTaskArtifactRouteHref({
  file,
  pageVersionId,
  projectId,
  taskPath
}: {
  file: string;
  pageVersionId?: string;
  projectId?: string;
  taskPath: string;
}): string {
  const params = createTaskArtifactRouteParams({ pageVersionId, projectId });
  params.set("file", file);
  return `${taskPath}?${params.toString()}`;
}

function createTaskArtifactRouteParams({
  pageVersionId,
  projectId
}: {
  pageVersionId?: string;
  projectId?: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  const trimmedProjectId = projectId?.trim();
  if (trimmedProjectId) {
    params.set("projectId", trimmedProjectId);
  }
  const trimmedPageVersionId = pageVersionId?.trim();
  if (trimmedPageVersionId) {
    params.set("version", trimmedPageVersionId);
  }
  return params;
}
