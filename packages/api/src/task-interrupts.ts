import type {
  RunEventRecord,
  RunRecord,
  WorkbenchRepositories
} from "@lp-agent/db";
import type {
  WorkerJobRecord,
  WorkerRuntime
} from "@lp-agent/worker-runtime";
import { nextRepositoryTimestamp } from "./run-orchestrator";

export type TaskInterruptState =
  | "interruptible"
  | "stopping"
  | "not_interruptible"
  | "unavailable";

export interface TaskInterruptView {
  available: boolean;
  state: TaskInterruptState;
  taskId: string;
  runId?: string;
  workerJobId?: string;
}

export type InterruptTaskResult =
  | {
      ok: true;
      taskId: string;
      state: "cancelled" | "interrupt_requested" | "not_interruptible";
      runId: string;
      workerJobId: string;
    }
  | {
      ok: false;
      error: "task_not_found" | "interrupt_target_not_found";
    };

export type TaskInterruptWorkerRuntime = Pick<
  WorkerRuntime,
  "cancelJob" | "getJob"
>;

export interface LinkWorkerJobToTaskInput {
  repositories: WorkbenchRepositories;
  taskId: string;
  projectId: string;
  runId: string;
  workerJobId: string;
  now?: () => Date;
}

export interface InterruptTaskInput {
  repositories: WorkbenchRepositories;
  workerRuntime: TaskInterruptWorkerRuntime;
  taskId: string;
  reason: string;
  now?: () => Date;
}

export interface DeriveTaskInterruptViewInput {
  repositories: WorkbenchRepositories;
  workerRuntime: Pick<WorkerRuntime, "getJob">;
  taskId: string;
}

interface InterruptTarget {
  run: RunRecord;
  workerJobId: string;
}

export async function linkWorkerJobToTask(
  input: LinkWorkerJobToTaskInput
): Promise<void> {
  await saveRunEvent({
    repositories: input.repositories,
    runId: input.runId,
    projectId: input.projectId,
    taskId: input.taskId,
    type: "worker.job.linked",
    message: "Worker job linked to task.",
    payload: {
      taskId: input.taskId,
      workerJobId: input.workerJobId
    },
    now: input.now
  });
}

export async function interruptTask(
  input: InterruptTaskInput
): Promise<InterruptTaskResult> {
  const task = await input.repositories.tasks.getById(input.taskId);
  if (!task) {
    return {
      ok: false,
      error: "task_not_found"
    };
  }

  const target = await findLatestInterruptTarget(input.repositories, input.taskId);
  if (!target) {
    return {
      ok: false,
      error: "interrupt_target_not_found"
    };
  }

  const workerJob = await input.workerRuntime.getJob(target.workerJobId);
  if (!workerJob) {
    return {
      ok: false,
      error: "interrupt_target_not_found"
    };
  }

  if (!isInterruptibleWorkerJob(workerJob)) {
    return {
      ok: true,
      taskId: input.taskId,
      state: "not_interruptible",
      runId: target.run.id,
      workerJobId: workerJob.id
    };
  }

  await saveRunEvent({
    repositories: input.repositories,
    runId: target.run.id,
    projectId: target.run.projectId,
    taskId: target.run.taskId,
    type: "task.interrupt.requested",
    message: "Task interrupt requested.",
    payload: {
      taskId: input.taskId,
      workerJobId: workerJob.id,
      reason: input.reason
    },
    now: input.now
  });

  const cancelledJob = await input.workerRuntime.cancelJob(workerJob.id, input.reason);
  if (!cancelledJob) {
    return {
      ok: false,
      error: "interrupt_target_not_found"
    };
  }

  if (cancelledJob.state === "cancelled") {
    const completedAt = nextRepositoryTimestamp(
      input.repositories,
      input.now ?? (() => new Date())
    );
    await input.repositories.runs.save({
      ...target.run,
      state: "cancelled",
      completedAt
    });
    await saveRunEvent({
      repositories: input.repositories,
      runId: target.run.id,
      projectId: target.run.projectId,
      taskId: target.run.taskId,
      type: "task.interrupt.cancelled",
      message: "Task interrupt cancelled the worker job.",
      payload: {
        taskId: input.taskId,
        workerJobId: workerJob.id
      },
      now: input.now
    });

    return {
      ok: true,
      taskId: input.taskId,
      state: "cancelled",
      runId: target.run.id,
      workerJobId: workerJob.id
    };
  }

  return {
    ok: true,
    taskId: input.taskId,
    state: "interrupt_requested",
    runId: target.run.id,
    workerJobId: workerJob.id
  };
}

export async function deriveTaskInterruptView(
  input: DeriveTaskInterruptViewInput
): Promise<TaskInterruptView> {
  const target = await findLatestInterruptTarget(input.repositories, input.taskId);
  if (!target) {
    return {
      available: false,
      state: "unavailable",
      taskId: input.taskId
    };
  }

  const workerJob = await input.workerRuntime.getJob(target.workerJobId);
  if (!workerJob) {
    return {
      available: false,
      state: "unavailable",
      taskId: input.taskId,
      runId: target.run.id,
      workerJobId: target.workerJobId
    };
  }

  const state = toTaskInterruptState(workerJob);
  return {
    available: state === "interruptible" || state === "stopping",
    state,
    taskId: input.taskId,
    runId: target.run.id,
    workerJobId: workerJob.id
  };
}

async function findLatestInterruptTarget(
  repositories: WorkbenchRepositories,
  taskId: string
): Promise<InterruptTarget | undefined> {
  const runs = await repositories.runs.listForTask(taskId);
  const linkedEvents = await repositories.runEvents.listForTask(taskId);
  const latestLinkedEvent = linkedEvents
    .filter((event) => event.type === "worker.job.linked")
    .at(-1);
  const workerJobId = latestLinkedEvent
    ? readWorkerJobId(latestLinkedEvent)
    : readWorkerJobIdFromRuns(runs);
  if (!workerJobId) {
    return undefined;
  }

  const run = latestLinkedEvent
    ? await repositories.runs.getById(latestLinkedEvent.runId)
    : runs.at(-1);
  if (!run) {
    return undefined;
  }

  return {
    run,
    workerJobId
  };
}

function readWorkerJobId(event: RunEventRecord): string | undefined {
  const workerJobId = event.payload.workerJobId;
  return typeof workerJobId === "string" && workerJobId.trim().length > 0
    ? workerJobId
    : undefined;
}

function readWorkerJobIdFromRuns(runs: RunRecord[]): string | undefined {
  for (const run of [...runs].reverse()) {
    const injectedWorkerJob = [...run.contextSummary.injected]
      .reverse()
      .find((entry) => entry.startsWith("workerJob:"));
    const workerJobId = injectedWorkerJob?.slice("workerJob:".length);
    if (workerJobId && workerJobId.trim().length > 0) {
      return workerJobId;
    }
  }
  return undefined;
}

function isInterruptibleWorkerJob(workerJob: WorkerJobRecord): boolean {
  return workerJob.state === "queued" || workerJob.state === "running";
}

function toTaskInterruptState(workerJob: WorkerJobRecord): TaskInterruptState {
  if (workerJob.state === "running" && workerJob.cancelRequestedAt) {
    return "stopping";
  }
  if (isInterruptibleWorkerJob(workerJob)) {
    return "interruptible";
  }
  return "not_interruptible";
}

async function saveRunEvent(input: {
  repositories: WorkbenchRepositories;
  runId: string;
  projectId: string;
  taskId?: string;
  type: string;
  message: string;
  payload: Record<string, unknown>;
  now?: () => Date;
}): Promise<RunEventRecord> {
  const events = await input.repositories.runEvents.listForRun(input.runId);
  const nextSequence =
    events.reduce((max, event) => Math.max(max, event.sequence), 0) + 1;
  const record: RunEventRecord = {
    id: `${input.runId}_event_${nextSequence}`,
    runId: input.runId,
    projectId: input.projectId,
    taskId: input.taskId,
    sequence: nextSequence,
    type: input.type,
    message: input.message,
    payload: structuredClone(input.payload),
    createdAt: nextRepositoryTimestamp(
      input.repositories,
      input.now ?? (() => new Date())
    )
  };
  await input.repositories.runEvents.save(record);
  return record;
}
