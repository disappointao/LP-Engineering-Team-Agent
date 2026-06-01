import React from "react";
import type { StaticArtifacts } from "@lp-agent/artifacts";
import {
  appendPreviewInspectorQuery,
  createPreviewHtmlDocument
} from "../lib/lp-preview-html";

type LPPreviewProps =
  | {
      artifacts: StaticArtifacts;
      previewHtml?: never;
      previewUrl?: never;
      inspectMode?: boolean;
    }
  | {
      artifacts?: never;
      previewHtml: string;
      previewUrl?: never;
      inspectMode?: boolean;
    }
  | {
      artifacts?: never;
      previewHtml?: never;
      previewUrl: string;
      inspectMode?: boolean;
    };

export function LPPreview(props: LPPreviewProps) {
  const inspectMode = props.inspectMode ?? false;
  const sandbox = "allow-scripts";

  if (props.previewHtml) {
    return (
      <iframe
        className="previewFrame"
        title="Generated landing page preview"
        sandbox={sandbox}
        srcDoc={props.previewHtml}
      />
    );
  }

  if (props.previewUrl) {
    return (
      <iframe
        className="previewFrame"
        title="Generated landing page preview"
        sandbox={sandbox}
        src={inspectMode ? appendPreviewInspectorQuery(props.previewUrl) : props.previewUrl}
      />
    );
  }

  const artifacts = props.artifacts;
  if (!artifacts) {
    throw new Error("LPPreview requires artifacts or previewUrl.");
  }

  const srcDoc = createPreviewHtmlDocument({
    artifacts,
    inspectMode
  });

  return (
    <iframe
      className="previewFrame"
      title="Generated landing page preview"
      sandbox={sandbox}
      srcDoc={srcDoc}
    />
  );
}
