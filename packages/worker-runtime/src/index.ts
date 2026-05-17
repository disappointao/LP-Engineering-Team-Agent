import { resolve, sep } from "node:path";

import { InMemoryWorkerJobRepository } from "./worker-job-repositories";

const CANCEL_REASON_MAX_LENGTH = 200;
const WORKER_JOB_CANCELLED_ERROR = "worker_job_cancelled";
const WORKER_JOB_CANCELLED_BEFORE_EXECUTION_MESSAGE =
  "Worker job cancelled before execution.";

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
  state: "completed" | "failed" | "rejected" | "cancelled";
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
  cancelRequestedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
}

export const SAFE_WORKER_PAYLOAD_MAX_ARGS = 100;
export const SAFE_WORKER_PAYLOAD_MAX_ARG_LENGTH = 1024;
export const SAFE_WORKER_PAYLOAD_MAX_ENV_NAMES = 100;

export type WorkerJobPayloadKind = "safe_simulated_tool_command";

export interface WorkerJobPayloadRecord {
  jobId: string;
  kind: WorkerJobPayloadKind;
  projectId: string;
  commandId?: string;
  command: string;
  args: string[];
  envNames: string[];
  workingDirectory?: string;
  timeoutMs: number;
  createdAt: string;
}

export interface WorkerJobPayloadRepository {
  save(record: WorkerJobPayloadRecord): Promise<void>;
  getByJobId(jobId: string): Promise<WorkerJobPayloadRecord | undefined>;
  deleteByJobId(jobId: string): Promise<void>;
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
  state: "completed" | "failed" | "rejected" | "cancelled";
  exitCode?: number;
  stdout: string;
  stderr: string;
  errorName?: string;
}

export interface ExecutionContext {
  isCancellationRequested(): Promise<boolean>;
}

export interface ExecutionAdapter {
  execute(
    input: ExecutionInput,
    policy: SandboxPolicy,
    context: ExecutionContext
  ): Promise<ExecutionResult>;
}

export interface WorkerRuntime {
  enqueue(input: WorkerJobInput, policy?: SandboxPolicy): Promise<WorkerJobRecord>;
  runNext(): Promise<WorkerJobRecord | undefined>;
  cancelJob(id: string, reason?: string): Promise<WorkerJobRecord | undefined>;
  getJob(id: string): Promise<WorkerJobRecord | undefined>;
  listJobsForProject(projectId: string): Promise<WorkerJobRecord[]>;
}

export interface WorkerJobRepository {
  save(record: WorkerJobRecord): Promise<void>;
  getById(id: string): Promise<WorkerJobRecord | undefined>;
  listForProject(projectId: string): Promise<WorkerJobRecord[]>;
  listAll(): Promise<WorkerJobRecord[]>;
  findOldestQueued(): Promise<WorkerJobRecord | undefined>;
}

export type SandboxPolicyValidation =
  | { valid: true }
  | { valid: false; reason: string; errorName?: string };

interface WorkerJobExecutionPayload {
  args: string[];
  env: Record<string, string>;
}

export interface InMemoryWorkerRuntimeOptions {
  adapter?: ExecutionAdapter;
  now?: () => Date;
  idPrefix?: string;
  repository?: WorkerJobRepository;
}

export class InMemoryWorkerRuntime implements WorkerRuntime {
  private readonly adapter: ExecutionAdapter;
  private readonly now: () => Date;
  private readonly idPrefix: string;
  private readonly repository: WorkerJobRepository;
  private readonly payloadsByJobId = new Map<string, WorkerJobExecutionPayload>();
  private nextJobNumber = 1;
  private nextJobNumberInitialized = false;
  private enqueueLock: Promise<void> = Promise.resolve();
  private runLock: Promise<void> = Promise.resolve();
  private readonly jobMutationLocks = new Map<string, Promise<void>>();

  constructor(options: InMemoryWorkerRuntimeOptions = {}) {
    this.adapter = options.adapter ?? new RejectingExecutionAdapter();
    this.now = options.now ?? (() => new Date());
    this.idPrefix = options.idPrefix ?? "worker_job";
    this.repository = options.repository ?? new InMemoryWorkerJobRepository();
  }

  async enqueue(
    input: WorkerJobInput,
    policy: SandboxPolicy = createRejectSandboxPolicy()
  ): Promise<WorkerJobRecord> {
    return this.withEnqueueLock(async () => {
      const copiedPolicy = copyPolicy(policy);
      const id = await this.allocateJobId();
      const record: WorkerJobRecord = {
        id,
        projectId: input.projectId,
        kind: input.kind,
        state: "queued",
        policy: copyPolicy(copiedPolicy),
        inputSummary: summarizeInput(input),
        createdAt: this.nowIso()
      };

      this.payloadsByJobId.set(id, {
        args: [...input.args],
        env: { ...input.env }
      });
      try {
        await this.repository.save(record);
      } catch (error) {
        this.payloadsByJobId.delete(id);
        throw error;
      }

      return copyRecord(record);
    });
  }

  async runNext(): Promise<WorkerJobRecord | undefined> {
    return this.withRunLock(async () => {
      const runningRecord = await this.claimOldestQueuedJob();
      if (!runningRecord) {
        return undefined;
      }

      const validation = validateSandboxPolicy(
        runningRecord.inputSummary,
        runningRecord.policy
      );
      if (!validation.valid) {
        this.payloadsByJobId.delete(runningRecord.id);
        return this.completeJob(
          runningRecord,
          {
            state: "rejected",
            stdout: "",
            stderr: validation.reason,
            errorName: validation.errorName
          },
          []
        );
      }

      const payload = this.payloadsByJobId.get(runningRecord.id);
      if (!payload) {
        return this.completeJob(
          runningRecord,
          {
            state: "failed",
            stdout: "",
            stderr: "Worker job execution payload is unavailable after restart.",
            errorName: "worker_job_payload_unavailable"
          },
          []
        );
      }

      try {
        const result = await this.adapter.execute(
          toExecutionInput(runningRecord, payload),
          copyPolicy(runningRecord.policy),
          this.createExecutionContext(runningRecord.id)
        );

        return this.completeJob(
          runningRecord,
          result,
          getSensitiveValues(payload.env)
        );
      } catch (error) {
        return this.completeJob(
          runningRecord,
          {
            state: "failed",
            stdout: "",
            stderr: error instanceof Error ? error.message : String(error),
            errorName:
              error instanceof Error && error.name
                ? error.name
                : "execution_adapter_failed"
          },
          getSensitiveValues(payload.env)
        );
      } finally {
        this.payloadsByJobId.delete(runningRecord.id);
      }
    });
  }

  async cancelJob(
    id: string,
    reason?: string
  ): Promise<WorkerJobRecord | undefined> {
    const current = await this.repository.getById(id);
    if (!current) {
      return undefined;
    }

    if (current.state === "running") {
      return this.requestRunningCancellation(current, reason);
    }

    if (current.state !== "queued") {
      return copyRecord(current);
    }

    return this.withJobMutationLock(id, async () => {
      const latest = await this.repository.getById(id);
      if (!latest) {
        return undefined;
      }
      if (latest.state === "running") {
        return this.requestRunningCancellationInCurrentLock(latest, reason);
      }
      if (latest.state !== "queued") {
        return copyRecord(latest);
      }
      return this.cancelQueuedJob(latest, reason);
    });
  }

  async getJob(id: string): Promise<WorkerJobRecord | undefined> {
    return this.repository.getById(id);
  }

  async listJobsForProject(projectId: string): Promise<WorkerJobRecord[]> {
    return this.repository.listForProject(projectId);
  }

  private async claimOldestQueuedJob(): Promise<WorkerJobRecord | undefined> {
    while (true) {
      const queuedRecord = await this.repository.findOldestQueued();
      if (!queuedRecord) {
        return undefined;
      }

      const claimed = await this.withJobMutationLock(
        queuedRecord.id,
        async () => {
          const latest = await this.repository.getById(queuedRecord.id);
          if (!latest || latest.state !== "queued") {
            return undefined;
          }

          const runningRecord: WorkerJobRecord = {
            ...copyRecord(latest),
            state: "running",
            startedAt: this.nowIso()
          };
          await this.repository.save(runningRecord);
          return copyRecord(runningRecord);
        }
      );
      if (claimed) {
        return claimed;
      }
    }
  }

  private async cancelQueuedJob(
    record: WorkerJobRecord,
    reason?: string
  ): Promise<WorkerJobRecord> {
    const now = this.nowIso();
    const stderr = WORKER_JOB_CANCELLED_BEFORE_EXECUTION_MESSAGE;
    const cancelledRecord: WorkerJobRecord = {
      ...copyRecord(record),
      state: "cancelled",
      errorName: WORKER_JOB_CANCELLED_ERROR,
      resultSummary: {
        state: "cancelled",
        stdout: "",
        stderr,
        stdoutBytes: 0,
        stderrBytes: byteLength(stderr),
        errorName: WORKER_JOB_CANCELLED_ERROR
      },
      cancelRequestedAt: record.cancelRequestedAt ?? now,
      cancelledAt: now,
      completedAt: now,
      cancelReason: normalizeCancelReason(reason) ?? record.cancelReason
    };

    await this.repository.save(cancelledRecord);
    this.payloadsByJobId.delete(record.id);
    return copyRecord(cancelledRecord);
  }

  private async requestRunningCancellation(
    record: WorkerJobRecord,
    reason?: string
  ): Promise<WorkerJobRecord> {
    return this.withJobMutationLock(record.id, async () => {
      const latest = await this.repository.getById(record.id);
      if (!latest) {
        return copyRecord(record);
      }
      if (latest.state !== "running") {
        return copyRecord(latest);
      }

      return this.requestRunningCancellationInCurrentLock(latest, reason);
    });
  }

  private async requestRunningCancellationInCurrentLock(
    record: WorkerJobRecord,
    reason?: string
  ): Promise<WorkerJobRecord> {
    const updatedRecord: WorkerJobRecord = {
      ...copyRecord(record),
      cancelRequestedAt: record.cancelRequestedAt ?? this.nowIso(),
      cancelReason: record.cancelReason ?? normalizeCancelReason(reason)
    };
    await this.repository.save(updatedRecord);
    return copyRecord(updatedRecord);
  }

  private createExecutionContext(jobId: string): ExecutionContext {
    return {
      isCancellationRequested: async () => {
        const record = await this.repository.getById(jobId);
        return Boolean(
          record &&
            (record.state === "cancelled" ||
              record.cancelRequestedAt !== undefined)
        );
      }
    };
  }

  private async completeJob(
    record: WorkerJobRecord,
    result: ExecutionResult,
    sensitiveValues: string[]
  ): Promise<WorkerJobRecord> {
    return this.withJobMutationLock(record.id, async () => {
      const latest = await this.repository.getById(record.id);
      const baseRecord = latest ?? record;
      const completedAt = this.nowIso();

      const completedRecord: WorkerJobRecord = {
        ...copyRecord(baseRecord),
        state: result.state,
        resultSummary: summarizeResult(result, baseRecord.policy, sensitiveValues),
        errorName: result.errorName,
        completedAt,
        ...(result.state === "cancelled"
          ? {
              cancelRequestedAt: baseRecord.cancelRequestedAt ?? completedAt,
              cancelledAt: completedAt,
              cancelReason: baseRecord.cancelReason
            }
          : {})
      };

      await this.repository.save(completedRecord);

      return copyRecord(completedRecord);
    });
  }

  private async allocateJobId(): Promise<string> {
    if (!this.nextJobNumberInitialized) {
      const idPattern = new RegExp(`^${escapeRegExp(this.idPrefix)}_(\\d+)$`);
      const records = await this.repository.listAll();
      const maxJobNumber = records.reduce((max, record) => {
        const match = idPattern.exec(record.id);
        const suffix = match?.[1];
        if (!suffix) {
          return max;
        }

        const parsed = Number.parseInt(suffix, 10);
        if (!Number.isSafeInteger(parsed) || parsed <= 0) {
          return max;
        }

        return Math.max(max, parsed);
      }, 0);

      this.nextJobNumber = maxJobNumber + 1;
      this.nextJobNumberInitialized = true;
    }

    const id = `${this.idPrefix}_${this.nextJobNumber}`;
    this.nextJobNumber += 1;

    return id;
  }

  private async withEnqueueLock<T>(operation: () => Promise<T>): Promise<T> {
    const previousLock = this.enqueueLock;
    let releaseLock: () => void = () => undefined;
    this.enqueueLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    await previousLock;
    try {
      return await operation();
    } finally {
      releaseLock();
    }
  }

  private async withRunLock<T>(operation: () => Promise<T>): Promise<T> {
    const previousLock = this.runLock;
    let releaseLock: () => void = () => undefined;
    this.runLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    await previousLock;
    try {
      return await operation();
    } finally {
      releaseLock();
    }
  }

  private async withJobMutationLock<T>(
    id: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previousLock = this.jobMutationLocks.get(id) ?? Promise.resolve();
    let releaseLock: () => void = () => undefined;
    const currentLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.jobMutationLocks.set(id, currentLock);

    await previousLock;
    try {
      return await operation();
    } finally {
      releaseLock();
      if (this.jobMutationLocks.get(id) === currentLock) {
        this.jobMutationLocks.delete(id);
      }
    }
  }

  private nowIso(): string {
    return this.now().toISOString();
  }
}

export class RejectingExecutionAdapter implements ExecutionAdapter {
  async execute(
    _input: ExecutionInput,
    _policy: SandboxPolicy,
    _context: ExecutionContext
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

  async execute(
    input: ExecutionInput,
    _policy: SandboxPolicy,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    if (await context.isCancellationRequested()) {
      return {
        state: "cancelled",
        stdout: "",
        stderr: "Worker job cancelled.",
        errorName: WORKER_JOB_CANCELLED_ERROR
      };
    }

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
  if (
    !Number.isInteger(policy.maxStdoutBytes) ||
    policy.maxStdoutBytes < 0 ||
    !Number.isInteger(policy.maxStderrBytes) ||
    policy.maxStderrBytes < 0
  ) {
    return {
      valid: false,
      reason: "output limits must be non-negative integers",
      errorName: "sandbox_policy_output_limit_invalid"
    };
  }

  if (policy.network !== "disabled") {
    return {
      valid: false,
      reason: "network must be disabled",
      errorName: "sandbox_policy_network_not_supported"
    };
  }

  const mode = policy.mode as string;
  if (mode === "reject") {
    return {
      valid: false,
      reason: "sandbox policy rejects execution",
      errorName: "sandbox_policy_reject_mode"
    };
  }

  if (mode !== "simulate") {
    return {
      valid: false,
      reason: `sandbox policy mode not supported: ${mode}`,
      errorName: "sandbox_policy_mode_not_supported"
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

function normalizeCancelReason(reason: string | undefined): string | undefined {
  const trimmed = reason?.trim();
  if (!trimmed) {
    return undefined;
  }
  return [...trimmed].slice(0, CANCEL_REASON_MAX_LENGTH).join("");
}

function getEnvNames(input: WorkerJobInput | WorkerJobInputSummary): string[] {
  if ("envNames" in input) {
    return [...input.envNames].sort();
  }

  return Object.keys(input.env).sort();
}

function toExecutionInput(
  record: WorkerJobRecord,
  payload: WorkerJobExecutionPayload
): ExecutionInput {
  return {
    jobId: record.id,
    projectId: record.projectId,
    kind: record.kind,
    commandId: record.inputSummary.commandId,
    command: record.inputSummary.command,
    args: [...payload.args],
    env: { ...payload.env },
    envNames: [...record.inputSummary.envNames],
    workingDirectory: record.inputSummary.workingDirectory,
    timeoutMs: record.inputSummary.timeoutMs
  };
}

function summarizeResult(
  result: ExecutionResult,
  policy: SandboxPolicy,
  sensitiveValues: string[] = []
): WorkerJobResultSummary {
  const stdoutBytes = byteLength(result.stdout);
  const stderrBytes = byteLength(result.stderr);
  const redactedStdout = redactSensitiveValues(result.stdout, sensitiveValues);
  const redactedStderr = redactSensitiveValues(result.stderr, sensitiveValues);

  return {
    state: result.state,
    exitCode: result.exitCode,
    stdout: truncateUtf8(redactedStdout, policy.maxStdoutBytes),
    stderr: truncateUtf8(redactedStderr, policy.maxStderrBytes),
    stdoutBytes,
    stderrBytes,
    errorName: result.errorName
  };
}

function getSensitiveValues(env: Record<string, string>): string[] {
  return [...new Set(Object.values(env).filter((value) => value.length > 0))].sort(
    (a, b) => b.length - a.length
  );
}

function redactSensitiveValues(value: string, sensitiveValues: string[]): string {
  return sensitiveValues.reduce(
    (redacted, sensitiveValue) => redacted.split(sensitiveValue).join("[redacted]"),
    value
  );
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes === 0) {
    return "";
  }

  if (byteLength(value) <= maxBytes) {
    return value;
  }

  let byteCount = 0;
  let output = "";

  for (const char of value) {
    const charBytes = byteLength(char);
    if (byteCount + charBytes > maxBytes) {
      break;
    }

    output += char;
    byteCount += charBytes;
  }

  return output;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function isPathWithinRoot(path: string, root: string): boolean {
  // V0 lexical precheck only; any real execution adapter must use canonical paths or stronger isolation.
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);

  return (
    resolvedPath === resolvedRoot ||
    resolvedPath.startsWith(`${resolvedRoot}${sep}`)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

export {
  InMemoryWorkerJobRepository,
  JsonFileWorkerJobRepository,
  createJsonFileWorkerJobRepository,
  type JsonFileWorkerJobRepositoryOptions
} from "./worker-job-repositories";

export {
  InMemoryWorkerJobPayloadRepository,
  JsonFileWorkerJobPayloadRepository,
  createJsonFileWorkerJobPayloadRepository,
  type JsonFileWorkerJobPayloadRepositoryOptions
} from "./worker-job-payload-repositories";
