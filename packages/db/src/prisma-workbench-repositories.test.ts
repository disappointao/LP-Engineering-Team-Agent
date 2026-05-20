import { describe, expect, it } from "vitest";
import type { StaticArtifacts } from "@lp-agent/artifacts";
import { objectEnumValues } from "@prisma/client/runtime/library";
import {
  createPrismaWorkbenchRepositories,
  createUnsupportedPrismaRepository
} from "./prisma-workbench-repositories";
import { runCoreWorkbenchRepositoryContractTests } from "./workbench-repository-contract";

type FakeRow = Record<string, unknown>;
type FakeWhere = Record<string, unknown>;
type FakeOrderBy = Array<Record<string, "asc" | "desc">>;

interface FakeFindManyArgs {
  where?: FakeWhere;
  orderBy?: FakeOrderBy;
  take?: number;
}

interface FakeDelegate {
  upsert(input: { where: FakeWhere; create: FakeRow; update: FakeRow }): Promise<FakeRow>;
  findUnique(input: { where: FakeWhere }): Promise<FakeRow | null>;
  findMany(input?: FakeFindManyArgs): Promise<FakeRow[]>;
}

interface FakeDelegateOptions {
  beforeUpsert?: (context: { input: FakeUpsertInput; rows: FakeRow[] }) => void;
  onUpsert?: (input: FakeUpsertInput) => void;
  enforceUniqueId?: boolean;
  uniqueIdError?: (id: string) => string;
  rejectPlainNullJsonKeys?: string[];
}

interface FakePrismaClientOptions {
  project?: FakeDelegateOptions;
  projectMember?: FakeDelegateOptions;
  deployment?: FakeDelegateOptions;
  skill?: FakeDelegateOptions;
  skillVersion?: FakeDelegateOptions;
  skillBinding?: FakeDelegateOptions;
  modelProvider?: FakeDelegateOptions;
  modelRoutingPolicy?: FakeDelegateOptions;
  mCPConnector?: FakeDelegateOptions;
  mCPToolApproval?: FakeDelegateOptions;
  agentHandoff?: FakeDelegateOptions;
}

type FakeUpsertInput = { where: FakeWhere; create: FakeRow; update: FakeRow };

runCoreWorkbenchRepositoryContractTests({
  name: "prisma fake",
  createRepositories: () =>
    createPrismaWorkbenchRepositories({
      prisma: createFakePrismaClient(),
      workspaceId: "workspace_default"
    })
});

const createdAt = "2026-05-14T00:00:00.000Z";

const staticArtifacts: StaticArtifacts = {
  indexHtml: "<!doctype html><html><body><h1>Spring sale</h1></body></html>",
  stylesCss: "body { margin: 0; color: #17202a; }",
  scriptJs: "console.log('spring sale ready');"
};

describe("createPrismaWorkbenchRepositories", () => {
  it("scopes project reads and saves to the repository workspace", async () => {
    const prisma = createFakePrismaClient();
    const workspaceA = createPrismaWorkbenchRepositories({
      prisma,
      workspaceId: "workspace_a"
    });
    const workspaceB = createPrismaWorkbenchRepositories({
      prisma,
      workspaceId: "workspace_b"
    });

    await workspaceA.projects.save({
      id: "project_shared",
      name: "Workspace A project",
      createdAt
    });

    await expect(workspaceB.projects.getById("project_shared")).resolves.toBeUndefined();
    await expect(
      workspaceB.projects.save({
        id: "project_shared",
        name: "Workspace B attempted mutation",
        createdAt: "2026-05-14T00:01:00.000Z"
      })
    ).rejects.toThrow("Prisma project project_shared belongs to a different workspace");
    await expect(workspaceA.projects.getById("project_shared")).resolves.toEqual({
      id: "project_shared",
      name: "Workspace A project",
      createdAt
    });
  });

  it("rejects project save when a competing workspace creates the same id after ownership preflight", async () => {
    let injectedRaceRow = false;
    const prisma = createFakePrismaClient({
      project: {
        beforeUpsert({ input, rows }) {
          if (input.create.id !== "project_race" || injectedRaceRow) {
            return;
          }

          injectedRaceRow = true;
          rows.push(
            cloneRow({
              id: "project_race",
              workspaceId: "workspace_a",
              name: "Workspace A project",
              createdAt: new Date(createdAt)
            })
          );
        }
      }
    });
    const workspaceA = createPrismaWorkbenchRepositories({
      prisma,
      workspaceId: "workspace_a"
    });
    const workspaceB = createPrismaWorkbenchRepositories({
      prisma,
      workspaceId: "workspace_b"
    });

    await expect(
      workspaceB.projects.save({
        id: "project_race",
        name: "Workspace B attempted mutation",
        createdAt: "2026-05-14T00:01:00.000Z"
      })
    ).rejects.toThrow("project_race");
    await expect(workspaceA.projects.getById("project_race")).resolves.toEqual({
      id: "project_race",
      name: "Workspace A project",
      createdAt
    });
  });

  it("clears agent handoff artifact refs without writing a plain JSON null", async () => {
    const agentHandoffWrites: FakeUpsertInput[] = [];
    const repositories = createPrismaWorkbenchRepositories({
      prisma: createFakePrismaClient({
        agentHandoff: {
          onUpsert(input) {
            agentHandoffWrites.push(cloneRow(input) as FakeUpsertInput);
          },
          rejectPlainNullJsonKeys: ["artifactRefs"]
        }
      }),
      workspaceId: "workspace_default"
    });

    await repositories.agentHandoffs.save({
      id: "handoff_json_clear",
      projectId: "project_json_clear",
      taskId: "task_json_clear",
      fromRunId: "run_reviewer",
      fromRole: "reviewer",
      toRole: "builder",
      state: "blocked",
      summary: "Need a fix.",
      artifactRefs: {
        briefId: "brief_json_clear",
        pageVersionId: "version_json_clear"
      },
      createdAt,
      updatedAt: createdAt
    });

    await expect(
      repositories.agentHandoffs.save({
        id: "handoff_json_clear",
        projectId: "project_json_clear",
        fromRunId: "run_reviewer",
        fromRole: "reviewer",
        toRole: "builder",
        state: "ready",
        summary: "Ready to continue.",
        createdAt,
        updatedAt: "2026-05-14T00:04:00.000Z"
      })
    ).resolves.toBeUndefined();

    const clearWrite = agentHandoffWrites.at(-1);
    expect(clearWrite?.update.artifactRefs).toEqual({});
    await expect(repositories.agentHandoffs.getById("handoff_json_clear")).resolves.toEqual({
      id: "handoff_json_clear",
      projectId: "project_json_clear",
      fromRunId: "run_reviewer",
      fromRole: "reviewer",
      toRole: "builder",
      state: "ready",
      summary: "Ready to continue.",
      createdAt,
      updatedAt: "2026-05-14T00:04:00.000Z"
    });
  });

  it("clears nullable repository fields when optional properties are omitted on save", async () => {
    const repositories = createPrismaWorkbenchRepositories({
      prisma: createFakePrismaClient(),
      workspaceId: "workspace_default"
    });

    await repositories.tasks.save({
      id: "task_nullable",
      title: "Task with project",
      type: "lp_generation",
      status: "complete",
      projectId: "project_nullable",
      createdAt
    });
    await repositories.taskSnapshots.save({
      taskId: "task_nullable",
      projectId: "project_nullable",
      briefId: "brief_nullable",
      pageVersionId: "version_nullable",
      createdAt
    });
    await repositories.runs.save({
      id: "run_nullable",
      projectId: "project_nullable",
      taskId: "task_nullable",
      role: "builder",
      state: "completed",
      startedAt: createdAt,
      completedAt: "2026-05-14T00:02:00.000Z",
      contextSummary: {
        injected: ["brief"],
        omitted: []
      }
    });
    await repositories.pageVersions.save({
      id: "version_nullable",
      projectId: "project_nullable",
      briefId: "brief_nullable",
      artifactWorkspaceId: "artifact_workspace_nullable",
      artifacts: staticArtifacts,
      reviewStatus: "passed",
      findings: [],
      createdAt
    });
    await repositories.artifactWorkspaces.save({
      id: "artifact_workspace_nullable",
      projectId: "project_nullable",
      pageVersionId: "version_nullable",
      runId: "run_nullable",
      kind: "static_lp",
      state: "active",
      createdAt,
      updatedAt: createdAt
    });
    await repositories.artifactWorkspaceFiles.save({
      id: "artifact_workspace_file_nullable",
      workspaceId: "artifact_workspace_nullable",
      projectId: "project_nullable",
      pageVersionId: "version_nullable",
      path: "index.html",
      kind: "html",
      mimeType: "text/html",
      sizeBytes: Buffer.byteLength(staticArtifacts.indexHtml, "utf8"),
      sha256: "a8a9b67757f1ba55b5eeadf1fe967ff562cecae267b62018346f9a87ada73935",
      summary: "index file",
      content: staticArtifacts.indexHtml,
      createdAt,
      updatedAt: createdAt
    });
    await repositories.toolObservations.save({
      id: "tool_observation_nullable",
      runId: "run_nullable",
      projectId: "project_nullable",
      taskId: "task_nullable",
      toolName: "writeFile",
      input: {
        path: "index.html"
      },
      outputSummary: "write failed",
      state: "failed",
      exitCode: 1,
      errorName: "WriteError",
      createdAt,
      completedAt: "2026-05-14T00:03:00.000Z"
    });
    await repositories.agentHandoffs.save({
      id: "handoff_nullable",
      projectId: "project_nullable",
      taskId: "task_nullable",
      fromRunId: "run_reviewer",
      fromRole: "reviewer",
      toRole: "builder",
      state: "blocked",
      summary: "Need a fix.",
      blockingReason: "Missing asset",
      artifactRefs: {
        briefId: "brief_nullable",
        pageVersionId: "version_nullable"
      },
      createdAt,
      updatedAt: createdAt
    });

    await repositories.tasks.save({
      id: "task_nullable",
      title: "Task without project",
      type: "lp_generation",
      status: "complete",
      createdAt
    });
    await repositories.taskSnapshots.save({
      taskId: "task_nullable",
      projectId: "project_nullable",
      createdAt
    });
    await repositories.runs.save({
      id: "run_nullable",
      projectId: "project_nullable",
      role: "builder",
      state: "running",
      startedAt: createdAt,
      contextSummary: {
        injected: [],
        omitted: ["brief"]
      }
    });
    await repositories.pageVersions.save({
      id: "version_nullable",
      projectId: "project_nullable",
      briefId: "brief_nullable",
      artifacts: staticArtifacts,
      reviewStatus: "pending",
      findings: [],
      createdAt
    });
    await repositories.artifactWorkspaces.save({
      id: "artifact_workspace_nullable",
      projectId: "project_nullable",
      kind: "static_lp",
      state: "active",
      createdAt,
      updatedAt: "2026-05-14T00:04:00.000Z"
    });
    await repositories.artifactWorkspaceFiles.save({
      id: "artifact_workspace_file_nullable",
      workspaceId: "artifact_workspace_nullable",
      projectId: "project_nullable",
      path: "index.html",
      kind: "html",
      mimeType: "text/html",
      sizeBytes: Buffer.byteLength(staticArtifacts.indexHtml, "utf8"),
      sha256: "a8a9b67757f1ba55b5eeadf1fe967ff562cecae267b62018346f9a87ada73935",
      summary: "index file",
      content: staticArtifacts.indexHtml,
      createdAt,
      updatedAt: "2026-05-14T00:04:00.000Z"
    });
    await repositories.toolObservations.save({
      id: "tool_observation_nullable",
      runId: "run_nullable",
      projectId: "project_nullable",
      toolName: "writeFile",
      input: {
        path: "index.html"
      },
      outputSummary: "write still running",
      state: "running",
      createdAt
    });
    await repositories.agentHandoffs.save({
      id: "handoff_nullable",
      projectId: "project_nullable",
      fromRunId: "run_reviewer",
      fromRole: "reviewer",
      toRole: "builder",
      state: "ready",
      summary: "Ready to continue.",
      createdAt,
      updatedAt: "2026-05-14T00:04:00.000Z"
    });

    await expect(repositories.tasks.getById("task_nullable")).resolves.toEqual({
      id: "task_nullable",
      title: "Task without project",
      type: "lp_generation",
      status: "complete",
      createdAt
    });
    await expect(repositories.taskSnapshots.getByTaskId("task_nullable")).resolves.toEqual({
      taskId: "task_nullable",
      projectId: "project_nullable",
      createdAt
    });
    await expect(repositories.runs.getById("run_nullable")).resolves.toEqual({
      id: "run_nullable",
      projectId: "project_nullable",
      role: "builder",
      state: "running",
      startedAt: createdAt,
      contextSummary: {
        injected: [],
        omitted: ["brief"]
      }
    });
    await expect(repositories.pageVersions.getById("version_nullable")).resolves.toEqual({
      id: "version_nullable",
      projectId: "project_nullable",
      briefId: "brief_nullable",
      artifacts: staticArtifacts,
      reviewStatus: "pending",
      findings: [],
      createdAt
    });
    await expect(
      repositories.artifactWorkspaces.getById("artifact_workspace_nullable")
    ).resolves.toEqual({
      id: "artifact_workspace_nullable",
      projectId: "project_nullable",
      kind: "static_lp",
      state: "active",
      createdAt,
      updatedAt: "2026-05-14T00:04:00.000Z"
    });
    await expect(
      repositories.artifactWorkspaceFiles.getByPath({
        workspaceId: "artifact_workspace_nullable",
        path: "index.html"
      })
    ).resolves.toEqual({
      id: "artifact_workspace_file_nullable",
      workspaceId: "artifact_workspace_nullable",
      projectId: "project_nullable",
      path: "index.html",
      kind: "html",
      mimeType: "text/html",
      sizeBytes: Buffer.byteLength(staticArtifacts.indexHtml, "utf8"),
      sha256: "a8a9b67757f1ba55b5eeadf1fe967ff562cecae267b62018346f9a87ada73935",
      summary: "index file",
      content: staticArtifacts.indexHtml,
      createdAt,
      updatedAt: "2026-05-14T00:04:00.000Z"
    });
    await expect(repositories.toolObservations.listAll()).resolves.toEqual([
      {
        id: "tool_observation_nullable",
        runId: "run_nullable",
        projectId: "project_nullable",
        toolName: "writeFile",
        input: {
          path: "index.html"
        },
        outputSummary: "write still running",
        state: "running",
        createdAt
      }
    ]);
    await expect(repositories.agentHandoffs.getById("handoff_nullable")).resolves.toEqual({
      id: "handoff_nullable",
      projectId: "project_nullable",
      fromRunId: "run_reviewer",
      fromRole: "reviewer",
      toRole: "builder",
      state: "ready",
      summary: "Ready to continue.",
      createdAt,
      updatedAt: "2026-05-14T00:04:00.000Z"
    });
  });

  it("clears run event task scope when taskId is omitted on update", async () => {
    const repositories = createPrismaWorkbenchRepositories({
      prisma: createFakePrismaClient(),
      workspaceId: "workspace_default"
    });
    const eventWithTask = {
      id: "run_event_task_scope",
      runId: "run_task_scope",
      projectId: "project_task_scope",
      taskId: "task_task_scope",
      sequence: 1,
      type: "status",
      message: "Scoped to a task",
      payload: { state: "running" },
      createdAt
    };

    await repositories.runEvents.save(eventWithTask);
    await repositories.runEvents.save({
      id: "run_event_task_scope",
      runId: "run_task_scope",
      projectId: "project_task_scope",
      sequence: 1,
      type: "status",
      message: "No longer scoped to a task",
      payload: { state: "running" },
      createdAt
    });

    await expect(repositories.runEvents.listForRun("run_task_scope")).resolves.toEqual([
      {
        id: "run_event_task_scope",
        runId: "run_task_scope",
        projectId: "project_task_scope",
        sequence: 1,
        type: "status",
        message: "No longer scoped to a task",
        payload: { state: "running" },
        createdAt
      }
    ]);
    await expect(repositories.runEvents.listForTask("task_task_scope")).resolves.toEqual([]);
  });

  it("persists Web-facing project state repositories", async () => {
    const repositories = createPrismaWorkbenchRepositories({
      prisma: createFakePrismaClient(),
      workspaceId: "workspace_default"
    });

    await repositories.projects.save({
      id: "project_web",
      name: "Web project",
      createdAt
    });
    await repositories.projectMembers.save({
      id: "member_web",
      projectId: "project_web",
      userId: "local-web-user",
      role: "owner",
      displayName: "Local user",
      createdAt,
      updatedAt: "2026-05-14T00:01:00.000Z"
    });
    await repositories.skills.save({
      id: "skill_web",
      name: "Deploy",
      type: "deployment",
      scope: "project",
      createdAt
    });
    await repositories.skillVersions.save({
      id: "skill_version_web",
      skillId: "skill_web",
      version: "1.0.0",
      manifest: {
        id: "skill_web",
        name: "Deploy",
        description: "Deploy landing pages",
        version: "1.0.0",
        type: "deployment",
        scope: "project",
        permissions: [],
        requiredSecrets: [],
        entrypoints: [],
        reviewState: "published",
        commands: []
      },
      content: "# Deploy",
      contentType: "text/markdown",
      reviewState: "published",
      createdAt
    });
    await repositories.skillBindings.save({
      id: "skill_binding_web",
      skillVersionId: "skill_version_web",
      scope: "project",
      targetKey: "project_web",
      projectId: "project_web",
      enabled: true,
      settings: { mode: "safe" },
      createdAt,
      updatedAt: "2026-05-14T00:01:00.000Z"
    });
    await repositories.modelProviders.save({
      id: "provider_web",
      scope: "project",
      targetKey: "project_web",
      name: "Primary",
      provider: "custom",
      config: {
        api: "openai-completions",
        baseUrl: "https://models.example.test",
        apiKeyEnv: "MODEL_API_KEY",
        models: [{ id: "gpt-5.4" }]
      },
      enabled: true,
      createdAt,
      updatedAt: "2026-05-14T00:01:00.000Z"
    });
    await repositories.modelRoutingPolicies.save({
      id: "route_web",
      scope: "project",
      targetKey: "project_web",
      role: "builder",
      providerId: "provider_web",
      model: "gpt-5.4",
      fallback: { providerId: "provider_backup", model: "gpt-5.4-mini" },
      settings: { temperature: 0.2 },
      createdAt,
      updatedAt: "2026-05-14T00:01:00.000Z"
    });
    await repositories.mcpConnectors.save({
      id: "connector_web",
      scope: "project",
      targetKey: "project_web",
      name: "Docs",
      description: "Read docs",
      tools: [
        {
          name: "search",
          description: "Search docs",
          permission: "read",
          roles: ["planner"],
          requiresApproval: false
        }
      ],
      enabled: true,
      createdAt,
      updatedAt: "2026-05-14T00:01:00.000Z"
    });
    await repositories.mcpToolApprovals.save({
      id: "approval_web",
      projectId: "project_web",
      connectorId: "connector_web",
      toolName: "search",
      state: "approved",
      approvedByUserId: "local-web-user",
      createdAt,
      updatedAt: "2026-05-14T00:01:00.000Z"
    });
    await repositories.deployments.save({
      id: "deployment_web",
      projectId: "project_web",
      pageVersionId: "page_version_web",
      branch: "lp/project-web",
      commitSha: "abc1234",
      pullRequestUrl: "https://github.example.test/lp/pulls/1",
      status: "pr_opened",
      files: ["index.html", "styles.css", "script.js"]
    });
    await repositories.deployments.save({
      id: "deployment_web_retry",
      projectId: "project_web",
      pageVersionId: "page_version_web",
      branch: "lp/project-web-retry",
      commitSha: "def5678",
      pullRequestUrl: "https://github.example.test/lp/pulls/2",
      status: "pr_opened",
      files: ["index.html", "styles.css", "script.js"]
    });

    await expect(repositories.projectMembers.listForProject("project_web")).resolves.toEqual([
      expect.objectContaining({ id: "member_web", userId: "local-web-user" })
    ]);
    await expect(
      repositories.projectMembers.getByProjectAndUser("project_web", "local-web-user")
    ).resolves.toMatchObject({ id: "member_web", role: "owner" });
    await expect(repositories.skills.getById("skill_web")).resolves.toMatchObject({
      id: "skill_web",
      name: "Deploy"
    });
    await expect(
      repositories.skillVersions.getBySkillIdAndVersion("skill_web", "1.0.0")
    ).resolves.toMatchObject({ id: "skill_version_web", content: "# Deploy" });
    await expect(repositories.skillBindings.listForProject("project_web")).resolves.toEqual([
      expect.objectContaining({ id: "skill_binding_web", settings: { mode: "safe" } })
    ]);
    await expect(repositories.modelProviders.listForProject("project_web")).resolves.toEqual([
      expect.objectContaining({ id: "provider_web", provider: "custom" })
    ]);
    await expect(
      repositories.modelRoutingPolicies.getByProjectAndRole("project_web", "builder")
    ).resolves.toMatchObject({ id: "route_web", model: "gpt-5.4" });
    await expect(repositories.modelRoutingPolicies.listForProject("project_web")).resolves.toEqual([
      expect.objectContaining({ id: "route_web", role: "builder" })
    ]);
    await expect(repositories.mcpConnectors.listForProject("project_web")).resolves.toEqual([
      expect.objectContaining({ id: "connector_web", name: "Docs" })
    ]);
    await expect(
      repositories.mcpToolApprovals.getByProjectConnectorAndTool(
        "project_web",
        "connector_web",
        "search"
      )
    ).resolves.toMatchObject({ id: "approval_web", state: "approved" });
    await expect(repositories.mcpToolApprovals.listForProject("project_web")).resolves.toEqual([
      expect.objectContaining({ id: "approval_web", toolName: "search" })
    ]);
    await expect(repositories.deployments.getByPageVersionId("page_version_web")).resolves.toEqual({
      id: "deployment_web",
      projectId: "project_web",
      pageVersionId: "page_version_web",
      branch: "lp/project-web-retry",
      commitSha: "def5678",
      pullRequestUrl: "https://github.example.test/lp/pulls/2",
      status: "pr_opened",
      files: ["index.html", "styles.css", "script.js"]
    });
    await expect(repositories.deployments.findLatestForProject("project_web")).resolves.toEqual({
      id: "deployment_web",
      projectId: "project_web",
      pageVersionId: "page_version_web",
      branch: "lp/project-web-retry",
      commitSha: "def5678",
      pullRequestUrl: "https://github.example.test/lp/pulls/2",
      status: "pr_opened",
      files: ["index.html", "styles.css", "script.js"]
    });
  });

  it("only leaves workspaceMembers unsupported in the Stage 23 Web path", async () => {
    const repositories = createPrismaWorkbenchRepositories({
      prisma: createFakePrismaClient(),
      workspaceId: "workspace_default"
    });

    await expect(repositories.workspaceMembers.listAll()).rejects.toThrow(
      "Prisma repository workspaceMembers is not implemented"
    );
    await expect(repositories.projectMembers.listAll()).resolves.toEqual([]);
    await expect(
      repositories.deployments.findLatestForProject("project_missing")
    ).resolves.toBeUndefined();
    await expect(repositories.skills.listAll()).resolves.toEqual([]);
    await expect(repositories.skillVersions.listAll()).resolves.toEqual([]);
    await expect(repositories.skillBindings.listAll()).resolves.toEqual([]);
    await expect(repositories.modelProviders.listAll()).resolves.toEqual([]);
    await expect(repositories.modelRoutingPolicies.listAll()).resolves.toEqual([]);
    await expect(repositories.mcpConnectors.listAll()).resolves.toEqual([]);
    await expect(repositories.mcpToolApprovals.listAll()).resolves.toEqual([]);
  });

  it("clears nullable JSON repository fields without writing a plain JSON null", async () => {
    const repositories = createPrismaWorkbenchRepositories({
      prisma: createFakePrismaClient({
        skillBinding: {
          rejectPlainNullJsonKeys: ["settings"]
        },
        modelRoutingPolicy: {
          rejectPlainNullJsonKeys: ["fallback", "settings"]
        }
      }),
      workspaceId: "workspace_default"
    });

    await repositories.skillBindings.save({
      id: "binding_json_clear",
      skillVersionId: "skill_version_json_clear",
      scope: "project",
      targetKey: "project_json_clear",
      projectId: "project_json_clear",
      enabled: true,
      settings: { mode: "safe" },
      createdAt,
      updatedAt: createdAt
    });
    await repositories.modelRoutingPolicies.save({
      id: "policy_json_clear",
      scope: "project",
      targetKey: "project_json_clear",
      role: "builder",
      providerId: "provider_json_clear",
      model: "gpt-5.4",
      fallback: { providerId: "provider_backup", model: "gpt-5.4-mini" },
      settings: { temperature: 0.2 },
      createdAt,
      updatedAt: createdAt
    });

    await expect(
      repositories.skillBindings.save({
        id: "binding_json_clear_replacement",
        skillVersionId: "skill_version_json_clear",
        scope: "project",
        targetKey: "project_json_clear",
        projectId: "project_json_clear",
        enabled: false,
        createdAt,
        updatedAt: "2026-05-14T00:02:00.000Z"
      })
    ).resolves.toBeUndefined();
    await expect(
      repositories.modelRoutingPolicies.save({
        id: "policy_json_clear_replacement",
        scope: "project",
        targetKey: "project_json_clear",
        role: "builder",
        providerId: "provider_json_clear",
        model: "gpt-5.4-mini",
        createdAt,
        updatedAt: "2026-05-14T00:02:00.000Z"
      })
    ).resolves.toBeUndefined();

    await expect(repositories.skillBindings.getById("binding_json_clear")).resolves.toEqual({
      id: "binding_json_clear",
      skillVersionId: "skill_version_json_clear",
      scope: "project",
      targetKey: "project_json_clear",
      projectId: "project_json_clear",
      enabled: false,
      createdAt,
      updatedAt: "2026-05-14T00:02:00.000Z"
    });
    await expect(repositories.modelRoutingPolicies.getById("policy_json_clear")).resolves.toEqual({
      id: "policy_json_clear",
      scope: "project",
      targetKey: "project_json_clear",
      role: "builder",
      providerId: "provider_json_clear",
      model: "gpt-5.4-mini",
      createdAt,
      updatedAt: "2026-05-14T00:02:00.000Z"
    });
  });

  it("does not match compound selectors when the selector name is wrong", async () => {
    const delegate = createFakeDelegate();

    await delegate.upsert({
      where: {
        scope_targetKey_role: {
          scope: "project",
          targetKey: "project_compound",
          role: "builder"
        }
      },
      create: {
        id: "policy_compound",
        scope: "project",
        targetKey: "project_compound",
        role: "builder"
      },
      update: {}
    });

    await expect(
      delegate.findUnique({
        where: {
          wrong_targetKey_role: {
            targetKey: "project_compound",
            role: "builder"
          }
        }
      })
    ).resolves.toBeNull();
  });
});

describe("createUnsupportedPrismaRepository", () => {
  it("fails fast with the Stage 22 unsupported repository message", async () => {
    const repository = createUnsupportedPrismaRepository<{ listAll(): Promise<unknown[]> }>(
      "skills"
    );

    await expect(repository.listAll()).rejects.toThrow(
      "Prisma repository skills is not implemented in Stage 22 foundation"
    );
  });
});

function createFakePrismaClient(options: FakePrismaClientOptions = {}) {
  return {
    project: createFakeDelegate({
      enforceUniqueId: true,
      uniqueIdError: (id) => `Prisma project ${id} belongs to a different workspace`,
      ...options.project
    }),
    workbenchTask: createFakeDelegate(),
    workbenchMessage: createFakeDelegate(),
    workbenchTaskSnapshot: createFakeDelegate(),
    lPBrief: createFakeDelegate(),
    pageVersion: createFakeDelegate(),
    artifactWorkspace: createFakeDelegate(),
    artifactWorkspaceFile: createFakeDelegate(),
    projectMember: createFakeDelegate(options.projectMember),
    deployment: createFakeDelegate(options.deployment),
    run: createFakeDelegate(),
    runEvent: createFakeDelegate(),
    toolObservation: createFakeDelegate(),
    skill: createFakeDelegate(options.skill),
    skillVersion: createFakeDelegate(options.skillVersion),
    skillBinding: createFakeDelegate(options.skillBinding),
    modelProvider: createFakeDelegate(options.modelProvider),
    modelRoutingPolicy: createFakeDelegate(options.modelRoutingPolicy),
    mCPConnector: createFakeDelegate(options.mCPConnector),
    mCPToolApproval: createFakeDelegate(options.mCPToolApproval),
    agentHandoff: createFakeDelegate(options.agentHandoff)
  };
}

function createFakeDelegate(options: FakeDelegateOptions = {}): FakeDelegate {
  const rows: FakeRow[] = [];

  return {
    async upsert(input) {
      options.beforeUpsert?.({ input, rows });
      options.onUpsert?.(input);
      rejectPlainJsonNulls(input.create, options.rejectPlainNullJsonKeys ?? []);
      rejectPlainJsonNulls(input.update, options.rejectPlainNullJsonKeys ?? []);

      const existingIndex = rows.findIndex((row) => matchesWhere(row, input.where));
      if (existingIndex >= 0) {
        const existing = rows[existingIndex];
        rows[existingIndex] = cloneRow({
          ...existing,
          ...normalizeFakePrismaJsonNulls(input.update)
        });
        return cloneRow(rows[existingIndex]);
      }

      if (options.enforceUniqueId && typeof input.create.id === "string") {
        const duplicateId = rows.some((row) => row.id === input.create.id);
        if (duplicateId) {
          throw new Error(
            options.uniqueIdError?.(input.create.id) ?? `Duplicate id ${input.create.id}`
          );
        }
      }

      const created = cloneRow(normalizeFakePrismaJsonNulls(input.create));
      rows.push(created);
      return cloneRow(created);
    },

    async findUnique(input) {
      const row = rows.find((candidate) => matchesWhere(candidate, input.where));
      return row ? cloneRow(row) : null;
    },

    async findMany(input = {}) {
      const where = input.where ?? {};
      const orderBy = input.orderBy ?? [];
      const matchingRows = rows
        .filter((row) => matchesWhere(row, where))
        .sort((left, right) => compareRows(left, right, orderBy));
      const limitedRows =
        input.take === undefined ? matchingRows : matchingRows.slice(0, input.take);

      return limitedRows.map(cloneRow);
    }
  };
}

function rejectPlainJsonNulls(row: FakeRow, keys: string[]): void {
  for (const key of keys) {
    if (row[key] === null) {
      throw new Error(`Plain JSON null write is not supported for ${key}`);
    }
  }
}

function matchesWhere(row: FakeRow, where: FakeWhere): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (isRecord(expected)) {
      const nestedKeys = Object.keys(expected);
      if (key !== nestedKeys.join("_")) {
        return false;
      }

      return Object.entries(expected).every(
        ([nestedKey, nestedExpected]) => row[nestedKey] === nestedExpected
      );
    }

    return row[key] === expected;
  });
}

function normalizeFakePrismaJsonNulls(row: FakeRow): FakeRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value === objectEnumValues.instances.DbNull ? null : value
    ])
  );
}

function compareRows(left: FakeRow, right: FakeRow, orderBy: FakeOrderBy): number {
  for (const order of orderBy) {
    const entries = Object.entries(order);
    const [field, direction] = entries[0] ?? [];
    if (!field || !direction) {
      continue;
    }

    const compared = compareValues(left[field], right[field]);
    if (compared !== 0) {
      return direction === "asc" ? compared : -compared;
    }
  }

  return 0;
}

function compareValues(left: unknown, right: unknown): number {
  const normalizedLeft = normalizeComparableValue(left);
  const normalizedRight = normalizeComparableValue(right);

  if (normalizedLeft < normalizedRight) {
    return -1;
  }
  if (normalizedLeft > normalizedRight) {
    return 1;
  }
  return 0;
}

function normalizeComparableValue(value: unknown): number | string {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number" || typeof value === "string") {
    return value;
  }
  return "";
}

function cloneRow(row: FakeRow | undefined): FakeRow {
  return structuredClone(row ?? {});
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
