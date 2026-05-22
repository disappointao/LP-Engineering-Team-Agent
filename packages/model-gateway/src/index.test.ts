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
  type ModelRequestContext,
  type ModelRoutingPolicy
} from "./index";

describe("model gateway", () => {
  it("exports a frozen agent role list", () => {
    expect(agentRoles).toEqual(["assistant", "planner", "builder", "reviewer", "deployer"]);
    expect(Object.isFrozen(agentRoles)).toBe(true);
  });

  it("routes agent roles through configured providers", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
    const cases: Array<{ role: AgentRole; provider: string; model: string }> = [
      { role: "assistant", provider: "mock-openai", model: "assistant-model" },
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

    expect(result.usage).toEqual({
      inputTokens: 4,
      outputTokens: 32,
      totalTokens: 36,
      source: "estimated"
    });
    expect(result.call).toEqual({
      attempt: 1,
      durationMs: 0,
      supportsStreaming: false,
      streamingEnabled: false
    });
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

  it("clones artifact workspace file metadata in audit contexts defensively", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
    const context = baseModelContext({
      artifactWorkspace: {
        mode: "filesystem",
        workspaceId: "artifact_workspace_1",
        basePath: "/tmp/lp-agent/project_1",
        writableFiles: ["index.html", "styles.css", "script.js"],
        files: [
          {
            path: "index.html",
            kind: "html",
            mimeType: "text/html",
            sizeBytes: 128,
            sha256: "hash-index",
            summary: "index.html static LP file",
            content: "RAW_MODEL_CONTEXT_SECRET"
          } as unknown as NonNullable<
            ModelRequestContext["artifactWorkspace"]["files"]
          >[number]
        ]
      }
    });

    await gateway.complete({
      role: "builder",
      prompt: "Build",
      projectId: "project_1",
      context
    });
    context.artifactWorkspace.writableFiles.push("mutated.html");
    context.artifactWorkspace.files![0]!.sha256 = "mutated";
    context.artifactWorkspace.files!.push({
      path: "styles.css",
      kind: "css",
      mimeType: "text/css",
      sizeBytes: 64,
      sha256: "hash-css",
      summary: "styles.css static LP file"
    });

    expect(gateway.getAuditLog()[0]?.context?.artifactWorkspace).toEqual({
      mode: "filesystem",
      workspaceId: "artifact_workspace_1",
      basePath: "/tmp/lp-agent/project_1",
      writableFiles: ["index.html", "styles.css", "script.js"],
      files: [
        {
          path: "index.html",
          kind: "html",
          mimeType: "text/html",
          sizeBytes: 128,
          sha256: "hash-index",
          summary: "index.html static LP file"
        }
      ]
    });
    expect(JSON.stringify(gateway.getAuditLog()[0]?.context)).not.toContain(
      "RAW_MODEL_CONTEXT_SECRET"
    );
  });

  it("does not persist forged artifact workspace file content in audit logs", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());

    await gateway.complete({
      role: "builder",
      prompt: "Build",
      projectId: "project_1",
      context: baseModelContext({
        artifactWorkspace: {
          mode: "filesystem",
          workspaceId: "artifact_workspace_1",
          basePath: "/tmp/lp-agent/project_1",
          writableFiles: ["index.html", "styles.css", "script.js"],
          files: [
            {
              path: "index.html",
              kind: "html",
              mimeType: "text/html",
              sizeBytes: 128,
              sha256: "hash-index",
              summary: "index.html static LP file",
              content: "<!doctype html><html><body>SECRET</body></html>"
            } as never
          ]
        }
      })
    });

    const auditFile = gateway.getAuditLog()[0]?.context?.artifactWorkspace.files?.[0];
    expect(JSON.stringify(gateway.getAuditLog())).not.toContain("SECRET");
    expect(auditFile).toEqual({
      path: "index.html",
      kind: "html",
      mimeType: "text/html",
      sizeBytes: 128,
      sha256: "hash-index",
      summary: "index.html static LP file"
    });
    expect(auditFile).not.toHaveProperty("content");
  });

  it("clones context memory into model audit entries defensively", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
    const memory = {
      messages: [
        {
          id: "message_1",
          taskId: "task_1",
          role: "user",
          preview: "Create a spring sale landing page",
          createdAt: "2026-05-15T08:00:00.000Z",
          score: 12
        }
      ],
      runs: [
        {
          id: "run_builder_1",
          role: "builder",
          state: "completed",
          eventTypes: ["run.started", "artifact.created", "run.completed"],
          startedAt: "2026-05-15T08:01:00.000Z",
          completedAt: "2026-05-15T08:01:01.000Z",
          score: 9
        }
      ],
      tools: [
        {
          id: "observation_1",
          runId: "run_skill_command_1",
          toolName: "static-deploy",
          state: "failed",
          outputSummary: "stdout: 47 chars\nstderr: 0 chars",
          exitCode: 0,
          errorName: "StaticDeployError",
          createdAt: "2026-05-15T08:02:00.000Z",
          completedAt: "2026-05-15T08:02:01.000Z",
          score: 8
        }
      ],
      artifacts: [
        {
          pageVersionId: "page_version_1",
          briefId: "brief_1",
          title: "Spring Sale",
          objective: "Convert paid traffic",
          files: [
            { name: "index.html", characterCount: 1200 },
            { name: "styles.css", characterCount: 800 },
            { name: "script.js", characterCount: 120 }
          ],
          createdAt: "2026-05-15T08:03:00.000Z",
          score: 6
        }
      ],
      retrieval: {
        query: "spring sale builder",
        strategy: "deterministic-keyword-v0",
        selected: ["message:message_1", "run:run_builder_1"],
        omitted: ["memory:artifacts:budget_exceeded"]
      }
    };

    await gateway.complete({
      role: "builder",
      prompt: "Build",
      projectId: "project_1",
      context: {
        skills: [],
        mcpTools: [],
        approval: { state: "not_required" },
        artifactWorkspace: {
          mode: "memory",
          writableFiles: ["index.html", "styles.css", "script.js"]
        },
        memory
      }
    });

    memory.messages[0]!.preview = "mutated";
    memory.runs[0]!.eventTypes.push("run.mutated");
    memory.artifacts[0]!.files.push({ name: "mutated.html", characterCount: 1 });
    memory.retrieval.selected.push("message:mutated");
    memory.retrieval.omitted.push("memory:mutated");

    expect(gateway.getAuditLog()[0]?.context?.memory).toEqual({
      messages: [
        expect.objectContaining({
          id: "message_1",
          preview: "Create a spring sale landing page"
        })
      ],
      runs: [
        expect.objectContaining({
          id: "run_builder_1",
          eventTypes: ["run.started", "artifact.created", "run.completed"]
        })
      ],
      tools: [
        expect.objectContaining({
          id: "observation_1",
          outputSummary: "stdout: 47 chars\nstderr: 0 chars",
          exitCode: 0,
          errorName: "StaticDeployError"
        })
      ],
      artifacts: [
        expect.objectContaining({
          pageVersionId: "page_version_1",
          files: [
            { name: "index.html", characterCount: 1200 },
            { name: "styles.css", characterCount: 800 },
            { name: "script.js", characterCount: 120 }
          ]
        })
      ],
      retrieval: {
        query: "spring sale builder",
        strategy: "deterministic-keyword-v0",
        selected: ["message:message_1", "run:run_builder_1"],
        omitted: ["memory:artifacts:budget_exceeded"]
      }
    });
  });

  it("clones handoff summaries in audit contexts", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
    const context = baseModelContext({
      handoffs: [
        {
          id: "handoff_1",
          fromRunId: "run_planner_1",
          fromRole: "planner",
          toRole: "builder",
          state: "ready",
          summary: "Planner produced LP brief",
          artifactRefs: {
            briefId: "brief_1"
          },
          updatedAt: "2026-05-15T08:00:00.000Z"
        }
      ]
    });

    await gateway.complete({
      role: "builder",
      projectId: "project_1",
      prompt: "Build",
      context
    });
    context.handoffs![0]!.artifactRefs!.briefId = "mutated";
    context.handoffs!.push({
      id: "handoff_mutated",
      fromRunId: "run_mutated",
      fromRole: "planner",
      toRole: "builder",
      state: "ready",
      summary: "mutated",
      updatedAt: "2026-05-15T08:01:00.000Z"
    });

    expect(gateway.getAuditLog()[0]?.context?.handoffs).toEqual([
      {
        id: "handoff_1",
        fromRunId: "run_planner_1",
        fromRole: "planner",
        toRole: "builder",
        state: "ready",
        summary: "Planner produced LP brief",
        artifactRefs: {
          briefId: "brief_1"
        },
        updatedAt: "2026-05-15T08:00:00.000Z"
      }
    ]);
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
            outputTokens: 1,
            totalTokens: (request.context?.skills.length ?? 0) + 1,
            source: "estimated"
          },
          call: {
            attempt: 1,
            durationMs: 0,
            supportsStreaming: false,
            streamingEnabled: false
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
        assistant: { provider: "mock-openai", model: "assistant-model" },
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
        assistant: { provider: "mock-openai", model: "assistant-model" },
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
      assistant: { provider: "mock-openai", model: "assistant-model" },
      planner: { provider: "project-provider", model: "planning-model" },
      builder: { provider: "mock-anthropic", model: "code-model" },
      reviewer: { provider: "mock-openai", model: "review-model" },
      deployer: { provider: "mock-local", model: "tool-model" }
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

function baseModelContext(overrides: Partial<ModelRequestContext> = {}): ModelRequestContext {
  return {
    skills: [],
    mcpTools: [],
    approval: { state: "not_required" },
    artifactWorkspace: {
      mode: "memory",
      writableFiles: ["index.html", "styles.css", "script.js"]
    },
    ...overrides
  };
}
