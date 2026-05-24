# Skill-only Alpha Release Candidate

这份文档用于判断当前本地单用户版本是否可以作为内部 **Skill-only local alpha release candidate** 交给少数试用者。它不是 public SaaS onboarding，也不是生产发布 SLA。

详细人工验收继续使用 `docs/web-v1-acceptance.md`。真实 provider 手动 smoke 继续使用 `docs/real-provider-alpha-smoke.md`。本文负责编排 go/no-go、试用脚本、反馈模板和 triage 分类；反馈进入 `docs/alpha-feedback-intake.md` 和 `docs/alpha-feedback-log.md`，由 Stage 40 之后的批次化流程维护。

Stage 46 completion gate 的当前证据记录见 `docs/v1-polished-alpha-completion.md`。准备内部 RC 前，先看该文件的 automated gate、manual acceptance、optional real provider smoke、open blockers 和 RC decision，再按本文 trial script 执行新的 operator 试用。

## RC 定义

当前 RC 的范围：

- 本地单用户 Web workbench。
- 默认 deterministic / no-key / local-first。
- 普通聊天支持 Web/API streaming。
- LP 复杂任务走 `Planner -> Builder -> Reviewer -> Deployer` 固定链路，并展示 live task progress。
- 生成 artifact 必须是框架无关静态 `index.html`、`styles.css`、`script.js`。
- Project Skills 是第一版主要扩展机制。
- 真实 provider 是显式 opt-in：`REAL_MODEL_RUNTIME=1` + project Models route + 本地 `.env.local` key。
- MCP、真实部署、auth/RBAC、production Postgres rollout、真实 shell runner 和 hosted observability 都不属于 RC 必需路径。

## Go/No-go Gates

| Gate | Go 标准 | No-go 条件 |
| --- | --- | --- |
| Environment | Node.js/pnpm 可用，`pnpm install` 完成，`.env.local` 默认 `REAL_MODEL_RUNTIME=0`、`REAL_MODEL_PROVIDER_TEST=0`。 | 依赖无法安装，默认环境必须依赖真实 key 才能启动。 |
| Automated deterministic gates | `pnpm alpha:check`、`pnpm smoke`、`pnpm alpha:e2e`、`pnpm test`、`pnpm typecheck`、`pnpm build` 通过。 | 默认 gate 失败，或默认 gate 需要真实 provider、MCP、Postgres、真实部署。 |
| Manual acceptance | `docs/web-v1-acceptance.md` 主路径通过：普通聊天、LP live task、artifact preview/export/snippet、Skills、Models/MCP boundary。 | 主路径无法完成，或 failure display 泄漏 secret/raw provider/raw tool/raw artifact、本机路径。 |
| Optional real provider smoke | 如需真实 provider 试用，按 `docs/real-provider-alpha-smoke.md` 完成普通聊天、LP Planner/Builder、usage metadata、missing key fail-closed。 | 真实 provider 成功路径不可用，或 fail-closed 泄漏 key、env value、raw provider response。 |
| Known limitations | 试用者已知道 MCP、真实部署、auth/RBAC、billing/quota、production storage、真实 shell runner 后置。 | 试用目标依赖这些后置能力。 |
| Feedback readiness | 试用者使用本文反馈模板；operator 按 `docs/alpha-feedback-intake.md` 脱敏、分类并记录到 `docs/alpha-feedback-log.md`。 | 反馈需要收集 secret、完整 artifact、raw provider body、本机路径或不可脱敏日志。 |

## Operator Trial Script

建议一次内部 RC 试用控制在 60-90 分钟。

1. 准备本地环境：
   - 运行 `pnpm install`。
   - 复制 `.env.example` 到 `.env.local`。
   - 保持 `REAL_MODEL_RUNTIME=0` 和 `REAL_MODEL_PROVIDER_TEST=0`。
2. 运行自动 gate：
   - `pnpm alpha:check`
   - `pnpm smoke`
   - `pnpm alpha:e2e`
3. 启动 Web：
   - `pnpm dev`
   - 打开 Next.js 输出的本地 URL。
4. 普通聊天：
   - 在首页直接提交一个非 LP prompt，例如 `帮我整理一个首页上线检查清单`。
   - 确认回答流式展示，完成后保留 thread。
5. LP 复杂任务：
   - 提交 `生成一个春季电商活动的静态 HTML 落地页`。
   - 确认 live task panel 展示 Planner、Builder、Reviewer、Deployer progress。
   - 确认 Stage 43 run timeline 展示 Planner、Builder、Reviewer、Deployer 和 handoff marker；当 bounded recovery / repair / retry guidance 出现时，operator 不需要 raw run event 或 provider payload 才能判断当前状态。
   - 确认 artifact workspace 包含 `index.html`、`styles.css`、`script.js`。
6. Artifact 检查：
   - 打开 preview/export。
   - 分别查看三个文件的 bounded snippet。
   - 确认 UI 不展示完整 artifact 内容作为默认 diff。
   - Artifact workspace: after LP generation, open `Artifacts`, inspect the three-file manifest, preview snippets, check static preview, and verify single HTML export is available.
   - 如本次试用关注 LP 输出质量，按 `docs/lp-artifact-quality.md` 选择 2-4 个 fixtures 做人工 rubric 记录。
7. Skills 主路径：
   - 创建 project-scoped Skill draft。
   - Validate、publish、bind、enable。
   - 确认普通聊天或 LP task 展示安全 context summary，而不是 raw skill content。
8. Models / MCP 边界：
   - 打开 Models view，确认真实 provider 是 opt-in。
   - 确认 sidebar / top-level navigation 不展示 MCP 入口。
   - 直接访问 `/?view=mcp`，确认页面安全降级，不展示 MCP connector、tool approval 或 execution form。
   - 不配置 MCP 仍可完成普通聊天和 LP task。
9. Failure display：
   - 确认 provider fail-closed、Skills invalid manifest、Models invalid config、artifact invalid path / oversized snippet、worker queue bounded error、recovery/timeline diagnostics non-leakage 由 `pnpm alpha:e2e` 覆盖。
   - 人工 spot-check 页面不泄漏 secret、raw provider response、raw tool output、本机路径或完整 artifact 内容。
10. 可选真实 provider：
   - 只有在试用目标需要真实模型时，按 `docs/real-provider-alpha-smoke.md` 执行。
   - 完成后把 `.env.local` 改回默认 deterministic 值。
11. Feedback intake：
   - 使用本文 Feedback Template 收集反馈。
   - 按 `docs/alpha-feedback-intake.md` 脱敏和分类。
   - 将 accepted / rejected / routed items 写入 `docs/alpha-feedback-log.md`。

## Feedback Template

提交反馈时使用下面格式，并遵守 `docs/alpha-feedback-intake.md` 的完整 Not allowed 规则。不要附带 secret、API key、env value、raw provider response、raw SSE frame、完整 artifact 内容、本机绝对路径、raw worker payload/output、raw tool payload/output、raw stdout/stderr、private customer data 或不可脱敏日志。

```markdown
### Summary

一句话描述问题或建议。

### Category

blocking_bug | ux_friction | provider_config_issue | artifact_quality_issue | docs_gap | future_feature

### Severity

blocker | high | medium | low

### Environment

- Commit:
- Date:
- Browser:
- Runtime mode: deterministic | real provider opt-in
- Provider api if relevant: openai-completions | anthropic-messages | not applicable
- Model if relevant:

### Steps

1. 
2. 
3. 

### Expected

期望看到什么。

### Actual

实际看到什么。只写 bounded error、UI message、safe timeline summary 或截图描述。

### Safe Evidence

- Command output summary:
- Screenshot description or relative artifact filename:
- Run/event type if relevant:
- Artifact filenames if relevant:

### Suggested Routing

Stage 40 | Stage 41 | Stage 42 | Stage 43 | Stage 44 | Stage 45 | Stage 46 | backlog | needs_immediate_fix
```

## Triage Categories

| Category | Definition | Examples | Default routing |
| --- | --- | --- | --- |
| `blocking_bug` | RC 主路径无法完成，或安全边界被破坏。 | 普通聊天无法完成；LP task 不生成 artifact；secret/raw provider response 出现在 UI。 | `needs_immediate_fix`，必要时暂停 RC。 |
| `ux_friction` | 功能可完成，但交互、文案、状态或视觉层级让试用者误解。 | 用户不知道任务还在跑；失败文案无法区分 provider 配置和 stream 中断。 | Stage 41-45，按页面或流程归类。 |
| `provider_config_issue` | 真实 provider opt-in 配置或排错不清楚。 | `apiKeyEnv` 填写误解；protocol mismatch 不知道怎么恢复。 | Stage 44 或 `docs/real-provider-alpha-smoke.md`。 |
| `artifact_quality_issue` | LP artifact 生成成功，但质量、响应式、copy、CTA 或可访问性不达预期。 | 首屏层级弱；移动端拥挤；CTA 不明确。 | `docs/lp-artifact-quality.md` + Stage 42/43。 |
| `docs_gap` | 文档缺少步骤、命令、前置条件或边界说明。 | 不知道先跑 `pnpm alpha:e2e:install`；不清楚如何 reset deterministic。 | Stage 40 或当前阶段文档补丁。 |
| `future_feature` | 明确超出当前 RC 的能力需求。 | 团队登录、真实部署、MCP management/write tools、billing、远端 observability。 | Backlog，不阻塞 RC。 |

## Known Limitations

这些限制不默认阻塞 RC，除非本次试用目标明确依赖它们：

- MCP 不属于第一版必需路径；当前不要求真实 MCP server、write tools 或 MCP worker execution。
- 真实部署编排后置；当前 deployment skill command 仍是受控 queue / safe observation 路径。
- Auth/RBAC、邀请、团队审批队列和 hosted deployment 后置。
- Postgres 仍是显式 opt-in；production migrations、object storage 和 artifact content migration 后置。
- 真实 shell runner、强 sandbox、OS-level isolation 和 raw stdout/stderr streaming 后置。
- Billing/quota/cost ledger 和 automatic fallback provider execution 后置。
- LP structured output token-level UI 后置；Planner / Builder 仍完整 buffer 后 parse / repair。
- 远端 browser farm、跨浏览器矩阵和 pixel-perfect screenshot baseline 后置。

## Follow-up Routing

- Stage 40（已完成）：反馈 intake/triage loop，把本文模板变成批次化 issue review、known issues 和修复优先级。
- Stage 41（已完成）：Web surface pruning，隐藏 MCP management 和 MCP tab/sidebar/top-level 入口，收紧 V1 navigation。
- Stage 42（已完成）：Dedicated artifact workspace，覆盖 manifest、preview、bounded snippet、export 和安全失败状态。
- Stage 43（已完成）：Run timeline、handoff、recovery UX polish 和 progress visual hierarchy。
- Stage 44（已完成）：Skills / Models client-side management，继续排除 MCP management。
- Stage 45（已完成）：Browser failure injection、recovery/timeline diagnostics non-leakage 和轻量视觉回归扩展。
- Stage 46：V1 polished alpha completion gate、RC decision record 和最终验收。
- Backlog：MCP management、production auth/RBAC、真实部署、MCP SDK/write tools、object storage、billing/quota、真实 shell runner、hosted observability。

## RC Decision Record

每次准备交付内部 RC 前复制一份：

```markdown
### RC Decision

- Commit:
- Date:
- Operator:
- Automated gates:
  - pnpm alpha:check:
  - pnpm smoke:
  - pnpm alpha:e2e:
  - pnpm test:
  - pnpm typecheck:
  - pnpm build:
  - git diff --check:
- Manual acceptance:
- Optional real provider smoke:
- Known limitations acknowledged:
- Open blockers:
- Decision: go | no-go
- Follow-up owner:
```
