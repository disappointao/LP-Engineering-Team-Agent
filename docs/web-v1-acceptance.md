# Web V1 Acceptance Checklist

Use this checklist before treating the current web workbench as a usable local MVP. The deterministic smoke command covers store-level behavior. This checklist covers visible web behavior and product boundaries.

## Preparation

- [ ] Dependencies are installed with `pnpm install`.
- [ ] `.env.local` exists. Deterministic local mode uses `REAL_MODEL_RUNTIME=0`.
- [ ] `pnpm smoke` passes.
- [ ] `pnpm dev` starts the web app and prints a local URL.

## First Screen

- [ ] The app opens to a Manus-like workbench layout with a fixed left navigation area and a large central conversation entry.
- [ ] The left navigation does not scroll with the main conversation content.
- [ ] A user can start with a normal chat prompt without first creating a project.
- [ ] A user can still create a project from the project entry flow.
- [ ] Chinese and English UI text follows the browser or environment language behavior documented for the current MVP.

## Ordinary Task Flow

- [ ] Submit a non-LP prompt, such as `帮我整理一个首页上线检查清单`.
- [ ] The task appears in the task list.
- [ ] The conversation detail opens in a chat-style layout.
- [ ] Tool or process rows, when present, render as progress/process information rather than final user content.
- [ ] The composer remains available after the ordinary task result and can submit a follow-up message in the same conversation.
- [ ] When there is no running worker job, the interrupt control is unavailable or fails gracefully without blocking the conversation.
- [ ] No LP artifact preview is shown for a normal chat task.

## LP Generation Flow

- [ ] Submit an LP prompt, such as `生成一个春季电商活动的静态 HTML 落地页`.
- [ ] The task appears as an LP generation task.
- [ ] The result contains a static artifact workspace with `index.html`, `styles.css`, and `script.js`.
- [ ] The generated artifact can be previewed locally.
- [ ] The generated LP artifact does not require React, Vue, Angular, Next.js, Vite, or another frontend framework build step.
- [ ] The visible conversation explains artifact generation as process output and final result output separately.

## Artifact Diff And Source Snippets

- [ ] The artifact diff list shows file-level metadata for `index.html`, `styles.css`, and `script.js`.
- [ ] Default artifact diff cards only show metadata; full source is shown only after clicking `Preview snippet`.
- [ ] Click `Preview snippet` for `index.html` and confirm the UI shows a bounded read-only source snippet. Implementation detail: this selects `artifactPath=index.html`.
- [ ] Click `Preview snippet` for `styles.css` and confirm the UI shows a bounded read-only source snippet. Implementation detail: this selects `artifactPath=styles.css`.
- [ ] Click `Preview snippet` for `script.js` and confirm the UI shows a bounded read-only source snippet. Implementation detail: this selects `artifactPath=script.js`.
- [ ] Unknown artifact paths fail gracefully without breaking the task page.

## Skills, Models, And MCP Boundaries

- [ ] Click `Skills` in the sidebar and confirm the view opens with managed workflow capabilities rather than ad hoc prompt text.
- [ ] Click `Models` in the sidebar and confirm the view opens with deterministic/mock resolved routes and real provider configuration form fields.
- [ ] Real model provider tests are opt-in and do not run during `pnpm smoke`.
- [ ] Click `MCP` in the sidebar and confirm the view opens with registry, approval, and visible tools surfaces, without executing a real MCP tool.
- [ ] Deployment is not required for the current flow. Deployment can later be provided by skills or a dedicated deployment module.

## Regression Commands

- [ ] `pnpm smoke` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm build` passes.

## Known Later Work

- [ ] Browser automation acceptance tests are still future work.
- [ ] Real MCP execution from the web UI is still future work.
- [ ] Durable multi-agent context compression and retrieval are still future work.
- [ ] Built-in deployment orchestration is still future work.
- [ ] Desktop packaging is still future work.
