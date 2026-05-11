import { describe, expect, it } from "vitest";
import { sampleBrief } from "@lp-agent/lp-schema";
import { LocalAgentRuntimeAdapter } from "./index";

describe("local agent runtime adapter", () => {
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
      { type: "run.started", runId: "run_builder_1", role: "builder" },
      {
        type: "model.completed",
        runId: "run_builder_1",
        role: "builder",
        provider: "mock-anthropic",
        model: "code-model"
      },
      { type: "artifact.created", runId: "run_builder_1", artifactId: "artifact_run_builder_1" },
      { type: "run.completed", runId: "run_builder_1", state: "completed" }
    ]);
    expect(result.artifact).toMatchObject({
      indexHtml: expect.stringContaining("Spring essentials, ready today"),
      stylesCss: expect.stringContaining(":root"),
      scriptJs: expect.stringContaining("lp-agent-track")
    });
    expect(result.findings).toEqual([]);
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
    expect(result.artifact).toBeUndefined();
  });
});
