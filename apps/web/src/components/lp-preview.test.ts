import { describe, expect, it } from "vitest";
import type { StaticArtifacts } from "@lp-agent/artifacts";
import { LPPreview } from "./lp-preview";

const artifacts: StaticArtifacts = {
  indexHtml: [
    "<!doctype html><html><head>",
    "<link rel=\"stylesheet\" href=\"styles.css\">",
    "</head><body>",
    "<main><h1 class=\"hero-title\">Preview first</h1></main>",
    "  <script src=\"script.js\"></script>",
    "</body></html>"
  ].join(""),
  stylesCss: "body { color: #111827; }",
  scriptJs: "window.lpAgent = true;"
};

describe("LPPreview", () => {
  it("keeps the normal static preview free of the inspector bridge", () => {
    const preview = LPPreview({ artifacts });

    expect(preview.props.srcDoc).toContain("Preview first");
    expect(preview.props.srcDoc).not.toContain("lp-preview-element-selected");
  });

  it("injects an inspector bridge when inspect mode is enabled", () => {
    const preview = LPPreview({ artifacts, inspectMode: true });

    expect(preview.props.srcDoc).toContain("Preview first");
    expect(preview.props.srcDoc).toContain("lp-preview-element-selected");
    expect(preview.props.srcDoc).toContain("data-lp-preview-inspector");
    expect(preview.props.sandbox).toBe("allow-scripts");
  });

  it("can render a route-backed preview URL and toggle inspector mode by query", () => {
    const plain = LPPreview({
      previewUrl: "/api/tasks/task_1/preview?projectId=project_1"
    });
    const inspect = LPPreview({
      previewUrl: "/api/tasks/task_1/preview?projectId=project_1",
      inspectMode: true
    });

    expect(plain.props.src).toBe("/api/tasks/task_1/preview?projectId=project_1");
    expect(plain.props.srcDoc).toBeUndefined();
    expect(plain.props.sandbox).toBe("allow-scripts");
    expect(inspect.props.src).toBe(
      "/api/tasks/task_1/preview?projectId=project_1&inspect=1"
    );
    expect(inspect.props.sandbox).toBe("allow-scripts");
  });

  it("can render fetched preview HTML as a same-document iframe for inspector testing", () => {
    const preview = LPPreview({
      previewHtml: "<!doctype html><html><body><h1>Fetched preview</h1></body></html>",
      inspectMode: true
    });

    expect(preview.props.srcDoc).toContain("Fetched preview");
    expect(preview.props.src).toBeUndefined();
    expect(preview.props.sandbox).toBe("allow-scripts");
  });
});
