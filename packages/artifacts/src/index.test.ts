import { describe, expect, it } from "vitest";
import { sampleBrief } from "@lp-agent/lp-schema";
import {
  bundleSingleFileHtml,
  createArtifactWorkspaceManifest,
  createStaticArtifactWorkspaceFiles,
  type ArtifactWorkspaceFileRecord,
  generateStaticArtifacts,
  staticArtifactsFromWorkspaceFiles
} from "./index";

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

describe("artifact workspace helpers", () => {
  const createdAt = "2026-05-18T00:00:00.000Z";

  it("creates deterministic workspace files from static artifacts", () => {
    const artifacts = {
      indexHtml: "<!doctype html><html><body>LP</body></html>",
      stylesCss: "body { margin: 0; }",
      scriptJs: "console.log('ready');"
    };

    const files = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      artifacts,
      createdAt
    });

    expect(files.map((file) => file.path)).toEqual([
      "index.html",
      "styles.css",
      "script.js"
    ]);
    expect(files[0]).toMatchObject({
      id: "artifact_workspace_1_file_index_html",
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      path: "index.html",
      kind: "html",
      mimeType: "text/html",
      sizeBytes: Buffer.byteLength(artifacts.indexHtml, "utf8"),
      summary: "index.html static LP file",
      content: artifacts.indexHtml,
      createdAt,
      updatedAt: createdAt
    });
    expect(files[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("sets page version id on each workspace file when provided", () => {
    const files = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      pageVersionId: "version_1",
      artifacts: {
        indexHtml: "<!doctype html><html><body>LP</body></html>",
        stylesCss: "body { margin: 0; }",
        scriptJs: "console.log('ready');"
      },
      createdAt
    });

    expect(files.map((file) => file.pageVersionId)).toEqual([
      "version_1",
      "version_1",
      "version_1"
    ]);
  });

  it("computes exact sha256 digests and UTF-8 byte sizes", () => {
    const files = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      artifacts: {
        indexHtml: "abc",
        stylesCss: "é",
        scriptJs: ""
      },
      createdAt
    });

    expect(files[0]?.sha256).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    expect(files[1]?.content.length).toBe(1);
    expect(files[1]?.sizeBytes).toBe(2);
  });

  it("creates metadata-only manifests without full content", () => {
    const rawSecret = "secret-token";
    const files = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      pageVersionId: "version_1",
      artifacts: {
        indexHtml: `<!doctype html><html><body>${rawSecret}</body></html>`,
        stylesCss: "body { margin: 0; }",
        scriptJs: `console.log("${rawSecret}");`
      },
      createdAt
    });

    const manifest = createArtifactWorkspaceManifest({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      pageVersionId: "version_1",
      files
    });

    expect(manifest).toMatchObject({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      pageVersionId: "version_1"
    });
    expect(manifest.files).toEqual([
      expect.objectContaining({ path: "index.html", kind: "html" }),
      expect.objectContaining({ path: "styles.css", kind: "css" }),
      expect.objectContaining({ path: "script.js", kind: "js" })
    ]);
    expect(JSON.stringify(manifest)).not.toContain(rawSecret);
    expect(JSON.stringify(manifest)).not.toContain("<!doctype html>");
    expect(JSON.stringify(manifest)).not.toContain("console.log");
  });

  it("derives manifest summaries from the static file allowlist", () => {
    const files = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      artifacts: {
        indexHtml: "<!doctype html><html><body>LP</body></html>",
        stylesCss: "body { margin: 0; }",
        scriptJs: "console.log('ready');"
      },
      createdAt
    }).map((file) => file.path === "index.html"
      ? { ...file, summary: "forged secret summary" }
      : file);

    const manifest = createArtifactWorkspaceManifest({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      files
    });

    expect(manifest.files[0]?.summary).toBe("index.html static LP file");
    expect(JSON.stringify(manifest)).not.toContain("forged secret summary");
  });

  it("rebuilds static artifacts from a complete workspace file set", () => {
    const artifacts = generateStaticArtifacts(sampleBrief);
    const files = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      artifacts,
      createdAt
    });

    expect(staticArtifactsFromWorkspaceFiles(files)).toEqual(artifacts);
  });

  it("throws a clear error for missing workspace files", () => {
    const artifacts = generateStaticArtifacts(sampleBrief);
    const files = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      artifacts,
      createdAt
    }).filter((file) => file.path !== "script.js");

    expect(() => staticArtifactsFromWorkspaceFiles(files)).toThrow(
      "Artifact workspace is incomplete: missing script.js."
    );
  });

  it("throws a clear error for mismatched workspace and project ids", () => {
    const artifacts = generateStaticArtifacts(sampleBrief);
    const files = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      artifacts,
      createdAt
    });

    expect(() => createArtifactWorkspaceManifest({
      workspaceId: "artifact_workspace_2",
      projectId: "project_1",
      files
    })).toThrow(
      "Artifact workspace file set workspaceId mismatch: expected artifact_workspace_2, received artifact_workspace_1."
    );
    expect(() => staticArtifactsFromWorkspaceFiles(files.map((file) => file.path === "styles.css"
      ? { ...file, projectId: "project_2" }
      : file))).toThrow(
      "Artifact workspace file projectId mismatch for styles.css: expected project_1, received project_2."
    );
  });

  it("throws a clear error for conflicting page version ids", () => {
    const artifacts = generateStaticArtifacts(sampleBrief);
    const files = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      pageVersionId: "version_1",
      artifacts,
      createdAt
    });

    expect(() => createArtifactWorkspaceManifest({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      pageVersionId: "version_2",
      files
    })).toThrow(
      "Artifact workspace file set pageVersionId mismatch: expected version_2, received version_1."
    );
    expect(() => staticArtifactsFromWorkspaceFiles(files.map((file) => file.path === "script.js"
      ? { ...file, pageVersionId: undefined }
      : file))).toThrow(
      "Artifact workspace file pageVersionId mismatch for script.js: expected version_1, received undefined."
    );
  });

  it("throws a clear error for kind and mime metadata mismatches", () => {
    const artifacts = generateStaticArtifacts(sampleBrief);
    const files = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      artifacts,
      createdAt
    });

    expect(() => createArtifactWorkspaceManifest({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      files: files.map((file) => file.path === "index.html"
        ? { ...file, kind: "css" }
        : file) as ArtifactWorkspaceFileRecord[]
    })).toThrow("Artifact workspace file kind mismatch for index.html: expected html, received css.");
    expect(() => staticArtifactsFromWorkspaceFiles(files.map((file) => file.path === "script.js"
      ? { ...file, mimeType: "text/css" }
      : file) as ArtifactWorkspaceFileRecord[])).toThrow(
      "Artifact workspace file mimeType mismatch for script.js: expected text/javascript, received text/css."
    );
  });

  it("throws a clear error for stale size and sha metadata", () => {
    const artifacts = generateStaticArtifacts(sampleBrief);
    const files = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      artifacts,
      createdAt
    });

    expect(() => createArtifactWorkspaceManifest({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      files: files.map((file) => file.path === "styles.css"
        ? { ...file, sizeBytes: file.sizeBytes + 1 }
        : file)
    })).toThrow("Artifact workspace file sizeBytes mismatch for styles.css.");
    expect(() => staticArtifactsFromWorkspaceFiles(files.map((file) => file.path === "script.js"
      ? { ...file, sha256: "0".repeat(64) }
      : file))).toThrow("Artifact workspace file sha256 mismatch for script.js.");
  });

  it("throws a clear error for unsupported workspace file paths", () => {
    const artifacts = generateStaticArtifacts(sampleBrief);
    const files = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      artifacts,
      createdAt
    });
    const unsupportedFiles = [
      ...files,
      {
        ...files[0]!,
        id: "artifact_workspace_1_file_assets_app_js",
        path: "assets/app.js"
      }
    ] as ArtifactWorkspaceFileRecord[];

    expect(() => createArtifactWorkspaceManifest({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      files: unsupportedFiles
    })).toThrow("Unsupported artifact workspace file path: assets/app.js.");
    expect(() => staticArtifactsFromWorkspaceFiles(unsupportedFiles)).toThrow(
      "Unsupported artifact workspace file path: assets/app.js."
    );
  });

  it("throws a clear error for absolute paths and path traversal", () => {
    const artifacts = generateStaticArtifacts(sampleBrief);
    const files = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      artifacts,
      createdAt
    });

    expect(() => createArtifactWorkspaceManifest({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      files: files.map((file) => file.path === "index.html"
        ? { ...file, path: "/tmp/index.html" }
        : file) as ArtifactWorkspaceFileRecord[]
    })).toThrow("Unsupported artifact workspace file path: /tmp/index.html.");
    expect(() => staticArtifactsFromWorkspaceFiles(files.map((file) => file.path === "styles.css"
      ? { ...file, path: "../styles.css" }
      : file) as ArtifactWorkspaceFileRecord[])).toThrow(
      "Unsupported artifact workspace file path: ../styles.css."
    );
  });
});
