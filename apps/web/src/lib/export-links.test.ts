import { describe, expect, it } from "vitest";
import type { StaticArtifacts } from "@lp-agent/artifacts";
import { createArtifactDownloadLinks } from "./export-links";

describe("artifact export links", () => {
  it("creates data URL download links for single-file and three-file LP exports", () => {
    const artifacts: StaticArtifacts = {
      indexHtml: [
        "<!doctype html><html><head>",
        "<link rel=\"stylesheet\" href=\"styles.css\">",
        "</head><body>",
        "  <script src=\"script.js\"></script>",
        "</body></html>"
      ].join(""),
      stylesCss: "body { color: #111827; }",
      scriptJs: "window.lpAgent = true;"
    };

    const links = createArtifactDownloadLinks(artifacts);

    expect(links.map((link) => link.filename)).toEqual([
      "index.single.html",
      "index.html",
      "styles.css",
      "script.js"
    ]);
    expect(links[0]?.label).toBe("Export Single HTML");
    expect(decodeURIComponent(links[0]?.href.split(",")[1] ?? "")).toContain("<style>");
    expect(decodeURIComponent(links[1]?.href.split(",")[1] ?? "")).toBe(artifacts.indexHtml);
    expect(decodeURIComponent(links[2]?.href.split(",")[1] ?? "")).toBe(artifacts.stylesCss);
    expect(decodeURIComponent(links[3]?.href.split(",")[1] ?? "")).toBe(artifacts.scriptJs);
  });
});
