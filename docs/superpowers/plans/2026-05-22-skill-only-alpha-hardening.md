# Skill-Only Alpha Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current Web/API first usable loop into a documented, testable Skill-only local alpha with deterministic default checks, clear real-provider opt-in, and MCP explicitly deferred.

**Architecture:** Keep the runtime and transport boundaries from Stages 26-29 unchanged. Add localized alpha boundary copy to the existing Skills, Models, and MCP views; add a deterministic `pnpm alpha:check` readiness gate; update README/manual acceptance/docs so the alpha handoff can be run without real provider keys, MCP servers, Postgres, Browser E2E, or real deployment.

**Tech Stack:** pnpm workspace, TypeScript, Next.js app router, Vitest, existing Web workbench store/page tests, Markdown docs.

---

## File Map

- Modify `apps/web/src/lib/i18n.ts`: add localized alpha boundary strings to `skillsView`, `modelsView`, and `mcpView`.
- Modify `apps/web/src/lib/i18n.test.ts`: assert English and Chinese copies for Skill-only alpha, real provider opt-in/fail-closed, and MCP deferred guidance.
- Modify `apps/web/src/app/page.tsx`: render the new boundary copy on Skills, Models, and MCP views.
- Modify `apps/web/src/app/page.test.ts`: assert the alpha boundary copy appears in the right views without requiring a projectless workbench composer.
- Modify `apps/web/src/app/globals.css`: add one compact reusable note style for alpha boundary text.
- Modify `package.json`: add `alpha:check` script.
- Modify `README.md`: make Skill-only local alpha the first onboarding path.
- Modify `docs/web-v1-acceptance.md`: upgrade the checklist from Web V1 to Skill-only alpha acceptance.
- Modify `docs/superpowers/README.md`: add this implementation plan to the reading order.
- Modify `docs/project-roadmap.md`: link the plan and later mark Stage 30 complete during closeout.
- Modify `docs/agent-development-learning.md`: keep Agent learning current for Skill-only alpha boundaries.

## Task 1: Localized Alpha Boundary Copy

**Files:**
- Modify: `apps/web/src/lib/i18n.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`

- [ ] **Step 1: Write failing i18n tests**

Add this test after `it("exposes localized worker queue copy for both locales", ...)` in `apps/web/src/lib/i18n.test.ts`:

```typescript
  it("exposes localized skill-only alpha boundary copy", () => {
    const zh = getWorkbenchCopy("zh-CN");
    const en = getWorkbenchCopy("en");

    expect(en.skillsView.alphaNotice).toBe(
      "Skill-only alpha: published and bound skills are the primary extension path for chat and LP tasks."
    );
    expect(en.skillsView.commandQueueNotice).toBe(
      "Commands use approval, the local worker queue, and safe observations; they do not run arbitrary shell commands or real deployment."
    );
    expect(en.modelsView.optInNotice).toBe(
      "Real providers are opt-in. Default alpha checks use deterministic routes and do not require API keys."
    );
    expect(en.modelsView.failClosedNotice).toBe(
      "If a provider or route is missing, the runtime fails closed instead of silently treating a real call as successful."
    );
    expect(en.mcpView.deferredNotice).toBe(
      "MCP is deferred for this alpha. Chat and LP generation work without configuring connectors."
    );

    expect(zh.skillsView.alphaNotice).toBe(
      "Skill-only alpha：已发布并绑定的 Skill 是聊天和 LP 任务的主要扩展路径。"
    );
    expect(zh.skillsView.commandQueueNotice).toBe(
      "命令会经过批准、本地 Worker 队列和安全 observation；不会运行任意 shell 命令或真实部署。"
    );
    expect(zh.modelsView.optInNotice).toBe(
      "真实 provider 需要显式 opt-in；默认 alpha 检查使用 deterministic 路由，不需要 API key。"
    );
    expect(zh.modelsView.failClosedNotice).toBe(
      "provider 或路由缺失时，runtime 会 fail closed，不会把真实调用静默当作成功。"
    );
    expect(zh.mcpView.deferredNotice).toBe(
      "MCP 在本 alpha 中后置；不配置连接器也可以完成聊天和 LP 生成。"
    );
  });
```

- [ ] **Step 2: Run the focused i18n test and confirm failure**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts
```

Expected: FAIL because `alphaNotice`, `commandQueueNotice`, `optInNotice`, `failClosedNotice`, and `deferredNotice` do not exist on the copy contract yet.

- [ ] **Step 3: Extend the copy interfaces**

In `apps/web/src/lib/i18n.ts`, add these fields to `skillsView`:

```typescript
    alphaNotice: string;
    commandQueueNotice: string;
```

Add this field to `mcpView`:

```typescript
    deferredNotice: string;
```

Add these fields to `modelsView`:

```typescript
    optInNotice: string;
    failClosedNotice: string;
```

- [ ] **Step 4: Add English copy**

In the English `skillsView` object, add:

```typescript
      alphaNotice: "Skill-only alpha: published and bound skills are the primary extension path for chat and LP tasks.",
      commandQueueNotice: "Commands use approval, the local worker queue, and safe observations; they do not run arbitrary shell commands or real deployment.",
```

In the English `mcpView` object, add:

```typescript
      deferredNotice: "MCP is deferred for this alpha. Chat and LP generation work without configuring connectors.",
```

In the English `modelsView` object, add:

```typescript
      optInNotice: "Real providers are opt-in. Default alpha checks use deterministic routes and do not require API keys.",
      failClosedNotice: "If a provider or route is missing, the runtime fails closed instead of silently treating a real call as successful.",
```

- [ ] **Step 5: Add Chinese copy**

In the Chinese `skillsView` object, add:

```typescript
      alphaNotice: "Skill-only alpha：已发布并绑定的 Skill 是聊天和 LP 任务的主要扩展路径。",
      commandQueueNotice: "命令会经过批准、本地 Worker 队列和安全 observation；不会运行任意 shell 命令或真实部署。",
```

In the Chinese `mcpView` object, add:

```typescript
      deferredNotice: "MCP 在本 alpha 中后置；不配置连接器也可以完成聊天和 LP 生成。",
```

In the Chinese `modelsView` object, add:

```typescript
      optInNotice: "真实 provider 需要显式 opt-in；默认 alpha 检查使用 deterministic 路由，不需要 API key。",
      failClosedNotice: "provider 或路由缺失时，runtime 会 fail closed，不会把真实调用静默当作成功。",
```

- [ ] **Step 6: Run the focused i18n test and confirm pass**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/i18n.ts apps/web/src/lib/i18n.test.ts
git commit -m "add skill-only alpha boundary copy"
```

## Task 2: Render Alpha Boundary Notes

**Files:**
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Write failing page rendering tests**

Add these tests near the existing Skills/Models/MCP view tests in `apps/web/src/app/page.test.ts`:

```typescript
  it("renders Skill-only alpha guidance in the skills view", async () => {
    setActiveEmptyProjectState();

    const html = await renderHomePage({
      searchParams: Promise.resolve({ view: "skills" }),
      acceptLanguage: "en"
    });

    expect(html).toContain(
      "Skill-only alpha: published and bound skills are the primary extension path for chat and LP tasks."
    );
    expect(html).toContain(
      "Commands use approval, the local worker queue, and safe observations; they do not run arbitrary shell commands or real deployment."
    );
  });

  it("renders real provider opt-in and fail-closed guidance in the models view", async () => {
    setActiveEmptyProjectState();

    const html = await renderHomePage({
      searchParams: Promise.resolve({ view: "models" }),
      acceptLanguage: "en"
    });

    expect(html).toContain(
      "Real providers are opt-in. Default alpha checks use deterministic routes and do not require API keys."
    );
    expect(html).toContain(
      "If a provider or route is missing, the runtime fails closed instead of silently treating a real call as successful."
    );
  });

  it("renders MCP deferred guidance in the MCP view", async () => {
    setActiveEmptyProjectState();

    const html = await renderHomePage({
      searchParams: Promise.resolve({ view: "mcp" }),
      acceptLanguage: "en"
    });

    expect(html).toContain(
      "MCP is deferred for this alpha. Chat and LP generation work without configuring connectors."
    );
  });
```

- [ ] **Step 2: Run the focused page tests and confirm failure**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts
```

Expected: FAIL because the page does not render the new alpha guidance yet.

- [ ] **Step 3: Render the Skills alpha note**

In `apps/web/src/app/page.tsx`, immediately after the `skillsProjectContext` block, add:

```tsx
                <p className="alphaBoundaryNote">{copy.skillsView.alphaNotice}</p>
```

Inside the Skill Commands section header, immediately after `<p>{copy.skillsView.commandsSubtitle}</p>`, add:

```tsx
                          <p className="alphaBoundaryNote">
                            {copy.skillsView.commandQueueNotice}
                          </p>
```

- [ ] **Step 4: Render the MCP deferred note**

In the MCP view header, immediately after `<p>{copy.mcpView.subtitle}</p>`, add:

```tsx
                    <p className="alphaBoundaryNote">{copy.mcpView.deferredNotice}</p>
```

- [ ] **Step 5: Render the Models opt-in notes**

In the Models view header, immediately after `<p>{copy.modelsView.subtitle}</p>`, add:

```tsx
                    <p className="alphaBoundaryNote">{copy.modelsView.optInNotice}</p>
                    <p className="alphaBoundaryNote">{copy.modelsView.failClosedNotice}</p>
```

- [ ] **Step 6: Add compact note styling**

In `apps/web/src/app/globals.css`, after the `.mcpHeader p, .skillsHeader p, .modelsHeader p` block, add:

```css
.alphaBoundaryNote {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 0.84rem;
  line-height: 1.48;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 7: Run the focused page tests and confirm pass**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/page.tsx apps/web/src/app/page.test.ts apps/web/src/app/globals.css
git commit -m "show skill-only alpha boundary notes"
```

## Task 3: Add Deterministic Alpha Check Command

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Confirm the missing command**

Run:

```bash
pnpm alpha:check
```

Expected: FAIL with a missing script error because `alpha:check` is not defined yet.

- [ ] **Step 2: Add the root script**

In `package.json`, add `alpha:check` next to the existing `smoke` script:

```json
"alpha:check": "vitest run apps/web/src/lib/web-v1-smoke.test.ts apps/web/src/lib/i18n.test.ts apps/web/src/app/page.test.ts apps/web/src/app/streaming-workbench.test.ts apps/web/src/app/live-task-panel.test.ts apps/web/src/app/api/chat/stream/route.test.ts apps/web/src/app/api/tasks/submit/route.test.ts \"apps/web/src/app/api/tasks/[taskId]/state/route.test.ts\"",
```

Keep `smoke` unchanged.

- [ ] **Step 3: Run the new alpha check and confirm pass**

Run:

```bash
pnpm alpha:check
```

Expected: PASS. The command must not require browser automation, real provider keys, MCP servers, Postgres, network access, or real deployment.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "add deterministic alpha check command"
```

## Task 4: Update README for Skill-Only Local Alpha

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Confirm README does not yet expose the alpha path**

Run:

```bash
rg -n "Skill-only local alpha|pnpm alpha:check|MCP is deferred|MCP 后置" README.md
```

Expected: FAIL with no matches.

- [ ] **Step 2: Update the introduction**

Replace the first paragraph after `# LP Engineering Team Agent` with:

```markdown
LP Engineering Team Agent 是一个轻量级 Web 工作台，用于通过智能体式对话创建和管理落地页任务。当前第一版交付目标是 **Skill-only local alpha**：用户可以从大对话入口开始普通问答，发起 LP 复杂任务，看到流式聊天和 live task progress，生成框架无关静态 LP 产物，并通过项目 Skills 扩展上下文和安全命令流程。
```

- [ ] **Step 3: Replace current scope and non-goals sections**

Replace `## 当前范围` through the end of `## 第一版 Web MVP 暂不包含` with:

```markdown
## Skill-only local alpha 当前范围

- 类 Manus 的 Web 工作台：侧边栏、任务列表、对话优先入口和任务详情布局。
- 普通聊天：默认 deterministic，本地 Web/API 可流式回答；`REAL_MODEL_RUNTIME=1` 时可显式 opt in 真实 provider。
- LP 复杂任务：task-first `Planner -> Builder -> Reviewer -> Deployer` 固定链路，页面通过 live task panel 展示进度和恢复状态。
- `index.html`、`styles.css`、`script.js` 三文件静态产物工作区，支持 artifact preview、export 和 bounded source snippet 读取。
- 项目 Skills：创建 draft、validate、publish、bind、enable/disable，并把已发布绑定的 Skill 作为聊天和 LP 任务的主要扩展路径。
- Skill command queue：已发布 deployment skill command 经过 approval、本地 worker queue、`Run local worker once` 和 safe observation，不开放任意 shell 命令。
- 模型网关配置入口：支持 deterministic、Anthropic Messages compatible 和 OpenAI Chat Completions compatible provider；真实 provider 只通过显式 opt-in 进入。

## Alpha 暂不包含

- MCP 不属于第一版必需路径；MCP 页面可以保留为架构边界，但普通聊天和 LP 生成不需要配置 MCP connector。
- Browser E2E acceptance；该项进入 Stage 31。
- provider token streaming、usage/cost reporting 或自动 fallback provider execution。
- 生产 auth/RBAC、邀请流程、团队审批队列或 hosted deployment。
- production Postgres migrations、object storage migration 或默认 backend 切换。
- 真实 shell runner、真实部署编排、真实 MCP SDK 或 write tools。

这些能力会在后续阶段单独实现，当前 alpha 优先保持本地、单用户、Skill-only、可测试。
```

- [ ] **Step 4: Update validation commands**

In `## 验证`, add this block before `pnpm smoke`:

````markdown
运行 Skill-only alpha 快速检查：

```bash
pnpm alpha:check
```

`pnpm alpha:check` 是 deterministic readiness gate，不需要浏览器、网络、真实 provider key、MCP server、Postgres 或真实部署。
````

- [ ] **Step 5: Update real provider guidance**

After the provider env example, add:

```markdown
真实 provider 本地 smoke 的最小路径：

1. 在 `.env.local` 设置 `REAL_MODEL_RUNTIME=1`。
2. 在 Web 的 Models view 创建 provider，选择 `anthropic-messages` 或 `openai-completions`。
3. 使用 `apiKeyEnv` 引用本地环境变量名，不在 UI 或文档中填写真实 key。
4. 为 `assistant`、`planner` 和 `builder` 保存 route。
5. 手动提交一个普通聊天 prompt 和一个 LP prompt；失败时应看到 bounded error 或 safe runtime summary，而不是原始 provider response。

默认 `pnpm alpha:check`、`pnpm smoke` 和 `pnpm test` 不会触发真实 provider 调用。
```

- [ ] **Step 6: Update manual acceptance wording and docs map**

Change “Web V1” wording in the manual acceptance section to “Skill-only alpha”, and update the docs map item to:

```markdown
- `docs/web-v1-acceptance.md` - Skill-only alpha 手动验收清单。
```

- [ ] **Step 7: Verify README text**

Run:

```bash
rg -n "Skill-only local alpha|pnpm alpha:check|MCP 不属于第一版必需路径|真实 provider 本地 smoke" README.md
```

Expected: PASS with matches for every pattern.

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit -m "document skill-only alpha onboarding"
```

## Task 5: Upgrade Manual Alpha Acceptance Checklist

**Files:**
- Modify: `docs/web-v1-acceptance.md`

- [ ] **Step 1: Confirm the checklist is still Web V1 oriented**

Run:

```bash
rg -n "Skill-only alpha|普通聊天 streaming|LP live task|MCP 后置|pnpm alpha:check" docs/web-v1-acceptance.md
```

Expected: FAIL with no matches for at least one required alpha term.

- [ ] **Step 2: Replace the checklist title and intro**

Replace the top of `docs/web-v1-acceptance.md` through the intro paragraph with:

```markdown
# Skill-Only Alpha 验收清单

在把当前 Web workbench 视为本地单用户 alpha 前，使用本清单做一次人工验收。默认验收使用 `REAL_MODEL_RUNTIME=0` deterministic 路径，不依赖真实 provider key、MCP server、Postgres、Browser E2E 或真实部署。MCP 在本 alpha 中后置；当前主路径只依赖 Web/API、LP 固定链路和项目 Skills。
```

- [ ] **Step 3: Replace the preparation section**

Use this content:

```markdown
## 准备

- [ ] 已通过 `pnpm install` 安装依赖。
- [ ] 已创建 `.env.local`，并保持 `REAL_MODEL_RUNTIME=0` 和 `REAL_MODEL_PROVIDER_TEST=0`。
- [ ] `pnpm alpha:check` 通过。
- [ ] `pnpm smoke` 通过。
- [ ] `pnpm dev` 能启动 Web app，并输出本地 URL。
```

- [ ] **Step 4: Add ordinary chat streaming checklist**

Replace the old ordinary task section with:

```markdown
## 普通聊天 streaming

- [ ] 打开首页后，不需要先创建项目，可以直接提交普通聊天 prompt，例如 `帮我整理一个首页上线检查清单`。
- [ ] 回答以流式状态展示，生成中能看到 loading/status 文案。
- [ ] 生成完成后，对话详情保留 user / assistant messages。
- [ ] 普通聊天任务不显示 LP artifact preview。
- [ ] follow-up message 仍进入同一个普通聊天 task thread。
- [ ] 没有 running worker job 时，interrupt control 应不可用，或 graceful failure，且不阻塞对话。
```

- [ ] **Step 5: Add LP live task checklist**

Replace the old LP generation section with:

```markdown
## LP live task 和静态产物

- [ ] 提交 LP prompt，例如 `生成一个春季电商活动的静态 HTML 落地页`。
- [ ] 任务被识别为 LP generation task。
- [ ] 页面不需要手动刷新，即可通过 live task panel 看到 Planner、Builder、Reviewer、Deployer progress。
- [ ] 结果包含 artifact workspace，文件为 `index.html`、`styles.css`、`script.js`。
- [ ] 生成的 artifact 可以本地 preview/export。
- [ ] 生成的 LP artifact 不依赖 React、Vue、Angular、Next.js、Vite 或其它前端框架构建步骤。
- [ ] 可见对话中能区分 artifact 生成过程输出和最终结果输出。
```

- [ ] **Step 6: Add Skill-only workflow checklist**

Add this section after Artifact Diff and source snippet checks:

```markdown
## Skill-only alpha 主路径

- [ ] 点击 sidebar 中的 `Skills`，确认 view 能打开。
- [ ] 在 active project 下创建 Skill draft，manifest 使用项目范围 `scope: "project"`。
- [ ] 可以 validate、publish 并 bind Skill。
- [ ] 已发布、已绑定并启用的 Skill 会计入 active skill count。
- [ ] 普通聊天或 LP task 能展示 project / skill context summary，而不是泄漏 raw skill content。
- [ ] 如果绑定了带 commands 的 deployment Skill，Skill Commands 区域展示 command card。
- [ ] 点击 `Approve and queue` 后，命令进入 local worker queue。
- [ ] 点击 `Run local worker once` 后，worker queue counts、heartbeat 或 recent logs 有安全变化。
- [ ] Skill command UI 明确这是 approval、queue 和 safe observation 流程，不是任意 shell 或真实部署。
```

- [ ] **Step 7: Replace Skills/Models/MCP boundary section**

Replace the existing `## Skills、Models 和 MCP 边界` section with:

```markdown
## Models 和 MCP 边界

- [ ] 点击 sidebar 中的 `Models`，确认 view 能打开，并展示 deterministic/mock resolved routes 和真实 provider 配置表单字段。
- [ ] Models view 明确真实 provider 是 opt-in；默认 alpha check 不需要 API key。
- [ ] 缺失 provider、disabled provider 或 route 指向不可用 provider 时，页面显示 bounded fail-closed 提示。
- [ ] 可选真实 provider smoke：设置 `REAL_MODEL_RUNTIME=1`，配置 provider、`apiKeyEnv`、`assistant` / `planner` / `builder` routes，然后手动验证普通聊天和 LP prompt。
- [ ] 点击 sidebar 中的 `MCP`，确认 view 能打开，并明确 MCP 在本 alpha 中后置。
- [ ] 不配置 MCP connector 的情况下，普通聊天和 LP 任务仍可完成。
- [ ] 当前 alpha 不要求真实 MCP server、write tools、真实 shell execution 或真实部署。
```

- [ ] **Step 8: Update regression and known follow-up sections**

Replace regression commands with:

```markdown
## 回归命令

- [ ] `pnpm alpha:check` 通过。
- [ ] `pnpm smoke` 通过。
- [ ] `pnpm test` 通过。
- [ ] `pnpm typecheck` 通过。
- [ ] `pnpm build` 通过。
```

Replace known follow-up work with:

```markdown
## 已知后续工作

- [ ] Browser automation acceptance tests 进入 Stage 31。
- [ ] Provider streaming、usage/cost metadata 进入 Stage 32。
- [ ] Web UI 中的真实 MCP SDK / remote MCP server adapter 仍是后续工作。
- [ ] Production auth/RBAC、Postgres production rollout 和 object storage 仍是后续工作。
- [ ] 真实 shell runner、真实部署编排和 Desktop packaging 仍是后续工作。
```

- [ ] **Step 9: Verify checklist text**

Run:

```bash
rg -n "Skill-only Alpha|普通聊天 streaming|LP live task|Skill-only alpha 主路径|MCP 在本 alpha 中后置|pnpm alpha:check" docs/web-v1-acceptance.md
```

Expected: PASS with matches for every pattern.

- [ ] **Step 10: Commit**

```bash
git add docs/web-v1-acceptance.md
git commit -m "update alpha acceptance checklist"
```

## Task 6: Planning Docs and Stage Closeout Docs

**Files:**
- Modify: `docs/superpowers/README.md`
- Modify: `docs/project-roadmap.md`
- Modify: `docs/agent-development-learning.md`

- [ ] **Step 1: Update Superpowers index for this plan**

In `docs/superpowers/README.md`, after the Stage 30 design entry, add:

```markdown
89. `plans/2026-05-22-skill-only-alpha-hardening.md`
   - Stage 30 Skill-Only Alpha Hardening v0 implementation plan（待执行）。
   - 在 Stage 30 design 后阅读，用于按 TDD 收口 Skill-only local alpha：新增 alpha boundary copy、页面提示、deterministic `pnpm alpha:check`、README onboarding、manual alpha checklist、文档 closeout 和最终验证。
```

- [ ] **Step 2: Update roadmap status for implementation start**

In `docs/project-roadmap.md`, change Stage 30 status to:

```markdown
**状态：** 实施计划已创建，待执行。
```

Add the implementation plan link under the current design link:

```markdown
**当前实施计划：** `docs/superpowers/plans/2026-05-22-skill-only-alpha-hardening.md`。
```

- [ ] **Step 3: Update Agent learning status**

In `docs/agent-development-learning.md`, change the Stage 30 “设计已确认” sentence to say the implementation plan is ready:

```markdown
- Stage 30 Skill-Only Alpha Hardening v0 已确认设计并完成实施计划：它不是新增 Agent runtime 能力，而是把普通聊天 streaming、LP live task、artifact preview/export、项目 Skills、Skill command queue 和真实 provider opt-in 收敛成可交付的本地 alpha。学习重点是区分“第一版可用闭环的主路径”和“架构边界已存在但 alpha 不依赖的能力”：MCP 页面可以保留，但 MCP 新功能、Browser E2E、usage/cost reporting 和真实部署仍后置。
```

Change the pending implementation sentence to:

```markdown
- Skill-only alpha 仍待执行实施计划：README、alpha checklist、alpha check command、UI fail-closed 文案和相关测试需要按 `docs/superpowers/plans/2026-05-22-skill-only-alpha-hardening.md` 落地。
```

- [ ] **Step 4: After implementation, update completion state**

When Tasks 1-5 are implemented and verified, update these docs again:

- `docs/project-roadmap.md`: move Stage 30 to `已实现`, add a completed scope summary, keep recommended next queue non-empty with Stage 31, Stage 32, and one additional near-term stage.
- `docs/superpowers/README.md`: change the Stage 30 plan entry from `待执行` to `已实现，当前已完成`.
- `docs/agent-development-learning.md`: replace the pending sentence with a completed Stage 30 note.

- [ ] **Step 5: Verify docs references**

Run:

```bash
rg -n "2026-05-22-skill-only-alpha-hardening.md|实施计划已创建|Skill-only alpha 仍待执行实施计划" docs/superpowers/README.md docs/project-roadmap.md docs/agent-development-learning.md
```

Expected: PASS before implementation closeout. After Task 6 Step 4, update the expected search terms to the completed wording and verify again.

- [ ] **Step 6: Commit planning docs**

```bash
git add docs/superpowers/README.md docs/project-roadmap.md docs/agent-development-learning.md
git commit -m "add skill-only alpha hardening plan references"
```

## Task 7: Final Verification and Stage Completion

**Files:**
- Verify all changed files.
- Update stage completion docs from Task 6 Step 4 if not already done.

- [ ] **Step 1: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: PASS with no output.

- [ ] **Step 2: Run alpha check**

Run:

```bash
pnpm alpha:check
```

Expected: PASS.

- [ ] **Step 3: Run smoke**

Run:

```bash
pnpm smoke
```

Expected: PASS.

- [ ] **Step 4: Run full tests**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Run build**

Run:

```bash
pnpm build
```

Expected: PASS because this stage changes Next.js page rendering and package scripts.

- [ ] **Step 7: Confirm stage closeout docs**

Run:

```bash
rg -n "Stage 30|Stage 31|Stage 32|已实现|推荐下一阶段" docs/project-roadmap.md docs/superpowers/README.md docs/agent-development-learning.md
```

Expected: PASS and confirm the roadmap has a non-empty recommended next-stage queue with 3-5 near-term stages.

- [ ] **Step 8: Commit final closeout if needed**

If Task 6 completion docs changed after prior commits, commit them:

```bash
git add docs/project-roadmap.md docs/superpowers/README.md docs/agent-development-learning.md
git commit -m "finish skill-only alpha hardening stage"
```

- [ ] **Step 9: Final status**

Report:

- implementation commits created;
- validation commands and results;
- whether the current branch/worktree is merged into the target branch;
- any residual risks, especially manual real provider smoke if it was not run because it requires local API keys.
