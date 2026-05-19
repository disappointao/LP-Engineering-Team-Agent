# Model Repair、Retry 和 Fallback v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为真实模型 runtime 增加 Planner/Builder one-shot structured output repair、provider 临时错误 bounded retry，以及 fallback route 安全 metadata / event。

**Architecture:** `packages/runtime-adapters` 负责 provider retry classification、retry events 和 fallback availability events；`packages/api` 负责业务 schema repair，因为 `LPBriefSchema`、`StaticArtifactsSchema` 和 artifact policy 是 API-owned 边界。fallback v0 只从 repository route 配置解析为安全 metadata，不自动调用 fallback provider。

**Tech Stack:** pnpm workspace、TypeScript、Vitest、Next.js、`@lp-agent/model-gateway`、`@lp-agent/runtime-adapters`、`@lp-agent/api`。

---

## File Structure

- Modify `packages/model-gateway/src/index.ts`
  - Add `ModelFallbackRouteMetadata`.
  - Add optional `fallback` to `ModelRoute`.
  - Ensure route cloning preserves fallback metadata without secrets.
- Modify `packages/runtime-adapters/src/index.ts`
  - Add runtime event variants for `model.retry.*`, `model.fallback.*`, and `model.output.repair_*`.
  - Add bounded provider retry wrapper around `modelGateway.complete()`.
  - Emit fallback metadata event when a provider failure remains terminal.
- Modify `packages/runtime-adapters/src/index.test.ts`
  - Add retry classification tests.
  - Add fallback metadata event tests.
  - Add runtime event typing coverage for repair events.
- Modify `packages/api/src/index.ts`
  - Resolve route fallback metadata from repository records.
  - Add Planner / Builder repair finalizers that call the same runtime once with repair prompt.
  - Add safe repair event helpers.
- Modify `packages/api/src/structured-lp-brief.ts`
  - Add `createStructuredLPBriefRepairPrompt()`.
- Modify `packages/api/src/structured-lp-brief.test.ts`
  - Test repair prompt content and safety.
- Modify `packages/api/src/structured-static-artifacts.ts`
  - Add `createStructuredStaticArtifactsRepairPrompt()`.
- Modify `packages/api/src/structured-static-artifacts.test.ts`
  - Test repair prompt content and safety.
- Modify `packages/api/src/services.test.ts`
  - Add fallback metadata resolver tests.
  - Add Planner repair success/failure tests.
  - Add Builder repair success/failure tests.
  - Add retry/fallback safety integration tests where API persistence matters.
- Modify `packages/api/src/run-lifecycle.test.ts`
  - Teach lifecycle diagnostics that repaired runs can complete after parse failure.
  - Ensure fallback events are recovery hints, not success signals.
- Modify docs:
  - `docs/project-roadmap.md`
  - `docs/agent-development-learning.md`
  - `docs/superpowers/README.md`

---

### Task 1: Runtime Retry and Fallback Event Contract

**Files:**
- Modify: `packages/model-gateway/src/index.ts`
- Modify: `packages/runtime-adapters/src/index.ts`
- Test: `packages/runtime-adapters/src/index.test.ts`

- [ ] **Step 1: Write failing runtime tests**

Add these imports in `packages/runtime-adapters/src/index.test.ts`:

```ts
import {
  InMemoryModelGateway,
  ModelProviderConfigurationError,
  ModelProviderRequestError,
  ModelProviderResponseError,
  createDefaultModelPolicy,
  type ModelGateway,
  type ModelRequest,
  type ModelResponse
} from "@lp-agent/model-gateway";
```

Add these tests near existing runtime adapter tests:

```ts
it("retries retryable provider request failures once before succeeding", async () => {
  const gateway = new SequencedModelGateway([
    new ModelProviderRequestError(
      "model_provider_request_timeout",
      "timeout with SECRET_MODEL_ERROR",
      undefined
    ),
    {
      provider: "provider_primary",
      model: "gpt-5.4",
      text: "recovered text",
      usage: { inputTokens: 2, outputTokens: 3 }
    }
  ]);
  const adapter = new LocalAgentRuntimeAdapter(gateway);

  const result = await adapter.run({
    runId: "run_retry_1",
    projectId: "project_1",
    role: "planner",
    input: { prompt: "Plan" }
  });

  expect(result.state).toBe("completed");
  expect(gateway.calls).toBe(2);
  expect(result.modelOutputText).toBe("recovered text");
  expect(result.events.map((event) => event.type)).toEqual([
    "run.started",
    "model.retry.scheduled",
    "model.completed",
    "run.completed"
  ]);
  expect(result.events[1]).toMatchObject({
    type: "model.retry.scheduled",
    role: "planner",
    attempt: 1,
    maxAttempts: 2,
    errorCode: "model_provider_request_timeout",
    retryable: true
  });
  expect(JSON.stringify(result.events)).not.toContain("SECRET_MODEL_ERROR");
});

it("does not retry provider configuration errors", async () => {
  const gateway = new SequencedModelGateway([
    new ModelProviderConfigurationError(
      "model_provider_config_missing",
      "missing config SECRET_MODEL_ERROR"
    )
  ]);
  const adapter = new LocalAgentRuntimeAdapter(gateway);

  const result = await adapter.run({
    runId: "run_retry_config_1",
    projectId: "project_1",
    role: "planner",
    input: { prompt: "Plan" }
  });

  expect(result.state).toBe("failed");
  expect(gateway.calls).toBe(1);
  expect(result.events.map((event) => event.type)).toEqual([
    "run.started",
    "model.fallback.not_configured",
    "run.failed"
  ]);
  expect(JSON.stringify(result.events)).not.toContain("SECRET_MODEL_ERROR");
});

it("emits fallback availability metadata without executing fallback provider", async () => {
  const gateway = new SequencedModelGateway([
    new ModelProviderRequestError(
      "model_provider_http_error",
      "HTTP 503 SECRET_MODEL_ERROR",
      503
    ),
    new ModelProviderRequestError(
      "model_provider_http_error",
      "HTTP 503 SECRET_MODEL_ERROR",
      503
    )
  ]);
  const adapter = new LocalAgentRuntimeAdapter(gateway);
  const context: RuntimeRunContext = {
    ...createDefaultRuntimeContext(),
    modelRoutingPolicy: {
      ...createDefaultModelPolicy(),
      planner: {
        provider: "provider_primary",
        providerName: "Primary",
        api: "openai-completions",
        model: "gpt-5.4",
        baseUrlConfigured: true,
        apiKeyEnvConfigured: true,
        fallback: {
          provider: "provider_backup",
          providerName: "Backup",
          api: "openai-completions",
          model: "gpt-5.4-mini",
          baseUrlConfigured: true,
          apiKeyEnvConfigured: true
        }
      }
    }
  };

  const result = await adapter.run({
    runId: "run_fallback_1",
    projectId: "project_1",
    role: "planner",
    input: { prompt: "Plan" },
    context
  });

  expect(result.state).toBe("failed");
  expect(gateway.calls).toBe(2);
  expect(result.events.map((event) => event.type)).toEqual([
    "run.started",
    "runtime.context.loaded",
    "model.retry.scheduled",
    "model.retry.exhausted",
    "model.fallback.available",
    "run.failed"
  ]);
  expect(result.events[4]).toMatchObject({
    type: "model.fallback.available",
    role: "planner",
    provider: "provider_backup",
    providerName: "Backup",
    api: "openai-completions",
    model: "gpt-5.4-mini",
    baseUrlConfigured: true,
    apiKeyEnvConfigured: true
  });
  expect(JSON.stringify(result.events)).not.toContain("SECRET_MODEL_ERROR");
});
```

Add the helper class at the bottom of `packages/runtime-adapters/src/index.test.ts`:

```ts
class SequencedModelGateway implements ModelGateway {
  calls = 0;

  constructor(private readonly outcomes: Array<ModelResponse | Error>) {}

  async complete(_request: ModelRequest): Promise<ModelResponse> {
    this.calls += 1;
    const outcome = this.outcomes.shift();
    if (!outcome) {
      throw new Error("unexpected_model_call");
    }
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome;
  }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @lp-agent/runtime-adapters test
```

Expected: FAIL because `ModelRoute.fallback` and `model.retry.*` / `model.fallback.*` event variants do not exist, and `LocalAgentRuntimeAdapter` does not retry.

- [ ] **Step 3: Add model route fallback metadata contract**

In `packages/model-gateway/src/index.ts`, add:

```ts
export interface ModelFallbackRouteMetadata {
  provider: string;
  providerName?: string;
  api?: ModelProviderApi;
  model: string;
  baseUrlConfigured: boolean;
  apiKeyEnvConfigured: boolean;
}
```

Extend `ModelRoute`:

```ts
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
  fallback?: ModelFallbackRouteMetadata;
}
```

Update `cloneRoute(route)` in the same file to preserve fallback:

```ts
function cloneRoute(route: ModelRoute): ModelRoute {
  return {
    ...route,
    ...(route.modelCapabilities
      ? { modelCapabilities: { ...route.modelCapabilities } }
      : {}),
    ...(route.fallback ? { fallback: { ...route.fallback } } : {})
  };
}
```

- [ ] **Step 4: Add runtime event types and retry helpers**

In `packages/runtime-adapters/src/index.ts`, import provider error classes:

```ts
import {
  InMemoryModelGateway,
  ModelProviderConfigurationError,
  ModelProviderRequestError,
  ModelProviderResponseError,
  createDefaultModelPolicy,
  type AgentRole,
  type ModelAgentHandoffSummary,
  type ModelFallbackRouteMetadata,
  type ModelGateway,
  type ModelContextMemory,
  type ModelContextMemoryArtifactFile,
  type ModelRequest,
  type ModelRequestContext,
  type ModelRoutingPolicy,
  type ModelResponse
} from "@lp-agent/model-gateway";
```

Add runtime event variants to `RuntimeEvent`:

```ts
  | {
      type: "model.retry.scheduled";
      message: string;
      runId?: string;
      role?: AgentRole;
      attempt: number;
      maxAttempts: number;
      errorCode: string;
      retryable: boolean;
      status?: number;
    }
  | {
      type: "model.retry.exhausted";
      message: string;
      runId?: string;
      role?: AgentRole;
      attempts: number;
      errorCode: string;
      status?: number;
    }
  | {
      type: "model.fallback.available";
      message: string;
      runId?: string;
      role?: AgentRole;
      provider: string;
      providerName?: string;
      api?: ModelResponse["api"];
      model: string;
      baseUrlConfigured: boolean;
      apiKeyEnvConfigured: boolean;
    }
  | {
      type: "model.fallback.not_configured";
      message: string;
      runId?: string;
      role?: AgentRole;
    }
  | {
      type: "model.output.repair_started";
      message: string;
      runId?: string;
      role?: AgentRole;
      schema: "LPBriefSchema" | "StaticArtifactsSchema";
      reason: "empty_output" | "invalid_json" | "schema_invalid" | "policy_violation";
      policyCode?: string;
      issueCount?: number;
      firstIssuePath?: string;
      firstIssueCode?: string;
    }
  | {
      type: "model.output.repaired";
      message: string;
      runId?: string;
      role?: AgentRole;
      schema: "LPBriefSchema" | "StaticArtifactsSchema";
      title?: string;
      sectionCount?: number;
      productCount?: number;
      hasAssets?: boolean;
      artifactKind?: "three-file-static";
      htmlBytes?: number;
      cssBytes?: number;
      jsBytes?: number;
      hasExternalCss?: boolean;
      hasExternalImages?: boolean;
    }
  | {
      type: "model.output.repair_failed";
      message: string;
      runId?: string;
      role?: AgentRole;
      schema: "LPBriefSchema" | "StaticArtifactsSchema";
      reason: "empty_output" | "invalid_json" | "schema_invalid" | "policy_violation";
      policyCode?: string;
      issueCount?: number;
      firstIssuePath?: string;
      firstIssueCode?: string;
    }
```

Add helpers below `toModelCompletedEvent()`:

```ts
const maxModelProviderAttempts = 2;

async function completeModelWithRetry(input: {
  gateway: ModelGateway;
  request: ModelRequest;
  runRequest: RuntimeRunRequest;
  events: RuntimeEvent[];
}): Promise<ModelResponse> {
  let attempt = 1;
  while (true) {
    try {
      return await input.gateway.complete(input.request);
    } catch (error) {
      const summary = summarizeProviderError(error);
      if (!summary.retryable || attempt >= maxModelProviderAttempts) {
        if (summary.retryable) {
          input.events.push({
            type: "model.retry.exhausted",
            message: `${input.runRequest.role} model retry exhausted`,
            runId: input.runRequest.runId,
            role: input.runRequest.role,
            attempts: attempt,
            errorCode: summary.errorCode,
            ...(summary.status !== undefined ? { status: summary.status } : {})
          });
        }
        throw error;
      }
      input.events.push({
        type: "model.retry.scheduled",
        message: `${input.runRequest.role} model retry scheduled`,
        runId: input.runRequest.runId,
        role: input.runRequest.role,
        attempt,
        maxAttempts: maxModelProviderAttempts,
        errorCode: summary.errorCode,
        retryable: true,
        ...(summary.status !== undefined ? { status: summary.status } : {})
      });
      attempt += 1;
    }
  }
}

function summarizeProviderError(error: unknown): {
  errorCode: string;
  retryable: boolean;
  status?: number;
} {
  if (error instanceof ModelProviderRequestError) {
    const retryable =
      error.code === "model_provider_request_timeout" ||
      error.code === "model_provider_request_failed" ||
      (error.code === "model_provider_http_error" &&
        (error.status === 429 || (error.status !== undefined && error.status >= 500)));
    return {
      errorCode: error.code,
      retryable,
      ...(error.status !== undefined ? { status: error.status } : {})
    };
  }
  if (error instanceof ModelProviderResponseError) {
    return {
      errorCode: error.code,
      retryable: error.code === "model_provider_response_json_invalid"
    };
  }
  if (error instanceof ModelProviderConfigurationError) {
    return { errorCode: error.code, retryable: false };
  }
  return { errorCode: "model_provider_unknown_error", retryable: false };
}
```

Update `LocalAgentRuntimeAdapter.run()` to call the wrapper:

```ts
const modelRequest: ModelRequest = {
  role: request.role,
  projectId: request.projectId,
  prompt: toModelPrompt(request),
  context: toModelRequestContext(context),
  ...(context.modelRoutingPolicy ? { routingPolicy: context.modelRoutingPolicy } : {})
};
const modelResponse = await completeModelWithRetry({
  gateway: this.modelGateway,
  request: modelRequest,
  runRequest: request,
  events
});
```

Update the `catch` block before `toRunFailedEvent()`:

```ts
const fallback = context.modelRoutingPolicy?.[request.role]?.fallback;
events.push(
  fallback
    ? toFallbackAvailableEvent(request, fallback)
    : {
        type: "model.fallback.not_configured",
        message: `${request.role} model fallback not configured`,
        runId: request.runId,
        role: request.role
      }
);
events.push(toRunFailedEvent(request, error));
```

Add:

```ts
function toFallbackAvailableEvent(
  request: RuntimeRunRequest,
  fallback: ModelFallbackRouteMetadata
): RuntimeEvent {
  return {
    type: "model.fallback.available",
    message: `${request.role} model fallback available`,
    runId: request.runId,
    role: request.role,
    provider: fallback.provider,
    ...(fallback.providerName ? { providerName: fallback.providerName } : {}),
    ...(fallback.api ? { api: fallback.api } : {}),
    model: fallback.model,
    baseUrlConfigured: fallback.baseUrlConfigured,
    apiKeyEnvConfigured: fallback.apiKeyEnvConfigured
  };
}
```

Make `toRunFailedEvent()` safe for provider errors:

```ts
function toRunFailedEvent(request: RuntimeRunRequest, error: unknown): RuntimeEvent {
  const providerSummary = summarizeProviderError(error);
  const isProviderError =
    error instanceof ModelProviderConfigurationError ||
    error instanceof ModelProviderRequestError ||
    error instanceof ModelProviderResponseError;
  return {
    type: "run.failed",
    message: isProviderError ? `${request.role} model provider failed` : "Runtime run failed.",
    runId: request.runId,
    role: request.role,
    state: "failed",
    errorName: error instanceof Error ? error.name : undefined,
    ...(isProviderError ? { errorCode: providerSummary.errorCode } : {})
  };
}
```

If TypeScript rejects `errorCode` on `run.failed`, extend the `run.failed` runtime event variant with `errorCode?: string`.

- [ ] **Step 5: Verify runtime tests pass**

Run:

```bash
pnpm --filter @lp-agent/runtime-adapters test
pnpm --filter @lp-agent/runtime-adapters typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/model-gateway/src/index.ts packages/runtime-adapters/src/index.ts packages/runtime-adapters/src/index.test.ts
git commit -m "add model retry runtime events"
```

---

### Task 2: API Fallback Metadata Resolution

**Files:**
- Modify: `packages/api/src/index.ts`
- Test: `packages/api/src/services.test.ts`

- [ ] **Step 1: Write failing API fallback metadata tests**

Add this test near existing model route resolution tests in `packages/api/src/services.test.ts`:

```ts
it("resolves safe model fallback metadata without exposing provider secrets", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
  const project = await service.createProject({ name: "Project" });
  const primary = await service.createModelProvider({
    projectId: project.id,
    providerId: "provider_primary",
    name: "Primary",
    provider: "openai",
    secretEnvName: "PRIMARY_API_KEY",
    modelId: "gpt-5.4"
  });
  const fallback = await service.createModelProvider({
    projectId: project.id,
    providerId: "provider_backup",
    name: "Backup",
    provider: "openai",
    secretEnvName: "BACKUP_API_KEY",
    modelId: "gpt-5.4-mini"
  });
  await service.upsertProjectModelRoute({
    projectId: project.id,
    role: "planner",
    providerId: primary.id,
    model: "gpt-5.4"
  });
  const [route] = await repositories.modelRoutingPolicies.listForProject(project.id);
  await repositories.modelRoutingPolicies.save({
    ...route!,
    fallback: {
      providerId: fallback.id,
      model: "gpt-5.4-mini"
    }
  });

  const policy = await service.resolveModelRoutingPolicyForProject(project.id);

  expect(policy.planner.fallback).toEqual({
    provider: "provider_backup",
    providerName: "Backup",
    api: "openai-completions",
    model: "gpt-5.4-mini",
    baseUrlConfigured: false,
    apiKeyEnvConfigured: true
  });
  expect(JSON.stringify(policy)).not.toContain("BACKUP_API_KEY");
  expect(JSON.stringify(policy)).not.toContain("PRIMARY_API_KEY");
});

it("omits invalid model fallback metadata without breaking the primary route", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
  const project = await service.createProject({ name: "Project" });
  const primary = await service.createModelProvider({
    projectId: project.id,
    providerId: "provider_primary",
    name: "Primary",
    provider: "openai",
    secretEnvName: "PRIMARY_API_KEY",
    modelId: "gpt-5.4"
  });
  await service.upsertProjectModelRoute({
    projectId: project.id,
    role: "planner",
    providerId: primary.id,
    model: "gpt-5.4"
  });
  const [route] = await repositories.modelRoutingPolicies.listForProject(project.id);
  await repositories.modelRoutingPolicies.save({
    ...route!,
    fallback: {
      providerId: "missing_provider",
      model: "gpt-5.4-mini"
    }
  });

  const policy = await service.resolveModelRoutingPolicyForProject(project.id);

  expect(policy.planner.provider).toBe("provider_primary");
  expect(policy.planner.fallback).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run packages/api/src/services.test.ts -t "model fallback metadata"
```

Expected: FAIL because `policy.planner.fallback` is undefined.

- [ ] **Step 3: Implement fallback metadata normalization**

In `packages/api/src/index.ts`, add helper near model route helpers:

```ts
function normalizeModelFallbackConfig(
  value: Record<string, unknown> | undefined
): { providerId: string; model: string } | undefined {
  if (!value) {
    return undefined;
  }
  const providerId = typeof value.providerId === "string" ? value.providerId.trim() : "";
  const model = typeof value.model === "string" ? value.model.trim() : "";
  if (!providerId || !model) {
    return undefined;
  }
  return { providerId, model };
}
```

Update `resolveModelRoutingPolicyForProject()` inside the `for (const route of projectRoutes)` loop:

```ts
const fallbackConfig = normalizeModelFallbackConfig(route.fallback);
const fallbackProvider = fallbackConfig
  ? await this.repositories.modelProviders.getById(fallbackConfig.providerId)
  : undefined;
const fallbackMetadata =
  fallbackConfig &&
  fallbackProvider &&
  fallbackProvider.enabled &&
  isProjectModelProviderForProject(fallbackProvider, projectId)
    ? {
        provider: fallbackProvider.id,
        providerName: fallbackProvider.name,
        api: resolveProviderApi(fallbackProvider),
        model: fallbackConfig.model,
        baseUrlConfigured: Boolean(fallbackProvider.config.baseUrl),
        apiKeyEnvConfigured: Boolean(
          fallbackProvider.config.apiKeyEnv ?? fallbackProvider.config.secretEnvName
        )
      }
    : undefined;
```

Add `fallback` to the resolved route:

```ts
resolved[role] = {
  provider: provider.id,
  providerName: provider.name,
  api,
  model: route.model,
  baseUrlConfigured: Boolean(provider.config.baseUrl),
  apiKeyEnvConfigured: Boolean(provider.config.apiKeyEnv ?? provider.config.secretEnvName),
  ...(modelCapabilities ? { modelCapabilities } : {}),
  ...(fallbackMetadata ? { fallback: fallbackMetadata } : {})
};
```

- [ ] **Step 4: Verify API fallback tests pass**

Run:

```bash
pnpm exec vitest run packages/api/src/services.test.ts -t "model fallback metadata"
pnpm --filter @lp-agent/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/index.ts packages/api/src/services.test.ts
git commit -m "resolve model fallback metadata"
```

---

### Task 3: Structured Repair Prompt Helpers

**Files:**
- Modify: `packages/api/src/structured-lp-brief.ts`
- Modify: `packages/api/src/structured-lp-brief.test.ts`
- Modify: `packages/api/src/structured-static-artifacts.ts`
- Modify: `packages/api/src/structured-static-artifacts.test.ts`

- [ ] **Step 1: Write failing repair prompt tests**

In `packages/api/src/structured-lp-brief.test.ts`, import `createStructuredLPBriefRepairPrompt` and add:

```ts
it("creates a safe LP brief repair prompt without raw model output", () => {
  const prompt = createStructuredLPBriefRepairPrompt({
    userPrompt: "Build a landing page for a spring sale.",
    failure: {
      reason: "schema_invalid",
      issueCount: 2,
      firstIssuePath: "sections.0.headline",
      firstIssueCode: "invalid_type"
    }
  });

  expect(prompt).toContain("Repair the previous Planner response");
  expect(prompt).toContain("LPBriefSchema");
  expect(prompt).toContain("schema_invalid");
  expect(prompt).toContain("sections.0.headline");
  expect(prompt).toContain("Build a landing page for a spring sale.");
  expect(prompt).not.toContain("RAW_MODEL_OUTPUT_SECRET");
  expect(prompt).not.toContain("```");
});
```

In `packages/api/src/structured-static-artifacts.test.ts`, import `createStructuredStaticArtifactsRepairPrompt` and add:

```ts
it("creates a safe static artifacts repair prompt without raw artifact output", () => {
  const prompt = createStructuredStaticArtifactsRepairPrompt({
    brief: sampleBrief,
    failure: {
      reason: "policy_violation",
      policyCode: "external_script_blocked",
      issueCount: 1,
      firstIssuePath: "indexHtml",
      firstIssueCode: "custom"
    }
  });

  expect(prompt).toContain("Repair the previous Builder response");
  expect(prompt).toContain("indexHtml");
  expect(prompt).toContain("stylesCss");
  expect(prompt).toContain("scriptJs");
  expect(prompt).toContain("external_script_blocked");
  expect(prompt).toContain(sampleBrief.title);
  expect(prompt).not.toContain("RAW_STATIC_ARTIFACT_SECRET");
  expect(prompt).not.toContain("<script src=\"https://");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run packages/api/src/structured-lp-brief.test.ts packages/api/src/structured-static-artifacts.test.ts
```

Expected: FAIL because repair prompt helpers are not exported.

- [ ] **Step 3: Implement Planner repair prompt helper**

In `packages/api/src/structured-lp-brief.ts`, add:

```ts
export interface StructuredLPBriefRepairPromptInput {
  userPrompt: string;
  failure: {
    reason: LPBriefParseFailureReason;
    issueCount?: number;
    firstIssuePath?: string;
    firstIssueCode?: string;
  };
}

export function createStructuredLPBriefRepairPrompt(
  input: StructuredLPBriefRepairPromptInput
): string {
  return [
    "Repair the previous Planner response for an LP Engineering Team Agent.",
    "Return exactly one JSON object that matches LPBriefSchema.",
    "Do not wrap the JSON in Markdown fences.",
    "Do not include prose before or after the JSON.",
    "Do not copy invalid formatting from the previous response.",
    "",
    "Failure summary:",
    `- reason: ${input.failure.reason}`,
    ...(input.failure.issueCount !== undefined
      ? [`- issueCount: ${input.failure.issueCount}`]
      : []),
    ...(input.failure.firstIssuePath
      ? [`- firstIssuePath: ${input.failure.firstIssuePath}`]
      : []),
    ...(input.failure.firstIssueCode
      ? [`- firstIssueCode: ${input.failure.firstIssueCode}`]
      : []),
    "",
    "LPBriefSchema compact guide:",
    "- title: non-empty string",
    "- objective: non-empty string",
    "- audience: non-empty string",
    "- offer: non-empty string",
    "- brandProfile: { name, tone, colors: string[], typography }",
    "- tone: non-empty string",
    "- constraints: string[]",
    "- sections: non-empty array of { id, type, purpose, headline, body, media, cta, layoutHints, validationRules }",
    "- assets: array of { id, type, label, url, alt? }",
    "- productData: array of { id, name, description, price?, imageUrl? }",
    "- seo: { title, description, socialImage? }",
    "- tracking: { analyticsId?, events: string[] }",
    "- complianceNotes: string[]",
    "",
    "Original user request:",
    input.userPrompt
  ].join("\n");
}
```

- [ ] **Step 4: Implement Builder repair prompt helper**

In `packages/api/src/structured-static-artifacts.ts`, add:

```ts
export interface StructuredStaticArtifactsRepairPromptInput {
  brief: LPBrief;
  failure: {
    reason: StaticArtifactParseFailureReason;
    policyCode?: string;
    issueCount?: number;
    firstIssuePath?: string;
    firstIssueCode?: string;
  };
}

export function createStructuredStaticArtifactsRepairPrompt(
  input: StructuredStaticArtifactsRepairPromptInput
): string {
  return [
    "Repair the previous Builder response for an LP Engineering Team Agent.",
    "Return exactly one JSON object with exactly these three non-empty string keys: indexHtml, stylesCss, scriptJs.",
    "Do not include any other keys.",
    "Do not wrap the JSON in Markdown fences.",
    "Do not include prose before or after the JSON.",
    "Build Framework-free static HTML/CSS/JS only.",
    "External JavaScript, javascript: URLs, inline event handler attributes, and CSS frameworks are forbidden.",
    "",
    "Failure summary:",
    `- reason: ${input.failure.reason}`,
    ...(input.failure.policyCode ? [`- policyCode: ${input.failure.policyCode}`] : []),
    ...(input.failure.issueCount !== undefined
      ? [`- issueCount: ${input.failure.issueCount}`]
      : []),
    ...(input.failure.firstIssuePath
      ? [`- firstIssuePath: ${input.failure.firstIssuePath}`]
      : []),
    ...(input.failure.firstIssueCode
      ? [`- firstIssueCode: ${input.failure.firstIssueCode}`]
      : []),
    "",
    "LPBrief JSON:",
    JSON.stringify(input.brief)
  ].join("\n");
}
```

- [ ] **Step 5: Verify repair prompt tests pass**

Run:

```bash
pnpm exec vitest run packages/api/src/structured-lp-brief.test.ts packages/api/src/structured-static-artifacts.test.ts
pnpm --filter @lp-agent/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/structured-lp-brief.ts packages/api/src/structured-lp-brief.test.ts packages/api/src/structured-static-artifacts.ts packages/api/src/structured-static-artifacts.test.ts
git commit -m "add structured model repair prompts"
```

---

### Task 4: Planner One-Shot Repair Flow

**Files:**
- Modify: `packages/api/src/index.ts`
- Test: `packages/api/src/services.test.ts`

- [ ] **Step 1: Write failing Planner repair success test**

Add near the existing Planner parse failure tests in `packages/api/src/services.test.ts`:

```ts
it("repairs invalid Planner structured output once before saving the brief", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const repairedBrief = {
    ...sampleBrief,
    title: "Repaired Planner Brief"
  };
  const responses = [
    {
      id: "chatcmpl_bad_planner",
      model: "glm-5.1",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "{\"title\":\"RAW_MODEL_OUTPUT_SECRET\"}" },
          finish_reason: "stop"
        }
      ],
      usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 }
    },
    {
      id: "chatcmpl_repaired_planner",
      model: "glm-5.1",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: JSON.stringify(repairedBrief) },
          finish_reason: "stop"
        }
      ],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
    }
  ];
  const fetchCalls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  const fakeFetch: ModelFetch = async (input, init) => {
    fetchCalls.push({ input, init });
    const response = responses.shift();
    if (!response) {
      throw new Error("unexpected_fetch_call");
    }
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
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

  expect(brief.brief.title).toBe("Repaired Planner Brief");
  expect(fetchCalls).toHaveLength(2);
  const repairRequestBody = JSON.parse(String(fetchCalls[1]?.init?.body));
  expect(repairRequestBody.messages[0].content).toContain("Repair the previous Planner response");
  expect(repairRequestBody.messages[0].content).toContain("LPBriefSchema");
  expect(repairRequestBody.messages[0].content).not.toContain("RAW_MODEL_OUTPUT_SECRET");
  const events = await repositories.runEvents.listForRun("run_planner_brief_1");
  expect(events.map((event) => event.type)).toEqual([
    "run.started",
    "runtime.context.loaded",
    "model.completed",
    "model.output.parse_failed",
    "model.output.repair_started",
    "model.completed",
    "model.output.repaired",
    "run.completed",
    "handoff.created"
  ]);
  expect(JSON.stringify(events)).not.toContain("RAW_MODEL_OUTPUT_SECRET");
  expect(JSON.stringify(events)).not.toContain("sk-test-secret");
  expect(JSON.stringify(events)).not.toContain("OPENAI_COMPATIBLE_API_KEY");
  expect(JSON.stringify(events)).not.toContain("https://open.bigmodel.cn");
});
```

- [ ] **Step 2: Write failing Planner repair failure test**

Add:

```ts
it("fails Planner run when one-shot repair still cannot parse", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const responses = [
    "```json\n{\"title\":\"RAW_MODEL_OUTPUT_SECRET\"}\n```",
    "{\"title\":\"REPAIR_RAW_MODEL_OUTPUT_SECRET\"}"
  ];
  const fakeFetch: ModelFetch = async () => {
    const content = responses.shift();
    if (!content) {
      throw new Error("unexpected_fetch_call");
    }
    return new Response(
      JSON.stringify({
        id: "chatcmpl_planner",
        model: "glm-5.1",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
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

  await expect(
    service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Generate a landing page brief."
    })
  ).rejects.toThrow("Planner run failed.");

  await expect(repositories.briefs.listAll()).resolves.toEqual([]);
  const events = await repositories.runEvents.listForRun("run_planner_brief_1");
  expect(events.map((event) => event.type)).toEqual([
    "run.started",
    "runtime.context.loaded",
    "model.completed",
    "model.output.parse_failed",
    "model.output.repair_started",
    "model.completed",
    "model.output.repair_failed",
    "run.failed"
  ]);
  expect(JSON.stringify(events)).not.toContain("RAW_MODEL_OUTPUT_SECRET");
  expect(JSON.stringify(events)).not.toContain("REPAIR_RAW_MODEL_OUTPUT_SECRET");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run packages/api/src/services.test.ts -t "Planner"
```

Expected: FAIL because repair events and repair runtime call are not implemented.

- [ ] **Step 4: Implement Planner repair finalizer**

In `packages/api/src/index.ts`, import `createStructuredLPBriefRepairPrompt`.

Add helper:

```ts
async function repairPlannerResult(input: {
  runtime: AgentRuntimeAdapter;
  result: RuntimeRunResult;
  contextPack: ContextPack;
  projectId: string;
  prompt: string;
  error: PlannerLPBriefParseError;
}): Promise<RuntimeRunResult> {
  const repairPrompt = createStructuredLPBriefRepairPrompt({
    userPrompt: input.prompt,
    failure: {
      reason: input.error.reason,
      ...input.error.issueSummary
    }
  });
  const repairStarted = toPlannerRepairStartedEvent({
    result: input.result,
    error: input.error
  });
  const parseFailedEvent = failPlannerResultForParseError({
    result: input.result,
    error: input.error
  }).events.find((event) => event.type === "model.output.parse_failed");
  if (!parseFailedEvent) {
    throw new Error("planner_parse_failure_event_missing");
  }
  const repairResult = await input.runtime.run({
    runId: input.result.runId,
    projectId: input.projectId,
    role: "planner",
    input: { prompt: repairPrompt },
    context: input.contextPack.runtimeContext
  });
  const repairModelEvents = repairResult.events.filter((event) => event.type === "model.completed");
  try {
    const repairedBrief = parsePlannerLPBriefOutput(repairResult.modelOutputText ?? "");
    return {
      ...input.result,
      modelOutputText: repairResult.modelOutputText,
      events: [
        ...input.result.events.filter((event) => event.type !== "run.completed"),
        parseFailedEvent,
        repairStarted,
        ...repairModelEvents,
        toPlannerRepairSuccessEvent({
          result: input.result,
          brief: repairedBrief
        }),
        {
          type: "run.completed",
          message: "planner run completed",
          runId: input.result.runId,
          state: "completed"
        }
      ]
    };
  } catch (error) {
    if (error instanceof PlannerLPBriefParseError) {
      return failPlannerResultForRepairError({
        result: input.result,
        parseFailedEvent,
        repairStarted,
        repairModelEvents,
        error
      });
    }
    throw error;
  }
}
```

Use the helper in the Planner `finalizeResult` catch block. Assign `parsedPlannerBrief` from the repaired output before returning success. Keep the existing no-repair failure path only for repair failure.

Add event helpers modeled after `toPlannerParseSuccessEvent()` and `failPlannerResultForParseError()`:

```ts
function toPlannerRepairStartedEvent(input: {
  result: RuntimeRunResult;
  error: PlannerLPBriefParseError;
}): RuntimeEvent {
  return {
    type: "model.output.repair_started",
    message: "Planner output repair started",
    runId: input.result.runId,
    role: "planner",
    schema: "LPBriefSchema",
    reason: input.error.reason,
    ...input.error.issueSummary
  };
}

function toPlannerRepairSuccessEvent(input: {
  result: RuntimeRunResult;
  brief: LPBrief;
}): RuntimeEvent {
  return {
    ...toLPBriefParseSuccessPayload(input.brief),
    type: "model.output.repaired",
    message: "Planner output repaired as LP brief",
    runId: input.result.runId,
    role: "planner",
    schema: "LPBriefSchema",
    title: input.brief.title,
    sectionCount: input.brief.sections.length,
    productCount: input.brief.productData.length,
    hasAssets: input.brief.assets.length > 0
  };
}
```

`failPlannerResultForRepairError()` should mirror `failPlannerResultForParseError()` but use `model.output.repair_failed` and include events in this order: original non-terminal runtime events, `parseFailedEvent`, `repairStarted`, repair `model.completed`, `model.output.repair_failed`, `run.failed`.

- [ ] **Step 5: Verify Planner repair tests pass**

Run:

```bash
pnpm exec vitest run packages/api/src/services.test.ts -t "Planner"
pnpm --filter @lp-agent/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/index.ts packages/api/src/services.test.ts
git commit -m "add planner structured repair"
```

---

### Task 5: Builder One-Shot Repair Flow

**Files:**
- Modify: `packages/api/src/index.ts`
- Test: `packages/api/src/services.test.ts`

- [ ] **Step 1: Write failing Builder repair success test**

Add near existing Builder parse / policy tests:

```ts
it("repairs invalid Builder static artifacts once before saving the page version", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const modelBrief = {
    ...sampleBrief,
    title: "Model Planned Landing Page"
  };
  const repairedArtifacts = completeModelArtifacts();
  const responseQueue = [
    JSON.stringify({
      id: "chatcmpl_planner",
      model: "glm-5.1",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: JSON.stringify(modelBrief) },
          finish_reason: "stop"
        }
      ],
      usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 }
    }),
    JSON.stringify({
      id: "chatcmpl_builder_bad",
      model: "glm-5.1",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: JSON.stringify({
              ...repairedArtifacts,
              indexHtml: repairedArtifacts.indexHtml.replace(
                "  <script src=\"script.js\"></script>",
                "  <script src=\"https://cdn.example.com/RAW_STATIC_ARTIFACT_SECRET.js\"></script>\n  <script src=\"script.js\"></script>"
              )
            })
          },
          finish_reason: "stop"
        }
      ],
      usage: { prompt_tokens: 20, completion_tokens: 80, total_tokens: 100 }
    }),
    JSON.stringify({
      id: "chatcmpl_builder_repaired",
      model: "glm-5.1",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: JSON.stringify(repairedArtifacts) },
          finish_reason: "stop"
        }
      ],
      usage: { prompt_tokens: 22, completion_tokens: 90, total_tokens: 112 }
    })
  ];
  const fetchCalls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  const fakeFetch: ModelFetch = async (input, init) => {
    fetchCalls.push({ input, init });
    const body = responseQueue.shift();
    if (!body) {
      throw new Error("unexpected_fetch_call");
    }
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" }
    });
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
  await service.upsertProjectModelRoute({
    projectId: project.id,
    role: "builder",
    providerId: provider.id,
    model: "glm-5.1"
  });

  const brief = await service.createBriefFromPrompt({
    projectId: project.id,
    prompt: "Generate a landing page brief."
  });
  const pageVersion = await service.generatePageVersion({
    projectId: project.id,
    briefId: brief.id
  });

  expect(pageVersion.artifacts).toEqual(repairedArtifacts);
  expect(fetchCalls).toHaveLength(3);
  const repairRequestBody = JSON.parse(String(fetchCalls[2]?.init?.body));
  expect(repairRequestBody.messages[0].content).toContain("Repair the previous Builder response");
  expect(repairRequestBody.messages[0].content).toContain("external_script_blocked");
  expect(repairRequestBody.messages[0].content).not.toContain("RAW_STATIC_ARTIFACT_SECRET");
  const builderEvents = await repositories.runEvents.listForRun("run_builder_version_1");
  expect(builderEvents.map((event) => event.type)).toEqual([
    "handoff.consumed",
    "run.started",
    "runtime.context.loaded",
    "model.completed",
    "artifact.created",
    "model.output.parse_failed",
    "model.output.repair_started",
    "model.completed",
    "model.output.repaired",
    "run.completed",
    "artifact.workspace.created",
    "handoff.created"
  ]);
  expect(JSON.stringify(builderEvents)).not.toContain("RAW_STATIC_ARTIFACT_SECRET");
  expect(JSON.stringify(builderEvents)).not.toContain(repairedArtifacts.indexHtml);
  expect(JSON.stringify(builderEvents)).not.toContain("sk-test-secret");
});
```

- [ ] **Step 2: Write failing Builder repair failure test**

Add:

```ts
it("fails Builder run when one-shot repair still violates artifact policy", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const modelBrief = {
    ...sampleBrief,
    title: "Model Planned Landing Page"
  };
  const unsafeArtifacts = {
    ...completeModelArtifacts(),
    indexHtml: completeModelArtifacts().indexHtml.replace(
      "  <script src=\"script.js\"></script>",
      "  <script src=\"https://cdn.example.com/REPAIR_RAW_STATIC_ARTIFACT_SECRET.js\"></script>\n  <script src=\"script.js\"></script>"
    )
  };
  const responseQueue = [
    JSON.stringify({
      id: "chatcmpl_planner",
      model: "glm-5.1",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: JSON.stringify(modelBrief) },
          finish_reason: "stop"
        }
      ],
      usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 }
    }),
    JSON.stringify({
      id: "chatcmpl_builder_bad",
      model: "glm-5.1",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: JSON.stringify(unsafeArtifacts) },
          finish_reason: "stop"
        }
      ],
      usage: { prompt_tokens: 20, completion_tokens: 80, total_tokens: 100 }
    }),
    JSON.stringify({
      id: "chatcmpl_builder_repair_bad",
      model: "glm-5.1",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: JSON.stringify(unsafeArtifacts) },
          finish_reason: "stop"
        }
      ],
      usage: { prompt_tokens: 22, completion_tokens: 90, total_tokens: 112 }
    })
  ];
  const fakeFetch: ModelFetch = async () => {
    const body = responseQueue.shift();
    if (!body) {
      throw new Error("unexpected_fetch_call");
    }
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" }
    });
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
  await service.upsertProjectModelRoute({
    projectId: project.id,
    role: "builder",
    providerId: provider.id,
    model: "glm-5.1"
  });

  const brief = await service.createBriefFromPrompt({
    projectId: project.id,
    prompt: "Generate a landing page brief."
  });
  await expect(
    service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    })
  ).rejects.toThrow("Builder run failed.");

  await expect(repositories.pageVersions.listAll()).resolves.toEqual([]);
  await expect(repositories.artifactWorkspaces.listAll()).resolves.toEqual([]);
  const builderEvents = await repositories.runEvents.listForRun("run_builder_version_1");
  expect(builderEvents.map((event) => event.type)).toEqual([
    "handoff.consumed",
    "run.started",
    "runtime.context.loaded",
    "model.completed",
    "artifact.created",
    "model.output.parse_failed",
    "model.output.repair_started",
    "model.completed",
    "model.output.repair_failed",
    "run.failed"
  ]);
  expect(JSON.stringify(builderEvents)).not.toContain("REPAIR_RAW_STATIC_ARTIFACT_SECRET");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run packages/api/src/services.test.ts -t "Builder"
```

Expected: FAIL because Builder repair is not implemented.

- [ ] **Step 4: Implement Builder repair finalizer**

In `packages/api/src/index.ts`, import `createStructuredStaticArtifactsRepairPrompt`.

Add helper modeled after Planner repair:

```ts
async function repairBuilderResult(input: {
  runtime: AgentRuntimeAdapter;
  result: RuntimeRunResult;
  contextPack: ContextPack;
  projectId: string;
  brief: LPBrief;
  error: BuilderStaticArtifactParseError;
}): Promise<{ result: RuntimeRunResult; artifacts?: StaticArtifacts }> {
  const repairPrompt = createStructuredStaticArtifactsRepairPrompt({
    brief: input.brief,
    failure: {
      reason: input.error.reason,
      policyCode: input.error.policyCode,
      ...input.error.issueSummary
    }
  });
  const repairStarted = toBuilderRepairStartedEvent({
    result: input.result,
    error: input.error
  });
  const parseFailedEvent = failBuilderResultForParseError({
    result: input.result,
    error: input.error
  }).events.find((event) => event.type === "model.output.parse_failed");
  if (!parseFailedEvent) {
    throw new Error("builder_parse_failure_event_missing");
  }
  const repairResult = await input.runtime.run({
    runId: input.result.runId,
    projectId: input.projectId,
    role: "builder",
    input: {
      brief: input.brief,
      prompt: repairPrompt
    },
    context: input.contextPack.runtimeContext
  });
  const repairModelEvents = repairResult.events.filter((event) => event.type === "model.completed");
  try {
    const repairedArtifacts = parseBuilderStaticArtifactsOutput(
      repairResult.modelOutputText ?? ""
    );
    return {
      artifacts: repairedArtifacts,
      result: {
        ...input.result,
        artifacts: repairedArtifacts,
        modelOutputText: repairResult.modelOutputText,
        events: [
          ...input.result.events.filter((event) => event.type !== "run.completed"),
          parseFailedEvent,
          repairStarted,
          ...repairModelEvents,
          toBuilderRepairSuccessEvent({
            result: input.result,
            artifacts: repairedArtifacts
          }),
          {
            type: "run.completed",
            message: "builder run completed",
            runId: input.result.runId,
            state: "completed"
          }
        ]
      }
    };
  } catch (error) {
    if (error instanceof BuilderStaticArtifactParseError) {
      return {
        result: failBuilderResultForRepairError({
          result: input.result,
          parseFailedEvent,
          repairStarted,
          repairModelEvents,
          error
        })
      };
    }
    throw error;
  }
}
```

Use it in the Builder `finalizeResult` catch block. Set `parsedBuilderArtifacts` from the returned `artifacts` when repair succeeds.

Add `toBuilderRepairStartedEvent()`, `toBuilderRepairSuccessEvent()`, and `failBuilderResultForRepairError()` next to existing Builder parse event helpers. `model.output.repair_failed` payload must mirror `toStaticArtifactParseFailurePayload()` and must not include raw artifact text. `failBuilderResultForRepairError()` must preserve original safe non-terminal runtime events, including the existing `artifact.created`, then append `parseFailedEvent`, `repairStarted`, repair `model.completed`, `model.output.repair_failed`, and `run.failed`.

- [ ] **Step 5: Verify Builder repair tests pass**

Run:

```bash
pnpm exec vitest run packages/api/src/services.test.ts -t "Builder"
pnpm --filter @lp-agent/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/index.ts packages/api/src/services.test.ts
git commit -m "add builder structured repair"
```

---

### Task 6: Lifecycle Diagnostics, Documentation, and Final Verification

**Files:**
- Modify: `packages/api/src/run-lifecycle.test.ts`
- Modify: `packages/api/src/run-lifecycle.ts`
- Modify: `docs/project-roadmap.md`
- Modify: `docs/agent-development-learning.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Write failing lifecycle tests**

Add to `packages/api/src/run-lifecycle.test.ts`:

```ts
it("treats repaired model output as completed while keeping parse failure history", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  await saveRun(repositories, {
    state: "completed",
    completedAt: "2026-05-19T00:00:05.000Z"
  });
  await saveEvent(repositories, { type: "run.started", sequence: 1 });
  await saveEvent(repositories, {
    type: "model.output.parse_failed",
    sequence: 2,
    payload: {
      role: "planner",
      schema: "LPBriefSchema",
      reason: "invalid_json"
    }
  });
  await saveEvent(repositories, {
    type: "model.output.repair_started",
    sequence: 3,
    payload: {
      role: "planner",
      schema: "LPBriefSchema",
      reason: "invalid_json"
    }
  });
  await saveEvent(repositories, {
    type: "model.output.repaired",
    sequence: 4,
    payload: {
      role: "planner",
      schema: "LPBriefSchema",
      title: "Repaired",
      sectionCount: 3,
      productCount: 0,
      hasAssets: false
    }
  });
  await saveEvent(repositories, {
    type: "run.completed",
    sequence: 5,
    payload: { state: "completed" }
  });

  const result = await deriveRunLifecycleView({
    repositories,
    runId: "run_planner_1"
  });

  expect(result).toMatchObject({
    ok: true,
    view: {
      state: "completed",
      recoveryActions: []
    }
  });
  if (result.ok) {
    expect(result.view.diagnosticSummary).toBeUndefined();
  }
});

it("uses fallback availability as a recovery hint without marking the run successful", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  await saveRun(repositories, {
    state: "failed",
    completedAt: "2026-05-19T00:00:05.000Z"
  });
  await saveEvent(repositories, { type: "run.started", sequence: 1 });
  await saveEvent(repositories, {
    type: "model.retry.exhausted",
    sequence: 2,
    payload: {
      errorCode: "model_provider_http_error",
      status: 503,
      attempts: 2
    }
  });
  await saveEvent(repositories, {
    type: "model.fallback.available",
    sequence: 3,
    payload: {
      provider: "provider_backup",
      model: "gpt-5.4-mini",
      baseUrlConfigured: true,
      apiKeyEnvConfigured: true
    }
  });
  await saveEvent(repositories, {
    type: "run.failed",
    sequence: 4,
    payload: { state: "failed", errorName: "ModelProviderRequestError" }
  });

  const result = await deriveRunLifecycleView({
    repositories,
    runId: "run_planner_1"
  });

  expect(result).toMatchObject({
    ok: true,
    view: {
      state: "failed",
      recoveryActions: ["retry_run"]
    }
  });
  expect(JSON.stringify(result)).not.toContain("OPENAI_API_KEY");
});
```

- [ ] **Step 2: Run lifecycle tests to verify they fail or expose gaps**

Run:

```bash
pnpm exec vitest run packages/api/src/run-lifecycle.test.ts
```

Expected: FAIL only if lifecycle does not yet understand the new events. If both tests already pass because lifecycle keys off final `RunRecord.state`, keep them as regression coverage and continue.

- [ ] **Step 3: Update lifecycle diagnostic handling if needed**

If lifecycle currently reports `model.output.parse_failed` as a diagnostic even for completed runs, change `packages/api/src/run-lifecycle.ts` so parse failure diagnostics are terminal only when the run is failed and there is no later `model.output.repaired`.

Add a small helper:

```ts
function hasModelRepairSuccess(events: RunEventRecord[]): boolean {
  return events.some((event) => event.type === "model.output.repaired");
}
```

Use it where model parse diagnostics are selected:

```ts
if (run.state === "failed" && !hasModelRepairSuccess(events)) {
  // existing parse failure diagnostic selection
}
```

- [ ] **Step 4: Update docs for implementation completion**

Update `docs/project-roadmap.md` after implementation passes:

- Move Stage 21 to completed stage records.
- Change current status snapshot to mention model repair / retry / fallback metadata v0.
- Move Stage 22 to recommended next stage.
- Keep true fallback execution, streaming, tool-call conversion and provider marketplace in backlog.

Update `docs/agent-development-learning.md`:

- Change Stage 21 from design-only to implemented.
- Add implementation notes:
  - repair stays API-owned;
  - retry stays runtime-adapter-owned;
  - fallback v0 is metadata only;
  - raw model output remains transient.

Update `docs/superpowers/README.md`:

- Add this plan entry immediately after Stage 21 design:

```md
71. `plans/2026-05-19-model-repair-retry-fallback.md`
   - Stage 21 Model Repair、Retry 和 Fallback v0 implementation plan。
   - 在 Stage 21 design 后阅读，用于按 TDD 实现 runtime provider retry、fallback metadata resolution、Planner/Builder one-shot repair、lifecycle diagnostics 和文档收尾。
```

- [ ] **Step 5: Run focused verification**

Run:

```bash
pnpm --filter @lp-agent/runtime-adapters test
pnpm exec vitest run packages/api/src/structured-lp-brief.test.ts packages/api/src/structured-static-artifacts.test.ts packages/api/src/services.test.ts packages/api/src/run-lifecycle.test.ts
pnpm --filter @lp-agent/runtime-adapters typecheck
pnpm --filter @lp-agent/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected:

- `pnpm test`: all deterministic tests pass, integration tests remain skipped unless env opts in.
- `pnpm typecheck`: all workspace type checks pass.
- `pnpm build`: Next.js build passes.
- `git diff --check`: no whitespace errors.

- [ ] **Step 7: Commit docs and final lifecycle changes**

```bash
git add packages/api/src/run-lifecycle.ts packages/api/src/run-lifecycle.test.ts docs/project-roadmap.md docs/agent-development-learning.md docs/superpowers/README.md
git commit -m "document model repair retry fallback completion"
```

If `run-lifecycle.ts` did not need changes, omit it from `git add`.

---

## Final Review Checklist

- [ ] Planner repair is one-shot.
- [ ] Builder repair is one-shot.
- [ ] Repair prompts do not include raw model output.
- [ ] Provider retry budget is fixed and bounded.
- [ ] Non-retryable provider errors are not retried.
- [ ] Fallback provider is never called automatically.
- [ ] All new events are safe summaries only.
- [ ] No raw model output, raw repair output, base URL, API key env name, secret, local path, or artifact content appears in run events.
- [ ] Deterministic runtime without `REAL_MODEL_RUNTIME=1` behaves as before.
- [ ] `docs/superpowers/README.md`, `docs/project-roadmap.md`, and `docs/agent-development-learning.md` are updated in the same branch.
