# Web Artifact Diff Cards v0 Design

## Purpose

Stage 16 surfaces the Stage 15 artifact reader and static diff boundary in the
Web workbench.

Stage 14 made generated static LP files durable. Stage 15 added controlled
artifact reads and metadata-only static diffs. The next useful slice is to make
that state visible to users in the conversation flow: after an LP is generated,
the assistant response should show which static files exist or changed, and the
user may open a bounded snippet preview for one file.

This stage stays read-only and Web-focused. It does not add MCP execution, real
deployment, shell execution, desktop filesystem access, file editing, or
line-level textual diff.

## Current Baseline

The project already has:

- framework-free LP output as `index.html`, `styles.css`, and `script.js`;
- local durable artifact workspace/file records;
- workspace-backed preview/export recovery;
- API helpers:
  - `readArtifactWorkspaceFile`;
  - `diffArtifactWorkspaces`;
  - `diffPageVersionArtifactWorkspaces`;
- Web conversation timeline with generated artifact download cards;
- localized Chinese/English copy;
- server-rendered Next.js workbench flow.

The current gap is product visibility:

- users can download generated files, but cannot see artifact workspace metadata
  or version changes in the conversation;
- Stage 15 diff/read helpers are not yet consumed by the Web store;
- there is no safe UI path for previewing a small artifact snippet without
  defaulting to full source display.

## Confirmed Direction

For Stage 16:

- Use the existing workbench conversation view, not a new route or standalone
  file manager page.
- Add artifact diff cards under the generated artifact delivery area.
- Show metadata by default:
  - path;
  - state;
  - byte size;
  - short SHA-256 fingerprint;
  - safe summary.
- Add a same-page snippet preview triggered by a query parameter, for example
  `artifactPath=styles.css`.
- Read snippets through the artifact reader with `includeContent: true` and a
  maximum of `8_192` bytes.
- Do not show raw artifact content by default.
- Do not show full file content for files over the snippet limit.
- Keep all generated LP artifacts framework-free static HTML/CSS/JS.

## Goals

1. Add a Web-facing artifact diff view model to the workbench page state.
2. Display compact artifact diff cards in the chat delivery block.
3. Support the initial-version case where no previous page version exists.
4. Compare the current page version with the previous page version when one
   exists for the same project/brief.
5. Add a bounded snippet preview for one selected canonical file path.
6. Keep default page render metadata-only.
7. Localize all new Web copy in English and Chinese.
8. Cover safety behavior in API/Web store and page rendering tests.

## Non-Goals

Stage 16 does not build:

- a standalone Artifacts page;
- a full file explorer;
- line-level textual diff;
- editable files;
- full source display by default;
- binary assets or images;
- large-file chunking;
- vector retrieval over artifact content;
- MCP execution;
- real deployment;
- real shell execution or OS process management;
- desktop-local filesystem workspace mapping;
- streaming UI or live file updates.

## User Experience

The Web workbench keeps the Manus/ChatGPT-style conversation layout.

When an LP generation task has a completed page version, the assistant delivery
area should include:

1. existing generated file download cards;
2. a new `Artifact changes` / `文件变化` block;
3. three compact file cards for the canonical static LP files.

Each artifact diff card shows:

- file path;
- state label:
  - `Initial` / `初始`;
  - `Added` / `新增`;
  - `Changed` / `已变更`;
  - `Unchanged` / `未变更`;
  - `Removed` / `已移除`;
- byte size for the current file endpoint when available;
- short hash, such as the first 8-12 hex characters;
- safe summary;
- `Preview snippet` / `预览片段` link when the current file can be read.

Clicking the preview link reloads the same workbench page with a canonical
artifact path query parameter. The selected snippet panel appears below the
cards. The panel shows:

- path;
- byte size and short hash;
- content preview only when returned by the artifact reader;
- a safe omitted message when content is not returned, such as size limit
  exceeded or file unavailable.

The snippet panel is a read-only code block. It should not be editable and
should not look like a full IDE.

## Initial-Version Behavior

If the current LP page version has no previous comparable page version:

- do not fail the page;
- do not fabricate a `fromWorkspaceId`;
- show each current canonical file with state `initial`;
- use current artifact workspace metadata as the card source;
- allow snippet preview for current files through the reader.

This gives users useful metadata for the first generated version while keeping
the real static diff contract reserved for two-workspace comparisons.

## Previous-Version Behavior

If a previous page version exists for the same project and brief:

- compare the previous version artifact workspace to the current version
  artifact workspace through `diffPageVersionArtifactWorkspaces`;
- map `added`, `changed`, `unchanged`, and `removed` to localized labels;
- show only metadata from the diff result;
- do not include full source content in the diff cards.

The previous page version should be selected deterministically from existing
page version records:

- same `projectId`;
- same `briefId`;
- older than the current page version by repository order or timestamp;
- nearest previous version.

If previous workspace diffing fails because the previous version is missing a
durable workspace, the UI should fail soft and show the initial/current metadata
for the current version instead of exposing an unsafe error.

## Web Store Contract

Add a Web-facing artifact diff state to `WorkbenchPageState` for LP tasks.

Suggested shape:

```ts
export type WebArtifactDiffFileState =
  | "initial"
  | "added"
  | "removed"
  | "changed"
  | "unchanged";

export interface WebArtifactDiffFileView {
  path: "index.html" | "styles.css" | "script.js";
  state: WebArtifactDiffFileState;
  sizeBytes?: number;
  sha256?: string;
  shortSha256?: string;
  summary?: string;
  canPreview: boolean;
}

export interface WebArtifactSnippetView {
  path: "index.html" | "styles.css" | "script.js";
  sizeBytes: number;
  sha256: string;
  shortSha256: string;
  content?: string;
  omittedReason?: "size_limit_exceeded" | "content_not_requested" | "unavailable";
  maxBytes: number;
}

export interface WebArtifactDiffState {
  projectId: string;
  pageVersionId: string;
  artifactWorkspaceId?: string;
  previousPageVersionId?: string;
  files: WebArtifactDiffFileView[];
  selectedSnippet?: WebArtifactSnippetView;
  errorCode?: "artifact_diff_unavailable" | "artifact_snippet_unavailable";
}
```

The final implementation may adjust names, but the behavior must remain:

- default state contains no raw file content;
- `selectedSnippet.content` is present only for the explicitly selected file
  and only within the reader byte limit;
- invalid path inputs do not echo raw input into state, trace, page text, or
  logs.

## URL and Server Action Model

Use the existing server-rendered page flow.

The first version should not require a client component or modal state. The
workbench page can accept an optional query parameter:

```txt
/?artifactPath=styles.css
```

Rules:

- valid values are exactly `index.html`, `styles.css`, and `script.js`;
- invalid values are treated as unavailable and must not be echoed;
- the current task and page version still come from the session-backed
  workbench state;
- the browser cannot submit `projectId`, `workspaceId`, or `pageVersionId` for
  snippet reads.

This keeps ownership and page-version selection server-side.

## API and Data Flow

The page load should follow this flow:

1. Resolve current task/project from session as it does today.
2. Load `WorkbenchPageState`.
3. If the task is an LP task with a current page version:
   - build artifact metadata cards;
   - optionally find the previous page version;
   - call the API diff helper when previous and current durable workspaces are
     both available;
   - otherwise build initial/current metadata cards.
4. If a valid artifact path query is present:
   - call `readArtifactWorkspaceFile` for the current page version workspace;
   - request `includeContent: true`;
   - set `maxBytes` to the Stage 15 default limit;
   - attach the snippet result to the Web page state.
5. Render cards and snippet panel.

Preview/export continues to use the existing full artifact recovery path.
Snippet preview uses the artifact reader path. These two paths remain separate.

## Error Handling

Errors must fail closed and display safe UI messages.

Safe behavior:

- invalid path: show a generic unavailable message;
- missing workspace or missing file: show unavailable metadata or no preview;
- project/page-version mismatch: show unavailable message;
- oversized file: show size-limit omitted message;
- corrupted artifact metadata: do not show content.

Unsafe behavior that must not happen:

- echoing a raw query parameter into page text;
- showing local filesystem paths;
- showing raw stack traces;
- showing full artifact content by default;
- showing content for a file over the snippet byte limit;
- leaking source content through metadata cards.

## Localization

Add English and Chinese copy for:

- artifact changes block title;
- state labels;
- preview snippet link;
- snippet panel title;
- size limit / unavailable messages;
- current version / previous version metadata labels if shown.

The copy should be concise and match the current workbench style.

## Testing

Stage 16 should cover:

- Web store produces artifact diff state for an LP task with a current page
  version.
- First version shows `initial` cards for `index.html`, `styles.css`, and
  `script.js`.
- When a previous page version exists, metadata-only diff states are rendered.
- Default page state and rendered page do not contain artifact source content.
- Valid `artifactPath` reads one bounded snippet through the artifact reader.
- Oversized files do not render content and show a size-limit omitted state.
- Invalid `artifactPath` does not echo the raw value or any secret embedded in
  the query parameter.
- Page render includes localized diff cards and snippet panel copy.
- General chat tasks and project setup tasks do not render static artifact diff
  cards.
- Existing preview/export behavior remains intact.

## Acceptance Criteria

- LP output remains framework-free static HTML/CSS/JS.
- Artifact diff cards appear in the conversation delivery area for completed LP
  tasks.
- Cards are metadata-only by default.
- A selected snippet preview reads at most one canonical file and at most
  `8_192` bytes.
- Raw artifact content does not appear in the default page render.
- Unsafe query values, stack traces, local paths, and secrets are not shown.
- No MCP execution, shell execution, deployment, desktop filesystem access, or
  file editing is introduced.
- Documentation explains that this is a Web read-only view over the Stage 15
  artifact reader/diff boundary.

## Future Work

Later stages can add:

- client-side modal polish for snippet preview;
- standalone Artifacts view;
- line-level textual diff based on the same reader boundary;
- Reviewer role snippet opt-in;
- MCP artifact read tools;
- deployment worker payloads that read artifact files at execution time;
- desktop-local workspace adapters.

## Spec Self-Review

- Placeholder scan: no placeholder markers or incomplete sections remain.
- Scope check: this stage is limited to Web metadata diff cards and bounded
  snippet preview.
- Boundary check: default Web render stays metadata-only; content is only read
  for an explicit canonical path.
- Non-goals check: real execution, deployment, MCP execution, desktop
  filesystem access, file editing, and line-level diff remain out of scope.
