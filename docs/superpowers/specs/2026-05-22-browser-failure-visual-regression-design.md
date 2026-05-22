# Stage 34 Browser Failure Injection and Visual Regression v0 Design

**日期：** 2026-05-22

**状态：** 已实现。

## 背景

Stage 31 已经建立 deterministic Playwright browser acceptance gate，覆盖普通聊天 streaming、LP live task、artifact preview/export/snippet、Skills / Models / MCP alpha boundary 和基础 recovery error display。Stage 32/33 继续补齐 provider usage metadata 和 manual alpha UX tightening。

当前 `pnpm alpha:e2e` 仍主要证明 happy path 和少量 bounded error 可见。进入内部 alpha 前，需要把 browser gate 扩展到更接近日常失败排查的 deterministic failure injection，并加入轻量视觉/布局断言，防止用户第一屏、composer、sidebar、artifact failure state 这类 browser-visible contract 被无意破坏。

## 目标

1. 在默认 `pnpm alpha:e2e` 中增加 deterministic failure injection：
   - recovery error display；
   - Models provider fail-closed query error；
   - artifact snippet invalid path / unknown path graceful failure；
   - Skills worker queue bounded error display。
2. 增加轻量 visual regression v0：
   - 固定 desktop viewport；
   - 校验 sidebar、workspace、composer、entry panel 的关键 bounding boxes；
   - 生成诊断 screenshot artifact 供失败排查；
   - 不引入跨平台 brittle screenshot baseline。
3. 保持默认 browser gate 无 key、无 MCP server、无 Postgres、无真实部署、无远端 browser farm。
4. 更新 README、manual acceptance、roadmap 和 Superpowers 索引，让 failure artifacts、视觉断言范围和非目标清楚。

## 非目标

- 不引入远端 browser farm、跨浏览器矩阵或全量截图基线平台。
- 不把 pixel-perfect UI 或临时视觉细节固化成 product contract。
- 不让默认 `pnpm alpha:e2e` 依赖真实 provider key、MCP server、Postgres 或真实部署。
- 不改变 Web runtime protocol、LP agent chain、model gateway、MCP execution、worker execution 或 run event schema。
- 不做大型 UI redesign、production observability stack、auth/RBAC、真实 shell runner 或真实部署编排。

## 方案

### Failure injection

优先复用现有 browser-visible safe inputs：

- query string error code：`recoveryError`、`modelError`、`workerError`；
- artifact snippet query：`artifactPath`；
- 真实 UI flow 创建 project / task，避免伪造 production cookie。

这些 failure injection 不新增 test-only production route，也不把 raw provider response、secret、本机路径、raw artifact content 或 raw stdout/stderr 暴露给页面。

### Visual regression v0

采用布局 contract 而不是截图 baseline：

- 断言 `aside.sidebar` 固定在 viewport 左侧，宽度在稳定范围内；
- 断言 `section.chatWorkspace` 从 sidebar 右侧开始；
- 断言 `form.composerDock` 位于 viewport 底部，并且 prompt input / send button 落在 composer 内；
- 断言 document 没有水平滚动；
- 保存一张 `empty-workbench-layout.png` 诊断截图到 Playwright output，便于失败时人工比对。

这样能覆盖关键 layout regression，同时避免 OS/font/Chromium 小版本导致 snapshot flakiness。

## 测试策略

- 新增 `apps/web/e2e/alpha-failures.spec.ts`：
  - bounded recovery error 不泄漏 secret-like values；
  - Models fail-closed error 在 active project 下可见；
  - artifact invalid path failure 不泄漏 query 中的 raw path/secret；
  - Skills worker queue error 在 active project 下可见。
- 新增 `apps/web/e2e/alpha-visual.spec.ts`：
  - 空首页 layout contract；
  - diagnostic screenshot artifact。
- 扩展 `apps/web/e2e/helpers.ts`：
  - project creation helper；
  - visual layout assertion helper。

最终验证至少包含：

```bash
pnpm alpha:check
pnpm smoke
pnpm test
pnpm typecheck
pnpm build
pnpm alpha:e2e
git diff --check
```

`pnpm alpha:e2e` 如遇本地 sandbox 端口绑定限制，可在批准后以同一命令重跑。

## 文档更新

实现阶段需要同步更新：

- `README.md`：说明 browser gate 已覆盖 failure injection 和轻量 visual layout contract，并说明 artifacts。
- `docs/web-v1-acceptance.md`：更新 Browser E2E 自动验收范围和已知后续工作。
- `docs/project-roadmap.md`：Stage 34 状态、完成范围、Stage 35/36/37 推荐队列。
- `docs/superpowers/README.md`：新增 Stage 34 spec/plan 索引。

本阶段只扩展 browser acceptance 和文档，不改变 Agent runtime、context、tools、models、memory、retrieval、recovery、approval、observability 或 multi-agent coordination 的概念边界，因此默认不更新 `docs/agent-development-learning.md`。
