import { describe, expect, it } from "vitest";
import type { StaticArtifacts } from "@lp-agent/artifacts";
import type { DeploymentHandoff } from "@lp-agent/git-deployment";
import {
  createArtifactDownloadLinks,
  createArtifactExportDescriptors,
  createTaskArtifactPreviewUrl,
  createTaskArtifactRouteDownloadLinks,
  createDeploymentHandoffLink
} from "./export-links";

describe("artifact export links", () => {
  it("creates data URL download links for single-file and three-file LP exports", () => {
    const artifacts: StaticArtifacts = {
      indexHtml: [
        "<!doctype html><html><head>",
        "<link rel=\"stylesheet\" href=\"styles.css\">",
        "</head><body>",
        "  <script src=\"script.js\"></script>",
        "</body></html>"
      ].join(""),
      stylesCss: "body { color: #111827; }",
      scriptJs: "window.lpAgent = true;"
    };

    const links = createArtifactDownloadLinks(artifacts);

    expect(links.map((link) => link.filename)).toEqual([
      "index.single.html",
      "index.html",
      "styles.css",
      "script.js"
    ]);
    expect(links[0]?.label).toBe("Export Single HTML");
    expect(decodeURIComponent(links[0]?.href.split(",")[1] ?? "")).toContain("<style>");
    expect(decodeURIComponent(links[1]?.href.split(",")[1] ?? "")).toBe(artifacts.indexHtml);
    expect(decodeURIComponent(links[2]?.href.split(",")[1] ?? "")).toBe(artifacts.stylesCss);
    expect(decodeURIComponent(links[3]?.href.split(",")[1] ?? "")).toBe(artifacts.scriptJs);
  });

  it("creates lazy export descriptors without data URLs for preview workspace exports", () => {
    const artifacts: StaticArtifacts = {
      indexHtml: [
        "<!doctype html><html><head>",
        "<link rel=\"stylesheet\" href=\"styles.css\">",
        "</head><body>",
        "<main><h1>Preview first</h1></main>",
        "  <script src=\"script.js\"></script>",
        "</body></html>"
      ].join(""),
      stylesCss: "body { color: #111827; }",
      scriptJs: "window.lpAgent = true;"
    };

    const descriptors = createArtifactExportDescriptors(artifacts);

    expect(descriptors.map((descriptor) => descriptor.filename)).toEqual([
      "index.single.html",
      "index.html",
      "styles.css",
      "script.js"
    ]);
    expect(descriptors[0]).toMatchObject({
      label: "Export Single HTML",
      mimeType: "text/html",
      filename: "index.single.html"
    });
    expect(descriptors[0]?.content).toContain("<style>");
    expect(descriptors[1]?.content).toBe(artifacts.indexHtml);
    expect(descriptors[2]?.content).toBe(artifacts.stylesCss);
    expect(descriptors[3]?.content).toBe(artifacts.scriptJs);
    expect(JSON.stringify(descriptors)).not.toContain("data:text/html");
  });

  it("creates task artifact route links without bundling export content", () => {
    const artifacts: StaticArtifacts = {
      indexHtml: "<html><body>LP</body></html>",
      stylesCss: "body { color: red; }",
      scriptJs: "console.log('ready');"
    };

    const links = createTaskArtifactRouteDownloadLinks({
      artifacts,
      labels: {
        singleHtml: "Single",
        indexHtml: "Index",
        stylesCss: "Styles",
        scriptJs: "Script"
      },
      pageVersionId: "page_1",
      projectId: "project_1",
      taskId: "task_1"
    });

    expect(
      createTaskArtifactPreviewUrl({
        pageVersionId: "page_1",
        projectId: "project_1",
        taskId: "task_1"
      })
    ).toBe("/api/tasks/task_1/preview?projectId=project_1&version=page_1");
    expect(links.map((link) => [link.label, link.filename, link.href])).toEqual([
      [
        "Single",
        "index.single.html",
        "/api/tasks/task_1/export?projectId=project_1&version=page_1&file=single-html"
      ],
      [
        "Index",
        "index.html",
        "/api/tasks/task_1/export?projectId=project_1&version=page_1&file=index-html"
      ],
      [
        "Styles",
        "styles.css",
        "/api/tasks/task_1/export?projectId=project_1&version=page_1&file=styles-css"
      ],
      [
        "Script",
        "script.js",
        "/api/tasks/task_1/export?projectId=project_1&version=page_1&file=script-js"
      ]
    ]);
    expect(links.every((link) => !link.href.startsWith("data:"))).toBe(true);
  });

  it("creates a downloadable deployment handoff manifest instead of a mock external action", () => {
    const handoff: DeploymentHandoff = {
      id: "deployment_1",
      projectId: "project_1",
      pageVersionId: "version_1",
      branch: "lp-agent/project_1/version_1",
      commitSha: "mock_commit_1",
      pullRequestUrl: "https://git.example.local/pr/deployment_1",
      files: ["index.html", "styles.css", "script.js"],
      status: "pr_opened"
    };

    const link = createDeploymentHandoffLink(handoff);
    const manifest = JSON.parse(decodeURIComponent(link.href.split(",")[1] ?? "")) as {
      id: string;
      branch: string;
      files: string[];
      nextAction: string;
    };

    expect(link).toMatchObject({
      label: "Export PR Handoff",
      filename: "deployment-handoff.json"
    });
    expect(manifest).toMatchObject({
      id: "deployment_1",
      branch: "lp-agent/project_1/version_1",
      files: ["index.html", "styles.css", "script.js"],
      nextAction: "Apply these files to the target repository branch and open a provider PR."
    });
  });

  it("allows localized labels for export links", () => {
    const artifacts: StaticArtifacts = {
      indexHtml: [
        "<!doctype html><html><head>",
        "<link rel=\"stylesheet\" href=\"styles.css\">",
        "</head><body>",
        "  <script src=\"script.js\"></script>",
        "</body></html>"
      ].join(""),
      stylesCss: "body { color: #111827; }",
      scriptJs: "window.lpAgent = true;"
    };
    const links = createArtifactDownloadLinks(artifacts, {
      singleHtml: "导出单文件 HTML",
      indexHtml: "导出 index.html",
      stylesCss: "导出 styles.css",
      scriptJs: "导出 script.js"
    });

    expect(links.map((link) => link.label)).toEqual([
      "导出单文件 HTML",
      "导出 index.html",
      "导出 styles.css",
      "导出 script.js"
    ]);
  });
});
