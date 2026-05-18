import type {
  ArtifactWorkspaceFilePath,
  ArtifactWorkspaceFileRecord,
  ArtifactWorkspaceRecord,
  StaticArtifacts
} from "@lp-agent/artifacts";
import type { DeploymentHandoff } from "@lp-agent/git-deployment";
import type { LPBrief, ProjectRole, ReviewFinding } from "@lp-agent/lp-schema";
import type { MCPToolDefinition } from "@lp-agent/mcp-gateway";
import type { AgentRole, ModelProviderRuntimeConfig } from "@lp-agent/model-gateway";
import type { SkillManifest, SkillScope, SkillType } from "@lp-agent/skills";

export type { ProjectRole } from "@lp-agent/lp-schema";

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: string;
}

export interface WorkspaceMemberRecord {
  id: string;
  workspaceId: string;
  userId: string;
  role: ProjectRole;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMemberRecord {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BriefRecord {
  id: string;
  projectId: string;
  prompt: string;
  brief: LPBrief;
  createdAt: string;
}

export type ReviewStatus = "pending" | "passed" | "failed";

export interface PageVersionRecord {
  id: string;
  projectId: string;
  briefId: string;
  artifactWorkspaceId?: string;
  artifacts: StaticArtifacts;
  reviewStatus: ReviewStatus;
  findings: ReviewFinding[];
  createdAt: string;
}

export type WorkbenchTaskType = "general_chat" | "lp_generation" | "project_setup";
export type WorkbenchTaskStatus = "complete";
export type WorkbenchMessageRole = "user" | "assistant";

export interface WorkbenchTaskRecord {
  id: string;
  title: string;
  type: WorkbenchTaskType;
  status: WorkbenchTaskStatus;
  projectId?: string;
  createdAt: string;
}

export interface WorkbenchMessageRecord {
  id: string;
  taskId: string;
  role: WorkbenchMessageRole;
  content: string;
  createdAt: string;
}

export interface WorkbenchTaskSnapshotRecord {
  taskId: string;
  projectId: string;
  briefId?: string;
  pageVersionId?: string;
  createdAt: string;
}

export type SkillContentType = "text/markdown" | "text/plain";

export interface SkillRecord {
  id: string;
  name: string;
  type: SkillType;
  scope: SkillScope;
  createdAt: string;
}

export interface SkillVersionRecord {
  id: string;
  skillId: string;
  version: string;
  manifest: SkillManifest;
  content: string;
  contentType: SkillContentType;
  reviewState: SkillManifest["reviewState"];
  createdAt: string;
}

export interface SkillBindingRecord {
  id: string;
  skillVersionId: string;
  scope: SkillScope;
  targetKey: string;
  organizationId?: string;
  workspaceId?: string;
  projectId?: string;
  enabled: boolean;
  settings?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type ModelProviderType = "mock" | "openai" | "anthropic" | "internal" | "custom";

export interface ModelProviderRecord {
  id: string;
  scope: SkillScope;
  targetKey: string;
  name: string;
  provider: ModelProviderType;
  config: ModelProviderRuntimeConfig;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModelRoutingPolicyRecord {
  id: string;
  scope: SkillScope;
  targetKey: string;
  role: AgentRole;
  providerId: string;
  model: string;
  fallback?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MCPConnectorRecord {
  id: string;
  scope: SkillScope;
  targetKey: string;
  name: string;
  description?: string;
  tools: MCPToolDefinition[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MCPToolApprovalRecord {
  id: string;
  projectId: string;
  connectorId: string;
  toolName: string;
  state: "pending" | "approved";
  approvedByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export type RunRecordState =
  | "running"
  | "needs_input"
  | "needs_approval"
  | "failed"
  | "completed"
  | "cancelled";
export type ToolObservationState = "running" | "completed" | "failed" | "cancelled";
export type AgentHandoffState = "ready" | "blocked" | "consumed";

export interface RunRecord {
  id: string;
  projectId: string;
  taskId?: string;
  role: AgentRole;
  state: RunRecordState;
  startedAt: string;
  completedAt?: string;
  contextSummary: {
    injected: string[];
    omitted: string[];
  };
}

export interface RunEventRecord {
  id: string;
  runId: string;
  projectId: string;
  taskId?: string;
  sequence: number;
  type: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ToolObservationRecord {
  id: string;
  runId: string;
  projectId: string;
  taskId?: string;
  toolName: string;
  input: Record<string, unknown>;
  outputSummary: string;
  state: ToolObservationState;
  exitCode?: number;
  errorName?: string;
  createdAt: string;
  completedAt?: string;
}

export interface AgentHandoffArtifactRefs {
  briefId?: string;
  pageVersionId?: string;
}

export interface AgentHandoffRecord {
  id: string;
  projectId: string;
  taskId?: string;
  fromRunId: string;
  fromRole: AgentRole;
  toRole: AgentRole;
  state: AgentHandoffState;
  summary: string;
  blockingReason?: string;
  artifactRefs?: AgentHandoffArtifactRefs;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRepository {
  save(project: ProjectRecord): Promise<void>;
  getById(projectId: string): Promise<ProjectRecord | undefined>;
  listAll(): Promise<ProjectRecord[]>;
}

export interface WorkspaceMemberRepository {
  save(member: WorkspaceMemberRecord): Promise<void>;
  getById(memberId: string): Promise<WorkspaceMemberRecord | undefined>;
  getByWorkspaceAndUser(
    workspaceId: string,
    userId: string
  ): Promise<WorkspaceMemberRecord | undefined>;
  listForWorkspace(workspaceId: string): Promise<WorkspaceMemberRecord[]>;
  listAll(): Promise<WorkspaceMemberRecord[]>;
}

export interface ProjectMemberRepository {
  save(member: ProjectMemberRecord): Promise<void>;
  getById(memberId: string): Promise<ProjectMemberRecord | undefined>;
  getByProjectAndUser(projectId: string, userId: string): Promise<ProjectMemberRecord | undefined>;
  listForProject(projectId: string): Promise<ProjectMemberRecord[]>;
  listAll(): Promise<ProjectMemberRecord[]>;
}

export interface BriefRepository {
  save(brief: BriefRecord): Promise<void>;
  getById(briefId: string): Promise<BriefRecord | undefined>;
  findLatestForProject(projectId: string): Promise<BriefRecord | undefined>;
  listAll(): Promise<BriefRecord[]>;
}

export interface PageVersionRepository {
  save(pageVersion: PageVersionRecord): Promise<void>;
  getById(pageVersionId: string): Promise<PageVersionRecord | undefined>;
  findLatestForProject(projectId: string): Promise<PageVersionRecord | undefined>;
  listAll(): Promise<PageVersionRecord[]>;
}

export interface ArtifactWorkspaceRepository {
  save(workspace: ArtifactWorkspaceRecord): Promise<void>;
  getById(workspaceId: string): Promise<ArtifactWorkspaceRecord | undefined>;
  getForPageVersion(pageVersionId: string): Promise<ArtifactWorkspaceRecord | undefined>;
  listForProject(projectId: string): Promise<ArtifactWorkspaceRecord[]>;
  listAll(): Promise<ArtifactWorkspaceRecord[]>;
}

export interface ArtifactWorkspaceFileRepository {
  save(file: ArtifactWorkspaceFileRecord): Promise<void>;
  getByPath(input: {
    workspaceId: string;
    path: ArtifactWorkspaceFilePath;
  }): Promise<ArtifactWorkspaceFileRecord | undefined>;
  listForWorkspace(workspaceId: string): Promise<ArtifactWorkspaceFileRecord[]>;
  listAll(): Promise<ArtifactWorkspaceFileRecord[]>;
}

export interface DeploymentRepository {
  save(deployment: DeploymentHandoff): Promise<void>;
  getByPageVersionId(pageVersionId: string): Promise<DeploymentHandoff | undefined>;
  findLatestForProject(projectId: string): Promise<DeploymentHandoff | undefined>;
}

export interface WorkbenchTaskRepository {
  save(task: WorkbenchTaskRecord): Promise<void>;
  getById(taskId: string): Promise<WorkbenchTaskRecord | undefined>;
  listAll(): Promise<WorkbenchTaskRecord[]>;
}

export interface WorkbenchMessageRepository {
  save(message: WorkbenchMessageRecord): Promise<void>;
  listForTask(taskId: string): Promise<WorkbenchMessageRecord[]>;
  listAll(): Promise<WorkbenchMessageRecord[]>;
}

export interface WorkbenchTaskSnapshotRepository {
  save(snapshot: WorkbenchTaskSnapshotRecord): Promise<void>;
  getByTaskId(taskId: string): Promise<WorkbenchTaskSnapshotRecord | undefined>;
}

export interface SkillRepository {
  save(skill: SkillRecord): Promise<void>;
  getById(skillId: string): Promise<SkillRecord | undefined>;
  listAll(): Promise<SkillRecord[]>;
}

export interface SkillVersionRepository {
  save(version: SkillVersionRecord): Promise<void>;
  getById(versionId: string): Promise<SkillVersionRecord | undefined>;
  getBySkillIdAndVersion(
    skillId: string,
    version: string
  ): Promise<SkillVersionRecord | undefined>;
  listForSkill(skillId: string): Promise<SkillVersionRecord[]>;
  listAll(): Promise<SkillVersionRecord[]>;
}

export interface SkillBindingRepository {
  save(binding: SkillBindingRecord): Promise<void>;
  getById(bindingId: string): Promise<SkillBindingRecord | undefined>;
  listForProject(projectId: string): Promise<SkillBindingRecord[]>;
  listAll(): Promise<SkillBindingRecord[]>;
}

export interface ModelProviderRepository {
  save(provider: ModelProviderRecord): Promise<void>;
  getById(providerId: string): Promise<ModelProviderRecord | undefined>;
  listForProject(projectId: string): Promise<ModelProviderRecord[]>;
  listAll(): Promise<ModelProviderRecord[]>;
}

export interface ModelRoutingPolicyRepository {
  save(policy: ModelRoutingPolicyRecord): Promise<void>;
  getById(policyId: string): Promise<ModelRoutingPolicyRecord | undefined>;
  getByProjectAndRole(
    projectId: string,
    role: AgentRole
  ): Promise<ModelRoutingPolicyRecord | undefined>;
  listForProject(projectId: string): Promise<ModelRoutingPolicyRecord[]>;
  listAll(): Promise<ModelRoutingPolicyRecord[]>;
}

export interface MCPConnectorRepository {
  save(connector: MCPConnectorRecord): Promise<void>;
  getById(connectorId: string): Promise<MCPConnectorRecord | undefined>;
  listForProject(projectId: string): Promise<MCPConnectorRecord[]>;
  listAll(): Promise<MCPConnectorRecord[]>;
}

export interface MCPToolApprovalRepository {
  save(approval: MCPToolApprovalRecord): Promise<void>;
  getByProjectConnectorAndTool(
    projectId: string,
    connectorId: string,
    toolName: string
  ): Promise<MCPToolApprovalRecord | undefined>;
  listForProject(projectId: string): Promise<MCPToolApprovalRecord[]>;
  listAll(): Promise<MCPToolApprovalRecord[]>;
}

export interface RunRepository {
  save(run: RunRecord): Promise<void>;
  getById(runId: string): Promise<RunRecord | undefined>;
  listForProject(projectId: string): Promise<RunRecord[]>;
  listForTask(taskId: string): Promise<RunRecord[]>;
  listAll(): Promise<RunRecord[]>;
}

export interface RunEventRepository {
  save(event: RunEventRecord): Promise<void>;
  listForRun(runId: string): Promise<RunEventRecord[]>;
  listForTask(taskId: string): Promise<RunEventRecord[]>;
  listForProject(projectId: string): Promise<RunEventRecord[]>;
  listAll(): Promise<RunEventRecord[]>;
}

export interface ToolObservationRepository {
  save(observation: ToolObservationRecord): Promise<void>;
  listForRun(runId: string): Promise<ToolObservationRecord[]>;
  listForTask(taskId: string): Promise<ToolObservationRecord[]>;
  listAll(): Promise<ToolObservationRecord[]>;
}

export interface AgentHandoffRepository {
  save(handoff: AgentHandoffRecord): Promise<void>;
  getById(handoffId: string): Promise<AgentHandoffRecord | undefined>;
  listForProject(projectId: string): Promise<AgentHandoffRecord[]>;
  listForTask(taskId: string): Promise<AgentHandoffRecord[]>;
  listInbound(input: {
    projectId: string;
    taskId?: string;
    toRole: AgentRole;
  }): Promise<AgentHandoffRecord[]>;
  listOutbound(input: {
    projectId: string;
    taskId?: string;
    fromRole: AgentRole;
  }): Promise<AgentHandoffRecord[]>;
  listAll(): Promise<AgentHandoffRecord[]>;
}

export interface WorkbenchRepositories {
  projects: ProjectRepository;
  workspaceMembers: WorkspaceMemberRepository;
  projectMembers: ProjectMemberRepository;
  briefs: BriefRepository;
  pageVersions: PageVersionRepository;
  artifactWorkspaces: ArtifactWorkspaceRepository;
  artifactWorkspaceFiles: ArtifactWorkspaceFileRepository;
  deployments: DeploymentRepository;
  tasks: WorkbenchTaskRepository;
  messages: WorkbenchMessageRepository;
  taskSnapshots: WorkbenchTaskSnapshotRepository;
  skills: SkillRepository;
  skillVersions: SkillVersionRepository;
  skillBindings: SkillBindingRepository;
  modelProviders: ModelProviderRepository;
  modelRoutingPolicies: ModelRoutingPolicyRepository;
  mcpConnectors: MCPConnectorRepository;
  mcpToolApprovals: MCPToolApprovalRepository;
  runs: RunRepository;
  runEvents: RunEventRepository;
  toolObservations: ToolObservationRepository;
  agentHandoffs: AgentHandoffRepository;
}

export function createInMemoryWorkbenchRepositories(): WorkbenchRepositories {
  return new InMemoryWorkbenchRepositories();
}

class InMemoryWorkbenchRepositories implements WorkbenchRepositories {
  readonly projects = new InMemoryProjectRepository();
  readonly workspaceMembers = new InMemoryWorkspaceMemberRepository();
  readonly projectMembers = new InMemoryProjectMemberRepository();
  readonly briefs = new InMemoryBriefRepository();
  readonly pageVersions = new InMemoryPageVersionRepository();
  readonly artifactWorkspaces = new InMemoryArtifactWorkspaceRepository();
  readonly artifactWorkspaceFiles = new InMemoryArtifactWorkspaceFileRepository();
  readonly deployments = new InMemoryDeploymentRepository();
  readonly tasks = new InMemoryWorkbenchTaskRepository();
  readonly messages = new InMemoryWorkbenchMessageRepository();
  readonly taskSnapshots = new InMemoryWorkbenchTaskSnapshotRepository();
  readonly skills = new InMemorySkillRepository();
  readonly skillVersions = new InMemorySkillVersionRepository();
  readonly skillBindings = new InMemorySkillBindingRepository();
  readonly modelProviders = new InMemoryModelProviderRepository();
  readonly modelRoutingPolicies = new InMemoryModelRoutingPolicyRepository();
  readonly mcpConnectors = new InMemoryMCPConnectorRepository();
  readonly mcpToolApprovals = new InMemoryMCPToolApprovalRepository();
  readonly runs = new InMemoryRunRepository();
  readonly runEvents = new InMemoryRunEventRepository();
  readonly toolObservations = new InMemoryToolObservationRepository();
  readonly agentHandoffs = new InMemoryAgentHandoffRepository();
}

class InMemoryRunRepository implements RunRepository {
  private readonly runs = new Map<string, RunRecord>();

  async save(run: RunRecord): Promise<void> {
    this.runs.set(run.id, copyRun(run));
  }

  async getById(runId: string): Promise<RunRecord | undefined> {
    const run = this.runs.get(runId);
    return run ? copyRun(run) : undefined;
  }

  async listForProject(projectId: string): Promise<RunRecord[]> {
    return [...this.runs.values()]
      .filter((run) => run.projectId === projectId)
      .map(copyRun);
  }

  async listForTask(taskId: string): Promise<RunRecord[]> {
    return [...this.runs.values()]
      .filter((run) => run.taskId === taskId)
      .map(copyRun);
  }

  async listAll(): Promise<RunRecord[]> {
    return [...this.runs.values()].map(copyRun);
  }
}

class InMemoryRunEventRepository implements RunEventRepository {
  private readonly events = new Map<string, RunEventRecord>();

  async save(event: RunEventRecord): Promise<void> {
    this.events.set(event.id, copyRunEvent(event));
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

  private sequenceSortedEvents(matches: (event: RunEventRecord) => boolean): RunEventRecord[] {
    return [...this.events.values()]
      .filter(matches)
      .sort(compareRunEventsBySequence)
      .map(copyRunEvent);
  }

  private timelineSortedEvents(matches: (event: RunEventRecord) => boolean): RunEventRecord[] {
    return [...this.events.values()]
      .filter(matches)
      .sort(compareRunEventsByTimeline)
      .map(copyRunEvent);
  }
}

class InMemoryToolObservationRepository implements ToolObservationRepository {
  private readonly observations = new Map<string, ToolObservationRecord>();

  async save(observation: ToolObservationRecord): Promise<void> {
    this.observations.set(observation.id, copyToolObservation(observation));
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

  private sortedObservations(
    matches: (observation: ToolObservationRecord) => boolean
  ): ToolObservationRecord[] {
    return [...this.observations.values()]
      .filter(matches)
      .sort(compareToolObservationsByTimeline)
      .map(copyToolObservation);
  }
}

class InMemoryAgentHandoffRepository implements AgentHandoffRepository {
  private readonly handoffs = new Map<string, AgentHandoffRecord>();

  async save(handoff: AgentHandoffRecord): Promise<void> {
    this.handoffs.set(handoff.id, copyAgentHandoff(handoff));
  }

  async getById(handoffId: string): Promise<AgentHandoffRecord | undefined> {
    const handoff = this.handoffs.get(handoffId);
    return handoff ? copyAgentHandoff(handoff) : undefined;
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

  private sortedHandoffs(matches: (handoff: AgentHandoffRecord) => boolean): AgentHandoffRecord[] {
    return [...this.handoffs.values()]
      .filter(matches)
      .sort(compareAgentHandoffsByTimeline)
      .map(copyAgentHandoff);
  }
}

class InMemorySkillRepository implements SkillRepository {
  private readonly skills = new Map<string, SkillRecord>();

  async save(skill: SkillRecord): Promise<void> {
    this.skills.set(skill.id, copySkill(skill));
  }

  async getById(skillId: string): Promise<SkillRecord | undefined> {
    const skill = this.skills.get(skillId);
    return skill ? copySkill(skill) : undefined;
  }

  async listAll(): Promise<SkillRecord[]> {
    return [...this.skills.values()].map(copySkill);
  }
}

class InMemorySkillVersionRepository implements SkillVersionRepository {
  private readonly versions = new Map<string, SkillVersionRecord>();

  async save(version: SkillVersionRecord): Promise<void> {
    this.versions.set(version.id, copySkillVersion(version));
  }

  async getById(versionId: string): Promise<SkillVersionRecord | undefined> {
    const version = this.versions.get(versionId);
    return version ? copySkillVersion(version) : undefined;
  }

  async getBySkillIdAndVersion(
    skillId: string,
    version: string
  ): Promise<SkillVersionRecord | undefined> {
    const record = [...this.versions.values()].find(
      (candidate) => candidate.skillId === skillId && candidate.version === version
    );
    return record ? copySkillVersion(record) : undefined;
  }

  async listForSkill(skillId: string): Promise<SkillVersionRecord[]> {
    return [...this.versions.values()]
      .filter((version) => version.skillId === skillId)
      .map(copySkillVersion);
  }

  async listAll(): Promise<SkillVersionRecord[]> {
    return [...this.versions.values()].map(copySkillVersion);
  }
}

class InMemorySkillBindingRepository implements SkillBindingRepository {
  private readonly bindings = new Map<string, SkillBindingRecord>();

  async save(binding: SkillBindingRecord): Promise<void> {
    this.bindings.set(binding.id, copySkillBinding(binding));
  }

  async getById(bindingId: string): Promise<SkillBindingRecord | undefined> {
    const binding = this.bindings.get(bindingId);
    return binding ? copySkillBinding(binding) : undefined;
  }

  async listForProject(projectId: string): Promise<SkillBindingRecord[]> {
    return [...this.bindings.values()]
      .filter((binding) => binding.projectId === projectId)
      .map(copySkillBinding);
  }

  async listAll(): Promise<SkillBindingRecord[]> {
    return [...this.bindings.values()].map(copySkillBinding);
  }
}

class InMemoryModelProviderRepository implements ModelProviderRepository {
  private readonly providers = new Map<string, ModelProviderRecord>();

  async save(provider: ModelProviderRecord): Promise<void> {
    this.providers.set(provider.id, copyModelProvider(provider));
  }

  async getById(providerId: string): Promise<ModelProviderRecord | undefined> {
    const provider = this.providers.get(providerId);
    return provider ? copyModelProvider(provider) : undefined;
  }

  async listForProject(projectId: string): Promise<ModelProviderRecord[]> {
    return [...this.providers.values()]
      .filter((provider) => provider.scope === "project" && provider.targetKey === projectId)
      .map(copyModelProvider);
  }

  async listAll(): Promise<ModelProviderRecord[]> {
    return [...this.providers.values()].map(copyModelProvider);
  }
}

class InMemoryModelRoutingPolicyRepository implements ModelRoutingPolicyRepository {
  private readonly policies = new Map<string, ModelRoutingPolicyRecord>();

  async save(policy: ModelRoutingPolicyRecord): Promise<void> {
    this.policies.set(policy.id, copyModelRoutingPolicy(policy));
  }

  async getById(policyId: string): Promise<ModelRoutingPolicyRecord | undefined> {
    const policy = this.policies.get(policyId);
    return policy ? copyModelRoutingPolicy(policy) : undefined;
  }

  async getByProjectAndRole(
    projectId: string,
    role: AgentRole
  ): Promise<ModelRoutingPolicyRecord | undefined> {
    const policy = [...this.policies.values()].find(
      (candidate) =>
        candidate.scope === "project" &&
        candidate.targetKey === projectId &&
        candidate.role === role
    );
    return policy ? copyModelRoutingPolicy(policy) : undefined;
  }

  async listForProject(projectId: string): Promise<ModelRoutingPolicyRecord[]> {
    return [...this.policies.values()]
      .filter((policy) => policy.scope === "project" && policy.targetKey === projectId)
      .map(copyModelRoutingPolicy);
  }

  async listAll(): Promise<ModelRoutingPolicyRecord[]> {
    return [...this.policies.values()].map(copyModelRoutingPolicy);
  }
}

class InMemoryMCPConnectorRepository implements MCPConnectorRepository {
  private readonly connectors = new Map<string, MCPConnectorRecord>();

  async save(connector: MCPConnectorRecord): Promise<void> {
    this.connectors.set(connector.id, copyMCPConnector(connector));
  }

  async getById(connectorId: string): Promise<MCPConnectorRecord | undefined> {
    const connector = this.connectors.get(connectorId);
    return connector ? copyMCPConnector(connector) : undefined;
  }

  async listForProject(projectId: string): Promise<MCPConnectorRecord[]> {
    return [...this.connectors.values()]
      .filter((connector) => connector.scope === "project" && connector.targetKey === projectId)
      .map(copyMCPConnector);
  }

  async listAll(): Promise<MCPConnectorRecord[]> {
    return [...this.connectors.values()].map(copyMCPConnector);
  }
}

class InMemoryMCPToolApprovalRepository implements MCPToolApprovalRepository {
  private readonly approvals = new Map<string, MCPToolApprovalRecord>();

  async save(approval: MCPToolApprovalRecord): Promise<void> {
    this.approvals.set(approval.id, copyMCPToolApproval(approval));
  }

  async getByProjectConnectorAndTool(
    projectId: string,
    connectorId: string,
    toolName: string
  ): Promise<MCPToolApprovalRecord | undefined> {
    const approval = [...this.approvals.values()].find(
      (candidate) =>
        candidate.projectId === projectId &&
        candidate.connectorId === connectorId &&
        candidate.toolName === toolName
    );
    return approval ? copyMCPToolApproval(approval) : undefined;
  }

  async listForProject(projectId: string): Promise<MCPToolApprovalRecord[]> {
    return [...this.approvals.values()]
      .filter((approval) => approval.projectId === projectId)
      .map(copyMCPToolApproval);
  }

  async listAll(): Promise<MCPToolApprovalRecord[]> {
    return [...this.approvals.values()].map(copyMCPToolApproval);
  }
}

class InMemoryProjectRepository implements ProjectRepository {
  private readonly projects = new Map<string, ProjectRecord>();

  async save(project: ProjectRecord): Promise<void> {
    this.projects.set(project.id, copyProject(project));
  }

  async getById(projectId: string): Promise<ProjectRecord | undefined> {
    const project = this.projects.get(projectId);
    return project ? copyProject(project) : undefined;
  }

  async listAll(): Promise<ProjectRecord[]> {
    return [...this.projects.values()].map(copyProject);
  }
}

class InMemoryWorkspaceMemberRepository implements WorkspaceMemberRepository {
  private readonly members = new Map<string, WorkspaceMemberRecord>();

  async save(member: WorkspaceMemberRecord): Promise<void> {
    this.members.set(member.id, copyWorkspaceMember(member));
  }

  async getById(memberId: string): Promise<WorkspaceMemberRecord | undefined> {
    const member = this.members.get(memberId);
    return member ? copyWorkspaceMember(member) : undefined;
  }

  async getByWorkspaceAndUser(
    workspaceId: string,
    userId: string
  ): Promise<WorkspaceMemberRecord | undefined> {
    const member = [...this.members.values()].find(
      (candidate) => candidate.workspaceId === workspaceId && candidate.userId === userId
    );
    return member ? copyWorkspaceMember(member) : undefined;
  }

  async listForWorkspace(workspaceId: string): Promise<WorkspaceMemberRecord[]> {
    return this.sortedMembers((member) => member.workspaceId === workspaceId);
  }

  async listAll(): Promise<WorkspaceMemberRecord[]> {
    return this.sortedMembers(() => true);
  }

  private sortedMembers(matches: (member: WorkspaceMemberRecord) => boolean) {
    return [...this.members.values()]
      .filter(matches)
      .sort(compareWorkspaceMembers)
      .map(copyWorkspaceMember);
  }
}

class InMemoryProjectMemberRepository implements ProjectMemberRepository {
  private readonly members = new Map<string, ProjectMemberRecord>();

  async save(member: ProjectMemberRecord): Promise<void> {
    this.members.set(member.id, copyProjectMember(member));
  }

  async getById(memberId: string): Promise<ProjectMemberRecord | undefined> {
    const member = this.members.get(memberId);
    return member ? copyProjectMember(member) : undefined;
  }

  async getByProjectAndUser(
    projectId: string,
    userId: string
  ): Promise<ProjectMemberRecord | undefined> {
    const member = [...this.members.values()].find(
      (candidate) => candidate.projectId === projectId && candidate.userId === userId
    );
    return member ? copyProjectMember(member) : undefined;
  }

  async listForProject(projectId: string): Promise<ProjectMemberRecord[]> {
    return this.sortedMembers((member) => member.projectId === projectId);
  }

  async listAll(): Promise<ProjectMemberRecord[]> {
    return this.sortedMembers(() => true);
  }

  private sortedMembers(matches: (member: ProjectMemberRecord) => boolean) {
    return [...this.members.values()]
      .filter(matches)
      .sort(compareProjectMembers)
      .map(copyProjectMember);
  }
}

class InMemoryBriefRepository implements BriefRepository {
  private readonly briefs = new Map<string, BriefRecord>();

  async save(brief: BriefRecord): Promise<void> {
    this.briefs.set(brief.id, copyBriefRecord(brief));
  }

  async getById(briefId: string): Promise<BriefRecord | undefined> {
    const brief = this.briefs.get(briefId);
    return brief ? copyBriefRecord(brief) : undefined;
  }

  async findLatestForProject(projectId: string): Promise<BriefRecord | undefined> {
    const brief = [...this.briefs.values()]
      .filter((record) => record.projectId === projectId)
      .at(-1);
    return brief ? copyBriefRecord(brief) : undefined;
  }

  async listAll(): Promise<BriefRecord[]> {
    return [...this.briefs.values()].map(copyBriefRecord);
  }
}

class InMemoryPageVersionRepository implements PageVersionRepository {
  private readonly pageVersions = new Map<string, PageVersionRecord>();

  async save(pageVersion: PageVersionRecord): Promise<void> {
    this.pageVersions.set(pageVersion.id, copyPageVersion(pageVersion));
  }

  async getById(pageVersionId: string): Promise<PageVersionRecord | undefined> {
    const pageVersion = this.pageVersions.get(pageVersionId);
    return pageVersion ? copyPageVersion(pageVersion) : undefined;
  }

  async findLatestForProject(projectId: string): Promise<PageVersionRecord | undefined> {
    const pageVersion = [...this.pageVersions.values()]
      .filter((record) => record.projectId === projectId)
      .at(-1);
    return pageVersion ? copyPageVersion(pageVersion) : undefined;
  }

  async listAll(): Promise<PageVersionRecord[]> {
    return [...this.pageVersions.values()].map(copyPageVersion);
  }
}

class InMemoryArtifactWorkspaceRepository implements ArtifactWorkspaceRepository {
  private readonly workspaces = new Map<string, ArtifactWorkspaceRecord>();

  async save(workspace: ArtifactWorkspaceRecord): Promise<void> {
    this.workspaces.set(workspace.id, copyArtifactWorkspace(workspace));
  }

  async getById(workspaceId: string): Promise<ArtifactWorkspaceRecord | undefined> {
    const workspace = this.workspaces.get(workspaceId);
    return workspace ? copyArtifactWorkspace(workspace) : undefined;
  }

  async getForPageVersion(pageVersionId: string): Promise<ArtifactWorkspaceRecord | undefined> {
    return this.sortedWorkspaces((workspace) => workspace.pageVersionId === pageVersionId).at(0);
  }

  async listForProject(projectId: string): Promise<ArtifactWorkspaceRecord[]> {
    return this.sortedWorkspaces((workspace) => workspace.projectId === projectId);
  }

  async listAll(): Promise<ArtifactWorkspaceRecord[]> {
    return this.sortedWorkspaces(() => true);
  }

  private sortedWorkspaces(
    matches: (workspace: ArtifactWorkspaceRecord) => boolean
  ): ArtifactWorkspaceRecord[] {
    return [...this.workspaces.values()]
      .filter(matches)
      .sort(compareArtifactWorkspaces)
      .map(copyArtifactWorkspace);
  }
}

class InMemoryArtifactWorkspaceFileRepository implements ArtifactWorkspaceFileRepository {
  private readonly files = new Map<string, ArtifactWorkspaceFileRecord>();

  async save(file: ArtifactWorkspaceFileRecord): Promise<void> {
    this.files.set(file.id, copyArtifactWorkspaceFile(file));
  }

  async getByPath(input: {
    workspaceId: string;
    path: ArtifactWorkspaceFilePath;
  }): Promise<ArtifactWorkspaceFileRecord | undefined> {
    return this.sortedFiles(
      (file) => file.workspaceId === input.workspaceId && file.path === input.path
    ).at(0);
  }

  async listForWorkspace(workspaceId: string): Promise<ArtifactWorkspaceFileRecord[]> {
    return this.sortedFiles((file) => file.workspaceId === workspaceId);
  }

  async listAll(): Promise<ArtifactWorkspaceFileRecord[]> {
    return this.sortedFiles(() => true);
  }

  private sortedFiles(
    matches: (file: ArtifactWorkspaceFileRecord) => boolean
  ): ArtifactWorkspaceFileRecord[] {
    return [...this.files.values()]
      .filter(matches)
      .sort(compareArtifactWorkspaceFiles)
      .map(copyArtifactWorkspaceFile);
  }
}

class InMemoryDeploymentRepository implements DeploymentRepository {
  private readonly deploymentsByPageVersion = new Map<string, DeploymentHandoff>();

  async save(deployment: DeploymentHandoff): Promise<void> {
    this.deploymentsByPageVersion.set(deployment.pageVersionId, copyDeployment(deployment));
  }

  async getByPageVersionId(pageVersionId: string): Promise<DeploymentHandoff | undefined> {
    const deployment = this.deploymentsByPageVersion.get(pageVersionId);
    return deployment ? copyDeployment(deployment) : undefined;
  }

  async findLatestForProject(projectId: string): Promise<DeploymentHandoff | undefined> {
    const deployment = [...this.deploymentsByPageVersion.values()]
      .filter((record) => record.projectId === projectId)
      .at(-1);
    return deployment ? copyDeployment(deployment) : undefined;
  }
}

class InMemoryWorkbenchTaskRepository implements WorkbenchTaskRepository {
  private readonly tasks = new Map<string, WorkbenchTaskRecord>();

  async save(task: WorkbenchTaskRecord): Promise<void> {
    this.tasks.set(task.id, copyWorkbenchTask(task));
  }

  async getById(taskId: string): Promise<WorkbenchTaskRecord | undefined> {
    const task = this.tasks.get(taskId);
    return task ? copyWorkbenchTask(task) : undefined;
  }

  async listAll(): Promise<WorkbenchTaskRecord[]> {
    return [...this.tasks.values()].map(copyWorkbenchTask);
  }
}

class InMemoryWorkbenchMessageRepository implements WorkbenchMessageRepository {
  private readonly messages = new Map<string, WorkbenchMessageRecord>();

  async save(message: WorkbenchMessageRecord): Promise<void> {
    this.messages.set(message.id, copyWorkbenchMessage(message));
  }

  async listForTask(taskId: string): Promise<WorkbenchMessageRecord[]> {
    return [...this.messages.values()]
      .filter((message) => message.taskId === taskId)
      .map(copyWorkbenchMessage);
  }

  async listAll(): Promise<WorkbenchMessageRecord[]> {
    return [...this.messages.values()].map(copyWorkbenchMessage);
  }
}

class InMemoryWorkbenchTaskSnapshotRepository implements WorkbenchTaskSnapshotRepository {
  private readonly snapshotsByTask = new Map<string, WorkbenchTaskSnapshotRecord>();

  async save(snapshot: WorkbenchTaskSnapshotRecord): Promise<void> {
    this.snapshotsByTask.set(snapshot.taskId, copyWorkbenchTaskSnapshot(snapshot));
  }

  async getByTaskId(taskId: string): Promise<WorkbenchTaskSnapshotRecord | undefined> {
    const snapshot = this.snapshotsByTask.get(taskId);
    return snapshot ? copyWorkbenchTaskSnapshot(snapshot) : undefined;
  }
}

function copyProject(project: ProjectRecord): ProjectRecord {
  return { ...project };
}

function copyWorkspaceMember(member: WorkspaceMemberRecord): WorkspaceMemberRecord {
  return { ...member };
}

function copyProjectMember(member: ProjectMemberRecord): ProjectMemberRecord {
  return { ...member };
}

function copySkill(skill: SkillRecord): SkillRecord {
  return { ...skill };
}

function copySkillVersion(version: SkillVersionRecord): SkillVersionRecord {
  return {
    ...version,
    manifest: structuredClone(version.manifest)
  };
}

function copySkillBinding(binding: SkillBindingRecord): SkillBindingRecord {
  return {
    ...binding,
    settings: binding.settings ? structuredClone(binding.settings) : undefined
  };
}

function copyModelProvider(provider: ModelProviderRecord): ModelProviderRecord {
  return {
    ...provider,
    config: structuredClone(provider.config)
  };
}

function copyModelRoutingPolicy(policy: ModelRoutingPolicyRecord): ModelRoutingPolicyRecord {
  const copy: ModelRoutingPolicyRecord = { ...policy };
  if (policy.fallback) {
    copy.fallback = structuredClone(policy.fallback);
  }
  if (policy.settings) {
    copy.settings = structuredClone(policy.settings);
  }
  return copy;
}

function copyMCPConnector(connector: MCPConnectorRecord): MCPConnectorRecord {
  return {
    ...connector,
    tools: connector.tools.map((tool) => ({
      ...tool,
      roles: [...tool.roles]
    }))
  };
}

function copyMCPToolApproval(approval: MCPToolApprovalRecord): MCPToolApprovalRecord {
  return { ...approval };
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

function compareArtifactWorkspaces(
  a: ArtifactWorkspaceRecord,
  b: ArtifactWorkspaceRecord
): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

const artifactWorkspaceFilePathOrder = new Map<ArtifactWorkspaceFilePath, number>([
  ["index.html", 0],
  ["styles.css", 1],
  ["script.js", 2]
]);

function compareArtifactWorkspaceFiles(
  a: ArtifactWorkspaceFileRecord,
  b: ArtifactWorkspaceFileRecord
): number {
  return (
    getArtifactWorkspaceFilePathOrder(a.path) - getArtifactWorkspaceFilePathOrder(b.path) ||
    a.id.localeCompare(b.id)
  );
}

function getArtifactWorkspaceFilePathOrder(path: ArtifactWorkspaceFilePath): number {
  return artifactWorkspaceFilePathOrder.get(path) ?? Number.MAX_SAFE_INTEGER;
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

function copyRun(run: RunRecord): RunRecord {
  return {
    ...run,
    contextSummary: {
      injected: [...run.contextSummary.injected],
      omitted: [...run.contextSummary.omitted]
    }
  };
}

function copyRunEvent(event: RunEventRecord): RunEventRecord {
  return {
    ...event,
    payload: structuredClone(event.payload)
  };
}

function copyToolObservation(observation: ToolObservationRecord): ToolObservationRecord {
  return {
    ...observation,
    input: structuredClone(observation.input)
  };
}

function copyAgentHandoff(handoff: AgentHandoffRecord): AgentHandoffRecord {
  return {
    ...handoff,
    ...(handoff.artifactRefs ? { artifactRefs: { ...handoff.artifactRefs } } : {})
  };
}

function copyBriefRecord(record: BriefRecord): BriefRecord {
  return {
    ...record,
    brief: structuredClone(record.brief)
  };
}

function copyPageVersion(pageVersion: PageVersionRecord): PageVersionRecord {
  return {
    ...pageVersion,
    artifacts: { ...pageVersion.artifacts },
    findings: pageVersion.findings.map((finding) => ({ ...finding }))
  };
}

function copyArtifactWorkspace(workspace: ArtifactWorkspaceRecord): ArtifactWorkspaceRecord {
  return { ...workspace };
}

function copyArtifactWorkspaceFile(
  file: ArtifactWorkspaceFileRecord
): ArtifactWorkspaceFileRecord {
  return { ...file };
}

function copyDeployment(deployment: DeploymentHandoff): DeploymentHandoff {
  return {
    ...deployment,
    files: [...deployment.files]
  };
}

function copyWorkbenchTask(task: WorkbenchTaskRecord): WorkbenchTaskRecord {
  return { ...task };
}

function copyWorkbenchMessage(message: WorkbenchMessageRecord): WorkbenchMessageRecord {
  return { ...message };
}

function copyWorkbenchTaskSnapshot(
  snapshot: WorkbenchTaskSnapshotRecord
): WorkbenchTaskSnapshotRecord {
  return { ...snapshot };
}
