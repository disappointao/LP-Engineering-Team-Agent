import { describe, expect, it } from "vitest";
import { sampleBrief } from "@lp-agent/lp-schema";
import { bundleSingleFileHtml, generateStaticArtifacts } from "./index";

describe("static artifact generation", () => {
  it("generates a framework-free three-file LP artifact", () => {
    const artifact = generateStaticArtifacts(sampleBrief);

    expect(artifact.indexHtml).toContain("<main");
    expect(artifact.indexHtml).toContain("Spring essentials, ready today");
    expect(artifact.indexHtml).toContain('href="styles.css"');
    expect(artifact.indexHtml).toContain('src="script.js"');
    expect(artifact.stylesCss).toContain(":root");
    expect(artifact.stylesCss).toContain("@media");
    expect(artifact.scriptJs).toContain("data-track");
    expect(artifact.indexHtml).not.toContain("react");
    expect(artifact.indexHtml).not.toContain("__NEXT_DATA__");
  });

  it("escapes user-controlled text before writing HTML", () => {
    const artifact = generateStaticArtifacts({
      ...sampleBrief,
      title: "<script>alert(1)</script>",
      sections: [
        {
          ...sampleBrief.sections[0]!,
          headline: "<img src=x onerror=alert(1)>"
        }
      ]
    });

    expect(artifact.indexHtml).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(artifact.indexHtml).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("bundles CSS and JS into a single HTML document", () => {
    const artifact = generateStaticArtifacts(sampleBrief);
    const bundled = bundleSingleFileHtml(artifact);

    expect(bundled).toContain("<style>");
    expect(bundled).toContain("<script>");
    expect(bundled).not.toContain('href="styles.css"');
    expect(bundled).not.toContain('src="script.js"');
  });
});
