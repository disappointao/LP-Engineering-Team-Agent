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

function createRecoveryActions(
  actions: string[]
): LiveTaskStatePayload["runs"][number]["recoveryActions"] {
  return actions as LiveTaskStatePayload["runs"][number]["recoveryActions"];
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

  it("drops unknown recovery actions and groups known actions explicitly", () => {
    const copy = getWorkbenchCopy("en");
    const model = buildRunTimelineViewModel({
      payload: createPayload({
        runs: [
          {
            runId: "run_reviewer_actions",
            projectId: "project_1",
            taskId: "task_1",
            role: "reviewer",
            state: "blocked",
            runRecordState: "needs_input",
            startedAt: "2026-05-23T00:00:08.000Z",
            recoveryActions: createRecoveryActions([
              "retry_run",
              "resume_worker_finalization",
              "request_approval",
              "resolve_blocker",
              "inspect_manually",
              "RAW_SECRET<script>"
            ])
          }
        ],
        recovery: { runs: [] }
      }),
      copy
    });

    const reviewer = model.steps.find((step) => step.role === "reviewer");

    expect(reviewer?.executableActions.map((action) => action.label)).toEqual([
      "Retry run",
      "Resume finalization"
    ]);
    expect(reviewer?.guidanceActions.map((action) => action.label)).toEqual([
      "Request approval",
      "Resolve blocker",
      "Inspect manually"
    ]);
    expect(JSON.stringify(model)).not.toContain("RAW_SECRET");
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
              errorName: "RAW_SECRET"
            },
            recoveryActions: createRecoveryActions([
              "resolve_blocker",
              "inspect_manually",
              "retry_run",
              "resume_worker_finalization",
              "RAW_SECRET<script>"
            ])
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
            id: "event_repair_duplicate",
            projectId: "project_1",
            taskId: "task_1",
            runId: "run_planner_1_retry_1",
            type: "model.output.repaired",
            createdAt: "2026-05-23T00:00:05.000Z",
            payload: { type: "model.output.repaired" }
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
                source: "handoff",
                errorName: "RAW_SECRET"
              },
              recoveryActions: createRecoveryActions([
                "resolve_blocker",
                "inspect_manually",
                "retry_run",
                "resume_worker_finalization",
                "RAW_SECRET<script>"
              ])
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
      "Retry exhausted",
      "Repaired"
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
    expect(reviewer?.executableActions.map((action) => action.label)).toEqual([
      "Retry run",
      "Resume finalization"
    ]);
    expect(JSON.stringify(model)).not.toContain("RAW_SECRET");
  });

  it("selects the latest role run without depending on payload order", () => {
    const copy = getWorkbenchCopy("en");
    const model = buildRunTimelineViewModel({
      payload: createPayload({
        runs: [
          {
            runId: "run_builder_latest",
            projectId: "project_1",
            taskId: "task_1",
            role: "builder",
            state: "running",
            runRecordState: "running",
            startedAt: "2026-05-23T00:00:10.000Z",
            recoveryActions: []
          },
          {
            runId: "run_builder_older",
            projectId: "project_1",
            taskId: "task_1",
            role: "builder",
            state: "completed",
            runRecordState: "completed",
            startedAt: "2026-05-23T00:00:00.000Z",
            completedAt: "2026-05-23T00:00:05.000Z",
            recoveryActions: []
          },
          {
            runId: "run_deployer_z",
            projectId: "project_1",
            taskId: "task_1",
            role: "deployer",
            state: "completed",
            runRecordState: "completed",
            startedAt: "2026-05-23T00:00:20.000Z",
            completedAt: "2026-05-23T00:00:30.000Z",
            recoveryActions: []
          },
          {
            runId: "run_deployer_a",
            projectId: "project_1",
            taskId: "task_1",
            role: "deployer",
            state: "failed",
            runRecordState: "failed",
            startedAt: "2026-05-23T00:00:20.000Z",
            completedAt: "2026-05-23T00:00:30.000Z",
            recoveryActions: []
          }
        ],
        recovery: { runs: [] }
      }),
      copy
    });

    const builder = model.steps.find((step) => step.role === "builder");
    const deployer = model.steps.find((step) => step.role === "deployer");

    expect(builder).toMatchObject({
      runId: "run_builder_latest",
      state: "running",
      status: "active"
    });
    expect(deployer).toMatchObject({
      runId: "run_deployer_z",
      state: "completed",
      status: "complete"
    });
    expect(model.activeStep?.runId).toBe("run_builder_latest");
  });

  it("suppresses unknown latest event labels", () => {
    const copy = getWorkbenchCopy("en");
    const model = buildRunTimelineViewModel({
      payload: createPayload({
        runs: [
          {
            runId: "run_builder_1",
            projectId: "project_1",
            taskId: "task_1",
            role: "builder",
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
            state: "completed",
            runRecordState: "completed",
            startedAt: "2026-05-23T00:00:06.000Z",
            completedAt: "2026-05-23T00:00:10.000Z",
            recoveryActions: []
          }
        ],
        runEvents: [
          {
            id: "event_safe_unknown",
            projectId: "project_1",
            taskId: "task_1",
            runId: "run_builder_1",
            type: "worker.job.linked",
            createdAt: "2026-05-23T00:00:01.000Z",
            payload: { runId: "run_builder_1" }
          },
          {
            id: "event_unsafe_unknown",
            projectId: "project_1",
            taskId: "task_1",
            runId: "run_reviewer_1",
            type: "RAW_SECRET<script>/Users/ao/.ssh/id_rsa",
            createdAt: "2026-05-23T00:00:07.000Z",
            payload: { type: "RAW_SECRET" }
          }
        ],
        recovery: { runs: [] }
      }),
      copy
    });

    const builder = model.steps.find((step) => step.role === "builder");
    const reviewer = model.steps.find((step) => step.role === "reviewer");

    expect(builder?.lastEventLabel).toBeUndefined();
    expect(reviewer?.lastEventLabel).toBeUndefined();
    expect(JSON.stringify(model)).not.toContain("RAW_SECRET");
    expect(JSON.stringify(model)).not.toContain("<script>");
    expect(JSON.stringify(model)).not.toContain("/Users/ao/.ssh/id_rsa");
  });
});
