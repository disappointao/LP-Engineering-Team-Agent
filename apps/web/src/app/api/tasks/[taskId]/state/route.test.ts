import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLiveTaskState: vi.fn(),
  getCurrentProjectId: vi.fn()
}));

vi.mock("../../../../../lib/workbench-store", () => ({
  getWebWorkbenchStore: vi.fn(async () => ({
    getLiveTaskState: mocks.getLiveTaskState
  }))
}));

vi.mock("../../../../../lib/workbench-session", () => ({
  getCurrentProjectId: mocks.getCurrentProjectId
}));

describe("GET /api/tasks/[taskId]/state", () => {
  beforeEach(() => {
    mocks.getLiveTaskState.mockReset();
    mocks.getCurrentProjectId.mockReset();
    mocks.getCurrentProjectId.mockResolvedValue("project_1");
  });

  it("returns no-store safe live task state", async () => {
    mocks.getLiveTaskState.mockResolvedValue({
      ok: true,
      value: {
        taskId: "task_1",
        projectId: "project_1",
        taskType: "lp_generation",
        taskStatus: "complete",
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
          heartbeat: { status: "active" },
          logs: []
        },
        interrupt: { state: "interruptible", targets: [] }
      }
    });
    const { GET } = await import("./route");

    const response = await GET(
      new Request("http://localhost/api/tasks/task_1/state?artifactPath=styles.css"),
      { params: Promise.resolve({ taskId: "task_1" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      ok: true,
      value: {
        taskId: "task_1",
        nextPollMs: 1200
      }
    });
    expect(mocks.getLiveTaskState).toHaveBeenCalledWith({
      taskId: "task_1",
      projectId: "project_1",
      artifactPath: "styles.css"
    });
  });

  it("returns stable safe error codes", async () => {
    mocks.getLiveTaskState.mockResolvedValue({ ok: false, error: "task_not_found" });
    const { GET } = await import("./route");

    const response = await GET(
      new Request("http://localhost/api/tasks/missing/state"),
      { params: Promise.resolve({ taskId: "missing" }) }
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ok: false,
      error: "task_not_found"
    });
  });
});
