import { describe, expect, it } from "vitest";
import type { LiveTaskStatePayload } from "../lib/workbench-store";
import { getWorkbenchCopy } from "../lib/i18n";
import { LiveTaskStatusSummary } from "./live-task-panel";

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

describe("LiveTaskStatusSummary", () => {
  it("renders a safe compact task summary without exposing raw artifact content", () => {
    const copy = getWorkbenchCopy("en").chat;
    const payload: LiveTaskStatePayload = {
      taskId: "task_1",
      projectId: "project_1",
      taskType: "lp_generation",
      taskStatus: "complete",
      stateVersion: "state_1",
      isTerminal: false,
      nextPollMs: 1200,
      updatedAt: "2026-05-21T00:00:00.000Z",
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
        heartbeat: { status: "active" },
        logs: []
      },
      interrupt: {
        available: true,
        state: "idle",
        taskId: "task_1"
      },
      artifactProgress: {
        pageVersionId: "page_1",
        artifactWorkspaceId: "workspace_1",
        fileCount: 3,
        changedFileCount: 2,
        previewVersionKey: "page_1|workspace_1|index.html:aaa"
      }
    };

    const rendered = LiveTaskStatusSummary({ payload, copy });
    const text = collectText(rendered).join(" ");

    expect(text).toContain("Live task progress");
    expect(text).toContain("Task is running");
    expect(text).toContain("Artifact workspace ready");
    expect(text).toContain("3 files · 2 changed");
    expect(text).not.toContain("<!doctype html");
  });
});
