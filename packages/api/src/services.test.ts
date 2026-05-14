import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { StaticArtifacts } from "@lp-agent/artifacts";
import {
  createInMemoryWorkbenchRepositories,
  createJsonFileWorkbenchRepositories,
  type RunEventRecord,
  type RunRecord
} from "@lp-agent/db";
import type { DeploymentHandoff, GitDeploymentAdapter } from "@lp-agent/git-deployment";
import { sampleBrief, type ReviewFinding } from "@lp-agent/lp-schema";
import type { ModelFetch } from "@lp-agent/model-gateway";
import type {
  AgentRuntimeAdapter,
  RuntimeRunRequest,
  RuntimeRunResult
} from "@lp-agent/runtime-adapters";
import type { SkillManifest } from "@lp-agent/skills";
import {
  DemoWorkbenchService,
  createDemoWorkbenchService,
  type BriefRecord,
  type MCPConnectorRecord,
  type PageVersionRecord,
  type ProjectRecord,
  type WorkbenchSnapshot
} from "./index";
import {
  ContextPackSchema,
  assembleContextPack
} from "./context-assembler";

describe("demo workbench service", () => {
  it("exports record contracts used by API consumers", () => {
    const project: ProjectRecord = {
      id: "project_1",
      name: "Spring sale",
      createdAt: "2026-05-11T00:00:00.000Z"
    };
    const brief: BriefRecord = {
      id: "brief_1",
      projectId: project.id,
      prompt: "Build a sale page",
      brief: sampleBrief,
      createdAt: project.createdAt
    };
    const version: PageVersionRecord = {
      id: "version_1",
      projectId: project.id,
      briefId: brief.id,
      artifacts: completeArtifacts(),
      reviewStatus: "pending",
      findings: [],
      createdAt: project.createdAt
    };
    const snapshot: WorkbenchSnapshot = {
      project,
      brief,
      currentPageVersion: version
    };

    expect(snapshot.currentPageVersion?.id).toBe("version_1");
  });

  it("creates a project, prompt brief, page version, passing review, and deployment handoff", async () => {
    const service = createDemoWorkbenchService();

    const project = await service.createProject({
      name: "Spring sale"
    });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Build a concise ecommerce landing page."
    });
    const pageVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });
    const reviewed = await service.reviewPageVersion({
      projectId: project.id,
      pageVersionId: pageVersion.id
    });
    const deployment = await service.approveAndCreateDeployment({
      projectId: project.id,
      pageVersionId: pageVersion.id,
      reviewerUserId: "reviewer_1"
    });
    const snapshot = await service.getSnapshot(project.id);

    expect(project).toMatchObject({
      id: "project_1",
      name: "Spring sale"
    });
    expect(brief).toMatchObject({
      id: "brief_1",
      projectId: "project_1",
      prompt: "Build a concise ecommerce landing page.",
      brief: sampleBrief
    });
    expect(pageVersion).toMatchObject({
      id: "version_1",
      projectId: "project_1",
      briefId: "brief_1",
      reviewStatus: "pending",
      findings: []
    });
    expect(pageVersion.artifacts.indexHtml).toContain("Spring essentials, ready today");
    expect(reviewed.reviewStatus).toBe("passed");
    expect(reviewed.findings).toEqual([]);
    expect(deployment).toMatchObject({
      id: "deployment_1",
      projectId: "project_1",
      pageVersionId: "version_1",
      branch: "lp-agent/project_1/version_1",
      status: "pr_opened"
    });
    expect(snapshot).toMatchObject({
      project,
      brief,
      currentPageVersion: reviewed,
      deployment
    });
  });

  it("persists planner, builder, reviewer, and deployer run events in order", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a sale LP"
    });
    const pageVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });
    await service.reviewPageVersion({
      projectId: project.id,
      pageVersionId: pageVersion.id
    });
    await service.approveAndCreateDeployment({
      projectId: project.id,
      pageVersionId: pageVersion.id,
      reviewerUserId: "reviewer_1"
    });

    const runs = await repositories.runs.listForProject(project.id);
    const events = await repositories.runEvents.listForProject(project.id);

    expect(runs.map((run: RunRecord) => run.role)).toEqual([
      "planner",
      "builder",
      "reviewer",
      "deployer"
    ]);
    expect(runs.every((run: RunRecord) => run.state === "completed")).toBe(true);
    expect(events.map((event: RunEventRecord) => `${event.runId}:${event.sequence}:${event.type}`)).toEqual([
      "run_planner_brief_1:1:run.started",
      "run_planner_brief_1:2:runtime.context.loaded",
      "run_planner_brief_1:3:model.completed",
      "run_planner_brief_1:4:run.completed",
      "run_builder_version_1:1:run.started",
      "run_builder_version_1:2:runtime.context.loaded",
      "run_builder_version_1:3:model.completed",
      "run_builder_version_1:4:artifact.created",
      "run_builder_version_1:5:run.completed",
      "run_reviewer_version_1:1:run.started",
      "run_reviewer_version_1:2:runtime.context.loaded",
      "run_reviewer_version_1:3:model.completed",
      "run_reviewer_version_1:4:review.completed",
      "run_reviewer_version_1:5:run.completed",
      "run_deployer_version_1:1:run.started",
      "run_deployer_version_1:2:runtime.context.loaded",
      "run_deployer_version_1:3:model.completed",
      "run_deployer_version_1:4:run.completed"
    ]);
    expect(runs[1]?.contextSummary.injected).toEqual(
      expect.arrayContaining(["artifactWorkspace:memory"])
    );
  });

  it("persists failed run events before surfacing generation failure", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const builderRuntime = new RecordingRuntime({ state: "failed" });
    const service = new DemoWorkbenchService({
      repositories,
      builderRuntime,
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a sale LP"
    });

    await expect(
      service.generatePageVersion({
        projectId: project.id,
        briefId: brief.id
      })
    ).rejects.toThrow("Builder run failed.");

    await expect(repositories.runs.listForProject(project.id)).resolves.toEqual([
      expect.objectContaining({ role: "planner", state: "completed" }),
      expect.objectContaining({ role: "builder", state: "failed" })
    ]);
    await expect(repositories.runEvents.listForProject(project.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: "run_builder_version_1",
          type: "run.failed"
        })
      ])
    );
  });

  it("persists failed run events when a runtime throws before rethrowing", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
      builderRuntime: new ThrowingRuntime(new Error("Runtime unavailable.")),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a sale LP"
    });

    await expect(
      service.generatePageVersion({
        projectId: project.id,
        briefId: brief.id
      })
    ).rejects.toThrow("Runtime unavailable.");

    await expect(repositories.runs.listForProject(project.id)).resolves.toEqual([
      expect.objectContaining({ role: "planner", state: "completed" }),
      expect.objectContaining({ role: "builder", state: "failed" })
    ]);
    await expect(repositories.runEvents.listForProject(project.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: "run_builder_version_1",
          type: "run.failed",
          message: "Runtime unavailable."
        })
      ])
    );
  });

  it("does not save a brief when planner fails or does not complete", async () => {
    const failedRepositories = createInMemoryWorkbenchRepositories();
    const failedService = new DemoWorkbenchService({
      repositories: failedRepositories,
      plannerRuntime: new StaticRuntime({ state: "failed" }),
      now: fixedClock()
    });
    const failedProject = await failedService.createProject({ name: "Project" });

    await expect(
      failedService.createBriefFromPrompt({
        projectId: failedProject.id,
        prompt: "Create a sale LP"
      })
    ).rejects.toThrow("Planner run failed.");
    await expect(failedRepositories.briefs.listAll()).resolves.toEqual([]);

    const incompleteRepositories = createInMemoryWorkbenchRepositories();
    const incompleteService = new DemoWorkbenchService({
      repositories: incompleteRepositories,
      plannerRuntime: new StaticRuntime({ state: "needs_input" }),
      now: fixedClock()
    });
    const incompleteProject = await incompleteService.createProject({ name: "Project" });

    await expect(
      incompleteService.createBriefFromPrompt({
        projectId: incompleteProject.id,
        prompt: "Create a sale LP"
      })
    ).rejects.toThrow("Planner run did not complete.");
    await expect(incompleteRepositories.briefs.listAll()).resolves.toEqual([]);
    await expect(incompleteRepositories.runs.listForProject(incompleteProject.id)).resolves.toEqual([
      expect.objectContaining({
        role: "planner",
        state: "needs_input"
      })
    ]);
  });

  it("does not create a deployment when deployer fails or does not complete", async () => {
    const failedDeploymentAdapter = new RecordingDeploymentAdapter();
    const failedService = new DemoWorkbenchService({
      deployerRuntime: new StaticRuntime({ state: "failed" }),
      deploymentAdapter: failedDeploymentAdapter,
      now: fixedClock()
    });
    const failedProject = await failedService.createProject({ name: "Project" });
    const failedBrief = await failedService.createBriefFromPrompt({
      projectId: failedProject.id,
      prompt: "Prompt"
    });
    const failedVersion = await failedService.generatePageVersion({
      projectId: failedProject.id,
      briefId: failedBrief.id
    });
    await failedService.reviewPageVersion({
      projectId: failedProject.id,
      pageVersionId: failedVersion.id
    });

    await expect(
      failedService.approveAndCreateDeployment({
        projectId: failedProject.id,
        pageVersionId: failedVersion.id,
        reviewerUserId: "reviewer_1"
      })
    ).rejects.toThrow("Deployer run failed.");
    expect(failedDeploymentAdapter.inputs).toEqual([]);

    const incompleteRepositories = createInMemoryWorkbenchRepositories();
    const incompleteDeploymentAdapter = new RecordingDeploymentAdapter();
    const incompleteService = new DemoWorkbenchService({
      repositories: incompleteRepositories,
      deployerRuntime: new StaticRuntime({ state: "needs_approval" }),
      deploymentAdapter: incompleteDeploymentAdapter,
      now: fixedClock()
    });
    const incompleteProject = await incompleteService.createProject({ name: "Project" });
    const incompleteBrief = await incompleteService.createBriefFromPrompt({
      projectId: incompleteProject.id,
      prompt: "Prompt"
    });
    const incompleteVersion = await incompleteService.generatePageVersion({
      projectId: incompleteProject.id,
      briefId: incompleteBrief.id
    });
    await incompleteService.reviewPageVersion({
      projectId: incompleteProject.id,
      pageVersionId: incompleteVersion.id
    });

    await expect(
      incompleteService.approveAndCreateDeployment({
        projectId: incompleteProject.id,
        pageVersionId: incompleteVersion.id,
        reviewerUserId: "reviewer_1"
      })
    ).rejects.toThrow("Deployer run did not complete.");
    expect(incompleteDeploymentAdapter.inputs).toEqual([]);
    await expect(incompleteRepositories.runs.listForProject(incompleteProject.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "deployer",
          state: "needs_approval"
        })
      ])
    );
  });

  it("can read records created by another service instance when repositories are shared", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const serviceA = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const serviceB = new DemoWorkbenchService({ repositories, now: fixedClock() });

    const project = await serviceA.createProject({
      name: "Repository-backed project"
    });
    const brief = await serviceA.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Build a repository-backed LP."
    });
    const pageVersion = await serviceA.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });

    const snapshot = await serviceB.getSnapshot(project.id);

    expect(snapshot).toMatchObject({
      project,
      brief,
      currentPageVersion: {
        id: pageVersion.id,
        projectId: project.id,
        briefId: brief.id,
        reviewStatus: "pending"
      }
    });
  });

  it("allocates the next project id from existing repository records", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.projects.save({
      id: "project_7",
      name: "Existing project",
      createdAt: "2026-05-12T00:00:00.000Z"
    });

    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Next project" });

    expect(project).toMatchObject({
      id: "project_8",
      name: "Next project"
    });
  });

  it("loads a snapshot from explicit brief and page version ids", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const firstBrief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "First LP"
    });
    const firstVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: firstBrief.id
    });
    const secondBrief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Second LP"
    });
    await service.generatePageVersion({
      projectId: project.id,
      briefId: secondBrief.id
    });

    const snapshot = await service.getSnapshotForRecords({
      projectId: project.id,
      briefId: firstBrief.id,
      pageVersionId: firstVersion.id
    });

    expect(snapshot.brief?.prompt).toBe("First LP");
    expect(snapshot.currentPageVersion?.id).toBe(firstVersion.id);
  });

  it("loads the latest page version for an explicit brief without using the project latest", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const firstBrief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "First LP"
    });
    const firstVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: firstBrief.id
    });
    const secondBrief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Second LP"
    });
    const secondVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: secondBrief.id
    });

    const snapshot = await service.getSnapshotForRecords({
      projectId: project.id,
      briefId: firstBrief.id
    });

    expect(snapshot.brief?.id).toBe(firstBrief.id);
    expect(snapshot.currentPageVersion?.id).toBe(firstVersion.id);
    expect(snapshot.currentPageVersion?.id).not.toBe(secondVersion.id);
  });

  it("does not return a project deployment for an explicit brief without a page version", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const firstBrief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "First LP"
    });
    const secondBrief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Second LP"
    });
    const secondVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: secondBrief.id
    });
    await service.reviewPageVersion({
      projectId: project.id,
      pageVersionId: secondVersion.id
    });
    await service.approveAndCreateDeployment({
      projectId: project.id,
      pageVersionId: secondVersion.id,
      reviewerUserId: "reviewer_1"
    });

    const snapshot = await service.getSnapshotForRecords({
      projectId: project.id,
      briefId: firstBrief.id
    });

    expect(snapshot.brief?.id).toBe(firstBrief.id);
    expect(snapshot.currentPageVersion).toBeUndefined();
    expect(snapshot.deployment).toBeUndefined();
  });

  it("rejects explicit brief and page version ids that do not match", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const firstBrief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "First LP"
    });
    const secondBrief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Second LP"
    });
    const secondVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: secondBrief.id
    });

    await expect(
      service.getSnapshotForRecords({
        projectId: project.id,
        briefId: firstBrief.id,
        pageVersionId: secondVersion.id
      })
    ).rejects.toThrow("Page version does not belong to brief.");
  });

  it("loads a page version snapshot with its own brief when no brief id is provided", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const firstBrief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "First LP"
    });
    await service.generatePageVersion({
      projectId: project.id,
      briefId: firstBrief.id
    });
    const secondBrief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Second LP"
    });
    const secondVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: secondBrief.id
    });

    const snapshot = await service.getSnapshotForRecords({
      projectId: project.id,
      pageVersionId: secondVersion.id
    });

    expect(snapshot.brief?.id).toBe(secondBrief.id);
    expect(snapshot.brief?.prompt).toBe("Second LP");
    expect(snapshot.currentPageVersion?.id).toBe(secondVersion.id);
  });

  it("keeps concurrent project creation ids unique for the same repositories", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });

    const projects = await Promise.all([
      service.createProject({ name: "First project" }),
      service.createProject({ name: "Second project" })
    ]);
    const savedProjects = await repositories.projects.listAll();

    expect(new Set(projects.map((project) => project.id))).toHaveProperty("size", 2);
    expect(savedProjects.map((project) => project.id).sort()).toEqual(["project_1", "project_2"]);
  });

  it("keeps concurrent project creation ids unique for repeated JSON repository factory calls", async () => {
    const root = await mkdtemp(join(tmpdir(), "lp-agent-api-"));
    const filePath = join(root, "workbench-state.json");

    try {
      const serviceA = new DemoWorkbenchService({
        repositories: createJsonFileWorkbenchRepositories({ filePath }),
        now: fixedClock()
      });
      const serviceB = new DemoWorkbenchService({
        repositories: createJsonFileWorkbenchRepositories({ filePath }),
        now: fixedClock()
      });

      const projects = await Promise.all([
        serviceA.createProject({ name: "First project" }),
        serviceB.createProject({ name: "Second project" })
      ]);
      const savedProjects = await createJsonFileWorkbenchRepositories({
        filePath
      }).projects.listAll();

      expect(new Set(projects.map((project) => project.id))).toHaveProperty("size", 2);
      expect(savedProjects.map((project) => project.id).sort()).toEqual(["project_1", "project_2"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses branch-safe generated IDs for deployment", async () => {
    const deploymentAdapter = new RecordingDeploymentAdapter();
    const service = new DemoWorkbenchService({
      deploymentAdapter,
      now: fixedClock()
    });

    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
    const version = await service.generatePageVersion({ projectId: project.id, briefId: brief.id });
    await service.reviewPageVersion({ projectId: project.id, pageVersionId: version.id });
    await service.approveAndCreateDeployment({
      projectId: project.id,
      pageVersionId: version.id,
      reviewerUserId: "reviewer_1"
    });

    expect(deploymentAdapter.inputs[0]).toMatchObject({
      projectId: "project_1",
      pageVersionId: "version_1",
      approved: true
    });
  });

  it("creates, validates, publishes, and binds a project skill", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });

    const draft = await service.createSkillDraft({
      manifestJson: JSON.stringify(brandSkillManifest()),
      content: "# Brand LP",
      contentType: "text/markdown"
    });
    const validated = await service.validateSkillVersion({ skillVersionId: draft.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });
    const binding = await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });
    const state = await service.listProjectSkillState(project.id);

    expect(draft.version.reviewState).toBe("draft");
    expect(draft.version.manifest.reviewState).toBe("draft");
    expect(validated.reviewState).toBe("validated");
    expect(validated.manifest.reviewState).toBe("validated");
    expect(published.reviewState).toBe("published");
    expect(published.manifest.reviewState).toBe("published");
    expect(binding).toMatchObject({
      skillVersionId: published.id,
      projectId: project.id,
      enabled: true
    });
    expect(state.boundSkills).toEqual([
      expect.objectContaining({
        skill: expect.objectContaining({ id: "skill_brand" }),
        version: expect.objectContaining({ reviewState: "published" }),
        binding: expect.objectContaining({ enabled: true })
      })
    ]);
  });

  it("creates project model providers and resolves default routes", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });

    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "provider_openai",
      name: "OpenAI",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      secretEnvName: "OPENAI_API_KEY"
    });
    const policy = await service.resolveModelRoutingPolicyForProject(project.id);

    expect(provider).toMatchObject({
      id: "provider_openai",
      scope: "project",
      targetKey: project.id,
      name: "OpenAI",
      provider: "openai",
      config: {
        api: "openai-completions",
        baseUrl: "https://api.openai.com/v1",
        apiKeyEnv: "OPENAI_API_KEY"
      },
      enabled: true
    });
    expect(policy.builder).toEqual({ provider: "mock-anthropic", model: "code-model" });
  });

  it("creates provider-neutral model providers with explicit API protocol", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });

    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "zhipu",
      name: "智谱 GLM",
      provider: "custom",
      api: "anthropic-messages",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      modelId: "glm-5.1"
    });

    expect(provider).toMatchObject({
      id: "zhipu",
      provider: "custom",
      config: {
        api: "anthropic-messages",
        baseUrl: "https://open.bigmodel.cn/api/anthropic",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        models: [{ id: "glm-5.1" }]
      }
    });
    expect(JSON.stringify(provider)).not.toContain("sk-");
  });

  it("resolves model routes with sanitized provider metadata", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "zhipu",
      name: "智谱 GLM",
      provider: "custom",
      api: "anthropic-messages",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      modelId: "glm-5.1"
    });
    await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "builder",
      providerId: provider.id,
      model: "glm-5.1"
    });

    const policy = await service.resolveModelRoutingPolicyForProject(project.id);

    expect(policy.builder).toEqual({
      provider: "zhipu",
      providerName: "智谱 GLM",
      api: "anthropic-messages",
      model: "glm-5.1",
      baseUrlConfigured: true,
      apiKeyEnvConfigured: true
    });
    expect(policy.builder).not.toHaveProperty("modelCapabilities");
    expect(JSON.stringify(policy)).not.toContain("ANTHROPIC_API_KEY");
  });

  it("uses provider-backed runtime when REAL_MODEL_RUNTIME is enabled", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const fetchCalls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fakeFetch: ModelFetch = async (input, init) => {
      fetchCalls.push({ input, init });
      return new Response(
        JSON.stringify({
          type: "message",
          model: "glm-5.1",
          content: [{ type: "text", text: "planner response" }],
          usage: { input_tokens: 9, output_tokens: 4 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };
    const service = new DemoWorkbenchService({
      repositories,
      now: fixedClock(),
      env: {
        REAL_MODEL_RUNTIME: "1",
        ANTHROPIC_API_KEY: "sk-test-secret"
      },
      modelFetch: fakeFetch
    });
    const project = await service.createProject({ name: "Project" });
    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "zhipu",
      name: "智谱 GLM",
      provider: "custom",
      api: "anthropic-messages",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      modelId: "glm-5.1"
    });
    await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "planner",
      providerId: provider.id,
      model: "glm-5.1"
    });

    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Generate a landing page brief."
    });

    expect(brief.id).toBe("brief_1");
    expect(fetchCalls).toHaveLength(1);
    expect(String(fetchCalls[0]?.input)).toBe(
      "https://open.bigmodel.cn/api/anthropic/v1/messages"
    );
    expect(fetchCalls[0]?.init?.method).toBe("POST");
    expect(fetchCalls[0]?.init?.headers).toMatchObject({
      "content-type": "application/json",
      "x-api-key": "sk-test-secret",
      "anthropic-version": "2023-06-01"
    });
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toEqual({
      model: "glm-5.1",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Generate a landing page brief." }]
    });

    const events = await repositories.runEvents.listForProject(project.id);
    const modelEvent = events.find((event) => event.type === "model.completed");
    expect(modelEvent).toMatchObject({
      runId: "run_planner_brief_1",
      type: "model.completed",
      message: "planner model call completed",
      payload: expect.objectContaining({
        provider: "zhipu",
        providerName: "智谱 GLM",
        api: "anthropic-messages",
        model: "glm-5.1",
        baseUrlConfigured: true,
        apiKeyEnvConfigured: true,
        role: "planner",
        usage: { inputTokens: 9, outputTokens: 4 }
      })
    });
    expect(JSON.stringify(events)).not.toContain("sk-test-secret");
    expect(JSON.stringify(events)).not.toContain("ANTHROPIC_API_KEY");
    expect(JSON.stringify(events)).not.toContain("https://open.bigmodel.cn");
  });

  it("uses OpenAI-compatible provider-backed runtime when REAL_MODEL_RUNTIME is enabled", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const fetchCalls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fakeFetch: ModelFetch = async (input, init) => {
      fetchCalls.push({ input, init });
      return new Response(
        JSON.stringify({
          id: "chatcmpl_test",
          model: "glm-5.1",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "planner response" },
              finish_reason: "stop"
            }
          ],
          usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };
    const service = new DemoWorkbenchService({
      repositories,
      now: fixedClock(),
      env: {
        REAL_MODEL_RUNTIME: "1",
        OPENAI_COMPATIBLE_API_KEY: "sk-test-secret"
      },
      modelFetch: fakeFetch
    });
    const project = await service.createProject({ name: "Project" });
    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "zhipu_openai",
      name: "智谱 OpenAI Compatible",
      provider: "custom",
      api: "openai-completions",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
      modelId: "glm-5.1"
    });
    await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "planner",
      providerId: provider.id,
      model: "glm-5.1"
    });

    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Generate a landing page brief."
    });

    expect(brief.id).toBe("brief_1");
    expect(fetchCalls).toHaveLength(1);
    expect(String(fetchCalls[0]?.input)).toBe(
      "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    );
    expect(fetchCalls[0]?.init?.method).toBe("POST");
    expect(fetchCalls[0]?.init?.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer sk-test-secret"
    });
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toEqual({
      model: "glm-5.1",
      messages: [{ role: "user", content: "Generate a landing page brief." }],
      stream: false
    });

    const events = await repositories.runEvents.listForProject(project.id);
    const modelEvent = events.find((event) => event.type === "model.completed");
    expect(modelEvent).toMatchObject({
      runId: "run_planner_brief_1",
      type: "model.completed",
      message: "planner model call completed",
      payload: expect.objectContaining({
        provider: "zhipu_openai",
        providerName: "智谱 OpenAI Compatible",
        api: "openai-completions",
        model: "glm-5.1",
        baseUrlConfigured: true,
        apiKeyEnvConfigured: true,
        role: "planner",
        usage: { inputTokens: 9, outputTokens: 4 }
      })
    });
    expect(JSON.stringify(events)).not.toContain("sk-test-secret");
    expect(JSON.stringify(events)).not.toContain("OPENAI_COMPATIBLE_API_KEY");
    expect(JSON.stringify(events)).not.toContain("https://open.bigmodel.cn");
  });

  it("keeps deterministic runtime unless REAL_MODEL_RUNTIME is explicitly enabled", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    let fetchCallCount = 0;
    const fakeFetch: ModelFetch = async () => {
      fetchCallCount += 1;
      throw new Error("fetch_should_not_be_called");
    };
    const service = new DemoWorkbenchService({
      repositories,
      now: fixedClock(),
      env: {
        REAL_MODEL_PROVIDER_TEST: "1",
        ANTHROPIC_API_KEY: "sk-test-secret"
      },
      modelFetch: fakeFetch
    });
    const project = await service.createProject({ name: "Project" });
    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "zhipu",
      name: "智谱 GLM",
      provider: "custom",
      api: "anthropic-messages",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      modelId: "glm-5.1"
    });
    await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "planner",
      providerId: provider.id,
      model: "glm-5.1"
    });

    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Generate a landing page brief."
    });

    expect(brief.id).toBe("brief_1");
    expect(fetchCallCount).toBe(0);
    const events = await repositories.runEvents.listForProject(project.id);
    expect(events.some((event) => event.type === "run.completed")).toBe(true);
  });

  it("fails closed in real runtime when planner resolves to the default mock route", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    let fetchCallCount = 0;
    const fakeFetch: ModelFetch = async () => {
      fetchCallCount += 1;
      throw new Error("fetch_should_not_be_called");
    };
    const service = new DemoWorkbenchService({
      repositories,
      now: fixedClock(),
      env: {
        REAL_MODEL_RUNTIME: "1"
      },
      modelFetch: fakeFetch
    });
    const project = await service.createProject({ name: "Project" });

    await expect(
      service.createBriefFromPrompt({
        projectId: project.id,
        prompt: "Generate a landing page brief."
      })
    ).rejects.toThrow("Planner run failed.");

    expect(fetchCallCount).toBe(0);
    await expect(repositories.runs.listForProject(project.id)).resolves.toEqual([
      expect.objectContaining({
        id: "run_planner_brief_1",
        projectId: project.id,
        role: "planner",
        state: "failed",
        completedAt: expect.any(String)
      })
    ]);
    const events = await repositories.runEvents.listForProject(project.id);
    const failedEvent = events.find((event) => event.type === "run.failed");
    expect(failedEvent).toMatchObject({
      runId: "run_planner_brief_1",
      projectId: project.id,
      type: "run.failed",
      message: "Mock model route mock-openai cannot be used when real model runtime is enabled",
      payload: expect.objectContaining({
        role: "planner",
        state: "failed",
        errorName: "ModelProviderConfigurationError"
      })
    });
    expect(events.some((event) => event.type === "model.completed")).toBe(false);
    expect(JSON.stringify(events)).not.toContain("ANTHROPIC_API_KEY");
    expect(JSON.stringify(events)).not.toContain("https://");
  });

  it("fails closed in real runtime when planner resolves to a configured mock provider", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    let fetchCallCount = 0;
    const fakeFetch: ModelFetch = async () => {
      fetchCallCount += 1;
      throw new Error("fetch_should_not_be_called");
    };
    const service = new DemoWorkbenchService({
      repositories,
      now: fixedClock(),
      env: {
        REAL_MODEL_RUNTIME: "1"
      },
      modelFetch: fakeFetch
    });
    const project = await service.createProject({ name: "Project" });
    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "project_mock",
      name: "Project Mock",
      provider: "custom",
      api: "mock",
      modelId: "planning-model"
    });
    await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "planner",
      providerId: provider.id,
      model: "planning-model"
    });

    await expect(
      service.createBriefFromPrompt({
        projectId: project.id,
        prompt: "Generate a landing page brief."
      })
    ).rejects.toThrow("Planner run failed.");

    expect(fetchCallCount).toBe(0);
    await expect(repositories.runs.listForProject(project.id)).resolves.toEqual([
      expect.objectContaining({
        id: "run_planner_brief_1",
        projectId: project.id,
        role: "planner",
        state: "failed",
        completedAt: expect.any(String)
      })
    ]);
    const events = await repositories.runEvents.listForProject(project.id);
    const failedEvent = events.find((event) => event.type === "run.failed");
    expect(failedEvent).toMatchObject({
      runId: "run_planner_brief_1",
      projectId: project.id,
      type: "run.failed",
      message: "Mock model route project_mock cannot be used when real model runtime is enabled",
      payload: expect.objectContaining({
        role: "planner",
        state: "failed",
        errorName: "ModelProviderConfigurationError"
      })
    });
    expect(events.some((event) => event.type === "model.completed")).toBe(false);
    expect(JSON.stringify(events)).not.toContain("ANTHROPIC_API_KEY");
    expect(JSON.stringify(events)).not.toContain("https://");
  });

  it("records failed runs when real runtime provider secrets are missing", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    let fetchCallCount = 0;
    const fakeFetch: ModelFetch = async () => {
      fetchCallCount += 1;
      throw new Error("fetch_should_not_be_called");
    };
    const service = new DemoWorkbenchService({
      repositories,
      now: fixedClock(),
      env: {
        REAL_MODEL_RUNTIME: "1"
      },
      modelFetch: fakeFetch
    });
    const project = await service.createProject({ name: "Project" });
    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "zhipu",
      name: "智谱 GLM",
      provider: "custom",
      api: "anthropic-messages",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      modelId: "glm-5.1"
    });
    await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "planner",
      providerId: provider.id,
      model: "glm-5.1"
    });

    await expect(
      service.createBriefFromPrompt({
        projectId: project.id,
        prompt: "Generate a landing page brief."
      })
    ).rejects.toThrow("Planner run failed.");

    expect(fetchCallCount).toBe(0);
    await expect(repositories.runs.listForProject(project.id)).resolves.toEqual([
      expect.objectContaining({
        id: "run_planner_brief_1",
        projectId: project.id,
        role: "planner",
        state: "failed",
        completedAt: expect.any(String)
      })
    ]);
    const events = await repositories.runEvents.listForProject(project.id);
    const failedEvent = events.find((event) => event.type === "run.failed");
    expect(failedEvent).toMatchObject({
      runId: "run_planner_brief_1",
      projectId: project.id,
      type: "run.failed",
      message: "Environment variable for provider zhipu is not configured",
      payload: expect.objectContaining({
        role: "planner",
        state: "failed",
        errorName: "ModelProviderConfigurationError"
      })
    });
    expect(JSON.stringify(events)).not.toContain("ANTHROPIC_API_KEY");
    expect(JSON.stringify(events)).not.toContain("https://open.bigmodel.cn");
  });

  it("maps legacy provider types to default API protocols", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });

    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "provider_openai",
      name: "OpenAI",
      provider: "openai",
      secretEnvName: "OPENAI_API_KEY"
    });

    expect(provider.config).toMatchObject({
      api: "openai-completions",
      apiKeyEnv: "OPENAI_API_KEY"
    });
  });

  it("falls back to legacy secret env names when canonical API key env is blank", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });

    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "provider_legacy",
      name: "Legacy OpenAI",
      provider: "openai",
      apiKeyEnv: "",
      secretEnvName: "OPENAI_API_KEY"
    });

    expect(provider.config).toMatchObject({
      api: "openai-completions",
      apiKeyEnv: "OPENAI_API_KEY"
    });
  });

  it("rejects unsupported provider API protocols and invalid API key env refs", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });

    await expect(
      service.createModelProvider({
        projectId: project.id,
        providerId: "bad_api",
        name: "Bad API",
        provider: "custom",
        api: "not-real"
      })
    ).rejects.toThrow("model_provider_api_unsupported");

    await expect(
      service.createModelProvider({
        projectId: project.id,
        providerId: "bad_env",
        name: "Bad Env",
        provider: "custom",
        api: "anthropic-messages",
        apiKeyEnv: "sk-real-secret-value"
      })
    ).rejects.toThrow("model_provider_api_key_env_invalid");
  });

  it("upserts project model routes and uses them during runtime calls", async () => {
    const builderRuntime = new RecordingRuntime({ state: "completed", artifacts: completeArtifacts() });
    const service = new DemoWorkbenchService({
      builderRuntime,
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "provider_openai",
      name: "OpenAI",
      provider: "openai",
      secretEnvName: "OPENAI_API_KEY"
    });
    await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "builder",
      providerId: provider.id,
      model: "gpt-5.4"
    });

    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
    await service.generatePageVersion({ projectId: project.id, briefId: brief.id });

    expect(builderRuntime.requests[0]?.context?.modelRoutingPolicy?.builder).toEqual(
      expect.objectContaining({
        provider: "provider_openai",
        model: "gpt-5.4"
      })
    );
  });

  it("rejects disabled model providers during route resolution", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "provider_openai",
      name: "OpenAI",
      provider: "openai",
      secretEnvName: "OPENAI_API_KEY"
    });
    await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "builder",
      providerId: provider.id,
      model: "gpt-5.4"
    });
    await repositories.modelProviders.save({
      ...provider,
      enabled: false,
      updatedAt: "2026-05-12T08:10:00.000Z"
    });

    await expect(service.resolveModelRoutingPolicyForProject(project.id)).rejects.toThrow(
      "model_provider_disabled"
    );
  });

  it("rejects disabling a model provider while project routes still use it", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "provider_openai",
      name: "OpenAI",
      provider: "openai",
      secretEnvName: "OPENAI_API_KEY"
    });
    await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "builder",
      providerId: provider.id,
      model: "gpt-5.4"
    });

    await expect(
      service.setModelProviderEnabled({
        projectId: project.id,
        providerId: provider.id,
        enabled: false
      })
    ).rejects.toThrow("model_provider_in_use");
    await expect(service.resolveModelRoutingPolicyForProject(project.id)).resolves.toMatchObject({
      builder: {
        provider: provider.id,
        model: "gpt-5.4"
      }
    });
  });

  it("allows only one concurrent create for the same model provider id", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });

    const results = await Promise.allSettled([
      service.createModelProvider({
        projectId: project.id,
        providerId: "provider_openai",
        name: "OpenAI",
        provider: "openai",
        secretEnvName: "OPENAI_API_KEY"
      }),
      service.createModelProvider({
        projectId: project.id,
        providerId: "provider_openai",
        name: "OpenAI duplicate",
        provider: "openai",
        secretEnvName: "OPENAI_API_KEY"
      })
    ]);
    const state = await service.listProjectModelState(project.id);

    expect(results).toHaveLength(2);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ message: "model_provider_already_exists" })
      })
    ]);
    expect(state.providers).toHaveLength(1);
    expect(state.providers[0]).toMatchObject({
      id: "provider_openai",
      targetKey: project.id
    });
  });

  it("keeps concurrent upserts for different model roles from overwriting routes", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "provider_openai",
      name: "OpenAI",
      provider: "openai",
      secretEnvName: "OPENAI_API_KEY"
    });

    const results = await Promise.allSettled([
      service.upsertProjectModelRoute({
        projectId: project.id,
        role: "planner",
        providerId: provider.id,
        model: "gpt-5-planner"
      }),
      service.upsertProjectModelRoute({
        projectId: project.id,
        role: "builder",
        providerId: provider.id,
        model: "gpt-5-builder"
      })
    ]);
    const state = await service.listProjectModelState(project.id);

    expect(results).toEqual([
      expect.objectContaining({ status: "fulfilled" }),
      expect.objectContaining({ status: "fulfilled" })
    ]);
    expect(state.routes).toHaveLength(2);
    expect(new Set(state.routes.map((route) => route.id)).size).toBe(2);
    expect(state.resolvedPolicy.planner).toEqual(
      expect.objectContaining({
        provider: provider.id,
        model: "gpt-5-planner"
      })
    );
    expect(state.resolvedPolicy.builder).toEqual(
      expect.objectContaining({
        provider: provider.id,
        model: "gpt-5-builder"
      })
    );
  });

  it("updates the same model route id when upserting an existing role", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "provider_openai",
      name: "OpenAI",
      provider: "openai",
      secretEnvName: "OPENAI_API_KEY"
    });

    const firstRoute = await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "builder",
      providerId: provider.id,
      model: "gpt-5.4"
    });
    const secondRoute = await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "builder",
      providerId: provider.id,
      model: "gpt-5.5"
    });
    const state = await service.listProjectModelState(project.id);

    expect(secondRoute).toMatchObject({
      id: firstRoute.id,
      createdAt: firstRoute.createdAt,
      model: "gpt-5.5"
    });
    expect(state.routes).toHaveLength(1);
    expect(state.resolvedPolicy.builder).toEqual(
      expect.objectContaining({
        provider: provider.id,
        model: "gpt-5.5"
      })
    );
  });

  it("rejects invalid model provider input", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });

    await expect(
      service.createModelProvider({
        projectId: project.id,
        providerId: "provider_bad",
        name: "Bad",
        provider: "javascript" as "openai",
        secretEnvName: "OPENAI_API_KEY"
      })
    ).rejects.toThrow("model_provider_type_unsupported");

    await expect(
      service.createModelProvider({
        projectId: project.id,
        providerId: "provider_secret",
        name: "Secret",
        provider: "openai",
        secretEnvName: "sk-real-secret-value"
      })
    ).rejects.toThrow("model_provider_api_key_env_invalid");
  });

  it("keeps published skill versions published when validation is retried", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const draft = await service.createSkillDraft({
      manifestJson: JSON.stringify(brandSkillManifest()),
      content: "# Brand LP",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: draft.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });

    const retried = await service.validateSkillVersion({ skillVersionId: published.id });

    expect(retried.reviewState).toBe("published");
    expect(retried.manifest.reviewState).toBe("published");
  });

  it("rejects unsupported skill content types at the service boundary", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });

    await expect(
      service.createSkillDraft({
        manifestJson: JSON.stringify(brandSkillManifest()),
        content: "# Brand LP",
        contentType: "application/json" as "text/markdown"
      })
    ).rejects.toThrow("unsupported_content_type");
  });

  it("rejects duplicate project skill bindings", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const draft = await service.createSkillDraft({
      manifestJson: JSON.stringify(brandSkillManifest()),
      content: "# Brand LP",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: draft.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });

    await expect(
      service.bindSkillVersionToProject({
        projectId: project.id,
        skillVersionId: published.id
      })
    ).rejects.toThrow("skill_binding_already_exists");
  });

  it("requires the owning project when toggling a skill binding", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const owningProject = await service.createProject({ name: "Owning Project" });
    const otherProject = await service.createProject({ name: "Other Project" });
    const draft = await service.createSkillDraft({
      manifestJson: JSON.stringify(brandSkillManifest()),
      content: "# Brand LP",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: draft.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });
    const binding = await service.bindSkillVersionToProject({
      projectId: owningProject.id,
      skillVersionId: published.id
    });

    await expect(
      service.setProjectSkillBindingEnabled({
        projectId: otherProject.id,
        bindingId: binding.id,
        enabled: false
      })
    ).rejects.toThrow("skill_binding_not_found");
  });

  it("rejects duplicate skill versions and non-project manifests", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    await service.createSkillDraft({
      manifestJson: JSON.stringify(brandSkillManifest()),
      content: "# Brand LP",
      contentType: "text/markdown"
    });

    await expect(
      service.createSkillDraft({
        manifestJson: JSON.stringify(brandSkillManifest()),
        content: "# Brand LP again",
        contentType: "text/markdown"
      })
    ).rejects.toThrow("duplicate_skill_version");

    await expect(
      service.createSkillDraft({
        manifestJson: JSON.stringify(brandSkillManifest({ scope: "workspace" })),
        content: "# Workspace skill",
        contentType: "text/markdown"
      })
    ).rejects.toThrow("unsupported_skill_scope");

    await expect(
      service.createSkillDraft({
        manifestJson: JSON.stringify(brandSkillManifest({ version: "not-semver" })),
        content: "# Invalid skill",
        contentType: "text/markdown"
      })
    ).rejects.toThrow("manifest_validation_failed");
  });

  it("maps malformed skill manifest JSON to invalid_manifest_json", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });

    await expect(
      service.createSkillDraft({
        manifestJson: "{",
        content: "# Invalid JSON",
        contentType: "text/markdown"
      })
    ).rejects.toThrow("invalid_manifest_json");
  });

  it("requires published skills before project binding", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const draft = await service.createSkillDraft({
      manifestJson: JSON.stringify(brandSkillManifest()),
      content: "# Brand LP",
      contentType: "text/markdown"
    });

    await expect(
      service.bindSkillVersionToProject({
        projectId: project.id,
        skillVersionId: draft.version.id
      })
    ).rejects.toThrow("skill_version_not_published");
  });

  it("passes project-bound published skills into runtime runs", async () => {
    const builderRuntime = new RecordingRuntime({ state: "completed", artifacts: completeArtifacts() });
    const reviewerRuntime = new RecordingRuntime({ state: "completed", findings: [] });
    const service = new DemoWorkbenchService({
      builderRuntime,
      reviewerRuntime,
      now: fixedClock()
    });

    const project = await service.createProject({ name: "Project" });
    const draft = await service.createSkillDraft({
      manifestJson: JSON.stringify(brandSkillManifest()),
      content: "# Brand LP",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: draft.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });
    await service.createProjectMCPConnector({
      projectId: project.id,
      definitionJson: JSON.stringify({
        id: "connector_assets",
        name: "Assets",
        tools: [
          {
            name: "searchAssets",
            permission: "assets:read",
            roles: ["builder", "reviewer"],
            requiresApproval: false
          }
        ]
      })
    });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
    const version = await service.generatePageVersion({ projectId: project.id, briefId: brief.id });
    await service.reviewPageVersion({ projectId: project.id, pageVersionId: version.id });

    expect(builderRuntime.requests[0]?.context).toMatchObject({
      skills: [
        {
          id: "skill_brand",
          scope: "project",
          permissions: ["brief:read", "artifact:write", "assets:read"],
          content: "# Brand LP",
          contentType: "text/markdown"
        }
      ],
      mcpTools: [
        {
          connectorId: "connector_assets",
          name: "searchAssets",
          permission: "assets:read"
        }
      ],
      approval: {
        state: "not_required"
      },
      artifactWorkspace: {
        mode: "memory",
        writableFiles: ["index.html", "styles.css", "script.js"]
      }
    });
    expect(builderRuntime.requests[0]?.runId).toBe("run_builder_version_1");
    expect(reviewerRuntime.requests[0]?.context?.mcpTools.map((tool) => tool.name)).toEqual([
      "searchAssets"
    ]);
  });

  it("assembles and validates a role-specific context pack", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a sale LP"
    });
    const draft = await service.createSkillDraft({
      manifestJson: JSON.stringify(brandSkillManifest()),
      content: "# Brand LP",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: draft.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });

    const contextPack = await assembleContextPack({
      repositories,
      service,
      projectId: project.id,
      role: "builder",
      taskId: "task_1",
      input: {
        prompt: brief.prompt,
        brief: brief.brief
      },
      now: fixedClock()
    });

    expect(ContextPackSchema.parse(contextPack)).toMatchObject({
      projectId: project.id,
      taskId: "task_1",
      role: "builder",
      input: {
        prompt: "Create a sale LP"
      },
      runtimeContext: {
        skills: [
          expect.objectContaining({
            id: "skill_brand",
            content: "# Brand LP"
          })
        ],
        modelRoutingPolicy: {
          builder: expect.objectContaining({
            provider: "mock-anthropic",
            model: "code-model"
          })
        },
        artifactWorkspace: {
          mode: "memory",
          writableFiles: ["index.html", "styles.css", "script.js"]
        }
      },
      trace: {
        injected: expect.arrayContaining([
          "skills:1",
          "mcpTools:0",
          "modelRoutingPolicy:1",
          "modelProvider:builder:legacy"
        ]),
        omitted: expect.arrayContaining(["history:not_implemented"])
      }
    });
  });

  it("rejects invalid brief values in context packs", () => {
    expect(() =>
      ContextPackSchema.parse({
        projectId: "project_1",
        role: "builder",
        input: {
          prompt: "Create a sale LP",
          brief: {
            title: ""
          }
        },
        runtimeContext: {
          skills: [],
          mcpTools: [],
          approval: {
            state: "not_required"
          },
          artifactWorkspace: {
            mode: "memory",
            writableFiles: ["index.html"]
          }
        },
        trace: {
          injected: [],
          omitted: []
        },
        createdAt: "2026-05-11T00:00:00.000Z"
      })
    ).toThrow();
  });

  it("rejects unsupported roles when creating runtime context directly", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });

    await expect(
      service.createRuntimeContextForRole({
        projectId: project.id,
        role: "writer" as never
      })
    ).rejects.toThrow("model_role_unsupported");
  });

  it("creates project mcp connectors and computes visible tools from skills and approvals", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "MCP Project" });
    const skill = await service.createSkillDraft({
      manifestJson: JSON.stringify({
        id: "skill_assets",
        name: "Asset Search",
        version: "0.1.0",
        type: "workflow",
        scope: "project",
        description: "Allows asset search.",
        permissions: ["assets:read", "git:write"],
        requiredSecrets: [],
        entrypoints: ["workflow.md"],
        reviewState: "draft"
      }),
      content: "Use approved assets.",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: skill.version.id });
    await service.publishSkillVersion({ skillVersionId: skill.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: skill.version.id
    });

    const connector = await service.createProjectMCPConnector({
      projectId: project.id,
      definitionJson: JSON.stringify({
        id: "connector_assets",
        name: "Internal Assets",
        tools: [
          {
            name: "searchAssets",
            permission: "assets:read",
            roles: ["builder"],
            requiresApproval: false
          },
          {
            name: "createPullRequest",
            permission: "git:write",
            roles: ["deployer"],
            requiresApproval: true
          }
        ]
      })
    });

    await expect(
      service.listVisibleMCPToolsForProject({
        projectId: project.id,
        role: "builder"
      })
    ).resolves.toEqual([
      {
        connectorId: connector.id,
        name: "searchAssets",
        permission: "assets:read",
        requiresApproval: false
      }
    ]);

    await expect(
      service.listVisibleMCPToolsForProject({
        projectId: project.id,
        role: "deployer"
      })
    ).resolves.toEqual([]);

    await service.setProjectMCPToolApproval({
      projectId: project.id,
      connectorId: connector.id,
      toolName: "createPullRequest",
      approved: true,
      approvedByUserId: "local-owner"
    });

    await expect(
      service.listVisibleMCPToolsForProject({
        projectId: project.id,
        role: "deployer"
      })
    ).resolves.toEqual([
      {
        connectorId: connector.id,
        name: "createPullRequest",
        permission: "git:write",
        requiresApproval: true
      }
    ]);
  });

  it("passes repository-backed mcp tools into runtime context", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const runtime = new RecordingRuntime({ state: "completed", artifacts: completeArtifacts() });
    const service = new DemoWorkbenchService({
      repositories,
      builderRuntime: runtime,
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Runtime MCP" });
    const skill = await service.createSkillDraft({
      manifestJson: JSON.stringify({
        id: "skill_assets",
        name: "Asset Search",
        version: "0.1.0",
        type: "workflow",
        scope: "project",
        description: "Allows asset search.",
        permissions: ["assets:read"],
        requiredSecrets: [],
        entrypoints: ["workflow.md"],
        reviewState: "draft"
      }),
      content: "Use asset search.",
      contentType: "text/plain"
    });
    await service.validateSkillVersion({ skillVersionId: skill.version.id });
    await service.publishSkillVersion({ skillVersionId: skill.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: skill.version.id
    });
    await service.createProjectMCPConnector({
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

    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Generate a static LP."
    });
    await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });

    expect(runtime.requests[0]?.context?.mcpTools).toEqual([
      {
        connectorId: "connector_assets",
        name: "searchAssets",
        permission: "assets:read",
        requiresApproval: false
      }
    ]);
  });

  it("validates project mcp connector lifecycle edge cases", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "MCP Edges" });
    const skill = await service.createSkillDraft({
      manifestJson: JSON.stringify(brandSkillManifest()),
      content: "# Brand LP",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: skill.version.id });
    await service.publishSkillVersion({ skillVersionId: skill.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: skill.version.id
    });

    await expect(
      service.createProjectMCPConnector({
        projectId: project.id,
        definitionJson: "{"
      })
    ).rejects.toThrow("mcp_connector_json_invalid");
    await expect(
      service.createProjectMCPConnector({
        projectId: project.id,
        definitionJson: JSON.stringify({
          id: "connector_bad",
          name: "Bad",
          tools: []
        })
      })
    ).rejects.toThrow("mcp_connector_validation_failed");
    await expect(
      service.setProjectMCPToolApproval({
        projectId: project.id,
        connectorId: "connector_missing",
        toolName: "searchAssets",
        approved: true
      })
    ).rejects.toThrow("mcp_connector_not_found");

    const connector = await service.createProjectMCPConnector({
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
          },
          {
            name: "curateAssets",
            permission: "assets:read",
            roles: ["builder"],
            requiresApproval: true
          }
        ]
      })
    });

    await expect(
      service.createProjectMCPConnector({
        projectId: project.id,
        definitionJson: JSON.stringify({
          id: "connector_assets",
          name: "Duplicate",
          tools: [
            {
              name: "searchAssets",
              permission: "assets:read",
              roles: ["builder"],
              requiresApproval: false
            }
          ]
        })
      })
    ).rejects.toThrow("mcp_connector_already_exists");

    await expect(
      service.setProjectMCPToolApproval({
        projectId: project.id,
        connectorId: connector.id,
        toolName: "searchAssets",
        approved: true
      })
    ).rejects.toThrow("mcp_tool_approval_not_required");
    await expect(
      service.setProjectMCPToolApproval({
        projectId: project.id,
        connectorId: connector.id,
        toolName: "missingTool",
        approved: true
      })
    ).rejects.toThrow("mcp_tool_not_found");

    await expect(
      service.listVisibleMCPToolsForProject({
        projectId: project.id,
        role: "builder"
      })
    ).resolves.toEqual([
      {
        connectorId: connector.id,
        name: "searchAssets",
        permission: "assets:read",
        requiresApproval: false
      }
    ]);
    await service.setProjectMCPToolApproval({
      projectId: project.id,
      connectorId: connector.id,
      toolName: "curateAssets",
      approved: true
    });
    await expect(
      service.listVisibleMCPToolsForProject({
        projectId: project.id,
        role: "builder"
      })
    ).resolves.toEqual([
      {
        connectorId: connector.id,
        name: "searchAssets",
        permission: "assets:read",
        requiresApproval: false
      },
      {
        connectorId: connector.id,
        name: "curateAssets",
        permission: "assets:read",
        requiresApproval: true
      }
    ]);
    await service.setProjectMCPToolApproval({
      projectId: project.id,
      connectorId: connector.id,
      toolName: "curateAssets",
      approved: false
    });
    await expect(
      service.listVisibleMCPToolsForProject({
        projectId: project.id,
        role: "builder"
      })
    ).resolves.toEqual([
      {
        connectorId: connector.id,
        name: "searchAssets",
        permission: "assets:read",
        requiresApproval: false
      }
    ]);

    await service.setProjectMCPConnectorEnabled({
      projectId: project.id,
      connectorId: connector.id,
      enabled: false
    });
    await expect(
      service.listVisibleMCPToolsForProject({
        projectId: project.id,
        role: "builder"
      })
    ).resolves.toEqual([]);
  });

  it("keeps separate approval records when approval-required tools are approved concurrently", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Concurrent MCP" });
    const skill = await service.createSkillDraft({
      manifestJson: JSON.stringify(
        brandSkillManifest({
          permissions: ["assets:read", "git:write"]
        })
      ),
      content: "# Brand LP",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: skill.version.id });
    await service.publishSkillVersion({ skillVersionId: skill.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: skill.version.id
    });
    const connector = await service.createProjectMCPConnector({
      projectId: project.id,
      definitionJson: JSON.stringify({
        id: "connector_assets",
        name: "Assets",
        tools: [
          {
            name: "curateAssets",
            permission: "assets:read",
            roles: ["builder"],
            requiresApproval: true
          },
          {
            name: "createPullRequest",
            permission: "git:write",
            roles: ["builder"],
            requiresApproval: true
          }
        ]
      })
    });

    await Promise.all([
      service.setProjectMCPToolApproval({
        projectId: project.id,
        connectorId: connector.id,
        toolName: "curateAssets",
        approved: true
      }),
      service.setProjectMCPToolApproval({
        projectId: project.id,
        connectorId: connector.id,
        toolName: "createPullRequest",
        approved: true
      })
    ]);

    expect(await repositories.mcpToolApprovals.listForProject(project.id)).toHaveLength(2);
    await expect(
      service.listVisibleMCPToolsForProject({
        projectId: project.id,
        role: "builder"
      })
    ).resolves.toEqual([
      {
        connectorId: "connector_assets",
        name: "curateAssets",
        permission: "assets:read",
        requiresApproval: true
      },
      {
        connectorId: "connector_assets",
        name: "createPullRequest",
        permission: "git:write",
        requiresApproval: true
      }
    ]);
  });

  it("fails closed for malformed persisted mcp connectors while keeping the mcp state readable", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Malformed MCP" });
    const skill = await service.createSkillDraft({
      manifestJson: JSON.stringify(
        brandSkillManifest({
          permissions: ["assets:read"]
        })
      ),
      content: "# Brand LP",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: skill.version.id });
    await service.publishSkillVersion({ skillVersionId: skill.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: skill.version.id
    });

    const malformedConnector = {
      id: "connector_broken",
      scope: "project",
      targetKey: project.id,
      name: "Broken Connector",
      tools: [
        {
          name: "brokenTool",
          permission: "assets:read",
          requiresApproval: false
        }
      ],
      enabled: true,
      createdAt: "2026-05-12T08:00:00.000Z",
      updatedAt: "2026-05-12T08:00:00.000Z"
    } as unknown as MCPConnectorRecord;
    (
      repositories.mcpConnectors as unknown as {
        listForProject(projectId: string): Promise<MCPConnectorRecord[]>;
      }
    ).listForProject = async (projectId) =>
      projectId === project.id ? [malformedConnector] : [];

    await expect(
      service.listVisibleMCPToolsForProject({
        projectId: project.id,
        role: "builder"
      })
    ).resolves.toEqual([]);
    await expect(service.listProjectMCPState(project.id)).resolves.toMatchObject({
      connectors: [
        {
          id: "connector_broken",
          name: "Broken Connector",
          tools: [
            {
              name: "brokenTool",
              permission: "assets:read",
              requiresApproval: false,
              roles: []
            }
          ]
        }
      ],
      visibleToolsByRole: {
        builder: []
      }
    });
  });

  it("does not expose malformed mcp connectors with non-boolean enabled flags", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Malformed Enabled MCP" });
    const skill = await service.createSkillDraft({
      manifestJson: JSON.stringify(
        brandSkillManifest({
          permissions: ["assets:read"]
        })
      ),
      content: "# Brand LP",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: skill.version.id });
    await service.publishSkillVersion({ skillVersionId: skill.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: skill.version.id
    });

    const malformedConnector = {
      id: "connector_assets",
      scope: "project",
      targetKey: project.id,
      name: "Assets",
      tools: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["builder"],
          requiresApproval: false
        }
      ],
      enabled: "false",
      createdAt: "2026-05-12T08:00:00.000Z",
      updatedAt: "2026-05-12T08:00:00.000Z"
    } as unknown as MCPConnectorRecord;
    (
      repositories.mcpConnectors as unknown as {
        listForProject(projectId: string): Promise<MCPConnectorRecord[]>;
      }
    ).listForProject = async (projectId) =>
      projectId === project.id ? [malformedConnector] : [];

    await expect(
      service.listVisibleMCPToolsForProject({
        projectId: project.id,
        role: "builder"
      })
    ).resolves.toEqual([]);
  });

  it("does not inject a hidden default skill when no project skills are bound", async () => {
    const builderRuntime = new RecordingRuntime({ state: "completed", artifacts: completeArtifacts() });
    const service = new DemoWorkbenchService({
      builderRuntime,
      now: fixedClock()
    });

    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
    await service.generatePageVersion({ projectId: project.id, briefId: brief.id });

    expect(builderRuntime.requests[0]?.context?.skills).toEqual([]);
    expect(builderRuntime.requests[0]?.context?.mcpTools).toEqual([]);
  });

  it("does not pass disabled project skill bindings into runtime runs", async () => {
    const builderRuntime = new RecordingRuntime({ state: "completed", artifacts: completeArtifacts() });
    const service = new DemoWorkbenchService({
      builderRuntime,
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const draft = await service.createSkillDraft({
      manifestJson: JSON.stringify(brandSkillManifest()),
      content: "# Brand LP",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: draft.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });
    const binding = await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });
    await service.setProjectSkillBindingEnabled({
      projectId: project.id,
      bindingId: binding.id,
      enabled: false
    });

    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
    await service.generatePageVersion({ projectId: project.id, briefId: brief.id });

    expect(builderRuntime.requests[0]?.context?.skills).toEqual([]);
    expect(builderRuntime.requests[0]?.context?.mcpTools).toEqual([]);
  });

  it("ignores malformed non-project bindings with project ids in runtime runs and project state", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const builderRuntime = new RecordingRuntime({ state: "completed", artifacts: completeArtifacts() });
    const service = new DemoWorkbenchService({
      repositories,
      builderRuntime,
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const draft = await service.createSkillDraft({
      manifestJson: JSON.stringify(brandSkillManifest()),
      content: "# Brand LP",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: draft.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });
    await repositories.skillBindings.save({
      id: "skill_binding_1",
      skillVersionId: published.id,
      scope: "workspace",
      targetKey: project.id,
      projectId: project.id,
      enabled: true,
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:00.000Z"
    });

    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
    await service.generatePageVersion({ projectId: project.id, briefId: brief.id });
    const state = await service.listProjectSkillState(project.id);

    expect(builderRuntime.requests[0]?.context?.skills).toEqual([]);
    expect(builderRuntime.requests[0]?.context?.mcpTools).toEqual([]);
    expect(state.boundSkills).toEqual([]);
    await expect(
      service.setProjectSkillBindingEnabled({
        projectId: project.id,
        bindingId: "skill_binding_1",
        enabled: false
      })
    ).rejects.toThrow("skill_binding_not_found");
  });

  it("dedupes multiple published versions of the same manifest id in runtime runs", async () => {
    const builderRuntime = new RecordingRuntime({ state: "completed", artifacts: completeArtifacts() });
    const service = new DemoWorkbenchService({
      builderRuntime,
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const firstDraft = await service.createSkillDraft({
      manifestJson: JSON.stringify(brandSkillManifest()),
      content: "# Brand LP v1",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: firstDraft.version.id });
    const firstPublished = await service.publishSkillVersion({
      skillVersionId: firstDraft.version.id
    });
    const secondDraft = await service.createSkillDraft({
      manifestJson: JSON.stringify(brandSkillManifest({ version: "1.1.0" })),
      content: "# Brand LP v2",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: secondDraft.version.id });
    const secondPublished = await service.publishSkillVersion({
      skillVersionId: secondDraft.version.id
    });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: firstPublished.id
    });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: secondPublished.id
    });

    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
    await service.generatePageVersion({ projectId: project.id, briefId: brief.id });

    expect(builderRuntime.requests[0]?.context?.skills).toHaveLength(1);
    expect(builderRuntime.requests[0]?.context?.skills[0]).toMatchObject({
      id: "skill_brand",
      content: "# Brand LP v1"
    });
  });

  it("fails page generation when the builder runtime fails", async () => {
    const service = new DemoWorkbenchService({
      builderRuntime: new StaticRuntime({ state: "failed", artifacts: undefined }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });

    await expect(
      service.generatePageVersion({ projectId: project.id, briefId: brief.id })
    ).rejects.toThrow("Builder run failed.");
  });

  it("requires builder artifacts before creating a page version", async () => {
    const service = new DemoWorkbenchService({
      builderRuntime: new StaticRuntime({ state: "completed", artifacts: undefined }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });

    await expect(
      service.generatePageVersion({ projectId: project.id, briefId: brief.id })
    ).rejects.toThrow("Builder run did not return artifacts.");
  });

  it("rejects incomplete builder artifacts before creating a page version", async () => {
    const service = new DemoWorkbenchService({
      builderRuntime: new StaticRuntime({
        state: "completed",
        artifacts: { ...completeArtifacts(), stylesCss: " " }
      }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });

    await expect(
      service.generatePageVersion({ projectId: project.id, briefId: brief.id })
    ).rejects.toThrow("Builder run returned incomplete artifacts.");
  });

  it("does not create a page version from a non-completed builder run", async () => {
    const service = new DemoWorkbenchService({
      builderRuntime: new StaticRuntime({ state: "needs_input", artifacts: completeArtifacts() }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });

    await expect(
      service.generatePageVersion({ projectId: project.id, briefId: brief.id })
    ).rejects.toThrow("Builder run did not complete.");
  });

  it("marks review failed when reviewer returns blocking findings and blocks deployment", async () => {
    const blockingFinding: ReviewFinding = {
      severity: "blocking",
      target: "section:section_hero",
      explanation: "Hero section is missing a CTA.",
      suggestedFix: "Add a CTA.",
      blocksDeployment: true
    };
    const service = new DemoWorkbenchService({
      reviewerRuntime: new StaticRuntime({
        state: "completed",
        findings: [blockingFinding]
      }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
    const version = await service.generatePageVersion({ projectId: project.id, briefId: brief.id });

    const reviewed = await service.reviewPageVersion({ projectId: project.id, pageVersionId: version.id });

    expect(reviewed.reviewStatus).toBe("failed");
    expect(reviewed.findings).toEqual([blockingFinding]);
    await expect(
      service.approveAndCreateDeployment({
        projectId: project.id,
        pageVersionId: version.id,
        reviewerUserId: "reviewer_1"
      })
    ).rejects.toThrow("Page version must pass review before deployment.");
  });

  it("does not treat a failed reviewer runtime as a passed review", async () => {
    const service = new DemoWorkbenchService({
      reviewerRuntime: new StaticRuntime({ state: "failed" }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
    const version = await service.generatePageVersion({ projectId: project.id, briefId: brief.id });

    await expect(
      service.reviewPageVersion({ projectId: project.id, pageVersionId: version.id })
    ).rejects.toThrow("Reviewer run failed.");
  });

  it("does not treat a non-completed reviewer runtime as a passed review", async () => {
    const service = new DemoWorkbenchService({
      reviewerRuntime: new StaticRuntime({ state: "needs_approval", findings: [] }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
    const version = await service.generatePageVersion({ projectId: project.id, briefId: brief.id });

    await expect(
      service.reviewPageVersion({ projectId: project.id, pageVersionId: version.id })
    ).rejects.toThrow("Reviewer run did not complete.");
  });

  it("does not let re-review invalidate a deployed page version", async () => {
    const laterBlockingFinding: ReviewFinding = {
      severity: "blocking",
      target: "section:section_hero",
      explanation: "Later review failed.",
      suggestedFix: "Do not mutate deployed review.",
      blocksDeployment: true
    };
    const reviewerRuntime = new MutableRuntime({ state: "completed", findings: [] });
    const service = new DemoWorkbenchService({
      reviewerRuntime,
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
    const version = await service.generatePageVersion({ projectId: project.id, briefId: brief.id });
    const reviewed = await service.reviewPageVersion({ projectId: project.id, pageVersionId: version.id });
    const deployment = await service.approveAndCreateDeployment({
      projectId: project.id,
      pageVersionId: version.id,
      reviewerUserId: "reviewer_1"
    });

    reviewerRuntime.result = { state: "completed", findings: [laterBlockingFinding] };
    const retryReview = await service.reviewPageVersion({ projectId: project.id, pageVersionId: version.id });
    const snapshot = await service.getSnapshot(project.id);

    expect(reviewed.reviewStatus).toBe("passed");
    expect(retryReview.reviewStatus).toBe("passed");
    expect(retryReview.findings).toEqual([]);
    expect(snapshot.currentPageVersion?.reviewStatus).toBe("passed");
    expect(snapshot.deployment).toEqual(deployment);
  });

  it("keeps the latest deployment visible when a newer page version is pending", async () => {
    const service = createDemoWorkbenchService();
    const project = await service.createProject({ name: "Project" });
    const firstBrief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "First" });
    const firstVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: firstBrief.id
    });
    await service.reviewPageVersion({ projectId: project.id, pageVersionId: firstVersion.id });
    const deployment = await service.approveAndCreateDeployment({
      projectId: project.id,
      pageVersionId: firstVersion.id,
      reviewerUserId: "reviewer_1"
    });
    const secondBrief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Second" });
    const secondVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: secondBrief.id
    });

    const snapshot = await service.getSnapshot(project.id);

    expect(snapshot.currentPageVersion?.id).toBe(secondVersion.id);
    expect(snapshot.currentPageVersion?.reviewStatus).toBe("pending");
    expect(snapshot.deployment).toEqual(deployment);
  });

  it("rejects requests for unknown or mismatched records", async () => {
    const service = createDemoWorkbenchService();
    const firstProject = await service.createProject({ name: "First" });
    const secondProject = await service.createProject({ name: "Second" });
    const brief = await service.createBriefFromPrompt({ projectId: firstProject.id, prompt: "Prompt" });
    const version = await service.generatePageVersion({ projectId: firstProject.id, briefId: brief.id });

    await expect(service.createBriefFromPrompt({ projectId: "project_404", prompt: "Prompt" }))
      .rejects.toThrow("Project not found.");
    await expect(service.generatePageVersion({ projectId: secondProject.id, briefId: brief.id }))
      .rejects.toThrow("Brief not found for project.");
    await expect(service.reviewPageVersion({ projectId: secondProject.id, pageVersionId: version.id }))
      .rejects.toThrow("Page version not found for project.");
    await expect(service.getSnapshot("project_404")).rejects.toThrow("Project not found.");
  });
});

class StaticRuntime implements AgentRuntimeAdapter {
  constructor(private readonly result: Partial<RuntimeRunResult>) {}

  async run(request: RuntimeRunRequest): Promise<RuntimeRunResult> {
    return {
      runId: request.runId,
      projectId: request.projectId,
      role: request.role,
      state: this.result.state ?? "completed",
      events: [],
      artifacts: this.result.artifacts,
      findings: this.result.findings
    };
  }
}

class MutableRuntime implements AgentRuntimeAdapter {
  constructor(public result: Partial<RuntimeRunResult>) {}

  async run(request: RuntimeRunRequest): Promise<RuntimeRunResult> {
    return {
      runId: request.runId,
      projectId: request.projectId,
      role: request.role,
      state: this.result.state ?? "completed",
      events: [],
      artifacts: this.result.artifacts,
      findings: this.result.findings
    };
  }
}

class ThrowingRuntime implements AgentRuntimeAdapter {
  constructor(private readonly error: Error) {}

  async run(): Promise<RuntimeRunResult> {
    throw this.error;
  }
}

class RecordingRuntime extends StaticRuntime {
  readonly requests: RuntimeRunRequest[] = [];

  override async run(request: RuntimeRunRequest): Promise<RuntimeRunResult> {
    this.requests.push(request);
    return super.run(request);
  }
}

class RecordingDeploymentAdapter implements GitDeploymentAdapter {
  readonly inputs: Array<{
    projectId: string;
    pageVersionId: string;
    artifacts: StaticArtifacts;
    approved: boolean;
  }> = [];

  async createHandoff(input: {
    projectId: string;
    pageVersionId: string;
    artifacts: StaticArtifacts;
    approved: boolean;
  }): Promise<DeploymentHandoff> {
    this.inputs.push(input);
    return {
      id: "deployment_1",
      projectId: input.projectId,
      pageVersionId: input.pageVersionId,
      branch: `lp-agent/${input.projectId}/${input.pageVersionId}`,
      commitSha: "mock_commit_1",
      pullRequestUrl: "https://git.example.local/pr/deployment_1",
      files: ["index.html", "styles.css", "script.js"],
      status: "pr_opened"
    };
  }
}

function completeArtifacts(): StaticArtifacts {
  return {
    indexHtml: "<!doctype html><html></html>",
    stylesCss: ":root {}",
    scriptJs: "window.lpAgent = true;"
  };
}

function fixedClock(): () => Date {
  return () => new Date("2026-05-11T00:00:00.000Z");
}

function brandSkillManifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    id: "skill_brand",
    name: "Brand LP",
    version: "1.0.0",
    type: "template",
    scope: "project",
    description: "Brand LP sections.",
    permissions: ["brief:read", "artifact:write", "assets:read"],
    requiredSecrets: [],
    entrypoints: ["skills/brand.md"],
    reviewState: "published",
    ...overrides
  };
}
