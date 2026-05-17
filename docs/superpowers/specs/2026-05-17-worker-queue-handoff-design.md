# Worker Queue Handoff v0 Design

## Purpose

Stage 11 introduces the first cross-process worker queue handoff for worker jobs.
The goal is to move from API-process-only worker execution toward a separate
`apps/agent-worker` process that can claim and complete safe worker jobs.

This stage is intentionally narrow. It only supports safe `simulate` and
`reject` execution payloads. It does not persist secrets, raw environment values,
artifact contents, or enough information to run real shell commands.

Stage 11 should make future Web interrupt wiring, streaming logs, retry/resume,
MCP execution, and real sandbox adapters easier to add, but it should not build
those features yet.

## Current Baseline

The project already has:

- `@lp-agent/worker-runtime` with worker job records, sandbox policies,
  deterministic execution adapters, in-memory and JSON-file worker job
  repositories, cancellation, and cooperative `ExecutionContext`.
- `WorkerBackedToolCommandRunner` in `@lp-agent/api`, available through explicit
  injection.
- `apps/agent-worker`, but today it only runs the old demo workbench flow. It
  does not claim worker jobs from a repository.
- Worker job records persisted safely, without raw args, raw env values, secrets,
  or artifact contents.
- Process-local execution payloads in `InMemoryWorkerRuntime`, which means a job
  queued in one process cannot currently be executed by another process.

The main gap is the handoff boundary: there is no persisted safe execution
payload, no cross-process claim operation, and no worker loop that can process
worker jobs from disk.

## Goals

1. Add a safe persisted worker payload model for deterministic `simulate` and
   `reject` jobs only.
2. Add a worker claim lifecycle that lets a separate worker process claim the
   oldest queued job.
3. Prevent stale or non-owning workers from completing jobs they did not claim.
4. Let `apps/agent-worker` run one worker job from a shared repository/payload
   store.
5. Preserve Stage 10 cancellation semantics for queued and running jobs.
6. Keep existing API synchronous worker runner behavior available.
7. Keep all real execution, secret handling, and deployment worker behavior out
   of scope.

## Non-Goals

Stage 11 does not build:

- Real shell execution, `child_process`, `spawn`, `exec`, or process signals.
- MCP execution.
- Web interrupt button wiring.
- Product-level run cancellation events.
- Streaming stdout/stderr.
- Retry, resume, stale worker lease recovery, or heartbeat renewal.
- Deployment skill execution through the external worker when secret env values
  are required.
- Secret manager integration.
- Docker, Firecracker, VM, chroot, or OS-level sandboxing.
- Multi-worker fairness guarantees beyond deterministic oldest-queued claiming.

## Architecture

Stage 11 should split the worker foundation into three distinct concerns:

1. **Worker job record**
   Durable state, policy, summaries, timestamps, cancellation metadata, and
   claim metadata. This remains safe to inspect and commit to JSON-file storage.

2. **Safe worker payload**
   A new persisted payload record that contains only the data needed for
   deterministic `simulate` or `reject` adapter execution. It must not contain
   raw env values, secrets, cookies, API keys, full artifacts, or real command
   execution material.

3. **Worker executor**
   A small `apps/agent-worker` entry point that can run one job by claiming it,
   loading the safe payload, executing the deterministic adapter, and saving the
   final worker job record.

The API process can enqueue a safe worker job. The worker process can later
claim and execute it using the same JSON-file repositories.

## Safe Persisted Payload

Add a worker payload repository owned by `packages/worker-runtime`, separate from
the existing worker job repository.

The v0 payload record should be explicit about its limited scope:

```ts
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
```

Payload safety rules:

- `args` may be persisted only for safe simulated jobs. They are still copied and
  bounded by tests, and Stage 11 must not use them for real execution.
- v0 should reject more than 100 args and should reject any single arg longer
  than 1024 characters.
- `envNames` may be persisted for policy validation and display.
- v0 should reject more than 100 env names and should persist only names, never
  values.
- raw env values are not persisted.
- secret values, artifact content, cookies, API keys, and real executable
  payloads are not persisted.
- queued jobs that require raw env values should continue using the existing
  process-local execution path, not the Stage 11 queue handoff.

Provide both in-memory and JSON-file payload repositories:

- `InMemoryWorkerJobPayloadRepository`
- `JsonFileWorkerJobPayloadRepository`

The JSON-file payload repository should use the same defensive-copy and
serialized-save style as `JsonFileWorkerJobRepository`.

## Claim Metadata

Extend `WorkerJobRecord` with worker claim metadata:

```ts
export interface WorkerJobRecord {
  // existing fields...
  claimedByWorkerId?: string;
  claimToken?: string;
}
```

`claimedByWorkerId` is an execution-process identifier, not a user identity.
It should be bounded to 120 characters and safe for persistence.

`claimToken` is a concurrency token generated when a worker claims a job. It is
not a secret, but it prevents stale workers from completing a job after another
claim or cancellation state transition has superseded them.

Stage 11 should not add user/actor fields to worker records.

## Queue Lifecycle

### Enqueue

The API or tests can enqueue a safe queued worker job by persisting:

- a `WorkerJobRecord` in state `queued`;
- a matching `WorkerJobPayloadRecord`.

If payload persistence fails, the job record must not be left queued without a
payload. Enqueue should either persist both or fail cleanly.

### Claim

Add a claim operation that is safe for JSON-file repositories:

```ts
export interface WorkerJobClaim {
  record: WorkerJobRecord;
  claimToken: string;
}

claimOldestQueued(input: {
  workerId: string;
  now: Date;
}): Promise<WorkerJobClaim | undefined>;
```

The claim operation should:

1. find the oldest queued job;
2. re-read and re-check it under repository serialization;
3. skip jobs that were cancelled or claimed by another worker;
4. set `state: "running"`;
5. set `startedAt`;
6. set `claimedByWorkerId`;
7. generate and persist `claimToken`;
8. return a defensive copy of the claimed record and claim token.

The v0 repository implementation can be JSON-file serialized rather than a
database-grade compare-and-swap. The important contract is that concurrent
workers in the same local JSON-file store do not both complete the same job.

### Execute

The worker process loads the safe payload by job id and executes through the
existing deterministic adapter boundary:

- policy validation should still reject `mode: "reject"` before adapter
  execution, matching existing runtime behavior;
- `SimulatedExecutionAdapter` for simulate policy.

If the payload is missing after claim, the job should fail closed with
`worker_job_payload_unavailable`, matching the existing safe restart behavior.

For v0 queued handoff, `ExecutionInput.env` should be an empty object because
raw env values are not persisted. `ExecutionInput.envNames` should come from the
safe payload record. Simulated/reject execution in this stage must not depend on
raw env values.

### Complete

Completion must require the claim token:

```ts
completeClaimedJob(input: {
  jobId: string;
  claimToken: string;
  result: ExecutionResult;
  now: Date;
}): Promise<WorkerJobRecord>;
```

If the current record no longer matches the claim token, completion must not
overwrite the record. It should return or throw a deterministic claim-conflict
error, such as `worker_job_claim_conflict`.

Cancelled adapter results should continue using Stage 10 finalization semantics:

- final `state: "cancelled"`;
- `completedAt`;
- `cancelledAt`;
- existing or generated `cancelRequestedAt`;
- preserved `cancelReason`;
- bounded/redacted result summary.

### Cancel

Stage 10 cancellation semantics remain:

- queued job cancellation settles immediately and deletes the safe payload after
  the cancelled record is persisted;
- running job cancellation records `cancelRequestedAt` and optional bounded
  `cancelReason`;
- the worker adapter observes cancellation through `ExecutionContext`;
- if an adapter ignores cancellation and completes normally, runtime honors the
  adapter result and preserves cancellation request metadata.

## Agent Worker App

`apps/agent-worker` should stop being only a demo workbench runner and gain a
worker-job entry point.

The first API should be small and testable:

```ts
export interface RunWorkerOnceInput {
  workerId: string;
  jobRepository: WorkerJobRepository;
  payloadRepository: WorkerJobPayloadRepository;
  adapter?: ExecutionAdapter;
  now?: () => Date;
}

export async function runWorkerOnce(
  input: RunWorkerOnceInput
): Promise<WorkerJobRecord | undefined>;
```

`runWorkerOnce()` should:

1. claim the oldest queued job;
2. load its safe payload;
3. validate policy;
4. execute the adapter with an `ExecutionContext`;
5. save the final record through the claim-token completion path;
6. return the completed worker job record.

CLI behavior can remain minimal:

- support a local JSON-file path via environment variable or function input;
- run one job and print a small JSON summary;
- no daemon mode, polling loop, or background supervisor in Stage 11.

## API Boundary

Stage 11 should not force Web or deployment skill commands onto the external
worker path. Existing `WorkerBackedToolCommandRunner` can remain synchronous.

If the API package needs an enqueue helper for tests or future Web wiring, it
should expose it behind a safe name and constraints, such as
`enqueueSafeSimulatedWorkerCommand()`. That helper must reject inputs with raw env
values that would need secret persistence.

Deployment skills with secret env values stay on the existing controlled runner
path until a later secretRef-based payload design exists.

## Security

Stage 11 makes queue handoff possible without increasing execution power.

Safety rules:

- no raw env values in persisted queue payloads;
- no secret values in worker job records or payloads;
- no artifact content in worker payloads;
- no arbitrary command execution;
- no real shell adapter;
- no network enablement;
- sandbox policy still defaults to reject;
- simulate mode remains deterministic and test-only.

If a job cannot be represented safely as a Stage 11 payload, it should fail
closed or remain on the existing in-process path.

## Testing

Worker runtime tests should cover:

- safe payload repository defensive copies;
- JSON-file payload repository persistence and reload;
- enqueue fails cleanly when payload persistence fails;
- claiming oldest queued job sets running state and claim metadata;
- concurrent claim attempts do not both claim the same job;
- stale claim token cannot complete a job;
- missing payload after claim fails closed;
- queued cancellation deletes safe payload only after cancelled record
  persistence succeeds;
- running cooperative cancellation still works after claim handoff.

Agent worker tests should cover:

- `runWorkerOnce()` returns `undefined` when no queued job exists;
- `runWorkerOnce()` claims and completes a safe simulated job;
- `runWorkerOnce()` maps adapter failure to failed worker job;
- `runWorkerOnce()` preserves cancellation metadata when adapter returns
  cancelled;
- JSON-file job repository plus JSON-file payload repository works across two
  process-like runtime instances.

API tests should cover only the safe helper or runner path added in this stage.
They should not require Web UI changes.

## Compatibility

Existing behavior should remain unchanged unless code explicitly opts into the
new queue handoff:

- existing deterministic Web flows remain deterministic;
- existing API `WorkerBackedToolCommandRunner` tests keep passing;
- existing Stage 10 cancellation tests keep passing;
- JSON worker job records without claim fields keep loading;
- Web UI continues not to wire real interrupt behavior.

## Future Work

After Stage 11, good next slices are:

1. Web/API interrupt wiring that calls cancellation for jobs attached to a task.
2. Product-level run cancellation events and timeline display.
3. SecretRef-based persisted command payloads for deployment skills.
4. Streaming log/event append from worker to API/Web.
5. Retry/resume, worker heartbeat, stale claim recovery, and queue leases.
6. Real sandbox adapter design for local command execution.

## Acceptance Criteria

Stage 11 is complete when:

- a safe worker job can be enqueued in one process-like runtime and executed by
  `apps/agent-worker` using shared repositories;
- safe payloads persist and reload without raw env values or secrets;
- claim metadata prevents duplicate completion by stale workers;
- queued and running cancellation semantics from Stage 10 still pass;
- existing Web/API behavior remains unchanged unless tests explicitly opt into
  queue handoff;
- no real shell, MCP execution, Web interrupt wiring, streaming logs, or
  deployment worker behavior is introduced.
