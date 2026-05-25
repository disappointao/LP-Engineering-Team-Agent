# Browser Platform / Visual Baseline Planning v0

Stage50 是 docs/planning only。该阶段只整理当前 browser acceptance 事实和后续平台化建议，不修改 Playwright config、specs、scripts、runtime code、package scripts 或 tests，也 does not change default browser gate。

## Current Baseline

- `pnpm alpha:e2e` 当前使用 Playwright Chromium、本地 Next.js dev server、single worker、isolated JSON state 和 deterministic runtime。
- 默认 browser gate 不依赖真实 provider key、MCP server、Postgres、deployment、remote farm、network 或 production credentials。
- 当前验证路径以本地 deterministic acceptance 为主：使用隔离 JSON state，避免真实 provider、真实 MCP server、真实 Postgres、真实部署和远程 browser platform 造成不稳定输入。
- 当前 browser acceptance 已覆盖主路径、bounded failure injection、non-leakage diagnostics 和轻量 visual geometry contract，但不提交 pixel screenshot baseline。
- Stage50 不改变这些默认事实；它只为 cross-browser matrix、remote browser farm、visual baseline、artifact retention 和 failure triage 建立后续决策基线。

## Planning Decision

默认 gate 继续保持 Tier 0：Chromium local deterministic。Stage50 不把 cross-browser matrix、remote browser farm 或 pixel screenshot baseline 放进默认 readiness gate，因为当前目标仍是本地/单用户 alpha 的可重复、安全、低成本验证。

后续 browser platform 按 tier 推进：

| Tier | 用途 | 推荐状态 | Gate |
| --- | --- | --- | --- |
| Tier 0 | 当前默认 local deterministic alpha acceptance | 已存在 | `pnpm alpha:e2e` |
| Tier 1 | opt-in compatibility smoke，用于 Firefox/WebKit/local viewport 兼容性信号 | 后续实现候选 | 手动或 opt-in script |
| Tier 2 | remote browser farm / CI matrix discovery，用于跨 runner 和远程 artifact 策略验证 | 后续 discovery candidate | 不进入默认本地 gate |
| Tier 3 | pixel screenshot baseline discovery，用于少量稳定高影响 surfaces 的截图基线评估 | 后续 discovery candidate | explicit review 后 opt-in |

Tier 1 和 Tier 3 不应默认要求真实 provider key、MCP server、Postgres、deployment、remote farm、network 或 production credentials。Tier 2 的定义包含 remote browser farm / CI matrix discovery，因此它可以在 explicit opt-in discovery 或 CI run 中使用 remote farm 和 network；但这不能改变 Tier 0 默认本地 gate，默认 local gate 仍保持 no-farm、no-network、no-credentials。任何升级都应明确 no-key deterministic state 的边界、operator ownership、artifact retention 和 failure triage policy。

## Cross-Browser Matrix Recommendation

Stage50 推荐先不启用完整 cross-browser matrix。后续如果实现 Tier 1 compatibility smoke，应先选少量 high-signal flows，避免把所有 browser specs 复制到每个 project。

| Surface | Chromium desktop | Firefox desktop | WebKit desktop | Mobile viewport |
| --- | --- | --- | --- | --- |
| Workbench shell | Tier 0 默认 gate | Tier 1 opt-in smoke | Tier 1 opt-in smoke | later candidate |
| Ordinary chat streaming | Tier 0 默认 gate | Tier 1 opt-in smoke | Tier 1 opt-in smoke | later candidate |
| LP live task/artifacts | Tier 0 默认 gate | Tier 1 opt-in smoke | Tier 1 opt-in smoke | later candidate |
| Skills/Models/MCP management | Tier 0 默认 gate | Tier 1 opt-in smoke | Tier 1 opt-in smoke | later candidate |
| failure/non-leakage states | Tier 0 默认 gate | high-risk subset only | high-risk subset only | later candidate |
| visual geometry contracts | Tier 0 默认 gate | avoid until stable | avoid until stable | separate mobile contract only |

推荐下一步不是直接扩大 `playwright.config.ts`，而是先设计 future opt-in command，例如 `pnpm alpha:e2e:compat`。该命令应运行少量 focused compatibility smoke，并继续复用 deterministic fixture、isolated JSON state 和 no-key local runtime。

## Remote Browser Farm Recommendation

Stage50 明确 no immediate remote browser farm implementation。remote browser farm 暂不接入默认 gate，也不作为当前 docs/planning 阶段的实现项。

后续 Tier 2 discovery 应先回答这些问题：

- 是否已有 CI provider 能稳定保留 Playwright trace、video、screenshot 和 diagnostic screenshots。
- PR、nightly、release candidate 分别运行哪些 browser projects，是否需要 Chromium/Firefox/WebKit 全量还是 focused matrix。
- remote browser farm 是否允许 network access；如果允许，如何继续保证 no-key deterministic state。
- artifact retention 的默认周期、存储位置、访问权限和清理责任分别由谁负责。
- 失败后由谁 triage，什么情况下 rerun，什么情况下必须修 product regression。
- remote artifact 如何继续避免 secret、本机路径、raw provider response、raw MCP output 和 raw artifact full content。
- remote runner 的 OS、font、browser version 差异是否会破坏 geometry/layout contract 或未来 pixel screenshot baseline。

在这些问题有明确答案前，remote browser farm 只保留为 discovery candidate，不应改变 `pnpm alpha:e2e` 的默认本地 gate。

## Visual Baseline Recommendation

默认继续使用 geometry/layout contract，而不是 pixel screenshot baseline。当前更重要的是验证结构性布局、安全状态、critical panel visibility、no horizontal scroll 和 artifact workspace 的基本可用性，而不是冻结像素级 UI。

Tier 3 pixel screenshot baseline 只适合 stable/high impact/low flake surfaces，并且必须 explicit review。候选 surface 需要同时满足：

- UI 足够稳定，文案、spacing 和 layout 不频繁变化。
- failure impact 高，普通 geometry assertion 不足以捕捉关键问题。
- screenshot 能稳定规避 OS、font、browser version 和 animation timing 噪音。
- baseline update 有 reviewer、变更理由和 focused browser command 证据。
- screenshot 不包含 user data、secret、raw tool output、raw provider response、raw MCP output、raw artifact full content 或本机路径。

Current geometry coverage：

- Workbench shell 的 sidebar、workspace、composer 基础布局。
- LP live task/artifacts 的 manifest、preview、export controls 和 panel visibility。
- 已有 visual geometry contracts 中的 no horizontal scroll、button/input containment 和 critical panel visibility。

Future geometry candidates to keep as geometry rather than pixel baseline：

- Ordinary chat streaming 的消息容器、输入区和状态提示位置。
- Skills/Models/MCP management 的列表、详情、empty/error states 和 non-leakage diagnostics。
- failure/non-leakage states 的安全提示、红线 copy 和 diagnostic containment。
- 后续扩展 visual geometry contracts 时仍优先使用 semantic / geometry assertions，而不是 pixel screenshot baseline。

暂不建议进入 pixel baseline 的 areas：

- LP generated artifact visual quality。
- streaming token transient states。
- dynamic timeline progress animation。
- provider/MCP/worker failure diagnostics copy。
- 仍在高频调整的信息架构和管理面板文案。

## Artifact Retention Recommendation

本地 artifact retention 建议：

- `test-results/` 继续不提交。
- Playwright failure trace/video/screenshot 按当前本地配置保留，作为失败诊断输入。
- diagnostic screenshots 继续写入 `testInfo.outputPath(...)`，只用于本地或 CI artifact，不进入 git baseline。
- 不提交 baseline image，不把 pixel screenshot baseline 加入默认 gate。
- 本地开发者可以清理 `test-results/`，不需要保留成功 run 的历史 artifacts。

未来 CI / remote browser farm artifact retention 建议：

- PR run artifacts 建议保留 7 天。
- release candidate run artifacts 建议保留 30 天。
- nightly matrix artifacts 建议只保留失败 run；如保留成功 run，建议最长 24 小时。
- remote artifact access 应限制到需要 triage 的开发者和 operator。
- retention policy 进入 CI 前必须写入 operator docs，并明确 secret、本机路径和 raw response 的泄漏检查责任。

## Failure Triage Policy

Browser failure 先按以下 Failure Triage categories 分类：

| Category | Meaning | First response |
| --- | --- | --- |
| product_regression | 用户可见主路径、安全边界或 artifact workflow 坏了 | 修 product code，并补 focused test 或更新现有断言 |
| test_fixture_drift | isolated state、fixture、mock event 或 locator 与产品事实不一致 | 修 fixture/helper/locator，不扩大 product contract |
| infra_flake | browser install、local port、timing、remote runner、resource contention 或 transient CI 问题 | rerun once，记录 infra evidence；重复出现后进入 infra backlog |
| visual_contract_too_brittle | geometry/pixel rule 约束了非关键样式或正常 UI 调整 | 降低断言、换成语义断言，或仅保留 diagnostic screenshot |
| accepted_ui_change | 有意 UI 变化导致旧 contract 失效 | 更新 test/docs，说明 user-visible change 和 review 依据 |

如果未来启用 pixel screenshot baseline，baseline update 必须在 PR 描述或 closeout 中列出：

- 旧 baseline 为什么过期。
- 新 screenshot 对应的 user-visible change。
- 是否仍不含 secret、本机路径、raw tool output、raw provider response、raw MCP output 或 raw artifact full content。
- 已运行的 focused browser command。

## Recommended Follow-Up Candidates

- Stage56 Browser Compatibility Smoke Discovery v0：设计 opt-in Firefox/WebKit/local compatibility smoke，不改变默认 gate，不引入 remote browser farm。
- Stage57 Visual Baseline Candidate Discovery v0：只评估少量 stable/high impact/low flake surfaces 是否值得 pixel screenshot baseline，并定义 baseline update review policy。
- Stage58 Remote Browser Farm Discovery v0：定义 CI/farm provider、browser project matrix、artifact retention、network/no-key policy、failure triage ownership 和 operator docs 要求。

## Validation Plan

- Stage50 是 docs/planning only，默认 browser gate 不变。
- 本节记录推荐 validation plan，不表示这些命令已经在本文档中记录为执行结果。
- 默认 validation 应运行 `pnpm alpha:check`、`pnpm smoke`、`git diff --check` 和 docs consistency `rg`。
- Task 1 docs consistency command：

```bash
rg -n "Stage50|Browser Platform|Visual Baseline|Tier 0|remote browser farm|pixel screenshot baseline|artifact retention|Failure Triage" docs/browser-platform-visual-baseline-planning.md
```

- `pnpm alpha:e2e` 可作为 confidence check，但不是 Stage50 Task 1 必需项，因为本任务没有修改 browser tests、Playwright config、runtime code 或 package scripts。
