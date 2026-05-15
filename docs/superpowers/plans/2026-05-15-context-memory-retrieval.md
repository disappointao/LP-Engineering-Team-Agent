# Context Memory Retrieval v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic project-scoped context memory summaries to Context Pack so future runs can receive safe message, run, tool, and artifact history without vector search or model-generated summaries.

**Architecture:** Add a small API-owned `context-memory.ts` module that reads existing repositories, creates bounded schema-validated summaries, and injects them through `ContextPack.runtimeContext.memory`. Extend model/runtime context types so memory can reach model calls, while keeping deterministic runtime output unchanged and keeping raw tool output, secrets, and full artifacts out of memory.

**Tech Stack:** TypeScript, Zod, Vitest, pnpm monorepo, existing `@lp-agent/db`, `@lp-agent/api`, `@lp-agent/model-gateway`, and `@lp-agent/runtime-adapters` packages.

---

## File Structure

- Modify `packages/model-gateway/src/index.ts`
  - Add structural `ModelContextMemory` types.
  - Add optional `memory` to `ModelRequestContext`.
  - Deep-clone memory in audit entries.
- Modify `packages/model-gateway/src/index.test.ts`
  - Prove model context memory is audited defensively.
- Modify `packages/runtime-adapters/src/index.ts`
  - Add optional memory to `RuntimeRunContext`.
  - Clone memory and forward it to `ModelRequestContext`.
- Modify `packages/runtime-adapters/src/index.test.ts`
  - Prove runtime forwards memory to model calls without changing deterministic artifacts.
- Create `packages/api/src/context-memory.ts`
  - Define `ContextMemorySchema`.
  - Implement deterministic keyword retrieval and bounded summary assembly.
- Create `packages/api/src/context-memory.test.ts`
  - Cover project scoping, ranking, budget, and raw-output safety.
- Modify `packages/api/package.json`
  - Include `src/context-memory.test.ts` in the API test script.
- Modify `packages/api/src/context-assembler.ts`
  - Validate memory in `RuntimeRunContextSchema`.
  - Inject `assembleContextMemory()` output into `runtimeContext.memory`.
  - Replace `history:not_implemented` and `toolObservations:not_implemented` with memory trace counts/omissions.
- Modify `packages/api/src/services.test.ts`
  - Cover Context Pack memory injection and run-step delivery to runtime.
- Modify `packages/api/src/index.ts`
  - Export context memory schemas/types for future packages and tests.
- Modify `docs/agent-development-learning.md`
  - Mark Stage 5 v0 implementation as completed after final verification.
- Modify `docs/superpowers/README.md`
  - Add this implementation plan to the reading order.

## Commit Discipline

Keep the two root-level `微信图片_*.png` files untracked and unstaged. Before every commit, run:

```bash
git status --short
```

Expected before each commit: only the files listed in that task are staged, plus the two image files remain untracked.

---

### Task 1: Add Memory to Model and Runtime Context Contracts

**Files:**
- Modify: `packages/model-gateway/src/index.ts`
- Modify: `packages/model-gateway/src/index.test.ts`
- Modify: `packages/runtime-adapters/src/index.ts`
- Modify: `packages/runtime-adapters/src/index.test.ts`

- [ ] **Step 1: Write the failing model-gateway audit test**

In `packages/model-gateway/src/index.test.ts`, add this test after `"records usage metadata for audit"`:

```ts
  it("clones context memory into model audit entries defensively", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
    const memory = {
      messages: [
        {
          id: "message_1",
          taskId: "task_1",
          role: "user",
          preview: "Create a spring sale landing page",
          createdAt: "2026-05-15T08:00:00.000Z",
          score: 12
        }
      ],
      runs: [
        {
          id: "run_builder_1",
          taskId: "task_1",
          role: "builder",
          state: "completed",
          eventTypes: ["run.started", "artifact.created", "run.completed"],
          startedAt: "2026-05-15T08:01:00.000Z",
          completedAt: "2026-05-15T08:01:01.000Z",
          score: 9
        }
      ],
      tools: [
        {
          id: "observation_1",
          runId: "run_skill_command_1",
          taskId: "task_1",
          toolName: "static-deploy",
          state: "completed",
          outputSummary: "stdout: 47 chars\nstderr: 0 chars",
          exitCode: 0,
          createdAt: "2026-05-15T08:02:00.000Z",
          completedAt: "2026-05-15T08:02:01.000Z",
          score: 8
        }
      ],
      artifacts: [
        {
          pageVersionId: "page_version_1",
          briefId: "brief_1",
          title: "Spring Sale",
          objective: "Convert paid traffic",
          files: [
            { name: "index.html", characterCount: 1200 },
            { name: "styles.css", characterCount: 800 },
            { name: "script.js", characterCount: 120 }
          ],
          createdAt: "2026-05-15T08:03:00.000Z",
          score: 6
        }
      ],
      retrieval: {
        query: "spring sale builder",
        strategy: "deterministic-keyword-v0",
        selected: ["message:message_1", "run:run_builder_1"],
        omitted: ["memory:artifacts:budget_exceeded"]
      }
    };

    await gateway.complete({
      role: "builder",
      prompt: "Build",
      projectId: "project_1",
      context: {
        skills: [],
        mcpTools: [],
        approval: { state: "not_required" },
        artifactWorkspace: {
          mode: "memory",
          writableFiles: ["index.html", "styles.css", "script.js"]
        },
        memory
      }
    });

    memory.messages[0]!.preview = "mutated";
    memory.retrieval.selected.push("message:mutated");

    expect(gateway.getAuditLog()[0]?.context?.memory).toEqual({
      messages: [
        expect.objectContaining({
          id: "message_1",
          preview: "Create a spring sale landing page"
        })
      ],
      runs: [
        expect.objectContaining({
          id: "run_builder_1",
          eventTypes: ["run.started", "artifact.created", "run.completed"]
        })
      ],
      tools: [
        expect.objectContaining({
          id: "observation_1",
          outputSummary: "stdout: 47 chars\nstderr: 0 chars",
          exitCode: 0
        })
      ],
      artifacts: [
        expect.objectContaining({
          pageVersionId: "page_version_1",
          files: [
            { name: "index.html", characterCount: 1200 },
            { name: "styles.css", characterCount: 800 },
            { name: "script.js", characterCount: 120 }
          ]
        })
      ],
      retrieval: {
        query: "spring sale builder",
        strategy: "deterministic-keyword-v0",
        selected: ["message:message_1", "run:run_builder_1"],
        omitted: ["memory:artifacts:budget_exceeded"]
      }
    });
  });
```

- [ ] **Step 2: Write the failing runtime forwarding test**

In `packages/runtime-adapters/src/index.test.ts`, update `"passes scoped skills, visible MCP tools, approval, and workspace context into model calls"`.

Inside the `context` object, after `artifactWorkspace`, add:

```ts
      memory: {
        messages: [
          {
            id: "message_1",
            taskId: "task_1",
            role: "user",
            preview: "Create a spring sale landing page",
            createdAt: "2026-05-15T08:00:00.000Z",
            score: 12
          }
        ],
        runs: [],
        tools: [
          {
            id: "observation_1",
            runId: "run_skill_command_1",
            taskId: "task_1",
            toolName: "static-deploy",
            state: "completed",
            outputSummary: "stdout: 47 chars\nstderr: 0 chars",
            exitCode: 0,
            createdAt: "2026-05-15T08:02:00.000Z",
            score: 8
          }
        ],
        artifacts: [],
        retrieval: {
          query: "spring sale",
          strategy: "deterministic-keyword-v0",
          selected: ["message:message_1", "tool:observation_1"],
          omitted: []
        }
      }
```

In the same test's `expect(gateway.requests[0]?.context).toEqual(...)`, add the same `memory` object under `artifactWorkspace`.

Then add this assertion after the existing context assertion:

```ts
    expect(result.artifacts?.indexHtml).toContain("Spring essentials, ready today");
```

- [ ] **Step 3: Run contract tests and verify they fail**

Run:

```bash
pnpm --filter @lp-agent/model-gateway test
pnpm --filter @lp-agent/runtime-adapters test
```

Expected: TypeScript/Vitest fails because `memory` is not part of `ModelRequestContext` or `RuntimeRunContext`.

- [ ] **Step 4: Add model-gateway memory types and clone helpers**

In `packages/model-gateway/src/index.ts`, add these interfaces after `ModelArtifactWorkspaceContext`:

```ts
export type ModelContextMemoryStrategy = "deterministic-keyword-v0";

export interface ModelContextMemoryMessageSummary {
  id: string;
  taskId: string;
  role: string;
  preview: string;
  createdAt: string;
  score: number;
}

export interface ModelContextMemoryRunSummary {
  id: string;
  taskId?: string;
  role: AgentRole;
  state: string;
  eventTypes: string[];
  startedAt: string;
  completedAt?: string;
  score: number;
}

export interface ModelContextMemoryToolSummary {
  id: string;
  runId: string;
  taskId?: string;
  toolName: string;
  state: string;
  outputSummary: string;
  exitCode?: number;
  errorName?: string;
  createdAt: string;
  completedAt?: string;
  score: number;
}

export interface ModelContextMemoryArtifactSummary {
  pageVersionId: string;
  briefId: string;
  title?: string;
  objective?: string;
  files: Array<{
    name: "index.html" | "styles.css" | "script.js";
    characterCount: number;
  }>;
  createdAt: string;
  score: number;
}

export interface ModelContextMemory {
  messages: ModelContextMemoryMessageSummary[];
  runs: ModelContextMemoryRunSummary[];
  tools: ModelContextMemoryToolSummary[];
  artifacts: ModelContextMemoryArtifactSummary[];
  retrieval: {
    query: string;
    strategy: ModelContextMemoryStrategy;
    selected: string[];
    omitted: string[];
  };
}
```

Then add `memory?: ModelContextMemory;` to `ModelRequestContext`.

Replace `cloneModelRequestContext()` with:

```ts
function cloneModelRequestContext(context: ModelRequestContext): ModelRequestContext {
  return {
    skills: context.skills.map((skill) => ({
      ...skill,
      permissions: [...skill.permissions],
      entrypoints: [...skill.entrypoints]
    })),
    mcpTools: context.mcpTools.map((tool) => ({ ...tool })),
    approval: { ...context.approval },
    artifactWorkspace: {
      ...context.artifactWorkspace,
      writableFiles: [...context.artifactWorkspace.writableFiles]
    },
    ...(context.memory ? { memory: cloneContextMemory(context.memory) } : {})
  };
}

function cloneContextMemory(memory: ModelContextMemory): ModelContextMemory {
  return {
    messages: memory.messages.map((message) => ({ ...message })),
    runs: memory.runs.map((run) => ({
      ...run,
      eventTypes: [...run.eventTypes]
    })),
    tools: memory.tools.map((tool) => ({ ...tool })),
    artifacts: memory.artifacts.map((artifact) => ({
      ...artifact,
      files: artifact.files.map((file) => ({ ...file }))
    })),
    retrieval: {
      query: memory.retrieval.query,
      strategy: memory.retrieval.strategy,
      selected: [...memory.retrieval.selected],
      omitted: [...memory.retrieval.omitted]
    }
  };
}
```

- [ ] **Step 5: Add runtime memory forwarding**

In `packages/runtime-adapters/src/index.ts`, add `type ModelContextMemory` to the `@lp-agent/model-gateway` import list.

Add `memory?: ModelContextMemory;` to `RuntimeRunContext`.

In `toModelRequestContext()`, after `artifactWorkspace`, add:

```ts
    ...(context.memory ? { memory: cloneContextMemory(context.memory) } : {})
```

In `cloneRuntimeContext()`, after `artifactWorkspace`, add:

```ts
    ...(context.memory ? { memory: cloneContextMemory(context.memory) } : {}),
```

Add this helper before `cloneModelRoutingPolicy()`:

```ts
function cloneContextMemory(memory: ModelContextMemory): ModelContextMemory {
  return {
    messages: memory.messages.map((message) => ({ ...message })),
    runs: memory.runs.map((run) => ({
      ...run,
      eventTypes: [...run.eventTypes]
    })),
    tools: memory.tools.map((tool) => ({ ...tool })),
    artifacts: memory.artifacts.map((artifact) => ({
      ...artifact,
      files: artifact.files.map((file) => ({ ...file }))
    })),
    retrieval: {
      query: memory.retrieval.query,
      strategy: memory.retrieval.strategy,
      selected: [...memory.retrieval.selected],
      omitted: [...memory.retrieval.omitted]
    }
  };
}
```

- [ ] **Step 6: Run contract tests and verify they pass**

Run:

```bash
pnpm --filter @lp-agent/model-gateway test
pnpm --filter @lp-agent/runtime-adapters test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git status --short
git add packages/model-gateway/src/index.ts packages/model-gateway/src/index.test.ts packages/runtime-adapters/src/index.ts packages/runtime-adapters/src/index.test.ts
git commit -m "add context memory runtime contracts"
```

---

### Task 2: Add Context Memory Schema and Message Retrieval

**Files:**
- Create: `packages/api/src/context-memory.ts`
- Create: `packages/api/src/context-memory.test.ts`
- Modify: `packages/api/package.json`

- [ ] **Step 1: Add the API test script entry**

In `packages/api/package.json`, update the `test` script so it includes `src/context-memory.test.ts`:

```json
"test": "vitest run src/structured-lp-brief.test.ts src/structured-static-artifacts.test.ts src/skill-command-execution.test.ts src/run-orchestrator.test.ts src/context-memory.test.ts src/services.test.ts"
```

- [ ] **Step 2: Write failing schema and message retrieval tests**

Create `packages/api/src/context-memory.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { createInMemoryWorkbenchRepositories } from "@lp-agent/db";
import { sampleBrief } from "@lp-agent/lp-schema";
import {
  ContextMemorySchema,
  assembleContextMemory,
  toContextMemoryQuery,
  truncatePreview
} from "./context-memory";

describe("context memory", () => {
  it("validates the deterministic context memory shape", () => {
    const memory = ContextMemorySchema.parse({
      messages: [
        {
          id: "message_1",
          taskId: "task_1",
          role: "user",
          preview: "Create a spring sale landing page",
          createdAt: "2026-05-15T08:00:00.000Z",
          score: 12
        }
      ],
      runs: [],
      tools: [],
      artifacts: [],
      retrieval: {
        query: "spring sale",
        strategy: "deterministic-keyword-v0",
        selected: ["message:message_1"],
        omitted: ["memory:runs:none", "memory:tools:none", "memory:artifacts:none"]
      }
    });

    expect(memory.retrieval.strategy).toBe("deterministic-keyword-v0");
  });

  it("derives a deterministic retrieval query from prompt and brief", () => {
    expect(
      toContextMemoryQuery({
        role: "builder",
        input: {
          prompt: "Build a spring sale page",
          brief: {
            ...sampleBrief,
            objective: "Convert paid shoppers",
            audience: "Returning customers",
            offer: "Save 20%",
            primaryCta: "Shop now"
          }
        }
      })
    ).toBe("builder Build a spring sale page Convert paid shoppers Returning customers Save 20% Shop now");
  });

  it("truncates previews at the configured length", () => {
    expect(truncatePreview("abcdef", 4)).toBe("abcd");
    expect(truncatePreview("abc", 4)).toBe("abc");
  });

  it("retrieves project-scoped message summaries and excludes other projects", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.projects.save({
      id: "project_1",
      name: "Spring",
      createdAt: "2026-05-15T08:00:00.000Z"
    });
    await repositories.projects.save({
      id: "project_2",
      name: "Summer",
      createdAt: "2026-05-15T08:00:01.000Z"
    });
    await repositories.tasks.save({
      id: "task_1",
      projectId: "project_1",
      title: "Spring LP",
      type: "lp_generation",
      status: "complete",
      createdAt: "2026-05-15T08:01:00.000Z"
    });
    await repositories.tasks.save({
      id: "task_2",
      projectId: "project_2",
      title: "Summer LP",
      type: "lp_generation",
      status: "complete",
      createdAt: "2026-05-15T08:02:00.000Z"
    });
    await repositories.messages.save({
      id: "message_1",
      taskId: "task_1",
      role: "user",
      content: "Create a spring sale landing page",
      createdAt: "2026-05-15T08:03:00.000Z"
    });
    await repositories.messages.save({
      id: "message_2",
      taskId: "task_2",
      role: "user",
      content: "Create a summer campaign with secret-token",
      createdAt: "2026-05-15T08:04:00.000Z"
    });

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      input: { prompt: "spring sale" }
    });

    expect(memory.messages.map((message) => message.id)).toEqual(["message_1"]);
    expect(JSON.stringify(memory)).not.toContain("summer");
    expect(JSON.stringify(memory)).not.toContain("secret-token");
    expect(memory.retrieval.selected).toContain("message:message_1");
    expect(memory.retrieval.omitted).toEqual(
      expect.arrayContaining(["memory:runs:none", "memory:tools:none", "memory:artifacts:none"])
    );
  });

  it("ranks current task and keyword matched messages before older non-matches", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.tasks.save({
      id: "task_1",
      projectId: "project_1",
      title: "Spring LP",
      type: "lp_generation",
      status: "complete",
      createdAt: "2026-05-15T08:00:00.000Z"
    });
    await repositories.tasks.save({
      id: "task_2",
      projectId: "project_1",
      title: "Older LP",
      type: "lp_generation",
      status: "complete",
      createdAt: "2026-05-15T08:00:01.000Z"
    });
    await repositories.messages.save({
      id: "message_old",
      taskId: "task_2",
      role: "user",
      content: "Generic landing page request",
      createdAt: "2026-05-15T08:01:00.000Z"
    });
    await repositories.messages.save({
      id: "message_current",
      taskId: "task_1",
      role: "user",
      content: "Spring sale offer with hero CTA",
      createdAt: "2026-05-15T08:01:01.000Z"
    });

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      input: { prompt: "spring sale" }
    });

    expect(memory.messages.map((message) => message.id)).toEqual([
      "message_current",
      "message_old"
    ]);
    expect(memory.messages[0]!.score).toBeGreaterThan(memory.messages[1]!.score);
  });
});
```

- [ ] **Step 3: Run the new test and verify it fails**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: FAIL because `context-memory.ts` does not exist.

- [ ] **Step 4: Create the schema and message retrieval implementation**

Create `packages/api/src/context-memory.ts` with:

```ts
import { z } from "zod";
import type { WorkbenchMessageRecord, WorkbenchRepositories } from "@lp-agent/db";
import { agentRoles, type AgentRole } from "@lp-agent/model-gateway";
import type { RuntimeRunInput } from "@lp-agent/runtime-adapters";

export const CONTEXT_MEMORY_STRATEGY = "deterministic-keyword-v0" as const;

export interface ContextMemoryLimits {
  messages: number;
  runs: number;
  tools: number;
  artifacts: number;
  previewCharacters: number;
  totalCharacters: number;
}

export const DEFAULT_CONTEXT_MEMORY_LIMITS: ContextMemoryLimits = Object.freeze({
  messages: 6,
  runs: 6,
  tools: 6,
  artifacts: 2,
  previewCharacters: 240,
  totalCharacters: 4000
});

const ContextMemoryFileSchema = z.object({
  name: z.enum(["index.html", "styles.css", "script.js"]),
  characterCount: z.number().int().min(0)
});

export const ContextMemoryMessageSummarySchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  role: z.string().min(1),
  preview: z.string(),
  createdAt: z.string().datetime(),
  score: z.number()
});

export const ContextMemoryRunSummarySchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1).optional(),
  role: z.enum(agentRoles),
  state: z.string().min(1),
  eventTypes: z.array(z.string().min(1)),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  score: z.number()
});

export const ContextMemoryToolSummarySchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  taskId: z.string().min(1).optional(),
  toolName: z.string().min(1),
  state: z.string().min(1),
  outputSummary: z.string(),
  exitCode: z.number().int().optional(),
  errorName: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  score: z.number()
});

export const ContextMemoryArtifactSummarySchema = z.object({
  pageVersionId: z.string().min(1),
  briefId: z.string().min(1),
  title: z.string().optional(),
  objective: z.string().optional(),
  files: z.array(ContextMemoryFileSchema),
  createdAt: z.string().datetime(),
  score: z.number()
});

export const ContextMemorySchema = z.object({
  messages: z.array(ContextMemoryMessageSummarySchema),
  runs: z.array(ContextMemoryRunSummarySchema),
  tools: z.array(ContextMemoryToolSummarySchema),
  artifacts: z.array(ContextMemoryArtifactSummarySchema),
  retrieval: z.object({
    query: z.string(),
    strategy: z.literal(CONTEXT_MEMORY_STRATEGY),
    selected: z.array(z.string().min(1)),
    omitted: z.array(z.string().min(1))
  })
});

export type ContextMemory = z.infer<typeof ContextMemorySchema>;

export interface AssembleContextMemoryInput {
  repositories: WorkbenchRepositories;
  projectId: string;
  taskId?: string;
  role: AgentRole;
  input: RuntimeRunInput;
  limits?: Partial<ContextMemoryLimits>;
}

interface Ranked<T> {
  value: T;
  score: number;
}

export async function assembleContextMemory(
  input: AssembleContextMemoryInput
): Promise<ContextMemory> {
  const limits = { ...DEFAULT_CONTEXT_MEMORY_LIMITS, ...input.limits };
  const query = toContextMemoryQuery({ role: input.role, input: input.input });
  const keywords = toKeywords(query);
  const omitted: string[] = [];
  const selected: string[] = [];
  const tasks = await input.repositories.tasks.listAll();
  const projectTaskIds = new Set(
    tasks
      .filter((task) => task.projectId === input.projectId)
      .map((task) => task.id)
  );

  const messages = summarizeMessages({
    messages: await input.repositories.messages.listAll(),
    projectTaskIds,
    taskId: input.taskId,
    keywords,
    limits
  });
  if (messages.length === 0) {
    omitted.push("memory:messages:none");
  }
  selected.push(...messages.map((message) => `message:${message.id}`));

  const memory: ContextMemory = {
    messages,
    runs: [],
    tools: [],
    artifacts: [],
    retrieval: {
      query,
      strategy: CONTEXT_MEMORY_STRATEGY,
      selected,
      omitted: [
        ...omitted,
        "memory:runs:none",
        "memory:tools:none",
        "memory:artifacts:none"
      ]
    }
  };

  return ContextMemorySchema.parse(memory);
}

export function toContextMemoryQuery(input: {
  role: AgentRole;
  input: RuntimeRunInput;
}): string {
  const brief = input.input.brief;
  return [
    input.role,
    input.input.prompt,
    brief?.objective,
    brief?.audience,
    brief?.offer,
    brief?.primaryCta
  ]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ");
}

export function truncatePreview(value: string, limit = DEFAULT_CONTEXT_MEMORY_LIMITS.previewCharacters): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

function summarizeMessages(input: {
  messages: WorkbenchMessageRecord[];
  projectTaskIds: Set<string>;
  taskId?: string;
  keywords: string[];
  limits: ContextMemoryLimits;
}): ContextMemory["messages"] {
  return input.messages
    .filter((message) => input.projectTaskIds.has(message.taskId))
    .map((message): Ranked<ContextMemory["messages"][number]> => ({
      value: {
        id: message.id,
        taskId: message.taskId,
        role: message.role,
        preview: truncatePreview(message.content, input.limits.previewCharacters),
        createdAt: message.createdAt,
        score: scoreText({
          text: message.content,
          keywords: input.keywords,
          isCurrentTask: input.taskId !== undefined && message.taskId === input.taskId,
          isFailed: false,
          createdAt: message.createdAt
        })
      },
      score: 0
    }))
    .map((ranked) => ({ ...ranked, score: ranked.value.score }))
    .sort(compareRanked)
    .slice(0, input.limits.messages)
    .map((ranked) => ranked.value);
}

function scoreText(input: {
  text: string;
  keywords: string[];
  isCurrentTask: boolean;
  isFailed: boolean;
  createdAt: string;
}): number {
  const lower = input.text.toLowerCase();
  const keywordScore = input.keywords.filter((keyword) => lower.includes(keyword)).length * 10;
  const taskScore = input.isCurrentTask ? 100 : 0;
  const failedScore = input.isFailed ? 20 : 0;
  const recencyScore = Math.floor(Date.parse(input.createdAt) / 1000 / 60);
  return taskScore + keywordScore + failedScore + recencyScore;
}

function toKeywords(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fa5]+/u)
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length >= 2)
  )];
}

function compareRanked<T>(left: Ranked<T>, right: Ranked<T>): number {
  return right.score - left.score;
}
```

- [ ] **Step 5: Run the new test and verify it passes**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git status --short
git add packages/api/package.json packages/api/src/context-memory.ts packages/api/src/context-memory.test.ts
git commit -m "add context memory message retrieval"
```

---

### Task 3: Add Run, Tool, Artifact Summaries and Budget Safety

**Files:**
- Modify: `packages/api/src/context-memory.ts`
- Modify: `packages/api/src/context-memory.test.ts`

- [ ] **Step 1: Add failing run/tool/artifact safety tests**

In `packages/api/src/context-memory.test.ts`, add these tests inside the existing `describe("context memory", ...)` block:

```ts
  it("summarizes failed runs and tool observations without raw output", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.tasks.save({
      id: "task_1",
      projectId: "project_1",
      title: "Deploy LP",
      type: "lp_generation",
      status: "complete",
      createdAt: "2026-05-15T08:00:00.000Z"
    });
    await repositories.runs.save({
      id: "run_builder_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      state: "failed",
      startedAt: "2026-05-15T08:01:00.000Z",
      completedAt: "2026-05-15T08:01:01.000Z",
      contextSummary: {
        injected: ["skills:0"],
        omitted: []
      }
    });
    await repositories.runEvents.save({
      id: "run_builder_1_event_1",
      runId: "run_builder_1",
      projectId: "project_1",
      taskId: "task_1",
      sequence: 1,
      type: "run.failed",
      message: "Builder failed",
      payload: {
        rawOutput: "published secret-token <html>full artifact</html>"
      },
      createdAt: "2026-05-15T08:01:01.000Z"
    });
    await repositories.toolObservations.save({
      id: "observation_1",
      runId: "run_builder_1",
      projectId: "project_1",
      taskId: "task_1",
      toolName: "static-deploy",
      input: {
        rawOutput: "published secret-token <html>full artifact</html>"
      },
      outputSummary: "stdout: 47 chars\nstderr: 0 chars",
      state: "failed",
      exitCode: 1,
      errorName: "deploy_failed",
      createdAt: "2026-05-15T08:02:00.000Z",
      completedAt: "2026-05-15T08:02:01.000Z"
    });

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      taskId: "task_1",
      role: "deployer",
      input: { prompt: "recover deploy failure" }
    });
    const serialized = JSON.stringify(memory);

    expect(memory.runs).toEqual([
      expect.objectContaining({
        id: "run_builder_1",
        state: "failed",
        eventTypes: ["run.failed"]
      })
    ]);
    expect(memory.tools).toEqual([
      expect.objectContaining({
        id: "observation_1",
        state: "failed",
        outputSummary: "stdout: 47 chars\nstderr: 0 chars",
        exitCode: 1,
        errorName: "deploy_failed"
      })
    ]);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("<html>");
    expect(serialized).not.toContain("published");
  });

  it("summarizes artifacts as metadata without full source", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.briefs.save({
      id: "brief_1",
      projectId: "project_1",
      prompt: "Spring sale",
      brief: {
        ...sampleBrief,
        objective: "Convert paid traffic",
        audience: "Returning shoppers",
        offer: "Save 20%",
        primaryCta: "Shop now"
      },
      createdAt: "2026-05-15T08:00:00.000Z"
    });
    await repositories.pageVersions.save({
      id: "page_version_1",
      projectId: "project_1",
      briefId: "brief_1",
      artifacts: {
        indexHtml: "<!doctype html><html><body>secret-token</body></html>",
        stylesCss: "body { color: red; }",
        scriptJs: "console.log('secret-token');"
      },
      reviewStatus: "passed",
      findings: [],
      createdAt: "2026-05-15T08:03:00.000Z"
    });

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      role: "builder",
      input: { prompt: "spring sale" }
    });
    const serialized = JSON.stringify(memory);

    expect(memory.artifacts).toEqual([
      {
        pageVersionId: "page_version_1",
        briefId: "brief_1",
        objective: "Convert paid traffic",
        files: [
          { name: "index.html", characterCount: 53 },
          { name: "styles.css", characterCount: 20 },
          { name: "script.js", characterCount: 28 }
        ],
        createdAt: "2026-05-15T08:03:00.000Z",
        score: expect.any(Number)
      }
    ]);
    expect(serialized).not.toContain("<!doctype html>");
    expect(serialized).not.toContain("console.log");
    expect(serialized).not.toContain("secret-token");
  });

  it("records budget omissions when source records exceed limits", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.tasks.save({
      id: "task_1",
      projectId: "project_1",
      title: "Spring LP",
      type: "lp_generation",
      status: "complete",
      createdAt: "2026-05-15T08:00:00.000Z"
    });
    for (let index = 1; index <= 3; index += 1) {
      await repositories.messages.save({
        id: `message_${index}`,
        taskId: "task_1",
        role: "user",
        content: `Spring sale message ${index}`,
        createdAt: `2026-05-15T08:0${index}:00.000Z`
      });
    }

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      input: { prompt: "spring" },
      limits: {
        messages: 1,
        runs: 0,
        tools: 0,
        artifacts: 0
      }
    });

    expect(memory.messages).toHaveLength(1);
    expect(memory.retrieval.omitted).toEqual(
      expect.arrayContaining([
        "memory:messages:budget_exceeded",
        "memory:runs:none",
        "memory:tools:none",
        "memory:artifacts:none"
      ])
    );
  });

  it("applies the total memory character budget after source selection", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.tasks.save({
      id: "task_1",
      projectId: "project_1",
      title: "Spring LP",
      type: "lp_generation",
      status: "complete",
      createdAt: "2026-05-15T08:00:00.000Z"
    });
    for (let index = 1; index <= 3; index += 1) {
      await repositories.messages.save({
        id: `message_${index}`,
        taskId: "task_1",
        role: "user",
        content: `Spring sale message ${index} with a long reusable context preview`,
        createdAt: `2026-05-15T08:0${index}:00.000Z`
      });
    }

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      input: { prompt: "spring" },
      limits: {
        messages: 3,
        totalCharacters: 520
      }
    });

    expect(memory.messages.length).toBeLessThan(3);
    expect(memory.retrieval.omitted).toContain("memory:total:budget_exceeded");
  });
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: FAIL because runs, tools, artifacts, and budget omissions are not implemented.

- [ ] **Step 3: Extend `assembleContextMemory()` to summarize all sources**

In `packages/api/src/context-memory.ts`, update imports:

```ts
import type {
  BriefRecord,
  PageVersionRecord,
  RunEventRecord,
  RunRecord,
  ToolObservationRecord,
  WorkbenchMessageRecord,
  WorkbenchRepositories
} from "@lp-agent/db";
```

Replace the body of `assembleContextMemory()` after `projectTaskIds` is built with:

```ts
  const messages = selectWithBudget({
    source: summarizeMessages({
      messages: await input.repositories.messages.listAll(),
      projectTaskIds,
      taskId: input.taskId,
      keywords,
      limits
    }),
    limit: limits.messages,
    sourceName: "messages",
    omitted
  });

  const projectRuns = await input.repositories.runs.listForProject(input.projectId);
  const projectEvents = await input.repositories.runEvents.listForProject(input.projectId);
  const runs = selectWithBudget({
    source: summarizeRuns({
      runs: projectRuns,
      events: projectEvents,
      taskId: input.taskId,
      keywords
    }),
    limit: limits.runs,
    sourceName: "runs",
    omitted
  });

  const tools = selectWithBudget({
    source: summarizeTools({
      observations: (await input.repositories.toolObservations.listAll()).filter(
        (observation) => observation.projectId === input.projectId
      ),
      taskId: input.taskId,
      keywords
    }),
    limit: limits.tools,
    sourceName: "tools",
    omitted
  });

  const briefs = await input.repositories.briefs.listAll();
  const artifacts = selectWithBudget({
    source: summarizeArtifacts({
      pageVersions: (await input.repositories.pageVersions.listAll()).filter(
        (pageVersion) => pageVersion.projectId === input.projectId
      ),
      briefs: briefs.filter((brief) => brief.projectId === input.projectId),
      keywords
    }),
    limit: limits.artifacts,
    sourceName: "artifacts",
    omitted
  });

  const memory: ContextMemory = {
    messages,
    runs,
    tools,
    artifacts,
    retrieval: {
      query,
      strategy: CONTEXT_MEMORY_STRATEGY,
      selected: [
        ...messages.map((message) => `message:${message.id}`),
        ...runs.map((run) => `run:${run.id}`),
        ...tools.map((tool) => `tool:${tool.id}`),
        ...artifacts.map((artifact) => `artifact:${artifact.pageVersionId}`)
      ],
      omitted
    }
  };
  enforceTotalCharacterBudget(memory, limits.totalCharacters);
  refreshSelectedMemory(memory);

  return ContextMemorySchema.parse(memory);
```

Then add these helper functions below `summarizeMessages()`:

```ts
function summarizeRuns(input: {
  runs: RunRecord[];
  events: RunEventRecord[];
  taskId?: string;
  keywords: string[];
}): ContextMemory["runs"] {
  return input.runs
    .map((run) => {
      const eventTypes = input.events
        .filter((event) => event.runId === run.id)
        .sort((left, right) => left.sequence - right.sequence)
        .map((event) => event.type);
      const score = scoreText({
        text: [run.role, run.state, ...eventTypes].join(" "),
        keywords: input.keywords,
        isCurrentTask: input.taskId !== undefined && run.taskId === input.taskId,
        isFailed: run.state === "failed",
        createdAt: run.completedAt ?? run.startedAt
      });
      return {
        id: run.id,
        ...(run.taskId ? { taskId: run.taskId } : {}),
        role: run.role,
        state: run.state,
        eventTypes,
        startedAt: run.startedAt,
        ...(run.completedAt ? { completedAt: run.completedAt } : {}),
        score
      };
    })
    .sort(compareByScore);
}

function summarizeTools(input: {
  observations: ToolObservationRecord[];
  taskId?: string;
  keywords: string[];
}): ContextMemory["tools"] {
  return input.observations
    .map((observation) => ({
      id: observation.id,
      runId: observation.runId,
      ...(observation.taskId ? { taskId: observation.taskId } : {}),
      toolName: observation.toolName,
      state: observation.state,
      outputSummary: observation.outputSummary,
      ...(observation.exitCode !== undefined ? { exitCode: observation.exitCode } : {}),
      ...(observation.errorName ? { errorName: observation.errorName } : {}),
      createdAt: observation.createdAt,
      ...(observation.completedAt ? { completedAt: observation.completedAt } : {}),
      score: scoreText({
        text: [
          observation.toolName,
          observation.state,
          observation.outputSummary,
          observation.errorName ?? ""
        ].join(" "),
        keywords: input.keywords,
        isCurrentTask: input.taskId !== undefined && observation.taskId === input.taskId,
        isFailed: observation.state === "failed",
        createdAt: observation.completedAt ?? observation.createdAt
      })
    }))
    .sort(compareByScore);
}

function summarizeArtifacts(input: {
  pageVersions: PageVersionRecord[];
  briefs: BriefRecord[];
  keywords: string[];
}): ContextMemory["artifacts"] {
  const briefsById = new Map(input.briefs.map((brief) => [brief.id, brief]));
  return input.pageVersions
    .map((pageVersion) => {
      const brief = briefsById.get(pageVersion.briefId);
      return {
        pageVersionId: pageVersion.id,
        briefId: pageVersion.briefId,
        ...(brief?.brief.objective ? { objective: brief.brief.objective } : {}),
        files: [
          { name: "index.html" as const, characterCount: pageVersion.artifacts.indexHtml.length },
          { name: "styles.css" as const, characterCount: pageVersion.artifacts.stylesCss.length },
          { name: "script.js" as const, characterCount: pageVersion.artifacts.scriptJs.length }
        ],
        createdAt: pageVersion.createdAt,
        score: scoreText({
          text: [
            brief?.prompt ?? "",
            brief?.brief.objective ?? "",
            brief?.brief.audience ?? "",
            brief?.brief.offer ?? "",
            brief?.brief.primaryCta ?? ""
          ].join(" "),
          keywords: input.keywords,
          isCurrentTask: false,
          isFailed: pageVersion.reviewStatus === "failed",
          createdAt: pageVersion.createdAt
        })
      };
    })
    .sort(compareByScore);
}

function selectWithBudget<T>(input: {
  source: T[];
  limit: number;
  sourceName: "messages" | "runs" | "tools" | "artifacts";
  omitted: string[];
}): T[] {
  if (input.source.length === 0) {
    input.omitted.push(`memory:${input.sourceName}:none`);
    return [];
  }
  if (input.limit <= 0) {
    input.omitted.push(`memory:${input.sourceName}:budget_exceeded`);
    return [];
  }
  if (input.source.length > input.limit) {
    input.omitted.push(`memory:${input.sourceName}:budget_exceeded`);
  }
  return input.source.slice(0, input.limit);
}

function enforceTotalCharacterBudget(memory: ContextMemory, limit: number): void {
  let omitted = false;
  while (estimateMemoryCharacters(memory) > limit && removeLowestPriorityMemoryItem(memory)) {
    omitted = true;
  }
  if (omitted && !memory.retrieval.omitted.includes("memory:total:budget_exceeded")) {
    memory.retrieval.omitted.push("memory:total:budget_exceeded");
  }
}

function removeLowestPriorityMemoryItem(memory: ContextMemory): boolean {
  if (memory.artifacts.length > 0) {
    memory.artifacts.pop();
    return true;
  }
  if (memory.tools.length > 0) {
    memory.tools.pop();
    return true;
  }
  if (memory.runs.length > 0) {
    memory.runs.pop();
    return true;
  }
  if (memory.messages.length > 0) {
    memory.messages.pop();
    return true;
  }
  return false;
}

function estimateMemoryCharacters(memory: ContextMemory): number {
  return JSON.stringify({
    messages: memory.messages,
    runs: memory.runs,
    tools: memory.tools,
    artifacts: memory.artifacts
  }).length;
}

function refreshSelectedMemory(memory: ContextMemory): void {
  memory.retrieval.selected = [
    ...memory.messages.map((message) => `message:${message.id}`),
    ...memory.runs.map((run) => `run:${run.id}`),
    ...memory.tools.map((tool) => `tool:${tool.id}`),
    ...memory.artifacts.map((artifact) => `artifact:${artifact.pageVersionId}`)
  ];
}

function compareByScore<T extends { score: number; createdAt?: string; startedAt?: string }>(
  left: T,
  right: T
): number {
  const scoreDelta = right.score - left.score;
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  const leftTime = Date.parse(left.createdAt ?? left.startedAt ?? "1970-01-01T00:00:00.000Z");
  const rightTime = Date.parse(right.createdAt ?? right.startedAt ?? "1970-01-01T00:00:00.000Z");
  return rightTime - leftTime;
}
```

Replace the `summarizeMessages()` final sort/slice block with:

```ts
    .map((ranked) => ({ ...ranked, score: ranked.value.score }))
    .sort(compareRanked)
    .map((ranked) => ranked.value);
```

The limit is now handled by `selectWithBudget()`.

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git status --short
git add packages/api/src/context-memory.ts packages/api/src/context-memory.test.ts
git commit -m "summarize context memory sources"
```

---

### Task 4: Inject Context Memory into Context Pack

**Files:**
- Modify: `packages/api/src/context-assembler.ts`
- Modify: `packages/api/src/services.test.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Add failing Context Pack integration test**

In `packages/api/src/services.test.ts`, add this test near the existing `"assembles and validates a role-specific context pack"` test:

```ts
  it("injects deterministic context memory into context packs", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const project = await service.createProject({ name: "Project" });
    await repositories.tasks.save({
      id: "task_memory_1",
      projectId: project.id,
      title: "Spring LP",
      type: "lp_generation",
      status: "complete",
      createdAt: "2026-05-15T08:00:00.000Z"
    });
    await repositories.messages.save({
      id: "message_memory_1",
      taskId: "task_memory_1",
      role: "user",
      content: "Build a spring sale landing page",
      createdAt: "2026-05-15T08:01:00.000Z"
    });
    await repositories.runs.save({
      id: "run_memory_1",
      projectId: project.id,
      taskId: "task_memory_1",
      role: "builder",
      state: "completed",
      startedAt: "2026-05-15T08:02:00.000Z",
      completedAt: "2026-05-15T08:02:01.000Z",
      contextSummary: {
        injected: [],
        omitted: []
      }
    });
    await repositories.runEvents.save({
      id: "run_memory_1_event_1",
      runId: "run_memory_1",
      projectId: project.id,
      taskId: "task_memory_1",
      sequence: 1,
      type: "run.completed",
      message: "builder completed",
      payload: {},
      createdAt: "2026-05-15T08:02:01.000Z"
    });
    await repositories.toolObservations.save({
      id: "observation_memory_1",
      runId: "run_memory_1",
      projectId: project.id,
      taskId: "task_memory_1",
      toolName: "static-deploy",
      input: {
        rawOutput: "published secret-token"
      },
      outputSummary: "stdout: 47 chars\nstderr: 0 chars",
      state: "completed",
      exitCode: 0,
      createdAt: "2026-05-15T08:03:00.000Z"
    });

    const contextPack = await assembleContextPack({
      repositories,
      service,
      projectId: project.id,
      role: "builder",
      taskId: "task_memory_1",
      input: {
        prompt: "spring sale"
      },
      now: fixedClock()
    });
    const serialized = JSON.stringify(contextPack);

    expect(ContextPackSchema.parse(contextPack).runtimeContext.memory).toMatchObject({
      messages: [
        expect.objectContaining({
          id: "message_memory_1",
          preview: "Build a spring sale landing page"
        })
      ],
      runs: [
        expect.objectContaining({
          id: "run_memory_1",
          eventTypes: ["run.completed"]
        })
      ],
      tools: [
        expect.objectContaining({
          id: "observation_memory_1",
          outputSummary: "stdout: 47 chars\nstderr: 0 chars"
        })
      ]
    });
    expect(contextPack.trace.injected).toEqual(
      expect.arrayContaining([
        "memory:messages:1",
        "memory:runs:1",
        "memory:tools:1",
        "memory:artifacts:0",
        "memory:strategy:deterministic-keyword-v0"
      ])
    );
    expect(contextPack.trace.omitted).not.toContain("history:not_implemented");
    expect(contextPack.trace.omitted).not.toContain("toolObservations:not_implemented");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("published");
  });
```

- [ ] **Step 2: Add failing run-step runtime delivery test**

In `packages/api/src/services.test.ts`, add this test after `"injects deterministic context memory into context packs"`:

```ts
  it("passes context memory through runAgentStep into runtime requests", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const runtime = new RecordingRuntime({ state: "completed", artifacts: completeArtifacts() });
    const project = await service.createProject({ name: "Project" });
    await repositories.tasks.save({
      id: "task_memory_runtime",
      projectId: project.id,
      title: "Spring LP",
      type: "lp_generation",
      status: "complete",
      createdAt: "2026-05-15T08:00:00.000Z"
    });
    await repositories.messages.save({
      id: "message_memory_runtime",
      taskId: "task_memory_runtime",
      role: "user",
      content: "Use prior spring sale context",
      createdAt: "2026-05-15T08:01:00.000Z"
    });

    await runAgentStep({
      repositories,
      service,
      runtime,
      runId: "run_memory_runtime",
      projectId: project.id,
      taskId: "task_memory_runtime",
      role: "builder",
      input: {
        prompt: "spring sale",
        brief: sampleBrief
      },
      now: fixedClock()
    });

    expect(runtime.requests[0]?.context?.memory?.messages).toEqual([
      expect.objectContaining({
        id: "message_memory_runtime",
        preview: "Use prior spring sale context"
      })
    ]);
    expect(runtime.requests[0]?.context?.memory?.retrieval.selected).toContain(
      "message:message_memory_runtime"
    );
  });
```

- [ ] **Step 3: Run API tests and verify they fail**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: FAIL because `ContextPackSchema` and `assembleContextPack()` do not include memory.

- [ ] **Step 4: Update context assembler schema and injection**

In `packages/api/src/context-assembler.ts`, add:

```ts
import { ContextMemorySchema, assembleContextMemory } from "./context-memory";
```

In `RuntimeRunContextSchema`, add:

```ts
  memory: ContextMemorySchema.optional()
```

Inside `assembleContextPack()`, after `runtimeContext` is created, add:

```ts
  const memory = await assembleContextMemory({
    repositories: input.repositories,
    projectId: input.projectId,
    taskId: input.taskId,
    role: input.role,
    input: input.input
  });
  const runtimeContextWithMemory = {
    ...runtimeContext,
    memory
  };
```

Use `runtimeContextWithMemory` in the context pack:

```ts
    runtimeContext: runtimeContextWithMemory,
```

Replace the `trace.injected` array with:

```ts
      injected: [
        `skills:${runtimeContext.skills.length}`,
        `mcpTools:${runtimeContext.mcpTools.length}`,
        runtimeContext.modelRoutingPolicy ? "modelRoutingPolicy:1" : "modelRoutingPolicy:0",
        runtimeContext.modelRoutingPolicy
          ? `modelProvider:${input.role}:${runtimeContext.modelRoutingPolicy[input.role].api ?? "legacy"}`
          : "modelProvider:0",
        `artifactWorkspace:${runtimeContext.artifactWorkspace.mode}`,
        `memory:messages:${memory.messages.length}`,
        `memory:runs:${memory.runs.length}`,
        `memory:tools:${memory.tools.length}`,
        `memory:artifacts:${memory.artifacts.length}`,
        `memory:strategy:${memory.retrieval.strategy}`
      ],
```

Replace `trace.omitted` with:

```ts
      omitted: [...memory.retrieval.omitted]
```

- [ ] **Step 5: Export context memory APIs**

In `packages/api/src/index.ts`, add this export near the existing context assembler exports:

```ts
export {
  ContextMemorySchema,
  ContextMemoryMessageSummarySchema,
  ContextMemoryRunSummarySchema,
  ContextMemoryToolSummarySchema,
  ContextMemoryArtifactSummarySchema,
  assembleContextMemory,
  toContextMemoryQuery,
  truncatePreview,
  type AssembleContextMemoryInput,
  type ContextMemory
} from "./context-memory";
```

- [ ] **Step 6: Run API tests and verify they pass**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git status --short
git add packages/api/src/context-assembler.ts packages/api/src/services.test.ts packages/api/src/index.ts
git commit -m "inject context memory into context packs"
```

---

### Task 5: Document Completion and Run Full Verification

**Files:**
- Modify: `docs/agent-development-learning.md`

- [ ] **Step 1: Update learning notes**

In `docs/agent-development-learning.md`, in the Stage 5 section, replace:

```md
当前设计：
```

with:

```md
已实现的 Stage 5 Context Memory Retrieval v0：
```

Then add these bullets after the existing design-plan bullet:

```md
- `ContextPack` 现在会注入 deterministic `ContextMemory`，包含 message、run、tool observation 和 artifact metadata 摘要。
- v0 仍然不做向量数据库、embedding、模型生成摘要、跨项目长期记忆或持久化 summary repository。
- 真实模型和 deterministic runtime 通过同一个 runtime/model context 边界接收 memory；默认 deterministic 输出保持稳定。
```

- [ ] **Step 2: Run focused test suite**

Run:

```bash
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
```

Expected: PASS. If `pnpm build` fails due a network/environment issue, capture the exact error and do not claim build passed.

- [ ] **Step 4: Commit docs**

```bash
git status --short
git add docs/agent-development-learning.md
git commit -m "document context memory retrieval completion"
```

---

### Task 6: Final Review and Branch Finish

**Files:**
- No planned file edits.

- [ ] **Step 1: Run final status check**

Run:

```bash
git status --short
git log --oneline --max-count=10
```

Expected: no tracked dirty files; only pre-existing untracked `微信图片_*.png` files may remain.

- [ ] **Step 2: Request code review**

Use `superpowers:requesting-code-review` or the active Subagent-Driven final review step. Reviewer should check:

- context memory is project-scoped and task-aware;
- no raw output, secret, full artifact, or raw model text enters memory;
- model/runtime clone helpers are defensive;
- Context Pack trace accurately records injected and omitted memory;
- deterministic runtime output remains stable;
- docs accurately state Stage 5 v0 scope.

- [ ] **Step 3: Fix review findings**

If review requests changes, implement the smallest focused fix, run the relevant failing test first, then run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: PASS before final branch finish.

- [ ] **Step 4: Finish the branch**

Use `superpowers:finishing-a-development-branch` after implementation, reviews, and verification pass.
