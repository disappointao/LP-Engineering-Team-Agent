# Web Worker Queue Integration v0 Design

## Purpose

Stage 13 connects the existing Web skill command loop to the worker queue
foundation.

The goal is to move deployment skill command execution from a Web-process
simulation into a local, observable queue flow:

1. the Web/API layer validates and enqueues a safe worker job;
2. the user can run one local worker pass from the Web workbench;
3. the worker claims and completes one queued safe job;
4. the Web timeline shows queued, linked, running, completed, failed, or
   cancelled states.

This stage is still safety-first. It does not add a worker daemon, real shell
execution, MCP execution, real deployment, streaming logs, or a strong OS
sandbox. It only makes the queue handoff visible and usable from the Web MVP.

## Current Baseline

The project already has:

- A Web Skills view that discovers published, bound deployment skill commands
  and runs them through `executeSkillCommandAction()`.
- `DemoWorkbenchService.executeProjectSkillCommand()`, which validates skill
  command scope, publication state, binding state, permission, approval,
  templates, page version ownership, and then runs a `ToolCommandRunner`.
- `ToolObservationRecord` and sanitized `tool.started`, `tool.completed`, and
  `tool.failed` run events.
- `WorkerBackedToolCommandRunner`, which can execute command jobs through an
  injected `WorkerRuntime` inside the same process.
- `@lp-agent/worker-runtime` with:
  - safe persisted worker payloads for deterministic simulated jobs;
  - JSON-file worker job and payload repositories;
  - claim-token based `claimOldestQueued()` and `runClaimedJob()`;
  - queued and cooperative running-job cancellation.
- `apps/agent-worker` with `runWorkerOnce()`, which claims and runs one safe
  queued worker job from injected repositories.
- Stage 12 task interrupt wiring, which can derive task/run/worker links from
  safe run events and call worker cancellation.

The main gap is product wiring:

- Web skill command execution still defaults to a local simulated runner.
- There is no Web-visible queue state for a skill command job.
- There is no Web action for running one local worker pass.
- Worker job completion does not yet finalize the corresponding tool
  observation and run events created by the Web/API command request.
- Stage 12 interrupt can cancel linked worker jobs, but skill command runs do
  not yet create a Web queue target through the shared worker repositories.

## Decisions Already Confirmed

For this stage:

- Start from the existing deployment skill command Web loop.
- The user clicks a skill command in Web to enqueue work; the command should not
  synchronously execute in the Web request.
- Add a Web control for `Run local worker once`.
- Keep execution deterministic and local.
- Only support safe persisted simulated worker payloads in v0.
- Do not make deployment automatic.

## Goals

1. Add a Web/API queue mode for approved deployment skill commands.
2. Persist a safe worker job and safe worker payload for queueable simulated
   commands.
3. Emit a durable `worker.job.linked` event connecting the skill command run to
   the worker job.
4. Return from the Web command action after enqueueing, with the timeline showing
   a queued/running process rather than a completed simulation.
5. Add a Web action and button for running one local worker pass.
6. Let `apps/agent-worker`/worker runtime completion drive final run and tool
   observation state.
7. Reuse Stage 12 interrupt for queued or running linked worker jobs.
8. Keep the implementation compatible with future daemon workers, streaming
   logs, MCP execution, and stronger sandbox adapters.

## Non-Goals

Stage 13 does not build:

- worker daemon polling;
- background processes started by the Web server;
- real shell execution, `child_process`, `spawn`, `exec`, shell parsing, OS
  signals, or process killing;
- MCP execution;
- real deployment adapters;
- secret manager integration;
- streaming stdout/stderr or token streaming;
- retry/resume controls;
- worker heartbeat, lease renewal, or stale worker recovery;
- multi-worker scheduling beyond existing oldest-queued claim semantics;
- durable raw env values, secret values, cookies, API keys, or full artifact
  content in worker payloads;
- artifact workspace replay in the worker process.

## User Experience

In the Skills view:

- Each queueable deployment skill command keeps its one-shot approval form.
- The command action label should change from simulation-focused copy to queue
  copy, for example:
  - English: `Approve and queue`
  - Chinese: `批准并入队`
- After enqueueing, the page returns to the Skills view and the chat timeline
  shows that a deployment skill command was queued.
- A local worker panel appears in the Skills view or tool process area:
  - English: `Run local worker once`
  - Chinese: `运行一次本地 Worker`
- Clicking the worker button runs at most one safe queued job and refreshes the
  page.
- If no queued worker job exists, the action should be a safe no-op with a small
  localized status or disabled state.
- If the user clicks the Stage 12 interrupt button while the current task has a
  linked queued/running worker job, cancellation should go through the existing
  task interrupt path.

The first version can use page refresh after each action. It does not need
realtime updates.

## Queueable Skill Command Rules

Only a narrow subset of deployment skill commands is queueable in this stage.

A command is queueable when:

- the skill version is published and bound to the project;
- the command is a deployment command and permission is allowed;
- required approval is supplied by the current local user identity;
- all templates resolve without unknown variables;
- resolved args and env names satisfy the safe payload bounds already enforced
  by `@lp-agent/worker-runtime`;
- the command does not require raw secret values in the worker payload;
- the command does not require an artifact workspace path that would disappear
  after the Web request.

For v0, queue mode should prefer commands like the existing simulated
`static-deploy --project {{projectId}}` path. Commands that require artifact
files, secret env values, or real deployment behavior should fail closed with a
stable skill command error instead of silently falling back to synchronous Web
execution.

This preserves the future extension path:

- Stage 13 proves queue visibility and worker handoff.
- A later file workspace stage can make artifact files durable and pass file
  manifests to workers.
- A later secret manager stage can pass secret references to a trusted runtime
  without persisting raw values.
- A later real sandbox stage can run actual commands.

## API Contract

Add an API-owned queue operation around deployment skill commands. It can be a
new method or an explicit mode on the existing service method, but the behavior
must be clear:

```ts
export type SkillCommandExecutionMode = "sync" | "queued";

export interface QueuedSkillCommandExecutionResult {
  run: RunRecord;
  observation: ToolObservationRecord;
  workerJobId: string;
}
```

The queued path should:

1. reuse the existing skill command validation;
2. reserve the run and observation ids;
3. save the run in `running` state;
4. extend the observation state model to support `running` and `cancelled`,
   then save the initial observation in `running` state;
5. emit `run.started`;
6. emit `tool.started`;
7. enqueue a safe worker job through an injected worker runtime/repository
   boundary;
8. emit `worker.job.linked` with only safe ids:

```ts
{
  taskId: "task_...",
  runId: "run_skill_command_...",
  workerJobId: "worker_job_..."
}
```

The Web action must not accept a worker job id from the browser.

## Worker Completion Finalization

Stage 13 needs a focused finalizer that can translate a completed worker job
back into existing run and observation records.

The finalizer should:

1. find the `worker.job.linked` event for the completed worker job;
2. load the matching run and observation;
3. derive a sanitized command result from the worker job `resultSummary`;
4. emit one terminal tool event:
   - `tool.completed` for completed jobs;
   - `tool.failed` for failed/rejected jobs;
   - `tool.cancelled` for cancelled jobs;
5. emit one terminal run event:
   - `run.completed`;
   - `run.failed`;
   - `run.cancelled`;
6. save the run state as `completed`, `failed`, or `cancelled`;
7. save the tool observation state consistently with the run state.

The finalizer must be idempotent. If a terminal run event already exists for the
run, repeated worker passes or page refreshes should not duplicate terminal
events or overwrite terminal state with stale data.

## Web Store Contract

Extend the Web store with one local worker action:

```ts
export type RunLocalWorkerOnceResult =
  | {
      ok: true;
      state: "completed" | "failed" | "rejected" | "cancelled" | "idle";
      workerJobId?: string;
      runId?: string;
    }
  | {
      ok: false;
      error:
        | "worker_runtime_not_configured"
        | "worker_job_execution_failed"
        | "worker_job_finalization_failed";
    };

export interface WebWorkbenchStore {
  runLocalWorkerOnce(input?: { projectId?: string }): Promise<RunLocalWorkerOnceResult>;
}
```

The default Web store can still use deterministic in-memory/JSON-file local
repositories. The important boundary is that the worker runtime and worker
repositories are injected, not hidden inside page components.

## Repository and Runtime Configuration

Stage 13 should introduce a small Web-local worker queue factory or helper that
uses JSON-file worker repositories in local development.

The configuration should be explicit and portable, for example:

- `WORKER_JOBS_FILE`
- `WORKER_PAYLOADS_FILE`
- optional `WORKER_ID`

The same paths should be usable by:

- the Next.js Web store when enqueueing safe jobs;
- `apps/agent-worker` when running one job from CLI;
- the Web `Run local worker once` action when invoking `runWorkerOnce()`
  in-process for the local MVP.

The env names should not contain provider-specific or deployment-specific
assumptions.

## Timeline Rendering

The chat timeline should distinguish:

- started command;
- linked worker job;
- queued/running worker job;
- completed command;
- failed/rejected command;
- cancelled command.

If existing `ChatToolStatus` already has `running`, `cancelled`, and `failed`,
Stage 13 should reuse those statuses rather than adding a separate visual system.

The UI must continue showing sanitized metadata only:

- command id;
- worker job id;
- run id;
- state;
- exit code when available;
- bounded output summary when available;
- sanitized error name.

It must not show raw stdout/stderr, secret values, full artifacts, raw env
values, or local filesystem paths that are not intentionally safe.

## Interrupt Compatibility

The queued skill command flow should emit `worker.job.linked` before returning
from the Web action. This lets the Stage 12 interrupt helper derive the active
worker target.

Expected behavior:

- queued job + interrupt => worker job becomes `cancelled`, run finalizer records
  cancellation;
- running job + interrupt => worker job records `cancelRequestedAt`; if the
  simulated adapter returns cancelled, finalizer records cancellation;
- completed/failed job + stale interrupt click => safe not-interruptible result.

The client still only says "interrupt current task"; it never submits a worker
job id.

## Error Handling

Stable Web errors should be added only where needed:

- command is not queueable in v0;
- worker runtime/repositories are not configured;
- worker job could not be enqueued;
- worker execution failed before a job result was persisted;
- worker result finalization failed.

All errors should be bounded and localizable. Raw exception messages should not
be exposed to the page.

## Testing

Implementation should include tests for:

- queueable skill command creates run, observation, safe worker job, safe payload,
  and `worker.job.linked`;
- Web command action redirects after enqueueing without completing the run;
- local worker action runs exactly one queued job;
- worker completion finalizer emits terminal tool/run events and updates
  observation/run state;
- finalizer is idempotent;
- no raw env values, secret values, or artifact content are persisted in worker
  payloads or timeline events;
- non-queueable commands fail closed;
- cancelled queued worker jobs finalize as cancelled rather than generic failed;
- stale worker completion cannot overwrite terminal state;
- existing default deterministic tests continue to pass.

## Future Extension Path

This stage is designed to support later work without rewriting the API:

- worker daemon: replace the Web button with a long-running worker process;
- streaming logs: add event streaming from worker observations without changing
  enqueue/finalize contracts;
- MCP execution: reuse worker job, observation, approval, and finalizer
  contracts for MCP tools;
- real shell sandbox: add a stronger adapter behind the same worker runtime
  boundary;
- durable artifact workspace: pass file manifests and workspace ids instead of
  raw artifact content;
- secret manager: pass secret references to trusted runtimes without persisting
  secret values;
- deployment adapters: replace the simulated deployment command with real
  deployment execution after approvals, sandboxing, and secret handling are
  ready.
