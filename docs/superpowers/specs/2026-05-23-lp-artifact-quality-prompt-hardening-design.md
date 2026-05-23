# Stage 39：LP Artifact Quality Evaluation and Prompt Hardening v0 Design

**日期：** 2026-05-23

**状态：** 设计已确认，实施计划已创建，待实现。

## 背景

Stage 28-38 已经把 Web/API 第一版可用闭环推进到本地内部 alpha：普通聊天可以 streaming，LP 复杂任务走固定 `Planner -> Builder -> Reviewer -> Deployer` 链路，真实 provider 可以显式 opt in，生成结果保持 `index.html`、`styles.css`、`script.js` 三文件静态 artifact。

当前剩余问题不是“能不能生成 artifact”，而是内部 alpha 需要判断复杂 LP 任务的输出质量是否稳定可用。现有 Builder policy 重点保证安全和 framework-free：拒绝外部 JavaScript、CSS framework、inline event handler、`javascript:` URL、framework markers、缺失本地 `styles.css` / `script.js` marker 等。这些 policy 必须保留，但它们不能判断视觉层级、CTA 是否清晰、移动端布局是否合理、copy 是否具体、基础可访问性是否到位。

Stage 39 v0 要补一套轻量质量基线，让内部试用反馈能被稳定记录、比较和分流，同时对 Planner / Builder prompt 做小范围 hardening，提高真实 provider 生成 artifact 的默认质量。

## 目标

1. 建立 LP artifact 质量评审入口，包含 5-8 个代表性 prompt fixtures、人工 rubric 和评审记录模板。
2. 明确 artifact quality 和 artifact policy 的分工：
   - policy 是 fail-closed 安全边界，继续由代码强制执行；
   - quality 是 alpha 评审基线，v0 由人工按 rubric 记录，不阻塞默认 deterministic gates。
3. 对 Planner prompt 做小范围 hardening，让 `LPBriefSchema` 输出更利于 Builder 生成高质量页面：
   - 明确目标受众、offer、CTA、section hierarchy、responsive hints、accessibility notes 和 copy specificity；
   - 要求 sections 覆盖 hero、benefits 或 value props、proof、faq 或 risk reducer、final CTA 等常见 LP 结构；
   - 保持 strict JSON-only 输出和现有 schema。
4. 对 Builder prompt 和 repair prompt 做小范围 hardening：
   - 强调首屏视觉层级、语义 HTML、移动端优先、清晰 CTA、基础 focus/hover 状态、alt text、可读 copy 和 responsive CSS；
   - 继续禁止 framework、external JavaScript、CSS framework、inline event handler、raw prose 和 Markdown fences；
   - 不改变 `StaticArtifactsSchema` 或 artifact policy。
5. 增加 focused tests，锁住 prompt hardening 文案和安全禁令，避免后续 prompt 调整误删质量要求或 framework-free 约束。

## 非目标

- 不做自动视觉评分、pixel-perfect screenshot baseline、LLM-as-judge production gate 或 provider 自动 E2E。
- 不引入图片生成 pipeline、设计系统重写、组件库或 CSS framework。
- 不改变 `LPBriefSchema`、`StaticArtifactsSchema`、artifact workspace、preview/export、provider adapter 或 repair loop 结构。
- 不把质量 rubric 变成 public SaaS onboarding、客户验收 SLA 或 release blocker。
- 不在本阶段修复内部 RC 后的所有 artifact quality feedback；Stage 40/41 继续负责反馈 intake 和修复批次。

## 方案

### 1. 质量基线文档

新增 `docs/lp-artifact-quality.md`，作为内部 alpha artifact quality 入口。它应包含：

- 5-8 个代表性 prompt fixtures：
  - 电商活动：限时促销、商品卡片、价格/权益和强 CTA。
  - B2B SaaS：价值主张、功能分层、证据和 demo CTA。
  - 活动报名：时间地点、议程、讲师或亮点、报名 CTA。
  - 本地服务：地域信任、服务范围、评价和预约 CTA。
  - 移动端优先：短首屏、单列布局、sticky 或重复 CTA 的人工检查点。
  - 中英混合输入：中文需求中夹带英文品牌/产品名，检查语言保持和 copy 自然度。
  - 继续优化场景：基于已有页面要求更强 CTA、FAQ 或 social proof。
- Rubric 维度：
  - Structure：首屏、主体区块、proof/risk reducer、final CTA 是否完整。
  - Visual hierarchy：headline、subcopy、CTA、卡片/区块层次是否清楚。
  - CTA：主要 CTA 是否明确、重复位置合理、href 和 intent 一致。
  - Responsive：移动端单列、触控目标、文本换行和 layout overflow。
  - Accessibility：语义 HTML、alt text、label、focus visible、颜色对比人工检查。
  - Copy quality：具体、少空话、符合 audience/offer/tone。
  - Safety and contract：framework-free、三文件静态 artifact、安全资源边界。
- 评审记录模板：commit、runtime mode、provider、prompt fixture、artifact filenames、rubric score、safe evidence、follow-up routing。
- 安全证据规则：只记录 bounded snippet、screenshot 描述、run/event type 和文件名；不保存 secret、raw provider response、完整 artifact 内容、本机绝对路径、raw worker payload 或 raw tool output。

### 2. Planner prompt hardening

`createStructuredLPBriefPlannerPrompt()` 保持 strict JSON-only，但 compact guide 增加质量导向指令：

- 要求 brief 把模糊用户请求转成可执行 LP 结构，而不是泛泛总结。
- Sections 至少应覆盖清晰 hero、benefits/value props、proof 或 trust、FAQ/risk reducer、final CTA；如果用户请求明显不适合某类 section，可以用等价 `custom` section 表达。
- `layoutHints` 应写出移动端和桌面端的布局意图，例如 single-column mobile、two-column hero、card grid、sticky/repeated CTA 等。
- `validationRules` 和 `complianceNotes` 用于记录基础可访问性、claim caution、required CTA 和 content constraints。
- `assets.alt`、section media 和 product data 应支持 Builder 输出可访问页面。

Repair prompt 同步保留这些质量提醒，避免 repair 只补 schema 字段而丢失 LP 结构意图。

### 3. Builder prompt hardening

`createStructuredStaticArtifactsBuilderPrompt()` 保持 `indexHtml`、`stylesCss`、`scriptJs` 三键 JSON-only contract，但增加质量要求：

- `indexHtml` 使用语义结构：`header` / `main` / `section` / `footer`，CTA 使用可识别链接或按钮样式元素。
- Hero 必须有清晰 headline、supporting copy、primary CTA 和可扫描的 offer/value signal。
- CSS 采用移动端优先 responsive layout，并包含桌面增强 media query；常见卡片/grid/section spacing 需要稳定，避免 text overflow。
- 基础交互只放在 local `script.js`，用于安全的 progressive enhancement，例如 CTA tracking 或 FAQ toggle；不使用 inline event handlers。
- 样式包含 visible focus、hover/active states、合理 line-height 和 readable contrast guidance。
- 图片如存在必须有 alt text；没有图片时用结构和 copy 支撑页面，而不是依赖外部资产。

Repair prompt 继续不包含 raw bad artifact output，只包含 failure summary 和 `LPBrief JSON`，同时提醒修复后仍要满足质量要求和安全禁令。

### 4. 测试策略

新增或扩展 focused Vitest：

- `packages/api/src/structured-lp-brief.test.ts`
  - Planner prompt 包含 quality directives，例如 section hierarchy、responsive layout hints、accessibility notes、specific copy。
  - Planner repair prompt 也包含同类 quality directives，并继续不包含 raw model output 或 Markdown fences。
- `packages/api/src/structured-static-artifacts.test.ts`
  - Builder prompt 包含 semantic HTML、hero hierarchy、mobile-first responsive CSS、focus states、alt text、no inline handlers 等要求。
  - Builder repair prompt 包含 quality repair guidance，并继续不包含 raw artifact output、external JavaScript 示例或 secrets。
- 如新增 `docs/lp-artifact-quality.md`，用轻量文档测试或现有 smoke 之外的 focused test 检查 fixture 数量、rubric 维度和安全证据规则。若不增加文档 parser，至少在 implementation plan 中用 `rg` / `pnpm test` 验证文档存在关键 heading 和 categories。

### 5. 文档和收尾

实现阶段需要同步更新：

- `docs/lp-artifact-quality.md`：新增质量评审入口。
- `docs/alpha-release-candidate.md`：把 `artifact_quality_issue` 路由到新文档，并在 operator trial 中引用 quality spot-check。
- `docs/real-provider-alpha-smoke.md`：在 LP Planner/Builder smoke 后提醒可用 quality fixtures 做人工评审，不收集 raw provider output。
- `docs/project-roadmap.md`：Stage 39 完成状态、Stage 40/41/后续推荐队列。
- `docs/superpowers/README.md`：新增 Stage 39 spec/plan 索引。
- `docs/agent-development-learning.md`：补充 artifact quality rubric 与 fail-closed artifact policy 的边界。

## 验证

最终实现至少运行：

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

如 `pnpm alpha:e2e` 因本地 browser install、端口或 sandbox 限制失败，应记录具体失败原因，并运行可用的 focused fallback tests。
