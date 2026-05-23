# Alpha Feedback Intake and Triage

这份 runbook 用于 Stage 40 之后的内部 alpha feedback intake。它把 `docs/alpha-release-candidate.md` 中的反馈模板变成可重复的收集、脱敏、分类、排序和路由流程。

它不是 hosted issue tracker、public roadmap、SLA、遥测系统或团队审批系统。默认记录在本地 Markdown 中，只保存 safe evidence。

## Scope

适用范围：

- 本地单用户 V1 polished alpha。
- 普通聊天、LP task、artifact workspace、Skills、Models、Web navigation、failure display 和文档反馈。
- deterministic 默认路径和真实 provider opt-in smoke。

不适用范围：

- 不收集 secret、API key、env value、raw provider response、完整 artifact 内容、本机绝对路径、raw worker payload、raw worker output、raw tool payload、raw tool output 或 raw stdout/stderr。
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
- Raw worker output。
- Raw tool payload。
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
