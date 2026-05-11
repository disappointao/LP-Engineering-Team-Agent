import { bundleSingleFileHtml, type StaticArtifacts } from "@lp-agent/artifacts";
import type { DeploymentHandoff } from "@lp-agent/git-deployment";

export interface ArtifactDownloadLink {
  label: string;
  filename: string;
  href: string;
  bytes: number;
}

export function createArtifactDownloadLinks(artifacts: StaticArtifacts): ArtifactDownloadLink[] {
  const singleFileHtml = bundleSingleFileHtml(artifacts);

  return [
    toDownloadLink("Export Single HTML", "index.single.html", "text/html", singleFileHtml),
    toDownloadLink("Export index.html", "index.html", "text/html", artifacts.indexHtml),
    toDownloadLink("Export styles.css", "styles.css", "text/css", artifacts.stylesCss),
    toDownloadLink("Export script.js", "script.js", "text/javascript", artifacts.scriptJs)
  ];
}

export function createDeploymentHandoffLink(handoff: DeploymentHandoff): ArtifactDownloadLink {
  const manifest = {
    id: handoff.id,
    projectId: handoff.projectId,
    pageVersionId: handoff.pageVersionId,
    branch: handoff.branch,
    commitSha: handoff.commitSha,
    pullRequestUrl: handoff.pullRequestUrl,
    files: [...handoff.files],
    status: handoff.status,
    nextAction: "Apply these files to the target repository branch and open a provider PR."
  };

  return toDownloadLink(
    "Export PR Handoff",
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
