import { describe, expect, it } from "vitest";
import {
  DeterministicMCPToolExecutor,
  computeVisibleTools,
  isReadOnlyMCPTool,
  normalizeMCPConnectorDefinition,
  sampleConnector,
  summarizeMCPToolArguments,
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

  it("treats explicit write markers as authoritative", () => {
    expect(
      isReadOnlyMCPTool({
        name: "listAssets",
        permission: "assets:list",
        roles: ["builder"],
        requiresApproval: false,
        readOnly: true,
        sideEffect: "write"
      })
    ).toBe(false);
    expect(
      isReadOnlyMCPTool({
        name: "inspectAssets",
        permission: "assets:inspect",
        roles: ["reviewer"],
        requiresApproval: false,
        readOnly: false,
        sideEffect: "read"
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
      durationMs: 0
    });
    expect(JSON.stringify(result)).not.toContain("SECRET_PRODUCT");
  });

  it("rejects malformed read-only metadata", () => {
    expect(() =>
      normalizeMCPConnectorDefinition({
        id: "connector_assets",
        name: "Assets",
        tools: [
          {
            name: "searchAssets",
            permission: "assets:read",
            roles: ["builder"],
            requiresApproval: false,
            readOnly: "yes"
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
            requiresApproval: false,
            sideEffect: "none"
          }
        ]
      })
    ).toThrow("mcp_connector_validation_failed");
  });

  it("rejects invalid connector definitions", () => {
    expect(() => normalizeMCPConnectorDefinition(null)).toThrow(
      "mcp_connector_validation_failed"
    );

    expect(() => normalizeMCPConnectorDefinition([])).toThrow(
      "mcp_connector_validation_failed"
    );

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
            name: " searchAssets ",
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
