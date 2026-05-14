# OpenAI-Compatible Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic `openai-completions` Chat Completions adapter that supports Zhipu `paas/v4` and other OpenAI-compatible providers through the existing model gateway/runtime path.

**Architecture:** Keep the adapter inside `packages/model-gateway` beside `anthropic-messages.ts`. `ProviderBackedModelGateway` dispatches `openai-completions` routes to the new adapter after repository-backed provider resolution, while API/runtime stay protocol-neutral and continue receiving only sanitized `ModelResponse` metadata. Tests use fake fetch by default; the real provider smoke test remains opt-in.

**Tech Stack:** pnpm TypeScript monorepo, Vitest, Node 22 global `fetch`/`Response`/`AbortController`, existing `@lp-agent/model-gateway` interfaces, no OpenAI SDK.

---

## File Structure

- Create `packages/model-gateway/src/openai-completions.ts`
  - Owns OpenAI Chat Completions compatible URL normalization, request formatting, response parsing, timeout, and adapter-level errors.
- Create `packages/model-gateway/src/openai-completions.test.ts`
  - Fake-fetch unit tests for success, URL normalization, content parsing, gateway dispatch, redaction, and failure paths.
- Create `packages/model-gateway/src/openai-completions.integration.test.ts`
  - Opt-in real provider smoke test for Zhipu/OpenAI-compatible providers.
- Modify `packages/model-gateway/src/index.ts`
  - Exports new helper/types and dispatches `openai-completions` through the new adapter.
- Modify `packages/model-gateway/src/anthropic-messages.test.ts`
  - Removes the old fail-closed test that expected `openai-completions` to be unimplemented.
- Modify `packages/model-gateway/package.json`
  - Includes the new unit and integration test files in the package test script.
- Modify `.env.example`
  - Adds OpenAI-compatible local test/smoke variables.
- Modify `packages/api/src/services.test.ts`
  - Adds Web/API/runtime fake-fetch coverage for `REAL_MODEL_RUNTIME=1` plus `api=openai-completions`.
- Modify `docs/agent-development-learning.md`
  - Adds the implementation plan link and the learning note for protocol reuse.
- Modify `docs/superpowers/README.md`
  - Adds this implementation plan to the reading order.

---

## Task 1: Add Failing Model-Gateway Tests

**Files:**
- Create: `packages/model-gateway/src/openai-completions.test.ts`
- Modify: `packages/model-gateway/package.json`

- [ ] **Step 1: Create the OpenAI-compatible unit test file**

Create `packages/model-gateway/src/openai-completions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ProviderBackedModelGateway,
  createDefaultModelPolicy,
  toOpenAIChatCompletionsUrl,
  type ModelFetch,
  type ModelProviderRuntimeRecord,
  type ModelRoutingPolicy
} from "./index";

function createOpenAICompatibleProvider(
  config: Partial<ModelProviderRuntimeRecord["config"]> = {}
) {
  return {
    id: "zhipu-openai",
    name: "智谱 OpenAI Compatible",
    enabled: true,
    config: {
      api: "openai-completions",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
      models: [{ id: "glm-5.1" }],
      ...config
    }
  } satisfies ModelProviderRuntimeRecord;
}

function createPolicy(): ModelRoutingPolicy {
  return {
    ...createDefaultModelPolicy(),
    planner: {
      provider: "zhipu-openai",
      providerName: "智谱 OpenAI Compatible",
      api: "openai-completions",
      model: "glm-5.1",
      baseUrlConfigured: true,
      apiKeyEnvConfigured: true
    }
  };
}

describe("openai compatible chat completions model gateway", () => {
  it("normalizes OpenAI Chat Completions endpoint URLs", () => {
    expect(toOpenAIChatCompletionsUrl("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
    expect(toOpenAIChatCompletionsUrl("https://api.openai.com/v1/")).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
    expect(toOpenAIChatCompletionsUrl("https://api.openai.com/v1/chat/completions")).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
    expect(toOpenAIChatCompletionsUrl("https://open.bigmodel.cn/api/paas/v4")).toBe(
      "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    );
    expect(toOpenAIChatCompletionsUrl("https://open.bigmodel.cn/api/paas/v4/")).toBe(
      "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    );
    expect(
      toOpenAIChatCompletionsUrl(
        "https://open.bigmodel.cn/api/paas/v4/chat/completions"
      )
    ).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
  });

  it("calls an OpenAI-compatible provider with a single-turn prompt", async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fakeFetch: ModelFetch = async (input, init) => {
      calls.push({ input, init });
      return new Response(
        JSON.stringify({
          id: "chatcmpl_test",
          model: "glm-5.1",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "OpenAI-compatible planner response" },
              finish_reason: "stop"
            }
          ],
          usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider(providerId) {
          return providerId === "zhipu-openai"
            ? createOpenAICompatibleProvider()
            : undefined;
        }
      },
      fetch: fakeFetch,
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" }
    });

    const result = await gateway.complete({
      role: "planner",
      projectId: "project_1",
      prompt: "Generate a landing page brief.",
      routingPolicy: createPolicy()
    });

    expect(result).toMatchObject({
      provider: "zhipu-openai",
      providerName: "智谱 OpenAI Compatible",
      api: "openai-completions",
      model: "glm-5.1",
      baseUrlConfigured: true,
      apiKeyEnvConfigured: true,
      text: "OpenAI-compatible planner response",
      usage: { inputTokens: 12, outputTokens: 8 }
    });
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe(
      "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer sk-test-secret"
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      model: "glm-5.1",
      messages: [{ role: "user", content: "Generate a landing page brief." }],
      stream: false
    });
    expect(JSON.stringify(result)).not.toContain("sk-test-secret");
    expect(JSON.stringify(result)).not.toContain("OPENAI_COMPATIBLE_API_KEY");
    expect(JSON.stringify(gateway.getAuditLog())).not.toContain("sk-test-secret");
    expect(JSON.stringify(gateway.getAuditLog())).not.toContain("OPENAI_COMPATIBLE_API_KEY");
    expect(JSON.stringify(gateway.getAuditLog())).not.toContain("https://open.bigmodel.cn");
  });

  it("concatenates text content parts from OpenAI-compatible responses", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider();
        }
      },
      fetch: async () =>
        new Response(
          JSON.stringify({
            model: "glm-5.1",
            choices: [
              {
                message: {
                  role: "assistant",
                  content: [
                    { type: "text", text: "Line one" },
                    { type: "text", text: "Line two" }
                  ]
                }
              }
            ],
            usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        ),
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" }
    });

    const result = await gateway.complete({
      role: "planner",
      projectId: "project_1",
      prompt: "Plan",
      routingPolicy: createPolicy()
    });

    expect(result.text).toBe("Line one\nLine two");
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
  });

  it("includes max_tokens when configured on the gateway", async () => {
    let requestBody: unknown;
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider();
        }
      },
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            model: "glm-5.1",
            choices: [{ message: { role: "assistant", content: "OK" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" },
      maxTokens: 256
    });

    await gateway.complete({
      role: "planner",
      projectId: "project_1",
      prompt: "Plan",
      routingPolicy: createPolicy()
    });

    expect(requestBody).toMatchObject({ max_tokens: 256 });
  });

  it("fails without a configured base URL", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider({ baseUrl: undefined });
        }
      },
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" }
    });

    await expect(
      gateway.complete({
        role: "planner",
        projectId: "project_1",
        prompt: "Plan",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderConfigurationError",
      code: "model_provider_base_url_missing"
    });
  });

  it("fails without an API key env reference", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider({ apiKeyEnv: undefined });
        }
      },
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" }
    });

    await expect(
      gateway.complete({
        role: "planner",
        projectId: "project_1",
        prompt: "Plan",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderConfigurationError",
      code: "model_provider_api_key_env_missing"
    });
  });

  it("fails without the resolved API key value", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider();
        }
      },
      env: {}
    });

    await expect(
      gateway.complete({
        role: "planner",
        projectId: "project_1",
        prompt: "Plan",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderConfigurationError",
      code: "model_provider_api_key_missing"
    });
  });

  it("fails without leaking provider response text on non-2xx responses", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider();
        }
      },
      fetch: async () => new Response("secret-ish provider diagnostic", { status: 429 }),
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" }
    });

    const error = await gateway
      .complete({
        role: "planner",
        projectId: "project_1",
        prompt: "Plan",
        routingPolicy: createPolicy()
      })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "ModelProviderRequestError",
      code: "model_provider_http_error",
      status: 429
    });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("secret-ish provider diagnostic");
  });

  it("fails on invalid JSON responses", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider();
        }
      },
      fetch: async () => new Response("not-json", { status: 200 }),
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" }
    });

    await expect(
      gateway.complete({
        role: "planner",
        projectId: "project_1",
        prompt: "Plan",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderResponseError",
      code: "model_provider_response_json_invalid"
    });
  });

  it("fails on unsupported response shapes", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider();
        }
      },
      fetch: async () =>
        new Response(JSON.stringify({ choices: [], usage: {} }), {
          status: 200,
          headers: { "content-type": "application/json" }
        }),
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" }
    });

    await expect(
      gateway.complete({
        role: "planner",
        projectId: "project_1",
        prompt: "Plan",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderResponseError",
      code: "model_provider_response_shape_invalid"
    });
  });

  it("fails on request timeout", async () => {
    let abortObserved = false;
    const fakeFetch: ModelFetch = async (_input, init) =>
      new Promise<Response>((_resolve) => {
        if (init?.signal?.aborted) {
          abortObserved = true;
          return;
        }
        init?.signal?.addEventListener(
          "abort",
          () => {
            abortObserved = true;
          },
          { once: true }
        );
      });

    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider();
        }
      },
      fetch: fakeFetch,
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" },
      timeoutMs: 1
    });

    await expect(
      gateway.complete({
        role: "planner",
        projectId: "project_1",
        prompt: "Plan",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderRequestError",
      code: "model_provider_request_timeout"
    });
    expect(abortObserved).toBe(true);
  });
});
```

- [ ] **Step 2: Add the new test file to the package test script**

Modify `packages/model-gateway/package.json`:

```json
{
  "scripts": {
    "test": "vitest run src/index.test.ts src/anthropic-messages.test.ts src/openai-completions.test.ts src/anthropic-messages.integration.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

- [ ] **Step 3: Run the package test and confirm the expected failure**

Run:

```bash
pnpm --filter @lp-agent/model-gateway test
```

Expected: FAIL because `toOpenAIChatCompletionsUrl` and the OpenAI-compatible adapter do not exist yet, or because `ProviderBackedModelGateway` still treats `openai-completions` as not implemented.

---

## Task 2: Implement the Adapter and Gateway Dispatch

**Files:**
- Create: `packages/model-gateway/src/openai-completions.ts`
- Modify: `packages/model-gateway/src/index.ts`
- Modify: `packages/model-gateway/src/anthropic-messages.test.ts`
- Test: `packages/model-gateway/src/openai-completions.test.ts`

- [ ] **Step 1: Create the OpenAI-compatible adapter**

Create `packages/model-gateway/src/openai-completions.ts`:

```ts
import {
  ModelProviderConfigurationError,
  ModelProviderRequestError,
  ModelProviderResponseError,
  type ModelFetch
} from "./anthropic-messages";
import type {
  ModelProviderRuntimeConfig,
  ModelRequest,
  ModelResponse,
  ModelRoute
} from "./index";

export interface OpenAIChatCompletionsCompleteInput {
  request: ModelRequest;
  route: ModelRoute;
  providerConfig: ModelProviderRuntimeConfig;
  fetch?: ModelFetch;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  maxTokens?: number;
}

const defaultTimeoutMs = 30000;

export function toOpenAIChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
}

export async function completeOpenAIChatCompletions(
  input: OpenAIChatCompletionsCompleteInput
): Promise<ModelResponse> {
  const baseUrl = trimNonEmpty(input.providerConfig.baseUrl);
  if (!baseUrl) {
    throw new ModelProviderConfigurationError(
      "model_provider_base_url_missing",
      `Model provider ${input.route.provider} is missing baseUrl`
    );
  }

  const apiKeyEnv =
    trimNonEmpty(input.providerConfig.apiKeyEnv) ??
    trimNonEmpty(input.providerConfig.secretEnvName);
  if (!apiKeyEnv) {
    throw new ModelProviderConfigurationError(
      "model_provider_api_key_env_missing",
      `Model provider ${input.route.provider} is missing apiKeyEnv`
    );
  }

  const env = input.env ?? getProcessEnv();
  const apiKey = trimNonEmpty(env[apiKeyEnv]);
  if (!apiKey) {
    throw new ModelProviderConfigurationError(
      "model_provider_api_key_missing",
      `Environment variable for provider ${input.route.provider} is not configured`
    );
  }

  const fetchImpl = input.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new ModelProviderConfigurationError(
      "model_provider_fetch_unavailable",
      "No fetch implementation is available for model provider requests"
    );
  }

  const parsed = await performOpenAIChatCompletionsRequest({
    input,
    baseUrl,
    apiKey,
    fetch: fetchImpl
  });

  return {
    provider: input.route.provider,
    ...(input.route.providerName ? { providerName: input.route.providerName } : {}),
    api: "openai-completions",
    model: parsed.model ?? input.route.model,
    baseUrlConfigured: true,
    apiKeyEnvConfigured: true,
    ...(input.route.modelCapabilities
      ? { modelCapabilities: { ...input.route.modelCapabilities } }
      : {}),
    text: parsed.text,
    usage: {
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens
    }
  };
}

async function performOpenAIChatCompletionsRequest({
  input,
  baseUrl,
  apiKey,
  fetch
}: {
  input: OpenAIChatCompletionsCompleteInput;
  baseUrl: string;
  apiKey: string;
  fetch: ModelFetch;
}): Promise<{
  text: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(
        new ModelProviderRequestError(
          "model_provider_request_timeout",
          `Model provider ${input.route.provider} request timed out`
        )
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(toOpenAIChatCompletionsUrl(baseUrl), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify(createRequestBody(input)),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new ModelProviderRequestError(
            "model_provider_http_error",
            `Model provider ${input.route.provider} returned HTTP ${response.status}`,
            response.status
          );
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          if (controller.signal.aborted) {
            throw createTimeoutError(input.route.provider);
          }
          throw new ModelProviderResponseError(
            "model_provider_response_json_invalid",
            `Model provider ${input.route.provider} returned invalid JSON`
          );
        }

        return parseOpenAIChatCompletionsResponse(payload, input.route.provider);
      })(),
      timeoutPromise
    ]);
  } catch (error) {
    if (
      error instanceof ModelProviderRequestError ||
      error instanceof ModelProviderResponseError
    ) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw createTimeoutError(input.route.provider);
    }
    throw new ModelProviderRequestError(
      "model_provider_request_failed",
      `Model provider ${input.route.provider} request failed`
    );
  } finally {
    clearTimeout(timeout);
  }
}

function createRequestBody(input: OpenAIChatCompletionsCompleteInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.route.model,
    messages: [{ role: "user", content: input.request.prompt }],
    stream: false
  };
  const maxTokens = resolveMaxTokens(input);
  if (maxTokens !== undefined) {
    body.max_tokens = maxTokens;
  }
  return body;
}

function resolveMaxTokens(input: OpenAIChatCompletionsCompleteInput): number | undefined {
  if (isPositiveInteger(input.maxTokens)) {
    return input.maxTokens;
  }
  const compatMaxTokens =
    input.providerConfig.compat?.maxTokens ?? input.providerConfig.compat?.max_tokens;
  return isPositiveInteger(compatMaxTokens) ? compatMaxTokens : undefined;
}

function createTimeoutError(providerId: string): ModelProviderRequestError {
  return new ModelProviderRequestError(
    "model_provider_request_timeout",
    `Model provider ${providerId} request timed out`
  );
}

function parseOpenAIChatCompletionsResponse(
  payload: unknown,
  providerId: string
): {
  text: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
} {
  if (!payload || typeof payload !== "object") {
    throwInvalidShape(providerId);
  }

  const candidate = payload as {
    model?: unknown;
    choices?: unknown;
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  };

  if (!Array.isArray(candidate.choices) || candidate.choices.length === 0) {
    throwInvalidShape(providerId);
  }
  const firstChoice = candidate.choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    throwInvalidShape(providerId);
  }
  const message = (firstChoice as { message?: unknown }).message;
  if (!message || typeof message !== "object") {
    throwInvalidShape(providerId);
  }

  const text = parseMessageContent((message as { content?: unknown }).content);
  if (!text) {
    throwInvalidShape(providerId);
  }

  if (
    !candidate.usage ||
    !isValidUsageTokenCount(candidate.usage.prompt_tokens) ||
    !isValidUsageTokenCount(candidate.usage.completion_tokens)
  ) {
    throwInvalidShape(providerId);
  }

  return {
    text,
    ...(typeof candidate.model === "string" && candidate.model.length > 0
      ? { model: candidate.model }
      : {}),
    inputTokens: candidate.usage.prompt_tokens,
    outputTokens: candidate.usage.completion_tokens
  };
}

function parseMessageContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed ? content : undefined;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const text = content
    .flatMap((part) => {
      if (!part || typeof part !== "object") {
        return [];
      }
      const contentPart = part as { type?: unknown; text?: unknown };
      if (contentPart.type === "text" && typeof contentPart.text === "string") {
        return contentPart.text.length > 0 ? [contentPart.text] : [];
      }
      return [];
    })
    .join("\n");
  return text.length > 0 ? text : undefined;
}

function throwInvalidShape(providerId: string): never {
  throw new ModelProviderResponseError(
    "model_provider_response_shape_invalid",
    `Model provider ${providerId} returned an unsupported response shape`
  );
}

function isValidUsageTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function trimNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function getProcessEnv(): Record<string, string | undefined> {
  return typeof process === "undefined" ? {} : process.env;
}
```

- [ ] **Step 2: Wire the adapter through `packages/model-gateway/src/index.ts`**

Update imports at the top of `packages/model-gateway/src/index.ts`:

```ts
import {
  ModelProviderConfigurationError,
  completeAnthropicMessages,
  type ModelFetch
} from "./anthropic-messages";
import { completeOpenAIChatCompletions } from "./openai-completions";
```

Update exports in the same file:

```ts
export {
  completeOpenAIChatCompletions,
  toOpenAIChatCompletionsUrl,
  type OpenAIChatCompletionsCompleteInput
} from "./openai-completions";
```

Remove the pre-provider lookup `openai-completions` not-implemented block:

```ts
if (route.api === "openai-completions") {
  throwModelProviderProtocolNotImplemented(route.api);
}
```

Replace the post-resolution block:

```ts
if (api === "openai-completions") {
  throwModelProviderProtocolNotImplemented(api);
}
```

with:

```ts
if (api === "openai-completions") {
  return completeOpenAIChatCompletions({
    request,
    route: resolvedRoute,
    providerConfig: provider.config,
    fetch: this.fetch,
    env: this.env,
    timeoutMs: this.timeoutMs,
    maxTokens: this.maxTokens
  });
}
```

Delete `throwModelProviderProtocolNotImplemented()` if it becomes unused.

- [ ] **Step 3: Remove the obsolete fail-closed OpenAI test**

In `packages/model-gateway/src/anthropic-messages.test.ts`, remove the test named:

```ts
it("fails closed for explicit OpenAI-compatible routes before provider lookup", async () => {
  ...
});
```

The new `openai-completions.test.ts` now owns OpenAI-compatible dispatch behavior.

- [ ] **Step 4: Run model-gateway tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/model-gateway test
pnpm --filter @lp-agent/model-gateway typecheck
git diff --check
```

Expected:

- package tests pass;
- typecheck passes;
- `git diff --check` prints no whitespace errors.

- [ ] **Step 5: Commit adapter implementation**

Run:

```bash
git add packages/model-gateway/src/index.ts packages/model-gateway/src/openai-completions.ts packages/model-gateway/src/openai-completions.test.ts packages/model-gateway/src/anthropic-messages.test.ts packages/model-gateway/package.json
git commit -m "add openai compatible chat completions adapter"
```

---

## Task 3: Add Opt-In Integration Test and Environment Template

**Files:**
- Create: `packages/model-gateway/src/openai-completions.integration.test.ts`
- Modify: `packages/model-gateway/package.json`
- Modify: `.env.example`
- Modify: `docs/agent-development-learning.md`

- [ ] **Step 1: Create the opt-in integration test**

Create `packages/model-gateway/src/openai-completions.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ProviderBackedModelGateway,
  createDefaultModelPolicy,
  type ModelProviderRuntimeRecord,
  type ModelRoutingPolicy
} from "./index";

const shouldRun =
  process.env.REAL_MODEL_PROVIDER_TEST === "1" &&
  isNonEmptyString(process.env.OPENAI_COMPATIBLE_BASE_URL) &&
  isNonEmptyString(process.env.OPENAI_COMPATIBLE_API_KEY) &&
  isNonEmptyString(process.env.OPENAI_COMPATIBLE_DEFAULT_MODEL);

const describeIntegration = shouldRun ? describe : describe.skip;

const providerId = "openai-compatible";
const providerName = "OpenAI compatible";
const model = process.env.OPENAI_COMPATIBLE_DEFAULT_MODEL ?? "";

function createOpenAICompatibleProvider(): ModelProviderRuntimeRecord {
  return {
    id: providerId,
    name: providerName,
    enabled: true,
    config: {
      api: "openai-completions",
      baseUrl: process.env.OPENAI_COMPATIBLE_BASE_URL,
      apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
      models: [{ id: model }]
    }
  };
}

function createPolicy(): ModelRoutingPolicy {
  return {
    ...createDefaultModelPolicy(),
    planner: {
      provider: providerId,
      providerName,
      api: "openai-completions",
      model,
      baseUrlConfigured: true,
      apiKeyEnvConfigured: true
    }
  };
}

describeIntegration("openai compatible real provider integration", () => {
  it(
    "completes a planner smoke test through an OpenAI-compatible provider",
    async () => {
      const gateway = new ProviderBackedModelGateway({
        policy: createDefaultModelPolicy(),
        providers: {
          async getProvider(requestedProviderId) {
            return requestedProviderId === providerId
              ? createOpenAICompatibleProvider()
              : undefined;
          }
        },
        env: process.env,
        timeoutMs: 60000
      });

      const result = await gateway.complete({
        role: "planner",
        projectId: "openai_compatible_smoke",
        prompt: "用一句中文回复：OpenAI 兼容模型连通性测试成功。",
        routingPolicy: createPolicy()
      });

      expect(result.text.trim().length).toBeGreaterThan(0);
      expect(result.provider).toBe(providerId);
      expect(result.api).toBe("openai-completions");
      expect(result.model.trim().length).toBeGreaterThan(0);
      expect(result.usage.inputTokens).toBeGreaterThanOrEqual(0);
      expect(result.usage.outputTokens).toBeGreaterThanOrEqual(0);

      const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY ?? "";
      const resultJson = JSON.stringify(result);
      const auditJson = JSON.stringify(gateway.getAuditLog());

      expect(resultJson).not.toContain(apiKey);
      expect(auditJson).not.toContain(apiKey);
    },
    70000
  );
});

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
```

- [ ] **Step 2: Add integration test to package script**

Modify `packages/model-gateway/package.json`:

```json
{
  "scripts": {
    "test": "vitest run src/index.test.ts src/anthropic-messages.test.ts src/openai-completions.test.ts src/anthropic-messages.integration.test.ts src/openai-completions.integration.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

- [ ] **Step 3: Add environment template entries**

Append this block in `.env.example` after the Anthropic/Zhipu aliases:

```bash
# OpenAI Chat Completions compatible provider.
# For Zhipu GLM native API, keep this base URL.
OPENAI_COMPATIBLE_BASE_URL=https://open.bigmodel.cn/api/paas/v4
OPENAI_COMPATIBLE_API_KEY=
OPENAI_COMPATIBLE_DEFAULT_MODEL=glm-5.1
```

- [ ] **Step 4: Confirm Chinese learning notes**

In `docs/agent-development-learning.md`, under `下一步 OpenAI-compatible adapter 设计：`, ensure these bullets are present. Add them only if they are missing:

```md
- 当前实现计划：[2026-05-14-openai-compatible-adapter.md](./superpowers/plans/2026-05-14-openai-compatible-adapter.md)
- 真实集成测试默认跳过；本地验证智谱 `paas/v4` 时使用 `OPENAI_COMPATIBLE_BASE_URL`、`OPENAI_COMPATIBLE_API_KEY`、`OPENAI_COMPATIBLE_DEFAULT_MODEL`。
```

- [ ] **Step 5: Run verification**

Run:

```bash
pnpm --filter @lp-agent/model-gateway test
pnpm --filter @lp-agent/model-gateway typecheck
git diff --check
```

Expected: tests pass with both real provider integration files skipped unless env vars are set.

- [ ] **Step 6: Commit integration docs and env template**

Run:

```bash
git add packages/model-gateway/src/openai-completions.integration.test.ts packages/model-gateway/package.json .env.example docs/agent-development-learning.md
git commit -m "add openai compatible provider smoke test"
```

---

## Task 4: Add API Runtime Wiring Coverage

**Files:**
- Modify: `packages/api/src/services.test.ts`

- [ ] **Step 1: Add API-level OpenAI-compatible runtime test**

Insert this test after the existing `uses provider-backed runtime when REAL_MODEL_RUNTIME is enabled` test in `packages/api/src/services.test.ts`:

```ts
  it("uses OpenAI-compatible provider-backed runtime when REAL_MODEL_RUNTIME is enabled", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const fetchCalls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fakeFetch: ModelFetch = async (input, init) => {
      fetchCalls.push({ input, init });
      return new Response(
        JSON.stringify({
          id: "chatcmpl_test",
          model: "glm-5.1",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "planner response" },
              finish_reason: "stop"
            }
          ],
          usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };
    const service = new DemoWorkbenchService({
      repositories,
      now: fixedClock(),
      env: {
        REAL_MODEL_RUNTIME: "1",
        OPENAI_COMPATIBLE_API_KEY: "sk-test-secret"
      },
      modelFetch: fakeFetch
    });
    const project = await service.createProject({ name: "Project" });
    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "zhipu_openai",
      name: "智谱 OpenAI Compatible",
      provider: "custom",
      api: "openai-completions",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
      modelId: "glm-5.1"
    });
    await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "planner",
      providerId: provider.id,
      model: "glm-5.1"
    });

    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Generate a landing page brief."
    });

    expect(brief.id).toBe("brief_1");
    expect(fetchCalls).toHaveLength(1);
    expect(String(fetchCalls[0]?.input)).toBe(
      "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    );
    expect(fetchCalls[0]?.init?.method).toBe("POST");
    expect(fetchCalls[0]?.init?.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer sk-test-secret"
    });
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toEqual({
      model: "glm-5.1",
      messages: [{ role: "user", content: "Generate a landing page brief." }],
      stream: false
    });

    const events = await repositories.runEvents.listForProject(project.id);
    const modelEvent = events.find((event) => event.type === "model.completed");
    expect(modelEvent).toMatchObject({
      runId: "run_planner_brief_1",
      type: "model.completed",
      message: "planner model call completed",
      payload: expect.objectContaining({
        provider: "zhipu_openai",
        providerName: "智谱 OpenAI Compatible",
        api: "openai-completions",
        model: "glm-5.1",
        baseUrlConfigured: true,
        apiKeyEnvConfigured: true,
        role: "planner",
        usage: { inputTokens: 9, outputTokens: 4 }
      })
    });
    expect(JSON.stringify(events)).not.toContain("sk-test-secret");
    expect(JSON.stringify(events)).not.toContain("OPENAI_COMPATIBLE_API_KEY");
    expect(JSON.stringify(events)).not.toContain("https://open.bigmodel.cn");
  });
```

- [ ] **Step 2: Run API verification**

Run:

```bash
pnpm --filter @lp-agent/api test
pnpm --filter @lp-agent/api typecheck
git diff --check
```

Expected: API test and typecheck pass.

- [ ] **Step 3: Commit API coverage**

Run:

```bash
git add packages/api/src/services.test.ts
git commit -m "cover openai compatible runtime wiring"
```

---

## Task 5: Final Verification and Documentation Index

**Files:**
- Modify if missing: `docs/superpowers/README.md`

- [ ] **Step 1: Confirm the Superpowers reading order**

Ensure this item exists after the OpenAI-compatible adapter design entry in `docs/superpowers/README.md`. Add it only if it is missing:

```md
29. `plans/2026-05-14-openai-compatible-adapter.md`
   - Stage 3 OpenAI-compatible Chat Completions adapter implementation plan.
   - Read this after the OpenAI-compatible adapter design when implementing fake-fetch tests, the generic `openai-completions` adapter, Zhipu `paas/v4` smoke testing, runtime dispatch, and Web/API runtime coverage.
```

- [ ] **Step 2: Run full verification**

Run:

```bash
pnpm --filter @lp-agent/model-gateway test
pnpm --filter @lp-agent/api test
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected:

- `model-gateway` tests pass with real provider integrations skipped by default.
- API tests pass.
- Full workspace tests pass.
- Typecheck passes.
- Build passes.
- `git diff --check` prints no whitespace errors.

- [ ] **Step 3: Commit final docs update only if needed**

If `docs/superpowers/README.md` changed, run:

```bash
git add docs/superpowers/README.md
git commit -m "document openai compatible adapter plan"
```

If no docs changed in this task, do not create an empty commit.

---

## Acceptance Checklist

- [ ] `packages/model-gateway/src/openai-completions.ts` exists and has one focused responsibility.
- [ ] `toOpenAIChatCompletionsUrl()` handles OpenAI and Zhipu `paas/v4` roots without duplicating `/chat/completions`.
- [ ] `ProviderBackedModelGateway` dispatches `openai-completions` through the new adapter.
- [ ] The old protocol-not-implemented path for valid OpenAI-compatible providers is removed.
- [ ] Fake-fetch tests cover success, response parsing, usage mapping, max token option, redaction, HTTP errors, invalid JSON, invalid response shapes, missing config, and timeouts.
- [ ] Opt-in real provider smoke test is skipped unless `REAL_MODEL_PROVIDER_TEST=1` and OpenAI-compatible env vars are present.
- [ ] `.env.example` documents OpenAI-compatible variables.
- [ ] `REAL_MODEL_RUNTIME=1` can execute a configured `api=openai-completions` route.
- [ ] Mock routes still fail closed in real runtime.
- [ ] No actual API key, env var name, full base URL, request header, or raw provider body leaks into run events or audit logs.
- [ ] LP artifact generation remains deterministic static HTML/CSS/JS.
- [ ] Superpowers index and Chinese learning document are updated.
