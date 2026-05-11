import { bundleSingleFileHtml, type StaticArtifacts } from "@lp-agent/artifacts";
import type { DeploymentHandoff } from "@lp-agent/git-deployment";
import type { ExportLabels } from "./i18n";

export interface ArtifactDownloadLink {
  label: string;
  filename: string;
  href: string;
  bytes: number;
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
  const singleFileHtml = bundleSingleFileHtml(artifacts);

  return [
    toDownloadLink(labels.singleHtml, "index.single.html", "text/html", singleFileHtml),
    toDownloadLink(labels.indexHtml, "index.html", "text/html", artifacts.indexHtml),
    toDownloadLink(labels.stylesCss, "styles.css", "text/css", artifacts.stylesCss),
    toDownloadLink(labels.scriptJs, "script.js", "text/javascript", artifacts.scriptJs)
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
