import type { LiveTaskStatePayload } from "../lib/workbench-store";

export type LiveTaskPanelStatus = "idle" | "loading" | "ready" | "error";

export interface LiveTaskPanelState {
  status: LiveTaskPanelStatus;
  payload?: LiveTaskStatePayload;
  errorMessage?: string;
  lastPreviewVersionKey?: string;
}

export type LiveTaskPanelAction =
  | { type: "reset"; payload?: LiveTaskStatePayload }
  | { type: "loading" }
  | { type: "payload"; payload: LiveTaskStatePayload }
  | { type: "error"; message: string };

export function createInitialLiveTaskState(
  payload?: LiveTaskStatePayload
): LiveTaskPanelState {
  if (payload) {
    return {
      status: "ready",
      payload,
      lastPreviewVersionKey: payload.artifactProgress?.previewVersionKey
    };
  }
  return { status: "idle" };
}

export function reduceLiveTaskState(
  state: LiveTaskPanelState,
  action: LiveTaskPanelAction
): LiveTaskPanelState {
  switch (action.type) {
    case "reset":
      return createInitialLiveTaskState(action.payload);
    case "loading":
      return {
        ...state,
        status: state.payload ? "ready" : "loading",
        errorMessage: undefined
      };
    case "payload":
      return {
        status: "ready",
        payload: action.payload,
        lastPreviewVersionKey:
          action.payload.artifactProgress?.previewVersionKey ??
          state.lastPreviewVersionKey,
        errorMessage: undefined
      };
    case "error":
      return {
        ...state,
        status: "error",
        errorMessage: action.message
      };
  }
}

export function shouldPollLiveTask(state: LiveTaskPanelState): boolean {
  if (!state.payload) {
    return true;
  }
  return !state.payload.isTerminal;
}

export function getNextPollMs(
  state: LiveTaskPanelState,
  fallbackMs = 1200
): number {
  if (!state.payload) {
    return fallbackMs;
  }
  if (state.payload.isTerminal) {
    return 0;
  }
  return state.payload.nextPollMs > 0 ? state.payload.nextPollMs : fallbackMs;
}

export function shouldRefreshForLiveArtifact({
  previousPreviewVersionKey,
  nextPreviewVersionKey
}: {
  previousPreviewVersionKey?: string;
  nextPreviewVersionKey?: string;
}): boolean {
  return (
    previousPreviewVersionKey !== undefined &&
    nextPreviewVersionKey !== undefined &&
    previousPreviewVersionKey !== nextPreviewVersionKey
  );
}
