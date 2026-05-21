# Stage 29：Live Run Timeline and Artifact Progress v0 设计

## 背景

Stage 28 已把 LP 复杂任务改成 task-first 固定链路：同一个 `lp_generation` task 绑定 Planner、Builder、Reviewer、Deployer 的 runs、handoff、artifact workspace、deployment handoff 和 recovery facts。现在用户刷新页面后能看到完整事实，但提交“写 LP / 改 LP / 继续优化 LP”后，页面仍主要依赖一次 server action 返回结果；任务运行期间的 run timeline、artifact progress、recovery view 和 preview/export 更新不能持续反馈。

Stage 26 已经为普通聊天实现 NDJSON streaming，它解决的是 assistant text delta。Stage 29 解决的是 Agent 工作流事实的 live refresh：让 Web task panel 在不手动刷新的情况下，持续读取 repository 中的安全事实，并把 running、queued、cancelling、failed、blocked、completed、artifact workspace changes 和 recovery actions 展示给用户。

本阶段推荐先采用短轮询 polling，而不是直接新增 SSE。原因是当前事实来源已经在 repository、task state、run lifecycle、worker queue snapshot 和 artifact diff helper 中成型；polling 可以复用这些边界，最快打通 no-refresh 体验。SSE 可以在 task state delta contract 稳定后再演进。

## 目标

- Web task detail 在任务运行、取消、恢复或产物变化时，不需要用户手动刷新就能更新。
- 新增安全的 task state refresh API 或 route handler，返回当前 task 的 summary、messages、run lifecycle、recovery views、worker queue health、artifact diff 和 preview/export 所需状态。
- 前端用短轮询读取 task state fact，并把 polling result 合并到已有 workbench shell；repository 仍是事实来源，client transient state 只负责 UI 过渡。
- 对 running、queued、cancelling、failed、blocked、completed 提供一致状态表达和空状态。
- LP chain 生成新的 page version 或 artifact workspace 后，artifact preview/export 自动更新到最新 workspace-backed page version。
- interrupt/cancel 或 recovery action 执行后，UI 能区分 optimistic state 和下一轮 repository fact。
- 增加针对 ordinary chat、LP chain、artifact 更新、失败恢复核心路径的 browser/E2E 或等价集成验收入口。

## 非目标

- 不做 raw stdout/stderr streaming。
- 不做 provider token streaming；普通聊天继续使用 Stage 26/27 的 NDJSON chat stream。
- 不做 MCP/tool-call streaming。
- 不做实时多人协作、presence、collaborative cursors 或 conflict resolution。
- 不引入生产 observability stack、message broker 或 external event bus。
- 不做 object storage migration、auth/RBAC、production Postgres rollout 或 deployment runner。
- 不做通用 DAG scheduler；LP v0 仍使用固定 `Planner -> Builder -> Reviewer -> Deployer` 链路。

## 当前代码边界

- `apps/web/src/app/page.tsx` 现在在 server render 时读取 `pageState`，并把 ordinary chat streaming shell 放在页面底部。
- `apps/web/src/lib/workbench-store.ts` 已能为 task-ready 页面组装 messages、snapshot、runs、artifact diff、recovery views、worker queue state 和 interrupt control。
- `apps/web/src/app/api/chat/stream/route.ts` 只服务普通聊天文本流，不应该承载 LP chain 的 run state refresh。
- `apps/web/src/app/actions.ts` 已有 submit、interrupt、recovery server actions；这些 action 执行后仍依赖下一次页面状态读取。
- `packages/api/src/run-lifecycle.ts`、`packages/api/src/run-recovery.ts` 已能从 repository facts 派生安全 lifecycle / recovery view。
- Artifact preview/export 已能从 workspace-backed current page version 恢复，但当前 UI 需要页面重新渲染后才看到最新产物。

## 推荐架构

### 1. Task State Refresh Contract

新增一个 Web/API 层安全 contract，例如 `TaskStateRefreshPayload`。它应该复用现有 page state loader，而不是重新发明状态模型。

建议 payload 包含：

- `taskId`、`projectId`、`taskKind`、`status` 和 `updatedAt`。
- 当前 task messages 的安全列表或 latest message cursor。
- run lifecycle summary：role、state、attempt、startedAt、completedAt、safe terminal summary。
- recovery views：沿用 Stage 25 的 `RunLifecycleView` / recovery action contract。
- worker queue health：只读 safe queue status，不包含 raw payload。
- artifact progress：current page version id、artifact workspace id、manifest summary、diff metadata、preview/export version key。
- polling hints：`nextPollMs`、`isTerminal`、`stateVersion`。

Payload 不包含 raw model output、raw provider response、raw artifact content、secret、raw tool output、raw worker payload、本机路径或完整 stdout/stderr。

### 2. Polling Route

新增 route handler，例如 `GET /api/tasks/:taskId/state` 或 Next app route 的等价路径。职责：

- 从 cookie/session 和 request query 确认 current project/task ownership。
- 重新读取 repository state，并调用 Web store / service helper 派生 fresh task state。
- 支持可选 `stateVersion` / `updatedAfter` 参数，v0 可以仍返回完整 safe payload，后续再优化成 delta。
- 对 missing task、project mismatch、invalid task type 返回稳定错误码。
- 默认禁用缓存，避免浏览器或 proxy 返回旧 timeline。

v0 不需要 SSE，也不需要 server 端保持连接。

### 3. Client Polling Shell

在 Web 端新增或扩展 client component，例如 `LiveTaskStatePanel` / `TaskStatePoller`：

- 只在当前页面有 active task，且 task 非 terminal 或用户刚执行 action 后启用 polling。
- 使用 `setTimeout` 间隔轮询；避免多个并发请求重叠。
- 页面 hidden 时降低频率；terminal 后停止或改成低频一次确认。
- 请求失败时展示安全错误状态，并使用退避策略。
- 收到 payload 后更新 run timeline、recovery block、artifact diff、preview/export version key 和 worker status。

这部分不应把 repository fact 复制成新的长期 client store。刷新页面后，server-rendered state 仍是权威事实。

### 4. Timeline and Artifact Progress UI

UI 行为建议：

- Running run 显示 role、当前阶段、开始时间和安全状态文案。
- Queued / worker-backed command 显示 queue state 和最后 heartbeat summary。
- Failed / blocked 直接复用 Stage 25 recovery block，并让可执行 action 仍走 server action。
- Artifact workspace 创建后，artifact progress 从“等待 Builder 输出”变成“workspace ready”，preview/export 自动指向当前 page version。
- Reviewer blocked 时保留最新 artifact preview，但用 recovery/guidance 表示无法进入 deployment handoff。
- Deployer handoff created 后展示 export / handoff fact；不声明真实外部部署成功。

视觉上应保持 workbench 工具感：紧凑、可扫读，不做营销式 hero 或额外装饰。

### 5. Ordinary Chat Boundary

Stage 29 不替换普通聊天 streaming：

- 普通问答继续走 `/api/chat/stream` 的 NDJSON assistant delta。
- Project-bound assistant runtime 仍由 Stage 27 的 `assistant` role 负责。
- Task state polling 可以在普通聊天 terminal 后刷新 repository fact，但不负责 token delta。
- LP prompt / LP continuation 继续走 task-first server action 和 Stage 29 polling state refresh。

这能避免把“文本生成流”和“Agent 工作流事实刷新”混成同一个协议。

### 6. Error Handling

- Polling route 不信任浏览器传来的 recovery availability 或 artifact refs；每次都从 repository 派生。
- Project mismatch / task not found 返回稳定错误码，UI 显示安全提示。
- Route 读取 artifact diff/snippet 时继续使用 Stage 15/16 的 artifact reader 边界。
- Polling 失败不应清空已有 timeline；UI 保留最后一次成功 fact，并显示 refresh degraded 状态。
- Interrupt/cancel optimistic state 必须被下一轮 repository fact 校正。

## 测试策略

### API / Route Tests

- task state refresh route 返回当前 task 的 safe lifecycle、recovery、worker 和 artifact progress。
- route 对 missing task、project mismatch、invalid task id fail closed。
- payload 不包含 raw model output、raw artifact content、secret、raw worker payload 或本机路径。
- terminal task 返回 `isTerminal: true` 和合理 polling hint。

### Web Store / Client Tests

- polling helper 能把 running -> completed 的 task state 合并到页面展示。
- artifact workspace/page version 变化后 preview/export key 更新。
- interrupt/cancel optimistic state 被 repository fact 校正。
- polling failure 保留旧 fact 并显示安全错误，不覆盖 messages 或 artifact state。
- ordinary chat streaming 仍使用原 route，不被 task polling 拦截。

### E2E / Acceptance

- deterministic LP chain：提交 LP prompt 后，无手动刷新即可看到 Planner、Builder、Reviewer、Deployer 状态变化和最终 artifact preview。
- deterministic failure：构造 Planner/Builder failure 后，页面无刷新显示 recovery block。
- ordinary chat：普通问答仍流式展示回答，并在 terminal 后保留 refreshable message。
- artifact update：继续修改 LP 后，preview/export 自动更新到新 page version。

### 回归验证

- `pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/page.test.ts apps/web/src/app/actions.test.ts`
- `pnpm exec vitest run apps/web/src/app/api/chat/stream/route.test.ts apps/web/src/app/streaming-workbench.test.ts apps/web/src/app/streaming-workbench-state.test.ts`
- `pnpm exec vitest run packages/api/src/run-lifecycle.test.ts packages/api/src/run-recovery.test.ts packages/api/src/services.test.ts`
- `pnpm test`
- `pnpm typecheck`

## 验收标准

- 用户提交 LP 任务后，Web 页面不手动刷新也能看到 run timeline 和 artifact progress 更新。
- LP artifact workspace 或 page version 更新后，preview/export 指向最新 repository fact。
- failed / blocked / cancelling 状态在 live task panel 中安全表达，并继续复用 Stage 25 recovery action contract。
- ordinary chat streaming 没有回退或被 polling route 替代。
- 所有 live payload 只包含 safe summary，不泄漏 raw model output、raw artifact content、secret、raw tool output、raw worker payload 或本机路径。
- 本阶段没有引入 SSE、raw stdout/stderr streaming、MCP streaming、真实部署、auth/RBAC 或 object storage。
