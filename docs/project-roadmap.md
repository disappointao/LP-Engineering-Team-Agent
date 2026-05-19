# 项目路线图

最后更新：2026-05-19

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
- Web V1 readiness：root README、manual acceptance checklist、`pnpm smoke` deterministic smoke test。

当前仍明确后置：

- Web UI 无刷新体验、streaming UI、browser E2E。
- 真实 fallback provider execution、模型 usage/cost reporting、streaming model output 和 tool-call protocol conversion。
- 真实 MCP SDK / remote MCP server adapter、write tools 和 MCP worker execution。
- Streaming stdout/stderr summaries。
- 真实 shell runner、强 sandbox、OS-level isolation。
- 真实部署编排。
- Postgres repository 实现和真实多用户 auth/RBAC。
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

## 推荐下一阶段队列

### Stage 22：Postgres Repository v0

**状态：** 推荐下一阶段优先做。

**为什么现在做：** Stage 18-21 已经把 run lifecycle、worker queue、MCP execution 和真实模型可靠性做到本地 MVP 可审计状态。下一步如果要支持严肃多人/公司内部使用，Postgres repository 是项目共享、auth、durable background workers 和 audit 的基础。

**建议范围：**

- 先实现最高风险状态的 Prisma-backed repositories：projects、tasks、messages、runs、run events、tool observations、worker links、artifact workspace metadata。
- 保留 in-memory 和 JSON-file repositories，用于 deterministic tests。
- 增加 migration 和 validation docs。

**非目标：**

- 不在同一阶段做完整 hosted auth。
- 不做 object storage migration。
- 不做 production deployment architecture。

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
- MCP execution 应等待 run lifecycle 和 worker daemon 语义更强后再做。
- 真实 shell execution 和 strong sandboxing 必须始终位于 explicit policy、approval 和 worker boundaries 后面。
- Deployment 应与 LP generation 分开；在内置 deployment product flow 之前，skills 可以先提供 deployment commands。
- 即使 workbench 持续演进，生成的 LP artifacts 也必须保持框架无关静态 HTML/CSS/JS。
