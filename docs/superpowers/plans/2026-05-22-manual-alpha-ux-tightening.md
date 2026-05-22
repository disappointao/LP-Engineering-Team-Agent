# Manual Alpha UX Tightening Implementation Plan

> **For agentic workers:** Follow this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove high-friction manual alpha UX gaps by making visible sidebar and prompt affordances actually submit or navigate, while preserving existing runtime protocol and alpha boundaries.

**Status:** Implemented.

**Architecture:** Add Web-only server actions for current project/task selection, wire sidebar rows and quick prompt chips to existing server actions, tighten empty-state copy/CSS, then update focused tests and alpha acceptance docs.

**Tech Stack:** pnpm workspace, Next.js server actions, TypeScript, Vitest, existing Web workbench state/session helpers.

---

## File Structure

- Modify `apps/web/src/lib/workbench-session.ts`: add helper to clear current task cookie.
- Modify `apps/web/src/app/actions.ts`: add `startNewTaskAction`, `selectProjectAction`, and `selectTaskAction`.
- Modify `apps/web/src/app/page.tsx`: wire sidebar project/task/new-task controls and quick prompt forms.
- Modify `apps/web/src/app/globals.css`: add scoped styles for sidebar forms and quick prompt submit forms.
- Modify `apps/web/src/lib/i18n.ts`: add sidebar empty-task copy if needed.
- Modify `apps/web/src/app/actions.test.ts`: cover new server actions.
- Modify `apps/web/src/app/page.test.ts`: cover form wiring and empty state.
- Modify `docs/web-v1-acceptance.md`: update manual alpha checklist.
- Modify `docs/project-roadmap.md`: update Stage 33 status and next queue.
- Modify `docs/superpowers/README.md`: add Stage 33 spec/plan entries.

---

## Task 1: Planning Docs

**Files:**
- Add `docs/superpowers/specs/2026-05-22-manual-alpha-ux-tightening-design.md`
- Add `docs/superpowers/plans/2026-05-22-manual-alpha-ux-tightening.md`
- Modify `docs/superpowers/README.md`
- Modify `docs/project-roadmap.md`

- [x] Add Stage 33 design spec with scope, non-goals, test strategy, and documentation requirements.
- [x] Add Stage 33 implementation plan.
- [x] Register both docs in `docs/superpowers/README.md`.
- [x] Mark Stage 33 as current in `docs/project-roadmap.md`.

## Task 2: Sidebar Navigation Actions

**Files:**
- Modify `apps/web/src/lib/workbench-session.ts`
- Modify `apps/web/src/app/actions.ts`
- Modify `apps/web/src/app/actions.test.ts`

- [x] Add `clearCurrentTaskId()` session helper.
- [x] Implement `startNewTaskAction()` to clear current task and redirect.
- [x] Implement `selectProjectAction()` to validate project id, set current project, clear current task, and redirect.
- [x] Implement `selectTaskAction()` to validate task id, set current task/project, and redirect.
- [x] Add regression tests for valid and invalid action paths.

## Task 3: Page Wiring And Copy

**Files:**
- Modify `apps/web/src/app/page.tsx`
- Modify `apps/web/src/app/globals.css`
- Modify `apps/web/src/lib/i18n.ts`
- Modify `apps/web/src/app/page.test.ts`

- [x] Convert sidebar new-task, project rows, and task rows to real forms/buttons.
- [x] Replace fake empty task titles with explicit empty-state copy.
- [x] Convert entry chips and task suggestions to quick prompt submit forms.
- [x] Add focused CSS for forms/buttons without changing layout architecture.
- [x] Add render tests for hidden payloads and empty-state behavior.

## Task 4: Acceptance Docs And Validation

**Files:**
- Modify `docs/web-v1-acceptance.md`
- Modify `docs/project-roadmap.md`
- Modify `docs/superpowers/plans/2026-05-22-manual-alpha-ux-tightening.md`

- [x] Update manual alpha checklist for sidebar navigation and quick prompts.
- [x] Mark plan steps complete.
- [x] Run focused tests while implementing.
- [x] Run final validation:

```bash
pnpm alpha:check
pnpm smoke
pnpm test
pnpm typecheck
pnpm build
pnpm alpha:e2e
git diff --check
```

Completed validation:

- `pnpm alpha:check`: 127 passed.
- `pnpm smoke`: 2 passed.
- `pnpm test`: 1102 passed, 2 skipped.
- `pnpm typecheck`: passed.
- `pnpm build`: passed.
- `pnpm alpha:e2e`: 5 passed after rerunning with approved local server permissions; the sandboxed first run failed with `listen EPERM 127.0.0.1:31031`.
- `git diff --check`: passed.

## Task 5: Closeout

**Files:**
- Modify `docs/project-roadmap.md`
- Modify `docs/superpowers/specs/2026-05-22-manual-alpha-ux-tightening-design.md`
- Modify `docs/superpowers/plans/2026-05-22-manual-alpha-ux-tightening.md`

- [x] Mark Stage 33 implemented and summarize completed scope.
- [x] Keep recommended next-stage queue at 3-5 items.
- [x] Confirm no `docs/agent-development-learning.md` update is needed because this stage does not alter Agent runtime concepts.
- [x] Commit, merge back to `main`, and clean up the worktree if verification passes.
