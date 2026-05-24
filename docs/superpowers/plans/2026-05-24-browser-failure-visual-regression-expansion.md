# Browser Failure and Visual Regression Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand deterministic Playwright alpha acceptance to cover Stage 41-44 V1 Web surface failure states, non-leakage, and lightweight visual layout contracts.

**Architecture:** Keep the default `pnpm alpha:e2e` gate deterministic and Chromium-only. Add focused Playwright coverage in existing E2E specs, shared helpers for layout/non-leakage contracts, isolated JSON-state mutations only for UI-unreachable fail-closed states, and docs closeout for Stage 45.

**Tech Stack:** pnpm, TypeScript, Next.js App Router, Playwright, Vitest, JSON-file test state.

---

## Files and Responsibilities

- `apps/web/e2e/helpers.ts`: shared Playwright helpers for no-leak assertions and layout contracts.
- `apps/web/e2e/alpha-visual.spec.ts`: lightweight geometry contracts and diagnostic screenshots for empty workbench, artifact workspace, Skills, and Models surfaces.
- `apps/web/e2e/alpha-lp-artifacts.spec.ts`: LP artifact workspace boundary coverage, including invalid paths and oversized snippet non-leakage.
- `apps/web/e2e/alpha-boundaries.spec.ts`: MCP hidden / legacy route safe fallback coverage.
- `apps/web/e2e/alpha-failures.spec.ts`: Skills / Models / recovery failure query non-leakage coverage.
- `apps/web/e2e/alpha-recovery-timeline.spec.ts`: deterministic recovery/timeline fixture coverage for executable and guidance recovery UI.
- `README.md`: browser gate coverage summary.
- `docs/web-v1-acceptance.md`: automated Browser E2E checklist updates.
- `docs/alpha-release-candidate.md`: RC gate and trial script updates.
- `docs/project-roadmap.md`: Stage 45 complete state and Stage 46 next recommendation.
- `docs/superpowers/README.md`: Stage 45 plan entry.
- `docs/agent-development-learning.md`: Stage 45 implementation note as browser acceptance, not Agent runtime expansion.

## Execution Rules

- Work in an isolated worktree branch named `stage-45-browser-failure-visual-regression-expansion`.
- Follow TDD: write/extend the Playwright assertion first, run the focused command and observe failure when the helper/spec is not yet implemented, then implement the smallest change.
- Keep each task as a separate commit with a short lowercase imperative summary.
- Do not use real provider keys, real MCP servers, Postgres, real deployment, or network services.
- Do not commit `test-results/`, `playwright-report/`, screenshots, videos, traces, or local worktree metadata.

---

### Task 1: Shared Browser Contracts and Visual Surface Coverage

**Files:**
- Modify: `apps/web/e2e/helpers.ts`
- Modify: `apps/web/e2e/alpha-visual.spec.ts`

- [x] **Step 1: Add failing visual tests that reference the new helpers**

Replace `apps/web/e2e/alpha-visual.spec.ts` with:

```ts
import { expect, test } from "@playwright/test";
import {
  createProject,
  expectArtifactWorkspaceLayoutContract,
  expectDedicatedArtifactWorkspace,
  expectManagementLayoutContract,
  expectModelsManagementSurface,
  expectSkillsManagementSurface,
  expectStaticLpArtifacts,
  expectWorkbenchLayoutContract,
  submitPrompt
} from "./helpers";

test("keeps the empty workbench layout visually stable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "What can I help you build?" })).toBeVisible();
  await expectWorkbenchLayoutContract(page);

  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath("empty-workbench-layout.png")
  });
});

test("keeps the artifact workspace layout visually stable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  await submitPrompt(page, "Generate a compact browser visual regression LP");
  await expectStaticLpArtifacts(page);
  await expectDedicatedArtifactWorkspace(page);
  await expectArtifactWorkspaceLayoutContract(page);

  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath("artifact-workspace-layout.png")
  });
});

test("keeps the management surfaces visually stable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await createProject(page, "Stage 45 Visual Management");

  await expectSkillsManagementSurface(page);
  await expectManagementLayoutContract(page, "skills");
  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath("skills-management-layout.png")
  });

  await expectModelsManagementSurface(page);
  await expectManagementLayoutContract(page, "models");
  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath("models-management-layout.png")
  });
});
```

- [x] **Step 2: Run the focused visual spec and verify it fails because helpers are missing**

Run:

```bash
pnpm alpha:e2e -- apps/web/e2e/alpha-visual.spec.ts
```

Expected: FAIL with TypeScript / Playwright import errors for `expectArtifactWorkspaceLayoutContract` and `expectManagementLayoutContract`.

- [x] **Step 3: Add shared layout and non-leakage helpers**

In `apps/web/e2e/helpers.ts`, add these exports after `expectWorkbenchLayoutContract` and before `escapeRegExp`:

```ts
export async function expectArtifactWorkspaceLayoutContract(page: Page) {
  const workspace = page.getByLabel("Artifact workspace");
  const hero = workspace.locator(".artifactWorkspaceHero");
  const manifest = workspace.getByLabel("File manifest");
  const preview = workspace.getByLabel("Static LP preview");
  const exports = workspace.getByLabel("Exports");

  const workspaceBox = await getRequiredBox(workspace, "artifact workspace");
  const heroBox = await getRequiredBox(hero, "artifact workspace hero");
  const manifestBox = await getRequiredBox(manifest, "artifact manifest");
  const previewBox = await getRequiredBox(preview, "artifact preview");
  const exportBox = await getRequiredBox(exports, "artifact exports");

  for (const childBox of [heroBox, manifestBox, previewBox, exportBox]) {
    expect(childBox.x).toBeGreaterThanOrEqual(workspaceBox.x);
    expect(childBox.x + childBox.width).toBeLessThanOrEqual(workspaceBox.x + workspaceBox.width + 1);
    expect(childBox.width).toBeGreaterThan(280);
  }

  expect(heroBox.y).toBeLessThan(manifestBox.y);
  expect(manifestBox.y).toBeLessThan(previewBox.y);
  expect(previewBox.y).toBeLessThan(exportBox.y);
  await expectNoHorizontalOverflow(page);
}

export async function expectManagementLayoutContract(page: Page, surface: "skills" | "models") {
  const root = surface === "skills" ? page.locator("section.skillsView") : page.locator("section.modelsView");
  const header = root.locator(surface === "skills" ? ".skillsHeader" : ".modelsHeader");
  const summary = root.locator(".managementSummary");
  const primaryForm = surface === "skills" ? root.locator("form.skillEditor") : root.locator("form.modelEditor");
  const firstList = surface === "skills" ? root.locator(".skillsList").first() : root.locator(".modelsList").first();

  const rootBox = await getRequiredBox(root, `${surface} management surface`);
  const headerBox = await getRequiredBox(header, `${surface} management header`);
  const summaryBox = await getRequiredBox(summary, `${surface} management summary`);
  const formBox = await getRequiredBox(primaryForm, `${surface} management form`);
  const listBox = await getRequiredBox(firstList, `${surface} management list`);

  for (const childBox of [headerBox, summaryBox, formBox, listBox]) {
    expect(childBox.x).toBeGreaterThanOrEqual(rootBox.x);
    expect(childBox.x + childBox.width).toBeLessThanOrEqual(rootBox.x + rootBox.width + 1);
    expect(childBox.width).toBeGreaterThan(260);
  }

  expect(headerBox.y).toBeLessThan(summaryBox.y);
  expect(summaryBox.y).toBeLessThan(formBox.y);
  expect(summaryBox.y).toBeLessThan(listBox.y);
  await expectNoHorizontalOverflow(page);
}

export async function expectNoVisibleTextLeaks(page: Page, values: string[]) {
  for (const value of values) {
    await expect(page.getByText(value, { exact: false })).toHaveCount(0);
  }

  const formControlLeaks = await page
    .locator("input, textarea, select")
    .evaluateAll((controls, forbiddenValues) => {
      const leaks: Array<{ tagName: string; value: string }> = [];
      for (const control of controls) {
        const style = window.getComputedStyle(control);
        const box = control.getBoundingClientRect();
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          box.width === 0 ||
          box.height === 0
        ) {
          continue;
        }

        const visibleValues: string[] = [];
        if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
          visibleValues.push(control.value);
        }
        if (control instanceof HTMLSelectElement) {
          visibleValues.push(control.value);
          for (const option of Array.from(control.selectedOptions)) {
            visibleValues.push(option.value, option.textContent ?? "");
          }
        }

        for (const forbiddenValue of forbiddenValues as string[]) {
          if (visibleValues.some((visibleValue) => visibleValue.includes(forbiddenValue))) {
            leaks.push({
              tagName: control.tagName.toLowerCase(),
              value: forbiddenValue
            });
          }
        }
      }
      return leaks;
    }, values);
  expect(formControlLeaks).toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}
```

- [x] **Step 4: Replace the duplicate overflow assertion in `expectWorkbenchLayoutContract`**

In `apps/web/e2e/helpers.ts`, replace the final metrics block inside `expectWorkbenchLayoutContract`:

```ts
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
```

with:

```ts
  await expectNoHorizontalOverflow(page);
```

- [x] **Step 5: Run the focused visual spec**

Run:

```bash
pnpm alpha:e2e -- apps/web/e2e/alpha-visual.spec.ts
```

Expected: PASS with 3 Chromium tests.

- [x] **Step 6: Commit**

```bash
git add apps/web/e2e/helpers.ts apps/web/e2e/alpha-visual.spec.ts
git commit -m "expand browser visual contracts"
```

---

### Task 2: Artifact Workspace Boundary and Oversized Snippet Coverage

**Files:**
- Modify: `apps/web/e2e/alpha-lp-artifacts.spec.ts`

- [x] **Step 1: Add failing oversized snippet coverage**

Modify imports at the top of `apps/web/e2e/alpha-lp-artifacts.spec.ts` to include Node helpers and the non-leak helper:

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  expectDedicatedArtifactWorkspace,
  expectNoVisibleTextLeaks,
  expectRunTimeline,
  expectSnippetFor,
  expectStaticLpArtifacts,
  expectWorkspaceSnippetFor,
  submitPrompt,
  writeJsonFileAtomic
} from "./helpers";

const e2eStateFile = resolve("test-results", "alpha-e2e-state", "workbench-state.json");
```

In the existing `"runs an LP live task and exposes static artifacts"` test, after the final invalid `view=artifacts` assertions, add:

```ts
  makeArtifactWorkspaceFileOversized(
    prompt,
    "styles.css",
    "OVERSIZED_BROWSER_SNIPPET_SECRET"
  );
  await page.goto("/?view=artifacts&artifactPath=styles.css");
  await expect(
    page.getByText("Content is over the 8 KB preview limit.", { exact: true })
  ).toBeVisible();
  await expectNoVisibleTextLeaks(page, ["OVERSIZED_BROWSER_SNIPPET_SECRET"]);
  await expect(page.getByLabel("Artifact workspace")).toBeVisible();
```

At the bottom of the file, add:

```ts
type E2EState = {
  artifactWorkspaceFiles?: Array<Record<string, unknown>>;
  messages?: Array<Record<string, unknown>>;
  pageVersions?: Array<Record<string, unknown>>;
  taskSnapshots?: Array<Record<string, unknown>>;
  tasks?: Array<Record<string, unknown>>;
};

function makeArtifactWorkspaceFileOversized(prompt: string, path: string, secret: string) {
  const state = JSON.parse(readFileSync(e2eStateFile, "utf8")) as E2EState;
  const taskId = getLatestLpTaskIdForPrompt(state, prompt);
  const workspaceId = getArtifactWorkspaceIdForTask(state, taskId);
  const file = state.artifactWorkspaceFiles?.find(
    (record) => record.workspaceId === workspaceId && record.path === path
  );
  if (!file) {
    throw new Error(
      `Expected persisted E2E artifact file ${path} in workspace ${workspaceId} to exist.`
    );
  }

  const content = `${secret}${"x".repeat(9000)}`;
  file.content = content;
  file.sizeBytes = Buffer.byteLength(content, "utf8");
  file.sha256 = createHash("sha256").update(content).digest("hex");
  file.updatedAt = "2026-05-24T00:00:00.000Z";
  writeJsonFileAtomic(e2eStateFile, state);
}

function getLatestLpTaskIdForPrompt(state: E2EState, prompt: string): string {
  const lpTaskIds = new Set(
    (state.tasks ?? [])
      .filter((record) => record.type === "lp_generation" && typeof record.id === "string")
      .map((record) => String(record.id))
  );
  const message = (state.messages ?? [])
    .filter(
      (record) =>
        record.role === "user" &&
        record.content === prompt &&
        typeof record.taskId === "string" &&
        lpTaskIds.has(record.taskId)
    )
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
  if (!message || typeof message.taskId !== "string") {
    throw new Error(`Expected a persisted LP user message for prompt: ${prompt}`);
  }
  return message.taskId;
}

function getArtifactWorkspaceIdForTask(state: E2EState, taskId: string): string {
  const snapshot = state.taskSnapshots?.find((record) => record.taskId === taskId);
  if (!snapshot || typeof snapshot.pageVersionId !== "string") {
    throw new Error(`Expected a persisted task snapshot for task ${taskId}.`);
  }

  const pageVersion = state.pageVersions?.find(
    (record) => record.id === snapshot.pageVersionId
  );
  if (!pageVersion || typeof pageVersion.artifactWorkspaceId !== "string") {
    throw new Error(
      `Expected page version ${snapshot.pageVersionId} to reference an artifact workspace.`
    );
  }

  return pageVersion.artifactWorkspaceId;
}
```

- [x] **Step 2: Run the focused artifact spec and verify the new assertion fails before helper/import fixes are complete**

Run:

```bash
pnpm alpha:e2e -- apps/web/e2e/alpha-lp-artifacts.spec.ts
```

Expected before implementation is complete: FAIL because `expectNoVisibleTextLeaks` is not imported or `makeArtifactWorkspaceFileOversized` has not been added. Expected after Task 1 helper exists and this task is implemented: PASS.

- [x] **Step 3: Strengthen invalid artifact query non-leakage**

In the same test, after each invalid artifact path navigation, ensure these assertions exist:

```ts
  await expectNoVisibleTextLeaks(page, [
    "ARTIFACT_QUERY_SECRET",
    "../secret.css",
    "..%2Fsecret.css"
  ]);
```

Keep the existing exact `Snippet is unavailable.` assertions.

- [x] **Step 4: Run the focused artifact spec**

Run:

```bash
pnpm alpha:e2e -- apps/web/e2e/alpha-lp-artifacts.spec.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/web/e2e/alpha-lp-artifacts.spec.ts
git commit -m "cover artifact workspace failure boundaries"
```

---

### Task 3: MCP, Skills, Models, and Recovery Query Non-Leakage

**Files:**
- Modify: `apps/web/e2e/alpha-boundaries.spec.ts`
- Modify: `apps/web/e2e/alpha-failures.spec.ts`

- [x] **Step 1: Extend MCP legacy route assertions**

In `apps/web/e2e/alpha-boundaries.spec.ts`, add this import:

```ts
import { expectNoVisibleTextLeaks } from "./helpers";
```

In the `"shows Skill-only alpha boundary views"` test, replace:

```ts
  await page.goto("/?view=mcp");
```

with:

```ts
  await page.goto(
    "/?view=mcp&debug=MCP_BROWSER_SECRET&connectorJson=MCP_CONNECTOR_SECRET&toolArguments=MCP_TOOL_SECRET"
  );
```

After the existing MCP form absence assertions, add:

```ts
  await expectNoVisibleTextLeaks(page, [
    "MCP_BROWSER_SECRET",
    "MCP_CONNECTOR_SECRET",
    "MCP_TOOL_SECRET"
  ]);
```

- [x] **Step 2: Extend failure query coverage**

In `apps/web/e2e/alpha-failures.spec.ts`, update the import:

```ts
import { createProject, expectNoVisibleTextLeaks } from "./helpers";
```

Add these tests below the existing tests:

```ts
test("shows skill manifest errors without exposing raw content or debug query values", async ({ page }) => {
  await createProject(page, "E2E Skill Failure Project");

  await page.goto(
    "/?view=skills&skillError=invalid_manifest_json&debug=RAW_SKILL_BROWSER_SECRET&content=RAW_SKILL_CONTENT_SECRET"
  );

  await expect(
    page.getByRole("heading", { exact: true, name: "Project skills" })
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Enter valid manifest JSON." })
  ).toBeVisible();
  await expectNoVisibleTextLeaks(page, [
    "RAW_SKILL_BROWSER_SECRET",
    "RAW_SKILL_CONTENT_SECRET"
  ]);
});

test("shows model configuration errors without exposing provider secrets", async ({ page }) => {
  await createProject(page, "E2E Model Config Failure Project");

  await page.goto(
    "/?view=models&modelError=model_provider_base_url_invalid&debug=https://secret-provider.example.test/v1&apiKeyEnv=STAGE45_API_KEY=RAW_SECRET"
  );

  await expect(
    page.getByRole("heading", { exact: true, name: "Project models" })
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Enter a valid provider base URL." })
  ).toBeVisible();
  await expectNoVisibleTextLeaks(page, [
    "https://secret-provider.example.test/v1",
    "STAGE45_API_KEY=RAW_SECRET",
    "RAW_SECRET"
  ]);
});

test("shows recovery errors without exposing raw diagnostics", async ({ page }) => {
  await page.goto(
    "/?recoveryError=retry_failed&debug=RAW_MODEL_OUTPUT_SECRET&path=/Users/ao/Desktop/secret"
  );

  await expect(
    page.getByRole("alert").filter({ hasText: "Recovery action could not be completed." })
  ).toBeVisible();
  await expectNoVisibleTextLeaks(page, [
    "RAW_MODEL_OUTPUT_SECRET",
    "/Users/ao/Desktop/secret",
    "Desktop/secret"
  ]);
});
```

Remove the older recovery query test if it becomes a duplicate with the same name. Keep the existing provider fail-closed and worker queue tests.

- [x] **Step 3: Run focused boundary/failure specs**

Run:

```bash
pnpm alpha:e2e -- apps/web/e2e/alpha-boundaries.spec.ts apps/web/e2e/alpha-failures.spec.ts
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add apps/web/e2e/alpha-boundaries.spec.ts apps/web/e2e/alpha-failures.spec.ts
git commit -m "harden browser failure non leakage"
```

---

### Task 4: Recovery Timeline Fixture Coverage

**Files:**
- Create: `apps/web/e2e/alpha-recovery-timeline.spec.ts`
- Modify: `apps/web/e2e/helpers.ts`

- [x] **Step 1: Strengthen timeline helper expectations**

In `apps/web/e2e/helpers.ts`, update `expectRunTimeline` to include marker label visibility and layout safety:

```ts
export async function expectRunTimeline(page: Page) {
  const runTimeline = page.getByLabel("Run timeline");
  await expect(runTimeline).toBeVisible();
  await expect(runTimeline.getByText("Run timeline", { exact: true })).toBeVisible();
  await expect(runTimeline.getByText("Planner to deployment handoff", { exact: true })).toBeVisible();

  for (const role of ["Planner", "Builder", "Reviewer", "Deployer"]) {
    await expect(runTimeline.getByText(role, { exact: true })).toBeVisible();
  }

  const marker = runTimeline
    .locator(
      [
        '[data-marker="handoff_ready"]',
        '[data-marker="handoff_consumed"]',
        '[data-marker="handoff_blocked"]'
      ].join(", ")
    )
    .first();
  await expect(marker).toBeVisible();
  await expect(runTimeline.getByText(/Handoff ready|Handoff consumed|Handoff blocked/).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
}
```

- [x] **Step 2: Add recovery timeline fixture test**

Create `apps/web/e2e/alpha-recovery-timeline.spec.ts` with:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  expectNoVisibleTextLeaks,
  expectRunTimeline,
  expectStaticLpArtifacts,
  submitPrompt,
  writeJsonFileAtomic
} from "./helpers";

const e2eStateFile = resolve("test-results", "alpha-e2e-state", "workbench-state.json");

test("shows timeline recovery guidance without leaking raw diagnostics", async ({ page }) => {
  const prompt = "Generate a recovery timeline browser fixture LP";

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  await submitPrompt(page, prompt);
  await expectStaticLpArtifacts(page);
  await expectRunTimeline(page);

  const taskId = getLatestLpTaskId(prompt);
  injectFailedBuilderRun(taskId, "RECOVERY_BROWSER_SECRET", "/Users/ao/Desktop/recovery-secret");
  await page.reload();

  await expectRunTimeline(page);
  const recovery = page.getByLabel("Run recovery");
  await expect(recovery).toBeVisible();
  await expect(recovery.getByText("Builder", { exact: true })).toBeVisible();
  await expect(recovery.getByText("Run failed.", { exact: true })).toBeVisible();
  await expect(recovery.getByText("Actions", { exact: true })).toBeVisible();
  await expect(recovery.getByRole("button", { name: "Retry run" })).toBeVisible();
  await expectNoVisibleTextLeaks(page, [
    "RECOVERY_BROWSER_SECRET",
    "/Users/ao/Desktop/recovery-secret",
    "recovery-secret"
  ]);
});

function getLatestLpTaskId(prompt: string): string {
  const state = JSON.parse(readFileSync(e2eStateFile, "utf8")) as {
    tasks?: Array<Record<string, unknown>>;
  };
  const task = (state.tasks ?? [])
    .filter((record) => record.title === prompt && record.type === "lp_generation")
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
  if (!task || typeof task.id !== "string") {
    throw new Error(`Expected a persisted LP task for prompt: ${prompt}`);
  }
  return task.id;
}

function injectFailedBuilderRun(taskId: string, secret: string, localPath: string) {
  const state = JSON.parse(readFileSync(e2eStateFile, "utf8")) as {
    runs?: Array<Record<string, unknown>>;
    runEvents?: Array<Record<string, unknown>>;
  };
  const builderRun = state.runs?.find(
    (run) => run.role === "builder" && run.taskId === taskId
  );
  if (!builderRun || typeof builderRun.id !== "string") {
    throw new Error(`Expected a persisted builder run for task ${taskId} in the E2E state.`);
  }
  if (typeof builderRun.projectId !== "string" || typeof builderRun.taskId !== "string") {
    throw new Error("Expected the builder run to include projectId and taskId.");
  }

  builderRun.state = "failed";
  builderRun.completedAt = "2026-05-24T00:00:00.000Z";

  const runEvents = (state.runEvents ?? []).filter(
    (event) => event.runId !== builderRun.id || event.type !== "run.completed"
  );
  const sequence =
    runEvents
      .filter((event) => event.runId === builderRun.id)
      .map((event) => (typeof event.sequence === "number" ? event.sequence : 0))
      .sort((a, b) => b - a)[0] ?? 0;

  runEvents.push({
    id: "event_stage45_builder_failed",
    runId: builderRun.id,
    projectId: builderRun.projectId,
    taskId: builderRun.taskId,
    sequence: sequence + 1,
    type: "run.failed",
    message: "Run failed.",
    payload: {
      errorName: "stage45_browser_recovery_failure",
      rawDiagnostic: secret,
      localPath
    },
    createdAt: "2026-05-24T00:00:00.000Z"
  });
  state.runEvents = runEvents;

  writeJsonFileAtomic(e2eStateFile, state);
}
```

- [x] **Step 3: Run focused recovery timeline spec**

Run:

```bash
pnpm alpha:e2e -- apps/web/e2e/alpha-recovery-timeline.spec.ts
```

Expected: PASS.

- [x] **Step 4: Run LP artifact spec again because `expectRunTimeline` changed**

Run:

```bash
pnpm alpha:e2e -- apps/web/e2e/alpha-lp-artifacts.spec.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/web/e2e/helpers.ts apps/web/e2e/alpha-recovery-timeline.spec.ts
git commit -m "cover recovery timeline browser guidance"
```

---

### Task 5: Stage 45 Documentation Closeout

**Files:**
- Modify: `README.md`
- Modify: `docs/web-v1-acceptance.md`
- Modify: `docs/alpha-release-candidate.md`
- Modify: `docs/project-roadmap.md`
- Modify: `docs/superpowers/README.md`
- Modify: `docs/agent-development-learning.md`
- Modify: `docs/superpowers/plans/2026-05-24-browser-failure-visual-regression-expansion.md`

- [x] **Step 1: Update README browser gate summary**

In `README.md`, replace the browser E2E scope bullet with:

```md
- Browser E2E acceptance：`pnpm alpha:e2e` 提供 deterministic Chromium 浏览器验收，覆盖普通聊天、LP live task、artifact workspace preview/export/snippet、MCP hidden boundary、Skills / Models management、bounded failure injection、recovery/timeline diagnostics non-leakage 和轻量 layout visual contract。
```

Replace the paragraph after `pnpm alpha:e2e` with:

```md
`pnpm alpha:e2e` 会启动本地 Next.js dev server，使用隔离的 `LP_AGENT_WORKBENCH_STATE_FILE`，默认运行 Chromium + deterministic runtime。它不需要真实 provider key、MCP server、Postgres、远端 browser farm 或真实部署。当前 browser gate 覆盖 happy path、V1 Web surface failure injection、recovery/timeline diagnostics non-leakage 和轻量 layout visual contract；不会做跨平台 pixel-perfect 截图基线。失败时排查 artifact 位于 `test-results/alpha-e2e-artifacts/` 和 `playwright-report/`，layout contract 会额外留下诊断截图。
```

- [x] **Step 2: Update Web V1 acceptance checklist**

In `docs/web-v1-acceptance.md`, in **Browser E2E 自动验收**, replace the Stage 34-era bullet group with:

```md
- [ ] 自动验收覆盖 artifact workspace happy path、invalid path、oversized snippet 和安全 unavailable copy。
- [ ] 自动验收覆盖 MCP hidden navigation 和 legacy `/?view=mcp` safe fallback。
- [ ] 自动验收覆盖 provider fail-closed、Skills invalid manifest、worker queue bounded error、Models invalid config 和 recovery error display。
- [ ] 自动验收覆盖 timeline / recovery diagnostics non-leakage，不展示 raw model output、provider secret、worker raw detail、本机路径或 query debug values。
- [ ] 自动验收覆盖空首页、artifact workspace、Skills 和 Models surface 的轻量 layout visual contract，并在失败 artifact 中保留诊断截图。
```

In **已知后续工作**, replace the Stage 34 bullet with:

```md
- [ ] Stage 45 Browser failure / visual regression expansion 已完成；远端 browser farm、跨浏览器矩阵和 pixel-perfect 截图基线仍是后续工作。
```

- [x] **Step 3: Update RC doc Stage 45 references**

In `docs/alpha-release-candidate.md`, in **Operator Trial Script** step 9, replace:

```md
   - 确认 provider fail-closed、artifact invalid path、worker queue bounded error 由 `pnpm alpha:e2e` 覆盖。
```

with:

```md
   - 确认 provider fail-closed、Skills invalid manifest、Models invalid config、artifact invalid path / oversized snippet、worker queue bounded error、recovery/timeline diagnostics non-leakage 由 `pnpm alpha:e2e` 覆盖。
```

In **Follow-up Routing**, replace the Stage 45 bullet with:

```md
- Stage 45（已完成）：Browser failure injection、recovery/timeline diagnostics non-leakage 和轻量视觉回归扩展。
```

- [x] **Step 4: Update roadmap state**

In `docs/project-roadmap.md`, add this bullet to **当前状态快照** near the existing browser E2E bullets:

```md
- Browser failure / visual regression expansion v0：Stage 45 已把 `pnpm alpha:e2e` 扩展到 Stage 41-44 V1 Web surface，覆盖 MCP hidden fallback、artifact workspace boundary、timeline/recovery diagnostics、Skills / Models fail-closed 和轻量 visual contracts。
```

In the paragraph beginning `Stage 30 已完成`, append `Stage 45 已完成 browser failure / visual regression expansion。` before the sentence that introduces next steps, then change the next-step list to prioritize Stage 46.

In **Stage 45**, change status to:

```md
**状态：** 已实现。
```

Add an **实现摘要** section under Stage 45:

```md
**实现摘要：**

- `pnpm alpha:e2e` 现在覆盖 MCP hidden / legacy route safe fallback。
- Artifact workspace browser coverage 已包含 happy path、invalid path、oversized snippet 和安全 unavailable copy。
- Timeline / recovery coverage 已包含 handoff marker、recovery executable guidance 和 diagnostics non-leakage。
- Skills / Models browser coverage 已包含 invalid manifest、worker queue error、provider fail-closed、invalid provider config 和 secret/base URL non-leakage。
- Visual contract 扩展到 empty workbench、artifact workspace、Skills 和 Models management surface，并继续只保存 diagnostic screenshots。
```

In **Stage 46**, change status to:

```md
**状态：** 当前推荐。
```

Add a decision record at the top:

```md
- 2026-05-24 Stage 45 已完成 Browser Failure and Visual Regression Expansion v0：deterministic Playwright gate 已覆盖 MCP hidden fallback、artifact workspace boundary、timeline/recovery diagnostics、Skills / Models fail-closed、non-leakage 和轻量 V1 visual contracts；默认下一路由为 Stage 46 V1 Polished Alpha Completion Gate v0。
```

- [x] **Step 5: Update Superpowers index**

In `docs/superpowers/README.md`, after the Stage 45 spec entry, add:

```md
118. `plans/2026-05-24-browser-failure-visual-regression-expansion.md`
   - Stage 45 Browser Failure and Visual Regression Expansion v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 45 design 后阅读，用于按 TDD 扩展 Playwright helpers、artifact workspace boundaries、MCP / Skills / Models / recovery non-leakage、recovery timeline fixture、visual contracts、docs closeout 和最终验证。
```

- [x] **Step 6: Update Agent learning note**

In `docs/agent-development-learning.md`, under Stage 45, add the current plan link:

```md
当前计划：

- [2026-05-24-browser-failure-visual-regression-expansion.md](./superpowers/plans/2026-05-24-browser-failure-visual-regression-expansion.md)
```

Then add implementation status:

```md
当前实现状态：

- Stage 45 v0 已实现 deterministic browser acceptance expansion。
- 新增覆盖保持在 browser-visible contract：MCP hidden fallback、artifact workspace boundary、timeline/recovery diagnostics、Skills / Models fail-closed 和 geometry visual contracts。
- 没有改变 Agent runtime、model gateway、artifact policy、skill command execution、MCP backend 或 recovery action contract。
```

- [x] **Step 7: Mark this plan’s completed tasks**

In `docs/superpowers/plans/2026-05-24-browser-failure-visual-regression-expansion.md`, change completed task checkboxes from `- [ ]` to `- [x]` only for steps that have actually been completed by the implementation.

- [x] **Step 8: Run documentation checks**

Run:

```bash
rg -n "Stage 45|Browser failure|alpha:e2e|browser failure|visual" README.md docs/web-v1-acceptance.md docs/alpha-release-candidate.md docs/project-roadmap.md docs/superpowers/README.md docs/agent-development-learning.md
git diff --check
```

Expected: all Stage 45 references are consistent; `git diff --check` exits 0.

- [x] **Step 9: Commit**

```bash
git add README.md docs/web-v1-acceptance.md docs/alpha-release-candidate.md docs/project-roadmap.md docs/superpowers/README.md docs/agent-development-learning.md docs/superpowers/plans/2026-05-24-browser-failure-visual-regression-expansion.md
git commit -m "document browser failure visual expansion"
```

---

## Final Verification

- [x] Run focused browser specs:

```bash
pnpm alpha:e2e -- apps/web/e2e/alpha-visual.spec.ts apps/web/e2e/alpha-lp-artifacts.spec.ts apps/web/e2e/alpha-boundaries.spec.ts apps/web/e2e/alpha-failures.spec.ts apps/web/e2e/alpha-recovery-timeline.spec.ts
```

Expected: PASS.

- [x] Run the full browser gate:

```bash
pnpm alpha:e2e
```

Expected: PASS. If the sandbox blocks local port binding, rerun the same command with approved escalation for `pnpm alpha:e2e`.

- [x] Run deterministic alpha checks:

```bash
pnpm alpha:check
```

Expected: PASS.

- [x] Run typecheck:

```bash
pnpm typecheck
```

Expected: PASS.

- [x] Run whitespace check:

```bash
git diff --check
```

Expected: no output.

- [x] Inspect final worktree status:

```bash
git status --short --branch
```

Expected: clean working tree on `stage-45-browser-failure-visual-regression-expansion`.

---

## Self-Review Notes

- Spec coverage: tasks cover MCP hidden fallback, artifact boundary including oversized snippet, timeline/recovery diagnostics, Skills / Models fail-closed, lightweight visual contracts, non-leakage, and docs closeout.
- Scope control: no runtime schemas, recovery action semantics, model gateway behavior, MCP backend, provider adapters, Postgres, real deployment, or screenshot baselines are changed.
- Type consistency: helper names used by specs are defined in `apps/web/e2e/helpers.ts`; state mutation helpers operate only on `test-results/alpha-e2e-state/workbench-state.json`.
