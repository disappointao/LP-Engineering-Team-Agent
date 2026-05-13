import { describe, expect, it } from "vitest";
import { createInMemoryWorkbenchRepositories } from "@lp-agent/db";
import { createDefaultModelPolicy } from "@lp-agent/model-gateway";
import {
  classifyTaskPrompt,
  createWebWorkbenchStore,
  deriveImplicitProjectName,
  validateProjectInput,
  validatePromptInput
} from "./workbench-store";

const emptyMCPState = {
  connectors: [],
  approvals: [],
  visibleToolsByRole: {
    planner: [],
    builder: [],
    reviewer: [],
    deployer: []
  }
};

function brandSkillManifestJson(): string {
  return JSON.stringify({
    id: "skill_brand",
    name: "Brand LP",
    version: "1.0.0",
    type: "template",
    scope: "project",
    description: "Brand LP sections.",
    permissions: ["brief:read", "artifact:write", "assets:read"],
    requiredSecrets: [],
    entrypoints: ["skills/brand.md"],
    reviewState: "published"
  });
}

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
      tasks: [],
      skills: {
        boundSkills: [],
        availableVersions: []
      },
      models: {
        providers: [],
        routes: [],
        resolvedPolicy: createDefaultModelPolicy()
      },
      mcp: emptyMCPState
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
      tasks: [],
      skills: {
        boundSkills: [],
        availableVersions: []
      },
      models: {
        providers: [],
        routes: [],
        resolvedPolicy: createDefaultModelPolicy()
      },
      mcp: emptyMCPState
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
      ],
      skills: {
        boundSkills: [],
        availableVersions: []
      },
      models: {
        providers: [],
        routes: [],
        resolvedPolicy: createDefaultModelPolicy()
      },
      mcp: emptyMCPState
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

  it("creates, validates, publishes, and binds skills through the web store", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({ name: "Project" });

    const draft = await store.createSkillDraft({
      manifestJson: brandSkillManifestJson(),
      content: "# Brand LP",
      contentType: "text/markdown"
    });
    if (!draft.ok) {
      throw new Error(`Expected draft creation to succeed, got ${draft.error}.`);
    }
    const validated = await store.validateSkillVersion(draft.value.version.id);
    if (!validated.ok) {
      throw new Error(`Expected validation to succeed, got ${validated.error}.`);
    }
    const published = await store.publishSkillVersion(draft.value.version.id);
    if (!published.ok) {
      throw new Error(`Expected publishing to succeed, got ${published.error}.`);
    }
    const binding = await store.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.value.id
    });
    if (!binding.ok) {
      throw new Error(`Expected binding to succeed, got ${binding.error}.`);
    }
    const state = await store.getPageState({ projectId: project.id });

    expect(validated.value.reviewState).toBe("validated");
    expect(binding.value.enabled).toBe(true);
    expect(state.skills.boundSkills).toEqual([
      expect.objectContaining({
        skill: expect.objectContaining({ id: "skill_brand" }),
        version: expect.objectContaining({ reviewState: "published" })
      })
    ]);
  });

  it("maps skill store validation errors to stable codes", async () => {
    const store = createWebWorkbenchStore();

    const result = await store.createSkillDraft({
      manifestJson: "{",
      content: "# Brand LP",
      contentType: "text/markdown"
    });

    expect(result).toEqual({
      ok: false,
      error: "invalid_manifest_json"
    });
  });

  it("creates model providers and routes through the web store", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({ name: "Project" });

    const provider = await store.createModelProvider({
      projectId: project.id,
      providerId: "provider_openai",
      name: "OpenAI",
      provider: "openai",
      secretEnvName: "OPENAI_API_KEY"
    });
    if (!provider.ok) {
      throw new Error(`Expected provider creation to succeed, got ${provider.error}.`);
    }

    const route = await store.upsertProjectModelRoute({
      projectId: project.id,
      role: "builder",
      providerId: provider.value.id,
      model: "gpt-5.4"
    });
    if (!route.ok) {
      throw new Error(`Expected route upsert to succeed, got ${route.error}.`);
    }

    const state = await store.getPageState({ projectId: project.id });

    expect(state.models.providers).toEqual([
      expect.objectContaining({ id: "provider_openai", provider: "openai" })
    ]);
    expect(state.models.routes).toEqual([
      expect.objectContaining({ role: "builder", model: "gpt-5.4" })
    ]);
    expect(state.models.resolvedPolicy.builder).toEqual({
      provider: "provider_openai",
      model: "gpt-5.4"
    });
  });

  it("recovers page model state when a persisted route points to a disabled provider", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });
    const project = await store.createProject({ name: "Project" });
    const provider = await store.createModelProvider({
      projectId: project.id,
      providerId: "provider_openai",
      name: "OpenAI",
      provider: "openai",
      secretEnvName: "OPENAI_API_KEY"
    });
    if (!provider.ok) {
      throw new Error(`Expected provider creation to succeed, got ${provider.error}.`);
    }
    const route = await store.upsertProjectModelRoute({
      projectId: project.id,
      role: "builder",
      providerId: provider.value.id,
      model: "gpt-5.4"
    });
    if (!route.ok) {
      throw new Error(`Expected route upsert to succeed, got ${route.error}.`);
    }
    await repositories.modelProviders.save({
      ...provider.value,
      enabled: false,
      updatedAt: "2026-05-12T08:10:00.000Z"
    });

    const state = await store.getPageState({ projectId: project.id });

    expect(state.models.resolutionError).toBe("model_provider_disabled");
    expect(state.models.providers).toEqual([
      expect.objectContaining({ id: "provider_openai", enabled: false })
    ]);
    expect(state.models.routes).toEqual([
      expect.objectContaining({ providerId: "provider_openai", role: "builder" })
    ]);
    expect(state.models.resolvedPolicy.builder).toEqual({
      provider: "mock-anthropic",
      model: "code-model"
    });
  });

  it("recovers page model state when a persisted route points to a missing provider", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });
    const project = await store.createProject({ name: "Project" });
    await repositories.modelRoutingPolicies.save({
      id: "model_route_1",
      scope: "project",
      targetKey: project.id,
      role: "builder",
      providerId: "provider_missing",
      model: "gpt-5.4",
      createdAt: "2026-05-12T08:00:00.000Z",
      updatedAt: "2026-05-12T08:00:00.000Z"
    });

    const state = await store.getPageState({ projectId: project.id });

    expect(state.models.resolutionError).toBe("model_route_provider_invalid");
    expect(state.models.providers).toEqual([]);
    expect(state.models.routes).toEqual([
      expect.objectContaining({ providerId: "provider_missing", role: "builder" })
    ]);
    expect(state.models.resolvedPolicy.builder).toEqual({
      provider: "mock-anthropic",
      model: "code-model"
    });
  });

  it("maps model store validation errors to stable codes", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({ name: "Project" });

    const result = await store.createModelProvider({
      projectId: project.id,
      providerId: "provider_bad",
      name: "Bad",
      provider: "javascript",
      secretEnvName: "OPENAI_API_KEY"
    });

    expect(result).toEqual({
      ok: false,
      error: "model_provider_type_unsupported"
    });
  });

  it("maps model provider in-use errors to stable codes", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({ name: "Project" });
    const provider = await store.createModelProvider({
      projectId: project.id,
      providerId: "provider_openai",
      name: "OpenAI",
      provider: "openai",
      secretEnvName: "OPENAI_API_KEY"
    });
    if (!provider.ok) {
      throw new Error(`Expected provider creation to succeed, got ${provider.error}.`);
    }
    const route = await store.upsertProjectModelRoute({
      projectId: project.id,
      role: "builder",
      providerId: provider.value.id,
      model: "gpt-5.4"
    });
    if (!route.ok) {
      throw new Error(`Expected route upsert to succeed, got ${route.error}.`);
    }

    const result = await store.setModelProviderEnabled({
      projectId: project.id,
      providerId: provider.value.id,
      enabled: false
    });

    expect(result).toEqual({
      ok: false,
      error: "model_provider_in_use"
    });
  });

  it("loads project mcp state and creates project connectors", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });
    const project = await store.createProject({ name: "MCP Web" });

    const result = await store.createMCPConnector({
      projectId: project.id,
      definitionJson: JSON.stringify({
        id: "connector_assets",
        name: "Assets",
        tools: [
          {
            name: "searchAssets",
            permission: "assets:read",
            roles: ["builder"],
            requiresApproval: false
          }
        ]
      })
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        id: "connector_assets",
        enabled: true
      }
    });

    const pageState = await store.getPageState({ projectId: project.id });
    expect(pageState.mcp.connectors).toEqual([
      expect.objectContaining({ id: "connector_assets" })
    ]);
  });

  it("returns stable mcp errors from the Web store", async () => {
    const store = createWebWorkbenchStore({
      repositories: createInMemoryWorkbenchRepositories()
    });

    await expect(
      store.createMCPConnector({
        projectId: "missing_project",
        definitionJson: "{"
      })
    ).resolves.toEqual({
      ok: false,
      error: "project_not_found"
    });
  });

  it("approves mcp tools through the Web store and hides them when disabled", async () => {
    const store = createWebWorkbenchStore({
      repositories: createInMemoryWorkbenchRepositories()
    });
    const project = await store.createProject({ name: "MCP Approval" });
    const draft = await store.createSkillDraft({
      manifestJson: JSON.stringify({
        id: "skill_deploy",
        name: "Deploy",
        version: "1.0.0",
        type: "workflow",
        scope: "project",
        description: "Deploy with git.",
        permissions: ["git:write"],
        requiredSecrets: [],
        entrypoints: ["deploy.md"],
        reviewState: "published"
      }),
      content: "# Deploy",
      contentType: "text/markdown"
    });
    if (!draft.ok) {
      throw new Error(`Expected draft creation to succeed, got ${draft.error}.`);
    }
    const validated = await store.validateSkillVersion(draft.value.version.id);
    if (!validated.ok) {
      throw new Error(`Expected validation to succeed, got ${validated.error}.`);
    }
    const published = await store.publishSkillVersion(draft.value.version.id);
    if (!published.ok) {
      throw new Error(`Expected publishing to succeed, got ${published.error}.`);
    }
    const binding = await store.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.value.id
    });
    if (!binding.ok) {
      throw new Error(`Expected binding to succeed, got ${binding.error}.`);
    }
    const connector = await store.createMCPConnector({
      projectId: project.id,
      definitionJson: JSON.stringify({
        id: "connector_git",
        name: "Git",
        tools: [
          {
            name: "createPullRequest",
            permission: "git:write",
            roles: ["deployer"],
            requiresApproval: true
          }
        ]
      })
    });
    if (!connector.ok) {
      throw new Error(`Expected connector creation to succeed, got ${connector.error}.`);
    }

    const approval = await store.setMCPToolApproval({
      projectId: project.id,
      connectorId: connector.value.id,
      toolName: "createPullRequest",
      approved: true
    });
    if (!approval.ok) {
      throw new Error(`Expected approval to succeed, got ${approval.error}.`);
    }
    const approvedState = await store.getPageState({ projectId: project.id });
    expect(approvedState.mcp.visibleToolsByRole.deployer).toEqual([
      {
        connectorId: "connector_git",
        name: "createPullRequest",
        permission: "git:write",
        requiresApproval: true
      }
    ]);

    const disabled = await store.setMCPConnectorEnabled({
      projectId: project.id,
      connectorId: connector.value.id,
      enabled: false
    });
    if (!disabled.ok) {
      throw new Error(`Expected disable to succeed, got ${disabled.error}.`);
    }
    const disabledState = await store.getPageState({ projectId: project.id });
    expect(disabledState.mcp.visibleToolsByRole.deployer).toEqual([]);
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
