# LP Artifact Quality Prompt Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an internal alpha LP artifact quality baseline and harden Planner / Builder structured prompts without changing the static three-file artifact contract.

**Architecture:** Keep quality evaluation as documentation and focused prompt contract tests. `packages/api` owns Planner / Builder structured prompt wording; existing schema parsing, repair, artifact policy, provider adapters, preview, and export remain unchanged. Docs connect alpha feedback, real provider smoke, and Stage 39 quality fixtures through safe evidence rules.

**Tech Stack:** TypeScript, Vitest, pnpm monorepo, existing `@lp-agent/api` structured output modules, Markdown docs.

---

## File Structure

- Create `docs/lp-artifact-quality.md`
  - Internal alpha prompt fixtures, rubric, manual review record, and safe evidence rules.
- Modify `docs/alpha-release-candidate.md`
  - Link artifact checks and `artifact_quality_issue` routing to the new quality doc.
- Modify `docs/real-provider-alpha-smoke.md`
  - Add a real-provider quality spot-check row and safe troubleshooting note.
- Modify `packages/api/src/structured-lp-brief.test.ts`
  - Lock Planner and repair prompt quality guidance.
- Modify `packages/api/src/structured-lp-brief.ts`
  - Add shared LP brief quality guidance to Planner and repair prompts.
- Modify `packages/api/src/structured-static-artifacts.test.ts`
  - Lock Builder and repair prompt artifact quality guidance.
- Modify `packages/api/src/structured-static-artifacts.ts`
  - Add shared static artifact quality guidance to Builder and repair prompts.
- Modify `docs/project-roadmap.md`
  - Close Stage 39 and keep the next-stage queue at 3 items.
- Modify `docs/superpowers/README.md`
  - Mark this plan as implemented after completion.
- Modify `docs/agent-development-learning.md`
  - Append the completed Stage 39 learning note to the current artifact quality paragraph.

## Task 1: Quality Review Documentation

**Files:**
- Create: `docs/lp-artifact-quality.md`
- Modify: `docs/alpha-release-candidate.md`
- Modify: `docs/real-provider-alpha-smoke.md`

- [ ] **Step 1: Run the failing quality doc existence check**

Run:

```bash
test -f docs/lp-artifact-quality.md && rg -n "Ecommerce flash sale|B2B SaaS trial|Safe Evidence Rules" docs/lp-artifact-quality.md
```

Expected: FAIL with a non-zero exit because `docs/lp-artifact-quality.md` does not exist yet.

- [ ] **Step 2: Create the quality baseline doc**

Create `docs/lp-artifact-quality.md` with this content:

```markdown
# LP Artifact Quality Baseline

这份文档用于 Stage 39 之后的内部 alpha LP artifact quality review。它不是自动评分器、客户验收 SLA 或 public onboarding。默认 deterministic gates 继续验证安全和可重复性；本文件提供人工质量评审的 prompt fixtures、rubric 和安全记录格式。

## Scope

适用范围：

- 本地单用户 Web workbench。
- `Planner -> Builder -> Reviewer -> Deployer` 固定 LP 链路。
- 框架无关静态 artifact：`index.html`、`styles.css`、`script.js`。
- deterministic runtime 和真实 provider opt-in 都可以使用本 rubric。

不适用范围：

- 不作为 release blocker。
- 不引入 LLM-as-judge。
- 不要求 pixel-perfect screenshot baseline。
- 不保存完整 artifact 内容、raw provider response、secret、本机绝对路径、raw worker payload 或 raw tool output。

## Prompt Fixtures

每次质量评审选择 2-4 个 fixtures。真实 provider 试用建议至少覆盖一个中文 fixture、一个英文或中英混合 fixture、一个移动端优先 fixture。

### F1: Ecommerce flash sale

```text
生成一个春季电商限时促销 LP，主推三款轻量通勤鞋，突出 48 小时折扣、包邮、尺码无忧退换。页面要有清晰首屏 CTA、商品卡片、买家评价、FAQ 和最终购买 CTA。
```

Quality focus: offer clarity, product card hierarchy, repeated CTA, FAQ/risk reducer, mobile product grid.

### F2: B2B SaaS trial

```text
Create a landing page for "OpsPilot", a B2B SaaS workflow automation product for small operations teams. Emphasize faster handoffs, fewer manual updates, a 14-day trial, proof points, feature sections, and a demo CTA.
```

Quality focus: value proposition, proof, feature grouping, demo CTA, professional but not generic copy.

### F3: Event registration

```text
为一个线下 AI 运营增长工作坊生成报名页。信息包括：上海，6 月 18 日，半天活动，适合市场和运营负责人。需要议程、讲师亮点、席位有限提示和报名 CTA。
```

Quality focus: date/place clarity, agenda scanability, speaker/trust signal, registration CTA.

### F4: Local service

```text
Create a local landing page for a weekend home cleaning service in Austin. Highlight same-week booking, vetted cleaners, transparent pricing, neighborhood trust, testimonials, and a book-now CTA.
```

Quality focus: local trust, service area, pricing clarity, testimonial structure, booking CTA.

### F5: Mobile-first lead capture

```text
生成一个移动端优先的留资页，为一家少儿编程体验课收集家长预约。要求短首屏、强表单 CTA、课程亮点、家长顾虑 FAQ、适合手机浏览。
```

Quality focus: mobile first layout, short hero, touch targets, CTA repetition, low overflow risk.

### F6: Mixed-language brand input

```text
为 "LumaDesk Pro" 生成一个中英混合 LP。品牌语气要专业但有温度，中文正文为主，保留英文产品名。突出 ergonomic workspace、wireless charging、early bird offer 和 pre-order CTA。
```

Quality focus: language preservation, product naming, offer clarity, copy naturalness.

### F7: Continue-improvement request

```text
继续优化刚才的 LP：首屏 CTA 更明确，增加 social proof，把 FAQ 写得更能处理用户顾虑，并让移动端阅读更轻。
```

Quality focus: context-sensitive improvement, CTA clarity, proof/risk reducer, mobile readability.

## Rubric

Use a 0-2 score for each dimension.

| Dimension | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Structure | Missing key LP sections or confusing order. | Has hero/body/CTA but weak proof or risk reducer. | Clear hero, value sections, proof or trust, FAQ/risk reducer, final CTA. |
| Visual hierarchy | Headings, copy, cards, and CTA compete. | Some hierarchy exists but scanning is uneven. | Headline, subcopy, CTA, sections, and cards are easy to scan. |
| CTA | CTA label or destination is unclear. | CTA exists but is weak, inconsistent, or appears only once. | Primary CTA is clear, repeated where useful, and aligned with the offer. |
| Responsive | Mobile layout likely overflows or is dense. | Mobile mostly works but spacing or order needs review. | Mobile-first layout, readable text, stable card/grid behavior, usable touch targets. |
| Accessibility | Semantic structure, alt text, or focus states are missing. | Basic semantics exist but focus/labels/contrast need review. | Semantic HTML, alt text for images, visible focus, readable contrast, clear labels. |
| Copy quality | Generic, vague, or not tied to audience/offer. | Mostly relevant but some filler remains. | Specific, audience-aware, concise, and aligned with tone and offer. |
| Safety and contract | Violates static artifact or resource policy. | Contract holds, but reviewer should inspect resource choices. | Framework-free three-file artifact with safe local JS/CSS boundaries. |

Recommended interpretation:

- 12-14: strong alpha result.
- 9-11: usable with notes.
- 6-8: quality issue; route to Stage 39 or Stage 41 depending on severity.
- 0-5: likely blocker if this was a target fixture for RC.

## Review Record

```markdown
### LP Artifact Quality Review

- Commit:
- Date:
- Reviewer:
- Runtime mode: deterministic | real provider opt-in
- Provider api if relevant: openai-completions | anthropic-messages | not applicable
- Model if relevant:
- Fixture id:
- Artifact files present: index.html | styles.css | script.js
- Preview/export checked: yes | no

### Scores

- Structure:
- Visual hierarchy:
- CTA:
- Responsive:
- Accessibility:
- Copy quality:
- Safety and contract:
- Total:

### Safe Evidence

- Bounded snippet summary:
- Screenshot description or relative artifact filename:
- Relevant run/event type:
- Artifact filenames:

### Notes

- What worked:
- What needs improvement:
- Suggested routing: Stage 39 | Stage 40 | Stage 41 | backlog | needs immediate fix
```

## Safe Evidence Rules

Allowed:

- Rubric score.
- Screenshot description or relative artifact filename.
- Bounded snippet summary.
- Run/event type.
- Artifact filenames.
- Provider api type and model id.

Not allowed:

- Secret values or API keys.
- Raw provider response.
- Full generated artifact content.
- Local absolute paths.
- Raw worker payload.
- Raw tool output.
- Raw stdout/stderr.

## Relationship to Artifact Policy

Artifact policy remains a code-enforced safety boundary. It rejects unsafe or out-of-contract artifacts. This rubric is a human quality baseline for internal alpha review. A page can pass policy and still receive a low quality score; a page that violates policy should be treated as a blocking bug rather than only a quality issue.
```

- [ ] **Step 3: Update the alpha RC artifact check path**

In `docs/alpha-release-candidate.md`, replace the current Artifact 检查 list:

```markdown
6. Artifact 检查：
   - 打开 preview/export。
   - 分别查看三个文件的 bounded snippet。
   - 确认 UI 不展示完整 artifact 内容作为默认 diff。
```

with:

```markdown
6. Artifact 检查：
   - 打开 preview/export。
   - 分别查看三个文件的 bounded snippet。
   - 确认 UI 不展示完整 artifact 内容作为默认 diff。
   - 如本次试用关注 LP 输出质量，按 `docs/lp-artifact-quality.md` 选择 2-4 个 fixtures 做人工 rubric 记录。
```

In the `artifact_quality_issue` triage row, replace the default routing cell text `Stage 39。` with:

```markdown
`docs/lp-artifact-quality.md` + Stage 39/41。
```

In `Follow-up Routing`, replace the Stage 39 bullet:

```markdown
- Stage 39：LP artifact quality rubric、prompt fixtures、Builder/Planner prompt hardening 和人工质量评审。
```

with:

```markdown
- Stage 39：`docs/lp-artifact-quality.md`、LP artifact quality rubric、prompt fixtures、Builder/Planner prompt hardening 和人工质量评审。
```

- [ ] **Step 4: Update real provider smoke quality guidance**

In `docs/real-provider-alpha-smoke.md`, add this row after `S7` in the Smoke Matrix table:

```markdown
| S8 | LP artifact quality spot-check | `REAL_MODEL_RUNTIME=1`，配置 `planner` 和 `builder` route | 按 `docs/lp-artifact-quality.md` 选择 2 个 fixtures 提交 LP prompt | 记录 rubric score 和 safe evidence；不保存 raw provider response 或完整 artifact 内容。 |
```

Add this bullet in the 排错 list after `Artifact policy failure`:

```markdown
- Artifact quality issue：生成成功且 policy 通过，但视觉层级、CTA、移动端、copy 或基础可访问性不达预期。按 `docs/lp-artifact-quality.md` 记录 rubric score 和 safe evidence，再路由到 Stage 39/41。
```

- [ ] **Step 5: Run documentation checks**

Run:

```bash
test -f docs/lp-artifact-quality.md
rg -n "F1: Ecommerce flash sale|F2: B2B SaaS trial|F7: Continue-improvement request|Safe Evidence Rules" docs/lp-artifact-quality.md
rg -n "docs/lp-artifact-quality.md" docs/alpha-release-candidate.md docs/real-provider-alpha-smoke.md
```

Expected: PASS. The `rg` output includes the fixture headings, `Safe Evidence Rules`, and links from both alpha docs.

- [ ] **Step 6: Commit**

```bash
git status --short
git add docs/lp-artifact-quality.md docs/alpha-release-candidate.md docs/real-provider-alpha-smoke.md
git commit -m "add lp artifact quality rubric"
```

Expected: commit succeeds and only the three listed files are staged.

## Task 2: Planner Prompt Quality Guidance

**Files:**
- Modify: `packages/api/src/structured-lp-brief.test.ts`
- Modify: `packages/api/src/structured-lp-brief.ts`

- [ ] **Step 1: Write failing Planner prompt tests**

In `packages/api/src/structured-lp-brief.test.ts`, extend `"builds a strict JSON Planner prompt that preserves the user prompt"` with:

```ts
    expect(prompt).toContain("LP quality guidance:");
    expect(prompt).toContain(
      "Turn vague requests into a concrete LP structure with audience, offer, CTA, section hierarchy, and proof."
    );
    expect(prompt).toContain(
      "Sections should cover hero, benefits/value props, proof or trust, FAQ/risk reducer, and final CTA when the request allows it."
    );
    expect(prompt).toContain(
      "Use layoutHints for mobile-first and desktop layout intent, including card grids, two-column hero layouts, repeated CTA placement, or single-column mobile flow."
    );
    expect(prompt).toContain(
      "Use validationRules and complianceNotes for accessibility notes, claim caution, required CTA behavior, and content constraints."
    );
```

Extend `"creates a safe LP brief repair prompt without raw model output"` with:

```ts
    expect(prompt).toContain("LP quality guidance:");
    expect(prompt).toContain(
      "Turn vague requests into a concrete LP structure with audience, offer, CTA, section hierarchy, and proof."
    );
    expect(prompt).toContain(
      "Keep copy specific to the audience, offer, product, location, event, or brand named in the request."
    );
```

- [ ] **Step 2: Run Planner tests and verify they fail**

Run:

```bash
pnpm vitest run packages/api/src/structured-lp-brief.test.ts
```

Expected: FAIL because the Planner prompts do not yet include `LP quality guidance:`.

- [ ] **Step 3: Add shared Planner quality guidance**

In `packages/api/src/structured-lp-brief.ts`, add this constant after `PlannerLPBriefParseError`:

```ts
const LP_BRIEF_QUALITY_GUIDE = [
  "Turn vague requests into a concrete LP structure with audience, offer, CTA, section hierarchy, and proof.",
  "Sections should cover hero, benefits/value props, proof or trust, FAQ/risk reducer, and final CTA when the request allows it.",
  "Use layoutHints for mobile-first and desktop layout intent, including card grids, two-column hero layouts, repeated CTA placement, or single-column mobile flow.",
  "Use validationRules and complianceNotes for accessibility notes, claim caution, required CTA behavior, and content constraints.",
  "Use assets alt text, section media notes, and productData details so the Builder can create accessible static HTML.",
  "Keep copy specific to the audience, offer, product, location, event, or brand named in the request."
];
```

In `createStructuredLPBriefPlannerPrompt()`, insert this block after the `"- complianceNotes: string[]",` line and before the blank line preceding `"User request:"`:

```ts
    "",
    "LP quality guidance:",
    ...LP_BRIEF_QUALITY_GUIDE,
```

In `createStructuredLPBriefRepairPrompt()`, insert the same block after the `"- complianceNotes: string[]",` line and before the blank line preceding `"Original user request:"`:

```ts
    "",
    "LP quality guidance:",
    ...LP_BRIEF_QUALITY_GUIDE,
```

- [ ] **Step 4: Run Planner tests and verify they pass**

Run:

```bash
pnpm vitest run packages/api/src/structured-lp-brief.test.ts
```

Expected: PASS. Existing strict JSON, no Markdown fences, and safe repair prompt assertions remain green.

- [ ] **Step 5: Commit**

```bash
git status --short
git add packages/api/src/structured-lp-brief.ts packages/api/src/structured-lp-brief.test.ts
git commit -m "harden planner lp quality prompt"
```

Expected: commit succeeds and only the two listed files are staged.

## Task 3: Builder Prompt Quality Guidance

**Files:**
- Modify: `packages/api/src/structured-static-artifacts.test.ts`
- Modify: `packages/api/src/structured-static-artifacts.ts`

- [ ] **Step 1: Write failing Builder prompt tests**

In `packages/api/src/structured-static-artifacts.test.ts`, extend `"builds a strict JSON Builder prompt from a validated LP brief"` with:

```ts
    expect(prompt).toContain("Static artifact quality guidance:");
    expect(prompt).toContain(
      "Use semantic HTML structure such as header, main, section, and footer."
    );
    expect(prompt).toContain(
      "Make the hero immediately scannable with a specific headline, supporting copy, primary CTA, and offer or value signal."
    );
    expect(prompt).toContain(
      "Write mobile-first responsive CSS with stable spacing, readable line-height, no text overflow, and desktop media-query enhancements."
    );
    expect(prompt).toContain(
      "Provide visible focus styles plus hover or active states for interactive elements."
    );
    expect(prompt).toContain("Give every meaningful image alt text.");
```

Extend `"creates a safe static artifacts repair prompt without raw artifact output"` with:

```ts
    expect(prompt).toContain("Static artifact quality guidance:");
    expect(prompt).toContain(
      "Keep all behavior in local script.js and do not use inline event handler attributes such as onclick."
    );
    expect(prompt).toContain(
      "If no images are available, rely on strong structure, typography, cards, and copy instead of unsafe external assets."
    );
```

- [ ] **Step 2: Run Builder tests and verify they fail**

Run:

```bash
pnpm vitest run packages/api/src/structured-static-artifacts.test.ts
```

Expected: FAIL because the Builder prompts do not yet include `Static artifact quality guidance:`.

- [ ] **Step 3: Add shared Builder quality guidance**

In `packages/api/src/structured-static-artifacts.ts`, add this constant after `CSS_FRAMEWORK_HREFS`:

```ts
const STATIC_ARTIFACT_QUALITY_GUIDE = [
  "Use semantic HTML structure such as header, main, section, and footer.",
  "Make the hero immediately scannable with a specific headline, supporting copy, primary CTA, and offer or value signal.",
  "Write mobile-first responsive CSS with stable spacing, readable line-height, no text overflow, and desktop media-query enhancements.",
  "Provide visible focus styles plus hover or active states for interactive elements.",
  "Give every meaningful image alt text.",
  "Keep all behavior in local script.js and do not use inline event handler attributes such as onclick.",
  "If no images are available, rely on strong structure, typography, cards, and copy instead of unsafe external assets."
];
```

In `createStructuredStaticArtifactsBuilderPrompt()`, insert this block after `"External JavaScript, javascript: URLs, inline event handler attributes, and CSS frameworks are forbidden.",` and before `"Use the LP brief JSON below..."`:

```ts
    "",
    "Static artifact quality guidance:",
    ...STATIC_ARTIFACT_QUALITY_GUIDE,
```

In `createStructuredStaticArtifactsRepairPrompt()`, insert the same block after `"External JavaScript, javascript: URLs, inline event handler attributes, and CSS frameworks are forbidden.",` and before the blank line preceding `"Failure summary:"`:

```ts
    "",
    "Static artifact quality guidance:",
    ...STATIC_ARTIFACT_QUALITY_GUIDE,
```

- [ ] **Step 4: Run Builder tests and verify they pass**

Run:

```bash
pnpm vitest run packages/api/src/structured-static-artifacts.test.ts
```

Expected: PASS. Existing safety, schema, repair, and policy assertions remain green.

- [ ] **Step 5: Run API package tests**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git status --short
git add packages/api/src/structured-static-artifacts.ts packages/api/src/structured-static-artifacts.test.ts
git commit -m "harden builder artifact quality prompt"
```

Expected: commit succeeds and only the two listed files are staged.

## Task 4: Stage 39 Closeout Docs and Verification

**Files:**
- Modify: `docs/project-roadmap.md`
- Modify: `docs/superpowers/README.md`
- Modify: `docs/superpowers/specs/2026-05-23-lp-artifact-quality-prompt-hardening-design.md`
- Modify: `docs/agent-development-learning.md`

- [ ] **Step 1: Run the failing closeout status check**

Run:

```bash
rg -n "Stage 39 已完成|LP artifact quality baseline v0" docs/project-roadmap.md docs/agent-development-learning.md
```

Expected: FAIL because Stage 39 is not closed out yet.

- [ ] **Step 2: Update the Stage 39 spec status**

In `docs/superpowers/specs/2026-05-23-lp-artifact-quality-prompt-hardening-design.md`, replace:

```markdown
**状态：** 设计已确认，实施计划已创建，待实现。
```

with:

```markdown
**状态：** 已实现。
```

- [ ] **Step 3: Update Superpowers README**

In `docs/superpowers/README.md`, replace the Stage 39 spec entry status text:

```markdown
- Stage 39 LP Artifact Quality Evaluation and Prompt Hardening v0 design（设计已确认，实施计划已创建，待实现）。
```

with:

```markdown
- Stage 39 LP Artifact Quality Evaluation and Prompt Hardening v0 design（已实现，当前已完成）。
```

Replace the existing Stage 39 plan entry status:

```markdown
107. `plans/2026-05-23-lp-artifact-quality-prompt-hardening.md`
   - Stage 39 LP Artifact Quality Evaluation and Prompt Hardening v0 implementation plan（待实现）。
   - 在 Stage 39 design 后阅读，用于按 TDD 新增 LP artifact quality rubric、prompt fixtures、Planner / Builder prompt hardening、alpha docs 路由和 roadmap closeout。
```

with:

```markdown
107. `plans/2026-05-23-lp-artifact-quality-prompt-hardening.md`
   - Stage 39 LP Artifact Quality Evaluation and Prompt Hardening v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 39 design 后阅读，用于按 TDD 新增 LP artifact quality rubric、prompt fixtures、Planner / Builder prompt hardening、alpha docs 路由和 roadmap closeout。
```

- [ ] **Step 4: Update roadmap status and next-stage queue**

In `docs/project-roadmap.md`, add this bullet to the current status snapshot after the Stage 38 bullet:

```markdown
- LP artifact quality baseline v0：Stage 39 已新增质量 rubric、代表性 prompt fixtures、人工评审记录、安全证据规则，并对 Planner / Builder structured prompts 做小范围质量 hardening；三文件静态 artifact contract 和 policy 不变。
```

In the “第一版可用闭环目标” section, replace the paragraph sentence segment:

```markdown
Stage 38 已完成 ordinary chat streaming failure UX hardening。第一版可用闭环下一步优先补齐：
```

with:

```markdown
Stage 38 已完成 ordinary chat streaming failure UX hardening。Stage 39 已完成 LP artifact quality baseline 和 Planner / Builder prompt hardening。第一版可用闭环下一步优先补齐：
```

Then remove the old Stage 39 recommendation block from `## 推荐下一阶段队列` and add a completed Stage 39 section before that heading:

```markdown
### Stage 39：LP Artifact Quality Evaluation and Prompt Hardening v0

**状态：** 已实现。

Stage 39 v0 已建立内部 alpha LP artifact quality baseline，并对 Planner / Builder structured prompts 做小范围质量 hardening。质量评审继续是人工 rubric，不进入默认 deterministic gates；artifact policy 继续负责 fail-closed 安全和三文件静态 contract。

已实现范围：

- 新增 `docs/lp-artifact-quality.md`，包含 7 个代表性 prompt fixtures、rubric、review record 和 safe evidence rules。
- `docs/alpha-release-candidate.md` 和 `docs/real-provider-alpha-smoke.md` 已把 artifact quality spot-check 和反馈路由指向质量文档。
- Planner structured prompt 增加 LP quality guidance，要求更清晰的 audience、offer、CTA、section hierarchy、responsive hints、accessibility notes 和 specific copy。
- Builder structured prompt 和 repair prompt 增加 semantic HTML、scannable hero、mobile-first responsive CSS、focus/hover states、alt text 和 local script guidance。
- Focused Vitest 覆盖 prompt hardening 文案，并保留 strict JSON、安全禁令、schema parse 和 policy regression。

未实现范围：

- 不做自动视觉评分、LLM-as-judge production gate、图片生成 pipeline、设计系统重写或 provider 自动 E2E。
- 不改变 `LPBriefSchema`、`StaticArtifactsSchema`、三文件静态 artifact policy、preview/export contract 或 provider adapter。
- 不把 rubric 变成 public SaaS onboarding、客户验收 SLA 或 release blocker。

**设计：** `docs/superpowers/specs/2026-05-23-lp-artifact-quality-prompt-hardening-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-23-lp-artifact-quality-prompt-hardening.md`。
```

Keep these three recommendation blocks under `## 推荐下一阶段队列`:

```markdown
### Stage 40：Alpha Feedback Intake and Triage Loop v0

**状态：** Stage 39 后推荐，可按内部 RC 试用启动时间提前。
```

```markdown
### Stage 41：Alpha RC Trial Fix Batch v0

**状态：** Stage 40 后推荐，可按内部 RC 反馈提前。
```

Add this third queue item after Stage 41:

```markdown
### Stage 42：Post-alpha MCP Worker Execution Readiness v0

**状态：** Stage 41 后推荐，可按内部 alpha 反馈提前或后置。

**为什么现在做：** Skill-only alpha 稳定后，MCP execution through worker 是下一类真实工具执行能力的自然候选。当前 MCP v0 已有 registry、approval、read-only deterministic executor 和 safe `ToolObservationRecord`；worker runtime 已有 queue、payload、logs 和 sandbox policy。下一步应先做 readiness 设计，确认 worker payload、approval、timeout、cancellation、safe observation 和 Web visibility 边界，而不是直接接远端 MCP SDK。

**建议范围：**

- 审计现有 MCP execution、worker queue、ToolCommandRunner 和 observation contract。
- 设计 MCP worker execution v0 的 job payload、approval handoff、timeout/cancel、safe output summary 和 run event mapping。
- 明确 deterministic local test adapter 和 future remote MCP adapter 的边界。

**非目标：**

- 不开放 MCP write tools。
- 不接真实 remote MCP server SDK。
- 不开放真实 shell execution 或 OS-level sandbox。
- 不做 hosted observability、billing/quota 或团队审批队列。
```

In `## 决策记录`, add this bullet at the top:

```markdown
- Stage 39 已完成 LP Artifact Quality Evaluation and Prompt Hardening v0：内部 alpha 现在有 `docs/lp-artifact-quality.md` 质量 rubric、7 个 prompt fixtures、review record 和 safe evidence rules；Planner / Builder structured prompts 增加质量 guidance，但 `LPBriefSchema`、`StaticArtifactsSchema`、三文件静态 artifact policy、provider adapter 和 preview/export contract 不变。
```

- [ ] **Step 5: Update Agent learning note**

In `docs/agent-development-learning.md`, append this sentence to the Stage 39 paragraph added during the design commit:

```markdown
实现完成后，这条边界表现为：prompt 可以提升默认生成质量，rubric 可以稳定记录内部 alpha 观察，但 schema/policy 仍决定什么能进入 artifact workspace。
```

- [ ] **Step 6: Run full verification**

Run:

```bash
pnpm --filter @lp-agent/api test
pnpm alpha:check
pnpm smoke
pnpm test
pnpm typecheck
pnpm build
pnpm alpha:e2e
git diff --check
```

Expected:

- `pnpm --filter @lp-agent/api test`: PASS.
- `pnpm alpha:check`: PASS.
- `pnpm smoke`: PASS.
- `pnpm test`: PASS.
- `pnpm typecheck`: PASS.
- `pnpm build`: PASS.
- `pnpm alpha:e2e`: PASS, unless local browser install, port binding, or sandbox restrictions block it. If blocked, record the exact failure and rerun available focused fallback checks.
- `git diff --check`: no output.

- [ ] **Step 7: Commit closeout**

```bash
git status --short
git add docs/project-roadmap.md docs/superpowers/README.md docs/superpowers/specs/2026-05-23-lp-artifact-quality-prompt-hardening-design.md docs/agent-development-learning.md
git commit -m "close stage 39 artifact quality baseline"
```

Expected: commit succeeds and only the listed closeout docs are staged.
