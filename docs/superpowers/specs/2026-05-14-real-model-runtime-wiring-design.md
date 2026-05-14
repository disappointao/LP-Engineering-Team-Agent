# Real Model Runtime Wiring Design

Date: 2026-05-14

## Status

Approved direction: wire the existing `ProviderBackedModelGateway` into the Web/API/runtime execution path behind an explicit local opt-in switch.

This is Stage 3 after the first real `anthropic-messages` adapter. It makes real model calls observable in run records and timelines, but it does not make model output drive LP artifact generation yet.

## Context

The project currently has three separate layers:

- `packages/model-gateway` can call real `anthropic-messages` providers through `ProviderBackedModelGateway`.
- `packages/runtime-adapters` accepts any `ModelGateway` and records sanitized model metadata in `model.completed` runtime events.
- `packages/api` still constructs `LocalAgentRuntimeAdapter(new InMemoryModelGateway(...))` by default, so Web/API tasks do not use the real provider-backed gateway yet.

The real Zhipu Claude-compatible endpoint was verified through the opt-in model-gateway integration test. The next step should connect the gateway to the service runtime in a controlled way.

## Goals

- Add a Web/API/runtime wiring path that can use `ProviderBackedModelGateway`.
- Keep deterministic mock runtime as the default for all normal tests, local development, and demos.
- Enable real runtime only when an explicit environment flag is present.
- Resolve project-scoped model provider config through the existing repositories.
- Keep secrets inside the model gateway adapter boundary.
- Preserve sanitized run event payloads:
  - provider id;
  - provider display name;
  - API protocol;
  - model id;
  - base URL configured flag;
  - API key env configured flag;
  - model capabilities;
  - usage metadata.
- Make provider failures observable as failed run events and failed run records.
- Keep LP artifact generation deterministic in this slice.

## Non-Goals

- No model-generated LP HTML/CSS/JS.
- No model-generated structured LP brief.
- No streaming.
- No tool calling.
- No fallback chain.
- No provider retry policy beyond the adapter's current bounded timeout.
- No OpenAI-compatible `openai-completions` adapter.
- No secret manager.
- No user-facing key input UI.
- No automatic deployment.

## Runtime Switch

Introduce one explicit runtime switch:

```bash
REAL_MODEL_RUNTIME=1
```

Behavior:

- unset or any value other than `1`: API creates the current deterministic in-memory runtime adapters;
- `REAL_MODEL_RUNTIME=1`: API creates runtime adapters backed by `ProviderBackedModelGateway`.

The existing integration-test switch remains separate:

```bash
REAL_MODEL_PROVIDER_TEST=1
```

`REAL_MODEL_PROVIDER_TEST` only controls test execution. It must not enable real Web/API runtime calls.

## Provider Config Resolution

`ProviderBackedModelGateway` already expects a `ModelProviderRuntimeResolver`.

Add a repository-backed resolver inside `packages/api` or a small API-local helper:

```ts
interface ModelProviderRuntimeResolver {
  getProvider(providerId: string): Promise<ModelProviderRuntimeRecord | undefined>;
}
```

Resolver behavior:

- load provider by id from `repositories.modelProviders`;
- return `undefined` if the provider does not exist;
- preserve `enabled`, `name`, and non-secret `config`;
- do not read actual key values;
- do not attach `apiKeyEnv` or base URL to runtime context, context packs, run events, or Web state.

The real secret value is still read only inside the model-gateway adapter through the configured environment variable name.

## Runtime Adapter Factory

Replace the current fixed helper:

```ts
function createLocalRuntimeAdapter(): LocalAgentRuntimeAdapter {
  return new LocalAgentRuntimeAdapter(new InMemoryModelGateway(createDefaultModelPolicy()));
}
```

with a factory that can receive repository access and environment state:

- default path returns `LocalAgentRuntimeAdapter(new InMemoryModelGateway(createDefaultModelPolicy()))`;
- real path returns `LocalAgentRuntimeAdapter(new ProviderBackedModelGateway({ policy, providers, env }))`.

The factory should be API-owned because it depends on repositories. `packages/runtime-adapters` should remain provider-agnostic and keep accepting a `ModelGateway`.

## Routing Flow

When `REAL_MODEL_RUNTIME=1`:

1. Web submits a task as it does today.
2. `DemoWorkbenchService` creates run steps as it does today.
3. `runAgentStep()` assembles a Context Pack.
4. Context Pack includes the resolved project model routing policy.
5. `LocalAgentRuntimeAdapter` calls `modelGateway.complete()` with that routing policy.
6. `ProviderBackedModelGateway` resolves private provider config by provider id.
7. If the route is `anthropic-messages`, it calls the real adapter.
8. Runtime emits `model.completed` on success, or `run.failed` on failure.

The runtime should not bypass Context Pack. This keeps model routing observable and keeps future context compression/retrieval work aligned with the same path.

## Error Handling

For this slice, failure should be explicit and observable:

- missing provider config -> failed run;
- disabled provider -> failed run;
- protocol mismatch -> failed run;
- unsupported protocol -> failed run;
- missing base URL -> failed run;
- missing API key env ref -> failed run;
- missing actual env key value -> failed run;
- request timeout/network/HTTP/response shape error -> failed run.

Do not automatically fallback to mock in this slice. Silent fallback would make users believe a real model was used when it was not.

Run events and persisted payloads must not include:

- actual API key;
- env var name;
- full base URL;
- request headers;
- raw provider body.

The existing `run.failed` event can record the error class name and sanitized message.

## Web Behavior

No new UI is required in this slice.

The existing Models view can already create project providers and routes. The operator enables real runtime through local env:

```bash
REAL_MODEL_RUNTIME=1
ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_DEFAULT_MODEL=glm-5.1
```

The Web page should continue to show the same timeline. The difference is that the `model.completed` payload should now reflect the real provider route when the route is configured for a project.

## LP Artifact Boundary

Even when a real model call succeeds, the builder's LP artifact generation remains deterministic:

- `generateStaticArtifacts()` still creates static HTML/CSS/JS from the current brief;
- the generated LP artifact remains framework-free;
- model text is not parsed into an LP artifact in this slice.

This deliberately separates "real model execution" from "model-generated product output". The latter needs structured output parsing, Zod validation, repair, and fallback behavior.

## Testing

Default test suite:

- `REAL_MODEL_RUNTIME` unset;
- all existing tests continue to use deterministic mock behavior;
- no network.

Unit tests:

- runtime factory uses `InMemoryModelGateway` when flag is unset;
- runtime factory uses `ProviderBackedModelGateway` when `REAL_MODEL_RUNTIME=1`;
- repository-backed resolver returns enabled provider config without exposing secrets;
- missing provider config produces failed run event;
- real gateway metadata appears in `model.completed` event payload with only sanitized fields;
- `REAL_MODEL_PROVIDER_TEST=1` does not accidentally enable runtime wiring.

Optional local smoke test:

- user fills `.env.local`;
- starts Web/API with `REAL_MODEL_RUNTIME=1`;
- creates provider and route in Models view;
- submits a simple task;
- confirms run timeline includes real provider metadata.

This smoke test can be manual for V0. Automated network tests remain in `packages/model-gateway`.

## Acceptance Criteria

- API runtime adapter construction supports deterministic and provider-backed modes.
- Deterministic mode remains default and keeps current tests stable.
- Provider-backed mode resolves project provider config from repositories.
- Real adapter failures surface as failed run records/events without leaking secrets.
- Successful real calls surface sanitized provider/model metadata in run events.
- LP artifacts remain deterministic static HTML/CSS/JS.
- Documentation explains how `REAL_MODEL_RUNTIME` differs from `REAL_MODEL_PROVIDER_TEST`.
