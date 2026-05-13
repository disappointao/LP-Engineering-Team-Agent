import { describe, expect, it } from "vitest";
import { createInMemoryWorkbenchRepositories } from "@lp-agent/db";
import {
  classifyTaskPrompt,
  createWebWorkbenchStore,
  deriveImplicitProjectName,
  validateProjectInput,
  validatePromptInput
} from "./workbench-store";

describe("web workbench store", () => {
  it("creates projects and exposes them in creation order", async () => {
    const store = createWebWorkbenchStore();

    const first = await store.createProject({
      name: "Spring LP"
    });
    const second = await store.createProject({
      name: "Summer LP"
    });

    expect(first).toMatchObject({
      id: "project_1",
      name: "Spring LP"
    });
    await expect(
      store.listProjects().then((projects) => projects.map((project) => project.id))
    ).resolves.toEqual([
      "project_1",
      "project_2"
    ]);
    expect(second.id).toBe("project_2");
  });

  it("returns empty page state when no current task id is present", async () => {
    const store = createWebWorkbenchStore();

    await expect(store.getPageState(undefined)).resolves.toEqual({
      kind: "empty",
      projects: [],
      tasks: []
    });
  });

  it("returns empty page state for a stale project id", async () => {
    const store = createWebWorkbenchStore();
    await store.createProject({
      name: "Spring LP"
    });

    await expect(
      store.getPageState({
        projectId: "project_missing"
      })
    ).resolves.toEqual({
      kind: "empty",
      projects: [
        expect.objectContaining({
          id: "project_1",
          name: "Spring LP"
        })
      ],
      tasks: []
    });
  });

  it("submits an LP task for an existing project and restores a completed snapshot", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({
      name: "Spring LP"
    });

    const result = await store.submitTaskPrompt({
      projectId: project.id,
      prompt: "Create a spring ecommerce landing page.",
      implicitProjectName: "Untitled LP Project"
    });
    const pageState = await store.getPageState({
      projectId: project.id,
      taskId: "task_1"
    });

    expect(result).toEqual({
      ok: true,
      taskId: "task_1",
      taskType: "lp_generation",
      projectId: project.id
    });
    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageState.task).toMatchObject({
      id: "task_1",
      type: "lp_generation",
      projectId: project.id
    });
    expect(pageState.snapshot).toBeDefined();
    if (!pageState.snapshot) {
      throw new Error("Expected LP snapshot.");
    }
    expect(pageState.snapshot.project.id).toBe(project.id);
    expect(pageState.snapshot.brief?.prompt).toBe("Create a spring ecommerce landing page.");
    expect(pageState.snapshot.currentPageVersion?.reviewStatus).toBe("passed");
    expect(pageState.snapshot.deployment).toBeUndefined();
    expect(pageState.messages[1]?.content).toBe("LP artifacts are ready for review.");
  });

  it("restores the LP snapshot that belongs to the requested task", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({
      name: "Spring LP"
    });

    await store.submitTaskPrompt({
      projectId: project.id,
      prompt: "Create a first landing page in HTML.",
      implicitProjectName: "Untitled LP Project"
    });
    await store.submitTaskPrompt({
      projectId: project.id,
      prompt: "Create a second landing page in HTML.",
      implicitProjectName: "Untitled LP Project"
    });

    const firstTaskState = await store.getPageState({
      projectId: project.id,
      taskId: "task_1"
    });
    const secondTaskState = await store.getPageState({
      projectId: project.id,
      taskId: "task_2"
    });

    expect(firstTaskState.kind).toBe("task_ready");
    expect(secondTaskState.kind).toBe("task_ready");
    if (firstTaskState.kind !== "task_ready" || secondTaskState.kind !== "task_ready") {
      throw new Error("Expected task-ready states.");
    }
    expect(firstTaskState.snapshot?.brief?.prompt).toBe("Create a first landing page in HTML.");
    expect(secondTaskState.snapshot?.brief?.prompt).toBe("Create a second landing page in HTML.");
  });

  it("reopens projects, tasks, messages, and LP snapshots from shared repositories", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const firstStore = createWebWorkbenchStore({ repositories });
    const project = await firstStore.createProject({
      name: "Spring LP"
    });

    await firstStore.submitTaskPrompt({
      projectId: project.id,
      prompt: "Create a spring ecommerce landing page.",
      implicitProjectName: "Untitled LP Project"
    });

    const reopenedStore = createWebWorkbenchStore({ repositories });
    await expect(reopenedStore.listProjects()).resolves.toEqual([
      expect.objectContaining({
        id: project.id,
        name: "Spring LP"
      })
    ]);
    await expect(reopenedStore.listTasks()).resolves.toEqual([
      expect.objectContaining({
        id: "task_1",
        projectId: project.id
      })
    ]);

    const pageState = await reopenedStore.getPageState({
      projectId: project.id,
      taskId: "task_1"
    });

    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageState.messages.map((message) => message.id)).toEqual(["message_1", "message_2"]);
    expect(pageState.snapshot?.project.id).toBe(project.id);
    expect(pageState.snapshot?.brief?.prompt).toBe("Create a spring ecommerce landing page.");
    expect(pageState.snapshot?.currentPageVersion?.reviewStatus).toBe("passed");
  });

  it("allocates task and message IDs from existing repository records", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });

    await repositories.tasks.save({
      id: "task_4",
      title: "Existing task",
      type: "general_chat",
      status: "complete",
      createdAt: "2026-05-13T00:00:00.000Z"
    });
    await repositories.messages.save({
      id: "message_9",
      taskId: "task_4",
      role: "assistant",
      content: "Existing message",
      createdAt: "2026-05-13T00:00:00.000Z"
    });

    const result = await store.submitTaskPrompt({
      prompt: "Help me write a campaign plan.",
      implicitProjectName: "Untitled LP Project"
    });

    expect(result).toEqual({
      ok: true,
      taskId: "task_5",
      taskType: "general_chat",
      projectId: undefined
    });

    const messages = await repositories.messages.listForTask("task_5");
    expect(messages.map((message) => message.id)).toEqual(["message_10", "message_11"]);
  });

  it("returns empty state when a project task is requested through a different project", async () => {
    const store = createWebWorkbenchStore();
    const firstProject = await store.createProject({
      name: "Spring LP"
    });
    const secondProject = await store.createProject({
      name: "Summer LP"
    });

    await store.submitTaskPrompt({
      projectId: firstProject.id,
      prompt: "Create a spring ecommerce landing page.",
      implicitProjectName: "Untitled LP Project"
    });

    await expect(
      store.getPageState({
        projectId: secondProject.id,
        taskId: "task_1"
      })
    ).resolves.toEqual({
      kind: "empty",
      projects: [
        expect.objectContaining({
          id: firstProject.id
        }),
        expect.objectContaining({
          id: secondProject.id
        })
      ],
      tasks: [
        expect.objectContaining({
          id: "task_1",
          projectId: firstProject.id
        })
      ]
    });
  });

  it("rejects prompt submission when the prompt is blank", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({
      name: "Spring LP"
    });

    await expect(
      store.submitTaskPrompt({
        projectId: project.id,
        prompt: " ",
        implicitProjectName: "Untitled LP Project"
      })
    ).resolves.toEqual({ ok: false, error: "prompt_required" });
  });

  it("rejects prompt submission when the project is missing", async () => {
    const store = createWebWorkbenchStore();

    await expect(
      store.submitTaskPrompt({
        projectId: "missing",
        prompt: "Build",
        implicitProjectName: "Untitled LP Project"
      })
    ).resolves.toEqual({ ok: false, error: "project_not_found" });
  });

  it("validates project and prompt form values", () => {
    expect(validateProjectInput({ name: " " })).toEqual({
      ok: false,
      error: "project_name_required"
    });
    expect(validatePromptInput(" ")).toEqual({
      ok: false,
      error: "prompt_required"
    });
    expect(validateProjectInput({ name: " LP " })).toEqual({
      ok: true,
      value: {
        name: "LP"
      }
    });
    expect(validatePromptInput(" Build a page ")).toEqual({
      ok: true,
      value: "Build a page"
    });
  });

  it("routes first prompts into deterministic task types", () => {
    expect(classifyTaskPrompt("帮我写一个双 11 活动方案")).toBe("general_chat");
    expect(classifyTaskPrompt("Help me write a campaign plan.")).toBe("general_chat");
    expect(classifyTaskPrompt("生成一个电商春季促销 LP，输出单文件 HTML")).toBe("lp_generation");
    expect(classifyTaskPrompt("Create a landing page for a spring sale")).toBe("lp_generation");
    expect(classifyTaskPrompt("创建项目 春季活动")).toBe("project_setup");
    expect(classifyTaskPrompt("new project for spring campaign")).toBe("project_setup");
    expect(classifyTaskPrompt("create a landing page for my project")).toBe("lp_generation");
    expect(classifyTaskPrompt("create project for spring campaign")).toBe("project_setup");
  });

  it("derives implicit LP project names from the prompt with a fallback", () => {
    expect(
      deriveImplicitProjectName(
        "生成一个电商春季促销 LP，输出单文件 HTML",
        "未命名 LP 项目"
      )
    ).toBe("生成一个电商春季促销 LP");
    expect(deriveImplicitProjectName("   ", "Untitled LP Project")).toBe("Untitled LP Project");
    expect(deriveImplicitProjectName("   ", "   ")).toBe("Untitled LP Project");
  });

  it("submits a general task without a project and exposes a task thread", async () => {
    const store = createWebWorkbenchStore();

    const result = await store.submitTaskPrompt({
      prompt: "Help me write a campaign plan.",
      implicitProjectName: "未命名 LP 项目"
    });

    expect(result).toEqual({
      ok: true,
      taskId: "task_1",
      taskType: "general_chat",
      projectId: undefined
    });

    const pageState = await store.getPageState({
      taskId: "task_1"
    });

    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageState.task).toMatchObject({
      id: "task_1",
      type: "general_chat",
      projectId: undefined,
      title: "Help me write a campaign plan."
    });
    expect(pageState.projects).toEqual([]);
    expect(pageState.tasks.map((task) => task.id)).toEqual(["task_1"]);
    expect(pageState.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(pageState.messages[0]?.content).toBe("Help me write a campaign plan.");
    expect(pageState.messages[1]?.content).toBe(
      "I created a task thread and can continue from here."
    );
  });

  it("submits a project setup task without creating an implicit project", async () => {
    const store = createWebWorkbenchStore();

    const result = await store.submitTaskPrompt({
      prompt: "create project for spring campaign",
      implicitProjectName: "Untitled LP Project"
    });

    expect(result).toEqual({
      ok: true,
      taskId: "task_1",
      taskType: "project_setup",
      projectId: undefined
    });

    const pageState = await store.getPageState({
      taskId: "task_1"
    });

    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageState.projects).toEqual([]);
    expect(pageState.task).toMatchObject({
      id: "task_1",
      type: "project_setup",
      projectId: undefined
    });
    expect(pageState.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(pageState.messages[0]?.content).toBe("create project for spring campaign");
    expect(pageState.messages[1]?.content).toBe(
      "I created a task thread and can continue from here."
    );
  });

  it("shows a general task when the caller passes a project id", async () => {
    const store = createWebWorkbenchStore();

    await store.submitTaskPrompt({
      prompt: "帮我写一个双 11 活动方案",
      implicitProjectName: "未命名 LP 项目"
    });

    const pageState = await store.getPageState({
      projectId: "project_missing",
      taskId: "task_1"
    });

    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageState.task).toMatchObject({
      id: "task_1",
      type: "general_chat",
      projectId: undefined
    });
    expect(pageState.snapshot).toBeUndefined();
  });

  it("submits an LP task without a project by creating an implicit local project", async () => {
    const store = createWebWorkbenchStore();

    const result = await store.submitTaskPrompt({
      prompt: "生成一个电商春季促销 LP，输出单文件 HTML",
      implicitProjectName: "未命名 LP 项目"
    });

    expect(result).toEqual({
      ok: true,
      taskId: "task_1",
      taskType: "lp_generation",
      projectId: "project_1"
    });

    const pageState = await store.getPageState({
      projectId: "project_1",
      taskId: "task_1"
    });

    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageState.task).toMatchObject({
      id: "task_1",
      type: "lp_generation",
      projectId: "project_1"
    });
    expect(pageState.projects[0]).toMatchObject({
      id: "project_1",
      name: "生成一个电商春季促销 LP"
    });
    expect(pageState.snapshot).toBeDefined();
    if (!pageState.snapshot) {
      throw new Error("Expected LP snapshot.");
    }
    expect(pageState.snapshot.brief?.prompt).toBe("生成一个电商春季促销 LP，输出单文件 HTML");
    expect(pageState.snapshot.currentPageVersion?.reviewStatus).toBe("passed");
    expect(pageState.snapshot.deployment).toBeUndefined();
    expect(pageState.messages[1]?.content).toBe("LP artifacts are ready for review.");
  });
});
