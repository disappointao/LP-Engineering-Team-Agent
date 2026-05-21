# Stage 27：Real Chat Runtime and Skill Context v0 设计

## 背景

Stage 26 已完成普通聊天的 Web/API streaming transport：`/api/chat/stream` 能创建或复用 `general_chat` task，持久化 user / assistant message，并通过 NDJSON event stream 把 assistant delta 展示到页面。当前 assistant 内容仍是 deterministic 文案。

用户对“第一版可用”的定义已经收敛为：网页和接口完全打通，能正常聊天，能处理写 LP / 改 LP 等复杂工作流任务，并且回答有流式反馈。Stage 27 只解决第一段能力：普通聊天从 deterministic answer 升级到项目范围内的真实 model runtime，并把已发布、已绑定的 project skills 作为上下文进入模型。LP agent chain end-to-end 留到 Stage 28。

## 目标

- 新增普通聊天专用的 `assistant` agent/model role，避免复用 `planner` 路由造成语义混淆。
- `REAL_MODEL_RUNTIME=1` 且项目配置了真实 `assistant` model route 时，普通聊天通过 provider-backed runtime 生成 assistant answer。
- 默认开发和测试路径继续 deterministic / mock，不要求本地必须配置真实 provider。
- 已发布、已绑定到当前 project 的 skills 进入普通聊天 Context Pack，并以 bounded prompt context 形式提供给模型。
- UI 只展示安全 context summary，例如当前 project、skill 数量和 skill 名称，不展示 skill raw content、secret、raw provider response 或工具输出。
- 模型配置错误、provider 临时错误、retry exhausted、fallback metadata、用户中断等状态写入安全 run events，并能被 Web timeline / recovery view 解释。
- 复用 Stage 26 streaming 边界：provider 仍先返回完整文本，服务端再切成 `assistant.delta`；真实 provider token streaming 后置。

## 非目标

- 不实现 `Planner -> Builder -> Reviewer -> Deployer` LP chain end-to-end；Stage 28 单独处理。
- 不做 MCP execution、tool-call protocol conversion、MCP worker execution 或 write tools。
- 不升级长期 memory、vector retrieval 或 persistent summary repository。
- 不开放真实 shell runner、真实 deployment runner 或强 sandbox。
- 不做真实 provider token streaming、usage/cost reporting 或自动 fallback provider execution。
- 不做 production auth/RBAC、object storage 或 Postgres production rollout。

## 当前代码边界

Stage 27 会建立在这些现有边界上：

- `packages/model-gateway/src/index.ts` 当前 `AgentRole` 只有 `planner | builder | reviewer | deployer`，`createDefaultModelPolicy()` 和 policy clone 也写死这四个角色。
- `packages/lp-schema/src/index.ts` 的 `AgentRoleSchema` 同样只包含四个 LP chain role。
- `packages/api/src/run-orchestrator.ts` 的 `runAgentStep()` role 类型只允许四个 LP chain role，但它已经负责 Context Pack assembly、run persistence 和 run event persistence。
- `DemoWorkbenchService.createRuntimeContext()` 已能加载 project skills、visible MCP tools、model routing policy 和 artifact workspace，但它的 role 类型还不包含 `assistant`。
- `assembleContextPack()` 已能把 runtime context、memory、handoffs、artifact snippets 和 trace 组合成可审计 Context Pack。
- Provider adapters 当前只把 `request.prompt` 发给模型；`request.context` 主要用于 audit / runtime metadata，没有自动拼进 provider prompt。因此 Stage 27 必须为普通聊天显式构造 bounded assistant prompt。
- `apps/web/src/lib/workbench-store.ts` 的 `startStreamingChatPrompt()` 当前生成 deterministic assistant content，并把内容切成 delta。
- `/api/chat/stream` 负责 stream transport、cookie 更新和 terminal persistence，但不直接运行真实 model runtime。

## 推荐架构

### 1. 新增 `assistant` role

把 `assistant` 作为一等 `AgentRole`：

```ts
type AgentRole = "assistant" | "planner" | "builder" | "reviewer" | "deployer";
```

需要同步更新：

- `packages/lp-schema` 的 `AgentRoleSchema`。
- `packages/model-gateway` 的 `AgentRole`、`agentRoles`、`createDefaultModelPolicy()`、policy clone / audit 逻辑。
- `packages/runtime-adapters` 的 `RuntimeRunRequest`、event role 类型和 `cloneModelRoutingPolicy()`。
- `packages/api` 的 `normalizeAgentRole()`、model route resolution、`createRuntimeContextForRole()`、`runAgentStep()` role 类型。
- Web Models 文案和 route 配置 UI，显示 `Assistant / Chat` 路由。

数据库 `ModelRoutingPolicy.role`、`Run.role` 和 event payload 当前是 string 字段，不需要 Prisma enum migration。

默认 policy 增加 mock assistant route，例如：

```ts
assistant: { provider: "mock-openai", model: "assistant-model" }
```

当 `REAL_MODEL_RUNTIME=1` 且 provider-backed gateway 禁用 mock route 时，项目必须配置真实 `assistant` route；否则普通聊天应 fail closed，并写入可解释的 run events。

### 2. API service 增加普通聊天 runtime 方法

在 `DemoWorkbenchService` 增加面向 Web store / streaming route 的方法，例如 `runAssistantChat()`。

职责：

- 校验 project 存在；真实模型聊天 v0 只支持 project-bound chat。
- 为当前 task 创建 `assistant` run id，例如 `run_assistant_<taskId>_<attempt>`。
- 调用 `runAgentStep()`，role 为 `assistant`，复用 Context Pack assembly、run persistence 和 run event persistence。
- 对 `assistant` role 不执行 `LPBriefSchema` 或 `StaticArtifactsSchema` parse；模型输出是普通文本。
- 在 runtime completed 后返回 sanitized assistant text、run id、run state、safe events summary 和 context summary。
- 在 runtime failed / cancelled 时返回稳定错误码，不把 provider exception message、raw response 或 secret 暴露给 Web stream。

Projectless 普通聊天保留 Stage 26 的 deterministic / no-context 行为，不在 Stage 27 强制创建隐式 project。这样可以避免在没有 project provider、skills 和 route 配置时引入不透明的全局模型配置。

### 3. Assistant prompt 组装

因为当前 provider adapters 只发送 `request.prompt`，Stage 27 需要为普通聊天构造一个 bounded textual prompt，而不是假设 `request.context` 会被 provider 自动读取。

推荐新增 assistant-specific prompt builder：

- 输入用户本轮 message、当前 project 摘要、最近 task messages 的 bounded preview、Context Pack trace、runtime skills、memory summary 和 artifact metadata summary。
- 输出一个单一 prompt 字符串，包含明确行为边界：
  - 你是 LP Engineering Team Agent 的普通聊天 assistant。
  - 回答用户问题；如果用户要求创建或修改 LP，应说明可以继续并由后续 LP workflow 处理，不在普通聊天路径伪造 artifact。
  - 可以参考列出的 project skills，但不要向用户逐字泄露 skill 原文，除非用户明确要求且内容本身不是 secret。
  - 不声称已经执行 MCP、shell、deployment 或 artifact 修改。
- 严格限制 prompt 中的 skill content 和 message preview 长度，优先保留 skill name、version、entrypoints 和短内容片段。

这个 prompt builder 只用于 `assistant` role。Planner / Builder 的 structured prompt 不在 Stage 27 顺手重构，避免影响已有 LP structured output 行为。

### 4. Web streaming route 复用 Stage 26 event contract

Stage 27 不改变 Stage 26 的基本流式协议，只扩展安全 context/run summary：

```ts
type ChatStreamEvent =
  | ExistingStage26Events
  | {
      type: "context.summary";
      taskId: string;
      projectId?: string;
      projectName?: string;
      skillCount: number;
      skills: Array<{ id: string; name: string; version: string }>;
    };
```

推荐执行顺序：

1. route / store 校验 prompt，并确认是 `general_chat`。
2. 创建或复用 chat task，持久化 user message 和 assistant placeholder。
3. 如果没有 project：走 deterministic answer，stream `context.summary` 中 `skillCount: 0`。
4. 如果有 project：调用 `DemoWorkbenchService.runAssistantChat()`。
5. route 先发送 `task.created`、`context.summary`、`run.status: running`。
6. runtime 返回完整 assistant text 后，route 切成 `assistant.delta`。
7. terminal persistence 成功后发送 `assistant.completed` 和 `run.status: completed`。
8. runtime failure 时发送稳定 `error` event，并让 repository 中的 run events / recovery view 成为解释来源。

v0 不做 provider token streaming。即使真实 provider 返回完整文本，用户仍能通过 Stage 26 的 chunking 看到渐进式 UI。

### 5. 错误、retry、fallback 和取消

`assistant` role 应复用 Stage 21 的 provider error 分类：

- transient provider request error：bounded retry，写入 `model.retry.scheduled` / `model.retry.exhausted`。
- configuration error：fail closed，写入 `run.failed` 和安全 error code。
- fallback route 已配置：写入 `model.fallback.available` metadata，但 v0 不自动调用 fallback provider。
- fallback 未配置：写入 `model.fallback.not_configured`。
- mock route 在 real runtime 中被禁用：作为配置错误展示给用户，提示需要配置真实 Assistant route。

取消语义保持 v0：

- 浏览器中断 stream 时，client 可以立即展示 interrupted state。
- 如果服务端尚未开始 provider call，可以把 run 标记为 `cancelled` 并写入新增的安全 `run.cancelled` event。
- 如果 provider call 已经 in-flight，Stage 27 不承诺强制中断远端请求；最终 repository fact 以 runtime 完成或失败事件为准。
- 真正跨 gateway 的 `AbortSignal` 和 provider request cancellation 可以在后续 model streaming / cancellation 阶段补齐。

### 6. UI context summary

Web 需要让用户知道普通聊天当前用了什么上下文，但不能展示 raw context。

最小展示：

- 当前 project 名称；没有 project 时显示 no project context。
- 已注入 skill 数量。
- skill 名称和版本的短列表。
- real runtime / deterministic path 的安全状态文案。

不展示：

- skill raw content。
- model provider secret、API key env value。
- raw model response。
- raw run event payload。
- raw tool output。
- 完整 artifact 文件内容或本机路径。

## 测试策略

### Model gateway / runtime tests

- `agentRoles` 和 `createDefaultModelPolicy()` 包含 `assistant`。
- `InMemoryModelGateway` 能完成 `assistant` request，并记录 audit context。
- `ProviderBackedModelGateway` 在 real runtime 禁用 mock route 时，对 mock `assistant` route fail closed。
- `LocalAgentRuntimeAdapter` 能运行 `assistant` role，不生成 artifacts、review findings 或 LP parse events。
- runtime / run orchestrator 能持久化 `assistant` 的 `run.cancelled` event，并把 run state 映射为 `cancelled`。
- `RuntimeRunContext.modelRoutingPolicy` clone 保留 `assistant` route。

### API tests

- `resolveModelRoutingPolicyForProject()` 返回包含 `assistant` 的 policy，并允许项目覆盖 assistant route。
- `createRuntimeContextForRole()` 对 `assistant` 注入已发布、已绑定 project skills。
- `runAgentStep()` 支持 `assistant` role，并持久化 run、runtime.context.loaded、model.completed、run.completed。
- `runAssistantChat()` 把 bounded skill context 放进 assistant prompt，UI summary 只含安全 metadata。
- model failure / retry exhausted / fallback metadata 在 run events 中可见，Web error 只返回稳定错误码。

### Web route / store tests

- project-bound ordinary chat 在 `REAL_MODEL_RUNTIME=1` fake provider 下返回模型文本，并通过 Stage 26 delta stream 展示。
- project-bound ordinary chat 返回 `context.summary`，只包含 project 和 skill metadata。
- projectless ordinary chat 保持 deterministic answer，`skillCount` 为 0。
- provider config 缺失或 mock route 被 real runtime 禁用时，stream 返回安全 `generation_failed`，run timeline 有失败解释。
- LP prompt 仍走 Stage 26 fallback，不在 Stage 27 普通聊天 route 中执行 LP chain。

### UI tests

- Models UI 展示 `Assistant / Chat` route，并能保存 project assistant route。
- Chat UI 显示 project / skill context summary。
- Streaming assistant bubble 仍按 delta 更新，terminal refresh 后回到 repository facts。
- Error state 不展示 raw provider details，也不清空用户输入。

### 回归验证

- `pnpm exec vitest run packages/model-gateway/src/index.test.ts packages/runtime-adapters/src/index.test.ts`
- `pnpm exec vitest run packages/api/src/model-routing.test.ts packages/api/src/context-assembler.test.ts packages/api/src/run-orchestrator.test.ts`
- `pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/api/chat/stream/route.test.ts apps/web/src/app/page.test.ts`
- `pnpm test`
- `pnpm typecheck`

## 验收标准

- 配置 project `assistant` route 并开启 `REAL_MODEL_RUNTIME=1` 后，普通聊天通过真实 provider 返回 assistant answer。
- 未开启 `REAL_MODEL_RUNTIME` 时，普通聊天仍可通过 deterministic / mock path 运行测试。
- 已发布、已绑定的 project skills 会进入普通聊天 Context Pack，并能在 fake provider request 中观察到 bounded prompt context。
- Web 上能看到当前 project / skill context summary。
- provider 配置错误、临时错误 retry、retry exhausted 和 fallback metadata 都有安全 run events。
- 页面 refresh 后 user / assistant messages 和 run timeline 仍以 repository fact 为准。
- LP generation、MCP execution、真实 deployment 和 shell execution 行为不被 Stage 27 意外改变。
