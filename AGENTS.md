# 仓库协作指南

## 项目结构与模块组织

本仓库是 LP Engineering Team Agent MVP 的 pnpm TypeScript monorepo。

- `apps/web/` 包含 Next.js workbench。
- `apps/agent-worker/` 包含 deterministic worker demo。
- `packages/api/` 编排 in-memory workbench flow。
- `packages/lp-schema/`、`packages/artifacts/`、`packages/runtime-adapters/`、`packages/git-deployment/`、`packages/skills/`、`packages/mcp-gateway/`、`packages/model-gateway/` 是边界清晰的领域包。
- `packages/db/prisma/schema.prisma` 定义 Postgres 数据模型。
- `docs/` 包含设计说明、实施计划和贡献者文档。

不要提交机器本地编辑器状态或生成构建输出。仓库根目录已忽略 `.DS_Store`、`.idea`、`node_modules/`、`.next/`、`.superpowers/`、`test-results/`、`playwright-report/` 和本地 worktrees。

## 构建、测试和开发命令

- `pnpm install` - 安装 workspace 依赖。
- `pnpm dev` - 启动 Next.js Web workbench。
- `pnpm worker:dev` - 运行 demo agent-worker job。
- `pnpm alpha:e2e:install` - 安装本地 Chromium browser，用于 Stage 31 browser E2E。
- `pnpm alpha:e2e` - 运行 deterministic Playwright browser acceptance；默认使用隔离 JSON state，不依赖真实 provider、MCP、Postgres 或真实部署。
- `pnpm test` - 运行全部 Vitest 测试。
- `pnpm typecheck` - 对所有 workspace packages/apps 做 TypeScript 检查。
- `pnpm build` - 构建所有提供 build script 的 packages/apps。
- `DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm --filter @lp-agent/db db:validate` - 在不连接真实数据库的情况下验证 Prisma schema。

## 代码风格和命名

遵循 workspace 现有 TypeScript 风格。JSON/YAML/Markdown 和 TypeScript/TSX 文件使用 2 空格缩进。

使用描述性命名。Markdown 和 config 文件优先用 `kebab-case`，Python 模块用 `snake_case`，JavaScript/TypeScript 按场景使用 `camelCase` 或 `PascalCase`。

## 测试规则

Vitest 配置在 workspace 根目录。Package 和 app 测试文件与源码放在一起，命名为 `*.test.ts`。

测试名称应描述行为，例如 `services.test.ts` 或 `worker.test.ts`。测试应保持 deterministic，不依赖本地 IDE 设置或机器特定路径。

## Commit 和 Pull Request 规则

当前 Git history 使用简短祈使句 commit 风格，例如 `add .gitignore to exclude .DS_Store and .idea files`。继续使用简短、小写、祈使句摘要。

Pull request 应包含简要说明、变更原因、运行过的验证命令，以及用户可见行为相关的截图或日志。有关联 issue 时要链接，并清楚列出 follow-up work。

## Agent 专用规则

编辑前先检查当前工作树，保留无关用户改动。生成文件保持聚焦；当新 tooling、目录或 workflow 成为仓库一部分时，同步更新本指南。即使 workbench 是 Next.js app，生成的 LP artifact 本身仍必须保持框架无关静态 HTML/CSS/JS。

创建、重命名、替换或实质更新 `docs/superpowers/specs/` 或 `docs/superpowers/plans/` 下的 Superpowers spec/plan 时，必须在同一变更中更新 `docs/superpowers/README.md`，确保未来 agent 和开发者能看到准确阅读顺序和文档用途。

新增或实质更新 Superpowers spec/plan 默认使用中文。保留代码、命令、文件名、环境变量、API protocol、错误码和 schema/type 名称的英文原文。历史英文 spec/plan 不要求一次性全量翻译；当它们被实质更新、重写或继续作为当前阶段依据时，再同步中文化。

新增或实质修改 agent runtime、run orchestration、context assembly、skills、model routing、MCP/tool execution、artifact workspace、multi-agent coordination，或与 Agent 学习相关的 specs/plans 时，必须在同一变更中更新 `docs/agent-development-learning.md`，让中文 Agent 开发笔记保持当前事实。该文件只记录 Agent 开发概念、难点、实现取舍和本项目 Agent 实践。更新前先判断变更是否讲清或改变了某个 Agent 概念或边界；普通项目维护不应写入，除非它直接影响 Agent runtime、context、tools、models、memory、retrieval、recovery、approval、observability 或 multi-agent coordination。

当一个阶段完成、新阶段被规划，或推荐下一阶段优先级变化时，必须在同一变更中更新 `docs/project-roadmap.md`。未来 agent 选择下一阶段前应先读 roadmap，而不是只根据最新 commit history 推断优先级。

阶段完成前必须执行收尾检查，不得只提交实现代码或只写 completion note：

- 确认当前工作区和目标分支包含本阶段实现；如果使用独立 worktree 或阶段分支，先确认已合并，或在最终回复中明确说明尚未合并。
- 检查 `docs/project-roadmap.md` 已同步：已完成阶段状态、当前状态快照、明确后置项、推荐下一阶段队列和决策记录都与当前事实一致。
- 推荐下一阶段队列不得为空，默认保持 3-5 个近期阶段；每个近期阶段都要写清建议范围和非目标。
- 涉及 `docs/superpowers/specs/` 或 `docs/superpowers/plans/` 的新增或实质更新时，同步检查 `docs/superpowers/README.md`。
- 涉及 Agent runtime、context、tools、models、memory、retrieval、recovery、approval、observability 或 multi-agent coordination 的变更时，同步检查 `docs/agent-development-learning.md`。
- 运行与本阶段风险相称的验证命令，并在最终回复或 PR 描述中列出；无法运行时说明具体原因。
