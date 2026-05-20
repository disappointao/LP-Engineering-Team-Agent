import type {
  BriefRecord,
  PageVersionRecord,
  WorkbenchRepositories
} from "@lp-agent/db";
import type { DeploymentHandoff } from "@lp-agent/git-deployment";
import type { WorkerJobRecord } from "@lp-agent/worker-runtime";
import {
  deriveRunLifecycleView,
  listRunLifecycleViewsForTask,
  type RunLifecycleState,
  type RunLifecycleView
} from "./run-lifecycle";
import { finalizeWorkerBackedSkillCommand } from "./skill-command-worker-queue";

export type RunRecoveryExecutionAction =
  | "resume_worker_finalization"
  | "retry_run";

export type RunRecoveryExecutionErrorCode =
  | "run_not_found"
  | "task_not_found"
  | "recovery_action_not_available"
  | "worker_runtime_not_configured"
  | "worker_job_not_found"
  | "worker_job_not_terminal"
  | "worker_finalization_failed"
  | "retry_input_not_reconstructable"
  | "retry_target_conflict"
  | "retry_failed";

export type RunRecoveryExecutionResult =
  | {
      ok: true;
      action: RunRecoveryExecutionAction;
      runId: string;
      newRunId?: string;
      state: RunLifecycleView["state"];
    }
  | {
      ok: false;
      error: RunRecoveryExecutionErrorCode;
    };

export interface RunRecoveryWorkerRuntime {
  getJob(id: string): Promise<WorkerJobRecord | undefined>;
}

export interface RunRecoveryService {
  createBriefFromPrompt(input: {
    projectId: string;
    prompt: string;
    taskId?: string;
    runId?: string;
  }): Promise<BriefRecord>;
  generatePageVersion(input: {
    projectId: string;
    briefId: string;
    taskId?: string;
    runId?: string;
  }): Promise<PageVersionRecord>;
  reviewPageVersion(input: {
    projectId: string;
    pageVersionId: string;
    taskId?: string;
    runId?: string;
  }): Promise<PageVersionRecord>;
  approveAndCreateDeployment(input: {
    projectId: string;
    pageVersionId: string;
    reviewerUserId: string;
    taskId?: string;
    runId?: string;
  }): Promise<DeploymentHandoff>;
}

export interface ListRunRecoveryViewsForTaskInput {
  repositories: WorkbenchRepositories;
  taskId: string;
  workerRuntime?: RunRecoveryWorkerRuntime;
}

export interface ExecuteRunRecoveryActionInput {
  repositories: WorkbenchRepositories;
  workerRuntime?: RunRecoveryWorkerRuntime;
  service: RunRecoveryService;
  currentUserId: string;
  taskId: string;
  runId: string;
  action: RunRecoveryExecutionAction;
  now?: () => Date;
}

export async function listRunRecoveryViewsForTask(
  input: ListRunRecoveryViewsForTaskInput
): Promise<RunLifecycleView[]> {
  const directViews = await listRunLifecycleViewsForTask(input);
  const viewsByRunId = new Map(directViews.map((view) => [view.runId, view]));
  const snapshotRunIds = await listSnapshotLinkedRunIds(input);

  for (const runId of snapshotRunIds) {
    if (viewsByRunId.has(runId)) {
      continue;
    }

    const result = await deriveRunLifecycleView({
      repositories: input.repositories,
      workerRuntime: input.workerRuntime,
      runId
    });
    if (result.ok) {
      viewsByRunId.set(runId, result.view);
    }
  }

  return [...viewsByRunId.values()].sort(compareRunLifecycleViews);
}

export async function executeRunRecoveryAction(
  input: ExecuteRunRecoveryActionInput
): Promise<RunRecoveryExecutionResult> {
  const task = await input.repositories.tasks.getById(input.taskId);
  if (!task) {
    return { ok: false, error: "task_not_found" };
  }

  const run = await input.repositories.runs.getById(input.runId);
  if (!run || !(await runBelongsToTaskScope(input))) {
    return { ok: false, error: "run_not_found" };
  }

  const lifecycleResult = await deriveRunLifecycleView({
    repositories: input.repositories,
    workerRuntime: input.workerRuntime,
    runId: input.runId
  });
  if (!lifecycleResult.ok) {
    return { ok: false, error: lifecycleResult.error };
  }
  if (!lifecycleResult.view.recoveryActions.includes(input.action)) {
    return { ok: false, error: "recovery_action_not_available" };
  }

  if (input.action === "retry_run") {
    return { ok: false, error: "retry_input_not_reconstructable" };
  }

  if (!input.workerRuntime) {
    return { ok: false, error: "worker_runtime_not_configured" };
  }

  const workerJobId = lifecycleResult.view.linkedWorkerJobId;
  if (!workerJobId) {
    return { ok: false, error: "worker_job_not_found" };
  }

  let workerJob: WorkerJobRecord | undefined;
  try {
    workerJob = await input.workerRuntime.getJob(workerJobId);
  } catch {
    return { ok: false, error: "worker_job_not_found" };
  }
  if (!workerJob) {
    return { ok: false, error: "worker_job_not_found" };
  }
  if (!isTerminalWorkerJob(workerJob)) {
    return { ok: false, error: "worker_job_not_terminal" };
  }

  let finalized: Awaited<ReturnType<typeof finalizeWorkerBackedSkillCommand>>;
  try {
    finalized = await finalizeWorkerBackedSkillCommand({
      repositories: input.repositories,
      workerJob,
      now: input.now
    });
  } catch {
    return { ok: false, error: "worker_finalization_failed" };
  }
  if (!finalized.ok) {
    return { ok: false, error: "worker_finalization_failed" };
  }

  const refreshed = await deriveRunLifecycleView({
    repositories: input.repositories,
    workerRuntime: input.workerRuntime,
    runId: input.runId
  });

  return {
    ok: true,
    action: input.action,
    runId: input.runId,
    state: refreshed.ok ? refreshed.view.state : toLifecycleState(finalized.state)
  };
}

async function listSnapshotLinkedRunIds(
  input: ListRunRecoveryViewsForTaskInput
): Promise<string[]> {
  const snapshot = await input.repositories.taskSnapshots.getByTaskId(input.taskId);
  if (!snapshot) {
    return [];
  }

  return snapshotRunIds(snapshot);
}

async function runBelongsToTaskScope(
  input: ExecuteRunRecoveryActionInput
): Promise<boolean> {
  const run = await input.repositories.runs.getById(input.runId);
  if (!run) {
    return false;
  }
  if (run.taskId === input.taskId) {
    return true;
  }

  const task = await input.repositories.tasks.getById(input.taskId);
  const snapshot = await input.repositories.taskSnapshots.getByTaskId(input.taskId);
  if (!task || !snapshot || task.projectId !== run.projectId) {
    return false;
  }

  return snapshotRunIds(snapshot).includes(input.runId);
}

function snapshotRunIds(snapshot: {
  briefId?: string;
  pageVersionId?: string;
}): string[] {
  return [
    ...(snapshot.briefId ? [`run_planner_${snapshot.briefId}`] : []),
    ...(snapshot.pageVersionId
      ? [
          `run_builder_${snapshot.pageVersionId}`,
          `run_reviewer_${snapshot.pageVersionId}`,
          `run_deployer_${snapshot.pageVersionId}`
        ]
      : [])
  ];
}

function compareRunLifecycleViews(
  left: RunLifecycleView,
  right: RunLifecycleView
): number {
  return left.startedAt.localeCompare(right.startedAt) || left.runId.localeCompare(right.runId);
}

function isTerminalWorkerJob(workerJob: WorkerJobRecord): boolean {
  return (
    workerJob.state === "completed" ||
    workerJob.state === "failed" ||
    workerJob.state === "rejected" ||
    workerJob.state === "cancelled"
  );
}

function toLifecycleState(state: string): RunLifecycleState {
  if (state === "completed" || state === "failed" || state === "cancelled") {
    return state;
  }
  return "failed";
}
