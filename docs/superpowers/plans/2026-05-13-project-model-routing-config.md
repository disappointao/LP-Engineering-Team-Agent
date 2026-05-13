# Project Model Routing Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build project-scoped model provider and role routing configuration for the Web MVP while keeping runtime calls deterministic and provider-neutral.

**Architecture:** Extend the existing workbench repository bundle with model provider and model routing policy repositories, then add API use cases that resolve project routes into a `ModelRoutingPolicy`. The runtime keeps using `ModelGateway.complete()`, but the gateway receives the resolved per-project policy for each run. The Web layer stays a thin facade over `DemoWorkbenchService` through server actions and a `?view=models` workspace view.

**Tech Stack:** pnpm TypeScript monorepo, Vitest, Next.js server actions, local JSON-file persistence, deterministic `InMemoryModelGateway`, existing i18n and Manus-style shell.

---

## File Structure

- `packages/db/src/workbench-repositories.ts`
  - Add `ModelProviderRecord`, `ModelRoutingPolicyRecord`, repository interfaces, and in-memory repository implementations.
- `packages/db/src/workbench-repositories.test.ts`
  - Add defensive-copy and project filtering tests for model providers and routes.
- `packages/db/src/json-file-workbench-repositories.ts`
  - Persist model provider and routing policy records in `.lp-agent/workbench-state.json`.
- `packages/db/src/json-file-workbench-repositories.test.ts`
  - Verify model providers/routes reopen from disk.
- `packages/model-gateway/src/index.ts`
  - Add provider type validation, route helpers, request-scoped routing policy support, and safer audit copies.
- `packages/model-gateway/src/index.test.ts`
  - Verify per-request policy overrides default policy and fails closed on missing routes.
- `packages/runtime-adapters/src/index.ts`
  - Carry `modelRoutingPolicy` through runtime context into `ModelGateway.complete()`.
- `packages/runtime-adapters/src/index.test.ts`
  - Verify runtime uses context policy and emits configured provider/model in events.
- `packages/api/src/index.ts`
  - Add model provider/route lifecycle methods, project route resolution, runtime wiring, and copy helpers.
- `packages/api/src/services.test.ts`
  - Verify provider creation, validation, route upsert, fallback, disabled-provider failure, and runtime audit behavior.
- `apps/web/src/lib/workbench-store.ts`
  - Add model flow errors, model state in page state, and store methods wrapping the API.
- `apps/web/src/lib/workbench-store.test.ts`
  - Verify Web store model lifecycle and stable errors.
- `apps/web/src/app/actions.ts`
  - Add model provider creation, provider enablement, and role route server actions.
- `apps/web/src/app/actions.test.ts`
  - Verify action parsing, redirect behavior, and stable error query codes.
- `apps/web/src/lib/i18n.ts`
  - Add Chinese and English copy for Models view and errors.
- `apps/web/src/app/page.tsx`
  - Add `?view=models`, Models nav link activation, active model route signal, provider form, route forms, and no-project gating.
- `apps/web/src/app/page.test.ts`
  - Verify Models view rendering, no-project gating, active project behavior, route controls, and i18n.
- `apps/web/src/app/globals.css`
  - Style Models view using existing card/list/form conventions.
- `docs/superpowers/README.md`
  - Add this plan after the model routing spec.

---

### Task 1: DB In-Memory Model Provider And Routing Repositories

**Files:**
- Modify: `packages/db/src/workbench-repositories.ts`
- Modify: `packages/db/src/workbench-repositories.test.ts`

- [ ] **Step 1: Write failing repository tests**

Add these tests near the skill repository tests in `packages/db/src/workbench-repositories.test.ts`:

```ts
it("stores model providers and routing policies with defensive copies", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const provider = {
    id: "provider_openai",
    scope: "project" as const,
    targetKey: "project_1",
    name: "OpenAI",
    provider: "openai" as const,
    config: {
      baseUrl: "https://api.openai.com/v1",
      secretEnvName: "OPENAI_API_KEY"
    },
    enabled: true,
    createdAt,
    updatedAt: createdAt
  };
  const policy = {
    id: "model_route_1",
    scope: "project" as const,
    targetKey: "project_1",
    role: "builder" as const,
    providerId: "provider_openai",
    model: "gpt-5.4",
    settings: {
      temperature: 0.2
    },
    createdAt,
    updatedAt: createdAt
  };

  await repositories.modelProviders.save(provider);
  await repositories.modelRoutingPolicies.save(policy);

  const savedProvider = await repositories.modelProviders.getById("provider_openai");
  const savedPolicy = await repositories.modelRoutingPolicies.getByProjectAndRole(
    "project_1",
    "builder"
  );

  expect(savedProvider).toEqual(provider);
  expect(savedPolicy).toEqual(policy);

  if (!savedProvider || !savedPolicy) {
    throw new Error("Expected saved model records.");
  }
  savedProvider.config.secretEnvName = "MUTATED_SECRET";
  savedPolicy.settings = { temperature: 1 };

  await expect(repositories.modelProviders.getById("provider_openai")).resolves.toEqual(provider);
  await expect(
    repositories.modelRoutingPolicies.getByProjectAndRole("project_1", "builder")
  ).resolves.toEqual(policy);
});

it("lists model providers and routes for a project", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  await repositories.modelProviders.save({
    id: "provider_project_1",
    scope: "project",
    targetKey: "project_1",
    name: "Project 1 OpenAI",
    provider: "openai",
    config: { secretEnvName: "OPENAI_API_KEY" },
    enabled: true,
    createdAt,
    updatedAt: createdAt
  });
  await repositories.modelProviders.save({
    id: "provider_project_2",
    scope: "project",
    targetKey: "project_2",
    name: "Project 2 Anthropic",
    provider: "anthropic",
    config: { secretEnvName: "ANTHROPIC_API_KEY" },
    enabled: true,
    createdAt,
    updatedAt: createdAt
  });
  await repositories.modelRoutingPolicies.save({
    id: "model_route_1",
    scope: "project",
    targetKey: "project_1",
    role: "planner",
    providerId: "provider_project_1",
    model: "gpt-5.4",
    createdAt,
    updatedAt: createdAt
  });

  await expect(repositories.modelProviders.listForProject("project_1")).resolves.toEqual([
    expect.objectContaining({ id: "provider_project_1" })
  ]);
  await expect(repositories.modelRoutingPolicies.listForProject("project_1")).resolves.toEqual([
    expect.objectContaining({ id: "model_route_1", role: "planner" })
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run packages/db/src/workbench-repositories.test.ts
```

Expected: FAIL because `modelProviders` and `modelRoutingPolicies` do not exist on `WorkbenchRepositories`.

- [ ] **Step 3: Add model repository types and in-memory implementations**

Modify `packages/db/src/workbench-repositories.ts`:

```ts
import type { AgentRole } from "@lp-agent/model-gateway";
```

Add these records after `SkillBindingRecord`:

```ts
export type ModelProviderType = "mock" | "openai" | "anthropic" | "internal" | "custom";

export interface ModelProviderRecord {
  id: string;
  scope: SkillScope;
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
  scope: SkillScope;
  targetKey: string;
  role: AgentRole;
  providerId: string;
  model: string;
  fallback?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

Add repository interfaces after `SkillBindingRepository`:

```ts
export interface ModelProviderRepository {
  save(provider: ModelProviderRecord): Promise<void>;
  getById(providerId: string): Promise<ModelProviderRecord | undefined>;
  listForProject(projectId: string): Promise<ModelProviderRecord[]>;
  listAll(): Promise<ModelProviderRecord[]>;
}

export interface ModelRoutingPolicyRepository {
  save(policy: ModelRoutingPolicyRecord): Promise<void>;
  getById(policyId: string): Promise<ModelRoutingPolicyRecord | undefined>;
  getByProjectAndRole(
    projectId: string,
    role: AgentRole
  ): Promise<ModelRoutingPolicyRecord | undefined>;
  listForProject(projectId: string): Promise<ModelRoutingPolicyRecord[]>;
  listAll(): Promise<ModelRoutingPolicyRecord[]>;
}
```

Extend `WorkbenchRepositories`:

```ts
modelProviders: ModelProviderRepository;
modelRoutingPolicies: ModelRoutingPolicyRepository;
```

Add fields to `InMemoryWorkbenchRepositories`:

```ts
readonly modelProviders = new InMemoryModelProviderRepository();
readonly modelRoutingPolicies = new InMemoryModelRoutingPolicyRepository();
```

Add classes:

```ts
class InMemoryModelProviderRepository implements ModelProviderRepository {
  private readonly providers = new Map<string, ModelProviderRecord>();

  async save(provider: ModelProviderRecord): Promise<void> {
    this.providers.set(provider.id, copyModelProvider(provider));
  }

  async getById(providerId: string): Promise<ModelProviderRecord | undefined> {
    const provider = this.providers.get(providerId);
    return provider ? copyModelProvider(provider) : undefined;
  }

  async listForProject(projectId: string): Promise<ModelProviderRecord[]> {
    return [...this.providers.values()]
      .filter((provider) => provider.scope === "project" && provider.targetKey === projectId)
      .map(copyModelProvider);
  }

  async listAll(): Promise<ModelProviderRecord[]> {
    return [...this.providers.values()].map(copyModelProvider);
  }
}

class InMemoryModelRoutingPolicyRepository implements ModelRoutingPolicyRepository {
  private readonly policies = new Map<string, ModelRoutingPolicyRecord>();

  async save(policy: ModelRoutingPolicyRecord): Promise<void> {
    this.policies.set(policy.id, copyModelRoutingPolicy(policy));
  }

  async getById(policyId: string): Promise<ModelRoutingPolicyRecord | undefined> {
    const policy = this.policies.get(policyId);
    return policy ? copyModelRoutingPolicy(policy) : undefined;
  }

  async getByProjectAndRole(
    projectId: string,
    role: AgentRole
  ): Promise<ModelRoutingPolicyRecord | undefined> {
    const policy = [...this.policies.values()].find(
      (candidate) =>
        candidate.scope === "project" &&
        candidate.targetKey === projectId &&
        candidate.role === role
    );
    return policy ? copyModelRoutingPolicy(policy) : undefined;
  }

  async listForProject(projectId: string): Promise<ModelRoutingPolicyRecord[]> {
    return [...this.policies.values()]
      .filter((policy) => policy.scope === "project" && policy.targetKey === projectId)
      .map(copyModelRoutingPolicy);
  }

  async listAll(): Promise<ModelRoutingPolicyRecord[]> {
    return [...this.policies.values()].map(copyModelRoutingPolicy);
  }
}
```

Add copy helpers near the existing skill copy helpers:

```ts
function copyModelProvider(provider: ModelProviderRecord): ModelProviderRecord {
  return {
    ...provider,
    config: { ...provider.config }
  };
}

function copyModelRoutingPolicy(policy: ModelRoutingPolicyRecord): ModelRoutingPolicyRecord {
  const copy: ModelRoutingPolicyRecord = { ...policy };
  if (policy.fallback) {
    copy.fallback = structuredClone(policy.fallback);
  }
  if (policy.settings) {
    copy.settings = structuredClone(policy.settings);
  }
  return copy;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run packages/db/src/workbench-repositories.test.ts
pnpm --filter @lp-agent/db typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/workbench-repositories.ts packages/db/src/workbench-repositories.test.ts
git commit -m "add in-memory model routing repositories"
```

---

### Task 2: JSON-File Model Routing Persistence

**Files:**
- Modify: `packages/db/src/json-file-workbench-repositories.ts`
- Modify: `packages/db/src/json-file-workbench-repositories.test.ts`

- [ ] **Step 1: Write failing JSON persistence test**

Add this test to `packages/db/src/json-file-workbench-repositories.test.ts`:

```ts
it("reopens model providers and routing policies from disk", async () => {
  const filePath = await tempStateFile();
  const first = createJsonFileWorkbenchRepositories({ filePath });

  await first.modelProviders.save({
    id: "provider_openai",
    scope: "project",
    targetKey: "project_1",
    name: "OpenAI",
    provider: "openai",
    config: {
      baseUrl: "https://api.openai.com/v1",
      secretEnvName: "OPENAI_API_KEY"
    },
    enabled: true,
    createdAt,
    updatedAt: createdAt
  });
  await first.modelRoutingPolicies.save({
    id: "model_route_1",
    scope: "project",
    targetKey: "project_1",
    role: "builder",
    providerId: "provider_openai",
    model: "gpt-5.4",
    settings: {
      temperature: 0.2
    },
    createdAt,
    updatedAt: createdAt
  });

  const second = createJsonFileWorkbenchRepositories({ filePath });

  await expect(second.modelProviders.listForProject("project_1")).resolves.toEqual([
    expect.objectContaining({
      id: "provider_openai",
      config: {
        baseUrl: "https://api.openai.com/v1",
        secretEnvName: "OPENAI_API_KEY"
      }
    })
  ]);
  await expect(
    second.modelRoutingPolicies.getByProjectAndRole("project_1", "builder")
  ).resolves.toEqual(
    expect.objectContaining({
      id: "model_route_1",
      providerId: "provider_openai",
      model: "gpt-5.4"
    })
  );
});
```

Update the existing "creates parent directories and writes readable JSON" assertion to include:

```ts
modelProviders: [],
modelRoutingPolicies: []
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run packages/db/src/json-file-workbench-repositories.test.ts
```

Expected: FAIL because JSON repositories do not implement model provider/policy persistence.

- [ ] **Step 3: Add JSON state fields and repositories**

In `packages/db/src/json-file-workbench-repositories.ts`, import the model types and interfaces:

```ts
ModelProviderRecord,
ModelProviderRepository,
ModelRoutingPolicyRecord,
ModelRoutingPolicyRepository,
```

Extend `JsonFileWorkbenchState`:

```ts
modelProviders: ModelProviderRecord[];
modelRoutingPolicies: ModelRoutingPolicyRecord[];
```

Add fields to `JsonFileWorkbenchRepositories`:

```ts
readonly modelProviders: ModelProviderRepository;
readonly modelRoutingPolicies: ModelRoutingPolicyRepository;
```

Initialize them in the constructor:

```ts
this.modelProviders = new JsonFileModelProviderRepository(filePath);
this.modelRoutingPolicies = new JsonFileModelRoutingPolicyRepository(filePath);
```

Add classes:

```ts
class JsonFileModelProviderRepository implements ModelProviderRepository {
  constructor(private readonly filePath: string) {}

  async save(provider: ModelProviderRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.modelProviders = upsertBy(
        state.modelProviders,
        copy(provider),
        (record) => record.id === provider.id
      );
    });
  }

  async getById(providerId: string): Promise<ModelProviderRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.modelProviders.find((provider) => provider.id === providerId));
  }

  async listForProject(projectId: string): Promise<ModelProviderRecord[]> {
    const state = await readState(this.filePath);
    return state.modelProviders
      .filter((provider) => provider.scope === "project" && provider.targetKey === projectId)
      .map(copy);
  }

  async listAll(): Promise<ModelProviderRecord[]> {
    const state = await readState(this.filePath);
    return state.modelProviders.map(copy);
  }
}

class JsonFileModelRoutingPolicyRepository implements ModelRoutingPolicyRepository {
  constructor(private readonly filePath: string) {}

  async save(policy: ModelRoutingPolicyRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.modelRoutingPolicies = upsertBy(
        state.modelRoutingPolicies,
        copy(policy),
        (record) => record.id === policy.id
      );
    });
  }

  async getById(policyId: string): Promise<ModelRoutingPolicyRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.modelRoutingPolicies.find((policy) => policy.id === policyId));
  }

  async getByProjectAndRole(
    projectId: string,
    role: ModelRoutingPolicyRecord["role"]
  ): Promise<ModelRoutingPolicyRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(
      state.modelRoutingPolicies.find(
        (policy) =>
          policy.scope === "project" && policy.targetKey === projectId && policy.role === role
      )
    );
  }

  async listForProject(projectId: string): Promise<ModelRoutingPolicyRecord[]> {
    const state = await readState(this.filePath);
    return state.modelRoutingPolicies
      .filter((policy) => policy.scope === "project" && policy.targetKey === projectId)
      .map(copy);
  }

  async listAll(): Promise<ModelRoutingPolicyRecord[]> {
    const state = await readState(this.filePath);
    return state.modelRoutingPolicies.map(copy);
  }
}
```

Update `readState()` and `emptyState()`:

```ts
modelProviders: parsed.modelProviders ?? [],
modelRoutingPolicies: parsed.modelRoutingPolicies ?? []
```

and:

```ts
modelProviders: [],
modelRoutingPolicies: []
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run packages/db/src/json-file-workbench-repositories.test.ts
pnpm --filter @lp-agent/db typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/json-file-workbench-repositories.ts packages/db/src/json-file-workbench-repositories.test.ts
git commit -m "persist model routing configuration"
```

---

### Task 3: Model Gateway And Runtime Request-Scoped Routing

**Files:**
- Modify: `packages/model-gateway/src/index.ts`
- Modify: `packages/model-gateway/src/index.test.ts`
- Modify: `packages/runtime-adapters/src/index.ts`
- Modify: `packages/runtime-adapters/src/index.test.ts`

- [ ] **Step 1: Write failing model-gateway tests**

Add these tests to `packages/model-gateway/src/index.test.ts`:

```ts
it("uses request-scoped routing policy when provided", async () => {
  const gateway = new InMemoryModelGateway(createDefaultModelPolicy());

  const result = await gateway.complete({
    role: "builder",
    prompt: "Generate HTML",
    projectId: "project_1",
    routingPolicy: {
      planner: { provider: "mock-openai", model: "planning-model" },
      builder: { provider: "project-openai", model: "gpt-5.4" },
      reviewer: { provider: "mock-openai", model: "review-model" },
      deployer: { provider: "mock-local", model: "tool-model" }
    }
  });

  expect(result).toMatchObject({
    provider: "project-openai",
    model: "gpt-5.4"
  });
  expect(gateway.getAuditLog()[0]).toMatchObject({
    provider: "project-openai",
    model: "gpt-5.4"
  });
});

it("copies request-scoped routing policy before storing audit context", async () => {
  const policy = createDefaultModelPolicy();
  policy.builder.provider = "project-openai";
  policy.builder.model = "gpt-5.4";
  const gateway = new InMemoryModelGateway(createDefaultModelPolicy());

  await gateway.complete({
    role: "builder",
    prompt: "Generate HTML",
    projectId: "project_1",
    routingPolicy: policy
  });
  policy.builder.provider = "mutated-provider";
  policy.builder.model = "mutated-model";

  expect(gateway.getAuditLog()[0]).toMatchObject({
    provider: "project-openai",
    model: "gpt-5.4"
  });
});
```

- [ ] **Step 2: Write failing runtime adapter test**

Add this test to `packages/runtime-adapters/src/index.test.ts`:

```ts
it("passes runtime model routing policy into model calls", async () => {
  const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
  const runtime = new LocalAgentRuntimeAdapter(gateway);

  const result = await runtime.run({
    runId: "run_builder_1",
    projectId: "project_1",
    role: "builder",
    input: {
      brief: sampleBrief,
      prompt: "Build"
    },
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
        builder: { provider: "project-openai", model: "gpt-5.4" },
        reviewer: { provider: "mock-openai", model: "review-model" },
        deployer: { provider: "mock-local", model: "tool-model" }
      }
    }
  });

  expect(result.events).toContainEqual(
    expect.objectContaining({
      type: "model.completed",
      provider: "project-openai",
      model: "gpt-5.4"
    })
  );
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run packages/model-gateway/src/index.test.ts packages/runtime-adapters/src/index.test.ts
```

Expected: FAIL because `routingPolicy` and `modelRoutingPolicy` fields do not exist.

- [ ] **Step 4: Implement request-scoped routing**

In `packages/model-gateway/src/index.ts`, add to `ModelRequest`:

```ts
routingPolicy?: ModelRoutingPolicy;
```

Update `complete()` to prefer request policy:

```ts
const policy = request.routingPolicy ? clonePolicy(request.routingPolicy) : this.policy;
const route = policy[request.role];
```

Add a helper export for role lists if useful to API tasks:

```ts
export const agentRoles: AgentRole[] = ["planner", "builder", "reviewer", "deployer"];
```

Keep the missing-route error unchanged:

```ts
if (!route) {
  throw new ModelRouteNotConfiguredError(request.role);
}
```

- [ ] **Step 5: Implement runtime context routing**

In `packages/runtime-adapters/src/index.ts`, import `type ModelRoutingPolicy` from `@lp-agent/model-gateway`.

Add to `RuntimeRunContext`:

```ts
modelRoutingPolicy?: ModelRoutingPolicy;
```

Add to `toModelRequestContext()` return type only if `ModelRequestContext` also carries the field. Prefer a top-level model request field:

```ts
const modelResponse = await this.modelGateway.complete({
  role: request.role,
  projectId: request.projectId,
  prompt: toModelPrompt(request),
  context: toModelRequestContext(context),
  routingPolicy: context.modelRoutingPolicy
});
```

Update `cloneRuntimeContext()`:

```ts
modelRoutingPolicy: context.modelRoutingPolicy
  ? {
      planner: { ...context.modelRoutingPolicy.planner },
      builder: { ...context.modelRoutingPolicy.builder },
      reviewer: { ...context.modelRoutingPolicy.reviewer },
      deployer: { ...context.modelRoutingPolicy.deployer }
    }
  : undefined
```

If TypeScript complains about optional properties, build the object with a conditional spread:

```ts
return {
  skills: ...,
  mcpTools: ...,
  approval: ...,
  artifactWorkspace: ...,
  ...(context.modelRoutingPolicy
    ? { modelRoutingPolicy: cloneModelRoutingPolicy(context.modelRoutingPolicy) }
    : {})
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run packages/model-gateway/src/index.test.ts packages/runtime-adapters/src/index.test.ts
pnpm --filter @lp-agent/model-gateway typecheck
pnpm --filter @lp-agent/runtime-adapters typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/model-gateway/src/index.ts packages/model-gateway/src/index.test.ts packages/runtime-adapters/src/index.ts packages/runtime-adapters/src/index.test.ts
git commit -m "route model calls per request"
```

---

### Task 4: API Model Provider Lifecycle And Runtime Route Resolution

**Files:**
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/services.test.ts`

- [ ] **Step 1: Write failing API tests**

Add these tests near the skill lifecycle tests in `packages/api/src/services.test.ts`:

```ts
it("creates project model providers and resolves default routes", async () => {
  const service = new DemoWorkbenchService({ now: fixedClock() });
  const project = await service.createProject({ name: "Project" });

  const provider = await service.createModelProvider({
    projectId: project.id,
    providerId: "provider_openai",
    name: "OpenAI",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    secretEnvName: "OPENAI_API_KEY"
  });
  const policy = await service.resolveModelRoutingPolicyForProject(project.id);

  expect(provider).toMatchObject({
    id: "provider_openai",
    scope: "project",
    targetKey: project.id,
    name: "OpenAI",
    provider: "openai",
    config: {
      baseUrl: "https://api.openai.com/v1",
      secretEnvName: "OPENAI_API_KEY"
    },
    enabled: true
  });
  expect(policy.builder).toEqual({ provider: "mock-anthropic", model: "code-model" });
});

it("upserts project model routes and uses them during runtime calls", async () => {
  const builderRuntime = new RecordingRuntime({ state: "completed", artifacts: completeArtifacts() });
  const service = new DemoWorkbenchService({
    builderRuntime,
    now: fixedClock()
  });
  const project = await service.createProject({ name: "Project" });
  const provider = await service.createModelProvider({
    projectId: project.id,
    providerId: "provider_openai",
    name: "OpenAI",
    provider: "openai",
    secretEnvName: "OPENAI_API_KEY"
  });
  await service.upsertProjectModelRoute({
    projectId: project.id,
    role: "builder",
    providerId: provider.id,
    model: "gpt-5.4"
  });

  const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
  await service.generatePageVersion({ projectId: project.id, briefId: brief.id });

  expect(builderRuntime.requests[0]?.context?.modelRoutingPolicy?.builder).toEqual({
    provider: "provider_openai",
    model: "gpt-5.4"
  });
});

it("rejects disabled model providers during route resolution", async () => {
  const service = new DemoWorkbenchService({ now: fixedClock() });
  const project = await service.createProject({ name: "Project" });
  const provider = await service.createModelProvider({
    projectId: project.id,
    providerId: "provider_openai",
    name: "OpenAI",
    provider: "openai",
    secretEnvName: "OPENAI_API_KEY"
  });
  await service.upsertProjectModelRoute({
    projectId: project.id,
    role: "builder",
    providerId: provider.id,
    model: "gpt-5.4"
  });
  await service.setModelProviderEnabled({
    projectId: project.id,
    providerId: provider.id,
    enabled: false
  });

  await expect(service.resolveModelRoutingPolicyForProject(project.id)).rejects.toThrow(
    "model_provider_disabled"
  );
});

it("rejects invalid model provider input", async () => {
  const service = new DemoWorkbenchService({ now: fixedClock() });
  const project = await service.createProject({ name: "Project" });

  await expect(
    service.createModelProvider({
      projectId: project.id,
      providerId: "provider_bad",
      name: "Bad",
      provider: "javascript" as "openai",
      secretEnvName: "OPENAI_API_KEY"
    })
  ).rejects.toThrow("model_provider_type_unsupported");

  await expect(
    service.createModelProvider({
      projectId: project.id,
      providerId: "provider_secret",
      name: "Secret",
      provider: "openai",
      secretEnvName: "sk-real-secret-value"
    })
  ).rejects.toThrow("model_secret_reference_invalid");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run packages/api/src/services.test.ts
```

Expected: FAIL because model provider service methods do not exist.

- [ ] **Step 3: Add API types and service methods**

In `packages/api/src/index.ts`, extend imports from `@lp-agent/db`:

```ts
type ModelProviderRecord,
type ModelProviderType,
type ModelRoutingPolicyRecord,
```

Extend imports from `@lp-agent/model-gateway`:

```ts
agentRoles,
type AgentRole,
type ModelRoutingPolicy,
```

Add API input/result types after skill input types:

```ts
export interface CreateModelProviderInput {
  projectId: string;
  providerId: string;
  name: string;
  provider: ModelProviderType;
  baseUrl?: string;
  secretEnvName?: string;
}

export interface SetModelProviderEnabledInput {
  projectId: string;
  providerId: string;
  enabled: boolean;
}

export interface UpsertProjectModelRouteInput {
  projectId: string;
  role: AgentRole;
  providerId: string;
  model: string;
}

export interface ProjectModelState {
  providers: ModelProviderRecord[];
  routes: ModelRoutingPolicyRecord[];
  resolvedPolicy: ModelRoutingPolicy;
}
```

Add methods to `DemoWorkbenchService`:

```ts
async createModelProvider(input: CreateModelProviderInput): Promise<ModelProviderRecord> {
  await this.getProjectOrThrow(input.projectId);
  const providerId = normalizeIdentifier(input.providerId, "model_provider_key_required");
  const name = normalizeNonEmpty(input.name, "model_provider_name_required");
  const provider = normalizeModelProviderType(input.provider);
  const config = normalizeModelProviderConfig({
    baseUrl: input.baseUrl,
    secretEnvName: input.secretEnvName
  });

  if (await this.repositories.modelProviders.getById(providerId)) {
    throw new Error("model_provider_already_exists");
  }

  const timestamp = this.timestamp();
  const record: ModelProviderRecord = {
    id: providerId,
    scope: "project",
    targetKey: input.projectId,
    name,
    provider,
    config,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await this.repositories.modelProviders.save(record);
  return copyModelProviderRecord(record);
}

async setModelProviderEnabled(
  input: SetModelProviderEnabledInput
): Promise<ModelProviderRecord> {
  await this.getProjectOrThrow(input.projectId);
  const provider = await this.repositories.modelProviders.getById(input.providerId);
  if (!provider || !isProjectModelProviderForProject(provider, input.projectId)) {
    throw new Error("model_provider_not_found");
  }
  const updated: ModelProviderRecord = {
    ...provider,
    enabled: input.enabled,
    updatedAt: this.timestamp()
  };
  await this.repositories.modelProviders.save(updated);
  return copyModelProviderRecord(updated);
}

async upsertProjectModelRoute(
  input: UpsertProjectModelRouteInput
): Promise<ModelRoutingPolicyRecord> {
  await this.getProjectOrThrow(input.projectId);
  const role = normalizeAgentRole(input.role);
  const model = normalizeNonEmpty(input.model, "model_id_required");
  const provider = await this.repositories.modelProviders.getById(input.providerId);
  if (!provider || !isProjectModelProviderForProject(provider, input.projectId)) {
    throw new Error("model_provider_not_found");
  }
  if (!provider.enabled) {
    throw new Error("model_provider_disabled");
  }

  const existing = await this.repositories.modelRoutingPolicies.getByProjectAndRole(
    input.projectId,
    role
  );
  const timestamp = this.timestamp();
  const route: ModelRoutingPolicyRecord = {
    id: existing?.id ?? nextSequentialId(
      "model_route",
      (await this.repositories.modelRoutingPolicies.listAll()).map((record) => record.id)
    ),
    scope: "project",
    targetKey: input.projectId,
    role,
    providerId: provider.id,
    model,
    fallback: existing?.fallback ? structuredClone(existing.fallback) : undefined,
    settings: existing?.settings ? structuredClone(existing.settings) : undefined,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp
  };
  await this.repositories.modelRoutingPolicies.save(route);
  return copyModelRoutingPolicyRecord(route);
}

async listProjectModelState(projectId: string): Promise<ProjectModelState> {
  await this.getProjectOrThrow(projectId);
  return {
    providers: (await this.repositories.modelProviders.listForProject(projectId)).map(
      copyModelProviderRecord
    ),
    routes: (await this.repositories.modelRoutingPolicies.listForProject(projectId)).map(
      copyModelRoutingPolicyRecord
    ),
    resolvedPolicy: await this.resolveModelRoutingPolicyForProject(projectId)
  };
}

async resolveModelRoutingPolicyForProject(projectId: string): Promise<ModelRoutingPolicy> {
  await this.getProjectOrThrow(projectId);
  const defaultPolicy = createDefaultModelPolicy();
  const projectRoutes = await this.repositories.modelRoutingPolicies.listForProject(projectId);
  const resolved: ModelRoutingPolicy = {
    planner: { ...defaultPolicy.planner },
    builder: { ...defaultPolicy.builder },
    reviewer: { ...defaultPolicy.reviewer },
    deployer: { ...defaultPolicy.deployer }
  };

  for (const route of projectRoutes) {
    const role = normalizeAgentRole(route.role);
    const provider = await this.repositories.modelProviders.getById(route.providerId);
    if (!provider || !isProjectModelProviderForProject(provider, projectId)) {
      throw new Error("model_route_provider_invalid");
    }
    if (!provider.enabled) {
      throw new Error("model_provider_disabled");
    }
    if (route.model.trim().length === 0) {
      throw new Error("model_id_required");
    }
    resolved[role] = {
      provider: provider.id,
      model: route.model
    };
  }

  return resolved;
}
```

Add helper functions near existing normalization helpers:

```ts
function normalizeIdentifier(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(errorCode);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error(errorCode);
  }
  return normalized;
}

function normalizeNonEmpty(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(errorCode);
  }
  return normalized;
}

function normalizeModelProviderType(provider: unknown): ModelProviderType {
  if (
    provider === "mock" ||
    provider === "openai" ||
    provider === "anthropic" ||
    provider === "internal" ||
    provider === "custom"
  ) {
    return provider;
  }
  throw new Error("model_provider_type_unsupported");
}

function normalizeModelProviderConfig(input: {
  baseUrl?: string;
  secretEnvName?: string;
}): ModelProviderRecord["config"] {
  const config: ModelProviderRecord["config"] = {};
  const baseUrl = input.baseUrl?.trim();
  const secretEnvName = input.secretEnvName?.trim();
  if (baseUrl) {
    config.baseUrl = baseUrl;
  }
  if (secretEnvName) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(secretEnvName)) {
      throw new Error("model_secret_reference_invalid");
    }
    config.secretEnvName = secretEnvName;
  }
  return config;
}

function normalizeAgentRole(role: unknown): AgentRole {
  if (agentRoles.includes(role as AgentRole)) {
    return role as AgentRole;
  }
  throw new Error("model_role_unsupported");
}

function isProjectModelProviderForProject(
  provider: ModelProviderRecord,
  projectId: string
): boolean {
  return provider.scope === "project" && provider.targetKey === projectId;
}
```

Add copy helpers:

```ts
function copyModelProviderRecord(provider: ModelProviderRecord): ModelProviderRecord {
  return {
    ...provider,
    config: { ...provider.config }
  };
}

function copyModelRoutingPolicyRecord(
  policy: ModelRoutingPolicyRecord
): ModelRoutingPolicyRecord {
  const copy: ModelRoutingPolicyRecord = { ...policy };
  if (policy.fallback) {
    copy.fallback = structuredClone(policy.fallback);
  }
  if (policy.settings) {
    copy.settings = structuredClone(policy.settings);
  }
  return copy;
}
```

- [ ] **Step 4: Wire resolved policy into runtime context**

Update `createRuntimeContext()`:

```ts
const [skillVersions, modelRoutingPolicy] = await Promise.all([
  this.listRuntimeSkillsForProject(projectId),
  this.resolveModelRoutingPolicyForProject(projectId)
]);
return createWorkbenchRuntimeContext({
  role,
  approvalState,
  skillVersions,
  modelRoutingPolicy
});
```

Update `createWorkbenchRuntimeContext()` input and return:

```ts
modelRoutingPolicy: ModelRoutingPolicy;
```

and:

```ts
return {
  skills,
  mcpTools,
  approval: { state: approvalState },
  artifactWorkspace: {
    mode: "memory",
    writableFiles: ["index.html", "styles.css", "script.js"]
  },
  modelRoutingPolicy: input.modelRoutingPolicy
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run packages/api/src/services.test.ts
pnpm --filter @lp-agent/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/index.ts packages/api/src/services.test.ts
git commit -m "add project model routing service"
```

---

### Task 5: Web Store And Server Actions For Models

**Files:**
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`
- Modify: `apps/web/src/app/actions.ts`
- Modify: `apps/web/src/app/actions.test.ts`

- [ ] **Step 1: Write failing Web store tests**

Add this test to `apps/web/src/lib/workbench-store.test.ts`:

```ts
it("creates model providers and routes through the web store", async () => {
  const store = createWebWorkbenchStore();
  const project = await store.createProject({ name: "Project" });

  const provider = await store.createModelProvider({
    projectId: project.id,
    providerId: "provider_openai",
    name: "OpenAI",
    provider: "openai",
    secretEnvName: "OPENAI_API_KEY"
  });
  if (!provider.ok) {
    throw new Error(`Expected provider creation to succeed, got ${provider.error}.`);
  }

  const route = await store.upsertProjectModelRoute({
    projectId: project.id,
    role: "builder",
    providerId: provider.value.id,
    model: "gpt-5.4"
  });
  if (!route.ok) {
    throw new Error(`Expected route upsert to succeed, got ${route.error}.`);
  }

  const state = await store.getPageState({ projectId: project.id });

  expect(state.models.providers).toEqual([
    expect.objectContaining({ id: "provider_openai", provider: "openai" })
  ]);
  expect(state.models.routes).toEqual([
    expect.objectContaining({ role: "builder", model: "gpt-5.4" })
  ]);
  expect(state.models.resolvedPolicy.builder).toEqual({
    provider: "provider_openai",
    model: "gpt-5.4"
  });
});

it("maps model store validation errors to stable codes", async () => {
  const store = createWebWorkbenchStore();
  const project = await store.createProject({ name: "Project" });

  const result = await store.createModelProvider({
    projectId: project.id,
    providerId: "provider_bad",
    name: "Bad",
    provider: "javascript",
    secretEnvName: "OPENAI_API_KEY"
  });

  expect(result).toEqual({
    ok: false,
    error: "model_provider_type_unsupported"
  });
});
```

- [ ] **Step 2: Write failing action tests**

Add tests to `apps/web/src/app/actions.test.ts`:

```ts
it("creates a model provider and redirects to the models view", async () => {
  mocks.currentProjectId = "project_1";
  mocks.createModelProvider.mockResolvedValue({
    ok: true,
    value: { id: "provider_openai" }
  });

  await expectRedirect(
    createModelProviderAction(
      buildSkillForm({
        providerId: "provider_openai",
        name: "OpenAI",
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        secretEnvName: "OPENAI_API_KEY"
      })
    ),
    "/?view=models"
  );

  expect(mocks.createModelProvider).toHaveBeenCalledWith({
    projectId: "project_1",
    providerId: "provider_openai",
    name: "OpenAI",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    secretEnvName: "OPENAI_API_KEY"
  });
});

it("upserts a model route and redirects to the models view", async () => {
  mocks.currentProjectId = "project_1";
  mocks.upsertProjectModelRoute.mockResolvedValue({
    ok: true,
    value: { id: "model_route_1" }
  });

  await expectRedirect(
    upsertProjectModelRouteAction(
      buildSkillForm({
        role: "builder",
        providerId: "provider_openai",
        model: "gpt-5.4"
      })
    ),
    "/?view=models"
  );

  expect(mocks.upsertProjectModelRoute).toHaveBeenCalledWith({
    projectId: "project_1",
    role: "builder",
    providerId: "provider_openai",
    model: "gpt-5.4"
  });
});
```

Extend the hoisted mocks:

```ts
createModelProvider: vi.fn(),
setModelProviderEnabled: vi.fn(),
upsertProjectModelRoute: vi.fn()
```

Extend the mocked store object with these functions.

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts
```

Expected: FAIL because Web model store/actions do not exist.

- [ ] **Step 4: Add Web store model types and methods**

In `apps/web/src/lib/workbench-store.ts`, import model types from `@lp-agent/api`:

```ts
type AgentRole,
type ModelProviderRecord,
type ModelProviderType,
type ModelRoutingPolicyRecord,
type ProjectModelState,
```

Add error union entries:

```ts
| "model_provider_name_required"
| "model_provider_key_required"
| "model_provider_type_unsupported"
| "model_provider_already_exists"
| "model_provider_not_found"
| "model_provider_disabled"
| "model_role_unsupported"
| "model_id_required"
| "model_route_not_found"
| "model_route_provider_invalid"
| "model_secret_reference_invalid"
| "model_routing_operation_failed";
```

Add input/result types:

```ts
export type ModelActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ModelFlowErrorCode };

export interface CreateModelProviderFormInput {
  projectId: string;
  providerId: string;
  name: string;
  provider: ModelProviderType | string;
  baseUrl?: string;
  secretEnvName?: string;
}

export interface UpsertProjectModelRouteFormInput {
  projectId: string;
  role: AgentRole | string;
  providerId: string;
  model: string;
}
```

Add `models: ProjectModelState` to both `WorkbenchPageState` variants.

Add store methods:

```ts
createModelProvider(input: CreateModelProviderFormInput): Promise<ModelActionResult<ModelProviderRecord>>;
setModelProviderEnabled(input: {
  projectId: string;
  providerId: string;
  enabled: boolean;
}): Promise<ModelActionResult<ModelProviderRecord>>;
upsertProjectModelRoute(
  input: UpsertProjectModelRouteFormInput
): Promise<ModelActionResult<ModelRoutingPolicyRecord>>;
```

Add an empty state helper:

```ts
const emptyModelState = async (projectId?: string | null): Promise<ProjectModelState> => {
  if (!projectId) {
    return {
      providers: [],
      routes: [],
      resolvedPolicy: createDefaultModelPolicy()
    };
  }
  try {
    return await service.listProjectModelState(projectId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "project_not_found" || message === "Project not found.") {
      return {
        providers: [],
        routes: [],
        resolvedPolicy: createDefaultModelPolicy()
      };
    }
    throw error;
  }
};
```

Import `createDefaultModelPolicy` from `@lp-agent/model-gateway`.

When building page state, set:

```ts
models: await loadModelState(requestedProject?.id)
```

and:

```ts
models: await loadModelState(activeProjectId)
```

Add methods that wrap service calls:

```ts
async createModelProvider(input) {
  try {
    const value = await service.createModelProvider(input);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: toModelFlowError(error) };
  }
}
```

Repeat for `setModelProviderEnabled` and `upsertProjectModelRoute`.

Add `toModelFlowError()` mirroring skill error mapping.

- [ ] **Step 5: Add server actions**

In `apps/web/src/app/actions.ts`, import the new store error type if needed.

Add redirect helper:

```ts
function redirectToModelsWithError(error: ModelFlowErrorCode): never {
  redirect(`/?view=models&modelError=${encodeURIComponent(error)}`);
}
```

Add role parser:

```ts
function parseAgentRole(rawValue: FormDataEntryValue | null): "planner" | "builder" | "reviewer" | "deployer" {
  const value = String(rawValue ?? "");
  if (value === "planner" || value === "builder" || value === "reviewer" || value === "deployer") {
    return value;
  }
  redirectToModelsWithError("model_role_unsupported");
}
```

Add actions:

```ts
export async function createModelProviderAction(formData: FormData): Promise<void> {
  const currentProjectId = await getCurrentProjectId();
  if (!currentProjectId) {
    redirectToModelsWithError("project_not_found");
  }
  const result = await getWebWorkbenchStore().createModelProvider({
    projectId: currentProjectId,
    providerId: String(formData.get("providerId") ?? ""),
    name: String(formData.get("name") ?? ""),
    provider: String(formData.get("provider") ?? ""),
    baseUrl: String(formData.get("baseUrl") ?? ""),
    secretEnvName: String(formData.get("secretEnvName") ?? "")
  });
  if (!result.ok) {
    redirectToModelsWithError(result.error);
  }
  revalidatePath("/");
  redirect("/?view=models");
}

export async function setModelProviderEnabledAction(formData: FormData): Promise<void> {
  const currentProjectId = await getCurrentProjectId();
  if (!currentProjectId) {
    redirectToModelsWithError("project_not_found");
  }
  const result = await getWebWorkbenchStore().setModelProviderEnabled({
    projectId: currentProjectId,
    providerId: String(formData.get("providerId") ?? ""),
    enabled: String(formData.get("enabled") ?? "false") === "true"
  });
  if (!result.ok) {
    redirectToModelsWithError(result.error);
  }
  revalidatePath("/");
  redirect("/?view=models");
}

export async function upsertProjectModelRouteAction(formData: FormData): Promise<void> {
  const currentProjectId = await getCurrentProjectId();
  if (!currentProjectId) {
    redirectToModelsWithError("project_not_found");
  }
  const result = await getWebWorkbenchStore().upsertProjectModelRoute({
    projectId: currentProjectId,
    role: parseAgentRole(formData.get("role")),
    providerId: String(formData.get("providerId") ?? ""),
    model: String(formData.get("model") ?? "")
  });
  if (!result.ok) {
    redirectToModelsWithError(result.error);
  }
  revalidatePath("/");
  redirect("/?view=models");
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts
pnpm --filter @lp-agent/web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.ts apps/web/src/app/actions.test.ts
git commit -m "wire model routing into web store"
```

---

### Task 6: Models View UI And i18n

**Files:**
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Write failing page tests**

Add tests to `apps/web/src/app/page.test.ts`:

```ts
it("renders the models management view from the models route", async () => {
  pageMocks.currentProjectId = "project_1";
  pageMocks.pageState = {
    kind: "empty",
    projects: [
      {
        id: "project_1",
        name: "Spring Campaign",
        createdAt: "2026-05-12T08:00:00.000Z"
      }
    ],
    tasks: [],
    skills: {
      boundSkills: [],
      availableVersions: []
    },
    models: {
      providers: [],
      routes: [],
      resolvedPolicy: {
        planner: { provider: "mock-openai", model: "planning-model" },
        builder: { provider: "mock-anthropic", model: "code-model" },
        reviewer: { provider: "mock-openai", model: "review-model" },
        deployer: { provider: "mock-local", model: "tool-model" }
      }
    }
  };

  const page = await HomePage({
    searchParams: Promise.resolve({ view: "models" })
  });
  const text = collectText(page);
  const inputs = collectElements(page, "input");
  const selects = collectElements(page, "select");

  expect(text).toContain("Project models");
  expect(text).toContain("Spring Campaign");
  expect(inputs.some((input) => input.props?.name === "providerId")).toBe(true);
  expect(selects.some((select) => select.props?.name === "provider")).toBe(true);
  expect(text).toContain("mock-anthropic/code-model");
});

it("does not render model configuration forms without an active project", async () => {
  const page = await HomePage({
    searchParams: Promise.resolve({ view: "models" })
  });
  const text = collectText(page);
  const inputs = collectElements(page, "input");

  expect(text).toContain("No active project");
  expect(inputs.some((input) => input.props?.name === "providerId")).toBe(false);
  expect(text).not.toContain("What can I help you build?");
});

it("renders saved model providers and route forms", async () => {
  pageMocks.currentProjectId = "project_1";
  pageMocks.pageState = {
    kind: "empty",
    projects: [
      {
        id: "project_1",
        name: "Spring Campaign",
        createdAt: "2026-05-12T08:00:00.000Z"
      }
    ],
    tasks: [],
    skills: {
      boundSkills: [],
      availableVersions: []
    },
    models: {
      providers: [
        {
          id: "provider_openai",
          scope: "project",
          targetKey: "project_1",
          name: "OpenAI",
          provider: "openai",
          config: { secretEnvName: "OPENAI_API_KEY" },
          enabled: true,
          createdAt: "2026-05-12T08:00:00.000Z",
          updatedAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      routes: [
        {
          id: "model_route_1",
          scope: "project",
          targetKey: "project_1",
          role: "builder",
          providerId: "provider_openai",
          model: "gpt-5.4",
          createdAt: "2026-05-12T08:00:00.000Z",
          updatedAt: "2026-05-12T08:00:00.000Z"
        }
      ],
      resolvedPolicy: {
        planner: { provider: "mock-openai", model: "planning-model" },
        builder: { provider: "provider_openai", model: "gpt-5.4" },
        reviewer: { provider: "mock-openai", model: "review-model" },
        deployer: { provider: "mock-local", model: "tool-model" }
      }
    }
  };

  const page = await HomePage({
    searchParams: Promise.resolve({ view: "models" })
  });
  const text = collectText(page).join(" ");

  expect(text).toContain("OpenAI");
  expect(text).toContain("provider_openai/gpt-5.4");
  expect(text).toContain("Builder");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts
```

Expected: FAIL because `view=models` and model copy do not exist.

- [ ] **Step 3: Add i18n copy**

In `apps/web/src/lib/i18n.ts`, extend `WorkbenchCopy`:

```ts
modelsView: {
  title: string;
  subtitle: string;
  activeProjectLabel: string;
  noProject: string;
  providerCreateTitle: string;
  providerIdLabel: string;
  providerNameLabel: string;
  providerTypeLabel: string;
  baseUrlLabel: string;
  secretEnvNameLabel: string;
  createProvider: string;
  providersTitle: string;
  routesTitle: string;
  resolvedTitle: string;
  enabled: string;
  disabled: string;
  enable: string;
  disable: string;
  modelLabel: string;
  saveRoute: string;
  fallbackLabel: string;
  roleLabels: Record<"planner" | "builder" | "reviewer" | "deployer", string>;
  providerTypes: Record<"mock" | "openai" | "anthropic" | "internal" | "custom", string>;
  errors: Record<ModelFlowErrorCode, string>;
};
```

Add English copy:

```ts
modelsView: {
  title: "Project models",
  subtitle: "Configure project-scoped model providers and role routes without storing raw secrets.",
  activeProjectLabel: "Active project",
  noProject: "Create or select a project before configuring models.",
  providerCreateTitle: "Create model provider",
  providerIdLabel: "Provider key",
  providerNameLabel: "Display name",
  providerTypeLabel: "Provider type",
  baseUrlLabel: "Base URL",
  secretEnvNameLabel: "Secret env var",
  createProvider: "Create provider",
  providersTitle: "Providers",
  routesTitle: "Role routes",
  resolvedTitle: "Resolved routes",
  enabled: "Enabled",
  disabled: "Disabled",
  enable: "Enable",
  disable: "Disable",
  modelLabel: "Model ID",
  saveRoute: "Save route",
  fallbackLabel: "Fallback",
  roleLabels: {
    planner: "Planner",
    builder: "Builder",
    reviewer: "Reviewer",
    deployer: "Deployer"
  },
  providerTypes: {
    mock: "Mock",
    openai: "OpenAI",
    anthropic: "Anthropic",
    internal: "Internal",
    custom: "Custom"
  },
  errors: {
    project_not_found: "The selected project is no longer available.",
    model_provider_name_required: "Enter a provider display name.",
    model_provider_key_required: "Enter a provider key using letters, numbers, hyphens, or underscores.",
    model_provider_type_unsupported: "Choose a supported provider type.",
    model_provider_already_exists: "That provider key already exists.",
    model_provider_not_found: "The selected provider is no longer available.",
    model_provider_disabled: "Enable the provider before routing a role to it.",
    model_role_unsupported: "Choose a supported role.",
    model_id_required: "Enter a model id.",
    model_route_not_found: "The selected model route is no longer available.",
    model_route_provider_invalid: "The route points to an unavailable provider.",
    model_secret_reference_invalid: "Use an environment variable name, not a secret value.",
    model_routing_operation_failed: "The model routing operation failed. Try again."
  }
}
```

Add equivalent Chinese copy.

- [ ] **Step 4: Add Models view rendering**

In `apps/web/src/app/page.tsx`, import actions:

```ts
createModelProviderAction,
setModelProviderEnabledAction,
upsertProjectModelRouteAction
```

Update props:

```ts
searchParams?: Promise<{ error?: string; skillError?: string; modelError?: string; view?: string }>;
```

Update active view:

```ts
const activeView =
  params?.view === "skills" ? "skills" :
  params?.view === "models" ? "models" :
  "workbench";
```

Add:

```ts
const modelError = toModelFlowError(params?.modelError);
const modelErrorMessage = modelError ? copy.modelsView.errors[modelError] : undefined;
const roleOrder = ["planner", "builder", "reviewer", "deployer"] as const;
```

Change Models nav item from a `<div>` to a link:

```tsx
<a className={activeView === "models" ? "navItem navItemActive" : "navItem"} href="/?view=models">
  {copy.nav.models}
</a>
```

Add a models view before the workbench empty state:

```tsx
{activeView === "models" ? (
  <section className="modelsView" aria-labelledby="models-title">
    <header className="modelsHeader">
      <div>
        <h1 id="models-title">{copy.modelsView.title}</h1>
        <p>{copy.modelsView.subtitle}</p>
      </div>
    </header>

    {modelErrorMessage ? <div className="formError" role="alert">{modelErrorMessage}</div> : null}

    <div className="modelsProjectContext">
      <span>{copy.modelsView.activeProjectLabel}</span>
      <strong>{activeProject?.name ?? copy.modelsView.noProject}</strong>
    </div>

    {activeProject ? (
      <>
        <form action={createModelProviderAction} className="modelEditor">
          <h2>{copy.modelsView.providerCreateTitle}</h2>
          <label htmlFor="providerId">{copy.modelsView.providerIdLabel}</label>
          <input id="providerId" name="providerId" aria-describedby="provider-id-example" />
          <small id="provider-id-example">provider_openai</small>
          <label htmlFor="providerName">{copy.modelsView.providerNameLabel}</label>
          <input id="providerName" name="name" aria-describedby="provider-name-example" />
          <small id="provider-name-example">OpenAI</small>
          <label htmlFor="provider">{copy.modelsView.providerTypeLabel}</label>
          <select id="provider" name="provider" defaultValue="mock">
            {(["mock", "openai", "anthropic", "internal", "custom"] as const).map((type) => (
              <option value={type} key={type}>{copy.modelsView.providerTypes[type]}</option>
            ))}
          </select>
          <label htmlFor="baseUrl">{copy.modelsView.baseUrlLabel}</label>
          <input id="baseUrl" name="baseUrl" aria-describedby="base-url-example" />
          <small id="base-url-example">https://api.openai.com/v1</small>
          <label htmlFor="secretEnvName">{copy.modelsView.secretEnvNameLabel}</label>
          <input id="secretEnvName" name="secretEnvName" aria-describedby="secret-env-example" />
          <small id="secret-env-example">OPENAI_API_KEY</small>
          <button type="submit">{copy.modelsView.createProvider}</button>
        </form>

        <section className="modelsList" aria-labelledby="model-providers-title">
          <h2 id="model-providers-title">{copy.modelsView.providersTitle}</h2>
          {pageState.models.providers.length > 0 ? (
            pageState.models.providers.map((provider) => (
              <div className="modelRow" key={provider.id}>
                <div>
                  <strong>{provider.name}</strong>
                  <span>{provider.provider} · {provider.enabled ? copy.modelsView.enabled : copy.modelsView.disabled}</span>
                </div>
                <form action={setModelProviderEnabledAction}>
                  <input name="providerId" type="hidden" value={provider.id} />
                  <input name="enabled" type="hidden" value={provider.enabled ? "false" : "true"} />
                  <button type="submit">{provider.enabled ? copy.modelsView.disable : copy.modelsView.enable}</button>
                </form>
              </div>
            ))
          ) : (
            <p>{copy.modelsView.fallbackLabel}</p>
          )}
        </section>

        <section className="modelsList" aria-labelledby="model-routes-title">
          <h2 id="model-routes-title">{copy.modelsView.routesTitle}</h2>
          {roleOrder.map((role) => (
            <form action={upsertProjectModelRouteAction} className="modelRouteForm" key={role}>
              <strong>{copy.modelsView.roleLabels[role]}</strong>
              <input name="role" type="hidden" value={role} />
              <select name="providerId" defaultValue={pageState.models.routes.find((route) => route.role === role)?.providerId ?? ""}>
                <option value="">{copy.modelsView.fallbackLabel}</option>
                {pageState.models.providers.filter((provider) => provider.enabled).map((provider) => (
                  <option value={provider.id} key={provider.id}>{provider.name}</option>
                ))}
              </select>
              <input
                aria-label={`${copy.modelsView.roleLabels[role]} ${copy.modelsView.modelLabel}`}
                name="model"
                defaultValue={pageState.models.routes.find((route) => route.role === role)?.model ?? pageState.models.resolvedPolicy[role].model}
              />
              <button type="submit">{copy.modelsView.saveRoute}</button>
            </form>
          ))}
        </section>

        <section className="modelsList" aria-labelledby="resolved-routes-title">
          <h2 id="resolved-routes-title">{copy.modelsView.resolvedTitle}</h2>
          {roleOrder.map((role) => (
            <div className="modelRow" key={role}>
              <strong>{copy.modelsView.roleLabels[role]}</strong>
              <span>{pageState.models.resolvedPolicy[role].provider}/{pageState.models.resolvedPolicy[role].model}</span>
            </div>
          ))}
        </section>
      </>
    ) : null}
  </section>
) : null}
```

Hide the composer except on workbench:

```tsx
{activeView === "workbench" ? (
  <form ...>
) : null}
```

Add `toModelFlowError()` next to `toSkillFlowError()`.

- [ ] **Step 5: Add CSS**

In `apps/web/src/app/globals.css`, reuse Skills styles by grouping selectors:

```css
.skillsView,
.modelsView {
  min-width: 0;
  display: grid;
  gap: 18px;
}

.skillsHeader,
.modelsHeader {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 18px;
}

.skillEditor,
.skillsList,
.modelEditor,
.modelsList {
  min-width: 0;
  display: grid;
  gap: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  padding: 16px;
}

.modelEditor input,
.modelEditor select,
.modelRouteForm input,
.modelRouteForm select {
  width: 100%;
  min-height: 38px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-raised);
  color: var(--text);
  padding: 0 10px;
}

.modelRow,
.modelRouteForm {
  min-width: 0;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: center;
  border-top: 1px solid var(--line);
  padding-top: 12px;
}

.modelRouteForm {
  grid-template-columns: minmax(110px, 0.8fr) minmax(150px, 1fr) minmax(160px, 1fr) auto;
}
```

Adjust existing mobile media query to stack `.modelRouteForm`.

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts apps/web/src/lib/i18n.test.ts
pnpm --filter @lp-agent/web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/i18n.ts apps/web/src/app/page.tsx apps/web/src/app/page.test.ts apps/web/src/app/globals.css
git commit -m "add project models view"
```

---

### Task 7: Final Verification And Documentation Index

**Files:**
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Update Superpowers README reading order**

Add this plan after the model routing spec:

```md
18. `plans/2026-05-13-project-model-routing-config.md`
   - Implementation plan for the Stage 2 Model Routing Configuration MVP.
   - Read this after the model routing spec when implementing repository-backed project model providers, role route configuration, runtime route resolution, and the Web Models view.
```

- [ ] **Step 2: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected:

- `pnpm test`: all Vitest files pass.
- `pnpm typecheck`: all workspace typechecks pass.
- `pnpm build`: Next production build passes.
- `git diff --check`: no whitespace errors.

- [ ] **Step 3: Start local Web smoke check**

Run:

```bash
pnpm dev
```

Open or curl:

```bash
curl --max-time 10 -s -o /tmp/lp-agent-models.html "http://localhost:3000/?view=models"
curl --max-time 10 -s -H "Accept-Language: zh-CN,zh;q=0.9" -o /tmp/lp-agent-models-zh.html "http://localhost:3000/?view=models"
```

Check:

```bash
node -e 'const fs=require("fs"); const en=fs.readFileSync("/tmp/lp-agent-models.html","utf8"); const zh=fs.readFileSync("/tmp/lp-agent-models-zh.html","utf8"); const checks=[["en models title", en.includes("Project models")], ["en no prompt composer", !en.includes("name=\"prompt\"")], ["zh models title", zh.includes("项目模型") || zh.includes("项目模型路由")]]; for (const [name, ok] of checks) console.log((ok ? "PASS" : "FAIL") + " " + name); if (checks.some(([, ok]) => !ok)) process.exit(1);'
```

Stop the dev server after the smoke check.

- [ ] **Step 4: Commit README update if needed**

If the README update was not committed with a previous task:

```bash
git add docs/superpowers/README.md
git commit -m "update model routing plan index"
```

- [ ] **Step 5: Request final review**

Use `superpowers:requesting-code-review` with:

```bash
git merge-base HEAD main
git rev-parse HEAD
```

Review scope:

- model provider and route repository contracts,
- JSON persistence,
- request-scoped model gateway routing,
- API lifecycle and route resolution,
- Web actions/store/UI/i18n,
- tests and smoke checks.

- [ ] **Step 6: Finish branch**

After review passes, use `superpowers:finishing-a-development-branch`.

---

## Verification Summary For Implementers

Run these before asking for merge:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

If `pnpm typecheck` fails immediately after switching branches because workspace links are stale, run:

```bash
pnpm install
pnpm typecheck
```

Do not touch unrelated untracked screenshot files in the repository root.
