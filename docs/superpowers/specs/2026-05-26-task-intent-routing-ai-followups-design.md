# Task Intent Routing and AI Follow-ups Design

## 背景

Stage58 已把 Web 任务体验收紧为 Manus 风格：普通聊天保持干净，LP 复杂任务显示用户语言进度卡，composer 主按钮在发送和停止之间切换。用户继续提出两个产品要求：

- 推荐追问不应是写死的静态数组，而应由 AI 根据当前任务上下文生成。
- 普通任务不需要推荐追问；复杂任务可以有推荐追问。
- 普通聊天里可以突然要求执行复杂任务；复杂任务里也可以普通提问，或继续完善当前任务。

当前代码状态：

- `createChatWorkbenchThread` 使用 `copy.chat.suggestions`。
- `createGeneralTaskThread` 使用 `copy.chat.generalSuggestions`。
- 普通聊天流式接口遇到 LP prompt 会返回 `fallback_required`，前端会转到 `/api/tasks/submit` 创建 LP task。
- LP task 的 composer 当前直接走 live task continuation，因此 LP task 内普通提问会被当作继续执行复杂任务。

## 目标

让 Web workbench 的输入行为从“按当前 task type 固定路由”升级为“每次输入基于当前上下文判断意图”。

目标行为：

1. 普通聊天线程不显示推荐追问。
2. LP 复杂任务线程可以显示 AI 生成的推荐追问。
3. 推荐追问基于当前 task messages、artifact state、run state 和最新用户目标生成，不使用固定文案数组作为用户可见主路径。
4. 普通聊天里输入复杂任务请求时，可以创建/切换到 LP task。
5. LP 复杂任务里输入普通问题时，只做 assistant answer，不启动 Planner / Builder / Reviewer / Deployer。
6. LP 复杂任务里输入继续修改请求时，继续当前 LP task 并启动 agent chain。
7. LP 复杂任务里输入明显新任务请求时，创建新的 LP task；不明确时先问澄清问题。

## 非目标

- 不实现真实 Manus 后端或云端运行时。
- 不改变 Planner / Builder / Reviewer / Deployer 的核心 orchestration。
- 不改变 worker queue、run event schema、artifact workspace 文件 contract 或 interrupt server action 安全边界。
- 不引入 billing / quota / credit 系统。
- 不把推荐追问显示给普通聊天线程。
- 不让 deterministic/no-key 默认测试依赖真实模型。

## 用户体验规则

### 普通聊天线程

普通聊天底部只保留 composer，不显示“推荐追问”区域。用户可以正常继续问答。

如果用户在普通聊天里输入 LP/HTML/落地页等复杂任务请求：

- 系统保留现有 `fallback_required -> live task submit` 路径。
- 新建或切换到 LP task。
- 显示 LP task 的 Manus 风格进度卡。

### LP 复杂任务线程

LP task 内的 composer 不再默认把每条消息都当作继续执行。每次提交先走 task intent router。

意图分类：

- `chat_in_task`：解释、评价、询问当前任务或 artifact，不启动 agent chain。
- `agent_continue`：修改、优化、继续完善当前 LP，启动当前 LP task continuation。
- `agent_new_task`：明显要求创建另一个 LP / 页面 / 网站，创建新的 LP task。
- `clarify`：意图不明确，回复一个普通 assistant 澄清问题，不启动 agent chain。

推荐追问按钮也携带同样的 intent。点击“解释页面结构”应走 `chat_in_task`；点击“优化首屏文案”应走 `agent_continue`。

## 推荐追问生成规则

推荐追问只在 `pageState.kind === "task_ready"` 且 `pageState.task.type === "lp_generation"` 时生成和渲染。

建议数量：2-3 个。

每个推荐项结构：

```ts
type TaskFollowupSuggestion = {
  id: string;
  intent: "chat_in_task" | "agent_continue" | "agent_new_task";
  prompt: string;
};
```

生成上下文限制：

- 最近 4-6 条 task messages。
- 当前 task title / type / status。
- artifact diff 摘要：文件名、summary、是否已有 preview，不包含完整 artifact 内容。
- run/recovery 摘要：角色、状态、安全诊断，不包含 raw output、secret、本机路径。

真实模型路径：

- 使用 `assistant` role route。
- 生成 strict JSON 数组。
- 输出必须经过 schema validation、长度限制、去重和敏感内容过滤。
- 失败时不显示 AI 推荐追问，或仅在 deterministic test mode 使用固定 fallback。

deterministic 路径：

- 默认 no-key 环境继续有稳定测试输出，但应标记为 deterministic fallback。
- 产品主路径不把旧 `copy.chat.suggestions` / `copy.chat.generalSuggestions` 当成“AI 推荐”。

## 意图路由设计

新增 Web/API 层 task input intent router，而不是把判断散在 React 组件里。

输入：

```ts
type TaskInputIntentRequest = {
  prompt: string;
  currentTask?: {
    id: string;
    type: "general_chat" | "lp_generation" | "project_setup";
    projectId?: string;
    status: string;
  };
  recentMessages: Array<{ role: string; content: string }>;
  artifactSummary?: {
    files: Array<{ path: string; summary?: string }>;
    hasPreview: boolean;
  };
};
```

输出：

```ts
type TaskInputIntent =
  | { type: "chat_in_task" }
  | { type: "agent_continue" }
  | { type: "agent_new_task" }
  | { type: "clarify"; question: string };
```

第一版实现建议：

- 先做 deterministic heuristic router，覆盖最常见中文/英文意图。
- 真实模型 opt-in 可作为后续增强：当 `.env.local` 已配置真实 provider 时，用 assistant route 判定 intent，但必须保留 fail-closed heuristic fallback。

这是比“所有判断都依赖模型”更稳的第一版：路由行为可测试、可解释，且不让 no-key gate 变脆。

## 数据流

### 普通 chat submit

1. 用户提交 prompt 到 `/api/chat/stream`。
2. `startStreamingChatPrompt` 仍先 classify prompt。
3. 如果是 LP prompt，返回 `fallback_required`。
4. `StreamingWorkbench` 调 `/api/tasks/submit` 创建 LP task。

### LP task submit

1. 用户在 LP task composer 提交 prompt。
2. 前端调用统一 task input route 或 server action。
3. 服务端读取当前 task、messages、artifact summary。
4. intent router 返回类型。
5. 分支：
   - `chat_in_task`：创建 user message + assistant answer，仍留在当前 LP task。
   - `agent_continue`：走 `startLiveTaskPrompt` / LP continuation。
   - `agent_new_task`：创建新 LP task。
   - `clarify`：创建普通 assistant 澄清回复。

## 测试策略

Unit tests：

- 普通 chat thread 的 `suggestions` 为空。
- LP thread 的 suggestions 来自 task follow-up provider，而不是 `copy.chat.suggestions`。
- intent router 将“为什么这样设计”判为 `chat_in_task`。
- intent router 将“把首屏文案改得更强”判为 `agent_continue`。
- intent router 将“再做一个夏季活动页”判为 `agent_new_task`。
- ambiguous prompt 返回 `clarify`。

API / store tests：

- 普通聊天中输入 LP prompt 仍触发 LP fallback。
- LP task 中普通问题只追加 chat messages，不创建新的 Planner / Builder / Reviewer / Deployer runs。
- LP task 中继续修改会创建新的 continuation run chain。
- LP task 中新 LP 请求会创建新的 task。

Browser E2E：

- 普通聊天完成后不显示推荐追问。
- LP task 完成后显示 2-3 个推荐追问。
- 点击普通问答类推荐追问不会显示 task progress card，不产生新 LP run chain。
- 点击继续修改类推荐追问会显示 task progress card。

## 风险和取舍

- 直接完全依赖模型做 intent routing 更智能，但容易在 no-key / deterministic gate 下不可测，也会引入成本和延迟。第一版先用 deterministic router，后续再加 real-model override。
- 推荐追问如果实时服务端生成，会增加页面加载延迟。第一版可以在 server render 时同步生成 deterministic/cheap suggestions；真实模型生成可后续改成异步刷新。
- LP task 中普通问答需要上下文，但不能暴露 raw artifact。只注入 bounded artifact summary 和最近消息。

## 完成标准

- 普通聊天没有推荐追问。
- LP task 有上下文相关推荐追问，且不是 i18n 固定数组。
- LP task composer 能区分普通提问、继续修改和新任务。
- 默认 deterministic tests 不依赖真实 provider、网络或 key。
- `pnpm test`、`pnpm typecheck`、`pnpm alpha:e2e` 通过。
