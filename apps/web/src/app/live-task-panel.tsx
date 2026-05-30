"use client";

import {
  default as React,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type MutableRefObject
} from "react";
import { useRouter } from "next/navigation";
import type { WorkbenchCopy } from "../lib/i18n";
import type { LiveTaskStatePayload } from "../lib/workbench-store";
import {
  createInitialLiveTaskState,
  getNextPollMs,
  reduceLiveTaskState,
  shouldPollLiveTask,
  shouldRefreshForLiveArtifact,
  type LiveTaskPanelAction,
  type LiveTaskPanelState
} from "./live-task-state";
import {
  buildTaskNarrativeViewModel,
  buildTaskProgressViewModel,
  type TaskNarrativeStepViewModel
} from "./task-progress-view-model";

export interface LiveTaskPanelProps {
  taskId?: string;
  initialProjectId?: string;
  initialPayload?: LiveTaskStatePayload;
  initialPreviewVersionKey?: string;
  copy: LiveTaskCopy;
}

export type LiveTaskCopy = Pick<
  WorkbenchCopy["chat"],
  | "liveTaskArtifactReady"
  | "liveTaskCompleted"
  | "liveTaskIdle"
  | "liveTaskRefreshError"
  | "liveTaskRunning"
  | "liveTaskTitle"
  | "recoveryStateLabels"
> & {
  roleLabels: WorkbenchCopy["modelsView"]["roleLabels"];
};

export interface LiveTaskStatusSummaryProps {
  payload?: LiveTaskStatePayload;
  copy: LiveTaskCopy;
}

type LiveTaskStateRouteResponse =
  | { ok: true; value: LiveTaskStatePayload }
  | { ok: false; error: string };

export type LiveTaskStateRouteResult =
  | { ok: true; payload: LiveTaskStatePayload }
  | { ok: false; error: string; retryable: boolean };

const retryPollMs = 3000;
const permanentRouteErrors = new Set(["task_not_found", "project_not_found"]);
const permanentRouteStatuses = new Set([403, 404]);

function isLiveTaskStateRouteResponse(
  value: unknown
): value is LiveTaskStateRouteResponse {
  if (!value || typeof value !== "object" || !("ok" in value)) {
    return false;
  }

  const response = value as { ok?: unknown; error?: unknown; value?: unknown };
  if (response.ok === true) {
    return response.value !== undefined;
  }
  return response.ok === false && typeof response.error === "string";
}

async function readLiveTaskStateRouteResponse(
  response: Response
): Promise<LiveTaskStateRouteResponse | undefined> {
  try {
    const json = await response.json();
    return isLiveTaskStateRouteResponse(json) ? json : undefined;
  } catch {
    return undefined;
  }
}

function isPermanentLiveTaskRouteFailure({
  error,
  status
}: {
  error?: string;
  status?: number;
}): boolean {
  return (
    (error !== undefined && permanentRouteErrors.has(error)) ||
    (status !== undefined && permanentRouteStatuses.has(status))
  );
}

export async function fetchLiveTaskStateRoute({
  taskId,
  projectId,
  fetcher = fetch
}: {
  taskId: string;
  projectId?: string;
  fetcher?: typeof fetch;
}): Promise<LiveTaskStateRouteResult> {
  try {
    const searchParams = new URLSearchParams();
    const trimmedProjectId = projectId?.trim();
    if (trimmedProjectId) {
      searchParams.set("projectId", trimmedProjectId);
    }
    const query = searchParams.toString();
    const route = `/api/tasks/${encodeURIComponent(taskId)}/state${
      query ? `?${query}` : ""
    }`;
    const response = await fetcher(
      route,
      { cache: "no-store" }
    );
    const result = await readLiveTaskStateRouteResponse(response);

    if (response.ok && result?.ok) {
      return {
        ok: true,
        payload: result.value
      };
    }

    const error = result?.ok === false ? result.error : `http_${response.status}`;
    return {
      ok: false,
      error,
      retryable: !isPermanentLiveTaskRouteFailure({
        error,
        status: response.status
      })
    };
  } catch {
    return {
      ok: false,
      error: "network_error",
      retryable: true
    };
  }
}

export function getLiveTaskFailureRetryMs({
  retryable,
  state
}: {
  retryable: boolean;
  state: LiveTaskPanelState;
}): number {
  if (!retryable || !shouldPollLiveTask(state)) {
    return 0;
  }
  return retryPollMs;
}

export function getLiveTaskPreviewRefreshDecision({
  previousPreviewVersionKey,
  nextPreviewVersionKey,
  resetPreviewVersionKey
}: {
  previousPreviewVersionKey?: string;
  nextPreviewVersionKey?: string;
  resetPreviewVersionKey?: string;
}): {
  shouldRefresh: boolean;
  nextPreviewVersionKey?: string;
} {
  const hasResetPreviewVersionKey = resetPreviewVersionKey !== undefined;
  const baselinePreviewVersionKey =
    hasResetPreviewVersionKey ? resetPreviewVersionKey : previousPreviewVersionKey;
  const firstDefinedPreviewVersionKey =
    !hasResetPreviewVersionKey &&
    previousPreviewVersionKey === undefined &&
    nextPreviewVersionKey !== undefined;

  return {
    shouldRefresh:
      firstDefinedPreviewVersionKey ||
      shouldRefreshForLiveArtifact({
        previousPreviewVersionKey: baselinePreviewVersionKey,
        nextPreviewVersionKey
      }),
    nextPreviewVersionKey:
      nextPreviewVersionKey ?? baselinePreviewVersionKey
  };
}

function reduceAndDispatch(
  stateRef: MutableRefObject<LiveTaskPanelState>,
  dispatch: Dispatch<LiveTaskPanelAction>,
  action: LiveTaskPanelAction
): LiveTaskPanelState {
  const nextState = reduceLiveTaskState(stateRef.current, action);
  stateRef.current = nextState;
  dispatch(action);
  return nextState;
}

function renderLiveTaskStatusContent({
  payload
}: LiveTaskStatusSummaryProps) {
  const progress = buildTaskProgressViewModel({
    taskType: payload?.taskType ?? "lp_generation",
    payload
  });

  if (!progress) {
    return null;
  }

  return (
    <div className="taskProgressCardInner">
      <div className="taskProgressIcon" data-status={progress.status} aria-hidden="true">
        <span />
      </div>
      <div className="taskProgressMain">
        <div className="taskProgressTopline">
          <strong>{progress.currentLabel}</strong>
          <span>{progress.progressLabel}</span>
        </div>
        <p>{progress.statusLabel}</p>
        {progress.resultLabel ? (
          <div className="taskProgressResult">
            <strong>{progress.resultLabel}</strong>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function renderTaskProgressPanel({
  payload,
  copy
}: LiveTaskStatusSummaryProps) {
  const progress = buildTaskProgressViewModel({
    taskType: payload?.taskType ?? "lp_generation",
    payload
  });

  return (
    <section
      aria-label={copy.liveTaskTitle}
      className="taskProgressCard agentTaskProgressCard"
      data-status={progress?.status ?? "idle"}
    >
      {renderLiveTaskStatusContent({ payload, copy })}
      {renderTaskNarrativeTimeline({ payload, copy })}
      {payload && !progress ? (
        <span className="taskProgressHidden">{copy.liveTaskIdle}</span>
      ) : null}
    </section>
  );
}

export function LiveTaskStatusSummary({
  payload,
  copy
}: LiveTaskStatusSummaryProps) {
  return renderTaskProgressPanel({ payload, copy });
}

function renderTaskNarrativeTimeline({
  payload
}: LiveTaskStatusSummaryProps) {
  const narrative = buildTaskNarrativeViewModel({
    taskType: payload?.taskType ?? "lp_generation",
    payload
  });

  if (!narrative) {
    return null;
  }

  return (
    <div className="taskNarrativeTimeline" aria-label="LP 生成过程">
      {narrative.steps.map((step) => renderTaskNarrativeStep(step))}
    </div>
  );
}

function renderTaskNarrativeStep(step: TaskNarrativeStepViewModel) {
  return (
    <div
      className="taskNarrativeStep"
      data-collapsed={step.isCollapsed ? "true" : "false"}
      data-status={step.status}
      key={step.id}
    >
      <div className="taskNarrativeDot" aria-hidden="true" />
      <div className="taskNarrativeBody">
        <div className="taskNarrativeTopline">
          <strong>{step.title}</strong>
          <span>{step.statusLabel}</span>
        </div>
        {step.isCollapsed ? null : (
          <>
            <p>{step.body}</p>
            {step.details.length > 0 ? (
              <div className="taskNarrativeDetails" aria-label={`${step.title}过程`}>
                {step.details.map((detail) => (
                  <div
                    className="taskNarrativeDetail"
                    data-status={detail.status}
                    key={detail.id}
                  >
                    <span aria-hidden="true" />
                    <div>
                      <strong>{detail.title}</strong>
                      {detail.description ? <em>{detail.description}</em> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {step.chips.length > 0 ? (
              <div className="taskNarrativeChips">
                {step.chips.map((chip) => (
                  <span key={chip}>{chip}</span>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export function LiveTaskPanel({
  taskId,
  initialProjectId: acceptedInitialProjectId,
  initialPayload,
  initialPreviewVersionKey,
  copy
}: LiveTaskPanelProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(
    reduceLiveTaskState,
    createInitialLiveTaskState(initialPayload?.taskId === taskId ? initialPayload : undefined)
  );
  const stateRef = useRef(state);
  const previousPreviewVersionKeyRef = useRef(initialPreviewVersionKey);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const initialProjectId = acceptedInitialProjectId?.trim() || undefined;
  const initialPayloadForTask = initialPayload?.taskId === taskId ? initialPayload : undefined;
  const initialPayloadStateVersion = initialPayloadForTask?.stateVersion;

  useEffect(() => {
    previousPreviewVersionKeyRef.current = initialPreviewVersionKey;
  }, [initialPreviewVersionKey]);

  useEffect(() => {
    if (!taskId) {
      return undefined;
    }

    let isMounted = true;
    stateRef.current = createInitialLiveTaskState(initialPayloadForTask);
    dispatch({
      type: "reset",
      ...(initialPayloadForTask ? { payload: initialPayloadForTask } : {})
    });
    previousPreviewVersionKeyRef.current = initialPreviewVersionKey;

    const clearPollTimer = () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
    };

    const schedulePoll = (delayMs: number) => {
      clearPollTimer();
      if (!isMounted || delayMs <= 0) {
        return;
      }
      timerRef.current = setTimeout(() => {
        void pollTaskState();
      }, delayMs);
    };

    const dispatchRefreshError = (retryable: boolean) => {
      const nextState = reduceAndDispatch(stateRef, dispatch, {
        type: "error",
        message: copy.liveTaskRefreshError
      });
      const retryMs = getLiveTaskFailureRetryMs({
        retryable,
        state: nextState
      });
      if (retryMs > 0) {
        schedulePoll(retryMs);
      }
    };

    const applyPayload = (payload: LiveTaskStatePayload) => {
      const previewRefreshDecision = getLiveTaskPreviewRefreshDecision({
        previousPreviewVersionKey: previousPreviewVersionKeyRef.current,
        nextPreviewVersionKey: payload.artifactProgress?.previewVersionKey
      });
      const nextState = reduceAndDispatch(stateRef, dispatch, {
        type: "payload",
        payload
      });

      previousPreviewVersionKeyRef.current =
        previewRefreshDecision.nextPreviewVersionKey;

      if (previewRefreshDecision.shouldRefresh) {
        router.refresh();
      }

      if (shouldPollLiveTask(nextState)) {
        schedulePoll(getNextPollMs(nextState));
      }
    };

    const pollTaskState = async () => {
      reduceAndDispatch(stateRef, dispatch, { type: "loading" });

      const result = await fetchLiveTaskStateRoute({
        taskId,
        projectId: initialProjectId
      });
      if (!isMounted) {
        return;
      }
      if (!result.ok) {
        dispatchRefreshError(result.retryable);
        return;
      }

      applyPayload(result.payload);
    };

    if (!initialPayloadForTask?.isTerminal) {
      void pollTaskState();
    }

    return () => {
      isMounted = false;
      clearPollTimer();
    };
  }, [
    copy.liveTaskRefreshError,
    initialPayloadStateVersion,
    initialPreviewVersionKey,
    initialProjectId,
    router,
    taskId
  ]);

  const visiblePayload =
    taskId && state.payload?.taskId === taskId ? state.payload : undefined;
  const visibleErrorMessage = taskId ? state.errorMessage : undefined;

  return (
    <section
      aria-label={copy.liveTaskTitle}
      className="taskProgressCard"
      data-status={
        buildTaskProgressViewModel({
          taskType: visiblePayload?.taskType ?? "lp_generation",
          payload: visiblePayload
        })?.status ?? "idle"
      }
    >
      {renderLiveTaskStatusContent({
        payload: visiblePayload,
        copy
      })}
      {renderTaskNarrativeTimeline({
        payload: visiblePayload,
        copy
      })}
      {visibleErrorMessage ? (
        <p className="liveTaskError" role="alert">
          {visibleErrorMessage}
        </p>
      ) : null}
    </section>
  );
}
