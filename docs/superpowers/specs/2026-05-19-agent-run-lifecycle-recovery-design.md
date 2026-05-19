# Agent Run Lifecycle and Recovery v0 设计

## 摘要

Stage 18 给现有 run orchestration、worker queue、tool observation 和 handoff
状态补一个统一的 lifecycle / recovery 派生层。它不替换当前
`runAgentStep()`，也不引入通用 DAG scheduler，而是在 API 边界提供一个可测试的
`RunLifecycleView`：从已有 `RunRecord`、ordered run events、linked worker job、
tool observation 和 handoff 记录派生当前状态、失败诊断和最小恢复动作。

这一阶段的目标是让 Agent run 不只是“有事件记录”，而是能回答三个问题：

1. 当前 run 到底处于什么 lifecycle 状态？
2. 如果失败或阻塞，用户和后续 Agent 应该看到什么安全诊断？
3. 系统后续可以 retry、resume、request approval，还是必须人工处理？

## 背景

当前项目已经具备以下能力：

- deterministic Planner / Builder / Reviewer / Deployer run records；
- ordered run events；
- Context Pack v0；
- fixed LP handoff state；
- worker job persistence、cancel / interrupt、claim-token queue handoff；
- Web queued skill command 和 local worker run-once finalization；
- tool observations；
- artifact workspace 和 bounded artifact reader。

这些能力已经能支持刷新后看到 timeline，但状态语义仍分散：

- `RunRecord.state` 只记录当前写入的 run 状态；
- runtime `RunState` 仍包含 `queued`、`needs_input`、`needs_approval` 等旧语义；
- worker job 有自己的 `queued`、`running`、`cancelled`、`failed` 等状态；
- handoff 可以是 `ready`、`blocked`、`consumed`；
- tool observation 也有 `running`、`completed`、`failed`、`cancelled`；
- failed run 的错误原因需要从 run event、tool observation、worker job summary 或
  model parse event 中推断。

Stage 18 先把这些状态统一成一个派生 view。后续 Stage 19 worker daemon、Stage 20
MCP execution 和 Stage 21 model retry / fallback 都应该复用这个 view，而不是各自
重新推断 run 状态。

## 目标

1. 定义标准 run lifecycle view 状态：
   - `queued`
   - `running`
   - `waiting_for_approval`
   - `blocked`
   - `cancelling`
   - `cancelled`
   - `failed`
   - `completed`
2. 新增 API 侧 helper，从 repository state 派生 `RunLifecycleView`。
3. 从 terminal events、model parse failure、tool observation、worker job summary 和
   blocked handoff 中生成安全 `diagnosticSummary`。
4. 输出最小 recovery action contract，例如 `retry_run`、`resume_worker_finalization`、
   `request_approval`、`resolve_blocker`、`inspect_manually`。
5. 强化 worker-backed skill command finalizer 的幂等语义，重复 finalization 不重复写
   terminal events，不覆盖不匹配的 terminal state。
6. 为后续 UI、daemon、MCP execution 和 model retry 提供稳定 contract，但本阶段不实现
   这些后续能力。
7. 文档化 task、run、handoff、worker job 和 tool observation 的关系。

## 非目标

Stage 18 不做：

- Web UI overhaul；
- streaming UI；
- browser E2E；
- MCP execution；
- 真实 shell execution；
- worker daemon；
- heartbeat 或 stale claim recovery；
- 真实 deployment runner；
- general agent swarm；
- 任意 DAG scheduler；
- 自动重跑 Planner / Builder / Reviewer / Deployer；
- 自动修复 invalid model output；
- Postgres repository 实现；
- 真实多用户 auth / RBAC。

## 用户结果

完成后，开发者和后续 Agent 应该能：

1. 读取任意 run 的 lifecycle view，而不用手写状态推断。
2. 区分 `running`、`cancelling`、`waiting_for_approval`、`blocked`、`failed` 和
   `cancelled`。
3. 在 failed / blocked run 上看到安全诊断摘要，而不是只能看到一条粗粒度
   `run.failed`。
4. 知道某个 run 是否可 retry、可 resume finalization、需要 approval、需要解决
   handoff blocker，还是只能人工检查。
5. 重复运行 worker finalizer 时得到稳定结果，不制造重复 terminal events。

## 推荐方案

采用小的 `run-lifecycle` / recovery 边界：

- 新增 `packages/api/src/run-lifecycle.ts`；
- 只读现有 repositories；
- 不新增数据库表；
- 不迁移历史 JSON-file state；
- 不把所有派生状态都写回 `RunRecord`；
- 只在 worker finalizer 这类已有写路径上补幂等行为。

备选方案 1 是只扩展 `RunRecordState` 和现有 finalizer。它最快，但状态判断会继续散落
在 service、Web、worker 和 future MCP 代码中。

备选方案 2 是直接实现通用 scheduler / retry engine。它对当前 MVP 过重，也会过早引入
general DAG 和自动重跑语义。

## Lifecycle View

新增类型建议放在 `packages/api/src/run-lifecycle.ts`：

```ts
export type RunLifecycleState =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "blocked"
  | "cancelling"
  | "cancelled"
  | "failed"
  | "completed";

export type RunRecoveryAction =
  | "retry_run"
  | "resume_worker_finalization"
  | "request_approval"
  | "resolve_blocker"
  | "inspect_manually";

export interface RunDiagnosticSummary {
  code: string;
  message: string;
  source:
    | "run_event"
    | "model_parse"
    | "tool_observation"
    | "worker_job"
    | "handoff"
    | "lifecycle";
  eventType?: string;
  errorName?: string;
}

export interface RunLifecycleView {
  runId: string;
  projectId: string;
  taskId?: string;
  role: AgentRole;
  state: RunLifecycleState;
  runRecordState: RunRecordState;
  startedAt: string;
  completedAt?: string;
  terminalEventType?: string;
  linkedWorkerJobId?: string;
  linkedObservationId?: string;
  blockedReason?: string;
  diagnosticSummary?: RunDiagnosticSummary;
  recoveryActions: RunRecoveryAction[];
}
```

`RunLifecycleView` 是派生对象，不是新的持久化事实。`RunRecord` 继续保存已存在的
状态，避免 JSON-file repository 和历史测试需要迁移。

## 状态关系模型

Stage 18 对现有实体的关系采用只读解释，不引入新的 ownership 表：

- task 是用户可见的工作线程；一个 task 可以关联多个 role run。
- run 是某个 role 的一次执行尝试；run event 是这个尝试的 ordered timeline。
- handoff 是 role 之间的结构化交接状态；blocked handoff 会影响目标 run 的可见
  lifecycle，但不等于目标 run 已经执行失败。
- worker job 是工具或 skill command 的执行状态；它通过 `worker.job.linked` event
  和 run / task 建立关联。
- tool observation 是工具调用的安全结果摘要；它通过 `runId` 和可选 `taskId` 关联到
  run / task，并通过 event payload 中的 `observationId` 与 worker terminal event 对齐。

派生 lifecycle 时，run event 是主时间线，worker job 和 tool observation 是执行事实，
handoff 是 role 协作事实。任何一个来源缺失或冲突时，helper 必须保守处理，而不是用
另一个来源强行制造成功状态。

## 状态派生规则

状态派生优先级从最确定到最弱：

1. 如果 terminal run event 存在且不冲突：
   - `run.completed` -> `completed`
   - `run.cancelled` -> `cancelled`
   - `run.failed` -> `failed`
2. 如果存在多个互相冲突的 terminal run events：
   - state 派生为 `failed`；
   - `diagnosticSummary.code` 为 `inconsistent_terminal_events`；
   - recovery action 只给 `inspect_manually`。
3. 如果 linked worker job 仍在 `queued`：
   - state 为 `queued`；
   - recovery action 可包含 `inspect_manually`，但不自动执行。
4. 如果 linked worker job 在 `running` 且有 `cancelRequestedAt`：
   - state 为 `cancelling`。
5. 如果 linked worker job 在 `running` 且没有取消请求：
   - state 为 `running`。
6. 如果 `RunRecord.state` 是 `needs_approval`：
   - view state 为 `waiting_for_approval`；
   - recovery action 包含 `request_approval`。
7. 如果 `RunRecord.state` 是 `needs_input`：
   - view state 暂映射为 `blocked`；
   - `diagnosticSummary.code` 为 `input_required`；
   - recovery action 包含 `resolve_blocker`。
8. 如果存在与 run 相关的 blocked handoff：
   - view state 为 `blocked`；
   - `blockedReason` 使用 handoff `blockingReason` 的脱敏摘要；
   - recovery action 包含 `resolve_blocker`。
9. 如果 worker job 已进入 terminal state，但 run 缺少 terminal event：
   - view state 按 worker job terminal state 派生；
   - recovery action 包含 `resume_worker_finalization`。
10. 其它情况下按 `RunRecord.state` 映射：
    - `running` -> `running`
    - `failed` -> `failed`
    - `completed` -> `completed`
    - `cancelled` -> `cancelled`

`queued` 在当前 `RunRecordState` 中不是持久化状态；它只从 linked worker job 派生。这样
可以表达 queued skill command，而不用改变所有 run 创建路径。

## Diagnostics

`diagnosticSummary` 必须安全、短小、可进入 UI 和未来 context memory，但不能包含：

- raw stdout / stderr；
- secret value；
- raw model text；
- 完整 artifact 内容；
- 本机绝对路径；
- 未脱敏错误堆栈；
- 用户传入的未限制长文本。

诊断来源按优先级读取：

1. `model.output.parse_failed` event：
   - code 使用 `reason` 或 `policyCode`；
   - source 为 `model_parse`；
   - message 使用固定文案，不回显 raw model output。
2. terminal `run.failed` event：
   - code 为 `run_failed`；
   - source 为 `run_event`；
   - 可保留 safe `errorName`。
3. terminal `tool.failed` / `tool.cancelled` event：
   - code 为 `tool_failed` 或 `tool_cancelled`；
   - source 为 `tool_observation`。
4. linked worker job terminal summary：
   - code 使用 safe `errorName` 或 `worker_job_failed`；
   - source 为 `worker_job`；
   - message 只用 bounded summary。
5. blocked handoff：
   - code 为 `handoff_blocked`；
   - source 为 `handoff`；
   - message 使用脱敏后的 blocking reason。
6. lifecycle inconsistency：
   - code 为 `inconsistent_terminal_events`、`worker_job_missing`、
     `worker_finalization_incomplete` 等固定值；
   - source 为 `lifecycle`。

脱敏策略应复用现有的 bounded / sanitized helper 风格。第一版可以采用固定长度截断和
保守字符过滤，避免把 raw output 当作诊断透传。

## Recovery Contract

Stage 18 只输出 recovery action contract，不执行复杂恢复。

建议 action 含义：

- `retry_run`：run 已失败，且没有 terminal event 冲突，也不是权限/approval/blocker 问题。
  本阶段只返回 action，不实现自动重跑。
- `resume_worker_finalization`：worker job 已 terminal，但 run / tool observation 尚未完成
  finalization。后续 API 或 worker daemon 可调用现有 finalizer。
- `request_approval`：run 等待用户或团队 approval。
- `resolve_blocker`：blocked handoff 或 input-required 状态需要用户/Reviewer/后续流程解决。
- `inspect_manually`：状态不一致、linked worker 缺失、terminal event 冲突等不能自动处理。

第一版不要把 retry/resume 做成用户可点击的 Web 功能。先让 contract 稳定，并用单测证明
派生结果正确。

## Worker Finalizer 幂等性

现有 `finalizeWorkerBackedSkillCommand()` 已经会检查 terminal events，但 Stage 18 需要把
行为定义得更明确：

1. 同一个 `workerJobId` + `observationId` 已经有匹配 terminal tool event 和 terminal run
   event 时：
   - 不再写入新 terminal event；
   - 不重复更新 observation 的 terminal metadata，除非已有 metadata 缺失且可安全补齐；
   - 返回与既有 terminal state 一致的 stable result。
2. 只有 terminal tool event 缺失时：
   - 补写 terminal tool event；
   - 不重复写已有 terminal run event。
3. 只有 terminal run event 缺失时：
   - 补写 terminal run event；
   - 用该 event 时间完成 observation / run reconciliation。
4. 存在不匹配 terminal event，例如同一 run 已有别的 worker / observation 的 terminal event：
   - fail closed；
   - 不覆盖 run state；
   - 不写新 terminal event。
5. worker job 仍非 terminal：
   - 返回 `worker_job_finalization_failed`，不派生完成状态。

这个定义让 local worker run-once、未来 daemon 和人工 resume finalization 都可以安全重复调用。

## API 入口

建议新增只读 helper：

```ts
export async function deriveRunLifecycleView(input: {
  repositories: WorkbenchRepositories;
  workerRuntime?: Pick<WorkerRuntime, "getJob">;
  runId: string;
}): Promise<
  | { ok: true; view: RunLifecycleView }
  | { ok: false; error: "run_not_found" }
>;
```

可选新增 task/project 聚合 helper：

```ts
export async function listRunLifecycleViewsForTask(input: {
  repositories: WorkbenchRepositories;
  workerRuntime?: Pick<WorkerRuntime, "getJob">;
  taskId: string;
}): Promise<RunLifecycleView[]>;
```

Stage 18 不要求 Web 使用这个 helper。但如果服务层或 context memory 需要摘要，应通过这个
helper，不要复制派生逻辑。

## Context 和 Memory 边界

如果把 lifecycle summary 接入 context memory，只能注入：

- run id；
- role；
- lifecycle state；
- diagnostic code；
- safe message；
- recovery action names；
- terminal event type。

不得注入 raw tool output、raw model text、完整 artifacts、worker payload、env value 或本机路径。

第一版可以只在 API 测试中证明 helper 输出是安全结构，不强制改 Web timeline。

## Error Handling

- 缺 run：返回 `run_not_found`，不推断状态。
- linked worker event 存在但 `workerRuntime` 未提供：保留 linked worker id，状态按 run/event 记录
  派生；需要 worker 事实时给 `inspect_manually`。
- linked worker job 缺失：如果已有 terminal event，按 terminal event 派生；如果没有 terminal
  event，`diagnosticSummary.code` 为 `worker_job_missing`，recovery action 为
  `inspect_manually`。
- 多个 terminal event 冲突：派生为 failed + `inconsistent_terminal_events`，不自动 retry。
- blocked handoff：派生为 blocked，blocking reason 必须 bounded / redacted。
- running worker job 有 `cancelRequestedAt`：派生为 cancelling，不提前标记 cancelled。
- JSON-file 状态缺少旧字段：helper 应 fail closed 或使用保守默认，不应制造成功状态。

## 测试计划

新增 `packages/api/src/run-lifecycle.test.ts`，覆盖：

1. completed run event 派生 `completed`。
2. failed run event 派生 `failed` 和 safe diagnostic。
3. cancelled run event 派生 `cancelled`。
4. no terminal event + run record running 派生 `running`。
5. runtime `needs_approval` 派生 `waiting_for_approval` 和 `request_approval`。
6. runtime `needs_input` 派生 `blocked` 和 `resolve_blocker`。
7. blocked handoff 派生 `blocked`，并返回脱敏 blocking reason。
8. linked queued worker job 派生 `queued`。
9. linked running worker job 派生 `running`。
10. running worker job with `cancelRequestedAt` 派生 `cancelling`。
11. terminal worker job + missing run terminal event 给 `resume_worker_finalization`。
12. missing linked worker job 给 `worker_job_missing`。
13. conflicting terminal events 给 `inconsistent_terminal_events` 和 `inspect_manually`。
14. model parse failed event 优先生成 parse diagnostic。
15. diagnostic 不包含 raw output、secret、artifact content。

更新 `packages/api/src/skill-command-worker-queue.test.ts`，覆盖：

1. 重复 finalize 已完成 worker job 不新增 terminal events。
2. 重复 finalize 已取消 worker job 不新增 terminal events。
3. 只有 terminal run event 存在时，补齐 terminal tool event 后保持 run state。
4. 只有 terminal tool event 存在时，补齐 terminal run event 后保持 observation state。
5. 不匹配 terminal event 时 fail closed，不覆盖 run state。

如接入 context memory，则更新相关测试，确保只注入 safe lifecycle metadata。

## 文档更新

本阶段需要同步更新：

- `docs/superpowers/README.md`：加入 Stage 18 spec 和后续 plan 读取顺序。
- `docs/agent-development-learning.md`：补充 run lifecycle / recovery 学习重点。
- `docs/project-roadmap.md`：把 Stage 18 标记为设计已确认，并保留 Stage 19 / 20 / 21 的后续顺序。

## 验收标准

Stage 18 implementation 完成时应满足：

1. `RunLifecycleView` 能从现有 repository state 派生标准 lifecycle state。
2. failed / blocked / inconsistent 状态有安全 diagnostic summary。
3. recovery action contract 覆盖 retry、resume finalization、approval、blocker 和 manual inspect。
4. worker-backed skill command finalizer 重复调用保持幂等。
5. 测试覆盖 run lifecycle 派生和 finalizer 幂等场景。
6. 文档同步更新，且明确本阶段不做 UI、daemon、MCP execution、真实 shell 或 scheduler。

## 后续阶段关系

- Stage 19 worker daemon 应使用 `RunLifecycleView` 判断 queued / running / cancelling /
  finalization-incomplete 状态。
- Stage 20 MCP execution 应通过同一 lifecycle / observation / worker boundary 写入和读取工具状态。
- Stage 21 model repair / retry 应复用 recovery action contract，不静默隐藏原始 failed run。
- Web UI 的 retry / recovery affordance 应等 lifecycle contract 稳定后再做。
