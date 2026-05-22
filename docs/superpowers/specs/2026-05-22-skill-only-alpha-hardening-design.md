# Stage 30：Skill-Only Alpha Hardening v0 设计

## 背景

Stage 29 已完成第一版可用闭环的关键运行体验：普通聊天继续走 `/api/chat/stream`，LP 复杂任务在 `fallback.required` 后通过 `/api/tasks/submit` 创建 live task，并通过 `/api/tasks/[taskId]/state` 短轮询展示 run timeline、recovery view 和 artifact progress。Web/API 已能支持普通问答、LP 固定链路、workspace-backed artifact preview/export、项目级 Skills、模型 provider opt-in 和安全的 skill command queue path。

当前缺口不再是新增一条 Agent runtime 链路，而是把已有能力收敛成可交付的本地 alpha。用户希望第一版能“网页跟接口完全打通，正常聊天或者做 LP 等复杂任务，以及回答是流式的”，并明确当前不用 MCP，只使用 Skill。Stage 30 因此选择 **Alpha 收口优先**：让启动、配置、Skill-only 范围、真实 provider opt-in、失败提示和人工验收都清楚、可重复、可回归。

## 目标

- 把 README、环境说明和验收清单升级为 Skill-only alpha 的第一入口。
- 明确第一版可用闭环：普通聊天 streaming、LP live task、artifact preview/export、Skill 创建/发布/绑定、Skill command queue / local worker run-once、真实 provider opt-in。
- 明确 MCP 在 alpha 中是后置能力：页面可存在，但不作为第一版验收必需项，也不影响默认 smoke / alpha checks。
- 增加或整理一个本地 alpha readiness command，使默认验证仍保持 deterministic、无网络、无真实 provider key、无 MCP 依赖。
- 补齐必要 UI 文案、empty/error/loading 和 fail-closed 提示，让用户知道当前处于 deterministic 默认、real provider opt-in 或配置失败状态。
- 为真实 provider 本地 smoke 给出明确手动路径，但不让它进入默认 CI / smoke。
- 让未来 agent 能从 roadmap、Superpowers 索引和 Agent 学习笔记理解：Stage 30 是交付硬化阶段，不是 MCP 或真实部署阶段。

## 非目标

- 不做 MCP 新功能，不把 MCP 纳入第一版必需验收。
- 不做 Browser E2E；该项保留给 Stage 31。
- 不做 provider token streaming、usage/cost reporting 或自动 fallback provider execution；这些保留给 Stage 32。
- 不做 production auth/RBAC、invite flow、team approval queue 或 hosted deployment。
- 不做 production Postgres migrations、object storage migration 或默认 backend 切换。
- 不做真实 shell runner、真实部署编排、真实 MCP SDK 或 write tools。
- 不重做 Web UI 信息架构；只做与 alpha 收口直接相关的文案和状态硬化。

## 当前代码边界

- `README.md` 已描述 Web MVP、deterministic defaults、provider opt-in、smoke 和 manual acceptance，但仍偏 Web V1 历史说明，没有把 Stage 29 后的 Skill-only alpha 闭环作为主入口。
- `docs/web-v1-acceptance.md` 覆盖 Web V1 手动验收，但还没有升级为 alpha checklist，也没有把普通聊天 streaming、LP live task、Skill command queue 和 MCP 后置边界放在同一个验收顺序里。
- `package.json` 已有 `pnpm smoke`，目前只运行 `apps/web/src/lib/web-v1-smoke.test.ts`，覆盖 deterministic LP artifact diff 和 live task safe payload。
- `apps/web/src/lib/i18n.ts` 已有 Skills、Models、MCP、streaming、live task、recovery 和 artifact diff 文案；Stage 30 只应补用户容易误解的 alpha/fail-closed 文案，不做大规模 copy 重写。
- `apps/web/src/lib/workbench-store.ts` 已经把 real runtime 错误、model route resolution 错误、Skill command 错误和 worker queue 错误映射成 bounded error code。
- `apps/web/src/app/page.tsx` 已经展示 Skills、Models、MCP views、live task panel 和 streaming composer；Stage 30 可补显式提示或空状态，但不应引入新运行协议。

## 推荐架构

### 1. Alpha Readiness Contract

Stage 30 把“第一版可用”定义成一个本地、单用户、Skill-only alpha contract：

- `REAL_MODEL_RUNTIME=0` 时，普通聊天和 LP 复杂任务必须能走 deterministic 默认路径完成。
- 普通聊天在 Web 层保持 streaming 回答体验。
- LP prompt 必须能创建或复用 `lp_generation` task，并通过 live task panel 展示 Planner、Builder、Reviewer、Deployer progress。
- LP artifact 必须仍是 `index.html`、`styles.css`、`script.js` 三个框架无关静态文件，并能 preview/export。
- Project Skills 必须能完成 create draft、validate、publish、bind、enable/disable 的可见流程。
- 已发布、已绑定的 Skill 必须能进入 project-bound chat / LP runtime 的 bounded context summary。
- 可执行 deployment skill command 仍走 approval、queue、local worker run-once、safe observation 和 run event，不开放任意 shell 或真实部署。
- Models view 支持 real provider opt-in 配置，但默认验证不需要真实 key。
- MCP view 可以保留为架构边界展示，但 alpha acceptance 不要求创建 connector 或执行 MCP tool。

这个 contract 需要同时写入 README、manual checklist 和 smoke/alpha command 说明，避免未来开发者只看测试命令而误判产品边界。

### 2. Documentation and Onboarding

README 应成为 alpha 的第一入口，建议调整为：

- 顶部明确当前是 `Skill-only local alpha`，不是 production multi-user deployment。
- 用一段短路径说明默认启动：`pnpm install`、复制 `.env.example`、保持 `REAL_MODEL_RUNTIME=0`、`pnpm dev`、`pnpm smoke` 或 alpha check。
- 把“普通问答”、“LP 复杂任务”、“Skills”、“Models / real provider opt-in”、“MCP deferred”分成清楚能力列表。
- 说明真实 provider smoke 是 opt-in：需要 `REAL_MODEL_RUNTIME=1`、项目 Models route、provider env key 和手动 prompt 验证；默认 tests/smoke 不触网。
- 保留生成 LP artifact 的框架无关要求。

`docs/web-v1-acceptance.md` 应升级为 alpha checklist，建议按实际用户路径排序：

1. 本地准备和 deterministic startup。
2. 普通聊天 streaming。
3. LP live task 和 artifact preview/export。
4. Skill create / validate / publish / bind。
5. Skill context 对普通聊天或 LP 任务的可见关联。
6. Skill command approval / queue / local worker run-once。
7. Models real provider opt-in 手动 smoke。
8. MCP deferred boundary。
9. 回归命令和已知后续工作。

### 3. Alpha Check Command

新增或整理一个 root command，例如 `pnpm alpha:check`。它应该是 deterministic readiness gate，不需要浏览器、网络、真实 provider key、MCP server 或 Postgres。

推荐 v0 命令组合：

- 运行现有 `pnpm smoke`，覆盖 ordinary task、LP artifact diff 和 live task safe payload。
- 运行与 alpha copy / route / store 风险直接相关的 focused tests，例如 i18n、page rendering、streaming route 或 workbench store 的关键测试。

`pnpm alpha:check` 不替代 `pnpm test`、`pnpm typecheck` 或 `pnpm build`。它的定位是 alpha handoff 前的快速检查，README 和 checklist 需要说明最终阶段收尾仍应运行完整验证。

### 4. UI Copy and Fail-Closed Hints

Stage 30 只做必要硬化：

- Skills view 明确是 alpha 的主扩展路径，Skill command 是 queue / local worker / safe observation，不是任意 shell 或真实部署。
- Models view 明确 real provider 是 opt-in，缺失 env 或 route 配置时应 fail closed，并提示回到 deterministic 默认或补齐 provider config。
- MCP view 明确当前 alpha 不依赖 MCP，避免用户误以为必须配置 MCP 才能聊天或生成 LP。
- Empty/error/loading 状态不应泄漏 raw model output、raw provider response、secret、raw tool output、artifact content 或本机路径。

如需新增文案，应同步 `apps/web/src/lib/i18n.test.ts`，确保中英文 key 都存在且不会回退到空字符串。

### 5. Real Provider Manual Smoke

真实 provider 验证仍是手动 opt-in，不进入默认 alpha check：

- `.env.local` 设置 `REAL_MODEL_RUNTIME=1`。
- 在 Models view 创建 provider，选择 `anthropic-messages` 或 `openai-completions`，填写 `baseUrl`、`apiKeyEnv` 和 model id。
- `.env.local` 中只填对应 provider 的 API key env，不在 UI、docs 示例或测试输出中写真实 key。
- 为 `assistant`、`planner`、`builder` route 选择 provider。
- 手动验证 project-bound ordinary chat 和 LP prompt；Reviewer / Deployer 仍可以保持 deterministic / policy-driven。

失败时应看到 bounded error 或 safe runtime summary，而不是原始 provider response。

## 错误处理和安全边界

- 默认 smoke / alpha check 必须 deterministic，不触网，不读取真实 provider secret。
- `REAL_MODEL_RUNTIME=1` 下，模型 route 缺失、provider disabled、API key env 缺失或 provider request 失败都必须 fail closed，不静默回退到 mock 成功结果。
- Skill command 必须继续校验 project binding、published state、permission、approval、page version ownership 和 queueability。
- MCP deferred 不等于删除 MCP 页面；它表示第一版 alpha 不要求用户配置 MCP，也不把 MCP execution 作为主验收。
- 文档和 UI 不应承诺真实部署成功；当前只到 safe command / handoff / simulated worker boundary。
- 所有对外展示只允许 safe summary，禁止 raw model output、raw provider response、raw tool output、secret、完整 artifact 内容、本机路径或 raw stdout/stderr。

## 测试策略

### 文档和命令

- `pnpm alpha:check` 存在并运行 deterministic readiness gate。
- README 中的默认路径不要求真实 provider、MCP、Postgres 或浏览器 E2E。
- `docs/web-v1-acceptance.md` 的 checklist 覆盖普通聊天、LP live task、Skills、Models opt-in、MCP deferred 和回归命令。

### Focused Tests

- i18n tests 覆盖新增 alpha / fail-closed copy。
- Web page tests 覆盖新增 empty/error/status 文案或边界提示。
- Smoke 继续确认 LP artifact metadata 不泄漏 raw HTML/CSS/JS，live task payload 不泄漏 raw artifact content。
- 如新增 `alpha:check`，用 package script 或文档说明保持命令和 README 一致。

### Manual Acceptance

- 在 `REAL_MODEL_RUNTIME=0` 下，完成普通聊天 streaming。
- 在 `REAL_MODEL_RUNTIME=0` 下，完成 LP live task、artifact preview/export 和 static artifact checks。
- 完成 Skill create、validate、publish、bind。
- 如有 executable deployment skill command，完成 approval、queue、`Run local worker once` 和安全日志/observation 检查。
- 在不配置 MCP 的情况下，普通聊天和 LP 任务仍可完成。
- 可选：在 `REAL_MODEL_RUNTIME=1` 下完成真实 provider 手动 smoke，并确认失败路径为 bounded error。

### 回归验证

阶段实现完成前至少运行：

- `pnpm alpha:check`
- `pnpm smoke`
- `pnpm test`
- `pnpm typecheck`

如修改 build-sensitive 代码或 Next.js page 结构，也运行 `pnpm build`。

## 验收标准

- README 能让新开发者按 Skill-only alpha 路径启动、验证和理解当前边界。
- `docs/web-v1-acceptance.md` 已升级为 alpha checklist，并明确 MCP 后置。
- 默认 alpha check 不依赖网络、真实 provider key、MCP server、Postgres、Browser E2E 或真实部署。
- Web 文案和错误提示不会让用户误以为必须配置 MCP、必须使用真实 provider 或已经执行真实部署。
- Skills 是 alpha 的主扩展路径，并且 Skill command 的 approval / queue / worker run-once / safe observation 边界被清楚表达。
- 真实 provider opt-in 有明确手动 smoke 说明，失败路径 fail closed。
- Roadmap、Superpowers 索引和 Agent 学习笔记同步记录 Stage 30 的当前状态和后续阶段。
