# Anthropic Messages Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first real model provider path: an `anthropic-messages` adapter in `packages/model-gateway` with fake-fetch tests and opt-in real-provider verification.

**Architecture:** Keep the Web and runtime layers deterministic for this slice. Add a focused protocol adapter file for Anthropic Messages request/response handling, then add a provider-backed `ModelGateway` dispatcher that resolves private provider config by route provider id and calls the adapter. Secrets stay inside the gateway boundary and only sanitized metadata returns in `ModelResponse`.

**Tech Stack:** pnpm TypeScript monorepo, Vitest, Node 22 global `fetch`/`Response`/`AbortController`, existing `@lp-agent/model-gateway` interfaces, no new runtime dependencies.

---

## File Structure

- Create `packages/model-gateway/src/anthropic-messages.ts`
  - Owns Anthropic Messages URL construction, request formatting, response parsing, timeout, and provider-specific error classes.
  - Imports only types from `./index` to avoid a runtime cycle.
- Modify `packages/model-gateway/src/index.ts`
  - Exports adapter helpers and error classes.
  - Adds `ModelProviderRuntimeRecord`, `ModelProviderRuntimeResolver`, `ProviderBackedModelGatewayOptions`, and `ProviderBackedModelGateway`.
  - Keeps `InMemoryModelGateway` behavior unchanged.
- Create `packages/model-gateway/src/anthropic-messages.test.ts`
  - Unit tests using fake `fetch` and fake env maps.
- Create `packages/model-gateway/src/anthropic-messages.integration.test.ts`
  - Real provider smoke test skipped unless all required env vars are present.
- Modify `packages/model-gateway/package.json`
  - Run the new test files in the package test script.
- Modify `docs/agent-development-learning.md`
  - Add the implementation-plan link after the adapter design link.
- Modify `docs/superpowers/README.md`
  - Add this plan to the Superpowers reading order.

---

## Task 1: Add Failing Success-Path Unit Tests

**Files:**
- Create: `packages/model-gateway/src/anthropic-messages.test.ts`
- Modify: `packages/model-gateway/package.json`

- [ ] **Step 1: Create the success-path test file**

Create `packages/model-gateway/src/anthropic-messages.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
  ProviderBackedModelGateway,
  createDefaultModelPolicy,
  toAnthropicMessagesUrl,
  type ModelFetch,
  type ModelProviderRuntimeRecord,
  type ModelRoutingPolicy
} from "./index";

function createZhipuProvider(config: Partial<ModelProviderRuntimeRecord["config"]> = {}) {
  return {
    id: "zhipu",
    name: "智谱 GLM",
    enabled: true,
    config: {
      api: "anthropic-messages",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      models: [
        {
          id: "glm-5.1",
          contextWindow: 200000,
          maxTokens: 128000,
          supportsTools: true,
          supportsStreaming: true
        }
      ],
      ...config
    }
  } satisfies ModelProviderRuntimeRecord;
}

function createPolicy(): ModelRoutingPolicy {
  return {
    ...createDefaultModelPolicy(),
    builder: {
      provider: "zhipu",
      providerName: "智谱 GLM",
      api: "anthropic-messages",
      model: "glm-5.1",
      baseUrlConfigured: true,
      apiKeyEnvConfigured: true,
      modelCapabilities: {
        contextWindow: 200000,
        maxTokens: 128000,
        supportsTools: true,
        supportsStreaming: true
      }
    }
  };
}

describe("anthropic messages model gateway", () => {
  it("normalizes Anthropic Messages endpoint URLs", () => {
    expect(toAnthropicMessagesUrl("https://open.bigmodel.cn/api/anthropic")).toBe(
      "https://open.bigmodel.cn/api/anthropic/v1/messages"
    );
    expect(toAnthropicMessagesUrl("https://api.anthropic.com/v1")).toBe(
      "https://api.anthropic.com/v1/messages"
    );
    expect(toAnthropicMessagesUrl("https://api.anthropic.com/v1/messages")).toBe(
      "https://api.anthropic.com/v1/messages"
    );
    expect(toAnthropicMessagesUrl("https://api.anthropic.com/v1/messages/")).toBe(
      "https://api.anthropic.com/v1/messages"
    );
  });

  it("calls an Anthropic-compatible provider with a single-turn prompt", async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fakeFetch: ModelFetch = async (input, init) => {
      calls.push({ input, init });
      return new Response(
        JSON.stringify({
          type: "message",
          model: "glm-5.1",
          content: [{ type: "text", text: "你好，LP 已准备生成。" }],
          usage: { input_tokens: 12, output_tokens: 8 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider(providerId) {
          return providerId === "zhipu" ? createZhipuProvider() : undefined;
        }
      },
      fetch: fakeFetch,
      env: { ANTHROPIC_API_KEY: "sk-test-secret" }
    });

    const result = await gateway.complete({
      role: "builder",
      projectId: "project_1",
      prompt: "生成一个电商 LP",
      routingPolicy: createPolicy()
    });

    expect(result).toMatchObject({
      provider: "zhipu",
      providerName: "智谱 GLM",
      api: "anthropic-messages",
      model: "glm-5.1",
      baseUrlConfigured: true,
      apiKeyEnvConfigured: true,
      text: "你好，LP 已准备生成。",
      usage: { inputTokens: 12, outputTokens: 8 },
      modelCapabilities: {
        contextWindow: 200000,
        maxTokens: 128000,
        supportsTools: true,
        supportsStreaming: true
      }
    });

    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe(
      "https://open.bigmodel.cn/api/anthropic/v1/messages"
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({
      "content-type": "application/json",
      "x-api-key": "sk-test-secret",
      "anthropic-version": "2023-06-01"
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      model: "glm-5.1",
      max_tokens: 1024,
      messages: [{ role: "user", content: "生成一个电商 LP" }]
    });
    expect(JSON.stringify(result)).not.toContain("sk-test-secret");
    expect(JSON.stringify(gateway.getAuditLog())).not.toContain("sk-test-secret");
    expect(JSON.stringify(gateway.getAuditLog())).not.toContain("ANTHROPIC_API_KEY");
  });

  it("keeps mock routes deterministic without provider config", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return undefined;
        }
      }
    });

    const result = await gateway.complete({
      role: "planner",
      projectId: "project_1",
      prompt: "Plan"
    });

    expect(result).toMatchObject({
      provider: "mock-openai",
      model: "planning-model",
      text: "planner response from mock-openai/planning-model"
    });
  });
});
```

- [ ] **Step 2: Update the package test script**

Modify `packages/model-gateway/package.json`:

```json
{
  "scripts": {
    "test": "vitest run src/index.test.ts src/anthropic-messages.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

Keep the existing package name, exports, version, and dependency fields unchanged.

- [ ] **Step 3: Run tests and confirm they fail for missing exports**

Run:

```bash
pnpm --filter @lp-agent/model-gateway test
```

Expected: FAIL because `ProviderBackedModelGateway`, `toAnthropicMessagesUrl`, `ModelFetch`, and `ModelProviderRuntimeRecord` are not exported yet.

- [ ] **Step 4: Commit the failing tests**

```bash
git add packages/model-gateway/src/anthropic-messages.test.ts packages/model-gateway/package.json
git commit -m "test anthropic messages gateway success path"
```

---

## Task 2: Implement Anthropic Messages Success Path

**Files:**
- Create: `packages/model-gateway/src/anthropic-messages.ts`
- Modify: `packages/model-gateway/src/index.ts`
- Test: `packages/model-gateway/src/anthropic-messages.test.ts`

- [ ] **Step 1: Add the adapter module**

Create `packages/model-gateway/src/anthropic-messages.ts`:

```ts
import type {
  ModelProviderRuntimeConfig,
  ModelRequest,
  ModelResponse,
  ModelRoute
} from "./index";

export type ModelFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface AnthropicMessagesCompleteInput {
  request: ModelRequest;
  route: ModelRoute;
  providerConfig: ModelProviderRuntimeConfig;
  fetch?: ModelFetch;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  anthropicVersion?: string;
  maxTokens?: number;
}

export class ModelProviderConfigurationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ModelProviderConfigurationError";
  }
}

export class ModelProviderRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "ModelProviderRequestError";
  }
}

export class ModelProviderResponseError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ModelProviderResponseError";
  }
}

const defaultTimeoutMs = 30000;
const defaultMaxTokens = 1024;
const defaultAnthropicVersion = "2023-06-01";

export function toAnthropicMessagesUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (normalized.endsWith("/v1/messages")) {
    return normalized;
  }
  if (normalized.endsWith("/v1")) {
    return `${normalized}/messages`;
  }
  return `${normalized}/v1/messages`;
}

export async function completeAnthropicMessages(
  input: AnthropicMessagesCompleteInput
): Promise<ModelResponse> {
  const baseUrl = input.providerConfig.baseUrl?.trim();
  if (!baseUrl) {
    throw new ModelProviderConfigurationError(
      "model_provider_base_url_missing",
      `Model provider ${input.route.provider} is missing baseUrl`
    );
  }

  const apiKeyEnv = (input.providerConfig.apiKeyEnv ?? input.providerConfig.secretEnvName)?.trim();
  if (!apiKeyEnv) {
    throw new ModelProviderConfigurationError(
      "model_provider_api_key_env_missing",
      `Model provider ${input.route.provider} is missing apiKeyEnv`
    );
  }

  const env = input.env ?? process.env;
  const apiKey = env[apiKeyEnv]?.trim();
  if (!apiKey) {
    throw new ModelProviderConfigurationError(
      "model_provider_api_key_missing",
      `Environment variable for provider ${input.route.provider} is not configured`
    );
  }

  const fetchImpl = input.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new ModelProviderConfigurationError(
      "model_provider_fetch_unavailable",
      "No fetch implementation is available for model provider requests"
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? defaultTimeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(toAnthropicMessagesUrl(baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": input.anthropicVersion ?? defaultAnthropicVersion
      },
      body: JSON.stringify({
        model: input.route.model,
        max_tokens: input.maxTokens ?? defaultMaxTokens,
        messages: [{ role: "user", content: input.request.prompt }]
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ModelProviderRequestError(
        "model_provider_request_timeout",
        `Model provider ${input.route.provider} request timed out`
      );
    }
    throw new ModelProviderRequestError(
      "model_provider_request_failed",
      `Model provider ${input.route.provider} request failed`
    );
  } finally {
    clearTimeout(timeout);
  }

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
    throw new ModelProviderResponseError(
      "model_provider_response_json_invalid",
      `Model provider ${input.route.provider} returned invalid JSON`
    );
  }

  const parsed = parseAnthropicMessagesResponse(payload, input.route.provider);

  return {
    provider: input.route.provider,
    ...(input.route.providerName ? { providerName: input.route.providerName } : {}),
    api: "anthropic-messages",
    model: parsed.model ?? input.route.model,
    baseUrlConfigured: true,
    apiKeyEnvConfigured: true,
    ...(input.route.modelCapabilities ? { modelCapabilities: { ...input.route.modelCapabilities } } : {}),
    text: parsed.text,
    usage: {
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens
    }
  };
}

function parseAnthropicMessagesResponse(
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
    content?: unknown;
    model?: unknown;
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
  };

  if (!Array.isArray(candidate.content)) {
    throwInvalidShape(providerId);
  }

  const text = candidate.content
    .flatMap((block) => {
      if (!block || typeof block !== "object") {
        return [];
      }
      const contentBlock = block as { type?: unknown; text?: unknown };
      if (contentBlock.type === "text" && typeof contentBlock.text === "string") {
        return contentBlock.text.length > 0 ? [contentBlock.text] : [];
      }
      return [];
    })
    .join("\n");

  if (!text) {
    throwInvalidShape(providerId);
  }

  if (
    !candidate.usage ||
    typeof candidate.usage.input_tokens !== "number" ||
    typeof candidate.usage.output_tokens !== "number"
  ) {
    throwInvalidShape(providerId);
  }

  return {
    text,
    ...(typeof candidate.model === "string" && candidate.model.length > 0
      ? { model: candidate.model }
      : {}),
    inputTokens: candidate.usage.input_tokens,
    outputTokens: candidate.usage.output_tokens
  };
}

function throwInvalidShape(providerId: string): never {
  throw new ModelProviderResponseError(
    "model_provider_response_shape_invalid",
    `Model provider ${providerId} returned an unsupported response shape`
  );
}
```

- [ ] **Step 2: Export adapter helpers and add provider-backed types**

In `packages/model-gateway/src/index.ts`, add this import near the top:

```ts
import {
  ModelProviderConfigurationError,
  completeAnthropicMessages,
  type ModelFetch
} from "./anthropic-messages";
```

Add these exports near the exported type definitions:

```ts
export {
  ModelProviderConfigurationError,
  ModelProviderRequestError,
  ModelProviderResponseError,
  completeAnthropicMessages,
  toAnthropicMessagesUrl,
  type AnthropicMessagesCompleteInput,
  type ModelFetch
} from "./anthropic-messages";

export interface ModelProviderRuntimeRecord {
  id: string;
  name?: string;
  enabled: boolean;
  config: ModelProviderRuntimeConfig;
}

export interface ModelProviderRuntimeResolver {
  getProvider(providerId: string): Promise<ModelProviderRuntimeRecord | undefined>;
}

export interface ProviderBackedModelGatewayOptions {
  policy: ModelRoutingPolicy;
  providers: ModelProviderRuntimeResolver;
  fetch?: ModelFetch;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  anthropicVersion?: string;
  maxTokens?: number;
}
```

- [ ] **Step 3: Add provider-backed dispatch**

In `packages/model-gateway/src/index.ts`, after `InMemoryModelGateway`, add:

```ts
export class ProviderBackedModelGateway implements ModelGateway {
  private readonly auditEntries: ModelAuditEntry[] = [];
  private readonly policy: Partial<ModelRoutingPolicy>;
  private readonly providers: ModelProviderRuntimeResolver;
  private readonly fetch?: ModelFetch;
  private readonly env?: Record<string, string | undefined>;
  private readonly timeoutMs?: number;
  private readonly anthropicVersion?: string;
  private readonly maxTokens?: number;

  constructor(options: ProviderBackedModelGatewayOptions) {
    this.policy = clonePolicy(options.policy);
    this.providers = options.providers;
    this.fetch = options.fetch;
    this.env = options.env;
    this.timeoutMs = options.timeoutMs;
    this.anthropicVersion = options.anthropicVersion;
    this.maxTokens = options.maxTokens;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const policy = request.routingPolicy ? clonePolicy(request.routingPolicy) : this.policy;
    const route = policy[request.role];
    if (!route) {
      throw new ModelRouteNotConfiguredError(request.role);
    }

    this.auditEntries.push({
      role: request.role,
      projectId: request.projectId,
      ...cloneRoute(route),
      promptLength: request.prompt.length,
      context: request.context ? cloneModelRequestContext(request.context) : undefined
    });

    if (route.api === "mock" || (!route.api && route.provider.startsWith("mock-"))) {
      return createMockModelResponse(request, route);
    }

    const provider = await this.providers.getProvider(route.provider);
    if (!provider) {
      throw new ModelProviderConfigurationError(
        "model_provider_config_missing",
        `Model provider config not found for ${route.provider}`
      );
    }
    if (!provider.enabled) {
      throw new ModelProviderConfigurationError(
        "model_provider_disabled",
        `Model provider ${route.provider} is disabled`
      );
    }

    const api = route.api ?? provider.config.api;
    const resolvedRoute: ModelRoute = {
      ...route,
      ...(provider.name && !route.providerName ? { providerName: provider.name } : {}),
      api,
      baseUrlConfigured: Boolean(provider.config.baseUrl),
      apiKeyEnvConfigured: Boolean(provider.config.apiKeyEnv ?? provider.config.secretEnvName)
    };

    if (api === "anthropic-messages") {
      return completeAnthropicMessages({
        request,
        route: resolvedRoute,
        providerConfig: provider.config,
        fetch: this.fetch,
        env: this.env,
        timeoutMs: this.timeoutMs,
        anthropicVersion: this.anthropicVersion,
        maxTokens: this.maxTokens
      });
    }

    if (api === "openai-completions") {
      throw new ModelProviderConfigurationError(
        "model_provider_protocol_not_implemented",
        `Model provider protocol ${api} is not implemented yet`
      );
    }

    return createMockModelResponse(request, resolvedRoute);
  }

  getAuditLog(): readonly ModelAuditEntry[] {
    return this.auditEntries.map((entry) => ({
      ...cloneRoute(entry),
      role: entry.role,
      projectId: entry.projectId,
      promptLength: entry.promptLength,
      context: entry.context ? cloneModelRequestContext(entry.context) : undefined
    }));
  }
}

function createMockModelResponse(request: ModelRequest, route: ModelRoute): ModelResponse {
  return {
    provider: route.provider,
    ...(route.providerName ? { providerName: route.providerName } : {}),
    ...(route.api ? { api: route.api } : {}),
    model: route.model,
    ...(route.baseUrlConfigured !== undefined
      ? { baseUrlConfigured: route.baseUrlConfigured }
      : {}),
    ...(route.apiKeyEnvConfigured !== undefined
      ? { apiKeyEnvConfigured: route.apiKeyEnvConfigured }
      : {}),
    ...(route.modelCapabilities
      ? { modelCapabilities: cloneModelCapabilities(route.modelCapabilities) }
      : {}),
    text: `${request.role} response from ${route.provider}/${route.model}`,
    usage: {
      inputTokens: Math.ceil(request.prompt.length / 4),
      outputTokens: 32
    }
  };
}
```

- [ ] **Step 4: Run model-gateway tests**

Run:

```bash
pnpm --filter @lp-agent/model-gateway test
```

Expected: PASS for `src/index.test.ts` and `src/anthropic-messages.test.ts`.

- [ ] **Step 5: Run typecheck**

Run:

```bash
pnpm --filter @lp-agent/model-gateway typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the success-path implementation**

```bash
git add packages/model-gateway/src/index.ts packages/model-gateway/src/anthropic-messages.ts
git commit -m "add anthropic messages model gateway"
```

---

## Task 3: Add Failing Error, Timeout, and Redaction Tests

**Files:**
- Modify: `packages/model-gateway/src/anthropic-messages.test.ts`

- [ ] **Step 1: Add tests for provider config and protocol failures**

Append these tests inside the existing `describe("anthropic messages model gateway", () => { ... })` block:

```ts
  it("fails when a real provider route has no provider config", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return undefined;
        }
      }
    });

    await expect(
      gateway.complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderConfigurationError",
      code: "model_provider_config_missing"
    });
  });

  it("fails when a provider is disabled", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return { ...createZhipuProvider(), enabled: false };
        }
      }
    });

    await expect(
      gateway.complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderConfigurationError",
      code: "model_provider_disabled"
    });
  });

  it("fails closed for OpenAI-compatible routes until that adapter exists", async () => {
    const policy = createPolicy();
    policy.builder = {
      provider: "zhipu-openai",
      providerName: "智谱 OpenAI",
      api: "openai-completions",
      model: "glm-5.1",
      baseUrlConfigured: true,
      apiKeyEnvConfigured: true
    };

    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return {
            id: "zhipu-openai",
            name: "智谱 OpenAI",
            enabled: true,
            config: {
              api: "openai-completions",
              baseUrl: "https://open.bigmodel.cn/api/paas/v4/",
              apiKeyEnv: "ZHIPU_API_KEY"
            }
          };
        }
      },
      env: { ZHIPU_API_KEY: "sk-test-secret" }
    });

    await expect(
      gateway.complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
        routingPolicy: policy
      })
    ).rejects.toMatchObject({
      name: "ModelProviderConfigurationError",
      code: "model_provider_protocol_not_implemented"
    });
  });
```

- [ ] **Step 2: Add tests for missing endpoint and secrets**

Append:

```ts
  it("fails without a configured base URL", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createZhipuProvider({ baseUrl: undefined });
        }
      },
      env: { ANTHROPIC_API_KEY: "sk-test-secret" }
    });

    await expect(
      gateway.complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
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
          return createZhipuProvider({ apiKeyEnv: undefined });
        }
      },
      env: { ANTHROPIC_API_KEY: "sk-test-secret" }
    });

    await expect(
      gateway.complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
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
          return createZhipuProvider();
        }
      },
      env: {}
    });

    await expect(
      gateway.complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderConfigurationError",
      code: "model_provider_api_key_missing"
    });
  });
```

- [ ] **Step 3: Add tests for HTTP, JSON, response-shape, and timeout failures**

Append:

```ts
  it("fails without leaking provider response text on non-2xx responses", async () => {
    const fakeFetch: ModelFetch = async () =>
      new Response("secret-ish provider diagnostic", { status: 429 });
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createZhipuProvider();
        }
      },
      fetch: fakeFetch,
      env: { ANTHROPIC_API_KEY: "sk-test-secret" }
    });

    await expect(
      gateway.complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderRequestError",
      code: "model_provider_http_error",
      status: 429
    });

    await gateway
      .complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
        routingPolicy: createPolicy()
      })
      .catch((error) => {
        expect(String(error.message)).not.toContain("secret-ish provider diagnostic");
      });
  });

  it("fails on invalid JSON responses", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createZhipuProvider();
        }
      },
      fetch: async () => new Response("not-json", { status: 200 }),
      env: { ANTHROPIC_API_KEY: "sk-test-secret" }
    });

    await expect(
      gateway.complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
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
          return createZhipuProvider();
        }
      },
      fetch: async () =>
        new Response(JSON.stringify({ content: [], usage: {} }), { status: 200 }),
      env: { ANTHROPIC_API_KEY: "sk-test-secret" }
    });

    await expect(
      gateway.complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderResponseError",
      code: "model_provider_response_shape_invalid"
    });
  });

  it("fails on request timeout", async () => {
    const fakeFetch: ModelFetch = async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createZhipuProvider();
        }
      },
      fetch: fakeFetch,
      env: { ANTHROPIC_API_KEY: "sk-test-secret" },
      timeoutMs: 1
    });

    await expect(
      gateway.complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderRequestError",
      code: "model_provider_request_timeout"
    });
  });
```

- [ ] **Step 4: Run the tests and confirm the new cases fail if implementation is incomplete**

Run:

```bash
pnpm --filter @lp-agent/model-gateway test
```

Expected: FAIL only for the newly added cases that are not implemented yet. If Task 2 already covered a case, that case may pass; do not weaken assertions.

- [ ] **Step 5: Commit the failing error tests**

```bash
git add packages/model-gateway/src/anthropic-messages.test.ts
git commit -m "test anthropic messages gateway failures"
```

---

## Task 4: Finish Error Handling and Secret-Safe Behavior

**Files:**
- Modify: `packages/model-gateway/src/anthropic-messages.ts`
- Modify: `packages/model-gateway/src/index.ts`
- Test: `packages/model-gateway/src/anthropic-messages.test.ts`

- [ ] **Step 1: Confirm Task 3 tests pass with the current implementation**

Run:

```bash
pnpm --filter @lp-agent/model-gateway test
```

Expected: PASS. If any Task 3 case fails, update only `packages/model-gateway/src/anthropic-messages.ts` or `packages/model-gateway/src/index.ts` to match the spec-defined error code and redaction behavior.

- [ ] **Step 2: Add a focused redaction regression**

Add these assertions to the success-path test after the existing audit-log redaction checks:

```ts
    expect(JSON.stringify(gateway.getAuditLog())).toContain("\"api\":\"anthropic-messages\"");
    expect(JSON.stringify(gateway.getAuditLog())).not.toContain("https://open.bigmodel.cn");
    expect(JSON.stringify(gateway.getAuditLog())).not.toContain("ANTHROPIC_API_KEY");
    expect(JSON.stringify(gateway.getAuditLog())).not.toContain("sk-test-secret");
```

- [ ] **Step 3: Run model-gateway typecheck**

Run:

```bash
pnpm --filter @lp-agent/model-gateway typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit hardened behavior**

```bash
git add packages/model-gateway/src/anthropic-messages.ts packages/model-gateway/src/index.ts packages/model-gateway/src/anthropic-messages.test.ts
git commit -m "harden anthropic messages provider errors"
```

---

## Task 5: Add Opt-In Real Provider Integration Test

**Files:**
- Create: `packages/model-gateway/src/anthropic-messages.integration.test.ts`
- Modify: `packages/model-gateway/package.json`
- Modify: `docs/agent-development-learning.md`

- [ ] **Step 1: Create skipped-by-default integration test**

Create `packages/model-gateway/src/anthropic-messages.integration.test.ts`:

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
  Boolean(process.env.ANTHROPIC_BASE_URL) &&
  Boolean(process.env.ANTHROPIC_API_KEY) &&
  Boolean(process.env.ANTHROPIC_DEFAULT_MODEL);

const describeIntegration = shouldRun ? describe : describe.skip;

describeIntegration("anthropic messages real provider integration", () => {
  it(
    "returns text from a configured Anthropic-compatible provider",
    async () => {
      const model = process.env.ANTHROPIC_DEFAULT_MODEL ?? "glm-5.1";
      const provider = {
        id: "anthropic-compatible",
        name: "Anthropic compatible",
        enabled: true,
        config: {
          api: "anthropic-messages",
          baseUrl: process.env.ANTHROPIC_BASE_URL,
          apiKeyEnv: "ANTHROPIC_API_KEY",
          models: [{ id: model }]
        }
      } satisfies ModelProviderRuntimeRecord;

      const policy: ModelRoutingPolicy = {
        ...createDefaultModelPolicy(),
        builder: {
          provider: provider.id,
          providerName: provider.name,
          api: "anthropic-messages",
          model,
          baseUrlConfigured: true,
          apiKeyEnvConfigured: true
        }
      };

      const gateway = new ProviderBackedModelGateway({
        policy: createDefaultModelPolicy(),
        providers: {
          async getProvider(providerId) {
            return providerId === provider.id ? provider : undefined;
          }
        },
        env: process.env,
        timeoutMs: 60000
      });

      const result = await gateway.complete({
        role: "builder",
        projectId: "project_real_provider",
        prompt: "用一句中文回复：模型连通性测试成功。",
        routingPolicy: policy
      });

      expect(result.text.trim().length).toBeGreaterThan(0);
      expect(result.provider).toBe(provider.id);
      expect(result.api).toBe("anthropic-messages");
      expect(result.model.length).toBeGreaterThan(0);
      expect(result.usage.inputTokens).toBeGreaterThanOrEqual(0);
      expect(result.usage.outputTokens).toBeGreaterThanOrEqual(0);
      expect(JSON.stringify(result)).not.toContain(process.env.ANTHROPIC_API_KEY);
      expect(JSON.stringify(gateway.getAuditLog())).not.toContain(process.env.ANTHROPIC_API_KEY);
    },
    70000
  );
});
```

- [ ] **Step 2: Include the skipped integration test in the package script**

Modify `packages/model-gateway/package.json`:

```json
{
  "scripts": {
    "test": "vitest run src/index.test.ts src/anthropic-messages.test.ts src/anthropic-messages.integration.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

- [ ] **Step 3: Add local run notes to the learning doc**

In `docs/agent-development-learning.md`, under the Anthropic adapter notes, add:

````md
真实 provider 集成测试默认跳过。需要本机临时导出环境变量后再跑：

```bash
set -a
source .env.local
set +a
pnpm --filter @lp-agent/model-gateway test
```

`.env.local` 中必须至少包含：

- `REAL_MODEL_PROVIDER_TEST=1`
- `ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic`
- `ANTHROPIC_API_KEY=...`
- `ANTHROPIC_DEFAULT_MODEL=glm-5.1`
````

- [ ] **Step 4: Run model-gateway tests without real env**

Run:

```bash
pnpm --filter @lp-agent/model-gateway test
```

Expected: PASS, with the integration suite skipped.

- [ ] **Step 5: Commit integration test and docs**

```bash
git add packages/model-gateway/src/anthropic-messages.integration.test.ts packages/model-gateway/package.json docs/agent-development-learning.md
git commit -m "add opt-in anthropic messages integration test"
```

---

## Task 6: Final Verification and Documentation Index

**Files:**
- Modify: `docs/superpowers/README.md`
- Test: full workspace

- [ ] **Step 1: Ensure the Superpowers index contains this plan**

In `docs/superpowers/README.md`, ensure the reading order includes:

```md
25. `plans/2026-05-14-anthropic-messages-adapter.md`
   - Stage 3 first real model provider adapter implementation plan.
   - Read this after the Anthropic Messages adapter spec when implementing fake-fetch unit tests, provider-backed model-gateway dispatch, opt-in real provider verification, and secret-safe adapter behavior.
```

- [ ] **Step 2: Run package verification**

Run:

```bash
pnpm --filter @lp-agent/model-gateway test
```

Expected: PASS.

Run:

```bash
pnpm --filter @lp-agent/model-gateway typecheck
```

Expected: PASS.

- [ ] **Step 3: Run workspace verification**

Run:

```bash
pnpm test
```

Expected: PASS.

Run:

```bash
pnpm typecheck
```

Expected: PASS.

Run:

```bash
pnpm build
```

Expected: PASS.

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Commit final docs/index update**

```bash
git add docs/superpowers/README.md
git commit -m "document anthropic messages adapter plan"
```

---

## Execution Notes

- Do not put real API keys in tests, docs, run events, audit entries, or git commits.
- Do not wire `ProviderBackedModelGateway` into `packages/api` in this plan.
- Do not implement `openai-completions` in this plan, even though Zhipu `paas/v4` can already be stored in configuration.
- If a real key is needed later, use local shell env or `.env.local`; never ask the user to paste the key into chat.
- The two untracked screenshot files currently in the repository root are unrelated and must not be staged.

## Self-Review Checklist

- Spec coverage:
  - Adapter success path: Tasks 1-2.
  - Provider-backed config boundary: Task 2.
  - Secret redaction: Tasks 1, 3, and 4.
  - Error handling: Tasks 3-4.
  - Opt-in integration: Task 5.
  - No Web/runtime behavior change: execution notes and file structure.
- Placeholder scan: no unfinished markers or vague catch-all steps.
- Type consistency:
  - `ModelProviderRuntimeRecord`, `ModelProviderRuntimeResolver`, `ProviderBackedModelGateway`, and `ModelFetch` are introduced before use.
  - Error code strings are stable across tests and implementation.
  - `apiKeyEnv` remains an env var name, never a secret value.
