# Stage 25：Run Recovery UI v0 设计

日期：2026-05-20

状态：设计已确认，等待 implementation plan。

## 背景

Stage 18 已经在 API 侧实现 `RunLifecycleView`、安全 `diagnosticSummary` 和 recovery action contract。Stage 19-24 继续补齐 worker daemon、heartbeat、Postgres-backed workbench repositories 和 Postgres-backed worker queue。现在系统已经能比较可靠地保存 run、worker job、tool observation 和 handoff 事实，但 Web workbench 还没有把这些事实变成用户可见、可执行的恢复流程。

Stage 25 的目标是把现有 lifecycle / recovery contract 接到 Web task timeline。用户应该能看到每个 run 当前为什么失败、阻塞或需要人工处理，并能在安全边界内触发第一批恢复动作。

本阶段采用用户已确认的 UI 方向：在当前 task assistant / timeline 区域内展示 inline recovery block，而不是新建右侧 inspector 或独立恢复页面。

## 目标

- 在 Web task timeline / run panel 展示 `RunLifecycleView` 列表。
- 对每个 run 展示 role、state、terminal event、安全诊断和推荐 recovery action。
- 实现第一批可执行 server action：
  - `resume_worker_finalization`
  - `retry_run`
- 对非执行型 action 展示清楚的 guidance：
  - `request_approval`
  - `resolve_blocker`
  - `inspect_manually`
- 保持 diagnostic summary 和 UI 文案脱敏，不展示 raw model output、raw tool output、secret、完整 artifact 内容或本机路径。
- 增加 UI/API regression coverage，覆盖 completed repaired run、failed parse / retry exhausted run、missing worker finalization、cancelled run 和 blocked handoff。

## 非目标

- 不做通用 DAG scheduler。
- 不自动重跑完整 `Planner -> Builder -> Reviewer -> Deployer` chain。
- 不做 streaming UI。
- 不实现团队审批队列。
- 不开放任意 shell retry、MCP write tool retry 或真实 deployment side effect retry。
- 不把 raw stdout/stderr、raw provider response、raw tool arguments/output 或 artifact content 注入 Web state。

## UX 设计

Stage 25 采用 inline recovery block：

- 位置：当前 task 页面中 assistant message / process timeline 附近，优先放在生成过程状态块下方、交付物块之前。
- 粒度：一个 task 下展示多个 `RunLifecycleView` rows，按现有 run 顺序或 lifecycle helper 返回顺序排列。
- 每个 row 至少展示：
  - role，例如 `planner`、`builder`、`reviewer`、`deployer`、`skill_command`
  - lifecycle state，例如 `completed`、`failed`、`cancelled`、`blocked`
  - 最近 terminal event 或 worker/job 摘要
  - redacted `diagnosticSummary`
  - recovery action label 和当前是否可执行
- 可执行动作以 button/form 表达；指导型动作以非执行 chip / note 表达。
- UI 不要求用户理解内部 repository 或 worker backend。用户只看到“继续完成 worker 回写”“重试这个 run”“需要审批”“需要解除阻塞”“需要人工检查”等结果导向的表达。

### 行为分层

- `completed` 且没有 recovery action：显示为已完成，通常不展开诊断。
- `completed` 但曾经过 repair：显示完成状态，可保留 “repaired” 类的安全历史摘要，但不把历史 parse failure 当成当前失败。
- `failed`：展示 safe diagnostic，并根据 contract 展示 `retry_run` 或 `inspect_manually`。
- `cancelled`：展示取消状态；默认不给自动 retry，除非 retry intent 能安全重建且当前 lifecycle 仍允许。
- `blocked`：展示 blocker/handoff 摘要和 `resolve_blocker` guidance。
- `waiting_for_approval`：展示 `request_approval` guidance，不在 Stage 25 做团队审批队列。
- worker job 已 terminal 但 run/tool observation 未完成：展示 `resume_worker_finalization`。

## API / State 设计

Stage 25 不重新定义 lifecycle 推导规则，而是复用 Stage 18 的 API helper。Web state 需要把当前 task 的 lifecycle views 带到页面。

建议状态形态：

```ts
export interface WorkbenchTaskRecoveryState {
  runs: RunLifecycleView[];
}
```

`WorkbenchPageState.task_ready` 应包含当前 task 的 recovery state。UI 只消费安全字段，不直接读取 worker payload、raw events 或 raw observations。

### Server Action Contract

Web server action 只接收最小参数：

```ts
export type RunRecoveryExecutionAction =
  | "resume_worker_finalization"
  | "retry_run";

export interface ExecuteRunRecoveryActionInput {
  taskId: string;
  runId: string;
  action: RunRecoveryExecutionAction;
}

export type RunRecoveryExecutionResult =
  | {
      ok: true;
      action: RunRecoveryExecutionAction;
      runId: string;
      newRunId?: string;
      state: RunLifecycleState;
    }
  | {
      ok: false;
      error: RunRecoveryExecutionErrorCode;
    };

export type RunRecoveryExecutionErrorCode =
  | "run_not_found"
  | "recovery_action_not_available"
  | "worker_runtime_not_configured"
  | "worker_job_not_found"
  | "worker_job_not_terminal"
  | "worker_finalization_failed"
  | "retry_input_not_reconstructable"
  | "retry_target_conflict"
  | "retry_failed";
```

Server action 必须在执行前重新读取 repository state，并重新派生 `RunLifecycleView`。浏览器传入的 `runId` / `action` 只是 intent，不能作为授权或状态事实。

## `resume_worker_finalization`

`resume_worker_finalization` 只处理 Stage 18/19 已定义的安全场景：worker job 已进入 terminal state，但对应 run event / tool observation finalization 不完整。

执行步骤：

1. 通过 `taskId` 和 `runId` 重新读取 run、worker job、tool observation 和 handoff 事实。
2. 重新派生 lifecycle view，确认当前 recommended action 仍是 `resume_worker_finalization`。
3. 确认 worker runtime / worker repository 已配置，且 worker job 存在并已 terminal。
4. 调用已有幂等 finalizer。
5. 重新派生 lifecycle view，返回新的 state。

Fail closed 场景：

- run 不存在或不属于当前 task。
- lifecycle 已变化，当前 action 不再可用。
- worker job 不存在或仍未 terminal。
- terminal event 冲突。
- finalizer 返回非幂等冲突或无法写入 repository。

## `retry_run`

`retry_run` 是 Stage 25 最容易失控的边界，因此 v0 只做 safely reconstructable single-run retry。

已确认原则：

- retry 会创建新的 retry attempt / new run id，不覆盖原始 failed run。
- retry 不自动重跑完整 agent chain。
- retry 不绕过 approval、ownership、artifact policy、model output parse、worker policy 或 deployment policy。
- 输入不能从 repository 安全重建时，fail closed，并让 UI 展示 `inspect_manually`。
- 如果 retry 目标已经被其他成功输出占用，fail closed，不覆盖已有 brief、page version、review 或 deployment。

### Retry Intent

API 层应先把目标 run 映射为一个显式 `RunRetryIntent`。实现计划阶段需要根据当前 code shape 选择具体 helper 名称，但语义应保持如下：

```ts
export type RunRetryIntent =
  | {
      role: "planner";
      taskId: string;
      retryRunId: string;
    }
  | {
      role: "builder";
      taskId: string;
      briefId: string;
      retryRunId: string;
    }
  | {
      role: "reviewer";
      taskId: string;
      pageVersionId: string;
      retryRunId: string;
    }
  | {
      role: "deployer";
      taskId: string;
      pageVersionId: string;
      retryRunId: string;
    };
```

可支持角色取决于当前 repository 是否能完整重建输入，并能写入不冲突的输出：

- `planner`：task snapshot / project input 可重建，且不会覆盖已有 successful brief。
- `builder`：brief 可重建，且不会覆盖已有 successful page version。
- `reviewer`：page version 和 brief 可重建，且没有更新的 terminal review 结果会被覆盖。
- `deployer`：page version 已通过 review，且同一 target/env 没有已有 deployment 会被覆盖。

`skill_command` retry 不进入 Stage 25 默认可执行范围。即使 command payload 是 safe persisted，命令也可能有外部 side effect；v0 只通过 `resume_worker_finalization` 修复 finalization gap，真正 command retry 应等待更明确的 side-effect / approval / idempotency contract。

### Retry Run ID

Retry run 必须使用新 id。建议格式：

```txt
run_<role>_<stableTargetId>_retry_<n>
```

示例：

- `run_planner_<taskId>_retry_1`
- `run_builder_<briefId>_retry_1`
- `run_reviewer_<pageVersionId>_retry_1`
- `run_deployer_<pageVersionId>_retry_1`

如果现有 repository 已有 run id reservation helper，应优先使用 helper，避免并发创建相同 retry id。

## Safety

Stage 25 的安全边界：

- 不信任浏览器提交的 lifecycle state、diagnostic 或 action availability。
- 执行前必须重新读取并重新派生 lifecycle view。
- recovery action 必须和当前 derived view 匹配。
- 所有输出仍经过原本业务边界：
  - model structured output parse
  - artifact policy validation
  - review/deploy preconditions
  - worker claim/finalization idempotency
  - approval and blocker rules
- UI 和 server action result 只能返回安全摘要和错误码。
- Error code 不包含 secret、local path、raw provider response、raw tool output 或完整 artifact content。

## 测试策略

API tests：

- lifecycle view 暴露 completed repaired run，但不把历史 parse failure 当作当前失败。
- failed parse / retry exhausted run 显示 safe diagnostic。
- missing worker finalization 返回 `resume_worker_finalization`，执行后 lifecycle 变为 completed 或 failed。
- cancelled run 显示 cancelled，不默认执行危险 retry。
- blocked handoff 返回 `resolve_blocker` guidance。
- `retry_run` 对可重建输入创建新 run id，不覆盖原始 failed run。
- `retry_run` 对缺失输入、目标冲突、unsupported role fail closed。
- diagnostics 和 action result 不泄漏 raw output、secret、完整 artifact 内容或本机路径。

Web store / page tests：

- `task_ready` state 包含 recovery runs。
- inline recovery block 渲染 role、state、safe diagnostic 和 action。
- executable action button 调用 server action，并在成功后刷新页面 state。
- guidance-only actions 不渲染为可执行提交按钮。
- server action failure 显示通用安全错误，而不是 raw exception。

## 文档更新

同一变更需要更新：

- `docs/project-roadmap.md`：Stage 25 从“推荐下一阶段”推进到“设计已确认，待 implementation plan”。
- `docs/superpowers/README.md`：登记本 spec 的阅读顺序。
- `docs/agent-development-learning.md`：补充 recovery action contract 变成产品动作时的边界和学习重点。

## 下一步

用户审阅并确认本设计 spec 后，再创建 Stage 25 implementation plan。Implementation plan 应先读当前 Web task state、server actions、run lifecycle helper、worker finalizer 和 runtime orchestration 代码，再按 TDD 拆分实现步骤。
