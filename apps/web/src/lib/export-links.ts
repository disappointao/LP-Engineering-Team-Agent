import { bundleSingleFileHtml, type StaticArtifacts } from "@lp-agent/artifacts";

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
