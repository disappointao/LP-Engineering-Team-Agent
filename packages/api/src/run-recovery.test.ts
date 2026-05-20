import { describe, expect, it } from "vitest";
import {
  createInMemoryWorkbenchRepositories,
  type RunEventRecord,
  type RunRecord,
  type ToolObservationRecord,
  type WorkbenchRepositories
} from "@lp-agent/db";
import type { WorkerJobRecord } from "@lp-agent/worker-runtime";
import {
  executeRunRecoveryAction,
  listRunRecoveryViewsForTask
} from "./run-recovery";
import { DemoWorkbenchService } from "./index";

const timestamp = "2026-05-20T00:00:00.000Z";

function terminalWorkerJob(
  overrides: Partial<WorkerJobRecord> = {}
): WorkerJobRecord {
  return {
    id: "worker_job_1",
    projectId: "project_1",
    kind: "tool_command",
    state: "completed",
    payloadSource: "safe_persisted",
    policy: {
      mode: "simulate",
      allowedCommands: ["static-deploy"],
      timeoutMs: 30000,
      allowedEnvNames: [],
      maxStdoutBytes: 300,
      maxStderrBytes: 300,
      network: "disabled"
    },
    inputSummary: {
      kind: "tool_command",
      projectId: "project_1",
      command: "static-deploy",
      argCount: 0,
      envNames: [],
      timeoutMs: 30000
    },
    resultSummary: {
      state: "completed",
      stdout: "published",
      stderr: "",
      stdoutBytes: 9,
      stderrBytes: 0,
      exitCode: 0
    },
    createdAt: timestamp,
    startedAt: "2026-05-20T00:00:01.000Z",
    completedAt: "2026-05-20T00:00:02.000Z",
    ...overrides
  };
}

async function saveTask(repositories: WorkbenchRepositories): Promise<void> {
  await repositories.projects.save({
    id: "project_1",
    name: "Recovery project",
    createdAt: timestamp
  });
  await repositories.tasks.save({
    id: "task_1",
    title: "Recover a landing page run",
    type: "lp_generation",
    status: "complete",
    projectId: "project_1",
    createdAt: timestamp
  });
  await repositories.messages.save({
    id: "message_1",
    taskId: "task_1",
    role: "user",
    content: "Build a recovery LP.",
    createdAt: timestamp
  });
}

async function saveRun(
  repositories: WorkbenchRepositories,
  overrides: Partial<RunRecord>
): Promise<RunRecord> {
  const run: RunRecord = {
    id: "run_reviewer_version_1",
    projectId: "project_1",
    taskId: "task_1",
    role: "reviewer",
    state: "running",
    startedAt: timestamp,
    contextSummary: {
      injected: [],
      omitted: []
    },
    ...overrides
  };
  await repositories.runs.save(run);
  return run;
}

async function saveEvent(
  repositories: WorkbenchRepositories,
  input: {
    runId: string;
    type: string;
    sequence: number;
    payload?: Record<string, unknown>;
    message?: string;
  }
): Promise<RunEventRecord> {
  const event: RunEventRecord = {
    id: `${input.runId}_event_${input.sequence}`,
    runId: input.runId,
    projectId: "project_1",
    taskId: "task_1",
    sequence: input.sequence,
    type: input.type,
    message: input.message ?? input.type,
    payload: input.payload ?? {},
    createdAt: `2026-05-20T00:00:0${input.sequence}.000Z`
  };
  await repositories.runEvents.save(event);
  return event;
}

async function saveObservation(
  repositories: WorkbenchRepositories,
  overrides: Partial<ToolObservationRecord> = {}
): Promise<void> {
  await repositories.toolObservations.save({
    id: "tool_observation_1",
    runId: "run_skill_command_1",
    projectId: "project_1",
    taskId: "task_1",
    toolName: "skill:skill_static_deploy:publish_static",
    input: {},
    outputSummary: "",
    state: "running",
    createdAt: timestamp,
    ...overrides
  });
}

describe("run recovery views", () => {
  it("lists direct task runs and snapshot-linked LP runs without duplicates", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await repositories.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_1",
      pageVersionId: "version_1",
      createdAt: timestamp
    });
    await saveRun(repositories, {
      id: "run_planner_brief_1",
      taskId: undefined,
      role: "planner",
      state: "completed",
      completedAt: "2026-05-20T00:00:04.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_planner_brief_1",
      type: "run.completed",
      sequence: 1
    });
    await saveRun(repositories, {
      id: "run_reviewer_version_1",
      role: "reviewer",
      state: "failed",
      completedAt: "2026-05-20T00:00:05.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_reviewer_version_1",
      type: "run.failed",
      sequence: 1,
      payload: {
        errorName: "reviewer_failed",
        rawModelOutput: "RAW_SECRET_SHOULD_NOT_RENDER"
      }
    });

    const views = await listRunRecoveryViewsForTask({ repositories, taskId: "task_1" });

    expect(views.map((view) => view.runId)).toEqual([
      "run_planner_brief_1",
      "run_reviewer_version_1"
    ]);
    expect(JSON.stringify(views)).not.toContain("RAW_SECRET_SHOULD_NOT_RENDER");
    expect(views[1]).toMatchObject({
      state: "failed",
      recoveryActions: ["retry_run"],
      diagnosticSummary: {
        code: "run_failed",
        source: "run_event",
        errorName: "reviewer_failed"
      }
    });
  });

  it("does not include snapshot-linked runs from another project", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await repositories.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "foreign_brief",
      createdAt: timestamp
    });
    await saveRun(repositories, {
      id: "run_planner_foreign_brief",
      projectId: "project_2",
      taskId: undefined,
      role: "planner",
      state: "completed",
      completedAt: "2026-05-20T00:00:04.000Z"
    });

    const views = await listRunRecoveryViewsForTask({ repositories, taskId: "task_1" });

    expect(views.map((view) => view.runId)).not.toContain("run_planner_foreign_brief");
  });

  it("does not trust stale snapshot project ids when listing snapshot-linked runs", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await repositories.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_2",
      briefId: "stale_brief",
      createdAt: timestamp
    });
    await saveRun(repositories, {
      id: "run_planner_stale_brief",
      projectId: "project_2",
      taskId: undefined,
      role: "planner",
      state: "completed",
      completedAt: "2026-05-20T00:00:04.000Z"
    });

    const views = await listRunRecoveryViewsForTask({ repositories, taskId: "task_1" });

    expect(views.map((view) => view.runId)).not.toContain("run_planner_stale_brief");
  });

  it("ignores stale snapshot ids even when they point to same-project runs", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await repositories.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_2",
      briefId: "brief_1",
      createdAt: timestamp
    });
    await saveRun(repositories, {
      id: "run_planner_brief_1",
      projectId: "project_1",
      taskId: undefined,
      role: "planner",
      state: "completed",
      completedAt: "2026-05-20T00:00:04.000Z"
    });

    const views = await listRunRecoveryViewsForTask({ repositories, taskId: "task_1" });

    expect(views.map((view) => view.runId)).not.toContain("run_planner_brief_1");
  });
});

describe("execute run recovery action", () => {
  it("resumes worker finalization only when the derived action is available", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await saveRun(repositories, {
      id: "run_skill_command_1",
      role: "deployer"
    });
    await saveObservation(repositories);
    await saveEvent(repositories, {
      runId: "run_skill_command_1",
      type: "worker.job.linked",
      sequence: 1,
      payload: {
        runId: "run_skill_command_1",
        workerJobId: "worker_job_1",
        observationId: "tool_observation_1"
      }
    });

    const result = await executeRunRecoveryAction({
      repositories,
      workerRuntime: { getJob: async () => terminalWorkerJob() },
      service: {
        createBriefFromPrompt: async () => {
          throw new Error("not used");
        },
        generatePageVersion: async () => {
          throw new Error("not used");
        },
        reviewPageVersion: async () => {
          throw new Error("not used");
        },
        approveAndCreateDeployment: async () => {
          throw new Error("not used");
        }
      },
      currentUserId: "local-web-user",
      taskId: "task_1",
      runId: "run_skill_command_1",
      action: "resume_worker_finalization"
    });

    expect(result).toEqual({
      ok: true,
      action: "resume_worker_finalization",
      runId: "run_skill_command_1",
      state: "completed"
    });
    await expect(repositories.runs.getById("run_skill_command_1")).resolves.toMatchObject({
      state: "completed"
    });
    await expect(repositories.runEvents.listForRun("run_skill_command_1")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool.completed" }),
        expect.objectContaining({ type: "run.completed" })
      ])
    );
  });

  it("fails closed when the worker job is linked to more than one run", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await saveRun(repositories, {
      id: "run_skill_command_1",
      role: "deployer"
    });
    await saveRun(repositories, {
      id: "run_other_skill_command_1",
      role: "deployer"
    });
    await saveObservation(repositories);
    await saveObservation(repositories, {
      id: "tool_observation_other",
      runId: "run_other_skill_command_1"
    });
    await saveEvent(repositories, {
      runId: "run_skill_command_1",
      type: "worker.job.linked",
      sequence: 1,
      payload: {
        runId: "run_skill_command_1",
        workerJobId: "worker_job_1",
        observationId: "tool_observation_1"
      }
    });
    await saveEvent(repositories, {
      runId: "run_other_skill_command_1",
      type: "worker.job.linked",
      sequence: 2,
      payload: {
        runId: "run_other_skill_command_1",
        workerJobId: "worker_job_1",
        observationId: "tool_observation_other"
      }
    });

    const result = await executeRunRecoveryAction({
      repositories,
      workerRuntime: { getJob: async () => terminalWorkerJob() },
      service: {
        createBriefFromPrompt: async () => {
          throw new Error("not used");
        },
        generatePageVersion: async () => {
          throw new Error("not used");
        },
        reviewPageVersion: async () => {
          throw new Error("not used");
        },
        approveAndCreateDeployment: async () => {
          throw new Error("not used");
        }
      },
      currentUserId: "local-web-user",
      taskId: "task_1",
      runId: "run_skill_command_1",
      action: "resume_worker_finalization"
    });

    expect(result).toEqual({
      ok: false,
      error: "worker_finalization_failed"
    });
    await expect(repositories.runs.getById("run_skill_command_1")).resolves.toMatchObject({
      state: "running"
    });
    await expect(repositories.runs.getById("run_other_skill_command_1")).resolves.toMatchObject({
      state: "running"
    });
    await expect(repositories.runEvents.listForRun("run_other_skill_command_1")).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool.completed" }),
        expect.objectContaining({ type: "run.completed" })
      ])
    );
  });

  it("returns worker_runtime_not_configured when resuming without worker runtime", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await saveRun(repositories, {
      id: "run_skill_command_1",
      role: "deployer"
    });
    await saveObservation(repositories);
    await saveEvent(repositories, {
      runId: "run_skill_command_1",
      type: "worker.job.linked",
      sequence: 1,
      payload: {
        runId: "run_skill_command_1",
        workerJobId: "worker_job_1",
        observationId: "tool_observation_1"
      }
    });

    const result = await executeRunRecoveryAction({
      repositories,
      service: {
        createBriefFromPrompt: async () => {
          throw new Error("not used");
        },
        generatePageVersion: async () => {
          throw new Error("not used");
        },
        reviewPageVersion: async () => {
          throw new Error("not used");
        },
        approveAndCreateDeployment: async () => {
          throw new Error("not used");
        }
      },
      currentUserId: "local-web-user",
      taskId: "task_1",
      runId: "run_skill_command_1",
      action: "resume_worker_finalization"
    });

    expect(result).toEqual({
      ok: false,
      error: "worker_runtime_not_configured"
    });
  });

  it("does not execute recovery for direct task runs from another project", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await saveRun(repositories, {
      id: "run_foreign_skill_command_1",
      projectId: "project_2",
      role: "deployer"
    });
    await saveObservation(repositories, {
      id: "tool_observation_foreign",
      runId: "run_foreign_skill_command_1",
      projectId: "project_2"
    });
    await saveEvent(repositories, {
      runId: "run_foreign_skill_command_1",
      type: "worker.job.linked",
      sequence: 1,
      payload: {
        runId: "run_foreign_skill_command_1",
        workerJobId: "worker_job_1",
        observationId: "tool_observation_foreign"
      }
    });

    const result = await executeRunRecoveryAction({
      repositories,
      workerRuntime: { getJob: async () => terminalWorkerJob({ projectId: "project_2" }) },
      service: {
        createBriefFromPrompt: async () => {
          throw new Error("not used");
        },
        generatePageVersion: async () => {
          throw new Error("not used");
        },
        reviewPageVersion: async () => {
          throw new Error("not used");
        },
        approveAndCreateDeployment: async () => {
          throw new Error("not used");
        }
      },
      currentUserId: "local-web-user",
      taskId: "task_1",
      runId: "run_foreign_skill_command_1",
      action: "resume_worker_finalization"
    });

    expect(result).toEqual({
      ok: false,
      error: "run_not_found"
    });
    await expect(repositories.runs.getById("run_foreign_skill_command_1")).resolves.toMatchObject({
      state: "running"
    });
    await expect(repositories.runEvents.listForRun("run_foreign_skill_command_1")).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool.completed" }),
        expect.objectContaining({ type: "run.completed" })
      ])
    );
  });
});

describe("execute run recovery retry", () => {
  it("retries a failed planner run with a new run id and task snapshot brief", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await saveRun(repositories, {
      id: "run_planner_failed",
      role: "planner",
      state: "failed",
      completedAt: "2026-05-20T00:00:03.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_planner_failed",
      type: "run.failed",
      sequence: 1,
      payload: {
        errorName: "model_output_parse_failed",
        rawModelOutput: "MODEL_SECRET_SHOULD_NOT_RENDER"
      }
    });

    const service = new DemoWorkbenchService({
      repositories,
      now: () => new Date("2026-05-20T00:10:00.000Z")
    });
    const result = await executeRunRecoveryAction({
      repositories,
      service,
      currentUserId: "local-web-user",
      taskId: "task_1",
      runId: "run_planner_failed",
      action: "retry_run",
      now: () => new Date("2026-05-20T00:10:00.000Z")
    });

    expect(result).toEqual({
      ok: true,
      action: "retry_run",
      runId: "run_planner_failed",
      newRunId: "run_planner_failed_retry_1",
      state: "completed"
    });
    await expect(repositories.runs.getById("run_planner_failed")).resolves.toMatchObject({
      state: "failed"
    });
    await expect(repositories.runs.getById("run_planner_failed_retry_1")).resolves.toMatchObject({
      role: "planner",
      state: "completed",
      taskId: "task_1"
    });
    await expect(repositories.taskSnapshots.getByTaskId("task_1")).resolves.toMatchObject({
      projectId: "project_1",
      briefId: "brief_1"
    });
    const views = await listRunRecoveryViewsForTask({ repositories, taskId: "task_1" });
    expect(JSON.stringify(views)).not.toContain("MODEL_SECRET_SHOULD_NOT_RENDER");
  });

  it("fails closed instead of retrying skill command runs", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await saveRun(repositories, {
      id: "run_skill_command_1",
      role: "deployer",
      state: "failed",
      completedAt: "2026-05-20T00:00:03.000Z",
      contextSummary: {
        injected: ["skillCommand:skill_static_deploy:publish_static"],
        omitted: []
      }
    });
    await saveEvent(repositories, {
      runId: "run_skill_command_1",
      type: "run.failed",
      sequence: 1,
      payload: { errorName: "skill_command_failed" }
    });

    const service = new DemoWorkbenchService({ repositories });
    await expect(
      executeRunRecoveryAction({
        repositories,
        service,
        currentUserId: "local-web-user",
        taskId: "task_1",
        runId: "run_skill_command_1",
        action: "retry_run"
      })
    ).resolves.toEqual({ ok: false, error: "retry_input_not_reconstructable" });
  });

  it("fails closed when retry would overwrite an existing task snapshot output", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await repositories.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_existing",
      createdAt: timestamp
    });
    await saveRun(repositories, {
      id: "run_planner_failed",
      role: "planner",
      state: "failed",
      completedAt: "2026-05-20T00:00:03.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_planner_failed",
      type: "run.failed",
      sequence: 1
    });

    const service = new DemoWorkbenchService({ repositories });
    await expect(
      executeRunRecoveryAction({
        repositories,
        service,
        currentUserId: "local-web-user",
        taskId: "task_1",
        runId: "run_planner_failed",
        action: "retry_run"
      })
    ).resolves.toEqual({ ok: false, error: "retry_target_conflict" });
  });
});
