# Stage 49：Post-V1 Backlog Prioritization v0 设计

**状态：** 已实现，当前已完成。
**日期：** 2026-05-25
**阶段：** Stage 49 - Post-V1 Backlog Prioritization v0

## 背景

Stage 46 已完成 V1 polished alpha completion gate，Stage 47 已完成 local operator trial feedback batch，当前 `docs/v1-polished-alpha-completion.md` 的 RC decision 是 `go_for_internal_rc`，且没有记录 open blockers。此时继续扩大功能范围会把 post-V1 product、platform、deployment、auth、MCP 和 browser platform backlog 混在一起。

Stage 49 的职责是把已经接受的 follow-ups、known limitations 和 roadmap backlog 转成一个可执行的近期排序，而不是直接实现某个大功能。

## 目标

- 创建 `docs/post-v1-backlog-prioritization.md`，作为 Post-V1 backlog 的当前排序和路由记录。
- 汇总 `docs/v1-polished-alpha-completion.md`、`docs/v1-polished-alpha-operator-trial.md`、`docs/alpha-feedback-log.md` 和 `docs/project-roadmap.md` 中的 post-V1 证据。
- 用明确的评分模型把候选 backlog 归类并排序，避免仅凭最新 commit history 推断优先级。
- 选出一个默认 Stage 51 product/platform slice，并保持 Stage 48 作为 blocker 条件触发路径、Stage 50 作为 browser platform 可选规划路径。
- 同步 `docs/project-roadmap.md`、`docs/superpowers/README.md` 和必要的 completion / feedback 文档，使后续 agent 能从 roadmap 直接判断下一步。

## 非目标

- 不实现 runtime、Web UI、MCP、provider、worker、deployment、auth 或 storage 功能。
- 不一次性把多个 backlog 方向合并成一个实现阶段。
- 不改变 V1 polished alpha 的 deterministic/no-key 默认 gate。
- 不把 real provider smoke、remote browser farm、真实 MCP server、真实 shell runner 或 production Postgres rollout 变成默认要求。
- 不把 Stage 48 blocker fix batch 作为常规 backlog feature 阶段使用。

## 输入文档

- `docs/v1-polished-alpha-completion.md`：V1 polished alpha completion ledger、known limitations、accepted follow-ups 和 RC decision。
- `docs/v1-polished-alpha-operator-trial.md`：Stage 47 local operator trial evidence。
- `docs/alpha-feedback-log.md`：feedback batch、blocker status 和 accepted follow-up 路由。
- `docs/project-roadmap.md`：当前能力快照、推荐下一阶段队列和 backlog 分组。
- `docs/superpowers/README.md`：Superpowers spec / plan 阅读顺序。

## 评分模型

每个候选 backlog 用 0-3 分评分，越高越适合作为近期阶段。Stage 49 不要求数学精确，但要求结论能被后续 agent 复核。

| 维度 | 说明 |
| --- | --- |
| 用户价值 | 是否直接提高 post-V1 内部用户能看见或能操作的能力。 |
| 风险降低 | 是否降低 release、运行时、配置、安全或验收风险。 |
| 依赖解锁 | 是否为后续多个 backlog 提供基础边界。 |
| 实施尺寸 | 是否能被拆成一个窄范围 spec / plan，分数越高代表越小且可控。 |
| 验证清晰度 | 是否能用 deterministic tests、docs evidence 或 browser acceptance 明确验证。 |

排序规则：

- 只把单一、可切分的 product/platform slice 推为默认 Stage 51。
- 有 blocker 证据时，Stage 48 优先于任何 backlog feature。
- Browser platform / visual baseline 保持 Stage 50 可选规划路径，不抢占默认 Stage 51。
- 高价值但依赖真实外部环境、生产凭证或大规模 infrastructure 的候选继续后置，除非 Stage 49 发现更强证据。

## 候选 backlog 分组

Stage 49 至少覆盖以下候选，并允许合并明显重复项：

| 候选 | 归类 | 初始判断 |
| --- | --- | --- |
| MCP Management Surface v0 | Product / MCP | V1 已隐藏 MCP management，但底层 registry、approval、visible tools 和 read-only execution 边界已经存在。适合恢复一个安全、只读优先的管理 surface 作为 Stage 51 默认候选。 |
| Browser Platform / Visual Baseline Planning v0 | Browser Platform | Stage 45 已有轻量 visual contract，适合规划但不应在 Stage 49 直接实现，也不应替代默认 product slice。 |
| Real Deployment Runner Discovery v0 | Deployment | 用户价值高，但真实部署 runner、凭证、安全边界和失败处理较重，应先作为后续 discovery / spec 候选。 |
| Model Gateway Cost / Fallback Execution v0 | Model Gateway | 有 post-V1 价值，但真实 fallback execution、quota、billing 和 provider cost ledger 容易扩大范围，应拆分后置。 |
| Auth / RBAC / Production Storage Foundation v0 | Collaboration / Storage | 生产化必要但范围大，且会牵动 Postgres、artifact storage、member roles 和 approval queue，暂不作为默认 Stage 51。 |
| Worker / Sandbox Real Execution v0 | Worker / Sandbox | 真实 shell runner 和强 sandbox 风险高，应继续后置到明确安全 spec。 |
| Context / Memory Retrieval Expansion v0 | Context | 有中长期价值，但 V1 当前没有 blocker 证据；可后置到更明确的 product pull。 |
| Desktop Packaging v0 | Desktop | 适合长期 backlog，不作为近期默认。 |

## 默认推荐方向

若 Stage 49 的证据复核没有发现新的 blocker 或更高优先级约束，默认把 Stage 51 设为 **MCP Management Surface v0 Spec Kickoff**。

推荐原因：

- MCP management 是 V1 completion note 明确后置的可见 product surface。
- 底层 MCP registry、approval、role/permission visibility、read-only execution 和 safe observation 已经存在，恢复管理 surface 的风险比真实 deployment、auth/RBAC、shell runner 更低。
- 它能解锁后续 tool ecosystem 讨论，同时可以保持非目标清晰：不做 remote MCP SDK、write tools、MCP worker execution、真实外部 MCP server 和生产权限系统。
- 可验证性清晰：docs evidence、Web route safety、repository fixtures、non-leakage tests 和 deterministic browser acceptance 均可覆盖。

## 交付物

- 新增 `docs/post-v1-backlog-prioritization.md`，包含 evidence sources、评分表、推荐排序、默认 Stage 51 和 rejected / deferred routes。
- 更新 `docs/project-roadmap.md`：
  - Stage 49 状态、设计/计划/完成记录。
  - 当前状态快照。
  - 推荐下一阶段队列保持 3-5 个近期阶段。
  - 决策记录新增 Stage 49 prioritization 结论。
- 更新 `docs/superpowers/README.md`，加入本 design 和后续 implementation plan。
- 视执行结果更新 `docs/v1-polished-alpha-completion.md` 的 accepted follow-ups / next routing，使其不再停留在 Stage 49 之前。

## 验证

Stage 49 是 docs-only 阶段，验证重点是文档一致性和默认 gate 无回归：

- `rg -n "Stage 49|Stage 51|Post-V1|MCP Management" docs/project-roadmap.md docs/post-v1-backlog-prioritization.md docs/v1-polished-alpha-completion.md`
- `rg -n "post-v1-backlog-prioritization" docs/superpowers/README.md`
- `git diff --check`
- `pnpm alpha:check`
- `pnpm smoke`

如果执行阶段只修改文档且没有 runtime / Web / test 代码变化，可以不把 `pnpm alpha:e2e` 作为必要 gate；若 roadmap 或 completion docs 继续引用 V1 browser acceptance 状态，应保留最近一次通过记录并说明本阶段未改变 runtime。

## 风险与约束

- 最大风险是把排序文档写成新功能计划，导致 Stage 51 范围过大。Stage 49 必须只选择一个默认近期 slice。
- 第二个风险是 roadmap 和 completion note 互相矛盾。Stage 49 closeout 必须让二者都指向同一个默认下一步。
- 第三个风险是把 MCP management 恢复理解成完整 MCP platform。Stage 49 只能推荐 `MCP Management Surface v0 Spec Kickoff`，实现范围要留给 Stage 51 spec / plan 继续收窄。
