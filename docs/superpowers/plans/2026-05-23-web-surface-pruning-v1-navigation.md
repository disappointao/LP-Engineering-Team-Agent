# Web Surface Pruning and V1 Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide MCP management and MCP tab/sidebar/top-level Web entry from the V1 polished alpha surface while keeping existing backend MCP contracts intact.

**Architecture:** Treat `view=mcp` as a legacy/deferred entry that renders the workbench surface, not the MCP management UI. Remove the visible MCP navigation link and MCP forms from the page render path, keep `WorkbenchStore` and API MCP operations untouched, and update acceptance docs/tests to assert the hidden V1 boundary. The MCP backend remains available for later stages; this stage only changes Web surface exposure.

**Tech Stack:** Next.js App Router server component, React unit rendering through Vitest, Playwright deterministic alpha E2E, Markdown acceptance docs.

---

## File Structure

- Modify `apps/web/src/app/page.test.ts`
  - Replace MCP view rendering assertions with V1 hidden-surface regression tests.
- Modify `apps/web/src/app/page.tsx`
  - Normalize `view=mcp` to `workbench`, remove the sidebar MCP link, and remove the MCP management render branch/imports/helpers.
- Modify `apps/web/src/lib/i18n.ts`
  - Remove visible MCP quick-action copy from first-viewport action chips.
- Modify `apps/web/src/lib/i18n.test.ts`
  - Assert the visible action chips no longer advertise MCP in either locale.
- Modify `apps/web/e2e/alpha-boundaries.spec.ts`
  - Replace the MCP view happy path with hidden navigation and legacy `/?view=mcp` safe fallback assertions.
- Modify `docs/web-v1-acceptance.md`
  - Update manual acceptance from "open MCP view" to "MCP entry hidden and legacy route safe fallback".
- Modify `docs/alpha-release-candidate.md`
  - Update the operator trial script and go/no-go language for MCP hidden V1 Web surface.
- Modify `docs/project-roadmap.md`
  - Link this Stage 41 plan under the Stage 41 roadmap entry.
- Modify `docs/superpowers/README.md`
  - Add this Stage 41 implementation plan to the reading order.

## Task 1: Write Failing Web Surface Regression Tests

**Files:**
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`
- Modify: `apps/web/e2e/alpha-boundaries.spec.ts`

- [ ] **Step 1: Replace MCP page-render tests with hidden-surface unit tests**

In `apps/web/src/app/page.test.ts`, replace the current MCP view tests starting at `it("renders the MCP view with localized project context", async () => {` and ending after the closing `});` for `it("renders localized MCP flow errors", async () => {` with:

```ts
  it("hides MCP navigation from the V1 web surface", async () => {
    const page = await HomePage({
      searchParams: Promise.resolve({})
    });
    const links = collectElements(page, "a");
    const linkLabels = links.map((link) => collectText(link.props?.children).join(""));

    expect(linkLabels).toContain("Workbench");
    expect(linkLabels).toContain("Skills");
    expect(linkLabels).toContain("Models");
    expect(linkLabels).not.toContain("MCP");
    expect(
      links.some(
        (link) =>
          link.props?.href === "/?view=mcp" ||
          collectText(link.props?.children).join("") === "MCP"
      )
    ).toBe(false);
  });

  it("downgrades the legacy mcp view to the workbench without rendering MCP forms", async () => {
    setActiveEmptyProjectState();

    const page = await HomePage({
      searchParams: Promise.resolve({ view: "mcp", mcpError: "mcp_connector_json_invalid" })
    });
    const text = collectText(page).join(" ");
    const links = collectElements(page, "a");
    const textareas = collectElements(page, "textarea");

    expect(text).toContain("What can I help you build?");
    expect(text).not.toContain("Project MCP");
    expect(text).not.toContain("Connector JSON");
    expect(text).not.toContain("Visible tools");
    expect(text).not.toContain("Run read-only check");
    expect(text).not.toContain("Enter a valid connector JSON.");
    expect(textareas.some((textarea) => textarea.props?.name === "definitionJson")).toBe(false);
    expect(
      links.some(
        (link) =>
          link.props?.href === "/" &&
          link.props?.className === "navItem navItemActive" &&
          collectText(link.props?.children).join("") === "Workbench"
      )
    ).toBe(true);
    expect(
      links.some(
        (link) =>
          link.props?.href === "/?view=mcp" ||
          collectText(link.props?.children).join("") === "MCP"
      )
    ).toBe(false);
  });
```

Expected after this step and before implementation: `apps/web/src/app/page.test.ts` fails because MCP navigation and MCP forms still render.

- [ ] **Step 2: Add i18n assertions for no visible MCP quick action**

In `apps/web/src/lib/i18n.test.ts`, inside `it("exposes localized workbench labels", () => {`, after the existing `expect(en.hero.title).toBe("What LP should we build?");` assertion, add:

```ts
    expect(en.hero.actionChips.join(" ")).not.toContain("MCP");
    expect(zh.hero.actionChips.join(" ")).not.toContain("MCP");
```

Expected after this step and before implementation: `apps/web/src/lib/i18n.test.ts` fails because both locales still include the visible MCP quick action.

- [ ] **Step 3: Replace the MCP E2E happy path with hidden/fallback assertions**

In `apps/web/e2e/alpha-boundaries.spec.ts`, replace the last MCP navigation block in `test("shows Skill-only alpha boundary views", async ({ page }) => {`:

```ts
  await navigation.getByRole("link", { name: "MCP" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "Project MCP" })
  ).toBeVisible();
  await expect(
    page.getByText(
      "MCP is deferred for this alpha. Chat and LP generation work without configuring connectors.",
      { exact: true }
    )
  ).toBeVisible();
```

with:

```ts
  await expect(navigation.getByRole("link", { name: "MCP" })).toHaveCount(0);

  await page.goto("/?view=mcp");
  await expect(page.getByRole("heading", { name: "What can I help you build?" })).toBeVisible();
  await expect(page.getByRole("heading", { exact: true, name: "Project MCP" })).toHaveCount(0);
  await expect(page.getByText("Connector JSON")).toHaveCount(0);
  await expect(page.getByText("Run read-only check")).toHaveCount(0);
```

Expected after this step and before implementation: `apps/web/e2e/alpha-boundaries.spec.ts` fails because the MCP link and MCP view still exist.

- [ ] **Step 4: Run focused failing tests**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts apps/web/src/lib/i18n.test.ts
```

Expected: FAIL. The page tests should report MCP link/form visibility, and the i18n test should report MCP still present in action chips.

## Task 2: Hide MCP From the Server-rendered Web Surface

**Files:**
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Remove visible MCP imports and state from the page**

In `apps/web/src/app/page.tsx`, remove these imports:

```ts
import { isReadOnlyMCPTool } from "@lp-agent/mcp-gateway";
```

and remove these action imports from the `./actions` import list:

```ts
  createMCPConnectorAction,
  executeMCPToolAction,
  setMCPConnectorEnabledAction,
  setMCPToolApprovalAction,
```

and remove these type imports from `../lib/workbench-store`:

```ts
  type MCPFlowErrorCode,
  type ProjectMCPState,
```

- [ ] **Step 2: Normalize `view=mcp` to workbench**

In `apps/web/src/app/page.tsx`, replace:

```ts
  const activeView =
    view === "skills"
      ? "skills"
      : view === "mcp"
        ? "mcp"
        : view === "models"
          ? "models"
          : "workbench";
```

with:

```ts
  const activeView =
    view === "skills" ? "skills" : view === "models" ? "models" : "workbench";
```

Then remove:

```ts
  const mcpError = toMCPFlowError(getFirstSearchParam(params?.mcpError));
  const mcpState = getPageMCPState(pageState);
  const mcpErrorMessage = mcpError ? copy.mcpView.errors[mcpError] : undefined;
```

- [ ] **Step 3: Remove MCP from the sidebar and workspace label**

In `apps/web/src/app/page.tsx`, delete the MCP sidebar link:

```tsx
          <a className={activeView === "mcp" ? "navItem navItemActive" : "navItem"} href="/?view=mcp">
            {copy.nav.mcp}
          </a>
```

Then replace the `aria-label` expression:

```tsx
          activeView === "skills"
            ? copy.nav.skills
            : activeView === "mcp"
              ? copy.nav.mcp
              : activeView === "models"
                ? copy.nav.models
                : copy.nav.workbench
```

with:

```tsx
          activeView === "skills"
            ? copy.nav.skills
            : activeView === "models"
              ? copy.nav.models
              : copy.nav.workbench
```

- [ ] **Step 4: Remove the MCP management render branch**

In `apps/web/src/app/page.tsx`, delete the entire block that starts with:

```tsx
            {activeView === "mcp" ? (
              <section className="mcpView" aria-labelledby="mcp-title">
```

and ends with:

```tsx
              </section>
            ) : null}
```

After the deletion, the non-workbench branch should only render `skillsView` and `modelsView` sections.

- [ ] **Step 5: Remove now-unused MCP page helpers**

In `apps/web/src/app/page.tsx`, remove the declarations named:

- `getPageMCPState`
- `RenderableMCPTool`
- `RenderableMCPConnector`
- `toRenderableMCPConnector`
- `toRenderableMCPTool`
- `toMCPRoleLabels`
- `isReadOnlyVisibleMCPTool`
- `toMCPFlowError`

Do not remove MCP store methods, API service methods, repository types, or `copy.mcpView`; those are backend/deferred capabilities for later stages.

- [ ] **Step 6: Run focused page tests**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts
```

Expected: PASS for the updated page tests.

- [ ] **Step 7: Commit the page surface change**

Run:

```bash
git add apps/web/src/app/page.tsx apps/web/src/app/page.test.ts
git commit -m "hide mcp from v1 web navigation"
```

Expected: commit succeeds.

## Task 3: Remove MCP From Visible First-viewport Copy

**Files:**
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`

- [ ] **Step 1: Replace English and Chinese MCP quick-action labels**

In `apps/web/src/lib/i18n.ts`, replace the English hero action chips:

```ts
      actionChips: ["Build LP", "Apply skill", "Check MCP", "Route model", "Export handoff"]
```

with:

```ts
      actionChips: ["Build LP", "Apply skill", "Review artifacts", "Route model", "Export handoff"]
```

Replace the Chinese hero action chips:

```ts
      actionChips: ["生成 LP", "应用技能", "检查 MCP", "选择模型", "导出交接"]
```

with:

```ts
      actionChips: ["生成 LP", "应用技能", "检查产物", "选择模型", "导出交接"]
```

Keep `copy.nav.mcp` and `copy.mcpView` in the locale object because backend/deferred MCP code still has localized copy for later stages.

- [ ] **Step 2: Run i18n tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit the visible-copy change**

Run:

```bash
git add apps/web/src/lib/i18n.ts apps/web/src/lib/i18n.test.ts
git commit -m "remove mcp quick action from v1 copy"
```

Expected: commit succeeds.

## Task 4: Update Browser Acceptance and Operator Docs

**Files:**
- Modify: `apps/web/e2e/alpha-boundaries.spec.ts`
- Modify: `docs/web-v1-acceptance.md`
- Modify: `docs/alpha-release-candidate.md`

- [ ] **Step 1: Run the focused E2E test before implementation check**

Run:

```bash
pnpm alpha:e2e -- --grep "Skill-only alpha boundary views"
```

Expected after Tasks 2-3: PASS. If Playwright browsers are not installed, run `pnpm alpha:e2e:install` first.

- [ ] **Step 2: Update manual acceptance MCP section**

In `docs/web-v1-acceptance.md`, replace the current `## Models 和 MCP 边界` checklist items that instruct the operator to click `MCP` with:

```markdown
## Models 和 MCP 边界

- [ ] 点击 sidebar 中的 `Models`，确认 view 能打开，并展示 deterministic/mock resolved routes 和真实 provider 配置表单字段。
- [ ] 确认 sidebar / top-level navigation 不展示 `MCP` 入口。
- [ ] 直接访问 `/?view=mcp`，确认页面安全降级到 workbench 或只读 deferred surface，不展示 MCP connector、tool approval 或 execution form。
- [ ] 不配置 MCP connector 的情况下，普通聊天和 LP 任务仍可完成。
- [ ] 当前 alpha 不要求真实 MCP server、write tools、真实 shell execution 或真实部署。
```

- [ ] **Step 3: Update RC operator trial script**

In `docs/alpha-release-candidate.md`, replace step 8 under `Operator Trial Script` with:

```markdown
8. Models / MCP 边界：
   - 打开 Models view，确认真实 provider 是 opt-in。
   - 确认 sidebar / top-level navigation 不展示 MCP 入口。
   - 直接访问 `/?view=mcp`，确认页面安全降级，不展示 MCP connector、tool approval 或 execution form。
   - 不配置 MCP 仍可完成普通聊天和 LP task。
```

- [ ] **Step 4: Run documentation checks**

Run:

```bash
rg -n "不展示 `MCP`|\\?view=mcp|MCP connector、tool approval|Default next route: Stage 41" docs/web-v1-acceptance.md docs/alpha-release-candidate.md docs/alpha-feedback-log.md
```

Expected: PASS with matches for hidden MCP navigation, legacy route fallback, and Stage 41 routing.

- [ ] **Step 5: Commit E2E and doc updates**

Run:

```bash
git add apps/web/e2e/alpha-boundaries.spec.ts docs/web-v1-acceptance.md docs/alpha-release-candidate.md
git commit -m "update v1 acceptance for hidden mcp surface"
```

Expected: commit succeeds.

## Task 5: Index Stage 41 Plan and Run Final Gates

**Files:**
- Modify: `docs/project-roadmap.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Add the Stage 41 plan link to roadmap**

In `docs/project-roadmap.md`, under the Stage 41 non-goals list, add:

```markdown
**设计：** `docs/superpowers/specs/2026-05-23-v1-polished-alpha-web-completion-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-23-web-surface-pruning-v1-navigation.md`。
```

- [ ] **Step 2: Add the Stage 41 plan to the Superpowers index**

In `docs/superpowers/README.md`, after entry 109, add:

```markdown
110. `plans/2026-05-23-web-surface-pruning-v1-navigation.md`
   - Stage 41 Web Surface Pruning and V1 Navigation v0 implementation plan（待执行）。
   - 在 V1 polished alpha design、Stage 40 feedback intake plan 和当前 roadmap 后阅读，用于隐藏 MCP tab/sidebar/top-level Web 入口、让旧 `view=mcp` 安全降级，并更新 V1 acceptance / browser boundary tests。
```

- [ ] **Step 3: Run focused automated gates**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts apps/web/src/lib/i18n.test.ts
pnpm alpha:e2e -- --grep "Skill-only alpha boundary views"
git diff --check
```

Expected: all commands PASS.

- [ ] **Step 4: Run alpha check**

Run:

```bash
pnpm alpha:check
```

Expected: PASS.

- [ ] **Step 5: Final status check**

Run:

```bash
git status --short
```

Expected: only intentional files are modified if commits were not made by the executor; otherwise the working tree is clean.

- [ ] **Step 6: Commit roadmap and index updates**

Run:

```bash
git add docs/project-roadmap.md docs/superpowers/README.md docs/superpowers/plans/2026-05-23-web-surface-pruning-v1-navigation.md
git commit -m "plan web surface pruning"
```

Expected: commit succeeds.

## Self-review

- Spec coverage: Stage 41 requirements map to tests and implementation tasks: MCP navigation hidden, `view=mcp` fallback, V1 visible entries limited to workbench/Skills/Models, acceptance docs updated, backend MCP contracts retained.
- Placeholder scan: no task relies on undefined implementation details; every command has expected output.
- Type consistency: page-level visible view values are `workbench | skills | models`; MCP store and service types remain unchanged for later backend/deferred work.
