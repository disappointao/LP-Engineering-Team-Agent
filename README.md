# LP Engineering Team Agent

LP Engineering Team Agent 是一个轻量级 Web 工作台，用于通过智能体式对话创建和管理落地页任务。第一版聚焦本地 Web MVP：用户可以从大对话入口开始，创建或继续项目，执行普通聊天任务，并生成框架无关的静态 LP 产物。

生成的落地页产物必须是静态 HTML/CSS/JS。工作台本身是 Next.js 应用，但生成的 LP 输出不应该依赖 React、Vue、Angular、Vite、Next.js 或任何构建步骤。

## 当前范围

- 类 Manus 的 Web 工作台：侧边栏、任务列表、对话优先入口和任务详情布局。
- 普通任务和 LP 生成任务的确定性本地流程。
- `index.html`、`styles.css`、`script.js` 三文件静态产物工作区。
- Artifact preview 和选中文件的 bounded source snippet 读取。
- 模型网关配置入口，支持 deterministic、Anthropic-style 和 OpenAI-compatible provider。
- Skills、MCP、模型路由、项目记忆和 Agent runtime 已作为架构边界存在，并按阶段逐步实现。

## 第一版 Web MVP 暂不包含

- 内置生产部署流程。
- Web UI 中的真实 MCP tool execution。
- 长时间运行的 sandboxed shell execution。
- 带持久上下文压缩的完整 multi-agent runtime。
- 桌面应用打包。

这些能力会在后续阶段单独实现，当前代码优先保持小而可测试。

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

## 本地启动

启动 Web 工作台：

```bash
pnpm dev
```

打开 Next.js 输出的本地地址，通常是：

```text
http://localhost:3000
```

运行 deterministic worker demo：

```bash
pnpm worker:dev
```

## 验证

运行快速 Web V1 smoke gate：

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

## 手动验收

本地检查 Web V1 时使用：

```text
docs/web-v1-acceptance.md
```

`pnpm smoke` 用于快速验证 deterministic 核心链路。手动验收清单用于检查可见 UX、语言行为和当前能力边界，这些内容不会全部由单元测试覆盖。

## 文档地图

- `docs/project-roadmap.md` - 当前路线图、下一阶段队列和 backlog 维护规则。
- `docs/development.md` - 本地开发说明。
- `docs/web-v1-acceptance.md` - Web V1 手动验收清单。
- `docs/agent-development-learning.md` - 中文 Agent 开发学习笔记，记录 Agent 概念、难点和本项目取舍。
- `docs/superpowers/README.md` - Superpowers specs/plans 的时间顺序索引。
- `docs/superpowers/specs/` - 需求和设计 specs。
- `docs/superpowers/plans/` - 实施 plans。

## 开发规则

生成的 LP 代码必须保持框架无关的静态 HTML/CSS/JS。工作台实现可以使用 Next.js，但要和生成产物格式保持清晰边界。
