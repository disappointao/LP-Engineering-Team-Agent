import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createStaticArtifactWorkspaceFiles,
  type StaticArtifacts
} from "@lp-agent/artifacts";
import {
  createInMemoryWorkbenchRepositories,
  createJsonFileWorkbenchRepositories,
  type RunEventRecord,
  type RunRecord
} from "@lp-agent/db";
import type { DeploymentHandoff, GitDeploymentAdapter } from "@lp-agent/git-deployment";
import { sampleBrief, type ReviewFinding } from "@lp-agent/lp-schema";
import type { MCPToolExecutor } from "@lp-agent/mcp-gateway";
import type { ModelFetch } from "@lp-agent/model-gateway";
import type {
  AgentRuntimeAdapter,
  RuntimeRunRequest,
  RuntimeRunResult
} from "@lp-agent/runtime-adapters";
import type { SkillManifest } from "@lp-agent/skills";
import {
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter
} from "@lp-agent/worker-runtime";
import {
  DemoWorkbenchService,
  createDemoWorkbenchService,
  runAgentStep,
  type BriefRecord,
  type MCPConnectorRecord,
  type PageVersionRecord,
  type ProjectRecord,
  type WorkbenchSnapshot
} from "./index";
import {
  createProjectMemberId,
  createWorkspaceMemberId
} from "./collaboration";
import {
  ContextPackSchema,
  assembleContextPack
} from "./context-assembler";
import type {
  ToolCommandRunner,
  ToolCommandRunInput,
  ToolCommandRunResult
} from "./tool-command-runner";
import {
  WorkerBackedToolCommandRunner,
  createSandboxPolicyForToolCommand
} from "./worker-backed-tool-command-runner";

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
      artifactWorkspaceId: "artifact_workspace_1",
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

  it("creates durable artifact workspace files for generated page versions", async () => {
    const artifacts: StaticArtifacts = {
      indexHtml: "<!doctype html><html><body>Workspace page</body></html>",
      stylesCss: "body { color: #123456; }",
      scriptJs: "const JS_WORKSPACE_SECRET = 'keep-out';"
    };
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
      builderRuntime: new StaticRuntime({ state: "completed", artifacts }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a static LP"
    });

    const version = await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });

    expect(version.artifactWorkspaceId).toBe("artifact_workspace_1");
    await expect(repositories.pageVersions.getById(version.id)).resolves.toMatchObject({
      id: version.id,
      artifactWorkspaceId: version.artifactWorkspaceId
    });
    const workspace = await repositories.artifactWorkspaces.getForPageVersion(version.id);
    expect(workspace).toMatchObject({
      id: version.artifactWorkspaceId,
      projectId: project.id,
      pageVersionId: version.id,
      runId: `run_builder_${version.id}`,
      kind: "static_lp",
      state: "active",
      createdAt: expect.any(String),
      updatedAt: expect.any(String)
    });
    expect(workspace?.updatedAt).toBe(workspace?.createdAt);

    const files = await repositories.artifactWorkspaceFiles.listForWorkspace(
      version.artifactWorkspaceId ?? ""
    );
    expect(files.map((file) => file.path)).toEqual(["index.html", "styles.css", "script.js"]);
    expect(files.map((file) => file.content)).toEqual([
      artifacts.indexHtml,
      artifacts.stylesCss,
      artifacts.scriptJs
    ]);
    expect(files).toEqual([
      expect.objectContaining({
        id: "artifact_workspace_1_file_index_html",
        workspaceId: "artifact_workspace_1",
        pageVersionId: version.id,
        kind: "html",
        mimeType: "text/html"
      }),
      expect.objectContaining({
        id: "artifact_workspace_1_file_styles_css",
        workspaceId: "artifact_workspace_1",
        pageVersionId: version.id,
        kind: "css",
        mimeType: "text/css"
      }),
      expect.objectContaining({
        id: "artifact_workspace_1_file_script_js",
        workspaceId: "artifact_workspace_1",
        pageVersionId: version.id,
        kind: "js",
        mimeType: "text/javascript"
      })
    ]);

    const builderEvents = await repositories.runEvents.listForRun(`run_builder_${version.id}`);
    const workspaceEvent = builderEvents.find(
      (event) => event.type === "artifact.workspace.created"
    );
    expect(workspaceEvent).toMatchObject({
      runId: `run_builder_${version.id}`,
      type: "artifact.workspace.created",
      message: "Artifact workspace created.",
      payload: {
        workspaceId: "artifact_workspace_1",
        artifactWorkspaceId: "artifact_workspace_1",
        pageVersionId: version.id,
        kind: "static_lp",
        fileCount: 3,
        files: [
          expect.objectContaining({ path: "index.html", kind: "html" }),
          expect.objectContaining({ path: "styles.css", kind: "css" }),
          expect.objectContaining({ path: "script.js", kind: "js" })
        ]
      }
    });
    const serializedPayload = JSON.stringify(workspaceEvent?.payload);
    expect(serializedPayload).not.toContain("<html>");
    expect(serializedPayload).not.toContain(artifacts.stylesCss);
    expect(serializedPayload).not.toContain("JS_WORKSPACE_SECRET");
    expect(serializedPayload).not.toContain("content");
  });

  it("recovers snapshot page artifacts from workspace files", async () => {
    const embeddedArtifacts = completeArtifacts();
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
      builderRuntime: new StaticRuntime({ state: "completed", artifacts: embeddedArtifacts }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a static LP"
    });
    const version = await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });
    const recoveredArtifacts: StaticArtifacts = {
      ...embeddedArtifacts,
      indexHtml: "<!doctype html><html><body>Recovered workspace page</body></html>"
    };
    const updatedFiles = createStaticArtifactWorkspaceFiles({
      workspaceId: version.artifactWorkspaceId ?? "",
      projectId: project.id,
      pageVersionId: version.id,
      artifacts: recoveredArtifacts,
      createdAt: "2026-05-11T00:01:00.000Z"
    });
    for (const file of updatedFiles) {
      await repositories.artifactWorkspaceFiles.save(file);
    }

    const snapshot = await service.getSnapshot(project.id);

    expect(snapshot.currentPageVersion?.artifactWorkspaceId).toBe(version.artifactWorkspaceId);
    expect(snapshot.currentPageVersion?.artifacts).toEqual(recoveredArtifacts);
    expect(snapshot.currentPageVersion?.artifacts.indexHtml).not.toBe(version.artifacts.indexHtml);
  });

  it("falls back to embedded snapshot artifacts when workspace files are missing", async () => {
    const embeddedArtifacts = completeArtifacts();
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a static LP"
    });
    await repositories.pageVersions.save({
      id: "version_missing_workspace",
      projectId: project.id,
      briefId: brief.id,
      artifactWorkspaceId: "missing_workspace",
      artifacts: embeddedArtifacts,
      reviewStatus: "pending",
      findings: [],
      createdAt: "2026-05-11T00:00:01.000Z"
    });
    const originalGetWorkspaceById = repositories.artifactWorkspaces.getById.bind(
      repositories.artifactWorkspaces
    );
    let workspaceLookupAttempts = 0;
    repositories.artifactWorkspaces.getById = async (workspaceId) => {
      workspaceLookupAttempts += 1;
      return originalGetWorkspaceById(workspaceId);
    };

    const snapshot = await service.getSnapshot(project.id);

    expect(workspaceLookupAttempts).toBe(1);
    expect(snapshot.currentPageVersion?.artifactWorkspaceId).toBe("missing_workspace");
    expect(snapshot.currentPageVersion?.artifacts).toEqual(embeddedArtifacts);
  });

  it("rejects snapshot hydration when workspace ownership does not match the page version", async () => {
    const embeddedArtifacts = completeArtifacts();
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a static LP"
    });
    await repositories.pageVersions.save({
      id: "version_wrong_workspace_owner",
      projectId: project.id,
      briefId: brief.id,
      artifactWorkspaceId: "artifact_workspace_wrong_owner",
      artifacts: embeddedArtifacts,
      reviewStatus: "pending",
      findings: [],
      createdAt: "2026-05-11T00:00:01.000Z"
    });
    await repositories.artifactWorkspaces.save({
      id: "artifact_workspace_wrong_owner",
      projectId: "project_other",
      pageVersionId: "version_other",
      kind: "static_lp",
      state: "active",
      createdAt: "2026-05-11T00:00:01.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z"
    });
    const files = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_wrong_owner",
      projectId: project.id,
      pageVersionId: "version_wrong_workspace_owner",
      artifacts: {
        ...embeddedArtifacts,
        indexHtml: "<!doctype html><html><body>Wrong workspace owner</body></html>"
      },
      createdAt: "2026-05-11T00:01:00.000Z"
    });
    for (const file of files) {
      await repositories.artifactWorkspaceFiles.save(file);
    }

    await expect(service.getSnapshot(project.id)).rejects.toThrow(
      "Artifact workspace artifact_workspace_wrong_owner does not belong to page version version_wrong_workspace_owner."
    );
  });

  it("recovers explicit record snapshots from workspace files", async () => {
    const embeddedArtifacts = completeArtifacts();
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
      builderRuntime: new StaticRuntime({ state: "completed", artifacts: embeddedArtifacts }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a static LP"
    });
    const version = await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });
    const recoveredArtifacts: StaticArtifacts = {
      ...embeddedArtifacts,
      stylesCss: "body { color: rebeccapurple; }"
    };
    const updatedFiles = createStaticArtifactWorkspaceFiles({
      workspaceId: version.artifactWorkspaceId ?? "",
      projectId: project.id,
      pageVersionId: version.id,
      artifacts: recoveredArtifacts,
      createdAt: "2026-05-11T00:01:00.000Z"
    });
    for (const file of updatedFiles) {
      await repositories.artifactWorkspaceFiles.save(file);
    }

    const snapshot = await service.getSnapshotForRecords({
      projectId: project.id,
      briefId: brief.id,
      pageVersionId: version.id
    });

    expect(snapshot.currentPageVersion?.artifactWorkspaceId).toBe(version.artifactWorkspaceId);
    expect(snapshot.currentPageVersion?.artifacts).toEqual(recoveredArtifacts);
  });

  it("rejects explicit record hydration when file ownership does not match the page version", async () => {
    const embeddedArtifacts = completeArtifacts();
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a static LP"
    });
    await repositories.pageVersions.save({
      id: "version_wrong_file_owner",
      projectId: project.id,
      briefId: brief.id,
      artifactWorkspaceId: "artifact_workspace_wrong_file_owner",
      artifacts: embeddedArtifacts,
      reviewStatus: "pending",
      findings: [],
      createdAt: "2026-05-11T00:00:01.000Z"
    });
    await repositories.artifactWorkspaces.save({
      id: "artifact_workspace_wrong_file_owner",
      projectId: project.id,
      pageVersionId: "version_wrong_file_owner",
      kind: "static_lp",
      state: "active",
      createdAt: "2026-05-11T00:00:01.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z"
    });
    const files = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_wrong_file_owner",
      projectId: "project_other",
      pageVersionId: "version_other",
      artifacts: {
        ...embeddedArtifacts,
        stylesCss: "body { color: crimson; }"
      },
      createdAt: "2026-05-11T00:01:00.000Z"
    });
    for (const file of files) {
      await repositories.artifactWorkspaceFiles.save(file);
    }

    await expect(
      service.getSnapshotForRecords({
        projectId: project.id,
        briefId: brief.id,
        pageVersionId: "version_wrong_file_owner"
      })
    ).rejects.toThrow(
      "Artifact workspace file index.html does not belong to page version version_wrong_file_owner."
    );
  });

  it("falls back to embedded artifacts when workspace files are incomplete", async () => {
    const embeddedArtifacts = completeArtifacts();
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a static LP"
    });
    await repositories.pageVersions.save({
      id: "version_incomplete_workspace",
      projectId: project.id,
      briefId: brief.id,
      artifactWorkspaceId: "artifact_workspace_incomplete",
      artifacts: embeddedArtifacts,
      reviewStatus: "pending",
      findings: [],
      createdAt: "2026-05-11T00:00:01.000Z"
    });
    await repositories.artifactWorkspaces.save({
      id: "artifact_workspace_incomplete",
      projectId: project.id,
      pageVersionId: "version_incomplete_workspace",
      kind: "static_lp",
      state: "active",
      createdAt: "2026-05-11T00:00:01.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z"
    });
    const [indexFile] = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_incomplete",
      projectId: project.id,
      pageVersionId: "version_incomplete_workspace",
      artifacts: {
        ...embeddedArtifacts,
        indexHtml: "<!doctype html><html><body>Incomplete workspace page</body></html>"
      },
      createdAt: "2026-05-11T00:01:00.000Z"
    });
    await repositories.artifactWorkspaceFiles.save(indexFile!);

    const snapshot = await service.getSnapshot(project.id);

    expect(snapshot.currentPageVersion?.artifactWorkspaceId).toBe(
      "artifact_workspace_incomplete"
    );
    expect(snapshot.currentPageVersion?.artifacts).toEqual(embeddedArtifacts);
  });

  it("falls back to embedded artifacts when workspace file metadata is corrupt", async () => {
    const embeddedArtifacts = completeArtifacts();
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a static LP"
    });
    await repositories.pageVersions.save({
      id: "version_corrupt_workspace",
      projectId: project.id,
      briefId: brief.id,
      artifactWorkspaceId: "artifact_workspace_corrupt",
      artifacts: embeddedArtifacts,
      reviewStatus: "pending",
      findings: [],
      createdAt: "2026-05-11T00:00:01.000Z"
    });
    await repositories.artifactWorkspaces.save({
      id: "artifact_workspace_corrupt",
      projectId: project.id,
      pageVersionId: "version_corrupt_workspace",
      kind: "static_lp",
      state: "active",
      createdAt: "2026-05-11T00:00:01.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z"
    });
    const files = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_corrupt",
      projectId: project.id,
      pageVersionId: "version_corrupt_workspace",
      artifacts: {
        ...embeddedArtifacts,
        scriptJs: "console.log('corrupt metadata should fallback');"
      },
      createdAt: "2026-05-11T00:01:00.000Z"
    }).map((file) =>
      file.path === "script.js"
        ? { ...file, sha256: "not-the-content-hash" }
        : file
    );
    for (const file of files) {
      await repositories.artifactWorkspaceFiles.save(file);
    }

    const snapshot = await service.getSnapshot(project.id);

    expect(snapshot.currentPageVersion?.artifactWorkspaceId).toBe("artifact_workspace_corrupt");
    expect(snapshot.currentPageVersion?.artifacts).toEqual(embeddedArtifacts);
  });

  it("does not save a page version pointer when durable artifact file persistence fails", async () => {
    const artifacts = completeArtifacts();
    const repositories = createInMemoryWorkbenchRepositories();
    const originalSaveFile = repositories.artifactWorkspaceFiles.save.bind(
      repositories.artifactWorkspaceFiles
    );
    let fileSaveAttempts = 0;
    repositories.artifactWorkspaceFiles.save = async (file) => {
      fileSaveAttempts += 1;
      if (fileSaveAttempts === 2) {
        throw new Error("artifact workspace file save failed");
      }
      await originalSaveFile(file);
    };
    const service = new DemoWorkbenchService({
      repositories,
      builderRuntime: new StaticRuntime({ state: "completed", artifacts }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a static LP"
    });

    await expect(
      service.generatePageVersion({ projectId: project.id, briefId: brief.id })
    ).rejects.toThrow("artifact workspace file save failed");

    await expect(repositories.pageVersions.listAll()).resolves.toEqual([]);
    const failedBuilderEvents = await repositories.runEvents.listForRun("run_builder_version_1");
    expect(failedBuilderEvents.map((event) => event.type)).not.toContain(
      "artifact.workspace.created"
    );
    expect(failedBuilderEvents.map((event) => event.type)).not.toContain("handoff.created");

    const orphanWorkspaces = await repositories.artifactWorkspaces.listAll();
    const orphanWorkspaceIds = orphanWorkspaces.map((workspace) => workspace.id);
    const orphanPageVersionIds = new Set(
      orphanWorkspaces
        .map((workspace) => workspace.pageVersionId)
        .filter((pageVersionId): pageVersionId is string => pageVersionId !== undefined)
    );

    const version = await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });

    expect(version.artifactWorkspaceId).toBeDefined();
    if (orphanWorkspaceIds.length > 0) {
      expect(orphanWorkspaceIds).not.toContain(version.artifactWorkspaceId);
    }
    if (orphanPageVersionIds.size > 0) {
      expect(orphanPageVersionIds.has(version.id)).toBe(false);
    }
    await expect(repositories.pageVersions.listAll()).resolves.toEqual([
      expect.objectContaining({
        id: version.id,
        artifactWorkspaceId: version.artifactWorkspaceId
      })
    ]);
    const workspace = await repositories.artifactWorkspaces.getById(
      version.artifactWorkspaceId ?? ""
    );
    expect(workspace).toMatchObject({
      id: version.artifactWorkspaceId,
      pageVersionId: version.id
    });
    await expect(repositories.artifactWorkspaces.getForPageVersion(version.id)).resolves.toEqual(
      workspace
    );
    await expect(
      repositories.artifactWorkspaceFiles.listForWorkspace(version.artifactWorkspaceId ?? "")
    ).resolves.toEqual([
      expect.objectContaining({ path: "index.html", content: artifacts.indexHtml }),
      expect.objectContaining({ path: "styles.css", content: artifacts.stylesCss }),
      expect.objectContaining({ path: "script.js", content: artifacts.scriptJs })
    ]);
  });

  it("creates an owner project member for the current local user", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories });

    const project = await service.createProject({ name: "Spring sale" });

    await expect(service.listProjectMembers(project.id)).resolves.toEqual([
      {
        id: "project_member_project_1_local-web-user",
        projectId: "project_1",
        userId: "local-web-user",
        role: "owner",
        displayName: "Local user",
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      }
    ]);
  });

  it("uses the configured current user when creating project ownership", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
      currentUser: {
        id: "user_ada",
        displayName: "Ada Lovelace"
      }
    });

    const project = await service.createProject({ name: "Ada project" });

    await expect(repositories.projectMembers.getByProjectAndUser(project.id, "user_ada"))
      .resolves.toMatchObject({
        projectId: project.id,
        userId: "user_ada",
        role: "owner",
        displayName: "Ada Lovelace"
      });
  });

  it("keeps owner membership creation idempotent for the same project and user", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories });
    const project = await service.createProject({ name: "Spring sale" });

    await service.ensureProjectOwnerMembership(project.id);
    await service.ensureProjectOwnerMembership(project.id);

    await expect(repositories.projectMembers.listForProject(project.id)).resolves.toHaveLength(1);
  });

  it("lists project members only for the requested project", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories });
    const first = await service.createProject({ name: "First" });
    const second = await service.createProject({ name: "Second" });

    await service.addProjectMember({
      projectId: first.id,
      userId: "reviewer_1",
      role: "reviewer",
      displayName: "Review User"
    });

    await expect(service.listProjectMembers(first.id)).resolves.toEqual([
      expect.objectContaining({ userId: "local-web-user", role: "owner" }),
      expect.objectContaining({ userId: "reviewer_1", role: "reviewer" })
    ]);
    await expect(service.listProjectMembers(second.id)).resolves.toEqual([
      expect.objectContaining({ userId: "local-web-user", role: "owner" })
    ]);
  });

  it("keeps distinct project member ids for realistic user id variants", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories });
    const project = await service.createProject({ name: "Spring sale" });

    await service.addProjectMember({
      projectId: project.id,
      userId: "reviewer/a",
      role: "reviewer",
      displayName: "Slash Reviewer"
    });
    await service.addProjectMember({
      projectId: project.id,
      userId: "reviewer_a",
      role: "reviewer",
      displayName: "Underscore Reviewer"
    });

    await expect(service.listProjectMembers(project.id)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: "local-web-user", role: "owner" }),
      expect.objectContaining({ userId: "reviewer/a", role: "reviewer" }),
      expect.objectContaining({ userId: "reviewer_a", role: "reviewer" })
    ]));
    await expect(service.listProjectMembers(project.id)).resolves.toHaveLength(3);
    await expect(repositories.projectMembers.listForProject(project.id)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: expect.stringMatching(/^project_member_v1_/),
        userId: "reviewer/a"
      }),
      expect.objectContaining({
        id: "project_member_project_1_local-web-user",
        userId: "local-web-user"
      }),
      expect.objectContaining({
        id: expect.stringMatching(/^project_member_v1_/),
        userId: "reviewer_a"
      })
    ]));
  });

  it("keeps reserved encoded prefixes distinct from literal project member user ids", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories });
    const project = await service.createProject({ name: "Spring sale" });

    await service.addProjectMember({
      projectId: project.id,
      userId: "reviewer/a",
      role: "reviewer",
      displayName: "Slash Reviewer"
    });
    await service.addProjectMember({
      projectId: project.id,
      userId: "b64_cmV2aWV3ZXIvYQ",
      role: "reviewer",
      displayName: "Literal Encoded Reviewer"
    });

    await expect(service.listProjectMembers(project.id)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: "reviewer/a", role: "reviewer" }),
      expect.objectContaining({ userId: "b64_cmV2aWV3ZXIvYQ", role: "reviewer" })
    ]));
    await expect(service.listProjectMembers(project.id)).resolves.toHaveLength(3);

    const members = await repositories.projectMembers.listForProject(project.id);
    const slashReviewer = members.find((member) => member.userId === "reviewer/a");
    const literalReviewer = members.find((member) => member.userId === "b64_cmV2aWV3ZXIvYQ");

    expect(slashReviewer?.id).toMatch(/^project_member_v1_/);
    expect(literalReviewer?.id).toBeDefined();
    expect(literalReviewer?.id).not.toBe(slashReviewer?.id);
  });

  it("keeps project and workspace member ids distinct across tuple boundaries", () => {
    expect(createProjectMemberId("project_1", "local-web-user")).toBe(
      "project_member_project_1_local-web-user"
    );
    expect(createProjectMemberId("project_1", "a_b")).not.toBe(
      createProjectMemberId("project_1_a", "b")
    );
    expect(createWorkspaceMemberId("workspace_1", "a_b")).not.toBe(
      createWorkspaceMemberId("workspace_1_a", "b")
    );
  });

  it("keeps project members distinct when project and user ids overlap at tuple boundaries", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories });
    const firstProject = await service.createProject({ name: "First" });
    const secondProject: ProjectRecord = {
      id: "project_1_a",
      name: "Second",
      createdAt: "2026-05-11T00:00:00.000Z"
    };
    await repositories.projects.save(secondProject);

    await service.addProjectMember({
      projectId: firstProject.id,
      userId: "a_b",
      role: "reviewer"
    });
    await service.addProjectMember({
      projectId: secondProject.id,
      userId: "b",
      role: "reviewer"
    });

    await expect(service.listProjectMembers(firstProject.id)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ projectId: firstProject.id, userId: "a_b" })
    ]));
    await expect(service.listProjectMembers(secondProject.id)).resolves.toEqual([
      expect.objectContaining({ projectId: secondProject.id, userId: "b" })
    ]);

    const firstMember = await repositories.projectMembers.getByProjectAndUser(firstProject.id, "a_b");
    const secondMember = await repositories.projectMembers.getByProjectAndUser(secondProject.id, "b");
    expect(firstMember?.id).toBeDefined();
    expect(secondMember?.id).toBeDefined();
    expect(firstMember?.id).not.toBe(secondMember?.id);
  });

  it("preserves project member display name when updating role without a replacement", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories });
    const project = await service.createProject({ name: "Spring sale" });

    await service.addProjectMember({
      projectId: project.id,
      userId: "reviewer_1",
      role: "reviewer",
      displayName: "Review User"
    });

    await expect(
      service.addProjectMember({
        projectId: project.id,
        userId: "reviewer_1",
        role: "admin"
      })
    ).resolves.toMatchObject({
      userId: "reviewer_1",
      role: "admin",
      displayName: "Review User"
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
      "run_planner_brief_1:5:handoff.created",
      "run_builder_version_1:1:handoff.consumed",
      "run_builder_version_1:2:run.started",
      "run_builder_version_1:3:runtime.context.loaded",
      "run_builder_version_1:4:model.completed",
      "run_builder_version_1:5:artifact.created",
      "run_builder_version_1:6:run.completed",
      "run_builder_version_1:7:artifact.workspace.created",
      "run_builder_version_1:8:handoff.created",
      "run_reviewer_version_1:1:handoff.consumed",
      "run_reviewer_version_1:2:run.started",
      "run_reviewer_version_1:3:runtime.context.loaded",
      "run_reviewer_version_1:4:model.completed",
      "run_reviewer_version_1:5:review.completed",
      "run_reviewer_version_1:6:run.completed",
      "run_reviewer_version_1:7:handoff.created",
      "run_deployer_version_1:1:handoff.consumed",
      "run_deployer_version_1:2:run.started",
      "run_deployer_version_1:3:runtime.context.loaded",
      "run_deployer_version_1:4:model.completed",
      "run_deployer_version_1:5:run.completed"
    ]);
    expect(runs[1]?.contextSummary.injected).toEqual(
      expect.arrayContaining(["artifactWorkspace:memory"])
    );
    const workspaceEvent = events.find((event) => event.type === "artifact.workspace.created");
    expect(workspaceEvent).toMatchObject({
      runId: "run_builder_version_1",
      sequence: 7,
      payload: expect.objectContaining({
        workspaceId: pageVersion.artifactWorkspaceId,
        pageVersionId: pageVersion.id,
        kind: "static_lp",
        fileCount: 3,
        files: [
          expect.objectContaining({ path: "index.html", kind: "html" }),
          expect.objectContaining({ path: "styles.css", kind: "css" }),
          expect.objectContaining({ path: "script.js", kind: "js" })
        ]
      })
    });
    const serializedWorkspaceEvent = JSON.stringify(workspaceEvent?.payload);
    expect(serializedWorkspaceEvent).not.toContain(pageVersion.artifacts.indexHtml);
    expect(serializedWorkspaceEvent).not.toContain(pageVersion.artifacts.stylesCss);
    expect(serializedWorkspaceEvent).not.toContain(pageVersion.artifacts.scriptJs);
  });

  it("creates ready handoffs for planner and builder outputs", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });

    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a sale LP"
    });
    const pageVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });

    await expect(repositories.agentHandoffs.listForProject(project.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromRunId: `run_planner_${brief.id}`,
          fromRole: "planner",
          toRole: "builder",
          state: "consumed",
          artifactRefs: {
            briefId: brief.id
          }
        }),
        expect.objectContaining({
          fromRunId: `run_builder_${pageVersion.id}`,
          fromRole: "builder",
          toRole: "reviewer",
          state: "ready",
          artifactRefs: {
            briefId: brief.id,
            pageVersionId: pageVersion.id
          }
        })
      ])
    );
    await expect(repositories.runEvents.listForProject(project.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "handoff.created" }),
        expect.objectContaining({ type: "handoff.consumed" })
      ])
    );
  });

  it("consumes only the handoff for the artifact being processed", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const firstBrief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create first LP"
    });
    const secondBrief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create second LP"
    });

    await service.generatePageVersion({
      projectId: project.id,
      briefId: secondBrief.id
    });

    await expect(repositories.agentHandoffs.listInbound({
      projectId: project.id,
      toRole: "builder"
    })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "ready",
          artifactRefs: {
            briefId: firstBrief.id
          }
        }),
        expect.objectContaining({
          state: "consumed",
          artifactRefs: {
            briefId: secondBrief.id
          }
        })
      ])
    );
  });

  it("creates ready reviewer handoff before deployer and consumes it during deployment", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a sale LP"
    });
    const pageVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });
    const reviewed = await service.reviewPageVersion({
      projectId: project.id,
      pageVersionId: pageVersion.id
    });

    expect(reviewed.reviewStatus).toBe("passed");
    await expect(
      repositories.agentHandoffs.listInbound({
        projectId: project.id,
        toRole: "deployer"
      })
    ).resolves.toEqual([
      expect.objectContaining({
        fromRole: "reviewer",
        toRole: "deployer",
        state: "ready",
        artifactRefs: {
          pageVersionId: pageVersion.id
        }
      })
    ]);

    await service.approveAndCreateDeployment({
      projectId: project.id,
      pageVersionId: pageVersion.id,
      reviewerUserId: "reviewer_1"
    });

    await expect(
      repositories.agentHandoffs.listInbound({
        projectId: project.id,
        toRole: "deployer"
      })
    ).resolves.toEqual([
      expect.objectContaining({
        state: "consumed"
      })
    ]);
  });

  it("blocks deployer creation when reviewer creates a blocked handoff", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const reviewerRuntime = new StaticRuntime({
      state: "completed",
      findings: [
        {
          severity: "blocking",
          target: "section:hero",
          explanation: "Hero section is missing a CTA secret-token",
          suggestedFix: "Add a primary CTA.",
          blocksDeployment: true
        }
      ]
    });
    const deployerRuntime = new RecordingRuntime({ state: "completed" });
    const service = new DemoWorkbenchService({
      repositories,
      reviewerRuntime,
      deployerRuntime,
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

    const reviewed = await service.reviewPageVersion({
      projectId: project.id,
      pageVersionId: pageVersion.id
    });

    expect(reviewed.reviewStatus).toBe("failed");
    const handoffs = await repositories.agentHandoffs.listInbound({
      projectId: project.id,
      toRole: "deployer"
    });
    expect(handoffs).toEqual([
      expect.objectContaining({
        state: "blocked",
        blockingReason: expect.stringContaining("[REDACTED]")
      })
    ]);
    expect(JSON.stringify(handoffs)).not.toContain("secret-token");

    await expect(
      service.approveAndCreateDeployment({
        projectId: project.id,
        pageVersionId: pageVersion.id,
        reviewerUserId: "reviewer_1"
      })
    ).rejects.toThrow("agent_handoff_blocked");
    expect(deployerRuntime.requests).toEqual([]);
  });

  it("allows deployment after a blocked review is followed by a passing re-review", async () => {
    const blockingFinding: ReviewFinding = {
      severity: "blocking",
      target: "section:hero",
      explanation: "Hero section is missing a CTA.",
      suggestedFix: "Add a primary CTA.",
      blocksDeployment: true
    };
    const reviewerRuntime = new MutableRuntime({
      state: "completed",
      findings: [blockingFinding]
    });
    const service = new DemoWorkbenchService({
      reviewerRuntime,
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
    await expect(
      service.approveAndCreateDeployment({
        projectId: project.id,
        pageVersionId: pageVersion.id,
        reviewerUserId: "reviewer_1"
      })
    ).rejects.toThrow("agent_handoff_blocked");

    reviewerRuntime.result = {
      state: "completed",
      findings: []
    };
    await service.reviewPageVersion({
      projectId: project.id,
      pageVersionId: pageVersion.id
    });

    await expect(
      service.approveAndCreateDeployment({
        projectId: project.id,
        pageVersionId: pageVersion.id,
        reviewerUserId: "reviewer_1"
      })
    ).resolves.toMatchObject({
      pageVersionId: pageVersion.id,
      status: "pr_opened"
    });

    await expect(
      service.approveAndCreateDeployment({
        projectId: project.id,
        pageVersionId: pageVersion.id,
        reviewerUserId: "reviewer_1"
      })
    ).resolves.toMatchObject({
      pageVersionId: pageVersion.id,
      status: "pr_opened"
    });
  });

  it("rejects deployment approval with a blank reviewer user id", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
    const reviewedPageVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });
    await service.reviewPageVersion({
      projectId: project.id,
      pageVersionId: reviewedPageVersion.id
    });

    await expect(
      service.approveAndCreateDeployment({
        projectId: project.id,
        pageVersionId: reviewedPageVersion.id,
        reviewerUserId: "   "
      })
    ).rejects.toThrow("Reviewer user ID is required.");
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

  it("executes an approved deployment skill command with artifact workspace", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const runnerResult: ToolCommandRunResult = {
      state: "completed",
      exitCode: 0,
      stdout: "",
      stderr: ""
    };
    const runner = new RecordingToolCommandRunner(runnerResult);
    const service = new DemoWorkbenchService({
      repositories,
      toolCommandRunner: runner,
      env: { STATIC_DEPLOY_TOKEN: "secret-token" },
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
    const artifactFragment = pageVersion.artifacts.stylesCss.slice(0, 7);
    runnerResult.stdout = `published secret-token ${artifactFragment}`;
    const skill = await service.createSkillDraft({
      manifestJson: JSON.stringify(deploymentSkillManifest()),
      content: "# Static deploy",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: skill.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: skill.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });

    const result = await service.executeProjectSkillCommand({
      projectId: project.id,
      skillVersionId: published.id,
      commandId: "publish_static",
      pageVersionId: pageVersion.id,
      approvedByUserId: "user_1"
    });
    const events = await repositories.runEvents.listForRun(result.run.id);
    const serializedEvents = JSON.stringify(events);
    const serializedObservation = JSON.stringify(result.observation);
    const completedToolEvent = events.find((event) => event.type === "tool.completed");
    const completedRunEvent = events.find((event) => event.type === "run.completed");

    expect(result.run).toMatchObject({
      id: "run_skill_command_1",
      role: "deployer",
      state: "completed"
    });
    expect(result.observation).toMatchObject({
      id: "tool_observation_1",
      runId: result.run.id,
      projectId: project.id,
      toolName: "skill:skill_static_deploy:publish_static",
      state: "completed",
      exitCode: 0
    });
    expect(runner.inputs).toHaveLength(1);
    expect(runner.inputs[0]).toMatchObject({
      runId: "run_skill_command_1",
      projectId: project.id,
      skillId: "skill_static_deploy",
      skillVersionId: published.id,
      commandId: "publish_static",
      command: "static-deploy",
      env: {
        STATIC_DEPLOY_TOKEN: "secret-token",
        LP_PROJECT_ID: project.id
      },
      timeoutMs: 120000
    });
    expect(runner.inputs[0]?.args).toEqual([
      "--project",
      project.id,
      "--html",
      expect.stringMatching(/index\.html$/)
    ]);
    expect(runner.inputs[0]?.workingDirectory).toEqual(expect.stringMatching(/artifacts$/));
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.completed",
      "run.completed"
    ]);
    expect(result.observation.outputSummary).toBe("stdout: 30 chars\nstderr: 0 chars");
    expect(completedToolEvent?.payload).toMatchObject({
      pageVersionId: pageVersion.id,
      outputSummary: result.observation.outputSummary
    });
    expect(completedRunEvent?.payload).toMatchObject({
      pageVersionId: pageVersion.id,
      outputSummary: result.observation.outputSummary
    });
    expect(serializedEvents).toContain("stdout: 30 chars");
    expect(serializedEvents).toContain("stderr: 0 chars");
    expect(serializedEvents).not.toContain("published secret-token");
    expect(serializedEvents).not.toContain(artifactFragment);
    expect(serializedEvents).not.toContain("secret-token");
    expect(serializedObservation).not.toContain("secret-token");
    expect(serializedObservation).not.toContain(artifactFragment);
  });

  it("executes a deployment skill command through an explicit worker-backed runner", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const workerRuntime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter(),
      now: fixedClock()
    });
    const runner = new WorkerBackedToolCommandRunner(workerRuntime, (input) =>
      createSandboxPolicyForToolCommand(input, {
        mode: "simulate",
        allowedCommands: [input.command],
        allowedEnvNames: Object.keys(input.env),
        maxStdoutBytes: 300,
        maxStderrBytes: 300
      })
    );
    const service = new DemoWorkbenchService({
      repositories,
      toolCommandRunner: runner,
      env: { STATIC_DEPLOY_TOKEN: "secret-token" },
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const skill = await service.createSkillDraft({
      manifestJson: JSON.stringify(
        deploymentSkillManifest({ commands: [commandWithoutArtifacts()] })
      ),
      content: "# Static deploy",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: skill.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: skill.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });

    const result = await service.executeProjectSkillCommand({
      projectId: project.id,
      skillVersionId: published.id,
      commandId: "publish_static",
      approvedByUserId: "user_1"
    });
    const expectedStdout = "Simulated static-deploy for project [redacted].";
    const jobs = await workerRuntime.listJobsForProject(project.id);
    const serialized = JSON.stringify({ run: result.run, observation: result.observation, jobs });

    expect(result.run.state).toBe("completed");
    expect(result.observation.outputSummary).toBe(
      `stdout: ${expectedStdout.length} chars\nstderr: 0 chars`
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      state: "completed",
      inputSummary: {
        command: "static-deploy",
        envNames: ["LP_PROJECT_ID", "STATIC_DEPLOY_TOKEN"]
      }
    });
    expect(serialized).not.toContain("secret-token");
  });

  it("persists failed deployment skill command results", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const failedStdout = "publish failed with secret-token stdout";
    const failedStderr = "deploy denied secret-token stderr";
    const failedOutputSummary = `stdout: ${failedStdout.length} chars\nstderr: ${failedStderr.length} chars`;
    const runner = new RecordingToolCommandRunner({
      state: "failed",
      exitCode: 2,
      stdout: failedStdout,
      stderr: failedStderr,
      errorName: "deploy_failed"
    });
    const service = new DemoWorkbenchService({
      repositories,
      toolCommandRunner: runner,
      env: { STATIC_DEPLOY_TOKEN: "secret-token" },
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const skill = await service.createSkillDraft({
      manifestJson: JSON.stringify(
        deploymentSkillManifest({ commands: [commandWithoutArtifacts()] })
      ),
      content: "# Static deploy",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: skill.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: skill.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });

    const result = await service.executeProjectSkillCommand({
      projectId: project.id,
      skillVersionId: published.id,
      commandId: "publish_static",
      approvedByUserId: "user_1"
    });
    const events = await repositories.runEvents.listForRun(result.run.id);
    const serializedEvents = JSON.stringify(events);
    const serializedObservation = JSON.stringify(result.observation);
    const failedToolEvent = events.find((event) => event.type === "tool.failed");
    const failedRunEvent = events.find((event) => event.type === "run.failed");

    expect(result.run.state).toBe("failed");
    expect(result.observation).toMatchObject({
      state: "failed",
      exitCode: 2,
      errorName: "deploy_failed",
      outputSummary: failedOutputSummary
    });
    expect(failedToolEvent?.payload).toMatchObject({
      outputSummary: result.observation.outputSummary,
      errorName: "deploy_failed"
    });
    expect(failedRunEvent?.payload).toMatchObject({
      outputSummary: result.observation.outputSummary,
      errorName: "deploy_failed"
    });
    expect(serializedEvents).toContain(`stdout: ${failedStdout.length} chars`);
    expect(serializedEvents).toContain(`stderr: ${failedStderr.length} chars`);
    expect(serializedEvents).not.toContain(failedStdout);
    expect(serializedEvents).not.toContain(failedStderr);
    expect(serializedEvents).not.toContain("secret-token");
    expect(serializedObservation).toContain(`stdout: ${failedStdout.length} chars`);
    expect(serializedObservation).toContain(`stderr: ${failedStderr.length} chars`);
    expect(serializedObservation).not.toContain(failedStdout);
    expect(serializedObservation).not.toContain(failedStderr);
    expect(serializedObservation).not.toContain("secret-token");
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.failed",
      "run.failed"
    ]);
  });

  it("persists cancelled deployment skill command results as failed service runs", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const runner = new RecordingToolCommandRunner({
      state: "cancelled",
      exitCode: undefined,
      stdout: "",
      stderr: "Worker job cancelled.",
      errorName: "worker_job_cancelled"
    });
    const service = new DemoWorkbenchService({
      repositories,
      toolCommandRunner: runner,
      env: { STATIC_DEPLOY_TOKEN: "secret-token" },
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const skill = await service.createSkillDraft({
      manifestJson: JSON.stringify(
        deploymentSkillManifest({ commands: [commandWithoutArtifacts()] })
      ),
      content: "# Static deploy",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: skill.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: skill.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });

    const result = await service.executeProjectSkillCommand({
      projectId: project.id,
      skillVersionId: published.id,
      commandId: "publish_static",
      approvedByUserId: "user_1"
    });
    const events = await repositories.runEvents.listForRun(result.run.id);

    expect(result.run.state).toBe("failed");
    expect(result.observation).toMatchObject({
      state: "failed",
      errorName: "worker_job_cancelled",
      outputSummary: "stdout: 0 chars\nstderr: 21 chars"
    });
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.failed",
      "run.failed"
    ]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool.failed",
          payload: expect.objectContaining({
            errorName: "worker_job_cancelled",
            outputSummary: "stdout: 0 chars\nstderr: 21 chars"
          })
        }),
        expect.objectContaining({
          type: "run.failed",
          payload: expect.objectContaining({
            errorName: "worker_job_cancelled",
            outputSummary: "stdout: 0 chars\nstderr: 21 chars"
          })
        })
      ])
    );
  });

  it("persists failed deployment skill command observations when runner throws", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    let artifactFragment = "";
    const service = new DemoWorkbenchService({
      repositories,
      toolCommandRunner: new ThrowingToolCommandRunner(() => {
        const error = new Error(`runner failed with secret-token ${artifactFragment}`);
        error.name = `unsafe secret-token ${artifactFragment}`;
        return error;
      }),
      env: { STATIC_DEPLOY_TOKEN: "secret-token" },
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
    artifactFragment = pageVersion.artifacts.stylesCss.slice(0, 7);
    const skill = await service.createSkillDraft({
      manifestJson: JSON.stringify(deploymentSkillManifest()),
      content: "# Static deploy",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: skill.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: skill.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });

    const result = await service.executeProjectSkillCommand({
      projectId: project.id,
      skillVersionId: published.id,
      commandId: "publish_static",
      pageVersionId: pageVersion.id,
      approvedByUserId: "user_1"
    });
    const events = await repositories.runEvents.listForRun(result.run.id);
    const observations = await repositories.toolObservations.listForRun(result.run.id);
    const serializedRecords = JSON.stringify({ events, observation: result.observation });

    expect(result.run.state).toBe("failed");
    expect(result.observation).toMatchObject({
      state: "failed",
      errorName: "skill_command_runner_error"
    });
    expect(observations).toEqual([
      expect.objectContaining({
        id: result.observation.id,
        state: "failed",
        errorName: "skill_command_runner_error"
      })
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.failed",
      "run.failed"
    ]);
    expect(serializedRecords).not.toContain("secret-token");
    expect(serializedRecords).not.toContain(artifactFragment);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool.failed",
          payload: expect.objectContaining({
            errorName: "skill_command_runner_error"
          })
        }),
        expect.objectContaining({
          type: "run.failed",
          payload: expect.objectContaining({
            errorName: "skill_command_runner_error"
          })
        })
      ])
    );
  });

  it("rejects deployment skill command validation failures before invoking runner", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const runner = new RecordingToolCommandRunner({
      state: "completed",
      exitCode: 0,
      stdout: "",
      stderr: ""
    });
    const service = new DemoWorkbenchService({
      repositories,
      toolCommandRunner: runner,
      env: { STATIC_DEPLOY_TOKEN: "secret-token" },
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const skill = await service.createSkillDraft({
      manifestJson: JSON.stringify(deploymentSkillManifest()),
      content: "# Static deploy",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: skill.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: skill.version.id });

    await expect(
      service.executeProjectSkillCommand({
        projectId: project.id,
        skillVersionId: published.id,
        commandId: "publish_static",
        approvedByUserId: "user_1"
      })
    ).rejects.toThrow("skill_command_not_bound");

    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });
    await expect(
      service.executeProjectSkillCommand({
        projectId: project.id,
        skillVersionId: published.id,
        commandId: "missing",
        approvedByUserId: "user_1"
      })
    ).rejects.toThrow("skill_command_not_found");
    await expect(
      service.executeProjectSkillCommand({
        projectId: project.id,
        skillVersionId: published.id,
        commandId: "publish_static",
        approvedByUserId: " "
      })
    ).rejects.toThrow("skill_command_approval_required");

    expect(runner.inputs).toEqual([]);
  });

  it("rejects command execution for non-deployment skills", async () => {
    const runner = new RecordingToolCommandRunner({
      state: "completed",
      exitCode: 0,
      stdout: "ok",
      stderr: ""
    });
    const service = new DemoWorkbenchService({
      toolCommandRunner: runner,
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const draft = await service.createSkillDraft({
      manifestJson: JSON.stringify(
        brandSkillManifest({
          commands: [commandWithoutArtifacts()]
        })
      ),
      content: "# Template skill",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: draft.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });

    await expect(
      service.executeProjectSkillCommand({
        projectId: project.id,
        skillVersionId: published.id,
        commandId: "publish_static",
        approvedByUserId: "user_1"
      })
    ).rejects.toThrow("skill_command_not_deployment");
    expect(runner.inputs).toEqual([]);
  });

  it("rejects command execution for unpublished deployment skills", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const runner = new RecordingToolCommandRunner({
      state: "completed",
      exitCode: 0,
      stdout: "ok",
      stderr: ""
    });
    const service = new DemoWorkbenchService({
      repositories,
      toolCommandRunner: runner,
      env: { STATIC_DEPLOY_TOKEN: "secret-token" },
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const draft = await service.createSkillDraft({
      manifestJson: JSON.stringify(deploymentSkillManifest()),
      content: "# Static deployment",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: draft.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });
    await repositories.skillVersions.save({
      ...published,
      reviewState: "validated",
      manifest: {
        ...published.manifest,
        reviewState: "validated"
      }
    });

    await expect(
      service.executeProjectSkillCommand({
        projectId: project.id,
        skillVersionId: published.id,
        commandId: "publish_static",
        approvedByUserId: "user_1"
      })
    ).rejects.toThrow("skill_command_not_published");
    expect(runner.inputs).toEqual([]);
  });

  it("rejects command execution when the page version belongs to another project", async () => {
    const runner = new RecordingToolCommandRunner({
      state: "completed",
      exitCode: 0,
      stdout: "ok",
      stderr: ""
    });
    const service = new DemoWorkbenchService({
      toolCommandRunner: runner,
      env: { STATIC_DEPLOY_TOKEN: "secret-token" },
      now: fixedClock()
    });
    const firstProject = await service.createProject({ name: "First" });
    const secondProject = await service.createProject({ name: "Second" });
    const brief = await service.createBriefFromPrompt({
      projectId: secondProject.id,
      prompt: "Prompt"
    });
    const secondProjectVersion = await service.generatePageVersion({
      projectId: secondProject.id,
      briefId: brief.id
    });
    const draft = await service.createSkillDraft({
      manifestJson: JSON.stringify(deploymentSkillManifest()),
      content: "# Static deployment",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: draft.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });
    await service.bindSkillVersionToProject({
      projectId: firstProject.id,
      skillVersionId: published.id
    });

    await expect(
      service.executeProjectSkillCommand({
        projectId: firstProject.id,
        skillVersionId: published.id,
        commandId: "publish_static",
        pageVersionId: secondProjectVersion.id,
        approvedByUserId: "user_1"
      })
    ).rejects.toThrow("skill_command_page_version_not_found");
    expect(runner.inputs).toEqual([]);
  });

  it("rejects deployment skill command permission, secret, and template failures before invoking runner", async () => {
    const runner = new RecordingToolCommandRunner({
      state: "completed",
      exitCode: 0,
      stdout: "",
      stderr: ""
    });

    await expectDeploymentCommandFailure({
      runner,
      manifest: deploymentSkillManifest({ permissions: ["artifact:read"] }),
      expectedError: "skill_command_permission_denied"
    });
    await expectDeploymentCommandFailure({
      runner,
      manifest: deploymentSkillManifest({ requiredSecrets: [] }),
      expectedError: "skill_command_secret_not_declared"
    });
    await expectDeploymentCommandFailure({
      runner,
      manifest: deploymentSkillManifest({
        commands: [{ ...commandWithoutArtifacts(), args: ["{{unknown}}"] }]
      }),
      expectedError: "skill_command_unknown_template_variable"
    });

    expect(runner.inputs).toEqual([]);
  });

  it("rejects malformed artifact templates before invoking runner", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const runner = new RecordingToolCommandRunner({
      state: "completed",
      exitCode: 0,
      stdout: "",
      stderr: ""
    });
    const service = new DemoWorkbenchService({
      repositories,
      toolCommandRunner: runner,
      env: { STATIC_DEPLOY_TOKEN: "secret-token" },
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
    const existingRuns = await repositories.runs.listForProject(project.id);
    const skill = await service.createSkillDraft({
      manifestJson: JSON.stringify(
        deploymentSkillManifest({
          commands: [{ ...commandWithoutArtifacts(), args: ["{{artifact-path}}"] }]
        })
      ),
      content: "# Static deploy",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: skill.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: skill.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });

    await expect(
      service.executeProjectSkillCommand({
        projectId: project.id,
        skillVersionId: published.id,
        commandId: "publish_static",
        pageVersionId: pageVersion.id,
        approvedByUserId: "user_1"
      })
    ).rejects.toThrow("skill_command_unknown_template_variable");

    expect(runner.inputs).toEqual([]);
    await expect(repositories.runs.listForProject(project.id)).resolves.toEqual(existingRuns);
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
    const modelBrief = {
      ...sampleBrief,
      title: "Model Planned Landing Page",
      objective: "Convert real model output into a validated LP brief.",
      sections: sampleBrief.sections.map((section, index) => ({
        ...section,
        id: `model_section_${index + 1}`
      }))
    };
    const fetchCalls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fakeFetch: ModelFetch = async (input, init) => {
      fetchCalls.push({ input, init });
      return new Response(
        JSON.stringify({
          type: "message",
          model: "glm-5.1",
          content: [{ type: "text", text: JSON.stringify(modelBrief) }],
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
    expect(brief.brief.title).toBe("Model Planned Landing Page");
    expect(brief.brief.sections[0]?.id).toBe("model_section_1");
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
    const requestBody = JSON.parse(String(fetchCalls[0]?.init?.body));
    expect(requestBody).toMatchObject({
      model: "glm-5.1",
      max_tokens: 1024
    });
    expect(requestBody.messages).toHaveLength(1);
    expect(requestBody.messages[0]).toMatchObject({ role: "user" });
    expect(requestBody.messages[0].content).toContain("Return exactly one JSON object");
    expect(requestBody.messages[0].content).toContain("LPBriefSchema");
    expect(requestBody.messages[0].content).toContain("Generate a landing page brief.");

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
    expect(events.find((event) => event.type === "model.output.parsed")).toMatchObject({
      runId: "run_planner_brief_1",
      type: "model.output.parsed",
      message: "Planner output parsed as LP brief",
      payload: expect.objectContaining({
        role: "planner",
        schema: "LPBriefSchema",
        title: "Model Planned Landing Page",
        sectionCount: sampleBrief.sections.length,
        productCount: sampleBrief.productData.length,
        hasAssets: false
      })
    });
    expect(events.some((event) => event.type === "run.completed")).toBe(true);
    expect(JSON.stringify(events)).not.toContain(JSON.stringify(modelBrief));
    expect(JSON.stringify(events)).not.toContain("sk-test-secret");
    expect(JSON.stringify(events)).not.toContain("ANTHROPIC_API_KEY");
    expect(JSON.stringify(events)).not.toContain("https://open.bigmodel.cn");
  });

  it("uses OpenAI-compatible provider-backed runtime when REAL_MODEL_RUNTIME is enabled", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const modelBrief = {
      ...sampleBrief,
      title: "Model Planned Landing Page",
      objective: "Convert real model output into a validated LP brief.",
      sections: sampleBrief.sections.map((section, index) => ({
        ...section,
        id: `model_section_${index + 1}`
      }))
    };
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
              message: { role: "assistant", content: JSON.stringify(modelBrief) },
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
    expect(brief.brief.title).toBe("Model Planned Landing Page");
    expect(brief.brief.sections[0]?.id).toBe("model_section_1");
    expect(fetchCalls).toHaveLength(1);
    expect(String(fetchCalls[0]?.input)).toBe(
      "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    );
    expect(fetchCalls[0]?.init?.method).toBe("POST");
    expect(fetchCalls[0]?.init?.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer sk-test-secret"
    });
    const requestBody = JSON.parse(String(fetchCalls[0]?.init?.body));
    expect(requestBody.model).toBe("glm-5.1");
    expect(requestBody.stream).toBe(false);
    expect(requestBody.messages).toHaveLength(1);
    expect(requestBody.messages[0]).toMatchObject({ role: "user" });
    expect(requestBody.messages[0].content).toContain("Return exactly one JSON object");
    expect(requestBody.messages[0].content).toContain("LPBriefSchema");
    expect(requestBody.messages[0].content).toContain("Generate a landing page brief.");

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
    expect(events.find((event) => event.type === "model.output.parsed")).toMatchObject({
      runId: "run_planner_brief_1",
      type: "model.output.parsed",
      message: "Planner output parsed as LP brief",
      payload: expect.objectContaining({
        role: "planner",
        schema: "LPBriefSchema",
        title: "Model Planned Landing Page",
        sectionCount: sampleBrief.sections.length,
        productCount: sampleBrief.productData.length,
        hasAssets: false
      })
    });
    expect(events.some((event) => event.type === "run.completed")).toBe(true);
    expect(JSON.stringify(events)).not.toContain(JSON.stringify(modelBrief));
    expect(JSON.stringify(events)).not.toContain("sk-test-secret");
    expect(JSON.stringify(events)).not.toContain("OPENAI_COMPATIBLE_API_KEY");
    expect(JSON.stringify(events)).not.toContain("https://open.bigmodel.cn");
  });

  it("fails planner run without saving raw model output when structured LP brief parsing fails", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const fakeFetch: ModelFetch = async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl_test",
          model: "glm-5.1",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "```json\n{\"title\":\"RAW_MODEL_OUTPUT_SECRET\"}\n```"
              },
              finish_reason: "stop"
            }
          ],
          usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
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

    await expect(
      service.createBriefFromPrompt({
        projectId: project.id,
        prompt: "Generate a landing page brief."
      })
    ).rejects.toThrow("Planner run failed.");

    await expect(repositories.briefs.listAll()).resolves.toEqual([]);
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
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "runtime.context.loaded",
      "model.completed",
      "model.output.parse_failed",
      "run.failed"
    ]);
    expect(events.find((event) => event.type === "model.output.parse_failed")).toMatchObject({
      runId: "run_planner_brief_1",
      type: "model.output.parse_failed",
      message: "Planner output could not be parsed as LP brief",
      payload: expect.objectContaining({
        role: "planner",
        schema: "LPBriefSchema",
        reason: "invalid_json"
      })
    });
    const serializedEvents = JSON.stringify(events);
    expect(serializedEvents).not.toContain("RAW_MODEL_OUTPUT_SECRET");
    expect(serializedEvents).not.toContain("```json");
    expect(serializedEvents).not.toContain("OPENAI_COMPATIBLE_API_KEY");
    expect(serializedEvents).not.toContain("https://open.bigmodel.cn");
  });

  it("uses parsed real Builder artifacts when REAL_MODEL_RUNTIME is enabled", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const modelBrief = {
      ...sampleBrief,
      title: "Model Planned Landing Page",
      sections: sampleBrief.sections.map((section, index) => ({
        ...section,
        id: `model_section_${index + 1}`
      }))
    };
    const modelArtifacts = completeModelArtifacts();
    const responseQueue = [
      JSON.stringify({
        id: "chatcmpl_planner",
        model: "glm-5.1",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify(modelBrief) },
            finish_reason: "stop"
          }
        ],
        usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 }
      }),
      JSON.stringify({
        id: "chatcmpl_builder",
        model: "glm-5.1",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify(modelArtifacts) },
            finish_reason: "stop"
          }
        ],
        usage: { prompt_tokens: 20, completion_tokens: 80, total_tokens: 100 }
      })
    ];
    const fetchCalls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fakeFetch: ModelFetch = async (input, init) => {
      fetchCalls.push({ input, init });
      const body = responseQueue.shift();
      if (!body) {
        throw new Error("unexpected_fetch_call");
      }
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" }
      });
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
    await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "builder",
      providerId: provider.id,
      model: "glm-5.1"
    });

    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Generate a landing page brief."
    });
    const pageVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });

    expect(fetchCalls).toHaveLength(2);
    expect(pageVersion.artifacts).toEqual(modelArtifacts);
    expect(pageVersion.artifacts.indexHtml).toContain("MODEL_BUILDER_ARTIFACT_SECRET");
    expect(pageVersion.artifacts.indexHtml).not.toContain("Spring essentials, ready today");

    const builderRequestBody = JSON.parse(String(fetchCalls[1]?.init?.body));
    expect(builderRequestBody.model).toBe("glm-5.1");
    expect(builderRequestBody.messages).toHaveLength(1);
    expect(builderRequestBody.messages[0]).toMatchObject({ role: "user" });
    expect(builderRequestBody.messages[0].content).toContain("Return exactly one JSON object");
    expect(builderRequestBody.messages[0].content).toContain("indexHtml");
    expect(builderRequestBody.messages[0].content).toContain("stylesCss");
    expect(builderRequestBody.messages[0].content).toContain("scriptJs");
    expect(builderRequestBody.messages[0].content).toContain("Do not include React, Vue, Angular, Svelte");
    expect(builderRequestBody.messages[0].content).toContain("Model Planned Landing Page");

    const builderEvents = await repositories.runEvents.listForRun("run_builder_version_1");
    expect(builderEvents.map((event) => event.type)).toEqual([
      "handoff.consumed",
      "run.started",
      "runtime.context.loaded",
      "model.completed",
      "artifact.created",
      "model.output.parsed",
      "run.completed",
      "artifact.workspace.created",
      "handoff.created"
    ]);
    expect(builderEvents.find((event) => event.type === "model.output.parsed")).toMatchObject({
      runId: "run_builder_version_1",
      type: "model.output.parsed",
      message: "Builder output parsed as static artifacts",
      payload: expect.objectContaining({
        role: "builder",
        schema: "StaticArtifactsSchema",
        artifactKind: "three-file-static",
        hasExternalCss: true,
        hasExternalImages: true
      })
    });
    const serializedBuilderEvents = JSON.stringify(builderEvents);
    expect(serializedBuilderEvents).not.toContain("MODEL_BUILDER_ARTIFACT_SECRET");
    expect(serializedBuilderEvents).not.toContain(modelArtifacts.stylesCss);
    expect(serializedBuilderEvents).not.toContain(modelArtifacts.scriptJs);
    expect(serializedBuilderEvents).not.toContain("sk-test-secret");
    expect(serializedBuilderEvents).not.toContain("OPENAI_COMPATIBLE_API_KEY");
    expect(serializedBuilderEvents).not.toContain("https://open.bigmodel.cn");
  });

  it("fails closed when real Builder output violates static artifact policy", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const modelBrief = {
      ...sampleBrief,
      title: "Model Planned Landing Page"
    };
    const responseQueue = [
      JSON.stringify({
        id: "chatcmpl_planner",
        model: "glm-5.1",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify(modelBrief) },
            finish_reason: "stop"
          }
        ],
        usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 }
      }),
      JSON.stringify({
        id: "chatcmpl_builder",
        model: "glm-5.1",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({
                ...completeModelArtifacts(),
                indexHtml: completeModelArtifacts().indexHtml.replace(
                  '  <script src="script.js"></script>',
                  '  <script src="https://cdn.example.com/RAW_STATIC_ARTIFACT_SECRET.js"></script>\n  <script src="script.js"></script>'
                )
              })
            },
            finish_reason: "stop"
          }
        ],
        usage: { prompt_tokens: 20, completion_tokens: 80, total_tokens: 100 }
      })
    ];
    const fakeFetch: ModelFetch = async () => {
      const body = responseQueue.shift();
      if (!body) {
        throw new Error("unexpected_fetch_call");
      }
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" }
      });
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
    await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "builder",
      providerId: provider.id,
      model: "glm-5.1"
    });

    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Generate a landing page brief."
    });
    await expect(
      service.generatePageVersion({
        projectId: project.id,
        briefId: brief.id
      })
    ).rejects.toThrow("Builder run failed.");

    await expect(repositories.pageVersions.listAll()).resolves.toEqual([]);
    await expect(repositories.artifactWorkspaces.listAll()).resolves.toEqual([]);
    await expect(repositories.artifactWorkspaceFiles.listAll()).resolves.toEqual([]);
    await expect(repositories.runs.listForProject(project.id)).resolves.toEqual([
      expect.objectContaining({ id: "run_planner_brief_1", state: "completed" }),
      expect.objectContaining({
        id: "run_builder_version_1",
        projectId: project.id,
        role: "builder",
        state: "failed",
        completedAt: expect.any(String)
      })
    ]);
    const builderEvents = await repositories.runEvents.listForRun("run_builder_version_1");
    expect(builderEvents.map((event) => event.type)).toEqual([
      "handoff.consumed",
      "run.started",
      "runtime.context.loaded",
      "model.completed",
      "model.output.parse_failed",
      "run.failed"
    ]);
    expect(builderEvents.find((event) => event.type === "model.output.parse_failed")).toMatchObject({
      runId: "run_builder_version_1",
      type: "model.output.parse_failed",
      message: "Builder output could not be parsed as static artifacts",
      payload: expect.objectContaining({
        role: "builder",
        schema: "StaticArtifactsSchema",
        reason: "policy_violation",
        policyCode: "external_script_blocked"
      })
    });
    const serializedBuilderEvents = JSON.stringify(builderEvents);
    expect(serializedBuilderEvents).not.toContain("RAW_STATIC_ARTIFACT_SECRET");
    expect(serializedBuilderEvents).not.toContain("MODEL_BUILDER_ARTIFACT_SECRET");
    expect(serializedBuilderEvents).not.toContain("sk-test-secret");
    expect(serializedBuilderEvents).not.toContain("OPENAI_COMPATIBLE_API_KEY");
    expect(serializedBuilderEvents).not.toContain("https://open.bigmodel.cn");
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

  it("resolves safe model fallback metadata without exposing provider secrets", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const primary = await service.createModelProvider({
      projectId: project.id,
      providerId: "provider_primary",
      name: "Primary",
      provider: "openai",
      secretEnvName: "PRIMARY_API_KEY",
      modelId: "gpt-5.4"
    });
    const fallback = await service.createModelProvider({
      projectId: project.id,
      providerId: "provider_backup",
      name: "Backup",
      provider: "openai",
      secretEnvName: "BACKUP_API_KEY",
      modelId: "gpt-5.4-mini"
    });
    await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "planner",
      providerId: primary.id,
      model: "gpt-5.4"
    });
    const [route] = await repositories.modelRoutingPolicies.listForProject(project.id);
    await repositories.modelRoutingPolicies.save({
      ...route!,
      fallback: {
        providerId: fallback.id,
        model: "gpt-5.4-mini"
      }
    });

    const policy = await service.resolveModelRoutingPolicyForProject(project.id);

    expect(policy.planner.fallback).toEqual({
      provider: "provider_backup",
      providerName: "Backup",
      api: "openai-completions",
      model: "gpt-5.4-mini",
      baseUrlConfigured: false,
      apiKeyEnvConfigured: true
    });
    expect(JSON.stringify(policy)).not.toContain("BACKUP_API_KEY");
    expect(JSON.stringify(policy)).not.toContain("PRIMARY_API_KEY");
  });

  it("omits invalid model fallback metadata without breaking the primary route", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const primary = await service.createModelProvider({
      projectId: project.id,
      providerId: "provider_primary",
      name: "Primary",
      provider: "openai",
      secretEnvName: "PRIMARY_API_KEY",
      modelId: "gpt-5.4"
    });
    await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "planner",
      providerId: primary.id,
      model: "gpt-5.4"
    });
    const [route] = await repositories.modelRoutingPolicies.listForProject(project.id);
    await repositories.modelRoutingPolicies.save({
      ...route!,
      fallback: {
        providerId: "missing_provider",
        model: "gpt-5.4-mini"
      }
    });

    const policy = await service.resolveModelRoutingPolicyForProject(project.id);

    expect(policy.planner.provider).toBe("provider_primary");
    expect(policy.planner.fallback).toBeUndefined();
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
    const prompt = "Create a sale LP";
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
        prompt,
        brief: sampleBrief
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
          "modelProvider:builder:legacy",
          "memory:messages:0",
          "memory:runs:0",
          "memory:tools:0",
          "memory:artifacts:0",
          "memory:strategy:deterministic-keyword-v0"
        ]),
        omitted: expect.arrayContaining([
          "memory:messages:none",
          "memory:runs:none",
          "memory:tools:none",
          "memory:artifacts:none"
        ])
      }
    });
  });

  it("injects durable artifact workspace metadata into context packs", async () => {
    const artifacts: StaticArtifacts = {
      indexHtml:
        "<!doctype html><html><body>RUNTIME_WORKSPACE_HTML_SECRET</body></html>",
      stylesCss: "body::before { content: 'RUNTIME_WORKSPACE_CSS_SECRET'; }",
      scriptJs: "console.log('RUNTIME_WORKSPACE_JS_SECRET');"
    };
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
      builderRuntime: new StaticRuntime({ state: "completed", artifacts }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a static LP"
    });
    const pageVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });
    const workspaceFiles = await repositories.artifactWorkspaceFiles.listForWorkspace(
      pageVersion.artifactWorkspaceId ?? ""
    );

    const contextPack = await assembleContextPack({
      repositories,
      service,
      projectId: project.id,
      role: "builder",
      taskId: "task_1",
      input: {
        prompt: "Create a sale LP",
        brief: sampleBrief
      },
      now: fixedClock()
    });
    const parsedContextPack = ContextPackSchema.parse(contextPack);

    expect(parsedContextPack.runtimeContext.artifactWorkspace).toEqual({
      mode: "memory",
      workspaceId: pageVersion.artifactWorkspaceId,
      writableFiles: ["index.html", "styles.css", "script.js"],
      files: workspaceFiles.map((file) => ({
        path: file.path,
        kind: file.kind,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        summary: file.summary
      }))
    });
    expect(JSON.stringify(parsedContextPack.runtimeContext.artifactWorkspace)).not.toContain(
      "RUNTIME_WORKSPACE_HTML_SECRET"
    );
    expect(JSON.stringify(parsedContextPack.runtimeContext.artifactWorkspace)).not.toContain(
      "RUNTIME_WORKSPACE_CSS_SECRET"
    );
    expect(JSON.stringify(parsedContextPack.runtimeContext.artifactWorkspace)).not.toContain(
      "RUNTIME_WORKSPACE_JS_SECRET"
    );
  });

  it("keeps artifact snippets out of context packs by default", async () => {
    const artifacts: StaticArtifacts = {
      indexHtml: "<!doctype html><html><body>SNIPPET_HTML_SECRET</body></html>",
      stylesCss: "body { color: #123456; }",
      scriptJs: "window.lpAgent = true;"
    };
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
      builderRuntime: new StaticRuntime({ state: "completed", artifacts }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a static LP"
    });
    await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });

    const contextPack = await assembleContextPack({
      repositories,
      service,
      projectId: project.id,
      role: "builder",
      input: {
        prompt: "Create a sale LP",
        brief: sampleBrief
      },
      now: fixedClock()
    });
    const parsedContextPack = ContextPackSchema.parse(contextPack);

    expect(parsedContextPack.artifactSnippets).toEqual([]);
    expect(JSON.stringify(parsedContextPack)).not.toContain("SNIPPET_HTML_SECRET");
  });

  it("omits invalid artifact snippet paths without echoing raw input", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const rawPath = "../index.html?token=SNIPPET_PATH_SECRET";

    const contextPack = await assembleContextPack({
      repositories,
      service,
      projectId: project.id,
      role: "builder",
      input: {
        prompt: "Create a sale LP",
        brief: sampleBrief
      },
      artifactSnippetRequests: [
        {
          workspaceId: "artifact_workspace_1",
          path: rawPath as never
        }
      ],
      now: fixedClock()
    });
    const parsedContextPack = ContextPackSchema.parse(contextPack);

    expect(parsedContextPack.artifactSnippets).toEqual([]);
    expect(parsedContextPack.trace.omitted).toContain(
      "artifactSnippet:invalid_path:artifact_workspace_file_path_not_allowed"
    );
    expect(JSON.stringify(parsedContextPack.trace)).not.toContain(rawPath);
    expect(JSON.stringify(parsedContextPack)).not.toContain("SNIPPET_PATH_SECRET");
  });

  it("injects bounded artifact snippets only when explicitly requested", async () => {
    const artifacts: StaticArtifacts = {
      indexHtml: "<!doctype html><html><body>SNIPPET_HTML_SECRET</body></html>",
      stylesCss: "body { color: #123456; }",
      scriptJs: "window.lpAgent = true;"
    };
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
      builderRuntime: new StaticRuntime({ state: "completed", artifacts }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a static LP"
    });
    const pageVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });

    const contextPack = await assembleContextPack({
      repositories,
      service,
      projectId: project.id,
      role: "builder",
      input: {
        prompt: "Create a sale LP",
        brief: sampleBrief
      },
      artifactSnippetRequests: [
        {
          workspaceId: pageVersion.artifactWorkspaceId ?? "",
          pageVersionId: pageVersion.id,
          path: "styles.css",
          maxBytes: artifacts.stylesCss.length
        },
        {
          workspaceId: pageVersion.artifactWorkspaceId ?? "",
          pageVersionId: pageVersion.id,
          path: "index.html",
          maxBytes: 8
        }
      ],
      now: fixedClock()
    });
    const parsedContextPack = ContextPackSchema.parse(contextPack);

    expect(parsedContextPack.artifactSnippets).toEqual([
      expect.objectContaining({
        workspaceId: pageVersion.artifactWorkspaceId,
        pageVersionId: pageVersion.id,
        path: "styles.css",
        content: artifacts.stylesCss,
        truncated: false
      })
    ]);
    expect(parsedContextPack.artifactSnippets[0]).toMatchObject({
      sizeBytes: artifacts.stylesCss.length,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(parsedContextPack.trace.injected).toContain("artifactSnippets:1");
    expect(parsedContextPack.trace.omitted).toContain(
      "artifactSnippet:index.html:size_limit_exceeded"
    );
    expect(JSON.stringify(parsedContextPack.runtimeContext)).not.toContain(artifacts.stylesCss);
  });

  it("caps requested artifact snippets at the context byte limit", async () => {
    const largeHtmlSecret = "SNIPPET_LARGE_HTML_SECRET";
    const largeHtml = `<!doctype html><html><body>${largeHtmlSecret}${"x".repeat(
      9000
    )}</body></html>`;
    const artifacts: StaticArtifacts = {
      indexHtml: largeHtml,
      stylesCss: "body { color: #123456; }",
      scriptJs: "window.lpAgent = true;"
    };
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
      builderRuntime: new StaticRuntime({ state: "completed", artifacts }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a static LP"
    });
    const pageVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });

    const contextPack = await assembleContextPack({
      repositories,
      service,
      projectId: project.id,
      role: "builder",
      input: {
        prompt: "Create a sale LP",
        brief: sampleBrief
      },
      artifactSnippetRequests: [
        {
          workspaceId: pageVersion.artifactWorkspaceId ?? "",
          pageVersionId: pageVersion.id,
          path: "index.html",
          maxBytes: largeHtml.length
        }
      ],
      now: fixedClock()
    });
    const parsedContextPack = ContextPackSchema.parse(contextPack);

    expect(parsedContextPack.artifactSnippets).toEqual([]);
    expect(parsedContextPack.trace.injected).toContain("artifactSnippets:0");
    expect(parsedContextPack.trace.omitted).toContain(
      "artifactSnippet:index.html:size_limit_exceeded"
    );
    expect(JSON.stringify(parsedContextPack)).not.toContain(largeHtmlSecret);
    expect(JSON.stringify(parsedContextPack)).not.toContain(largeHtml);
  });

  it("does not pass top-level artifact snippets into runtime requests", async () => {
    const artifacts: StaticArtifacts = {
      indexHtml: "<!doctype html><html></html>",
      stylesCss: "body { color: SNIPPET_CSS_SECRET; }",
      scriptJs: "window.lpAgent = true;"
    };
    const repositories = createInMemoryWorkbenchRepositories();
    const runtime = new RecordingRuntime({ state: "completed" });
    const service = new DemoWorkbenchService({
      repositories,
      builderRuntime: new StaticRuntime({ state: "completed", artifacts }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a static LP"
    });
    await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });

    await runAgentStep({
      repositories,
      service,
      runtime,
      runId: "run_no_runtime_snippets",
      projectId: project.id,
      role: "builder",
      input: {
        prompt: "Create a sale LP",
        brief: sampleBrief
      },
      now: fixedClock()
    });

    expect(JSON.stringify(runtime.requests[0]?.context)).not.toContain(artifacts.stylesCss);
  });

  it("binds runtime artifact workspace metadata to the target page version", async () => {
    const reviewerRuntime = new RecordingRuntime({ state: "completed", findings: [] });
    const deployerRuntime = new RecordingRuntime({ state: "completed" });
    const service = new DemoWorkbenchService({
      reviewerRuntime,
      deployerRuntime,
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a static LP"
    });
    const firstVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });
    const secondVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });

    await service.reviewPageVersion({
      projectId: project.id,
      pageVersionId: firstVersion.id
    });
    await service.approveAndCreateDeployment({
      projectId: project.id,
      pageVersionId: firstVersion.id,
      reviewerUserId: "reviewer_1"
    });

    expect(secondVersion.artifactWorkspaceId).not.toBe(firstVersion.artifactWorkspaceId);
    expect(reviewerRuntime.requests[0]?.context?.artifactWorkspace.workspaceId).toBe(
      firstVersion.artifactWorkspaceId
    );
    expect(deployerRuntime.requests[0]?.context?.artifactWorkspace.workspaceId).toBe(
      firstVersion.artifactWorkspaceId
    );
  });

  it("falls back to legacy runtime artifact workspace when the latest workspace is missing", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a static LP"
    });
    await repositories.pageVersions.save({
      id: "version_missing_runtime_workspace",
      projectId: project.id,
      briefId: brief.id,
      artifactWorkspaceId: "missing_runtime_workspace",
      artifacts: completeArtifacts(),
      reviewStatus: "pending",
      findings: [],
      createdAt: "2026-05-11T00:00:01.000Z"
    });

    const context = await service.createRuntimeContextForRole({
      projectId: project.id,
      role: "builder"
    });

    expect(context.artifactWorkspace).toEqual({
      mode: "memory",
      writableFiles: ["index.html", "styles.css", "script.js"]
    });
  });

  it("falls back to legacy runtime artifact workspace when file metadata is corrupt", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a static LP"
    });
    await repositories.pageVersions.save({
      id: "version_corrupt_runtime_workspace",
      projectId: project.id,
      briefId: brief.id,
      artifactWorkspaceId: "artifact_workspace_corrupt_runtime",
      artifacts: completeArtifacts(),
      reviewStatus: "pending",
      findings: [],
      createdAt: "2026-05-11T00:00:01.000Z"
    });
    await repositories.artifactWorkspaces.save({
      id: "artifact_workspace_corrupt_runtime",
      projectId: project.id,
      pageVersionId: "version_corrupt_runtime_workspace",
      kind: "static_lp",
      state: "active",
      createdAt: "2026-05-11T00:00:01.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z"
    });
    const files = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_corrupt_runtime",
      projectId: project.id,
      pageVersionId: "version_corrupt_runtime_workspace",
      artifacts: completeArtifacts(),
      createdAt: "2026-05-11T00:01:00.000Z"
    }).map((file) =>
      file.path === "styles.css" ? { ...file, sha256: "wrong-hash" } : file
    );
    for (const file of files) {
      await repositories.artifactWorkspaceFiles.save(file);
    }

    const context = await service.createRuntimeContextForRole({
      projectId: project.id,
      role: "builder"
    });

    expect(context.artifactWorkspace).toEqual({
      mode: "memory",
      writableFiles: ["index.html", "styles.css", "script.js"]
    });
  });

  it("fails closed when runtime workspace ownership does not match the latest page version", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a static LP"
    });
    await repositories.pageVersions.save({
      id: "version_wrong_runtime_workspace_owner",
      projectId: project.id,
      briefId: brief.id,
      artifactWorkspaceId: "artifact_workspace_wrong_runtime_owner",
      artifacts: completeArtifacts(),
      reviewStatus: "pending",
      findings: [],
      createdAt: "2026-05-11T00:00:01.000Z"
    });
    await repositories.artifactWorkspaces.save({
      id: "artifact_workspace_wrong_runtime_owner",
      projectId: "project_other",
      pageVersionId: "version_other",
      kind: "static_lp",
      state: "active",
      createdAt: "2026-05-11T00:00:01.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z"
    });

    await expect(
      service.createRuntimeContextForRole({
        projectId: project.id,
        role: "builder"
      })
    ).rejects.toThrow(
      "Artifact workspace artifact_workspace_wrong_runtime_owner does not belong to page version version_wrong_runtime_workspace_owner."
    );
  });

  it("injects deterministic context memory into context packs", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    await repositories.tasks.save({
      id: "task_memory_1",
      title: "Spring sale build",
      type: "lp_generation",
      status: "complete",
      projectId: project.id,
      createdAt: "2026-05-10T00:00:00.000Z"
    });
    await repositories.messages.save({
      id: "message_memory_1",
      taskId: "task_memory_1",
      role: "user",
      content: "Spring sale memory: emphasize returning customer bundles.",
      createdAt: "2026-05-10T00:01:00.000Z"
    });
    await repositories.runs.save({
      id: "run_memory_1",
      projectId: project.id,
      taskId: "task_memory_1",
      role: "builder",
      state: "completed",
      startedAt: "2026-05-10T00:02:00.000Z",
      completedAt: "2026-05-10T00:03:00.000Z",
      contextSummary: {
        injected: [],
        omitted: []
      }
    });
    await repositories.runEvents.save({
      id: "event_memory_1",
      runId: "run_memory_1",
      projectId: project.id,
      taskId: "task_memory_1",
      sequence: 1,
      type: "run.completed",
      message: "Builder run completed.",
      payload: {
        state: "completed"
      },
      createdAt: "2026-05-10T00:03:00.000Z"
    });
    await repositories.toolObservations.save({
      id: "observation_memory_1",
      runId: "run_memory_1",
      projectId: project.id,
      taskId: "task_memory_1",
      toolName: "skill:deploy:publish",
      input: {
        rawOutput: "published secret-token"
      },
      outputSummary: "stdout: 22 chars\nstderr: 0 chars",
      state: "completed",
      exitCode: 0,
      createdAt: "2026-05-10T00:02:30.000Z",
      completedAt: "2026-05-10T00:03:00.000Z"
    });

    const contextPack = await assembleContextPack({
      repositories,
      service,
      projectId: project.id,
      role: "builder",
      taskId: "task_memory_1",
      input: {
        prompt: "spring sale"
      },
      now: fixedClock()
    });
    const parsedContextPack = ContextPackSchema.parse(contextPack);

    expect(parsedContextPack.runtimeContext.memory).toMatchObject({
      messages: [
        expect.objectContaining({
          id: "message_memory_1",
          preview: "Spring sale memory: emphasize returning customer bundles."
        })
      ],
      runs: [
        expect.objectContaining({
          id: "run_memory_1",
          eventTypes: ["run.completed"]
        })
      ],
      tools: [
        expect.objectContaining({
          id: "observation_memory_1",
          outputSummary: "stdout: 22 chars\nstderr: 0 chars"
        })
      ]
    });
    expect(parsedContextPack.trace.injected).toEqual(
      expect.arrayContaining([
        "memory:messages:1",
        "memory:runs:1",
        "memory:tools:1",
        "memory:artifacts:0",
        "memory:strategy:deterministic-keyword-v0"
      ])
    );
    expect(parsedContextPack.trace.omitted).not.toContain("history:not_implemented");
    expect(parsedContextPack.trace.omitted).not.toContain("toolObservations:not_implemented");
    expect(JSON.stringify(parsedContextPack)).not.toContain("secret-token");
    expect(JSON.stringify(parsedContextPack)).not.toContain("published");
  });

  it("injects role-relevant handoff summaries into context packs", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    await repositories.agentHandoffs.save({
      id: "handoff_builder_reviewer",
      projectId: project.id,
      taskId: "task_1",
      fromRunId: "run_builder_1",
      fromRole: "builder",
      toRole: "reviewer",
      state: "ready",
      summary: "Builder produced static LP artifacts",
      artifactRefs: {
        pageVersionId: "version_1"
      },
      createdAt: "2026-05-15T08:00:00.000Z",
      updatedAt: "2026-05-15T08:00:00.000Z"
    });

    const contextPack = await assembleContextPack({
      repositories,
      service,
      projectId: project.id,
      taskId: "task_1",
      role: "reviewer",
      input: {
        prompt: "Review"
      },
      now: fixedClock()
    });

    expect(ContextPackSchema.parse(contextPack).runtimeContext.handoffs).toEqual([
      {
        id: "handoff_builder_reviewer",
        fromRunId: "run_builder_1",
        fromRole: "builder",
        toRole: "reviewer",
        state: "ready",
        summary: "Builder produced static LP artifacts",
        artifactRefs: {
          pageVersionId: "version_1"
        },
        updatedAt: "2026-05-15T08:00:00.000Z"
      }
    ]);
    expect(contextPack.trace.injected).toContain("handoffs:1");
    expect(contextPack.trace.omitted).not.toContain("handoffs:none");
  });

  it("omits handoffs when handoff context assembly fails", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    repositories.agentHandoffs.listInbound = async () => {
      throw new Error("handoff_repository_unavailable");
    };

    const contextPack = await assembleContextPack({
      repositories,
      service,
      projectId: project.id,
      role: "builder",
      input: {
        prompt: "Build"
      },
      now: fixedClock()
    });

    expect(ContextPackSchema.parse(contextPack).runtimeContext.handoffs).toEqual([]);
    expect(contextPack.trace.omitted).toContain("handoffs:error");
  });

  it("passes context memory through runAgentStep into runtime requests", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const runtime = new RecordingRuntime({ state: "completed" });
    const service = new DemoWorkbenchService({
      repositories,
      builderRuntime: runtime,
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    await repositories.tasks.save({
      id: "task_memory_runtime",
      title: "Spring sale runtime build",
      type: "lp_generation",
      status: "complete",
      projectId: project.id,
      createdAt: "2026-05-10T00:00:00.000Z"
    });
    await repositories.messages.save({
      id: "message_memory_runtime",
      taskId: "task_memory_runtime",
      role: "user",
      content: "Spring sale runtime memory for product bundles.",
      createdAt: "2026-05-10T00:01:00.000Z"
    });

    await runAgentStep({
      repositories,
      service,
      runtime,
      runId: "run_memory_runtime",
      projectId: project.id,
      taskId: "task_memory_runtime",
      role: "builder",
      input: {
        prompt: "spring sale",
        brief: sampleBrief
      },
      now: fixedClock()
    });

    expect(runtime.requests[0]?.context?.memory?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "message_memory_runtime",
          preview: "Spring sale runtime memory for product bundles."
        })
      ])
    );
    expect(runtime.requests[0]?.context?.memory?.retrieval.selected).toContain(
      "message:message_memory_runtime"
    );
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

  it("executes visible read-only MCP tools and stores safe observations", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const { project, connector } = await createMCPExecutionFixture(service, {
      permissions: ["assets:read"],
      tools: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["builder"],
          requiresApproval: false
        }
      ]
    });

    const result = await service.executeProjectMCPTool({
      projectId: project.id,
      connectorId: connector.id,
      toolName: "searchAssets",
      role: "builder",
      arguments: {
        query: "SECRET_PRODUCT",
        limit: 3
      }
    });

    expect(result.run).toMatchObject({
      id: "run_mcp_tool_1",
      projectId: project.id,
      role: "builder",
      state: "completed",
      contextSummary: {
        injected: ["mcpTool:connector_assets:searchAssets"],
        omitted: []
      }
    });
    expect(result.observation).toMatchObject({
      id: "tool_observation_1",
      runId: "run_mcp_tool_1",
      projectId: project.id,
      toolName: "mcp:connector_assets:searchAssets",
      input: {
        connectorId: "connector_assets",
        toolName: "searchAssets",
        role: "builder",
        permission: "assets:read",
        requiresApproval: false,
        argumentKeys: ["argument_1", "argument_2"],
        argumentCount: 2
      },
      outputSummary:
        "Read-only MCP tool connector_assets.searchAssets completed with 2 argument keys.",
      state: "completed"
    });
    const events = await repositories.runEvents.listForRun(result.run.id);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.completed",
      "run.completed"
    ]);
    expect(JSON.stringify(result)).not.toContain("SECRET_PRODUCT");
    expect(JSON.stringify(events)).not.toContain("SECRET_PRODUCT");
  });

  it("does not persist raw MCP argument keys", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const { project, connector } = await createMCPExecutionFixture(service, {
      permissions: ["assets:read"],
      tools: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["builder"],
          requiresApproval: false
        }
      ]
    });
    const unsafeKey = "SECRET_KEY_/Users/ao/site/.env";

    const result = await service.executeProjectMCPTool({
      projectId: project.id,
      connectorId: connector.id,
      toolName: "searchAssets",
      role: "builder",
      arguments: {
        [unsafeKey]: "safe",
        alpha: 1,
        beta: 2,
        gamma: 3,
        delta: 4,
        epsilon: 5,
        zeta: 6,
        eta: 7,
        theta: 8,
        iota: 9
      }
    });

    expect(result.observation.input).toMatchObject({
      argumentKeys: [
        "argument_1",
        "argument_2",
        "argument_3",
        "argument_4",
        "argument_5",
        "argument_6",
        "argument_7",
        "argument_8"
      ],
      argumentCount: 10
    });
    const events = await repositories.runEvents.listForRun(result.run.id);
    const serializedRecords = JSON.stringify({ result, events });
    expect(serializedRecords).not.toContain(unsafeKey);
    expect(serializedRecords).not.toContain("/Users/ao/site/.env");
    expect(serializedRecords).not.toContain("SECRET_KEY");
  });

  it("rejects disabled, unauthorized, and unapproved MCP tool execution", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const { project, connector } = await createMCPExecutionFixture(service, {
      permissions: ["assets:read"],
      tools: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["builder"],
          requiresApproval: false
        },
        {
          name: "auditAssets",
          permission: "assets:audit",
          roles: ["reviewer"],
          requiresApproval: true
        }
      ]
    });

    await expect(
      service.executeProjectMCPTool({
        projectId: project.id,
        connectorId: connector.id,
        toolName: "searchAssets",
        role: "reviewer",
        arguments: {}
      })
    ).rejects.toThrow("mcp_tool_not_visible");

    await expect(
      service.executeProjectMCPTool({
        projectId: project.id,
        connectorId: connector.id,
        toolName: "auditAssets",
        role: "reviewer",
        arguments: {}
      })
    ).rejects.toThrow("mcp_tool_not_visible");

    await service.setProjectMCPConnectorEnabled({
      projectId: project.id,
      connectorId: connector.id,
      enabled: false
    });

    await expect(
      service.executeProjectMCPTool({
        projectId: project.id,
        connectorId: connector.id,
        toolName: "searchAssets",
        role: "builder",
        arguments: {}
      })
    ).rejects.toThrow("mcp_tool_not_visible");
  });

  it("requires saved MCP approval before executing approval-required read tools", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const { project, connector } = await createMCPExecutionFixture(service, {
      permissions: ["assets:read"],
      tools: [
        {
          name: "auditAssets",
          permission: "assets:read",
          roles: ["reviewer"],
          requiresApproval: true
        }
      ]
    });

    await expect(
      service.executeProjectMCPTool({
        projectId: project.id,
        connectorId: connector.id,
        toolName: "auditAssets",
        role: "reviewer",
        arguments: {}
      })
    ).rejects.toThrow("mcp_tool_execution_approval_required");

    await service.setProjectMCPToolApproval({
      projectId: project.id,
      connectorId: connector.id,
      toolName: "auditAssets",
      approved: true,
      approvedByUserId: "reviewer_1"
    });

    await expect(
      service.executeProjectMCPTool({
        projectId: project.id,
        connectorId: connector.id,
        toolName: "auditAssets",
        role: "reviewer",
        arguments: {}
      })
    ).resolves.toMatchObject({
      observation: {
        input: {
          approvedByUserId: "reviewer_1"
        }
      }
    });
  });

  it("rejects write-like MCP tools before calling the executor", async () => {
    let called = false;
    const executor: MCPToolExecutor = {
      async execute() {
        called = true;
        return {
          state: "completed",
          outputSummary: "unsafe",
          durationMs: 1
        };
      }
    };
    const service = new DemoWorkbenchService({
      mcpToolExecutor: executor,
      now: fixedClock()
    });
    const { project, connector } = await createMCPExecutionFixture(service, {
      permissions: ["git:write"],
      tools: [
        {
          name: "createPullRequest",
          permission: "git:write",
          roles: ["deployer"],
          requiresApproval: true,
          readOnly: true
        }
      ]
    });
    await service.setProjectMCPToolApproval({
      projectId: project.id,
      connectorId: connector.id,
      toolName: "createPullRequest",
      approved: true,
      approvedByUserId: "deployer_1"
    });

    await expect(
      service.executeProjectMCPTool({
        projectId: project.id,
        connectorId: connector.id,
        toolName: "createPullRequest",
        role: "deployer",
        arguments: {}
      })
    ).rejects.toThrow("mcp_tool_execution_not_read_only");
    expect(called).toBe(false);
  });

  it("rejects read-permission MCP tools with write metadata before calling the executor", async () => {
    let called = false;
    const executor: MCPToolExecutor = {
      async execute() {
        called = true;
        return {
          state: "completed",
          outputSummary: "unsafe",
          durationMs: 1
        };
      }
    };
    const service = new DemoWorkbenchService({
      mcpToolExecutor: executor,
      now: fixedClock()
    });
    const { project, connector } = await createMCPExecutionFixture(service, {
      permissions: ["assets:read"],
      tools: [
        {
          name: "mutateAssets",
          permission: "assets:read",
          roles: ["builder"],
          requiresApproval: false,
          sideEffect: "write"
        },
        {
          name: "syncAssets",
          permission: "assets:read",
          roles: ["builder"],
          requiresApproval: false,
          readOnly: false
        }
      ]
    });

    await expect(
      service.executeProjectMCPTool({
        projectId: project.id,
        connectorId: connector.id,
        toolName: "mutateAssets",
        role: "builder",
        arguments: {}
      })
    ).rejects.toThrow("mcp_tool_execution_not_read_only");
    await expect(
      service.executeProjectMCPTool({
        projectId: project.id,
        connectorId: connector.id,
        toolName: "syncAssets",
        role: "builder",
        arguments: {}
      })
    ).rejects.toThrow("mcp_tool_execution_not_read_only");
    expect(called).toBe(false);
  });

  it("stores failed MCP executor results without raw arguments", async () => {
    const executor: MCPToolExecutor = {
      async execute() {
        return {
          state: "failed",
          outputSummary: "Failed while reading SECRET_PRODUCT",
          metadata: {
            rawOutput: "SECRET_PRODUCT"
          },
          errorName: "Remote Failure With Spaces",
          durationMs: 7
        };
      }
    };
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
      mcpToolExecutor: executor,
      now: fixedClock()
    });
    const { project, connector } = await createMCPExecutionFixture(service, {
      permissions: ["assets:read"],
      tools: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["builder"],
          requiresApproval: false
        }
      ]
    });

    const result = await service.executeProjectMCPTool({
      projectId: project.id,
      connectorId: connector.id,
      toolName: "searchAssets",
      role: "builder",
      arguments: {
        query: "SECRET_PRODUCT"
      }
    });

    expect(result.run.state).toBe("failed");
    expect(result.observation).toMatchObject({
      state: "failed",
      outputSummary: "Failed while reading [redacted]",
      errorName: "mcp_executor_error"
    });
    const events = await repositories.runEvents.listForRun(result.run.id);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.failed",
      "run.failed"
    ]);
    expect(JSON.stringify(result)).not.toContain("SECRET_PRODUCT");
    expect(JSON.stringify(events)).not.toContain("SECRET_PRODUCT");
  });

  it("does not persist local paths from failed MCP executor summaries", async () => {
    const unsafePath = "/Users/ao/private/site/index.html";
    const { result, events } = await executeMCPFailureWithSummary({
      outputSummary: `Failed while reading ${unsafePath}`
    });

    expect(result.observation).toMatchObject({
      state: "failed",
      outputSummary: "Read-only MCP tool failed."
    });
    expect(JSON.stringify(result)).not.toContain(unsafePath);
    expect(JSON.stringify(events)).not.toContain(unsafePath);
  });

  it("does not persist artifact-like content from failed MCP executor summaries", async () => {
    const artifactContent = "<!doctype html><html><body>SECRET_ARTIFACT</body></html>";
    const { result, events } = await executeMCPFailureWithSummary({
      outputSummary: `Failed with ${artifactContent}`
    });

    expect(result.observation).toMatchObject({
      state: "failed",
      outputSummary: "Read-only MCP tool failed."
    });
    expect(JSON.stringify(result)).not.toContain(artifactContent);
    expect(JSON.stringify(result)).not.toContain("SECRET_ARTIFACT");
    expect(JSON.stringify(events)).not.toContain(artifactContent);
    expect(JSON.stringify(events)).not.toContain("SECRET_ARTIFACT");
  });

  it("redacts env secret values from failed MCP executor summaries", async () => {
    const { result, events } = await executeMCPFailureWithSummary({
      outputSummary: "Failed while reading MCP_ENV_SECRET",
      env: { MCP_SECRET: "MCP_ENV_SECRET" }
    });

    expect(result.observation).toMatchObject({
      state: "failed",
      outputSummary: "Failed while reading [redacted]"
    });
    expect(JSON.stringify(result)).not.toContain("MCP_ENV_SECRET");
    expect(JSON.stringify(events)).not.toContain("MCP_ENV_SECRET");
  });

  it("redacts nested argument strings from failed MCP executor summaries", async () => {
    const { result, events } = await executeMCPFailureWithSummary({
      outputSummary: "Failed while reading NESTED_ARGUMENT_SECRET",
      arguments: {
        filters: {
          secret: "NESTED_ARGUMENT_SECRET"
        }
      }
    });

    expect(result.observation).toMatchObject({
      state: "failed",
      outputSummary: "Failed while reading [redacted]"
    });
    expect(JSON.stringify(result)).not.toContain("NESTED_ARGUMENT_SECRET");
    expect(JSON.stringify(events)).not.toContain("NESTED_ARGUMENT_SECRET");
  });

  it("redacts scalar argument leaves from failed MCP executor summaries", async () => {
    const { result, events } = await executeMCPFailureWithSummary({
      outputSummary: "Found ticket 424242 active true",
      arguments: {
        ticketId: 424242,
        active: true
      }
    });

    expect(result.observation).toMatchObject({
      state: "failed",
      outputSummary: "Found ticket [redacted] active [redacted]"
    });
    expect(JSON.stringify(result)).not.toContain("424242");
    expect(JSON.stringify(result)).not.toContain("active true");
    expect(JSON.stringify(events)).not.toContain("424242");
    expect(JSON.stringify(events)).not.toContain("active true");
  });

  it("falls back when MCP argument traversal exceeds depth limits", async () => {
    const { result, events } = await executeMCPFailureWithSummary({
      outputSummary: "Failed while reading DEEP_ARGUMENT_SECRET",
      arguments: {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  level6: {
                    secret: "DEEP_ARGUMENT_SECRET"
                  }
                }
              }
            }
          }
        }
      }
    });

    expect(result.observation).toMatchObject({
      state: "failed",
      outputSummary: "Read-only MCP tool failed."
    });
    expect(JSON.stringify(result)).not.toContain("DEEP_ARGUMENT_SECRET");
    expect(JSON.stringify(events)).not.toContain("DEEP_ARGUMENT_SECRET");
  });

  it("falls back when MCP argument traversal exceeds collection limits", async () => {
    const manyArguments = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [
        `value_${index}`,
        index === 100 ? "OVER_LIMIT_ARGUMENT_SECRET" : `safe_${index}`
      ])
    );
    const { result, events } = await executeMCPFailureWithSummary({
      outputSummary: "Failed while reading OVER_LIMIT_ARGUMENT_SECRET",
      arguments: manyArguments
    });

    expect(result.observation).toMatchObject({
      state: "failed",
      outputSummary: "Read-only MCP tool failed."
    });
    expect(JSON.stringify(result)).not.toContain("OVER_LIMIT_ARGUMENT_SECRET");
    expect(JSON.stringify(events)).not.toContain("OVER_LIMIT_ARGUMENT_SECRET");
  });

  it("does not persist HTML tag snippets from failed MCP executor summaries", async () => {
    const artifactContent = "<h1>SECRET_ARTIFACT</h1>";
    const { result, events } = await executeMCPFailureWithSummary({
      outputSummary: `Failed with ${artifactContent}`
    });

    expect(result.observation).toMatchObject({
      state: "failed",
      outputSummary: "Read-only MCP tool failed."
    });
    expect(JSON.stringify(result)).not.toContain(artifactContent);
    expect(JSON.stringify(result)).not.toContain("SECRET_ARTIFACT");
    expect(JSON.stringify(events)).not.toContain(artifactContent);
    expect(JSON.stringify(events)).not.toContain("SECRET_ARTIFACT");
  });

  it("does not persist JS or CSS snippets from failed MCP executor summaries", async () => {
    const jsSnippet = 'console.log("SECRET_ARTIFACT")';
    const cssSnippet = ".hero { color: red; }";
    const { result, events } = await executeMCPFailureWithSummary({
      outputSummary: `Failed with ${jsSnippet} and ${cssSnippet}`
    });

    expect(result.observation).toMatchObject({
      state: "failed",
      outputSummary: "Read-only MCP tool failed."
    });
    expect(JSON.stringify(result)).not.toContain("SECRET_ARTIFACT");
    expect(JSON.stringify(result)).not.toContain(cssSnippet);
    expect(JSON.stringify(events)).not.toContain("SECRET_ARTIFACT");
    expect(JSON.stringify(events)).not.toContain(cssSnippet);
  });

  it("does not persist broad local paths from failed MCP executor summaries", async () => {
    const localPaths = [
      "/home/user/site/index.html",
      "/etc/passwd",
      "../site/index.html",
      "/index.html",
      "/.env",
      "/tmp",
      "C:/Users/a/file.txt"
    ];
    const { result, events } = await executeMCPFailureWithSummary({
      outputSummary: `Failed with ${localPaths.join(" ")}`
    });

    expect(result.observation).toMatchObject({
      state: "failed",
      outputSummary: "Read-only MCP tool failed."
    });
    for (const localPath of localPaths) {
      expect(JSON.stringify(result)).not.toContain(localPath);
      expect(JSON.stringify(events)).not.toContain(localPath);
    }
  });

  it("does not persist root-level or Windows forward-slash paths", async () => {
    const localPaths = ["/index.html", "/.env", "/tmp", "C:/Users/a/file.txt"];
    const { result, events } = await executeMCPFailureWithSummary({
      outputSummary: `Failed with ${localPaths.join(" ")}`
    });

    expect(result.observation).toMatchObject({
      state: "failed",
      outputSummary: "Read-only MCP tool failed."
    });
    for (const localPath of localPaths) {
      expect(JSON.stringify(result)).not.toContain(localPath);
      expect(JSON.stringify(events)).not.toContain(localPath);
    }
  });

  it("does not persist SVG markup from failed MCP executor summaries", async () => {
    const svgMarkup = '<svg><path d="M0 0" /></svg>';
    const { result, events } = await executeMCPFailureWithSummary({
      outputSummary: `Failed with ${svgMarkup}`
    });

    expect(result.observation).toMatchObject({
      state: "failed",
      outputSummary: "Read-only MCP tool failed."
    });
    expect(JSON.stringify(result)).not.toContain(svgMarkup);
    expect(JSON.stringify(events)).not.toContain(svgMarkup);
  });

  it("uses the configured current user for mcp approval actor defaults", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
      currentUser: {
        id: "web-reviewer",
        displayName: "Web Reviewer"
      },
      now: fixedClock()
    });
    const project = await service.createProject({ name: "MCP Approval" });
    const connector = await service.createProjectMCPConnector({
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

    await expect(
      service.setProjectMCPToolApproval({
        projectId: project.id,
        connectorId: connector.id,
        toolName: "createPullRequest",
        approved: true
      })
    ).resolves.toMatchObject({
      approvedByUserId: "web-reviewer"
    });
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
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
      builderRuntime: new StaticRuntime({ state: "failed", artifacts: undefined }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });

    await expect(
      service.generatePageVersion({ projectId: project.id, briefId: brief.id })
    ).rejects.toThrow("Builder run failed.");
    await expect(repositories.pageVersions.listAll()).resolves.toEqual([]);
    await expect(repositories.artifactWorkspaces.listAll()).resolves.toEqual([]);
    await expect(repositories.artifactWorkspaceFiles.listAll()).resolves.toEqual([]);
  });

  it("requires builder artifacts before creating a page version", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
      builderRuntime: new StaticRuntime({ state: "completed", artifacts: undefined }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });

    await expect(
      service.generatePageVersion({ projectId: project.id, briefId: brief.id })
    ).rejects.toThrow("Builder run did not return artifacts.");
    await expect(repositories.pageVersions.listAll()).resolves.toEqual([]);
    await expect(repositories.artifactWorkspaces.listAll()).resolves.toEqual([]);
    await expect(repositories.artifactWorkspaceFiles.listAll()).resolves.toEqual([]);
  });

  it("rejects incomplete builder artifacts before creating a page version", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
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
    await expect(repositories.pageVersions.listAll()).resolves.toEqual([]);
    await expect(repositories.artifactWorkspaces.listAll()).resolves.toEqual([]);
    await expect(repositories.artifactWorkspaceFiles.listAll()).resolves.toEqual([]);
  });

  it("does not create a page version from a non-completed builder run", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
      builderRuntime: new StaticRuntime({ state: "needs_input", artifacts: completeArtifacts() }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });

    await expect(
      service.generatePageVersion({ projectId: project.id, briefId: brief.id })
    ).rejects.toThrow("Builder run did not complete.");
    await expect(repositories.pageVersions.listAll()).resolves.toEqual([]);
    await expect(repositories.artifactWorkspaces.listAll()).resolves.toEqual([]);
    await expect(repositories.artifactWorkspaceFiles.listAll()).resolves.toEqual([]);
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
    ).rejects.toThrow("agent_handoff_blocked");
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

class RecordingToolCommandRunner implements ToolCommandRunner {
  readonly inputs: ToolCommandRunInput[] = [];

  constructor(private readonly result: ToolCommandRunResult) {}

  async run(input: ToolCommandRunInput): Promise<ToolCommandRunResult> {
    this.inputs.push({
      ...input,
      args: [...input.args],
      env: { ...input.env }
    });
    return this.result;
  }
}

class ThrowingToolCommandRunner implements ToolCommandRunner {
  constructor(private readonly createError: () => Error) {}

  async run(): Promise<ToolCommandRunResult> {
    throw this.createError();
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

function completeModelArtifacts(): StaticArtifacts {
  return {
    indexHtml: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Model Built LP</title>
  <meta name="description" content="MODEL_BUILDER_ARTIFACT_SECRET static LP.">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
  <link rel="stylesheet" href="https://assets.example.com/brand/campaign.css">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main>
    <section class="hero">
      <h1>MODEL_BUILDER_ARTIFACT_SECRET</h1>
      <p>Model generated static LP artifacts.</p>
      <a href="#products" data-track="cta:hero">Shop now</a>
      <img src="https://cdn.example.com/product.jpg" alt="Product">
    </section>
    <section id="products"><h2>Products</h2></section>
  </main>
  <script src="script.js"></script>
</body>
</html>`,
    stylesCss: `:root { --color-primary: #0f766e; }
body { margin: 0; font-family: Inter, system-ui, sans-serif; }
.hero { padding: 64px 24px; }`,
    scriptJs: `document.querySelectorAll("[data-track]").forEach((element) => {
  element.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("lp-agent-track"));
  });
});`
  };
}

async function createMCPExecutionFixture(
  service: DemoWorkbenchService,
  input: {
    permissions: string[];
    tools: Array<{
      name: string;
      permission: string;
      roles: Array<"planner" | "builder" | "reviewer" | "deployer">;
      requiresApproval: boolean;
      readOnly?: boolean;
      sideEffect?: "read" | "write";
    }>;
  }
): Promise<{ project: ProjectRecord; connector: MCPConnectorRecord }> {
  const project = await service.createProject({ name: "MCP Execution" });
  const draft = await service.createSkillDraft({
    manifestJson: JSON.stringify({
      id: "skill_mcp_permissions",
      name: "MCP Permissions",
      version: "0.1.0",
      type: "workflow",
      scope: "project",
      description: "Grants MCP tool permissions.",
      permissions: input.permissions,
      requiredSecrets: [],
      entrypoints: ["workflow.md"],
      reviewState: "draft"
    }),
    content: "Use approved MCP tools.",
    contentType: "text/markdown"
  });
  await service.validateSkillVersion({ skillVersionId: draft.version.id });
  const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });
  await service.bindSkillVersionToProject({
    projectId: project.id,
    skillVersionId: published.id
  });
  const connector = await service.createProjectMCPConnector({
    projectId: project.id,
    definitionJson: JSON.stringify({
      id: "connector_assets",
      name: "Assets",
      tools: input.tools
    })
  });
  return { project, connector };
}

async function executeMCPFailureWithSummary(input: {
  outputSummary: string;
  env?: Record<string, string | undefined>;
  arguments?: Record<string, unknown>;
}): Promise<{
  result: Awaited<ReturnType<DemoWorkbenchService["executeProjectMCPTool"]>>;
  events: RunEventRecord[];
}> {
  const executor: MCPToolExecutor = {
    async execute() {
      return {
        state: "failed",
        outputSummary: input.outputSummary,
        errorName: "remote_failure",
        durationMs: 1
      };
    }
  };
  const repositories = createInMemoryWorkbenchRepositories();
  const service = new DemoWorkbenchService({
    repositories,
    mcpToolExecutor: executor,
    env: input.env,
    now: fixedClock()
  });
  const { project, connector } = await createMCPExecutionFixture(service, {
    permissions: ["assets:read"],
    tools: [
      {
        name: "searchAssets",
        permission: "assets:read",
        roles: ["builder"],
        requiresApproval: false
      }
    ]
  });

  const result = await service.executeProjectMCPTool({
    projectId: project.id,
    connectorId: connector.id,
    toolName: "searchAssets",
    role: "builder",
    arguments: input.arguments ?? {}
  });
  const events = await repositories.runEvents.listForRun(result.run.id);
  return { result, events };
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

function deploymentSkillManifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return brandSkillManifest({
    id: "skill_static_deploy",
    name: "Static deploy",
    type: "deployment",
    description: "Deploys static LP artifacts.",
    permissions: ["artifact:read", "deploy:static"],
    requiredSecrets: ["STATIC_DEPLOY_TOKEN"],
    entrypoints: ["skills/static-deploy.md"],
    reviewState: "published",
    commands: [
      {
        id: "publish_static",
        name: "Publish static artifacts",
        permission: "deploy:static",
        requiresApproval: true,
        command: "static-deploy",
        args: ["--project", "{{projectId}}", "--html", "{{artifact.indexHtmlPath}}"],
        env: [
          { name: "STATIC_DEPLOY_TOKEN", secretRef: "STATIC_DEPLOY_TOKEN" },
          { name: "LP_PROJECT_ID", value: "{{projectId}}" }
        ],
        workingDirectory: "{{artifactDir}}",
        timeoutMs: 120000
      }
    ],
    ...overrides
  });
}

function commandWithoutArtifacts(): NonNullable<SkillManifest["commands"]>[number] {
  return {
    id: "publish_static",
    name: "Publish static artifacts",
    permission: "deploy:static",
    requiresApproval: true,
    command: "static-deploy",
    args: ["--project", "{{projectId}}"],
    env: [
      { name: "STATIC_DEPLOY_TOKEN", secretRef: "STATIC_DEPLOY_TOKEN" },
      { name: "LP_PROJECT_ID", value: "{{projectId}}" }
    ],
    timeoutMs: 120000
  };
}

async function expectDeploymentCommandFailure(input: {
  runner: RecordingToolCommandRunner;
  manifest: SkillManifest;
  expectedError: string;
}): Promise<void> {
  const repositories = createInMemoryWorkbenchRepositories();
  const service = new DemoWorkbenchService({
    repositories,
    toolCommandRunner: input.runner,
    env: { STATIC_DEPLOY_TOKEN: "secret-token" },
    now: fixedClock()
  });
  const project = await service.createProject({ name: "Project" });
  const skill = await service.createSkillDraft({
    manifestJson: JSON.stringify(input.manifest),
    content: "# Static deploy",
    contentType: "text/markdown"
  });
  await service.validateSkillVersion({ skillVersionId: skill.version.id });
  const published = await service.publishSkillVersion({ skillVersionId: skill.version.id });
  await service.bindSkillVersionToProject({
    projectId: project.id,
    skillVersionId: published.id
  });

  await expect(
    service.executeProjectSkillCommand({
      projectId: project.id,
      skillVersionId: published.id,
      commandId: "publish_static",
      approvedByUserId: "user_1"
    })
  ).rejects.toThrow(input.expectedError);
}
