# LP Engineering Team Agent

LP Engineering Team Agent 是一个轻量级 Web 工作台，用于通过智能体式对话创建和管理落地页任务。当前第一版交付目标是 **Skill-only local alpha**：用户可以从大对话入口开始普通问答，发起 LP 复杂任务，看到流式聊天和 live task progress，生成框架无关静态 LP 产物，并通过项目 Skills 扩展上下文和安全命令流程。

生成的落地页产物必须是静态 HTML/CSS/JS。工作台本身是 Next.js 应用，但生成的 LP 输出不应该依赖 React、Vue、Angular、Vite、Next.js 或任何构建步骤。

## Skill-only local alpha 当前范围

- 类 Manus 的 Web 工作台：侧边栏、任务列表、对话优先入口和任务详情布局。
- 普通聊天：默认 deterministic，本地 Web/API 可流式回答；`REAL_MODEL_RUNTIME=1` 时可显式 opt in 真实 provider。
- LP 复杂任务：task-first `Planner -> Builder -> Reviewer -> Deployer` 固定链路，页面通过 live task panel 展示进度和恢复状态。
- `index.html`、`styles.css`、`script.js` 三文件静态产物工作区，支持 artifact preview、export 和 bounded source snippet 读取。
- 项目 Skills：创建 draft、validate、publish、bind、enable/disable，并把已发布绑定的 Skill 作为聊天和 LP 任务的主要扩展路径。
- Skill command queue：已发布 deployment skill command 经过 approval、本地 worker queue、`Run local worker once` 和 safe observation，不开放任意 shell 命令。
- 模型网关配置入口：支持 deterministic、Anthropic Messages compatible 和 OpenAI Chat Completions compatible provider；真实 provider 只通过显式 opt-in 进入。
- 模型调用可见性：真实 provider 路径会在 timeline 中展示 bounded usage、duration、attempt 和 streaming capability summary；deterministic 路径只展示 estimated usage。
- Browser E2E acceptance：`pnpm alpha:e2e` 提供 deterministic Chromium 浏览器验收，覆盖普通聊天、LP live task、artifact preview/export/snippet、Skills / Models / MCP alpha 边界、bounded failure injection 和轻量 layout visual contract。

## Alpha 暂不包含

- MCP 不属于第一版必需路径；MCP 页面可以保留为架构边界，但普通聊天和 LP 生成不需要配置 MCP connector。
- 远端 browser farm、跨浏览器矩阵、pixel-perfect 截图基线，或依赖真实 provider、MCP、Postgres、真实部署的 E2E。
- 真实 provider token delta UI、billing/quota/cost accounting 或自动 fallback provider execution。
- 生产 auth/RBAC、邀请流程、团队审批队列或 hosted deployment。
- production Postgres migrations、object storage migration 或默认 backend 切换。
- 真实 shell runner、真实部署编排、真实 MCP SDK 或 write tools。

这些能力会在后续阶段单独实现，当前 alpha 优先保持本地、单用户、Skill-only、可测试。

## 环境要求

- Node.js 20 或更新版本。
- pnpm 10，与 `package.json` 中的 `packageManager` 保持一致。

安装依赖：

```bash
pnpm install
```

## 环境变量

从模板创建本地环境文件：

```bash
cp .env.example .env.local
```

默认本地开发和 smoke 检查使用 deterministic provider，不需要模型 key：

```env
REAL_MODEL_RUNTIME=0
REAL_MODEL_PROVIDER_TEST=0
```

真实 provider 集成测试需要单独开启：设置 `REAL_MODEL_PROVIDER_TEST=1`，并填写对应 adapter 的 provider 变量。Web/API 真实 runtime 实验也需要单独开启：设置 `REAL_MODEL_RUNTIME=1`，并填写 provider 变量。

无论使用哪条 opt-in 路径，只填写你本地要验证的 provider 区块。OpenAI-compatible adapter 按 `.env.example` 风格配置：

```env
OPENAI_COMPATIBLE_BASE_URL=https://open.bigmodel.cn/api/paas/v4
OPENAI_COMPATIBLE_API_KEY=
OPENAI_COMPATIBLE_DEFAULT_MODEL=glm-5.1
```

提交到仓库的模板中保持 secret 为空，只在本地 `.env.local` 填写真实值。

真实 provider 本地 smoke 的最小路径：

1. 在 `.env.local` 设置 `REAL_MODEL_RUNTIME=1`。
2. 在 Web 的 Models view 创建 provider，选择 `anthropic-messages` 或 `openai-completions`。
3. 使用 `apiKeyEnv` 引用本地环境变量名，不在 UI 或文档中填写真实 key。
4. 为 `assistant`、`planner` 和 `builder` 保存 route。
5. 手动提交一个普通聊天 prompt 和一个 LP prompt；成功的 `model.completed` timeline entry 应显示 bounded usage/duration/streaming summary，失败时应看到 bounded error 或 safe runtime summary，而不是原始 provider response。

默认 `pnpm alpha:check`、`pnpm smoke` 和 `pnpm test` 不会触发真实 provider 调用。

## 本地启动

启动 Web 工作台：

```bash
pnpm dev
```

打开 Next.js 输出的本地地址，通常是：

```text
http://localhost:3000
```

运行一次本地 worker queue。默认读取 JSON-file queue；没有待处理 job 时会输出 `jobId: null`：

```bash
pnpm worker:dev
```

如需运行旧的 deterministic worker demo，可显式设置：

```bash
AGENT_WORKER_MODE=demo pnpm worker:dev
```

## 验证

运行 Skill-only alpha 快速检查：

```bash
pnpm alpha:check
```

`pnpm alpha:check` 是 deterministic readiness gate，不需要浏览器、网络、真实 provider key、MCP server、Postgres 或真实部署。

安装本地 Chromium browser：

```bash
pnpm alpha:e2e:install
```

`pnpm alpha:e2e:install` 会安装本地 Playwright Chromium browser。

运行 browser-level alpha acceptance：

```bash
pnpm alpha:e2e
```

`pnpm alpha:e2e` 会启动本地 Next.js dev server，使用隔离的 `LP_AGENT_WORKBENCH_STATE_FILE`，默认运行 Chromium + deterministic runtime。它不需要真实 provider key、MCP server、Postgres、远端 browser farm 或真实部署。当前 browser gate 覆盖 happy path、bounded failure injection 和轻量 layout visual contract；不会做跨平台 pixel-perfect 截图基线。失败时排查 artifact 位于 `test-results/alpha-e2e-artifacts/` 和 `playwright-report/`，layout contract 会额外留下诊断截图。

运行快速 Skill-only alpha smoke gate：

```bash
pnpm smoke
```

运行全部测试：

```bash
pnpm test
```

运行 TypeScript 检查：

```bash
pnpm typecheck
```

构建所有提供 build script 的 packages/apps：

```bash
pnpm build
```

验证 Prisma schema：

```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm --filter @lp-agent/db db:validate
```

### 可选 Web Postgres backend

Web workbench 默认 backend 仍是 JSON-file state，路径为 `.lp-agent/workbench-state.json`。需要显式 opt-in Postgres backend 时，先生成 Prisma client，再带上 Postgres 配置启动 Web：

```bash
pnpm --filter @lp-agent/db db:generate
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" \
WORKBENCH_REPOSITORY_BACKEND=postgres \
WORKBENCH_POSTGRES_WORKSPACE_ID=workspace_local \
WORKBENCH_POSTGRES_BOOTSTRAP=1 \
pnpm dev
```

`WORKBENCH_POSTGRES_BOOTSTRAP=1` 只 upsert 本地 organization/workspace prerequisites；它不运行 production migrations、不创建 hosted auth，也不迁移既有 JSON-file state。unset `WORKBENCH_REPOSITORY_BACKEND` 或设为 `json` 可回到默认 JSON-file backend。

### 可选 Worker Queue Postgres backend

Worker queue 默认仍使用本地 JSON files：`.lp-agent/worker-jobs.json`、`.lp-agent/worker-payloads.json` 和 `.lp-agent/worker-logs.json`。需要让 Web enqueue 和 `apps/agent-worker` 共用 Postgres worker job / payload / log repository 时，显式开启 worker backend：

```bash
pnpm --filter @lp-agent/db db:generate
WORKER_REPOSITORY_BACKEND=postgres \
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" \
pnpm dev
```

Worker 进程使用同一组环境变量：

```bash
WORKER_REPOSITORY_BACKEND=postgres \
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" \
pnpm worker:dev
```

Postgres worker backend 只影响 worker queue storage，不改变 Web workbench state backend，也不依赖 `WORKBENCH_REPOSITORY_BACKEND`。在 `WORKER_REPOSITORY_BACKEND=postgres` 下不需要 `WORKER_JOBS_FILE` 或 `WORKER_PAYLOADS_FILE`；缺少 `DATABASE_URL`、backend 值非法或 Prisma client 初始化失败时会 fail closed，不会静默回退到 JSON-file queue。

## 手动验收

本地检查 Skill-only alpha 时使用：

```text
docs/web-v1-acceptance.md
```

`pnpm smoke` 用于快速验证 deterministic 核心链路。手动验收清单用于检查可见 UX、语言行为和当前能力边界，这些内容不会全部由单元测试覆盖。

## 文档地图

- `docs/project-roadmap.md` - 当前路线图、下一阶段队列和 backlog 维护规则。
- `docs/development.md` - 本地开发说明。
- `docs/web-v1-acceptance.md` - Skill-only alpha 手动验收清单。
- `docs/agent-development-learning.md` - 中文 Agent 开发学习笔记，记录 Agent 概念、难点和本项目取舍。
- `docs/superpowers/README.md` - Superpowers specs/plans 的时间顺序索引。
- `docs/superpowers/specs/` - 需求和设计 specs。
- `docs/superpowers/plans/` - 实施 plans。

## 开发规则

生成的 LP 代码必须保持框架无关的静态 HTML/CSS/JS。工作台实现可以使用 Next.js，但要和生成产物格式保持清晰边界。
