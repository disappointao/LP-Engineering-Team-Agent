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
import { createDefaultModelPolicy } from "@lp-agent/model-gateway";
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
  validatePromptInput
} from "./workbench-store";

const emptyMCPState = {
  connectors: [],
  approvals: [],
  visibleToolsByRole: {
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
  WORKER_JOBS_FILE: process.env.WORKER_JOBS_FILE,
  WORKER_PAYLOADS_FILE: process.env.WORKER_PAYLOADS_FILE,
  WORKER_LOGS_FILE: process.env.WORKER_LOGS_FILE
};
const webStoreGlobal = globalThis as typeof globalThis & {
  __lpAgentWebWorkbenchStore?: unknown;
};

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
    delete webStoreGlobal.__lpAgentWebWorkbenchStore;

    const store = await getWebWorkbenchStore();
    const project = await store.createProject({ name: "Memory backend project" });

    expect(project.name).toBe("Memory backend project");
  });

  it("retries global store initialization after repository backend setup fails", async () => {
    vi.stubEnv("WORKBENCH_REPOSITORY_BACKEND", "postgres");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("WORKBENCH_POSTGRES_WORKSPACE_ID", "workspace_local");
    delete webStoreGlobal.__lpAgentWebWorkbenchStore;

    await expect(getWebWorkbenchStore()).rejects.toThrow(
      "DATABASE_URL is required for WORKBENCH_REPOSITORY_BACKEND=postgres"
    );

    vi.stubEnv("WORKBENCH_REPOSITORY_BACKEND", "memory");
    const store = await getWebWorkbenchStore();
    const project = await store.createProject({ name: "Recovered memory backend project" });

    expect(project.name).toBe("Recovered memory backend project");
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
    expect(pageState.snapshot.deployment).toBeUndefined();
    expect(pageState.messages[1]?.content).toBe("LP artifacts are ready for review.");
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
    expect([...new Set(firstTaskState.runEvents.map((event) => event.runId))]).toEqual([
      "run_planner_brief_1",
      "run_builder_version_1",
      "run_reviewer_version_1"
    ]);
    expect([...new Set(secondTaskState.runEvents.map((event) => event.runId))]).toEqual([
      "run_planner_brief_2",
      "run_builder_version_2",
      "run_reviewer_version_2"
    ]);
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
    expect(pageState.snapshot.deployment).toBeUndefined();
    expect(pageState.messages[1]?.content).toBe("LP artifacts are ready for review.");
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

  it("falls back to current artifact metadata when legacy previous diff is unavailable", async () => {
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
    expect(pageState.artifactDiff?.previousPageVersionId).toBeUndefined();
    expect(pageState.artifactDiff?.files).toMatchObject([
      {
        path: "index.html",
        state: "initial",
        canPreview: true
      },
      {
        path: "styles.css",
        state: "initial",
        canPreview: true
      },
      {
        path: "script.js",
        state: "initial",
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
