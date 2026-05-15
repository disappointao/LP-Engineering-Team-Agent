import { describe, expect, it } from "vitest";
import { sampleBrief } from "@lp-agent/lp-schema";
import {
  createInMemoryWorkbenchRepositories,
  type MCPConnectorRecord,
  type MCPToolApprovalRecord,
  type PageVersionRecord,
  type ProjectRecord,
  type RunEventRecord,
  type RunRecord,
  type SkillBindingRecord,
  type SkillRecord,
  type SkillVersionRecord,
  type ToolObservationRecord
} from "./index";

const createdAt = "2026-05-12T00:00:00.000Z";

describe("in-memory workbench repositories", () => {
  it("persists projects and returns defensive copies", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const project: ProjectRecord = {
      id: "project_1",
      name: "Spring sale",
      createdAt
    };

    await repositories.projects.save(project);
    const saved = await repositories.projects.getById("project_1");
    project.name = "Mutated locally";

    expect(saved).toEqual({
      id: "project_1",
      name: "Spring sale",
      createdAt
    });
  });

  it("finds the latest brief, page version, and deployment for a project", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.projects.save({
      id: "project_1",
      name: "Spring sale",
      createdAt
    });
    await repositories.briefs.save({
      id: "brief_1",
      projectId: "project_1",
      prompt: "first prompt",
      brief: sampleBrief,
      createdAt
    });
    await repositories.briefs.save({
      id: "brief_2",
      projectId: "project_1",
      prompt: "second prompt",
      brief: { ...sampleBrief, title: "Second brief" },
      createdAt: "2026-05-12T00:01:00.000Z"
    });

    const pageVersion: PageVersionRecord = {
      id: "version_1",
      projectId: "project_1",
      briefId: "brief_2",
      artifacts: {
        indexHtml: "<!doctype html><html></html>",
        stylesCss: "body { margin: 0; }",
        scriptJs: "console.log('ready');"
      },
      reviewStatus: "passed",
      findings: [],
      createdAt: "2026-05-12T00:02:00.000Z"
    };
    await repositories.pageVersions.save(pageVersion);
    await repositories.deployments.save({
      id: "deployment_1",
      projectId: "project_1",
      pageVersionId: "version_1",
      branch: "lp-agent/project_1/version_1",
      commitSha: "mock_commit_1",
      pullRequestUrl: "https://git.example.local/pr/deployment_1",
      files: ["index.html", "styles.css", "script.js"],
      status: "pr_opened"
    });

    await expect(repositories.briefs.findLatestForProject("project_1")).resolves.toMatchObject({
      id: "brief_2",
      prompt: "second prompt"
    });
    await expect(repositories.pageVersions.findLatestForProject("project_1")).resolves.toMatchObject({
      id: "version_1",
      briefId: "brief_2"
    });
    await expect(repositories.deployments.findLatestForProject("project_1")).resolves.toMatchObject({
      id: "deployment_1",
      pageVersionId: "version_1"
    });
  });

  it("returns undefined when records are missing", async () => {
    const repositories = createInMemoryWorkbenchRepositories();

    await expect(repositories.projects.getById("missing")).resolves.toBeUndefined();
    await expect(repositories.briefs.getById("missing")).resolves.toBeUndefined();
    await expect(repositories.pageVersions.getById("missing")).resolves.toBeUndefined();
    await expect(repositories.deployments.getByPageVersionId("missing")).resolves.toBeUndefined();
  });

  it("lists projects in creation order and returns defensive copies", async () => {
    const repositories = createInMemoryWorkbenchRepositories();

    await repositories.projects.save({
      id: "project_1",
      name: "Spring sale",
      createdAt
    });
    await repositories.projects.save({
      id: "project_2",
      name: "Summer sale",
      createdAt: "2026-05-12T00:01:00.000Z"
    });

    const projects = await repositories.projects.listAll();
    const firstProject = projects[0];
    if (!firstProject) {
      throw new Error("Expected at least one project.");
    }
    firstProject.name = "Mutated locally";

    await expect(repositories.projects.listAll()).resolves.toEqual([
      {
        id: "project_1",
        name: "Spring sale",
        createdAt
      },
      {
        id: "project_2",
        name: "Summer sale",
        createdAt: "2026-05-12T00:01:00.000Z"
      }
    ]);
  });

  it("persists tasks, messages, and task snapshot references", async () => {
    const repositories = createInMemoryWorkbenchRepositories();

    await repositories.tasks.save({
      id: "task_1",
      title: "Create a landing page",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt
    });
    await repositories.messages.save({
      id: "message_1",
      taskId: "task_1",
      role: "user",
      content: "Create a landing page",
      createdAt
    });
    await repositories.messages.save({
      id: "message_2",
      taskId: "task_1",
      role: "assistant",
      content: "LP artifacts are ready for review.",
      createdAt: "2026-05-12T00:01:00.000Z"
    });
    await repositories.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_1",
      pageVersionId: "version_1",
      createdAt
    });

    await expect(repositories.tasks.getById("task_1")).resolves.toMatchObject({
      id: "task_1",
      type: "lp_generation",
      projectId: "project_1"
    });
    await expect(repositories.tasks.listAll()).resolves.toEqual([
      expect.objectContaining({
        id: "task_1",
        title: "Create a landing page"
      })
    ]);
    await expect(repositories.messages.listForTask("task_1")).resolves.toEqual([
      expect.objectContaining({
        id: "message_1",
        role: "user"
      }),
      expect.objectContaining({
        id: "message_2",
        role: "assistant"
      })
    ]);
    await expect(repositories.messages.listAll()).resolves.toHaveLength(2);
    await expect(repositories.taskSnapshots.getByTaskId("task_1")).resolves.toEqual({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_1",
      pageVersionId: "version_1",
      createdAt
    });
  });

  it("persists runs, ordered events, and tool observations with defensive copies", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const run: RunRecord = {
      id: "run_builder_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      state: "completed",
      startedAt: createdAt,
      completedAt: "2026-05-12T00:01:00.000Z",
      contextSummary: {
        injected: ["skills:1", "mcpTools:1"],
        omitted: []
      }
    };
    const firstEvent: RunEventRecord = {
      id: "run_event_1",
      runId: run.id,
      projectId: run.projectId,
      taskId: run.taskId,
      sequence: 2,
      type: "model.completed",
      message: "builder model call completed",
      payload: {
        provider: "mock-anthropic",
        model: "code-model"
      },
      createdAt: "2026-05-12T00:00:30.000Z"
    };
    const secondEvent: RunEventRecord = {
      id: "run_event_2",
      runId: run.id,
      projectId: run.projectId,
      taskId: run.taskId,
      sequence: 1,
      type: "run.started",
      message: "builder run started",
      payload: {
        role: "builder"
      },
      createdAt
    };
    const crossRunEvent: RunEventRecord = {
      id: "run_event_3",
      runId: "run_reviewer_1",
      projectId: run.projectId,
      taskId: run.taskId,
      sequence: 1,
      type: "review.started",
      message: "reviewer run started",
      payload: {
        role: "reviewer"
      },
      createdAt: "2026-05-12T00:00:15.000Z"
    };
    const observation: ToolObservationRecord = {
      id: "tool_observation_1",
      runId: run.id,
      projectId: run.projectId,
      taskId: run.taskId,
      toolName: "searchAssets",
      input: {
        query: "hero"
      },
      outputSummary: "Found three candidate hero images.",
      state: "completed",
      exitCode: 0,
      createdAt,
      completedAt: "2026-05-12T00:00:45.000Z"
    };

    await repositories.runs.save(run);
    await repositories.runEvents.save(firstEvent);
    await repositories.runEvents.save(secondEvent);
    await repositories.runEvents.save(crossRunEvent);
    await repositories.toolObservations.save(observation);
    run.contextSummary.injected.push("mutated-original");
    firstEvent.payload.provider = "mutated-original";
    observation.input.query = "mutated-original";

    const savedRun = await repositories.runs.getById(run.id);
    if (!savedRun) {
      throw new Error("Expected saved run.");
    }
    savedRun.contextSummary.injected.push("mutated");
    const savedObservation = await repositories.toolObservations.listForRun(run.id);
    savedObservation[0]!.input.query = "mutated";
    const savedEvents = await repositories.runEvents.listForRun(run.id);
    savedEvents[1]!.payload.provider = "mutated";

    await expect(repositories.runs.listForProject("project_1")).resolves.toEqual([
      expect.objectContaining({
        id: "run_builder_1",
        state: "completed",
        contextSummary: {
          injected: ["skills:1", "mcpTools:1"],
          omitted: []
        }
      })
    ]);
    await expect(repositories.runs.listForTask("task_1")).resolves.toEqual([
      expect.objectContaining({ id: "run_builder_1" })
    ]);
    await expect(repositories.runEvents.listForRun(run.id)).resolves.toEqual([
      expect.objectContaining({
        id: "run_event_2",
        sequence: 1,
        type: "run.started",
        payload: {
          role: "builder"
        }
      }),
      expect.objectContaining({
        id: "run_event_1",
        sequence: 2,
        type: "model.completed",
        payload: {
          provider: "mock-anthropic",
          model: "code-model"
        }
      })
    ]);
    await expect(repositories.runEvents.listForTask("task_1")).resolves.toEqual([
      expect.objectContaining({ id: "run_event_2" }),
      expect.objectContaining({ id: "run_event_3" }),
      expect.objectContaining({ id: "run_event_1" })
    ]);
    await expect(repositories.runEvents.listForProject("project_1")).resolves.toEqual([
      expect.objectContaining({ id: "run_event_2" }),
      expect.objectContaining({ id: "run_event_3" }),
      expect.objectContaining({ id: "run_event_1" })
    ]);
    await expect(repositories.toolObservations.listForRun(run.id)).resolves.toEqual([
      expect.objectContaining({
        id: "tool_observation_1",
        input: {
          query: "hero"
        },
        state: "completed",
        exitCode: 0,
        completedAt: "2026-05-12T00:00:45.000Z"
      })
    ]);
  });

  it("persists skills, versions, and bindings with defensive copies", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const skill: SkillRecord = {
      id: "skill_brand",
      name: "Brand LP",
      type: "template",
      scope: "project",
      createdAt
    };
    const version: SkillVersionRecord = {
      id: "skill_version_1",
      skillId: skill.id,
      version: "1.0.0",
      manifest: {
        id: skill.id,
        name: skill.name,
        version: "1.0.0",
        type: "template",
        scope: "project",
        description: "Brand LP sections.",
        permissions: ["brief:read", "artifact:write"],
        requiredSecrets: [],
        entrypoints: ["skills/brand.md"],
        reviewState: "published"
      },
      content: "# Brand LP\nUse concise ecommerce sections.",
      contentType: "text/markdown",
      reviewState: "published",
      createdAt
    };
    const binding: SkillBindingRecord = {
      id: "skill_binding_1",
      skillVersionId: version.id,
      scope: "project",
      targetKey: "project_1",
      projectId: "project_1",
      enabled: true,
      settings: {
        brand: {
          tone: "concise"
        }
      },
      createdAt,
      updatedAt: createdAt
    };

    await repositories.skills.save(skill);
    await repositories.skillVersions.save(version);
    await repositories.skillBindings.save(binding);

    const savedVersion = await repositories.skillVersions.getById(version.id);
    if (!savedVersion) {
      throw new Error("Expected saved skill version.");
    }
    savedVersion.manifest.permissions.push("mutated:permission");
    const savedBinding = await repositories.skillBindings.getById(binding.id);
    if (!savedBinding) {
      throw new Error("Expected saved skill binding.");
    }
    type BrandSettings = { tone: string };
    const savedBindingBrandSettings = savedBinding.settings?.brand;
    if (
      !savedBindingBrandSettings ||
      typeof savedBindingBrandSettings !== "object" ||
      Array.isArray(savedBindingBrandSettings)
    ) {
      throw new Error("Expected saved skill binding brand settings.");
    }
    (savedBindingBrandSettings as BrandSettings).tone = "mutated";

    await expect(repositories.skills.listAll()).resolves.toEqual([skill]);
    await expect(repositories.skillVersions.listForSkill(skill.id)).resolves.toEqual([version]);
    await expect(
      repositories.skillVersions.getBySkillIdAndVersion(skill.id, "1.0.0")
    ).resolves.toEqual(version);
    await expect(repositories.skillBindings.listForProject("project_1")).resolves.toEqual([
      binding
    ]);
    await expect(repositories.skillBindings.getById(binding.id)).resolves.toEqual(binding);
    await expect(repositories.skillVersions.getById(version.id)).resolves.toEqual(version);
  });

  it("stores model providers and routing policies with defensive copies", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const provider = {
      id: "provider_openai",
      scope: "project" as const,
      targetKey: "project_1",
      name: "OpenAI",
      provider: "openai" as const,
      config: {
        api: "openai-completions" as const,
        baseUrl: "https://api.openai.com/v1",
        secretEnvName: "OPENAI_API_KEY"
      },
      enabled: true,
      createdAt,
      updatedAt: createdAt
    };
    const policy = {
      id: "model_route_1",
      scope: "project" as const,
      targetKey: "project_1",
      role: "builder" as const,
      providerId: "provider_openai",
      model: "gpt-5.4",
      settings: {
        temperature: 0.2
      },
      createdAt,
      updatedAt: createdAt
    };

    await repositories.modelProviders.save(provider);
    await repositories.modelRoutingPolicies.save(policy);

    const savedProvider = await repositories.modelProviders.getById("provider_openai");
    const savedPolicy = await repositories.modelRoutingPolicies.getByProjectAndRole(
      "project_1",
      "builder"
    );

    expect(savedProvider).toEqual(provider);
    expect(savedPolicy).toEqual(policy);

    if (!savedProvider || !savedPolicy) {
      throw new Error("Expected saved model records.");
    }
    savedProvider.config.secretEnvName = "MUTATED_SECRET";
    savedPolicy.settings = { temperature: 1 };

    await expect(repositories.modelProviders.getById("provider_openai")).resolves.toEqual(provider);
    await expect(
      repositories.modelRoutingPolicies.getByProjectAndRole("project_1", "builder")
    ).resolves.toEqual(policy);

    const providerNeutralProvider = {
      id: "zhipu",
      scope: "project" as const,
      targetKey: "project_1",
      name: "智谱 GLM",
      provider: "custom" as const,
      config: {
        api: "anthropic-messages" as const,
        baseUrl: "https://open.bigmodel.cn/api/anthropic",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        headers: {
          "x-extra-key": { env: "ZHIPU_EXTRA_HEADER" }
        },
        models: [
          {
            id: "glm-5.1",
            name: "GLM-5.1",
            contextWindow: 200000,
            maxTokens: 128000,
            supportsTools: true,
            supportsStreaming: true
          }
        ],
        compat: {
          cacheControlFormat: "anthropic"
        }
      },
      enabled: true,
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z"
    };
    await repositories.modelProviders.save(providerNeutralProvider);

    const reopened = await repositories.modelProviders.getById("zhipu");
    expect(reopened?.config).toEqual(providerNeutralProvider.config);
    providerNeutralProvider.config.models[0]!.id = "mutated";
    expect((await repositories.modelProviders.getById("zhipu"))?.config.models?.[0]?.id).toBe(
      "glm-5.1"
    );
  });

  it("lists model providers and routes for a project", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.modelProviders.save({
      id: "provider_project_1",
      scope: "project",
      targetKey: "project_1",
      name: "Project 1 OpenAI",
      provider: "openai",
      config: { api: "openai-completions", secretEnvName: "OPENAI_API_KEY" },
      enabled: true,
      createdAt,
      updatedAt: createdAt
    });
    await repositories.modelProviders.save({
      id: "provider_project_2",
      scope: "project",
      targetKey: "project_2",
      name: "Project 2 Anthropic",
      provider: "anthropic",
      config: { api: "anthropic-messages", secretEnvName: "ANTHROPIC_API_KEY" },
      enabled: true,
      createdAt,
      updatedAt: createdAt
    });
    await repositories.modelRoutingPolicies.save({
      id: "model_route_1",
      scope: "project",
      targetKey: "project_1",
      role: "planner",
      providerId: "provider_project_1",
      model: "gpt-5.4",
      createdAt,
      updatedAt: createdAt
    });

    await expect(repositories.modelProviders.listForProject("project_1")).resolves.toEqual([
      expect.objectContaining({ id: "provider_project_1" })
    ]);
    await expect(repositories.modelRoutingPolicies.listForProject("project_1")).resolves.toEqual([
      expect.objectContaining({ id: "model_route_1", role: "planner" })
    ]);
  });

  it("stores mcp connectors and approvals with defensive copies", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const connector: MCPConnectorRecord = {
      id: "connector_assets",
      scope: "project" as const,
      targetKey: "project_1",
      name: "Internal Assets",
      description: "Search approved assets.",
      enabled: true,
      tools: [
        {
          name: "searchAssets",
          description: "Search assets.",
          permission: "assets:read",
          roles: ["planner", "builder"],
          requiresApproval: false
        }
      ],
      createdAt,
      updatedAt: createdAt
    };
    const approval: MCPToolApprovalRecord = {
      id: "mcp_approval_1",
      projectId: "project_1",
      connectorId: "connector_assets",
      toolName: "createPullRequest",
      state: "approved" as const,
      approvedByUserId: "local-owner",
      createdAt,
      updatedAt: createdAt
    };

    await repositories.mcpConnectors.save(connector);
    await repositories.mcpToolApprovals.save(approval);

    const savedConnector = await repositories.mcpConnectors.getById("connector_assets");
    const savedApproval =
      await repositories.mcpToolApprovals.getByProjectConnectorAndTool(
        "project_1",
        "connector_assets",
        "createPullRequest"
      );

    expect(savedConnector).toEqual(connector);
    expect(savedApproval).toEqual(approval);

    if (!savedConnector || !savedApproval) {
      throw new Error("Expected saved MCP records.");
    }
    savedConnector.tools[0]!.permission = "mutated:permission";
    savedApproval.state = "pending";

    await expect(repositories.mcpConnectors.getById("connector_assets")).resolves.toEqual(
      connector
    );
    await expect(
      repositories.mcpToolApprovals.getByProjectConnectorAndTool(
        "project_1",
        "connector_assets",
        "createPullRequest"
      )
    ).resolves.toEqual(approval);
  });

  it("lists mcp connectors and approvals for a project", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.mcpConnectors.save({
      id: "connector_project_1",
      scope: "project",
      targetKey: "project_1",
      name: "Project 1 Assets",
      enabled: true,
      tools: [],
      createdAt,
      updatedAt: createdAt
    });
    await repositories.mcpConnectors.save({
      id: "connector_project_2",
      scope: "project",
      targetKey: "project_2",
      name: "Project 2 Assets",
      enabled: true,
      tools: [],
      createdAt,
      updatedAt: createdAt
    });
    await repositories.mcpToolApprovals.save({
      id: "mcp_approval_1",
      projectId: "project_1",
      connectorId: "connector_project_1",
      toolName: "searchAssets",
      state: "approved",
      createdAt,
      updatedAt: createdAt
    });

    await expect(repositories.mcpConnectors.listForProject("project_1")).resolves.toEqual([
      expect.objectContaining({ id: "connector_project_1" })
    ]);
    await expect(repositories.mcpToolApprovals.listForProject("project_1")).resolves.toEqual([
      expect.objectContaining({ id: "mcp_approval_1" })
    ]);
  });
});
