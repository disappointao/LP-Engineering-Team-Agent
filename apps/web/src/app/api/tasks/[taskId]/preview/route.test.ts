import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentProjectId: vi.fn(),
  getPageState: vi.fn()
}));

vi.mock("../../../../../lib/workbench-store", () => ({
  getWebWorkbenchStore: vi.fn(async () => ({
    getPageState: mocks.getPageState
  }))
}));

vi.mock("../../../../../lib/workbench-session", () => ({
  getCurrentProjectId: mocks.getCurrentProjectId
}));

const artifacts = {
  indexHtml:
    '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><main id="hero">Hero</main><script src="script.js"></script></body></html>',
  stylesCss: "body { color: red; }",
  scriptJs: "window.lpPreviewReady = true;"
};

describe("GET /api/tasks/[taskId]/preview", () => {
  beforeEach(() => {
    mocks.getCurrentProjectId.mockReset();
    mocks.getPageState.mockReset();
    mocks.getCurrentProjectId.mockResolvedValue("project_1");
  });

  it("returns a no-store iframe document for the current LP page version", async () => {
    mocks.getPageState.mockResolvedValue({
      kind: "task_ready",
      snapshot: {
        currentPageVersion: {
          id: "page_1",
          artifacts
        }
      }
    });
    const { GET } = await import("./route");

    const response = await GET(
      new Request("http://localhost/api/tasks/task_1/preview?projectId=project_1"),
      { params: Promise.resolve({ taskId: "task_1" }) }
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("<style>");
    expect(body).toContain("body { color: red; }");
    expect(body).toContain("window.lpPreviewReady = true");
    expect(body).not.toContain('href="styles.css"');
    expect(mocks.getPageState).toHaveBeenCalledWith({
      taskId: "task_1",
      projectId: "project_1"
    });
  });

  it("injects the element inspector bridge only when requested", async () => {
    mocks.getPageState.mockResolvedValue({
      kind: "task_ready",
      snapshot: {
        currentPageVersion: {
          id: "page_1",
          artifacts
        }
      }
    });
    const { GET } = await import("./route");

    const plain = await GET(new Request("http://localhost/api/tasks/task_1/preview"), {
      params: Promise.resolve({ taskId: "task_1" })
    });
    const inspect = await GET(
      new Request("http://localhost/api/tasks/task_1/preview?inspect=1"),
      { params: Promise.resolve({ taskId: "task_1" }) }
    );

    expect(await plain.text()).not.toContain("data-lp-preview-inspector");
    expect(await inspect.text()).toContain("data-lp-preview-inspector");
  });

  it("returns 404 before LP artifacts are available", async () => {
    mocks.getPageState.mockResolvedValue({
      kind: "task_ready",
      snapshot: { currentPageVersion: undefined }
    });
    const { GET } = await import("./route");

    const response = await GET(new Request("http://localhost/api/tasks/task_1/preview"), {
      params: Promise.resolve({ taskId: "task_1" })
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ok: false,
      error: "preview_not_ready"
    });
  });
});
