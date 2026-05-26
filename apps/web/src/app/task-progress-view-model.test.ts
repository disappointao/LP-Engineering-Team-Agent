import { describe, expect, it } from "vitest";
import { buildTaskProgressViewModel } from "./task-progress-view-model";

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
});
