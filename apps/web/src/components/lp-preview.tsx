import { bundleSingleFileHtml, type StaticArtifacts } from "@lp-agent/artifacts";

interface LPPreviewProps {
  artifacts: StaticArtifacts;
}

export function LPPreview({ artifacts }: LPPreviewProps) {
  const srcDoc = bundleSingleFileHtml(artifacts);

  return (
    <iframe
      className="previewFrame"
      title="Generated landing page preview"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
    />
  );
}
