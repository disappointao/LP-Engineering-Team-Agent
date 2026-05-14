import { beforeEach, describe, expect, it, vi } from "vitest";

const pageMocks = vi.hoisted(() => ({
  acceptLanguage: "en",
  currentProjectId: undefined as string | undefined,
  currentTaskId: undefined as string | undefined,
  pageState: {
    kind: "empty",
    projects: [],
    tasks: [],
    skills: {
      boundSkills: [],
      availableVersions: []
    },
    models: {
      providers: [],
      routes: [],
      resolvedPolicy: {
        planner: { provider: "mock-openai", model: "planning-model" },
        builder: { provider: "mock-anthropic", model: "code-model" },
        reviewer: { provider: "mock-openai", model: "review-model" },
        deployer: { provider: "mock-local", model: "tool-model" }
      }
    },
    mcp: {
      connectors: [],
      approvals: [],
      visibleToolsByRole: {
        planner: [],
        builder: [],
        reviewer: [],
        deployer: []
      }
    }
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

async function renderHomePage({
  searchParams,
  acceptLanguage
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
  acceptLanguage: string;
}): Promise<string> {
  pageMocks.acceptLanguage = acceptLanguage;
  const page = await HomePage({ searchParams });
  return collectText(page).join(" ");
}

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

function projectSkillState(reviewState: "draft" | "validated" | "published", enabled = true) {
  return {
    skill: {
      id: "skill_brand",
      name: "Acme Brand Landing Page Sections",
      type: "template",
      scope: "project",
      createdAt: "2026-05-12T08:00:00.000Z"
    },
    version: {
      id: "skill_version_1",
      skillId: "skill_brand",
      version: "0.1.0",
      manifest: {
        id: "skill_brand",
        name: "Acme Brand Landing Page Sections",
        version: "0.1.0",
        type: "template",
        scope: "project",
        description: "Adds brand tone and ecommerce LP constraints.",
        permissions: ["brief:read"],
        requiredSecrets: [],
        entrypoints: ["templates/acme-lp.md"],
        reviewState
      },
      content: "# Brand LP",
      contentType: "text/markdown",
      reviewState,
      createdAt: "2026-05-12T08:00:00.000Z"
    },
    binding: {
      id: "skill_binding_1",
      skillVersionId: "skill_version_1",
      scope: "project",
      targetKey: "project_1",
      projectId: "project_1",
      enabled,
      createdAt: "2026-05-12T08:01:00.000Z",
      updatedAt: "2026-05-12T08:01:00.000Z"
    }
  };
}

function setActiveEmptyProjectState() {
  pageMocks.currentProjectId = "project_1";
  pageMocks.pageState = {
    kind: "empty",
    projects: [
      {
        id: "project_1",
        name: "Spring Campaign",
        createdAt: "2026-05-12T08:00:00.000Z"
      }
    ],
    tasks: [],
    skills: {
      boundSkills: [],
      availableVersions: []
    },
    models: {
      providers: [],
      routes: [],
      resolvedPolicy: {
        planner: { provider: "mock-openai", model: "planning-model" },
        builder: { provider: "mock-anthropic", model: "code-model" },
        reviewer: { provider: "mock-openai", model: "review-model" },
        deployer: { provider: "mock-local", model: "tool-model" }
      }
    },
    mcp: {
      connectors: [],
      approvals: [],
      visibleToolsByRole: {
        planner: [],
        builder: [],
        reviewer: [],
        deployer: []
      }
    }
  };
}

beforeEach(() => {
  pageMocks.acceptLanguage = "en";
  pageMocks.currentProjectId = undefined;
  pageMocks.currentTaskId = undefined;
  pageMocks.pageState = {
    kind: "empty",
    projects: [],
    tasks: [],
    skills: {
      boundSkills: [],
      availableVersions: []
    },
    models: {
      providers: [],
      routes: [],
      resolvedPolicy: {
        planner: { provider: "mock-openai", model: "planning-model" },
        builder: { provider: "mock-anthropic", model: "code-model" },
        reviewer: { provider: "mock-openai", model: "review-model" },
        deployer: { provider: "mock-local", model: "tool-model" }
      }
    },
    mcp: {
      connectors: [],
      approvals: [],
      visibleToolsByRole: {
        planner: [],
        builder: [],
        reviewer: [],
        deployer: []
      }
    }
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

  it("renders the skills management view from the skills route", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.pageState = {
      kind: "empty",
      projects: [
        {
          id: "project_1",
          name: "Spring Campaign",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: [],
      skills: {
        boundSkills: [],
        availableVersions: []
      }
    };

    const page = await HomePage({
      searchParams: Promise.resolve({ view: "skills" })
    });
    const text = collectText(page);
    const textareas = collectElements(page, "textarea");
    const sections = collectElements(page, "section");

    expect(text).toContain("Project skills");
    expect(text).toContain("Manifest JSON");
    expect(text).toContain("Skill content");
    expect(textareas.some((textarea) => textarea.props?.name === "manifestJson")).toBe(true);
    expect(textareas.some((textarea) => textarea.props?.name === "content")).toBe(true);
    expect(sections.some((section) => section.props?.className === "chatWorkspace" && section.props?.["aria-label"] === "Skills")).toBe(true);
  });

  it("renders the models management view from the models route", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.pageState = {
      kind: "empty",
      projects: [
        {
          id: "project_1",
          name: "Spring Campaign",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: [],
      skills: {
        boundSkills: [],
        availableVersions: []
      },
      models: {
        providers: [],
        routes: [],
        resolvedPolicy: {
          planner: { provider: "mock-openai", model: "planning-model" },
          builder: { provider: "mock-anthropic", model: "code-model" },
          reviewer: { provider: "mock-openai", model: "review-model" },
          deployer: { provider: "mock-local", model: "tool-model" }
        }
      }
    };

    const page = await HomePage({
      searchParams: Promise.resolve({ view: "models" })
    });
    const text = collectText(page);
    const inputs = collectElements(page, "input");
    const selects = collectElements(page, "select");

    expect(text).toContain("Project models");
    expect(text).toContain("Spring Campaign");
    expect(text).toContain("API protocol");
    expect(text).toContain("Anthropic Messages compatible");
    expect(text).toContain("Default model id");
    expect(inputs.some((input) => input.props?.name === "providerId")).toBe(true);
    expect(selects.some((select) => select.props?.name === "provider")).toBe(true);
    expect(text).toContain("mock-anthropic/code-model");
  });

  it("renders the MCP view with localized project context", async () => {
    setActiveEmptyProjectState();

    const html = await renderHomePage({
      searchParams: Promise.resolve({ view: "mcp" }),
      acceptLanguage: "en"
    });

    expect(html).toContain("Project MCP");
    expect(html).toContain("Connector JSON");
    expect(html).toContain("Visible tools");
  });

  it("renders the MCP view in Chinese", async () => {
    setActiveEmptyProjectState();

    const html = await renderHomePage({
      searchParams: Promise.resolve({ view: "mcp" }),
      acceptLanguage: "zh-CN"
    });

    expect(html).toContain("项目 MCP");
    expect(html).toContain("连接器 JSON");
    expect(html).toContain("可见工具");
  });

  it("renders Chinese MCP tool summaries with localized punctuation", async () => {
    pageMocks.pageState = {
      kind: "empty",
      projects: [
        {
          id: "project_1",
          name: "Spring Campaign",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: [],
      skills: {
        boundSkills: [],
        availableVersions: []
      },
      models: {
        providers: [],
        routes: [],
        resolvedPolicy: {
          planner: { provider: "mock-openai", model: "planning-model" },
          builder: { provider: "mock-anthropic", model: "code-model" },
          reviewer: { provider: "mock-openai", model: "review-model" },
          deployer: { provider: "mock-local", model: "tool-model" }
        }
      },
      mcp: {
        connectors: [
          {
            id: "connector_assets",
            scope: "project",
            targetKey: "project_1",
            projectId: "project_1",
            name: "内部素材",
            description: "读取已批准的素材元数据。",
            tools: [
              {
                name: "searchAssets",
                description: "搜索已批准的品牌素材。",
                permission: "assets:read",
                roles: ["planner", "builder"],
                requiresApproval: false
              }
            ],
            enabled: true,
            createdAt: "2026-05-12T08:00:00.000Z",
            updatedAt: "2026-05-12T08:00:00.000Z"
          }
        ],
        approvals: [],
        visibleToolsByRole: {
          planner: [],
          builder: [],
          reviewer: [],
          deployer: []
        }
      }
    };
    pageMocks.currentProjectId = "project_1";

    const html = await renderHomePage({
      searchParams: Promise.resolve({ view: "mcp" }),
      acceptLanguage: "zh-CN"
    });

    expect(html).toContain("权限：assets:read");
    expect(html).toContain("角色：规划员、构建员");
    expect(html).not.toContain("权限: assets:read");
    expect(html).not.toContain("角色：规划员, 构建员");
  });

  it("renders the MCP view when a persisted connector has malformed tool roles", async () => {
    pageMocks.pageState = {
      kind: "empty",
      projects: [
        {
          id: "project_1",
          name: "Spring Campaign",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: [],
      skills: {
        boundSkills: [],
        availableVersions: []
      },
      models: {
        providers: [],
        routes: [],
        resolvedPolicy: {
          planner: { provider: "mock-openai", model: "planning-model" },
          builder: { provider: "mock-anthropic", model: "code-model" },
          reviewer: { provider: "mock-openai", model: "review-model" },
          deployer: { provider: "mock-local", model: "tool-model" }
        }
      },
      mcp: {
        connectors: [
          {
            id: "connector_broken",
            scope: "project",
            targetKey: "project_1",
            name: "Broken Connector",
            tools: [
              {
                name: "brokenTool",
                permission: "assets:read",
                requiresApproval: false
              }
            ],
            enabled: true,
            createdAt: "2026-05-12T08:00:00.000Z",
            updatedAt: "2026-05-12T08:00:00.000Z"
          }
        ],
        approvals: [],
        visibleToolsByRole: {
          planner: [],
          builder: [],
          reviewer: [],
          deployer: []
        }
      }
    };
    pageMocks.currentProjectId = "project_1";

    const html = await renderHomePage({
      searchParams: Promise.resolve({ view: "mcp" }),
      acceptLanguage: "en"
    });

    expect(html).toContain("Broken Connector");
    expect(html).toContain("brokenTool");
  });

  it("renders the MCP view when a persisted connector has malformed scalar fields", async () => {
    pageMocks.pageState = {
      kind: "empty",
      projects: [
        {
          id: "project_1",
          name: "Spring Campaign",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: [],
      skills: {
        boundSkills: [],
        availableVersions: []
      },
      models: {
        providers: [],
        routes: [],
        resolvedPolicy: {
          planner: { provider: "mock-openai", model: "planning-model" },
          builder: { provider: "mock-anthropic", model: "code-model" },
          reviewer: { provider: "mock-openai", model: "review-model" },
          deployer: { provider: "mock-local", model: "tool-model" }
        }
      },
      mcp: {
        connectors: [
          {
            id: { value: "connector_broken" },
            scope: "project",
            targetKey: "project_1",
            name: { value: "Broken Connector" },
            tools: [],
            enabled: "false",
            createdAt: "2026-05-12T08:00:00.000Z",
            updatedAt: "2026-05-12T08:00:00.000Z"
          }
        ],
        approvals: [],
        visibleToolsByRole: {
          planner: [],
          builder: [],
          reviewer: [],
          deployer: []
        }
      }
    };
    pageMocks.currentProjectId = "project_1";

    const html = await renderHomePage({
      searchParams: Promise.resolve({ view: "mcp" }),
      acceptLanguage: "en"
    });

    expect(html).toContain("Project MCP");
    expect(html).toContain("connector_invalid");
    expect(html).toContain("Invalid connector");
  });

  it("marks the MCP nav link active from the mcp route", async () => {
    const page = await HomePage({
      searchParams: Promise.resolve({ view: "mcp" })
    });
    const links = collectElements(page, "a");

    expect(
      links.some(
        (link) =>
          link.props?.href === "/?view=mcp" &&
          link.props?.className === "navItem navItemActive" &&
          collectText(link.props?.children).join("") === "MCP"
      )
    ).toBe(true);
  });

  it("renders localized MCP flow errors", async () => {
    const html = await renderHomePage({
      searchParams: Promise.resolve({ view: "mcp", mcpError: "mcp_connector_json_invalid" }),
      acceptLanguage: "zh-CN"
    });

    expect(html).toContain("请输入有效的连接器 JSON。");
  });

  it("keeps the workbench page from rendering MCP forms", async () => {
    const page = await HomePage({
      searchParams: Promise.resolve({})
    });
    const text = collectText(page);
    const textareas = collectElements(page, "textarea");

    expect(text).toContain("What can I help you build?");
    expect(text).not.toContain("Project MCP");
    expect(textareas.some((textarea) => textarea.props?.name === "definitionJson")).toBe(false);
  });

  it("does not render model configuration forms without an active project", async () => {
    const page = await HomePage({
      searchParams: Promise.resolve({ view: "models" })
    });
    const text = collectText(page);
    const inputs = collectElements(page, "input");

    expect(text).toContain("No active project");
    expect(inputs.some((input) => input.props?.name === "providerId")).toBe(false);
    expect(text).not.toContain("What can I help you build?");
  });

  it("renders saved model providers and route forms", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.pageState = {
      kind: "empty",
      projects: [
        {
          id: "project_1",
          name: "Spring Campaign",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: [],
      skills: {
        boundSkills: [],
        availableVersions: []
      },
      models: {
        providers: [
          {
            id: "provider_openai",
            scope: "project",
            targetKey: "project_1",
            name: "OpenAI",
            provider: "openai",
            config: {
              api: "anthropic-messages",
              apiKeyEnv: "OPENAI_API_KEY",
              baseUrl: "https://api.openai.com/v1"
            },
            enabled: true,
            createdAt: "2026-05-12T08:00:00.000Z",
            updatedAt: "2026-05-12T08:00:00.000Z"
          }
        ],
        routes: [
          {
            id: "model_route_1",
            scope: "project",
            targetKey: "project_1",
            role: "builder",
            providerId: "provider_openai",
            model: "gpt-5.4",
            createdAt: "2026-05-12T08:00:00.000Z",
            updatedAt: "2026-05-12T08:00:00.000Z"
          }
        ],
        resolvedPolicy: {
          planner: { provider: "mock-openai", model: "planning-model" },
          builder: { provider: "provider_openai", model: "gpt-5.4" },
          reviewer: { provider: "mock-openai", model: "review-model" },
          deployer: { provider: "mock-local", model: "tool-model" }
        }
      }
    };

    const page = await HomePage({
      searchParams: Promise.resolve({ view: "models" })
    });
    const text = collectText(page).join(" ");

    expect(text).toContain("OpenAI");
    expect(text).toContain("anthropic-messages");
    expect(text).toContain("Base URL configured");
    expect(text).toContain("API key env configured");
    expect(text).toContain("provider_openai/gpt-5.4");
    expect(text).toContain("Builder");
  });

  it("shows the builder model route signal in the workbench top bar", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.pageState = {
      kind: "empty",
      projects: [
        {
          id: "project_1",
          name: "Spring Campaign",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: [],
      skills: {
        boundSkills: [],
        availableVersions: []
      },
      models: {
        providers: [],
        routes: [],
        resolvedPolicy: {
          planner: { provider: "mock-openai", model: "planning-model" },
          builder: { provider: "provider_openai", model: "gpt-5.4" },
          reviewer: { provider: "mock-openai", model: "review-model" },
          deployer: { provider: "mock-local", model: "tool-model" }
        }
      }
    };

    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const text = collectText(page).join(" ");

    expect(text).toContain("Builder model: provider_openai/gpt-5.4");
  });

  it("shows recoverable model resolution errors in the models view without the composer", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.pageState = {
      kind: "empty",
      projects: [
        {
          id: "project_1",
          name: "Spring Campaign",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: [],
      skills: {
        boundSkills: [],
        availableVersions: []
      },
      models: {
        providers: [],
        routes: [
          {
            id: "model_route_1",
            scope: "project",
            targetKey: "project_1",
            role: "builder",
            providerId: "provider_missing",
            model: "gpt-5.4",
            createdAt: "2026-05-12T08:00:00.000Z",
            updatedAt: "2026-05-12T08:00:00.000Z"
          }
        ],
        resolvedPolicy: {
          planner: { provider: "mock-openai", model: "planning-model" },
          builder: { provider: "mock-anthropic", model: "code-model" },
          reviewer: { provider: "mock-openai", model: "review-model" },
          deployer: { provider: "mock-local", model: "tool-model" }
        },
        resolutionError: "model_route_provider_invalid"
      }
    };

    const page = await HomePage({
      searchParams: Promise.resolve({ view: "models" })
    });
    const text = collectText(page);
    const inputs = collectElements(page, "input");

    expect(text).toContain("The route points to an unavailable provider.");
    expect(inputs.some((input) => input.props?.name === "prompt")).toBe(false);
  });

  it("shows provider protocol model errors from the query string", async () => {
    setActiveEmptyProjectState();

    const page = await HomePage({
      searchParams: Promise.resolve({
        view: "models",
        modelError: "model_provider_api_required"
      })
    });
    const text = collectText(page);

    expect(text).toContain("Choose a provider API protocol.");
  });

  it("uses the active task project as the models project context and submits it in forms", async () => {
    pageMocks.pageState = {
      kind: "task_ready",
      projects: [
        {
          id: "project_1",
          name: "Task Project",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: [
        {
          id: "task_1",
          title: "Create a project-bound landing page",
          type: "lp_generation",
          status: "complete",
          projectId: "project_1",
          createdAt: "2026-05-12T08:02:00.000Z"
        }
      ],
      skills: {
        boundSkills: [],
        availableVersions: []
      },
      models: {
        providers: [
          {
            id: "provider_openai",
            scope: "project",
            targetKey: "project_1",
            name: "OpenAI",
            provider: "openai",
            config: { secretEnvName: "OPENAI_API_KEY" },
            enabled: true,
            createdAt: "2026-05-12T08:00:00.000Z",
            updatedAt: "2026-05-12T08:00:00.000Z"
          }
        ],
        routes: [],
        resolvedPolicy: {
          planner: { provider: "mock-openai", model: "planning-model" },
          builder: { provider: "mock-anthropic", model: "code-model" },
          reviewer: { provider: "mock-openai", model: "review-model" },
          deployer: { provider: "mock-local", model: "tool-model" }
        }
      },
      activeTaskId: "task_1",
      task: {
        id: "task_1",
        title: "Create a project-bound landing page",
        type: "lp_generation",
        status: "complete",
        projectId: "project_1",
        createdAt: "2026-05-12T08:02:00.000Z"
      },
      messages: []
    };

    const page = await HomePage({
      searchParams: Promise.resolve({ view: "models" })
    });
    const text = collectText(page);
    const inputs = collectElements(page, "input");

    expect(text).toContain("Task Project");
    expect(inputs.some((input) => input.props?.name === "providerId")).toBe(true);
    expect(
      inputs.some(
        (input) =>
          input.props?.name === "projectId" &&
          input.props?.type === "hidden" &&
          input.props?.value === "project_1"
      )
    ).toBe(true);
  });

  it("requires a route provider and disables fallback submission placeholders", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.pageState = {
      kind: "empty",
      projects: [
        {
          id: "project_1",
          name: "Spring Campaign",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: [],
      skills: {
        boundSkills: [],
        availableVersions: []
      },
      models: {
        providers: [
          {
            id: "provider_openai",
            scope: "project",
            targetKey: "project_1",
            name: "OpenAI",
            provider: "openai",
            config: { secretEnvName: "OPENAI_API_KEY" },
            enabled: false,
            createdAt: "2026-05-12T08:00:00.000Z",
            updatedAt: "2026-05-12T08:00:00.000Z"
          }
        ],
        routes: [],
        resolvedPolicy: {
          planner: { provider: "mock-openai", model: "planning-model" },
          builder: { provider: "mock-anthropic", model: "code-model" },
          reviewer: { provider: "mock-openai", model: "review-model" },
          deployer: { provider: "mock-local", model: "tool-model" }
        }
      }
    };

    const page = await HomePage({
      searchParams: Promise.resolve({ view: "models" })
    });
    const routeProviderSelects = collectElements(page, "select").filter(
      (select) => select.props?.name === "providerId"
    );
    const fallbackOptions = collectElements(page, "option").filter(
      (option) => option.props?.value === ""
    );
    const saveRouteButtons = collectElements(page, "button").filter(
      (button) => collectText(button.props?.children).join("") === "Save route"
    );

    expect(routeProviderSelects).toHaveLength(4);
    expect(routeProviderSelects.every((select) => select.props?.required === true)).toBe(true);
    expect(fallbackOptions).toHaveLength(4);
    expect(fallbackOptions.every((option) => option.props?.disabled === true)).toBe(true);
    expect(saveRouteButtons).toHaveLength(4);
    expect(saveRouteButtons.every((button) => button.props?.disabled === true)).toBe(true);
  });

  it("does not render skill creation controls or the workbench composer without an active project", async () => {
    const page = await HomePage({
      searchParams: Promise.resolve({ view: "skills" })
    });
    const text = collectText(page);
    const textareas = collectElements(page, "textarea");
    const inputs = collectElements(page, "input");

    expect(text).toContain("No active project");
    expect(textareas.some((textarea) => textarea.props?.name === "manifestJson")).toBe(false);
    expect(textareas.some((textarea) => textarea.props?.name === "content")).toBe(false);
    expect(inputs.some((input) => input.props?.name === "prompt")).toBe(false);
  });

  it("uses the active task project as the skills project context without a project cookie", async () => {
    pageMocks.pageState = {
      kind: "task_ready",
      projects: [
        {
          id: "project_1",
          name: "Task Project",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: [
        {
          id: "task_1",
          title: "Create a project-bound landing page",
          type: "lp_generation",
          status: "complete",
          projectId: "project_1",
          createdAt: "2026-05-12T08:02:00.000Z"
        }
      ],
      skills: {
        boundSkills: [],
        availableVersions: []
      },
      activeTaskId: "task_1",
      task: {
        id: "task_1",
        title: "Create a project-bound landing page",
        type: "lp_generation",
        status: "complete",
        projectId: "project_1",
        createdAt: "2026-05-12T08:02:00.000Z"
      },
      messages: [
        {
          id: "message_1",
          taskId: "task_1",
          role: "user",
          content: "Create a project-bound landing page",
          createdAt: "2026-05-12T08:02:00.000Z"
        }
      ]
    };

    const page = await HomePage({
      searchParams: Promise.resolve({ view: "skills" })
    });
    const text = collectText(page);
    const textareas = collectElements(page, "textarea");
    const inputs = collectElements(page, "input");

    expect(text).toContain("Task Project");
    expect(text).not.toContain("No active project");
    expect(textareas.some((textarea) => textarea.props?.name === "manifestJson")).toBe(true);
    expect(textareas.some((textarea) => textarea.props?.name === "content")).toBe(true);
    expect(inputs.some((input) => input.props?.name === "contentFile")).toBe(true);
  });

  it("shows active bound project skills in the skills view", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.pageState = {
      kind: "empty",
      projects: [
        {
          id: "project_1",
          name: "Spring Campaign",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: [],
      skills: {
        boundSkills: [
          {
            skill: {
              id: "skill_brand",
              name: "Acme Brand Landing Page Sections",
              type: "template",
              scope: "project",
              createdAt: "2026-05-12T08:00:00.000Z"
            },
            version: {
              id: "skill_version_1",
              skillId: "skill_brand",
              version: "0.1.0",
              manifest: {
                id: "skill_brand",
                name: "Acme Brand Landing Page Sections",
                version: "0.1.0",
                type: "template",
                scope: "project",
                description: "Adds brand tone and ecommerce LP constraints.",
                permissions: ["brief:read"],
                requiredSecrets: [],
                entrypoints: ["templates/acme-lp.md"],
                reviewState: "published"
              },
              content: "# Brand LP",
              contentType: "text/markdown",
              reviewState: "published",
              createdAt: "2026-05-12T08:00:00.000Z"
            },
            binding: {
              id: "skill_binding_1",
              skillVersionId: "skill_version_1",
              scope: "project",
              targetKey: "project_1",
              projectId: "project_1",
              enabled: true,
              createdAt: "2026-05-12T08:01:00.000Z",
              updatedAt: "2026-05-12T08:01:00.000Z"
            }
          }
        ],
        availableVersions: []
      }
    };

    const page = await HomePage({
      searchParams: Promise.resolve({ view: "skills" })
    });
    const text = collectText(page).join(" ");

    expect(text).toContain("Acme Brand Landing Page Sections");
    expect(text).toContain("Published");
    expect(text).toContain("1 active skill");
  });

  it("shows the active bound skill count in the workbench shell", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.pageState = {
      kind: "empty",
      projects: [
        {
          id: "project_1",
          name: "Spring Campaign",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: [],
      skills: {
        boundSkills: [
          {
            skill: {
              id: "skill_brand",
              name: "Acme Brand Landing Page Sections",
              type: "template",
              scope: "project",
              createdAt: "2026-05-12T08:00:00.000Z"
            },
            version: {
              id: "skill_version_1",
              skillId: "skill_brand",
              version: "0.1.0",
              manifest: {
                id: "skill_brand",
                name: "Acme Brand Landing Page Sections",
                version: "0.1.0",
                type: "template",
                scope: "project",
                description: "Adds brand tone and ecommerce LP constraints.",
                permissions: ["brief:read"],
                requiredSecrets: [],
                entrypoints: ["templates/acme-lp.md"],
                reviewState: "published"
              },
              content: "# Brand LP",
              contentType: "text/markdown",
              reviewState: "published",
              createdAt: "2026-05-12T08:00:00.000Z"
            },
            binding: {
              id: "skill_binding_1",
              skillVersionId: "skill_version_1",
              scope: "project",
              targetKey: "project_1",
              projectId: "project_1",
              enabled: true,
              createdAt: "2026-05-12T08:01:00.000Z",
              updatedAt: "2026-05-12T08:01:00.000Z"
            }
          }
        ],
        availableVersions: []
      }
    };

    const page = await HomePage({
      searchParams: Promise.resolve({})
    });

    expect(collectText(page)).toContain("1 active skill");
  });

  it("does not count enabled unpublished bound skills as active", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.pageState = {
      kind: "empty",
      projects: [
        {
          id: "project_1",
          name: "Spring Campaign",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: [],
      skills: {
        boundSkills: [projectSkillState("validated")],
        availableVersions: []
      }
    };

    const page = await HomePage({
      searchParams: Promise.resolve({ view: "skills" })
    });
    const text = collectText(page);

    expect(text).toContain("0 active skills");
    expect(text).not.toContain("1 active skill");
  });

  it("only renders publish actions for validated skill versions", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.pageState = {
      kind: "empty",
      projects: [
        {
          id: "project_1",
          name: "Spring Campaign",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: [],
      skills: {
        boundSkills: [],
        availableVersions: [
          {
            ...projectSkillState("validated").version,
            id: "skill_version_validated"
          }
        ]
      }
    };

    const page = await HomePage({
      searchParams: Promise.resolve({ view: "skills" })
    });
    const text = collectText(page);

    expect(text).toContain("Publish");
    expect(text).not.toContain("Validate");
    expect(text).not.toContain("Bind");
  });

  it("only renders bind actions for published skill versions", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.pageState = {
      kind: "empty",
      projects: [
        {
          id: "project_1",
          name: "Spring Campaign",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: [],
      skills: {
        boundSkills: [],
        availableVersions: [
          {
            ...projectSkillState("published").version,
            id: "skill_version_published"
          }
        ]
      }
    };

    const page = await HomePage({
      searchParams: Promise.resolve({ view: "skills" })
    });
    const text = collectText(page);

    expect(text).toContain("Bind");
    expect(text).not.toContain("Validate");
    expect(text).not.toContain("Publish");
  });

  it("does not render bind for a published skill version already bound to the project", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.pageState = {
      kind: "empty",
      projects: [
        {
          id: "project_1",
          name: "Spring Campaign",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: [],
      skills: {
        boundSkills: [projectSkillState("published")],
        availableVersions: [
          {
            ...projectSkillState("published").version,
            id: "skill_version_1"
          }
        ]
      }
    };

    const page = await HomePage({
      searchParams: Promise.resolve({ view: "skills" })
    });
    const text = collectText(page);

    expect(text).toContain("Disable");
    expect(text).not.toContain("Bind");
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
      tasks: [],
      skills: {
        boundSkills: [],
        availableVersions: []
      }
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
      skills: {
        boundSkills: [],
        availableVersions: []
      },
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
      skills: {
        boundSkills: [],
        availableVersions: []
      },
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
      skills: {
        boundSkills: [],
        availableVersions: []
      },
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
      skills: {
        boundSkills: [],
        availableVersions: []
      },
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
