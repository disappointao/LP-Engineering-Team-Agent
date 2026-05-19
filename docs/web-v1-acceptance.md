# Web V1 验收清单

在把当前 Web workbench 视为可用本地 MVP 前，使用本清单做一次人工验收。Deterministic smoke 命令覆盖 store/API 级行为；本清单覆盖可见 Web 行为和产品边界。

## 准备

- [ ] 已通过 `pnpm install` 安装依赖。
- [ ] 已创建 `.env.local`。Deterministic 本地模式使用 `REAL_MODEL_RUNTIME=0`。
- [ ] `pnpm smoke` 通过。
- [ ] `pnpm dev` 能启动 Web app，并输出本地 URL。

## 首屏

- [ ] 应用打开后是类 Manus 的 workbench 布局：左侧固定导航，中间是较大的对话入口。
- [ ] 左侧导航不会跟随主对话内容一起滚动。
- [ ] 用户可以不先创建项目，直接提交普通聊天 prompt。
- [ ] 用户仍然可以通过项目入口创建项目。
- [ ] 中英文 UI 文案符合当前 MVP 记录的浏览器或环境语言判断行为。

## 普通任务流程

- [ ] 提交非 LP prompt，例如 `帮我整理一个首页上线检查清单`。
- [ ] 任务会出现在任务列表中。
- [ ] 对话详情以 chat-style layout 打开。
- [ ] 如果存在工具或过程行，它们应显示为进度/过程信息，而不是最终用户正文。
- [ ] 普通任务结果出来后，composer 仍可继续提交 follow-up message。
- [ ] 没有 running worker job 时，interrupt control 应不可用，或 graceful failure，且不阻塞对话。
- [ ] 普通聊天任务不显示 LP artifact preview。

## LP 生成流程

- [ ] 提交 LP prompt，例如 `生成一个春季电商活动的静态 HTML 落地页`。
- [ ] 任务被识别为 LP generation task。
- [ ] 结果包含静态 artifact workspace，文件为 `index.html`、`styles.css`、`script.js`。
- [ ] 生成的 artifact 可以本地 preview。
- [ ] 生成的 LP artifact 不依赖 React、Vue、Angular、Next.js、Vite 或其它前端框架构建步骤。
- [ ] 可见对话中能区分 artifact 生成过程输出和最终结果输出。

## Artifact Diff 和源码片段

- [ ] Artifact diff list 显示 `index.html`、`styles.css`、`script.js` 的 file-level metadata。
- [ ] 默认 artifact diff cards 只展示 metadata；完整源码只在点击 `Preview snippet` 后显示。
- [ ] 点击 `index.html` 的 `Preview snippet`，确认 UI 展示 bounded read-only source snippet。实现细节：这会选择 `artifactPath=index.html`。
- [ ] 点击 `styles.css` 的 `Preview snippet`，确认 UI 展示 bounded read-only source snippet。实现细节：这会选择 `artifactPath=styles.css`。
- [ ] 点击 `script.js` 的 `Preview snippet`，确认 UI 展示 bounded read-only source snippet。实现细节：这会选择 `artifactPath=script.js`。
- [ ] 未知 artifact path 应 graceful failure，不破坏任务页面。

## Skills、Models 和 MCP 边界

- [ ] 点击 sidebar 中的 `Skills`，确认 view 能打开，并展示 managed workflow capabilities，而不是 ad hoc prompt text。
- [ ] 点击 sidebar 中的 `Models`，确认 view 能打开，并展示 deterministic/mock resolved routes 和真实 provider 配置表单字段。
- [ ] 真实模型 provider 测试是 opt-in，`pnpm smoke` 不会运行这些测试。
- [ ] 点击 sidebar 中的 `MCP`，确认 view 能打开，并展示 registry、approval、visible tools surfaces，但不会执行真实 MCP tool。
- [ ] 当前流程不要求 deployment。后续 deployment 可以由 skills 或独立 deployment module 提供。

## 回归命令

- [ ] `pnpm smoke` 通过。
- [ ] `pnpm test` 通过。
- [ ] `pnpm typecheck` 通过。
- [ ] `pnpm build` 通过。

## 已知后续工作

- [ ] Browser automation acceptance tests 仍是后续工作。
- [ ] Web UI 中的真实 MCP execution 仍是后续工作。
- [ ] Durable multi-agent context compression and retrieval 仍是后续工作。
- [ ] Built-in deployment orchestration 仍是后续工作。
- [ ] Desktop packaging 仍是后续工作。
