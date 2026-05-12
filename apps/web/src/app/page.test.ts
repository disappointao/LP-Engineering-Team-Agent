import { beforeEach, describe, expect, it, vi } from "vitest";

const pageMocks = vi.hoisted(() => ({
  acceptLanguage: "en",
  currentProjectId: undefined as string | undefined,
  pageState: {
    kind: "no_project",
    projects: []
  } as unknown
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "accept-language": pageMocks.acceptLanguage }),
  cookies: async () => ({
    get: () =>
      pageMocks.currentProjectId
        ? { name: "lp-agent-current-project", value: pageMocks.currentProjectId }
        : undefined
  })
}));

vi.mock("../lib/workbench-store", () => ({
  getWebWorkbenchStore: vi.fn(() => ({
    getPageState: vi.fn(async () => pageMocks.pageState)
  }))
}));

import HomePage from "./page";

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

beforeEach(() => {
  pageMocks.acceptLanguage = "en";
  pageMocks.currentProjectId = undefined;
  pageMocks.pageState = {
    kind: "no_project",
    projects: []
  };
});

describe("HomePage project flow errors", () => {
  it("renders known project flow errors and ignores unknown values", async () => {
    const knownErrorPage = await HomePage({
      searchParams: Promise.resolve({ error: "project_name_required" })
    });
    const unknownErrorPage = await HomePage({
      searchParams: Promise.resolve({ error: "not_a_real_code" })
    });

    expect(collectText(knownErrorPage)).toContain("Enter a project name.");
    expect(collectText(unknownErrorPage)).not.toContain("Enter a project name.");
  });

  it("does not ask for a repository when creating a local web project", async () => {
    const page = await HomePage({
      searchParams: Promise.resolve({})
    });
    const text = collectText(page);

    expect(text).toContain("Create a project");
    expect(text).not.toContain("Repository URL");
  });

  it("does not expose deployment navigation in the local web flow", async () => {
    const page = await HomePage({
      searchParams: Promise.resolve({})
    });

    expect(collectText(page)).not.toContain("Deployments");
  });

  it("renders completed static artifacts without deployment UI", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.pageState = {
      kind: "project_ready",
      projects: [
        {
          id: "project_1",
          name: "Completed LP",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      activeProjectId: "project_1",
      snapshot: {
        project: {
          id: "project_1",
          name: "Completed LP",
          createdAt: "2026-05-12T08:00:00.000Z"
        },
        brief: {
          id: "brief_1",
          projectId: "project_1",
          prompt: "Create a no git spring ecommerce landing page.",
          brief: {
            objective: "Convert paid traffic into spring campaign purchases.",
            audience: "Returning ecommerce shoppers",
            offer: "Save 25% through Sunday.",
            primaryCta: "Shop the sale"
          },
          createdAt: "2026-05-12T08:00:00.000Z"
        },
        currentPageVersion: {
          id: "version_1",
          projectId: "project_1",
          briefId: "brief_1",
          artifacts: {
            indexHtml: [
              "<!doctype html><html><head>",
              "<link rel=\"stylesheet\" href=\"styles.css\">",
              "</head><body>",
              "<main><h1>Spring essentials</h1></main>",
              "  <script src=\"script.js\"></script>",
              "</body></html>"
            ].join(""),
            stylesCss: "body { color: #111827; }",
            scriptJs: "window.lpAgent = true;"
          },
          reviewStatus: "passed",
          findings: [],
          createdAt: "2026-05-12T08:01:00.000Z"
        },
        deployment: undefined
      }
    };

    const page = await HomePage({
      searchParams: Promise.resolve({})
    });
    const text = collectText(page);
    const spacedText = text.join(" ");
    const tightText = text.join("");

    expect(spacedText).toContain("Agent process");
    expect(tightText).toContain("3/3");
    expect(spacedText).toContain("Task complete");
    expect(spacedText).toContain("Static LP preview");
    expect(spacedText).toContain("index.single.html");
    expect(spacedText).toContain("index.html");
    expect(spacedText).toContain("styles.css");
    expect(spacedText).toContain("script.js");
    expect(spacedText).not.toContain("Prepare a deployment skill command");
    expect(spacedText).not.toContain("deployment-handoff.json");
    expect(spacedText).not.toContain("Deployer");
    expect(spacedText).not.toContain("PR handoff");
    expect(spacedText).not.toContain("Deployments");
    expect(spacedText).not.toContain("Repository URL");
  });
});
