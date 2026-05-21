import type {
  AgentHandoffRecord,
  BriefRecord,
  PageVersionRecord,
  RunEventRecord,
  RunRecord,
  WorkbenchMessageRecord,
  WorkbenchRepositories
} from "@lp-agent/db";
import type { DeploymentHandoff } from "@lp-agent/git-deployment";
import type { WorkerJobRecord } from "@lp-agent/worker-runtime";
import {
  deriveRunLifecycleView,
  isUnsupportedRetryContext,
  listRunLifecycleViewsForTask,
  type RunLifecycleState,
  type RunLifecycleView
} from "./run-lifecycle";
import { finalizeWorkerBackedSkillCommand } from "./skill-command-worker-queue";
import { toRuntimeHandoffSummary } from "./agent-handoffs";

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
    failIfDeploymentExists?: boolean;
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

const repositoryRetryLocks = new WeakMap<WorkbenchRepositories, Promise<void>>();

export async function listRunRecoveryViewsForTask(
  input: ListRunRecoveryViewsForTaskInput
): Promise<RunLifecycleView[]> {
  const task = await input.repositories.tasks.getById(input.taskId);
  if (!task?.projectId) {
    return [];
  }

  const directViews = (await listRunLifecycleViewsForTask(input)).filter(
    (view) => view.projectId === task.projectId
  );
  const viewsByRunId = new Map(directViews.map((view) => [view.runId, view]));
  const snapshot = await input.repositories.taskSnapshots.getByTaskId(input.taskId);

  if (snapshot?.projectId === task.projectId) {
    for (const runId of snapshotRunIds(snapshot)) {
      if (viewsByRunId.has(runId)) {
        continue;
      }

      const result = await deriveRunLifecycleView({
        repositories: input.repositories,
        workerRuntime: input.workerRuntime,
        runId
      });
      if (result.ok && result.view.projectId === task.projectId) {
        viewsByRunId.set(runId, result.view);
      }
    }
  }

  await applyBlockedHandoffRecoveryViews({
    repositories: input.repositories,
    workerRuntime: input.workerRuntime,
    taskId: input.taskId,
    projectId: task.projectId,
    viewsByRunId
  });

  return [...viewsByRunId.values()].sort(compareRunLifecycleViews);
}

async function applyBlockedHandoffRecoveryViews(input: {
  repositories: WorkbenchRepositories;
  workerRuntime?: RunRecoveryWorkerRuntime;
  taskId: string;
  projectId: string;
  viewsByRunId: Map<string, RunLifecycleView>;
}): Promise<void> {
  const blockedHandoffs = (await input.repositories.agentHandoffs.listForTask(input.taskId))
    .filter(
      (handoff) =>
        handoff.projectId === input.projectId &&
        handoff.taskId === input.taskId &&
        handoff.state === "blocked"
    );

  for (const handoff of blockedHandoffs) {
    if (hasTargetRunView(input.viewsByRunId, handoff)) {
      continue;
    }

    let sourceView = input.viewsByRunId.get(handoff.fromRunId);
    if (!sourceView) {
      const result = await deriveRunLifecycleView({
        repositories: input.repositories,
        workerRuntime: input.workerRuntime,
        runId: handoff.fromRunId
      });
      if (!result.ok) {
        continue;
      }
      sourceView = result.view;
    }

    if (sourceView.projectId !== input.projectId || sourceView.taskId !== input.taskId) {
      continue;
    }

    input.viewsByRunId.set(handoff.fromRunId, toBlockedHandoffRecoveryView(sourceView, handoff));
  }
}

function hasTargetRunView(
  viewsByRunId: Map<string, RunLifecycleView>,
  handoff: AgentHandoffRecord
): boolean {
  return [...viewsByRunId.values()].some(
    (view) =>
      view.projectId === handoff.projectId &&
      view.taskId === handoff.taskId &&
      view.role === handoff.toRole
  );
}

function toBlockedHandoffRecoveryView(
  sourceView: RunLifecycleView,
  handoff: AgentHandoffRecord
): RunLifecycleView {
  const sanitizedHandoff = toRuntimeHandoffSummary(handoff);
  return {
    ...sourceView,
    state: "blocked",
    blockedReason: sanitizedHandoff.blockingReason,
    diagnosticSummary: {
      code: "handoff_blocked",
      message: blockedHandoffDiagnosticMessage(handoff),
      source: "handoff"
    },
    recoveryActions: ["resolve_blocker"]
  };
}

function blockedHandoffDiagnosticMessage(handoff: AgentHandoffRecord): string {
  if (handoff.fromRole === "reviewer" && handoff.toRole === "deployer") {
    return "Reviewer blocked deployment.";
  }
  return "Agent handoff blocked.";
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
  if (
    input.action === "resume_worker_finalization" &&
    !input.workerRuntime &&
    lifecycleResult.view.linkedWorkerJobId
  ) {
    return { ok: false, error: "worker_runtime_not_configured" };
  }
  if (input.action === "retry_run" && isUnsupportedRetryContext(run)) {
    return { ok: false, error: "retry_input_not_reconstructable" };
  }
  if (!lifecycleResult.view.recoveryActions.includes(input.action)) {
    return { ok: false, error: "recovery_action_not_available" };
  }

  if (input.action === "retry_run") {
    return retryRun({ ...input, run });
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
  if (!(await hasUniqueRequestedWorkerLink({ ...input, view: lifecycleResult.view }))) {
    return { ok: false, error: "worker_finalization_failed" };
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

async function runBelongsToTaskScope(
  input: ExecuteRunRecoveryActionInput
): Promise<boolean> {
  const run = await input.repositories.runs.getById(input.runId);
  const task = await input.repositories.tasks.getById(input.taskId);
  if (!run || !task?.projectId || task.projectId !== run.projectId) {
    return false;
  }
  if (run.taskId === input.taskId) {
    return true;
  }

  const snapshot = await input.repositories.taskSnapshots.getByTaskId(input.taskId);
  if (!snapshot || snapshot.projectId !== task.projectId) {
    return false;
  }

  return snapshotRunIds(snapshot).includes(input.runId);
}

async function hasUniqueRequestedWorkerLink(input: {
  repositories: WorkbenchRepositories;
  runId: string;
  view: RunLifecycleView;
}): Promise<boolean> {
  const workerJobId = input.view.linkedWorkerJobId;
  if (!workerJobId) {
    return false;
  }

  const links = (await input.repositories.runEvents.listAll()).filter(
    (event) =>
      event.type === "worker.job.linked" && event.payload.workerJobId === workerJobId
  );
  if (links.length !== 1) {
    return false;
  }

  const [link] = links;
  if (!link) {
    return false;
  }

  return (
    link.runId === input.runId &&
    link.payload.runId === input.runId &&
    (input.view.linkedObservationId === undefined ||
      link.payload.observationId === input.view.linkedObservationId)
  );
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

async function retryRun(
  input: ExecuteRunRecoveryActionInput & { run: RunRecord }
): Promise<RunRecoveryExecutionResult> {
  if (isUnsupportedRetryContext(input.run)) {
    return { ok: false, error: "retry_input_not_reconstructable" };
  }

  const task = await input.repositories.tasks.getById(input.taskId);
  if (!task?.projectId || task.projectId !== input.run.projectId) {
    return { ok: false, error: "task_not_found" };
  }

  const projectId = task.projectId;

  return withRepositoryRetryLock(input.repositories, async () => {
    const snapshot = await input.repositories.taskSnapshots.getByTaskId(input.taskId);
    if (snapshot && snapshot.projectId !== projectId) {
      return { ok: false, error: "retry_input_not_reconstructable" };
    }

    try {
      if (input.run.role === "planner") {
        const messages = await input.repositories.messages.listForTask(input.taskId);
        const promptMessage = selectUserMessageForRun(messages, input.run);
        if (!promptMessage) {
          return { ok: false, error: "retry_input_not_reconstructable" };
        }
        const prompt = promptMessage.content.trim();
        if (!prompt) {
          return { ok: false, error: "retry_input_not_reconstructable" };
        }
        const latestUserMessage = selectLatestUserMessage(messages);
        if (promptMessage.id !== latestUserMessage?.id) {
          return { ok: false, error: "retry_target_conflict" };
        }
        if (snapshot?.briefId || snapshot?.pageVersionId) {
          const snapshotOutputTimestamp = await resolveSnapshotOutputTimestamp({
            repositories: input.repositories,
            snapshot
          });
          if (!snapshotOutputTimestamp.ok) {
            return { ok: false, error: "retry_target_conflict" };
          }
          if (
            snapshotOutputTimestamp.timestamp &&
            snapshotOutputTimestamp.timestamp > input.run.startedAt
          ) {
            return { ok: false, error: "retry_target_conflict" };
          }
        }

        const retryRunId = await nextRetryRunId(input.repositories, input.runId);
        const brief = await input.service.createBriefFromPrompt({
          projectId,
          prompt,
          taskId: input.taskId,
          runId: retryRunId
        });
        await input.repositories.taskSnapshots.save({
          taskId: input.taskId,
          projectId,
          briefId: brief.id,
          pageVersionId: undefined,
          createdAt: retryTimestamp(input)
        });
        return retryRunCompleted(input.runId, retryRunId);
      }

      if (input.run.role === "builder") {
        const briefIdResult = await builderRetryBriefIdForRun({
          repositories: input.repositories,
          run: input.run,
          snapshot
        });
        if (!briefIdResult.ok) {
          return { ok: false, error: briefIdResult.error };
        }

        const brief = await input.repositories.briefs.getById(briefIdResult.briefId);
        if (!brief || brief.projectId !== projectId) {
          return { ok: false, error: "retry_input_not_reconstructable" };
        }
        const retryRunId = await nextRetryRunId(input.repositories, input.runId);
        const pageVersion = await input.service.generatePageVersion({
          projectId,
          briefId: briefIdResult.briefId,
          taskId: input.taskId,
          runId: retryRunId
        });
        await input.repositories.taskSnapshots.save({
          taskId: input.taskId,
          projectId,
          briefId: briefIdResult.briefId,
          pageVersionId: pageVersion.id,
          createdAt: snapshot?.createdAt ?? retryTimestamp(input)
        });
        return retryRunCompleted(input.runId, retryRunId);
      }

      if (input.run.role === "reviewer") {
        const consumedPageVersionId = await consumedHandoffPageVersionIdForRun(
          input.repositories,
          input.run.id
        );
        const pageVersionIdResult = consumedPageVersionId
          ? { ok: true as const, pageVersionId: consumedPageVersionId }
          : await snapshotPageVersionIdForRun({
              repositories: input.repositories,
              run: input.run,
              snapshot
            });
        if (!pageVersionIdResult.ok) {
          return { ok: false, error: pageVersionIdResult.error };
        }
        const pageVersionId = pageVersionIdResult.pageVersionId;
        if (!pageVersionId) {
          return { ok: false, error: "retry_input_not_reconstructable" };
        }

        const pageVersion = await input.repositories.pageVersions.getById(pageVersionId);
        if (!pageVersion || pageVersion.projectId !== projectId) {
          return { ok: false, error: "retry_input_not_reconstructable" };
        }
        if (pageVersion.reviewStatus !== "pending" || pageVersion.findings.length > 0) {
          return { ok: false, error: "retry_target_conflict" };
        }

        const retryRunId = await nextRetryRunId(input.repositories, input.runId);
        await input.service.reviewPageVersion({
          projectId,
          pageVersionId,
          taskId: input.taskId,
          runId: retryRunId
        });
        return retryRunCompleted(input.runId, retryRunId);
      }

      if (input.run.role === "deployer") {
        const consumedPageVersionId = await consumedHandoffPageVersionIdForRun(
          input.repositories,
          input.run.id
        );
        const pageVersionIdResult = consumedPageVersionId
          ? { ok: true as const, pageVersionId: consumedPageVersionId }
          : await snapshotPageVersionIdForRun({
              repositories: input.repositories,
              run: input.run,
              snapshot
            });
        if (!pageVersionIdResult.ok) {
          return { ok: false, error: pageVersionIdResult.error };
        }
        const pageVersionId = pageVersionIdResult.pageVersionId;
        if (!pageVersionId) {
          return { ok: false, error: "retry_input_not_reconstructable" };
        }
        const pageVersion = await input.repositories.pageVersions.getById(pageVersionId);
        if (consumedPageVersionId && (!pageVersion || pageVersion.projectId !== projectId)) {
          return { ok: false, error: "retry_input_not_reconstructable" };
        }
        if (pageVersion && pageVersion.projectId !== projectId) {
          return { ok: false, error: "retry_input_not_reconstructable" };
        }
        if (await input.repositories.deployments.getByPageVersionId(pageVersionId)) {
          return { ok: false, error: "retry_target_conflict" };
        }

        const retryRunId = await nextRetryRunId(input.repositories, input.runId);
        await input.service.approveAndCreateDeployment({
          projectId,
          pageVersionId,
          reviewerUserId: input.currentUserId,
          taskId: input.taskId,
          runId: retryRunId,
          failIfDeploymentExists: true
        });
        return retryRunCompleted(input.runId, retryRunId);
      }
    } catch {
      return { ok: false, error: "retry_failed" };
    }

    return { ok: false, error: "retry_input_not_reconstructable" };
  });
}

async function nextRetryRunId(
  repositories: WorkbenchRepositories,
  baseRunId: string
): Promise<string> {
  const existingRunIds = new Set((await repositories.runs.listAll()).map((run) => run.id));
  for (let attempt = 1; ; attempt += 1) {
    const candidate = `${baseRunId}_retry_${attempt}`;
    if (!existingRunIds.has(candidate)) {
      return candidate;
    }
  }
}

function retryRunCompleted(
  runId: string,
  newRunId: string
): RunRecoveryExecutionResult {
  return {
    ok: true,
    action: "retry_run",
    runId,
    newRunId,
    state: "completed"
  };
}

function retryTimestamp(input: ExecuteRunRecoveryActionInput): string {
  return (input.now ?? (() => new Date()))().toISOString();
}

function selectUserMessageForRun(
  messages: WorkbenchMessageRecord[],
  run: RunRecord
): WorkbenchMessageRecord | undefined {
  return messages
    .filter(
      (message) =>
        message.role === "user" &&
        message.createdAt <= run.startedAt &&
        message.content.trim().length > 0
    )
    .at(-1);
}

function selectLatestUserMessage(
  messages: WorkbenchMessageRecord[]
): WorkbenchMessageRecord | undefined {
  return messages
    .filter((message) => message.role === "user" && message.content.trim().length > 0)
    .at(-1);
}

async function resolveSnapshotOutputTimestamp(input: {
  repositories: WorkbenchRepositories;
  snapshot: { briefId?: string; pageVersionId?: string };
}): Promise<{ ok: true; timestamp?: string } | { ok: false }> {
  const timestamps: string[] = [];
  if (input.snapshot.briefId) {
    const brief = await input.repositories.briefs.getById(input.snapshot.briefId);
    if (!brief) {
      return { ok: false };
    }
    timestamps.push(brief.createdAt);
  }
  if (input.snapshot.pageVersionId) {
    const pageVersion = await input.repositories.pageVersions.getById(
      input.snapshot.pageVersionId
    );
    if (!pageVersion) {
      return { ok: false };
    }
    timestamps.push(pageVersion.createdAt);
  }
  const timestamp = timestamps.sort().at(-1);
  return timestamp ? { ok: true, timestamp } : { ok: true };
}

async function builderRetryBriefIdForRun(input: {
  repositories: WorkbenchRepositories;
  run: RunRecord;
  snapshot:
    | {
        briefId?: string;
        pageVersionId?: string;
        createdAt: string;
      }
    | undefined;
}): Promise<
  { ok: true; briefId: string } | { ok: false; error: RunRecoveryExecutionErrorCode }
> {
  const consumedBriefId = await consumedHandoffBriefIdForRun(input.repositories, input.run.id);
  if (consumedBriefId) {
    if (!input.snapshot?.briefId) {
      return { ok: false, error: "retry_input_not_reconstructable" };
    }
    if (input.snapshot.briefId !== consumedBriefId || input.snapshot.pageVersionId) {
      return { ok: false, error: "retry_target_conflict" };
    }
    return { ok: true, briefId: consumedBriefId };
  }

  if (!input.snapshot?.briefId) {
    return { ok: false, error: "retry_input_not_reconstructable" };
  }
  if (input.snapshot.pageVersionId) {
    return { ok: false, error: "retry_target_conflict" };
  }
  const snapshotOutputTimestamp = await resolveSnapshotOutputTimestamp({
    repositories: input.repositories,
    snapshot: input.snapshot
  });
  if (!snapshotOutputTimestamp.ok) {
    return { ok: false, error: "retry_input_not_reconstructable" };
  }
  if (
    snapshotOutputTimestamp.timestamp &&
    snapshotOutputTimestamp.timestamp > input.run.startedAt
  ) {
    return { ok: false, error: "retry_target_conflict" };
  }
  return { ok: true, briefId: input.snapshot.briefId };
}

async function snapshotPageVersionIdForRun(input: {
  repositories: WorkbenchRepositories;
  run: RunRecord;
  snapshot:
    | {
        pageVersionId?: string;
      }
    | undefined;
}): Promise<
  { ok: true; pageVersionId?: string } | { ok: false; error: RunRecoveryExecutionErrorCode }
> {
  if (!input.snapshot?.pageVersionId) {
    return { ok: true };
  }
  const pageVersion = await input.repositories.pageVersions.getById(input.snapshot.pageVersionId);
  if (!pageVersion) {
    return { ok: false, error: "retry_input_not_reconstructable" };
  }
  if (pageVersion.createdAt > input.run.startedAt) {
    return { ok: false, error: "retry_target_conflict" };
  }
  return { ok: true, pageVersionId: input.snapshot.pageVersionId };
}

async function consumedHandoffBriefIdForRun(
  repositories: WorkbenchRepositories,
  runId: string
): Promise<string | undefined> {
  const events = await repositories.runEvents.listForRun(runId);
  return events
    .filter((event) => event.type === "handoff.consumed")
    .map(artifactRefsFromHandoffEvent)
    .map((artifactRefs) => artifactRefs.briefId)
    .filter((briefId): briefId is string => briefId !== undefined)
    .at(-1);
}

async function consumedHandoffPageVersionIdForRun(
  repositories: WorkbenchRepositories,
  runId: string
): Promise<string | undefined> {
  const events = await repositories.runEvents.listForRun(runId);
  return events
    .filter((event) => event.type === "handoff.consumed")
    .map(artifactRefsFromHandoffEvent)
    .map((artifactRefs) => artifactRefs.pageVersionId)
    .filter((pageVersionId): pageVersionId is string => pageVersionId !== undefined)
    .at(-1);
}

function artifactRefsFromHandoffEvent(event: RunEventRecord): {
  briefId?: string;
  pageVersionId?: string;
} {
  const artifactRefs =
    typeof event.payload.artifactRefs === "object" && event.payload.artifactRefs !== null
      ? (event.payload.artifactRefs as { briefId?: unknown; pageVersionId?: unknown })
      : undefined;
  if (!artifactRefs) {
    return {};
  }
  return {
    briefId: nonEmptyStringArtifactRef(artifactRefs.briefId),
    pageVersionId: nonEmptyStringArtifactRef(artifactRefs.pageVersionId)
  };
}

function nonEmptyStringArtifactRef(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

async function withRepositoryRetryLock<T>(
  repositories: WorkbenchRepositories,
  operation: () => Promise<T>
): Promise<T> {
  const previous = repositoryRetryLocks.get(repositories) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  const lock = run.then(
    () => undefined,
    () => undefined
  );
  repositoryRetryLocks.set(repositories, lock);
  lock.finally(() => {
    if (repositoryRetryLocks.get(repositories) === lock) {
      repositoryRetryLocks.delete(repositories);
    }
  });
  return run;
}
