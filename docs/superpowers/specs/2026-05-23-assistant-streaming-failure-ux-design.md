# Stage 38：Assistant Streaming Failure UX Hardening v0 Design

**日期：** 2026-05-23

**状态：** 设计已确认，待实施计划。

## 背景

Stage 26 已实现普通聊天的 Web/API NDJSON streaming transport。Stage 27 把 project-bound 普通聊天接入独立 `assistant` role 和真实模型 runtime。Stage 35 又把真实 provider token delta 接入普通聊天：provider delta 只作为 transient `assistant.delta` 展示，最终事实仍是完整 assistant message 和 terminal run/model events。

当前剩余问题集中在异常体验：真实 provider streaming 可能中途断开、返回空 terminal content、首个 token 很慢，或者浏览器侧取消/断开。现有路径会把这些问题大多压成通用 `generation_failed`，用户难以区分 provider 配置失败、stream 中断和持久化失败；operator 排查时也缺少统一入口。

第一版内部 alpha 不需要生产级 observability，但需要把普通聊天 streaming 的失败状态整理成清晰、可测试、不会泄漏 provider/raw payload 的 UX contract。

## 目标

1. 为普通聊天 streaming 增加更细的安全失败分类：
   - provider 配置失败，例如 missing API key、unsupported provider route。
   - provider stream 中途失败或 malformed SSE。
   - stream 结束但没有可持久化 terminal assistant content。
   - terminal assistant message 持久化失败。
   - client cancel / disconnect 不被误展示成完成。
2. Web streaming state 能保留已收到的 transient partial content，同时用明确文案说明失败类型。
3. 慢首 token 时展示“正在连接 provider / 正在生成回复”这类中间状态，而不是空白 assistant turn。
4. 刷新后仍以 repository terminal message、run record 和 run event 为准；transient chunks 不成为事实源。
5. operator docs 说明 ordinary chat streaming failure 的排查入口，并继续要求不收集 secret、raw provider response、本机路径或完整 artifact 内容。

## 非目标

- 不做 MCP streaming、tool-call streaming、raw stdout/stderr streaming 或 worker log streaming。
- 不做真实 fallback provider execution、billing/quota、provider cost ledger、hosted observability 或 retry queue。
- 不改变 LP Planner / Builder 的 complete-buffer structured output parse / repair 边界。
- 不把 token chunk 写入 run event、message、artifact 或 business output。
- 不引入真实 provider 自动化 E2E gate；默认 `pnpm test`、`pnpm alpha:check`、`pnpm smoke` 和 `pnpm alpha:e2e` 继续 deterministic/no-key。

## 方案

### 1. Stream error contract

扩展 Web/API `ChatStreamEvent` 的安全错误码，但保持 payload bounded：

- `provider_configuration_failed`：模型 provider 或 route 配置不可用，例如 key 缺失。消息只说明配置问题，不暴露 env value、secret、base URL 或 raw provider body。
- `stream_interrupted`：provider stream 中途失败、malformed SSE、网络中断或 runtime stream 没有 terminal event。
- `empty_response`：stream 完成但 terminal content 为空或全 whitespace。
- `persistence_failed`：assistant terminal content 已生成，但写入 repository 失败或 stale placeholder 校验失败。
- `generation_failed`：无法可靠分类时的保守 fallback。

API route 负责把 service/runtime failure 映射到这些 UI-safe code。client 只消费 code、message 和 `run.status` label，不解析 raw provider/runtime error。

### 2. Service/runtime boundary

`DemoWorkbenchService.runAssistantChatStream()` 仍返回 project/task context summary 和 provider delta stream。streaming runtime 必须保证：

- `model.delta` 可以 yield 给 UI，但不会保存为 run event。
- terminal `model.completed` / `run.completed` 只在完整 terminal content 通过校验后保存。
- provider stream failure、missing terminal event 或 empty content 会保存安全 `run.failed` / `model.fallback.*` 等 terminal events，且不会把 partial delta 当成 assistant message。
- client cancel / disconnect 不应把 partial content 持久化为完成消息。v0 可以把已启动 run 记录为安全失败或取消状态，但不需要跨 provider adapter 做完整网络 abort 语义。

### 3. Web state and copy

Web streaming reducer 增加可展示的 status label / error code：

- 收到 `run.status` running label 时，assistant turn 即使没有 delta 也显示中间状态，用于慢首 token。
- 收到 `assistant.delta` 后持续追加 transient content。
- 收到 typed `error` 后保留 partial content，展示对应安全文案。
- 收到 `assistant.completed` 后替换为 terminal content，并刷新读取 repository fact。
- refresh 后 completed / fallback transient state 清空；error transient state 保留当前页面提示，但 repository 仍是最终事实源。

文案保持短句，不把用户导向 raw log。中文/英文 copy 由现有 `i18n` 字段扩展或复用。

### 4. Docs and operator flow

`docs/real-provider-alpha-smoke.md` 增加 ordinary chat streaming failure 排查入口：

- missing key / route 配置看 Models provider route 和 `.env.local`。
- stream interrupted / empty response 看 provider 是否支持 SSE、API protocol 是否匹配、fake-provider regression 是否通过。
- persistence failed 看本地 repository backend 和 Web server log summary。
- 反馈仍使用 `docs/alpha-release-candidate.md` 的 safe evidence 模板。

## 测试策略

### API/service tests

- provider-backed assistant stream 在 missing key 时 fail closed，返回 typed provider configuration failure，不执行 fake fetch，不泄漏 key/env/base URL。
- provider stream yield partial delta 后失败时，run terminal event 是 safe failure，UI stream 收到 `stream_interrupted`，assistant placeholder 不被完整持久化。
- provider stream 完成但 terminal output 为空时，返回 `empty_response`，不把空 assistant message 当成功。
- persistence reject 或 stale placeholder 时返回 `persistence_failed`。
- client cancel / reader cancel 不产生 unhandled rejection，不把 partial content 当 completed event。

### Web tests

- `decodeChatStreamLines()` 接受新增 typed error code，拒绝未知 code。
- streaming reducer 在 running status label、partial delta 和 typed error 组合下保留 partial content 并展示安全错误。
- streaming workbench 在慢首 token 时渲染 status-only assistant turn。
- existing fallback-required 和 deterministic success tests 保持通过。

### Verification

最终实现至少运行：

```bash
pnpm alpha:check
pnpm smoke
pnpm test
pnpm typecheck
pnpm build
pnpm alpha:e2e
git diff --check
```

如 `pnpm alpha:e2e` 因本地 sandbox 端口或 browser install 限制失败，应按失败原因重跑或说明限制。

## 文档更新

实现阶段需要同步更新：

- `docs/agent-development-learning.md`：补充 transient token delta、terminal facts 和 streaming failure 分类的边界。
- `docs/project-roadmap.md`：Stage 38 状态、完成范围、Stage 39/40/后续推荐队列。
- `docs/superpowers/README.md`：新增 Stage 38 spec/plan 索引。
- `docs/real-provider-alpha-smoke.md`：新增 ordinary chat streaming failure 排查入口。
