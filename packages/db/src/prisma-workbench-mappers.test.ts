import { describe, expect, it } from "vitest";
import type {
  AgentHandoffRecord,
  MCPConnectorRecord,
  MCPToolApprovalRecord,
  ModelProviderRecord,
  ModelRoutingPolicyRecord,
  ProjectMemberRecord,
  ProjectRecord,
  RunEventRecord,
  RunRecord,
  SkillBindingRecord,
  SkillRecord,
  SkillVersionRecord
} from "./workbench-repositories";
import {
  toPrismaMCPConnectorCreate,
  toPrismaMCPToolApprovalCreate,
  toPrismaModelProviderCreate,
  toPrismaModelRoutingPolicyCreate,
  toPrismaProjectMemberCreate,
  toPrismaSkillBindingCreate,
  toPrismaSkillCreate,
  toPrismaSkillVersionCreate,
  toPrismaAgentHandoffCreate,
  toPrismaProjectCreate,
  toPrismaRunCreate,
  toPrismaRunEventCreate,
  toRepositoryDeployment,
  toRepositoryMCPConnector,
  toRepositoryMCPToolApproval,
  toRepositoryModelProvider,
  toRepositoryModelRoutingPolicy,
  toRepositoryProjectMember,
  toRepositorySkill,
  toRepositorySkillBinding,
  toRepositorySkillVersion,
  toRepositoryAgentHandoff,
  toRepositoryProject,
  toRepositoryRun,
  toRepositoryRunEvent,
  type PrismaProjectRow
} from "./prisma-workbench-mappers";

describe("prisma workbench mappers", () => {
  it("maps projects through a workspace id and converts createdAt dates", () => {
    const project: ProjectRecord = {
      id: "project_1",
      name: "Spring sale",
      createdAt: "2026-05-12T00:00:00.000Z"
    };

    expect(toPrismaProjectCreate(project, "workspace_1")).toEqual({
      id: "project_1",
      workspaceId: "workspace_1",
      name: "Spring sale",
      createdAt: new Date("2026-05-12T00:00:00.000Z")
    });

    const row: PrismaProjectRow = {
      id: "project_1",
      workspaceId: "workspace_1",
      name: "Spring sale",
      createdAt: new Date("2026-05-12T00:00:00.000Z")
    };

    expect(toRepositoryProject(row)).toEqual(project);
  });

  it("maps run context summaries without sharing arrays", () => {
    const run: RunRecord = {
      id: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "planner",
      state: "running",
      startedAt: "2026-05-12T00:00:00.000Z",
      completedAt: "2026-05-12T00:01:00.000Z",
      contextSummary: {
        injected: ["brief", "skills"],
        omitted: ["large_artifact"]
      }
    };

    const create = toPrismaRunCreate(run);
    run.contextSummary.injected.push("mutated");

    expect(create).toEqual({
      id: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "planner",
      state: "running",
      startedAt: new Date("2026-05-12T00:00:00.000Z"),
      completedAt: new Date("2026-05-12T00:01:00.000Z"),
      contextSummary: {
        injected: ["brief", "skills"],
        omitted: ["large_artifact"]
      }
    });
    expect(create.contextSummary.injected).not.toBe(run.contextSummary.injected);

    const mapped = toRepositoryRun({
      ...create,
      contextSummary: {
        injected: ["brief", "skills"],
        omitted: ["large_artifact"]
      }
    });
    const rowContext = {
      injected: ["brief"],
      omitted: ["large_artifact"]
    };
    const mappedFromRow = toRepositoryRun({
      ...create,
      contextSummary: rowContext
    });
    rowContext.injected.push("mutated");

    expect(mapped).toEqual({
      id: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "planner",
      state: "running",
      startedAt: "2026-05-12T00:00:00.000Z",
      completedAt: "2026-05-12T00:01:00.000Z",
      contextSummary: {
        injected: ["brief", "skills"],
        omitted: ["large_artifact"]
      }
    });
    expect(mappedFromRow.contextSummary).toEqual({
      injected: ["brief"],
      omitted: ["large_artifact"]
    });
    expect(toRepositoryRun({ ...create, contextSummary: "invalid" }).contextSummary).toEqual({
      injected: [],
      omitted: []
    });
  });

  it("maps run event payloads defensively", () => {
    const event: RunEventRecord = {
      id: "event_1",
      runId: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      sequence: 1,
      type: "message",
      message: "Started",
      payload: {
        nested: {
          step: "context"
        }
      },
      createdAt: "2026-05-12T00:00:00.000Z"
    };

    const create = toPrismaRunEventCreate(event);
    (event.payload.nested as { step: string }).step = "mutated";

    expect(create).toEqual({
      id: "event_1",
      runId: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      sequence: 1,
      type: "message",
      message: "Started",
      payload: {
        nested: {
          step: "context"
        }
      },
      createdAt: new Date("2026-05-12T00:00:00.000Z")
    });

    const mapped = toRepositoryRunEvent(create);
    (create.payload.nested as { step: string }).step = "mutated";

    expect(mapped).toEqual({
      id: "event_1",
      runId: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      sequence: 1,
      type: "message",
      message: "Started",
      payload: {
        nested: {
          step: "context"
        }
      },
      createdAt: "2026-05-12T00:00:00.000Z"
    });
    expect(toRepositoryRunEvent({ ...create, payload: "invalid" }).payload).toEqual({});
  });

  it("maps handoff artifact refs as optional JSON", () => {
    const handoff: AgentHandoffRecord = {
      id: "handoff_1",
      projectId: "project_1",
      taskId: "task_1",
      fromRunId: "run_1",
      fromRole: "planner",
      toRole: "builder",
      state: "blocked",
      summary: "Needs assets",
      blockingReason: "Missing product images",
      artifactRefs: {
        briefId: "brief_1",
        pageVersionId: "version_1"
      },
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:01:00.000Z"
    };

    const create = toPrismaAgentHandoffCreate(handoff);
    handoff.artifactRefs!.briefId = "mutated";

    expect(create).toEqual({
      id: "handoff_1",
      projectId: "project_1",
      taskId: "task_1",
      fromRunId: "run_1",
      fromRole: "planner",
      toRole: "builder",
      state: "blocked",
      summary: "Needs assets",
      blockingReason: "Missing product images",
      artifactRefs: {
        briefId: "brief_1",
        pageVersionId: "version_1"
      },
      createdAt: new Date("2026-05-12T00:00:00.000Z"),
      updatedAt: new Date("2026-05-12T00:01:00.000Z")
    });

    const mapped = toRepositoryAgentHandoff({
      ...create,
      taskId: null,
      blockingReason: null
    });
    (create.artifactRefs as { briefId: string }).briefId = "mutated";

    expect(mapped).toEqual({
      id: "handoff_1",
      projectId: "project_1",
      fromRunId: "run_1",
      fromRole: "planner",
      toRole: "builder",
      state: "blocked",
      summary: "Needs assets",
      artifactRefs: {
        briefId: "brief_1",
        pageVersionId: "version_1"
      },
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:01:00.000Z"
    });
    expect(
      toPrismaAgentHandoffCreate({
        ...handoff,
        taskId: undefined,
        blockingReason: undefined,
        artifactRefs: undefined
      })
    ).toEqual({
      id: "handoff_1",
      projectId: "project_1",
      fromRunId: "run_1",
      fromRole: "planner",
      toRole: "builder",
      state: "blocked",
      summary: "Needs assets",
      createdAt: new Date("2026-05-12T00:00:00.000Z"),
      updatedAt: new Date("2026-05-12T00:01:00.000Z")
    });
    expect(toRepositoryAgentHandoff({ ...create, artifactRefs: null })).not.toHaveProperty(
      "artifactRefs"
    );
    expect(toRepositoryAgentHandoff({ ...create, artifactRefs: "invalid" })).not.toHaveProperty(
      "artifactRefs"
    );
  });

  it("maps project members with display name and updated timestamp", () => {
    const member: ProjectMemberRecord = {
      id: "member_1",
      projectId: "project_1",
      userId: "user_1",
      role: "reviewer",
      displayName: "Ada Lovelace",
      createdAt: "2026-05-20T00:00:00.000Z",
      updatedAt: "2026-05-20T00:01:00.000Z"
    };

    const create = toPrismaProjectMemberCreate(member);

    expect(create).toEqual({
      id: "member_1",
      projectId: "project_1",
      userId: "user_1",
      role: "reviewer",
      displayName: "Ada Lovelace",
      createdAt: new Date("2026-05-20T00:00:00.000Z"),
      updatedAt: new Date("2026-05-20T00:01:00.000Z")
    });
    expect(toRepositoryProjectMember(create)).toEqual(member);
    expect(toPrismaProjectMemberCreate({ ...member, displayName: undefined })).not.toHaveProperty(
      "displayName"
    );
    expect(toRepositoryProjectMember({ ...create, displayName: null })).not.toHaveProperty(
      "displayName"
    );
  });

  it("maps skill records and preserves content type", () => {
    const skill: SkillRecord = {
      id: "skill_1",
      name: "Landing page reviewer",
      type: "workflow",
      scope: "project",
      createdAt: "2026-05-20T00:00:00.000Z"
    };
    const version: SkillVersionRecord = {
      id: "skill_version_1",
      skillId: "skill_1",
      version: "1.0.0",
      manifest: {
        id: "skill_1",
        name: "Landing page reviewer",
        version: "1.0.0",
        type: "workflow",
        scope: "project",
        description: "Reviews landing pages.",
        permissions: ["review:read"],
        requiredSecrets: [],
        entrypoints: [],
        reviewState: "validated"
      },
      content: "# Reviewer",
      contentType: "text/plain",
      reviewState: "validated",
      createdAt: "2026-05-20T00:01:00.000Z"
    };
    const binding: SkillBindingRecord = {
      id: "skill_binding_1",
      skillVersionId: "skill_version_1",
      scope: "project",
      targetKey: "project_1",
      projectId: "project_1",
      enabled: true,
      settings: {
        severity: "blocking"
      },
      createdAt: "2026-05-20T00:02:00.000Z",
      updatedAt: "2026-05-20T00:03:00.000Z"
    };

    const versionCreate = toPrismaSkillVersionCreate(version);
    const bindingCreate = toPrismaSkillBindingCreate(binding);
    version.manifest.description = "mutated";
    binding.settings!.severity = "mutated";

    expect(toPrismaSkillCreate(skill)).toEqual({
      id: "skill_1",
      name: "Landing page reviewer",
      type: "workflow",
      scope: "project",
      createdAt: new Date("2026-05-20T00:00:00.000Z")
    });
    expect(toRepositorySkill(toPrismaSkillCreate(skill))).toEqual(skill);
    expect(versionCreate).toEqual({
      id: "skill_version_1",
      skillId: "skill_1",
      version: "1.0.0",
      manifest: {
        id: "skill_1",
        name: "Landing page reviewer",
        version: "1.0.0",
        type: "workflow",
        scope: "project",
        description: "Reviews landing pages.",
        permissions: ["review:read"],
        requiredSecrets: [],
        entrypoints: [],
        reviewState: "validated"
      },
      content: "# Reviewer",
      contentType: "text/plain",
      reviewState: "validated",
      createdAt: new Date("2026-05-20T00:01:00.000Z")
    });
    expect(toRepositorySkillVersion(versionCreate)).toEqual({
      ...version,
      manifest: {
        id: "skill_1",
        name: "Landing page reviewer",
        version: "1.0.0",
        type: "workflow",
        scope: "project",
        description: "Reviews landing pages.",
        permissions: ["review:read"],
        requiredSecrets: [],
        entrypoints: [],
        reviewState: "validated"
      }
    });
    expect(bindingCreate).toEqual({
      id: "skill_binding_1",
      skillVersionId: "skill_version_1",
      scope: "project",
      targetKey: "project_1",
      projectId: "project_1",
      enabled: true,
      settings: {
        severity: "blocking"
      },
      createdAt: new Date("2026-05-20T00:02:00.000Z"),
      updatedAt: new Date("2026-05-20T00:03:00.000Z")
    });
    expect(toRepositorySkillBinding(bindingCreate)).toEqual({
      ...binding,
      settings: {
        severity: "blocking"
      }
    });
    expect(toPrismaSkillBindingCreate({ ...binding, settings: undefined })).not.toHaveProperty(
      "settings"
    );
    expect(toRepositorySkillBinding({ ...bindingCreate, settings: null })).not.toHaveProperty(
      "settings"
    );
  });

  it("maps model routes with fallback and settings JSON", () => {
    const provider: ModelProviderRecord = {
      id: "provider_1",
      scope: "project",
      targetKey: "project_1",
      name: "OpenAI",
      provider: "openai",
      config: {
        api: "openai-completions",
        models: [
          {
            id: "gpt-test",
            maxTokens: 2048
          }
        ]
      },
      enabled: true,
      createdAt: "2026-05-20T00:00:00.000Z",
      updatedAt: "2026-05-20T00:01:00.000Z"
    };
    const policy: ModelRoutingPolicyRecord = {
      id: "policy_1",
      scope: "project",
      targetKey: "project_1",
      role: "builder",
      providerId: "provider_1",
      model: "gpt-test",
      fallback: {
        providerId: "provider_fallback",
        model: "gpt-fallback"
      },
      settings: {
        maxTokens: 2048
      },
      createdAt: "2026-05-20T00:02:00.000Z",
      updatedAt: "2026-05-20T00:03:00.000Z"
    };

    const providerCreate = toPrismaModelProviderCreate(provider);
    const policyCreate = toPrismaModelRoutingPolicyCreate(policy);
    provider.config.models![0]!.id = "mutated";
    policy.fallback!.model = "mutated";
    policy.settings!.maxTokens = 1;

    expect(providerCreate).toEqual({
      id: "provider_1",
      scope: "project",
      targetKey: "project_1",
      name: "OpenAI",
      provider: "openai",
      config: {
        api: "openai-completions",
        models: [
          {
            id: "gpt-test",
            maxTokens: 2048
          }
        ]
      },
      enabled: true,
      createdAt: new Date("2026-05-20T00:00:00.000Z"),
      updatedAt: new Date("2026-05-20T00:01:00.000Z")
    });
    expect(toRepositoryModelProvider(providerCreate)).toEqual({
      ...provider,
      config: {
        api: "openai-completions",
        models: [
          {
            id: "gpt-test",
            maxTokens: 2048
          }
        ]
      }
    });
    expect(policyCreate).toEqual({
      id: "policy_1",
      scope: "project",
      targetKey: "project_1",
      role: "builder",
      providerId: "provider_1",
      model: "gpt-test",
      fallback: {
        providerId: "provider_fallback",
        model: "gpt-fallback"
      },
      settings: {
        maxTokens: 2048
      },
      createdAt: new Date("2026-05-20T00:02:00.000Z"),
      updatedAt: new Date("2026-05-20T00:03:00.000Z")
    });
    expect(toRepositoryModelRoutingPolicy(policyCreate)).toEqual({
      ...policy,
      fallback: {
        providerId: "provider_fallback",
        model: "gpt-fallback"
      },
      settings: {
        maxTokens: 2048
      }
    });
    expect(toPrismaModelRoutingPolicyCreate({ ...policy, fallback: undefined })).not.toHaveProperty(
      "fallback"
    );
    expect(toRepositoryModelRoutingPolicy({ ...policyCreate, settings: null })).not.toHaveProperty(
      "settings"
    );
  });

  it("maps MCP connector tools and approvals", () => {
    const connector: MCPConnectorRecord = {
      id: "connector_1",
      scope: "project",
      targetKey: "project_1",
      name: "Assets",
      description: "Internal asset tools",
      tools: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["planner", "builder"],
          requiresApproval: false,
          readOnly: true
        }
      ],
      enabled: true,
      createdAt: "2026-05-20T00:00:00.000Z",
      updatedAt: "2026-05-20T00:01:00.000Z"
    };
    const approval: MCPToolApprovalRecord = {
      id: "approval_1",
      projectId: "project_1",
      connectorId: "connector_1",
      toolName: "searchAssets",
      state: "approved",
      approvedByUserId: "user_1",
      createdAt: "2026-05-20T00:02:00.000Z",
      updatedAt: "2026-05-20T00:03:00.000Z"
    };

    const connectorCreate = toPrismaMCPConnectorCreate(connector);
    connector.tools[0]!.name = "mutated";

    expect(connectorCreate).toEqual({
      id: "connector_1",
      scope: "project",
      targetKey: "project_1",
      name: "Assets",
      description: "Internal asset tools",
      toolsJson: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["planner", "builder"],
          requiresApproval: false,
          readOnly: true
        }
      ],
      enabled: true,
      createdAt: new Date("2026-05-20T00:00:00.000Z"),
      updatedAt: new Date("2026-05-20T00:01:00.000Z")
    });
    expect(toRepositoryMCPConnector(connectorCreate)).toEqual({
      ...connector,
      tools: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["planner", "builder"],
          requiresApproval: false,
          readOnly: true
        }
      ]
    });
    expect(toPrismaMCPToolApprovalCreate(approval)).toEqual({
      id: "approval_1",
      projectId: "project_1",
      connectorId: "connector_1",
      toolName: "searchAssets",
      state: "approved",
      approvedByUserId: "user_1",
      createdAt: new Date("2026-05-20T00:02:00.000Z"),
      updatedAt: new Date("2026-05-20T00:03:00.000Z")
    });
    expect(toRepositoryMCPToolApproval(toPrismaMCPToolApprovalCreate(approval))).toEqual(approval);
    expect(toPrismaMCPConnectorCreate({ ...connector, description: undefined })).not.toHaveProperty(
      "description"
    );
    expect(
      toRepositoryMCPToolApproval({ ...toPrismaMCPToolApprovalCreate(approval), approvedByUserId: null })
    ).not.toHaveProperty("approvedByUserId");
  });

  it("maps deployment handoffs with fixed static file tuple", () => {
    const row = {
      id: "deployment_1",
      projectId: "project_1",
      pageVersionId: "version_1",
      branch: "lp-agent/project_1/version_1",
      commitSha: "mock_commit_1",
      pullRequestUrl: "https://git.example.local/pr/deployment_1",
      status: "pr_opened" as const,
      files: ["index.html", "styles.css", "script.js"],
      createdAt: new Date("2026-05-20T00:00:00.000Z")
    };

    expect(toRepositoryDeployment(row)).toEqual({
      id: "deployment_1",
      projectId: "project_1",
      pageVersionId: "version_1",
      branch: "lp-agent/project_1/version_1",
      commitSha: "mock_commit_1",
      pullRequestUrl: "https://git.example.local/pr/deployment_1",
      files: ["index.html", "styles.css", "script.js"],
      status: "pr_opened"
    });
  });
});
