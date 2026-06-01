import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startLiveTaskPrompt: vi.fn(),
  getCurrentProjectId: vi.fn(),
  getCurrentTaskId: vi.fn()
}));

vi.mock("../../../../lib/workbench-store", () => ({
  getWebWorkbenchStore: vi.fn(async () => ({
    startLiveTaskPrompt: mocks.startLiveTaskPrompt
  }))
}));

vi.mock("../../../../lib/workbench-session", () => ({
  CURRENT_PROJECT_COOKIE: "lp-agent-current-project",
  CURRENT_TASK_COOKIE: "lp-agent-current-task",
  getCurrentProjectId: mocks.getCurrentProjectId,
  getCurrentTaskId: mocks.getCurrentTaskId
}));

function getSetCookieHeaderText(response: Response): string {
  const getSetCookie = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.bind(response.headers);
  return getSetCookie ? getSetCookie().join("\n") : response.headers.get("set-cookie") ?? "";
}

describe("POST /api/tasks/submit", () => {
  beforeEach(() => {
    mocks.startLiveTaskPrompt.mockReset();
    mocks.getCurrentProjectId.mockReset();
    mocks.getCurrentTaskId.mockReset();
    mocks.getCurrentProjectId.mockResolvedValue("project_1");
    mocks.getCurrentTaskId.mockResolvedValue("task_old");
  });

  it("starts a live LP task and sets current task cookies", async () => {
    mocks.startLiveTaskPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_lp",
      taskType: "lp_generation",
      projectId: "project_1",
      completion: Promise.resolve({
        ok: true,
        taskId: "task_lp",
        taskType: "lp_generation",
        projectId: "project_1"
      })
    });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/tasks/submit", {
        method: "POST",
        body: JSON.stringify({
          prompt: "Create a live LP",
          implicitProjectName: "Live Project"
        })
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      taskId: "task_lp",
      taskType: "lp_generation",
      projectId: "project_1"
    });
    expect(getSetCookieHeaderText(response)).toContain("lp-agent-current-task=task_lp");
    expect(getSetCookieHeaderText(response)).toContain("lp-agent-current-project=project_1");
    expect(mocks.startLiveTaskPrompt).toHaveBeenCalledWith({
      taskId: "task_old",
      projectId: "project_1",
      prompt: "Create a live LP",
      implicitProjectName: "Live Project"
    });
  });

  it("returns a safe error for invalid JSON", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/tasks/submit", {
        method: "POST",
        body: "{"
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: "generation_failed"
    });
  });

  it("uses request project and task ids instead of session cookies", async () => {
    mocks.startLiveTaskPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_lp",
      taskType: "lp_generation",
      projectId: "project_body",
      completion: Promise.resolve({
        ok: true,
        taskId: "task_lp",
        taskType: "lp_generation",
        projectId: "project_body"
      })
    });
    const { POST } = await import("./route");

    await POST(
      new Request("http://localhost/api/tasks/submit", {
        method: "POST",
        body: JSON.stringify({
          projectId: "project_body",
          taskId: "task_body",
          prompt: "Create a live LP",
          implicitProjectName: "Live Project"
        })
      })
    );

    expect(mocks.startLiveTaskPrompt).toHaveBeenCalledWith({
      taskId: "task_body",
      projectId: "project_body",
      prompt: "Create a live LP",
      implicitProjectName: "Live Project"
    });
  });

  it("passes selected preview element context separately to live LP task submissions", async () => {
    mocks.startLiveTaskPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_lp",
      taskType: "lp_generation",
      projectId: "project_1",
      completion: Promise.resolve({
        ok: true,
        taskId: "task_lp",
        taskType: "lp_generation",
        projectId: "project_1"
      })
    });
    const { POST } = await import("./route");

    await POST(
      new Request("http://localhost/api/tasks/submit", {
        method: "POST",
        body: JSON.stringify({
          projectId: "project_1",
          taskId: "task_lp",
          prompt: "把这个标题改得更高级",
          implicitProjectName: "Live Project",
          selectedElement: {
            selector: "main .hero-title",
            tagName: "h1",
            text: "Preview first",
            outerHTML: "<h1 class=\"hero-title\">Preview first</h1>"
          }
        })
      })
    );

    expect(mocks.startLiveTaskPrompt).toHaveBeenCalledWith({
      taskId: "task_lp",
      projectId: "project_1",
      prompt: "把这个标题改得更高级",
      implicitProjectName: "Live Project",
      selectedElement: {
        selector: "main .hero-title",
        tagName: "h1",
        text: "Preview first",
        outerHTML: "<h1 class=\"hero-title\">Preview first</h1>"
      }
    });
  });

  it("uses null request project and task ids without falling back to session cookies", async () => {
    mocks.startLiveTaskPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_lp",
      taskType: "lp_generation",
      projectId: "project_1",
      completion: Promise.resolve({
        ok: true,
        taskId: "task_lp",
        taskType: "lp_generation",
        projectId: "project_1"
      })
    });
    const { POST } = await import("./route");

    await POST(
      new Request("http://localhost/api/tasks/submit", {
        method: "POST",
        body: JSON.stringify({
          projectId: null,
          taskId: null,
          prompt: "Create a live LP",
          implicitProjectName: "Live Project"
        })
      })
    );

    expect(mocks.startLiveTaskPrompt).toHaveBeenCalledWith({
      taskId: null,
      projectId: null,
      prompt: "Create a live LP",
      implicitProjectName: "Live Project"
    });
  });
});
