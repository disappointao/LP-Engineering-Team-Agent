# Stage 35 Provider Token Delta Streaming v0 Design

**日期：** 2026-05-22

**状态：** 已实现。

## 背景

Stage 26 已经提供 Web/API 普通聊天 NDJSON streaming transport，但当前 `assistant.delta` 仍来自 API 层把完整 assistant 文本切块后的模拟 delta。Stage 27 把 project-bound 普通聊天接入独立 `assistant` role 和真实模型 runtime。Stage 32 又补齐 provider usage metadata、duration、attempt、streaming capability 和 `streamingEnabled` summary。

第一版可用闭环里，普通问答需要真实 token delta 体感；但 LP Planner / Builder 的真实模型输出仍必须等完整 buffer 后做 `LPBriefSchema`、`StaticArtifactsSchema` parse / repair 和 artifact policy validation。Provider streaming 因此应该先进入 model gateway / assistant chat 路径，不能把 token chunk 当成最终业务事实。

## 目标

1. 在 `packages/model-gateway` 增加 provider-neutral streaming contract：
   - 只暴露 bounded text delta；
   - terminal event 暴露安全 usage / call metadata；
   - 不暴露 raw provider event body、prompt、raw response、secret、base URL 或完整 artifact 内容。
2. 为 OpenAI-compatible Chat Completions streaming 增加 fake-stream 覆盖：
   - request body 使用 `stream: true`；
   - 尽量请求 terminal usage summary；
   - 解析 SSE `data:` frame 中的 text delta；
   - provider 未返回 usage 时退回 estimated usage。
3. 为 Anthropic-compatible Messages streaming 增加 fake-stream 覆盖：
   - request body 使用 `stream: true`；
   - 解析 `content_block_delta` text delta；
   - 从 terminal / message delta usage 中提取 safe usage summary；
   - provider 未返回 usage 时退回 estimated usage。
4. 普通聊天 `assistant` role 在真实 runtime opt-in 且 route 支持 streaming 时，把 provider token delta 直接转成 Web `assistant.delta` transient state；最终只持久化完整 assistant message。
5. 保持 deterministic default、projectless chat、LP chain 和默认 alpha gates 不依赖真实 provider key。

## 非目标

- 不把 streaming chunk 直接写入最终 run event、message、artifact 或 business output。
- 不做 LP Planner / Builder structured output 的 token-level UI；它们继续走完整 buffer parse / repair。
- 不做 tool-call streaming、MCP streaming、raw stdout/stderr streaming 或 worker log streaming。
- 不做 fallback provider execution、billing/quota、provider marketplace、production observability 或 provider cost ledger。
- 不改变 `pnpm alpha:check`、`pnpm smoke`、`pnpm alpha:e2e` 的无 key deterministic 验收边界。

## 方案

### Model Gateway Contract

新增 provider-neutral stream event：

- `model.delta`：只包含 bounded `text`，用于 transient UI；
- `model.completed`：包含完整 `text`、safe `usage`、safe `call` metadata；
- `model.failed`：包含 bounded safe error code / message。

`ModelGateway.complete()` 保持现有完整 buffer 语义，继续服务 LP Planner / Builder 和 deterministic tests。新增 `ModelGateway.stream()` 只用于明确选择 streaming 的调用方。

### Provider Adapters

OpenAI-compatible streaming 采用 SSE parser：

- 忽略空 frame 和 `[DONE]`；
- 只读取 `choices[].delta.content` text；
- 支持 `usage` terminal frame；
- 对 malformed frame fail closed，不把原始 frame 泄漏给 runtime/UI。

Anthropic-compatible streaming 采用 SSE parser：

- 只读取 `content_block_delta` / `text_delta` 中的 text；
- 从 `message_delta` 或 terminal message event 提取 usage；
- 忽略 ping / metadata-only event；
- 对 malformed frame fail closed，不把原始 frame 泄漏给 runtime/UI。

### Runtime / API

`LocalAgentRuntimeAdapter.run()` 保持不变。新增或扩展 assistant-only streaming 方法时，只把 delta 暴露给普通聊天 route；terminal full text 仍走 service/store 的 existing persistence boundary。run event 中只记录 terminal `model.completed` metadata，不记录每个 token chunk。

如果 route/model 不支持 streaming，普通聊天继续使用已有 buffered completion + API chunking fallback。这样 deterministic default、projectless chat 和无 key环境不会受影响。

### Web Transport

`/api/chat/stream` 继续输出 Stage 26 的 NDJSON contract：

- `assistant.delta` 来自 provider token delta 或 deterministic fallback chunk；
- `assistant.completed` 只在完整内容持久化后发送；
- error event 仍使用 bounded safe error。

客户端无需知道 delta 来源，刷新后仍以 repository message 为准。

## 测试策略

- Model gateway unit tests：
  - OpenAI-compatible stream request body、delta parsing、terminal usage、estimated usage fallback、malformed SSE failure；
  - Anthropic-compatible stream request body、delta parsing、terminal usage、estimated usage fallback、malformed SSE failure；
  - In-memory/mock stream fallback 生成完整 terminal text 和 estimated usage。
- Runtime/API tests：
  - assistant streaming path 不持久化 chunk；
  - unsupported streaming route 回退到 existing buffered completion；
  - LP Planner / Builder 仍调用 `complete()`，不会进入 stream path。
- Web route tests：
  - provider delta 转成 `assistant.delta`；
  - terminal completion 后持久化完整 assistant message；
  - failure 不泄漏 raw provider event、secret 或 base URL。

最终验证至少包含：

```bash
pnpm alpha:check
pnpm smoke
pnpm test
pnpm typecheck
pnpm build
pnpm alpha:e2e
git diff --check
```

`pnpm alpha:e2e` 如遇本地 sandbox 端口绑定限制，可在批准后以同一命令重跑。

## 文档更新

实现阶段需要同步更新：

- `docs/agent-development-learning.md`：补充 token delta、terminal model fact 和 structured output buffer 的边界。
- `docs/project-roadmap.md`：Stage 35 状态、完成范围、Stage 36/37/38 推荐队列。
- `docs/superpowers/README.md`：新增 Stage 35 spec/plan 索引。
- 如真实 provider smoke 指引写入 README 或 acceptance docs，必须保持 opt-in，不能变成默认 gate。
