import { randomUUID } from "node:crypto";

import type {
  RunEventRecord,
  RunRecord,
  ToolObservationRecord,
  WorkbenchRepositories
} from "@lp-agent/db";
import type {
  SafeWorkerJobInput,
  SandboxPolicy,
  WorkerJobRecord
} from "@lp-agent/worker-runtime";
import { nextRepositoryTimestamp } from "./run-orchestrator";

export interface SkillCommandQueueRuntime {
  enqueueSafe(
    input: SafeWorkerJobInput,
    policy?: SandboxPolicy
  ): Promise<WorkerJobRecord>;
  claimOldestQueued(input: {
    workerId: string;
  }): Promise<{ record: WorkerJobRecord; claimToken: string } | undefined>;
  runClaimedJob(claim: {
    record: WorkerJobRecord;
    claimToken: string;
  }): Promise<WorkerJobRecord>;
  getJob(id: string): Promise<WorkerJobRecord | undefined>;
}

export type RunLocalWorkerOnceResult =
  | {
      ok: true;
      state: "completed" | "failed" | "rejected" | "cancelled" | "idle";
      workerJobId?: string;
      runId?: string;
    }
  | {
      ok: false;
      error:
        | "worker_runtime_not_configured"
        | "worker_job_execution_failed"
        | "worker_job_finalization_failed";
    };

export async function runLocalWorkerOnceAndFinalize(input: {
  repositories: WorkbenchRepositories;
  workerRuntime?: SkillCommandQueueRuntime;
  workerId: string;
  now?: () => Date;
  afterFinalize?: () => void;
}): Promise<RunLocalWorkerOnceResult> {
  if (!input.workerRuntime) {
    return { ok: false, error: "worker_runtime_not_configured" };
  }

  let workerJob: WorkerJobRecord;
  try {
    const claim = await input.workerRuntime.claimOldestQueued({
      workerId: input.workerId
    });
    if (!claim) {
      return { ok: true, state: "idle" };
    }
    workerJob = await input.workerRuntime.runClaimedJob(claim);
  } catch {
    return { ok: false, error: "worker_job_execution_failed" };
  }

  try {
    const finalized = await finalizeWorkerBackedSkillCommand({
      repositories: input.repositories,
      workerJob,
      now: input.now
    });
    if (!finalized.ok) {
      return finalized;
    }
    input.afterFinalize?.();
    return finalized;
  } catch {
    return { ok: false, error: "worker_job_finalization_failed" };
  }
}

export async function finalizeWorkerBackedSkillCommand(input: {
  repositories: WorkbenchRepositories;
  workerJob: WorkerJobRecord;
  now?: () => Date;
}): Promise<RunLocalWorkerOnceResult> {
  const link = await findWorkerLinkEvent(input.repositories, input.workerJob.id);
  const finalState = toFinalState(input.workerJob);
  if (!link) {
    return {
      ok: true,
      state: finalState,
      workerJobId: input.workerJob.id
    };
  }

  const runId = toOptionalString(link.payload.runId);
  const observationId = toOptionalString(link.payload.observationId);
  if (!runId) {
    return { ok: false, error: "worker_job_finalization_failed" };
  }

  const run = await input.repositories.runs.getById(runId);
  if (!run) {
    return { ok: false, error: "worker_job_finalization_failed" };
  }

  const existingEvents = await input.repositories.runEvents.listForRun(run.id);
  const terminalEvents = existingEvents.filter((event) =>
    isTerminalRunEvent(event.type)
  );
  const terminalEvent = terminalEvents.at(-1);
  if (terminalEvent) {
    return {
      ok: true,
      state: terminalEventToResultState(terminalEvent),
      workerJobId: input.workerJob.id,
      runId: run.id
    };
  }

  const completedAt = nextRepositoryTimestamp(
    input.repositories,
    input.now ?? (() => new Date())
  );
  const outputSummary = summarizeWorkerResult(input.workerJob);
  const errorName = sanitizeWorkerErrorName(
    input.workerJob.errorName ?? input.workerJob.resultSummary?.errorName
  );
  const exitCode = input.workerJob.resultSummary?.exitCode;
  const terminalRecordState = toRecordTerminalState(finalState);
  const nextSequence =
    existingEvents.reduce((max, event) => Math.max(max, event.sequence), 0) + 1;
  const terminalPayload = {
    workerJobId: input.workerJob.id,
    ...(observationId ? { observationId } : {}),
    outputSummary,
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(errorName ? { errorName } : {})
  };

  await input.repositories.runEvents.save(
    toTerminalRunEventRecord({
      run,
      sequence: nextSequence,
      type: terminalRecordState === "completed"
        ? "tool.completed"
        : terminalRecordState === "cancelled"
          ? "tool.cancelled"
          : "tool.failed",
      message: terminalRecordState === "completed"
        ? "Deployment skill command completed."
        : terminalRecordState === "cancelled"
          ? "Deployment skill command cancelled."
          : "Deployment skill command failed.",
      payload: terminalPayload,
      createdAt: completedAt
    })
  );
  await input.repositories.runEvents.save(
    toTerminalRunEventRecord({
      run,
      sequence: nextSequence + 1,
      type: terminalRecordState === "completed"
        ? "run.completed"
        : terminalRecordState === "cancelled"
          ? "run.cancelled"
          : "run.failed",
      message: terminalRecordState === "completed"
        ? "Deployment skill command run completed."
        : terminalRecordState === "cancelled"
          ? "Deployment skill command run cancelled."
          : "Deployment skill command run failed.",
      payload: terminalPayload,
      createdAt: completedAt
    })
  );

  if (observationId) {
    await updateLinkedObservation({
      repositories: input.repositories,
      runId: run.id,
      observationId,
      state: terminalRecordState,
      outputSummary,
      exitCode,
      errorName,
      completedAt
    });
  }

  await input.repositories.runs.save({
    ...run,
    state: terminalRecordState,
    completedAt
  });

  return {
    ok: true,
    state: finalState,
    workerJobId: input.workerJob.id,
    runId: run.id
  };
}

async function findWorkerLinkEvent(
  repositories: WorkbenchRepositories,
  workerJobId: string
): Promise<RunEventRecord | undefined> {
  const events = await repositories.runEvents.listAll();
  return events
    .filter(
      (event) =>
        event.type === "worker.job.linked" &&
        event.payload.workerJobId === workerJobId
    )
    .sort(compareRunEventsLatestFirst)
    .at(0);
}

async function updateLinkedObservation(input: {
  repositories: WorkbenchRepositories;
  runId: string;
  observationId: string;
  state: ToolObservationRecord["state"];
  outputSummary: string;
  exitCode?: number;
  errorName?: string;
  completedAt: string;
}): Promise<void> {
  const observations = await input.repositories.toolObservations.listForRun(
    input.runId
  );
  const observation = observations.find(
    (candidate) => candidate.id === input.observationId
  );
  if (!observation) {
    return;
  }

  await input.repositories.toolObservations.save({
    ...observation,
    outputSummary: input.outputSummary,
    state: input.state,
    ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
    ...(input.errorName ? { errorName: input.errorName } : {}),
    completedAt: input.completedAt
  });
}

function toTerminalRunEventRecord(input: {
  run: RunRecord;
  sequence: number;
  type: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
}): RunEventRecord {
  return {
    id: `${input.run.id}_event_${input.sequence}_${randomUUID()}`,
    runId: input.run.id,
    projectId: input.run.projectId,
    taskId: input.run.taskId,
    sequence: input.sequence,
    type: input.type,
    message: input.message,
    payload: structuredClone(input.payload),
    createdAt: input.createdAt
  };
}

function toFinalState(
  workerJob: WorkerJobRecord
): "completed" | "failed" | "rejected" | "cancelled" {
  if (
    workerJob.state === "completed" ||
    workerJob.state === "failed" ||
    workerJob.state === "rejected" ||
    workerJob.state === "cancelled"
  ) {
    return workerJob.state;
  }
  return "failed";
}

function toRecordTerminalState(
  state: "completed" | "failed" | "rejected" | "cancelled"
): "completed" | "failed" | "cancelled" {
  return state === "rejected" ? "failed" : state;
}

function terminalEventToResultState(
  event: RunEventRecord
): "completed" | "failed" | "cancelled" {
  if (event.type === "run.completed") {
    return "completed";
  }
  if (event.type === "run.cancelled") {
    return "cancelled";
  }
  return "failed";
}

function summarizeWorkerResult(workerJob: WorkerJobRecord): string {
  const result = workerJob.resultSummary;
  if (!result) {
    return "Worker job did not produce a result.";
  }
  return [
    `stdout: ${result.stdoutBytes} chars`,
    `stderr: ${result.stderrBytes} chars`
  ].join("\n");
}

function sanitizeWorkerErrorName(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed !== value ||
    trimmed.length > 80 ||
    /\s/.test(trimmed) ||
    !/^[A-Za-z0-9_.:-]+$/.test(trimmed)
  ) {
    return "worker_job_error";
  }
  return trimmed;
}

function isTerminalRunEvent(type: string): boolean {
  return (
    type === "run.completed" ||
    type === "run.failed" ||
    type === "run.cancelled"
  );
}

function compareRunEventsLatestFirst(
  left: RunEventRecord,
  right: RunEventRecord
): number {
  const createdAtComparison = right.createdAt.localeCompare(left.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }
  return right.sequence - left.sequence;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
