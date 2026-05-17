# Worker Job Cancel / Interrupt Foundation Design

## Purpose

Stage 10 adds the first cancel and interrupt foundation for worker jobs. The goal is to make task interruption a first-class runtime/API concept before adding Web interrupt wiring, real worker queues, MCP execution, or real shell adapters.

This stage keeps execution safe and cooperative. It does not forcibly kill OS processes because the project still has no real shell execution. It defines the state, API, and adapter context that later real runners can honor without changing the product-facing semantics again.

## Current Baseline

The project already has:

- `@lp-agent/worker-runtime` with `WorkerJobRecord`, `SandboxPolicy`, `ExecutionAdapter`, `WorkerRuntime`, `InMemoryWorkerRuntime`, `WorkerJobRepository`, `InMemoryWorkerJobRepository`, and `JsonFileWorkerJobRepository`.
- A persisted worker job state machine with `queued`, `running`, `completed`, `failed`, `rejected`, and reserved `cancelled` states.
- Repository-backed worker records, JSON-file persistence, same-runtime enqueue/run serialization, safe restart behavior, and process-local execution payloads.
- `WorkerBackedToolCommandRunner` in `@lp-agent/api`, still available only through explicit injection.
- Web UI affordances that visually suggest interrupt-style behavior, but no true cancel path wired to worker runtime yet.

The current gap is that `cancelled` is only a reserved state. There is no runtime method to request cancellation, no durable cancel metadata, and no adapter context that lets cooperative adapters observe cancellation requests.

## Goals

1. Add `cancelJob(jobId, reason?)` to `WorkerRuntime`.
2. Add minimal cancel audit fields to `WorkerJobRecord`.
3. Support immediate cancellation for queued jobs.
4. Support cooperative cancellation for running jobs.
5. Add adapter-facing cancellation context without enabling real process control.
6. Preserve safe defaults and existing deterministic behavior.
7. Keep actor/user identity out of worker records for now.
8. Make `WorkerBackedToolCommandRunner` able to return a cancelled tool command result when a worker job settles as cancelled.
9. Persist cancellation metadata through both in-memory and JSON-file worker job repositories.

## Non-Goals

This stage does not build:

- Web interrupt button wiring.
- Conversation-level task cancellation.
- Real shell execution, `child_process`, `spawn`, `exec`, or process termination.
- OS-level sandboxing, containers, VMs, or signal delivery.
- MCP execution.
- `apps/agent-worker` queue polling or cross-process job claiming.
- Cross-process cancellation guarantees.
- Retry, resume, or cancellation recovery for `running` jobs after process restart.
- Streaming logs.
- User/actor audit fields in worker job records.
- Team approval or authorization rules for cancellation.

## Runtime Data Model

Extend `WorkerJobResultSummary` so cancellation is a settled result:

```ts
export interface WorkerJobResultSummary {
  state: "completed" | "failed" | "rejected" | "cancelled";
  exitCode?: number;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  errorName?: string;
}
```

Extend `ExecutionResult` the same way:

```ts
export interface ExecutionResult {
  state: "completed" | "failed" | "rejected" | "cancelled";
  exitCode?: number;
  stdout: string;
  stderr: string;
  errorName?: string;
}
```

Extend `WorkerJobRecord` with minimal cancel metadata:

```ts
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
```

`cancelReason` is optional, bounded, and safe for persistence. It must not contain secrets, raw command args, raw env values, cookies, API keys, or artifact content. Stage 10 should truncate it to 200 characters before persistence.

Worker records still do not include actor identity. User/team audit belongs in API run events and collaboration records later.

## Runtime API

Extend `WorkerRuntime`:

```ts
export interface WorkerRuntime {
  enqueue(input: WorkerJobInput, policy?: SandboxPolicy): Promise<WorkerJobRecord>;
  runNext(): Promise<WorkerJobRecord | undefined>;
  cancelJob(id: string, reason?: string): Promise<WorkerJobRecord | undefined>;
  getJob(id: string): Promise<WorkerJobRecord | undefined>;
  listJobsForProject(projectId: string): Promise<WorkerJobRecord[]>;
}
```

`cancelJob()` should be idempotent and defensive-copy its return value:

- missing job: return `undefined`;
- queued job: immediately settle to `cancelled`;
- running job: record `cancelRequestedAt` and optional bounded `cancelReason`, keep state `running`;
- completed, failed, rejected, or already cancelled job: return the current record unchanged.

## Queued Cancellation

Cancelling a queued job should:

1. set `cancelRequestedAt`;
2. set `cancelledAt`;
3. set `completedAt`;
4. set `state: "cancelled"`;
5. set `errorName: "worker_job_cancelled"`;
6. store a bounded result summary:

```ts
{
  state: "cancelled",
  stdout: "",
  stderr: "Worker job cancelled before execution.",
  stdoutBytes: 0,
  stderrBytes: Buffer.byteLength("Worker job cancelled before execution.", "utf8"),
  errorName: "worker_job_cancelled"
}
```

If a reason is supplied, the runtime should include the bounded value in persisted `cancelReason`, but the default result summary should remain stable.

Queued cancellation must not call the execution adapter and must remove any process-local execution payload for that job.

## Running Cooperative Cancellation

Cancelling a running job should not immediately overwrite the job with a terminal state. The adapter may still be in an async operation, and Stage 10 has no real process control.

Instead, `cancelJob()` should:

1. set `cancelRequestedAt` if it is not already set;
2. store a bounded `cancelReason` if supplied and no reason has already been recorded;
3. leave `state: "running"`;
4. return the updated running record.

The running job becomes terminal only when the execution adapter returns an `ExecutionResult`.

If the adapter returns:

```ts
{
  state: "cancelled",
  stdout: "",
  stderr: "Worker job cancelled.",
  errorName: "worker_job_cancelled"
}
```

then the runtime should persist:

- `state: "cancelled"`;
- `errorName: "worker_job_cancelled"`;
- `cancelledAt`;
- `completedAt`;
- bounded/redacted `resultSummary`;
- no raw payload.

If the adapter ignores cancellation and returns `completed` or `failed`, Stage 10 should honor the adapter result. This keeps the runtime cooperative and avoids pretending that an operation stopped when it did not.

## Adapter Cancellation Context

Add a small execution context object passed to adapters:

```ts
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
```

The context should check the repository record for the current job id and return true when `cancelRequestedAt` is present or the job state is `cancelled`.

Existing deterministic adapters should remain safe:

- `RejectingExecutionAdapter` can ignore the context because policy rejection happens before adapter execution.
- `SimulatedExecutionAdapter` may check the context at the start and return a cancelled result if cancellation was already requested. It does not need to simulate long-running polling.
- Tests can use a custom deferred adapter to prove cooperative cancellation while `runNext()` is in progress.

## Repository Persistence

Repository implementations must defensively copy and persist the new fields:

- `cancelRequestedAt`;
- `cancelledAt`;
- `cancelReason`.

JSON-file persistence remains safe because these fields are bounded metadata. It must still not persist raw args, raw env values, secret values, or process-local execution payloads.

Old JSON files without cancel fields should continue to load without migration.

## API Integration

`WorkerBackedToolCommandRunner` should treat worker `cancelled` as a first-class command result.

Extend `ToolCommandRunResult`:

```ts
export interface ToolCommandRunResult {
  state: "completed" | "failed" | "cancelled";
  exitCode?: number;
  stdout: string;
  stderr: string;
  errorName?: string;
}
```

When a worker job settles as `cancelled`, the runner should return:

```ts
{
  state: "cancelled",
  exitCode: undefined,
  stdout: result.stdout,
  stderr: result.stderr,
  errorName: "worker_job_cancelled"
}
```

The existing skill command service can continue mapping non-completed command results to failed run/tool observations in this stage. Product-level run cancellation and Web timeline cancellation events should be a later Web/API workflow spec.

## Interrupt Semantics

Stage 10 defines worker-level interrupt semantics only:

```text
cancelJob(queued)
  -> cancelled immediately
  -> adapter not called

cancelJob(running)
  -> cancelRequestedAt recorded
  -> adapter context reports cancellation requested
  -> adapter may return cancelled
  -> runtime persists final cancelled state

cancelJob(settled)
  -> no mutation
  -> current record returned
```

This is enough for future Manus-like interrupt behavior, but it is not the UI feature yet.

## Error Names

Use stable error names:

- `worker_job_cancelled`: normal queued or cooperative running cancellation.
- `worker_job_not_found`: only for API caller paths that need to throw or report a missing job.

Do not use cancellation to mask policy rejections, missing payload failures, adapter failures, or unsupported execution modes.

## Security Rules

- Cancellation must never enable real shell execution.
- Cancellation must never persist raw args, raw env values, secret values, cookies, API keys, or artifact content.
- Cancellation reason is user-provided metadata and must be bounded before persistence.
- Runtime cancel state is not authorization. Future API/Web layers must decide who may cancel a job.
- Cooperative cancellation is honest: if an adapter ignores cancellation, the runtime must not claim the job was cancelled.

## Testing Strategy

### Worker Runtime Tests

Cover:

- queued job cancellation settles the job as `cancelled`;
- queued cancellation removes process-local payload and does not call adapter;
- cancelling a running job records `cancelRequestedAt` and keeps state `running`;
- a cooperative adapter can observe cancellation through `ExecutionContext`;
- adapter-returned cancelled result persists `cancelledAt`, `completedAt`, `errorName`, and bounded result summary;
- cancelling completed, failed, rejected, or already cancelled jobs is idempotent and does not mutate final state;
- cancelling a missing job returns `undefined`;
- cancellation reason is bounded;
- `runNext()` skips queued jobs that were cancelled before execution.

### Repository Tests

Cover:

- in-memory repository copies cancel metadata defensively;
- JSON-file repository persists and reloads cancel metadata;
- old JSON records without cancel fields still load;
- cancelled jobs are not returned by `findOldestQueued()`.

### API Tests

Cover:

- `WorkerBackedToolCommandRunner` maps a cancelled worker job to `ToolCommandRunResult.state === "cancelled"`;
- worker-backed runner still maps completed/rejected/failed jobs as before;
- existing skill command service behavior remains deterministic for non-completed command results.

## Rollout

Stage 10 should land as a runtime/API foundation:

- no Web UI changes;
- no real execution;
- no agent-worker queue;
- no MCP execution;
- existing deterministic flows should remain unchanged unless tests explicitly call `cancelJob()`.

The next likely stages after this are:

1. Web interrupt wiring that calls the runtime/API cancel path.
2. Agent-worker queue handoff with safe execution payload design.
3. Streaming log and progress events.
4. Real adapter cancellation semantics for local process execution, behind a separate sandbox and execution spec.
