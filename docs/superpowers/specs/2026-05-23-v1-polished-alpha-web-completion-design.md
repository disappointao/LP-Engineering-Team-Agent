# V1 Polished Alpha Web Completion Design

**日期：** 2026-05-23
**状态：** 已批准，等待 Stage 40 implementation
**关联阶段：** Stage 40-46

## 背景

Stage 30-39 已经把本地单用户 Skill-only alpha 的主链路跑通：普通聊天 streaming、真实 provider opt-in、LP `Planner -> Builder -> Reviewer -> Deployer` 固定链路、live task panel、artifact preview/export/snippet、Skills、Models、failure UX 和 LP artifact quality baseline。

用户现在把“第一版 Web”口径从“主路径可用”提高到 **V1 polished alpha**：除了 MCP 外，原本 Web UI backlog 中的高级 no-refresh workbench interaction、细粒度 run timeline、visual hierarchy hardening、dedicated artifact workspace、高级 handoff/recovery UX、Skills/Models client-side management 和 browser failure/visual regression 扩展都应规划到第一版结束前完成。

本设计只调整 V1 范围和阶段队列，不直接实现 UI 或 runtime 代码。

## 用户决策

- 采用 **V1 polished alpha** 作为第一版 Web 结束口径。
- 保留 Stage 40 feedback intake / triage，不跳过反馈纪律。
- Stage 40 后采用 “feedback gate + Web polish trains” 拆分后续阶段。
- MCP 管理、MCP tab / sidebar / top-level Web 入口从第一版 Web 中移除，后期再做。
- 已有后端 MCP registry / read-only execution 边界可以保留，但第一版 Web 不主动暴露管理入口或配置/执行表单。
- 规划阶段应一次规划到完整第一版结束，而不是只规划下一个阶段。

## V1 Polished Alpha 结束定义

第一版结束时，少数内部用户应能在本地单用户 Web 中完成以下闭环：

- 在 Web workbench 中普通对话，回答支持 streaming，并能看到安全 context summary。
- 提交 LP 复杂任务，看到 no-refresh task progress、run timeline、artifact progress、handoff/recovery 状态。
- 在 dedicated artifact workspace 中查看 artifact 文件列表、preview、bounded snippet、export 和安全失败状态。
- 使用 Skills 作为主要扩展入口，完成 draft、validate、publish、bind、enable 和受控 command approval 主流程。
- 使用 Models 配置真实 provider opt-in route，并能理解 deterministic 默认路径、缺 key、协议不匹配和 fail-closed 状态。
- MCP 相关管理入口在 V1 Web 中不可见；如果旧 URL 或 query 参数仍被访问，必须安全降级，不展示 MCP 配置或执行表单。
- Browser acceptance 覆盖主路径、关键失败路径和轻量视觉 contract。

## 阶段拆分

### Stage 40：Alpha Feedback Intake and Triage Loop v0

保留现有推荐阶段。Stage 40 先把 RC feedback template 变成可执行 intake runbook 和 `docs/alpha-feedback-log.md`，明确 safe evidence、category、severity、status、accepted follow-ups、rejected/out-of-scope items。

Stage 40 不直接修复 UI，不引入 hosted issue tracker、遥测、用户账号、数据库或团队审批系统。

### Stage 41：Web Surface Pruning and V1 Navigation v0

Stage 41 收紧第一版 Web 信息架构：

- 隐藏 MCP tab / sidebar / top-level navigation。
- 将旧 `view=mcp` 或等价入口安全降级到 workbench 或 deferred placeholder，不展示 MCP connector、tool approval 或 execution form。
- 明确 V1 可见入口：chat/workbench、tasks、artifact workspace、Skills、Models。
- 更新 Web acceptance、RC docs、i18n 文案和 browser tests，确保 MCP 不再是 V1 manual acceptance 主路径。

非目标：不删除 MCP backend repository、gateway、runtime context 类型或已有安全测试；不实现新的 artifact workspace 或 Skills/Models 管理体验。

### Stage 42：Dedicated Artifact Workspace v0

Stage 42 把 artifact 从当前 workbench 局部 preview/export/snippet 提升为第一版独立工作区：

- 为当前 task / project 提供 artifact workspace page 或 view。
- 展示文件 manifest、hash/summary、status、preview、bounded snippet、single HTML export。
- Artifact key 或 task state 更新时保持 no-refresh 刷新。
- 对 unknown path、path traversal、missing artifact、policy failure 显示安全失败状态。
- 保持三文件静态 contract：`index.html`、`styles.css`、`script.js`。

非目标：不做 line-level diff、patch/apply workflow、binary asset、object storage、desktop filesystem mapping 或框架化 artifact。

### Stage 43：Run Timeline and Recovery UX Polish v0

Stage 43 强化 LP live task 的 no-refresh 体验和恢复可读性：

- 更细粒度展示 Planner、Builder、Reviewer、Deployer run lifecycle。
- 区分 running、completed、failed、cancelled、blocked、recovered、repair/retry history。
- 增强 handoff / recovery block 的视觉层级和行动入口。
- 加入轻量 progress animation，动画只表达 transient UI 状态，不写入 repository fact。
- 保留 bounded diagnostics，不展示 raw provider response、raw tool output、完整 artifact 内容、本机路径或 secret。

非目标：不引入 SSE、raw stdout/stderr streaming、真实 shell runner、MCP streaming 或实时多人协作。

### Stage 44：Skills and Models Client-side Management v0

Stage 44 把 Skills/Models 的第一版管理体验做完整：

- Skills：draft、validate、publish、bind、enable/disable、command approval 的 client-side state、错误提示和成功反馈。
- Models：project provider config、route assignment、真实 provider opt-in、missing key / protocol mismatch / disabled provider 的安全提示。
- 页面操作应尽量局部刷新或乐观显示 pending state，完成后回到 repository fact。
- UI context summary 继续只展示 bounded skill/model metadata，不展示 raw skill content、secret、base URL 或 raw provider response。

非目标：不做 MCP client-side management，不做 provider marketplace、billing/quota、cost ledger、自动 fallback provider execution 或团队级模型审批。

### Stage 45：Browser Failure and Visual Regression Expansion v0

Stage 45 扩展 deterministic browser acceptance：

- 覆盖 Stage 41 的 MCP entry hidden / legacy route safe fallback。
- 覆盖 Stage 42 artifact workspace 的 happy path 和安全失败路径。
- 覆盖 Stage 43 timeline/recovery 关键状态。
- 覆盖 Stage 44 Skills/Models client-side management 主路径和 fail-closed 文案。
- 继续使用轻量 geometry/layout assertions 和 diagnostic screenshots，避免 brittle pixel-perfect baseline。

非目标：不做远端 browser farm、跨浏览器矩阵、真实 provider 默认 gate、MCP server、Postgres production rollout 或 hosted observability。

### Stage 46：V1 Polished Alpha Completion Gate v0

Stage 46 是 V1 收口阶段，不新增大功能：

- 运行完整 deterministic gates：`pnpm alpha:check`、`pnpm smoke`、`pnpm alpha:e2e`、`pnpm test`、`pnpm typecheck`、`pnpm build`。
- 执行人工 acceptance：普通聊天、LP task、artifact workspace、Skills、Models、MCP hidden、failure display。
- 可选真实 provider smoke 继续通过 `REAL_MODEL_RUNTIME=1` opt-in 执行。
- 更新 RC decision record、known limitations、roadmap、README 和第一版 completion note。

非目标：不在 completion gate 中引入新能力；发现 blocker 时进入明确修复批次，而不是临时扩大 Stage 46。

## Web Surface 边界

V1 Web 可见入口应聚焦主路径：

- Workbench / chat。
- Task history / current task。
- Artifact workspace。
- Skills。
- Models。

MCP 在 V1 Web 中应表现为后期能力：

- 主导航不出现 MCP。
- 不提供 connector 创建、tool approval、tool execution 表单。
- 旧 URL 或 query 参数不得泄漏 MCP raw state；可重定向到 workbench，或显示只读 deferred message。
- 文档仍可说明 MCP backend 能力已存在但不属于 V1 Web surface。

## 数据和状态流

V1 polished alpha 继续以 repository facts 为唯一事实来源：

- Chat streaming delta、progress animation 和 pending controls 只是 transient client state。
- Terminal assistant message、run lifecycle、handoff、recovery、artifact workspace、skill/model state 都必须回到 repository fact。
- Artifact workspace 读取仍通过 controlled artifact reader 和 bounded snippet，不把完整 artifact 内容塞进默认 timeline、message 或 context summary。
- Skills/Models 操作完成后必须刷新安全 summary，不直接暴露 secret、raw skill content、base URL 或 raw provider response。

## 错误处理和安全

- 所有 Web failure copy 使用 bounded、localized、可测试文案。
- MCP hidden 不应造成 broken navigation；旧入口必须安全降级。
- Artifact path、provider config、skill validation、command approval 和 recovery action 都应保持 fail-closed。
- Browser failure tests 应验证 UI 不泄漏 secret、raw provider response、raw tool output、raw artifact、raw worker payload、本机绝对路径或不可脱敏日志。

## 测试策略

- Stage 40 以文档 review、safe evidence examples 和 `git diff --check` 为主。
- Stage 41-44 每个阶段补 focused Vitest regression 和必要 browser acceptance。
- Stage 45 汇总扩展 browser failure/visual contracts。
- Stage 46 运行完整 V1 gate。
- 真实 provider smoke 仍是 operator opt-in，不进入默认 deterministic gates。

## 文档更新策略

本设计需要同步：

- `docs/project-roadmap.md`：更新第一版定义、推荐阶段队列、MCP 后置边界和决策记录。
- `docs/superpowers/README.md`：加入本设计文档阅读顺序。
- `docs/agent-development-learning.md`：记录 V1 Web surface 与 Agent runtime backend boundary 的区别，尤其是 MCP backend 存在但 V1 UI 隐藏。

后续 Stage 41-46 实现时再分别更新：

- `docs/web-v1-acceptance.md`
- `docs/alpha-release-candidate.md`
- 对应 stage spec/plan
- 必要 README 和 operator docs

## 非目标

- 不在本设计阶段改 Web 代码。
- 不删除 MCP backend、schema、repository、runtime context 或测试。
- 不做 MCP management、MCP write tools、remote MCP SDK 或 MCP worker execution。
- 不做真实部署、auth/RBAC、billing/quota、真实 shell runner、strong sandbox、hosted observability、object storage 或 desktop packaging。
- 不改变 LP artifact static HTML/CSS/JS contract。
