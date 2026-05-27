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
    expect(prompt).toContain("LP quality guidance:");
    expect(prompt).toContain(
      "Turn vague requests into a concrete LP structure with audience, offer, CTA, section hierarchy, and proof."
    );
    expect(prompt).toContain(
      "Sections should cover hero, benefits/value props, proof or trust, FAQ/risk reducer, and final CTA when the request allows it."
    );
    expect(prompt).toContain(
      "Use layoutHints for mobile-first and desktop layout intent, including card grids, two-column hero layouts, repeated CTA placement, or single-column mobile flow."
    );
    expect(prompt).toContain(
      "Use validationRules and complianceNotes for accessibility notes, claim caution, required CTA behavior, and content constraints."
    );
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
    expect(prompt).toContain("LP quality guidance:");
    expect(prompt).toContain(
      "Turn vague requests into a concrete LP structure with audience, offer, CTA, section hierarchy, and proof."
    );
    expect(prompt).toContain(
      "Keep copy specific to the audience, offer, product, location, event, or brand named in the request."
    );
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

  it("normalizes common model array drift before validating the LP brief", () => {
    const parsed = parsePlannerLPBriefOutput(JSON.stringify({
      ...sampleBrief,
      brandProfile: {
        ...sampleBrief.brandProfile,
        colors: "#f97316"
      },
      sections: [
        {
          ...sampleBrief.sections[0],
          media: { label: "Hero image" },
          layoutHints: "two-column hero",
          validationRules: null
        }
      ],
      assets: { id: "asset_hero" },
      tracking: {
        analyticsId: "G-TEST",
        events: "cta_click"
      }
    }));

    expect(parsed.brandProfile.colors).toEqual(["#f97316"]);
    expect(parsed.sections[0]?.media).toEqual([]);
    expect(parsed.sections[0]?.layoutHints).toEqual(["two-column hero"]);
    expect(parsed.sections[0]?.validationRules).toEqual([]);
    expect(parsed.assets).toEqual([]);
    expect(parsed.tracking.events).toEqual(["cta_click"]);
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
