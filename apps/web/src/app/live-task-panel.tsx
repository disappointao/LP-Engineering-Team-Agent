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

export interface LiveTaskPanelProps {
  taskId?: string;
  initialProjectId?: string;
  initialPreviewVersionKey?: string;
  copy: WorkbenchCopy["chat"];
}

export interface LiveTaskStatusSummaryProps {
  payload?: LiveTaskStatePayload;
  copy: WorkbenchCopy["chat"];
}

type LiveTaskStateRouteResponse =
  | { ok: true; value: LiveTaskStatePayload }
  | { ok: false; error: string };

const retryPollMs = 3000;
const activeRunStates = new Set([
  "queued",
  "running",
  "waiting_for_approval",
  "cancelling"
]);

function getActiveRun(payload?: LiveTaskStatePayload) {
  return payload?.runs.find((run) => activeRunStates.has(run.state));
}

function getLiveTaskStatusText(
  payload: LiveTaskStatePayload | undefined,
  copy: WorkbenchCopy["chat"]
): string {
  if (payload?.isTerminal) {
    return copy.liveTaskCompleted;
  }
  if (getActiveRun(payload)) {
    return copy.liveTaskRunning;
  }
  return copy.liveTaskIdle;
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
  payload,
  copy
}: LiveTaskStatusSummaryProps) {
  const activeRun = getActiveRun(payload);
  const artifactProgress = payload?.artifactProgress;
  const artifactSummary = artifactProgress
    ? `${artifactProgress.fileCount} files · ${artifactProgress.changedFileCount} changed`
    : undefined;

  return (
    <>
      <header className="liveTaskHeader">
        <strong>{copy.liveTaskTitle}</strong>
        <span className="liveTaskStatus">{getLiveTaskStatusText(payload, copy)}</span>
      </header>
      {activeRun ? (
        <p className="liveTaskMeta">
          {activeRun.role} · {activeRun.state}
        </p>
      ) : null}
      {artifactProgress && artifactSummary ? (
        <div className="liveTaskArtifact">
          {artifactProgress.artifactWorkspaceId ? (
            <strong>{copy.liveTaskArtifactReady}</strong>
          ) : null}
          <span className="liveTaskProgressSummary">{artifactSummary}</span>
        </div>
      ) : null}
    </>
  );
}

export function LiveTaskStatusSummary({
  payload,
  copy
}: LiveTaskStatusSummaryProps) {
  return (
    <section aria-label={copy.liveTaskTitle} className="liveTaskPanel">
      {renderLiveTaskStatusContent({ payload, copy })}
    </section>
  );
}

export function LiveTaskPanel({
  taskId,
  initialProjectId: acceptedInitialProjectId,
  initialPreviewVersionKey,
  copy
}: LiveTaskPanelProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(
    reduceLiveTaskState,
    createInitialLiveTaskState()
  );
  const stateRef = useRef(state);
  const previousPreviewVersionKeyRef = useRef(initialPreviewVersionKey);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  void acceptedInitialProjectId;

  useEffect(() => {
    previousPreviewVersionKeyRef.current = initialPreviewVersionKey;
  }, [initialPreviewVersionKey]);

  useEffect(() => {
    if (!taskId) {
      return undefined;
    }

    let isMounted = true;
    stateRef.current = createInitialLiveTaskState();

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

    const dispatchRefreshError = () => {
      const nextState = reduceAndDispatch(stateRef, dispatch, {
        type: "error",
        message: copy.liveTaskRefreshError
      });
      if (shouldPollLiveTask(nextState)) {
        schedulePoll(retryPollMs);
      }
    };

    const applyPayload = (payload: LiveTaskStatePayload) => {
      const nextPreviewVersionKey = payload.artifactProgress?.previewVersionKey;
      const shouldRefresh = shouldRefreshForLiveArtifact({
        previousPreviewVersionKey: previousPreviewVersionKeyRef.current,
        nextPreviewVersionKey
      });
      const nextState = reduceAndDispatch(stateRef, dispatch, {
        type: "payload",
        payload
      });

      if (nextPreviewVersionKey !== undefined) {
        previousPreviewVersionKeyRef.current = nextPreviewVersionKey;
      }

      if (shouldRefresh) {
        router.refresh();
      }

      if (shouldPollLiveTask(nextState)) {
        schedulePoll(getNextPollMs(nextState));
      }
    };

    const pollTaskState = async () => {
      reduceAndDispatch(stateRef, dispatch, { type: "loading" });

      try {
        const response = await fetch(
          `/api/tasks/${encodeURIComponent(taskId)}/state`,
          { cache: "no-store" }
        );
        if (!isMounted) {
          return;
        }
        if (!response.ok) {
          dispatchRefreshError();
          return;
        }

        const result = (await response.json()) as LiveTaskStateRouteResponse;
        if (!isMounted) {
          return;
        }
        if (!result.ok) {
          dispatchRefreshError();
          return;
        }

        applyPayload(result.value);
      } catch {
        if (isMounted) {
          dispatchRefreshError();
        }
      }
    };

    void pollTaskState();

    return () => {
      isMounted = false;
      clearPollTimer();
    };
  }, [copy.liveTaskRefreshError, initialPreviewVersionKey, router, taskId]);

  const visiblePayload =
    taskId && state.payload?.taskId === taskId ? state.payload : undefined;
  const visibleErrorMessage = taskId ? state.errorMessage : undefined;

  return (
    <section aria-label={copy.liveTaskTitle} className="liveTaskPanel">
      {renderLiveTaskStatusContent({
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
