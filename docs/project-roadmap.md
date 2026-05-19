# 项目路线图

最后更新：2026-05-19

这份文档是 LP Engineering Team Agent 后续阶段任务规划的默认入口。后续询问“下一阶段做什么”时，先读本文件，再按需要读取 `docs/agent-development-learning.md`、`docs/superpowers/README.md` 和具体 stage spec/plan。

它不是单个阶段的 spec，也不是某次实现 plan。它用于维护近期优先级、底层基座缺口、Web/UI 后置项和长期 backlog，避免每次都从全部历史文档重新分析。

## 当前状态快照

当前已经成型或基本成型的底层能力：

- Web workbench：类 Manus 布局、conversation-first entry、普通任务和 LP 生成任务。
- Static LP artifact：生成产物保持 `index.html`、`styles.css`、`script.js`，并支持 single HTML preview/export。
- Model gateway：provider-neutral 配置、`anthropic-messages` adapter、`openai-completions` adapter、真实 runtime 显式 opt-in。
- Structured model output：Planner `LPBriefSchema` parse、Builder static artifacts parse 和 artifact policy validation。
- Context Pack v0：注入 task/project input、skills、visible MCP tools、model route、approval、artifact workspace、context memory、handoff summary。
- Skills：manifest、version、validation、publish、project binding、runtime context injection、受控 deployment skill command 边界。
- MCP registry：connector、tool approval、role/permission visible tools；MCP execution 尚未实现。
- Run orchestration：deterministic Planner/Builder/Reviewer/Deployer run records、ordered run events、tool observations。
- Agent run lifecycle / recovery v0：从 run events、worker jobs、tool observations 和 handoffs 派生 lifecycle view、diagnostic summary 和 recovery action contract，并强化 worker finalization 幂等性。
- Agent handoff v0：固定 LP 链路 `Planner -> Builder -> Reviewer -> Deployer` 的结构化 handoff state。
- Worker runtime / queue：job contract、sandbox policy、JSON-file persistence、cancel/interrupt、claim-token queue handoff、`apps/agent-worker` run-once、安全 simulated payload。
- Artifact workspace：durable artifact workspace、manifest/hash/summary、controlled artifact reader、metadata-only static diff、bounded snippet。
- Collaboration primitives：local identity seam、workspace/project member repositories、project owner membership、approval actor audit context。
- Web V1 readiness：root README、manual acceptance checklist、`pnpm smoke` deterministic smoke test。

当前仍明确后置：

- Web UI 无刷新体验、streaming UI、browser E2E。
- MCP execution。
- Worker daemon、heartbeat、stale claim recovery、streaming logs。
- 真实 shell runner、强 sandbox、OS-level isolation。
- 真实部署编排。
- Postgres repository 实现和真实多用户 auth/RBAC。
- Desktop packaging 和 desktop filesystem workspace。

## 已完成阶段记录

### Stage 18：Agent Run Lifecycle & Recovery v0

**状态：** 已实现。

Stage 18 已完成 Agent run lifecycle / recovery v0：API 侧从 run events、worker jobs、tool observations 和 handoffs 派生 `RunLifecycleView`、安全 `diagnosticSummary` 和 recovery action contract，并强化 worker finalization 幂等性。

## 推荐下一阶段队列

### Stage 19：Worker Daemon、Heartbeat 和 Streaming Logs v0

**状态：** 设计已确认，待 implementation plan 和实现。

**为什么在 Stage 18 之后：** daemon execution 需要更强的 run lifecycle 和 finalizer 语义，否则 stale claims、重复 finalization、cancellation 和可见 run state 会很难推理。

**当前设计：** `docs/superpowers/specs/2026-05-19-worker-daemon-heartbeat-logs-design.md`。

**建议范围：**

- 增加 worker heartbeat metadata 和 stale-claim detection。
- 为 `apps/agent-worker` 增加 daemon 或 polling loop mode。
- 增加 bounded worker lifecycle log/event summary，并通过 Web Skills local worker queue 面板只读展示 queue counts、heartbeat、stale summary 和 recent logs。
- daemon 配置 workbench repository 时复用幂等 worker finalizer，把 terminal worker job 回写到 run/tool events。
- 默认 execution adapter 仍保持 simulated/reject。

**非目标：**

- 不做真实 shell execution。
- 不做 MCP execution。
- 不做 deployment runner。
- 不做生产级 process manager。
- 不做 Web 启停长期 daemon。

### Stage 20：MCP Execution v0

**状态：** 推荐在 worker lifecycle 更强之后做。

**为什么在 Stage 19 之后：** MCP execution 应复用 worker job、approval、observation、artifact reader、cancellation 和 finalizer 边界，不应该在 API 进程里直接调用工具。

**建议范围：**

- 通过 worker/tool observation 边界执行 allowlisted MCP tools。
- 要求 project-scoped connector、tool approval、role/permission visibility，并对写工具要求显式用户 approval。
- 保存 bounded/redacted metadata 形式的 tool observations。
- raw MCP output 不直接进入 chat messages 或 model context，除非经过显式 summarization。

**非目标：**

- 不允许浏览器任意安装 MCP server。
- 不开放不安全的 filesystem access。
- 不把 raw output 注入 model context。

### Stage 21：Model Repair、Retry 和 Fallback v0

**状态：** 推荐在 run lifecycle 能清晰表达 retry/failure 后做。

**为什么在 Stage 18 之后：** Planner/Builder parse 当前 fail closed，这是正确的。下一步模型能力应增加受控 repair/retry，同时不能让 failed runs 不可见，也不能静默 fallback 到 deterministic output。

**建议范围：**

- 为无效 Planner/Builder structured JSON 增加 one-shot repair loop。
- 增加 provider error classification 和 bounded retry policy。
- 增加 fallback route metadata，但不静默隐藏原始失败。
- 记录 sanitized parse/retry/fallback events。

**非目标：**

- 不做 streaming model output。
- 不做 tool-call conversion。
- 不做自动 provider marketplace。

### Stage 22：Postgres Repository v0

**状态：** 推荐在严肃多人/公司内部使用前做。

**为什么稍后做：** JSON-file repositories 足以支撑本地 MVP 和 desktop-friendly development。只有当项目共享、auth、durable background workers、audit 或公司内部使用更重要时，Postgres 才成为优先基础设施。

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

- invalid structured output 的 repair retry。
- Provider fallback 和 cost/timeout policy。
- Usage/cost reporting。
- Streaming support。
- Tool-call protocol conversion。
- Additional provider manifests。

### Worker / Sandbox / Execution

- Stage 19 已规划 worker daemon、heartbeat、stale claim recovery 和 bounded worker lifecycle logs，待实现。
- Streaming stdout/stderr summaries。
- Strong sandbox adapter。
- 受 explicit policy 和 approval 保护的真实 shell runner。
- Desktop-local execution adapter。

### MCP

- 通过 worker/tool observation boundary 实现 MCP execution v0。
- 写工具前先实现 read-only tool execution。
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
