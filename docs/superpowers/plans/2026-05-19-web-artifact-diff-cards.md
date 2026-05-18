# Web Artifact Diff Cards v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add conversation-embedded artifact metadata diff cards and explicit 8KB snippet previews for generated static LP files.

**Architecture:** Build a Web-facing artifact diff view model in `apps/web/src/lib/workbench-store.ts` by reusing the Stage 15 API reader/diff helpers. Render the view model in the existing server-rendered chat delivery block with localized copy and same-page query parameter snippet selection. Keep preview/export full-artifact recovery separate from the new metadata-first artifact diff/snippet view.

**Tech Stack:** Next.js server components/server actions, TypeScript, Vitest, existing `@lp-agent/api`, `@lp-agent/artifacts`, `@lp-agent/db`, Web i18n, and CSS in `apps/web/src/app/globals.css`.

---

## Scope Guard

This plan implements Stage 16 only.

It does not add a standalone Artifacts page, client-side modal state, line-level textual diff, file editing, MCP execution, real deployment, shell execution, desktop filesystem access, binary assets, streaming UI, or full source display by default.

Generated LP output remains framework-free static HTML/CSS/JS.

## File Structure

- `apps/web/src/lib/workbench-store.ts`
  - Add artifact diff/snippet view types.
  - Extend `getPageState()` input with optional `artifactPath`.
  - Build metadata-only artifact diff state for completed LP tasks.
  - Read a selected bounded snippet only through `DemoWorkbenchService.readArtifactWorkspaceFile`.
- `apps/web/src/lib/workbench-store.test.ts`
  - Cover initial diff cards, previous-version diff cards, bounded snippets, oversized snippet omission, invalid path redaction, and non-LP task behavior.
- `apps/web/src/app/page.tsx`
  - Accept `artifactPath` query parameter.
  - Pass it to the store.
  - Render artifact diff cards and optional snippet panel in the existing chat delivery block.
- `apps/web/src/app/page.test.ts`
  - Cover query parameter forwarding, artifact diff rendering, snippet panel rendering, and default no-source visible text.
- `apps/web/src/lib/i18n.ts`
  - Add Chinese/English labels for artifact diff cards and snippet panel.
- `apps/web/src/lib/i18n.test.ts`
  - Cover new copy presence and state labels in both locales.
- `apps/web/src/app/globals.css`
  - Add compact card and snippet panel styles.
- `docs/superpowers/README.md`
  - Add this implementation plan after the Stage 16 design.
- `docs/agent-development-learning.md`
  - Add the Stage 16 implementation plan link and mark it as planned.

## Task 1: Web Store Artifact Diff View Model

**Files:**

- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`

- [ ] **Step 1: Write failing tests for initial artifact diff state and non-LP omission**

In `apps/web/src/lib/workbench-store.test.ts`, add these imports near the top:

```ts
import {
  createStaticArtifactWorkspaceFiles,
  type StaticArtifacts
} from "@lp-agent/artifacts";
```

If `createStaticArtifactWorkspaceFiles` is already imported later by another task, keep one merged import.

Add this test after `submits an LP task without a project by creating an implicit local project`:

```ts
  it("exposes metadata-only initial artifact diff state for completed LP tasks", async () => {
    const store = createWebWorkbenchStore();

    const result = await store.submitTaskPrompt({
      prompt: "生成一个电商春季促销 LP，输出单文件 HTML",
      implicitProjectName: "未命名 LP 项目"
    });
    if (!result.ok || !result.projectId) {
      throw new Error("Expected LP task creation.");
    }

    const pageState = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId
    });

    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageState.artifactDiff).toMatchObject({
      projectId: result.projectId,
      pageVersionId: pageState.snapshot?.currentPageVersion?.id,
      previousPageVersionId: undefined,
      files: [
        {
          path: "index.html",
          state: "initial",
          canPreview: true,
          summary: "index.html static LP file"
        },
        {
          path: "styles.css",
          state: "initial",
          canPreview: true,
          summary: "styles.css static LP file"
        },
        {
          path: "script.js",
          state: "initial",
          canPreview: true,
          summary: "script.js static LP file"
        }
      ]
    });
    expect(pageState.artifactDiff?.files.every((file) => file.shortSha256?.length === 12)).toBe(
      true
    );
    expect(JSON.stringify(pageState.artifactDiff)).not.toContain("<!doctype html>");
    expect(JSON.stringify(pageState.artifactDiff)).not.toContain("window.lpAgent");
  });
```

Add this test after the existing general task tests:

```ts
  it("does not expose artifact diff state for general tasks", async () => {
    const store = createWebWorkbenchStore();

    const result = await store.submitTaskPrompt({
      prompt: "Help me write a campaign plan.",
      implicitProjectName: "Untitled LP Project"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected task creation.");
    }

    const pageState = await store.getPageState({
      taskId: result.taskId
    });

    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageState.artifactDiff).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts -t "artifact diff state|general tasks"
```

Expected: FAIL because `artifactDiff` is not part of `WorkbenchPageState`.

- [ ] **Step 3: Add artifact diff types and page state field**

In `apps/web/src/lib/workbench-store.ts`, add this import after the `@lp-agent/api` import block:

```ts
import {
  type ArtifactWorkspaceDiffFile,
  type ArtifactWorkspaceFilePath
} from "@lp-agent/artifacts";
```

Add these exported types after `export type ChatMessageRecord = WorkbenchMessageRecord;`:

```ts
export type WebArtifactDiffFileState =
  | "initial"
  | "added"
  | "removed"
  | "changed"
  | "unchanged";

export type WebArtifactSnippetOmittedReason =
  | "content_not_requested"
  | "size_limit_exceeded"
  | "unavailable";

export interface WebArtifactDiffFileView {
  path: ArtifactWorkspaceFilePath;
  state: WebArtifactDiffFileState;
  sizeBytes?: number;
  sha256?: string;
  shortSha256?: string;
  summary?: string;
  canPreview: boolean;
}

export interface WebArtifactSnippetView {
  path: ArtifactWorkspaceFilePath;
  sizeBytes?: number;
  sha256?: string;
  shortSha256?: string;
  content?: string;
  omittedReason?: WebArtifactSnippetOmittedReason;
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

Update the `WorkbenchPageState` `task_ready` branch by adding:

```ts
      artifactDiff?: WebArtifactDiffState;
```

Update `WebWorkbenchStore.getPageState()` input to:

```ts
  getPageState(input?: {
    projectId?: string | null;
    taskId?: string | null;
    artifactPath?: string | null;
  }): Promise<WorkbenchPageState>;
```

- [ ] **Step 4: Implement initial artifact diff state**

In `apps/web/src/lib/workbench-store.ts`, add this constant near the keyword constants:

```ts
const artifactPreviewPaths = ["index.html", "styles.css", "script.js"] as const;
```

Inside `getPageState()`, after `const snapshot = ...`, add:

```ts
      const artifactDiff =
        task.type === "lp_generation" && snapshot?.currentPageVersion
          ? await buildWebArtifactDiffState({
              service,
              repositories,
              projectId: snapshot.project.id,
              currentPageVersion: snapshot.currentPageVersion,
              selectedPath: input?.artifactPath
            })
          : undefined;
```

Then include `artifactDiff` in the returned `task_ready` object:

```ts
        artifactDiff,
```

Add these helper functions before `filterRunEventsForSnapshot(...)`:

```ts
async function buildWebArtifactDiffState(input: {
  service: DemoWorkbenchService;
  repositories: WorkbenchRepositories;
  projectId: string;
  currentPageVersion: NonNullable<WorkbenchSnapshot["currentPageVersion"]>;
  selectedPath?: string | null;
}): Promise<WebArtifactDiffState | undefined> {
  const artifactWorkspaceId = input.currentPageVersion.artifactWorkspaceId;
  if (!artifactWorkspaceId) {
    return undefined;
  }

  const previousPageVersion = await findPreviousPageVersionForBrief({
    repositories: input.repositories,
    currentPageVersionId: input.currentPageVersion.id,
    projectId: input.projectId,
    briefId: input.currentPageVersion.briefId
  });
  const base: WebArtifactDiffState = {
    projectId: input.projectId,
    pageVersionId: input.currentPageVersion.id,
    artifactWorkspaceId,
    ...(previousPageVersion ? { previousPageVersionId: previousPageVersion.id } : {}),
    files: previousPageVersion
      ? await buildDiffFileViews({
          service: input.service,
          projectId: input.projectId,
          fromPageVersionId: previousPageVersion.id,
          toPageVersionId: input.currentPageVersion.id
        })
      : await buildInitialFileViews({
          service: input.service,
          projectId: input.projectId,
          pageVersionId: input.currentPageVersion.id,
          artifactWorkspaceId
        })
  };

  return base.files.length > 0 ? base : { ...base, errorCode: "artifact_diff_unavailable" };
}

async function buildInitialFileViews(input: {
  service: DemoWorkbenchService;
  projectId: string;
  pageVersionId: string;
  artifactWorkspaceId: string;
}): Promise<WebArtifactDiffFileView[]> {
  const files: WebArtifactDiffFileView[] = [];

  for (const path of artifactPreviewPaths) {
    try {
      const result = await input.service.readArtifactWorkspaceFile({
        projectId: input.projectId,
        workspaceId: input.artifactWorkspaceId,
        pageVersionId: input.pageVersionId,
        path
      });
      files.push({
        path,
        state: "initial",
        sizeBytes: result.file.sizeBytes,
        sha256: result.file.sha256,
        shortSha256: toShortSha256(result.file.sha256),
        summary: result.file.summary,
        canPreview: true
      });
    } catch {
      files.push({
        path,
        state: "initial",
        canPreview: false
      });
    }
  }

  return files;
}

async function buildDiffFileViews(input: {
  service: DemoWorkbenchService;
  projectId: string;
  fromPageVersionId: string;
  toPageVersionId: string;
}): Promise<WebArtifactDiffFileView[]> {
  try {
    const diff = await input.service.diffPageVersionArtifactWorkspaces({
      projectId: input.projectId,
      fromPageVersionId: input.fromPageVersionId,
      toPageVersionId: input.toPageVersionId
    });
    return diff.files.map(toWebArtifactDiffFileView);
  } catch {
    return [];
  }
}

function toWebArtifactDiffFileView(file: ArtifactWorkspaceDiffFile): WebArtifactDiffFileView {
  const endpoint = file.to !== undefined ? file.to : file.from;
  return {
    path: file.path,
    state: file.state,
    ...(endpoint?.sizeBytes !== undefined ? { sizeBytes: endpoint.sizeBytes } : {}),
    ...(endpoint?.sha256 ? { sha256: endpoint.sha256 } : {}),
    ...(endpoint?.sha256 ? { shortSha256: toShortSha256(endpoint.sha256) } : {}),
    ...(endpoint?.summary ? { summary: endpoint.summary } : {}),
    canPreview: file.to !== undefined
  };
}

async function findPreviousPageVersionForBrief(input: {
  repositories: WorkbenchRepositories;
  currentPageVersionId: string;
  projectId: string;
  briefId: string;
}) {
  const pageVersions = await input.repositories.pageVersions.listAll();
  const currentIndex = pageVersions.findIndex(
    (pageVersion) => pageVersion.id === input.currentPageVersionId
  );
  const candidates = (currentIndex >= 0 ? pageVersions.slice(0, currentIndex) : pageVersions)
    .filter(
      (pageVersion) =>
        pageVersion.projectId === input.projectId &&
        pageVersion.briefId === input.briefId &&
        pageVersion.id !== input.currentPageVersionId
    );
  return candidates.at(-1);
}

function toShortSha256(sha256: string): string {
  return sha256.slice(0, 12);
}
```

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts -t "artifact diff state|general tasks"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts
git commit -m "add web artifact diff state"
```

## Task 2: Previous-Version Diff and Bounded Snippet Reads

**Files:**

- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`

- [ ] **Step 1: Write failing tests for previous-version diff and selected snippet**

In `apps/web/src/lib/workbench-store.test.ts`, add this helper near the existing helper functions:

```ts
async function saveManualPageVersion(input: {
  repositories: WorkbenchRepositories;
  projectId: string;
  briefId: string;
  pageVersionId: string;
  workspaceId: string;
  artifacts: StaticArtifacts;
  createdAt?: string;
}): Promise<void> {
  const createdAt =
    input.createdAt !== undefined ? input.createdAt : "2026-05-19T00:00:00.000Z";
  await input.repositories.artifactWorkspaces.save({
    id: input.workspaceId,
    projectId: input.projectId,
    pageVersionId: input.pageVersionId,
    kind: "static_lp",
    state: "active",
    createdAt,
    updatedAt: createdAt
  });
  for (const file of createStaticArtifactWorkspaceFiles({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    pageVersionId: input.pageVersionId,
    artifacts: input.artifacts,
    createdAt
  })) {
    await input.repositories.artifactWorkspaceFiles.save(file);
  }
  await input.repositories.pageVersions.save({
    id: input.pageVersionId,
    projectId: input.projectId,
    briefId: input.briefId,
    artifactWorkspaceId: input.workspaceId,
    artifacts: input.artifacts,
    reviewStatus: "passed",
    findings: [],
    createdAt
  });
}
```

Add this test after the Task 1 artifact diff test:

```ts
  it("compares current LP artifacts with the previous page version", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });
    const result = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Untitled LP Project"
    });
    if (!result.ok || !result.projectId) {
      throw new Error("Expected LP task creation.");
    }
    const firstState = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId
    });
    if (firstState.kind !== "task_ready" || !firstState.snapshot?.currentPageVersion) {
      throw new Error("Expected first page version.");
    }
    const firstVersion = firstState.snapshot.currentPageVersion;

    await saveManualPageVersion({
      repositories,
      projectId: result.projectId,
      briefId: firstVersion.briefId,
      pageVersionId: "page_version_changed",
      workspaceId: "artifact_workspace_changed",
      artifacts: {
        ...firstVersion.artifacts,
        stylesCss: `${firstVersion.artifacts.stylesCss}\nbody { color: #123456; }`
      },
      createdAt: "2026-05-19T00:01:00.000Z"
    });
    await repositories.taskSnapshots.save({
      taskId: result.taskId,
      projectId: result.projectId,
      briefId: firstVersion.briefId,
      pageVersionId: "page_version_changed",
      createdAt: "2026-05-19T00:01:00.000Z"
    });

    const changedState = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId
    });

    expect(changedState.kind).toBe("task_ready");
    if (changedState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(changedState.artifactDiff?.previousPageVersionId).toBe(firstVersion.id);
    expect(changedState.artifactDiff?.files.map((file) => [file.path, file.state])).toEqual([
      ["index.html", "unchanged"],
      ["styles.css", "changed"],
      ["script.js", "unchanged"]
    ]);
    expect(JSON.stringify(changedState.artifactDiff)).not.toContain("<!doctype html>");
    expect(JSON.stringify(changedState.artifactDiff)).not.toContain("body { color: #123456; }");
  });
```

Add this test for a valid selected snippet:

```ts
  it("reads one bounded artifact snippet for a selected canonical path", async () => {
    const store = createWebWorkbenchStore();
    const result = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Untitled LP Project"
    });
    if (!result.ok || !result.projectId) {
      throw new Error("Expected LP task creation.");
    }

    const pageState = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId,
      artifactPath: "styles.css"
    });

    expect(pageState.kind).toBe("task_ready");
    if (pageState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(pageState.artifactDiff?.selectedSnippet).toMatchObject({
      path: "styles.css",
      maxBytes: 8192,
      omittedReason: undefined
    });
    expect(pageState.artifactDiff?.selectedSnippet?.content).toContain(":root");
    expect(pageState.artifactDiff?.selectedSnippet?.shortSha256).toHaveLength(12);
    expect(JSON.stringify(pageState.artifactDiff?.files)).not.toContain(":root");
  });
```

Add this test for oversized content and invalid path redaction:

```ts
  it("omits oversized selected snippets and redacts invalid artifact paths", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const store = createWebWorkbenchStore({ repositories });
    const result = await store.submitTaskPrompt({
      prompt: "Create a landing page for a spring sale",
      implicitProjectName: "Untitled LP Project"
    });
    if (!result.ok || !result.projectId) {
      throw new Error("Expected LP task creation.");
    }
    const initialState = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId
    });
    if (initialState.kind !== "task_ready" || !initialState.snapshot?.currentPageVersion) {
      throw new Error("Expected page version.");
    }
    const pageVersion = initialState.snapshot.currentPageVersion;
    if (!pageVersion.artifactWorkspaceId) {
      throw new Error("Expected artifact workspace.");
    }
    const largeCssSecret = "OVERSIZED_SNIPPET_SECRET";
    const largeArtifacts = {
      ...pageVersion.artifacts,
      stylesCss: `${largeCssSecret}${"x".repeat(9000)}`
    };
    for (const file of createStaticArtifactWorkspaceFiles({
      workspaceId: pageVersion.artifactWorkspaceId,
      projectId: result.projectId,
      pageVersionId: pageVersion.id,
      artifacts: largeArtifacts,
      createdAt: "2026-05-19T00:02:00.000Z"
    })) {
      await repositories.artifactWorkspaceFiles.save(file);
    }

    const oversizedState = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId,
      artifactPath: "styles.css"
    });
    expect(oversizedState.kind).toBe("task_ready");
    if (oversizedState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(oversizedState.artifactDiff?.selectedSnippet).toMatchObject({
      path: "styles.css",
      omittedReason: "size_limit_exceeded"
    });
    expect(JSON.stringify(oversizedState.artifactDiff)).not.toContain(largeCssSecret);

    const invalidPath = "../styles.css?token=ARTIFACT_QUERY_SECRET";
    const invalidState = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId,
      artifactPath: invalidPath
    });
    expect(invalidState.kind).toBe("task_ready");
    if (invalidState.kind !== "task_ready") {
      throw new Error("Expected task-ready state.");
    }
    expect(invalidState.artifactDiff?.errorCode).toBe("artifact_snippet_unavailable");
    expect(JSON.stringify(invalidState.artifactDiff)).not.toContain(invalidPath);
    expect(JSON.stringify(invalidState.artifactDiff)).not.toContain("ARTIFACT_QUERY_SECRET");
  });
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts -t "previous page version|bounded artifact snippet|oversized selected snippets"
```

Expected: FAIL because the selected snippet tests expect `artifactPath` handling that has not been implemented yet. The previous-version diff test may already pass after Task 1.

- [ ] **Step 3: Implement selected snippet reads and invalid path handling**

In `apps/web/src/lib/workbench-store.ts`, update the `@lp-agent/artifacts` import added in Task 1:

```ts
import {
  ARTIFACT_WORKSPACE_DEFAULT_READ_MAX_BYTES,
  normalizeArtifactWorkspaceFilePath,
  type ArtifactWorkspaceDiffFile,
  type ArtifactWorkspaceFilePath
} from "@lp-agent/artifacts";
```

Update `buildWebArtifactDiffState(...)` in `apps/web/src/lib/workbench-store.ts` by replacing the final return with:

```ts
  const state = base.files.length > 0
    ? base
    : { ...base, errorCode: "artifact_diff_unavailable" as const };
  const selectedPath = normalizeSelectedArtifactPath(input.selectedPath);

  if (selectedPath === null) {
    return {
      ...state,
      errorCode: "artifact_snippet_unavailable"
    };
  }

  if (selectedPath) {
    return {
      ...state,
      ...(await readSelectedArtifactSnippet({
        service: input.service,
        projectId: input.projectId,
        pageVersionId: input.currentPageVersion.id,
        artifactWorkspaceId,
        path: selectedPath
      }))
    };
  }

  return state;
```

Add these helper functions after `toShortSha256(...)`:

```ts
function normalizeSelectedArtifactPath(
  path: string | null | undefined
): ArtifactWorkspaceFilePath | null | undefined {
  if (path === undefined || path === null || path.trim().length === 0) {
    return undefined;
  }
  try {
    return normalizeArtifactWorkspaceFilePath(path);
  } catch {
    return null;
  }
}

async function readSelectedArtifactSnippet(input: {
  service: DemoWorkbenchService;
  projectId: string;
  pageVersionId: string;
  artifactWorkspaceId: string;
  path: ArtifactWorkspaceFilePath;
}): Promise<Pick<WebArtifactDiffState, "selectedSnippet" | "errorCode">> {
  try {
    const result = await input.service.readArtifactWorkspaceFile({
      projectId: input.projectId,
      workspaceId: input.artifactWorkspaceId,
      pageVersionId: input.pageVersionId,
      path: input.path,
      includeContent: true,
      maxBytes: ARTIFACT_WORKSPACE_DEFAULT_READ_MAX_BYTES
    });
    return {
      selectedSnippet: {
        path: result.file.path,
        sizeBytes: result.file.sizeBytes,
        sha256: result.file.sha256,
        shortSha256: toShortSha256(result.file.sha256),
        ...(result.content !== undefined ? { content: result.content } : {}),
        ...(result.omittedReason ? { omittedReason: result.omittedReason } : {}),
        maxBytes: ARTIFACT_WORKSPACE_DEFAULT_READ_MAX_BYTES
      }
    };
  } catch {
    return {
      selectedSnippet: {
        path: input.path,
        omittedReason: "unavailable",
        maxBytes: ARTIFACT_WORKSPACE_DEFAULT_READ_MAX_BYTES
      },
      errorCode: "artifact_snippet_unavailable"
    };
  }
}
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts -t "previous page version|bounded artifact snippet|oversized selected snippets|artifact diff state|general tasks"
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts
git commit -m "add bounded artifact snippet state"
```

## Task 3: Localized Web UI Rendering

**Files:**

- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`

- [ ] **Step 1: Write failing i18n tests**

In `apps/web/src/lib/i18n.test.ts`, add:

```ts
  it("includes artifact diff and snippet labels in both locales", () => {
    const en = getWorkbenchCopy("en");
    const zh = getWorkbenchCopy("zh-CN");

    expect(en.chat.artifactChangesTitle).toBe("Artifact changes");
    expect(en.chat.artifactDiffStateLabels.changed).toBe("Changed");
    expect(en.chat.previewSnippetLabel).toBe("Preview snippet");
    expect(en.chat.snippetSizeLimitMessage).toContain("8 KB");
    expect(zh.chat.artifactChangesTitle).toBe("文件变化");
    expect(zh.chat.artifactDiffStateLabels.initial).toBe("初始");
    expect(zh.chat.previewSnippetLabel).toBe("预览片段");
    expect(zh.chat.snippetUnavailableMessage).toBe("片段暂不可用。");
  });
```

- [ ] **Step 2: Run i18n test to verify RED**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts -t "artifact diff"
```

Expected: FAIL because the copy fields do not exist.

- [ ] **Step 3: Add localized copy fields**

In `apps/web/src/lib/i18n.ts`, add these fields to the `chat` interface:

```ts
    artifactChangesTitle: string;
    artifactVersionInitial: string;
    artifactPreviousVersionLabel: string;
    artifactCurrentVersionLabel: string;
    artifactHashLabel: string;
    previewSnippetLabel: string;
    snippetPreviewTitle: string;
    snippetSizeLimitMessage: string;
    snippetUnavailableMessage: string;
    artifactDiffStateLabels: Record<"initial" | "added" | "removed" | "changed" | "unchanged", string>;
```

In the English `chat` object, add:

```ts
      artifactChangesTitle: "Artifact changes",
      artifactVersionInitial: "Initial version",
      artifactPreviousVersionLabel: "Previous",
      artifactCurrentVersionLabel: "Current",
      artifactHashLabel: "Hash",
      previewSnippetLabel: "Preview snippet",
      snippetPreviewTitle: "Snippet preview",
      snippetSizeLimitMessage: "Content is over the 8 KB preview limit.",
      snippetUnavailableMessage: "Snippet is unavailable.",
      artifactDiffStateLabels: {
        initial: "Initial",
        added: "Added",
        removed: "Removed",
        changed: "Changed",
        unchanged: "Unchanged"
      },
```

In the Chinese `chat` object, add:

```ts
      artifactChangesTitle: "文件变化",
      artifactVersionInitial: "初始版本",
      artifactPreviousVersionLabel: "上一版",
      artifactCurrentVersionLabel: "当前版",
      artifactHashLabel: "哈希",
      previewSnippetLabel: "预览片段",
      snippetPreviewTitle: "片段预览",
      snippetSizeLimitMessage: "内容超过 8 KB 预览限制。",
      snippetUnavailableMessage: "片段暂不可用。",
      artifactDiffStateLabels: {
        initial: "初始",
        added: "新增",
        removed: "已移除",
        changed: "已变更",
        unchanged: "未变更"
      },
```

- [ ] **Step 4: Write failing page rendering tests**

In `apps/web/src/app/page.test.ts`, update the hoisted mock to expose a shared mock:

```ts
const pageMocks = vi.hoisted(() => ({
  acceptLanguage: "en",
  currentProjectId: undefined as string | undefined,
  currentTaskId: undefined as string | undefined,
  getPageStateMock: vi.fn(),
  pageState: {
```

Then update the `getWebWorkbenchStore` mock:

```ts
vi.mock("../lib/workbench-store", () => ({
  getWebWorkbenchStore: vi.fn(() => ({
    getPageState: pageMocks.getPageStateMock.mockImplementation(async () => pageMocks.pageState)
  }))
}));
```

In `beforeEach`, add:

```ts
  pageMocks.getPageStateMock.mockReset();
```

Add this test near the completed static artifact tests:

```ts
  it("passes artifactPath query values into page state loading", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.currentTaskId = "task_1";
    pageMocks.pageState = {
      ...pageMocks.pageState,
      kind: "empty",
      projects: [],
      projectMembers: [],
      tasks: [],
      skills: { boundSkills: [], availableVersions: [] },
      skillCommands: [],
      models: {
        providers: [],
        routes: [],
        resolvedPolicy: {
          planner: { provider: "mock-openai", model: "planning-model" },
          builder: { provider: "mock-anthropic", model: "code-model" },
          reviewer: { provider: "mock-openai", model: "review-model" },
          deployer: { provider: "mock-local", model: "tool-model" }
        }
      },
      mcp: {
        connectors: [],
        approvals: [],
        visibleToolsByRole: {
          planner: [],
          builder: [],
          reviewer: [],
          deployer: []
        }
      }
    };

    await HomePage({
      searchParams: Promise.resolve({ artifactPath: "styles.css" })
    });

    expect(pageMocks.getPageStateMock).toHaveBeenCalledWith({
      projectId: "project_1",
      taskId: "task_1",
      artifactPath: "styles.css"
    });
  });
```

Add this test near `renders completed static artifacts without deployment UI`:

```ts
  it("renders artifact diff cards and a selected bounded snippet", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.currentTaskId = "task_1";
    pageMocks.pageState = createCompletedLpPageState({
      artifactDiff: {
        projectId: "project_1",
        pageVersionId: "version_1",
        artifactWorkspaceId: "artifact_workspace_1",
        files: [
          {
            path: "index.html",
            state: "initial",
            sizeBytes: 128,
            sha256: "a".repeat(64),
            shortSha256: "a".repeat(12),
            summary: "index.html static LP file",
            canPreview: true
          },
          {
            path: "styles.css",
            state: "changed",
            sizeBytes: 32,
            sha256: "b".repeat(64),
            shortSha256: "b".repeat(12),
            summary: "styles.css static LP file",
            canPreview: true
          },
          {
            path: "script.js",
            state: "unchanged",
            sizeBytes: 24,
            sha256: "c".repeat(64),
            shortSha256: "c".repeat(12),
            summary: "script.js static LP file",
            canPreview: true
          }
        ],
        selectedSnippet: {
          path: "styles.css",
          sizeBytes: 32,
          sha256: "b".repeat(64),
          shortSha256: "b".repeat(12),
          content: "body { color: #111827; }",
          maxBytes: 8192
        }
      }
    });

    const page = await HomePage({
      searchParams: Promise.resolve({ artifactPath: "styles.css" })
    });
    const text = collectText(page).join(" ");

    expect(text).toContain("Artifact changes");
    expect(text).toContain("index.html");
    expect(text).toContain("Initial");
    expect(text).toContain("styles.css");
    expect(text).toContain("Changed");
    expect(text).toContain("Snippet preview");
    expect(text).toContain("body { color: #111827; }");
  });
```

Add this helper near other page test helpers:

```ts
function createCompletedLpPageState(overrides: Record<string, unknown> = {}) {
  return {
    kind: "task_ready",
    projects: [
      {
        id: "project_1",
        name: "Completed LP",
        createdAt: "2026-05-12T08:00:00.000Z"
      }
    ],
    projectMembers: [],
    tasks: [
      {
        id: "task_1",
        title: "Create a no git spring ecommerce landing page.",
        type: "lp_generation",
        status: "complete",
        projectId: "project_1",
        createdAt: "2026-05-12T08:00:00.000Z"
      }
    ],
    skills: {
      boundSkills: [],
      availableVersions: []
    },
    skillCommands: [],
    models: {
      providers: [],
      routes: [],
      resolvedPolicy: {
        planner: { provider: "mock-openai", model: "planning-model" },
        builder: { provider: "mock-anthropic", model: "code-model" },
        reviewer: { provider: "mock-openai", model: "review-model" },
        deployer: { provider: "mock-local", model: "tool-model" }
      }
    },
    mcp: {
      connectors: [],
      approvals: [],
      visibleToolsByRole: {
        planner: [],
        builder: [],
        reviewer: [],
        deployer: []
      }
    },
    activeTaskId: "task_1",
    task: {
      id: "task_1",
      title: "Create a no git spring ecommerce landing page.",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-12T08:00:00.000Z"
    },
    messages: [
      {
        id: "message_1",
        taskId: "task_1",
        role: "user",
        content: "Create a no git spring ecommerce landing page.",
        createdAt: "2026-05-12T08:00:00.000Z"
      },
      {
        id: "message_2",
        taskId: "task_1",
        role: "assistant",
        content: "LP artifacts are ready for review.",
        createdAt: "2026-05-12T08:00:01.000Z"
      }
    ],
    runEvents: [],
    interrupt: unavailableInterrupt,
    snapshot: {
      project: {
        id: "project_1",
        name: "Completed LP",
        createdAt: "2026-05-12T08:00:00.000Z"
      },
      brief: {
        id: "brief_1",
        projectId: "project_1",
        prompt: "Create a no git spring ecommerce landing page.",
        brief: {
          objective: "Convert paid traffic into spring campaign purchases.",
          audience: "Returning ecommerce shoppers",
          offer: "Save 25% through Sunday.",
          primaryCta: "Shop the sale"
        },
        createdAt: "2026-05-12T08:00:00.000Z"
      },
      currentPageVersion: {
        id: "version_1",
        projectId: "project_1",
        briefId: "brief_1",
        artifactWorkspaceId: "artifact_workspace_1",
        artifacts: {
          indexHtml: "<!doctype html><html><body><main><h1>Spring essentials</h1></main></body></html>",
          stylesCss: "body { color: #111827; }",
          scriptJs: "window.lpAgent = true;"
        },
        reviewStatus: "passed",
        findings: [],
        createdAt: "2026-05-12T08:01:00.000Z"
      },
      deployment: undefined
    },
    ...overrides
  };
}
```

- [ ] **Step 5: Run tests to verify RED**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts -t "artifact diff"
pnpm exec vitest run apps/web/src/app/page.test.ts -t "artifactPath|artifact diff cards"
```

Expected: FAIL because UI and query wiring are not implemented.

- [ ] **Step 6: Implement query wiring and artifact diff UI**

In `apps/web/src/app/page.tsx`, extend `HomePageProps.searchParams`:

```ts
    artifactPath?: string;
```

Update `getPageState(...)` call:

```ts
  const pageState = await getWebWorkbenchStore().getPageState({
    projectId: currentProjectId,
    taskId: currentTaskId,
    artifactPath: params?.artifactPath
  });
```

In the delivery block, immediately after the `artifactGrid` closing `</div>`, add:

```tsx
                          {pageState.kind === "task_ready" && pageState.artifactDiff ? (
                            <ArtifactDiffBlock
                              artifactDiff={pageState.artifactDiff}
                              copy={copy.chat}
                              locale={copy.locale}
                            />
                          ) : null}
```

Add this helper component after `ProjectMembersBlock(...)`:

```tsx
function ArtifactDiffBlock({
  artifactDiff,
  copy,
  locale
}: {
  artifactDiff: NonNullable<Extract<WorkbenchPageState, { kind: "task_ready" }>["artifactDiff"]>;
  copy: ReturnType<typeof getWorkbenchCopy>["chat"];
  locale: string;
}) {
  return (
    <section className="artifactDiffBlock" aria-label={copy.artifactChangesTitle}>
      <div className="artifactDiffHeader">
        <strong>{copy.artifactChangesTitle}</strong>
        <span>
          {artifactDiff.previousPageVersionId
            ? `${copy.artifactPreviousVersionLabel} -> ${copy.artifactCurrentVersionLabel}`
            : copy.artifactVersionInitial}
        </span>
      </div>
      <div className="artifactDiffGrid">
        {artifactDiff.files.map((file) => (
          <div className="artifactDiffCard" data-state={file.state} key={file.path}>
            <div className="artifactDiffTop">
              <strong>{file.path}</strong>
              <span>{copy.artifactDiffStateLabels[file.state]}</span>
            </div>
            <small>
              {file.sizeBytes !== undefined
                ? `${file.sizeBytes.toLocaleString(locale)} bytes`
                : copy.snippetUnavailableMessage}
            </small>
            {file.shortSha256 ? (
              <small>
                {copy.artifactHashLabel}: {file.shortSha256}
              </small>
            ) : null}
            {file.summary ? <p>{file.summary}</p> : null}
            {file.canPreview ? (
              <a href={`/?artifactPath=${encodeURIComponent(file.path)}`}>
                {copy.previewSnippetLabel}
              </a>
            ) : null}
          </div>
        ))}
      </div>
      {artifactDiff.selectedSnippet ? (
        <div className="artifactSnippetPanel">
          <div className="artifactSnippetHeader">
            <strong>{copy.snippetPreviewTitle}</strong>
            <span>{artifactDiff.selectedSnippet.path}</span>
          </div>
          {artifactDiff.selectedSnippet.content !== undefined ? (
            <pre><code>{artifactDiff.selectedSnippet.content}</code></pre>
          ) : (
            <p>
              {artifactDiff.selectedSnippet.omittedReason === "size_limit_exceeded"
                ? copy.snippetSizeLimitMessage
                : copy.snippetUnavailableMessage}
            </p>
          )}
        </div>
      ) : artifactDiff.errorCode === "artifact_snippet_unavailable" ? (
        <p className="artifactSnippetNotice">{copy.snippetUnavailableMessage}</p>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 7: Run tests to verify GREEN**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts -t "artifact diff"
pnpm exec vitest run apps/web/src/app/page.test.ts -t "artifactPath|artifact diff cards|completed static artifacts|general task"
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add apps/web/src/lib/i18n.ts apps/web/src/lib/i18n.test.ts apps/web/src/app/page.tsx apps/web/src/app/page.test.ts
git commit -m "render web artifact diff cards"
```

## Task 4: Styling and Safety Page Coverage

**Files:**

- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/app/page.test.ts`

- [ ] **Step 1: Write failing page tests for unsafe visible text and omitted snippets**

In `apps/web/src/app/page.test.ts`, add:

```ts
  it("does not render artifact source in visible diff cards by default", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.currentTaskId = "task_1";
    pageMocks.pageState = createCompletedLpPageState({
      artifactDiff: {
        projectId: "project_1",
        pageVersionId: "version_1",
        artifactWorkspaceId: "artifact_workspace_1",
        files: [
          {
            path: "styles.css",
            state: "initial",
            sizeBytes: 32,
            sha256: "b".repeat(64),
            shortSha256: "b".repeat(12),
            summary: "styles.css static LP file",
            canPreview: true
          }
        ]
      }
    });

    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const visibleText = collectText(page).join(" ");

    expect(visibleText).toContain("Artifact changes");
    expect(visibleText).toContain("styles.css static LP file");
    expect(visibleText).not.toContain("body { color: #111827; }");
    expect(visibleText).not.toContain("<!doctype html>");
  });

  it("renders safe snippet omitted messages without leaking invalid query values", async () => {
    pageMocks.currentProjectId = "project_1";
    pageMocks.currentTaskId = "task_1";
    pageMocks.pageState = createCompletedLpPageState({
      artifactDiff: {
        projectId: "project_1",
        pageVersionId: "version_1",
        artifactWorkspaceId: "artifact_workspace_1",
        files: [
          {
            path: "styles.css",
            state: "initial",
            sizeBytes: 9001,
            sha256: "b".repeat(64),
            shortSha256: "b".repeat(12),
            summary: "styles.css static LP file",
            canPreview: true
          }
        ],
        selectedSnippet: {
          path: "styles.css",
          sizeBytes: 9001,
          sha256: "b".repeat(64),
          shortSha256: "b".repeat(12),
          omittedReason: "size_limit_exceeded",
          maxBytes: 8192
        },
        errorCode: "artifact_snippet_unavailable"
      }
    });

    const page = await HomePage({
      searchParams: Promise.resolve({
        artifactPath: "../styles.css?token=ARTIFACT_QUERY_SECRET"
      })
    });
    const visibleText = collectText(page).join(" ");

    expect(visibleText).toContain("Content is over the 8 KB preview limit.");
    expect(visibleText).not.toContain("ARTIFACT_QUERY_SECRET");
    expect(visibleText).not.toContain("../styles.css");
  });
```

- [ ] **Step 2: Run page tests to verify RED if UI is incomplete**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts -t "artifact source|omitted messages|artifact diff cards"
```

Expected: PASS if Task 3 already renders safe text; FAIL if omitted message branch is missing.

- [ ] **Step 3: Add CSS for artifact diff cards and snippet panel**

In `apps/web/src/app/globals.css`, after the `.artifactCard strong` block, add:

```css
.artifactDiffBlock {
  min-width: 0;
  display: grid;
  gap: 10px;
  border-top: 1px solid var(--line);
  padding: 12px 13px 0;
}

.artifactDiffHeader,
.artifactDiffTop,
.artifactSnippetHeader {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.artifactDiffHeader strong,
.artifactSnippetHeader strong {
  font-size: 0.84rem;
  font-weight: 830;
}

.artifactDiffHeader span,
.artifactSnippetHeader span {
  color: var(--muted);
  font-size: 0.76rem;
  overflow-wrap: anywhere;
}

.artifactDiffGrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
}

.artifactDiffCard {
  min-width: 0;
  display: grid;
  gap: 5px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-raised);
  padding: 10px;
}

.artifactDiffTop strong {
  min-width: 0;
  font-size: 0.84rem;
  overflow-wrap: anywhere;
}

.artifactDiffTop span {
  flex: 0 0 auto;
  border: 1px solid var(--accent-line);
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  padding: 2px 7px;
  font-size: 0.68rem;
  font-weight: 830;
}

.artifactDiffCard small,
.artifactDiffCard p,
.artifactDiffCard a,
.artifactSnippetPanel p,
.artifactSnippetNotice {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.artifactDiffCard small,
.artifactDiffCard p,
.artifactSnippetPanel p,
.artifactSnippetNotice {
  color: var(--muted);
}

.artifactDiffCard a {
  color: var(--accent);
  font-weight: 800;
  text-decoration: none;
}

.artifactSnippetPanel {
  min-width: 0;
  display: grid;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #1f2328;
  color: #f6f8fa;
  padding: 10px;
}

.artifactSnippetPanel .artifactSnippetHeader span {
  color: #c9d1d9;
}

.artifactSnippetPanel pre {
  max-height: 260px;
  margin: 0;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.artifactSnippetPanel code {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 0.76rem;
  line-height: 1.5;
}
```

In the mobile media query that currently adjusts `.artifactGrid`, add:

```css
  .artifactDiffGrid {
    grid-template-columns: 1fr;
  }
```

- [ ] **Step 4: Run page and CSS-related checks**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts -t "artifact source|omitted messages|artifact diff cards|completed static artifacts"
pnpm exec vitest run apps/web/src/lib/i18n.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add apps/web/src/app/globals.css apps/web/src/app/page.test.ts
git commit -m "style artifact diff previews"
```

## Task 5: Documentation, Index, and Full Verification

**Files:**

- Modify: `docs/superpowers/README.md`
- Modify: `docs/agent-development-learning.md`

- [ ] **Step 1: Update Superpowers README**

In `docs/superpowers/README.md`, add this after entry 60:

```md
61. `plans/2026-05-19-web-artifact-diff-cards.md`
   - Stage 16 Web artifact diff cards v0 implementation plan.
   - Read this after the Stage 16 design when implementing or auditing conversation-embedded artifact metadata cards, same-page snippet query handling, localization, and safety tests.
```

- [ ] **Step 2: Update Agent learning notes**

In `docs/agent-development-learning.md`, under `### 阶段 16：Web Artifact Diff Cards v0`, add:

```md
当前计划：

- [2026-05-19-web-artifact-diff-cards.md](./superpowers/plans/2026-05-19-web-artifact-diff-cards.md)
```

Keep the existing Stage 16 design bullets unchanged.

- [ ] **Step 3: Run focused tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/page.test.ts apps/web/src/lib/i18n.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected:

- `pnpm test`: all non-skipped tests pass.
- `pnpm typecheck`: all workspace typechecks pass.
- `pnpm build`: Next.js app builds successfully.
- `git diff --check`: no output.

- [ ] **Step 5: Commit documentation and final verification marker**

```bash
git add docs/superpowers/README.md docs/agent-development-learning.md
git commit -m "document web artifact diff cards plan"
```

If Tasks 1-4 already committed all code, this commit should contain only documentation updates.

## Final Review

Use `superpowers:requesting-code-review` or the final review step from `superpowers:subagent-driven-development`.

Reviewer should check:

- artifact diff cards use metadata-only state by default;
- selected snippets are read only through the artifact reader with the 8KB cap;
- invalid query values are not echoed into state, page text, trace, or errors;
- general tasks do not render artifact diff UI;
- preview/export full artifact behavior still works;
- no MCP execution, shell execution, deployment, desktop filesystem access, file editing, or line-level diff slipped into the implementation.

## Plan Self-Review

- Spec coverage: Web store state, initial-version behavior, previous-version diff, query-selected snippet, localization, safe error handling, UI rendering, testing, docs, and non-goals are each covered by tasks.
- Placeholder scan: no placeholder instructions or unspecified test areas remain.
- Type consistency: `WebArtifactDiffState`, `WebArtifactDiffFileView`, `WebArtifactSnippetView`, `artifactPath`, and localized copy names are used consistently across store, page, tests, and docs.
- Scope check: this plan keeps Stage 16 read-only and Web-focused.
