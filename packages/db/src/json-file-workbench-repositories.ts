import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ArtifactWorkspaceFileRecord, ArtifactWorkspaceRecord } from "@lp-agent/artifacts";
import type { DeploymentHandoff } from "@lp-agent/git-deployment";
import type { AgentRole } from "@lp-agent/model-gateway";
import type {
  AgentHandoffRecord,
  AgentHandoffRepository,
  ArtifactWorkspaceFileRepository,
  ArtifactWorkspaceRepository,
  BriefRecord,
  BriefRepository,
  DeploymentRepository,
  MCPConnectorRecord,
  MCPConnectorRepository,
  MCPToolApprovalRecord,
  MCPToolApprovalRepository,
  ModelProviderRecord,
  ModelProviderRepository,
  ModelRoutingPolicyRecord,
  ModelRoutingPolicyRepository,
  PageVersionRecord,
  PageVersionRepository,
  ProjectMemberRecord,
  ProjectMemberRepository,
  ProjectRecord,
  ProjectRepository,
  RunEventRecord,
  RunEventRepository,
  RunRecord,
  RunRepository,
  SkillBindingRecord,
  SkillBindingRepository,
  SkillRecord,
  SkillRepository,
  SkillVersionRecord,
  SkillVersionRepository,
  ToolObservationRecord,
  ToolObservationRepository,
  WorkbenchMessageRecord,
  WorkbenchMessageRepository,
  WorkbenchRepositories,
  WorkspaceMemberRecord,
  WorkspaceMemberRepository,
  WorkbenchTaskRecord,
  WorkbenchTaskRepository,
  WorkbenchTaskSnapshotRecord,
  WorkbenchTaskSnapshotRepository
} from "./workbench-repositories";

export interface JsonFileWorkbenchRepositoriesOptions {
  filePath: string;
}

interface JsonFileWorkbenchState {
  projects: ProjectRecord[];
  workspaceMembers: WorkspaceMemberRecord[];
  projectMembers: ProjectMemberRecord[];
  briefs: BriefRecord[];
  pageVersions: PageVersionRecord[];
  artifactWorkspaces: ArtifactWorkspaceRecord[];
  artifactWorkspaceFiles: ArtifactWorkspaceFileRecord[];
  deployments: DeploymentHandoff[];
  tasks: WorkbenchTaskRecord[];
  messages: WorkbenchMessageRecord[];
  taskSnapshots: WorkbenchTaskSnapshotRecord[];
  skills: SkillRecord[];
  skillVersions: SkillVersionRecord[];
  skillBindings: SkillBindingRecord[];
  modelProviders: ModelProviderRecord[];
  modelRoutingPolicies: ModelRoutingPolicyRecord[];
  mcpConnectors: MCPConnectorRecord[];
  mcpToolApprovals: MCPToolApprovalRecord[];
  runs: RunRecord[];
  runEvents: RunEventRecord[];
  toolObservations: ToolObservationRecord[];
  agentHandoffs: AgentHandoffRecord[];
}

const writeQueuesByFilePath = new Map<string, Promise<void>>();
const repositoriesByFilePath = new Map<string, WorkbenchRepositories>();

export function createJsonFileWorkbenchRepositories(
  options: JsonFileWorkbenchRepositoriesOptions
): WorkbenchRepositories {
  const filePath = resolve(options.filePath);
  const existingRepositories = repositoriesByFilePath.get(filePath);
  if (existingRepositories) {
    return existingRepositories;
  }

  const repositories = new JsonFileWorkbenchRepositories(filePath);
  repositoriesByFilePath.set(filePath, repositories);
  return repositories;
}

class JsonFileWorkbenchRepositories implements WorkbenchRepositories {
  readonly projects: ProjectRepository;
  readonly workspaceMembers: WorkspaceMemberRepository;
  readonly projectMembers: ProjectMemberRepository;
  readonly briefs: BriefRepository;
  readonly pageVersions: PageVersionRepository;
  readonly artifactWorkspaces: ArtifactWorkspaceRepository;
  readonly artifactWorkspaceFiles: ArtifactWorkspaceFileRepository;
  readonly deployments: DeploymentRepository;
  readonly tasks: WorkbenchTaskRepository;
  readonly messages: WorkbenchMessageRepository;
  readonly taskSnapshots: WorkbenchTaskSnapshotRepository;
  readonly skills: SkillRepository;
  readonly skillVersions: SkillVersionRepository;
  readonly skillBindings: SkillBindingRepository;
  readonly modelProviders: ModelProviderRepository;
  readonly modelRoutingPolicies: ModelRoutingPolicyRepository;
  readonly mcpConnectors: MCPConnectorRepository;
  readonly mcpToolApprovals: MCPToolApprovalRepository;
  readonly runs: RunRepository;
  readonly runEvents: RunEventRepository;
  readonly toolObservations: ToolObservationRepository;
  readonly agentHandoffs: AgentHandoffRepository;

  constructor(filePath: string) {
    this.projects = new JsonFileProjectRepository(filePath);
    this.workspaceMembers = new JsonFileWorkspaceMemberRepository(filePath);
    this.projectMembers = new JsonFileProjectMemberRepository(filePath);
    this.briefs = new JsonFileBriefRepository(filePath);
    this.pageVersions = new JsonFilePageVersionRepository(filePath);
    this.artifactWorkspaces = new JsonFileArtifactWorkspaceRepository(filePath);
    this.artifactWorkspaceFiles = new JsonFileArtifactWorkspaceFileRepository(filePath);
    this.deployments = new JsonFileDeploymentRepository(filePath);
    this.tasks = new JsonFileWorkbenchTaskRepository(filePath);
    this.messages = new JsonFileWorkbenchMessageRepository(filePath);
    this.taskSnapshots = new JsonFileWorkbenchTaskSnapshotRepository(filePath);
    this.skills = new JsonFileSkillRepository(filePath);
    this.skillVersions = new JsonFileSkillVersionRepository(filePath);
    this.skillBindings = new JsonFileSkillBindingRepository(filePath);
    this.modelProviders = new JsonFileModelProviderRepository(filePath);
    this.modelRoutingPolicies = new JsonFileModelRoutingPolicyRepository(filePath);
    this.mcpConnectors = new JsonFileMCPConnectorRepository(filePath);
    this.mcpToolApprovals = new JsonFileMCPToolApprovalRepository(filePath);
    this.runs = new JsonFileRunRepository(filePath);
    this.runEvents = new JsonFileRunEventRepository(filePath);
    this.toolObservations = new JsonFileToolObservationRepository(filePath);
    this.agentHandoffs = new JsonFileAgentHandoffRepository(filePath);
  }
}

class JsonFileRunRepository implements RunRepository {
  constructor(private readonly filePath: string) {}

  async save(run: RunRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.runs = upsertBy(state.runs, copy(run), (record) => record.id === run.id);
    });
  }

  async getById(runId: string): Promise<RunRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.runs.find((run) => run.id === runId));
  }

  async listForProject(projectId: string): Promise<RunRecord[]> {
    const state = await readState(this.filePath);
    return state.runs.filter((run) => run.projectId === projectId).map(copy);
  }

  async listForTask(taskId: string): Promise<RunRecord[]> {
    const state = await readState(this.filePath);
    return state.runs.filter((run) => run.taskId === taskId).map(copy);
  }

  async listAll(): Promise<RunRecord[]> {
    const state = await readState(this.filePath);
    return state.runs.map(copy);
  }
}

class JsonFileRunEventRepository implements RunEventRepository {
  constructor(private readonly filePath: string) {}

  async save(event: RunEventRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.runEvents = upsertBy(state.runEvents, copy(event), (record) => record.id === event.id);
    });
  }

  async listForRun(runId: string): Promise<RunEventRecord[]> {
    return this.sequenceSortedEvents((event) => event.runId === runId);
  }

  async listForTask(taskId: string): Promise<RunEventRecord[]> {
    return this.timelineSortedEvents((event) => event.taskId === taskId);
  }

  async listForProject(projectId: string): Promise<RunEventRecord[]> {
    return this.timelineSortedEvents((event) => event.projectId === projectId);
  }

  async listAll(): Promise<RunEventRecord[]> {
    return this.timelineSortedEvents(() => true);
  }

  private async sequenceSortedEvents(
    matches: (event: RunEventRecord) => boolean
  ): Promise<RunEventRecord[]> {
    const state = await readState(this.filePath);
    return state.runEvents.filter(matches).sort(compareRunEventsBySequence).map(copy);
  }

  private async timelineSortedEvents(
    matches: (event: RunEventRecord) => boolean
  ): Promise<RunEventRecord[]> {
    const state = await readState(this.filePath);
    return state.runEvents.filter(matches).sort(compareRunEventsByTimeline).map(copy);
  }
}

class JsonFileToolObservationRepository implements ToolObservationRepository {
  constructor(private readonly filePath: string) {}

  async save(observation: ToolObservationRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.toolObservations = upsertBy(
        state.toolObservations,
        copy(observation),
        (record) => record.id === observation.id
      );
    });
  }

  async listForRun(runId: string): Promise<ToolObservationRecord[]> {
    return this.sortedObservations((observation) => observation.runId === runId);
  }

  async listForTask(taskId: string): Promise<ToolObservationRecord[]> {
    return this.sortedObservations((observation) => observation.taskId === taskId);
  }

  async listAll(): Promise<ToolObservationRecord[]> {
    return this.sortedObservations(() => true);
  }

  private async sortedObservations(
    matches: (observation: ToolObservationRecord) => boolean
  ): Promise<ToolObservationRecord[]> {
    const state = await readState(this.filePath);
    return state.toolObservations
      .filter(matches)
      .sort(compareToolObservationsByTimeline)
      .map(copy);
  }
}

class JsonFileAgentHandoffRepository implements AgentHandoffRepository {
  constructor(private readonly filePath: string) {}

  async save(handoff: AgentHandoffRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.agentHandoffs = upsertBy(
        state.agentHandoffs,
        copy(handoff),
        (record) => record.id === handoff.id
      );
    });
  }

  async getById(handoffId: string): Promise<AgentHandoffRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.agentHandoffs.find((handoff) => handoff.id === handoffId));
  }

  async listForProject(projectId: string): Promise<AgentHandoffRecord[]> {
    return this.sortedHandoffs((handoff) => handoff.projectId === projectId);
  }

  async listForTask(taskId: string): Promise<AgentHandoffRecord[]> {
    return this.sortedHandoffs((handoff) => handoff.taskId === taskId);
  }

  async listInbound(input: {
    projectId: string;
    taskId?: string;
    toRole: AgentRole;
  }): Promise<AgentHandoffRecord[]> {
    return this.sortedHandoffs(
      (handoff) =>
        handoff.projectId === input.projectId &&
        handoff.toRole === input.toRole &&
        (input.taskId === undefined || handoff.taskId === input.taskId)
    );
  }

  async listOutbound(input: {
    projectId: string;
    taskId?: string;
    fromRole: AgentRole;
  }): Promise<AgentHandoffRecord[]> {
    return this.sortedHandoffs(
      (handoff) =>
        handoff.projectId === input.projectId &&
        handoff.fromRole === input.fromRole &&
        (input.taskId === undefined || handoff.taskId === input.taskId)
    );
  }

  async listAll(): Promise<AgentHandoffRecord[]> {
    return this.sortedHandoffs(() => true);
  }

  private async sortedHandoffs(
    matches: (handoff: AgentHandoffRecord) => boolean
  ): Promise<AgentHandoffRecord[]> {
    const state = await readState(this.filePath);
    return state.agentHandoffs
      .filter(matches)
      .sort(compareAgentHandoffsByTimeline)
      .map(copy);
  }
}

class JsonFileSkillRepository implements SkillRepository {
  constructor(private readonly filePath: string) {}

  async save(skill: SkillRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.skills = upsertBy(state.skills, copy(skill), (record) => record.id === skill.id);
    });
  }

  async getById(skillId: string): Promise<SkillRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.skills.find((skill) => skill.id === skillId));
  }

  async listAll(): Promise<SkillRecord[]> {
    const state = await readState(this.filePath);
    return state.skills.map(copy);
  }
}

class JsonFileSkillVersionRepository implements SkillVersionRepository {
  constructor(private readonly filePath: string) {}

  async save(version: SkillVersionRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.skillVersions = upsertBy(
        state.skillVersions,
        copy(version),
        (record) => record.id === version.id
      );
    });
  }

  async getById(versionId: string): Promise<SkillVersionRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.skillVersions.find((version) => version.id === versionId));
  }

  async getBySkillIdAndVersion(
    skillId: string,
    version: string
  ): Promise<SkillVersionRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(
      state.skillVersions.find(
        (record) => record.skillId === skillId && record.version === version
      )
    );
  }

  async listForSkill(skillId: string): Promise<SkillVersionRecord[]> {
    const state = await readState(this.filePath);
    return state.skillVersions.filter((version) => version.skillId === skillId).map(copy);
  }

  async listAll(): Promise<SkillVersionRecord[]> {
    const state = await readState(this.filePath);
    return state.skillVersions.map(copy);
  }
}

class JsonFileSkillBindingRepository implements SkillBindingRepository {
  constructor(private readonly filePath: string) {}

  async save(binding: SkillBindingRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.skillBindings = upsertBy(
        state.skillBindings,
        copy(binding),
        (record) => record.id === binding.id
      );
    });
  }

  async getById(bindingId: string): Promise<SkillBindingRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.skillBindings.find((binding) => binding.id === bindingId));
  }

  async listForProject(projectId: string): Promise<SkillBindingRecord[]> {
    const state = await readState(this.filePath);
    return state.skillBindings.filter((binding) => binding.projectId === projectId).map(copy);
  }

  async listAll(): Promise<SkillBindingRecord[]> {
    const state = await readState(this.filePath);
    return state.skillBindings.map(copy);
  }
}

class JsonFileModelProviderRepository implements ModelProviderRepository {
  constructor(private readonly filePath: string) {}

  async save(provider: ModelProviderRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.modelProviders = upsertBy(
        state.modelProviders,
        copy(provider),
        (record) => record.id === provider.id
      );
    });
  }

  async getById(providerId: string): Promise<ModelProviderRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.modelProviders.find((provider) => provider.id === providerId));
  }

  async listForProject(projectId: string): Promise<ModelProviderRecord[]> {
    const state = await readState(this.filePath);
    return state.modelProviders
      .filter((provider) => provider.scope === "project" && provider.targetKey === projectId)
      .map(copy);
  }

  async listAll(): Promise<ModelProviderRecord[]> {
    const state = await readState(this.filePath);
    return state.modelProviders.map(copy);
  }
}

class JsonFileModelRoutingPolicyRepository implements ModelRoutingPolicyRepository {
  constructor(private readonly filePath: string) {}

  async save(policy: ModelRoutingPolicyRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.modelRoutingPolicies = upsertBy(
        state.modelRoutingPolicies,
        copy(policy),
        (record) => record.id === policy.id
      );
    });
  }

  async getById(policyId: string): Promise<ModelRoutingPolicyRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.modelRoutingPolicies.find((policy) => policy.id === policyId));
  }

  async getByProjectAndRole(
    projectId: string,
    role: ModelRoutingPolicyRecord["role"]
  ): Promise<ModelRoutingPolicyRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(
      state.modelRoutingPolicies.find(
        (policy) =>
          policy.scope === "project" && policy.targetKey === projectId && policy.role === role
      )
    );
  }

  async listForProject(projectId: string): Promise<ModelRoutingPolicyRecord[]> {
    const state = await readState(this.filePath);
    return state.modelRoutingPolicies
      .filter((policy) => policy.scope === "project" && policy.targetKey === projectId)
      .map(copy);
  }

  async listAll(): Promise<ModelRoutingPolicyRecord[]> {
    const state = await readState(this.filePath);
    return state.modelRoutingPolicies.map(copy);
  }
}

class JsonFileMCPConnectorRepository implements MCPConnectorRepository {
  constructor(private readonly filePath: string) {}

  async save(connector: MCPConnectorRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.mcpConnectors = upsertBy(
        state.mcpConnectors,
        copy(connector),
        (record) => record.id === connector.id
      );
    });
  }

  async getById(connectorId: string): Promise<MCPConnectorRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.mcpConnectors.find((connector) => connector.id === connectorId));
  }

  async listForProject(projectId: string): Promise<MCPConnectorRecord[]> {
    const state = await readState(this.filePath);
    return state.mcpConnectors
      .filter((connector) => connector.scope === "project" && connector.targetKey === projectId)
      .map(copy);
  }

  async listAll(): Promise<MCPConnectorRecord[]> {
    const state = await readState(this.filePath);
    return state.mcpConnectors.map(copy);
  }
}

class JsonFileMCPToolApprovalRepository implements MCPToolApprovalRepository {
  constructor(private readonly filePath: string) {}

  async save(approval: MCPToolApprovalRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.mcpToolApprovals = upsertBy(
        state.mcpToolApprovals,
        copy(approval),
        (record) => record.id === approval.id
      );
    });
  }

  async getByProjectConnectorAndTool(
    projectId: string,
    connectorId: string,
    toolName: string
  ): Promise<MCPToolApprovalRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(
      state.mcpToolApprovals.find(
        (approval) =>
          approval.projectId === projectId &&
          approval.connectorId === connectorId &&
          approval.toolName === toolName
      )
    );
  }

  async listForProject(projectId: string): Promise<MCPToolApprovalRecord[]> {
    const state = await readState(this.filePath);
    return state.mcpToolApprovals
      .filter((approval) => approval.projectId === projectId)
      .map(copy);
  }

  async listAll(): Promise<MCPToolApprovalRecord[]> {
    const state = await readState(this.filePath);
    return state.mcpToolApprovals.map(copy);
  }
}

class JsonFileProjectRepository implements ProjectRepository {
  constructor(private readonly filePath: string) {}

  async save(project: ProjectRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.projects = upsertBy(state.projects, copy(project), (record) => record.id === project.id);
    });
  }

  async getById(projectId: string): Promise<ProjectRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.projects.find((project) => project.id === projectId));
  }

  async listAll(): Promise<ProjectRecord[]> {
    const state = await readState(this.filePath);
    return state.projects.map(copy);
  }
}

class JsonFileWorkspaceMemberRepository implements WorkspaceMemberRepository {
  constructor(private readonly filePath: string) {}

  async save(member: WorkspaceMemberRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.workspaceMembers = upsertBy(
        state.workspaceMembers,
        copy(member),
        (record) => record.id === member.id
      );
    });
  }

  async getById(memberId: string): Promise<WorkspaceMemberRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.workspaceMembers.find((member) => member.id === memberId));
  }

  async getByWorkspaceAndUser(
    workspaceId: string,
    userId: string
  ): Promise<WorkspaceMemberRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(
      state.workspaceMembers.find(
        (member) => member.workspaceId === workspaceId && member.userId === userId
      )
    );
  }

  async listForWorkspace(workspaceId: string): Promise<WorkspaceMemberRecord[]> {
    const state = await readState(this.filePath);
    return state.workspaceMembers
      .filter((member) => member.workspaceId === workspaceId)
      .sort(compareWorkspaceMembers)
      .map(copy);
  }

  async listAll(): Promise<WorkspaceMemberRecord[]> {
    const state = await readState(this.filePath);
    return state.workspaceMembers.sort(compareWorkspaceMembers).map(copy);
  }
}

class JsonFileProjectMemberRepository implements ProjectMemberRepository {
  constructor(private readonly filePath: string) {}

  async save(member: ProjectMemberRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.projectMembers = upsertBy(
        state.projectMembers,
        copy(member),
        (record) => record.id === member.id
      );
    });
  }

  async getById(memberId: string): Promise<ProjectMemberRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.projectMembers.find((member) => member.id === memberId));
  }

  async getByProjectAndUser(
    projectId: string,
    userId: string
  ): Promise<ProjectMemberRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(
      state.projectMembers.find(
        (member) => member.projectId === projectId && member.userId === userId
      )
    );
  }

  async listForProject(projectId: string): Promise<ProjectMemberRecord[]> {
    const state = await readState(this.filePath);
    return state.projectMembers
      .filter((member) => member.projectId === projectId)
      .sort(compareProjectMembers)
      .map(copy);
  }

  async listAll(): Promise<ProjectMemberRecord[]> {
    const state = await readState(this.filePath);
    return state.projectMembers.sort(compareProjectMembers).map(copy);
  }
}

class JsonFileBriefRepository implements BriefRepository {
  constructor(private readonly filePath: string) {}

  async save(brief: BriefRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.briefs = upsertBy(state.briefs, copy(brief), (record) => record.id === brief.id);
    });
  }

  async getById(briefId: string): Promise<BriefRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.briefs.find((brief) => brief.id === briefId));
  }

  async findLatestForProject(projectId: string): Promise<BriefRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.briefs.filter((brief) => brief.projectId === projectId).at(-1));
  }

  async listAll(): Promise<BriefRecord[]> {
    const state = await readState(this.filePath);
    return state.briefs.map(copy);
  }
}

class JsonFilePageVersionRepository implements PageVersionRepository {
  constructor(private readonly filePath: string) {}

  async save(pageVersion: PageVersionRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.pageVersions = upsertBy(
        state.pageVersions,
        copy(pageVersion),
        (record) => record.id === pageVersion.id
      );
    });
  }

  async getById(pageVersionId: string): Promise<PageVersionRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.pageVersions.find((pageVersion) => pageVersion.id === pageVersionId));
  }

  async findLatestForProject(projectId: string): Promise<PageVersionRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(
      state.pageVersions.filter((pageVersion) => pageVersion.projectId === projectId).at(-1)
    );
  }

  async listAll(): Promise<PageVersionRecord[]> {
    const state = await readState(this.filePath);
    return state.pageVersions.map(copy);
  }
}

class JsonFileArtifactWorkspaceRepository implements ArtifactWorkspaceRepository {
  constructor(private readonly filePath: string) {}

  async save(workspace: ArtifactWorkspaceRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.artifactWorkspaces = upsertBy(
        state.artifactWorkspaces,
        copy(workspace),
        (record) => record.id === workspace.id
      );
    });
  }

  async getById(workspaceId: string): Promise<ArtifactWorkspaceRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.artifactWorkspaces.find((workspace) => workspace.id === workspaceId));
  }

  async listForProject(projectId: string): Promise<ArtifactWorkspaceRecord[]> {
    const state = await readState(this.filePath);
    return state.artifactWorkspaces
      .filter((workspace) => workspace.projectId === projectId)
      .map(copy);
  }

  async listAll(): Promise<ArtifactWorkspaceRecord[]> {
    const state = await readState(this.filePath);
    return state.artifactWorkspaces.map(copy);
  }
}

class JsonFileArtifactWorkspaceFileRepository implements ArtifactWorkspaceFileRepository {
  constructor(private readonly filePath: string) {}

  async save(file: ArtifactWorkspaceFileRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.artifactWorkspaceFiles = upsertBy(
        state.artifactWorkspaceFiles,
        copy(file),
        (record) => record.id === file.id
      );
    });
  }

  async listForWorkspace(workspaceId: string): Promise<ArtifactWorkspaceFileRecord[]> {
    const state = await readState(this.filePath);
    return state.artifactWorkspaceFiles
      .filter((file) => file.workspaceId === workspaceId)
      .map(copy);
  }

  async listAll(): Promise<ArtifactWorkspaceFileRecord[]> {
    const state = await readState(this.filePath);
    return state.artifactWorkspaceFiles.map(copy);
  }
}

class JsonFileDeploymentRepository implements DeploymentRepository {
  constructor(private readonly filePath: string) {}

  async save(deployment: DeploymentHandoff): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.deployments = upsertBy(
        state.deployments,
        copy(deployment),
        (record) => record.pageVersionId === deployment.pageVersionId
      );
    });
  }

  async getByPageVersionId(pageVersionId: string): Promise<DeploymentHandoff | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(
      state.deployments.find((deployment) => deployment.pageVersionId === pageVersionId)
    );
  }

  async findLatestForProject(projectId: string): Promise<DeploymentHandoff | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(
      state.deployments.filter((deployment) => deployment.projectId === projectId).at(-1)
    );
  }
}

class JsonFileWorkbenchTaskRepository implements WorkbenchTaskRepository {
  constructor(private readonly filePath: string) {}

  async save(task: WorkbenchTaskRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.tasks = upsertBy(state.tasks, copy(task), (record) => record.id === task.id);
    });
  }

  async getById(taskId: string): Promise<WorkbenchTaskRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.tasks.find((task) => task.id === taskId));
  }

  async listAll(): Promise<WorkbenchTaskRecord[]> {
    const state = await readState(this.filePath);
    return state.tasks.map(copy);
  }
}

class JsonFileWorkbenchMessageRepository implements WorkbenchMessageRepository {
  constructor(private readonly filePath: string) {}

  async save(message: WorkbenchMessageRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.messages = upsertBy(
        state.messages,
        copy(message),
        (record) => record.id === message.id
      );
    });
  }

  async listForTask(taskId: string): Promise<WorkbenchMessageRecord[]> {
    const state = await readState(this.filePath);
    return state.messages.filter((message) => message.taskId === taskId).map(copy);
  }

  async listAll(): Promise<WorkbenchMessageRecord[]> {
    const state = await readState(this.filePath);
    return state.messages.map(copy);
  }
}

class JsonFileWorkbenchTaskSnapshotRepository implements WorkbenchTaskSnapshotRepository {
  constructor(private readonly filePath: string) {}

  async save(snapshot: WorkbenchTaskSnapshotRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.taskSnapshots = upsertBy(
        state.taskSnapshots,
        copy(snapshot),
        (record) => record.taskId === snapshot.taskId
      );
    });
  }

  async getByTaskId(taskId: string): Promise<WorkbenchTaskSnapshotRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.taskSnapshots.find((snapshot) => snapshot.taskId === taskId));
  }
}

async function updateState(
  filePath: string,
  update: (state: JsonFileWorkbenchState) => void
): Promise<void> {
  await enqueueWrite(filePath, async () => {
    const state = await readState(filePath);
    update(state);
    await writeState(filePath, state);
  });
}

async function enqueueWrite(filePath: string, write: () => Promise<void>): Promise<void> {
  const previousWrite = writeQueuesByFilePath.get(filePath) ?? Promise.resolve();
  const nextWrite = previousWrite.catch(() => undefined).then(write);
  writeQueuesByFilePath.set(filePath, nextWrite);

  try {
    await nextWrite;
  } finally {
    if (writeQueuesByFilePath.get(filePath) === nextWrite) {
      writeQueuesByFilePath.delete(filePath);
    }
  }
}

async function readState(filePath: string): Promise<JsonFileWorkbenchState> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<JsonFileWorkbenchState>;
    return {
      projects: parsed.projects ?? [],
      workspaceMembers: parsed.workspaceMembers ?? [],
      projectMembers: parsed.projectMembers ?? [],
      briefs: parsed.briefs ?? [],
      pageVersions: parsed.pageVersions ?? [],
      artifactWorkspaces: parsed.artifactWorkspaces ?? [],
      artifactWorkspaceFiles: parsed.artifactWorkspaceFiles ?? [],
      deployments: parsed.deployments ?? [],
      tasks: parsed.tasks ?? [],
      messages: parsed.messages ?? [],
      taskSnapshots: parsed.taskSnapshots ?? [],
      skills: parsed.skills ?? [],
      skillVersions: parsed.skillVersions ?? [],
      skillBindings: parsed.skillBindings ?? [],
      modelProviders: parsed.modelProviders ?? [],
      modelRoutingPolicies: parsed.modelRoutingPolicies ?? [],
      mcpConnectors: parsed.mcpConnectors ?? [],
      mcpToolApprovals: parsed.mcpToolApprovals ?? [],
      runs: parsed.runs ?? [],
      runEvents: parsed.runEvents ?? [],
      toolObservations: parsed.toolObservations ?? [],
      agentHandoffs: parsed.agentHandoffs ?? []
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return emptyState();
    }
    throw error;
  }
}

async function writeState(filePath: string, state: JsonFileWorkbenchState): Promise<void> {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });
  const tempPath = join(directory, `.${process.pid}.${randomUUID()}.workbench-state.tmp`);
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function emptyState(): JsonFileWorkbenchState {
  return {
    projects: [],
    workspaceMembers: [],
    projectMembers: [],
    briefs: [],
    pageVersions: [],
    artifactWorkspaces: [],
    artifactWorkspaceFiles: [],
    deployments: [],
    tasks: [],
    messages: [],
    taskSnapshots: [],
    skills: [],
    skillVersions: [],
    skillBindings: [],
    modelProviders: [],
    modelRoutingPolicies: [],
    mcpConnectors: [],
    mcpToolApprovals: [],
    runs: [],
    runEvents: [],
    toolObservations: [],
    agentHandoffs: []
  };
}

function upsertBy<T>(records: T[], record: T, matches: (candidate: T) => boolean): T[] {
  const next = [...records];
  const index = next.findIndex(matches);
  if (index === -1) {
    next.push(record);
  } else {
    next[index] = record;
  }
  return next;
}

function copy<T>(record: T): T {
  return structuredClone(record);
}

function copyOptional<T>(record: T | undefined): T | undefined {
  return record ? copy(record) : undefined;
}

function compareWorkspaceMembers(
  a: WorkspaceMemberRecord,
  b: WorkspaceMemberRecord
): number {
  return (
    a.createdAt.localeCompare(b.createdAt) ||
    a.workspaceId.localeCompare(b.workspaceId) ||
    a.userId.localeCompare(b.userId) ||
    a.id.localeCompare(b.id)
  );
}

function compareProjectMembers(a: ProjectMemberRecord, b: ProjectMemberRecord): number {
  return (
    a.createdAt.localeCompare(b.createdAt) ||
    a.projectId.localeCompare(b.projectId) ||
    a.userId.localeCompare(b.userId) ||
    a.id.localeCompare(b.id)
  );
}

function compareRunEventsBySequence(a: RunEventRecord, b: RunEventRecord): number {
  return (
    a.sequence - b.sequence ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

function compareRunEventsByTimeline(a: RunEventRecord, b: RunEventRecord): number {
  return (
    a.createdAt.localeCompare(b.createdAt) ||
    a.runId.localeCompare(b.runId) ||
    a.sequence - b.sequence ||
    a.id.localeCompare(b.id)
  );
}

function compareToolObservationsByTimeline(
  a: ToolObservationRecord,
  b: ToolObservationRecord
): number {
  return (
    a.createdAt.localeCompare(b.createdAt) ||
    a.runId.localeCompare(b.runId) ||
    a.id.localeCompare(b.id)
  );
}

function compareAgentHandoffsByTimeline(
  a: AgentHandoffRecord,
  b: AgentHandoffRecord
): number {
  return (
    a.updatedAt.localeCompare(b.updatedAt) ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
