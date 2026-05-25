import { describe, expect, it } from "vitest";
import { getWorkbenchCopy } from "../lib/i18n";
import {
  buildMCPManagementViewModel,
  isReadOnlyVisibleMCPTool,
  mcpManagementRoleOrder
} from "./mcp-management-view-model";

const copy = getWorkbenchCopy("en");

describe("buildMCPManagementViewModel", () => {
  it("summarizes connector metadata, approvals, and visible read-only execution without raw state", () => {
    const viewModel = buildMCPManagementViewModel({
      copy,
      mcpState: {
        connectors: [
          {
            id: "connector_assets",
            targetKey: "project_1_SECRET_PRODUCT",
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
                name: "inspectAsset",
                permission: "assets:read",
                roles: ["reviewer"],
                requiresApproval: true,
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
            toolName: "inspectAsset",
            state: "approved",
            approvedByUserId: "SECRET_PRODUCT",
            createdAt: "2026-05-25T00:00:00.000Z",
            updatedAt: "2026-05-25T00:00:00.000Z"
          },
          {
            id: "approval_2",
            projectId: "project_1",
            connectorId: "connector_assets",
            toolName: "deployAsset",
            state: "pending",
            createdAt: "2026-05-25T00:00:00.000Z",
            updatedAt: "2026-05-25T00:00:00.000Z"
          }
        ],
        visibleToolsByRole: {
          assistant: [
            {
              connectorId: "connector_secret",
              name: "SECRET_ASSISTANT_TOOL",
              permission: "assets:read",
              requiresApproval: false,
              readOnly: true,
              sideEffect: "read"
            }
          ],
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
          reviewer: [
            {
              connectorId: "connector_assets",
              name: "inspectAsset",
              permission: "assets:read",
              requiresApproval: true,
              sideEffect: "read"
            }
          ],
          deployer: []
        }
      }
    });

    expect(viewModel.summary).toEqual({
      connectorCount: 1,
      enabledConnectorCount: 1,
      visibleToolCount: 2,
      executionEligibleToolCount: 2
    });
    expect(viewModel.connectors[0]).toMatchObject({
      id: "connector_assets",
      name: "Assets",
      enabled: true,
      toolCount: 3,
      status: "configured",
      statusLabel: "Configured"
    });
    expect(viewModel.visibleToolGroups.map((group) => group.role)).toEqual([
      "planner",
      "builder",
      "reviewer",
      "deployer"
    ]);

    const [searchAssets, inspectAsset, deployAsset] = viewModel.connectors[0]?.tools ?? [];

    expect(searchAssets).toMatchObject({
      name: "searchAssets",
      roleLabels: ["Planner", "Builder"],
      approvalState: "not_required",
      readOnlyEligible: true,
      executionAvailable: true,
      status: "configured"
    });
    expect(inspectAsset).toMatchObject({
      name: "inspectAsset",
      approvalState: "approved",
      readOnlyEligible: true,
      executionAvailable: true,
      status: "configured"
    });
    expect(deployAsset).toMatchObject({
      name: "deployAsset",
      approvalState: "pending",
      readOnlyEligible: false,
      executionAvailable: false,
      status: "approval_required"
    });
    expect(viewModel.visibleToolGroups[0]?.tools[0]).toMatchObject({
      connectorId: "connector_assets",
      name: "searchAssets",
      executionAvailable: true,
      status: "configured"
    });
    expect(viewModel.visibleToolGroups[2]?.tools[0]).toMatchObject({
      connectorId: "connector_assets",
      name: "inspectAsset",
      executionAvailable: true,
      status: "configured"
    });
    expect(JSON.stringify(viewModel)).not.toContain("SECRET_PRODUCT");
    expect(JSON.stringify(viewModel)).not.toContain("SECRET_ASSISTANT_TOOL");
  });

  it("fails closed for malformed connector records without leaking raw values", () => {
    const viewModel = buildMCPManagementViewModel({
      copy,
      mcpState: {
        connectors: [
          {
            id: "connector_invalid_SECRET",
            targetKey: "project_1",
            scope: "project",
            name: "RAW_NAME_SECRET",
            description: "RAW_DESCRIPTION_SECRET",
            enabled: true,
            tools: "RAW_MALFORMED_SECRET",
            createdAt: "2026-05-25T00:00:00.000Z",
            updatedAt: "RAW_UPDATED_SECRET"
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

    expect(viewModel.summary).toEqual({
      connectorCount: 1,
      enabledConnectorCount: 0,
      visibleToolCount: 0,
      executionEligibleToolCount: 0
    });
    expect(viewModel.connectors[0]).toEqual({
      id: "connector_invalid_1",
      name: "Invalid connector",
      enabled: false,
      toolCount: 0,
      status: "invalid_definition",
      statusLabel: "Invalid definition",
      tools: []
    });
    expect(JSON.stringify(viewModel)).not.toContain("connector_invalid_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_NAME_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_DESCRIPTION_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_MALFORMED_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_UPDATED_SECRET");
  });

  it("fails closed for connector records with empty tool definitions", () => {
    const viewModel = buildMCPManagementViewModel({
      copy,
      mcpState: {
        connectors: [
          {
            id: "connector_empty_SECRET",
            targetKey: "project_1",
            scope: "project",
            name: "RAW_EMPTY_CONNECTOR_SECRET",
            description: "RAW_EMPTY_DESCRIPTION_SECRET",
            enabled: true,
            tools: [],
            createdAt: "2026-05-25T00:00:00.000Z",
            updatedAt: "RAW_EMPTY_UPDATED_SECRET"
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

    expect(viewModel.connectors[0]).toEqual({
      id: "connector_invalid_1",
      name: "Invalid connector",
      enabled: false,
      toolCount: 0,
      status: "invalid_definition",
      statusLabel: "Invalid definition",
      tools: []
    });
    expect(JSON.stringify(viewModel)).not.toContain("connector_empty_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_EMPTY_CONNECTOR_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_EMPTY_DESCRIPTION_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_EMPTY_UPDATED_SECRET");
  });

  it("fails closed for connector records with malformed tool definitions", () => {
    const viewModel = buildMCPManagementViewModel({
      copy,
      mcpState: {
        connectors: [
          {
            id: "connector_partial_SECRET",
            targetKey: "project_1",
            scope: "project",
            name: "RAW_PARTIAL_CONNECTOR_SECRET",
            description: "RAW_PARTIAL_DESCRIPTION_SECRET",
            enabled: true,
            tools: [
              {
                name: "searchAssets",
                description: "Search public assets.",
                permission: "assets:read",
                roles: ["planner"],
                requiresApproval: false,
                readOnly: true,
                sideEffect: "read"
              },
              {
                name: "RAW_TOOL_SECRET",
                description: "RAW_TOOL_DESCRIPTION_SECRET",
                permission: "assets:read",
                roles: ["planner"],
                requiresApproval: "RAW_APPROVAL_SECRET"
              }
            ],
            createdAt: "2026-05-25T00:00:00.000Z",
            updatedAt: "RAW_PARTIAL_UPDATED_SECRET"
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

    expect(viewModel.connectors[0]).toEqual({
      id: "connector_invalid_1",
      name: "Invalid connector",
      enabled: false,
      toolCount: 0,
      status: "invalid_definition",
      statusLabel: "Invalid definition",
      tools: []
    });
    expect(JSON.stringify(viewModel)).not.toContain("connector_partial_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_PARTIAL_CONNECTOR_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_PARTIAL_DESCRIPTION_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_TOOL_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_TOOL_DESCRIPTION_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_APPROVAL_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_PARTIAL_UPDATED_SECRET");
  });

  it("fails closed for tool definitions with mixed valid and invalid roles", () => {
    const viewModel = buildMCPManagementViewModel({
      copy,
      mcpState: {
        connectors: [
          {
            id: "connector_roles_SECRET",
            targetKey: "project_1",
            scope: "project",
            name: "RAW_ROLES_CONNECTOR_SECRET",
            description: "RAW_ROLES_DESCRIPTION_SECRET",
            enabled: true,
            tools: [
              {
                name: "searchAssets",
                description: "RAW_ROLES_TOOL_DESCRIPTION_SECRET",
                permission: "assets:read",
                roles: ["planner", "RAW_ROLE_SECRET"],
                requiresApproval: false,
                readOnly: true,
                sideEffect: "read"
              }
            ],
            createdAt: "2026-05-25T00:00:00.000Z",
            updatedAt: "RAW_ROLES_UPDATED_SECRET"
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

    expect(viewModel.connectors[0]).toEqual({
      id: "connector_invalid_1",
      name: "Invalid connector",
      enabled: false,
      toolCount: 0,
      status: "invalid_definition",
      statusLabel: "Invalid definition",
      tools: []
    });
    expect(JSON.stringify(viewModel)).not.toContain("connector_roles_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_ROLES_CONNECTOR_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_ROLES_DESCRIPTION_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_ROLES_TOOL_DESCRIPTION_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_ROLE_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_ROLES_UPDATED_SECRET");
  });

  it("fails closed for tool definitions with malformed optional fields", () => {
    const viewModel = buildMCPManagementViewModel({
      copy,
      mcpState: {
        connectors: [
          {
            id: "connector_optional_SECRET",
            targetKey: "project_1",
            scope: "project",
            name: "RAW_OPTIONAL_CONNECTOR_SECRET",
            description: "RAW_OPTIONAL_DESCRIPTION_SECRET",
            enabled: true,
            tools: [
              {
                name: "searchAssets",
                description: "RAW_OPTIONAL_TOOL_DESCRIPTION_SECRET",
                permission: "assets:read",
                roles: ["planner"],
                requiresApproval: false,
                readOnly: "RAW_READ_ONLY_SECRET",
                sideEffect: "RAW_SIDE_EFFECT_SECRET"
              }
            ],
            createdAt: "2026-05-25T00:00:00.000Z",
            updatedAt: "RAW_OPTIONAL_UPDATED_SECRET"
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

    expect(viewModel.connectors[0]).toEqual({
      id: "connector_invalid_1",
      name: "Invalid connector",
      enabled: false,
      toolCount: 0,
      status: "invalid_definition",
      statusLabel: "Invalid definition",
      tools: []
    });
    expect(JSON.stringify(viewModel)).not.toContain("connector_optional_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_OPTIONAL_CONNECTOR_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_OPTIONAL_DESCRIPTION_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_OPTIONAL_TOOL_DESCRIPTION_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_READ_ONLY_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_SIDE_EFFECT_SECRET");
    expect(JSON.stringify(viewModel)).not.toContain("RAW_OPTIONAL_UPDATED_SECRET");
  });
});

describe("isReadOnlyVisibleMCPTool", () => {
  it("allows explicit read-only markers and conservative read permissions", () => {
    expect(isReadOnlyVisibleMCPTool({ permission: "assets:read" })).toBe(true);
    expect(isReadOnlyVisibleMCPTool({ permission: "assets:custom", readOnly: true })).toBe(true);
    expect(isReadOnlyVisibleMCPTool({ permission: "assets:custom", sideEffect: "read" })).toBe(true);
  });

  it("denies write-like permissions, explicit write metadata, and unknown permissions", () => {
    expect(isReadOnlyVisibleMCPTool({ permission: "assets:write" })).toBe(false);
    expect(isReadOnlyVisibleMCPTool({ permission: "assets:deploy" })).toBe(false);
    expect(isReadOnlyVisibleMCPTool({ permission: "assets:delete" })).toBe(false);
    expect(isReadOnlyVisibleMCPTool({ permission: "assets:admin" })).toBe(false);
    expect(isReadOnlyVisibleMCPTool({ permission: "assets:read", readOnly: false })).toBe(false);
    expect(isReadOnlyVisibleMCPTool({ permission: "assets:read", sideEffect: "write" })).toBe(false);
    expect(isReadOnlyVisibleMCPTool({ permission: "assets:custom" })).toBe(false);
  });
});

describe("mcpManagementRoleOrder", () => {
  it("keeps runtime roles in fixed display order", () => {
    expect(mcpManagementRoleOrder).toEqual(["planner", "builder", "reviewer", "deployer"]);
  });
});
