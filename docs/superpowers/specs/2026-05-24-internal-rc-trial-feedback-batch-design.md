# Stage 47：Internal RC Trial Feedback Batch v0 设计

**状态：** 已批准，待实施。

**日期：** 2026-05-24

## 背景

Stage 46 已完成 V1 polished alpha completion gate：完整 deterministic gates 通过，`docs/v1-polished-alpha-completion.md` 的 RC decision 是 `needs_operator_trial`，manual acceptance 和 real provider opt-in smoke 仍如实记录为 `not_run`。

Stage 47 的目标不是继续扩大产品范围，而是执行第一轮内部 RC operator trial，使用现有 RC script 和 feedback intake 规则收集安全证据，把结果写回 completion note、feedback log 和 roadmap。

## Operator 模式

默认 Stage 47 使用 deterministic / no-key / local-first trial：

- `REAL_MODEL_RUNTIME=0`
- `REAL_MODEL_PROVIDER_TEST=0`
- 不依赖真实 provider、MCP、Postgres、真实部署或网络服务

当用户明确委托 agent 自动继续时，Codex 可以作为 `Codex local operator` 执行本地 trial。记录时必须明确该 trial 是 agent-operated local trial，不得冒充外部真人用户研究或独立人工访谈。

如果后续有人类 operator 单独执行 trial，可追加新的 batch，不覆盖本轮 agent-operated 记录。

## 目标

- 按 `docs/alpha-release-candidate.md` 的 trial script 执行本地 deterministic operator trial。
- 用 `docs/web-v1-acceptance.md` 的区域划分记录 manual acceptance evidence。
- 在 `docs/v1-polished-alpha-completion.md` 中更新 Stage 47 trial evidence、manual acceptance status、open blockers 和 RC decision。
- 在 `docs/alpha-feedback-log.md` 中新增一个 Stage 47 feedback batch，记录 blockers、accepted follow-ups、rejected / out-of-scope items 和下一路由。
- 同步 `docs/project-roadmap.md` 和 `docs/superpowers/README.md`，确保下一阶段队列仍包含 Stage 48、Stage 49 和后续近期阶段。

## 非目标

- 不修复 trial 期间发现的 blocker；发现 blocker 时只记录 `no_go_blocked` 并路由 Stage 48。
- 不新增 Web UI、runtime、repository、provider、MCP、artifact、worker 或 test implementation 能力。
- 不把 real provider smoke 变成必需项；除非 operator 明确提供安全本地环境并要求执行，否则保持 `not_run`。
- 不记录 secret、API key、env value、raw provider response、raw SSE frame、完整 artifact 内容、本机绝对路径、raw worker/tool payload、raw stdout/stderr 或不可脱敏日志。

## Trial Evidence

Stage 47 新增 `docs/v1-polished-alpha-operator-trial.md` 作为本轮 operator trial 的详细安全记录。该文档记录：

- Trial id、date、operator、runtime mode 和 candidate commit。
- Automated gate safe summaries。
- Manual acceptance table：ordinary chat、LP live task / run timeline、artifact workspace、Skills、Models / MCP boundary、failure display / non-leakage。
- Optional real provider smoke status。
- Feedback intake summary。
- Blockers、accepted follow-ups、rejected / out-of-scope items。
- Next routing decision。

`docs/v1-polished-alpha-completion.md` 继续作为当前 V1 polished alpha 的总 ledger，只保留 Stage 47 trial 的摘要和链接，不复制冗长证据。

## 状态规则

如果 full deterministic gates 和 local operator trial 都通过，且没有 blocker：

- `docs/v1-polished-alpha-completion.md` 的 manual acceptance rows 可以更新为 `passed`，evidence 必须指向 Stage 47 local operator trial。
- Optional real provider `Default no-key gate` 保持或更新为 `passed`。
- Optional real provider opt-in smoke 仍为 `not_run`，除非本轮明确执行。
- RC decision 更新为 `go_for_internal_rc`，含义是默认 deterministic / no-key V1 polished alpha 可以进入小范围内部 RC；它不代表 public release、生产 readiness 或真实 provider smoke 已通过。
- 下一路由为 Stage 49 Post-V1 Backlog Prioritization v0；Stage 48 仅在后续发现 blocker 时启用。

如果 trial 发现 blocker、安全泄漏或默认 gate 失败：

- Completion note decision 更新为 `no_go_blocked`。
- Feedback log 新增 blocker item，status 为 `needs_immediate_fix`。
- Roadmap 下一路由改为 Stage 48 RC Blocker Fix Batch v0。
- 本阶段不得修复 blocker。

如果 trial 无法完成但没有确认 blocker：

- Completion note decision 保持或更新为 `needs_operator_trial`。
- Trial note 记录 incomplete 原因和 safe evidence。
- Roadmap 保持 Stage 47 为当前未完成路由。

## Feedback Triage

Stage 47 使用 `docs/alpha-feedback-intake.md` 的分类和安全规则：

- `blocking_bug` + `blocker`：路由 Stage 48，暂停 RC go。
- `ux_friction`、`artifact_quality_issue`、`provider_config_issue`、`docs_gap`：若不阻塞 RC，记录为 accepted follow-up，默认进入 Stage 49 统一排序。
- `future_feature`：记录为 rejected / out-of-scope 或 backlog，不阻塞 RC。

没有新反馈时，也要在 `docs/alpha-feedback-log.md` 记录 batch，明确 `New items count: 0` 和 `Blockers: none`。

## 验证要求

Stage 47 完成前至少运行：

- `pnpm alpha:check`
- `pnpm smoke`
- `pnpm alpha:e2e`
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `git diff --check`

如只修改文档，合并后可以用 `pnpm alpha:check`、`pnpm smoke`、文档 routing `rg` 和 `git diff --check` 做快速回归；完整 gate 结果仍必须在 Stage 47 trial note 或 completion note 中保留。

## 后续路由

- Stage 48：RC Blocker Fix Batch v0，仅在 Stage 47 记录 blocker 时启用。
- Stage 49：Post-V1 Backlog Prioritization v0，默认在 Stage 47 无 blocker 后执行。
- Stage 50：Browser Platform / Visual Baseline Planning v0，继续作为可选近期规划阶段。
