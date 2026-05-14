# OpenAI-Compatible Chat Completions Adapter Design

Date: 2026-05-14

## Status

Approved direction: add a generic `openai-completions` adapter for OpenAI Chat Completions compatible providers.

This is the next Stage 3 model-provider slice after `anthropic-messages` and real runtime wiring. Zhipu `https://open.bigmodel.cn/api/paas/v4/` is the first target endpoint, but the adapter should stay provider-neutral so later OpenAI-compatible providers can reuse it.

## Context

The project already has:

- provider-neutral model configuration with API protocols:
  - `mock`;
  - `anthropic-messages`;
  - `openai-completions`;
- a real `anthropic-messages` adapter;
- `ProviderBackedModelGateway`;
- `REAL_MODEL_RUNTIME=1` runtime wiring;
- fail-closed behavior for mock routes in real runtime.

Today `openai-completions` is only a stored protocol value. When a route resolves to `openai-completions`, `ProviderBackedModelGateway` throws a protocol-not-implemented error.

Zhipu exposes a Chat Completions style endpoint at:

```text
https://open.bigmodel.cn/api/paas/v4/chat/completions
```

The OpenAI Chat Completions endpoint uses the same general request/response model:

```text
POST /chat/completions
Authorization: Bearer <token>
Content-Type: application/json
```

References:

- OpenAI Chat Completions API reference: https://platform.openai.com/docs/api-reference/chat/create-chat-completion
- Zhipu dialogue completion API reference: https://docs.bigmodel.cn/api-reference/模型-api/对话补全

## Goals

- Add a generic `openai-completions` adapter in `packages/model-gateway`.
- Support Zhipu `paas/v4` through the generic adapter.
- Keep provider API keys inside the adapter boundary.
- Return the existing unified `ModelResponse` shape:
  - provider id;
  - provider display name;
  - API protocol;
  - model id;
  - sanitized configured flags;
  - response text;
  - usage token counts.
- Dispatch `openai-completions` routes through `ProviderBackedModelGateway`.
- Preserve deterministic mock defaults outside real runtime.
- Preserve fail-closed mock behavior in `REAL_MODEL_RUNTIME=1`.
- Add fake-fetch unit tests and opt-in real provider smoke tests.

## Non-Goals

- No OpenAI Responses API support.
- No OpenAI SDK dependency.
- No streaming.
- No tool calling.
- No image/audio/file input support.
- No async Zhipu completion endpoint.
- No model-generated LP HTML/CSS/JS.
- No structured output parsing or repair.
- No Web UI redesign.
- No automatic deployment.

## Protocol Scope

V0 supports one single-turn text request:

```json
{
  "model": "glm-5.1",
  "messages": [
    {
      "role": "user",
      "content": "Generate a landing page brief."
    }
  ],
  "stream": false
}
```

The adapter should accept the current `ModelRequest.prompt` and convert it into that message array.

V0 should include `max_tokens` only when the gateway option or provider compat config explicitly provides it. Otherwise, keep the request body minimal. This avoids assuming every OpenAI-compatible provider accepts the same defaults.

## URL Normalization

Create a helper similar to `toAnthropicMessagesUrl()`:

```ts
toOpenAIChatCompletionsUrl(baseUrl: string): string
```

Expected behavior:

| Input | Output |
| --- | --- |
| `https://api.openai.com/v1` | `https://api.openai.com/v1/chat/completions` |
| `https://api.openai.com/v1/` | `https://api.openai.com/v1/chat/completions` |
| `https://api.openai.com/v1/chat/completions` | `https://api.openai.com/v1/chat/completions` |
| `https://open.bigmodel.cn/api/paas/v4` | `https://open.bigmodel.cn/api/paas/v4/chat/completions` |
| `https://open.bigmodel.cn/api/paas/v4/` | `https://open.bigmodel.cn/api/paas/v4/chat/completions` |
| `https://open.bigmodel.cn/api/paas/v4/chat/completions` | `https://open.bigmodel.cn/api/paas/v4/chat/completions` |

Do not append `/v1` automatically. The stored provider `baseUrl` owns the compatible API root.

## Authentication

Provider config continues to store only an env var reference:

```ts
{
  api: "openai-completions",
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  apiKeyEnv: "ZHIPU_API_KEY"
}
```

The adapter resolves the real key at call time:

```http
Authorization: Bearer <resolved key>
Content-Type: application/json
```

The actual key, env var name, request headers, full base URL, and raw provider body must not appear in:

- context packs;
- run events;
- Web state;
- audit logs;
- thrown error messages.

## Response Parsing

The adapter should parse the standard Chat Completions response:

```json
{
  "model": "glm-5.1",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "..."
      }
    }
  ],
  "usage": {
    "prompt_tokens": 12,
    "completion_tokens": 8,
    "total_tokens": 20
  }
}
```

Map fields into `ModelResponse`:

```ts
{
  provider: route.provider,
  providerName: route.providerName,
  api: "openai-completions",
  model: payload.model ?? route.model,
  text: choices[0].message.content,
  usage: {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens
  },
  baseUrlConfigured: true,
  apiKeyEnvConfigured: true
}
```

If `choices[0].message.content` is an array of text content parts, concatenate text parts with newlines. If it is a string, return the string. Unsupported or empty content is a response shape error.

## Error Handling

Use the same error classes as `anthropic-messages`:

- `ModelProviderConfigurationError`
- `ModelProviderRequestError`
- `ModelProviderResponseError`

Expected stable error codes:

| Condition | Error code |
| --- | --- |
| missing base URL | `model_provider_base_url_missing` |
| missing API key env reference | `model_provider_api_key_env_missing` |
| env var has no actual key | `model_provider_api_key_missing` |
| no fetch implementation | `model_provider_fetch_unavailable` |
| request timeout | `model_provider_request_timeout` |
| fetch/network failure | `model_provider_request_failed` |
| non-2xx HTTP response | `model_provider_http_error` |
| invalid JSON | `model_provider_response_json_invalid` |
| unsupported response shape | `model_provider_response_shape_invalid` |

Messages must be sanitized. They can include provider id, status code, and stable error category. They must not include:

- API key values;
- env var names;
- request headers;
- full base URL;
- raw response body.

## Gateway Dispatch

`ProviderBackedModelGateway.complete()` should dispatch:

- `anthropic-messages` -> `completeAnthropicMessages()`;
- `openai-completions` -> new `completeOpenAIChatCompletions()`;
- `mock` -> mock response only when `allowMockRoutes` permits it.

After this slice, `openai-completions` must no longer throw protocol-not-implemented when a provider config exists and the route is valid.

If `route.api` and `provider.config.api` disagree, keep the existing protocol mismatch failure.

## Environment Template

Add OpenAI-compatible examples to `.env.example`:

```bash
# OpenAI Chat Completions compatible provider.
# For Zhipu GLM native API, keep this base URL.
OPENAI_COMPATIBLE_BASE_URL=https://open.bigmodel.cn/api/paas/v4
OPENAI_COMPATIBLE_API_KEY=
OPENAI_COMPATIBLE_DEFAULT_MODEL=glm-5.1
```

These names are only templates for integration tests and local smoke tests. Project provider config may still use any env var name, such as `ZHIPU_API_KEY`.

## Integration Test

Add an opt-in test skipped by default unless all required env vars are present:

```bash
REAL_MODEL_PROVIDER_TEST=1
OPENAI_COMPATIBLE_BASE_URL=https://open.bigmodel.cn/api/paas/v4
OPENAI_COMPATIBLE_API_KEY=...
OPENAI_COMPATIBLE_DEFAULT_MODEL=glm-5.1
```

The test should:

- send a minimal prompt;
- assert non-empty text;
- assert usage token counts are numbers;
- assert no key leaks into returned response or audit logs.

Normal `pnpm test` must not perform network calls.

## Web/API Runtime Behavior

No Web UI changes are required in this slice.

Existing Models view can already store:

- provider type;
- API protocol;
- base URL;
- API key env reference;
- model id;
- role routes.

When `REAL_MODEL_RUNTIME=1` and a project route uses `api=openai-completions`, the existing runtime wiring should call the new adapter and persist a sanitized `model.completed` event with usage metadata.

LP artifacts remain deterministic static HTML/CSS/JS through `generateStaticArtifacts()`.

## Testing

Default tests:

- URL normalization;
- request body and headers through fake fetch;
- response parsing for string content;
- response parsing for text content parts;
- usage mapping;
- no key/env/baseUrl leakage in response and audit log;
- missing base URL;
- missing key env ref;
- missing actual env key;
- HTTP error redaction;
- invalid JSON;
- invalid response shape;
- timeout;
- gateway dispatch from `ProviderBackedModelGateway`;
- existing `anthropic-messages` and mock-route behavior remains unchanged.

API/runtime tests:

- `REAL_MODEL_RUNTIME=1` plus project route `api=openai-completions` reaches fake OpenAI-compatible fetch;
- `model.completed` run event contains sanitized provider/model/api/usage metadata;
- real runtime still fails closed for mock routes.

## Acceptance Criteria

- `packages/model-gateway` exports the OpenAI-compatible adapter helper and URL normalizer.
- `ProviderBackedModelGateway` dispatches `openai-completions` to the new adapter.
- Fake-fetch unit tests cover success and failure paths.
- Opt-in real provider integration test is skipped by default.
- `.env.example` documents OpenAI-compatible test/smoke variables.
- `REAL_MODEL_RUNTIME=1` can execute a configured OpenAI-compatible route.
- No actual API key, env var name, full base URL, request header, or raw response body leaks into events or audit logs.
- `mock` routes remain fail-closed in real runtime.
- LP artifact generation remains deterministic static HTML/CSS/JS.
- Documentation index and Chinese learning notes are updated.
