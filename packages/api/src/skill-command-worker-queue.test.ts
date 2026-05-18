import { describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import {
  createInMemoryWorkbenchRepositories,
  type RunRecord,
  type ToolObservationRecord,
  type WorkbenchRepositories
} from "@lp-agent/db";
import type { SkillManifest } from "@lp-agent/skills";
import {
  InMemoryWorkerJobPayloadRepository,
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter,
  createSimulatedSandboxPolicy,
  type WorkerJobRecord
} from "@lp-agent/worker-runtime";
import { DemoWorkbenchService } from "./index";
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

async function unlinkedWorkerJob(): Promise<{
  repositories: ReturnType<typeof createInMemoryWorkbenchRepositories>;
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

  return {
    repositories,
    workerJob: {
      ...queued,
      state: "completed",
      completedAt: "2026-05-18T00:00:03.000Z",
      resultSummary: {
        state: "completed",
        exitCode: 0,
        stdout: "published",
        stderr: "",
        stdoutBytes: 9,
        stderrBytes: 0
      }
    }
  };
}

function terminalEventTypes(events: Array<{ type: string }>): string[] {
  return events
    .filter(
      (event) =>
        event.type === "tool.completed" ||
        event.type === "tool.failed" ||
        event.type === "tool.cancelled" ||
        event.type === "run.completed" ||
        event.type === "run.failed" ||
        event.type === "run.cancelled"
    )
    .map((event) => event.type);
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
    expect(
      terminalEventTypes(await repositories.runEvents.listForRun("run_skill_command_1"))
    ).toHaveLength(0);
  });

  it("fails finalization without mutating state when worker job is not linked", async () => {
    const { repositories, workerJob } = await unlinkedWorkerJob();

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
    expect(
      terminalEventTypes(await repositories.runEvents.listForRun("run_skill_command_1"))
    ).toHaveLength(0);
  });

  it.each(["queued", "running"] as const)(
    "rejects %s worker jobs without mutating linked run state",
    async (state) => {
      const { repositories, workerJob: terminalWorkerJob } = await linkedWorkerJob({
        state: "completed"
      });
      const workerJob: WorkerJobRecord = {
        ...terminalWorkerJob,
        state,
        completedAt: undefined,
        resultSummary: undefined
      };

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
      await expect(repositories.toolObservations.listForRun("run_skill_command_1")).resolves.toEqual([
        expect.objectContaining({
          state: "running",
          outputSummary: ""
        })
      ]);
      expect(
        terminalEventTypes(await repositories.runEvents.listForRun("run_skill_command_1"))
      ).toHaveLength(0);
    }
  );

  it("fails finalization without appending terminal state when linked run is missing", async () => {
    const { repositories, workerJob } = await linkedWorkerJob({ state: "completed" });
    await repositories.runEvents.save({
      id: "missing_run_event_1",
      runId: "missing_run",
      projectId: "project_1",
      taskId: "task_1",
      sequence: 1,
      type: "worker.job.linked",
      message: "Worker job linked to missing run.",
      payload: {
        taskId: "task_1",
        runId: "missing_run",
        workerJobId: workerJob.id,
        observationId: "tool_observation_1"
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
    expect(terminalEventTypes(await repositories.runEvents.listAll())).toHaveLength(0);
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

  it("preserves failed worker state across idempotent finalization retries", async () => {
    const { repositories, workerJob } = await linkedWorkerJob({
      state: "failed",
      errorName: "simulated_command_failed"
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
    expect(first).toMatchObject({ ok: true, state: "failed" });
    expect(second).toMatchObject({ ok: true, state: "failed" });
    expect(events.filter((event) => event.type === "tool.failed")).toHaveLength(1);
    expect(events.filter((event) => event.type === "run.failed")).toHaveLength(1);
    await expect(repositories.runs.getById("run_skill_command_1")).resolves.toMatchObject({
      state: "failed"
    });
    await expect(repositories.toolObservations.listForRun("run_skill_command_1")).resolves.toEqual([
      expect.objectContaining({
        state: "failed",
        errorName: "simulated_command_failed"
      })
    ]);
  });

  it("preserves cancelled worker state across idempotent finalization retries", async () => {
    const { repositories, workerJob } = await linkedWorkerJob({
      state: "cancelled",
      errorName: "worker_job_cancelled"
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
    expect(first).toMatchObject({ ok: true, state: "cancelled" });
    expect(second).toMatchObject({ ok: true, state: "cancelled" });
    expect(events.filter((event) => event.type === "tool.cancelled")).toHaveLength(1);
    expect(events.filter((event) => event.type === "run.cancelled")).toHaveLength(1);
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

describe("queued skill command enqueueing", () => {
  it("enqueues a safe worker job and leaves the run running", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await savePublishedBoundDeploymentSkill(repositories, deploymentSkillManifest());
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const workerRuntime = new InMemoryWorkerRuntime({
      payloadRepository,
      adapter: new SimulatedExecutionAdapter(),
      now: () => new Date("2026-05-18T00:00:02.000Z")
    });
    const service = new DemoWorkbenchService({
      repositories,
      workerQueueRuntime: workerRuntime,
      now: () => new Date("2026-05-18T00:00:01.000Z")
    });

    const result = await service.enqueueProjectSkillCommand({
      projectId: "project_1",
      skillVersionId: "skill_version_1",
      commandId: "publish_static",
      approvedByUserId: "local-web-user",
      taskId: "task_1"
    });

    expect(result.workerJobId).toBe("worker_job_1");
    expect(result.run).toMatchObject({
      id: "run_skill_command_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "deployer",
      state: "running",
      startedAt: "2026-05-18T00:00:01.000Z",
      contextSummary: {
        injected: [
          "skillCommand:skill_static_deploy:publish_static",
          "workerQueue:safe"
        ],
        omitted: []
      }
    });
    expect(result.observation).toMatchObject({
      id: "tool_observation_1",
      runId: "run_skill_command_1",
      projectId: "project_1",
      taskId: "task_1",
      toolName: "skill:skill_static_deploy:publish_static",
      outputSummary: "",
      state: "running",
      input: {
        skillId: "skill_static_deploy",
        skillVersionId: "skill_version_1",
        commandId: "publish_static",
        permission: "deploy:simulate",
        approvedByUserId: "local-web-user",
        argCount: 2,
        envNames: ["LP_PROJECT_ID"]
      }
    });

    const workerJob = await workerRuntime.getJob(result.workerJobId);
    const persistedPayload = await payloadRepository.getByJobId(result.workerJobId);
    expect(workerJob).toMatchObject({
      id: result.workerJobId,
      state: "queued",
      payloadSource: "safe_persisted",
      inputSummary: {
        projectId: "project_1",
        commandId: "publish_static",
        command: "static-deploy",
        argCount: 2,
        envNames: ["LP_PROJECT_ID"]
      }
    });
    expect(persistedPayload).toMatchObject({
      jobId: result.workerJobId,
      command: "static-deploy",
      args: ["--project", "project_1"],
      envNames: ["LP_PROJECT_ID"]
    });

    const events = await repositories.runEvents.listForRun(result.run.id);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "worker.job.linked"
    ]);
    expect(events[2]).toMatchObject({
      sequence: 3,
      message: "Worker job linked to task.",
      payload: {
        skillId: "skill_static_deploy",
        skillVersionId: "skill_version_1",
        commandId: "publish_static",
        permission: "deploy:simulate",
        approvedByUserId: "local-web-user",
        taskId: "task_1",
        runId: result.run.id,
        workerJobId: result.workerJobId,
        observationId: result.observation.id
      }
    });
  });

  it("rejects non-queueable commands that require secrets", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await savePublishedBoundDeploymentSkill(
      repositories,
      deploymentSkillManifest({
        requiredSecrets: ["DEPLOY_TOKEN"],
        env: [{ name: "DEPLOY_TOKEN", secretRef: "DEPLOY_TOKEN" }]
      })
    );
    const service = new DemoWorkbenchService({
      repositories,
      workerQueueRuntime: new InMemoryWorkerRuntime()
    });

    await expect(
      service.enqueueProjectSkillCommand({
        projectId: "project_1",
        skillVersionId: "skill_version_1",
        commandId: "publish_static",
        approvedByUserId: "local-web-user",
        taskId: "task_1"
      })
    ).rejects.toThrow("skill_command_not_queueable");
  });

  it("marks the run failed when safe worker enqueueing fails after start events", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await savePublishedBoundDeploymentSkill(repositories, deploymentSkillManifest());
    const workerRuntime: SkillCommandQueueRuntime = {
      enqueueSafe: async () => {
        throw new Error("enqueue failed");
      },
      claimOldestQueued: async () => undefined,
      runClaimedJob: async () => {
        throw new Error("unexpected run");
      },
      getJob: async () => undefined
    };
    const service = new DemoWorkbenchService({
      repositories,
      workerQueueRuntime: workerRuntime,
      now: () => new Date("2026-05-18T00:00:01.000Z")
    });

    await expect(
      service.enqueueProjectSkillCommand({
        projectId: "project_1",
        skillVersionId: "skill_version_1",
        commandId: "publish_static",
        approvedByUserId: "local-web-user",
        taskId: "task_1"
      })
    ).rejects.toThrow("enqueue failed");

    await expect(repositories.runs.getById("run_skill_command_1")).resolves.toMatchObject({
      state: "failed",
      completedAt: "2026-05-18T00:00:01.000Z"
    });
    await expect(repositories.toolObservations.listForRun("run_skill_command_1")).resolves.toEqual([
      expect.objectContaining({
        id: "tool_observation_1",
        state: "failed",
        outputSummary: "Worker job enqueue failed.",
        errorName: "worker_job_enqueue_failed",
        completedAt: "2026-05-18T00:00:01.000Z"
      })
    ]);
    const events = await repositories.runEvents.listForRun("run_skill_command_1");
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.failed",
      "run.failed"
    ]);
    expect(events.filter((event) => event.type === "worker.job.linked")).toHaveLength(0);
    expect(events.slice(2)).toEqual([
      expect.objectContaining({
        sequence: 3,
        type: "tool.failed",
        payload: expect.objectContaining({
          observationId: "tool_observation_1",
          outputSummary: "Worker job enqueue failed.",
          errorName: "worker_job_enqueue_failed"
        })
      }),
      expect.objectContaining({
        sequence: 4,
        type: "run.failed",
        payload: expect.objectContaining({
          observationId: "tool_observation_1",
          outputSummary: "Worker job enqueue failed.",
          errorName: "worker_job_enqueue_failed"
        })
      })
    ]);
  });

  it("cancels the worker job and marks the run failed when linking the job fails", async () => {
    const baseRepositories = createInMemoryWorkbenchRepositories();
    const repositories = withThrowingWorkerJobLinkedSave(baseRepositories);
    await savePublishedBoundDeploymentSkill(repositories, deploymentSkillManifest());
    const payloadRepository = new InMemoryWorkerJobPayloadRepository();
    const workerRuntime = new InMemoryWorkerRuntime({
      payloadRepository,
      adapter: new SimulatedExecutionAdapter(),
      now: () => new Date("2026-05-18T00:00:02.000Z")
    });
    const service = new DemoWorkbenchService({
      repositories,
      workerQueueRuntime: workerRuntime,
      now: () => new Date("2026-05-18T00:00:01.000Z")
    });

    await expect(
      service.enqueueProjectSkillCommand({
        projectId: "project_1",
        skillVersionId: "skill_version_1",
        commandId: "publish_static",
        approvedByUserId: "local-web-user",
        taskId: "task_1"
      })
    ).rejects.toThrow("worker link failed");

    await expect(repositories.runs.getById("run_skill_command_1")).resolves.toMatchObject({
      state: "failed",
      completedAt: "2026-05-18T00:00:01.000Z"
    });
    await expect(repositories.toolObservations.listForRun("run_skill_command_1")).resolves.toEqual([
      expect.objectContaining({
        id: "tool_observation_1",
        state: "failed",
        outputSummary: "Worker job link failed.",
        errorName: "worker_job_link_failed",
        completedAt: "2026-05-18T00:00:01.000Z"
      })
    ]);
    await expect(workerRuntime.getJob("worker_job_1")).resolves.toMatchObject({
      state: "cancelled",
      errorName: "worker_job_cancelled",
      cancelReason: "Worker job link failed."
    });
    await expect(payloadRepository.getByJobId("worker_job_1")).resolves.toBeUndefined();
    const events = await repositories.runEvents.listForRun("run_skill_command_1");
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.failed",
      "run.failed"
    ]);
    expect(events.filter((event) => event.type === "worker.job.linked")).toHaveLength(0);
    expect(events.slice(2)).toEqual([
      expect.objectContaining({
        sequence: 3,
        type: "tool.failed",
        payload: expect.objectContaining({
          observationId: "tool_observation_1",
          workerJobId: "worker_job_1",
          outputSummary: "Worker job link failed.",
          errorName: "worker_job_link_failed"
        })
      }),
      expect.objectContaining({
        sequence: 4,
        type: "run.failed",
        payload: expect.objectContaining({
          observationId: "tool_observation_1",
          workerJobId: "worker_job_1",
          outputSummary: "Worker job link failed.",
          errorName: "worker_job_link_failed"
        })
      })
    ]);
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

function withThrowingWorkerJobLinkedSave(
  repositories: WorkbenchRepositories
): WorkbenchRepositories {
  return {
    ...repositories,
    runEvents: {
      save: async (event) => {
        if (event.type === "worker.job.linked") {
          throw new Error("worker link failed");
        }
        await repositories.runEvents.save(event);
      },
      listForRun: repositories.runEvents.listForRun.bind(repositories.runEvents),
      listForTask: repositories.runEvents.listForTask.bind(repositories.runEvents),
      listForProject: repositories.runEvents.listForProject.bind(
        repositories.runEvents
      ),
      listAll: repositories.runEvents.listAll.bind(repositories.runEvents)
    }
  };
}

function deploymentSkillManifest(
  overrides: Partial<SkillManifest> & {
    env?: NonNullable<NonNullable<SkillManifest["commands"]>[number]["env"]>;
  } = {}
): SkillManifest {
  const { env, ...manifestOverrides } = overrides;
  return {
    id: "skill_static_deploy",
    name: "Static deploy",
    version: "1.0.0",
    type: "deployment",
    scope: "project",
    description: "Deploys static LP artifacts.",
    permissions: ["deploy:simulate"],
    requiredSecrets: [],
    entrypoints: [],
    reviewState: "published",
    commands: [
      {
        id: "publish_static",
        name: "Publish static artifacts",
        permission: "deploy:simulate",
        requiresApproval: true,
        command: "static-deploy",
        args: ["--project", "{{projectId}}"],
        env: env ?? [{ name: "LP_PROJECT_ID", value: "{{projectId}}" }],
        timeoutMs: 30000
      }
    ],
    ...manifestOverrides
  };
}

async function savePublishedBoundDeploymentSkill(
  repositories: ReturnType<typeof createInMemoryWorkbenchRepositories>,
  manifest: SkillManifest
): Promise<void> {
  await repositories.projects.save({
    id: "project_1",
    name: "Demo project",
    createdAt: "2026-05-18T00:00:00.000Z"
  });
  await repositories.skills.save({
    id: manifest.id,
    name: manifest.name,
    type: manifest.type,
    scope: manifest.scope,
    createdAt: "2026-05-18T00:00:00.000Z"
  });
  await repositories.skillVersions.save({
    id: "skill_version_1",
    skillId: manifest.id,
    version: manifest.version,
    manifest,
    content: "Deploy static LP artifacts.",
    contentType: "text/markdown",
    reviewState: "published",
    createdAt: "2026-05-18T00:00:00.000Z"
  });
  await repositories.skillBindings.save({
    id: "skill_binding_1",
    skillVersionId: "skill_version_1",
    scope: "project",
    targetKey: "project_1",
    projectId: "project_1",
    enabled: true,
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z"
  });
}
