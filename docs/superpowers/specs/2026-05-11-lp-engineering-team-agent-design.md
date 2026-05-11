# LP Engineering Team Agent v1 Design

Date: 2026-05-11
Status: approved for implementation planning

## Summary

LP Engineering Team Agent v1 is a web-based workbench for generating lightweight landing pages with an agent team. The first version is LP-first, not a general-purpose autonomous agent platform. It helps a user create a project, provide a prompt, files, links, and product or campaign inputs, confirm a structured LP brief, generate framework-free static artifacts, review the result, and hand the approved output to Git and CI/CD.

The generated LP is not a React or Next.js project. The canonical artifact is clear static code:

- `index.html`
- `styles.css`
- `script.js`

Export supports both a three-file directory and a single-file HTML bundle. This keeps LP output easy to inspect, diff, deploy, and adapt to company ecommerce needs.

## Goals

- Provide a complete web MVP loop for LP generation, preview, structured editing, review, and Git/CI deployment handoff.
- Support team work through organization, workspace, project, role, history, approval, and shared skills boundaries.
- Support fixed multi-agent collaboration through Planner, Builder, Reviewer, and Deployer roles.
- Let users create workflow and template skills while requiring admin review for executable deployment skills.
- Provide scoped MCP access so agent runs only see tools allowed by the current project, skill, role, and approval state.
- Provide a model gateway so different model providers can be used by role, project, policy, cost, privacy, or fallback rules.
- Use an `AgentRuntimeAdapter` boundary so v1 can start with a lightweight worker and later support a pi-mono-inspired runtime, container runtime, or desktop-local runtime.
- Keep the product designed for internal company use first while preserving organization and workspace boundaries for later SaaS expansion.

## Non-Goals for v1

- WYSIWYG DOM editing or Webflow-style direct canvas manipulation.
- Public SaaS registration, billing, or marketplace.
- Realtime multiplayer page editing.
- A general autonomous agent platform as the primary product surface.
- A desktop application release.
- Running arbitrary executable user code without admin review.
- Deep ecommerce platform integration beyond adapter boundaries, ecommerce section templates, and deployment extension points.

## Product Decisions

### First User-Facing Loop

The first user-facing loop is:

1. Create or open a project in a workspace.
2. Submit a landing page request through prompt, uploaded files, URLs, and optional product or campaign data.
3. Planner extracts a structured `LP Brief`.
4. User confirms and edits the brief through structured forms.
5. Builder generates static HTML, CSS, and JavaScript artifacts.
6. Reviewer checks responsiveness, accessibility, copy consistency, policy rules, and basic performance.
7. User or reviewer approves deployment handoff.
8. Deployer creates a Git branch, commit, and pull request, then lets existing CI/CD perform deployment.

### Editing Model

The source of truth is the structured LP brief and page section model, not arbitrary DOM state. Users edit fields such as:

- page goal
- audience
- offer or campaign
- brand tone
- colors and typography tokens
- section list and order
- headings and body copy
- CTA labels and targets
- product or activity blocks
- image and asset references
- SEO title, description, and social metadata

The agent regenerates or patches the static artifacts from that source model. This makes review, diffs, versioning, validation, and future ecommerce adapters more reliable.

### Generated Artifact Shape

Internal canonical output is a three-file static page:

- `index.html` contains semantic structure and asset references.
- `styles.css` contains layout, responsive rules, typography, and visual tokens.
- `script.js` contains small interactions only when needed.

Export modes:

- Three-file export for maintainability.
- Single-file HTML export for simple upload and deployment targets.

Framework output is not part of v1. React, Next.js, Vue, or company-specific component output can be added later as artifact adapters, but the default LP artifact stays framework-free.

## Architecture

### Components

`web`
: Next.js web application for project navigation, brief intake, structured editing, preview, run logs, review, approvals, skills management, and deployment handoff.

`api`
: Application API for authentication, authorization, projects, briefs, page versions, skills, MCP connectors, model providers, runs, artifacts, and deployments.

`postgres`
: Primary system of record for organizations, workspaces, projects, permissions, skills, runs, page versions, artifact metadata, and deployment state.

`object storage`
: Stores uploaded source materials, generated assets, packaged exports, and preview snapshots when they should not live directly in Postgres.

`agent-worker`
: Background worker service that executes Planner, Builder, Reviewer, and Deployer jobs. It streams run events, writes artifacts, calls the model gateway, loads scoped skills, invokes MCP tools, and performs Git handoff through adapters.

`model-gateway`
: Provider-neutral model access layer. Agents request capabilities and policies rather than calling a provider SDK directly. The gateway supports multiple providers, per-role routing, fallback, usage records, and audit logs.

`mcp-gateway`
: Scoped connector layer for external tools. It exposes only the tools allowed by organization, workspace, project, skill, role, and run state. Secrets are not injected into prompts; they are used only inside controlled tool calls.

`skills-registry`
: Stores skill metadata, versions, manifests, scopes, review state, and bindings to organizations, workspaces, or projects.

`runtime-adapters`
: Boundary around agent execution. v1 can implement a lightweight local worker adapter. Later versions can add a pi-mono-style runtime adapter, container adapter, remote worker adapter, or desktop-local adapter without changing product data models.

`git-deployment-adapter`
: Creates branches, commits generated LP artifacts, opens pull requests, and records CI/CD handoff state. The actual deployment remains in the company Git and CI/CD system.

### Runtime Adapter Contract

An `AgentRuntimeAdapter` must support:

- starting a run for a role and task
- loading scoped skill context
- requesting model completions through the model gateway
- invoking allowed MCP tools
- reading and writing workspace artifacts
- streaming run events
- returning structured results and error states

The platform must not assume a specific runtime implementation. Runtime-specific features must stay behind adapter capabilities.

### Model Gateway Contract

The model gateway must support:

- provider registration
- model registration
- role-based routing policies
- project-level policy overrides
- fallback and retry policy
- token, latency, and cost recording
- audit logs for prompt metadata and model responses

Initial roles can use different models:

- Planner: strong reasoning and extraction.
- Builder: strong code generation and artifact patching.
- Reviewer: strong critique, validation, and checklist following.
- Deployer: deterministic tool-use-oriented model or rules-first execution.

### Skills Model

Skill types:

- `workflow`: defines a repeatable process, prompts, review steps, or agent sequence.
- `template`: defines brand rules, page patterns, ecommerce blocks, copy patterns, or artifact generation constraints.
- `deployment`: invokes Git, CI/CD, internal release systems, or other privileged executable actions.

Skill scopes:

- `global`
- `organization`
- `workspace`
- `project`

Skill lifecycle:

1. Draft.
2. Validated.
3. Published.
4. Deprecated.
5. Archived.

Governance:

- Members can create workflow and template skills within their allowed scope.
- Deployment and executable skills require admin review before publishing.
- Deployment skills must declare permissions, required secrets, allowed targets, and audit behavior.
- Published skills are versioned. Existing runs keep the skill version they used.

### MCP Access Model

MCP connectors are registered at organization or workspace level and bound to projects when allowed. A run receives a limited tool view computed from:

- organization policy
- workspace policy
- project bindings
- skill manifest permissions
- agent role
- approval state
- deployment target

This follows the principle of progressive context exposure: agent runs receive the minimum useful tool surface instead of a full tool catalog.

## Data Model

Core entities:

- `Organization`: tenant boundary for future SaaS compatibility and current internal ownership.
- `Workspace`: team or department boundary inside an organization.
- `WorkspaceMember`: user membership and role.
- `Project`: LP work area with repository settings, policies, and skill bindings.
- `ProjectMember`: project-level role assignment.
- `LPBrief`: structured requirements for a landing page.
- `PageVersion`: immutable version of brief, generated artifacts, review state, and deployment readiness.
- `Artifact`: metadata for generated files, packaged exports, previews, and assets.
- `Skill`: logical skill record.
- `SkillVersion`: versioned manifest and content snapshot.
- `SkillBinding`: attaches a skill version to global, organization, workspace, or project scope.
- `MCPConnector`: registered external connector with policy and secret references.
- `ModelProvider`: provider and model configuration.
- `ModelRoutingPolicy`: maps roles and projects to model choices and fallback behavior.
- `Run`: agent run for a project, page version, or deployment action.
- `RunEvent`: streamed trace item, log entry, model call metadata, tool call metadata, or artifact event.
- `Deployment`: Git branch, commit, pull request, CI status, approval, and target metadata.

Project roles:

- `owner`: full control over project settings, members, skills, and deployment configuration.
- `admin`: can manage project settings, members, skills, and approvals within policy.
- `member`: can create briefs, generate versions, edit structured fields, and request review.
- `reviewer`: can review, comment, approve, or reject deployment handoff.

## LP Brief Shape

The `LPBrief` should include:

- `title`
- `objective`
- `audience`
- `offer`
- `brandProfile`
- `tone`
- `constraints`
- `sections`
- `cta`
- `assets`
- `productData`
- `seo`
- `tracking`
- `complianceNotes`

Each section should include:

- `type`
- `purpose`
- `headline`
- `body`
- `media`
- `cta`
- `layoutHints`
- `validationRules`

The exact schema can evolve, but the v1 implementation should treat this structure as the durable source of truth.

## Error Handling and Review

Agent runs must produce explicit states:

- `queued`
- `running`
- `needs_input`
- `needs_approval`
- `failed`
- `completed`
- `cancelled`

Recoverable failures should produce actionable messages, not raw stack traces. Examples:

- missing source asset
- unavailable model provider
- denied MCP permission
- Git branch conflict
- CI handoff failure
- reviewer rejection

Reviewer output should be structured:

- issue severity
- affected file or brief field
- explanation
- suggested fix
- whether the issue blocks deployment

## Security and Permissions

- Secrets are stored as references and never included directly in prompts or skill text.
- Deployment skills require admin approval and permission manifests.
- MCP tools are scoped per run.
- All model calls and tool calls are auditable.
- Generated code is treated as untrusted until reviewed.
- Git and deployment actions require explicit approval unless a project policy later enables trusted automation.
- User-uploaded files are associated with project scope and access-controlled.

## Technology Direction

The repository should become a monorepo with clear boundaries:

- `apps/web`: Next.js web application.
- `apps/agent-worker`: worker service for agent jobs.
- `packages/api`: shared API contracts and server modules if the stack supports it.
- `packages/db`: schema, migrations, and data access.
- `packages/lp-schema`: LP brief and page version schemas.
- `packages/artifacts`: static artifact generation and export utilities.
- `packages/skills`: skill manifest parsing, validation, and registry logic.
- `packages/mcp-gateway`: connector policy and invocation abstractions.
- `packages/model-gateway`: provider adapters and routing policies.
- `packages/runtime-adapters`: agent runtime adapter interface and implementations.
- `packages/git-deployment`: Git and PR handoff adapters.

The first implementation plan can choose a pragmatic subset, but these boundaries should guide file layout and dependency direction.

## Testing Strategy

V1 tests should cover:

- LP brief schema validation.
- prompt/file/link extraction into a structured brief using mocked model responses.
- static artifact generation from a brief.
- single-file export and three-file export.
- skill manifest validation and permission checks.
- MCP tool visibility by project, skill, role, and run state.
- model routing policy selection and fallback.
- reviewer checks on generated artifacts.
- Git deployment adapter behavior with mocked repository operations.
- API authorization for project roles.

End-to-end smoke tests should verify:

1. Create project.
2. Create brief.
3. Generate page version.
4. Preview artifacts.
5. Run reviewer.
6. Approve deployment.
7. Create Git handoff record.

## Acceptance Criteria

V1 is acceptable when:

- A user can create a workspace project and submit an LP request.
- The system can extract and display a structured LP brief.
- The user can edit structured LP fields.
- The agent worker can generate `index.html`, `styles.css`, and `script.js`.
- The web app can preview the generated page.
- The user can export either a single-file HTML bundle or the three-file artifact directory.
- Reviewer can produce structured findings before deployment handoff.
- A reviewer or authorized user can approve deployment handoff.
- Deployer can create a Git branch, commit generated artifacts, and open or record a pull request.
- Workflow/template skills can be created and scoped.
- Deployment skills require admin review before use.
- MCP tool access is scoped to the run context.
- Model usage is routed through the model gateway, not hardcoded to one provider.
- Agent execution happens behind `AgentRuntimeAdapter`.

## Future Compatibility

The design leaves room for:

- company ecommerce repository adapters
- internal release platform deployment skills
- richer brand and design system skills
- component or framework artifact adapters
- desktop-local runtime and local project mode
- SaaS onboarding, marketplace, and billing
- realtime collaboration
- visual page editing built on the structured brief and section model
