# Browser Failure Injection and Visual Regression Implementation Plan

> **For agentic workers:** Follow this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the deterministic Playwright alpha gate with bounded failure injection and lightweight layout visual regression without changing runtime behavior.

**Status:** Implemented.

**Architecture:** Reuse the existing Playwright config and isolated JSON state. Add failure specs that drive safe query/UI inputs and a visual spec that checks stable layout geometry plus diagnostic screenshots. Keep Vitest `alpha:check` unchanged.

**Tech Stack:** pnpm workspace, Next.js app router, Playwright Chromium, deterministic JSON-file workbench state.

---

## File Structure

- Modify `apps/web/e2e/helpers.ts`: add project creation and layout assertion helpers.
- Add `apps/web/e2e/alpha-failures.spec.ts`: deterministic failure injection tests.
- Add `apps/web/e2e/alpha-visual.spec.ts`: layout visual contract test.
- Modify `README.md`: update alpha E2E scope and failure artifacts notes.
- Modify `docs/web-v1-acceptance.md`: update browser E2E automated coverage.
- Modify `docs/project-roadmap.md`: mark Stage 34 current/complete and keep next queue.
- Modify `docs/superpowers/README.md`: add Stage 34 docs.
- Add `docs/superpowers/specs/2026-05-22-browser-failure-visual-regression-design.md`.
- Add `docs/superpowers/plans/2026-05-22-browser-failure-visual-regression.md`.

---

## Task 1: Planning Docs

**Files:**
- Add `docs/superpowers/specs/2026-05-22-browser-failure-visual-regression-design.md`
- Add `docs/superpowers/plans/2026-05-22-browser-failure-visual-regression.md`
- Modify `docs/superpowers/README.md`
- Modify `docs/project-roadmap.md`

- [x] Add Stage 34 design spec with scope, non-goals, test strategy, and documentation requirements.
- [x] Add Stage 34 implementation plan.
- [x] Register both docs in `docs/superpowers/README.md`.
- [x] Mark Stage 34 as current in `docs/project-roadmap.md`.

## Task 2: Browser Failure Injection

**Files:**
- Modify `apps/web/e2e/helpers.ts`
- Add `apps/web/e2e/alpha-failures.spec.ts`

- [x] Add a `createProject` browser helper using real UI form submission.
- [x] Add bounded recovery error injection coverage.
- [x] Add Models provider fail-closed error coverage.
- [x] Add artifact invalid path / unknown path graceful failure coverage.
- [x] Add Skills worker queue bounded error coverage.

## Task 3: Lightweight Visual Contract

**Files:**
- Modify `apps/web/e2e/helpers.ts`
- Add `apps/web/e2e/alpha-visual.spec.ts`

- [x] Add layout geometry helper for sidebar/workspace/composer.
- [x] Add a desktop empty-workbench visual contract test.
- [x] Save diagnostic screenshot artifact through `testInfo.outputPath`.
- [x] Avoid committed screenshot baselines in v0.

## Task 4: Docs And Validation

**Files:**
- Modify `README.md`
- Modify `docs/web-v1-acceptance.md`
- Modify `docs/project-roadmap.md`
- Modify `docs/superpowers/plans/2026-05-22-browser-failure-visual-regression.md`

- [x] Update alpha E2E docs for failure injection, layout contract, and artifacts.
- [x] Mark plan steps complete.
- [x] Run focused Playwright tests while implementing.
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
- `pnpm alpha:e2e`: 8 passed after rerunning with approved local server permissions; the sandboxed first run failed with `listen EPERM 127.0.0.1:31031`.
- `git diff --check`: passed.

## Task 5: Closeout

**Files:**
- Modify `docs/project-roadmap.md`
- Modify `docs/superpowers/specs/2026-05-22-browser-failure-visual-regression-design.md`
- Modify `docs/superpowers/plans/2026-05-22-browser-failure-visual-regression.md`

- [x] Mark Stage 34 implemented and summarize completed scope.
- [x] Keep recommended next-stage queue at 3-5 items.
- [x] Confirm no `docs/agent-development-learning.md` update is needed because this stage does not alter Agent runtime concepts.
- [x] Commit, merge back to `main`, and clean up the worktree if verification passes.
