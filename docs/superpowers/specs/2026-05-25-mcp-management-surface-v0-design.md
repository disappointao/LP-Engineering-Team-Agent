# MCP Management Surface v0 Design

**Stage:** 51 - MCP Management Surface v0 Spec Kickoff
**Date:** 2026-05-25
**Status:** approved for implementation planning

## 背景和当前基线

Stage 49 已完成 Post-V1 Backlog Prioritization v0，并选择 Stage 51 作为默认下一路由：先写 MCP Management Surface v0 的窄范围设计，再进入单独 implementation stage。这个 kickoff 只定义 post-V1 Web 管理面，不实现 runtime、Web、backend、worker、MCP SDK 或 tool execution code。

当前基线如下：

- Stage 20 已实现 read-only MCP execution v0：API 侧校验 project、connector、tool、role、permission、approval 和 read-only 边界，通过 deterministic local executor 写入 run events 与安全 `ToolObservationRecord`。
- Stage 41 已把 MCP tab / sidebar / top-level Web 入口从 V1 polished alpha 中隐藏；旧 `view=mcp` 会安全降级到 workbench，而不是渲染 connector、tool approval 或 execution form。
- 当前代码仍保留 store/action/backend MCP contracts，包括 connector registry、approval state、visible tools、read-only execution action 边界和 repository contract；隐藏的是 V1 Web surface，不是删除 MCP backend capability。
- Stage 44 保留 Skills / Models client-side management 作为 V1 可见管理面，同时继续把 MCP management 后置。
- Stage 49 已把 Stage 48 保持为 blocker 条件触发路径，把 Stage 50 保持为 browser platform / visual baseline 可选规划路径，并把 Stage 52 / Stage 53 分别保留为 real deployment runner 和 model gateway cost / fallback discovery candidate。

因此 Stage 51 的设计目标是把现有 MCP registry、read-only execution 和 observation 能力投影成安全产品面，而不是设计新的 MCP platform。

## Goals

- 定义 post-V1 Web MCP 管理面，不在本阶段实现它。
- 覆盖 project-scoped connector metadata、visible tools、role / permission / approval summaries 和 connector enabled state。
- 覆盖 connector health / status 的 v0 产品语义，限定为 deterministic/local configuration health，而不是真实远端探测。
- 定义 safe read-only execution affordance：用户可以看见只读检查能力，并在后续实现中通过 allowlisted metadata 提交受控请求。
- 定义 failure diagnostics：显示安全错误码、状态摘要和建议动作，不泄漏 raw MCP output、raw arguments、secret、完整 artifact、本机绝对路径或未脱敏异常。
- 定义 navigation re-entry：MCP management 在 post-V1 作为单一 Web management view 重新进入导航，但不回填为 V1 alpha scope。
- 为后续 Stage 54 MCP Management Surface v0 Implementation 提供足够清晰的产品、数据、安全和验证边界。

## Non-goals

- 不实现 runtime、Web、backend、worker、MCP SDK 或 tool execution code。
- 不接入 remote MCP SDK 或 remote MCP server adapter。
- 不新增 write tools、MCP worker execution、真实 shell runner、filesystem write、Git write、deployment runner 或 browser automation。
- 不实现 secret storage、auth/RBAC、team approval queue、production deployment、provider platform、browser platform 或 desktop platform。
- 不保存 connector secrets，不处理真实 token / credential lifecycle。
- 不把 MCP management 加回 V1 polished alpha，也不恢复 V1 alpha 的 MCP tab / sidebar / top-level Web 入口。
- 不把 raw MCP output 注入 chat messages、model context、timeline、artifact workspace 或 Web UI。
- 不把 Stage 51 与 Stage 48 blocker fix、Stage 50 browser platform、Stage 52 deployment discovery 或 Stage 53 model gateway cost / fallback discovery 合并。

## Product Surface Contract

后续实现应使用单一 Web management view，例如 post-V1 navigation 中的 `MCP` management entry。该 view 应是 project-scoped，而不是全局 marketplace 或 provider console。

v0 管理面应展示：

- connector list：connector id、display name、description、enabled / disabled state、tool count、last updated summary 和 bounded source metadata。
- connector detail：tools、roles、permissions、approval requirement、read-only eligibility 和 safe description。
- visible tools summary：按当前 project skills、role、permission 和 approval state 计算出的可见工具，不展示不可见 tool 的 raw definition 细节。
- approval summary：每个 tool 的 `requiresApproval`、approval state、approved actor metadata 的安全摘要，以及缺失 approval 的原因。
- health / status：只表达 deterministic/local configuration health，例如 `configured`、`disabled`、`invalid_definition`、`approval_required`、`no_visible_tools`、`execution_not_available`。v0 不做真实远端 ping、capability negotiation 或 server availability check。
- read-only execution affordance：只对 visible 且 read-only eligible 的 tool 展示受控入口；提交内容只允许 projectId、connectorId、toolName、role、permission、argument keys/count 或后续 spec 明确 allowlist 的 bounded metadata。
- failure diagnostics：显示 stable error code、safe summary、next action 和是否 fail-closed，不显示 raw exception、raw arguments 或 raw output。

这个管理面应复用现有 repository/API truth，不在浏览器中重新计算授权事实。Web 可以派生显示模型，但事实来源必须仍是 backend/store contracts。

## Navigation Re-entry

Stage 41 的 V1 hidden boundary 继续有效：V1 alpha 不显示 MCP tab / sidebar / top-level entry，legacy `view=mcp` 安全降级。Stage 51 只定义 post-V1 re-entry 条件。

后续 Stage 54 实现时，推荐规则是：

- 在 post-V1 management navigation 中恢复一个单一 MCP entry，不恢复旧的多入口或 first-viewport marketing chip。
- `view=mcp` 可以重新成为 management view，但必须同步 browser acceptance，避免与 Stage 41 的 V1 hidden fallback 测试语义冲突。
- 空状态应说明 MCP 是可选扩展面；普通聊天、LP task、Artifacts、Skills 和 Models 不依赖配置 MCP 才能工作。
- 当项目缺失、connector record malformed 或 backend MCP contracts fail closed 时，导航可以存在，但 view 必须显示安全失败状态而不是半渲染表单。

## Safety and Evidence Rules

允许展示或提交的 bounded metadata：

- connectorId、connector display name、description、enabled state、tool count、updatedAt summary。
- toolName、safe tool description、role、permission、requiresApproval、approval state、read-only eligibility。
- visible / hidden reason 的 safe enum，例如 `permission_missing`、`approval_required`、`connector_disabled`、`not_read_only`。
- execution request 的 allowlisted metadata，例如 connectorId、toolName、role、permission、argumentKeys、argumentCount 和 deterministic timeout summary。
- `ToolObservationRecord` 的安全摘要字段，例如 state、outputSummary、metadata allowlist、durationMs、errorName 和 stable error code。

禁止展示、提交或持久化到 Web 管理面的内容：

- raw MCP output。
- raw arguments 或完整 argument JSON。
- connector secret、API key、token、cookie、credential 或 secret-looking value。
- full artifact content、raw artifact diff、artifact file body。
- local absolute path、desktop filesystem path、workspace-private path。
- unredacted exception、stack trace、provider raw response、server raw stderr/stdout。
- malformed persisted connector record 的原始 JSON payload。

read-only 必须 fail closed：

- tool 缺少显式 read-only marker 且 permission 不能保守判断为 read-only 时，不展示 execution affordance。
- connector disabled、tool invisible、approval missing、permission missing、role mismatch 或 project mismatch 时，不提交 execution。
- malformed persisted connector records 不能被浏览器“尽力修复”；backend/store 应返回 safe diagnostic，Web 只展示 fail-closed 状态。
- executor not configured、deterministic executor failure 或 observation finalization failure 都必须落到安全失败摘要，不能改为 raw output 通道。

## Future Implementation Boundaries

Stage 51 不修改代码。后续 Stage 54 implementation 可以触碰的文件类别应限制在 Web management surface、store/action contract wiring、copy 和 deterministic acceptance：

- `apps/web/src/app/page.tsx`：恢复 post-V1 单一 MCP management view，或把现有 page route 中的 view normalization 更新为新的 management surface。
- `apps/web/src/lib/workbench-store.ts`：复用或收窄 MCP view model / action result mapping，确保 malformed records fail closed。
- `apps/web/src/app/actions.ts` 或等价 server actions：只提交 allowlisted metadata，继续通过 API/service 边界执行。
- `apps/web/src/lib/i18n.ts` 和相关 i18n tests：增加 MCP management copy、failure diagnostics copy 和 navigation copy。
- `apps/web/src/app/page.test.ts`、`apps/web/e2e/alpha-boundaries.spec.ts` 或后续专用 E2E：覆盖 navigation re-entry、safe non-leakage、read-only affordance 和 failure states。
- `docs/web-v1-acceptance.md`、`docs/project-roadmap.md`、`docs/superpowers/README.md` 和 `docs/agent-development-learning.md`：同步 post-V1 MCP management 边界。

后续 implementation 不应触碰或扩展以下 runtime 范围，除非有单独 stage/spec：

- `packages/mcp-gateway` 的 real MCP SDK / server adapter。
- worker-backed MCP execution、real shell runner、strong sandbox adapter 或 raw stdout/stderr streaming。
- write tool approval / execution semantics。
- provider fallback execution、deployment runner、secret storage、auth/RBAC 或 production Postgres rollout。
- model context 注入 raw MCP result 的任何路径。

## Validation Strategy for Later Implementation

Stage 54 implementation 应使用 deterministic、本地、无真实外部依赖的验证策略：

- unit tests：覆盖 view model mapping、malformed connector fail-closed、read-only eligibility、approval state summary、safe diagnostics 和 non-leakage。
- browser tests：覆盖 navigation re-entry、project-scoped connector list、visible tools summary、read-only affordance、legacy route behavior 和 failure state rendering。
- docs gates：更新 roadmap、Superpowers README、acceptance docs 和 Agent learning note，确保 Stage 41 V1 hidden boundary 与 post-V1 re-entry 不矛盾。
- non-leakage assertions：明确断言 raw MCP output、raw arguments、secret、full artifact、local absolute path 和 unredacted exception 不出现在 rendered text、action redirect query、run timeline display 或 serialized test fixture 中。
- default gate 不依赖真实 MCP server、真实 provider、Postgres、deployment provider、remote browser farm、network service 或 production credentials。

可选但不作为默认 gate：

- 在显式 opt-in 环境中手动验证真实 provider 或真实 MCP server 之前，应先有单独 remote MCP SDK / adapter spec。
- 若 Stage 50 之后引入 browser platform / visual baseline，再决定 MCP management 是否需要更强 visual baseline。

## Failure Modes and Diagnostics

v0 产品面应优先给 operator 可操作、安全且稳定的诊断：

| Failure mode | Safe diagnostic | User action |
| --- | --- | --- |
| Connector disabled | `connector_disabled` | Enable connector or keep it disabled. |
| Malformed connector record | `invalid_connector_definition` | Replace connector definition from a trusted source. |
| No visible tools | `no_visible_tools` | Bind a skill with matching permission or adjust role/approval. |
| Approval missing | `approval_required` | Approve the tool when policy allows it. |
| Tool not read-only | `execution_not_read_only` | Do not execute in v0; wait for a future write-tool stage. |
| Executor unavailable | `mcp_executor_not_configured` | Use metadata view only. |
| Observation failed | `mcp_observation_failed` | Retry only if backend reports a safe retry affordance. |

这些 diagnostics 不应包含 raw connector JSON、raw request payload、raw result payload 或 stack trace。

## Recommended Next Route After Kickoff

Stage 51 kickoff 之后的推荐路由：

1. **Stage 54 - MCP Management Surface v0 Implementation**：单独实现 post-V1 Web 管理面、safe view model、navigation re-entry、read-only affordance 和 deterministic validation。
2. **Stage 48 - RC Blocker Fix Batch v0**：继续保持条件触发；仅当后续发现 accepted blocker 时优先。
3. **Stage 50 - Browser Platform / Visual Baseline Planning v0**：可选规划阶段；不要与 MCP management implementation 合并。
4. **Stage 52 - Real Deployment Runner Discovery v0**：后续 discovery candidate。
5. **Stage 53 - Model Gateway Cost / Fallback Policy Discovery v0**：后续 discovery candidate。

Stage 54 仍应保持 narrow implementation：只实现管理面和 deterministic safe affordance，不接 remote MCP SDK/server adapter，不做 write tools，不迁移 MCP execution 到 worker。

## Spec Self-review

- 范围聚焦在 post-V1 MCP management surface，不实现代码。
- Stage 41 的 V1 hidden boundary 与 Stage 54 的 post-V1 navigation re-entry 已明确区分。
- Stage 20 的 `ToolObservationRecord` 和 read-only execution 边界被复用为安全证据底座，而不是扩成 raw output 通道。
- Safety/evidence rules 已明确 allowlist 和 denylist。
- 后续验证不依赖真实 MCP server、provider、Postgres、deployment 或 remote browser platform。
