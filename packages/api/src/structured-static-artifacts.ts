import { Buffer } from "node:buffer";
import type { StaticArtifacts } from "@lp-agent/artifacts";
import type { LPBrief } from "@lp-agent/lp-schema";

export type StaticArtifactParseFailureReason =
  | "empty_output"
  | "invalid_json"
  | "schema_invalid"
  | "policy_violation";

export interface StaticArtifactParseIssueSummary {
  issueCount?: number;
  firstIssuePath?: string;
  firstIssueCode?: string;
}

export class BuilderStaticArtifactParseError extends Error {
  readonly reason: StaticArtifactParseFailureReason;
  readonly issueSummary: StaticArtifactParseIssueSummary;
  readonly policyCode?: string;

  constructor(input: {
    reason: StaticArtifactParseFailureReason;
    issueSummary?: StaticArtifactParseIssueSummary;
    policyCode?: string;
  }) {
    super(`Builder output could not be parsed as static artifacts: ${input.reason}`);
    this.name = "BuilderStaticArtifactParseError";
    this.reason = input.reason;
    this.issueSummary = input.issueSummary ?? {};
    this.policyCode = input.policyCode;
  }
}

const REQUIRED_ARTIFACT_KEYS = ["indexHtml", "stylesCss", "scriptJs"] as const;
const REQUIRED_STYLESHEET_MARKER = '<link rel="stylesheet" href="styles.css">';
const REQUIRED_SCRIPT_MARKER = '  <script src="script.js"></script>';

const FRAMEWORK_MARKERS: RegExp[] = [
  /__NEXT_DATA__/i,
  /data-reactroot/i,
  /react-dom/i,
  /vue\.(?:global|runtime|esm)|__vue__|data-v-[\da-f]+/i,
  /ng-version|@angular/i,
  /(?:^|[\s<])id\s*=\s*(?:"__nuxt"|'__nuxt'|__nuxt\b)|nuxt-app|__NUXT__/i,
  /data-svelte|(?:^|[\s<])id\s*=\s*(?:"svelte"|'svelte'|svelte\b)|__SVELTEKIT|sveltekit/i,
  /\/@vite\/client|\bimport\.meta\b/i,
  /\bwebpackJsonp\b|\b__webpack_require__\b/i,
  /\/_next\//i,
  /\/assets\/index-[\w.-]+\.js\b/i,
  /__remix(?:Context|Manifest|RouteModules)|\/build\/_assets\//i,
  /\bnode_modules\b/i,
  /(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(?:react|react-dom|vue|@angular|svelte|next|nuxt)/i
];

const FRAMEWORK_SCRIPT_MARKERS: RegExp[] = [
  /\bReact(?:DOM)?\s*\./,
  /\bReactDOM\s*\.\s*createRoot\b/,
  /\bReact\s*\.\s*createElement\b/,
  /\bimport\s+.*\bfrom\s+["'](?:react|react-dom(?:\/client)?)["']/,
  /\brequire\s*\(\s*["'](?:react|react-dom(?:\/client)?)["']\s*\)/
];

const CSS_FRAMEWORK_HREFS: RegExp[] = [
  /(?:^|[\/@])bootstrap(?:[@/.-]|$)/i,
  /cdn\.tailwindcss\.com|(?:^|[\/@])tailwind(?:css)?(?:[@/.-]|$)/i,
  /(?:^|[\/@])bulma(?:[@/.-]|$)/i,
  /foundation-sites|(?:^|\/)foundation(?:\.min)?\.css(?:[?#]|$)|\/foundation\/\d/i,
  /(?:^|[\/@])materialize(?:[@/.-]|$)/i,
  /(?:^|[\/@])(?:antd|ant-design)(?:[@/.-]|$)/i,
  /semantic-ui/i,
  /(?:^|[\/@])uikit(?:[@/.-]|$)/i
];

export function createStructuredStaticArtifactsBuilderPrompt(brief: LPBrief): string {
  return [
    "You are the Builder for an LP Engineering Team Agent.",
    "Return exactly one JSON object with exactly these three non-empty string keys: indexHtml, stylesCss, scriptJs.",
    "Do not include any other keys.",
    "Do not wrap the JSON in Markdown fences.",
    "Do not include prose before or after the JSON.",
    "Build Framework-free static HTML/CSS/JS only.",
    "Do not include React, Vue, Angular, Svelte, SvelteKit, Next, Nuxt, Vite, Webpack, package manifests, or build steps.",
    "indexHtml must be a complete HTML document with <!doctype html>, <html>, <head>, <body>, and a viewport meta tag.",
    "indexHtml must include these exact local asset markers:",
    `- ${REQUIRED_STYLESHEET_MARKER}`,
    `- ${REQUIRED_SCRIPT_MARKER}`,
    "External images are allowed.",
    "External font CSS and non-framework brand/material CSS are allowed.",
    "External JavaScript, javascript: URLs, inline event handler attributes, and CSS frameworks are forbidden.",
    "Use the LP brief JSON below as the source of truth for page content, sections, CTA, products, SEO, and tone.",
    "",
    "LPBrief JSON:",
    JSON.stringify(brief)
  ].join("\n");
}

export function parseBuilderStaticArtifactsOutput(output: string): StaticArtifacts {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    throw new BuilderStaticArtifactParseError({ reason: "empty_output" });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(trimmed);
  } catch {
    throw new BuilderStaticArtifactParseError({ reason: "invalid_json" });
  }

  if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
    throw schemaInvalid("", "invalid_type");
  }

  const candidate = parsedJson as Record<string, unknown>;
  const keys = Object.keys(candidate);
  const extraKeys = keys.filter((key) => !isRequiredArtifactKey(key));
  if (extraKeys.length > 0) {
    throw schemaInvalid("$root", "unrecognized_keys", extraKeys.length);
  }

  const artifacts: StaticArtifacts = {
    indexHtml: assertNonEmptyString(candidate.indexHtml, "indexHtml"),
    stylesCss: assertNonEmptyString(candidate.stylesCss, "stylesCss"),
    scriptJs: assertNonEmptyString(candidate.scriptJs, "scriptJs")
  };

  validateArtifactPolicy(artifacts);
  return artifacts;
}

export function toStaticArtifactParseSuccessPayload(
  artifacts: StaticArtifacts
): Record<string, unknown> {
  return {
    role: "builder",
    schema: "StaticArtifactsSchema",
    artifactKind: "three-file-static",
    htmlBytes: Buffer.byteLength(artifacts.indexHtml, "utf8"),
    cssBytes: Buffer.byteLength(artifacts.stylesCss, "utf8"),
    jsBytes: Buffer.byteLength(artifacts.scriptJs, "utf8"),
    hasExternalCss: hasExternalStylesheet(artifacts.indexHtml),
    hasExternalImages: hasExternalImage(artifacts.indexHtml)
  };
}

export function toStaticArtifactParseFailurePayload(
  error: BuilderStaticArtifactParseError
): Record<string, unknown> {
  return {
    role: "builder",
    schema: "StaticArtifactsSchema",
    reason: error.reason,
    ...(error.policyCode ? { policyCode: error.policyCode } : {}),
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

function isRequiredArtifactKey(key: string): key is (typeof REQUIRED_ARTIFACT_KEYS)[number] {
  return REQUIRED_ARTIFACT_KEYS.includes(key as (typeof REQUIRED_ARTIFACT_KEYS)[number]);
}

function assertNonEmptyString(
  value: unknown,
  path: (typeof REQUIRED_ARTIFACT_KEYS)[number]
): string {
  if (typeof value !== "string") {
    throw schemaInvalid(path, "invalid_type");
  }
  if (value.trim().length === 0) {
    throw schemaInvalid(path, "too_small");
  }
  return value;
}

function schemaInvalid(
  path: string,
  code: string,
  issueCount = 1
): BuilderStaticArtifactParseError {
  return new BuilderStaticArtifactParseError({
    reason: "schema_invalid",
    issueSummary: {
      issueCount,
      firstIssuePath: path,
      firstIssueCode: code
    }
  });
}

function validateArtifactPolicy(artifacts: StaticArtifacts): void {
  const html = artifacts.indexHtml;
  const htmlWithoutComments = stripHtmlComments(html);
  const combined = [htmlWithoutComments, artifacts.stylesCss, artifacts.scriptJs].join("\n");

  validateHtmlDocument(htmlWithoutComments);

  if (!hasRequiredLocalStylesheet(htmlWithoutComments)) {
    throw policyViolation("missing_stylesheet_marker");
  }
  if (!hasRequiredLocalScript(htmlWithoutComments)) {
    throw policyViolation("missing_script_marker");
  }
  if (/javascript\s*:/i.test(combined)) {
    throw policyViolation("javascript_url_blocked");
  }
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(htmlWithoutComments)) {
    throw policyViolation("inline_event_handler_blocked");
  }

  validateScriptTags(htmlWithoutComments);
  validateStylesheetLinks(htmlWithoutComments);

  for (const marker of FRAMEWORK_MARKERS) {
    if (marker.test(combined)) {
      throw policyViolation("framework_marker_detected");
    }
  }
  for (const marker of FRAMEWORK_SCRIPT_MARKERS) {
    if (marker.test(artifacts.scriptJs)) {
      throw policyViolation("framework_marker_detected");
    }
  }
}

function validateHtmlDocument(html: string): void {
  if (!/^\s*<!doctype\s+html\s*>/i.test(html)) {
    throw policyViolation("html_document_invalid");
  }
  if (!/<html\b[\s\S]*<\/html>\s*$/i.test(html)) {
    throw policyViolation("html_document_invalid");
  }
  if (!/<head\b[\s\S]*<\/head>/i.test(html) || !/<body\b[\s\S]*<\/body>/i.test(html)) {
    throw policyViolation("html_document_invalid");
  }
  if (!/<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*>/i.test(html)) {
    throw policyViolation("html_document_invalid");
  }
}

function validateScriptTags(html: string): void {
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    const src = getAttributeValue(tag, "src");
    if (!src) {
      throw policyViolation("external_script_blocked");
    }
    if (src !== "script.js") {
      throw policyViolation("external_script_blocked");
    }
  }
}

function validateStylesheetLinks(html: string): void {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const href = getAttributeValue(tag, "href");
    if (hasRelToken(tag, "stylesheet") && href && href !== "styles.css" && isCssFrameworkHref(href)) {
      throw policyViolation("css_framework_blocked");
    }
  }
}

function policyViolation(policyCode: string): BuilderStaticArtifactParseError {
  return new BuilderStaticArtifactParseError({
    reason: "policy_violation",
    policyCode
  });
}

function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

function hasRequiredLocalStylesheet(html: string): boolean {
  return (html.match(/<link\b[^>]*>/gi) ?? []).some((tag) => {
    return hasRelToken(tag, "stylesheet") && getAttributeValue(tag, "href") === "styles.css";
  });
}

function hasRequiredLocalScript(html: string): boolean {
  return (html.match(/<script\b[^>]*>/gi) ?? []).some((tag) => {
    return getAttributeValue(tag, "src") === "script.js";
  });
}

function getAttributeValue(tag: string, attribute: string): string | undefined {
  const unquotedAttributeValue = "([^\\s\"'=<>`]+)";
  const pattern = new RegExp(
    `(?:^|[\\s/])${escapeRegExp(attribute)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|${unquotedAttributeValue})`,
    "i"
  );
  const match = tag.match(pattern);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function hasRelToken(tag: string, token: string): boolean {
  const rel = getAttributeValue(tag, "rel");
  return rel?.split(/\s+/).some((relToken) => relToken.toLowerCase() === token) ?? false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCssFrameworkHref(href: string): boolean {
  return CSS_FRAMEWORK_HREFS.some((pattern) => pattern.test(href));
}

function hasExternalStylesheet(html: string): boolean {
  return (stripHtmlComments(html).match(/<link\b[^>]*>/gi) ?? []).some((tag) => {
    const href = getAttributeValue(tag, "href");
    return hasRelToken(tag, "stylesheet") && !!href && href !== "styles.css" && /^(?:https?:)?\/\//i.test(href);
  });
}

function hasExternalImage(html: string): boolean {
  return (stripHtmlComments(html).match(/<img\b[^>]*>/gi) ?? []).some((tag) => {
    const src = getAttributeValue(tag, "src");
    return !!src && /^(?:https?:)?\/\//i.test(src);
  });
}
