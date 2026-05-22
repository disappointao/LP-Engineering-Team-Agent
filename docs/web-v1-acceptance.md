# Skill-Only Alpha 验收清单

在把当前 Web workbench 视为本地单用户 alpha 前，使用本清单做一次人工验收。默认人工验收使用 `REAL_MODEL_RUNTIME=0` deterministic 路径，不依赖真实 provider key、MCP server、Postgres 或真实部署；Browser E2E 已通过 `pnpm alpha:e2e` 作为单独的 deterministic 自动验收运行。MCP 在本 alpha 中后置；当前主路径只依赖 Web/API、LP 固定链路和项目 Skills。

## 准备

- [ ] 已通过 `pnpm install` 安装依赖。
- [ ] 已创建 `.env.local`，并保持 `REAL_MODEL_RUNTIME=0` 和 `REAL_MODEL_PROVIDER_TEST=0`。
- [ ] `pnpm alpha:check` 通过。
- [ ] `pnpm smoke` 通过。
- [ ] `pnpm dev` 能启动 Web app，并输出本地 URL。

## Browser E2E 自动验收

- [ ] 首次运行 Playwright browser gate 前，执行 `pnpm alpha:e2e:install` 安装本地 Chromium browser。
- [ ] 执行 `pnpm alpha:e2e`，确认 browser-level alpha acceptance 通过。
- [ ] 自动验收覆盖普通聊天 streaming。
- [ ] 自动验收覆盖 LP live task。
- [ ] 自动验收覆盖 artifact preview/export/snippet。
- [ ] 自动验收覆盖 Skills / Models / MCP alpha boundary。
- [ ] 自动验收覆盖 bounded recovery error display。
- [ ] 真实 provider smoke 仍是可选手动验收，不进入默认 `pnpm alpha:e2e`。

## 首屏

- [ ] 应用打开后是类 Manus 的 workbench 布局：左侧固定导航，中间是较大的对话入口。
- [ ] 左侧导航不会跟随主对话内容一起滚动。
- [ ] 用户可以不先创建项目，直接提交普通聊天 prompt。
- [ ] 用户仍然可以通过项目入口创建项目。
- [ ] 中英文 UI 文案符合当前 MVP 记录的浏览器或环境语言判断行为。

## 普通聊天 streaming

- [ ] 打开首页后，不需要先创建项目，可以直接提交普通聊天 prompt，例如 `帮我整理一个首页上线检查清单`。
- [ ] 回答以流式状态展示，生成中能看到 loading/status 文案。
- [ ] 生成完成后，对话详情保留 user / assistant messages。
- [ ] 普通聊天任务不显示 LP artifact preview。
- [ ] follow-up message 仍进入同一个普通聊天 task thread。
- [ ] 没有 running worker job 时，interrupt control 应不可用，或 graceful failure，且不阻塞对话。

## LP live task 和静态产物

- [ ] 提交 LP prompt，例如 `生成一个春季电商活动的静态 HTML 落地页`。
- [ ] 任务被识别为 LP generation task。
- [ ] 页面不需要手动刷新，即可通过 live task panel 看到 Planner、Builder、Reviewer、Deployer progress。
- [ ] 结果包含 artifact workspace，文件为 `index.html`、`styles.css`、`script.js`。
- [ ] 生成的 artifact 可以本地 preview/export。
- [ ] 生成的 LP artifact 不依赖 React、Vue、Angular、Next.js、Vite 或其它前端框架构建步骤。
- [ ] 可见对话中能区分 artifact 生成过程输出和最终结果输出。

## Artifact Diff 和源码片段

- [ ] Artifact diff list 显示 `index.html`、`styles.css`、`script.js` 的 file-level metadata。
- [ ] 默认 artifact diff cards 只展示 metadata；完整源码只在点击 `Preview snippet` 后显示。
- [ ] 点击 `index.html` 的 `Preview snippet`，确认 UI 展示 bounded read-only source snippet。实现细节：这会选择 `artifactPath=index.html`。
- [ ] 点击 `styles.css` 的 `Preview snippet`，确认 UI 展示 bounded read-only source snippet。实现细节：这会选择 `artifactPath=styles.css`。
- [ ] 点击 `script.js` 的 `Preview snippet`，确认 UI 展示 bounded read-only source snippet。实现细节：这会选择 `artifactPath=script.js`。
- [ ] 未知 artifact path 应 graceful failure，不破坏任务页面。

## Skill-only alpha 主路径

- [ ] 点击 sidebar 中的 `Skills`，确认 view 能打开。
- [ ] 在 active project 下创建 Skill draft，manifest 使用项目范围 `scope: "project"`。
- [ ] 可以 validate、publish 并 bind Skill。
- [ ] 已发布、已绑定并启用的 Skill 会计入 active skill count。
- [ ] 普通聊天或 LP task 能展示 project / skill context summary，而不是泄漏 raw skill content。
- [ ] 如果绑定了带 commands 的 deployment Skill，Skill Commands 区域展示 command card。
- [ ] 点击 `Approve and queue` 后，命令进入 local worker queue。
- [ ] 点击 `Run local worker once` 后，worker queue counts、heartbeat 或 recent logs 有安全变化。
- [ ] Skill command UI 明确这是 approval、queue 和 safe observation 流程，不是任意 shell 或真实部署。

## Models 和 MCP 边界

- [ ] 点击 sidebar 中的 `Models`，确认 view 能打开，并展示 deterministic/mock resolved routes 和真实 provider 配置表单字段。
- [ ] Models view 明确真实 provider 是 opt-in；默认 alpha check 不需要 API key。
- [ ] 缺失 provider、disabled provider 或 route 指向不可用 provider 时，页面显示 bounded fail-closed 提示。
- [ ] 可选真实 provider smoke：设置 `REAL_MODEL_RUNTIME=1`，配置 provider、`apiKeyEnv`、`assistant` / `planner` / `builder` routes，然后手动验证普通聊天和 LP prompt。
- [ ] 点击 sidebar 中的 `MCP`，确认 view 能打开，并明确 MCP 在本 alpha 中后置。
- [ ] 不配置 MCP connector 的情况下，普通聊天和 LP 任务仍可完成。
- [ ] 当前 alpha 不要求真实 MCP server、write tools、真实 shell execution 或真实部署。

## 回归命令

- [ ] `pnpm alpha:check` 通过。
- [ ] `pnpm smoke` 通过。
- [ ] `pnpm test` 通过。
- [ ] `pnpm typecheck` 通过。
- [ ] `pnpm build` 通过。

## 已知后续工作

- [ ] Browser automation acceptance tests 已进入 Stage 31；后续可扩展到更多 failure injection 和视觉回归。
- [ ] Provider streaming、usage/cost metadata 进入 Stage 32。
- [ ] Web UI 中的真实 MCP SDK / remote MCP server adapter 仍是后续工作。
- [ ] Production auth/RBAC、Postgres production rollout 和 object storage 仍是后续工作。
- [ ] 真实 shell runner、真实部署编排和 Desktop packaging 仍是后续工作。
