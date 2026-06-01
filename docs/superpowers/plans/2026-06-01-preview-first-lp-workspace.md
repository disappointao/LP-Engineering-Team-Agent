# Preview-first LP Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 LP task 支持右侧预览工作区、按需导出、元素查看器和选中元素上下文提交。

**Architecture:** Phase 1 先做 Web 可见闭环：client-side preview workspace 管理打开状态、iframe inspect mode 和 selected element；composer 提交 selected element；后端把 selected element 作为 bounded prompt context。Phase 2 再把 artifact workspace 文件持久化改成 lazy materialization。

**Tech Stack:** Next.js App Router, React client components, iframe `srcDoc` + `postMessage`, Vitest, Playwright, existing `StaticArtifacts` and Web workbench store.

---

### Task 1: 右侧预览工作区 UI

**Files:**
- Create: `apps/web/src/app/lp-preview-workspace.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/globals.css`
- Test: `apps/web/src/app/page.test.ts`

- [ ] **Step 1: Write failing render test**

Add a page test that creates a completed LP state and asserts `LPPreviewWorkspace` is rendered instead of `ArtifactPreviewDrawer`, with labels for preview, export, inspect mode, and selected element.

- [ ] **Step 2: Run red test**

Run: `pnpm vitest run apps/web/src/app/page.test.ts -t "renders the preview workspace"`

Expected: FAIL because `LPPreviewWorkspace` does not exist.

- [ ] **Step 3: Implement workspace shell**

Create a client component that renders trigger button, right-side panel, preview children, export buttons, inspect toggle and selected element status. Keep state local in the component.

- [ ] **Step 4: Replace drawer usage**

Replace `ArtifactPreviewDrawer` in the delivery block with `LPPreviewWorkspace`. The dedicated `view=artifacts` page can keep inline preview/export for now.

- [ ] **Step 5: Style responsive split layout**

Add CSS so opening the preview panel narrows `.conversationStack` and pins the panel inside `.chatWorkspace`. On small screens, make the preview panel occupy the available lower/full screen space without overlapping composer text.

- [ ] **Step 6: Verify**

Run: `pnpm vitest run apps/web/src/app/page.test.ts -t "preview workspace"`

Expected: PASS.

### Task 2: Client-side export links

**Files:**
- Create or modify: `apps/web/src/app/lp-preview-workspace.tsx`
- Modify: `apps/web/src/lib/export-links.ts`
- Test: `apps/web/src/lib/export-links.test.ts`

- [ ] **Step 1: Write failing unit test**

Add a test for a pure helper that returns export file descriptors without data URLs, then a client helper creates data URLs only when requested.

- [ ] **Step 2: Run red test**

Run: `pnpm vitest run apps/web/src/lib/export-links.test.ts`

Expected: FAIL for missing helper.

- [ ] **Step 3: Implement lazy export descriptors**

Expose artifact export descriptors with `filename`, `mimeType`, `content`, `bytes`, `label`. Keep existing `createArtifactDownloadLinks` for compatibility, but make preview workspace consume descriptors and create data URLs client-side.

- [ ] **Step 4: Verify**

Run: `pnpm vitest run apps/web/src/lib/export-links.test.ts apps/web/src/app/page.test.ts`

Expected: PASS.

### Task 3: iframe 元素查看器

**Files:**
- Modify: `apps/web/src/components/lp-preview.tsx`
- Modify: `apps/web/src/app/lp-preview-workspace.tsx`
- Test: `apps/web/src/components/lp-preview.test.tsx` or `apps/web/src/app/lp-preview-workspace.test.tsx`
- E2E: `apps/web/e2e/alpha-lp-artifacts.spec.ts`

- [ ] **Step 1: Write failing component test**

Assert that inspect mode injects inspector bridge script into `srcDoc`, and that non-inspect mode keeps normal preview behavior.

- [ ] **Step 2: Run red test**

Run: `pnpm vitest run apps/web/src/components/lp-preview.test.tsx`

Expected: FAIL because inspect props are not supported.

- [ ] **Step 3: Implement inspect bridge**

Add optional `inspectMode` prop to `LPPreview`; when true, inject a small script that posts `lp-preview-element-selected` events with bounded selector/text/html metadata.

- [ ] **Step 4: Wire parent listener**

`LPPreviewWorkspace` listens for selected element events and updates local selected element state.

- [ ] **Step 5: Verify**

Run: `pnpm vitest run apps/web/src/components/lp-preview.test.tsx apps/web/src/app/page.test.ts`

Expected: PASS.

### Task 4: selected element composer context

**Files:**
- Modify: `apps/web/src/app/streaming-workbench.tsx`
- Modify: `apps/web/src/app/actions.ts`
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/app/api/chat/stream/route.ts`
- Test: `apps/web/src/app/streaming-workbench.test.ts`
- Test: `apps/web/src/app/actions.test.ts`
- Test: `apps/web/src/app/api/chat/stream/route.test.ts`

- [ ] **Step 1: Write failing tests**

Tests should show that selected element is included in streaming request body and native server action submission, and that the stored prompt/context includes a bounded selected element note.

- [ ] **Step 2: Run red tests**

Run: `pnpm vitest run apps/web/src/app/streaming-workbench.test.ts apps/web/src/app/actions.test.ts apps/web/src/app/api/chat/stream/route.test.ts -t "selected element"`

Expected: FAIL because selected element is ignored.

- [ ] **Step 3: Implement context serialization**

Define a bounded selected element type. Add hidden form field and JSON request field. Sanitize length and append safe context to prompt before routing.

- [ ] **Step 4: Verify**

Run the focused tests above.

Expected: PASS.

### Task 5: browser acceptance and real model smoke

**Files:**
- Modify: `apps/web/e2e/alpha-routing-conversation.spec.ts` or `apps/web/e2e/alpha-lp-artifacts.spec.ts`
- Docs closeout: `docs/project-roadmap.md`, `docs/superpowers/README.md`, and `docs/agent-development-learning.md` if runtime/context boundaries changed.

- [ ] **Step 1: Add deterministic Playwright flow**

Create/continue an LP task, open the preview workspace, enable inspect mode, click an element inside the iframe, verify composer selected-element chip, submit a follow-up, and verify no full page reload.

- [ ] **Step 2: Run deterministic browser test**

Run: `pnpm alpha:e2e`

Expected: PASS.

- [ ] **Step 3: Run real model smoke**

Run the local app with `REAL_MODEL_RUNTIME=1 pnpm dev`, use Browser to submit a real LP prompt, open preview, select an element, ask for a targeted edit, and verify the flow completes. If provider quota/config blocks the run, record the exact bounded UI failure and do not claim real model pass.

- [ ] **Step 4: Full verification**

Run: `pnpm test`, `pnpm typecheck`, `pnpm build`, `git diff --check`.

Expected: PASS.
