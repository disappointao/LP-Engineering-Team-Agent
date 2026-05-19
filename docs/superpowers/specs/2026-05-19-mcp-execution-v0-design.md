# MCP Execution v0 Design

## 目的

Stage 20 目标是在现有 MCP registry、tool approval、visible tools、worker queue、run events 和 `ToolObservationRecord` 基础上，打通第一版 **read-only MCP tool execution** 闭环。

这一阶段不是接入真实远端 MCP server，也不是开放文件系统、shell 或写工具。它先建立一个可测试、可审计、可恢复的执行边界：只有当前项目、当前角色可见且已满足 approval 的 MCP tool 可以被执行；执行结果必须保存为 bounded / redacted metadata summary，不把 raw output 直接进入 chat messages、model context 或 Web UI。

## 当前基线

已有能力：

- `packages/mcp-gateway` 定义 `MCPConnectorDefinition`、`MCPToolDefinition`、approval state 和 `computeVisibleTools()`。
- `packages/api` 已支持项目级 MCP connector 创建、启停、tool approval、role-specific visible tools 和 runtime context 注入。
- `packages/db` 已有 `MCPConnectorRepository`、`MCPToolApprovalRepository` 和 `ToolObservationRepository`。
- `packages/api` 的 deployment skill command 已形成 `run.started`、`tool.started`、terminal run/tool events 和脱敏 `ToolObservationRecord` 闭环。
- Stage 19 已实现 worker daemon、heartbeat、stale recovery、bounded lifecycle logs 和 Web 只读 worker queue visibility。

缺口：

- MCP tool metadata 已能进入 runtime context，但没有执行入口。
- 还没有 MCP-specific executor contract、execution result schema、run event / observation finalization 语义。
- Web/API 还不能触发 allowlisted MCP tool 的可观察执行。

## 范围

### Goals

- 增加 read-only MCP execution contract。
- 增加 deterministic local MCP executor，用于测试和本地 MVP。
- API 提供 `executeProjectMCPTool()` 或等价 service method。
- 执行前校验：
  - project 存在；
  - connector 属于该 project 且 enabled；
  - tool 存在；
  - tool role 包含请求角色；
  - tool permission 被当前项目已发布且启用的 skill 授权；
  - `requiresApproval: true` 的 tool 已被当前项目批准；
  - tool 明确标记为 read-only 或不属于写权限集合。
- 执行过程写入 run、run events 和 `ToolObservationRecord`。
- observation 和 run event 只保存 allowlisted input metadata 和 bounded output summary。
- Web 可以提供最小 read-only MCP execution 触发入口，或仅在 API/store 层完成闭环；不得引入复杂结果 UI。

### Non-Goals

- 不接真实 MCP SDK 或远端 MCP server。
- 不执行 write tools。
- 不做 filesystem access、shell execution、Git writes、deployment runner 或浏览器自动化。
- 不保存 connector secrets。
- 不把 raw MCP output 注入 model context、chat messages、timeline 或 Web UI。
- 不做 streaming MCP output。
- 不做通用 workflow / DAG scheduler。
- 不做 production MCP process manager。

## 设计决策

### 1. read-only 是硬边界

Stage 20 v0 只执行 read-only MCP tools。判断方式使用保守规则：

- 优先支持 tool definition 上的显式 `readOnly: true` 或 `sideEffect: "read"` 字段。
- 若历史 connector JSON 没有这些字段，则只允许 permission 以 `:read` 结尾的 tool。
- `:write`、`:deploy`、`:delete`、`:admin` 或既没有 read-only marker 也不是 `:read` permission 的 tool 必须拒绝执行。

这样可以兼容已有 registry，同时为 Stage 21+ 的 write-tool approval 留出明确扩展点。

### 2. executor 是接口，不是 SDK 绑定

新增 MCP executor seam，建议放在 `packages/mcp-gateway` 或 `packages/api` 中，保持 provider-neutral：

```ts
export interface MCPToolExecutionInput {
  projectId: string;
  connectorId: string;
  toolName: string;
  role: AgentRole;
  permission: string;
  arguments: Record<string, unknown>;
  timeoutMs: number;
}

export interface MCPToolExecutionResult {
  state: "completed" | "failed" | "rejected" | "cancelled";
  outputSummary: string;
  metadata?: Record<string, unknown>;
  errorName?: string;
  durationMs?: number;
}

export interface MCPToolExecutor {
  execute(input: MCPToolExecutionInput): Promise<MCPToolExecutionResult>;
}
```

默认 executor 必须是 deterministic local executor。真实 MCP client adapter 留到后续阶段。

### 3. API 拥有执行用例

Web 不直接读写 repository，也不直接调用 executor。API/service 负责：

1. 校验 project / connector / tool / role / permission / approval / read-only。
2. 创建 `RunRecord`，role 使用请求 role。
3. 写入 `run.started` 和 `tool.started`。
4. 调用注入的 `MCPToolExecutor`。
5. 写入 `tool.completed` / `tool.failed` / `tool.cancelled` 和对应 terminal run event。
6. 保存 `ToolObservationRecord`。

执行入口可以命名为：

- `executeProjectMCPTool(input)`
- 或 `runProjectMCPTool(input)`

命名要避免暗示任意 MCP server execution。

### 4. observation 是安全摘要，不是 raw result

`ToolObservationRecord` input 只允许：

- connectorId
- toolName
- role
- permission
- requiresApproval
- approvedByUserId（如存在）
- argumentKeys 或 argumentCount

output 只允许：

- outputSummary
- metadata allowlist
- durationMs
- errorName

不得保存 raw output、raw arguments、secret、完整 artifact 内容、本机绝对路径或未脱敏异常。

### 5. 与 worker queue 的关系

Stage 20 v0 可以先在 API 进程内调用 deterministic executor，因为它不做真实远端调用、不做 shell、不做 side effect。设计必须保留后续迁移到 worker job 的边界：

- run / observation / finalizer 语义与 worker-backed skill command 对齐；
- executor contract 不依赖 Web；
- timeout / cancellation 字段保留在 input/result；
- 后续阶段可以把真实 MCP client adapter 放到 worker runtime 后面。

如果实施时选择 worker-backed deterministic execution，也必须保持 safe persisted payload，不能引入 raw arguments 或 secrets。

## Web 行为

Web 的 MCP 页已有 connector registry、approval 和 visible tools。Stage 20 v0 可以加入最小执行入口：

- 只对 visible read-only tools 展示 “Run read-only check” / “执行只读检查”。
- 表单只提交 projectId、connectorId、toolName、role 和一段 JSON arguments。
- 结果不新增复杂页面；可以通过已有 run timeline / tool observation 可见，或在 MCP view 中显示最后一次安全摘要。

如果 Web UI 风险过大，第一版可只做 Web store / API tests，不做可见按钮。但 spec 推荐提供最小入口，以验证产品闭环。

## 错误码

建议新增或复用：

- `mcp_tool_not_visible`
- `mcp_tool_execution_not_read_only`
- `mcp_tool_execution_approval_required`
- `mcp_tool_execution_rejected`
- `mcp_tool_execution_failed`
- `mcp_tool_arguments_invalid`
- `mcp_executor_not_configured`

错误信息进入 Web copy 时必须不包含 raw arguments 或 executor raw output。

## 测试策略

核心测试：

- 不可见 tool 不能执行。
- disabled connector 不能执行。
- 未绑定授权 permission 的 tool 不能执行。
- `requiresApproval: true` 且未 approved 的 tool 不能执行。
- write-like permission 或既没有 read-only marker 也不是 `:read` permission 的 tool 不能执行。
- deterministic read-only executor 成功后写入 run events 和 `ToolObservationRecord`。
- executor failure 保存安全 failed observation，不泄漏 raw output、raw arguments 或 secret。
- Web store / action 只提交 allowlisted metadata。
- Context Pack 不自动注入 MCP execution raw result。

## 文档和后续

Stage 20 完成后更新：

- `docs/project-roadmap.md`：Stage 20 从推荐队列移动到已完成阶段记录，并保留真实 MCP SDK、write tools、streaming output 为 backlog。
- `docs/agent-development-learning.md`：记录 MCP execution 的安全边界、read-only 限制和 observation 设计。
- `docs/superpowers/README.md`：加入 spec/plan 阅读顺序。

后续阶段可以拆分为：

- MCP Write Tools with Approval v0。
- Real MCP SDK Adapter v0。
- MCP execution through worker runtime。
- MCP result summarization for model context。
