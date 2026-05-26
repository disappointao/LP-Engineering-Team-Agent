# Manus Style Task Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Web workbench 的 LP 任务进度和 composer 操作改成 Manus 风格：普通聊天保持干净，复杂任务显示用户可理解的执行步骤，发送/停止共用主按钮区域。

**Architecture:** 新增 Web-only task progress view model，把现有 live task payload/runs/artifact readiness 映射为 4 步用户语言状态；`LiveTaskPanel` 只负责展示该投影。`StreamingWorkbench` 的 composer 根据 interrupt state 决定显示发送按钮或停止按钮，不再常驻 runtime chip/disabled interrupt 文案。

**Tech Stack:** Next.js App Router、React client components、TypeScript、Vitest、Playwright。

---

### Task 1: Task Progress View Model

**Files:**
- Create: `apps/web/src/app/task-progress-view-model.ts`
- Test: `apps/web/src/app/task-progress-view-model.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/src/app/task-progress-view-model.test.ts` with these cases:

```ts
import { describe, expect, it } from "vitest";
import { buildTaskProgressViewModel } from "./task-progress-view-model";

describe("task progress view model", () => {
  it("returns no card for ordinary chat tasks", () => {
    expect(buildTaskProgressViewModel({ taskType: "general_chat" })).toBeUndefined();
  });

  it("shows the planning step while planner is active", () => {
    expect(
      buildTaskProgressViewModel({
        taskType: "lp_generation",
        payload: {
          isTerminal: false,
          runs: [{ role: "planner", state: "running" }],
          taskId: "task_1"
        }
      })
    ).toMatchObject({
      activeStepIndex: 1,
      currentLabel: "规划页面结构和内容",
      progressLabel: "2 / 4",
      status: "running"
    });
  });

  it("shows ready state when artifacts are available", () => {
    expect(
      buildTaskProgressViewModel({
        taskType: "lp_generation",
        payload: {
          artifactProgress: {
            artifactWorkspaceId: "workspace_1",
            changedFileCount: 3,
            fileCount: 3,
            previewVersionKey: "version_1"
          },
          isTerminal: true,
          runs: [],
          taskId: "task_1"
        }
      })
    ).toMatchObject({
      activeStepIndex: 3,
      currentLabel: "检查并准备交付",
      resultLabel: "页面文件已准备好",
      status: "complete"
    });
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run apps/web/src/app/task-progress-view-model.test.ts`

Expected: FAIL because `task-progress-view-model` does not exist.

- [ ] **Step 3: Implement the view model**

Create `apps/web/src/app/task-progress-view-model.ts` exporting `buildTaskProgressViewModel`. Use `taskType !== "lp_generation"` to return `undefined`; map active roles to indices: planner `1`, builder `2`, reviewer/deployer `3`, no active run `0`; artifact ready terminal state returns complete index `3`.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run apps/web/src/app/task-progress-view-model.test.ts`

Expected: PASS.

### Task 2: Manus Task Progress Card

**Files:**
- Modify: `apps/web/src/app/live-task-panel.tsx`
- Modify: `apps/web/src/app/globals.css`
- Test: `apps/web/src/app/live-task-panel.test.ts`

- [ ] **Step 1: Write failing render tests**

Update `apps/web/src/app/live-task-panel.test.ts` to assert `LiveTaskStatusSummary` renders:

```ts
expect(text).toContain("规划页面结构和内容");
expect(text).toContain("2 / 4");
expect(text).not.toContain("Live task progress");
```

Also assert ordinary or missing task payload does not show artifact/debug-only copy.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run apps/web/src/app/live-task-panel.test.ts`

Expected: FAIL because the existing panel renders `Live task progress`.

- [ ] **Step 3: Implement card UI**

Import `buildTaskProgressViewModel` in `live-task-panel.tsx`. Render a compact `.taskProgressCard` with `.taskProgressIcon`, `.taskProgressMain`, `.taskProgressStatus`, `.taskProgressCount`, and optional `.taskProgressResult`. Keep the existing polling and refresh logic unchanged.

- [ ] **Step 4: Style card**

Add CSS in `globals.css` for the card: 8px radius, white surface, subtle border, compact width, status dot animation for `data-status="running"`, no nested decorative cards.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm exec vitest run apps/web/src/app/live-task-panel.test.ts`

Expected: PASS.

### Task 3: Composer Single Primary Action

**Files:**
- Modify: `apps/web/src/app/streaming-workbench.tsx`
- Modify: `apps/web/src/app/streaming-workbench.test.ts`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Write failing tests**

Add tests in `streaming-workbench.test.ts` for a pure helper `getComposerPrimaryAction`:

```ts
expect(getComposerPrimaryAction({ interruptState: "not_interruptible", isPromptDisabled: false })).toEqual("send");
expect(getComposerPrimaryAction({ interruptState: "interruptible", isPromptDisabled: false })).toEqual("stop");
expect(getComposerPrimaryAction({ interruptState: "interrupting", isPromptDisabled: true })).toEqual("stopping");
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run apps/web/src/app/streaming-workbench.test.ts`

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement helper and props**

Change `StreamingWorkbenchProps` to accept `interruptState`, `interruptAction`, and `interruptLabels` instead of a pre-rendered always-visible `interruptControl`. Render only one visible primary button area: send when idle, stop/stopping when interruptible.

- [ ] **Step 4: Remove composer runtime chip**

Stop rendering `runtimeChip` in the composer. Keep model/runtime context visible in the top bar.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm exec vitest run apps/web/src/app/streaming-workbench.test.ts apps/web/src/app/page.test.ts`

Expected: PASS.

### Task 4: Page Wiring and Browser Contracts

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/e2e/alpha-chat.spec.ts`
- Modify: `apps/web/e2e/alpha-lp-artifacts.spec.ts`
- Modify: `apps/web/e2e/helpers.ts`

- [ ] **Step 1: Write failing assertions**

Update page/e2e tests so ordinary chat asserts no `Live task progress`, no `Cloud runtime`, and no `Nothing running`; LP asserts visible task progress card with `1 / 4` to `4 / 4` style copy and expandable agent details.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run apps/web/src/app/page.test.ts && pnpm exec playwright test apps/web/e2e/alpha-chat.spec.ts --config playwright.config.ts`

Expected: FAIL before wiring changes.

- [ ] **Step 3: Wire page props**

Update `page.tsx` to pass interrupt state/action labels directly to `StreamingWorkbench`; render `LiveTaskPanel` only for `pageState.kind === "task_ready"` and `pageState.task.type === "lp_generation"`.

- [ ] **Step 4: Verify GREEN**

Run focused tests:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts apps/web/src/app/streaming-workbench.test.ts apps/web/src/app/live-task-panel.test.ts
pnpm exec playwright test apps/web/e2e/alpha-chat.spec.ts apps/web/e2e/alpha-lp-artifacts.spec.ts --config playwright.config.ts
```

Expected: PASS.

### Task 5: Full Verification and Documentation

**Files:**
- Modify: `docs/project-roadmap.md`
- Modify: `docs/superpowers/README.md`
- Modify only if behavior changed conceptually: `docs/agent-development-learning.md`

- [ ] **Step 1: Run full checks**

Run:

```bash
pnpm typecheck
pnpm alpha:e2e
```

Expected: typecheck passes and Playwright reports `17 passed`.

- [ ] **Step 2: Update roadmap**

Mark Manus-style task experience as completed/current stage, record verification, and keep 3-5 next-stage candidates.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git status --short
git add -A
git commit -m "polish manus style task experience"
```
