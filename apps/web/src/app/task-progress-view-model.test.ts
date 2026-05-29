import { describe, expect, it } from "vitest";
import {
  buildTaskNarrativeViewModel,
  buildTaskProgressViewModel
} from "./task-progress-view-model";

describe("task progress view model", () => {
  it("returns no card for ordinary chat tasks", () => {
    expect(buildTaskProgressViewModel({ taskType: "general_chat" })).toBeUndefined();
  });

  it("shows the planning step while planner is active", () => {
    expect(
      buildTaskProgressViewModel({
        taskType: "lp_generation",
        payload: {
          isTerminal: false,
          runs: [{ role: "planner", state: "running" }],
          taskId: "task_1"
        }
      })
    ).toMatchObject({
      activeStepIndex: 1,
      currentLabel: "规划页面结构和内容",
      progressLabel: "2 / 4",
      status: "running"
    });
  });

  it("shows ready state when artifacts are available", () => {
    expect(
      buildTaskProgressViewModel({
        taskType: "lp_generation",
        payload: {
          artifactProgress: {
            artifactWorkspaceId: "workspace_1",
            changedFileCount: 3,
            fileCount: 3,
            previewVersionKey: "version_1"
          },
          isTerminal: true,
          runs: [],
          taskId: "task_1"
        }
      })
    ).toMatchObject({
      activeStepIndex: 3,
      currentLabel: "检查并准备交付",
      resultLabel: "页面文件已准备好",
      status: "complete"
    });
  });

  it("shows the final delivery step when artifacts exist despite an older failed run", () => {
    expect(
      buildTaskProgressViewModel({
        taskType: "lp_generation",
        payload: {
          artifactProgress: {
            artifactWorkspaceId: "workspace_1",
            changedFileCount: 3,
            fileCount: 3,
            previewVersionKey: "version_1"
          },
          isTerminal: true,
          runs: [{ role: "builder", state: "failed" }],
          taskId: "task_1"
        }
      })
    ).toMatchObject({
      activeStepIndex: 3,
      currentLabel: "检查并准备交付",
      progressLabel: "4 / 4",
      resultLabel: "页面文件已准备好",
      status: "complete"
    });
  });

  it("does not show stale artifact readiness while a newer run is active", () => {
    expect(
      buildTaskProgressViewModel({
        taskType: "lp_generation",
        payload: {
          artifactProgress: {
            artifactWorkspaceId: "previous_workspace_1",
            changedFileCount: 3,
            fileCount: 3,
            previewVersionKey: "previous_version_1"
          },
          isTerminal: false,
          runs: [{ role: "planner", state: "running" }],
          taskId: "task_1"
        }
      })
    ).toMatchObject({
      activeStepIndex: 1,
      currentLabel: "规划页面结构和内容",
      resultLabel: undefined,
      status: "running"
    });
  });

  it("does not mark failed terminal tasks complete without artifacts", () => {
    expect(
      buildTaskProgressViewModel({
        taskType: "lp_generation",
        payload: {
          isTerminal: true,
          runs: [{ role: "planner", state: "failed" }],
          taskId: "task_1"
        }
      })
    ).toMatchObject({
      activeStepIndex: 1,
      currentLabel: "规划页面结构和内容",
      progressLabel: "2 / 4",
      status: "failed",
      statusLabel: "失败"
    });
  });

  it("expands the active streaming phase and collapses completed phases", () => {
    const narrative = buildTaskNarrativeViewModel({
      taskType: "lp_generation",
      payload: {
        isTerminal: false,
        runs: [
          { runId: "run_planner_brief_1", role: "planner", state: "completed" },
          { runId: "run_builder_version_1", role: "builder", state: "running" }
        ],
        taskId: "task_1",
        runEvents: [
          {
            id: "event_planner_parsed",
            projectId: "project_1",
            taskId: "task_1",
            runId: "run_planner_brief_1",
            type: "model.output.parsed",
            createdAt: "2026-05-21T00:00:01.000Z",
            payload: { role: "planner" }
          },
          {
            id: "event_builder_stream_started",
            projectId: "project_1",
            taskId: "task_1",
            runId: "run_builder_version_1",
            type: "model.stream.started",
            createdAt: "2026-05-21T00:00:02.000Z",
            payload: { role: "builder" }
          },
          {
            id: "event_builder_stream_progress",
            projectId: "project_1",
            taskId: "task_1",
            runId: "run_builder_version_1",
            type: "model.stream.progress",
            createdAt: "2026-05-21T00:00:03.000Z",
            payload: { role: "builder", chunkCount: 8, receivedChars: 1536 }
          }
        ]
      }
    });

    const planner = narrative?.steps.find((step) => step.id === "planner");
    const builder = narrative?.steps.find((step) => step.id === "builder");

    expect(planner).toMatchObject({
      status: "complete",
      isCollapsed: true
    });
    expect(builder).toMatchObject({
      status: "running",
      isCollapsed: false,
      body: "正在接收模型响应，安全进度会持续更新。"
    });
    expect(builder?.chips).toContain("模型流已连接");
    expect(builder?.chips).toContain("流式响应中");
    expect(builder?.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "接收模型流式响应",
          status: "running",
          description: "正在持续接收安全响应。"
        })
      ])
    );
  });

  it("keeps future phases pending when an existing LP is being regenerated", () => {
    const narrative = buildTaskNarrativeViewModel({
      taskType: "lp_generation",
      payload: {
        artifactProgress: {
          artifactWorkspaceId: "previous_workspace_1",
          changedFileCount: 3,
          fileCount: 3,
          previewVersionKey: "previous_version_1"
        },
        isTerminal: false,
        runs: [
          { runId: "run_builder_version_old", role: "builder", state: "completed" },
          { runId: "run_reviewer_version_old", role: "reviewer", state: "completed" },
          { runId: "run_deployer_version_old", role: "deployer", state: "completed" },
          { runId: "run_planner_brief_new", role: "planner", state: "running" }
        ],
        taskId: "task_1",
        runEvents: [
          {
            id: "event_previous_workspace",
            projectId: "project_1",
            taskId: "task_1",
            runId: "run_builder_version_old",
            type: "artifact.workspace.created",
            createdAt: "2026-05-21T00:00:01.000Z",
            payload: { role: "builder", fileCount: 3 }
          },
          {
            id: "event_new_stream",
            projectId: "project_1",
            taskId: "task_1",
            runId: "run_planner_brief_new",
            type: "model.stream.started",
            createdAt: "2026-05-21T00:01:00.000Z",
            payload: { role: "planner" }
          }
        ]
      }
    });

    expect(narrative?.steps.map((step) => [step.id, step.status])).toEqual([
      ["planner", "running"],
      ["builder", "pending"],
      ["reviewer", "pending"],
      ["deployer", "pending"]
    ]);
  });
});
