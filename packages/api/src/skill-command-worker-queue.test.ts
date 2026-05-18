import { describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import {
  createInMemoryWorkbenchRepositories,
  type RunRecord,
  type ToolObservationRecord,
  type WorkbenchRepositories
} from "@lp-agent/db";
import {
  InMemoryWorkerJobPayloadRepository,
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter,
  createSimulatedSandboxPolicy,
  type WorkerJobRecord
} from "@lp-agent/worker-runtime";
import {
  finalizeWorkerBackedSkillCommand,
  runLocalWorkerOnceAndFinalize,
  type SkillCommandQueueRuntime
} from "./skill-command-worker-queue";

function runningRun(): RunRecord {
  return {
    id: "run_skill_command_1",
    projectId: "project_1",
    taskId: "task_1",
    role: "deployer",
    state: "running",
    startedAt: "2026-05-18T00:00:00.000Z",
    contextSummary: {
      injected: ["skillCommand:skill_static_deploy:publish_static"],
      omitted: []
    }
  };
}

function runningObservation(): ToolObservationRecord {
  return {
    id: "tool_observation_1",
    runId: "run_skill_command_1",
    projectId: "project_1",
    taskId: "task_1",
    toolName: "skill:skill_static_deploy:publish_static",
    input: {
      skillId: "skill_static_deploy",
      skillVersionId: "skill_version_1",
      commandId: "publish_static",
      permission: "deploy:simulate",
      approvedByUserId: "local-web-user",
      argCount: 2,
      envNames: ["LP_PROJECT_ID"]
    },
    outputSummary: "",
    state: "running",
    createdAt: "2026-05-18T00:00:00.000Z"
  };
}

async function linkedWorkerJob(input: {
  state?: "completed" | "failed" | "rejected" | "cancelled";
  errorName?: string;
  stdout?: string;
  stderr?: string;
  stdoutBytes?: number;
  stderrBytes?: number;
} = {}): Promise<{
  repositories: ReturnType<typeof createInMemoryWorkbenchRepositories>;
  workerRuntime: InMemoryWorkerRuntime;
  workerJob: WorkerJobRecord;
}> {
  const repositories = createInMemoryWorkbenchRepositories();
  await repositories.runs.save(runningRun());
  await repositories.toolObservations.save(runningObservation());
  await repositories.runEvents.save({
    id: "run_skill_command_1_event_1",
    runId: "run_skill_command_1",
    projectId: "project_1",
    taskId: "task_1",
    sequence: 1,
    type: "run.started",
    message: "Deployment skill command run started.",
    payload: { commandId: "publish_static", observationId: "tool_observation_1" },
    createdAt: "2026-05-18T00:00:00.000Z"
  });
  await repositories.runEvents.save({
    id: "run_skill_command_1_event_2",
    runId: "run_skill_command_1",
    projectId: "project_1",
    taskId: "task_1",
    sequence: 2,
    type: "tool.started",
    message: "Deployment skill command queued.",
    payload: { commandId: "publish_static", observationId: "tool_observation_1" },
    createdAt: "2026-05-18T00:00:01.000Z"
  });

  const workerRuntime = new InMemoryWorkerRuntime({
    now: () => new Date("2026-05-18T00:00:02.000Z")
  });
  const queued = await workerRuntime.enqueue(
    {
      projectId: "project_1",
      kind: "tool_command",
      commandId: "publish_static",
      command: "static-deploy",
      args: ["--project", "project_1"],
      env: { LP_PROJECT_ID: "project_1" },
      timeoutMs: 30000
    },
    createSimulatedSandboxPolicy({
      allowedCommands: ["static-deploy"],
      allowedEnvNames: ["LP_PROJECT_ID"]
    })
  );
  const stdout = input.stdout ?? (input.state === "completed" ? "published" : "");
  const stderr = input.stderr ?? (input.state === "completed" ? "" : "failed");
  const workerJob = input.state
    ? {
        ...queued,
        state: input.state,
        completedAt: "2026-05-18T00:00:03.000Z",
        errorName: input.errorName,
        resultSummary: {
          state: input.state,
          exitCode: input.state === "completed" ? 0 : 1,
          stdout,
          stderr,
          stdoutBytes: input.stdoutBytes ?? Buffer.byteLength(stdout, "utf8"),
          stderrBytes: input.stderrBytes ?? Buffer.byteLength(stderr, "utf8"),
          errorName: input.errorName
        }
      }
    : await workerRuntime.runNext();
  if (!workerJob) {
    throw new Error("Expected worker job.");
  }
  await repositories.runEvents.save({
    id: "run_skill_command_1_event_3",
    runId: "run_skill_command_1",
    projectId: "project_1",
    taskId: "task_1",
    sequence: 3,
    type: "worker.job.linked",
    message: "Worker job linked to task.",
    payload: {
      taskId: "task_1",
      runId: "run_skill_command_1",
      workerJobId: workerJob.id,
      observationId: "tool_observation_1"
    },
    createdAt: "2026-05-18T00:00:02.000Z"
  });
  return { repositories, workerRuntime, workerJob };
}

describe("worker-backed skill command finalization", () => {
  it("finalizes a completed worker job into completed tool and run events", async () => {
    const { repositories, workerJob } = await linkedWorkerJob({ state: "completed" });

    const result = await finalizeWorkerBackedSkillCommand({
      repositories,
      workerJob,
      now: () => new Date("2026-05-18T00:00:04.000Z")
    });

    expect(result).toMatchObject({
      ok: true,
      state: "completed",
      workerJobId: workerJob.id,
      runId: "run_skill_command_1"
    });
    await expect(repositories.runs.getById("run_skill_command_1")).resolves.toMatchObject({
      state: "completed",
      completedAt: "2026-05-18T00:00:04.000Z"
    });
    await expect(repositories.toolObservations.listForRun("run_skill_command_1")).resolves.toEqual([
      expect.objectContaining({
        id: "tool_observation_1",
        state: "completed",
        outputSummary: expect.stringContaining("stdout: 9 bytes")
      })
    ]);
    await expect(repositories.runEvents.listForRun("run_skill_command_1")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool.completed" }),
        expect.objectContaining({ type: "run.completed" })
      ])
    );
  });

  it("uses byte-count output summaries without exposing raw worker output", async () => {
    const rawStdout = "你好a";
    const rawStderr = "部署失败";
    const { repositories, workerJob } = await linkedWorkerJob({
      state: "completed",
      stdout: rawStdout,
      stderr: rawStderr
    });

    await finalizeWorkerBackedSkillCommand({
      repositories,
      workerJob,
      now: () => new Date("2026-05-18T00:00:04.000Z")
    });

    const expectedSummary = [
      `stdout: ${Buffer.byteLength(rawStdout, "utf8")} bytes`,
      `stderr: ${Buffer.byteLength(rawStderr, "utf8")} bytes`
    ].join("\n");
    const observations = await repositories.toolObservations.listForRun(
      "run_skill_command_1"
    );
    expect(observations[0]?.outputSummary).toBe(expectedSummary);
    expect(observations[0]?.outputSummary).not.toContain(rawStdout);
    expect(observations[0]?.outputSummary).not.toContain(rawStderr);

    const terminalEvents = (await repositories.runEvents.listForRun(
      "run_skill_command_1"
    )).filter((event) => event.type === "tool.completed" || event.type === "run.completed");
    for (const event of terminalEvents) {
      expect(event.payload).toMatchObject({ outputSummary: expectedSummary });
      expect(JSON.stringify(event.payload)).not.toContain(rawStdout);
      expect(JSON.stringify(event.payload)).not.toContain(rawStderr);
    }
  });

  it("is idempotent when a terminal run event already exists", async () => {
    const { repositories, workerJob } = await linkedWorkerJob({ state: "completed" });
    await finalizeWorkerBackedSkillCommand({
      repositories,
      workerJob,
      now: () => new Date("2026-05-18T00:00:04.000Z")
    });

    const second = await finalizeWorkerBackedSkillCommand({
      repositories,
      workerJob,
      now: () => new Date("2026-05-18T00:00:05.000Z")
    });

    const events = await repositories.runEvents.listForRun("run_skill_command_1");
    const terminalRunEvents = events.filter(
      (event) => event.type === "run.completed"
    );
    const terminalToolEvents = events.filter(
      (event) => event.type === "tool.completed"
    );
    expect(second).toMatchObject({ ok: true, state: "completed" });
    expect(terminalRunEvents).toHaveLength(1);
    expect(terminalToolEvents).toHaveLength(1);
  });

  it("does not duplicate terminal tool events while writing a missing terminal run event", async () => {
    const { repositories, workerJob } = await linkedWorkerJob({ state: "completed" });
    await repositories.runEvents.save({
      id: "run_skill_command_1_event_4",
      runId: "run_skill_command_1",
      projectId: "project_1",
      taskId: "task_1",
      sequence: 4,
      type: "tool.completed",
      message: "Deployment skill command completed.",
      payload: {
        workerJobId: workerJob.id,
        observationId: "tool_observation_1",
        outputSummary: "stdout: 9 bytes\nstderr: 0 bytes",
        exitCode: 0
      },
      createdAt: "2026-05-18T00:00:03.000Z"
    });

    const result = await finalizeWorkerBackedSkillCommand({
      repositories,
      workerJob,
      now: () => new Date("2026-05-18T00:00:04.000Z")
    });

    const events = await repositories.runEvents.listForRun("run_skill_command_1");
    expect(result).toMatchObject({ ok: true, state: "completed" });
    expect(events.filter((event) => event.type === "tool.completed")).toHaveLength(1);
    expect(events.filter((event) => event.type === "run.completed")).toHaveLength(1);
    await expect(repositories.runs.getById("run_skill_command_1")).resolves.toMatchObject({
      state: "completed",
      completedAt: "2026-05-18T00:00:04.000Z"
    });
    await expect(repositories.toolObservations.listForRun("run_skill_command_1")).resolves.toEqual([
      expect.objectContaining({
        state: "completed",
        outputSummary: "stdout: 9 bytes\nstderr: 0 bytes"
      })
    ]);
  });

  it("reconciles stale records when a terminal run event already exists", async () => {
    const { repositories, workerJob } = await linkedWorkerJob({ state: "completed" });
    await repositories.runEvents.save({
      id: "run_skill_command_1_event_4",
      runId: "run_skill_command_1",
      projectId: "project_1",
      taskId: "task_1",
      sequence: 4,
      type: "run.completed",
      message: "Deployment skill command run completed.",
      payload: {
        workerJobId: workerJob.id,
        observationId: "tool_observation_1",
        outputSummary: "stdout: 9 bytes\nstderr: 0 bytes",
        exitCode: 0
      },
      createdAt: "2026-05-18T00:00:03.000Z"
    });

    const result = await finalizeWorkerBackedSkillCommand({
      repositories,
      workerJob,
      now: () => new Date("2026-05-18T00:00:04.000Z")
    });

    const events = await repositories.runEvents.listForRun("run_skill_command_1");
    expect(result).toMatchObject({ ok: true, state: "completed" });
    expect(events.filter((event) => event.type === "run.completed")).toHaveLength(1);
    expect(events.filter((event) => event.type === "tool.completed")).toHaveLength(1);
    await expect(repositories.runs.getById("run_skill_command_1")).resolves.toMatchObject({
      state: "completed",
      completedAt: "2026-05-18T00:00:03.000Z"
    });
    await expect(repositories.toolObservations.listForRun("run_skill_command_1")).resolves.toEqual([
      expect.objectContaining({
        state: "completed",
        outputSummary: "stdout: 9 bytes\nstderr: 0 bytes",
        completedAt: "2026-05-18T00:00:03.000Z"
      })
    ]);
  });

  it("fails finalization without appending terminal state when linked observation is missing", async () => {
    const { repositories, workerJob } = await linkedWorkerJob({ state: "completed" });
    await repositories.runEvents.save({
      id: "run_skill_command_1_event_4",
      runId: "run_skill_command_1",
      projectId: "project_1",
      taskId: "task_1",
      sequence: 4,
      type: "worker.job.linked",
      message: "Worker job linked to task with missing observation.",
      payload: {
        taskId: "task_1",
        runId: "run_skill_command_1",
        workerJobId: workerJob.id,
        observationId: "missing_observation"
      },
      createdAt: "2026-05-18T00:00:03.000Z"
    });

    const result = await finalizeWorkerBackedSkillCommand({
      repositories,
      workerJob,
      now: () => new Date("2026-05-18T00:00:04.000Z")
    });

    expect(result).toEqual({
      ok: false,
      error: "worker_job_finalization_failed"
    });
    await expect(repositories.runs.getById("run_skill_command_1")).resolves.toMatchObject({
      state: "running"
    });
    const terminalEvents = (await repositories.runEvents.listForRun("run_skill_command_1"))
      .filter((event) =>
        event.type === "tool.completed" ||
        event.type === "tool.failed" ||
        event.type === "tool.cancelled" ||
        event.type === "run.completed" ||
        event.type === "run.failed" ||
        event.type === "run.cancelled"
      );
    expect(terminalEvents).toHaveLength(0);
  });

  it("preserves rejected worker state across idempotent finalization retries", async () => {
    const { repositories, workerJob } = await linkedWorkerJob({
      state: "rejected",
      errorName: "sandbox_policy_command_not_allowed"
    });

    const first = await finalizeWorkerBackedSkillCommand({
      repositories,
      workerJob,
      now: () => new Date("2026-05-18T00:00:04.000Z")
    });
    const second = await finalizeWorkerBackedSkillCommand({
      repositories,
      workerJob,
      now: () => new Date("2026-05-18T00:00:05.000Z")
    });

    const events = await repositories.runEvents.listForRun("run_skill_command_1");
    expect(first).toMatchObject({ ok: true, state: "rejected" });
    expect(second).toMatchObject({ ok: true, state: "rejected" });
    expect(events.filter((event) => event.type === "tool.failed")).toHaveLength(1);
    expect(events.filter((event) => event.type === "run.failed")).toHaveLength(1);
    await expect(repositories.runs.getById("run_skill_command_1")).resolves.toMatchObject({
      state: "failed"
    });
    await expect(repositories.toolObservations.listForRun("run_skill_command_1")).resolves.toEqual([
      expect.objectContaining({
        state: "failed",
        errorName: "sandbox_policy_command_not_allowed"
      })
    ]);
  });

  it("finalizes cancelled worker jobs as cancelled instead of failed", async () => {
    const { repositories, workerJob } = await linkedWorkerJob({
      state: "cancelled",
      errorName: "worker_job_cancelled"
    });

    await finalizeWorkerBackedSkillCommand({
      repositories,
      workerJob,
      now: () => new Date("2026-05-18T00:00:04.000Z")
    });

    await expect(repositories.runs.getById("run_skill_command_1")).resolves.toMatchObject({
      state: "cancelled"
    });
    await expect(repositories.toolObservations.listForRun("run_skill_command_1")).resolves.toEqual([
      expect.objectContaining({
        state: "cancelled",
        errorName: "worker_job_cancelled"
      })
    ]);
  });

  it("sanitizes empty worker error names when finalizing failed jobs", async () => {
    const { repositories, workerJob } = await linkedWorkerJob({
      state: "failed",
      errorName: ""
    });

    await finalizeWorkerBackedSkillCommand({
      repositories,
      workerJob,
      now: () => new Date("2026-05-18T00:00:04.000Z")
    });

    await expect(repositories.toolObservations.listForRun("run_skill_command_1")).resolves.toEqual([
      expect.objectContaining({
        state: "failed",
        errorName: "worker_job_error"
      })
    ]);
    const events = await repositories.runEvents.listForRun("run_skill_command_1");
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool.failed",
          payload: expect.objectContaining({ errorName: "worker_job_error" })
        }),
        expect.objectContaining({
          type: "run.failed",
          payload: expect.objectContaining({ errorName: "worker_job_error" })
        })
      ])
    );
  });

  it("runs one safe queued worker job and finalizes the linked run", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.runs.save(runningRun());
    await repositories.toolObservations.save(runningObservation());
    const workerRuntime = new InMemoryWorkerRuntime({
      payloadRepository: new InMemoryWorkerJobPayloadRepository(),
      adapter: new SimulatedExecutionAdapter(),
      now: () => new Date("2026-05-18T00:00:02.000Z")
    });
    const workerJob = await workerRuntime.enqueueSafe(
      {
        projectId: "project_1",
        kind: "tool_command",
        commandId: "publish_static",
        command: "static-deploy",
        args: ["--project", "project_1"],
        envNames: ["LP_PROJECT_ID"],
        timeoutMs: 30000
      },
      createSimulatedSandboxPolicy({
        allowedCommands: ["static-deploy"],
        allowedEnvNames: ["LP_PROJECT_ID"]
      })
    );
    await repositories.runEvents.save({
      id: "run_skill_command_1_event_1",
      runId: "run_skill_command_1",
      projectId: "project_1",
      taskId: "task_1",
      sequence: 1,
      type: "worker.job.linked",
      message: "Worker job linked to task.",
      payload: {
        taskId: "task_1",
        runId: "run_skill_command_1",
        workerJobId: workerJob.id,
        observationId: "tool_observation_1"
      },
      createdAt: "2026-05-18T00:00:02.000Z"
    });
    const finalizeSpy = vi.fn();

    const result = await runLocalWorkerOnceAndFinalize({
      repositories,
      workerRuntime,
      workerId: "local-web-worker",
      afterFinalize: finalizeSpy,
      now: () => new Date("2026-05-18T00:00:04.000Z")
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected worker result.");
    }
    expect(result.state).toBe("completed");
    expect(finalizeSpy).toHaveBeenCalledOnce();
  });

  it("returns worker runtime not configured when no runtime is available", async () => {
    const repositories = createInMemoryWorkbenchRepositories();

    await expect(
      runLocalWorkerOnceAndFinalize({
        repositories,
        workerId: "local-web-worker"
      })
    ).resolves.toEqual({
      ok: false,
      error: "worker_runtime_not_configured"
    });
  });

  it("maps worker claim and run exceptions to worker job execution failed", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const { workerJob } = await linkedWorkerJob({ state: "completed" });
    const throwingClaimRuntime: SkillCommandQueueRuntime = {
      enqueueSafe: async () => workerJob,
      claimOldestQueued: async () => {
        throw new Error("claim failed");
      },
      runClaimedJob: async () => workerJob,
      getJob: async () => undefined
    };
    await expect(
      runLocalWorkerOnceAndFinalize({
        repositories,
        workerRuntime: throwingClaimRuntime,
        workerId: "local-web-worker"
      })
    ).resolves.toEqual({
      ok: false,
      error: "worker_job_execution_failed"
    });

    const throwingRunRuntime: SkillCommandQueueRuntime = {
      enqueueSafe: async () => workerJob,
      claimOldestQueued: async () => ({
        record: workerJob,
        claimToken: "claim_token_1"
      }),
      runClaimedJob: async () => {
        throw new Error("run failed");
      },
      getJob: async () => undefined
    };
    await expect(
      runLocalWorkerOnceAndFinalize({
        repositories,
        workerRuntime: throwingRunRuntime,
        workerId: "local-web-worker"
      })
    ).resolves.toEqual({
      ok: false,
      error: "worker_job_execution_failed"
    });
  });

  it("maps finalization exceptions to worker job finalization failed", async () => {
    const baseRepositories = createInMemoryWorkbenchRepositories();
    const repositories = withThrowingRunEventListAll(baseRepositories);
    const { workerJob } = await linkedWorkerJob({ state: "completed" });
    const workerRuntime: SkillCommandQueueRuntime = {
      enqueueSafe: async () => workerJob,
      claimOldestQueued: async () => ({
        record: workerJob,
        claimToken: "claim_token_1"
      }),
      runClaimedJob: async () => workerJob,
      getJob: async () => undefined
    };

    await expect(
      runLocalWorkerOnceAndFinalize({
        repositories,
        workerRuntime,
        workerId: "local-web-worker"
      })
    ).resolves.toEqual({
      ok: false,
      error: "worker_job_finalization_failed"
    });
  });

  it("returns idle when there is no queued worker job", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const workerRuntime = new InMemoryWorkerRuntime();

    await expect(
      runLocalWorkerOnceAndFinalize({
        repositories,
        workerRuntime,
        workerId: "local-web-worker"
      })
    ).resolves.toEqual({ ok: true, state: "idle" });
  });
});

function withThrowingRunEventListAll(
  repositories: WorkbenchRepositories
): WorkbenchRepositories {
  return {
    ...repositories,
    runEvents: {
      save: repositories.runEvents.save.bind(repositories.runEvents),
      listForRun: repositories.runEvents.listForRun.bind(repositories.runEvents),
      listForTask: repositories.runEvents.listForTask.bind(repositories.runEvents),
      listForProject: repositories.runEvents.listForProject.bind(
        repositories.runEvents
      ),
      listAll: async () => {
        throw new Error("run event list failed");
      }
    }
  };
}
