import { describe, expect, it, vi } from "vitest";

import {
  type ExecutionAdapter,
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter,
  createSimulatedSandboxPolicy
} from "@lp-agent/worker-runtime";
import {
  WorkerBackedToolCommandRunner,
  createSandboxPolicyForToolCommand
} from "./worker-backed-tool-command-runner";
import type { ToolCommandRunInput } from "./tool-command-runner";

describe("WorkerBackedToolCommandRunner", () => {
  it("maps completed worker jobs to completed tool command results", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter()
    });
    const runner = new WorkerBackedToolCommandRunner(runtime, (input) =>
      createSimulatedSandboxPolicy({
        allowedCommands: [input.command],
        allowedEnvNames: Object.keys(input.env),
        timeoutMs: input.timeoutMs
      })
    );

    const result = await runner.run(baseInput());
    const jobs = await runtime.listJobsForProject("project_1");

    expect(result).toEqual({
      state: "completed",
      exitCode: 0,
      stdout: "Simulated static-deploy for project project_1.",
      stderr: ""
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.inputSummary).toMatchObject({
      command: "static-deploy",
      envNames: ["LP_PROJECT_ID", "STATIC_DEPLOY_TOKEN"]
    });
    expect(JSON.stringify(jobs[0])).not.toContain("secret-token");
  });

  it("maps rejected worker jobs to failed tool command results", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter()
    });
    const runner = new WorkerBackedToolCommandRunner(runtime, () =>
      createSimulatedSandboxPolicy({
        allowedCommands: ["other-command"],
        allowedEnvNames: ["LP_PROJECT_ID", "STATIC_DEPLOY_TOKEN"],
        timeoutMs: 1000
      })
    );

    const result = await runner.run(baseInput());

    expect(result).toMatchObject({
      state: "failed",
      exitCode: undefined,
      stdout: "",
      errorName: "sandbox_policy_command_not_allowed"
    });
    expect(result.stderr).toContain("command not allowed: static-deploy");
  });

  it("maps failed worker jobs to failed tool command results", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter({
        failCommands: ["static-deploy"]
      })
    });
    const runner = new WorkerBackedToolCommandRunner(runtime, (input) =>
      createSimulatedSandboxPolicy({
        allowedCommands: [input.command],
        allowedEnvNames: Object.keys(input.env),
        timeoutMs: input.timeoutMs
      })
    );

    const result = await runner.run(baseInput());

    expect(result).toEqual({
      state: "failed",
      exitCode: 1,
      stdout: "",
      stderr: "Simulated command failure.",
      errorName: "simulated_command_failed"
    });
  });

  it("rejects command execution by default without invoking the adapter", async () => {
    const adapter: ExecutionAdapter = {
      execute: vi.fn()
    };
    const runtime = new InMemoryWorkerRuntime({ adapter });
    const runner = new WorkerBackedToolCommandRunner(runtime);

    const result = await runner.run(baseInput());
    const jobs = await runtime.listJobsForProject("project_1");

    expect(result).toMatchObject({
      state: "failed",
      exitCode: undefined,
      stdout: "",
      errorName: "sandbox_policy_reject_mode"
    });
    expect(result.stderr).toContain("sandbox policy rejects execution");
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      state: "rejected",
      errorName: "sandbox_policy_reject_mode"
    });
  });

  it("runs older queued jobs before returning the newly enqueued command result", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter()
    });
    await runtime.enqueue(
      {
        projectId: "project_1",
        kind: "tool_command",
        commandId: "queued_build",
        command: "queued-build",
        args: [],
        env: {},
        timeoutMs: 1000
      },
      createSimulatedSandboxPolicy({
        allowedCommands: ["queued-build"],
        allowedEnvNames: [],
        timeoutMs: 1000
      })
    );
    const runner = new WorkerBackedToolCommandRunner(runtime, (input) =>
      createSimulatedSandboxPolicy({
        allowedCommands: [input.command],
        allowedEnvNames: Object.keys(input.env),
        timeoutMs: input.timeoutMs
      })
    );

    const result = await runner.run(baseInput());
    const jobs = await runtime.listJobsForProject("project_1");

    expect(result).toMatchObject({
      state: "completed",
      stdout: "Simulated static-deploy for project project_1."
    });
    expect(jobs.map((job) => job.inputSummary.command)).toEqual([
      "queued-build",
      "static-deploy"
    ]);
    expect(jobs.map((job) => job.state)).toEqual(["completed", "completed"]);
  });

  it("creates a default reject sandbox policy for a tool command", () => {
    const policy = createSandboxPolicyForToolCommand(baseInput(), {
      allowedCommands: ["static-deploy"],
      allowedEnvNames: ["LP_PROJECT_ID"],
      mode: "simulate"
    });

    expect(policy).toMatchObject({
      mode: "simulate",
      allowedCommands: ["static-deploy"],
      allowedEnvNames: ["LP_PROJECT_ID"],
      timeoutMs: 1000,
      maxStdoutBytes: 300,
      maxStderrBytes: 300,
      network: "disabled"
    });
  });
});

function baseInput(overrides: Partial<ToolCommandRunInput> = {}): ToolCommandRunInput {
  return {
    runId: "run_1",
    projectId: "project_1",
    skillId: "skill_static_deploy",
    skillVersionId: "skill_version_1",
    commandId: "publish_static",
    command: "static-deploy",
    args: ["--target", "preview"],
    env: {
      LP_PROJECT_ID: "project_1",
      STATIC_DEPLOY_TOKEN: "secret-token"
    },
    timeoutMs: 1000,
    ...overrides
  };
}
