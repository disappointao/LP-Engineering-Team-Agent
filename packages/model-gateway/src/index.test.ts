import { describe, expect, it } from "vitest";
import {
  InMemoryModelGateway,
  createDefaultModelPolicy,
  type AgentRole,
  type ModelAuditEntry,
  type ModelRoutingPolicy
} from "./index";

describe("model gateway", () => {
  it("routes agent roles through configured providers", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
    const cases: Array<{ role: AgentRole; provider: string; model: string }> = [
      { role: "planner", provider: "mock-openai", model: "planning-model" },
      { role: "builder", provider: "mock-anthropic", model: "code-model" },
      { role: "reviewer", provider: "mock-openai", model: "review-model" },
      { role: "deployer", provider: "mock-local", model: "tool-model" }
    ];

    for (const route of cases) {
      const result = await gateway.complete({
        role: route.role,
        prompt: "Create a landing page brief",
        projectId: "project_1"
      });

      expect(result.provider).toBe(route.provider);
      expect(result.model).toBe(route.model);
      expect(result.text).toContain(`${route.role} response`);
    }
  });

  it("records usage metadata for audit", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
    const result = await gateway.complete({
      role: "builder",
      prompt: "Generate HTML",
      projectId: "project_1"
    });

    expect(result.usage).toEqual({ inputTokens: 4, outputTokens: 32 });
    expect(gateway.getAuditLog()).toHaveLength(1);
    expect(gateway.getAuditLog()[0]).toMatchObject({
      role: "builder",
      projectId: "project_1",
      provider: "mock-anthropic",
      model: "code-model",
      promptLength: 13
    });
  });

  it("keeps routing stable when caller mutates the original policy", async () => {
    const policy = createDefaultModelPolicy();
    const gateway = new InMemoryModelGateway(policy);
    policy.planner.provider = "mutated-provider";
    policy.planner.model = "mutated-model";

    const result = await gateway.complete({
      role: "planner",
      prompt: "Plan",
      projectId: "project_1"
    });

    expect(result.provider).toBe("mock-openai");
    expect(result.model).toBe("planning-model");
  });

  it("fails closed with a clear error when a route is missing", async () => {
    const policy = createDefaultModelPolicy() as Partial<ModelRoutingPolicy>;
    delete policy.reviewer;
    const gateway = new InMemoryModelGateway(policy as ModelRoutingPolicy);

    await expect(
      gateway.complete({ role: "reviewer", prompt: "Review", projectId: "project_1" })
    ).rejects.toThrow("Model route not configured for role: reviewer");
  });

  it("returns defensive audit log copies", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
    await gateway.complete({ role: "builder", prompt: "Generate HTML", projectId: "project_1" });

    const auditLog = gateway.getAuditLog() as ModelAuditEntry[];
    auditLog.push({
      role: "planner",
      projectId: "project_2",
      provider: "mutated-provider",
      model: "mutated-model",
      promptLength: 1
    });
    const firstAuditEntry = auditLog[0];
    if (!firstAuditEntry) {
      throw new Error("Expected an audit entry");
    }
    firstAuditEntry.provider = "mutated-provider";

    expect(gateway.getAuditLog()).toHaveLength(1);
    expect(gateway.getAuditLog()[0]).toMatchObject({
      role: "builder",
      provider: "mock-anthropic",
      model: "code-model"
    });
  });
});
