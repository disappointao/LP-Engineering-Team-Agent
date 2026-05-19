import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type WorkerLogType =
  | "worker.daemon.started"
  | "worker.daemon.idle"
  | "worker.daemon.stopped"
  | "worker.job.claimed"
  | "worker.job.heartbeat"
  | "worker.job.completed"
  | "worker.job.failed"
  | "worker.job.cancelled"
  | "worker.job.finalization_failed"
  | "worker.job.stale_recovered"
  | "worker.job.stale_cancelled"
  | "worker.job.stale_failed"
  | "worker.job.claim_conflict";

export interface WorkerLogRecord {
  id: string;
  type: WorkerLogType;
  message: string;
  workerId?: string;
  workerJobId?: string;
  projectId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface WorkerLogListInput {
  projectId?: string;
  workerId?: string;
  workerJobId?: string;
  limit?: number;
}

export interface WorkerLogRepository {
  append(record: WorkerLogRecord): Promise<WorkerLogRecord>;
  list(input?: WorkerLogListInput): Promise<WorkerLogRecord[]>;
}

export interface InMemoryWorkerLogRepositoryOptions {
  maxRecords?: number;
}

export interface JsonFileWorkerLogRepositoryOptions {
  filePath: string;
  maxRecords?: number;
}

interface WorkerLogFileState {
  workerLogs: WorkerLogRecord[];
}

const DEFAULT_MAX_RECORDS = 200;
const jsonFileSaveQueues = new Map<string, Promise<void>>();

export class InMemoryWorkerLogRepository implements WorkerLogRepository {
  private readonly maxRecords: number;
  private readonly recordsById = new Map<string, WorkerLogRecord>();

  constructor(options: InMemoryWorkerLogRepositoryOptions = {}) {
    this.maxRecords = normalizeMaxRecords(options.maxRecords);
  }

  async append(record: WorkerLogRecord): Promise<WorkerLogRecord> {
    const sanitized = sanitizeLogRecord(record);
    this.recordsById.set(sanitized.id, sanitized);
    this.trim();
    return copyLogRecord(sanitized);
  }

  async list(input: WorkerLogListInput = {}): Promise<WorkerLogRecord[]> {
    return filterAndSortLogs([...this.recordsById.values()], input).map(
      copyLogRecord
    );
  }

  private trim(): void {
    const sorted = sortLogsNewestFirst([...this.recordsById.values()]);
    for (const stale of sorted.slice(this.maxRecords)) {
      this.recordsById.delete(stale.id);
    }
  }
}

export class JsonFileWorkerLogRepository implements WorkerLogRepository {
  private readonly filePath: string;
  private readonly maxRecords: number;

  constructor(options: JsonFileWorkerLogRepositoryOptions) {
    this.filePath = resolve(options.filePath);
    this.maxRecords = normalizeMaxRecords(options.maxRecords);
  }

  async append(record: WorkerLogRecord): Promise<WorkerLogRecord> {
    return this.withMutationLock(async () => {
      const records = await this.readRecords();
      const sanitized = sanitizeLogRecord(record);
      const index = records.findIndex((stored) => stored.id === sanitized.id);
      if (index === -1) {
        records.push(sanitized);
      } else {
        records[index] = sanitized;
      }
      await this.writeRecords(sortLogsNewestFirst(records).slice(0, this.maxRecords));
      return copyLogRecord(sanitized);
    });
  }

  async list(input: WorkerLogListInput = {}): Promise<WorkerLogRecord[]> {
    return filterAndSortLogs(await this.readRecords(), input).map(copyLogRecord);
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const previousSave = jsonFileSaveQueues.get(this.filePath) ?? Promise.resolve();
    const nextSave = previousSave.catch(() => undefined).then(operation);
    const trackedSave = nextSave.then(
      () => undefined,
      () => undefined
    );
    jsonFileSaveQueues.set(this.filePath, trackedSave);
    try {
      return await nextSave;
    } finally {
      if (jsonFileSaveQueues.get(this.filePath) === trackedSave) {
        jsonFileSaveQueues.delete(this.filePath);
      }
    }
  }

  private async readRecords(): Promise<WorkerLogRecord[]> {
    try {
      const contents = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(contents) as Partial<WorkerLogFileState> | null;
      return Array.isArray(parsed?.workerLogs)
        ? parsed.workerLogs.map(sanitizeLogRecord)
        : [];
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async writeRecords(records: WorkerLogRecord[]): Promise<void> {
    const directory = dirname(this.filePath);
    const tempFilePath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(directory, { recursive: true });
    await writeFile(
      tempFilePath,
      `${JSON.stringify({ workerLogs: records.map(sanitizeLogRecord) }, null, 2)}\n`,
      "utf8"
    );
    await rename(tempFilePath, this.filePath);
  }
}

export function createJsonFileWorkerLogRepository(
  options: JsonFileWorkerLogRepositoryOptions
): JsonFileWorkerLogRepository {
  return new JsonFileWorkerLogRepository(options);
}

function sanitizeLogRecord(record: WorkerLogRecord): WorkerLogRecord {
  return {
    id: String(record.id),
    type: record.type,
    message: String(record.message),
    workerId: toOptionalString(record.workerId),
    workerJobId: toOptionalString(record.workerJobId),
    projectId: toOptionalString(record.projectId),
    payload: sanitizePayload(record.payload),
    createdAt: String(record.createdAt)
  };
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const allowedKeys = [
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
  ];
  return Object.fromEntries(
    allowedKeys
      .filter((key) => payload[key] !== undefined)
      .map((key) => [key, payload[key]])
  );
}

function filterAndSortLogs(
  records: WorkerLogRecord[],
  input: WorkerLogListInput
): WorkerLogRecord[] {
  const limit = normalizeLimit(input.limit);
  return sortLogsNewestFirst(records)
    .filter((record) => !input.projectId || record.projectId === input.projectId)
    .filter((record) => !input.workerId || record.workerId === input.workerId)
    .filter((record) => !input.workerJobId || record.workerJobId === input.workerJobId)
    .slice(0, limit);
}

function sortLogsNewestFirst(records: WorkerLogRecord[]): WorkerLogRecord[] {
  return [...records].sort((left, right) => {
    const createdAtCompare = right.createdAt.localeCompare(left.createdAt);
    return createdAtCompare !== 0 ? createdAtCompare : right.id.localeCompare(left.id);
  });
}

function normalizeMaxRecords(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_MAX_RECORDS;
}

function normalizeLimit(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : 20;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function copyLogRecord(record: WorkerLogRecord): WorkerLogRecord {
  return {
    ...record,
    payload: { ...record.payload }
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
