# Real Chat Runtime and Skill Context v0 Implementation Plan

> **Status:** Implemented and archived. This plan records the Stage 27 execution history; do not treat it as the current next-stage checklist. Future agents should read `docs/project-roadmap.md` first and use Stage 28 as the current recommended next stage.
>
> **Execution record:** Completed with `superpowers:subagent-driven-development`, TDD per task, spec review and code quality review gates, targeted regression, `pnpm test`, and `pnpm typecheck`.

**Goal:** Stage 27 lets project-bound ordinary chat use a real provider-backed `assistant` runtime with bounded skill context while preserving deterministic defaults and Stage 26 streaming behavior.

**Architecture:** Add `assistant` as a first-class agent/model role across schema, model gateway, runtime, API orchestration, Web model routing, and chat streaming. The API service owns assistant chat runtime execution and prompt assembly; the Web store and route keep transport concerns separate and only stream safe UI events.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, Next.js route handlers, Zod, repository-backed API service, provider-neutral `@lp-agent/model-gateway`.

---

## Scope Guard

This plan implemented only Stage 27 from `docs/superpowers/specs/2026-05-21-real-chat-runtime-skill-context-design.md`.

It does not implement LP chain end-to-end, MCP execution, tool-call conversion, provider token streaming, real shell execution, deployment runner changes, usage/cost reporting, auth/RBAC, object storage, or Postgres production rollout.

## File Structure

- Modify `packages/lp-schema/src/index.ts` and `packages/lp-schema/src/index.test.ts` to include `assistant` in `AgentRoleSchema`.
- Modify `packages/model-gateway/src/index.ts` and `packages/model-gateway/src/index.test.ts` so `assistant` is part of `AgentRole`, `agentRoles`, default model policy, cloning, audit, and provider-backed route validation.
- Modify `packages/runtime-adapters/src/index.ts` and `packages/runtime-adapters/src/index.test.ts` so runtime events, default context, policy cloning, and `LocalAgentRuntimeAdapter` support `assistant` and `run.cancelled`.
- Modify `packages/api/src/context-assembler.ts` and tests that validate Context Pack schema so `assistant` model routes are part of the policy schema and trace.
- Modify `packages/api/src/run-orchestrator.ts` and `packages/api/src/run-orchestrator.test.ts` so `runAgentStep()` accepts `assistant`, persists assistant runs, and supports `run.cancelled`.
- Create `packages/api/src/assistant-chat.ts` and `packages/api/src/assistant-chat.test.ts` for bounded assistant prompt assembly and safe context summary mapping.
- Modify `packages/api/src/index.ts` and `packages/api/src/services.test.ts` to add `assistantRuntime`, project-bound `runAssistantChat()`, assistant model route resolution, assistant skill context injection, and fail-closed real-runtime behavior.
- Modify `apps/web/src/lib/chat-stream.ts` and `apps/web/src/lib/chat-stream.test.ts` to add `context.summary` and `cancelled` run status events.
- Modify `apps/web/src/lib/workbench-store.ts` and `apps/web/src/lib/workbench-store.test.ts` to call `runAssistantChat()` for project-bound ordinary chat and keep projectless chat deterministic.
- Modify `apps/web/src/app/api/chat/stream/route.ts` and `apps/web/src/app/api/chat/stream/route.test.ts` to emit context summary and safe runtime failure events.
- Modify `apps/web/src/app/streaming-workbench-state.ts`, `apps/web/src/app/streaming-workbench-state.test.ts`, `apps/web/src/app/streaming-workbench.tsx`, and `apps/web/src/app/streaming-workbench.test.ts` to render project/skill context summary during streaming.
- Modify `apps/web/src/app/actions.ts`, `apps/web/src/app/actions.test.ts`, `apps/web/src/app/page.tsx`, `apps/web/src/app/page.test.ts`, `apps/web/src/lib/i18n.ts`, and `apps/web/src/lib/i18n.test.ts` so Models UI can configure `assistant` routes and the workbench top bar shows assistant route status.
- Modify `docs/superpowers/README.md` and `docs/project-roadmap.md` at the end of the implementation to mark Stage 27 complete and keep the reading order accurate.

## Task 1: Add `assistant` Role to Shared Schema and Model Gateway

**Files:**
- Modify: `packages/lp-schema/src/index.ts`
- Modify: `packages/lp-schema/src/index.test.ts`
- Modify: `packages/model-gateway/src/index.ts`
- Modify: `packages/model-gateway/src/index.test.ts`

- [x] **Step 1: Write failing schema and gateway tests**

Add this test to `packages/lp-schema/src/index.test.ts`:

```ts
import { AgentRoleSchema } from "./index";

it("accepts assistant as an agent role", () => {
  expect(AgentRoleSchema.parse("assistant")).toBe("assistant");
  expect(() => AgentRoleSchema.parse("chat")).toThrow();
});
```

Update the first two tests in `packages/model-gateway/src/index.test.ts`:

```ts
it("exports a frozen agent role list", () => {
  expect(agentRoles).toEqual(["assistant", "planner", "builder", "reviewer", "deployer"]);
  expect(Object.isFrozen(agentRoles)).toBe(true);
});

it("routes agent roles through configured providers", async () => {
  const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
  const cases: Array<{ role: AgentRole; provider: string; model: string }> = [
    { role: "assistant", provider: "mock-openai", model: "assistant-model" },
    { role: "planner", provider: "mock-openai", model: "planning-model" },
    { role: "builder", provider: "mock-anthropic", model: "code-model" },
    { role: "reviewer", provider: "mock-openai", model: "review-model" },
    { role: "deployer", provider: "mock-local", model: "tool-model" }
  ];

  for (const route of cases) {
    const result = await gateway.complete({
      role: route.role,
      prompt: "Create a landing page brief",
      projectId: "project_1"
    });

    expect(result.provider).toBe(route.provider);
    expect(result.model).toBe(route.model);
    expect(result.text).toContain(`${route.role} response`);
  }
});
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run packages/lp-schema/src/index.test.ts packages/model-gateway/src/index.test.ts
```

Expected: failures mention invalid enum value for `assistant` and role list mismatch.

- [x] **Step 3: Implement role and default policy**

In `packages/lp-schema/src/index.ts`, change `AgentRoleSchema`:

```ts
export const AgentRoleSchema = z.enum([
  "assistant",
  "planner",
  "builder",
  "reviewer",
  "deployer"
]);
```

In `packages/model-gateway/src/index.ts`, change role definitions:

```ts
export type AgentRole = "assistant" | "planner" | "builder" | "reviewer" | "deployer";

export const agentRoles = Object.freeze([
  "assistant",
  "planner",
  "builder",
  "reviewer",
  "deployer"
] as const) satisfies readonly AgentRole[];

export const createDefaultModelPolicy = (): ModelRoutingPolicy => ({
  assistant: { provider: "mock-openai", model: "assistant-model" },
  planner: { provider: "mock-openai", model: "planning-model" },
  builder: { provider: "mock-anthropic", model: "code-model" },
  reviewer: { provider: "mock-openai", model: "review-model" },
  deployer: { provider: "mock-local", model: "tool-model" }
});
```

Keep `clonePolicy()` based on `agentRoles`; that loop will include `assistant` after the role list change.

- [x] **Step 4: Update policy literals in model-gateway tests**

In `packages/model-gateway/src/index.test.ts`, any explicit `ModelRoutingPolicy` literal must include:

```ts
assistant: { provider: "mock-openai", model: "assistant-model" },
```

Use this order in literals:

```ts
{
  assistant: { provider: "mock-openai", model: "assistant-model" },
  planner: { provider: "mock-openai", model: "planning-model" },
  builder: { provider: "mock-anthropic", model: "code-model" },
  reviewer: { provider: "mock-openai", model: "review-model" },
  deployer: { provider: "mock-local", model: "tool-model" }
}
```

- [x] **Step 5: Run focused tests**

Run:

```bash
pnpm exec vitest run packages/lp-schema/src/index.test.ts packages/model-gateway/src/index.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/lp-schema/src/index.ts packages/lp-schema/src/index.test.ts packages/model-gateway/src/index.ts packages/model-gateway/src/index.test.ts
git commit -m "add assistant model role"
```

## Task 2: Update Runtime Adapter and Context Policy Cloning

**Files:**
- Modify: `packages/runtime-adapters/src/index.ts`
- Modify: `packages/runtime-adapters/src/index.test.ts`

- [x] **Step 1: Write failing runtime tests**

Add these tests to `packages/runtime-adapters/src/index.test.ts`:

```ts
it("runs an assistant flow without LP artifacts or review findings", async () => {
  const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
  const runtime = new LocalAgentRuntimeAdapter(gateway);

  const result = await runtime.run({
    runId: "run_assistant_task_1",
    projectId: "project_1",
    role: "assistant",
    input: { prompt: "Explain this project" },
    context: createDefaultRuntimeContext()
  });

  expect(result.state).toBe("completed");
  expect(result.modelOutputText).toBe("assistant response from mock-openai/assistant-model");
  expect(result.artifacts).toBeUndefined();
  expect(result.findings).toBeUndefined();
  expect(result.events.map((event) => event.type)).toEqual([
    "run.started",
    "runtime.context.loaded",
    "model.completed",
    "run.completed"
  ]);
});

it("clones assistant model routing policy into runtime model calls", async () => {
  const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
  const runtime = new LocalAgentRuntimeAdapter(gateway);

  await runtime.run({
    runId: "run_assistant_routing",
    projectId: "project_1",
    role: "assistant",
    input: { prompt: "Answer with project context" },
    context: {
      ...createDefaultRuntimeContext(),
      modelRoutingPolicy: {
        ...createDefaultModelPolicy(),
        assistant: { provider: "project-openai", model: "gpt-5.4" }
      }
    }
  });

  expect(gateway.getAuditLog()[0]).toMatchObject({
    role: "assistant",
    provider: "project-openai",
    model: "gpt-5.4"
  });
});

it("types assistant cancellation runtime events", () => {
  const event: RuntimeEvent = {
    type: "run.cancelled",
    message: "assistant run cancelled",
    runId: "run_assistant_1",
    role: "assistant",
    state: "cancelled"
  };

  expect(event.state).toBe("cancelled");
});
```

- [x] **Step 2: Run runtime tests to verify failure**

Run:

```bash
pnpm exec vitest run packages/runtime-adapters/src/index.test.ts
```

Expected: TypeScript or test failures mention missing `assistant` route in cloned policy and missing `run.cancelled` event type.

- [x] **Step 3: Implement runtime event and policy clone**

In `packages/runtime-adapters/src/index.ts`, add `run.cancelled` to `RuntimeEvent`:

```ts
  | {
      type: "run.cancelled";
      message: string;
      runId?: string;
      role?: AgentRole;
      state: "cancelled";
    };
```

Update `cloneModelRoutingPolicy()`:

```ts
function cloneModelRoutingPolicy(policy: ModelRoutingPolicy): ModelRoutingPolicy {
  return {
    assistant: { ...policy.assistant },
    planner: { ...policy.planner },
    builder: { ...policy.builder },
    reviewer: { ...policy.reviewer },
    deployer: { ...policy.deployer }
  };
}
```

Update explicit model policy literals in `packages/runtime-adapters/src/index.test.ts` to include:

```ts
assistant: { provider: "mock-openai", model: "assistant-model" },
```

- [x] **Step 4: Run runtime tests**

Run:

```bash
pnpm exec vitest run packages/runtime-adapters/src/index.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/runtime-adapters/src/index.ts packages/runtime-adapters/src/index.test.ts
git commit -m "support assistant runtime role"
```

## Task 3: Extend Context Assembly and Run Orchestration

**Files:**
- Modify: `packages/api/src/context-assembler.ts`
- Modify: `packages/api/src/run-orchestrator.ts`
- Modify: `packages/api/src/run-orchestrator.test.ts`
- Modify: `packages/api/src/services.test.ts`

- [x] **Step 1: Write failing run-orchestrator test**

Add this test to `packages/api/src/run-orchestrator.test.ts`:

```ts
it("persists assistant cancelled runs and cancellation events", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  await repositories.projects.save({
    id: "project_1",
    name: "Project",
    createdAt: "2026-05-21T00:00:00.000Z"
  });
  const runtime: AgentRuntimeAdapter = {
    async run(request) {
      return {
        runId: request.runId,
        projectId: request.projectId,
        role: request.role,
        state: "cancelled",
        events: [
          {
            type: "run.started",
            message: "assistant run started",
            runId: request.runId,
            role: request.role
          },
          {
            type: "run.cancelled",
            message: "assistant run cancelled",
            runId: request.runId,
            role: request.role,
            state: "cancelled"
          }
        ]
      };
    }
  };
  const service = {
    async createRuntimeContextForRole() {
      return createDefaultRuntimeContext();
    }
  };

  const result = await runAgentStep({
    repositories,
    service,
    runtime,
    runId: "run_assistant_task_1",
    projectId: "project_1",
    role: "assistant",
    input: { prompt: "Explain this project" },
    now: () => new Date("2026-05-21T00:00:00.000Z")
  });

  expect(result.run.state).toBe("cancelled");
  const events = await repositories.runEvents.listForRun("run_assistant_task_1");
  expect(events.map((event) => event.type)).toEqual(["run.started", "run.cancelled"]);
});
```

- [x] **Step 2: Write failing context policy test**

In `packages/api/src/services.test.ts`, add this assertion to the existing model route resolution test block or add a new test:

```ts
it("resolves default assistant model route for projects", async () => {
  const service = new DemoWorkbenchService({ now: fixedClock() });
  const project = await service.createProject({ name: "Project" });

  const policy = await service.resolveModelRoutingPolicyForProject(project.id);

  expect(policy.assistant).toEqual({
    provider: "mock-openai",
    model: "assistant-model"
  });
});
```

- [x] **Step 3: Run focused API tests to verify failure**

Run:

```bash
pnpm exec vitest run packages/api/src/run-orchestrator.test.ts packages/api/src/services.test.ts
```

Expected: failures mention `assistant` not assignable in `runAgentStep()` and missing `assistant` in Context Pack model routing policy schema.

- [x] **Step 4: Implement role types and context schema**

In `packages/api/src/run-orchestrator.ts`, change role type fields to `AgentRole`:

```ts
import type { AgentRole } from "@lp-agent/model-gateway";

export interface RunAgentStepInput {
  repositories: WorkbenchRepositories;
  service: Pick<DemoWorkbenchService, "createRuntimeContextForRole">;
  runtime: AgentRuntimeAdapter;
  runId: string;
  projectId: string;
  taskId?: string;
  pageVersionId?: string;
  role: AgentRole;
  input: ContextPack["input"];
  now?: () => Date;
  finalizeResult?: RunAgentStepFinalizer;
  beforeRuntime?: RunAgentStepBeforeRuntime;
}
```

Keep `toRunRecordState()` returning the runtime state directly except `queued`:

```ts
function toRunRecordState(state: RuntimeRunResult["state"]): RunRecord["state"] {
  if (state === "queued") {
    return "running";
  }
  return state;
}
```

In `packages/api/src/context-assembler.ts`, update `ModelRoutingPolicySchema`:

```ts
const ModelRoutingPolicySchema = z.object({
  assistant: ModelRouteSchema,
  planner: ModelRouteSchema,
  builder: ModelRouteSchema,
  reviewer: ModelRouteSchema,
  deployer: ModelRouteSchema
});
```

- [x] **Step 5: Update default policy assembly in API service**

In `packages/api/src/index.ts`, update `resolveModelRoutingPolicyForProject()`:

```ts
const resolved: ModelRoutingPolicy = {
  assistant: { ...defaultPolicy.assistant },
  planner: { ...defaultPolicy.planner },
  builder: { ...defaultPolicy.builder },
  reviewer: { ...defaultPolicy.reviewer },
  deployer: { ...defaultPolicy.deployer }
};
```

Change `createRuntimeContext()` role type:

```ts
private async createRuntimeContext(
  projectId: string,
  role: AgentRole,
  pageVersionId?: string,
  approvalState: ApprovalState = "not_required"
): Promise<RuntimeRunContext> {
```

Keep assistant MCP context empty:

```ts
const [skillVersions, modelRoutingPolicy, artifactWorkspace] = await Promise.all([
  this.listRuntimeSkillsForProject(projectId),
  this.resolveModelRoutingPolicyForProject(projectId),
  this.createRuntimeArtifactWorkspaceContext(projectId, pageVersionId)
]);
const mcpTools =
  role === "assistant"
    ? []
    : await this.resolveVisibleMCPTools({ projectId, role, skillVersions });
```

- [x] **Step 6: Update API test policy literals**

In `packages/api/src/*.test.ts`, every explicit `resolvedPolicy` or `ModelRoutingPolicy` literal must include:

```ts
assistant: { provider: "mock-openai", model: "assistant-model" },
```

For `visibleToolsByRole` records, add:

```ts
assistant: [],
```

Run this search after edits:

```bash
rg -n "resolvedPolicy: \\{|visibleToolsByRole: \\{|ModelRoutingPolicy" packages/api/src apps/web/src
```

Expected: all policy and visible-tool literals include `assistant`.

- [x] **Step 7: Run API tests**

Run:

```bash
pnpm exec vitest run packages/api/src/run-orchestrator.test.ts packages/api/src/services.test.ts packages/api/src/context-memory.test.ts
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add packages/api/src/context-assembler.ts packages/api/src/run-orchestrator.ts packages/api/src/run-orchestrator.test.ts packages/api/src/services.test.ts
git commit -m "extend api orchestration for assistant role"
```

## Task 4: Add Assistant Prompt Builder and API Runtime Method

**Files:**
- Create: `packages/api/src/assistant-chat.ts`
- Create: `packages/api/src/assistant-chat.test.ts`
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/services.test.ts`

- [x] **Step 1: Write prompt builder tests**

Create `packages/api/src/assistant-chat.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createAssistantChatPrompt,
  createAssistantContextSummary
} from "./assistant-chat";

describe("assistant chat prompt", () => {
  it("builds bounded prompt context from project skills and memory", () => {
    const prompt = createAssistantChatPrompt({
      userPrompt: "How should this LP speak to buyers?",
      project: { id: "project_1", name: "Spring Campaign" },
      context: {
        skills: [
          {
            id: "skill_brand",
            name: "Brand Voice",
            version: "1.0.0",
            scope: "project",
            permissions: ["brief:read"],
            entrypoints: ["voice.md"],
            content: "Use a concise, confident voice. ".repeat(80),
            contentType: "text/markdown"
          }
        ],
        mcpTools: [],
        approval: { state: "not_required" },
        artifactWorkspace: { mode: "memory", writableFiles: ["index.html"] },
        memory: {
          messages: [
            {
              id: "message_1",
              taskId: "task_1",
              role: "user",
              preview: "Earlier buyer question",
              createdAt: "2026-05-21T00:00:00.000Z",
              score: 10
            }
          ],
          runs: [],
          tools: [],
          artifacts: [],
          retrieval: {
            query: "How should this LP speak to buyers?",
            strategy: "deterministic_recent_project_context",
            selected: ["message_1"],
            omitted: []
          }
        }
      },
      trace: { injected: ["skills:1"], omitted: [] }
    });

    expect(prompt).toContain("Project: Spring Campaign");
    expect(prompt).toContain("Skill: Brand Voice@1.0.0");
    expect(prompt).toContain("Earlier buyer question");
    expect(prompt).toContain("How should this LP speak to buyers?");
    expect(prompt.length).toBeLessThan(6000);
  });

  it("creates a safe context summary without raw skill content", () => {
    const summary = createAssistantContextSummary({
      project: { id: "project_1", name: "Spring Campaign" },
      runtimeMode: "real",
      skills: [
        {
          id: "skill_brand",
          name: "Brand Voice",
          version: "1.0.0",
          content: "RAW_SKILL_CONTENT_SECRET"
        }
      ]
    });

    expect(summary).toEqual({
      projectId: "project_1",
      projectName: "Spring Campaign",
      runtimeMode: "real",
      skillCount: 1,
      skills: [{ id: "skill_brand", name: "Brand Voice", version: "1.0.0" }]
    });
    expect(JSON.stringify(summary)).not.toContain("RAW_SKILL_CONTENT_SECRET");
  });
});
```

- [x] **Step 2: Run prompt builder tests to verify failure**

Run:

```bash
pnpm exec vitest run packages/api/src/assistant-chat.test.ts
```

Expected: module not found for `./assistant-chat`.

- [x] **Step 3: Implement assistant prompt builder**

Create `packages/api/src/assistant-chat.ts`:

```ts
import type { ProjectRecord } from "@lp-agent/db";
import type { RuntimeRunContext, RuntimeSkillContext } from "@lp-agent/runtime-adapters";
import type { ContextAssemblyTrace } from "./context-assembler";

const maxSkillContentChars = 1200;
const maxMemoryMessages = 6;
const maxPromptChars = 12000;

export interface AssistantContextSummarySkill {
  id: string;
  name: string;
  version: string;
  content?: string;
}

export interface AssistantContextSummary {
  projectId: string;
  projectName: string;
  runtimeMode: "deterministic" | "real";
  skillCount: number;
  skills: Array<{ id: string; name: string; version: string }>;
}

export function createAssistantContextSummary(input: {
  project: Pick<ProjectRecord, "id" | "name">;
  runtimeMode: AssistantContextSummary["runtimeMode"];
  skills: AssistantContextSummarySkill[];
}): AssistantContextSummary {
  return {
    projectId: input.project.id,
    projectName: input.project.name,
    runtimeMode: input.runtimeMode,
    skillCount: input.skills.length,
    skills: input.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      version: skill.version
    }))
  };
}

export function createAssistantChatPrompt(input: {
  userPrompt: string;
  project: Pick<ProjectRecord, "id" | "name">;
  context: RuntimeRunContext;
  trace: ContextAssemblyTrace;
}): string {
  const sections = [
    "You are the ordinary chat assistant for LP Engineering Team Agent.",
    "Answer the user directly using the project context below.",
    "Do not claim that you executed MCP tools, shell commands, deployments, or artifact edits.",
    "If the user asks to create or modify an LP, explain the next step without inventing generated files.",
    `Project: ${input.project.name} (${input.project.id})`,
    formatSkills(input.context.skills),
    formatMemory(input.context),
    `Context trace: injected=${input.trace.injected.join(", ") || "none"}; omitted=${input.trace.omitted.join(", ") || "none"}`,
    `User message:\n${input.userPrompt.trim()}`
  ];

  return sections.join("\n\n").slice(0, maxPromptChars);
}

function formatSkills(skills: RuntimeSkillContext[]): string {
  if (skills.length === 0) {
    return "Project skills: none";
  }

  return [
    "Project skills:",
    ...skills.map((skill) =>
      [
        `Skill: ${skill.name}@${skill.version}`,
        `Scope: ${skill.scope}`,
        `Entrypoints: ${skill.entrypoints.join(", ") || "none"}`,
        `Permissions: ${skill.permissions.join(", ") || "none"}`,
        `Content excerpt: ${skill.content.slice(0, maxSkillContentChars)}`
      ].join("\n")
    )
  ].join("\n\n");
}

function formatMemory(context: RuntimeRunContext): string {
  const memory = context.memory;
  if (!memory || memory.messages.length === 0) {
    return "Relevant memory: none";
  }

  return [
    "Relevant memory:",
    ...memory.messages.slice(0, maxMemoryMessages).map((message) =>
      `${message.role}: ${message.preview}`
    )
  ].join("\n");
}
```

- [x] **Step 4: Write failing service tests**

In the `StaticRuntime` and `MutableRuntime` helpers near the bottom of `packages/api/src/services.test.ts`, include model text in returned runtime results:

```ts
modelOutputText: this.result.modelOutputText
```

Add tests to `packages/api/src/services.test.ts`:

```ts
it("runs assistant chat with project-bound published skills", async () => {
  const assistantRuntime = new RecordingRuntime({
    state: "completed",
    modelOutputText: "Use a confident buyer-focused tone."
  });
  const service = new DemoWorkbenchService({
    assistantRuntime,
    now: fixedClock()
  });
  const project = await service.createProject({ name: "Spring Campaign" });
  const draft = await service.createSkillDraft({
    manifestJson: JSON.stringify(brandSkillManifest()),
    content: "# Brand Voice\nUse a confident buyer-focused tone.",
    contentType: "text/markdown"
  });
  await service.validateSkillVersion({ skillVersionId: draft.version.id });
  const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });
  await service.bindSkillVersionToProject({
    projectId: project.id,
    skillVersionId: published.id
  });

  const result = await service.runAssistantChat({
    projectId: project.id,
    taskId: "task_1",
    prompt: "How should we answer buyers?"
  });

  expect(result).toMatchObject({
    ok: true,
    content: "Use a confident buyer-focused tone.",
    contextSummary: {
      projectId: project.id,
      projectName: "Spring Campaign",
      runtimeMode: "deterministic",
      skillCount: 1,
      skills: [{ id: "skill_brand", name: "Brand LP", version: "0.1.0" }]
    }
  });
  expect(assistantRuntime.requests[0]).toMatchObject({
    role: "assistant",
    projectId: project.id,
    taskId: "task_1"
  });
  expect(assistantRuntime.requests[0]?.input.prompt).toContain("# Brand Voice");
});

it("returns safe assistant chat failure without raw provider details", async () => {
  const service = new DemoWorkbenchService({
    env: { REAL_MODEL_RUNTIME: "1" },
    now: fixedClock()
  });
  const project = await service.createProject({ name: "Project" });

  const result = await service.runAssistantChat({
    projectId: project.id,
    taskId: "task_1",
    prompt: "Hello"
  });

  expect(result).toMatchObject({
    ok: false,
    error: "generation_failed"
  });
  expect(JSON.stringify(result)).not.toContain("model_provider_mock_route_disabled");
});
```

- [x] **Step 5: Run service tests to verify failure**

Run:

```bash
pnpm exec vitest run packages/api/src/assistant-chat.test.ts packages/api/src/services.test.ts
```

Expected: failure for missing `assistantRuntime` option and `runAssistantChat()`.

- [x] **Step 6: Implement `assistantRuntime` and `runAssistantChat()`**

In `packages/api/src/index.ts`, extend service options and class fields:

```ts
assistantRuntime?: AgentRuntimeAdapter;
```

```ts
private readonly assistantRuntime: AgentRuntimeAdapter;
```

In the constructor:

```ts
this.assistantRuntime = options.assistantRuntime ?? createLocalRuntimeAdapter(runtimeFactoryInput);
```

Add exported result types near other API input/output interfaces:

```ts
export interface RunAssistantChatInput {
  projectId: string;
  taskId?: string;
  prompt: string;
  runId?: string;
}

export type RunAssistantChatResult =
  | {
      ok: true;
      content: string;
      runId: string;
      contextSummary: AssistantContextSummary;
    }
  | {
      ok: false;
      error: "project_not_found" | "generation_failed";
      runId?: string;
      contextSummary?: AssistantContextSummary;
    };
```

Import assistant helpers:

```ts
import {
  createAssistantChatPrompt,
  createAssistantContextSummary,
  type AssistantContextSummary
} from "./assistant-chat";
```

Add `runAssistantChat()` to `DemoWorkbenchService`:

```ts
async runAssistantChat(input: RunAssistantChatInput): Promise<RunAssistantChatResult> {
  let project: ProjectRecord;
  try {
    project = await this.getProjectOrThrow(input.projectId);
  } catch {
    return { ok: false, error: "project_not_found" };
  }

  const contextPack = await assembleContextPack({
    repositories: this.repositories,
    service: this,
    projectId: project.id,
    taskId: input.taskId,
    role: "assistant",
    input: { prompt: input.prompt },
    now: this.now
  });
  const contextSummary = createAssistantContextSummary({
    project,
    runtimeMode: this.env.REAL_MODEL_RUNTIME === "1" ? "real" : "deterministic",
    skills: contextPack.runtimeContext.skills
  });
  const runId =
    input.runId ??
    (await reserveRepositoryId(this.repositories, "run_assistant", async () =>
      (await this.repositories.runs.listForProject(project.id)).map((run) => run.id)
    ));

  try {
    const { result } = await runAgentStep({
      repositories: this.repositories,
      service: this,
      runtime: this.assistantRuntime,
      runId,
      projectId: project.id,
      taskId: input.taskId,
      role: "assistant",
      input: {
        prompt: createAssistantChatPrompt({
          userPrompt: input.prompt,
          project,
          context: contextPack.runtimeContext,
          trace: contextPack.trace
        })
      },
      now: this.now
    });

    if (result.state !== "completed" || !result.modelOutputText?.trim()) {
      return { ok: false, error: "generation_failed", runId, contextSummary };
    }

    return {
      ok: true,
      content: result.modelOutputText,
      runId,
      contextSummary
    };
  } catch {
    return { ok: false, error: "generation_failed", runId, contextSummary };
  } finally {
    if (!input.runId) {
      releaseRepositoryId(this.repositories, runId);
    }
  }
}
```

- [x] **Step 7: Run API tests**

Run:

```bash
pnpm exec vitest run packages/api/src/assistant-chat.test.ts packages/api/src/services.test.ts
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add packages/api/src/assistant-chat.ts packages/api/src/assistant-chat.test.ts packages/api/src/index.ts packages/api/src/services.test.ts
git commit -m "add assistant chat runtime service"
```

## Task 5: Extend Chat Stream Contract and Web Store

**Files:**
- Modify: `apps/web/src/lib/chat-stream.ts`
- Modify: `apps/web/src/lib/chat-stream.test.ts`
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`

- [x] **Step 1: Write failing chat stream tests**

Add tests to `apps/web/src/lib/chat-stream.test.ts`:

```ts
it("decodes safe context summary events", () => {
  const decoded = decodeChatStreamLines(
    '{"type":"context.summary","taskId":"task_1","projectId":"project_1","projectName":"Spring Campaign","runtimeMode":"real","skillCount":1,"skills":[{"id":"skill_brand","name":"Brand Voice","version":"1.0.0"}]}\n'
  );

  expect(decoded.events).toEqual([
    {
      type: "context.summary",
      taskId: "task_1",
      projectId: "project_1",
      projectName: "Spring Campaign",
      runtimeMode: "real",
      skillCount: 1,
      skills: [{ id: "skill_brand", name: "Brand Voice", version: "1.0.0" }]
    }
  ]);
});

it("decodes cancelled run status events", () => {
  const decoded = decodeChatStreamLines(
    '{"type":"run.status","taskId":"task_1","state":"cancelled","label":"Cancelled"}\n'
  );

  expect(decoded.events[0]).toMatchObject({
    type: "run.status",
    state: "cancelled"
  });
});
```

- [x] **Step 2: Write failing store tests**

Add tests to `apps/web/src/lib/workbench-store.test.ts`:

```ts
it("streams project-bound assistant runtime content with safe context summary", async () => {
  const store = createWebWorkbenchStore();
  const project = await store.createProject({ name: "Spring Campaign" });

  const started = await store.startStreamingChatPrompt({
    projectId: project.id,
    taskId: null,
    prompt: "How should this page sound?"
  });

  expect(started).toMatchObject({
    ok: true,
    projectId: project.id,
    contextSummary: {
      projectId: project.id,
      projectName: "Spring Campaign",
      runtimeMode: "deterministic",
      skillCount: 0,
      skills: []
    }
  });
  if (!started.ok) {
    throw new Error("Expected streaming chat start");
  }
  expect(started.assistantContent).toContain("assistant response");
});

it("keeps projectless streaming chat deterministic with no context summary skills", async () => {
  const store = createWebWorkbenchStore();

  const started = await store.startStreamingChatPrompt({
    projectId: null,
    taskId: null,
    prompt: "Hello"
  });

  expect(started).toMatchObject({
    ok: true,
    contextSummary: {
      runtimeMode: "deterministic",
      skillCount: 0,
      skills: []
    }
  });
});
```

- [x] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/chat-stream.test.ts apps/web/src/lib/workbench-store.test.ts
```

Expected: failures mention unknown `context.summary` event and missing `contextSummary` in streaming result.

- [x] **Step 4: Implement stream event type and parser**

In `apps/web/src/lib/chat-stream.ts`, extend `ChatStreamEvent`:

```ts
  | {
      type: "context.summary";
      taskId: string;
      projectId?: string;
      projectName?: string;
      runtimeMode: "deterministic" | "real";
      skillCount: number;
      skills: Array<{ id: string; name: string; version: string }>;
    }
```

Extend run status state:

```ts
state: "queued" | "running" | "completed" | "failed" | "cancelled";
```

Add helpers:

```ts
function isRuntimeMode(value: unknown): value is "deterministic" | "real" {
  return value === "deterministic" || value === "real";
}

function isContextSummarySkill(value: unknown): value is { id: string; name: string; version: string } {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isString(value.version)
  );
}
```

Add the switch case:

```ts
case "context.summary":
  return (
    isString(value.taskId) &&
    (value.projectId === undefined || isString(value.projectId)) &&
    (value.projectName === undefined || isString(value.projectName)) &&
    isRuntimeMode(value.runtimeMode) &&
    typeof value.skillCount === "number" &&
    Number.isInteger(value.skillCount) &&
    value.skillCount >= 0 &&
    Array.isArray(value.skills) &&
    value.skills.every(isContextSummarySkill)
  );
```

- [x] **Step 5: Implement store context summary wiring**

In `apps/web/src/lib/workbench-store.ts`, extend `StreamingChatStartResult` success shape:

```ts
interface StreamingChatContextSummary {
  projectId?: string;
  projectName?: string;
  runtimeMode: "deterministic" | "real";
  skillCount: number;
  skills: Array<{ id: string; name: string; version: string }>;
}

contextSummary: {
  projectId?: string;
  projectName?: string;
  runtimeMode: "deterministic" | "real";
  skillCount: number;
  skills: Array<{ id: string; name: string; version: string }>;
};
```

In `startStreamingChatPrompt()`, replace fixed assistant content selection with:

```ts
let assistantContent = "I created a task thread and can continue from here.";
let contextSummary: StreamingChatContextSummary = {
  ...(requestedProjectId ? { projectId: requestedProjectId } : {}),
  runtimeMode: "deterministic" as const,
  skillCount: 0,
  skills: []
};

if (requestedProjectId) {
  const assistant = await service.runAssistantChat({
    projectId: requestedProjectId,
    taskId: requestedTaskId,
    prompt: prompt.value
  });
  if (!assistant.ok) {
    return { ok: false, error: assistant.error };
  }
  assistantContent = assistant.content;
  contextSummary = assistant.contextSummary;
}
```

Keep projectless chat on the existing deterministic sentence.

- [x] **Step 6: Run focused tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/chat-stream.test.ts apps/web/src/lib/workbench-store.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add apps/web/src/lib/chat-stream.ts apps/web/src/lib/chat-stream.test.ts apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts
git commit -m "wire assistant context into chat stream"
```

## Task 6: Emit Context Summary from Chat Route and Render It in Streaming UI

**Files:**
- Modify: `apps/web/src/app/api/chat/stream/route.ts`
- Modify: `apps/web/src/app/api/chat/stream/route.test.ts`
- Modify: `apps/web/src/app/streaming-workbench-state.ts`
- Modify: `apps/web/src/app/streaming-workbench-state.test.ts`
- Modify: `apps/web/src/app/streaming-workbench.tsx`
- Modify: `apps/web/src/app/streaming-workbench.test.ts`

- [x] **Step 1: Write failing route test**

In `apps/web/src/app/api/chat/stream/route.test.ts`, add to the successful streaming test setup:

```ts
contextSummary: {
  projectId: "project_1",
  projectName: "Spring Campaign",
  runtimeMode: "real",
  skillCount: 1,
  skills: [{ id: "skill_brand", name: "Brand Voice", version: "1.0.0" }]
}
```

Then assert event order contains `context.summary` before deltas:

```ts
expect(events.map((event) => event.type)).toEqual([
  "task.created",
  "context.summary",
  "run.status",
  "assistant.delta",
  "assistant.completed",
  "run.status"
]);
expect(events[1]).toMatchObject({
  type: "context.summary",
  projectName: "Spring Campaign",
  skillCount: 1
});
```

- [x] **Step 2: Write failing streaming state test**

Add to `apps/web/src/app/streaming-workbench-state.test.ts`:

```ts
it("stores safe context summary from stream events", () => {
  const state = reduceStreamingWorkbenchEvent(createInitialStreamingWorkbenchState(), {
    type: "context.summary",
    taskId: "task_1",
    projectId: "project_1",
    projectName: "Spring Campaign",
    runtimeMode: "real",
    skillCount: 1,
    skills: [{ id: "skill_brand", name: "Brand Voice", version: "1.0.0" }]
  });

  expect(state.contextSummary).toEqual({
    taskId: "task_1",
    projectId: "project_1",
    projectName: "Spring Campaign",
    runtimeMode: "real",
    skillCount: 1,
    skills: [{ id: "skill_brand", name: "Brand Voice", version: "1.0.0" }]
  });
});
```

- [x] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm exec vitest run apps/web/src/app/api/chat/stream/route.test.ts apps/web/src/app/streaming-workbench-state.test.ts
```

Expected: failures mention missing context summary stream event and missing `contextSummary` state.

- [x] **Step 4: Emit `context.summary` from route**

In `apps/web/src/app/api/chat/stream/route.ts`, after `task.created`:

```ts
enqueue({
  type: "context.summary",
  taskId: started.taskId,
  ...started.contextSummary
});
```

For failed project-bound assistant generation, keep existing safe error mapping:

```ts
const errorCode = toChatStreamErrorCode(started.error);
return createSingleEventResponse({
  type: "error",
  code: errorCode,
  message: getSafeErrorMessage(errorCode)
});
```

- [x] **Step 5: Store and render context summary state**

In `apps/web/src/app/streaming-workbench-state.ts`, add type and state field:

```ts
export interface StreamingContextSummary {
  taskId: string;
  projectId?: string;
  projectName?: string;
  runtimeMode: "deterministic" | "real";
  skillCount: number;
  skills: Array<{ id: string; name: string; version: string }>;
}
```

Add to `StreamingWorkbenchState`:

```ts
contextSummary: StreamingContextSummary | undefined;
```

Initialize with:

```ts
contextSummary: undefined
```

Handle event:

```ts
case "context.summary":
  return {
    ...state,
    taskId: event.taskId,
    contextSummary: {
      taskId: event.taskId,
      ...(event.projectId ? { projectId: event.projectId } : {}),
      ...(event.projectName ? { projectName: event.projectName } : {}),
      runtimeMode: event.runtimeMode,
      skillCount: event.skillCount,
      skills: event.skills.map((skill) => ({ ...skill }))
    }
  };
```

In `apps/web/src/app/streaming-workbench.tsx`, render summary inside the streaming assistant message:

```tsx
{state.contextSummary ? (
  <p className="streamingContext">
    {[
      state.contextSummary.projectName
        ? `Project: ${state.contextSummary.projectName}`
        : "No project context",
      `Skills: ${state.contextSummary.skillCount}`,
      `Runtime: ${state.contextSummary.runtimeMode}`
    ].join(" · ")}
  </p>
) : null}
```

- [x] **Step 6: Add UI render test**

In `apps/web/src/app/streaming-workbench.test.ts`, add a fetch stream fixture containing:

```ts
`${JSON.stringify({
  type: "context.summary",
  taskId: "task_1",
  projectId: "project_1",
  projectName: "Spring Campaign",
  runtimeMode: "real",
  skillCount: 1,
  skills: [{ id: "skill_brand", name: "Brand Voice", version: "1.0.0" }]
})}\n`
```

Assert rendered text contains:

```ts
expect(collectText(rendered).join(" ")).toContain("Project: Spring Campaign");
expect(collectText(rendered).join(" ")).toContain("Skills: 1");
expect(collectText(rendered).join(" ")).toContain("Runtime: real");
```

- [x] **Step 7: Run focused Web tests**

Run:

```bash
pnpm exec vitest run apps/web/src/app/api/chat/stream/route.test.ts apps/web/src/app/streaming-workbench-state.test.ts apps/web/src/app/streaming-workbench.test.ts
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add apps/web/src/app/api/chat/stream/route.ts apps/web/src/app/api/chat/stream/route.test.ts apps/web/src/app/streaming-workbench-state.ts apps/web/src/app/streaming-workbench-state.test.ts apps/web/src/app/streaming-workbench.tsx apps/web/src/app/streaming-workbench.test.ts
git commit -m "show assistant chat context summary"
```

## Task 7: Expose Assistant Route in Models UI and Server Actions

**Files:**
- Modify: `apps/web/src/app/actions.ts`
- Modify: `apps/web/src/app/actions.test.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`

- [x] **Step 1: Write failing action and i18n tests**

In `apps/web/src/app/actions.test.ts`, add an upsert route test using role `assistant`:

```ts
it("upserts an assistant model route", async () => {
  const formData = new FormData();
  formData.set("projectId", "project_1");
  formData.set("role", "assistant");
  formData.set("providerId", "provider_openai");
  formData.set("model", "gpt-5.4");

  await upsertProjectModelRouteAction(formData);

  expect(mocks.upsertProjectModelRoute).toHaveBeenCalledWith({
    projectId: "project_1",
    role: "assistant",
    providerId: "provider_openai",
    model: "gpt-5.4"
  });
});
```

In `apps/web/src/lib/i18n.test.ts`, add:

```ts
expect(en.chat.assistantModelRoute("provider_openai/gpt-5.4")).toBe(
  "Assistant model: provider_openai/gpt-5.4"
);
expect(zh.chat.assistantModelRoute("provider_openai/gpt-5.4")).toBe(
  "聊天模型：provider_openai/gpt-5.4"
);
```

- [x] **Step 2: Write failing page tests**

In `apps/web/src/app/page.test.ts`, update default `resolvedPolicy` literals to include assistant. Add assertions in models view tests:

```ts
expect(text).toContain("Assistant");
expect(routeProviderSelects).toHaveLength(5);
expect(saveRouteButtons).toHaveLength(5);
```

Add a top bar test:

```ts
it("shows the assistant model route signal in the workbench top bar", async () => {
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
        assistant: { provider: "provider_openai", model: "gpt-5.4" },
        planner: { provider: "mock-openai", model: "planning-model" },
        builder: { provider: "mock-anthropic", model: "code-model" },
        reviewer: { provider: "mock-openai", model: "review-model" },
        deployer: { provider: "mock-local", model: "tool-model" }
      }
    }
  };

  const page = await HomePage({ searchParams: Promise.resolve({}) });
  const text = collectText(page).join(" ");

  expect(text).toContain("Assistant model: provider_openai/gpt-5.4");
});
```

- [x] **Step 3: Run Web UI tests to verify failure**

Run:

```bash
pnpm exec vitest run apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts apps/web/src/lib/i18n.test.ts
```

Expected: failures mention unsupported role `assistant`, missing assistant label, and route count mismatch.

- [x] **Step 4: Implement action parser and role order**

In `apps/web/src/app/actions.ts`, update `parseAgentRole()`:

```ts
function parseAgentRole(
  rawValue: FormDataEntryValue | null
): "assistant" | "planner" | "builder" | "reviewer" | "deployer" {
  const value = String(rawValue ?? "");
  if (
    value === "assistant" ||
    value === "planner" ||
    value === "builder" ||
    value === "reviewer" ||
    value === "deployer"
  ) {
    return value;
  }
  redirectToModelsWithError("model_role_unsupported");
}
```

In `apps/web/src/app/page.tsx`, update role order:

```ts
const roleOrder = ["assistant", "planner", "builder", "reviewer", "deployer"] as const;
```

Update top-bar route signal:

```ts
const assistantModelRoute = modelState.resolvedPolicy.assistant;
const assistantModelLabel = copy.chat.assistantModelRoute(
  `${assistantModelRoute.provider}/${assistantModelRoute.model}`
);
```

Replace the top-bar usage of `builderModelLabel` with `assistantModelLabel`.

- [x] **Step 5: Implement labels**

In `apps/web/src/lib/i18n.ts`, add `assistantModelRoute` to chat copy type:

```ts
assistantModelRoute: (route: string) => string;
```

Add English copy:

```ts
assistantModelRoute: (route) => `Assistant model: ${route}`,
```

Add Chinese copy:

```ts
assistantModelRoute: (route) => `聊天模型：${route}`,
```

Add role label in both locales:

```ts
assistant: "Assistant",
```

```ts
assistant: "聊天助手",
```

- [x] **Step 6: Update Web policy literals**

In `apps/web/src/app/page.test.ts`, `apps/web/src/lib/workbench-store.test.ts`, and any Web test with `resolvedPolicy`, add:

```ts
assistant: { provider: "mock-openai", model: "assistant-model" },
```

Run:

```bash
rg -n "resolvedPolicy: \\{" apps/web/src
```

Expected: every displayed policy literal includes `assistant`.

- [x] **Step 7: Run focused Web tests**

Run:

```bash
pnpm exec vitest run apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts apps/web/src/lib/i18n.test.ts
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add apps/web/src/app/actions.ts apps/web/src/app/actions.test.ts apps/web/src/app/page.tsx apps/web/src/app/page.test.ts apps/web/src/lib/i18n.ts apps/web/src/lib/i18n.test.ts
git commit -m "expose assistant model route in web"
```

## Task 8: Run Integration Regression, Update Docs, and Close Stage 27 Planning

**Files:**
- Modify: `docs/superpowers/README.md`
- Modify: `docs/project-roadmap.md`
- Modify if implementation details change Agent concepts: `docs/agent-development-learning.md`

- [x] **Step 1: Run targeted regression suite**

Run:

```bash
pnpm exec vitest run packages/lp-schema/src/index.test.ts packages/model-gateway/src/index.test.ts packages/runtime-adapters/src/index.test.ts packages/api/src/assistant-chat.test.ts packages/api/src/run-orchestrator.test.ts packages/api/src/services.test.ts apps/web/src/lib/chat-stream.test.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/app/api/chat/stream/route.test.ts apps/web/src/app/streaming-workbench-state.test.ts apps/web/src/app/streaming-workbench.test.ts apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts apps/web/src/lib/i18n.test.ts
```

Expected: PASS.

- [x] **Step 2: Run workspace verification**

Run:

```bash
pnpm test
pnpm typecheck
```

Expected: both commands complete successfully.

- [x] **Step 3: Update Superpowers README**

In `docs/superpowers/README.md`, keep item 82 and item 83 aligned with the completed implementation:

```md
82. `specs/2026-05-21-real-chat-runtime-skill-context-design.md`
   - Stage 27 Real Chat Runtime and Skill Context v0 design（已实现，当前已完成）。
   - 在 Stage 26 implementation plan 和当前 roadmap 后阅读，用于理解已新增的普通聊天专用 `assistant` role、project-bound real chat runtime、skill context prompt 注入、Chat UI context summary，以及继续排除 LP chain、MCP execution、真实 shell/deployment 和 provider token streaming 的历史范围。

83. `plans/2026-05-21-real-chat-runtime-skill-context.md`
   - Stage 27 Real Chat Runtime and Skill Context v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 27 design 后阅读，用于理解已实现的 `assistant` role、assistant prompt builder、project-bound real chat runtime、safe context summary stream、Models UI route configuration、tests、review gates、最终验证和文档收尾历史；该 plan 已归档为完成态，不再作为当前执行 checklist。
```

- [x] **Step 4: Update roadmap**

In `docs/project-roadmap.md`, move Stage 27 into completed records, add the design/plan links, and make Stage 28 the current recommended next stage:

```md
### Stage 27：Real Chat Runtime and Skill Context v0

**状态：** 已实现，当前已完成。

**当前设计：** `docs/superpowers/specs/2026-05-21-real-chat-runtime-skill-context-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-21-real-chat-runtime-skill-context.md`。
```

- [x] **Step 5: Update Agent learning notes only if needed**

Update `docs/agent-development-learning.md` if any current-state note still says Stage 27 is unimplemented; after completion it must say `assistant` is a first-class model/runtime role, project-bound ordinary chat uses `runAssistantChat()`, Web emits safe `context.summary`, and real runtime remains `REAL_MODEL_RUNTIME=1` opt-in.

- [x] **Step 6: Check formatting and status**

Run:

```bash
git diff --check
git status --short --branch
```

Expected: no whitespace errors; only intended Stage 27 implementation and docs files are modified.

- [x] **Step 7: Commit docs and final implementation state**

```bash
git add docs/superpowers/README.md docs/project-roadmap.md docs/agent-development-learning.md
git commit -m "document assistant chat runtime plan"
```

If implementation files are still uncommitted because earlier task commits were skipped, include them in a final implementation commit before the docs commit:

```bash
git status --short
git add packages apps
git commit -m "implement assistant chat runtime"
```

- [x] **Step 8: Final verification after commits**

Run:

```bash
pnpm test
pnpm typecheck
git status --short --branch
```

Expected: tests pass, typecheck passes, and working tree is clean except expected branch-ahead status.

## Execution Notes

- Preserve unrelated user changes. If any listed file has unrelated edits, inspect them and build on them instead of reverting.
- Keep `REAL_MODEL_RUNTIME=1` explicitly opt-in. Default local dev and test behavior must remain deterministic.
- Keep projectless ordinary chat deterministic with no project skills.
- Do not pass raw skill content, raw provider response, raw tool output, secrets, full artifact content, or local filesystem paths into Web stream events.
- Do not add MCP execution or tool-call conversion in this stage.
