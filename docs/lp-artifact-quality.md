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
- Screenshot description or path:
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
- Screenshot path or short visual description.
- Bounded snippet summary.
- Run/event type.
- Artifact filenames.
- Provider api type and model id.

Not allowed:

- Secret values or API keys.
- Raw provider response.
- Full generated artifact content.
- Local absolute paths outside an intentional screenshot path.
- Raw worker payload.
- Raw tool output.
- Raw stdout/stderr.

## Relationship to Artifact Policy

Artifact policy remains a code-enforced safety boundary. It rejects unsafe or out-of-contract artifacts. This rubric is a human quality baseline for internal alpha review. A page can pass policy and still receive a low quality score; a page that violates policy should be treated as a blocking bug rather than only a quality issue.
