# Model Repair、Retry 和 Fallback v0 Design

## 目的

Stage 21 目标是在真实模型 runtime 已能生成结构化 Planner brief 和 Builder static artifacts 的基础上，增加第一版 **受控 repair / retry / fallback metadata**。

当前 Planner / Builder 的真实模型输出已经 fail closed：模型文本只在内存中解析，成功后保存结构化业务对象，失败后写入脱敏 `model.output.parse_failed` 和 `run.failed`。这是正确的安全基线。Stage 21 v0 不改变 fail-closed 原则，而是在失败前增加有限自我修复和 provider 临时错误重试，并把 fallback route 作为可审计 metadata 暴露出来。

这一阶段不做 streaming、不做 tool-call conversion、不做自动 provider marketplace，也不静默切换到 deterministic mock output。所有增强都必须让 run timeline 看得见，且不能把 raw model output、prompt secrets、provider base URL、API key env name 或 artifact content 写入持久事件。

## 当前基线

已有能力：

- `packages/model-gateway` 已有 `ProviderBackedModelGateway`、`openai-completions`、`anthropic-messages` adapter，以及 `ModelProviderConfigurationError`、`ModelProviderRequestError`、`ModelProviderResponseError`。
- `packages/api` 在 `REAL_MODEL_RUNTIME=1` 下让 Planner 使用 `LPBriefSchema` parse，Builder 使用 `StaticArtifactsSchema` parse 和 artifact policy validation。
- parse 成功会写 `model.output.parsed`；parse 失败会写 `model.output.parse_failed` 和 `run.failed`，且不保存 raw model text。
- `ModelRoutingPolicyRecord` 已有 `fallback` 字段，但当前 `resolveModelRoutingPolicyForProject()` 不把 fallback 变成执行行为。
- run lifecycle 已能把 model parse failure 作为安全 diagnostic source。

缺口：

- Planner / Builder parse 失败后没有 one-shot repair loop。
- provider timeout、429、5xx、网络失败等临时错误没有 bounded retry policy。
- route fallback metadata 没有明确的 runtime 表达，也没有失败时的可见事件。
- 当前失败路径只有最终失败结果，缺少“尝试过 repair / retry，但仍失败”的审计线索。

## 范围

### Goals

- 为 Planner `LPBriefSchema` parse failure 增加 one-shot repair。
- 为 Builder `StaticArtifactsSchema` parse / artifact policy failure 增加 one-shot repair。
- 为真实 provider 临时错误增加 bounded retry classification。
- 记录 sanitized repair / retry / fallback events。
- 将 route fallback 配置解析为安全 metadata，使 runtime 和 event 能说明 fallback 是否可用。
- 保持 deterministic 默认 runtime 不受影响；只有 `REAL_MODEL_RUNTIME=1` 的真实模型路径启用 Stage 21 行为。

### Non-Goals

- 不做 streaming model output。
- 不做 tool-call conversion。
- 不做自动 provider marketplace。
- 不自动调用 fallback provider。
- 不静默回退到 deterministic `sampleBrief` 或 deterministic artifacts。
- 不保存 raw model output、raw repair output、raw prompt、provider base URL、API key env name 或完整 artifact 内容。
- 不引入多轮自我修正；v0 只允许 one-shot repair。
- 不做 Web UI 大改版；已有 timeline / lifecycle 能看到事件即可。

## 设计决策

### 1. repair 由 API 拥有，不由 model-gateway 隐式处理

`model-gateway` 只负责完成一次模型请求并返回文本或 provider 错误。结构化输出是否需要 repair 是业务 schema 语义，必须留在 `packages/api`。

Stage 21 v0 建议新增 API-owned helper：

```ts
interface StructuredModelRepairInput {
  role: "planner" | "builder";
  schema: "LPBriefSchema" | "StaticArtifactsSchema";
  originalPrompt: string;
  failure: {
    reason: string;
    policyCode?: string;
    issueCount?: number;
    firstIssuePath?: string;
    firstIssueCode?: string;
  };
}
```

helper 只生成 repair prompt，不保存 raw output。repair prompt 可以包含：

- 原始业务 prompt 或 brief JSON source；
- schema compact guide；
- parse failure 的安全摘要；
- “只输出一个 JSON object，不要 Markdown fences，不要解释文字”的约束。

repair prompt 不包含首次 raw model output。这样牺牲一点修复能力，但避免把可能含 secret 或 artifact content 的模型文本扩散到第二次请求和持久事件。

### 2. repair 是 one-shot，且必须可见

Planner / Builder 首次 parse 失败时：

1. 写入 `model.output.parse_failed`，payload 只包含 schema、reason、policyCode、issueCount、firstIssuePath、firstIssueCode。
2. 写入 `model.output.repair_started`。
3. 使用同一 role、同一 project、同一 resolved route 发起一次 repair 模型请求。
4. repair 输出再次走同一个 parser / policy validator。
5. repair 成功写入 `model.output.repaired`，并继续保存 brief 或 page version。
6. repair 失败写入 `model.output.repair_failed` 和 `run.failed`。

`model.output.parse_failed` 不再必然 terminal。它表示一次模型输出解析失败；是否 terminal 由后续 `model.output.repaired` 或 `model.output.repair_failed` 决定。

### 3. provider retry 是有限、分类明确的

Stage 21 v0 只重试真实 provider 临时错误：

- `ModelProviderRequestError` 且 code 为 `model_provider_request_timeout`。
- `ModelProviderRequestError` 且 code 为 `model_provider_request_failed`。
- `ModelProviderRequestError` 且 code 为 `model_provider_http_error` 且 status 为 `429` 或 `500-599`。
- `ModelProviderResponseError` 且 code 为 `model_provider_response_json_invalid`。

不重试：

- `ModelProviderConfigurationError`。
- provider disabled / protocol mismatch / config missing / mock route disabled。
- HTTP `400-499`，但 `429` 除外。
- schema parse failure 和 artifact policy violation 本身。
- local deterministic runtime。

默认 retry budget 为一次重试。未来可以把 budget 放进 route settings；v0 先用固定值保持行为 deterministic。

每次 retry 必须写安全事件：

- `model.retry.scheduled`：包含 role、attempt、maxAttempts、errorCode、retryable、status（如有）。
- `model.retry.exhausted`：最终仍失败时记录，不包含 error message 原文。

### 4. fallback v0 只暴露 metadata，不执行切换

`ModelRoutingPolicyRecord.fallback` 目前已存在，但还不是执行语义。Stage 21 v0 把它规范为 `ModelFallbackRouteMetadata`：

```ts
interface ModelFallbackRouteMetadata {
  provider: string;
  providerName?: string;
  api?: ModelProviderApi;
  model: string;
  baseUrlConfigured: boolean;
  apiKeyEnvConfigured: boolean;
}
```

`resolveModelRoutingPolicyForProject()` 可以在主 route 上附带安全 fallback metadata，前提是 fallback provider 属于同一 project 且 enabled。metadata 不包含 base URL、API key env name、headers 或 secrets。

当真实 provider 最终失败时：

- 如果 fallback metadata 可用，写 `model.fallback.available`。
- 如果没有 fallback 或 fallback provider 无效，写 `model.fallback.not_configured`。

v0 不自动调用 fallback provider。这样可以让用户和后续 recovery UI 知道“有备用 route”，但不会隐藏原始失败或改变产物来源。

### 5. 事件 payload 必须只保存安全摘要

新增事件建议：

- `model.output.repair_started`
- `model.output.repaired`
- `model.output.repair_failed`
- `model.retry.scheduled`
- `model.retry.exhausted`
- `model.fallback.available`
- `model.fallback.not_configured`

所有 payload 只允许：

- role
- schema
- attempt / maxAttempts
- provider id / providerName / api / model
- baseUrlConfigured / apiKeyEnvConfigured
- errorCode
- status
- parse reason / policyCode / issueCount / firstIssuePath / firstIssueCode
- parsed success summary（title、sectionCount、productCount、artifact byte counts 等既有安全摘要）

不得保存：

- raw model output。
- raw repair output。
- raw prompt 或完整 user request。
- provider base URL。
- API key env name 或 header names。
- secret value。
- complete artifact content。
- local path。

### 6. 与 run lifecycle 的关系

run lifecycle 需要把 Stage 21 事件解释为一条清晰失败链：

- 有 `model.output.repaired` 时，最终 run 可以是 completed。
- 有 `model.output.repair_failed` 或 `model.retry.exhausted` 后的 `run.failed` 时，diagnostic source 仍应是 model parse / provider failure 的安全摘要。
- `model.fallback.available` 是 recovery hint，不是成功信号。

Stage 21 不实现点击 retry / resume 的 UI。它只让失败原因和可用 fallback 进入 timeline / lifecycle，为后续 recovery UI 做准备。

## 运行时行为

### Planner repair

首次 Planner 输出失败时：

- `invalid_json`：repair prompt 强调只输出 JSON object。
- `schema_invalid`：repair prompt 加入 first issue path / code 和 `LPBriefSchema` guide。
- `empty_output`：repair prompt 要求重新生成完整 LP brief。

repair 成功后保存 `BriefRecord`，并继续写 Planner -> Builder handoff。repair 失败后不保存 brief。

### Builder repair

首次 Builder 输出失败时：

- `invalid_json` / `schema_invalid`：repair prompt 强调只输出 `{ indexHtml, stylesCss, scriptJs }`。
- `policy_violation`：repair prompt 加入安全 policyCode，例如 `external_script_blocked`。
- `empty_output`：repair prompt 要求重新生成三文件静态 artifact JSON。

repair 成功后仍必须重新经过 artifact policy validation，成功才保存 page version 和 artifact workspace。repair 失败后不保存 page version，也不保存 artifact workspace。

### Provider retry

真实 provider call 通过一个小的 retry wrapper 执行。wrapper 只围绕模型请求，不围绕 repository writes。repository event 写入必须按实际尝试结果顺序发生，避免 retry 后重复创建业务对象。

## 错误处理

- repair 模型调用本身发生可重试 provider error 时，可以复用同一个 provider retry budget。
- repair 调用发生不可重试 provider error 时直接失败。
- 首次 parse failure 和 repair parse failure 都不能把 raw output 放入 error message 或 event payload。
- 如果 repair 成功，首次 parse failure 仍保留在 timeline，因为它是这次 run 的真实历史。
- 如果 retry 后成功，retry event 仍保留在 timeline，因为它解释了额外延迟和 provider instability。

## 测试策略

核心测试：

- Planner 首次返回 invalid JSON，repair 返回有效 `LPBriefSchema`，最终保存 brief，并写 `model.output.parse_failed`、`model.output.repair_started`、`model.output.repaired`、`run.completed`。
- Planner repair 仍失败时不保存 brief，写 `model.output.repair_failed` 和 `run.failed`，不泄漏 raw model output。
- Builder 首次违反 static artifact policy，repair 返回合规 artifacts，最终保存 page version 和 artifact workspace。
- Builder repair 仍违反 policy 时不保存 page version / artifact workspace。
- provider timeout / 429 / 5xx / request failed 会按固定 budget 重试，并写 `model.retry.scheduled`。
- provider configuration error、disabled provider、protocol mismatch、HTTP 400 不重试。
- retry exhausted 后写 `model.retry.exhausted` 和安全 terminal failure。
- fallback metadata 可用时失败路径写 `model.fallback.available`，但不会自动调用 fallback provider。
- fallback provider 无效或未配置时写 `model.fallback.not_configured`。
- 所有 repair / retry / fallback events 不包含 raw output、secret、base URL、API key env name、artifact content 或本机路径。
- 默认未设置 `REAL_MODEL_RUNTIME=1` 时 deterministic tests 不受 repair / retry / fallback 行为影响。

## 文档和后续

Stage 21 design 确认后更新：

- `docs/project-roadmap.md`：Stage 21 状态改为 design confirmed，并加入设计链接。
- `docs/agent-development-learning.md`：记录 model repair / retry / fallback 的安全边界。
- `docs/superpowers/README.md`：加入本 spec 阅读顺序。

后续阶段可以拆分为：

- Model Fallback Execution v1：真正调用 fallback provider，但必须保留原始失败和产物来源。
- Web Recovery UI：展示 retry / fallback hints，并允许用户显式重跑。
- Streaming Model Output：独立设计流式事件和 partial output redaction。
- Tool-call Protocol Conversion：把 provider tool call 差异转换到项目自己的 tool boundary。
