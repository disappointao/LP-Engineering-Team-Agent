# Web/API Interrupt Wiring v0 Design

## Purpose

Stage 12 wires the first product-facing interrupt path from the Web workbench to
the existing API and worker cancellation foundation.

The goal is intentionally narrow: the user can stop the current conversation task
from the composer area, the UI immediately reflects a stopping state, and the API
records a durable interrupt request that can cancel or mark the task's active
cancellable work.

This stage should make Manus-style "stop generating" behavior real enough for
the local MVP without pretending that the project already has real process
control, streaming logs, MCP execution, or a long-running worker daemon.

## Current Baseline

The project already has:

- A conversation-first Next.js Web workbench with a fixed sidebar, task threads,
  a composer dock, and an interrupt-looking button.
- `submitPromptAction()` and `WebWorkbenchStore.submitTaskPrompt()` for creating
  current task threads.
- `RunRecordState` with `cancelled` in `packages/db`.
- `RunEventRecord` and Web timeline rendering for tool/process events.
- Stage 10 worker cancellation:
  - queued jobs can settle to `cancelled`;
  - running jobs record `cancelRequestedAt` and use cooperative adapter
    cancellation.
- Stage 11 worker queue handoff:
  - safe queued worker payloads;
  - claim-token based worker completion;
  - `apps/agent-worker` can run one safe worker job.
- `WorkerBackedToolCommandRunner` can map a cancelled worker job to a cancelled
  command result.

The current gaps are:

- Web interrupt is only a visual affordance.
- There is no server action for interrupting the current task.
- Web task records do not expose whether a task is interruptible or stopping.
- Current task threads do not have a structured link to active worker jobs or
  active run records.
- Skill command service still maps cancelled command results as failed service
  runs, so product-level cancellation is not yet visible as a first-class Web
  timeline state.

## Decisions Already Confirmed

For this stage:

- Scope is current conversation task only.
- The Web action is a current task interrupt/stop button, not bulk cancellation.
- The UI should be optimistic: clicking stop immediately shows a stopping state.
- Deployment remains out of scope.
- Real shell execution, MCP execution, streaming logs, worker daemon control, and
  OS process signals remain out of scope.

## Goals

1. Add a Web/API interrupt action for the current task.
2. Make the composer stop button functional only when the current task has an
   interruptible target.
3. Show an immediate optimistic stopping state after the user clicks stop.
4. Add a small API/store contract for interrupting a task.
5. Persist durable task/run interrupt events so refresh does not lose the fact
   that the user requested a stop.
6. Route task interruption to active worker jobs when a task has a known worker
   job target.
7. Represent cancelled task/run/tool states in the chat timeline without
   treating user-initiated cancellation as a generic failure.
8. Keep all behavior deterministic and testable with simulated/deferred worker
   targets.

## Non-Goals

Stage 12 does not build:

- Real shell execution, `child_process`, `spawn`, `exec`, or OS signals.
- Force-killing running processes.
- MCP execution.
- Streaming stdout/stderr or live token streaming.
- Worker daemon polling or worker lifecycle controls from Web.
- Bulk cancellation across tasks or projects.
- Deployment execution.
- Retry/resume after cancellation.
- Authz rules beyond the existing local user identity.
- Multi-user realtime cancellation conflict handling.
- A full task scheduler.

## User Experience

When the user is in the workbench view:

- If there is no active task or the active task is terminal, the interrupt button
  is disabled or hidden.
- If the active task has an interruptible target, the button is enabled.
- On click, the UI immediately changes the button label/state to a stopping
  state and prevents duplicate interrupt submits.
- After the server action returns, the task thread refreshes and the timeline
  shows the durable interrupt event.

Recommended copy:

- idle enabled: existing `Interrupt` / `打断`;
- optimistic pending: `Stopping...` / `正在停止...`;
- terminal cancelled event: `Task interrupted` / `任务已打断`;
- no active interrupt target: `Nothing running` / `当前没有可打断任务`;
- failure: `Unable to interrupt this task` / `无法打断当前任务`.

The optimistic state is UI-only. The durable state still comes from the
repository after the server action finishes.

## API Contract

Add a Web store method:

```ts
export type InterruptTaskResult =
  | {
      ok: true;
      taskId: string;
      state: "interrupt_requested" | "cancelled" | "not_interruptible";
      runId?: string;
      workerJobId?: string;
    }
  | {
      ok: false;
      error:
        | "task_not_found"
        | "task_not_interruptible"
        | "interrupt_target_not_found"
        | "interrupt_failed";
    };

export interface WebWorkbenchStore {
  interruptCurrentTask(input: {
    taskId: string;
    reason?: string;
  }): Promise<InterruptTaskResult>;
}
```

`apps/web/src/app/actions.ts` should add a server action that:

1. reads the current task id from the existing session cookie;
2. calls `store.interruptCurrentTask({ taskId, reason: "User interrupted the task." })`;
3. revalidates the workbench path;
4. redirects back to the current task view with a bounded error query parameter
   only when the interrupt request fails.

The server action should not accept arbitrary worker job ids from the client.
The client only says "interrupt the current task"; the API decides what target
belongs to that task.

## Task Interrupt State

Add a small task-level interrupt view to `WorkbenchPageState.task_ready`:

```ts
export interface TaskInterruptView {
  available: boolean;
  state: "idle" | "stopping" | "cancelled" | "not_interruptible";
  runId?: string;
  workerJobId?: string;
  requestedAt?: string;
}
```

This view is derived from repository state, not from client state:

- `idle`: there is an active cancellable target and no interrupt request yet.
- `stopping`: an interrupt was requested but the target has not settled.
- `cancelled`: the active target settled as cancelled.
- `not_interruptible`: no active cancellable target exists.

For v0, the task record does not need to become a full scheduler state machine.
Avoid expanding `WorkbenchTaskStatus` unless implementation proves that the
timeline and interrupt view cannot represent the required states cleanly.

## Task to Worker Target Mapping

Stage 12 needs a minimal durable association between a task/run and a worker job.
The recommended v0 approach is to store this association in API-owned run events
rather than introducing a large scheduler table.

When code starts cancellable worker-backed work for a task, it should emit a run
event with a safe payload:

```ts
{
  type: "worker.job.linked",
  message: "Worker job linked to task.",
  payload: {
    taskId: "task_...",
    runId: "run_...",
    workerJobId: "worker_job_..."
  }
}
```

The interrupt service can derive the current interrupt target by scanning the
active task's current project run events for the latest linked worker job that is
not terminal.

This keeps v0 small and compatible with the current repository style. A future
Postgres implementation can normalize the same relationship into a dedicated
table without changing the Web contract.

## Cancellation Flow

### No Active Target

If the current task has no active linked run or worker job:

1. return `ok: true` with `state: "not_interruptible"` so stale UI clicks are
   safe and idempotent;
2. do not mutate terminal task state;
3. emit no event, to avoid timeline noise.

The UI should normally prevent this state by disabling or hiding the button.

### Queued Worker Job

If the task's worker job is still queued:

1. emit `task.interrupt.requested`;
2. call `WorkerRuntime.cancelJob(workerJobId, reason)`;
3. if the worker returns `cancelled`, emit `task.interrupt.cancelled`;
4. mark the corresponding run as `cancelled` when a run record exists;
5. refresh the thread so the timeline shows cancellation as a normal terminal
   outcome, not a generic failure.

### Running Worker Job

If the task's worker job is running:

1. emit `task.interrupt.requested`;
2. call `WorkerRuntime.cancelJob(workerJobId, reason)`;
3. leave the task in `stopping` while the worker remains running;
4. rely on the worker adapter's cooperative cancellation context to settle as
   `cancelled`;
5. if the adapter ignores cancellation and completes, preserve the interrupt
   request event and show the final worker result truthfully.

The UI must not claim the task stopped until the repository confirms a terminal
state.

### Terminal Worker Job

If the linked worker job already completed, failed, rejected, or cancelled:

1. do not revive or overwrite it;
2. return the current terminal state;
3. let the page model derive `cancelled` only when the terminal state is actually
   cancelled.

## Run and Timeline Events

Use bounded, safe event payloads. Do not store raw command args, env values,
secret values, artifact content, or model outputs in interrupt events.

Recommended event types:

- `task.interrupt.requested`
- `task.interrupt.cancelled`
- `worker.job.linked`

`task.interrupt.not_interruptible` is reserved for later diagnostics, not for
normal stale-button clicks in v0.

The chat timeline should render cancellation separately from failure:

- cancelled tool events should use a neutral/stopped visual state;
- failed tool events should keep the existing error visual state;
- an interrupt request while a task is still running should appear as an
  in-progress/stopping process row.

`ChatToolStatus` can expand from `"complete" | "failed"` to include
`"running" | "cancelled"` if the rendering layer needs explicit states.

## Error Handling

Error handling should be conservative:

- Missing task id from session: redirect with `task_not_found`.
- Missing task record: return `task_not_found`.
- No active target from a stale UI click: return `ok: true` with
  `state: "not_interruptible"`.
- Linked worker job missing from worker runtime: return
  `interrupt_target_not_found` without exposing the missing worker id to the
  client.
- Worker runtime throws: return `interrupt_failed` and do not mutate unrelated
  task state.

All user-facing errors should use bounded query parameters and localized copy.

## Testing Strategy

Add tests before implementation code.

API/store tests should cover:

- interrupting a task with a queued worker job cancels it and emits durable
  cancellation events;
- interrupting a task with a running deferred worker job records
  `cancelRequestedAt` and exposes `stopping`;
- terminal worker jobs are not mutated by stale interrupt requests;
- missing task and missing target errors are deterministic;
- cancelled command/run outcomes render as cancelled, not failed.

Web action/UI tests should cover:

- server action reads the current task id and never trusts a client-supplied
  worker job id;
- interrupt button is disabled/hidden when no target is available;
- clicking an enabled button immediately shows the optimistic stopping state;
- duplicate clicks are prevented while the form is pending;
- localized Chinese and English copy is available.

Run full workspace verification after implementation:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

## Future Work

Future stages can build on this contract to add:

- streaming run output and live timeline refresh;
- worker daemon lifecycle and polling controls;
- real shell sandbox adapters and process-signal cancellation;
- MCP execution cancellation;
- deployment skill worker execution;
- normalized Postgres task/run/worker link tables;
- multi-user authorization and realtime interrupt presence;
- retry/resume semantics after cancellation.
