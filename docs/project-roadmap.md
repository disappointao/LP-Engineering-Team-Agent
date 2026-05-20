# 项目路线图

最后更新：2026-05-20

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
- Agent handoff v0：固定 LP 链路 `Planner -> Builder -> Reviewer -> Deployer` 的结构化 handoff state。
- Worker runtime / queue：job contract、sandbox policy、JSON-file persistence、cancel/interrupt、claim-token queue handoff、`apps/agent-worker` run-once / daemon polling loop、heartbeat、stale safe claim recovery、bounded lifecycle logs、Web 只读 queue health、安全 simulated payload。
- Artifact workspace：durable artifact workspace、manifest/hash/summary、controlled artifact reader、metadata-only static diff、bounded snippet。
- Collaboration primitives：local identity seam、workspace/project member repositories、project owner membership、approval actor audit context。
- Postgres repository foundation v0：Prisma schema 已对齐 Agent runtime 核心 repository contract，并提供显式 opt-in 的 Prisma-backed repository adapter。
- Web V1 readiness：root README、manual acceptance checklist、`pnpm smoke` deterministic smoke test。

当前仍明确后置：

- Web UI 无刷新体验、streaming UI、browser E2E。
- 真实 fallback provider execution、模型 usage/cost reporting、streaming model output 和 tool-call protocol conversion。
- 真实 MCP SDK / remote MCP server adapter、write tools 和 MCP worker execution。
- Streaming stdout/stderr summaries。
- 真实 shell runner、强 sandbox、OS-level isolation。
- 真实部署编排。
- Web opt-in Postgres backend wiring。
- Auth/RBAC on top of Postgres。
- Object storage / artifact file content migration。
- Prisma migrations and production deployment docs。
- Worker job repository Postgres backend。
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

## 推荐下一阶段队列

### Stage 23：Web Opt-in Postgres Backend Wiring v0

**状态：** 推荐下一阶段。

**为什么现在做：** Stage 22 已提供 Prisma-backed repository adapter，但 Web/API runtime 默认仍走 in-memory / JSON-file。下一步应先证明同一套 workbench flow 可以在显式开关下选择 Postgres backend，再考虑 production rollout、auth/RBAC 或 hosted 部署。

**建议范围：**

- 新增显式 backend 选择，例如 `WORKBENCH_REPOSITORY_BACKEND=postgres`，缺少 `DATABASE_URL`、workspace bootstrap 或 Prisma client 时 fail closed。
- Web/API repository factory 支持 in-memory、JSON-file、Prisma 三种 backend；默认本地开发仍保持 JSON-file / deterministic 路径。
- 补最小 Postgres-backed Web/API flow 覆盖，确认 task、message、snapshot、run timeline、tool observation、handoff 和 artifact workspace metadata 能通过同一 contract 使用。
- 增加开发文档，说明如何准备 workspace/project seed、如何开启 opt-in backend、如何回到默认本地 backend。

**非目标：**

- 不做 production migration strategy、hosted auth、RBAC 或 invite flow。
- 不迁移 artifact file content 到 object storage。
- 不把 worker job queue 切到 Postgres。
- 不改变默认本地开发 backend。

### Stage 24：Worker Job Postgres Backend v0

**状态：** Stage 23 之后推荐。

**为什么现在做：** Web workbench state 可选择 Postgres 后，worker queue 仍是 JSON-file。durable background workers、stale recovery、daemon heartbeat 和审计要进入多人/长期运行场景，需要把 worker job/log repository 单独迁出本地文件。

**建议范围：**

- 为 worker job、worker lifecycle log、heartbeat/stale recovery 需要的持久字段补 Prisma schema 和 mapper。
- 提取 worker job repository shared contract tests，覆盖 claim token、conditional update、cancel/interrupt、heartbeat、stale safe recovery 和 bounded lifecycle logs。
- 新增 Prisma-backed worker job repository，并让 `apps/agent-worker` 通过显式配置 opt-in。
- 保留 JSON-file worker queue 作为默认本地和 deterministic test backend。

**非目标：**

- 不做 production process manager。
- 不开放真实 shell runner 或 OS-level sandbox。
- 不把 MCP execution 迁到 worker。
- 不做 raw stdout/stderr streaming。

### Stage 25：Run Recovery UI v0

**状态：** Stage 23-24 后推荐。

**为什么现在做：** Stage 18 已有 lifecycle view、diagnostic summary 和 recovery action contract，但 Web 侧还没有把这些动作变成用户可见、可执行的恢复流程。Postgres-backed state 可选后，retry/resume 的价值会更明显。

**建议范围：**

- 在 Web task timeline / run panel 展示 `RunLifecycleView` 状态、安全诊断和推荐 recovery action。
- 实现第一批安全 server action：`resume_worker_finalization`、可控 retry failed run、approval/blocker 指引。
- 对 completed repaired run、failed parse/retry exhausted run、missing worker finalization、cancelled run 和 blocked handoff 增加 UI/API regression coverage。
- 保持 diagnostic summary 脱敏，不展示 raw model output、raw tool output、secret、完整 artifact 内容或本机路径。

**非目标：**

- 不做通用 DAG scheduler。
- 不自动重跑整条 agent chain。
- 不做 streaming UI。
- 不实现团队审批队列。

### Stage 26：MCP Worker Execution v0

**状态：** Stage 24-25 后推荐。

**为什么现在做：** Stage 20 的 read-only MCP execution 已有 API 校验和安全 observation，但执行仍在 API 进程内通过 deterministic local executor 完成。worker queue durable backend 和 recovery UI 稳定后，可以把 MCP 执行迁到 worker 边界，保留审批和审计语义。

**建议范围：**

- 将 read-only MCP execution 支持入队为 safe persisted worker payload，由 worker claim 后执行 deterministic local executor。
- worker finalizer 回写 `ToolObservationRecord` 和 run events，并复用 Stage 18/19 的幂等 finalization、heartbeat 和 stale recovery 语义。
- 映射 MCP cancellation、timeout、execution failure 到 bounded / redacted observation summary。
- Web MCP 执行入口保持同一授权语义，只在配置开启时走 worker-backed path。

**非目标：**

- 不接真实 MCP SDK 或 remote MCP server adapter。
- 不开放 write tools、filesystem、shell 或 deployment side effects。
- 不保存 raw arguments、raw output、secret、完整 artifact 内容或本机绝对路径。
- 不做 streaming MCP output。

## Backlog 分组

### Agent Runtime / Run Lifecycle

- Web-facing retry/recovery UI wired to recovery action contract。
- Executable retry/resume flows for failed 或 blocked runs。
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
- Handoff/retry/recovery UI。
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

## 决策记录

- Web UI no-refresh 很重要，但当前暂缓到专门的 Web UI 阶段。
- Stage 23 优先做 Web opt-in Postgres backend wiring；Stage 22 只提供 repository foundation，不默认切换 runtime backend。
- Worker job Postgres backend 应单独跟进，避免同时迁移 workbench state 和 queue semantics。
- MCP worker execution 应等待 durable worker backend 和 recovery UI 更稳定后再做。
- 真实 shell execution 和 strong sandboxing 必须始终位于 explicit policy、approval 和 worker boundaries 后面。
- Deployment 应与 LP generation 分开；在内置 deployment product flow 之前，skills 可以先提供 deployment commands。
- 即使 workbench 持续演进，生成的 LP artifacts 也必须保持框架无关静态 HTML/CSS/JS。
