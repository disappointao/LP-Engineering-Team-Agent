import { describe, expect, it } from "vitest";

import { createWebWorkbenchStore } from "./workbench-store";

const forbiddenFrameworkMarkers = [
  "__next",
  "data-reactroot",
  "react-dom",
  "createRoot(",
  "ng-version",
  "@angular/core",
  "new Vue(",
  "createApp(",
  "vite/client",
  "svelte-"
];

describe("Web V1 smoke", () => {
  it("runs deterministic LP generation through artifact diff and bounded snippet flow", async () => {
    const store = createWebWorkbenchStore();

    const result = await store.submitTaskPrompt({
      prompt:
        "Create a landing page for a spring ecommerce sale with static HTML CSS JS output",
      implicitProjectName: "Smoke LP Project"
    });

    expect(result).toMatchObject({
      ok: true,
      taskType: "lp_generation"
    });

    if (!result.ok || !result.projectId) {
      throw new Error("expected LP smoke task to create a project");
    }

    const pageState = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId
    });

    expect(pageState.kind).toBe("task_ready");

    if (pageState.kind !== "task_ready") {
      throw new Error("expected LP smoke task page state to be ready");
    }

    expect(pageState.task.type).toBe("lp_generation");
    expect(pageState.snapshot?.project.id).toBe(result.projectId);

    const pageVersion = pageState.snapshot?.currentPageVersion;

    expect(pageVersion?.artifactWorkspaceId).toBeTruthy();
    expect(pageState.snapshot?.deployment?.pageVersionId).toBe(pageVersion?.id);

    const artifacts = pageVersion?.artifacts;

    if (!artifacts) {
      throw new Error("expected LP smoke task to produce static artifacts");
    }

    expect(artifacts.indexHtml.toLowerCase()).toContain("<!doctype html");
    expect(artifacts.indexHtml).toContain("<html");
    expect(artifacts.stylesCss.length).toBeGreaterThan(0);
    expect(artifacts.scriptJs.length).toBeGreaterThan(0);

    const serializedArtifacts = JSON.stringify(artifacts).toLowerCase();

    for (const marker of forbiddenFrameworkMarkers) {
      expect(serializedArtifacts).not.toContain(marker.toLowerCase());
    }

    expect(pageState.artifactDiff?.artifactWorkspaceId).toBe(
      pageVersion?.artifactWorkspaceId
    );
    expect(pageState.artifactDiff?.files.map((file) => file.path)).toEqual([
      "index.html",
      "styles.css",
      "script.js"
    ]);
    expect(pageState.artifactDiff?.files.every((file) => file.canPreview)).toBe(
      true
    );

    const artifactDiffJson = JSON.stringify(pageState.artifactDiff);

    expect(artifactDiffJson).not.toContain("<!doctype html");
    expect(artifactDiffJson).not.toContain(":root");
    expect(artifactDiffJson).not.toContain("window.lpAgent");

    const snippetState = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId,
      artifactPath: "styles.css"
    });

    expect(snippetState.kind).toBe("task_ready");

    if (snippetState.kind !== "task_ready") {
      throw new Error("expected LP smoke snippet state to be ready");
    }

    const snippet = snippetState.artifactDiff?.selectedSnippet;

    expect(snippet).toMatchObject({
      path: "styles.css",
      maxBytes: 8192
    });
    expect(snippet?.content).toContain(":root");

    const snippetContent = snippet?.content ? snippet.content : "";

    expect(snippetContent.length).toBeLessThanOrEqual(8192);
    expect(JSON.stringify(snippetState.artifactDiff?.files)).not.toContain(
      ":root"
    );
  });

  it("keeps ordinary tasks outside the LP artifact diff flow", async () => {
    const store = createWebWorkbenchStore();

    const result = await store.submitTaskPrompt({
      prompt: "Help me outline a homepage launch checklist.",
      implicitProjectName: "Smoke General Project"
    });

    expect(result).toMatchObject({
      ok: true,
      taskType: "general_chat"
    });

    if (!result.ok) {
      throw new Error("expected ordinary smoke task to be accepted");
    }

    const pageState = await store.getPageState({
      taskId: result.taskId
    });

    expect(pageState.kind).toBe("task_ready");

    if (pageState.kind !== "task_ready") {
      throw new Error("expected ordinary smoke task page state to be ready");
    }

    expect(pageState.task.type).toBe("general_chat");
    expect(pageState.snapshot).toBeUndefined();
    expect(pageState.artifactDiff).toBeUndefined();
  });
});
