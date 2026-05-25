# MCP Management Surface v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Stage 54 post-V1 Web MCP management surface：恢复单一 `MCP` navigation entry，展示 project-scoped connector / tool / approval / health 摘要，并只给 visible read-only tools 提供安全执行 affordance。

**Architecture:** Web 只做安全产品投影：事实来源仍是 existing MCP store / API / service contracts，页面新增纯 view-model 派生 display rows 和 diagnostics。Server action 对 MCP execution 不接收浏览器 raw arguments，统一提交 `{}` 到现有 read-only API path，让 Stage 20 的 backend 校验和 `ToolObservationRecord` 继续拥有最终执行边界。

**Tech Stack:** Next.js App Router server components, TypeScript, Vitest, Playwright, existing pnpm workspace scripts, existing in-memory / JSON-file deterministic workbench state.

---

## 执行前上下文

- 先读 `docs/superpowers/specs/2026-05-25-mcp-management-surface-v0-design.md`，它是 Stage 54 的产品和安全 contract。
- 当前 `apps/web/src/app/page.tsx` 在 Stage 41 后隐藏 `view=mcp`；历史实现可参考 `git show f4ae159:apps/web/src/app/page.tsx`，但必须升级为 Stage 51 的 safe projection。
- 允许触碰的主要代码：`apps/web/src/app/page.tsx`、`apps/web/src/app/actions.ts`、`apps/web/src/lib/i18n.ts`、Web tests、browser tests、docs。
- 不修改 `packages/mcp-gateway` real MCP SDK、worker execution、write tools、secret storage、auth/RBAC、deployment/provider/browser platform。
- 本计划默认在独立 worktree 分支 `stage-54-mcp-management-surface-implementation` 执行，每个 task 完成后提交。

## 文件结构

- Create `apps/web/src/app/mcp-management-view-model.ts`
  - 唯一职责：把 `ProjectMCPState` 映射成 MCP management rows、status labels、approval/read-only/visible tool affordance。
  - 不调用 store，不执行 MCP，不读取 query，不持久化。
- Create `apps/web/src/app/mcp-management-view-model.test.ts`
  - 覆盖 health/status、approval summary、read-only eligibility、malformed record fail-closed 和 non-leakage。
- Modify `apps/web/src/app/actions.ts`
  - MCP execution action 改为忽略 browser-submitted `argumentsJson`，只传 `"{}"` 给 store。
  - Connector create/enable/approval actions 保持 project-scoped existing behavior。
- Modify `apps/web/src/app/page.tsx`
  - `activeView` 支持 `"mcp"`，navigation 恢复单一 `MCP` entry。
  - 渲染 MCP management view，复用 existing server actions 和 new view-model。
  - 页面不渲染 raw MCP output、raw arguments textarea、本机路径、secret-looking query 或 malformed connector raw JSON。
- Modify `apps/web/src/lib/i18n.ts`
  - 增加 MCP management copy：status labels、policy summary、pending labels、safe diagnostics、empty state。
- Modify tests:
  - `apps/web/src/app/page.test.ts`
  - `apps/web/src/app/actions.test.ts`
  - `apps/web/src/lib/i18n.test.ts`
  - `apps/web/e2e/alpha-health.spec.ts`
  - `apps/web/e2e/alpha-boundaries.spec.ts`
  - Create `apps/web/e2e/alpha-mcp-management.spec.ts`
  - Update `apps/web/e2e/helpers.ts` only if a small reusable MCP helper reduces duplication.
- Modify docs:
  - `docs/web-v1-acceptance.md`
  - `docs/alpha-release-candidate.md`
  - `docs/project-roadmap.md`
  - `docs/superpowers/README.md`
  - `docs/agent-development-learning.md`

## Task 1: MCP Management View Model

**Files:**
- Create: `apps/web/src/app/mcp-management-view-model.ts`
- Create: `apps/web/src/app/mcp-management-view-model.test.ts`

- [ ] **Step 1: Write failing tests for status, eligibility, and non-leakage**

Add tests that exercise the pure view-model without rendering React:

```ts
import { describe, expect, it } from "vitest";
import { getWorkbenchCopy } from "../lib/i18n";
import {
  buildMCPManagementViewModel,
  isReadOnlyVisibleMCPTool,
  mcpManagementRoleOrder
} from "./mcp-management-view-model";

const copy = getWorkbenchCopy("en");

describe("buildMCPManagementViewModel", () => {
  it("summarizes connector metadata and approval state without raw arguments", () => {
    const viewModel = buildMCPManagementViewModel({
      copy,
      mcpState: {
        connectors: [
          {
            id: "connector_assets",
            projectId: "project_1",
            scope: "project",
            name: "Assets",
            description: "Search approved assets.",
            enabled: true,
            tools: [
              {
                name: "searchAssets",
                description: "Search public assets.",
                permission: "assets:read",
                roles: ["planner", "builder"],
                requiresApproval: false,
                readOnly: true,
                sideEffect: "read"
              },
              {
                name: "deployAsset",
                permission: "assets:write",
                roles: ["deployer"],
                requiresApproval: true,
                readOnly: false,
                sideEffect: "write"
              }
            ],
            createdAt: "2026-05-25T00:00:00.000Z",
            updatedAt: "2026-05-25T00:00:00.000Z"
          }
        ],
        approvals: [
          {
            id: "approval_1",
            projectId: "project_1",
            connectorId: "connector_assets",
            toolName: "deployAsset",
            state: "pending",
            createdAt: "2026-05-25T00:00:00.000Z",
            updatedAt: "2026-05-25T00:00:00.000Z"
          }
        ],
        visibleToolsByRole: {
          assistant: [],
          planner: [
            {
              connectorId: "connector_assets",
              name: "searchAssets",
              permission: "assets:read",
              requiresApproval: false,
              readOnly: true,
              sideEffect: "read"
            }
          ],
          builder: [],
          reviewer: [],
          deployer: []
        }
      }
    });

    expect(viewModel.summary.connectorCount).toBe(1);
    expect(viewModel.summary.visibleToolCount).toBe(1);
    expect(viewModel.connectors[0]?.status).toBe("configured");
    expect(viewModel.connectors[0]?.tools[0]?.executionAvailable).toBe(true);
    expect(viewModel.connectors[0]?.tools[1]?.readOnlyEligible).toBe(false);
    expect(JSON.stringify(viewModel)).not.toContain("SECRET_PRODUCT");
  });

  it("fails closed for malformed connector records", () => {
    const viewModel = buildMCPManagementViewModel({
      copy,
      mcpState: {
        connectors: [
          {
            id: "connector_invalid",
            projectId: "project_1",
            scope: "project",
            name: "",
            enabled: true,
            tools: "RAW_MALFORMED_SECRET",
            createdAt: "2026-05-25T00:00:00.000Z",
            updatedAt: "2026-05-25T00:00:00.000Z"
          } as never
        ],
        approvals: [],
        visibleToolsByRole: {
          assistant: [],
          planner: [],
          builder: [],
          reviewer: [],
          deployer: []
        }
      }
    });

    expect(viewModel.connectors[0]?.status).toBe("invalid_definition");
    expect(viewModel.connectors[0]?.tools).toEqual([]);
    expect(JSON.stringify(viewModel)).not.toContain("RAW_MALFORMED_SECRET");
  });
});

describe("isReadOnlyVisibleMCPTool", () => {
  it("requires explicit read-only markers or conservative :read permission", () => {
    expect(isReadOnlyVisibleMCPTool({ permission: "assets:read" })).toBe(true);
    expect(isReadOnlyVisibleMCPTool({ permission: "assets:write" })).toBe(false);
    expect(isReadOnlyVisibleMCPTool({ permission: "assets:read", readOnly: false })).toBe(false);
    expect(isReadOnlyVisibleMCPTool({ permission: "assets:custom" })).toBe(false);
  });
});

describe("mcpManagementRoleOrder", () => {
  it("keeps runtime roles in fixed display order", () => {
    expect(mcpManagementRoleOrder).toEqual(["planner", "builder", "reviewer", "deployer"]);
  });
});
```

- [ ] **Step 2: Run focused test and verify failure**

Run:

```bash
pnpm vitest run apps/web/src/app/mcp-management-view-model.test.ts
```

Expected: fails because `mcp-management-view-model.ts` does not exist.

- [ ] **Step 3: Implement the view-model**

Create `apps/web/src/app/mcp-management-view-model.ts` with this shape:

```ts
import type { AgentRole } from "@lp-agent/mcp-gateway";
import type { RuntimeRunContext } from "@lp-agent/runtime-adapters";
import type { getWorkbenchCopy } from "../lib/i18n";
import type { ProjectMCPState } from "../lib/workbench-store";

export const mcpManagementRoleOrder = [
  "planner",
  "builder",
  "reviewer",
  "deployer"
] as const satisfies readonly AgentRole[];

export type MCPManagementStatus =
  | "configured"
  | "disabled"
  | "invalid_definition"
  | "approval_required"
  | "no_visible_tools"
  | "execution_not_available";

export interface MCPManagementSummary {
  connectorCount: number;
  enabledConnectorCount: number;
  visibleToolCount: number;
  executionEligibleToolCount: number;
}

export interface MCPManagementToolRow {
  connectorId: string;
  name: string;
  description?: string;
  permission: string;
  roleLabels: string[];
  requiresApproval: boolean;
  approvalState: "not_required" | "pending" | "approved";
  readOnlyEligible: boolean;
  executionAvailable: boolean;
  status: MCPManagementStatus;
}

export interface MCPManagementConnectorRow {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  toolCount: number;
  updatedAt?: string;
  status: MCPManagementStatus;
  statusLabel: string;
  tools: MCPManagementToolRow[];
}

export interface MCPManagementVisibleToolGroup {
  role: AgentRole;
  label: string;
  tools: Array<RuntimeRunContext["mcpTools"][number] & {
    executionAvailable: boolean;
    status: MCPManagementStatus;
  }>;
}

export interface MCPManagementViewModel {
  summary: MCPManagementSummary;
  connectors: MCPManagementConnectorRow[];
  visibleToolGroups: MCPManagementVisibleToolGroup[];
}

export function buildMCPManagementViewModel(input: {
  copy: ReturnType<typeof getWorkbenchCopy>;
  mcpState: ProjectMCPState;
}): MCPManagementViewModel {
  const approvals = new Map(
    input.mcpState.approvals.map((approval) => [
      `${approval.connectorId}:${approval.toolName}`,
      approval.state
    ])
  );
  const visibleToolKeys = new Set(
    mcpManagementRoleOrder.flatMap((role) =>
      (input.mcpState.visibleToolsByRole[role] ?? []).map(
        (tool) => `${role}:${tool.connectorId}:${tool.name}`
      )
    )
  );

  const connectors = input.mcpState.connectors.map((connector, index) => {
    const safe = toSafeConnector(connector, index, input.copy.mcpView.invalidConnectorName);
    const tools = safe.tools.map((tool) => {
      const approvalState = tool.requiresApproval
        ? approvals.get(`${safe.id}:${tool.name}`) ?? "pending"
        : "not_required";
      const visibleForAnyRole = mcpManagementRoleOrder.some((role) =>
        visibleToolKeys.has(`${role}:${safe.id}:${tool.name}`)
      );
      const readOnlyEligible = isReadOnlyVisibleMCPTool(tool);
      return {
        connectorId: safe.id,
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        permission: tool.permission,
        roleLabels: tool.roles.map((role) => input.copy.mcpView.roleLabels[role]),
        requiresApproval: tool.requiresApproval,
        approvalState,
        readOnlyEligible,
        executionAvailable: safe.enabled && visibleForAnyRole && readOnlyEligible,
        status: toToolStatus({
          enabled: safe.enabled,
          visibleForAnyRole,
          readOnlyEligible,
          approvalState
        })
      } satisfies MCPManagementToolRow;
    });
    const status = safe.valid
      ? safe.enabled
        ? tools.some((tool) => tool.executionAvailable)
          ? "configured"
          : tools.length > 0
            ? "execution_not_available"
            : "no_visible_tools"
        : "disabled"
      : "invalid_definition";
    return {
      id: safe.id,
      name: safe.name,
      ...(safe.description ? { description: safe.description } : {}),
      enabled: safe.enabled,
      toolCount: tools.length,
      ...(safe.updatedAt ? { updatedAt: safe.updatedAt } : {}),
      status,
      statusLabel: input.copy.mcpView.management.statusLabels[status],
      tools
    } satisfies MCPManagementConnectorRow;
  });

  const visibleToolGroups = mcpManagementRoleOrder.map((role) => ({
    role,
    label: input.copy.mcpView.roleLabels[role],
    tools: (input.mcpState.visibleToolsByRole[role] ?? []).map((tool) => {
      const executionAvailable = isReadOnlyVisibleMCPTool(tool);
      return {
        ...tool,
        executionAvailable,
        status: executionAvailable ? "configured" : "execution_not_available"
      };
    })
  }));

  return {
    summary: {
      connectorCount: connectors.length,
      enabledConnectorCount: connectors.filter((connector) => connector.enabled).length,
      visibleToolCount: visibleToolGroups.reduce(
        (count, group) => count + group.tools.length,
        0
      ),
      executionEligibleToolCount: visibleToolGroups.reduce(
        (count, group) =>
          count + group.tools.filter((tool) => tool.executionAvailable).length,
        0
      )
    },
    connectors,
    visibleToolGroups
  };
}

export function isReadOnlyVisibleMCPTool(tool: {
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
  if (tool.readOnly === false || tool.sideEffect === "write") {
    return false;
  }
  if (tool.readOnly === true || tool.sideEffect === "read") {
    return true;
  }
  return permission.endsWith(":read");
}
```

Then add local helpers in the same file:

```ts
function toToolStatus(input: {
  enabled: boolean;
  visibleForAnyRole: boolean;
  readOnlyEligible: boolean;
  approvalState: "not_required" | "pending" | "approved";
}): MCPManagementStatus {
  if (!input.enabled) {
    return "disabled";
  }
  if (input.approvalState === "pending") {
    return "approval_required";
  }
  if (!input.visibleForAnyRole) {
    return "no_visible_tools";
  }
  return input.readOnlyEligible ? "configured" : "execution_not_available";
}

function toSafeConnector(
  connector: unknown,
  index: number,
  fallbackName: string
): {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  updatedAt?: string;
  tools: Array<{
    name: string;
    description?: string;
    permission: string;
    roles: AgentRole[];
    requiresApproval: boolean;
    readOnly?: boolean;
    sideEffect?: "read" | "write";
  }>;
  valid: boolean;
} {
  const source = isRecord(connector) ? connector : {};
  const id = normalizeDisplayString(source.id) || `connector_invalid_${index + 1}`;
  const name = normalizeDisplayString(source.name) || fallbackName;
  const tools = Array.isArray(source.tools)
    ? source.tools.flatMap(toSafeTool)
    : [];
  return {
    id,
    name,
    ...(normalizeDisplayString(source.description)
      ? { description: normalizeDisplayString(source.description) }
      : {}),
    enabled: source.enabled === true,
    ...(normalizeDisplayString(source.updatedAt)
      ? { updatedAt: normalizeDisplayString(source.updatedAt) }
      : {}),
    tools,
    valid: Boolean(normalizeDisplayString(source.name)) && Array.isArray(source.tools)
  };
}

function toSafeTool(tool: unknown): Array<{
  name: string;
  description?: string;
  permission: string;
  roles: AgentRole[];
  requiresApproval: boolean;
  readOnly?: boolean;
  sideEffect?: "read" | "write";
}> {
  if (!isRecord(tool)) {
    return [];
  }
  const name = normalizeDisplayString(tool.name);
  const permission = normalizeDisplayString(tool.permission);
  const roles = Array.isArray(tool.roles)
    ? tool.roles.filter(isAgentRole)
    : [];
  if (!name || !permission || roles.length === 0 || typeof tool.requiresApproval !== "boolean") {
    return [];
  }
  return [
    {
      name,
      ...(normalizeDisplayString(tool.description)
        ? { description: normalizeDisplayString(tool.description) }
        : {}),
      permission,
      roles,
      requiresApproval: tool.requiresApproval,
      ...(typeof tool.readOnly === "boolean" ? { readOnly: tool.readOnly } : {}),
      ...(tool.sideEffect === "read" || tool.sideEffect === "write"
        ? { sideEffect: tool.sideEffect }
        : {})
    }
  ];
}

function isAgentRole(value: unknown): value is AgentRole {
  return (
    value === "planner" ||
    value === "builder" ||
    value === "reviewer" ||
    value === "deployer"
  );
}

function normalizeDisplayString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Run focused test and type check this slice**

Run:

```bash
pnpm vitest run apps/web/src/app/mcp-management-view-model.test.ts
pnpm typecheck
```

Expected: focused tests pass; typecheck passes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/mcp-management-view-model.ts apps/web/src/app/mcp-management-view-model.test.ts
git commit -m "add mcp management view model"
```

## Task 2: Server Action Boundary and MCP Page Wiring

**Files:**
- Modify: `apps/web/src/app/actions.ts`
- Modify: `apps/web/src/app/actions.test.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`

- [ ] **Step 1: Write failing action tests for no raw browser arguments**

In `apps/web/src/app/actions.test.ts`, replace the action expectation that forwards `"{\"query\":\"SECRET_PRODUCT\"}"` with:

```ts
expect(mocks.executeMCPTool).toHaveBeenCalledWith({
  projectId: "project_2",
  connectorId: "connector_assets",
  toolName: "searchAssets",
  role: "planner",
  argumentsJson: "{}"
});
```

Keep a hostile `formData.set("argumentsJson", "{\"query\":\"SECRET_PRODUCT\"}")` in the test so the assertion proves the server action ignores browser-provided raw arguments. Remove the action-level invalid JSON redirect test because invalid argument JSON can no longer be submitted through this Web action. Keep `apps/web/src/lib/workbench-store.test.ts` invalid argument coverage unchanged.

- [ ] **Step 2: Write failing page tests for MCP navigation and safe view**

Replace the Stage 41 hidden tests in `apps/web/src/app/page.test.ts` with tests like:

```ts
it("renders MCP navigation as a post-V1 management view", async () => {
  const page = await HomePage({
    searchParams: Promise.resolve({})
  });
  const links = collectElements(page, "a");
  const linkLabels = links.map((link) => collectText(link.props?.children).join(""));

  expect(linkLabels).toContain("Workbench");
  expect(linkLabels).toContain("Artifacts");
  expect(linkLabels).toContain("Skills");
  expect(linkLabels).toContain("Models");
  expect(linkLabels).toContain("MCP");
  expect(links.some((link) => link.props?.href === "/?view=mcp")).toBe(true);
});

it("renders the MCP management view without raw argument controls", async () => {
  setActiveEmptyProjectState({
    mcp: {
      connectors: [
        {
          id: "connector_assets",
          projectId: "project_1",
          scope: "project",
          name: "Assets",
          description: "Approved asset search.",
          enabled: true,
          tools: [
            {
              name: "searchAssets",
              permission: "assets:read",
              roles: ["planner"],
              requiresApproval: false,
              readOnly: true,
              sideEffect: "read"
            }
          ],
          createdAt: "2026-05-25T00:00:00.000Z",
          updatedAt: "2026-05-25T00:00:00.000Z"
        }
      ],
      approvals: [],
      visibleToolsByRole: {
        assistant: [],
        planner: [
          {
            connectorId: "connector_assets",
            name: "searchAssets",
            permission: "assets:read",
            requiresApproval: false,
            readOnly: true,
            sideEffect: "read"
          }
        ],
        builder: [],
        reviewer: [],
        deployer: []
      }
    }
  });

  const page = await HomePage({
    searchParams: Promise.resolve({
      view: "mcp",
      debug: "MCP_BROWSER_SECRET",
      toolArguments: "MCP_TOOL_SECRET"
    })
  });
  const text = collectText(page).join(" ");
  const textareas = collectElements(page, "textarea");
  const inputs = collectElements(page, "input");

  expect(text).toContain("Project MCP");
  expect(text).toContain("Assets");
  expect(text).toContain("searchAssets");
  expect(text).toContain("Run read-only check");
  expect(text).not.toContain("MCP_BROWSER_SECRET");
  expect(text).not.toContain("MCP_TOOL_SECRET");
  expect(textareas.some((textarea) => textarea.props?.name === "argumentsJson")).toBe(false);
  expect(
    inputs.some(
      (input) => input.props?.type === "hidden" && input.props?.name === "argumentsJson"
    )
  ).toBe(true);
});
```

If the helper `setActiveEmptyProjectState` does not accept partial override input yet, add that helper support in the test file only:

```ts
function setActiveEmptyProjectState(
  overrides: Partial<WorkbenchPageState> = {}
) {
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
    ...overrides
  };
}
```

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```bash
pnpm vitest run apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts
```

Expected: failing assertions because MCP navigation/view is still hidden and action still forwards raw `argumentsJson`.

- [ ] **Step 4: Change `executeMCPToolAction` to ignore browser raw arguments**

In `apps/web/src/app/actions.ts`, change only the `argumentsJson` assignment:

```ts
  const result = await store.executeMCPTool({
    projectId,
    connectorId: String(formData.get("connectorId") ?? ""),
    toolName: String(formData.get("toolName") ?? ""),
    role: String(formData.get("role") ?? ""),
    argumentsJson: "{}"
  });
```

- [ ] **Step 5: Wire `view=mcp` and render a management view**

In `apps/web/src/app/page.tsx`:

1. Import MCP actions and types:

```ts
  createMCPConnectorAction,
  executeMCPToolAction,
  setMCPConnectorEnabledAction,
  setMCPToolApprovalAction,
```

```ts
  type MCPFlowErrorCode,
  type ProjectMCPState,
```

2. Import the new view-model:

```ts
import {
  buildMCPManagementViewModel,
  mcpManagementRoleOrder
} from "./mcp-management-view-model";
```

3. Update `activeView` to include `mcp`:

```ts
  const activeView =
    view === "artifacts"
      ? "artifacts"
      : view === "skills"
        ? "skills"
        : view === "models"
          ? "models"
          : view === "mcp"
            ? "mcp"
            : "workbench";
```

4. Parse MCP errors and build management state:

```ts
  const mcpError = toMCPFlowError(getFirstSearchParam(params?.mcpError));
  const mcpState = getPageMCPState(pageState);
  const mcpErrorMessage = mcpError ? copy.mcpView.errors[mcpError] : undefined;
  const mcpManagement = buildMCPManagementViewModel({ copy, mcpState });
```

5. Add the MCP nav link after Models:

```tsx
          <a
            aria-current={activeView === "mcp" ? "page" : undefined}
            className={activeView === "mcp" ? "navItem navItemActive" : "navItem"}
            href="/?view=mcp"
          >
            {copy.nav.mcp}
          </a>
```

6. Include MCP in the workspace aria label:

```ts
            : activeView === "mcp"
              ? copy.nav.mcp
```

7. In the non-workbench branch, render a `MCPManagementView` function:

```tsx
              {activeView === "mcp"
                ? MCPManagementView({
                    activeProject,
                    copy,
                    errorMessage: mcpErrorMessage,
                    management: mcpManagement
                  })
                : null}
```

8. Add `getPageMCPState` near `getPageModelState`:

```ts
function getPageMCPState(pageState: { mcp?: ProjectMCPState }): ProjectMCPState {
  return pageState.mcp ?? {
    connectors: [],
    approvals: [],
    visibleToolsByRole: {
      assistant: [],
      planner: [],
      builder: [],
      reviewer: [],
      deployer: []
    }
  };
}
```

9. Add `toMCPFlowError` with all current store codes:

```ts
function toMCPFlowError(value: string | undefined): MCPFlowErrorCode | undefined {
  if (
    value === "project_not_found" ||
    value === "mcp_connector_json_invalid" ||
    value === "mcp_connector_validation_failed" ||
    value === "mcp_connector_scope_unsupported" ||
    value === "mcp_connector_already_exists" ||
    value === "mcp_connector_not_found" ||
    value === "mcp_tool_not_found" ||
    value === "mcp_tool_approval_not_required" ||
    value === "mcp_tool_not_visible" ||
    value === "mcp_tool_execution_not_read_only" ||
    value === "mcp_tool_execution_approval_required" ||
    value === "mcp_tool_execution_rejected" ||
    value === "mcp_tool_execution_failed" ||
    value === "mcp_tool_arguments_invalid" ||
    value === "mcp_executor_not_configured" ||
    value === "mcp_operation_failed"
  ) {
    return value;
  }
  return undefined;
}
```

10. Add a server-component helper below `RecoveryBlock` or near other view helpers. It must not render a raw arguments textarea:

```tsx
function MCPManagementView({
  activeProject,
  copy,
  errorMessage,
  management
}: {
  activeProject: WorkbenchPageState["projects"][number] | undefined;
  copy: ReturnType<typeof getWorkbenchCopy>;
  errorMessage?: string;
  management: ReturnType<typeof buildMCPManagementViewModel>;
}) {
  return (
    <section className="mcpView" aria-labelledby="mcp-title">
      <header className="mcpHeader">
        <div>
          <h1 id="mcp-title">{copy.mcpView.title}</h1>
          <p>{copy.mcpView.subtitle}</p>
          <p className="alphaBoundaryNote">{copy.mcpView.management.safeProjectionNotice}</p>
        </div>
        <span>{copy.mcpView.management.summary(management.summary)}</span>
      </header>

      {errorMessage ? <div className="formError" role="alert">{errorMessage}</div> : null}

      <section className="managementSummary" aria-labelledby="mcp-summary-title">
        <div>
          <h2 id="mcp-summary-title">{copy.mcpView.management.runtimeSummaryTitle}</h2>
          <p>{copy.mcpView.management.runtimeSummary(management.summary)}</p>
        </div>
        <ul>
          {copy.mcpView.management.policyItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <div className="mcpProjectContext">
        <span>{copy.mcpView.activeProjectLabel}</span>
        <strong>{activeProject?.name ?? copy.mcpView.noProject}</strong>
      </div>

      {activeProject ? (
        <>
          <form action={createMCPConnectorAction} className="mcpEditor">
            <input name="projectId" type="hidden" value={activeProject.id} />
            <h2>{copy.mcpView.createTitle}</h2>
            <label htmlFor="definitionJson">{copy.mcpView.definitionLabel}</label>
            <textarea
              id="definitionJson"
              name="definitionJson"
              placeholder={copy.mcpView.definitionPlaceholder}
            />
            <p className="formHint">{copy.mcpView.management.connectorDefinitionHint}</p>
            <ManagementSubmitButton pendingLabel={copy.mcpView.management.pending.create}>
              {copy.mcpView.createConnector}
            </ManagementSubmitButton>
          </form>

          <section className="mcpList" aria-labelledby="mcp-connectors-title">
            <h2 id="mcp-connectors-title">{copy.mcpView.connectorsTitle}</h2>
            {management.connectors.length > 0 ? (
              management.connectors.map((connector) => (
                <div className="mcpConnectorRow" key={connector.id}>
                  <div>
                    <strong>{connector.name}</strong>
                    {connector.description ? <p>{connector.description}</p> : null}
                    <span>
                      {connector.enabled ? copy.mcpView.enabled : copy.mcpView.disabled}
                      {" · "}
                      {connector.statusLabel}
                      {" · "}
                      {copy.mcpView.management.toolCount(connector.toolCount)}
                    </span>
                  </div>
                  <form action={setMCPConnectorEnabledAction}>
                    <input name="projectId" type="hidden" value={activeProject.id} />
                    <input name="connectorId" type="hidden" value={connector.id} />
                    <input
                      name="enabled"
                      type="hidden"
                      value={connector.enabled ? "false" : "true"}
                    />
                    <ManagementSubmitButton
                      pendingLabel={
                        connector.enabled
                          ? copy.mcpView.management.pending.disable
                          : copy.mcpView.management.pending.enable
                      }
                    >
                      {connector.enabled ? copy.mcpView.disable : copy.mcpView.enable}
                    </ManagementSubmitButton>
                  </form>
                  <div className="mcpToolGrid" aria-label={copy.mcpView.toolsTitle}>
                    {connector.tools.map((tool) => (
                      <div className="mcpToolCard" key={`${connector.id}:${tool.name}`}>
                        <strong>{tool.name}</strong>
                        {tool.description ? <p>{tool.description}</p> : null}
                        <span>{copy.mcpView.permissionSummary(tool.permission)}</span>
                        <span>{copy.mcpView.rolesSummary(tool.roleLabels)}</span>
                        <span>
                          {tool.requiresApproval
                            ? copy.mcpView.approvalRequired
                            : copy.mcpView.approvalNotRequired}
                          {" · "}
                          {copy.mcpView.management.approvalStates[tool.approvalState]}
                        </span>
                        <small>{copy.mcpView.management.statusLabels[tool.status]}</small>
                        {tool.requiresApproval ? (
                          <form action={setMCPToolApprovalAction}>
                            <input name="projectId" type="hidden" value={activeProject.id} />
                            <input name="connectorId" type="hidden" value={connector.id} />
                            <input name="toolName" type="hidden" value={tool.name} />
                            <input
                              name="approved"
                              type="hidden"
                              value={tool.approvalState === "approved" ? "false" : "true"}
                            />
                            <ManagementSubmitButton
                              pendingLabel={copy.mcpView.management.pending.approval}
                            >
                              {tool.approvalState === "approved"
                                ? copy.mcpView.revoke
                                : copy.mcpView.approve}
                            </ManagementSubmitButton>
                          </form>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <p>{copy.mcpView.emptyConnectors}</p>
            )}
          </section>

          <section className="mcpList" aria-labelledby="mcp-visible-tools-title">
            <h2 id="mcp-visible-tools-title">{copy.mcpView.visibleToolsTitle}</h2>
            {management.visibleToolGroups.map((group) => (
              <div className="mcpVisibleRole" key={group.role}>
                <strong>{group.label}</strong>
                {group.tools.length > 0 ? (
                  group.tools.map((tool) => (
                    <div className="mcpToolCard" key={`${group.role}:${tool.connectorId}:${tool.name}`}>
                      <strong>{tool.name}</strong>
                      <span>{tool.connectorId}</span>
                      <span>{copy.mcpView.permissionSummary(tool.permission)}</span>
                      {tool.executionAvailable ? (
                        <form action={executeMCPToolAction} className="mcpExecutionForm">
                          <input name="projectId" type="hidden" value={activeProject.id} />
                          <input name="connectorId" type="hidden" value={tool.connectorId} />
                          <input name="toolName" type="hidden" value={tool.name} />
                          <input name="role" type="hidden" value={group.role} />
                          <input name="argumentsJson" type="hidden" value="{}" />
                          <ManagementSubmitButton
                            pendingLabel={copy.mcpView.management.pending.execute}
                          >
                            {copy.mcpView.executeReadOnly}
                          </ManagementSubmitButton>
                        </form>
                      ) : (
                        <small>{copy.mcpView.writeToolUnavailable}</small>
                      )}
                    </div>
                  ))
                ) : (
                  <span>{copy.mcpView.emptyVisibleTools}</span>
                )}
              </div>
            ))}
          </section>
        </>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm vitest run apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts apps/web/src/app/mcp-management-view-model.test.ts
```

Expected: tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/actions.ts apps/web/src/app/actions.test.ts apps/web/src/app/page.tsx apps/web/src/app/page.test.ts apps/web/src/app/mcp-management-view-model.ts apps/web/src/app/mcp-management-view-model.test.ts
git commit -m "render mcp management surface"
```

## Task 3: MCP Copy and Styling Polish

**Files:**
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Write failing i18n tests**

Add assertions in `apps/web/src/lib/i18n.test.ts`:

```ts
expect(en.mcpView.management.statusLabels.configured).toBe("Configured");
expect(en.mcpView.management.statusLabels.invalid_definition).toBe("Invalid definition");
expect(en.mcpView.management.approvalStates.pending).toBe("Pending approval");
expect(en.mcpView.management.pending.execute).toBe("Running check...");
expect(zh.mcpView.management.statusLabels.execution_not_available).toBe("执行不可用");
expect(en.hero.actionChips.join(" ").toLowerCase()).not.toContain("mcp");
expect(zh.hero.actionChips.join(" ").toLowerCase()).not.toContain("mcp");
```

- [ ] **Step 2: Run focused i18n test and verify failure**

Run:

```bash
pnpm vitest run apps/web/src/lib/i18n.test.ts
```

Expected: fails because `mcpView.management` is missing.

- [ ] **Step 3: Add English and Chinese MCP management copy**

In each locale object under `mcpView`, add:

```ts
management: {
  runtimeSummaryTitle: "MCP runtime projection",
  safeProjectionNotice:
    "MCP management shows bounded connector and tool metadata. Raw outputs and raw arguments stay outside the Web surface.",
  connectorDefinitionHint:
    "Connector definitions should contain project-scoped metadata and tool policy only.",
  summary: (summary) =>
    `${summary.connectorCount} connectors · ${summary.visibleToolCount} visible tools · ${summary.executionEligibleToolCount} read-only checks`,
  runtimeSummary: (summary) =>
    `${summary.enabledConnectorCount} enabled connectors are evaluated against current project skills, role permissions, approvals, and read-only policy.`,
  toolCount: (count) => `${count} tools`,
  policyItems: [
    "Visible tools come from backend role, permission, approval, and connector state.",
    "Read-only checks submit no browser-provided raw argument JSON.",
    "Failures render stable diagnostics and fail closed."
  ],
  statusLabels: {
    configured: "Configured",
    disabled: "Disabled",
    invalid_definition: "Invalid definition",
    approval_required: "Approval required",
    no_visible_tools: "No visible tools",
    execution_not_available: "Execution unavailable"
  },
  approvalStates: {
    not_required: "No approval required",
    pending: "Pending approval",
    approved: "Approved"
  },
  pending: {
    create: "Saving connector...",
    enable: "Enabling...",
    disable: "Disabling...",
    approval: "Updating approval...",
    execute: "Running check..."
  }
}
```

Use equivalent Chinese copy:

```ts
management: {
  runtimeSummaryTitle: "MCP 运行时投影",
  safeProjectionNotice:
    "MCP 管理页只展示受限 connector 和 tool metadata；raw output 和 raw arguments 不进入 Web 页面。",
  connectorDefinitionHint:
    "Connector definition 只应包含 project-scoped metadata 和 tool policy。",
  summary: (summary) =>
    `${summary.connectorCount} 个连接器 · ${summary.visibleToolCount} 个可见工具 · ${summary.executionEligibleToolCount} 个只读检查`,
  runtimeSummary: (summary) =>
    `${summary.enabledConnectorCount} 个已启用连接器会按当前项目 Skills、角色权限、approval 和只读策略计算。`,
  toolCount: (count) => `${count} 个工具`,
  policyItems: [
    "可见工具由后端根据 role、permission、approval 和 connector state 计算。",
    "只读检查不会提交浏览器提供的 raw argument JSON。",
    "失败只显示稳定诊断，并保持 fail closed。"
  ],
  statusLabels: {
    configured: "已配置",
    disabled: "已停用",
    invalid_definition: "定义无效",
    approval_required: "需要审批",
    no_visible_tools: "无可见工具",
    execution_not_available: "执行不可用"
  },
  approvalStates: {
    not_required: "无需审批",
    pending: "待审批",
    approved: "已批准"
  },
  pending: {
    create: "保存连接器中...",
    enable: "启用中...",
    disable: "停用中...",
    approval: "更新审批中...",
    execute: "运行检查中..."
  }
}
```

Update existing `mcpView.subtitle` and `deferredNotice` so they no longer say MCP is deferred for this alpha. Keep first-viewport hero/action chips free of MCP.

- [ ] **Step 4: Polish CSS with existing management vocabulary**

Only add small CSS if the resurrected MCP view has layout gaps. Reuse existing `.mcpView`, `.mcpHeader`, `.mcpEditor`, `.mcpList`, `.mcpConnectorRow`, `.mcpToolGrid`, `.mcpToolCard`, `.mcpVisibleRole`, `.mcpExecutionForm`, `.managementSummary`, `.formHint`, `.alphaBoundaryNote`.

Allowed minimal additions:

```css
.mcpProjectContext {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.mcpExecutionForm {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
}
```

Do not introduce cards inside cards, one-note color palette changes, marketing hero treatment, gradient orbs, or viewport-scaled font sizes.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm vitest run apps/web/src/lib/i18n.test.ts apps/web/src/app/page.test.ts apps/web/src/app/mcp-management-view-model.test.ts
```

Expected: tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/i18n.ts apps/web/src/lib/i18n.test.ts apps/web/src/app/globals.css apps/web/src/app/page.test.ts apps/web/src/app/mcp-management-view-model.test.ts
git commit -m "polish mcp management copy"
```

## Task 4: Browser Acceptance for MCP Management Re-entry

**Files:**
- Modify: `apps/web/e2e/alpha-health.spec.ts`
- Modify: `apps/web/e2e/alpha-boundaries.spec.ts`
- Modify: `apps/web/e2e/helpers.ts`
- Create: `apps/web/e2e/alpha-mcp-management.spec.ts`

- [ ] **Step 1: Update existing browser expectations**

In `alpha-health.spec.ts`, change the MCP assertion from hidden to visible:

```ts
await expect(navigation.getByRole("link", { name: "MCP" })).toBeVisible();
```

In `alpha-boundaries.spec.ts`, keep secret query checks but assert `view=mcp` is now the MCP management view:

```ts
await page.goto(
  "/?view=mcp&debug=MCP_BROWSER_SECRET&connectorJson=MCP_CONNECTOR_SECRET&toolArguments=MCP_TOOL_SECRET"
);
await expect(page.getByRole("heading", { exact: true, name: "Project MCP" })).toBeVisible();
await expect(page.getByText("MCP_BROWSER_SECRET")).toHaveCount(0);
await expect(page.getByText("MCP_CONNECTOR_SECRET")).toHaveCount(0);
await expect(page.getByText("MCP_TOOL_SECRET")).toHaveCount(0);
```

- [ ] **Step 2: Add helper for MCP management surface**

In `apps/web/e2e/helpers.ts`, add:

```ts
export async function expectMCPManagementSurface(page: Page) {
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "MCP" })
    .click();
  await expect(page.getByRole("heading", { exact: true, name: "Project MCP" })).toBeVisible();
  await expect(page.getByText("MCP runtime projection", { exact: true })).toBeVisible();
}
```

If `Page` is not already imported in the helper file, import it from `@playwright/test` alongside `expect`.

- [ ] **Step 3: Create focused MCP browser test**

Create `apps/web/e2e/alpha-mcp-management.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import {
  createProject,
  expectMCPManagementSurface,
  expectNoVisibleTextLeaks
} from "./helpers";

test("manages project MCP connector metadata with safe read-only affordance", async ({ page }) => {
  await createProject(page, "Stage 54 MCP Project");

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Skills" }).click();
  await page.getByLabel("Manifest JSON").fill(
    JSON.stringify(
      {
        id: "skill_stage54_assets",
        name: "Stage 54 Asset Skill",
        version: "0.1.0",
        type: "template",
        scope: "project",
        description: "Safe asset metadata.",
        permissions: ["assets:read"],
        requiredSecrets: [],
        entrypoints: ["assets.md"],
        reviewState: "draft"
      },
      null,
      2
    )
  );
  await page.getByLabel("Skill content").fill("RAW_MCP_SKILL_SECRET");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByRole("button", { name: "Validate" }).click();
  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("button", { name: "Bind" }).click();

  await expectMCPManagementSurface(page);
  await page.getByLabel("Connector JSON").fill(
    JSON.stringify(
      {
        id: "connector_stage54_assets",
        name: "Stage 54 Assets",
        description: "Approved metadata lookup.",
        tools: [
          {
            name: "searchAssets",
            description: "Search safe asset metadata.",
            permission: "assets:read",
            roles: ["planner", "builder"],
            requiresApproval: false,
            readOnly: true,
            sideEffect: "read"
          },
          {
            name: "deployAsset",
            permission: "assets:write",
            roles: ["deployer"],
            requiresApproval: true,
            readOnly: false,
            sideEffect: "write"
          }
        ]
      },
      null,
      2
    )
  );
  await page.getByRole("button", { name: "Create connector" }).click();

  await expect(page.getByText("Stage 54 Assets", { exact: true })).toBeVisible();
  await expect(page.getByText("searchAssets", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("deployAsset", { exact: true })).toBeVisible();
  await expect(page.getByText("Configured", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Run read-only check" })).toBeVisible();
  await expect(page.getByLabel("Tool arguments")).toHaveCount(0);

  await page.getByRole("button", { name: "Run read-only check" }).click();
  await expect(page.getByRole("heading", { exact: true, name: "Project MCP" })).toBeVisible();
  await expectNoVisibleTextLeaks(page, [
    "RAW_MCP_SKILL_SECRET",
    "SECRET_PRODUCT",
    "MCP_TOOL_SECRET",
    "/Users/ao/"
  ]);
});
```

- [ ] **Step 4: Run browser tests**

Run:

```bash
pnpm alpha:e2e
```

Expected: all Playwright tests pass. If Chromium is missing, run `pnpm alpha:e2e:install` and then rerun `pnpm alpha:e2e`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/alpha-health.spec.ts apps/web/e2e/alpha-boundaries.spec.ts apps/web/e2e/helpers.ts apps/web/e2e/alpha-mcp-management.spec.ts
git commit -m "cover mcp management browser acceptance"
```

## Task 5: Documentation Closeout for Post-V1 MCP Re-entry

**Files:**
- Modify: `docs/web-v1-acceptance.md`
- Modify: `docs/alpha-release-candidate.md`
- Modify: `docs/project-roadmap.md`
- Modify: `docs/superpowers/README.md`
- Modify: `docs/agent-development-learning.md`
- Optional create: `docs/mcp-management-surface-v0-implementation.md` if a concise completion ledger is useful after verification.

- [ ] **Step 1: Update acceptance docs away from hidden MCP**

In `docs/web-v1-acceptance.md`:

- Keep the V1 historical context, but add a note near the top:

```md
Post-V1 update: Stage 54 reintroduces a single `MCP` management view for safe connector / tool metadata and read-only checks. This does not change the V1 alpha requirement that ordinary chat, LP tasks, Artifacts, Skills, and Models must work without MCP configuration.
```

- Replace browser E2E checklist item:

```md
- [ ] 自动验收覆盖 MCP management navigation re-entry、connector metadata、safe read-only affordance 和 legacy query non-leakage。
```

- Replace the "Models 和 MCP 边界" MCP bullets with:

```md
- [ ] 点击 sidebar 中的 `MCP`，确认 post-V1 management view 能打开。
- [ ] 不配置 MCP connector 的情况下，普通聊天和 LP 任务仍可完成。
- [ ] 创建 connector 后，页面只展示 connector/tool/permission/approval/read-only metadata，不展示 raw MCP output、raw arguments、secret、本机路径或 malformed raw JSON。
- [ ] 对 visible read-only tool，页面提供 `Run read-only check`；该 affordance 不显示 raw argument textarea。
- [ ] 当前仍不要求真实 MCP server、remote MCP SDK、write tools、MCP worker execution、真实 shell execution 或真实部署。
```

In `docs/alpha-release-candidate.md`, update RC known limitations and manual script language from "MCP hidden" to "post-V1 MCP management view is metadata/read-only only".

- [ ] **Step 2: Update Superpowers README**

Append entry 127:

```md
127. `plans/2026-05-25-mcp-management-surface-v0-implementation.md`
   - Stage 54 MCP Management Surface v0 implementation plan（当前执行依据）。
   - 在 Stage 51 design / docs-only closeout 后阅读，用于按 TDD 实现 post-V1 单一 Web MCP management view、safe view-model、navigation re-entry、server action raw-argument boundary、browser acceptance 和 docs closeout；本阶段不接 remote MCP SDK/server adapter、不做 write tools、MCP worker execution、secret storage、auth/RBAC、deployment/provider/browser platform，也不创建 raw MCP output / raw arguments 通道。
```

- [ ] **Step 3: Update roadmap**

Update `docs/project-roadmap.md`:

- Current snapshot: Stage 54 plan written and execution started.
- Recommended queue: Stage 54 remains in progress until implementation is merged and verified.
- Decision record:

```md
- 2026-05-25 Stage 54 MCP Management Surface v0 implementation plan 已写入：`docs/superpowers/plans/2026-05-25-mcp-management-surface-v0-implementation.md` 将 Stage 51 design 拆成 safe view-model、Web navigation/page wiring、server action raw-argument boundary、browser acceptance 和 docs closeout；执行方式为独立 worktree + subagent-driven development。Stage 54 此时未完成，Stage 48 conditional、Stage 50 optional、Stage 52 / Stage 53 discovery 保留。
```

- [ ] **Step 4: Update Agent learning note**

In `docs/agent-development-learning.md`, update the Stage 51 MCP paragraph with one Stage 54 implementation note:

```md
Stage 54 implementation 进一步把这个边界落实到 Web：MCP management view 可以展示 connector/tool/approval/read-only metadata，但 browser action 不接收 raw argument JSON，只提交后端可审计的空 argument object 给既有 read-only execution use case。这样 UI affordance 和 API execution 都仍围绕同一个 `ToolObservationRecord` 安全摘要闭环，而不是开一条把 raw tool payload 带进页面的捷径。
```

- [ ] **Step 5: Run docs checks**

Run:

```bash
rg -n "MCP hidden|MCP management 仍隐藏|sidebar / top-level navigation 不展示 `MCP`|legacy `/?view=mcp` safe fallback|MCP hidden navigation" docs/web-v1-acceptance.md docs/alpha-release-candidate.md docs/project-roadmap.md docs/superpowers/README.md docs/agent-development-learning.md
git diff --check
```

Expected: any remaining "hidden" references are explicitly historical or scoped to completed Stage 41/45 docs, not current acceptance; `git diff --check` passes.

- [ ] **Step 6: Commit**

```bash
git add docs/web-v1-acceptance.md docs/alpha-release-candidate.md docs/project-roadmap.md docs/superpowers/README.md docs/agent-development-learning.md docs/superpowers/plans/2026-05-25-mcp-management-surface-v0-implementation.md
git commit -m "document mcp management implementation plan"
```

## Task 6: Full Verification, Review, and Merge Prep

**Files:**
- No planned source edits unless verification exposes a concrete bug.

- [ ] **Step 1: Run deterministic unit gates**

Run:

```bash
pnpm alpha:check
pnpm smoke
pnpm test
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 2: Run browser acceptance**

Run:

```bash
pnpm alpha:e2e
```

Expected: all Playwright tests pass without real provider, MCP server, Postgres, deployment provider, network service, or production credentials.

- [ ] **Step 3: Run build and diff hygiene**

Run:

```bash
pnpm build
git diff --check
git status --short
```

Expected: build passes; diff has no whitespace errors; worktree contains only intended Stage 54 files before final commit/merge.

- [ ] **Step 4: Final code review**

Dispatch a final review subagent with these requirements:

- Verify Stage 51 allowlist / denylist is respected.
- Verify no raw MCP output, raw argument JSON, secret, full artifact, local path, stack trace, raw stderr/stdout, or malformed connector raw JSON is rendered.
- Verify action boundary ignores hostile `argumentsJson`.
- Verify MCP browser tests no longer assert Stage 41 hidden behavior except in historical docs.
- Verify no runtime expansion occurred in MCP SDK, worker execution, write tools, auth/RBAC, deployment, provider, browser platform, or secret storage.

- [ ] **Step 5: Closeout commit if needed**

If verification fixes or completion ledger edits are needed:

```bash
git add <changed-files>
git commit -m "complete mcp management surface implementation"
```

## Final Stage Completion Requirements

Before reporting Stage 54 complete:

- Implementation branch has been merged back to `main`, or final response explicitly says it has not been merged.
- `docs/project-roadmap.md` shows Stage 54 completed and keeps 3-5 recommended next stages.
- `docs/superpowers/README.md` includes the Stage 54 implementation plan.
- `docs/agent-development-learning.md` records the MCP management safety boundary.
- `docs/web-v1-acceptance.md` and `docs/alpha-release-candidate.md` no longer describe MCP as currently hidden.
- Validation commands and outcomes are listed in the final response.
- No `apps/web` UI path renders raw MCP output, raw arguments, secret-looking values, full artifact content, local absolute paths, or unredacted exceptions.

## Plan Self-review

- Spec coverage: Stage 51 navigation re-entry, project-scoped connector metadata, visible tools, approval summary, deterministic/local health, safe read-only affordance, failure diagnostics, non-leakage and docs gates all map to Tasks 1-6.
- Placeholder scan passed: each code task has exact files, commands and expected behavior.
- Type consistency: the view-model uses `ProjectMCPState`, `RuntimeRunContext["mcpTools"]`, `AgentRole`, `MCPManagementStatus`, and existing i18n `copy.mcpView` fields consistently across Tasks 1-3.
