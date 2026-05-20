import {
  SAFE_WORKER_PAYLOAD_MAX_ARG_LENGTH,
  SAFE_WORKER_PAYLOAD_MAX_ARGS,
  SAFE_WORKER_PAYLOAD_MAX_ENV_NAMES,
  type WorkerJobCancelQueuedInput,
  type WorkerJobCompleteClaimedInput,
  type WorkerJobHeartbeatClaimedInput,
  type WorkerJobPayloadRecord,
  type WorkerJobPayloadRepository,
  type WorkerJobRecord,
  type WorkerJobRecoverStaleInput,
  type WorkerJobRepository,
  type WorkerJobRequestRunningCancellationInput,
  type WorkerJobResultSummary,
  type WorkerJobStaleRecoveryResult,
  type WorkerLogListInput,
  type WorkerLogRecord,
  type WorkerLogRepository
} from "@lp-agent/worker-runtime";
import {
  mapPrismaWorkerJobPayloadToRecord,
  mapPrismaWorkerJobToRecord,
  mapPrismaWorkerLogToRecord,
  mapWorkerJobPayloadRecordToPrisma,
  mapWorkerJobRecordToPrisma,
  mapWorkerLogRecordToPrisma,
  type PrismaWorkerJobPayloadRow,
  type PrismaWorkerJobRow,
  type PrismaWorkerLogRow
} from "./prisma-worker-mappers";

export type PrismaWorkerWhere = Record<string, unknown>;
export type PrismaWorkerOrderBy = Array<Record<string, "asc" | "desc">>;
export type PrismaWorkerRow = Record<string, unknown>;

export interface PrismaWorkerDelegate {
  upsert(input: {
    where: PrismaWorkerWhere;
    create: PrismaWorkerRow;
    update: PrismaWorkerRow;
  }): Promise<PrismaWorkerRow>;
  findUnique(input: { where: PrismaWorkerWhere }): Promise<PrismaWorkerRow | null>;
  findMany(input?: {
    where?: PrismaWorkerWhere;
    orderBy?: PrismaWorkerOrderBy;
    take?: number;
  }): Promise<PrismaWorkerRow[]>;
  updateMany(input: {
    where: PrismaWorkerWhere;
    data: PrismaWorkerRow;
  }): Promise<{ count: number }>;
  deleteMany(input?: { where?: PrismaWorkerWhere }): Promise<{ count: number }>;
}

export interface PrismaWorkerClient {
  workerJob: PrismaWorkerDelegate;
  workerJobPayload: PrismaWorkerDelegate;
  workerLog: PrismaWorkerDelegate;
}

export interface PrismaWorkerLogRepositoryOptions {
  maxRecords?: number;
}

const ORDER_CREATED_ID_ASC: PrismaWorkerOrderBy = [
  { createdAt: "asc" },
  { id: "asc" }
];
const ORDER_CREATED_ID_DESC: PrismaWorkerOrderBy = [
  { createdAt: "desc" },
  { id: "desc" }
];
const DEFAULT_MAX_LOG_RECORDS = 200;
const WORKER_JOB_CANCELLED_ERROR = "worker_job_cancelled";
const WORKER_JOB_STALE_LIMIT_ERROR =
  "worker_job_stale_recovery_limit_exceeded";

export function createPrismaWorkerJobRepository(
  client: PrismaWorkerClient
): WorkerJobRepository {
  const delegate = client.workerJob;
  const getById = async (id: string): Promise<WorkerJobRecord | undefined> =>
    mapOptionalJob(await delegate.findUnique({ where: { id } }));

  return {
    async save(record) {
      const data = mapWorkerJobRecordToPrisma(record) as unknown as PrismaWorkerRow;
      await delegate.upsert({
        where: { id: record.id },
        create: data,
        update: data
      });
    },

    async getById(id) {
      return getById(id);
    },

    async listForProject(projectId) {
      return mapJobRows(
        await delegate.findMany({
          where: { projectId },
          orderBy: ORDER_CREATED_ID_ASC
        })
      );
    },

    async listAll() {
      return mapJobRows(await delegate.findMany({ orderBy: ORDER_CREATED_ID_ASC }));
    },

    async findOldestQueued() {
      const rows = await delegate.findMany({
        where: { state: "queued" },
        orderBy: ORDER_CREATED_ID_ASC,
        take: 1
      });
      return mapOptionalJob(rows[0]);
    },

    async claimOldestQueued(input) {
      const candidates = await delegate.findMany({
        where: {
          state: "queued",
          ...payloadSourceWhere(input.payloadSource),
          ...(input.projectId ? { projectId: input.projectId } : {})
        },
        orderBy: ORDER_CREATED_ID_ASC,
        take: 10
      });

      for (const candidate of candidates) {
        const id = String(candidate.id);
        const result = await delegate.updateMany({
          where: {
            id,
            state: "queued",
            ...payloadSourceWhere(input.payloadSource),
            ...(input.projectId ? { projectId: input.projectId } : {})
          },
          data: {
            state: "running",
            startedAt: new Date(input.startedAt),
            claimedByWorkerId: input.claimedByWorkerId ?? null,
            claimToken: input.claimToken ?? null
          }
        });
        if (result.count === 1) {
          return getById(id);
        }
      }

      return undefined;
    },

    async heartbeatClaimed(input) {
      const result = await delegate.updateMany({
        where: {
          id: input.jobId,
          state: "running",
          claimToken: input.claimToken,
          OR: [{ claimedByWorkerId: null }, { claimedByWorkerId: input.workerId }]
        },
        data: {
          lastHeartbeatAt: new Date(input.heartbeatAt),
          heartbeatExpiresAt: new Date(input.heartbeatExpiresAt)
        }
      });

      return result.count === 1 ? getById(input.jobId) : undefined;
    },

    async recoverStale(input) {
      const rows = await delegate.findMany({
        where: {
          state: "running",
          payloadSource: "safe_persisted",
          ...(input.projectId ? { projectId: input.projectId } : {})
        },
        orderBy: ORDER_CREATED_ID_ASC
      });
      const results: WorkerJobStaleRecoveryResult[] = [];

      for (const row of rows) {
        const record = mapJobRow(row);
        const recovery = createStaleRecovery(record, input);
        if (!recovery) {
          continue;
        }

        const updateResult = await delegate.updateMany({
          where: staleRecoveryWhere(record),
          data: mapPartialWorkerJobRecordToPrisma(recovery.record)
        });
        if (updateResult.count !== 1) {
          continue;
        }

        const latest = await getById(record.id);
        if (!latest) {
          continue;
        }
        results.push({ ...recovery, record: latest });
      }

      return results;
    },

    async completeClaimed(input) {
      const current = await getById(input.jobId);
      if (
        !current ||
        current.state !== "running" ||
        current.claimToken !== input.claimToken
      ) {
        return undefined;
      }

      const completedRecord = createClaimedCompletionRecord(current, input);
      const result = await delegate.updateMany({
        where: {
          id: input.jobId,
          state: "running",
          claimToken: input.claimToken
        },
        data: mapPartialWorkerJobRecordToPrisma(completedRecord)
      });

      return result.count === 1 ? getById(input.jobId) : undefined;
    },

    async requestRunningCancellation(input) {
      const current = await getById(input.jobId);
      if (!current) {
        return undefined;
      }
      if (current.state !== "running") {
        return copyJobRecord(current);
      }

      const updatedRecord = createRunningCancellationRecord(current, input);
      await delegate.updateMany({
        where: { id: input.jobId, state: "running" },
        data: mapPartialWorkerJobRecordToPrisma(updatedRecord)
      });

      return getById(input.jobId);
    },

    async cancelQueued(input) {
      const current = await getById(input.jobId);
      if (!current) {
        return undefined;
      }
      if (current.state !== "queued") {
        return copyJobRecord(current);
      }

      const cancelledRecord = createQueuedCancellationRecord(current, input);
      await delegate.updateMany({
        where: { id: input.jobId, state: "queued" },
        data: mapPartialWorkerJobRecordToPrisma(cancelledRecord)
      });

      return getById(input.jobId);
    }
  };
}

export function createPrismaWorkerJobPayloadRepository(
  client: PrismaWorkerClient
): WorkerJobPayloadRepository {
  const delegate = client.workerJobPayload;

  return {
    async save(record) {
      assertSafeWorkerJobPayloadRecord(record);
      const data = mapWorkerJobPayloadRecordToPrisma(
        record
      ) as unknown as PrismaWorkerRow;
      await delegate.upsert({
        where: { jobId: record.jobId },
        create: data,
        update: data
      });
    },

    async getByJobId(jobId) {
      const row = await delegate.findUnique({ where: { jobId } });
      return row
        ? copyPayloadRecord(
            mapPrismaWorkerJobPayloadToRecord(
              row as unknown as PrismaWorkerJobPayloadRow
            )
          )
        : undefined;
    },

    async deleteByJobId(jobId) {
      await delegate.deleteMany({ where: { jobId } });
    }
  };
}

export function createPrismaWorkerLogRepository(
  client: PrismaWorkerClient,
  options: PrismaWorkerLogRepositoryOptions = {}
): WorkerLogRepository {
  const delegate = client.workerLog;
  const maxRecords = normalizeMaxRecords(options.maxRecords);

  return {
    async append(record) {
      const data = mapWorkerLogRecordToPrisma(record) as unknown as PrismaWorkerRow;
      const row = await delegate.upsert({
        where: { id: record.id },
        create: data,
        update: data
      });
      await trimLogsBestEffort(delegate, maxRecords);
      return copyLogRecord(
        mapPrismaWorkerLogToRecord(row as unknown as PrismaWorkerLogRow)
      );
    },

    async list(input = {}) {
      const rows = await delegate.findMany({
        where: logListWhere(input),
        orderBy: ORDER_CREATED_ID_DESC,
        take: normalizeLimit(input.limit)
      });
      return rows.map((row) =>
        copyLogRecord(mapPrismaWorkerLogToRecord(row as unknown as PrismaWorkerLogRow))
      );
    }
  };
}

function payloadSourceWhere(
  payloadSource: WorkerJobRecord["payloadSource"]
): PrismaWorkerWhere {
  if (payloadSource === "process_memory") {
    return {
      OR: [{ payloadSource: "process_memory" }, { payloadSource: null }]
    };
  }

  return { payloadSource };
}

function mapOptionalJob(row: PrismaWorkerRow | null | undefined): WorkerJobRecord | undefined {
  return row ? mapJobRow(row) : undefined;
}

function mapJobRows(rows: PrismaWorkerRow[]): WorkerJobRecord[] {
  return rows.map(mapJobRow);
}

function mapJobRow(row: PrismaWorkerRow): WorkerJobRecord {
  return copyJobRecord(
    mapPrismaWorkerJobToRecord(row as unknown as PrismaWorkerJobRow)
  );
}

function mapPartialWorkerJobRecordToPrisma(record: WorkerJobRecord): PrismaWorkerRow {
  const data = mapWorkerJobRecordToPrisma(record) as unknown as PrismaWorkerRow;
  const { id: _id, projectId: _projectId, kind: _kind, createdAt: _createdAt, ...update } =
    data;
  return update;
}

function createClaimedCompletionRecord(
  record: WorkerJobRecord,
  input: WorkerJobCompleteClaimedInput
): WorkerJobRecord {
  return {
    ...copyJobRecord(record),
    state: input.state,
    resultSummary: { ...input.resultSummary },
    errorName: input.errorName,
    completedAt: input.completedAt,
    ...(input.state === "cancelled"
      ? {
          cancelRequestedAt: record.cancelRequestedAt ?? input.completedAt,
          cancelledAt: input.completedAt,
          cancelReason: record.cancelReason
        }
      : {})
  };
}

function createRunningCancellationRecord(
  record: WorkerJobRecord,
  input: WorkerJobRequestRunningCancellationInput
): WorkerJobRecord {
  return {
    ...copyJobRecord(record),
    cancelRequestedAt: record.cancelRequestedAt ?? input.cancelRequestedAt,
    cancelReason: record.cancelReason ?? input.cancelReason
  };
}

function createQueuedCancellationRecord(
  record: WorkerJobRecord,
  input: WorkerJobCancelQueuedInput
): WorkerJobRecord {
  return {
    ...copyJobRecord(record),
    state: "cancelled",
    errorName: input.errorName,
    resultSummary: { ...input.resultSummary },
    cancelRequestedAt: input.cancelRequestedAt,
    cancelledAt: input.cancelledAt,
    completedAt: input.completedAt,
    cancelReason: input.cancelReason ?? record.cancelReason
  };
}

function createStaleRecovery(
  record: WorkerJobRecord,
  input: WorkerJobRecoverStaleInput
): WorkerJobStaleRecoveryResult | undefined {
  if (
    record.state !== "running" ||
    record.payloadSource !== "safe_persisted" ||
    (input.projectId && record.projectId !== input.projectId) ||
    !isRecordStale(record, input)
  ) {
    return undefined;
  }

  if (record.cancelRequestedAt) {
    const cancelledRecord = createStaleCancelledRecord(record, input.recoveredAt);
    return {
      type: "cancelled",
      jobId: record.id,
      projectId: record.projectId,
      record: cancelledRecord,
      errorName: WORKER_JOB_CANCELLED_ERROR
    };
  }

  const staleRecoveryCount = record.staleRecoveryCount ?? 0;
  if (staleRecoveryCount >= input.maxStaleRecoveryCount) {
    const failedRecord = createStaleFailedRecord(record, input.recoveredAt);
    return {
      type: "failed",
      jobId: record.id,
      projectId: record.projectId,
      record: failedRecord,
      errorName: WORKER_JOB_STALE_LIMIT_ERROR
    };
  }

  return {
    type: "requeued",
    jobId: record.id,
    projectId: record.projectId,
    record: {
      ...copyJobRecord(record),
      state: "queued",
      startedAt: undefined,
      claimedByWorkerId: undefined,
      claimToken: undefined,
      lastHeartbeatAt: undefined,
      heartbeatExpiresAt: undefined,
      staleRecoveredAt: input.recoveredAt,
      staleRecoveryCount: staleRecoveryCount + 1
    }
  };
}

function staleRecoveryWhere(record: WorkerJobRecord): PrismaWorkerWhere {
  return {
    id: record.id,
    state: "running",
    payloadSource: "safe_persisted",
    claimToken: record.claimToken ?? null
  };
}

function isRecordStale(
  record: WorkerJobRecord,
  input: WorkerJobRecoverStaleInput
): boolean {
  if (record.heartbeatExpiresAt) {
    return record.heartbeatExpiresAt < input.staleBefore;
  }
  if (!record.startedAt || input.staleClaimTimeoutMs === undefined) {
    return false;
  }
  return (
    new Date(record.startedAt).getTime() + input.staleClaimTimeoutMs <
    new Date(input.staleBefore).getTime()
  );
}

function createStaleCancelledRecord(
  record: WorkerJobRecord,
  recoveredAt: string
): WorkerJobRecord {
  return {
    ...copyJobRecord(record),
    state: "cancelled",
    errorName: WORKER_JOB_CANCELLED_ERROR,
    resultSummary: createStaleResultSummary({
      state: "cancelled",
      errorName: WORKER_JOB_CANCELLED_ERROR
    }),
    cancelledAt: recoveredAt,
    completedAt: recoveredAt,
    staleRecoveredAt: recoveredAt
  };
}

function createStaleFailedRecord(
  record: WorkerJobRecord,
  recoveredAt: string
): WorkerJobRecord {
  return {
    ...copyJobRecord(record),
    state: "failed",
    errorName: WORKER_JOB_STALE_LIMIT_ERROR,
    resultSummary: createStaleResultSummary({
      state: "failed",
      errorName: WORKER_JOB_STALE_LIMIT_ERROR
    }),
    completedAt: recoveredAt,
    staleRecoveredAt: recoveredAt
  };
}

function createStaleResultSummary(input: {
  state: "cancelled" | "failed";
  errorName: string;
}): WorkerJobResultSummary {
  return {
    state: input.state,
    stdout: "",
    stderr: "",
    stdoutBytes: 0,
    stderrBytes: 0,
    errorName: input.errorName
  };
}

function assertSafeWorkerJobPayloadRecord(record: WorkerJobPayloadRecord): void {
  if (record.kind !== "safe_simulated_tool_command") {
    throwWorkerJobPayloadError("worker_job_payload_kind_not_supported");
  }
  if (record.args.length > SAFE_WORKER_PAYLOAD_MAX_ARGS) {
    throwWorkerJobPayloadError("worker_job_payload_args_limit_exceeded");
  }
  if (record.args.some((arg) => arg.length > SAFE_WORKER_PAYLOAD_MAX_ARG_LENGTH)) {
    throwWorkerJobPayloadError("worker_job_payload_arg_too_long");
  }
  if (record.envNames.length > SAFE_WORKER_PAYLOAD_MAX_ENV_NAMES) {
    throwWorkerJobPayloadError("worker_job_payload_env_names_limit_exceeded");
  }
}

function throwWorkerJobPayloadError(code: string): never {
  const error = new Error(code);
  Object.assign(error, { code });
  throw error;
}

function logListWhere(input: WorkerLogListInput): PrismaWorkerWhere {
  return {
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.workerId ? { workerId: input.workerId } : {}),
    ...(input.workerJobId ? { workerJobId: input.workerJobId } : {})
  };
}

async function trimLogsBestEffort(
  delegate: PrismaWorkerDelegate,
  maxRecords: number
): Promise<void> {
  try {
    const rows = await delegate.findMany({ orderBy: ORDER_CREATED_ID_DESC });
    const staleIds = rows.slice(maxRecords).map((row) => row.id).filter(isString);
    if (staleIds.length > 0) {
      await delegate.deleteMany({ where: { id: { in: staleIds } } });
    }
  } catch {
    // Logging should not fail a worker lifecycle transition because retention failed.
  }
}

function normalizeMaxRecords(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_MAX_LOG_RECORDS;
}

function normalizeLimit(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : 20;
}

function copyJobRecord(record: WorkerJobRecord): WorkerJobRecord {
  return {
    id: record.id,
    projectId: record.projectId,
    kind: record.kind,
    state: record.state,
    payloadSource: record.payloadSource ?? "process_memory",
    policy: {
      ...record.policy,
      allowedCommands: [...record.policy.allowedCommands],
      allowedEnvNames: [...record.policy.allowedEnvNames]
    },
    inputSummary: {
      projectId: record.inputSummary.projectId,
      kind: record.inputSummary.kind,
      commandId: record.inputSummary.commandId,
      command: record.inputSummary.command,
      argCount: record.inputSummary.argCount,
      argsDigest: record.inputSummary.argsDigest,
      envNames: [...record.inputSummary.envNames],
      workingDirectory: record.inputSummary.workingDirectory,
      timeoutMs: record.inputSummary.timeoutMs
    },
    resultSummary: record.resultSummary ? { ...record.resultSummary } : undefined,
    errorName: record.errorName,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    cancelRequestedAt: record.cancelRequestedAt,
    cancelledAt: record.cancelledAt,
    cancelReason: record.cancelReason,
    claimedByWorkerId: record.claimedByWorkerId,
    claimToken: record.claimToken,
    lastHeartbeatAt: record.lastHeartbeatAt,
    heartbeatExpiresAt: record.heartbeatExpiresAt,
    staleRecoveredAt: record.staleRecoveredAt,
    staleRecoveryCount: record.staleRecoveryCount,
    lastWorkerLogAt: record.lastWorkerLogAt
  };
}

function copyPayloadRecord(record: WorkerJobPayloadRecord): WorkerJobPayloadRecord {
  return {
    jobId: record.jobId,
    kind: record.kind,
    projectId: record.projectId,
    commandId: record.commandId,
    command: record.command,
    args: [...record.args],
    envNames: [...new Set(record.envNames)].sort(),
    workingDirectory: record.workingDirectory,
    timeoutMs: record.timeoutMs,
    createdAt: record.createdAt
  };
}

function copyLogRecord(record: WorkerLogRecord): WorkerLogRecord {
  return {
    ...record,
    payload: JSON.parse(JSON.stringify(record.payload)) as Record<string, unknown>
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
