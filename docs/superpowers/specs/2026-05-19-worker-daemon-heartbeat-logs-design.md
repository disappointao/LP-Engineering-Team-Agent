# Stage 19 Worker Daemon、Heartbeat 和 Streaming Logs v0 设计

## 状态

已确认设计，待 implementation plan。

用户选择路线 A：`runtime-first + Web 只读展示`。

Stage 19 的目标是在 Stage 18 的 run lifecycle / recovery v0 之后，补齐 worker daemon、heartbeat、stale claim recovery 和 bounded worker log visibility 的基础。实现时应保持当前 deterministic / local-first 约束，不把真实 shell、MCP execution 或生产进程管理提前带入本阶段。

## 背景

当前 worker 相关能力已经包括：

- `packages/worker-runtime` 定义 worker job contract、sandbox policy、execution adapter、JSON-file persistence、cancel/interrupt、claim-token handoff。
- `apps/agent-worker` 支持 `runWorkerOnce()`，可以从共享 JSON-file queue claim 并执行一个 safe persisted simulated job。
- Web Skills 视图支持批准并入队 deployment skill command，并通过 `Run local worker once` 执行一个同项目 queued job，再把 terminal result finalization 回 run events / tool observation。
- Stage 18 已补齐 `RunLifecycleView` 和 worker finalizer 幂等性，为重复 finalization、缺失 worker、冲突 terminal state 和未来 recovery action 提供了可测试边界。

当前缺口是：

- 没有 long-running daemon / polling loop。
- running job 没有 heartbeat metadata，无法区分“仍在运行”和“worker 消失”。
- claim stale 后没有自动恢复策略。
- worker 执行过程没有 bounded、可展示的 lifecycle log summary。
- Web 只能手动点 `Run local worker once`，看不到 queue / worker health 摘要。

## 目标

1. 在 `packages/worker-runtime` 增加 heartbeat、stale claim recovery 和 bounded worker log summary 的最小 contract。
2. 在 `apps/agent-worker` 增加 daemon / polling loop mode，同时保留现有 run-once 行为。
3. 在 `packages/api` 暴露只读 worker queue snapshot，供 Web 展示 queue counts、worker heartbeat、stale recovery 和 recent worker logs。
4. 在 `apps/web` 的 Skills local worker queue 面板展示最小 worker visibility，不提供 Web 启停长期 daemon 的控制。
5. 保持所有 payload / log / event 安全摘要化，不持久化 raw env value、secret、完整 args、完整 stdout/stderr 或 artifact content。

## 非目标

- 不做真实 shell execution。
- 不做 MCP execution。
- 不做真实 deployment runner。
- 不做 OS-level sandbox、Docker、Firecracker 或生产隔离。
- 不做 Web 启停 daemon / process manager。
- 不做 browser E2E 或 streaming UI overhaul。
- 不把 raw stdout/stderr 持久化为 run event 或展示到 timeline。
- 不引入 Postgres 依赖或迁移 JSON-file repositories。

## 设计路线

采用 `runtime-first + Web 只读展示`。

核心 worker 状态仍由 `packages/worker-runtime` 管理。`apps/agent-worker` 是 CLI/daemon 入口，负责 poll、claim、heartbeat、execute、complete，并写入 worker lifecycle log summary。若 daemon 配置了 workbench repository，它还要通过 API 提供的幂等 finalizer 把 terminal worker job 回写到 run events / tool observation；如果没有配置 workbench repository，则只完成 worker job record。

Web/API 不拥有长期进程生命周期。Web 只读取 worker repositories / workbench repositories 并展示 snapshot，不启动、停止或重启 daemon。

备选路线被排除：

- 只在 Web/API 做 pseudo daemon tick：实现快，但 `apps/agent-worker` 仍没有 daemon mode，Stage 20 MCP execution 会返工。
- Web 直接管理 daemon start/stop：用户体验更完整，但会引入进程管理、锁、退出恢复和安全问题，超出 v0。

## 架构

### `packages/worker-runtime`

新增最小字段和 repository/runtime 方法：

- `WorkerJobRecord.lastHeartbeatAt?: string`
- `WorkerJobRecord.heartbeatExpiresAt?: string`
- `WorkerJobRecord.staleRecoveredAt?: string`
- `WorkerJobRecord.staleRecoveryCount?: number`
- `WorkerJobRecord.lastWorkerLogAt?: string`

新增或扩展 repository 方法：

- `heartbeatClaimed(input)`：只在 job 仍为 `running` 且 `claimToken` 匹配时更新 heartbeat。
- `recoverStaleClaims(input)`：扫描 running jobs，根据 `heartbeatExpiresAt` 或 `lastHeartbeatAt/startedAt` 判断 stale，并执行安全恢复。
- `appendWorkerLog(input)` 或等价 bounded log repository：保存 worker lifecycle log summary，按 project / worker / job 可过滤。
- `listWorkerLogs(input)`：读取最近 N 条安全 worker logs。
- `getWorkerQueueSnapshot(input)` 或由 API 组合：读取 job counts、stale counts 和 recent logs。

如果实现时更适合拆文件，worker log contract 可以独立为 `WorkerLogRecord` / `WorkerLogRepository`，但必须和 worker runtime 同包，避免 Web 层直接推导 worker 内部状态。

### `apps/agent-worker`

保留现有 run-once 入口：

- `runWorkerOnce(input)` 继续 claim 并执行一个 queued job。
- 现有 env `WORKER_JOBS_FILE`、`WORKER_PAYLOADS_FILE`、`WORKER_ID` 继续可用。

新增 daemon mode：

- 通过 env 或 CLI mode 显式开启，例如 `WORKER_MODE=daemon` 或 `WORKER_DAEMON=1`。
- loop 每轮执行：recover stale claims -> claim queued job -> heartbeat -> execute -> complete -> optional workbench finalization -> write log -> sleep。
- 支持 `pollIntervalMs`、`heartbeatIntervalMs`、`staleClaimTimeoutMs`、`maxIterations` 等配置。
- 测试中必须可注入 fake clock / fake sleep / `maxIterations`，不能依赖真实长时间 sleep。

daemon 的 workbench finalization 必须是可选能力：

- 配置了 workbench state/repositories 时，daemon 完成 terminal worker job 后调用 API helper，把结果幂等写回对应 run/tool events。
- 没配置 workbench state/repositories 时，daemon 只更新 worker job record 和 worker logs，不尝试猜测 run state。
- finalization 失败时，daemon 不重跑 job；它写 `worker.job.finalization_failed` summary log，下一轮或人工 recovery 可以复用同一个幂等 finalizer。

### `packages/api`

新增只读 worker queue snapshot helper：

- 输入：`projectId`、`workerRuntime` 或 worker repositories、`recentLogLimit`。
- 输出：当前项目范围内 queue counts、running/stale summary、recent worker logs、最近 heartbeat。
- 不接受客户端传入任意 `workerJobId` 来读取跨项目数据。
- 对 worker logs 做 allowlist 过滤和 bounded display formatting。

现有 `runLocalWorkerOnceAndFinalize()` 必须继续可用。Stage 19 可以在该路径补写 worker log summary，但不能改变成功/失败语义。

新增或导出 worker finalization helper，供 `apps/agent-worker` daemon 在配置 workbench repository 时复用：

- 输入 terminal `WorkerJobRecord` 和 `WorkbenchRepositories`。
- 只处理已有 `worker.job.linked` run event 能关联到的 worker-backed skill command。
- 复用 Stage 18 幂等 finalizer；重复调用不重复写 terminal events。
- finalization 冲突必须 fail closed，并通过 worker log summary 暴露安全错误名。

### `apps/web`

扩展 Skills 视图现有 `Local worker queue` 面板：

- 显示 `queued`、`running`、`stale`、terminal job 计数。
- 显示最近 worker heartbeat：workerId、时间、状态。
- 显示最近 N 条安全 worker lifecycle logs。
- 保留 `Run local worker once` 表单。
- 不添加 Web 启动、停止、重启 daemon 的按钮。

Workbench timeline 继续只展示 run-scoped events。idle daemon heartbeat 不进入 timeline。只有与已链接 `runId` / `workerJobId` 相关、且通过现有 run event 边界保存的 terminal 或 recovery summary，才进入 timeline。

## Heartbeat 语义

`heartbeatClaimedJob(jobId, claimToken, workerId)` 的语义：

- job 必须存在。
- job 必须是 `running`。
- `claimToken` 必须与当前 record 匹配。
- 如果 record 有 `claimedByWorkerId`，则必须与 `workerId` 匹配。
- 成功后更新 `lastHeartbeatAt` 和 `heartbeatExpiresAt`。
- 失败时返回冲突结果或 `undefined`，调用方写 `worker.job.claim_conflict` summary log 后停止处理该 claim。

heartbeat 不是 authorization，不代表用户权限。它只是 worker claim 仍活跃的 runtime liveness signal。

## Stale Recovery 语义

Stage 19 只自动恢复安全 payload：

- 只有 `payloadSource: "safe_persisted"` 的 running job 可以自动 stale recovery。
- 判断 stale 的依据是 `heartbeatExpiresAt < now`；如果旧 record 没有 heartbeat，则用 `startedAt + staleClaimTimeoutMs < now` 作为兼容 fallback。
- stale recovery 默认 `maxStaleRecoveryCount = 1`。

恢复路径：

1. 如果 job 已有 `cancelRequestedAt`，则不重排，直接标记 `cancelled`，写安全 result summary 和 `worker.job.stale_cancelled` log。
2. 如果 `staleRecoveryCount < maxStaleRecoveryCount`，则重排为 `queued`，清空 `startedAt`、`claimedByWorkerId`、`claimToken`、`lastHeartbeatAt`、`heartbeatExpiresAt`，写入 `staleRecoveredAt` 并递增 `staleRecoveryCount`。
3. 如果恢复次数达到上限，则标记 `failed`，错误名为 `worker_job_stale_recovery_limit_exceeded`，写 `worker.job.stale_failed` log。

旧 worker 如果在之后完成，必须因为 claim token 不匹配而无法覆盖新 record。这个行为依赖 Stage 11 的 claim-token completion 和 Stage 18 的 finalizer 幂等性。

## Worker Logs v0

本阶段的 “Streaming Logs” 指 bounded worker lifecycle log/event summary，不是 raw stdout/stderr 流。

建议事件类型：

- `worker.daemon.started`
- `worker.daemon.idle`
- `worker.daemon.stopped`
- `worker.job.claimed`
- `worker.job.heartbeat`
- `worker.job.completed`
- `worker.job.failed`
- `worker.job.cancelled`
- `worker.job.finalization_failed`
- `worker.job.stale_recovered`
- `worker.job.stale_cancelled`
- `worker.job.stale_failed`
- `worker.job.claim_conflict`

日志 payload allowlist：

- `workerId`
- `workerJobId`
- `projectId`
- `state`
- `previousState`
- `nextState`
- `staleRecoveryCount`
- `errorName`
- `exitCode`
- `outputSummary`
- `createdAt`

禁止写入：

- raw env value。
- secret。
- 完整 args。
- 完整 stdout/stderr。
- artifact content。
- 本机绝对路径。
- raw model text。

worker log repository 必须 bounded。默认读取最近 10 或 20 条；持久化文件可以按全局上限或按 project 上限截断，避免 `.lp-agent` JSON 无限增长。

## Web Snapshot

API 输出的 Web snapshot 建议结构：

- `counts.queued`
- `counts.running`
- `counts.stale`
- `counts.completed`
- `counts.failed`
- `counts.cancelled`
- `heartbeat.workerId`
- `heartbeat.lastHeartbeatAt`
- `heartbeat.status`
- `logs[]`

`heartbeat.status` 建议从当前时间和 heartbeat expiry 派生：

- `active`：最近 heartbeat 未过期。
- `idle`：daemon 最近报告 idle。
- `stale`：heartbeat 已过期或存在 stale running job。
- `unknown`：没有 heartbeat/log 信息。

Web 只展示这些字段，不从浏览器接收 worker 内部 id 来查询跨项目信息。

## 错误处理

- repository JSON parse 失败沿用现有 fail-closed 行为，不静默创建错误状态。
- heartbeat conflict 不 throw 到 daemon 顶层；记录 claim conflict summary 后继续下一轮。
- stale recovery 的每次状态转换必须是 repository 条件更新，避免 stale snapshot 覆盖 terminal job。
- daemon loop 单轮失败不应导致无限忙循环；应写 bounded error log，并按 poll interval 继续，除非配置要求 fail fast。
- Web snapshot 读取失败应显示 worker queue unavailable 的稳定错误，不暴露底层文件路径。

## 测试策略

### `packages/worker-runtime`

- heartbeat 只更新匹配 claim token 的 running job。
- token mismatch / worker mismatch 返回冲突，不修改 job。
- safe persisted running job 过期后可以重排为 queued。
- 有 `cancelRequestedAt` 的 stale job 优先进入 cancelled。
- 超过 `maxStaleRecoveryCount` 后进入 failed。
- JSON-file repository 可以读取旧 record，缺失新字段时不报错。
- worker logs 写入、过滤、截断和 allowlist 行为 deterministic。

### `apps/agent-worker`

- daemon `maxIterations` 能在测试中 deterministic 退出。
- idle queue 会写 idle log 并 sleep。
- queued job 会被 claim、heartbeat、execute、complete。
- stale recovery 在 claim 前触发。
- claim conflict 不会覆盖 terminal job。
- 配置 workbench repository 时，terminal worker job 会调用幂等 finalizer；finalizer 失败只写安全日志，不重跑 job。
- run-once 行为保持兼容。

### `packages/api`

- worker queue snapshot 正确统计当前项目 queued/running/stale/terminal counts。
- recent logs 只返回当前项目或安全全局 daemon summary。
- `runLocalWorkerOnceAndFinalize()` 现有 terminal finalization 语义保持不变。
- snapshot 不泄露 raw args/env/stdout/stderr/artifact content。

### `apps/web`

- Skills local worker queue 面板渲染 counts、heartbeat 和 recent logs。
- 中文和英文文案都有覆盖。
- `Run local worker once` 表单仍存在并走原 action。
- Workbench timeline 不展示 idle daemon heartbeat。

### 全量验证

```bash
pnpm test
pnpm typecheck
```

如本阶段修改 build-time exports 或 package boundaries，也运行：

```bash
pnpm build
```

## 验收标准

- `apps/agent-worker` 支持 run-once 和显式 daemon mode。
- worker running job 会记录 heartbeat，并可从 repository 读取。
- stale safe persisted job 会按设计重排、取消或失败。
- stale worker 的旧 claim token 无法覆盖新状态。
- daemon 在配置 workbench repository 时会复用幂等 finalizer，把 terminal worker job 回写到 run/tool events；未配置时不猜测 workbench state。
- Web Skills local worker queue 面板能显示只读 worker visibility。
- 所有新增 logs/events 都是 bounded、安全摘要。
- 默认 adapter 仍是 simulated/reject，不出现真实 shell、MCP execution 或 deployment runner。
- `pnpm test` 和 `pnpm typecheck` 通过。

## 文档影响

本 spec 规划的是 agent runtime / worker execution / observability 能力，因此同一变更需要同步：

- `docs/superpowers/README.md`
- `docs/project-roadmap.md`
- `docs/agent-development-learning.md`
