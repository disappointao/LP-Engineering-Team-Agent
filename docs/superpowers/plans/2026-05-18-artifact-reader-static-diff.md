# Artifact Reader and Static Diff v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a controlled artifact workspace read boundary plus metadata-only static diffs for generated LP files.

**Architecture:** Add pure artifact file read and diff helpers in `@lp-agent/artifacts`, then wrap repository-backed ownership checks in a new API artifact reader module. Context Pack gains an explicit, bounded top-level `artifactSnippets` opt-in that is not passed to runtime/model requests by default.

**Tech Stack:** pnpm workspace, TypeScript, Vitest, existing artifact workspace repositories, Zod Context Pack schemas, existing deterministic runtime/model boundaries.

---

## Scope Guard

This plan implements Stage 15 only.

It does not add MCP execution, real deployment, real shell execution, desktop filesystem workspaces, file editing UI, line-level textual diff, binary asset support, object storage, or Postgres blob migration.

Generated LP output remains framework-free static HTML/CSS/JS.

## File Structure

- `packages/artifacts/src/index.ts`
  - Add canonical path normalization, single-file read result helpers, metadata-only diff types, and static workspace file diff helper.
- `packages/artifacts/src/index.test.ts`
  - Cover metadata-only reads, bounded content reads, size omission, path rejection, integrity rejection, and deterministic diff states.
- `packages/api/src/artifact-reader.ts`
  - New repository-backed reader/diff service helpers.
  - Owns fail-closed error codes and ownership validation for `projectId`, `workspaceId`, `pageVersionId`, and file records.
- `packages/api/src/artifact-reader.test.ts`
  - Cover API-level reader/diff behavior with in-memory repositories.
- `packages/api/src/index.ts`
  - Re-export reader types and add `DemoWorkbenchService` wrappers for internal callers.
- `packages/api/src/context-assembler.ts`
  - Add explicit optional artifact snippet requests and top-level `artifactSnippets` output.
  - Keep `runtimeContext` and model-facing context metadata-only by default.
- `packages/api/src/services.test.ts`
  - Cover default no-snippet behavior and runtime/model no-leak behavior through `runAgentStep`.
- `packages/runtime-adapters/src/index.test.ts`
  - Add a focused guard that runtime context cloning still whitelists artifact workspace metadata only.
- `packages/model-gateway/src/index.test.ts`
  - Add a focused guard that model audit context still whitelists artifact workspace metadata only.
- `docs/superpowers/README.md`
  - Add this implementation plan after the Stage 15 design.
- `docs/agent-development-learning.md`
  - Add the Stage 15 plan link and note that implementation is now planned.

## Task 1: Pure Artifact Reader and Diff Helpers

**Files:**

- Modify: `packages/artifacts/src/index.ts`
- Modify: `packages/artifacts/src/index.test.ts`

- [ ] **Step 1: Write failing tests for controlled file reads and diffs**

Add these imports in `packages/artifacts/src/index.test.ts`:

```ts
import {
  ARTIFACT_WORKSPACE_DEFAULT_READ_MAX_BYTES,
  diffArtifactWorkspaceFiles,
  normalizeArtifactWorkspaceFilePath,
  readArtifactWorkspaceFileRecord
} from "./index";
```

Add these tests inside `describe("artifact workspace helpers", () => { ... })`:

```ts
  it("reads workspace file metadata without content by default", () => {
    const [file] = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      pageVersionId: "version_1",
      artifacts: {
        indexHtml: "<!doctype html><html><body>secret-html</body></html>",
        stylesCss: "body { margin: 0; }",
        scriptJs: "console.log('ready');"
      },
      createdAt
    });

    const result = readArtifactWorkspaceFileRecord({ file: file! });

    expect(result).toEqual({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      pageVersionId: "version_1",
      file: {
        path: "index.html",
        kind: "html",
        mimeType: "text/html",
        sizeBytes: file!.sizeBytes,
        sha256: file!.sha256,
        summary: "index.html static LP file"
      },
      truncated: false,
      omittedReason: "content_not_requested"
    });
    expect(JSON.stringify(result)).not.toContain("secret-html");
  });

  it("reads bounded workspace file content when explicitly requested", () => {
    const files = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      artifacts: {
        indexHtml: "<!doctype html><html><body>LP</body></html>",
        stylesCss: "body { color: black; }",
        scriptJs: "console.log('ready');"
      },
      createdAt
    });
    const cssFile = files.find((file) => file.path === "styles.css")!;

    const result = readArtifactWorkspaceFileRecord({
      file: cssFile,
      includeContent: true,
      maxBytes: ARTIFACT_WORKSPACE_DEFAULT_READ_MAX_BYTES
    });

    expect(result.content).toBe("body { color: black; }");
    expect(result.truncated).toBe(false);
    expect(result.omittedReason).toBeUndefined();
  });

  it("omits content when explicit reads exceed the byte limit", () => {
    const files = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      artifacts: {
        indexHtml: "<!doctype html><html><body>LP</body></html>",
        stylesCss: "body { color: black; }",
        scriptJs: "console.log('ready');"
      },
      createdAt
    });
    const cssFile = files.find((file) => file.path === "styles.css")!;

    const result = readArtifactWorkspaceFileRecord({
      file: cssFile,
      includeContent: true,
      maxBytes: 4
    });

    expect(result.content).toBeUndefined();
    expect(result.truncated).toBe(true);
    expect(result.omittedReason).toBe("size_limit_exceeded");
  });

  it("normalizes only canonical static LP file paths", () => {
    expect(normalizeArtifactWorkspaceFilePath("index.html")).toBe("index.html");
    expect(normalizeArtifactWorkspaceFilePath("styles.css")).toBe("styles.css");
    expect(normalizeArtifactWorkspaceFilePath("script.js")).toBe("script.js");
    expect(() => normalizeArtifactWorkspaceFilePath("../index.html")).toThrow(
      "Unsupported artifact workspace file path: ../index.html."
    );
  });

  it("rejects stale file metadata during single-file reads", () => {
    const [file] = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      artifacts: {
        indexHtml: "<!doctype html><html><body>LP</body></html>",
        stylesCss: "body { color: black; }",
        scriptJs: "console.log('ready');"
      },
      createdAt
    });

    expect(() => readArtifactWorkspaceFileRecord({
      file: {
        ...file!,
        content: "<!doctype html><html><body>changed</body></html>"
      }
    })).toThrow("Artifact workspace file sizeBytes mismatch for index.html.");
  });

  it("diffs artifact workspace files with metadata only", () => {
    const firstFiles = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      pageVersionId: "version_1",
      artifacts: {
        indexHtml: "<!doctype html><html><body>same</body></html>",
        stylesCss: "body { color: black; }",
        scriptJs: "console.log('old');"
      },
      createdAt
    });
    const secondFiles = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_2",
      projectId: "project_1",
      pageVersionId: "version_2",
      artifacts: {
        indexHtml: "<!doctype html><html><body>same</body></html>",
        stylesCss: "body { color: red; }",
        scriptJs: "console.log('new');"
      },
      createdAt
    }).filter((file) => file.path !== "script.js");

    const result = diffArtifactWorkspaceFiles({
      projectId: "project_1",
      fromWorkspaceId: "artifact_workspace_1",
      toWorkspaceId: "artifact_workspace_2",
      fromFiles: firstFiles.filter((file) => file.path !== "styles.css"),
      toFiles: secondFiles
    });

    expect(result.files.map((file) => [file.path, file.state])).toEqual([
      ["index.html", "unchanged"],
      ["styles.css", "added"],
      ["script.js", "removed"]
    ]);
    expect(result.changedFileCount).toBe(2);
    expect(JSON.stringify(result)).not.toContain("<!doctype html>");
    expect(JSON.stringify(result)).not.toContain("console.log");
  });
```

- [ ] **Step 2: Run artifact tests to verify RED**

Run:

```bash
pnpm --filter @lp-agent/artifacts test
```

Expected: FAIL because `readArtifactWorkspaceFileRecord`, `diffArtifactWorkspaceFiles`, `normalizeArtifactWorkspaceFilePath`, and `ARTIFACT_WORKSPACE_DEFAULT_READ_MAX_BYTES` are not exported.

- [ ] **Step 3: Implement pure helpers**

In `packages/artifacts/src/index.ts`, export the file path assertion by replacing:

```ts
const assertArtifactWorkspaceFilePath = (path: string): ArtifactWorkspaceFilePath => {
```

with:

```ts
export const normalizeArtifactWorkspaceFilePath = (path: string): ArtifactWorkspaceFilePath => {
```

Then replace both internal calls to `assertArtifactWorkspaceFilePath(...)` with `normalizeArtifactWorkspaceFilePath(...)`.

After `ArtifactWorkspaceManifest`, add:

```ts
export const ARTIFACT_WORKSPACE_DEFAULT_READ_MAX_BYTES = 8_192;

export type ArtifactWorkspaceFileOmittedReason =
  | "content_not_requested"
  | "size_limit_exceeded";

export interface ArtifactWorkspaceFileReadResult {
  workspaceId: string;
  projectId: string;
  pageVersionId?: string;
  file: ArtifactWorkspaceManifestFile;
  content?: string;
  truncated: boolean;
  omittedReason?: ArtifactWorkspaceFileOmittedReason;
}

export type ArtifactWorkspaceDiffFileState =
  | "unchanged"
  | "changed"
  | "added"
  | "removed";

export interface ArtifactWorkspaceDiffFile {
  path: ArtifactWorkspaceFilePath;
  state: ArtifactWorkspaceDiffFileState;
  from?: Pick<ArtifactWorkspaceManifestFile, "sizeBytes" | "sha256" | "summary">;
  to?: Pick<ArtifactWorkspaceManifestFile, "sizeBytes" | "sha256" | "summary">;
}

export interface ArtifactWorkspaceDiffResult {
  projectId: string;
  fromWorkspaceId: string;
  toWorkspaceId: string;
  files: ArtifactWorkspaceDiffFile[];
  changedFileCount: number;
}
```

After `createArtifactWorkspaceManifest(...)`, add:

```ts
export function readArtifactWorkspaceFileRecord(input: {
  file: ArtifactWorkspaceFileRecord;
  includeContent?: boolean;
  maxBytes?: number;
}): ArtifactWorkspaceFileReadResult {
  const file = validateStaticWorkspaceFileRecord(input.file);
  const maxBytes = input.maxBytes ?? ARTIFACT_WORKSPACE_DEFAULT_READ_MAX_BYTES;
  const manifestFile = toArtifactWorkspaceManifestFile(file);

  if (!input.includeContent) {
    return {
      workspaceId: file.workspaceId,
      projectId: file.projectId,
      pageVersionId: file.pageVersionId,
      file: manifestFile,
      truncated: false,
      omittedReason: "content_not_requested"
    };
  }

  if (file.sizeBytes > maxBytes) {
    return {
      workspaceId: file.workspaceId,
      projectId: file.projectId,
      pageVersionId: file.pageVersionId,
      file: manifestFile,
      truncated: true,
      omittedReason: "size_limit_exceeded"
    };
  }

  return {
    workspaceId: file.workspaceId,
    projectId: file.projectId,
    pageVersionId: file.pageVersionId,
    file: manifestFile,
    content: file.content,
    truncated: false
  };
}

export function diffArtifactWorkspaceFiles(input: {
  projectId: string;
  fromWorkspaceId: string;
  toWorkspaceId: string;
  fromFiles: ArtifactWorkspaceFileRecord[];
  toFiles: ArtifactWorkspaceFileRecord[];
}): ArtifactWorkspaceDiffResult {
  const fromByPath = toManifestFileMap(input.fromFiles, input.projectId, input.fromWorkspaceId);
  const toByPath = toManifestFileMap(input.toFiles, input.projectId, input.toWorkspaceId);
  const files = staticArtifactFileSpecs.map((spec): ArtifactWorkspaceDiffFile => {
    const from = fromByPath.get(spec.path);
    const to = toByPath.get(spec.path);

    if (from && to) {
      return {
        path: spec.path,
        state: from.sha256 === to.sha256 ? "unchanged" : "changed",
        from: toDiffEndpoint(from),
        to: toDiffEndpoint(to)
      };
    }

    if (from) {
      return {
        path: spec.path,
        state: "removed",
        from: toDiffEndpoint(from)
      };
    }

    return {
      path: spec.path,
      state: "added",
      ...(to ? { to: toDiffEndpoint(to) } : {})
    };
  });

  return {
    projectId: input.projectId,
    fromWorkspaceId: input.fromWorkspaceId,
    toWorkspaceId: input.toWorkspaceId,
    files,
    changedFileCount: files.filter((file) => file.state !== "unchanged").length
  };
}
```

Add these private helpers near `validateCompleteStaticWorkspaceFiles`:

```ts
function validateStaticWorkspaceFileRecord(
  file: ArtifactWorkspaceFileRecord
): ArtifactWorkspaceFileRecord {
  const spec = getStaticArtifactFileSpec(file.path);
  if (file.kind !== spec.kind) {
    throw new Error(
      `Artifact workspace file kind mismatch for ${spec.path}: expected ${spec.kind}, received ${file.kind}.`
    );
  }
  if (file.mimeType !== spec.mimeType) {
    throw new Error(
      `Artifact workspace file mimeType mismatch for ${spec.path}: expected ${spec.mimeType}, received ${file.mimeType}.`
    );
  }
  if (file.sizeBytes !== Buffer.byteLength(file.content, "utf8")) {
    throw new Error(`Artifact workspace file sizeBytes mismatch for ${spec.path}.`);
  }
  if (file.sha256 !== sha256Hex(file.content)) {
    throw new Error(`Artifact workspace file sha256 mismatch for ${spec.path}.`);
  }
  return file;
}

function toArtifactWorkspaceManifestFile(
  file: ArtifactWorkspaceFileRecord
): ArtifactWorkspaceManifestFile {
  const spec = getStaticArtifactFileSpec(file.path);
  return {
    path: spec.path,
    kind: spec.kind,
    mimeType: spec.mimeType,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    summary: spec.summary
  };
}

function toManifestFileMap(
  files: ArtifactWorkspaceFileRecord[],
  projectId: string,
  workspaceId: string
): Map<ArtifactWorkspaceFilePath, ArtifactWorkspaceManifestFile> {
  const map = new Map<ArtifactWorkspaceFilePath, ArtifactWorkspaceManifestFile>();
  for (const file of files) {
    if (file.projectId !== projectId || file.workspaceId !== workspaceId) {
      throw new Error(`Artifact workspace file ${file.path} does not belong to workspace ${workspaceId}.`);
    }
    const validated = validateStaticWorkspaceFileRecord(file);
    if (map.has(validated.path)) {
      throw new Error(`Artifact workspace has duplicate file path: ${validated.path}.`);
    }
    map.set(validated.path, toArtifactWorkspaceManifestFile(validated));
  }
  return map;
}

function toDiffEndpoint(
  file: ArtifactWorkspaceManifestFile
): Pick<ArtifactWorkspaceManifestFile, "sizeBytes" | "sha256" | "summary"> {
  return {
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    summary: file.summary
  };
}
```

- [ ] **Step 4: Run artifact tests to verify GREEN**

Run:

```bash
pnpm --filter @lp-agent/artifacts test
```

Expected: PASS.

- [ ] **Step 5: Commit artifact helpers**

```bash
git add packages/artifacts/src/index.ts packages/artifacts/src/index.test.ts
git commit -m "add artifact reader diff helpers"
```

## Task 2: Repository-Backed API Artifact Reader

**Files:**

- Create: `packages/api/src/artifact-reader.ts`
- Create: `packages/api/src/artifact-reader.test.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Write failing API reader tests**

Create `packages/api/src/artifact-reader.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createStaticArtifactWorkspaceFiles,
  type StaticArtifacts
} from "@lp-agent/artifacts";
import { createInMemoryWorkbenchRepositories } from "@lp-agent/db";
import {
  ArtifactReaderError,
  diffPageVersionArtifactWorkspaces,
  diffRepositoryArtifactWorkspaces,
  readRepositoryArtifactWorkspaceFile
} from "./artifact-reader";

describe("artifact reader", () => {
  it("reads a workspace file after ownership checks", async () => {
    const { repositories, pageVersion } = await createWorkspaceFixture();

    const result = await readRepositoryArtifactWorkspaceFile({
      repositories,
      projectId: "project_1",
      workspaceId: pageVersion.artifactWorkspaceId!,
      pageVersionId: pageVersion.id,
      path: "styles.css",
      includeContent: true,
      maxBytes: 256
    });

    expect(result.content).toBe("body { color: black; }");
    expect(result.file).toMatchObject({
      path: "styles.css",
      kind: "css",
      mimeType: "text/css"
    });
  });

  it("does not return content unless explicitly requested", async () => {
    const { repositories, pageVersion } = await createWorkspaceFixture({
      indexHtml: "<!doctype html><html><body>SECRET_HTML</body></html>"
    });

    const result = await readRepositoryArtifactWorkspaceFile({
      repositories,
      projectId: "project_1",
      workspaceId: pageVersion.artifactWorkspaceId!,
      path: "index.html"
    });

    expect(result.content).toBeUndefined();
    expect(result.omittedReason).toBe("content_not_requested");
    expect(JSON.stringify(result)).not.toContain("SECRET_HTML");
  });

  it("rejects path traversal before repository access", async () => {
    const { repositories, pageVersion } = await createWorkspaceFixture();

    await expect(readRepositoryArtifactWorkspaceFile({
      repositories,
      projectId: "project_1",
      workspaceId: pageVersion.artifactWorkspaceId!,
      path: "../index.html"
    })).rejects.toMatchObject({
      code: "artifact_workspace_file_path_not_allowed"
    });
  });

  it("rejects workspace project and page version mismatches", async () => {
    const { repositories, pageVersion } = await createWorkspaceFixture();

    await expect(readRepositoryArtifactWorkspaceFile({
      repositories,
      projectId: "project_2",
      workspaceId: pageVersion.artifactWorkspaceId!,
      path: "index.html"
    })).rejects.toMatchObject({
      code: "artifact_workspace_project_mismatch"
    });

    await expect(readRepositoryArtifactWorkspaceFile({
      repositories,
      projectId: "project_1",
      workspaceId: pageVersion.artifactWorkspaceId!,
      pageVersionId: "version_other",
      path: "index.html"
    })).rejects.toMatchObject({
      code: "artifact_workspace_page_version_mismatch"
    });
  });

  it("rejects corrupt file metadata", async () => {
    const { repositories, pageVersion } = await createWorkspaceFixture();
    const file = await repositories.artifactWorkspaceFiles.getByPath({
      workspaceId: pageVersion.artifactWorkspaceId!,
      path: "script.js"
    });
    await repositories.artifactWorkspaceFiles.save({
      ...file!,
      content: "console.log('changed');"
    });

    await expect(readRepositoryArtifactWorkspaceFile({
      repositories,
      projectId: "project_1",
      workspaceId: pageVersion.artifactWorkspaceId!,
      path: "script.js",
      includeContent: true
    })).rejects.toMatchObject({
      code: "artifact_workspace_file_integrity_mismatch"
    });
  });

  it("diffs two repository workspaces without raw content", async () => {
    const first = await createWorkspaceFixture();
    const second = await createWorkspaceFixture({
      repositories: first.repositories,
      workspaceId: "artifact_workspace_2",
      pageVersionId: "version_2",
      stylesCss: "body { color: red; }"
    });

    const diff = await diffRepositoryArtifactWorkspaces({
      repositories: first.repositories,
      projectId: "project_1",
      fromWorkspaceId: first.pageVersion.artifactWorkspaceId!,
      toWorkspaceId: second.pageVersion.artifactWorkspaceId!
    });

    expect(diff.files.map((file) => [file.path, file.state])).toEqual([
      ["index.html", "unchanged"],
      ["styles.css", "changed"],
      ["script.js", "unchanged"]
    ]);
    expect(diff.changedFileCount).toBe(1);
    expect(JSON.stringify(diff)).not.toContain("<!doctype html>");
    expect(JSON.stringify(diff)).not.toContain("color: red");
  });

  it("diffs page versions by resolving their workspaces", async () => {
    const first = await createWorkspaceFixture();
    const second = await createWorkspaceFixture({
      repositories: first.repositories,
      workspaceId: "artifact_workspace_2",
      pageVersionId: "version_2",
      scriptJs: "console.log('new');"
    });

    const diff = await diffPageVersionArtifactWorkspaces({
      repositories: first.repositories,
      projectId: "project_1",
      fromPageVersionId: first.pageVersion.id,
      toPageVersionId: second.pageVersion.id
    });

    expect(diff.fromWorkspaceId).toBe(first.pageVersion.artifactWorkspaceId);
    expect(diff.toWorkspaceId).toBe(second.pageVersion.artifactWorkspaceId);
    expect(diff.files.find((file) => file.path === "script.js")?.state).toBe("changed");
  });

  it("uses typed reader errors", () => {
    const error = new ArtifactReaderError(
      "artifact_workspace_not_found",
      "Artifact workspace not found."
    );

    expect(error.name).toBe("ArtifactReaderError");
    expect(error.code).toBe("artifact_workspace_not_found");
  });
});

async function createWorkspaceFixture(overrides: Partial<StaticArtifacts> & {
  repositories?: ReturnType<typeof createInMemoryWorkbenchRepositories>;
  workspaceId?: string;
  pageVersionId?: string;
} = {}) {
  const repositories = overrides.repositories ?? createInMemoryWorkbenchRepositories();
  const workspaceId = overrides.workspaceId ?? "artifact_workspace_1";
  const pageVersionId = overrides.pageVersionId ?? "version_1";
  const createdAt = "2026-05-18T00:00:00.000Z";
  const artifacts: StaticArtifacts = {
    indexHtml: overrides.indexHtml ?? "<!doctype html><html><body>LP</body></html>",
    stylesCss: overrides.stylesCss ?? "body { color: black; }",
    scriptJs: overrides.scriptJs ?? "console.log('ready');"
  };
  const pageVersion = {
    id: pageVersionId,
    projectId: "project_1",
    briefId: "brief_1",
    artifactWorkspaceId: workspaceId,
    artifacts,
    reviewStatus: "pending" as const,
    findings: [],
    createdAt
  };

  await repositories.projects.save({
    id: "project_1",
    name: "Project",
    createdAt
  });
  await repositories.briefs.save({
    id: "brief_1",
    projectId: "project_1",
    prompt: "Build a page",
    brief: {
      title: "Title",
      objective: "Objective",
      audience: "Audience",
      offer: "Offer",
      brandProfile: { voice: "Clear", colors: ["#111111"], typography: "system-ui" },
      cta: { label: "Shop now", href: "#shop", intent: "buy" },
      sections: [],
      productData: [],
      assets: [],
      seo: { title: "Title", description: "Description" }
    },
    createdAt
  });
  await repositories.pageVersions.save(pageVersion);
  await repositories.artifactWorkspaces.save({
    id: workspaceId,
    projectId: "project_1",
    pageVersionId,
    runId: `run_builder_${pageVersionId}`,
    kind: "static_lp",
    state: "active",
    createdAt,
    updatedAt: createdAt
  });
  for (const file of createStaticArtifactWorkspaceFiles({
    workspaceId,
    projectId: "project_1",
    pageVersionId,
    artifacts,
    createdAt
  })) {
    await repositories.artifactWorkspaceFiles.save(file);
  }

  return { repositories, pageVersion };
}
```

- [ ] **Step 2: Run API reader test to verify RED**

Run:

```bash
pnpm --filter @lp-agent/api exec vitest run src/artifact-reader.test.ts
```

Expected: FAIL because `packages/api/src/artifact-reader.ts` does not exist.

- [ ] **Step 3: Implement repository-backed artifact reader**

Create `packages/api/src/artifact-reader.ts`:

```ts
import {
  diffArtifactWorkspaceFiles,
  normalizeArtifactWorkspaceFilePath,
  readArtifactWorkspaceFileRecord,
  type ArtifactWorkspaceDiffResult,
  type ArtifactWorkspaceFilePath,
  type ArtifactWorkspaceFileReadResult,
  type ArtifactWorkspaceFileRecord,
  type ArtifactWorkspaceRecord
} from "@lp-agent/artifacts";
import type {
  PageVersionRecord,
  WorkbenchRepositories
} from "@lp-agent/db";

export type ArtifactReaderErrorCode =
  | "artifact_workspace_not_found"
  | "artifact_workspace_project_mismatch"
  | "artifact_workspace_page_version_mismatch"
  | "artifact_workspace_file_not_found"
  | "artifact_workspace_file_project_mismatch"
  | "artifact_workspace_file_integrity_mismatch"
  | "artifact_workspace_file_path_not_allowed"
  | "artifact_workspace_diff_not_available";

export class ArtifactReaderError extends Error {
  readonly code: ArtifactReaderErrorCode;

  constructor(code: ArtifactReaderErrorCode, message: string) {
    super(message);
    this.name = "ArtifactReaderError";
    this.code = code;
  }
}

export interface ReadRepositoryArtifactWorkspaceFileInput {
  repositories: WorkbenchRepositories;
  projectId: string;
  workspaceId: string;
  path: string;
  pageVersionId?: string;
  maxBytes?: number;
  includeContent?: boolean;
}

export interface DiffRepositoryArtifactWorkspacesInput {
  repositories: WorkbenchRepositories;
  projectId: string;
  fromWorkspaceId: string;
  toWorkspaceId: string;
  fromPageVersionId?: string;
  toPageVersionId?: string;
}

export interface DiffPageVersionArtifactWorkspacesInput {
  repositories: WorkbenchRepositories;
  projectId: string;
  fromPageVersionId: string;
  toPageVersionId: string;
}

export async function readRepositoryArtifactWorkspaceFile(
  input: ReadRepositoryArtifactWorkspaceFileInput
): Promise<ArtifactWorkspaceFileReadResult> {
  const path = normalizeReaderPath(input.path);
  const workspace = await getWorkspaceOrThrow(input.repositories, input.workspaceId);
  assertWorkspaceScope(workspace, input.projectId, input.pageVersionId);
  const file = await input.repositories.artifactWorkspaceFiles.getByPath({
    workspaceId: workspace.id,
    path
  });
  if (!file) {
    throw new ArtifactReaderError(
      "artifact_workspace_file_not_found",
      `Artifact workspace file not found: ${path}.`
    );
  }
  assertFileScope(file, workspace, input.projectId, input.pageVersionId);

  try {
    return readArtifactWorkspaceFileRecord({
      file,
      includeContent: input.includeContent,
      maxBytes: input.maxBytes
    });
  } catch (error) {
    throw new ArtifactReaderError(
      "artifact_workspace_file_integrity_mismatch",
      error instanceof Error ? error.message : "Artifact workspace file integrity mismatch."
    );
  }
}

export async function diffRepositoryArtifactWorkspaces(
  input: DiffRepositoryArtifactWorkspacesInput
): Promise<ArtifactWorkspaceDiffResult> {
  const [fromWorkspace, toWorkspace] = await Promise.all([
    getWorkspaceOrThrow(input.repositories, input.fromWorkspaceId),
    getWorkspaceOrThrow(input.repositories, input.toWorkspaceId)
  ]);
  assertWorkspaceScope(fromWorkspace, input.projectId, input.fromPageVersionId);
  assertWorkspaceScope(toWorkspace, input.projectId, input.toPageVersionId);

  try {
    const [fromFiles, toFiles] = await Promise.all([
      input.repositories.artifactWorkspaceFiles.listForWorkspace(fromWorkspace.id),
      input.repositories.artifactWorkspaceFiles.listForWorkspace(toWorkspace.id)
    ]);
    return diffArtifactWorkspaceFiles({
      projectId: input.projectId,
      fromWorkspaceId: fromWorkspace.id,
      toWorkspaceId: toWorkspace.id,
      fromFiles,
      toFiles
    });
  } catch (error) {
    throw new ArtifactReaderError(
      "artifact_workspace_diff_not_available",
      error instanceof Error ? error.message : "Artifact workspace diff is not available."
    );
  }
}

export async function diffPageVersionArtifactWorkspaces(
  input: DiffPageVersionArtifactWorkspacesInput
): Promise<ArtifactWorkspaceDiffResult> {
  const [fromPageVersion, toPageVersion] = await Promise.all([
    getPageVersionOrThrow(input.repositories, input.projectId, input.fromPageVersionId),
    getPageVersionOrThrow(input.repositories, input.projectId, input.toPageVersionId)
  ]);
  if (!fromPageVersion.artifactWorkspaceId || !toPageVersion.artifactWorkspaceId) {
    throw new ArtifactReaderError(
      "artifact_workspace_diff_not_available",
      "Both page versions must have artifact workspaces."
    );
  }

  return diffRepositoryArtifactWorkspaces({
    repositories: input.repositories,
    projectId: input.projectId,
    fromWorkspaceId: fromPageVersion.artifactWorkspaceId,
    toWorkspaceId: toPageVersion.artifactWorkspaceId,
    fromPageVersionId: fromPageVersion.id,
    toPageVersionId: toPageVersion.id
  });
}

function normalizeReaderPath(path: string): ArtifactWorkspaceFilePath {
  try {
    return normalizeArtifactWorkspaceFilePath(path);
  } catch {
    throw new ArtifactReaderError(
      "artifact_workspace_file_path_not_allowed",
      `Artifact workspace file path is not allowed: ${path}.`
    );
  }
}

async function getWorkspaceOrThrow(
  repositories: WorkbenchRepositories,
  workspaceId: string
): Promise<ArtifactWorkspaceRecord> {
  const workspace = await repositories.artifactWorkspaces.getById(workspaceId);
  if (!workspace) {
    throw new ArtifactReaderError(
      "artifact_workspace_not_found",
      `Artifact workspace not found: ${workspaceId}.`
    );
  }
  return workspace;
}

async function getPageVersionOrThrow(
  repositories: WorkbenchRepositories,
  projectId: string,
  pageVersionId: string
): Promise<PageVersionRecord> {
  const pageVersion = await repositories.pageVersions.getById(pageVersionId);
  if (!pageVersion || pageVersion.projectId !== projectId) {
    throw new ArtifactReaderError(
      "artifact_workspace_diff_not_available",
      `Page version not found for project: ${pageVersionId}.`
    );
  }
  return pageVersion;
}

function assertWorkspaceScope(
  workspace: ArtifactWorkspaceRecord,
  projectId: string,
  pageVersionId?: string
): void {
  if (workspace.projectId !== projectId) {
    throw new ArtifactReaderError(
      "artifact_workspace_project_mismatch",
      `Artifact workspace ${workspace.id} does not belong to project ${projectId}.`
    );
  }
  if (pageVersionId !== undefined && workspace.pageVersionId !== pageVersionId) {
    throw new ArtifactReaderError(
      "artifact_workspace_page_version_mismatch",
      `Artifact workspace ${workspace.id} does not belong to page version ${pageVersionId}.`
    );
  }
}

function assertFileScope(
  file: ArtifactWorkspaceFileRecord,
  workspace: ArtifactWorkspaceRecord,
  projectId: string,
  pageVersionId?: string
): void {
  if (
    file.workspaceId !== workspace.id ||
    file.projectId !== projectId ||
    (pageVersionId !== undefined && file.pageVersionId !== pageVersionId)
  ) {
    throw new ArtifactReaderError(
      "artifact_workspace_file_project_mismatch",
      `Artifact workspace file ${file.path} does not belong to workspace ${workspace.id}.`
    );
  }
}
```

- [ ] **Step 4: Add `DemoWorkbenchService` wrappers and exports**

In `packages/api/src/index.ts`, add imports after the handoff imports:

```ts
import {
  diffPageVersionArtifactWorkspaces,
  diffRepositoryArtifactWorkspaces,
  readRepositoryArtifactWorkspaceFile,
  type DiffPageVersionArtifactWorkspacesInput,
  type DiffRepositoryArtifactWorkspacesInput,
  type ReadRepositoryArtifactWorkspaceFileInput
} from "./artifact-reader";
```

Inside `DemoWorkbenchService`, add these public methods after `getSnapshotForRecords(...)`:

```ts
  async readArtifactWorkspaceFile(
    input: Omit<ReadRepositoryArtifactWorkspaceFileInput, "repositories">
  ) {
    await this.getProjectOrThrow(input.projectId);
    return readRepositoryArtifactWorkspaceFile({
      repositories: this.repositories,
      ...input
    });
  }

  async diffArtifactWorkspaces(
    input: Omit<DiffRepositoryArtifactWorkspacesInput, "repositories">
  ) {
    await this.getProjectOrThrow(input.projectId);
    return diffRepositoryArtifactWorkspaces({
      repositories: this.repositories,
      ...input
    });
  }

  async diffPageVersionArtifactWorkspaces(
    input: Omit<DiffPageVersionArtifactWorkspacesInput, "repositories">
  ) {
    await this.getProjectOrThrow(input.projectId);
    return diffPageVersionArtifactWorkspaces({
      repositories: this.repositories,
      ...input
    });
  }
```

At the export section near `context-assembler`, add:

```ts
export {
  ArtifactReaderError,
  diffPageVersionArtifactWorkspaces,
  diffRepositoryArtifactWorkspaces,
  readRepositoryArtifactWorkspaceFile,
  type ArtifactReaderErrorCode,
  type DiffPageVersionArtifactWorkspacesInput,
  type DiffRepositoryArtifactWorkspacesInput,
  type ReadRepositoryArtifactWorkspaceFileInput
} from "./artifact-reader";
```

- [ ] **Step 5: Run API reader tests to verify GREEN**

Run:

```bash
pnpm --filter @lp-agent/api exec vitest run src/artifact-reader.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit API reader**

```bash
git add packages/api/src/artifact-reader.ts packages/api/src/artifact-reader.test.ts packages/api/src/index.ts
git commit -m "add repository artifact reader service"
```

## Task 3: Context Pack Artifact Snippet Opt-In

**Files:**

- Modify: `packages/api/src/context-assembler.ts`
- Modify: `packages/api/src/services.test.ts`

- [ ] **Step 1: Write failing Context Pack tests**

In `packages/api/src/services.test.ts`, add this test near the existing context pack tests:

```ts
  it("keeps artifact snippets out of context packs by default", async () => {
    const artifacts: StaticArtifacts = {
      indexHtml: "<!doctype html><html><body>SNIPPET_HTML_SECRET</body></html>",
      stylesCss: "body { color: black; }",
      scriptJs: "console.log('ready');"
    };
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
      builderRuntime: new StaticRuntime({ state: "completed", artifacts }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a static LP"
    });
    await service.generatePageVersion({ projectId: project.id, briefId: brief.id });

    const contextPack = await assembleContextPack({
      repositories,
      service,
      projectId: project.id,
      role: "reviewer",
      input: {
        prompt: "Review the page"
      },
      now: fixedClock()
    });

    expect(ContextPackSchema.parse(contextPack).artifactSnippets).toEqual([]);
    expect(JSON.stringify(contextPack)).not.toContain("SNIPPET_HTML_SECRET");
  });

  it("injects bounded artifact snippets only when explicitly requested", async () => {
    const artifacts: StaticArtifacts = {
      indexHtml: "<!doctype html><html><body>SNIPPET_HTML_SECRET</body></html>",
      stylesCss: "body { color: black; }",
      scriptJs: "console.log('ready');"
    };
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
      builderRuntime: new StaticRuntime({ state: "completed", artifacts }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a static LP"
    });
    const pageVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });

    const contextPack = await assembleContextPack({
      repositories,
      service,
      projectId: project.id,
      role: "reviewer",
      input: {
        prompt: "Review the page"
      },
      artifactSnippetRequests: [
        {
          workspaceId: pageVersion.artifactWorkspaceId!,
          pageVersionId: pageVersion.id,
          path: "styles.css",
          maxBytes: 128
        },
        {
          workspaceId: pageVersion.artifactWorkspaceId!,
          pageVersionId: pageVersion.id,
          path: "index.html",
          maxBytes: 8
        }
      ],
      now: fixedClock()
    });
    const parsed = ContextPackSchema.parse(contextPack);

    expect(parsed.artifactSnippets).toEqual([
      expect.objectContaining({
        workspaceId: pageVersion.artifactWorkspaceId,
        pageVersionId: pageVersion.id,
        path: "styles.css",
        content: "body { color: black; }",
        truncated: false
      })
    ]);
    expect(parsed.trace.injected).toContain("artifactSnippets:1");
    expect(parsed.trace.omitted).toContain("artifactSnippet:index.html:size_limit_exceeded");
    expect(JSON.stringify(parsed.runtimeContext)).not.toContain("body { color: black; }");
  });
```

Add this test near the `runAgentStep` context memory test:

```ts
  it("does not pass top-level artifact snippets into runtime requests", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const runtime = new RecordingRuntime({ state: "completed" });
    const service = new DemoWorkbenchService({
      repositories,
      builderRuntime: new StaticRuntime({
        state: "completed",
        artifacts: {
          indexHtml: "<!doctype html><html><body>LP</body></html>",
          stylesCss: "body { color: black; }",
          scriptJs: "console.log('ready');"
        }
      }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a static LP"
    });
    await service.generatePageVersion({ projectId: project.id, briefId: brief.id });

    await runAgentStep({
      repositories,
      service,
      runtime,
      runId: "run_no_snippet_runtime",
      projectId: project.id,
      role: "reviewer",
      input: {
        prompt: "review"
      },
      now: fixedClock()
    });

    expect(JSON.stringify(runtime.requests[0]?.context)).not.toContain("body { color: black; }");
  });
```

- [ ] **Step 2: Run context tests to verify RED**

Run:

```bash
pnpm --filter @lp-agent/api exec vitest run src/services.test.ts -t "artifact snippets|top-level artifact snippets"
```

Expected: FAIL because `artifactSnippetRequests` and `artifactSnippets` are not part of `assembleContextPack`.

- [ ] **Step 3: Implement top-level Context Pack snippets**

In `packages/api/src/context-assembler.ts`, add imports:

```ts
import {
  ARTIFACT_WORKSPACE_DEFAULT_READ_MAX_BYTES,
  type ArtifactWorkspaceFilePath
} from "@lp-agent/artifacts";
import {
  ArtifactReaderError,
  readRepositoryArtifactWorkspaceFile
} from "./artifact-reader";
```

After `RuntimeRunInputSchema`, add:

```ts
const ArtifactSnippetSchema = z.object({
  workspaceId: z.string().min(1),
  pageVersionId: z.string().min(1).optional(),
  path: ArtifactWorkspaceFilePathSchema,
  sizeBytes: z.number().int().min(0),
  sha256: z.string().regex(SHA256_HEX_PATTERN),
  content: z.string(),
  truncated: z.literal(false)
});
```

In `ContextPackSchema`, add a top-level field after `runtimeContext`:

```ts
  artifactSnippets: z.array(ArtifactSnippetSchema),
```

After `ContextAssemblyTrace`, add:

```ts
export interface ArtifactSnippetRequest {
  workspaceId: string;
  pageVersionId?: string;
  path: ArtifactWorkspaceFilePath;
  maxBytes?: number;
}
```

In `AssembleContextPackInput`, add:

```ts
  artifactSnippetRequests?: ArtifactSnippetRequest[];
```

Inside `assembleContextPack(...)`, after `handoffContext`, add:

```ts
  const artifactSnippetContext = await assembleArtifactSnippetsSafely({
    repositories: input.repositories,
    projectId: input.projectId,
    requests: input.artifactSnippetRequests ?? []
  });
```

In the `contextPack` object, add:

```ts
    artifactSnippets: artifactSnippetContext.snippets,
```

In `trace.injected`, add:

```ts
        `artifactSnippets:${artifactSnippetContext.snippets.length}`,
```

In `trace.omitted`, merge snippet omissions:

```ts
      omitted: [
        ...memory.retrieval.omitted,
        ...handoffContext.trace.omitted,
        ...artifactSnippetContext.trace.omitted
      ]
```

At the end of the file, add:

```ts
async function assembleArtifactSnippetsSafely(input: {
  repositories: WorkbenchRepositories;
  projectId: string;
  requests: ArtifactSnippetRequest[];
}): Promise<{
  snippets: z.infer<typeof ArtifactSnippetSchema>[];
  trace: { omitted: string[] };
}> {
  const snippets: z.infer<typeof ArtifactSnippetSchema>[] = [];
  const omitted: string[] = [];
  for (const request of input.requests.slice(0, 3)) {
    try {
      const result = await readRepositoryArtifactWorkspaceFile({
        repositories: input.repositories,
        projectId: input.projectId,
        workspaceId: request.workspaceId,
        pageVersionId: request.pageVersionId,
        path: request.path,
        includeContent: true,
        maxBytes: request.maxBytes ?? ARTIFACT_WORKSPACE_DEFAULT_READ_MAX_BYTES
      });
      if (result.content === undefined) {
        omitted.push(`artifactSnippet:${request.path}:${result.omittedReason ?? "content_omitted"}`);
        continue;
      }
      snippets.push({
        workspaceId: result.workspaceId,
        pageVersionId: result.pageVersionId,
        path: result.file.path,
        sizeBytes: result.file.sizeBytes,
        sha256: result.file.sha256,
        content: result.content,
        truncated: false
      });
    } catch (error) {
      omitted.push(
        `artifactSnippet:${request.path}:${
          error instanceof ArtifactReaderError ? error.code : "error"
        }`
      );
    }
  }
  if (input.requests.length > 3) {
    omitted.push("artifactSnippet:requests:limit_exceeded");
  }
  return { snippets, trace: { omitted } };
}
```

- [ ] **Step 4: Run context tests to verify GREEN**

Run:

```bash
pnpm --filter @lp-agent/api exec vitest run src/services.test.ts -t "artifact snippets|top-level artifact snippets"
```

Expected: PASS.

- [ ] **Step 5: Commit context snippet support**

```bash
git add packages/api/src/context-assembler.ts packages/api/src/services.test.ts
git commit -m "add bounded artifact snippets to context packs"
```

## Task 4: Runtime and Model Boundary Guards

**Files:**

- Modify: `packages/runtime-adapters/src/index.test.ts`
- Modify: `packages/model-gateway/src/index.test.ts`

- [ ] **Step 1: Add runtime no-content guard test**

In `packages/runtime-adapters/src/index.test.ts`, add or extend a test with this assertion pattern:

```ts
  it("clones only artifact workspace metadata into runtime requests", async () => {
    const runtime = new LocalAgentRuntimeAdapter();
    const result = await runtime.run({
      runId: "run_1",
      projectId: "project_1",
      role: "reviewer",
      input: {
        prompt: "review"
      },
      context: {
        skills: [],
        mcpTools: [],
        approval: { state: "not_required" },
        artifactWorkspace: {
          mode: "memory",
          workspaceId: "artifact_workspace_1",
          writableFiles: ["index.html", "styles.css", "script.js"],
          files: [
            {
              path: "index.html",
              kind: "html",
              mimeType: "text/html",
              sizeBytes: 64,
              sha256: "a".repeat(64),
              summary: "index.html static LP file",
              content: "<!doctype html><html><body>SECRET</body></html>"
            } as never
          ]
        }
      }
    });

    expect(JSON.stringify(result.events)).not.toContain("SECRET");
  });
```

- [ ] **Step 2: Add model gateway no-content guard test**

In `packages/model-gateway/src/index.test.ts`, add or extend a test with this assertion pattern:

```ts
  it("stores only artifact workspace metadata in model audit context", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
    await gateway.complete({
      role: "reviewer",
      projectId: "project_1",
      prompt: "review",
      context: {
        skills: [],
        mcpTools: [],
        approval: { state: "not_required" },
        artifactWorkspace: {
          mode: "memory",
          workspaceId: "artifact_workspace_1",
          writableFiles: ["index.html", "styles.css", "script.js"],
          files: [
            {
              path: "index.html",
              kind: "html",
              mimeType: "text/html",
              sizeBytes: 64,
              sha256: "a".repeat(64),
              summary: "index.html static LP file",
              content: "<!doctype html><html><body>SECRET</body></html>"
            } as never
          ]
        }
      }
    });

    expect(JSON.stringify(gateway.auditLog)).not.toContain("SECRET");
  });
```

- [ ] **Step 3: Run focused boundary tests**

Run:

```bash
pnpm --filter @lp-agent/runtime-adapters test
pnpm --filter @lp-agent/model-gateway test
```

Expected: PASS. These tests should pass because existing clone functions already whitelist artifact file metadata. If they fail, update only the clone helpers to omit unknown file fields.

- [ ] **Step 4: Commit boundary guard tests**

```bash
git add packages/runtime-adapters/src/index.test.ts packages/model-gateway/src/index.test.ts
git commit -m "guard artifact content from runtime model context"
```

## Task 5: Documentation and Verification

**Files:**

- Modify: `docs/superpowers/README.md`
- Modify: `docs/agent-development-learning.md`

- [ ] **Step 1: Verify Superpowers README reading order**

Confirm `docs/superpowers/README.md` contains these adjacent entries:

```md
58. `specs/2026-05-18-artifact-reader-static-diff-design.md`
   - Stage 15 artifact reader and static diff v0 design.
   - Read this after the Stage 14 plan when adding controlled artifact workspace file reads, bounded snippet behavior, metadata-only static diffs, and future-safe read boundaries for Reviewer, MCP, deployment, and desktop workspace flows.

59. `plans/2026-05-18-artifact-reader-static-diff.md`
   - Stage 15 artifact reader and static diff v0 implementation plan.
   - Read this after the Stage 15 design when implementing or auditing controlled artifact reads, repository-backed workspace diffing, bounded Context Pack snippets, and runtime/model no-content guards.
```

- [ ] **Step 2: Update Chinese learning notes with implementation status**

In `docs/agent-development-learning.md`, under `### 阶段 15：Artifact Reader and Static Diff v0`, add this subsection after `当前计划`:

```md
当前实现状态：

- Stage 15 v0 已实现受控 artifact reader：读取单个 workspace file 前会校验 project、workspace、page version、路径 allowlist、文件归属和 hash/size 完整性。
- Stage 15 v0 已实现 metadata-only static diff：比较两个 workspace 或两个 page version 的 `index.html`、`styles.css`、`script.js`，默认只返回 hash、size、summary 和 changed/added/removed/unchanged 状态。
- Context Pack 已支持显式 opt-in 的 bounded artifact snippets；默认不注入 snippets，runtime/model context 仍保持 metadata-only。
```

In the same Stage 15 section, keep this learning point present:

```md
- 实现时要把 snippet 放在 Context Pack 的显式 opt-in 区域，不默认进入 runtime/model context；这样既能为 Reviewer/MCP 预留小片段读取能力，又能保持模型请求边界默认 metadata-only。
```

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected:

- `pnpm test` passes.
- `pnpm typecheck` passes.
- `pnpm build` passes.
- `git diff --check` prints no whitespace errors.

- [ ] **Step 4: Commit docs and verification notes**

```bash
git add docs/superpowers/README.md docs/agent-development-learning.md
git commit -m "document artifact reader diff implementation"
```

## Self-Review

- Spec coverage: controlled file reads are covered by Tasks 1 and 2; metadata-only static diffs are covered by Tasks 1 and 2; Context Pack default metadata-only behavior and explicit bounded snippets are covered by Task 3; runtime/model no-content guards are covered by Task 4; docs maintenance is covered by Task 5.
- Scope check: the plan does not add MCP execution, shell execution, deployment, desktop filesystem workspaces, direct file editing, binary assets, object storage, or line-level textual diff.
- Type consistency: the same `ArtifactWorkspaceFilePath`, `ArtifactWorkspaceFileReadResult`, and `ArtifactWorkspaceDiffResult` names are used across artifact helpers, API reader wrappers, and Context Pack snippets.
- Verification: each task includes focused tests and a commit; final verification runs full test, typecheck, build, and diff whitespace checks.
