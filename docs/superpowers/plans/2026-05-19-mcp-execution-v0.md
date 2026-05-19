# MCP Execution v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 read-only MCP tool execution v0，让项目内已授权、已审批、只读的 MCP tool 可以通过 API/Web 最小入口执行，并保存安全 run events 与 `ToolObservationRecord`。

**Architecture:** `packages/mcp-gateway` 负责 MCP tool read-only 判定、执行接口和 deterministic local executor；`packages/api` 拥有 project-scoped execution 用例，统一校验 project、connector、tool、role、permission、approval 和 observation 安全边界；Web 只提交 allowlisted 表单字段和 JSON arguments，不直接接触 executor 或 repository。

**Tech Stack:** pnpm TypeScript monorepo、Vitest、Next.js server actions、现有 in-memory / JSON-file repository contracts、`ToolObservationRecord`、run events、MCP registry。

---

## File Structure

- Modify: `packages/mcp-gateway/src/index.ts`
  - 扩展 `MCPToolDefinition` 的只读 metadata。
  - 新增 `isReadOnlyMCPTool()`、argument summary helper、`MCPToolExecutor` contract 和 `DeterministicMCPToolExecutor`。
- Modify: `packages/mcp-gateway/src/index.test.ts`
  - 覆盖 read-only 判定、connector normalization 和 deterministic executor 的安全输出。
- Modify: `packages/runtime-adapters/src/index.ts`
  - 给 `RuntimeMCPToolContext` 增加 optional `readOnly` / `sideEffect`，让 API/Web 能展示只读执行入口，同时保持现有 context 兼容。
- Modify: `packages/api/src/context-assembler.ts`
  - 允许 Context Pack schema 接收 optional MCP `readOnly` / `sideEffect` metadata。
- Modify: `packages/api/src/index.ts`
  - 增加 `mcpToolExecutor` service option 和 `executeProjectMCPTool()`。
  - 执行时只保存 allowlisted input metadata、bounded output summary、safe error name 和 duration。
- Modify: `packages/api/src/services.test.ts`
  - 覆盖成功执行、不可见/disabled/no permission/unapproved/write-like 拒绝、executor failure 安全 observation。
- Modify: `apps/web/src/lib/workbench-store.ts`
  - 增加 `executeMCPTool()` store method、JSON argument parsing 和 MCP execution error mapping。
- Modify: `apps/web/src/app/actions.ts`
  - 增加 `executeMCPToolAction()` server action。
- Modify: `apps/web/src/app/page.tsx`
  - 在 MCP visible tools 区域为 visible read-only tools 增加最小执行表单。
- Modify: `apps/web/src/app/globals.css`
  - 补充最小表单布局样式，保持现有 MCP view 风格。
- Modify: `apps/web/src/lib/i18n.ts`
  - 增加 MCP execution 按钮、arguments label、错误文案。
- Modify tests:
  - `apps/web/src/lib/workbench-store.test.ts`
  - `apps/web/src/app/actions.test.ts`
  - `apps/web/src/app/page.test.ts`
  - `apps/web/src/lib/i18n.test.ts`
- Modify docs:
  - `docs/project-roadmap.md`
  - `docs/agent-development-learning.md`
  - `docs/superpowers/README.md`

## Guardrails

- Stage 20 v0 只执行 read-only MCP tools。
- 不接真实 MCP SDK、远端 MCP server、shell、filesystem、Git、deployment runner 或 browser automation。
- 不保存 raw arguments、raw output、connector secrets、完整 artifact 内容、本机绝对路径或未脱敏异常。
- Web 表单传入的 `approvedByUserId` 一律不可信；审批 actor 只能来自已保存的 approval record 或当前 service user。
- Context Pack 可以包含 tool metadata，但不能自动注入 MCP execution raw result。

## Task 1: MCP Gateway Read-Only Contract And Deterministic Executor

**Files:**
- Modify: `packages/mcp-gateway/src/index.ts`
- Modify: `packages/mcp-gateway/src/index.test.ts`

- [ ] **Step 1: Write failing MCP gateway tests**

In `packages/mcp-gateway/src/index.test.ts`, extend the import:

```ts
import {
  DeterministicMCPToolExecutor,
  computeVisibleTools,
  isReadOnlyMCPTool,
  normalizeMCPConnectorDefinition,
  sampleConnector,
  summarizeMCPToolArguments,
  type MCPConnectorDefinition
} from "./index";
```

Add these tests as new `it()` blocks inside the existing `describe("MCP gateway policy", () => {` block:

```ts
  it("normalizes read-only tool metadata", () => {
    const connector = normalizeMCPConnectorDefinition({
      id: " connector_assets ",
      name: " Assets ",
      tools: [
        {
          name: " searchAssets ",
          permission: " assets:list ",
          roles: ["builder"],
          requiresApproval: false,
          readOnly: true,
          sideEffect: "read"
        }
      ]
    });

    expect(connector.tools[0]).toEqual({
      name: "searchAssets",
      permission: "assets:list",
      roles: ["builder"],
      requiresApproval: false,
      readOnly: true,
      sideEffect: "read"
    });
  });

  it("identifies read-only tools conservatively", () => {
    expect(
      isReadOnlyMCPTool({
        name: "searchAssets",
        permission: "assets:read",
        roles: ["builder"],
        requiresApproval: false
      })
    ).toBe(true);
    expect(
      isReadOnlyMCPTool({
        name: "listAssets",
        permission: "assets:list",
        roles: ["builder"],
        requiresApproval: false,
        readOnly: true
      })
    ).toBe(true);
    expect(
      isReadOnlyMCPTool({
        name: "inspectAssets",
        permission: "assets:inspect",
        roles: ["reviewer"],
        requiresApproval: false,
        sideEffect: "read"
      })
    ).toBe(true);
    expect(
      isReadOnlyMCPTool({
        name: "createPullRequest",
        permission: "git:write",
        roles: ["deployer"],
        requiresApproval: true,
        readOnly: true
      })
    ).toBe(false);
    expect(
      isReadOnlyMCPTool({
        name: "deployPreview",
        permission: "deploy:deploy",
        roles: ["deployer"],
        requiresApproval: true,
        sideEffect: "read"
      })
    ).toBe(false);
    expect(
      isReadOnlyMCPTool({
        name: "unknown",
        permission: "assets:list",
        roles: ["builder"],
        requiresApproval: false
      })
    ).toBe(false);
  });

  it("summarizes MCP tool arguments without values", () => {
    const summary = summarizeMCPToolArguments({
      query: "SECRET_PRODUCT",
      limit: 3,
      filters: { channel: "private" }
    });

    expect(summary).toEqual({
      argumentKeys: ["filters", "limit", "query"],
      argumentCount: 3
    });
    expect(JSON.stringify(summary)).not.toContain("SECRET_PRODUCT");
    expect(JSON.stringify(summary)).not.toContain("private");
  });

  it("returns safe deterministic MCP execution output", async () => {
    const executor = new DeterministicMCPToolExecutor();

    const result = await executor.execute({
      projectId: "project_1",
      connectorId: "connector_assets",
      toolName: "searchAssets",
      role: "builder",
      permission: "assets:read",
      arguments: {
        query: "SECRET_PRODUCT"
      },
      timeoutMs: 1000
    });

    expect(result).toEqual({
      state: "completed",
      outputSummary:
        "Read-only MCP tool connector_assets.searchAssets completed with 1 argument key.",
      metadata: {
        argumentKeys: ["query"],
        argumentCount: 1
      },
      durationMs: expect.any(Number)
    });
    expect(JSON.stringify(result)).not.toContain("SECRET_PRODUCT");
  });
```

- [ ] **Step 2: Run MCP gateway tests and confirm failure**

Run:

```bash
pnpm --filter @lp-agent/mcp-gateway test
```

Expected: FAIL because `DeterministicMCPToolExecutor`, `isReadOnlyMCPTool`, and `summarizeMCPToolArguments` are not exported yet.

- [ ] **Step 3: Implement the MCP gateway contract**

In `packages/mcp-gateway/src/index.ts`, extend `MCPToolDefinition`:

```ts
export type MCPToolSideEffect = "read" | "write";
export type MCPToolExecutionState = "completed" | "failed" | "rejected" | "cancelled";

export interface MCPToolDefinition {
  name: string;
  description?: string;
  permission: string;
  roles: AgentRole[];
  requiresApproval: boolean;
  readOnly?: boolean;
  sideEffect?: MCPToolSideEffect;
}
```

Add the execution contract after `VisibleToolInput`:

```ts
export interface MCPToolArgumentSummary {
  argumentKeys: string[];
  argumentCount: number;
}

export interface MCPToolExecutionInput {
  projectId: string;
  connectorId: string;
  toolName: string;
  role: AgentRole;
  permission: string;
  arguments: Record<string, unknown>;
  timeoutMs: number;
}

export interface MCPToolExecutionResult {
  state: MCPToolExecutionState;
  outputSummary: string;
  metadata?: Record<string, unknown>;
  errorName?: string;
  durationMs?: number;
}

export interface MCPToolExecutor {
  execute(input: MCPToolExecutionInput): Promise<MCPToolExecutionResult>;
}
```

Update `normalizeToolDefinition()` so it preserves optional read-only metadata:

```ts
  const readOnly = typeof input.readOnly === "boolean" ? input.readOnly : undefined;
  const sideEffect =
    input.sideEffect === "read" || input.sideEffect === "write"
      ? input.sideEffect
      : undefined;
  return {
    name,
    ...(description ? { description } : {}),
    permission,
    roles: [...new Set(roles)],
    requiresApproval: input.requiresApproval,
    ...(readOnly !== undefined ? { readOnly } : {}),
    ...(sideEffect ? { sideEffect } : {})
  };
```

Add these helpers and executor below `computeVisibleTools()`:

```ts
export function summarizeMCPToolArguments(
  value: Record<string, unknown>
): MCPToolArgumentSummary {
  const argumentKeys = Object.keys(value).sort();
  return {
    argumentKeys,
    argumentCount: argumentKeys.length
  };
}

export function isReadOnlyMCPTool(tool: MCPToolDefinition): boolean {
  const permission = tool.permission.trim().toLowerCase();
  if (
    permission.endsWith(":write") ||
    permission.endsWith(":deploy") ||
    permission.endsWith(":delete") ||
    permission.endsWith(":admin")
  ) {
    return false;
  }
  if (tool.readOnly === true || tool.sideEffect === "read") {
    return true;
  }
  if (tool.readOnly === false || tool.sideEffect === "write") {
    return false;
  }
  return permission.endsWith(":read");
}

export class DeterministicMCPToolExecutor implements MCPToolExecutor {
  async execute(input: MCPToolExecutionInput): Promise<MCPToolExecutionResult> {
    const startedAt = Date.now();
    const argumentSummary = summarizeMCPToolArguments(input.arguments);
    const keyNoun = argumentSummary.argumentCount === 1 ? "key" : "keys";
    return {
      state: "completed",
      outputSummary:
        `Read-only MCP tool ${input.connectorId}.${input.toolName} completed with ` +
        `${argumentSummary.argumentCount} argument ${keyNoun}.`,
      metadata: argumentSummary,
      durationMs: Math.max(0, Date.now() - startedAt)
    };
  }
}
```

- [ ] **Step 4: Run MCP gateway verification**

Run:

```bash
pnpm --filter @lp-agent/mcp-gateway test
pnpm --filter @lp-agent/mcp-gateway typecheck
```

Expected: both PASS.

- [ ] **Step 5: Commit MCP gateway contract**

Run:

```bash
git add packages/mcp-gateway/src/index.ts packages/mcp-gateway/src/index.test.ts
git commit -m "add mcp execution contract"
```

## Task 2: API-Owned MCP Execution Use Case

**Files:**
- Modify: `packages/runtime-adapters/src/index.ts`
- Modify: `packages/api/src/context-assembler.ts`
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/services.test.ts`

- [ ] **Step 1: Write failing API service tests**

In `packages/api/src/services.test.ts`, extend imports:

```ts
import type { MCPToolExecutor } from "@lp-agent/mcp-gateway";
```

Add these tests near the existing MCP service tests:

```ts
  it("executes visible read-only MCP tools and stores safe observations", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const { project, connector } = await createMCPExecutionFixture(service, {
      permissions: ["assets:read"],
      tools: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["builder"],
          requiresApproval: false
        }
      ]
    });

    const result = await service.executeProjectMCPTool({
      projectId: project.id,
      connectorId: connector.id,
      toolName: "searchAssets",
      role: "builder",
      arguments: {
        query: "SECRET_PRODUCT",
        limit: 3
      }
    });

    expect(result.run).toMatchObject({
      id: "run_mcp_tool_1",
      projectId: project.id,
      role: "builder",
      state: "completed",
      contextSummary: {
        injected: ["mcpTool:connector_assets:searchAssets"],
        omitted: []
      }
    });
    expect(result.observation).toMatchObject({
      id: "tool_observation_1",
      runId: "run_mcp_tool_1",
      projectId: project.id,
      toolName: "mcp:connector_assets:searchAssets",
      input: {
        connectorId: "connector_assets",
        toolName: "searchAssets",
        role: "builder",
        permission: "assets:read",
        requiresApproval: false,
        argumentKeys: ["limit", "query"],
        argumentCount: 2
      },
      outputSummary:
        "Read-only MCP tool connector_assets.searchAssets completed with 2 argument keys.",
      state: "completed"
    });
    const events = await repositories.runEvents.listForRun(result.run.id);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.completed",
      "run.completed"
    ]);
    expect(JSON.stringify(result)).not.toContain("SECRET_PRODUCT");
    expect(JSON.stringify(events)).not.toContain("SECRET_PRODUCT");
  });

  it("rejects disabled, unauthorized, and unapproved MCP tool execution", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const { project, connector } = await createMCPExecutionFixture(service, {
      permissions: ["assets:read"],
      tools: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["builder"],
          requiresApproval: false
        },
        {
          name: "auditAssets",
          permission: "assets:audit",
          roles: ["reviewer"],
          requiresApproval: true
        }
      ]
    });

    await expect(
      service.executeProjectMCPTool({
        projectId: project.id,
        connectorId: connector.id,
        toolName: "searchAssets",
        role: "reviewer",
        arguments: {}
      })
    ).rejects.toThrow("mcp_tool_not_visible");

    await expect(
      service.executeProjectMCPTool({
        projectId: project.id,
        connectorId: connector.id,
        toolName: "auditAssets",
        role: "reviewer",
        arguments: {}
      })
    ).rejects.toThrow("mcp_tool_not_visible");

    await service.setProjectMCPConnectorEnabled({
      projectId: project.id,
      connectorId: connector.id,
      enabled: false
    });

    await expect(
      service.executeProjectMCPTool({
        projectId: project.id,
        connectorId: connector.id,
        toolName: "searchAssets",
        role: "builder",
        arguments: {}
      })
    ).rejects.toThrow("mcp_tool_not_visible");
  });

  it("requires saved MCP approval before executing approval-required read tools", async () => {
    const service = new DemoWorkbenchService({ now: fixedClock() });
    const { project, connector } = await createMCPExecutionFixture(service, {
      permissions: ["assets:read"],
      tools: [
        {
          name: "auditAssets",
          permission: "assets:read",
          roles: ["reviewer"],
          requiresApproval: true
        }
      ]
    });

    await expect(
      service.executeProjectMCPTool({
        projectId: project.id,
        connectorId: connector.id,
        toolName: "auditAssets",
        role: "reviewer",
        arguments: {}
      })
    ).rejects.toThrow("mcp_tool_execution_approval_required");

    await service.setProjectMCPToolApproval({
      projectId: project.id,
      connectorId: connector.id,
      toolName: "auditAssets",
      approved: true,
      approvedByUserId: "reviewer_1"
    });

    await expect(
      service.executeProjectMCPTool({
        projectId: project.id,
        connectorId: connector.id,
        toolName: "auditAssets",
        role: "reviewer",
        arguments: {}
      })
    ).resolves.toMatchObject({
      observation: {
        input: {
          approvedByUserId: "reviewer_1"
        }
      }
    });
  });

  it("rejects write-like MCP tools before calling the executor", async () => {
    let called = false;
    const executor: MCPToolExecutor = {
      async execute() {
        called = true;
        return {
          state: "completed",
          outputSummary: "unsafe",
          durationMs: 1
        };
      }
    };
    const service = new DemoWorkbenchService({
      mcpToolExecutor: executor,
      now: fixedClock()
    });
    const { project, connector } = await createMCPExecutionFixture(service, {
      permissions: ["git:write"],
      tools: [
        {
          name: "createPullRequest",
          permission: "git:write",
          roles: ["deployer"],
          requiresApproval: true,
          readOnly: true
        }
      ]
    });
    await service.setProjectMCPToolApproval({
      projectId: project.id,
      connectorId: connector.id,
      toolName: "createPullRequest",
      approved: true,
      approvedByUserId: "deployer_1"
    });

    await expect(
      service.executeProjectMCPTool({
        projectId: project.id,
        connectorId: connector.id,
        toolName: "createPullRequest",
        role: "deployer",
        arguments: {}
      })
    ).rejects.toThrow("mcp_tool_execution_not_read_only");
    expect(called).toBe(false);
  });

  it("stores failed MCP executor results without raw arguments", async () => {
    const executor: MCPToolExecutor = {
      async execute() {
        return {
          state: "failed",
          outputSummary: "Failed while reading SECRET_PRODUCT",
          metadata: {
            rawOutput: "SECRET_PRODUCT"
          },
          errorName: "Remote Failure With Spaces",
          durationMs: 7
        };
      }
    };
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
      mcpToolExecutor: executor,
      now: fixedClock()
    });
    const { project, connector } = await createMCPExecutionFixture(service, {
      permissions: ["assets:read"],
      tools: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["builder"],
          requiresApproval: false
        }
      ]
    });

    const result = await service.executeProjectMCPTool({
      projectId: project.id,
      connectorId: connector.id,
      toolName: "searchAssets",
      role: "builder",
      arguments: {
        query: "SECRET_PRODUCT"
      }
    });

    expect(result.run.state).toBe("failed");
    expect(result.observation).toMatchObject({
      state: "failed",
      outputSummary: "Failed while reading [redacted]",
      errorName: "mcp_executor_error"
    });
    const events = await repositories.runEvents.listForRun(result.run.id);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.failed",
      "run.failed"
    ]);
    expect(JSON.stringify(result)).not.toContain("SECRET_PRODUCT");
    expect(JSON.stringify(events)).not.toContain("SECRET_PRODUCT");
  });
```

Add this helper near the bottom of `packages/api/src/services.test.ts`, before `fixedClock()`:

```ts
async function createMCPExecutionFixture(
  service: DemoWorkbenchService,
  input: {
    permissions: string[];
    tools: Array<{
      name: string;
      permission: string;
      roles: Array<"planner" | "builder" | "reviewer" | "deployer">;
      requiresApproval: boolean;
      readOnly?: boolean;
      sideEffect?: "read" | "write";
    }>;
  }
): Promise<{ project: ProjectRecord; connector: MCPConnectorRecord }> {
  const project = await service.createProject({ name: "MCP Execution" });
  const draft = await service.createSkillDraft({
    manifestJson: JSON.stringify({
      id: "skill_mcp_permissions",
      name: "MCP Permissions",
      version: "0.1.0",
      type: "workflow",
      scope: "project",
      description: "Grants MCP tool permissions.",
      permissions: input.permissions,
      requiredSecrets: [],
      entrypoints: ["workflow.md"],
      reviewState: "draft"
    }),
    content: "Use approved MCP tools.",
    contentType: "text/markdown"
  });
  const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });
  await service.bindSkillVersionToProject({
    projectId: project.id,
    skillVersionId: published.version.id
  });
  const connector = await service.createProjectMCPConnector({
    projectId: project.id,
    definitionJson: JSON.stringify({
      id: "connector_assets",
      name: "Assets",
      tools: input.tools
    })
  });
  return { project, connector };
}
```

- [ ] **Step 2: Run API tests and confirm failure**

Run:

```bash
pnpm exec vitest run packages/api/src/services.test.ts
```

Expected: FAIL because `MCPToolExecutor`, `mcpToolExecutor`, and `executeProjectMCPTool()` are not wired yet.

- [ ] **Step 3: Extend runtime MCP metadata shape**

In `packages/runtime-adapters/src/index.ts`, update `RuntimeMCPToolContext`:

```ts
export interface RuntimeMCPToolContext {
  connectorId: string;
  name: string;
  permission: string;
  requiresApproval: boolean;
  readOnly?: boolean;
  sideEffect?: "read" | "write";
}
```

In `packages/api/src/context-assembler.ts`, update `RuntimeMCPToolContextSchema`:

```ts
const RuntimeMCPToolContextSchema: z.ZodType<RuntimeMCPToolContext> = z.object({
  connectorId: z.string().min(1),
  name: z.string().min(1),
  permission: z.string().min(1),
  requiresApproval: z.boolean(),
  readOnly: z.boolean().optional(),
  sideEffect: z.enum(["read", "write"]).optional()
});
```

- [ ] **Step 4: Add API imports, options, and public types**

In `packages/api/src/index.ts`, extend the `@lp-agent/mcp-gateway` import:

```ts
import {
  DeterministicMCPToolExecutor,
  computeVisibleTools,
  isReadOnlyMCPTool,
  normalizeMCPConnectorDefinition,
  summarizeMCPToolArguments,
  type ApprovalState,
  type MCPToolDefinition,
  type MCPToolApprovalState,
  type MCPToolExecutionResult,
  type MCPToolExecutor
} from "@lp-agent/mcp-gateway";
```

Add public API types after `ProjectMCPState`:

```ts
export interface ExecuteProjectMCPToolInput {
  projectId: string;
  connectorId: string;
  toolName: string;
  role: AgentRole;
  arguments?: Record<string, unknown>;
  taskId?: string;
  timeoutMs?: number;
}

export interface MCPToolExecutionFlowResult {
  run: RunRecord;
  observation: ToolObservationRecord;
}
```

Add to `DemoWorkbenchServiceOptions`:

```ts
  mcpToolExecutor?: MCPToolExecutor;
```

Add a private field to `DemoWorkbenchService`:

```ts
  private readonly mcpToolExecutor: MCPToolExecutor;
```

Initialize it in the constructor:

```ts
    this.mcpToolExecutor = options.mcpToolExecutor ?? new DeterministicMCPToolExecutor();
```

- [ ] **Step 5: Implement `executeProjectMCPTool()`**

Add this method after `listVisibleMCPToolsForProject()` in `packages/api/src/index.ts`:

```ts
  async executeProjectMCPTool(
    input: ExecuteProjectMCPToolInput
  ): Promise<MCPToolExecutionFlowResult> {
    await this.getProjectOrThrow(input.projectId);
    const role = normalizeAgentRole(input.role);
    const connector = await this.repositories.mcpConnectors.getById(input.connectorId);
    if (!connector || !isProjectMCPConnectorForProject(connector, input.projectId)) {
      throw new Error("mcp_connector_not_found");
    }
    if (connector.enabled !== true) {
      throw new Error("mcp_tool_not_visible");
    }
    const normalizedConnector = normalizeRuntimeMCPConnector(connector);
    if (!normalizedConnector) {
      throw new Error("mcp_connector_validation_failed");
    }
    const tool = normalizedConnector.tools.find((candidate) => candidate.name === input.toolName);
    if (!tool) {
      throw new Error("mcp_tool_not_found");
    }
    if (!tool.roles.includes(role)) {
      throw new Error("mcp_tool_not_visible");
    }
    const skillVersions = await this.listRuntimeSkillsForProject(input.projectId);
    const grantedPermissions = [
      ...new Set(skillVersions.flatMap((version) => version.manifest.permissions))
    ];
    if (!grantedPermissions.includes(tool.permission)) {
      throw new Error("mcp_tool_not_visible");
    }
    const approval = await this.repositories.mcpToolApprovals.getByProjectConnectorAndTool(
      input.projectId,
      normalizedConnector.id,
      tool.name
    );
    if (tool.requiresApproval && approval?.state !== "approved") {
      throw new Error("mcp_tool_execution_approval_required");
    }
    if (!isReadOnlyMCPTool(tool)) {
      throw new Error("mcp_tool_execution_not_read_only");
    }

    const toolArguments = normalizeMCPToolExecutionArguments(input.arguments);
    const argumentSummary = summarizeMCPToolArguments(toolArguments);
    const runId = await reserveRepositoryId(this.repositories, "run_mcp_tool", async () => {
      const existingRuns = await this.repositories.runs.listAll();
      return existingRuns.map((record) => record.id);
    });
    let observationId: string | undefined;

    try {
      observationId = await reserveRepositoryId(
        this.repositories,
        "tool_observation",
        async () => {
          const observations = await this.repositories.toolObservations.listAll();
          return observations.map((record) => record.id);
        }
      );

      const startedAt = this.timestamp();
      const run: RunRecord = {
        id: runId,
        projectId: input.projectId,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        role,
        state: "running",
        startedAt,
        contextSummary: {
          injected: [`mcpTool:${normalizedConnector.id}:${tool.name}`],
          omitted: []
        }
      };
      await this.repositories.runs.save(run);

      let sequence = 1;
      const saveEvent = async (
        type: string,
        message: string,
        payload: Record<string, unknown>
      ): Promise<void> => {
        await this.repositories.runEvents.save({
          id: `${runId}_event_${sequence}`,
          runId,
          projectId: input.projectId,
          ...(input.taskId ? { taskId: input.taskId } : {}),
          sequence,
          type,
          message,
          payload,
          createdAt: this.timestamp()
        });
        sequence += 1;
      };

      const basePayload = {
        connectorId: normalizedConnector.id,
        toolName: tool.name,
        role,
        permission: tool.permission,
        requiresApproval: tool.requiresApproval,
        ...(approval?.approvedByUserId ? { approvedByUserId: approval.approvedByUserId } : {}),
        ...argumentSummary
      };
      await saveEvent("run.started", "Read-only MCP tool run started.", basePayload);
      await saveEvent("tool.started", "Read-only MCP tool started.", {
        ...basePayload,
        observationId
      });

      const executorResult = await this.runMCPToolSafely({
        projectId: input.projectId,
        connectorId: normalizedConnector.id,
        toolName: tool.name,
        role,
        permission: tool.permission,
        arguments: toolArguments,
        timeoutMs: input.timeoutMs ?? 5000
      });
      const completedAt = this.timestamp();
      const finalState = toMCPToolObservationState(executorResult.state);
      const finalRunState = toMCPRunState(finalState);
      const sensitiveValues = Object.values(toolArguments).flatMap((value) =>
        typeof value === "string" && value.length > 0 ? [value] : []
      );
      const outputSummary = sanitizeMCPOutputSummary(
        executorResult.outputSummary,
        sensitiveValues,
        finalState
      );
      const errorName = sanitizeMCPExecutorErrorName(executorResult.errorName, finalState);
      const durationMs = normalizeMCPDurationMs(executorResult.durationMs);
      const finalPayload = {
        ...basePayload,
        observationId,
        outputSummary,
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(errorName !== undefined ? { errorName } : {})
      };

      await saveEvent(
        finalState === "completed" ? "tool.completed" : "tool.failed",
        finalState === "completed"
          ? "Read-only MCP tool completed."
          : "Read-only MCP tool failed.",
        finalPayload
      );
      await saveEvent(
        finalRunState === "completed" ? "run.completed" : "run.failed",
        finalRunState === "completed"
          ? "Read-only MCP tool run completed."
          : "Read-only MCP tool run failed.",
        finalPayload
      );

      const observation: ToolObservationRecord = {
        id: observationId,
        runId,
        projectId: input.projectId,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        toolName: `mcp:${normalizedConnector.id}:${tool.name}`,
        input: basePayload,
        outputSummary,
        state: finalState,
        ...(errorName !== undefined ? { errorName } : {}),
        createdAt: startedAt,
        completedAt
      };
      await this.repositories.toolObservations.save(observation);

      const finalRun: RunRecord = {
        ...run,
        state: finalRunState,
        completedAt
      };
      await this.repositories.runs.save(finalRun);

      return {
        run: copyRunRecord(finalRun),
        observation: copyToolObservationRecord(observation)
      };
    } finally {
      releaseRepositoryId(this.repositories, runId);
      if (observationId) {
        releaseRepositoryId(this.repositories, observationId);
      }
    }
  }
```

Add this private helper method near existing runner helpers in the class:

```ts
  private async runMCPToolSafely(
    input: Parameters<MCPToolExecutor["execute"]>[0]
  ): Promise<MCPToolExecutionResult> {
    try {
      return await this.mcpToolExecutor.execute(input);
    } catch {
      return {
        state: "failed",
        outputSummary: "MCP executor failed.",
        errorName: "mcp_executor_error"
      };
    }
  }
```

- [ ] **Step 6: Add API helper functions**

Add these functions near the existing MCP helper functions in `packages/api/src/index.ts`:

```ts
function normalizeMCPToolExecutionArguments(
  value: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error("mcp_tool_arguments_invalid");
  }
  return structuredClone(value) as Record<string, unknown>;
}

function toMCPToolObservationState(
  state: MCPToolExecutionResult["state"]
): ToolObservationRecord["state"] {
  if (state === "completed") {
    return "completed";
  }
  if (state === "cancelled") {
    return "cancelled";
  }
  return "failed";
}

function toMCPRunState(
  state: ToolObservationRecord["state"]
): RunRecord["state"] {
  if (state === "completed") {
    return "completed";
  }
  if (state === "cancelled") {
    return "cancelled";
  }
  return "failed";
}

function sanitizeMCPOutputSummary(
  value: string,
  sensitiveValues: string[],
  state: ToolObservationRecord["state"]
): string {
  const fallback =
    state === "completed"
      ? "Read-only MCP tool completed."
      : state === "cancelled"
        ? "Read-only MCP tool cancelled."
        : "Read-only MCP tool failed.";
  const trimmed = typeof value === "string" ? value.trim() : "";
  const bounded = trimmed.length > 0 ? trimmed.slice(0, 500) : fallback;
  return redactCommandOutput(bounded, sensitiveValues);
}

function sanitizeMCPExecutorErrorName(
  errorName: string | undefined,
  state: ToolObservationRecord["state"]
): string | undefined {
  if (state === "completed") {
    return undefined;
  }
  if (errorName === undefined) {
    return "mcp_executor_error";
  }
  const trimmed = errorName.trim();
  if (
    trimmed.length === 0 ||
    trimmed !== errorName ||
    trimmed.length > 80 ||
    /\s/.test(trimmed) ||
    !/^[A-Za-z0-9_.:-]+$/.test(trimmed)
  ) {
    return "mcp_executor_error";
  }
  return trimmed;
}

function normalizeMCPDurationMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}
```

- [ ] **Step 7: Preserve MCP read-only metadata in copies and visible tools**

In `copyMCPToolDefinition()`, add `readOnly` and `sideEffect` to the returned object:

```ts
  const readOnly = typeof tool.readOnly === "boolean" ? tool.readOnly : undefined;
  const sideEffect =
    tool.sideEffect === "read" || tool.sideEffect === "write" ? tool.sideEffect : undefined;
  return {
    name,
    ...(description ? { description } : {}),
    permission,
    roles,
    requiresApproval: tool.requiresApproval,
    ...(readOnly !== undefined ? { readOnly } : {}),
    ...(sideEffect ? { sideEffect } : {})
  };
```

In `resolveVisibleMCPTools()`, include optional metadata:

```ts
      }).map((tool) => ({
        connectorId: connector.id,
        name: tool.name,
        permission: tool.permission,
        requiresApproval: tool.requiresApproval,
        ...(tool.readOnly !== undefined ? { readOnly: tool.readOnly } : {}),
        ...(tool.sideEffect ? { sideEffect: tool.sideEffect } : {})
      }))
```

- [ ] **Step 8: Run API verification**

Run:

```bash
pnpm exec vitest run packages/api/src/services.test.ts
pnpm --filter @lp-agent/api typecheck
```

Expected: both PASS.

- [ ] **Step 9: Commit API execution use case**

Run:

```bash
git add packages/runtime-adapters/src/index.ts packages/api/src/context-assembler.ts packages/api/src/index.ts packages/api/src/services.test.ts
git commit -m "add api mcp tool execution"
```

## Task 3: Web Store, Server Action, And Localization

**Files:**
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`
- Modify: `apps/web/src/app/actions.ts`
- Modify: `apps/web/src/app/actions.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`

- [ ] **Step 1: Write failing Web store tests**

In `apps/web/src/lib/workbench-store.test.ts`, add tests that call the store method directly:

```ts
  it("executes MCP tools through the API service with parsed JSON arguments", async () => {
    const service = {
      executeProjectMCPTool: async (input: unknown) => ({
        run: {
          id: "run_mcp_tool_1",
          projectId: "project_1",
          role: "builder",
          state: "completed",
          startedAt: "2026-05-19T00:00:00.000Z",
          completedAt: "2026-05-19T00:00:00.000Z",
          contextSummary: { injected: [], omitted: [] }
        },
        observation: {
          id: "tool_observation_1",
          runId: "run_mcp_tool_1",
          projectId: "project_1",
          toolName: "mcp:connector_assets:searchAssets",
          input,
          outputSummary: "Read-only MCP tool connector_assets.searchAssets completed with 1 argument key.",
          state: "completed",
          createdAt: "2026-05-19T00:00:00.000Z",
          completedAt: "2026-05-19T00:00:00.000Z"
        }
      })
    };
    const store = createWebWorkbenchStore({
      service: service as never
    });

    const result = await store.executeMCPTool({
      projectId: "project_1",
      connectorId: "connector_assets",
      toolName: "searchAssets",
      role: "builder",
      argumentsJson: "{\"query\":\"SECRET_PRODUCT\"}"
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        run: {
          id: "run_mcp_tool_1"
        }
      }
    });
    expect(JSON.stringify(result)).not.toContain("SECRET_PRODUCT");
  });

  it("returns mcp_tool_arguments_invalid for invalid MCP argument JSON", async () => {
    const service = {
      executeProjectMCPTool: async () => {
        throw new Error("service_should_not_be_called");
      }
    };
    const store = createWebWorkbenchStore({
      service: service as never
    });

    await expect(
      store.executeMCPTool({
        projectId: "project_1",
        connectorId: "connector_assets",
        toolName: "searchAssets",
        role: "builder",
        argumentsJson: "{\"query\":"
      })
    ).resolves.toEqual({
      ok: false,
      error: "mcp_tool_arguments_invalid"
    });
  });
```

- [ ] **Step 2: Write failing server action and i18n tests**

In `apps/web/src/app/actions.test.ts`, add an action test following the existing redirect-mocking pattern in that file:

```ts
  it("executes MCP tools from form data", async () => {
    const store = getMutableTestStore();
    store.executeMCPTool = async (input) => {
      expect(input).toEqual({
        projectId: "project_1",
        connectorId: "connector_assets",
        toolName: "searchAssets",
        role: "builder",
        argumentsJson: "{\"query\":\"SECRET_PRODUCT\"}"
      });
      return {
        ok: true,
        value: {
          run: {
            id: "run_mcp_tool_1",
            projectId: "project_1",
            role: "builder",
            state: "completed",
            startedAt: "2026-05-19T00:00:00.000Z",
            completedAt: "2026-05-19T00:00:00.000Z",
            contextSummary: { injected: [], omitted: [] }
          },
          observation: {
            id: "tool_observation_1",
            runId: "run_mcp_tool_1",
            projectId: "project_1",
            toolName: "mcp:connector_assets:searchAssets",
            input: {},
            outputSummary: "safe",
            state: "completed",
            createdAt: "2026-05-19T00:00:00.000Z",
            completedAt: "2026-05-19T00:00:00.000Z"
          }
        }
      };
    };

    const formData = new FormData();
    formData.set("projectId", "project_1");
    formData.set("connectorId", "connector_assets");
    formData.set("toolName", "searchAssets");
    formData.set("role", "builder");
    formData.set("argumentsJson", "{\"query\":\"SECRET_PRODUCT\"}");

    await expect(executeMCPToolAction(formData)).rejects.toThrow("/?view=mcp");
  });
```

In `apps/web/src/lib/i18n.test.ts`, add assertions for both locales:

```ts
  it("includes MCP execution copy and safe error messages", () => {
    expect(en.mcpView.executeReadOnly).toBe("Run read-only check");
    expect(en.mcpView.argumentsLabel).toBe("Arguments JSON");
    expect(en.mcpView.errors.mcp_tool_execution_not_read_only).toBe(
      "Only read-only MCP tools can run in this stage."
    );
    expect(zh.mcpView.executeReadOnly).toBe("执行只读检查");
    expect(zh.mcpView.argumentsLabel).toBe("参数 JSON");
    expect(zh.mcpView.errors.mcp_tool_execution_not_read_only).toBe(
      "当前阶段只能执行只读 MCP 工具。"
    );
  });
```

- [ ] **Step 3: Run focused Web tests and confirm failure**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts apps/web/src/lib/i18n.test.ts
```

Expected: FAIL because `executeMCPTool`, `executeMCPToolAction`, and new i18n keys do not exist.

- [ ] **Step 4: Add Web store execution method**

In `apps/web/src/lib/workbench-store.ts`, extend imports from `@lp-agent/api` with `type MCPToolExecutionFlowResult`.

Extend `MCPFlowErrorCode`:

```ts
  | "mcp_tool_not_visible"
  | "mcp_tool_execution_not_read_only"
  | "mcp_tool_execution_approval_required"
  | "mcp_tool_execution_rejected"
  | "mcp_tool_execution_failed"
  | "mcp_tool_arguments_invalid"
  | "mcp_executor_not_configured"
```

Add input and result types near existing MCP form types:

```ts
export interface ExecuteMCPToolFormInput {
  projectId: string;
  connectorId: string;
  toolName: string;
  role: AgentRole | string;
  argumentsJson?: string;
}

export type MCPExecutionActionResult =
  | { ok: true; value: MCPToolExecutionFlowResult }
  | { ok: false; error: MCPFlowErrorCode };
```

Add to the `WebWorkbenchStore` interface:

```ts
  executeMCPTool(input: ExecuteMCPToolFormInput): Promise<MCPExecutionActionResult>;
```

Add the implementation next to the existing MCP methods:

```ts
    async executeMCPTool(input) {
      const parsedArguments = parseMCPArgumentsJson(input.argumentsJson);
      if (!parsedArguments.ok) {
        return { ok: false, error: parsedArguments.error };
      }
      try {
        const value = await service.executeProjectMCPTool({
          projectId: input.projectId,
          connectorId: input.connectorId,
          toolName: input.toolName,
          role: input.role as AgentRole,
          arguments: parsedArguments.value
        });
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toMCPFlowError(error) };
      }
    }
```

Add this parser near `toMCPFlowError()`:

```ts
function parseMCPArgumentsJson(
  value: string | undefined
): { ok: true; value: Record<string, unknown> } | { ok: false; error: MCPFlowErrorCode } {
  const source = value?.trim() ?? "";
  if (source.length === 0) {
    return { ok: true, value: {} };
  }
  try {
    const parsed = JSON.parse(source) as unknown;
    if (!isRecord(parsed)) {
      return { ok: false, error: "mcp_tool_arguments_invalid" };
    }
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, error: "mcp_tool_arguments_invalid" };
  }
}
```

Extend `toMCPFlowError()` to pass through new errors:

```ts
    message === "mcp_tool_not_visible" ||
    message === "mcp_tool_execution_not_read_only" ||
    message === "mcp_tool_execution_approval_required" ||
    message === "mcp_tool_execution_rejected" ||
    message === "mcp_tool_execution_failed" ||
    message === "mcp_tool_arguments_invalid" ||
    message === "mcp_executor_not_configured"
```

- [ ] **Step 5: Add the server action**

In `apps/web/src/app/actions.ts`, export:

```ts
export async function executeMCPToolAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId) {
    redirectToMCPWithError("project_not_found");
  }
  const result = await getWebWorkbenchStore().executeMCPTool({
    projectId,
    connectorId: String(formData.get("connectorId") ?? ""),
    toolName: String(formData.get("toolName") ?? ""),
    role: String(formData.get("role") ?? ""),
    argumentsJson: String(formData.get("argumentsJson") ?? "")
  });
  if (!result.ok) {
    redirectToMCPWithError(result.error);
  }
  await setCurrentProjectId(projectId);
  revalidatePath("/");
  redirect("/?view=mcp");
}
```

- [ ] **Step 6: Add localization keys**

In `apps/web/src/lib/i18n.ts`, add these keys to both `en.mcpView` and `zh.mcpView`:

```ts
executeReadOnly: "Run read-only check",
argumentsLabel: "Arguments JSON",
argumentsPlaceholder: "{\"query\":\"spring sale\"}",
writeToolUnavailable: "Write tools are blocked in this stage.",
```

```ts
executeReadOnly: "执行只读检查",
argumentsLabel: "参数 JSON",
argumentsPlaceholder: "{\"query\":\"春季活动\"}",
writeToolUnavailable: "当前阶段已阻止写工具。",
```

Add error copy to both MCP error maps:

```ts
mcp_tool_not_visible: "The selected MCP tool is not visible for this role.",
mcp_tool_execution_not_read_only: "Only read-only MCP tools can run in this stage.",
mcp_tool_execution_approval_required: "Approve this MCP tool before running it.",
mcp_tool_execution_rejected: "The MCP executor rejected the tool run.",
mcp_tool_execution_failed: "The MCP tool run failed.",
mcp_tool_arguments_invalid: "Enter arguments as a JSON object.",
mcp_executor_not_configured: "The MCP executor is not configured.",
```

```ts
mcp_tool_not_visible: "当前角色不可见所选 MCP 工具。",
mcp_tool_execution_not_read_only: "当前阶段只能执行只读 MCP 工具。",
mcp_tool_execution_approval_required: "请先批准该 MCP 工具再执行。",
mcp_tool_execution_rejected: "MCP executor 拒绝了本次工具运行。",
mcp_tool_execution_failed: "MCP 工具运行失败。",
mcp_tool_arguments_invalid: "请以 JSON object 格式输入参数。",
mcp_executor_not_configured: "MCP executor 尚未配置。",
```

- [ ] **Step 7: Run Web store/action/i18n verification**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts apps/web/src/lib/i18n.test.ts
pnpm --filter @lp-agent/web typecheck
```

Expected: both PASS.

- [ ] **Step 8: Commit Web action layer**

Run:

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.ts apps/web/src/app/actions.test.ts apps/web/src/lib/i18n.ts apps/web/src/lib/i18n.test.ts
git commit -m "wire mcp execution action"
```

## Task 4: Minimal MCP Page Execution Controls

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Write failing page rendering tests**

In `apps/web/src/app/page.test.ts`, add tests for the MCP view:

```ts
  it("renders execution controls only for visible read-only MCP tools", async () => {
    setActiveEmptyProjectState();
    (pageMocks.pageState as {
      mcp: {
        connectors: unknown[];
        approvals: unknown[];
        visibleToolsByRole: Record<string, unknown[]>;
      };
    }).mcp = {
      connectors: [],
      approvals: [],
      visibleToolsByRole: {
        planner: [],
        builder: [
          {
            connectorId: "connector_assets",
            name: "searchAssets",
            permission: "assets:read",
            requiresApproval: false
          },
          {
            connectorId: "connector_git",
            name: "createPullRequest",
            permission: "git:write",
            requiresApproval: true,
            readOnly: true
          }
        ],
        reviewer: [],
        deployer: []
      }
    };

    const page = await HomePage({
      searchParams: Promise.resolve({ view: "mcp" })
    });
    const text = collectText(page).join(" ");
    const formPayloads = collectElements(page, "form").map(collectFormPayload);

    expect(text).toContain("Run read-only check");
    expect(text).toContain("Arguments JSON");
    expect(text).toContain("Write tools are blocked in this stage.");
    expect(formPayloads).toContainEqual({
      projectId: "project_1",
      connectorId: "connector_assets",
      toolName: "searchAssets",
      role: "builder"
    });
    expect(formPayloads).not.toContainEqual(
      expect.objectContaining({
        toolName: "createPullRequest"
      })
    );
  });
```

- [ ] **Step 2: Run page test and confirm failure**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts
```

Expected: FAIL because the MCP page does not render execution controls yet.

- [ ] **Step 3: Import the MCP execution action**

In `apps/web/src/app/page.tsx`, extend the actions import:

```ts
import {
  createMCPConnectorAction,
  executeMCPToolAction,
  setMCPConnectorEnabledAction,
  setMCPToolApprovalAction
} from "./actions";
```

- [ ] **Step 4: Render read-only execution forms in the visible tools section**

Replace the visible tools `<span>` rendering with this structure:

```tsx
                          {(mcpState.visibleToolsByRole[role] ?? []).length > 0 ? (
                            <div className="mcpVisibleToolList">
                              {(mcpState.visibleToolsByRole[role] ?? []).map((tool) => {
                                const label = `${tool.connectorId}.${tool.name}`;
                                return (
                                  <div className="mcpVisibleToolItem" key={label}>
                                    <span>{label}</span>
                                    {isReadOnlyVisibleMCPTool(tool) ? (
                                      <form action={executeMCPToolAction} className="mcpExecutionForm">
                                        <input
                                          name="projectId"
                                          type="hidden"
                                          value={activeProject.id}
                                        />
                                        <input
                                          name="connectorId"
                                          type="hidden"
                                          value={tool.connectorId}
                                        />
                                        <input name="toolName" type="hidden" value={tool.name} />
                                        <input name="role" type="hidden" value={role} />
                                        <label>
                                          {copy.mcpView.argumentsLabel}
                                          <textarea
                                            name="argumentsJson"
                                            placeholder={copy.mcpView.argumentsPlaceholder}
                                            defaultValue="{}"
                                          />
                                        </label>
                                        <button type="submit">
                                          {copy.mcpView.executeReadOnly}
                                        </button>
                                      </form>
                                    ) : (
                                      <small>{copy.mcpView.writeToolUnavailable}</small>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <span>{copy.mcpView.emptyVisibleTools}</span>
                          )}
```

- [ ] **Step 5: Add read-only display helper**

Add this helper near `toMCPRoleLabels()`:

```ts
function isReadOnlyVisibleMCPTool(tool: {
  permission: string;
  readOnly?: boolean;
  sideEffect?: "read" | "write";
}): boolean {
  const permission = tool.permission.trim().toLowerCase();
  if (
    permission.endsWith(":write") ||
    permission.endsWith(":deploy") ||
    permission.endsWith(":delete") ||
    permission.endsWith(":admin")
  ) {
    return false;
  }
  if (tool.readOnly === true || tool.sideEffect === "read") {
    return true;
  }
  if (tool.readOnly === false || tool.sideEffect === "write") {
    return false;
  }
  return permission.endsWith(":read");
}
```

- [ ] **Step 6: Add compact MCP execution styles**

In `apps/web/src/app/globals.css`, add:

```css
.mcpVisibleToolList {
  display: grid;
  gap: 0.75rem;
  width: 100%;
}

.mcpVisibleToolItem {
  display: grid;
  gap: 0.5rem;
  min-width: 0;
}

.mcpExecutionForm {
  display: grid;
  gap: 0.5rem;
  max-width: 28rem;
}

.mcpExecutionForm label {
  display: grid;
  gap: 0.35rem;
}

.mcpExecutionForm textarea {
  min-height: 4.5rem;
  resize: vertical;
}
```

- [ ] **Step 7: Run page/UI verification**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts
pnpm --filter @lp-agent/web typecheck
```

Expected: both PASS.

- [ ] **Step 8: Commit MCP page controls**

Run:

```bash
git add apps/web/src/app/page.tsx apps/web/src/app/page.test.ts apps/web/src/app/globals.css
git commit -m "show read-only mcp execution controls"
```

## Task 5: Documentation, Full Verification, And Completion Commit

**Files:**
- Modify: `docs/project-roadmap.md`
- Modify: `docs/agent-development-learning.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Update roadmap after implementation**

In `docs/project-roadmap.md`:

- Move Stage 20 from “推荐下一阶段队列” to “已完成阶段记录” once implementation passes verification.
- Update current snapshot from “MCP execution 尚未实现” to read-only execution implemented.
- Keep real MCP SDK、write tools、streaming MCP output、MCP cancellation/timeout mapping in backlog.
- Make Stage 21 “Model Repair、Retry 和 Fallback v0” the first recommended next stage unless the user changes priority.

Use this completed-stage text:

```md
### Stage 20：MCP Execution v0

**状态：** 已实现。

Stage 20 v0 已实现 read-only MCP tool execution：API 侧校验 project、connector、tool、role、permission、approval 和 read-only 边界后，通过 deterministic local executor 写入 run events 与安全 `ToolObservationRecord`。Web MCP 页提供最小只读执行入口；raw arguments、raw output、secret、完整 artifact 内容和本机路径不会进入 observation、timeline、chat message 或 model context。

**设计：** `docs/superpowers/specs/2026-05-19-mcp-execution-v0-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-19-mcp-execution-v0.md`。
```

- [ ] **Step 2: Update Agent development learning notes**

In `docs/agent-development-learning.md`:

- Move MCP execution from “还没做” to “已经完成或基本成型” with read-only scope.
- In Stage 20 section, add this plan link:

```md
- 实现计划：[2026-05-19-mcp-execution-v0.md](./superpowers/plans/2026-05-19-mcp-execution-v0.md)
```

- Add one learning note:

```md
- Stage 20 v0 证明了 MCP execution 不等同于“直接调用外部工具”：即使第一版 executor 是 deterministic local executor，也必须先经过 project/role/permission/approval/read-only 校验，再通过 run event 和 `ToolObservationRecord` 保存可审计、安全摘要。
```

- [ ] **Step 3: Confirm Superpowers index is current**

`docs/superpowers/README.md` already contains this plan entry from the planning commit. If implementation renames the file, update item 69 to the final file name. The entry must remain:

```md
69. `plans/2026-05-19-mcp-execution-v0.md`
   - Stage 20 MCP Execution v0 implementation plan。
   - 在 Stage 20 design 后阅读，用于按 TDD 实现 read-only MCP executor contract、API-owned execution use case、安全 tool observation、Web 最小执行入口和文档收尾。
```

- [ ] **Step 4: Run focused package verification**

Run:

```bash
pnpm --filter @lp-agent/mcp-gateway test
pnpm --filter @lp-agent/mcp-gateway typecheck
pnpm exec vitest run packages/api/src/services.test.ts
pnpm --filter @lp-agent/api typecheck
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts apps/web/src/lib/i18n.test.ts
pnpm --filter @lp-agent/web typecheck
```

Expected: all PASS.

- [ ] **Step 5: Run full workspace verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all PASS, and `git diff --check` prints no whitespace errors.

- [ ] **Step 6: Commit docs and completion state**

Run:

```bash
git add docs/project-roadmap.md docs/agent-development-learning.md docs/superpowers/README.md
git commit -m "document mcp execution v0 completion"
```

## Self-Review Checklist

- Spec coverage: Tasks 1-2 implement read-only contract, deterministic executor, API-owned validation, events, observation, and safe summaries. Tasks 3-4 implement minimal Web/API trigger. Task 5 updates roadmap, learning notes, and Superpowers index.
- Non-goals preserved: no real MCP SDK, write tools, shell/filesystem/Git/deployment/browser automation, raw output injection, streaming MCP output, or production process manager.
- Safety checks present: project/connector/tool/role/permission/approval/read-only validation, argument key summaries, output redaction against argument string values, safe error names, bounded output summary.
- Type consistency: `MCPToolExecutionFlowResult`, `ExecuteProjectMCPToolInput`, `MCPToolExecutor`, `RuntimeMCPToolContext`, and Web `ExecuteMCPToolFormInput` names are used consistently across tasks.
- Verification coverage: focused tests run after each implementation slice, then full `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check`.
