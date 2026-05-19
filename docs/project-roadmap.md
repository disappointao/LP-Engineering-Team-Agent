# Project Roadmap

Last updated: 2026-05-19

这份文档是 LP Engineering Team Agent 后续阶段任务规划的默认入口。后续询问“下一阶段做什么”时，先读本文件，再按需要读取 `docs/agent-development-learning.md`、`docs/superpowers/README.md` 和具体 stage spec/plan。

它不是单个阶段的 spec，也不是某次实现 plan。它用于维护近期优先级、底层基座缺口、Web/UI 后置项和长期 backlog，避免每次都从全部历史文档重新分析。

## Current Snapshot

当前已经成型或基本成型的底层能力：

- Web workbench：Manus-like layout、conversation-first entry、普通任务和 LP 生成任务。
- Static LP artifact：生成产物保持 `index.html`、`styles.css`、`script.js`，并支持 single HTML preview/export。
- Model gateway：provider-neutral 配置、`anthropic-messages` adapter、`openai-completions` adapter、真实 runtime 显式 opt-in。
- Structured model output：Planner `LPBriefSchema` parse、Builder static artifacts parse 和 artifact policy validation。
- Context Pack v0：注入 task/project input、skills、visible MCP tools、model route、approval、artifact workspace、context memory、handoff summary。
- Skills：manifest、version、validation、publish、project binding、runtime context injection、受控 deployment skill command 边界。
- MCP registry：connector、tool approval、role/permission visible tools；MCP execution 尚未实现。
- Run orchestration：deterministic Planner/Builder/Reviewer/Deployer run records、ordered run events、tool observations。
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

## Recommended Next Queue

### Stage 18: Agent Run Lifecycle & Recovery v0

**Status:** Recommended next.

**Why now:** run records、run events、handoffs、worker jobs、tool observations 都已有 v0，但缺一个更正式的 lifecycle/recovery 层。这个阶段会把真正 Agent 系统需要的失败诊断、恢复、retry/resume、blocked state 和幂等 finalizer 打牢。

**Suggested scope:**

- Define canonical run lifecycle states such as `queued`, `running`, `waiting_for_approval`, `blocked`, `cancelling`, `cancelled`, `failed`, and `completed`.
- Add helpers to derive current task/run status from persisted run events and linked worker/tool state.
- Add minimal retry/resume contracts for failed or blocked runs without implementing a full DAG scheduler.
- Add failure diagnostic summary records or event metadata that can be reused by UI and future model context.
- Harden worker finalization idempotency and repeated-finalize behavior.
- Document how task, run, handoff, worker job, and tool observation relate.

**Non-goals:**

- No Web UI overhaul.
- No streaming UI.
- No MCP execution.
- No real shell execution.
- No worker daemon.
- No general agent swarm or arbitrary DAG scheduler.

**Likely files:**

- `packages/api/src/run-orchestrator.ts`
- `packages/api/src/task-interrupts.ts`
- `packages/api/src/skill-command-worker-queue.ts`
- `packages/db/src/workbench-repositories.ts`
- `packages/db/src/json-file-workbench-repositories.ts`
- `packages/runtime-adapters/src/index.ts`
- `docs/agent-development-learning.md`
- new Superpowers spec/plan under `docs/superpowers/`

### Stage 19: Worker Daemon, Heartbeat, and Streaming Logs v0

**Status:** Recommended after Stage 18.

**Why after Stage 18:** daemon execution needs stronger run lifecycle and finalizer semantics first. Otherwise stale claims, repeated finalization, cancellation, and visible run state become hard to reason about.

**Suggested scope:**

- Add worker heartbeat metadata and stale-claim detection.
- Add a daemon or polling loop mode for `apps/agent-worker`.
- Add bounded streaming log/event records from worker execution into run events or worker observations.
- Keep execution adapter simulated/reject by default.

**Non-goals:**

- No real shell execution.
- No MCP execution.
- No deployment runner.
- No production process manager.

### Stage 20: MCP Execution v0

**Status:** Recommended after worker lifecycle is stronger.

**Why after Stage 19:** MCP execution should reuse worker job, approval, observation, artifact reader, cancellation, and finalizer boundaries. It should not be a direct API-process tool call.

**Suggested scope:**

- Execute allowlisted MCP tools through the worker/tool observation boundary.
- Require project-scoped connector, tool approval, role/permission visibility, and explicit user approval for write tools.
- Store tool observations with bounded/redacted metadata.
- Keep raw MCP output out of chat messages and model context unless explicitly summarized.

**Non-goals:**

- No arbitrary MCP server installation from the browser.
- No unsafe filesystem access.
- No raw output injection into model context.

### Stage 21: Model Repair, Retry, and Fallback v0

**Status:** Recommended after run lifecycle can represent retry/failure cleanly.

**Why after Stage 18:** Planner/Builder parse currently fail closed, which is correct. The next model step should add controlled repair/retry without making failed runs invisible or silently falling back to deterministic output.

**Suggested scope:**

- Add one-shot repair loop for invalid Planner/Builder structured JSON.
- Add provider error classification and bounded retry policy.
- Add fallback route metadata without silently hiding the original failure.
- Record sanitized parse/retry/fallback events.

**Non-goals:**

- No streaming model output.
- No tool-call conversion.
- No automatic provider marketplace.

### Stage 22: Postgres Repository v0

**Status:** Recommended before serious multi-user/company usage.

**Why later:** JSON-file repositories are sufficient for local MVP and desktop-friendly development. Postgres matters once project sharing, auth, durable background workers, audit, or company usage become more important.

**Suggested scope:**

- Implement Prisma-backed repositories for the highest-risk state first: projects, tasks, messages, runs, run events, tool observations, worker links, artifact workspace metadata.
- Keep in-memory and JSON-file repositories for deterministic tests.
- Add migration and validation docs.

**Non-goals:**

- No full hosted auth in the same stage.
- No object storage migration.
- No production deployment architecture.

## Backlog By Area

### Agent Runtime / Run Lifecycle

- Run lifecycle state derivation.
- Retry/resume for failed or blocked runs.
- Blocking question records.
- Failure diagnostics and user-visible recovery hints.
- General dependency graph after fixed LP chain stabilizes.

### Context / Memory / Retrieval

- Persistent summary repository.
- Hybrid retrieval beyond deterministic same-project selection.
- Source-level selected snippets with stronger budgets.
- Context diff and injection audit.
- Long-term project preferences and user preferences.

### Model Gateway

- Repair retry for invalid structured output.
- Provider fallback and cost/timeout policy.
- Usage/cost reporting.
- Streaming support.
- Tool-call protocol conversion.
- Additional provider manifests.

### Worker / Sandbox / Execution

- Worker daemon and heartbeat.
- Stale lease recovery.
- Streaming stdout/stderr summaries.
- Strong sandbox adapter.
- Real shell runner behind explicit policy and approval.
- Desktop-local execution adapter.

### MCP

- MCP execution v0 through worker/tool observation boundary.
- Read-only tool execution before write tools.
- Connector health checks.
- Tool result summarization and redaction.
- MCP cancellation and timeout mapping.

### Artifact Workspace

- Line-level textual diff.
- File edit proposal model.
- Artifact patch/apply workflow.
- Desktop filesystem workspace mapping.
- Binary asset and object storage support.

### Collaboration / Auth

- Real user identity provider.
- Invite flow.
- Role-based access control.
- Team approval queue.
- Audit dashboard.
- Real-time collaboration later.

### Deployment

- Real deployment runner adapter.
- Git provider integration.
- Deployment approval workflow.
- Deployment status polling.
- Rollback and environment records.

### Web UI

- No-refresh workbench interaction.
- Streaming run timeline.
- Browser E2E acceptance.
- Dedicated artifact workspace page.
- Handoff/retry/recovery UI.
- Skills/Models/MCP client-side management after core flow stabilizes.

### Desktop

- Desktop wrapper.
- Desktop-local profile.
- Local filesystem workspace adapter.
- Local runtime policy UI.
- Offline mode constraints.

## Reading Order For Future Agents

When choosing or executing the next stage, read in this order:

1. `docs/project-roadmap.md` for current priority and backlog.
2. `docs/agent-development-learning.md` for Agent concepts, already implemented pieces, and learning notes.
3. `docs/superpowers/README.md` for chronological specs/plans and exact reading order.
4. The specific stage spec/plan for the task being executed.
5. Local code and tests for the packages being touched.

Do not infer the next stage only from the latest git commit. Use this roadmap as the first planning input.

## Maintenance Rules

Update this document when any of the following happens:

- A stage is completed.
- A new Superpowers spec or plan changes the recommended next queue.
- The user changes priority, such as postponing Web UI work or moving MCP execution earlier.
- A backlog item becomes implemented, obsolete, or split into smaller stages.
- A new foundation area is introduced, such as a new runtime, storage layer, or execution boundary.
- A future agent notices that the queue no longer matches the current code or docs.

Update pattern:

- Move completed recommended stages into the Current Snapshot or relevant completed notes.
- Keep the Recommended Next Queue to roughly 3-5 near-term stages.
- Keep Non-goals explicit for every near-term stage.
- Prefer smaller staged slices over one large multi-system stage.
- If this roadmap changes because of a Superpowers spec/plan, also keep `docs/superpowers/README.md` accurate.
- If the change is learning-relevant for Agent development, also update `docs/agent-development-learning.md`.

## Decision Notes

- Web UI no-refresh work is important but currently parked until a dedicated Web UI phase.
- MCP execution should wait until run lifecycle and worker daemon semantics are stronger.
- Real shell execution and strong sandboxing should remain behind explicit policy, approval, and worker boundaries.
- Deployment should remain separate from LP generation; skills may provide deployment commands before a built-in deployment product flow exists.
- Generated LP artifacts must remain framework-free static HTML/CSS/JS even as the workbench itself evolves.
