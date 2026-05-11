import { describe, expect, it } from "vitest";
import { sampleBrief } from "@lp-agent/lp-schema";
import {
  InMemoryModelGateway,
  createDefaultModelPolicy,
  type ModelRequest,
  type ModelResponse
} from "@lp-agent/model-gateway";
import { LocalAgentRuntimeAdapter } from "./index";
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
        model: "code-model"
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
