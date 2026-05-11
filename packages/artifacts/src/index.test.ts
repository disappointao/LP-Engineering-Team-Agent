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

  it("sanitizes unsafe URLs and CSS tokens before output", () => {
    const artifact = generateStaticArtifacts({
      ...sampleBrief,
      brandProfile: {
        ...sampleBrief.brandProfile,
        colors: ["</style><script>alert(1)</script><style>", "javascript:alert(2)"],
        typography: "</style><script>alert(3)</script><style>"
      },
      cta: {
        ...sampleBrief.cta,
        href: "//evil.example/path"
      },
      sections: [
        {
          ...sampleBrief.sections[0]!,
          cta: {
            label: "Unsafe CTA",
            href: "javascript:alert(5)",
            intent: "test"
          }
        }
      ],
      productData: [
        {
          id: "product_unsafe",
          name: "Unsafe image",
          description: "Should not preserve unsafe image URLs.",
          imageUrl: "javascript:alert(6)"
        }
      ],
      seo: {
        ...sampleBrief.seo,
        socialImage: "javascript:alert(7)"
      }
    });
    const bundled = bundleSingleFileHtml(artifact);

    expect(artifact.indexHtml).not.toContain("javascript:");
    expect(artifact.stylesCss).not.toContain("</style>");
    expect(bundled).not.toContain("</style><script>");
    expect(artifact.indexHtml).toContain('href="#"');
  });

  it("bundles CSS and JS into a single HTML document", () => {
    const artifact = generateStaticArtifacts(sampleBrief);
    const bundled = bundleSingleFileHtml(artifact);

    expect(bundled).toContain("<style>");
    expect(bundled).toContain("<script>");
    expect(bundled).not.toContain('href="styles.css"');
    expect(bundled).not.toContain('src="script.js"');
  });

  it("escapes raw style and script closing tags during bundling", () => {
    const artifact = generateStaticArtifacts(sampleBrief);
    const bundled = bundleSingleFileHtml({
      indexHtml: artifact.indexHtml,
      stylesCss: "</style><script>alert(1)</script><style>",
      scriptJs: "</script><script>alert(2)</script>"
    });

    expect(bundled).not.toContain("</style><script>");
    expect(bundled).not.toContain("</script><script>");
    expect(bundled).toContain("<\\/style>");
    expect(bundled).toContain("<\\/script>");
  });

  it("throws when bundling HTML without expected asset markers", () => {
    expect(() =>
      bundleSingleFileHtml({
        indexHtml: "<!doctype html><html><head></head><body></body></html>",
        stylesCss: "",
        scriptJs: ""
      })
    ).toThrow("Cannot bundle HTML without expected stylesheet marker.");
  });
});
