# Provider-Neutral Model Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-owned provider-neutral model configuration and prove it through the existing mock runtime chain without making external model API calls.

**Architecture:** Keep the current repository and Prisma shape, because `ModelProvider.config` is already JSON. Extend the TypeScript contracts so provider identity, API protocol, non-secret endpoint config, model manifest, and sanitized runtime metadata are separate. Runtime/model-gateway calls stay deterministic and mock-only, but run events and audit logs should show which configured provider protocol and model were resolved.

**Tech Stack:** pnpm workspace, TypeScript, Vitest, Next.js server actions, local JSON repository state, existing `@lp-agent/model-gateway`, `@lp-agent/runtime-adapters`, `@lp-agent/api`, and `apps/web`.

---

## File Map

- Modify `packages/model-gateway/src/index.ts`
  - Own provider protocol/config types shared by API, runtime, and Web.
  - Extend `ModelRoute`, `ModelResponse`, and audit records with sanitized provider metadata.
- Modify `packages/model-gateway/src/index.test.ts`
  - Verify mock gateway records protocol metadata and does not record secrets.
- Modify `packages/db/src/workbench-repositories.ts`
  - Allow `ModelProviderRecord.config` to store protocol, API key env refs, headers, models, and compat metadata.
- Modify `packages/db/src/workbench-repositories.test.ts`
  - Verify repository defensive copies preserve new config fields.
- Modify `packages/db/src/json-file-workbench-repositories.test.ts`
  - Verify JSON-backed local state reopens provider-neutral config and legacy config.
- Modify `packages/api/src/index.ts`
  - Accept provider-neutral create input.
  - Normalize legacy `secretEnvName` to canonical `apiKeyEnv`.
  - Resolve project role routes into sanitized `ModelRoute` metadata.
- Modify `packages/api/src/context-assembler.ts`
  - Validate enriched `ModelRoutingPolicy` in context packs.
- Modify `packages/api/src/services.test.ts`
  - Cover create/validation/route/runtime context behavior.
- Modify `packages/runtime-adapters/src/index.ts`
  - Pass enriched routes to the model gateway and surface sanitized protocol metadata in `model.completed`.
- Modify `packages/runtime-adapters/src/index.test.ts`
  - Verify model completed events expose metadata but no secrets.
- Modify `apps/web/src/lib/workbench-store.ts`
  - Carry `api`, `apiKeyEnv`, and optional `modelId` from Web forms to the API service.
- Modify `apps/web/src/lib/workbench-store.test.ts`
  - Verify Web store creates provider-neutral configs and maps new stable error codes.
- Modify `apps/web/src/app/actions.ts`
  - Parse new form fields and keep legacy field compatibility.
- Modify `apps/web/src/app/actions.test.ts`
  - Verify server actions pass protocol fields.
- Modify `apps/web/src/lib/i18n.ts`
  - Add English and Chinese labels for API protocol, API key env, provider model id, and new errors.
- Modify `apps/web/src/lib/i18n.test.ts`
  - Verify protocol labels and error copy exist in both locales.
- Modify `apps/web/src/app/page.tsx`
  - Add API protocol select and provider model id input to the Models view.
  - Render sanitized provider protocol/status metadata.
- Modify `apps/web/src/app/page.test.ts`
  - Verify Models view renders protocol controls and saved provider metadata.
- Modify `docs/agent-development-learning.md`
  - Add this implementation plan link under Stage 3 model connection.
- Modify `docs/superpowers/README.md`
  - Add this plan after the provider-neutral model config spec.

---

### Task 1: Extend Model Gateway Contracts

**Files:**
- Modify: `packages/model-gateway/src/index.ts`
- Test: `packages/model-gateway/src/index.test.ts`

- [ ] **Step 1: Write failing tests for provider protocol metadata**

Add this test near the existing request-scoped routing tests in `packages/model-gateway/src/index.test.ts`:

```ts
  it("records sanitized provider protocol metadata from request-scoped routes", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());

    const result = await gateway.complete({
      role: "builder",
      prompt: "Generate HTML",
      projectId: "project_1",
      routingPolicy: {
        planner: { provider: "mock-openai", model: "planning-model" },
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
        },
        reviewer: { provider: "mock-openai", model: "review-model" },
        deployer: { provider: "mock-local", model: "tool-model" }
      }
    });

    expect(result).toMatchObject({
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
    });
    expect(JSON.stringify(gateway.getAuditLog())).not.toContain("sk-");
    expect(gateway.getAuditLog()[0]).toMatchObject({
      provider: "zhipu",
      providerName: "智谱 GLM",
      api: "anthropic-messages",
      model: "glm-5.1",
      baseUrlConfigured: true,
      apiKeyEnvConfigured: true
    });
  });
```

- [ ] **Step 2: Run the focused model gateway test and verify it fails**

Run:

```bash
pnpm --filter @lp-agent/model-gateway test -- index.test.ts
```

Expected: FAIL because `ModelRoute` and `ModelResponse` do not yet expose `api`, provider display metadata, or capability fields.

- [ ] **Step 3: Add provider-neutral types and route metadata**

In `packages/model-gateway/src/index.ts`, replace the current `ModelRoute` block with:

```ts
export type ModelProviderApi = "mock" | "openai-completions" | "anthropic-messages";

export interface ModelProviderHeaderRef {
  env: string;
}

export interface ModelProviderModelConfig {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
  supportsImages?: boolean;
}

export interface ModelProviderRuntimeConfig {
  api: ModelProviderApi;
  baseUrl?: string;
  apiKeyEnv?: string;
  secretEnvName?: string;
  headers?: Record<string, ModelProviderHeaderRef>;
  models?: ModelProviderModelConfig[];
  compat?: Record<string, unknown>;
}

export interface ModelRoute {
  provider: string;
  providerName?: string;
  api?: ModelProviderApi;
  model: string;
  baseUrlConfigured?: boolean;
  apiKeyEnvConfigured?: boolean;
  modelCapabilities?: Omit<ModelProviderModelConfig, "id" | "name"> & {
    name?: string;
  };
}
```

Then extend `ModelResponse` to mirror the sanitized route metadata:

```ts
export interface ModelResponse {
  provider: string;
  providerName?: string;
  api?: ModelProviderApi;
  model: string;
  baseUrlConfigured?: boolean;
  apiKeyEnvConfigured?: boolean;
  modelCapabilities?: ModelRoute["modelCapabilities"];
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}
```

- [ ] **Step 4: Preserve metadata in mock gateway output and defensive copies**

Update the return value in `InMemoryModelGateway.complete()`:

```ts
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
```

Add helper functions near `isModelRoute()`:

```ts
function cloneRoute(route: ModelRoute): ModelRoute {
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
      : {})
  };
}

function cloneModelCapabilities(
  capabilities: NonNullable<ModelRoute["modelCapabilities"]>
): NonNullable<ModelRoute["modelCapabilities"]> {
  return { ...capabilities };
}
```

Update `clonePolicy()` to use the helper:

```ts
      cloned[role] = cloneRoute(route);
```

Update `getAuditLog()` to return cloned route metadata:

```ts
  getAuditLog(): readonly ModelAuditEntry[] {
    return this.auditEntries.map((entry) => ({
      ...cloneRoute(entry),
      role: entry.role,
      projectId: entry.projectId,
      promptLength: entry.promptLength,
      context: entry.context ? cloneModelRequestContext(entry.context) : undefined
    }));
  }
```

Keep `isModelRoute()` strict on `provider` and `model`; do not require `api` so legacy/default routes remain valid.

- [ ] **Step 5: Run the focused model gateway tests**

Run:

```bash
pnpm --filter @lp-agent/model-gateway test -- index.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add packages/model-gateway/src/index.ts packages/model-gateway/src/index.test.ts
git commit -m "add provider metadata to model gateway"
```

---

### Task 2: Expand Repository Provider Config Shape

**Files:**
- Modify: `packages/db/src/workbench-repositories.ts`
- Test: `packages/db/src/workbench-repositories.test.ts`
- Test: `packages/db/src/json-file-workbench-repositories.test.ts`

- [ ] **Step 1: Write failing in-memory repository test**

In `packages/db/src/workbench-repositories.test.ts`, update or add a provider test with this assertion:

```ts
    const provider = {
      id: "zhipu",
      scope: "project" as const,
      targetKey: "project_1",
      name: "智谱 GLM",
      provider: "custom" as const,
      config: {
        api: "anthropic-messages" as const,
        baseUrl: "https://open.bigmodel.cn/api/anthropic",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        headers: {
          "x-extra-key": { env: "ZHIPU_EXTRA_HEADER" }
        },
        models: [
          {
            id: "glm-5.1",
            name: "GLM-5.1",
            contextWindow: 200000,
            maxTokens: 128000,
            supportsTools: true,
            supportsStreaming: true
          }
        ],
        compat: {
          cacheControlFormat: "anthropic"
        }
      },
      enabled: true,
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z"
    };
    await repositories.modelProviders.save(provider);

    const reopened = await repositories.modelProviders.getById("zhipu");
    expect(reopened?.config).toEqual(provider.config);
    provider.config.models[0]!.id = "mutated";
    expect((await repositories.modelProviders.getById("zhipu"))?.config.models?.[0]?.id).toBe(
      "glm-5.1"
    );
```

- [ ] **Step 2: Write failing JSON repository reopen test**

In `packages/db/src/json-file-workbench-repositories.test.ts`, add a case next to the existing model provider persistence test:

```ts
  it("reopens provider-neutral model provider config from disk", async () => {
    const filePath = join(tempRoot, "provider-neutral-state.json");
    const first = createJsonFileWorkbenchRepositories({ filePath });
    await first.modelProviders.save({
      id: "zhipu",
      scope: "project",
      targetKey: "project_1",
      name: "智谱 GLM",
      provider: "custom",
      config: {
        api: "anthropic-messages",
        baseUrl: "https://open.bigmodel.cn/api/anthropic",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        models: [{ id: "glm-5.1", contextWindow: 200000 }]
      },
      enabled: true,
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z"
    });

    const second = createJsonFileWorkbenchRepositories({ filePath });
    await expect(second.modelProviders.getById("zhipu")).resolves.toMatchObject({
      config: {
        api: "anthropic-messages",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        models: [{ id: "glm-5.1", contextWindow: 200000 }]
      }
    });
  });
```

- [ ] **Step 3: Run focused DB tests and verify they fail**

Run:

```bash
pnpm --filter @lp-agent/db test -- workbench-repositories.test.ts json-file-workbench-repositories.test.ts
```

Expected: FAIL because `ModelProviderRecord.config` does not accept the new fields.

- [ ] **Step 4: Update repository type**

In `packages/db/src/workbench-repositories.ts`, update imports:

```ts
import type {
  AgentRole,
  ModelProviderRuntimeConfig
} from "@lp-agent/model-gateway";
```

Replace `ModelProviderRecord.config` with:

```ts
  config: ModelProviderRuntimeConfig;
```

Keep `ModelProviderType` unchanged for backward-compatible Web display and old records:

```ts
export type ModelProviderType = "mock" | "openai" | "anthropic" | "internal" | "custom";
```

Change the provider copy helper to clone the whole config object, even if the current helper already works. This makes the defensive-copy behavior explicit:

```ts
function copyModelProvider(provider: ModelProviderRecord): ModelProviderRecord {
  return {
    ...provider,
    config: structuredClone(provider.config)
  };
}
```

- [ ] **Step 5: Run focused DB tests**

Run:

```bash
pnpm --filter @lp-agent/db test -- workbench-repositories.test.ts json-file-workbench-repositories.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add packages/db/src/workbench-repositories.ts packages/db/src/workbench-repositories.test.ts packages/db/src/json-file-workbench-repositories.test.ts
git commit -m "expand model provider config storage"
```

---

### Task 3: Normalize Provider Config in API Service

**Files:**
- Modify: `packages/api/src/index.ts`
- Test: `packages/api/src/services.test.ts`

- [ ] **Step 1: Write failing service tests**

Add tests near the existing model provider tests in `packages/api/src/services.test.ts`:

```ts
  it("creates provider-neutral model providers with explicit API protocol", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });

    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "zhipu",
      name: "智谱 GLM",
      provider: "custom",
      api: "anthropic-messages",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      modelId: "glm-5.1"
    });

    expect(provider).toMatchObject({
      id: "zhipu",
      provider: "custom",
      config: {
        api: "anthropic-messages",
        baseUrl: "https://open.bigmodel.cn/api/anthropic",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        models: [{ id: "glm-5.1" }]
      }
    });
    expect(JSON.stringify(provider)).not.toContain("sk-");
  });

  it("maps legacy provider types to default API protocols", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });

    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "provider_openai",
      name: "OpenAI",
      provider: "openai",
      secretEnvName: "OPENAI_API_KEY"
    });

    expect(provider.config).toMatchObject({
      api: "openai-completions",
      apiKeyEnv: "OPENAI_API_KEY"
    });
  });

  it("rejects unsupported provider API protocols and invalid API key env refs", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });

    await expect(
      service.createModelProvider({
        projectId: project.id,
        providerId: "bad_api",
        name: "Bad API",
        provider: "custom",
        api: "not-real"
      })
    ).rejects.toThrow("model_provider_api_unsupported");

    await expect(
      service.createModelProvider({
        projectId: project.id,
        providerId: "bad_env",
        name: "Bad Env",
        provider: "custom",
        api: "anthropic-messages",
        apiKeyEnv: "sk-real-secret-value"
      })
    ).rejects.toThrow("model_provider_api_key_env_invalid");
  });
```

- [ ] **Step 2: Run focused API tests and verify they fail**

Run:

```bash
pnpm --filter @lp-agent/api test -- services.test.ts
```

Expected: FAIL because `CreateModelProviderInput` does not accept `api`, `apiKeyEnv`, or `modelId`.

- [ ] **Step 3: Update create input type and imports**

In `packages/api/src/index.ts`, extend imports from `@lp-agent/model-gateway`:

```ts
  type ModelProviderApi,
  type ModelProviderRuntimeConfig,
```

Update `CreateModelProviderInput`:

```ts
export interface CreateModelProviderInput {
  projectId: string;
  providerId: string;
  name: string;
  provider: ModelProviderType;
  api?: ModelProviderApi | string;
  baseUrl?: string;
  apiKeyEnv?: string;
  secretEnvName?: string;
  modelId?: string;
}
```

- [ ] **Step 4: Implement API protocol and config normalization**

Replace `normalizeModelProviderConfig()` and add helpers:

```ts
function normalizeModelProviderApi(
  provider: ModelProviderType,
  api: unknown
): ModelProviderApi {
  if (api === "mock" || api === "openai-completions" || api === "anthropic-messages") {
    return api;
  }
  if (typeof api === "string" && api.trim().length > 0) {
    throw new Error("model_provider_api_unsupported");
  }
  if (provider === "mock") {
    return "mock";
  }
  if (provider === "openai") {
    return "openai-completions";
  }
  if (provider === "anthropic") {
    return "anthropic-messages";
  }
  throw new Error("model_provider_api_required");
}

function normalizeEnvRef(value: string | undefined, errorCode: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(normalized)) {
    throw new Error(errorCode);
  }
  return normalized;
}

function normalizeOptionalUrl(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("invalid_protocol");
    }
    return normalized;
  } catch {
    throw new Error("model_provider_base_url_invalid");
  }
}

function normalizeOptionalModelId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizeModelProviderConfig(input: {
  provider: ModelProviderType;
  api?: ModelProviderApi | string;
  baseUrl?: string;
  apiKeyEnv?: string;
  secretEnvName?: string;
  modelId?: string;
}): ModelProviderRuntimeConfig {
  const api = normalizeModelProviderApi(input.provider, input.api);
  const baseUrl = normalizeOptionalUrl(input.baseUrl);
  const apiKeyEnv = normalizeEnvRef(
    input.apiKeyEnv ?? input.secretEnvName,
    "model_provider_api_key_env_invalid"
  );
  const modelId = normalizeOptionalModelId(input.modelId);

  return {
    api,
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    ...(modelId ? { models: [{ id: modelId }] } : {})
  };
}
```

Update the call site in `createModelProvider()`:

```ts
    const config = normalizeModelProviderConfig({
      provider,
      api: input.api,
      baseUrl: input.baseUrl,
      apiKeyEnv: input.apiKeyEnv,
      secretEnvName: input.secretEnvName,
      modelId: input.modelId
    });
```

- [ ] **Step 5: Keep legacy error code compatibility in Web-facing mapping**

Later Web tasks will map `model_provider_api_key_env_invalid`, but old callers may still expect `model_secret_reference_invalid`. Do not throw the old code from service normalization. Add the new code to Web mapping in Task 6.

- [ ] **Step 6: Run focused API tests**

Run:

```bash
pnpm --filter @lp-agent/api test -- services.test.ts
```

Before rerunning the tests, update existing provider creation assertions that currently expect legacy `secretEnvName`. Replace those expected config blocks with:

```ts
      config: {
        api: "openai-completions",
        baseUrl: "https://api.openai.com/v1",
        apiKeyEnv: "OPENAI_API_KEY"
      },
```

- [ ] **Step 7: Commit Task 3**

```bash
git add packages/api/src/index.ts packages/api/src/services.test.ts
git commit -m "normalize provider-neutral model config"
```

---

### Task 4: Resolve Sanitized Provider Metadata into Runtime Context

**Files:**
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/context-assembler.ts`
- Test: `packages/api/src/services.test.ts`

- [ ] **Step 1: Write failing route metadata and context pack tests**

Add this test near the existing model route test in `packages/api/src/services.test.ts`:

```ts
  it("resolves model routes with sanitized provider metadata", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "zhipu",
      name: "智谱 GLM",
      provider: "custom",
      api: "anthropic-messages",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      modelId: "glm-5.1"
    });
    await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "builder",
      providerId: provider.id,
      model: "glm-5.1"
    });

    const policy = await service.resolveModelRoutingPolicyForProject(project.id);

    expect(policy.builder).toEqual({
      provider: "zhipu",
      providerName: "智谱 GLM",
      api: "anthropic-messages",
      model: "glm-5.1",
      baseUrlConfigured: true,
      apiKeyEnvConfigured: true,
      modelCapabilities: {}
    });
    expect(JSON.stringify(policy)).not.toContain("ANTHROPIC_API_KEY");
  });
```

In the context pack test, extend the expected runtime context:

```ts
        modelRoutingPolicy: {
          builder: expect.objectContaining({
            provider: "mock-anthropic",
            model: "code-model"
          })
        }
```

- [ ] **Step 2: Run focused API tests and verify they fail**

Run:

```bash
pnpm --filter @lp-agent/api test -- services.test.ts
```

Expected: FAIL because route resolution only returns `{ provider, model }` and the context schema rejects extra route fields.

- [ ] **Step 3: Add route metadata helpers**

In `packages/api/src/index.ts`, add helpers near model provider normalization:

```ts
function resolveProviderApi(provider: ModelProviderRecord): ModelProviderApi {
  if (provider.config.api) {
    return provider.config.api;
  }
  return normalizeModelProviderApi(provider.provider, undefined);
}

function findProviderModelConfig(
  provider: ModelProviderRecord,
  modelId: string
): NonNullable<ModelProviderRuntimeConfig["models"]>[number] | undefined {
  return provider.config.models?.find((model) => model.id === modelId);
}

function toRouteModelCapabilities(
  provider: ModelProviderRecord,
  modelId: string
): ModelRoute["modelCapabilities"] {
  const model = findProviderModelConfig(provider, modelId);
  if (!model) {
    return {};
  }
  return {
    ...(model.name ? { name: model.name } : {}),
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
    ...(model.supportsTools !== undefined ? { supportsTools: model.supportsTools } : {}),
    ...(model.supportsStreaming !== undefined
      ? { supportsStreaming: model.supportsStreaming }
      : {}),
    ...(model.supportsImages !== undefined ? { supportsImages: model.supportsImages } : {})
  };
}
```

- [ ] **Step 4: Enrich resolved project routes**

Update the assignment in `resolveModelRoutingPolicyForProject()`:

```ts
      const api = resolveProviderApi(provider);
      resolved[role] = {
        provider: provider.id,
        providerName: provider.name,
        api,
        model: route.model,
        baseUrlConfigured: Boolean(provider.config.baseUrl),
        apiKeyEnvConfigured: Boolean(provider.config.apiKeyEnv ?? provider.config.secretEnvName),
        modelCapabilities: toRouteModelCapabilities(provider, route.model)
      };
```

- [ ] **Step 5: Update context assembler schema for enriched routes**

In `packages/api/src/context-assembler.ts`, replace `ModelRouteSchema` with:

```ts
const ModelProviderApiSchema = z.enum(["mock", "openai-completions", "anthropic-messages"]);

const ModelRouteSchema = z.object({
  provider: z.string().min(1),
  providerName: z.string().min(1).optional(),
  api: ModelProviderApiSchema.optional(),
  model: z.string().min(1),
  baseUrlConfigured: z.boolean().optional(),
  apiKeyEnvConfigured: z.boolean().optional(),
  modelCapabilities: z
    .object({
      name: z.string().min(1).optional(),
      contextWindow: z.number().int().positive().optional(),
      maxTokens: z.number().int().positive().optional(),
      supportsTools: z.boolean().optional(),
      supportsStreaming: z.boolean().optional(),
      supportsImages: z.boolean().optional()
    })
    .optional()
});
```

- [ ] **Step 6: Add trace visibility for provider protocol**

In `assembleContextPack()`, extend `trace.injected`:

```ts
        runtimeContext.modelRoutingPolicy
          ? `modelProvider:${input.role}:${runtimeContext.modelRoutingPolicy[input.role].api ?? "legacy"}`
          : "modelProvider:0",
```

Keep the existing `modelRoutingPolicy:1` trace entry so older tests and UI expectations remain stable.

- [ ] **Step 7: Run focused API tests**

Run:

```bash
pnpm --filter @lp-agent/api test -- services.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add packages/api/src/index.ts packages/api/src/context-assembler.ts packages/api/src/services.test.ts
git commit -m "resolve provider metadata in runtime context"
```

---

### Task 5: Surface Provider Metadata in Runtime Events

**Files:**
- Modify: `packages/runtime-adapters/src/index.ts`
- Test: `packages/runtime-adapters/src/index.test.ts`

- [ ] **Step 1: Write failing runtime event test**

Add this test near `passes runtime model routing policy into model calls`:

```ts
  it("surfaces sanitized provider metadata in model completed events", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
    const runtime = new LocalAgentRuntimeAdapter(gateway);

    const result = await runtime.run({
      runId: "run_builder_provider_metadata",
      projectId: "project_1",
      role: "builder",
      input: { brief: sampleBrief, prompt: "Build" },
      context: {
        skills: [],
        mcpTools: [],
        approval: { state: "not_required" },
        artifactWorkspace: {
          mode: "memory",
          writableFiles: ["index.html", "styles.css", "script.js"]
        },
        modelRoutingPolicy: {
          planner: { provider: "mock-openai", model: "planning-model" },
          builder: {
            provider: "zhipu",
            providerName: "智谱 GLM",
            api: "anthropic-messages",
            model: "glm-5.1",
            baseUrlConfigured: true,
            apiKeyEnvConfigured: true
          },
          reviewer: { provider: "mock-openai", model: "review-model" },
          deployer: { provider: "mock-local", model: "tool-model" }
        }
      }
    });

    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "model.completed",
        provider: "zhipu",
        providerName: "智谱 GLM",
        api: "anthropic-messages",
        model: "glm-5.1",
        baseUrlConfigured: true,
        apiKeyEnvConfigured: true
      })
    );
    expect(JSON.stringify(result.events)).not.toContain("ANTHROPIC_API_KEY");
  });
```

- [ ] **Step 2: Run focused runtime tests and verify they fail**

Run:

```bash
pnpm --filter @lp-agent/runtime-adapters test -- index.test.ts
```

Expected: FAIL because `RuntimeEvent` and `toModelCompletedEvent()` do not expose metadata yet.

- [ ] **Step 3: Extend model.completed event type**

In `packages/runtime-adapters/src/index.ts`, extend the `model.completed` union member:

```ts
      providerName?: string;
      api?: ModelResponse["api"];
      baseUrlConfigured?: boolean;
      apiKeyEnvConfigured?: boolean;
      modelCapabilities?: ModelResponse["modelCapabilities"];
```

- [ ] **Step 4: Copy metadata from model response into event**

Update `toModelCompletedEvent()`:

```ts
function toModelCompletedEvent(request: RuntimeRunRequest, response: ModelResponse): RuntimeEvent {
  return {
    type: "model.completed",
    message: `${request.role} model call completed`,
    runId: request.runId,
    role: request.role,
    provider: response.provider,
    ...(response.providerName ? { providerName: response.providerName } : {}),
    ...(response.api ? { api: response.api } : {}),
    model: response.model,
    ...(response.baseUrlConfigured !== undefined
      ? { baseUrlConfigured: response.baseUrlConfigured }
      : {}),
    ...(response.apiKeyEnvConfigured !== undefined
      ? { apiKeyEnvConfigured: response.apiKeyEnvConfigured }
      : {}),
    ...(response.modelCapabilities
      ? { modelCapabilities: { ...response.modelCapabilities } }
      : {})
  };
}
```

- [ ] **Step 5: Run focused runtime tests**

Run:

```bash
pnpm --filter @lp-agent/runtime-adapters test -- index.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add packages/runtime-adapters/src/index.ts packages/runtime-adapters/src/index.test.ts
git commit -m "surface provider metadata in runtime events"
```

---

### Task 6: Wire Web Store, Actions, and Error Mapping

**Files:**
- Modify: `apps/web/src/lib/workbench-store.ts`
- Test: `apps/web/src/lib/workbench-store.test.ts`
- Modify: `apps/web/src/app/actions.ts`
- Test: `apps/web/src/app/actions.test.ts`

- [ ] **Step 1: Write failing Web store test**

In `apps/web/src/lib/workbench-store.test.ts`, add this test near model provider tests:

```ts
  it("creates provider-neutral model providers through the web store", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({ name: "Project" });

    const provider = await store.createModelProvider({
      projectId: project.id,
      providerId: "zhipu",
      name: "智谱 GLM",
      provider: "custom",
      api: "anthropic-messages",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      modelId: "glm-5.1"
    });

    expect(provider).toMatchObject({
      ok: true,
      value: {
        id: "zhipu",
        config: {
          api: "anthropic-messages",
          apiKeyEnv: "ANTHROPIC_API_KEY",
          models: [{ id: "glm-5.1" }]
        }
      }
    });
  });
```

- [ ] **Step 2: Write failing server action test**

In `apps/web/src/app/actions.test.ts`, add this case near existing model provider action tests:

```ts
  it("passes provider-neutral protocol fields when creating a model provider", async () => {
    mocks.currentProjectId = "project_1";
    mocks.createModelProvider.mockResolvedValue({
      ok: true,
      value: { id: "zhipu" }
    });

    await expectRedirect(
      createModelProviderAction(
        buildSkillForm({
          providerId: "zhipu",
          name: "智谱 GLM",
          provider: "custom",
          api: "anthropic-messages",
          baseUrl: "https://open.bigmodel.cn/api/anthropic",
          apiKeyEnv: "ANTHROPIC_API_KEY",
          modelId: "glm-5.1"
        })
      ),
      "/?view=models"
    );

    expect(mocks.createModelProvider).toHaveBeenCalledWith({
      projectId: "project_1",
      providerId: "zhipu",
      name: "智谱 GLM",
      provider: "custom",
      api: "anthropic-messages",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      secretEnvName: "",
      modelId: "glm-5.1"
    });
  });
```

- [ ] **Step 3: Run focused Web tests and verify they fail**

Run:

```bash
pnpm --filter web test -- workbench-store.test.ts actions.test.ts
```

Expected: FAIL because form/store input types do not accept `api`, `apiKeyEnv`, or `modelId`.

- [ ] **Step 4: Extend Web store input and error codes**

In `apps/web/src/lib/workbench-store.ts`, extend `ModelFlowErrorCode` if defined there:

```ts
  | "model_provider_api_required"
  | "model_provider_api_unsupported"
  | "model_provider_base_url_invalid"
  | "model_provider_api_key_env_invalid"
  | "model_provider_model_id_required"
  | "model_provider_model_limit_invalid"
```

Extend `CreateModelProviderFormInput`:

```ts
  api?: string;
  apiKeyEnv?: string;
  modelId?: string;
```

Update `createModelProvider()` call:

```ts
        const value = await service.createModelProvider({
          ...input,
          provider: input.provider as ModelProviderType
        });
```

This spread already carries the new fields once the type accepts them.

Update `toModelFlowError()` to map the new stable service errors to themselves:

```ts
    case "model_provider_api_required":
    case "model_provider_api_unsupported":
    case "model_provider_base_url_invalid":
    case "model_provider_api_key_env_invalid":
    case "model_provider_model_id_required":
    case "model_provider_model_limit_invalid":
      return message;
```

- [ ] **Step 5: Update server action parsing**

In `apps/web/src/app/actions.ts`, update `createModelProviderAction()`:

```ts
  const result = await getWebWorkbenchStore().createModelProvider({
    projectId,
    providerId: String(formData.get("providerId") ?? ""),
    name: String(formData.get("name") ?? ""),
    provider: String(formData.get("provider") ?? ""),
    api: String(formData.get("api") ?? ""),
    baseUrl: String(formData.get("baseUrl") ?? ""),
    apiKeyEnv: String(formData.get("apiKeyEnv") ?? ""),
    secretEnvName: String(formData.get("secretEnvName") ?? ""),
    modelId: String(formData.get("modelId") ?? "")
  });
```

- [ ] **Step 6: Run focused Web store/action tests**

Run:

```bash
pnpm --filter web test -- workbench-store.test.ts actions.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.ts apps/web/src/app/actions.test.ts
git commit -m "wire provider protocol through web actions"
```

---

### Task 7: Update Models View UI and Localized Copy

**Files:**
- Modify: `apps/web/src/lib/i18n.ts`
- Test: `apps/web/src/lib/i18n.test.ts`
- Modify: `apps/web/src/app/page.tsx`
- Test: `apps/web/src/app/page.test.ts`

- [ ] **Step 1: Write failing i18n test**

In `apps/web/src/lib/i18n.test.ts`, add:

```ts
  it("has localized model provider protocol copy", () => {
    expect(en.modelsView.providerApiLabel).toBe("API protocol");
    expect(en.modelsView.providerApis["anthropic-messages"]).toBe("Anthropic Messages compatible");
    expect(zh.modelsView.providerApiLabel).toBe("API 协议");
    expect(zh.modelsView.providerApis["openai-completions"]).toBe("OpenAI Chat Completions 兼容");
    expect(zh.modelsView.errors.model_provider_api_key_env_invalid).toContain("环境变量");
  });
```

- [ ] **Step 2: Write failing page render test**

In `apps/web/src/app/page.test.ts`, extend the Models view test:

```ts
    expect(text).toContain("API protocol");
    expect(text).toContain("Anthropic Messages compatible");
    expect(text).toContain("Default model id");
```

Add a saved provider render assertion in the provider list test:

```ts
    expect(text).toContain("anthropic-messages");
    expect(text).toContain("Base URL configured");
    expect(text).toContain("API key env configured");
```

- [ ] **Step 3: Run focused Web UI tests and verify they fail**

Run:

```bash
pnpm --filter web test -- i18n.test.ts page.test.ts
```

Expected: FAIL because copy and controls do not exist.

- [ ] **Step 4: Extend i18n types and copy**

In `apps/web/src/lib/i18n.ts`, extend `WorkbenchCopy["modelsView"]`:

```ts
    providerApiLabel: string;
    apiKeyEnvLabel: string;
    providerModelIdLabel: string;
    baseUrlConfigured: string;
    apiKeyEnvConfigured: string;
    providerApis: Record<"mock" | "openai-completions" | "anthropic-messages", string>;
```

In English copy:

```ts
      providerApiLabel: "API protocol",
      apiKeyEnvLabel: "API key env var",
      providerModelIdLabel: "Default model id",
      baseUrlConfigured: "Base URL configured",
      apiKeyEnvConfigured: "API key env configured",
      providerApis: {
        mock: "Mock",
        "openai-completions": "OpenAI Chat Completions compatible",
        "anthropic-messages": "Anthropic Messages compatible"
      },
```

In Chinese copy:

```ts
      providerApiLabel: "API 协议",
      apiKeyEnvLabel: "API Key 环境变量",
      providerModelIdLabel: "默认模型 ID",
      baseUrlConfigured: "已配置 Base URL",
      apiKeyEnvConfigured: "已配置 API Key 环境变量",
      providerApis: {
        mock: "Mock",
        "openai-completions": "OpenAI Chat Completions 兼容",
        "anthropic-messages": "Anthropic Messages 兼容"
      },
```

Add new errors in both locales:

```ts
        model_provider_api_required: "Choose an API protocol.",
        model_provider_api_unsupported: "Choose a supported API protocol.",
        model_provider_base_url_invalid: "Enter a valid http or https Base URL.",
        model_provider_api_key_env_invalid: "Use an environment variable name for the API key.",
        model_provider_model_id_required: "Enter a model id.",
        model_provider_model_limit_invalid: "Model token limits must be positive numbers.",
```

Chinese:

```ts
        model_provider_api_required: "请选择 API 协议。",
        model_provider_api_unsupported: "请选择支持的 API 协议。",
        model_provider_base_url_invalid: "请输入有效的 http 或 https Base URL。",
        model_provider_api_key_env_invalid: "请填写 API Key 环境变量名。",
        model_provider_model_id_required: "请输入模型 ID。",
        model_provider_model_limit_invalid: "模型 token 限制必须是正数。",
```

- [ ] **Step 5: Update Models form in `page.tsx`**

In `apps/web/src/app/page.tsx`, add protocol and model controls after provider type:

```tsx
                      <label htmlFor="api">{copy.modelsView.providerApiLabel}</label>
                      <select id="api" name="api" defaultValue="mock">
                        {(["mock", "openai-completions", "anthropic-messages"] as const).map(
                          (api) => (
                            <option value={api} key={api}>
                              {copy.modelsView.providerApis[api]}
                            </option>
                          )
                        )}
                      </select>
```

Rename the visible API key field to canonical `apiKeyEnv`, while keeping a hidden legacy field out of the form:

```tsx
                      <label htmlFor="apiKeyEnv">{copy.modelsView.apiKeyEnvLabel}</label>
                      <input
                        id="apiKeyEnv"
                        name="apiKeyEnv"
                        aria-describedby="api-key-env-example"
                      />
                      <small id="api-key-env-example">ANTHROPIC_API_KEY</small>

                      <label htmlFor="modelId">{copy.modelsView.providerModelIdLabel}</label>
                      <input id="modelId" name="modelId" aria-describedby="model-id-example" />
                      <small id="model-id-example">glm-5.1</small>
```

Remove or replace the old `secretEnvName` visible input to avoid users entering both fields.

- [ ] **Step 6: Render sanitized provider status**

In the provider list row, extend the provider `<span>`:

```tsx
                              <span>
                                {copy.modelsView.providerTypes[provider.provider]} ·{" "}
                                {provider.config.api ?? "legacy"} ·{" "}
                                {provider.config.baseUrl
                                  ? copy.modelsView.baseUrlConfigured
                                  : copy.modelsView.fallbackLabel} ·{" "}
                                {provider.config.apiKeyEnv || provider.config.secretEnvName
                                  ? copy.modelsView.apiKeyEnvConfigured
                                  : copy.modelsView.fallbackLabel} ·{" "}
                                {provider.enabled
                                  ? copy.modelsView.enabled
                                  : copy.modelsView.disabled}
                              </span>
```

- [ ] **Step 7: Run focused Web UI tests**

Run:

```bash
pnpm --filter web test -- i18n.test.ts page.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 7**

```bash
git add apps/web/src/lib/i18n.ts apps/web/src/lib/i18n.test.ts apps/web/src/app/page.tsx apps/web/src/app/page.test.ts
git commit -m "add provider protocol controls to models view"
```

---

### Task 8: End-to-End Verification and Documentation Updates

**Files:**
- Modify: `docs/agent-development-learning.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Update learning document with the implementation plan link**

In `docs/agent-development-learning.md`, under the current Stage 3 provider-neutral design bullet list, add:

```md
- 当前实现计划：[2026-05-14-provider-neutral-model-config.md](./superpowers/plans/2026-05-14-provider-neutral-model-config.md)
```

- [ ] **Step 2: Update Superpowers README reading order**

In `docs/superpowers/README.md`, add this after the provider-neutral model config spec:

```md
23. `plans/2026-05-14-provider-neutral-model-config.md`
   - Stage 3 provider-neutral model config implementation plan.
   - Read this after the provider-neutral model config spec when implementing generic provider API protocol selection, non-secret provider config storage, sanitized runtime metadata, Web Models controls, and mock-chain verification.
```

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected:

- `pnpm test`: PASS.
- `pnpm typecheck`: PASS.
- `pnpm build`: PASS.
- `git diff --check`: no output.

- [ ] **Step 4: Inspect worktree and ensure screenshots remain untouched**

Run:

```bash
git status --short
```

Expected: only implementation files staged/modified plus the existing untracked screenshot files, unless the user removed them separately.

- [ ] **Step 5: Commit Task 8**

```bash
git add docs/agent-development-learning.md docs/superpowers/README.md
git commit -m "document provider-neutral model config plan"
```

---

## Final Acceptance Checklist

- [ ] A project can create a provider with `api`, `baseUrl`, `apiKeyEnv`, and optional default model id.
- [ ] Legacy provider inputs still map to a default API protocol.
- [ ] Project role routes resolve to sanitized provider metadata.
- [ ] Runtime context pack validates enriched model route metadata.
- [ ] Mock model gateway audit records provider id, protocol, model id, and config presence flags.
- [ ] Runtime `model.completed` events include sanitized provider metadata.
- [ ] Web Models view exposes API protocol selection in English and Chinese.
- [ ] No external model calls are made.
- [ ] No API key values are stored or rendered.
- [ ] Existing default mock routes keep working.
- [ ] Local JSON repository state remains loadable.

## Verification Commands

Run these before declaring implementation complete:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

If any command fails, use `superpowers:systematic-debugging` before changing code.
