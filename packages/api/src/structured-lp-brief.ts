import { LPBriefSchema, type LPBrief } from "@lp-agent/lp-schema";

export type LPBriefParseFailureReason =
  | "empty_output"
  | "invalid_json"
  | "schema_invalid";

export interface LPBriefParseIssueSummary {
  issueCount?: number;
  firstIssuePath?: string;
  firstIssueCode?: string;
}

export class PlannerLPBriefParseError extends Error {
  readonly reason: LPBriefParseFailureReason;
  readonly issueSummary: LPBriefParseIssueSummary;

  constructor(
    reason: LPBriefParseFailureReason,
    issueSummary: LPBriefParseIssueSummary = {}
  ) {
    super(`Planner output could not be parsed as LP brief: ${reason}`);
    this.name = "PlannerLPBriefParseError";
    this.reason = reason;
    this.issueSummary = issueSummary;
  }
}

export function createStructuredLPBriefPlannerPrompt(userPrompt: string): string {
  const normalizedPrompt = userPrompt.trim();
  return [
    "You are the Planner for an LP Engineering Team Agent.",
    "Return exactly one JSON object that matches LPBriefSchema.",
    "Do not wrap the JSON in Markdown fences.",
    "Do not include prose before or after the JSON.",
    "The downstream Builder will generate Framework-free static HTML/CSS/JS from this brief.",
    "",
    "LPBriefSchema compact guide:",
    "- title: non-empty string",
    "- objective: non-empty string",
    "- audience: non-empty string",
    "- offer: non-empty string",
    "- brandProfile: { name, tone, colors: string[], typography }",
    "- tone: non-empty string",
    "- constraints: string[]",
    "- sections: non-empty array of { id, type, purpose, headline, body, media, cta, layoutHints, validationRules }",
    "- section.type is one of hero, benefits, product-grid, social-proof, faq, cta, custom",
    "- cta: { label, href, intent }",
    "- assets: array of { id, type, label, url, alt? }",
    "- productData: array of { id, name, description, price?, imageUrl? }",
    "- seo: { title, description, socialImage? }",
    "- tracking: { analyticsId?, events: string[] }",
    "- complianceNotes: string[]",
    "",
    "User request:",
    normalizedPrompt
  ].join("\n");
}

export function parsePlannerLPBriefOutput(output: string): LPBrief {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    throw new PlannerLPBriefParseError("empty_output");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(trimmed);
  } catch {
    throw new PlannerLPBriefParseError("invalid_json");
  }

  if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
    throw new PlannerLPBriefParseError("schema_invalid", {
      issueCount: 1,
      firstIssuePath: "",
      firstIssueCode: "invalid_type"
    });
  }

  const parsed = LPBriefSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    throw new PlannerLPBriefParseError("schema_invalid", {
      issueCount: parsed.error.issues.length,
      firstIssuePath: firstIssue?.path.join(".") ?? "",
      firstIssueCode: firstIssue?.code
    });
  }

  return parsed.data;
}

export function toLPBriefParseSuccessPayload(brief: LPBrief): Record<string, unknown> {
  return {
    role: "planner",
    schema: "LPBriefSchema",
    title: brief.title,
    sectionCount: brief.sections.length,
    productCount: brief.productData.length,
    hasAssets: brief.assets.length > 0
  };
}

export function toLPBriefParseFailurePayload(
  error: PlannerLPBriefParseError
): Record<string, unknown> {
  return {
    role: "planner",
    schema: "LPBriefSchema",
    reason: error.reason,
    ...(error.issueSummary.issueCount !== undefined
      ? { issueCount: error.issueSummary.issueCount }
      : {}),
    ...(error.issueSummary.firstIssuePath !== undefined
      ? { firstIssuePath: error.issueSummary.firstIssuePath }
      : {}),
    ...(error.issueSummary.firstIssueCode !== undefined
      ? { firstIssueCode: error.issueSummary.firstIssueCode }
      : {})
  };
}
