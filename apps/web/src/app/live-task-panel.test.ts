import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveTaskStatePayload } from "../lib/workbench-store";
import { getWorkbenchCopy } from "../lib/i18n";
import {
  fetchLiveTaskStateRoute,
  getLiveTaskFailureRetryMs,
  getLiveTaskPreviewRefreshDecision,
  LiveTaskStatusSummary
} from "./live-task-panel";
import {
  createInitialLiveTaskState,
  reduceLiveTaskState
} from "./live-task-state";

function collectText(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === "boolean") {
    return [];
  }

  if (typeof node === "string" || typeof node === "number") {
    return [String(node)];
  }

  if (Array.isArray(node)) {
    return node.flatMap(collectText);
  }

  if (typeof node === "object" && "props" in node) {
    const element = node as { props?: { children?: unknown } };
    return collectText(element.props?.children);
  }

  return [];
}

function createPayload(
  overrides: Partial<LiveTaskStatePayload> = {}
): LiveTaskStatePayload {
  return {
    taskId: "task_1",
    projectId: "project_1",
    taskType: "lp_generation",
    taskStatus: "complete",
    stateVersion: "state_1",
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
        running: 0,
        stale: 0,
        completed: 0,
        failed: 0,
        rejected: 0,
        cancelled: 0
      },
      heartbeat: { status: "active" },
      logs: []
    },
    interrupt: {
      available: true,
      state: "idle",
      taskId: "task_1"
    },
    ...overrides
  };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LiveTaskStatusSummary", () => {
  it("renders a safe compact task summary without exposing raw artifact content", () => {
    const copy = {
      ...getWorkbenchCopy("en").chat,
      roleLabels: getWorkbenchCopy("en").modelsView.roleLabels
    };
    const payload = createPayload({
      messages: [
        {
          id: "message_1",
          taskId: "task_1",
          role: "assistant",
          content: "<!doctype html><html><body>raw artifact</body></html>",
          createdAt: "2026-05-21T00:00:00.000Z"
        }
      ],
      runs: [
        {
          runId: "run_1",
          projectId: "project_1",
          taskId: "task_1",
          role: "builder",
          state: "running",
          runRecordState: "running",
          startedAt: "2026-05-21T00:00:00.000Z",
          recoveryActions: []
        }
      ],
      artifactProgress: {
        pageVersionId: "page_1",
        artifactWorkspaceId: "workspace_1",
        fileCount: 3,
        changedFileCount: 2,
        previewVersionKey: "page_1|workspace_1|index.html:aaa"
      }
    });

    const rendered = LiveTaskStatusSummary({ payload, copy });
    const text = collectText(rendered).join(" ");

    expect(text).toContain("生成静态页面文件");
    expect(text).toContain("3 / 4");
    expect(text).toContain("处理中");
    expect(text).toContain("页面文件已准备好");
    expect(text).not.toContain("3 files");
    expect(text).not.toContain("2 changed");
    expect(text).not.toContain("Live task progress");
    expect(text).not.toContain("Builder · Running");
    expect(text).not.toContain("builder · running");
    expect(text).not.toContain("<!doctype html");
  });
});

describe("live task panel polling helpers", () => {
  it("classifies permanent task and project route errors without scheduling retries", async () => {
    const taskFetch = vi.fn(async () =>
      jsonResponse({ ok: false, error: "task_not_found" }, { status: 404 })
    );
    const projectFetch = vi.fn(async () =>
      jsonResponse({ ok: false, error: "project_not_found" }, { status: 403 })
    );
    const copy = getWorkbenchCopy("en").chat;
    const errorState = reduceLiveTaskState(createInitialLiveTaskState(), {
      type: "error",
      message: copy.liveTaskRefreshError
    });

    const taskResult = await fetchLiveTaskStateRoute({
      taskId: "missing_task",
      fetcher: taskFetch
    });
    const projectResult = await fetchLiveTaskStateRoute({
      taskId: "task_1",
      fetcher: projectFetch
    });

    if (taskResult.ok || projectResult.ok) {
      throw new Error("Expected permanent route failures.");
    }

    expect(taskResult).toEqual({
      ok: false,
      error: "task_not_found",
      retryable: false
    });
    expect(projectResult).toEqual({
      ok: false,
      error: "project_not_found",
      retryable: false
    });
    expect(errorState.errorMessage).toBe("Task progress could not be refreshed.");
    expect(
      getLiveTaskFailureRetryMs({
        retryable: taskResult.retryable,
        state: errorState
      })
    ).toBe(0);
    expect(taskFetch).toHaveBeenCalledTimes(1);
    expect(projectFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a 3000ms retry for transient fetch and server failures", async () => {
    vi.useFakeTimers();
    const fetchThrow = vi.fn(async () => {
      throw new Error("network down");
    });
    const serverFetch = vi.fn(async () =>
      jsonResponse({ ok: false, error: "worker_runtime_not_configured" }, { status: 500 })
    );
    const retry = vi.fn();
    const errorState = reduceLiveTaskState(createInitialLiveTaskState(), {
      type: "error",
      message: getWorkbenchCopy("en").chat.liveTaskRefreshError
    });

    const fetchFailure = await fetchLiveTaskStateRoute({
      taskId: "task_1",
      fetcher: fetchThrow
    });
    const serverFailure = await fetchLiveTaskStateRoute({
      taskId: "task_1",
      fetcher: serverFetch
    });

    if (fetchFailure.ok || serverFailure.ok) {
      throw new Error("Expected transient route failures.");
    }

    const retryMs = getLiveTaskFailureRetryMs({
      retryable: fetchFailure.retryable,
      state: errorState
    });

    setTimeout(retry, retryMs);
    await vi.advanceTimersByTimeAsync(2999);
    expect(retry).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(fetchFailure).toMatchObject({ ok: false, retryable: true });
    expect(serverFailure).toMatchObject({ ok: false, retryable: true });
    expect(retryMs).toBe(3000);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("refreshes on preview key changes and resets the task baseline", () => {
    const firstDecision = getLiveTaskPreviewRefreshDecision({
      previousPreviewVersionKey: "page_1|workspace_1|index.html:aaa",
      nextPreviewVersionKey: "page_2|workspace_2|index.html:bbb"
    });
    const firstArtifactDecision = getLiveTaskPreviewRefreshDecision({
      previousPreviewVersionKey: undefined,
      nextPreviewVersionKey: "page_2|workspace_2|index.html:bbb"
    });
    const repeatDecision = getLiveTaskPreviewRefreshDecision({
      previousPreviewVersionKey: firstDecision.nextPreviewVersionKey,
      nextPreviewVersionKey: "page_2|workspace_2|index.html:bbb"
    });
    const resetDecision = getLiveTaskPreviewRefreshDecision({
      previousPreviewVersionKey: "page_3|workspace_3|index.html:ccc",
      nextPreviewVersionKey: "page_4|workspace_4|index.html:ddd",
      resetPreviewVersionKey: "page_4|workspace_4|index.html:ddd"
    });

    expect(firstDecision).toEqual({
      shouldRefresh: true,
      nextPreviewVersionKey: "page_2|workspace_2|index.html:bbb"
    });
    expect(firstArtifactDecision).toEqual({
      shouldRefresh: true,
      nextPreviewVersionKey: "page_2|workspace_2|index.html:bbb"
    });
    expect(repeatDecision).toEqual({
      shouldRefresh: false,
      nextPreviewVersionKey: "page_2|workspace_2|index.html:bbb"
    });
    expect(resetDecision).toEqual({
      shouldRefresh: false,
      nextPreviewVersionKey: "page_4|workspace_4|index.html:ddd"
    });
  });
});
