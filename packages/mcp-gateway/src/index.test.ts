import { describe, expect, it } from "vitest";
import {
  computeVisibleTools,
  normalizeMCPConnectorDefinition,
  sampleConnector,
  type MCPConnectorDefinition
} from "./index";

describe("MCP gateway policy", () => {
  it("exposes only tools allowed for the agent role and project", () => {
    const tools = computeVisibleTools({
      connectors: [sampleConnector],
      projectConnectorIds: ["connector_assets"],
      skillPermissions: ["assets:read"],
      agentRole: "builder",
      approvalState: "not_required"
    });

    expect(tools.map((tool) => tool.name)).toEqual(["searchAssets"]);
  });

  it("hides deployment tools until approval is granted", () => {
    const tools = computeVisibleTools({
      connectors: [sampleConnector],
      projectConnectorIds: ["connector_assets"],
      skillPermissions: ["assets:read", "git:write"],
      agentRole: "deployer",
      approvalState: "pending"
    });

    expect(tools.map((tool) => tool.name)).toEqual([]);
  });

  it("shows deployment tools after approval", () => {
    const tools = computeVisibleTools({
      connectors: [sampleConnector],
      projectConnectorIds: ["connector_assets"],
      skillPermissions: ["git:write"],
      agentRole: "deployer",
      approvalState: "approved"
    });

    expect(tools.map((tool) => tool.name)).toEqual(["createPullRequest"]);
  });

  it("returns defensive tool copies instead of mutable connector objects", () => {
    const sourceConnector = {
      ...sampleConnector,
      tools: sampleConnector.tools.map((tool) => ({
        ...tool,
        roles: [...tool.roles]
      }))
    };
    const tools = computeVisibleTools({
      connectors: [sourceConnector],
      projectConnectorIds: ["connector_assets"],
      skillPermissions: ["assets:read"],
      agentRole: "builder",
      approvalState: "not_required"
    });

    tools[0]!.roles.push("deployer");
    tools[0]!.permission = "git:write";

    expect(sourceConnector.tools[0]!.roles).toEqual(["planner", "builder", "reviewer"]);
    expect(sourceConnector.tools[0]!.permission).toBe("assets:read");
  });

  it("normalizes connector definitions with defensive tool copies", () => {
    const inputRoles = ["planner", " builder "];
    const connector: MCPConnectorDefinition = normalizeMCPConnectorDefinition({
      id: " connector_assets ",
      name: " Internal Assets ",
      description: " Search approved asset metadata. ",
      tools: [
        {
          name: " searchAssets ",
          description: " Search assets. ",
          permission: " assets:read ",
          roles: inputRoles,
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
    expect(inputRoles).toEqual(["planner", " builder "]);
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
});
