# Stage 46：V1 Polished Alpha Completion Gate v0 设计

**状态：** 已批准，待实施。

**日期：** 2026-05-24

## 背景

Stage 40-45 已完成 V1 polished alpha 的 feedback intake、Web surface pruning、dedicated artifact workspace、run timeline / recovery polish、Skills / Models client-side management，以及 browser failure / visual regression expansion。

Stage 46 是第一版 Web 收口阶段。它不继续扩大产品功能，也不把 blocker 修复混入 completion gate；它只把当前代码和文档放到同一张 go/no-go 表里，运行完整 deterministic gate，汇总人工验收状态、可选真实 provider smoke 状态、known limitations、open blockers 和后续 backlog routing。

## 目标

- 用一个明确的 completion note 汇总 V1 polished alpha 当前候选状态。
- 运行并记录完整 deterministic gates：`pnpm alpha:check`、`pnpm smoke`、`pnpm alpha:e2e`、`pnpm test`、`pnpm typecheck`、`pnpm build` 和 `git diff --check`。
- 对人工 acceptance 和可选真实 provider smoke 使用证据化状态：`passed`、`not_run`、`blocked` 或 `not_applicable`，不得在没有 operator evidence 时标记为通过。
- 更新 RC decision record、known limitations、README、manual acceptance docs、roadmap 和 Superpowers index。
- 汇总 open blockers、accepted follow-ups、rejected / out-of-scope items 和推荐下一阶段队列。

## 非目标

- 不新增 Web UI、runtime、repository、provider、MCP、artifact 或 worker 能力。
- 不修复 completion gate 期间发现的 blocker；发现 blocker 时记录为 `no-go` 并路由到明确修复批次。
- 不把真实 provider、真实 MCP、Postgres、真实部署、网络服务或真实 API key 变成默认 gate。
- 不运行或记录任何包含 secret、raw provider response、raw SSE frame、完整 artifact 内容、本机绝对路径、raw worker payload/output、raw tool payload/output 或 raw stdout/stderr 的 unsafe evidence。
- 不把可选真实 provider smoke 伪装成默认 deterministic gate。

## Gate 状态模型

Stage 46 completion note 使用以下状态：

- `go_for_internal_rc`：完整 deterministic gates 通过；文档边界一致；没有 open blocker；人工 acceptance / 真实 provider smoke 若未运行，必须明确标记为 `not_run` 或 `not_applicable`。
- `no_go_blocked`：任一默认 deterministic gate 失败，或发现主路径不可用、安全泄漏、默认环境需要真实 key、文档与代码事实冲突。
- `needs_operator_trial`：自动 gate 通过，但缺少独立人工试用证据；可作为内部 operator trial 候选，不等同于 public release。

如果同时满足 `go_for_internal_rc` 和缺少独立人工试用证据，completion note 应写成“可进入内部 RC operator trial”，而不是“已由真实用户验收通过”。

## Completion Note

新增 `docs/v1-polished-alpha-completion.md` 作为 Stage 46 的主要输出。它包含：

- Commit、日期、operator 和 runtime mode。
- Automated deterministic gate 表格：
  - `pnpm alpha:check`
  - `pnpm smoke`
  - `pnpm alpha:e2e`
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm build`
  - `git diff --check`
- Manual acceptance 状态表，引用 `docs/web-v1-acceptance.md` 的主路径项。
- Optional real provider smoke 状态，引用 `docs/real-provider-alpha-smoke.md`，默认允许 `not_run`。
- Known limitations 确认。
- Open blockers。
- Accepted follow-ups。
- Rejected / out-of-scope items。
- RC decision：`go_for_internal_rc`、`needs_operator_trial` 或 `no_go_blocked`。
- Next routing decision。

## 文档更新

Stage 46 更新以下文档：

- `README.md`：把当前范围从单纯 Skill-only local alpha 描述收敛到 V1 polished alpha RC candidate，并链接 completion note。
- `docs/alpha-release-candidate.md`：把 Stage 46 completion note 作为 RC decision record 的当前入口，并把 full deterministic gate 列全。
- `docs/web-v1-acceptance.md`：说明 Stage 46 completion note 记录本轮 gate / acceptance 结果，详细人工清单仍在本文件。
- `docs/project-roadmap.md`：把 Stage 46 的设计 / 计划 / 完成状态和推荐下一阶段队列同步。
- `docs/superpowers/README.md`：加入 Stage 46 spec / plan 的阅读顺序。

如果 implementation plan 新增或修改 `docs/superpowers/plans/`，必须同一变更更新 `docs/superpowers/README.md`。

## 验证策略

Stage 46 默认验证命令：

```bash
pnpm alpha:check
pnpm smoke
pnpm alpha:e2e
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

验证记录只保存命令名、通过/失败、测试数量或简短输出摘要。失败时记录失败命令、失败类别和 suggested routing；不复制超长日志或 unsafe evidence。

## 后续路由

Stage 46 结束后，推荐下一阶段队列不得为空。默认队列：

- Stage 47：Internal RC Trial Feedback Batch v0，基于 `docs/alpha-release-candidate.md` 和 `docs/alpha-feedback-intake.md` 做第一轮内部 operator trial 反馈批次。
- Stage 48：RC Blocker Fix Batch v0，仅在 Stage 46 或 Stage 47 发现 blocker 时处理，不与 completion gate 混合。
- Stage 49：Post-V1 Backlog Prioritization v0，在没有 blocker 时从 MCP management、真实部署、auth/RBAC、object storage、cross-browser / visual baseline 等 backlog 中选择下一个小阶段。

这些后续阶段必须继续保持 safe evidence 和 deterministic default gate 纪律。
