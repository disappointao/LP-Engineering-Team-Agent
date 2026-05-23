import type { WorkbenchCopy } from "../lib/i18n";
import type { LiveTaskStatePayload } from "../lib/workbench-store";

const lpRunTimelineRoles = ["planner", "builder", "reviewer", "deployer"] as const;
const activeStates = new Set(["queued", "running", "waiting_for_approval", "cancelling"]);
const attentionStates = new Set(["blocked", "failed"]);
const stoppedStates = new Set(["cancelled"]);
const executableActions = new Set(["resume_worker_finalization", "retry_run"]);
const guidanceActions = new Set(["request_approval", "resolve_blocker", "inspect_manually"]);
const safeUnknownEventTypePattern = /^[A-Za-z0-9_.:-]{1,80}$/;

const markerByEventType = {
  "model.output.repair_started": "repair_started",
  "model.output.repaired": "repaired",
  "model.output.repair_failed": "repair_failed",
  "model.retry.scheduled": "retry_scheduled",
  "model.retry.exhausted": "retry_exhausted",
  "handoff.created": "handoff_ready",
  "handoff.consumed": "handoff_consumed",
  "handoff.blocked": "handoff_blocked"
} as const;

export type RunTimelineRole = (typeof lpRunTimelineRoles)[number];
export type RunTimelineStepState = LiveTaskStatePayload["runs"][number]["state"] | "pending";
export type RunTimelineStepStatus =
  | "pending"
  | "active"
  | "complete"
  | "attention"
  | "stopped";
export type RunTimelineMarkerKind =
  | "repair_started"
  | "repaired"
  | "repair_failed"
  | "retry_scheduled"
  | "retry_exhausted"
  | "retry_attempt"
  | "handoff_ready"
  | "handoff_consumed"
  | "handoff_blocked";

export interface RunTimelineActionView {
  action: string;
  label: string;
}

export interface RunTimelineMarkerView {
  kind: RunTimelineMarkerKind;
  label: string;
}

export interface RunTimelineStepView {
  role: RunTimelineRole;
  label: string;
  runId?: string;
  state: RunTimelineStepState;
  stateLabel: string;
  status: RunTimelineStepStatus;
  isActive: boolean;
  startedAt?: string;
  completedAt?: string;
  diagnosticMessage?: string;
  diagnosticCode?: string;
  lastEventLabel?: string;
  markers: RunTimelineMarkerView[];
  executableActions: RunTimelineActionView[];
  guidanceActions: RunTimelineActionView[];
}

export interface RunTimelineViewModel {
  title: string;
  subtitle: string;
  steps: RunTimelineStepView[];
  activeStep?: RunTimelineStepView;
}

export function buildRunTimelineViewModel({
  payload,
  copy
}: {
  payload: Pick<LiveTaskStatePayload, "runs" | "runEvents" | "recovery">;
  copy: WorkbenchCopy;
}): RunTimelineViewModel {
  const latestRunByRole = new Map<RunTimelineRole, LiveTaskStatePayload["runs"][number]>();
  for (const run of payload.runs) {
    if (isTimelineRole(run.role)) {
      const existing = latestRunByRole.get(run.role);
      if (!existing || compareRunsByTimeline(run, existing) > 0) {
        latestRunByRole.set(run.role, run);
      }
    }
  }

  const recoveryByRunId = new Map(payload.recovery.runs.map((run) => [run.runId, run]));

  const steps = lpRunTimelineRoles.map((role) => {
    const run = latestRunByRole.get(role);
    const recoveryRun = run ? recoveryByRunId.get(run.runId) : undefined;
    const effectiveRun = recoveryRun ?? run;

    if (!effectiveRun) {
      return {
        role,
        label: copy.modelsView.roleLabels[role],
        state: "pending",
        stateLabel: copy.chat.runTimelinePending,
        status: "pending",
        isActive: false,
        markers: [],
        executableActions: [],
        guidanceActions: []
      } satisfies RunTimelineStepView;
    }

    const markers = buildMarkers({
      copy,
      runId: effectiveRun.runId,
      events: payload.runEvents
    });

    return {
      role,
      label: copy.modelsView.roleLabels[role],
      runId: effectiveRun.runId,
      state: effectiveRun.state,
      stateLabel: copy.chat.recoveryStateLabels[effectiveRun.state],
      status: classifyStatus(effectiveRun.state),
      isActive: activeStates.has(effectiveRun.state),
      startedAt: effectiveRun.startedAt,
      completedAt: effectiveRun.completedAt,
      diagnosticMessage: effectiveRun.diagnosticSummary?.message,
      diagnosticCode: effectiveRun.diagnosticSummary?.code,
      lastEventLabel: getLastEventLabel({
        copy,
        runId: effectiveRun.runId,
        events: payload.runEvents
      }),
      markers,
      executableActions: buildActions({
        actions: effectiveRun.recoveryActions,
        labels: copy.chat.recoveryActionLabels,
        allowedActions: executableActions
      }),
      guidanceActions: buildActions({
        actions: effectiveRun.recoveryActions,
        labels: copy.chat.recoveryGuidanceLabels,
        allowedActions: guidanceActions
      })
    } satisfies RunTimelineStepView;
  });

  return {
    title: copy.chat.runTimelineTitle,
    subtitle: copy.chat.runTimelineSubtitle,
    steps,
    activeStep: steps.find((step) => step.isActive)
  };
}

function isTimelineRole(role: string): role is RunTimelineRole {
  return lpRunTimelineRoles.includes(role as RunTimelineRole);
}

function compareRunsByTimeline(
  left: LiveTaskStatePayload["runs"][number],
  right: LiveTaskStatePayload["runs"][number]
): number {
  return (
    left.startedAt.localeCompare(right.startedAt) ||
    (left.completedAt ?? "").localeCompare(right.completedAt ?? "") ||
    left.runId.localeCompare(right.runId)
  );
}

function classifyStatus(state: Exclude<RunTimelineStepState, "pending">): RunTimelineStepStatus {
  if (activeStates.has(state)) {
    return "active";
  }
  if (attentionStates.has(state)) {
    return "attention";
  }
  if (stoppedStates.has(state)) {
    return "stopped";
  }
  return "complete";
}

function buildMarkers({
  copy,
  events,
  runId
}: {
  copy: WorkbenchCopy;
  events: LiveTaskStatePayload["runEvents"];
  runId: string;
}): RunTimelineMarkerView[] {
  const markers: RunTimelineMarkerView[] = [];
  if (/_retry_\d+$/.test(runId)) {
    markers.push({
      kind: "retry_attempt",
      label: copy.chat.runTimelineMarkerLabels.retry_attempt
    });
  }

  for (const event of events
    .filter((candidate) => candidate.runId === runId)
    .sort(compareRunEventsByTimeline)) {
    const kind = markerByEventType[event.type as keyof typeof markerByEventType];
    if (kind) {
      markers.push({ kind, label: copy.chat.runTimelineMarkerLabels[kind] });
    }
  }

  const seen = new Set<RunTimelineMarkerKind>();
  return markers.filter((marker) => {
    if (seen.has(marker.kind)) {
      return false;
    }
    seen.add(marker.kind);
    return true;
  });
}

function getLastEventLabel({
  copy,
  events,
  runId
}: {
  copy: WorkbenchCopy;
  events: LiveTaskStatePayload["runEvents"];
  runId: string;
}): string | undefined {
  const latest = [...events]
    .filter((event) => event.runId === runId)
    .sort(compareRunEventsByTimeline)
    .at(-1);
  if (!latest) {
    return undefined;
  }
  const kind = markerByEventType[latest.type as keyof typeof markerByEventType];
  if (kind) {
    return copy.chat.runTimelineMarkerLabels[kind];
  }
  return safeUnknownEventTypePattern.test(latest.type) ? latest.type : undefined;
}

function buildActions({
  actions,
  allowedActions,
  labels
}: {
  actions: string[];
  allowedActions: ReadonlySet<string>;
  labels: Partial<Record<string, string>>;
}): RunTimelineActionView[] {
  return actions.flatMap((action) => {
    if (!allowedActions.has(action)) {
      return [];
    }
    const label = labels[action];
    return label ? [{ action, label }] : [];
  });
}

function compareRunEventsByTimeline(
  left: LiveTaskStatePayload["runEvents"][number],
  right: LiveTaskStatePayload["runEvents"][number]
): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}
