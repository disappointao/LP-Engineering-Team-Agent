import { resolve, sep } from "node:path";

export type WorkerJobKind = "tool_command";
export type WorkerJobState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "rejected"
  | "cancelled";

export interface SandboxPolicy {
  mode: "reject" | "simulate";
  allowedCommands: string[];
  workingDirectoryRoot?: string;
  timeoutMs: number;
  allowedEnvNames: string[];
  maxStdoutBytes: number;
  maxStderrBytes: number;
  network: "disabled";
}

export interface WorkerJobInput {
  projectId: string;
  kind: WorkerJobKind;
  commandId?: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  workingDirectory?: string;
  timeoutMs: number;
}

export interface WorkerJobInputSummary {
  projectId: string;
  kind: WorkerJobKind;
  commandId?: string;
  command: string;
  args: string[];
  envNames: string[];
  workingDirectory?: string;
  timeoutMs: number;
}

export interface WorkerJobResultSummary {
  state: "completed" | "failed" | "rejected";
  exitCode?: number;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  errorName?: string;
}

export interface WorkerJobRecord {
  id: string;
  projectId: string;
  kind: WorkerJobKind;
  state: WorkerJobState;
  input: WorkerJobInputSummary;
  result?: WorkerJobResultSummary;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ExecutionInput {
  jobId: string;
  projectId: string;
  kind: WorkerJobKind;
  commandId?: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  envNames: string[];
  workingDirectory?: string;
  timeoutMs: number;
}

export interface ExecutionResult {
  state: "completed" | "failed" | "rejected";
  exitCode?: number;
  stdout: string;
  stderr: string;
  errorName?: string;
}

export interface ExecutionAdapter {
  execute(input: ExecutionInput, policy: SandboxPolicy): Promise<ExecutionResult>;
}

export interface WorkerRuntime {
  enqueue(input: WorkerJobInput, policy?: SandboxPolicy): WorkerJobRecord;
  runNext(): Promise<WorkerJobRecord | undefined>;
  getJob(id: string): WorkerJobRecord | undefined;
  listJobsForProject(projectId: string): WorkerJobRecord[];
}

export type SandboxPolicyValidation =
  | { valid: true }
  | { valid: false; reason: string; errorName?: string };

interface StoredJob {
  record: WorkerJobRecord;
  env: Record<string, string>;
  policy: SandboxPolicy;
}

export class InMemoryWorkerRuntime implements WorkerRuntime {
  private readonly jobs: StoredJob[] = [];
  private nextJobNumber = 1;

  constructor(
    private readonly adapter: ExecutionAdapter = new RejectingExecutionAdapter()
  ) {}

  enqueue(
    input: WorkerJobInput,
    policy: SandboxPolicy = createRejectSandboxPolicy()
  ): WorkerJobRecord {
    const id = `worker_job_${this.nextJobNumber}`;
    this.nextJobNumber += 1;

    const record: WorkerJobRecord = {
      id,
      projectId: input.projectId,
      kind: input.kind,
      state: "queued",
      input: summarizeInput(input),
      createdAt: nowIso()
    };

    this.jobs.push({
      record,
      env: { ...input.env },
      policy: copyPolicy(policy)
    });

    return copyRecord(record);
  }

  async runNext(): Promise<WorkerJobRecord | undefined> {
    const storedJob = this.jobs.find((job) => job.record.state === "queued");
    if (!storedJob) {
      return undefined;
    }

    storedJob.record.state = "running";
    storedJob.record.startedAt = nowIso();

    const validation = validateSandboxPolicy(storedJob.record.input, storedJob.policy);
    if (!validation.valid) {
      completeJob(storedJob.record, {
        state: "rejected",
        stdout: "",
        stderr: validation.reason,
        errorName: validation.errorName
      }, storedJob.policy);
      return copyRecord(storedJob.record);
    }

    try {
      const result = await this.adapter.execute(
        toExecutionInput(storedJob),
        copyPolicy(storedJob.policy)
      );

      completeJob(storedJob.record, result, storedJob.policy);
    } catch (error) {
      completeJob(storedJob.record, {
        state: "failed",
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error && error.name ? error.name : "execution_adapter_failed"
      }, storedJob.policy);
    }

    return copyRecord(storedJob.record);
  }

  getJob(id: string): WorkerJobRecord | undefined {
    const storedJob = this.jobs.find((job) => job.record.id === id);
    return storedJob ? copyRecord(storedJob.record) : undefined;
  }

  listJobsForProject(projectId: string): WorkerJobRecord[] {
    return this.jobs
      .filter((job) => job.record.projectId === projectId)
      .map((job) => copyRecord(job.record));
  }
}

export class RejectingExecutionAdapter implements ExecutionAdapter {
  async execute(
    _input: ExecutionInput,
    _policy: SandboxPolicy
  ): Promise<ExecutionResult> {
    return {
      state: "rejected",
      stdout: "",
      stderr: "real command execution is disabled"
    };
  }
}

export interface SimulatedExecutionAdapterOptions {
  failCommands?: string[];
  stdoutByCommand?: Record<string, string>;
  stderrByCommand?: Record<string, string>;
}

export class SimulatedExecutionAdapter implements ExecutionAdapter {
  private readonly failCommands: Set<string>;
  private readonly stdoutByCommand: Record<string, string>;
  private readonly stderrByCommand: Record<string, string>;

  constructor(options: SimulatedExecutionAdapterOptions = {}) {
    this.failCommands = new Set(options.failCommands ?? []);
    this.stdoutByCommand = { ...(options.stdoutByCommand ?? {}) };
    this.stderrByCommand = { ...(options.stderrByCommand ?? {}) };
  }

  async execute(input: ExecutionInput): Promise<ExecutionResult> {
    const stdout = this.stdoutByCommand[input.command] ?? "";
    const stderr = this.stderrByCommand[input.command] ?? "";

    if (this.failCommands.has(input.command)) {
      return {
        state: "failed",
        exitCode: 1,
        stdout,
        stderr
      };
    }

    return {
      state: "completed",
      exitCode: 0,
      stdout,
      stderr
    };
  }
}

export function createRejectSandboxPolicy(
  overrides: Partial<SandboxPolicy> = {}
): SandboxPolicy {
  const { allowedCommands, allowedEnvNames, ...rest } = overrides;

  const policy: SandboxPolicy = {
    mode: "reject",
    allowedCommands: [...(allowedCommands ?? [])],
    timeoutMs: 120000,
    allowedEnvNames: [...(allowedEnvNames ?? [])],
    maxStdoutBytes: 300,
    maxStderrBytes: 300,
    network: "disabled"
  };

  return { ...policy, ...rest };
}

export function createSimulatedSandboxPolicy(
  overrides: Partial<SandboxPolicy> = {}
): SandboxPolicy {
  return createRejectSandboxPolicy({
    ...overrides,
    mode: "simulate"
  });
}

export function validateSandboxPolicy(
  input: WorkerJobInput | WorkerJobInputSummary,
  policy: SandboxPolicy
): SandboxPolicyValidation {
  if (policy.network !== "disabled") {
    return {
      valid: false,
      reason: "network must be disabled",
      errorName: "network_not_disabled"
    };
  }

  if (policy.mode === "reject") {
    return {
      valid: false,
      reason: "sandbox policy rejects execution",
      errorName: "sandbox_policy_rejected"
    };
  }

  if (!policy.allowedCommands.includes(input.command)) {
    return {
      valid: false,
      reason: `command not allowed: ${input.command}`,
      errorName: "command_not_allowed"
    };
  }

  const envNames = getEnvNames(input);
  const unexpectedEnvName = envNames.find(
    (envName) => !policy.allowedEnvNames.includes(envName)
  );
  if (unexpectedEnvName) {
    return {
      valid: false,
      reason: `env name not allowed: ${unexpectedEnvName}`,
      errorName: "env_name_not_allowed"
    };
  }

  if (input.timeoutMs > policy.timeoutMs) {
    return {
      valid: false,
      reason: "timeout exceeds sandbox policy",
      errorName: "timeout_exceeds_policy"
    };
  }

  if (
    input.workingDirectory &&
    policy.workingDirectoryRoot &&
    !isPathWithinRoot(input.workingDirectory, policy.workingDirectoryRoot)
  ) {
    return {
      valid: false,
      reason: "workingDirectory outside root",
      errorName: "working_directory_outside_root"
    };
  }

  return { valid: true };
}

function summarizeInput(input: WorkerJobInput): WorkerJobInputSummary {
  return {
    projectId: input.projectId,
    kind: input.kind,
    commandId: input.commandId,
    command: input.command,
    args: [...input.args],
    envNames: Object.keys(input.env).sort(),
    workingDirectory: input.workingDirectory,
    timeoutMs: input.timeoutMs
  };
}

function getEnvNames(input: WorkerJobInput | WorkerJobInputSummary): string[] {
  if ("envNames" in input) {
    return [...input.envNames].sort();
  }

  return Object.keys(input.env).sort();
}

function toExecutionInput(storedJob: StoredJob): ExecutionInput {
  return {
    jobId: storedJob.record.id,
    projectId: storedJob.record.projectId,
    kind: storedJob.record.kind,
    commandId: storedJob.record.input.commandId,
    command: storedJob.record.input.command,
    args: [...storedJob.record.input.args],
    env: { ...storedJob.env },
    envNames: [...storedJob.record.input.envNames],
    workingDirectory: storedJob.record.input.workingDirectory,
    timeoutMs: storedJob.record.input.timeoutMs
  };
}

function completeJob(
  record: WorkerJobRecord,
  result: ExecutionResult,
  policy: SandboxPolicy
): void {
  record.state = result.state;
  record.result = summarizeResult(result, policy);
  record.completedAt = nowIso();
}

function summarizeResult(
  result: ExecutionResult,
  policy: SandboxPolicy
): WorkerJobResultSummary {
  const stdoutBytes = byteLength(result.stdout);
  const stderrBytes = byteLength(result.stderr);

  return {
    state: result.state,
    exitCode: result.exitCode,
    stdout: truncateUtf8(result.stdout, policy.maxStdoutBytes),
    stderr: truncateUtf8(result.stderr, policy.maxStderrBytes),
    stdoutBytes,
    stderrBytes,
    errorName: result.errorName
  };
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) {
    return value;
  }

  return Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8");
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function isPathWithinRoot(path: string, root: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);

  return (
    resolvedPath === resolvedRoot ||
    resolvedPath.startsWith(`${resolvedRoot}${sep}`)
  );
}

function copyPolicy(policy: SandboxPolicy): SandboxPolicy {
  return {
    ...policy,
    allowedCommands: [...policy.allowedCommands],
    allowedEnvNames: [...policy.allowedEnvNames]
  };
}

function copyRecord(record: WorkerJobRecord): WorkerJobRecord {
  return {
    ...record,
    input: {
      ...record.input,
      args: [...record.input.args],
      envNames: [...record.input.envNames]
    },
    result: record.result ? { ...record.result } : undefined
  };
}

function nowIso(): string {
  return new Date().toISOString();
}
