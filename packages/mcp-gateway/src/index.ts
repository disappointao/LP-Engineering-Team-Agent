export type AgentRole = "planner" | "builder" | "reviewer" | "deployer";
export type ApprovalState = "not_required" | "pending" | "approved";
export type MCPToolSideEffect = "read" | "write";
export type MCPToolExecutionState =
  | "completed"
  | "failed"
  | "rejected"
  | "cancelled";

export const mcpAgentRoles = Object.freeze([
  "planner",
  "builder",
  "reviewer",
  "deployer"
] as const) satisfies readonly AgentRole[];

export interface MCPToolDefinition {
  name: string;
  description?: string;
  permission: string;
  roles: AgentRole[];
  requiresApproval: boolean;
  readOnly?: boolean;
  sideEffect?: MCPToolSideEffect;
}

export interface MCPConnectorDefinition {
  id: string;
  name: string;
  description?: string;
  tools: MCPToolDefinition[];
}

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

export interface VisibleToolInput {
  connectors: readonly MCPConnectorDefinition[];
  projectConnectorIds: readonly string[];
  skillPermissions: readonly string[];
  agentRole: AgentRole;
  approvalState?: ApprovalState;
  approvalStates?: readonly MCPToolApprovalState[];
}

export interface MCPToolArgumentSummary {
  argumentKeys: string[];
  argumentCount: number;
}

const maxMCPArgumentKeyLabels = 8;

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

export const sampleConnector: MCPConnectorDefinition = {
  id: "connector_assets",
  name: "Internal Assets and Git",
  tools: [
    {
      name: "searchAssets",
      permission: "assets:read",
      roles: ["planner", "builder", "reviewer"],
      requiresApproval: false
    },
    {
      name: "createPullRequest",
      permission: "git:write",
      roles: ["deployer"],
      requiresApproval: true
    }
  ]
};

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

export function summarizeMCPToolArguments(
  value: Record<string, unknown>
): MCPToolArgumentSummary {
  const argumentCount = Object.keys(value).length;
  const argumentKeys = Array.from(
    { length: Math.min(argumentCount, maxMCPArgumentKeyLabels) },
    (_, index) => `argument_${index + 1}`
  );
  return {
    argumentKeys,
    argumentCount
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
  if (tool.readOnly === false || tool.sideEffect === "write") {
    return false;
  }
  if (tool.readOnly === true || tool.sideEffect === "read") {
    return true;
  }
  return permission.endsWith(":read");
}

export class DeterministicMCPToolExecutor implements MCPToolExecutor {
  async execute(input: MCPToolExecutionInput): Promise<MCPToolExecutionResult> {
    const argumentSummary = summarizeMCPToolArguments(input.arguments);
    const keyNoun = argumentSummary.argumentCount === 1 ? "key" : "keys";
    return {
      state: "completed",
      outputSummary:
        `Read-only MCP tool ${input.connectorId}.${input.toolName} completed with ` +
        `${argumentSummary.argumentCount} argument ${keyNoun}.`,
      metadata: {
        argumentKeys: argumentSummary.argumentKeys,
        argumentCount: argumentSummary.argumentCount
      },
      durationMs: 0
    };
  }
}

export function normalizeMCPConnectorDefinition(
  input: unknown
): MCPConnectorDefinition {
  if (!isRecord(input)) {
    throw new Error("mcp_connector_validation_failed");
  }
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
  if (
    !name ||
    !permission ||
    roles.length === 0 ||
    typeof input.requiresApproval !== "boolean"
  ) {
    throw new Error("mcp_connector_validation_failed");
  }
  const description =
    typeof input.description === "string" && input.description.trim().length > 0
      ? input.description.trim()
      : undefined;
  if ("readOnly" in input && typeof input.readOnly !== "boolean") {
    throw new Error("mcp_connector_validation_failed");
  }
  if (
    "sideEffect" in input &&
    input.sideEffect !== "read" &&
    input.sideEffect !== "write"
  ) {
    throw new Error("mcp_connector_validation_failed");
  }
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
}

function normalizeAgentRole(input: unknown): AgentRole {
  const role = normalizeRequiredString(input);
  if (mcpAgentRoles.includes(role as AgentRole)) {
    return role as AgentRole;
  }
  throw new Error("mcp_connector_validation_failed");
}

function normalizeRequiredString(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

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
