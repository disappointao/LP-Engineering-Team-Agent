# Real Provider Alpha Smoke

这份清单用于少数内部 operator 手动验证真实 provider 路径。默认 alpha gate 仍是 deterministic、无 key、可重复：`pnpm alpha:check`、`pnpm smoke` 和 `pnpm alpha:e2e` 不应该依赖真实 API key、网络、MCP、Postgres 或真实部署。

## 安全规则

- 真实 API key 只放本机 `.env.local`，不要提交到仓库。
- Web Models view 中只填写 `apiKeyEnv` 变量名，例如 `OPENAI_COMPATIBLE_API_KEY` 或 `ANTHROPIC_API_KEY`，不要填写 key 值。
- 排查问题时不要粘贴 raw provider response、真实 key、完整内部 base URL、本机路径或完整 artifact 内容。
- 如果需要分享日志，只分享 bounded run event、UI 错误码、provider api 类型、model id 和是否配置了 base URL / key env。

## 快速本地路径

默认先运行 deterministic gates；真实 provider smoke 不是 release gate。只有 operator 本机提供 key，并明确 opt in `REAL_MODEL_RUNTIME=1` 时，才运行真实 provider smoke。

```bash
cp .env.real-provider.example .env.local
pnpm real-provider:doctor
```

`pnpm real-provider:doctor` 只帮助 operator 检查本机 env profile 和安全边界；route readiness 继续在 Web `Models` checklist 中确认。没有 `REAL_MODEL_RUNTIME=1` 和本机 key 时，它应保持 checklist / skip 语义，不触网、不回退成假成功。需要把 preflight 作为本机严格检查时可运行：

```bash
pnpm real-provider:doctor -- --strict
```

## 准备环境

先安装依赖并复制本地 env 文件：

```bash
pnpm install
cp .env.real-provider.example .env.local
```

默认本地开发保持：

```env
REAL_MODEL_RUNTIME=0
REAL_MODEL_PROVIDER_TEST=0
```

真实 Web/API runtime 手动 smoke 时，改为：

```env
REAL_MODEL_RUNTIME=1
```

`REAL_MODEL_PROVIDER_TEST=1` 只用于可选 integration tests；它不会自动让 Web runtime 走真实 provider。Web/API 真实 runtime 只看 `REAL_MODEL_RUNTIME=1` 和项目 Models route。

### OpenAI-compatible 配置

`.env.local` 示例：

```env
REAL_MODEL_RUNTIME=1
OPENAI_COMPATIBLE_BASE_URL=https://open.bigmodel.cn/api/paas/v4
OPENAI_COMPATIBLE_API_KEY=replace_with_local_secret
OPENAI_COMPATIBLE_DEFAULT_MODEL=glm-5.1
```

Models view 中创建 provider：

- `api`: `openai-completions`
- `baseUrl`: 使用 `OPENAI_COMPATIBLE_BASE_URL` 对应的服务地址
- `apiKeyEnv`: `OPENAI_COMPATIBLE_API_KEY`
- `model`: `OPENAI_COMPATIBLE_DEFAULT_MODEL` 对应的模型，例如 `glm-5.1`

### Anthropic-compatible 配置

`.env.local` 示例：

```env
REAL_MODEL_RUNTIME=1
ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic
ANTHROPIC_API_KEY=replace_with_local_secret
ANTHROPIC_DEFAULT_MODEL=glm-5.1
```

Models view 中创建 provider：

- `api`: `anthropic-messages`
- `baseUrl`: 使用 `ANTHROPIC_BASE_URL` 对应的服务地址
- `apiKeyEnv`: `ANTHROPIC_API_KEY`
- `model`: `ANTHROPIC_DEFAULT_MODEL` 对应的模型，例如 `glm-5.1`

## Web Route 设置

如果 `.env.local` 已设置 `REAL_MODEL_RUNTIME=1`，且 OpenAI-compatible 或 Anthropic-compatible profile ready，`pnpm dev` 首次读取 workbench store 时会自动创建 `Local Real Provider` 项目、provider 和五个 role routes：

- `assistant`：普通聊天 streaming。
- `planner`：LP brief structured output。
- `builder`：LP artifact structured output。
- `reviewer`：LP review run。
- `deployer`：LP deployment run。

这条路径用于本地单用户第一版试跑，让 operator 不需要先进入 Models 页面手动填 route。OpenAI-compatible 和 Anthropic-compatible 同时 ready 时，自动引导优先使用 OpenAI-compatible profile。需要改用其他 provider、模型或项目时，再在 Web 中打开 `Models` 手动调整：

1. 创建并启用 provider。
2. 保存 `assistant` route，用于普通聊天 streaming。
3. 保存 `planner` route，用于 LP brief structured output。
4. 保存 `builder` route，用于 LP artifact structured output。
5. 保存 `reviewer` 和 `deployer` route，避免 `REAL_MODEL_RUNTIME=1` 下完整 Web LP 链路因为缺少 role route 而 fail closed。

如果 `REAL_MODEL_RUNTIME=1` 但 route 缺失、provider disabled、protocol 不匹配或 key 缺失，系统应 fail closed，并在 UI/timeline 中显示 bounded error，而不是静默回到 mock 成功结果。

## Smoke Matrix

| ID | 场景 | 设置 | 操作 | 期望结果 |
| --- | --- | --- | --- | --- |
| S0 | 默认无 key gate | `REAL_MODEL_RUNTIME=0`、`REAL_MODEL_PROVIDER_TEST=0` | 运行 `pnpm alpha:check`、`pnpm smoke`、`pnpm alpha:e2e` | 全部不需要真实 provider key，不触发真实 provider 调用。 |
| S0.5 | Local smoke checklist | 复制 `.env.real-provider.example`，只填写本机要验证的 provider key | 运行 `pnpm real-provider:doctor` | 输出 provider profile readiness 和 Web Models 字段提示；不打印 key 值、不发起网络请求；缺 key 时仍是 checklist / skip 状态。 |
| S1 | Missing key fail-closed | `REAL_MODEL_RUNTIME=1`，配置 provider route，但 `.env.local` 不填 key 值 | 提交普通聊天 prompt | 生成失败为 bounded error；timeline 不泄漏 env var 名称、secret、完整 base URL 或 raw provider response。 |
| S2 | 普通聊天 streaming | `REAL_MODEL_RUNTIME=1`，配置 `assistant` route 和 key | 提交 `请用三点总结这个产品首页应该表达什么` | UI 出现流式 assistant delta，完成后持久化完整 assistant message。 |
| S3 | LP Planner structured output | 同上，并配置 `planner` route | 提交 `生成一个春季电商活动的静态 HTML 落地页` | Planner run 完成，`model.output.parsed` 显示 `LPBriefSchema`，不展示 raw model JSON。 |
| S4 | LP Builder static artifacts | 同上，并配置 `builder` route | 继续同一个 LP prompt | 生成 `index.html`、`styles.css`、`script.js`，artifact preview/export 可用，产物不依赖 React/Vue/Next/Vite。 |
| S5 | Usage metadata | 真实 provider 成功后查看 timeline | 查看 `model.completed` | 显示 provider、model、usage、duration、attempt、streaming summary；usage 可能是 `provider reported` 或 `estimated`。 |
| S6 | Provider HTTP / response error | 使用错误 base URL、错误 model 或临时无效 key | 提交普通聊天或 LP prompt | fail closed，显示 bounded provider failure；不保存 raw provider body。 |
| S7 | Reset deterministic | 改回 `REAL_MODEL_RUNTIME=0` | 重启 dev server，运行默认 gates | 默认本地路径恢复 deterministic，不依赖 provider route。 |
| S8 | LP artifact quality spot-check | `REAL_MODEL_RUNTIME=1`，配置 `planner` 和 `builder` route | 按 `docs/lp-artifact-quality.md` 选择 2 个 fixtures 提交 LP prompt | 记录 rubric score 和 safe evidence；不保存 raw provider response 或完整 artifact 内容。 |

## 可选 Integration Tests

只有在 operator 已确认可以触发真实 provider 调用时才运行。先设置 `.env.local` 或命令行环境：

```env
REAL_MODEL_PROVIDER_TEST=1
```

OpenAI-compatible：

```bash
REAL_MODEL_PROVIDER_TEST=1 \
OPENAI_COMPATIBLE_BASE_URL="https://open.bigmodel.cn/api/paas/v4" \
OPENAI_COMPATIBLE_API_KEY="replace_with_local_secret" \
OPENAI_COMPATIBLE_DEFAULT_MODEL="glm-5.1" \
pnpm exec vitest run packages/model-gateway/src/openai-completions.integration.test.ts
```

Anthropic-compatible：

```bash
REAL_MODEL_PROVIDER_TEST=1 \
ANTHROPIC_BASE_URL="https://open.bigmodel.cn/api/anthropic" \
ANTHROPIC_API_KEY="replace_with_local_secret" \
ANTHROPIC_DEFAULT_MODEL="glm-5.1" \
pnpm exec vitest run packages/model-gateway/src/anthropic-messages.integration.test.ts
```

如果不设置 `REAL_MODEL_PROVIDER_TEST=1` 或缺少必要 env，这些 integration tests 会被 skip。

## 排错

- Web 普通聊天开始前或首个 delta 前遇到 provider / route 配置错误时，会显示安全错误码 `provider_configuration_failed`。继续查看 Models view、run timeline 或服务日志中的 bounded `model_provider_*` 诊断码定位具体配置项。
- `model_provider_api_key_missing`：`apiKeyEnv` 指向的环境变量不存在或为空。确认 `.env.local` 已填写，并重启 `pnpm dev`。
- `model_provider_api_key_env_missing`：provider 配置没有 `apiKeyEnv`。回到 Models view，只填写变量名，不填写 key 值。
- `model_provider_config_missing`：route 指向的 provider 不存在或不属于当前 project。重新保存 provider 和 role route。
- `model_provider_disabled`：provider 被 disabled。启用 provider 后重新保存 route。
- `model_provider_protocol_mismatch`：route 的 `api` 与 provider 配置不一致。确认 OpenAI-compatible 使用 `openai-completions`，Anthropic-compatible 使用 `anthropic-messages`。
- `model_provider_request_timeout`：provider 在当前 timeout 内没有返回。Web 本地真实 runtime 默认使用 `LP_AGENT_MODEL_PROVIDER_TIMEOUT_MS=120000`，慢模型可在 `.env.local` 调高到最多 `300000`，然后重启 `pnpm dev`。
- Structured output parse failure：Planner / Builder 返回了非 schema JSON。当前 runtime 会做一次 repair；仍失败时查看 bounded `model.output.parse_failed` 和 `run.failed`。
- Artifact policy failure：Builder 返回了不符合静态 artifact policy 的内容，例如框架依赖或非法路径。需要调整 prompt 或 provider/model。
- Artifact quality issue：生成成功且 policy 通过，但视觉层级、CTA、移动端、copy 或基础可访问性不达预期。按 `docs/lp-artifact-quality.md` 记录 rubric score 和 safe evidence，再路由到 Stage 39/41。
- Usage 显示 `estimated`：provider stream 或 response 没有返回完整 usage；系统会估算 token usage，仍应显示 duration、attempt 和 streaming summary。
- `pnpm alpha:e2e` 出现本地端口 sandbox 错误：这通常是本地执行环境限制，不代表 provider 配置问题；默认 browser gate 仍不需要真实 provider key。

### Ordinary Chat Streaming Failures

普通聊天 provider streaming 的 Web/API failure copy 会把异常分成以下安全类别：

| Code | Meaning | Operator check |
| --- | --- | --- |
| `provider_configuration_failed` | Provider route、base URL、API protocol 或 key env 缺失。 | 检查 Models view、`.env.local`、`REAL_MODEL_RUNTIME=1` 和 provider `apiKeyEnv`，不要记录 key value。 |
| `stream_interrupted` | SSE stream 中断、malformed frame、provider 网络失败或 runtime 没有 terminal event。 | 确认 provider 支持当前 API protocol 的 streaming；用 fake-provider regression 或 provider dashboard 的 safe summary 复核。 |
| `empty_response` | Provider 完成但没有可用 assistant 文本。 | 复核 prompt、model id 和 provider response summary；不要复制 raw provider body。 |
| `persistence_failed` | Assistant text 已生成但本地 repository placeholder 保存失败。 | 检查 Web server log summary 和 repository backend 配置。 |

提交反馈时继续使用 `docs/alpha-release-candidate.md` 的 safe evidence 模板，不附带 secret、raw provider response、raw SSE frame、本机路径或完整 artifact 内容。

## 收尾

完成真实 provider smoke 后，把 `.env.local` 改回默认：

```env
REAL_MODEL_RUNTIME=0
REAL_MODEL_PROVIDER_TEST=0
```

如果本次使用了 `.env.real-provider.example`，收尾时确认真实 key 仍只存在于本机 `.env.local`，不要把 `.env.local`、terminal 输出中的内部 endpoint、raw provider body 或完整 artifact 内容提交到反馈记录。

重新运行默认 deterministic gate：

```bash
pnpm alpha:check
pnpm smoke
pnpm alpha:e2e
```

如果真实 provider smoke 发现问题，按 `docs/alpha-release-candidate.md` 中的 feedback template 记录，只提交 bounded error、UI message、safe timeline summary 和脱敏环境信息。
