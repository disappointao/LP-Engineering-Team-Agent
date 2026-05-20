# 开发说明

## 先从这里开始

全新本地环境请先阅读根目录 [README](../README.md)。那里记录了安装命令、环境变量、Web V1 smoke 命令和手动验收清单。

本文只保留基础应用跑起来之后更深入的开发说明。

## 前置条件

- 与 workspace 依赖兼容的 Node.js。
- pnpm。
- 可选 Postgres 实例，用于未来 DB-backed 开发。

## 命令

常见安装、启动、smoke、测试、typecheck 和 build 命令以根目录 [README](../README.md) 为准。根目录 `package.json` scripts 是这些通用命令的 source of truth，本文只补充更偏开发内部的命令。

专项开发命令：

- `DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm --filter @lp-agent/db db:validate` 验证 Prisma schema。

### Web Postgres backend opt-in

Web workbench 默认使用 JSON-file state，路径为 `.lp-agent/workbench-state.json`。Postgres backend 必须显式开启：

```bash
pnpm --filter @lp-agent/db db:generate
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" \
WORKBENCH_REPOSITORY_BACKEND=postgres \
WORKBENCH_POSTGRES_WORKSPACE_ID=workspace_local \
WORKBENCH_POSTGRES_BOOTSTRAP=1 \
pnpm dev
```

Postgres 路径需要 `DATABASE_URL` 和 `WORKBENCH_POSTGRES_WORKSPACE_ID`；缺失时 fail closed，不会静默回退到 JSON-file。`WORKBENCH_POSTGRES_BOOTSTRAP=1` 只 upsert 本地 organization/workspace prerequisites，不运行 production migrations、不创建 hosted auth、不迁移既有 JSON-file state，也不把 worker job queue 切到 Postgres。

unset `WORKBENCH_REPOSITORY_BACKEND` 或设为 `json` 可回到默认 JSON-file backend。

## 当前 MVP 行为

第一版实现使用 deterministic 本地服务处理模型调用、runtime execution、MCP 可见性和 Git deployment handoff。边界与 v1 设计保持一致，因此后续真实 provider 可以替换这些实现，而不需要改变产品流程。

Stage 2 从 repository contract 开始，把 workbench records 放到 `@lp-agent/db` 后面。默认本地实现仍然是 in-memory，方便 deterministic 测试；但 `@lp-agent/api` 已经依赖 repository interface，而不是私有 map，因此未来 Prisma/Postgres repository 可以替换 in-memory 实现，不影响 Web 或 worker caller。

Stage 2 Milestone 6 已经持久化 deterministic planner、builder、reviewer、deployer run records 和 ordered run events。Runtime call 现在先经过 context assembly 边界，再进入 local runtime adapter。第一版 context pack 包含 project/task input、已发布项目 skills、visible MCP tools、model routing policy、approval state 和 artifact workspace metadata；compression、retrieval、streaming、real tool execution 和 real model providers 仍是后续阶段。

生成的 LP 输出保持静态 HTML/CSS/JS。Next.js app 只是用于创建、预览、review 和 handoff 这些 artifact 的 workbench shell。
