import { beforeEach, describe, expect, it, vi } from "vitest";

const pageMocks = vi.hoisted(() => ({
  acceptLanguage: "en",
  currentProjectId: undefined as string | undefined,
  currentTaskId: undefined as string | undefined,
  pageState: {
    kind: "empty",
    projects: [],
    tasks: []
  } as unknown
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "accept-language": pageMocks.acceptLanguage }),
  cookies: async () => ({
    get: (name: string) => {
      if (name === "lp-agent-current-project" && pageMocks.currentProjectId) {
        return { name, value: pageMocks.currentProjectId };
      }

      if (name === "lp-agent-current-task" && pageMocks.currentTaskId) {
        return { name, value: pageMocks.currentTaskId };
      }

      return undefined;
    }
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

function collectElements(node: unknown, type: string): Array<{ props?: Record<string, unknown> }> {
  if (node === null || node === undefined || typeof node === "boolean") {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((child) => collectElements(child, type));
  }
  if (typeof node === "object" && "type" in node && "props" in node) {
    const element = node as { type?: unknown; props?: { children?: unknown } };
    return [
      ...(element.type === type ? [element as { props?: Record<string, unknown> }] : []),
      ...collectElements(element.props?.children, type)
    ];
  }
  return [];
}

beforeEach(() => {
  pageMocks.acceptLanguage = "en";
  pageMocks.currentProjectId = undefined;
  pageMocks.currentTaskId = undefined;
  pageMocks.pageState = {
    kind: "empty",
    projects: [],
    tasks: []
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

  it("renders a conversation-first empty state with an enabled composer", async () => {
    const page = await HomePage({
      searchParams: Promise.resolve({})
    });
    const text = collectText(page);
    const inputs = collectElements(page, "input");

    expect(text).toContain("What can I help you build?");
    expect(text).toContain("Create static LP");
    expect(text).toContain("Plan a campaign");
    expect(text).not.toContain("Start with a local project");
    expect(text).not.toContain("Repository URL");
    expect(
      inputs.some((input) => input.props?.name === "prompt" && input.props?.disabled === true)
    ).toBe(false);
  });

  it("does not expose deployment navigation in the local web flow", async () => {
    const page = await HomePage({
      searchParams: Promise.resolve({})
    });

    expect(collectText(page)).not.toContain("Deployments");
  });

  it("keeps sidebar project creation available when projects exist", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.pageState = {
      kind: "empty",
      projects: [
        {
          id: "project_1",
          name: "Existing LP",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: []
    };

    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const text = collectText(page);
    const inputs = collectElements(page, "input");

    expect(text).toContain("Existing LP");
    expect(text).toContain("Create project");
    expect(inputs.some((input) => input.props?.name === "projectName")).toBe(true);
  });

  it("renders a general task thread without static artifact cards", async () => {
    pageMocks.currentTaskId = "task_1";
    pageMocks.pageState = {
      kind: "task_ready",
      projects: [],
      tasks: [
        {
          id: "task_1",
          title: "Help me write a campaign plan.",
          type: "general_chat",
          status: "complete",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      activeTaskId: "task_1",
      task: {
        id: "task_1",
        title: "Help me write a campaign plan.",
        type: "general_chat",
        status: "complete",
        createdAt: "2026-05-12T08:00:00.000Z"
      },
      messages: [
        {
          id: "message_1",
          taskId: "task_1",
          role: "user",
          content: "Help me write a campaign plan.",
          createdAt: "2026-05-12T08:00:00.000Z"
        },
        {
          id: "message_2",
          taskId: "task_1",
          role: "assistant",
          content: "I created a task thread and can continue from here.",
          createdAt: "2026-05-12T08:00:01.000Z"
        }
      ]
    };

    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const text = collectText(page).join(" ");

    expect(text).toContain("Help me write a campaign plan.");
    expect(text).toContain("I created a task thread and can continue from here.");
    expect(text).toContain("Assistant");
    expect(text).not.toContain("index.single.html");
    expect(text).not.toContain("Static LP preview");
  });

  it("does not show stale LP artifacts for a project-bound general task", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.currentTaskId = "task_2";
    pageMocks.pageState = {
      kind: "task_ready",
      projects: [
        {
          id: "project_1",
          name: "Existing LP",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: [
        {
          id: "task_2",
          title: "Help me write a campaign plan.",
          type: "general_chat",
          status: "complete",
          projectId: "project_1",
          createdAt: "2026-05-12T08:02:00.000Z"
        }
      ],
      activeTaskId: "task_2",
      task: {
        id: "task_2",
        title: "Help me write a campaign plan.",
        type: "general_chat",
        status: "complete",
        projectId: "project_1",
        createdAt: "2026-05-12T08:02:00.000Z"
      },
      messages: [
        {
          id: "message_3",
          taskId: "task_2",
          role: "user",
          content: "Help me write a campaign plan.",
          createdAt: "2026-05-12T08:02:00.000Z"
        },
        {
          id: "message_4",
          taskId: "task_2",
          role: "assistant",
          content: "I created a task thread and can continue from here.",
          createdAt: "2026-05-12T08:02:01.000Z"
        }
      ],
      snapshot: {
        project: {
          id: "project_1",
          name: "Existing LP",
          createdAt: "2026-05-12T08:00:00.000Z"
        },
        brief: {
          id: "brief_1",
          projectId: "project_1",
          prompt: "Create a stale landing page.",
          brief: {
            objective: "Convert paid traffic.",
            audience: "Returning shoppers",
            offer: "Save 25%.",
            primaryCta: "Shop now"
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
              "<main><h1>Stale LP</h1></main>",
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

    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const text = collectText(page).join(" ");

    expect(text).toContain("Help me write a campaign plan.");
    expect(text).toContain("I created a task thread and can continue from here.");
    expect(text).not.toContain("index.single.html");
    expect(text).not.toContain("Static LP preview");
  });

  it("renders a project setup task without a snapshot", async () => {
    pageMocks.currentTaskId = "task_3";
    pageMocks.pageState = {
      kind: "task_ready",
      projects: [],
      tasks: [
        {
          id: "task_3",
          title: "Create project for spring campaign",
          type: "project_setup",
          status: "complete",
          createdAt: "2026-05-12T08:03:00.000Z"
        }
      ],
      activeTaskId: "task_3",
      task: {
        id: "task_3",
        title: "Create project for spring campaign",
        type: "project_setup",
        status: "complete",
        createdAt: "2026-05-12T08:03:00.000Z"
      },
      messages: [
        {
          id: "message_5",
          taskId: "task_3",
          role: "user",
          content: "Create project for spring campaign",
          createdAt: "2026-05-12T08:03:00.000Z"
        },
        {
          id: "message_6",
          taskId: "task_3",
          role: "assistant",
          content: "I created a task thread and can continue from here.",
          createdAt: "2026-05-12T08:03:01.000Z"
        }
      ]
    };

    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const text = collectText(page).join(" ");

    expect(text).toContain("Create project for spring campaign");
    expect(text).toContain("I created a task thread and can continue from here.");
    expect(text).not.toContain("What can I help you build?");
  });

  it("renders completed static artifacts without deployment UI", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.currentTaskId = "task_1";
    pageMocks.pageState = {
      kind: "task_ready",
      projects: [
        {
          id: "project_1",
          name: "Completed LP",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: [
        {
          id: "task_1",
          title: "Create a no git spring ecommerce landing page.",
          type: "lp_generation",
          status: "complete",
          projectId: "project_1",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      activeTaskId: "task_1",
      task: {
        id: "task_1",
        title: "Create a no git spring ecommerce landing page.",
        type: "lp_generation",
        status: "complete",
        projectId: "project_1",
        createdAt: "2026-05-12T08:00:00.000Z"
      },
      messages: [
        {
          id: "message_1",
          taskId: "task_1",
          role: "user",
          content: "Create a no git spring ecommerce landing page.",
          createdAt: "2026-05-12T08:00:00.000Z"
        },
        {
          id: "message_2",
          taskId: "task_1",
          role: "assistant",
          content: "LP artifacts are ready for review.",
          createdAt: "2026-05-12T08:00:01.000Z"
        }
      ],
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
