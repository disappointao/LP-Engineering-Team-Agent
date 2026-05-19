import {
  createDemoWorkbenchService,
  type BriefRecord,
  type PageVersionRecord,
  type ProjectRecord
} from "@lp-agent/api";
import {
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter,
  type ExecutionAdapter,
  type WorkerJobPayloadRepository,
  type WorkerJobRecord,
  type WorkerJobRepository,
  type WorkerLogRepository,
  type WorkerLogType
} from "@lp-agent/worker-runtime";

type DemoWorkbenchService = ReturnType<typeof createDemoWorkbenchService>;
const systemClock = () => new Date();
const workerLogClockMsBySource = new WeakMap<() => Date, number>();

export interface DemoWorkerJobResult {
  project: ProjectRecord;
  brief: BriefRecord;
  pageVersion: PageVersionRecord;
  deployment: Awaited<ReturnType<DemoWorkbenchService["approveAndCreateDeployment"]>>;
}

export async function runDemoWorkerJob(): Promise<DemoWorkerJobResult> {
  const service = createDemoWorkbenchService();

  const project = await service.createProject({
    name: "Demo LP Project"
  });
  const brief = await service.createBriefFromPrompt({
    projectId: project.id,
    prompt: "Create a lightweight spring ecommerce landing page."
  });
  const pageVersion = await service.generatePageVersion({
    projectId: project.id,
    briefId: brief.id
  });
  const reviewed = await service.reviewPageVersion({
    projectId: project.id,
    pageVersionId: pageVersion.id
  });
  const deployment = await service.approveAndCreateDeployment({
    projectId: project.id,
    pageVersionId: reviewed.id,
    reviewerUserId: "demo_worker"
  });

  return { project, brief, pageVersion: reviewed, deployment };
}

export interface RunWorkerOnceInput {
  workerId: string;
  jobRepository: WorkerJobRepository;
  payloadRepository: WorkerJobPayloadRepository;
  workerLogRepository?: WorkerLogRepository;
  adapter?: ExecutionAdapter;
  now?: () => Date;
  claimTokenFactory?: () => string;
  heartbeatTimeoutMs?: number;
}

export interface RunWorkerDaemonInput extends RunWorkerOnceInput {
  finalizeWorkerJob?: (workerJob: WorkerJobRecord) => Promise<void>;
  maxIterations: number;
  pollIntervalMs: number;
  heartbeatTimeoutMs: number;
  staleClaimTimeoutMs: number;
  maxStaleRecoveryCount: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RunWorkerDaemonResult {
  iterations: number;
  processedJobs: number;
  idleIterations: number;
  stoppedReason: "max_iterations";
}

export async function runWorkerOnce(
  input: RunWorkerOnceInput
): Promise<WorkerJobRecord | undefined> {
  validateRunWorkerOnceInput(input);
  const runtime = createWorkerRuntime(input);
  const claim = await runtime.claimOldestQueued({
    workerId: input.workerId
  });

  if (!claim) {
    return undefined;
  }

  await appendWorkerLog({
    repository: input.workerLogRepository,
    type: "worker.job.claimed",
    message: "Worker job claimed.",
    workerId: input.workerId,
    workerJob: claim.record,
    now: input.now
  });
  await runtime.heartbeatClaimedJob({
    jobId: claim.record.id,
    claimToken: claim.claimToken,
    workerId: input.workerId,
    heartbeatTimeoutMs: input.heartbeatTimeoutMs ?? 30000
  });
  await appendWorkerLog({
    repository: input.workerLogRepository,
    type: "worker.job.heartbeat",
    message: "Worker job heartbeat recorded.",
    workerId: input.workerId,
    workerJob: claim.record,
    now: input.now
  });
  const completed = await runtime.runClaimedJob(claim);
  await appendWorkerLog({
    repository: input.workerLogRepository,
    type: toTerminalWorkerLogType(completed),
    message: "Worker job reached a terminal state.",
    workerId: input.workerId,
    workerJob: completed,
    now: input.now
  });
  return completed;
}

export async function runWorkerDaemon(
  input: RunWorkerDaemonInput
): Promise<RunWorkerDaemonResult> {
  validateRunWorkerDaemonInput(input);
  const sleep =
    input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const runtime = createWorkerRuntime(input);
  let processedJobs = 0;
  let idleIterations = 0;

  for (let iteration = 0; iteration < input.maxIterations; iteration += 1) {
    const recovered = await runtime.recoverStaleJobs({
      staleBefore: (input.now ?? (() => new Date()))().toISOString(),
      staleClaimTimeoutMs: input.staleClaimTimeoutMs,
      maxStaleRecoveryCount: input.maxStaleRecoveryCount
    });
    for (const result of recovered) {
      await appendWorkerLog({
        repository: input.workerLogRepository,
        type: toStaleWorkerLogType(result.type),
        message: "Worker stale job recovered.",
        workerId: input.workerId,
        workerJob: result.record,
        payload: { staleRecoveryCount: result.record.staleRecoveryCount },
        now: input.now
      });
    }

    const workerJob = await runWorkerOnce(input);
    if (!workerJob) {
      idleIterations += 1;
      await appendWorkerLog({
        repository: input.workerLogRepository,
        type: "worker.daemon.idle",
        message: "Worker daemon found no queued jobs.",
        workerId: input.workerId,
        now: input.now
      });
      if (iteration < input.maxIterations - 1) {
        await sleep(input.pollIntervalMs);
      }
      continue;
    }

    processedJobs += 1;
    if (input.finalizeWorkerJob) {
      try {
        await input.finalizeWorkerJob(workerJob);
      } catch (error) {
        await appendWorkerLog({
          repository: input.workerLogRepository,
          type: "worker.job.finalization_failed",
          message: "Worker job finalization failed.",
          workerId: input.workerId,
          workerJob,
          payload: {
            errorName: error instanceof Error ? error.name : "worker_job_finalization_failed"
          },
          now: input.now
        });
      }
    }
  }

  return {
    iterations: input.maxIterations,
    processedJobs,
    idleIterations,
    stoppedReason: "max_iterations"
  };
}

function validateRunWorkerOnceInput(input: RunWorkerOnceInput): void {
  if (input.heartbeatTimeoutMs !== undefined) {
    assertPositiveInteger(input.heartbeatTimeoutMs, "worker_heartbeat_timeout_invalid");
  }
}

function validateRunWorkerDaemonInput(input: RunWorkerDaemonInput): void {
  assertPositiveInteger(input.maxIterations, "worker_daemon_max_iterations_invalid");
  assertPositiveInteger(input.pollIntervalMs, "worker_poll_interval_invalid");
  assertPositiveInteger(input.heartbeatTimeoutMs, "worker_heartbeat_timeout_invalid");
  assertPositiveInteger(input.staleClaimTimeoutMs, "worker_stale_claim_timeout_invalid");
  assertNonNegativeInteger(
    input.maxStaleRecoveryCount,
    "worker_max_stale_recovery_count_invalid"
  );
}

function assertPositiveInteger(value: number, errorCode: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(errorCode);
  }
}

function assertNonNegativeInteger(value: number, errorCode: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(errorCode);
  }
}

function createWorkerRuntime(input: RunWorkerOnceInput): InMemoryWorkerRuntime {
  return new InMemoryWorkerRuntime({
    repository: input.jobRepository,
    payloadRepository: input.payloadRepository,
    adapter: input.adapter ?? new SimulatedExecutionAdapter(),
    now: input.now,
    claimTokenFactory: input.claimTokenFactory
  });
}

async function appendWorkerLog(input: {
  repository?: WorkerLogRepository;
  type: WorkerLogType;
  message: string;
  workerId: string;
  workerJob?: WorkerJobRecord;
  payload?: Record<string, unknown>;
  now?: () => Date;
}): Promise<void> {
  if (!input.repository) {
    return;
  }
  const createdAt = nextWorkerLogTimestamp(input.now);
  await input.repository.append({
    id: `${input.workerJob?.id ?? input.workerId}_${input.type}_${createdAt}`,
    type: input.type,
    message: input.message,
    workerId: input.workerId,
    workerJobId: input.workerJob?.id,
    projectId: input.workerJob?.projectId,
    payload: {
      workerId: input.workerId,
      workerJobId: input.workerJob?.id,
      projectId: input.workerJob?.projectId,
      state: input.workerJob?.state,
      errorName: input.workerJob?.errorName,
      outputSummary: input.workerJob?.resultSummary?.stdout,
      createdAt,
      ...(input.payload ?? {})
    },
    createdAt
  });
}

function nextWorkerLogTimestamp(now: (() => Date) | undefined): string {
  const clock = now ?? systemClock;
  const currentMs = clock().getTime();
  const previousMs = workerLogClockMsBySource.get(clock);
  const createdAtMs =
    previousMs === undefined || currentMs > previousMs ? currentMs : previousMs + 1;
  workerLogClockMsBySource.set(clock, createdAtMs);
  return new Date(createdAtMs).toISOString();
}

function toTerminalWorkerLogType(record: WorkerJobRecord): WorkerLogType {
  if (record.state === "cancelled") {
    return "worker.job.cancelled";
  }
  if (record.state === "completed") {
    return "worker.job.completed";
  }
  return "worker.job.failed";
}

function toStaleWorkerLogType(type: "requeued" | "cancelled" | "failed"): WorkerLogType {
  if (type === "requeued") {
    return "worker.job.stale_recovered";
  }
  if (type === "cancelled") {
    return "worker.job.stale_cancelled";
  }
  return "worker.job.stale_failed";
}
