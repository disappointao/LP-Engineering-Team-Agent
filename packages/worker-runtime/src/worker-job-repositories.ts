import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  SandboxPolicy,
  WorkerJobRecord,
  WorkerJobRepository
} from "./index";

export interface JsonFileWorkerJobRepositoryOptions {
  filePath: string;
}

interface WorkerJobFileState {
  workerJobs: WorkerJobRecord[];
}

const jsonFileSaveQueues = new Map<string, Promise<void>>();

export class InMemoryWorkerJobRepository implements WorkerJobRepository {
  private readonly recordsById = new Map<string, WorkerJobRecord>();

  async save(record: WorkerJobRecord): Promise<void> {
    this.recordsById.set(record.id, copyRecord(record));
  }

  async getById(id: string): Promise<WorkerJobRecord | undefined> {
    const record = this.recordsById.get(id);
    return record ? copyRecord(record) : undefined;
  }

  async listForProject(projectId: string): Promise<WorkerJobRecord[]> {
    return this.sortedRecords()
      .filter((record) => record.projectId === projectId)
      .map((record) => copyRecord(record));
  }

  async listAll(): Promise<WorkerJobRecord[]> {
    return this.sortedRecords().map((record) => copyRecord(record));
  }

  async findOldestQueued(): Promise<WorkerJobRecord | undefined> {
    const record = this.sortedRecords().find((job) => job.state === "queued");
    return record ? copyRecord(record) : undefined;
  }

  private sortedRecords(): WorkerJobRecord[] {
    return [...this.recordsById.values()].sort(compareRecords);
  }
}

export class JsonFileWorkerJobRepository implements WorkerJobRepository {
  private readonly filePath: string;

  constructor(options: JsonFileWorkerJobRepositoryOptions) {
    this.filePath = resolve(options.filePath);
  }

  async save(record: WorkerJobRecord): Promise<void> {
    const previousSave = jsonFileSaveQueues.get(this.filePath) ?? Promise.resolve();
    const nextSave = previousSave
      .catch(() => undefined)
      .then(async () => {
        const records = await this.readRecords();
        const recordIndex = records.findIndex((stored) => stored.id === record.id);
        const copiedRecord = copyRecord(record);

        if (recordIndex === -1) {
          records.push(copiedRecord);
        } else {
          records[recordIndex] = copiedRecord;
        }

        await this.writeRecords(records);
      });

    jsonFileSaveQueues.set(this.filePath, nextSave);

    try {
      await nextSave;
    } finally {
      if (jsonFileSaveQueues.get(this.filePath) === nextSave) {
        jsonFileSaveQueues.delete(this.filePath);
      }
    }
  }

  async getById(id: string): Promise<WorkerJobRecord | undefined> {
    const record = (await this.readRecords()).find((stored) => stored.id === id);
    return record ? copyRecord(record) : undefined;
  }

  async listForProject(projectId: string): Promise<WorkerJobRecord[]> {
    return (await this.readSortedRecords())
      .filter((record) => record.projectId === projectId)
      .map((record) => copyRecord(record));
  }

  async listAll(): Promise<WorkerJobRecord[]> {
    return (await this.readSortedRecords()).map((record) => copyRecord(record));
  }

  async findOldestQueued(): Promise<WorkerJobRecord | undefined> {
    const record = (await this.readSortedRecords()).find(
      (stored) => stored.state === "queued"
    );
    return record ? copyRecord(record) : undefined;
  }

  private async readSortedRecords(): Promise<WorkerJobRecord[]> {
    return (await this.readRecords()).sort(compareRecords);
  }

  private async readRecords(): Promise<WorkerJobRecord[]> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }

    const parsed = JSON.parse(contents) as Partial<WorkerJobFileState> | null;
    if (!parsed || !Array.isArray(parsed.workerJobs)) {
      return [];
    }

    return parsed.workerJobs.map((record) => copyRecord(record));
  }

  private async writeRecords(records: WorkerJobRecord[]): Promise<void> {
    const directory = dirname(this.filePath);
    const tempFilePath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    const state: WorkerJobFileState = {
      workerJobs: records.map((record) => copyRecord(record))
    };

    await mkdir(directory, { recursive: true });
    await writeFile(tempFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempFilePath, this.filePath);
  }
}

export function createJsonFileWorkerJobRepository(
  options: JsonFileWorkerJobRepositoryOptions
): JsonFileWorkerJobRepository {
  return new JsonFileWorkerJobRepository(options);
}

function compareRecords(left: WorkerJobRecord, right: WorkerJobRecord): number {
  const createdAtCompare = left.createdAt.localeCompare(right.createdAt);
  if (createdAtCompare !== 0) {
    return createdAtCompare;
  }

  return left.id.localeCompare(right.id);
}

function copyPolicy(policy: SandboxPolicy): SandboxPolicy {
  return {
    ...policy,
    allowedCommands: [...policy.allowedCommands],
    allowedEnvNames: [...policy.allowedEnvNames]
  };
}

function copyRecord(record: WorkerJobRecord): WorkerJobRecord {
  return {
    id: record.id,
    projectId: record.projectId,
    kind: record.kind,
    state: record.state,
    policy: copyPolicy(record.policy),
    inputSummary: {
      projectId: record.inputSummary.projectId,
      kind: record.inputSummary.kind,
      commandId: record.inputSummary.commandId,
      command: record.inputSummary.command,
      argCount: record.inputSummary.argCount,
      envNames: [...record.inputSummary.envNames],
      workingDirectory: record.inputSummary.workingDirectory,
      timeoutMs: record.inputSummary.timeoutMs
    },
    resultSummary: record.resultSummary ? { ...record.resultSummary } : undefined,
    errorName: record.errorName,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
