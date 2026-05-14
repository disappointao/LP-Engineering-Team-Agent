# Stage 2 Agent Workflow Spec

## Purpose

Stage 2 turns the current static demo workbench into a usable LP agent workflow for internal testing. Users should be able to create a project, submit an LP brief, bind scoped skills, choose model routes, expose approved MCP tools, run planner/builder/reviewer/deployer steps, preview static LP artifacts, and export or hand off the result.

The generated LP must remain framework-free. The workbench can use Next.js, but generated output stays either:

- `index.single.html`
- `index.html`, `styles.css`, and `script.js`

## Current Baseline

The repository already has a working MVP on `main`.

- Web shell: `apps/web`
- Agent worker demo: `apps/agent-worker`
- In-memory orchestration: `packages/api`
- Static artifact generation and bundling: `packages/artifacts`
- LP schema and review types: `packages/lp-schema`
- Skill manifest and permission rules: `packages/skills`
- MCP visibility rules: `packages/mcp-gateway`
- Model routing boundary: `packages/model-gateway`
- Runtime adapter boundary: `packages/runtime-adapters`
- Git handoff boundary: `packages/git-deployment`
- Prisma schema: `packages/db/prisma/schema.prisma`

The current service is deterministic and mostly in-memory. That is intentional for Stage 1. Stage 2 should preserve those boundaries while replacing demo-only state with explicit repositories, persisted records, and real UI flows.

## Stage 2 Product Scope

### User-Facing Capabilities

1. Project setup
   - Create a project with name, repository URL, default language, and ecommerce customization profile.
   - Reopen existing projects from persisted storage.

2. LP request workflow
   - Submit a prompt in Chinese or English.
   - Convert prompt into a structured `LPBrief`.
   - Allow the user to inspect and edit key brief fields before generation.

3. Skill management
   - Upload or paste a skill manifest and content.
   - Validate skill structure before publishing.
   - Bind a skill at organization, workspace, or project scope.
   - Use project-bound skills during agent runs.

4. Model routing
   - Configure provider routes per role: planner, builder, reviewer, deployer.
   - Keep a mock provider available for local development.
   - Persist model routing policy by scope.

5. MCP tool visibility
   - Register MCP connectors with tool permissions.
   - Show which tools are visible to each agent role.
   - Require approval before exposing write-capable tools such as PR creation.

6. Agent run timeline
   - Create a run record for each role.
   - Persist ordered run events.
   - Show run state in the Web UI.
   - Keep the runtime adapter replaceable so a pi-mono-inspired runtime can be introduced later.

7. Artifact preview and export
   - Preview generated static LP artifacts in a sandboxed iframe.
   - Export `index.single.html`.
   - Export the three-file structure.
   - Preserve clean download labels in Chinese and English.

8. Deployment handoff
   - Produce a structured deployment handoff record.
   - Keep real Git provider writes behind an adapter.
   - Stage 2 may still use a simulated PR URL locally, but the adapter interface must support GitHub or internal Git later.

9. Team collaboration primitives
   - Persist workspace and project members with roles.
   - Allow reviewer approval to be recorded on deployment handoff.
   - Keep run events and deployment handoff visible as a shared project audit trail.
   - Avoid realtime co-editing in Stage 2.

## Explicit Non-Goals

Stage 2 should not build these yet:

- Desktop app packaging.
- Full hosted multi-tenant auth and billing.
- Realtime multiplayer editing.
- Visual drag-and-drop page builder.
- Arbitrary code execution from uploaded skills.
- Direct production deployment to customer sites.
- Replacing all mocks with external providers in one pass.

## Architecture

Stage 2 keeps a monorepo boundary:

- `apps/web` owns the product UI and server-side request handlers.
- `packages/api` owns use-case orchestration and should not import React.
- `packages/db` owns Prisma schema, client setup, and repository implementations.
- `packages/skills` owns skill manifest parsing, validation, permission checks, and content normalization.
- `packages/model-gateway` owns provider routing and audit metadata.
- `packages/mcp-gateway` owns connector/tool visibility and approval filtering.
- `packages/runtime-adapters` owns the runtime contract and local deterministic adapter.
- `packages/artifacts` owns generated LP file safety and bundling.
- `packages/git-deployment` owns deployment handoff and future Git provider integration.

The key design choice is to keep the agent runtime provider-agnostic. `packages/api` should call `AgentRuntimeAdapter`, not OpenAI, Anthropic, pi-mono, Playwright, GitHub, or MCP SDKs directly. That keeps the first Web version compatible with a later desktop wrapper and a runtime rewrite.

## Data Flow

1. User opens Web workbench.
2. Web loads locale from request headers and project data from persisted storage.
3. User creates or selects a project.
4. User submits a prompt.
5. API service creates a brief run:
   - Loads bound skills.
   - Loads visible MCP tools.
   - Loads model route for planner.
   - Persists run events.
6. Planner result becomes an editable `LPBrief`.
7. Builder run generates static artifacts.
8. Reviewer run creates findings and review status.
9. User approves deployment handoff if review passed.
10. Deployer adapter creates handoff metadata.
11. Web shows preview, downloads, run timeline, and deployment state.

## Agent Context and Memory Roadmap

Stage 2 should get the simplest working agent path running first, but code written for that path must leave room for a real context system. The product should not let each agent role hand-build prompts from scattered repositories. Runtime input should move toward an explicit context assembly boundary that can gather, compress, retrieve, combine, and inject the right information for each run.

The first implementation can keep this boundary inside `packages/api`, near the run orchestrator. If it grows beyond a small use-case helper, extract it into a focused package such as `packages/context-engine` without changing Web callers or runtime adapter callers.

Context sources to preserve as first-class concepts:

- Current task context: active task, latest user request, task type, project binding, and current run state.
- Historical task context: prior messages, previous LP briefs, generated page versions, review findings, and run outcomes.
- User and project preferences: locale, preferred artifact mode, brand/ecommerce defaults, model preferences, and future team preferences.
- Rules: repository `AGENTS.md`, tracked Superpowers specs, project rules, bound skill instructions, approval rules, and generated LP constraints.
- Skills: enabled published skills resolved by scope and role, including their content, permissions, and entrypoints.
- Tool state: visible MCP tools, approval status, tool call inputs, tool outputs, errors, and structured observations.
- File system and artifact state: writable artifact workspace, generated files, file manifests, diffs, and future desktop-local file paths.
- Multi-agent coordination state: planner/builder/reviewer/deployer handoffs, dependency status, blocking questions, cancellation state, and retry state.

Compression, retrieval, composition, and injection rules:

- Long chat history, large tool outputs, and repeated run logs should be summarized before entering model context.
- Retrieval should prefer project-scoped and task-relevant records before global history.
- Tool outputs should be stored as structured observations, not only appended as chat text.
- File context should prefer manifests, diffs, and selected snippets over full file dumps.
- Each agent role receives a role-specific context pack. Planner needs goals, constraints, preferences, and relevant history; builder needs the brief, skills, artifact workspace, allowed files, and design rules; reviewer needs acceptance criteria, artifacts, findings history, and policy rules; deployer needs approval state, deployment skills, and tool permissions.
- Context assembly should enforce a token budget per role and keep a trace of which sources were injected, summarized, omitted, or blocked by permissions.
- Runtime boundary objects should have explicit schemas. Continue using Zod for structured runtime validation where data crosses trust boundaries, especially context packs, run events, tool observations, agent handoffs, and structured model outputs.

This roadmap is deliberately incremental. The near-term goal is not to build a full memory system before the first real run. The near-term goal is to route all future real-agent work through stable context interfaces so later memory, retrieval, summarization, and multi-agent coordination can be added without rewriting the Web flow or runtime adapters.

## Persistence Strategy

Use the existing Prisma schema as the source of truth for Stage 2. The first implementation can run against Postgres in development. If local setup friction is high, add a documented Docker Compose file before adding a second database provider.

Required repository interfaces:

- `ProjectRepository`
- `BriefRepository`
- `PageVersionRepository`
- `ArtifactRepository`
- `RunRepository`
- `SkillRepository`
- `SkillBindingRepository`
- `MCPConnectorRepository`
- `ModelRoutingRepository`
- `DeploymentRepository`

Repositories should return plain TypeScript objects that match package-level domain types. React components and Next request handlers should not receive Prisma model objects directly.

## Skill System Rules

Skill uploads must be treated as data, not executable code, in Stage 2.

Accepted skill input:

- `manifest.json` content matching `SkillManifestSchema`.
- Markdown or text content for workflow instructions, templates, or deployment handoff instructions.

Rejected skill input:

- JavaScript, shell scripts, Python scripts, or binary files.
- Skills with undeclared permissions.
- Deployment skills that are not `validated` or `published`.
- Skills with duplicate `id` and `version`.

Skill auto-deploy behavior:

- A user with `owner` or `admin` role can publish a validated deployment skill.
- A user with `member` role can publish workflow and template skills, but cannot publish deployment skills.
- Publishing a deployment skill only makes the skill available to the LP agent; it does not execute Git, shell, or remote deployment actions by itself.
- Deployment skill execution is still mediated through the deployment adapter and approval state.

Scope behavior:

- `global` applies to all workspaces.
- `organization` applies to all workspaces under the organization.
- `workspace` applies to projects in that workspace.
- `project` applies only to one project.

Resolution order:

1. Global skills.
2. Organization skills.
3. Workspace skills.
4. Project skills.

When two bindings expose the same skill id, use the most specific scope.

## Model Provider Rules

Stage 2 supports provider configuration through the existing `ModelProvider` and `ModelRoutingPolicy` tables.

Default local policy:

- planner: `mock-openai/planning-model`
- builder: `mock-anthropic/code-model`
- reviewer: `mock-openai/review-model`
- deployer: `mock-local/tool-model`

Provider secrets must not be stored as raw values in the database. Store references such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or an internal secret id in provider config. Runtime code reads the actual value from environment variables or a future secret manager.

## MCP Rules

MCP connectors are registered by scope and target key. A connector is visible only when:

- It is enabled.
- It is bound to the current project through scope resolution.
- The agent role is allowed for the tool.
- The active skill permissions include the tool permission.
- Approval is present when `requiresApproval` is true.

Stage 2 should expose MCP tool visibility and approval state in the UI, but tool execution may remain simulated unless the connector is explicitly implemented behind an adapter.

## Web UX Requirements

The Web UI keeps the current agent workspace direction:

- Left sidebar for Workbench, Skills, MCP, Models, Deployments.
- Main prompt surface for the LP request.
- Project strip with repository, artifact mode, and deployment branch.
- Brief editor panel.
- Sandboxed LP preview panel.
- Run timeline panel.
- Export and deployment actions.

Localization:

- Keep `zh-CN` and `en`.
- Resolve default language from `Accept-Language`.
- Store project default language for generated LP content in Stage 2.
- Do not hard-code new UI copy inside React components; add it to `apps/web/src/lib/i18n.ts`.

## Ecommerce Customization Hooks

Stage 2 must leave stable extension points for company ecommerce sites:

- `brandProfile` in `LPBrief`.
- `productData` in `LPBrief`.
- `tracking.events` in `LPBrief`.
- Project-level ecommerce profile with:
  - brand name
  - color tokens
  - typography token
  - default CTA style
  - analytics event names
  - compliance notes
  - product feed source metadata

The first implementation can store this profile as JSON on project settings. It should be converted into explicit Prisma columns only after repeated real usage shows which fields need querying.

## Generated LP Constraints

All generated LP artifacts must pass these constraints:

- No React, Vue, Svelte, Next, or framework runtime.
- No external JavaScript dependencies by default.
- HTML is valid enough to preview in an iframe and open as a standalone file.
- CSS is plain CSS.
- JavaScript is optional and only used for minimal interactions or tracking events.
- User-provided HTML-sensitive values are escaped.
- URLs are sanitized through the existing safe URL approach.
- Single-file bundling must escape embedded `</style` and `</script` boundaries.

## Implementation Milestones

### Milestone 1: Persistent Repositories

Goal: move the workbench service from in-memory maps to repository-backed storage.

Primary files:

- Create `packages/db/src/client.ts`.
- Create `packages/db/src/repositories/*.ts`.
- Modify `packages/db/package.json`.
- Modify `packages/api/src/index.ts`.
- Add repository tests under `packages/db/src`.

Acceptance:

- `DemoWorkbenchService` can be constructed with repository-backed dependencies.
- Existing in-memory behavior still works in tests.
- Project, brief, page version, artifact, run, and deployment records persist.

### Milestone 2: Real Web Project Flow

Goal: replace hard-coded demo snapshot usage with project creation and persisted snapshots.

Primary files:

- Modify `apps/web/src/app/page.tsx`.
- Create `apps/web/src/app/actions.ts`.
- Create `apps/web/src/components/*` for project form, prompt form, brief editor, run timeline, and exports.
- Keep `apps/web/src/lib/demo-workbench.ts` only as a seeded fallback or remove it after equivalent persisted fixtures exist.

Acceptance:

- User can create a project from the Web UI.
- User can submit a prompt and see a persisted brief.
- Refreshing the page does not lose the project state.
- Chinese and English UI still render based on locale.

### Milestone 3: Skill Upload and Binding

Goal: let users validate, publish, and bind data-only skills.

Primary files:

- Extend `packages/skills/src/index.ts`.
- Create `packages/api/src/skills-service.ts`.
- Add Web skill management route or panel under `apps/web`.
- Add tests for manifest validation, duplicate versions, scope resolution, and permission decisions.

Acceptance:

- Invalid manifests show actionable errors.
- Valid skills can be stored as draft or validated.
- Bound skills appear in runtime context.
- Project scope overrides broader bindings for duplicate skill ids.

### Milestone 4: Model Routing Configuration

Goal: persist provider routes and expose them in runtime context.

Primary files:

- Extend `packages/model-gateway/src/index.ts`.
- Create `packages/api/src/model-routing-service.ts`.
- Add Web model configuration panel.
- Add tests for missing provider, disabled provider, fallback route, and role-specific policy.

Acceptance:

- User can view and edit role-to-model routes.
- Runtime audit log includes provider, model, role, prompt length, and context.
- Missing route fails with a typed error and useful UI copy.

### Milestone 5: MCP Connector Registry

Goal: persist connectors and show role-filtered visible tools.

Primary files:

- Extend `packages/mcp-gateway/src/index.ts`.
- Create `packages/api/src/mcp-service.ts`.
- Add Web MCP panel.
- Add tests for approval filtering and permission filtering.

Acceptance:

- User can register an MCP connector definition.
- Role-specific visible tools are computed from persisted connector, bound skills, and approval state.
- Write tools remain hidden until approval is granted.

### Milestone 6: Run Orchestration and Events

Goal: make planner, builder, reviewer, and deployer runs visible and persisted, while introducing the first context assembly boundary for real-agent work.

Primary files:

- Create `packages/api/src/run-orchestrator.ts`.
- Create `packages/api/src/context-assembler.ts` or a similarly focused helper if the orchestration code would otherwise build prompts directly.
- Extend `packages/runtime-adapters/src/index.ts` only where the adapter contract is missing required event data.
- Modify `apps/web` run timeline UI.
- Add tests for event ordering, failure states, resumable snapshots, and role-specific context pack assembly.

Acceptance:

- Every run has persisted state.
- Events are ordered by sequence.
- Failed runs preserve diagnostic events.
- The Web UI can show run state after refresh.
- Runtime requests are created from an explicit role-specific context pack, not ad hoc prompt assembly inside the Web layer.
- Context assembly records which skills, MCP tools, artifact workspace, preferences, rules, and history summaries were injected or omitted.
- Context packs and persisted run events are validated through explicit runtime schemas before they are consumed by the runtime adapter or Web timeline.

### Milestone 7: Deployment Handoff Adapter Boundary

Goal: keep local handoff working and prepare a real Git provider adapter.

Primary files:

- Extend `packages/git-deployment/src/index.ts`.
- Create a provider-neutral handoff interface for branch, commit, PR URL, file list, and next action.
- Add tests for idempotent deployment creation.

Acceptance:

- Re-approving the same passed page version returns the existing deployment.
- Deployment handoff stores file list and branch.
- Stage 2 UI can export handoff JSON.

### Milestone 8: Collaboration Primitives

Goal: add role-aware collaboration primitives without introducing realtime editing.

Primary files:

- Create `packages/api/src/membership-service.ts`.
- Extend repository coverage for `WorkspaceMember` and `ProjectMember`.
- Modify deployment approval flow to persist reviewer identity.
- Update `docs/development.md`.
- Add screenshots or terminal logs only if useful for user-facing behavior.
- Keep this spec updated when scope changes.

Acceptance:

- Workspace and project members can be created with roles.
- Reviewer identity is recorded when approving deployment handoff.
- Run events and deployment state can be read after refresh by another project member.
- `pnpm test` passes.
- `pnpm typecheck` passes.
- `pnpm build` passes.

### Milestone 9: Final Integration and Documentation

Goal: make the full Stage 2 path clear for another developer or agent.

Primary files:

- Update `docs/development.md`.
- Add screenshots or terminal logs only if useful for user-facing behavior.
- Keep this spec updated when scope changes.

Acceptance:

- `pnpm test` passes.
- `pnpm typecheck` passes.
- `pnpm build` passes.
- `DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm --filter @lp-agent/db db:validate` passes when a local Postgres URL is available.

## Suggested Branch Plan

Use one branch per milestone if work is split across machines:

1. `stage-2-persistent-repositories`
2. `stage-2-real-web-flow`
3. `stage-2-skills-management`
4. `stage-2-model-routing`
5. `stage-2-mcp-registry`
6. `stage-2-run-orchestration`
7. `stage-2-deployment-handoff`
8. `stage-2-collaboration-primitives`
9. `stage-2-integration-docs`

For a single-agent implementation session, use one branch:

```bash
git checkout main
git pull --ff-only
git checkout -b stage-2-agent-workflow
```

Commit after every milestone with concise imperative messages.

## Verification Commands

Run these before merging each milestone:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Run this when database schema or repositories change:

```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm --filter @lp-agent/db db:validate
```

Run this before committing Markdown-only spec changes:

```bash
git diff --check
```

## Continuing on Another Computer

From a fresh machine:

```bash
git clone https://github.com/disappointao/LP-Engineering-Team-Agent.git
cd LP-Engineering-Team-Agent
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

If the repository already exists:

```bash
cd LP-Engineering-Team-Agent
git checkout main
git pull --ff-only
pnpm install
pnpm test
```

Local Codex or Superpowers state under `.superpowers` is not required for the project to build. Important engineering context must live in tracked docs such as this file, `AGENTS.md`, and `docs/development.md`.

## Stage 2 Done Criteria

Stage 2 is done when:

- A user can create and reopen a project from the Web app.
- A user can submit a prompt and get a structured LP brief.
- A user can bind a validated skill and see it affect runtime context.
- A user can configure model routes per role.
- A user can register MCP tools and see permission-filtered visibility.
- Planner, builder, reviewer, and deployer runs are persisted with event timelines.
- Agent runs use an explicit context assembly boundary that can evolve toward compression, retrieval, structured tool observations, file-state injection, and multi-agent handoffs.
- Workspace and project member roles are persisted.
- Deployment approval records reviewer identity.
- Generated output exports as single-file HTML and three-file static artifacts.
- Deployment handoff remains adapter-based and idempotent.
- The UI works in Chinese and English.
- `pnpm test`, `pnpm typecheck`, and `pnpm build` pass on `main`.
