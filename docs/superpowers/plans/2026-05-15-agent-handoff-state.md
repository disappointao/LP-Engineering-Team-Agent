# Agent Handoff State v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add repository-backed, event-visible, ContextPack-injected handoff state for the fixed LP agent chain: Planner -> Builder -> Reviewer -> Deployer.

**Architecture:** Add `AgentHandoffRecord` to `@lp-agent/db`, then add a small API-owned `agent-handoffs.ts` helper that validates, sanitizes, selects, and emits handoff summaries. Wire handoffs into `runAgentStep()` through a pre-runtime hook, into `ContextPack.runtimeContext.handoffs`, and into the existing LP service flow without adding Web UI or a generic workflow engine.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Zod, existing in-memory and JSON-file workbench repositories.

---

## File Structure

- Modify `packages/db/src/workbench-repositories.ts`
  - Add `AgentHandoffRecord`, repository interface, in-memory implementation, copy helpers, and ordering helpers.
- Modify `packages/db/src/json-file-workbench-repositories.ts`
  - Persist handoffs in the JSON-file local repository.
- Modify `packages/db/src/workbench-repositories.test.ts`
  - Add in-memory handoff repository tests.
- Modify `packages/db/src/json-file-workbench-repositories.test.ts`
  - Add JSON reopen tests.
- Modify `packages/model-gateway/src/index.ts`
  - Add model-context handoff summary type and clone support.
- Modify `packages/model-gateway/src/index.test.ts`
  - Verify handoffs are audit-cloned defensively.
- Modify `packages/runtime-adapters/src/index.ts`
  - Add runtime-context handoff type support and clone support.
- Modify `packages/runtime-adapters/src/index.test.ts`
  - Verify runtime forwards/clones handoffs to model requests.
- Create `packages/api/src/agent-handoffs.ts`
  - Own API schemas, sanitization, record construction, event payloads, selection, and consumed-state helpers.
- Create `packages/api/src/agent-handoffs.test.ts`
  - Unit tests for schema, sanitization, selection, payload safety, and consumed-state helper.
- Modify `packages/api/package.json`
  - Add `src/agent-handoffs.test.ts` to the package test script.
- Modify `packages/api/src/run-orchestrator.ts`
  - Add a pre-runtime event hook so downstream runs can mark inbound handoffs consumed before runtime invocation while still emitting `handoff.consumed`.
- Modify `packages/api/src/run-orchestrator.test.ts`
  - Verify pre-runtime events are saved before runtime events and failure before runtime does not invoke runtime.
- Modify `packages/api/src/context-assembler.ts`
  - Inject role-relevant handoff summaries and handoff trace entries.
- Modify `packages/api/src/services.test.ts`
  - Add service-flow tests for ready, blocked, consumed, and deployer-blocking behavior.
- Modify `packages/api/src/index.ts`
  - Export handoff types and helpers, and wire handoff creation into Planner/Builder/Reviewer/Deployer service flow.
- Modify `docs/agent-development-learning.md`
  - Mark Stage 6 handoff v0 as implemented after implementation completes.

---

## Task 1: Add Agent Handoff Repository Contracts

**Files:**
- Modify: `packages/db/src/workbench-repositories.ts`
- Modify: `packages/db/src/json-file-workbench-repositories.ts`
- Modify: `packages/db/src/workbench-repositories.test.ts`
- Modify: `packages/db/src/json-file-workbench-repositories.test.ts`

- [ ] **Step 1: Add failing in-memory repository test**

In `packages/db/src/workbench-repositories.test.ts`, add a test after the existing run/tool observation repository test:

```ts
it("persists agent handoffs with defensive copies and role-aware filters", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const handoff = {
    id: "handoff_1",
    projectId: "project_1",
    taskId: "task_1",
    fromRunId: "run_planner_1",
    fromRole: "planner" as const,
    toRole: "builder" as const,
    state: "ready" as const,
    summary: "Planner produced LP brief",
    artifactRefs: {
      briefId: "brief_1"
    },
    createdAt: "2026-05-15T08:00:00.000Z",
    updatedAt: "2026-05-15T08:00:00.000Z"
  };
  const otherProject = {
    ...handoff,
    id: "handoff_other",
    projectId: "project_2",
    fromRunId: "run_planner_2",
    updatedAt: "2026-05-15T08:01:00.000Z"
  };

  await repositories.agentHandoffs.save(handoff);
  await repositories.agentHandoffs.save(otherProject);
  handoff.summary = "mutated";
  handoff.artifactRefs!.briefId = "mutated";

  const saved = await repositories.agentHandoffs.getById("handoff_1");
  expect(saved).toEqual({
    id: "handoff_1",
    projectId: "project_1",
    taskId: "task_1",
    fromRunId: "run_planner_1",
    fromRole: "planner",
    toRole: "builder",
    state: "ready",
    summary: "Planner produced LP brief",
    artifactRefs: {
      briefId: "brief_1"
    },
    createdAt: "2026-05-15T08:00:00.000Z",
    updatedAt: "2026-05-15T08:00:00.000Z"
  });
  saved!.artifactRefs!.briefId = "mutated-again";

  await expect(repositories.agentHandoffs.listInbound({
    projectId: "project_1",
    taskId: "task_1",
    toRole: "builder"
  })).resolves.toEqual([
    expect.objectContaining({
      id: "handoff_1",
      artifactRefs: {
        briefId: "brief_1"
      }
    })
  ]);
  await expect(repositories.agentHandoffs.listOutbound({
    projectId: "project_1",
    taskId: "task_1",
    fromRole: "planner"
  })).resolves.toEqual([
    expect.objectContaining({ id: "handoff_1" })
  ]);
  await expect(repositories.agentHandoffs.listForProject("project_1")).resolves.toEqual([
    expect.objectContaining({ id: "handoff_1" })
  ]);
  await expect(repositories.agentHandoffs.getById("handoff_1")).resolves.toEqual(
    expect.objectContaining({
      artifactRefs: {
        briefId: "brief_1"
      }
    })
  );
});
```

- [ ] **Step 2: Add failing JSON-file repository test**

In `packages/db/src/json-file-workbench-repositories.test.ts`, add a test near the run event persistence test:

```ts
it("reopens agent handoffs from disk", async () => {
  const filePath = join(tempRoot, "handoffs.json");
  const first = createJsonFileWorkbenchRepositories({ filePath });
  await first.agentHandoffs.save({
    id: "handoff_1",
    projectId: "project_1",
    taskId: "task_1",
    fromRunId: "run_builder_1",
    fromRole: "builder",
    toRole: "reviewer",
    state: "ready",
    summary: "Builder produced static LP artifacts",
    artifactRefs: {
      briefId: "brief_1",
      pageVersionId: "version_1"
    },
    createdAt: "2026-05-15T08:00:00.000Z",
    updatedAt: "2026-05-15T08:00:00.000Z"
  });

  const second = createJsonFileWorkbenchRepositories({
    filePath: join(tempRoot, ".", "handoffs.json")
  });

  await expect(second.agentHandoffs.listInbound({
    projectId: "project_1",
    taskId: "task_1",
    toRole: "reviewer"
  })).resolves.toEqual([
    {
      id: "handoff_1",
      projectId: "project_1",
      taskId: "task_1",
      fromRunId: "run_builder_1",
      fromRole: "builder",
      toRole: "reviewer",
      state: "ready",
      summary: "Builder produced static LP artifacts",
      artifactRefs: {
        briefId: "brief_1",
        pageVersionId: "version_1"
      },
      createdAt: "2026-05-15T08:00:00.000Z",
      updatedAt: "2026-05-15T08:00:00.000Z"
    }
  ]);
});
```

- [ ] **Step 3: Run DB tests and verify they fail**

Run:

```bash
pnpm --filter @lp-agent/db test
```

Expected: FAIL because `agentHandoffs` does not exist on `WorkbenchRepositories`.

- [ ] **Step 4: Add DB types and in-memory implementation**

In `packages/db/src/workbench-repositories.ts`, add near the run record types:

```ts
export type AgentHandoffState = "ready" | "blocked" | "consumed";

export interface AgentHandoffArtifactRefs {
  briefId?: string;
  pageVersionId?: string;
}

export interface AgentHandoffRecord {
  id: string;
  projectId: string;
  taskId?: string;
  fromRunId: string;
  fromRole: AgentRole;
  toRole: AgentRole;
  state: AgentHandoffState;
  summary: string;
  blockingReason?: string;
  artifactRefs?: AgentHandoffArtifactRefs;
  createdAt: string;
  updatedAt: string;
}
```

Add the repository interface after `ToolObservationRepository`:

```ts
export interface AgentHandoffRepository {
  save(handoff: AgentHandoffRecord): Promise<void>;
  getById(handoffId: string): Promise<AgentHandoffRecord | undefined>;
  listForProject(projectId: string): Promise<AgentHandoffRecord[]>;
  listForTask(taskId: string): Promise<AgentHandoffRecord[]>;
  listInbound(input: {
    projectId: string;
    taskId?: string;
    toRole: AgentRole;
  }): Promise<AgentHandoffRecord[]>;
  listOutbound(input: {
    projectId: string;
    taskId?: string;
    fromRole: AgentRole;
  }): Promise<AgentHandoffRecord[]>;
  listAll(): Promise<AgentHandoffRecord[]>;
}
```

Add `agentHandoffs: AgentHandoffRepository;` to `WorkbenchRepositories`, instantiate it in `InMemoryWorkbenchRepositories`, and add:

```ts
class InMemoryAgentHandoffRepository implements AgentHandoffRepository {
  private readonly handoffs = new Map<string, AgentHandoffRecord>();

  async save(handoff: AgentHandoffRecord): Promise<void> {
    this.handoffs.set(handoff.id, copyAgentHandoff(handoff));
  }

  async getById(handoffId: string): Promise<AgentHandoffRecord | undefined> {
    const handoff = this.handoffs.get(handoffId);
    return handoff ? copyAgentHandoff(handoff) : undefined;
  }

  async listForProject(projectId: string): Promise<AgentHandoffRecord[]> {
    return this.sortedHandoffs((handoff) => handoff.projectId === projectId);
  }

  async listForTask(taskId: string): Promise<AgentHandoffRecord[]> {
    return this.sortedHandoffs((handoff) => handoff.taskId === taskId);
  }

  async listInbound(input: {
    projectId: string;
    taskId?: string;
    toRole: AgentRole;
  }): Promise<AgentHandoffRecord[]> {
    return this.sortedHandoffs(
      (handoff) =>
        handoff.projectId === input.projectId &&
        handoff.toRole === input.toRole &&
        (input.taskId === undefined || handoff.taskId === input.taskId)
    );
  }

  async listOutbound(input: {
    projectId: string;
    taskId?: string;
    fromRole: AgentRole;
  }): Promise<AgentHandoffRecord[]> {
    return this.sortedHandoffs(
      (handoff) =>
        handoff.projectId === input.projectId &&
        handoff.fromRole === input.fromRole &&
        (input.taskId === undefined || handoff.taskId === input.taskId)
    );
  }

  async listAll(): Promise<AgentHandoffRecord[]> {
    return this.sortedHandoffs(() => true);
  }

  private sortedHandoffs(matches: (handoff: AgentHandoffRecord) => boolean): AgentHandoffRecord[] {
    return [...this.handoffs.values()]
      .filter(matches)
      .sort(compareAgentHandoffsByTimeline)
      .map(copyAgentHandoff);
  }
}
```

Add helpers near the existing compare/copy helpers:

```ts
function compareAgentHandoffsByTimeline(
  a: AgentHandoffRecord,
  b: AgentHandoffRecord
): number {
  return (
    a.updatedAt.localeCompare(b.updatedAt) ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

function copyAgentHandoff(handoff: AgentHandoffRecord): AgentHandoffRecord {
  return {
    ...handoff,
    ...(handoff.artifactRefs ? { artifactRefs: { ...handoff.artifactRefs } } : {})
  };
}
```

- [ ] **Step 5: Add JSON-file persistence**

In `packages/db/src/json-file-workbench-repositories.ts`:

- import `AgentHandoffRecord` and `AgentHandoffRepository`;
- add `agentHandoffs: AgentHandoffRecord[];` to `JsonFileWorkbenchState`;
- add `readonly agentHandoffs: AgentHandoffRepository;` to `JsonFileWorkbenchRepositories`;
- instantiate `this.agentHandoffs = new JsonFileAgentHandoffRepository(filePath);`;
- add `agentHandoffs: parsed.agentHandoffs ?? []` in `readState`;
- add `agentHandoffs: []` in `emptyState`.

Add the repository class near the run repository:

```ts
class JsonFileAgentHandoffRepository implements AgentHandoffRepository {
  constructor(private readonly filePath: string) {}

  async save(handoff: AgentHandoffRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.agentHandoffs = upsertBy(
        state.agentHandoffs,
        copy(handoff),
        (record) => record.id === handoff.id
      );
    });
  }

  async getById(handoffId: string): Promise<AgentHandoffRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.agentHandoffs.find((handoff) => handoff.id === handoffId));
  }

  async listForProject(projectId: string): Promise<AgentHandoffRecord[]> {
    return this.sortedHandoffs((handoff) => handoff.projectId === projectId);
  }

  async listForTask(taskId: string): Promise<AgentHandoffRecord[]> {
    return this.sortedHandoffs((handoff) => handoff.taskId === taskId);
  }

  async listInbound(input: {
    projectId: string;
    taskId?: string;
    toRole: AgentRole;
  }): Promise<AgentHandoffRecord[]> {
    return this.sortedHandoffs(
      (handoff) =>
        handoff.projectId === input.projectId &&
        handoff.toRole === input.toRole &&
        (input.taskId === undefined || handoff.taskId === input.taskId)
    );
  }

  async listOutbound(input: {
    projectId: string;
    taskId?: string;
    fromRole: AgentRole;
  }): Promise<AgentHandoffRecord[]> {
    return this.sortedHandoffs(
      (handoff) =>
        handoff.projectId === input.projectId &&
        handoff.fromRole === input.fromRole &&
        (input.taskId === undefined || handoff.taskId === input.taskId)
    );
  }

  async listAll(): Promise<AgentHandoffRecord[]> {
    return this.sortedHandoffs(() => true);
  }

  private async sortedHandoffs(
    matches: (handoff: AgentHandoffRecord) => boolean
  ): Promise<AgentHandoffRecord[]> {
    const state = await readState(this.filePath);
    return state.agentHandoffs
      .filter(matches)
      .sort(compareAgentHandoffsByTimeline)
      .map(copy);
  }
}
```

If `AgentRole` is not already imported in this file, import it from `@lp-agent/model-gateway`.

- [ ] **Step 6: Run DB tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/db test
pnpm --filter @lp-agent/db typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit DB repository work**

```bash
git status --short
git add packages/db/src/workbench-repositories.ts packages/db/src/json-file-workbench-repositories.ts packages/db/src/workbench-repositories.test.ts packages/db/src/json-file-workbench-repositories.test.ts
git commit -m "add agent handoff repositories"
```

---

## Task 2: Add Runtime and Model Handoff Context Contracts

**Files:**
- Modify: `packages/model-gateway/src/index.ts`
- Modify: `packages/model-gateway/src/index.test.ts`
- Modify: `packages/runtime-adapters/src/index.ts`
- Modify: `packages/runtime-adapters/src/index.test.ts`

- [ ] **Step 1: Add failing model-gateway clone test**

In `packages/model-gateway/src/index.test.ts`, add a test near the existing context memory clone test:

```ts
it("clones handoff summaries in audit contexts", async () => {
  const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
  const context = baseModelContext({
    handoffs: [
      {
        id: "handoff_1",
        fromRunId: "run_planner_1",
        fromRole: "planner",
        toRole: "builder",
        state: "ready",
        summary: "Planner produced LP brief",
        artifactRefs: {
          briefId: "brief_1"
        },
        updatedAt: "2026-05-15T08:00:00.000Z"
      }
    ]
  });

  await gateway.complete({
    role: "builder",
    projectId: "project_1",
    prompt: "Build",
    context
  });
  context.handoffs![0]!.artifactRefs!.briefId = "mutated";
  context.handoffs!.push({
    id: "handoff_mutated",
    fromRunId: "run_mutated",
    fromRole: "planner",
    toRole: "builder",
    state: "ready",
    summary: "mutated",
    updatedAt: "2026-05-15T08:01:00.000Z"
  });

  expect(gateway.getAuditLog()[0]?.context?.handoffs).toEqual([
    {
      id: "handoff_1",
      fromRunId: "run_planner_1",
      fromRole: "planner",
      toRole: "builder",
      state: "ready",
      summary: "Planner produced LP brief",
      artifactRefs: {
        briefId: "brief_1"
      },
      updatedAt: "2026-05-15T08:00:00.000Z"
    }
  ]);
});
```

If `baseModelContext()` does not accept partial overrides today, add `handoffs` to the helper's supported override object in the same test file.

- [ ] **Step 2: Add failing runtime clone/forward test**

In `packages/runtime-adapters/src/index.test.ts`, add handoffs to the existing model gateway runtime context forwarding test or create a focused test:

```ts
it("forwards handoff summaries to model requests with defensive clones", async () => {
  const gateway = new RecordingModelGateway({
    provider: "mock",
    model: "mock-model",
    text: "{}",
    usage: { inputTokens: 1, outputTokens: 1 }
  });
  const runtime = new LocalAgentRuntimeAdapter({ modelGateway: gateway });
  const context = completeRuntimeContext({
    handoffs: [
      {
        id: "handoff_1",
        fromRunId: "run_builder_1",
        fromRole: "builder",
        toRole: "reviewer",
        state: "ready",
        summary: "Builder produced static LP artifacts",
        artifactRefs: {
          pageVersionId: "version_1"
        },
        updatedAt: "2026-05-15T08:00:00.000Z"
      }
    ]
  });

  await runtime.run({
    runId: "run_reviewer_1",
    projectId: "project_1",
    role: "reviewer",
    input: {
      prompt: "Review",
      brief: sampleBrief
    },
    context
  });
  context.handoffs![0]!.artifactRefs!.pageVersionId = "mutated";

  expect(gateway.requests[0]?.context?.handoffs).toEqual([
    {
      id: "handoff_1",
      fromRunId: "run_builder_1",
      fromRole: "builder",
      toRole: "reviewer",
      state: "ready",
      summary: "Builder produced static LP artifacts",
      artifactRefs: {
        pageVersionId: "version_1"
      },
      updatedAt: "2026-05-15T08:00:00.000Z"
    }
  ]);
});
```

- [ ] **Step 3: Run focused tests and verify they fail**

Run:

```bash
pnpm --filter @lp-agent/model-gateway test
pnpm --filter @lp-agent/runtime-adapters test
```

Expected: FAIL because `handoffs` is not part of the request/runtime context types.

- [ ] **Step 4: Add model-gateway handoff types and clone support**

In `packages/model-gateway/src/index.ts`, add near `ModelContextMemory`:

```ts
export interface ModelAgentHandoffArtifactRefs {
  briefId?: string;
  pageVersionId?: string;
}

export interface ModelAgentHandoffSummary {
  id: string;
  fromRunId: string;
  fromRole: AgentRole;
  toRole: AgentRole;
  state: "ready" | "blocked" | "consumed";
  summary: string;
  blockingReason?: string;
  artifactRefs?: ModelAgentHandoffArtifactRefs;
  updatedAt: string;
}
```

Add `handoffs?: ModelAgentHandoffSummary[];` to `ModelRequestContext`.

In `cloneModelRequestContext()`, add:

```ts
    ...(context.handoffs ? { handoffs: cloneModelAgentHandoffs(context.handoffs) } : {}),
```

Add:

```ts
function cloneModelAgentHandoffs(
  handoffs: ModelAgentHandoffSummary[]
): ModelAgentHandoffSummary[] {
  return handoffs.map((handoff) => ({
    ...handoff,
    ...(handoff.artifactRefs ? { artifactRefs: { ...handoff.artifactRefs } } : {})
  }));
}
```

- [ ] **Step 5: Add runtime-adapters handoff context support**

In `packages/runtime-adapters/src/index.ts`, import `type ModelAgentHandoffSummary` from `@lp-agent/model-gateway`.

Add `handoffs?: ModelAgentHandoffSummary[];` to `RuntimeRunContext`.

In both runtime context clone helpers, add:

```ts
    ...(context.handoffs ? { handoffs: cloneRuntimeHandoffs(context.handoffs) } : {}),
```

Add:

```ts
function cloneRuntimeHandoffs(
  handoffs: ModelAgentHandoffSummary[]
): ModelAgentHandoffSummary[] {
  return handoffs.map((handoff) => ({
    ...handoff,
    ...(handoff.artifactRefs ? { artifactRefs: { ...handoff.artifactRefs } } : {})
  }));
}
```

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/model-gateway test
pnpm --filter @lp-agent/runtime-adapters test
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit context contract work**

```bash
git status --short
git add packages/model-gateway/src/index.ts packages/model-gateway/src/index.test.ts packages/runtime-adapters/src/index.ts packages/runtime-adapters/src/index.test.ts
git commit -m "add handoff runtime context contracts"
```

---

## Task 3: Add API Handoff Helpers and Run Pre-Runtime Hook

**Files:**
- Create: `packages/api/src/agent-handoffs.ts`
- Create: `packages/api/src/agent-handoffs.test.ts`
- Modify: `packages/api/package.json`
- Modify: `packages/api/src/run-orchestrator.ts`
- Modify: `packages/api/src/run-orchestrator.test.ts`

- [ ] **Step 1: Add failing API handoff helper tests**

Create `packages/api/src/agent-handoffs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInMemoryWorkbenchRepositories } from "@lp-agent/db";
import {
  AgentHandoffRecordSchema,
  assembleRuntimeHandoffs,
  createAgentHandoffRecord,
  markInboundHandoffsConsumed,
  sanitizeHandoffText,
  toHandoffRunEventDraft
} from "./agent-handoffs";

describe("agent handoffs", () => {
  it("validates and sanitizes handoff records", () => {
    const handoff = createAgentHandoffRecord({
      id: "handoff_1",
      projectId: "project_1",
      taskId: "task_1",
      fromRunId: "run_reviewer_1",
      fromRole: "reviewer",
      toRole: "deployer",
      state: "blocked",
      summary: "Reviewer blocked deployment with OPENAI_API_KEY=sk-test-secret",
      blockingReason: "<html>secret-token</html>",
      artifactRefs: {
        pageVersionId: "version_1"
      },
      now: () => new Date("2026-05-15T08:00:00.000Z")
    });

    expect(AgentHandoffRecordSchema.parse(handoff)).toMatchObject({
      id: "handoff_1",
      state: "blocked",
      summary: expect.stringContaining("[REDACTED]"),
      blockingReason: expect.stringContaining("[artifact omitted]")
    });
    expect(JSON.stringify(handoff)).not.toContain("sk-test-secret");
    expect(JSON.stringify(handoff)).not.toContain("secret-token");
    expect(JSON.stringify(handoff)).not.toContain("<html>");
  });

  it("creates safe handoff event drafts", () => {
    const event = toHandoffRunEventDraft({
      id: "handoff_1",
      projectId: "project_1",
      taskId: "task_1",
      fromRunId: "run_planner_1",
      fromRole: "planner",
      toRole: "builder",
      state: "ready",
      summary: "Planner produced LP brief",
      artifactRefs: {
        briefId: "brief_1"
      },
      createdAt: "2026-05-15T08:00:00.000Z",
      updatedAt: "2026-05-15T08:00:00.000Z"
    });

    expect(event).toEqual({
      type: "handoff.created",
      message: "Agent handoff ready.",
      payload: {
        handoffId: "handoff_1",
        fromRunId: "run_planner_1",
        fromRole: "planner",
        toRole: "builder",
        state: "ready",
        summary: "Planner produced LP brief",
        artifactRefs: {
          briefId: "brief_1"
        }
      }
    });
  });

  it("selects role-relevant handoffs for runtime context", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.agentHandoffs.save(createAgentHandoffRecord({
      id: "handoff_inbound",
      projectId: "project_1",
      taskId: "task_1",
      fromRunId: "run_builder_1",
      fromRole: "builder",
      toRole: "reviewer",
      state: "ready",
      summary: "Builder produced static LP artifacts",
      artifactRefs: {
        pageVersionId: "version_1"
      },
      now: () => new Date("2026-05-15T08:00:00.000Z")
    }));
    await repositories.agentHandoffs.save(createAgentHandoffRecord({
      id: "handoff_other_project",
      projectId: "project_2",
      fromRunId: "run_builder_2",
      fromRole: "builder",
      toRole: "reviewer",
      state: "ready",
      summary: "Other project",
      now: () => new Date("2026-05-15T08:01:00.000Z")
    }));

    const result = await assembleRuntimeHandoffs({
      repositories,
      projectId: "project_1",
      taskId: "task_1",
      role: "reviewer",
      limit: 6
    });

    expect(result.handoffs).toEqual([
      expect.objectContaining({
        id: "handoff_inbound",
        fromRole: "builder",
        toRole: "reviewer",
        state: "ready"
      })
    ]);
    expect(result.trace.injected).toEqual(["handoffs:1"]);
    expect(result.trace.omitted).toEqual([]);
  });

  it("marks ready inbound handoffs consumed", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.agentHandoffs.save(createAgentHandoffRecord({
      id: "handoff_1",
      projectId: "project_1",
      taskId: "task_1",
      fromRunId: "run_planner_1",
      fromRole: "planner",
      toRole: "builder",
      state: "ready",
      summary: "Planner produced LP brief",
      artifactRefs: {
        briefId: "brief_1"
      },
      now: () => new Date("2026-05-15T08:00:00.000Z")
    }));

    const events = await markInboundHandoffsConsumed({
      repositories,
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      now: () => new Date("2026-05-15T08:01:00.000Z")
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "handoff.consumed",
        payload: expect.objectContaining({
          handoffId: "handoff_1",
          state: "consumed"
        })
      })
    ]);
    await expect(repositories.agentHandoffs.getById("handoff_1")).resolves.toEqual(
      expect.objectContaining({
        state: "consumed",
        updatedAt: "2026-05-15T08:01:00.000Z"
      })
    );
  });

  it("redacts common secret-like strings", () => {
    expect(sanitizeHandoffText("OPENAI_API_KEY=sk-test-secret and secret-token")).toBe(
      "OPENAI_API_KEY=[REDACTED] and [REDACTED]"
    );
  });
});
```

- [ ] **Step 2: Add failing run orchestrator pre-runtime hook tests**

In `packages/api/src/run-orchestrator.test.ts`, add:

```ts
it("saves pre-runtime run events before invoking the runtime", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const runtime = new RecordingRuntime({ state: "completed" });
  const service = createDemoWorkbenchService({ repositories });

  await runAgentStep({
    repositories,
    service,
    runtime,
    runId: "run_builder_1",
    projectId: "project_1",
    role: "builder",
    input: {
      prompt: "Build"
    },
    beforeRuntime: async () => [
      {
        type: "handoff.consumed",
        message: "Agent handoff consumed.",
        payload: {
          handoffId: "handoff_1",
          fromRunId: "run_planner_1",
          fromRole: "planner",
          toRole: "builder",
          state: "consumed",
          summary: "Planner produced LP brief"
        }
      }
    ],
    now: () => new Date("2026-05-15T08:00:00.000Z")
  });

  expect(runtime.requests).toHaveLength(1);
  await expect(repositories.runEvents.listForRun("run_builder_1")).resolves.toEqual([
    expect.objectContaining({
      sequence: 1,
      type: "handoff.consumed"
    }),
    expect.objectContaining({
      sequence: 2,
      type: "run.started"
    }),
    expect.objectContaining({
      sequence: 3,
      type: "run.completed"
    })
  ]);
});

it("fails before runtime invocation when pre-runtime event creation fails", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const runtime = new RecordingRuntime({ state: "completed" });
  const service = createDemoWorkbenchService({ repositories });

  await expect(
    runAgentStep({
      repositories,
      service,
      runtime,
      runId: "run_builder_1",
      projectId: "project_1",
      role: "builder",
      input: {
        prompt: "Build"
      },
      beforeRuntime: async () => {
        throw new Error("handoff_consume_failed");
      },
      now: () => new Date("2026-05-15T08:00:00.000Z")
    })
  ).rejects.toThrow("handoff_consume_failed");

  expect(runtime.requests).toEqual([]);
  await expect(repositories.runs.getById("run_builder_1")).resolves.toEqual(
    expect.objectContaining({
      state: "failed"
    })
  );
});
```

If `RecordingRuntime` is local to another test file, add a small local test runtime in `run-orchestrator.test.ts`.

- [ ] **Step 3: Update API package test script and verify red**

Add `src/agent-handoffs.test.ts` to `packages/api/package.json`:

```json
"test": "vitest run src/structured-lp-brief.test.ts src/structured-static-artifacts.test.ts src/skill-command-execution.test.ts src/run-orchestrator.test.ts src/context-memory.test.ts src/agent-handoffs.test.ts src/services.test.ts"
```

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: FAIL because `agent-handoffs.ts` and `beforeRuntime` do not exist.

- [ ] **Step 4: Implement `agent-handoffs.ts`**

Create `packages/api/src/agent-handoffs.ts` with these exports:

```ts
import { z } from "zod";
import { agentRoles, type AgentRole, type ModelAgentHandoffSummary } from "@lp-agent/model-gateway";
import type { AgentHandoffRecord, WorkbenchRepositories } from "@lp-agent/db";

export const AgentHandoffArtifactRefsSchema = z.object({
  briefId: z.string().min(1).optional(),
  pageVersionId: z.string().min(1).optional()
});

export const AgentHandoffRecordSchema: z.ZodType<AgentHandoffRecord> = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  taskId: z.string().min(1).optional(),
  fromRunId: z.string().min(1),
  fromRole: z.enum(agentRoles),
  toRole: z.enum(agentRoles),
  state: z.enum(["ready", "blocked", "consumed"]),
  summary: z.string().min(1),
  blockingReason: z.string().min(1).optional(),
  artifactRefs: AgentHandoffArtifactRefsSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const RuntimeHandoffSummarySchema: z.ZodType<ModelAgentHandoffSummary> = z.object({
  id: z.string().min(1),
  fromRunId: z.string().min(1),
  fromRole: z.enum(agentRoles),
  toRole: z.enum(agentRoles),
  state: z.enum(["ready", "blocked", "consumed"]),
  summary: z.string().min(1),
  blockingReason: z.string().min(1).optional(),
  artifactRefs: AgentHandoffArtifactRefsSchema.optional(),
  updatedAt: z.string().datetime()
});

export interface RunEventDraft {
  type: string;
  message: string;
  payload: Record<string, unknown>;
}

export interface AssembleRuntimeHandoffsResult {
  handoffs: ModelAgentHandoffSummary[];
  trace: {
    injected: string[];
    omitted: string[];
  };
}

const HANDOFF_SUMMARY_LIMIT = 240;
const HANDOFF_SELECTION_LIMIT = 6;
const REDACTION = "[REDACTED]";

export function createAgentHandoffRecord(input: {
  id: string;
  projectId: string;
  taskId?: string;
  fromRunId: string;
  fromRole: AgentRole;
  toRole: AgentRole;
  state: AgentHandoffRecord["state"];
  summary: string;
  blockingReason?: string;
  artifactRefs?: AgentHandoffRecord["artifactRefs"];
  now: () => Date;
}): AgentHandoffRecord {
  const timestamp = input.now().toISOString();
  const record: AgentHandoffRecord = {
    id: input.id,
    projectId: input.projectId,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    fromRunId: input.fromRunId,
    fromRole: input.fromRole,
    toRole: input.toRole,
    state: input.state,
    summary: sanitizeAndBoundHandoffText(input.summary),
    ...(input.blockingReason
      ? { blockingReason: sanitizeAndBoundHandoffText(input.blockingReason) }
      : {}),
    ...(input.artifactRefs ? { artifactRefs: { ...input.artifactRefs } } : {}),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  return AgentHandoffRecordSchema.parse(record);
}

export function sanitizeHandoffText(value: string): string {
  return value
    .replace(/<!doctype[\s\S]*?<\/html>/giu, "[artifact omitted]")
    .replace(/<html[\s\S]*?<\/html>/giu, "[artifact omitted]")
    .replace(
      /\b[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      (match) => `${match.split(/[:=]/u)[0]}=${REDACTION}`
    )
    .replace(/\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|secret)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu, `$1${REDACTION}`)
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}\b/giu, `$1${REDACTION}`)
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/giu, REDACTION)
    .replace(/\bsecret-token\b/giu, REDACTION);
}

export function toHandoffRunEventDraft(handoff: AgentHandoffRecord): RunEventDraft {
  const payload = toHandoffEventPayload(handoff);
  if (handoff.state === "blocked") {
    return {
      type: "handoff.blocked",
      message: "Agent handoff blocked.",
      payload
    };
  }
  if (handoff.state === "consumed") {
    return {
      type: "handoff.consumed",
      message: "Agent handoff consumed.",
      payload
    };
  }
  return {
    type: "handoff.created",
    message: "Agent handoff ready.",
    payload
  };
}

export async function assembleRuntimeHandoffs(input: {
  repositories: WorkbenchRepositories;
  projectId: string;
  taskId?: string;
  role: AgentRole;
  limit?: number;
}): Promise<AssembleRuntimeHandoffsResult> {
  const limit = Math.max(0, Math.floor(input.limit ?? HANDOFF_SELECTION_LIMIT));
  const [inbound, outbound] = await Promise.all([
    input.repositories.agentHandoffs.listInbound({
      projectId: input.projectId,
      taskId: input.taskId,
      toRole: input.role
    }),
    input.repositories.agentHandoffs.listOutbound({
      projectId: input.projectId,
      taskId: input.taskId,
      fromRole: input.role
    })
  ]);
  const deduped = dedupeHandoffs([...inbound, ...outbound]);
  const selected = deduped.slice(0, limit).map(toRuntimeHandoffSummary);
  return {
    handoffs: selected.map((handoff) => RuntimeHandoffSummarySchema.parse(handoff)),
    trace: {
      injected: selected.length > 0 ? [`handoffs:${selected.length}`] : [],
      omitted: deduped.length === 0
        ? ["handoffs:none"]
        : selected.length < deduped.length
          ? ["handoffs:budget_exceeded"]
          : []
    }
  };
}

export async function markInboundHandoffsConsumed(input: {
  repositories: WorkbenchRepositories;
  projectId: string;
  taskId?: string;
  role: AgentRole;
  now: () => Date;
}): Promise<RunEventDraft[]> {
  const inbound = await input.repositories.agentHandoffs.listInbound({
    projectId: input.projectId,
    taskId: input.taskId,
    toRole: input.role
  });
  const ready = inbound.filter((handoff) => handoff.state === "ready");
  const timestamp = input.now().toISOString();
  const events: RunEventDraft[] = [];
  for (const handoff of ready) {
    const consumed = AgentHandoffRecordSchema.parse({
      ...handoff,
      state: "consumed",
      updatedAt: timestamp
    });
    await input.repositories.agentHandoffs.save(consumed);
    events.push(toHandoffRunEventDraft(consumed));
  }
  return events;
}

export function toRuntimeHandoffSummary(handoff: AgentHandoffRecord): ModelAgentHandoffSummary {
  return RuntimeHandoffSummarySchema.parse({
    id: handoff.id,
    fromRunId: handoff.fromRunId,
    fromRole: handoff.fromRole,
    toRole: handoff.toRole,
    state: handoff.state,
    summary: handoff.summary,
    ...(handoff.blockingReason ? { blockingReason: handoff.blockingReason } : {}),
    ...(handoff.artifactRefs ? { artifactRefs: { ...handoff.artifactRefs } } : {}),
    updatedAt: handoff.updatedAt
  });
}

function sanitizeAndBoundHandoffText(value: string): string {
  const sanitized = sanitizeHandoffText(value).trim();
  return sanitized.length > HANDOFF_SUMMARY_LIMIT
    ? `${sanitized.slice(0, HANDOFF_SUMMARY_LIMIT - 3)}...`
    : sanitized;
}

function toHandoffEventPayload(handoff: AgentHandoffRecord): Record<string, unknown> {
  return {
    handoffId: handoff.id,
    fromRunId: handoff.fromRunId,
    fromRole: handoff.fromRole,
    toRole: handoff.toRole,
    state: handoff.state,
    summary: handoff.summary,
    ...(handoff.blockingReason ? { blockingReason: handoff.blockingReason } : {}),
    ...(handoff.artifactRefs ? { artifactRefs: { ...handoff.artifactRefs } } : {})
  };
}

function dedupeHandoffs(handoffs: AgentHandoffRecord[]): AgentHandoffRecord[] {
  const byId = new Map<string, AgentHandoffRecord>();
  for (const handoff of handoffs) {
    byId.set(handoff.id, handoff);
  }
  return [...byId.values()].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.createdAt.localeCompare(left.createdAt) ||
      left.id.localeCompare(right.id)
  );
}
```

- [ ] **Step 5: Implement run orchestrator pre-runtime hook**

In `packages/api/src/run-orchestrator.ts`, add:

```ts
export interface RunEventDraft {
  type: string;
  message: string;
  payload: Record<string, unknown>;
}
```

Add to `RunAgentStepInput`:

```ts
  beforeRuntime?: RunAgentStepBeforeRuntime;
```

Add:

```ts
export interface RunAgentStepBeforeRuntimeInput {
  run: RunRecord;
  contextPack: ContextPack;
}

export type RunAgentStepBeforeRuntime = (
  input: RunAgentStepBeforeRuntimeInput
) => RunEventDraft[] | Promise<RunEventDraft[]>;
```

Inside `runAgentStep()`, after saving `startedRun` and before `input.runtime.run(...)`, call `beforeRuntime`, persist drafts immediately with sequence numbers starting at 1, and use that count as the runtime event offset:

```ts
  const preRuntimeEvents: RunEventRecord[] = [];
  if (input.beforeRuntime) {
    const drafts = await input.beforeRuntime({
      run: startedRun,
      contextPack
    });
    for (const draft of drafts) {
      const event = toRunEventRecordFromDraft({
        draft,
        runId: input.runId,
        projectId: input.projectId,
        taskId: input.taskId,
        sequence: preRuntimeEvents.length + 1,
        createdAt: nextRepositoryTimestamp(input.repositories, now)
      });
      await input.repositories.runEvents.save(event);
      preRuntimeEvents.push(event);
    }
  }
```

In the catch block, save thrown failure at `sequence: preRuntimeEvents.length + 1`.

When mapping runtime events, use `sequence: preRuntimeEvents.length + index + 1`.

Return `events: [...preRuntimeEvents, ...events]`.

Add:

```ts
function toRunEventRecordFromDraft(input: {
  draft: RunEventDraft;
  runId: string;
  projectId: string;
  taskId?: string;
  sequence: number;
  createdAt: string;
}): RunEventRecord {
  return RunEventRecordSchema.parse({
    id: `${input.runId}_event_${input.sequence}`,
    runId: input.runId,
    projectId: input.projectId,
    taskId: input.taskId,
    sequence: input.sequence,
    type: input.draft.type,
    message: input.draft.message,
    payload: structuredClone(input.draft.payload),
    createdAt: input.createdAt
  });
}
```

- [ ] **Step 6: Run API tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/api test
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit API helper and run hook**

```bash
git status --short
git add packages/api/src/agent-handoffs.ts packages/api/src/agent-handoffs.test.ts packages/api/src/run-orchestrator.ts packages/api/src/run-orchestrator.test.ts packages/api/package.json
git commit -m "add agent handoff helpers"
```

---

## Task 4: Inject Handoff Summaries into Context Pack

**Files:**
- Modify: `packages/api/src/context-assembler.ts`
- Modify: `packages/api/src/services.test.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Add failing Context Pack handoff injection test**

In `packages/api/src/services.test.ts`, add near the context pack memory tests:

```ts
it("injects role-relevant handoff summaries into context packs", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
  const project = await service.createProject({ name: "Project" });
  await repositories.agentHandoffs.save({
    id: "handoff_builder_reviewer",
    projectId: project.id,
    taskId: "task_1",
    fromRunId: "run_builder_1",
    fromRole: "builder",
    toRole: "reviewer",
    state: "ready",
    summary: "Builder produced static LP artifacts",
    artifactRefs: {
      pageVersionId: "version_1"
    },
    createdAt: "2026-05-15T08:00:00.000Z",
    updatedAt: "2026-05-15T08:00:00.000Z"
  });

  const contextPack = await assembleContextPack({
    repositories,
    service,
    projectId: project.id,
    taskId: "task_1",
    role: "reviewer",
    input: {
      prompt: "Review"
    },
    now: fixedClock()
  });

  expect(ContextPackSchema.parse(contextPack).runtimeContext.handoffs).toEqual([
    {
      id: "handoff_builder_reviewer",
      fromRunId: "run_builder_1",
      fromRole: "builder",
      toRole: "reviewer",
      state: "ready",
      summary: "Builder produced static LP artifacts",
      artifactRefs: {
        pageVersionId: "version_1"
      },
      updatedAt: "2026-05-15T08:00:00.000Z"
    }
  ]);
  expect(contextPack.trace.injected).toContain("handoffs:1");
  expect(contextPack.trace.omitted).not.toContain("handoffs:none");
});
```

- [ ] **Step 2: Run API tests and verify red**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: FAIL because `RuntimeRunContextSchema` and `assembleContextPack()` do not include handoffs.

- [ ] **Step 3: Update Context Pack schema and assembly**

In `packages/api/src/context-assembler.ts`, import:

```ts
import { RuntimeHandoffSummarySchema, assembleRuntimeHandoffs } from "./agent-handoffs";
```

In `RuntimeRunContextSchema`, add:

```ts
  handoffs: z.array(RuntimeHandoffSummarySchema).optional(),
```

Inside `assembleContextPack()`, after memory assembly, add:

```ts
  const handoffContext = await assembleRuntimeHandoffs({
    repositories: input.repositories,
    projectId: input.projectId,
    taskId: input.taskId,
    role: input.role
  });
```

Build runtime context with memory and handoffs:

```ts
  const runtimeContextWithMemory = {
    ...runtimeContext,
    memory,
    handoffs: handoffContext.handoffs
  };
```

Add `...handoffContext.trace.injected` to `trace.injected` and `...handoffContext.trace.omitted` to `trace.omitted`.

- [ ] **Step 4: Export handoff helpers from API**

In `packages/api/src/index.ts`, export near existing context exports:

```ts
export {
  AgentHandoffArtifactRefsSchema,
  AgentHandoffRecordSchema,
  RuntimeHandoffSummarySchema,
  assembleRuntimeHandoffs,
  createAgentHandoffRecord,
  markInboundHandoffsConsumed,
  sanitizeHandoffText,
  toHandoffRunEventDraft,
  toRuntimeHandoffSummary,
  type AssembleRuntimeHandoffsResult,
  type RunEventDraft
} from "./agent-handoffs";
```

If `AssembleRuntimeHandoffsResult` is not exported in Task 3, export it before adding this barrel export.

- [ ] **Step 5: Run API tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/api test
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Context Pack injection**

```bash
git status --short
git add packages/api/src/context-assembler.ts packages/api/src/services.test.ts packages/api/src/index.ts
git commit -m "inject agent handoffs into context packs"
```

---

## Task 5: Wire Handoffs into LP Service Flow

**Files:**
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/services.test.ts`

- [ ] **Step 1: Add failing service-flow tests**

In `packages/api/src/services.test.ts`, add a new describe block near the run orchestration tests:

```ts
it("creates ready handoffs for planner and builder outputs", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
  const project = await service.createProject({ name: "Project" });

  const brief = await service.createBriefFromPrompt({
    projectId: project.id,
    prompt: "Create a sale LP"
  });
  const pageVersion = await service.generatePageVersion({
    projectId: project.id,
    briefId: brief.id
  });

  await expect(repositories.agentHandoffs.listForProject(project.id)).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        fromRunId: `run_planner_${brief.id}`,
        fromRole: "planner",
        toRole: "builder",
        state: "consumed",
        artifactRefs: {
          briefId: brief.id
        }
      }),
      expect.objectContaining({
        fromRunId: `run_builder_${pageVersion.id}`,
        fromRole: "builder",
        toRole: "reviewer",
        state: "ready",
        artifactRefs: {
          briefId: brief.id,
          pageVersionId: pageVersion.id
        }
      })
    ])
  );
  await expect(repositories.runEvents.listForProject(project.id)).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "handoff.created" }),
      expect.objectContaining({ type: "handoff.consumed" })
    ])
  );
});

it("creates ready reviewer handoff before deployer and consumes it during deployment", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
  const project = await service.createProject({ name: "Project" });
  const brief = await service.createBriefFromPrompt({
    projectId: project.id,
    prompt: "Create a sale LP"
  });
  const pageVersion = await service.generatePageVersion({
    projectId: project.id,
    briefId: brief.id
  });
  const reviewed = await service.reviewPageVersion({
    projectId: project.id,
    pageVersionId: pageVersion.id
  });

  expect(reviewed.reviewStatus).toBe("passed");
  await expect(repositories.agentHandoffs.listInbound({
    projectId: project.id,
    toRole: "deployer"
  })).resolves.toEqual([
    expect.objectContaining({
      fromRole: "reviewer",
      toRole: "deployer",
      state: "ready",
      artifactRefs: {
        pageVersionId: pageVersion.id
      }
    })
  ]);

  await service.approveAndCreateDeployment({
    projectId: project.id,
    pageVersionId: pageVersion.id,
    reviewerUserId: "reviewer_1"
  });

  await expect(repositories.agentHandoffs.listInbound({
    projectId: project.id,
    toRole: "deployer"
  })).resolves.toEqual([
    expect.objectContaining({
      state: "consumed"
    })
  ]);
});

it("blocks deployer creation when reviewer creates a blocked handoff", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const reviewerRuntime = new StaticRuntime({
    state: "completed",
    findings: [
      {
        severity: "blocking",
        target: "section:hero",
        explanation: "Hero section is missing a CTA secret-token",
        suggestedFix: "Add a primary CTA.",
        blocksDeployment: true
      }
    ]
  });
  const deployerRuntime = new RecordingRuntime({ state: "completed" });
  const service = new DemoWorkbenchService({
    repositories,
    reviewerRuntime,
    deployerRuntime,
    now: fixedClock()
  });
  const project = await service.createProject({ name: "Project" });
  const brief = await service.createBriefFromPrompt({
    projectId: project.id,
    prompt: "Create a sale LP"
  });
  const pageVersion = await service.generatePageVersion({
    projectId: project.id,
    briefId: brief.id
  });

  const reviewed = await service.reviewPageVersion({
    projectId: project.id,
    pageVersionId: pageVersion.id
  });

  expect(reviewed.reviewStatus).toBe("failed");
  const handoffs = await repositories.agentHandoffs.listInbound({
    projectId: project.id,
    toRole: "deployer"
  });
  expect(handoffs).toEqual([
    expect.objectContaining({
      state: "blocked",
      blockingReason: expect.stringContaining("[REDACTED]")
    })
  ]);
  expect(JSON.stringify(handoffs)).not.toContain("secret-token");

  await expect(
    service.approveAndCreateDeployment({
      projectId: project.id,
      pageVersionId: pageVersion.id,
      reviewerUserId: "reviewer_1"
    })
  ).rejects.toThrow("agent_handoff_blocked");
  expect(deployerRuntime.requests).toEqual([]);
});
```

- [ ] **Step 2: Run API tests and verify red**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: FAIL because service methods do not create, block, or consume handoffs yet.

- [ ] **Step 3: Add service helpers in `packages/api/src/index.ts`**

Import from `./agent-handoffs`:

```ts
import {
  createAgentHandoffRecord,
  markInboundHandoffsConsumed,
  toHandoffRunEventDraft,
  type RunEventDraft
} from "./agent-handoffs";
```

Add private methods on `DemoWorkbenchService`:

```ts
  private async saveHandoffForRun(input: {
    runId: string;
    projectId: string;
    taskId?: string;
    sequence: number;
    fromRole: AgentRole;
    toRole: AgentRole;
    state: "ready" | "blocked";
    summary: string;
    blockingReason?: string;
    artifactRefs?: {
      briefId?: string;
      pageVersionId?: string;
    };
  }): Promise<void> {
    const reservation = await this.reserveHandoffId();
    const handoff = createAgentHandoffRecord({
      id: reservation.id,
      projectId: input.projectId,
      taskId: input.taskId,
      fromRunId: input.runId,
      fromRole: input.fromRole,
      toRole: input.toRole,
      state: input.state,
      summary: input.summary,
      blockingReason: input.blockingReason,
      artifactRefs: input.artifactRefs,
      now: this.now
    });
    try {
      await this.repositories.agentHandoffs.save(handoff);
      const event = toHandoffRunEventDraft(handoff);
      await this.repositories.runEvents.save({
        id: `${input.runId}_event_${input.sequence}`,
        runId: input.runId,
        projectId: input.projectId,
        taskId: input.taskId,
        sequence: input.sequence,
        type: event.type,
        message: event.message,
        payload: event.payload,
        createdAt: this.timestamp()
      });
    } finally {
      reservation.release();
    }
  }

  private async reserveHandoffId(): Promise<{ id: string; release: () => void }> {
    const id = await reserveRepositoryId(this.repositories, "handoff", async () => {
      const handoffs = await this.repositories.agentHandoffs.listAll();
      return handoffs.map((record) => record.id);
    });
    return {
      id,
      release: () => releaseRepositoryId(this.repositories, id)
    };
  }
```

Add:

```ts
  private async consumeReadyHandoffsForRun(input: {
    projectId: string;
    taskId?: string;
    role: AgentRole;
  }): Promise<RunEventDraft[]> {
    return markInboundHandoffsConsumed({
      repositories: this.repositories,
      projectId: input.projectId,
      taskId: input.taskId,
      role: input.role,
      now: this.now
    });
  }
```

Add:

```ts
  private async assertDeploymentHandoffReady(input: {
    projectId: string;
    pageVersionId: string;
  }): Promise<void> {
    const inbound = await this.repositories.agentHandoffs.listInbound({
      projectId: input.projectId,
      toRole: "deployer"
    });
    const matching = inbound
      .filter((handoff) => handoff.artifactRefs?.pageVersionId === input.pageVersionId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const latest = matching[0];
    if (latest?.state === "blocked") {
      throw new Error("agent_handoff_blocked");
    }
  }
```

- [ ] **Step 4: Wire Planner and Builder handoffs**

In `createBriefFromPrompt()`, destructure the run result:

```ts
      const { result, run, events } = await runAgentStep({
```

After saving the brief and before returning, call:

```ts
        await this.saveHandoffForRun({
          runId: run.id,
          projectId: input.projectId,
          sequence: events.length + 1,
          fromRole: "planner",
          toRole: "builder",
          state: "ready",
          summary: "Planner produced LP brief",
          artifactRefs: {
            briefId: brief.id
          }
        });
```

In `generatePageVersion()`, call `runAgentStep()` with:

```ts
        beforeRuntime: () =>
          this.consumeReadyHandoffsForRun({
            projectId: input.projectId,
            role: "builder"
          }),
```

After saving the page version, write:

```ts
        await this.saveHandoffForRun({
          runId: run.id,
          projectId: input.projectId,
          sequence: events.length + 1,
          fromRole: "builder",
          toRole: "reviewer",
          state: "ready",
          summary: "Builder produced static LP artifacts",
          artifactRefs: {
            briefId: brief.id,
            pageVersionId: pageVersion.id
          }
        });
```

- [ ] **Step 5: Wire Reviewer handoffs and deployer blocking**

In `reviewPageVersion()`, call `runAgentStep()` with:

```ts
      beforeRuntime: () =>
        this.consumeReadyHandoffsForRun({
          projectId: input.projectId,
          role: "reviewer"
        }),
```

After saving the reviewed page version, write a reviewer-to-deployer handoff:

```ts
    const blockingFindings = findings.filter(
      (finding) => finding.blocksDeployment || finding.severity === "blocking"
    );
    await this.saveHandoffForRun({
      runId: run.id,
      projectId: input.projectId,
      sequence: events.length + 1,
      fromRole: "reviewer",
      toRole: "deployer",
      state: pageVersion.reviewStatus === "passed" ? "ready" : "blocked",
      summary: pageVersion.reviewStatus === "passed"
        ? "Reviewer passed page version"
        : "Reviewer blocked deployment",
      ...(blockingFindings.length > 0
        ? {
            blockingReason: blockingFindings
              .map((finding) => `${finding.target}: ${finding.explanation}`)
              .join("; ")
          }
        : {}),
      artifactRefs: {
        pageVersionId: pageVersion.id
      }
    });
```

In `approveAndCreateDeployment()`, after page version status check and before existing deployment lookup, call:

```ts
    await this.assertDeploymentHandoffReady({
      projectId: input.projectId,
      pageVersionId: pageVersion.id
    });
```

In the deployer `runAgentStep()` call, add:

```ts
      beforeRuntime: () =>
        this.consumeReadyHandoffsForRun({
          projectId: input.projectId,
          role: "deployer"
        }),
```

- [ ] **Step 6: Run API tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/api test
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit service flow wiring**

```bash
git status --short
git add packages/api/src/index.ts packages/api/src/services.test.ts
git commit -m "wire handoffs into lp service flow"
```

---

## Task 6: Documentation and Full Verification

**Files:**
- Modify: `docs/agent-development-learning.md`

- [ ] **Step 1: Update learning notes**

In `docs/agent-development-learning.md`, under `### 阶段 6：多 Agent 协作`, change the Stage 6 design bullets from "下一步" to implemented status. Ensure these bullets are present:

```md
已实现的 Agent Handoff State v0：

- [2026-05-15-agent-handoff-state-design.md](./superpowers/specs/2026-05-15-agent-handoff-state-design.md)
- 当前实现计划：[2026-05-15-agent-handoff-state.md](./superpowers/plans/2026-05-15-agent-handoff-state.md)
- 第一版只覆盖 LP 固定链路：Planner -> Builder -> Reviewer -> Deployer，不做开放式 agent swarm 或通用 DAG。
- handoff 是 repository 里的结构化状态，同时写入 `handoff.created`、`handoff.blocked`、`handoff.consumed` run event，供 timeline 和 Context Pack 使用。
- Reviewer 不通过时会写 `blocked` handoff，并阻止 Deployer run 创建；retry/resume、团队审批和 UI handoff 卡片后续再做。
- 学习重点是把“角色之间怎么交接”从隐含顺序变成可查询、可审计、可恢复的运行状态。
```

- [ ] **Step 2: Run focused test suite**

Run:

```bash
pnpm --filter @lp-agent/db test
pnpm --filter @lp-agent/model-gateway test
pnpm --filter @lp-agent/runtime-adapters test
pnpm --filter @lp-agent/api test
```

Expected: PASS.

- [ ] **Step 3: Run workspace verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: PASS. If `pnpm build` fails due an environment or network issue, capture the exact error and do not claim build passed.

- [ ] **Step 4: Commit docs**

```bash
git status --short
git add docs/agent-development-learning.md
git commit -m "document agent handoff state completion"
```

---

## Task 7: Final Review and Branch Finish

**Files:**
- No planned file edits.

- [ ] **Step 1: Run final status check**

Run:

```bash
git status --short
git log --oneline --max-count=12
```

Expected: no tracked dirty files. Pre-existing untracked `微信图片_*.png` files may remain in the main worktree and should not be staged.

- [ ] **Step 2: Request final code review**

Use `superpowers:requesting-code-review` or the active Subagent-Driven final review step. Reviewer should check:

- handoff repository records are project-scoped and task-aware;
- fixed LP chain creates Planner, Builder, and Reviewer handoffs;
- Reviewer blocked handoff prevents Deployer run creation;
- consumed-state updates happen before downstream runtime invocation;
- handoff run events are safe and deterministic;
- Context Pack handoff summaries are role-relevant and trace counts are accurate;
- runtime/model clone helpers defensively clone handoffs;
- no raw model output, secret, full artifact, or raw tool output enters handoff records, events, or runtime context;
- deterministic LP generation output remains stable;
- docs accurately state Stage 6 v0 scope.

- [ ] **Step 3: Fix review findings**

If review requests changes, implement the smallest focused fix with a failing test first, then run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: PASS before final branch finish.

- [ ] **Step 4: Finish the branch**

Use `superpowers:finishing-a-development-branch` after implementation, reviews, and verification pass.
