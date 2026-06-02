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
    '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><main>Hero</main><script src="script.js"></script></body></html>',
  stylesCss: "body { color: red; }",
  scriptJs: "window.lpExportReady = true;"
};

describe("GET /api/tasks/[taskId]/export", () => {
  beforeEach(() => {
    mocks.getCurrentProjectId.mockReset();
    mocks.getPageState.mockReset();
    mocks.getCurrentProjectId.mockResolvedValue("project_1");
    mocks.getPageState.mockResolvedValue({
      kind: "task_ready",
      snapshot: {
        currentPageVersion: {
          id: "page_1",
          artifacts
        }
      }
    });
  });

  it("downloads the requested split static file on demand", async () => {
    const { GET } = await import("./route");

    const response = await GET(
      new Request("http://localhost/api/tasks/task_1/export?file=styles-css"),
      { params: Promise.resolve({ taskId: "task_1" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toContain("styles.css");
    expect(response.headers.get("content-type")).toContain("text/css");
    expect(await response.text()).toBe(artifacts.stylesCss);
  });

  it("bundles the single HTML export only when requested", async () => {
    const { GET } = await import("./route");

    const response = await GET(
      new Request("http://localhost/api/tasks/task_1/export?file=single-html"),
      { params: Promise.resolve({ taskId: "task_1" }) }
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("index.single.html");
    expect(body).toContain("<style>");
    expect(body).toContain("body { color: red; }");
    expect(body).toContain("window.lpExportReady = true");
    expect(body).not.toContain('href="styles.css"');
  });

  it("packages separated HTML CSS and JS files only when requested", async () => {
    const { GET } = await import("./route");

    const response = await GET(
      new Request("http://localhost/api/tasks/task_1/export?file=split-zip"),
      { params: Promise.resolve({ taskId: "task_1" }) }
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    const body = new TextDecoder().decode(bytes);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("lp-static-files.zip");
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(body).toContain("index.html");
    expect(body).toContain("styles.css");
    expect(body).toContain("script.js");
    expect(body).toContain("<main>Hero</main>");
    expect(body).toContain("window.lpExportReady = true");
  });

  it("rejects unknown export formats", async () => {
    const { GET } = await import("./route");

    const response = await GET(
      new Request("http://localhost/api/tasks/task_1/export?file=archive"),
      { params: Promise.resolve({ taskId: "task_1" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: "unsupported_export"
    });
  });
});
