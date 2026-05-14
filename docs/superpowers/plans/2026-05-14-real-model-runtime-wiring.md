# Real Model Runtime Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `ProviderBackedModelGateway` into the Web/API/runtime path behind `REAL_MODEL_RUNTIME=1`, while preserving deterministic mock behavior by default.

**Architecture:** Keep `packages/runtime-adapters` provider-agnostic and make `packages/api` own runtime adapter construction because it already owns repository access. The service factory chooses either `InMemoryModelGateway` or `ProviderBackedModelGateway`; the provider-backed path resolves project provider config from repositories and passes only env access plus an optional test fetch implementation into the model gateway. Runtime events remain sanitized and LP artifacts remain deterministic static HTML/CSS/JS.

**Tech Stack:** pnpm TypeScript monorepo, Vitest, existing `@lp-agent/api`, `@lp-agent/db`, `@lp-agent/model-gateway`, and `@lp-agent/runtime-adapters`; no new dependencies.

---

## File Structure

- Modify `packages/api/src/services.test.ts`
  - Adds API-level tests for the runtime switch, repository-backed provider resolution, sanitized `model.completed` events, explicit real-runtime failures, and `REAL_MODEL_PROVIDER_TEST` isolation.
- Modify `packages/api/src/index.ts`
  - Adds `RuntimeEnvironment` service option and optional `modelFetch` test seam.
  - Replaces fixed local runtime construction with a small API-owned factory.
  - Adds a repository-backed `ModelProviderRuntimeResolver`.
- Modify `.env.example`
  - Documents `REAL_MODEL_RUNTIME=0` as the default Web/API/runtime setting.
- Modify `docs/agent-development-learning.md`
  - Adds the implementation-plan link and clarifies the first runtime wiring learning point.
- Modify `docs/superpowers/README.md`
  - Adds this plan to the Superpowers reading order.

Do not edit `.env.local` in this plan. It is ignored and may contain a real user key.

---

## Task 1: Add Failing API Runtime Wiring Tests

**Files:**
- Modify: `packages/api/src/services.test.ts`

- [ ] **Step 1: Add the model gateway test type import**

In `packages/api/src/services.test.ts`, add this import after the `@lp-agent/lp-schema` import:

```ts
import type { ModelFetch } from "@lp-agent/model-gateway";
```

- [ ] **Step 2: Add the provider-backed success and default-mode isolation tests**

Insert the following tests in `packages/api/src/services.test.ts` after the existing test named `"resolves model routes with sanitized provider metadata"`:

```ts
  it("uses provider-backed runtime when REAL_MODEL_RUNTIME is enabled", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const fetchCalls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fakeFetch: ModelFetch = async (input, init) => {
      fetchCalls.push({ input, init });
      return new Response(
        JSON.stringify({
          type: "message",
          model: "glm-5.1",
          content: [{ type: "text", text: "planner response" }],
          usage: { input_tokens: 9, output_tokens: 4 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };
    const service = new DemoWorkbenchService({
      repositories,
      now: fixedClock(),
      env: {
        REAL_MODEL_RUNTIME: "1",
        ANTHROPIC_API_KEY: "sk-test-secret"
      },
      modelFetch: fakeFetch
    });
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
      "https://open.bigmodel.cn/api/anthropic/v1/messages"
    );
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toEqual({
      model: "glm-5.1",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Generate a landing page brief." }]
    });

    const events = await repositories.runEvents.listForProject(project.id);
    const modelEvent = events.find((event) => event.type === "model.completed");
    expect(modelEvent).toMatchObject({
      runId: "run_planner_brief_1",
      type: "model.completed",
      message: "planner model call completed",
      payload: expect.objectContaining({
        provider: "zhipu",
        providerName: "智谱 GLM",
        api: "anthropic-messages",
        model: "glm-5.1",
        baseUrlConfigured: true,
        apiKeyEnvConfigured: true,
        role: "planner"
      })
    });
    expect(JSON.stringify(events)).not.toContain("sk-test-secret");
    expect(JSON.stringify(events)).not.toContain("ANTHROPIC_API_KEY");
    expect(JSON.stringify(events)).not.toContain("https://open.bigmodel.cn");
  });

  it("keeps deterministic runtime unless REAL_MODEL_RUNTIME is explicitly enabled", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    let fetchCallCount = 0;
    const fakeFetch: ModelFetch = async () => {
      fetchCallCount += 1;
      throw new Error("fetch_should_not_be_called");
    };
    const service = new DemoWorkbenchService({
      repositories,
      now: fixedClock(),
      env: {
        REAL_MODEL_PROVIDER_TEST: "1",
        ANTHROPIC_API_KEY: "sk-test-secret"
      },
      modelFetch: fakeFetch
    });
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
      role: "planner",
      providerId: provider.id,
      model: "glm-5.1"
    });

    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Generate a landing page brief."
    });

    expect(brief.id).toBe("brief_1");
    expect(fetchCallCount).toBe(0);
    const events = await repositories.runEvents.listForProject(project.id);
    expect(events.some((event) => event.type === "run.completed")).toBe(true);
  });
```

- [ ] **Step 3: Add the provider-backed failure test**

Insert this test immediately after the two tests from Step 2:

```ts
  it("records failed runs when real runtime provider secrets are missing", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    let fetchCallCount = 0;
    const fakeFetch: ModelFetch = async () => {
      fetchCallCount += 1;
      throw new Error("fetch_should_not_be_called");
    };
    const service = new DemoWorkbenchService({
      repositories,
      now: fixedClock(),
      env: {
        REAL_MODEL_RUNTIME: "1"
      },
      modelFetch: fakeFetch
    });
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

    expect(fetchCallCount).toBe(0);
    await expect(repositories.runs.listForProject(project.id)).resolves.toEqual([
      expect.objectContaining({
        id: "run_planner_brief_1",
        projectId: project.id,
        role: "planner",
        state: "failed",
        completedAt: expect.any(String)
      })
    ]);
    const events = await repositories.runEvents.listForProject(project.id);
    const failedEvent = events.find((event) => event.type === "run.failed");
    expect(failedEvent).toMatchObject({
      runId: "run_planner_brief_1",
      projectId: project.id,
      type: "run.failed",
      message: "Environment variable for provider zhipu is not configured",
      payload: expect.objectContaining({
        role: "planner",
        state: "failed",
        errorName: "ModelProviderConfigurationError"
      })
    });
    expect(JSON.stringify(events)).not.toContain("sk-test-secret");
    expect(JSON.stringify(events)).not.toContain("ANTHROPIC_API_KEY");
    expect(JSON.stringify(events)).not.toContain("https://open.bigmodel.cn");
  });
```

- [ ] **Step 4: Run the targeted API test and verify it fails for missing service options**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: TypeScript/Vitest fails because `DemoWorkbenchServiceOptions` does not yet accept `env` or `modelFetch`, and because the API service still constructs `InMemoryModelGateway` unconditionally.

---

## Task 2: Implement the API Runtime Adapter Factory

**Files:**
- Modify: `packages/api/src/index.ts`
- Modify: `.env.example`
- Test: `packages/api/src/services.test.ts`

- [ ] **Step 1: Update model-gateway imports**

In `packages/api/src/index.ts`, replace the current `@lp-agent/model-gateway` import with:

```ts
import {
  InMemoryModelGateway,
  ProviderBackedModelGateway,
  agentRoles,
  createDefaultModelPolicy,
  type AgentRole,
  type ModelFetch,
  type ModelProviderApi,
  type ModelProviderRuntimeConfig,
  type ModelProviderRuntimeRecord,
  type ModelProviderRuntimeResolver,
  type ModelRoute,
  type ModelRoutingPolicy
} from "@lp-agent/model-gateway";
```

- [ ] **Step 2: Add runtime environment options**

In `packages/api/src/index.ts`, add this exported type near the other public service types, before `export interface DemoWorkbenchServiceOptions`:

```ts
export type RuntimeEnvironment = Record<string, string | undefined>;
```

Then update `DemoWorkbenchServiceOptions` to:

```ts
export interface DemoWorkbenchServiceOptions {
  repositories?: WorkbenchRepositories;
  plannerRuntime?: AgentRuntimeAdapter;
  builderRuntime?: AgentRuntimeAdapter;
  reviewerRuntime?: AgentRuntimeAdapter;
  deployerRuntime?: AgentRuntimeAdapter;
  deploymentAdapter?: GitDeploymentAdapter;
  env?: RuntimeEnvironment;
  modelFetch?: ModelFetch;
  now?: () => Date;
}
```

- [ ] **Step 3: Pass repositories, env, and optional fetch into default runtime construction**

In the `DemoWorkbenchService` constructor, replace the four existing `createLocalRuntimeAdapter()` calls with this block:

```ts
    const runtimeFactoryInput = {
      repositories: this.repositories,
      env: options.env,
      fetch: options.modelFetch
    };
    this.plannerRuntime = options.plannerRuntime ?? createLocalRuntimeAdapter(runtimeFactoryInput);
    this.builderRuntime = options.builderRuntime ?? createLocalRuntimeAdapter(runtimeFactoryInput);
    this.reviewerRuntime = options.reviewerRuntime ?? createLocalRuntimeAdapter(runtimeFactoryInput);
    this.deployerRuntime = options.deployerRuntime ?? createLocalRuntimeAdapter(runtimeFactoryInput);
```

Keep explicit `plannerRuntime`, `builderRuntime`, `reviewerRuntime`, and `deployerRuntime` overrides higher priority than the factory.

- [ ] **Step 4: Replace the local runtime helper with the provider-aware factory**

In `packages/api/src/index.ts`, replace the existing helper:

```ts
function createLocalRuntimeAdapter(): LocalAgentRuntimeAdapter {
  return new LocalAgentRuntimeAdapter(new InMemoryModelGateway(createDefaultModelPolicy()));
}
```

with:

```ts
interface LocalRuntimeAdapterFactoryInput {
  repositories: WorkbenchRepositories;
  env?: RuntimeEnvironment;
  fetch?: ModelFetch;
}

function createLocalRuntimeAdapter(
  input?: LocalRuntimeAdapterFactoryInput
): LocalAgentRuntimeAdapter {
  const policy = createDefaultModelPolicy();
  const env = input?.env ?? getProcessEnv();

  if (env.REAL_MODEL_RUNTIME === "1" && input) {
    return new LocalAgentRuntimeAdapter(
      new ProviderBackedModelGateway({
        policy,
        providers: createRepositoryModelProviderResolver(input.repositories),
        ...(input.fetch ? { fetch: input.fetch } : {}),
        env
      })
    );
  }

  return new LocalAgentRuntimeAdapter(new InMemoryModelGateway(policy));
}

function createRepositoryModelProviderResolver(
  repositories: WorkbenchRepositories
): ModelProviderRuntimeResolver {
  return {
    async getProvider(providerId: string): Promise<ModelProviderRuntimeRecord | undefined> {
      const provider = await repositories.modelProviders.getById(providerId);
      if (!provider) {
        return undefined;
      }

      return {
        id: provider.id,
        name: provider.name,
        enabled: provider.enabled,
        config: structuredClone(provider.config)
      };
    }
  };
}

function getProcessEnv(): RuntimeEnvironment {
  return typeof process === "undefined" ? {} : process.env;
}
```

Place these helpers near the existing private helpers at the bottom of `packages/api/src/index.ts`. Do not export them from the package in this slice.

- [ ] **Step 5: Document the runtime switch in the env template**

In `.env.example`, add `REAL_MODEL_RUNTIME=0` immediately after the introductory comments and before `REAL_MODEL_PROVIDER_TEST=0`:

```bash
# Real Web/API/runtime provider calls are opt-in. Keep this disabled for normal dev.
REAL_MODEL_RUNTIME=0

# Real provider integration tests are opt-in. Keep this disabled for normal tests.
REAL_MODEL_PROVIDER_TEST=0
```

- [ ] **Step 6: Run the targeted API tests**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: PASS. The new fake-fetch success test should call `https://open.bigmodel.cn/api/anthropic/v1/messages` exactly once; the default-mode isolation test should make zero fetch calls; the missing-secret test should persist a failed run and sanitized `run.failed` event.

- [ ] **Step 7: Run API typecheck**

Run:

```bash
pnpm --filter @lp-agent/api typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit the runtime wiring implementation**

Run:

```bash
git add packages/api/src/index.ts packages/api/src/services.test.ts .env.example
git commit -m "wire real model runtime behind env flag"
```

---

## Task 3: Update Documentation and Verify the Workspace

**Files:**
- Modify: `docs/agent-development-learning.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Update the learning document**

In `docs/agent-development-learning.md`, in the section `下一步真实 runtime 接线设计：`, replace the current four bullets with:

```md
- [2026-05-14-real-model-runtime-wiring-design.md](./superpowers/specs/2026-05-14-real-model-runtime-wiring-design.md)
- 当前实现计划：[2026-05-14-real-model-runtime-wiring.md](./superpowers/plans/2026-05-14-real-model-runtime-wiring.md)
- 这一步把 `ProviderBackedModelGateway` 接入 Web/API/runtime，但必须通过 `REAL_MODEL_RUNTIME=1` 显式开启。
- `REAL_MODEL_PROVIDER_TEST=1` 只控制真实 provider 集成测试，不应该触发 Web/API 的真实模型运行。
- 这一阶段只验证真实模型能进入 run timeline，LP 产物仍保持 deterministic 静态 HTML/CSS/JS，不直接由模型输出驱动。
- 学习重点：真实模型接入不是把所有 runtime 都替换成网络调用，而是在服务边界增加可测试的 factory、env 开关、仓储 resolver、fake-fetch 单测和脱敏事件。
```

- [ ] **Step 2: Update the Superpowers reading order**

In `docs/superpowers/README.md`, add this item after item 26:

```md
27. `plans/2026-05-14-real-model-runtime-wiring.md`
   - Stage 3 real model runtime wiring implementation plan.
   - Read this after the real model runtime wiring design when implementing or auditing the API-owned runtime factory, repository-backed provider resolver, explicit `REAL_MODEL_RUNTIME=1` switch, fake-fetch API tests, and sanitized run event behavior.
```

- [ ] **Step 3: Run the full verification set**

Run:

```bash
pnpm --filter @lp-agent/api test
pnpm --filter @lp-agent/model-gateway test
pnpm --filter @lp-agent/api typecheck
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected:

- API tests pass.
- Model gateway tests pass with the real provider integration test skipped unless `REAL_MODEL_PROVIDER_TEST=1` is exported.
- Full workspace tests pass.
- Typecheck passes.
- Build passes.
- `git diff --check` prints no whitespace errors.

- [ ] **Step 4: Commit documentation updates**

Run:

```bash
git add docs/agent-development-learning.md docs/superpowers/README.md
git commit -m "document real model runtime wiring"
```

---

## Acceptance Checklist

- [ ] Default runtime remains deterministic when `REAL_MODEL_RUNTIME` is unset or not equal to `1`.
- [ ] `REAL_MODEL_PROVIDER_TEST=1` does not enable Web/API real runtime calls.
- [ ] `REAL_MODEL_RUNTIME=1` creates `LocalAgentRuntimeAdapter` with `ProviderBackedModelGateway`.
- [ ] Provider-backed runtime resolves project provider config from `repositories.modelProviders`.
- [ ] Successful real-provider calls emit sanitized `model.completed` events.
- [ ] Missing provider secrets emit failed run records and sanitized `run.failed` events.
- [ ] Runtime events and run records do not include API keys, env var names, full base URLs, request headers, or raw provider bodies.
- [ ] LP artifacts remain generated by `generateStaticArtifacts()` and stay framework-free static HTML/CSS/JS.
- [ ] `.env.example` documents both `REAL_MODEL_RUNTIME` and `REAL_MODEL_PROVIDER_TEST`.
- [ ] Superpowers index and Chinese learning document are updated with this plan.
