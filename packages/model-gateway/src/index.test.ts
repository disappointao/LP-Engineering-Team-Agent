import { describe, expect, it } from "vitest";
import { InMemoryModelGateway, createDefaultModelPolicy } from "./index";

describe("model gateway", () => {
  it("routes agent roles through configured providers", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
    const result = await gateway.complete({
      role: "planner",
      prompt: "Create a landing page brief",
      projectId: "project_1"
    });

    expect(result.provider).toBe("mock-openai");
    expect(result.model).toBe("planning-model");
    expect(result.text).toContain("planner response");
  });

  it("records usage metadata for audit", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
    await gateway.complete({ role: "builder", prompt: "Generate HTML", projectId: "project_1" });

    expect(gateway.auditLog).toHaveLength(1);
    expect(gateway.auditLog[0]).toMatchObject({
      role: "builder",
      provider: "mock-anthropic",
      model: "code-model"
    });
  });
});
