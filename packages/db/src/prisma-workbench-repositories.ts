import type {
  ArtifactWorkspaceFilePath,
  ArtifactWorkspaceFileRecord,
  ArtifactWorkspaceRecord
} from "@lp-agent/artifacts";
import {
  toPrismaAgentHandoffCreate,
  toPrismaDeploymentCreate,
  toPrismaMCPConnectorCreate,
  toPrismaMCPToolApprovalCreate,
  toPrismaModelProviderCreate,
  toPrismaModelRoutingPolicyCreate,
  toPrismaProjectCreate,
  toPrismaProjectMemberCreate,
  toPrismaRunCreate,
  toPrismaRunEventCreate,
  toPrismaSkillBindingCreate,
  toPrismaSkillCreate,
  toPrismaSkillVersionCreate,
  toRepositoryAgentHandoff,
  toRepositoryDeployment,
  toRepositoryMCPConnector,
  toRepositoryMCPToolApproval,
  toRepositoryModelProvider,
  toRepositoryModelRoutingPolicy,
  toRepositoryProject,
  toRepositoryProjectMember,
  toRepositoryRun,
  toRepositoryRunEvent,
  toRepositorySkill,
  toRepositorySkillBinding,
  toRepositorySkillVersion,
  type PrismaAgentHandoffRow,
  type PrismaDeploymentRow,
  type PrismaMCPConnectorRow,
  type PrismaMCPToolApprovalRow,
  type PrismaModelProviderRow,
  type PrismaModelRoutingPolicyRow,
  type PrismaProjectRow,
  type PrismaProjectMemberRow,
  type PrismaRunEventRow,
  type PrismaRunRow,
  type PrismaSkillBindingRow,
  type PrismaSkillRow,
  type PrismaSkillVersionRow
} from "./prisma-workbench-mappers";
import type {
  AgentHandoffRecord,
  AgentHandoffRepository,
  ArtifactWorkspaceFileRepository,
  ArtifactWorkspaceRepository,
  BriefRecord,
  BriefRepository,
  DeploymentRepository,
  MCPConnectorRepository,
  MCPToolApprovalRepository,
  ModelProviderRepository,
  ModelRoutingPolicyRepository,
  PageVersionRecord,
  PageVersionRepository,
  ProjectMemberRepository,
  ProjectRepository,
  RunEventRepository,
  RunRepository,
  SkillBindingRepository,
  SkillRepository,
  SkillVersionRepository,
  ToolObservationRecord,
  ToolObservationRepository,
  WorkbenchMessageRecord,
  WorkbenchMessageRepository,
  WorkbenchRepositories,
  WorkbenchTaskRecord,
  WorkbenchTaskRepository,
  WorkbenchTaskSnapshotRecord,
  WorkbenchTaskSnapshotRepository,
  WorkspaceMemberRepository
} from "./workbench-repositories";

export type PrismaWhere = Record<string, unknown>;
export type PrismaOrderBy = Array<Record<string, "asc" | "desc">>;

type PrismaRow = Record<string, unknown>;

export interface PrismaDelegate {
  upsert(input: { where: PrismaWhere; create: PrismaRow; update: PrismaRow }): Promise<PrismaRow>;
  findUnique(input: { where: PrismaWhere }): Promise<PrismaRow | null>;
  findMany(input?: {
    where?: PrismaWhere;
    orderBy?: PrismaOrderBy;
    take?: number;
  }): Promise<PrismaRow[]>;
}

export interface PrismaWorkbenchClient {
  project: PrismaDelegate;
  projectMember: PrismaDelegate;
  workbenchTask: PrismaDelegate;
  workbenchMessage: PrismaDelegate;
  workbenchTaskSnapshot: PrismaDelegate;
  lPBrief: PrismaDelegate;
  pageVersion: PrismaDelegate;
  artifactWorkspace: PrismaDelegate;
  artifactWorkspaceFile: PrismaDelegate;
  deployment: PrismaDelegate;
  skill: PrismaDelegate;
  skillVersion: PrismaDelegate;
  skillBinding: PrismaDelegate;
  modelProvider: PrismaDelegate;
  modelRoutingPolicy: PrismaDelegate;
  mCPConnector: PrismaDelegate;
  mCPToolApproval: PrismaDelegate;
  run: PrismaDelegate;
  runEvent: PrismaDelegate;
  toolObservation: PrismaDelegate;
  agentHandoff: PrismaDelegate;
}

export interface PrismaWorkbenchRepositoriesOptions {
  prisma: PrismaWorkbenchClient;
  workspaceId: string;
}

const ORDER_CREATED_ID_ASC: PrismaOrderBy = [{ createdAt: "asc" }, { id: "asc" }];
const ORDER_CREATED_ID_DESC: PrismaOrderBy = [{ createdAt: "desc" }, { id: "desc" }];
const ORDER_UPDATED_ID_ASC: PrismaOrderBy = [{ updatedAt: "asc" }, { id: "asc" }];
const ORDER_STARTED_ID_ASC: PrismaOrderBy = [{ startedAt: "asc" }, { id: "asc" }];
const ORDER_BRIEF_LATEST: PrismaOrderBy = [{ createdAt: "desc" }, { id: "desc" }];
const ORDER_RUN_EVENT_SEQUENCE: PrismaOrderBy = [
  { sequence: "asc" },
  { createdAt: "asc" },
  { id: "asc" }
];
const ORDER_RUN_EVENT_TIMELINE: PrismaOrderBy = [
  { createdAt: "asc" },
  { runId: "asc" },
  { sequence: "asc" },
  { id: "asc" }
];
const ORDER_TOOL_OBSERVATION_TIMELINE: PrismaOrderBy = [
  { createdAt: "asc" },
  { runId: "asc" },
  { id: "asc" }
];
const ORDER_AGENT_HANDOFF_TIMELINE: PrismaOrderBy = [
  { updatedAt: "asc" },
  { createdAt: "asc" },
  { id: "asc" }
];
const ORDER_ARTIFACT_FILE_TIMELINE: PrismaOrderBy = [
  { createdAt: "asc" },
  { path: "asc" },
  { id: "asc" }
];

export function createPrismaWorkbenchRepositories(
  options: PrismaWorkbenchRepositoriesOptions
): WorkbenchRepositories {
  return {
    projects: createProjectRepository(options.prisma.project, options.workspaceId),
    workspaceMembers: createUnsupportedPrismaRepository<WorkspaceMemberRepository>(
      "workspaceMembers"
    ),
    projectMembers: createProjectMemberRepository(options.prisma.projectMember),
    briefs: createBriefRepository(options.prisma.lPBrief),
    pageVersions: createPageVersionRepository(options.prisma.pageVersion),
    artifactWorkspaces: createArtifactWorkspaceRepository(options.prisma.artifactWorkspace),
    artifactWorkspaceFiles: createArtifactWorkspaceFileRepository(
      options.prisma.artifactWorkspaceFile
    ),
    deployments: createDeploymentRepository(options.prisma.deployment),
    tasks: createWorkbenchTaskRepository(options.prisma.workbenchTask),
    messages: createWorkbenchMessageRepository(options.prisma.workbenchMessage),
    taskSnapshots: createWorkbenchTaskSnapshotRepository(options.prisma.workbenchTaskSnapshot),
    skills: createSkillRepository(options.prisma.skill),
    skillVersions: createSkillVersionRepository(options.prisma.skillVersion),
    skillBindings: createSkillBindingRepository(options.prisma.skillBinding),
    modelProviders: createModelProviderRepository(options.prisma.modelProvider),
    modelRoutingPolicies: createModelRoutingPolicyRepository(options.prisma.modelRoutingPolicy),
    mcpConnectors: createMCPConnectorRepository(options.prisma.mCPConnector),
    mcpToolApprovals: createMCPToolApprovalRepository(options.prisma.mCPToolApproval),
    runs: createRunRepository(options.prisma.run),
    runEvents: createRunEventRepository(options.prisma.runEvent),
    toolObservations: createToolObservationRepository(options.prisma.toolObservation),
    agentHandoffs: createAgentHandoffRepository(options.prisma.agentHandoff)
  };
}

export function createUnsupportedPrismaRepository<TRepository extends object = Record<string, unknown>>(
  name: string
): TRepository {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") {
          return undefined;
        }

        return async () => {
          throw new Error(`Prisma repository ${name} is not implemented in Stage 22 foundation`);
        };
      }
    }
  ) as TRepository;
}

function createProjectRepository(delegate: PrismaDelegate, workspaceId: string): ProjectRepository {
  return {
    async save(project) {
      const data = toPrismaProjectCreate(project, workspaceId);
      await upsert(delegate, { id: project.id, workspaceId }, data, ["id", "workspaceId"]);
    },

    async getById(projectId) {
      const rows = await delegate.findMany({
        where: { id: projectId, workspaceId },
        take: 1
      });
      return mapOptional(
        rows[0],
        (row) => toRepositoryProject(row as unknown as PrismaProjectRow)
      );
    },

    async listAll() {
      return mapRows(
        await delegate.findMany({
          where: { workspaceId },
          orderBy: ORDER_CREATED_ID_ASC
        }),
        (row) => toRepositoryProject(row as unknown as PrismaProjectRow)
      );
    }
  };
}

function createProjectMemberRepository(delegate: PrismaDelegate): ProjectMemberRepository {
  return {
    async save(member) {
      await upsert(
        delegate,
        { projectId_userId: { projectId: member.projectId, userId: member.userId } },
        toPrismaProjectMemberCreate(member),
        ["id", "projectId", "userId"],
        ["displayName"]
      );
    },

    async getById(memberId) {
      return mapOptional(
        await delegate.findUnique({ where: { id: memberId } }),
        (row) => toRepositoryProjectMember(row as unknown as PrismaProjectMemberRow)
      );
    },

    async getByProjectAndUser(projectId, userId) {
      return mapOptional(
        await delegate.findUnique({
          where: { projectId_userId: { projectId, userId } }
        }),
        (row) => toRepositoryProjectMember(row as unknown as PrismaProjectMemberRow)
      );
    },

    async listForProject(projectId) {
      return mapRows(
        await delegate.findMany({
          where: { projectId },
          orderBy: ORDER_UPDATED_ID_ASC
        }),
        (row) => toRepositoryProjectMember(row as unknown as PrismaProjectMemberRow)
      );
    },

    async listAll() {
      return mapRows(await delegate.findMany({ orderBy: ORDER_UPDATED_ID_ASC }), (row) =>
        toRepositoryProjectMember(row as unknown as PrismaProjectMemberRow)
      );
    }
  };
}

function createDeploymentRepository(delegate: PrismaDelegate): DeploymentRepository {
  return {
    async save(deployment) {
      await upsert(
        delegate,
        { pageVersionId: deployment.pageVersionId },
        toPrismaDeploymentCreate(deployment),
        ["id", "pageVersionId"]
      );
    },

    async getByPageVersionId(pageVersionId) {
      return mapOptional(
        await delegate.findUnique({ where: { pageVersionId } }),
        (row) => toRepositoryDeployment(row as unknown as PrismaDeploymentRow)
      );
    },

    async findLatestForProject(projectId) {
      const rows = await delegate.findMany({
        where: { projectId },
        orderBy: ORDER_CREATED_ID_DESC,
        take: 1
      });
      return mapOptional(rows[0], (row) =>
        toRepositoryDeployment(row as unknown as PrismaDeploymentRow)
      );
    }
  };
}

function createSkillRepository(delegate: PrismaDelegate): SkillRepository {
  return {
    async save(skill) {
      await upsert(delegate, { id: skill.id }, toPrismaSkillCreate(skill));
    },

    async getById(skillId) {
      return mapOptional(
        await delegate.findUnique({ where: { id: skillId } }),
        (row) => toRepositorySkill(row as unknown as PrismaSkillRow)
      );
    },

    async listAll() {
      return mapRows(await delegate.findMany({ orderBy: ORDER_CREATED_ID_ASC }), (row) =>
        toRepositorySkill(row as unknown as PrismaSkillRow)
      );
    }
  };
}

function createSkillVersionRepository(delegate: PrismaDelegate): SkillVersionRepository {
  return {
    async save(version) {
      await upsert(
        delegate,
        { skillId_version: { skillId: version.skillId, version: version.version } },
        toPrismaSkillVersionCreate(version),
        ["id", "skillId", "version"]
      );
    },

    async getById(versionId) {
      return mapOptional(
        await delegate.findUnique({ where: { id: versionId } }),
        (row) => toRepositorySkillVersion(row as unknown as PrismaSkillVersionRow)
      );
    },

    async getBySkillIdAndVersion(skillId, version) {
      return mapOptional(
        await delegate.findUnique({ where: { skillId_version: { skillId, version } } }),
        (row) => toRepositorySkillVersion(row as unknown as PrismaSkillVersionRow)
      );
    },

    async listForSkill(skillId) {
      return mapRows(
        await delegate.findMany({
          where: { skillId },
          orderBy: ORDER_CREATED_ID_ASC
        }),
        (row) => toRepositorySkillVersion(row as unknown as PrismaSkillVersionRow)
      );
    },

    async listAll() {
      return mapRows(await delegate.findMany({ orderBy: ORDER_CREATED_ID_ASC }), (row) =>
        toRepositorySkillVersion(row as unknown as PrismaSkillVersionRow)
      );
    }
  };
}

function createSkillBindingRepository(delegate: PrismaDelegate): SkillBindingRepository {
  return {
    async save(binding) {
      await upsert(
        delegate,
        {
          skillVersionId_scope_targetKey: {
            skillVersionId: binding.skillVersionId,
            scope: binding.scope,
            targetKey: binding.targetKey
          }
        },
        toPrismaSkillBindingCreate(binding),
        ["id", "skillVersionId", "scope", "targetKey"],
        ["organizationId", "workspaceId", "projectId", "settings"]
      );
    },

    async getById(bindingId) {
      return mapOptional(
        await delegate.findUnique({ where: { id: bindingId } }),
        (row) => toRepositorySkillBinding(row as unknown as PrismaSkillBindingRow)
      );
    },

    async listForProject(projectId) {
      return mapRows(
        await delegate.findMany({
          where: { scope: "project", targetKey: projectId },
          orderBy: ORDER_UPDATED_ID_ASC
        }),
        (row) => toRepositorySkillBinding(row as unknown as PrismaSkillBindingRow)
      );
    },

    async listAll() {
      return mapRows(await delegate.findMany({ orderBy: ORDER_UPDATED_ID_ASC }), (row) =>
        toRepositorySkillBinding(row as unknown as PrismaSkillBindingRow)
      );
    }
  };
}

function createModelProviderRepository(delegate: PrismaDelegate): ModelProviderRepository {
  return {
    async save(provider) {
      await upsert(delegate, { id: provider.id }, toPrismaModelProviderCreate(provider));
    },

    async getById(providerId) {
      return mapOptional(
        await delegate.findUnique({ where: { id: providerId } }),
        (row) => toRepositoryModelProvider(row as unknown as PrismaModelProviderRow)
      );
    },

    async listForProject(projectId) {
      return mapRows(
        await delegate.findMany({
          where: { scope: "project", targetKey: projectId },
          orderBy: ORDER_UPDATED_ID_ASC
        }),
        (row) => toRepositoryModelProvider(row as unknown as PrismaModelProviderRow)
      );
    },

    async listAll() {
      return mapRows(await delegate.findMany({ orderBy: ORDER_UPDATED_ID_ASC }), (row) =>
        toRepositoryModelProvider(row as unknown as PrismaModelProviderRow)
      );
    }
  };
}

function createModelRoutingPolicyRepository(
  delegate: PrismaDelegate
): ModelRoutingPolicyRepository {
  return {
    async save(policy) {
      await upsert(
        delegate,
        {
          scope_targetKey_role: {
            scope: policy.scope,
            targetKey: policy.targetKey,
            role: policy.role
          }
        },
        toPrismaModelRoutingPolicyCreate(policy),
        ["id", "scope", "targetKey", "role"],
        ["fallback", "settings"]
      );
    },

    async getById(policyId) {
      return mapOptional(
        await delegate.findUnique({ where: { id: policyId } }),
        (row) => toRepositoryModelRoutingPolicy(row as unknown as PrismaModelRoutingPolicyRow)
      );
    },

    async getByProjectAndRole(projectId, role) {
      return mapOptional(
        await delegate.findUnique({
          where: { scope_targetKey_role: { scope: "project", targetKey: projectId, role } }
        }),
        (row) => toRepositoryModelRoutingPolicy(row as unknown as PrismaModelRoutingPolicyRow)
      );
    },

    async listForProject(projectId) {
      return mapRows(
        await delegate.findMany({
          where: { scope: "project", targetKey: projectId },
          orderBy: ORDER_UPDATED_ID_ASC
        }),
        (row) => toRepositoryModelRoutingPolicy(row as unknown as PrismaModelRoutingPolicyRow)
      );
    },

    async listAll() {
      return mapRows(await delegate.findMany({ orderBy: ORDER_UPDATED_ID_ASC }), (row) =>
        toRepositoryModelRoutingPolicy(row as unknown as PrismaModelRoutingPolicyRow)
      );
    }
  };
}

function createMCPConnectorRepository(delegate: PrismaDelegate): MCPConnectorRepository {
  return {
    async save(connector) {
      await upsert(
        delegate,
        { id: connector.id },
        withMCPConnectorStorageDefaults(toPrismaMCPConnectorCreate(connector)),
        ["id"],
        ["description"]
      );
    },

    async getById(connectorId) {
      return mapOptional(
        await delegate.findUnique({ where: { id: connectorId } }),
        (row) => toRepositoryMCPConnector(row as unknown as PrismaMCPConnectorRow)
      );
    },

    async listForProject(projectId) {
      return mapRows(
        await delegate.findMany({
          where: { scope: "project", targetKey: projectId },
          orderBy: ORDER_UPDATED_ID_ASC
        }),
        (row) => toRepositoryMCPConnector(row as unknown as PrismaMCPConnectorRow)
      );
    },

    async listAll() {
      return mapRows(await delegate.findMany({ orderBy: ORDER_UPDATED_ID_ASC }), (row) =>
        toRepositoryMCPConnector(row as unknown as PrismaMCPConnectorRow)
      );
    }
  };
}

function createMCPToolApprovalRepository(delegate: PrismaDelegate): MCPToolApprovalRepository {
  return {
    async save(approval) {
      await upsert(
        delegate,
        {
          projectId_connectorId_toolName: {
            projectId: approval.projectId,
            connectorId: approval.connectorId,
            toolName: approval.toolName
          }
        },
        toPrismaMCPToolApprovalCreate(approval),
        ["id", "projectId", "connectorId", "toolName"],
        ["approvedByUserId"]
      );
    },

    async getByProjectConnectorAndTool(projectId, connectorId, toolName) {
      return mapOptional(
        await delegate.findUnique({
          where: { projectId_connectorId_toolName: { projectId, connectorId, toolName } }
        }),
        (row) => toRepositoryMCPToolApproval(row as unknown as PrismaMCPToolApprovalRow)
      );
    },

    async listForProject(projectId) {
      return mapRows(
        await delegate.findMany({
          where: { projectId },
          orderBy: ORDER_UPDATED_ID_ASC
        }),
        (row) => toRepositoryMCPToolApproval(row as unknown as PrismaMCPToolApprovalRow)
      );
    },

    async listAll() {
      return mapRows(await delegate.findMany({ orderBy: ORDER_UPDATED_ID_ASC }), (row) =>
        toRepositoryMCPToolApproval(row as unknown as PrismaMCPToolApprovalRow)
      );
    }
  };
}

function createWorkbenchTaskRepository(delegate: PrismaDelegate): WorkbenchTaskRepository {
  return {
    async save(task) {
      await upsert(delegate, { id: task.id }, toPrismaWorkbenchTask(task), ["id"], ["projectId"]);
    },

    async getById(taskId) {
      return mapOptional(
        await delegate.findUnique({ where: { id: taskId } }),
        toRepositoryWorkbenchTask
      );
    },

    async listAll() {
      return mapRows(
        await delegate.findMany({ orderBy: ORDER_CREATED_ID_ASC }),
        toRepositoryWorkbenchTask
      );
    }
  };
}

function createWorkbenchMessageRepository(delegate: PrismaDelegate): WorkbenchMessageRepository {
  return {
    async save(message) {
      await upsert(delegate, { id: message.id }, toPrismaWorkbenchMessage(message));
    },

    async listForTask(taskId) {
      return mapRows(
        await delegate.findMany({
          where: { taskId },
          orderBy: ORDER_CREATED_ID_ASC
        }),
        toRepositoryWorkbenchMessage
      );
    },

    async listAll() {
      return mapRows(
        await delegate.findMany({ orderBy: ORDER_CREATED_ID_ASC }),
        toRepositoryWorkbenchMessage
      );
    }
  };
}

function createWorkbenchTaskSnapshotRepository(
  delegate: PrismaDelegate
): WorkbenchTaskSnapshotRepository {
  return {
    async save(snapshot) {
      await upsert(
        delegate,
        { taskId: snapshot.taskId },
        toPrismaWorkbenchTaskSnapshot(snapshot),
        ["taskId"],
        ["briefId", "pageVersionId"]
      );
    },

    async getByTaskId(taskId) {
      return mapOptional(
        await delegate.findUnique({ where: { taskId } }),
        toRepositoryWorkbenchTaskSnapshot
      );
    }
  };
}

function createBriefRepository(delegate: PrismaDelegate): BriefRepository {
  return {
    async save(brief) {
      await upsert(delegate, { id: brief.id }, toPrismaBrief(brief));
    },

    async getById(briefId) {
      return mapOptional(await delegate.findUnique({ where: { id: briefId } }), toRepositoryBrief);
    },

    async findLatestForProject(projectId) {
      const rows = await delegate.findMany({
        where: { projectId },
        orderBy: ORDER_BRIEF_LATEST,
        take: 1
      });
      return mapOptional(rows[0], toRepositoryBrief);
    },

    async listAll() {
      return mapRows(await delegate.findMany({ orderBy: ORDER_CREATED_ID_ASC }), toRepositoryBrief);
    }
  };
}

function createPageVersionRepository(delegate: PrismaDelegate): PageVersionRepository {
  return {
    async save(pageVersion) {
      await upsert(
        delegate,
        { id: pageVersion.id },
        toPrismaPageVersion(pageVersion),
        ["id"],
        ["artifactWorkspaceId"]
      );
    },

    async getById(pageVersionId) {
      return mapOptional(
        await delegate.findUnique({ where: { id: pageVersionId } }),
        toRepositoryPageVersion
      );
    },

    async findLatestForProject(projectId) {
      const rows = await delegate.findMany({
        where: { projectId },
        orderBy: ORDER_BRIEF_LATEST,
        take: 1
      });
      return mapOptional(rows[0], toRepositoryPageVersion);
    },

    async listAll() {
      return mapRows(
        await delegate.findMany({ orderBy: ORDER_CREATED_ID_ASC }),
        toRepositoryPageVersion
      );
    }
  };
}

function createArtifactWorkspaceRepository(
  delegate: PrismaDelegate
): ArtifactWorkspaceRepository {
  return {
    async save(workspace) {
      await upsert(
        delegate,
        { id: workspace.id },
        toPrismaArtifactWorkspace(workspace),
        ["id"],
        ["pageVersionId", "runId"]
      );
    },

    async getById(workspaceId) {
      return mapOptional(
        await delegate.findUnique({ where: { id: workspaceId } }),
        toRepositoryArtifactWorkspace
      );
    },

    async getForPageVersion(pageVersionId) {
      const rows = await delegate.findMany({
        where: { pageVersionId },
        orderBy: ORDER_CREATED_ID_ASC,
        take: 1
      });
      return mapOptional(rows[0], toRepositoryArtifactWorkspace);
    },

    async listForProject(projectId) {
      return mapRows(
        await delegate.findMany({
          where: { projectId },
          orderBy: ORDER_CREATED_ID_ASC
        }),
        toRepositoryArtifactWorkspace
      );
    },

    async listAll() {
      return mapRows(
        await delegate.findMany({ orderBy: ORDER_CREATED_ID_ASC }),
        toRepositoryArtifactWorkspace
      );
    }
  };
}

function createArtifactWorkspaceFileRepository(
  delegate: PrismaDelegate
): ArtifactWorkspaceFileRepository {
  return {
    async save(file) {
      await upsert(
        delegate,
        { workspaceId_path: { workspaceId: file.workspaceId, path: file.path } },
        toPrismaArtifactWorkspaceFile(file),
        ["id"],
        ["pageVersionId"]
      );
    },

    async getByPath(input) {
      return mapOptional(
        await delegate.findUnique({
          where: { workspaceId_path: { workspaceId: input.workspaceId, path: input.path } }
        }),
        toRepositoryArtifactWorkspaceFile
      );
    },

    async listForWorkspace(workspaceId) {
      return mapRows(
        await delegate.findMany({
          where: { workspaceId },
          orderBy: ORDER_ARTIFACT_FILE_TIMELINE
        }),
        toRepositoryArtifactWorkspaceFile
      );
    },

    async listAll() {
      return mapRows(
        await delegate.findMany({ orderBy: ORDER_ARTIFACT_FILE_TIMELINE }),
        toRepositoryArtifactWorkspaceFile
      );
    }
  };
}

function createRunRepository(delegate: PrismaDelegate): RunRepository {
  return {
    async save(run) {
      await upsert(delegate, { id: run.id }, toPrismaRunCreate(run), ["id"], [
        "taskId",
        "completedAt"
      ]);
    },

    async getById(runId) {
      return mapOptional(
        await delegate.findUnique({ where: { id: runId } }),
        (row) => toRepositoryRun(row as unknown as PrismaRunRow)
      );
    },

    async listForProject(projectId) {
      return mapRows(
        await delegate.findMany({
          where: { projectId },
          orderBy: ORDER_STARTED_ID_ASC
        }),
        (row) => toRepositoryRun(row as unknown as PrismaRunRow)
      );
    },

    async listForTask(taskId) {
      return mapRows(
        await delegate.findMany({
          where: { taskId },
          orderBy: ORDER_STARTED_ID_ASC
        }),
        (row) => toRepositoryRun(row as unknown as PrismaRunRow)
      );
    },

    async listAll() {
      return mapRows(await delegate.findMany({ orderBy: ORDER_STARTED_ID_ASC }), (row) =>
        toRepositoryRun(row as unknown as PrismaRunRow)
      );
    }
  };
}

function createRunEventRepository(delegate: PrismaDelegate): RunEventRepository {
  return {
    async save(event) {
      await upsert(delegate, { id: event.id }, toPrismaRunEventCreate(event), ["id"], ["taskId"]);
    },

    async listForRun(runId) {
      return mapRows(
        await delegate.findMany({
          where: { runId },
          orderBy: ORDER_RUN_EVENT_SEQUENCE
        }),
        (row) => toRepositoryRunEvent(row as unknown as PrismaRunEventRow)
      );
    },

    async listForTask(taskId) {
      return mapRows(
        await delegate.findMany({
          where: { taskId },
          orderBy: ORDER_RUN_EVENT_TIMELINE
        }),
        (row) => toRepositoryRunEvent(row as unknown as PrismaRunEventRow)
      );
    },

    async listForProject(projectId) {
      return mapRows(
        await delegate.findMany({
          where: { projectId },
          orderBy: ORDER_RUN_EVENT_TIMELINE
        }),
        (row) => toRepositoryRunEvent(row as unknown as PrismaRunEventRow)
      );
    },

    async listAll() {
      return mapRows(await delegate.findMany({ orderBy: ORDER_RUN_EVENT_TIMELINE }), (row) =>
        toRepositoryRunEvent(row as unknown as PrismaRunEventRow)
      );
    }
  };
}

function createToolObservationRepository(delegate: PrismaDelegate): ToolObservationRepository {
  return {
    async save(observation) {
      await upsert(delegate, { id: observation.id }, toPrismaToolObservation(observation), ["id"], [
        "taskId",
        "exitCode",
        "errorName",
        "completedAt"
      ]);
    },

    async listForRun(runId) {
      return mapRows(
        await delegate.findMany({
          where: { runId },
          orderBy: ORDER_TOOL_OBSERVATION_TIMELINE
        }),
        toRepositoryToolObservation
      );
    },

    async listForTask(taskId) {
      return mapRows(
        await delegate.findMany({
          where: { taskId },
          orderBy: ORDER_TOOL_OBSERVATION_TIMELINE
        }),
        toRepositoryToolObservation
      );
    },

    async listAll() {
      return mapRows(
        await delegate.findMany({ orderBy: ORDER_TOOL_OBSERVATION_TIMELINE }),
        toRepositoryToolObservation
      );
    }
  };
}

function createAgentHandoffRepository(delegate: PrismaDelegate): AgentHandoffRepository {
  return {
    async save(handoff) {
      await upsert(
        delegate,
        { id: handoff.id },
        toPrismaAgentHandoffCreate(handoff),
        ["id"],
        ["taskId", "blockingReason"],
        ["artifactRefs"]
      );
    },

    async getById(handoffId) {
      return mapOptional(
        await delegate.findUnique({ where: { id: handoffId } }),
        (row) => toRepositoryAgentHandoff(row as unknown as PrismaAgentHandoffRow)
      );
    },

    async listForProject(projectId) {
      return listAgentHandoffs(delegate, { projectId });
    },

    async listForTask(taskId) {
      return listAgentHandoffs(delegate, { taskId });
    },

    async listInbound(input) {
      return listAgentHandoffs(delegate, {
        projectId: input.projectId,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        toRole: input.toRole
      });
    },

    async listOutbound(input) {
      return listAgentHandoffs(delegate, {
        projectId: input.projectId,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        fromRole: input.fromRole
      });
    },

    async listAll() {
      return listAgentHandoffs(delegate, {});
    }
  };
}

async function listAgentHandoffs(
  delegate: PrismaDelegate,
  where: PrismaWhere
): Promise<AgentHandoffRecord[]> {
  return mapRows(
    await delegate.findMany({
      where,
      orderBy: ORDER_AGENT_HANDOFF_TIMELINE
    }),
    (row) => toRepositoryAgentHandoff(row as unknown as PrismaAgentHandoffRow)
  );
}

async function upsert(
  delegate: PrismaDelegate,
  where: PrismaWhere,
  data: object,
  updateOmitKeys: string[] = ["id"],
  nullableKeys: string[] = [],
  emptyJsonObjectKeys: string[] = []
): Promise<void> {
  const row = materializeEmptyJsonObjects(
    materializeNulls(asPrismaRow(data), nullableKeys),
    emptyJsonObjectKeys
  );
  await delegate.upsert({
    where,
    create: row,
    update: omitKeys(row, updateOmitKeys)
  });
}

function toPrismaWorkbenchTask(task: WorkbenchTaskRecord): PrismaRow {
  return asPrismaRow({
    id: task.id,
    title: task.title,
    type: task.type,
    status: task.status,
    ...(task.projectId ? { projectId: task.projectId } : {}),
    createdAt: new Date(task.createdAt)
  });
}

function toRepositoryWorkbenchTask(row: PrismaRow): WorkbenchTaskRecord {
  return {
    id: row.id as string,
    title: row.title as string,
    type: row.type as WorkbenchTaskRecord["type"],
    status: row.status as WorkbenchTaskRecord["status"],
    ...(typeof row.projectId === "string" ? { projectId: row.projectId } : {}),
    createdAt: toIsoString(row.createdAt)
  };
}

function toPrismaWorkbenchMessage(message: WorkbenchMessageRecord): PrismaRow {
  return asPrismaRow({
    id: message.id,
    taskId: message.taskId,
    role: message.role,
    content: message.content,
    createdAt: new Date(message.createdAt)
  });
}

function toRepositoryWorkbenchMessage(row: PrismaRow): WorkbenchMessageRecord {
  return {
    id: row.id as string,
    taskId: row.taskId as string,
    role: row.role as WorkbenchMessageRecord["role"],
    content: row.content as string,
    createdAt: toIsoString(row.createdAt)
  };
}

function toPrismaWorkbenchTaskSnapshot(snapshot: WorkbenchTaskSnapshotRecord): PrismaRow {
  return asPrismaRow({
    taskId: snapshot.taskId,
    projectId: snapshot.projectId,
    ...(snapshot.briefId ? { briefId: snapshot.briefId } : {}),
    ...(snapshot.pageVersionId ? { pageVersionId: snapshot.pageVersionId } : {}),
    createdAt: new Date(snapshot.createdAt)
  });
}

function toRepositoryWorkbenchTaskSnapshot(row: PrismaRow): WorkbenchTaskSnapshotRecord {
  return {
    taskId: row.taskId as string,
    projectId: row.projectId as string,
    ...(typeof row.briefId === "string" ? { briefId: row.briefId } : {}),
    ...(typeof row.pageVersionId === "string" ? { pageVersionId: row.pageVersionId } : {}),
    createdAt: toIsoString(row.createdAt)
  };
}

function toPrismaBrief(brief: BriefRecord): PrismaRow {
  return asPrismaRow({
    id: brief.id,
    projectId: brief.projectId,
    title: brief.brief.title,
    prompt: brief.prompt,
    data: cloneJson(brief.brief),
    createdAt: new Date(brief.createdAt)
  });
}

function toRepositoryBrief(row: PrismaRow): BriefRecord {
  return {
    id: row.id as string,
    projectId: row.projectId as string,
    prompt: row.prompt as string,
    brief: cloneJson(row.data) as BriefRecord["brief"],
    createdAt: toIsoString(row.createdAt)
  };
}

function toPrismaPageVersion(pageVersion: PageVersionRecord): PrismaRow {
  return asPrismaRow({
    id: pageVersion.id,
    projectId: pageVersion.projectId,
    briefId: pageVersion.briefId,
    ...(pageVersion.artifactWorkspaceId
      ? { artifactWorkspaceId: pageVersion.artifactWorkspaceId }
      : {}),
    artifactData: cloneJson(pageVersion.artifacts),
    findings: cloneJson(pageVersion.findings),
    reviewStatus: pageVersion.reviewStatus,
    createdAt: new Date(pageVersion.createdAt)
  });
}

function toRepositoryPageVersion(row: PrismaRow): PageVersionRecord {
  return {
    id: row.id as string,
    projectId: row.projectId as string,
    briefId: row.briefId as string,
    ...(typeof row.artifactWorkspaceId === "string"
      ? { artifactWorkspaceId: row.artifactWorkspaceId }
      : {}),
    artifacts: cloneJson(row.artifactData) as PageVersionRecord["artifacts"],
    reviewStatus: row.reviewStatus as PageVersionRecord["reviewStatus"],
    findings: cloneJson(row.findings) as PageVersionRecord["findings"],
    createdAt: toIsoString(row.createdAt)
  };
}

function toPrismaArtifactWorkspace(workspace: ArtifactWorkspaceRecord): PrismaRow {
  return asPrismaRow({
    id: workspace.id,
    projectId: workspace.projectId,
    ...(workspace.pageVersionId ? { pageVersionId: workspace.pageVersionId } : {}),
    ...(workspace.runId ? { runId: workspace.runId } : {}),
    kind: workspace.kind,
    state: workspace.state,
    createdAt: new Date(workspace.createdAt),
    updatedAt: new Date(workspace.updatedAt)
  });
}

function toRepositoryArtifactWorkspace(row: PrismaRow): ArtifactWorkspaceRecord {
  return {
    id: row.id as string,
    projectId: row.projectId as string,
    ...(typeof row.pageVersionId === "string" ? { pageVersionId: row.pageVersionId } : {}),
    ...(typeof row.runId === "string" ? { runId: row.runId } : {}),
    kind: row.kind as ArtifactWorkspaceRecord["kind"],
    state: row.state as ArtifactWorkspaceRecord["state"],
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

function toPrismaArtifactWorkspaceFile(file: ArtifactWorkspaceFileRecord): PrismaRow {
  return asPrismaRow({
    id: file.id,
    workspaceId: file.workspaceId,
    projectId: file.projectId,
    ...(file.pageVersionId ? { pageVersionId: file.pageVersionId } : {}),
    path: file.path,
    kind: file.kind,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    summary: file.summary,
    content: file.content,
    createdAt: new Date(file.createdAt),
    updatedAt: new Date(file.updatedAt)
  });
}

function toRepositoryArtifactWorkspaceFile(row: PrismaRow): ArtifactWorkspaceFileRecord {
  return {
    id: row.id as string,
    workspaceId: row.workspaceId as string,
    projectId: row.projectId as string,
    ...(typeof row.pageVersionId === "string" ? { pageVersionId: row.pageVersionId } : {}),
    path: row.path as ArtifactWorkspaceFilePath,
    kind: row.kind as ArtifactWorkspaceFileRecord["kind"],
    mimeType: row.mimeType as ArtifactWorkspaceFileRecord["mimeType"],
    sizeBytes: row.sizeBytes as number,
    sha256: row.sha256 as string,
    summary: row.summary as string,
    content: row.content as string,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

function toPrismaToolObservation(observation: ToolObservationRecord): PrismaRow {
  return asPrismaRow({
    id: observation.id,
    runId: observation.runId,
    projectId: observation.projectId,
    ...(observation.taskId ? { taskId: observation.taskId } : {}),
    toolName: observation.toolName,
    input: cloneJson(observation.input),
    outputSummary: observation.outputSummary,
    state: observation.state,
    ...(observation.exitCode !== undefined ? { exitCode: observation.exitCode } : {}),
    ...(observation.errorName ? { errorName: observation.errorName } : {}),
    createdAt: new Date(observation.createdAt),
    ...(observation.completedAt ? { completedAt: new Date(observation.completedAt) } : {})
  });
}

function toRepositoryToolObservation(row: PrismaRow): ToolObservationRecord {
  return {
    id: row.id as string,
    runId: row.runId as string,
    projectId: row.projectId as string,
    ...(typeof row.taskId === "string" ? { taskId: row.taskId } : {}),
    toolName: row.toolName as string,
    input: cloneJson(row.input) as Record<string, unknown>,
    outputSummary: row.outputSummary as string,
    state: row.state as ToolObservationRecord["state"],
    ...(typeof row.exitCode === "number" ? { exitCode: row.exitCode } : {}),
    ...(typeof row.errorName === "string" ? { errorName: row.errorName } : {}),
    createdAt: toIsoString(row.createdAt),
    ...(row.completedAt ? { completedAt: toIsoString(row.completedAt) } : {})
  };
}

function mapRows<TRecord>(rows: PrismaRow[], mapper: (row: PrismaRow) => TRecord): TRecord[] {
  return rows.map(mapper);
}

function mapOptional<TRecord>(
  row: PrismaRow | null | undefined,
  mapper: (row: PrismaRow) => TRecord
): TRecord | undefined {
  return row ? mapper(row) : undefined;
}

function asPrismaRow(data: object): PrismaRow {
  return data as unknown as PrismaRow;
}

function withMCPConnectorStorageDefaults(data: object): PrismaRow {
  return {
    ...asPrismaRow(data),
    transport: "static",
    config: {}
  };
}

function omitKeys(row: PrismaRow, keys: string[]): PrismaRow {
  const copy = { ...row };
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
}

function materializeNulls(row: PrismaRow, nullableKeys: string[]): PrismaRow {
  const copy = { ...row };
  for (const key of nullableKeys) {
    if (!(key in copy)) {
      copy[key] = null;
    }
  }
  return copy;
}

function materializeEmptyJsonObjects(row: PrismaRow, keys: string[]): PrismaRow {
  const copy = { ...row };
  for (const key of keys) {
    if (!(key in copy)) {
      copy[key] = {};
    }
  }
  return copy;
}

function cloneJson(value: unknown): unknown {
  return structuredClone(value);
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value as string).toISOString();
}
