import { describe, expect, it } from "vitest";
import {
  createInMemoryWorkbenchRepositories,
  type BriefRecord,
  type PageVersionRecord,
  type RunEventRecord,
  type RunRecord,
  type ToolObservationRecord,
  type WorkbenchRepositories
} from "@lp-agent/db";
import { sampleBrief } from "@lp-agent/lp-schema";
import type { WorkerJobRecord } from "@lp-agent/worker-runtime";
import {
  executeRunRecoveryAction,
  listRunRecoveryViewsForTask
} from "./run-recovery";
import { DemoWorkbenchService } from "./index";
import { createAgentHandoffRecord } from "./agent-handoffs";

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

  it("keeps completed repaired runs non-actionable", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await saveRun(repositories, {
      id: "run_builder_version_1",
      role: "builder",
      state: "completed",
      completedAt: "2026-05-20T00:00:04.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_builder_version_1",
      type: "model.output.parse_failed",
      sequence: 1,
      payload: { reason: "invalid_json" }
    });
    await saveEvent(repositories, {
      runId: "run_builder_version_1",
      type: "model.output.repair_started",
      sequence: 2
    });
    await saveEvent(repositories, {
      runId: "run_builder_version_1",
      type: "run.completed",
      sequence: 3
    });

    const views = await listRunRecoveryViewsForTask({ repositories, taskId: "task_1" });

    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      state: "completed",
      recoveryActions: []
    });
    expect(views[0]?.diagnosticSummary).toBeUndefined();
  });

  it("derives a blocked recovery view from a task-scoped blocked handoff without a target run", async () => {
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
      id: "run_reviewer_version_1",
      role: "reviewer",
      state: "completed",
      completedAt: "2026-05-20T00:00:05.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_reviewer_version_1",
      type: "run.completed",
      sequence: 1
    });
    await repositories.agentHandoffs.save(
      createAgentHandoffRecord({
        id: "handoff_blocked_reviewer_deployer",
        projectId: "project_1",
        taskId: "task_1",
        fromRunId: "run_reviewer_version_1",
        fromRole: "reviewer",
        toRole: "deployer",
        state: "blocked",
        summary: "Reviewer blocked deployment",
        blockingReason: "hero.cta: Missing CTA with OPENAI_API_KEY=sk-test-secret",
        artifactRefs: {
          pageVersionId: "version_1"
        },
        now: () => new Date("2026-05-20T00:00:06.000Z")
      })
    );

    const views = await listRunRecoveryViewsForTask({ repositories, taskId: "task_1" });

    expect(views).toEqual([
      expect.objectContaining({
        runId: "run_reviewer_version_1",
        role: "reviewer",
        runRecordState: "completed",
        state: "blocked",
        blockedReason: "hero.cta: Missing CTA with OPENAI_API_KEY=[REDACTED]",
        diagnosticSummary: {
          code: "handoff_blocked",
          message: "Reviewer blocked deployment.",
          source: "handoff"
        },
        recoveryActions: ["resolve_blocker"]
      })
    ]);
    expect(views.map((view) => view.runId)).not.toContain("run_deployer_version_1");
    expect(JSON.stringify(views)).not.toContain("sk-test-secret");
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

  it("Planner retry uses the recent user message before the failed run for a continued LP attempt", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await repositories.briefs.save({
      id: "brief_1",
      projectId: "project_1",
      prompt: "Build a recovery LP.",
      brief: sampleBrief,
      createdAt: "2026-05-20T00:01:00.000Z"
    });
    await repositories.pageVersions.save({
      id: "version_1",
      projectId: "project_1",
      briefId: "brief_1",
      artifacts: {
        indexHtml: "<!doctype html><html></html>",
        stylesCss: ":root {}",
        scriptJs: "window.lpAgent = true;"
      },
      reviewStatus: "passed",
      findings: [],
      createdAt: "2026-05-20T00:02:00.000Z"
    });
    await repositories.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_1",
      pageVersionId: "version_1",
      createdAt: "2026-05-20T00:01:00.000Z"
    });
    await repositories.messages.save({
      id: "message_2",
      taskId: "task_1",
      role: "assistant",
      content: "LP artifacts are ready for review.",
      createdAt: "2026-05-20T00:02:00.000Z"
    });
    await repositories.messages.save({
      id: "message_3",
      taskId: "task_1",
      role: "user",
      content: "Revise the hero for enterprise buyers.",
      createdAt: "2026-05-20T00:05:00.000Z"
    });
    await saveRun(repositories, {
      id: "run_planner_failed",
      role: "planner",
      state: "failed",
      startedAt: "2026-05-20T00:05:30.000Z",
      completedAt: "2026-05-20T00:05:45.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_planner_failed",
      type: "run.failed",
      sequence: 1
    });

    let receivedPrompt = "";
    const result = await executeRunRecoveryAction({
      repositories,
      service: {
        createBriefFromPrompt: async (input): Promise<BriefRecord> => {
          receivedPrompt = input.prompt;
          const brief: BriefRecord = {
            id: "brief_2",
            projectId: input.projectId,
            prompt: input.prompt,
            brief: sampleBrief,
            createdAt: "2026-05-20T00:10:00.000Z"
          };
          await repositories.briefs.save(brief);
          return brief;
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
    expect(receivedPrompt).toBe("Revise the hero for enterprise buyers.");
    const snapshot = await repositories.taskSnapshots.getByTaskId("task_1");
    expect(snapshot).toMatchObject({
      projectId: "project_1",
      briefId: "brief_2"
    });
    expect(snapshot?.pageVersionId).toBeUndefined();
  });

  it("fails closed for an older failed planner run after a newer LP attempt succeeds", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await repositories.briefs.save({
      id: "brief_1",
      projectId: "project_1",
      prompt: "Build a recovery LP.",
      brief: sampleBrief,
      createdAt: "2026-05-20T00:01:00.000Z"
    });
    await repositories.pageVersions.save({
      id: "version_1",
      projectId: "project_1",
      briefId: "brief_1",
      artifacts: {
        indexHtml: "<!doctype html><html></html>",
        stylesCss: ":root {}",
        scriptJs: "window.lpAgent = true;"
      },
      reviewStatus: "passed",
      findings: [],
      createdAt: "2026-05-20T00:02:00.000Z"
    });
    await repositories.messages.save({
      id: "message_2",
      taskId: "task_1",
      role: "assistant",
      content: "LP artifacts are ready for review.",
      createdAt: "2026-05-20T00:02:30.000Z"
    });
    await repositories.messages.save({
      id: "message_3",
      taskId: "task_1",
      role: "user",
      content: "Make the page more concise.",
      createdAt: "2026-05-20T00:03:00.000Z"
    });
    await saveRun(repositories, {
      id: "run_planner_failed",
      role: "planner",
      state: "failed",
      startedAt: "2026-05-20T00:03:30.000Z",
      completedAt: "2026-05-20T00:03:45.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_planner_failed",
      type: "run.failed",
      sequence: 1
    });
    await repositories.messages.save({
      id: "message_4",
      taskId: "task_1",
      role: "assistant",
      content: "LP generation failed. Open recovery details for the failed run.",
      createdAt: "2026-05-20T00:04:00.000Z"
    });
    await repositories.messages.save({
      id: "message_5",
      taskId: "task_1",
      role: "user",
      content: "Use an enterprise style instead.",
      createdAt: "2026-05-20T00:06:00.000Z"
    });
    await repositories.briefs.save({
      id: "brief_2",
      projectId: "project_1",
      prompt: "Use an enterprise style instead.",
      brief: sampleBrief,
      createdAt: "2026-05-20T00:06:30.000Z"
    });
    await repositories.pageVersions.save({
      id: "version_2",
      projectId: "project_1",
      briefId: "brief_2",
      artifacts: {
        indexHtml: "<!doctype html><html></html>",
        stylesCss: ":root {}",
        scriptJs: "window.lpAgent = true;"
      },
      reviewStatus: "passed",
      findings: [],
      createdAt: "2026-05-20T00:07:00.000Z"
    });
    await repositories.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_2",
      pageVersionId: "version_2",
      createdAt: "2026-05-20T00:01:00.000Z"
    });

    let createBriefCalls = 0;
    const result = await executeRunRecoveryAction({
      repositories,
      service: {
        createBriefFromPrompt: async (input): Promise<BriefRecord> => {
          createBriefCalls += 1;
          const brief: BriefRecord = {
            id: "brief_retry_should_not_be_saved",
            projectId: input.projectId,
            prompt: input.prompt,
            brief: sampleBrief,
            createdAt: "2026-05-20T00:10:00.000Z"
          };
          await repositories.briefs.save(brief);
          return brief;
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
      runId: "run_planner_failed",
      action: "retry_run",
      now: () => new Date("2026-05-20T00:10:00.000Z")
    });

    expect(result).toEqual({ ok: false, error: "retry_target_conflict" });
    expect(createBriefCalls).toBe(0);
    await expect(repositories.taskSnapshots.getByTaskId("task_1")).resolves.toMatchObject({
      projectId: "project_1",
      briefId: "brief_2",
      pageVersionId: "version_2"
    });
    await expect(
      repositories.briefs.getById("brief_retry_should_not_be_saved")
    ).resolves.toBeUndefined();
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

  it("fails closed instead of retrying MCP tool runs with reconstructable builder inputs", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await repositories.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_1",
      createdAt: timestamp
    });
    await saveRun(repositories, {
      id: "run_mcp_tool_builder_1",
      role: "builder",
      state: "failed",
      completedAt: "2026-05-20T00:00:03.000Z",
      contextSummary: {
        injected: ["mcpTool:connector_assets:searchAssets"],
        omitted: []
      }
    });
    await saveEvent(repositories, {
      runId: "run_mcp_tool_builder_1",
      type: "run.failed",
      sequence: 1,
      payload: { errorName: "mcp_tool_failed" }
    });

    const views = await listRunRecoveryViewsForTask({ repositories, taskId: "task_1" });
    let generatePageVersionCalls = 0;
    const result = await executeRunRecoveryAction({
      repositories,
      service: {
        createBriefFromPrompt: async () => {
          throw new Error("not used");
        },
        generatePageVersion: async (): Promise<PageVersionRecord> => {
          generatePageVersionCalls += 1;
          return {
            id: "version_should_not_be_created",
            projectId: "project_1",
            briefId: "brief_1",
            artifacts: {
              indexHtml: "<!doctype html><html></html>",
              stylesCss: ":root {}",
              scriptJs: "window.lpAgent = true;"
            },
            reviewStatus: "pending",
            findings: [],
            createdAt: timestamp
          };
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
      runId: "run_mcp_tool_builder_1",
      action: "retry_run"
    });

    expect(views).toEqual([
      expect.objectContaining({
        runId: "run_mcp_tool_builder_1",
        recoveryActions: ["inspect_manually"]
      })
    ]);
    expect(result).toEqual({ ok: false, error: "retry_input_not_reconstructable" });
    expect(generatePageVersionCalls).toBe(0);
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

  it("fails closed without retrying when the task snapshot belongs to another project", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await repositories.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_2",
      briefId: "brief_stale",
      createdAt: timestamp
    });
    await saveRun(repositories, {
      id: "run_builder_failed",
      role: "builder",
      state: "failed",
      completedAt: "2026-05-20T00:00:03.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_builder_failed",
      type: "run.failed",
      sequence: 1
    });

    let generatePageVersionCalls = 0;
    const result = await executeRunRecoveryAction({
      repositories,
      service: {
        createBriefFromPrompt: async () => {
          throw new Error("not used");
        },
        generatePageVersion: async () => {
          generatePageVersionCalls += 1;
          throw new Error("stale snapshot must not retry");
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
      runId: "run_builder_failed",
      action: "retry_run"
    });

    expect(result).toEqual({ ok: false, error: "retry_input_not_reconstructable" });
    expect(generatePageVersionCalls).toBe(0);
  });

  it("fails closed for a stale Builder retry after a newer LP attempt", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await repositories.briefs.save({
      id: "brief_1",
      projectId: "project_1",
      prompt: "Build a recovery LP.",
      brief: sampleBrief,
      createdAt: "2026-05-20T00:01:00.000Z"
    });
    await repositories.briefs.save({
      id: "brief_2",
      projectId: "project_1",
      prompt: "Use an enterprise style instead.",
      brief: sampleBrief,
      createdAt: "2026-05-20T00:06:30.000Z"
    });
    await repositories.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_2",
      createdAt: "2026-05-20T00:01:00.000Z"
    });
    await saveRun(repositories, {
      id: "run_builder_failed",
      role: "builder",
      state: "failed",
      startedAt: "2026-05-20T00:02:00.000Z",
      completedAt: "2026-05-20T00:02:30.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_builder_failed",
      type: "handoff.consumed",
      sequence: 1,
      payload: {
        artifactRefs: {
          briefId: "brief_1"
        }
      }
    });
    await saveEvent(repositories, {
      runId: "run_builder_failed",
      type: "run.failed",
      sequence: 2
    });

    let generatePageVersionCalls = 0;
    const result = await executeRunRecoveryAction({
      repositories,
      service: {
        createBriefFromPrompt: async () => {
          throw new Error("not used");
        },
        generatePageVersion: async (): Promise<PageVersionRecord> => {
          generatePageVersionCalls += 1;
          const pageVersion: PageVersionRecord = {
            id: "version_retry_should_not_be_saved",
            projectId: "project_1",
            briefId: "brief_2",
            artifacts: {
              indexHtml: "<!doctype html><html></html>",
              stylesCss: ":root {}",
              scriptJs: "window.lpAgent = true;"
            },
            reviewStatus: "pending",
            findings: [],
            createdAt: "2026-05-20T00:10:00.000Z"
          };
          await repositories.pageVersions.save(pageVersion);
          return pageVersion;
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
      runId: "run_builder_failed",
      action: "retry_run"
    });

    expect(result).toEqual({ ok: false, error: "retry_target_conflict" });
    expect(generatePageVersionCalls).toBe(0);
    const staleBuilderSnapshot = await repositories.taskSnapshots.getByTaskId("task_1");
    expect(staleBuilderSnapshot).toMatchObject({
      projectId: "project_1",
      briefId: "brief_2"
    });
    expect(staleBuilderSnapshot?.pageVersionId).toBeUndefined();
    await expect(
      repositories.pageVersions.getById("version_retry_should_not_be_saved")
    ).resolves.toBeUndefined();
  });

  it("fails closed when retrying an older planner failure with a newer failed retry", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await saveRun(repositories, {
      id: "run_planner_failed",
      role: "planner",
      state: "failed",
      completedAt: "2026-05-20T00:00:03.000Z"
    });
    await saveRun(repositories, {
      id: "run_planner_failed_retry_1",
      role: "planner",
      state: "failed",
      completedAt: "2026-05-20T00:00:04.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_planner_failed",
      type: "run.failed",
      sequence: 1
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

    expect(result).toEqual({ ok: false, error: "retry_target_conflict" });
    await expect(repositories.runs.getById("run_planner_failed_retry_2")).resolves.toBeUndefined();
    await expect(repositories.taskSnapshots.getByTaskId("task_1")).resolves.toBeUndefined();
  });

  it("prevents concurrent planner retries from overwriting the task snapshot", async () => {
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
      sequence: 1
    });

    let createBriefCalls = 0;
    let releaseFirstRetry = () => {};
    let markFirstRetryStarted = () => {};
    const firstRetryStarted = new Promise<void>((resolve) => {
      markFirstRetryStarted = resolve;
    });
    const service = {
      createBriefFromPrompt: async (input: {
        projectId: string;
        prompt: string;
        taskId?: string;
        runId?: string;
      }): Promise<BriefRecord> => {
        createBriefCalls += 1;
        const callNumber = createBriefCalls;
        if (callNumber === 1) {
          markFirstRetryStarted();
          await new Promise<void>((release) => {
            releaseFirstRetry = release;
          });
        }
        const brief: BriefRecord = {
          id: `brief_${callNumber}`,
          projectId: input.projectId,
          prompt: input.prompt,
          brief: sampleBrief,
          createdAt: `2026-05-20T00:10:0${callNumber}.000Z`
        };
        await repositories.briefs.save(brief);
        await repositories.runs.save({
          id: input.runId ?? `run_planner_${brief.id}`,
          projectId: input.projectId,
          taskId: input.taskId,
          role: "planner",
          state: "completed",
          startedAt: timestamp,
          completedAt: `2026-05-20T00:10:0${callNumber}.000Z`,
          contextSummary: {
            injected: [],
            omitted: []
          }
        });
        return brief;
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
    };

    const firstRetry = executeRunRecoveryAction({
      repositories,
      service,
      currentUserId: "local-web-user",
      taskId: "task_1",
      runId: "run_planner_failed",
      action: "retry_run"
    });
    const secondRetry = executeRunRecoveryAction({
      repositories,
      service,
      currentUserId: "local-web-user",
      taskId: "task_1",
      runId: "run_planner_failed",
      action: "retry_run"
    });

    await firstRetryStarted;
    releaseFirstRetry();

    const results = await Promise.all([firstRetry, secondRetry]);
    expect(results).toEqual(
      expect.arrayContaining([
        {
          ok: true,
          action: "retry_run",
          runId: "run_planner_failed",
          newRunId: "run_planner_failed_retry_1",
          state: "completed"
        },
        { ok: false, error: "retry_target_conflict" }
      ])
    );
    expect(createBriefCalls).toBe(1);
    await expect(repositories.taskSnapshots.getByTaskId("task_1")).resolves.toMatchObject({
      briefId: "brief_1"
    });
    await expect(repositories.briefs.getById("brief_2")).resolves.toBeUndefined();
  });

  it("fails closed without retrying when the page version is already reviewed", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await repositories.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_1",
      pageVersionId: "version_1",
      createdAt: timestamp
    });
    await repositories.pageVersions.save({
      id: "version_1",
      projectId: "project_1",
      briefId: "brief_1",
      artifacts: {
        indexHtml: "<!doctype html><html></html>",
        stylesCss: ":root {}",
        scriptJs: "window.lpAgent = true;"
      },
      reviewStatus: "passed",
      findings: [],
      createdAt: timestamp
    });
    await saveRun(repositories, {
      id: "run_reviewer_failed",
      role: "reviewer",
      state: "failed",
      completedAt: "2026-05-20T00:00:03.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_reviewer_failed",
      type: "run.failed",
      sequence: 1
    });

    let reviewCalls = 0;
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
          reviewCalls += 1;
          throw new Error("review must not be retried");
        },
        approveAndCreateDeployment: async () => {
          throw new Error("not used");
        }
      },
      currentUserId: "local-web-user",
      taskId: "task_1",
      runId: "run_reviewer_failed",
      action: "retry_run"
    });

    expect(result).toEqual({ ok: false, error: "retry_target_conflict" });
    expect(reviewCalls).toBe(0);
    await expect(repositories.pageVersions.getById("version_1")).resolves.toMatchObject({
      reviewStatus: "passed",
      findings: []
    });
  });

  it("prevents concurrent reviewer retries from overwriting review output", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await repositories.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_1",
      pageVersionId: "version_1",
      createdAt: timestamp
    });
    await repositories.pageVersions.save({
      id: "version_1",
      projectId: "project_1",
      briefId: "brief_1",
      artifacts: {
        indexHtml: "<!doctype html><html></html>",
        stylesCss: ":root {}",
        scriptJs: "window.lpAgent = true;"
      },
      reviewStatus: "pending",
      findings: [],
      createdAt: timestamp
    });
    await saveRun(repositories, {
      id: "run_reviewer_failed",
      role: "reviewer",
      state: "failed",
      completedAt: "2026-05-20T00:00:03.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_reviewer_failed",
      type: "run.failed",
      sequence: 1
    });

    let reviewCalls = 0;
    let releaseFirstRetry = () => {};
    let markFirstRetryStarted = () => {};
    const firstRetryStarted = new Promise<void>((resolve) => {
      markFirstRetryStarted = resolve;
    });
    const service = {
      createBriefFromPrompt: async () => {
        throw new Error("not used");
      },
      generatePageVersion: async () => {
        throw new Error("not used");
      },
      reviewPageVersion: async (input: {
        projectId: string;
        pageVersionId: string;
        taskId?: string;
        runId?: string;
      }): Promise<PageVersionRecord> => {
        reviewCalls += 1;
        const callNumber = reviewCalls;
        if (callNumber === 1) {
          markFirstRetryStarted();
          await new Promise<void>((release) => {
            releaseFirstRetry = release;
          });
        }
        const pageVersion = await repositories.pageVersions.getById(input.pageVersionId);
        if (!pageVersion) {
          throw new Error("missing page version");
        }
        const reviewed: PageVersionRecord = {
          ...pageVersion,
          reviewStatus: "passed",
          findings: []
        };
        await repositories.pageVersions.save(reviewed);
        await repositories.runs.save({
          id: input.runId ?? `run_reviewer_${input.pageVersionId}`,
          projectId: input.projectId,
          taskId: input.taskId,
          role: "reviewer",
          state: "completed",
          startedAt: timestamp,
          completedAt: `2026-05-20T00:10:0${callNumber}.000Z`,
          contextSummary: {
            injected: [],
            omitted: []
          }
        });
        return reviewed;
      },
      approveAndCreateDeployment: async () => {
        throw new Error("not used");
      }
    };

    const firstRetry = executeRunRecoveryAction({
      repositories,
      service,
      currentUserId: "local-web-user",
      taskId: "task_1",
      runId: "run_reviewer_failed",
      action: "retry_run"
    });
    const secondRetry = executeRunRecoveryAction({
      repositories,
      service,
      currentUserId: "local-web-user",
      taskId: "task_1",
      runId: "run_reviewer_failed",
      action: "retry_run"
    });

    await firstRetryStarted;
    releaseFirstRetry();

    const results = await Promise.all([firstRetry, secondRetry]);
    expect(results).toEqual(
      expect.arrayContaining([
        {
          ok: true,
          action: "retry_run",
          runId: "run_reviewer_failed",
          newRunId: "run_reviewer_failed_retry_1",
          state: "completed"
        },
        { ok: false, error: "retry_target_conflict" }
      ])
    );
    expect(reviewCalls).toBe(1);
    await expect(repositories.pageVersions.getById("version_1")).resolves.toMatchObject({
      reviewStatus: "passed",
      findings: []
    });
  });

  it("Reviewer retry uses the failed run consumed handoff page version instead of the current snapshot", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await repositories.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_2",
      pageVersionId: "version_2",
      createdAt: timestamp
    });
    for (const pageVersionId of ["version_1", "version_2"]) {
      await repositories.pageVersions.save({
        id: pageVersionId,
        projectId: "project_1",
        briefId: pageVersionId === "version_1" ? "brief_1" : "brief_2",
        artifacts: {
          indexHtml: "<!doctype html><html></html>",
          stylesCss: ":root {}",
          scriptJs: "window.lpAgent = true;"
        },
        reviewStatus: "pending",
        findings: [],
        createdAt: timestamp
      });
    }
    await saveRun(repositories, {
      id: "run_reviewer_failed",
      role: "reviewer",
      state: "failed",
      completedAt: "2026-05-20T00:00:03.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_reviewer_failed",
      type: "handoff.consumed",
      sequence: 1,
      payload: {
        artifactRefs: {
          pageVersionId: "version_1"
        }
      }
    });
    await saveEvent(repositories, {
      runId: "run_reviewer_failed",
      type: "run.failed",
      sequence: 2
    });

    let receivedPageVersionId = "";
    const result = await executeRunRecoveryAction({
      repositories,
      service: {
        createBriefFromPrompt: async () => {
          throw new Error("not used");
        },
        generatePageVersion: async () => {
          throw new Error("not used");
        },
        reviewPageVersion: async (input): Promise<PageVersionRecord> => {
          receivedPageVersionId = input.pageVersionId;
          const pageVersion = await repositories.pageVersions.getById(input.pageVersionId);
          if (!pageVersion) {
            throw new Error("missing page version");
          }
          return pageVersion;
        },
        approveAndCreateDeployment: async () => {
          throw new Error("not used");
        }
      },
      currentUserId: "local-web-user",
      taskId: "task_1",
      runId: "run_reviewer_failed",
      action: "retry_run"
    });

    expect(result).toEqual({
      ok: true,
      action: "retry_run",
      runId: "run_reviewer_failed",
      newRunId: "run_reviewer_failed_retry_1",
      state: "completed"
    });
    expect(receivedPageVersionId).toBe("version_1");
  });

  it("fails closed for a stale Reviewer retry without a consumed handoff", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await repositories.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_2",
      pageVersionId: "version_2",
      createdAt: timestamp
    });
    for (const pageVersionId of ["version_1", "version_2"]) {
      await repositories.pageVersions.save({
        id: pageVersionId,
        projectId: "project_1",
        briefId: pageVersionId === "version_1" ? "brief_1" : "brief_2",
        artifacts: {
          indexHtml: "<!doctype html><html></html>",
          stylesCss: ":root {}",
          scriptJs: "window.lpAgent = true;"
        },
        reviewStatus: "pending",
        findings: [],
        createdAt:
          pageVersionId === "version_1"
            ? "2026-05-20T00:02:00.000Z"
            : "2026-05-20T00:07:00.000Z"
      });
    }
    await saveRun(repositories, {
      id: "run_reviewer_failed",
      role: "reviewer",
      state: "failed",
      startedAt: "2026-05-20T00:03:00.000Z",
      completedAt: "2026-05-20T00:03:30.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_reviewer_failed",
      type: "run.failed",
      sequence: 1
    });

    let reviewCalls = 0;
    const result = await executeRunRecoveryAction({
      repositories,
      service: {
        createBriefFromPrompt: async () => {
          throw new Error("not used");
        },
        generatePageVersion: async () => {
          throw new Error("not used");
        },
        reviewPageVersion: async (): Promise<PageVersionRecord> => {
          reviewCalls += 1;
          const pageVersion = await repositories.pageVersions.getById("version_2");
          if (!pageVersion) {
            throw new Error("missing page version");
          }
          return pageVersion;
        },
        approveAndCreateDeployment: async () => {
          throw new Error("not used");
        }
      },
      currentUserId: "local-web-user",
      taskId: "task_1",
      runId: "run_reviewer_failed",
      action: "retry_run"
    });

    expect(result).toEqual({ ok: false, error: "retry_target_conflict" });
    expect(reviewCalls).toBe(0);
    await expect(repositories.taskSnapshots.getByTaskId("task_1")).resolves.toMatchObject({
      projectId: "project_1",
      briefId: "brief_2",
      pageVersionId: "version_2"
    });
  });

  it("passes fail-fast deployment creation into deployer retry failures", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await repositories.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_1",
      pageVersionId: "version_1",
      createdAt: timestamp
    });
    await repositories.pageVersions.save({
      id: "version_1",
      projectId: "project_1",
      briefId: "brief_1",
      artifacts: {
        indexHtml: "<!doctype html><html></html>",
        stylesCss: ":root {}",
        scriptJs: "window.lpAgent = true;"
      },
      reviewStatus: "passed",
      findings: [],
      createdAt: timestamp
    });
    await saveRun(repositories, {
      id: "run_deployer_failed",
      role: "deployer",
      state: "failed",
      completedAt: "2026-05-20T00:00:03.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_deployer_failed",
      type: "run.failed",
      sequence: 1
    });

    let receivedFailIfDeploymentExists: boolean | undefined;
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
        approveAndCreateDeployment: async (input) => {
          receivedFailIfDeploymentExists = input.failIfDeploymentExists;
          throw new Error("deployment_already_exists");
        }
      },
      currentUserId: "local-web-user",
      taskId: "task_1",
      runId: "run_deployer_failed",
      action: "retry_run"
    });

    expect(result).toEqual({ ok: false, error: "retry_failed" });
    expect(receivedFailIfDeploymentExists).toBe(true);
  });

  it("Deployer retry uses the failed run consumed handoff page version instead of the current snapshot", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await repositories.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_2",
      pageVersionId: "version_2",
      createdAt: timestamp
    });
    for (const pageVersionId of ["version_1", "version_2"]) {
      await repositories.pageVersions.save({
        id: pageVersionId,
        projectId: "project_1",
        briefId: pageVersionId === "version_1" ? "brief_1" : "brief_2",
        artifacts: {
          indexHtml: "<!doctype html><html></html>",
          stylesCss: ":root {}",
          scriptJs: "window.lpAgent = true;"
        },
        reviewStatus: "passed",
        findings: [],
        createdAt: timestamp
      });
    }
    await saveRun(repositories, {
      id: "run_deployer_failed",
      role: "deployer",
      state: "failed",
      completedAt: "2026-05-20T00:00:03.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_deployer_failed",
      type: "handoff.consumed",
      sequence: 1,
      payload: {
        artifactRefs: {
          pageVersionId: "version_1"
        }
      }
    });
    await saveEvent(repositories, {
      runId: "run_deployer_failed",
      type: "run.failed",
      sequence: 2
    });

    let receivedPageVersionId = "";
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
        approveAndCreateDeployment: async (input) => {
          receivedPageVersionId = input.pageVersionId;
          return {
            id: "deployment_1",
            projectId: input.projectId,
            pageVersionId: input.pageVersionId,
            branch: `deploy/${input.projectId}/${input.pageVersionId}`,
            commitSha: "abc1234",
            pullRequestUrl: `https://example.test/${input.pageVersionId}`,
            files: ["index.html", "styles.css", "script.js"],
            status: "pr_opened"
          };
        }
      },
      currentUserId: "local-web-user",
      taskId: "task_1",
      runId: "run_deployer_failed",
      action: "retry_run"
    });

    expect(result).toEqual({
      ok: true,
      action: "retry_run",
      runId: "run_deployer_failed",
      newRunId: "run_deployer_failed_retry_1",
      state: "completed"
    });
    expect(receivedPageVersionId).toBe("version_1");
  });

  it("fails closed for a stale Deployer retry without a consumed handoff", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveTask(repositories);
    await repositories.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_2",
      pageVersionId: "version_2",
      createdAt: timestamp
    });
    for (const pageVersionId of ["version_1", "version_2"]) {
      await repositories.pageVersions.save({
        id: pageVersionId,
        projectId: "project_1",
        briefId: pageVersionId === "version_1" ? "brief_1" : "brief_2",
        artifacts: {
          indexHtml: "<!doctype html><html></html>",
          stylesCss: ":root {}",
          scriptJs: "window.lpAgent = true;"
        },
        reviewStatus: "passed",
        findings: [],
        createdAt:
          pageVersionId === "version_1"
            ? "2026-05-20T00:02:00.000Z"
            : "2026-05-20T00:07:00.000Z"
      });
    }
    await saveRun(repositories, {
      id: "run_deployer_failed",
      role: "deployer",
      state: "failed",
      startedAt: "2026-05-20T00:03:00.000Z",
      completedAt: "2026-05-20T00:03:30.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_deployer_failed",
      type: "run.failed",
      sequence: 1
    });

    let deployCalls = 0;
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
          deployCalls += 1;
          throw new Error("deployment must not be retried");
        }
      },
      currentUserId: "local-web-user",
      taskId: "task_1",
      runId: "run_deployer_failed",
      action: "retry_run"
    });

    expect(result).toEqual({ ok: false, error: "retry_target_conflict" });
    expect(deployCalls).toBe(0);
    await expect(repositories.taskSnapshots.getByTaskId("task_1")).resolves.toMatchObject({
      projectId: "project_1",
      briefId: "brief_2",
      pageVersionId: "version_2"
    });
  });
});
