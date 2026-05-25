# Skill-Only Alpha 验收清单

在把当前 Web workbench 视为本地单用户 alpha 前，使用本清单做一次详细人工验收。默认人工验收使用 `REAL_MODEL_RUNTIME=0` deterministic 路径，不依赖真实 provider key、MCP server、Postgres 或真实部署；Browser E2E 应通过 `pnpm alpha:e2e` 作为单独的 deterministic 自动验收运行。普通聊天、LP、Artifacts、Skills 和 Models 主路径不依赖 MCP 配置；当前主路径只依赖 Web/API、LP 固定链路和项目 Skills。

Post-V1 note：Stage54 已重新引入单一 `MCP` management view，用于 safe connector/tool metadata 和 read-only checks。该 view 是受限管理面，不改变普通聊天、LP、Artifacts、Skills、Models 不依赖 MCP 的边界。

准备内部 release candidate 时，go/no-go、试用脚本、反馈模板和 triage 分类以 `docs/alpha-release-candidate.md` 为入口；本文件只负责详细 UX 和能力边界检查。

Stage 46 completion gate 的本轮执行结果记录在 `docs/v1-polished-alpha-completion.md`。本文件仍是人工验收的详细 checklist；completion note 只记录某一轮 gate / trial 的安全摘要和 go/no-go 状态。

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
- [ ] 自动验收覆盖 artifact workspace happy path、invalid path、oversized snippet 和安全 unavailable copy。
- [ ] 自动验收覆盖 MCP management navigation re-entry、connector metadata、safe read-only affordance 和 legacy query non-leakage。
- [ ] 自动验收覆盖 provider fail-closed、Skills invalid manifest、worker queue bounded error、Models invalid config 和 recovery error display。
- [ ] 自动验收覆盖 timeline / recovery diagnostics non-leakage，不展示 raw model output、provider secret、worker raw detail、本机路径或 query debug values。
- [ ] 自动验收覆盖空首页、artifact workspace、Skills 和 Models surface 的轻量 layout visual contract，并在失败 artifact 中保留诊断截图。
- [ ] 真实 provider smoke 仍是可选手动验收，不进入默认 `pnpm alpha:e2e`。

## 首屏

- [ ] 应用打开后是类 Manus 的 workbench 布局：左侧固定导航，中间是较大的对话入口。
- [ ] 左侧导航不会跟随主对话内容一起滚动。
- [ ] 用户可以不先创建项目，直接提交普通聊天 prompt。
- [ ] 用户仍然可以通过项目入口创建项目。
- [ ] 左侧 `New task` 会回到当前项目的新任务入口，而不是停留在旧 task。
- [ ] 左侧项目列表可以切换 active project，并清空旧 task 上下文。
- [ ] 左侧任务列表可以切换 active task；没有任务时显示明确空状态，不显示伪任务。
- [ ] 首页快捷 prompt chip 可以直接提交，而不是只作为静态示例。
- [ ] 中英文 UI 文案符合当前 MVP 记录的浏览器或环境语言判断行为。

## 普通聊天 streaming

- [ ] 打开首页后，不需要先创建项目，可以直接提交普通聊天 prompt，例如 `帮我整理一个首页上线检查清单`。
- [ ] 回答以流式状态展示，生成中能看到 loading/status 文案。
- [ ] 生成完成后，对话详情保留 user / assistant messages。
- [ ] 普通聊天任务不显示 LP artifact preview。
- [ ] follow-up message 仍进入同一个普通聊天 task thread。
- [ ] 任务详情底部的推荐追问可以直接提交到当前 task thread。
- [ ] 没有 running worker job 时，interrupt control 应不可用，或 graceful failure，且不阻塞对话。

## LP live task 和静态产物

- [ ] 提交 LP prompt，例如 `生成一个春季电商活动的静态 HTML 落地页`。
- [ ] 任务被识别为 LP generation task。
- [ ] 页面不需要手动刷新，即可通过 live task panel 看到 Planner、Builder、Reviewer、Deployer progress。
- [ ] Stage 43 run timeline 可见，并在同一 timeline 中展示 Planner、Builder、Reviewer、Deployer、handoff marker；当 repair/retry/recovery 提示出现时，应保持安全层级且不需要查看 raw event payload，页面不得展示 raw provider response、raw tool output、完整 artifact 内容、本机路径或 secret。
- [ ] 结果包含 artifact workspace，文件为 `index.html`、`styles.css`、`script.js`。
- [ ] 生成的 artifact 可以本地 preview/export。
- [ ] 生成的 LP artifact 不依赖 React、Vue、Angular、Next.js、Vite 或其它前端框架构建步骤。
- [ ] 可见对话中能区分 artifact 生成过程输出和最终结果输出。

## Artifact Diff 和源码片段

- [ ] Artifact diff list 显示 `index.html`、`styles.css`、`script.js` 的 file-level metadata。
- [ ] 默认 artifact diff cards 只展示 metadata；bounded read-only source snippet 只在点击 `Preview snippet` 后显示。
- [ ] 点击 `index.html` 的 `Preview snippet`，确认 UI 展示 bounded read-only source snippet。实现细节：这会选择 `artifactPath=index.html`。
- [ ] 点击 `styles.css` 的 `Preview snippet`，确认 UI 展示 bounded read-only source snippet。实现细节：这会选择 `artifactPath=styles.css`。
- [ ] 点击 `script.js` 的 `Preview snippet`，确认 UI 展示 bounded read-only source snippet。实现细节：这会选择 `artifactPath=script.js`。
- [ ] 未知 artifact path 应 graceful failure，不破坏任务页面。

### Dedicated Artifact Workspace

- [ ] LP task 完成后打开 `Artifacts` navigation item。
- [ ] 确认 workspace 展示 `index.html`、`styles.css`、`script.js`，并且只显示 bounded metadata。
- [ ] 分别 preview 每个文件的 snippet；oversized 或 invalid path 必须显示安全 unavailable copy。
- [ ] 确认 static preview 和 export links 可见。
- [ ] 确认 invalid `artifactPath` 不回显 query secrets、本机路径或 traversal strings。

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
- [ ] 可选真实 provider smoke：按 `docs/real-provider-alpha-smoke.md` 设置 `REAL_MODEL_RUNTIME=1`，配置 provider、`apiKeyEnv`、`assistant` / `planner` / `builder` routes，然后手动验证普通聊天 streaming、LP prompt、usage metadata 和 missing key fail-closed。
- [ ] 点击 sidebar 中的 `MCP`，确认 management view 能打开，并且是 Stage54 post-V1 safe metadata / read-only management surface。
- [ ] 不配置 MCP connector 的情况下，普通聊天、LP、Artifacts、Skills 和 Models 主路径仍可完成。
- [ ] MCP connector 页面只展示 bounded connector metadata、visible tool metadata、approval summary、health / diagnostic summary 和 read-only eligibility，不展示 raw MCP output、raw arguments、secret、本机路径、未脱敏异常或 malformed raw JSON。
- [ ] visible read-only tool 展示 `Run read-only check` affordance；页面没有 raw argument textarea，也不要求 operator 输入 raw argument JSON。
- [ ] 当前 alpha 不要求真实 MCP server、remote MCP SDK、write tools、MCP worker execution、真实 shell execution 或真实部署。

### Stage 44：Skills / Models client-side management

- [ ] Skills 页面展示 `Runtime context`、lifecycle stage、成功 notice、错误 notice 和 command queue hierarchy。
- [ ] 创建 skill draft 后不会回显 raw skill content；validate、publish、bind、enable/disable 后回到 repository fact。
- [ ] Models 页面展示 provider summary、route summary、resolved runtime routes、real provider opt-in 提示和 fail-closed diagnostics。
- [ ] Provider summary 只显示 provider/model/API protocol/env var configured state 等 bounded metadata，不展示 secret 值、raw provider response 或完整 base URL。
- [ ] Stage54 post-V1 MCP management 已可见，但仍限制为 metadata / read-only-only surface；Stage44 Skills / Models bounded metadata 和 fail-closed diagnostics 不因此扩大到 raw MCP output、raw arguments 或 write tools。

## 回归命令

- [ ] `pnpm alpha:check` 通过。
- [ ] `pnpm smoke` 通过。
- [ ] `pnpm test` 通过。
- [ ] `pnpm typecheck` 通过。
- [ ] `pnpm build` 通过。

## 已知后续工作

- [ ] Stage 45 Browser failure / visual regression expansion 已完成；远端 browser farm、跨浏览器矩阵和 pixel-perfect 截图基线仍是后续工作。
- [ ] Stage 35 Provider token delta streaming 已完成普通聊天 `assistant` role；LP structured output token-level UI、billing/cost ledger 仍是后续工作。
- [ ] Stage54 MCP management surface v0 已完成；真实 MCP SDK / remote MCP server adapter、write tools 和 MCP worker execution 仍是后续工作。
- [ ] Production auth/RBAC、Postgres production rollout 和 object storage 仍是后续工作。
- [ ] 真实 shell runner、真实部署编排和 Desktop packaging 仍是后续工作。
