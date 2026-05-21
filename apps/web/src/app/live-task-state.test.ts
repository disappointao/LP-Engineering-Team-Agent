import { describe, expect, it } from "vitest";
import {
  createInitialLiveTaskState,
  reduceLiveTaskState,
  shouldPollLiveTask,
  shouldRefreshForLiveArtifact
} from "./live-task-state";

const payload = {
  taskId: "task_1",
  projectId: "project_1",
  taskType: "lp_generation" as const,
  taskStatus: "complete" as const,
  stateVersion: "v1",
  isTerminal: false,
  nextPollMs: 1200,
  updatedAt: "2026-05-21T00:00:00.000Z",
  messages: [],
  runs: [],
  runEvents: [],
  recovery: { runs: [] },
  workerQueue: {
    projectId: "project_1",
    counts: {
      queued: 0,
      running: 1,
      stale: 0,
      completed: 0,
      failed: 0,
      rejected: 0,
      cancelled: 0
    },
    heartbeat: { status: "active" as const },
    logs: []
  },
  interrupt: {
    available: true,
    state: "idle" as const,
    taskId: "task_1"
  }
};

describe("live task state helpers", () => {
  it("stores the latest payload and keeps polling while non-terminal", () => {
    const state = reduceLiveTaskState(createInitialLiveTaskState(), {
      type: "payload",
      payload
    });

    expect(state.status).toBe("ready");
    expect(state.payload?.stateVersion).toBe("v1");
    expect(shouldPollLiveTask(state)).toBe(true);
  });

  it("stops polling after terminal payload without active refresh reason", () => {
    const state = reduceLiveTaskState(createInitialLiveTaskState(), {
      type: "payload",
      payload: {
        ...payload,
        isTerminal: true,
        nextPollMs: 0
      }
    });

    expect(shouldPollLiveTask(state)).toBe(false);
  });

  it("requests router refresh when artifact version key changes", () => {
    expect(
      shouldRefreshForLiveArtifact({
        previousPreviewVersionKey: "page_1|workspace_1|index.html:aaa",
        nextPreviewVersionKey: "page_2|workspace_2|index.html:bbb"
      })
    ).toBe(true);
  });
});
