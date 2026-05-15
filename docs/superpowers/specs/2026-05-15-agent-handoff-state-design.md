# Agent Handoff State v0 Design

## Summary

Stage 6 adds the first structured multi-agent coordination state for the LP Engineering Team Agent. The goal is to make Planner, Builder, Reviewer, and Deployer handoffs explicit records instead of an implicit run order.

This is not a general workflow engine, open-ended agent swarm, team collaboration UI, or retry/resume system. It is a small backend state slice that records fixed LP-chain handoffs, exposes them as safe run events, and makes role-relevant handoff summaries available to future Context Pack assembly.

## Current Context

The project already has these foundations:

- fixed agent roles: `planner`, `builder`, `reviewer`, and `deployer`;
- persisted `RunRecord` and ordered `RunEventRecord` repositories;
- `ToolObservationRecord` for durable tool outputs;
- `ContextPack` assembly with skills, MCP tools, approval, artifact workspace, model routing, and Stage 5 `ContextMemory`;
- deterministic LP generation flow that runs Planner, Builder, Reviewer, and Deployer in a fixed order;
- Web timeline rendering from run events.

The current missing piece is that one role's output is only indirectly connected to the next role through service code and generated artifacts. There is no first-class record saying:

- which run produced a handoff;
- which role should consume it;
- whether the handoff is ready, blocked, or already consumed;
- why a downstream role is blocked;
- which brief or page version is the subject of the handoff.

Stage 6 v0 makes that coordination state explicit.

## Goals

- Add a structured `AgentHandoffRecord` model and repository boundary.
- Persist handoffs for the fixed LP generation chain:
  - `planner -> builder`;
  - `builder -> reviewer`;
  - `reviewer -> deployer`.
- Record safe run events when handoffs are created, blocked, or consumed.
- Prevent Deployer from running when Reviewer creates a blocked handoff.
- Make role-relevant handoff summaries available to Context Pack assembly.
- Keep the existing deterministic LP output stable.
- Keep the implementation testable without external models, queues, workers, or MCP execution.

## Non-Goals

- No generic DAG workflow engine.
- No open-ended multi-agent swarm.
- No ordinary chat task handoffs.
- No team member, role, approval, or comment UI.
- No full retry/resume behavior.
- No worker queue or background scheduler.
- No MCP execution.
- No new Web page or complex Web interaction.
- No changes to the generated LP artifact format.
- No deployment automation beyond the existing deployment skill command boundary.

## Architecture

Add a small repository-backed handoff layer next to the existing run state:

```text
packages/db
  -> AgentHandoffRecord
  -> AgentHandoffRepository
  -> in-memory + JSON-file persistence

packages/api
  -> agent-handoffs.ts
      -> schema validation
      -> safe summary construction
      -> handoff event payload construction
  -> run orchestration / service flow
      -> create ready/blocked handoffs
      -> mark inbound handoffs consumed when downstream runs begin
      -> block deployer when reviewer handoff is blocked
  -> context-assembler.ts
      -> inject role-relevant handoff summaries
      -> trace injected/omitted handoff counts
```

The repository is the source of truth. Run events are the observable timeline. Context Pack summaries are the runtime consumption path.

## Data Model

`packages/db/src/workbench-repositories.ts` should define a record shape similar to:

```ts
export type AgentHandoffState = "ready" | "blocked" | "consumed";

export interface AgentHandoffArtifactRefs {
  briefId?: string;
  pageVersionId?: string;
}

export interface AgentHandoffRecord {
  id: string;
  projectId: string;
  taskId?: string;
  fromRunId: string;
  fromRole: AgentRole;
  toRole: AgentRole;
  state: AgentHandoffState;
  summary: string;
  blockingReason?: string;
  artifactRefs?: AgentHandoffArtifactRefs;
  createdAt: string;
  updatedAt: string;
}
```

Required properties:

- `projectId` scopes all handoff queries.
- `taskId` ties handoffs to the active LP task when available.
- `fromRunId` identifies the run that produced the handoff.
- `fromRole` and `toRole` make the coordination edge explicit.
- `state` is intentionally small:
  - `ready`: downstream role may consume it;
  - `blocked`: downstream role must not proceed;
  - `consumed`: downstream role has started from this handoff.
- `summary` is a short safe text summary, not raw model output.
- `blockingReason` is present only for blocked handoffs.
- `artifactRefs` contains IDs only, never full artifacts.

## Repository Contract

Add an `AgentHandoffRepository` to `WorkbenchRepositories`:

```ts
export interface AgentHandoffRepository {
  save(handoff: AgentHandoffRecord): Promise<void>;
  getById(handoffId: string): Promise<AgentHandoffRecord | undefined>;
  listForProject(projectId: string): Promise<AgentHandoffRecord[]>;
  listForTask(taskId: string): Promise<AgentHandoffRecord[]>;
  listInbound(input: {
    projectId: string;
    taskId?: string;
    toRole: AgentRole;
  }): Promise<AgentHandoffRecord[]>;
  listOutbound(input: {
    projectId: string;
    taskId?: string;
    fromRole: AgentRole;
  }): Promise<AgentHandoffRecord[]>;
  listAll(): Promise<AgentHandoffRecord[]>;
}
```

Ordering should be deterministic by `updatedAt`, then `createdAt`, then `id`.

Both in-memory and JSON-file implementations must defensively copy records on read/write. JSON-file persistence must reopen handoffs from disk with no loss of state.

## Runtime Flow

### Planner to Builder

When Planner successfully creates a brief, API service code writes:

- handoff edge: `planner -> builder`;
- state: `ready`;
- artifact refs: `{ briefId }`;
- summary: safe brief-level summary such as "Planner produced LP brief".

It also writes a `handoff.created` run event on the Planner run.

### Builder to Reviewer

When Builder successfully creates a page version, API service code writes:

- handoff edge: `builder -> reviewer`;
- state: `ready`;
- artifact refs: `{ briefId, pageVersionId }`;
- summary: safe page-version summary such as "Builder produced static LP artifacts".

It also writes a `handoff.created` run event on the Builder run.

### Reviewer to Deployer

When Reviewer passes the page version, API service code writes:

- handoff edge: `reviewer -> deployer`;
- state: `ready`;
- artifact refs: `{ pageVersionId }`;
- summary: safe review summary such as "Reviewer passed page version".

It also writes a `handoff.created` run event on the Reviewer run.

When Reviewer fails the page version, API service code writes:

- handoff edge: `reviewer -> deployer`;
- state: `blocked`;
- artifact refs: `{ pageVersionId }`;
- summary: safe review summary such as "Reviewer blocked deployment";
- `blockingReason`: a bounded safe description derived from findings.

It also writes a `handoff.blocked` run event on the Reviewer run.

The Deployer run must not be created while the latest relevant reviewer-to-deployer handoff is `blocked`.

### Consuming Handoffs

When a downstream role run starts from a ready inbound handoff, the service marks the handoff as `consumed` and writes `handoff.consumed` on the downstream run.

`consumed` only means "the downstream run started using this handoff." It does not imply the downstream run completed successfully.

## Run Events

Handoff run events should be safe, compact, and deterministic.

Recommended event types:

- `handoff.created`;
- `handoff.blocked`;
- `handoff.consumed`.

Recommended payload shape:

```ts
{
  handoffId: string;
  fromRunId: string;
  fromRole: AgentRole;
  toRole: AgentRole;
  state: AgentHandoffState;
  summary: string;
  blockingReason?: string;
  artifactRefs?: {
    briefId?: string;
    pageVersionId?: string;
  };
}
```

Event payloads must not include:

- raw model output;
- full generated HTML/CSS/JS;
- raw tool output;
- secrets;
- provider request or response bodies.

## Context Pack Integration

Add a bounded handoff summary to runtime context. The exact location can be either:

1. a new `runtimeContext.handoffs` field; or
2. a handoff section inside a broader coordination context if the implementation plan introduces one.

The v0 shape should stay small:

```ts
export interface RuntimeHandoffSummary {
  id: string;
  fromRunId: string;
  fromRole: AgentRole;
  toRole: AgentRole;
  state: AgentHandoffState;
  summary: string;
  blockingReason?: string;
  artifactRefs?: {
    briefId?: string;
    pageVersionId?: string;
  };
  updatedAt: string;
}
```

Selection rules:

- Include current project only.
- Prefer current task when `taskId` is present.
- Include inbound handoffs where `toRole` equals the current role.
- Include the latest outbound handoffs where `fromRole` equals the current role.
- Keep a small default limit, such as 6 handoffs.

Context Pack trace should include:

- `handoffs:N` when handoffs are injected;
- `handoffs:none` when no relevant handoffs exist;
- `handoffs:budget_exceeded` when relevant handoffs exceed the limit.

If a blocked inbound handoff is injected, the runtime can see why the role should not proceed, but v0 service code is still responsible for hard blocking Deployer creation.

## Safety Rules

Handoff summaries and blocking reasons must be sanitized and bounded before persistence.

They must never include:

- raw model text;
- full HTML/CSS/JS;
- raw stdout or stderr;
- API keys, bearer tokens, or env-style secret assignments;
- unbounded reviewer findings;
- arbitrary event payload serialization.

Handoff records may include IDs and short summaries only. If a future UI needs detail, it should dereference known safe records by ID and apply the same safety rules.

## Error Handling

- Schema validation failure is a code/data-shape bug and should fail closed.
- If the service cannot save a required handoff after a successful role output, the run should fail rather than silently continue with missing coordination state.
- If marking a handoff consumed fails, the downstream run should fail before invoking runtime.
- If a blocked reviewer-to-deployer handoff exists, deployment creation should fail with a clear local error and no Deployer run should be saved.
- Repository read failure during Context Pack assembly should omit handoff summaries and trace `handoffs:error`, unless the failure happens while enforcing a hard service decision such as blocking Deployer.

## Testing Strategy

Add focused tests before implementation.

`packages/db`:

- in-memory repository saves and lists handoffs with defensive copies;
- JSON-file repository reopens handoffs from disk;
- inbound/outbound filters are project-scoped, task-aware, and role-aware.

`packages/api`:

- Planner completion creates a ready `planner -> builder` handoff and `handoff.created` event.
- Builder completion creates a ready `builder -> reviewer` handoff and `handoff.created` event.
- Reviewer pass creates a ready `reviewer -> deployer` handoff and `handoff.created` event.
- Reviewer failure creates a blocked `reviewer -> deployer` handoff and `handoff.blocked` event.
- Deployer is not run when reviewer handoff is blocked.
- Starting a downstream run marks the matching inbound handoff consumed and writes `handoff.consumed`.
- Context Pack injects role-relevant handoff summaries and trace counts.
- Handoff summaries and blocking reasons do not leak secrets, raw model text, raw tool output, or full artifacts.

`packages/runtime-adapters` and `packages/model-gateway`:

- if runtime/model context types are extended, tests should prove handoff summaries are cloned defensively, matching the Stage 5 memory clone pattern.

## Web Behavior

No new Web UI is required in v0.

Existing run timeline can display handoff run events if they flow through the current event rendering path. A later UI slice can add explicit handoff cards after the backend state proves stable.

## Documentation Updates

Implementation should update:

- `docs/agent-development-learning.md`, marking Stage 6 handoff v0 as planned or implemented;
- `docs/superpowers/README.md` whenever a plan is added;
- any developer docs if new commands or environment assumptions are introduced.

## Acceptance Criteria

- Handoffs are persisted as first-class repository records.
- Fixed LP chain handoffs are recorded for Planner, Builder, and Reviewer.
- Reviewer failure blocks Deployer creation through structured handoff state.
- Downstream runs can mark inbound ready handoffs as consumed.
- Handoff run events are visible and safe.
- Context Pack includes bounded role-relevant handoff summaries and trace entries.
- Existing deterministic LP generation remains stable.
- No raw model output, secret, full artifact source, or raw tool output enters handoff records, events, or runtime context.
- `pnpm test`, `pnpm typecheck`, and `pnpm build` pass.
