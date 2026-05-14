# Provider-Neutral Model Configuration Design

Date: 2026-05-14

## Purpose

The project needs a generic model provider configuration layer that can later connect to Zhipu GLM, OpenAI-compatible endpoints, Anthropic-compatible endpoints, local models, company proxies, and future provider adapters without changing the agent runtime contract.

This spec covers the next incremental slice: provider-neutral configuration plus mock runtime wiring. It does not make real external model calls.

## Context

The current project already has the right broad boundaries:

- `packages/model-gateway` owns the model gateway interface and deterministic mock gateway.
- `packages/runtime-adapters` calls the model gateway through role-based requests.
- `packages/api` resolves project model routing into runtime context.
- `ModelProvider` and `ModelRoutingPolicy` already exist in the Prisma schema.
- The Web Models view already lets users create project-scoped providers and route planner, builder, reviewer, and deployer roles.

The current model provider shape is intentionally small:

- `provider` is restricted in TypeScript to `mock | openai | anthropic | internal | custom`.
- `config` only stores `baseUrl` and `secretEnvName`.
- `ModelRoute` only carries `{ provider, model }`.

That is enough for route selection, but too narrow for a maintainable real-provider system.

## Reference Analysis

The useful pi-mono idea is not its full implementation. The useful idea is separating:

- provider identity,
- API protocol,
- endpoint URL,
- secret reference,
- model manifest,
- compatibility flags.

Relevant references:

- pi custom models: https://hochej.github.io/pi-mono/coding-agent/models/
- pi-ai README: https://github.com/badlogic/pi-mono/blob/main/packages/ai/README.md
- Zhipu Claude API compatibility: https://docs.bigmodel.cn/cn/guide/develop/claude/introduction

The project should borrow this provider manifest pattern, but should not add pi-mono as a runtime dependency in this slice.

## Chosen Approach

Use a lightweight provider manifest owned by this project:

```ts
export type ModelProviderApi =
  | "mock"
  | "openai-completions"
  | "anthropic-messages";

export interface ModelProviderModelConfig {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
  supportsImages?: boolean;
}

export interface ModelProviderHeaderRef {
  env: string;
}

export interface ModelProviderRuntimeConfig {
  api: ModelProviderApi;
  baseUrl?: string;
  apiKeyEnv?: string;
  headers?: Record<string, ModelProviderHeaderRef>;
  models?: ModelProviderModelConfig[];
  compat?: Record<string, unknown>;
}
```

The existing provider record keeps stable identity outside the config:

```ts
export interface ModelProviderRecord {
  id: string; // provider id, for example "zhipu"
  name: string; // display name, for example "Zhipu GLM"
  config: ModelProviderRuntimeConfig;
  enabled: boolean;
}
```

Implementation may keep the current persisted `provider` field during this stage for backward compatibility. New dispatch logic should use `config.api` as the canonical protocol. Existing records without `config.api` should be normalized through a compatibility mapper:

- `mock` -> `mock`
- `openai` -> `openai-completions`
- `anthropic` -> `anthropic-messages`
- `internal` and `custom` -> require explicit `config.api` before real external calls are allowed

## Zhipu Example

The user-provided Claude Code style settings map naturally to an Anthropic-compatible provider:

```json
{
  "id": "zhipu",
  "name": "智谱 GLM",
  "config": {
    "api": "anthropic-messages",
    "baseUrl": "https://open.bigmodel.cn/api/anthropic",
    "apiKeyEnv": "ANTHROPIC_API_KEY",
    "models": [
      {
        "id": "glm-5.1",
        "name": "GLM-5.1",
        "contextWindow": 200000,
        "maxTokens": 128000,
        "supportsTools": true,
        "supportsStreaming": true
      }
    ]
  }
}
```

The API key value must not be stored in the project state. Only the environment variable name is stored.

## Incremental Scope

This slice implements option B: generic configuration plus mock chain verification.

The target data flow is:

```text
Web Models view
-> repository-backed provider config
-> project role route
-> runtime context assembly
-> model gateway mock completion
-> run event and audit metadata
```

The model gateway still returns deterministic mock text. The important verification is that a run can resolve the final provider id, API protocol, model id, and non-secret endpoint metadata through the same boundary that real adapters will use later.

## Non-Goals

This slice does not:

- call Zhipu, OpenAI, Anthropic, OpenRouter, Ollama, or any external provider;
- load real API key values;
- expose secret values in Web, run events, logs, or audit entries;
- implement streaming;
- implement model tool-call conversion;
- implement fallback routing;
- implement OAuth;
- support command-based secret resolution such as `!command`;
- import pi-mono as a dependency.

## Component Design

### Repository and Data Model

The repository contract should accept the new provider runtime config. The Prisma schema does not need an immediate migration because `ModelProvider.config` is already JSON and `ModelProvider.provider` is already a string.

For local JSON state, persisted records should remain backward compatible. Loading code should tolerate older records that only contain `baseUrl` and `secretEnvName`.

### API Service

The service layer should validate:

- provider id and name are non-empty;
- `config.api` is one of the supported API protocols;
- `baseUrl`, when present, is a URL-like non-empty string;
- `apiKeyEnv` and header env refs match environment-variable naming rules;
- model ids are non-empty;
- model numeric limits are positive integers when present.

The service should normalize `secretEnvName` to `apiKeyEnv` for legacy inputs.

### Web Models View

The Web view should make the protocol explicit. The first version can keep the UI compact:

- provider id;
- display name;
- API protocol select;
- base URL;
- API key env name;
- default/model id entry.

The route editor can still allow free-text model ids. If the provider has declared models, the UI can later upgrade to a select without changing the backend contract.

### Runtime Context

Runtime context should continue passing `ModelRoutingPolicy` for role selection. In this slice, the API/context assembler should also resolve provider metadata from the repository and pass a sanitized resolved-provider summary into the runtime/model-gateway boundary.

The sanitized summary may include:

- provider id;
- display name;
- `api`;
- model id;
- whether `baseUrl` is configured;
- whether `apiKeyEnv` is configured;
- model capability metadata when known.

It must not include actual API key values.

### Model Gateway

`ModelGateway.complete()` should remain provider-neutral. It should not know about Web forms or database repositories.

The deterministic gateway may record extra audit metadata:

- role;
- project id;
- provider id;
- API protocol;
- model id;
- prompt length;
- context summary;
- provider config presence flags.

This makes the mock path prove the future real-adapter wiring without adding external network calls.

## Error Handling

Use stable error codes for user-facing and testable failures:

- `model_provider_api_required`
- `model_provider_api_unsupported`
- `model_provider_base_url_invalid`
- `model_provider_api_key_env_invalid`
- `model_provider_header_env_invalid`
- `model_provider_model_id_required`
- `model_provider_model_limit_invalid`
- `model_provider_real_adapter_not_configured`

For this slice, unsupported real execution should fail before network I/O and should be observable through run events.

## Testing Strategy

Unit tests should cover:

- provider config creation and normalization;
- legacy `secretEnvName` to `apiKeyEnv` compatibility;
- unsupported API protocol rejection;
- invalid env-name rejection;
- route resolution still falls back to the default mock policy when project routes are invalid;
- runtime/model-gateway audit includes provider metadata but not secret values;
- Web Models view renders protocol labels in Chinese and English.

No tests in this slice should require network access or real API keys.

## Follow-Up Slices

After this slice, real provider work can proceed by protocol:

1. `anthropic-messages` adapter for Zhipu Claude-compatible and Anthropic-compatible endpoints.
2. `openai-completions` adapter for OpenAI-compatible endpoints such as Zhipu native chat completions, OpenRouter, Ollama, LM Studio, and vLLM.
3. Streaming event normalization.
4. Tool-call conversion and tool observation storage.
5. Fallback, retry, timeout, and cost-budget policy.

Each adapter should live behind the model gateway boundary and should preserve the mock provider for deterministic local tests.

## Acceptance Criteria

- A project can create a provider with explicit API protocol and non-secret endpoint config.
- A project route can select that provider and model for an agent role.
- A run can resolve the route and surface sanitized provider metadata through the mock model gateway path.
- Existing mock/default routes continue to work.
- Existing local JSON state remains loadable.
- No real external model request is made.
- No secret value is stored or displayed.
