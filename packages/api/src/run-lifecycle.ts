import type {
  AgentHandoffRecord,
  RunEventRecord,
  RunRecord,
  RunRecordState,
  ToolObservationRecord,
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

export function isUnsupportedRetryContext(
  run: Pick<RunRecord, "contextSummary">
): boolean {
  return run.contextSummary.injected.some(
    (entry) => entry.startsWith("skillCommand:") || entry.startsWith("mcpTool:")
  );
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

interface LinkedWorkerFields {
  linkedWorkerJobId: string;
  linkedObservationId?: string;
}

type LinkedWorkerJobResult =
  | {
      status: "not_configured";
    }
  | {
      status: "loaded";
      workerJob: WorkerJobRecord | undefined;
    }
  | {
      status: "unavailable";
      code: string;
      message: string;
    };

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
  const observations = await input.repositories.toolObservations.listForRun(run.id);

  return {
    ok: true,
    view: await buildRunLifecycleView({
      repositories: input.repositories,
      workerRuntime: input.workerRuntime,
      run,
      events,
      observations
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
      const observations = await input.repositories.toolObservations.listForRun(run.id);
      return buildRunLifecycleView({
        repositories: input.repositories,
        workerRuntime: input.workerRuntime,
        run,
        events,
        observations
      });
    })
  );

  return views.sort((left, right) => {
    const startedAtOrder = left.startedAt.localeCompare(right.startedAt);
    return startedAtOrder || left.runId.localeCompare(right.runId);
  });
}

async function buildRunLifecycleView(input: {
  repositories: WorkbenchRepositories;
  workerRuntime?: RunLifecycleWorkerRuntime;
  run: RunRecord;
  events: RunEventRecord[];
  observations: ToolObservationRecord[];
}): Promise<RunLifecycleView> {
  const { events, observations, run } = input;
  const terminalConflict = findTerminalRunEventConflict(events);
  const terminalEvent = findLatestTerminalRunEvent(events);
  const diagnosticSummary = deriveDiagnostic({ events, observations });
  const workerLink = findLatestWorkerJobLink(events);
  let linkedFields = workerLink ? toLinkedWorkerFields(workerLink) : undefined;

  if (terminalConflict) {
    return {
      ...baseRunLifecycleView(run),
      ...(linkedFields ?? {}),
      state: "failed",
      terminalEventType: terminalConflict.latestTerminal.type,
      diagnosticSummary: {
        code: "inconsistent_terminal_events",
        message: "Run has conflicting terminal events.",
        source: "lifecycle",
        eventType: terminalConflict.latestTerminal.type
      },
      recoveryActions: ["inspect_manually"]
    };
  }

  if (terminalEvent) {
    const state = terminalEventStateByType[terminalEvent.type as TerminalRunEventType];

    return {
      ...baseRunLifecycleView(run),
      ...(linkedFields ?? {}),
      state,
      terminalEventType: terminalEvent.type,
      diagnosticSummary: state === "failed" ? diagnosticSummary : undefined,
      recoveryActions: applyUnsupportedRetryContext(
        run,
        state === "failed" ? ["retry_run"] : []
      )
    };
  }

  let terminalWorkerJob: WorkerJobRecord | undefined;
  let workerRuntimeOmitted = false;

  if (workerLink) {
    const workerLinkedFields = toLinkedWorkerFields(workerLink);
    linkedFields = workerLinkedFields;
    const workerJobResult = await getLinkedWorkerJob(
      input.workerRuntime,
      workerLink.workerJobId
    );

    if (workerJobResult.status === "unavailable") {
      return unavailableWorkerJobLifecycleView({
        run,
        linkedFields: workerLinkedFields,
        code: workerJobResult.code,
        message: workerJobResult.message
      });
    }

    if (workerJobResult.status === "not_configured") {
      workerRuntimeOmitted = true;
    } else if (!workerJobResult.workerJob) {
      return missingWorkerJobLifecycleView({
        run,
        linkedFields: workerLinkedFields
      });
    } else if (isActiveWorkerJob(workerJobResult.workerJob)) {
      return deriveActiveLinkedWorkerJobView({
        run,
        linkedFields: workerLinkedFields,
        workerJob: workerJobResult.workerJob
      });
    } else {
      terminalWorkerJob = workerJobResult.workerJob;
    }
  }

  const mapped = mapRunRecordState(run.state);

  if (run.state === "needs_approval" || run.state === "needs_input") {
    return {
      ...baseRunLifecycleView(run),
      ...(linkedFields ?? {}),
      state: mapped.state,
      diagnosticSummary: mapped.diagnosticSummary,
      recoveryActions: applyUnsupportedRetryContext(
        run,
        withOmittedWorkerRuntimeAction(mapped.recoveryActions, workerRuntimeOmitted)
      )
    };
  }

  const blockedHandoff = await findBlockedInboundHandoff(input.repositories, run);

  if (blockedHandoff) {
    return {
      ...baseRunLifecycleView(run),
      ...(linkedFields ?? {}),
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

  if (terminalWorkerJob && linkedFields) {
    return deriveTerminalLinkedWorkerJobView({
      run,
      linkedFields,
      workerJob: terminalWorkerJob
    });
  }

  return {
    ...baseRunLifecycleView(run),
    ...(linkedFields ?? {}),
    state: mapped.state,
    diagnosticSummary: diagnosticSummary ?? mapped.diagnosticSummary,
    recoveryActions: applyUnsupportedRetryContext(
      run,
      withOmittedWorkerRuntimeAction(mapped.recoveryActions, workerRuntimeOmitted)
    )
  };
}

function applyUnsupportedRetryContext(
  run: Pick<RunRecord, "contextSummary">,
  actions: RunRecoveryAction[]
): RunRecoveryAction[] {
  if (!isUnsupportedRetryContext(run) || !actions.includes("retry_run")) {
    return actions;
  }
  return dedupeRecoveryActions(
    actions.map((action) => (action === "retry_run" ? "inspect_manually" : action))
  );
}

function dedupeRecoveryActions(actions: RunRecoveryAction[]): RunRecoveryAction[] {
  const seen = new Set<RunRecoveryAction>();
  return actions.filter((action) => {
    if (seen.has(action)) {
      return false;
    }
    seen.add(action);
    return true;
  });
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

function toLinkedWorkerFields(input: {
  workerJobId: string;
  observationId?: string;
}): LinkedWorkerFields {
  return {
    linkedWorkerJobId: input.workerJobId,
    ...(input.observationId ? { linkedObservationId: input.observationId } : {})
  };
}

function isActiveWorkerJob(workerJob: WorkerJobRecord): boolean {
  return workerJob.state === "queued" || workerJob.state === "running";
}

function withOmittedWorkerRuntimeAction(
  actions: RunRecoveryAction[],
  workerRuntimeOmitted: boolean
): RunRecoveryAction[] {
  if (!workerRuntimeOmitted || actions.includes("inspect_manually")) {
    return actions;
  }
  return [...actions, "inspect_manually"];
}

function deriveActiveLinkedWorkerJobView(input: {
  run: RunRecord;
  linkedFields: LinkedWorkerFields;
  workerJob: WorkerJobRecord;
}): RunLifecycleView {
  const base = {
    ...baseRunLifecycleView(input.run),
    ...input.linkedFields
  };

  if (input.workerJob.state === "queued") {
    return {
      ...base,
      state: "queued",
      recoveryActions: []
    };
  }

  return {
    ...base,
    state: input.workerJob.cancelRequestedAt ? "cancelling" : "running",
    recoveryActions: []
  };
}

function missingWorkerJobLifecycleView(input: {
  run: RunRecord;
  linkedFields: LinkedWorkerFields;
}): RunLifecycleView {
  return {
    ...baseRunLifecycleView(input.run),
    ...input.linkedFields,
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

function deriveTerminalLinkedWorkerJobView(input: {
  run: RunRecord;
  linkedFields: LinkedWorkerFields;
  workerJob: WorkerJobRecord;
}): RunLifecycleView {
  const base = {
    ...baseRunLifecycleView(input.run),
    ...input.linkedFields
  };

  if (input.workerJob.state === "completed") {
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

  if (input.workerJob.state === "cancelled") {
    return {
      ...base,
      state: "cancelled",
      diagnosticSummary: workerJobDiagnostic(
        input.workerJob,
        sanitizeOptionalDiagnosticCode(input.workerJob.errorName) ?? "worker_job_cancelled"
      ),
      recoveryActions: ["resume_worker_finalization"]
    };
  }

  return {
    ...base,
    state: "failed",
    diagnosticSummary: workerJobDiagnostic(
      input.workerJob,
      sanitizeOptionalDiagnosticCode(input.workerJob.errorName) ??
        sanitizeOptionalDiagnosticCode(input.workerJob.resultSummary?.errorName) ??
        "worker_job_failed"
    ),
    recoveryActions: ["resume_worker_finalization"]
  };
}

async function getLinkedWorkerJob(
  workerRuntime: RunLifecycleWorkerRuntime | undefined,
  workerJobId: string
): Promise<LinkedWorkerJobResult> {
  if (!workerRuntime) {
    return { status: "not_configured" };
  }

  try {
    return {
      status: "loaded",
      workerJob: await workerRuntime.getJob(workerJobId)
    };
  } catch {
    return {
      status: "unavailable",
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

function findTerminalRunEventConflict(
  events: RunEventRecord[]
): { latestTerminal: RunEventRecord } | undefined {
  const terminalEvents = events.filter((event) => isTerminalRunEventType(event.type));
  const terminalEventTypes = new Set(terminalEvents.map((event) => event.type));
  const latestTerminal = terminalEvents.at(-1);

  if (!latestTerminal || terminalEventTypes.size <= 1) {
    return undefined;
  }

  return { latestTerminal };
}

function isTerminalRunEventType(type: string): type is TerminalRunEventType {
  return type in terminalEventStateByType;
}

function deriveRunFailedDiagnostic(event: RunEventRecord): RunDiagnosticSummary {
  const errorName = sanitizeOptionalDiagnosticCode(event.payload.errorName);

  return {
    code: "run_failed",
    message: "Run failed.",
    source: "run_event",
    eventType: event.type,
    ...(errorName ? { errorName } : {})
  };
}

function deriveToolEventDiagnostic(event: RunEventRecord): RunDiagnosticSummary {
  const failed = event.type === "tool.failed";
  const errorName = sanitizeOptionalDiagnosticCode(event.payload.errorName);

  return {
    code: failed ? "tool_failed" : "tool_cancelled",
    message: failed ? "Tool execution failed." : "Tool execution cancelled.",
    source: "tool_observation",
    eventType: event.type,
    ...(errorName ? { errorName } : {})
  };
}

function deriveToolObservationDiagnostic(
  observation: ToolObservationRecord
): RunDiagnosticSummary {
  const failed = observation.state === "failed";
  const errorName = sanitizeOptionalDiagnosticCode(observation.errorName);

  return {
    code: errorName ?? (failed ? "tool_failed" : "tool_cancelled"),
    message: failed ? "Tool execution failed." : "Tool execution cancelled.",
    source: "tool_observation",
    ...(errorName ? { errorName } : {})
  };
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
    code: sanitizeDiagnosticCode(
      firstSafeDiagnosticCode(
        parseFailedEvent.payload.policyCode,
        parseFailedEvent.payload.reason,
        "model_output_parse_failed"
      )
    ),
    message: "Model output could not be parsed safely.",
    source: "model_parse",
    eventType: parseFailedEvent.type
  };
}

function deriveDiagnostic(input: {
  events: RunEventRecord[];
  observations: ToolObservationRecord[];
}): RunDiagnosticSummary | undefined {
  const modelParseDiagnostic = deriveModelParseDiagnostic(input.events);
  if (modelParseDiagnostic) {
    return modelParseDiagnostic;
  }

  const failedRun = input.events
    .filter((event) => event.type === "run.failed")
    .at(-1);
  if (failedRun) {
    return deriveRunFailedDiagnostic(failedRun);
  }

  const terminalToolEvent = input.events
    .filter((event) => event.type === "tool.failed" || event.type === "tool.cancelled")
    .at(-1);
  if (terminalToolEvent) {
    return deriveToolEventDiagnostic(terminalToolEvent);
  }

  const terminalObservation = input.observations
    .filter((observation) => observation.state === "failed" || observation.state === "cancelled")
    .at(-1);
  if (terminalObservation) {
    return deriveToolObservationDiagnostic(terminalObservation);
  }

  return undefined;
}

function sanitizeDiagnosticCode(value: unknown): string {
  if (typeof value !== "string" || !safeDiagnosticCodePattern.test(value)) {
    return "unknown";
  }

  return value;
}

function firstSafeDiagnosticCode(...values: unknown[]): string {
  for (const value of values) {
    const code = sanitizeOptionalDiagnosticCode(value);
    if (code) {
      return code;
    }
  }
  return "unknown";
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
