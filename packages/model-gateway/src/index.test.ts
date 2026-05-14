import { describe, expect, it } from "vitest";
import {
  InMemoryModelGateway,
  ModelProviderConfigurationError,
  ProviderBackedModelGateway,
  agentRoles,
  createDefaultModelPolicy,
  type AgentRole,
  type ModelGateway,
  type ModelAuditEntry,
  type ModelRoutingPolicy
} from "./index";

describe("model gateway", () => {
  it("exports a frozen agent role list", () => {
    expect(agentRoles).toEqual(["planner", "builder", "reviewer", "deployer"]);
    expect(Object.isFrozen(agentRoles)).toBe(true);
  });

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
      projectId: "project_1",
      context: {
        skills: [
          {
            id: "skill_brand",
            name: "Brand LP",
            version: "0.1.0",
            scope: "project",
            permissions: ["brief:read", "artifact:write"],
            entrypoints: ["templates/brand.md"],
            content: "# Brand LP",
            contentType: "text/markdown"
          }
        ],
        mcpTools: [
          {
            connectorId: "connector_assets",
            name: "searchAssets",
            permission: "assets:read",
            requiresApproval: false
          }
        ],
        approval: {
          state: "not_required"
        },
        artifactWorkspace: {
          mode: "memory",
          writableFiles: ["index.html", "styles.css", "script.js"]
        }
      }
    });

    expect(result.usage).toEqual({ inputTokens: 4, outputTokens: 32 });
    expect(gateway.getAuditLog()).toHaveLength(1);
    expect(gateway.getAuditLog()[0]).toMatchObject({
      role: "builder",
      projectId: "project_1",
      provider: "mock-anthropic",
      model: "code-model",
      promptLength: 13,
      context: {
        skills: [
          {
            id: "skill_brand",
            permissions: ["brief:read", "artifact:write"],
            content: "# Brand LP",
            contentType: "text/markdown"
          }
        ],
        mcpTools: [
          {
            connectorId: "connector_assets",
            name: "searchAssets",
            permission: "assets:read"
          }
        ],
        approval: {
          state: "not_required"
        },
        artifactWorkspace: {
          mode: "memory",
          writableFiles: ["index.html", "styles.css", "script.js"]
        }
      }
    });
  });

  it("can be replaced by a provider-neutral gateway implementation", async () => {
    const gateway: ModelGateway = {
      async complete(request) {
        return {
          provider: "remote-openai",
          model: `${request.role}-model`,
          text: `${request.context?.mcpTools.map((tool) => tool.name).join(",") ?? "no-tools"}`,
          usage: {
            inputTokens: request.context?.skills.length ?? 0,
            outputTokens: 1
          }
        };
      }
    };

    const result = await gateway.complete({
      role: "planner",
      prompt: "Plan",
      projectId: "project_1",
      context: {
        skills: [
          {
            id: "skill_brand",
            name: "Brand LP",
            version: "0.1.0",
            scope: "project",
            permissions: ["brief:read"],
            entrypoints: ["templates/brand.md"],
            content: "# Brand LP",
            contentType: "text/markdown"
          }
        ],
        mcpTools: [
          {
            connectorId: "connector_assets",
            name: "searchAssets",
            permission: "assets:read",
            requiresApproval: false
          }
        ],
        approval: {
          state: "approved",
          approvedByUserId: "reviewer_1"
        },
        artifactWorkspace: {
          mode: "filesystem",
          basePath: "/tmp/lp-agent/project_1",
          writableFiles: ["index.html"]
        }
      }
    });

    expect(result).toMatchObject({
      provider: "remote-openai",
      model: "planner-model",
      text: "searchAssets",
      usage: {
        inputTokens: 1,
        outputTokens: 1
      }
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

  it("uses request-scoped routing policy when provided", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());

    const result = await gateway.complete({
      role: "builder",
      prompt: "Generate HTML",
      projectId: "project_1",
      routingPolicy: {
        planner: { provider: "mock-openai", model: "planning-model" },
        builder: { provider: "project-openai", model: "gpt-5.4" },
        reviewer: { provider: "mock-openai", model: "review-model" },
        deployer: { provider: "mock-local", model: "tool-model" }
      }
    });

    expect(result).toMatchObject({
      provider: "project-openai",
      model: "gpt-5.4"
    });
    expect(gateway.getAuditLog()[0]).toMatchObject({
      provider: "project-openai",
      model: "gpt-5.4"
    });
  });

  it("records sanitized provider protocol metadata from request-scoped routes", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());

    const result = await gateway.complete({
      role: "builder",
      prompt: "Generate HTML",
      projectId: "project_1",
      routingPolicy: {
        planner: { provider: "mock-openai", model: "planning-model" },
        builder: {
          provider: "zhipu",
          providerName: "智谱 GLM",
          api: "anthropic-messages",
          model: "glm-5.1",
          baseUrlConfigured: true,
          apiKeyEnvConfigured: true,
          modelCapabilities: {
            contextWindow: 200000,
            maxTokens: 128000,
            supportsTools: true,
            supportsStreaming: true
          }
        },
        reviewer: { provider: "mock-openai", model: "review-model" },
        deployer: { provider: "mock-local", model: "tool-model" }
      }
    });

    expect(result).toMatchObject({
      provider: "zhipu",
      providerName: "智谱 GLM",
      api: "anthropic-messages",
      model: "glm-5.1",
      baseUrlConfigured: true,
      apiKeyEnvConfigured: true,
      modelCapabilities: {
        contextWindow: 200000,
        maxTokens: 128000,
        supportsTools: true,
        supportsStreaming: true
      }
    });
    expect(JSON.stringify(gateway.getAuditLog())).not.toContain("sk-");
    expect(gateway.getAuditLog()[0]).toMatchObject({
      provider: "zhipu",
      providerName: "智谱 GLM",
      api: "anthropic-messages",
      model: "glm-5.1",
      baseUrlConfigured: true,
      apiKeyEnvConfigured: true
    });
  });

  it("copies request-scoped routing policy before storing audit context", async () => {
    const policy = createDefaultModelPolicy();
    policy.builder.provider = "project-openai";
    policy.builder.model = "gpt-5.4";
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());

    await gateway.complete({
      role: "builder",
      prompt: "Generate HTML",
      projectId: "project_1",
      routingPolicy: policy
    });
    policy.builder.provider = "mutated-provider";
    policy.builder.model = "mutated-model";

    expect(gateway.getAuditLog()[0]).toMatchObject({
      provider: "project-openai",
      model: "gpt-5.4"
    });
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

  it("can reject mock routes for real-runtime provider-backed gateways", async () => {
    const providers = {
      async getProvider() {
        throw new Error("provider_resolver_should_not_be_called_for_mock_route");
      }
    };
    const defaultGateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers
    });
    await expect(
      defaultGateway.complete({ role: "planner", prompt: "Plan", projectId: "project_1" })
    ).resolves.toMatchObject({
      provider: "mock-openai",
      model: "planning-model"
    });

    const realRuntimeGateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers,
      allowMockRoutes: false
    });

    await expect(
      realRuntimeGateway.complete({ role: "planner", prompt: "Plan", projectId: "project_1" })
    ).rejects.toMatchObject({
      name: "ModelProviderConfigurationError",
      code: "model_provider_mock_route_disabled",
      message: "Mock model route mock-openai cannot be used when real model runtime is enabled"
    } satisfies Partial<ModelProviderConfigurationError>);
  });

  it("can reject provider-resolved mock APIs for real-runtime provider-backed gateways", async () => {
    const policy: ModelRoutingPolicy = {
      ...createDefaultModelPolicy(),
      planner: { provider: "project-provider", model: "planning-model" }
    };
    const providers = {
      async getProvider(providerId: string) {
        return {
          id: providerId,
          name: "Project Provider",
          enabled: true,
          config: { api: "mock" as const }
        };
      }
    };
    const defaultGateway = new ProviderBackedModelGateway({
      policy,
      providers
    });
    await expect(
      defaultGateway.complete({ role: "planner", prompt: "Plan", projectId: "project_1" })
    ).resolves.toMatchObject({
      provider: "project-provider",
      providerName: "Project Provider",
      api: "mock",
      model: "planning-model"
    });

    const realRuntimeGateway = new ProviderBackedModelGateway({
      policy,
      providers,
      allowMockRoutes: false
    });

    await expect(
      realRuntimeGateway.complete({ role: "planner", prompt: "Plan", projectId: "project_1" })
    ).rejects.toMatchObject({
      name: "ModelProviderConfigurationError",
      code: "model_provider_mock_route_disabled",
      message: "Mock model route project-provider cannot be used when real model runtime is enabled"
    } satisfies Partial<ModelProviderConfigurationError>);
  });
});
