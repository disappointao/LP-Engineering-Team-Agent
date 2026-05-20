import { beforeEach, describe, expect, it, vi } from "vitest";

const pageMocks = vi.hoisted(() => ({
  acceptLanguage: "en",
  currentProjectId: undefined as string | undefined,
  currentTaskId: undefined as string | undefined,
  getPageStateMock: vi.fn(),
  pageState: {
    kind: "empty",
    projects: [],
    projectMembers: [],
    tasks: [],
    skills: {
      boundSkills: [],
      availableVersions: []
    },
    skillCommands: [],
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
    },
    workerQueue: {
      projectId: "",
      counts: {
        queued: 0,
        running: 0,
        stale: 0,
        completed: 0,
        failed: 0,
        rejected: 0,
        cancelled: 0
      },
      heartbeat: {
        status: "unknown"
      },
      logs: []
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
    getPageState: pageMocks.getPageStateMock.mockImplementation(async () => pageMocks.pageState)
  }))
}));

vi.mock("react-dom", () => ({
  useFormStatus: vi.fn(() => ({
    pending: false,
    data: null,
    method: null,
    action: null
  }))
}));

import HomePage from "./page";
import {
  executeRunRecoveryAction,
  executeSkillCommandAction,
  runLocalWorkerOnceAction
} from "./actions";

async function renderHomePage({
  searchParams,
  acceptLanguage
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
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
    if (typeof element.type === "function" && element.type.name === "InterruptSubmitButton") {
      return collectElements(
        (element.type as (props: Record<string, unknown>) => unknown)(
          element.props as Record<string, unknown>
        ),
        type
      );
    }
    return [
      ...(element.type === type ? [element as { props?: Record<string, unknown> }] : []),
      ...collectElements(element.props?.children, type)
    ];
  }
  return [];
}

function collectFormPayload(form: { props?: Record<string, unknown> }): Record<string, unknown> {
  return Object.fromEntries(
    collectElements(form.props?.children, "input").map((input) => [
      input.props?.name,
      input.props?.value
    ])
  );
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

const localOwnerMember = {
  id: "project_member_project_1_local-web-user",
  projectId: "project_1",
  userId: "local-web-user",
  role: "owner",
  displayName: "Local user",
  createdAt: "2026-05-17T00:00:00.000Z",
  updatedAt: "2026-05-17T00:00:00.000Z"
};

const publishedProjectSkill = projectSkillState("published");
const unavailableInterrupt = {
  available: false,
  state: "not_interruptible"
};

const emptyWorkerQueue = {
  projectId: "",
  counts: {
    queued: 0,
    running: 0,
    stale: 0,
    completed: 0,
    failed: 0,
    rejected: 0,
    cancelled: 0
  },
  heartbeat: {
    status: "unknown"
  },
  logs: []
};

function createCompletedLpPageState(overrides: Record<string, unknown> = {}) {
  return {
    kind: "task_ready",
    projects: [
      {
        id: "project_1",
        name: "Completed LP",
        createdAt: "2026-05-12T08:00:00.000Z"
      }
    ],
    projectMembers: [],
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
    skillCommands: [],
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
    },
    workerQueue: emptyWorkerQueue,
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
    runEvents: [],
    interrupt: unavailableInterrupt,
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
        artifactWorkspaceId: "artifact_workspace_1",
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
    },
    ...overrides
  };
}

const deploymentBoundSkill = {
  ...publishedProjectSkill,
  skill: {
    ...publishedProjectSkill.skill,
    id: "skill_static_deploy",
    name: "Static deploy",
    type: "deployment"
  },
  version: {
    ...publishedProjectSkill.version,
    id: "skill_version_deploy",
    skillId: "skill_static_deploy",
    manifest: {
      ...publishedProjectSkill.version.manifest,
      id: "skill_static_deploy",
      name: "Static deploy",
      type: "deployment",
      permissions: ["deploy:simulate"],
      commands: [
        {
          id: "publish_static",
          name: "Publish static",
          description: "Simulate publishing generated static files.",
          permission: "deploy:simulate",
          requiresApproval: true,
          command: "static-deploy",
          args: ["--project", "{{projectId}}"]
        }
      ],
      reviewState: "published"
    }
  }
};

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
    projectMembers: [localOwnerMember],
    tasks: [],
    skills: {
      boundSkills: [],
      availableVersions: []
    },
    skillCommands: [],
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
    },
    workerQueue: emptyWorkerQueue
  };
}

beforeEach(() => {
  pageMocks.acceptLanguage = "en";
  pageMocks.currentProjectId = undefined;
  pageMocks.currentTaskId = undefined;
  pageMocks.getPageStateMock.mockReset();
  pageMocks.pageState = {
    kind: "empty",
    projects: [],
    projectMembers: [],
    tasks: [],
    skills: {
      boundSkills: [],
      availableVersions: []
    },
    skillCommands: [],
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
    },
    workerQueue: emptyWorkerQueue
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

  it("renders an enabled interrupt button for interruptible task state", async () => {
    pageMocks.currentTaskId = "task_1";
    pageMocks.pageState = {
      ...(pageMocks.pageState as Record<string, unknown>),
      kind: "task_ready",
      activeTaskId: "task_1",
      task: {
        id: "task_1",
        title: "Interruptible task",
        type: "general_chat",
        status: "complete",
        createdAt: "2026-05-18T00:00:00.000Z"
      },
      messages: [
        {
          id: "message_1",
          taskId: "task_1",
          role: "user",
          content: "Run something",
          createdAt: "2026-05-18T00:00:00.000Z"
        },
        {
          id: "message_2",
          taskId: "task_1",
          role: "assistant",
          content: "Working",
          createdAt: "2026-05-18T00:00:01.000Z"
        }
      ],
      runEvents: [],
      interrupt: {
        available: true,
        state: "idle",
        runId: "run_interrupt_1",
        workerJobId: "worker_job_1"
      }
    };

    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const buttons = collectElements(page, "button");
    const interruptButton = buttons.find((button) =>
      collectText(button).includes("Interrupt")
    );

    expect(interruptButton?.props?.disabled).toBe(false);
  });

  it("renders a persisted stopping interrupt button as disabled and busy", async () => {
    pageMocks.currentTaskId = "task_1";
    pageMocks.pageState = {
      ...(pageMocks.pageState as Record<string, unknown>),
      kind: "task_ready",
      activeTaskId: "task_1",
      task: {
        id: "task_1",
        title: "Interruptible task",
        type: "general_chat",
        status: "complete",
        createdAt: "2026-05-18T00:00:00.000Z"
      },
      messages: [
        {
          id: "message_1",
          taskId: "task_1",
          role: "user",
          content: "Run something",
          createdAt: "2026-05-18T00:00:00.000Z"
        },
        {
          id: "message_2",
          taskId: "task_1",
          role: "assistant",
          content: "Stopping",
          createdAt: "2026-05-18T00:00:01.000Z"
        }
      ],
      runEvents: [],
      interrupt: {
        available: true,
        state: "stopping",
        runId: "run_interrupt_1",
        workerJobId: "worker_job_1",
        requestedAt: "2026-05-18T00:00:02.000Z"
      }
    };

    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const buttons = collectElements(page, "button");
    const interruptButton = buttons.find((button) =>
      collectText(button).includes("Stopping...")
    );

    expect(interruptButton?.props?.disabled).toBe(true);
    expect(interruptButton?.props?.["aria-busy"]).toBe(true);
  });

  it("renders localized interrupt errors", async () => {
    const html = await renderHomePage({
      searchParams: Promise.resolve({ interruptError: "task_not_found" }),
      acceptLanguage: "zh-CN,zh;q=0.9"
    });

    expect(html).toContain("当前没有可打断的任务。");
  });

  it("renders recovery errors in the empty workbench state", async () => {
    const html = await renderHomePage({
      searchParams: Promise.resolve({ recoveryError: "task_not_found" }),
      acceptLanguage: "en"
    });

    expect(html).toContain("Recovery action could not be completed.");
  });

  it("renders inline recovery actions without raw diagnostics", async () => {
    pageMocks.currentTaskId = "task_1";
    pageMocks.pageState = createCompletedLpPageState({
      recovery: {
        runs: [
          {
            runId: "run_planner_failed",
            projectId: "project_1",
            taskId: "task_1",
            role: "planner",
            state: "failed",
            runRecordState: "failed",
            startedAt: "2026-05-20T00:00:00.000Z",
            completedAt: "2026-05-20T00:00:05.000Z",
            terminalEventType: "run.failed",
            diagnosticSummary: {
              code: "planner_failed",
              message: "Planner stopped before producing a brief.",
              source: "run_event",
              eventType: "run.failed",
              errorName: "planner_failed",
              rawPayload: "secret-token"
            },
            recoveryActions: ["retry_run", "resolve_blocker"]
          },
          {
            runId: "run_worker_finalize",
            projectId: "project_1",
            taskId: "task_1",
            role: "deployer",
            state: "failed",
            runRecordState: "running",
            startedAt: "2026-05-20T00:00:10.000Z",
            terminalEventType: "worker.job.completed",
            diagnosticSummary: {
              code: "worker_finalization_pending",
              message: "Worker completed but the run was not finalized.",
              source: "worker_job"
            },
            recoveryActions: ["resume_worker_finalization"]
          }
        ]
      }
    });

    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const text = collectText(page).join(" ");
    const recoveryForms = collectElements(page, "form").filter(
      (form) => form.props?.action === executeRunRecoveryAction
    );

    expect(text).toContain("Run recovery");
    expect(text).toContain("Planner");
    expect(text).toContain("Failed");
    expect(text).toContain("Retry run");
    expect(text).toContain("Resume finalization");
    expect(text).toContain("Resolve blocker");
    expect(text).toContain("Planner stopped before producing a brief.");
    expect(text).toContain("planner_failed");
    expect(text).not.toContain("secret-token");
    expect(recoveryForms.map(collectFormPayload)).toEqual([
      {
        taskId: "task_1",
        runId: "run_planner_failed",
        action: "retry_run"
      },
      {
        taskId: "task_1",
        runId: "run_worker_finalize",
        action: "resume_worker_finalization"
      }
    ]);
  });

  it("renders cancelled, blocked, and worker finalization recovery rows safely", async () => {
    pageMocks.currentTaskId = "task_1";
    pageMocks.pageState = createCompletedLpPageState({
      recovery: {
        runs: [
          {
            runId: "run_cancelled_1",
            projectId: "project_1",
            taskId: "task_1",
            role: "builder",
            state: "cancelled",
            runRecordState: "cancelled",
            startedAt: "2026-05-20T00:00:01.000Z",
            completedAt: "2026-05-20T00:00:02.000Z",
            terminalEventType: "run.cancelled",
            recoveryActions: []
          },
          {
            runId: "run_blocked_1",
            projectId: "project_1",
            taskId: "task_1",
            role: "reviewer",
            state: "blocked",
            runRecordState: "needs_input",
            startedAt: "2026-05-20T00:00:03.000Z",
            diagnosticSummary: {
              code: "handoff_blocked",
              message: "Run is blocked by an inbound handoff.",
              source: "handoff"
            },
            recoveryActions: ["resolve_blocker"]
          },
          {
            runId: "run_worker_gap_1",
            projectId: "project_1",
            taskId: "task_1",
            role: "deployer",
            state: "failed",
            runRecordState: "running",
            startedAt: "2026-05-20T00:00:04.000Z",
            linkedWorkerJobId: "worker_job_1",
            diagnosticSummary: {
              code: "worker_finalization_incomplete",
              message: "Worker job completed but run finalization is incomplete.",
              source: "lifecycle",
              eventType: "worker.job.linked",
              errorName: "RAW_STDOUT_SECRET"
            },
            recoveryActions: ["resume_worker_finalization"]
          }
        ]
      }
    });

    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const visibleText = collectText(page).join(" ");
    const recoveryForms = collectElements(page, "form").filter(
      (form) => form.props?.action === executeRunRecoveryAction
    );

    expect(visibleText).toContain("Stopped");
    expect(visibleText).toContain("Resolve blocker");
    expect(visibleText).toContain("Resume finalization");
    expect(visibleText).toContain("Run is blocked by an inbound handoff.");
    expect(visibleText).not.toContain("RAW_STDOUT_SECRET");
    expect(recoveryForms.map(collectFormPayload)).toEqual([
      {
        taskId: "task_1",
        runId: "run_worker_gap_1",
        action: "resume_worker_finalization"
      }
    ]);
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

  it("renders localized skill command errors", async () => {
    setActiveEmptyProjectState();

    const html = await renderHomePage({
      searchParams: Promise.resolve({
        view: "skills",
        skillError: "skill_command_not_bound"
      }),
      acceptLanguage: "zh-CN"
    });

    expect(html).toContain("该技能命令未绑定到当前项目。");
  });

  it("renders a visible error for non-queueable skill commands", async () => {
    setActiveEmptyProjectState();

    const html = await renderHomePage({
      searchParams: Promise.resolve({
        view: "skills",
        skillError: "skill_command_not_queueable"
      }),
      acceptLanguage: "en"
    });

    expect(html).toContain("This skill command cannot be queued.");
  });

  it("renders skill command queue controls and local worker form", async () => {
    setActiveEmptyProjectState();
    pageMocks.pageState = {
      ...(pageMocks.pageState as Record<string, unknown>),
      skills: {
        boundSkills: [deploymentBoundSkill],
        availableVersions: []
      },
      skillCommands: [
        {
          skillId: "skill_static_deploy",
          skillVersionId: "skill_version_deploy",
          skillName: "Static deploy",
          commandId: "publish_static",
          commandName: "Publish static",
          description: "Simulate publishing generated static files.",
          permission: "deploy:simulate",
          requiresApproval: true
        }
      ]
    };

    const page = await HomePage({
      searchParams: Promise.resolve({ view: "skills" })
    });
    const text = collectText(page);
    const forms = collectElements(page, "form");

    expect(text).toContain("Approve and queue");
    expect(text).toContain("Run local worker once");
    expect(forms.some((form) => form.props?.action === executeSkillCommandAction)).toBe(true);
    expect(forms.some((form) => form.props?.action === runLocalWorkerOnceAction)).toBe(true);
  });

  it("renders localized worker queue errors", async () => {
    setActiveEmptyProjectState();

    const html = await renderHomePage({
      searchParams: Promise.resolve({
        view: "skills",
        workerError: "worker_runtime_not_configured"
      }),
      acceptLanguage: "en"
    });

    expect(html).toContain("Local worker runtime is not configured.");
  });

  it("renders read-only worker queue counts, stale heartbeat, and recent logs", async () => {
    setActiveEmptyProjectState();
    pageMocks.pageState = {
      ...(pageMocks.pageState as Record<string, unknown>),
      workerQueue: {
        projectId: "project_1",
        counts: {
          queued: 2,
          running: 1,
          stale: 1,
          completed: 3,
          failed: 1,
          rejected: 0,
          cancelled: 0
        },
        heartbeat: {
          status: "stale",
          workerId: "worker_alpha",
          workerJobId: "worker_job_long_identifier_that_should_wrap",
          lastHeartbeatAt: "2026-05-19T00:00:00.000Z"
        },
        logs: [
          {
            id: "worker_log_1",
            type: "worker.job.stale_recovered",
            message: "raw stdout leaked secret-token",
            workerId: "worker_alpha",
            workerJobId: "worker_job_long_identifier_that_should_wrap",
            projectId: "project_1",
            payload: {},
            createdAt: "2026-05-19T00:00:05.000Z"
          }
        ]
      }
    };

    const html = await renderHomePage({
      searchParams: Promise.resolve({ view: "skills" }),
      acceptLanguage: "en"
    });

    expect(html).toContain("Queued");
    expect(html).toContain("2");
    expect(html).toContain("Heartbeat");
    expect(html).toContain("Stale");
    expect(html).toContain("worker_alpha");
    expect(html).toContain("Recent worker logs");
    expect(html).toContain("worker.job.stale_recovered");
    expect(html).not.toContain("secret-token");
    expect(html).not.toContain("raw stdout");
  });

  it("renders project members in the sidebar", async () => {
    setActiveEmptyProjectState();

    const html = await renderHomePage({
      searchParams: Promise.resolve({}),
      acceptLanguage: "en"
    });

    expect(html).toContain("Project members");
    expect(html).toContain("Local user");
    expect(html).toContain("Owner");
  });

  it("does not render project members without a selected project", async () => {
    const html = await renderHomePage({
      searchParams: Promise.resolve({}),
      acceptLanguage: "en"
    });

    expect(html).not.toContain("Project members");
    expect(html).not.toContain("No members recorded for this project yet.");
  });

  it("renders non-local project members by display name or user id", async () => {
    setActiveEmptyProjectState();
    pageMocks.pageState = {
      ...(pageMocks.pageState as Record<string, unknown>),
      projectMembers: [
        localOwnerMember,
        {
          id: "project_member_project_1_reviewer-user",
          projectId: "project_1",
          userId: "reviewer-user",
          role: "reviewer",
          displayName: "Rina Reviewer",
          createdAt: "2026-05-17T00:00:00.000Z",
          updatedAt: "2026-05-17T00:00:00.000Z"
        },
        {
          id: "project_member_project_1_admin-user",
          projectId: "project_1",
          userId: "admin-user",
          role: "admin",
          createdAt: "2026-05-17T00:00:00.000Z",
          updatedAt: "2026-05-17T00:00:00.000Z"
        }
      ]
    };

    const html = await renderHomePage({
      searchParams: Promise.resolve({}),
      acceptLanguage: "en"
    });

    expect(html).toContain("Rina Reviewer");
    expect(html).toContain("admin-user");
  });

  it("renders localized Chinese project members in the sidebar", async () => {
    setActiveEmptyProjectState();

    const html = await renderHomePage({
      searchParams: Promise.resolve({}),
      acceptLanguage: "zh-CN"
    });

    expect(html).toContain("项目成员");
    expect(html).toContain("本地用户");
    expect(html).toContain("负责人");
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
    const apiSelect = selects.find((select) => select.props?.name === "api");
    const apiOptionValues = collectElements(apiSelect, "option").map(
      (option) => option.props?.value
    );

    expect(text).toContain("Project models");
    expect(text).toContain("Spring Campaign");
    expect(text).toContain("API protocol");
    expect(text).toContain("Anthropic Messages compatible");
    expect(text).toContain("Default model id");
    expect(inputs.some((input) => input.props?.name === "providerId")).toBe(true);
    expect(selects.some((select) => select.props?.name === "provider")).toBe(true);
    expect(apiSelect).toBeDefined();
    expect(apiOptionValues).toEqual(["mock", "openai-completions", "anthropic-messages"]);
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

  it("renders execution controls only for visible read-only MCP tools", async () => {
    setActiveEmptyProjectState();
    (pageMocks.pageState as {
      mcp: {
        connectors: unknown[];
        approvals: unknown[];
        visibleToolsByRole: Record<string, unknown[]>;
      };
    }).mcp = {
      connectors: [],
      approvals: [],
      visibleToolsByRole: {
        planner: [],
        builder: [
          {
            connectorId: "connector_assets",
            name: "searchAssets",
            permission: "assets:read",
            requiresApproval: false
          },
          {
            connectorId: "connector_git",
            name: "createPullRequest",
            permission: "git:write",
            requiresApproval: true,
            readOnly: true
          }
        ],
        reviewer: [],
        deployer: []
      }
    };

    const page = await HomePage({
      searchParams: Promise.resolve({ view: "mcp" })
    });
    const text = collectText(page).join(" ");
    const formPayloads = collectElements(page, "form").map(collectFormPayload);

    expect(text).toContain("Run read-only check");
    expect(text).toContain("Arguments JSON");
    expect(text).toContain("Write tools are blocked in this stage.");
    expect(formPayloads).toContainEqual({
      projectId: "project_1",
      connectorId: "connector_assets",
      toolName: "searchAssets",
      role: "builder"
    });
    expect(formPayloads).not.toContainEqual(
      expect.objectContaining({
        toolName: "createPullRequest"
      })
    );
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
      messages: [],
      interrupt: unavailableInterrupt
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
      ],
      interrupt: unavailableInterrupt
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

  it("renders project skill command cards with simulated approval forms", async () => {
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
        boundSkills: [deploymentBoundSkill],
        availableVersions: []
      },
      skillCommands: [
        {
          skillId: "skill_static_deploy",
          skillName: "Static deploy",
          skillVersionId: "skill_version_deploy",
          commandId: "publish_static",
          commandName: "Publish static",
          description: "Simulate publishing generated static files.",
          permission: "deploy:simulate",
          requiresApproval: true
        }
      ]
    };

    const page = await HomePage({
      searchParams: Promise.resolve({ view: "skills" })
    });
    const text = collectText(page);
    const forms = collectElements(page, "form");
    const inputs = collectElements(page, "input");

    expect(text).toContain("Skill Commands");
    expect(text).toContain("Approve and queue");
    expect(text).toContain("Local worker queue");
    expect(text).toContain("Publish static");
    expect(text).toContain("deploy:simulate");
    const commandForm = forms.find((form) => form.props?.action === executeSkillCommandAction);
    expect(commandForm).toBeDefined();
    expect(collectFormPayload(commandForm!)).toMatchObject({
      projectId: "project_1",
      skillVersionId: "skill_version_deploy",
      commandId: "publish_static",
      pageVersionId: ""
    });
    expect(
      inputs.some(
        (input) => input.props?.name === "commandId" && input.props?.value === "publish_static"
      )
    ).toBe(true);
  });

  it("includes the current page version in skill command forms for task snapshots", async () => {
    pageMocks.pageState = {
      kind: "task_ready",
      projects: [
        {
          id: "project_1",
          name: "Spring Campaign",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: [
        {
          id: "task_1",
          title: "Create a campaign landing page",
          type: "lp_generation",
          status: "complete",
          projectId: "project_1",
          createdAt: "2026-05-12T08:02:00.000Z"
        }
      ],
      skills: {
        boundSkills: [deploymentBoundSkill],
        availableVersions: []
      },
      skillCommands: [
        {
          skillId: "skill_static_deploy",
          skillName: "Static deploy",
          skillVersionId: "skill_version_deploy",
          commandId: "publish_static",
          commandName: "Publish static",
          permission: "deploy:simulate",
          requiresApproval: true
        }
      ],
      activeTaskId: "task_1",
      task: {
        id: "task_1",
        title: "Create a campaign landing page",
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
          content: "Create a campaign landing page",
          createdAt: "2026-05-12T08:02:00.000Z"
        }
      ],
      runEvents: [],
      interrupt: unavailableInterrupt,
      snapshot: {
        project: {
          id: "project_1",
          name: "Spring Campaign",
          createdAt: "2026-05-12T08:00:00.000Z"
        },
        brief: {
          id: "brief_1",
          projectId: "project_1",
          prompt: "Create a campaign landing page",
          brief: {
            objective: "Convert paid traffic.",
            audience: "Returning shoppers",
            offer: "Save 25%.",
            primaryCta: "Shop now"
          },
          createdAt: "2026-05-12T08:03:00.000Z"
        },
        currentPageVersion: {
          id: "page_version_1",
          projectId: "project_1",
          briefId: "brief_1",
          artifacts: {
            indexHtml: [
              "<!doctype html><html><head>",
              "<link rel=\"stylesheet\" href=\"styles.css\">",
              "</head><body>",
              "<h1>Spring Campaign</h1>",
              "  <script src=\"script.js\"></script>",
              "</body></html>"
            ].join(""),
            stylesCss: "body { color: #111827; }",
            scriptJs: "window.lpAgent = true;"
          },
          reviewStatus: "passed",
          findings: [],
          createdAt: "2026-05-12T08:04:00.000Z"
        },
        deployment: undefined
      }
    };

    const page = await HomePage({
      searchParams: Promise.resolve({ view: "skills" })
    });
    const commandForm = collectElements(page, "form").find(
      (form) => form.props?.action === executeSkillCommandAction
    );

    expect(commandForm).toBeDefined();
    expect(collectFormPayload(commandForm!)).toMatchObject({
      projectId: "project_1",
      skillVersionId: "skill_version_deploy",
      commandId: "publish_static",
      pageVersionId: "page_version_1",
      taskId: "task_1"
    });
  });

  it("renders localized Chinese skill command copy", async () => {
    pageMocks.acceptLanguage = "zh-CN,zh;q=0.9";
    pageMocks.currentProjectId = "project_1";
    pageMocks.pageState = {
      kind: "empty",
      projects: [
        {
          id: "project_1",
          name: "春季活动",
          createdAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      tasks: [],
      skills: {
        boundSkills: [deploymentBoundSkill],
        availableVersions: []
      },
      skillCommands: [
        {
          skillId: "skill_static_deploy",
          skillName: "Static deploy",
          skillVersionId: "skill_version_deploy",
          commandId: "publish_static",
          commandName: "Publish static",
          permission: "deploy:simulate",
          requiresApproval: true
        }
      ]
    };

    const page = await HomePage({
      searchParams: Promise.resolve({ view: "skills" })
    });
    const text = collectText(page);

    expect(text).toContain("技能命令");
    expect(text).toContain("批准并入队");
    expect(text).toContain("本地 Worker 队列");
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
      ],
      interrupt: unavailableInterrupt
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
      interrupt: unavailableInterrupt,
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
      ],
      interrupt: unavailableInterrupt
    };

    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const text = collectText(page).join(" ");

    expect(text).toContain("Create project for spring campaign");
    expect(text).toContain("I created a task thread and can continue from here.");
    expect(text).not.toContain("What can I help you build?");
  });

  it("renders skill command output summaries without raw tool output", async () => {
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
      skillCommands: [],
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
      interrupt: unavailableInterrupt,
      runEvents: [
        {
          id: "run_skill_command_1_event_1",
          runId: "run_skill_command_1",
          projectId: "project_1",
          sequence: 1,
          type: "tool.completed",
          message: "Deployment skill command completed.",
          payload: {
            role: "deployer",
            commandId: "publish_static",
            exitCode: 0,
            outputSummary: "stdout: 47 chars\nstderr: 0 chars",
            rawOutput: "published secret-token <html>"
          },
          createdAt: "2026-05-15T08:00:01.000Z"
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
    const text = collectText(page).join(" ");

    expect(text).toContain("stdout: 47 chars\nstderr: 0 chars");
    expect(text).not.toContain("published secret-token");
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("<html>");
  });

  it("passes artifactPath query values into page state loading", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.currentTaskId = "task_1";
    pageMocks.pageState = {
      kind: "empty",
      projects: [],
      projectMembers: [],
      tasks: [],
      skills: { boundSkills: [], availableVersions: [] },
      skillCommands: [],
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

    await HomePage({
      searchParams: Promise.resolve({ artifactPath: "styles.css" })
    });

    expect(pageMocks.getPageStateMock).toHaveBeenCalledWith({
      projectId: "project_1",
      taskId: "task_1",
      artifactPath: "styles.css"
    });
  });

  it("uses the first repeated artifactPath query value for page state loading", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.currentTaskId = "task_1";
    pageMocks.pageState = {
      kind: "empty",
      projects: [],
      projectMembers: [],
      tasks: [],
      skills: { boundSkills: [], availableVersions: [] },
      skillCommands: [],
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

    await HomePage({
      searchParams: Promise.resolve({ artifactPath: ["styles.css", "script.js"] })
    });

    expect(pageMocks.getPageStateMock).toHaveBeenCalledWith({
      projectId: "project_1",
      taskId: "task_1",
      artifactPath: "styles.css"
    });
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
      interrupt: unavailableInterrupt,
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

  it("renders artifact diff cards and a selected bounded snippet", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.currentTaskId = "task_1";
    pageMocks.pageState = createCompletedLpPageState({
      artifactDiff: {
        projectId: "project_1",
        pageVersionId: "version_1",
        artifactWorkspaceId: "artifact_workspace_1",
        files: [
          {
            path: "index.html",
            state: "initial",
            sizeBytes: 128,
            sha256: "a".repeat(64),
            shortSha256: "a".repeat(12),
            summary: "index.html static LP file",
            canPreview: true
          },
          {
            path: "styles.css",
            state: "changed",
            sizeBytes: 32,
            sha256: "b".repeat(64),
            shortSha256: "b".repeat(12),
            summary: "styles.css static LP file",
            canPreview: true
          },
          {
            path: "script.js",
            state: "unchanged",
            sizeBytes: 24,
            sha256: "c".repeat(64),
            shortSha256: "c".repeat(12),
            summary: "script.js static LP file",
            canPreview: true
          }
        ],
        selectedSnippet: {
          path: "styles.css",
          sizeBytes: 32,
          sha256: "b".repeat(64),
          shortSha256: "b".repeat(12),
          content: "body { color: #111827; }",
          maxBytes: 8192
        }
      }
    });

    const page = await HomePage({
      searchParams: Promise.resolve({ artifactPath: "styles.css" })
    });
    const text = collectText(page).join(" ");

    expect(text).toContain("Artifact changes");
    expect(text).toContain("index.html");
    expect(text).toContain("Initial");
    expect(text).toContain("styles.css");
    expect(text).toContain("Changed");
    expect(text).toContain("Snippet preview");
    expect(text).toContain("body { color: #111827; }");
  });

  it("does not render full preview artifact source in visible diff cards by default", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.currentTaskId = "task_1";
    const previewOnlyHtmlSource = "<main data-source=\"FULL_PREVIEW_HTML_SECRET\">Spring essentials</main>";
    const previewOnlyCssSource = "body::before { content: \"FULL_PREVIEW_CSS_SECRET\"; }";
    const previewOnlyJsSource = "window.__FULL_PREVIEW_JS_SECRET__ = true;";
    const artifactDiff = {
      projectId: "project_1",
      pageVersionId: "version_1",
      artifactWorkspaceId: "artifact_workspace_1",
      files: [
        {
          path: "styles.css",
          state: "initial",
          sizeBytes: 32,
          sha256: "b".repeat(64),
          shortSha256: "b".repeat(12),
          summary: "styles.css static LP file",
          canPreview: true
        }
      ]
    };
    const pageState = createCompletedLpPageState({ artifactDiff });
    pageState.snapshot.currentPageVersion.artifacts = {
      indexHtml: [
        "<!doctype html><html><head>",
        "<link rel=\"stylesheet\" href=\"styles.css\">",
        "</head><body>",
        previewOnlyHtmlSource,
        "  <script src=\"script.js\"></script>",
        "</body></html>"
      ].join(""),
      stylesCss: previewOnlyCssSource,
      scriptJs: previewOnlyJsSource
    };

    expect(JSON.stringify(pageState.snapshot.currentPageVersion.artifacts)).toContain(
      "FULL_PREVIEW_CSS_SECRET"
    );
    expect(JSON.stringify(artifactDiff)).not.toContain("FULL_PREVIEW_HTML_SECRET");
    expect(JSON.stringify(artifactDiff)).not.toContain("FULL_PREVIEW_CSS_SECRET");
    expect(JSON.stringify(artifactDiff)).not.toContain("FULL_PREVIEW_JS_SECRET");
    pageMocks.pageState = pageState;

    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const visibleText = collectText(page).join(" ");

    expect(visibleText).toContain("Artifact changes");
    expect(visibleText).toContain("styles.css static LP file");
    expect(visibleText).not.toContain(previewOnlyHtmlSource);
    expect(visibleText).not.toContain(previewOnlyCssSource);
    expect(visibleText).not.toContain(previewOnlyJsSource);
    expect(visibleText).not.toContain("FULL_PREVIEW_HTML_SECRET");
    expect(visibleText).not.toContain("FULL_PREVIEW_CSS_SECRET");
    expect(visibleText).not.toContain("FULL_PREVIEW_JS_SECRET");
    expect(visibleText).not.toContain("<!doctype html>");
  });

  it("renders selected snippet omitted messages from sanitized artifact state", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.currentTaskId = "task_1";
    pageMocks.pageState = createCompletedLpPageState({
      artifactDiff: {
        projectId: "project_1",
        pageVersionId: "version_1",
        artifactWorkspaceId: "artifact_workspace_1",
        files: [
          {
            path: "styles.css",
            state: "initial",
            sizeBytes: 9001,
            sha256: "b".repeat(64),
            shortSha256: "b".repeat(12),
            summary: "styles.css static LP file",
            canPreview: true
          }
        ],
        selectedSnippet: {
          path: "styles.css",
          sizeBytes: 9001,
          sha256: "b".repeat(64),
          shortSha256: "b".repeat(12),
          omittedReason: "size_limit_exceeded",
          maxBytes: 8192
        },
        errorCode: "artifact_snippet_unavailable"
      }
    });

    const page = await HomePage({
      searchParams: Promise.resolve({
        artifactPath: "../styles.css?token=ARTIFACT_QUERY_SECRET"
      })
    });
    const visibleText = collectText(page).join(" ");

    expect(visibleText).toContain("Content is over the 8 KB preview limit.");
    expect(visibleText).not.toContain("ARTIFACT_QUERY_SECRET");
    expect(visibleText).not.toContain("../styles.css");
  });

  it("renders a generic snippet unavailable message without leaking invalid query values", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.currentTaskId = "task_1";
    pageMocks.pageState = createCompletedLpPageState({
      artifactDiff: {
        projectId: "project_1",
        pageVersionId: "version_1",
        artifactWorkspaceId: "artifact_workspace_1",
        files: [
          {
            path: "styles.css",
            state: "initial",
            sizeBytes: 32,
            sha256: "b".repeat(64),
            shortSha256: "b".repeat(12),
            summary: "styles.css static LP file",
            canPreview: true
          }
        ],
        errorCode: "artifact_snippet_unavailable"
      }
    });

    const page = await HomePage({
      searchParams: Promise.resolve({
        artifactPath: "../secret.css?token=ARTIFACT_QUERY_SECRET"
      })
    });
    const visibleText = collectText(page).join(" ");

    expect(visibleText).toContain("Artifact changes");
    expect(visibleText).toContain("Snippet is unavailable.");
    expect(visibleText).not.toContain("ARTIFACT_QUERY_SECRET");
    expect(visibleText).not.toContain("../secret.css");
  });

  it("preserves existing query params when linking artifact preview snippets", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.currentTaskId = "task_1";
    pageMocks.pageState = createCompletedLpPageState({
      artifactDiff: {
        projectId: "project_1",
        pageVersionId: "version_1",
        artifactWorkspaceId: "artifact_workspace_1",
        files: [
          {
            path: "index.html",
            state: "initial",
            sizeBytes: 128,
            sha256: "a".repeat(64),
            shortSha256: "a".repeat(12),
            summary: "index.html static LP file",
            canPreview: true
          },
          {
            path: "styles.css",
            state: "changed",
            sizeBytes: 32,
            sha256: "b".repeat(64),
            shortSha256: "b".repeat(12),
            summary: "styles.css static LP file",
            canPreview: true
          }
        ],
        selectedSnippet: {
          path: "styles.css",
          sizeBytes: 32,
          sha256: "b".repeat(64),
          shortSha256: "b".repeat(12),
          content: "body { color: #111827; }",
          maxBytes: 8192
        }
      }
    });

    const page = await HomePage({
      searchParams: Promise.resolve({
        interruptError: "interrupt_failed",
        artifactPath: "styles.css"
      })
    });
    const snippetLinks = collectElements(page, "a").filter(
      (link) => collectText(link.props?.children).join("") === "Preview snippet"
    );
    const indexSnippetHref = snippetLinks.find((link) =>
      String(link.props?.href).includes("artifactPath=index.html")
    )?.props?.href;

    expect(indexSnippetHref).toBeDefined();
    const href = String(indexSnippetHref);
    expect(href).toContain("interruptError=interrupt_failed");
    expect(href).toContain("artifactPath=index.html");
    expect(href.match(/artifactPath=/g)).toHaveLength(1);
  });
});
