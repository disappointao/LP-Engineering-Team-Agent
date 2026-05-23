# Alpha Feedback Intake and Triage Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the RC feedback template into a repeatable alpha feedback intake, triage log, and V1 polished alpha routing process without changing runtime behavior.

**Architecture:** This is a documentation and release-process stage. `docs/alpha-feedback-intake.md` owns the operating procedure, `docs/alpha-feedback-log.md` owns batch records and routing decisions, and `docs/alpha-release-candidate.md` links trial feedback into that loop. `docs/project-roadmap.md` remains the priority source of truth.

**Tech Stack:** Markdown documentation, existing pnpm/Vitest validation gates, deterministic no-key alpha workflow.

---

## File Structure

- Create `docs/alpha-feedback-intake.md`
  - Operator runbook for collecting, sanitizing, categorizing, prioritizing, routing, and closing internal alpha feedback.
- Create `docs/alpha-feedback-log.md`
  - Local feedback batch log with safe evidence rules, status taxonomy, initial V1 polished alpha planning batch, and accepted/rejected routing.
- Modify `docs/alpha-release-candidate.md`
  - Link feedback readiness and trial script to the intake runbook and feedback log.
  - Update suggested routing to Stage 40-46 and backlog.
- Modify `docs/project-roadmap.md`
  - Add Stage 40 design/plan links and clarify that Stage 40 implementation creates the intake/log, not UI fixes.
- Modify `docs/superpowers/README.md`
  - Add this implementation plan to the reading order.
- Modify `docs/superpowers/specs/2026-05-23-v1-polished-alpha-web-completion-design.md`
  - Mark the design as approved after user review.

## Task 1: Add Alpha Feedback Intake Runbook

**Files:**
- Create: `docs/alpha-feedback-intake.md`

- [ ] **Step 1: Run the failing runbook existence check**

Run:

```bash
test -f docs/alpha-feedback-intake.md && rg -n "Intake Rules|Triage Workflow|Safe Evidence" docs/alpha-feedback-intake.md
```

Expected: FAIL with non-zero exit because `docs/alpha-feedback-intake.md` does not exist yet.

- [ ] **Step 2: Create the intake runbook**

Create `docs/alpha-feedback-intake.md` with this content:

```markdown
# Alpha Feedback Intake and Triage

这份 runbook 用于 Stage 40 之后的内部 alpha feedback intake。它把 `docs/alpha-release-candidate.md` 中的反馈模板变成可重复的收集、脱敏、分类、排序和路由流程。

它不是 hosted issue tracker、public roadmap、SLA、遥测系统或团队审批系统。默认记录在本地 Markdown 中，只保存 safe evidence。

## Scope

适用范围：

- 本地单用户 V1 polished alpha。
- 普通聊天、LP task、artifact workspace、Skills、Models、Web navigation、failure display 和文档反馈。
- deterministic 默认路径和真实 provider opt-in smoke。

不适用范围：

- 不收集 secret、API key、env value、raw provider response、完整 artifact 内容、本机绝对路径、raw worker payload、raw tool output 或 raw stdout/stderr。
- 不承诺 public release date、SLA 或客户支持流程。
- 不替代 `docs/project-roadmap.md`；路线优先级仍以 roadmap 为准。

## Intake Rules

每条反馈必须包含：

- Summary。
- Category。
- Severity。
- Environment。
- Steps。
- Expected。
- Actual。
- Safe Evidence。
- Suggested Routing。

如果反馈包含不安全信息，先脱敏再入库；无法安全脱敏时，只记录一条 `redacted_unsafe_evidence` note，不复制原文。

## Safe Evidence

Allowed:

- Command output summary。
- Screenshot description or relative artifact filename。
- Bounded UI message。
- Safe timeline summary。
- Run/event type。
- Artifact filenames。
- Provider api type and model id。
- Browser name/version。
- Commit hash。

Not allowed:

- Secret values or API keys。
- Raw provider response。
- Raw SSE frame。
- Full generated artifact content。
- Local absolute paths。
- Raw worker payload。
- Raw tool output。
- Raw stdout/stderr。
- Private customer data。

## Categories

| Category | Definition | Default routing |
| --- | --- | --- |
| `blocking_bug` | V1 polished alpha 主路径无法完成，或安全边界被破坏。 | `needs_immediate_fix`，必要时暂停 RC。 |
| `ux_friction` | 功能可完成，但交互、文案、状态或视觉层级让试用者误解。 | Stage 41-45，按页面或流程归类。 |
| `provider_config_issue` | 真实 provider opt-in 配置、route、key 或协议排错不清楚。 | Stage 44 或 `docs/real-provider-alpha-smoke.md`。 |
| `artifact_quality_issue` | LP artifact 成功生成，但结构、视觉层级、copy、CTA、响应式或可访问性不达预期。 | Stage 42 或 Stage 43；质量基线参考 `docs/lp-artifact-quality.md`。 |
| `docs_gap` | 文档缺少步骤、命令、前置条件、边界或收口说明。 | Stage 40 或当前阶段文档补丁。 |
| `future_feature` | 明确超出 V1 polished alpha 的能力需求。 | Backlog。 |

## Severity

| Severity | Definition | Action |
| --- | --- | --- |
| `blocker` | 主路径不可用、安全泄漏、默认 gate 失败、或试用目标无法继续。 | 立即标记 `needs_immediate_fix`。 |
| `high` | 高频流程明显受阻，但存在绕行方式。 | 进入下一批修复候选。 |
| `medium` | 可用性、文案、视觉层级或文档摩擦。 | 进入对应 Stage follow-up。 |
| `low` | 小问题、偏好、后续 polish。 | 记录并按批次处理。 |

## Status

| Status | Meaning |
| --- | --- |
| `new` | 已接收，尚未 triage。 |
| `accepted` | 已确认属于 V1 polished alpha 或当前阶段范围。 |
| `needs_repro` | 需要安全复现步骤或 bounded evidence。 |
| `needs_immediate_fix` | 阻塞当前 RC 或破坏安全边界。 |
| `routed` | 已进入明确 Stage 或 backlog。 |
| `rejected_out_of_scope` | 明确不属于 V1 polished alpha。 |
| `done` | 已由后续 commit 或文档更新关闭。 |

## Triage Workflow

1. 收集反馈：要求试用者使用 `docs/alpha-release-candidate.md` 的 Feedback Template。
2. 脱敏：删除或概括所有 unsafe evidence。
3. 分类：设置 category、severity、status 和 suggested routing。
4. 去重：相同 root cause 合并到同一个 feedback id，并在 notes 中追加出现次数。
5. 排序：先处理 `blocker` 和 `high`，再处理高频 `medium`。
6. 路由：把 accepted items 指向 Stage 41-46、backlog 或 `needs_immediate_fix`。
7. 关闭：修复后记录 commit、验证命令和最终状态。

## Routing Guide

| Route | Use when |
| --- | --- |
| Stage 41 | MCP 可见入口、sidebar/top-level navigation、V1 Web surface 边界。 |
| Stage 42 | Artifact workspace、preview、bounded snippet、export、安全失败状态。 |
| Stage 43 | Run timeline、handoff、recovery、progress animation、failure hierarchy。 |
| Stage 44 | Skills/Models client-side management、provider opt-in、safe config errors。 |
| Stage 45 | Browser failure injection、visual regression、geometry/layout contract。 |
| Stage 46 | V1 completion gate、RC decision、known limitations、最终验收。 |
| Backlog | MCP management、真实 MCP SDK/write tools、auth/RBAC、billing/quota、真实 shell、真实部署、hosted observability。 |
| needs_immediate_fix | blocker、安全泄漏、默认 gate 失败或主路径无法完成。 |

## Batch Review

每个 feedback batch 应记录：

- Batch id。
- Date range。
- Operator。
- Source trial。
- Automated gates summary。
- New items count。
- Blockers。
- Accepted follow-ups。
- Rejected/out-of-scope items。
- Next routing decision。

默认每轮内部试用后做一次 batch review。没有真实试用时，可以用 planning batch 记录用户明确优先级变化。
```

- [ ] **Step 3: Verify the runbook content**

Run:

```bash
rg -n "Intake Rules|Triage Workflow|Stage 41|needs_immediate_fix|Not allowed" docs/alpha-feedback-intake.md
```

Expected: PASS with matches for the intake rules, workflow, routing, blocker status, and unsafe evidence section.

- [ ] **Step 4: Commit the runbook**

Run:

```bash
git add docs/alpha-feedback-intake.md
git commit -m "add alpha feedback intake runbook"
```

Expected: commit succeeds.

## Task 2: Add Alpha Feedback Log

**Files:**
- Create: `docs/alpha-feedback-log.md`

- [ ] **Step 1: Run the failing feedback log existence check**

Run:

```bash
test -f docs/alpha-feedback-log.md && rg -n "AF-2026-05-23-001|V1 polished alpha planning batch|Rejected or Out of Scope" docs/alpha-feedback-log.md
```

Expected: FAIL with non-zero exit because `docs/alpha-feedback-log.md` does not exist yet.

- [ ] **Step 2: Create the feedback log**

Create `docs/alpha-feedback-log.md` with this content:

```markdown
# Alpha Feedback Log

这份日志记录内部 V1 polished alpha feedback batch。所有条目必须遵守 `docs/alpha-feedback-intake.md` 的 safe evidence 规则。

不要在本文件保存 secret、raw provider response、完整 artifact 内容、本机绝对路径、raw worker payload、raw tool output、raw stdout/stderr 或不可脱敏日志。

## Status Legend

| Status | Meaning |
| --- | --- |
| `new` | 已接收，尚未 triage。 |
| `accepted` | 已确认属于 V1 polished alpha 或当前阶段范围。 |
| `needs_repro` | 需要安全复现步骤或 bounded evidence。 |
| `needs_immediate_fix` | 阻塞当前 RC 或破坏安全边界。 |
| `routed` | 已进入明确 Stage 或 backlog。 |
| `rejected_out_of_scope` | 明确不属于 V1 polished alpha。 |
| `done` | 已由后续 commit 或文档更新关闭。 |

## Batch: 2026-05-23 V1 polished alpha planning batch

- Batch id: `batch_2026_05_23_v1_polished_alpha_planning`
- Date range: 2026-05-23
- Operator: local maintainer
- Source trial: planning discussion after Stage 39
- Automated gates summary: not run for this planning batch; Stage 39 final gates were already complete before this roadmap update.
- New items count: 6
- Blockers: none
- Next routing decision: keep Stage 40 feedback intake first, then route Web polish through Stage 41-46.

### AF-2026-05-23-001

- Summary: First-version Web scope should become V1 polished alpha instead of stopping at core local alpha.
- Category: `ux_friction`
- Severity: `high`
- Status: `routed`
- Environment:
  - Commit: `a446fad`
  - Date: 2026-05-23
  - Browser: not applicable
  - Runtime mode: not applicable
- Safe Evidence:
  - User decision: choose V1 polished alpha scope.
  - Related spec: `docs/superpowers/specs/2026-05-23-v1-polished-alpha-web-completion-design.md`
- Suggested Routing: Stage 40-46
- Decision: accepted. Roadmap should plan to V1 completion, not only the next single stage.

### AF-2026-05-23-002

- Summary: Keep feedback intake before Web polish work.
- Category: `docs_gap`
- Severity: `medium`
- Status: `routed`
- Environment:
  - Commit: `a446fad`
  - Date: 2026-05-23
  - Browser: not applicable
  - Runtime mode: not applicable
- Safe Evidence:
  - User decision: choose feedback gate plus Web polish trains.
- Suggested Routing: Stage 40
- Decision: accepted. Stage 40 creates this intake/log process before UI implementation.

### AF-2026-05-23-003

- Summary: Hide MCP management and Web tab/sidebar/top-level entry from first-version Web.
- Category: `future_feature`
- Severity: `high`
- Status: `routed`
- Environment:
  - Commit: `a446fad`
  - Date: 2026-05-23
  - Browser: not applicable
  - Runtime mode: not applicable
- Safe Evidence:
  - User decision: MCP management and Web visible entry move to later work.
- Suggested Routing: Stage 41 and backlog
- Decision: accepted. Stage 41 hides MCP Web surface; backend MCP capabilities remain in backlog.

### AF-2026-05-23-004

- Summary: Add a dedicated artifact workspace to first-version Web.
- Category: `artifact_quality_issue`
- Severity: `high`
- Status: `routed`
- Environment:
  - Commit: `a446fad`
  - Date: 2026-05-23
  - Browser: not applicable
  - Runtime mode: not applicable
- Safe Evidence:
  - User decision: Dedicated artifact workspace should be part of V1 polished alpha.
- Suggested Routing: Stage 42
- Decision: accepted. Stage 42 owns artifact workspace page/view.

### AF-2026-05-23-005

- Summary: Improve run timeline, progress animation, handoff, and recovery UX before V1 completion.
- Category: `ux_friction`
- Severity: `high`
- Status: `routed`
- Environment:
  - Commit: `a446fad`
  - Date: 2026-05-23
  - Browser: not applicable
  - Runtime mode: not applicable
- Safe Evidence:
  - User decision: advanced no-refresh workbench interaction and recovery UX enter V1.
- Suggested Routing: Stage 43
- Decision: accepted. Stage 43 owns timeline/recovery polish.

### AF-2026-05-23-006

- Summary: Include Skills and Models client-side management in V1, excluding MCP management.
- Category: `ux_friction`
- Severity: `medium`
- Status: `routed`
- Environment:
  - Commit: `a446fad`
  - Date: 2026-05-23
  - Browser: not applicable
  - Runtime mode: not applicable
- Safe Evidence:
  - User decision: Skills/Models management enters V1; MCP management remains later.
- Suggested Routing: Stage 44
- Decision: accepted. Stage 44 owns Skills/Models client-side management.

## Accepted Follow-ups

| Feedback id | Route | Follow-up |
| --- | --- | --- |
| AF-2026-05-23-001 | Stage 40-46 | Keep V1 polished alpha as first-version Web completion scope. |
| AF-2026-05-23-002 | Stage 40 | Create feedback intake/log process. |
| AF-2026-05-23-003 | Stage 41 | Hide MCP Web surface and route MCP management to backlog. |
| AF-2026-05-23-004 | Stage 42 | Build dedicated artifact workspace. |
| AF-2026-05-23-005 | Stage 43 | Polish run timeline and recovery UX. |
| AF-2026-05-23-006 | Stage 44 | Polish Skills/Models client-side management. |

## Rejected or Out of Scope

| Item | Reason | Route |
| --- | --- | --- |
| MCP management in V1 Web | User explicitly moved MCP management and visible Web entry to later work. | Backlog |
| Remote MCP SDK/write tools in V1 | Outside V1 polished alpha and requires separate worker/approval/sandbox design. | Backlog |
| Production auth/RBAC in V1 | Outside local single-user alpha. | Backlog |
| Billing/quota/cost ledger in V1 | Outside local single-user alpha. | Backlog |
| Real shell runner in V1 | Requires stronger sandbox and explicit execution policy. | Backlog |
| Hosted observability in V1 | Outside local deterministic alpha gates. | Backlog |

## Next Review

- Next batch trigger: after Stage 40 implementation or first internal V1 polished alpha trial.
- Required review inputs:
  - `docs/alpha-release-candidate.md` feedback template submissions.
  - Safe command summaries.
  - Browser acceptance output summaries.
  - Manual artifact quality rubric summaries when relevant.
- Default next route: Stage 41 Web Surface Pruning and V1 Navigation v0.
```

- [ ] **Step 3: Verify the feedback log content**

Run:

```bash
rg -n "AF-2026-05-23-003|Stage 41|Stage 44|Rejected or Out of Scope|MCP management in V1 Web" docs/alpha-feedback-log.md
```

Expected: PASS with matches for MCP routing, Stage 41, Stage 44, and out-of-scope decisions.

- [ ] **Step 4: Commit the feedback log**

Run:

```bash
git add docs/alpha-feedback-log.md
git commit -m "add alpha feedback log"
```

Expected: commit succeeds.

## Task 3: Wire Release Candidate Feedback to Intake

**Files:**
- Modify: `docs/alpha-release-candidate.md`

- [ ] **Step 1: Run the failing RC intake link check**

Run:

```bash
rg -n "docs/alpha-feedback-intake.md|docs/alpha-feedback-log.md|Stage 46" docs/alpha-release-candidate.md
```

Expected: FAIL before edits because the RC doc does not yet link the Stage 40 intake/log or Stage 46 routing.

- [ ] **Step 2: Update the intro**

In `docs/alpha-release-candidate.md`, replace the paragraph:

```markdown
详细人工验收继续使用 `docs/web-v1-acceptance.md`。真实 provider 手动 smoke 继续使用 `docs/real-provider-alpha-smoke.md`。本文只负责编排 go/no-go、试用脚本、反馈模板和 triage 分类。
```

with:

```markdown
详细人工验收继续使用 `docs/web-v1-acceptance.md`。真实 provider 手动 smoke 继续使用 `docs/real-provider-alpha-smoke.md`。本文负责编排 go/no-go、试用脚本、反馈模板和 triage 分类；反馈进入 `docs/alpha-feedback-intake.md` 和 `docs/alpha-feedback-log.md`，由 Stage 40 之后的批次化流程维护。
```

- [ ] **Step 3: Update the Feedback readiness gate**

In the `Go/No-go Gates` table, replace the `Feedback readiness` row with:

```markdown
| Feedback readiness | 试用者使用本文反馈模板；operator 按 `docs/alpha-feedback-intake.md` 脱敏、分类并记录到 `docs/alpha-feedback-log.md`。 | 反馈需要收集 secret、完整 artifact、raw provider body、本机路径或不可脱敏日志。 |
```

- [ ] **Step 4: Add intake/log to the trial script**

After the existing optional real provider step, add a new numbered step:

```markdown
11. Feedback intake：
   - 使用本文 Feedback Template 收集反馈。
   - 按 `docs/alpha-feedback-intake.md` 脱敏和分类。
   - 将 accepted / rejected / routed items 写入 `docs/alpha-feedback-log.md`。
```

- [ ] **Step 5: Update Suggested Routing values**

In the Feedback Template, replace:

```markdown
Stage 38 | Stage 39 | Stage 40 | backlog | needs immediate fix
```

with:

```markdown
Stage 40 | Stage 41 | Stage 42 | Stage 43 | Stage 44 | Stage 45 | Stage 46 | backlog | needs immediate fix
```

- [ ] **Step 6: Update Triage Categories routing**

Replace the `Triage Categories` table with:

```markdown
| Category | Definition | Examples | Default routing |
| --- | --- | --- | --- |
| `blocking_bug` | RC 主路径无法完成，或安全边界被破坏。 | 普通聊天无法完成；LP task 不生成 artifact；secret/raw provider response 出现在 UI。 | `needs immediate fix`，必要时暂停 RC。 |
| `ux_friction` | 功能可完成，但交互、文案、状态或视觉层级让试用者误解。 | 用户不知道任务还在跑；失败文案无法区分 provider 配置和 stream 中断。 | Stage 41-45，按页面或流程归类。 |
| `provider_config_issue` | 真实 provider opt-in 配置或排错不清楚。 | `apiKeyEnv` 填写误解；protocol mismatch 不知道怎么恢复。 | Stage 44 或 `docs/real-provider-alpha-smoke.md`。 |
| `artifact_quality_issue` | LP artifact 生成成功，但质量、响应式、copy、CTA 或可访问性不达预期。 | 首屏层级弱；移动端拥挤；CTA 不明确。 | `docs/lp-artifact-quality.md` + Stage 42/43。 |
| `docs_gap` | 文档缺少步骤、命令、前置条件或边界说明。 | 不知道先跑 `pnpm alpha:e2e:install`；不清楚如何 reset deterministic。 | Stage 40 或当前阶段文档补丁。 |
| `future_feature` | 明确超出当前 RC 的能力需求。 | 团队登录、真实部署、MCP management/write tools、billing、远端 observability。 | Backlog，不阻塞 RC。 |
```

- [ ] **Step 7: Update Follow-up Routing**

Replace the `Follow-up Routing` list with:

```markdown
- Stage 40：反馈 intake/triage loop，把本文模板变成批次化 issue review、known issues 和修复优先级。
- Stage 41：Web surface pruning，隐藏 MCP management 和 MCP tab/sidebar/top-level 入口，收紧 V1 navigation。
- Stage 42：Dedicated artifact workspace，覆盖 manifest、preview、bounded snippet、export 和安全失败状态。
- Stage 43：Run timeline、handoff、recovery UX polish 和 progress visual hierarchy。
- Stage 44：Skills / Models client-side management，继续排除 MCP management。
- Stage 45：Browser failure injection 和轻量视觉回归扩展。
- Stage 46：V1 polished alpha completion gate、RC decision record 和最终验收。
- Backlog：MCP management、production auth/RBAC、真实部署、MCP SDK/write tools、object storage、billing/quota、真实 shell runner、hosted observability。
```

- [ ] **Step 8: Verify the RC intake links**

Run:

```bash
rg -n "docs/alpha-feedback-intake.md|docs/alpha-feedback-log.md|Stage 46|MCP management" docs/alpha-release-candidate.md
```

Expected: PASS with links to intake/log, Stage 46 routing, and MCP management backlog text.

- [ ] **Step 9: Commit the RC wiring**

Run:

```bash
git add docs/alpha-release-candidate.md
git commit -m "route alpha feedback through intake log"
```

Expected: commit succeeds.

## Task 4: Update Roadmap, Superpowers Index, and Approved Spec Status

**Files:**
- Modify: `docs/project-roadmap.md`
- Modify: `docs/superpowers/README.md`
- Modify: `docs/superpowers/specs/2026-05-23-v1-polished-alpha-web-completion-design.md`

- [ ] **Step 1: Run the failing plan index check**

Run:

```bash
rg -n "2026-05-23-alpha-feedback-intake-triage.md|实施计划：.*alpha-feedback-intake" docs/project-roadmap.md docs/superpowers/README.md
```

Expected: FAIL before edits because the implementation plan is not indexed yet.

- [ ] **Step 2: Mark the approved design**

In `docs/superpowers/specs/2026-05-23-v1-polished-alpha-web-completion-design.md`, replace:

```markdown
**状态：** 待评审
```

with:

```markdown
**状态：** 已批准，等待 Stage 40 implementation
```

- [ ] **Step 3: Add the Stage 40 plan link to roadmap**

In `docs/project-roadmap.md`, under the Stage 40 non-goals list, add:

```markdown
**设计：** `docs/superpowers/specs/2026-05-23-v1-polished-alpha-web-completion-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-23-alpha-feedback-intake-triage.md`。
```

- [ ] **Step 4: Add the plan to Superpowers README**

In `docs/superpowers/README.md`, after entry 108, add:

```markdown
109. `plans/2026-05-23-alpha-feedback-intake-triage.md`
   - Stage 40 Alpha Feedback Intake and Triage Loop v0 implementation plan（待执行）。
   - 在 V1 polished alpha design 后阅读，用于创建 `docs/alpha-feedback-intake.md`、`docs/alpha-feedback-log.md`，并把 RC feedback template 路由到 Stage 40-46 / backlog 的批次化流程。
```

- [ ] **Step 5: Verify roadmap and index links**

Run:

```bash
rg -n "alpha-feedback-intake-triage|V1 polished alpha design|Stage 40 Alpha Feedback" docs/project-roadmap.md docs/superpowers/README.md docs/superpowers/specs/2026-05-23-v1-polished-alpha-web-completion-design.md
```

Expected: PASS with matches in roadmap, README, and the approved spec.

- [ ] **Step 6: Commit roadmap and index updates**

Run:

```bash
git add docs/project-roadmap.md docs/superpowers/README.md docs/superpowers/specs/2026-05-23-v1-polished-alpha-web-completion-design.md
git commit -m "index alpha feedback intake plan"
```

Expected: commit succeeds.

## Task 5: Validate Stage 40 Documentation Plan

**Files:**
- All files changed in Tasks 1-4.

- [ ] **Step 1: Run focused documentation checks**

Run:

```bash
rg -n "docs/alpha-feedback-intake.md|docs/alpha-feedback-log.md|Stage 41|Stage 46|needs immediate fix" docs/alpha-release-candidate.md docs/project-roadmap.md docs/superpowers/README.md docs/alpha-feedback-intake.md docs/alpha-feedback-log.md
```

Expected: PASS with matches for intake/log links, Stage 41/46 routing, and immediate-fix routing.

- [ ] **Step 2: Run unsafe evidence wording check**

Run:

```bash
rg -n "raw provider response|完整 artifact|本机绝对路径|raw worker payload|raw tool output|secret" docs/alpha-feedback-intake.md docs/alpha-feedback-log.md docs/alpha-release-candidate.md
```

Expected: PASS with matches only in safe-evidence exclusion rules or no-go conditions.

- [ ] **Step 3: Run diff whitespace check**

Run:

```bash
git diff --check
```

Expected: PASS with no output.

- [ ] **Step 4: Run regression tests**

Run:

```bash
pnpm test
```

Expected: PASS. Baseline before this plan was 1137 passed and 2 skipped.

- [ ] **Step 5: Commit any missed docs-only fixes**

If Steps 1-4 required edits, commit them:

```bash
git add docs/alpha-feedback-intake.md docs/alpha-feedback-log.md docs/alpha-release-candidate.md docs/project-roadmap.md docs/superpowers/README.md docs/superpowers/specs/2026-05-23-v1-polished-alpha-web-completion-design.md
git commit -m "tighten alpha feedback intake docs"
```

Expected: either no changes remain, or the cleanup commit succeeds.

- [ ] **Step 6: Final status check**

Run:

```bash
git status --short
```

Expected: clean working tree.
