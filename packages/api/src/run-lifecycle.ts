import type {
  AgentHandoffRecord,
  RunEventRecord,
  RunRecord,
  RunRecordState,
  WorkbenchRepositories
} from "@lp-agent/db";
import type { AgentRole } from "@lp-agent/model-gateway";
import type { WorkerJobRecord, WorkerRuntime } from "@lp-agent/worker-runtime";
import { sanitizeHandoffText } from "./agent-handoffs";

export type RunLifecycleState =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "blocked"
  | "cancelling"
  | "cancelled"
  | "failed"
  | "completed";

export type RunRecoveryAction =
  | "retry_run"
  | "resume_worker_finalization"
  | "request_approval"
  | "resolve_blocker"
  | "inspect_manually";

export interface RunDiagnosticSummary {
  code: string;
  message: string;
  source:
    | "run_event"
    | "model_parse"
    | "tool_observation"
    | "worker_job"
    | "handoff"
    | "lifecycle";
  eventType?: string;
  errorName?: string;
}

export interface RunLifecycleView {
  runId: string;
  projectId: string;
  taskId?: string;
  role: AgentRole;
  state: RunLifecycleState;
  runRecordState: RunRecordState;
  startedAt: string;
  completedAt?: string;
  terminalEventType?: string;
  linkedWorkerJobId?: string;
  linkedObservationId?: string;
  blockedReason?: string;
  diagnosticSummary?: RunDiagnosticSummary;
  recoveryActions: RunRecoveryAction[];
}

export type DeriveRunLifecycleViewResult =
  | {
      ok: true;
      view: RunLifecycleView;
    }
  | {
      ok: false;
      error: "run_not_found";
    };

export type RunLifecycleWorkerRuntime = Pick<WorkerRuntime, "getJob">;

export interface DeriveRunLifecycleViewInput {
  repositories: WorkbenchRepositories;
  runId: string;
  workerRuntime?: RunLifecycleWorkerRuntime;
}

export interface ListRunLifecycleViewsForTaskInput {
  repositories: WorkbenchRepositories;
  taskId: string;
  workerRuntime?: RunLifecycleWorkerRuntime;
}

const terminalEventStateByType = {
  "run.completed": "completed",
  "run.failed": "failed",
  "run.cancelled": "cancelled"
} as const satisfies Record<string, RunLifecycleState>;

type TerminalRunEventType = keyof typeof terminalEventStateByType;

const safeDiagnosticCodePattern = /^[A-Za-z0-9_.:-]{1,80}$/;

export async function deriveRunLifecycleView(
  input: DeriveRunLifecycleViewInput
): Promise<DeriveRunLifecycleViewResult> {
  const run = await input.repositories.runs.getById(input.runId);

  if (!run) {
    return {
      ok: false,
      error: "run_not_found"
    };
  }

  const events = await input.repositories.runEvents.listForRun(run.id);

  return {
    ok: true,
    view: await buildRunLifecycleView({
      repositories: input.repositories,
      workerRuntime: input.workerRuntime,
      run,
      events
    })
  };
}

export async function listRunLifecycleViewsForTask(
  input: ListRunLifecycleViewsForTaskInput
): Promise<RunLifecycleView[]> {
  const runs = await input.repositories.runs.listForTask(input.taskId);
  const views = await Promise.all(
    runs.map(async (run) => {
      const events = await input.repositories.runEvents.listForRun(run.id);
      return buildRunLifecycleView({
        repositories: input.repositories,
        workerRuntime: input.workerRuntime,
        run,
        events
      });
    })
  );

  return views;
}

async function buildRunLifecycleView(input: {
  repositories: WorkbenchRepositories;
  workerRuntime?: RunLifecycleWorkerRuntime;
  run: RunRecord;
  events: RunEventRecord[];
}): Promise<RunLifecycleView> {
  const { events, run } = input;
  const terminalEvent = findLatestTerminalRunEvent(events);
  const modelParseDiagnostic = deriveModelParseDiagnostic(events);

  if (terminalEvent) {
    const state = terminalEventStateByType[terminalEvent.type as TerminalRunEventType];

    return {
      ...baseRunLifecycleView(run),
      state,
      terminalEventType: terminalEvent.type,
      diagnosticSummary: modelParseDiagnostic,
      recoveryActions: state === "failed" ? ["retry_run"] : []
    };
  }

  const blockedHandoff = await findBlockedInboundHandoff(input.repositories, run);

  if (blockedHandoff) {
    return {
      ...baseRunLifecycleView(run),
      state: "blocked",
      blockedReason: summarizeBlockedReason(blockedHandoff.blockingReason),
      diagnosticSummary: {
        code: "handoff_blocked",
        message: "Run is blocked by an inbound handoff.",
        source: "handoff"
      },
      recoveryActions: ["resolve_blocker"]
    };
  }

  const workerLink = findLatestWorkerJobLink(events);

  if (workerLink) {
    return deriveLinkedWorkerJobView({
      workerRuntime: input.workerRuntime,
      run,
      workerJobId: workerLink.workerJobId,
      observationId: workerLink.observationId
    });
  }

  const mapped = mapRunRecordState(run.state);

  return {
    ...baseRunLifecycleView(run),
    state: mapped.state,
    diagnosticSummary: modelParseDiagnostic ?? mapped.diagnosticSummary,
    recoveryActions: mapped.recoveryActions
  };
}

async function findBlockedInboundHandoff(
  repositories: WorkbenchRepositories,
  run: RunRecord
): Promise<AgentHandoffRecord | undefined> {
  const inbound = await repositories.agentHandoffs.listInbound({
    projectId: run.projectId,
    ...(run.taskId ? { taskId: run.taskId } : {}),
    toRole: run.role
  });

  return inbound
    .filter(
      (handoff) =>
        handoff.state === "blocked" && matchesRunTaskScope(handoff, run.taskId)
    )
    .at(-1);
}

function matchesRunTaskScope(
  handoff: AgentHandoffRecord,
  runTaskId: string | undefined
): boolean {
  return runTaskId === undefined
    ? handoff.taskId === undefined
    : handoff.taskId === runTaskId;
}

function summarizeBlockedReason(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const reason = sanitizeHandoffText(value).replace(/\s+/gu, " ").trim().slice(0, 240);
  return reason || undefined;
}

function findLatestWorkerJobLink(events: RunEventRecord[]): {
  workerJobId: string;
  observationId?: string;
} | undefined {
  return events
    .map((event) => {
      if (event.type !== "worker.job.linked") {
        return undefined;
      }

      const workerJobId = nonEmptyString(event.payload.workerJobId);
      if (!workerJobId) {
        return undefined;
      }

      const observationId = nonEmptyString(event.payload.observationId);
      return {
        workerJobId,
        ...(observationId ? { observationId } : {})
      };
    })
    .filter((link): link is { workerJobId: string; observationId?: string } => Boolean(link))
    .at(-1);
}

async function deriveLinkedWorkerJobView(input: {
  workerRuntime?: RunLifecycleWorkerRuntime;
  run: RunRecord;
  workerJobId: string;
  observationId?: string;
}): Promise<RunLifecycleView> {
  const linkedFields = {
    linkedWorkerJobId: input.workerJobId,
    ...(input.observationId ? { linkedObservationId: input.observationId } : {})
  };
  const workerJobResult = await getLinkedWorkerJob(
    input.workerRuntime,
    input.workerJobId
  );

  if (!workerJobResult.ok) {
    return unavailableWorkerJobLifecycleView({
      run: input.run,
      linkedFields,
      code: workerJobResult.code,
      message: workerJobResult.message
    });
  }

  const workerJob = workerJobResult.workerJob;
  if (!workerJob) {
    return {
      ...baseRunLifecycleView(input.run),
      ...linkedFields,
      state: "failed",
      diagnosticSummary: {
        code: "worker_job_missing",
        message: "Linked worker job could not be found.",
        source: "lifecycle",
        eventType: "worker.job.linked"
      },
      recoveryActions: ["inspect_manually"]
    };
  }

  const base = {
    ...baseRunLifecycleView(input.run),
    ...linkedFields
  };

  if (workerJob.state === "queued") {
    return {
      ...base,
      state: "queued",
      recoveryActions: []
    };
  }

  if (workerJob.state === "running") {
    return {
      ...base,
      state: workerJob.cancelRequestedAt ? "cancelling" : "running",
      recoveryActions: []
    };
  }

  if (workerJob.state === "completed") {
    return {
      ...base,
      state: "completed",
      diagnosticSummary: {
        code: "worker_finalization_incomplete",
        message: "Worker job completed but run finalization is incomplete.",
        source: "lifecycle",
        eventType: "worker.job.linked"
      },
      recoveryActions: ["resume_worker_finalization"]
    };
  }

  if (workerJob.state === "cancelled") {
    return {
      ...base,
      state: "cancelled",
      diagnosticSummary: workerJobDiagnostic(
        workerJob,
        sanitizeOptionalDiagnosticCode(workerJob.errorName) ?? "worker_job_cancelled"
      ),
      recoveryActions: ["resume_worker_finalization"]
    };
  }

  return {
    ...base,
    state: "failed",
    diagnosticSummary: workerJobDiagnostic(
      workerJob,
      sanitizeOptionalDiagnosticCode(workerJob.errorName) ??
        sanitizeOptionalDiagnosticCode(workerJob.resultSummary?.errorName) ??
        "worker_job_failed"
    ),
    recoveryActions: ["resume_worker_finalization"]
  };
}

async function getLinkedWorkerJob(
  workerRuntime: RunLifecycleWorkerRuntime | undefined,
  workerJobId: string
): Promise<
  | { ok: true; workerJob: WorkerJobRecord | undefined }
  | { ok: false; code: string; message: string }
> {
  if (!workerRuntime) {
    return { ok: true, workerJob: undefined };
  }

  try {
    return {
      ok: true,
      workerJob: await workerRuntime.getJob(workerJobId)
    };
  } catch {
    return {
      ok: false,
      code: "worker_job_unavailable",
      message: "Linked worker job state is unavailable."
    };
  }
}

function unavailableWorkerJobLifecycleView(input: {
  run: RunRecord;
  linkedFields: {
    linkedWorkerJobId: string;
    linkedObservationId?: string;
  };
  code: string;
  message: string;
}): RunLifecycleView {
  return {
    ...baseRunLifecycleView(input.run),
    ...input.linkedFields,
    state: "failed",
    diagnosticSummary: {
      code: input.code,
      message: input.message,
      source: "lifecycle",
      eventType: "worker.job.linked"
    },
    recoveryActions: ["inspect_manually"]
  };
}

function workerJobDiagnostic(
  workerJob: WorkerJobRecord,
  code: string
): RunDiagnosticSummary {
  return {
    code,
    message: `Worker job ${workerJob.state}.`,
    source: "worker_job",
    ...(workerJob.errorName ? { errorName: sanitizeDiagnosticCode(workerJob.errorName) } : {})
  };
}

function baseRunLifecycleView(run: RunRecord): Omit<
  RunLifecycleView,
  "state" | "recoveryActions"
> {
  return {
    runId: run.id,
    projectId: run.projectId,
    taskId: run.taskId,
    role: run.role,
    runRecordState: run.state,
    startedAt: run.startedAt,
    completedAt: run.completedAt
  };
}

function findLatestTerminalRunEvent(
  events: RunEventRecord[]
): RunEventRecord | undefined {
  return events
    .filter((event) => isTerminalRunEventType(event.type))
    .at(-1);
}

function isTerminalRunEventType(type: string): type is TerminalRunEventType {
  return type in terminalEventStateByType;
}

function mapRunRecordState(state: RunRecordState): {
  state: RunLifecycleState;
  diagnosticSummary?: RunDiagnosticSummary;
  recoveryActions: RunRecoveryAction[];
} {
  if (state === "needs_approval") {
    return {
      state: "waiting_for_approval",
      recoveryActions: ["request_approval"]
    };
  }

  if (state === "needs_input") {
    return {
      state: "blocked",
      diagnosticSummary: {
        code: "input_required",
        message: "Run is waiting for input.",
        source: "lifecycle"
      },
      recoveryActions: ["resolve_blocker"]
    };
  }

  if (state === "failed") {
    return {
      state: "failed",
      recoveryActions: ["retry_run"]
    };
  }

  return {
    state,
    recoveryActions: []
  };
}

function deriveModelParseDiagnostic(
  events: RunEventRecord[]
): RunDiagnosticSummary | undefined {
  const parseFailedEvent = events
    .filter((event) => event.type === "model.output.parse_failed")
    .at(-1);

  if (!parseFailedEvent) {
    return undefined;
  }

  return {
    code: sanitizeDiagnosticCode(parseFailedEvent.payload.reason),
    message: "Model output could not be parsed safely.",
    source: "model_parse",
    eventType: parseFailedEvent.type
  };
}

function sanitizeDiagnosticCode(value: unknown): string {
  if (typeof value !== "string" || !safeDiagnosticCodePattern.test(value)) {
    return "unknown";
  }

  return value;
}

function sanitizeOptionalDiagnosticCode(value: unknown): string | undefined {
  if (typeof value !== "string" || !safeDiagnosticCodePattern.test(value)) {
    return undefined;
  }

  return value;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
