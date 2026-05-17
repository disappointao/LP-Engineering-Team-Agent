# Worker Sandbox Runtime Foundation Design

## Purpose

Stage 8 adds the first worker and sandbox runtime foundation for LP Engineering Team Agent. The goal is to define a safe, replaceable execution boundary for future command runners, MCP execution, deployment workflows, and file operations without opening real shell execution in this slice.

This stage is contract-first. It should make execution policy, worker job state, result summaries, and adapter boundaries explicit so later stages can add persistence, queues, local process execution, stronger sandbox adapters, and MCP tools without rewriting the API service or Web action surfaces.

## Current Baseline

The project already has:

- `ToolCommandRunner` in `packages/api`, used by deployment skill command execution.
- `RejectingToolCommandRunner` as the safe default.
- `SimulatedToolCommandRunner` in `apps/web` for Web command-loop demos.
- `ToolObservationRecord`, run records, and sanitized `tool.started` / `tool.completed` / `tool.failed` run events.
- Static artifact command workspace materialization for generated LP page versions.
- `apps/agent-worker`, currently a deterministic demo worker flow, not a real job executor.

The current gap is that `ToolCommandRunner` is an adapter boundary, but there is no shared worker runtime contract behind it. There is also no explicit sandbox policy model that can be reused by future MCP execution, deployment runners, or file-operation tools.

## Goals

1. Create a new `packages/worker-runtime` package for worker/sandbox contracts and deterministic in-memory behavior.
2. Define a minimal worker job state machine that can model queued, running, completed, failed, rejected, and cancelled jobs.
3. Define a `SandboxPolicy` that describes what is allowed before any adapter runs.
4. Define an `ExecutionAdapter` boundary that can reject or simulate execution in v0.
5. Provide an in-memory worker runtime and repository for deterministic tests.
6. Add an API-side `WorkerBackedToolCommandRunner` adapter that maps existing `ToolCommandRunner` calls into the worker runtime.
7. Keep all existing Web behavior stable and keep real shell execution disabled by default.

## Non-Goals

This stage does not build:

- Real shell execution, `child_process`, `spawn`, or arbitrary command execution.
- OS-level sandboxing through Docker, Firecracker, macOS sandbox-exec, chroot, containers, or VMs.
- MCP execution.
- Web UI for worker jobs, sandbox policy, or runner selection.
- JSON-file or database persistence for worker jobs.
- Cross-process queues, long-running workers, polling, streaming logs, retry, resume, or cancel behavior.
- Deployment automation beyond the existing skill command simulation path.
- Changes to generated LP artifact format. LP output remains framework-free static HTML/CSS/JS.

## Architecture

Stage 8 introduces a new reusable package:

```text
packages/worker-runtime
  -> WorkerJob contracts
  -> SandboxPolicy contracts
  -> ExecutionAdapter contracts
  -> InMemoryWorkerRuntime
  -> RejectingExecutionAdapter
  -> SimulatedExecutionAdapter
```

The API integration remains narrow:

```text
API Skill Command
  -> ToolCommandRunner
    -> WorkerBackedToolCommandRunner
      -> WorkerRuntime.enqueue()
      -> WorkerRuntime.runNext()
        -> SandboxPolicy check
        -> ExecutionAdapter
```

The default API service should continue using `RejectingToolCommandRunner` unless a caller explicitly injects another runner. The Web store should continue using the current `SimulatedToolCommandRunner`; Stage 8 does not replace the Web command loop.

## Worker Job Model

Worker runtime v0 should support one job kind:

```ts
type WorkerJobKind = "tool_command";
```

Worker job state:

```ts
type WorkerJobState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "rejected"
  | "cancelled";
```

Worker job record shape:

```ts
interface WorkerJobRecord {
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
```

Records should be defensively copied by the in-memory repository, matching the repository style already used in `@lp-agent/db`.

## Sandbox Policy

`SandboxPolicy` is a product/runtime policy object, not an OS sandbox guarantee.

Suggested v0 shape:

```ts
interface SandboxPolicy {
  mode: "reject" | "simulate";
  allowedCommands: string[];
  workingDirectoryRoot?: string;
  timeoutMs: number;
  allowedEnvNames: string[];
  maxStdoutBytes: number;
  maxStderrBytes: number;
  network: "disabled";
}
```

Policy rules:

- Default mode is `reject`.
- `network` is always `disabled` in v0.
- A command not listed in `allowedCommands` is rejected before adapter execution.
- Environment variables outside `allowedEnvNames` are rejected before adapter execution.
- If a working directory is provided, it must resolve inside `workingDirectoryRoot`.
- Output summaries must be bounded by `maxStdoutBytes` and `maxStderrBytes`.
- Secret values must never be stored in worker job records. Store env names and summaries only.

## Execution Adapter

The execution adapter is the boundary where future real execution will plug in:

```ts
interface ExecutionAdapter {
  execute(input: ExecutionInput, policy: SandboxPolicy): Promise<ExecutionResult>;
}
```

Stage 8 should provide only deterministic adapters:

- `RejectingExecutionAdapter`: always returns a rejected or failed result without running anything.
- `SimulatedExecutionAdapter`: returns deterministic completed/failed output based on input, with bounded summaries.

There must be no `child_process`, shell parsing, command separators, pipes, redirects, heredocs, or user-supplied shell lines in this stage.

## Runtime Flow

```text
enqueue(input, policy)
  -> create WorkerJobRecord(state: queued)

runNext()
  -> get oldest queued job
  -> policy check
    -> rejected if command/env/cwd fails policy
  -> state: running
  -> adapter.execute(input, policy)
    -> completed if adapter succeeds
    -> failed if adapter returns failed or throws
```

`cancelled` is a reserved state in v0. It should be part of the type contract, but Stage 8 does not need real cancellation behavior.

## API Integration

Add a small `WorkerBackedToolCommandRunner` in `packages/api`:

- Implements existing `ToolCommandRunner`.
- Accepts a `WorkerRuntime` instance and a `SandboxPolicy` resolver.
- Converts `ToolCommandRunInput` to `WorkerJobInput`.
- Calls `runtime.enqueue()` and `runtime.runNext()` synchronously for v0.
- Converts worker result summary back to `ToolCommandRunResult`.

This keeps `DemoWorkbenchService.executeProjectSkillCommand()` unchanged except for tests that explicitly inject the new runner.

The default `DemoWorkbenchService` behavior must remain safe:

- No real execution without explicit runner injection.
- Existing tests should continue passing.
- Web command loop should remain deterministic.

## Security And Safety Rules

- Local worker runtime is not a production sandbox.
- A sandbox policy reject is a normal, observable job outcome.
- Do not store raw stdout/stderr, secrets, API keys, cookies, or full artifact content in worker job records.
- Do not accept arbitrary user command lines.
- Commands remain executable identifiers plus pre-resolved argv/env from existing skill command validation.
- Any future real execution adapter must be opt-in and must pass the same contract tests.

## Testing Strategy

### Worker Runtime Tests

Cover:

- enqueue creates `queued` jobs in deterministic order;
- `runNext()` returns `undefined` when no queued job exists;
- reject policy creates a `rejected` job without invoking the adapter;
- simulate policy creates `completed` jobs with bounded summaries;
- adapter failure creates `failed` jobs;
- env name policy rejects unexpected env names;
- working directory policy rejects paths outside the allowed root;
- repositories return defensive copies;
- `listJobsForProject(projectId)` is project-scoped and ordered.

### API Tests

Cover:

- `WorkerBackedToolCommandRunner` maps completed worker results to `ToolCommandRunResult`;
- rejected jobs map to failed tool command results with stable `errorName`;
- failed adapter jobs map to failed tool command results;
- existing deployment skill command execution can use worker-backed runner when explicitly injected;
- default service still rejects execution when no runner is configured.

### Documentation Tests / Checks

No special docs test is required, but implementation must update:

- `docs/agent-development-learning.md`;
- `docs/superpowers/README.md`;
- implementation plan under `docs/superpowers/plans/`.

## Rollout

Stage 8 should land behind explicit code-level injection only. Existing Web, API, and deterministic tests should behave the same unless they intentionally construct a worker-backed runner.

The first implementation should prefer small files:

- `packages/worker-runtime/src/index.ts`;
- `packages/worker-runtime/src/index.test.ts`;
- `packages/api/src/worker-backed-tool-command-runner.ts`;
- focused API tests.

If those files grow too large, split policy validation and in-memory repository helpers inside `packages/worker-runtime`.

## Future Work

After this foundation is stable:

1. Add JSON-file or database-backed worker job persistence.
2. Move execution to `apps/agent-worker` with an explicit job queue.
3. Add true timeout enforcement for long-running adapters.
4. Add local restricted command execution as an opt-in development adapter.
5. Add stronger sandbox adapters such as Docker, Firecracker, or platform-specific isolation.
6. Add MCP execution on top of the same worker job and observation model.
7. Add retry, resume, cancel, and streaming logs.
8. Add Web timeline visibility for worker job policy, adapter type, and rejection reasons.
