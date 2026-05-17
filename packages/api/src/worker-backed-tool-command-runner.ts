import {
  createRejectSandboxPolicy,
  type SandboxPolicy,
  type WorkerJobInput,
  type WorkerJobRecord,
  type WorkerRuntime
} from "@lp-agent/worker-runtime";
import type {
  ToolCommandRunner,
  ToolCommandRunInput,
  ToolCommandRunResult
} from "./tool-command-runner";

export type SandboxPolicyResolver = (
  input: ToolCommandRunInput
) => SandboxPolicy | Promise<SandboxPolicy>;

export class WorkerBackedToolCommandRunner implements ToolCommandRunner {
  private readonly runtime: WorkerRuntime;
  private readonly resolveSandboxPolicy: SandboxPolicyResolver;

  constructor(
    runtime: WorkerRuntime,
    resolveSandboxPolicy: SandboxPolicyResolver = (input) =>
      createSandboxPolicyForToolCommand(input)
  ) {
    this.runtime = runtime;
    this.resolveSandboxPolicy = resolveSandboxPolicy;
  }

  async run(input: ToolCommandRunInput): Promise<ToolCommandRunResult> {
    const policy = await this.resolveSandboxPolicy(input);
    const queued = await this.runtime.enqueue(toWorkerJobInput(input), policy);

    while (true) {
      const current = await this.runtime.getJob(queued.id);
      if (!current) {
        throw new Error("worker_job_not_found");
      }

      if (isSettled(current)) {
        return toToolCommandRunResult(current);
      }

      const ran = await this.runtime.runNext();
      if (!ran) {
        break;
      }
    }

    const current = await this.runtime.getJob(queued.id);
    if (!current) {
      throw new Error("worker_job_not_found");
    }

    if (isSettled(current)) {
      return toToolCommandRunResult(current);
    }

    return {
      state: "failed",
      exitCode: undefined,
      stdout: "",
      stderr: "",
      errorName: "worker_job_not_settled"
    };
  }
}

export function createSandboxPolicyForToolCommand(
  input: ToolCommandRunInput,
  overrides: Partial<SandboxPolicy> = {}
): SandboxPolicy {
  return createRejectSandboxPolicy({
    timeoutMs: input.timeoutMs,
    maxStdoutBytes: 300,
    maxStderrBytes: 300,
    network: "disabled",
    ...overrides
  });
}

function toWorkerJobInput(input: ToolCommandRunInput): WorkerJobInput {
  return {
    projectId: input.projectId,
    kind: "tool_command",
    commandId: input.commandId,
    command: input.command,
    args: [...input.args],
    env: { ...input.env },
    workingDirectory: input.workingDirectory,
    timeoutMs: input.timeoutMs
  };
}

function toToolCommandRunResult(record: WorkerJobRecord): ToolCommandRunResult {
  const result = record.resultSummary;
  if (!result) {
    return {
      state: "failed",
      exitCode: undefined,
      stdout: "",
      stderr: "",
      errorName: "worker_job_not_settled"
    };
  }

  if (record.state === "completed") {
    return {
      state: "completed",
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr
    };
  }

  if (record.state === "cancelled") {
    return {
      state: "cancelled",
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      errorName: record.errorName ?? "worker_job_cancelled"
    };
  }

  return {
    state: "failed",
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    errorName:
      record.errorName ??
      (record.state === "rejected" ? "worker_job_rejected" : "worker_job_failed")
  };
}

function isSettled(record: WorkerJobRecord): boolean {
  return (
    record.state === "completed" ||
    record.state === "failed" ||
    record.state === "rejected" ||
    record.state === "cancelled"
  );
}
