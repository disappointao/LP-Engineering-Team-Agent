# Dedicated Artifact Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a V1 `Artifacts` workspace view that exposes the current LP task's artifact manifest, bounded snippets, preview, export links, and safe failure states.

**Architecture:** Implement `view=artifacts` inside the existing `apps/web/src/app/page.tsx` surface so it can reuse current cookie-backed project/task session, `getPageState`, `WebArtifactDiffState`, `LPPreview`, and `createArtifactDownloadLinks`. Keep repository facts unchanged: artifact metadata and bounded snippets come from `artifactDiff`, while full artifact content is only used by preview/export components.

**Tech Stack:** Next.js App Router, React server components, existing server actions, Vitest, Playwright, pnpm workspace scripts.

---

## File Structure

- Modify `apps/web/src/lib/i18n.ts`: add `nav.artifacts` and artifact workspace copy in both locales.
- Modify `apps/web/src/lib/i18n.test.ts`: lock new localized copy.
- Modify `apps/web/src/app/page.tsx`: route `view=artifacts`, add nav item, render dedicated artifact workspace view, preserve safe artifact snippet links.
- Modify `apps/web/src/app/page.test.ts`: cover navigation, empty state, manifest/snippet/preview/export rendering, and legacy query stripping.
- Modify `apps/web/src/app/globals.css`: style the artifact workspace view with existing workbench variables and responsive constraints.
- Modify `apps/web/e2e/helpers.ts`: add artifact workspace browser assertions.
- Modify `apps/web/e2e/alpha-lp-artifacts.spec.ts`: cover `view=artifacts` happy path and unsafe path behavior.
- Modify `docs/web-v1-acceptance.md`: add manual acceptance checks for dedicated artifact workspace.
- Modify `docs/alpha-release-candidate.md`: add artifact workspace to RC go/no-go and trial script.
- Modify `docs/project-roadmap.md`: mark Stage 42 complete and route next stage.
- Modify `docs/superpowers/README.md`: index this implementation plan.

---

### Task 1: Localized Copy and Navigation Contract

**Files:**
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Write failing i18n tests**

Add this case to `apps/web/src/lib/i18n.test.ts` near the existing artifact/recovery copy tests:

```ts
it("includes dedicated artifact workspace copy in both locales", () => {
  const zh = getWorkbenchCopy("zh-CN");
  const en = getWorkbenchCopy("en");

  expect(en.nav.artifacts).toBe("Artifacts");
  expect(zh.nav.artifacts).toBe("产物");
  expect(en.chat.artifactWorkspaceTitle).toBe("Artifact workspace");
  expect(en.chat.artifactWorkspaceEmptyTitle).toBe("No artifact workspace yet");
  expect(en.chat.artifactWorkspaceManifestTitle).toBe("File manifest");
  expect(en.chat.artifactWorkspaceExportTitle).toBe("Exports");
  expect(en.chat.artifactWorkspaceOpenLabel).toBe("Open artifact workspace");
  expect(zh.chat.artifactWorkspaceTitle).toBe("产物工作区");
  expect(zh.chat.artifactWorkspaceEmptyTitle).toBe("还没有产物工作区");
  expect(zh.chat.artifactWorkspaceManifestTitle).toBe("文件清单");
  expect(zh.chat.artifactWorkspaceExportTitle).toBe("导出");
  expect(zh.chat.artifactWorkspaceOpenLabel).toBe("打开产物工作区");
});
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts
```

Expected: FAIL because `nav.artifacts` and the `artifactWorkspace*` chat copy keys do not exist.

- [ ] **Step 3: Add copy fields and locale values**

In `apps/web/src/lib/i18n.ts`, extend `WorkbenchCopy["nav"]`:

```ts
  nav: {
    label: string;
    workbench: string;
    artifacts: string;
    skills: string;
    mcp: string;
    models: string;
    deployments: string;
  };
```

Extend `WorkbenchCopy["chat"]` after `artifactsTitle`:

```ts
    artifactWorkspaceTitle: string;
    artifactWorkspaceSubtitle: string;
    artifactWorkspaceEmptyTitle: string;
    artifactWorkspaceEmptyDescription: string;
    artifactWorkspaceManifestTitle: string;
    artifactWorkspaceExportTitle: string;
    artifactWorkspaceOpenLabel: string;
    artifactWorkspaceUnavailableLabel: string;
```

Add English values:

```ts
      artifactsTitle: "Generated files",
      artifactWorkspaceTitle: "Artifact workspace",
      artifactWorkspaceSubtitle: "Inspect the current task's static LP files, preview, snippets, and exports.",
      artifactWorkspaceEmptyTitle: "No artifact workspace yet",
      artifactWorkspaceEmptyDescription: "Generate an LP task in the workbench to create static HTML, CSS, and JavaScript files.",
      artifactWorkspaceManifestTitle: "File manifest",
      artifactWorkspaceExportTitle: "Exports",
      artifactWorkspaceOpenLabel: "Open artifact workspace",
      artifactWorkspaceUnavailableLabel: "Artifact workspace is unavailable.",
```

Add Chinese values:

```ts
      artifactsTitle: "生成文件",
      artifactWorkspaceTitle: "产物工作区",
      artifactWorkspaceSubtitle: "查看当前任务的静态 LP 文件、预览、片段和导出。",
      artifactWorkspaceEmptyTitle: "还没有产物工作区",
      artifactWorkspaceEmptyDescription: "先在工作台生成一个 LP 任务，系统会创建静态 HTML、CSS 和 JavaScript 文件。",
      artifactWorkspaceManifestTitle: "文件清单",
      artifactWorkspaceExportTitle: "导出",
      artifactWorkspaceOpenLabel: "打开产物工作区",
      artifactWorkspaceUnavailableLabel: "产物工作区暂不可用。",
```

Add locale nav values:

```ts
      workbench: "Workbench",
      artifacts: "Artifacts",
      skills: "Skills",
```

```ts
      workbench: "工作台",
      artifacts: "产物",
      skills: "技能",
```

- [ ] **Step 4: Run the i18n test**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add apps/web/src/lib/i18n.ts apps/web/src/lib/i18n.test.ts
git commit -m "add artifact workspace copy"
```

---

### Task 2: Server-rendered Artifacts View

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Write failing page tests**

Add tests to `apps/web/src/app/page.test.ts` in the page rendering suite near existing artifact diff tests:

```ts
it("renders artifacts as a top-level navigation item", async () => {
  pageMocks.pageState = emptyPageState;

  const page = await HomePage({ searchParams: Promise.resolve({ view: "artifacts" }) });
  const links = collectElements(page, "a");
  const artifactLink = links.find(
    (link) => collectText(link.props?.children).join("") === "Artifacts"
  );

  expect(artifactLink?.props?.href).toBe("/?view=artifacts");
  expect(artifactLink?.props?.["aria-current"]).toBe("page");
  expect(collectText(page).join(" ")).toContain("No artifact workspace yet");
});

it("renders the dedicated artifact workspace for the current LP task", async () => {
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
    searchParams: Promise.resolve({ view: "artifacts", artifactPath: "styles.css" })
  });
  const text = collectText(page).join(" ");
  const links = collectElements(page, "a");
  const hrefs = links.map((link) => String(link.props?.href ?? ""));

  expect(text).toContain("Artifact workspace");
  expect(text).toContain("Completed LP");
  expect(text).toContain("Create a no git spring ecommerce landing page.");
  expect(text).toContain("File manifest");
  expect(text).toContain("index.html static LP file");
  expect(text).toContain("styles.css static LP file");
  expect(text).toContain("Snippet preview");
  expect(text).toContain("body { color: #111827; }");
  expect(text).toContain("Static LP preview");
  expect(text).toContain("Exports");
  expect(text).toContain("index.single.html");
  expect(text).not.toContain("<!doctype html>");
  expect(text).not.toContain("window.lpAgent");
  expect(hrefs).toContainEqual(expect.stringContaining("view=artifacts"));
  expect(hrefs).toContainEqual(expect.stringContaining("artifactPath=index.html"));
});

it("renders sanitized artifact workspace failure states without leaking invalid paths", async () => {
  pageMocks.currentProjectId = "project_1";
  pageMocks.currentTaskId = "task_1";
  pageMocks.pageState = createCompletedLpPageState({
    artifactDiff: {
      projectId: "project_1",
      pageVersionId: "version_1",
      artifactWorkspaceId: "artifact_workspace_1",
      files: [],
      errorCode: "artifact_snippet_unavailable"
    }
  });

  const page = await HomePage({
    searchParams: Promise.resolve({
      view: "artifacts",
      artifactPath: "../secret.css?token=ARTIFACT_QUERY_SECRET"
    })
  });
  const text = collectText(page).join(" ");

  expect(text).toContain("Artifact workspace is unavailable.");
  expect(text).toContain("Snippet is unavailable.");
  expect(text).not.toContain("ARTIFACT_QUERY_SECRET");
  expect(text).not.toContain("../secret.css");
});
```

- [ ] **Step 2: Run focused page tests and confirm failure**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts
```

Expected: FAIL because `Artifacts` nav and `view=artifacts` rendering do not exist.

- [ ] **Step 3: Add `artifacts` active view and nav item**

In `apps/web/src/app/page.tsx`, replace active view resolution with:

```ts
  const activeView =
    view === "skills"
      ? "skills"
      : view === "models"
        ? "models"
        : view === "artifacts"
          ? "artifacts"
          : "workbench";
```

Add the nav item after Workbench:

```tsx
          <a
            aria-current={activeView === "artifacts" ? "page" : undefined}
            className={activeView === "artifacts" ? "navItem navItemActive" : "navItem"}
            href="/?view=artifacts"
          >
            {copy.nav.artifacts}
          </a>
```

- [ ] **Step 4: Add open-workspace link from generated files**

Inside the generated files `deliveryBlock`, after the artifact cards grid and before `ArtifactDiffBlock`, add:

```tsx
                                  <a className="allFilesCard" href="/?view=artifacts">
                                    {copy.chat.artifactWorkspaceOpenLabel}
                                  </a>
```

- [ ] **Step 5: Add `ArtifactWorkspaceView` server component helper**

Add this helper near `ArtifactDiffBlock` in `apps/web/src/app/page.tsx`:

```tsx
type TaskReadyWorkbenchPageState = Extract<WorkbenchPageState, { kind: "task_ready" }>;
type CompletedArtifactSnapshot = {
  brief: NonNullable<NonNullable<TaskReadyWorkbenchPageState["snapshot"]>["brief"]>;
  pageVersion: NonNullable<
    NonNullable<TaskReadyWorkbenchPageState["snapshot"]>["currentPageVersion"]
  >;
};

function ArtifactWorkspaceView({
  completedSnapshot,
  copy,
  downloadLinks,
  initialPreviewVersionKey,
  pageState,
  previewSearchParams
}: {
  completedSnapshot: CompletedArtifactSnapshot | undefined;
  copy: ReturnType<typeof getWorkbenchCopy>;
  downloadLinks: ReturnType<typeof createArtifactDownloadLinks> | undefined;
  initialPreviewVersionKey?: string;
  pageState: WorkbenchPageState;
  previewSearchParams: URLSearchParams;
}) {
  const artifactDiff = pageState.kind === "task_ready" ? pageState.artifactDiff : undefined;
  const hasWorkspace = completedSnapshot && artifactDiff;
  const liveTaskCopy = {
    liveTaskArtifactReady: copy.chat.liveTaskArtifactReady,
    liveTaskCompleted: copy.chat.liveTaskCompleted,
    liveTaskIdle: copy.chat.liveTaskIdle,
    liveTaskRefreshError: copy.chat.liveTaskRefreshError,
    liveTaskRunning: copy.chat.liveTaskRunning,
    liveTaskTitle: copy.chat.liveTaskTitle
  };

  if (pageState.kind !== "task_ready" || !hasWorkspace) {
    return (
      <section className="artifactWorkspaceView" aria-label={copy.chat.artifactWorkspaceTitle}>
        <div className="artifactWorkspaceEmpty">
          <strong>{copy.chat.artifactWorkspaceEmptyTitle}</strong>
          <p>{copy.chat.artifactWorkspaceEmptyDescription}</p>
          <a href="/">{copy.nav.workbench}</a>
        </div>
      </section>
    );
  }

  return (
    <section className="artifactWorkspaceView" aria-label={copy.chat.artifactWorkspaceTitle}>
      <header className="artifactWorkspaceHero">
        <div>
          <span>{copy.chat.artifactWorkspaceTitle}</span>
          <h1>{completedSnapshot.pageVersion.id}</h1>
          <p>{copy.chat.artifactWorkspaceSubtitle}</p>
        </div>
        <div className="artifactWorkspaceMeta">
          <span>{pageState.snapshot?.project.name}</span>
          <strong>{pageState.task.title}</strong>
          {artifactDiff.artifactWorkspaceId ? <small>{artifactDiff.artifactWorkspaceId}</small> : null}
        </div>
      </header>

      <LiveTaskPanel
        taskId={pageState.task.id}
        initialProjectId={pageState.task.projectId}
        initialPreviewVersionKey={initialPreviewVersionKey}
        copy={liveTaskCopy}
      />

      <section className="artifactWorkspaceSection" aria-label={copy.chat.artifactWorkspaceManifestTitle}>
        <div className="artifactWorkspaceSectionHeader">
          <strong>{copy.chat.artifactWorkspaceManifestTitle}</strong>
          <span>{artifactDiff.files.length}</span>
        </div>
        {artifactDiff.files.length > 0 ? (
          ArtifactDiffBlock({
            artifactDiff,
            copy: copy.chat,
            previewSearchParams
          })
        ) : (
          <p className="artifactSnippetNotice">{copy.chat.artifactWorkspaceUnavailableLabel}</p>
        )}
        {artifactDiff.errorCode === "artifact_diff_unavailable" ? (
          <p className="artifactSnippetNotice">{copy.chat.artifactWorkspaceUnavailableLabel}</p>
        ) : null}
      </section>

      <section className="artifactWorkspaceSection" aria-label={copy.chat.previewTitle}>
        <div className="artifactWorkspaceSectionHeader">
          <strong>{copy.chat.previewTitle}</strong>
        </div>
        <LPPreview artifacts={completedSnapshot.pageVersion.artifacts} />
      </section>

      {downloadLinks ? (
        <section className="artifactWorkspaceSection" aria-label={copy.chat.artifactWorkspaceExportTitle}>
          <div className="artifactWorkspaceSectionHeader">
            <strong>{copy.chat.artifactWorkspaceExportTitle}</strong>
            <span>{downloadLinks.length}</span>
          </div>
          <div className="artifactGrid">
            {downloadLinks.map((artifact) => (
              <a
                className="artifactCard"
                download={artifact.filename}
                href={artifact.href}
                key={artifact.id}
              >
                <span>{artifact.kind}</span>
                <strong>{artifact.filename}</strong>
                <small>{copy.chat.bytesLabel(artifact.bytes)}</small>
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 6: Render the artifacts view in the main surface**

In the main content area before the workbench branch, add the artifacts branch:

```tsx
        {activeView === "artifacts" ? (
          <ArtifactWorkspaceView
            completedSnapshot={completedSnapshot}
            copy={copy}
            downloadLinks={downloadLinks}
            initialPreviewVersionKey={initialPreviewVersionKey}
            pageState={pageState}
            previewSearchParams={previewSearchParams}
          />
        ) : activeView === "skills" ? (
```

- [ ] **Step 7: Preserve `view=artifacts` in snippet links while stripping legacy MCP**

Keep `previewSearchParams` construction as the source of truth. Confirm it keeps `view=artifacts` because `activeView !== "workbench"`:

```ts
  const previewSearchParams = toURLSearchParams({
    ...params,
    view: activeView === "workbench" ? undefined : activeView
  });
```

No extra branch is needed; this is the regression lock.

- [ ] **Step 8: Add CSS**

Add to `apps/web/src/app/globals.css` near existing artifact styles:

```css
.artifactWorkspaceView {
  min-width: 0;
  display: grid;
  gap: 16px;
  width: min(1120px, 100%);
  margin: 0 auto;
  padding: 24px;
}

.artifactWorkspaceHero,
.artifactWorkspaceSection,
.artifactWorkspaceEmpty {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.78);
}

.artifactWorkspaceHero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 320px);
  gap: 18px;
  padding: 18px;
}

.artifactWorkspaceHero span,
.artifactWorkspaceSectionHeader span,
.artifactWorkspaceMeta small {
  color: var(--muted);
  font-size: 0.76rem;
  font-weight: 760;
}

.artifactWorkspaceHero h1 {
  margin: 4px 0 6px;
  font-size: 1.35rem;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.artifactWorkspaceHero p,
.artifactWorkspaceEmpty p {
  margin: 0;
  color: var(--muted);
  line-height: 1.55;
}

.artifactWorkspaceMeta {
  min-width: 0;
  display: grid;
  gap: 6px;
  align-content: start;
  border-left: 1px solid var(--line);
  padding-left: 16px;
}

.artifactWorkspaceMeta strong {
  overflow-wrap: anywhere;
}

.artifactWorkspaceSection {
  display: grid;
  gap: 12px;
  overflow: hidden;
  padding-bottom: 14px;
}

.artifactWorkspaceSectionHeader {
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--line);
  padding: 0 14px;
}

.artifactWorkspaceEmpty {
  display: grid;
  gap: 8px;
  padding: 18px;
}

.artifactWorkspaceEmpty a {
  color: var(--accent);
  font-weight: 800;
  text-decoration: none;
}
```

Add a mobile override near the existing media queries:

```css
  .artifactWorkspaceView {
    padding: 16px;
  }

  .artifactWorkspaceHero {
    grid-template-columns: 1fr;
  }

  .artifactWorkspaceMeta {
    border-left: 0;
    border-top: 1px solid var(--line);
    padding-left: 0;
    padding-top: 12px;
  }
```

- [ ] **Step 9: Run focused page tests**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Task 2**

Run:

```bash
git add apps/web/src/app/page.tsx apps/web/src/app/page.test.ts apps/web/src/app/globals.css
git commit -m "add dedicated artifact workspace view"
```

---

### Task 3: Browser Acceptance Coverage

**Files:**
- Modify: `apps/web/e2e/helpers.ts`
- Modify: `apps/web/e2e/alpha-lp-artifacts.spec.ts`

- [ ] **Step 1: Add failing browser helper assertions**

Add to `apps/web/e2e/helpers.ts`:

```ts
export async function expectDedicatedArtifactWorkspace(page: Page) {
  await expect(page.getByRole("link", { name: "Artifacts" })).toBeVisible();
  await page.getByRole("link", { name: "Artifacts" }).click();
  await expect(page).toHaveURL(/[?&]view=artifacts(?:&|$)/);

  const workspace = page.getByLabel("Artifact workspace");
  await expect(workspace).toBeVisible();
  await expect(workspace.getByText("File manifest", { exact: true })).toBeVisible();

  for (const filePath of ["index.html", "styles.css", "script.js"]) {
    await expect(workspace.getByText(filePath, { exact: true })).toBeVisible();
    await expect(
      workspace.getByRole("link", { name: `Preview snippet: ${filePath}` })
    ).toBeVisible();
  }

  await expect(workspace.getByLabel("Static LP preview")).toBeVisible();
  await expect(workspace.getByLabel("Exports")).toBeVisible();
  await expect(workspace.getByRole("link", { name: /index\.single\.html/ })).toBeVisible();
}

export async function expectWorkspaceSnippetFor(page: Page, filePath: string) {
  const workspace = page.getByLabel("Artifact workspace");
  await workspace.getByRole("link", { name: `Preview snippet: ${filePath}` }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `[?&]view=artifacts(?:&|$).*[?&]artifactPath=${escapeRegExp(encodeURIComponent(filePath))}(?:&|$)`
    )
  );
  await expect(workspace.getByText("Snippet preview", { exact: true })).toBeVisible();
  await expect(workspace.getByText(filePath, { exact: true })).toBeVisible();
}
```

- [ ] **Step 2: Extend the artifact E2E spec**

Update `apps/web/e2e/alpha-lp-artifacts.spec.ts` imports:

```ts
import {
  expectDedicatedArtifactWorkspace,
  expectSnippetFor,
  expectStaticLpArtifacts,
  expectWorkspaceSnippetFor,
  submitPrompt
} from "./helpers";
```

After the existing workbench snippet assertions, add:

```ts
  await expectDedicatedArtifactWorkspace(page);
  await expectWorkspaceSnippetFor(page, "index.html");
  await expectWorkspaceSnippetFor(page, "styles.css");
  await expectWorkspaceSnippetFor(page, "script.js");

  await page.goto("/?view=artifacts&artifactPath=unknown.txt");
  await expect(page.getByText("Snippet is unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Artifact workspace")).toBeVisible();

  await page.goto("/?view=artifacts&artifactPath=..%2Fsecret.css%3Ftoken%3DARTIFACT_QUERY_SECRET");
  await expect(page.getByText("Snippet is unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByText("ARTIFACT_QUERY_SECRET")).toHaveCount(0);
  await expect(page.getByText("../secret.css")).toHaveCount(0);
  await expect(page.getByLabel("Artifact workspace")).toBeVisible();
```

- [ ] **Step 3: Run the E2E spec and confirm failure before implementation if Task 2 is not complete**

Run:

```bash
pnpm alpha:e2e -- apps/web/e2e/alpha-lp-artifacts.spec.ts
```

Expected before Task 2: FAIL because the Artifacts navigation and view are missing. Expected after Task 2: PASS. If Playwright rejects the extra CLI spec argument, run `pnpm alpha:e2e` and inspect the artifact spec result.

- [ ] **Step 4: Commit Task 3**

Run:

```bash
git add apps/web/e2e/helpers.ts apps/web/e2e/alpha-lp-artifacts.spec.ts
git commit -m "cover artifact workspace in browser acceptance"
```

---

### Task 4: Documentation Closeout and Verification

**Files:**
- Modify: `docs/web-v1-acceptance.md`
- Modify: `docs/alpha-release-candidate.md`
- Modify: `docs/project-roadmap.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Update manual acceptance docs**

In `docs/web-v1-acceptance.md`, add a dedicated artifact workspace check under the LP artifact acceptance section:

```md
### Dedicated Artifact Workspace

- Open the `Artifacts` navigation item after an LP task completes.
- Confirm the workspace shows `index.html`, `styles.css`, and `script.js` with bounded metadata.
- Preview snippets for each file; oversized or invalid paths must show safe unavailable copy.
- Confirm static preview and export links are visible.
- Confirm invalid `artifactPath` values do not echo query secrets, local paths, or traversal strings.
```

In `docs/alpha-release-candidate.md`, add to the operator trial script:

```md
- Artifact workspace: after LP generation, open `Artifacts`, inspect the three-file manifest, preview snippets, check static preview, and verify single HTML export is available.
```

- [ ] **Step 2: Close roadmap Stage 42 and keep next queue non-empty**

Update `docs/project-roadmap.md`:

```md
### Stage 42：Dedicated Artifact Workspace v0

**状态：** 已实现。
```

Add an implementation summary under Stage 42:

```md
已实现范围：

- V1 顶层 navigation 新增 `Artifacts`，使用 `view=artifacts` 复用当前 project/task session。
- Dedicated artifact workspace 展示三文件 manifest、state、size、short hash、summary、bounded snippet、static preview 和 export links。
- artifact snippet links 保留 `view=artifacts`，legacy `view=mcp` 继续安全降级并不被 artifact links 保留。
- Unknown path、path traversal、missing workspace/diff 和 snippet unavailable 显示安全失败状态，不回显危险 query。
- Browser acceptance 已覆盖 artifact workspace happy path 和 unsafe artifact path。

**实施计划：** `docs/superpowers/plans/2026-05-23-dedicated-artifact-workspace.md`。
```

Update Stage 43 status from `Stage 42 后推荐` to `当前推荐`.

Add a decision record:

```md
- 2026-05-23 Stage 42 已完成 Dedicated Artifact Workspace v0：V1 Web navigation 新增 `Artifacts`，`view=artifacts` 展示当前 LP task 的三文件 manifest、bounded snippet、preview、export 和安全失败状态；默认下一路由为 Stage 43 Run Timeline and Recovery UX Polish v0。
```

- [ ] **Step 3: Add this plan to the Superpowers index**

In `docs/superpowers/README.md`, add after Stage 42 design:

```md
112. `plans/2026-05-23-dedicated-artifact-workspace.md`
   - Stage 42 Dedicated Artifact Workspace v0 implementation plan（当前实施依据）。
   - 在 Stage 42 design 后阅读，用于按 TDD 实现 `view=artifacts` navigation、dedicated artifact workspace UI、browser acceptance、manual acceptance docs 和 roadmap closeout。
```

- [ ] **Step 4: Run final verification**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts apps/web/src/lib/i18n.test.ts apps/web/src/lib/workbench-store.test.ts
pnpm alpha:check
pnpm typecheck
pnpm alpha:e2e
git diff --check
```

Expected:

- Focused Vitest: PASS.
- `pnpm alpha:check`: PASS.
- `pnpm typecheck`: PASS.
- `pnpm alpha:e2e`: PASS.
- `git diff --check`: no output.

If `pnpm alpha:e2e` fails with sandbox port binding, rerun it with approved escalation for the `pnpm alpha:e2e` command.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add docs/web-v1-acceptance.md docs/alpha-release-candidate.md docs/project-roadmap.md docs/superpowers/README.md
git commit -m "complete artifact workspace stage"
```

---

## Self-Review

- Spec coverage: Tasks 1-3 cover navigation, `view=artifacts`, file manifest, bounded snippet, static preview, export, no-refresh refresh boundary, and safe failure states. Task 4 covers required roadmap, Superpowers index, manual acceptance, and RC docs.
- Placeholder scan: Plan contains concrete files, tests, commands, expected outcomes, and code snippets.
- Type consistency: Copy keys use `artifactWorkspaceTitle`, `artifactWorkspaceSubtitle`, `artifactWorkspaceEmptyTitle`, `artifactWorkspaceEmptyDescription`, `artifactWorkspaceManifestTitle`, `artifactWorkspaceExportTitle`, `artifactWorkspaceOpenLabel`, and `artifactWorkspaceUnavailableLabel` consistently across tests and implementation.
