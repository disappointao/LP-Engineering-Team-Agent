# Worker Sandbox Runtime Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first contract-first worker/sandbox runtime foundation and connect it to the existing `ToolCommandRunner` boundary without enabling real shell execution.

**Architecture:** Add a new `@lp-agent/worker-runtime` package for worker job contracts, sandbox policy checks, in-memory job state, and deterministic execution adapters. Add a narrow API adapter, `WorkerBackedToolCommandRunner`, so existing deployment skill command execution can opt into worker-backed execution while default API and Web behavior stay unchanged.

**Tech Stack:** pnpm workspace, TypeScript, Vitest, existing `@lp-agent/api` service contracts, no `child_process`, no real shell runner.

---

## Scope Guard

This plan implements only the Stage 8 foundation described in `docs/superpowers/specs/2026-05-17-worker-sandbox-runtime-design.md`.

It must not add:

- real command execution;
- `child_process`, `spawn`, `exec`, shell parsing, pipes, redirects, heredocs, or arbitrary command strings;
- Docker, Firecracker, VM, chroot, or OS-level sandboxing;
- MCP execution;
- Web UI for worker jobs;
- deployment automation beyond the existing skill command simulation path.

The generated LP artifact format remains framework-free static HTML/CSS/JS.

## File Structure

- Create: `packages/worker-runtime/package.json`
  - Package manifest for `@lp-agent/worker-runtime`.
- Create: `packages/worker-runtime/tsconfig.json`
  - Extends the root TypeScript base config.
- Create: `packages/worker-runtime/src/index.ts`
  - Worker job contracts, sandbox policy helpers, policy validation, in-memory runtime, rejecting adapter, simulated adapter.
- Create: `packages/worker-runtime/src/index.test.ts`
  - Deterministic contract tests for queueing, policy rejection, adapter results, bounded output, project-scoped listing, and defensive copies.
- Create: `packages/api/src/worker-backed-tool-command-runner.ts`
  - Adapter that implements the existing `ToolCommandRunner` interface by enqueueing and running worker jobs.
- Create: `packages/api/src/worker-backed-tool-command-runner.test.ts`
  - Unit tests for completed, rejected, failed, and queued-worker mapping behavior.
- Modify: `packages/api/package.json`
  - Add `@lp-agent/worker-runtime` dependency and include the new API test file in the package test script.
- Modify: `packages/api/src/index.ts`
  - Export `WorkerBackedToolCommandRunner` and its resolver helper types.
- Modify: `packages/api/src/services.test.ts`
  - Add one narrow integration test proving deployment skill commands can use the worker-backed runner only when explicitly injected.
- Modify: `docs/agent-development-learning.md`
  - Mark this implementation plan as the Stage 8 execution entry.
- Modify: `docs/superpowers/README.md`
  - Add this plan to the reading order immediately after the Stage 8 design spec.

## Task 1: Create Worker Runtime Package And Contract Tests

**Files:**

- Create: `packages/worker-runtime/package.json`
- Create: `packages/worker-runtime/tsconfig.json`
- Create: `packages/worker-runtime/src/index.test.ts`
- Create: `packages/worker-runtime/src/index.ts`

- [ ] **Step 1: Create the package manifest**

Create `packages/worker-runtime/package.json`:

```json
{
  "name": "@lp-agent/worker-runtime",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run src/index.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create the package TypeScript config**

Create `packages/worker-runtime/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write failing worker-runtime tests**

Create `packages/worker-runtime/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  InMemoryWorkerRuntime,
  RejectingExecutionAdapter,
  SimulatedExecutionAdapter,
  createRejectSandboxPolicy,
  createSimulatedSandboxPolicy,
  type ExecutionAdapter,
  type ExecutionInput,
  type ExecutionResult,
  type SandboxPolicy
} from "./index";

describe("InMemoryWorkerRuntime", () => {
  it("enqueues jobs in deterministic order and returns defensive copies", async () => {
    const runtime = new InMemoryWorkerRuntime({ now: fixedClock() });
    const policy = createRejectSandboxPolicy();

    const first = await runtime.enqueue(toolCommandInput({ projectId: "project_1" }), policy);
    const second = await runtime.enqueue(
      toolCommandInput({ projectId: "project_1", commandId: "publish_next" }),
      policy
    );
    await runtime.enqueue(toolCommandInput({ projectId: "project_2" }), policy);

    expect(first).toMatchObject({
      id: "worker_job_1",
      projectId: "project_1",
      kind: "tool_command",
      state: "queued",
      inputSummary: {
        command: "static-deploy",
        commandId: "publish_static",
        argCount: 2,
        envNames: ["LP_PROJECT_ID"],
        timeoutMs: 120000
      }
    });
    expect(second.id).toBe("worker_job_2");

    const jobs = await runtime.listJobsForProject("project_1");
    expect(jobs.map((job) => job.id)).toEqual(["worker_job_1", "worker_job_2"]);

    jobs[0]!.state = "failed";
    jobs[0]!.policy.allowedCommands.push("mutated");
    const freshJobs = await runtime.listJobsForProject("project_1");
    expect(freshJobs[0]!.state).toBe("queued");
    expect(freshJobs[0]!.policy.allowedCommands).toEqual([]);
  });

  it("returns undefined when no queued job exists", async () => {
    const runtime = new InMemoryWorkerRuntime({ now: fixedClock() });

    await expect(runtime.runNext()).resolves.toBeUndefined();
  });

  it("rejects commands before adapter execution when policy denies the command", async () => {
    const adapter = new RecordingExecutionAdapter({
      state: "completed",
      exitCode: 0,
      stdout: "should not run",
      stderr: ""
    });
    const runtime = new InMemoryWorkerRuntime({ adapter, now: fixedClock() });
    await runtime.enqueue(
      toolCommandInput({ command: "static-deploy" }),
      createSimulatedSandboxPolicy({ allowedCommands: ["other-command"] })
    );

    const result = await runtime.runNext();

    expect(adapter.inputs).toHaveLength(0);
    expect(result).toMatchObject({
      id: "worker_job_1",
      state: "rejected",
      errorName: "sandbox_policy_command_not_allowed",
      resultSummary: {
        state: "rejected",
        exitCode: undefined,
        stdout: "",
        stderr: "Command is not allowed by sandbox policy."
      }
    });
  });

  it("rejects unexpected environment variable names before adapter execution", async () => {
    const adapter = new RecordingExecutionAdapter({
      state: "completed",
      exitCode: 0,
      stdout: "should not run",
      stderr: ""
    });
    const runtime = new InMemoryWorkerRuntime({ adapter, now: fixedClock() });
    await runtime.enqueue(
      toolCommandInput({
        env: {
          LP_PROJECT_ID: "project_1",
          STATIC_DEPLOY_TOKEN: "secret-token"
        }
      }),
      createSimulatedSandboxPolicy({
        allowedCommands: ["static-deploy"],
        allowedEnvNames: ["LP_PROJECT_ID"]
      })
    );

    const result = await runtime.runNext();

    expect(adapter.inputs).toHaveLength(0);
    expect(result?.state).toBe("rejected");
    expect(result?.errorName).toBe("sandbox_policy_env_not_allowed");
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("rejects working directories outside the configured root", async () => {
    const adapter = new RecordingExecutionAdapter({
      state: "completed",
      exitCode: 0,
      stdout: "should not run",
      stderr: ""
    });
    const runtime = new InMemoryWorkerRuntime({ adapter, now: fixedClock() });
    await runtime.enqueue(
      toolCommandInput({ workingDirectory: "/tmp/workspace-other" }),
      createSimulatedSandboxPolicy({
        allowedCommands: ["static-deploy"],
        allowedEnvNames: ["LP_PROJECT_ID"],
        workingDirectoryRoot: "/tmp/workspace"
      })
    );

    const result = await runtime.runNext();

    expect(adapter.inputs).toHaveLength(0);
    expect(result?.state).toBe("rejected");
    expect(result?.errorName).toBe("sandbox_policy_working_directory_forbidden");
  });

  it("uses the simulated adapter and stores bounded output summaries", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter(),
      now: fixedClock()
    });
    await runtime.enqueue(
      toolCommandInput({ workingDirectory: "/tmp/workspace/artifacts" }),
      createSimulatedSandboxPolicy({
        allowedCommands: ["static-deploy"],
        allowedEnvNames: ["LP_PROJECT_ID"],
        workingDirectoryRoot: "/tmp/workspace",
        maxStdoutBytes: 24,
        maxStderrBytes: 24
      })
    );

    const result = await runtime.runNext();

    expect(result?.state).toBe("completed");
    expect(result?.resultSummary).toMatchObject({
      state: "completed",
      exitCode: 0,
      stderr: "",
      stderrBytes: 0
    });
    expect(result?.resultSummary?.stdout).toHaveLength(24);
    expect(result?.resultSummary?.stdout.endsWith("...")).toBe(true);
    expect(result?.resultSummary?.stdoutBytes).toBeGreaterThan(24);
  });

  it("records adapter failures as failed jobs", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter({ failCommands: ["static-deploy"] }),
      now: fixedClock()
    });
    await runtime.enqueue(
      toolCommandInput(),
      createSimulatedSandboxPolicy({
        allowedCommands: ["static-deploy"],
        allowedEnvNames: ["LP_PROJECT_ID"]
      })
    );

    const result = await runtime.runNext();

    expect(result).toMatchObject({
      state: "failed",
      errorName: "simulated_command_failed",
      resultSummary: {
        state: "failed",
        exitCode: 1,
        stdout: "",
        stderr: "Simulated command failure."
      }
    });
  });

  it("supports a rejecting adapter without executing a real command", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new RejectingExecutionAdapter(),
      now: fixedClock()
    });
    await runtime.enqueue(
      toolCommandInput(),
      createSimulatedSandboxPolicy({
        allowedCommands: ["static-deploy"],
        allowedEnvNames: ["LP_PROJECT_ID"]
      })
    );

    const result = await runtime.runNext();

    expect(result).toMatchObject({
      state: "rejected",
      errorName: "execution_adapter_rejected"
    });
  });
});

class RecordingExecutionAdapter implements ExecutionAdapter {
  readonly inputs: ExecutionInput[] = [];

  constructor(private readonly result: ExecutionResult) {}

  async execute(input: ExecutionInput): Promise<ExecutionResult> {
    this.inputs.push(input);
    return this.result;
  }
}

function fixedClock(): () => Date {
  let count = 0;
  return () => {
    count += 1;
    return new Date(`2026-05-17T00:00:${String(count).padStart(2, "0")}.000Z`);
  };
}

function toolCommandInput(
  overrides: Partial<{
    projectId: string;
    commandId: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    workingDirectory: string;
    timeoutMs: number;
  }> = {}
) {
  return {
    projectId: overrides.projectId ?? "project_1",
    kind: "tool_command" as const,
    commandId: overrides.commandId ?? "publish_static",
    command: overrides.command ?? "static-deploy",
    args: overrides.args ?? ["--project", "project_1"],
    env: overrides.env ?? { LP_PROJECT_ID: "project_1" },
    ...(overrides.workingDirectory ? { workingDirectory: overrides.workingDirectory } : {}),
    timeoutMs: overrides.timeoutMs ?? 120000
  };
}
```

- [ ] **Step 4: Run tests to verify the package fails before implementation**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
```

Expected:

```text
FAIL  src/index.test.ts
Cannot find module './index'
```

- [ ] **Step 5: Implement worker runtime contracts and deterministic adapters**

Create `packages/worker-runtime/src/index.ts`:

```ts
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
  command: string;
  commandId?: string;
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

export interface InMemoryWorkerRuntimeOptions {
  adapter?: ExecutionAdapter;
  now?: () => Date;
  idPrefix?: string;
}

export class InMemoryWorkerRuntime implements WorkerRuntime {
  private readonly adapter: ExecutionAdapter;
  private readonly now: () => Date;
  private readonly idPrefix: string;
  private readonly jobs: WorkerJobRecord[] = [];
  private readonly inputsByJobId = new Map<string, WorkerJobInput>();
  private nextId = 1;

  constructor(options: InMemoryWorkerRuntimeOptions = {}) {
    this.adapter = options.adapter ?? new RejectingExecutionAdapter();
    this.now = options.now ?? (() => new Date());
    this.idPrefix = options.idPrefix ?? "worker_job";
  }

  async enqueue(
    input: WorkerJobInput,
    policy: SandboxPolicy = createRejectSandboxPolicy()
  ): Promise<WorkerJobRecord> {
    const id = `${this.idPrefix}_${this.nextId}`;
    this.nextId += 1;

    const record: WorkerJobRecord = {
      id,
      projectId: input.projectId,
      kind: input.kind,
      state: "queued",
      policy: clone(policy),
      inputSummary: toInputSummary(input),
      createdAt: this.timestamp()
    };
    this.inputsByJobId.set(id, clone(input));
    this.jobs.push(record);
    return clone(record);
  }

  async runNext(): Promise<WorkerJobRecord | undefined> {
    const record = this.jobs.find((job) => job.state === "queued");
    if (!record) {
      return undefined;
    }

    const input = this.inputsByJobId.get(record.id);
    if (!input) {
      return clone(
        this.updateJob(record.id, {
          state: "failed",
          errorName: "worker_job_input_missing",
          completedAt: this.timestamp(),
          resultSummary: toResultSummary(
            {
              state: "failed",
              stdout: "",
              stderr: "Worker job input is missing.",
              errorName: "worker_job_input_missing"
            },
            record.policy
          )
        })
      );
    }

    const rejection = validateSandboxPolicy(input, record.policy);
    if (rejection) {
      return clone(
        this.updateJob(record.id, {
          state: "rejected",
          errorName: rejection.errorName,
          completedAt: this.timestamp(),
          resultSummary: toResultSummary(
            {
              state: "rejected",
              stdout: "",
              stderr: rejection.message,
              errorName: rejection.errorName
            },
            record.policy
          )
        })
      );
    }

    this.updateJob(record.id, {
      state: "running",
      startedAt: this.timestamp()
    });

    const result = await this.executeSafely(record.id, input, record.policy);
    const finalState = toWorkerState(result.state);
    return clone(
      this.updateJob(record.id, {
        state: finalState,
        errorName: result.errorName,
        completedAt: this.timestamp(),
        resultSummary: toResultSummary(result, record.policy)
      })
    );
  }

  async getJob(id: string): Promise<WorkerJobRecord | undefined> {
    const record = this.jobs.find((job) => job.id === id);
    return record ? clone(record) : undefined;
  }

  async listJobsForProject(projectId: string): Promise<WorkerJobRecord[]> {
    return this.jobs
      .filter((job) => job.projectId === projectId)
      .map((job) => clone(job));
  }

  private async executeSafely(
    jobId: string,
    input: WorkerJobInput,
    policy: SandboxPolicy
  ): Promise<ExecutionResult> {
    try {
      return await this.adapter.execute(toExecutionInput(jobId, input), policy);
    } catch (error) {
      return {
        state: "failed",
        stdout: "",
        stderr: error instanceof Error ? error.message : "Execution adapter failed.",
        errorName:
          error instanceof Error && error.name ? error.name : "execution_adapter_failed"
      };
    }
  }

  private updateJob(id: string, patch: Partial<WorkerJobRecord>): WorkerJobRecord {
    const index = this.jobs.findIndex((job) => job.id === id);
    if (index === -1) {
      throw new Error("worker_job_not_found");
    }
    const next = {
      ...this.jobs[index]!,
      ...patch
    };
    this.jobs[index] = next;
    return next;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

export class RejectingExecutionAdapter implements ExecutionAdapter {
  async execute(): Promise<ExecutionResult> {
    return {
      state: "rejected",
      stdout: "",
      stderr: "Execution adapter rejects command execution.",
      errorName: "execution_adapter_rejected"
    };
  }
}

export interface SimulatedExecutionAdapterOptions {
  failCommands?: string[];
}

export class SimulatedExecutionAdapter implements ExecutionAdapter {
  private readonly failCommands: string[];

  constructor(options: SimulatedExecutionAdapterOptions = {}) {
    this.failCommands = options.failCommands ?? [];
  }

  async execute(input: ExecutionInput): Promise<ExecutionResult> {
    if (this.failCommands.includes(input.command) || input.commandId?.includes("fail")) {
      return {
        state: "failed",
        exitCode: 1,
        stdout: "",
        stderr: "Simulated command failure.",
        errorName: "simulated_command_failed"
      };
    }

    return {
      state: "completed",
      exitCode: 0,
      stdout: `Simulated ${input.command} for project ${input.projectId}.`,
      stderr: ""
    };
  }
}

export function createRejectSandboxPolicy(
  overrides: Partial<SandboxPolicy> = {}
): SandboxPolicy {
  return {
    mode: "reject",
    allowedCommands: [],
    timeoutMs: 120000,
    allowedEnvNames: [],
    maxStdoutBytes: 300,
    maxStderrBytes: 300,
    network: "disabled",
    ...overrides
  };
}

export function createSimulatedSandboxPolicy(
  overrides: Partial<SandboxPolicy> = {}
): SandboxPolicy {
  return createRejectSandboxPolicy({
    mode: "simulate",
    ...overrides
  });
}

interface PolicyRejection {
  errorName: string;
  message: string;
}

export function validateSandboxPolicy(
  input: WorkerJobInput,
  policy: SandboxPolicy
): PolicyRejection | undefined {
  if (policy.network !== "disabled") {
    return {
      errorName: "sandbox_policy_network_not_supported",
      message: "Network access is not supported by this worker runtime."
    };
  }
  if (policy.mode === "reject") {
    return {
      errorName: "sandbox_policy_reject_mode",
      message: "Sandbox policy is configured to reject execution."
    };
  }
  if (!policy.allowedCommands.includes(input.command)) {
    return {
      errorName: "sandbox_policy_command_not_allowed",
      message: "Command is not allowed by sandbox policy."
    };
  }

  const allowedEnvNames = new Set(policy.allowedEnvNames);
  const unexpectedEnvName = Object.keys(input.env)
    .sort()
    .find((envName) => !allowedEnvNames.has(envName));
  if (unexpectedEnvName) {
    return {
      errorName: "sandbox_policy_env_not_allowed",
      message: "Environment variable is not allowed by sandbox policy."
    };
  }

  if (input.workingDirectory) {
    if (!policy.workingDirectoryRoot || !isPathInside(policy.workingDirectoryRoot, input.workingDirectory)) {
      return {
        errorName: "sandbox_policy_working_directory_forbidden",
        message: "Working directory is outside the sandbox policy root."
      };
    }
  }

  if (input.timeoutMs > policy.timeoutMs) {
    return {
      errorName: "sandbox_policy_timeout_exceeded",
      message: "Command timeout exceeds sandbox policy timeout."
    };
  }

  return undefined;
}

function toInputSummary(input: WorkerJobInput): WorkerJobInputSummary {
  return {
    command: input.command,
    ...(input.commandId ? { commandId: input.commandId } : {}),
    argCount: input.args.length,
    envNames: Object.keys(input.env).sort(),
    ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
    timeoutMs: input.timeoutMs
  };
}

function toExecutionInput(jobId: string, input: WorkerJobInput): ExecutionInput {
  return {
    jobId,
    projectId: input.projectId,
    kind: input.kind,
    ...(input.commandId ? { commandId: input.commandId } : {}),
    command: input.command,
    args: [...input.args],
    env: { ...input.env },
    envNames: Object.keys(input.env).sort(),
    ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
    timeoutMs: input.timeoutMs
  };
}

function toResultSummary(
  result: ExecutionResult,
  policy: SandboxPolicy
): WorkerJobResultSummary {
  return {
    state: result.state,
    ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
    stdout: boundText(result.stdout, policy.maxStdoutBytes),
    stderr: boundText(result.stderr, policy.maxStderrBytes),
    stdoutBytes: byteLength(result.stdout),
    stderrBytes: byteLength(result.stderr)
  };
}

function toWorkerState(state: ExecutionResult["state"]): WorkerJobState {
  if (state === "completed") {
    return "completed";
  }
  if (state === "rejected") {
    return "rejected";
  }
  return "failed";
}

function isPathInside(root: string, child: string): boolean {
  const rootPath = resolve(root);
  const childPath = resolve(child);
  return childPath === rootPath || childPath.startsWith(`${rootPath}${sep}`);
}

function boundText(value: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return "";
  }
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(value);
  if (bytes.length <= maxBytes) {
    return value;
  }
  if (maxBytes <= 3) {
    return decoder.decode(bytes.slice(0, maxBytes));
  }
  return `${decoder.decode(bytes.slice(0, maxBytes - 3))}...`;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
```

- [ ] **Step 6: Run package tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
pnpm --filter @lp-agent/worker-runtime typecheck
```

Expected:

```text
Test Files  1 passed
```

and no TypeScript errors.

- [ ] **Step 7: Commit worker runtime package**

Run:

```bash
git add packages/worker-runtime/package.json packages/worker-runtime/tsconfig.json packages/worker-runtime/src/index.ts packages/worker-runtime/src/index.test.ts
git commit -m "add worker runtime contracts"
```

## Task 2: Add Worker-Backed Tool Command Runner

**Files:**

- Create: `packages/api/src/worker-backed-tool-command-runner.test.ts`
- Create: `packages/api/src/worker-backed-tool-command-runner.ts`
- Modify: `packages/api/package.json`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Add worker-runtime dependency and test script entry**

Modify `packages/api/package.json`:

```json
{
  "name": "@lp-agent/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run src/structured-lp-brief.test.ts src/structured-static-artifacts.test.ts src/skill-command-execution.test.ts src/worker-backed-tool-command-runner.test.ts src/run-orchestrator.test.ts src/context-memory.test.ts src/agent-handoffs.test.ts src/services.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@lp-agent/artifacts": "workspace:*",
    "@lp-agent/db": "workspace:*",
    "@lp-agent/git-deployment": "workspace:*",
    "@lp-agent/lp-schema": "workspace:*",
    "@lp-agent/mcp-gateway": "workspace:*",
    "@lp-agent/model-gateway": "workspace:*",
    "@lp-agent/runtime-adapters": "workspace:*",
    "@lp-agent/skills": "workspace:*",
    "@lp-agent/worker-runtime": "workspace:*",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write failing API adapter tests**

Create `packages/api/src/worker-backed-tool-command-runner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
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
      adapter: new SimulatedExecutionAdapter(),
      now: fixedClock()
    });
    const runner = new WorkerBackedToolCommandRunner(runtime, (input) =>
      createSandboxPolicyForToolCommand(input, {
        mode: "simulate",
        allowedCommands: [input.command],
        allowedEnvNames: Object.keys(input.env),
        maxStdoutBytes: 300,
        maxStderrBytes: 300
      })
    );

    const result = await runner.run(toolCommandInput());
    const jobs = await runtime.listJobsForProject("project_1");

    expect(result).toMatchObject({
      state: "completed",
      exitCode: 0,
      stdout: "Simulated static-deploy for project project_1.",
      stderr: ""
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      state: "completed",
      inputSummary: {
        command: "static-deploy",
        envNames: ["LP_PROJECT_ID"]
      }
    });
    expect(JSON.stringify(jobs[0])).not.toContain("secret-token");
  });

  it("maps rejected worker jobs to failed tool command results with a stable error name", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter(),
      now: fixedClock()
    });
    const runner = new WorkerBackedToolCommandRunner(runtime, () =>
      createSimulatedSandboxPolicy({
        allowedCommands: ["other-command"],
        allowedEnvNames: ["LP_PROJECT_ID"]
      })
    );

    const result = await runner.run(toolCommandInput());

    expect(result).toEqual({
      state: "failed",
      exitCode: undefined,
      stdout: "",
      stderr: "Command is not allowed by sandbox policy.",
      errorName: "sandbox_policy_command_not_allowed"
    });
  });

  it("maps failed worker jobs to failed tool command results", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter({ failCommands: ["static-deploy"] }),
      now: fixedClock()
    });
    const runner = new WorkerBackedToolCommandRunner(runtime, (input) =>
      createSandboxPolicyForToolCommand(input, {
        mode: "simulate",
        allowedCommands: [input.command],
        allowedEnvNames: Object.keys(input.env)
      })
    );

    const result = await runner.run(toolCommandInput());

    expect(result).toEqual({
      state: "failed",
      exitCode: 1,
      stdout: "",
      stderr: "Simulated command failure.",
      errorName: "simulated_command_failed"
    });
  });

  it("runs older queued jobs before returning the enqueued command result", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter(),
      now: fixedClock()
    });
    await runtime.enqueue(
      {
        ...toolCommandInput(),
        projectId: "project_2"
      },
      createSimulatedSandboxPolicy({
        allowedCommands: ["static-deploy"],
        allowedEnvNames: ["LP_PROJECT_ID"]
      })
    );
    const runner = new WorkerBackedToolCommandRunner(runtime, (input) =>
      createSandboxPolicyForToolCommand(input, {
        mode: "simulate",
        allowedCommands: [input.command],
        allowedEnvNames: Object.keys(input.env)
      })
    );

    const result = await runner.run(toolCommandInput());

    expect(result.state).toBe("completed");
    expect((await runtime.listJobsForProject("project_2"))[0]?.state).toBe("completed");
    expect((await runtime.listJobsForProject("project_1"))[0]?.state).toBe("completed");
  });
});

function fixedClock(): () => Date {
  let count = 0;
  return () => {
    count += 1;
    return new Date(`2026-05-17T00:01:${String(count).padStart(2, "0")}.000Z`);
  };
}

function toolCommandInput(): ToolCommandRunInput {
  return {
    runId: "run_skill_command_1",
    projectId: "project_1",
    skillId: "skill_static_deploy",
    skillVersionId: "skill_static_deploy@1.0.0",
    commandId: "publish_static",
    command: "static-deploy",
    args: ["--project", "project_1"],
    env: {
      LP_PROJECT_ID: "project_1"
    },
    timeoutMs: 120000
  };
}
```

- [ ] **Step 3: Run the new API test to verify it fails before implementation**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected:

```text
FAIL  src/worker-backed-tool-command-runner.test.ts
Cannot find module './worker-backed-tool-command-runner'
```

- [ ] **Step 4: Implement the worker-backed runner**

Create `packages/api/src/worker-backed-tool-command-runner.ts`:

```ts
import type {
  SandboxPolicy,
  WorkerJobInput,
  WorkerJobRecord,
  WorkerRuntime
} from "@lp-agent/worker-runtime";
import { createRejectSandboxPolicy } from "@lp-agent/worker-runtime";
import type {
  ToolCommandRunner,
  ToolCommandRunInput,
  ToolCommandRunResult
} from "./tool-command-runner";

export type SandboxPolicyResolver = (
  input: ToolCommandRunInput
) => SandboxPolicy | Promise<SandboxPolicy>;

export class WorkerBackedToolCommandRunner implements ToolCommandRunner {
  constructor(
    private readonly runtime: WorkerRuntime,
    private readonly resolvePolicy: SandboxPolicyResolver = () => createRejectSandboxPolicy()
  ) {}

  async run(input: ToolCommandRunInput): Promise<ToolCommandRunResult> {
    const policy = await this.resolvePolicy(input);
    const queued = await this.runtime.enqueue(toWorkerJobInput(input), policy);
    const record = await this.runUntilSettled(queued.id);
    return toToolCommandRunResult(record);
  }

  private async runUntilSettled(jobId: string): Promise<WorkerJobRecord> {
    let record = await this.runtime.getJob(jobId);
    while (record && (record.state === "queued" || record.state === "running")) {
      const ran = await this.runtime.runNext();
      if (!ran) {
        break;
      }
      record = await this.runtime.getJob(jobId);
    }

    if (!record) {
      throw new Error("worker_job_not_found");
    }
    return record;
  }
}

export function createSandboxPolicyForToolCommand(
  input: ToolCommandRunInput,
  overrides: Partial<SandboxPolicy> = {}
): SandboxPolicy {
  return {
    mode: "reject",
    allowedCommands: [],
    allowedEnvNames: [],
    timeoutMs: input.timeoutMs,
    maxStdoutBytes: 300,
    maxStderrBytes: 300,
    network: "disabled",
    ...overrides
  };
}

function toWorkerJobInput(input: ToolCommandRunInput): WorkerJobInput {
  return {
    projectId: input.projectId,
    kind: "tool_command",
    commandId: input.commandId,
    command: input.command,
    args: [...input.args],
    env: { ...input.env },
    ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
    timeoutMs: input.timeoutMs
  };
}

function toToolCommandRunResult(record: WorkerJobRecord): ToolCommandRunResult {
  const summary = record.resultSummary;
  if (record.state === "completed") {
    return {
      state: "completed",
      exitCode: summary?.exitCode,
      stdout: summary?.stdout ?? "",
      stderr: summary?.stderr ?? ""
    };
  }

  if (record.state === "failed" || record.state === "rejected") {
    return {
      state: "failed",
      exitCode: summary?.exitCode,
      stdout: summary?.stdout ?? "",
      stderr: summary?.stderr ?? "",
      errorName:
        record.errorName ??
        (record.state === "rejected" ? "worker_job_rejected" : "worker_job_failed")
    };
  }

  return {
    state: "failed",
    stdout: summary?.stdout ?? "",
    stderr: summary?.stderr ?? "",
    errorName: "worker_job_not_settled"
  };
}
```

- [ ] **Step 5: Export the new API adapter**

Modify `packages/api/src/index.ts` by adding this export near the other local exports:

```ts
export {
  WorkerBackedToolCommandRunner,
  createSandboxPolicyForToolCommand,
  type SandboxPolicyResolver
} from "./worker-backed-tool-command-runner";
```

- [ ] **Step 6: Run API adapter tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/api test
pnpm --filter @lp-agent/api typecheck
```

Expected:

```text
Test Files  8 passed
```

and no TypeScript errors.

- [ ] **Step 7: Commit API adapter**

Run:

```bash
git add packages/api/package.json packages/api/src/index.ts packages/api/src/worker-backed-tool-command-runner.ts packages/api/src/worker-backed-tool-command-runner.test.ts
git commit -m "add worker backed tool command runner"
```

## Task 3: Prove Service Integration Is Explicit And Safe

**Files:**

- Modify: `packages/api/src/services.test.ts`

- [ ] **Step 1: Add imports for the worker-backed runner integration test**

Modify the import section in `packages/api/src/services.test.ts`:

```ts
import {
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter
} from "@lp-agent/worker-runtime";
import {
  WorkerBackedToolCommandRunner,
  createSandboxPolicyForToolCommand
} from "./worker-backed-tool-command-runner";
```

Keep the existing imports intact.

- [ ] **Step 2: Add a service-level worker-backed command test**

Add this test near the existing deployment skill command tests in `packages/api/src/services.test.ts`:

```ts
  it("can execute deployment skill commands through a worker-backed runner when explicitly injected", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const workerRuntime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter(),
      now: fixedClock()
    });
    const runner = new WorkerBackedToolCommandRunner(workerRuntime, (input) =>
      createSandboxPolicyForToolCommand(input, {
        mode: "simulate",
        allowedCommands: [input.command],
        allowedEnvNames: Object.keys(input.env),
        maxStdoutBytes: 300,
        maxStderrBytes: 300
      })
    );
    const service = new DemoWorkbenchService({
      repositories,
      toolCommandRunner: runner,
      env: { STATIC_DEPLOY_TOKEN: "secret-token" },
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const skill = await service.createSkillDraft({
      manifestJson: JSON.stringify(
        deploymentSkillManifest({ commands: [commandWithoutArtifacts()] })
      ),
      content: "# Static deploy",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: skill.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: skill.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });

    const result = await service.executeProjectSkillCommand({
      projectId: project.id,
      skillVersionId: published.id,
      commandId: "publish_static",
      approvedByUserId: "user_1"
    });
    const jobs = await workerRuntime.listJobsForProject(project.id);
    const serializedRecords = JSON.stringify({
      run: result.run,
      observation: result.observation,
      jobs
    });

    expect(result.run.state).toBe("completed");
    expect(result.observation).toMatchObject({
      state: "completed",
      exitCode: 0,
      outputSummary: "stdout: 47 chars\nstderr: 0 chars"
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      state: "completed",
      inputSummary: {
        command: "static-deploy",
        envNames: ["LP_PROJECT_ID", "STATIC_DEPLOY_TOKEN"]
      }
    });
    expect(serializedRecords).not.toContain("secret-token");
  });
```

The expected stdout length is `47` for `Simulated static-deploy for project project_1.`. If the project id generated by the repository changes in a future refactor, compute the expected summary inside the test:

```ts
const expectedStdout = `Simulated static-deploy for project ${project.id}.`;
expect(result.observation.outputSummary).toBe(
  `stdout: ${expectedStdout.length} chars\nstderr: 0 chars`
);
```

- [ ] **Step 3: Run the service test**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected:

```text
Test Files  8 passed
```

- [ ] **Step 4: Confirm default API behavior is still rejecting**

Do not change `DemoWorkbenchService` constructor defaults. Verify the existing tests that use no explicit `toolCommandRunner` still pass. The constructor should still contain:

```ts
this.toolCommandRunner = options.toolCommandRunner ?? new RejectingToolCommandRunner();
```

- [ ] **Step 5: Commit service integration coverage**

Run:

```bash
git add packages/api/src/services.test.ts
git commit -m "cover worker backed skill command execution"
```

## Task 4: Documentation And Full Verification

**Files:**

- Modify: `docs/agent-development-learning.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Update the Stage 8 learning section**

In `docs/agent-development-learning.md`, under `### 阶段 8：Worker / Sandbox Runtime Foundation`, keep the design link and add this plan link:

```md
当前计划：

- [2026-05-17-worker-sandbox-runtime.md](./superpowers/plans/2026-05-17-worker-sandbox-runtime.md)
```

Also add this learning point:

```md
- 真实执行能力不应该和 job 状态机同时上线；先让 adapter 形状、policy 拒绝路径和 observation 映射稳定下来。
```

- [ ] **Step 2: Update the Superpowers reading order**

In `docs/superpowers/README.md`, add this entry immediately after the Stage 8 design spec:

```md
45. `plans/2026-05-17-worker-sandbox-runtime.md`
   - Stage 8 worker sandbox runtime foundation implementation plan.
   - Read this after the worker sandbox runtime design when implementing or auditing `packages/worker-runtime`, sandbox policy validation, deterministic execution adapters, and the worker-backed `ToolCommandRunner`.
```

- [ ] **Step 3: Run targeted verification**

Run:

```bash
pnpm --filter @lp-agent/worker-runtime test
pnpm --filter @lp-agent/api test
pnpm --filter @lp-agent/worker-runtime typecheck
pnpm --filter @lp-agent/api typecheck
```

Expected:

```text
@lp-agent/worker-runtime test: 1 passed
@lp-agent/api test: 8 passed
```

and no TypeScript errors.

- [ ] **Step 4: Run full repository verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected:

```text
pnpm test: all existing tests pass, plus the new worker-runtime and API adapter tests
pnpm typecheck: no TypeScript errors
pnpm build: all package/app builds pass
git diff --check: no whitespace errors
```

- [ ] **Step 5: Check git status before committing**

Run:

```bash
git status --short
```

Expected: only intentional Stage 8 files are staged or modified. Leave the existing root image files untracked if they are still present:

```text
?? 微信图片_20260512094225_26_894.png
?? 微信图片_20260512171758_27_894.png
```

- [ ] **Step 6: Commit documentation and final verification changes**

Run:

```bash
git add docs/agent-development-learning.md docs/superpowers/README.md
git commit -m "document worker runtime implementation"
```

If Task 4 only changes documentation after all code was already committed, this commit contains only docs. If verification uncovered a small correction in a Stage 8 code file, include that exact file in this commit and mention it in the final handoff.

## Final Handoff

After all tasks pass, report:

- commits created;
- verification commands and results;
- whether the default API/Web runtime still rejects or simulates rather than executing real shell commands;
- the next recommended Stage 8 follow-up, which should be persistence or agent-worker queue wiring, not real shell execution.

## Self-Review

- Spec coverage: the plan creates `packages/worker-runtime`, defines `WorkerJob`, `SandboxPolicy`, `ExecutionAdapter`, in-memory runtime, rejecting/simulated adapters, API worker-backed runner, opt-in service integration, docs, and verification.
- Scope check: the plan explicitly excludes real shell execution, MCP execution, Web UI, deployment automation, and OS-level sandboxing.
- Type consistency: `WorkerJobInput`, `WorkerJobRecord`, `SandboxPolicy`, `ExecutionAdapter`, `WorkerRuntime`, `WorkerBackedToolCommandRunner`, and `SandboxPolicyResolver` names are consistent across tasks.
- Safety check: records store env names and bounded summaries, not raw secrets. The default API service remains `RejectingToolCommandRunner`.
