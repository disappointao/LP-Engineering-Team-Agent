import { describe, expect, it } from "vitest";
import { createInMemoryWorkbenchRepositories } from "@lp-agent/db";
import {
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter,
  createRejectSandboxPolicy,
  createSimulatedSandboxPolicy,
  type ExecutionAdapter,
  type ExecutionContext,
  type ExecutionInput,
  type ExecutionResult,
  type SandboxPolicy
} from "@lp-agent/worker-runtime";
import {
  deriveTaskInterruptView,
  interruptTask,
  linkWorkerJobToTask
} from "./task-interrupts";

function fixedNow(values: string[] = []) {
  const queue = [...values];
  return () => new Date(queue.shift() ?? "2026-05-18T00:00:10.000Z");
}

async function saveTaskAndRun(input: {
  repositories: ReturnType<typeof createInMemoryWorkbenchRepositories>;
  taskId?: string;
  projectId?: string;
  runId?: string;
}) {
  const taskId = input.taskId ?? "task_1";
  const projectId = input.projectId ?? "project_1";
  const runId = input.runId ?? "run_interrupt_1";
  await input.repositories.projects.save({
    id: projectId,
    name: "Project",
    createdAt: "2026-05-18T00:00:00.000Z"
  });
  await input.repositories.tasks.save({
    id: taskId,
    title: "Interruptible task",
    type: "lp_generation",
    status: "complete",
    projectId,
    createdAt: "2026-05-18T00:00:00.000Z"
  });
  await input.repositories.runs.save({
    id: runId,
    projectId,
    taskId,
    role: "deployer",
    state: "running",
    startedAt: "2026-05-18T00:00:00.000Z",
    contextSummary: {
      injected: ["workerJob:worker_job_1"],
      omitted: []
    }
  });
  return { taskId, projectId, runId };
}

describe("task interrupts", () => {
  it("cancels a queued linked worker job and records durable interrupt events", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const { taskId, projectId, runId } = await saveTaskAndRun({ repositories });
    const now = fixedNow([
      "2026-05-18T00:00:01.000Z",
      "2026-05-18T00:00:02.000Z",
      "2026-05-18T00:00:03.000Z",
      "2026-05-18T00:00:04.000Z"
    ]);
    const workerRuntime = new InMemoryWorkerRuntime({ now });
    const workerJob = await workerRuntime.enqueue(
      {
        projectId,
        kind: "tool_command",
        command: "static-deploy",
        args: [],
        env: {},
        timeoutMs: 1000
      },
      createRejectSandboxPolicy()
    );
    await linkWorkerJobToTask({
      repositories,
      taskId,
      projectId,
      runId,
      workerJobId: workerJob.id,
      now
    });

    const result = await interruptTask({
      repositories,
      workerRuntime,
      taskId,
      reason: "User interrupted the task.",
      now
    });

    await expect(workerRuntime.getJob(workerJob.id)).resolves.toMatchObject({
      state: "cancelled",
      errorName: "worker_job_cancelled",
      cancelReason: "User interrupted the task."
    });
    await expect(repositories.runs.getById(runId)).resolves.toMatchObject({
      state: "cancelled"
    });
    await expect(repositories.runEvents.listForRun(runId)).resolves.toEqual([
      expect.objectContaining({ type: "worker.job.linked" }),
      expect.objectContaining({ type: "task.interrupt.requested" }),
      expect.objectContaining({ type: "task.interrupt.cancelled" })
    ]);
    expect(result).toEqual({
      ok: true,
      taskId,
      state: "cancelled",
      runId,
      workerJobId: workerJob.id
    });
  });

  it("records a running worker cancellation request without marking the run cancelled", async () => {
    class DeferredAdapter implements ExecutionAdapter {
      private startedResolve: (() => void) | undefined;
      private finishResolve: (() => void) | undefined;
      readonly started = new Promise<void>((resolve) => {
        this.startedResolve = resolve;
      });
      readonly finish = new Promise<void>((resolve) => {
        this.finishResolve = resolve;
      });

      release() {
        this.finishResolve?.();
      }

      async execute(
        _input: ExecutionInput,
        _policy: SandboxPolicy,
        context: ExecutionContext
      ): Promise<ExecutionResult> {
        this.startedResolve?.();
        await this.finish;
        if (await context.isCancellationRequested()) {
          return {
            state: "cancelled",
            stdout: "",
            stderr: "Worker job cancelled.",
            errorName: "worker_job_cancelled"
          };
        }
        return {
          state: "completed",
          exitCode: 0,
          stdout: "done",
          stderr: ""
        };
      }
    }

    const repositories = createInMemoryWorkbenchRepositories();
    const { taskId, projectId, runId } = await saveTaskAndRun({ repositories });
    const adapter = new DeferredAdapter();
    const now = fixedNow([
      "2026-05-18T00:01:01.000Z",
      "2026-05-18T00:01:02.000Z",
      "2026-05-18T00:01:03.000Z",
      "2026-05-18T00:01:04.000Z"
    ]);
    const workerRuntime = new InMemoryWorkerRuntime({ adapter, now });
    const workerJob = await workerRuntime.enqueue(
      {
        projectId,
        kind: "tool_command",
        command: "static-deploy",
        args: [],
        env: {},
        timeoutMs: 1000
      },
      createSimulatedSandboxPolicy({ allowedCommands: ["static-deploy"] })
    );
    await linkWorkerJobToTask({
      repositories,
      taskId,
      projectId,
      runId,
      workerJobId: workerJob.id,
      now
    });

    const runPromise = workerRuntime.runNext();
    await adapter.started;
    const result = await interruptTask({
      repositories,
      workerRuntime,
      taskId,
      reason: "Stop this task.",
      now
    });
    const runningView = await deriveTaskInterruptView({
      repositories,
      workerRuntime,
      taskId
    });

    expect(result).toEqual({
      ok: true,
      taskId,
      state: "interrupt_requested",
      runId,
      workerJobId: workerJob.id
    });
    expect(runningView).toMatchObject({
      available: true,
      state: "stopping",
      runId,
      workerJobId: workerJob.id
    });
    await expect(repositories.runs.getById(runId)).resolves.toMatchObject({
      state: "running"
    });

    adapter.release();
    await expect(runPromise).resolves.toMatchObject({ state: "cancelled" });
  });

  it("does not mutate terminal completed worker jobs", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const { taskId, projectId, runId } = await saveTaskAndRun({ repositories });
    const now = fixedNow();
    const workerRuntime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter(),
      now
    });
    const workerJob = await workerRuntime.enqueue(
      {
        projectId,
        kind: "tool_command",
        command: "static-deploy",
        args: [],
        env: {},
        timeoutMs: 1000
      },
      createSimulatedSandboxPolicy({ allowedCommands: ["static-deploy"] })
    );
    await workerRuntime.runNext();
    await linkWorkerJobToTask({
      repositories,
      taskId,
      projectId,
      runId,
      workerJobId: workerJob.id,
      now
    });

    const result = await interruptTask({
      repositories,
      workerRuntime,
      taskId,
      reason: "Too late",
      now
    });

    expect(result).toEqual({
      ok: true,
      taskId,
      state: "not_interruptible",
      runId,
      workerJobId: workerJob.id
    });
    await expect(workerRuntime.getJob(workerJob.id)).resolves.toMatchObject({
      state: "completed",
      cancelRequestedAt: undefined
    });
  });

  it("returns deterministic errors for missing tasks and missing worker targets", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const { taskId, projectId, runId } = await saveTaskAndRun({ repositories });
    const workerRuntime = new InMemoryWorkerRuntime();
    await linkWorkerJobToTask({
      repositories,
      taskId,
      projectId,
      runId,
      workerJobId: "worker_job_missing",
      now: fixedNow()
    });

    await expect(
      interruptTask({
        repositories,
        workerRuntime,
        taskId: "task_missing",
        reason: "Stop",
        now: fixedNow()
      })
    ).resolves.toEqual({
      ok: false,
      error: "task_not_found"
    });
    await expect(
      interruptTask({
        repositories,
        workerRuntime,
        taskId,
        reason: "Stop",
        now: fixedNow()
      })
    ).resolves.toEqual({
      ok: false,
      error: "interrupt_target_not_found"
    });
  });
});
