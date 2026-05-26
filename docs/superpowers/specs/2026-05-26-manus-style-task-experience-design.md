# Manus 风格任务体验设计

## 背景

当前 Web workbench 已能完成普通聊天、真实 provider opt-in、LP 复杂任务、artifact workspace、run timeline 和 recovery。上一阶段把普通聊天的内部过程噪音隐藏，并让消息支持结构化展示；但复杂 LP 任务仍暴露偏工程化的 `LiveTaskPanel`、runtime chip 和 interrupt 状态。用户希望更接近 Manus：用户只看懂任务正在做什么、当前到第几步、能暂停，底层 planner/builder/reviewer/deployer 和 artifact polling 继续存在但不抢占主体验。

## 目标

把当前任务状态投影为 Manus 风格的结果优先体验：

- 普通聊天不显示任务进度卡、runtime chip 或“当前没有可打断任务”。
- LP 复杂任务显示一个紧凑的执行卡片，包含用户可理解的步骤、当前状态和进度计数。
- 详细 `Agent process`、`Run timeline`、`Run recovery` 仍可展开查看，但默认作为高级详情。
- Composer 右侧用同一个主按钮表达发送/停止状态；没有运行任务时只显示发送，不显示禁用的 interrupt 文案。
- 不改变底层 run orchestration、worker queue、artifact polling、interrupt action 或真实 provider contract。

## 非目标

- 不实现 Manus 的知识记忆、远程浏览器、云电脑、插件市场或多任务并发 UI。
- 不新增真实 worker daemon 控制、真实 shell execution、MCP write tools 或部署 runner。
- 不改变 LP artifact 的静态 HTML/CSS/JS 产物 contract。
- 不把 planner/builder/reviewer/deployer 的真实内部事件从系统中移除；只调整 Web 投影。

## 设计

### 任务进度投影

新增 Web-only view model，把 LP task state 投影为 4 个用户语言步骤：

1. `初始化项目并理解需求`
2. `规划页面结构和内容`
3. `生成静态页面文件`
4. `检查并准备交付`

该 view model 读取现有 `LiveTaskStatePayload` 的 runs、artifact progress 和 terminal 状态，不直接读取原始 provider output。普通聊天没有 `lp_generation` task，不生成执行卡片。

### 可见任务卡片

替换当前裸露的 `LiveTaskPanel` 表达：

- 标题区域显示当前步骤文案、状态和 `n / 4`。
- 正在运行时显示轻量旋转/脉冲状态点。
- Artifact ready 时显示“页面文件已准备好”之类结果状态。
- 卡片视觉接近 Manus：窄卡片、轻边框、左侧任务图标、状态文字，而不是管理后台式面板。

### Composer 按钮

Composer 保留输入区和发送能力，但移除默认可见的 runtime chip 和 disabled interrupt button：

- `idle` / `not_interruptible`：只显示发送按钮。
- `interruptible`：发送按钮位置变为停止按钮，并提交 `interruptCurrentTaskAction`。
- `interrupting`：按钮显示停止中并禁用。

runtime 模式仍可通过顶栏模型 chip 或未来 tooltip 呈现；本阶段不在 composer 主操作区展示。

### 详情折叠

保留上一阶段的 `AgentDetailsDisclosure`：

- LP 完成或运行时，执行卡片下方保留可展开的“智能体过程/Agent process”。
- 展开后仍能看到 `AgentProcessBlock`、`RunTimelineBlock`、`RecoveryBlock`。
- 展开状态继续按 task id 存储，刷新后保持。

### 测试策略

- Unit tests：覆盖任务步骤 view model、普通聊天不渲染执行卡片、composer idle/interruptible 控制。
- Browser E2E：普通聊天不显示任务进度和 interrupt 文案；LP 任务显示 Manus 风格步骤卡，详情可展开。
- Regression：`pnpm alpha:e2e` 继续作为浏览器可见合同。

## 风险和约束

- 任务步骤是 Web projection，不代表真实 runtime 改成 4 步；详细 timeline 仍是事实源。
- `LiveTaskPanel` 仍需 polling artifact readiness；重命名或拆分时不能破坏 auto-refresh。
- 输入区的停止按钮需要保持 server action 行为，不能绕过现有 cancel/interrupt 安全边界。
