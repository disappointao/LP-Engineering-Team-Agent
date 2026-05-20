import type {
  AgentHandoffArtifactRefs,
  AgentHandoffRecord,
  AgentHandoffState,
  MCPConnectorRecord,
  MCPToolApprovalRecord,
  ModelProviderRecord,
  ModelRoutingPolicyRecord,
  ProjectMemberRecord,
  ProjectRecord,
  RunEventRecord,
  RunRecord,
  RunRecordState,
  SkillBindingRecord,
  SkillRecord,
  SkillVersionRecord
} from "./workbench-repositories";
import type { DeploymentHandoff } from "@lp-agent/git-deployment";
import type { AgentRole } from "@lp-agent/model-gateway";

export interface PrismaProjectRow {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: Date;
}

export interface PrismaProjectCreate {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: Date;
}

export interface PrismaProjectMemberRow extends PrismaProjectMemberCreate {}

export interface PrismaProjectMemberCreate {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectMemberRecord["role"];
  displayName?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaSkillRow extends PrismaSkillCreate {}

export interface PrismaSkillCreate {
  id: string;
  name: string;
  type: SkillRecord["type"];
  scope: SkillRecord["scope"];
  createdAt: Date;
}

export interface PrismaSkillVersionRow extends PrismaSkillVersionCreate {}

export interface PrismaSkillVersionCreate {
  id: string;
  skillId: string;
  version: string;
  manifest: SkillVersionRecord["manifest"];
  content: string;
  contentType: SkillVersionRecord["contentType"];
  reviewState: SkillVersionRecord["reviewState"];
  createdAt: Date;
}

export interface PrismaSkillBindingRow extends PrismaSkillBindingCreate {}

export interface PrismaSkillBindingCreate {
  id: string;
  skillVersionId: string;
  scope: SkillBindingRecord["scope"];
  targetKey: string;
  organizationId?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  enabled: boolean;
  settings?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaModelProviderRow extends PrismaModelProviderCreate {}

export interface PrismaModelProviderCreate {
  id: string;
  scope: ModelProviderRecord["scope"];
  targetKey: string;
  name: string;
  provider: ModelProviderRecord["provider"];
  config: ModelProviderRecord["config"];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaModelRoutingPolicyRow extends PrismaModelRoutingPolicyCreate {}

export interface PrismaModelRoutingPolicyCreate {
  id: string;
  scope: ModelRoutingPolicyRecord["scope"];
  targetKey: string;
  role: AgentRole;
  providerId: string;
  model: string;
  fallback?: Record<string, unknown> | null;
  settings?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaMCPConnectorRow {
  id: string;
  scope: MCPConnectorRecord["scope"];
  targetKey: string;
  name: string;
  description?: string | null;
  toolsJson?: unknown | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaMCPConnectorCreate {
  id: string;
  scope: MCPConnectorRecord["scope"];
  targetKey: string;
  name: string;
  description?: string | null;
  toolsJson: MCPConnectorRecord["tools"];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaMCPToolApprovalRow extends PrismaMCPToolApprovalCreate {}

export interface PrismaMCPToolApprovalCreate {
  id: string;
  projectId: string;
  connectorId: string;
  toolName: string;
  state: MCPToolApprovalRecord["state"];
  approvedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaDeploymentRow extends PrismaDeploymentCreate {
  createdAt: Date;
}

export interface PrismaDeploymentCreate {
  id: string;
  projectId: string;
  pageVersionId: string;
  branch: string;
  commitSha: string;
  pullRequestUrl: string;
  status: DeploymentHandoff["status"];
  files: unknown;
}

export interface PrismaRunRow {
  id: string;
  projectId: string;
  taskId?: string | null;
  role: AgentRole;
  state: RunRecordState;
  startedAt: Date;
  completedAt?: Date | null;
  contextSummary: unknown;
}

export interface PrismaRunCreate {
  id: string;
  projectId: string;
  taskId?: string;
  role: AgentRole;
  state: RunRecordState;
  startedAt: Date;
  completedAt?: Date;
  contextSummary: RunRecord["contextSummary"];
}

export interface PrismaRunEventRow {
  id: string;
  runId: string;
  projectId: string;
  taskId?: string | null;
  sequence: number;
  type: string;
  message: string;
  payload: unknown;
  createdAt: Date;
}

export interface PrismaRunEventCreate {
  id: string;
  runId: string;
  projectId: string;
  taskId?: string;
  sequence: number;
  type: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface PrismaAgentHandoffRow {
  id: string;
  projectId: string;
  taskId?: string | null;
  fromRunId: string;
  fromRole: AgentRole;
  toRole: AgentRole;
  state: AgentHandoffState;
  summary: string;
  blockingReason?: string | null;
  artifactRefs?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaAgentHandoffCreate {
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
  createdAt: Date;
  updatedAt: Date;
}

export function toPrismaProjectCreate(
  project: ProjectRecord,
  workspaceId: string
): PrismaProjectCreate {
  return {
    id: project.id,
    workspaceId,
    name: project.name,
    createdAt: new Date(project.createdAt)
  };
}

export function toRepositoryProject(row: PrismaProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString()
  };
}

export function toPrismaProjectMemberCreate(
  member: ProjectMemberRecord
): PrismaProjectMemberCreate {
  return {
    id: member.id,
    projectId: member.projectId,
    userId: member.userId,
    role: member.role,
    ...(isDefined(member.displayName) ? { displayName: member.displayName } : {}),
    createdAt: new Date(member.createdAt),
    updatedAt: new Date(member.updatedAt)
  };
}

export function toRepositoryProjectMember(row: PrismaProjectMemberRow): ProjectMemberRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    role: row.role,
    ...(isPresentRowValue(row.displayName) ? { displayName: row.displayName } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function toPrismaSkillCreate(skill: SkillRecord): PrismaSkillCreate {
  return {
    id: skill.id,
    name: skill.name,
    type: skill.type,
    scope: skill.scope,
    createdAt: new Date(skill.createdAt)
  };
}

export function toRepositorySkill(row: PrismaSkillRow): SkillRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    scope: row.scope,
    createdAt: row.createdAt.toISOString()
  };
}

export function toPrismaSkillVersionCreate(
  version: SkillVersionRecord
): PrismaSkillVersionCreate {
  return {
    id: version.id,
    skillId: version.skillId,
    version: version.version,
    manifest: cloneJson(version.manifest),
    content: version.content,
    contentType: version.contentType,
    reviewState: version.reviewState,
    createdAt: new Date(version.createdAt)
  };
}

export function toRepositorySkillVersion(row: PrismaSkillVersionRow): SkillVersionRecord {
  return {
    id: row.id,
    skillId: row.skillId,
    version: row.version,
    manifest: cloneJson(row.manifest),
    content: row.content,
    contentType: row.contentType,
    reviewState: row.reviewState,
    createdAt: row.createdAt.toISOString()
  };
}

export function toPrismaSkillBindingCreate(
  binding: SkillBindingRecord
): PrismaSkillBindingCreate {
  return {
    id: binding.id,
    skillVersionId: binding.skillVersionId,
    scope: binding.scope,
    targetKey: binding.targetKey,
    ...(isDefined(binding.organizationId) ? { organizationId: binding.organizationId } : {}),
    ...(isDefined(binding.workspaceId) ? { workspaceId: binding.workspaceId } : {}),
    ...(isDefined(binding.projectId) ? { projectId: binding.projectId } : {}),
    enabled: binding.enabled,
    ...(binding.settings ? { settings: cloneRecord(binding.settings) } : {}),
    createdAt: new Date(binding.createdAt),
    updatedAt: new Date(binding.updatedAt)
  };
}

export function toRepositorySkillBinding(row: PrismaSkillBindingRow): SkillBindingRecord {
  return {
    id: row.id,
    skillVersionId: row.skillVersionId,
    scope: row.scope,
    targetKey: row.targetKey,
    ...(isPresentRowValue(row.organizationId) ? { organizationId: row.organizationId } : {}),
    ...(isPresentRowValue(row.workspaceId) ? { workspaceId: row.workspaceId } : {}),
    ...(isPresentRowValue(row.projectId) ? { projectId: row.projectId } : {}),
    enabled: row.enabled,
    ...(row.settings ? { settings: cloneRecord(row.settings) } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function toPrismaModelProviderCreate(
  provider: ModelProviderRecord
): PrismaModelProviderCreate {
  return {
    id: provider.id,
    scope: provider.scope,
    targetKey: provider.targetKey,
    name: provider.name,
    provider: provider.provider,
    config: cloneJson(provider.config),
    enabled: provider.enabled,
    createdAt: new Date(provider.createdAt),
    updatedAt: new Date(provider.updatedAt)
  };
}

export function toRepositoryModelProvider(row: PrismaModelProviderRow): ModelProviderRecord {
  return {
    id: row.id,
    scope: row.scope,
    targetKey: row.targetKey,
    name: row.name,
    provider: row.provider,
    config: cloneJson(row.config),
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function toPrismaModelRoutingPolicyCreate(
  policy: ModelRoutingPolicyRecord
): PrismaModelRoutingPolicyCreate {
  return {
    id: policy.id,
    scope: policy.scope,
    targetKey: policy.targetKey,
    role: policy.role,
    providerId: policy.providerId,
    model: policy.model,
    ...(policy.fallback ? { fallback: cloneRecord(policy.fallback) } : {}),
    ...(policy.settings ? { settings: cloneRecord(policy.settings) } : {}),
    createdAt: new Date(policy.createdAt),
    updatedAt: new Date(policy.updatedAt)
  };
}

export function toRepositoryModelRoutingPolicy(
  row: PrismaModelRoutingPolicyRow
): ModelRoutingPolicyRecord {
  return {
    id: row.id,
    scope: row.scope,
    targetKey: row.targetKey,
    role: row.role,
    providerId: row.providerId,
    model: row.model,
    ...(row.fallback ? { fallback: cloneRecord(row.fallback) } : {}),
    ...(row.settings ? { settings: cloneRecord(row.settings) } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function toPrismaMCPConnectorCreate(
  connector: MCPConnectorRecord
): PrismaMCPConnectorCreate {
  return {
    id: connector.id,
    scope: connector.scope,
    targetKey: connector.targetKey,
    name: connector.name,
    ...(isDefined(connector.description) ? { description: connector.description } : {}),
    toolsJson: cloneJson(connector.tools),
    enabled: connector.enabled,
    createdAt: new Date(connector.createdAt),
    updatedAt: new Date(connector.updatedAt)
  };
}

export function toRepositoryMCPConnector(row: PrismaMCPConnectorRow): MCPConnectorRecord {
  return {
    id: row.id,
    scope: row.scope,
    targetKey: row.targetKey,
    name: row.name,
    ...(isPresentRowValue(row.description) ? { description: row.description } : {}),
    tools: cloneMCPToolsOrEmpty(row.toolsJson),
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function toPrismaMCPToolApprovalCreate(
  approval: MCPToolApprovalRecord
): PrismaMCPToolApprovalCreate {
  return {
    id: approval.id,
    projectId: approval.projectId,
    connectorId: approval.connectorId,
    toolName: approval.toolName,
    state: approval.state,
    ...(isDefined(approval.approvedByUserId)
      ? { approvedByUserId: approval.approvedByUserId }
      : {}),
    createdAt: new Date(approval.createdAt),
    updatedAt: new Date(approval.updatedAt)
  };
}

export function toRepositoryMCPToolApproval(
  row: PrismaMCPToolApprovalRow
): MCPToolApprovalRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    connectorId: row.connectorId,
    toolName: row.toolName,
    state: row.state,
    ...(isPresentRowValue(row.approvedByUserId)
      ? { approvedByUserId: row.approvedByUserId }
      : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function toPrismaDeploymentCreate(
  deployment: DeploymentHandoff
): PrismaDeploymentCreate {
  return {
    id: deployment.id,
    projectId: deployment.projectId,
    pageVersionId: deployment.pageVersionId,
    branch: deployment.branch,
    commitSha: deployment.commitSha,
    pullRequestUrl: deployment.pullRequestUrl,
    files: [...deployment.files],
    status: deployment.status
  };
}

export function toRepositoryDeployment(row: PrismaDeploymentRow): DeploymentHandoff {
  return {
    id: row.id,
    projectId: row.projectId,
    pageVersionId: row.pageVersionId,
    branch: row.branch,
    commitSha: row.commitSha,
    pullRequestUrl: row.pullRequestUrl,
    files: ["index.html", "styles.css", "script.js"],
    status: row.status
  };
}

export function toPrismaRunCreate(run: RunRecord): PrismaRunCreate {
  return {
    id: run.id,
    projectId: run.projectId,
    ...(run.taskId ? { taskId: run.taskId } : {}),
    role: run.role,
    state: run.state,
    startedAt: new Date(run.startedAt),
    ...(run.completedAt ? { completedAt: new Date(run.completedAt) } : {}),
    contextSummary: cloneContextSummary(run.contextSummary)
  };
}

export function toRepositoryRun(row: PrismaRunRow): RunRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    ...(row.taskId ? { taskId: row.taskId } : {}),
    role: row.role,
    state: row.state,
    startedAt: row.startedAt.toISOString(),
    ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
    contextSummary: cloneContextSummaryOrDefault(row.contextSummary)
  };
}

export function toPrismaRunEventCreate(event: RunEventRecord): PrismaRunEventCreate {
  return {
    id: event.id,
    runId: event.runId,
    projectId: event.projectId,
    ...(event.taskId ? { taskId: event.taskId } : {}),
    sequence: event.sequence,
    type: event.type,
    message: event.message,
    payload: cloneRecord(event.payload),
    createdAt: new Date(event.createdAt)
  };
}

export function toRepositoryRunEvent(row: PrismaRunEventRow): RunEventRecord {
  return {
    id: row.id,
    runId: row.runId,
    projectId: row.projectId,
    ...(row.taskId ? { taskId: row.taskId } : {}),
    sequence: row.sequence,
    type: row.type,
    message: row.message,
    payload: cloneRecordOrDefault(row.payload),
    createdAt: row.createdAt.toISOString()
  };
}

export function toPrismaAgentHandoffCreate(
  handoff: AgentHandoffRecord
): PrismaAgentHandoffCreate {
  return {
    id: handoff.id,
    projectId: handoff.projectId,
    ...(handoff.taskId ? { taskId: handoff.taskId } : {}),
    fromRunId: handoff.fromRunId,
    fromRole: handoff.fromRole,
    toRole: handoff.toRole,
    state: handoff.state,
    summary: handoff.summary,
    ...(handoff.blockingReason ? { blockingReason: handoff.blockingReason } : {}),
    ...(handoff.artifactRefs ? { artifactRefs: cloneArtifactRefs(handoff.artifactRefs) } : {}),
    createdAt: new Date(handoff.createdAt),
    updatedAt: new Date(handoff.updatedAt)
  };
}

export function toRepositoryAgentHandoff(row: PrismaAgentHandoffRow): AgentHandoffRecord {
  const artifactRefs = cloneArtifactRefsOrUndefined(row.artifactRefs);

  return {
    id: row.id,
    projectId: row.projectId,
    ...(row.taskId ? { taskId: row.taskId } : {}),
    fromRunId: row.fromRunId,
    fromRole: row.fromRole,
    toRole: row.toRole,
    state: row.state,
    summary: row.summary,
    ...(row.blockingReason ? { blockingReason: row.blockingReason } : {}),
    ...(artifactRefs ? { artifactRefs } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function cloneContextSummary(contextSummary: RunRecord["contextSummary"]): RunRecord["contextSummary"] {
  return {
    injected: [...contextSummary.injected],
    omitted: [...contextSummary.omitted]
  };
}

function cloneContextSummaryOrDefault(contextSummary: unknown): RunRecord["contextSummary"] {
  if (!isRecord(contextSummary)) {
    return emptyContextSummary();
  }

  const injected = contextSummary.injected;
  const omitted = contextSummary.omitted;
  if (!isStringArray(injected) || !isStringArray(omitted)) {
    return emptyContextSummary();
  }

  return {
    injected: [...injected],
    omitted: [...omitted]
  };
}

function emptyContextSummary(): RunRecord["contextSummary"] {
  return {
    injected: [],
    omitted: []
  };
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(record);
}

function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

function cloneMCPToolsOrEmpty(value: unknown): MCPConnectorRecord["tools"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return cloneJson(value) as MCPConnectorRecord["tools"];
}

function cloneRecordOrDefault(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  return cloneRecord(value);
}

function cloneArtifactRefs(artifactRefs: AgentHandoffArtifactRefs): AgentHandoffArtifactRefs {
  return structuredClone(artifactRefs);
}

function cloneArtifactRefsOrUndefined(value: unknown): AgentHandoffArtifactRefs | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const artifactRefs: AgentHandoffArtifactRefs = {};
  if (typeof value.briefId === "string") {
    artifactRefs.briefId = value.briefId;
  }
  if (typeof value.pageVersionId === "string") {
    artifactRefs.pageVersionId = value.pageVersionId;
  }

  return Object.keys(artifactRefs).length > 0 ? artifactRefs : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isPresentRowValue<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
