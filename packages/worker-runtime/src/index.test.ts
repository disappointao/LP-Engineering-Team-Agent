import { describe, expect, it, vi } from "vitest";

import {
  InMemoryWorkerRuntime,
  RejectingExecutionAdapter,
  SimulatedExecutionAdapter,
  createRejectSandboxPolicy,
  createSimulatedSandboxPolicy,
  type ExecutionAdapter,
  type ExecutionInput,
  type SandboxPolicy,
  type WorkerJobInput
} from "./index";

const baseInput = (overrides: Partial<WorkerJobInput> = {}): WorkerJobInput => ({
  projectId: "project_a",
  kind: "tool_command",
  command: "build",
  args: ["--fast"],
  env: {},
  timeoutMs: 1000,
  ...overrides
});

describe("InMemoryWorkerRuntime", () => {
  it("enqueue creates deterministic worker job ids", () => {
    const runtime = new InMemoryWorkerRuntime();

    const first = runtime.enqueue(baseInput());
    const second = runtime.enqueue(baseInput({ command: "test" }));

    expect(first.id).toBe("worker_job_1");
    expect(second.id).toBe("worker_job_2");
  });

  it("listJobsForProject is project scoped and ordered", () => {
    const runtime = new InMemoryWorkerRuntime();
    runtime.enqueue(baseInput({ projectId: "project_a", command: "first" }));
    runtime.enqueue(baseInput({ projectId: "project_b", command: "other" }));
    runtime.enqueue(baseInput({ projectId: "project_a", command: "second" }));

    const jobs = runtime.listJobsForProject("project_a");

    expect(jobs.map((job) => job.id)).toEqual(["worker_job_1", "worker_job_3"]);
    expect(jobs.map((job) => job.input.command)).toEqual(["first", "second"]);
  });

  it("returned records are defensive copies", async () => {
    const runtime = new InMemoryWorkerRuntime(
      new SimulatedExecutionAdapter({
        stdoutByCommand: { build: "ok" }
      })
    );
    const queued = runtime.enqueue(
      baseInput({
        args: ["original"],
        env: { TOKEN: "secret-value" }
      }),
      createSimulatedSandboxPolicy({
        allowedCommands: ["build"],
        allowedEnvNames: ["TOKEN"]
      })
    );

    queued.input.args.push("mutated");
    queued.input.envNames.push("MUTATED");
    const beforeRun = runtime.getJob(queued.id);
    beforeRun?.input.args.push("mutated-again");

    const completed = await runtime.runNext();
    completed?.input.args.push("after-run");
    completed!.result!.stdout = "mutated output";

    const stored = runtime.getJob(queued.id);

    expect(stored?.input.args).toEqual(["original"]);
    expect(stored?.input.envNames).toEqual(["TOKEN"]);
    expect(stored?.result?.stdout).toBe("ok");
  });

  it("runNext returns undefined when no queued job exists", async () => {
    const runtime = new InMemoryWorkerRuntime();

    await expect(runtime.runNext()).resolves.toBeUndefined();
  });

  it("policy rejects disallowed command before adapter execution", async () => {
    const adapter: ExecutionAdapter = {
      execute: vi.fn(async () => ({
        state: "completed" as const,
        exitCode: 0,
        stdout: "should not run",
        stderr: ""
      }))
    };
    const runtime = new InMemoryWorkerRuntime(adapter);
    runtime.enqueue(
      baseInput({ command: "deploy" }),
      createSimulatedSandboxPolicy({ allowedCommands: ["build"] })
    );

    const job = await runtime.runNext();

    expect(job?.state).toBe("rejected");
    expect(job?.result?.state).toBe("rejected");
    expect(job?.result?.stderr).toContain("command not allowed");
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("policy rejects unexpected env names without storing secret values", async () => {
    const runtime = new InMemoryWorkerRuntime(
      new SimulatedExecutionAdapter({
        stdoutByCommand: { build: "should not run" }
      })
    );
    const queued = runtime.enqueue(
      baseInput({
        env: {
          ALLOWED: "allowed-value",
          SECRET_TOKEN: "super-secret"
        }
      }),
      createSimulatedSandboxPolicy({
        allowedCommands: ["build"],
        allowedEnvNames: ["ALLOWED"]
      })
    );

    const job = await runtime.runNext();
    const serialized = JSON.stringify(runtime.getJob(queued.id));

    expect(job?.state).toBe("rejected");
    expect(job?.input.envNames).toEqual(["ALLOWED", "SECRET_TOKEN"]);
    expect(job?.result?.stderr).toContain("env name not allowed");
    expect(serialized).toContain("SECRET_TOKEN");
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("allowed-value");
  });

  it("policy rejects workingDirectory outside workingDirectoryRoot", async () => {
    const runtime = new InMemoryWorkerRuntime(
      new SimulatedExecutionAdapter({
        stdoutByCommand: { build: "should not run" }
      })
    );
    runtime.enqueue(
      baseInput({
        workingDirectory: "/tmp/project-other"
      }),
      createSimulatedSandboxPolicy({
        allowedCommands: ["build"],
        workingDirectoryRoot: "/tmp/project"
      })
    );

    const job = await runtime.runNext();

    expect(job?.state).toBe("rejected");
    expect(job?.result?.stderr).toContain("workingDirectory outside root");
  });

  it("SimulatedExecutionAdapter completes and bounded stdout summary is truncated to policy max bytes", async () => {
    const runtime = new InMemoryWorkerRuntime(
      new SimulatedExecutionAdapter({
        stdoutByCommand: {
          build: "abcdef"
        }
      })
    );
    runtime.enqueue(
      baseInput(),
      createSimulatedSandboxPolicy({
        allowedCommands: ["build"],
        maxStdoutBytes: 4
      })
    );

    const job = await runtime.runNext();

    expect(job?.state).toBe("completed");
    expect(job?.result).toMatchObject({
      state: "completed",
      exitCode: 0,
      stdout: "abcd",
      stderr: "",
      stdoutBytes: 6,
      stderrBytes: 0
    });
  });

  it("SimulatedExecutionAdapter can fail configured commands", async () => {
    const runtime = new InMemoryWorkerRuntime(
      new SimulatedExecutionAdapter({
        failCommands: ["build"]
      })
    );
    runtime.enqueue(
      baseInput(),
      createSimulatedSandboxPolicy({
        allowedCommands: ["build"]
      })
    );

    const job = await runtime.runNext();

    expect(job?.state).toBe("failed");
    expect(job?.result).toMatchObject({
      state: "failed",
      exitCode: 1
    });
  });

  it("RejectingExecutionAdapter returns rejected without real command execution", async () => {
    const adapter = new RejectingExecutionAdapter();
    const input: ExecutionInput = {
      jobId: "worker_job_1",
      projectId: "project_a",
      kind: "tool_command",
      command: "build",
      args: [],
      env: {},
      envNames: [],
      timeoutMs: 1000
    };
    const policy: SandboxPolicy = createRejectSandboxPolicy();

    await expect(adapter.execute(input, policy)).resolves.toMatchObject({
      state: "rejected",
      stderr: expect.stringContaining("real command execution is disabled")
    });
  });
});
