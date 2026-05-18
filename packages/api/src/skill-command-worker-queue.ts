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
  claimOldestQueuedForProject?(input: {
    workerId: string;
    projectId: string;
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

type WorkerFinalState = "completed" | "failed" | "rejected" | "cancelled";
type TerminalRecordState = "completed" | "failed" | "cancelled";

export async function runLocalWorkerOnceAndFinalize(input: {
  repositories: WorkbenchRepositories;
  workerRuntime?: SkillCommandQueueRuntime;
  workerId: string;
  projectId?: string;
  now?: () => Date;
  afterFinalize?: () => void;
}): Promise<RunLocalWorkerOnceResult> {
  if (!input.workerRuntime) {
    return { ok: false, error: "worker_runtime_not_configured" };
  }

  let workerJob: WorkerJobRecord;
  try {
    const claim =
      input.projectId !== undefined
        ? await claimOldestQueuedForProject({
            workerRuntime: input.workerRuntime,
            workerId: input.workerId,
            projectId: input.projectId
          })
        : await input.workerRuntime.claimOldestQueued({
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

async function claimOldestQueuedForProject(input: {
  workerRuntime: SkillCommandQueueRuntime;
  workerId: string;
  projectId: string;
}): Promise<{ record: WorkerJobRecord; claimToken: string } | undefined> {
  if (!input.workerRuntime.claimOldestQueuedForProject) {
    throw new Error("worker_project_scoped_claim_not_supported");
  }
  return input.workerRuntime.claimOldestQueuedForProject({
    workerId: input.workerId,
    projectId: input.projectId
  });
}

export async function finalizeWorkerBackedSkillCommand(input: {
  repositories: WorkbenchRepositories;
  workerJob: WorkerJobRecord;
  now?: () => Date;
}): Promise<RunLocalWorkerOnceResult> {
  const workerFinalState = toFinalState(input.workerJob);
  if (!workerFinalState) {
    return { ok: false, error: "worker_job_finalization_failed" };
  }

  const link = await findWorkerLinkEvent(input.repositories, input.workerJob.id);
  if (!link) {
    return { ok: false, error: "worker_job_finalization_failed" };
  }

  const runId = toOptionalString(link.payload.runId);
  const observationId = toOptionalString(link.payload.observationId);
  if (!runId || !observationId) {
    return { ok: false, error: "worker_job_finalization_failed" };
  }

  const run = await input.repositories.runs.getById(runId);
  if (!run) {
    return { ok: false, error: "worker_job_finalization_failed" };
  }

  const observations = await input.repositories.toolObservations.listForRun(run.id);
  const observation = observations.find(
    (candidate) => candidate.id === observationId
  );
  if (!observation) {
    return { ok: false, error: "worker_job_finalization_failed" };
  }

  const existingEvents = await input.repositories.runEvents.listForRun(run.id);
  const terminalToolEvent = existingEvents
    .filter((event) => isTerminalToolEvent(event.type))
    .at(-1);
  const terminalRunEvent = existingEvents
    .filter((event) => isTerminalRunEvent(event.type))
    .at(-1);
  const terminalRecordState = terminalRunEvent
    ? terminalRunEventToRecordState(terminalRunEvent)
    : terminalToolEvent
      ? terminalToolEventToRecordState(terminalToolEvent)
      : toRecordTerminalState(workerFinalState);
  const resultState = workerFinalState;
  let newTerminalEventCreatedAt: string | undefined;
  const getNewTerminalEventCreatedAt = (): string => {
    newTerminalEventCreatedAt ??= nextRepositoryTimestamp(
      input.repositories,
      input.now ?? (() => new Date())
    );
    return newTerminalEventCreatedAt;
  };
  const outputSummary = summarizeWorkerResult(input.workerJob);
  const errorName = sanitizeWorkerErrorName(
    input.workerJob.errorName ?? input.workerJob.resultSummary?.errorName
  );
  const exitCode = input.workerJob.resultSummary?.exitCode;
  let nextSequence =
    existingEvents.reduce((max, event) => Math.max(max, event.sequence), 0) + 1;
  const terminalPayload = {
    workerJobId: input.workerJob.id,
    ...(observationId ? { observationId } : {}),
    outputSummary,
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(errorName ? { errorName } : {})
  };

  if (!terminalToolEvent) {
    await input.repositories.runEvents.save(
      toTerminalRunEventRecord({
        run,
        sequence: nextSequence,
        type: toTerminalToolEventType(terminalRecordState),
        message: toTerminalToolEventMessage(terminalRecordState),
        payload: terminalPayload,
        createdAt: getNewTerminalEventCreatedAt()
      })
    );
    nextSequence += 1;
  }

  let reconciledRunEvent = terminalRunEvent;
  if (!reconciledRunEvent) {
    reconciledRunEvent = toTerminalRunEventRecord({
      run,
      sequence: nextSequence,
      type: toTerminalRunEventType(terminalRecordState),
      message: toTerminalRunEventMessage(terminalRecordState),
      payload: terminalPayload,
      createdAt: getNewTerminalEventCreatedAt()
    });
    await input.repositories.runEvents.save(reconciledRunEvent);
  }

  await updateLinkedObservation({
    repositories: input.repositories,
    observation,
    state: terminalRecordState,
    outputSummary,
    exitCode,
    errorName,
    completedAt: reconciledRunEvent.createdAt
  });

  await input.repositories.runs.save({
    ...run,
    state: terminalRecordState,
    completedAt: reconciledRunEvent.createdAt
  });

  return {
    ok: true,
    state: resultState,
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
  observation: ToolObservationRecord;
  state: ToolObservationRecord["state"];
  outputSummary: string;
  exitCode?: number;
  errorName?: string;
  completedAt: string;
}): Promise<void> {
  const {
    exitCode: _previousExitCode,
    errorName: _previousErrorName,
    ...baseObservation
  } = input.observation;
  await input.repositories.toolObservations.save({
    ...baseObservation,
    outputSummary: input.outputSummary,
    state: input.state,
    ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
    ...(input.errorName !== undefined ? { errorName: input.errorName } : {}),
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
): WorkerFinalState | undefined {
  if (
    workerJob.state === "completed" ||
    workerJob.state === "failed" ||
    workerJob.state === "rejected" ||
    workerJob.state === "cancelled"
  ) {
    return workerJob.state;
  }
  return undefined;
}

function toRecordTerminalState(
  state: WorkerFinalState
): TerminalRecordState {
  return state === "rejected" ? "failed" : state;
}

function terminalRunEventToRecordState(
  event: RunEventRecord
): TerminalRecordState {
  if (event.type === "run.completed") {
    return "completed";
  }
  if (event.type === "run.cancelled") {
    return "cancelled";
  }
  return "failed";
}

function terminalToolEventToRecordState(
  event: RunEventRecord
): TerminalRecordState {
  if (event.type === "tool.completed") {
    return "completed";
  }
  if (event.type === "tool.cancelled") {
    return "cancelled";
  }
  return "failed";
}

function toTerminalToolEventType(state: TerminalRecordState): string {
  if (state === "completed") {
    return "tool.completed";
  }
  if (state === "cancelled") {
    return "tool.cancelled";
  }
  return "tool.failed";
}

function toTerminalRunEventType(state: TerminalRecordState): string {
  if (state === "completed") {
    return "run.completed";
  }
  if (state === "cancelled") {
    return "run.cancelled";
  }
  return "run.failed";
}

function toTerminalToolEventMessage(state: TerminalRecordState): string {
  if (state === "completed") {
    return "Deployment skill command completed.";
  }
  if (state === "cancelled") {
    return "Deployment skill command cancelled.";
  }
  return "Deployment skill command failed.";
}

function toTerminalRunEventMessage(state: TerminalRecordState): string {
  if (state === "completed") {
    return "Deployment skill command run completed.";
  }
  if (state === "cancelled") {
    return "Deployment skill command run cancelled.";
  }
  return "Deployment skill command run failed.";
}

function summarizeWorkerResult(workerJob: WorkerJobRecord): string {
  const result = workerJob.resultSummary;
  if (!result) {
    return "Worker job did not produce a result.";
  }
  return [
    `stdout: ${result.stdoutBytes} bytes`,
    `stderr: ${result.stderrBytes} bytes`
  ].join("\n");
}

function sanitizeWorkerErrorName(value: string | undefined): string | undefined {
  if (value === undefined) {
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

function isTerminalToolEvent(type: string): boolean {
  return (
    type === "tool.completed" ||
    type === "tool.failed" ||
    type === "tool.cancelled"
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
