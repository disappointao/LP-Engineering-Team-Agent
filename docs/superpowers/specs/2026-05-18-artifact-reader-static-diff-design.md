# Artifact Reader and Static Diff v0 Design

## Purpose

Stage 15 adds the first controlled read boundary for durable LP artifact
workspaces.

Stage 14 made generated `index.html`, `styles.css`, and `script.js` durable
through local artifact workspace records and metadata-only manifests. The next
gap is that future reviewers, deployment skills, MCP tools, desktop workspaces,
and model context assembly need a safe way to read small artifact content
snippets or compare two artifact versions without bypassing project ownership,
file allowlists, content size limits, and metadata-first context rules.

This stage introduces an `ArtifactReader` and static artifact diff helpers. It
does not add real MCP execution, real deployment, shell execution, file editing,
or desktop filesystem workspaces. It creates the read/diff boundary those later
features can reuse.

## Current Baseline

The project already has:

- framework-free generated LP artifacts:
  - `index.html`;
  - `styles.css`;
  - `script.js`;
- local durable `ArtifactWorkspaceRecord` and `ArtifactWorkspaceFileRecord`
  persistence;
- workspace-backed snapshot recovery for preview and export;
- metadata-only artifact workspace manifests in Context Memory, Context Pack,
  runtime context, and model gateway requests;
- worker queue handoff that intentionally avoids raw artifact content in
  persisted payloads.

The main gap is controlled artifact reads:

- callers can recover full artifacts through snapshot-oriented APIs, but there
  is no explicit service boundary for reading one allowed workspace file;
- context assembly cannot request a short, bounded snippet for a specific role
  without risking full content injection;
- reviewer/deployer/tool code cannot compare two page versions by manifest and
  hash through a reusable diff helper;
- future worker or MCP payloads have workspace ids and manifests, but no shared
  rule for when raw content can be read.

## Confirmed Direction

For this stage:

- Keep generated LP output framework-free static HTML/CSS/JS.
- Read only the canonical static LP paths from Stage 14:
  - `index.html`;
  - `styles.css`;
  - `script.js`.
- Validate workspace, file, project, and optional page-version ownership before
  returning content.
- Default to metadata-first output.
- Allow bounded snippets only through an explicit read input.
- Keep full file bodies out of Context Pack by default.
- Add deterministic static diffs based on path, hash, byte size, file kind, MIME
  type, and safe summaries.
- Do not introduce real shell execution, MCP execution, deployment, object
  storage, desktop filesystem paths, or file editing.

## Goals

1. Add an artifact reader service boundary that can read a single allowed
   workspace file after validating scope.
2. Support bounded content snippets for model/runtime context when a future role
   explicitly requests them.
3. Add static diff helpers for comparing two artifact workspace manifests.
4. Add API-level helper methods for reading a workspace file and comparing page
   version workspaces.
5. Emit only safe read/diff metadata in run events or context traces.
6. Keep default Context Pack behavior metadata-only, with optional snippet
   injection guarded by size and path limits.
7. Preserve legacy page-version snapshot fallback for preview/export, but make
   new read/diff code require durable artifact workspaces.
8. Document the learning path so future MCP execution, deployment, desktop
   workspaces, and file diff UI use this reader/diff boundary instead of raw
   repository access.

## Non-Goals

Stage 15 does not build:

- MCP execution;
- real deployment;
- real shell execution, `child_process`, `spawn`, `exec`, shell parsing, or OS
  signal handling;
- desktop-local filesystem workspace mapping;
- direct file editing UI;
- model-generated code repair loops;
- streaming file reads;
- streaming diff UI;
- binary asset reads;
- image upload or optimization;
- large file chunking;
- vector retrieval over artifact content;
- cross-project artifact search;
- object storage or Postgres blob migration;
- secret scanning beyond the existing bounded metadata and redaction rules.

## Artifact Reader Contract

The reader should live at the service/API boundary, not inside Web components.
It should depend on repository contracts and pure artifact helpers.

Suggested service input:

```ts
export interface ReadArtifactWorkspaceFileInput {
  projectId: string;
  workspaceId: string;
  path: "index.html" | "styles.css" | "script.js";
  pageVersionId?: string;
  maxBytes?: number;
  includeContent?: boolean;
}
```

Suggested result:

```ts
export interface ArtifactWorkspaceFileReadResult {
  workspaceId: string;
  projectId: string;
  pageVersionId?: string;
  file: {
    path: "index.html" | "styles.css" | "script.js";
    kind: "html" | "css" | "js";
    mimeType: "text/html" | "text/css" | "text/javascript";
    sizeBytes: number;
    sha256: string;
    summary: string;
  };
  content?: string;
  truncated: boolean;
  omittedReason?: "content_not_requested" | "size_limit_exceeded";
}
```

Rules:

- `workspaceId` must exist.
- `workspace.projectId` must match `input.projectId`.
- if `input.pageVersionId` is provided, the workspace must belong to that page
  version.
- the file path must be one of the canonical static LP paths.
- the file record must belong to the same workspace and project.
- the stored file metadata must remain consistent with file content:
  - byte size;
  - SHA-256 hash.
- if `includeContent` is false or omitted, return metadata only.
- if `includeContent` is true and content exceeds `maxBytes`, return metadata
  only with `truncated: true` and `omittedReason: "size_limit_exceeded"`.
- if `includeContent` is true and content is within the byte limit, return full
  content for that one file only.

The default byte limit should be small enough for context use and deterministic
tests. A suggested default is `8_192` bytes per file. Future UI download/export
paths should continue using the existing snapshot recovery path and are not
limited by this context-oriented reader.

## Static Diff Contract

Diff v0 should compare metadata and produce a compact, deterministic summary.

Suggested input:

```ts
export interface DiffArtifactWorkspacesInput {
  projectId: string;
  fromWorkspaceId: string;
  toWorkspaceId: string;
  fromPageVersionId?: string;
  toPageVersionId?: string;
}
```

Suggested result:

```ts
export interface ArtifactWorkspaceDiffResult {
  projectId: string;
  fromWorkspaceId: string;
  toWorkspaceId: string;
  files: Array<{
    path: "index.html" | "styles.css" | "script.js";
    state: "unchanged" | "changed" | "added" | "removed";
    from?: {
      sizeBytes: number;
      sha256: string;
      summary: string;
    };
    to?: {
      sizeBytes: number;
      sha256: string;
      summary: string;
    };
  }>;
  changedFileCount: number;
}
```

Rules:

- both workspaces must belong to the same `projectId`;
- optional page-version ids must match the corresponding workspace records;
- diff order is always `index.html`, `styles.css`, `script.js`;
- `unchanged` is determined by identical `sha256`;
- v0 does not compute line-by-line textual diffs;
- v0 does not include full content in the diff result.

This gives later Reviewer, MCP, and deployment flows a safe answer to "what
changed?" without reading full artifact bodies.

## Context Assembly

Default Context Pack behavior remains metadata-only.

Stage 15 may add an optional `artifactSnippets` section for explicitly requested
role context. It should be empty by default and bounded by:

- project id;
- workspace id;
- allowed file path;
- max bytes per file;
- max snippets per context pack;
- trace metadata explaining which snippets were included or omitted.

Suggested shape:

```ts
artifactSnippets: [
  {
    workspaceId: "artifact_workspace_1",
    path: "styles.css",
    sizeBytes: 2048,
    sha256: "...",
    content: "body { ... }",
    truncated: false
  }
]
```

This section should not be passed through model gateway unless the gateway
schema explicitly allows it. Stage 15 should keep model request defaults
metadata-only unless a test-covered role path opts into snippets.

## API and Runtime Usage

The API service should expose helper methods that internal callers can use:

- read one artifact workspace file;
- compare two artifact workspaces;
- compare two page versions by resolving their artifact workspaces.

These helpers should be used by future features instead of direct repository
access.

Current Web preview/export should keep using snapshot recovery. This stage may
surface a compact diff summary in the Web view if it can be done without adding
a full diff UI, but UI polish is not required for the reader boundary.

## Error Handling

Reader and diff helpers should fail closed with explicit error codes:

- `artifact_workspace_not_found`;
- `artifact_workspace_project_mismatch`;
- `artifact_workspace_page_version_mismatch`;
- `artifact_workspace_file_not_found`;
- `artifact_workspace_file_project_mismatch`;
- `artifact_workspace_file_integrity_mismatch`;
- `artifact_workspace_file_path_not_allowed`;
- `artifact_workspace_file_too_large`;
- `artifact_workspace_diff_not_available`.

Errors may be mapped to safe run event metadata. They must not include file
content, secrets, raw stack traces, or local filesystem paths.

## Testing

Stage 15 should cover:

- successful metadata-only read;
- successful bounded content read for each canonical file path;
- rejection of non-canonical paths;
- project mismatch rejection;
- page-version mismatch rejection;
- missing workspace and missing file errors;
- integrity mismatch rejection after corrupted stored content;
- size-limit omission behavior;
- deterministic metadata-only diff for unchanged, changed, added, and removed
  file states;
- Context Pack default remains metadata-only;
- optional snippet injection is bounded and traceable if implemented in this
  stage;
- model gateway/runtime schemas do not accidentally pass raw artifact content by
  default.

## Acceptance Criteria

- Generated LP artifacts remain static HTML/CSS/JS.
- No real deployment, MCP execution, shell execution, desktop filesystem access,
  or file editing is introduced.
- Artifact reads require project ownership checks and allowed static LP paths.
- Content is returned only when explicitly requested and within byte limits.
- Diff results are deterministic and metadata-only.
- Context Pack remains metadata-only by default.
- Documentation explains that future MCP/deployment/desktop features should
  reuse the artifact reader and diff boundary.

## Future Work

After this stage, the next likely increments are:

- Web diff cards that visualize the metadata-only diff without showing full
  source by default;
- Reviewer role snippet opt-in for small CSS/HTML sections;
- deployment skill worker payloads that reference `artifactWorkspaceId` and read
  files through the reader at execution time;
- MCP artifact read tools backed by the same reader contract;
- desktop-local workspace adapters that implement the same read/diff semantics
  over local directories;
- line-level textual diff and selected file snippets after the safe metadata
  diff path is stable.
