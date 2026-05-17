import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  SAFE_WORKER_PAYLOAD_MAX_ARG_LENGTH,
  SAFE_WORKER_PAYLOAD_MAX_ARGS,
  SAFE_WORKER_PAYLOAD_MAX_ENV_NAMES,
  type WorkerJobPayloadRecord,
  type WorkerJobPayloadRepository
} from "./index";

export interface JsonFileWorkerJobPayloadRepositoryOptions {
  filePath: string;
}

interface WorkerJobPayloadFileState {
  workerJobPayloads: WorkerJobPayloadRecord[];
}

const jsonFilePayloadMutationQueues = new Map<string, Promise<void>>();

export class InMemoryWorkerJobPayloadRepository
  implements WorkerJobPayloadRepository
{
  private readonly recordsByJobId = new Map<string, WorkerJobPayloadRecord>();

  async save(record: WorkerJobPayloadRecord): Promise<void> {
    const copiedRecord = copyPayloadRecord(record);
    this.recordsByJobId.set(copiedRecord.jobId, copiedRecord);
  }

  async getByJobId(jobId: string): Promise<WorkerJobPayloadRecord | undefined> {
    const record = this.recordsByJobId.get(jobId);
    return record ? copyPayloadRecord(record) : undefined;
  }

  async deleteByJobId(jobId: string): Promise<void> {
    this.recordsByJobId.delete(jobId);
  }
}

export class JsonFileWorkerJobPayloadRepository
  implements WorkerJobPayloadRepository
{
  private readonly filePath: string;

  constructor(options: JsonFileWorkerJobPayloadRepositoryOptions) {
    this.filePath = resolve(options.filePath);
  }

  async save(record: WorkerJobPayloadRecord): Promise<void> {
    await this.withMutationLock(async () => {
      const records = await this.readRecords();
      const recordIndex = records.findIndex(
        (stored) => stored.jobId === record.jobId
      );
      const copiedRecord = copyPayloadRecord(record);

      if (recordIndex === -1) {
        records.push(copiedRecord);
      } else {
        records[recordIndex] = copiedRecord;
      }

      await this.writeRecords(records);
    });
  }

  async getByJobId(jobId: string): Promise<WorkerJobPayloadRecord | undefined> {
    const record = (await this.readRecords()).find(
      (stored) => stored.jobId === jobId
    );
    return record ? copyPayloadRecord(record) : undefined;
  }

  async deleteByJobId(jobId: string): Promise<void> {
    await this.withMutationLock(async () => {
      const records = (await this.readRecords()).filter(
        (record) => record.jobId !== jobId
      );
      await this.writeRecords(records);
    });
  }

  private async withMutationLock(operation: () => Promise<void>): Promise<void> {
    const previousMutation =
      jsonFilePayloadMutationQueues.get(this.filePath) ?? Promise.resolve();
    const nextMutation = previousMutation.catch(() => undefined).then(operation);

    jsonFilePayloadMutationQueues.set(this.filePath, nextMutation);

    try {
      await nextMutation;
    } finally {
      if (jsonFilePayloadMutationQueues.get(this.filePath) === nextMutation) {
        jsonFilePayloadMutationQueues.delete(this.filePath);
      }
    }
  }

  private async readRecords(): Promise<WorkerJobPayloadRecord[]> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }

    const parsed = JSON.parse(contents) as Partial<WorkerJobPayloadFileState> | null;
    if (!parsed || !Array.isArray(parsed.workerJobPayloads)) {
      return [];
    }

    return parsed.workerJobPayloads.map((record) => copyPayloadRecord(record));
  }

  private async writeRecords(records: WorkerJobPayloadRecord[]): Promise<void> {
    const directory = dirname(this.filePath);
    const tempFilePath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    const state: WorkerJobPayloadFileState = {
      workerJobPayloads: records.map((record) => copyPayloadRecord(record))
    };

    await mkdir(directory, { recursive: true });
    await writeFile(tempFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempFilePath, this.filePath);
  }
}

export function createJsonFileWorkerJobPayloadRepository(
  options: JsonFileWorkerJobPayloadRepositoryOptions
): JsonFileWorkerJobPayloadRepository {
  return new JsonFileWorkerJobPayloadRepository(options);
}

function copyPayloadRecord(record: WorkerJobPayloadRecord): WorkerJobPayloadRecord {
  assertSafeWorkerJobPayloadRecord(record);

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

function assertSafeWorkerJobPayloadRecord(record: WorkerJobPayloadRecord): void {
  if (record.kind !== "safe_simulated_tool_command") {
    throwWorkerJobPayloadError("worker_job_payload_kind_not_supported");
  }

  if (record.args.length > SAFE_WORKER_PAYLOAD_MAX_ARGS) {
    throwWorkerJobPayloadError("worker_job_payload_args_limit_exceeded");
  }

  const oversizedArg = record.args.find(
    (arg) => arg.length > SAFE_WORKER_PAYLOAD_MAX_ARG_LENGTH
  );
  if (oversizedArg !== undefined) {
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
