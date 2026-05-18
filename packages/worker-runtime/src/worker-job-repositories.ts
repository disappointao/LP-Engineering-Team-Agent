import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  SandboxPolicy,
  WorkerJobCancelQueuedInput,
  WorkerJobCompleteClaimedInput,
  WorkerJobClaimOldestQueuedInput,
  WorkerJobRecord,
  WorkerJobRequestRunningCancellationInput,
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

  async claimOldestQueued(
    input: WorkerJobClaimOldestQueuedInput
  ): Promise<WorkerJobRecord | undefined> {
    const record = this.sortedRecords().find(
      (job) =>
        job.state === "queued" &&
        getPayloadSource(job) === input.payloadSource &&
        (!input.projectId || job.projectId === input.projectId)
    );
    if (!record) {
      return undefined;
    }

    const runningRecord: WorkerJobRecord = {
      ...copyRecord(record),
      state: "running",
      startedAt: input.startedAt,
      claimedByWorkerId: input.claimedByWorkerId,
      claimToken: input.claimToken
    };
    this.recordsById.set(record.id, copyRecord(runningRecord));

    return copyRecord(runningRecord);
  }

  async completeClaimed(
    input: WorkerJobCompleteClaimedInput
  ): Promise<WorkerJobRecord | undefined> {
    const record = this.recordsById.get(input.jobId);
    if (
      !record ||
      record.state !== "running" ||
      record.claimToken !== input.claimToken
    ) {
      return undefined;
    }

    const completedRecord = createClaimedCompletionRecord(record, input);
    this.recordsById.set(record.id, copyRecord(completedRecord));

    return copyRecord(completedRecord);
  }

  async requestRunningCancellation(
    input: WorkerJobRequestRunningCancellationInput
  ): Promise<WorkerJobRecord | undefined> {
    const record = this.recordsById.get(input.jobId);
    if (!record) {
      return undefined;
    }
    if (record.state !== "running") {
      return copyRecord(record);
    }

    const updatedRecord = createRunningCancellationRecord(record, input);
    this.recordsById.set(record.id, copyRecord(updatedRecord));

    return copyRecord(updatedRecord);
  }

  async cancelQueued(
    input: WorkerJobCancelQueuedInput
  ): Promise<WorkerJobRecord | undefined> {
    const record = this.recordsById.get(input.jobId);
    if (!record) {
      return undefined;
    }
    if (record.state !== "queued") {
      return copyRecord(record);
    }

    const cancelledRecord = createQueuedCancellationRecord(record, input);
    this.recordsById.set(record.id, copyRecord(cancelledRecord));

    return copyRecord(cancelledRecord);
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
    await this.withMutationLock(async () => {
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

  async claimOldestQueued(
    input: WorkerJobClaimOldestQueuedInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.withMutationLock(async () => {
      const records = await this.readRecords();
      const record = [...records].sort(compareRecords).find(
        (stored) =>
          stored.state === "queued" &&
          getPayloadSource(stored) === input.payloadSource &&
          (!input.projectId || stored.projectId === input.projectId)
      );
      if (!record) {
        return undefined;
      }

      const recordIndex = records.findIndex((stored) => stored.id === record.id);
      if (recordIndex === -1) {
        return undefined;
      }

      const runningRecord: WorkerJobRecord = {
        ...copyRecord(record),
        state: "running",
        startedAt: input.startedAt,
        claimedByWorkerId: input.claimedByWorkerId,
        claimToken: input.claimToken
      };
      records[recordIndex] = copyRecord(runningRecord);

      await this.writeRecords(records);
      return copyRecord(runningRecord);
    });
  }

  async completeClaimed(
    input: WorkerJobCompleteClaimedInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.withMutationLock(async () => {
      const records = await this.readRecords();
      const recordIndex = records.findIndex(
        (stored) => stored.id === input.jobId
      );
      if (recordIndex === -1) {
        return undefined;
      }

      const record = records[recordIndex];
      if (
        !record ||
        record.state !== "running" ||
        record.claimToken !== input.claimToken
      ) {
        return undefined;
      }

      const completedRecord = createClaimedCompletionRecord(record, input);
      records[recordIndex] = copyRecord(completedRecord);

      await this.writeRecords(records);
      return copyRecord(completedRecord);
    });
  }

  async requestRunningCancellation(
    input: WorkerJobRequestRunningCancellationInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.withMutationLock(async () => {
      const records = await this.readRecords();
      const recordIndex = records.findIndex(
        (stored) => stored.id === input.jobId
      );
      if (recordIndex === -1) {
        return undefined;
      }

      const record = records[recordIndex];
      if (!record) {
        return undefined;
      }
      if (record.state !== "running") {
        return copyRecord(record);
      }

      const updatedRecord = createRunningCancellationRecord(record, input);
      records[recordIndex] = copyRecord(updatedRecord);

      await this.writeRecords(records);
      return copyRecord(updatedRecord);
    });
  }

  async cancelQueued(
    input: WorkerJobCancelQueuedInput
  ): Promise<WorkerJobRecord | undefined> {
    return this.withMutationLock(async () => {
      const records = await this.readRecords();
      const recordIndex = records.findIndex(
        (stored) => stored.id === input.jobId
      );
      if (recordIndex === -1) {
        return undefined;
      }

      const record = records[recordIndex];
      if (!record) {
        return undefined;
      }
      if (record.state !== "queued") {
        return copyRecord(record);
      }

      const cancelledRecord = createQueuedCancellationRecord(record, input);
      records[recordIndex] = copyRecord(cancelledRecord);

      await this.writeRecords(records);
      return copyRecord(cancelledRecord);
    });
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
      workerJobs: records.map((record) => sanitizeRecordForJsonFile(record))
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

function getPayloadSource(record: WorkerJobRecord): string {
  return record.payloadSource ?? "process_memory";
}

function createClaimedCompletionRecord(
  record: WorkerJobRecord,
  input: WorkerJobCompleteClaimedInput
): WorkerJobRecord {
  return {
    ...copyRecord(record),
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
    ...copyRecord(record),
    cancelRequestedAt: record.cancelRequestedAt ?? input.cancelRequestedAt,
    cancelReason: record.cancelReason ?? input.cancelReason
  };
}

function createQueuedCancellationRecord(
  record: WorkerJobRecord,
  input: WorkerJobCancelQueuedInput
): WorkerJobRecord {
  return {
    ...copyRecord(record),
    state: "cancelled",
    errorName: input.errorName,
    resultSummary: { ...input.resultSummary },
    cancelRequestedAt: input.cancelRequestedAt,
    cancelledAt: input.cancelledAt,
    completedAt: input.completedAt,
    cancelReason: input.cancelReason ?? record.cancelReason
  };
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
    payloadSource: record.payloadSource ?? "process_memory",
    policy: copyPolicy(record.policy),
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
    claimToken: record.claimToken
  };
}

function sanitizeRecordForJsonFile(record: WorkerJobRecord): WorkerJobRecord {
  const copiedRecord = copyRecord(record);
  if (!copiedRecord.resultSummary) {
    return copiedRecord;
  }

  return {
    ...copiedRecord,
    resultSummary: {
      ...copiedRecord.resultSummary,
      stdout: "",
      stderr: ""
    }
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
