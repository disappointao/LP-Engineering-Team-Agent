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

const LP_BRIEF_QUALITY_GUIDE = [
  "Turn vague requests into a concrete LP structure with audience, offer, CTA, section hierarchy, and proof.",
  "Sections should cover hero, benefits/value props, proof or trust, FAQ/risk reducer, and final CTA when the request allows it.",
  "Use layoutHints for mobile-first and desktop layout intent, including card grids, two-column hero layouts, repeated CTA placement, or single-column mobile flow.",
  "Use validationRules and complianceNotes for accessibility notes, claim caution, required CTA behavior, and content constraints.",
  "Use assets alt text, section media notes, and productData details so the Builder can create accessible static HTML.",
  "Keep copy specific to the audience, offer, product, location, event, or brand named in the request."
];

export function createStructuredLPBriefPlannerPrompt(userPrompt: string): string {
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
    "LP quality guidance:",
    ...LP_BRIEF_QUALITY_GUIDE,
    "",
    "User request:",
    userPrompt
  ].join("\n");
}

export interface StructuredLPBriefRepairPromptInput {
  userPrompt: string;
  failure: {
    reason: LPBriefParseFailureReason;
    issueCount?: number;
    firstIssuePath?: string;
    firstIssueCode?: string;
  };
}

export function createStructuredLPBriefRepairPrompt(
  input: StructuredLPBriefRepairPromptInput
): string {
  return [
    "Repair the previous Planner response for an LP Engineering Team Agent.",
    "Return exactly one JSON object that matches LPBriefSchema.",
    "Do not wrap the JSON in Markdown fences.",
    "Do not include prose before or after the JSON.",
    "Do not copy invalid formatting from the previous response.",
    "",
    "Failure summary:",
    `- reason: ${input.failure.reason}`,
    ...(input.failure.issueCount !== undefined
      ? [`- issueCount: ${input.failure.issueCount}`]
      : []),
    ...(input.failure.firstIssuePath
      ? [`- firstIssuePath: ${input.failure.firstIssuePath}`]
      : []),
    ...(input.failure.firstIssueCode
      ? [`- firstIssueCode: ${input.failure.firstIssueCode}`]
      : []),
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
    "- assets: array of { id, type, label, url, alt? }",
    "- productData: array of { id, name, description, price?, imageUrl? }",
    "- seo: { title, description, socialImage? }",
    "- tracking: { analyticsId?, events: string[] }",
    "- complianceNotes: string[]",
    "",
    "LP quality guidance:",
    ...LP_BRIEF_QUALITY_GUIDE,
    "",
    "Original user request:",
    input.userPrompt
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

  const parsed = LPBriefSchema.safeParse(normalizePlannerBriefCandidate(parsedJson));
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

function normalizePlannerBriefCandidate(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  return {
    ...value,
    brandProfile: normalizeBrandProfile(value.brandProfile),
    constraints: normalizeStringArray(value.constraints),
    sections: Array.isArray(value.sections)
      ? value.sections.map(normalizeSectionCandidate)
      : value.sections,
    assets: Array.isArray(value.assets) ? value.assets : [],
    productData: Array.isArray(value.productData) ? value.productData : [],
    tracking: normalizeTracking(value.tracking),
    complianceNotes: normalizeStringArray(value.complianceNotes)
  };
}

function normalizeBrandProfile(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  return {
    ...value,
    colors: normalizeStringArray(value.colors)
  };
}

function normalizeSectionCandidate(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  return {
    ...value,
    media: Array.isArray(value.media) ? value.media : [],
    cta: isRecord(value.cta) ? value.cta : undefined,
    layoutHints: normalizeStringArray(value.layoutHints),
    validationRules: normalizeStringArray(value.validationRules)
  };
}

function normalizeTracking(value: unknown): unknown {
  if (!isRecord(value)) {
    return { events: [] };
  }

  return {
    ...value,
    events: normalizeStringArray(value.events)
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return [value];
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
