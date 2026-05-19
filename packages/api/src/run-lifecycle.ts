import type {
  RunEventRecord,
  RunRecord,
  RunRecordState,
  WorkbenchRepositories
} from "@lp-agent/db";
import type { AgentRole } from "@lp-agent/model-gateway";
import type { WorkerRuntime } from "@lp-agent/worker-runtime";

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
    view: buildRunLifecycleView(run, events)
  };
}

export async function listRunLifecycleViewsForTask(
  input: ListRunLifecycleViewsForTaskInput
): Promise<RunLifecycleView[]> {
  const runs = await input.repositories.runs.listForTask(input.taskId);
  const views = await Promise.all(
    runs.map(async (run) => {
      const events = await input.repositories.runEvents.listForRun(run.id);
      return buildRunLifecycleView(run, events);
    })
  );

  return views;
}

function buildRunLifecycleView(
  run: RunRecord,
  events: RunEventRecord[]
): RunLifecycleView {
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

  const mapped = mapRunRecordState(run.state);

  return {
    ...baseRunLifecycleView(run),
    state: mapped.state,
    diagnosticSummary: modelParseDiagnostic ?? mapped.diagnosticSummary,
    recoveryActions: mapped.recoveryActions
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
