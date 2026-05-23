# Run Timeline and Recovery UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the LP live run timeline and recovery UI so Planner, Builder, Reviewer, and Deployer lifecycle states, repair/retry hints, handoff state, and recovery actions are easy to scan without changing runtime facts.

**Architecture:** Add a Web-only pure view-model in `apps/web/src/app/run-timeline-view-model.ts` that derives fixed LP chain display steps from existing `LiveTaskStatePayload`, `RunLifecycleView`, safe run events, and recovery runs. Render that model in `page.tsx` next to the existing live task panel and recovery block, while keeping repository facts, run event schema, recovery action contract, and polling behavior unchanged.

**Tech Stack:** Next.js App Router, React server/client components, TypeScript pure helpers, Vitest, Playwright, pnpm workspace scripts, existing Web i18n and CSS variables.

---

## File Structure

- Create `apps/web/src/app/run-timeline-view-model.ts`: pure Web-only timeline display derivation.
- Create `apps/web/src/app/run-timeline-view-model.test.ts`: unit tests for fixed role order, state classification, markers, handoff labels, and action grouping.
- Modify `apps/web/src/lib/i18n.ts`: add run timeline copy in English and Chinese.
- Modify `apps/web/src/lib/i18n.test.ts`: lock new localized copy.
- Modify `apps/web/src/app/live-task-panel.tsx`: display active role with localized role/state labels in the compact live task summary.
- Modify `apps/web/src/app/live-task-panel.test.ts`: cover localized active role display and safe artifact summary.
- Modify `apps/web/src/app/page.tsx`: render `RunTimelineBlock`, improve recovery action/guidance hierarchy, keep server action forms bound to run ids.
- Modify `apps/web/src/app/page.test.ts`: cover timeline rendering, recovery hierarchy, repair/retry hints, and non-leakage.
- Modify `apps/web/src/app/globals.css`: style timeline, markers, action hierarchy, and reduced-motion animation.
- Modify `apps/web/e2e/helpers.ts`: add focused run timeline browser assertions.
- Modify `apps/web/e2e/alpha-lp-artifacts.spec.ts`: assert the timeline is visible in the LP happy path.
- Modify `docs/web-v1-acceptance.md`: add manual acceptance checks for Stage 43 timeline/recovery polish.
- Modify `docs/alpha-release-candidate.md`: route RC checks through the polished timeline/recovery UI.
- Modify `docs/project-roadmap.md`: mark Stage 43 complete and move Stage 44 to current recommendation.
- Modify `docs/superpowers/README.md`: index this implementation plan.

---

### Task 1: Localized Timeline Copy

**Files:**
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`

- [ ] **Step 1: Write the failing i18n test**

Add this assertion to `apps/web/src/lib/i18n.test.ts` inside the existing recovery copy test, after `recoveryErrorLabel` assertions:

```ts
    expect(en.chat.runTimelineTitle).toBe("Run timeline");
    expect(en.chat.runTimelineSubtitle).toBe("Planner to deployment handoff");
    expect(en.chat.runTimelinePending).toBe("Not started");
    expect(en.chat.runTimelineActive).toBe("Active");
    expect(en.chat.runTimelineActionGroupLabels).toEqual({
      executable: "Actions",
      guidance: "Guidance"
    });
    expect(en.chat.runTimelineMarkerLabels).toEqual({
      repair_started: "Repair started",
      repaired: "Repaired",
      repair_failed: "Repair failed",
      retry_scheduled: "Retry scheduled",
      retry_exhausted: "Retry exhausted",
      retry_attempt: "Retry attempt",
      handoff_ready: "Handoff ready",
      handoff_consumed: "Handoff consumed",
      handoff_blocked: "Handoff blocked"
    });

    expect(zh.chat.runTimelineTitle).toBe("运行时间线");
    expect(zh.chat.runTimelineSubtitle).toBe("从规划到部署交接");
    expect(zh.chat.runTimelinePending).toBe("未开始");
    expect(zh.chat.runTimelineActive).toBe("当前步骤");
    expect(zh.chat.runTimelineActionGroupLabels).toEqual({
      executable: "可执行动作",
      guidance: "处理建议"
    });
    expect(zh.chat.runTimelineMarkerLabels).toEqual({
      repair_started: "开始修复",
      repaired: "已修复",
      repair_failed: "修复失败",
      retry_scheduled: "已安排重试",
      retry_exhausted: "重试耗尽",
      retry_attempt: "重试尝试",
      handoff_ready: "交接就绪",
      handoff_consumed: "交接已消费",
      handoff_blocked: "交接阻塞"
    });
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts
```

Expected: FAIL with TypeScript or assertion errors for missing `runTimeline*` copy fields.

- [ ] **Step 3: Add copy contract and locale values**

In `apps/web/src/lib/i18n.ts`, extend `WorkbenchCopy["chat"]` after `recoveryErrorLabel`:

```ts
    runTimelineTitle: string;
    runTimelineSubtitle: string;
    runTimelinePending: string;
    runTimelineActive: string;
    runTimelineActionGroupLabels: Record<"executable" | "guidance", string>;
    runTimelineMarkerLabels: Record<
      | "repair_started"
      | "repaired"
      | "repair_failed"
      | "retry_scheduled"
      | "retry_exhausted"
      | "retry_attempt"
      | "handoff_ready"
      | "handoff_consumed"
      | "handoff_blocked",
      string
    >;
```

Add English values after `recoveryErrorLabel`:

```ts
      recoveryErrorLabel: "Recovery action could not be completed.",
      runTimelineTitle: "Run timeline",
      runTimelineSubtitle: "Planner to deployment handoff",
      runTimelinePending: "Not started",
      runTimelineActive: "Active",
      runTimelineActionGroupLabels: {
        executable: "Actions",
        guidance: "Guidance"
      },
      runTimelineMarkerLabels: {
        repair_started: "Repair started",
        repaired: "Repaired",
        repair_failed: "Repair failed",
        retry_scheduled: "Retry scheduled",
        retry_exhausted: "Retry exhausted",
        retry_attempt: "Retry attempt",
        handoff_ready: "Handoff ready",
        handoff_consumed: "Handoff consumed",
        handoff_blocked: "Handoff blocked"
      },
```

Add Chinese values after `recoveryErrorLabel`:

```ts
      recoveryErrorLabel: "恢复动作未能完成。",
      runTimelineTitle: "运行时间线",
      runTimelineSubtitle: "从规划到部署交接",
      runTimelinePending: "未开始",
      runTimelineActive: "当前步骤",
      runTimelineActionGroupLabels: {
        executable: "可执行动作",
        guidance: "处理建议"
      },
      runTimelineMarkerLabels: {
        repair_started: "开始修复",
        repaired: "已修复",
        repair_failed: "修复失败",
        retry_scheduled: "已安排重试",
        retry_exhausted: "重试耗尽",
        retry_attempt: "重试尝试",
        handoff_ready: "交接就绪",
        handoff_consumed: "交接已消费",
        handoff_blocked: "交接阻塞"
      },
```

- [ ] **Step 4: Run the i18n test**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add apps/web/src/lib/i18n.ts apps/web/src/lib/i18n.test.ts
git commit -m "add run timeline copy"
```

---

### Task 2: Pure Run Timeline View Model

**Files:**
- Create: `apps/web/src/app/run-timeline-view-model.ts`
- Create: `apps/web/src/app/run-timeline-view-model.test.ts`

- [ ] **Step 1: Write failing view-model tests**

Create `apps/web/src/app/run-timeline-view-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getWorkbenchCopy } from "../lib/i18n";
import type { LiveTaskStatePayload } from "../lib/workbench-store";
import { buildRunTimelineViewModel } from "./run-timeline-view-model";

function createPayload(
  overrides: Partial<LiveTaskStatePayload> = {}
): LiveTaskStatePayload {
  return {
    taskId: "task_1",
    projectId: "project_1",
    taskType: "lp_generation",
    taskStatus: "running",
    stateVersion: "state_1",
    isTerminal: false,
    nextPollMs: 1200,
    updatedAt: "2026-05-23T00:00:00.000Z",
    messages: [],
    runs: [],
    runEvents: [],
    recovery: { runs: [] },
    workerQueue: {
      projectId: "project_1",
      counts: {
        queued: 0,
        running: 0,
        stale: 0,
        completed: 0,
        failed: 0,
        rejected: 0,
        cancelled: 0
      },
      heartbeat: { status: "active" },
      logs: []
    },
    interrupt: {
      available: true,
      state: "idle",
      taskId: "task_1"
    },
    ...overrides
  };
}

describe("buildRunTimelineViewModel", () => {
  it("keeps the fixed LP role order and marks missing roles pending", () => {
    const copy = getWorkbenchCopy("en");
    const model = buildRunTimelineViewModel({
      payload: createPayload({
        runs: [
          {
            runId: "run_builder_1",
            projectId: "project_1",
            taskId: "task_1",
            role: "builder",
            state: "running",
            runRecordState: "running",
            startedAt: "2026-05-23T00:00:10.000Z",
            recoveryActions: []
          }
        ],
        recovery: { runs: [] }
      }),
      copy
    });

    expect(model.steps.map((step) => [step.role, step.state, step.status])).toEqual([
      ["planner", "pending", "pending"],
      ["builder", "running", "active"],
      ["reviewer", "pending", "pending"],
      ["deployer", "pending", "pending"]
    ]);
    expect(model.activeStep?.role).toBe("builder");
    expect(model.steps[0]?.stateLabel).toBe("Not started");
  });

  it("derives repair, retry, handoff, diagnostics, and action groups safely", () => {
    const copy = getWorkbenchCopy("en");
    const model = buildRunTimelineViewModel({
      payload: createPayload({
        isTerminal: true,
        runs: [
          {
            runId: "run_planner_1_retry_1",
            projectId: "project_1",
            taskId: "task_1",
            role: "planner",
            state: "completed",
            runRecordState: "completed",
            startedAt: "2026-05-23T00:00:00.000Z",
            completedAt: "2026-05-23T00:00:05.000Z",
            recoveryActions: []
          },
          {
            runId: "run_reviewer_1",
            projectId: "project_1",
            taskId: "task_1",
            role: "reviewer",
            state: "blocked",
            runRecordState: "needs_input",
            startedAt: "2026-05-23T00:00:08.000Z",
            diagnosticSummary: {
              code: "handoff_blocked",
              message: "Reviewer blocked deployment.",
              source: "handoff",
              errorName: "SAFE_CODE"
            },
            recoveryActions: ["resolve_blocker", "inspect_manually"]
          }
        ],
        runEvents: [
          {
            id: "event_repair",
            projectId: "project_1",
            taskId: "task_1",
            runId: "run_planner_1_retry_1",
            type: "model.output.repaired",
            createdAt: "2026-05-23T00:00:04.000Z",
            payload: { type: "model.output.repaired" }
          },
          {
            id: "event_retry",
            projectId: "project_1",
            taskId: "task_1",
            runId: "run_planner_1_retry_1",
            type: "model.retry.exhausted",
            createdAt: "2026-05-23T00:00:03.000Z",
            payload: { type: "model.retry.exhausted" }
          },
          {
            id: "event_handoff",
            projectId: "project_1",
            taskId: "task_1",
            runId: "run_reviewer_1",
            type: "handoff.blocked",
            createdAt: "2026-05-23T00:00:09.000Z",
            payload: {
              type: "handoff.blocked",
              handoffId: "handoff_1",
              fromRole: "reviewer",
              toRole: "deployer"
            }
          }
        ],
        recovery: {
          runs: [
            {
              runId: "run_reviewer_1",
              projectId: "project_1",
              taskId: "task_1",
              role: "reviewer",
              state: "blocked",
              runRecordState: "needs_input",
              startedAt: "2026-05-23T00:00:08.000Z",
              diagnosticSummary: {
                code: "handoff_blocked",
                message: "Reviewer blocked deployment.",
                source: "handoff"
              },
              recoveryActions: ["resolve_blocker", "inspect_manually"]
            }
          ]
        }
      }),
      copy
    });

    const planner = model.steps.find((step) => step.role === "planner");
    const reviewer = model.steps.find((step) => step.role === "reviewer");

    expect(planner?.markers.map((marker) => marker.label)).toEqual([
      "Retry attempt",
      "Repaired",
      "Retry exhausted"
    ]);
    expect(reviewer).toMatchObject({
      status: "attention",
      diagnosticMessage: "Reviewer blocked deployment.",
      diagnosticCode: "handoff_blocked",
      lastEventLabel: "Handoff blocked"
    });
    expect(reviewer?.guidanceActions.map((action) => action.label)).toEqual([
      "Resolve blocker",
      "Inspect manually"
    ]);
    expect(JSON.stringify(model)).not.toContain("RAW_SECRET");
  });
});
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
pnpm exec vitest run apps/web/src/app/run-timeline-view-model.test.ts
```

Expected: FAIL because `apps/web/src/app/run-timeline-view-model.ts` does not exist.

- [ ] **Step 3: Implement the view model**

Create `apps/web/src/app/run-timeline-view-model.ts`:

```ts
import type { WorkbenchCopy } from "../lib/i18n";
import type { LiveTaskStatePayload } from "../lib/workbench-store";

const lpRunTimelineRoles = ["planner", "builder", "reviewer", "deployer"] as const;
const activeStates = new Set(["queued", "running", "waiting_for_approval", "cancelling"]);
const attentionStates = new Set(["blocked", "failed"]);
const stoppedStates = new Set(["cancelled"]);
const executableActions = new Set(["resume_worker_finalization", "retry_run"]);

const markerByEventType = {
  "model.output.repair_started": "repair_started",
  "model.output.repaired": "repaired",
  "model.output.repair_failed": "repair_failed",
  "model.retry.scheduled": "retry_scheduled",
  "model.retry.exhausted": "retry_exhausted",
  "handoff.created": "handoff_ready",
  "handoff.consumed": "handoff_consumed",
  "handoff.blocked": "handoff_blocked"
} as const;

export type RunTimelineRole = (typeof lpRunTimelineRoles)[number];
export type RunTimelineStepState = LiveTaskStatePayload["runs"][number]["state"] | "pending";
export type RunTimelineStepStatus =
  | "pending"
  | "active"
  | "complete"
  | "attention"
  | "stopped";
export type RunTimelineMarkerKind =
  | "repair_started"
  | "repaired"
  | "repair_failed"
  | "retry_scheduled"
  | "retry_exhausted"
  | "retry_attempt"
  | "handoff_ready"
  | "handoff_consumed"
  | "handoff_blocked";

export interface RunTimelineActionView {
  action: string;
  label: string;
}

export interface RunTimelineMarkerView {
  kind: RunTimelineMarkerKind;
  label: string;
}

export interface RunTimelineStepView {
  role: RunTimelineRole;
  label: string;
  runId?: string;
  state: RunTimelineStepState;
  stateLabel: string;
  status: RunTimelineStepStatus;
  isActive: boolean;
  startedAt?: string;
  completedAt?: string;
  diagnosticMessage?: string;
  diagnosticCode?: string;
  lastEventLabel?: string;
  markers: RunTimelineMarkerView[];
  executableActions: RunTimelineActionView[];
  guidanceActions: RunTimelineActionView[];
}

export interface RunTimelineViewModel {
  title: string;
  subtitle: string;
  steps: RunTimelineStepView[];
  activeStep?: RunTimelineStepView;
}

export function buildRunTimelineViewModel({
  payload,
  copy
}: {
  payload: Pick<LiveTaskStatePayload, "runs" | "runEvents" | "recovery">;
  copy: WorkbenchCopy;
}): RunTimelineViewModel {
  const latestRunByRole = new Map<RunTimelineRole, LiveTaskStatePayload["runs"][number]>();
  for (const run of payload.runs) {
    if (isTimelineRole(run.role)) {
      latestRunByRole.set(run.role, run);
    }
  }

  const recoveryByRunId = new Map(
    payload.recovery.runs.map((run) => [run.runId, run])
  );

  const steps = lpRunTimelineRoles.map((role) => {
    const run = latestRunByRole.get(role);
    const recoveryRun = run ? recoveryByRunId.get(run.runId) : undefined;
    const effectiveRun = recoveryRun ?? run;

    if (!effectiveRun) {
      return {
        role,
        label: copy.modelsView.roleLabels[role],
        state: "pending",
        stateLabel: copy.chat.runTimelinePending,
        status: "pending",
        isActive: false,
        markers: [],
        executableActions: [],
        guidanceActions: []
      } satisfies RunTimelineStepView;
    }

    const markers = buildMarkers({
      copy,
      runId: effectiveRun.runId,
      events: payload.runEvents
    });

    return {
      role,
      label: copy.modelsView.roleLabels[role],
      runId: effectiveRun.runId,
      state: effectiveRun.state,
      stateLabel: copy.chat.recoveryStateLabels[effectiveRun.state],
      status: classifyStatus(effectiveRun.state),
      isActive: activeStates.has(effectiveRun.state),
      startedAt: effectiveRun.startedAt,
      completedAt: effectiveRun.completedAt,
      diagnosticMessage: effectiveRun.diagnosticSummary?.message,
      diagnosticCode: effectiveRun.diagnosticSummary?.code,
      lastEventLabel: getLastEventLabel({
        copy,
        runId: effectiveRun.runId,
        events: payload.runEvents
      }),
      markers,
      executableActions: buildActions({
        actions: effectiveRun.recoveryActions,
        labels: copy.chat.recoveryActionLabels,
        includeExecutable: true
      }),
      guidanceActions: buildActions({
        actions: effectiveRun.recoveryActions,
        labels: copy.chat.recoveryGuidanceLabels,
        includeExecutable: false
      })
    } satisfies RunTimelineStepView;
  });

  return {
    title: copy.chat.runTimelineTitle,
    subtitle: copy.chat.runTimelineSubtitle,
    steps,
    activeStep: steps.find((step) => step.isActive)
  };
}

function isTimelineRole(role: string): role is RunTimelineRole {
  return lpRunTimelineRoles.includes(role as RunTimelineRole);
}

function classifyStatus(state: Exclude<RunTimelineStepState, "pending">): RunTimelineStepStatus {
  if (activeStates.has(state)) {
    return "active";
  }
  if (attentionStates.has(state)) {
    return "attention";
  }
  if (stoppedStates.has(state)) {
    return "stopped";
  }
  return "complete";
}

function buildMarkers({
  copy,
  events,
  runId
}: {
  copy: WorkbenchCopy;
  events: LiveTaskStatePayload["runEvents"];
  runId: string;
}): RunTimelineMarkerView[] {
  const markers: RunTimelineMarkerView[] = [];
  if (/_retry_\d+$/.test(runId)) {
    markers.push({
      kind: "retry_attempt",
      label: copy.chat.runTimelineMarkerLabels.retry_attempt
    });
  }

  for (const event of events.filter((candidate) => candidate.runId === runId)) {
    const kind = markerByEventType[event.type as keyof typeof markerByEventType];
    if (kind) {
      markers.push({ kind, label: copy.chat.runTimelineMarkerLabels[kind] });
    }
  }

  const seen = new Set<RunTimelineMarkerKind>();
  return markers.filter((marker) => {
    if (seen.has(marker.kind)) {
      return false;
    }
    seen.add(marker.kind);
    return true;
  });
}

function getLastEventLabel({
  copy,
  events,
  runId
}: {
  copy: WorkbenchCopy;
  events: LiveTaskStatePayload["runEvents"];
  runId: string;
}): string | undefined {
  const latest = [...events]
    .filter((event) => event.runId === runId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .at(-1);
  if (!latest) {
    return undefined;
  }
  const kind = markerByEventType[latest.type as keyof typeof markerByEventType];
  return kind ? copy.chat.runTimelineMarkerLabels[kind] : latest.type;
}

function buildActions({
  actions,
  includeExecutable,
  labels
}: {
  actions: string[];
  includeExecutable: boolean;
  labels: Partial<Record<string, string>>;
}): RunTimelineActionView[] {
  return actions
    .filter((action) => executableActions.has(action) === includeExecutable)
    .map((action) => ({
      action,
      label: labels[action] ?? action
    }));
}
```

- [ ] **Step 4: Run the view-model test**

Run:

```bash
pnpm exec vitest run apps/web/src/app/run-timeline-view-model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add apps/web/src/app/run-timeline-view-model.ts apps/web/src/app/run-timeline-view-model.test.ts
git commit -m "derive run timeline view model"
```

---

### Task 3: Compact Live Task Role Summary

**Files:**
- Modify: `apps/web/src/app/live-task-panel.tsx`
- Modify: `apps/web/src/app/live-task-panel.test.ts`
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Write the failing live task summary test**

In `apps/web/src/app/live-task-panel.test.ts`, update the first `LiveTaskStatusSummary` test by adding `roleLabels` to `copy` and changing the active run expectation:

```ts
    const copy = {
      ...getWorkbenchCopy("en").chat,
      roleLabels: getWorkbenchCopy("en").modelsView.roleLabels
    };
```

Add these assertions after `expect(text).toContain("Task is running");`:

```ts
    expect(text).toContain("Builder · Running");
    expect(text).not.toContain("builder · running");
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
pnpm exec vitest run apps/web/src/app/live-task-panel.test.ts
```

Expected: FAIL because `LiveTaskCopy` does not accept `roleLabels` and still renders raw role/state strings.

- [ ] **Step 3: Localize active role rendering**

In `apps/web/src/app/live-task-panel.tsx`, extend `LiveTaskCopy`:

```ts
export type LiveTaskCopy = Pick<
  WorkbenchCopy["chat"],
  | "liveTaskArtifactReady"
  | "liveTaskCompleted"
  | "liveTaskIdle"
  | "liveTaskRefreshError"
  | "liveTaskRunning"
  | "liveTaskTitle"
  | "recoveryStateLabels"
> & {
  roleLabels: WorkbenchCopy["modelsView"]["roleLabels"];
};
```

Replace the active run meta paragraph in `renderLiveTaskStatusContent`:

```tsx
      {activeRun ? (
        <p className="liveTaskMeta">
          {copy.roleLabels[activeRun.role]} · {copy.recoveryStateLabels[activeRun.state]}
        </p>
      ) : null}
```

In `apps/web/src/app/page.tsx`, extend `liveTaskCopy`:

```ts
  const liveTaskCopy = {
    liveTaskArtifactReady: copy.chat.liveTaskArtifactReady,
    liveTaskCompleted: copy.chat.liveTaskCompleted,
    liveTaskIdle: copy.chat.liveTaskIdle,
    liveTaskRefreshError: copy.chat.liveTaskRefreshError,
    liveTaskRunning: copy.chat.liveTaskRunning,
    liveTaskTitle: copy.chat.liveTaskTitle,
    recoveryStateLabels: copy.chat.recoveryStateLabels,
    roleLabels: copy.modelsView.roleLabels
  };
```

Update the `ArtifactWorkspaceView` prop type for `liveTaskCopy`:

```ts
  liveTaskCopy: {
    liveTaskArtifactReady: string;
    liveTaskCompleted: string;
    liveTaskIdle: string;
    liveTaskRefreshError: string;
    liveTaskRunning: string;
    liveTaskTitle: string;
    recoveryStateLabels: ReturnType<typeof getWorkbenchCopy>["chat"]["recoveryStateLabels"];
    roleLabels: ReturnType<typeof getWorkbenchCopy>["modelsView"]["roleLabels"];
  };
```

- [ ] **Step 4: Run the live task panel test**

Run:

```bash
pnpm exec vitest run apps/web/src/app/live-task-panel.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add apps/web/src/app/live-task-panel.tsx apps/web/src/app/live-task-panel.test.ts apps/web/src/app/page.tsx
git commit -m "localize live task run summary"
```

---

### Task 4: Render Timeline and Recovery Hierarchy

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Write failing page rendering tests**

Add this test to `apps/web/src/app/page.test.ts` near the existing recovery tests:

```ts
  it("renders a polished run timeline with repair retry and recovery hierarchy", async () => {
    pageMocks.currentTaskId = "task_1";
    pageMocks.pageState = createCompletedLpPageState({
      runEvents: [
        {
          id: "event_repaired",
          projectId: "project_1",
          taskId: "task_1",
          runId: "run_planner_1_retry_1",
          type: "model.output.repaired",
          createdAt: "2026-05-23T00:00:03.000Z",
          payload: { type: "model.output.repaired" }
        },
        {
          id: "event_handoff",
          projectId: "project_1",
          taskId: "task_1",
          runId: "run_reviewer_blocked",
          type: "handoff.blocked",
          createdAt: "2026-05-23T00:00:11.000Z",
          payload: {
            type: "handoff.blocked",
            handoffId: "handoff_1",
            summary: "RAW_HANDOFF_SECRET"
          }
        }
      ],
      recovery: {
        runs: [
          {
            runId: "run_planner_1_retry_1",
            projectId: "project_1",
            taskId: "task_1",
            role: "planner",
            state: "completed",
            runRecordState: "completed",
            startedAt: "2026-05-23T00:00:00.000Z",
            completedAt: "2026-05-23T00:00:05.000Z",
            recoveryActions: []
          },
          {
            runId: "run_builder_running",
            projectId: "project_1",
            taskId: "task_1",
            role: "builder",
            state: "running",
            runRecordState: "running",
            startedAt: "2026-05-23T00:00:06.000Z",
            recoveryActions: []
          },
          {
            runId: "run_reviewer_blocked",
            projectId: "project_1",
            taskId: "task_1",
            role: "reviewer",
            state: "blocked",
            runRecordState: "needs_input",
            startedAt: "2026-05-23T00:00:10.000Z",
            diagnosticSummary: {
              code: "handoff_blocked",
              message: "Reviewer blocked deployment.",
              source: "handoff",
              errorName: "RAW_DIAGNOSTIC_SECRET"
            },
            recoveryActions: ["resolve_blocker", "inspect_manually"]
          },
          {
            runId: "run_deployer_failed",
            projectId: "project_1",
            taskId: "task_1",
            role: "deployer",
            state: "failed",
            runRecordState: "failed",
            startedAt: "2026-05-23T00:00:12.000Z",
            diagnosticSummary: {
              code: "deployment_failed",
              message: "Deployment handoff failed safely.",
              source: "run_event"
            },
            recoveryActions: ["retry_run"]
          }
        ]
      }
    });

    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const text = collectText(page).join(" ");
    const recoveryForms = collectElements(page, "form").filter(
      (form) => form.props?.action === executeRunRecoveryAction
    );

    expect(text).toContain("Run timeline");
    expect(text).toContain("Planner");
    expect(text).toContain("Builder");
    expect(text).toContain("Reviewer");
    expect(text).toContain("Deployer");
    expect(text).toContain("Retry attempt");
    expect(text).toContain("Repaired");
    expect(text).toContain("Handoff blocked");
    expect(text).toContain("Actions");
    expect(text).toContain("Guidance");
    expect(text).toContain("Resolve blocker");
    expect(text).toContain("Inspect manually");
    expect(text).toContain("Retry run");
    expect(text).not.toContain("RAW_HANDOFF_SECRET");
    expect(text).not.toContain("RAW_DIAGNOSTIC_SECRET");
    expect(recoveryForms.map(collectFormPayload)).toContainEqual({
      taskId: "task_1",
      runId: "run_deployer_failed",
      action: "retry_run"
    });
  });
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts
```

Expected: FAIL because `Run timeline`, marker labels, and grouped action headings are not rendered.

- [ ] **Step 3: Render the timeline and improve recovery grouping**

In `apps/web/src/app/page.tsx`, import the view model:

```ts
import {
  buildRunTimelineViewModel,
  type RunTimelineStepView,
  type RunTimelineViewModel
} from "./run-timeline-view-model";
```

Add this component near `RecoveryBlock`:

```tsx
function RunTimelineBlock({
  pageState,
  copy
}: {
  pageState: TaskReadyPageState;
  copy: ReturnType<typeof getWorkbenchCopy>;
}) {
  const timeline = buildRunTimelineViewModel({
    payload: {
      runs: pageState.recovery.runs,
      runEvents: pageState.runEvents,
      recovery: pageState.recovery
    },
    copy
  });

  return (
    <section className="runTimelineBlock" aria-label={timeline.title}>
      <div className="runTimelineHeader">
        <div>
          <strong>{timeline.title}</strong>
          <p>{timeline.subtitle}</p>
        </div>
        {timeline.activeStep ? (
          <span>{copy.chat.runTimelineActive}: {timeline.activeStep.label}</span>
        ) : null}
      </div>
      <div className="runTimelineSteps">
        {timeline.steps.map((step) => (
          <RunTimelineStep key={step.role} step={step} />
        ))}
      </div>
    </section>
  );
}

function RunTimelineStep({ step }: { step: RunTimelineStepView }) {
  return (
    <div className="runTimelineStep" data-status={step.status}>
      <div className="runTimelineDot" aria-hidden="true" />
      <div className="runTimelineBody">
        <div className="toolEventTop">
          <strong>{step.label}</strong>
          <span>{step.stateLabel}</span>
        </div>
        {step.diagnosticMessage ? <p>{step.diagnosticMessage}</p> : null}
        {step.lastEventLabel ? <small>{step.lastEventLabel}</small> : null}
        {step.diagnosticCode ? <small>{step.diagnosticCode}</small> : null}
        {step.markers.length > 0 ? (
          <div className="runTimelineMarkers">
            {step.markers.map((marker) => (
              <span data-marker={marker.kind} key={marker.kind}>
                {marker.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
```

Render it after `LiveTaskPanel` and before `RecoveryBlock` in the assistant turn:

```tsx
                            {turnIndex === chat.turns.length - 1 &&
                            pageState.kind === "task_ready" ? (
                              <RunTimelineBlock pageState={pageState} copy={copy} />
                            ) : null}
```

In `RecoveryBlock`, add action group headings before executable and guidance groups:

```tsx
              {executable.length > 0 ? (
                <div className="recoveryActionGroup">
                  <strong>{copy.chat.runTimelineActionGroupLabels.executable}</strong>
                  <div className="recoveryActions">
                    {executable.map((action) => (
                      <form action={executeRunRecoveryAction} key={action}>
                        <input name="taskId" type="hidden" value={pageState.task.id} />
                        <input name="runId" type="hidden" value={run.runId} />
                        <input name="action" type="hidden" value={action} />
                        <button type="submit">{copy.chat.recoveryActionLabels[action]}</button>
                      </form>
                    ))}
                  </div>
                </div>
              ) : null}
              {guidance.length > 0 ? (
                <div className="recoveryActionGroup">
                  <strong>{copy.chat.runTimelineActionGroupLabels.guidance}</strong>
                  <div className="recoveryGuidance">
                    {guidance.map((action) => (
                      <span key={action}>{copy.chat.recoveryGuidanceLabels[action]}</span>
                    ))}
                  </div>
                </div>
              ) : null}
```

- [ ] **Step 4: Add timeline CSS**

In `apps/web/src/app/globals.css`, extend the block selector:

```css
.processBlock,
.runTimelineBlock,
.recoveryBlock,
.deliveryBlock,
.inlinePreview {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
}
```

Add these rules near the existing `.toolTimeline` / `.recoveryList` rules:

```css
.runTimelineHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 42px;
  border-bottom: 1px solid var(--line);
  padding: 0 13px;
}

.runTimelineHeader strong {
  font-size: 0.86rem;
  font-weight: 830;
}

.runTimelineHeader p {
  margin: 2px 0 0;
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1.4;
}

.runTimelineHeader span {
  color: var(--accent);
  font-size: 0.76rem;
  font-weight: 800;
  white-space: nowrap;
}

.runTimelineSteps {
  display: grid;
  padding: 6px 0;
}

.runTimelineStep {
  position: relative;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 2px;
  padding: 10px 13px;
}

.runTimelineStep:not(:last-child)::after {
  content: "";
  position: absolute;
  top: 28px;
  bottom: -10px;
  left: 21px;
  width: 1px;
  background: var(--line);
}

.runTimelineDot {
  position: relative;
  z-index: 1;
  width: 12px;
  height: 12px;
  margin-top: 4px;
  border: 2px solid var(--accent-line);
  border-radius: 999px;
  background: var(--surface-raised);
}

.runTimelineStep[data-status="active"] .runTimelineDot {
  background: #f59e0b;
  box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.12);
  animation: livePulse 1.4s ease-in-out infinite;
}

.runTimelineStep[data-status="complete"] .runTimelineDot {
  background: var(--accent);
}

.runTimelineStep[data-status="attention"] .runTimelineDot {
  background: var(--danger);
  box-shadow: 0 0 0 4px rgba(220, 38, 38, 0.12);
}

.runTimelineStep[data-status="stopped"] .runTimelineDot {
  background: #94a3b8;
  box-shadow: 0 0 0 4px rgba(148, 163, 184, 0.14);
}

.runTimelineBody {
  min-width: 0;
  display: grid;
  gap: 5px;
}

.runTimelineBody p {
  margin: 0;
  color: #3c4147;
  font-size: 0.88rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.runTimelineBody small {
  color: var(--muted);
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}

.runTimelineMarkers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.runTimelineMarkers span,
.recoveryActionGroup > strong {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0 8px;
  background: var(--surface-raised);
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 780;
  line-height: 1.2;
}

.recoveryActionGroup {
  display: grid;
  gap: 7px;
  min-width: 0;
}

@keyframes livePulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.08);
  }
}

@media (prefers-reduced-motion: reduce) {
  .runTimelineStep[data-status="active"] .runTimelineDot {
    animation: none;
  }
}
```

- [ ] **Step 5: Run focused page and CSS-safe tests**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts apps/web/src/app/run-timeline-view-model.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add apps/web/src/app/page.tsx apps/web/src/app/page.test.ts apps/web/src/app/globals.css
git commit -m "render run timeline recovery polish"
```

---

### Task 5: Browser Acceptance and Documentation Closeout

**Files:**
- Modify: `apps/web/e2e/helpers.ts`
- Modify: `apps/web/e2e/alpha-lp-artifacts.spec.ts`
- Modify: `docs/web-v1-acceptance.md`
- Modify: `docs/alpha-release-candidate.md`
- Modify: `docs/project-roadmap.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Add browser timeline helper**

In `apps/web/e2e/helpers.ts`, add:

```ts
export async function expectRunTimeline(page: Page) {
  const timeline = page.getByLabel("Run timeline");
  await expect(timeline).toBeVisible();
  await expect(timeline.getByText("Planner", { exact: true })).toBeVisible();
  await expect(timeline.getByText("Builder", { exact: true })).toBeVisible();
  await expect(timeline.getByText("Reviewer", { exact: true })).toBeVisible();
  await expect(timeline.getByText("Deployer", { exact: true })).toBeVisible();
  await expect(timeline.getByText("Handoff", { exact: false }).first()).toBeVisible();
}
```

In `apps/web/e2e/alpha-lp-artifacts.spec.ts`, import and call it:

```ts
import {
  expectDedicatedArtifactWorkspace,
  expectRunTimeline,
  expectSnippetFor,
  expectStaticLpArtifacts,
  expectWorkspaceSnippetFor,
  submitPrompt
} from "./helpers";
```

```ts
  await expectRunTimeline(page);
```

Place the call after the existing agent process role assertions and before artifact assertions.

- [ ] **Step 2: Run focused browser acceptance**

Run:

```bash
pnpm alpha:e2e -- apps/web/e2e/alpha-lp-artifacts.spec.ts
```

Expected: PASS. If Playwright treats the trailing file as unsupported for the package script, run:

```bash
pnpm exec playwright test --config playwright.config.ts apps/web/e2e/alpha-lp-artifacts.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Update manual acceptance docs**

In `docs/web-v1-acceptance.md`, add a Stage 43 check under the LP task / live progress section:

```md
- Run timeline：LP task 页面展示 `Run timeline`，并能看到 Planner、Builder、Reviewer、Deployer 四个步骤、当前 active step、handoff / repair / retry 标记和安全 recovery action / guidance；页面不得展示 raw provider response、raw tool output、完整 artifact 内容、本机路径或 secret。
```

In `docs/alpha-release-candidate.md`, add Stage 43 to the operator trial expectations:

```md
- Run timeline / recovery：在 LP 任务完成或失败时检查固定链路四步状态、handoff 标记、repair/retry hint 和 recovery action hierarchy；所有诊断必须是 bounded copy 或 safe code。
```

- [ ] **Step 4: Update roadmap and Superpowers index**

In `docs/project-roadmap.md`, move Stage 43 out of current recommendation:

```md
### Stage 43：Run Timeline and Recovery UX Polish v0

**状态：** 已实现。
```

Add an implementation summary under Stage 43:

```md
已实现范围：

- Web-only run timeline view model 从现有 safe live task payload 派生 Planner / Builder / Reviewer / Deployer 固定链路显示。
- Timeline 展示 active / completed / failed / cancelled / blocked / pending 状态、repair/retry marker 和 handoff marker。
- Recovery block 按可执行动作和指导性动作分组，动作仍绑定具体 run 并走既有 server action。
- Live task compact summary 使用本地化 role/state label。
- Browser acceptance 覆盖 LP happy path timeline 可见性。
```

Change Stage 44 status to:

```md
**状态：** 当前推荐。
```

Add a decision record:

```md
- 2026-05-23 Stage 43 已完成 Run Timeline and Recovery UX Polish v0：Web 现在从 existing safe task state 派生固定 LP 链路 timeline、repair/retry/handoff markers、active progress affordance 和 recovery action hierarchy；默认下一路由为 Stage 44 Skills and Models Client-side Management v0。
```

In `docs/superpowers/README.md`, add this plan after the Stage 43 design entry:

```md
114. `plans/2026-05-23-run-timeline-recovery-ux-polish.md`
   - Stage 43 Run Timeline and Recovery UX Polish v0 implementation plan（当前执行）。
   - 在 Stage 43 design 后阅读，用于按 TDD 实现 Web-only run timeline view model、localized active role summary、timeline/recovery rendering、browser acceptance 和 roadmap closeout。
```

- [ ] **Step 5: Run deterministic verification**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts apps/web/src/app/run-timeline-view-model.test.ts apps/web/src/app/live-task-panel.test.ts apps/web/src/app/page.test.ts
pnpm alpha:check
pnpm typecheck
pnpm alpha:e2e
git diff --check
```

Expected:

- Focused Vitest: PASS.
- `pnpm alpha:check`: PASS.
- `pnpm typecheck`: PASS.
- `pnpm alpha:e2e`: PASS.
- `git diff --check`: no output.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add apps/web/e2e/helpers.ts apps/web/e2e/alpha-lp-artifacts.spec.ts docs/web-v1-acceptance.md docs/alpha-release-candidate.md docs/project-roadmap.md docs/superpowers/README.md
git commit -m "complete run timeline recovery polish"
```

---

## Final Closeout

- [ ] Confirm `git status --short --branch` is clean in the implementation worktree.
- [ ] Confirm Stage 43 implementation branch is merged to `main`, or explicitly report if it is not merged.
- [ ] Confirm `docs/project-roadmap.md` marks Stage 43 complete and leaves Stage 44-46 queue non-empty.
- [ ] Confirm `docs/superpowers/README.md` indexes both the Stage 43 design and this implementation plan.
- [ ] Confirm `docs/agent-development-learning.md` still reflects the Web-only view-model fact/source boundary from the Stage 43 design.
- [ ] Report the exact verification commands and outcomes in the final response.
