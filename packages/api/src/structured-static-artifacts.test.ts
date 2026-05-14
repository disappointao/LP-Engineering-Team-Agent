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

  it("rejects missing required artifact fields", () => {
    const missingIndexHtmlError = captureParseError(JSON.stringify({
      stylesCss: validArtifacts().stylesCss,
      scriptJs: validArtifacts().scriptJs
    }));
    expect(toStaticArtifactParseFailurePayload(missingIndexHtmlError)).toMatchObject({
      role: "builder",
      schema: "StaticArtifactsSchema",
      reason: "schema_invalid",
      firstIssuePath: "indexHtml",
      firstIssueCode: "invalid_type"
    });

    const missingScriptJsError = captureParseError(JSON.stringify({
      indexHtml: validArtifacts().indexHtml,
      stylesCss: validArtifacts().stylesCss
    }));
    expect(toStaticArtifactParseFailurePayload(missingScriptJsError)).toMatchObject({
      role: "builder",
      schema: "StaticArtifactsSchema",
      reason: "schema_invalid",
      firstIssuePath: "scriptJs",
      firstIssueCode: "invalid_type"
    });
  });

  it("rejects non-string artifact fields", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["indexHtml", { ...validArtifacts(), indexHtml: 123 }],
      ["stylesCss", { ...validArtifacts(), stylesCss: ["body {}"] }],
      ["scriptJs", { ...validArtifacts(), scriptJs: { source: "console.log('x')" } }]
    ];

    for (const [fieldName, candidate] of cases) {
      const error = captureParseError(JSON.stringify(candidate));
      expect(toStaticArtifactParseFailurePayload(error)).toMatchObject({
        role: "builder",
        schema: "StaticArtifactsSchema",
        reason: "schema_invalid",
        firstIssuePath: fieldName,
        firstIssueCode: "invalid_type"
      });
    }
  });

  it("rejects extra artifact fields in V0", () => {
    const error = captureParseError(JSON.stringify({
      ...validArtifacts(),
      packageJson: "{\"scripts\":{\"build\":\"vite\"}}"
    }));

    expect(toStaticArtifactParseFailurePayload(error)).toMatchObject({
      role: "builder",
      schema: "StaticArtifactsSchema",
      reason: "schema_invalid",
      firstIssueCode: "unrecognized_keys"
    });
  });

  it("does not expose raw schema-invalid output in failure payloads", () => {
    const error = captureParseError(JSON.stringify({
      ...validArtifacts(),
      stylesCss: ["RAW_SCHEMA_STATIC_ARTIFACT_SECRET"]
    }));
    const payload = toStaticArtifactParseFailurePayload(error);

    expect(error.reason).toBe("schema_invalid");
    expect(JSON.stringify(payload)).not.toContain("RAW_SCHEMA_STATIC_ARTIFACT_SECRET");
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
      "data-svelte",
      "__SVELTEKIT",
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

  it("does not expose raw policy-violating output in failure payloads", () => {
    const error = captureParseError(JSON.stringify({
      ...validArtifacts(),
      indexHtml: validArtifacts().indexHtml.replace(
        "</body>",
        "<script src=\"https://cdn.example.com/RAW_POLICY_STATIC_ARTIFACT_SECRET.js\"></script></body>"
      )
    }));
    const payload = toStaticArtifactParseFailurePayload(error);

    expect(error.reason).toBe("policy_violation");
    expect(payload).toMatchObject({
      role: "builder",
      schema: "StaticArtifactsSchema",
      reason: "policy_violation",
      policyCode: "external_script_blocked"
    });
    expect(JSON.stringify(payload)).not.toContain("RAW_POLICY_STATIC_ARTIFACT_SECRET");
  });

  it("rejects CSS framework links", () => {
    const cssFrameworkLinks = [
      "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css",
      "https://cdn.tailwindcss.com"
    ];

    for (const href of cssFrameworkLinks) {
      const error = captureParseError(JSON.stringify({
        ...validArtifacts(),
        indexHtml: validArtifacts().indexHtml.replace(
          '<link rel="stylesheet" href="styles.css">',
          `<link rel="stylesheet" href="styles.css">\n  <link rel="stylesheet" href="${href}">`
        )
      }));

      expect(error.reason).toBe("policy_violation");
      expect(error.policyCode).toBe("css_framework_blocked");
    }
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
