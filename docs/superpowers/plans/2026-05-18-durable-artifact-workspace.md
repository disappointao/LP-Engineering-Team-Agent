# Durable Artifact Workspace v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist generated static LP files as a durable local artifact workspace with safe file manifests that can be recovered by Web, injected into context as metadata, and referenced by future worker/deployment payloads.

**Architecture:** Add pure artifact workspace validation and manifest helpers in `@lp-agent/artifacts`, then add in-memory and JSON-file repository contracts in `@lp-agent/db`. Wire `DemoWorkbenchService.generatePageVersion()` to create a workspace beside each new page version, hydrate page versions from workspace files when available, and update context memory to prefer metadata from workspace manifests without injecting full file content.

**Tech Stack:** pnpm workspace, TypeScript, Vitest, existing local JSON-file workbench repositories, existing `StaticArtifacts` / `PageVersionRecord` / `ContextPack` contracts.

---

## Scope Guard

This plan implements local durable artifact workspace v0 only.

It does not add real deployment, real shell execution, MCP execution, worker daemon polling, streaming logs, object storage, Postgres blob migrations, desktop-local directory mapping, binary assets, image upload, large-file chunking, or direct file editing UI.

Generated LP output remains framework-free static HTML/CSS/JS.

## File Structure

- `packages/artifacts/src/index.ts`
  - Owns `StaticArtifacts`.
  - Add artifact workspace domain types and pure helpers:
    - create file records from `StaticArtifacts`;
    - compute metadata;
    - validate allowed static LP file paths;
    - rebuild `StaticArtifacts` from workspace file records;
    - create metadata-only manifests.
- `packages/artifacts/src/index.test.ts`
  - Covers helper behavior, validation, hashing, metadata-only manifest, and round-trip recovery.
- `packages/db/src/workbench-repositories.ts`
  - Add artifact workspace/file record types.
  - Extend `PageVersionRecord` with optional `artifactWorkspaceId`.
  - Add repository interfaces and in-memory implementations.
  - Extend `WorkbenchRepositories`.
- `packages/db/src/json-file-workbench-repositories.ts`
  - Persist artifact workspace/file arrays in local JSON state.
  - Default missing arrays for old state files.
  - Add JSON-file repository implementations.
- `packages/db/src/workbench-repositories.test.ts`
  - Cover in-memory artifact workspace repositories and defensive copies.
- `packages/db/src/json-file-workbench-repositories.test.ts`
  - Cover JSON-file reopen/default behavior for workspace records and file records.
- `packages/api/src/index.ts`
  - Create artifact workspace records during page version generation.
  - Emit safe `artifact.workspace.created` run event metadata.
  - Hydrate workspace-backed page versions for snapshots/export consumers.
  - Preserve legacy fallback to embedded `PageVersion.artifacts`.
- `packages/api/src/services.test.ts`
  - Cover workspace creation, safe event payload, hydration, legacy fallback, and no raw source in events.
- `packages/api/src/context-memory.ts`
  - Prefer artifact workspace file manifest metadata when available.
  - Keep full file content out of memory/context.
- `packages/api/src/context-memory.test.ts`
  - Cover workspace metadata in artifact memory and no full content injection.
- `packages/api/src/context-assembler.ts`
  - Widen artifact workspace schema to support durable local mode and manifest metadata.
- `packages/runtime-adapters/src/index.ts`
  - Widen runtime artifact workspace type with optional `workspaceId` and `files`.
- `packages/runtime-adapters/src/index.test.ts`
  - Cover defensive copies and schema compatibility for metadata files.
- `apps/web/src/lib/chat-workbench.test.ts`
  - Cover existing artifact cards still render from hydrated artifacts when page version has a workspace id.
- `docs/agent-development-learning.md`
  - Update Stage 14 current plan/status after implementation.
- `docs/superpowers/README.md`
  - Add this plan after the Stage 14 design.

## Task 1: Artifact Workspace Domain Helpers

**Files:**

- Modify: `packages/artifacts/src/index.ts`
- Modify: `packages/artifacts/src/index.test.ts`

- [ ] **Step 1: Write failing tests for workspace file creation and metadata-only manifests**

Add imports in `packages/artifacts/src/index.test.ts`:

```ts
import {
  createStaticArtifactWorkspaceFiles,
  createArtifactWorkspaceManifest,
  staticArtifactsFromWorkspaceFiles
} from "./index";
```

Add tests:

```ts
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
      kind: "html",
      mimeType: "text/html",
      sizeBytes: Buffer.byteLength(artifacts.indexHtml, "utf8"),
      summary: "index.html static LP file"
    });
    expect(files[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
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

    expect(manifest.files).toEqual([
      expect.objectContaining({ path: "index.html", kind: "html" }),
      expect.objectContaining({ path: "styles.css", kind: "css" }),
      expect.objectContaining({ path: "script.js", kind: "js" })
    ]);
    expect(JSON.stringify(manifest)).not.toContain(rawSecret);
    expect(JSON.stringify(manifest)).not.toContain("<!doctype html>");
    expect(JSON.stringify(manifest)).not.toContain("console.log");
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
});
```

- [ ] **Step 2: Run the artifacts tests to verify RED**

Run:

```bash
pnpm --filter @lp-agent/artifacts test
```

Expected: FAIL because `createStaticArtifactWorkspaceFiles`, `createArtifactWorkspaceManifest`, and `staticArtifactsFromWorkspaceFiles` are not exported.

- [ ] **Step 3: Implement artifact workspace types and helpers**

In `packages/artifacts/src/index.ts`, add `node:crypto` import at the top:

```ts
import { createHash } from "node:crypto";
```

Add these exported types and helpers after `StaticArtifacts`:

```ts
export type ArtifactWorkspaceKind = "static_lp";
export type ArtifactWorkspaceState = "active" | "archived";
export type ArtifactWorkspaceFilePath = "index.html" | "styles.css" | "script.js";
export type ArtifactWorkspaceFileKind = "html" | "css" | "js";
export type ArtifactWorkspaceMimeType = "text/html" | "text/css" | "text/javascript";

export interface ArtifactWorkspaceRecord {
  id: string;
  projectId: string;
  pageVersionId?: string;
  runId?: string;
  kind: ArtifactWorkspaceKind;
  state: ArtifactWorkspaceState;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactWorkspaceFileRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  path: ArtifactWorkspaceFilePath;
  kind: ArtifactWorkspaceFileKind;
  mimeType: ArtifactWorkspaceMimeType;
  sizeBytes: number;
  sha256: string;
  summary: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactWorkspaceManifestFile {
  path: ArtifactWorkspaceFilePath;
  kind: ArtifactWorkspaceFileKind;
  mimeType: ArtifactWorkspaceMimeType;
  sizeBytes: number;
  sha256: string;
  summary: string;
}

export interface ArtifactWorkspaceManifest {
  workspaceId: string;
  projectId: string;
  pageVersionId?: string;
  files: ArtifactWorkspaceManifestFile[];
}

export interface CreateStaticArtifactWorkspaceFilesInput {
  workspaceId: string;
  projectId: string;
  pageVersionId?: string;
  artifacts: StaticArtifacts;
  createdAt: string;
}

const staticArtifactFileSpecs: Array<{
  path: ArtifactWorkspaceFilePath;
  kind: ArtifactWorkspaceFileKind;
  mimeType: ArtifactWorkspaceMimeType;
  contentKey: keyof StaticArtifacts;
}> = [
  { path: "index.html", kind: "html", mimeType: "text/html", contentKey: "indexHtml" },
  { path: "styles.css", kind: "css", mimeType: "text/css", contentKey: "stylesCss" },
  { path: "script.js", kind: "js", mimeType: "text/javascript", contentKey: "scriptJs" }
];

export function createStaticArtifactWorkspaceFiles(
  input: CreateStaticArtifactWorkspaceFilesInput
): ArtifactWorkspaceFileRecord[] {
  return staticArtifactFileSpecs.map((spec) => {
    const content = input.artifacts[spec.contentKey];
    return {
      id: `${input.workspaceId}_file_${spec.path.replaceAll(".", "_")}`,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      path: spec.path,
      kind: spec.kind,
      mimeType: spec.mimeType,
      sizeBytes: Buffer.byteLength(content, "utf8"),
      sha256: sha256Hex(content),
      summary: `${spec.path} static LP file`,
      content,
      createdAt: input.createdAt,
      updatedAt: input.createdAt
    };
  });
}

export function createArtifactWorkspaceManifest(input: {
  workspaceId: string;
  projectId: string;
  pageVersionId?: string;
  files: ArtifactWorkspaceFileRecord[];
}): ArtifactWorkspaceManifest {
  return {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    pageVersionId: input.pageVersionId,
    files: sortWorkspaceFiles(input.files).map((file) => ({
      path: file.path,
      kind: file.kind,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      summary: file.summary
    }))
  };
}

export function staticArtifactsFromWorkspaceFiles(
  files: ArtifactWorkspaceFileRecord[]
): StaticArtifacts {
  const byPath = new Map(sortWorkspaceFiles(files).map((file) => [file.path, file] as const));
  const indexHtml = byPath.get("index.html")?.content;
  const stylesCss = byPath.get("styles.css")?.content;
  const scriptJs = byPath.get("script.js")?.content;

  if (!indexHtml || !stylesCss || !scriptJs) {
    throw new Error("artifact_workspace_incomplete");
  }

  return { indexHtml, stylesCss, scriptJs };
}

export function sortWorkspaceFiles<T extends { path: ArtifactWorkspaceFilePath }>(
  files: T[]
): T[] {
  const order = new Map<ArtifactWorkspaceFilePath, number>([
    ["index.html", 0],
    ["styles.css", 1],
    ["script.js", 2]
  ]);
  return [...files].sort((left, right) => order.get(left.path)! - order.get(right.path)!);
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
```

- [ ] **Step 4: Run artifact tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/artifacts test
pnpm --filter @lp-agent/artifacts typecheck
```

Expected: both commands pass.

- [ ] **Step 5: Commit artifact helpers**

```bash
git add packages/artifacts/src/index.ts packages/artifacts/src/index.test.ts
git commit -m "add artifact workspace helpers"
```

## Task 2: Workbench Repository Contracts and Persistence

**Files:**

- Modify: `packages/db/src/workbench-repositories.ts`
- Modify: `packages/db/src/json-file-workbench-repositories.ts`
- Modify: `packages/db/src/workbench-repositories.test.ts`
- Modify: `packages/db/src/json-file-workbench-repositories.test.ts`

- [ ] **Step 1: Write failing in-memory repository tests**

In `packages/db/src/workbench-repositories.test.ts`, extend the import list:

```ts
type ArtifactWorkspaceFileRecord,
type ArtifactWorkspaceRecord,
```

Add this test inside `describe("in-memory workbench repositories", ...)`:

```ts
it("stores artifact workspaces and files with scoped lookups and defensive copies", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const workspace: ArtifactWorkspaceRecord = {
    id: "artifact_workspace_1",
    projectId: "project_1",
    pageVersionId: "version_1",
    kind: "static_lp",
    state: "active",
    createdAt,
    updatedAt: createdAt
  };
  const file: ArtifactWorkspaceFileRecord = {
    id: "artifact_workspace_1_file_index_html",
    workspaceId: "artifact_workspace_1",
    projectId: "project_1",
    path: "index.html",
    kind: "html",
    mimeType: "text/html",
    sizeBytes: 15,
    sha256: "a".repeat(64),
    summary: "index.html static LP file",
    content: "<main>LP</main>",
    createdAt,
    updatedAt: createdAt
  };

  await repositories.artifactWorkspaces.save(workspace);
  await repositories.artifactWorkspaceFiles.save(file);
  workspace.state = "archived";
  file.content = "mutated";

  await expect(repositories.artifactWorkspaces.getById("artifact_workspace_1"))
    .resolves.toEqual({
      id: "artifact_workspace_1",
      projectId: "project_1",
      pageVersionId: "version_1",
      kind: "static_lp",
      state: "active",
      createdAt,
      updatedAt: createdAt
    });
  await expect(repositories.artifactWorkspaces.getForPageVersion("version_1"))
    .resolves.toMatchObject({ id: "artifact_workspace_1" });
  await expect(repositories.artifactWorkspaceFiles.listForWorkspace("artifact_workspace_1"))
    .resolves.toEqual([
      expect.objectContaining({
        id: "artifact_workspace_1_file_index_html",
        content: "<main>LP</main>"
      })
    ]);
});
```

- [ ] **Step 2: Write failing JSON-file persistence tests**

In `packages/db/src/json-file-workbench-repositories.test.ts`, extend the import list:

```ts
type ArtifactWorkspaceFileRecord,
type ArtifactWorkspaceRecord,
```

Add this test:

```ts
it("reopens artifact workspaces and files from disk", async () => {
  const filePath = await tempStateFile();
  const first = createJsonFileWorkbenchRepositories({ filePath });
  const workspace: ArtifactWorkspaceRecord = {
    id: "artifact_workspace_1",
    projectId: "project_1",
    pageVersionId: "version_1",
    kind: "static_lp",
    state: "active",
    createdAt,
    updatedAt: createdAt
  };
  const file: ArtifactWorkspaceFileRecord = {
    id: "artifact_workspace_1_file_index_html",
    workspaceId: "artifact_workspace_1",
    projectId: "project_1",
    path: "index.html",
    kind: "html",
    mimeType: "text/html",
    sizeBytes: 15,
    sha256: "a".repeat(64),
    summary: "index.html static LP file",
    content: "<main>LP</main>",
    createdAt,
    updatedAt: createdAt
  };

  await first.artifactWorkspaces.save(workspace);
  await first.artifactWorkspaceFiles.save(file);

  const second = createJsonFileWorkbenchRepositories({ filePath });

  await expect(second.artifactWorkspaces.listForProject("project_1"))
    .resolves.toEqual([workspace]);
  await expect(second.artifactWorkspaceFiles.listForWorkspace("artifact_workspace_1"))
    .resolves.toEqual([file]);
});
```

Extend the existing old-state default test by adding these expected empty lookups after repository creation:

```ts
await expect(repositories.artifactWorkspaces.listForProject("project_1")).resolves.toEqual([]);
await expect(repositories.artifactWorkspaceFiles.listForWorkspace("artifact_workspace_1")).resolves.toEqual([]);
```

- [ ] **Step 3: Run db tests to verify RED**

Run:

```bash
pnpm --filter @lp-agent/db test
```

Expected: FAIL because artifact workspace types/repositories do not exist.

- [ ] **Step 4: Add db record types and repository interfaces**

In `packages/db/src/workbench-repositories.ts`, extend the artifact import:

```ts
import type {
  ArtifactWorkspaceFileKind,
  ArtifactWorkspaceFilePath,
  ArtifactWorkspaceKind,
  ArtifactWorkspaceMimeType,
  StaticArtifacts
} from "@lp-agent/artifacts";
```

Add record interfaces near `PageVersionRecord`:

```ts
export interface ArtifactWorkspaceRecord {
  id: string;
  projectId: string;
  pageVersionId?: string;
  runId?: string;
  kind: ArtifactWorkspaceKind;
  state: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactWorkspaceFileRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  path: ArtifactWorkspaceFilePath;
  kind: ArtifactWorkspaceFileKind;
  mimeType: ArtifactWorkspaceMimeType;
  sizeBytes: number;
  sha256: string;
  summary: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}
```

Extend `PageVersionRecord`:

```ts
artifactWorkspaceId?: string;
```

Add repository interfaces after `PageVersionRepository`:

```ts
export interface ArtifactWorkspaceRepository {
  save(workspace: ArtifactWorkspaceRecord): Promise<void>;
  getById(workspaceId: string): Promise<ArtifactWorkspaceRecord | undefined>;
  getForPageVersion(pageVersionId: string): Promise<ArtifactWorkspaceRecord | undefined>;
  listForProject(projectId: string): Promise<ArtifactWorkspaceRecord[]>;
  listAll(): Promise<ArtifactWorkspaceRecord[]>;
}

export interface ArtifactWorkspaceFileRepository {
  save(file: ArtifactWorkspaceFileRecord): Promise<void>;
  getByPath(input: {
    workspaceId: string;
    path: ArtifactWorkspaceFilePath;
  }): Promise<ArtifactWorkspaceFileRecord | undefined>;
  listForWorkspace(workspaceId: string): Promise<ArtifactWorkspaceFileRecord[]>;
  listAll(): Promise<ArtifactWorkspaceFileRecord[]>;
}
```

Extend `WorkbenchRepositories`:

```ts
artifactWorkspaces: ArtifactWorkspaceRepository;
artifactWorkspaceFiles: ArtifactWorkspaceFileRepository;
```

- [ ] **Step 5: Add in-memory implementations**

In `InMemoryWorkbenchRepositories`, add:

```ts
readonly artifactWorkspaces = new InMemoryArtifactWorkspaceRepository();
readonly artifactWorkspaceFiles = new InMemoryArtifactWorkspaceFileRepository();
```

Add classes:

```ts
class InMemoryArtifactWorkspaceRepository implements ArtifactWorkspaceRepository {
  private readonly workspaces = new Map<string, ArtifactWorkspaceRecord>();

  async save(workspace: ArtifactWorkspaceRecord): Promise<void> {
    this.workspaces.set(workspace.id, copy(workspace));
  }

  async getById(workspaceId: string): Promise<ArtifactWorkspaceRecord | undefined> {
    return copyOptional(this.workspaces.get(workspaceId));
  }

  async getForPageVersion(pageVersionId: string): Promise<ArtifactWorkspaceRecord | undefined> {
    return copyOptional(
      [...this.workspaces.values()].find((workspace) => workspace.pageVersionId === pageVersionId)
    );
  }

  async listForProject(projectId: string): Promise<ArtifactWorkspaceRecord[]> {
    return [...this.workspaces.values()]
      .filter((workspace) => workspace.projectId === projectId)
      .sort(compareCreatedAtThenId)
      .map(copy);
  }

  async listAll(): Promise<ArtifactWorkspaceRecord[]> {
    return [...this.workspaces.values()].sort(compareCreatedAtThenId).map(copy);
  }
}

class InMemoryArtifactWorkspaceFileRepository implements ArtifactWorkspaceFileRepository {
  private readonly files = new Map<string, ArtifactWorkspaceFileRecord>();

  async save(file: ArtifactWorkspaceFileRecord): Promise<void> {
    this.files.set(file.id, copy(file));
  }

  async getByPath(input: {
    workspaceId: string;
    path: ArtifactWorkspaceFilePath;
  }): Promise<ArtifactWorkspaceFileRecord | undefined> {
    return copyOptional(
      [...this.files.values()].find(
        (file) => file.workspaceId === input.workspaceId && file.path === input.path
      )
    );
  }

  async listForWorkspace(workspaceId: string): Promise<ArtifactWorkspaceFileRecord[]> {
    return [...this.files.values()]
      .filter((file) => file.workspaceId === workspaceId)
      .sort(compareArtifactWorkspaceFiles)
      .map(copy);
  }

  async listAll(): Promise<ArtifactWorkspaceFileRecord[]> {
    return [...this.files.values()].sort(compareArtifactWorkspaceFiles).map(copy);
  }
}
```

Add comparators near the existing compare helpers:

```ts
function compareCreatedAtThenId<T extends { createdAt: string; id: string }>(
  left: T,
  right: T
): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function compareArtifactWorkspaceFiles(
  left: ArtifactWorkspaceFileRecord,
  right: ArtifactWorkspaceFileRecord
): number {
  const order = new Map<ArtifactWorkspaceFilePath, number>([
    ["index.html", 0],
    ["styles.css", 1],
    ["script.js", 2]
  ]);
  return order.get(left.path)! - order.get(right.path)! || left.id.localeCompare(right.id);
}
```

- [ ] **Step 6: Add JSON-file state and repositories**

In `packages/db/src/json-file-workbench-repositories.ts`, import the new types and extend `JsonFileWorkbenchState`:

```ts
artifactWorkspaces: ArtifactWorkspaceRecord[];
artifactWorkspaceFiles: ArtifactWorkspaceFileRecord[];
```

In `JsonFileWorkbenchRepositories`, add readonly fields and constructor assignments:

```ts
readonly artifactWorkspaces: ArtifactWorkspaceRepository;
readonly artifactWorkspaceFiles: ArtifactWorkspaceFileRepository;
```

```ts
this.artifactWorkspaces = new JsonFileArtifactWorkspaceRepository(filePath);
this.artifactWorkspaceFiles = new JsonFileArtifactWorkspaceFileRepository(filePath);
```

Add classes:

```ts
class JsonFileArtifactWorkspaceRepository implements ArtifactWorkspaceRepository {
  constructor(private readonly filePath: string) {}

  async save(workspace: ArtifactWorkspaceRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.artifactWorkspaces = upsertBy(
        state.artifactWorkspaces,
        copy(workspace),
        (record) => record.id === workspace.id
      );
    });
  }

  async getById(workspaceId: string): Promise<ArtifactWorkspaceRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.artifactWorkspaces.find((workspace) => workspace.id === workspaceId));
  }

  async getForPageVersion(pageVersionId: string): Promise<ArtifactWorkspaceRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(
      state.artifactWorkspaces.find((workspace) => workspace.pageVersionId === pageVersionId)
    );
  }

  async listForProject(projectId: string): Promise<ArtifactWorkspaceRecord[]> {
    const state = await readState(this.filePath);
    return state.artifactWorkspaces
      .filter((workspace) => workspace.projectId === projectId)
      .sort(compareCreatedAtThenId)
      .map(copy);
  }

  async listAll(): Promise<ArtifactWorkspaceRecord[]> {
    const state = await readState(this.filePath);
    return state.artifactWorkspaces.sort(compareCreatedAtThenId).map(copy);
  }
}

class JsonFileArtifactWorkspaceFileRepository implements ArtifactWorkspaceFileRepository {
  constructor(private readonly filePath: string) {}

  async save(file: ArtifactWorkspaceFileRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.artifactWorkspaceFiles = upsertBy(
        state.artifactWorkspaceFiles,
        copy(file),
        (record) => record.id === file.id
      );
    });
  }

  async getByPath(input: {
    workspaceId: string;
    path: ArtifactWorkspaceFilePath;
  }): Promise<ArtifactWorkspaceFileRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(
      state.artifactWorkspaceFiles.find(
        (file) => file.workspaceId === input.workspaceId && file.path === input.path
      )
    );
  }

  async listForWorkspace(workspaceId: string): Promise<ArtifactWorkspaceFileRecord[]> {
    const state = await readState(this.filePath);
    return state.artifactWorkspaceFiles
      .filter((file) => file.workspaceId === workspaceId)
      .sort(compareArtifactWorkspaceFiles)
      .map(copy);
  }

  async listAll(): Promise<ArtifactWorkspaceFileRecord[]> {
    const state = await readState(this.filePath);
    return state.artifactWorkspaceFiles.sort(compareArtifactWorkspaceFiles).map(copy);
  }
}
```

Update default state creation and old-file loading so missing arrays default to `[]`:

```ts
artifactWorkspaces: Array.isArray(parsed.artifactWorkspaces) ? parsed.artifactWorkspaces.map(copy) : [],
artifactWorkspaceFiles: Array.isArray(parsed.artifactWorkspaceFiles) ? parsed.artifactWorkspaceFiles.map(copy) : [],
```

- [ ] **Step 7: Run db tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/db test
pnpm --filter @lp-agent/db typecheck
```

Expected: both commands pass.

- [ ] **Step 8: Commit repository layer**

```bash
git add packages/db/src/workbench-repositories.ts packages/db/src/json-file-workbench-repositories.ts packages/db/src/workbench-repositories.test.ts packages/db/src/json-file-workbench-repositories.test.ts
git commit -m "add artifact workspace repositories"
```

## Task 3: API Page Version Workspace Creation

**Files:**

- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/services.test.ts`

- [ ] **Step 1: Write failing service tests for workspace creation**

In `packages/api/src/services.test.ts`, add a test near existing `generatePageVersion` tests:

```ts
it("creates an artifact workspace when generating a page version", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const runtime = new RecordingRuntime({ state: "completed", artifacts: completeArtifacts() });
  const service = new DemoWorkbenchService({
    repositories,
    builderRuntime: runtime,
    now: fixedClock()
  });
  const project = await service.createProject({ name: "Project" });
  const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });

  const pageVersion = await service.generatePageVersion({
    projectId: project.id,
    briefId: brief.id
  });

  expect(pageVersion.artifactWorkspaceId).toBe("artifact_workspace_1");
  await expect(repositories.artifactWorkspaces.getById("artifact_workspace_1"))
    .resolves.toMatchObject({
      id: "artifact_workspace_1",
      projectId: project.id,
      pageVersionId: pageVersion.id,
      runId: `run_builder_${pageVersion.id}`,
      kind: "static_lp",
      state: "active"
    });
  await expect(repositories.artifactWorkspaceFiles.listForWorkspace("artifact_workspace_1"))
    .resolves.toEqual([
      expect.objectContaining({ path: "index.html", content: completeArtifacts().indexHtml }),
      expect.objectContaining({ path: "styles.css", content: completeArtifacts().stylesCss }),
      expect.objectContaining({ path: "script.js", content: completeArtifacts().scriptJs })
    ]);
});
```

Add a safe event test:

```ts
it("emits artifact workspace metadata without raw artifact content", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const rawSecret = "ARTIFACT_SECRET";
  const runtime = new RecordingRuntime({
    state: "completed",
    artifacts: {
      indexHtml: `<main>${rawSecret}</main>`,
      stylesCss: "body { margin: 0; }",
      scriptJs: `console.log("${rawSecret}");`
    }
  });
  const service = new DemoWorkbenchService({
    repositories,
    builderRuntime: runtime,
    now: fixedClock()
  });
  const project = await service.createProject({ name: "Project" });
  const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });

  const pageVersion = await service.generatePageVersion({
    projectId: project.id,
    briefId: brief.id
  });

  const events = await repositories.runEvents.listForRun(`run_builder_${pageVersion.id}`);
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "artifact.workspace.created",
        payload: expect.objectContaining({
          artifactWorkspaceId: "artifact_workspace_1",
          pageVersionId: pageVersion.id,
          files: expect.arrayContaining([
            expect.objectContaining({ path: "index.html", sha256: expect.any(String) })
          ])
        })
      })
    ])
  );
  const serializedEvents = JSON.stringify(events);
  expect(serializedEvents).not.toContain(rawSecret);
  expect(serializedEvents).not.toContain("<main>");
  expect(serializedEvents).not.toContain("console.log");
});
```

- [ ] **Step 2: Run targeted service tests to verify RED**

Run:

```bash
pnpm test packages/api/src/services.test.ts
```

Expected: FAIL because `artifactWorkspaceId` and workspace creation are not implemented.

- [ ] **Step 3: Add workspace id reservation and creation helper**

In `packages/api/src/index.ts`, extend imports from `@lp-agent/artifacts`:

```ts
import {
  createArtifactWorkspaceManifest,
  createStaticArtifactWorkspaceFiles,
  staticArtifactsFromWorkspaceFiles,
  type StaticArtifacts
} from "@lp-agent/artifacts";
```

Inside `generatePageVersion()`, reserve a workspace id after reserving page version id:

```ts
const artifactWorkspaceId = await reserveRepositoryId(
  this.repositories,
  "artifact_workspace",
  async () => {
    const existingWorkspaces = await this.repositories.artifactWorkspaces.listAll();
    return existingWorkspaces.map((record) => record.id);
  }
);
```

Release it in the `finally` block:

```ts
releaseRepositoryId(this.repositories, artifactWorkspaceId);
```

Inside the `withRepositoryIdLock()` block, create the workspace and files before saving the page version:

```ts
const createdAt = this.timestamp();
const workspace = {
  id: artifactWorkspaceId,
  projectId: input.projectId,
  pageVersionId,
  runId: run.id,
  kind: "static_lp" as const,
  state: "active" as const,
  createdAt,
  updatedAt: createdAt
};
const workspaceFiles = createStaticArtifactWorkspaceFiles({
  workspaceId: artifactWorkspaceId,
  projectId: input.projectId,
  pageVersionId,
  artifacts,
  createdAt
});
const pageVersion: PageVersionRecord = {
  id: pageVersionId,
  projectId: input.projectId,
  briefId: brief.id,
  artifactWorkspaceId,
  artifacts: copyArtifacts(artifacts),
  reviewStatus: "pending",
  findings: [],
  createdAt
};
await this.repositories.artifactWorkspaces.save(workspace);
for (const file of workspaceFiles) {
  await this.repositories.artifactWorkspaceFiles.save(file);
}
await this.repositories.pageVersions.save(pageVersion);
```

- [ ] **Step 4: Emit a safe workspace-created run event**

After the `withRepositoryIdLock()` block and before `saveHandoffForRun()`, load files and append a safe event:

```ts
const workspaceFiles = await this.repositories.artifactWorkspaceFiles.listForWorkspace(
  artifactWorkspaceId
);
const manifest = createArtifactWorkspaceManifest({
  workspaceId: artifactWorkspaceId,
  projectId: input.projectId,
  pageVersionId: pageVersion.id,
  files: workspaceFiles
});
await this.repositories.runEvents.save({
  id: `${run.id}_event_${events.length + 1}`,
  runId: run.id,
  projectId: input.projectId,
  sequence: events.length + 1,
  type: "artifact.workspace.created",
  message: "Artifact workspace created for static LP files.",
  payload: {
    artifactWorkspaceId,
    pageVersionId: pageVersion.id,
    files: manifest.files
  },
  createdAt: nextRepositoryTimestamp(this.repositories, this.now)
});
```

Then increment the handoff event sequence from `events.length + 1` to `events.length + 2`.

- [ ] **Step 5: Update copy helpers**

Update `copyPageVersion()`:

```ts
function copyPageVersion(pageVersion: PageVersionRecord): PageVersionRecord {
  return {
    ...pageVersion,
    ...(pageVersion.artifactWorkspaceId
      ? { artifactWorkspaceId: pageVersion.artifactWorkspaceId }
      : {}),
    artifacts: copyArtifacts(pageVersion.artifacts),
    findings: pageVersion.findings.map(copyFinding)
  };
}
```

- [ ] **Step 6: Run targeted service tests**

Run:

```bash
pnpm test packages/api/src/services.test.ts
pnpm --filter @lp-agent/api typecheck
```

Expected: both commands pass.

- [ ] **Step 7: Commit page version workspace creation**

```bash
git add packages/api/src/index.ts packages/api/src/services.test.ts
git commit -m "create artifact workspaces for page versions"
```

## Task 4: Workspace-Backed Artifact Recovery

**Files:**

- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/services.test.ts`
- Modify: `apps/web/src/lib/chat-workbench.test.ts`

- [ ] **Step 1: Write failing tests for workspace-backed snapshot hydration and fallback**

In `packages/api/src/services.test.ts`, add:

```ts
it("hydrates snapshot page artifacts from artifact workspace files when available", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
  const project = await service.createProject({ name: "Project" });
  const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
  const version = await service.generatePageVersion({ projectId: project.id, briefId: brief.id });
  await repositories.artifactWorkspaceFiles.save({
    id: "artifact_workspace_1_file_index_html",
    workspaceId: version.artifactWorkspaceId!,
    projectId: project.id,
    path: "index.html",
    kind: "html",
    mimeType: "text/html",
    sizeBytes: 18,
    sha256: "b".repeat(64),
    summary: "index.html static LP file",
    content: "<main>Recovered</main>",
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z"
  });

  const snapshot = await service.getSnapshot(project.id);

  expect(snapshot.currentPageVersion?.artifacts.indexHtml).toBe("<main>Recovered</main>");
});

it("falls back to embedded artifacts when workspace files are missing", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
  const project = await service.createProject({ name: "Project" });
  const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
  const embeddedArtifacts = completeArtifacts();
  await repositories.pageVersions.save({
    id: "version_1",
    projectId: project.id,
    briefId: brief.id,
    artifactWorkspaceId: "missing_workspace",
    artifacts: embeddedArtifacts,
    reviewStatus: "passed",
    findings: [],
    createdAt: "2026-05-18T00:00:00.000Z",
  });

  const snapshot = await service.getSnapshot(project.id);

  expect(snapshot.currentPageVersion?.artifacts).toEqual(embeddedArtifacts);
});
```

In `apps/web/src/lib/chat-workbench.test.ts`, extend `pageVersionFixture()` with:

```ts
artifactWorkspaceId: "artifact_workspace_1",
```

Add:

```ts
it("keeps artifact cards stable when page versions have workspace metadata", () => {
  const copy = getWorkbenchCopy("en");
  const pageVersion = pageVersionFixture();
  const downloadLinks = createArtifactDownloadLinks(pageVersion.artifacts, copy.exports);

  const thread = createChatWorkbenchThread({
    copy,
    prompt: "Build LP",
    objective: "Launch",
    pageVersion,
    downloadLinks
  });

  expect(thread.artifacts.map((artifact) => artifact.filename)).toEqual([
    "index.single.html",
    "index.html",
    "styles.css",
    "script.js"
  ]);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
pnpm test packages/api/src/services.test.ts apps/web/src/lib/chat-workbench.test.ts
```

Expected: FAIL for hydration because snapshots still return embedded artifacts only.

- [ ] **Step 3: Add page-version hydration helper**

In `packages/api/src/index.ts`, add:

```ts
private async hydratePageVersionArtifacts(
  pageVersion: PageVersionRecord
): Promise<PageVersionRecord> {
  if (!pageVersion.artifactWorkspaceId) {
    return copyPageVersion(pageVersion);
  }

  const files = await this.repositories.artifactWorkspaceFiles.listForWorkspace(
    pageVersion.artifactWorkspaceId
  );
  try {
    return {
      ...copyPageVersion(pageVersion),
      artifacts: staticArtifactsFromWorkspaceFiles(files)
    };
  } catch {
    return copyPageVersion(pageVersion);
  }
}
```

Use it in `getSnapshot()`:

```ts
const hydratedPageVersion = currentPageVersion
  ? await this.hydratePageVersionArtifacts(currentPageVersion)
  : undefined;
```

Return `hydratedPageVersion` instead of `copyPageVersion(currentPageVersion)`.

Use `hydratePageVersionArtifacts()` in `getSnapshotForRecords()` with this pattern before returning `currentPageVersion`:

```ts
const hydratedPageVersion = currentPageVersion
  ? await this.hydratePageVersionArtifacts(currentPageVersion)
  : undefined;
```

Return `hydratedPageVersion` in the snapshot payload.

- [ ] **Step 4: Run hydration tests**

Run:

```bash
pnpm test packages/api/src/services.test.ts apps/web/src/lib/chat-workbench.test.ts
pnpm --filter @lp-agent/api typecheck
pnpm --filter @lp-agent/web typecheck
```

Expected: all commands pass.

- [ ] **Step 5: Commit artifact recovery**

```bash
git add packages/api/src/index.ts packages/api/src/services.test.ts apps/web/src/lib/chat-workbench.test.ts
git commit -m "hydrate page artifacts from workspace files"
```

## Task 5: Context Memory and Runtime Context Metadata

**Files:**

- Modify: `packages/api/src/context-memory.ts`
- Modify: `packages/api/src/context-memory.test.ts`
- Modify: `packages/api/src/context-assembler.ts`
- Modify: `packages/api/src/services.test.ts`
- Modify: `packages/runtime-adapters/src/index.ts`
- Modify: `packages/runtime-adapters/src/index.test.ts`

- [ ] **Step 1: Write failing context memory test for workspace metadata**

In `packages/api/src/context-memory.test.ts`, add:

```ts
it("summarizes workspace artifacts with hashes without full source", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  await repositories.briefs.save({
    id: "brief_1",
    projectId: "project_1",
    prompt: "Build a spring sale landing page",
    brief: sampleBrief,
    createdAt: "2026-05-14T00:00:00.000Z"
  });
  await repositories.pageVersions.save({
    id: "page_version_1",
    projectId: "project_1",
    briefId: "brief_1",
    artifactWorkspaceId: "artifact_workspace_1",
    artifacts: {
      indexHtml: "<main>legacy secret-token</main>",
      stylesCss: "body { color: red; }",
      scriptJs: "console.log('legacy secret-token');"
    },
    reviewStatus: "passed",
    findings: [],
    createdAt: "2026-05-14T00:03:00.000Z"
  });
  await repositories.artifactWorkspaceFiles.save({
    id: "artifact_workspace_1_file_index_html",
    workspaceId: "artifact_workspace_1",
    projectId: "project_1",
    path: "index.html",
    kind: "html",
    mimeType: "text/html",
    sizeBytes: 18,
    sha256: "a".repeat(64),
    summary: "index.html static LP file",
    content: "<main>secret-token</main>",
    createdAt: "2026-05-14T00:03:00.000Z",
    updatedAt: "2026-05-14T00:03:00.000Z"
  });

  const memory = await assembleContextMemory({
    repositories,
    projectId: "project_1",
    role: "builder",
    input: { prompt: "Build a spring sale page", brief: sampleBrief }
  });

  expect(memory.artifacts[0]).toMatchObject({
    pageVersionId: "page_version_1",
    artifactWorkspaceId: "artifact_workspace_1",
    files: [
      {
        name: "index.html",
        characterCount: 25,
        sizeBytes: 18,
        sha256: "a".repeat(64),
        summary: "index.html static LP file"
      }
    ]
  });
  const serialized = JSON.stringify(memory);
  expect(serialized).not.toContain("secret-token");
  expect(serialized).not.toContain("<main>");
});
```

- [ ] **Step 2: Write failing RuntimeRunContext schema test**

In `packages/api/src/services.test.ts`, update the `"assembles and validates a role-specific context pack"` expectation to include durable metadata support:

```ts
artifactWorkspace: {
  mode: "memory",
  writableFiles: ["index.html", "styles.css", "script.js"]
}
```

Add a new schema parse case near `ContextPackSchema.parse` tests:

```ts
expect(() =>
  ContextPackSchema.parse({
    projectId: "project_1",
    role: "builder",
    input: {},
    runtimeContext: {
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
            sizeBytes: 18,
            sha256: "a".repeat(64),
            summary: "index.html static LP file"
          }
        ]
      }
    },
    trace: { injected: [], omitted: [] },
    createdAt: "2026-05-18T00:00:00.000Z"
  })
).not.toThrow();
```

- [ ] **Step 3: Run targeted tests to verify RED**

Run:

```bash
pnpm test packages/api/src/context-memory.test.ts packages/api/src/services.test.ts
pnpm --filter @lp-agent/runtime-adapters test
```

Expected: FAIL because context schemas and memory summaries do not include workspace metadata yet.

- [ ] **Step 4: Extend runtime artifact workspace types and schema**

In `packages/runtime-adapters/src/index.ts`, import manifest file type:

```ts
import type { ArtifactWorkspaceManifestFile } from "@lp-agent/artifacts";
```

Extend `RuntimeArtifactWorkspace`:

```ts
export interface RuntimeArtifactWorkspace {
  mode: RuntimeArtifactWorkspaceMode;
  basePath?: string;
  workspaceId?: string;
  writableFiles: string[];
  files?: ArtifactWorkspaceManifestFile[];
}
```

In `packages/api/src/context-assembler.ts`, extend `RuntimeArtifactWorkspaceSchema`:

```ts
const RuntimeArtifactWorkspaceFileSchema = z.object({
  path: z.enum(["index.html", "styles.css", "script.js"]),
  kind: z.enum(["html", "css", "js"]),
  mimeType: z.enum(["text/html", "text/css", "text/javascript"]),
  sizeBytes: z.number().int().min(0),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  summary: z.string().min(1)
});

const RuntimeArtifactWorkspaceSchema = z.object({
  mode: z.enum(["memory", "filesystem"]),
  basePath: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  writableFiles: z.array(z.string().min(1)),
  files: z.array(RuntimeArtifactWorkspaceFileSchema).optional()
});
```

- [ ] **Step 5: Extend context memory schemas and summaries**

In `packages/api/src/context-memory.ts`, extend `ContextMemoryFileSchema`:

```ts
const ContextMemoryFileSchema = z.object({
  name: z.enum(["index.html", "styles.css", "script.js"]),
  characterCount: z.number().int().min(0),
  sizeBytes: z.number().int().min(0).optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  summary: z.string().min(1).optional()
});
```

Extend `ContextMemoryArtifactSummarySchema`:

```ts
artifactWorkspaceId: z.string().min(1).optional(),
```

Modify `summarizeArtifacts()` to load workspace files. Because it is currently synchronous, change it to async:

```ts
async function summarizeArtifacts(input: {
  repositories: WorkbenchRepositories;
  pageVersions: PageVersionRecord[];
  briefs: BriefRecord[];
}): Promise<ContextMemoryArtifactSummary[]> {
  const briefsById = new Map(
    input.briefs.map((brief) => [`${brief.projectId}:${brief.id}`, brief] as const)
  );
  const summaries = [];
  for (const pageVersion of input.pageVersions) {
    const brief = briefsById.get(`${pageVersion.projectId}:${pageVersion.briefId}`);
    const title = toOptionalNonEmptyString(brief?.brief.title);
    const objective = toOptionalNonEmptyString(brief?.brief.objective);
    const workspaceFiles = pageVersion.artifactWorkspaceId
      ? await input.repositories.artifactWorkspaceFiles.listForWorkspace(pageVersion.artifactWorkspaceId)
      : [];
    const files = workspaceFiles.length > 0
      ? workspaceFiles.map((file) => ({
          name: file.path,
          characterCount: file.content.length,
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
          summary: file.summary
        }))
      : [
          { name: "index.html" as const, characterCount: pageVersion.artifacts.indexHtml.length },
          { name: "styles.css" as const, characterCount: pageVersion.artifacts.stylesCss.length },
          { name: "script.js" as const, characterCount: pageVersion.artifacts.scriptJs.length }
        ];
    summaries.push({
      pageVersionId: pageVersion.id,
      briefId: pageVersion.briefId,
      ...(title ? { title } : {}),
      ...(objective ? { objective } : {}),
      ...(pageVersion.artifactWorkspaceId ? { artifactWorkspaceId: pageVersion.artifactWorkspaceId } : {}),
      files,
      createdAt: pageVersion.createdAt,
      score: scoreArtifact(pageVersion)
    });
  }
  return summaries.sort(compareScoredArtifacts);
}
```

Update the call site:

```ts
const artifactSummaries = await summarizeArtifacts({
  repositories: input.repositories,
  pageVersions,
  briefs
});
```

- [ ] **Step 6: Run context tests and typechecks**

Run:

```bash
pnpm test packages/api/src/context-memory.test.ts packages/api/src/services.test.ts
pnpm --filter @lp-agent/api typecheck
pnpm --filter @lp-agent/runtime-adapters typecheck
```

Expected: all commands pass.

- [ ] **Step 7: Commit context metadata**

```bash
git add packages/api/src/context-memory.ts packages/api/src/context-memory.test.ts packages/api/src/context-assembler.ts packages/api/src/services.test.ts packages/runtime-adapters/src/index.ts packages/runtime-adapters/src/index.test.ts
git commit -m "inject artifact workspace metadata into context"
```

## Task 6: Documentation and Final Verification

**Files:**

- Modify: `docs/agent-development-learning.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Update Stage 14 learning status**

In `docs/agent-development-learning.md`, replace:

```md
当前实现状态：

- Stage 14 v0 已规划本地 durable artifact workspace：`@lp-agent/artifacts` 负责 manifest/hash/summary 纯 helper，`@lp-agent/db` 负责 workspace/file repository，API 在 page version 生成时创建 workspace，Context Pack 注入 metadata 而不是全文。
```

With:

```md
当前实现状态：

- Stage 14 v0 已实现本地 durable artifact workspace：`@lp-agent/artifacts` 提供 manifest/hash/summary 纯 helper，`@lp-agent/db` 持久化 workspace/file repository，API 在 page version 生成时创建 workspace，Web snapshot 可从 workspace 恢复产物，Context Pack 注入 metadata 而不是全文。
```

- [ ] **Step 2: Confirm the plan is in the Superpowers index**

In `docs/superpowers/README.md`, ensure item 57 is present after item 56:

```md
57. `plans/2026-05-18-durable-artifact-workspace.md`
   - Stage 14 durable artifact workspace v0 implementation plan.
   - Read this after the Stage 14 design when implementing or auditing artifact workspace helper types, local repository persistence, page-version workspace creation, workspace-backed artifact recovery, metadata-first context injection, and documentation updates.
```

- [ ] **Step 3: Run targeted verification**

Run:

```bash
pnpm --filter @lp-agent/artifacts test
pnpm --filter @lp-agent/db test
pnpm test packages/api/src/services.test.ts packages/api/src/context-memory.test.ts apps/web/src/lib/chat-workbench.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected:

- all Vitest suites pass, except existing opt-in model integration tests remain skipped;
- typecheck passes;
- build passes;
- `git diff --check` prints no output.

- [ ] **Step 5: Commit docs**

```bash
git add docs/agent-development-learning.md docs/superpowers/README.md
git commit -m "document durable artifact workspace implementation"
```

## Plan Self-Review

- Spec coverage: the plan covers artifact workspace domain helpers, repository contracts, JSON-file persistence, page-version binding, run event metadata, workspace-backed artifact recovery, context memory metadata injection, no full-content context injection, Web artifact stability, and documentation.
- Scope guard: the plan explicitly excludes real deployment, real shell, MCP execution, daemon workers, streaming logs, object storage, Postgres blobs, desktop-local directories, binary assets, and direct file editing.
- Type consistency: `artifactWorkspaceId`, `ArtifactWorkspaceRecord`, `ArtifactWorkspaceFileRecord`, `ArtifactWorkspaceManifest`, `createStaticArtifactWorkspaceFiles()`, `createArtifactWorkspaceManifest()`, and `staticArtifactsFromWorkspaceFiles()` are introduced before later tasks use them.
- Testability: each implementation task starts with failing tests, runs targeted verification, and commits a focused slice.
