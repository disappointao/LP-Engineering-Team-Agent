import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInMemoryWorkbenchRepositories,
  type WorkbenchRepositories
} from "@lp-agent/db";
import {
  createStaticArtifactWorkspaceFiles,
  type StaticArtifacts
} from "@lp-agent/artifacts";
import { sampleBrief } from "@lp-agent/lp-schema";
import { createDefaultModelPolicy, type ModelFetch } from "@lp-agent/model-gateway";
import {
  InMemoryWorkerJobPayloadRepository,
  InMemoryWorkerLogRepository,
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter,
  createSimulatedSandboxPolicy,
  type WorkerJobRepository
} from "@lp-agent/worker-runtime";
import { createLocalWorkerQueueRuntime } from "@lp-agent/api";
import {
  classifyTaskPrompt,
  createWebWorkbenchStore,
  getWebWorkbenchStore,
  deriveImplicitProjectName,
  validateProjectInput,
  validatePromptInput,
  type WebWorkbenchStoreOptions
} from "./workbench-store";

type AgentRuntimeAdapter = NonNullable<WebWorkbenchStoreOptions["plannerRuntime"]>;
type RuntimeRunRequest = Parameters<AgentRuntimeAdapter["run"]>[0];
type RuntimeRunResult = Awaited<ReturnType<AgentRuntimeAdapter["run"]>>;
type RuntimeStreamEvent = NonNullable<
  ReturnType<NonNullable<AgentRuntimeAdapter["stream"]>>
> extends AsyncIterable<infer Event>
  ? Event
  : never;

const emptyMCPState = {
  connectors: [],
  approvals: [],
  visibleToolsByRole: {
    assistant: [],
    planner: [],
    builder: [],
    reviewer: [],
    deployer: []
  }
};

const emptyWorkerQueueSnapshot = {
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

const tempDirs: string[] = [];
const originalEnv = {
  LP_AGENT_WORKBENCH_STATE_FILE: process.env.LP_AGENT_WORKBENCH_STATE_FILE,
  REAL_MODEL_RUNTIME: process.env.REAL_MODEL_RUNTIME,
  WORKER_REPOSITORY_BACKEND: process.env.WORKER_REPOSITORY_BACKEND,
  WORKER_JOBS_FILE: process.env.WORKER_JOBS_FILE,
  WORKER_PAYLOADS_FILE: process.env.WORKER_PAYLOADS_FILE,
  WORKER_LOGS_FILE: process.env.WORKER_LOGS_FILE
};
const webStoreGlobal = globalThis as typeof globalThis & {
  __lpAgentWebWorkbenchStore?: unknown;
};

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function tempQueueFiles() {
  const dir = await mkdtemp(join(tmpdir(), "web-store-worker-queue-"));
  tempDirs.push(dir);
  return {
    jobsFilePath: join(dir, "worker-jobs.json"),
    payloadsFilePath: join(dir, "worker-payloads.json"),
    logsFilePath: join(dir, "worker-logs.json")
  };
}

function restoreWorkerEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function brandSkillManifestJson(): string {
  return JSON.stringify({
    id: "skill_brand",
    name: "Brand LP",
    version: "1.0.0",
    type: "template",
    scope: "project",
    description: "Brand LP sections.",
    permissions: ["brief:read", "artifact:write", "assets:read"],
    requiredSecrets: [],
    entrypoints: ["skills/brand.md"],
    reviewState: "published"
  });
}

function deploymentSkillManifestJson(): string {
  return JSON.stringify({
    id: "skill_static_deploy",
    name: "Static deploy",
    version: "1.0.0",
    type: "deployment",
    scope: "project",
    description: "Simulates static LP publishing.",
    permissions: ["deploy:simulate"],
    requiredSecrets: [],
    entrypoints: ["deploy.md"],
    commands: [
      {
        id: "publish_static",
        name: "Publish static",
        description: "Simulate publishing generated static files.",
        permission: "deploy:simulate",
        requiresApproval: true,
        command: "static-deploy",
        args: ["--project", "{{projectId}}"],
        env: [{ name: "LP_PROJECT_ID", value: "{{projectId}}" }],
        timeoutMs: 30000
      }
    ],
    reviewState: "published"
  });
}

async function savePublishedDeploymentSkill(
  repositories: WorkbenchRepositories,
  projectId: string
): Promise<void> {
  const manifest = JSON.parse(deploymentSkillManifestJson());
  await repositories.skills.save({
    id: manifest.id,
    name: manifest.name,
    type: manifest.type,
    scope: manifest.scope,
    createdAt: "2026-05-18T00:00:00.000Z"
  });
  await repositories.skillVersions.save({
    id: "skill_version_deploy",
    skillId: manifest.id,
    version: manifest.version,
    manifest,
    content: "# Deploy",
    contentType: "text/markdown",
    reviewState: "published",
    createdAt: "2026-05-18T00:00:00.000Z"
  });
  await repositories.skillBindings.save({
    id: "skill_binding_deploy",
    skillVersionId: "skill_version_deploy",
    scope: "project",
    targetKey: projectId,
    projectId,
    enabled: true,
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z"
  });
}

async function saveManualPageVersion(input: {
  repositories: WorkbenchRepositories;
  projectId: string;
  briefId: string;
  pageVersionId: string;
  workspaceId: string;
  artifacts: StaticArtifacts;
  createdAt?: string;
}): Promise<void> {
  const createdAt =
    input.createdAt !== undefined ? input.createdAt : "2026-05-19T00:00:00.000Z";
  await input.repositories.artifactWorkspaces.save({
    id: input.workspaceId,
    projectId: input.projectId,
    pageVersionId: input.pageVersionId,
    kind: "static_lp",
    state: "active",
    createdAt,
    updatedAt: createdAt
  });
  for (const file of createStaticArtifactWorkspaceFiles({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    pageVersionId: input.pageVersionId,
    artifacts: input.artifacts,
    createdAt
  })) {
    await input.repositories.artifactWorkspaceFiles.save(file);
  }
  await input.repositories.pageVersions.save({
    id: input.pageVersionId,
    projectId: input.projectId,
    briefId: input.briefId,
    artifactWorkspaceId: input.workspaceId,
    artifacts: input.artifacts,
    reviewStatus: "passed",
    findings: [],
    createdAt
  });
}

class StaticRuntime implements AgentRuntimeAdapter {
  constructor(private readonly result: Partial<RuntimeRunResult>) {}

  async run(request: RuntimeRunRequest): Promise<RuntimeRunResult> {
    const state = this.result.state ?? "completed";
    const terminalEvent =
      state === "completed"
        ? {
            type: "run.completed" as const,
            message: `${request.role} run completed.`,
            runId: request.runId,
            state: "completed" as const
          }
        : {
            type: "run.failed" as const,
            message: `${request.role} run failed.`,
            runId: request.runId,
            role: request.role,
            state: "failed" as const
          };
    return {
      runId: request.runId,
      projectId: request.projectId,
      role: request.role,
      state,
      artifacts: this.result.artifacts,
      findings: this.result.findings,
      modelOutputText: this.result.modelOutputText,
      events: [
        {
          type: "run.started",
          message: `${request.role} run started.`,
          runId: request.runId,
          role: request.role
        },
        terminalEvent
      ]
    };
  }
}

class RecordingRuntime extends StaticRuntime {
  readonly requests: RuntimeRunRequest[] = [];

  async run(request: RuntimeRunRequest): Promise<RuntimeRunResult> {
    this.requests.push(request);
    return super.run(request);
  }
}

class QueuedRuntime implements AgentRuntimeAdapter {
  readonly requests: RuntimeRunRequest[] = [];

  constructor(private readonly results: Array<Partial<RuntimeRunResult>>) {}

  async run(request: RuntimeRunRequest): Promise<RuntimeRunResult> {
    this.requests.push(request);
    const result = this.results.shift();
    if (!result) {
      throw new Error(`unexpected ${request.role} runtime call`);
    }
    return new StaticRuntime(result).run(request);
  }
}

class StreamingRuntime implements AgentRuntimeAdapter {
  readonly requests: RuntimeRunRequest[] = [];

  constructor(
    private readonly deltas: string[],
    private readonly content: string
  ) {}

  async run(): Promise<RuntimeRunResult> {
    throw new Error("run_should_not_be_called_for_streaming");
  }

  async *stream(request: RuntimeRunRequest): AsyncIterable<RuntimeStreamEvent> {
    this.requests.push(request);
    for (const delta of this.deltas) {
      yield { type: "model.delta", text: delta };
    }
    yield {
      type: "completed",
      result: {
        runId: request.runId,
        projectId: request.projectId,
        role: request.role,
        state: "completed",
        modelOutputText: this.content,
        events: [
          {
            type: "run.started",
            message: "assistant run started",
            runId: request.runId,
            role: request.role
          },
          {
            type: "model.completed",
            message: "assistant model call completed",
            runId: request.runId,
            role: request.role,
            provider: "stream-provider",
            api: "openai-completions",
            model: "stream-model",
            usage: {
              inputTokens: 2,
              outputTokens: 3,
              totalTokens: 5,
              source: "provider_reported"
            },
            attempt: 1,
            durationMs: 9,
            supportsStreaming: true,
            streamingEnabled: true
          },
          {
            type: "run.completed",
            message: "assistant run completed",
            runId: request.runId,
            state: "completed"
          }
        ]
      }
    };
  }
}

async function saveStreamingAssistantRoute(
  repositories: WorkbenchRepositories,
  projectId: string
): Promise<void> {
  const timestamp = "2026-05-12T00:00:00.000Z";
  await repositories.modelProviders.save({
    id: "stream_provider",
    scope: "project",
    targetKey: projectId,
    name: "Stream Provider",
    provider: "custom",
    config: {
      api: "openai-completions",
      models: [{ id: "stream-model" }]
    },
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp
  });
  await repositories.modelRoutingPolicies.save({
    id: "model_route_stream_assistant",
    scope: "project",
    targetKey: projectId,
    role: "assistant",
    providerId: "stream_provider",
    model: "stream-model",
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function completeArtifacts() {
  return {
    indexHtml:
      '<!doctype html><html><head><title>Spring Sale</title></head><body><main><h1>Spring Sale</h1><a href="#shop">Shop now</a></main></body></html>',
    stylesCss: "body { font-family: system-ui, sans-serif; }",
    scriptJs: "window.lpAgent = true;"
  };
}

function createStructuredLPModelFetch(): {
  modelFetch: ModelFetch;
  plannerBrief: typeof sampleBrief;
  builderArtifacts: StaticArtifacts;
  calls: Array<{
    input: string | URL | Request;
    init?: RequestInit;
    prompt: string;
    kind: "planner" | "builder" | "other";
  }>;
} {
  const plannerBrief = {
    ...sampleBrief,
    title: "Model Built LP",
    objective: "Validate that the Web store passes real runtime options through.",
    sections: sampleBrief.sections.map((section, index) => ({
      ...section,
      id: `model_built_section_${index + 1}`,
      ...(index === 0 ? { headline: "Model Built LP" } : {})
    })),
    seo: {
      ...sampleBrief.seo,
      title: "Model Built LP"
    }
  };
  const builderArtifacts: StaticArtifacts = {
    indexHtml:
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Model Built LP</title><link rel="stylesheet" href="styles.css"></head><body><main><section class="hero"><h1>Model Built LP</h1><p>Structured Builder output reached the Web store.</p><a href="#signup">Start now</a></section></main>  <script src="script.js"></script></body></html>',
    stylesCss:
      "body { margin: 0; font-family: system-ui, sans-serif; color: #172033; background: #f7fbff; } .hero { padding: 48px; }",
    scriptJs: "window.lpAgentModelBuilt = true;"
  };
  const calls: Array<{
    input: string | URL | Request;
    init?: RequestInit;
    prompt: string;
    kind: "planner" | "builder" | "other";
  }> = [];
  const modelFetch: ModelFetch = async (input, init) => {
    const requestBody = JSON.parse(String(init?.body)) as {
      messages?: Array<{ content?: unknown }>;
    };
    const prompt = String(requestBody.messages?.[0]?.content ?? "");
    const kind =
      prompt.includes("LPBriefSchema")
        ? "planner"
        : prompt.includes("indexHtml") &&
            prompt.includes("stylesCss") &&
            prompt.includes("scriptJs")
          ? "builder"
          : "other";
    calls.push({
      input,
      ...(init ? { init } : {}),
      prompt,
      kind
    });
    const content =
      kind === "planner"
        ? JSON.stringify(plannerBrief)
        : kind === "builder"
          ? JSON.stringify(builderArtifacts)
          : "No launch blockers.";

    return new Response(
      JSON.stringify({
        id: `chatcmpl_${kind}_${calls.length}`,
        model: "lp-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop"
          }
        ],
        usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  return { modelFetch, plannerBrief, builderArtifacts, calls };
}

describe("web workbench store", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    restoreWorkerEnv();
    delete webStoreGlobal.__lpAgentWebWorkbenchStore;
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
    );
  });

  it("queues deployment skill commands through the worker queue runtime", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const workerRuntime = new InMemoryWorkerRuntime({
      payloadRepository: new InMemoryWorkerJobPayloadRepository(),
      adapter: new SimulatedExecutionAdapter()
    });
    const store = createWebWorkbenchStore({
      repositories,
      workerQueueRuntime: workerRuntime,
      currentUser: {
        id: "web-reviewer",
        displayName: "Reviewer"
      }
    });
    const project = await store.createProject({ name: "Project" });
    await savePublishedDeploymentSkill(repositories, project.id);

    const result = await store.executeSkillCommand({
      projectId: project.id,
      skillVersionId: "skill_version_deploy",
      commandId: "publish_static"
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        run: {
          state: "running"
        },
        observation: {
          state: "running"
        }
      }
    });
    const jobs = await workerRuntime.listJobsForProject(project.id);
    expect(jobs).toEqual([
      expect.objectContaining({
        state: "queued",
        payloadSource: "safe_persisted"
      })
    ]);
  });

  it("surfaces and resumes task-scoped worker finalization gaps for queued skill commands", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const workerQueueRuntime = createLocalWorkerQueueRuntime(await tempQueueFiles());
    const store = createWebWorkbenchStore({
      repositories,
      workerQueueRuntime: workerQueueRuntime.runtime,
      workerRuntime: workerQueueRuntime.runtime,
      workerJobRepository: workerQueueRuntime.jobRepository,
      workerLogRepository: workerQueueRuntime.workerLogRepository,
      currentUser: {
        id: "web-reviewer",
        displayName: "Reviewer"
      }
    });
    const project = await store.createProject({ name: "Recovery project" });
    const task = await store.submitTaskPrompt({
      projectId: project.id,
      prompt: "Create a task-scoped landing page in HTML.",
      implicitProjectName: "Untitled LP Project"
    });
    if (!task.ok || !task.taskId) {
      throw new Error("Expected task creation.");
    }
    const pageStateBeforeCommand = await store.getPageState({
      projectId: project.id,
      taskId: task.taskId
    });
    if (
      pageStateBeforeCommand.kind !== "task_ready" ||
      !pageStateBeforeCommand.snapshot?.currentPageVersion
    ) {
      throw new Error("Expected task page version.");
    }
    await savePublishedDeploymentSkill(repositories, project.id);

    const command = await store.executeSkillCommand({
      projectId: project.id,
      skillVersionId: "skill_version_deploy",
      commandId: "publish_static",
      taskId: task.taskId,
      pageVersionId: pageStateBeforeCommand.snapshot.currentPageVersion.id
    });
    if (!command.ok) {
      throw new Error(`Expected queued command, got ${command.error}.`);
    }
    if (!("workerJobId" in command.value)) {
      throw new Error("Expected queued command result.");
    }
    const workerJobId = command.value.workerJobId;
    await expect(workerQueueRuntime.runtime.listJobsForProject(project.id)).resolves.toEqual([
      expect.objectContaining({
        id: workerJobId,
        state: "queued"
      })
    ]);
    const claim = await workerQueueRuntime.runtime.claimOldestQueuedForProject({
      workerId: "test-worker",
      projectId: project.id
    });
    if (!claim) {
      throw new Error("Expected queued worker job claim.");
    }
    const workerJob = await workerQueueRuntime.runtime.runClaimedJob(claim);
    expect(workerJob?.state).toBe("completed");

    const pageStateWithGap = await store.getPageState({
      projectId: project.id,
      taskId: task.taskId
    });
    expect(pageStateWithGap.kind).toBe("task_ready");
    if (pageStateWithGap.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageStateWithGap.recovery.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runId: command.value.run.id,
        recoveryActions: ["resume_worker_finalization"]
      })
    ]));

    const recovered = await store.executeRunRecoveryAction({
      taskId: task.taskId,
      runId: command.value.run.id,
      action: "resume_worker_finalization"
    });

    expect(recovered).toEqual({
      ok: true,
      value: expect.objectContaining({
        action: "resume_worker_finalization",
        runId: command.value.run.id,
        state: "completed"
      })
    });
    await expect(repositories.runs.getById(command.value.run.id)).resolves.toMatchObject({
      state: "completed",
      taskId: task.taskId
    });
  });

  it("exposes a project-scoped worker queue snapshot in page state", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const workerQueueRuntime = createLocalWorkerQueueRuntime(await tempQueueFiles());
    const store = createWebWorkbenchStore({
      repositories,
      workerQueueRuntime: workerQueueRuntime.runtime,
      workerRuntime: workerQueueRuntime.runtime,
      workerJobRepository: workerQueueRuntime.jobRepository,
      workerLogRepository: workerQueueRuntime.workerLogRepository,
      currentUser: {
        id: "web-reviewer",
        displayName: "Reviewer"
      }
    });
    const project = await store.createProject({ name: "Project" });
    await workerQueueRuntime.runtime.enqueueSafe(
      {
        projectId: project.id,
        kind: "tool_command",
        commandId: "publish_static",
        command: "static-deploy",
        args: ["--project", project.id],
        envNames: ["LP_PROJECT_ID"],
        timeoutMs: 30000
      },
      createSimulatedSandboxPolicy({
        allowedCommands: ["static-deploy"],
        allowedEnvNames: ["LP_PROJECT_ID"]
      })
    );

    const state = await store.getPageState({ projectId: project.id });

    expect(state.workerQueue.counts.queued).toBe(1);
    expect(state.workerQueue.projectId).toBe(project.id);
  });

  it("returns an empty worker queue snapshot when worker job listing fails", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const workerJobRepository = {
      save: vi.fn(),
      getById: vi.fn(),
      listForProject: vi.fn(async () => {
        throw new Error("worker queue unavailable");
      }),
      listAll: vi.fn(),
      findOldestQueued: vi.fn(),
      claimOldestQueued: vi.fn(),
      heartbeatClaimed: vi.fn(),
      completeClaimed: vi.fn(),
      failClaimed: vi.fn(),
      rejectClaimed: vi.fn(),
      cancelQueued: vi.fn(),
      cancelRunning: vi.fn(),
      requeueStaleRunning: vi.fn()
    } as unknown as WorkerJobRepository;
    const store = createWebWorkbenchStore({
      repositories,
      workerJobRepository
    });
    const project = await store.createProject({ name: "Project" });

    const state = await store.getPageState({ projectId: project.id });

    expect(state.workerQueue).toEqual({
      ...emptyWorkerQueueSnapshot,
      projectId: project.id
    });
  });

  it("derives default worker logs path from a custom worker jobs file", async () => {
    const files = await tempQueueFiles();
    process.env.LP_AGENT_WORKBENCH_STATE_FILE = join(
      files.jobsFilePath,
      "..",
      "workbench-state.json"
    );
    process.env.WORKER_JOBS_FILE = files.jobsFilePath;
    process.env.WORKER_PAYLOADS_FILE = files.payloadsFilePath;
    delete process.env.WORKER_LOGS_FILE;
    delete webStoreGlobal.__lpAgentWebWorkbenchStore;
    const store = await getWebWorkbenchStore();
    const project = await store.createProject({ name: "Project" });
    const draft = await store.createSkillDraft({
      manifestJson: deploymentSkillManifestJson(),
      content: "# Deploy",
      contentType: "text/markdown"
    });
    if (!draft.ok) {
      throw new Error(`Expected draft creation to succeed, got ${draft.error}.`);
    }
    const validated = await store.validateSkillVersion(draft.value.version.id);
    if (!validated.ok) {
      throw new Error(`Expected validation to succeed, got ${validated.error}.`);
    }
    const published = await store.publishSkillVersion(draft.value.version.id);
    if (!published.ok) {
      throw new Error(`Expected publishing to succeed, got ${published.error}.`);
    }
    const binding = await store.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.value.id
    });
    if (!binding.ok) {
      throw new Error(`Expected binding to succeed, got ${binding.error}.`);
    }
    const command = await store.executeSkillCommand({
      projectId: project.id,
      skillVersionId: published.value.id,
      commandId: "publish_static"
    });
    if (!command.ok) {
      throw new Error(`Expected command queueing to succeed, got ${command.error}.`);
    }

    await expect(store.runLocalWorkerOnce({ projectId: project.id })).resolves.toMatchObject({
      ok: true,
      state: "completed"
    });

    await expect(readFile(files.logsFilePath, "utf8")).resolves.toContain(
      "worker.job.completed"
    );
  });

  it("creates the global store through the configured repository backend", async () => {
    const stateFileDirectory = await mkdtemp(join(tmpdir(), "web-store-memory-backend-"));
    tempDirs.push(stateFileDirectory);
    vi.stubEnv("LP_AGENT_WORKBENCH_STATE_FILE", stateFileDirectory);
    vi.stubEnv("WORKBENCH_REPOSITORY_BACKEND", "memory");
    vi.stubEnv("WORKER_REPOSITORY_BACKEND", "memory");
    delete webStoreGlobal.__lpAgentWebWorkbenchStore;

    const store = await getWebWorkbenchStore();
    const project = await store.createProject({ name: "Memory backend project" });
    const draft = await store.createSkillDraft({
      manifestJson: deploymentSkillManifestJson(),
      content: "# Deploy",
      contentType: "text/markdown"
    });
    if (!draft.ok) {
      throw new Error(`Expected draft creation to succeed, got ${draft.error}.`);
    }
    const validated = await store.validateSkillVersion(draft.value.version.id);
    if (!validated.ok) {
      throw new Error(`Expected validation to succeed, got ${validated.error}.`);
    }
    const published = await store.publishSkillVersion(draft.value.version.id);
    if (!published.ok) {
      throw new Error(`Expected publishing to succeed, got ${published.error}.`);
    }
    const binding = await store.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.value.id
    });
    if (!binding.ok) {
      throw new Error(`Expected binding to succeed, got ${binding.error}.`);
    }

    const command = await store.executeSkillCommand({
      projectId: project.id,
      skillVersionId: published.value.id,
      commandId: "publish_static"
    });
    if (!command.ok) {
      throw new Error(`Expected command queueing to succeed, got ${command.error}.`);
    }
    const state = await store.getPageState({ projectId: project.id });

    expect(project.name).toBe("Memory backend project");
    expect(state.workerQueue.counts.queued).toBe(1);
    expect(state.workerQueue.projectId).toBe(project.id);
  });

  it("retries global store initialization after repository backend setup fails", async () => {
    vi.stubEnv("WORKBENCH_REPOSITORY_BACKEND", "postgres");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("WORKBENCH_POSTGRES_WORKSPACE_ID", "workspace_local");
    vi.stubEnv("WORKER_REPOSITORY_BACKEND", "memory");
    delete webStoreGlobal.__lpAgentWebWorkbenchStore;

    await expect(getWebWorkbenchStore()).rejects.toThrow(
      "DATABASE_URL is required for WORKBENCH_REPOSITORY_BACKEND=postgres"
    );

    vi.stubEnv("WORKBENCH_REPOSITORY_BACKEND", "memory");
    const store = await getWebWorkbenchStore();
    const project = await store.createProject({ name: "Recovered memory backend project" });

    expect(project.name).toBe("Recovered memory backend project");
  });

  it("fails global store initialization when worker postgres backend misses DATABASE_URL", async () => {
    vi.stubEnv("WORKBENCH_REPOSITORY_BACKEND", "memory");
    vi.stubEnv("WORKER_REPOSITORY_BACKEND", "postgres");
    vi.stubEnv("DATABASE_URL", "");
    delete webStoreGlobal.__lpAgentWebWorkbenchStore;

    await expect(getWebWorkbenchStore()).rejects.toThrow(
      "WORKER_REPOSITORY_BACKEND=postgres requires DATABASE_URL"
    );

    vi.stubEnv("WORKER_REPOSITORY_BACKEND", "memory");
    const store = await getWebWorkbenchStore();
    const project = await store.createProject({
      name: "Recovered worker memory backend project"
    });

    expect(project.name).toBe("Recovered worker memory backend project");
  });

  it("runs one local worker job and finalizes the queued command", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const workerLogRepository = new InMemoryWorkerLogRepository();
    const workerRuntime = new InMemoryWorkerRuntime({
      payloadRepository: new InMemoryWorkerJobPayloadRepository(),
      adapter: new SimulatedExecutionAdapter()
    });
    const store = createWebWorkbenchStore({
      repositories,
      workerQueueRuntime: workerRuntime,
      workerLogRepository,
      currentUser: {
        id: "web-reviewer",
        displayName: "Reviewer"
      }
    });
    const project = await store.createProject({ name: "Project" });
    await savePublishedDeploymentSkill(repositories, project.id);
    const queued = await store.executeSkillCommand({
      projectId: project.id,
      skillVersionId: "skill_version_deploy",
      commandId: "publish_static"
    });
    if (!queued.ok) {
      throw new Error(`Expected command queueing to succeed, got ${queued.error}.`);
    }

    const result = await store.runLocalWorkerOnce({ projectId: project.id });

    expect(result).toEqual({
      ok: true,
      state: "completed",
      workerJobId: "worker_job_1",
      runId: queued.value.run.id
    });
    await expect(repositories.runs.getById(queued.value.run.id)).resolves.toMatchObject({
      state: "completed"
    });
    await expect(workerLogRepository.list({ projectId: project.id })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "worker.job.completed",
          workerJobId: "worker_job_1"
        })
      ])
    );
  });

  it("does not execute queued work for a missing local worker project id", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const workerRuntime = new InMemoryWorkerRuntime({
      payloadRepository: new InMemoryWorkerJobPayloadRepository(),
      adapter: new SimulatedExecutionAdapter()
    });
    const store = createWebWorkbenchStore({
      repositories,
      workerQueueRuntime: workerRuntime,
      currentUser: {
        id: "web-reviewer",
        displayName: "Reviewer"
      }
    });
    const project = await store.createProject({ name: "Project B" });
    await savePublishedDeploymentSkill(repositories, project.id);
    const queued = await store.executeSkillCommand({
      projectId: project.id,
      skillVersionId: "skill_version_deploy",
      commandId: "publish_static"
    });
    if (!queued.ok) {
      throw new Error(`Expected command queueing to succeed, got ${queued.error}.`);
    }

    await expect(
      store.runLocalWorkerOnce({ projectId: "project_missing" })
    ).resolves.toEqual({
      ok: false,
      error: "worker_job_finalization_failed"
    });

    await expect(workerRuntime.listJobsForProject(project.id)).resolves.toEqual([
      expect.objectContaining({
        id: "worker_job_1",
        state: "queued"
      })
    ]);
    await expect(repositories.runs.getById(queued.value.run.id)).resolves.toMatchObject({
      state: "running"
    });
  });

  it("scopes local worker run-once claims to the requested project", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const workerRuntime = new InMemoryWorkerRuntime({
      payloadRepository: new InMemoryWorkerJobPayloadRepository(),
      adapter: new SimulatedExecutionAdapter()
    });
    const store = createWebWorkbenchStore({
      repositories,
      workerQueueRuntime: workerRuntime,
      currentUser: {
        id: "web-reviewer",
        displayName: "Reviewer"
      }
    });
    const projectA = await store.createProject({ name: "Project A" });
    const projectB = await store.createProject({ name: "Project B" });
    await savePublishedDeploymentSkill(repositories, projectB.id);
    const queued = await store.executeSkillCommand({
      projectId: projectB.id,
      skillVersionId: "skill_version_deploy",
      commandId: "publish_static"
    });
    if (!queued.ok) {
      throw new Error(`Expected command queueing to succeed, got ${queued.error}.`);
    }

    await expect(store.runLocalWorkerOnce({ projectId: projectA.id })).resolves.toEqual({
      ok: true,
      state: "idle"
    });
    await expect(workerRuntime.listJobsForProject(projectB.id)).resolves.toEqual([
      expect.objectContaining({
        id: "worker_job_1",
        state: "queued"
      })
    ]);
    await expect(repositories.runs.getById(queued.value.run.id)).resolves.toMatchObject({
      state: "running"
    });

    await expect(store.runLocalWorkerOnce({ projectId: projectB.id })).resolves.toEqual({
      ok: true,
      state: "completed",
      workerJobId: "worker_job_1",
      runId: queued.value.run.id
    });
    await expect(repositories.runs.getById(queued.value.run.id)).resolves.toMatchObject({
      state: "completed"
    });
  });

  it("exposes a non-interruptible task interrupt view by default", async () => {
    const store = createWebWorkbenchStore();
    const result = await store.submitTaskPrompt({
      prompt: "Help me write a campaign plan.",
      implicitProjectName: "Untitled LP Project"
    });
    if (!result.ok) {
      throw new Error("Expected task submission to succeed.");
    }

    const pageState = await store.getPageState({ taskId: result.taskId });

    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageState.interrupt).toEqual({
      available: false,
      state: "not_interruptible",
      taskId: result.taskId
    });
  });

  it("includes task recovery views in task-ready page state", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });
    const project = await store.createProject({ name: "Recovery project" });
    await repositories.tasks.save({
      id: "task_1",
      title: "Recover failed run",
      type: "lp_generation",
      status: "complete",
      projectId: project.id,
      createdAt: "2026-05-20T00:00:00.000Z"
    });
    await repositories.messages.save({
      id: "message_1",
      taskId: "task_1",
      role: "user",
      content: "Build a recovery LP.",
      createdAt: "2026-05-20T00:00:00.000Z"
    });
    await repositories.runs.save({
      id: "run_planner_failed",
      projectId: project.id,
      taskId: "task_1",
      role: "planner",
      state: "failed",
      startedAt: "2026-05-20T00:00:01.000Z",
      completedAt: "2026-05-20T00:00:02.000Z",
      contextSummary: { injected: [], omitted: [] }
    });
    await repositories.runEvents.save({
      id: "run_planner_failed_event_1",
      runId: "run_planner_failed",
      projectId: project.id,
      taskId: "task_1",
      sequence: 1,
      type: "run.failed",
      message: "Planner failed.",
      payload: {
        errorName: "model_output_parse_failed",
        rawModelOutput: "RAW_MODEL_SECRET"
      },
      createdAt: "2026-05-20T00:00:02.000Z"
    });

    const state = await store.getPageState({ taskId: "task_1" });

    expect(state.kind).toBe("task_ready");
    if (state.kind !== "task_ready") {
      throw new Error("expected task_ready state");
    }
    expect(state.recovery.runs).toEqual([
      expect.objectContaining({
        runId: "run_planner_failed",
        state: "failed",
        recoveryActions: ["retry_run"],
        diagnosticSummary: expect.objectContaining({
          errorName: "model_output_parse_failed"
        })
      })
    ]);
    expect(JSON.stringify(state.recovery)).not.toContain("RAW_MODEL_SECRET");
  });

  describe("live task state", () => {
    it("returns safe live state with lifecycle, recovery, worker queue, and artifact progress", async () => {
      const store = createWebWorkbenchStore();
      const result = await store.submitTaskPrompt({
        prompt: "Create a spring launch LP with static HTML CSS JS",
        implicitProjectName: "Live State Project"
      });

      expect(result.ok).toBe(true);
      if (!result.ok || !result.projectId) {
        throw new Error("expected LP task");
      }

      const live = await store.getLiveTaskState({
        taskId: result.taskId,
        projectId: result.projectId
      });

      expect(live.ok).toBe(true);
      if (!live.ok) {
        throw new Error("expected live state");
      }

      expect(live.value).toMatchObject({
        taskId: result.taskId,
        projectId: result.projectId,
        taskType: "lp_generation",
        isTerminal: true,
        nextPollMs: 0
      });
      expect(
        live.value.runs
          .filter((run) => run.role !== "assistant")
          .map((run) => run.role)
      ).toEqual(["planner", "builder", "reviewer", "deployer"]);
      expect(live.value.artifactProgress?.pageVersionId).toBe(
        live.value.snapshot?.currentPageVersion?.id
      );
      expect(live.value.artifactProgress?.artifactWorkspaceId).toBe(
        live.value.snapshot?.currentPageVersion?.artifactWorkspaceId
      );
      expect(live.value.workerQueue.counts).toMatchObject({
        queued: 0,
        running: 0
      });
      expect(JSON.stringify(live.value)).not.toContain("<!doctype html");
      expect(JSON.stringify(live.value)).not.toContain("window.lpAgent");
    });

    it("keeps recent passed LP review live while deployment handoff can still be consumed", async () => {
      const repositories = createInMemoryWorkbenchRepositories();
      const store = createWebWorkbenchStore({ repositories });
      const createdAt = new Date().toISOString();
      const projectId = "project_1";
      const taskId = "task_1";
      const briefId = "brief_1";
      const pageVersionId = "version_1";
      const workspaceId = "artifact_workspace_1";
      const artifacts: StaticArtifacts = {
        indexHtml:
          '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><main><h1>Spring</h1></main><script src="script.js"></script></body></html>',
        stylesCss: "body { color: #111827; }",
        scriptJs: "window.lpAgent = true;"
      };

      await repositories.projects.save({
        id: projectId,
        name: "Review Gap Project",
        createdAt
      });
      await repositories.tasks.save({
        id: taskId,
        title: "Create a review gap LP",
        type: "lp_generation",
        status: "complete",
        projectId,
        createdAt
      });
      await repositories.messages.save({
        id: "message_1",
        taskId,
        role: "user",
        content: "Create a review gap LP",
        createdAt
      });
      await repositories.briefs.save({
        id: briefId,
        projectId,
        prompt: "Create a review gap LP",
        brief: sampleBrief,
        createdAt
      });
      await repositories.artifactWorkspaces.save({
        id: workspaceId,
        projectId,
        pageVersionId,
        runId: "run_builder_1",
        kind: "static_lp",
        state: "active",
        createdAt,
        updatedAt: createdAt
      });
      for (const file of createStaticArtifactWorkspaceFiles({
        workspaceId,
        projectId,
        pageVersionId,
        artifacts,
        createdAt
      })) {
        await repositories.artifactWorkspaceFiles.save(file);
      }
      await repositories.pageVersions.save({
        id: pageVersionId,
        projectId,
        briefId,
        artifactWorkspaceId: workspaceId,
        artifacts,
        reviewStatus: "passed",
        findings: [],
        createdAt
      });
      await repositories.taskSnapshots.save({
        taskId,
        projectId,
        briefId,
        pageVersionId,
        createdAt
      });

      const roles = ["planner", "builder", "reviewer"] as const;
      for (const [index, role] of roles.entries()) {
        const runId = `run_${role}_1`;
        await repositories.runs.save({
          id: runId,
          projectId,
          taskId,
          role,
          state: "completed",
          startedAt: `2026-05-20T00:00:0${index}.000Z`,
          completedAt: `2026-05-20T00:00:0${index}.500Z`,
          contextSummary: {
            injected: [],
            omitted: []
          }
        });
        await repositories.runEvents.save({
          id: `event_${role}_completed`,
          runId,
          projectId,
          taskId,
          sequence: 1,
          type: "run.completed",
          message: `${role} run completed`,
          payload: {
            type: "run.completed",
            runId,
            role,
            state: "completed"
          },
          createdAt: `2026-05-20T00:00:0${index}.500Z`
        });
      }
      await repositories.agentHandoffs.save({
        id: "handoff_reviewer_deployer",
        projectId,
        taskId,
        fromRunId: "run_reviewer_1",
        fromRole: "reviewer",
        toRole: "deployer",
        state: "ready",
        summary: "Reviewer passed page version",
        artifactRefs: {
          pageVersionId
        },
        createdAt,
        updatedAt: createdAt
      });

      const live = await store.getLiveTaskState({
        taskId,
        projectId
      });

      expect(live.ok).toBe(true);
      if (!live.ok) {
        throw new Error("expected live state");
      }
      expect(live.value.runs.map((run) => run.role)).toEqual([
        "planner",
        "builder",
        "reviewer"
      ]);
      expect(live.value.snapshot?.currentPageVersion?.reviewStatus).toBe("passed");
      expect(live.value.snapshot?.deployment).toBeUndefined();
      expect(live.value.isTerminal).toBe(false);
      expect(live.value.nextPollMs).toBe(1200);
    });

    it("treats stale passed LP review without deployment as terminal", async () => {
      const repositories = createInMemoryWorkbenchRepositories();
      const store = createWebWorkbenchStore({ repositories });
      const createdAt = "2026-05-20T00:00:00.000Z";
      const projectId = "project_1";
      const taskId = "task_1";
      const briefId = "brief_1";
      const pageVersionId = "version_1";
      const workspaceId = "artifact_workspace_1";
      const artifacts = completeArtifacts();

      await repositories.projects.save({
        id: projectId,
        name: "Stale Review Gap Project",
        createdAt
      });
      await repositories.tasks.save({
        id: taskId,
        title: "Create a stale review gap LP",
        type: "lp_generation",
        status: "complete",
        projectId,
        createdAt
      });
      await repositories.messages.save({
        id: "message_1",
        taskId,
        role: "user",
        content: "Create a stale review gap LP",
        createdAt
      });
      await repositories.messages.save({
        id: "message_2",
        taskId,
        role: "assistant",
        content: "LP artifacts are ready for review.",
        createdAt
      });
      await repositories.briefs.save({
        id: briefId,
        projectId,
        prompt: "Create a stale review gap LP",
        brief: sampleBrief,
        createdAt
      });
      await saveManualPageVersion({
        repositories,
        projectId,
        briefId,
        pageVersionId,
        workspaceId,
        artifacts,
        createdAt
      });
      await repositories.taskSnapshots.save({
        taskId,
        projectId,
        briefId,
        pageVersionId,
        createdAt
      });

      const roles = ["planner", "builder", "reviewer"] as const;
      for (const [index, role] of roles.entries()) {
        const runId = `run_${role}_1`;
        await repositories.runs.save({
          id: runId,
          projectId,
          taskId,
          role,
          state: "completed",
          startedAt: `2026-05-20T00:00:0${index}.000Z`,
          completedAt: `2026-05-20T00:00:0${index}.500Z`,
          contextSummary: {
            injected: [],
            omitted: []
          }
        });
        await repositories.runEvents.save({
          id: `event_${role}_completed`,
          runId,
          projectId,
          taskId,
          sequence: 1,
          type: "run.completed",
          message: `${role} run completed`,
          payload: {
            type: "run.completed",
            runId,
            role,
            state: "completed"
          },
          createdAt: `2026-05-20T00:00:0${index}.500Z`
        });
      }
      await repositories.agentHandoffs.save({
        id: "handoff_reviewer_deployer",
        projectId,
        taskId,
        fromRunId: "run_reviewer_1",
        fromRole: "reviewer",
        toRole: "deployer",
        state: "ready",
        summary: "Reviewer passed page version",
        artifactRefs: {
          pageVersionId
        },
        createdAt,
        updatedAt: createdAt
      });

      const live = await store.getLiveTaskState({
        taskId,
        projectId
      });

      expect(live.ok).toBe(true);
      if (!live.ok) {
        throw new Error("expected live state");
      }
      expect(live.value.snapshot?.currentPageVersion?.reviewStatus).toBe("passed");
      expect(live.value.snapshot?.deployment).toBeUndefined();
      expect(live.value.isTerminal).toBe(true);
      expect(live.value.nextPollMs).toBe(0);
    });

    it("keeps LP generation live after Planner completes before page files exist", async () => {
      const repositories = createInMemoryWorkbenchRepositories();
      const store = createWebWorkbenchStore({ repositories });
      const createdAt = "2026-05-20T00:00:00.000Z";
      const projectId = "project_1";
      const taskId = "task_1";
      const briefId = "brief_1";

      await repositories.projects.save({
        id: projectId,
        name: "Planner Gap Project",
        createdAt
      });
      await repositories.tasks.save({
        id: taskId,
        title: "Create a planner gap LP",
        type: "lp_generation",
        status: "complete",
        projectId,
        createdAt
      });
      await repositories.messages.save({
        id: "message_1",
        taskId,
        role: "user",
        content: "Create a planner gap LP",
        createdAt
      });
      await repositories.briefs.save({
        id: briefId,
        projectId,
        prompt: "Create a planner gap LP",
        brief: sampleBrief,
        createdAt
      });
      await repositories.taskSnapshots.save({
        taskId,
        projectId,
        briefId,
        createdAt
      });
      await repositories.runs.save({
        id: `run_planner_${briefId}`,
        projectId,
        taskId,
        role: "planner",
        state: "completed",
        startedAt: createdAt,
        completedAt: "2026-05-20T00:00:01.000Z",
        contextSummary: {
          injected: [],
          omitted: []
        }
      });
      await repositories.runEvents.save({
        id: "event_planner_completed",
        runId: `run_planner_${briefId}`,
        projectId,
        taskId,
        sequence: 1,
        type: "run.completed",
        message: "Planner run completed",
        payload: {
          type: "run.completed",
          runId: `run_planner_${briefId}`,
          role: "planner",
          state: "completed"
        },
        createdAt: "2026-05-20T00:00:01.000Z"
      });

      const live = await store.getLiveTaskState({
        taskId,
        projectId
      });

      expect(live.ok).toBe(true);
      if (!live.ok) {
        throw new Error("expected live state");
      }
      expect(live.value.snapshot?.brief?.id).toBe(briefId);
      expect(live.value.snapshot?.currentPageVersion).toBeUndefined();
      expect(live.value.artifactProgress).toBeUndefined();
      expect(live.value.isTerminal).toBe(false);
      expect(live.value.nextPollMs).toBe(1200);
    });

    it("fails closed when the requested project does not own the task", async () => {
      const store = createWebWorkbenchStore();
      const first = await store.submitTaskPrompt({
        prompt: "Create an LP for one project",
        implicitProjectName: "First Project"
      });
      const secondProject = await store.createProject({ name: "Second Project" });

      if (!first.ok) {
        throw new Error("expected first task");
      }

      await expect(
        store.getLiveTaskState({
          taskId: first.taskId,
          projectId: secondProject.id
        })
      ).resolves.toEqual({ ok: false, error: "project_not_found" });
    });

    it("does not expose raw run event payload fields in live state", async () => {
      const repositories = createInMemoryWorkbenchRepositories();
      const store = createWebWorkbenchStore({ repositories });
      const result = await store.submitTaskPrompt({
        prompt: "Create a spring launch LP with a custom run event",
        implicitProjectName: "Run Event Leak Project"
      });

      if (!result.ok || !result.projectId) {
        throw new Error("expected LP task");
      }

      await repositories.runEvents.save({
        id: "run_event_with_raw_model_output",
        runId: "run_planner_brief_1",
        projectId: result.projectId,
        taskId: result.taskId,
        sequence: 99,
        type: "model.completed",
        message: "model completed with raw output",
        payload: {
          type: "model.completed",
          runId: "run_planner_brief_1",
          role: "planner",
          provider: "mock-openai",
          model: "planning-model",
          usage: { inputTokens: 1, outputTokens: 2 },
          summary: "RAW_MODEL_OUTPUT_SECRET /Users/ao/.env SECRET_TOKEN=secret",
          artifactRefs: { localPath: "/Users/ao/site/.env" },
          files: [{ path: "/Users/ao/site/.env", summary: "RAW_TOOL_OUTPUT_SECRET" }],
          rawModelOutput: "RAW_MODEL_OUTPUT_SECRET"
        },
        createdAt: "2026-05-20T00:00:02.000Z"
      });

      const live = await store.getLiveTaskState({
        taskId: result.taskId,
        projectId: result.projectId
      });

      expect(live.ok).toBe(true);
      if (!live.ok) {
        throw new Error("expected live state");
      }
      expect(JSON.stringify(live.value)).not.toContain("RAW_MODEL_OUTPUT_SECRET");
      expect(JSON.stringify(live.value)).not.toContain("RAW_TOOL_OUTPUT_SECRET");
      expect(JSON.stringify(live.value)).not.toContain("/Users/ao");
      expect(JSON.stringify(live.value)).not.toContain(".env");
      expect(JSON.stringify(live.value)).not.toContain("SECRET_TOKEN");
      expect(JSON.stringify(live.value)).not.toContain("rawModelOutput");
      expect(live.value.runEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "run_event_with_raw_model_output",
            type: "model.completed",
            payload: {
              type: "model.completed",
              runId: "run_planner_brief_1",
              role: "planner",
              provider: "mock-openai",
              model: "planning-model",
              usage: { inputTokens: 1, outputTokens: 2 }
            }
          })
        ])
      );
    });

    it("does not expose selected artifact snippet content in live state", async () => {
      const store = createWebWorkbenchStore();
      const result = await store.submitTaskPrompt({
        prompt: "Create a spring launch LP with static HTML CSS JS",
        implicitProjectName: "Snippet Leak Project"
      });

      if (!result.ok || !result.projectId) {
        throw new Error("expected LP task");
      }

      const live = await store.getLiveTaskState({
        taskId: result.taskId,
        projectId: result.projectId,
        artifactPath: "styles.css"
      });

      expect(live.ok).toBe(true);
      if (!live.ok) {
        throw new Error("expected live state");
      }
      expect(live.value.artifactDiff?.selectedSnippet).toMatchObject({
        path: "styles.css",
        shortSha256: expect.any(String),
        maxBytes: expect.any(Number)
      });
      expect(live.value.artifactDiff?.selectedSnippet).not.toHaveProperty("content");
      expect(JSON.stringify(live.value)).not.toContain(":root");
    });

    it("does not copy future raw fields into live snapshot or artifact DTOs", async () => {
      const repositories = createInMemoryWorkbenchRepositories();
      const store = createWebWorkbenchStore({ repositories });
      const result = await store.submitTaskPrompt({
        prompt: "Create a spring launch LP with static HTML CSS JS",
        implicitProjectName: "Future Field Leak Project"
      });

      if (!result.ok || !result.projectId) {
        throw new Error("expected LP task");
      }

      const project = await repositories.projects.getById(result.projectId);
      const pageVersion = await repositories.pageVersions.findLatestForProject(result.projectId);
      if (!project || !pageVersion) {
        throw new Error("expected project and page version");
      }

      await repositories.projects.save({
        ...project,
        futureRawSnapshotField: "RAW_SNAPSHOT_SECRET"
      } as typeof project);
      await repositories.pageVersions.save({
        ...pageVersion,
        futureRawPageVersionField: "RAW_PAGE_VERSION_SECRET"
      } as typeof pageVersion);

      const live = await store.getLiveTaskState({
        taskId: result.taskId,
        projectId: result.projectId,
        artifactPath: "styles.css"
      });

      expect(live.ok).toBe(true);
      if (!live.ok) {
        throw new Error("expected live state");
      }
      expect(live.value.snapshot?.currentPageVersion).not.toHaveProperty("artifacts");
      expect(JSON.stringify(live.value)).not.toContain("RAW_SNAPSHOT_SECRET");
      expect(JSON.stringify(live.value)).not.toContain("RAW_PAGE_VERSION_SECRET");
      expect(live.value.artifactDiff).not.toHaveProperty("selectedSnippet.content");
      expect(live.value.artifactDiff?.selectedSnippet).not.toHaveProperty("content");
    });
  });

  it("executes run recovery through the web store", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({
      repositories,
      currentUser: {
        id: "local-web-user",
        displayName: "Local user"
      }
    });
    const project = await store.createProject({ name: "Recovery project" });
    await repositories.tasks.save({
      id: "task_1",
      title: "Recover failed run",
      type: "lp_generation",
      status: "complete",
      projectId: project.id,
      createdAt: "2026-05-20T00:00:00.000Z"
    });
    await repositories.messages.save({
      id: "message_1",
      taskId: "task_1",
      role: "user",
      content: "Build a recovery LP.",
      createdAt: "2026-05-20T00:00:00.000Z"
    });
    await repositories.runs.save({
      id: "run_planner_failed",
      projectId: project.id,
      taskId: "task_1",
      role: "planner",
      state: "failed",
      startedAt: "2026-05-20T00:00:01.000Z",
      completedAt: "2026-05-20T00:00:02.000Z",
      contextSummary: { injected: [], omitted: [] }
    });
    await repositories.runEvents.save({
      id: "run_planner_failed_event_1",
      runId: "run_planner_failed",
      projectId: project.id,
      taskId: "task_1",
      sequence: 1,
      type: "run.failed",
      message: "Planner failed.",
      payload: {
        errorName: "model_output_parse_failed"
      },
      createdAt: "2026-05-20T00:00:02.000Z"
    });

    const result = await store.executeRunRecoveryAction({
      taskId: "task_1",
      runId: "run_planner_failed",
      action: "retry_run"
    });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        action: "retry_run",
        runId: "run_planner_failed",
        newRunId: "run_planner_failed_retry_1",
        state: "completed"
      })
    });
  });

  it("returns task_not_found when interrupting a missing task without a worker runtime", async () => {
    const store = createWebWorkbenchStore();

    await expect(
      store.interruptCurrentTask({
        taskId: "task_missing"
      })
    ).resolves.toEqual({
      ok: false,
      error: "task_not_found"
    });
  });

  it("returns interrupt_target_not_found when interrupting an existing task without a worker runtime", async () => {
    const store = createWebWorkbenchStore();
    const result = await store.submitTaskPrompt({
      prompt: "Help me write a campaign plan.",
      implicitProjectName: "Untitled LP Project"
    });
    if (!result.ok) {
      throw new Error("Expected task submission to succeed.");
    }

    await expect(
      store.interruptCurrentTask({
        taskId: result.taskId
      })
    ).resolves.toEqual({
      ok: false,
      error: "interrupt_target_not_found"
    });
  });

  it("interrupts the current task through the injected worker runtime", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.projects.save({
      id: "project_1",
      name: "Project",
      createdAt: "2026-05-18T00:00:00.000Z"
    });
    await repositories.tasks.save({
      id: "task_1",
      title: "Interruptible task",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-18T00:00:00.000Z"
    });
    await repositories.messages.save({
      id: "message_1",
      taskId: "task_1",
      role: "user",
      content: "Deploy this",
      createdAt: "2026-05-18T00:00:00.000Z"
    });
    await repositories.runs.save({
      id: "run_interrupt_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "deployer",
      state: "running",
      startedAt: "2026-05-18T00:00:00.000Z",
      contextSummary: {
        injected: [],
        omitted: []
      }
    });
    await repositories.runEvents.save({
      id: "run_interrupt_1_event_1",
      runId: "run_interrupt_1",
      projectId: "project_1",
      taskId: "task_1",
      sequence: 1,
      type: "worker.job.linked",
      message: "Worker job linked to task.",
      payload: {
        taskId: "task_1",
        runId: "run_interrupt_1",
        workerJobId: "worker_job_1"
      },
      createdAt: "2026-05-18T00:00:00.000Z"
    });
    const workerJob = {
      id: "worker_job_1",
      projectId: "project_1",
      kind: "tool_command" as const,
      state: "queued" as const,
      policy: {
        mode: "reject" as const,
        allowedCommands: [],
        timeoutMs: 1000,
        allowedEnvNames: [],
        maxStdoutBytes: 300,
        maxStderrBytes: 300,
        network: "disabled" as const
      },
      inputSummary: {
        projectId: "project_1",
        kind: "tool_command" as const,
        command: "static-deploy",
        argCount: 0,
        envNames: [],
        timeoutMs: 1000
      },
      createdAt: "2026-05-18T00:00:00.000Z"
    };
    const workerRuntime = {
      getJob: vi.fn(async () => workerJob),
      cancelJob: vi.fn(async () => ({
        ...workerJob,
        state: "cancelled" as const,
        completedAt: "2026-05-18T00:00:01.000Z",
        cancelRequestedAt: "2026-05-18T00:00:01.000Z",
        cancelledAt: "2026-05-18T00:00:01.000Z",
        errorName: "worker_job_cancelled",
        resultSummary: {
          state: "cancelled" as const,
          stdout: "",
          stderr: "Worker job cancelled before execution.",
          stdoutBytes: 0,
          stderrBytes: 38,
          errorName: "worker_job_cancelled"
        }
      }))
    };
    const store = createWebWorkbenchStore({
      repositories,
      workerRuntime,
      currentUser: {
        id: "local-web-user",
        displayName: "Local user"
      }
    });

    const before = await store.getPageState({ taskId: "task_1" });
    const result = await store.interruptCurrentTask({
      taskId: "task_1",
      reason: "User interrupted the task."
    });

    expect(before.kind).toBe("task_ready");
    if (before.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(before.interrupt).toMatchObject({
      available: true,
      state: "idle",
      runId: "run_interrupt_1",
      workerJobId: "worker_job_1"
    });
    expect(result).toEqual({
      ok: true,
      taskId: "task_1",
      state: "cancelled",
      runId: "run_interrupt_1",
      workerJobId: "worker_job_1"
    });
    expect(workerRuntime.cancelJob).toHaveBeenCalledWith(
      "worker_job_1",
      "User interrupted the task."
    );
  });

  it("creates projects and exposes them in creation order", async () => {
    const store = createWebWorkbenchStore();

    const first = await store.createProject({
      name: "Spring LP"
    });
    const second = await store.createProject({
      name: "Summer LP"
    });

    expect(first).toMatchObject({
      id: "project_1",
      name: "Spring LP"
    });
    await expect(
      store.listProjects().then((projects) => projects.map((project) => project.id))
    ).resolves.toEqual([
      "project_1",
      "project_2"
    ]);
    expect(second.id).toBe("project_2");
  });

  it("includes local owner project members in page state after creating a project", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({
      name: "Spring LP"
    });

    const state = await store.getPageState({ projectId: project.id });

    expect(state.kind).toBe("empty");
    expect(state.projectMembers).toEqual([
      {
        id: "project_member_project_1_local-web-user",
        projectId: project.id,
        userId: "local-web-user",
        role: "owner",
        displayName: "Local user",
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      }
    ]);
  });

  it("returns empty page state when no current task id is present", async () => {
    const store = createWebWorkbenchStore();

    await expect(store.getPageState(undefined)).resolves.toEqual({
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
        resolvedPolicy: createDefaultModelPolicy()
      },
      mcp: emptyMCPState,
      workerQueue: emptyWorkerQueueSnapshot
    });
  });

  it("returns empty page state for a stale project id", async () => {
    const store = createWebWorkbenchStore();
    await store.createProject({
      name: "Spring LP"
    });

    await expect(
      store.getPageState({
        projectId: "project_missing"
      })
    ).resolves.toEqual({
      kind: "empty",
      projects: [
        expect.objectContaining({
          id: "project_1",
          name: "Spring LP"
        })
      ],
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
        resolvedPolicy: createDefaultModelPolicy()
      },
      mcp: emptyMCPState,
      workerQueue: emptyWorkerQueueSnapshot
    });
  });

  it("submits an LP task for an existing project and restores a completed snapshot", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({
      name: "Spring LP"
    });

    const result = await store.submitTaskPrompt({
      projectId: project.id,
      prompt: "Create a spring ecommerce landing page.",
      implicitProjectName: "Untitled LP Project"
    });
    const pageState = await store.getPageState({
      projectId: project.id,
      taskId: "task_1"
    });

    expect(result).toEqual({
      ok: true,
      taskId: "task_1",
      taskType: "lp_generation",
      projectId: project.id
    });
    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageState.task).toMatchObject({
      id: "task_1",
      type: "lp_generation",
      projectId: project.id
    });
    expect(pageState.snapshot).toBeDefined();
    if (!pageState.snapshot) {
      throw new Error("Expected LP snapshot.");
    }
    expect(pageState.snapshot.project.id).toBe(project.id);
    expect(pageState.snapshot.brief?.prompt).toBe("Create a spring ecommerce landing page.");
    expect(pageState.snapshot.currentPageVersion?.reviewStatus).toBe("passed");
    expect(pageState.snapshot.deployment?.pageVersionId).toBe(
      pageState.snapshot.currentPageVersion?.id
    );
    expect(pageState.messages[1]?.content).toBe("LP 页面文件已准备好，可以预览和继续调整。");
  });

  it("includes persisted run events for the active task project", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });
    const result = await store.submitTaskPrompt({
      prompt: "Create a simple HTML LP",
      implicitProjectName: "Implicit project"
    });
    if (!result.ok) {
      throw new Error("Expected prompt submission to succeed.");
    }

    const state = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId
    });

    expect(state.kind).toBe("task_ready");
    if (state.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(state.runEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining(["run.started", "runtime.context.loaded", "model.completed"])
    );
  });

  it("globally sorts merged task-bound and snapshot-derived run events", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });
    const result = await store.submitTaskPrompt({
      prompt: "Create a simple HTML LP",
      implicitProjectName: "Implicit project"
    });
    if (!result.ok || !result.projectId) {
      throw new Error("Expected prompt submission to succeed.");
    }
    const projectId = result.projectId;
    const initialState = await store.getPageState({
      projectId,
      taskId: result.taskId
    });
    expect(initialState.kind).toBe("task_ready");
    if (initialState.kind !== "task_ready" || !initialState.snapshot?.currentPageVersion) {
      throw new Error("Expected task-ready state with a page version.");
    }

    await repositories.runEvents.save({
      id: "task_bound_later_event",
      runId: "run_task_bound_later",
      projectId,
      taskId: result.taskId,
      sequence: 1,
      type: "run.started",
      message: "Task-bound later event.",
      payload: {},
      createdAt: "2026-05-20T00:00:02.000Z"
    });
    await repositories.runEvents.save({
      id: "snapshot_skill_command_earlier_event",
      runId: "run_skill_command_earlier",
      projectId,
      sequence: 1,
      type: "skill.command.started",
      message: "Snapshot-derived earlier skill command event.",
      payload: {
        pageVersionId: initialState.snapshot.currentPageVersion.id
      },
      createdAt: "2026-05-20T00:00:01.000Z"
    });

    const state = await store.getPageState({
      projectId,
      taskId: result.taskId
    });

    expect(state.kind).toBe("task_ready");
    if (state.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    const mergedEventIds = state.runEvents.map((event) => event.id);
    expect(mergedEventIds.indexOf("snapshot_skill_command_earlier_event")).toBeLessThan(
      mergedEventIds.indexOf("task_bound_later_event")
    );
    expect(state.runEvents.map((event) => event.createdAt)).toEqual(
      [...state.runEvents.map((event) => event.createdAt)].sort()
    );
    expect(new Set(mergedEventIds).size).toBe(mergedEventIds.length);
  });

  it("restores the LP snapshot that belongs to the requested task", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({
      name: "Spring LP"
    });

    await store.submitTaskPrompt({
      projectId: project.id,
      prompt: "Create a first landing page in HTML.",
      implicitProjectName: "Untitled LP Project"
    });
    await store.submitTaskPrompt({
      projectId: project.id,
      prompt: "Create a second landing page in HTML.",
      implicitProjectName: "Untitled LP Project"
    });

    const firstTaskState = await store.getPageState({
      projectId: project.id,
      taskId: "task_1"
    });
    const secondTaskState = await store.getPageState({
      projectId: project.id,
      taskId: "task_2"
    });

    expect(firstTaskState.kind).toBe("task_ready");
    expect(secondTaskState.kind).toBe("task_ready");
    if (firstTaskState.kind !== "task_ready" || secondTaskState.kind !== "task_ready") {
      throw new Error("Expected task-ready states.");
    }
    expect(firstTaskState.snapshot?.brief?.prompt).toBe("Create a first landing page in HTML.");
    expect(secondTaskState.snapshot?.brief?.prompt).toBe("Create a second landing page in HTML.");
    expect([
      ...new Set(
        firstTaskState.runEvents
          .map((event) => event.runId)
          .filter((runId) => !runId.startsWith("run_task_followups_"))
      )
    ]).toEqual([
      "run_planner_brief_1",
      "run_builder_version_1",
      "run_reviewer_version_1",
      "run_deployer_version_1"
    ]);
    expect([
      ...new Set(
        secondTaskState.runEvents
          .map((event) => event.runId)
          .filter((runId) => !runId.startsWith("run_task_followups_"))
      )
    ]).toEqual([
      "run_planner_brief_2",
      "run_builder_version_2",
      "run_reviewer_version_2",
      "run_deployer_version_2"
    ]);
  });

  it("does not merge task-bound run events from another task whose run id matches the active snapshot", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });
    const project = await store.createProject({ name: "Spring LP" });
    const timestamp = "2026-05-22T00:00:00.000Z";

    await repositories.tasks.save({
      id: "task_other",
      title: "Other task",
      type: "lp_generation",
      status: "complete",
      projectId: project.id,
      createdAt: timestamp
    });
    await repositories.tasks.save({
      id: "task_active",
      title: "Active task",
      type: "lp_generation",
      status: "complete",
      projectId: project.id,
      createdAt: timestamp
    });
    await repositories.messages.save({
      id: "message_active",
      taskId: "task_active",
      role: "user",
      content: "Show active task.",
      createdAt: timestamp
    });
    await repositories.briefs.save({
      id: "brief_active",
      projectId: project.id,
      prompt: "Active prompt",
      brief: sampleBrief,
      createdAt: timestamp
    });
    await saveManualPageVersion({
      repositories,
      projectId: project.id,
      briefId: "brief_active",
      pageVersionId: "version_active",
      workspaceId: "artifact_workspace_active",
      artifacts: completeArtifacts(),
      createdAt: timestamp
    });
    await repositories.taskSnapshots.save({
      taskId: "task_active",
      projectId: project.id,
      briefId: "brief_active",
      pageVersionId: "version_active",
      createdAt: timestamp
    });
    await repositories.runEvents.save({
      id: "foreign_builder_event",
      runId: "run_builder_version_active",
      projectId: project.id,
      taskId: "task_other",
      sequence: 1,
      type: "run.started",
      message: "Foreign builder run.",
      payload: {},
      createdAt: timestamp
    });
    await repositories.runEvents.save({
      id: "active_event",
      runId: "run_builder_unrelated_id",
      projectId: project.id,
      taskId: "task_active",
      sequence: 1,
      type: "run.started",
      message: "Active task run.",
      payload: {},
      createdAt: timestamp
    });

    const state = await store.getPageState({
      projectId: project.id,
      taskId: "task_active"
    });

    expect(state.kind).toBe("task_ready");
    if (state.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(state.runEvents.map((event) => event.id)).toEqual(["active_event"]);
  });

  it("scopes skill command run events to the active task page version", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({
      name: "Spring LP"
    });

    await store.submitTaskPrompt({
      projectId: project.id,
      prompt: "Create a first landing page in HTML.",
      implicitProjectName: "Untitled LP Project"
    });
    await store.submitTaskPrompt({
      projectId: project.id,
      prompt: "Create a second landing page in HTML.",
      implicitProjectName: "Untitled LP Project"
    });
    const secondTaskStateBeforeCommand = await store.getPageState({
      projectId: project.id,
      taskId: "task_2"
    });
    if (
      secondTaskStateBeforeCommand.kind !== "task_ready" ||
      !secondTaskStateBeforeCommand.snapshot?.currentPageVersion
    ) {
      throw new Error("Expected second task page version.");
    }
    const draft = await store.createSkillDraft({
      manifestJson: deploymentSkillManifestJson(),
      content: "# Deploy",
      contentType: "text/markdown"
    });
    if (!draft.ok) {
      throw new Error(`Expected draft creation to succeed, got ${draft.error}.`);
    }
    const validated = await store.validateSkillVersion(draft.value.version.id);
    if (!validated.ok) {
      throw new Error(`Expected validation to succeed, got ${validated.error}.`);
    }
    const published = await store.publishSkillVersion(draft.value.version.id);
    if (!published.ok) {
      throw new Error(`Expected publishing to succeed, got ${published.error}.`);
    }
    const binding = await store.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.value.id
    });
    if (!binding.ok) {
      throw new Error(`Expected binding to succeed, got ${binding.error}.`);
    }

    const command = await store.executeSkillCommand({
      projectId: project.id,
      skillVersionId: published.value.id,
      commandId: "publish_static",
      pageVersionId: secondTaskStateBeforeCommand.snapshot.currentPageVersion.id
    });
    if (!command.ok) {
      throw new Error(`Expected command execution to succeed, got ${command.error}.`);
    }

    const firstTaskState = await store.getPageState({
      projectId: project.id,
      taskId: "task_1"
    });
    const secondTaskState = await store.getPageState({
      projectId: project.id,
      taskId: "task_2"
    });

    expect(firstTaskState.kind).toBe("task_ready");
    expect(secondTaskState.kind).toBe("task_ready");
    if (firstTaskState.kind !== "task_ready" || secondTaskState.kind !== "task_ready") {
      throw new Error("Expected task-ready states.");
    }
    expect(firstTaskState.runEvents.some((event) => event.runId.startsWith("run_skill_command_")))
      .toBe(false);
    expect(secondTaskState.runEvents.map((event) => event.runId)).toEqual(
      expect.arrayContaining([command.value.run.id])
    );
    expect(
      secondTaskState.runEvents.filter((event) => event.runId === command.value.run.id)
    ).toHaveLength(4);
  });

  it("reopens projects, tasks, messages, and LP snapshots from shared repositories", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const firstStore = createWebWorkbenchStore({ repositories });
    const project = await firstStore.createProject({
      name: "Spring LP"
    });

    await firstStore.submitTaskPrompt({
      projectId: project.id,
      prompt: "Create a spring ecommerce landing page.",
      implicitProjectName: "Untitled LP Project"
    });

    const reopenedStore = createWebWorkbenchStore({ repositories });
    await expect(reopenedStore.listProjects()).resolves.toEqual([
      expect.objectContaining({
        id: project.id,
        name: "Spring LP"
      })
    ]);
    await expect(reopenedStore.listTasks()).resolves.toEqual([
      expect.objectContaining({
        id: "task_1",
        projectId: project.id
      })
    ]);

    const pageState = await reopenedStore.getPageState({
      projectId: project.id,
      taskId: "task_1"
    });

    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageState.messages.map((message) => message.id)).toEqual(["message_1", "message_2"]);
    expect(pageState.snapshot?.project.id).toBe(project.id);
    expect(pageState.snapshot?.brief?.prompt).toBe("Create a spring ecommerce landing page.");
    expect(pageState.snapshot?.currentPageVersion?.reviewStatus).toBe("passed");
  });

  it("allocates task and message IDs from existing repository records", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });

    await repositories.tasks.save({
      id: "task_4",
      title: "Existing task",
      type: "general_chat",
      status: "complete",
      createdAt: "2026-05-13T00:00:00.000Z"
    });
    await repositories.messages.save({
      id: "message_9",
      taskId: "task_4",
      role: "assistant",
      content: "Existing message",
      createdAt: "2026-05-13T00:00:00.000Z"
    });

    const result = await store.submitTaskPrompt({
      prompt: "Help me write a campaign plan.",
      implicitProjectName: "Untitled LP Project"
    });

    expect(result).toEqual({
      ok: true,
      taskId: "task_5",
      taskType: "general_chat",
      projectId: undefined
    });

    const messages = await repositories.messages.listForTask("task_5");
    expect(messages.map((message) => message.id)).toEqual(["message_10", "message_11"]);
  });

  it("returns empty state when a project task is requested through a different project", async () => {
    const store = createWebWorkbenchStore();
    const firstProject = await store.createProject({
      name: "Spring LP"
    });
    const secondProject = await store.createProject({
      name: "Summer LP"
    });

    await store.submitTaskPrompt({
      projectId: firstProject.id,
      prompt: "Create a spring ecommerce landing page.",
      implicitProjectName: "Untitled LP Project"
    });

    await expect(
      store.getPageState({
        projectId: secondProject.id,
        taskId: "task_1"
      })
    ).resolves.toEqual({
      kind: "empty",
      projects: [
        expect.objectContaining({
          id: firstProject.id
        }),
        expect.objectContaining({
          id: secondProject.id
        })
      ],
      projectMembers: [
        expect.objectContaining({
          projectId: secondProject.id,
          userId: "local-web-user",
          role: "owner",
          displayName: "Local user"
        })
      ],
      tasks: [
        expect.objectContaining({
          id: "task_1",
          projectId: firstProject.id
        })
      ],
      skills: {
        boundSkills: [],
        availableVersions: []
      },
      skillCommands: [],
      models: {
        providers: [],
        routes: [],
        resolvedPolicy: createDefaultModelPolicy()
      },
      mcp: emptyMCPState,
      workerQueue: {
        ...emptyWorkerQueueSnapshot,
        projectId: secondProject.id
      }
    });
  });

  it("rejects prompt submission when the prompt is blank", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({
      name: "Spring LP"
    });

    await expect(
      store.submitTaskPrompt({
        projectId: project.id,
        prompt: " ",
        implicitProjectName: "Untitled LP Project"
      })
    ).resolves.toEqual({ ok: false, error: "prompt_required" });
  });

  it("rejects prompt submission when the project is missing", async () => {
    const store = createWebWorkbenchStore();

    await expect(
      store.submitTaskPrompt({
        projectId: "missing",
        prompt: "Build",
        implicitProjectName: "Untitled LP Project"
      })
    ).resolves.toEqual({ ok: false, error: "project_not_found" });
  });

  it("creates, validates, publishes, and binds skills through the web store", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({ name: "Project" });

    const draft = await store.createSkillDraft({
      manifestJson: brandSkillManifestJson(),
      content: "# Brand LP",
      contentType: "text/markdown"
    });
    if (!draft.ok) {
      throw new Error(`Expected draft creation to succeed, got ${draft.error}.`);
    }
    const validated = await store.validateSkillVersion(draft.value.version.id);
    if (!validated.ok) {
      throw new Error(`Expected validation to succeed, got ${validated.error}.`);
    }
    const published = await store.publishSkillVersion(draft.value.version.id);
    if (!published.ok) {
      throw new Error(`Expected publishing to succeed, got ${published.error}.`);
    }
    const binding = await store.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.value.id
    });
    if (!binding.ok) {
      throw new Error(`Expected binding to succeed, got ${binding.error}.`);
    }
    const state = await store.getPageState({ projectId: project.id });

    expect(validated.value.reviewState).toBe("validated");
    expect(binding.value.enabled).toBe(true);
    expect(state.skills.boundSkills).toEqual([
      expect.objectContaining({
        skill: expect.objectContaining({ id: "skill_brand" }),
        version: expect.objectContaining({ reviewState: "published" })
      })
    ]);
  });

  it("discovers bound published deployment skill commands", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({ name: "Project" });
    const draft = await store.createSkillDraft({
      manifestJson: deploymentSkillManifestJson(),
      content: "# Deploy",
      contentType: "text/markdown"
    });
    if (!draft.ok) {
      throw new Error(`Expected draft creation to succeed, got ${draft.error}.`);
    }
    const validated = await store.validateSkillVersion(draft.value.version.id);
    if (!validated.ok) {
      throw new Error(`Expected validation to succeed, got ${validated.error}.`);
    }
    const published = await store.publishSkillVersion(draft.value.version.id);
    if (!published.ok) {
      throw new Error(`Expected publishing to succeed, got ${published.error}.`);
    }
    const binding = await store.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.value.id
    });
    if (!binding.ok) {
      throw new Error(`Expected binding to succeed, got ${binding.error}.`);
    }

    const state = await store.getPageState({ projectId: project.id });

    expect(state.skillCommands).toEqual([
      {
        skillId: "skill_static_deploy",
        skillName: "Static deploy",
        skillVersionId: published.value.id,
        commandId: "publish_static",
        commandName: "Publish static",
        description: "Simulate publishing generated static files.",
        permission: "deploy:simulate",
        requiresApproval: true
      }
    ]);
  });

  it("excludes commands from disabled skill bindings", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({ name: "Project" });
    const draft = await store.createSkillDraft({
      manifestJson: deploymentSkillManifestJson(),
      content: "# Deploy",
      contentType: "text/markdown"
    });
    if (!draft.ok) {
      throw new Error(`Expected draft creation to succeed, got ${draft.error}.`);
    }
    const validated = await store.validateSkillVersion(draft.value.version.id);
    if (!validated.ok) {
      throw new Error(`Expected validation to succeed, got ${validated.error}.`);
    }
    const published = await store.publishSkillVersion(draft.value.version.id);
    if (!published.ok) {
      throw new Error(`Expected publishing to succeed, got ${published.error}.`);
    }
    const binding = await store.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.value.id
    });
    if (!binding.ok) {
      throw new Error(`Expected binding to succeed, got ${binding.error}.`);
    }
    const disabled = await store.setProjectSkillBindingEnabled({
      projectId: project.id,
      bindingId: binding.value.id,
      enabled: false
    });
    if (!disabled.ok) {
      throw new Error(`Expected disable to succeed, got ${disabled.error}.`);
    }

    const state = await store.getPageState({ projectId: project.id });

    expect(state.skillCommands).toEqual([]);
  });

  it("normalizes configured current user for ownership and skill command audit events", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({
      repositories,
      currentUser: {
        id: " web-reviewer ",
        displayName: " Web Reviewer "
      }
    });
    const project = await store.createProject({ name: "Project" });
    const draft = await store.createSkillDraft({
      manifestJson: deploymentSkillManifestJson(),
      content: "# Deploy",
      contentType: "text/markdown"
    });
    if (!draft.ok) {
      throw new Error(`Expected draft creation to succeed, got ${draft.error}.`);
    }
    const validated = await store.validateSkillVersion(draft.value.version.id);
    if (!validated.ok) {
      throw new Error(`Expected validation to succeed, got ${validated.error}.`);
    }
    const published = await store.publishSkillVersion(draft.value.version.id);
    if (!published.ok) {
      throw new Error(`Expected publishing to succeed, got ${published.error}.`);
    }
    const binding = await store.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.value.id
    });
    if (!binding.ok) {
      throw new Error(`Expected binding to succeed, got ${binding.error}.`);
    }

    const result = await store.executeSkillCommand({
      projectId: project.id,
      skillVersionId: published.value.id,
      commandId: "publish_static"
    });
    const pageState = await store.getPageState({ projectId: project.id });

    expect(result).toMatchObject({
      ok: true,
      value: {
        run: {
          role: "deployer",
          state: "completed"
        },
        observation: {
          state: "completed",
          outputSummary: "stdout: 47 chars\nstderr: 0 chars"
        }
      }
    });
    const events = await repositories.runEvents.listForProject(project.id);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.completed",
      "run.completed"
    ]);
    expect(pageState.projectMembers).toEqual([
      expect.objectContaining({
        projectId: project.id,
        userId: "web-reviewer",
        role: "owner",
        displayName: "Web Reviewer"
      })
    ]);
    expect(JSON.stringify(events)).toContain("stdout: 47 chars");
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "run.started",
          payload: expect.objectContaining({
            approvedByUserId: "web-reviewer"
          })
        }),
        expect.objectContaining({
          type: "tool.started",
          payload: expect.objectContaining({
            approvedByUserId: "web-reviewer"
          })
        })
      ])
    );
  });

  it("maps skill command execution validation errors to stable codes", async () => {
    const store = createWebWorkbenchStore();

    await expect(
      store.executeSkillCommand({
        projectId: "missing_project",
        skillVersionId: "missing_version",
        commandId: "publish_static"
      })
    ).resolves.toEqual({
      ok: false,
      error: "project_not_found"
    });
  });

  it("maps skill store validation errors to stable codes", async () => {
    const store = createWebWorkbenchStore();

    const result = await store.createSkillDraft({
      manifestJson: "{",
      content: "# Brand LP",
      contentType: "text/markdown"
    });

    expect(result).toEqual({
      ok: false,
      error: "invalid_manifest_json"
    });
  });

  it("creates model providers and routes through the web store", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({ name: "Project" });

    const provider = await store.createModelProvider({
      projectId: project.id,
      providerId: "provider_openai",
      name: "OpenAI",
      provider: "openai",
      secretEnvName: "OPENAI_API_KEY"
    });
    if (!provider.ok) {
      throw new Error(`Expected provider creation to succeed, got ${provider.error}.`);
    }

    const route = await store.upsertProjectModelRoute({
      projectId: project.id,
      role: "builder",
      providerId: provider.value.id,
      model: "gpt-5.4"
    });
    if (!route.ok) {
      throw new Error(`Expected route upsert to succeed, got ${route.error}.`);
    }

    const state = await store.getPageState({ projectId: project.id });

    expect(state.models.providers).toEqual([
      expect.objectContaining({ id: "provider_openai", provider: "openai" })
    ]);
    expect(state.models.routes).toEqual([
      expect.objectContaining({ role: "builder", model: "gpt-5.4" })
    ]);
    expect(state.models.resolvedPolicy.builder).toMatchObject({
      provider: "provider_openai",
      model: "gpt-5.4"
    });
  });

  it("creates provider-neutral model providers through the web store", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({ name: "Project" });

    const provider = await store.createModelProvider({
      projectId: project.id,
      providerId: "zhipu",
      name: "智谱 GLM",
      provider: "custom",
      api: "anthropic-messages",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      modelId: "glm-5.1"
    });

    expect(provider).toMatchObject({
      ok: true,
      value: {
        id: "zhipu",
        config: {
          api: "anthropic-messages",
          apiKeyEnv: "ANTHROPIC_API_KEY",
          models: [{ id: "glm-5.1" }]
        }
      }
    });
  });

  it("uses real Planner and Builder runtime through web store model routes", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const { modelFetch, plannerBrief, builderArtifacts, calls } =
      createStructuredLPModelFetch();
    const store = createWebWorkbenchStore({
      repositories,
      env: {
        REAL_MODEL_RUNTIME: "1",
        OPENAI_COMPATIBLE_API_KEY: "test-key"
      },
      modelFetch
    });
    const project = await store.createProject({ name: "Model LP" });
    const provider = await store.createModelProvider({
      projectId: project.id,
      providerId: "openai_compatible",
      name: "OpenAI Compatible",
      provider: "custom",
      api: "openai-completions",
      baseUrl: "https://models.example.test/v1",
      apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
      modelId: "lp-model"
    });
    if (!provider.ok) {
      throw new Error(`Expected provider creation to succeed, got ${provider.error}.`);
    }
    for (const role of ["planner", "builder", "reviewer", "deployer"] as const) {
      const route = await store.upsertProjectModelRoute({
        projectId: project.id,
        role,
        providerId: provider.value.id,
        model: "lp-model"
      });
      if (!route.ok) {
        throw new Error(`Expected ${role} route upsert to succeed, got ${route.error}.`);
      }
    }

    const result = await store.submitTaskPrompt({
      projectId: project.id,
      prompt: "Create a landing page in HTML for a model-built LP.",
      implicitProjectName: "Model LP"
    });

    expect(result).toEqual({
      ok: true,
      taskId: "task_1",
      taskType: "lp_generation",
      projectId: project.id
    });
    const pageState = await store.getPageState({
      projectId: project.id,
      taskId: "task_1"
    });
    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready" || !pageState.snapshot) {
      throw new Error("Expected task-ready page state with snapshot.");
    }
    expect(pageState.snapshot.brief?.brief.title).toBe(plannerBrief.title);
    expect(pageState.snapshot.brief?.brief.sections[0]?.id).toBe("model_built_section_1");
    expect(pageState.snapshot.currentPageVersion?.artifacts).toEqual(builderArtifacts);
    expect(pageState.snapshot.currentPageVersion?.artifacts.indexHtml).toContain(
      "Structured Builder output reached the Web store."
    );
    expect(calls.map((call) => call.kind)).toEqual([
      "planner",
      "builder",
      "other",
      "other"
    ]);
    expect(calls[0]?.prompt).toContain("LPBriefSchema");
    expect(calls[1]?.prompt).toContain("indexHtml");

    const runs = await repositories.runs.listForTask("task_1");
    expect(runs.filter((run) => run.role !== "assistant").map((run) => run.role)).toEqual([
      "planner",
      "builder",
      "reviewer",
      "deployer"
    ]);
  });

  it("bootstraps a local real-provider project for projectless LP prompts", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const { modelFetch, calls } = createStructuredLPModelFetch();
    const store = createWebWorkbenchStore({
      repositories,
      env: {
        REAL_MODEL_RUNTIME: "1",
        OPENAI_COMPATIBLE_BASE_URL: "https://models.example.test/v1",
        OPENAI_COMPATIBLE_API_KEY: "test-key",
        OPENAI_COMPATIBLE_DEFAULT_MODEL: "lp-model"
      },
      modelFetch
    });

    const result = await store.submitTaskPrompt({
      projectId: null,
      taskId: null,
      prompt: "Create a landing page in HTML for a local real-provider default.",
      implicitProjectName: "Ignored Implicit Project"
    });

    expect(result).toMatchObject({
      ok: true,
      taskType: "lp_generation",
      projectId: expect.any(String)
    });
    if (!result.ok || !result.projectId) {
      throw new Error("Expected project-backed LP result.");
    }
    const projects = await repositories.projects.listAll();
    expect(projects).toEqual([
      expect.objectContaining({
        id: result.projectId,
        name: "Local Real Provider"
      })
    ]);
    const providers = await repositories.modelProviders.listForProject(result.projectId);
    expect(providers).toEqual([
      expect.objectContaining({
        provider: "custom",
        config: expect.objectContaining({
          api: "openai-completions",
          apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
          models: [{ id: "lp-model" }]
        })
      })
    ]);
    const routes = await repositories.modelRoutingPolicies.listForProject(result.projectId);
    expect(routes.map((route) => [route.role, route.providerId, route.model])).toEqual([
      ["assistant", providers[0]?.id, "lp-model"],
      ["planner", providers[0]?.id, "lp-model"],
      ["builder", providers[0]?.id, "lp-model"],
      ["reviewer", providers[0]?.id, "lp-model"],
      ["deployer", providers[0]?.id, "lp-model"]
    ]);
    expect(calls.map((call) => call.kind)).toEqual([
      "planner",
      "builder",
      "other",
      "other",
      "other"
    ]);
  });

  it("bootstraps local real-provider routes for an explicitly selected project", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const { modelFetch } = createStructuredLPModelFetch();
    const store = createWebWorkbenchStore({
      repositories,
      env: {
        REAL_MODEL_RUNTIME: "1",
        OPENAI_COMPATIBLE_BASE_URL: "https://models.example.test/v1",
        OPENAI_COMPATIBLE_API_KEY: "test-key",
        OPENAI_COMPATIBLE_DEFAULT_MODEL: "lp-model"
      },
      modelFetch
    });
    const project = await store.createProject({ name: "Existing Project" });

    const result = await store.submitTaskPrompt({
      projectId: project.id,
      taskId: null,
      prompt: "Create a landing page in HTML for an existing project.",
      implicitProjectName: "Ignored"
    });

    expect(result).toMatchObject({
      ok: true,
      projectId: project.id,
      taskType: "lp_generation"
    });
    const providers = await repositories.modelProviders.listForProject(project.id);
    const routes = await repositories.modelRoutingPolicies.listForProject(project.id);
    expect(providers).toHaveLength(1);
    expect(routes.map((route) => route.role)).toEqual([
      "assistant",
      "planner",
      "builder",
      "reviewer",
      "deployer"
    ]);
  });

  it("bootstraps a local real-provider project for projectless chat prompts", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const runtime = new RecordingRuntime({
      modelOutputText: "Local real-provider chat is ready."
    });
    const store = createWebWorkbenchStore({
      repositories,
      assistantRuntime: runtime,
      env: {
        REAL_MODEL_RUNTIME: "1",
        ANTHROPIC_BASE_URL: "https://anthropic.example.test",
        ANTHROPIC_API_KEY: "test-key",
        ANTHROPIC_DEFAULT_MODEL: "claude-test"
      }
    });

    const started = await store.startStreamingChatPrompt({
      projectId: null,
      taskId: null,
      prompt: "Can I chat without manual setup?"
    });

    expect(started).toMatchObject({
      ok: true,
      projectId: expect.any(String),
      contextSummary: {
        runtimeMode: "real",
        projectName: "Local Real Provider"
      }
    });
    if (!started.ok || !started.projectId) {
      throw new Error("Expected project-backed chat start.");
    }
    const request = runtime.requests[0];
    if (!request?.context?.modelRoutingPolicy) {
      throw new Error("Expected assistant runtime request with model routing policy.");
    }
    expect(request.context.modelRoutingPolicy.assistant).toMatchObject({
      api: "anthropic-messages",
      model: "claude-test"
    });
  });

  it("recovers page model state when a persisted route points to a disabled provider", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });
    const project = await store.createProject({ name: "Project" });
    const provider = await store.createModelProvider({
      projectId: project.id,
      providerId: "provider_openai",
      name: "OpenAI",
      provider: "openai",
      secretEnvName: "OPENAI_API_KEY"
    });
    if (!provider.ok) {
      throw new Error(`Expected provider creation to succeed, got ${provider.error}.`);
    }
    const route = await store.upsertProjectModelRoute({
      projectId: project.id,
      role: "builder",
      providerId: provider.value.id,
      model: "gpt-5.4"
    });
    if (!route.ok) {
      throw new Error(`Expected route upsert to succeed, got ${route.error}.`);
    }
    await repositories.modelProviders.save({
      ...provider.value,
      enabled: false,
      updatedAt: "2026-05-12T08:10:00.000Z"
    });

    const state = await store.getPageState({ projectId: project.id });

    expect(state.models.resolutionError).toBe("model_provider_disabled");
    expect(state.models.providers).toEqual([
      expect.objectContaining({ id: "provider_openai", enabled: false })
    ]);
    expect(state.models.routes).toEqual([
      expect.objectContaining({ providerId: "provider_openai", role: "builder" })
    ]);
    expect(state.models.resolvedPolicy.builder).toEqual({
      provider: "mock-anthropic",
      model: "code-model"
    });
  });

  it("recovers page model state when a persisted route points to a missing provider", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });
    const project = await store.createProject({ name: "Project" });
    await repositories.modelRoutingPolicies.save({
      id: "model_route_1",
      scope: "project",
      targetKey: project.id,
      role: "builder",
      providerId: "provider_missing",
      model: "gpt-5.4",
      createdAt: "2026-05-12T08:00:00.000Z",
      updatedAt: "2026-05-12T08:00:00.000Z"
    });

    const state = await store.getPageState({ projectId: project.id });

    expect(state.models.resolutionError).toBe("model_route_provider_invalid");
    expect(state.models.providers).toEqual([]);
    expect(state.models.routes).toEqual([
      expect.objectContaining({ providerId: "provider_missing", role: "builder" })
    ]);
    expect(state.models.resolvedPolicy.builder).toEqual({
      provider: "mock-anthropic",
      model: "code-model"
    });
  });

  it("maps model store validation errors to stable codes", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({ name: "Project" });

    const result = await store.createModelProvider({
      projectId: project.id,
      providerId: "provider_bad",
      name: "Bad",
      provider: "javascript",
      secretEnvName: "OPENAI_API_KEY"
    });

    expect(result).toEqual({
      ok: false,
      error: "model_provider_type_unsupported"
    });
  });

  it("maps model provider in-use errors to stable codes", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({ name: "Project" });
    const provider = await store.createModelProvider({
      projectId: project.id,
      providerId: "provider_openai",
      name: "OpenAI",
      provider: "openai",
      secretEnvName: "OPENAI_API_KEY"
    });
    if (!provider.ok) {
      throw new Error(`Expected provider creation to succeed, got ${provider.error}.`);
    }
    const route = await store.upsertProjectModelRoute({
      projectId: project.id,
      role: "builder",
      providerId: provider.value.id,
      model: "gpt-5.4"
    });
    if (!route.ok) {
      throw new Error(`Expected route upsert to succeed, got ${route.error}.`);
    }

    const result = await store.setModelProviderEnabled({
      projectId: project.id,
      providerId: provider.value.id,
      enabled: false
    });

    expect(result).toEqual({
      ok: false,
      error: "model_provider_in_use"
    });
  });

  it("loads project mcp state and creates project connectors", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });
    const project = await store.createProject({ name: "MCP Web" });

    const result = await store.createMCPConnector({
      projectId: project.id,
      definitionJson: JSON.stringify({
        id: "connector_assets",
        name: "Assets",
        tools: [
          {
            name: "searchAssets",
            permission: "assets:read",
            roles: ["builder"],
            requiresApproval: false
          }
        ]
      })
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        id: "connector_assets",
        enabled: true
      }
    });

    const pageState = await store.getPageState({ projectId: project.id });
    expect(pageState.mcp.connectors).toEqual([
      expect.objectContaining({ id: "connector_assets" })
    ]);
  });

  it("returns stable mcp errors from the Web store", async () => {
    const store = createWebWorkbenchStore({
      repositories: createInMemoryWorkbenchRepositories()
    });

    await expect(
      store.createMCPConnector({
        projectId: "missing_project",
        definitionJson: "{"
      })
    ).resolves.toEqual({
      ok: false,
      error: "project_not_found"
    });
  });

  it("approves mcp tools through the Web store and hides them when disabled", async () => {
    const store = createWebWorkbenchStore({
      repositories: createInMemoryWorkbenchRepositories(),
      currentUser: {
        id: " web-reviewer ",
        displayName: " Web Reviewer "
      }
    });
    const project = await store.createProject({ name: "MCP Approval" });
    const draft = await store.createSkillDraft({
      manifestJson: JSON.stringify({
        id: "skill_deploy",
        name: "Deploy",
        version: "1.0.0",
        type: "workflow",
        scope: "project",
        description: "Deploy with git.",
        permissions: ["git:write"],
        requiredSecrets: [],
        entrypoints: ["deploy.md"],
        reviewState: "published"
      }),
      content: "# Deploy",
      contentType: "text/markdown"
    });
    if (!draft.ok) {
      throw new Error(`Expected draft creation to succeed, got ${draft.error}.`);
    }
    const validated = await store.validateSkillVersion(draft.value.version.id);
    if (!validated.ok) {
      throw new Error(`Expected validation to succeed, got ${validated.error}.`);
    }
    const published = await store.publishSkillVersion(draft.value.version.id);
    if (!published.ok) {
      throw new Error(`Expected publishing to succeed, got ${published.error}.`);
    }
    const binding = await store.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.value.id
    });
    if (!binding.ok) {
      throw new Error(`Expected binding to succeed, got ${binding.error}.`);
    }
    const connector = await store.createMCPConnector({
      projectId: project.id,
      definitionJson: JSON.stringify({
        id: "connector_git",
        name: "Git",
        tools: [
          {
            name: "createPullRequest",
            permission: "git:write",
            roles: ["deployer"],
            requiresApproval: true
          }
        ]
      })
    });
    if (!connector.ok) {
      throw new Error(`Expected connector creation to succeed, got ${connector.error}.`);
    }

    const approval = await store.setMCPToolApproval({
      projectId: project.id,
      connectorId: connector.value.id,
      toolName: "createPullRequest",
      approved: true
    });
    if (!approval.ok) {
      throw new Error(`Expected approval to succeed, got ${approval.error}.`);
    }
    expect(approval.value.approvedByUserId).toBe("web-reviewer");
    const approvedState = await store.getPageState({ projectId: project.id });
    expect(approvedState.mcp.visibleToolsByRole.deployer).toEqual([
      {
        connectorId: "connector_git",
        name: "createPullRequest",
        permission: "git:write",
        requiresApproval: true
      }
    ]);

    const disabled = await store.setMCPConnectorEnabled({
      projectId: project.id,
      connectorId: connector.value.id,
      enabled: false
    });
    if (!disabled.ok) {
      throw new Error(`Expected disable to succeed, got ${disabled.error}.`);
    }
    const disabledState = await store.getPageState({ projectId: project.id });
    expect(disabledState.mcp.visibleToolsByRole.deployer).toEqual([]);
  });

  it("executes read-only mcp tools through the Web store without leaking raw arguments", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });
    const project = await store.createProject({ name: "MCP Project" });
    const draft = await store.createSkillDraft({
      manifestJson: JSON.stringify({
        id: "skill_mcp_assets",
        name: "MCP Assets",
        version: "1.0.0",
        type: "workflow",
        scope: "project",
        description: "Grants asset read access.",
        permissions: ["assets:read"],
        requiredSecrets: [],
        entrypoints: ["workflow.md"],
        reviewState: "published"
      }),
      content: "# MCP Assets",
      contentType: "text/markdown"
    });
    if (!draft.ok) {
      throw new Error(`Expected draft creation to succeed, got ${draft.error}.`);
    }
    const validated = await store.validateSkillVersion(draft.value.version.id);
    if (!validated.ok) {
      throw new Error(`Expected validation to succeed, got ${validated.error}.`);
    }
    const published = await store.publishSkillVersion(draft.value.version.id);
    if (!published.ok) {
      throw new Error(`Expected publishing to succeed, got ${published.error}.`);
    }
    const binding = await store.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.value.id
    });
    if (!binding.ok) {
      throw new Error(`Expected binding to succeed, got ${binding.error}.`);
    }
    const connector = await store.createMCPConnector({
      projectId: project.id,
      definitionJson: JSON.stringify({
        id: "connector_assets",
        name: "Assets",
        tools: [
          {
            name: "searchAssets",
            permission: "assets:read",
            roles: ["builder"],
            requiresApproval: false
          }
        ]
      })
    });
    if (!connector.ok) {
      throw new Error(`Expected connector creation to succeed, got ${connector.error}.`);
    }

    const result = await store.executeMCPTool({
      projectId: project.id,
      connectorId: "connector_assets",
      toolName: "searchAssets",
      role: "builder",
      argumentsJson: "{\"query\":\"SECRET_PRODUCT\"}"
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        run: {
          state: "completed"
        },
        observation: {
          state: "completed"
        }
      }
    });
    if (!result.ok) {
      throw new Error(`Expected MCP execution to succeed, got ${result.error}.`);
    }
    expect(result.value.run.id).toBeTruthy();
    expect(result.value.observation.id).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain("SECRET_PRODUCT");
  });

  it("rejects invalid mcp tool arguments JSON", async () => {
    const store = createWebWorkbenchStore({
      repositories: createInMemoryWorkbenchRepositories()
    });

    await expect(
      store.executeMCPTool({
        projectId: "project_1",
        connectorId: "connector_assets",
        toolName: "searchAssets",
        role: "builder",
        argumentsJson: "{\"query\":"
      })
    ).resolves.toEqual({ ok: false, error: "mcp_tool_arguments_invalid" });
  });

  it("validates project and prompt form values", () => {
    expect(validateProjectInput({ name: " " })).toEqual({
      ok: false,
      error: "project_name_required"
    });
    expect(validatePromptInput(" ")).toEqual({
      ok: false,
      error: "prompt_required"
    });
    expect(validateProjectInput({ name: " LP " })).toEqual({
      ok: true,
      value: {
        name: "LP"
      }
    });
    expect(validatePromptInput(" Build a page ")).toEqual({
      ok: true,
      value: "Build a page"
    });
  });

  it("routes first prompts into deterministic task types", () => {
    expect(classifyTaskPrompt("帮我写一个双 11 活动方案")).toBe("general_chat");
    expect(classifyTaskPrompt("Help me write a campaign plan.")).toBe("general_chat");
    expect(classifyTaskPrompt("生成一个电商春季促销 LP，输出单文件 HTML")).toBe("lp_generation");
    expect(classifyTaskPrompt("Create a landing page for a spring sale")).toBe("lp_generation");
    expect(classifyTaskPrompt("创建项目 春季活动")).toBe("project_setup");
    expect(classifyTaskPrompt("new project for spring campaign")).toBe("project_setup");
    expect(classifyTaskPrompt("create a landing page for my project")).toBe("lp_generation");
    expect(classifyTaskPrompt("create project for spring campaign")).toBe("project_setup");
    expect(classifyTaskPrompt("How should I organize an FAQ?")).toBe("general_chat");
    expect(classifyTaskPrompt("What makes a CTA effective?")).toBe("general_chat");
  });

  it("derives implicit LP project names from the prompt with a fallback", () => {
    expect(
      deriveImplicitProjectName(
        "生成一个电商春季促销 LP，输出单文件 HTML",
        "未命名 LP 项目"
      )
    ).toBe("生成一个电商春季促销 LP");
    expect(deriveImplicitProjectName("   ", "Untitled LP Project")).toBe("Untitled LP Project");
    expect(deriveImplicitProjectName("   ", "   ")).toBe("Untitled LP Project");
  });

  it("submits a general task without a project and exposes a task thread", async () => {
    const store = createWebWorkbenchStore();

    const result = await store.submitTaskPrompt({
      prompt: "Help me write a campaign plan.",
      implicitProjectName: "未命名 LP 项目"
    });

    expect(result).toEqual({
      ok: true,
      taskId: "task_1",
      taskType: "general_chat",
      projectId: undefined
    });

    const pageState = await store.getPageState({
      taskId: "task_1"
    });

    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageState.task).toMatchObject({
      id: "task_1",
      type: "general_chat",
      projectId: undefined,
      title: "Help me write a campaign plan."
    });
    expect(pageState.projects).toEqual([]);
    expect(pageState.projectMembers).toEqual([]);
    expect(pageState.tasks.map((task) => task.id)).toEqual(["task_1"]);
    expect(pageState.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(pageState.messages[0]?.content).toBe("Help me write a campaign plan.");
    expect(pageState.messages[1]?.content).toBe(
      "I created a task thread and can continue from here."
    );
  });

  it("upgrades a projectless general task to an LP task without changing task id", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });

    const startedChat = await store.startStreamingChatPrompt({
      projectId: null,
      taskId: null,
      prompt: "Help me plan a campaign."
    });
    expect(startedChat.ok).toBe(true);
    if (!startedChat.ok) {
      throw new Error("expected ordinary chat task");
    }
    await expect(
      store.completeStreamingChatPrompt({
        taskId: startedChat.taskId,
        messageId: startedChat.assistantMessageId,
        content: startedChat.assistantContent
      })
    ).resolves.toEqual({ ok: true });

    const startedLp = await store.startLiveTaskPrompt({
      projectId: null,
      taskId: startedChat.taskId,
      prompt: "Create a landing page for summer running shoes.",
      implicitProjectName: "Untitled LP Project"
    });

    expect(startedLp).toMatchObject({
      ok: true,
      taskId: startedChat.taskId,
      taskType: "lp_generation",
      projectId: "project_1"
    });
    if (!startedLp.ok || !startedLp.projectId) {
      throw new Error("expected upgraded LP task");
    }

    await expect(startedLp.completion).resolves.toMatchObject({
      ok: true,
      taskId: startedChat.taskId,
      taskType: "lp_generation",
      projectId: startedLp.projectId
    });
    await expect(repositories.tasks.getById(startedChat.taskId)).resolves.toMatchObject({
      id: startedChat.taskId,
      type: "lp_generation",
      projectId: startedLp.projectId
    });
    await expect(repositories.messages.listForTask(startedChat.taskId)).resolves.toEqual([
      expect.objectContaining({
        role: "user",
        content: "Help me plan a campaign."
      }),
      expect.objectContaining({
        role: "assistant",
        content: "I created a task thread and can continue from here."
      }),
      expect.objectContaining({
        role: "user",
        content: "Create a landing page for summer running shoes."
      }),
      expect.objectContaining({
        role: "assistant",
        content: "LP 页面文件已准备好，可以预览和继续调整。"
      })
    ]);

    const pageState = await store.getPageState({
      projectId: startedLp.projectId,
      taskId: startedChat.taskId
    });
    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("expected upgraded task page");
    }
    expect(pageState.task.id).toBe(startedChat.taskId);
    expect(pageState.task.type).toBe("lp_generation");
    expect(pageState.snapshot?.currentPageVersion?.reviewStatus).toBe("passed");
  });

  describe("streaming chat prompt", () => {
    it("starts an ordinary chat stream and persists refreshable messages", async () => {
      const repositories = createInMemoryWorkbenchRepositories();
      const store = createWebWorkbenchStore({ repositories });

      const started = await store.startStreamingChatPrompt({
        projectId: null,
        taskId: null,
        prompt: "Help me write a campaign plan."
      });

      expect(started.ok).toBe(true);
      if (!started.ok) {
        throw new Error("expected streaming chat start to succeed");
      }
      expect(started.taskType).toBe("general_chat");
      expect(started.chunks.join("")).toBe(started.assistantContent);

      await expect(
        store.completeStreamingChatPrompt({
          taskId: started.taskId,
          messageId: started.assistantMessageId,
          content: started.assistantContent
        })
      ).resolves.toEqual({ ok: true });

      const pageState = await store.getPageState({ taskId: started.taskId });
      expect(pageState.kind).toBe("task_ready");
      if (pageState.kind !== "task_ready") {
        throw new Error("expected task_ready page state");
      }
      expect(pageState.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
      expect(pageState.messages[0]?.content).toBe("Help me write a campaign plan.");
      expect(pageState.messages[1]?.content).toBe(started.assistantContent);
    });

    it("abandons unfinished streaming assistant placeholders before refresh", async () => {
      const repositories = createInMemoryWorkbenchRepositories();
      const store = createWebWorkbenchStore({ repositories });

      const started = await store.startStreamingChatPrompt({
        projectId: null,
        taskId: null,
        prompt: "Help me write a campaign plan."
      });

      expect(started.ok).toBe(true);
      if (!started.ok) {
        throw new Error("expected streaming chat start to succeed");
      }

      await expect(
        store.abandonStreamingChatPrompt({
          taskId: started.taskId,
          messageId: started.assistantMessageId
        })
      ).resolves.toEqual({ ok: true });

      const messages = await repositories.messages.listForTask(started.taskId);
      expect(messages.map((message) => message.role)).toEqual(["user"]);

      const pageState = await store.getPageState({ taskId: started.taskId });
      expect(pageState.kind).toBe("task_ready");
      if (pageState.kind !== "task_ready") {
        throw new Error("expected task_ready page state");
      }
      expect(pageState.messages.map((message) => message.role)).toEqual(["user"]);
    });

    it("abandons cancelled assistant content even after a newer turn is appended", async () => {
      const repositories = createInMemoryWorkbenchRepositories();
      const baseMessages = repositories.messages;
      const oldSaveStarted = deferred();
      const releaseOldSave = deferred();
      let delayedAssistantMessageId: string | undefined;
      repositories.messages = {
        async save(message) {
          if (
            message.id === delayedAssistantMessageId &&
            message.role === "assistant" &&
            message.content === "Late canceled content"
          ) {
            oldSaveStarted.resolve();
            await releaseOldSave.promise;
          }
          await baseMessages.save(message);
        },
        async deleteById(messageId) {
          await baseMessages.deleteById(messageId);
        },
        async listForTask(taskId) {
          return baseMessages.listForTask(taskId);
        },
        async listAll() {
          return baseMessages.listAll();
        }
      };
      const store = createWebWorkbenchStore({ repositories });

      const started = await store.startStreamingChatPrompt({
        projectId: null,
        taskId: null,
        prompt: "Help me write a campaign plan."
      });

      expect(started.ok).toBe(true);
      if (!started.ok) {
        throw new Error("expected streaming chat start to succeed");
      }
      delayedAssistantMessageId = started.assistantMessageId;

      const oldCompletion = store.completeStreamingChatPrompt({
        taskId: started.taskId,
        messageId: started.assistantMessageId,
        content: "Late canceled content"
      });
      await oldSaveStarted.promise;
      await expect(
        store.abandonStreamingChatPrompt({
          taskId: started.taskId,
          messageId: started.assistantMessageId,
          allowPersistedContent: true,
          allowStale: true
        })
      ).resolves.toEqual({ ok: true });

      const nextStarted = await store.startStreamingChatPrompt({
        projectId: null,
        taskId: started.taskId,
        prompt: "Continue the campaign plan."
      });
      expect(nextStarted.ok).toBe(true);
      if (!nextStarted.ok) {
        throw new Error("expected next streaming chat start to succeed");
      }
      await expect(
        store.completeStreamingChatPrompt({
          taskId: nextStarted.taskId,
          messageId: nextStarted.assistantMessageId,
          content: "Newer completed content."
        })
      ).resolves.toEqual({ ok: true });

      releaseOldSave.resolve();
      await expect(oldCompletion).resolves.toEqual({ ok: true });
      await expect(
        store.abandonStreamingChatPrompt({
          taskId: started.taskId,
          messageId: started.assistantMessageId,
          allowPersistedContent: true,
          allowStale: true
        })
      ).resolves.toEqual({ ok: true });

      const messages = await repositories.messages.listForTask(started.taskId);
      expect(messages.map((message) => [message.role, message.content])).toEqual([
        ["user", "Help me write a campaign plan."],
        ["user", "Continue the campaign plan."],
        ["assistant", "Newer completed content."]
      ]);
    });

    it("streams project-bound assistant runtime content with safe context summary", async () => {
      const repositories = createInMemoryWorkbenchRepositories();
      const store = createWebWorkbenchStore({ repositories });
      const project = await store.createProject({ name: "Spring Campaign" });

      const started = await store.startStreamingChatPrompt({
        projectId: project.id,
        taskId: null,
        prompt: "How should this page sound?"
      });

      expect(started).toMatchObject({
        ok: true,
        projectId: project.id,
        contextSummary: {
          projectId: project.id,
          projectName: "Spring Campaign",
          runtimeMode: "deterministic",
          skillCount: 0,
          skills: []
        }
      });
      if (!started.ok) {
        throw new Error("Expected streaming chat start");
      }
      expect(started.assistantContent).toContain("assistant response");

      const runs = await repositories.runs.listForTask(started.taskId);
      expect(runs).toEqual([
        expect.objectContaining({
          taskId: started.taskId,
          role: "assistant"
        })
      ]);
      const events = await repositories.runEvents.listForTask(started.taskId);
      expect(events.map((event) => event.runId)).toEqual(
        Array.from({ length: 7 }, () => runs[0]?.id)
      );
      expect(events.map((event) => event.type)).toEqual([
        "run.started",
        "model.stream.started",
        "model.stream.progress",
        "model.stream.completed",
        "runtime.context.loaded",
        "model.completed",
        "run.completed"
      ]);
    });

    it("returns provider assistant streams without persisting token chunks", async () => {
      const repositories = createInMemoryWorkbenchRepositories();
      const runtime = new StreamingRuntime(["Use ", "streaming."], "Use streaming.");
      const store = createWebWorkbenchStore({ repositories, assistantRuntime: runtime });
      const project = await store.createProject({ name: "Spring Campaign" });
      await saveStreamingAssistantRoute(repositories, project.id);

      const started = await store.startStreamingChatPrompt({
        projectId: project.id,
        taskId: null,
        prompt: "How should this page sound?"
      });

      expect(started).toMatchObject({
        ok: true,
        projectId: project.id,
        assistantContent: "",
        chunks: []
      });
      if (!started.ok || !started.assistantStream) {
        throw new Error("Expected provider assistant stream");
      }

      const deltas: string[] = [];
      for await (const delta of started.assistantStream) {
        deltas.push(delta);
      }
      expect(deltas).toEqual(["Use ", "streaming."]);
      await expect(
        store.completeStreamingChatPrompt({
          taskId: started.taskId,
          messageId: started.assistantMessageId,
          content: deltas.join("")
        })
      ).resolves.toEqual({ ok: true });

      const messages = await repositories.messages.listForTask(started.taskId);
      expect(messages.map((message) => message.content)).toEqual([
        "How should this page sound?",
        "Use streaming."
      ]);
      const events = await repositories.runEvents.listForTask(started.taskId);
      expect(events.map((event) => event.type)).toEqual([
        "run.started",
        "model.completed",
        "run.completed"
      ]);
      expect(events.some((event) => event.type === "model.delta")).toBe(false);
    });

    it("announces failed project-bound assistant starts without leaving empty tasks", async () => {
      process.env.REAL_MODEL_RUNTIME = "1";
      const repositories = createInMemoryWorkbenchRepositories();
      const store = createWebWorkbenchStore({ repositories });
      const project = await store.createProject({ name: "Spring Campaign" });

      const started = await store.startStreamingChatPrompt({
        projectId: project.id,
        taskId: null,
        prompt: "How should this page sound?"
      });

      expect(started).toMatchObject({
        ok: false,
        error: "generation_failed",
        taskId: "task_1",
        projectId: project.id
      });
      const tasks = await repositories.tasks.listAll();
      expect(tasks).toEqual([
        expect.objectContaining({
          id: "task_1",
          projectId: project.id,
          type: "general_chat"
        })
      ]);
      const messages = await repositories.messages.listForTask("task_1");
      expect(messages.map((message) => message.role)).toEqual(["user"]);
      expect(messages[0]?.content).toBe("How should this page sound?");
    });

    it("keeps provider configuration failures distinct when assistant streaming cannot start", async () => {
      const repositories = createInMemoryWorkbenchRepositories();
      const store = createWebWorkbenchStore({
        repositories,
        env: { REAL_MODEL_RUNTIME: "1" },
        modelFetch: async () => {
          throw new Error("fetch_should_not_run_for_invalid_route");
        }
      });
      const project = await store.createProject({ name: "Spring Campaign" });
      const provider = await store.createModelProvider({
        projectId: project.id,
        providerId: "provider_openai",
        name: "OpenAI",
        provider: "openai",
        secretEnvName: "OPENAI_API_KEY"
      });
      if (!provider.ok) {
        throw new Error(`Expected provider creation to succeed, got ${provider.error}.`);
      }
      const route = await store.upsertProjectModelRoute({
        projectId: project.id,
        role: "assistant",
        providerId: provider.value.id,
        model: "gpt-5.4"
      });
      if (!route.ok) {
        throw new Error(`Expected route upsert to succeed, got ${route.error}.`);
      }
      await repositories.modelProviders.save({
        ...provider.value,
        enabled: false,
        updatedAt: "2026-05-12T08:10:00.000Z"
      });

      const started = await store.startStreamingChatPrompt({
        projectId: project.id,
        taskId: null,
        prompt: "How should this page sound?"
      });

      expect(started).toMatchObject({
        ok: false,
        error: "provider_configuration_failed",
        taskId: "task_1",
        projectId: project.id
      });
      const messages = await repositories.messages.listForTask("task_1");
      expect(messages.map((message) => message.role)).toEqual(["user"]);
    });

    it("keeps projectless streaming chat deterministic with no context summary skills", async () => {
      const store = createWebWorkbenchStore();

      const started = await store.startStreamingChatPrompt({
        projectId: null,
        taskId: null,
        prompt: "Hello"
      });

      expect(started).toMatchObject({
        ok: true,
        contextSummary: {
          runtimeMode: "deterministic",
          skillCount: 0,
          skills: []
        }
      });
    });

    it("returns fallback_required for LP prompts without creating messages", async () => {
      const repositories = createInMemoryWorkbenchRepositories();
      const store = createWebWorkbenchStore({ repositories });

      const started = await store.startStreamingChatPrompt({
        projectId: null,
        taskId: null,
        prompt: "Create an ecommerce LP in HTML."
      });

      expect(started).toEqual({
        ok: false,
        error: "fallback_required",
        taskType: "lp_generation"
      });
      await expect(repositories.messages.listAll()).resolves.toEqual([]);
    });

    it("rejects a missing project before saving streaming messages", async () => {
      const repositories = createInMemoryWorkbenchRepositories();
      const store = createWebWorkbenchStore({ repositories });

      await expect(
        store.startStreamingChatPrompt({
          projectId: "missing_project",
          taskId: null,
          prompt: "Hello"
        })
      ).resolves.toEqual({ ok: false, error: "project_not_found" });
      await expect(repositories.messages.listAll()).resolves.toEqual([]);
    });

    it("rejects streaming chat reuse when the task belongs to another project", async () => {
      const repositories = createInMemoryWorkbenchRepositories();
      const store = createWebWorkbenchStore({ repositories });
      const projectA = await store.createProject({ name: "Project A" });
      const projectB = await store.createProject({ name: "Project B" });

      const started = await store.startStreamingChatPrompt({
        projectId: projectA.id,
        taskId: null,
        prompt: "Help me write a campaign plan."
      });

      expect(started.ok).toBe(true);
      if (!started.ok) {
        throw new Error("expected streaming chat start to succeed");
      }

      await expect(
        store.startStreamingChatPrompt({
          projectId: projectB.id,
          taskId: started.taskId,
          prompt: "Continue this chat."
        })
      ).resolves.toEqual({ ok: false, error: "project_not_found" });

      const messages = await repositories.messages.listForTask(started.taskId);
      expect(messages.map((message) => message.content)).toEqual([
        "Help me write a campaign plan.",
        ""
      ]);
    });

    it("rejects streaming chat reuse of an LP generation task without appending messages", async () => {
      const repositories = createInMemoryWorkbenchRepositories();
      const store = createWebWorkbenchStore({ repositories });

      const submitted = await store.submitTaskPrompt({
        prompt: "Create an ecommerce LP in HTML.",
        implicitProjectName: "Ecommerce LP"
      });

      expect(submitted.ok).toBe(true);
      if (!submitted.ok) {
        throw new Error("expected LP generation task to be created");
      }
      const originalMessages = await repositories.messages.listForTask(submitted.taskId);

      await expect(
        store.startStreamingChatPrompt({
          projectId: submitted.projectId,
          taskId: submitted.taskId,
          prompt: "Continue this chat."
        })
      ).resolves.toEqual({ ok: false, error: "project_not_found" });

      await expect(repositories.messages.listForTask(submitted.taskId)).resolves.toEqual(
        originalMessages
      );
    });

    it("rejects stale streaming assistant completion without overwriting content", async () => {
      const repositories = createInMemoryWorkbenchRepositories();
      const store = createWebWorkbenchStore({ repositories });

      const started = await store.startStreamingChatPrompt({
        projectId: null,
        taskId: null,
        prompt: "Help me write a campaign plan."
      });

      expect(started.ok).toBe(true);
      if (!started.ok) {
        throw new Error("expected streaming chat start to succeed");
      }

      await expect(
        store.completeStreamingChatPrompt({
          taskId: started.taskId,
          messageId: started.assistantMessageId,
          content: started.assistantContent
        })
      ).resolves.toEqual({ ok: true });

      await expect(
        store.completeStreamingChatPrompt({
          taskId: started.taskId,
          messageId: started.assistantMessageId,
          content: "overwritten content"
        })
      ).resolves.toEqual({ ok: false, error: "generation_failed" });

      const assistant = (await repositories.messages.listForTask(started.taskId)).find(
        (message) => message.id === started.assistantMessageId
      );
      expect(assistant?.content).toBe(started.assistantContent);
    });
  });

  describe("live task prompt start", () => {
    it("returns an LP task before the async chain finishes", async () => {
      let releaseBuilder!: () => void;
      const builderGate = new Promise<void>((resolve) => {
        releaseBuilder = resolve;
      });
      const runtime = {
        async run(input: RuntimeRunRequest) {
          if (input.role === "builder") {
            await builderGate;
          }
          return {
            runId: input.runId,
            projectId: input.projectId,
            role: input.role,
            state: "completed" as const,
            modelOutputText:
              input.role === "planner"
                ? JSON.stringify({
                    ...sampleBrief,
                    title: "Launch a live LP",
                    objective: "Launch a live LP",
                    audience: "Operators",
                    offer: "No-refresh progress",
                    cta: {
                      label: "Start",
                      href: "#start",
                      intent: "primary conversion"
                    },
                    sections: [
                      {
                        ...sampleBrief.sections[0],
                        headline: "Hero",
                        body: "Live progress",
                        cta: {
                          label: "Start",
                          href: "#start",
                          intent: "primary conversion"
                        }
                      }
                    ]
                  })
                : JSON.stringify({
                    indexHtml:
                      '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Live</title><link rel="stylesheet" href="styles.css"></head><body><main><h1>Live</h1></main><script src="script.js"></script></body></html>',
                    stylesCss: ":root { color-scheme: light; } body { margin: 0; }",
                    scriptJs: "window.lpAgent = { ready: true };"
                  }),
            events: [
              {
                type: "run.completed" as const,
                message: `${input.role} run completed.`,
                runId: input.runId,
                role: input.role,
                state: "completed" as const
              }
            ]
          };
        }
      };
      const store = createWebWorkbenchStore({
        env: { REAL_MODEL_RUNTIME: "1" },
        modelFetch: async () => new Response("{}"),
        plannerRuntime: runtime,
        builderRuntime: runtime
      });

      const started = await store.startLiveTaskPrompt({
        projectId: null,
        taskId: null,
        prompt: "Create a live progress LP",
        implicitProjectName: "Live Progress"
      });

      expect(started).toMatchObject({
        ok: true,
        taskType: "lp_generation"
      });
      if (!started.ok || !started.projectId) {
        throw new Error("expected started LP task");
      }

      const runningState = await store.getLiveTaskState({
        projectId: started.projectId,
        taskId: started.taskId
      });
      expect(runningState.ok).toBe(true);
      if (!runningState.ok) {
        throw new Error("expected running state");
      }
      expect(runningState.value.messages[0]?.content).toBe("Create a live progress LP");
      expect(runningState.value.snapshot?.currentPageVersion).toBeUndefined();

      releaseBuilder();
      await started.completion;

      const completedState = await store.getLiveTaskState({
        projectId: started.projectId,
        taskId: started.taskId
      });
      expect(completedState.ok).toBe(true);
      if (!completedState.ok) {
        throw new Error("expected completed state");
      }
      expect(completedState.value.artifactProgress?.fileCount).toBe(3);
    });

    it("does not surface the previous project page while a new live LP task has no scoped snapshot yet", async () => {
      const repositories = createInMemoryWorkbenchRepositories();
      const plannerResult = deferred<Partial<RuntimeRunResult>>();
      const plannerRuntime: AgentRuntimeAdapter = {
        async run(request) {
          return new StaticRuntime(await plannerResult.promise).run(request);
        }
      };
      const store = createWebWorkbenchStore({ repositories, plannerRuntime });
      const project = await store.createProject({
        name: "Spring LP"
      });
      await saveManualPageVersion({
        repositories,
        projectId: project.id,
        briefId: "brief_previous",
        pageVersionId: "version_previous",
        workspaceId: "artifact_workspace_previous",
        artifacts: completeArtifacts(),
        createdAt: "2026-05-21T00:00:00.000Z"
      });

      const started = await store.startLiveTaskPrompt({
        projectId: project.id,
        prompt: "Create a new landing page for a spring sale",
        implicitProjectName: "Spring Sale"
      });
      expect(started).toMatchObject({ ok: true, taskId: "task_1", projectId: project.id });
      if (!started.ok || !started.projectId) {
        throw new Error("expected live task to start");
      }

      const live = await store.getLiveTaskState({
        projectId: project.id,
        taskId: started.taskId
      });

      expect(live.ok).toBe(true);
      if (!live.ok) {
        throw new Error("expected live task state");
      }
      expect(live.value.snapshot?.currentPageVersion).toBeUndefined();
      expect(live.value.artifactProgress).toBeUndefined();

      plannerResult.resolve({ state: "failed" });
      await expect(started.completion).resolves.toMatchObject({
        ok: false,
        error: "generation_failed"
      });
    });
  });

  it("creates an LP task and user message before Planner runs", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const plannerRuntime = new StaticRuntime({ state: "failed" });
    const store = createWebWorkbenchStore({ repositories, plannerRuntime });

    const result = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Spring Sale",
      projectId: null
    });

    expect(result).toMatchObject({
      ok: false,
      error: "generation_failed",
      taskType: "lp_generation"
    });
    if (result.ok) {
      throw new Error("expected generation failure");
    }
    expect(result.taskId).toBe("task_1");
    expect(result.projectId).toBe("project_1");

    await expect(repositories.tasks.getById("task_1")).resolves.toMatchObject({
      id: "task_1",
      type: "lp_generation",
      projectId: "project_1"
    });
    await expect(repositories.messages.listForTask("task_1")).resolves.toEqual([
      expect.objectContaining({
        id: "message_1",
        role: "user",
        content: "Create a landing page for a spring sale"
      }),
      expect.objectContaining({
        id: "message_2",
        role: "assistant",
        content: "LP generation failed. Open recovery details for the failed run."
      })
    ]);
    await expect(repositories.taskSnapshots.getByTaskId("task_1")).resolves.toMatchObject({
      taskId: "task_1",
      projectId: "project_1"
    });
  });

  it("saves a helpful LP failure message when the model provider times out", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const plannerRuntime: AgentRuntimeAdapter = {
      async run(request: RuntimeRunRequest): Promise<RuntimeRunResult> {
        return {
          runId: request.runId,
          projectId: request.projectId,
          role: request.role,
          state: "failed",
          events: [
            {
              type: "run.started",
              message: `${request.role} run started.`,
              runId: request.runId,
              role: request.role
            },
            {
              type: "model.retry.exhausted",
              message: `${request.role} model retry exhausted`,
              runId: request.runId,
              role: request.role,
              attempts: 2,
              errorCode: "model_provider_request_timeout"
            },
            {
              type: "run.failed",
              message: `${request.role} model provider failed`,
              runId: request.runId,
              role: request.role,
              state: "failed",
              errorName: "ModelProviderRequestError",
              errorCode: "model_provider_request_timeout"
            }
          ]
        };
      }
    };
    const store = createWebWorkbenchStore({ repositories, plannerRuntime });

    const result = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Spring Sale",
      projectId: null
    });

    expect(result).toMatchObject({
      ok: false,
      error: "generation_failed",
      taskType: "lp_generation"
    });
    await expect(repositories.messages.listForTask("task_1")).resolves.toEqual([
      expect.objectContaining({
        role: "user",
        content: "Create a landing page for a spring sale"
      }),
      expect.objectContaining({
        role: "assistant",
        content:
          "Model provider timed out while generating the LP. Retry the task, or increase LP_AGENT_MODEL_PROVIDER_TIMEOUT_MS in .env.local if the provider is slow."
      })
    ]);
  });

  it("returns a failed LP task with recovery facts when Planner fails", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({
      repositories,
      plannerRuntime: new StaticRuntime({ state: "failed" })
    });

    const result = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Spring Sale",
      projectId: null
    });

    expect(result).toMatchObject({
      ok: false,
      error: "generation_failed",
      taskId: "task_1",
      projectId: "project_1"
    });
    await expect(repositories.briefs.listAll()).resolves.toEqual([]);
    await expect(repositories.pageVersions.listAll()).resolves.toEqual([]);
    const pageState = await store.getPageState({ projectId: "project_1", taskId: "task_1" });
    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("expected task state");
    }
    expect(pageState.runEvents.map((event) => event.runId)).toContain("run_planner_brief_1");
    expect(pageState.recovery.runs.map((view) => view.runId)).toContain("run_planner_brief_1");
  });

  it("does not save page versions when Builder fails under an LP task", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({
      repositories,
      builderRuntime: new StaticRuntime({ state: "failed" })
    });

    const result = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Spring Sale",
      projectId: null
    });

    expect(result).toMatchObject({
      ok: false,
      error: "generation_failed",
      taskId: "task_1",
      projectId: "project_1"
    });
    await expect(repositories.briefs.listAll()).resolves.toHaveLength(1);
    await expect(repositories.pageVersions.listAll()).resolves.toEqual([]);
    await expect(repositories.artifactWorkspaces.listAll()).resolves.toEqual([]);
    await expect(repositories.taskSnapshots.getByTaskId("task_1")).resolves.toMatchObject({
      projectId: "project_1",
      briefId: "brief_1"
    });
  });

  it("runs Planner Builder Reviewer and Deployer under the same LP task", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const plannerRuntime = new RecordingRuntime({ state: "completed" });
    const builderRuntime = new RecordingRuntime({
      state: "completed",
      artifacts: completeArtifacts()
    });
    const reviewerRuntime = new RecordingRuntime({ state: "completed", findings: [] });
    const deployerRuntime = new RecordingRuntime({ state: "completed" });
    const store = createWebWorkbenchStore({
      repositories,
      plannerRuntime,
      builderRuntime,
      reviewerRuntime,
      deployerRuntime
    });

    const result = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Spring Sale",
      projectId: null
    });

    expect(result).toEqual({
      ok: true,
      taskId: "task_1",
      taskType: "lp_generation",
      projectId: "project_1"
    });

    const taskRuns = await repositories.runs.listForTask("task_1");
    expect(taskRuns.filter((run) => run.role !== "assistant")).toEqual([
      expect.objectContaining({ id: "run_planner_brief_1", role: "planner", taskId: "task_1" }),
      expect.objectContaining({ id: "run_builder_version_1", role: "builder", taskId: "task_1" }),
      expect.objectContaining({ id: "run_reviewer_version_1", role: "reviewer", taskId: "task_1" }),
      expect.objectContaining({ id: "run_deployer_version_1", role: "deployer", taskId: "task_1" })
    ]);
    expect(taskRuns).toContainEqual(
      expect.objectContaining({
        id: "run_task_followups_1",
        role: "assistant",
        taskId: "task_1"
      })
    );
    await expect(repositories.taskSnapshots.getByTaskId("task_1")).resolves.toMatchObject({
      projectId: "project_1",
      briefId: "brief_1",
      pageVersionId: "version_1"
    });
    await expect(repositories.deployments.getByPageVersionId("version_1")).resolves.toMatchObject({
      pageVersionId: "version_1"
    });
    await expect(repositories.messages.listForTask("task_1")).resolves.toEqual([
      expect.objectContaining({ role: "user" }),
      expect.objectContaining({
        role: "assistant",
        content: "LP 页面文件已准备好，可以预览和继续调整。"
      })
    ]);
  });

  it("keeps blocked Reviewer results without creating a Deployer run", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const reviewerRuntime = new RecordingRuntime({
      state: "completed",
      findings: [
        {
          severity: "blocking",
          target: "hero.cta",
          explanation: "Missing call to action.",
          suggestedFix: "Add a primary CTA.",
          blocksDeployment: true
        }
      ]
    });
    const deployerRuntime = new RecordingRuntime({ state: "completed" });
    const store = createWebWorkbenchStore({ repositories, reviewerRuntime, deployerRuntime });

    const result = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Spring Sale",
      projectId: null
    });

    expect(result).toEqual({
      ok: true,
      taskId: "task_1",
      taskType: "lp_generation",
      projectId: "project_1"
    });
    await expect(repositories.runs.getById("run_deployer_version_1")).resolves.toBeUndefined();
    await expect(repositories.pageVersions.getById("version_1")).resolves.toMatchObject({
      reviewStatus: "failed"
    });
    const pageState = await store.getPageState({ projectId: "project_1", taskId: "task_1" });
    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("expected task state");
    }
    expect(pageState.recovery.runs.some((view) => view.state === "blocked")).toBe(true);
    expect(pageState.messages[1]?.content).toBe(
      "LP 页面已生成，但质量检查发现需要处理的问题。"
    );
  });

  it("continues an existing LP task by creating a new page version", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const assistantRuntime = new QueuedRuntime([
      { modelOutputText: JSON.stringify([]) },
      {
        modelOutputText: JSON.stringify({
          type: "agent_continue",
          confidence: 0.91,
          reason: "The user is requesting an artifact change."
        })
      },
      { modelOutputText: JSON.stringify([]) }
    ]);
    const builderRuntime = new RecordingRuntime({
      state: "completed",
      artifacts: completeArtifacts()
    });
    const store = createWebWorkbenchStore({ repositories, assistantRuntime, builderRuntime });

    const first = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Spring Sale",
      projectId: null
    });
    expect(first).toMatchObject({ ok: true, taskId: "task_1", projectId: "project_1" });
    if (!first.ok || !first.projectId) {
      throw new Error("expected first LP task");
    }
    await saveManualPageVersion({
      repositories,
      projectId: first.projectId,
      briefId: "brief_external",
      pageVersionId: "version_external",
      workspaceId: "artifact_workspace_external",
      artifacts: {
        indexHtml: "<!doctype html><html><body>External latest</body></html>",
        stylesCss: "body { color: #abcdef; }",
        scriptJs: "window.lpAgent = 'external';"
      },
      createdAt: "2026-05-22T00:02:00.000Z"
    });

    const second = await store.submitTaskPrompt({
      taskId: first.taskId,
      projectId: first.projectId,
      prompt: "make it shorter",
      implicitProjectName: "Spring Sale"
    });

    expect(second).toEqual({
      ok: true,
      taskId: "task_1",
      taskType: "lp_generation",
      projectId: "project_1"
    });
    await expect(repositories.pageVersions.listAll()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "version_1" }),
        expect.objectContaining({ id: "version_2" })
      ])
    );
    await expect(repositories.taskSnapshots.getByTaskId("task_1")).resolves.toMatchObject({
      briefId: "brief_2",
      pageVersionId: "version_2"
    });
    expect(builderRuntime.requests.at(-1)?.context?.artifactWorkspace.workspaceId).toBe(
      "artifact_workspace_1"
    );
    const pageState = await store.getPageState({
      projectId: first.projectId,
      taskId: first.taskId
    });
    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("expected task page state");
    }
    expect(pageState.artifactDiff?.previousPageVersionId).toBe("version_1");
    expect(pageState.artifactDiff?.files.map((file) => [file.path, file.state])).toEqual([
      ["index.html", "unchanged"],
      ["styles.css", "unchanged"],
      ["script.js", "unchanged"]
    ]);
    const messages = await repositories.messages.listForTask("task_1");
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant"
    ]);
  });

  it("answers ordinary questions inside an LP task without running the LP chain", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const assistantRuntime = new QueuedRuntime([
      { modelOutputText: JSON.stringify([]) },
      {
        modelOutputText: JSON.stringify({
          type: "chat_in_task",
          confidence: 0.93,
          reason: "The user is asking about the current task."
        })
      },
      { modelOutputText: "The landing page currently targets a spring sale campaign." },
      { modelOutputText: JSON.stringify([]) }
    ]);
    const builderRuntime = new RecordingRuntime({
      state: "completed",
      artifacts: completeArtifacts()
    });
    const store = createWebWorkbenchStore({ repositories, assistantRuntime, builderRuntime });

    const first = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Spring Sale",
      projectId: null
    });
    expect(first).toMatchObject({ ok: true, taskId: "task_1", projectId: "project_1" });
    if (!first.ok || !first.projectId) {
      throw new Error("expected first LP task");
    }
    const builderCallsAfterFirst = builderRuntime.requests.length;

    const second = await store.submitTaskPrompt({
      taskId: first.taskId,
      projectId: first.projectId,
      prompt: "What audience is this page for?",
      implicitProjectName: "Spring Sale"
    });

    expect(second).toEqual({
      ok: true,
      taskId: first.taskId,
      taskType: "lp_generation",
      projectId: first.projectId
    });
    expect(builderRuntime.requests).toHaveLength(builderCallsAfterFirst);
    await expect(repositories.messages.listForTask(first.taskId)).resolves.toEqual([
      expect.objectContaining({ role: "user" }),
      expect.objectContaining({ role: "assistant" }),
      expect.objectContaining({
        role: "user",
        content: "What audience is this page for?"
      }),
      expect.objectContaining({
        role: "assistant",
        content: "The landing page currently targets a spring sale campaign."
      })
    ]);
  });

  it("continues an LP task when the router classifies the prompt as agent continuation", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const assistantRuntime = new QueuedRuntime([
      { modelOutputText: JSON.stringify([]) },
      {
        modelOutputText: JSON.stringify({
          type: "agent_continue",
          confidence: 0.91,
          reason: "The user is requesting an artifact change."
        })
      },
      { modelOutputText: JSON.stringify([]) }
    ]);
    const builderRuntime = new RecordingRuntime({
      state: "completed",
      artifacts: completeArtifacts()
    });
    const store = createWebWorkbenchStore({ repositories, assistantRuntime, builderRuntime });

    const first = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Spring Sale",
      projectId: null
    });
    expect(first).toMatchObject({ ok: true, taskId: "task_1", projectId: "project_1" });
    if (!first.ok || !first.projectId) {
      throw new Error("expected first LP task");
    }
    const builderCallsAfterFirst = builderRuntime.requests.length;

    const second = await store.submitTaskPrompt({
      taskId: first.taskId,
      projectId: first.projectId,
      prompt: "Add a testimonials section",
      implicitProjectName: "Spring Sale"
    });

    expect(second).toEqual({
      ok: true,
      taskId: first.taskId,
      taskType: "lp_generation",
      projectId: first.projectId
    });
    expect(builderRuntime.requests.length).toBeGreaterThan(builderCallsAfterFirst);
    await expect(repositories.pageVersions.getById("version_2")).resolves.toMatchObject({
      id: "version_2"
    });
  });

  it("creates a new LP task in the same project when the router classifies a new task", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const assistantRuntime = new QueuedRuntime([
      { modelOutputText: JSON.stringify([]) },
      {
        modelOutputText: JSON.stringify({
          type: "agent_new_task",
          confidence: 0.9,
          reason: "The user is requesting a separate LP."
        })
      },
      { modelOutputText: JSON.stringify([]) }
    ]);
    const store = createWebWorkbenchStore({ repositories, assistantRuntime });

    const first = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Spring Sale",
      projectId: null
    });
    expect(first).toMatchObject({ ok: true, taskId: "task_1", projectId: "project_1" });
    if (!first.ok || !first.projectId) {
      throw new Error("expected first LP task");
    }

    const second = await store.submitTaskPrompt({
      taskId: first.taskId,
      projectId: first.projectId,
      prompt: "Create a landing page for a summer sale",
      implicitProjectName: "Summer Sale"
    });

    expect(second).toMatchObject({
      ok: true,
      taskType: "lp_generation",
      projectId: first.projectId
    });
    if (!second.ok) {
      throw new Error("expected second LP task");
    }
    expect(second.taskId).not.toBe(first.taskId);
  });

  it("exposes LP follow-up suggestions from the service and keeps general tasks empty", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const suggestions = [
      { id: "ask", intent: "chat_in_task", prompt: "What changed in this version?" },
      { id: "continue", intent: "agent_continue", prompt: "Make the hero more direct." }
    ];
    const assistantRuntime = new QueuedRuntime([
      { modelOutputText: JSON.stringify(suggestions) }
    ]);
    const store = createWebWorkbenchStore({ repositories, assistantRuntime });

    const lpTask = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Spring Sale",
      projectId: null
    });
    expect(lpTask).toMatchObject({ ok: true, taskId: "task_1", projectId: "project_1" });
    if (!lpTask.ok || !lpTask.projectId) {
      throw new Error("expected LP task");
    }

    const assistantCallsAfterWrite = assistantRuntime.requests.length;
    const followupRunsAfterWrite = (await repositories.runs.listAll()).filter((run) =>
      run.id.startsWith("run_task_followups_")
    );
    expect(assistantCallsAfterWrite).toBe(1);
    expect(followupRunsAfterWrite).toHaveLength(1);

    const lpState = await store.getPageState({
      projectId: lpTask.projectId,
      taskId: lpTask.taskId
    });
    expect(lpState.kind).toBe("task_ready");
    if (lpState.kind !== "task_ready") {
      throw new Error("expected LP task state");
    }
    expect(lpState.taskFollowupSuggestions).toEqual(suggestions);
    expect(assistantRuntime.requests).toHaveLength(assistantCallsAfterWrite);
    await expect(repositories.runs.listAll()).resolves.toEqual(
      expect.arrayContaining(followupRunsAfterWrite)
    );

    const generalTask = await store.submitTaskPrompt({
      prompt: "Help me write a launch checklist.",
      implicitProjectName: "Untitled LP Project"
    });
    expect(generalTask.ok).toBe(true);
    if (!generalTask.ok) {
      throw new Error("expected general task");
    }
    const generalState = await store.getPageState({ taskId: generalTask.taskId });
    expect(generalState.kind).toBe("task_ready");
    if (generalState.kind !== "task_ready") {
      throw new Error("expected general task state");
    }
    expect(generalState.taskFollowupSuggestions).toEqual([]);
  });

  it("returns cached LP follow-up suggestions without creating assistant runs on page reads", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const suggestions = [
      { id: "ask", intent: "chat_in_task", prompt: "What changed in this version?" }
    ];
    const assistantRuntime = new QueuedRuntime([
      { modelOutputText: JSON.stringify(suggestions) },
      { modelOutputText: JSON.stringify([]) },
      { modelOutputText: JSON.stringify([]) }
    ]);
    const store = createWebWorkbenchStore({ repositories, assistantRuntime });

    const task = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Spring Sale",
      projectId: null
    });
    expect(task).toMatchObject({ ok: true, taskId: "task_1", projectId: "project_1" });
    if (!task.ok || !task.projectId) {
      throw new Error("expected LP task");
    }

    const assistantCallsAfterWrite = assistantRuntime.requests.length;
    const followupRunsAfterWrite = (await repositories.runs.listAll()).filter((run) =>
      run.id.startsWith("run_task_followups_")
    );

    const firstRead = await store.getPageState({ projectId: task.projectId, taskId: task.taskId });
    const secondRead = await store.getPageState({ projectId: task.projectId, taskId: task.taskId });

    expect(firstRead.kind).toBe("task_ready");
    expect(secondRead.kind).toBe("task_ready");
    if (firstRead.kind !== "task_ready" || secondRead.kind !== "task_ready") {
      throw new Error("expected task-ready states");
    }
    expect(firstRead.taskFollowupSuggestions).toEqual(suggestions);
    expect(secondRead.taskFollowupSuggestions).toEqual(suggestions);
    expect(assistantRuntime.requests).toHaveLength(assistantCallsAfterWrite);
    const followupRunsAfterReads = (await repositories.runs.listAll()).filter((run) =>
      run.id.startsWith("run_task_followups_")
    );
    expect(followupRunsAfterReads).toEqual(followupRunsAfterWrite);
  });

  it("does not create follow-up assistant runs while reading live LP task state", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const suggestions = [
      { id: "ask", intent: "chat_in_task", prompt: "What changed in this version?" }
    ];
    const assistantRuntime = new QueuedRuntime([
      { modelOutputText: JSON.stringify(suggestions) },
      { modelOutputText: JSON.stringify([]) }
    ]);
    const store = createWebWorkbenchStore({ repositories, assistantRuntime });

    const task = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Spring Sale",
      projectId: null
    });
    expect(task).toMatchObject({ ok: true, taskId: "task_1", projectId: "project_1" });
    if (!task.ok || !task.projectId) {
      throw new Error("expected LP task");
    }
    const assistantCallsAfterWrite = assistantRuntime.requests.length;
    const followupRunsAfterWrite = (await repositories.runs.listAll()).filter((run) =>
      run.id.startsWith("run_task_followups_")
    );

    const liveState = await store.getLiveTaskState({
      projectId: task.projectId,
      taskId: task.taskId
    });
    const secondLiveState = await store.getLiveTaskState({
      projectId: task.projectId,
      taskId: task.taskId
    });

    expect(liveState.ok).toBe(true);
    expect(secondLiveState.ok).toBe(true);
    expect(assistantRuntime.requests).toHaveLength(assistantCallsAfterWrite);
    const followupRunsAfterLiveReads = (await repositories.runs.listAll()).filter((run) =>
      run.id.startsWith("run_task_followups_")
    );
    expect(followupRunsAfterLiveReads).toEqual(followupRunsAfterWrite);
  });

  it("keeps live LP state polling until follow-up suggestions are cached", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const suggestions = [
      { id: "ask", intent: "chat_in_task", prompt: "What changed in this version?" }
    ];
    const followupResult = deferred<Partial<RuntimeRunResult>>();
    const assistantRequests: RuntimeRunRequest[] = [];
    const assistantRuntime: AgentRuntimeAdapter & { requests: RuntimeRunRequest[] } = {
      requests: assistantRequests,
      async run(request) {
        assistantRequests.push(request);
        return new StaticRuntime(await followupResult.promise).run(request);
      }
    };
    const store = createWebWorkbenchStore({ repositories, assistantRuntime });

    const started = await store.startLiveTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Spring Sale",
      projectId: null
    });
    expect(started).toMatchObject({ ok: true, taskId: "task_1", projectId: "project_1" });
    if (!started.ok || !started.projectId) {
      throw new Error("expected LP task");
    }

    await vi.waitFor(async () => {
      const pageState = await store.getPageState({
        projectId: started.projectId,
        taskId: started.taskId
      });
      expect(pageState.kind).toBe("task_ready");
      if (pageState.kind !== "task_ready") {
        throw new Error("expected task state");
      }
      expect(pageState.snapshot?.currentPageVersion).toBeDefined();
      expect(pageState.taskFollowupSuggestionsReady).toBe(false);
    });

    const beforeFollowups = await store.getLiveTaskState({
      projectId: started.projectId,
      taskId: started.taskId
    });
    expect(beforeFollowups.ok).toBe(true);
    if (!beforeFollowups.ok) {
      throw new Error("expected live task state");
    }
    expect(beforeFollowups.value.isTerminal).toBe(false);
    expect(beforeFollowups.value.artifactProgress).toMatchObject({
      artifactWorkspaceId: expect.any(String),
      fileCount: 3,
      changedFileCount: 3
    });

    followupResult.resolve({ modelOutputText: JSON.stringify(suggestions) });
    await expect(started.completion).resolves.toMatchObject({ ok: true });

    const afterFollowups = await store.getLiveTaskState({
      projectId: started.projectId,
      taskId: started.taskId
    });
    expect(afterFollowups.ok).toBe(true);
    if (!afterFollowups.ok) {
      throw new Error("expected live task state");
    }
    expect(afterFollowups.value.isTerminal).toBe(true);
    expect(afterFollowups.value.artifactProgress).toBeDefined();

    const pageState = await store.getPageState({
      projectId: started.projectId,
      taskId: started.taskId
    });
    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("expected task state");
    }
    expect(pageState.taskFollowupSuggestionsReady).toBe(true);
    expect(pageState.taskFollowupSuggestions).toEqual(suggestions);
  });

  it("treats completed LP task as terminal when the follow-up suggestion cache is missing", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const suggestions = [
      { id: "ask", intent: "chat_in_task", prompt: "What changed in this version?" }
    ];
    const assistantRuntime = new StaticRuntime({
      modelOutputText: JSON.stringify(suggestions)
    });
    const store = createWebWorkbenchStore({ repositories, assistantRuntime });

    const started = await store.startLiveTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Spring Sale",
      projectId: null
    });
    expect(started).toMatchObject({ ok: true, taskId: "task_1", projectId: "project_1" });
    if (!started.ok || !started.projectId) {
      throw new Error("expected LP task");
    }
    await expect(started.completion).resolves.toMatchObject({ ok: true });

    const restartedStore = createWebWorkbenchStore({ repositories, assistantRuntime });
    const liveState = await restartedStore.getLiveTaskState({
      projectId: started.projectId,
      taskId: started.taskId
    });

    expect(liveState.ok).toBe(true);
    if (!liveState.ok) {
      throw new Error("expected live task state");
    }
    expect(liveState.value.isTerminal).toBe(true);

    const restartedPageState = await restartedStore.getPageState({
      projectId: started.projectId,
      taskId: started.taskId
    });
    expect(restartedPageState.kind).toBe("task_ready");
    if (restartedPageState.kind !== "task_ready") {
      throw new Error("expected task state");
    }
    expect(restartedPageState.taskFollowupSuggestionsReady).toBe(false);
  });

  it("asks for clarification without running the LP chain when router confidence is low", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const assistantRuntime = new QueuedRuntime([
      { modelOutputText: JSON.stringify([]) },
      {
        modelOutputText: JSON.stringify({
          type: "agent_continue",
          confidence: 0.2,
          reason: "Ambiguous request."
        })
      },
      { modelOutputText: JSON.stringify([]) }
    ]);
    const builderRuntime = new RecordingRuntime({
      state: "completed",
      artifacts: completeArtifacts()
    });
    const store = createWebWorkbenchStore({ repositories, assistantRuntime, builderRuntime });

    const first = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Spring Sale",
      projectId: null
    });
    expect(first).toMatchObject({ ok: true, taskId: "task_1", projectId: "project_1" });
    if (!first.ok || !first.projectId) {
      throw new Error("expected first LP task");
    }
    const builderCallsAfterFirst = builderRuntime.requests.length;

    const second = await store.submitTaskPrompt({
      taskId: first.taskId,
      projectId: first.projectId,
      prompt: "Can you handle that?",
      implicitProjectName: "Spring Sale"
    });

    expect(second).toEqual({
      ok: true,
      taskId: first.taskId,
      taskType: "lp_generation",
      projectId: first.projectId
    });
    expect(builderRuntime.requests).toHaveLength(builderCallsAfterFirst);
    await expect(repositories.messages.listForTask(first.taskId)).resolves.toEqual([
      expect.objectContaining({ role: "user" }),
      expect.objectContaining({ role: "assistant" }),
      expect.objectContaining({
        role: "user",
        content: "Can you handle that?"
      }),
      expect.objectContaining({
        role: "assistant",
        content:
          "Do you want me to answer this in chat, continue the current LP task, or create a new LP task?"
      })
    ]);
  });

  it("clears the current page version when Builder fails during a continued LP task", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const assistantRuntime = new QueuedRuntime([
      { modelOutputText: JSON.stringify([]) },
      {
        modelOutputText: JSON.stringify({
          type: "agent_continue",
          confidence: 0.91,
          reason: "The user is requesting an artifact change."
        })
      },
      { modelOutputText: JSON.stringify([]) }
    ]);
    const builderRuntime = new (class extends StaticRuntime {
      private calls = 0;

      constructor() {
        super({ state: "completed", artifacts: completeArtifacts() });
      }

      override async run(request: RuntimeRunRequest): Promise<RuntimeRunResult> {
        this.calls += 1;
        if (this.calls === 1) {
          return new StaticRuntime({ state: "completed", artifacts: completeArtifacts() }).run(
            request
          );
        }
        return new StaticRuntime({ state: "failed" }).run(request);
      }
    })();
    const store = createWebWorkbenchStore({ repositories, assistantRuntime, builderRuntime });

    const first = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Spring Sale",
      projectId: null
    });
    expect(first).toMatchObject({ ok: true, taskId: "task_1", projectId: "project_1" });
    if (!first.ok || !first.projectId) {
      throw new Error("expected first LP task");
    }

    const second = await store.submitTaskPrompt({
      taskId: first.taskId,
      projectId: first.projectId,
      prompt: "Make the hero CTA more urgent and add a FAQ section",
      implicitProjectName: "Spring Sale"
    });

    expect(second).toMatchObject({
      ok: false,
      error: "generation_failed",
      taskId: "task_1",
      projectId: "project_1"
    });
    await expect(repositories.taskSnapshots.getByTaskId("task_1")).resolves.toMatchObject({
      projectId: "project_1",
      briefId: "brief_2",
      pageVersionId: undefined
    });
    const pageState = await store.getPageState({ projectId: first.projectId, taskId: first.taskId });
    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("expected task state");
    }
    expect(pageState.snapshot?.brief?.id).toBe("brief_2");
    expect(pageState.snapshot?.currentPageVersion).toBeUndefined();
    expect(pageState.artifactDiff).toBeUndefined();
  });

  it("keeps the page version when Deployer fails", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const deployerRuntime = new StaticRuntime({ state: "failed" });
    const store = createWebWorkbenchStore({ repositories, deployerRuntime });

    const result = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Spring Sale",
      projectId: null
    });

    expect(result).toMatchObject({
      ok: false,
      error: "generation_failed",
      taskId: "task_1",
      projectId: "project_1"
    });
    await expect(repositories.pageVersions.getById("version_1")).resolves.toMatchObject({
      id: "version_1",
      reviewStatus: "passed"
    });
    await expect(repositories.deployments.getByPageVersionId("version_1")).resolves.toBeUndefined();
  });

  it("submits a project setup task without creating an implicit project", async () => {
    const store = createWebWorkbenchStore();

    const result = await store.submitTaskPrompt({
      prompt: "create project for spring campaign",
      implicitProjectName: "Untitled LP Project"
    });

    expect(result).toEqual({
      ok: true,
      taskId: "task_1",
      taskType: "project_setup",
      projectId: undefined
    });

    const pageState = await store.getPageState({
      taskId: "task_1"
    });

    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageState.projects).toEqual([]);
    expect(pageState.projectMembers).toEqual([]);
    expect(pageState.task).toMatchObject({
      id: "task_1",
      type: "project_setup",
      projectId: undefined
    });
    expect(pageState.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(pageState.messages[0]?.content).toBe("create project for spring campaign");
    expect(pageState.messages[1]?.content).toBe(
      "I created a task thread and can continue from here."
    );
  });

  it("shows a general task when the caller passes a project id", async () => {
    const store = createWebWorkbenchStore();

    await store.submitTaskPrompt({
      prompt: "帮我写一个双 11 活动方案",
      implicitProjectName: "未命名 LP 项目"
    });

    const pageState = await store.getPageState({
      projectId: "project_missing",
      taskId: "task_1"
    });

    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageState.task).toMatchObject({
      id: "task_1",
      type: "general_chat",
      projectId: undefined
    });
    expect(pageState.snapshot).toBeUndefined();
  });

  it("does not expose artifact diff state for general tasks", async () => {
    const store = createWebWorkbenchStore();

    const result = await store.submitTaskPrompt({
      prompt: "Help me write a campaign plan.",
      implicitProjectName: "Untitled LP Project"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected task creation.");
    }

    const pageState = await store.getPageState({
      taskId: result.taskId
    });

    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageState.artifactDiff).toBeUndefined();
  });

  it("submits an LP task without a project by creating an implicit local project", async () => {
    const store = createWebWorkbenchStore();

    const result = await store.submitTaskPrompt({
      prompt: "生成一个电商春季促销 LP，输出单文件 HTML",
      implicitProjectName: "未命名 LP 项目"
    });

    expect(result).toEqual({
      ok: true,
      taskId: "task_1",
      taskType: "lp_generation",
      projectId: "project_1"
    });

    const pageState = await store.getPageState({
      projectId: "project_1",
      taskId: "task_1"
    });

    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageState.task).toMatchObject({
      id: "task_1",
      type: "lp_generation",
      projectId: "project_1"
    });
    expect(pageState.projects[0]).toMatchObject({
      id: "project_1",
      name: "生成一个电商春季促销 LP"
    });
    expect(pageState.snapshot).toBeDefined();
    if (!pageState.snapshot) {
      throw new Error("Expected LP snapshot.");
    }
    expect(pageState.snapshot.brief?.prompt).toBe("生成一个电商春季促销 LP，输出单文件 HTML");
    expect(pageState.snapshot.currentPageVersion?.reviewStatus).toBe("passed");
    expect(pageState.snapshot.deployment?.pageVersionId).toBe(
      pageState.snapshot.currentPageVersion?.id
    );
    expect(pageState.messages[1]?.content).toBe("LP 页面文件已准备好，可以预览和继续调整。");
  });

  it("exposes metadata-only initial artifact diff state for completed LP tasks", async () => {
    const store = createWebWorkbenchStore();

    const result = await store.submitTaskPrompt({
      prompt: "生成一个电商春季促销 LP，输出单文件 HTML",
      implicitProjectName: "未命名 LP 项目"
    });
    if (!result.ok || !result.projectId) {
      throw new Error("Expected LP task creation.");
    }

    const pageState = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId
    });

    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageState.artifactDiff).toMatchObject({
      projectId: result.projectId,
      pageVersionId: pageState.snapshot?.currentPageVersion?.id,
      files: [
        {
          path: "index.html",
          state: "initial",
          canPreview: true,
          summary: "index.html static LP file"
        },
        {
          path: "styles.css",
          state: "initial",
          canPreview: true,
          summary: "styles.css static LP file"
        },
        {
          path: "script.js",
          state: "initial",
          canPreview: true,
          summary: "script.js static LP file"
        }
      ]
    });
    expect(pageState.artifactDiff?.previousPageVersionId).toBeUndefined();
    expect(pageState.artifactDiff?.files.every((file) => file.shortSha256?.length === 12)).toBe(
      true
    );
    expect(JSON.stringify(pageState.artifactDiff)).not.toContain("<!doctype html>");
    expect(JSON.stringify(pageState.artifactDiff)).not.toContain("window.lpAgent");
  });

  it("uses task lineage before legacy brief diff when comparing artifact metadata", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });

    const result = await store.submitTaskPrompt({
      prompt: "生成一个电商春季促销 LP，输出单文件 HTML",
      implicitProjectName: "未命名 LP 项目"
    });
    if (!result.ok || !result.projectId) {
      throw new Error("Expected LP task creation.");
    }

    const firstPageState = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId
    });
    expect(firstPageState.kind).toBe("task_ready");
    if (
      firstPageState.kind !== "task_ready" ||
      !firstPageState.snapshot?.brief ||
      !firstPageState.snapshot.currentPageVersion
    ) {
      throw new Error("Expected LP snapshot.");
    }

    const firstPageVersion = firstPageState.snapshot.currentPageVersion;
    const activePageVersionId = "version_after_legacy_previous";
    const activeWorkspaceId = "artifact_workspace_after_legacy_previous";
    const createdAt = "2026-05-18T00:00:00.000Z";

    await repositories.pageVersions.save({
      id: "version_legacy_previous_without_workspace",
      projectId: result.projectId,
      briefId: firstPageState.snapshot.brief.id,
      artifacts: firstPageVersion.artifacts,
      reviewStatus: "passed",
      findings: [],
      createdAt
    });
    await repositories.artifactWorkspaces.save({
      id: activeWorkspaceId,
      projectId: result.projectId,
      pageVersionId: activePageVersionId,
      kind: "static_lp",
      state: "active",
      createdAt,
      updatedAt: createdAt
    });
    for (const file of createStaticArtifactWorkspaceFiles({
      workspaceId: activeWorkspaceId,
      projectId: result.projectId,
      pageVersionId: activePageVersionId,
      artifacts: firstPageVersion.artifacts,
      createdAt
    })) {
      await repositories.artifactWorkspaceFiles.save(file);
    }
    await repositories.pageVersions.save({
      ...firstPageVersion,
      id: activePageVersionId,
      artifactWorkspaceId: activeWorkspaceId,
      createdAt
    });
    await repositories.taskSnapshots.save({
      taskId: result.taskId,
      projectId: result.projectId,
      briefId: firstPageState.snapshot.brief.id,
      pageVersionId: activePageVersionId,
      createdAt
    });

    const pageState = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId
    });

    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageState.artifactDiff?.previousPageVersionId).toBe(firstPageVersion.id);
    expect(pageState.artifactDiff?.files).toMatchObject([
      {
        path: "index.html",
        state: "unchanged",
        canPreview: true
      },
      {
        path: "styles.css",
        state: "unchanged",
        canPreview: true
      },
      {
        path: "script.js",
        state: "unchanged",
        canPreview: true
      }
    ]);
    expect(pageState.artifactDiff?.errorCode).not.toBe("artifact_diff_unavailable");
    expect(JSON.stringify(pageState.artifactDiff)).not.toContain("<!doctype html>");
    expect(JSON.stringify(pageState.artifactDiff)).not.toContain("window.lpAgent");
  });

  it("compares current LP artifacts with the previous page version", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });
    const result = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Untitled LP Project"
    });
    if (!result.ok || !result.projectId) {
      throw new Error("Expected LP task creation.");
    }
    const firstState = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId
    });
    if (firstState.kind !== "task_ready" || !firstState.snapshot?.currentPageVersion) {
      throw new Error("Expected first page version.");
    }
    const firstVersion = firstState.snapshot.currentPageVersion;

    await saveManualPageVersion({
      repositories,
      projectId: result.projectId,
      briefId: firstVersion.briefId,
      pageVersionId: "page_version_changed",
      workspaceId: "artifact_workspace_changed",
      artifacts: {
        ...firstVersion.artifacts,
        stylesCss: `${firstVersion.artifacts.stylesCss}\nbody { color: #123456; }`
      },
      createdAt: "2026-05-19T00:01:00.000Z"
    });
    await repositories.taskSnapshots.save({
      taskId: result.taskId,
      projectId: result.projectId,
      briefId: firstVersion.briefId,
      pageVersionId: "page_version_changed",
      createdAt: "2026-05-19T00:01:00.000Z"
    });

    const changedState = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId
    });

    expect(changedState.kind).toBe("task_ready");
    if (changedState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(changedState.artifactDiff?.previousPageVersionId).toBe(firstVersion.id);
    expect(changedState.artifactDiff?.files.map((file) => [file.path, file.state])).toEqual([
      ["index.html", "unchanged"],
      ["styles.css", "changed"],
      ["script.js", "unchanged"]
    ]);
    expect(JSON.stringify(changedState.artifactDiff)).not.toContain("<!doctype html>");
    expect(JSON.stringify(changedState.artifactDiff)).not.toContain("body { color: #123456; }");
  });

  it("reads one bounded artifact snippet for a selected canonical path", async () => {
    const store = createWebWorkbenchStore();
    const result = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Untitled LP Project"
    });
    if (!result.ok || !result.projectId) {
      throw new Error("Expected LP task creation.");
    }

    const pageState = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId,
      artifactPath: "styles.css"
    });

    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageState.artifactDiff?.selectedSnippet).toMatchObject({
      path: "styles.css",
      maxBytes: 8192,
      omittedReason: undefined
    });
    expect(pageState.artifactDiff?.selectedSnippet?.content).toContain(":root");
    expect(pageState.artifactDiff?.selectedSnippet?.shortSha256).toHaveLength(12);
    expect(JSON.stringify(pageState.artifactDiff?.files)).not.toContain(":root");
  });

  it("omits oversized selected snippets and redacts invalid artifact paths", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });
    const result = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Untitled LP Project"
    });
    if (!result.ok || !result.projectId) {
      throw new Error("Expected LP task creation.");
    }
    const initialState = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId
    });
    if (initialState.kind !== "task_ready" || !initialState.snapshot?.currentPageVersion) {
      throw new Error("Expected page version.");
    }
    const pageVersion = initialState.snapshot.currentPageVersion;
    if (!pageVersion.artifactWorkspaceId) {
      throw new Error("Expected artifact workspace.");
    }
    const largeCssSecret = "OVERSIZED_SNIPPET_SECRET";
    const largeArtifacts = {
      ...pageVersion.artifacts,
      stylesCss: `${largeCssSecret}${"x".repeat(9000)}`
    };
    for (const file of createStaticArtifactWorkspaceFiles({
      workspaceId: pageVersion.artifactWorkspaceId,
      projectId: result.projectId,
      pageVersionId: pageVersion.id,
      artifacts: largeArtifacts,
      createdAt: "2026-05-19T00:02:00.000Z"
    })) {
      await repositories.artifactWorkspaceFiles.save(file);
    }

    const oversizedState = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId,
      artifactPath: "styles.css"
    });
    expect(oversizedState.kind).toBe("task_ready");
    if (oversizedState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(oversizedState.artifactDiff?.selectedSnippet).toMatchObject({
      path: "styles.css",
      omittedReason: "size_limit_exceeded"
    });
    expect(JSON.stringify(oversizedState.artifactDiff)).not.toContain(largeCssSecret);

    const invalidPath = "../styles.css?token=ARTIFACT_QUERY_SECRET";
    const invalidState = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId,
      artifactPath: invalidPath
    });
    expect(invalidState.kind).toBe("task_ready");
    if (invalidState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(invalidState.artifactDiff?.errorCode).toBe("artifact_snippet_unavailable");
    expect(JSON.stringify(invalidState.artifactDiff)).not.toContain(invalidPath);
    expect(JSON.stringify(invalidState.artifactDiff)).not.toContain("ARTIFACT_QUERY_SECRET");
  });

  it("uses configured current user as the owner for implicit LP projects", async () => {
    const store = createWebWorkbenchStore({
      currentUser: {
        id: "web-reviewer",
        displayName: "Web Reviewer"
      }
    });

    const result = await store.submitTaskPrompt({
      prompt: "Create a landing page for a conference",
      implicitProjectName: "Untitled LP Project"
    });
    if (!result.ok || !result.projectId) {
      throw new Error("Expected implicit project creation.");
    }

    const pageState = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId
    });

    expect(pageState.kind).toBe("task_ready");
    expect(pageState.projectMembers).toEqual([
      expect.objectContaining({
        projectId: result.projectId,
        userId: "web-reviewer",
        role: "owner",
        displayName: "Web Reviewer"
      })
    ]);
  });
});
