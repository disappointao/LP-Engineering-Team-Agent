import type {
  WorkerJobPayloadRecord,
  WorkerJobRecord,
  WorkerJobResultSummary,
  WorkerLogRecord
} from "@lp-agent/worker-runtime";

export interface PrismaWorkerJobCreate {
  id: string;
  projectId: string;
  kind: string;
  state: string;
  payloadSource?: string | null;
  policy: unknown;
  inputSummary: unknown;
  resultSummary?: unknown | null;
  errorName?: string | null;
  createdAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  cancelRequestedAt?: Date | null;
  cancelledAt?: Date | null;
  cancelReason?: string | null;
  claimedByWorkerId?: string | null;
  claimToken?: string | null;
  lastHeartbeatAt?: Date | null;
  heartbeatExpiresAt?: Date | null;
  staleRecoveredAt?: Date | null;
  staleRecoveryCount?: number | null;
  lastWorkerLogAt?: Date | null;
}

export interface PrismaWorkerJobRow extends PrismaWorkerJobCreate {}

export interface PrismaWorkerJobPayloadCreate {
  jobId: string;
  kind: string;
  projectId: string;
  commandId?: string | null;
  command: string;
  args: unknown;
  envNames: unknown;
  workingDirectory?: string | null;
  timeoutMs: number;
  createdAt: Date;
}

export interface PrismaWorkerJobPayloadRow extends PrismaWorkerJobPayloadCreate {}

export interface PrismaWorkerLogCreate {
  id: string;
  type: string;
  message: string;
  workerId?: string | null;
  workerJobId?: string | null;
  projectId?: string | null;
  payload: unknown;
  createdAt: Date;
}

export interface PrismaWorkerLogRow extends PrismaWorkerLogCreate {}

const SUPPORTED_WORKER_PAYLOAD_KIND: WorkerJobPayloadRecord["kind"] =
  "safe_simulated_tool_command";

const WORKER_LOG_PAYLOAD_KEYS = new Set([
  "workerId",
  "workerJobId",
  "projectId",
  "state",
  "previousState",
  "nextState",
  "staleRecoveryCount",
  "errorName",
  "exitCode",
  "outputSummary",
  "createdAt"
]);

export function mapWorkerJobRecordToPrisma(
  record: WorkerJobRecord
): PrismaWorkerJobCreate {
  return {
    id: record.id,
    projectId: record.projectId,
    kind: record.kind,
    state: record.state,
    payloadSource: record.payloadSource ?? null,
    policy: cloneJson(record.policy),
    inputSummary: cloneJson(record.inputSummary),
    resultSummary: record.resultSummary
      ? sanitizeWorkerJobResultSummary(record.resultSummary)
      : null,
    errorName: record.errorName ?? null,
    createdAt: new Date(record.createdAt),
    startedAt: toOptionalDate(record.startedAt),
    completedAt: toOptionalDate(record.completedAt),
    cancelRequestedAt: toOptionalDate(record.cancelRequestedAt),
    cancelledAt: toOptionalDate(record.cancelledAt),
    cancelReason: record.cancelReason ?? null,
    claimedByWorkerId: record.claimedByWorkerId ?? null,
    claimToken: record.claimToken ?? null,
    lastHeartbeatAt: toOptionalDate(record.lastHeartbeatAt),
    heartbeatExpiresAt: toOptionalDate(record.heartbeatExpiresAt),
    staleRecoveredAt: toOptionalDate(record.staleRecoveredAt),
    staleRecoveryCount: record.staleRecoveryCount ?? null,
    lastWorkerLogAt: toOptionalDate(record.lastWorkerLogAt)
  };
}

export function mapPrismaWorkerJobToRecord(
  row: PrismaWorkerJobRow
): WorkerJobRecord {
  const resultSummary = isPresent(row.resultSummary)
    ? sanitizeWorkerJobResultSummary(row.resultSummary)
    : undefined;

  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind as WorkerJobRecord["kind"],
    state: row.state as WorkerJobRecord["state"],
    ...(isPresent(row.payloadSource)
      ? { payloadSource: row.payloadSource as WorkerJobRecord["payloadSource"] }
      : {}),
    policy: cloneJson(row.policy) as WorkerJobRecord["policy"],
    inputSummary: cloneJson(row.inputSummary) as WorkerJobRecord["inputSummary"],
    ...(resultSummary ? { resultSummary } : {}),
    ...(isPresent(row.errorName) ? { errorName: row.errorName } : {}),
    createdAt: row.createdAt.toISOString(),
    ...(row.startedAt ? { startedAt: row.startedAt.toISOString() } : {}),
    ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
    ...(row.cancelRequestedAt
      ? { cancelRequestedAt: row.cancelRequestedAt.toISOString() }
      : {}),
    ...(row.cancelledAt ? { cancelledAt: row.cancelledAt.toISOString() } : {}),
    ...(isPresent(row.cancelReason) ? { cancelReason: row.cancelReason } : {}),
    ...(isPresent(row.claimedByWorkerId)
      ? { claimedByWorkerId: row.claimedByWorkerId }
      : {}),
    ...(isPresent(row.claimToken) ? { claimToken: row.claimToken } : {}),
    ...(row.lastHeartbeatAt
      ? { lastHeartbeatAt: row.lastHeartbeatAt.toISOString() }
      : {}),
    ...(row.heartbeatExpiresAt
      ? { heartbeatExpiresAt: row.heartbeatExpiresAt.toISOString() }
      : {}),
    ...(row.staleRecoveredAt
      ? { staleRecoveredAt: row.staleRecoveredAt.toISOString() }
      : {}),
    ...(row.staleRecoveryCount !== null && row.staleRecoveryCount !== undefined
      ? { staleRecoveryCount: row.staleRecoveryCount }
      : {}),
    ...(row.lastWorkerLogAt
      ? { lastWorkerLogAt: row.lastWorkerLogAt.toISOString() }
      : {})
  };
}

export function mapWorkerJobPayloadRecordToPrisma(
  record: WorkerJobPayloadRecord
): PrismaWorkerJobPayloadCreate {
  assertSupportedPayloadKind(record.kind);

  return {
    jobId: record.jobId,
    kind: record.kind,
    projectId: record.projectId,
    commandId: record.commandId ?? null,
    command: record.command,
    args: [...record.args],
    envNames: canonicalEnvNames(record.envNames),
    workingDirectory: record.workingDirectory ?? null,
    timeoutMs: record.timeoutMs,
    createdAt: new Date(record.createdAt)
  };
}

export function mapPrismaWorkerJobPayloadToRecord(
  row: PrismaWorkerJobPayloadRow
): WorkerJobPayloadRecord {
  assertSupportedPayloadKind(row.kind);

  return {
    jobId: row.jobId,
    kind: row.kind,
    projectId: row.projectId,
    ...(isPresent(row.commandId) ? { commandId: row.commandId } : {}),
    command: row.command,
    args: normalizeStringArray(row.args),
    envNames: canonicalEnvNames(normalizeStringArray(row.envNames)),
    ...(isPresent(row.workingDirectory)
      ? { workingDirectory: row.workingDirectory }
      : {}),
    timeoutMs: row.timeoutMs,
    createdAt: row.createdAt.toISOString()
  };
}

export function mapWorkerLogRecordToPrisma(
  record: WorkerLogRecord
): PrismaWorkerLogCreate {
  return {
    id: record.id,
    type: record.type,
    message: record.message,
    workerId: record.workerId ?? null,
    workerJobId: record.workerJobId ?? null,
    projectId: record.projectId ?? null,
    payload: sanitizeWorkerLogPayload(record.payload),
    createdAt: new Date(record.createdAt)
  };
}

export function mapPrismaWorkerLogToRecord(
  row: PrismaWorkerLogRow
): WorkerLogRecord {
  return {
    id: row.id,
    type: row.type as WorkerLogRecord["type"],
    message: row.message,
    ...(isPresent(row.workerId) ? { workerId: row.workerId } : {}),
    ...(isPresent(row.workerJobId) ? { workerJobId: row.workerJobId } : {}),
    ...(isPresent(row.projectId) ? { projectId: row.projectId } : {}),
    payload: sanitizeWorkerLogPayload(toRecord(row.payload)),
    createdAt: row.createdAt.toISOString()
  };
}

function assertSupportedPayloadKind(
  kind: string
): asserts kind is WorkerJobPayloadRecord["kind"] {
  if (kind !== SUPPORTED_WORKER_PAYLOAD_KIND) {
    throw new Error("worker_job_payload_kind_not_supported");
  }
}

function canonicalEnvNames(envNames: readonly string[]): string[] {
  return [...new Set(envNames)].sort();
}

function sanitizeWorkerLogPayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload)
      .filter(([key, value]) => WORKER_LOG_PAYLOAD_KEYS.has(key) && value !== undefined)
      .map(([key, value]) => [key, cloneJson(value)])
      .filter(([, value]) => value !== undefined)
  );
}

function sanitizeWorkerJobResultSummary(
  value: unknown
): WorkerJobResultSummary | undefined {
  const result = toRecord(value);
  if (!isWorkerJobResultState(result.state)) {
    return undefined;
  }

  return {
    state: result.state,
    ...(typeof result.exitCode === "number" ? { exitCode: result.exitCode } : {}),
    stdout: "",
    stderr: "",
    stdoutBytes: typeof result.stdoutBytes === "number" ? result.stdoutBytes : 0,
    stderrBytes: typeof result.stderrBytes === "number" ? result.stderrBytes : 0,
    ...(typeof result.errorName === "string" ? { errorName: result.errorName } : {})
  };
}

function isWorkerJobResultState(
  value: unknown
): value is WorkerJobResultSummary["state"] {
  return (
    value === "completed" ||
    value === "failed" ||
    value === "rejected" ||
    value === "cancelled"
  );
}

function toOptionalDate(value: string | undefined): Date | null {
  return value ? new Date(value) : null;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cloneJson<T>(value: T): T | undefined {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return undefined;
  }
}
