import { describe, expect, it } from "vitest";
import {
  createWebWorkbenchStore,
  validateProjectInput,
  validatePromptInput
} from "./workbench-store";

describe("web workbench store", () => {
  it("creates projects and exposes them in creation order", async () => {
    const store = createWebWorkbenchStore();

    const first = await store.createProject({
      name: "Spring LP",
      repository: "git@example.com:shop/spring.git"
    });
    const second = await store.createProject({
      name: "Summer LP",
      repository: "git@example.com:shop/summer.git"
    });

    expect(first).toMatchObject({
      id: "project_1",
      name: "Spring LP",
      repository: "git@example.com:shop/spring.git"
    });
    expect(store.listProjects().map((project) => project.id)).toEqual([
      "project_1",
      "project_2"
    ]);
    expect(second.id).toBe("project_2");
  });

  it("returns no-project page state when no current project id is present", async () => {
    const store = createWebWorkbenchStore();

    await expect(store.getPageState(undefined)).resolves.toEqual({
      kind: "no_project",
      projects: []
    });
  });

  it("returns no-project page state for a stale project id", async () => {
    const store = createWebWorkbenchStore();
    await store.createProject({
      name: "Spring LP",
      repository: "git@example.com:shop/spring.git"
    });

    await expect(store.getPageState("project_missing")).resolves.toEqual({
      kind: "no_project",
      projects: [
        expect.objectContaining({
          id: "project_1",
          name: "Spring LP"
        })
      ]
    });
  });

  it("submits a prompt and restores a completed snapshot", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({
      name: "Spring LP",
      repository: "git@example.com:shop/spring.git"
    });

    const result = await store.submitPrompt({
      projectId: project.id,
      prompt: "Create a spring ecommerce landing page."
    });
    const pageState = await store.getPageState(project.id);

    expect(result).toEqual({ ok: true });
    expect(pageState.kind).toBe("project_ready");
    if (pageState.kind !== "project_ready") {
      throw new Error("Expected project-ready state.");
    }
    expect(pageState.snapshot.project.id).toBe(project.id);
    expect(pageState.snapshot.brief?.prompt).toBe("Create a spring ecommerce landing page.");
    expect(pageState.snapshot.currentPageVersion?.reviewStatus).toBe("passed");
    expect(pageState.snapshot.deployment?.status).toBe("pr_opened");
  });

  it("rejects prompt submission when the prompt is blank", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({
      name: "Spring LP",
      repository: "git@example.com:shop/spring.git"
    });

    await expect(
      store.submitPrompt({
        projectId: project.id,
        prompt: " "
      })
    ).resolves.toEqual({ ok: false, error: "prompt_required" });
  });

  it("rejects prompt submission when the project is missing", async () => {
    const store = createWebWorkbenchStore();

    await expect(
      store.submitPrompt({
        projectId: "missing",
        prompt: "Build"
      })
    ).resolves.toEqual({ ok: false, error: "project_not_found" });
  });

  it("validates project and prompt form values", () => {
    expect(validateProjectInput({ name: " ", repository: "repo" })).toEqual({
      ok: false,
      error: "project_name_required"
    });
    expect(validateProjectInput({ name: "LP", repository: " " })).toEqual({
      ok: false,
      error: "repository_required"
    });
    expect(validatePromptInput(" ")).toEqual({
      ok: false,
      error: "prompt_required"
    });
    expect(validateProjectInput({ name: " LP ", repository: " repo " })).toEqual({
      ok: true,
      value: {
        name: "LP",
        repository: "repo"
      }
    });
    expect(validatePromptInput(" Build a page ")).toEqual({
      ok: true,
      value: "Build a page"
    });
  });
});
