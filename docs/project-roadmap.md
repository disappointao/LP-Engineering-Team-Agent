# 项目路线图

最后更新：2026-05-21

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
- Web V1 readiness：root README、manual acceptance checklist、`pnpm smoke` deterministic smoke test。

## 第一版可用闭环目标

当前“第一版可用”不再按 README 里的本地 deterministic Web MVP 口径判断，而是按用户能在网页里完成真实产品闭环判断：

- 能在 Web workbench 里进行普通问答，回答支持流式展示。
- Web/API 能接真实模型 runtime，同时保留 deterministic fallback 作为测试路径。
- 能提交“写 LP / 改 LP / 继续优化 LP”这类复杂任务，并跑通 `Planner -> Builder -> Reviewer -> Deployer` 的可观察工作流。
- Skill 是第一版主要扩展机制：已发布、已绑定的 project skills 能进入上下文；受控 skill command 继续走 approval、worker、run event 和 observation 边界。
- Web 页面无需手动刷新即可看到任务状态、run timeline、artifact progress、失败诊断和可用恢复动作。
- 生成 LP 产物继续保持框架无关静态 HTML/CSS/JS，并支持 preview/export。

按当前代码基础，面向本地/单用户第一版可用闭环，粗略估算还需要 **10-15 个有效开发日**。如果要给少数内部用户稳定 alpha 试用，包含 browser E2E、真实 provider 冒烟、文档和交互 hardening，粗略估算 **15-25 个有效开发日**。

当前第一版可用闭环优先补齐：

- LP agent chain 的 Web/API/worker end-to-end 执行路径。
- Skill-only 上下文和 skill command 可观察工作流；MCP 暂不作为近期目标。
- Live run timeline、artifact progress 和 no-refresh task state。
- Browser E2E acceptance 和 alpha hardening。

当前仍明确后置：

- 真实 fallback provider execution、模型 usage/cost reporting 和 tool-call protocol conversion。
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

## 推荐下一阶段队列

### Stage 28：LP Agent Chain End-to-End v0

**状态：** 当前推荐下一阶段；设计已确认，待实施计划。

**为什么现在做：** 用户的核心复杂任务是“写 LP / 做 LP 等工作流任务”。当前已经有固定 LP 链路、真实 Planner/Builder structured output、artifact workspace、handoff、worker queue 和 recovery UI，但 Web 需要把这些能力组织成一个可用的端到端任务体验。

**建议范围：**

- Web 提交 LP 复杂任务后，API 创建可观察的 `Planner -> Builder -> Reviewer -> Deployer` chain，并把每个 run / handoff / artifact update 展示在 task timeline。
- `REAL_MODEL_RUNTIME=1` 下 Planner / Builder 使用真实模型 structured output；Reviewer / Deployer 可先保持 deterministic / policy-driven，以确保第一版稳定。
- Builder 成功后写 durable artifact workspace，Web artifact preview/export 自动更新。
- Reviewer blocked、模型 parse/retry exhausted、worker finalization gap 等失败继续通过 Stage 25 recovery UI 暴露。
- LP task 支持继续对话式修改：下一轮输入能引用当前 project/task/artifact metadata 和 bound skills。

**非目标：**

- 不做通用 DAG scheduler；只覆盖固定 LP 链路。
- 不自动真实部署。
- 不做 MCP、write tools 或 shell execution。
- 不做多人审批队列。

**设计：** `docs/superpowers/specs/2026-05-21-lp-agent-chain-end-to-end-design.md`。

### Stage 29：Live Run Timeline and Artifact Progress v0

**状态：** Stage 28 后推荐。

**为什么现在做：** LP 链路端到端可跑后，用户还需要不刷新页面就能理解任务正在做什么。Stage 26 解决 assistant text streaming，本阶段把 run events、worker state、recovery view 和 artifact progress 统一成 live task panel。

**建议范围：**

- Web task detail 通过 polling 或 SSE 读取 task state delta，展示 run lifecycle、worker queue health、recovery actions 和 artifact workspace changes。
- 对 running / queued / cancelling / failed / blocked / completed 提供一致 UI 状态和空状态。
- artifact preview/export 在新的 page version 或 workspace 可用时自动更新。
- interrupt/cancel 后 timeline 能实时反映 optimistic state 与 repository fact 的差异。
- 增加 browser E2E 覆盖普通聊天、LP chain、artifact 更新和失败恢复的核心路径。

**非目标：**

- 不做 raw stdout/stderr streaming。
- 不做实时多人协作。
- 不引入生产 observability stack。
- 不做 object storage migration。

### Stage 30：Skill-Only Alpha Hardening v0

**状态：** Stage 29 后推荐。

**为什么现在做：** 第一版可用闭环完成后，需要把“只用 Skill、不用 MCP”的 alpha 体验收敛到可交付状态：启动、配置、技能绑定、真实 provider opt-in、失败提示和验收都要清晰。

**建议范围：**

- 调整 README、manual acceptance 和 smoke/alpha scripts，明确第一版可用闭环、Skill-only 范围和 MCP 后置。
- 补齐 skill authoring / binding / command execution 与 chat/LP task 的可见关联。
- 做真实 provider 本地冒烟说明和 fail-closed 错误提示整理。
- 做 UI copy、empty/error/loading state hardening。
- 跑完整 `pnpm smoke`、`pnpm test`、`pnpm typecheck`，并执行 browser E2E / manual alpha checklist。

**非目标：**

- 不做 production auth/RBAC。
- 不做 production Postgres migrations。
- 不做 MCP。
- 不做真实部署编排。

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
- Usage/cost reporting。
- Streaming support。
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

- No-refresh workbench interaction。
- Streaming run timeline。
- Browser E2E acceptance。
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

- Web UI no-refresh 很重要，但当前暂缓到专门的 Web UI 阶段。
- Stage 23 已完成 Web opt-in Postgres backend wiring；Stage 22 只提供 repository foundation，Stage 23 也不默认切换 runtime backend。
- Stage 24 已完成 worker job Postgres backend；worker queue 默认仍是 JSON-file，可通过 `WORKER_REPOSITORY_BACKEND=postgres` 显式 opt in。
- Stage 25 已完成 Run Recovery UI v0，把已有 lifecycle/recovery contract 变成用户可见、可执行的恢复流程；UI 采用 task timeline inline recovery block。
- Stage 25 的 `retry_run` 只做 safely reconstructable single-run retry，创建新 retry attempt，不覆盖原 failed run，也不自动重跑完整 agent chain。
- Stage 26 已完成 Streaming Chat Transport and UI v0，提供普通问答的 Web/API NDJSON streaming 边界。
- Stage 27 已完成 Real Chat Runtime and Skill Context v0：新增独立 `assistant` route，而不是复用 `planner` route；普通聊天真实模型 v0 聚焦 project-bound chat，projectless chat 继续保持 deterministic / no-context。
- Stage 28 当前推荐补齐固定 LP Agent Chain End-to-End v0；设计已确认采用 task-first orchestration，把已有 Planner / Builder / Reviewer / Deployer 能力组织成可用的 Web/API 任务体验，Planner / Builder 先支持真实模型 structured output，Reviewer / Deployer 保持 deterministic / policy-driven。
- MCP Worker Execution、真实 MCP SDK / remote MCP server adapter 和 MCP write tools 已后置到 backlog，等待 Web/API/Skill/LP 第一版可用闭环稳定后再接入。
- 真实 shell execution 和 strong sandboxing 必须始终位于 explicit policy、approval 和 worker boundaries 后面。
- Deployment 应与 LP generation 分开；在内置 deployment product flow 之前，skills 可以先提供 deployment commands。
- 即使 workbench 持续演进，生成的 LP artifacts 也必须保持框架无关静态 HTML/CSS/JS。
