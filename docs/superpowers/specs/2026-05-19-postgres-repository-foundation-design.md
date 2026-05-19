# Stage 22：Postgres Repository Foundation v0 设计

## 背景

Stage 18-21 已经把 Agent run lifecycle、worker queue、read-only MCP execution 和真实模型 repair/retry/fallback 做到可观察、可审计的本地 MVP 状态。当前默认数据层仍是 in-memory / JSON-file repositories，这适合 deterministic tests、本地 demo 和 desktop-friendly development，但不适合作为多人共享、后台 worker、长期 audit 和未来 auth/RBAC 的基础。

仓库已经有 `packages/db/prisma/schema.prisma`，但它明显落后于当前 `WorkbenchRepositories` contract：缺少 tasks、messages、task snapshots、agent handoffs、artifact workspace records；`Run` 缺少 `taskId`、`startedAt`、`completedAt`、`contextSummary`；`RunEvent` 缺少 `projectId`、`taskId`、`message`；artifact workspace 和 file metadata 也还没有 schema 表达。因此 Stage 22 不能直接“切换到 Postgres”，需要先做一个聚焦的 repository foundation。

## 目标

- 让 Prisma schema 与当前核心 `WorkbenchRepositories` contract 对齐，先覆盖 agent runtime 和 Web workbench 高风险状态。
- 新增 Prisma/Postgres-backed repository adapter 的架构边界，但默认本地开发和测试仍保留 in-memory / JSON-file repositories。
- 为后续真实多人 workspace、durable worker finalization、审计查询和 hosted auth/RBAC 打基础。
- 保持现有安全边界：raw tool output、secret、完整 artifact 内容和本机路径不能因为进入 Postgres 而扩散到 timeline、context 或 Web state。
- 让 Stage 22 可以被分成可测试、可回滚的小任务，而不是一次性重写整个数据层。

## 非目标

- 不在本阶段实现完整 hosted auth、invite flow、复杂 RBAC 或真实多租户安全边界。
- 不把 default Web/runtime backend 切换到 Postgres；Postgres adapter 先通过显式 factory / opt-in 使用。
- 不做 object storage、binary asset storage、artifact full-content storage strategy 或生产备份策略。
- 不做 production deployment architecture、connection pooling、migration rollout automation 或 cloud hosting。
- 不一次性实现所有 repository 的 Prisma backend；Skills、MCP connector、model provider、deployment 等可在 foundation 稳定后继续补。
- 不替换 worker runtime 自己的 JSON-file job repository；只为 workbench-side run/tool/handoff/artifact metadata 打 Postgres 基础。

## 当前边界

`@lp-agent/db` 已经定义了统一 repository contract：

- `createInMemoryWorkbenchRepositories()` 用于 deterministic unit tests 和 service tests。
- `createJsonFileWorkbenchRepositories()` 用于本地 Web persistence。
- `WorkbenchRepositories` 已覆盖 projects、members、briefs、page versions、artifact workspaces、deployments、tasks、messages、task snapshots、skills、model routing、MCP、runs、run events、tool observations 和 agent handoffs。

Stage 22 应新增第三个 backend，而不是修改 API/service 调用方的业务语义。服务层仍依赖 `WorkbenchRepositories`，Postgres 只是新的实现。

## 设计

### 1. Prisma schema 对齐

先把 schema 补到能表达当前核心 records：

- `Project`：repository contract 只有 `id`、`name`、`createdAt`，而当前 Prisma `Project` 需要 `workspaceId`。Stage 22 v0 不修改 `ProjectRecord` contract，Prisma adapter 应通过 factory option 绑定一个 default workspace，并在保存 project 前确保该 workspace 存在；读取时仍只返回 repository contract 需要的字段。
- `WorkbenchTask`：保存 task id、title、type、status、可选 projectId、createdAt。
- `WorkbenchMessage`：保存 message id、taskId、role、content、createdAt，并按 task/time 查询。
- `WorkbenchTaskSnapshot`：保存 taskId、projectId、briefId、pageVersionId、createdAt。
- `LPBrief`：当前 Prisma `data` 对应 repository `brief`，需要补 `prompt`。
- `PageVersion`：当前 Prisma `artifactData` 对应 repository `artifacts`，需要补 `artifactWorkspaceId`、`findings`。
- `ArtifactWorkspace`：保存 workspace id、projectId、pageVersionId、kind、manifest、summary、createdAt。
- `ArtifactWorkspaceFile`：保存 file id、workspaceId、projectId、pageVersionId、path、kind、byteSize、hash、content 或 storage metadata。本阶段如保存 content，也只能作为 repository backend 内容，不得进入 event/context；后续可迁移到 object storage。
- `Run`：保存 run id、projectId、taskId、role、state、startedAt、completedAt、contextSummary。
- `RunEvent`：保存 event id、runId、projectId、taskId、sequence、type、message、payload、createdAt，并保持 `(runId, sequence)` 唯一。
- `ToolObservation`：继续保存安全 input / outputSummary / state / error metadata，避免 raw output。
- `AgentHandoff`：保存 handoff id、projectId、taskId、fromRunId、fromRole、toRole、state、summary、blockingReason、artifactRefs、createdAt、updatedAt。

Schema 应优先匹配 TypeScript contract，而不是让 API 适配旧 Prisma 形状。

### 2. Prisma repository adapter 边界

新增 adapter 时保持三层：

1. Prisma client boundary：只在 `packages/db` 内部引用 `@prisma/client`。
2. Record mapper：把 Prisma row 转成 repository record，把 repository record 转成 Prisma create/update data。
3. Repository classes：实现 `ProjectRepository`、`RunRepository` 等接口。

建议新增：

- `packages/db/src/prisma-workbench-repositories.ts`
- `packages/db/src/prisma-workbench-repositories.test.ts`
- `packages/db/src/workbench-repository-contract.test.ts` 或 shared contract helpers，用同一组行为测试复用到 in-memory、JSON-file 和 Prisma backend。

如果测试环境没有真实 Postgres，本阶段 plan 应先用 mapper/unit tests 和 `prisma validate` 覆盖基础行为；真实数据库集成测试必须显式 opt-in，例如 `POSTGRES_REPOSITORY_TEST=1`。

### 3. 第一批 repository 范围

第一批实现只覆盖能支撑 Agent runtime 可观察性的核心链路：

- `projects`
- `tasks`
- `messages`
- `taskSnapshots`
- `briefs`
- `pageVersions`
- `artifactWorkspaces`
- `artifactWorkspaceFiles`
- `runs`
- `runEvents`
- `toolObservations`
- `agentHandoffs`

这些记录构成 “用户任务 -> Agent run -> event timeline -> tool observation -> handoff -> artifact workspace” 的闭环。其它 repositories 暂时可不提供 Prisma 实现，或者在 factory 中明确 fail fast，避免调用方误以为已经全量可用。

### 4. Factory 与 opt-in

Postgres backend 不能悄悄替换默认本地行为。本阶段只提供显式 factory：

```ts
createPrismaWorkbenchRepositories({ prisma, workspaceId })
```

`workspaceId` 用于把当前 workspace-less `ProjectRecord` contract 映射到 Prisma 的 workspace/project relation。Factory 初始化应确保 workspace 存在，或在缺少 workspace 时 fail closed；不要让 `ProjectRepository.save()` 在业务层不可见地创建任意 organization/workspace 层级。

如果后续 Web 要接入，应再增加独立配置开关，例如 `WORKBENCH_REPOSITORY_BACKEND=postgres`，并在缺少 `DATABASE_URL`、`workspaceId` 或 Prisma client 不可用时 fail closed。这个 Web 切换不属于 Stage 22 foundation 的必做范围。

### 5. 安全和审计

Postgres 会让状态更 durable，所以必须继续保持现有脱敏原则：

- `RunEvent.payload` 只保存安全摘要，不保存 raw model output、raw tool output、secret、API key env value 或完整 artifact 内容。
- `ToolObservation.outputSummary` 是安全摘要；如未来需要 raw output，应进入单独受控日志/observation storage，不复用 timeline payload。
- `ArtifactWorkspaceFile.content` 如果在 v0 保存到 Postgres，只能通过 artifact reader 的 bounded snippet / ownership check 读取，不能直接注入 context。
- 所有 `listForProject` / `listForTask` / `listForRun` 查询必须按 repository contract 保持 scope 过滤和稳定排序。

## 数据流

1. Web/API 通过 `DemoWorkbenchService` 或 Web store 创建 project/task/message。
2. Service 通过 `WorkbenchRepositories` 保存 run、run events、tool observations 和 handoffs。
3. Prisma adapter 把 repository record 映射为 Prisma row。
4. Lifecycle、context assembler、artifact reader 和 Web timeline 继续从 `WorkbenchRepositories` 读取，不知道底层是 JSON-file 还是 Postgres。
5. 默认开发路径仍使用 JSON-file；Postgres 通过显式 factory 或未来 opt-in backend 使用。

## 错误处理

- Schema validation 失败时不启动 Postgres backend。
- Prisma unique constraint 冲突应表现为 repository save/upsert 语义，而不是泄漏数据库错误到业务层。
- 缺少外键目标时 fail closed；不要自动创建 project/run/page version。
- 未实现的 Prisma repository 必须在 factory 创建时明确不可用，或不暴露为完整 `WorkbenchRepositories`，避免运行中半途失败。
- 集成测试缺少 `DATABASE_URL` 时应 skip，不应误连开发者本地默认数据库。

## 测试策略

- `DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm --filter @lp-agent/db db:validate` 验证 Prisma schema。
- Existing in-memory / JSON-file tests 继续通过，证明默认 backend 未被破坏。
- Mapper tests 覆盖 JSON fields、dates、optional fields、artifact refs、context summary 和 ordering。
- Shared repository contract tests 覆盖第一批 Prisma repositories 与现有 backend 行为一致。
- Opt-in Postgres integration tests 只在 `POSTGRES_REPOSITORY_TEST=1` 且 `DATABASE_URL` 存在时运行。

## Roadmap 影响

Stage 22 完成后，roadmap 应把 “Postgres repository 实现” 从明确后置移动到已完成基础能力，并新增后续 backlog：

- Web opt-in Postgres backend wiring。
- Auth/RBAC on top of Postgres。
- Object storage / artifact file content migration。
- Prisma migrations and production deployment docs。
- Worker job repository Postgres backend。

## 实施计划默认决策

- `ArtifactWorkspaceFile.content` 在 Stage 22 v0 可以直接进 Postgres，以保持 local MVP 简单；必须保留 artifact reader 的 bounded access、ownership check 和 context no-content guard。
- Prisma client 生成物应作为 implementation plan 的第一步确认；如果当前 package 缺少 `@prisma/client` runtime dependency，应按最小依赖改动补齐并用 typecheck 验证。
- 第一版 Prisma backend 只有在本 spec 的第一批 repositories 全部实现后才暴露完整 `WorkbenchRepositories` factory；在此之前使用内部 helpers 或 partial contract tests。
- `ProjectRecord` 不新增 `workspaceId`；Prisma adapter 用 factory-level `workspaceId` 处理 Prisma relation 映射。
