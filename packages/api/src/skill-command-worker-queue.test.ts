import { describe, expect, it, vi } from "vitest";
import {
  createInMemoryWorkbenchRepositories,
  type RunRecord,
  type ToolObservationRecord
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
  runLocalWorkerOnceAndFinalize
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
  const workerJob = input.state
    ? {
        ...queued,
        state: input.state,
        completedAt: "2026-05-18T00:00:03.000Z",
        errorName: input.errorName,
        resultSummary: {
          state: input.state,
          exitCode: input.state === "completed" ? 0 : 1,
          stdout: input.state === "completed" ? "published" : "",
          stderr: input.state === "completed" ? "" : "failed",
          stdoutBytes: input.state === "completed" ? 9 : 0,
          stderrBytes: input.state === "completed" ? 0 : 6,
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
        outputSummary: expect.stringContaining("stdout: 9 chars")
      })
    ]);
    await expect(repositories.runEvents.listForRun("run_skill_command_1")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool.completed" }),
        expect.objectContaining({ type: "run.completed" })
      ])
    );
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

    const terminalEvents = (await repositories.runEvents.listForRun("run_skill_command_1")).filter(
      (event) => event.type === "run.completed"
    );
    expect(second).toMatchObject({ ok: true, state: "completed" });
    expect(terminalEvents).toHaveLength(1);
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
