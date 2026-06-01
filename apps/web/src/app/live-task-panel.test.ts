import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveTaskStatePayload } from "../lib/workbench-store";
import { getWorkbenchCopy } from "../lib/i18n";
import {
  fetchLiveTaskStateRoute,
  getLiveTaskFailureRetryMs,
  getLiveTaskPreviewRefreshDecision,
  getLiveTaskPreviewWorkspaceConfig,
  shouldRefreshLiveTaskPage,
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
    expect(text).not.toContain("页面文件已准备好");
    expect(text).not.toContain("3 files");
    expect(text).not.toContain("2 changed");
    expect(text).not.toContain("Live task progress");
    expect(text).not.toContain("Builder · Running");
    expect(text).not.toContain("builder · running");
    expect(text).not.toContain("<!doctype html");
  });

  it("renders LP process feedback from safe runtime events", () => {
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
          runId: "run_planner_brief_1",
          projectId: "project_1",
          taskId: "task_1",
          role: "planner",
          state: "completed",
          runRecordState: "completed",
          startedAt: "2026-05-21T00:00:00.000Z",
          completedAt: "2026-05-21T00:00:02.000Z",
          recoveryActions: []
        },
        {
          runId: "run_builder_version_1",
          projectId: "project_1",
          taskId: "task_1",
          role: "builder",
          state: "running",
          runRecordState: "running",
          startedAt: "2026-05-21T00:00:03.000Z",
          recoveryActions: []
        }
      ],
      runEvents: [
        {
          id: "event_context_loaded",
          projectId: "project_1",
          taskId: "task_1",
          runId: "run_builder_version_1",
          type: "runtime.context.loaded",
          createdAt: "2026-05-21T00:00:03.000Z",
          payload: { role: "builder", skillCount: 1, toolCount: 0 }
        },
        {
          id: "event_handoff_consumed",
          projectId: "project_1",
          taskId: "task_1",
          runId: "run_builder_version_1",
          type: "handoff.consumed",
          createdAt: "2026-05-21T00:00:03.100Z",
          payload: { role: "builder", fromRole: "planner", toRole: "builder" }
        },
        {
          id: "event_model_stream_started",
          projectId: "project_1",
          taskId: "task_1",
          runId: "run_builder_version_1",
          type: "model.stream.started",
          createdAt: "2026-05-21T00:00:03.200Z",
          payload: { role: "builder" }
        },
        {
          id: "event_model_stream_progress",
          projectId: "project_1",
          taskId: "task_1",
          runId: "run_builder_version_1",
          type: "model.stream.progress",
          createdAt: "2026-05-21T00:00:03.500Z",
          payload: { role: "builder", chunkCount: 6, receivedChars: 1024 }
        },
        {
          id: "event_model_stream_completed",
          projectId: "project_1",
          taskId: "task_1",
          runId: "run_builder_version_1",
          type: "model.stream.completed",
          createdAt: "2026-05-21T00:00:03.900Z",
          payload: { role: "builder", chunkCount: 6, receivedChars: 1024 }
        },
        {
          id: "event_model_completed",
          projectId: "project_1",
          taskId: "task_1",
          runId: "run_builder_version_1",
          type: "model.completed",
          createdAt: "2026-05-21T00:00:04.000Z",
          payload: { role: "builder", provider: "safe_provider", model: "safe-model" }
        },
        {
          id: "event_workspace_created",
          projectId: "project_1",
          taskId: "task_1",
          runId: "run_builder_version_1",
          type: "artifact.workspace.created",
          createdAt: "2026-05-21T00:00:05.000Z",
          payload: { role: "builder", fileCount: 3, artifactWorkspaceId: "workspace_1" }
        }
      ],
      artifactProgress: {
        pageVersionId: "page_1",
        artifactWorkspaceId: "workspace_1",
        fileCount: 3,
        changedFileCount: 3,
        previewVersionKey: "page_1|workspace_1|index.html:aaa"
      }
    });

    const rendered = LiveTaskStatusSummary({ payload, copy });
    const text = collectText(rendered).join(" ");

    expect(text).toContain("生成静态 LP 文件");
    expect(text).toContain("模型响应已完成，正在校验输出并准备下一步。");
    expect(text).toContain("上下文已装载");
    expect(text).toContain("接收上一步结果");
    expect(text).toContain("模型流已连接");
    expect(text).toContain("模型流已完成");
    expect(text).toContain("接收模型流式响应");
    expect(text).toContain("安全响应已接收完成。");
    expect(text).toContain("模型已响应");
    expect(text).toContain("文件已生成：3 个");
    expect(text).not.toContain("<!doctype html");
    expect(text).not.toContain("raw artifact");
  });

  it("renders a safe timeout reason when LP file generation fails", () => {
    const copy = {
      ...getWorkbenchCopy("en").chat,
      roleLabels: getWorkbenchCopy("en").modelsView.roleLabels
    };
    const payload = createPayload({
      runs: [
        {
          runId: "run_planner_brief_1",
          projectId: "project_1",
          taskId: "task_1",
          role: "planner",
          state: "completed",
          runRecordState: "completed",
          startedAt: "2026-05-21T00:00:00.000Z",
          completedAt: "2026-05-21T00:00:02.000Z",
          recoveryActions: []
        },
        {
          runId: "run_builder_version_1",
          projectId: "project_1",
          taskId: "task_1",
          role: "builder",
          state: "failed",
          runRecordState: "failed",
          startedAt: "2026-05-21T00:00:03.000Z",
          completedAt: "2026-05-21T00:04:03.000Z",
          diagnosticSummary: {
            code: "run_failed",
            message: "Run failed.",
            source: "run_event",
            eventType: "run.failed",
            errorName: "ModelProviderRequestError"
          },
          recoveryActions: ["retry_run"]
        }
      ],
      runEvents: [
        {
          id: "event_context_loaded",
          projectId: "project_1",
          taskId: "task_1",
          runId: "run_builder_version_1",
          type: "runtime.context.loaded",
          createdAt: "2026-05-21T00:00:03.000Z",
          payload: { role: "builder" }
        },
        {
          id: "event_retry_scheduled",
          projectId: "project_1",
          taskId: "task_1",
          runId: "run_builder_version_1",
          type: "model.retry.scheduled",
          createdAt: "2026-05-21T00:02:03.000Z",
          payload: { role: "builder", errorCode: "model_provider_request_timeout" }
        },
        {
          id: "event_retry_exhausted",
          projectId: "project_1",
          taskId: "task_1",
          runId: "run_builder_version_1",
          type: "model.retry.exhausted",
          createdAt: "2026-05-21T00:04:03.000Z",
          payload: { role: "builder", errorCode: "model_provider_request_timeout" }
        },
        {
          id: "event_failed",
          projectId: "project_1",
          taskId: "task_1",
          runId: "run_builder_version_1",
          type: "run.failed",
          createdAt: "2026-05-21T00:04:03.000Z",
          payload: {
            role: "builder",
            errorCode: "model_provider_request_timeout",
            errorName: "ModelProviderRequestError"
          }
        }
      ]
    });

    const rendered = LiveTaskStatusSummary({ payload, copy });
    const text = collectText(rendered).join(" ");

    expect(text).toContain("生成静态 LP 文件");
    expect(text).toContain("模型响应超时，已停止生成。可以重试，或换用响应更快的模型。");
    expect(text).toContain("模型响应超时");
    expect(text).toContain("已重试");
    expect(text).not.toContain("ModelProviderRequestError");
    expect(text).not.toContain("model_provider_request_timeout");
  });
});

describe("live task panel polling helpers", () => {
  it("includes the explicit project context when polling a task", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ ok: false, error: "task_not_found" }, { status: 404 })
    );

    await fetchLiveTaskStateRoute({
      taskId: "task_1",
      projectId: "project_1",
      fetcher
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/tasks/task_1/state?projectId=project_1",
      { cache: "no-store" }
    );
  });

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

  it("keeps preview key changes inside the live panel instead of refreshing the page", () => {
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
      shouldRefresh: false,
      nextPreviewVersionKey: "page_2|workspace_2|index.html:bbb"
    });
    expect(firstArtifactDecision).toEqual({
      shouldRefresh: false,
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

  it("refreshes the page once when the live task reaches a terminal state", () => {
    expect(
      shouldRefreshLiveTaskPage({
        hasRefreshedTerminal: false,
        payload: createPayload({ isTerminal: false })
      })
    ).toBe(false);
    expect(
      shouldRefreshLiveTaskPage({
        hasRefreshedTerminal: false,
        payload: createPayload({ isTerminal: true })
      })
    ).toBe(true);
    expect(
      shouldRefreshLiveTaskPage({
        hasRefreshedTerminal: true,
        payload: createPayload({ isTerminal: true })
      })
    ).toBe(false);
  });

  it("builds lazy preview and export links after static artifacts are available", () => {
    const payload = createPayload({
      artifactProgress: {
        pageVersionId: "page_1",
        artifactWorkspaceId: "workspace_1",
        fileCount: 3,
        changedFileCount: 3,
        previewVersionKey: "page_1|workspace_1|index.html:aaa"
      }
    });
    const config = getLiveTaskPreviewWorkspaceConfig({
      taskId: "task_1",
      projectId: "project_1",
      payload,
      exportLabels: getWorkbenchCopy("en").exports
    });

    expect(config?.previewUrl).toBe(
      "/api/tasks/task_1/preview?projectId=project_1&version=page_1"
    );
    expect(config?.previewVersionKey).toBe("page_1|workspace_1|index.html:aaa");
    expect(config?.exportLinks.map((link) => [link.label, link.filename, link.href])).toEqual([
      [
        "Export Single HTML",
        "index.single.html",
        "/api/tasks/task_1/export?projectId=project_1&version=page_1&file=single-html"
      ],
      [
        "Export index.html",
        "index.html",
        "/api/tasks/task_1/export?projectId=project_1&version=page_1&file=index-html"
      ],
      [
        "Export styles.css",
        "styles.css",
        "/api/tasks/task_1/export?projectId=project_1&version=page_1&file=styles-css"
      ],
      [
        "Export script.js",
        "script.js",
        "/api/tasks/task_1/export?projectId=project_1&version=page_1&file=script-js"
      ]
    ]);
  });
});
