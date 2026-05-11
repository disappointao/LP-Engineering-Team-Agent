import { describe, expect, it } from "vitest";
import { computeVisibleTools, sampleConnector } from "./index";

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
});
