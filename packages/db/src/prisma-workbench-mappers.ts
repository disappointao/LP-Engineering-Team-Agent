import type {
  AgentHandoffArtifactRefs,
  AgentHandoffRecord,
  AgentHandoffState,
  ProjectRecord,
  RunEventRecord,
  RunRecord,
  RunRecordState
} from "./workbench-repositories";
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
