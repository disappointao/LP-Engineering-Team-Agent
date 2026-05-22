# 项目路线图

最后更新：2026-05-23

这份文档是 LP Engineering Team Agent 后续阶段任务规划的默认入口。后续询问“下一阶段做什么”时，先读本文件，再按需要读取 `docs/agent-development-learning.md`、`docs/superpowers/README.md` 和具体 stage spec/plan。

它不是单个阶段的 spec，也不是某次实现 plan。它用于维护近期优先级、底层基座缺口、Web/UI 后置项和长期 backlog，避免每次都从全部历史文档重新分析。

## 当前状态快照

当前已经成型或基本成型的底层能力：

- Web workbench：类 Manus 布局、conversation-first entry、普通任务和 LP 生成任务。
- Static LP artifact：生成产物保持 `index.html`、`styles.css`、`script.js`，并支持 single HTML preview/export。
- Model gateway：provider-neutral 配置、`anthropic-messages` adapter、`openai-completions` adapter、真实 runtime 显式 opt-in。
- Structured model output：Planner `LPBriefSchema` parse、Builder static artifacts parse、artifact policy validation、one-shot repair prompt 和脱敏 repair timeline。
- Model reliability v0：provider 临时错误 bounded retry、retry exhausted event、fallback route 安全 metadata resolution 和 fallback availability event；fallback v0 不自动调用备用 provider。
- Context Pack v0：注入 task/project input、skills、visible MCP tools、model route、approval、artifact workspace、context memory、handoff summary。
- Skills：manifest、version、validation、publish、project binding、runtime context injection、受控 deployment skill command 边界。
- MCP registry / execution v0：connector、tool approval、role/permission visible tools、read-only MCP tool execution、deterministic local executor、run events 和安全 `ToolObservationRecord`。
- Run orchestration：deterministic Planner/Builder/Reviewer/Deployer run records、ordered run events、tool observations。
- Agent run lifecycle / recovery v0：从 run events、worker jobs、tool observations 和 handoffs 派生 lifecycle view、diagnostic summary 和 recovery action contract，并强化 worker finalization 幂等性。
- Run Recovery UI v0：Web task state 已包含 recovery views，task timeline 会展示 inline recovery block，并通过 server action 执行受控 `resume_worker_finalization` 和 `retry_run`。
- Agent handoff v0：固定 LP 链路 `Planner -> Builder -> Reviewer -> Deployer` 的结构化 handoff state。
- Worker runtime / queue：job contract、sandbox policy、JSON-file 默认 persistence、显式 opt-in Postgres worker job / payload / log backend、cancel/interrupt、claim-token queue handoff、`apps/agent-worker` run-once / daemon polling loop、heartbeat、stale safe claim recovery、bounded lifecycle logs、Web 只读 queue health、安全 simulated payload。
- Artifact workspace：durable artifact workspace、manifest/hash/summary、controlled artifact reader、metadata-only static diff、bounded snippet。
- Collaboration primitives：local identity seam、workspace/project member repositories、project owner membership、approval actor audit context。
- Postgres repository foundation v0：Prisma schema 已对齐 Agent runtime 核心 repository contract，并提供显式 opt-in 的 Prisma-backed repository adapter。
- Web opt-in Postgres backend wiring v0：Web repository backend factory 支持 `WORKBENCH_REPOSITORY_BACKEND=json|memory|postgres`；默认 Web backend 仍是 `.lp-agent/workbench-state.json` JSON-file state。
- Postgres Web backend：显式 opt-in 时需要 `DATABASE_URL` 和 `WORKBENCH_POSTGRES_WORKSPACE_ID`，缺失或初始化失败时 fail closed，不静默回退 JSON-file。
- Web-facing Prisma repository closure：Stage 23 已补齐 Web 会读取的 project members、deployments、skills、models、MCP config/approval 等 repository 边界，避免 Postgres core state 和 JSON sidecar split-brain。
- Worker queue opt-in Postgres backend：Stage 24 已实现 `WORKER_REPOSITORY_BACKEND=json|memory|postgres`，Web enqueue 和 `apps/agent-worker` 共用同一 backend selection helper；默认 worker queue 仍是 JSON-file。
- Streaming chat transport / UI v0：普通聊天已有 Web/API NDJSON streaming route、client transient streaming state、terminal persistence / refresh recovery 和 server action fallback。
- Real chat runtime / skill context v0：project-bound 普通聊天已有独立 `assistant` role、真实 model runtime opt-in、bounded skill prompt context、safe context summary stream 和 Models UI route configuration；projectless chat 继续保持 deterministic / no-context。
- LP Agent Chain End-to-End v0：Web LP 复杂任务已采用 task-first orchestration，同一个 task 绑定 Planner / Builder / Reviewer / Deployer runs、handoff、artifact workspace、deployment handoff、继续修改上下文和 recovery facts；Planner / Builder 在 `REAL_MODEL_RUNTIME=1` 下走真实模型 structured output。
- Live task state / artifact progress v0：Stage 29 已实现 live task submit、task state polling、compact run timeline panel、artifact progress auto-refresh 和 safe live payload smoke 覆盖。
- Web V1 readiness：root README、manual acceptance checklist、`pnpm smoke` deterministic smoke test。
- Browser E2E acceptance v0：Stage 31 已新增 deterministic Playwright browser acceptance gate，`pnpm alpha:e2e` 以 Chromium、本地 Next.js dev server 和隔离 JSON state 覆盖第一版 browser-visible contract。
- Provider usage metadata v0：Stage 32 已实现 provider-reported / estimated usage metadata、duration、attempt、streaming capability summary，并把安全摘要从 model gateway 传到 runtime/API run event 和 Web timeline。
- Manual alpha UX tightening v0：Stage 33 已让 sidebar new task / project / task 入口真实可操作，entry chips 和 task suggestions 可直接提交 prompt，并用真实空状态替代伪任务占位。
- Browser failure injection / visual contract v0：Stage 34 已把 `pnpm alpha:e2e` 扩展到 provider fail-closed、artifact invalid path、worker queue bounded error 和空首页 layout contract，并保留诊断 screenshot artifact。
- Provider token delta streaming v0：Stage 35 已把真实 provider streaming contract 接入普通聊天 `assistant` role；LP Planner / Builder structured output 仍保持完整 buffer parse / repair。
- Real provider alpha smoke docs v0：Stage 36 已整理真实 provider opt-in smoke matrix、operator docs、可选 integration tests 和 fake-provider usage/fail-closed regression；默认 gates 继续 deterministic/no-key。
- Skill-only alpha release candidate checklist v0：Stage 37 已整理 RC go/no-go、operator trial script、feedback template、triage 分类和已知限制；默认 gates 继续 deterministic/no-key/local-first。
- Assistant streaming failure UX hardening v0：Stage 38 已为 ordinary chat provider streaming 增加 typed failure codes、localized Web failure copy、empty response guard、persistence failure copy 和 cancel-safe stream persistence guard。

## 第一版可用闭环目标

当前“第一版可用”不再按 README 里的本地 deterministic Web MVP 口径判断，而是按用户能在网页里完成真实产品闭环判断：

- 能在 Web workbench 里进行普通问答，回答支持流式展示。
- Web/API 能接真实模型 runtime，同时保留 deterministic fallback 作为测试路径。
- 能提交“写 LP / 改 LP / 继续优化 LP”这类复杂任务，并跑通 `Planner -> Builder -> Reviewer -> Deployer` 的可观察工作流。
- Skill 是第一版主要扩展机制：已发布、已绑定的 project skills 能进入上下文；受控 skill command 继续走 approval、worker、run event 和 observation 边界。
- Web 页面无需手动刷新即可看到任务状态、run timeline、artifact progress、失败诊断和可用恢复动作。
- 生成 LP 产物继续保持框架无关静态 HTML/CSS/JS，并支持 preview/export。

按当前代码基础，面向本地/单用户第一版可用闭环，粗略估算还需要 **0-2 个有效开发日**。如果要给少数内部用户稳定 alpha 试用，剩余 artifact quality baseline、反馈 intake 和 RC 修复批次，粗略估算 **2-5 个有效开发日**。

Stage 30 已完成 Skill-only alpha hardening、manual acceptance、`pnpm alpha:check`、真实 provider opt-in 说明和 fail-closed 提示整理。Stage 31 已完成 deterministic Browser E2E acceptance，`pnpm alpha:e2e` 覆盖第一版浏览器可见闭环。Stage 32 已完成 provider usage metadata 和 streaming capability 可见性。Stage 33 已完成 Manual alpha UX tightening，处理 sidebar navigation、quick prompt、空状态和人工 alpha 高频文案摩擦。Stage 34 已完成 browser failure injection 和轻量 visual layout contract。Stage 35 已完成普通聊天 provider token delta streaming。Stage 36 已完成真实 provider alpha smoke matrix 和 operator docs。Stage 37 已完成 Skill-only alpha release candidate checklist。Stage 38 已完成 ordinary chat streaming failure UX hardening。第一版可用闭环下一步优先补齐：

- LP artifact quality evaluation / prompt hardening，让内部 alpha 更容易判断“复杂 LP 任务是否真的可用”。
- Alpha feedback intake / triage loop，把 RC 模板变成可重复的反馈批次和修复优先级。
- Alpha RC trial fix batch，只处理内部 RC 后的 blocker / high priority 摩擦。

当前仍明确后置：

- 真实 fallback provider execution、tool-call protocol conversion、billing / quota enforcement、provider cost ledger，以及 LP structured output token-level UI。
- 真实 MCP SDK / remote MCP server adapter、write tools 和 MCP worker execution。
- Streaming stdout/stderr summaries。
- 真实 shell runner、强 sandbox、OS-level isolation。
- 真实部署编排。
- Auth/RBAC on top of Postgres。
- Object storage / artifact file content migration。
- Prisma migrations and production deployment docs。
- Desktop packaging 和 desktop filesystem workspace。

## 已完成阶段记录

### Stage 18：Agent Run Lifecycle & Recovery v0

**状态：** 已实现。

Stage 18 已完成 Agent run lifecycle / recovery v0：API 侧从 run events、worker jobs、tool observations 和 handoffs 派生 `RunLifecycleView`、安全 `diagnosticSummary` 和 recovery action contract，并强化 worker finalization 幂等性。

### Stage 19：Worker Daemon、Heartbeat 和 Streaming Logs v0

**状态：** 已实现。

Stage 19 v0 已实现 worker daemon / polling loop、heartbeat metadata、stale safe claim recovery、bounded worker lifecycle logs 和 Web 只读 worker queue visibility。

daemon 配置 workbench repository 时会复用 Stage 18 的幂等 finalizer，把 terminal worker job 回写到 run/tool events；未配置时只更新 worker job 和 worker logs。Stage 19 的 logs 仍是 lifecycle summary，不是 raw stdout/stderr streaming。

**设计：** `docs/superpowers/specs/2026-05-19-worker-daemon-heartbeat-logs-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-19-worker-daemon-heartbeat-logs.md`。

### Stage 20：MCP Execution v0

**状态：** 已实现。

Stage 20 v0 已实现 read-only MCP tool execution：API 侧校验 project、connector、tool、role、permission、approval 和 read-only 边界后，通过 deterministic local executor 写入 run events 与安全 `ToolObservationRecord`。Web MCP 页提供最小只读执行入口；raw arguments、raw output、secret、完整 artifact 内容和本机路径不会进入 observation、timeline、chat message 或 model context。

**设计：** `docs/superpowers/specs/2026-05-19-mcp-execution-v0-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-19-mcp-execution-v0.md`。

### Stage 21：Model Repair、Retry 和 Fallback v0

**状态：** 已实现。

Stage 21 v0 已实现真实模型路径的可靠性增强：Planner / Builder structured output parse 或 policy failure 后会做一次安全 repair，provider 临时错误会 bounded retry，项目 route 可解析 fallback metadata 并在失败时记录安全 fallback availability event。

已实现范围：

- Planner / Builder one-shot repair loop，repair prompt 不包含首次 raw model output 或 raw artifact 内容。
- Provider error classification、最多两次尝试、`model.retry.scheduled` / `model.retry.exhausted` events。
- Fallback route metadata resolution 和 `model.fallback.available` / `model.fallback.not_configured` events。
- Lifecycle regression coverage：completed repaired run 保留 parse failure history，但不显示失败诊断。

未实现范围：

- 不自动调用 fallback provider；v0 只暴露 fallback metadata 和安全事件。
- 不做 streaming model output、tool-call conversion、自动 provider marketplace、usage/cost accounting。

**设计：** `docs/superpowers/specs/2026-05-19-model-repair-retry-fallback-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-19-model-repair-retry-fallback.md`。

### Stage 22：Postgres Repository v0

**状态：** 已实现 foundation v0。

**为什么现在做：** Stage 18-21 已经把 run lifecycle、worker queue、MCP execution 和真实模型可靠性做到本地 MVP 可审计状态。下一步如果要支持严肃多人/公司内部使用，Postgres repository 是项目共享、auth、durable background workers 和 audit 的基础。

**建议范围：**

- 先把 Prisma schema 对齐当前核心 `WorkbenchRepositories` contract：tasks、messages、task snapshots、runs、run events、tool observations、agent handoffs、artifact workspace metadata。
- 新增 Prisma/Postgres-backed repository adapter 的清晰边界，但默认本地开发仍保留 in-memory 和 JSON-file repositories。
- 第一批 implementation 只覆盖 Agent runtime 可观察性闭环：project/task/message、run timeline、tool observation、handoff、artifact workspace metadata。
- 增加 schema validation、mapper tests、shared repository contract tests 和 opt-in Postgres integration test 策略。

**非目标：**

- 不在同一阶段做完整 hosted auth。
- 不做 object storage migration。
- 不做 production deployment architecture。
- 不切换默认 Web/runtime backend。
- 不一次性实现 Skills、MCP connector、model provider、deployment 等所有 repository 的 Prisma backend。

**当前设计：** `docs/superpowers/specs/2026-05-19-postgres-repository-foundation-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-19-postgres-repository-foundation.md`。

### Stage 23：Web Opt-in Postgres Backend Wiring v0

**状态：** 已实现。

Stage 23 v0 已实现 Web opt-in Postgres backend wiring。Web 默认 backend 仍是 `.lp-agent/workbench-state.json` JSON-file state；显式设置 `WORKBENCH_REPOSITORY_BACKEND=postgres` 时，Web/API runtime 选择 Prisma-backed repositories。

已实现范围：

- `WORKBENCH_REPOSITORY_BACKEND=json|memory|postgres` Web repository backend factory。
- Postgres path 需要 `DATABASE_URL` 和 `WORKBENCH_POSTGRES_WORKSPACE_ID`；缺失、非法 backend 值或初始化失败时 fail closed，不静默回退 JSON-file。
- Web-facing Prisma repository closure 覆盖 project members、deployments、skills、models、MCP config/approval 等 Web 可见状态，避免 Postgres + JSON split-brain。
- `WORKBENCH_POSTGRES_BOOTSTRAP=1` 只 upsert local organization/workspace prerequisites。
- 开发文档说明 opt-in 命令、bootstrap 范围和回到默认 JSON-file backend 的方式。

未实现范围：

- 不做 production migration strategy、hosted auth、RBAC 或 invite flow。
- 不迁移 artifact file content 到 object storage。
- Worker queue Postgres backend 已在 Stage 24 单独完成，不属于 Stage 23 范围。
- 不迁移既有 JSON-file state。
- 不改变默认本地开发 backend。

**当前设计：** `docs/superpowers/specs/2026-05-20-web-opt-in-postgres-backend-wiring-design.md`。

**当前实施计划：** `docs/superpowers/plans/2026-05-20-web-opt-in-postgres-backend-wiring.md`。

### Stage 24：Worker Job Postgres Backend v0

**状态：** 已实现。

Stage 24 v0 已实现 worker queue 的显式 opt-in Postgres backend。Web workbench state backend 和 worker queue backend 仍是两个独立 runtime boundary；默认本地 worker queue 继续使用 JSON-file。

已实现范围：

- `WORKER_REPOSITORY_BACKEND=json|memory|postgres` shared worker queue backend factory。
- Prisma worker job、safe persisted payload 和 bounded lifecycle log repositories。
- shared repository contract tests 覆盖 claim token、conditional update、cancel/interrupt、heartbeat、stale safe recovery 和 bounded lifecycle logs。
- Web enqueue 与 `apps/agent-worker` 通过同一 backend selection helper opt in Postgres，避免 queue split-brain。
- 默认 JSON-file worker queue 不变；Postgres 模式缺少 `DATABASE_URL` 或初始化失败时 fail closed。

未实现范围：

- 不做 production process manager。
- 不开放真实 shell runner 或 OS-level sandbox。
- 不把 MCP execution 迁到 worker。
- 不做 raw stdout/stderr streaming。

**当前设计：** `docs/superpowers/specs/2026-05-20-worker-job-postgres-backend-design.md`。

**当前实施计划：** `docs/superpowers/plans/2026-05-20-worker-job-postgres-backend.md`。

### Stage 25：Run Recovery UI v0

**状态：** 已实现。

Stage 25 v0 已把 Stage 18 的 lifecycle view、diagnostic summary 和 recovery action contract 变成 Web task timeline 的 inline recovery block，并接入第一批安全可执行恢复动作。

已实现范围：

- Web task state 现在包含 API 派生的 recovery views，并在 task timeline / run panel 展示 `RunLifecycleView` 状态、安全诊断和推荐 recovery action。
- Server action 会在执行前重新读取 repository state 并重新派生 lifecycle，不信任浏览器提交的 action availability。
- 已实现第一批安全 executable server actions：`resume_worker_finalization` 和可控 `retry_run`；`request_approval`、`resolve_blocker`、`inspect_manually` 仍是 non-executable guidance。
- `retry_run` 只做 safely reconstructable single-run retry，创建新的 retry attempt / run id，不覆盖原 failed run，也不自动重跑完整 agent chain；输入或目标输出不能安全确认时 fail closed。
- 已覆盖 completed repaired run、failed parse/retry exhausted run、missing worker finalization、cancelled run 和 blocked handoff 的 UI/API regression。
- 保持 diagnostic summary 脱敏，不展示 raw model output、raw tool output、secret、完整 artifact 内容或本机路径。

**非目标：**

- 不做通用 DAG scheduler。
- 不自动重跑整条 agent chain。
- 不做 streaming UI。
- 不实现团队审批队列。

**设计：** `docs/superpowers/specs/2026-05-20-run-recovery-ui-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-20-run-recovery-ui.md`。

### Stage 26：Streaming Chat Transport and UI v0

**状态：** 已实现。

Stage 26 v0 已把普通聊天的 Web/API 实时反馈边界接入 workbench：API route 持久化 user message 和 placeholder assistant message，返回 NDJSON event stream；客户端用 transient streaming state 追加 assistant delta，收到 terminal event 后回到 repository fact，刷新后仍以 server state 为准。

已实现范围：

- 新增 `chat-stream` event contract 和 `/api/chat/stream` route，覆盖 ordinary assistant text delta、terminal message、safe error 和 run status update。
- Web store / streaming workbench 已支持 per-task streaming placeholder、delta append、terminal replacement、interruption 标记和 refresh recovery。
- LP / project setup 仍通过既有 `submitPromptAction` fallback，避免 streaming route 把初始化流程和普通聊天运行语义混在一起。
- 显式 null task routing 用于普通聊天入口，避免 stale task cookie 把新输入误路由到旧 task。
- streaming payload 只包含面向 UI 的安全文本和状态摘要，不暴露 raw model response、secret、raw tool output 或完整 artifact 内容。

**非目标：**

- 不在本阶段改完整 LP agent chain。
- 不做 MCP/tool-call streaming。
- 不做 raw stdout/stderr streaming。
- 不引入 auth/RBAC、生产部署或 object storage。

**设计：** `docs/superpowers/specs/2026-05-20-streaming-chat-transport-ui-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-20-streaming-chat-transport-ui.md`。

### Stage 27：Real Chat Runtime and Skill Context v0

**状态：** 已实现。

Stage 27 v0 已把 project-bound 普通聊天从 deterministic response 升级为可显式 opt-in 的真实模型 runtime，并通过独立 `assistant` role 与 LP `Planner` 结构化输出边界隔离。普通聊天仍复用 Stage 26 streaming transport，但 API/service 层负责 assistant prompt assembly、safe context summary 和 fail-closed runtime behavior。

已实现范围：

- 新增普通聊天专用 `assistant` agent/model role，避免复用 `planner` route。
- project-bound 普通聊天可通过 `REAL_MODEL_RUNTIME=1` 走 provider-backed assistant runtime，并通过 Stage 26 streaming 边界展示。
- 已发布、已绑定 project skills 进入 bounded assistant prompt context；UI stream 暴露 project / skill context summary，不暴露 raw skill content。
- 模型失败、provider transient error、fail-closed runtime behavior 和 cancellation 映射为安全 stream / run status events。
- deterministic runtime 仍是默认测试路径；projectless 普通聊天继续保持 deterministic / no-context。
- Models UI 已支持配置和展示 `assistant` route status。

未实现范围：

- 不做 LP agent chain end-to-end。
- 不做 MCP execution。
- 不做 tool-call protocol conversion。
- 不做真实 shell 或 deployment runner。
- 不做 provider token streaming、usage/cost reporting、auth/RBAC、object storage 或 Postgres production rollout。

**设计：** `docs/superpowers/specs/2026-05-21-real-chat-runtime-skill-context-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-21-real-chat-runtime-skill-context.md`。

### Stage 28：LP Agent Chain End-to-End v0

**状态：** 已实现。

Stage 28 已完成 LP Agent Chain End-to-End v0：LP 复杂任务现在采用 task-first orchestration，同一个 task 绑定 Planner / Builder / Reviewer / Deployer runs、handoff、artifact workspace、deployment handoff 和 recovery facts。

已实现范围：

- Web 提交 LP 复杂任务时先创建或复用 `lp_generation` task，并把 user / assistant message 保留在同一 task thread。
- 固定 `Planner -> Builder -> Reviewer -> Deployer` chain 在同一个 `taskId` 下运行，snapshot 会逐步保存 project / brief / page version。
- Builder 成功后写 durable artifact workspace；Reviewer 通过后创建 deployment handoff；Reviewer blocked 和 Deployer failure 保留可见 recovery facts。
- 同一 LP task 支持继续输入修改，下一轮 Builder context 显式绑定上一版 artifact workspace metadata，避免被同项目其它 page version 污染。
- Planner / Builder 在 `REAL_MODEL_RUNTIME=1` 下可通过真实模型 structured output 走 Web store；Reviewer / Deployer 仍保持 deterministic / policy-driven。

未实现范围：

- 不做通用 DAG scheduler。
- 不做真实外部部署。
- 不做 MCP、write tools 或 shell execution。
- 不做多人审批队列。
- 不做 no-refresh live timeline；该体验进入 Stage 29。

**设计：** `docs/superpowers/specs/2026-05-21-lp-agent-chain-end-to-end-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-21-lp-agent-chain-end-to-end.md`。

### Stage 29：Live Run Timeline and Artifact Progress v0

**状态：** 已实现。

Stage 29 v0 已把 LP task 的 run lifecycle、worker state、recovery view 和 artifact progress 统一成 no-refresh live task panel。普通聊天仍先走 `/api/chat/stream`；当服务端返回 LP `fallback.required` 时，客户端调用 `/api/tasks/submit` 创建 live task 并启动 in-process LP chain，再通过 `/api/tasks/[taskId]/state` 短轮询 repository facts。

已实现范围：

- Store 和 route 层提供 safe `LiveTaskStatePayload`，只暴露 sanitized task/run/recovery/worker/artifact progress facts，不扩散 raw artifact content。
- `/api/tasks/submit` 支持 live LP task start，创建 task 后立即返回，由客户端轮询状态。
- `LiveTaskPanel` 通过短轮询展示 compact progress，并在新的 `previewVersionKey` 可用时刷新 preview/export。
- Streaming workbench 将 LP fallback 从阻塞式 native form submit 改为 live task submit；ordinary chat streaming 边界保持不变。
- Web page 在 task-ready conversation stack 内渲染 live task panel，并把初始 artifact progress key 与 store 公式对齐。
- smoke 覆盖 live state artifact progress、固定 run roles 和 raw HTML/CSS/JS 内容不泄漏。

未实现范围：

- 不做 SSE。
- 不做 raw stdout/stderr streaming。
- 不做实时多人协作。
- 不引入生产 observability stack。
- 不做 object storage migration。
- Stage 29 本身不做 browser E2E acceptance；该项已由 Stage 31 补齐。

**设计：** `docs/superpowers/specs/2026-05-21-live-run-timeline-artifact-progress-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-21-live-run-timeline-artifact-progress.md`。

### Stage 30：Skill-Only Alpha Hardening v0

**状态：** 已实现。

Stage 30 v0 已把第一版可用闭环收敛成 Skill-only local alpha：默认 deterministic、本地单用户、Web/API/Skill/LP 主路径清晰。Browser E2E 已由 Stage 31 补齐，provider usage/streaming 已由 Stage 32/35 补齐，MCP 和真实部署继续后置。

已实现范围：

- README 已把 **Skill-only local alpha** 作为第一入口，说明普通聊天 streaming、LP live task、静态 artifact、项目 Skills、Skill command queue 和真实 provider opt-in。
- 新增 `pnpm alpha:check` deterministic readiness gate，覆盖 smoke、i18n、page、streaming、live task 和 task route，不依赖浏览器、网络、真实 provider key、MCP、Postgres 或真实部署。
- Web Skills / Models / MCP views 增加 alpha boundary copy：Skills 是主扩展路径，真实 provider 是显式 opt-in 且 fail closed，MCP 在 alpha 中后置。
- `docs/web-v1-acceptance.md` 已升级为 Skill-only alpha 手动验收清单，覆盖普通聊天、LP live task、artifact、Skills、Models opt-in、MCP deferred 和回归命令。
- i18n/page tests 覆盖新增 alpha 文案和页面提示。

未实现范围：

- 不做 production auth/RBAC。
- 不做 production Postgres migrations。
- 不做 MCP 新功能或把 MCP 设为 alpha 必需项。
- 不做真实部署编排。
- Stage 30 本身不做 Browser E2E；该项已由 Stage 31 补齐。
- 不做 provider usage metadata、真实 token streaming 或 usage/cost metadata；provider usage metadata 已由 Stage 32 补齐，普通聊天 token delta 已由 Stage 35 补齐，成本结算仍后置。

**设计：** `docs/superpowers/specs/2026-05-22-skill-only-alpha-hardening-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-22-skill-only-alpha-hardening.md`。

### Stage 31：Browser E2E Acceptance v0

**状态：** 已实现。

Stage 31 v0 added deterministic Playwright browser acceptance gate. `pnpm alpha:e2e` starts local Next.js dev server, uses isolated JSON state, Chromium-only, covers ordinary chat streaming, LP live task, artifact preview/export/snippet, Skills / Models / MCP alpha boundary and bounded recovery error display.

已实现范围：

- Playwright config/specs/scripts。
- Isolated `LP_AGENT_WORKBENCH_STATE_FILE` and worker queue JSON state。
- Ordinary chat / LP / artifact / boundary browser acceptance。
- Ignored `test-results/` and `playwright-report/`。

未实现范围：

- 不做 remote browser farm。
- 不做 cross-browser matrix。
- 不做 visual regression。
- 不做 real provider token delta streaming 或 usage metadata；usage metadata 已由 Stage 32 补齐，普通聊天 token delta 已由 Stage 35 补齐。
- 不做 MCP 新功能。
- 不做 real shell runner。
- 不做 auth/RBAC。
- 不做 production observability。
- 不做 real deployment orchestration。
- 不把 `alpha:e2e` 合并进 `alpha:check`。

**设计：** `docs/superpowers/specs/2026-05-22-browser-e2e-acceptance-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-22-browser-e2e-acceptance.md`。

### Stage 32：Provider Streaming and Usage Metadata v0

**状态：** 已实现。

Stage 32 v0 已实现真实 provider 路径的 bounded usage/call metadata 和 Web timeline summary。它让 `model-gateway`、runtime event、API run event 和 Web timeline 都能表达 provider-reported / estimated usage、duration、attempt、supportsStreaming 和 streamingEnabled，同时继续保护 raw provider response、prompt、raw model output、base URL、secret 和 artifact content。普通聊天 token delta 后续已由 Stage 35 补齐；LP structured output token-level UI 仍后置。

已实现范围：

- `ModelResponse` 新增 usage source、totalTokens 和 call metadata。
- OpenAI-compatible 和 Anthropic-compatible adapters 解析 provider usage，并记录 duration / streaming state。
- Mock/deterministic 路径标记 estimated usage，保持默认 deterministic。
- `model.completed` runtime/API run events 透传 bounded usage summary。
- Web timeline compact meta 展示 provider/model/protocol/tokens/source/duration/streaming state。
- README、Agent 学习笔记、Superpowers index 和 roadmap 已同步。

未实现范围：

- 不做普通聊天 token delta UI；该项后续已由 Stage 35 补齐。
- 不做自动 fallback provider execution。
- 不做 tool-call protocol conversion。
- 不做 billing、quota enforcement、cost ledger 或 provider marketplace。
- 不做 MCP、真实 shell runner、auth/RBAC 或生产 observability stack。

**设计：** `docs/superpowers/specs/2026-05-22-provider-streaming-usage-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-22-provider-streaming-usage.md`。

### Stage 33：Manual Alpha UX Tightening v0

**状态：** 已实现。

Stage 33 v0 已完成 manual alpha UX tightening：高频可见入口不再只是静态 affordance，用户可以从 sidebar 切换 project/task、清空当前 task 进入新任务、直接点击 entry chips 或 task suggestions 提交 prompt。

已实现范围：

- `startNewTaskAction`、`selectProjectAction`、`selectTaskAction` 和 current task cookie clear helper。
- Sidebar new task / project / task rows 改为真实 form submit，并在选择 project 时清空旧 task 上下文。
- 无任务时显示明确空状态，不再用伪任务 title 占位。
- Entry chips 和 task suggestions 改为 quick prompt submit forms，复用现有 `submitPromptAction`。
- Web copy / CSS / page/action regression tests / manual alpha checklist 已同步。

未实现范围：

- 不做大型 UI 重构或新信息架构。
- 不做 MCP 新功能、真实 shell runner、真实部署编排或 production auth/RBAC。
- 不改变 streaming transport、LP agent chain、run event schema、model gateway、MCP 或 worker execution boundary。

**设计：** `docs/superpowers/specs/2026-05-22-manual-alpha-ux-tightening-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-22-manual-alpha-ux-tightening.md`。

### Stage 34：Browser Failure Injection and Visual Regression v0

**状态：** 已实现。

Stage 34 v0 已完成 browser failure injection 和轻量 visual layout contract。默认 `pnpm alpha:e2e` 仍是 deterministic Chromium、本地 Next.js dev server 和隔离 JSON state，但覆盖范围从 happy path 扩展到更多 browser-visible failure states。

已实现范围：

- 新增 `alpha-failures.spec.ts`，覆盖 Models provider fail-closed 和 Skills worker queue bounded error，且不泄漏 query 中的 secret-like values。
- 扩展 recovery / artifact browser coverage，覆盖 `recoveryError` 查询参数、unknown artifact path 和 invalid/path-traversal artifact query 的 graceful failure。
- 新增 `alpha-visual.spec.ts`，用 geometry/layout contract 校验 sidebar、workspace、composer 和 prompt/send controls 的关键位置。
- Visual v0 不提交 screenshot baseline；只在 Playwright output 中保存 diagnostic screenshot artifact。
- README、AGENTS、manual checklist、Superpowers index 和 roadmap 已同步。

未实现范围：

- 不引入远端 browser farm 或跨浏览器矩阵。
- 不让默认 browser E2E 依赖真实 provider、MCP server、Postgres 或真实部署。
- 不做 pixel-perfect screenshot baseline、大型 UI redesign、生产 observability stack、auth/RBAC 或真实 shell runner。

**设计：** `docs/superpowers/specs/2026-05-22-browser-failure-visual-regression-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-22-browser-failure-visual-regression.md`。

### Stage 35：Provider Token Delta Streaming v0

**状态：** 已实现。

Stage 35 v0 已完成普通聊天 `assistant` role 的 provider token delta streaming。Web/API 仍沿用 Stage 26 NDJSON contract，但 project-bound assistant 在 route/model 支持 streaming 时会直接消费 provider SSE token delta；最终只持久化完整 assistant message 和 terminal run/model events。

已实现范围：

- `packages/model-gateway` 新增 provider-neutral `ModelStreamEvent` contract 和 `ModelGateway.stream()`，同时保留 `complete()` 作为 LP structured output 的完整 buffer API。
- OpenAI-compatible Chat Completions streaming adapter 支持 `stream: true`、`stream_options.include_usage`、SSE `choices[].delta.content` parsing、terminal usage summary 和 missing usage estimated fallback。
- Anthropic-compatible Messages streaming adapter 支持 `stream: true`、`content_block_delta` text delta parsing、`message_start` / `message_delta` usage summary 和 missing usage estimated fallback。
- `LocalAgentRuntimeAdapter.stream()`、`DemoWorkbenchService.runAssistantChatStream()`、Web store 和 `/api/chat/stream` 已接入 assistant-only stream path；token chunks 只作为 transient `assistant.delta`，不写入 run event 或业务输出。
- LP Planner / Builder 仍走 `ModelGateway.complete()`，继续完整 buffer 后做 schema parse / repair 和 artifact policy validation。
- Agent 学习笔记、Superpowers index 和 roadmap 已同步。

未实现范围：

- 不做 LP structured output token-level UI。
- 不做 tool-call streaming、MCP streaming、raw stdout/stderr streaming 或 worker log streaming。
- 不做 fallback provider execution、billing/quota、provider marketplace 或 production observability。
- 不改变 deterministic default 或无 key alpha gate。

**设计：** `docs/superpowers/specs/2026-05-22-provider-token-delta-streaming-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-22-provider-token-delta-streaming.md`。

### Stage 36：Real Provider Alpha Smoke Matrix and Operator Docs v0

**状态：** 已实现。

Stage 36 v0 已把真实 provider alpha smoke 整理成 operator-facing 文档，并用 fake-provider regression 锁定 provider streaming usage metadata 和 missing-key fail-closed 的脱敏行为。默认 `pnpm alpha:check`、`pnpm smoke`、`pnpm alpha:e2e` 和普通 `pnpm test` 仍保持 deterministic/no-key。

已实现范围：

- 新增 `docs/real-provider-alpha-smoke.md`，覆盖 `.env.local`、provider route、`REAL_MODEL_RUNTIME=1`、OpenAI-compatible / Anthropic-compatible 配置、manual smoke matrix、可选 integration tests、排错和 reset deterministic。
- README 和 `docs/web-v1-acceptance.md` 已指向真实 provider smoke 文档，并明确默认 gates 不触发真实 provider。
- `packages/api/src/services.test.ts` 新增 OpenAI-compatible assistant fake SSE regression，覆盖 provider-reported usage、`streamingEnabled=true`、terminal `model.completed` 和 secret/base URL/env 名称不进 run events。
- 新增 missing-key assistant streaming fail-closed regression，覆盖 bounded `model_provider_api_key_missing` run event 和 fake fetch 不执行。
- Agent 学习笔记、Superpowers index 和 roadmap 已同步。

未实现范围：

- 不让默认 `pnpm alpha:check`、`pnpm smoke`、`pnpm alpha:e2e` 或普通 `pnpm test` 依赖真实 API key。
- 不做生产 secret manager、billing/quota、fallback execution、provider marketplace 或 hosted observability。
- 不改变 LP artifact policy、structured output parse / repair 或 deterministic fallback。
- 不做真实 provider 自动化 E2E 或 hosted provider matrix。
- 不做 assistant streaming failure UX hardening；该项进入 Stage 38。

**设计：** `docs/superpowers/specs/2026-05-22-real-provider-alpha-smoke-operator-docs-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-22-real-provider-alpha-smoke-operator-docs.md`。

### Stage 37：Skill-only Alpha Release Candidate Checklist v0

**状态：** 已实现。

Stage 37 v0 已把内部 Skill-only local alpha release candidate 的 go/no-go、operator trial script、feedback template、triage 分类和已知限制整理成单独入口。详细人工验收继续在 `docs/web-v1-acceptance.md`，真实 provider smoke 继续在 `docs/real-provider-alpha-smoke.md`。

已实现范围：

- 新增 `docs/alpha-release-candidate.md`，覆盖 RC 定义、go/no-go gates、60-90 分钟 operator trial script、feedback template、triage 分类、known limitations、follow-up routing 和 RC decision record。
- README 已把 RC 文档加入手动验收入口和文档地图。
- `docs/web-v1-acceptance.md` 已明确自身是详细人工验收清单，RC 决策和反馈分类以 RC 文档为准。
- `docs/real-provider-alpha-smoke.md` 已把真实 provider smoke 问题路由到 RC feedback template。
- Superpowers index 和 roadmap 已同步。

未实现范围：

- 不做 production auth/RBAC、真实部署编排、MCP 新功能、真实 shell runner、object storage 或 hosted observability。
- 不把内部试用 checklist 变成 public SaaS onboarding。
- 不改变 runtime、model gateway、worker queue 或 artifact workspace contract。
- 不做 issue tracker 集成、反馈数据库、遥测、自动截图上传或 hosted triage board。

**设计：** `docs/superpowers/specs/2026-05-23-skill-only-alpha-release-candidate-checklist-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-23-skill-only-alpha-release-candidate-checklist.md`。

### Stage 38：Assistant Streaming Failure UX Hardening v0

**状态：** 已实现。

Stage 38 v0 已为普通聊天 provider streaming 的失败路径增加 typed failure codes、API/runtime failure classification、route terminal error mapping、empty response guard、persistence failure copy、cancel-safe stream persistence guard 和 localized Web failure copy，并把 operator troubleshooting 写入真实 provider smoke 文档。

已实现范围：

- `assistant` 普通聊天 provider streaming 失败会映射为 `provider_configuration_failed`、`stream_interrupted`、`empty_response` 和 `persistence_failed` 等安全类别。
- Web/API failure copy 使用 localized、bounded 文案，不泄漏 secret、raw provider response、raw SSE frame、本机路径或完整 artifact 内容。
- Empty terminal response 不再保存空 assistant message；persistence failure 会区分“模型已生成但本地保存失败”。
- Client cancel / disconnect 不把 transient partial delta 当作已完成 assistant message，刷新后仍以 repository terminal facts 为准。
- Regression 覆盖 fake-provider streaming failure、empty response、persistence failure 和 cancel-safe persistence guard。
- `docs/real-provider-alpha-smoke.md` 已新增 ordinary chat streaming failure operator 排查表。

未实现范围：

- 不做 MCP/tool-call/raw stdout streaming。
- 不做 provider fallback execution、billing/quota、production observability 或 hosted retry queue。
- 不改变 LP Planner / Builder complete-buffer structured output 边界。

**设计：** `docs/superpowers/specs/2026-05-23-assistant-streaming-failure-ux-design.md`。

**实施计划：** `docs/superpowers/plans/2026-05-23-assistant-streaming-failure-ux.md`。

## 推荐下一阶段队列

### Stage 39：LP Artifact Quality Evaluation and Prompt Hardening v0

**状态：** Stage 38 后推荐，可按内部 alpha 反馈提前。

**为什么现在做：** Web/API/Skill/LP 主链路已经可跑通，下一步内部 alpha 需要判断复杂 LP 任务的实际输出质量，而不是只看是否生成三文件 artifact。需要一套轻量质量 rubric、prompt fixtures 和人工评审记录，让后续 prompt/runtime 改动有可比较基线。

**建议范围：**

- 整理 5-8 个代表性 LP prompt fixtures，覆盖电商活动、B2B SaaS、活动报名、本地服务、移动端优先和中英混合输入。
- 定义静态 artifact 质量 rubric：结构完整、视觉层级、CTA、响应式、安全资源、framework-free、可读 copy 和基础可访问性。
- 补充 deterministic / fake-provider artifact quality smoke 或文档化人工评审表，避免把质量判断完全留在聊天记录里。
- 对 Planner / Builder prompt 做小范围 hardening，只基于现有 schema/policy，不改变 artifact contract。

**非目标：**

- 不做自动视觉评分、LLM-as-judge 生产 gate、设计系统重写或图片生成 pipeline。
- 不改变三文件静态 artifact policy、preview/export contract 或 provider adapter。
- 不把质量 rubric 变成 public SaaS onboarding 或客户验收 SLA。

### Stage 40：Alpha Feedback Intake and Triage Loop v0

**状态：** Stage 39 后推荐，可按内部 RC 试用启动时间提前。

**为什么现在做：** Stage 37 已给出反馈模板和 triage 分类，但真实内部试用开始后需要把反馈批次化，形成 known issues、修复优先级和阶段切分，避免把所有反馈都直接变成无边界开发任务。

**建议范围：**

- 新增轻量反馈 intake runbook，说明如何收集 RC feedback template、如何脱敏、如何标记 category/severity/status。
- 维护一个本地 `docs/alpha-feedback-log.md` 或等价文档，记录批次、blocking items、accepted follow-ups 和 rejected/out-of-scope items。
- 把 Stage 38/39/backlog 的分流规则落到实际反馈样例，形成下一批修复计划。
- 保持反馈记录只含 safe evidence，不保存 secret、raw provider response、完整 artifact 内容、本机路径或 raw worker/tool payload。

**非目标：**

- 不引入 hosted issue tracker、数据库、遥测、自动截图上传、用户账号或团队审批系统。
- 不承诺 public roadmap、SLA 或客户发布节奏。
- 不在同一阶段直接修复所有反馈；只做 intake、triage 和下一批计划。

### Stage 41：Alpha RC Trial Fix Batch v0

**状态：** Stage 40 后推荐，可按内部 RC 反馈提前。

**为什么现在做：** Stage 37/40 会让内部试用反馈变成批次化输入。第一轮 RC 后需要一个小范围修复批次，只处理阻塞和高频 alpha 摩擦，避免把反馈直接扩成无边界 roadmap。

**建议范围：**

- 从 `docs/alpha-feedback-log.md` 或同等反馈批次中挑选 blocker/high priority。
- 修复普通聊天、LP artifact、Skills 或 docs 的小范围 alpha blocker。
- 保持每个修复都有 regression test 或明确人工验证步骤。

**非目标：**

- 不引入 production auth/RBAC、真实部署、billing/quota、MCP write tools、真实 shell runner 或 hosted observability。
- 不把所有 feedback 一次性清空。
- 不改变 LP artifact static HTML/CSS/JS contract。

## Backlog 分组

### Agent Runtime / Run Lifecycle

- Blocking question records and blocker resolution workflow。
- 固定 LP 链路稳定后的 general dependency graph。

### Context / Memory / Retrieval

- Persistent summary repository。
- 超出 deterministic same-project selection 的 hybrid retrieval。
- 带更强预算控制的 source-level selected snippets。
- Context diff 和 injection audit。
- 长期 project preferences 和 user preferences。

### Model Gateway

- 真实 fallback provider execution 和 cost/timeout policy。
- Billing / quota / cost reporting。
- LP structured output token-level UI。
- Tool-call protocol conversion。
- Additional provider manifests。

### Worker / Sandbox / Execution

- Streaming stdout/stderr summaries。
- Strong sandbox adapter。
- 受 explicit policy 和 approval 保护的真实 shell runner。
- Desktop-local execution adapter。

### MCP

- Real MCP SDK / remote MCP server adapter。
- MCP execution through worker runtime。
- MCP Write Tools with Approval v0。
- Connector health checks。
- Tool result summarization 和 redaction。
- MCP cancellation 和 timeout mapping。

### Artifact Workspace

- Line-level textual diff。
- File edit proposal model。
- Artifact patch/apply workflow。
- Desktop filesystem workspace mapping。
- Binary asset 和 object storage support。

### Collaboration / Auth

- Real user identity provider。
- Invite flow。
- Role-based access control。
- Team approval queue。
- Audit dashboard。
- 后续再做 real-time collaboration。

### Deployment

- Real deployment runner adapter。
- Git provider integration。
- Deployment approval workflow。
- Deployment status polling。
- Rollback 和 environment records。

### Web UI

- Stage 29 v0 之后的高级 no-refresh workbench interaction。
- 更细粒度 streaming run timeline / animation / visual hierarchy hardening。
- Browser failure injection 和轻量视觉回归扩展。
- Dedicated artifact workspace page。
- Stage 25 inline block 之后的高级 handoff/recovery UX。
- Core flow 稳定后再做 Skills/Models/MCP client-side management。

### Desktop

- Desktop wrapper。
- Desktop-local profile。
- Local filesystem workspace adapter。
- Local runtime policy UI。
- Offline mode constraints。

## 未来 Agent 读取顺序

选择或执行下一阶段时，按以下顺序阅读：

1. `docs/project-roadmap.md`：当前优先级和 backlog。
2. `docs/agent-development-learning.md`：Agent 概念、已实现能力和学习笔记。
3. `docs/superpowers/README.md`：specs/plans 的时间顺序和准确阅读顺序。
4. 当前任务对应的具体 stage spec/plan。
5. 本次会修改的 packages/apps 的本地代码和测试。

不要只根据最新 git commit 推断下一阶段。应把本 roadmap 作为第一规划输入。

## 维护规则

发生以下情况时更新本文件：

- 完成一个阶段。
- 新的 Superpowers spec 或 plan 改变了推荐下一阶段队列。
- 用户改变优先级，例如暂缓 Web UI 或提前 MCP execution。
- backlog item 已实现、废弃或拆成更小阶段。
- 引入新的基础能力领域，例如新的 runtime、storage layer 或 execution boundary。
- 后续 agent 发现本队列已经和当前代码或文档不一致。

更新方式：

- 将已完成的推荐阶段移入当前状态快照或对应完成说明。
- 推荐下一阶段队列保持在大约 3-5 个近期阶段。
- 每个近期阶段都明确写出非目标。
- 优先拆成小阶段，不要写成一个跨多个系统的大阶段。
- 如果 roadmap 因 Superpowers spec/plan 改变，也要保持 `docs/superpowers/README.md` 准确。
- 如果变化与 Agent 开发学习相关，也要更新 `docs/agent-development-learning.md`。

阶段收尾检查：

- 确认当前工作区和目标分支包含本阶段实现；如果实现发生在独立 worktree 或阶段分支，先确认已合并，或明确标注尚未合并。
- 确认本文件没有停留在“阶段已完成但推荐下一阶段队列为空”的状态。
- 确认当前状态快照、明确后置项、已完成阶段记录、推荐下一阶段队列和决策记录互相一致。
- 确认每个推荐阶段都有建议范围和非目标，且没有把多个大系统混成一个阶段。
- 确认 `docs/superpowers/README.md` 和 `docs/agent-development-learning.md` 是否也因本阶段变化需要同步更新。

## 决策记录

- Stage 38 已完成 Assistant Streaming Failure UX Hardening v0：普通聊天 provider streaming 失败现在有 typed failure codes、localized Web failure copy、empty response guard、persistence failure copy 和 cancel-safe stream persistence guard；Stage 38 不改变 LP Planner / Builder complete-buffer structured output 边界，后续 Stage 39/40/41 分别处理 artifact quality、反馈 intake 和 RC 修复批次。
- Stage 37 已完成 Skill-only Alpha Release Candidate Checklist v0：内部 RC 的 go/no-go、operator trial script、feedback template、triage 分类和 known limitations 已集中到 `docs/alpha-release-candidate.md`；Stage 37 不改变 runtime/provider/artifact contract，Stage 38 已处理 streaming failure UX，后续 Stage 39/40 分别处理 artifact quality 和反馈 intake。
- Stage 36 已完成 Real Provider Alpha Smoke Matrix and Operator Docs v0：真实 provider 手动 smoke 已集中到 `docs/real-provider-alpha-smoke.md`，默认 readiness gates 继续 deterministic/no-key；fake-provider regression 覆盖 provider streaming usage metadata 和 missing-key fail-closed 脱敏行为。
- Stage 35 已完成 Provider Token Delta Streaming v0：真实 provider token delta 只进入普通聊天 `assistant` role 的 transient UI，最终事实仍是完整 assistant message 和 terminal run/model events；LP Planner / Builder 继续完整 buffer structured output parse / repair。
- Stage 34 已完成 Browser Failure Injection and Visual Regression v0：`pnpm alpha:e2e` 现在覆盖 8 个 Chromium browser tests，包括 happy path、bounded recovery、provider fail-closed、worker queue bounded error、artifact invalid path 和空首页 layout contract；visual v0 采用 geometry assertion 和 diagnostic screenshot artifact，不提交 brittle screenshot baseline。
- Stage 33 已完成 Manual Alpha UX Tightening v0：sidebar new task / project / task 入口、entry chips、task suggestions 和空任务状态已收紧为真实可操作体验；本阶段没有改变 Agent runtime、model gateway、MCP、worker 或 run event 边界。
- Stage 32 已完成 Provider Streaming and Usage Metadata v0：真实 provider 路径现在有 provider-reported / estimated usage metadata、duration、attempt 和 streaming capability 可见性；普通聊天 token delta streaming 已由 Stage 35 补齐，自动 fallback execution、tool-call conversion、billing/quota、MCP 和生产 observability 继续后置。
- Stage 31 已完成 Browser E2E Acceptance v0：`pnpm alpha:e2e` 以 deterministic Playwright Chromium gate 覆盖普通聊天、LP live task、artifact preview/export/snippet、Skills / Models / MCP alpha boundary 和 bounded recovery error display。
- Stage 30 已完成 “Alpha 收口优先” 路径：现有 Web/API 第一版闭环已经整理成 Skill-only local alpha；provider usage/streaming 已由 Stage 32/35 补齐，MCP 和真实部署继续后置；Browser E2E 已由 Stage 31 补齐。
- Stage 29 已完成 Web task state no-refresh v0；Browser E2E 已由 Stage 31 实现，后续高级 streaming run timeline 和视觉/交互 hardening 继续留在 Web UI backlog。
- Stage 23 已完成 Web opt-in Postgres backend wiring；Stage 22 只提供 repository foundation，Stage 23 也不默认切换 runtime backend。
- Stage 24 已完成 worker job Postgres backend；worker queue 默认仍是 JSON-file，可通过 `WORKER_REPOSITORY_BACKEND=postgres` 显式 opt in。
- Stage 25 已完成 Run Recovery UI v0，把已有 lifecycle/recovery contract 变成用户可见、可执行的恢复流程；UI 采用 task timeline inline recovery block。
- Stage 25 的 `retry_run` 只做 safely reconstructable single-run retry，创建新 retry attempt，不覆盖原 failed run，也不自动重跑完整 agent chain。
- Stage 26 已完成 Streaming Chat Transport and UI v0，提供普通问答的 Web/API NDJSON streaming 边界。
- Stage 27 已完成 Real Chat Runtime and Skill Context v0：新增独立 `assistant` route，而不是复用 `planner` route；普通聊天真实模型 v0 聚焦 project-bound chat，projectless chat 继续保持 deterministic / no-context。
- Stage 28 已完成 LP Agent Chain End-to-End v0：LP 复杂任务现在采用 task-first orchestration，同一个 task 绑定 Planner / Builder / Reviewer / Deployer runs、handoff、artifact workspace、deployment handoff 和 recovery facts。
- Stage 29 已完成 Live Run Timeline and Artifact Progress v0：LP fallback 改走 live task submit，Web task panel 通过短轮询安全 repository facts 展示 run/recovery/worker/artifact progress，并在 artifact key 变化时刷新 preview/export。
- MCP Worker Execution、真实 MCP SDK / remote MCP server adapter 和 MCP write tools 已后置到 backlog，等待 Web/API/Skill/LP 第一版可用闭环稳定后再接入。
- 真实 shell execution 和 strong sandboxing 必须始终位于 explicit policy、approval 和 worker boundaries 后面。
- Deployment 应与 LP generation 分开；在内置 deployment product flow 之前，skills 可以先提供 deployment commands。
- 即使 workbench 持续演进，生成的 LP artifacts 也必须保持框架无关静态 HTML/CSS/JS。
