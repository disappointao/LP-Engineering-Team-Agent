# Stage 26：Streaming Chat Transport and UI v0 设计

## 背景

用户重新定义“第一版可用”为 Web/API/Skill/LP 工作流闭环：页面能正常问答，回答支持流式展示，后续能继续接真实模型、LP agent chain 和 skill 工作流。当前 Web workbench 已有 task、message、run event、recovery view、artifact workspace 和 server action 提交流程，但普通聊天仍是提交表单后 redirect/revalidate 的刷新式体验。

Stage 26 只解决第一段实时体验：普通聊天的 streaming transport 和 Web UI 状态。它为 Stage 27 的真实聊天 runtime、Stage 28 的 LP agent chain 进度、Stage 29 的 live run timeline 留出统一事件边界，但不在本阶段实现这些大能力。

## 目标

- 新增 Web/API streaming 边界，让普通聊天能在页面里看到 assistant answer 逐步出现。
- 保留现有 `submitPromptAction` 作为稳定 fallback；LP generation 和 non-JS 表单路径暂不强制迁移。
- streaming 完成后，repository 里的 task/message 仍是刷新恢复和历史展示的事实来源。
- stream event 只暴露安全 UI payload，不泄露 raw model response、secret、raw tool output、完整 artifact 内容或本机路径。
- deterministic test path 可把完整 assistant 文本切成 delta；真实 provider streaming 留到 Stage 27 或后续 provider adapter 阶段。

## 非目标

- 不改完整 `Planner -> Builder -> Reviewer -> Deployer` LP agent chain。
- 不做真实 provider token streaming；provider 不支持 streaming 时本阶段仍允许 simulated chunking。
- 不做 MCP、tool-call streaming、write tools 或 shell execution。
- 不做 raw stdout/stderr streaming。
- 不引入 auth/RBAC、production deployment、object storage 或多人实时协作。
- 不把所有 Web task state 改成实时同步；Stage 29 再统一 run timeline / artifact progress。

## 当前代码边界

当前 Web 提交路径是：

1. `apps/web/src/app/page.tsx` 的 composer form 调用 `submitPromptAction`。
2. `apps/web/src/app/actions.ts` 读取当前 project/task cookie，调用 `store.submitTaskPrompt()`。
3. `apps/web/src/lib/workbench-store.ts` 根据 prompt 分类：
   - `general_chat` 保存 user/assistant message；
   - `lp_generation` 同步调用 `DemoWorkbenchService.createBriefFromPrompt()`、`generatePageVersion()`、`reviewPageVersion()`，然后保存 task snapshot。
4. 页面通过 `getPageState()` 读取 task、messages、run events、recovery 和 artifact diff。

这个路径适合作为 fallback，但不适合 streaming，因为 Next server action 的 redirect/revalidate 语义会在响应结束后才更新页面。Stage 26 应新增并行的 route handler，而不是直接替换现有 server action。

## 推荐架构

### 1. Streaming route handler

新增 `apps/web/src/app/api/chat/stream/route.ts`，只处理普通聊天 streaming。

Route 输入：

- `prompt`：用户输入，使用现有 `validatePromptInput()` 语义。
- `projectId?`：可选当前项目；服务端仍要校验项目存在。
- `implicitProjectName?`：保留字段，但 Stage 26 的 streaming route 不自动跑 LP generation。
- `taskId?`：可选继续当前 task；如果缺失则创建新的 `general_chat` task。

Route 输出使用 newline-delimited JSON 或 SSE。推荐 v0 用 NDJSON，因为 fetch stream 测试更简单，格式也足够稳定。

每一行是一个 `ChatStreamEvent`：

```ts
type ChatStreamEvent =
  | {
      type: "task.created";
      taskId: string;
      projectId?: string;
    }
  | {
      type: "assistant.delta";
      taskId: string;
      messageId: string;
      delta: string;
    }
  | {
      type: "assistant.completed";
      taskId: string;
      messageId: string;
      content: string;
    }
  | {
      type: "run.status";
      taskId: string;
      state: "queued" | "running" | "completed" | "failed";
      label: string;
    }
  | {
      type: "fallback.required";
      reason: "unsupported_task_type";
      taskType: "lp_generation" | "project_setup";
      message: string;
    }
  | {
      type: "error";
      code: "prompt_required" | "project_not_found" | "generation_failed";
      message: string;
    };
```

v0 不把 event schema 写进数据库。它是 Web transport contract，repository 仍保存最终 task/message/run facts。

### 2. Store 层新增普通聊天 streaming helper

在 `apps/web/src/lib/workbench-store.ts` 增加面向 route 的 helper，例如 `startStreamingChatPrompt()` 或 `submitChatPromptForStreaming()`。

职责：

- 使用现有 `validatePromptInput()`、`classifyTaskPrompt()`、`deriveTaskTitle()`。
- 如果 prompt 被分类为 `lp_generation` 或 `project_setup`，v0 不通过 streaming route 执行该任务，返回 `fallback.required`。client 收到后设置一次性 fallback 标记并调用原 form 的 `requestSubmit()`，让现有 `submitPromptAction` 处理。
- 创建或复用 `general_chat` task。
- 先保存 user message。
- 生成 assistant final content。
- 把 final content 切成小 delta 输出给 route。
- 完成后保存 assistant message。

本阶段的 assistant content 可以继续沿用 deterministic 文案，例如“我创建了一个任务线程，可以继续从这里开始。”。Stage 27 再把这个 helper 的回答来源换成真实模型 runtime，并继续复用同一 stream event contract。

### 3. Client composer 增强

把 workbench composer 的交互增强为 client-side streaming，但保留现有 `<form action={submitPromptAction}>` fallback。

建议拆出 `apps/web/src/app/chat-composer.tsx`：

- 有 JavaScript 时拦截 submit，调用 `/api/chat/stream`。
- 发送时显示 `sending` / `streaming` 状态，禁用重复提交。
- 收到 `task.created` 后更新当前本地 task id；完成后可用 `router.refresh()` 读取 repository facts。
- 收到 `assistant.delta` 时把 delta 追加到本地临时 assistant bubble。
- 收到 `assistant.completed` 后保留最终文本，并触发 refresh。
- 收到 `error` 时显示安全错误，保留用户输入便于重试。

页面首屏仍由 `getPageState()` server-render；client streaming 只处理“当前刚发送的一轮”的临时状态。刷新后以 repository 的 messages 为准。

### 4. 安全和数据边界

- stream payload 只允许 `taskId`、`messageId`、状态 label、assistant text delta 和稳定错误码。
- 不在 stream 中传 raw provider response、raw run event payload、raw tool output、secret、完整 artifact 内容或本机路径。
- route 不信任浏览器提交的 project/task 归属；继续用 repository 校验。
- task/message 保存失败时必须输出 `error`，不能只在客户端伪造完成状态。
- 如果客户端中断 fetch，本阶段可以停止继续发送 delta；已经保存的 user message 保留，assistant message 只在 final content 准备完成后保存。

## 交互行为

普通聊天成功路径：

1. 用户在 composer 输入问题。
2. UI 立即显示 user bubble 和空的 assistant bubble。
3. route 创建或复用 `general_chat` task，写入 user message。
4. route 输出 `task.created` 和 `run.status: running`。
5. route 输出多个 `assistant.delta`。
6. route 保存最终 assistant message。
7. route 输出 `assistant.completed` 和 `run.status: completed`。
8. client 调用 `router.refresh()`，页面回到 repository facts。

LP prompt 路径：

- Stage 26 不把 LP generation 迁入 streaming route。
- route 如果把 prompt 分类为 `lp_generation` 或 `project_setup`，输出 `fallback.required`，不创建 task，不写 message。
- client 收到 `fallback.required` 后设置一个本地 `skipStreamingOnce` 标记并调用原 form 的 `requestSubmit()`，下一次 submit handler 看到该标记时不再拦截，让现有 `submitPromptAction` 处理。
- Stage 28 再把 LP chain 接入流式任务体验。

错误路径：

- 空 prompt：不创建 task，不写 message，输出 `error: prompt_required`。
- project 不存在：不创建 task，不写 message，输出 `error: project_not_found`。
- 非普通聊天 task：不创建 task，不写 message，输出 `fallback.required`，由 client 走 server action fallback。
- route 内部异常：输出 `error: generation_failed`，不泄露 exception message。

## 测试策略

### Web route tests

- 空 prompt 返回 `error` event。
- 缺失 project 时可以创建普通聊天 task。
- 非空普通 prompt 输出 `task.created`、多个 `assistant.delta`、`assistant.completed`。
- 完成后 repository 里有 user message 和 assistant message。
- projectId 不存在时返回 `project_not_found`，不保存 message。
- LP/project setup prompt 返回 `fallback.required`，不保存 message。

### Store tests

- streaming helper 复用现有 id allocation，不和 `submitTaskPrompt()` 产生重复 message id。
- streaming helper 保存的 messages 刷新后能通过 `getPageState()` 读取。
- LP prompt 不在 Stage 26 streaming helper 中执行 LP chain。

### UI tests

- composer render 保留 fallback action。
- client submit 时显示临时 assistant bubble，并按 delta 更新。
- client 收到 `fallback.required` 时只触发一次 server action fallback，不进入无限 submit loop。
- stream error 显示安全错误，不清空用户输入。
- completed 后调用 refresh，避免临时状态和 repository facts 长期分叉。

### 回归验证

- `pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts`
- `pnpm exec vitest run apps/web/src/app/api/chat/stream/route.test.ts`
- `pnpm typecheck`

## 验收标准

- 在 Web workbench 中发送普通聊天 prompt，可以看到 assistant answer 逐步出现。
- 页面刷新后，刚刚的 user/assistant messages 仍存在。
- 现有 `submitPromptAction` fallback 和 LP generation 行为不回归。
- streaming event payload 不包含 raw model/tool/artifact/secret 数据。
- Stage 26 完成后 roadmap 推荐下一阶段仍是 Stage 27：Real Chat Runtime and Skill Context v0。
