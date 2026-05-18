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
  | "idle"
  | "stopping"
  | "cancelled"
  | "not_interruptible";

export interface TaskInterruptView {
  available: boolean;
  state: TaskInterruptState;
  taskId: string;
  runId?: string;
  workerJobId?: string;
  requestedAt?: string;
}

export type InterruptTaskResult =
  | {
      ok: true;
      taskId: string;
      state: "cancelled" | "interrupt_requested";
      runId: string;
      workerJobId: string;
    }
  | {
      ok: true;
      taskId: string;
      state: "not_interruptible";
      runId?: string;
      workerJobId?: string;
    }
  | {
      ok: false;
      error: "task_not_found" | "interrupt_target_not_found" | "interrupt_failed";
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
  workerJob: WorkerJobRecord;
}

type InterruptTargetLookup =
  | { kind: "target"; target: InterruptTarget }
  | { kind: "missing" }
  | { kind: "none" };

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
      runId: input.runId,
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

  const targetLookup = await findLatestInterruptTarget({
    repositories: input.repositories,
    workerRuntime: input.workerRuntime,
    taskId: input.taskId
  });
  if (targetLookup.kind === "missing") {
    return {
      ok: false,
      error: "interrupt_target_not_found"
    };
  }
  if (targetLookup.kind === "none") {
    return {
      ok: true,
      taskId: input.taskId,
      state: "not_interruptible"
    };
  }

  const target = targetLookup.target;
  const workerJob = target.workerJob;

  if (workerJob.state === "cancelled") {
    await markRunCancelled({
      repositories: input.repositories,
      run: target.run,
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
      runId: target.run.id,
      workerJobId: workerJob.id
    },
    now: input.now
  });

  let cancelledJob: WorkerJobRecord | undefined;
  try {
    cancelledJob = await input.workerRuntime.cancelJob(workerJob.id, input.reason);
  } catch {
    return {
      ok: false,
      error: "interrupt_failed"
    };
  }
  if (!cancelledJob) {
    return {
      ok: false,
      error: "interrupt_target_not_found"
    };
  }

  if (cancelledJob.state === "cancelled") {
    await markRunCancelled({
      repositories: input.repositories,
      run: target.run,
      now: input.now
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
        runId: target.run.id,
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
  const targetLookup = await findLatestInterruptTarget({
    repositories: input.repositories,
    workerRuntime: input.workerRuntime,
    taskId: input.taskId
  });
  if (targetLookup.kind !== "target") {
    return {
      available: false,
      state: "not_interruptible",
      taskId: input.taskId
    };
  }

  const target = targetLookup.target;
  const workerJob = target.workerJob;
  const state = toTaskInterruptState(workerJob);
  return {
    available: state === "idle" || state === "stopping",
    state,
    taskId: input.taskId,
    runId: target.run.id,
    workerJobId: workerJob.id,
    ...(workerJob.cancelRequestedAt
      ? { requestedAt: workerJob.cancelRequestedAt }
      : {})
  };
}

async function findLatestInterruptTarget(input: {
  repositories: WorkbenchRepositories;
  workerRuntime: Pick<WorkerRuntime, "getJob">;
  taskId: string;
}): Promise<InterruptTargetLookup> {
  const { repositories, taskId, workerRuntime } = input;
  const linkedEvents = await repositories.runEvents.listForTask(taskId);
  const linkedCandidates = linkedEvents
    .filter((event) => event.type === "worker.job.linked")
    .reverse();

  let latestCancelledTarget: InterruptTarget | undefined;
  let latestTerminalTarget: InterruptTarget | undefined;
  let sawLinkedWorkerJobId = false;
  for (const linkedEvent of linkedCandidates) {
    const workerJobId = readWorkerJobId(linkedEvent);
    if (!workerJobId) {
      continue;
    }
    sawLinkedWorkerJobId = true;

    let workerJob: WorkerJobRecord | undefined;
    try {
      workerJob = await workerRuntime.getJob(workerJobId);
    } catch {
      workerJob = undefined;
    }
    if (!workerJob) {
      continue;
    }

    const run = await repositories.runs.getById(linkedEvent.runId);
    if (!run) {
      continue;
    }

    if (workerJob.state === "cancelled") {
      latestCancelledTarget ??= {
        run,
        workerJob
      };
      continue;
    }

    if (!isInterruptibleWorkerJob(workerJob)) {
      latestTerminalTarget ??= {
        run,
        workerJob
      };
      continue;
    }

    return {
      kind: "target",
      target: {
        run,
        workerJob
      }
    };
  }

  if (latestCancelledTarget) {
    return {
      kind: "target",
      target: latestCancelledTarget
    };
  }
  if (latestTerminalTarget) {
    return {
      kind: "target",
      target: latestTerminalTarget
    };
  }
  return sawLinkedWorkerJobId ? { kind: "missing" } : { kind: "none" };
}

function readWorkerJobId(event: RunEventRecord): string | undefined {
  const workerJobId = event.payload.workerJobId;
  return typeof workerJobId === "string" && workerJobId.trim().length > 0
    ? workerJobId
    : undefined;
}

function isInterruptibleWorkerJob(workerJob: WorkerJobRecord): boolean {
  return workerJob.state === "queued" || workerJob.state === "running";
}

function toTaskInterruptState(workerJob: WorkerJobRecord): TaskInterruptState {
  if (workerJob.state === "running" && workerJob.cancelRequestedAt) {
    return "stopping";
  }
  if (isInterruptibleWorkerJob(workerJob)) {
    return "idle";
  }
  if (workerJob.state === "cancelled") {
    return "cancelled";
  }
  return "not_interruptible";
}

async function markRunCancelled(input: {
  repositories: WorkbenchRepositories;
  run: RunRecord;
  now?: () => Date;
}): Promise<void> {
  const completedAt = nextRepositoryTimestamp(
    input.repositories,
    input.now ?? (() => new Date())
  );
  await input.repositories.runs.save({
    ...input.run,
    state: "cancelled",
    completedAt
  });
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
