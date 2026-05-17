# Worker Job Persistence Foundation Design

## Purpose

Stage 9 adds durable worker job record persistence on top of the Stage 8 worker/sandbox runtime foundation. The goal is to make worker job state observable after process restart and usable by future `apps/agent-worker` queue wiring, while keeping execution payloads and secrets out of durable storage.

This stage is still safety-first. It persists safe `WorkerJobRecord` data only. It does not persist raw environment values, raw command args, raw artifact content, or enough execution payload to resume a queued job after restart.

## Current Baseline

The project already has:

- `@lp-agent/worker-runtime` with `WorkerJobRecord`, `SandboxPolicy`, `ExecutionAdapter`, `WorkerRuntime`, `InMemoryWorkerRuntime`, `RejectingExecutionAdapter`, and `SimulatedExecutionAdapter`.
- Runtime policy validation that fail-closes unsupported policy modes, disallowed commands, unexpected env names, invalid output limits, timeout excess, network access, and unsafe working directories.
- Bounded worker result summaries with exact known env value redaction.
- `WorkerBackedToolCommandRunner` in `@lp-agent/api`, available only through explicit injection.
- JSON-file repository patterns in `@lp-agent/db`, including atomic temp-file writes and per-file write queues.

The current gap is that `InMemoryWorkerRuntime` owns job records in a private array. Worker job state disappears when the process restarts and cannot be shared with future worker processes.

## Goals

1. Add a `WorkerJobRepository` contract inside `@lp-agent/worker-runtime`.
2. Add `InMemoryWorkerJobRepository` for deterministic tests and default local behavior.
3. Add `JsonFileWorkerJobRepository` for durable local worker job records.
4. Refactor `InMemoryWorkerRuntime` to use a repository for safe worker job records.
5. Keep raw execution payloads process-local and non-durable.
6. Preserve the existing `WorkerRuntime` public API.
7. Keep `WorkerBackedToolCommandRunner` working with repository-backed runtimes.
8. Document that persisted queued jobs are observable but not resumable in this stage.

## Non-Goals

This stage does not build:

- Real shell execution, `child_process`, `spawn`, `exec`, or arbitrary command execution.
- MCP execution.
- `apps/agent-worker` queue polling or worker process wiring.
- Web UI for worker jobs.
- Postgres, Prisma, or database-backed worker job persistence.
- Cross-process atomic job claiming.
- Retry, resume, cancellation, streaming logs, or long-running worker supervision.
- Durable raw command args, raw env values, secret values, cookies, API keys, or artifact contents.
- Recovery of `running` jobs after process restart.
- Automatic cleanup, retention windows, or archival.

## Architecture

Stage 9 keeps worker persistence owned by `@lp-agent/worker-runtime`:

```text
packages/worker-runtime
  -> WorkerJobRepository contract
  -> InMemoryWorkerJobRepository
  -> JsonFileWorkerJobRepository
  -> InMemoryWorkerRuntime(repository-backed)
  -> volatile execution payload store
```

This avoids coupling worker execution state to Web workbench repositories. Worker job persistence should be usable later by:

- Web workbench local runtime;
- desktop local runtime;
- `apps/agent-worker`;
- future MCP execution;
- future deployment runner adapters.

`packages/db` should not own this worker job repository in this stage. `packages/db` remains focused on workbench product state such as projects, runs, messages, skills, approvals, handoffs, and tool observations.

## Repository Contract

Add this contract to `packages/worker-runtime`:

```ts
export interface WorkerJobRepository {
  save(record: WorkerJobRecord): Promise<void>;
  getById(id: string): Promise<WorkerJobRecord | undefined>;
  listForProject(projectId: string): Promise<WorkerJobRecord[]>;
  listAll(): Promise<WorkerJobRecord[]>;
  findOldestQueued(): Promise<WorkerJobRecord | undefined>;
}
```

Repository implementations must:

- defensively copy returned records;
- upsert records by `id`;
- order project and all-job lists by `createdAt`, then `id`;
- return the oldest queued job by the same order;
- never store raw execution payloads;
- never store raw env secret values.

## Runtime Refactor

`InMemoryWorkerRuntime` should keep the existing `WorkerRuntime` API:

```ts
export interface WorkerRuntime {
  enqueue(input: WorkerJobInput, policy?: SandboxPolicy): Promise<WorkerJobRecord>;
  runNext(): Promise<WorkerJobRecord | undefined>;
  getJob(id: string): Promise<WorkerJobRecord | undefined>;
  listJobsForProject(projectId: string): Promise<WorkerJobRecord[]>;
}
```

Its options should add an optional repository:

```ts
export interface InMemoryWorkerRuntimeOptions {
  adapter?: ExecutionAdapter;
  now?: () => Date;
  idPrefix?: string;
  repository?: WorkerJobRepository;
}
```

Default behavior should remain compatible:

- if no repository is supplied, use `InMemoryWorkerJobRepository`;
- if no adapter is supplied, use `RejectingExecutionAdapter`;
- if no policy is supplied, use `createRejectSandboxPolicy()`;
- if no id prefix is supplied, use `worker_job`.

The runtime should use the repository for `WorkerJobRecord` persistence, but keep a process-local map for execution payloads:

```ts
interface WorkerJobExecutionPayload {
  args: string[];
  env: Record<string, string>;
}
```

This payload is required for adapter execution but must not be persisted by `JsonFileWorkerJobRepository`.

## Restart Behavior

After process restart, JSON-file repositories can reload persisted `WorkerJobRecord` objects. They cannot reload volatile execution payloads.

The safe Stage 9 behavior is:

- completed, failed, rejected, and cancelled persisted jobs remain readable;
- queued jobs from a previous process remain readable;
- `runNext()` must not execute a queued job if its process-local execution payload is missing;
- missing payload should move that job to `failed` with stable `errorName: "worker_job_payload_unavailable"`;
- this failure should store a bounded/redacted result summary and completed timestamp.

This makes restart behavior explicit and observable without silently attempting unsafe replay.

## ID Generation

The current `worker_job_1`, `worker_job_2` behavior should continue.

For repository-backed runtimes, `enqueue()` should avoid ID collisions by scanning existing repository IDs with the configured prefix and allocating the next numeric suffix.

Example:

```text
existing: worker_job_1, worker_job_3
next:     worker_job_4
```

`enqueue()` should serialize ID allocation and save operations within a runtime instance so parallel enqueues in the same process do not produce duplicate IDs.

Cross-process ID collision prevention is not required in Stage 9. Future queue workers can replace this with database IDs, file locks, or atomic claim records.

## JSON File Repository

Add a JSON-file implementation in `@lp-agent/worker-runtime`, not `@lp-agent/db`.

Suggested shape:

```ts
export interface JsonFileWorkerJobRepositoryOptions {
  filePath: string;
}

export function createJsonFileWorkerJobRepository(
  options: JsonFileWorkerJobRepositoryOptions
): WorkerJobRepository;
```

Suggested on-disk state:

```json
{
  "workerJobs": []
}
```

The implementation should follow the existing `@lp-agent/db` JSON-file style:

- resolve the file path;
- read missing files as empty state;
- write using a temp file followed by rename;
- serialize writes per file path;
- return defensive copies;
- tolerate old JSON files with missing `workerJobs` by treating them as empty;
- sort list results deterministically.

It should not cache unsafe execution payloads or secret values in the JSON file.

## API Integration

`WorkerBackedToolCommandRunner` should not require a new public API in this stage.

The existing constructor already accepts a `WorkerRuntime`, so callers can build:

```ts
const runtime = new InMemoryWorkerRuntime({
  repository: createJsonFileWorkerJobRepository({ filePath }),
  adapter: new SimulatedExecutionAdapter()
});
```

Add focused API tests only if needed to prove the existing runner still works with a repository-backed runtime. Do not change `DemoWorkbenchService` defaults.

The default service behavior remains:

- API default `ToolCommandRunner` rejects command execution;
- Web workbench still uses its existing simulated runner;
- no real execution is enabled.

## Security Rules

Persisted worker job records may include:

- job id;
- project id;
- job kind;
- state;
- sandbox policy;
- input summary;
- bounded/redacted result summary;
- stable error name;
- timestamps.

Persisted worker job records must not include:

- raw env values;
- API keys;
- cookies;
- raw command args;
- raw artifact content;
- full stdout or stderr beyond configured byte limits;
- process-local payloads needed to execute commands.

If a future adapter needs durable payloads, that must be a separate spec with explicit encryption, retention, redaction, and approval design.

## Testing Strategy

### Repository Tests

Cover:

- `InMemoryWorkerJobRepository` saves, updates, lists, and returns defensive copies;
- `JsonFileWorkerJobRepository` persists records across repository instances;
- JSON-file repository handles missing files as empty state;
- JSON-file repository sorts jobs by `createdAt`, then `id`;
- JSON-file repository upserts by job id;
- JSON-file repository returns oldest queued job;
- JSON-file repository does not persist env secret values when given normal `WorkerJobRecord` objects.

### Runtime Tests

Cover:

- `InMemoryWorkerRuntime` works with the default in-memory repository;
- `InMemoryWorkerRuntime` works with an injected repository;
- `enqueue()` allocates the next id after existing persisted ids;
- parallel enqueues in one runtime instance allocate unique ids;
- `runNext()` reads the oldest queued record from the repository;
- completed/rejected/failed jobs are saved back to the repository;
- restarted runtime can read existing persisted records through `getJob()` and `listJobsForProject()`;
- restarted runtime fails queued jobs with `worker_job_payload_unavailable` instead of executing without payload.

### API Tests

Cover only the narrow integration risk:

- `WorkerBackedToolCommandRunner` can run against a repository-backed `InMemoryWorkerRuntime`;
- default API service behavior remains reject-only unless a runner is explicitly injected.

## Rollout

Stage 9 should be invisible to the Web UI unless a caller explicitly constructs a JSON-backed worker runtime.

No existing behavior should change for:

- static LP artifact generation;
- default API service command execution;
- Web simulated command loop;
- model routing;
- MCP registry;
- team collaboration primitives.

The safest initial rollout is:

1. implement repository contracts and tests in `packages/worker-runtime`;
2. refactor runtime internals to use the repository while preserving public API;
3. add JSON-file repository tests;
4. add one API compatibility test if the adapter needs coverage;
5. update learning docs.

## Future Work

After Stage 9:

1. Wire `apps/agent-worker` to poll or consume worker jobs.
2. Add a real cross-process queue or atomic claim mechanism.
3. Add Web timeline visibility for worker jobs.
4. Add retention and cleanup policies.
5. Add database-backed worker job persistence.
6. Add explicit retry, cancel, resume, and timeout handling.
7. Design durable execution payload storage only if a future use case requires it.
8. Add real execution adapters only after persistence, queue ownership, policy, and sandbox boundaries are separately reviewed.
