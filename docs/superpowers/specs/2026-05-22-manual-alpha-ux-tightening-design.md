# Stage 33 Manual Alpha UX Tightening v0 Design

**日期：** 2026-05-22

**状态：** 进行中。

## 背景

Stage 30-32 已经把本地单用户 alpha 主路径推进到可验收状态：普通聊天支持 streaming，LP 复杂任务能跑通固定 agent chain，artifact preview/export/snippet、Skills、Models、MCP alpha 边界和 provider usage metadata 已有 deterministic 自动验收。

继续进入真实用户手动 alpha 前，页面仍存在一些日常摩擦：

- 左侧项目、任务和新任务入口看起来可操作，但部分按钮只是静态 UI，容易让用户误判当前上下文是否已切换。
- 首页 entry chips 和任务建议按钮是视觉 affordance，但不能直接提交 prompt。
- 空状态用示例 task title 占位，和真实任务列表混在一起，不利于判断当前 project 是否真的没有任务。
- Models / Skills / task detail 的信息已经很丰富，但 alpha 验收需要更清楚地定位常见状态和后续动作。

Stage 33 的目标是做小范围、低风险的 manual alpha UX tightening。它只补齐高频入口和文案清晰度，不改变 runtime 协议、agent chain、model gateway、MCP 或 worker execution 边界。

## 目标

1. 让 sidebar 的常见入口可真实操作：
   - 新任务入口清空当前 task，回到当前 project 的空任务入口。
   - project row 可以选择 active project。
   - task row 可以切换 active task。
2. 让 entry chips 和 task suggestion 能直接提交 prompt，减少用户从示例文案到实际输入的重复操作。
3. 用真实空状态替代伪任务占位，明确当前 project 没有任务时的下一步。
4. 保持 Workbench 现有 utilitarian 布局，只做密度、状态和可点击性调整，不做大型视觉重构。
5. 补小范围 Web/server action regression，覆盖新增交互的 cookie/session、redirect 和 form payload 行为。
6. 更新 alpha 验收清单，让人工验收覆盖 sidebar navigation 和 quick prompt 行为。

## 非目标

- 不做大型 UI redesign、新导航信息架构或营销式首屏。
- 不改变 `chat-stream` API、LP agent chain、run event schema、provider adapter 或 worker queue contract。
- 不做 MCP 新功能、真实 MCP SDK、write tools、真实 shell runner、真实部署编排或 production auth/RBAC。
- 不做 provider token delta streaming、billing/quota、fallback provider execution 或 provider marketplace。
- 不引入新的 persistence backend 或改变默认 JSON-file local state。

## 方案

### Sidebar navigation server actions

新增最小 server actions：

- `startNewTaskAction()`：清空 current task cookie，保留 current project，redirect 到首页。
- `selectProjectAction(formData)`：根据 `projectId` 校验 project 是否存在，设置 current project，清空 current task，redirect 到首页。
- `selectTaskAction(formData)`：根据 `taskId` 校验 task 是否存在，设置 current task，并同步 task 所属 project，redirect 到首页。

校验继续由 Web store 的 page state / repository facts 驱动，不信任浏览器传入的 label 或状态。非法 id 使用现有 bounded error route，不新增 runtime error schema。

### Quick prompt forms

把首页 entry chips 和 task suggestions 从 inert button 改为小型 form：

- hidden `prompt` 使用用户可见文案。
- hidden `implicitProjectName` 沿用当前首页/project 输入策略。
- submit 走现有 `submitPromptAction`，避免新增 parallel prompt path。

这些 prompt form 必须避免嵌套在 streaming composer form 内。实现时只在 server-rendered children 区域或独立 suggestion block 渲染。

### Empty state and copy

当 active project 没有任务时，sidebar 显示明确空状态文案，而不是伪造示例任务按钮。示例 prompt 只保留在 entry chips / suggestions，且这些入口需要能提交。

### Visual treatment

保持现有 workbench 风格：

- 采用现有 sidebar item / task item 密度和字体层级。
- button / form 的 hover、focus-visible、active state 要稳定，不造成 layout shift。
- 不新增卡片嵌套、hero、装饰背景或大面积调色。

## 测试策略

### Server actions

- `startNewTaskAction` 调用 session helper 清空 current task 并 redirect。
- `selectProjectAction` 对有效 project 设置 current project、清空 current task；无效 project fail closed。
- `selectTaskAction` 对有效 task 设置 current task 和 project；无效 task fail closed。

### Page render

- sidebar project/task row 渲染为带 hidden id 的 form submit control。
- 空任务列表渲染空状态文案，不渲染伪任务按钮。
- entry chips 和 task suggestions 渲染为 quick prompt form，payload 包含 prompt。

### 回归命令

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

`pnpm alpha:e2e` 如遇本地 sandbox 端口绑定限制，可在获得批准后以同一命令重跑。

## 文档更新

实现阶段需要同步更新：

- `docs/web-v1-acceptance.md`：加入 sidebar navigation 和 quick prompt 人工验收项，并修正 Stage 32 后续项。
- `docs/project-roadmap.md`：Stage 33 状态、完成范围、Stage 34/35/36 推荐队列。
- `docs/superpowers/README.md`：新增 Stage 33 spec/plan 索引。

本阶段只调整 Web alpha UX，不改变 Agent runtime、context、tools、models、memory、retrieval、recovery、approval、observability 或 multi-agent coordination 的概念边界，因此默认不更新 `docs/agent-development-learning.md`。
