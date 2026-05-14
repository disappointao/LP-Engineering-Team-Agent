import { describe, expect, it } from "vitest";
import { sampleBrief, type LPBrief } from "@lp-agent/lp-schema";
import {
  InMemoryModelGateway,
  createDefaultModelPolicy,
  type ModelGateway,
  type ModelRequest,
  type ModelResponse
} from "@lp-agent/model-gateway";
import { createDefaultRuntimeContext, LocalAgentRuntimeAdapter } from "./index";
import type { RuntimeEvent, RuntimeRunRequest, RuntimeRunResult } from "./index";

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
      }
    });
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
