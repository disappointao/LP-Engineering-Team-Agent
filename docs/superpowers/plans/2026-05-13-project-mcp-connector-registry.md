# Project MCP Connector Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build project-scoped MCP connector registration, approval-aware tool visibility, and Web MCP management without executing tools.

**Architecture:** Extend `@lp-agent/mcp-gateway` with pure validation and visibility helpers, then persist connector and approval records through the existing workbench repository bundle. `packages/api` owns connector lifecycle and runtime tool resolution; `apps/web` remains a thin server-action and localized UI layer over the API. The runtime receives visible MCP tool metadata only, keeping real execution behind a future adapter boundary.

**Tech Stack:** pnpm TypeScript monorepo, Vitest, Next.js server actions, local JSON-file persistence, deterministic runtime adapters, existing Web i18n and Manus-style shell.

---

## File Structure

- `packages/mcp-gateway/src/index.ts`
  - Add connector definition normalization, stable validation errors, approval-aware visibility helpers, and defensive copies.
- `packages/mcp-gateway/src/index.test.ts`
  - Verify connector validation, duplicate tool rejection, permission filtering, role filtering, and tool-specific approval filtering.
- `packages/db/src/workbench-repositories.ts`
  - Add `MCPConnectorRecord`, `MCPToolApprovalRecord`, repository interfaces, in-memory repositories, and copy helpers.
- `packages/db/src/workbench-repositories.test.ts`
  - Verify in-memory MCP connector and approval persistence with defensive copies and project filtering.
- `packages/db/src/json-file-workbench-repositories.ts`
  - Persist MCP connector and approval arrays in `.lp-agent/workbench-state.json`.
- `packages/db/src/json-file-workbench-repositories.test.ts`
  - Verify MCP connector and approval records reopen from JSON-file state.
- `packages/api/src/index.ts`
  - Add MCP lifecycle methods, project state listing, visible tool resolution, and runtime context wiring that replaces hardcoded `sampleConnector`.
- `packages/api/src/services.test.ts`
  - Verify connector creation, validation failures, enable/disable, approval, visible tools, and runtime context behavior.
- `apps/web/src/lib/workbench-store.ts`
  - Add MCP flow error codes, MCP page state, and store methods wrapping API calls.
- `apps/web/src/lib/workbench-store.test.ts`
  - Verify Web store MCP lifecycle, stable errors, and page state loading.
- `apps/web/src/app/actions.ts`
  - Add MCP server actions for connector creation, enablement, and approval state.
- `apps/web/src/app/actions.test.ts`
  - Verify action parsing and redirects to `?view=mcp`.
- `apps/web/src/lib/i18n.ts`
  - Add Chinese and English MCP view copy and error copy.
- `apps/web/src/app/page.tsx`
  - Add `?view=mcp`, active MCP nav, MCP view forms/lists, and role visible-tool summaries.
- `apps/web/src/app/page.test.ts`
  - Verify MCP view rendering, no-project gating, localized copy, and nav activation.
- `apps/web/src/app/globals.css`
  - Style the MCP view using existing settings-view form/list patterns.

---

### Task 1: MCP Gateway Validation And Approval-Aware Visibility

**Files:**
- Modify: `packages/mcp-gateway/src/index.ts`
- Modify: `packages/mcp-gateway/src/index.test.ts`

- [ ] **Step 1: Write failing MCP gateway tests**

Add these tests to `packages/mcp-gateway/src/index.test.ts`:

```ts
import {
  computeVisibleTools,
  normalizeMCPConnectorDefinition,
  sampleConnector,
  type MCPConnectorDefinition
} from "./index";

it("normalizes connector definitions with defensive tool copies", () => {
  const connector = normalizeMCPConnectorDefinition({
    id: "connector_assets",
    name: "Internal Assets",
    description: "Search approved asset metadata.",
    tools: [
      {
        name: "searchAssets",
        description: "Search assets.",
        permission: "assets:read",
        roles: ["planner", "builder"],
        requiresApproval: false
      }
    ]
  });

  expect(connector).toEqual({
    id: "connector_assets",
    name: "Internal Assets",
    description: "Search approved asset metadata.",
    tools: [
      {
        name: "searchAssets",
        description: "Search assets.",
        permission: "assets:read",
        roles: ["planner", "builder"],
        requiresApproval: false
      }
    ]
  });

  connector.tools[0]!.roles.push("reviewer");
  expect(
    normalizeMCPConnectorDefinition({
      id: "connector_assets",
      name: "Internal Assets",
      tools: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["planner", "builder"],
          requiresApproval: false
        }
      ]
    }).tools[0]!.roles
  ).toEqual(["planner", "builder"]);
});

it("rejects invalid connector definitions", () => {
  expect(() =>
    normalizeMCPConnectorDefinition({
      id: "",
      name: "Broken",
      tools: []
    })
  ).toThrow("mcp_connector_validation_failed");

  expect(() =>
    normalizeMCPConnectorDefinition({
      id: "connector_assets",
      name: "Assets",
      tools: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["builder", "unknown"],
          requiresApproval: false
        }
      ]
    })
  ).toThrow("mcp_connector_validation_failed");

  expect(() =>
    normalizeMCPConnectorDefinition({
      id: "connector_assets",
      name: "Assets",
      tools: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["builder"],
          requiresApproval: false
        },
        {
          name: "searchAssets",
          permission: "assets:write",
          roles: ["builder"],
          requiresApproval: true
        }
      ]
    })
  ).toThrow("mcp_connector_validation_failed");
});

it("uses tool-specific approval states for approval-required tools", () => {
  const tools = computeVisibleTools({
    connectors: [sampleConnector],
    projectConnectorIds: ["connector_assets"],
    skillPermissions: ["git:write"],
    agentRole: "deployer",
    approvalStates: [
      {
        connectorId: "connector_assets",
        toolName: "createPullRequest",
        state: "approved"
      }
    ]
  });

  expect(tools.map((tool) => tool.name)).toEqual(["createPullRequest"]);
});

it("keeps approval-required tools hidden when approval is pending", () => {
  const tools = computeVisibleTools({
    connectors: [sampleConnector],
    projectConnectorIds: ["connector_assets"],
    skillPermissions: ["git:write"],
    agentRole: "deployer",
    approvalStates: [
      {
        connectorId: "connector_assets",
        toolName: "createPullRequest",
        state: "pending"
      }
    ]
  });

  expect(tools).toEqual([]);
});
```

- [ ] **Step 2: Run MCP gateway tests and verify failure**

Run:

```bash
pnpm exec vitest run packages/mcp-gateway/src/index.test.ts
```

Expected: FAIL with missing `normalizeMCPConnectorDefinition` and `approvalStates` support.

- [ ] **Step 3: Implement connector normalization and visibility**

Modify `packages/mcp-gateway/src/index.ts` so these exports exist:

```ts
export const mcpAgentRoles = Object.freeze([
  "planner",
  "builder",
  "reviewer",
  "deployer"
] as const) satisfies readonly AgentRole[];

export interface MCPToolApprovalState {
  connectorId: string;
  toolName: string;
  state: ApprovalState;
}

export interface MCPConnectorDefinitionInput {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  tools?: unknown;
}
```

Extend `MCPToolDefinition` and `VisibleToolInput`:

```ts
export interface MCPToolDefinition {
  name: string;
  description?: string;
  permission: string;
  roles: AgentRole[];
  requiresApproval: boolean;
}

export interface VisibleToolInput {
  connectors: readonly MCPConnectorDefinition[];
  projectConnectorIds: readonly string[];
  skillPermissions: readonly string[];
  agentRole: AgentRole;
  approvalState?: ApprovalState;
  approvalStates?: readonly MCPToolApprovalState[];
}
```

Add these helper functions:

```ts
export function normalizeMCPConnectorDefinition(
  input: MCPConnectorDefinitionInput
): MCPConnectorDefinition {
  const id = normalizeRequiredString(input.id);
  const name = normalizeRequiredString(input.name);
  const description =
    typeof input.description === "string" && input.description.trim().length > 0
      ? input.description.trim()
      : undefined;
  const rawTools = Array.isArray(input.tools) ? input.tools : undefined;
  if (!id || !name || !rawTools || rawTools.length === 0) {
    throw new Error("mcp_connector_validation_failed");
  }

  const seenToolNames = new Set<string>();
  const tools = rawTools.map((tool) => {
    const normalized = normalizeToolDefinition(tool);
    if (seenToolNames.has(normalized.name)) {
      throw new Error("mcp_connector_validation_failed");
    }
    seenToolNames.add(normalized.name);
    return normalized;
  });

  return {
    id,
    name,
    ...(description ? { description } : {}),
    tools
  };
}

function normalizeToolDefinition(input: unknown): MCPToolDefinition {
  if (!isRecord(input)) {
    throw new Error("mcp_connector_validation_failed");
  }
  const name = normalizeRequiredString(input.name);
  const permission = normalizeRequiredString(input.permission);
  const roles = Array.isArray(input.roles)
    ? input.roles.map(normalizeAgentRole)
    : [];
  if (!name || !permission || roles.length === 0 || typeof input.requiresApproval !== "boolean") {
    throw new Error("mcp_connector_validation_failed");
  }
  const description =
    typeof input.description === "string" && input.description.trim().length > 0
      ? input.description.trim()
      : undefined;
  return {
    name,
    ...(description ? { description } : {}),
    permission,
    roles: [...new Set(roles)],
    requiresApproval: input.requiresApproval
  };
}

function normalizeAgentRole(input: unknown): AgentRole {
  if (mcpAgentRoles.includes(input as AgentRole)) {
    return input as AgentRole;
  }
  throw new Error("mcp_connector_validation_failed");
}

function normalizeRequiredString(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
```

Replace `computeVisibleTools()` with an implementation that passes the connector id into approval checks:

```ts
export const computeVisibleTools = (
  input: VisibleToolInput
): MCPToolDefinition[] =>
  input.connectors
    .filter((connector) => input.projectConnectorIds.includes(connector.id))
    .flatMap((connector) =>
      connector.tools.map((tool) => ({
        connectorId: connector.id,
        tool
      }))
    )
    .filter(({ tool }) => tool.roles.includes(input.agentRole))
    .filter(({ tool }) => input.skillPermissions.includes(tool.permission))
    .filter(({ connectorId, tool }) => isToolApproved(input, connectorId, tool))
    .map(({ tool }) => ({
      ...tool,
      roles: [...tool.roles]
    }));

function isToolApproved(
  input: VisibleToolInput,
  connectorId: string,
  tool: MCPToolDefinition
): boolean {
  if (!tool.requiresApproval) {
    return true;
  }
  if (input.approvalStates) {
    return input.approvalStates.some(
      (approval) =>
        approval.connectorId === connectorId &&
        approval.toolName === tool.name &&
        approval.state === "approved"
    );
  }
  return input.approvalState === "approved";
}
```

- [ ] **Step 4: Run MCP gateway tests and verify pass**

Run:

```bash
pnpm exec vitest run packages/mcp-gateway/src/index.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit MCP gateway helpers**

Run:

```bash
git add packages/mcp-gateway/src/index.ts packages/mcp-gateway/src/index.test.ts
git commit -m "add mcp connector validation"
```

---

### Task 2: DB In-Memory MCP Repositories

**Files:**
- Modify: `packages/db/src/workbench-repositories.ts`
- Modify: `packages/db/src/workbench-repositories.test.ts`

- [ ] **Step 1: Write failing in-memory repository tests**

Add tests to `packages/db/src/workbench-repositories.test.ts`:

```ts
it("stores mcp connectors and approvals with defensive copies", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const connector = {
    id: "connector_assets",
    scope: "project" as const,
    targetKey: "project_1",
    name: "Internal Assets",
    description: "Search approved assets.",
    enabled: true,
    tools: [
      {
        name: "searchAssets",
        description: "Search assets.",
        permission: "assets:read",
        roles: ["planner", "builder"] as const,
        requiresApproval: false
      }
    ],
    createdAt,
    updatedAt: createdAt
  };
  const approval = {
    id: "mcp_approval_1",
    projectId: "project_1",
    connectorId: "connector_assets",
    toolName: "createPullRequest",
    state: "approved" as const,
    approvedByUserId: "local-owner",
    createdAt,
    updatedAt: createdAt
  };

  await repositories.mcpConnectors.save(connector);
  await repositories.mcpToolApprovals.save(approval);

  const savedConnector = await repositories.mcpConnectors.getById("connector_assets");
  const savedApproval =
    await repositories.mcpToolApprovals.getByProjectConnectorAndTool(
      "project_1",
      "connector_assets",
      "createPullRequest"
    );

  expect(savedConnector).toEqual(connector);
  expect(savedApproval).toEqual(approval);

  if (!savedConnector || !savedApproval) {
    throw new Error("Expected saved MCP records.");
  }
  savedConnector.tools[0]!.permission = "mutated:permission";
  savedApproval.state = "pending";

  await expect(repositories.mcpConnectors.getById("connector_assets")).resolves.toEqual(connector);
  await expect(
    repositories.mcpToolApprovals.getByProjectConnectorAndTool(
      "project_1",
      "connector_assets",
      "createPullRequest"
    )
  ).resolves.toEqual(approval);
});

it("lists mcp connectors and approvals for a project", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  await repositories.mcpConnectors.save({
    id: "connector_project_1",
    scope: "project",
    targetKey: "project_1",
    name: "Project 1 Assets",
    enabled: true,
    tools: [],
    createdAt,
    updatedAt: createdAt
  });
  await repositories.mcpConnectors.save({
    id: "connector_project_2",
    scope: "project",
    targetKey: "project_2",
    name: "Project 2 Assets",
    enabled: true,
    tools: [],
    createdAt,
    updatedAt: createdAt
  });
  await repositories.mcpToolApprovals.save({
    id: "mcp_approval_1",
    projectId: "project_1",
    connectorId: "connector_project_1",
    toolName: "searchAssets",
    state: "approved",
    createdAt,
    updatedAt: createdAt
  });

  await expect(repositories.mcpConnectors.listForProject("project_1")).resolves.toEqual([
    expect.objectContaining({ id: "connector_project_1" })
  ]);
  await expect(repositories.mcpToolApprovals.listForProject("project_1")).resolves.toEqual([
    expect.objectContaining({ id: "mcp_approval_1" })
  ]);
});
```

- [ ] **Step 2: Run DB in-memory tests and verify failure**

Run:

```bash
pnpm exec vitest run packages/db/src/workbench-repositories.test.ts
```

Expected: FAIL because `mcpConnectors` and `mcpToolApprovals` repositories do not exist.

- [ ] **Step 3: Add MCP record and repository contracts**

In `packages/db/src/workbench-repositories.ts`, import the MCP tool type:

```ts
import type { MCPToolDefinition } from "@lp-agent/mcp-gateway";
```

Add records after model routing records:

```ts
export interface MCPConnectorRecord {
  id: string;
  scope: SkillScope;
  targetKey: string;
  name: string;
  description?: string;
  tools: MCPToolDefinition[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MCPToolApprovalRecord {
  id: string;
  projectId: string;
  connectorId: string;
  toolName: string;
  state: "pending" | "approved";
  approvedByUserId?: string;
  createdAt: string;
  updatedAt: string;
}
```

Add repository interfaces after model routing repositories:

```ts
export interface MCPConnectorRepository {
  save(connector: MCPConnectorRecord): Promise<void>;
  getById(connectorId: string): Promise<MCPConnectorRecord | undefined>;
  listForProject(projectId: string): Promise<MCPConnectorRecord[]>;
  listAll(): Promise<MCPConnectorRecord[]>;
}

export interface MCPToolApprovalRepository {
  save(approval: MCPToolApprovalRecord): Promise<void>;
  getByProjectConnectorAndTool(
    projectId: string,
    connectorId: string,
    toolName: string
  ): Promise<MCPToolApprovalRecord | undefined>;
  listForProject(projectId: string): Promise<MCPToolApprovalRecord[]>;
  listAll(): Promise<MCPToolApprovalRecord[]>;
}
```

Extend `WorkbenchRepositories`:

```ts
mcpConnectors: MCPConnectorRepository;
mcpToolApprovals: MCPToolApprovalRepository;
```

- [ ] **Step 4: Add in-memory repository implementations**

Add properties to `InMemoryWorkbenchRepositories`:

```ts
readonly mcpConnectors = new InMemoryMCPConnectorRepository();
readonly mcpToolApprovals = new InMemoryMCPToolApprovalRepository();
```

Add classes near the other in-memory repositories:

```ts
class InMemoryMCPConnectorRepository implements MCPConnectorRepository {
  private readonly connectors = new Map<string, MCPConnectorRecord>();

  async save(connector: MCPConnectorRecord): Promise<void> {
    this.connectors.set(connector.id, copyMCPConnector(connector));
  }

  async getById(connectorId: string): Promise<MCPConnectorRecord | undefined> {
    const connector = this.connectors.get(connectorId);
    return connector ? copyMCPConnector(connector) : undefined;
  }

  async listForProject(projectId: string): Promise<MCPConnectorRecord[]> {
    return [...this.connectors.values()]
      .filter((connector) => connector.scope === "project" && connector.targetKey === projectId)
      .map(copyMCPConnector);
  }

  async listAll(): Promise<MCPConnectorRecord[]> {
    return [...this.connectors.values()].map(copyMCPConnector);
  }
}

class InMemoryMCPToolApprovalRepository implements MCPToolApprovalRepository {
  private readonly approvals = new Map<string, MCPToolApprovalRecord>();

  async save(approval: MCPToolApprovalRecord): Promise<void> {
    this.approvals.set(approval.id, copyMCPToolApproval(approval));
  }

  async getByProjectConnectorAndTool(
    projectId: string,
    connectorId: string,
    toolName: string
  ): Promise<MCPToolApprovalRecord | undefined> {
    const approval = [...this.approvals.values()].find(
      (candidate) =>
        candidate.projectId === projectId &&
        candidate.connectorId === connectorId &&
        candidate.toolName === toolName
    );
    return approval ? copyMCPToolApproval(approval) : undefined;
  }

  async listForProject(projectId: string): Promise<MCPToolApprovalRecord[]> {
    return [...this.approvals.values()]
      .filter((approval) => approval.projectId === projectId)
      .map(copyMCPToolApproval);
  }

  async listAll(): Promise<MCPToolApprovalRecord[]> {
    return [...this.approvals.values()].map(copyMCPToolApproval);
  }
}
```

Add copy helpers:

```ts
function copyMCPConnector(connector: MCPConnectorRecord): MCPConnectorRecord {
  return {
    ...connector,
    tools: connector.tools.map((tool) => ({
      ...tool,
      roles: [...tool.roles]
    }))
  };
}

function copyMCPToolApproval(approval: MCPToolApprovalRecord): MCPToolApprovalRecord {
  return { ...approval };
}
```

- [ ] **Step 5: Run DB in-memory tests and verify pass**

Run:

```bash
pnpm exec vitest run packages/db/src/workbench-repositories.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit in-memory MCP repositories**

Run:

```bash
git add packages/db/src/workbench-repositories.ts packages/db/src/workbench-repositories.test.ts
git commit -m "add mcp repository contracts"
```

---

### Task 3: JSON-File MCP Persistence

**Files:**
- Modify: `packages/db/src/json-file-workbench-repositories.ts`
- Modify: `packages/db/src/json-file-workbench-repositories.test.ts`

- [ ] **Step 1: Write failing JSON persistence test**

Add this test to `packages/db/src/json-file-workbench-repositories.test.ts`:

```ts
it("persists mcp connectors and approvals across repository instances", async () => {
  const filePath = join(tempDirectory, "mcp-workbench-state.json");
  const first = createJsonFileWorkbenchRepositories({ filePath });

  await first.mcpConnectors.save({
    id: "connector_assets",
    scope: "project",
    targetKey: "project_1",
    name: "Internal Assets",
    enabled: true,
    tools: [
      {
        name: "searchAssets",
        permission: "assets:read",
        roles: ["builder"],
        requiresApproval: false
      }
    ],
    createdAt,
    updatedAt: createdAt
  });
  await first.mcpToolApprovals.save({
    id: "mcp_approval_1",
    projectId: "project_1",
    connectorId: "connector_assets",
    toolName: "searchAssets",
    state: "approved",
    approvedByUserId: "local-owner",
    createdAt,
    updatedAt: createdAt
  });

  const second = createJsonFileWorkbenchRepositories({
    filePath: join(tempDirectory, "mcp-workbench-state-copy.json")
  });
  const raw = await readFile(filePath, "utf8");
  await writeFile(join(tempDirectory, "mcp-workbench-state-copy.json"), raw, "utf8");

  await expect(second.mcpConnectors.listForProject("project_1")).resolves.toEqual([
    expect.objectContaining({ id: "connector_assets" })
  ]);
  await expect(second.mcpToolApprovals.listForProject("project_1")).resolves.toEqual([
    expect.objectContaining({ id: "mcp_approval_1", state: "approved" })
  ]);
});
```

- [ ] **Step 2: Run JSON repository tests and verify failure**

Run:

```bash
pnpm exec vitest run packages/db/src/json-file-workbench-repositories.test.ts
```

Expected: FAIL because JSON state does not include MCP arrays or repositories.

- [ ] **Step 3: Extend JSON state and repository bundle**

In `packages/db/src/json-file-workbench-repositories.ts`, add imports:

```ts
type MCPConnectorRecord,
type MCPConnectorRepository,
type MCPToolApprovalRecord,
type MCPToolApprovalRepository,
```

Extend `JsonFileWorkbenchState`:

```ts
mcpConnectors: MCPConnectorRecord[];
mcpToolApprovals: MCPToolApprovalRecord[];
```

Add class properties:

```ts
readonly mcpConnectors: MCPConnectorRepository;
readonly mcpToolApprovals: MCPToolApprovalRepository;
```

Initialize them in the constructor:

```ts
this.mcpConnectors = new JsonFileMCPConnectorRepository(filePath);
this.mcpToolApprovals = new JsonFileMCPToolApprovalRepository(filePath);
```

- [ ] **Step 4: Implement JSON repository classes**

Add these classes near the existing JSON repository classes:

```ts
class JsonFileMCPConnectorRepository implements MCPConnectorRepository {
  constructor(private readonly filePath: string) {}

  async save(connector: MCPConnectorRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.mcpConnectors = upsertBy(
        state.mcpConnectors,
        copy(connector),
        (record) => record.id === connector.id
      );
    });
  }

  async getById(connectorId: string): Promise<MCPConnectorRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.mcpConnectors.find((connector) => connector.id === connectorId));
  }

  async listForProject(projectId: string): Promise<MCPConnectorRecord[]> {
    const state = await readState(this.filePath);
    return state.mcpConnectors
      .filter((connector) => connector.scope === "project" && connector.targetKey === projectId)
      .map(copy);
  }

  async listAll(): Promise<MCPConnectorRecord[]> {
    const state = await readState(this.filePath);
    return state.mcpConnectors.map(copy);
  }
}

class JsonFileMCPToolApprovalRepository implements MCPToolApprovalRepository {
  constructor(private readonly filePath: string) {}

  async save(approval: MCPToolApprovalRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.mcpToolApprovals = upsertBy(
        state.mcpToolApprovals,
        copy(approval),
        (record) => record.id === approval.id
      );
    });
  }

  async getByProjectConnectorAndTool(
    projectId: string,
    connectorId: string,
    toolName: string
  ): Promise<MCPToolApprovalRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(
      state.mcpToolApprovals.find(
        (approval) =>
          approval.projectId === projectId &&
          approval.connectorId === connectorId &&
          approval.toolName === toolName
      )
    );
  }

  async listForProject(projectId: string): Promise<MCPToolApprovalRecord[]> {
    const state = await readState(this.filePath);
    return state.mcpToolApprovals
      .filter((approval) => approval.projectId === projectId)
      .map(copy);
  }

  async listAll(): Promise<MCPToolApprovalRecord[]> {
    const state = await readState(this.filePath);
    return state.mcpToolApprovals.map(copy);
  }
}
```

Update `readState()` and `emptyState()` with:

```ts
mcpConnectors: parsed.mcpConnectors ?? [],
mcpToolApprovals: parsed.mcpToolApprovals ?? []
```

and:

```ts
mcpConnectors: [],
mcpToolApprovals: []
```

- [ ] **Step 5: Run JSON repository tests and verify pass**

Run:

```bash
pnpm exec vitest run packages/db/src/json-file-workbench-repositories.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit JSON MCP persistence**

Run:

```bash
git add packages/db/src/json-file-workbench-repositories.ts packages/db/src/json-file-workbench-repositories.test.ts
git commit -m "persist mcp connector state"
```

---

### Task 4: API MCP Lifecycle And Runtime Resolution

**Files:**
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/services.test.ts`

- [ ] **Step 1: Write failing API tests**

Add tests to `packages/api/src/services.test.ts`:

```ts
it("creates project mcp connectors and computes visible tools from skills and approvals", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const service = new DemoWorkbenchService({ repositories, now: fixedNow });
  const project = await service.createProject({ name: "MCP Project" });
  const skill = await service.createSkillDraft({
    manifestJson: JSON.stringify({
      id: "skill_assets",
      name: "Asset Search",
      version: "0.1.0",
      type: "workflow",
      scope: "project",
      description: "Allows asset search.",
      permissions: ["assets:read", "git:write"],
      requiredSecrets: [],
      entrypoints: ["workflow.md"],
      reviewState: "draft"
    }),
    content: "Use approved assets.",
    contentType: "text/markdown"
  });
  await service.validateSkillVersion({ skillVersionId: skill.version.id });
  await service.publishSkillVersion({ skillVersionId: skill.version.id });
  await service.bindSkillVersionToProject({
    projectId: project.id,
    skillVersionId: skill.version.id
  });

  const connector = await service.createProjectMCPConnector({
    projectId: project.id,
    definitionJson: JSON.stringify({
      id: "connector_assets",
      name: "Internal Assets",
      tools: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["builder"],
          requiresApproval: false
        },
        {
          name: "createPullRequest",
          permission: "git:write",
          roles: ["deployer"],
          requiresApproval: true
        }
      ]
    })
  });

  await expect(
    service.listVisibleMCPToolsForProject({
      projectId: project.id,
      role: "builder"
    })
  ).resolves.toEqual([
    {
      connectorId: connector.id,
      name: "searchAssets",
      permission: "assets:read",
      requiresApproval: false
    }
  ]);

  await expect(
    service.listVisibleMCPToolsForProject({
      projectId: project.id,
      role: "deployer"
    })
  ).resolves.toEqual([]);

  await service.setProjectMCPToolApproval({
    projectId: project.id,
    connectorId: connector.id,
    toolName: "createPullRequest",
    approved: true,
    approvedByUserId: "local-owner"
  });

  await expect(
    service.listVisibleMCPToolsForProject({
      projectId: project.id,
      role: "deployer"
    })
  ).resolves.toEqual([
    {
      connectorId: connector.id,
      name: "createPullRequest",
      permission: "git:write",
      requiresApproval: true
    }
  ]);
});

it("passes repository-backed mcp tools into runtime context", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const runtime = new CapturingRuntime();
  const service = new DemoWorkbenchService({
    repositories,
    builderRuntime: runtime,
    now: fixedNow
  });
  const project = await service.createProject({ name: "Runtime MCP" });
  const skill = await service.createSkillDraft({
    manifestJson: JSON.stringify({
      id: "skill_assets",
      name: "Asset Search",
      version: "0.1.0",
      type: "workflow",
      scope: "project",
      description: "Allows asset search.",
      permissions: ["assets:read"],
      requiredSecrets: [],
      entrypoints: ["workflow.md"],
      reviewState: "draft"
    }),
    content: "Use asset search.",
    contentType: "text/plain"
  });
  await service.validateSkillVersion({ skillVersionId: skill.version.id });
  await service.publishSkillVersion({ skillVersionId: skill.version.id });
  await service.bindSkillVersionToProject({
    projectId: project.id,
    skillVersionId: skill.version.id
  });
  await service.createProjectMCPConnector({
    projectId: project.id,
    definitionJson: JSON.stringify({
      id: "connector_assets",
      name: "Assets",
      tools: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["builder"],
          requiresApproval: false
        }
      ]
    })
  });

  const brief = await service.createBriefFromPrompt({
    projectId: project.id,
    prompt: "Generate a static LP."
  });
  await service.generatePageVersion({
    projectId: project.id,
    briefId: brief.id
  });

  expect(runtime.lastRequest?.context?.mcpTools).toEqual([
    {
      connectorId: "connector_assets",
      name: "searchAssets",
      permission: "assets:read",
      requiresApproval: false
    }
  ]);
});
```

- [ ] **Step 2: Run API tests and verify failure**

Run:

```bash
pnpm exec vitest run packages/api/src/services.test.ts
```

Expected: FAIL because MCP service methods do not exist and runtime still uses `sampleConnector`.

- [ ] **Step 3: Add API input/output types**

In `packages/api/src/index.ts`, import MCP types and helpers:

```ts
import {
  computeVisibleTools,
  normalizeMCPConnectorDefinition,
  type MCPToolApprovalState
} from "@lp-agent/mcp-gateway";
```

Extend DB imports/exports with:

```ts
type MCPConnectorRecord,
type MCPToolApprovalRecord,
```

Add API interfaces:

```ts
export interface CreateProjectMCPConnectorInput {
  projectId: string;
  definitionJson: string;
}

export interface SetProjectMCPConnectorEnabledInput {
  projectId: string;
  connectorId: string;
  enabled: boolean;
}

export interface SetProjectMCPToolApprovalInput {
  projectId: string;
  connectorId: string;
  toolName: string;
  approved: boolean;
  approvedByUserId?: string;
}

export interface ListVisibleMCPToolsInput {
  projectId: string;
  role: AgentRole;
}

export interface ProjectMCPState {
  connectors: MCPConnectorRecord[];
  approvals: MCPToolApprovalRecord[];
  visibleToolsByRole: Record<AgentRole, RuntimeRunContext["mcpTools"]>;
}
```

- [ ] **Step 4: Add API lifecycle methods**

Add these methods to `DemoWorkbenchService`:

```ts
async createProjectMCPConnector(
  input: CreateProjectMCPConnectorInput
): Promise<MCPConnectorRecord> {
  await this.getProjectOrThrow(input.projectId);
  const definition = parseMCPConnectorJson(input.definitionJson);

  return withRepositoryIdLock(this.repositories, async () => {
    if (await this.repositories.mcpConnectors.getById(definition.id)) {
      throw new Error("mcp_connector_already_exists");
    }
    const timestamp = this.timestamp();
    const connector: MCPConnectorRecord = {
      id: definition.id,
      scope: "project",
      targetKey: input.projectId,
      name: definition.name,
      description: definition.description,
      tools: definition.tools,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.repositories.mcpConnectors.save(connector);
    return copyMCPConnectorRecord(connector);
  });
}

async setProjectMCPConnectorEnabled(
  input: SetProjectMCPConnectorEnabledInput
): Promise<MCPConnectorRecord> {
  await this.getProjectOrThrow(input.projectId);
  const connector = await this.repositories.mcpConnectors.getById(input.connectorId);
  if (!connector || !isProjectMCPConnectorForProject(connector, input.projectId)) {
    throw new Error("mcp_connector_not_found");
  }
  const updated: MCPConnectorRecord = {
    ...connector,
    enabled: input.enabled,
    updatedAt: this.timestamp()
  };
  await this.repositories.mcpConnectors.save(updated);
  return copyMCPConnectorRecord(updated);
}

async setProjectMCPToolApproval(
  input: SetProjectMCPToolApprovalInput
): Promise<MCPToolApprovalRecord> {
  await this.getProjectOrThrow(input.projectId);
  const connector = await this.repositories.mcpConnectors.getById(input.connectorId);
  if (!connector || !isProjectMCPConnectorForProject(connector, input.projectId)) {
    throw new Error("mcp_connector_not_found");
  }
  const tool = connector.tools.find((candidate) => candidate.name === input.toolName);
  if (!tool) {
    throw new Error("mcp_tool_not_found");
  }
  if (!tool.requiresApproval) {
    throw new Error("mcp_tool_approval_not_required");
  }

  const existing = await this.repositories.mcpToolApprovals.getByProjectConnectorAndTool(
    input.projectId,
    connector.id,
    tool.name
  );
  const timestamp = this.timestamp();
  const approval: MCPToolApprovalRecord = {
    id: existing?.id ?? nextSequentialId(
      "mcp_approval",
      (await this.repositories.mcpToolApprovals.listAll()).map((record) => record.id)
    ),
    projectId: input.projectId,
    connectorId: connector.id,
    toolName: tool.name,
    state: input.approved ? "approved" : "pending",
    approvedByUserId: input.approved ? input.approvedByUserId ?? "local-owner" : undefined,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp
  };
  await this.repositories.mcpToolApprovals.save(approval);
  return copyMCPToolApprovalRecord(approval);
}
```

- [ ] **Step 5: Add MCP state and visible tool resolution**

Add these methods to `DemoWorkbenchService`:

```ts
async listProjectMCPState(projectId: string): Promise<ProjectMCPState> {
  await this.getProjectOrThrow(projectId);
  const visibleEntries = await Promise.all(
    agentRoles.map(async (role) => [
      role,
      await this.listVisibleMCPToolsForProject({ projectId, role })
    ] as const)
  );
  return {
    connectors: (await this.repositories.mcpConnectors.listForProject(projectId)).map(
      copyMCPConnectorRecord
    ),
    approvals: (await this.repositories.mcpToolApprovals.listForProject(projectId)).map(
      copyMCPToolApprovalRecord
    ),
    visibleToolsByRole: Object.fromEntries(visibleEntries) as ProjectMCPState["visibleToolsByRole"]
  };
}

async listVisibleMCPToolsForProject(
  input: ListVisibleMCPToolsInput
): Promise<RuntimeRunContext["mcpTools"]> {
  await this.getProjectOrThrow(input.projectId);
  const role = normalizeAgentRole(input.role);
  const skillVersions = await this.listRuntimeSkillsForProject(input.projectId);
  return this.resolveVisibleMCPTools({
    projectId: input.projectId,
    role,
    skillVersions
  });
}

private async resolveVisibleMCPTools(input: {
  projectId: string;
  role: AgentRole;
  skillVersions: SkillVersionRecord[];
}): Promise<RuntimeRunContext["mcpTools"]> {
  const grantedPermissions = [
    ...new Set(input.skillVersions.flatMap((version) => version.manifest.permissions))
  ];
  const connectors = (await this.repositories.mcpConnectors.listForProject(input.projectId))
    .filter((connector) => connector.enabled)
    .map(copyMCPConnectorRecord);
  const approvals = await this.repositories.mcpToolApprovals.listForProject(input.projectId);
  const approvalStates: MCPToolApprovalState[] = approvals.map((approval) => ({
    connectorId: approval.connectorId,
    toolName: approval.toolName,
    state: approval.state
  }));

  return connectors.flatMap((connector) =>
    computeVisibleTools({
      connectors: [connector],
      projectConnectorIds: [connector.id],
      skillPermissions: grantedPermissions,
      agentRole: input.role,
      approvalStates
    }).map((tool) => ({
      connectorId: connector.id,
      name: tool.name,
      permission: tool.permission,
      requiresApproval: tool.requiresApproval
    }))
  );
}
```

Update `createRuntimeContext()`:

```ts
const skillVersions = await this.listRuntimeSkillsForProject(projectId);
const [mcpTools, modelRoutingPolicy] = await Promise.all([
  this.resolveVisibleMCPTools({ projectId, role, skillVersions }),
  this.resolveModelRoutingPolicyForProject(projectId)
]);
return createWorkbenchRuntimeContext({
  role,
  approvalState,
  skillVersions,
  mcpTools,
  modelRoutingPolicy
});
```

Update `createWorkbenchRuntimeContext()` input and remove hardcoded `sampleConnector` use:

```ts
function createWorkbenchRuntimeContext(input: {
  role: AgentRole;
  approvalState?: ApprovalState;
  skillVersions: SkillVersionRecord[];
  mcpTools: RuntimeRunContext["mcpTools"];
  modelRoutingPolicy: ModelRoutingPolicy;
}): RuntimeRunContext {
  const approvalState = input.approvalState ?? "not_required";
  const boundSkillIds = input.skillVersions.map((version) => version.manifest.id);
  const grantedPermissions = [
    ...new Set(input.skillVersions.flatMap((version) => version.manifest.permissions))
  ];
  const skills = input.skillVersions
    .filter((version) =>
      canUseSkill({
        manifest: version.manifest,
        boundSkillIds,
        grantedPermissions
      })
    )
    .map(toRuntimeSkill);

  return {
    skills,
    mcpTools: input.mcpTools.map((tool) => ({ ...tool })),
    approval: { state: approvalState },
    artifactWorkspace: {
      mode: "memory",
      writableFiles: ["index.html", "styles.css", "script.js"]
    },
    modelRoutingPolicy: input.modelRoutingPolicy
  };
}
```

- [ ] **Step 6: Add parse and copy helpers**

Add helpers near existing normalize/copy helpers:

```ts
function parseMCPConnectorJson(definitionJson: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(definitionJson);
  } catch {
    throw new Error("mcp_connector_json_invalid");
  }
  try {
    return normalizeMCPConnectorDefinition(parsed);
  } catch {
    throw new Error("mcp_connector_validation_failed");
  }
}

function isProjectMCPConnectorForProject(
  connector: MCPConnectorRecord,
  projectId: string
): boolean {
  return connector.scope === "project" && connector.targetKey === projectId;
}

function copyMCPConnectorRecord(connector: MCPConnectorRecord): MCPConnectorRecord {
  return {
    ...connector,
    tools: connector.tools.map((tool) => ({
      ...tool,
      roles: [...tool.roles]
    }))
  };
}

function copyMCPToolApprovalRecord(
  approval: MCPToolApprovalRecord
): MCPToolApprovalRecord {
  return { ...approval };
}
```

- [ ] **Step 7: Run API tests and verify pass**

Run:

```bash
pnpm exec vitest run packages/api/src/services.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit API MCP runtime wiring**

Run:

```bash
git add packages/api/src/index.ts packages/api/src/services.test.ts
git commit -m "wire project mcp tools into runtime"
```

---

### Task 5: Web Store And Server Actions

**Files:**
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`
- Modify: `apps/web/src/app/actions.ts`
- Modify: `apps/web/src/app/actions.test.ts`

- [ ] **Step 1: Write failing Web store tests**

Add tests to `apps/web/src/lib/workbench-store.test.ts`:

```ts
it("loads project mcp state and creates project connectors", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const store = createWebWorkbenchStore({ repositories });
  const project = await store.createProject({ name: "MCP Web" });

  const result = await store.createMCPConnector({
    projectId: project.id,
    definitionJson: JSON.stringify({
      id: "connector_assets",
      name: "Assets",
      tools: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["builder"],
          requiresApproval: false
        }
      ]
    })
  });

  expect(result).toMatchObject({
    ok: true,
    value: {
      id: "connector_assets",
      enabled: true
    }
  });

  const pageState = await store.getPageState({ projectId: project.id });
  expect(pageState.mcp.connectors).toEqual([
    expect.objectContaining({ id: "connector_assets" })
  ]);
});

it("returns stable mcp errors from the Web store", async () => {
  const store = createWebWorkbenchStore({
    repositories: createInMemoryWorkbenchRepositories()
  });

  await expect(
    store.createMCPConnector({
      projectId: "missing_project",
      definitionJson: "{"
    })
  ).resolves.toEqual({
    ok: false,
    error: "project_not_found"
  });
});
```

- [ ] **Step 2: Add Web store MCP types and methods**

In `apps/web/src/lib/workbench-store.ts`, import/export API MCP types:

```ts
type MCPConnectorRecord,
type MCPToolApprovalRecord,
type ProjectMCPState,
```

Add error type:

```ts
export type MCPFlowErrorCode =
  | "project_not_found"
  | "mcp_connector_json_invalid"
  | "mcp_connector_validation_failed"
  | "mcp_connector_scope_unsupported"
  | "mcp_connector_already_exists"
  | "mcp_connector_not_found"
  | "mcp_tool_not_found"
  | "mcp_tool_approval_not_required"
  | "mcp_operation_failed";
```

Add action result and input types:

```ts
export type MCPActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MCPFlowErrorCode };

export interface CreateMCPConnectorFormInput {
  projectId: string;
  definitionJson: string;
}

export interface SetMCPToolApprovalFormInput {
  projectId: string;
  connectorId: string;
  toolName: string;
  approved: boolean;
}
```

Extend page state variants with:

```ts
mcp: ProjectMCPState;
```

Add `emptyMCPState()` and loader:

```ts
const emptyMCPState = (): ProjectMCPState => ({
  connectors: [],
  approvals: [],
  visibleToolsByRole: createEmptyVisibleToolsByRole()
});

function createEmptyVisibleToolsByRole(): ProjectMCPState["visibleToolsByRole"] {
  return {
    planner: [],
    builder: [],
    reviewer: [],
    deployer: []
  };
}

const loadMCPState = async (projectId?: string | null): Promise<ProjectMCPState> => {
  if (!projectId) {
    return emptyMCPState();
  }
  try {
    return await service.listProjectMCPState(projectId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "project_not_found" || message === "Project not found.") {
      return emptyMCPState();
    }
    throw error;
  }
};
```

Call `loadMCPState()` in both page state branches.

Extend `WebWorkbenchStore`:

```ts
createMCPConnector(input: CreateMCPConnectorFormInput): Promise<MCPActionResult<MCPConnectorRecord>>;
setMCPConnectorEnabled(input: {
  projectId: string;
  connectorId: string;
  enabled: boolean;
}): Promise<MCPActionResult<MCPConnectorRecord>>;
setMCPToolApproval(
  input: SetMCPToolApprovalFormInput
): Promise<MCPActionResult<MCPToolApprovalRecord>>;
```

Add implementations that call `service.createProjectMCPConnector()`, `service.setProjectMCPConnectorEnabled()`, and `service.setProjectMCPToolApproval()`.

Add error mapping:

```ts
function toMCPFlowError(error: unknown): MCPFlowErrorCode {
  const message = error instanceof Error ? error.message : "";
  if (
    message === "project_not_found" ||
    message === "mcp_connector_json_invalid" ||
    message === "mcp_connector_validation_failed" ||
    message === "mcp_connector_scope_unsupported" ||
    message === "mcp_connector_already_exists" ||
    message === "mcp_connector_not_found" ||
    message === "mcp_tool_not_found" ||
    message === "mcp_tool_approval_not_required"
  ) {
    return message;
  }
  if (message === "Project not found.") {
    return "project_not_found";
  }
  return "mcp_operation_failed";
}
```

- [ ] **Step 3: Write failing action tests**

Add tests to `apps/web/src/app/actions.test.ts` that follow the existing redirect-mocking style:

```ts
it("redirects mcp connector creation errors to the mcp view", async () => {
  const formData = new FormData();
  formData.set("projectId", "missing_project");
  formData.set("definitionJson", "{");

  await expect(createMCPConnectorAction(formData)).rejects.toThrow(
    "/?view=mcp&mcpError=project_not_found"
  );
});
```

- [ ] **Step 4: Add MCP server actions**

In `apps/web/src/app/actions.ts`, import `MCPFlowErrorCode` and add:

```ts
function redirectToMCPWithError(error: MCPFlowErrorCode): never {
  redirect(`/?view=mcp&mcpError=${encodeURIComponent(error)}`);
}
```

Add actions:

```ts
export async function createMCPConnectorAction(formData: FormData): Promise<void> {
  const currentProjectId = await getCurrentProjectId();
  const projectId = currentProjectId ?? String(formData.get("projectId") ?? "");
  if (!projectId) {
    redirectToMCPWithError("project_not_found");
  }
  const result = await getWebWorkbenchStore().createMCPConnector({
    projectId,
    definitionJson: String(formData.get("definitionJson") ?? "")
  });
  if (!result.ok) {
    redirectToMCPWithError(result.error);
  }
  await setCurrentProjectId(projectId);
  revalidatePath("/");
  redirect("/?view=mcp");
}

export async function setMCPConnectorEnabledAction(formData: FormData): Promise<void> {
  const currentProjectId = await getCurrentProjectId();
  const projectId = currentProjectId ?? String(formData.get("projectId") ?? "");
  if (!projectId) {
    redirectToMCPWithError("project_not_found");
  }
  const result = await getWebWorkbenchStore().setMCPConnectorEnabled({
    projectId,
    connectorId: String(formData.get("connectorId") ?? ""),
    enabled: String(formData.get("enabled") ?? "false") === "true"
  });
  if (!result.ok) {
    redirectToMCPWithError(result.error);
  }
  await setCurrentProjectId(projectId);
  revalidatePath("/");
  redirect("/?view=mcp");
}

export async function setMCPToolApprovalAction(formData: FormData): Promise<void> {
  const currentProjectId = await getCurrentProjectId();
  const projectId = currentProjectId ?? String(formData.get("projectId") ?? "");
  if (!projectId) {
    redirectToMCPWithError("project_not_found");
  }
  const result = await getWebWorkbenchStore().setMCPToolApproval({
    projectId,
    connectorId: String(formData.get("connectorId") ?? ""),
    toolName: String(formData.get("toolName") ?? ""),
    approved: String(formData.get("approved") ?? "false") === "true"
  });
  if (!result.ok) {
    redirectToMCPWithError(result.error);
  }
  await setCurrentProjectId(projectId);
  revalidatePath("/");
  redirect("/?view=mcp");
}
```

- [ ] **Step 5: Run Web store and action tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Web MCP actions**

Run:

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.ts apps/web/src/app/actions.test.ts
git commit -m "add web mcp actions"
```

---

### Task 6: Web MCP View And Localization

**Files:**
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Write failing page tests**

Add tests to `apps/web/src/app/page.test.ts`:

```ts
it("renders the MCP view with localized project context", async () => {
  const html = await renderHomePage({
    searchParams: Promise.resolve({ view: "mcp" }),
    acceptLanguage: "en"
  });

  expect(html).toContain("Project MCP");
  expect(html).toContain("Connector JSON");
  expect(html).toContain("Visible tools");
});

it("renders the MCP view in Chinese", async () => {
  const html = await renderHomePage({
    searchParams: Promise.resolve({ view: "mcp" }),
    acceptLanguage: "zh-CN"
  });

  expect(html).toContain("项目 MCP");
  expect(html).toContain("连接器 JSON");
  expect(html).toContain("可见工具");
});
```

- [ ] **Step 2: Add i18n copy**

In `apps/web/src/lib/i18n.ts`, extend imports with `MCPFlowErrorCode` and add this section to `WorkbenchCopy`:

```ts
mcpView: {
  title: string;
  subtitle: string;
  activeProjectLabel: string;
  noProject: string;
  createTitle: string;
  definitionLabel: string;
  definitionPlaceholder: string;
  createConnector: string;
  connectorsTitle: string;
  toolsTitle: string;
  visibleToolsTitle: string;
  enabled: string;
  disabled: string;
  enable: string;
  disable: string;
  approve: string;
  revoke: string;
  approvalRequired: string;
  approvalNotRequired: string;
  permissionLabel: string;
  rolesLabel: string;
  emptyConnectors: string;
  emptyVisibleTools: string;
  roleLabels: Record<"planner" | "builder" | "reviewer" | "deployer", string>;
  errors: Record<MCPFlowErrorCode, string>;
};
```

Add English copy:

```ts
mcpView: {
  title: "Project MCP",
  subtitle: "Register project connectors and expose only approved, permission-scoped tools to the runtime.",
  activeProjectLabel: "Active project",
  noProject: "No active project",
  createTitle: "Create connector",
  definitionLabel: "Connector JSON",
  definitionPlaceholder: JSON.stringify(
    {
      id: "connector_assets",
      name: "Internal Assets",
      description: "Read approved asset metadata.",
      tools: [
        {
          name: "searchAssets",
          description: "Search approved brand assets.",
          permission: "assets:read",
          roles: ["planner", "builder", "reviewer"],
          requiresApproval: false
        }
      ]
    },
    null,
    2
  ),
  createConnector: "Create connector",
  connectorsTitle: "Connectors",
  toolsTitle: "Tools",
  visibleToolsTitle: "Visible tools",
  enabled: "Enabled",
  disabled: "Disabled",
  enable: "Enable",
  disable: "Disable",
  approve: "Approve",
  revoke: "Revoke",
  approvalRequired: "Approval required",
  approvalNotRequired: "No approval required",
  permissionLabel: "Permission",
  rolesLabel: "Roles",
  emptyConnectors: "No project MCP connectors yet.",
  emptyVisibleTools: "No visible tools for this role.",
  roleLabels: {
    planner: "Planner",
    builder: "Builder",
    reviewer: "Reviewer",
    deployer: "Deployer"
  },
  errors: {
    project_not_found: "The selected project is no longer available.",
    mcp_connector_json_invalid: "Enter valid connector JSON.",
    mcp_connector_validation_failed: "Connector JSON must include id, name, and valid tools.",
    mcp_connector_scope_unsupported: "Only project-scoped connectors are supported in this version.",
    mcp_connector_already_exists: "A connector with this id already exists.",
    mcp_connector_not_found: "The connector was not found for this project.",
    mcp_tool_not_found: "The selected MCP tool was not found.",
    mcp_tool_approval_not_required: "This tool does not require approval.",
    mcp_operation_failed: "The MCP operation failed."
  }
}
```

Add Chinese copy with these exact visible labels:

```ts
title: "项目 MCP",
definitionLabel: "连接器 JSON",
visibleToolsTitle: "可见工具"
```

- [ ] **Step 3: Render MCP view**

In `apps/web/src/app/page.tsx`:

1. Import MCP actions.
2. Add `mcpError?: string` to `searchParams`.
3. Include `params?.view === "mcp" ? "mcp" : ...` in `activeView`.
4. Make the MCP nav item a link:

```tsx
<a className={activeView === "mcp" ? "navItem navItemActive" : "navItem"} href="/?view=mcp">
  {copy.nav.mcp}
</a>
```

5. Add error mapping:

```ts
const mcpError = toMCPFlowError(params?.mcpError);
const mcpErrorMessage = mcpError ? copy.mcpView.errors[mcpError] : undefined;
```

6. Render MCP view before the Models view:

```tsx
{activeView === "mcp" ? (
  <section className="mcpView" aria-labelledby="mcp-title">
    <header className="mcpHeader">
      <div>
        <h1 id="mcp-title">{copy.mcpView.title}</h1>
        <p>{copy.mcpView.subtitle}</p>
      </div>
    </header>

    {mcpErrorMessage ? <div className="formError" role="alert">{mcpErrorMessage}</div> : null}

    <div className="mcpProjectContext">
      <span>{copy.mcpView.activeProjectLabel}</span>
      <strong>{activeProject?.name ?? copy.mcpView.noProject}</strong>
    </div>

    {activeProject ? (
      <>
        <form action={createMCPConnectorAction} className="mcpEditor">
          <h2>{copy.mcpView.createTitle}</h2>
          <input name="projectId" type="hidden" value={activeProject.id} />
          <label htmlFor="definitionJson">{copy.mcpView.definitionLabel}</label>
          <textarea
            id="definitionJson"
            name="definitionJson"
            placeholder={copy.mcpView.definitionPlaceholder}
          />
          <button type="submit">{copy.mcpView.createConnector}</button>
        </form>

        <section className="mcpList" aria-labelledby="mcp-connectors-title">
          <h2 id="mcp-connectors-title">{copy.mcpView.connectorsTitle}</h2>
          {pageState.mcp.connectors.length > 0 ? (
            pageState.mcp.connectors.map((connector) => (
              <div className="mcpConnectorRow" key={connector.id}>
                <div>
                  <strong>{connector.name}</strong>
                  <span>{connector.enabled ? copy.mcpView.enabled : copy.mcpView.disabled}</span>
                </div>
                <form action={setMCPConnectorEnabledAction}>
                  <input name="projectId" type="hidden" value={activeProject.id} />
                  <input name="connectorId" type="hidden" value={connector.id} />
                  <input name="enabled" type="hidden" value={connector.enabled ? "false" : "true"} />
                  <button type="submit">
                    {connector.enabled ? copy.mcpView.disable : copy.mcpView.enable}
                  </button>
                </form>
                <div className="mcpToolGrid">
                  {connector.tools.map((tool) => {
                    const approval = pageState.mcp.approvals.find(
                      (record) =>
                        record.connectorId === connector.id &&
                        record.toolName === tool.name &&
                        record.state === "approved"
                    );
                    return (
                      <div className="mcpToolCard" key={tool.name}>
                        <strong>{tool.name}</strong>
                        <span>{`${copy.mcpView.permissionLabel}: ${tool.permission}`}</span>
                        <small>{`${copy.mcpView.rolesLabel}: ${tool.roles.join(", ")}`}</small>
                        <small>
                          {tool.requiresApproval
                            ? copy.mcpView.approvalRequired
                            : copy.mcpView.approvalNotRequired}
                        </small>
                        {tool.requiresApproval ? (
                          <form action={setMCPToolApprovalAction}>
                            <input name="projectId" type="hidden" value={activeProject.id} />
                            <input name="connectorId" type="hidden" value={connector.id} />
                            <input name="toolName" type="hidden" value={tool.name} />
                            <input name="approved" type="hidden" value={approval ? "false" : "true"} />
                            <button type="submit">
                              {approval ? copy.mcpView.revoke : copy.mcpView.approve}
                            </button>
                          </form>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          ) : (
            <p>{copy.mcpView.emptyConnectors}</p>
          )}
        </section>

        <section className="mcpList" aria-labelledby="mcp-visible-tools-title">
          <h2 id="mcp-visible-tools-title">{copy.mcpView.visibleToolsTitle}</h2>
          {roleOrder.map((role) => (
            <div className="mcpVisibleRole" key={role}>
              <strong>{copy.mcpView.roleLabels[role]}</strong>
              {(pageState.mcp.visibleToolsByRole[role] ?? []).length > 0 ? (
                <span>
                  {pageState.mcp.visibleToolsByRole[role]
                    .map((tool) => `${tool.connectorId}.${tool.name}`)
                    .join(", ")}
                </span>
              ) : (
                <span>{copy.mcpView.emptyVisibleTools}</span>
              )}
            </div>
          ))}
        </section>
      </>
    ) : null}
  </section>
) : null}
```

Add local helper `toMCPFlowError()` matching the Web store error union.

- [ ] **Step 4: Add CSS for MCP view**

In `apps/web/src/app/globals.css`, add MCP selectors beside the existing skills/models selectors:

```css
.mcpView,
.skillsView,
.modelsView {
  width: min(920px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 16px;
}

.mcpHeader,
.skillsHeader,
.modelsHeader {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.mcpProjectContext,
.skillsProjectContext,
.modelsProjectContext {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.mcpEditor,
.mcpList {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.mcpEditor textarea {
  min-height: 220px;
  font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.mcpConnectorRow,
.mcpVisibleRole {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--canvas);
}

.mcpToolGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.mcpToolCard {
  display: grid;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
```

If the current CSS already groups `.skillsView` and `.modelsView`, extend those grouped selectors instead of duplicating conflicting blocks.

- [ ] **Step 5: Run page tests**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts apps/web/src/lib/i18n.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit MCP view**

Run:

```bash
git add apps/web/src/lib/i18n.ts apps/web/src/app/page.tsx apps/web/src/app/page.test.ts apps/web/src/app/globals.css
git commit -m "add project mcp view"
```

---

### Task 7: Full Verification And Browser Smoke

**Files:**
- No source edits expected unless verification exposes a defect.

- [ ] **Step 1: Run full tests**

Run:

```bash
pnpm test
```

Expected: all Vitest test files pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: all workspace package typechecks pass.

- [ ] **Step 3: Run build**

Run:

```bash
pnpm build
```

Expected: all package and app builds pass.

- [ ] **Step 4: Run diff whitespace check**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 5: Start the Web app**

Run:

```bash
pnpm dev
```

Expected: Next.js starts on `http://localhost:3000` or the next available port.

- [ ] **Step 6: Smoke-test the MCP view**

Open:

```text
http://localhost:3000/?view=mcp
```

Expected:

- English browser language shows `Project MCP`.
- Chinese browser language shows `项目 MCP`.
- Sidebar MCP nav is active.
- With no active project, the view shows the no-project state and no connector form.
- After creating/selecting a project, connector JSON form appears.
- Creating the sample connector renders connector tools.
- Approval-required tools show Approve/Revoke controls.
- Visible tools summary only shows tools allowed by bound published skills and approval state.

- [ ] **Step 7: Stop the dev server**

Stop the `pnpm dev` process with Ctrl-C or the shell process manager.

- [ ] **Step 8: Commit verification fixes if needed**

If verification required fixes, commit them:

```bash
git add <changed-files>
git commit -m "stabilize mcp connector view"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review Checklist

- The plan implements only registry, approval, visibility, and runtime metadata.
- The plan does not execute MCP tools, shell commands, Git writes, or deployment commands.
- Runtime context no longer injects `sampleConnector`.
- Project-level scope is explicit and broader scope remains a future extension.
- Web copy is routed through `apps/web/src/lib/i18n.ts`.
- Generated LP artifacts remain framework-free static HTML/CSS/JS.
- Full verification commands are included before completion.
