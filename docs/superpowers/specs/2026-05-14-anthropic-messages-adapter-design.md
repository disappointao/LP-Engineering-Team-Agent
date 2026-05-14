# Anthropic Messages Adapter Design

Date: 2026-05-14

## Status

Approved direction: implement the first real model provider at the `packages/model-gateway` layer only.

This is Stage 3, after provider-neutral model configuration. It does not connect the Web workbench or full agent runtime to a real external provider yet.

## Context

The project already separates model provider identity from API protocol:

- provider identity: `mock`, `openai`, `anthropic`, `internal`, `custom`, or future vendor ids such as Zhipu;
- API protocol: `mock`, `openai-completions`, `anthropic-messages`;
- endpoint config: `baseUrl`, `apiKeyEnv`, optional model metadata, and future compatibility data.

The current runtime still uses `InMemoryModelGateway`. The next safe step is to add a real `anthropic-messages` implementation behind the existing `ModelGateway` interface, while keeping the Web and run orchestration layers deterministic.

Official references:

- Zhipu Claude-compatible API documents `base_url="https://open.bigmodel.cn/api/anthropic"` and `model="glm-5.1"` for Anthropic SDK migration.
- Anthropic Messages API uses `/v1/messages`, `x-api-key`, `anthropic-version`, JSON request bodies, and text responses under `content[]`.
- Zhipu OpenAI-compatible and direct HTTP APIs use `https://open.bigmodel.cn/api/paas/v4/` with `/chat/completions` and `Authorization: Bearer`, which is a different protocol path and should be handled by a later `openai-completions` adapter.

## Goals

- Add a real `anthropic-messages` adapter in `packages/model-gateway`.
- Support Zhipu's Claude-compatible endpoint through provider config:
  - `baseUrl=https://open.bigmodel.cn/api/anthropic`
  - `apiKeyEnv=ANTHROPIC_API_KEY` or another configured env var name
  - `model=glm-5.1`
- Keep the existing `ModelGateway.complete()` interface stable.
- Resolve secret values only inside the model gateway adapter boundary.
- Return sanitized provider metadata and usage through `ModelResponse`.
- Test the adapter with fake `fetch` by default, without requiring a real API key.
- Add an opt-in integration test that only runs when explicitly enabled by environment variables.

## Non-Goals

- No Web wiring for real model execution.
- No runtime replacement in `packages/api`.
- No streaming.
- No tool calling.
- No multi-turn conversation history mapping.
- No fallback chains or retries beyond a bounded request timeout.
- No OpenAI-compatible `paas/v4` implementation in this slice.
- No secret manager or database-backed secret storage.

## Protocol Distinction

The system must treat API protocol as the runtime behavior selector, not the vendor display name.

For Zhipu, both of these can target the same model family, but they are different protocols:

| Protocol | Base URL | Request path | Auth | Response shape |
| --- | --- | --- | --- | --- |
| `anthropic-messages` | `https://open.bigmodel.cn/api/anthropic` | `/v1/messages` | `x-api-key` plus `anthropic-version` | `content[].text`, `usage.input_tokens`, `usage.output_tokens` |
| `openai-completions` | `https://open.bigmodel.cn/api/paas/v4/` | `/chat/completions` | `Authorization: Bearer` | `choices[0].message.content`, token usage fields |

Current project configuration can store the `paas/v4` URL with `api=openai-completions`, but this slice will not execute it. If a route resolves to `openai-completions` in the new gateway, it should fail with a clear "not implemented" error until the OpenAI-compatible adapter is added.

## Architecture

Add a provider-backed gateway composition inside `packages/model-gateway`:

- `ProviderBackedModelGateway` implements `ModelGateway`.
- It resolves the route from `request.routingPolicy` or a constructor policy, matching the current `InMemoryModelGateway` behavior.
- It looks up private provider runtime config by `route.provider`.
- It dispatches by `route.api` when present, otherwise by the resolved provider config API:
  - `mock`: delegate to deterministic in-memory behavior.
  - `anthropic-messages`: call the real adapter.
  - `openai-completions`: throw a protocol-not-implemented error in this slice.

The provider runtime config lookup must be injected into the gateway and must not be attached to `ModelRequest`, runtime context packs, run events, or audit entries.

Suggested interfaces:

```ts
export interface ModelProviderRuntimeRecord {
  id: string;
  name?: string;
  enabled: boolean;
  config: ModelProviderRuntimeConfig;
}

export interface ModelProviderRuntimeResolver {
  getProvider(providerId: string): Promise<ModelProviderRuntimeRecord | undefined>;
}
```

Tests can use an in-memory resolver. Future API/Web wiring can implement the same resolver against repositories or a service method.

## Anthropic Messages Adapter

The adapter receives:

- a `ModelRequest`;
- the resolved `ModelRoute`;
- the private `ModelProviderRuntimeConfig`;
- an injected `fetch` implementation;
- an injected environment reader, defaulting to `process.env`.

It builds a single-turn request:

```json
{
  "model": "glm-5.1",
  "max_tokens": 1024,
  "messages": [
    { "role": "user", "content": "..." }
  ]
}
```

For v0, `messages` contains only `request.prompt`. Context Pack injection is already handled before the model gateway boundary; richer multi-message mapping can be added later.

Endpoint construction:

- if `baseUrl` ends with `/v1/messages`, use it directly;
- if `baseUrl` ends with `/v1`, append `/messages`;
- otherwise append `/v1/messages`.

This supports both Anthropic-style base URLs and Zhipu's documented Claude-compatible `base_url`.

Required headers:

- `content-type: application/json`
- `x-api-key: <resolved secret>`
- `anthropic-version: 2023-06-01`

The v0 adapter should not log headers or request bodies. Optional custom header refs in provider config are reserved for a future compatibility slice unless implementation can support them without increasing scope.

## Response Parsing

External responses are untrusted runtime data. The adapter should parse them with a small schema or precise type guards before returning a `ModelResponse`.

Expected fields:

- `content`: array containing one or more text content blocks;
- `usage.input_tokens`;
- `usage.output_tokens`;
- `model`, if present.

The adapter should concatenate text content blocks with newlines. If no text content exists, throw a response-shape error.

Returned `ModelResponse` includes:

- `provider`
- optional `providerName`
- `api: "anthropic-messages"`
- `model`
- `baseUrlConfigured: true`
- `apiKeyEnvConfigured: true`
- optional `modelCapabilities`
- `text`
- `usage`

It must not include:

- actual API key;
- env var name;
- full request headers;
- raw response body;
- full base URL.

## Error Handling

Use stable error classes or stable error names so later runtime events can classify failures.

Required cases:

- route missing;
- provider config missing;
- provider disabled;
- protocol mismatch;
- `baseUrl` missing;
- `apiKeyEnv` missing;
- environment variable value missing;
- request timeout;
- network failure;
- non-2xx HTTP status;
- invalid JSON;
- unsupported response shape.

Error messages may include provider id, protocol, model id, and HTTP status. They must not include API keys, header values, or raw provider response text by default.

## Testing

Default tests must not require network or real secrets.

Unit tests should cover:

- dispatch to `anthropic-messages` by route protocol;
- endpoint construction for `.../api/anthropic`, `.../v1`, and direct `.../v1/messages`;
- required request headers and JSON body using fake `fetch`;
- text block concatenation;
- usage mapping;
- missing provider config;
- disabled provider;
- missing `baseUrl`;
- missing `apiKeyEnv`;
- missing env var value;
- non-2xx response;
- invalid JSON;
- invalid response shape;
- timeout through `AbortController`;
- no secret-bearing fields in returned response or audit entry.

Add an opt-in integration test file that is skipped unless:

```bash
REAL_MODEL_PROVIDER_TEST=1
ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_DEFAULT_MODEL=glm-5.1
```

The integration test should issue a minimal prompt and assert that non-empty text and usage-like data are returned. It should be excluded from normal `pnpm test`.

## Compatibility

This slice keeps the Web Models view and API service behavior unchanged.

Existing mock tests should continue to pass. Consumers that still construct `InMemoryModelGateway` should see no behavior change.

Future stages can:

1. wire `ProviderBackedModelGateway` into `packages/api` behind a feature flag or explicit factory;
2. add `openai-completions` for Zhipu/OpenAI-compatible `paas/v4`;
3. add streaming and tool-call conversion;
4. move secrets from local env vars to a scoped secret manager.

## Acceptance Criteria

- `packages/model-gateway` exports the new provider-backed gateway and Anthropic-compatible adapter types.
- Unit tests prove request formatting, response parsing, error handling, timeout, and secret redaction.
- Normal test, typecheck, and build commands pass without external credentials.
- Opt-in integration test instructions are documented and do not run by default.
- No Web/runtime behavior changes are introduced in this slice.
