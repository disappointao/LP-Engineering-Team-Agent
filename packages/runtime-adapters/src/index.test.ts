import { describe, expect, it } from "vitest";
import { sampleBrief, type LPBrief } from "@lp-agent/lp-schema";
import {
  InMemoryModelGateway,
  ModelProviderConfigurationError,
  ModelProviderRequestError,
  createDefaultModelPolicy,
  type ModelGateway,
  type ModelRequest,
  type ModelResponse
} from "@lp-agent/model-gateway";
import { createDefaultRuntimeContext, LocalAgentRuntimeAdapter } from "./index";
import type {
  RuntimeEvent,
  RuntimeRunContext,
  RuntimeRunRequest,
  RuntimeRunResult
} from "./index";

describe("local agent runtime adapter", () => {
  it("exports the runtime adapter contract names used by orchestration packages", () => {
    const request: RuntimeRunRequest = {
      runId: "run_contract_1",
      projectId: "project_1",
      role: "planner",
      input: { prompt: "Plan a page" }
    };
    const event: RuntimeEvent = { type: "run.started", message: "planner run started" };
    const result: RuntimeRunResult = {
      runId: request.runId,
      state: "completed",
      events: [event]
    };

    expect(result.events[0]?.type).toBe("run.started");
  });

  it("types builder static artifact parse runtime events", () => {
    const parsedEvent: RuntimeEvent = {
      type: "model.output.parsed",
      message: "Builder output parsed as static artifacts",
      runId: "run_builder_1",
      role: "builder",
      schema: "StaticArtifactsSchema",
      artifactKind: "three-file-static",
      htmlBytes: 128,
      cssBytes: 64,
      jsBytes: 32,
      hasExternalCss: true,
      hasExternalImages: true
    };
    const failedEvent: RuntimeEvent = {
      type: "model.output.parse_failed",
      message: "Builder output could not be parsed as static artifacts",
      runId: "run_builder_1",
      role: "builder",
      schema: "StaticArtifactsSchema",
      reason: "policy_violation",
      policyCode: "external_script_blocked"
    };

    expect(parsedEvent.schema).toBe("StaticArtifactsSchema");
    expect(failedEvent.reason).toBe("policy_violation");
  });

  it("returns transient model output text without adding it to runtime events", async () => {
    const gateway: ModelGateway = {
      async complete(_request: ModelRequest): Promise<ModelResponse> {
        return {
          provider: "test-provider",
          model: "test-model",
          text: "RAW_MODEL_OUTPUT_SECRET",
          usage: { inputTokens: 1, outputTokens: 2 }
        };
      }
    };
    const adapter = new LocalAgentRuntimeAdapter(gateway);

    const result = await adapter.run({
      runId: "run_planner_1",
      projectId: "project_1",
      role: "planner",
      input: { prompt: "Plan" }
    });

    expect(result.state).toBe("completed");
    expect(result.modelOutputText).toBe("RAW_MODEL_OUTPUT_SECRET");
    expect(JSON.stringify(result.events)).not.toContain("RAW_MODEL_OUTPUT_SECRET");
  });

  it("retries retryable provider request failures once before succeeding", async () => {
    const gateway = new SequencedModelGateway([
      new ModelProviderRequestError(
        "model_provider_request_timeout",
        "timeout with SECRET_MODEL_ERROR",
        undefined
      ),
      {
        provider: "provider_primary",
        model: "gpt-5.4",
        text: "recovered text",
        usage: { inputTokens: 2, outputTokens: 3 }
      }
    ]);
    const adapter = new LocalAgentRuntimeAdapter(gateway);

    const result = await adapter.run({
      runId: "run_retry_1",
      projectId: "project_1",
      role: "planner",
      input: { prompt: "Plan" }
    });

    expect(result.state).toBe("completed");
    expect(gateway.calls).toBe(2);
    expect(result.modelOutputText).toBe("recovered text");
    expect(result.events.map((event) => event.type)).toEqual([
      "run.started",
      "model.retry.scheduled",
      "model.completed",
      "run.completed"
    ]);
    expect(result.events[1]).toMatchObject({
      type: "model.retry.scheduled",
      role: "planner",
      attempt: 1,
      maxAttempts: 2,
      errorCode: "model_provider_request_timeout",
      retryable: true
    });
    expect(JSON.stringify(result.events)).not.toContain("SECRET_MODEL_ERROR");
  });

  it("does not retry provider configuration errors", async () => {
    const gateway = new SequencedModelGateway([
      new ModelProviderConfigurationError(
        "model_provider_config_missing",
        "missing config SECRET_MODEL_ERROR"
      )
    ]);
    const adapter = new LocalAgentRuntimeAdapter(gateway);

    const result = await adapter.run({
      runId: "run_retry_config_1",
      projectId: "project_1",
      role: "planner",
      input: { prompt: "Plan" }
    });

    expect(result.state).toBe("failed");
    expect(gateway.calls).toBe(1);
    expect(result.events.map((event) => event.type)).toEqual([
      "run.started",
      "model.fallback.not_configured",
      "run.failed"
    ]);
    expect(JSON.stringify(result.events)).not.toContain("SECRET_MODEL_ERROR");
  });

  it("emits fallback availability metadata without executing fallback provider", async () => {
    const gateway = new SequencedModelGateway([
      new ModelProviderRequestError(
        "model_provider_http_error",
        "HTTP 503 SECRET_MODEL_ERROR",
        503
      ),
      new ModelProviderRequestError(
        "model_provider_http_error",
        "HTTP 503 SECRET_MODEL_ERROR",
        503
      )
    ]);
    const adapter = new LocalAgentRuntimeAdapter(gateway);
    const context: RuntimeRunContext = {
      ...createDefaultRuntimeContext(),
      modelRoutingPolicy: {
        ...createDefaultModelPolicy(),
        planner: {
          provider: "provider_primary",
          providerName: "Primary",
          api: "openai-completions",
          model: "gpt-5.4",
          baseUrlConfigured: true,
          apiKeyEnvConfigured: true,
          fallback: {
            provider: "provider_backup",
            providerName: "Backup",
            api: "openai-completions",
            model: "gpt-5.4-mini",
            baseUrlConfigured: true,
            apiKeyEnvConfigured: true
          }
        }
      }
    };

    const result = await adapter.run({
      runId: "run_fallback_1",
      projectId: "project_1",
      role: "planner",
      input: { prompt: "Plan" },
      context
    });

    expect(result.state).toBe("failed");
    expect(gateway.calls).toBe(2);
    expect(result.events.map((event) => event.type)).toEqual([
      "run.started",
      "runtime.context.loaded",
      "model.retry.scheduled",
      "model.retry.exhausted",
      "model.fallback.available",
      "run.failed"
    ]);
    expect(result.events[4]).toMatchObject({
      type: "model.fallback.available",
      role: "planner",
      provider: "provider_backup",
      providerName: "Backup",
      api: "openai-completions",
      model: "gpt-5.4-mini",
      baseUrlConfigured: true,
      apiKeyEnvConfigured: true
    });
    expect(JSON.stringify(result.events)).not.toContain("SECRET_MODEL_ERROR");
  });

  it("runs a builder flow through the model gateway and creates static artifacts", async () => {
    const adapter = new LocalAgentRuntimeAdapter();

    const result = await adapter.run({
      runId: "run_builder_1",
      projectId: "project_1",
      role: "builder",
      input: {
        brief: sampleBrief,
        prompt: "Build the landing page."
      }
    });

    expect(result.state).toBe("completed");
    expect(result.events.map((event) => event.type)).toEqual([
      "run.started",
      "model.completed",
      "artifact.created",
      "run.completed"
    ]);
    expect(result.events).toEqual([
      {
        type: "run.started",
        message: "builder run started",
        runId: "run_builder_1",
        role: "builder"
      },
      {
        type: "model.completed",
        message: "builder model call completed",
        runId: "run_builder_1",
        role: "builder",
        provider: "mock-anthropic",
        model: "code-model",
        usage: {
          inputTokens: 6,
          outputTokens: 32
        }
      },
      {
        type: "artifact.created",
        message: "Static LP artifacts created",
        runId: "run_builder_1",
        artifactId: "artifact_run_builder_1"
      },
      {
        type: "run.completed",
        message: "builder run completed",
        runId: "run_builder_1",
        state: "completed"
      }
    ]);
    expect(result.artifacts).toMatchObject({
      indexHtml: expect.stringContaining("Spring essentials, ready today"),
      stylesCss: expect.stringContaining(":root"),
      scriptJs: expect.stringContaining("lp-agent-track")
    });
    expect(result.findings).toBeUndefined();
  });

  it("runs a reviewer flow and blocks deployment when the hero section has no CTA", async () => {
    const adapter = new LocalAgentRuntimeAdapter();
    const briefWithoutHeroCta = {
      ...sampleBrief,
      sections: sampleBrief.sections.map((section) =>
        section.type === "hero" ? { ...section, cta: undefined } : section
      )
    };

    const result = await adapter.run({
      runId: "run_review_1",
      projectId: "project_1",
      role: "reviewer",
      input: {
        brief: briefWithoutHeroCta,
        prompt: "Review for launch blockers."
      }
    });

    expect(result.state).toBe("completed");
    expect(result.events.map((event) => event.type)).toEqual([
      "run.started",
      "model.completed",
      "review.completed",
      "run.completed"
    ]);
    expect(result.findings).toEqual([
      {
        severity: "blocking",
        target: "section:section_hero",
        explanation: "Hero section is missing a CTA.",
        suggestedFix: "Add a primary CTA to the hero section.",
        blocksDeployment: true
      }
    ]);
    expect(result.artifacts).toBeUndefined();
  });

  it("reports findings for every hero section missing a CTA", async () => {
    const adapter = new LocalAgentRuntimeAdapter();
    const briefWithMultipleHeroIssues = {
      ...sampleBrief,
      sections: [
        sampleBrief.sections[0]!,
        {
          ...sampleBrief.sections[0]!,
          id: "section_secondary_hero",
          cta: undefined
        },
        {
          ...sampleBrief.sections[0]!,
          id: "section_tertiary_hero",
          cta: undefined
        }
      ]
    };

    const result = await adapter.run({
      runId: "run_review_2",
      projectId: "project_1",
      role: "reviewer",
      input: { brief: briefWithMultipleHeroIssues }
    });

    expect(result.findings?.map((finding) => finding.target)).toEqual([
      "section:section_secondary_hero",
      "section:section_tertiary_hero"
    ]);
  });

  it("serializes the brief as the model prompt when no explicit prompt is provided", async () => {
    const gateway = new RecordingModelGateway();
    const adapter = new LocalAgentRuntimeAdapter(gateway);

    await adapter.run({
      runId: "run_builder_2",
      projectId: "project_1",
      role: "builder",
      input: { brief: sampleBrief }
    });

    expect(gateway.requests[0]?.prompt).toBe(JSON.stringify(sampleBrief));
  });

  it("forwards handoff summaries to model requests with defensive clones", async () => {
    const gateway = new RecordingPortableGateway();
    const runtime = new LocalAgentRuntimeAdapter(gateway);
    const context = completeRuntimeContext({
      handoffs: [
        {
          id: "handoff_1",
          fromRunId: "run_builder_1",
          fromRole: "builder",
          toRole: "reviewer",
          state: "ready",
          summary: "Builder produced static LP artifacts",
          artifactRefs: {
            pageVersionId: "version_1"
          },
          updatedAt: "2026-05-15T08:00:00.000Z"
        }
      ]
    });

    await runtime.run({
      runId: "run_reviewer_1",
      projectId: "project_1",
      role: "reviewer",
      input: {
        prompt: "Review",
        brief: sampleBrief
      },
      context
    });
    context.handoffs![0]!.artifactRefs!.pageVersionId = "mutated";

    expect(gateway.requests[0]?.context?.handoffs).toEqual([
      {
        id: "handoff_1",
        fromRunId: "run_builder_1",
        fromRole: "builder",
        toRole: "reviewer",
        state: "ready",
        summary: "Builder produced static LP artifacts",
        artifactRefs: {
          pageVersionId: "version_1"
        },
        updatedAt: "2026-05-15T08:00:00.000Z"
      }
    ]);
  });

  it("forwards artifact workspace file metadata with defensive clones", async () => {
    const gateway = new RecordingPortableGateway();
    const runtime = new LocalAgentRuntimeAdapter(gateway);
    const expectedFiles = [
      {
        path: "index.html" as const,
        kind: "html" as const,
        mimeType: "text/html" as const,
        sizeBytes: 128,
        sha256: "hash-index",
        summary: "index.html static LP file"
      },
      {
        path: "styles.css" as const,
        kind: "css" as const,
        mimeType: "text/css" as const,
        sizeBytes: 64,
        sha256: "hash-css",
        summary: "styles.css static LP file"
      }
    ];
    const context = completeRuntimeContext({
      artifactWorkspace: {
        mode: "filesystem",
        workspaceId: "artifact_workspace_1",
        basePath: "/tmp/lp-agent/project_1",
        writableFiles: ["index.html", "styles.css", "script.js"],
        files: [
          {
            ...expectedFiles[0]!,
            content: "RAW_RUNTIME_CONTEXT_SECRET"
          } as unknown as typeof expectedFiles[number],
          expectedFiles[1]!
        ]
      }
    });

    await runtime.run({
      runId: "run_builder_workspace_context",
      projectId: "project_1",
      role: "builder",
      input: {
        prompt: "Build",
        brief: sampleBrief
      },
      context
    });
    context.artifactWorkspace.writableFiles.push("mutated.html");
    context.artifactWorkspace.files![0]!.sha256 = "mutated";
    context.artifactWorkspace.files!.push({
      path: "script.js",
      kind: "js",
      mimeType: "text/javascript",
      sizeBytes: 32,
      sha256: "hash-js",
      summary: "script.js static LP file"
    });
    const modelWorkspace = gateway.requests[0]?.context
      ?.artifactWorkspace as RuntimeRunContext["artifactWorkspace"] | undefined;

    expect(modelWorkspace).toEqual({
      mode: "filesystem",
      workspaceId: "artifact_workspace_1",
      basePath: "/tmp/lp-agent/project_1",
      writableFiles: ["index.html", "styles.css", "script.js"],
      files: expectedFiles
    });
    expect(JSON.stringify(gateway.requests[0]?.context)).not.toContain(
      "RAW_RUNTIME_CONTEXT_SECRET"
    );
  });

  it("does not forward forged artifact workspace file content to model requests", async () => {
    const gateway = new RecordingPortableGateway();
    const runtime = new LocalAgentRuntimeAdapter(gateway);

    await runtime.run({
      runId: "run_builder_workspace_content_guard",
      projectId: "project_1",
      role: "builder",
      input: {
        prompt: "Build",
        brief: sampleBrief
      },
      context: completeRuntimeContext({
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

    const modelContext = gateway.requests[0]?.context;
    expect(JSON.stringify(modelContext)).not.toContain("SECRET");
    expect(modelContext?.artifactWorkspace.files?.[0]).toEqual({
      path: "index.html",
      kind: "html",
      mimeType: "text/html",
      sizeBytes: 128,
      sha256: "hash-index",
      summary: "index.html static LP file"
    });
    expect(modelContext?.artifactWorkspace.files?.[0]).not.toHaveProperty("content");
  });

  it("strips unexpected memory artifact file content before model requests", async () => {
    const gateway = new RecordingPortableGateway();
    const runtime = new LocalAgentRuntimeAdapter(gateway);
    const context = completeRuntimeContext({
      memory: {
        messages: [],
        runs: [],
        tools: [],
        artifacts: [
          {
            pageVersionId: "page_version_1",
            briefId: "brief_1",
            artifactWorkspaceId: "artifact_workspace_1",
            files: [
              {
                name: "index.html",
                path: "index.html",
                characterCount: 1200,
                sizeBytes: 1280,
                sha256: "hash-index",
                summary: "index.html static LP file",
                content: "RAW_SECRET"
              } as unknown as NonNullable<
                RuntimeRunContext["memory"]
              >["artifacts"][number]["files"][number]
            ],
            createdAt: "2026-05-15T08:03:00.000Z",
            score: 6
          }
        ],
        retrieval: {
          query: "spring sale",
          strategy: "deterministic-keyword-v0",
          selected: ["artifact:page_version_1"],
          omitted: []
        }
      }
    });

    await runtime.run({
      runId: "run_memory_artifact_file_sanitize",
      projectId: "project_1",
      role: "reviewer",
      input: {
        prompt: "Review",
        brief: sampleBrief
      },
      context
    });

    expect(JSON.stringify(gateway.requests[0]?.context)).not.toContain("RAW_SECRET");
    expect(gateway.requests[0]?.context?.memory?.artifacts[0]?.files).toEqual([
      {
        name: "index.html",
        path: "index.html",
        characterCount: 1200,
        sizeBytes: 1280,
        sha256: "hash-index",
        summary: "index.html static LP file"
      }
    ]);
  });

  it("passes scoped skills, visible MCP tools, approval, and workspace context into model calls", async () => {
    const gateway = new RecordingPortableGateway();
    const adapter = new LocalAgentRuntimeAdapter(gateway);
    const context = {
      skills: [
        {
          id: "skill_brand",
          name: "Brand LP",
          version: "0.1.0",
          scope: "project",
          permissions: ["brief:read", "artifact:write"],
          entrypoints: ["templates/brand.md"],
          content: "# Brand LP\nUse concise ecommerce sections.",
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
        writableFiles: ["index.html", "styles.css", "script.js"]
      },
      memory: {
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
          query: "spring sale",
          strategy: "deterministic-keyword-v0",
          selected: ["message:message_1", "tool:observation_1"],
          omitted: ["memory:tools:budget_exceeded"]
        }
      }
    } satisfies RuntimeRunRequest["context"];

    const result = await adapter.run({
      runId: "run_builder_context",
      projectId: "project_1",
      role: "builder",
      input: { brief: sampleBrief },
      context
    });

    expect(result.events.map((event) => event.type)).toEqual([
      "run.started",
      "runtime.context.loaded",
      "model.completed",
      "artifact.created",
      "run.completed"
    ]);
    expect(gateway.requests[0]?.context).toEqual({
      skills: [
        {
          id: "skill_brand",
          name: "Brand LP",
          version: "0.1.0",
          scope: "project",
          permissions: ["brief:read", "artifact:write"],
          entrypoints: ["templates/brand.md"],
          content: "# Brand LP\nUse concise ecommerce sections.",
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
        writableFiles: ["index.html", "styles.css", "script.js"]
      },
      memory: {
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
          query: "spring sale",
          strategy: "deterministic-keyword-v0",
          selected: ["message:message_1", "tool:observation_1"],
          omitted: ["memory:tools:budget_exceeded"]
        }
      }
    });
    context.memory.runs[0]!.eventTypes.push("run.mutated");
    context.memory.artifacts[0]!.files.push({ name: "mutated.html", characterCount: 1 });
    context.memory.retrieval.omitted.push("memory:mutated");
    expect(gateway.requests[0]?.context?.memory?.runs[0]?.eventTypes).toEqual([
      "run.started",
      "artifact.created",
      "run.completed"
    ]);
    expect(gateway.requests[0]?.context?.memory?.artifacts[0]?.files).toEqual([
      { name: "index.html", characterCount: 1200 },
      { name: "styles.css", characterCount: 800 },
      { name: "script.js", characterCount: 120 }
    ]);
    expect(gateway.requests[0]?.context?.memory?.retrieval.omitted).toEqual([
      "memory:tools:budget_exceeded"
    ]);
    expect(result.artifacts?.indexHtml).toContain("Spring essentials, ready today");
  });

  it("passes runtime model routing policy into model calls", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
    const runtime = new LocalAgentRuntimeAdapter(gateway);

    const result = await runtime.run({
      runId: "run_builder_1",
      projectId: "project_1",
      role: "builder",
      input: {
        brief: sampleBrief,
        prompt: "Build"
      },
      context: {
        skills: [],
        mcpTools: [],
        approval: { state: "not_required" },
        artifactWorkspace: {
          mode: "memory",
          writableFiles: ["index.html", "styles.css", "script.js"]
        },
        modelRoutingPolicy: {
          assistant: { provider: "mock-openai", model: "assistant-model" },
          planner: { provider: "mock-openai", model: "planning-model" },
          builder: { provider: "project-openai", model: "gpt-5.4" },
          reviewer: { provider: "mock-openai", model: "review-model" },
          deployer: { provider: "mock-local", model: "tool-model" }
        }
      }
    });

    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "model.completed",
        provider: "project-openai",
        model: "gpt-5.4",
        usage: {
          inputTokens: 2,
          outputTokens: 32
        }
      })
    );
  });

  it("runs an assistant flow without LP artifacts or review findings", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
    const runtime = new LocalAgentRuntimeAdapter(gateway);

    const result = await runtime.run({
      runId: "run_assistant_task_1",
      projectId: "project_1",
      role: "assistant",
      input: { prompt: "Explain this project" },
      context: createDefaultRuntimeContext()
    });

    expect(result.state).toBe("completed");
    expect(result.modelOutputText).toBe("assistant response from mock-openai/assistant-model");
    expect(result.artifacts).toBeUndefined();
    expect(result.findings).toBeUndefined();
    expect(result.events.map((event) => event.type)).toEqual([
      "run.started",
      "runtime.context.loaded",
      "model.completed",
      "run.completed"
    ]);
  });

  it("clones assistant model routing policy into runtime model calls", async () => {
    const gateway = new RecordingModelGateway();
    const runtime = new LocalAgentRuntimeAdapter(gateway);
    const policy = {
      ...createDefaultModelPolicy(),
      assistant: { provider: "project-openai", model: "gpt-5.4" }
    };

    await runtime.run({
      runId: "run_assistant_routing",
      projectId: "project_1",
      role: "assistant",
      input: { prompt: "Answer with project context" },
      context: {
        ...createDefaultRuntimeContext(),
        modelRoutingPolicy: policy
      }
    });
    policy.assistant.model = "mutated";

    expect(gateway.requests[0]).toMatchObject({
      role: "assistant",
      routingPolicy: {
        assistant: {
          provider: "project-openai",
          model: "gpt-5.4"
        }
      }
    });
  });

  it("types assistant cancellation runtime events", () => {
    const event: RuntimeEvent = {
      type: "run.cancelled",
      message: "assistant run cancelled",
      runId: "run_assistant_1",
      role: "assistant",
      state: "cancelled"
    };

    expect(event.state).toBe("cancelled");
  });

  it("surfaces sanitized provider metadata in model completed events", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
    const runtime = new LocalAgentRuntimeAdapter(gateway);

    const result = await runtime.run({
      runId: "run_builder_provider_metadata",
      projectId: "project_1",
      role: "builder",
      input: { brief: sampleBrief, prompt: "Build" },
      context: {
        skills: [],
        mcpTools: [],
        approval: { state: "not_required" },
        artifactWorkspace: {
          mode: "memory",
          writableFiles: ["index.html", "styles.css", "script.js"]
        },
        modelRoutingPolicy: {
          assistant: { provider: "mock-openai", model: "assistant-model" },
          planner: { provider: "mock-openai", model: "planning-model" },
          builder: {
            provider: "zhipu",
            providerName: "智谱 GLM",
            api: "anthropic-messages",
            model: "glm-5.1",
            baseUrlConfigured: true,
            apiKeyEnvConfigured: true
          },
          reviewer: { provider: "mock-openai", model: "review-model" },
          deployer: { provider: "mock-local", model: "tool-model" }
        }
      }
    });

    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "model.completed",
        provider: "zhipu",
        providerName: "智谱 GLM",
        api: "anthropic-messages",
        model: "glm-5.1",
        baseUrlConfigured: true,
        apiKeyEnvConfigured: true,
        usage: {
          inputTokens: 2,
          outputTokens: 32
        }
      })
    );
    expect(JSON.stringify(result.events)).not.toContain("ANTHROPIC_API_KEY");
  });

  it("creates a defensive default runtime context for deterministic local runs", () => {
    const context = createDefaultRuntimeContext();
    context.artifactWorkspace.writableFiles.push("mutated.html");

    expect(createDefaultRuntimeContext()).toEqual({
      skills: [],
      mcpTools: [],
      approval: {
        state: "not_required"
      },
      artifactWorkspace: {
        mode: "memory",
        writableFiles: ["index.html", "styles.css", "script.js"]
      }
    });
  });

  it("returns a structured failed result when the model gateway rejects", async () => {
    const adapter = new LocalAgentRuntimeAdapter(new FailingModelGateway());

    const result = await adapter.run({
      runId: "run_failed_1",
      projectId: "project_1",
      role: "planner",
      input: { prompt: "Plan a page" }
    });

    expect(result.state).toBe("failed");
    expect(result.events.map((event) => event.type)).toEqual(["run.started", "run.failed"]);
    expect(result.events[1]).toMatchObject({
      type: "run.failed",
      message: "Model gateway unavailable",
      runId: "run_failed_1",
      role: "planner",
      state: "failed"
    });
  });

  it("returns a structured failed result when artifact generation rejects", async () => {
    const adapter = new LocalAgentRuntimeAdapter();
    const invalidBrief = {
      ...sampleBrief,
      brandProfile: undefined
    } as unknown as LPBrief;

    const result = await adapter.run({
      runId: "run_failed_2",
      projectId: "project_1",
      role: "builder",
      input: { brief: invalidBrief }
    });

    expect(result.state).toBe("failed");
    expect(result.events.map((event) => event.type)).toEqual([
      "run.started",
      "model.completed",
      "run.failed"
    ]);
    expect(result.events[2]).toMatchObject({
      type: "run.failed",
      runId: "run_failed_2",
      role: "builder",
      state: "failed"
    });
  });

  it("narrows runtime events by type", async () => {
    const adapter = new LocalAgentRuntimeAdapter();
    const result = await adapter.run({
      runId: "run_builder_3",
      projectId: "project_1",
      role: "builder",
      input: { brief: sampleBrief }
    });

    const artifactEvent = result.events.find(isArtifactCreatedEvent);
    expect(artifactEvent?.artifactId).toBe("artifact_run_builder_3");

    const completedEvent = result.events.find(isRunCompletedEvent);
    const completedState: "completed" | undefined = completedEvent?.state;
    expect(completedState).toBe("completed");
  });
});

class RecordingModelGateway extends InMemoryModelGateway {
  readonly requests: ModelRequest[] = [];

  constructor() {
    super(createDefaultModelPolicy());
  }

  override async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return super.complete(request);
  }
}

class RecordingPortableGateway implements ModelGateway {
  readonly requests: ModelRequest[] = [];

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return {
      provider: "portable",
      model: `${request.role}-model`,
      text: "ok",
      usage: {
        inputTokens: 1,
        outputTokens: 1
      }
    };
  }
}

class FailingModelGateway extends InMemoryModelGateway {
  constructor() {
    super(createDefaultModelPolicy());
  }

  override async complete(): Promise<ModelResponse> {
    throw new Error("Model gateway unavailable");
  }
}

class SequencedModelGateway implements ModelGateway {
  calls = 0;

  constructor(private readonly outcomes: Array<ModelResponse | Error>) {}

  async complete(_request: ModelRequest): Promise<ModelResponse> {
    this.calls += 1;
    const outcome = this.outcomes.shift();
    if (!outcome) {
      throw new Error("unexpected_model_call");
    }
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome;
  }
}

function isArtifactCreatedEvent(
  event: RuntimeEvent
): event is Extract<RuntimeEvent, { type: "artifact.created" }> {
  return event.type === "artifact.created";
}

function isRunCompletedEvent(
  event: RuntimeEvent
): event is Extract<RuntimeEvent, { type: "run.completed" }> {
  return event.type === "run.completed";
}

function completeRuntimeContext(
  overrides: Partial<RuntimeRunContext> = {}
): RuntimeRunContext {
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
