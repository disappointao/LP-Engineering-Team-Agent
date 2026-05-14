# Agent 开发学习笔记

这份文档给缺少 Agent 开发经验的开发者使用。它不是一次性的项目介绍，而是本项目推进过程中持续维护的学习笔记：每做一个阶段，就把这个阶段涉及的 Agent 概念、难点、取舍和本项目实践补充进来。

阅读目标：

- 快速理解 Agent 系统和普通聊天应用的区别。
- 知道每个阶段为什么这样拆，不急着一次做完所有复杂能力。
- 看到本项目已经解决了什么、预留了什么、还没做什么。
- 后续换电脑或换开发者继续做时，可以先读这份文档建立上下文。

## 1. 如何理解 Agent

普通聊天应用通常是：

1. 用户输入一段话。
2. 后端把消息发给模型。
3. 模型返回一段文本。
4. 前端展示结果。

Agent 系统更像一个可观察、可恢复、可约束的任务执行系统：

1. 用户输入目标。
2. 系统识别当前任务和上下文。
3. Planner 决定做什么。
4. Builder 生成或修改产物。
5. Reviewer 检查结果。
6. Tool/MCP/文件系统在受控边界内执行操作。
7. 每一步都留下事件、状态、输出和错误。
8. 后续步骤可以继续利用这些状态，而不是只依赖聊天记录。

本项目当前的目标不是一步到位做完整通用 Agent，而是先做一个轻量、可维护、可迭代的 LP Engineering Team Agent：

- 先保证 Web 端可以创建任务、生成框架无关的 LP 静态产物。
- 再逐步加入 Skills、模型路由、MCP、运行事件、上下文组装和团队协作。
- 部署和真实工具执行先后置，避免早期把系统复杂度拉爆。

## 2. Agent 开发核心难点

### 2.1 当前任务上下文

Agent 必须知道“现在正在做什么”。这不只是用户最后一句话，还包括：

- 当前 task id。
- 当前 project id。
- 当前任务类型，例如普通聊天、项目创建、LP 生成。
- 当前运行到哪个步骤。
- 是否已有 brief、page version、review findings。
- 当前用户是继续旧任务，还是发起新任务。

本项目已经有 task、message、snapshot、project 的基础结构，也已经有 deterministic run records 和 run events。后续重点是让这些状态支持失败诊断、恢复和更完整的多 agent 编排。

### 2.2 历史任务

历史任务不能简单粗暴全部塞进模型。需要区分：

- 当前任务的最近消息。
- 同项目的历史 LP 需求。
- 过去生成过的页面版本。
- 过去 reviewer 发现的问题。
- 过去失败或成功的 run event。

早期可以只展示和读取任务列表。后续需要摘要、检索和选择性注入。

### 2.3 用户偏好和项目偏好

Agent 做得越久，越需要记住偏好，例如：

- 用户习惯中文还是英文。
- 公司电商 LP 的设计风格。
- 默认输出 single HTML 还是 `index.html/styles.css/script.js`。
- 常用模型或成本偏好。
- 品牌、品类、CTA、合规规则。

当前项目只有 locale 自动判断和项目级配置雏形。后续可以通过 project preferences、workspace preferences 或 user profile 补齐。

### 2.4 Skills

Skills 是把可复用经验结构化的方式。它们不是随便拼进 prompt 的长文本，而应该有：

- manifest。
- scope。
- version。
- review state。
- permissions。
- content。
- entrypoints。

本项目已经做了项目级 skill 创建、校验、发布、绑定和 runtime context 注入。重要原则是：当前阶段 skill 只作为数据进入上下文，不执行脚本、不直接部署。

### 2.5 Rules

Rules 是 Agent 必须遵守的约束，来源可能包括：

- `AGENTS.md`。
- Superpowers specs/plans。
- 项目级规则。
- skill 中的工作流规则。
- 生成 LP 的产物规则。
- 安全和审批规则。

难点是规则可能冲突。后续 Context Assembler 应该记录注入了哪些 rules、哪些被省略、哪些因为权限或预算没有进入模型。

### 2.6 Tool Outputs

工具输出不能只当作聊天文本。真实 Agent 需要把工具结果保存成结构化 observation：

- tool name。
- input。
- output summary。
- error。
- artifacts。
- duration。
- approval state。
- 是否可复用。

当前项目 MCP 已有 registry 和可见工具计算，并会进入 Context Pack v0，但还没有执行工具。后续做 MCP execution 时，要先设计 tool observation store，而不是直接把输出拼到 message 里。

### 2.7 文件系统和产物状态

Agent 经常需要知道文件状态：

- 当前有哪些生成文件。
- 哪些文件可写。
- 哪些文件被修改。
- diff 是什么。
- 文件内容是否太大，需要截断或摘要。

本项目生成 LP 必须保持框架无关静态 HTML/CSS/JS。当前 runtime 有 artifact workspace 概念，但 Web V1 主要还是内存产物。后续桌面版或真实文件工作区要优先引入 file manifest 和 diff，而不是每次塞全文。

### 2.8 多 Agent 协调

Planner、Builder、Reviewer、Deployer 不是四个名字而已。真正难点是它们之间怎么交接：

- Planner 产出什么给 Builder。
- Builder 的产物如何给 Reviewer。
- Reviewer 的 findings 如何阻止或允许下一步。
- Deployer 必须拿到哪些 approval 和权限。
- 某一步失败后是重试、回滚、继续还是询问用户。

当前项目已经有 role 概念和 deterministic planner、builder、reviewer、deployer run records。Milestone 6 之后要把 handoff、dependency、blocking question、cancel/retry 逐步显式化。

### 2.9 压缩、检索、组合、注入

这是 Agent 上下文系统的核心：

- 压缩：长历史、工具输出、run log 不能无限增长。
- 检索：只找和当前任务相关的历史、skills、文件片段。
- 组合：把任务、项目、rules、skills、tools、files 合成 context pack。
- 注入：按不同 role 给不同上下文，不是一份 prompt 所有人共用。

本项目已经引入 Context Assembly 边界，并先做最小可用 Context Pack v0。后续不急着做向量数据库和复杂长期记忆，先把注入来源、校验和可观察性稳定下来。

### 2.10 结构化校验和 Zod

Agent 系统里有很多运行时不可信输入，TypeScript 类型在这些地方不够用：

- 用户提交的 JSON。
- 用户上传的 skill manifest。
- MCP connector definition。
- 真实模型返回的结构化 JSON。
- 工具调用输出。
- JSON-file 或未来数据库里重新读出来的状态。

本项目已经使用 Zod 校验 `LPBriefSchema`、`PageVersionSchema`、`ArtifactSchema` 和 `SkillManifestSchema`。后续真实 Agent 阶段应该继续把 Zod 用在关键边界上：

- `RunRecordSchema`。
- `RunEventSchema`。
- `ContextPackSchema`。
- `ToolObservationSchema`。
- `AgentHandoffSchema`。
- `ModelStructuredOutputSchema`。

原则是：边界数据必须 parse，内部可信对象不要到处重复 parse。也就是说，Zod 是运行时边界校验工具，不是替代 TypeScript 的所有类型系统。

### 2.11 Provider-neutral 模型网关

真实 Agent 系统不要把模型厂商写死在业务流程里。更稳的做法是拆成几层：

- provider identity：例如 `zhipu`、`openrouter`、`ollama`。
- API protocol：例如 `anthropic-messages`、`openai-completions`、`mock`。
- endpoint config：例如 `baseUrl`、headers。
- secret reference：只保存环境变量名或未来 secret manager 引用，不保存密钥值。
- model manifest：模型 id、上下文窗口、最大输出、是否支持工具/流式/图片。
- compat：不同兼容 API 的细节差异。

pi-mono 的 provider 配置思路适合作为参考，但本项目不应该直接照搬整套实现。原因是本项目是 Web 多用户系统，MVP 需要先打通 LP Agent 和普通任务工作流；命令式取密钥、复杂 OAuth、大量内置 provider 和完整 SDK 都应该后置。

当前采用的方向是：项目自己维护轻量 provider manifest，先做配置和 mock 链路验证，再按协议逐步接真实 adapter。

## 3. 本项目当前怎么处理

### 已经完成或基本成型

- Next.js Web workbench。
- 类 Manus/ChatGPT 的对话式入口方向。
- 普通任务、LP 生成任务、项目上下文。
- 生成 LP 产物保持静态 HTML/CSS/JS。
- 本地 JSON-file repository，支持项目、任务、消息和 LP snapshot 持久化。
- 项目级 Skills 管理和 runtime 注入。
- 项目级模型 provider/route 配置和 runtime route resolution。
- 项目级 MCP connector registry、tool approval 和可见工具计算。
- Run Orchestration v0：planner、builder、reviewer、deployer 的 deterministic run records 和 ordered run events。
- Context Pack v0：运行前通过 context assembler 组合 task/project input、skills、MCP tools、model routing、approval 和 artifact workspace。
- 第一个真实模型 provider adapter：`packages/model-gateway` 已实现 `anthropic-messages`。
- 中英文 UI 文案和语言自动判断。

### 已经预留但还不完整

- `RuntimeRunContext` 已能承载 skills、MCP tools、approval、artifact workspace、model routing policy，并通过 Context Pack v0 进入 runtime。
- `anthropic-messages` adapter 还没有接入 Web/API/runtime 的真实执行链路。
- run repository 和 event timeline 已有 deterministic v0，后续还要补恢复、失败诊断、流式 UI 和真实并发运行语义。
- Prisma schema 有 workspace/project member、run、run event、deployment 等方向，但 Web V1 未完整接入。
- Deployment adapter 边界存在，但当前 Web V1 按需求不做自动部署。

### 还没做

- Web/API/runtime 的真实模型执行链路接线。
- 压缩和检索。
- MCP/tool 真执行。
- tool observation store。
- 文件系统 workspace 和 diff 注入。
- 多 agent handoff 和恢复。
- 团队成员、角色和审批 UI。
- 实时流式输出和真正的 interrupt/cancel。

## 4. 循序渐进路线

### 阶段 1：跑通最简单 Agent Run

目标不是智能，而是可观察：

- 创建 run。
- 写入 run events。
- 串起 planner/builder/reviewer 的最小顺序。
- 刷新页面后还能看到 run timeline。

学习重点：

- run state 和 task state 的区别。
- event sourcing 的基本思想。
- 为什么失败事件比直接 throw 更适合 Agent。

本阶段完成后，学习重点从“为什么要记录 run event”转为“如何用这些 event 支撑失败诊断、刷新恢复和后续流式 UI”。

当前计划：

- [2026-05-14-run-orchestration-context-assembly.md](./superpowers/plans/2026-05-14-run-orchestration-context-assembly.md)
- 这个计划先做 deterministic run records、ordered run events、Context Pack v0 和 Web timeline。
- 这个计划不做真实模型、MCP 执行、流式输出、向量检索和实时协作。

### 阶段 2：Context Pack v0

先定义一个小而稳定的上下文包：

- task。
- project。
- latest message。
- brief/page version。
- bound skills。
- visible MCP tools。
- model route。
- artifact workspace。

学习重点：

- 不要在 Web 层拼 prompt。
- 不同 role 的上下文不同。
- context 需要可追踪：知道注入了什么、没注入什么。
- context pack 进入 runtime 前要经过 schema 校验。

### 阶段 3：真实模型接入

接入真实模型时，不要绕过 `model-gateway`：

- provider config 只存引用，不存明文 secret。
- adapter 读取环境变量或未来 secret manager。
- 保留 mock provider 方便本地测试。
- 记录 provider、model、usage、错误。
- 先做 provider-neutral 配置和 mock 链路验证，再接真实外部 API。
- 把 provider id 和 API protocol 分开，不要用 `openai`、`anthropic` 这类厂商名直接决定运行逻辑。

学习重点：

- provider-neutral interface。
- provider manifest。
- API protocol adapter。
- fallback。
- 超时、重试、错误分类。
- 成本和上下文预算。
- 真实模型返回结构化 JSON 后必须先用 schema parse，再进入业务逻辑。

当前设计：

- [2026-05-14-provider-neutral-model-config-design.md](./superpowers/specs/2026-05-14-provider-neutral-model-config-design.md)
- 当前实现计划：[2026-05-14-provider-neutral-model-config.md](./superpowers/plans/2026-05-14-provider-neutral-model-config.md)
- 这个设计参考 pi-mono 的 `provider + api + baseUrl + secret reference + models + compat` 思路，但不绑定 pi-mono 依赖。
- 第一步只做通用配置和 mock runtime 链路验证，不做真实模型调用、streaming、tool-call 转换、fallback 或 OAuth。

已实现的第一个真实 adapter：

- [2026-05-14-anthropic-messages-adapter-design.md](./superpowers/specs/2026-05-14-anthropic-messages-adapter-design.md)
- 这一步只在 `packages/model-gateway` 做第一个真实协议 adapter：`anthropic-messages`。
- 智谱的 `https://open.bigmodel.cn/api/anthropic` 属于 Claude/Anthropic Messages 兼容入口；智谱的 `https://open.bigmodel.cn/api/paas/v4/` 属于 OpenAI/智谱 Chat Completions 入口。
- 当前项目配置层可以保存 `paas/v4`，但真实执行要等后续 `openai-completions` adapter。
- 学习重点是把真实外部 API 调用限制在模型网关边界内：密钥只在 adapter 内解析，返回给 runtime 的只有 provider、protocol、model、usage 和脱敏状态。
- 当前实现计划：[2026-05-14-anthropic-messages-adapter.md](./superpowers/plans/2026-05-14-anthropic-messages-adapter.md)
- 当前 adapter 仍只存在于 `packages/model-gateway` 边界内，尚未接入 Web/API/runtime 的真实执行路径。

下一步真实 runtime 接线设计：

- [2026-05-14-real-model-runtime-wiring-design.md](./superpowers/specs/2026-05-14-real-model-runtime-wiring-design.md)
- 当前实现计划：[2026-05-14-real-model-runtime-wiring.md](./superpowers/plans/2026-05-14-real-model-runtime-wiring.md)
- 这一步把 `ProviderBackedModelGateway` 接入 Web/API/runtime，但必须通过 `REAL_MODEL_RUNTIME=1` 显式开启。
- `REAL_MODEL_PROVIDER_TEST=1` 只控制真实 provider 集成测试，不应该触发 Web/API 的真实模型运行。
- 这一阶段只验证真实模型能进入 run timeline，LP 产物仍保持 deterministic 静态 HTML/CSS/JS，不直接由模型输出驱动。
- 学习重点：真实模型接入不是把所有 runtime 都替换成网络调用，而是在服务边界增加可测试的 factory、env 开关、仓储 resolver、fake-fetch 单测和脱敏事件。

真实 provider 集成测试默认跳过。需要本机临时导出环境变量后再跑：

```bash
set -a
source .env.local
set +a
pnpm --filter @lp-agent/model-gateway test
```

`.env.local` 中必须至少包含：

- `REAL_MODEL_PROVIDER_TEST=1`
- `ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic`
- `ANTHROPIC_API_KEY=...`
- `ANTHROPIC_DEFAULT_MODEL=glm-5.1`

### 阶段 4：工具执行和 MCP Execution

先做只读工具，再做写工具：

- 工具必须有 permission。
- 写工具必须有 approval。
- 输出保存为 observation。
- 工具失败要进入 run event。

学习重点：

- 工具调用不是模型自由执行命令。
- approval 和权限是产品能力，不只是安全补丁。
- tool output 要结构化。
- tool observation 要有 schema，不能只保存任意文本。

### 阶段 5：压缩和检索

当历史和工具输出变多后再做：

- message summary。
- run summary。
- tool output summary。
- project-scoped retrieval。
- selected file snippets。

学习重点：

- 不是所有历史都有价值。
- 检索结果也要受权限和上下文预算控制。
- 摘要本身需要可更新、可追溯。

### 阶段 6：多 Agent 协作

从固定角色开始，不急着做开放式 agent swarm：

- Planner 输出结构化计划。
- Builder 只负责生成/修改产物。
- Reviewer 只负责验收和 findings。
- Deployer 只在 approval 后处理部署 handoff 或部署 skill。

学习重点：

- handoff schema。
- dependency graph。
- retry/cancel/resume。
- 多 agent 通信状态。

## 5. 写代码时的维护原则

- 先做最小闭环，再做智能增强。
- 业务入口依赖接口，不直接依赖具体 provider、MCP SDK、Git SDK 或 shell。
- 生成 LP 产物永远保持框架无关静态 HTML/CSS/JS。
- Skills 在当前阶段是数据，不是可执行代码。
- MCP registry 和 MCP execution 分开做。
- Model routing 和真实模型 adapter 分开做。
- Context assembly 不能散落在 Web 组件里。
- Run event 要能支持刷新后恢复。
- 每个复杂能力都要有 Non-Goals，避免范围膨胀。
- 每个阶段都要保留 mock/local adapter，方便测试。

## 6. 文档维护规则

当后续新增或修改以下内容时，需要同步更新本文件：

- Agent runtime。
- Run orchestration。
- Context assembler / context pack。
- Skills 管理或注入规则。
- Model gateway 或真实模型 adapter。
- MCP registry 或 MCP execution。
- Tool observation。
- 文件系统 workspace、artifact workspace、diff 注入。
- 多 agent handoff、协作、审批。
- 与 Agent 学习路径相关的 specs/plans。

更新方式：

- 如果新增了一个阶段，在“循序渐进路线”中补充学习重点。
- 如果实现了一个能力，在“本项目当前怎么处理”中把它从“还没做”移动到“已完成或基本成型”。
- 如果发现一个新的工程难点，在“Agent 开发核心难点”中新增小节。
- 如果某个旧判断过时，直接改成当前事实，不保留误导性历史描述。
