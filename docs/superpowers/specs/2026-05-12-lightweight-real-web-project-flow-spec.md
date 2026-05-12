# Lightweight Real Web Project Flow Spec

Date: 2026-05-12
Status: approved for implementation planning

Revision note: the current Web V1 scope is amended by
`2026-05-12-web-flow-no-git-no-deployment-spec.md`. That amendment removes
repository URL capture from project creation and defers automatic deployment
from the Web flow. Read that amendment after this document before
implementing or auditing current Web behavior.

## Summary

This Stage 2 Web slice replaces the fixed demo snapshot on the home page with a lightweight real project flow. Users can create a project, submit an LP prompt, generate the deterministic brief/page/review/deployment sequence, and refresh the page without losing the current project state.

The first implementation intentionally uses server-side in-memory storage plus a current-project session pointer. It does not introduce Postgres setup, Prisma repositories, authentication, or multi-user persistence. This keeps the Web MVP easy to run locally while establishing the UI and action boundaries that later Prisma-backed persistence can reuse.

## Goals

- Let a user create a project from the Web UI with a project name and repository URL.
- Store created projects in a server-side in-memory workbench store for the current dev server process.
- Remember the current project across refreshes with a cookie-based project pointer.
- Let a user submit an LP prompt through the chat composer.
- Execute the existing deterministic workflow for the selected project:
  1. `createBriefFromPrompt`
  2. `generatePageVersion`
  3. `reviewPageVersion`
  4. `approveAndCreateDeployment`
- Render the existing conversation UI from the selected project snapshot.
- Show an empty/project-start state when no current project exists.
- Show actionable localized errors for missing project name, missing repository URL, missing prompt, unknown project, and generation failures.
- Keep generated LP artifacts framework-free static HTML/CSS/JS.

## Non-Goals

- Postgres or Prisma-backed persistence.
- Persistent state across dev server restarts.
- Authentication, organization membership, or role enforcement.
- Realtime streaming, background job queues, or durable run events.
- True cancellation for the interrupt button.
- File uploads, URL ingestion, or product-feed ingestion.
- Skills binding, model routing, or MCP connector configuration.
- Multiple active browser sessions for different users.

## Current Baseline

The Web app currently renders `apps/web/src/app/page.tsx` as a conversation-style workbench, but it still calls `createDemoWorkbenchSnapshot()` on every request. That means every page load recreates the same deterministic project and completed run.

The existing useful boundaries are:

- `DemoWorkbenchService` in `packages/api/src/index.ts`, which already supports creating projects, generating briefs, generating page versions, reviewing page versions, creating deployments, and reading snapshots.
- Repository contracts in `packages/db/src/workbench-repositories.ts`, currently backed by in-memory repositories.
- `apps/web/src/lib/chat-workbench.ts`, which converts a completed demo snapshot into the conversation view model.
- `apps/web/src/lib/export-links.ts`, which creates data URL downloads for handoff and static artifacts.
- `apps/web/src/lib/i18n.ts`, which owns bilingual UI copy.

This slice should keep those boundaries and add Web-specific state/session helpers around them.

## Product Flow

### First Visit Without Current Project

When a request has no current project cookie, or the cookie points to a project that does not exist in the current in-memory store, the page should show:

- the same fixed sidebar and chat workspace shell,
- a project creation panel inside the conversation area,
- project name input,
- repository URL input,
- create button,
- a short localized note that this local MVP stores state for the current dev server process only.

The composer can be disabled or visually secondary until a project exists.

### Project Creation

Submitting the project form should:

1. validate that project name is not blank,
2. validate that repository URL is not blank,
3. call the shared in-memory workbench store to create a project,
4. set the current project cookie to the new project id,
5. redirect or revalidate the home page.

After creation, the page should show an empty conversation state for that project with the composer ready for a prompt.

### Prompt Submission

Submitting the chat composer should:

1. read the current project id from the cookie,
2. validate that the project exists in the in-memory store,
3. validate that the prompt is not blank,
4. call the deterministic workflow on the selected project,
5. revalidate the home page.

The resulting page should show:

- the user prompt,
- assistant intro and completion,
- planner/builder/reviewer/deployer process rows,
- artifact cards,
- static LP preview.

### Refresh Behavior

Refreshing the page should keep the current project and latest generated run visible as long as:

- the dev server process has not restarted,
- the project id cookie still points to an existing in-memory project.

If the dev server restarts, the cookie may point to a missing project. The page should clear or ignore that stale pointer and show the project creation state again.

## Architecture

### Web Store

Create a Web-only in-memory store in `apps/web/src/lib/workbench-store.ts`.

Responsibilities:

- own a singleton `DemoWorkbenchService`,
- create projects,
- list projects for sidebar display,
- get a project snapshot by id,
- submit a prompt for a project,
- return plain view-state objects suitable for page rendering,
- avoid exposing mutable repository objects to React components.

The store should be module-scoped. It is intentionally process-local.

### Session Pointer

Create `apps/web/src/lib/workbench-session.ts`.

Responsibilities:

- define a stable cookie name such as `lp-agent-current-project`,
- read current project id from Next cookies,
- set current project id after project creation,
- clear stale project id when needed.

The cookie stores only the project id. It must not store generated artifacts or prompts.

### Server Actions

Create `apps/web/src/app/actions.ts`.

Responsibilities:

- `createProjectAction(formData: FormData)`,
- `submitPromptAction(formData: FormData)`,
- convert validation failures into a predictable result shape,
- call `revalidatePath("/")` after successful mutation,
- set or clear the current project cookie through the session helper.

The first implementation can use form submissions and server actions. It does not need client-side React state.

### Page Rendering

Modify `apps/web/src/app/page.tsx` so it no longer calls `createDemoWorkbenchSnapshot()`.

The page should:

1. resolve locale from `Accept-Language`,
2. read current project id,
3. load Web workbench state from the store,
4. render project creation state when no project exists,
5. render empty project state when a project exists but no generated page exists,
6. render completed conversation state when artifacts exist.

The page should continue to use:

- `createArtifactDownloadLinks`,
- `createDeploymentHandoffLink`,
- `createChatWorkbenchThread`,
- `LPPreview`.

### Chat View Model

Extend `apps/web/src/lib/chat-workbench.ts` only where needed.

The builder should support:

- completed state with artifacts and deployment,
- empty project state without artifacts,
- preserving the submitted user prompt from the latest brief,
- localized composer labels.

The artifact cards should still be created only when a page version and deployment exist.

## Error Handling

Use typed, localized action result codes rather than throwing raw errors into the UI.

Recommended action error codes:

- `project_name_required`
- `repository_required`
- `prompt_required`
- `project_not_found`
- `generation_failed`

The UI should show a compact error message near the relevant form. Server logs can still receive the underlying exception for development.

## Localization

Add copy to `apps/web/src/lib/i18n.ts` for:

- project creation title,
- project name label,
- repository label,
- create project button,
- local MVP persistence note,
- empty project prompt guidance,
- composer submit label if needed,
- validation and generation errors.

Do not hard-code new user-facing text in React components.

## Testing Requirements

Add tests before implementation for:

- creating a project in the Web store returns a project and makes it listable,
- submitting a prompt creates a snapshot with brief, page version, review, deployment, and artifacts,
- missing current project returns an empty page state,
- stale current project id returns an empty page state instead of throwing,
- validation maps blank project name, repository, and prompt to typed errors,
- localized copy exposes the new project-flow labels and errors.

After implementation, verify:

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

For Web behavior, start `pnpm dev` and check:

- creating a project updates the page,
- submitting a prompt renders tool progress and artifact cards,
- refreshing the browser keeps the selected project visible,
- restarting the dev server resets process-local state and returns to the creation state.

## Future Compatibility

This slice should be easy to replace with stronger persistence later:

- `workbench-store.ts` can swap its in-memory service for Prisma-backed repositories.
- The cookie project pointer can remain valid when projects become database records.
- Server actions can keep the same public shape while changing internal storage.
- Skills, model routing, and MCP configuration can attach to the created project id in later slices.
- Desktop builds can reuse the same store interface with a desktop-local persistence adapter.
