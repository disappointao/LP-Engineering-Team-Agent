# Real Builder Static Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In `REAL_MODEL_RUNTIME=1`, replace deterministic Builder artifacts with model-generated, schema-validated, framework-free `index.html` / `styles.css` / `script.js` artifacts while preserving deterministic default behavior.

**Architecture:** Keep provider calls in `packages/model-gateway` and runtime calls in `packages/runtime-adapters`; API owns Builder output parsing and fail-closed persistence. Add an API-local parser/prompt helper for static artifacts, broaden runtime event types for Builder parse events, then wire `DemoWorkbenchService.generatePageVersion()` through the existing `runAgentStep(finalizeResult)` hook.

**Tech Stack:** pnpm TypeScript monorepo, Vitest, existing `StaticArtifacts` type from `@lp-agent/artifacts`, existing `RuntimeRunResult.modelOutputText`, existing API run finalizer.

---

## File Structure

- Create `packages/api/src/structured-static-artifacts.ts`
  - Owns Builder prompt construction, strict JSON parsing, static artifact field validation, framework/resource policy checks, parse error classification, and sanitized success/failure payload helpers.
- Create `packages/api/src/structured-static-artifacts.test.ts`
  - Focused parser and prompt unit tests. No network, repositories, Web state, or runtime execution.
- Modify `packages/api/package.json`
  - Add the new parser test to the API package test script.
- Modify `packages/runtime-adapters/src/index.ts`
  - Broaden `RuntimeEvent` variants for `model.output.parsed` and `model.output.parse_failed` so API can emit Builder static artifact parse events without weakening event typing.
- Modify `packages/runtime-adapters/src/index.test.ts`
  - Add a compile/runtime contract test for Builder static artifact parse event variants.
- Modify `packages/api/src/services.test.ts`
  - Add real-runtime Builder success/failure fake-fetch coverage while preserving existing Planner structured-output tests.
- Modify `packages/api/src/index.ts`
  - Add structured Builder prompt/finalizer logic inside `generatePageVersion()`.
  - On success, replace deterministic runtime artifacts with parsed model artifacts.
  - On failure, fail closed, remove misleading `artifact.created` / `run.completed`, and persist sanitized parse failure events.
- Modify `docs/superpowers/README.md`
  - Add this implementation plan after the real Builder static artifact design entry.
- Modify `docs/agent-development-learning.md`
  - Add this implementation plan link under the real Builder static artifact learning note and update the note to completed during final docs task.

---

## Task 1: Add Structured Static Artifact Parser Red Tests

**Files:**
- Create: `packages/api/src/structured-static-artifacts.test.ts`
- Modify: `packages/api/package.json`

- [ ] **Step 1: Add parser and prompt tests**

Create `packages/api/src/structured-static-artifacts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sampleBrief } from "@lp-agent/lp-schema";
import {
  BuilderStaticArtifactParseError,
  createStructuredStaticArtifactsBuilderPrompt,
  parseBuilderStaticArtifactsOutput,
  toStaticArtifactParseFailurePayload,
  toStaticArtifactParseSuccessPayload
} from "./structured-static-artifacts";

describe("structured static artifact model output", () => {
  it("builds a strict JSON Builder prompt from a validated LP brief", () => {
    const prompt = createStructuredStaticArtifactsBuilderPrompt(sampleBrief);

    expect(prompt).toContain("Return exactly one JSON object");
    expect(prompt).toContain("indexHtml");
    expect(prompt).toContain("stylesCss");
    expect(prompt).toContain("scriptJs");
    expect(prompt).toContain("Framework-free static HTML/CSS/JS");
    expect(prompt).toContain("Do not include React, Vue, Angular, Svelte");
    expect(prompt).toContain(sampleBrief.title);
  });

  it("parses a complete framework-free static artifact JSON object", () => {
    const parsed = parseBuilderStaticArtifactsOutput(JSON.stringify(validArtifacts()));

    expect(parsed.indexHtml).toContain("<main");
    expect(parsed.indexHtml).toContain('href="styles.css"');
    expect(parsed.indexHtml).toContain('src="script.js"');
    expect(parsed.stylesCss).toContain(":root");
    expect(parsed.scriptJs).toContain("lp-agent-track");
  });

  it("rejects empty output with a stable reason", () => {
    const error = captureParseError("   ");

    expect(error.reason).toBe("empty_output");
    expect(toStaticArtifactParseFailurePayload(error)).toEqual({
      role: "builder",
      schema: "StaticArtifactsSchema",
      reason: "empty_output"
    });
  });

  it("rejects Markdown-fenced JSON in V0", () => {
    const error = captureParseError(`\`\`\`json\n${JSON.stringify(validArtifacts())}\n\`\`\``);

    expect(error.reason).toBe("invalid_json");
    expect(toStaticArtifactParseFailurePayload(error)).toEqual({
      role: "builder",
      schema: "StaticArtifactsSchema",
      reason: "invalid_json"
    });
  });

  it("rejects invalid JSON without exposing raw output", () => {
    const error = captureParseError("{ not json } RAW_STATIC_ARTIFACT_SECRET");
    const payload = toStaticArtifactParseFailurePayload(error);

    expect(error.reason).toBe("invalid_json");
    expect(JSON.stringify(payload)).not.toContain("RAW_STATIC_ARTIFACT_SECRET");
  });

  it("rejects missing or empty artifact fields", () => {
    const error = captureParseError(JSON.stringify({
      indexHtml: validArtifacts().indexHtml,
      stylesCss: " ",
      scriptJs: validArtifacts().scriptJs
    }));

    expect(error.reason).toBe("schema_invalid");
    expect(toStaticArtifactParseFailurePayload(error)).toMatchObject({
      role: "builder",
      schema: "StaticArtifactsSchema",
      reason: "schema_invalid",
      firstIssuePath: "stylesCss",
      firstIssueCode: "too_small"
    });
  });

  it("rejects HTML without the required local stylesheet marker", () => {
    const error = captureParseError(JSON.stringify({
      ...validArtifacts(),
      indexHtml: validArtifacts().indexHtml.replace(
        '<link rel="stylesheet" href="styles.css">',
        ""
      )
    }));

    expect(error.reason).toBe("policy_violation");
    expect(error.policyCode).toBe("missing_stylesheet_marker");
  });

  it("rejects HTML without the required local script marker", () => {
    const error = captureParseError(JSON.stringify({
      ...validArtifacts(),
      indexHtml: validArtifacts().indexHtml.replace(
        '  <script src="script.js"></script>',
        ""
      )
    }));

    expect(error.reason).toBe("policy_violation");
    expect(error.policyCode).toBe("missing_script_marker");
  });

  it("rejects external JavaScript", () => {
    const error = captureParseError(JSON.stringify({
      ...validArtifacts(),
      indexHtml: validArtifacts().indexHtml.replace(
        '  <script src="script.js"></script>',
        '  <script src="https://cdn.example.com/widget.js"></script>\n  <script src="script.js"></script>'
      )
    }));

    expect(error.reason).toBe("policy_violation");
    expect(error.policyCode).toBe("external_script_blocked");
  });

  it("rejects javascript URLs and inline event handlers", () => {
    const javascriptUrlError = captureParseError(JSON.stringify({
      ...validArtifacts(),
      indexHtml: validArtifacts().indexHtml.replace("#products", "javascript:alert(1)")
    }));
    expect(javascriptUrlError.policyCode).toBe("javascript_url_blocked");

    const inlineHandlerError = captureParseError(JSON.stringify({
      ...validArtifacts(),
      indexHtml: validArtifacts().indexHtml.replace("<img ", "<img onerror=\"alert(1)\" ")
    }));
    expect(inlineHandlerError.policyCode).toBe("inline_event_handler_blocked");
  });

  it("rejects common framework and build output markers", () => {
    const cases = [
      "__NEXT_DATA__",
      "data-reactroot",
      "ng-version",
      "id=\"__nuxt\"",
      "/@vite/client",
      "webpackJsonp",
      "node_modules/vue/dist/vue.global.js"
    ];

    for (const marker of cases) {
      const error = captureParseError(JSON.stringify({
        ...validArtifacts(),
        indexHtml: validArtifacts().indexHtml.replace("</body>", `${marker}</body>`)
      }));
      expect(error.reason).toBe("policy_violation");
      expect(error.policyCode).toBe("framework_marker_detected");
    }
  });

  it("rejects CSS framework links", () => {
    const error = captureParseError(JSON.stringify({
      ...validArtifacts(),
      indexHtml: validArtifacts().indexHtml.replace(
        '<link rel="stylesheet" href="styles.css">',
        '<link rel="stylesheet" href="styles.css">\n  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">'
      )
    }));

    expect(error.reason).toBe("policy_violation");
    expect(error.policyCode).toBe("css_framework_blocked");
  });

  it("allows external images, font CSS, and non-framework CSS links", () => {
    const artifacts = validArtifacts();
    const parsed = parseBuilderStaticArtifactsOutput(JSON.stringify(artifacts));

    expect(parsed.indexHtml).toContain("https://cdn.example.com/product.jpg");
    expect(parsed.indexHtml).toContain("https://fonts.googleapis.com/css2?family=Inter");
    expect(parsed.indexHtml).toContain("https://assets.example.com/brand/campaign.css");
  });

  it("creates a sanitized parse success payload", () => {
    expect(toStaticArtifactParseSuccessPayload(validArtifacts())).toEqual({
      role: "builder",
      schema: "StaticArtifactsSchema",
      artifactKind: "three-file-static",
      htmlBytes: Buffer.byteLength(validArtifacts().indexHtml, "utf8"),
      cssBytes: Buffer.byteLength(validArtifacts().stylesCss, "utf8"),
      jsBytes: Buffer.byteLength(validArtifacts().scriptJs, "utf8"),
      hasExternalCss: true,
      hasExternalImages: true
    });
  });
});

function captureParseError(output: string): BuilderStaticArtifactParseError {
  try {
    parseBuilderStaticArtifactsOutput(output);
  } catch (error) {
    if (error instanceof BuilderStaticArtifactParseError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected parse to fail");
}

function validArtifacts() {
  return {
    indexHtml: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Model Built LP</title>
  <meta name="description" content="A model-built static landing page.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
  <link rel="stylesheet" href="https://assets.example.com/brand/campaign.css">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main>
    <section class="hero">
      <h1>Model Built LP</h1>
      <p>Static artifact output.</p>
      <a href="#products" data-track="cta:hero">Shop now</a>
      <img src="https://cdn.example.com/product.jpg" alt="Product">
    </section>
    <section id="products"><h2>Products</h2></section>
  </main>
  <script src="script.js"></script>
</body>
</html>`,
    stylesCss: `:root { --color-primary: #0f766e; }
body { margin: 0; font-family: Inter, system-ui, sans-serif; }
.hero { padding: 64px 24px; }`,
    scriptJs: `document.querySelectorAll("[data-track]").forEach((element) => {
  element.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("lp-agent-track"));
  });
});`
  };
}
```

- [ ] **Step 2: Include the new parser test in the API package script**

Modify `packages/api/package.json`:

```json
{
  "scripts": {
    "test": "vitest run src/structured-lp-brief.test.ts src/structured-static-artifacts.test.ts src/run-orchestrator.test.ts src/services.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

Keep every other field unchanged.

- [ ] **Step 3: Run the parser test to verify it fails**

Run:

```bash
pnpm --filter @lp-agent/api exec vitest run src/structured-static-artifacts.test.ts
```

Expected: FAIL because `./structured-static-artifacts` does not exist yet.

- [ ] **Step 4: Commit the red tests**

```bash
git add packages/api/package.json packages/api/src/structured-static-artifacts.test.ts
git commit -m "test structured static artifact parser"
```

---

## Task 2: Implement Structured Static Artifact Parser and Prompt Helpers

**Files:**
- Create: `packages/api/src/structured-static-artifacts.ts`
- Test: `packages/api/src/structured-static-artifacts.test.ts`

- [ ] **Step 1: Add the parser and prompt helper implementation**

Create `packages/api/src/structured-static-artifacts.ts`:

```ts
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

const REQUIRED_STYLESHEET_MARKER = '<link rel="stylesheet" href="styles.css">';
const REQUIRED_SCRIPT_MARKER = '  <script src="script.js"></script>';

const FRAMEWORK_MARKERS: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /__NEXT_DATA__/i, code: "framework_marker_detected" },
  { pattern: /data-reactroot/i, code: "framework_marker_detected" },
  { pattern: /react-dom/i, code: "framework_marker_detected" },
  { pattern: /vue\.(?:global|runtime|esm)|__vue__/i, code: "framework_marker_detected" },
  { pattern: /ng-version|@angular/i, code: "framework_marker_detected" },
  { pattern: /id\s*=\s*["']__nuxt["']|nuxt-app/i, code: "framework_marker_detected" },
  { pattern: /sveltekit/i, code: "framework_marker_detected" },
  { pattern: /\/@vite\/client/i, code: "framework_marker_detected" },
  { pattern: /\bwebpackJsonp\b/i, code: "framework_marker_detected" },
  { pattern: /\/_next\//i, code: "framework_marker_detected" },
  { pattern: /node_modules/i, code: "framework_marker_detected" },
  { pattern: /(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(?:react|react-dom|vue|@angular|svelte)/i, code: "framework_marker_detected" }
];

const CSS_FRAMEWORK_HREFS = [
  /bootstrap/i,
  /tailwind/i,
  /bulma/i,
  /foundation/i,
  /materialize/i,
  /ant(?:d|-design)/i,
  /semantic-ui/i,
  /uikit/i
];

export function createStructuredStaticArtifactsBuilderPrompt(brief: LPBrief): string {
  return [
    "You are the Builder for an LP Engineering Team Agent.",
    "Return exactly one JSON object with these string keys: indexHtml, stylesCss, scriptJs.",
    "Do not wrap the JSON in Markdown fences.",
    "Do not include prose before or after the JSON.",
    "Build Framework-free static HTML/CSS/JS only.",
    "Do not include React, Vue, Angular, Svelte, Next, Nuxt, SvelteKit, Vite, Webpack, package manifests, or build steps.",
    "indexHtml must be a complete HTML document and must include:",
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

  const candidate = parsedJson as Partial<Record<keyof StaticArtifacts, unknown>>;
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

function assertNonEmptyString(value: unknown, path: keyof StaticArtifacts): string {
  if (typeof value !== "string") {
    throw schemaInvalid(path, "invalid_type");
  }
  if (value.trim().length === 0) {
    throw schemaInvalid(path, "too_small");
  }
  return value;
}

function schemaInvalid(path: string, code: string): BuilderStaticArtifactParseError {
  return new BuilderStaticArtifactParseError({
    reason: "schema_invalid",
    issueSummary: {
      issueCount: 1,
      firstIssuePath: path,
      firstIssueCode: code
    }
  });
}

function validateArtifactPolicy(artifacts: StaticArtifacts): void {
  const html = artifacts.indexHtml;
  const combined = [artifacts.indexHtml, artifacts.stylesCss, artifacts.scriptJs].join("\n");
  const lowerHtml = html.toLowerCase();

  if (!lowerHtml.includes("<!doctype") || !lowerHtml.includes("<html") || !lowerHtml.includes("<head") || !lowerHtml.includes("<body")) {
    throw policyViolation("html_document_invalid");
  }
  if (!/<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*>/i.test(html)) {
    throw policyViolation("html_document_invalid");
  }
  if (!html.includes(REQUIRED_STYLESHEET_MARKER)) {
    throw policyViolation("missing_stylesheet_marker");
  }
  if (!html.includes(REQUIRED_SCRIPT_MARKER)) {
    throw policyViolation("missing_script_marker");
  }
  if (/javascript\s*:/i.test(combined)) {
    throw policyViolation("javascript_url_blocked");
  }
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) {
    throw policyViolation("inline_event_handler_blocked");
  }
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    const src = getAttributeValue(tag, "src");
    if (src && src !== "script.js") {
      throw policyViolation("external_script_blocked");
    }
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = getAttributeValue(tag, "rel")?.toLowerCase();
    const href = getAttributeValue(tag, "href");
    if (rel === "stylesheet" && href && href !== "styles.css" && isCssFrameworkHref(href)) {
      throw policyViolation("css_framework_blocked");
    }
  }
  for (const marker of FRAMEWORK_MARKERS) {
    if (marker.pattern.test(combined)) {
      throw policyViolation(marker.code);
    }
  }
}

function policyViolation(policyCode: string): BuilderStaticArtifactParseError {
  return new BuilderStaticArtifactParseError({
    reason: "policy_violation",
    policyCode
  });
}

function getAttributeValue(tag: string, attribute: string): string | undefined {
  const pattern = new RegExp(`${attribute}\\s*=\\s*([\"'])(.*?)\\1`, "i");
  return tag.match(pattern)?.[2];
}

function isCssFrameworkHref(href: string): boolean {
  return CSS_FRAMEWORK_HREFS.some((pattern) => pattern.test(href));
}

function hasExternalStylesheet(html: string): boolean {
  return (html.match(/<link\b[^>]*>/gi) ?? []).some((tag) => {
    const rel = getAttributeValue(tag, "rel")?.toLowerCase();
    const href = getAttributeValue(tag, "href");
    return rel === "stylesheet" && !!href && href !== "styles.css" && /^(?:https?:)?\/\//i.test(href);
  });
}

function hasExternalImage(html: string): boolean {
  return (html.match(/<img\b[^>]*>/gi) ?? []).some((tag) => {
    const src = getAttributeValue(tag, "src");
    return !!src && /^(?:https?:)?\/\//i.test(src);
  });
}
```

- [ ] **Step 2: Run parser tests**

Run:

```bash
pnpm --filter @lp-agent/api exec vitest run src/structured-static-artifacts.test.ts
pnpm --filter @lp-agent/api typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit implementation**

```bash
git add packages/api/src/structured-static-artifacts.ts packages/api/src/structured-static-artifacts.test.ts
git commit -m "add structured static artifact parser"
```

---

## Task 3: Broaden Runtime Events for Builder Parse Events

**Files:**
- Modify: `packages/runtime-adapters/src/index.ts`
- Modify: `packages/runtime-adapters/src/index.test.ts`

- [ ] **Step 1: Add a runtime event contract test**

In `packages/runtime-adapters/src/index.test.ts`, add this test after the existing contract export test:

```ts
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
```

- [ ] **Step 2: Run typecheck to verify the event contract fails**

Run:

```bash
pnpm --filter @lp-agent/runtime-adapters typecheck
```

Expected: FAIL because the current `RuntimeEvent` union only allows `LPBriefSchema` parse events.

- [ ] **Step 3: Broaden `RuntimeEvent` variants**

In `packages/runtime-adapters/src/index.ts`, replace the existing `model.output.parsed` variant with two explicit variants:

```ts
  | {
      type: "model.output.parsed";
      message: string;
      runId?: string;
      role?: AgentRole;
      schema: "LPBriefSchema";
      title: string;
      sectionCount: number;
      productCount: number;
      hasAssets: boolean;
    }
  | {
      type: "model.output.parsed";
      message: string;
      runId?: string;
      role?: AgentRole;
      schema: "StaticArtifactsSchema";
      artifactKind: "three-file-static";
      htmlBytes: number;
      cssBytes: number;
      jsBytes: number;
      hasExternalCss: boolean;
      hasExternalImages: boolean;
    }
```

Replace the existing `model.output.parse_failed` variant with:

```ts
  | {
      type: "model.output.parse_failed";
      message: string;
      runId?: string;
      role?: AgentRole;
      schema: "LPBriefSchema" | "StaticArtifactsSchema";
      reason: "empty_output" | "invalid_json" | "schema_invalid" | "policy_violation";
      policyCode?: string;
      issueCount?: number;
      firstIssuePath?: string;
      firstIssueCode?: string;
    }
```

- [ ] **Step 4: Run runtime verification**

Run:

```bash
pnpm --filter @lp-agent/runtime-adapters test
pnpm --filter @lp-agent/runtime-adapters typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit runtime event support**

```bash
git add packages/runtime-adapters/src/index.ts packages/runtime-adapters/src/index.test.ts
git commit -m "support static artifact parse events"
```

---

## Task 4: Add API Real Builder Artifact Red Tests

**Files:**
- Modify: `packages/api/src/services.test.ts`

- [ ] **Step 1: Add a real-runtime Builder success test**

In `packages/api/src/services.test.ts`, add this test after the existing real-runtime Planner parse failure test and before `keeps deterministic runtime unless REAL_MODEL_RUNTIME is explicitly enabled`:

```ts
  it("uses parsed real Builder artifacts when REAL_MODEL_RUNTIME is enabled", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const modelBrief = {
      ...sampleBrief,
      title: "Model Planned Landing Page",
      sections: sampleBrief.sections.map((section, index) => ({
        ...section,
        id: `model_section_${index + 1}`
      }))
    };
    const modelArtifacts = completeModelArtifacts();
    const responseQueue = [
      JSON.stringify({
        id: "chatcmpl_planner",
        model: "glm-5.1",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify(modelBrief) },
            finish_reason: "stop"
          }
        ],
        usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 }
      }),
      JSON.stringify({
        id: "chatcmpl_builder",
        model: "glm-5.1",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify(modelArtifacts) },
            finish_reason: "stop"
          }
        ],
        usage: { prompt_tokens: 20, completion_tokens: 80, total_tokens: 100 }
      })
    ];
    const fetchCalls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fakeFetch: ModelFetch = async (input, init) => {
      fetchCalls.push({ input, init });
      const body = responseQueue.shift();
      if (!body) {
        throw new Error("unexpected_fetch_call");
      }
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    const service = new DemoWorkbenchService({
      repositories,
      now: fixedClock(),
      env: {
        REAL_MODEL_RUNTIME: "1",
        OPENAI_COMPATIBLE_API_KEY: "sk-test-secret"
      },
      modelFetch: fakeFetch
    });
    const project = await service.createProject({ name: "Project" });
    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "zhipu_openai",
      name: "智谱 OpenAI Compatible",
      provider: "custom",
      api: "openai-completions",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
      modelId: "glm-5.1"
    });
    await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "planner",
      providerId: provider.id,
      model: "glm-5.1"
    });
    await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "builder",
      providerId: provider.id,
      model: "glm-5.1"
    });

    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Generate a landing page brief."
    });
    const pageVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });

    expect(fetchCalls).toHaveLength(2);
    expect(pageVersion.artifacts).toEqual(modelArtifacts);
    expect(pageVersion.artifacts.indexHtml).toContain("MODEL_BUILDER_ARTIFACT_SECRET");
    expect(pageVersion.artifacts.indexHtml).not.toContain("Spring essentials, ready today");

    const builderRequestBody = JSON.parse(String(fetchCalls[1]?.init?.body));
    expect(builderRequestBody.model).toBe("glm-5.1");
    expect(builderRequestBody.messages).toHaveLength(1);
    expect(builderRequestBody.messages[0]).toMatchObject({ role: "user" });
    expect(builderRequestBody.messages[0].content).toContain("Return exactly one JSON object");
    expect(builderRequestBody.messages[0].content).toContain("indexHtml");
    expect(builderRequestBody.messages[0].content).toContain("stylesCss");
    expect(builderRequestBody.messages[0].content).toContain("scriptJs");
    expect(builderRequestBody.messages[0].content).toContain("Do not include React, Vue, Angular, Svelte");
    expect(builderRequestBody.messages[0].content).toContain("Model Planned Landing Page");

    const events = await repositories.runEvents.listForProject(project.id);
    const builderEvents = events.filter((event) => event.runId === "run_builder_version_1");
    expect(builderEvents.map((event) => event.type)).toEqual([
      "run.started",
      "runtime.context.loaded",
      "model.completed",
      "artifact.created",
      "model.output.parsed",
      "run.completed"
    ]);
    expect(builderEvents.find((event) => event.type === "model.output.parsed")).toMatchObject({
      runId: "run_builder_version_1",
      type: "model.output.parsed",
      message: "Builder output parsed as static artifacts",
      payload: expect.objectContaining({
        role: "builder",
        schema: "StaticArtifactsSchema",
        artifactKind: "three-file-static",
        hasExternalCss: true,
        hasExternalImages: true
      })
    });
    const serializedBuilderEvents = JSON.stringify(builderEvents);
    expect(serializedBuilderEvents).not.toContain("MODEL_BUILDER_ARTIFACT_SECRET");
    expect(serializedBuilderEvents).not.toContain(modelArtifacts.stylesCss);
    expect(serializedBuilderEvents).not.toContain(modelArtifacts.scriptJs);
    expect(serializedBuilderEvents).not.toContain("sk-test-secret");
    expect(serializedBuilderEvents).not.toContain("OPENAI_COMPATIBLE_API_KEY");
    expect(serializedBuilderEvents).not.toContain("https://open.bigmodel.cn");
  });
```

- [ ] **Step 2: Add a real-runtime Builder failure test**

In the same section of `packages/api/src/services.test.ts`, add:

```ts
  it("fails closed when real Builder output violates static artifact policy", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const modelBrief = {
      ...sampleBrief,
      title: "Model Planned Landing Page"
    };
    const responseQueue = [
      JSON.stringify({
        id: "chatcmpl_planner",
        model: "glm-5.1",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify(modelBrief) },
            finish_reason: "stop"
          }
        ],
        usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 }
      }),
      JSON.stringify({
        id: "chatcmpl_builder",
        model: "glm-5.1",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({
                ...completeModelArtifacts(),
                indexHtml: completeModelArtifacts().indexHtml.replace(
                  '  <script src="script.js"></script>',
                  '  <script src="https://cdn.example.com/RAW_STATIC_ARTIFACT_SECRET.js"></script>\n  <script src="script.js"></script>'
                )
              })
            },
            finish_reason: "stop"
          }
        ],
        usage: { prompt_tokens: 20, completion_tokens: 80, total_tokens: 100 }
      })
    ];
    const fakeFetch: ModelFetch = async () => {
      const body = responseQueue.shift();
      if (!body) {
        throw new Error("unexpected_fetch_call");
      }
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    const service = new DemoWorkbenchService({
      repositories,
      now: fixedClock(),
      env: {
        REAL_MODEL_RUNTIME: "1",
        OPENAI_COMPATIBLE_API_KEY: "sk-test-secret"
      },
      modelFetch: fakeFetch
    });
    const project = await service.createProject({ name: "Project" });
    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "zhipu_openai",
      name: "智谱 OpenAI Compatible",
      provider: "custom",
      api: "openai-completions",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
      modelId: "glm-5.1"
    });
    await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "planner",
      providerId: provider.id,
      model: "glm-5.1"
    });
    await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "builder",
      providerId: provider.id,
      model: "glm-5.1"
    });

    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Generate a landing page brief."
    });
    await expect(
      service.generatePageVersion({
        projectId: project.id,
        briefId: brief.id
      })
    ).rejects.toThrow("Builder run failed.");

    await expect(repositories.pageVersions.listAll()).resolves.toEqual([]);
    await expect(repositories.runs.listForProject(project.id)).resolves.toEqual([
      expect.objectContaining({ id: "run_planner_brief_1", state: "completed" }),
      expect.objectContaining({
        id: "run_builder_version_1",
        projectId: project.id,
        role: "builder",
        state: "failed",
        completedAt: expect.any(String)
      })
    ]);
    const events = await repositories.runEvents.listForProject(project.id);
    const builderEvents = events.filter((event) => event.runId === "run_builder_version_1");
    expect(builderEvents.map((event) => event.type)).toEqual([
      "run.started",
      "runtime.context.loaded",
      "model.completed",
      "model.output.parse_failed",
      "run.failed"
    ]);
    expect(builderEvents.find((event) => event.type === "model.output.parse_failed")).toMatchObject({
      runId: "run_builder_version_1",
      type: "model.output.parse_failed",
      message: "Builder output could not be parsed as static artifacts",
      payload: expect.objectContaining({
        role: "builder",
        schema: "StaticArtifactsSchema",
        reason: "policy_violation",
        policyCode: "external_script_blocked"
      })
    });
    const serializedBuilderEvents = JSON.stringify(builderEvents);
    expect(serializedBuilderEvents).not.toContain("RAW_STATIC_ARTIFACT_SECRET");
    expect(serializedBuilderEvents).not.toContain("MODEL_BUILDER_ARTIFACT_SECRET");
    expect(serializedBuilderEvents).not.toContain("OPENAI_COMPATIBLE_API_KEY");
    expect(serializedBuilderEvents).not.toContain("https://open.bigmodel.cn");
  });
```

- [ ] **Step 3: Add the model artifact helper**

Near the existing `completeArtifacts()` helper at the bottom of `packages/api/src/services.test.ts`, add:

```ts
function completeModelArtifacts(): StaticArtifacts {
  return {
    indexHtml: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Model Built LP</title>
  <meta name="description" content="MODEL_BUILDER_ARTIFACT_SECRET static LP.">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
  <link rel="stylesheet" href="https://assets.example.com/brand/campaign.css">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main>
    <section class="hero">
      <h1>MODEL_BUILDER_ARTIFACT_SECRET</h1>
      <p>Model generated static LP artifacts.</p>
      <a href="#products" data-track="cta:hero">Shop now</a>
      <img src="https://cdn.example.com/product.jpg" alt="Product">
    </section>
    <section id="products"><h2>Products</h2></section>
  </main>
  <script src="script.js"></script>
</body>
</html>`,
    stylesCss: `:root { --color-primary: #0f766e; }
body { margin: 0; font-family: Inter, system-ui, sans-serif; }
.hero { padding: 64px 24px; }`,
    scriptJs: `document.querySelectorAll("[data-track]").forEach((element) => {
  element.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("lp-agent-track"));
  });
});`
  };
}
```

- [ ] **Step 4: Run the service tests to verify they fail**

Run:

```bash
pnpm --filter @lp-agent/api exec vitest run src/services.test.ts
```

Expected: FAIL because `generatePageVersion()` still saves deterministic artifacts and does not parse Builder `modelOutputText`.

- [ ] **Step 5: Commit the red API tests**

```bash
git add packages/api/src/services.test.ts
git commit -m "test real builder static artifact parsing"
```

---

## Task 5: Wire Real Builder Artifact Parsing Into API Service

**Files:**
- Modify: `packages/api/src/index.ts`
- Test: `packages/api/src/services.test.ts`

- [ ] **Step 1: Import structured static artifact helpers**

In `packages/api/src/index.ts`, add this import near the existing structured LP brief import:

```ts
import {
  BuilderStaticArtifactParseError,
  createStructuredStaticArtifactsBuilderPrompt,
  parseBuilderStaticArtifactsOutput,
  toStaticArtifactParseFailurePayload,
  toStaticArtifactParseSuccessPayload
} from "./structured-static-artifacts";
```

- [ ] **Step 2: Track structured Builder output mode**

In `DemoWorkbenchService`, add this field near `structuredPlannerOutputEnabled`:

```ts
  private readonly structuredBuilderOutputEnabled: boolean;
```

In the constructor, after `this.structuredPlannerOutputEnabled = env.REAL_MODEL_RUNTIME === "1";`, add:

```ts
    this.structuredBuilderOutputEnabled = env.REAL_MODEL_RUNTIME === "1";
```

- [ ] **Step 3: Add Builder parse event helpers**

In `packages/api/src/index.ts`, add these helpers near the existing parse event helpers:

```ts
function toBuilderParseSuccessEvent(input: {
  result: RuntimeRunResult;
  artifacts: StaticArtifacts;
}): RuntimeEvent {
  const payload = toStaticArtifactParseSuccessPayload(input.artifacts);
  return {
    ...payload,
    type: "model.output.parsed",
    message: "Builder output parsed as static artifacts",
    runId: input.result.runId,
    role: "builder",
    schema: "StaticArtifactsSchema",
    artifactKind: "three-file-static",
    htmlBytes: Buffer.byteLength(input.artifacts.indexHtml, "utf8"),
    cssBytes: Buffer.byteLength(input.artifacts.stylesCss, "utf8"),
    jsBytes: Buffer.byteLength(input.artifacts.scriptJs, "utf8"),
    hasExternalCss: Boolean(payload.hasExternalCss),
    hasExternalImages: Boolean(payload.hasExternalImages)
  };
}

function failBuilderResultForParseError(input: {
  result: RuntimeRunResult;
  error: BuilderStaticArtifactParseError;
}): RuntimeRunResult {
  const issueSummary = input.error.issueSummary;
  return {
    ...input.result,
    state: "failed",
    artifacts: undefined,
    events: [
      ...input.result.events.filter(
        (event) => event.type !== "run.completed" && event.type !== "artifact.created"
      ),
      {
        ...toStaticArtifactParseFailurePayload(input.error),
        type: "model.output.parse_failed",
        message: "Builder output could not be parsed as static artifacts",
        runId: input.result.runId,
        role: "builder",
        schema: "StaticArtifactsSchema",
        reason: input.error.reason,
        ...(input.error.policyCode ? { policyCode: input.error.policyCode } : {}),
        ...(issueSummary.issueCount !== undefined
          ? { issueCount: issueSummary.issueCount }
          : {}),
        ...(issueSummary.firstIssuePath !== undefined
          ? { firstIssuePath: issueSummary.firstIssuePath }
          : {}),
        ...(issueSummary.firstIssueCode !== undefined
          ? { firstIssueCode: issueSummary.firstIssueCode }
          : {})
      },
      {
        type: "run.failed",
        message: "Builder run failed.",
        runId: input.result.runId,
        role: "builder",
        state: "failed",
        errorName: input.error.name
      }
    ]
  };
}
```

- [ ] **Step 4: Add structured Builder finalization inside `generatePageVersion()`**

In `DemoWorkbenchService.generatePageVersion()`, after loading `brief` and reserving `pageVersionId`, add:

```ts
    let parsedBuilderArtifacts: StaticArtifacts | undefined;
    const builderPrompt = this.structuredBuilderOutputEnabled
      ? createStructuredStaticArtifactsBuilderPrompt(brief.brief)
      : brief.prompt;
```

In the `runAgentStep()` call for the Builder, change:

```ts
        input: {
          brief: copyBrief(brief.brief),
          prompt: brief.prompt
        },
        now: this.now
```

to:

```ts
        input: {
          brief: copyBrief(brief.brief),
          prompt: builderPrompt
        },
        now: this.now,
        finalizeResult: this.structuredBuilderOutputEnabled
          ? ({ result }) => {
              if (result.state !== "completed") {
                return result;
              }
              try {
                parsedBuilderArtifacts = parseBuilderStaticArtifactsOutput(
                  result.modelOutputText ?? ""
                );
                return {
                  ...result,
                  artifacts: parsedBuilderArtifacts,
                  events: addEventBeforeRunCompleted(
                    result.events,
                    toBuilderParseSuccessEvent({
                      result,
                      artifacts: parsedBuilderArtifacts
                    })
                  )
                };
              } catch (error) {
                if (error instanceof BuilderStaticArtifactParseError) {
                  return failBuilderResultForParseError({ result, error });
                }
                throw error;
              }
            }
          : undefined
```

After the existing run state checks, replace:

```ts
      if (!result.artifacts) {
        throw new Error("Builder run did not return artifacts.");
      }
      if (!hasCompleteArtifacts(result.artifacts)) {
        throw new Error("Builder run returned incomplete artifacts.");
      }
      const artifacts = result.artifacts;
```

with:

```ts
      const artifacts = this.structuredBuilderOutputEnabled
        ? parsedBuilderArtifacts
        : result.artifacts;
      if (!artifacts) {
        throw new Error("Builder run did not return artifacts.");
      }
      if (!hasCompleteArtifacts(artifacts)) {
        throw new Error("Builder run returned incomplete artifacts.");
      }
```

This explicit guard prevents real Builder mode from silently falling back to deterministic runtime artifacts if parser finalization fails to set `parsedBuilderArtifacts`.

- [ ] **Step 5: Run API verification**

Run:

```bash
pnpm --filter @lp-agent/api test
pnpm --filter @lp-agent/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit API wiring**

```bash
git add packages/api/src/index.ts packages/api/src/services.test.ts
git commit -m "parse real builder output into static artifacts"
```

---

## Task 6: Update Docs and Run Final Verification

**Files:**
- Modify: `docs/superpowers/README.md`
- Modify: `docs/agent-development-learning.md`

- [ ] **Step 1: Ensure this implementation plan is indexed**

In `docs/superpowers/README.md`, ensure this item exists immediately after `specs/2026-05-14-real-builder-static-artifacts-design.md`:

```md
33. `plans/2026-05-14-real-builder-static-artifacts.md`
   - Stage 3 real Builder static artifacts implementation plan.
   - Read this after the real Builder static artifacts design when implementing strict Builder artifact JSON prompts, static artifact parsing, framework/resource policy validation, sanitized Builder parse events, and fail-closed real-runtime behavior.
```

If the numbering changed because another document was added, keep the order correct and renumber later entries.

- [ ] **Step 2: Update the learning document status**

In `docs/agent-development-learning.md`, under `下一步真实 Builder 静态产物输出设计：`, ensure this line exists:

```md
- 当前实现计划：[2026-05-14-real-builder-static-artifacts.md](./superpowers/plans/2026-05-14-real-builder-static-artifacts.md)
```

After implementation is complete, change the heading to:

```md
已实现的真实 Builder 静态产物输出设计：
```

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm --filter @lp-agent/api test
pnpm --filter @lp-agent/runtime-adapters test
pnpm --filter @lp-agent/artifacts test
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all commands pass. The real provider integration tests remain skipped unless `REAL_MODEL_PROVIDER_TEST=1` is present.

- [ ] **Step 4: Commit docs if changed**

```bash
git add docs/superpowers/README.md docs/agent-development-learning.md
git commit -m "document real builder static artifacts implementation"
```

If both files were already current and `git diff --cached --quiet` reports no staged docs changes, do not create an empty commit.

---

## Acceptance Checklist

- [ ] `parseBuilderStaticArtifactsOutput()` accepts valid framework-free three-file static artifact JSON.
- [ ] Parser rejects empty, invalid, fenced, schema-invalid, framework-dependent, and unsafe output.
- [ ] Builder prompt asks for strict JSON with `indexHtml`, `stylesCss`, and `scriptJs`.
- [ ] External images are allowed.
- [ ] External font CSS and non-framework CSS are allowed.
- [ ] External JavaScript is rejected.
- [ ] CSS framework links are rejected.
- [ ] React/Vue/Angular/Svelte/Next/Nuxt/Vite/Webpack markers are rejected.
- [ ] Real-runtime Builder success saves model-generated artifacts instead of deterministic artifacts.
- [ ] Real-runtime Builder failure saves no page version, marks the run failed, emits `model.output.parse_failed`, and does not persist `run.completed` or misleading `artifact.created`.
- [ ] Default deterministic runtime still uses `generateStaticArtifacts()`.
- [ ] Persisted events do not include raw generated HTML/CSS/JS, API keys, env var names, full base URLs, headers, or raw provider bodies.
- [ ] Web still receives canonical `StaticArtifacts` and can derive single-file HTML.
- [ ] LP artifacts remain framework-free static HTML/CSS/JS.
- [ ] `docs/superpowers/README.md` and `docs/agent-development-learning.md` remain accurate for future agents.
