import { describe, expect, it } from "vitest";
import { sampleBrief } from "@lp-agent/lp-schema";
import {
  PlannerLPBriefParseError,
  createStructuredLPBriefPlannerPrompt,
  createStructuredLPBriefRepairPrompt,
  parsePlannerLPBriefOutput,
  toLPBriefParseFailurePayload,
  toLPBriefParseSuccessPayload
} from "./structured-lp-brief";

describe("structured LP brief model output", () => {
  it("builds a strict JSON Planner prompt that preserves the user prompt", () => {
    const userPrompt = "  生成一个面向春季促销的电商 LP，突出限时优惠。\n保留这行。  ";
    const prompt = createStructuredLPBriefPlannerPrompt(userPrompt);

    expect(prompt).toContain("Return exactly one JSON object");
    expect(prompt).toContain("Do not wrap the JSON in Markdown fences");
    expect(prompt).toContain("LPBriefSchema");
    expect(prompt).toContain("Framework-free static HTML/CSS/JS");
    expect(prompt).toContain(userPrompt);
  });

  it("creates a safe LP brief repair prompt without raw model output", () => {
    const prompt = createStructuredLPBriefRepairPrompt({
      userPrompt: "Build a landing page for a spring sale.",
      failure: {
        reason: "schema_invalid",
        issueCount: 2,
        firstIssuePath: "sections.0.headline",
        firstIssueCode: "invalid_type"
      }
    });

    expect(prompt).toContain("Repair the previous Planner response");
    expect(prompt).toContain("LPBriefSchema");
    expect(prompt).toContain("schema_invalid");
    expect(prompt).toContain("sections.0.headline");
    expect(prompt).toContain("Build a landing page for a spring sale.");
    expect(prompt).not.toContain("RAW_MODEL_OUTPUT_SECRET");
    expect(prompt).not.toContain("```");
  });

  it("parses a complete LPBriefSchema JSON object", () => {
    const parsed = parsePlannerLPBriefOutput(JSON.stringify({
      ...sampleBrief,
      title: "Model Planned Landing Page",
      sections: sampleBrief.sections.map((section, index) => ({
        ...section,
        id: `model_section_${index + 1}`
      }))
    }));

    expect(parsed.title).toBe("Model Planned Landing Page");
    expect(parsed.sections).toHaveLength(sampleBrief.sections.length);
    expect(parsed.sections[0]?.id).toBe("model_section_1");
  });

  it("rejects empty output with a stable reason", () => {
    expect(() => parsePlannerLPBriefOutput("   ")).toThrow(PlannerLPBriefParseError);

    const error = captureParseError("   ");
    expect(error.reason).toBe("empty_output");
    expect(toLPBriefParseFailurePayload(error)).toEqual({
      role: "planner",
      schema: "LPBriefSchema",
      reason: "empty_output"
    });
  });

  it("rejects Markdown-fenced JSON in V0", () => {
    const error = captureParseError(`\`\`\`json\n${JSON.stringify(sampleBrief)}\n\`\`\``);

    expect(error.reason).toBe("invalid_json");
    expect(toLPBriefParseFailurePayload(error)).toEqual({
      role: "planner",
      schema: "LPBriefSchema",
      reason: "invalid_json"
    });
  });

  it("rejects invalid JSON without exposing raw output", () => {
    const error = captureParseError("{ not json } RAW_MODEL_OUTPUT_SECRET");
    const payload = toLPBriefParseFailurePayload(error);

    expect(error.reason).toBe("invalid_json");
    expect(JSON.stringify(payload)).not.toContain("RAW_MODEL_OUTPUT_SECRET");
  });

  it("rejects schema-invalid JSON and reports sanitized issue metadata", () => {
    const error = captureParseError(JSON.stringify({
      ...sampleBrief,
      sections: []
    }));

    expect(error.reason).toBe("schema_invalid");
    expect(toLPBriefParseFailurePayload(error)).toMatchObject({
      role: "planner",
      schema: "LPBriefSchema",
      reason: "schema_invalid",
      issueCount: 1,
      firstIssuePath: "sections",
      firstIssueCode: "too_small"
    });
  });

  it("creates a sanitized parse success payload", () => {
    expect(toLPBriefParseSuccessPayload(sampleBrief)).toEqual({
      role: "planner",
      schema: "LPBriefSchema",
      title: sampleBrief.title,
      sectionCount: sampleBrief.sections.length,
      productCount: sampleBrief.productData.length,
      hasAssets: false
    });
  });
});

function captureParseError(output: string): PlannerLPBriefParseError {
  try {
    parsePlannerLPBriefOutput(output);
  } catch (error) {
    if (error instanceof PlannerLPBriefParseError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected parse to fail");
}
