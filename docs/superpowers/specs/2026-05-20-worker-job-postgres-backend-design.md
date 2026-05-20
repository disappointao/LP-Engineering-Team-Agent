# Stage 24：Worker Job Postgres Backend v0 设计

## 背景

Stage 23 已让 Web workbench state 可以通过显式 `WORKBENCH_REPOSITORY_BACKEND=postgres` 选择 Prisma-backed `WorkbenchRepositories`。但 worker queue 仍然是 JSON-file：Web enqueue、`apps/agent-worker` claim/run、daemon heartbeat、stale recovery 和 worker lifecycle logs 都依赖 `WORKER_JOBS_FILE`、`WORKER_PAYLOADS_FILE` 和 `WORKER_LOGS_FILE`。

这会限制下一步长期运行场景。即使 workbench state 进入 Postgres，worker job state 仍然散落在本地文件中，daemon heartbeat、claim token、stale recovery 和审计日志无法成为共享 durable backend 的一部分。

Stage 24 的目标是补齐 worker queue 的 Postgres opt-in backend。用户已确认本阶段采用较完整的 B 方案：同时覆盖 `WorkerJobRepository`、`WorkerJobPayloadRepository` 和 `WorkerLogRepository`，但仍保留当前安全边界，不把 secret、raw stdout/stderr 或 artifact content 持久化到 payload/log。

## Goals

- 新增显式 worker repository backend 选择：`WORKER_REPOSITORY_BACKEND=json | memory | postgres`。
- 默认本地行为保持不变：未配置时 Web 和 `apps/agent-worker` 继续使用 JSON-file worker queue。
- `postgres` 模式必须 fail closed：缺少 `DATABASE_URL`、Prisma client 初始化失败或 backend 值非法时，不回退 JSON-file。
- 为 worker job、safe persisted payload 和 worker lifecycle log 增加 Prisma schema、mapper 和 repository adapter。
- 保持现有 worker queue contract：claim token 条件更新、heartbeat、complete claimed、queued cancellation、running cancellation、stale recovery、project-scoped claim、bounded lifecycle logs。
- Web enqueue 和 `apps/agent-worker` claim/run 使用同一 worker repository factory，避免 Web 写 JSON 而 worker 读 Postgres 这类 split-brain。
- `WorkerJobPayloadRepository` 只保存现有 safe persisted payload 字段，不保存 env values、secret、raw command env、raw output 或 artifact content。
- 增加 shared repository contract tests、Prisma mapper/repository tests、factory tests、Web/agent-worker opt-in coverage 和文档。
- 同步 roadmap、Superpowers 索引和 Agent 开发学习笔记。

## Non-Goals

- 不做 production process manager、deployment process supervisor 或 hosted worker fleet。
- 不开放真实 shell runner、OS-level sandbox、filesystem write tools 或 remote MCP execution。
- 不做 raw stdout/stderr streaming，也不保存完整 stdout/stderr。
- 不迁移既有 JSON-file worker queue 数据。
- 不把 workbench repository backend 强制切到 Postgres；workbench state 和 worker queue backend 仍是独立显式配置。
- 不做 Prisma production migration strategy 或 hosted deployment docs。
- 不改变当前 safe simulated worker payload 的语义，不引入可以恢复任意 shell execution 的 payload 格式。

## Backend Selection

新增 worker queue repository factory。它应被 Web 默认 store path 和 `apps/agent-worker` 共同使用，而不是在两个 app 中各自手写 backend selection。

配置语义：

- `WORKER_REPOSITORY_BACKEND` 未设置或为 `json`：使用现有 JSON-file repositories。
- `WORKER_REPOSITORY_BACKEND=memory`：使用 in-memory repositories，主要用于 tests。
- `WORKER_REPOSITORY_BACKEND=postgres`：动态加载 Prisma client，创建 Prisma-backed worker job/payload/log repositories。
- 其他值：启动时 fail closed，抛出明确配置错误，例如 `Unsupported WORKER_REPOSITORY_BACKEND`.

JSON backend 继续使用现有路径：

- `WORKER_JOBS_FILE`，Web 默认 `.lp-agent/worker-jobs.json`。
- `WORKER_PAYLOADS_FILE`，Web 默认 `.lp-agent/worker-payloads.json`。
- `WORKER_LOGS_FILE`，未设置时从 jobs file 推导 `.lp-agent/worker-logs.json`。

Postgres backend 必需环境变量：

- `DATABASE_URL`：Prisma/Postgres 连接字符串。

Postgres backend 不要求 `WORKER_JOBS_FILE` 或 `WORKER_PAYLOADS_FILE`。这两个变量只属于 JSON backend。

Prisma client 必须动态加载并缓存到 `globalThis`，避免默认 JSON path 或 tests 在未运行 `prisma generate` 时加载 generated client。

## Package Boundary

`packages/worker-runtime` 继续拥有 worker repository contracts、in-memory repositories、JSON-file repositories、runtime state machine 和 safety validators。

`packages/db` 拥有 Prisma schema 和 Prisma adapter。Stage 24 应在 `packages/db` 中新增 Prisma worker repository adapter，并让它返回 `@lp-agent/worker-runtime` 的 repository interfaces：

- `createPrismaWorkerJobRepository(...)`
- `createPrismaWorkerJobPayloadRepository(...)`
- `createPrismaWorkerLogRepository(...)`

这样 `@lp-agent/worker-runtime` 不需要依赖 Prisma 或 `@prisma/client`，也不需要了解 database schema。`@lp-agent/db` 需要新增对 `@lp-agent/worker-runtime` 的 workspace dependency，用于导入 contract types 和 transition record types。

共享 factory 可以放在 API/Web 可复用的边界中，例如 `packages/api` 或一个 app-local helper，但必须避免 `apps/web` 和 `apps/agent-worker` 形成两套不一致的 env 解析。设计上以“单一 worker repository factory”为准。

## Prisma Schema

Stage 24 需要新增三个模型。字段命名可以按 Prisma 习惯调整，但必须 round-trip 当前 repository record。

### WorkerJob

保存 `WorkerJobRecord` 的安全状态：

- `id String @id`
- `projectId String`
- `kind String`
- `state String`
- `payloadSource String?`
- `policy Json`
- `inputSummary Json`
- `resultSummary Json?`
- `errorName String?`
- `createdAt DateTime`
- `startedAt DateTime?`
- `completedAt DateTime?`
- `cancelRequestedAt DateTime?`
- `cancelledAt DateTime?`
- `cancelReason String?`
- `claimedByWorkerId String?`
- `claimToken String?`
- `lastHeartbeatAt DateTime?`
- `heartbeatExpiresAt DateTime?`
- `staleRecoveredAt DateTime?`
- `staleRecoveryCount Int?`
- `lastWorkerLogAt DateTime?`

Required indexes:

- `@@index([projectId, createdAt, id])`
- `@@index([state, payloadSource, createdAt, id])`
- `@@index([claimedByWorkerId])`
- `@@index([heartbeatExpiresAt])`

### WorkerJobPayload

保存 `WorkerJobPayloadRecord` 的 safe persisted payload：

- `jobId String @id`
- `kind String`
- `projectId String`
- `commandId String?`
- `command String`
- `args Json`
- `envNames Json`
- `workingDirectory String?`
- `timeoutMs Int`
- `createdAt DateTime`

本阶段不要给 `WorkerJobPayload.jobId` 增加强制 FK。当前 `InMemoryWorkerRuntime.enqueueSafe()` 的安全顺序是先保存 payload，再保存 job；如果 job save 失败，会 best-effort 删除 payload。强制 FK 会破坏这个顺序，除非同时重写 runtime transaction boundary。Stage 24 v0 先保持 contract，不把 runtime 改成 Prisma transaction 特例。

Required indexes:

- `@@index([projectId, createdAt])`
- `@@index([kind])`

### WorkerLog

保存 bounded lifecycle log：

- `id String @id`
- `type String`
- `message String`
- `workerId String?`
- `workerJobId String?`
- `projectId String?`
- `payload Json`
- `createdAt DateTime`

Worker logs 不需要强制 FK。daemon idle/start/stop logs 可以没有 job；finalization failure 或 claim conflict logs 也应能独立记录。

Required indexes:

- `@@index([projectId, createdAt, id])`
- `@@index([workerId, createdAt, id])`
- `@@index([workerJobId, createdAt, id])`
- `@@index([type, createdAt])`

## Repository Semantics

### WorkerJobRepository

Prisma implementation 必须保持现有 contract 行为：

- `save(record)` upsert by `id`，保存 defensive copy。
- `getById(id)` 返回 defensive copy 或 `undefined`。
- `listForProject(projectId)` 和 `listAll()` 按 `createdAt asc, id asc` 排序。
- `findOldestQueued()` 返回最早 `state === "queued"` 的 job。
- `claimOldestQueued(input)` 只 claim：
  - `state === "queued"`
  - `payloadSource` 与 input 匹配，未设置时按 `"process_memory"` 兼容旧 record
  - 若传入 `projectId`，必须同 project
- claim 必须是条件更新，避免两个 worker claim 同一个 job。Prisma adapter 可以先查候选，再用 `updateMany` 按 `id + state + payloadSource + projectId` 条件更新；更新数为 0 时继续尝试候选或返回 `undefined`。
- `heartbeatClaimed(input)` 只能更新 matching `jobId + claimToken + running state`，且 `claimedByWorkerId` 不冲突。
- `completeClaimed(input)` 只能 terminal matching `jobId + claimToken + running state`。
- `requestRunningCancellation(input)` 只给 running job 写 `cancelRequestedAt` / `cancelReason`；非 running job 返回当前 record。
- `cancelQueued(input)` 只 terminal queued job；非 queued job 返回当前 record。
- `recoverStale(input)` 只处理 running + safe persisted + stale jobs，并保持 requeue / cancel / failed 语义和 `staleRecoveryCount`。

### WorkerJobPayloadRepository

Prisma implementation 必须复用现有 safety validators：

- 只接受 `kind === "safe_simulated_tool_command"`。
- `args`、单个 arg 长度和 `envNames` 数量继续受 `SAFE_WORKER_PAYLOAD_*` 限制。
- `envNames` canonicalize：去重、排序。
- 保存时不得接受或持久化 `env` values，即使调用方传入额外属性。
- `deleteByJobId(jobId)` 幂等；payload 不存在时成功返回。

### WorkerLogRepository

Prisma implementation 必须复用现有 log sanitizer：

- 只保留 allowlisted payload keys。
- `append(record)` upsert by `id` 并返回 sanitized copy。
- `list(input)` 支持 `projectId`、`workerId`、`workerJobId` 和 `limit`，按 `createdAt desc, id desc`。
- `maxRecords` 行为应与 JSON-file repository 一致：append 后保留最新 N 条。Postgres adapter 可以通过 best-effort trim 删除超出上限的旧 logs。

## Data Flow

### Web enqueue

1. `getWebWorkbenchStore()` 创建 worker queue runtime。
2. worker queue factory 解析 `WORKER_REPOSITORY_BACKEND`。
3. JSON path 使用当前 file repositories。
4. Postgres path 创建 Prisma worker job/payload/log repositories。
5. `DemoWorkbenchService` 通过 `workerQueueRuntime.enqueueSafe()` 入队 safe persisted worker job。
6. Web worker queue snapshot 从同一 `WorkerJobRepository` / `WorkerLogRepository` 读取状态。

### Agent worker claim/run

1. `apps/agent-worker` 使用同一 worker queue factory。
2. `runWorkerOnce()` / daemon 从 repository claim oldest queued safe persisted job。
3. claim 后 heartbeat 写回同一 repository。
4. worker 从 `WorkerJobPayloadRepository` 读取 safe payload，执行 deterministic simulated adapter。
5. terminal job 通过 `completeClaimed()` 写回。
6. payload cleanup 通过 `deleteByJobId()` best-effort 删除。
7. lifecycle log 通过 `WorkerLogRepository.append()` 记录。
8. 如果配置了 workbench repositories，finalizer 继续回写 run/tool events；Stage 24 不改变 workbench finalization contract。

### Stale recovery

1. daemon 周期调用 `recoverStaleJobs()`。
2. repository 找到 running + safe persisted + stale jobs。
3. 未超过 recovery limit 的 job requeue，并清理 claim/heartbeat fields。
4. 已请求 cancellation 的 stale job terminal cancelled，并 best-effort 删除 payload。
5. 超过 recovery limit 的 stale job terminal failed，并 best-effort 删除 payload。
6. 每个 recovery result 写 bounded worker lifecycle log。

## Failure Behavior

- `WORKER_REPOSITORY_BACKEND` 非法：fail closed。
- `WORKER_REPOSITORY_BACKEND=postgres` 缺少 `DATABASE_URL`：fail closed。
- Prisma client import / initialization 失败：fail closed，不回退 JSON-file。
- Postgres job save 失败且 payload 已保存：runtime 继续 best-effort 删除 payload；删除失败附着为 cleanup metadata，不吞掉原始错误。
- payload missing：`runClaimedJob()` 按现有 contract terminal failed，`errorName: "worker_job_payload_unavailable"`。
- payload 与 job record 不匹配：terminal rejected，`errorName: "worker_job_payload_record_mismatch"`。
- claim conflict：返回 `undefined` 或抛出当前 contract 已定义的 `worker_job_claim_conflict`，不能重复执行同一个 job。
- log append 失败不能改变已经 terminal 的 job state；调用方仍按现有 error handling 记录 finalization/worker failure。

## Testing Strategy

- Worker runtime shared contract tests：
  - 把当前 in-memory / JSON-file job repository 行为抽成可复用 contract。
  - 新增 fake Prisma 或 real Prisma adapter 的同一 contract run。
  - 覆盖 save/get/list/find oldest queued、claim token、heartbeat、complete claimed、queued cancel、running cancel、stale requeue/cancel/fail。
- Payload repository tests：
  - 抽 shared contract，覆盖 defensive copy、delete、bounds validation、env values 不持久化。
  - Prisma adapter 覆盖 `envNames` canonicalize 和 unsafe payload rejection。
- Worker log repository tests：
  - 抽 shared contract，覆盖 append/upsert、filter、limit、sanitization、maxRecords trim。
- Factory tests：
  - 默认 JSON。
  - memory backend。
  - postgres backend 缺 `DATABASE_URL` fail closed。
  - postgres backend 使用 injected Prisma client / repository factories，避免 unit test 加载 generated client。
  - Web 和 agent-worker 使用同一 backend selection helper。
- Integration tests：
  - 默认跳过。
  - 只有显式 `POSTGRES_WORKER_REPOSITORY_TEST=1` 和 `DATABASE_URL` 时连接真实 Postgres。
  - 覆盖 enqueue safe payload、claim、heartbeat、run claimed job、payload cleanup、log list。
- Regression tests：
  - Web enqueue + agent-worker run-once 使用同一 Postgres-backed repositories。
  - `WORKER_REPOSITORY_BACKEND=postgres` 不需要 `WORKER_JOBS_FILE` / `WORKER_PAYLOADS_FILE`。
  - 默认 JSON backend 现有 tests 继续通过。

## Documentation

需要更新：

- `README.md`：新增可选 worker queue Postgres backend 简短入口。
- `docs/development.md`：说明 `WORKER_REPOSITORY_BACKEND=postgres`、`DATABASE_URL`、默认 JSON-file backend、payload safety 和回退方式。
- `docs/project-roadmap.md`：Stage 24 状态、Stage 25-26 队列和后置项。
- `docs/agent-development-learning.md`：记录 worker queue durable backend、claim token 条件更新、payload safety、日志 bounded sanitization 和不做真实 shell 的边界。
- `docs/superpowers/README.md`：加入本 design 和后续 implementation plan 的阅读顺序。

## Acceptance Criteria

- 默认未设置 `WORKER_REPOSITORY_BACKEND` 时，Web 和 `apps/agent-worker` 继续使用 JSON-file worker queue。
- `WORKER_REPOSITORY_BACKEND=postgres` 且缺少 `DATABASE_URL` 时 fail closed。
- Web enqueue 和 `apps/agent-worker` claim/run 能在同一 Postgres-backed job/payload/log repositories 上完成 safe simulated worker job。
- Prisma worker job repository 保持 claim token 条件更新和 stale recovery contract。
- Prisma worker payload repository 只保存 safe payload，不保存 env values、secret、raw output 或 artifact content。
- Prisma worker log repository 保持 bounded/sanitized payload 和 filter/limit 行为。
- 现有 worker-runtime、agent-worker、Web worker queue tests 继续通过。
- Prisma schema validate、worker repository tests、targeted Web/agent-worker tests 和 `pnpm typecheck` 通过。
