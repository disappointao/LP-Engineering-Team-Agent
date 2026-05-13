# Project Model Routing Configuration Spec

## Purpose

Add the first project-level model configuration slice to the Web workbench.

Users should be able to register model providers as project-scoped configuration, assign provider/model routes to the planner, builder, reviewer, and deployer roles, and have agent runtime calls use those routes through the existing model gateway boundary.

This slice is configuration-first. It prepares the product for OpenAI, Anthropic, internal models, and a later pi-mono-inspired runtime without making external model API calls in this stage.

## Current Baseline

The repository already has these foundations:

- `packages/model-gateway` defines `AgentRole`, `ModelRoute`, `ModelRoutingPolicy`, `ModelGateway`, `InMemoryModelGateway`, and audit entries.
- `packages/runtime-adapters` calls `ModelGateway.complete()` during local deterministic runtime runs.
- `packages/db/prisma/schema.prisma` already has `ModelProvider` and `ModelRoutingPolicy` models.
- `packages/db` has repository patterns for in-memory and JSON-file local state.
- `packages/api` owns project, task, skill, runtime context, and Web-facing use cases.
- `apps/web` has a Manus-style shell with a Models nav item.

The missing product slice is repository-backed project model provider management and project-scoped role routing.

## Goals

- Support project-level model provider configuration first.
- Let users create, edit, enable, and disable project-scoped model providers.
- Let users assign role routes for:
  - `planner`,
  - `builder`,
  - `reviewer`,
  - `deployer`.
- Keep the current mock/local provider behavior as the default fallback.
- Store provider secret references, not secret values.
- Load project model routes into runtime model gateway calls.
- Expose model routing and audit metadata in the Web workbench.
- Keep the model gateway provider-neutral so real providers can be added later.

## Non-Goals

- No direct calls to OpenAI, Anthropic, internal hosted models, or pi-mono runtime in this slice.
- No secret manager implementation.
- No storage of raw API keys.
- No workspace, organization, or global model routing UI in this slice.
- No per-user model preferences.
- No cost tracking beyond basic usage/audit metadata already returned by the gateway.
- No streaming responses.

## Scope Decisions

### Routing Scope

The Web V1 exposes only project-level model routing.

The repository records should still preserve `scope` and `targetKey` fields so global, organization, and workspace policies can be added later.

For this slice:

- UI-created providers must use `scope: "project"`.
- UI-created routing policies must use `scope: "project"`.
- `targetKey` must equal the current `projectId`.
- A project without configured routes uses the default local mock policy from `createDefaultModelPolicy()`.

### Provider Configuration

The Models UI should allow form-based configuration instead of raw JSON.

Provider fields:

- display name,
- provider key,
- provider type,
- optional base URL,
- optional secret environment variable name,
- enabled state.

Provider type should be a stable string union for known families, plus an internal/custom escape hatch:

- `mock`,
- `openai`,
- `anthropic`,
- `internal`,
- `custom`.

The `secretEnvName` field stores an environment variable name such as `OPENAI_API_KEY`. It must not store the secret value.

### Role Routes

Each route assigns one role to one provider and one model id.

Required roles:

- planner,
- builder,
- reviewer,
- deployer.

The route stores:

- project scope and target key,
- role,
- provider id,
- model id string,
- optional settings JSON for future temperature, max tokens, or provider-specific options.

This slice should keep settings optional and avoid exposing advanced JSON editing in the Web UI.

### Fallback Behavior

Fallback must be explicit and deterministic.

- If a project has no saved route for a role, use the default mock policy route for that role.
- If a saved route points to a missing or disabled provider, fail closed with a stable error.
- If a saved route has an empty model id, fail closed with a stable error.
- Web copy should explain which role is missing or invalid.

## Repository Design

Extend `@lp-agent/db` repository contracts with model provider and routing policy repositories while matching the existing Prisma model shape.

Recommended records:

```ts
export type ModelProviderType = "mock" | "openai" | "anthropic" | "internal" | "custom";

export interface ModelProviderRecord {
  id: string;
  scope: "global" | "organization" | "workspace" | "project";
  targetKey: string;
  name: string;
  provider: ModelProviderType;
  config: {
    baseUrl?: string;
    secretEnvName?: string;
  };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModelRoutingPolicyRecord {
  id: string;
  scope: "global" | "organization" | "workspace" | "project";
  targetKey: string;
  role: "planner" | "builder" | "reviewer" | "deployer";
  providerId: string;
  model: string;
  fallback?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

Recommended repositories:

```ts
export interface ModelProviderRepository {
  listAll(): Promise<ModelProviderRecord[]>;
  listForProject(projectId: string): Promise<ModelProviderRecord[]>;
  getById(providerId: string): Promise<ModelProviderRecord | undefined>;
  save(provider: ModelProviderRecord): Promise<void>;
}

export interface ModelRoutingPolicyRepository {
  listAll(): Promise<ModelRoutingPolicyRecord[]>;
  listForProject(projectId: string): Promise<ModelRoutingPolicyRecord[]>;
  getById(policyId: string): Promise<ModelRoutingPolicyRecord | undefined>;
  getByProjectAndRole(projectId: string, role: AgentRole): Promise<ModelRoutingPolicyRecord | undefined>;
  save(policy: ModelRoutingPolicyRecord): Promise<void>;
}
```

The in-memory and JSON-file repository adapters should both implement these contracts. Repository methods must return defensive copies.

## Model Gateway Design

`packages/model-gateway` should remain provider-neutral.

This slice should add small helpers rather than external provider clients:

- validate provider config shape,
- validate role route shape,
- convert repository records into a `ModelRoutingPolicy`,
- produce audit-friendly provider/model summaries.

`InMemoryModelGateway` can continue to return deterministic text. It should receive the project-resolved policy so tests can verify that runtime calls use project-configured routes.

Future real provider adapters should implement the existing `ModelGateway` interface rather than changing `packages/api` call sites.

## API Design

`packages/api` should own model routing use cases.

Recommended service methods:

- `createModelProvider(input)`
- `setModelProviderEnabled(input)`
- `upsertProjectModelRoute(input)`
- `listProjectModelState(projectId)`
- `resolveModelRoutingPolicyForProject(projectId)`

Recommended input behavior:

- `createModelProvider` trims display strings and rejects empty names, provider keys, and invalid provider types.
- `secretEnvName`, if provided, must look like an environment variable name and must not include the secret value.
- `upsertProjectModelRoute` requires an existing enabled provider, a supported role, and a non-empty model id.
- duplicate provider ids should produce a stable error.
- duplicate route for the same project and role should update the existing route instead of creating a second route.

Runtime integration:

- `DemoWorkbenchService.createRuntimeContext()` should resolve the project model routing policy.
- `createLocalRuntimeAdapter()` should accept the resolved model gateway or policy for the current run.
- Runtime/model audit events should include the resolved provider and model.

The implementation should avoid turning route resolution into global mutable state. Route resolution should be request/project scoped.

## Web UX Design

The Models nav item opens a project model configuration view in the main workspace. A query-driven view such as `?view=models` is acceptable if it keeps the current sidebar and shell.

The Models view should show:

- active project context,
- provider creation form,
- provider list with enabled/disabled state,
- four role route controls,
- current resolved route summary,
- fallback-to-mock indicators when no project route exists,
- clear validation errors.

Provider creation form fields:

- display name,
- provider key,
- provider type select,
- optional base URL,
- optional secret environment variable name.

Role route form fields:

- role label,
- provider select,
- model id input,
- save action.

All visible copy must go through `apps/web/src/lib/i18n.ts`.

The Workbench conversation view should expose a lightweight model route signal, such as role/provider chips or the current builder route, without crowding the composer.

## Error Handling

Use typed or stable error codes for Web actions.

Required errors:

- project not found,
- provider name required,
- provider key required,
- provider type unsupported,
- provider already exists,
- provider not found,
- provider disabled,
- role unsupported,
- model id required,
- route not found,
- route provider invalid,
- secret reference invalid,
- model routing operation failed.

Errors should be shown inline in the Models view. Raw stack traces should not be shown directly to users.

## Testing Requirements

Add focused tests for:

- model provider creation stores project scope and target key,
- provider config stores `secretEnvName` but never a secret value,
- invalid provider types and invalid secret references are rejected,
- duplicate provider ids are rejected,
- providers can be enabled and disabled,
- route upsert creates or updates one route per project role,
- route upsert rejects disabled or missing providers,
- project route resolution falls back to default mock routes when no route exists,
- project route resolution fails closed when a saved route points to a disabled provider,
- runtime calls use the resolved project route for planner, builder, reviewer, and deployer,
- model audit entries include role, project id, provider, model, prompt length, and context summary,
- JSON-file repositories persist providers and routes across reopened repository instances,
- Models view renders project provider and route controls,
- Models view hides configuration forms when there is no active project,
- Chinese and English copy render from i18n.

## Acceptance Criteria

- Users can create a project-scoped model provider from the Web Models view.
- Users can assign planner, builder, reviewer, and deployer routes for the active project.
- Projects without routes keep using deterministic default mock routes.
- Runtime model calls use configured project routes when present.
- Missing, disabled, or invalid providers fail with stable user-facing errors.
- The system stores secret references only, not raw secret values.
- The generated LP output remains framework-free static HTML/CSS/JS.
- `pnpm test` passes.
- `pnpm typecheck` passes.
- `pnpm build` passes.
- `docs/superpowers/README.md` includes this spec in reading order.

## Future Follow-Ups

- Add real OpenAI and Anthropic gateway adapters.
- Add internal model provider adapter and base URL auth rules.
- Add workspace, organization, and global model route resolution.
- Add per-role advanced model settings such as temperature and max tokens.
- Add prompt/response token cost tracking.
- Add streaming event support.
- Add secret manager integration.
- Reuse the JSON-file provider repositories as desktop-local configuration storage.
