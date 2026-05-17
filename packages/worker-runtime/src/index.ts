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
  argCount: number;
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
  policy: SandboxPolicy;
  inputSummary: WorkerJobInputSummary;
  resultSummary?: WorkerJobResultSummary;
  errorName?: string;
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
  enqueue(input: WorkerJobInput, policy?: SandboxPolicy): Promise<WorkerJobRecord>;
  runNext(): Promise<WorkerJobRecord | undefined>;
  getJob(id: string): Promise<WorkerJobRecord | undefined>;
  listJobsForProject(projectId: string): Promise<WorkerJobRecord[]>;
}

export type SandboxPolicyValidation =
  | { valid: true }
  | { valid: false; reason: string; errorName?: string };

interface StoredJob {
  record: WorkerJobRecord;
  args: string[];
  env: Record<string, string>;
  policy: SandboxPolicy;
}

export interface InMemoryWorkerRuntimeOptions {
  adapter?: ExecutionAdapter;
  now?: () => Date;
  idPrefix?: string;
}

export class InMemoryWorkerRuntime implements WorkerRuntime {
  private readonly jobs: StoredJob[] = [];
  private readonly adapter: ExecutionAdapter;
  private readonly now: () => Date;
  private readonly idPrefix: string;
  private nextJobNumber = 1;

  constructor(options: InMemoryWorkerRuntimeOptions = {}) {
    this.adapter = options.adapter ?? new RejectingExecutionAdapter();
    this.now = options.now ?? (() => new Date());
    this.idPrefix = options.idPrefix ?? "worker_job";
  }

  async enqueue(
    input: WorkerJobInput,
    policy: SandboxPolicy = createRejectSandboxPolicy()
  ): Promise<WorkerJobRecord> {
    const copiedPolicy = copyPolicy(policy);
    const id = `${this.idPrefix}_${this.nextJobNumber}`;
    this.nextJobNumber += 1;

    const record: WorkerJobRecord = {
      id,
      projectId: input.projectId,
      kind: input.kind,
      state: "queued",
      policy: copyPolicy(copiedPolicy),
      inputSummary: summarizeInput(input),
      createdAt: this.nowIso()
    };

    this.jobs.push({
      record,
      args: [...input.args],
      env: { ...input.env },
      policy: copiedPolicy
    });

    return copyRecord(record);
  }

  async runNext(): Promise<WorkerJobRecord | undefined> {
    const storedJob = this.jobs.find((job) => job.record.state === "queued");
    if (!storedJob) {
      return undefined;
    }

    storedJob.record.state = "running";
    storedJob.record.startedAt = this.nowIso();

    const validation = validateSandboxPolicy(
      storedJob.record.inputSummary,
      storedJob.policy
    );
    if (!validation.valid) {
      this.completeJob(storedJob.record, {
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

      this.completeJob(storedJob.record, result, storedJob.policy);
    } catch (error) {
      this.completeJob(storedJob.record, {
        state: "failed",
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error && error.name ? error.name : "execution_adapter_failed"
      }, storedJob.policy);
    }

    return copyRecord(storedJob.record);
  }

  async getJob(id: string): Promise<WorkerJobRecord | undefined> {
    const storedJob = this.jobs.find((job) => job.record.id === id);
    return storedJob ? copyRecord(storedJob.record) : undefined;
  }

  async listJobsForProject(projectId: string): Promise<WorkerJobRecord[]> {
    return this.jobs
      .filter((job) => job.record.projectId === projectId)
      .map((job) => copyRecord(job.record));
  }

  private completeJob(
    record: WorkerJobRecord,
    result: ExecutionResult,
    policy: SandboxPolicy
  ): void {
    record.state = result.state;
    record.resultSummary = summarizeResult(result, policy);
    record.errorName = result.errorName;
    record.completedAt = this.nowIso();
  }

  private nowIso(): string {
    return this.now().toISOString();
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
      stderr: "real command execution is disabled",
      errorName: "execution_adapter_rejected"
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
    if (this.failCommands.has(input.command)) {
      return {
        state: "failed",
        exitCode: 1,
        stdout: this.stdoutByCommand[input.command] ?? "",
        stderr: this.stderrByCommand[input.command] ?? "Simulated command failure.",
        errorName: "simulated_command_failed"
      };
    }

    return {
      state: "completed",
      exitCode: 0,
      stdout:
        this.stdoutByCommand[input.command] ??
        `Simulated ${input.command} for project ${input.projectId}.`,
      stderr: this.stderrByCommand[input.command] ?? ""
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
      errorName: "sandbox_policy_network_not_supported"
    };
  }

  if (policy.mode === "reject") {
    return {
      valid: false,
      reason: "sandbox policy rejects execution",
      errorName: "sandbox_policy_reject_mode"
    };
  }

  if (!policy.allowedCommands.includes(input.command)) {
    return {
      valid: false,
      reason: `command not allowed: ${input.command}`,
      errorName: "sandbox_policy_command_not_allowed"
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
      errorName: "sandbox_policy_env_not_allowed"
    };
  }

  if (input.timeoutMs > policy.timeoutMs) {
    return {
      valid: false,
      reason: "timeout exceeds sandbox policy",
      errorName: "sandbox_policy_timeout_exceeded"
    };
  }

  if (input.workingDirectory && !policy.workingDirectoryRoot) {
    return {
      valid: false,
      reason: "workingDirectory forbidden without workingDirectoryRoot",
      errorName: "sandbox_policy_working_directory_forbidden"
    };
  }

  if (input.workingDirectory && policy.workingDirectoryRoot && !isPathWithinRoot(
    input.workingDirectory,
    policy.workingDirectoryRoot
  )) {
    return {
      valid: false,
      reason: "workingDirectory outside root",
      errorName: "sandbox_policy_working_directory_forbidden"
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
    argCount: input.args.length,
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
    commandId: storedJob.record.inputSummary.commandId,
    command: storedJob.record.inputSummary.command,
    args: [...storedJob.args],
    env: { ...storedJob.env },
    envNames: [...storedJob.record.inputSummary.envNames],
    workingDirectory: storedJob.record.inputSummary.workingDirectory,
    timeoutMs: storedJob.record.inputSummary.timeoutMs
  };
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
    policy: copyPolicy(record.policy),
    inputSummary: {
      ...record.inputSummary,
      envNames: [...record.inputSummary.envNames]
    },
    resultSummary: record.resultSummary ? { ...record.resultSummary } : undefined
  };
}
