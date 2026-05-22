# Browser E2E Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic Playwright browser acceptance gate for the Skill-only local alpha.

**Architecture:** Keep existing Web/API/runtime behavior intact and add browser-level acceptance around the already implemented paths. Playwright starts the Next.js app on a fixed local port with deterministic environment variables and an isolated JSON state file, then verifies ordinary chat streaming, LP live task progress, artifact preview/export/snippet, boundary views, and bounded recovery display. Vitest remains the fast `alpha:check` gate; browser E2E is a separate `alpha:e2e` gate.

**Tech Stack:** pnpm workspace, Next.js app router, TypeScript, Vitest, Playwright Chromium, JSON-file workbench repository.

---

## File Structure

- Create `playwright.config.ts`: root Playwright config, web server command, deterministic env, isolated state path, Chromium-only project.
- Create `apps/web/e2e/alpha-health.spec.ts`: minimal browser health check proving Playwright can load the app shell.
- Create `apps/web/e2e/alpha-chat.spec.ts`: ordinary chat streaming acceptance.
- Create `apps/web/e2e/alpha-lp-artifacts.spec.ts`: LP live task, artifact preview/export/snippet, and static output acceptance.
- Create `apps/web/e2e/alpha-boundaries.spec.ts`: Skills / Models / MCP boundary view and recovery error display acceptance.
- Create `apps/web/e2e/helpers.ts`: shared Playwright helpers for prompt submission and visible state checks.
- Modify `package.json`: add `alpha:e2e` and `alpha:e2e:install`; add `@playwright/test` through pnpm.
- Modify `pnpm-lock.yaml`: dependency lockfile update from `pnpm add`.
- Modify `.gitignore`: ignore Playwright reports and E2E artifacts.
- Modify `AGENTS.md`: document browser E2E commands and generated output ignore policy.
- Modify `apps/web/src/app/page.tsx`: add accessible labels to artifact snippet preview links.
- Modify `apps/web/src/app/page.test.ts`: Vitest coverage for the accessible artifact snippet labels.
- Modify `README.md`: document browser E2E install/run and failure modes.
- Modify `docs/web-v1-acceptance.md`: mark browser-automated acceptance scope.
- Modify `docs/project-roadmap.md`: update Stage 31 status and closeout facts.
- Modify `docs/superpowers/README.md`: add Stage 31 plan entry and update design entry status.
- Modify `docs/agent-development-learning.md`: update Stage 31 from design-only to implementation plan/current behavior.

---

### Task 1: Add Playwright Toolchain And Browser Health Gate

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.gitignore`
- Modify: `AGENTS.md`
- Create: `playwright.config.ts`
- Create: `apps/web/e2e/alpha-health.spec.ts`

- [ ] **Step 1: Verify the E2E command is missing**

Run:

```bash
pnpm alpha:e2e
```

Expected: FAIL with `Missing script: alpha:e2e` or equivalent pnpm missing script output.

- [ ] **Step 2: Add Playwright dependency**

Run:

```bash
pnpm add -D @playwright/test -w
```

Expected: `package.json` has a root `devDependencies["@playwright/test"]` entry and `pnpm-lock.yaml` changes.

- [ ] **Step 3: Add root scripts**

In `package.json`, update the `scripts` object near `alpha:check`:

```json
{
  "scripts": {
    "alpha:e2e": "playwright test --config playwright.config.ts",
    "alpha:e2e:install": "playwright install chromium"
  }
}
```

Keep existing scripts unchanged.

- [ ] **Step 4: Ignore Playwright output**

In `.gitignore`, add:

```gitignore
test-results/
playwright-report/
```

- [ ] **Step 5: Document the new command in AGENTS.md**

In `AGENTS.md` under `## 构建、测试和开发命令`, add:

```markdown
- `pnpm alpha:e2e:install` - 安装本地 Chromium browser，用于 Stage 31 browser E2E。
- `pnpm alpha:e2e` - 运行 deterministic Playwright browser acceptance；默认使用隔离 JSON state，不依赖真实 provider、MCP、Postgres 或真实部署。
```

In the project structure or generated output paragraph, update the ignored-output sentence so it includes `test-results/` and `playwright-report/`.

- [ ] **Step 6: Create Playwright config**

Create `playwright.config.ts`:

```ts
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:31031";
const stateDir = join("test-results", "alpha-e2e-state");
const stateFile = join(stateDir, "workbench-state.json");

mkdirSync(stateDir, { recursive: true });
rmSync(stateFile, { force: true });

export default defineConfig({
  testDir: "apps/web/e2e",
  outputDir: join("test-results", "alpha-e2e-artifacts"),
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 15_000
  },
  use: {
    baseURL,
    locale: "en-US",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9"
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure"
  },
  reporter: [["list"], ["html", { open: "never" }]],
  webServer: {
    command: "pnpm --filter @lp-agent/web dev --hostname 127.0.0.1 --port 31031",
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      REAL_MODEL_RUNTIME: "0",
      REAL_MODEL_PROVIDER_TEST: "0",
      WORKBENCH_REPOSITORY_BACKEND: "json",
      LP_AGENT_WORKBENCH_STATE_FILE: stateFile,
      NEXT_TELEMETRY_DISABLED: "1"
    }
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ]
});
```

- [ ] **Step 7: Add the first browser health spec**

Create `apps/web/e2e/alpha-health.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("loads the Skill-only alpha workbench shell", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "What can I help you build?" })
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Workbench" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Skills" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Models" })).toBeVisible();
  await expect(page.getByRole("link", { name: "MCP" })).toBeVisible();
});
```

- [ ] **Step 8: Install Chromium for local E2E**

Run:

```bash
pnpm alpha:e2e:install
```

Expected: Chromium browser files are installed for Playwright. If the sandbox blocks network access, rerun with approval.

- [ ] **Step 9: Run the browser health gate**

Run:

```bash
pnpm alpha:e2e
```

Expected: PASS with one Chromium test passing.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml .gitignore AGENTS.md playwright.config.ts apps/web/e2e/alpha-health.spec.ts
git commit -m "add browser e2e health gate"
```

---

### Task 2: Add Accessible Artifact Snippet Labels

**Files:**
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Write the failing page test**

In `apps/web/src/app/page.test.ts`, add this test near the existing artifact diff snippet tests:

```ts
it("labels artifact snippet preview links by file path", async () => {
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
  const links = collectElements(page, "a").filter(
    (link) => collectText(link.props?.children).join("") === "Preview snippet"
  );

  expect(links.map((link) => link.props?.["aria-label"])).toEqual([
    "Preview snippet: index.html",
    "Preview snippet: styles.css",
    "Preview snippet: script.js"
  ]);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts -t "labels artifact snippet preview links by file path"
```

Expected: FAIL because snippet preview links do not yet have `aria-label`.

- [ ] **Step 3: Add accessible labels**

In `apps/web/src/app/page.tsx`, update the snippet preview link in `ArtifactDiffBlock`:

```tsx
{file.canPreview ? (
  <a
    aria-label={`${copy.previewSnippetLabel}: ${file.path}`}
    href={createArtifactPreviewHref(previewSearchParams, file.path)}
  >
    {copy.previewSnippetLabel}
  </a>
) : null}
```

- [ ] **Step 4: Run the page test**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts -t "labels artifact snippet preview links by file path"
```

Expected: PASS.

- [ ] **Step 5: Run the full page test**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/page.tsx apps/web/src/app/page.test.ts
git commit -m "label artifact snippet links for browser e2e"
```

---

### Task 3: Add Ordinary Chat Browser Acceptance

**Files:**
- Create: `apps/web/e2e/helpers.ts`
- Create: `apps/web/e2e/alpha-chat.spec.ts`

- [ ] **Step 1: Create shared E2E helpers**

Create `apps/web/e2e/helpers.ts`:

```ts
import { expect, type Page } from "@playwright/test";

export async function submitPrompt(page: Page, prompt: string) {
  await page.getByLabel("LP request").fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

export async function expectOrdinaryChatThread(page: Page, prompt: string) {
  await expect(page.getByText(prompt)).toBeVisible();
  await expect(
    page.getByText("I created a task thread and can continue from here.")
  ).toBeVisible();
  await expect(page.getByLabel("Agent process")).toBeVisible();
  await expect(page.getByText("Created a general task thread.")).toBeVisible();
}

export async function expectNoStaticArtifactPreview(page: Page) {
  await expect(page.getByLabel("Static LP preview")).toHaveCount(0);
  await expect(page.getByLabel("Generated files")).toHaveCount(0);
}
```

- [ ] **Step 2: Write the failing ordinary chat E2E**

Create `apps/web/e2e/alpha-chat.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import {
  expectNoStaticArtifactPreview,
  expectOrdinaryChatThread,
  submitPrompt
} from "./helpers";

test("streams ordinary chat and preserves the completed thread", async ({ page }) => {
  const prompt = "Help me organize a homepage launch checklist";

  await page.goto("/");
  const streamResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/chat/stream") &&
      response.request().method() === "POST"
  );
  await submitPrompt(page, prompt);
  const streamResponse = await streamResponsePromise;

  expect(streamResponse.headers()["content-type"]).toContain("application/x-ndjson");
  await expectOrdinaryChatThread(page, prompt);
  await expectNoStaticArtifactPreview(page);

  await page.reload();
  await expectOrdinaryChatThread(page, prompt);
  await expectNoStaticArtifactPreview(page);
});
```

- [ ] **Step 3: Run the ordinary chat E2E**

Run:

```bash
pnpm alpha:e2e -- --grep "streams ordinary chat"
```

Expected: PASS.

- [ ] **Step 4: Run the full browser gate**

Run:

```bash
pnpm alpha:e2e
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/helpers.ts apps/web/e2e/alpha-chat.spec.ts
git commit -m "add ordinary chat browser acceptance"
```

---

### Task 4: Add LP Live Task And Artifact Browser Acceptance

**Files:**
- Modify: `apps/web/e2e/helpers.ts`
- Create: `apps/web/e2e/alpha-lp-artifacts.spec.ts`

- [ ] **Step 1: Extend E2E helpers**

Append to `apps/web/e2e/helpers.ts`:

```ts
export async function expectStaticLpArtifacts(page: Page) {
  await expect(page.getByLabel("Live task progress")).toBeVisible();
  await expect(page.getByText("Artifact workspace ready")).toBeVisible();
  await expect(page.getByLabel("Generated files")).toBeVisible();
  await expect(page.getByRole("link", { name: /index\.html/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /styles\.css/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /script\.js/ })).toBeVisible();
  await expect(page.getByLabel("Static LP preview")).toBeVisible();
  await expect(page.getByLabel("Artifact changes")).toBeVisible();
}

export async function expectSnippetFor(page: Page, filePath: string) {
  await page
    .getByRole("link", { name: `Preview snippet: ${filePath}` })
    .click();
  await expect(page).toHaveURL(new RegExp(`artifactPath=${filePath.replace(".", "\\.")}`));
  await expect(page.getByText("Snippet preview")).toBeVisible();
  await expect(page.getByText(filePath)).toBeVisible();
}
```

- [ ] **Step 2: Write the failing LP artifact E2E**

Create `apps/web/e2e/alpha-lp-artifacts.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import {
  expectSnippetFor,
  expectStaticLpArtifacts,
  submitPrompt
} from "./helpers";

test("runs an LP live task and exposes static artifacts", async ({ page }) => {
  const prompt = "Generate a spring ecommerce static HTML landing page";

  await page.goto("/");
  const liveSubmitResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/tasks/submit") &&
      response.request().method() === "POST"
  );
  await submitPrompt(page, prompt);
  const liveSubmitResponse = await liveSubmitResponsePromise;

  expect(liveSubmitResponse.ok()).toBe(true);
  await expect(page.getByText(prompt)).toBeVisible();
  await expect(page.getByLabel("Agent process")).toBeVisible();
  await expect(page.getByText("Planner")).toBeVisible();
  await expect(page.getByText("Builder")).toBeVisible();
  await expect(page.getByText("Reviewer")).toBeVisible();
  await expect(page.getByText("Deployer")).toBeVisible();
  await expectStaticLpArtifacts(page);

  await expectSnippetFor(page, "index.html");
  await expectSnippetFor(page, "styles.css");
  await expectSnippetFor(page, "script.js");

  await page.goto("/?artifactPath=unknown.txt");
  await expect(page.getByText("Snippet is unavailable.")).toBeVisible();
  await expectStaticLpArtifacts(page);
});
```

- [ ] **Step 3: Run the LP artifact E2E**

Run:

```bash
pnpm alpha:e2e -- --grep "runs an LP live task"
```

Expected: PASS.

- [ ] **Step 4: Run the full browser gate**

Run:

```bash
pnpm alpha:e2e
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/helpers.ts apps/web/e2e/alpha-lp-artifacts.spec.ts
git commit -m "add lp artifact browser acceptance"
```

---

### Task 5: Add Boundary Views And Recovery Display Browser Acceptance

**Files:**
- Create: `apps/web/e2e/alpha-boundaries.spec.ts`

- [ ] **Step 1: Write the boundary E2E**

Create `apps/web/e2e/alpha-boundaries.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("shows Skill-only alpha boundary views", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Project name").fill("E2E Alpha Project");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByText("E2E Alpha Project")).toBeVisible();

  await page.getByRole("link", { name: "Skills" }).click();
  await expect(page.getByRole("heading", { name: "Project skills" })).toBeVisible();
  await expect(
    page.getByText(
      "Skill-only alpha: published and bound skills are the primary extension path for chat and LP tasks."
    )
  ).toBeVisible();
  await expect(
    page.getByText(
      "Commands use approval, the local worker queue, and safe observations; they do not run arbitrary shell commands or real deployment."
    )
  ).toBeVisible();

  await page.getByRole("link", { name: "Models" }).click();
  await expect(page.getByRole("heading", { name: "Project models" })).toBeVisible();
  await expect(
    page.getByText(
      "Real providers are opt-in. Default alpha checks use deterministic routes and do not require API keys."
    )
  ).toBeVisible();
  await expect(
    page.getByText(
      "If a provider or route is missing, the runtime fails closed instead of silently treating a real call as successful."
    )
  ).toBeVisible();

  await page.getByRole("link", { name: "MCP" }).click();
  await expect(page.getByRole("heading", { name: "Project MCP" })).toBeVisible();
  await expect(
    page.getByText(
      "MCP is deferred for this alpha. Chat and LP generation work without configuring connectors."
    )
  ).toBeVisible();
});

test("shows bounded recovery error display", async ({ page }) => {
  await page.goto("/?recoveryError=retry_failed");

  await expect(
    page.getByRole("alert").filter({ hasText: "Recovery action could not be completed." })
  ).toBeVisible();
  await expect(page.getByText("RAW_MODEL_SECRET")).toHaveCount(0);
  await expect(page.getByText("OPENAI_API_KEY")).toHaveCount(0);
});
```

- [ ] **Step 2: Run the boundary E2E**

Run:

```bash
pnpm alpha:e2e -- --grep "boundary|recovery"
```

Expected: PASS.

- [ ] **Step 3: Run the full browser gate**

Run:

```bash
pnpm alpha:e2e
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/alpha-boundaries.spec.ts
git commit -m "add alpha boundary browser acceptance"
```

---

### Task 6: Document Browser E2E And Close Stage 31

**Files:**
- Modify: `README.md`
- Modify: `docs/web-v1-acceptance.md`
- Modify: `docs/project-roadmap.md`
- Modify: `docs/superpowers/README.md`
- Modify: `docs/agent-development-learning.md`

- [ ] **Step 1: Update README verification docs**

In `README.md` under `## 验证`, add after `pnpm alpha:check`:

````markdown
安装本地 Chromium browser：

```bash
pnpm alpha:e2e:install
```

运行浏览器级 alpha 验收：

```bash
pnpm alpha:e2e
```

`pnpm alpha:e2e` 会启动 Next.js dev server，使用 isolated `LP_AGENT_WORKBENCH_STATE_FILE`，默认只跑 Chromium 和 deterministic runtime。它不需要真实 provider key、MCP server、Postgres、远端浏览器 farm 或真实部署。失败时查看 `test-results/alpha-e2e-artifacts/` 和 `playwright-report/`。
````

- [ ] **Step 2: Update manual acceptance checklist**

In `docs/web-v1-acceptance.md`, add a Browser E2E subsection near the preparation section:

```markdown
## Browser E2E 自动验收

- [ ] `pnpm alpha:e2e:install` 已安装 Chromium。
- [ ] `pnpm alpha:e2e` 通过。
- [ ] Browser E2E 已覆盖普通聊天 streaming、LP live task、artifact preview/export/snippet、Skills / Models / MCP alpha boundary，以及 bounded recovery error display。
- [ ] 真实 provider smoke 仍是可选手动验收，不属于默认 `pnpm alpha:e2e`。
```

In the known follow-up section, replace `Browser automation acceptance tests 进入 Stage 31。` with:

```markdown
- [ ] Browser automation acceptance tests 已进入 Stage 31；后续可扩展到更多 failure injection 和视觉回归。
```

- [ ] **Step 3: Update roadmap**

In `docs/project-roadmap.md`, update Stage 31:

```markdown
**状态：** 已实现。

Stage 31 v0 已新增 deterministic Playwright browser acceptance gate。`pnpm alpha:e2e` 默认启动本地 Next.js dev server、使用隔离 JSON state、只跑 Chromium，并覆盖普通聊天 streaming、LP live task、artifact preview/export/snippet、Skills / Models / MCP alpha boundary 和 bounded recovery error display。

已实现范围：

- 新增 Playwright config、Chromium-only browser specs 和 `pnpm alpha:e2e` / `pnpm alpha:e2e:install`。
- E2E state 使用 isolated `LP_AGENT_WORKBENCH_STATE_FILE`，不污染默认 `.lp-agent/workbench-state.json`。
- 普通聊天、LP live task、artifact preview/export/snippet 和边界 views 有浏览器级验收。
- Browser E2E artifacts 写入 ignored `test-results/` 和 `playwright-report/`。

未实现范围：

- 不做远端 browser farm、跨浏览器矩阵或视觉回归平台。
- 不做真实 provider streaming/usage、MCP 新功能、真实 shell runner、auth/RBAC、生产 observability 或真实部署编排。
- 不把 `pnpm alpha:e2e` 合入 `pnpm alpha:check`。
```

Keep Stage 32 as the recommended next stage and Stage 33 after Stage 32.

- [ ] **Step 4: Update Superpowers index**

In `docs/superpowers/README.md`, change the Stage 31 design entry to implemented after the code lands, and add:

```markdown
91. `plans/2026-05-22-browser-e2e-acceptance.md`
   - Stage 31 Browser E2E Acceptance v0 implementation plan（已实现后标记为完成）。
   - 在 Stage 31 design 后阅读，用于实现或审计 Playwright browser gate、isolated JSON state、ordinary chat streaming E2E、LP live task artifact E2E、Skills / Models / MCP boundary E2E、README/manual checklist/roadmap/docs closeout 和最终验证。
```

- [ ] **Step 5: Update Agent learning**

In `docs/agent-development-learning.md`, update the Stage 31 bullet to say implementation is complete and include:

```markdown
默认 browser E2E 仍是 deterministic acceptance，不触发真实 provider、MCP server、Postgres、远端 browser farm 或真实部署；它的价值是把 Agent workflow 的 browser-visible contract 固定下来，而不是扩大 Agent runtime。
```

- [ ] **Step 6: Run docs consistency checks**

Run:

```bash
rg -n "Stage 31|alpha:e2e|Browser E2E|browser acceptance" README.md docs/web-v1-acceptance.md docs/project-roadmap.md docs/superpowers/README.md docs/agent-development-learning.md AGENTS.md
git diff --check
```

Expected: all files mention Stage 31 / browser E2E consistently and `git diff --check` exits 0.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/web-v1-acceptance.md docs/project-roadmap.md docs/superpowers/README.md docs/agent-development-learning.md AGENTS.md .gitignore
git commit -m "document browser e2e acceptance"
```

---

### Task 7: Final Verification And Stage Closeout

**Files:**
- No code files unless verification exposes a real issue.

- [ ] **Step 1: Verify worktree status**

Run:

```bash
git status --short --branch
```

Expected: clean working tree on `stage-31-browser-e2e-acceptance`.

- [ ] **Step 2: Run browser E2E**

Run:

```bash
pnpm alpha:e2e
```

Expected: PASS.

- [ ] **Step 3: Run deterministic alpha gate**

Run:

```bash
pnpm alpha:check
```

Expected: PASS.

- [ ] **Step 4: Run smoke**

Run:

```bash
pnpm smoke
```

Expected: PASS.

- [ ] **Step 5: Run all tests**

Run:

```bash
pnpm test
```

Expected: PASS with integration tests skipped only when their opt-in env vars are absent.

- [ ] **Step 6: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Run build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 8: Run diff check**

Run:

```bash
git diff --check
```

Expected: PASS.

- [ ] **Step 9: Confirm closeout rules**

Check:

```bash
rg -n "Stage 31|Stage 32|Stage 33|推荐下一阶段|已实现|待执行" docs/project-roadmap.md
rg -n "2026-05-22-browser-e2e-acceptance" docs/superpowers/README.md
rg -n "Browser E2E Acceptance|alpha:e2e" docs/agent-development-learning.md README.md docs/web-v1-acceptance.md
git log --oneline main..HEAD
```

Expected:

- Stage 31 status and facts reflect the implemented browser gate.
- Stage 32 remains recommended next.
- Stage 33 remains in the near-term queue.
- Superpowers README includes both Stage 31 design and plan.
- Agent learning records browser E2E as acceptance, not runtime expansion.
- Branch contains focused Stage 31 commits.

---

## Plan Self-Review

- Spec coverage: Tasks 1-5 cover Playwright command, Chromium-only default, deterministic env, isolated state, ordinary chat streaming, LP live task, artifact preview/export/snippet, boundary views, and bounded recovery display. Task 6 covers README, manual checklist, roadmap, Superpowers index, AGENTS.md, and Agent learning. Task 7 covers final verification.
- Red-flag scan: the plan contains no unfinished markers, no vague file names, and no empty implementation steps.
- Type consistency: helper names in later specs match `helpers.ts`; package scripts match the commands used by verification; roadmap and docs use the same `alpha:e2e` naming.
