# Stage 32 Provider Streaming and Usage Metadata v0 Design

**日期：** 2026-05-22

**状态：** 已实现。

## 背景

Stage 30/31 已经把本地第一版可用闭环收敛到 Skill-only alpha，并通过 `pnpm alpha:check` 和 `pnpm alpha:e2e` 固定 deterministic 主路径。用户现在可以在 Web 里做普通问答、提交 LP 复杂任务、观察 run timeline、查看 artifact preview/export/snippet，并理解 Skills / Models / MCP 的 alpha 边界。

当前真实 provider 路径还缺少两类可见性：

- 使用真实 provider 时，系统只暴露最终 `model.completed`，无法说明调用耗时、usage 是否来自 provider、是否支持 streaming，以及本次调用是第几次 attempt。
- Web timeline 只能展示通用 event type，无法把 token 用量、duration、provider/model/protocol 这类安全 metadata 转成可扫读摘要。

Stage 32 的目标是补齐 provider streaming capability 和 bounded usage metadata 的最小可用边界，让真实 provider 路径更透明，同时不改变 LP structured output parse / repair / fail-closed 语义。

## 目标

1. 在 `packages/model-gateway` 定义 provider-neutral 的 usage metadata，区分 provider reported usage 和本地 estimated usage。
2. 为 `anthropic-messages` 和 `openai-completions` adapter 记录安全调用 metadata：
   - provider id / providerName；
   - API protocol；
   - model；
   - attempt；
   - durationMs；
   - inputTokens / outputTokens / totalTokens；
   - usageSource；
   - supportsStreaming / streamingEnabled。
3. 在 runtime `model.completed` event 中透传 bounded usage summary，不包含 raw provider response、prompt、raw model output、secret、base URL 或环境变量值。
4. Web timeline 对 `model.completed` 展示 compact metadata，让人工 alpha 使用时能快速判断真实 provider 调用是否发生、是否返回 usage、耗时如何。
5. 保持 deterministic default：mock route 仍不触发网络，仍返回 synthetic usage，但明确标记为 estimated。
6. 用 fake-fetch tests 覆盖 OpenAI-compatible 和 Anthropic-compatible usage 解析、duration/attempt metadata、streaming capability 映射和 secret-safe event payload。
7. 文档说明本阶段只做 metadata 和 capability，不做真实 token delta UI 或计费系统。

## 非目标

- 不做自动 fallback provider execution；Stage 21 的 fallback 仍只暴露安全 metadata。
- 不做 tool-call protocol conversion。
- 不做 billing、quota enforcement、cost ledger 或 provider marketplace。
- 不做真实 provider token delta 逐字显示到 Web UI；v0 只建立 capability / metadata / event 边界。
- 不改变 Planner / Builder structured output parse、repair prompt 或 artifact policy validation。
- 不做 MCP、真实 shell runner、auth/RBAC、production observability stack 或真实部署编排。
- 不保存 raw provider response、raw model output、prompt 正文、base URL、API key env value 或完整 artifact 内容。

## 方案比较

### 方案 A：Usage metadata first，streaming capability 先入协议

扩展 `ModelResponse`，新增 `metadata` 或等价结构，记录 usage source、duration、attempt、streaming support 和 bounded provider call facts。provider adapter 继续用非 streaming 请求获取完整响应；`supportsStreaming` 先作为 route capability 和 event/UI metadata 暴露，后续 token delta UI 可以复用这个协议。

优点：

- 风险低，不打断现有 LP parse / repair 流程。
- 能立刻提升真实 provider alpha 可观察性。
- 单测可以用 fake-fetch 稳定覆盖，不依赖真实 provider key。
- 为后续 token delta streaming 预留边界。

缺点：

- 用户还看不到真实模型逐 token 输出。
- 需要谨慎命名，避免把 `supportsStreaming` 误解为本次调用已经 streaming。

### 方案 B：直接把 provider token delta 流到 Web

在 model gateway 增加 streaming API，adapter 解析 provider SSE / event stream，Web chat 和 LP runtime 直接消费 token delta。

优点：

- 最贴近真实用户对“流式回答”的直觉。
- 可以减少长回答期间的空等待感。

缺点：

- 会同时改动 provider adapter、runtime、API streaming route、LP structured output buffer、repair path 和 Web 状态机。
- Anthropic-compatible 和 OpenAI-compatible streaming event shape 差异较大，测试矩阵会膨胀。
- LP Builder/Planner 仍必须等完整 JSON 才能 parse，token delta 不应直接成为业务事实。

### 方案 C：只做 usage，不碰 streaming capability

只在 adapter 响应里解析 usage，并在 event/UI 中展示 tokens/duration。

优点：

- 实施最小。
- 不会引入 streaming 概念歧义。

缺点：

- 和 roadmap 的 Stage 32 范围不完全匹配。
- 后续做 provider token streaming 时还要重新打开 model gateway/routing 协议。

## 选择

采用方案 A：先做 provider usage metadata 和 streaming capability 边界，不在本阶段实现真实 token delta UI。

本阶段把“provider 是否支持 streaming”和“本次调用是否 streaming”分开：

- `supportsStreaming` 来自 route/model capability，表示 provider/model 配置声明支持。
- `streamingEnabled` 表示本次请求是否真的使用 streaming；Stage 32 v0 默认仍是 `false`。

这样可以让 Web/Agent timeline 明确显示“这个 route 支持 streaming，但当前 LP structured call 仍走完整响应”，避免让用户误以为 token delta 已经落地。

## 数据模型

建议新增 provider-neutral 类型：

```ts
export type ModelUsageSource = "provider_reported" | "estimated";

export interface ModelUsageMetadata {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  source: ModelUsageSource;
}

export interface ModelCallMetadata {
  attempt: number;
  durationMs: number;
  supportsStreaming: boolean;
  streamingEnabled: boolean;
  usage: ModelUsageMetadata;
}
```

`ModelResponse.usage` 可以为了兼容继续保留 `{ inputTokens, outputTokens }`，并新增 `metadata.call` 或 `usage.source/totalTokens`。实现时优先减少跨 package 破坏面，但最终 runtime event 必须能表达 usage source、duration、attempt 和 streaming state。

## Event 边界

`runtime-adapters` 的 `model.completed` event 继续作为模型调用完成事实。Stage 32 应扩展它的 payload，而不是新增 raw provider event：

- 保留现有 `provider`、`providerName`、`api`、`model`、`modelCapabilities` 和 `usage`。
- 新增或扩展 bounded fields：`usageSource`、`totalTokens`、`attempt`、`durationMs`、`supportsStreaming`、`streamingEnabled`。
- 失败路径仍使用 `model.retry.scheduled`、`model.retry.exhausted`、`run.failed` 和 fallback metadata event；不要在失败 event 中泄漏 provider body。

`run-orchestrator` 已经把 runtime event payload shallow-copy 到 `RunEventRecord.payload`。本阶段要保证新增 payload 是 scalar / shallow object，避免把 nested raw provider body 传进 repository。

## Web 显示

`apps/web/src/lib/chat-workbench.ts` 当前 `formatRunEventMeta()` 只展示 event type、commandId、workerJobId、exitCode、errorName 和 outputSummary。

Stage 32 v0 增加 model completed compact summary：

- `provider/model`；
- protocol；
- `inputTokens/outputTokens/totalTokens`；
- usage source：provider reported 或 estimated；
- `durationMs`；
- streaming state：supported / request streaming disabled。

展示应保持一行 compact meta，不新增复杂 dashboard。真实 provider 的 base URL、secret env 名、raw response、prompt 和 raw output 不进入 UI。

## 测试策略

### Model gateway

- OpenAI fake-fetch response 带 `usage.prompt_tokens`、`usage.completion_tokens`、`usage.total_tokens`，断言 `source: "provider_reported"`、`totalTokens`、duration、streaming fields。
- Anthropic fake-fetch response 带 `usage.input_tokens`、`usage.output_tokens`，断言 provider usage metadata。
- Mock route 断言 usage source 为 `estimated`，duration 是非负整数，streaming enabled 为 false。
- Error/timeout tests 继续断言 secret、base URL 和 raw provider response 不泄漏。

### Runtime/API

- Runtime `model.completed` event 断言 usage metadata 被传递，并保留 sanitized provider metadata。
- API run event persistence 断言 payload 包含 bounded usage summary，不包含 API key env value、base URL、raw model output 或 raw provider response。
- Retry path 断言 successful attempt number 与 retry event 一致；失败路径不伪造 usage summary。

### Web

- `chat-workbench` formatter 测试 `model.completed` meta 包含 provider/model/tokens/duration/streaming state。
- Alpha E2E 不要求真实 provider key；Stage 32 可更新 manual smoke 指引，真实 provider smoke 仍是 opt-in。

## 文档更新

实现阶段需要同步更新：

- `README.md` 或相关模型配置文档：说明 usage metadata、streaming capability、真实 token delta 尚未开启。
- `docs/project-roadmap.md`：Stage 32 状态、完成范围、后续 Stage 33/34 队列。
- `docs/superpowers/README.md`：新增 Stage 32 spec/plan 索引。
- `docs/agent-development-learning.md`：记录 provider usage/streaming 的 Agent 边界。
- 真实 provider smoke 指引：说明如何用 fake-fetch tests 和 opt-in real provider 验证 usage metadata。

## 验收标准

- `ModelResponse` 或等价结构可以表达 provider reported / estimated usage、total tokens、duration、attempt 和 streaming state。
- OpenAI-compatible 和 Anthropic-compatible fake-fetch tests 覆盖 provider usage metadata。
- Mock/deterministic 路径仍稳定，并明确 usage 是 estimated。
- Runtime/API run event payload 只包含 bounded usage summary，不包含 raw provider response、secret、base URL、prompt 或 raw model output。
- Web timeline 对 `model.completed` 展示 compact usage summary。
- Stage 32 文档、roadmap、Superpowers index 和 Agent 学习笔记与当前事实一致。
- 最终验证至少包含：

```bash
pnpm alpha:check
pnpm smoke
pnpm test
pnpm typecheck
pnpm build
git diff --check
```
