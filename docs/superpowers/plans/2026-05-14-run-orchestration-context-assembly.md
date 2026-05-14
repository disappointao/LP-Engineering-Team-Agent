# Run Orchestration and Context Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist planner, builder, reviewer, and deployer run events while introducing a small explicit context assembly boundary for the first real-agent workflow.

**Architecture:** Add run/event/tool-observation repositories to `@lp-agent/db`, then route runtime calls in `@lp-agent/api` through a context assembler and run orchestrator. Keep the workflow deterministic: no real model provider, MCP execution, deployment UI, streaming, interrupt, vector retrieval, or long-term memory in this slice.

**Tech Stack:** pnpm TypeScript monorepo, Vitest, Zod, repository-backed local JSON state, existing `AgentRuntimeAdapter`, existing Next.js server-rendered Web workbench.

---

## Scope Check

This plan implements Stage 2 Milestone 6 in the smallest useful pieces:

- Persist run records and ordered run events.
- Persist structured tool observations as data, even though real tool execution stays out of scope.
- Assemble a role-specific context pack before runtime calls.
- Validate context packs and persisted run events through Zod schemas.
- Use the orchestrator for planner, builder, reviewer, and deployer calls.
- Display persisted process events in the Web conversation timeline after refresh.

This plan does not add:

- Real OpenAI, Anthropic, internal model, or pi-mono provider calls.
- MCP SDK integration or command execution.
- Streaming response UI.
- Real interrupt/cancel behavior.
- Vector search, embeddings, or long-term memory.
- Deployment UI or automatic deployment from Web.
- Realtime team collaboration.

## File Structure

- Modify: `packages/db/src/workbench-repositories.ts`
  - Add `RunRecord`, `RunEventRecord`, `ToolObservationRecord`, repository interfaces, in-memory implementations, and defensive copy helpers.
- Modify: `packages/db/src/json-file-workbench-repositories.ts`
  - Persist runs, run events, and tool observations in the local JSON state file.
- Modify: `packages/db/src/workbench-repositories.test.ts`
  - Cover in-memory run/event/observation persistence, sequence ordering, defensive copies, and project/task filtering.
- Modify: `packages/db/src/json-file-workbench-repositories.test.ts`
  - Cover JSON-file reopening for runs, events, and observations.
- Modify: `packages/api/package.json`
  - Add direct `zod` dependency for API-owned runtime boundary schemas.
- Create: `packages/api/src/context-assembler.ts`
  - Define `ContextPackSchema`, `ContextPack`, `ContextAssemblyTrace`, and `assembleContextPack()`.
- Create: `packages/api/src/run-orchestrator.ts`
  - Define `RunEventRecordSchema`, runtime-event normalization, run persistence, and `runAgentStep()`.
- Modify: `packages/api/src/index.ts`
  - Export run/context types, inject planner/deployer runtime adapters, use the orchestrator in planner/builder/reviewer/deployer paths, and expose run listing APIs.
- Modify: `packages/api/src/services.test.ts`
  - Cover run persistence, event ordering, failed run events, context pack trace, and orchestration integration.
- Modify: `apps/web/src/lib/workbench-store.ts`
  - Include task/project run events in `WorkbenchPageState`.
- Modify: `apps/web/src/lib/workbench-store.test.ts`
  - Verify repository-backed page state includes persisted run events.
- Modify: `apps/web/src/lib/chat-workbench.ts`
  - Convert persisted run events to chat tool timeline events, with current deterministic fallback preserved.
- Modify: `apps/web/src/lib/chat-workbench.test.ts`
  - Cover persisted run-event timelines and fallback behavior.
- Modify: `apps/web/src/app/page.tsx`
  - Pass persisted run events into the chat-thread builder.
- Modify: `docs/development.md`
  - Document the current Milestone 6 behavior.
- Modify: `docs/agent-development-learning.md`
  - Move run orchestration/context pack from planned learning to active implementation notes.
- Modify: `docs/superpowers/README.md`
  - Add this plan to the reading order.

## Task 1: DB Run/Event/Observation Repositories

**Files:**
- Modify: `packages/db/src/workbench-repositories.ts`
- Test: `packages/db/src/workbench-repositories.test.ts`

- [ ] **Step 1: Write failing in-memory repository tests**

Add these type imports in `packages/db/src/workbench-repositories.test.ts`:

```ts
  type RunEventRecord,
  type RunRecord,
  type ToolObservationRecord
```

Add this test near the other repository persistence tests:

```ts
  it("persists runs, ordered events, and tool observations with defensive copies", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const run: RunRecord = {
      id: "run_builder_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      state: "completed",
      startedAt: createdAt,
      completedAt: "2026-05-12T00:01:00.000Z",
      contextSummary: {
        injected: ["skills:1", "mcpTools:1"],
        omitted: []
      }
    };
    const firstEvent: RunEventRecord = {
      id: "run_event_1",
      runId: run.id,
      projectId: run.projectId,
      taskId: run.taskId,
      sequence: 2,
      type: "model.completed",
      message: "builder model call completed",
      payload: {
        provider: "mock-anthropic",
        model: "code-model"
      },
      createdAt: "2026-05-12T00:00:30.000Z"
    };
    const secondEvent: RunEventRecord = {
      id: "run_event_2",
      runId: run.id,
      projectId: run.projectId,
      taskId: run.taskId,
      sequence: 1,
      type: "run.started",
      message: "builder run started",
      payload: {
        role: "builder"
      },
      createdAt
    };
    const observation: ToolObservationRecord = {
      id: "tool_observation_1",
      runId: run.id,
      projectId: run.projectId,
      taskId: run.taskId,
      toolName: "searchAssets",
      input: {
        query: "hero"
      },
      outputSummary: "Found three candidate hero images.",
      state: "completed",
      createdAt
    };

    await repositories.runs.save(run);
    await repositories.runEvents.save(firstEvent);
    await repositories.runEvents.save(secondEvent);
    await repositories.toolObservations.save(observation);

    const savedRun = await repositories.runs.getById(run.id);
    if (!savedRun) {
      throw new Error("Expected saved run.");
    }
    savedRun.contextSummary.injected.push("mutated");
    const savedObservation = await repositories.toolObservations.listForRun(run.id);
    savedObservation[0]!.input.query = "mutated";

    await expect(repositories.runs.listForProject("project_1")).resolves.toEqual([
      expect.objectContaining({
        id: "run_builder_1",
        state: "completed",
        contextSummary: {
          injected: ["skills:1", "mcpTools:1"],
          omitted: []
        }
      })
    ]);
    await expect(repositories.runs.listForTask("task_1")).resolves.toEqual([
      expect.objectContaining({ id: "run_builder_1" })
    ]);
    await expect(repositories.runEvents.listForRun(run.id)).resolves.toEqual([
      expect.objectContaining({
        id: "run_event_2",
        sequence: 1,
        type: "run.started"
      }),
      expect.objectContaining({
        id: "run_event_1",
        sequence: 2,
        type: "model.completed"
      })
    ]);
    await expect(repositories.runEvents.listForTask("task_1")).resolves.toHaveLength(2);
    await expect(repositories.toolObservations.listForRun(run.id)).resolves.toEqual([
      expect.objectContaining({
        id: "tool_observation_1",
        input: {
          query: "hero"
        }
      })
    ]);
  });
```

- [ ] **Step 2: Run the DB test and verify it fails**

Run:

```bash
pnpm --filter @lp-agent/db test
```

Expected: FAIL because `runs`, `runEvents`, and `toolObservations` do not exist on `WorkbenchRepositories`.

- [ ] **Step 3: Add run repository types**

In `packages/db/src/workbench-repositories.ts`, add these types after `MCPToolApprovalRecord`:

```ts
export type RunRecordState = "running" | "needs_input" | "needs_approval" | "failed" | "completed" | "cancelled";
export type ToolObservationState = "completed" | "failed";

export interface RunRecord {
  id: string;
  projectId: string;
  taskId?: string;
  role: AgentRole;
  state: RunRecordState;
  startedAt: string;
  completedAt?: string;
  contextSummary: {
    injected: string[];
    omitted: string[];
  };
}

export interface RunEventRecord {
  id: string;
  runId: string;
  projectId: string;
  taskId?: string;
  sequence: number;
  type: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ToolObservationRecord {
  id: string;
  runId: string;
  projectId: string;
  taskId?: string;
  toolName: string;
  input: Record<string, unknown>;
  outputSummary: string;
  state: ToolObservationState;
  errorName?: string;
  createdAt: string;
}
```

Add repository interfaces before `WorkbenchRepositories`:

```ts
export interface RunRepository {
  save(run: RunRecord): Promise<void>;
  getById(runId: string): Promise<RunRecord | undefined>;
  listForProject(projectId: string): Promise<RunRecord[]>;
  listForTask(taskId: string): Promise<RunRecord[]>;
  listAll(): Promise<RunRecord[]>;
}

export interface RunEventRepository {
  save(event: RunEventRecord): Promise<void>;
  listForRun(runId: string): Promise<RunEventRecord[]>;
  listForTask(taskId: string): Promise<RunEventRecord[]>;
  listForProject(projectId: string): Promise<RunEventRecord[]>;
  listAll(): Promise<RunEventRecord[]>;
}

export interface ToolObservationRepository {
  save(observation: ToolObservationRecord): Promise<void>;
  listForRun(runId: string): Promise<ToolObservationRecord[]>;
  listForTask(taskId: string): Promise<ToolObservationRecord[]>;
  listAll(): Promise<ToolObservationRecord[]>;
}
```

Extend `WorkbenchRepositories`:

```ts
  runs: RunRepository;
  runEvents: RunEventRepository;
  toolObservations: ToolObservationRepository;
```

Extend `InMemoryWorkbenchRepositories`:

```ts
  readonly runs = new InMemoryRunRepository();
  readonly runEvents = new InMemoryRunEventRepository();
  readonly toolObservations = new InMemoryToolObservationRepository();
```

- [ ] **Step 4: Add in-memory implementations and copy helpers**

Add these classes near the other in-memory repository classes:

```ts
class InMemoryRunRepository implements RunRepository {
  private readonly runs = new Map<string, RunRecord>();

  async save(run: RunRecord): Promise<void> {
    this.runs.set(run.id, copyRun(run));
  }

  async getById(runId: string): Promise<RunRecord | undefined> {
    const run = this.runs.get(runId);
    return run ? copyRun(run) : undefined;
  }

  async listForProject(projectId: string): Promise<RunRecord[]> {
    return [...this.runs.values()]
      .filter((run) => run.projectId === projectId)
      .map(copyRun);
  }

  async listForTask(taskId: string): Promise<RunRecord[]> {
    return [...this.runs.values()]
      .filter((run) => run.taskId === taskId)
      .map(copyRun);
  }

  async listAll(): Promise<RunRecord[]> {
    return [...this.runs.values()].map(copyRun);
  }
}

class InMemoryRunEventRepository implements RunEventRepository {
  private readonly events = new Map<string, RunEventRecord>();

  async save(event: RunEventRecord): Promise<void> {
    this.events.set(event.id, copyRunEvent(event));
  }

  async listForRun(runId: string): Promise<RunEventRecord[]> {
    return this.sortedEvents((event) => event.runId === runId);
  }

  async listForTask(taskId: string): Promise<RunEventRecord[]> {
    return this.sortedEvents((event) => event.taskId === taskId);
  }

  async listForProject(projectId: string): Promise<RunEventRecord[]> {
    return this.sortedEvents((event) => event.projectId === projectId);
  }

  async listAll(): Promise<RunEventRecord[]> {
    return this.sortedEvents(() => true);
  }

  private sortedEvents(matches: (event: RunEventRecord) => boolean): RunEventRecord[] {
    return [...this.events.values()]
      .filter(matches)
      .sort((a, b) => a.sequence - b.sequence)
      .map(copyRunEvent);
  }
}

class InMemoryToolObservationRepository implements ToolObservationRepository {
  private readonly observations = new Map<string, ToolObservationRecord>();

  async save(observation: ToolObservationRecord): Promise<void> {
    this.observations.set(observation.id, copyToolObservation(observation));
  }

  async listForRun(runId: string): Promise<ToolObservationRecord[]> {
    return this.sortedObservations((observation) => observation.runId === runId);
  }

  async listForTask(taskId: string): Promise<ToolObservationRecord[]> {
    return this.sortedObservations((observation) => observation.taskId === taskId);
  }

  async listAll(): Promise<ToolObservationRecord[]> {
    return this.sortedObservations(() => true);
  }

  private sortedObservations(matches: (observation: ToolObservationRecord) => boolean): ToolObservationRecord[] {
    return [...this.observations.values()]
      .filter(matches)
      .map(copyToolObservation);
  }
}
```

Add copy helpers near existing copy helpers:

```ts
function copyRun(run: RunRecord): RunRecord {
  return {
    ...run,
    contextSummary: {
      injected: [...run.contextSummary.injected],
      omitted: [...run.contextSummary.omitted]
    }
  };
}

function copyRunEvent(event: RunEventRecord): RunEventRecord {
  return {
    ...event,
    payload: structuredClone(event.payload)
  };
}

function copyToolObservation(observation: ToolObservationRecord): ToolObservationRecord {
  return {
    ...observation,
    input: structuredClone(observation.input)
  };
}
```

- [ ] **Step 5: Run DB tests**

Run:

```bash
pnpm --filter @lp-agent/db test
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add packages/db/src/workbench-repositories.ts packages/db/src/workbench-repositories.test.ts
git commit -m "add run event repositories"
```

## Task 2: JSON-File Run/Event/Observation Persistence

**Files:**
- Modify: `packages/db/src/json-file-workbench-repositories.ts`
- Test: `packages/db/src/json-file-workbench-repositories.test.ts`

- [ ] **Step 1: Write failing JSON-file persistence test**

Add this test in `packages/db/src/json-file-workbench-repositories.test.ts`:

```ts
  it("reopens runs, run events, and tool observations from disk", async () => {
    const filePath = await tempStateFile();
    const first = createJsonFileWorkbenchRepositories({ filePath });

    await first.runs.save({
      id: "run_builder_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      state: "completed",
      startedAt: createdAt,
      completedAt: "2026-05-13T00:01:00.000Z",
      contextSummary: {
        injected: ["skills:1"],
        omitted: ["history:0"]
      }
    });
    await first.runEvents.save({
      id: "run_event_1",
      runId: "run_builder_1",
      projectId: "project_1",
      taskId: "task_1",
      sequence: 1,
      type: "run.started",
      message: "builder run started",
      payload: {
        role: "builder"
      },
      createdAt
    });
    await first.toolObservations.save({
      id: "tool_observation_1",
      runId: "run_builder_1",
      projectId: "project_1",
      taskId: "task_1",
      toolName: "searchAssets",
      input: {
        query: "hero"
      },
      outputSummary: "Found three candidate hero images.",
      state: "completed",
      createdAt
    });

    const second = createJsonFileWorkbenchRepositories({ filePath });

    await expect(second.runs.listForTask("task_1")).resolves.toEqual([
      expect.objectContaining({
        id: "run_builder_1",
        contextSummary: {
          injected: ["skills:1"],
          omitted: ["history:0"]
        }
      })
    ]);
    await expect(second.runEvents.listForRun("run_builder_1")).resolves.toEqual([
      expect.objectContaining({
        id: "run_event_1",
        sequence: 1,
        type: "run.started"
      })
    ]);
    await expect(second.toolObservations.listForRun("run_builder_1")).resolves.toEqual([
      expect.objectContaining({
        id: "tool_observation_1",
        input: {
          query: "hero"
        }
      })
    ]);
  });
```

- [ ] **Step 2: Run JSON-file tests and verify failure**

Run:

```bash
pnpm --filter @lp-agent/db test -- src/json-file-workbench-repositories.test.ts
```

Expected: FAIL because JSON state does not include run repositories.

- [ ] **Step 3: Extend JSON state and repository bundle**

In `packages/db/src/json-file-workbench-repositories.ts`, extend the type import list:

```ts
  RunEventRecord,
  RunEventRepository,
  RunRecord,
  RunRepository,
  ToolObservationRecord,
  ToolObservationRepository,
```

Add arrays to `JsonFileWorkbenchState`:

```ts
  runs: RunRecord[];
  runEvents: RunEventRecord[];
  toolObservations: ToolObservationRecord[];
```

Add properties to `JsonFileWorkbenchRepositories`:

```ts
  readonly runs: RunRepository;
  readonly runEvents: RunEventRepository;
  readonly toolObservations: ToolObservationRepository;
```

Initialize them in the constructor:

```ts
    this.runs = new JsonFileRunRepository(filePath);
    this.runEvents = new JsonFileRunEventRepository(filePath);
    this.toolObservations = new JsonFileToolObservationRepository(filePath);
```

- [ ] **Step 4: Add JSON-file repository classes**

Add these classes near the other JSON-file repository classes:

```ts
class JsonFileRunRepository implements RunRepository {
  constructor(private readonly filePath: string) {}

  async save(run: RunRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.runs = upsertBy(state.runs, copy(run), (record) => record.id === run.id);
    });
  }

  async getById(runId: string): Promise<RunRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.runs.find((run) => run.id === runId));
  }

  async listForProject(projectId: string): Promise<RunRecord[]> {
    const state = await readState(this.filePath);
    return state.runs.filter((run) => run.projectId === projectId).map(copy);
  }

  async listForTask(taskId: string): Promise<RunRecord[]> {
    const state = await readState(this.filePath);
    return state.runs.filter((run) => run.taskId === taskId).map(copy);
  }

  async listAll(): Promise<RunRecord[]> {
    const state = await readState(this.filePath);
    return state.runs.map(copy);
  }
}

class JsonFileRunEventRepository implements RunEventRepository {
  constructor(private readonly filePath: string) {}

  async save(event: RunEventRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.runEvents = upsertBy(
        state.runEvents,
        copy(event),
        (record) => record.id === event.id
      );
    });
  }

  async listForRun(runId: string): Promise<RunEventRecord[]> {
    const state = await readState(this.filePath);
    return sortRunEvents(state.runEvents.filter((event) => event.runId === runId));
  }

  async listForTask(taskId: string): Promise<RunEventRecord[]> {
    const state = await readState(this.filePath);
    return sortRunEvents(state.runEvents.filter((event) => event.taskId === taskId));
  }

  async listForProject(projectId: string): Promise<RunEventRecord[]> {
    const state = await readState(this.filePath);
    return sortRunEvents(state.runEvents.filter((event) => event.projectId === projectId));
  }

  async listAll(): Promise<RunEventRecord[]> {
    const state = await readState(this.filePath);
    return sortRunEvents(state.runEvents);
  }
}

class JsonFileToolObservationRepository implements ToolObservationRepository {
  constructor(private readonly filePath: string) {}

  async save(observation: ToolObservationRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.toolObservations = upsertBy(
        state.toolObservations,
        copy(observation),
        (record) => record.id === observation.id
      );
    });
  }

  async listForRun(runId: string): Promise<ToolObservationRecord[]> {
    const state = await readState(this.filePath);
    return state.toolObservations.filter((observation) => observation.runId === runId).map(copy);
  }

  async listForTask(taskId: string): Promise<ToolObservationRecord[]> {
    const state = await readState(this.filePath);
    return state.toolObservations.filter((observation) => observation.taskId === taskId).map(copy);
  }

  async listAll(): Promise<ToolObservationRecord[]> {
    const state = await readState(this.filePath);
    return state.toolObservations.map(copy);
  }
}
```

Add helper near `copyOptional`:

```ts
function sortRunEvents(events: RunEventRecord[]): RunEventRecord[] {
  return events
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map(copy);
}
```

Extend `readState()` and `emptyState()`:

```ts
      runs: parsed.runs ?? [],
      runEvents: parsed.runEvents ?? [],
      toolObservations: parsed.toolObservations ?? [],
```

```ts
    runs: [],
    runEvents: [],
    toolObservations: [],
```

- [ ] **Step 5: Run DB tests**

Run:

```bash
pnpm --filter @lp-agent/db test
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add packages/db/src/json-file-workbench-repositories.ts packages/db/src/json-file-workbench-repositories.test.ts
git commit -m "persist run events in json state"
```

## Task 3: Context Pack Schema and Assembler

**Files:**
- Modify: `packages/api/package.json`
- Create: `packages/api/src/context-assembler.ts`
- Test: `packages/api/src/services.test.ts`

- [ ] **Step 1: Add API Zod dependency**

In `packages/api/package.json`, add this dependency:

```json
    "zod": "^3.24.0"
```

Run:

```bash
pnpm install
```

Expected: install completes without changing workspace package names or scripts.

- [ ] **Step 2: Write failing context assembler tests**

Add imports in `packages/api/src/services.test.ts`:

```ts
import {
  ContextPackSchema,
  assembleContextPack
} from "./context-assembler";
```

Add this test near the runtime context tests:

```ts
  it("assembles and validates a role-specific context pack", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a sale LP"
    });
    const draft = await service.createSkillDraft({
      manifestJson: JSON.stringify(brandSkillManifest()),
      content: "# Brand LP",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: draft.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });

    const contextPack = await assembleContextPack({
      repositories,
      service,
      projectId: project.id,
      role: "builder",
      taskId: "task_1",
      input: {
        prompt: brief.prompt,
        brief: brief.brief
      },
      now: fixedClock()
    });

    expect(ContextPackSchema.parse(contextPack)).toMatchObject({
      projectId: project.id,
      taskId: "task_1",
      role: "builder",
      input: {
        prompt: "Create a sale LP"
      },
      runtimeContext: {
        skills: [
          expect.objectContaining({
            id: "skill_brand",
            content: "# Brand LP"
          })
        ],
        artifactWorkspace: {
          mode: "memory",
          writableFiles: ["index.html", "styles.css", "script.js"]
        }
      },
      trace: {
        injected: expect.arrayContaining(["skills:1", "mcpTools:0", "modelRoutingPolicy:1"]),
        omitted: expect.arrayContaining(["history:not_implemented"])
      }
    });
  });
```

- [ ] **Step 3: Run API tests and verify failure**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: FAIL because `context-assembler.ts` does not exist.

- [ ] **Step 4: Create `context-assembler.ts`**

Create `packages/api/src/context-assembler.ts` with:

```ts
import { z } from "zod";
import type { WorkbenchRepositories } from "@lp-agent/db";
import type { LPBrief } from "@lp-agent/lp-schema";
import { agentRoles, type AgentRole } from "@lp-agent/model-gateway";
import type { RuntimeRunContext, RuntimeRunInput } from "@lp-agent/runtime-adapters";
import type { DemoWorkbenchService } from "./index";

const RuntimeSkillContextSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  scope: z.string().min(1),
  permissions: z.array(z.string()),
  entrypoints: z.array(z.string()),
  content: z.string(),
  contentType: z.enum(["text/markdown", "text/plain"])
});

const RuntimeMCPToolContextSchema = z.object({
  connectorId: z.string().min(1),
  name: z.string().min(1),
  permission: z.string().min(1),
  requiresApproval: z.boolean()
});

const RuntimeRunContextSchema = z.object({
  skills: z.array(RuntimeSkillContextSchema),
  mcpTools: z.array(RuntimeMCPToolContextSchema),
  approval: z.object({
    state: z.enum(["not_required", "pending", "approved"]),
    approvedByUserId: z.string().optional()
  }),
  artifactWorkspace: z.object({
    mode: z.enum(["memory", "filesystem"]),
    basePath: z.string().optional(),
    writableFiles: z.array(z.string().min(1))
  }),
  modelRoutingPolicy: z
    .record(
      z.enum(agentRoles),
      z.object({
        provider: z.string().min(1),
        model: z.string().min(1)
      })
    )
    .optional()
});

const RuntimeRunInputSchema = z.object({
  prompt: z.string().optional(),
  brief: z.custom<LPBrief>().optional()
});

export const ContextPackSchema = z.object({
  projectId: z.string().min(1),
  taskId: z.string().optional(),
  role: z.enum(agentRoles),
  input: RuntimeRunInputSchema,
  runtimeContext: RuntimeRunContextSchema,
  trace: z.object({
    injected: z.array(z.string().min(1)),
    omitted: z.array(z.string().min(1))
  }),
  createdAt: z.string().datetime()
});

export type ContextPack = z.infer<typeof ContextPackSchema>;
export type ContextAssemblyTrace = ContextPack["trace"];

export interface AssembleContextPackInput {
  repositories: WorkbenchRepositories;
  service: Pick<
    DemoWorkbenchService,
    "createRuntimeContextForRole"
  >;
  projectId: string;
  taskId?: string;
  role: AgentRole;
  input: RuntimeRunInput;
  now?: () => Date;
}

export async function assembleContextPack(
  input: AssembleContextPackInput
): Promise<ContextPack> {
  const createdAt = (input.now ?? (() => new Date()))().toISOString();
  const runtimeContext = await input.service.createRuntimeContextForRole({
    projectId: input.projectId,
    role: input.role
  });
  const contextPack: ContextPack = {
    projectId: input.projectId,
    taskId: input.taskId,
    role: input.role,
    input: cloneRuntimeInput(input.input),
    runtimeContext,
    trace: {
      injected: [
        `skills:${runtimeContext.skills.length}`,
        `mcpTools:${runtimeContext.mcpTools.length}`,
        runtimeContext.modelRoutingPolicy ? "modelRoutingPolicy:1" : "modelRoutingPolicy:0",
        `artifactWorkspace:${runtimeContext.artifactWorkspace.mode}`
      ],
      omitted: ["history:not_implemented", "toolObservations:not_implemented"]
    },
    createdAt
  };

  return ContextPackSchema.parse(contextPack);
}

function cloneRuntimeInput(input: RuntimeRunInput): RuntimeRunInput {
  return {
    ...(input.prompt ? { prompt: input.prompt } : {}),
    ...(input.brief ? { brief: structuredClone(input.brief) } : {})
  };
}
```

- [ ] **Step 5: Add public context creation method to `DemoWorkbenchService`**

In `packages/api/src/index.ts`, add this interface near input types:

```ts
export interface CreateRuntimeContextForRoleInput {
  projectId: string;
  role: AgentRole;
}
```

Inside `DemoWorkbenchService`, add this method near other runtime-related methods:

```ts
  async createRuntimeContextForRole(
    input: CreateRuntimeContextForRoleInput
  ): Promise<RuntimeRunContext> {
    await this.getProjectOrThrow(input.projectId);
    return this.createRuntimeContext(input.projectId, input.role);
  }
```

Export context assembler types from `packages/api/src/index.ts`:

```ts
export {
  ContextPackSchema,
  assembleContextPack,
  type ContextAssemblyTrace,
  type ContextPack
} from "./context-assembler";
```

- [ ] **Step 6: Run API tests**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add packages/api/package.json packages/api/src/context-assembler.ts packages/api/src/index.ts packages/api/src/services.test.ts pnpm-lock.yaml
git commit -m "add context pack assembler"
```

## Task 4: Run Orchestrator and Service Integration

**Files:**
- Create: `packages/api/src/run-orchestrator.ts`
- Modify: `packages/api/src/index.ts`
- Test: `packages/api/src/services.test.ts`

- [ ] **Step 1: Write failing orchestration integration tests**

Add imports in `packages/api/src/services.test.ts`:

```ts
import type { RunRecord, RunEventRecord } from "@lp-agent/db";
```

Add this test near the main LP generation tests:

```ts
  it("persists planner, builder, reviewer, and deployer run events in order", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
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
    await service.reviewPageVersion({
      projectId: project.id,
      pageVersionId: pageVersion.id
    });
    await service.approveAndCreateDeployment({
      projectId: project.id,
      pageVersionId: pageVersion.id,
      reviewerUserId: "reviewer_1"
    });

    const runs = await repositories.runs.listForProject(project.id);
    const events = await repositories.runEvents.listForProject(project.id);

    expect(runs.map((run: RunRecord) => run.role)).toEqual([
      "planner",
      "builder",
      "reviewer",
      "deployer"
    ]);
    expect(runs.every((run: RunRecord) => run.state === "completed")).toBe(true);
    expect(events.map((event: RunEventRecord) => `${event.runId}:${event.sequence}:${event.type}`)).toEqual([
      "run_planner_brief_1:1:run.started",
      "run_planner_brief_1:2:runtime.context.loaded",
      "run_planner_brief_1:3:model.completed",
      "run_planner_brief_1:4:run.completed",
      "run_builder_version_1:1:run.started",
      "run_builder_version_1:2:runtime.context.loaded",
      "run_builder_version_1:3:model.completed",
      "run_builder_version_1:4:artifact.created",
      "run_builder_version_1:5:run.completed",
      "run_reviewer_version_1:1:run.started",
      "run_reviewer_version_1:2:runtime.context.loaded",
      "run_reviewer_version_1:3:model.completed",
      "run_reviewer_version_1:4:review.completed",
      "run_reviewer_version_1:5:run.completed",
      "run_deployer_version_1:1:run.started",
      "run_deployer_version_1:2:runtime.context.loaded",
      "run_deployer_version_1:3:model.completed",
      "run_deployer_version_1:4:run.completed"
    ]);
    expect(runs[1]?.contextSummary.injected).toEqual(
      expect.arrayContaining(["artifactWorkspace:memory"])
    );
  });
```

Add this failure test:

```ts
  it("persists failed run events before surfacing generation failure", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const builderRuntime = new RecordingRuntime({ state: "failed" });
    const service = new DemoWorkbenchService({
      repositories,
      builderRuntime,
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a sale LP"
    });

    await expect(
      service.generatePageVersion({
        projectId: project.id,
        briefId: brief.id
      })
    ).rejects.toThrow("Builder run failed.");

    await expect(repositories.runs.listForProject(project.id)).resolves.toEqual([
      expect.objectContaining({ role: "planner", state: "completed" }),
      expect.objectContaining({ role: "builder", state: "failed" })
    ]);
    await expect(repositories.runEvents.listForProject(project.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: "run_builder_version_1",
          type: "run.failed"
        })
      ])
    );
  });
```

- [ ] **Step 2: Run API tests and verify failure**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: FAIL because run orchestration is not integrated.

- [ ] **Step 3: Create `run-orchestrator.ts`**

Create `packages/api/src/run-orchestrator.ts` with:

```ts
import { z } from "zod";
import type {
  RunEventRecord,
  RunRecord,
  WorkbenchRepositories
} from "@lp-agent/db";
import type {
  AgentRuntimeAdapter,
  RuntimeEvent,
  RuntimeRunResult
} from "@lp-agent/runtime-adapters";
import { assembleContextPack, type ContextPack } from "./context-assembler";
import type { DemoWorkbenchService } from "./index";

export const RunEventRecordSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  projectId: z.string().min(1),
  taskId: z.string().optional(),
  sequence: z.number().int().min(1),
  type: z.string().min(1),
  message: z.string().min(1),
  payload: z.record(z.unknown()),
  createdAt: z.string().datetime()
});

export interface RunAgentStepInput {
  repositories: WorkbenchRepositories;
  service: Pick<DemoWorkbenchService, "createRuntimeContextForRole">;
  runtime: AgentRuntimeAdapter;
  runId: string;
  projectId: string;
  taskId?: string;
  role: "planner" | "builder" | "reviewer" | "deployer";
  input: ContextPack["input"];
  now?: () => Date;
}

export interface RunAgentStepResult {
  run: RunRecord;
  events: RunEventRecord[];
  contextPack: ContextPack;
  result: RuntimeRunResult;
}

export async function runAgentStep(input: RunAgentStepInput): Promise<RunAgentStepResult> {
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const contextPack = await assembleContextPack({
    repositories: input.repositories,
    service: input.service,
    projectId: input.projectId,
    taskId: input.taskId,
    role: input.role,
    input: input.input,
    now
  });

  const startedRun: RunRecord = {
    id: input.runId,
    projectId: input.projectId,
    taskId: input.taskId,
    role: input.role,
    state: "running",
    startedAt,
    contextSummary: {
      injected: [...contextPack.trace.injected],
      omitted: [...contextPack.trace.omitted]
    }
  };
  await input.repositories.runs.save(startedRun);

  const result = await input.runtime.run({
    runId: input.runId,
    projectId: input.projectId,
    role: input.role,
    input: contextPack.input,
    context: contextPack.runtimeContext
  });
  const completedAt = now().toISOString();
  const run: RunRecord = {
    ...startedRun,
    state: result.state === "completed" ? "completed" : "failed",
    completedAt
  };
  await input.repositories.runs.save(run);

  const events = result.events.map((event, index) =>
    toRunEventRecord({
      event,
      runId: input.runId,
      projectId: input.projectId,
      taskId: input.taskId,
      sequence: index + 1,
      createdAt: completedAt
    })
  );
  for (const event of events) {
    await input.repositories.runEvents.save(event);
  }

  return {
    run,
    events,
    contextPack,
    result
  };
}

function toRunEventRecord(input: {
  event: RuntimeEvent;
  runId: string;
  projectId: string;
  taskId?: string;
  sequence: number;
  createdAt: string;
}): RunEventRecord {
  const payload = { ...input.event };
  delete (payload as { message?: string }).message;
  const record: RunEventRecord = {
    id: `${input.runId}_event_${input.sequence}`,
    runId: input.runId,
    projectId: input.projectId,
    taskId: input.taskId,
    sequence: input.sequence,
    type: input.event.type,
    message: input.event.message,
    payload,
    createdAt: input.createdAt
  };
  return RunEventRecordSchema.parse(record);
}
```

- [ ] **Step 4: Inject planner and deployer runtimes**

In `packages/api/src/index.ts`, extend `DemoWorkbenchServiceOptions`:

```ts
  plannerRuntime?: AgentRuntimeAdapter;
  deployerRuntime?: AgentRuntimeAdapter;
```

Add class fields:

```ts
  private readonly plannerRuntime: AgentRuntimeAdapter;
  private readonly deployerRuntime: AgentRuntimeAdapter;
```

Initialize in the constructor:

```ts
    this.plannerRuntime = options.plannerRuntime ?? createLocalRuntimeAdapter();
    this.deployerRuntime = options.deployerRuntime ?? createLocalRuntimeAdapter();
```

Import orchestrator:

```ts
import { runAgentStep } from "./run-orchestrator";
```

- [ ] **Step 5: Use orchestrator in service methods**

In `createBriefFromPrompt`, after reserving the brief id and before saving the brief, run planner:

```ts
      const briefId = nextSequentialId("brief", existingBriefs.map((record) => record.id));
      await runAgentStep({
        repositories: this.repositories,
        service: this,
        runtime: this.plannerRuntime,
        runId: `run_planner_${briefId}`,
        projectId: input.projectId,
        role: "planner",
        input: {
          prompt: input.prompt
        },
        now: this.now
      });
      const brief: BriefRecord = {
        id: briefId,
        projectId: input.projectId,
        prompt: input.prompt,
        brief: copyBrief(sampleBrief),
        createdAt: this.timestamp()
      };
```

In `generatePageVersion`, replace the direct `this.builderRuntime.run()` call with:

```ts
      const { result } = await runAgentStep({
        repositories: this.repositories,
        service: this,
        runtime: this.builderRuntime,
        runId: `run_builder_${pageVersionId}`,
        projectId: input.projectId,
        role: "builder",
        input: {
          brief: copyBrief(brief.brief),
          prompt: brief.prompt
        },
        now: this.now
      });
```

In `reviewPageVersion`, replace the direct `this.reviewerRuntime.run()` call with:

```ts
    const { result } = await runAgentStep({
      repositories: this.repositories,
      service: this,
      runtime: this.reviewerRuntime,
      runId: `run_reviewer_${pageVersion.id}`,
      projectId: input.projectId,
      role: "reviewer",
      input: {
        brief: copyBrief(brief.brief),
        prompt: "Review for launch blockers."
      },
      now: this.now
    });
```

In `approveAndCreateDeployment`, before `deploymentAdapter.createHandoff()`, add:

```ts
    await runAgentStep({
      repositories: this.repositories,
      service: this,
      runtime: this.deployerRuntime,
      runId: `run_deployer_${pageVersion.id}`,
      projectId: input.projectId,
      role: "deployer",
      input: {
        prompt: "Prepare deployment handoff."
      },
      now: this.now
    });
```

Export orchestrator types from `packages/api/src/index.ts`:

```ts
export {
  RunEventRecordSchema,
  runAgentStep,
  type RunAgentStepInput,
  type RunAgentStepResult
} from "./run-orchestrator";
```

Export DB run record types from the `@lp-agent/db` export block:

```ts
  RunEventRecord,
  RunRecord,
  ToolObservationRecord
```

- [ ] **Step 6: Run API tests**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add packages/api/src/index.ts packages/api/src/run-orchestrator.ts packages/api/src/services.test.ts
git commit -m "persist agent run events"
```

## Task 5: Web Timeline From Persisted Run Events

**Files:**
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`
- Modify: `apps/web/src/lib/chat-workbench.ts`
- Modify: `apps/web/src/lib/chat-workbench.test.ts`
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Write failing Web store test**

In `apps/web/src/lib/workbench-store.test.ts`, add a test that creates a repository-backed LP task and expects run events in page state:

```ts
  it("includes persisted run events for the active task project", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });
    const result = await store.submitTaskPrompt({
      prompt: "Create a simple HTML LP",
      implicitProjectName: "Implicit project"
    });
    if (!result.ok) {
      throw new Error("Expected prompt submission to succeed.");
    }

    const state = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId
    });

    expect(state.kind).toBe("task_ready");
    if (state.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(state.runEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining(["run.started", "runtime.context.loaded", "model.completed"])
    );
  });
```

- [ ] **Step 2: Extend Web page state**

In `apps/web/src/lib/workbench-store.ts`, import:

```ts
  type RunEventRecord,
```

Add `runEvents: RunEventRecord[];` to the `task_ready` branch of `WorkbenchPageState`.

In `getPageState()`, add:

```ts
      const runEvents = activeProjectId
        ? await repositories.runEvents.listForProject(activeProjectId)
        : [];
```

Return:

```ts
        runEvents
```

- [ ] **Step 3: Write failing chat-workbench test**

In `apps/web/src/lib/chat-workbench.test.ts`, import `type RunEventRecord` from `@lp-agent/api` and add:

```ts
  it("uses persisted run events for the LP tool timeline when provided", () => {
    const copy = getWorkbenchCopy("en");
    const runEvents: RunEventRecord[] = [
      {
        id: "event_1",
        runId: "run_planner_brief_1",
        projectId: "project_1",
        sequence: 1,
        type: "run.started",
        message: "planner run started",
        payload: { role: "planner" },
        createdAt: "2026-05-14T00:00:00.000Z"
      },
      {
        id: "event_2",
        runId: "run_builder_version_1",
        projectId: "project_1",
        sequence: 1,
        type: "run.started",
        message: "builder run started",
        payload: { role: "builder" },
        createdAt: "2026-05-14T00:00:01.000Z"
      }
    ];

    const thread = createChatWorkbenchThread({
      copy,
      prompt: "Create LP",
      objective: "Convert",
      pageVersion: {
        id: "version_1",
        projectId: "project_1",
        briefId: "brief_1",
        artifacts: completeArtifacts(),
        reviewStatus: "passed",
        findings: [],
        createdAt: "2026-05-14T00:00:00.000Z"
      },
      downloadLinks: [],
      runEvents
    });

    expect(thread.toolEvents.map((event) => event.id)).toEqual([
      "run_planner_brief_1:1",
      "run_builder_version_1:1"
    ]);
    expect(thread.toolEvents[0]).toMatchObject({
      role: "planner",
      operation: "planner run started"
    });
  });
```

- [ ] **Step 4: Update chat thread builder**

In `apps/web/src/lib/chat-workbench.ts`, import:

```ts
import type { PageVersionRecord, RunEventRecord } from "@lp-agent/api";
```

Extend `CreateChatWorkbenchThreadInput`:

```ts
  runEvents?: RunEventRecord[];
```

Change `createChatWorkbenchThread` signature to receive `runEvents = []`.

Replace the current `const toolEvents: ChatToolEvent[] = [...]` with:

```ts
  const toolEvents: ChatToolEvent[] = runEvents.length > 0
    ? runEvents.map((event) => toChatToolEvent(event, copy))
    : createFallbackToolEvents({ copy, objective, pageVersion, downloadLinks });
```

Add helpers:

```ts
function createFallbackToolEvents(input: {
  copy: WorkbenchCopy;
  objective: string;
  pageVersion: PageVersionRecord;
  downloadLinks: ArtifactDownloadLink[];
}): ChatToolEvent[] {
  const reviewStatus = input.copy.status[input.pageVersion.reviewStatus];
  const findingsCount = input.pageVersion.findings.length;
  return [
    {
      id: "planner",
      role: "planner",
      label: input.copy.run.planner[0],
      operation: input.copy.run.planner[1],
      status: "complete",
      statusLabel: input.copy.chat.toolStatusComplete,
      meta: `${input.copy.fields.objective}: ${input.objective}`
    },
    {
      id: "builder",
      role: "builder",
      label: input.copy.run.builder[0],
      operation: input.copy.run.builder[1],
      status: "complete",
      statusLabel: input.copy.chat.toolStatusComplete,
      meta: `${input.copy.chat.filesLabel}: ${input.downloadLinks.length}`
    },
    {
      id: "reviewer",
      role: "reviewer",
      label: input.copy.run.reviewer[0],
      operation: input.copy.run.reviewer[1],
      status: "complete",
      statusLabel: input.copy.chat.toolStatusComplete,
      meta: `${input.copy.status.review}: ${reviewStatus} - ${input.copy.chat.findingsLabel}: ${findingsCount}`
    }
  ];
}

function toChatToolEvent(event: RunEventRecord, copy: WorkbenchCopy): ChatToolEvent {
  const role = toChatToolRole(event);
  return {
    id: `${event.runId}:${event.sequence}`,
    role,
    label: role === "assistant" ? copy.chat.generalToolLabel : copy.run[role][0],
    operation: event.message,
    status: "complete",
    statusLabel: copy.chat.toolStatusComplete,
    meta: event.type
  };
}

function toChatToolRole(event: RunEventRecord): ChatToolRole {
  const role = event.payload.role;
  if (role === "planner" || role === "builder" || role === "reviewer") {
    return role;
  }
  return "assistant";
}
```

- [ ] **Step 5: Pass run events from page**

In `apps/web/src/app/page.tsx`, when calling `createChatWorkbenchThread`, add:

```tsx
            runEvents: pageState.runEvents
```

- [ ] **Step 6: Run Web tests**

Run:

```bash
pnpm --filter @lp-agent/web test
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

Run:

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/lib/chat-workbench.ts apps/web/src/lib/chat-workbench.test.ts apps/web/src/app/page.tsx
git commit -m "show persisted agent run timeline"
```

## Task 6: Documentation and Full Verification

**Files:**
- Modify: `docs/development.md`
- Modify: `docs/agent-development-learning.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Update development docs**

Add this paragraph under `## Current MVP Behavior` in `docs/development.md`:

```md
Stage 2 Milestone 6 persists deterministic planner, builder, reviewer, and deployer run records with ordered run events. Runtime calls now pass through a context assembly boundary before they reach the local runtime adapter. The first context pack includes project/task input, published project skills, visible MCP tools, model routing policy, approval state, and artifact workspace metadata; compression, retrieval, streaming, real tool execution, and real model providers remain future slices.
```

- [ ] **Step 2: Update the Chinese learning notes**

In `docs/agent-development-learning.md`, under `### 已经完成或基本成型`, add:

```md
- Run Orchestration v0：planner、builder、reviewer、deployer 的 deterministic run records 和 ordered run events。
- Context Pack v0：运行前通过 context assembler 组合 task/project input、skills、MCP tools、model routing、approval 和 artifact workspace。
```

Under `### 还没做`, remove these bullets if they are still present:

```md
- 真正的 run orchestrator。
- Context Assembler / Context Pack。
```

Under `### 阶段 1：跑通最简单 Agent Run`, add:

```md
本阶段完成后，学习重点从“为什么要记录 run event”转为“如何用这些 event 支撑失败诊断、刷新恢复和后续流式 UI”。
```

- [ ] **Step 3: Update Superpowers README**

In `docs/superpowers/README.md`, add this item after the MCP connector registry plan:

```md
21. `plans/2026-05-14-run-orchestration-context-assembly.md`
   - Stage 2 Milestone 6 implementation plan.
   - Read this after the MCP connector registry plan when implementing or auditing persisted run events, context pack assembly, runtime schema validation, and Web timeline rendering.
```

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected:

- `pnpm test`: all Vitest test files pass.
- `pnpm typecheck`: all workspace TypeScript projects pass.
- `pnpm build`: all workspace build scripts pass.
- `git diff --check`: no whitespace errors.

- [ ] **Step 5: Commit Task 6**

Run:

```bash
git add docs/development.md docs/agent-development-learning.md docs/superpowers/README.md
git commit -m "document run orchestration milestone"
```

## Self-Review

- Spec coverage: Milestone 6 run persistence, ordered events, failure diagnostics, Web refresh visibility, context assembly, and runtime schema validation are each covered by tasks.
- Scope control: real model calls, MCP execution, streaming, interrupt, vector retrieval, and deployment UI are explicitly out of scope.
- Type consistency: `RunRecord`, `RunEventRecord`, `ToolObservationRecord`, `ContextPack`, and `RunAgentStepResult` are introduced before use.
- Maintenance coverage: `docs/superpowers/README.md` and `docs/agent-development-learning.md` are updated in the same milestone.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-14-run-orchestration-context-assembly.md`. Two execution options:

**1. Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.
