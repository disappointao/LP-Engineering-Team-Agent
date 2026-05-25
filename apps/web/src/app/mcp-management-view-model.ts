import type { AgentRole as MCPAgentRole } from "@lp-agent/mcp-gateway";
import type { WorkbenchCopy } from "../lib/i18n";
import type { ProjectMCPState } from "../lib/workbench-store";

export const mcpManagementRoleOrder = [
  "planner",
  "builder",
  "reviewer",
  "deployer"
] as const satisfies readonly MCPAgentRole[];

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
  role: MCPAgentRole;
  label: string;
  tools: Array<
    ProjectMCPVisibleTool & {
      executionAvailable: boolean;
      status: MCPManagementStatus;
    }
  >;
}

export interface MCPManagementViewModel {
  summary: MCPManagementSummary;
  connectors: MCPManagementConnectorRow[];
  visibleToolGroups: MCPManagementVisibleToolGroup[];
}

type ProjectMCPVisibleTool =
  ProjectMCPState["visibleToolsByRole"][keyof ProjectMCPState["visibleToolsByRole"]][number];

type MCPManagementInputState = Omit<ProjectMCPState, "visibleToolsByRole"> & {
  visibleToolsByRole: ProjectMCPState["visibleToolsByRole"] &
    Partial<Record<"assistant", ProjectMCPVisibleTool[]>>;
};

type SafeMCPConnector = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  updatedAt?: string;
  tools: SafeMCPTool[];
  valid: boolean;
};

type SafeMCPTool = {
  name: string;
  description?: string;
  permission: string;
  roles: MCPAgentRole[];
  requiresApproval: boolean;
  readOnly?: boolean;
  sideEffect?: "read" | "write";
};

type MCPApprovalState = Extract<MCPManagementToolRow["approvalState"], "pending" | "approved">;
type MCPVisibleToolIndex = Map<MCPAgentRole, Map<string, Set<string>>>;
type MCPVisibleToolExecutionIndex = Map<
  MCPAgentRole,
  Map<string, Map<string, Pick<MCPManagementToolRow, "executionAvailable" | "status">>>
>;

export function buildMCPManagementViewModel(input: {
  copy: WorkbenchCopy;
  mcpState: MCPManagementInputState;
}): MCPManagementViewModel {
  const approvalsByConnector = buildApprovalIndex(input.mcpState.approvals);
  const visibleToolIndex = createVisibleToolIndex();
  const visibleToolExecutionIndex = createVisibleToolExecutionIndex();
  const visibleToolsByRole = new Map<MCPAgentRole, ProjectMCPVisibleTool[]>();

  for (const role of mcpManagementRoleOrder) {
    const tools = (input.mcpState.visibleToolsByRole[role] ?? []).flatMap((tool) => {
      const safe = toSafeVisibleTool(tool);
      if (!safe) {
        return [];
      }

      addVisibleTool(visibleToolIndex, role, safe.connectorId, safe.name);

      return [
        {
          connectorId: safe.connectorId,
          name: safe.name,
          permission: safe.permission,
          requiresApproval: safe.requiresApproval,
          ...(typeof safe.readOnly === "boolean" ? { readOnly: safe.readOnly } : {}),
          ...(safe.sideEffect === "read" || safe.sideEffect === "write"
            ? { sideEffect: safe.sideEffect }
            : {})
        }
      ];
    });

    visibleToolsByRole.set(role, tools);
  }

  const connectors = input.mcpState.connectors.map((connector, index) => {
    const safe = toSafeConnector(connector, index, input.copy.mcpView.invalidConnectorName);
    const tools = safe.tools.map((tool) => {
      const approvalState = tool.requiresApproval
        ? getApprovalState(approvalsByConnector, safe.id, tool.name) ?? "pending"
        : "not_required";
      const visibleForAnyRole = tool.roles.some((role) =>
        isVisibleTool(visibleToolIndex, role, safe.id, tool.name)
      );
      const readOnlyEligible = isReadOnlyVisibleMCPTool(tool);
      const executionAvailable =
        safe.enabled && visibleForAnyRole && readOnlyEligible && approvalState !== "pending";
      const status = toToolStatus({
        enabled: safe.enabled,
        visibleForAnyRole,
        readOnlyEligible,
        approvalState
      });

      for (const role of tool.roles) {
        if (!isVisibleTool(visibleToolIndex, role, safe.id, tool.name)) {
          continue;
        }

        setVisibleToolExecution(visibleToolExecutionIndex, role, safe.id, tool.name, {
          executionAvailable,
          status
        });
      }

      return {
        connectorId: safe.id,
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        permission: tool.permission,
        roleLabels: tool.roles.map((role) => input.copy.mcpView.roleLabels[role]),
        requiresApproval: tool.requiresApproval,
        approvalState,
        readOnlyEligible,
        executionAvailable,
        status
      } satisfies MCPManagementToolRow;
    });
    const status = toConnectorStatus({
      enabled: safe.enabled,
      valid: safe.valid,
      tools
    });

    return {
      id: safe.id,
      name: safe.name,
      ...(safe.description ? { description: safe.description } : {}),
      enabled: safe.enabled,
      toolCount: tools.length,
      ...(safe.updatedAt ? { updatedAt: safe.updatedAt } : {}),
      status,
      statusLabel: getMCPManagementStatusLabel(input.copy, status),
      tools
    } satisfies MCPManagementConnectorRow;
  });

  const visibleToolGroups = mcpManagementRoleOrder.map((role) => ({
    role,
    label: input.copy.mcpView.roleLabels[role],
    tools: (visibleToolsByRole.get(role) ?? []).map((tool) => {
      const execution =
        getVisibleToolExecution(visibleToolExecutionIndex, role, tool.connectorId, tool.name) ?? {
          executionAvailable: false,
          status: "execution_not_available" as const
        };

      return {
        ...tool,
        executionAvailable: execution.executionAvailable,
        status: execution.status
      };
    })
  })) satisfies MCPManagementVisibleToolGroup[];

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

function buildApprovalIndex(
  approvals: MCPManagementInputState["approvals"]
): Map<string, Map<string, MCPApprovalState>> {
  const approvalsByConnector = new Map<string, Map<string, MCPApprovalState>>();

  for (const approval of approvals) {
    if (!isRecord(approval)) {
      continue;
    }

    const state = toApprovalState(approval.state);
    const connectorId = normalizeDisplayString(approval.connectorId);
    const toolName = normalizeDisplayString(approval.toolName);
    if (!state || !connectorId || !toolName) {
      continue;
    }

    const toolsByName = approvalsByConnector.get(connectorId) ?? new Map();
    toolsByName.set(toolName, state);
    approvalsByConnector.set(connectorId, toolsByName);
  }

  return approvalsByConnector;
}

function getApprovalState(
  approvalsByConnector: Map<string, Map<string, MCPApprovalState>>,
  connectorId: string,
  toolName: string
): MCPApprovalState | undefined {
  return approvalsByConnector.get(connectorId)?.get(toolName);
}

function toApprovalState(state: unknown): MCPApprovalState | undefined {
  return state === "pending" || state === "approved" ? state : undefined;
}

function createVisibleToolIndex(): MCPVisibleToolIndex {
  return new Map();
}

function createVisibleToolExecutionIndex(): MCPVisibleToolExecutionIndex {
  return new Map();
}

function addVisibleTool(
  visibleToolIndex: MCPVisibleToolIndex,
  role: MCPAgentRole,
  connectorId: string,
  toolName: string
): void {
  const toolsByConnector = visibleToolIndex.get(role) ?? new Map<string, Set<string>>();
  const toolsByName = toolsByConnector.get(connectorId) ?? new Set<string>();

  toolsByName.add(toolName);
  toolsByConnector.set(connectorId, toolsByName);
  visibleToolIndex.set(role, toolsByConnector);
}

function setVisibleToolExecution(
  visibleToolExecutionIndex: MCPVisibleToolExecutionIndex,
  role: MCPAgentRole,
  connectorId: string,
  toolName: string,
  execution: Pick<MCPManagementToolRow, "executionAvailable" | "status">
): void {
  const toolsByConnector =
    visibleToolExecutionIndex.get(role) ??
    new Map<string, Map<string, Pick<MCPManagementToolRow, "executionAvailable" | "status">>>();
  const toolsByName =
    toolsByConnector.get(connectorId) ??
    new Map<string, Pick<MCPManagementToolRow, "executionAvailable" | "status">>();

  toolsByName.set(toolName, execution);
  toolsByConnector.set(connectorId, toolsByName);
  visibleToolExecutionIndex.set(role, toolsByConnector);
}

function isVisibleTool(
  visibleToolIndex: MCPVisibleToolIndex,
  role: MCPAgentRole,
  connectorId: string,
  toolName: string
): boolean {
  return visibleToolIndex.get(role)?.get(connectorId)?.has(toolName) ?? false;
}

function getVisibleToolExecution(
  visibleToolExecutionIndex: MCPVisibleToolExecutionIndex,
  role: MCPAgentRole,
  connectorId: string,
  toolName: string
): Pick<MCPManagementToolRow, "executionAvailable" | "status"> | undefined {
  return visibleToolExecutionIndex.get(role)?.get(connectorId)?.get(toolName);
}

function toSafeVisibleTool(tool: unknown): ProjectMCPVisibleTool | undefined {
  if (!isRecord(tool)) {
    return undefined;
  }

  const connectorId = normalizeDisplayString(tool.connectorId);
  const name = normalizeDisplayString(tool.name);
  const permission = normalizeDisplayString(tool.permission);
  const readOnly = tool.readOnly;
  const sideEffect = tool.sideEffect;

  if (
    !connectorId ||
    !name ||
    !permission ||
    typeof tool.requiresApproval !== "boolean" ||
    (hasOwn(tool, "readOnly") && typeof readOnly !== "boolean") ||
    (hasOwn(tool, "sideEffect") && sideEffect !== "read" && sideEffect !== "write")
  ) {
    return undefined;
  }

  return {
    connectorId,
    name,
    permission,
    requiresApproval: tool.requiresApproval,
    ...(typeof readOnly === "boolean" ? { readOnly } : {}),
    ...(sideEffect === "read" || sideEffect === "write" ? { sideEffect } : {})
  };
}

function toConnectorStatus(input: {
  enabled: boolean;
  valid: boolean;
  tools: MCPManagementToolRow[];
}): MCPManagementStatus {
  if (!input.valid) {
    return "invalid_definition";
  }
  if (!input.enabled) {
    return "disabled";
  }
  if (input.tools.some((tool) => tool.executionAvailable)) {
    return "configured";
  }
  if (input.tools.some((tool) => tool.status === "approval_required")) {
    return "approval_required";
  }
  if (input.tools.length === 0 || input.tools.every((tool) => tool.status === "no_visible_tools")) {
    return "no_visible_tools";
  }

  return "execution_not_available";
}

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
): SafeMCPConnector {
  const source = isRecord(connector) ? connector : {};
  const sourceTools = source.tools;
  const id = normalizeDisplayString(source.id);
  const name = normalizeDisplayString(source.name);

  if (!id || !name || !Array.isArray(sourceTools) || sourceTools.length === 0) {
    return toInvalidConnector(index, fallbackName);
  }

  const tools: SafeMCPTool[] = [];
  for (const tool of sourceTools) {
    const safeTool = toSafeTool(tool);
    if (!safeTool) {
      return toInvalidConnector(index, fallbackName);
    }
    tools.push(safeTool);
  }

  const description = normalizeDisplayString(source.description);
  const updatedAt = normalizeDisplayString(source.updatedAt);

  return {
    id,
    name,
    ...(description ? { description } : {}),
    enabled: source.enabled === true,
    ...(updatedAt ? { updatedAt } : {}),
    tools,
    valid: true
  };
}

function toInvalidConnector(index: number, fallbackName: string): SafeMCPConnector {
  return {
    id: `connector_invalid_${index + 1}`,
    name: fallbackName,
    enabled: false,
    tools: [],
    valid: false
  };
}

function toSafeTool(tool: unknown): SafeMCPTool | undefined {
  if (!isRecord(tool)) {
    return undefined;
  }

  const name = normalizeDisplayString(tool.name);
  const permission = normalizeDisplayString(tool.permission);
  const roles = tool.roles;
  const description = normalizeDisplayString(tool.description);

  if (
    !name ||
    !permission ||
    !Array.isArray(roles) ||
    roles.length === 0 ||
    !roles.every(isMCPAgentRole) ||
    typeof tool.requiresApproval !== "boolean" ||
    (hasOwn(tool, "readOnly") && typeof tool.readOnly !== "boolean") ||
    (hasOwn(tool, "sideEffect") && tool.sideEffect !== "read" && tool.sideEffect !== "write")
  ) {
    return undefined;
  }

  return {
    name,
    ...(description ? { description } : {}),
    permission,
    roles,
    requiresApproval: tool.requiresApproval,
    ...(typeof tool.readOnly === "boolean" ? { readOnly: tool.readOnly } : {}),
    ...(tool.sideEffect === "read" || tool.sideEffect === "write"
      ? { sideEffect: tool.sideEffect }
      : {})
  };
}

function isMCPAgentRole(value: unknown): value is MCPAgentRole {
  return (
    value === "planner" ||
    value === "builder" ||
    value === "reviewer" ||
    value === "deployer"
  );
}

function getMCPManagementStatusLabel(
  copy: WorkbenchCopy,
  status: MCPManagementStatus
): string {
  return copy.mcpView.management.statusLabels[status];
}

function normalizeDisplayString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  return trimmed && !containsUnsafeDisplayContent(trimmed) ? trimmed : "";
}

function containsUnsafeDisplayContent(value: string): boolean {
  return (
    /(?:^|[\s("'`])\/(?!\/)[A-Za-z0-9._~/-]+/.test(value) ||
    /[A-Za-z]:[\\/]/.test(value) ||
    /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL)[A-Z0-9_]*\b/.test(
      value
    ) ||
    /\b(?:secret|token|password|passwd|api[_-]?key|private[_-]?key|credential)(?:[_-](?:secret|token|key|value))?\b/i.test(
      value
    ) ||
    /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIAL)[A-Z0-9_]*\s*[:=]/i.test(
      value
    ) ||
    /\b(?:sk|pk|rk|xox[baprs]?)-[A-Za-z0-9_-]{8,}\b/i.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
