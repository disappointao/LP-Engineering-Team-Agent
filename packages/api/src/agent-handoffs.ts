import { z } from "zod";
import type { AgentHandoffRecord, WorkbenchRepositories } from "@lp-agent/db";
import {
  agentRoles,
  type AgentRole,
  type ModelAgentHandoffSummary
} from "@lp-agent/model-gateway";

export const AgentHandoffArtifactRefsSchema = z.object({
  briefId: z.string().min(1).optional(),
  pageVersionId: z.string().min(1).optional()
});

export const AgentHandoffRecordSchema: z.ZodType<AgentHandoffRecord> = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  taskId: z.string().min(1).optional(),
  fromRunId: z.string().min(1),
  fromRole: z.enum(agentRoles),
  toRole: z.enum(agentRoles),
  state: z.enum(["ready", "blocked", "consumed"]),
  summary: z.string().min(1),
  blockingReason: z.string().min(1).optional(),
  artifactRefs: AgentHandoffArtifactRefsSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const RuntimeHandoffSummarySchema: z.ZodType<ModelAgentHandoffSummary> = z.object({
  id: z.string().min(1),
  fromRunId: z.string().min(1),
  fromRole: z.enum(agentRoles),
  toRole: z.enum(agentRoles),
  state: z.enum(["ready", "blocked", "consumed"]),
  summary: z.string().min(1),
  blockingReason: z.string().min(1).optional(),
  artifactRefs: AgentHandoffArtifactRefsSchema.optional(),
  updatedAt: z.string().datetime()
});

export interface RunEventDraft {
  type: string;
  message: string;
  payload: Record<string, unknown>;
  beforePersist?: () => Promise<void>;
  rollbackPersist?: () => Promise<void>;
}

export interface AssembleRuntimeHandoffsResult {
  handoffs: ModelAgentHandoffSummary[];
  trace: {
    injected: string[];
    omitted: string[];
  };
}

const HANDOFF_SUMMARY_LIMIT = 240;
const HANDOFF_SELECTION_LIMIT = 6;
const REDACTION = "[REDACTED]";

export function createAgentHandoffRecord(input: {
  id: string;
  projectId: string;
  taskId?: string;
  fromRunId: string;
  fromRole: AgentRole;
  toRole: AgentRole;
  state: AgentHandoffRecord["state"];
  summary: string;
  blockingReason?: string;
  artifactRefs?: AgentHandoffRecord["artifactRefs"];
  now: () => Date;
}): AgentHandoffRecord {
  const timestamp = input.now().toISOString();
  const record: AgentHandoffRecord = {
    id: input.id,
    projectId: input.projectId,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    fromRunId: input.fromRunId,
    fromRole: input.fromRole,
    toRole: input.toRole,
    state: input.state,
    summary: sanitizeAndBoundHandoffText(input.summary),
    ...(input.blockingReason
      ? { blockingReason: sanitizeAndBoundHandoffText(input.blockingReason) }
      : {}),
    ...(input.artifactRefs ? { artifactRefs: { ...input.artifactRefs } } : {}),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  return AgentHandoffRecordSchema.parse(record);
}

export function sanitizeHandoffText(value: string): string {
  return value
    .replace(/<!doctype[\s\S]*?<\/html>/giu, "[artifact omitted]")
    .replace(/<html[\s\S]*?<\/html>/giu, "[artifact omitted]")
    .replace(
      /\b[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      (match) => `${match.split(/[:=]/u)[0]}=${REDACTION}`
    )
    .replace(
      /\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|secret)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      `$1${REDACTION}`
    )
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}\b/giu, `$1${REDACTION}`)
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/giu, REDACTION)
    .replace(/\bsecret-token\b/giu, REDACTION);
}

export function toHandoffRunEventDraft(handoff: AgentHandoffRecord): RunEventDraft {
  const payload = toHandoffEventPayload(handoff);
  if (handoff.state === "blocked") {
    return {
      type: "handoff.blocked",
      message: "Agent handoff blocked.",
      payload
    };
  }
  if (handoff.state === "consumed") {
    return {
      type: "handoff.consumed",
      message: "Agent handoff consumed.",
      payload
    };
  }
  return {
    type: "handoff.created",
    message: "Agent handoff ready.",
    payload
  };
}

export async function assembleRuntimeHandoffs(input: {
  repositories: WorkbenchRepositories;
  projectId: string;
  taskId?: string;
  role: AgentRole;
  limit?: number;
}): Promise<AssembleRuntimeHandoffsResult> {
  const limit = Math.max(0, Math.floor(input.limit ?? HANDOFF_SELECTION_LIMIT));
  const [inbound, outbound] = await Promise.all([
    input.repositories.agentHandoffs.listInbound({
      projectId: input.projectId,
      taskId: input.taskId,
      toRole: input.role
    }),
    input.repositories.agentHandoffs.listOutbound({
      projectId: input.projectId,
      taskId: input.taskId,
      fromRole: input.role
    })
  ]);
  const deduped = dedupeHandoffs([...inbound, ...outbound]).filter((handoff) =>
    matchesTaskScope(handoff, input.taskId)
  );
  const selected = deduped.slice(0, limit).map(toRuntimeHandoffSummary);
  return {
    handoffs: selected.map((handoff) => RuntimeHandoffSummarySchema.parse(handoff)),
    trace: {
      injected: selected.length > 0 ? [`handoffs:${selected.length}`] : [],
      omitted: deduped.length === 0
        ? ["handoffs:none"]
        : selected.length < deduped.length
          ? ["handoffs:budget_exceeded"]
          : []
    }
  };
}

export async function markInboundHandoffsConsumed(input: {
  repositories: WorkbenchRepositories;
  projectId: string;
  taskId?: string;
  role: AgentRole;
  now: () => Date;
}): Promise<RunEventDraft[]> {
  const inbound = await input.repositories.agentHandoffs.listInbound({
    projectId: input.projectId,
    taskId: input.taskId,
    toRole: input.role
  });
  const ready = inbound.filter(
    (handoff) => handoff.state === "ready" && matchesTaskScope(handoff, input.taskId)
  );
  const timestamp = input.now().toISOString();
  const events: RunEventDraft[] = [];
  for (const handoff of ready) {
    const consumed = AgentHandoffRecordSchema.parse({
      ...handoff,
      state: "consumed",
      summary: sanitizeAndBoundHandoffText(handoff.summary),
      ...(handoff.blockingReason
        ? { blockingReason: sanitizeAndBoundHandoffText(handoff.blockingReason) }
        : {}),
      ...(handoff.artifactRefs ? { artifactRefs: { ...handoff.artifactRefs } } : {}),
      updatedAt: timestamp
    });
    events.push({
      ...toHandoffRunEventDraft(consumed),
      beforePersist: () => input.repositories.agentHandoffs.save(consumed),
      rollbackPersist: () => input.repositories.agentHandoffs.save(handoff)
    });
  }
  return events;
}

export function toRuntimeHandoffSummary(
  handoff: AgentHandoffRecord
): ModelAgentHandoffSummary {
  return RuntimeHandoffSummarySchema.parse({
    id: handoff.id,
    fromRunId: handoff.fromRunId,
    fromRole: handoff.fromRole,
    toRole: handoff.toRole,
    state: handoff.state,
    summary: sanitizeAndBoundHandoffText(handoff.summary),
    ...(handoff.blockingReason
      ? { blockingReason: sanitizeAndBoundHandoffText(handoff.blockingReason) }
      : {}),
    ...(handoff.artifactRefs ? { artifactRefs: { ...handoff.artifactRefs } } : {}),
    updatedAt: handoff.updatedAt
  });
}

function sanitizeAndBoundHandoffText(value: string): string {
  const sanitized = sanitizeHandoffText(value).trim();
  return sanitized.length > HANDOFF_SUMMARY_LIMIT
    ? `${sanitized.slice(0, HANDOFF_SUMMARY_LIMIT - 3)}...`
    : sanitized;
}

function toHandoffEventPayload(handoff: AgentHandoffRecord): Record<string, unknown> {
  return {
    handoffId: handoff.id,
    fromRunId: handoff.fromRunId,
    fromRole: handoff.fromRole,
    toRole: handoff.toRole,
    state: handoff.state,
    summary: sanitizeAndBoundHandoffText(handoff.summary),
    ...(handoff.blockingReason
      ? { blockingReason: sanitizeAndBoundHandoffText(handoff.blockingReason) }
      : {}),
    ...(handoff.artifactRefs ? { artifactRefs: { ...handoff.artifactRefs } } : {})
  };
}

function matchesTaskScope(handoff: AgentHandoffRecord, taskId: string | undefined): boolean {
  return taskId === undefined ? handoff.taskId === undefined : handoff.taskId === taskId;
}

function dedupeHandoffs(handoffs: AgentHandoffRecord[]): AgentHandoffRecord[] {
  const byId = new Map<string, AgentHandoffRecord>();
  for (const handoff of handoffs) {
    byId.set(handoff.id, handoff);
  }
  return [...byId.values()].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.createdAt.localeCompare(left.createdAt) ||
      left.id.localeCompare(right.id)
  );
}
