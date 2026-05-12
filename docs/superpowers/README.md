# Superpowers Documentation Index

This directory contains Superpowers-generated specs and implementation plans. Read the files in the order below when onboarding to the project or resuming work from another machine.

## Reading Order

1. `specs/2026-05-11-lp-engineering-team-agent-design.md`
   - V1 product and architecture design.
   - Read this first to understand the project goal, system boundaries, and why the monorepo is split into the current apps and packages.

2. `plans/2026-05-11-lp-engineering-team-agent-v1.md`
   - V1 implementation plan.
   - Read this after the V1 design if you need to understand how the current MVP was built.

3. `specs/2026-05-11-stage-2-agent-workflow-spec.md`
   - Stage 2 product spec.
   - Read this after the V1 design. It assumes the current MVP exists and defines the next product stage: persisted projects, skills, model routing, MCP, run timelines, deployment handoff, and team collaboration primitives.

4. `specs/2026-05-12-chat-agent-workbench-ui-spec.md`
   - Stage 2 Web UI slice spec.
   - Read this after the Stage 2 product spec when working on the Manus/ChatGPT-style conversation layout, fixed sidebar, tool-call process display, artifact cards, and interrupt affordance.

5. `plans/2026-05-12-chat-agent-workbench-ui.md`
   - Stage 2 Web UI implementation plan.
   - Read this after the chat UI spec when implementing or auditing the conversation-first Web workbench.

6. `plans/2026-05-12-stage-2-persistent-repositories.md`
   - Stage 2 Milestone 1 implementation plan.
   - Read this when implementing the first Stage 2 slice: repository contracts and repository-backed workbench state.

7. `specs/2026-05-12-lightweight-real-web-project-flow-spec.md`
   - Stage 2 Milestone 2 lightweight Web flow spec.
   - Read this after the chat UI plan and repository plan when replacing the fixed demo snapshot with project creation, prompt submission, cookie-backed current project state, and process-local in-memory Web state.

8. `plans/2026-05-12-lightweight-real-web-project-flow.md`
   - Stage 2 Milestone 2 lightweight Web flow implementation plan.
   - Read this after the lightweight Web flow spec when implementing or auditing project creation, prompt submission, cookie-backed current project selection, and process-local Web state.

9. `specs/2026-05-12-web-flow-no-git-no-deployment-spec.md`
   - Stage 2 Milestone 2 scope amendment.
   - Read this after the lightweight Web flow spec and plan. It supersedes the repository URL and automatic deployment portions of the earlier lightweight Web flow documents for the current Web V1.

10. `plans/2026-05-12-web-flow-no-git-no-deployment.md`
   - Implementation plan for removing Git repository capture and automatic deployment from the current Web flow.
   - Read this after the no-Git/no-deployment spec when implementing or auditing the current project creation, prompt submission, review, static download, and preview behavior.

## Maintenance Rule

Whenever a Superpowers workflow creates, renames, replaces, or materially updates a spec or plan under `docs/superpowers/specs/` or `docs/superpowers/plans/`, update this index in the same change.

Each index update must keep:

- Reading order accurate.
- The short purpose of each spec or plan accurate.
- Stage and milestone relationships clear.
- References to renamed or superseded files removed or marked explicitly.

If two documents have the same date, use this index as the source of truth for order.
