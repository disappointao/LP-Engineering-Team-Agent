# Browser Platform / Visual Baseline Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 Stage50 Browser Platform / Visual Baseline Planning v0，给现有 deterministic Playwright gate 制定 cross-browser、remote browser farm、visual baseline、artifact retention 和 triage 的可执行规划，不直接搭建新 browser 平台。

**Architecture:** 本阶段是 docs/planning only。先从 Stage31 / Stage34 / Stage45 / Stage54 的 browser acceptance 事实出发，写出一个稳定 planning artifact，再同步 manual acceptance、RC checklist、roadmap 和 Superpowers README。默认 gate 保持 Chromium-only、local dev server、isolated JSON state、geometry/layout visual contract 和 failure diagnostics；remote browser farm、pixel screenshot baseline 和 CI retention 只进入后续候选。

**Tech Stack:** Markdown docs, pnpm workspace scripts, Playwright Chromium, existing `playwright.config.ts`, existing `apps/web/e2e/*` browser specs.

---

## File Map

- Create `docs/browser-platform-visual-baseline-planning.md`
  - Stage50 completion / planning artifact。
  - 记录当前 browser gate baseline、推荐 matrix tiers、visual baseline decision、artifact retention、failure triage、baseline update policy、后续 implementation candidates。
- Modify `docs/web-v1-acceptance.md`
  - 把 Stage50 planning 结论加入 Browser E2E 自动验收和已知后续工作。
  - 继续明确默认 `pnpm alpha:e2e` 不依赖真实 provider、MCP server、Postgres、真实部署、remote browser farm 或 network service。
- Modify `docs/alpha-release-candidate.md`
  - 更新 RC checklist 的 browser/visual platform 说明：Stage50 后有规划，但默认 gate 不升级为 cross-browser/pixel-perfect。
- Modify `docs/project-roadmap.md`
  - 标记 Stage50 已完成后应推荐 Stage52 / Stage53 / Stage55 / Stage48 conditional 队列。
  - 保持推荐下一阶段队列 3-5 项，且每项都有建议范围和非目标。
- Modify `docs/superpowers/README.md`
  - 添加 Stage50 plan 阅读顺序 entry。

## Stage50 Scope Rules

- 本阶段不修改 `playwright.config.ts`、`apps/web/e2e/*` 或 package scripts。
- 本阶段不引入 Playwright projects for Firefox/WebKit/Mobile。
- 本阶段不接 remote browser farm。
- 本阶段不提交 screenshot baseline、不引入 pixel-perfect snapshot gate。
- 本阶段不把 `pnpm alpha:e2e` 并入 `pnpm alpha:check`。
- 本阶段不更新 `docs/agent-development-learning.md`，除非 implementation 过程中发现需要改变 Agent runtime / context / tools / models / recovery / observability 概念边界；按当前 scope 不需要。

## Task 1: Baseline Planning Artifact

**Files:**
- Create: `docs/browser-platform-visual-baseline-planning.md`

- [ ] **Step 1: Write the planning artifact**

Create `docs/browser-platform-visual-baseline-planning.md` with this structure and content:

```markdown
# Browser Platform / Visual Baseline Planning v0

Stage50 已完成 browser platform / visual baseline planning。该阶段不改变默认 browser gate，而是把 Stage31、Stage34、Stage45 和 Stage54 已有 browser acceptance 事实整理成后续平台化策略。

## Current Baseline

- `pnpm alpha:e2e` 使用 Playwright Chromium、本地 Next.js dev server、单 worker、isolated JSON state 和 deterministic runtime。
- 默认 browser gate 不依赖真实 provider key、MCP server、Postgres、真实部署、remote browser farm、network service 或 production credentials。
- `playwright.config.ts` 当前只定义 `chromium` project，`test-results/alpha-e2e-state` 用于 isolated state，`test-results/alpha-e2e-artifacts` 用于失败 trace/video/screenshot 和 diagnostic screenshots。
- Stage34 / Stage45 已选择 geometry/layout contract 与 diagnostic screenshot，而不是 committed screenshot baseline。
- Stage54 已把 MCP management surface 纳入 browser acceptance；该 surface 仍是 safe metadata / read-only-only projection。

## Planning Decision

默认 gate 继续保持 `Chromium local deterministic`。Stage50 不把 cross-browser matrix、remote browser farm 或 pixel screenshot baseline 放进默认 readiness gate，因为当前目标仍是本地/单用户 alpha 的可重复、安全、低成本验证。

后续 browser platform 按 tier 推进：

| Tier | 用途 | 推荐状态 | Gate |
| --- | --- | --- | --- |
| Tier 0 | 本地 deterministic alpha acceptance | 当前默认 | `pnpm alpha:e2e` |
| Tier 1 | focused local browser compatibility smoke | 后续实现候选 | 手动或 opt-in script |
| Tier 2 | remote browser farm / CI browser matrix | 后续 discovery candidate | 不进默认本地 gate |
| Tier 3 | pixel screenshot baseline | 后续 discovery candidate | 只对少量稳定 surfaces opt-in |

## Cross-Browser Matrix Recommendation

Stage50 推荐先不启用完整 matrix。后续实现时按以下最小矩阵评估：

| Surface | Chromium desktop | Firefox desktop | WebKit desktop | Mobile viewport |
| --- | --- | --- | --- | --- |
| Workbench shell | 默认 gate | opt-in smoke | opt-in smoke | later candidate |
| Ordinary chat streaming | 默认 gate | opt-in smoke | opt-in smoke | later candidate |
| LP live task + artifacts | 默认 gate | opt-in smoke | opt-in smoke | later candidate |
| Skills / Models / MCP management | 默认 gate | opt-in smoke | opt-in smoke | later candidate |
| Failure / non-leakage states | 默认 gate | only high-risk subset | only high-risk subset | later candidate |
| Visual geometry contracts | 默认 gate | avoid until stabilized | avoid until stabilized | separate mobile spec only |

推荐下一步不是直接扩大 `playwright.config.ts`，而是先设计一个 opt-in script，例如 future `pnpm alpha:e2e:compat`，只运行少量 high-signal smoke specs。

## Remote Browser Farm Recommendation

remote browser farm 暂不实现。后续 discovery 应先回答：

- 是否已有 CI provider 可以保留 Playwright traces/videos/screenshots。
- 每次 PR、nightly、release candidate 分别运行哪些 browser projects。
- 失败 artifact 保留多久，谁负责 triage。
- 是否允许网络访问，以及如何保持 no-key deterministic state。
- remote artifact 中如何继续避免 secret、本机路径、raw provider response、raw MCP output 和 raw artifact full content。

## Visual Baseline Recommendation

默认继续使用 geometry/layout contract。只有满足以下条件的 surface 才考虑 pixel baseline：

- UI 足够稳定，文案和 layout 不频繁变化。
- failure impact 高，geometry assertion 不足以捕捉问题。
- screenshot 能稳定规避 OS/font/Chromium version 噪音。
- baseline update 有 reviewer 和明确理由。
- screenshot 不包含 user data、secret、raw tool output、raw artifact full content 或本机路径。

当前可继续保持 geometry 的 checks：

- sidebar / workspace / composer 基础布局。
- artifact workspace manifest / preview / export layout。
- Skills / Models / MCP management layout。
- no horizontal scroll、button/input containment、critical panel visibility。

暂不建议做 pixel baseline 的 areas：

- LP generated artifact visual quality。
- streaming token transient states。
- dynamic timeline progress animation。
- provider/MCP/worker failure diagnostics copy。

## Artifact Retention Recommendation

本地默认：

- `test-results/` 仍不提交。
- failure trace/video/screenshot 由 Playwright 默认保留。
- diagnostic screenshots 继续写入 `testInfo.outputPath(...)`。
- 不提交 baseline image。

未来 CI / remote farm：

- PR run artifacts 建议保留 7 天。
- release candidate run artifacts 建议保留 30 天。
- nightly matrix artifacts 建议只保留失败 run，或成功 run 保留 24 小时。
- retention policy 进入 CI 前必须写入 operator docs。

## Failure Triage Policy

Browser failure 先按以下分类：

| Category | Meaning | First response |
| --- | --- | --- |
| product_regression | 用户可见主路径或安全边界坏了 | 修代码并补 focused test |
| test_fixture_drift | isolated state 或 locator 与产品事实不一致 | 修 fixture/helper，不扩大产品 contract |
| infra_flake | browser install、local port、timing、remote runner 问题 | rerun once，记录 infra evidence |
| visual_contract_too_brittle | geometry/pixel rule 约束了非关键样式 | 降低断言或改为 diagnostic screenshot |
| accepted_ui_change | 有意 UI 变化导致旧 contract 失效 | 更新 test/docs，说明理由 |

pixel baseline update 如果未来启用，必须在 PR 描述或 closeout 中列出：

- 旧 baseline 为什么过期。
- 新截图对应的 user-visible change。
- 是否仍不含 secret、本机路径、raw tool output 或 full artifact。
- 已运行的 focused browser command。

## Recommended Follow-Up Candidates

- Stage56 Browser Compatibility Smoke Discovery v0：设计 opt-in Firefox/WebKit/local compatibility smoke，不改变默认 gate。
- Stage57 Visual Baseline Candidate Discovery v0：只评估少量稳定 surfaces 是否值得 pixel baseline。
- Stage58 Remote Browser Farm Discovery v0：定义 CI/farm provider、artifact retention、network/no-key policy 和 triage ownership。

## Validation Evidence

- Stage50 是 docs/planning only。
- 默认 validation 应运行 `pnpm alpha:check`、`pnpm smoke`、`git diff --check` 和 docs consistency `rg`。
- 如 docs 修改影响 RC/browser checklist wording，可额外运行 `pnpm alpha:e2e` 作为 confidence check；但 Stage50 不要求改变 browser tests。
```

- [ ] **Step 2: Validate planning artifact terminology**

Run:

```bash
rg -n "Stage50|Browser Platform|Visual Baseline|Tier 0|remote browser farm|pixel screenshot baseline|artifact retention|Failure Triage" docs/browser-platform-visual-baseline-planning.md
```

Expected: each major planning section appears exactly as Stage50 scope requires.

- [ ] **Step 3: Commit Task 1**

```bash
git add docs/browser-platform-visual-baseline-planning.md
git commit -m "document browser platform visual baseline planning"
```

## Task 2: Acceptance and RC Docs Sync

**Files:**
- Modify: `docs/web-v1-acceptance.md`
- Modify: `docs/alpha-release-candidate.md`

- [ ] **Step 1: Update Browser E2E automatic acceptance checklist**

In `docs/web-v1-acceptance.md`, update the Browser E2E section so it includes these facts:

```markdown
- [ ] Stage50 browser platform planning 已完成：默认 `pnpm alpha:e2e` 仍是 Chromium-only local deterministic gate；cross-browser matrix、remote browser farm 和 pixel screenshot baseline 仍不进入默认 gate。
- [ ] 若后续启用 browser compatibility smoke，应保持 opt-in，不要求真实 provider key、MCP server、Postgres、真实部署、网络服务或 production credentials。
```

In the known follow-up work section, replace the old browser platform backlog bullet with:

```markdown
- [ ] Stage50 Browser Platform / Visual Baseline Planning v0 已完成；Firefox/WebKit compatibility smoke、remote browser farm 和 pixel screenshot baseline 仍只作为后续 discovery / opt-in implementation candidate。
```

- [ ] **Step 2: Update RC checklist language**

In `docs/alpha-release-candidate.md`, update the known limitations or deterministic gates section to include:

```markdown
- Stage50 已完成 browser platform / visual baseline planning；RC 默认 gate 仍只要求 deterministic local Chromium `pnpm alpha:e2e`，不要求 cross-browser matrix、remote browser farm 或 pixel screenshot baseline。
```

If a table already lists cross-browser farm / pixel baseline as backlog, keep it as backlog and append `Stage50 planning complete` rather than marking it implemented.

- [ ] **Step 3: Run docs wording check**

Run:

```bash
rg -n "Stage50|cross-browser|remote browser farm|pixel screenshot baseline|Chromium-only|compatibility smoke" docs/web-v1-acceptance.md docs/alpha-release-candidate.md
```

Expected: docs state Stage50 is planning complete while remote farm / pixel baseline remain non-default follow-ups.

- [ ] **Step 4: Commit Task 2**

```bash
git add docs/web-v1-acceptance.md docs/alpha-release-candidate.md
git commit -m "sync browser platform acceptance docs"
```

## Task 3: Roadmap and Superpowers Index Closeout

**Files:**
- Modify: `docs/project-roadmap.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Add Superpowers README entry**

Append a new entry after the Stage54 plan entry:

```markdown
128. `plans/2026-05-25-browser-platform-visual-baseline-planning.md`
   - Stage 50 Browser Platform / Visual Baseline Planning v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 45 browser failure / visual regression expansion、Stage 47 operator trial、Stage 49 backlog prioritization 和 Stage 54 MCP management implementation 后阅读，用于审计 docs-only browser platform planning：cross-browser matrix tiers、remote browser farm assumptions、visual baseline decision、artifact retention、failure triage 和 baseline update policy；本阶段不修改 Playwright config/specs/scripts，不引入 remote browser farm，不提交 screenshot baseline，也不改变默认 deterministic `pnpm alpha:e2e` gate。完成记录见 `docs/browser-platform-visual-baseline-planning.md`。
```

- [ ] **Step 2: Update roadmap current snapshot**

In `docs/project-roadmap.md`, add a completed Stage50 summary near the current-state bullet list:

```markdown
- Browser Platform / Visual Baseline Planning v0：Stage 50 已完成 docs-only planning，明确默认 browser gate 保持 Chromium local deterministic、geometry/layout contracts 和 diagnostic screenshots；Firefox/WebKit compatibility smoke、remote browser farm、pixel screenshot baseline、CI artifact retention 和 baseline update workflow 仍是后续 discovery / opt-in candidates。
```

- [ ] **Step 3: Add Stage50 section or update existing queue section**

Change the Stage50 section status to:

```markdown
**状态：** 已实现，当前已完成。
```

Add implementation summary bullets:

```markdown
- 已记录当前 `pnpm alpha:e2e` baseline：Chromium-only、本地 Next.js dev server、isolated JSON state、deterministic runtime 和 local diagnostic artifacts。
- 已给出 browser platform tiering：Tier 0 默认 gate、Tier 1 opt-in compatibility smoke、Tier 2 remote browser farm discovery、Tier 3 pixel screenshot baseline discovery。
- 已定义 visual baseline 取舍：默认继续 geometry/layout contract，只对稳定、高影响、低 flake surface 未来考虑 pixel baseline。
- 已定义 artifact retention、failure triage 和 baseline update policy 的后续要求。
```

Keep non-goals:

```markdown
- 不修改 Playwright config/specs/scripts。
- 不引入 remote browser farm、cross-browser default matrix、pixel-perfect baseline 或 CI artifact retention implementation。
- 不回改 Stage54 MCP management scope 或 Stage48 blocker 条件触发规则。
```

- [ ] **Step 4: Update recommended next queue**

After Stage50 completes, recommended queue should remain non-empty and move default to Stage52:

```markdown
当前推荐下一阶段队列：

- Stage 52 Real Deployment Runner Discovery v0 作为默认推荐 discovery 阶段。
- Stage 53 Model Gateway Cost / Fallback Policy Discovery v0 作为后续 discovery candidate。
- Stage 55 Remote MCP SDK / Write Tool Discovery v0 作为后续 discovery candidate。
- Stage 48 RC Blocker Fix Batch v0 仅在 accepted blockers 出现时条件触发。
- Stage 56 Browser Compatibility Smoke Discovery v0 可作为 Stage50 后续 browser platform candidate。
```

Do not remove Stage48 conditional.

- [ ] **Step 5: Add roadmap decision record**

Add a new decision record at the top of `## 决策记录`:

```markdown
- 2026-05-25 Stage 50 Browser Platform / Visual Baseline Planning v0 已完成：`docs/browser-platform-visual-baseline-planning.md` 记录 current Chromium deterministic baseline、browser matrix tiers、remote browser farm assumptions、visual baseline decision、artifact retention、failure triage 和 baseline update policy；本阶段未修改 Playwright config/specs/scripts，未引入 cross-browser default matrix、remote browser farm 或 pixel screenshot baseline。当前推荐下一阶段转为 Stage 52 Real Deployment Runner Discovery v0；Stage 48 conditional、Stage 53、Stage 55 和 Stage 56 保留。
```

- [ ] **Step 6: Run roadmap/index consistency check**

Run:

```bash
rg -n "Stage 50|Stage50|Browser Platform|Visual Baseline|Stage 52|Stage 56|browser-platform-visual-baseline-planning" docs/project-roadmap.md docs/superpowers/README.md
```

Expected: Stage50 is marked complete, completion record exists, and next queue is not empty.

- [ ] **Step 7: Commit Task 3**

```bash
git add docs/project-roadmap.md docs/superpowers/README.md
git commit -m "close browser platform planning roadmap"
```

## Task 4: Validation and Stage50 Closeout Review

**Files:**
- No planned edits unless validation exposes doc inconsistency.

- [ ] **Step 1: Run deterministic docs-stage gates**

Run:

```bash
pnpm alpha:check
pnpm smoke
git diff --check
git status --short --branch
```

Expected:

- `pnpm alpha:check`: PASS.
- `pnpm smoke`: PASS.
- `git diff --check`: no output.
- `git status --short --branch`: clean branch.

- [ ] **Step 2: Run optional browser confidence gate**

Run:

```bash
pnpm alpha:e2e
```

Expected: PASS with current Playwright Chromium tests. If local browser dependencies are missing, run `pnpm alpha:e2e:install` and rerun. If sandbox blocks local port binding, rerun with approved escalation for `pnpm alpha:e2e`.

- [ ] **Step 3: Final docs consistency scan**

Run:

```bash
rg -n "Stage50|Stage 50|remote browser farm|pixel screenshot baseline|Firefox/WebKit|Stage 52|Stage 56" docs/browser-platform-visual-baseline-planning.md docs/web-v1-acceptance.md docs/alpha-release-candidate.md docs/project-roadmap.md docs/superpowers/README.md
```

Expected: all references agree that Stage50 is complete, default browser gate remains Chromium local deterministic, and future browser expansion remains opt-in/discovery.

- [ ] **Step 4: Final review**

Request a final review focused on:

- docs consistency across roadmap / Superpowers README / acceptance / RC docs；
- no accidental scope expansion into Playwright config or browser specs；
- next queue still has 3-5 concrete phases；
- Stage50 planning artifact is actionable and does not imply remote farm / pixel baseline is already implemented。

- [ ] **Step 5: Merge and cleanup**

Use `superpowers:finishing-a-development-branch` after review passes. Merge the Stage50 worktree branch back to `main`, run post-merge `pnpm alpha:check`, clean up the worktree and delete the merged branch.

## Self-Review

- Spec coverage: tasks cover Stage50 scope from roadmap: cross-browser matrix, remote browser farm, visual baseline, screenshot artifact retention, failure triage and baseline update policy.
- Scope control: plan is docs-only and explicitly avoids modifying `playwright.config.ts`, `apps/web/e2e/*`, package scripts, runtime, provider, MCP, deployment, auth or storage.
- Required docs sync: new Superpowers plan updates `docs/superpowers/README.md`; stage planning/completion updates `docs/project-roadmap.md`; browser/RC docs record planning outcome.
- Placeholder scan: no `TBD`, `TODO`, `implement later` or undefined file paths.
