# Project MCP Connector Registry Spec

## Purpose

Add the first project-level MCP connector registry slice to the Web workbench.

Users should be able to register connector definitions for a project, define tool metadata and permissions, enable or disable connectors, approve tools that require approval, and have the agent runtime load only the visible tools for the active project and role.

This slice is registry-first. It does not execute MCP tools, shell commands, Git writes, deployment commands, or remote API calls. It prepares the product for future MCP-backed and command-backed skills while keeping the current Web V1 safe and deterministic.

## Current Baseline

The repository already has these foundations:

- `packages/mcp-gateway` defines `AgentRole`, `ApprovalState`, `MCPConnectorDefinition`, `MCPToolDefinition`, `sampleConnector`, and `computeVisibleTools()`.
- `packages/runtime-adapters` carries `RuntimeMCPToolContext[]` through runtime context into model calls.
- `packages/model-gateway` audits `mcpTools` inside `ModelRequestContext`.
- `packages/api` currently builds runtime MCP visibility from a hardcoded `sampleConnector`.
- `packages/db` already has repository patterns for in-memory and JSON-file local state.
- `apps/web` already has a Manus-style shell and a sidebar MCP nav label, but the MCP item is not yet a real view.

The missing product slice is repository-backed MCP connector registration, project-scoped approval state, runtime resolution, and a Web MCP management view.

## Goals

- Support project-level MCP connector registration first.
- Let users create connector definitions from JSON text in the Web UI.
- Let users enable or disable a project connector.
- Let users approve or revoke approval for tools that require approval.
- Compute role-specific visible tools from:
  - enabled project connectors,
  - project-bound published skill permissions,
  - active agent role,
  - project tool approval state.
- Replace the hardcoded runtime `sampleConnector` path in `packages/api`.
- Show MCP state in the Web workbench with Chinese and English copy.
- Keep future compatibility with workspace, organization, and global connector scopes.

## Non-Goals

- No real MCP SDK integration.
- No shell command execution.
- No deployment execution.
- No Git writes or pull request creation.
- No arbitrary code execution from skills or connector definitions.
- No secrets storage.
- No organization/workspace/global connector UI in this slice.
- No realtime collaboration or per-user approval UI.

## Scope Decisions

### Connector Scope

The Web V1 exposes only project-level connector registration.

Records should still preserve `scope` and `targetKey` so broader scopes can be added later without replacing repository contracts.

For this slice:

- UI-created connectors must use `scope: "project"`.
- `targetKey` must equal the current `projectId`.
- The connector record owns its project binding. There is no separate connector-binding table in this slice.

### Connector Definition Format

The first UI accepts connector JSON text.

Recommended JSON shape:

```json
{
  "id": "connector_assets",
  "name": "Internal Assets",
  "description": "Read-only asset search tools for LP generation.",
  "tools": [
    {
      "name": "searchAssets",
      "description": "Search approved brand and product assets.",
      "permission": "assets:read",
      "roles": ["planner", "builder", "reviewer"],
      "requiresApproval": false
    }
  ]
}
```

The Web action adds project scope fields server-side. If JSON contains `scope` or `targetKey`, those fields are ignored for persistence in this slice and must not allow a connector to escape the current project.

### Tool Visibility

A tool is visible to a runtime role only when all conditions are true:

1. Its connector is enabled.
2. The connector belongs to the active project.
3. The tool allows the active role.
4. At least one enabled published project-bound skill grants the tool permission.
5. If the tool requires approval, a project approval record for that connector/tool is `approved`.

When no project skills are bound, no MCP tools are visible. This is deliberate: skills define why a tool is allowed to enter runtime context.

### Approval State

Approval is project-local and tool-specific.

Recommended approval record:

```ts
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

For Web V1, the current user can be represented as a fixed local owner id such as `local-owner`.

Approval records do not execute tools. They only make approved tool metadata visible to runtime context.

### Runtime Integration

`DemoWorkbenchService.createRuntimeContext()` should load:

- runtime skills for the project,
- visible MCP tools for the current role,
- resolved model routing policy.

Runtime context should keep the current `RuntimeMCPToolContext` shape:

```ts
{
  connectorId: string;
  name: string;
  permission: string;
  requiresApproval: boolean;
}
```

This slice should not add a tool executor interface. Execution belongs to a later runtime/tool-adapter stage.

## Repository Design

Extend `@lp-agent/db` repository contracts with MCP connector and approval repositories.

Recommended records:

```ts
export interface MCPConnectorRecord {
  id: string;
  scope: "global" | "organization" | "workspace" | "project";
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

Recommended repositories:

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

The in-memory and JSON-file adapters should both implement these contracts and return defensive copies.

## MCP Gateway Design

`packages/mcp-gateway` should stay pure and provider-neutral.

This slice should add helper functions rather than MCP clients:

- validate and normalize connector definitions,
- reject unsupported roles,
- reject empty ids, names, tool names, or permissions,
- reject duplicate tool names inside a connector,
- compute approval-aware visible tools.

`sampleConnector` can remain as a package-level test fixture, but runtime code must not inject it automatically.

## API Design

`packages/api` should own MCP use cases. Web actions should call API methods through the Web store, not repositories directly.

Recommended service methods:

- `createProjectMCPConnector(input)`
- `setProjectMCPConnectorEnabled(input)`
- `setProjectMCPToolApproval(input)`
- `listProjectMCPState(projectId)`
- `listVisibleMCPToolsForProject(input)`

Recommended error codes:

- `project_not_found`
- `mcp_connector_json_invalid`
- `mcp_connector_validation_failed`
- `mcp_connector_scope_unsupported`
- `mcp_connector_already_exists`
- `mcp_connector_not_found`
- `mcp_tool_not_found`
- `mcp_tool_approval_not_required`
- `mcp_operation_failed`

## Web UX Design

The MCP nav item opens a project MCP registry view in the main workspace, for example `?view=mcp`.

The MCP view should show:

- active project context,
- connector JSON creation form,
- connector list with enabled/disabled state,
- tool list per connector,
- role labels,
- required permission labels,
- approval required badges,
- approve and revoke actions for approval-required tools,
- visible tool summary for planner, builder, reviewer, and deployer,
- clear validation errors.

All visible copy must go through `apps/web/src/lib/i18n.ts` for `en` and `zh-CN`.

## Error Handling

Invalid connector JSON and validation failures should return stable error codes to server actions and render localized messages.

The runtime should fail closed for malformed persisted records. If a connector has invalid tool definitions, it should not enter visible tools. The UI should still render the connector state where possible so users can disable or replace it.

## Testing Requirements

Required tests:

- MCP gateway validation rejects invalid roles, duplicate tools, empty permissions, and invalid connector ids.
- MCP gateway visibility hides tools without matching skill permission.
- MCP gateway visibility hides approval-required tools until approved.
- DB in-memory repositories store MCP connectors and approvals with defensive copies.
- JSON-file repositories persist MCP connectors and approvals across repository instances.
- API creates, lists, enables/disables, approves/revokes, and computes visible tools.
- Runtime context uses repository-backed MCP tools instead of `sampleConnector`.
- Web store maps stable MCP errors.
- Server actions redirect to `?view=mcp` with stable error query params.
- Page tests verify MCP nav activation, project gating, localized copy, and visible tool summaries.

## Future Extensions

- Add workspace, organization, and global connector scope resolution.
- Add real MCP client adapters behind an execution boundary.
- Add command-backed deployment skills behind explicit approval.
- Add per-user approvals and team reviewer identity.
- Add runtime event timeline entries for proposed and executed tool calls.
- Add secret references for connectors without storing raw secret values.
