# Chat Agent Workbench UI Spec

Date: 2026-05-12
Status: approved for implementation planning

## Summary

The Web workbench should move from a dashboard/card layout to a conversation-first agent interface similar to common ChatGPT and Manus-style workspaces. The goal is to make the LP generation flow feel like an interruptible agent session while preserving the current deterministic demo data, static LP artifact contract, and bilingual copy behavior.

This is a Web UI slice only. It does not change the generated LP artifact shape, runtime adapter contract, repository model, model gateway, MCP gateway, or deployment handoff behavior.

## Goals

- Keep the left navigation fixed to the viewport so it does not scroll with the main conversation body.
- Present the main workspace as a centered chat thread with user messages, assistant turns, tool-call progress, completion state, artifact cards, suggested follow-up prompts, and a bottom composer.
- Make tool progress visible inside the conversation, including planner, builder, reviewer, and deployer steps.
- Show generated LP outputs as framework-free artifacts: single-file HTML and the clear `index.html`, `styles.css`, `script.js` structure.
- Add an interrupt affordance in the composer so the UI has a clear place for future run cancellation.
- Preserve automatic Chinese and English copy selection from `Accept-Language`.
- Keep all first-version UI data deterministic and server-renderable.

## Non-Goals

- Realtime streaming from an agent runtime.
- Actual cancellation of running jobs.
- Persistent chat history.
- User-authenticated task management.
- Replacing the current deterministic demo workflow.
- Converting generated LP output into React, Next.js, Vue, or another framework.
- A desktop shell or native desktop packaging.

## Current Baseline

The current Web entry point is `apps/web/src/app/page.tsx`. It renders:

- a left sidebar with product navigation,
- a hero prompt surface,
- project metadata cards,
- brief, preview, section, and agent-run panels.

The layout is useful as a dashboard but does not yet communicate an agent conversation. The left sidebar is part of the page grid and the body can scroll as one surface, so the navigation does not behave like Manus-style fixed app chrome.

The existing data sources should stay in place:

- `createDemoWorkbenchSnapshot()` provides deterministic project, brief, artifact, review, and deployment state.
- `createArtifactDownloadLinks()` and `createDeploymentHandoffLink()` provide download-ready artifact links.
- `getWorkbenchCopy()` and `resolveLocaleFromAcceptLanguage()` provide bilingual copy.
- `LPPreview` remains available for a compact artifact preview when useful.

## UX Requirements

### App Shell

Use a full-height application shell:

- Left sidebar: fixed or sticky at viewport height, with independent overflow.
- Main workspace: independent vertical scroll area.
- Body: should not be the primary scroll container on desktop.
- Mobile: collapse into a single-column layout where the sidebar becomes a compact top section and the conversation remains usable.

### Sidebar

The sidebar should feel like an agent product navigation, not a marketing page:

- Brand area for LP Engineering Team Agent.
- Primary actions and nav items: workbench, skills, MCP, models, deployments.
- Project/task list showing the current LP task and a second example task.
- Bottom metadata for mode and language.

The task list is static in this slice. It prepares the UI for future persisted projects and task history without introducing new storage.

### Conversation Thread

The main content should be a chat transcript:

- A top bar with model/workspace label and lightweight actions.
- A right-aligned user request bubble based on the current demo prompt.
- A left-aligned assistant turn with agent identity, optional Lite badge, and response text.
- A tool-process block rendered as a vertical sequence of steps.
- A final delivery block with file cards and status.
- Suggested follow-up prompts below the completed turn.

The page should not use large hero typography, dashboard panels, or nested cards as the primary composition.

### Tool Calls and Process Display

Tool progress should show visible operations in the assistant turn:

- Planner extracts a structured LP brief from the user request.
- Builder generates static LP files and the single-file HTML bundle.
- Reviewer checks the artifact and reports pass/fail status.
- Deployer prepares repository handoff metadata.

Each tool row should include:

- a tool or role name,
- a compact status indicator,
- a short operation description,
- optional metadata such as review status, file count, or deployment branch.

This is display-only in the first slice. Later runtime streaming can replace the deterministic tool event data without changing the page layout.

### Artifact Delivery

The assistant turn should present generated outputs as attachment-style cards:

- PR handoff export.
- Single-file HTML export.
- Three-file export links for `index.html`, `styles.css`, and `script.js`.

The copy must continue to reinforce that the LP artifact is framework-free static HTML/CSS/JS. React or project scaffold language must not be introduced into the generated artifact path.

### Composer and Interrupt Affordance

The bottom composer should stay visually attached to the conversation workspace:

- Text input placeholder localized to Chinese and English.
- Attachment or add button.
- Runtime/context chip such as cloud computer or local runtime.
- Interrupt button shown as a first-version UI affordance.
- Send button.

The interrupt button does not cancel real work yet. It establishes the interaction location for the future runtime cancellation feature.

## Data and Component Boundary

Add a small pure TypeScript builder for chat UI data instead of embedding all transcript construction in the React page. The builder should convert the existing demo snapshot and localized copy into:

- user message,
- assistant intro and completion text,
- ordered tool events,
- artifact cards,
- suggested prompts,
- composer labels.

The page remains responsible for rendering and layout only.

Recommended file ownership:

- `apps/web/src/lib/chat-workbench.ts`: deterministic chat-thread view model.
- `apps/web/src/lib/chat-workbench.test.ts`: tests for tool event order, artifact cards, and localized prompt use.
- `apps/web/src/lib/i18n.ts`: additional chat/sidebar/composer copy.
- `apps/web/src/app/page.tsx`: render the chat shell.
- `apps/web/src/app/globals.css`: application-shell and conversation styling.

## Accessibility and Responsiveness

- Use semantic landmarks: `aside`, `nav`, `main` or `section`, `header`, `article`.
- Keep buttons and links keyboard reachable.
- Use `aria-label` for icon-only buttons.
- Ensure long generated filenames, branches, and prompts wrap safely.
- Avoid viewport-width font scaling.
- Keep button text inside fixed controls from overflowing on narrow screens.
- Ensure mobile layout does not trap the composer off-screen.

## Styling Direction

The visual direction should be quiet, utilitarian, and agent-product focused:

- Light neutral app chrome.
- Fixed gray sidebar.
- White or near-white conversation canvas.
- Compact tool rows with subtle borders.
- File cards styled like chat attachments.
- Restrained accent colors for running, completed, and review states.

The interface should resemble a production agent workspace rather than a landing page. Avoid oversized hero sections, decorative gradients, card-heavy dashboard grids, and one-note purple/blue palettes.

## Testing Requirements

Add focused tests before implementation:

- The chat-thread builder uses the localized demo prompt as the user message.
- The tool event order is planner, builder, reviewer, deployer.
- The artifact cards include PR handoff, single HTML, and three static file exports.
- The reviewer metadata reflects the current review status and findings count.

After implementation, verify:

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

For visual verification, start `pnpm dev` and inspect the page at the local dev URL. Confirm that desktop sidebar scrolling is independent from the main conversation and that the conversation remains usable at a narrow mobile viewport.

## Future Compatibility

This UI should be compatible with later Stage 2 and desktop work:

- Persisted runs can replace deterministic chat data by implementing the same view model shape.
- Runtime streaming can append tool events into the same process block.
- Real cancellation can bind to the composer interrupt control.
- Desktop packaging can reuse the fixed shell and chat view without changing generated LP artifact contracts.
- Model gateway and MCP gateway status can be added as richer tool metadata in the existing tool row pattern.
