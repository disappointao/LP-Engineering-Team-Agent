# Stage 36：Real Provider Alpha Smoke Matrix and Operator Docs v0 Design

## 背景

Stage 35 已把真实 provider token delta streaming 接入普通聊天 `assistant` role。现在 Web/API 主路径已经能在 deterministic 默认模式下完成普通问答、LP 复杂任务、artifact preview/export 和 Skill-only alpha 验收；真实 provider 路径也已经具备 OpenAI-compatible / Anthropic-compatible adapter、Planner / Builder structured output、usage metadata 和 bounded failure events。

下一步不是把默认 alpha gate 改成真实 API 验收，而是给少数内部 operator 一份可重复、可排错、不会泄漏 secret 的真实 provider smoke 流程。默认 `pnpm alpha:check`、`pnpm smoke`、`pnpm alpha:e2e` 必须继续 deterministic、无 key、无网络依赖。

## 目标

- 新增 operator-facing 真实 provider alpha smoke 文档，覆盖 `.env.local`、provider route、`REAL_MODEL_RUNTIME=1`、可选 integration tests、手动 Web smoke matrix 和排错。
- 明确真实 provider smoke 是 opt-in，不进入默认 deterministic gate。
- 用少量 fake-provider regression 锁定文档依赖的关键行为：provider streaming usage metadata、bounded fail-closed events、secret/base URL 不进入 run events。
- 同步 README、manual acceptance、roadmap、Superpowers index 和 Agent 学习笔记，让后续 agent 能先读 roadmap，再找到真实 provider smoke 文档。

## 非目标

- 不让默认 `pnpm alpha:check`、`pnpm smoke`、`pnpm alpha:e2e` 依赖真实 API key、网络、MCP、Postgres 或真实部署。
- 不做生产 secret manager、billing/quota、cost ledger、fallback provider execution、provider marketplace 或 hosted observability。
- 不改变 LP artifact policy、Planner / Builder structured output parse / repair、deterministic fallback 或默认 Web backend。
- 不新增真实 provider 自动化 E2E；真实 provider Web smoke 保持 operator 手动执行。
- 不处理真实 provider streaming 中途失败、慢首 token、取消和更细 UI copy；这些留给 Stage 38。

## 设计

### 1. Operator 文档边界

新增 `docs/real-provider-alpha-smoke.md`，作为真实 provider alpha smoke 的唯一细化入口。README 只保留简短路径和链接，避免入口文档维护两套流程。

文档包含：

- 安全规则：真实 key 只放 `.env.local`，Models UI 只填写 `apiKeyEnv` 名称，不填写 key 值；不要把 raw provider response、secret、完整 base URL 或本机路径贴进 issue。
- 环境变量：`REAL_MODEL_RUNTIME=1`、`REAL_MODEL_PROVIDER_TEST=1` 的区别；OpenAI-compatible 和 Anthropic-compatible 的 `.env.example` 变量。
- Provider route：Models view 中 provider `api`、`baseUrl`、`apiKeyEnv`、model 和 `assistant` / `planner` / `builder` route。
- 手动 smoke matrix：default no-key gate、missing key fail-closed、普通聊天 streaming、LP Planner/Builder structured output、usage metadata、provider error 和 reset deterministic。
- 可选 integration tests：只在 operator 已显式设置 `REAL_MODEL_PROVIDER_TEST=1` 和 provider env 时运行。
- Troubleshooting：缺 key、route/provider disabled、protocol mismatch、structured output parse failure、artifact policy failure、SSE usage 缺失、sandbox/browser gate 失败。

### 2. Fake-provider regression

Stage 36 不需要真实 provider 自动化，但文档引用的行为必须由 fake provider 测试保护：

- `REAL_MODEL_RUNTIME=1` + OpenAI-compatible `assistant` route + fake SSE：
  - `runAssistantChatStream()` 消费 token delta；
  - terminal `model.completed` event 记录 provider-reported usage；
  - `streamingEnabled=true`；`supportsStreaming` 只表示显式 model capability，未配置 capability 时可为 `false`；
  - run events 不含 secret、`apiKeyEnv` 名称或完整 base URL。
- `REAL_MODEL_RUNTIME=1` + configured provider route + missing key：
  - assistant stream fail closed；
  - run event 记录 bounded `model_provider_api_key_missing`；
  - 不调用真实网络、不泄漏 env var 名称、secret 或完整 base URL。

### 3. 文档一致性

需要同步：

- `README.md`：把真实 provider 本地 smoke 的最小路径指向新文档，并说明默认 gates 不触网。
- `docs/web-v1-acceptance.md`：把可选真实 provider smoke 指向新文档，保留默认 deterministic 人工验收。
- `docs/superpowers/README.md`：新增 Stage 36 design/plan 阅读顺序。
- `docs/agent-development-learning.md`：记录真实 provider smoke 与默认 deterministic gate 的边界，避免未来误把 opt-in smoke 升级为默认 gate。
- `docs/project-roadmap.md`：Stage 36 完成后更新状态和后续推荐队列。

## 验收标准

- `docs/real-provider-alpha-smoke.md` 能让 operator 按清单完成 no-key default gate、missing key fail-closed、普通聊天、LP Planner/Builder、usage metadata 和 reset deterministic。
- README 和 manual acceptance 不再把真实 provider smoke 写成默认 alpha gate。
- fake-provider regression 覆盖 provider streaming usage metadata 和 missing-key bounded failure。
- 默认 validation 仍不需要真实 provider key。
- 完成收尾时运行与本阶段风险匹配的验证，并更新 roadmap。
