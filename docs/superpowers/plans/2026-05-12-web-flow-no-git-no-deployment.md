# Web Flow Without Git or Automatic Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Git repository capture and automatic deployment from the current Web project flow while keeping local project creation, LP generation, review, downloads, and preview working.

**Architecture:** The shared project model becomes name-only. Web server actions and store validation create projects from `projectName` only. Prompt submission stops after review, and the chat/page view models render completed output from brief plus page version without requiring deployment.

**Tech Stack:** TypeScript, Next.js 15 server components/actions, Vitest, existing in-memory workbench service.

---

## File Structure

- Modify `packages/db/src/workbench-repositories.ts`
  - Remove `ProjectRecord.repository`.

- Modify `packages/api/src/index.ts`
  - Remove `CreateProjectInput.repository`.
  - Create project records with `id`, `name`, and `createdAt`.
  - Keep explicit deployment API available for future use.

- Modify `apps/web/src/lib/workbench-store.ts`
  - Remove repository validation and `repository_required`.
  - Stop calling `approveAndCreateDeployment` from Web prompt submission.

- Modify `apps/web/src/app/actions.ts`
  - Read only `projectName` in `createProjectAction`.

- Modify `apps/web/src/app/page.tsx`
  - Remove repository form controls.
  - Render projects by name only.
  - Build completed state from brief plus page version.
  - Remove deployment navigation and handoff rendering.

- Modify `apps/web/src/lib/chat-workbench.ts`
  - Remove deployment input.
  - Emit planner, builder, and reviewer tool events only.
  - Use static artifact download links only.

- Modify tests beside each changed unit.

- Modify Superpowers docs and README index.

## Tasks

### Task 1: Domain Model Removes Repository

**Files:**
- Modify `packages/db/src/workbench-repositories.ts`
- Modify `packages/db/src/workbench-repositories.test.ts`
- Modify `packages/api/src/index.ts`
- Modify `packages/api/src/services.test.ts`
- Modify `apps/agent-worker/src/worker.ts`
- Modify `apps/agent-worker/src/worker.test.ts`

- [x] Write failing tests that construct `ProjectRecord` without `repository` and call `createProject({ name })`.
- [x] Run targeted tests and confirm the old model fails.
- [x] Remove repository from the shared project record and create-project input.
- [x] Update worker demo project creation to name-only.
- [x] Run targeted tests.

### Task 2: Web Store and Actions Remove Repository

**Files:**
- Modify `apps/web/src/lib/workbench-store.ts`
- Modify `apps/web/src/lib/workbench-store.test.ts`
- Modify `apps/web/src/app/actions.ts`
- Modify `apps/web/src/app/actions.test.ts`

- [x] Write failing tests for project-name-only creation and no deployment after Web prompt submission.
- [x] Run targeted tests and confirm failure.
- [x] Remove repository validation and `repository_required`.
- [x] Make `submitPrompt` stop after `reviewPageVersion`.
- [x] Run targeted tests.

### Task 3: Web UI and Chat Remove Deployment From Current Flow

**Files:**
- Modify `apps/web/src/app/page.tsx`
- Modify `apps/web/src/app/page.test.ts`
- Modify `apps/web/src/lib/chat-workbench.ts`
- Modify `apps/web/src/lib/chat-workbench.test.ts`
- Modify `apps/web/src/lib/i18n.ts`
- Modify `apps/web/src/lib/i18n.test.ts`

- [x] Write failing tests for no repository form, no deployment nav, planner/builder/reviewer order, and no handoff artifact card.
- [x] Run targeted tests and confirm failure.
- [x] Remove repository form controls and repository project display.
- [x] Remove deployment navigation from the current shell.
- [x] Make completed state require brief and page version only.
- [x] Remove deployment input and deployer event from the chat view model.
- [x] Update localized copy away from repository handoff language.
- [x] Run targeted tests.

### Task 4: Documentation and Verification

**Files:**
- Modify `docs/superpowers/README.md`
- Modify `docs/superpowers/specs/2026-05-12-lightweight-real-web-project-flow-spec.md`
- Create `docs/superpowers/specs/2026-05-12-web-flow-no-git-no-deployment-spec.md`
- Create `docs/superpowers/plans/2026-05-12-web-flow-no-git-no-deployment.md`

- [x] Add the new amendment spec and plan to the Superpowers README reading order.
- [x] Run `pnpm test`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm build`.
- [x] Start the Web dev server and manually verify project creation, prompt submission, completed downloads, and refresh behavior.

## Self-Review

- Spec coverage: repository removal, Web deployment deferral, static artifact downloads, chat timeline changes, and docs maintenance are covered.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: project creation uses `{ name }`; Web completed state uses `brief + currentPageVersion`; deployment remains explicit future API only.
