# Stage 57 Real Provider Local Run Polish v0 Design

## 背景

当前 Web/API 已能在 `REAL_MODEL_RUNTIME=1` 下通过项目 `Models` route 使用真实 provider：普通聊天走 `assistant`，LP 生成的 `Planner` / `Builder` 可走 structured output，`Reviewer` / `Deployer` 仍保持 deterministic / policy-driven。第一版目标已经收窄为本地单用户试跑，不考虑真实部署。

剩余摩擦集中在 operator 配置体验：需要手动复制 `.env.local`、理解 `apiKeyEnv` 只填变量名、在 Web 中分别创建 provider 和三条 route，并知道真实 smoke 是可选而不是默认 gate。Stage57 只打磨本地真实 provider 试跑路径，不扩大 runtime 能力。

## 目标

- 给本地 operator 一个可复核的 preflight：检查 `.env.local` 是否启用 `REAL_MODEL_RUNTIME=1`、是否至少配置一个 provider block、是否有 key、base URL 和 model。
- 在 `Models` 页面显示本地运行 checklist：创建并启用 provider、配置 `assistant` / `planner` / `builder` route、保持 `reviewer` / `deployer` deterministic。
- 更新真实 provider smoke 文档、README、acceptance / RC 文档，让 `not_run`、`skipped_no_keys`、`passed`、`failed` 状态边界清楚。
- 保持默认 `pnpm alpha:check`、`pnpm smoke`、`pnpm alpha:e2e` 和 `pnpm test` deterministic / no-key，不触发真实 provider。

## 非目标

- 不在 Web 保存真实 API key；Web 继续只保存 `apiKeyEnv` / `secretEnvName` 引用。
- 不把真实 provider smoke 变成 release gate 或默认 CI gate。
- 不做 provider marketplace、hosted provider matrix、自动 fallback provider execution、billing / quota、secret manager、部署 runner 或 real MCP 扩展。
- 不改变 LP structured output 的完整 buffer parse / repair 边界；不做 LP token-level UI。

## 设计

### 本地 preflight 命令

新增 `scripts/real-provider-doctor.mjs` 和 package script：

```bash
pnpm real-provider:doctor
```

该命令默认读取 `.env.local`，也可通过 `--env-file` 指向 `.env.real-provider.example` 或 operator 自己的 env 文件；它不发起网络请求，不写入 provider state，不打印 API key 值。输出内容包括：

- runtime 状态：`REAL_MODEL_RUNTIME=1` 是否启用。
- OpenAI-compatible profile 状态：`OPENAI_COMPATIBLE_BASE_URL`、`OPENAI_COMPATIBLE_API_KEY`、`OPENAI_COMPATIBLE_DEFAULT_MODEL` 是否已配置。
- Anthropic-compatible profile 状态：`ANTHROPIC_BASE_URL`、`ANTHROPIC_API_KEY`、`ANTHROPIC_DEFAULT_MODEL` 是否已配置。
- 推荐 Web Models 字段：`api`、`apiKeyEnv`、`model`，并提示 base URL 从 `.env.local` 对应变量复制。
- exit code：默认非 strict 模式即使缺 key 也返回 0，便于作为 checklist；`--strict` 在没有可用 profile 或未启用 `REAL_MODEL_RUNTIME=1` 时返回 1，便于 operator 自查。

新增 `.env.real-provider.example` 作为本地真实 provider 模板，默认仍保留 `REAL_MODEL_PROVIDER_TEST=0`，只把 `REAL_MODEL_RUNTIME=1` 写清楚。模板不包含真实 key。

### Models 页面 checklist

在 `buildModelsManagementViewModel` 中派生 `localRunChecklist`：

- `hasEnabledRealProvider`：至少一个 enabled provider 的 API 是 `openai-completions` 或 `anthropic-messages`，且 base URL、secret env ref、model 均配置。
- `assistantRouteReady`、`plannerRouteReady`、`builderRouteReady`：对应 role route state 为 `configured` 且 provider 是真实 API provider。
- `readyForChat`：enabled real provider + assistant route ready。
- `readyForLp`：enabled real provider + planner / builder routes ready。

Web `Models` 页面渲染一个紧凑 checklist，并保留现有 provider / route 表单。Checklist 文案强调：

- `.env.local` 需要 `REAL_MODEL_RUNTIME=1` 并重启 `pnpm dev`。
- Web 表单只填 env var 名，不填 key 值。
- 本地 LP 试跑只要求 `assistant`、`planner`、`builder` route；`reviewer` / `deployer` 第一版可保持 deterministic。

### 文档与收口

更新：

- `README.md`：把真实 provider 本地路径从手工段落改为 `cp .env.real-provider.example .env.local` + `pnpm real-provider:doctor` + Web route 配置。
- `docs/real-provider-alpha-smoke.md`：新增快速本地路径和 checklist 状态，明确真实 smoke 可选。
- `docs/web-v1-acceptance.md`、`docs/alpha-release-candidate.md`：把 `not_run` / `skipped_no_keys` 作为有效状态。
- `docs/project-roadmap.md`：记录 Stage57，并保持 3-5 个后续阶段队列。
- `docs/agent-development-learning.md`：补充真实 provider preflight 不是默认 readiness gate 的学习点。
- `docs/superpowers/README.md`：索引本 spec 和 implementation plan。

## 测试策略

- `scripts/real-provider-doctor.test.ts`：覆盖 missing `.env.local`、deterministic default、OpenAI-compatible ready、Anthropic-compatible ready、strict failure、secret 不出现在输出中。
- `apps/web/src/app/skills-models-management-view-model.test.ts`：覆盖 local run checklist 的 not ready、chat ready、LP ready、disabled / missing route fail-closed。
- `apps/web/src/app/page.test.ts` 或现有 Models page 测试：覆盖 checklist 文案出现在 Models view。
- `apps/web/src/lib/i18n.test.ts`：覆盖新增中英文文案。

最终验证至少运行：

```bash
pnpm alpha:check
pnpm smoke
pnpm typecheck
git diff --check
```

真实 provider smoke 只有在 operator 提供本机 key 时运行；本阶段不会把它作为默认验证。

## 风险与边界

- 如果 preflight 打印完整 base URL，operator 复制日志时可能泄漏内部 endpoint；因此默认只显示变量名和配置状态。
- 如果 Web checklist 读取 server env，会把本机配置状态误认为可持久的项目事实；因此 checklist 只从 project model state 派生 route/provider readiness，env readiness 由 doctor 命令处理。
- 如果 `--strict` 被默认 gate 使用，会让 no-key 环境失败；因此默认 package script保持 checklist 模式，文档明确 strict 仅供 operator 手动使用。
