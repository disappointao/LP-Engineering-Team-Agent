# Stage 23：Web Opt-in Postgres Backend Wiring v0 设计

## 背景

Stage 22 已经把 Prisma schema 和 Agent runtime 核心 `WorkbenchRepositories` contract 对齐，并提供 `createPrismaWorkbenchRepositories({ prisma, workspaceId })`。但当前 Web workbench 仍在 `getWebWorkbenchStore()` 中默认创建 JSON-file repositories，只有测试和手动 integration path 能使用 Prisma-backed repository。

Stage 23 的目标是让 Web/API runtime 在显式 opt-in 下使用 Postgres backend，证明同一套 workbench flow 可以从 JSON-file 切换到 Prisma/Postgres，同时继续保持默认本地开发路径 deterministic。

当前还有一个实现约束：Stage 22 的 Prisma adapter 只覆盖核心 Agent runtime 可观察性闭环。Web 页面实际还会读取或写入 `projectMembers`、`deployments`、skills、model routes、MCP connectors/approvals 等 repositories。如果 Stage 23 只把 Web factory 指向现有 Prisma adapter，页面会在这些未实现 repository 上 fail closed。因此 Stage 23 需要补齐一个 Web-facing Prisma repository closure，而不是做一个半可用的 Postgres 模式。

## Goals

- 增加显式 Web backend 选择：`WORKBENCH_REPOSITORY_BACKEND=json | memory | postgres`。
- 默认行为保持不变：未配置时 Web 继续使用 JSON-file repository，测试仍可注入 in-memory repository。
- `postgres` 模式必须显式配置 `DATABASE_URL` 和 `WORKBENCH_POSTGRES_WORKSPACE_ID`；缺少必需配置时 fail closed。
- 为 Web 当前会访问的 repository surface 补齐 Prisma-backed implementation，避免 Postgres 模式进入 split-brain 或半可用状态。
- 提供显式 bootstrap path，在开发环境创建 organization/workspace prerequisites；不隐式创建 hosted tenant。
- 增加 Web/API backend factory tests、Prisma repository tests、最小 Postgres-backed Web flow 覆盖和开发文档。
- 同步 roadmap、Superpowers 索引和 Agent 开发学习笔记。

## Non-Goals

- 不做 production migration strategy。
- 不做 hosted auth、真实 invite flow、复杂 RBAC 或多租户安全上线声明。
- 不迁移 artifact file content 到 object storage。
- 不把 worker job queue、worker payload、worker lifecycle log 切到 Postgres。
- 不接真实 MCP SDK 或 remote MCP server adapter。
- 不改变默认本地开发 backend。
- 不清理或自动迁移已有 `.lp-agent/workbench-state.json` 数据。

## Backend Selection

新增 Web repository factory，建议放在 `apps/web/src/lib/workbench-repository-factory.ts`，由 `getWebWorkbenchStore()` 调用。

配置语义：

- `WORKBENCH_REPOSITORY_BACKEND` 未设置或为 `json`：使用 `createJsonFileWorkbenchRepositories({ filePath })`。
- `WORKBENCH_REPOSITORY_BACKEND=memory`：使用 `createInMemoryWorkbenchRepositories()`，主要用于测试或临时本地调试。
- `WORKBENCH_REPOSITORY_BACKEND=postgres`：动态加载 `@prisma/client` 和 `createPrismaWorkbenchRepositories()`。
- 其他值：启动时 fail closed，抛出明确配置错误。

`postgres` 必需环境变量：

- `DATABASE_URL`：Prisma/Postgres 连接字符串。
- `WORKBENCH_POSTGRES_WORKSPACE_ID`：当前 Web runtime 使用的 workspace id。

`postgres` 可选 bootstrap 环境变量：

- `WORKBENCH_POSTGRES_BOOTSTRAP=1`：允许开发环境启动时 upsert prerequisites。
- `WORKBENCH_POSTGRES_ORGANIZATION_ID`：bootstrap 时使用的 organization id，默认可为 `org_local`.
- `WORKBENCH_POSTGRES_ORGANIZATION_NAME`：bootstrap 时使用的 organization name。
- `WORKBENCH_POSTGRES_WORKSPACE_NAME`：bootstrap 时使用的 workspace name。

缺少 `WORKBENCH_POSTGRES_WORKSPACE_ID` 时，即使 `WORKBENCH_POSTGRES_BOOTSTRAP=1` 也不自动生成 workspace id。workspace id 是持久边界，必须由配置显式声明。

## Repository Closure

Stage 23 应补齐 Web 当前会访问的 Prisma repository surface：

- `projectMembers`
- `deployments`
- `skills`
- `skillVersions`
- `skillBindings`
- `modelProviders`
- `modelRoutingPolicies`
- `mcpConnectors`
- `mcpToolApprovals`

已有 Stage 22 repository 继续保留：

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

如果 Prisma schema 尚不能表达 repository contract 的字段，Stage 23 应先对齐 schema，而不是在 mapper 中丢字段。例如 `ProjectMemberRecord.displayName` / `updatedAt`、`SkillVersionRecord.contentType`、`MCPConnectorRecord.description` / `tools`、`MCPToolApprovalRecord` 都必须能 round-trip。

`workspaceMembers` 可以继续不接入 Web flow；如果本阶段没有实际调用它，可以保留 unsupported repository，并在 tests 中明确它不是 Web Postgres path 的一部分。

## Data Flow

### Default JSON path

1. `getWebWorkbenchStore()` 调用 Web repository factory。
2. factory 解析 backend 为 `json`。
3. 使用 `LP_AGENT_WORKBENCH_STATE_FILE` 或 `.lp-agent/workbench-state.json`。
4. Web flow 行为保持当前状态。

### Postgres path

1. `getWebWorkbenchStore()` 调用 Web repository factory。
2. factory 解析 backend 为 `postgres`。
3. 校验 `DATABASE_URL` 和 `WORKBENCH_POSTGRES_WORKSPACE_ID`。
4. 动态创建 singleton Prisma client。
5. 如果 `WORKBENCH_POSTGRES_BOOTSTRAP=1`，upsert organization/workspace prerequisites。
6. 调用 `createPrismaWorkbenchRepositories({ prisma, workspaceId })`。
7. `DemoWorkbenchService` 和 Web store 继续只依赖 `WorkbenchRepositories` contract。

Prisma client 应缓存到 `globalThis`，避免 Next.js dev reload 反复创建连接。测试应能注入 fake env / fake repository factory，不要求真实 Postgres。

## Failure Behavior

- backend 值非法：启动时抛出配置错误，例如 `Unsupported WORKBENCH_REPOSITORY_BACKEND`.
- `postgres` 缺少 `DATABASE_URL`：启动时 fail closed。
- `postgres` 缺少 `WORKBENCH_POSTGRES_WORKSPACE_ID`：启动时 fail closed。
- 未开启 bootstrap 且 workspace prerequisite 不存在：repository 写入 project 时会因数据库约束失败；开发文档必须说明先 bootstrap 或手动 seed。
- Prisma import 或 client 初始化失败：启动时 fail closed，不回退到 JSON-file，避免用户误以为正在使用 Postgres。
- 某个 Web-required Prisma repository 未实现：测试应失败；不能把 unsupported repository 留到运行时页面报错。

## Testing Strategy

- Web repository factory unit tests：
  - 默认 backend 解析为 JSON-file。
  - `memory` 返回 in-memory repository。
  - `postgres` 缺少 `DATABASE_URL` fail closed。
  - `postgres` 缺少 `WORKBENCH_POSTGRES_WORKSPACE_ID` fail closed。
  - 非法 backend fail closed。
  - `postgres` 使用动态 Prisma repository factory，并在 bootstrap 开启时 upsert prerequisites。
- Prisma mapper / repository tests：
  - 覆盖 Stage 23 新增 repository 的 Date、JSON、optional field 和 scope/targetKey round-trip。
  - 对 Web-required repository 增加 contract-style tests。
- Web/API flow tests：
  - 用 fake Prisma client 或 Prisma repository fake 覆盖 `createProject`、LP generation task、page state loading、model/MCP/skill 空状态读取、project member loading。
- Opt-in Postgres integration：
  - 继续默认跳过。
  - 只有显式 `POSTGRES_REPOSITORY_TEST=1` 和 `DATABASE_URL` 时运行。
  - 覆盖 bootstrap prerequisites 和最小 Web-facing repository flow。

## Documentation

需要更新：

- `docs/development.md`：新增 Web Postgres opt-in 启动说明、必需 env、bootstrap env、回到默认 JSON-file backend 的说明。
- `README.md`：只加入简短入口和验证命令，不展开生产部署。
- `docs/project-roadmap.md`：Stage 23 状态和下一阶段建议。
- `docs/agent-development-learning.md`：记录 repository backend selection、fail closed、避免 split-brain 的 Agent runtime 学习点。
- `docs/superpowers/README.md`：加入本 design 和后续 implementation plan 的阅读顺序。

## Acceptance Criteria

- 默认运行不设置 `WORKBENCH_REPOSITORY_BACKEND` 时，Web 仍使用 JSON-file backend。
- `WORKBENCH_REPOSITORY_BACKEND=postgres` 且缺少必需 env 时 fail closed。
- `WORKBENCH_REPOSITORY_BACKEND=postgres` 且配置完整时，Web store 使用 Prisma-backed `WorkbenchRepositories`。
- Web 当前读取的 project member、deployment、skills、models、MCP state 不会因为 unsupported Prisma repository 在页面加载时失败。
- 最小 LP generation flow 的 project/task/message/snapshot/run events/tool observations/handoffs/artifact workspace metadata 能通过 Prisma-backed repository contract 保存和读取。
- `pnpm --filter @lp-agent/db test`、相关 Web factory tests、`pnpm typecheck`、Prisma schema validate 通过。
