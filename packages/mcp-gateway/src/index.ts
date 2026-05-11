export type AgentRole = "planner" | "builder" | "reviewer" | "deployer";
export type ApprovalState = "not_required" | "pending" | "approved";

export interface MCPToolDefinition {
  name: string;
  permission: string;
  roles: AgentRole[];
  requiresApproval: boolean;
}

export interface MCPConnectorDefinition {
  id: string;
  name: string;
  tools: readonly MCPToolDefinition[];
}

export interface VisibleToolInput {
  connectors: readonly MCPConnectorDefinition[];
  projectConnectorIds: readonly string[];
  skillPermissions: readonly string[];
  agentRole: AgentRole;
  approvalState: ApprovalState;
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
    .flatMap((connector) => connector.tools)
    .filter((tool) => tool.roles.includes(input.agentRole))
    .filter((tool) => input.skillPermissions.includes(tool.permission))
    .filter(
      (tool) => !tool.requiresApproval || input.approvalState === "approved"
    )
    .map((tool) => ({
      ...tool,
      roles: [...tool.roles]
    }));
