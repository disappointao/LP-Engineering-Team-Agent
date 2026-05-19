# Agent Run Lifecycle Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repository-derived run lifecycle / recovery view and make worker-backed skill command finalization safely repeatable.

**Architecture:** Add a focused `packages/api/src/run-lifecycle.ts` helper that reads existing run records, ordered run events, handoffs, tool observations, and optional worker runtime state. Keep `RunRecord` as the persisted fact and expose `RunLifecycleView` as a derived view. Strengthen `finalizeWorkerBackedSkillCommand()` only where it already reconciles worker terminal state back into run/tool state.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, `@lp-agent/db`, `@lp-agent/worker-runtime`, existing API repository contracts.

---

## File Structure

- Create: `packages/api/src/run-lifecycle.ts`
  - Owns `RunLifecycleState`, `RunDiagnosticSummary`, `RunRecoveryAction`, `RunLifecycleView`, `deriveRunLifecycleView()`, and `listRunLifecycleViewsForTask()`.
  - Reads repositories and optional `WorkerRuntime.getJob()` only; no writes.
- Create: `packages/api/src/run-lifecycle.test.ts`
  - Covers run state derivation, diagnostic safety, worker/handoff state, missing worker state, terminal conflicts, and task-level listing.
- Modify: `packages/api/src/skill-command-worker-queue.ts`
  - Tightens finalizer conflict handling and repeated-finalize behavior.
- Modify: `packages/api/src/skill-command-worker-queue.test.ts`
  - Adds regression coverage for stable repeated finalization and conflicting matching terminal events.
- Modify: `packages/api/package.json`
  - Adds `src/run-lifecycle.test.ts` to the package test script.
- Modify: `packages/api/src/index.ts`
  - Re-exports lifecycle helper types/functions from the API package root.
- Modify after implementation: `docs/project-roadmap.md`, `docs/agent-development-learning.md`
  - Marks Stage 18 implementation status and records the lifecycle/recovery boundary as current fact.

Do not add database tables, JSON-file migrations, Web UI, daemon behavior, MCP execution, shell execution, or automatic retry execution in this stage.

---

### Task 1: Core Run Lifecycle Helper

**Files:**
- Create: `packages/api/src/run-lifecycle.ts`
- Create: `packages/api/src/run-lifecycle.test.ts`
- Modify: `packages/api/package.json`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Write failing core lifecycle tests**

Create `packages/api/src/run-lifecycle.test.ts` with this initial content:

```ts
import { describe, expect, it } from "vitest";
import {
  createInMemoryWorkbenchRepositories,
  type RunEventRecord,
  type RunRecord,
  type RunRecordState,
  type WorkbenchRepositories
} from "@lp-agent/db";
import { deriveRunLifecycleView } from "./run-lifecycle";

function runRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run_planner_1",
    projectId: "project_1",
    taskId: "task_1",
    role: "planner",
    state: "running",
    startedAt: "2026-05-19T00:00:00.000Z",
    contextSummary: {
      injected: [],
      omitted: []
    },
    ...overrides
  };
}

async function saveRun(
  repositories: WorkbenchRepositories,
  overrides: Partial<RunRecord> = {}
): Promise<RunRecord> {
  const run = runRecord(overrides);
  await repositories.runs.save(run);
  return run;
}

async function saveEvent(
  repositories: WorkbenchRepositories,
  input: {
    runId?: string;
    type: string;
    message?: string;
    sequence?: number;
    payload?: Record<string, unknown>;
  }
): Promise<RunEventRecord> {
  const event: RunEventRecord = {
    id: `${input.runId ?? "run_planner_1"}_event_${input.sequence ?? 1}`,
    runId: input.runId ?? "run_planner_1",
    projectId: "project_1",
    taskId: "task_1",
    sequence: input.sequence ?? 1,
    type: input.type,
    message: input.message ?? input.type,
    payload: input.payload ?? {},
    createdAt: `2026-05-19T00:00:0${input.sequence ?? 1}.000Z`
  };
  await repositories.runEvents.save(event);
  return event;
}

describe("deriveRunLifecycleView core states", () => {
  it("returns run_not_found for a missing run", async () => {
    const repositories = createInMemoryWorkbenchRepositories();

    await expect(
      deriveRunLifecycleView({ repositories, runId: "missing_run" })
    ).resolves.toEqual({
      ok: false,
      error: "run_not_found"
    });
  });

  it.each([
    ["run.completed", "completed"],
    ["run.failed", "failed"],
    ["run.cancelled", "cancelled"]
  ] as const)(
    "derives %s as %s from terminal run events",
    async (eventType, expectedState) => {
      const repositories = createInMemoryWorkbenchRepositories();
      await saveRun(repositories, {
        state: expectedState as RunRecordState,
        completedAt: "2026-05-19T00:00:05.000Z"
      });
      await saveEvent(repositories, {
        type: eventType,
        message: `${eventType} message`
      });

      const result = await deriveRunLifecycleView({
        repositories,
        runId: "run_planner_1"
      });

      expect(result).toMatchObject({
        ok: true,
        view: {
          runId: "run_planner_1",
          state: expectedState,
          terminalEventType: eventType,
          recoveryActions: expectedState === "failed" ? ["retry_run"] : []
        }
      });
    }
  );

  it.each([
    ["running", "running", []],
    ["needs_approval", "waiting_for_approval", ["request_approval"]],
    ["needs_input", "blocked", ["resolve_blocker"]]
  ] as const)(
    "maps run record state %s to lifecycle state %s",
    async (recordState, expectedState, recoveryActions) => {
      const repositories = createInMemoryWorkbenchRepositories();
      await saveRun(repositories, { state: recordState });

      const result = await deriveRunLifecycleView({
        repositories,
        runId: "run_planner_1"
      });

      expect(result).toMatchObject({
        ok: true,
        view: {
          state: expectedState,
          runRecordState: recordState,
          recoveryActions
        }
      });
    }
  );

  it("uses model parse failure metadata as the failed diagnostic without exposing raw output", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveRun(repositories, {
      state: "failed",
      completedAt: "2026-05-19T00:00:05.000Z"
    });
    await saveEvent(repositories, {
      sequence: 1,
      type: "model.output.parse_failed",
      message: "Planner output could not be parsed as LP brief RAW_MODEL_OUTPUT_SECRET",
      payload: {
        schema: "LPBriefSchema",
        reason: "invalid_json"
      }
    });
    await saveEvent(repositories, {
      sequence: 2,
      type: "run.failed",
      message: "Planner run failed RAW_MODEL_OUTPUT_SECRET",
      payload: {
        state: "failed",
        errorName: "PlannerLPBriefParseError"
      }
    });

    const result = await deriveRunLifecycleView({
      repositories,
      runId: "run_planner_1"
    });

    expect(result).toMatchObject({
      ok: true,
      view: {
        state: "failed",
        diagnosticSummary: {
          code: "invalid_json",
          message: "Model output could not be parsed safely.",
          source: "model_parse",
          eventType: "model.output.parse_failed"
        }
      }
    });
    expect(JSON.stringify(result)).not.toContain("RAW_MODEL_OUTPUT_SECRET");
  });
});
```

- [ ] **Step 2: Run the core tests and verify they fail because the helper is missing**

Run:

```bash
pnpm exec vitest run packages/api/src/run-lifecycle.test.ts
```

Expected: FAIL with an import/module error for `./run-lifecycle`.

- [ ] **Step 3: Implement the minimal core helper**

Create `packages/api/src/run-lifecycle.ts`:

```ts
import type {
  AgentHandoffRecord,
  RunEventRecord,
  RunRecord,
  RunRecordState,
  ToolObservationRecord,
  WorkbenchRepositories
} from "@lp-agent/db";
import type { AgentRole } from "@lp-agent/model-gateway";
import type { WorkerJobRecord, WorkerRuntime } from "@lp-agent/worker-runtime";
import { sanitizeHandoffText } from "./agent-handoffs";

export type RunLifecycleState =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "blocked"
  | "cancelling"
  | "cancelled"
  | "failed"
  | "completed";

export type RunRecoveryAction =
  | "retry_run"
  | "resume_worker_finalization"
  | "request_approval"
  | "resolve_blocker"
  | "inspect_manually";

export interface RunDiagnosticSummary {
  code: string;
  message: string;
  source:
    | "run_event"
    | "model_parse"
    | "tool_observation"
    | "worker_job"
    | "handoff"
    | "lifecycle";
  eventType?: string;
  errorName?: string;
}

export interface RunLifecycleView {
  runId: string;
  projectId: string;
  taskId?: string;
  role: AgentRole;
  state: RunLifecycleState;
  runRecordState: RunRecordState;
  startedAt: string;
  completedAt?: string;
  terminalEventType?: string;
  linkedWorkerJobId?: string;
  linkedObservationId?: string;
  blockedReason?: string;
  diagnosticSummary?: RunDiagnosticSummary;
  recoveryActions: RunRecoveryAction[];
}

export type DeriveRunLifecycleViewResult =
  | { ok: true; view: RunLifecycleView }
  | { ok: false; error: "run_not_found" };

export type RunLifecycleWorkerRuntime = Pick<WorkerRuntime, "getJob">;

export async function deriveRunLifecycleView(input: {
  repositories: WorkbenchRepositories;
  workerRuntime?: RunLifecycleWorkerRuntime;
  runId: string;
}): Promise<DeriveRunLifecycleViewResult> {
  const run = await input.repositories.runs.getById(input.runId);
  if (!run) {
    return { ok: false, error: "run_not_found" };
  }

  const [events, observations] = await Promise.all([
    input.repositories.runEvents.listForRun(run.id),
    input.repositories.toolObservations.listForRun(run.id)
  ]);
  const terminal = deriveTerminalRunEvent(events);
  if (terminal.conflict) {
    return {
      ok: true,
      view: baseView(run, {
        state: "failed",
        terminalEventType: terminal.latest?.type,
        diagnosticSummary: {
          code: "inconsistent_terminal_events",
          message: "Run has conflicting terminal events.",
          source: "lifecycle",
          eventType: terminal.latest?.type
        },
        recoveryActions: ["inspect_manually"]
      })
    };
  }
  if (terminal.latest) {
    const state = terminalEventToLifecycleState(terminal.latest);
    return {
      ok: true,
      view: baseView(run, {
        state,
        terminalEventType: terminal.latest.type,
        diagnosticSummary: state === "failed"
          ? deriveDiagnostic({ events, observations })
          : undefined,
        recoveryActions: terminalStateRecoveryActions(state)
      })
    };
  }

  const mapped = mapRunRecordState(run.state);
  return {
    ok: true,
    view: baseView(run, {
      state: mapped.state,
      diagnosticSummary: mapped.diagnosticSummary,
      recoveryActions: mapped.recoveryActions
    })
  };
}

export async function listRunLifecycleViewsForTask(input: {
  repositories: WorkbenchRepositories;
  workerRuntime?: RunLifecycleWorkerRuntime;
  taskId: string;
}): Promise<RunLifecycleView[]> {
  const runs = await input.repositories.runs.listForTask(input.taskId);
  const views: RunLifecycleView[] = [];
  for (const run of runs) {
    const result = await deriveRunLifecycleView({
      repositories: input.repositories,
      workerRuntime: input.workerRuntime,
      runId: run.id
    });
    if (result.ok) {
      views.push(result.view);
    }
  }
  return views.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

function baseView(
  run: RunRecord,
  values: {
    state: RunLifecycleState;
    terminalEventType?: string;
    linkedWorkerJobId?: string;
    linkedObservationId?: string;
    blockedReason?: string;
    diagnosticSummary?: RunDiagnosticSummary;
    recoveryActions: RunRecoveryAction[];
  }
): RunLifecycleView {
  return {
    runId: run.id,
    projectId: run.projectId,
    ...(run.taskId ? { taskId: run.taskId } : {}),
    role: run.role,
    state: values.state,
    runRecordState: run.state,
    startedAt: run.startedAt,
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    ...(values.terminalEventType ? { terminalEventType: values.terminalEventType } : {}),
    ...(values.linkedWorkerJobId ? { linkedWorkerJobId: values.linkedWorkerJobId } : {}),
    ...(values.linkedObservationId ? { linkedObservationId: values.linkedObservationId } : {}),
    ...(values.blockedReason ? { blockedReason: values.blockedReason } : {}),
    ...(values.diagnosticSummary ? { diagnosticSummary: values.diagnosticSummary } : {}),
    recoveryActions: values.recoveryActions
  };
}

function deriveTerminalRunEvent(events: RunEventRecord[]): {
  latest?: RunEventRecord;
  conflict: boolean;
} {
  const terminalEvents = events.filter((event) => isTerminalRunEvent(event.type));
  const terminalTypes = new Set(terminalEvents.map((event) => event.type));
  return {
    latest: terminalEvents.at(-1),
    conflict: terminalTypes.size > 1
  };
}

function isTerminalRunEvent(type: string): boolean {
  return type === "run.completed" || type === "run.failed" || type === "run.cancelled";
}

function terminalEventToLifecycleState(event: RunEventRecord): RunLifecycleState {
  if (event.type === "run.completed") {
    return "completed";
  }
  if (event.type === "run.cancelled") {
    return "cancelled";
  }
  return "failed";
}

function terminalStateRecoveryActions(state: RunLifecycleState): RunRecoveryAction[] {
  return state === "failed" ? ["retry_run"] : [];
}

function mapRunRecordState(state: RunRecordState): {
  state: RunLifecycleState;
  diagnosticSummary?: RunDiagnosticSummary;
  recoveryActions: RunRecoveryAction[];
} {
  if (state === "needs_approval") {
    return { state: "waiting_for_approval", recoveryActions: ["request_approval"] };
  }
  if (state === "needs_input") {
    return {
      state: "blocked",
      diagnosticSummary: {
        code: "input_required",
        message: "Run needs user input before it can continue.",
        source: "lifecycle"
      },
      recoveryActions: ["resolve_blocker"]
    };
  }
  if (state === "failed") {
    return { state: "failed", recoveryActions: ["retry_run"] };
  }
  if (state === "completed") {
    return { state: "completed", recoveryActions: [] };
  }
  if (state === "cancelled") {
    return { state: "cancelled", recoveryActions: [] };
  }
  return { state: "running", recoveryActions: [] };
}

function deriveDiagnostic(input: {
  events: RunEventRecord[];
  observations: ToolObservationRecord[];
}): RunDiagnosticSummary | undefined {
  const parseFailed = input.events.find((event) => event.type === "model.output.parse_failed");
  if (parseFailed) {
    return {
      code: safeCode(readStringPayload(parseFailed, "policyCode") ?? readStringPayload(parseFailed, "reason") ?? "model_output_parse_failed"),
      message: "Model output could not be parsed safely.",
      source: "model_parse",
      eventType: parseFailed.type
    };
  }

  const failedObservation = input.observations.find((observation) => observation.state === "failed");
  if (failedObservation) {
    return {
      code: safeCode(failedObservation.errorName ?? "tool_failed"),
      message: "Tool execution failed.",
      source: "tool_observation",
      errorName: safeOptionalCode(failedObservation.errorName)
    };
  }

  const failedRun = input.events.find((event) => event.type === "run.failed");
  if (failedRun) {
    return {
      code: "run_failed",
      message: "Run failed.",
      source: "run_event",
      eventType: failedRun.type,
      errorName: safeOptionalCode(readStringPayload(failedRun, "errorName"))
    };
  }

  return undefined;
}

function readStringPayload(event: RunEventRecord, key: string): string | undefined {
  const value = event.payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function safeOptionalCode(value: string | undefined): string | undefined {
  return value ? safeCode(value) : undefined;
}

function safeCode(value: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(trimmed)) {
    return "unknown";
  }
  return trimmed;
}

function safeText(value: string): string {
  return sanitizeHandoffText(value).replace(/\s+/gu, " ").trim().slice(0, 240);
}

function workerLifecycleState(_workerJob: WorkerJobRecord): RunLifecycleState {
  return "running";
}

function handoffBlockedReason(_handoffs: AgentHandoffRecord[]): string | undefined {
  return undefined;
}
```

The last two functions are intentionally unused at this point. They keep imported types available for the next task without changing behavior.

Modify `packages/api/src/index.ts` near the other exports/import-independent declarations by adding this export at the bottom of the file:

```ts
export * from "./run-lifecycle";
```

Modify `packages/api/package.json` so the `test` script includes the new test file:

```json
"test": "vitest run src/task-interrupts.test.ts src/skill-command-worker-queue.test.ts src/structured-lp-brief.test.ts src/structured-static-artifacts.test.ts src/skill-command-execution.test.ts src/worker-backed-tool-command-runner.test.ts src/run-orchestrator.test.ts src/run-lifecycle.test.ts src/context-memory.test.ts src/agent-handoffs.test.ts src/artifact-reader.test.ts src/services.test.ts"
```

- [ ] **Step 4: Run the core tests and package typecheck**

Run:

```bash
pnpm exec vitest run packages/api/src/run-lifecycle.test.ts
pnpm --filter @lp-agent/api typecheck
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit core lifecycle helper**

```bash
git add packages/api/src/run-lifecycle.ts packages/api/src/run-lifecycle.test.ts packages/api/src/index.ts packages/api/package.json
git commit -m "add run lifecycle derivation helper"
```

---

### Task 2: Worker Job and Handoff Lifecycle Derivation

**Files:**
- Modify: `packages/api/src/run-lifecycle.test.ts`
- Modify: `packages/api/src/run-lifecycle.ts`

- [ ] **Step 1: Add failing worker and handoff lifecycle tests**

Add these imports to the import section at the top of `packages/api/src/run-lifecycle.test.ts`:

```ts
import { createAgentHandoffRecord } from "./agent-handoffs";
import type { WorkerJobRecord } from "@lp-agent/worker-runtime";
```

Append this block to `packages/api/src/run-lifecycle.test.ts`:

```ts
function workerJob(
  overrides: Partial<WorkerJobRecord> = {}
): WorkerJobRecord {
  return {
    id: "worker_job_1",
    projectId: "project_1",
    kind: "tool_command",
    state: "queued",
    payloadSource: "safe_persisted",
    policy: {
      mode: "simulate",
      allowedCommands: ["static-deploy"],
      timeoutMs: 30000,
      allowedEnvNames: ["LP_PROJECT_ID"],
      maxStdoutBytes: 1000,
      maxStderrBytes: 1000,
      network: "disabled"
    },
    inputSummary: {
      projectId: "project_1",
      kind: "tool_command",
      commandId: "publish_static",
      command: "static-deploy",
      argCount: 2,
      envNames: ["LP_PROJECT_ID"],
      timeoutMs: 30000
    },
    createdAt: "2026-05-19T00:00:01.000Z",
    ...overrides
  };
}

async function saveWorkerLink(repositories: WorkbenchRepositories): Promise<void> {
  await saveEvent(repositories, {
    sequence: 1,
    type: "worker.job.linked",
    payload: {
      taskId: "task_1",
      runId: "run_planner_1",
      workerJobId: "worker_job_1",
      observationId: "tool_observation_1"
    }
  });
}

describe("deriveRunLifecycleView worker and handoff states", () => {
  it.each([
    ["queued", "queued"],
    ["running", "running"]
  ] as const)(
    "derives linked worker job state %s",
    async (workerState, expectedState) => {
      const repositories = createInMemoryWorkbenchRepositories();
      await saveRun(repositories, { role: "deployer" });
      await saveWorkerLink(repositories);

      const result = await deriveRunLifecycleView({
        repositories,
        workerRuntime: {
          getJob: async () => workerJob({ state: workerState })
        },
        runId: "run_planner_1"
      });

      expect(result).toMatchObject({
        ok: true,
        view: {
          state: expectedState,
          linkedWorkerJobId: "worker_job_1",
          linkedObservationId: "tool_observation_1"
        }
      });
    }
  );

  it("derives cancelling when a linked running worker job has a cancellation request", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveRun(repositories, { role: "deployer" });
    await saveWorkerLink(repositories);

    const result = await deriveRunLifecycleView({
      repositories,
      workerRuntime: {
        getJob: async () =>
          workerJob({
            state: "running",
            cancelRequestedAt: "2026-05-19T00:00:03.000Z"
          })
      },
      runId: "run_planner_1"
    });

    expect(result).toMatchObject({
      ok: true,
      view: {
        state: "cancelling",
        recoveryActions: []
      }
    });
  });

  it("returns resume finalization for a terminal worker job without terminal run events", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveRun(repositories, { role: "deployer" });
    await saveWorkerLink(repositories);

    const result = await deriveRunLifecycleView({
      repositories,
      workerRuntime: {
        getJob: async () =>
          workerJob({
            state: "completed",
            completedAt: "2026-05-19T00:00:04.000Z",
            resultSummary: {
              state: "completed",
              exitCode: 0,
              stdout: "published",
              stderr: "",
              stdoutBytes: 9,
              stderrBytes: 0
            }
          })
      },
      runId: "run_planner_1"
    });

    expect(result).toMatchObject({
      ok: true,
      view: {
        state: "completed",
        recoveryActions: ["resume_worker_finalization"],
        diagnosticSummary: {
          code: "worker_finalization_incomplete",
          source: "lifecycle"
        }
      }
    });
    expect(JSON.stringify(result)).not.toContain("published");
  });

  it("reports a missing linked worker job without manufacturing success", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveRun(repositories, { role: "deployer" });
    await saveWorkerLink(repositories);

    const result = await deriveRunLifecycleView({
      repositories,
      workerRuntime: {
        getJob: async () => undefined
      },
      runId: "run_planner_1"
    });

    expect(result).toMatchObject({
      ok: true,
      view: {
        state: "failed",
        diagnosticSummary: {
          code: "worker_job_missing",
          source: "lifecycle"
        },
        recoveryActions: ["inspect_manually"]
      }
    });
  });

  it("derives blocked from an inbound blocked handoff and redacts the blocking reason", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveRun(repositories, { role: "deployer" });
    await repositories.agentHandoffs.save(
      createAgentHandoffRecord({
        id: "handoff_1",
        projectId: "project_1",
        taskId: "task_1",
        fromRunId: "run_reviewer_1",
        fromRole: "reviewer",
        toRole: "deployer",
        state: "blocked",
        summary: "Reviewer blocked deployment",
        blockingReason: "Deployment blocked with OPENAI_API_KEY=sk-test-secret",
        now: () => new Date("2026-05-19T00:00:02.000Z")
      })
    );

    const result = await deriveRunLifecycleView({
      repositories,
      runId: "run_planner_1"
    });

    expect(result).toMatchObject({
      ok: true,
      view: {
        state: "blocked",
        blockedReason: "Deployment blocked with OPENAI_API_KEY=[REDACTED]",
        diagnosticSummary: {
          code: "handoff_blocked",
          source: "handoff"
        },
        recoveryActions: ["resolve_blocker"]
      }
    });
    expect(JSON.stringify(result)).not.toContain("sk-test-secret");
  });
});
```

- [ ] **Step 2: Run the worker/handoff tests and verify they fail**

Run:

```bash
pnpm exec vitest run packages/api/src/run-lifecycle.test.ts -t "worker and handoff"
```

Expected: FAIL because `deriveRunLifecycleView()` does not inspect worker links or handoffs yet.

- [ ] **Step 3: Implement worker link and blocked handoff derivation**

In `packages/api/src/run-lifecycle.ts`, replace the `deriveRunLifecycleView()` body after the terminal-event branch with this code:

```ts
  const blockedHandoff = await findBlockedInboundHandoff({
    repositories: input.repositories,
    run
  });
  if (blockedHandoff) {
    const blockedReason = safeText(
      blockedHandoff.blockingReason ?? blockedHandoff.summary
    );
    return {
      ok: true,
      view: baseView(run, {
        state: "blocked",
        blockedReason,
        diagnosticSummary: {
          code: "handoff_blocked",
          message: "Run is blocked by an inbound handoff.",
          source: "handoff"
        },
        recoveryActions: ["resolve_blocker"]
      })
    };
  }

  const workerLink = findLatestWorkerLink(events);
  if (workerLink) {
    const workerJob = input.workerRuntime
      ? await input.workerRuntime.getJob(workerLink.workerJobId)
      : undefined;
    if (!workerJob) {
      return {
        ok: true,
        view: baseView(run, {
          state: "failed",
          linkedWorkerJobId: workerLink.workerJobId,
          linkedObservationId: workerLink.observationId,
          diagnosticSummary: {
            code: "worker_job_missing",
            message: "Linked worker job could not be loaded.",
            source: "lifecycle",
            eventType: "worker.job.linked"
          },
          recoveryActions: ["inspect_manually"]
        })
      };
    }

    const workerDerived = deriveWorkerLifecycle(workerJob);
    return {
      ok: true,
      view: baseView(run, {
        state: workerDerived.state,
        linkedWorkerJobId: workerLink.workerJobId,
        linkedObservationId: workerLink.observationId,
        diagnosticSummary: workerDerived.diagnosticSummary,
        recoveryActions: workerDerived.recoveryActions
      })
    };
  }

  const mapped = mapRunRecordState(run.state);
  return {
    ok: true,
    view: baseView(run, {
      state: mapped.state,
      diagnosticSummary: mapped.diagnosticSummary,
      recoveryActions: mapped.recoveryActions
    })
  };
```

Add these helper functions below `deriveDiagnostic()`:

```ts
async function findBlockedInboundHandoff(input: {
  repositories: WorkbenchRepositories;
  run: RunRecord;
}): Promise<AgentHandoffRecord | undefined> {
  const handoffs = await input.repositories.agentHandoffs.listInbound({
    projectId: input.run.projectId,
    taskId: input.run.taskId,
    toRole: input.run.role
  });
  return handoffs.find((handoff) => handoff.state === "blocked");
}

function findLatestWorkerLink(events: RunEventRecord[]): {
  workerJobId: string;
  observationId?: string;
} | undefined {
  const linked = events
    .filter((event) => event.type === "worker.job.linked")
    .at(-1);
  if (!linked) {
    return undefined;
  }
  const workerJobId = toNonEmptyString(linked.payload.workerJobId);
  if (!workerJobId) {
    return undefined;
  }
  return {
    workerJobId,
    ...(toNonEmptyString(linked.payload.observationId)
      ? { observationId: toNonEmptyString(linked.payload.observationId) }
      : {})
  };
}

function deriveWorkerLifecycle(workerJob: WorkerJobRecord): {
  state: RunLifecycleState;
  diagnosticSummary?: RunDiagnosticSummary;
  recoveryActions: RunRecoveryAction[];
} {
  if (workerJob.state === "queued") {
    return { state: "queued", recoveryActions: [] };
  }
  if (workerJob.state === "running") {
    return {
      state: workerJob.cancelRequestedAt ? "cancelling" : "running",
      recoveryActions: []
    };
  }
  if (workerJob.state === "completed") {
    return {
      state: "completed",
      diagnosticSummary: {
        code: "worker_finalization_incomplete",
        message: "Worker job completed before run finalization finished.",
        source: "lifecycle"
      },
      recoveryActions: ["resume_worker_finalization"]
    };
  }
  if (workerJob.state === "cancelled") {
    return {
      state: "cancelled",
      diagnosticSummary: {
        code: safeCode(workerJob.errorName ?? "worker_job_cancelled"),
        message: "Worker job was cancelled before run finalization finished.",
        source: "worker_job",
        errorName: safeOptionalCode(workerJob.errorName)
      },
      recoveryActions: ["resume_worker_finalization"]
    };
  }
  return {
    state: "failed",
    diagnosticSummary: {
      code: safeCode(workerJob.errorName ?? workerJob.resultSummary?.errorName ?? "worker_job_failed"),
      message: "Worker job failed before run finalization finished.",
      source: "worker_job",
      errorName: safeOptionalCode(workerJob.errorName ?? workerJob.resultSummary?.errorName)
    },
    recoveryActions: ["resume_worker_finalization"]
  };
}

function toNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
```

Remove the temporary `workerLifecycleState()` and `handoffBlockedReason()` functions from Task 1.

- [ ] **Step 4: Run lifecycle tests**

Run:

```bash
pnpm exec vitest run packages/api/src/run-lifecycle.test.ts
pnpm --filter @lp-agent/api typecheck
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit worker and handoff lifecycle derivation**

```bash
git add packages/api/src/run-lifecycle.ts packages/api/src/run-lifecycle.test.ts
git commit -m "derive worker and handoff run lifecycle"
```

---

### Task 3: Terminal Conflicts, Task Listing, and Diagnostic Safety

**Files:**
- Modify: `packages/api/src/run-lifecycle.test.ts`
- Modify: `packages/api/src/run-lifecycle.ts`

- [ ] **Step 1: Add failing tests for conflicts, task listing, and safe diagnostics**

Append this block to `packages/api/src/run-lifecycle.test.ts`:

```ts
describe("deriveRunLifecycleView recovery safety", () => {
  it("marks conflicting terminal run events for manual inspection", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveRun(repositories, {
      state: "failed",
      completedAt: "2026-05-19T00:00:05.000Z"
    });
    await saveEvent(repositories, {
      sequence: 1,
      type: "run.completed",
      payload: { state: "completed" }
    });
    await saveEvent(repositories, {
      sequence: 2,
      type: "run.failed",
      payload: { state: "failed", errorName: "PlannerError" }
    });

    const result = await deriveRunLifecycleView({
      repositories,
      runId: "run_planner_1"
    });

    expect(result).toMatchObject({
      ok: true,
      view: {
        state: "failed",
        diagnosticSummary: {
          code: "inconsistent_terminal_events",
          source: "lifecycle"
        },
        recoveryActions: ["inspect_manually"]
      }
    });
  });

  it("keeps run failed diagnostics short and generic when event messages contain sensitive data", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveRun(repositories, {
      state: "failed",
      completedAt: "2026-05-19T00:00:05.000Z"
    });
    await saveEvent(repositories, {
      type: "run.failed",
      message: "Planner failed with SECRET_TOKEN=secret-token and raw stack",
      payload: {
        state: "failed",
        errorName: "PlannerError"
      }
    });

    const result = await deriveRunLifecycleView({
      repositories,
      runId: "run_planner_1"
    });

    expect(result).toMatchObject({
      ok: true,
      view: {
        diagnosticSummary: {
          code: "run_failed",
          message: "Run failed.",
          errorName: "PlannerError"
        }
      }
    });
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(JSON.stringify(result)).not.toContain("SECRET_TOKEN");
  });

  it("lists lifecycle views for a task in started order", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.runs.save(runRecord({
      id: "run_builder_1",
      role: "builder",
      startedAt: "2026-05-19T00:00:02.000Z",
      state: "completed",
      completedAt: "2026-05-19T00:00:03.000Z"
    }));
    await repositories.runs.save(runRecord({
      id: "run_planner_1",
      role: "planner",
      startedAt: "2026-05-19T00:00:01.000Z",
      state: "completed",
      completedAt: "2026-05-19T00:00:02.000Z"
    }));
    await saveEvent(repositories, {
      runId: "run_builder_1",
      sequence: 1,
      type: "run.completed",
      payload: { state: "completed" }
    });
    await saveEvent(repositories, {
      runId: "run_planner_1",
      sequence: 1,
      type: "run.completed",
      payload: { state: "completed" }
    });

    const views = await listRunLifecycleViewsForTask({
      repositories,
      taskId: "task_1"
    });

    expect(views.map((view) => view.runId)).toEqual([
      "run_planner_1",
      "run_builder_1"
    ]);
    expect(views.map((view) => view.state)).toEqual(["completed", "completed"]);
  });
});
```

Update the import line at the top of `packages/api/src/run-lifecycle.test.ts`:

```ts
import { deriveRunLifecycleView, listRunLifecycleViewsForTask } from "./run-lifecycle";
```

- [ ] **Step 2: Run the new tests and verify the listing import fails or the tests fail before implementation**

Run:

```bash
pnpm exec vitest run packages/api/src/run-lifecycle.test.ts -t "recovery safety"
```

Expected: FAIL if `listRunLifecycleViewsForTask()` has not been exported correctly or if conflict/list behavior is incomplete.

- [ ] **Step 3: Tighten conflict handling and list export**

If Task 1 already added `listRunLifecycleViewsForTask()`, verify it is exported from `packages/api/src/run-lifecycle.ts`. Keep terminal conflict detection as:

```ts
function deriveTerminalRunEvent(events: RunEventRecord[]): {
  latest?: RunEventRecord;
  conflict: boolean;
} {
  const terminalEvents = events.filter((event) => isTerminalRunEvent(event.type));
  const terminalTypes = new Set(terminalEvents.map((event) => event.type));
  return {
    latest: terminalEvents.at(-1),
    conflict: terminalTypes.size > 1
  };
}
```

If `saveEvent()` in the test helper creates duplicate event ids for different run ids, change it to this exact id expression:

```ts
id: `${input.runId ?? "run_planner_1"}_event_${input.sequence ?? 1}`,
```

Ensure `deriveDiagnostic()` never uses `RunEventRecord.message` as diagnostic message for `run.failed`. The failed run branch must remain:

```ts
  const failedRun = input.events.find((event) => event.type === "run.failed");
  if (failedRun) {
    return {
      code: "run_failed",
      message: "Run failed.",
      source: "run_event",
      eventType: failedRun.type,
      errorName: safeOptionalCode(readStringPayload(failedRun, "errorName"))
    };
  }
```

- [ ] **Step 4: Run lifecycle tests and full API package tests**

Run:

```bash
pnpm exec vitest run packages/api/src/run-lifecycle.test.ts
pnpm --filter @lp-agent/api test
pnpm --filter @lp-agent/api typecheck
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit recovery safety behavior**

```bash
git add packages/api/src/run-lifecycle.ts packages/api/src/run-lifecycle.test.ts
git commit -m "add run lifecycle recovery diagnostics"
```

---

### Task 4: Worker Finalizer Idempotence and Conflict Regression

**Files:**
- Modify: `packages/api/src/skill-command-worker-queue.test.ts`
- Modify: `packages/api/src/skill-command-worker-queue.ts`

- [ ] **Step 1: Add failing finalizer regression tests**

Inside the existing `describe("worker-backed skill command finalization", () => { ... })` block in `packages/api/src/skill-command-worker-queue.test.ts`, add these tests after the existing idempotence tests:

```ts
  it("keeps completed timestamps stable across repeated completed finalization", async () => {
    const { repositories, workerJob } = await linkedWorkerJob({ state: "completed" });

    await finalizeWorkerBackedSkillCommand({
      repositories,
      workerJob,
      now: () => new Date("2026-05-18T00:00:04.000Z")
    });
    await finalizeWorkerBackedSkillCommand({
      repositories,
      workerJob,
      now: () => new Date("2026-05-18T00:00:05.000Z")
    });

    await expect(repositories.runs.getById("run_skill_command_1")).resolves.toMatchObject({
      state: "completed",
      completedAt: "2026-05-18T00:00:04.000Z"
    });
    await expect(repositories.toolObservations.listForRun("run_skill_command_1")).resolves.toEqual([
      expect.objectContaining({
        state: "completed",
        completedAt: "2026-05-18T00:00:04.000Z"
      })
    ]);
    const events = await repositories.runEvents.listForRun("run_skill_command_1");
    expect(events.filter((event) => event.type === "tool.completed")).toHaveLength(1);
    expect(events.filter((event) => event.type === "run.completed")).toHaveLength(1);
  });

  it("fails finalization when matching terminal tool and run events disagree", async () => {
    const { repositories, workerJob } = await linkedWorkerJob({ state: "completed" });
    await repositories.runEvents.save({
      id: "run_skill_command_1_event_4",
      runId: "run_skill_command_1",
      projectId: "project_1",
      taskId: "task_1",
      sequence: 4,
      type: "tool.completed",
      message: "Deployment skill command completed.",
      payload: {
        workerJobId: workerJob.id,
        observationId: "tool_observation_1",
        outputSummary: "stdout: 9 bytes\nstderr: 0 bytes",
        exitCode: 0
      },
      createdAt: "2026-05-18T00:00:03.000Z"
    });
    await repositories.runEvents.save({
      id: "run_skill_command_1_event_5",
      runId: "run_skill_command_1",
      projectId: "project_1",
      taskId: "task_1",
      sequence: 5,
      type: "run.cancelled",
      message: "Deployment skill command run cancelled.",
      payload: {
        workerJobId: workerJob.id,
        observationId: "tool_observation_1",
        outputSummary: "stdout: 9 bytes\nstderr: 0 bytes",
        exitCode: 0
      },
      createdAt: "2026-05-18T00:00:03.001Z"
    });

    const result = await finalizeWorkerBackedSkillCommand({
      repositories,
      workerJob,
      now: () => new Date("2026-05-18T00:00:04.000Z")
    });

    expect(result).toEqual({
      ok: false,
      error: "worker_job_finalization_failed"
    });
    await expect(repositories.runs.getById("run_skill_command_1")).resolves.toMatchObject({
      state: "running"
    });
    await expect(repositories.toolObservations.listForRun("run_skill_command_1")).resolves.toEqual([
      expect.objectContaining({
        state: "running",
        outputSummary: ""
      })
    ]);
    const events = await repositories.runEvents.listForRun("run_skill_command_1");
    expect(events.filter((event) => event.type === "tool.completed")).toHaveLength(1);
    expect(events.filter((event) => event.type === "run.cancelled")).toHaveLength(1);
  });
```

- [ ] **Step 2: Run finalizer tests and verify the conflict regression fails**

Run:

```bash
pnpm exec vitest run packages/api/src/skill-command-worker-queue.test.ts -t "worker-backed skill command finalization"
```

Expected: FAIL on the disagreeing terminal event test until the finalizer checks matching terminal state consistency.

- [ ] **Step 3: Implement terminal consistency guard in the finalizer**

In `packages/api/src/skill-command-worker-queue.ts`, after `terminalToolEvent` and `terminalRunEvent` are computed, insert:

```ts
  if (
    terminalToolEvent &&
    terminalRunEvent &&
    terminalToolEventToRecordState(terminalToolEvent) !==
      terminalRunEventToRecordState(terminalRunEvent)
  ) {
    return { ok: false, error: "worker_job_finalization_failed" };
  }
```

Then replace:

```ts
  const terminalRecordState = terminalRunEvent
    ? terminalRunEventToRecordState(terminalRunEvent)
    : terminalToolEvent
      ? terminalToolEventToRecordState(terminalToolEvent)
      : toRecordTerminalState(workerFinalState);
```

with:

```ts
  const terminalRecordState = terminalRunEvent
    ? terminalRunEventToRecordState(terminalRunEvent)
    : terminalToolEvent
      ? terminalToolEventToRecordState(terminalToolEvent)
      : toRecordTerminalState(workerFinalState);
  if (terminalRecordState !== toRecordTerminalState(workerFinalState)) {
    return { ok: false, error: "worker_job_finalization_failed" };
  }
```

This preserves rejected worker jobs because `toRecordTerminalState("rejected")` maps to `failed`.

- [ ] **Step 4: Run focused and package tests**

Run:

```bash
pnpm exec vitest run packages/api/src/skill-command-worker-queue.test.ts -t "worker-backed skill command finalization"
pnpm --filter @lp-agent/api test
pnpm --filter @lp-agent/api typecheck
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit finalizer idempotence guard**

```bash
git add packages/api/src/skill-command-worker-queue.ts packages/api/src/skill-command-worker-queue.test.ts
git commit -m "harden worker finalization idempotence"
```

---

### Task 5: Documentation, Roadmap, and Final Verification

**Files:**
- Modify: `docs/project-roadmap.md`
- Modify: `docs/agent-development-learning.md`

- [ ] **Step 1: Update roadmap status**

In `docs/project-roadmap.md`, change Stage 18 status from:

```md
**状态：** 设计已确认，等待 implementation plan。
```

to:

```md
**状态：** 已实现。
```

Add this bullet to the current status snapshot:

```md
- Agent run lifecycle / recovery v0：从 run events、worker jobs、tool observations 和 handoffs 派生 lifecycle view、diagnostic summary 和 recovery action contract，并强化 worker finalization 幂等性。
```

Remove implemented items from the `Agent Runtime / Run Lifecycle` backlog or narrow them to future work:

```md
- Web-facing retry/recovery UI。
- Blocking question records。
- 固定 LP 链路稳定后的 general dependency graph。
```

- [ ] **Step 2: Update Agent learning notes**

In `docs/agent-development-learning.md`, under the existing `阶段 18：Agent Run Lifecycle and Recovery v0` section, keep the current plan link and add this implementation-status block immediately after it:

```md
当前实现状态：

- Stage 18 v0 已实现 API 侧 `RunLifecycleView`，从 run record、run event、worker job、tool observation 和 handoff 派生统一 lifecycle state。
- failed、blocked、missing worker、terminal event conflict 和 incomplete worker finalization 会返回安全 `diagnosticSummary` 与 recovery action contract。
- worker-backed skill command finalizer 已强化幂等性，重复 finalization 不重复写 terminal events，冲突 terminal state 会 fail closed。
```

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm --filter @lp-agent/api test
pnpm --filter @lp-agent/api typecheck
pnpm test
pnpm typecheck
```

Expected: all commands exit 0. If `pnpm test` or `pnpm typecheck` reveals unrelated failures, capture the exact failing command and first failure summary before stopping.

- [ ] **Step 4: Commit documentation and final verification updates**

```bash
git add docs/project-roadmap.md docs/agent-development-learning.md
git commit -m "document run lifecycle recovery implementation"
```

- [ ] **Step 5: Final clean-state check**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: `git status --short` prints no output. The latest commits include:

```text
document run lifecycle recovery implementation
harden worker finalization idempotence
add run lifecycle recovery diagnostics
derive worker and handoff run lifecycle
add run lifecycle derivation helper
```

---

## Self-Review

Spec coverage:

- Standard lifecycle states are covered in Tasks 1 and 2.
- `RunLifecycleView` and recovery action contract are covered in Tasks 1 through 3.
- Failure diagnostics and safe output behavior are covered in Tasks 1 and 3.
- Worker finalization idempotence is covered in Task 4.
- Documentation updates are covered in Task 5.
- Non-goals are preserved: no Web UI, daemon, MCP execution, shell execution, scheduler, database migration, or automatic retry execution.

Type consistency:

- `RunLifecycleState`, `RunRecoveryAction`, `RunDiagnosticSummary`, and `RunLifecycleView` are defined before tests depend on them outside `deriveRunLifecycleView()`.
- `RunLifecycleWorkerRuntime` uses `Pick<WorkerRuntime, "getJob">`, matching the spec and existing worker runtime shape.
- Worker terminal state maps `rejected` to failed record state via the existing finalizer helper.

Verification:

- Each task has a failing-test command and a passing-test command.
- Final verification includes both package-level and workspace-level commands.
