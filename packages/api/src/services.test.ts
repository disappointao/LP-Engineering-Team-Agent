import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { StaticArtifacts } from "@lp-agent/artifacts";
import { createInMemoryWorkbenchRepositories, createJsonFileWorkbenchRepositories } from "@lp-agent/db";
import type { DeploymentHandoff, GitDeploymentAdapter } from "@lp-agent/git-deployment";
import { sampleBrief, type ReviewFinding } from "@lp-agent/lp-schema";
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
  type PageVersionRecord,
  type ProjectRecord,
  type WorkbenchSnapshot
} from "./index";

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
    expect(builderRuntime.requests[0]?.runId).toBe("run_builder_1");
    expect(reviewerRuntime.requests[0]?.context?.mcpTools.map((tool) => tool.name)).toEqual([
      "searchAssets"
    ]);
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
