# Stage 43：Run Timeline and Recovery UX Polish v0 设计

**日期：** 2026-05-23
**状态：** 已批准，等待 implementation plan
**关联阶段：** Stage 43

## 背景

Stage 25 已把 `RunLifecycleView` 和 recovery action contract 接到 Web task timeline，Stage 29 已提供 no-refresh live task polling，Stage 42 已把 artifact workspace 变成第一版 Web 的独立工作区。当前 LP 复杂任务虽然能展示 live progress、run 列表和 recovery block，但信息层级仍偏压缩：内部用户需要更快看懂 `Planner -> Builder -> Reviewer -> Deployer` 每一步的状态、失败原因、handoff 位置和可执行恢复动作。

Stage 43 的目标是做 **Web 层 timeline / recovery view-model polish**。本阶段不扩展 agent runtime schema，不引入 SSE，也不把 transient UI 动画写回 repository。Repository facts 仍是唯一事实来源，Web 只从已有 `LiveTaskStatePayload`、`RunLifecycleView`、`LiveTaskRunEvent` 和 `recovery.runs` 派生更清楚的显示模型。

## 用户选择

本阶段采用方案 2：Web UI view-model polish。

- 不改变 `RunEventRecord`、`RunLifecycleView` 或 recovery action contract。
- 不引入 SSE、raw stdout/stderr streaming、MCP streaming、真实 shell runner 或实时多人协作。
- 从已有 safe payload 派生 timeline steps、status badges、repair/retry hints、handoff/recovery hierarchy 和 active progress affordance。
- 保持 bounded diagnostics，不展示 raw provider response、raw tool output、完整 artifact 内容、本机路径或 secret。

未选方案：

- 纯 CSS polish：改动最小，但无法解决 repair/retry history、handoff 层级和 action 归属不清的问题。
- API/schema 扩展：长期可能需要，但 Stage 43 的信息已经能从现有 safe facts 派生；现在扩 schema 会增加迁移和回归风险。

## 目标

- 让 LP task 的固定链路呈现为清晰的四步工程流程：Planner、Builder、Reviewer、Deployer。
- 每一步能区分 `queued`、`running`、`waiting_for_approval`、`blocked`、`cancelling`、`cancelled`、`failed`、`completed`。
- 用户能看出当前 active step、已完成 step、失败/阻塞 step 和是否有 repair/retry history。
- Recovery block 更清楚地区分可执行动作和指导性动作，并把动作归属到具体 run。
- Handoff / deployment handoff / blocked handoff 只展示安全摘要，不展示文件名以外的 artifact 内容或 raw payload。
- Live progress animation 只表达前端 transient state，不成为 repository fact。

## 非目标

- 不做通用 DAG scheduler 或任意 agent graph UI。
- 不改变 run event schema、worker queue schema、handoff schema、recovery action contract 或 model gateway event contract。
- 不做 LP structured output token-level UI。
- 不做 raw stdout/stderr streaming、MCP streaming、真实 shell runner、真实部署编排或实时多人协作。
- 不把 raw model output、raw provider response、raw tool output、完整 artifact 内容、本机路径、secret、API key env name 或 unsafe query echo 进 UI。
- 不把 Stage 45 的 browser failure / visual regression expansion 提前塞进本阶段；本阶段只补必要的 focused browser coverage（如果实现风险需要）。

## 设计

### 1. Timeline view model

新增一个 Web-only pure view-model 层，从现有 `LiveTaskStatePayload` 派生 timeline display：

- 输入：`runs`、`runEvents`、`recovery.runs`、`artifactProgress`、`taskStatus`、`isTerminal`。
- 输出：固定 role 顺序的 timeline steps：`planner`、`builder`、`reviewer`、`deployer`。
- 每个 step 包含 safe label、state、started/completed time、active flag、terminal flag、diagnostic code/message、repair/retry markers、recovery action groups 和最近 safe event label。
- 没有对应 run 的 step 显示为 pending / not started，不制造 repository 事实。

Repair / retry history 只从现有事件和 run ids 派生：

- `model.output.repair_started`、`model.output.repaired`、`model.output.repair_failed` 显示为 repair badge 或 short history label。
- `model.retry.scheduled`、`model.retry.exhausted` 显示为 retry badge 或 exhausted hint。
- `*_retry_N` run id 只用于说明该 run 是 retry attempt；不展示完整内部 id 作为主要 UI 文案。

### 2. UI composition

当前 `page.tsx` 已内联 `RecoveryBlock`，`LiveTaskPanel` 已展示 compact status。Stage 43 应把 timeline / recovery 展示拆成更清楚的局部组件或 helper：

- `RunTimeline`：负责固定链路、step 状态、repair/retry marker、active progress affordance。
- `RecoveryBlock`：继续展示 recovery actions，但按 severity/actionability 提升层级。
- `LiveTaskStatusSummary`：保留 compact summary，同时能展示 active role 的用户可读 label。

组件应继续使用现有 i18n copy 和 CSS 体系，不引入新的 UI framework。视觉上优先做紧凑、可扫描、工作台风格的信息层级：状态点、role label、短诊断、动作按钮和 muted metadata，而不是营销式卡片。

### 3. Recovery hierarchy

Recovery 展示按行动价值排序：

1. 可执行动作：`retry_run`、`resume_worker_finalization`，渲染为 form button，server action 仍重新派生 lifecycle 后执行。
2. 指导动作：`request_approval`、`resolve_blocker`、`inspect_manually`，渲染为非提交 guidance chip / note。
3. 无动作 terminal state：只展示状态和安全诊断。

同一个 run 的 diagnostic message 可以展示；diagnostic 额外字段只允许 `code`、`source`、`eventType`、safe `errorName` 等已经由 API bounded 的字段。测试必须继续证明 raw payload、secret-like 字符串和完整 artifact 内容不会出现在 rendered text。

### 4. Handoff visibility

Stage 43 不新增 handoff API。Web 只从现有 run events / lifecycle diagnostic / artifact progress 表达 handoff 状态：

- Reviewer completed 且 Deployer pending/running 时，显示 deployment handoff 已准备或正在交接的 short label。
- Blocked handoff 仍通过 existing `blocked` lifecycle state 和 `resolve_blocker` guidance 表达。
- Artifact refs 只显示 page version/workspace/file count 等 bounded metadata；不展示 artifact file content。

### 5. Animation boundary

Active step 可以有轻量 CSS animation 或 busy affordance：

- 只根据当前 payload 的 `running`、`queued`、`waiting_for_approval`、`cancelling` 等 transient state 渲染。
- 不写入 store、repository、run event 或 worker log。
- 用户禁用 motion 时应通过 `prefers-reduced-motion` 静止展示。

## 数据流

1. API / store 继续返回 `LiveTaskStatePayload`。
2. Web 纯函数把 payload 派生为 `RunTimelineViewModel`。
3. `RunTimeline` 和 `RecoveryBlock` 渲染 view-model。
4. 可执行 recovery action 仍提交到 `executeRunRecoveryAction` server action。
5. Server action 继续重新读取 repository state、重新派生 lifecycle，再执行允许的 action。
6. 下一轮 page refresh / live polling 回到 repository facts。

这个数据流保证 UI polish 不会成为第二事实源。

## 错误和安全

- Unknown run state 或 role label 应安全降级为 existing state / role string，不抛出页面渲染错误。
- Missing run、missing event、missing artifact progress 应显示 pending / unavailable，不生成假成功。
- Recovery action 不可用时继续走既有 `recoveryError` safe query code。
- Query string 不参与 timeline view-model 派生，避免把 unsafe query value 回显到 timeline。
- 所有 diagnostics、event labels、artifact labels 都必须来自已有 safe payload 或 i18n allowlist。

## 测试策略

本阶段 implementation plan 应按 TDD 拆分，至少覆盖：

- Pure view-model tests：固定 role 顺序、active step、terminal step、pending step、repair/retry badge、blocked/recovery action grouping。
- Page rendering tests：timeline 与 recovery block 同屏展示 Planner / Builder / Reviewer / Deployer lifecycle，且不泄漏 raw diagnostic payload、secret-like string 或完整 artifact 内容。
- Live task summary tests：active role 使用用户可读 label，artifact summary 仍只显示 bounded metadata。
- Focused browser acceptance（如实现影响 browser-visible contract）：覆盖一条 LP live task timeline happy path 和一个 recovery/failure state；Stage 45 再扩展系统性 visual/failure regression。
- 文档同步：`docs/web-v1-acceptance.md`、`docs/alpha-release-candidate.md`、`docs/project-roadmap.md`、`docs/superpowers/README.md`，以及涉及 Agent recovery / timeline 概念时的 `docs/agent-development-learning.md`。

## 成功标准

- LP task 页面能一眼看出固定链路的四个角色、当前 step 和每个 step 的 terminal/active 状态。
- Failed / blocked / cancelled / recovery succeeded paths 的 recovery action hierarchy 更清楚，且 action 仍绑定具体 run。
- Repair / retry history 在 UI 中可见，但不暴露 raw model/provider output。
- Live polling 和 artifact workspace 不回退；repository 仍是唯一事实来源。
- Deterministic tests 和风险相称 browser acceptance 通过。
