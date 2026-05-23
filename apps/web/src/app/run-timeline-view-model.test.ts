import { describe, expect, it } from "vitest";
import { getWorkbenchCopy } from "../lib/i18n";
import type { LiveTaskStatePayload } from "../lib/workbench-store";
import { buildRunTimelineViewModel } from "./run-timeline-view-model";

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
    updatedAt: "2026-05-23T00:00:00.000Z",
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

describe("buildRunTimelineViewModel", () => {
  it("keeps the fixed LP role order and marks missing roles pending", () => {
    const copy = getWorkbenchCopy("en");
    const model = buildRunTimelineViewModel({
      payload: createPayload({
        runs: [
          {
            runId: "run_builder_1",
            projectId: "project_1",
            taskId: "task_1",
            role: "builder",
            state: "running",
            runRecordState: "running",
            startedAt: "2026-05-23T00:00:10.000Z",
            recoveryActions: []
          }
        ],
        recovery: { runs: [] }
      }),
      copy
    });

    expect(model.steps.map((step) => [step.role, step.state, step.status])).toEqual([
      ["planner", "pending", "pending"],
      ["builder", "running", "active"],
      ["reviewer", "pending", "pending"],
      ["deployer", "pending", "pending"]
    ]);
    expect(model.activeStep?.role).toBe("builder");
    expect(model.steps[0]?.stateLabel).toBe("Not started");
  });

  it("derives repair, retry, handoff, diagnostics, and action groups safely", () => {
    const copy = getWorkbenchCopy("en");
    const model = buildRunTimelineViewModel({
      payload: createPayload({
        isTerminal: true,
        runs: [
          {
            runId: "run_planner_1_retry_1",
            projectId: "project_1",
            taskId: "task_1",
            role: "planner",
            state: "completed",
            runRecordState: "completed",
            startedAt: "2026-05-23T00:00:00.000Z",
            completedAt: "2026-05-23T00:00:05.000Z",
            recoveryActions: []
          },
          {
            runId: "run_reviewer_1",
            projectId: "project_1",
            taskId: "task_1",
            role: "reviewer",
            state: "blocked",
            runRecordState: "needs_input",
            startedAt: "2026-05-23T00:00:08.000Z",
            diagnosticSummary: {
              code: "handoff_blocked",
              message: "Reviewer blocked deployment.",
              source: "handoff",
              errorName: "SAFE_CODE"
            },
            recoveryActions: ["resolve_blocker", "inspect_manually"]
          }
        ],
        runEvents: [
          {
            id: "event_repair",
            projectId: "project_1",
            taskId: "task_1",
            runId: "run_planner_1_retry_1",
            type: "model.output.repaired",
            createdAt: "2026-05-23T00:00:04.000Z",
            payload: { type: "model.output.repaired" }
          },
          {
            id: "event_retry",
            projectId: "project_1",
            taskId: "task_1",
            runId: "run_planner_1_retry_1",
            type: "model.retry.exhausted",
            createdAt: "2026-05-23T00:00:03.000Z",
            payload: { type: "model.retry.exhausted" }
          },
          {
            id: "event_handoff",
            projectId: "project_1",
            taskId: "task_1",
            runId: "run_reviewer_1",
            type: "handoff.blocked",
            createdAt: "2026-05-23T00:00:09.000Z",
            payload: {
              type: "handoff.blocked",
              handoffId: "handoff_1",
              fromRole: "reviewer",
              toRole: "deployer"
            }
          }
        ],
        recovery: {
          runs: [
            {
              runId: "run_reviewer_1",
              projectId: "project_1",
              taskId: "task_1",
              role: "reviewer",
              state: "blocked",
              runRecordState: "needs_input",
              startedAt: "2026-05-23T00:00:08.000Z",
              diagnosticSummary: {
                code: "handoff_blocked",
                message: "Reviewer blocked deployment.",
                source: "handoff"
              },
              recoveryActions: ["resolve_blocker", "inspect_manually"]
            }
          ]
        }
      }),
      copy
    });

    const planner = model.steps.find((step) => step.role === "planner");
    const reviewer = model.steps.find((step) => step.role === "reviewer");

    expect(planner?.markers.map((marker) => marker.label)).toEqual([
      "Retry attempt",
      "Repaired",
      "Retry exhausted"
    ]);
    expect(reviewer).toMatchObject({
      status: "attention",
      diagnosticMessage: "Reviewer blocked deployment.",
      diagnosticCode: "handoff_blocked",
      lastEventLabel: "Handoff blocked"
    });
    expect(reviewer?.guidanceActions.map((action) => action.label)).toEqual([
      "Resolve blocker",
      "Inspect manually"
    ]);
    expect(JSON.stringify(model)).not.toContain("RAW_SECRET");
  });
});
