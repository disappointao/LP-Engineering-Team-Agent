# Durable Artifact Workspace v0 Design

## Purpose

Stage 14 adds a durable local artifact workspace foundation for generated LP
files.

The goal is to stop treating generated `index.html`, `styles.css`, and
`script.js` only as transient in-memory page-version fields. Instead, each
generated static LP can be represented by a workspace id plus a bounded file
manifest that can survive Web refreshes, local process restarts, and future
worker handoff.

This stage is still local-first and safety-first. It does not add real
deployment, real shell execution, MCP execution, external object storage, or a
desktop filesystem workspace. It creates the durable artifact boundary that
later real deployment adapters, worker jobs, MCP tools, and desktop-local
workspaces can reuse.

## Current Baseline

The project already has:

- framework-free generated LP artifacts represented as:
  - `index.html`;
  - `styles.css`;
  - `script.js`;
- `PageVersion` records with generated artifact content;
- JSON-file repository persistence for the Web workbench;
- `ContextPack` assembly with artifact workspace metadata placeholders;
- `ToolObservationRecord` and run events that can reference safe artifact
  metadata;
- worker queue handoff with safe persisted payloads that intentionally do not
  persist raw artifact content or local ephemeral paths;
- Web preview/export behavior that can render or download the current static
  artifacts.

The main gap is that artifact state is not yet a durable workspace object:

- there is no stable `artifactWorkspaceId` that can be passed to a worker or
  future deployment adapter;
- there is no file manifest with paths, hashes, byte sizes, MIME types, and
  content summaries;
- context assembly cannot safely inject artifact file metadata without relying
  on transient page-version contents;
- worker payloads cannot refer to generated LP files without either omitting
  them or incorrectly copying raw content into the job payload.

## Confirmed Direction

For this stage:

- Use the existing local JSON-file persistence direction.
- Store enough artifact content snapshot data to recover generated LP files
  after refresh or restart.
- Keep the generated LP output framework-free.
- Keep context injection metadata-first; do not inject full file bodies by
  default.
- Do not introduce S3, Postgres file blobs, real deployment, shell execution,
  MCP execution, or OS-level filesystem sandboxing.

## Goals

1. Add a durable artifact workspace domain model for static LP artifacts.
2. Persist workspace records and file records through repository interfaces.
3. Provide JSON-file and in-memory repository implementations for local Web V1.
4. Bind page versions and relevant run events to an `artifactWorkspaceId`.
5. Generate deterministic file metadata:
   - relative path;
   - file kind;
   - MIME type;
   - byte size;
   - content hash;
   - safe summary;
   - created and updated timestamps.
6. Let Web preview/export recover artifacts from the workspace when available.
7. Let `ContextPack` include artifact workspace summaries and manifests without
   default full-content injection.
8. Keep worker and deployment extension points ready to pass
   `artifactWorkspaceId` and file manifest references instead of raw artifact
   content.

## Non-Goals

Stage 14 does not build:

- real deployment;
- real shell execution, `child_process`, `spawn`, `exec`, shell parsing, or OS
  signal handling;
- MCP execution;
- worker daemon polling;
- streaming logs;
- external object storage;
- Postgres blob storage or migrations;
- desktop-local directory management;
- direct user editing of workspace files;
- binary asset storage;
- image upload or optimization;
- large file chunking;
- full diff UI;
- multi-version garbage collection;
- secret handling for artifact workspaces.

## Artifact Shape

The first artifact workspace supports the canonical LP file set:

```text
index.html
styles.css
script.js
```

Additional files are out of scope for v0. Future versions can add assets,
images, JSON data files, generated screenshots, packaged zip exports, and
framework-specific adapters without changing the v0 concept.

The file paths must be normalized project-relative paths. Absolute filesystem
paths are not part of the persisted manifest.

## Domain Model

Introduce the domain model and pure validation/manifest helpers in
`@lp-agent/artifacts`. Add persistence contracts to the existing
`@lp-agent/db` workbench repository bundle, because local Web state already
flows through that package.

Suggested types:

```ts
export type ArtifactWorkspaceKind = "static_lp";

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

export type ArtifactWorkspaceFileKind = "html" | "css" | "js";

export interface ArtifactWorkspaceFileRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  path: "index.html" | "styles.css" | "script.js";
  kind: ArtifactWorkspaceFileKind;
  mimeType: "text/html" | "text/css" | "text/javascript";
  sizeBytes: number;
  sha256: string;
  summary: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactWorkspaceManifest {
  workspaceId: string;
  projectId: string;
  pageVersionId?: string;
  files: Array<{
    path: string;
    kind: ArtifactWorkspaceFileKind;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    summary: string;
  }>;
}
```

The persisted file record may keep `content` for local recovery, but manifests,
run events, context packs, worker payloads, and UI process rows should use the
metadata-only shape unless a feature explicitly needs full content.

## Repository Contracts

Add repository contracts in `@lp-agent/db` that mirror the existing local
repository style:

```ts
export interface ArtifactWorkspaceRepository {
  save(record: ArtifactWorkspaceRecord): Promise<void>;
  getById(id: string): Promise<ArtifactWorkspaceRecord | undefined>;
  listForProject(projectId: string): Promise<ArtifactWorkspaceRecord[]>;
  getForPageVersion(pageVersionId: string): Promise<ArtifactWorkspaceRecord | undefined>;
}

export interface ArtifactWorkspaceFileRepository {
  save(record: ArtifactWorkspaceFileRecord): Promise<void>;
  listForWorkspace(workspaceId: string): Promise<ArtifactWorkspaceFileRecord[]>;
  getByPath(input: {
    workspaceId: string;
    path: string;
  }): Promise<ArtifactWorkspaceFileRecord | undefined>;
}
```

The first implementation should include:

- in-memory repositories for fast deterministic tests;
- JSON-file repositories for local Web persistence;
- schema validation on load so corrupted local files fail closed or recover to
  an empty state in a controlled way.

## Workspace Creation Flow

When Builder produces a valid static LP artifact set:

1. validate the static artifacts with the existing static artifact rules;
2. create or replace the page version artifact workspace;
3. write three file records:
   - `index.html`;
   - `styles.css`;
   - `script.js`;
4. compute SHA-256 hashes and byte sizes;
5. create short safe summaries;
6. bind the resulting `artifactWorkspaceId` to the page version or related run
   metadata;
7. emit a safe run event with only workspace id and manifest metadata.

The existing `PageVersion.artifacts` can remain during this stage for backward
compatibility. The workspace becomes the durable source used by new code paths
when present.

## Page Version Compatibility

Stage 14 should be additive:

- existing page versions with only embedded artifacts still render and export;
- new page versions receive an artifact workspace;
- preview/export reads workspace files first when `artifactWorkspaceId` exists;
- if workspace recovery fails, the system can fall back to embedded page-version
  artifacts and emit a bounded diagnostic event or error;
- repository tests should cover both legacy and workspace-backed page versions.

This avoids forcing a one-time data migration in the local MVP.

## Context Assembly

Context assembly should not inject full artifact file content by default.

Instead, `ContextPack` can receive a compact artifact workspace section:

```ts
artifactWorkspace: {
  workspaceId: "artifact_workspace_1",
  kind: "static_lp",
  files: [
    {
      path: "index.html",
      kind: "html",
      mimeType: "text/html",
      sizeBytes: 12345,
      sha256: "...",
      summary: "Semantic static LP HTML with hero, benefits, CTA, and footer."
    }
  ],
  omitted: ["fileContent:not_injected_by_default"]
}
```

Later model or tool steps can request specific file content through a controlled
artifact reader. That reader should enforce path allowlists, byte budgets, and
project/workspace ownership before returning content.

## Worker Queue Compatibility

Stage 14 does not make worker jobs read artifact files yet. It prepares the
safe contract for that later step.

Future worker payloads should reference artifacts like this:

```ts
{
  projectId: "project_1",
  artifactWorkspaceId: "artifact_workspace_1",
  files: [
    { path: "index.html", sha256: "..." },
    { path: "styles.css", sha256: "..." },
    { path: "script.js", sha256: "..." }
  ]
}
```

They should not persist:

- raw full file content;
- local absolute paths;
- ephemeral temp directories;
- secret values;
- cookies or API keys.

## Web Experience

The Web UI does not need a new large surface in v0.

Expected visible behavior:

- generated pages still preview and export normally;
- if a page version has workspace metadata, artifact cards may show safe file
  metadata such as path, file type, size, and hash prefix;
- no raw file system path is displayed;
- no framework-specific project tree is introduced;
- generated LP output remains static HTML/CSS/JS.

## Error Handling

Stable errors should remain bounded and localizable where they surface in Web:

- artifact workspace creation failed;
- artifact workspace missing;
- artifact workspace file missing;
- artifact workspace file failed validation;
- artifact workspace content exceeded v0 bounds.

Raw exception messages, full file content, local paths, and storage internals
should not be exposed in UI or run events.

## Safety Constraints

Artifact workspace v0 must enforce:

- only allowed relative file paths;
- only known static LP file kinds;
- text-only content;
- bounded file size;
- SHA-256 hash recalculation on save;
- no absolute paths;
- no `..` path traversal;
- no binary blobs;
- no secrets or raw environment values in summaries or events.

The workspace is an artifact persistence boundary, not a shell execution
permission boundary.

## Testing

Implementation should include tests for:

- creating a workspace from a complete static LP artifact set;
- rejecting incomplete artifact sets;
- rejecting unsupported paths and path traversal;
- computing stable hashes and byte sizes;
- JSON-file repository persistence across process-like re-instantiation;
- workspace-backed preview/export recovery;
- legacy page-version fallback when no workspace exists;
- context pack includes manifest metadata but not full file bodies;
- run events include safe workspace metadata only;
- worker-safe manifest references never include full content or absolute paths.

## Future Extension Path

This stage is designed to support later work without rewriting the API:

- real deployment adapters can read approved workspace files through a controlled
  artifact reader;
- worker jobs can pass `artifactWorkspaceId` and file hash references instead of
  raw content;
- MCP tools can operate on selected workspace files after explicit approval;
- desktop versions can map workspace records to local directories while keeping
  the same manifest contract;
- object storage can replace local JSON-file content snapshots behind the same
  repository interface;
- diff UI can compare file hashes and selected file contents;
- framework-specific artifact adapters can live beside the static LP workspace
  without changing the default LP output.
