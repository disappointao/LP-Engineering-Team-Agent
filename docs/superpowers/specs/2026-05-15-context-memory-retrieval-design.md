# Context Memory Retrieval v0 Design

## Summary

Stage 5 adds the first Context Memory layer for the LP Engineering Team Agent. The goal is to make project history, run state, tool observations, and artifact metadata available to future agent runs through a deterministic, safe, and testable retrieval path.

This is not a long-term memory platform, vector database, model-generated summarization system, or MCP execution layer. It is a small runtime context enhancement that replaces the current `history:not_implemented` and `toolObservations:not_implemented` omissions with selected, bounded, schema-validated memory summaries.

## Current Context

The project already has these foundations:

- persisted projects, tasks, messages, page versions, runs, run events, and tool observations;
- `ContextPack` assembly in `packages/api/src/context-assembler.ts`;
- `RuntimeRunContext` passed into runtime adapters;
- safe tool observation records with `outputSummary`, `exitCode`, `errorName`, and no raw stdout/stderr;
- Stage 4.1 Web skill command loop that writes sanitized `tool.*` run events and displays only allowlisted metadata.

The current Context Pack trace still records:

- `history:not_implemented`;
- `toolObservations:not_implemented`.

Stage 5 v0 turns those omissions into deterministic project-scoped memory retrieval.

## Goals

- Assemble a bounded `ContextMemory` object from existing repositories.
- Inject selected memory into `ContextPack.runtimeContext`.
- Keep deterministic runtime behavior unchanged unless runtime code explicitly reads memory.
- Preserve strict safety boundaries: no raw tool output, no raw model text, no full generated HTML/CSS/JS, and no secrets.
- Make selection behavior observable through `trace.injected` and `trace.omitted`.
- Keep v0 testable without model keys, embeddings, external services, or new infrastructure.

## Non-Goals

- No vector database or embedding model.
- No model-generated summaries.
- No cross-project retrieval.
- No user profile or workspace-wide long-term memory.
- No persistent summary cache or `ContextMemoryRepository`.
- No MCP execution.
- No real-time streaming retrieval.
- No full source-code or artifact injection.
- No replacement of existing run events, tool observations, or page version records.

## Architecture

Add a small API-owned memory assembly module:

```text
repositories
  -> context-memory.ts
      -> summarize messages/runs/tools/artifacts
      -> deterministic keyword retrieval
      -> ContextMemorySchema.parse(...)
  -> context-assembler.ts
      -> runtimeContext.memory
      -> trace.injected / trace.omitted
  -> runtime-adapters
      -> RuntimeRunContext.memory type support
```

The memory assembler reads from the existing repository interfaces on each Context Pack assembly. It does not create a new repository in v0. This avoids cache invalidation, stale summaries, and schema migration work before the memory shape stabilizes.

## Data Model

`packages/api/src/context-memory.ts` should define and export schemas and types similar to:

```ts
export const ContextMemoryMessageSummarySchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  role: z.string().min(1),
  preview: z.string(),
  createdAt: z.string().datetime(),
  score: z.number()
});

export const ContextMemoryRunSummarySchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1).optional(),
  role: z.enum(agentRoles),
  state: z.string().min(1),
  eventTypes: z.array(z.string().min(1)),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  score: z.number()
});

export const ContextMemoryToolSummarySchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  taskId: z.string().min(1).optional(),
  toolName: z.string().min(1),
  state: z.string().min(1),
  outputSummary: z.string(),
  exitCode: z.number().int().optional(),
  errorName: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  score: z.number()
});

export const ContextMemoryArtifactSummarySchema = z.object({
  pageVersionId: z.string().min(1),
  briefId: z.string().min(1),
  title: z.string().optional(),
  objective: z.string().optional(),
  files: z.array(z.object({
    name: z.enum(["index.html", "styles.css", "script.js"]),
    characterCount: z.number().int().min(0)
  })),
  createdAt: z.string().datetime(),
  score: z.number()
});

export const ContextMemorySchema = z.object({
  messages: z.array(ContextMemoryMessageSummarySchema),
  runs: z.array(ContextMemoryRunSummarySchema),
  tools: z.array(ContextMemoryToolSummarySchema),
  artifacts: z.array(ContextMemoryArtifactSummarySchema),
  retrieval: z.object({
    query: z.string(),
    strategy: z.literal("deterministic-keyword-v0"),
    selected: z.array(z.string().min(1)),
    omitted: z.array(z.string().min(1))
  })
});
```

Exact field names may be adjusted during planning, but the implementation must preserve these properties:

- summary records are structured and schema-validated;
- every summary can be traced back to an existing source record;
- unsafe raw output and full artifacts are not included;
- scores are deterministic and useful for tests/debugging.

## Retrieval Inputs

`assembleContextMemory()` should accept:

- `repositories`;
- `projectId`;
- optional `taskId`;
- `role`;
- `input` from Context Pack assembly;
- optional limits/budget override for tests;
- optional `now` if needed for deterministic tests.

The retrieval query should be derived from:

- `input.prompt`, if present;
- key fields from `input.brief`, if present;
- current `taskId`;
- current `role`.

## Retrieval and Ranking

v0 uses deterministic keyword retrieval:

1. Only records with the same `projectId` are eligible.
2. Current task records receive a priority boost.
3. Records whose preview/summary contains query keywords receive a boost.
4. Failed runs and failed tool observations receive a small boost because they are useful for recovery and diagnosis.
5. Newer records win ties.

Default selection limits:

- messages: 6;
- runs: 6;
- tools: 6;
- artifacts: 2;
- single preview: 240 characters;
- total memory summary budget: approximately 4,000 characters.

The exact scoring constants can be simple and local to `context-memory.ts`. They should be named constants so tests can reason about behavior without depending on magic numbers.

## Budget and Omission Trace

The memory assembler should track omitted items in `ContextMemory.retrieval.omitted` and `ContextPack.trace.omitted`.

Examples:

- `memory:messages:none`;
- `memory:messages:budget_exceeded`;
- `memory:runs:none`;
- `memory:tools:none`;
- `memory:tools:budget_exceeded`;
- `memory:artifacts:none`;
- `memory:artifacts:budget_exceeded`.

When memory is injected, `ContextPack.trace.injected` should include compact counts:

- `memory:messages:N`;
- `memory:runs:N`;
- `memory:tools:N`;
- `memory:artifacts:N`;
- `memory:strategy:deterministic-keyword-v0`.

The existing `history:not_implemented` and `toolObservations:not_implemented` omissions should be removed once memory injection covers those sources.

## Runtime Context Integration

Extend `RuntimeRunContext` in `packages/runtime-adapters` with optional memory support:

```ts
export interface RuntimeRunContext {
  skills: RuntimeSkillContext[];
  mcpTools: RuntimeMCPToolContext[];
  approval: RuntimeApprovalContext;
  artifactWorkspace: RuntimeArtifactWorkspace;
  modelRoutingPolicy?: ModelRoutingPolicy;
  memory?: ContextMemory;
}
```

The actual import shape should avoid package cycles. If `packages/runtime-adapters` cannot import API schemas directly, define a runtime-local structural type and keep the API schema as the validating source before the context crosses the runtime boundary.

Deterministic runtime output should remain unchanged in v0. Tests should assert that memory reaches the runtime request context without changing generated LP artifacts.

## Safety Rules

Memory summaries must never include:

- raw stdout;
- raw stderr;
- secret values;
- full generated HTML/CSS/JS;
- raw model provider text;
- provider API keys, base URLs, or unredacted headers;
- arbitrary run event payload serialization.

Tool memory may include only:

- `toolName`;
- `state`;
- `outputSummary`;
- `exitCode`;
- `errorName`;
- timestamps and source ids.

Artifact memory may include only:

- page version id;
- brief id;
- brief title/objective if available;
- canonical filenames;
- character counts;
- created timestamp.

Message memory may include a bounded preview. The preview should use a shared truncation helper and should not exceed the configured per-item limit.

## Error Handling

Repository read failures should be isolated by source when possible:

- if message retrieval fails, omit message memory and record `memory:messages:error`;
- if tool observation retrieval fails, omit tool memory and record `memory:tools:error`;
- if artifact retrieval fails, omit artifact memory and record `memory:artifacts:error`.

Schema validation failures are different. They indicate a code or data-shape bug and should fail closed so tests catch invalid context before a runtime call.

## Testing Strategy

Add focused tests around the memory assembler and Context Pack integration:

- `ContextMemorySchema` accepts valid deterministic summaries.
- message retrieval is project-scoped and does not include other projects.
- current task messages outrank older same-project messages.
- keyword matches outrank non-matches when timestamps are comparable.
- failed runs/tools receive recovery-oriented priority.
- tool memory includes `outputSummary` but excludes raw output, secrets, and artifact content.
- artifact memory includes filenames and character counts but excludes full HTML/CSS/JS.
- budget overflow records omitted reasons.
- `assembleContextPack()` injects memory and updates trace counts.
- runtime adapter receives memory in request context while deterministic output remains unchanged.

The implementation plan should keep tests deterministic by using in-memory repositories and fixed timestamps.

## Web Behavior

No new Web UI is required in v0. Existing chat timeline and Skills/MCP/Models views should remain unchanged.

If a later UI slice wants to show context memory, it should read the same structured memory summaries or run context summary, not scrape prompts or raw repository records.

## Documentation Updates

Implementation should update:

- `docs/agent-development-learning.md`, marking Stage 5 v0 as in progress/completed as appropriate;
- `docs/superpowers/README.md` when adding the implementation plan;
- relevant developer docs if commands or environment assumptions change.

## Acceptance Criteria

- Context Pack includes deterministic memory summaries for project-scoped messages, runs, tool observations, and artifact metadata.
- Runtime context schema validates memory.
- Trace records what memory was injected and why sources were omitted.
- No raw tool output, secret, full artifact source, or raw model text appears in memory.
- Existing deterministic Web/API tests still pass.
- `pnpm typecheck` passes.
- No vector database, model-generated summary, or new persistent memory repository is introduced in v0.
