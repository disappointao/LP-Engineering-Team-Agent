# Agent 开发学习笔记

这份文档给缺少 Agent 开发经验的开发者使用。它不是一次性的项目介绍，也不是项目流水账。它只记录本项目推进过程中和 Agent 开发直接相关的概念、难点、实现取舍和本项目实践。

判断是否写入本文件时，先看它是否能帮助理解 Agent 知识点：例如 Agent runtime、上下文组装、工具执行、artifact 安全边界、多 Agent 协作、模型、检索、记忆、恢复、审批或可观察性。普通项目维护内容如果不涉及这些 Agent 知识点，就不要写入本文件；文档、启动、UI、验收等只是常见例子，不是固定排除清单。

阅读目标：

- 快速理解 Agent 系统和普通聊天应用的区别。
- 知道每个阶段为什么这样拆，不急着一次做完所有复杂能力。
- 看到本项目已经解决了什么、预留了什么、还没做什么。
- 后续换电脑或换开发者继续做时，可以先读这份文档理解 Agent 相关上下文。

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
- 再逐步加入 Skills、模型路由、运行事件、上下文组装和团队协作。
- 当前第一版可用闭环优先级已收敛为 Web/API 普通问答、LP 固定链路工作流、Skill 上下文/命令和流式反馈；MCP、真实部署、auth/RBAC 和广义 tool execution 后置。
- 完整自动部署和广义 tool execution 仍后置；当前只开放经过 API `ToolCommandRunner` 校验和审批的窄范围 deployment skill command 执行路径。

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

本项目已经做了项目级 skill 创建、校验、发布、绑定和 runtime context 注入。重要原则是：skill 本身仍是 manifest、内容和规则数据；只有已发布、已绑定的 `deployment` skill 里预声明的 command，才能在 API 校验和一次性审批后通过 `ToolCommandRunner` 边界执行。

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
- raw output。
- metadata summary。
- output summary。
- error。
- artifacts。
- duration。
- approval state。
- 是否可复用。

当前项目 MCP 已有 registry、可见工具计算和进入 Context Pack v0 的边界；Stage 20 也已经实现 read-only deterministic MCP tool execution v0：API 侧先校验 project、connector、tool、role、permission、approval 和 read-only 边界，再通过 deterministic local executor 写入安全 `ToolObservationRecord` 和脱敏 run event。这里的学习点不是“MCP 已经完整接入”，而是第一版 MCP execution 必须先把授权、只读约束、observation 和 UI 可见摘要做成受控边界。真实 MCP SDK / remote MCP server adapter、write tools 和 MCP worker execution 仍是后续工作，不能绕过这个 observation 底座直接把工具输出拼到 message 里。

重要学习点：agent 工具调用输出必须拆成 raw output 和 metadata summary。raw output 只留在受控 observation/日志边界内，不能直接喂给 UI 或聊天消息；UI 只展示 allowlist metadata，例如 command id、状态、退出码、耗时、截断摘要和脱敏错误。命令执行还必须同时绑定 approval、permission、secret redaction、scope、project id 和 pageVersion id，避免跨项目、跨版本或未授权执行。run event 本身要可检索、可过滤、可压缩，才能支撑刷新恢复、失败诊断、长历史摘要和后续流式 timeline。

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

当前项目已经有 role 概念、deterministic planner/builder/reviewer/deployer run records，以及 Agent Handoff State v0。Milestone 6 之后还要把 retry/resume、blocking question、cancel 和更通用的 dependency 语义逐步显式化。

### 2.9 压缩、检索、组合、注入

这是 Agent 上下文系统的核心：

- 压缩：长历史、工具输出、run log 不能无限增长。
- 检索：只找和当前任务相关的历史、skills、文件片段。
- 组合：把任务、项目、rules、skills、tools、files 合成 context pack。
- 注入：按不同 role 给不同上下文，不是一份 prompt 所有人共用。

本项目已经引入 Context Assembly 边界，并先做最小可用 Context Pack v0。Stage 5 v0 已能把受预算约束的 deterministic `ContextMemory` 注入 Context Pack；后续不急着做向量数据库和复杂长期记忆，先把注入来源、校验和可观察性稳定下来。

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

### 2.12 普通聊天也需要明确 Agent role

普通问答不是 LP `Planner`。如果把普通聊天临时复用 `planner` model route，短期可以少改类型，但长期会混淆两类完全不同的职责：`planner` 负责把 LP 需求转成结构化 brief，普通聊天则负责回答问题、解释项目状态和承接后续工作流入口。

Stage 27 的设计决定新增独立 `assistant` role。这个 role 可以复用 model gateway、Context Pack、run events、recovery 和 Web streaming transport，但不会触发 `LPBriefSchema` / `StaticArtifactsSchema` parse，也不会声称自己执行了 MCP、shell、deployment 或 artifact 修改。

普通聊天的 project skills 注入也要分两层看：

- 给模型的 bounded prompt context 可以包含已发布、已绑定 skill 的必要内容片段和 metadata。
- 给用户看的 UI context summary 只展示 project、skill 数量、skill 名称和版本，不展示 raw skill content、secret、raw provider response、raw tool output 或完整 artifact 内容。

这让普通聊天既能成为第一版可用入口，又不破坏 LP agent chain 的结构化输出边界。

### 2.13 固定链路要先有 task anchor

LP agent chain 不是一组孤立函数调用。用户在 Web 提交“写 LP / 改 LP”后，系统必须先有稳定 task anchor，再把 Planner、Builder、Reviewer、Deployer 的 run、handoff、artifact workspace 和 recovery fact 绑定到这个 task。

Stage 28 的设计重点是把当前“先跑 Planner/Builder/Reviewer，成功后再创建 task”的路径改成 task-first orchestration：

- 先创建或复用 `lp_generation` task，并保存 user message。
- 每个 agent run 都带同一个 `taskId`。
- Planner 成功后补 brief id；Builder 成功后补 page version / artifact workspace；Reviewer / Deployer 后继续更新同一个 task 的事实。
- 失败时不丢 task。Planner parse/retry exhausted、Builder artifact policy failure、Reviewer blocked 和 Deployer failure 都应该通过 run timeline / recovery view 解释。

这个边界很重要：Agent 工作流的用户体验不能只展示最终成功产物。真正可用的 Agent 系统要让失败、阻塞、部分完成和后续修改都有同一个可观察上下文。

### 2.14 Live timeline 是事实刷新，不是新的事实源

Stage 29 的重点不是再造一套前端状态机，而是把已有 repository facts 持续投影到 Web task panel。Agent 工作流里的实时感来自这些事实：

- run records 和 run events。
- worker queue / heartbeat / lifecycle logs。
- recovery view。
- handoff state。
- artifact workspace metadata。
- task snapshot 和 messages。

客户端可以轮询这些安全事实并做短暂的 optimistic UI，但刷新页面后必须仍以 repository 为准。这样做的好处是：失败诊断、恢复动作、artifact preview/export 和后续 context assembly 都读取同一套事实，不会出现“前端看起来完成、repository 里其实失败”的 split-brain。

Stage 29 v0 先用短轮询 task state refresh，而不是直接上 SSE。这里的学习点是区分两类流式反馈：

- 普通聊天的 assistant text delta 适合 NDJSON streaming。
- Agent run timeline / artifact progress 更适合从 repository 反复派生安全状态。

这两条边界不能混在一起。run timeline payload 只能包含 safe summary，不能把 raw model output、raw artifact content、secret、raw worker payload、raw tool output、本机路径或完整 stdout/stderr 送到浏览器。

Stage 29 implementation plan 采用两段式体验：普通聊天仍先尝试 `/api/chat/stream`；当服务端判断 prompt 是 LP 任务并返回 `fallback.required` 时，客户端调用 `/api/tasks/submit` live task submit route 创建 task 并启动 in-process LP chain，然后通过 `/api/tasks/[taskId]/state` task state polling 观察 repository facts。这个边界保留了 Stage 26 的 text streaming，同时让 LP workflow 不再依赖阻塞式 form submit 才能回到页面。

### 2.15 Provider usage 和 token streaming 不是同一件事

真实模型接入后，可观察性要拆成几层：

- provider-reported usage：外部 API 返回的 token 用量，例如 prompt/input tokens、completion/output tokens 和 total tokens。
- estimated usage：mock/deterministic 路径或 provider 未返回 usage 时的本地估算，只能作为开发反馈，不能当作计费事实。
- streaming capability：某个 route/model 声称支持 token streaming。
- streaming enabled：本次调用是否真的按 streaming 协议执行。
- token delta：逐段到达的模型文本片段，它不是 run event 的最终事实，仍需要完整 buffer 后进入 schema parse 或业务校验。

Stage 32 的学习点是先把 provider usage metadata、duration、attempt 和 streaming capability 变成安全、可测试、可展示的事实。它不急着把 token delta 直接塞进 LP workflow，因为 Planner / Builder 的真实输出仍必须等完整 JSON 后经过 `LPBriefSchema`、`StaticArtifactsSchema` 和 artifact policy validation。

usage metadata 也必须遵守 Agent 安全边界：run event 可以保存 provider id、protocol、model、duration、attempt、token counts 和 usage source，但不能保存 raw provider response、prompt 正文、raw model output、base URL、API key env value、secret 或完整 artifact 内容。

Stage 35 在这个边界上补了 provider token delta streaming，但只用于普通聊天 `assistant` role 的 transient UX。`ModelGateway.stream()` 输出 provider-neutral `model.delta` 和 terminal `model.completed`，OpenAI-compatible / Anthropic-compatible adapter 会解析 SSE frame、只暴露 bounded text delta，并在 terminal response 中给出 provider-reported 或 estimated usage。runtime/API/Web 只把 delta 转成浏览器里的临时 `assistant.delta`，最终仍只持久化一条完整 assistant message 和 terminal `model.completed` / `run.completed` events；每个 token chunk 不会成为 run event、message、artifact 或业务事实。

这也解释了为什么 LP Planner / Builder 仍继续走 `ModelGateway.complete()`：结构化输出不能边收 token 边相信局部 JSON。Planner / Builder 必须等完整 buffer 后再做 schema parse、policy validation 和 one-shot repair；如果把 token delta 当成可恢复事实，会破坏失败诊断、repair timeline 和 artifact 安全边界。

Stage 36 的学习点是把真实 provider alpha smoke 当成 operator opt-in 流程，而不是默认 readiness gate。`REAL_MODEL_RUNTIME=1`、provider route 和本地 key 可以用于少数内部手动 smoke；`pnpm alpha:check`、`pnpm smoke`、`pnpm alpha:e2e` 和普通 `pnpm test` 仍必须保持 deterministic/no-key。真实 provider operator 文档应该说明 missing key、disabled provider、protocol mismatch、structured output parse failure 和 usage metadata 解读，但不能要求默认开发流程触网或泄漏 key/base URL/raw provider response。

### 2.16 Streaming failure UX 也要分清 transient 和事实

普通聊天 token streaming 带来更好的体感，也带来新的失败形态：provider 配置错误、SSE 中途断开、malformed frame、慢首 token、空 terminal content、repository persistence failure，以及浏览器侧 cancel / disconnect。这些不能全部压成“聊天失败”，否则用户和 operator 都无法判断是 provider 配置问题、网络/stream 协议问题，还是本地持久化问题。

Stage 38 的学习点是：streaming failure classification 仍然属于 Agent 可观察性边界，而不是纯前端文案。正确做法是让 API/service/runtime 产出安全、bounded、可测试的 failure code 和 terminal run facts；Web 可以保留 transient partial content 做当前页面提示，但不能把 partial delta 当作已完成 assistant message。刷新后仍以 repository 里的 terminal message、run record 和 run event 为准。浏览器侧 cancel / disconnect 不应展示成失败，也不能留下 `running` run 或空 assistant message；v0 用安全的 `run.cancelled` terminal fact 和 placeholder cleanup 保持刷新一致性。

这条边界也保护安全性：失败文案可以说 provider 配置缺失、stream 中断、空响应或持久化失败，但不能展示 raw provider response、raw SSE frame、API key env value、secret、base URL、本机路径或完整 artifact 内容。真实 provider operator 排查也应使用 safe event summary 和文档化 smoke matrix，而不是要求试用者复制 raw provider body。

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
- Stage 20 Read-only MCP Execution v0：API 侧校验 project、connector、tool、role、permission、approval 和 read-only 边界后，通过 deterministic local executor 写入 run events 与安全 `ToolObservationRecord`；Web MCP 页已有最小只读执行入口。
- Run Orchestration v0：planner、builder、reviewer、deployer 的 deterministic run records 和 ordered run events。
- Context Pack v0：运行前通过 context assembler 组合 task/project input、skills、MCP tools、model routing、approval 和 artifact workspace。
- Stage 5 Context Memory Retrieval v0：`ContextPack` 已注入同项目内的 deterministic `ContextMemory`，包含 message、run、tool observation 和 artifact metadata 摘要，并记录 memory trace。
- Skill Command Web 模拟执行闭环：Web 已能从项目绑定 skills 发现可执行 command，完成一次性授权，通过 server action 调用 API/service，保存 observation/run events，并在 chat timeline 中展示安全输出摘要。
- Stage 7 Collaboration Primitives v0：已实现本地 `local-web-user` identity helper、project owner membership 自动创建、workspace/project member repository、JSON-file 持久化、审批 actor 归属和 Web 项目成员只读展示。
- Worker runtime / queue v0：已实现 worker job contract、sandbox policy、JSON-file 默认 persistence、显式 opt-in Postgres worker job / safe payload / lifecycle log backend、cancel/interrupt、claim-token queue handoff、`apps/agent-worker` run-once / daemon polling loop、heartbeat metadata、stale safe claim recovery、bounded lifecycle logs 和 Web 只读 worker queue health。
- Durable Artifact Workspace v0：已实现本地 artifact workspace/file repository、manifest/hash/summary、workspace-backed preview/export recovery 和 metadata-first context 注入。
- Artifact Reader / Static Diff v0：已实现受控 artifact file 读取、8KB bounded snippet、metadata-only workspace/page-version diff 和 runtime/model no-content guard。
- 第一个真实模型 provider adapter：`packages/model-gateway` 已实现 `anthropic-messages`。
- 通用 OpenAI Chat Completions compatible adapter：`packages/model-gateway` 已实现 `openai-completions`，可配置智谱 `paas/v4` 等兼容入口。
- Web/API/runtime 已有真实模型执行接线，必须通过 `REAL_MODEL_RUNTIME=1` 显式开启；默认开发和测试仍走 deterministic runtime。
- Stage 21 Model Repair、Retry 和 Fallback v0：真实模型路径已支持 Planner / Builder one-shot repair、provider 临时错误 bounded retry、fallback route 安全 metadata 和脱敏 retry / fallback / repair events。

### 已经预留但还不完整

- `RuntimeRunContext` 已能承载 skills、MCP tools、approval、artifact workspace、model routing policy，并通过 Context Pack v0 进入 runtime。
- run repository 和 event timeline 已有 deterministic v0，后续还要补恢复、失败诊断、流式 UI 和真实并发运行语义。
- Controlled deployment skill command execution 已在 API/service 层实现，并通过 Web 模拟 runner 接入工作台；后续真实 deployment adapter 仍按 adapter/runner 方式迭代。
- Worker/Sandbox Runtime Foundation 已有 v0 contract、queue、cancel、daemon polling、heartbeat、stale recovery、Web 只读 queue health 和显式 opt-in Postgres worker queue backend 闭环；后续还要补真实 runner、MCP worker execution、强 sandbox 和 raw stdout/stderr streaming。
- Postgres Repository Foundation v0 已把 Prisma schema 对齐当前核心 `WorkbenchRepositories` contract，并提供显式 opt-in 的 Prisma-backed repository adapter；默认本地开发和测试仍走 `in-memory` / `JSON-file` repositories。
- Stage 23 Web opt-in Postgres backend wiring 已实现：Web/API runtime 可通过显式 `WORKBENCH_REPOSITORY_BACKEND=postgres` 选择 Prisma-backed repository，并已补齐 Web-facing repository closure，避免 Postgres core state 和 JSON sidecar state 混用。
- Stage 25 Run Recovery UI v0 已实现：Web task state 现在包含 recovery views，task timeline 展示 inline recovery block，并通过 server action 执行第一批受控 resume/retry recovery actions。
- Stage 26 Streaming Chat Transport and UI v0 已实现：普通聊天通过 Web/API NDJSON streaming route 和 client transient state 展示 assistant delta，terminal event 后回到 repository fact；LP / project setup 仍走 server action fallback。
- Stage 27 Real Chat Runtime and Skill Context v0 已实现：`assistant` 已是一等 model/runtime role；project-bound 普通聊天通过 `runAssistantChat()` 进入 assistant runtime；prompt assembly 使用 bounded skill、memory 和 project context；Web stream 会输出安全 `context.summary`，UI 展示 project、skill 和 runtime summary。默认仍是 deterministic runtime，真实模型 runtime 仍必须通过 `REAL_MODEL_RUNTIME=1` 显式 opt-in。
- Stage 28 LP Agent Chain End-to-End v0 已实现：Web LP 复杂任务采用 task-first fixed chain orchestration；Planner / Builder / Reviewer / Deployer 的 run、handoff、artifact workspace、deployment handoff 和 recovery facts 都绑定到同一个 task。Planner / Builder 在 `REAL_MODEL_RUNTIME=1` 下继续走真实模型 structured output；Reviewer / Deployer 仍 deterministic / policy-driven。
- Stage 29 Live Run Timeline and Artifact Progress v0 已实现：短轮询 task state refresh、live task submit fallback、compact run timeline panel、artifact progress auto-refresh 和 safe live payload smoke 覆盖已经落地；repository 仍是唯一事实来源，不新增 SSE 或 raw log streaming。
- Stage 30 Skill-Only Alpha Hardening v0 已实现：它不是新增 Agent runtime 能力，而是把普通聊天 streaming、LP live task、artifact preview/export、项目 Skills、Skill command queue 和真实 provider opt-in 收敛成可交付的本地 alpha。学习重点是区分“第一版可用闭环的主路径”和“架构边界已存在但 alpha 不依赖的能力”：MCP 页面可以保留，但 MCP 新功能、usage/cost reporting 和真实部署仍后置；Browser E2E 已由 Stage 31 补齐。默认 alpha 检查通过 `pnpm alpha:check` 运行 deterministic readiness gate，不触发真实 provider、MCP server、Postgres、Browser E2E 或真实部署。
- Stage 31 Browser E2E Acceptance v0 已实现：它仍不是新增 Agent runtime 能力，而是给已有 Skill-only alpha 加 browser-level acceptance gate。默认 browser E2E 仍是 deterministic acceptance，不触发真实 provider、MCP server、Postgres、远端 browser farm 或真实部署；它的价值是把 Agent workflow 的 browser-visible contract 固定下来，而不是扩大 Agent runtime。实现重点是让普通聊天 streaming、LP live task、artifact preview/export/snippet、Skills / Models / MCP 边界和基础 recovery display 在真实浏览器里可重复验收，同时用独立 `LP_AGENT_WORKBENCH_STATE_FILE`、deterministic runtime 和少量稳定 locator 避免污染本地状态或把内部实现细节写成产品 contract。
- Stage 32 Provider Streaming and Usage Metadata v0 已实现：真实 provider 路径现在会在 `model-gateway -> runtime event -> API run event -> Web timeline` 边界传递 provider-reported usage、duration、attempt 和 streaming capability summary；deterministic/mock 路径会标记 estimated usage。Stage 32 当时不做 token delta UI，后续 Stage 35 已补普通聊天 provider token delta streaming；billing/quota、自动 fallback execution 和 tool-call conversion 仍未做。
- Stage 35 Provider Token Delta Streaming v0 已实现：普通聊天 `assistant` role 在真实 provider route 支持时会通过 `ModelGateway.stream()` 消费 provider SSE delta，Web/API 只展示 transient `assistant.delta`，最终事实仍是完整 assistant message 和 terminal run/model events；LP Planner / Builder 继续完整 buffer parse / repair。
- Stage 36 Real Provider Alpha Smoke Matrix and Operator Docs v0 已实现：真实 provider 手动 smoke 已整理到 operator 文档，默认 readiness gates 继续 deterministic/no-key；fake-provider regression 覆盖 provider usage metadata 和 missing-key fail-closed 脱敏边界。
- Deployment adapter 边界存在；当前 Web V1 只创建 repository 中的 deployment handoff，不做真实外部部署。

### 还没做

- LP structured output token-level UI、tool-call protocol conversion、billing/quota/cost ledger 和超过 one-shot repair 的更复杂自我修正还没实现；Stage 32 已补 usage metadata 和 streaming capability 可见性，Stage 35 已补普通聊天 provider token delta streaming，真实 fallback provider execution 仍未做。
- LP chain 的 no-refresh live timeline 和 artifact progress v0 已完成；LP structured output token streaming、tool-call conversion、MCP execution 和 usage/cost reporting 仍然后置。Stage 28 已完成 task-first fixed chain、继续编辑、previous artifact context、真实 Planner / Builder structured output 覆盖和 recovery 边界。
- Postgres production rollout 还没实现；Stage 23-24 只完成 Web opt-in backend wiring 和 worker queue opt-in backend，不做 Postgres 上的 auth/RBAC、object storage / artifact content migration、Prisma migrations / production deployment docs。
- 高级压缩和检索：向量检索、持久 summary repository、selected file snippets、跨项目或跨用户长期记忆。
- 真实 MCP SDK / remote MCP server adapter、MCP worker execution 和 write tools 仍未做；Stage 20 已完成 read-only MCP execution v0，当前只允许 deterministic local executor 和安全摘要 observation。由于第一版可用闭环暂不依赖 MCP，后续优先级应先放在 Web/API/Skill/LP workflow 和 streaming 体验上。
- Artifact reader、metadata-only diff 和安全 snippet preview 已实现为 Agent 上下文读取边界；行级 textual diff、artifact patch workflow、桌面文件系统 workspace 和 diff 注入仍未做。
- 真实本地命令 runner、强 sandbox adapter、真实部署 runner、MCP worker execution、raw stdout/stderr streaming 仍未做；Stage 19 daemon / heartbeat / stale recovery 已实现为 safe simulated worker lifecycle 能力。
- 多 agent handoff 已有 LP 固定链路 v0；Stage 25 已实现恢复 UI 和第一批 retry/resume server actions，但团队审批和通用 DAG 仍未做。
- 真实登录、邀请、复杂 RBAC、团队审批队列和实时协作仍未做；当前 membership 是产品状态和审计上下文，不是完整安全边界。
- LP structured output token-level UI、Stage 29 v0 之外的高级 run timeline 交互，以及真正的 interrupt/cancel。

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
- `paas/v4` 真实执行需要走 `openai-completions` adapter；当前阶段已经补齐该 adapter，并通过 provider-backed runtime fake-fetch 测试覆盖接线路径。
- 学习重点是把真实外部 API 调用限制在模型网关边界内：密钥只在 adapter 内解析，返回给 runtime 的只有 provider、protocol、model、usage 和脱敏状态。
- 当前实现计划：[2026-05-14-anthropic-messages-adapter.md](./superpowers/plans/2026-05-14-anthropic-messages-adapter.md)
- `anthropic-messages` adapter 已可通过 `REAL_MODEL_RUNTIME=1` 的 provider-backed runtime 路径进入 Web/API flow；默认开发和测试仍保持 deterministic runtime。

已实现的真实 runtime 接线设计：

- [2026-05-14-real-model-runtime-wiring-design.md](./superpowers/specs/2026-05-14-real-model-runtime-wiring-design.md)
- 当前实现计划：[2026-05-14-real-model-runtime-wiring.md](./superpowers/plans/2026-05-14-real-model-runtime-wiring.md)
- 这一步把 `ProviderBackedModelGateway` 接入 Web/API/runtime，但必须通过 `REAL_MODEL_RUNTIME=1` 显式开启。
- `REAL_MODEL_PROVIDER_TEST=1` 只控制真实 provider 集成测试，不应该触发 Web/API 的真实模型运行。
- 这一阶段只验证真实模型能进入 run timeline，LP 产物仍保持 deterministic 静态 HTML/CSS/JS，不直接由模型输出驱动。
- 学习重点：真实模型接入不是把所有 runtime 都替换成网络调用，而是在服务边界增加可测试的 factory、env 开关、仓储 resolver、fake-fetch 单测和脱敏事件。
- 真实 runtime 必须在角色解析到默认或配置型 mock route 时 fail closed，否则用户会误以为已经跑了真实模型。

已实现的 OpenAI-compatible adapter 设计：

- [2026-05-14-openai-compatible-adapter-design.md](./superpowers/specs/2026-05-14-openai-compatible-adapter-design.md)
- 当前实现计划：[2026-05-14-openai-compatible-adapter.md](./superpowers/plans/2026-05-14-openai-compatible-adapter.md)
- 这一步把 `openai-completions` 从配置占位变成真实 Chat Completions 协议 adapter。
- 智谱 `https://open.bigmodel.cn/api/paas/v4` 是第一个目标，但 adapter 要保持通用，后续可接 OpenRouter、Ollama、LM Studio、vLLM 等 OpenAI-compatible provider。
- `openai-completions` 已接入 `ProviderBackedModelGateway` 和 Web/API runtime fake-fetch 覆盖；真实调用仍必须显式配置 provider route、API key env，并打开 `REAL_MODEL_RUNTIME=1`。
- 真实集成测试默认跳过；本地验证智谱 `paas/v4` 时使用 `OPENAI_COMPATIBLE_BASE_URL`、`OPENAI_COMPATIBLE_API_KEY`、`OPENAI_COMPATIBLE_DEFAULT_MODEL`。
- 学习重点：不同 provider 可以共享同一种协议 adapter，差异通过 `baseUrl`、`apiKeyEnv`、`model` 和少量兼容配置表达，不应该在 runtime 里写死某个厂商。

已实现的结构化 LP Brief 输出设计：

- [2026-05-14-structured-lp-brief-model-output-design.md](./superpowers/specs/2026-05-14-structured-lp-brief-model-output-design.md)
- 当前实现计划：[2026-05-14-structured-lp-brief-model-output.md](./superpowers/plans/2026-05-14-structured-lp-brief-model-output.md)
- Planner 在 `REAL_MODEL_RUNTIME=1` 下输出严格 JSON，并由 API 用 `LPBriefSchema` parse 后保存为 `BriefRecord`。
- 默认 deterministic runtime 继续使用 `sampleBrief`，确保本地开发、测试和 demo 稳定。
- raw model text 只允许作为内存中的瞬时值被解析，不能写入 run events、context packs、Web state 或 snapshots。
- 学习重点：真实模型输出进入业务流前必须经过 schema 边界；parse 失败要 fail closed 并写脱敏 `model.output.parse_failed` event，而不是默默回退到 mock 数据。

已实现的真实 Builder 静态产物输出设计：

- [2026-05-14-real-builder-static-artifacts-design.md](./superpowers/specs/2026-05-14-real-builder-static-artifacts-design.md)
- 当前实现计划：[2026-05-14-real-builder-static-artifacts.md](./superpowers/plans/2026-05-14-real-builder-static-artifacts.md)
- 这一步让 Builder 在 `REAL_MODEL_RUNTIME=1` 下输出严格 JSON：`indexHtml`、`stylesCss`、`scriptJs`。
- 产物仍然是框架无关静态 HTML/CSS/JS；Web 继续基于三文件产物生成 single-file HTML 预览和下载。
- Builder 输出必须经过 API 侧 parse 和 artifact policy validation，失败时 fail closed，不保存 page version。
- V1 允许外链图片、字体 CSS 和非框架品牌/素材 CSS；禁止外链 JavaScript、CSS 框架、React/Vue/Angular/Svelte 等框架或构建产物痕迹。
- API 已在 `REAL_MODEL_RUNTIME=1` 下把 Builder `modelOutputText` 解析为 canonical `StaticArtifacts`，成功时记录脱敏的 `model.output.parsed` 事件，失败时记录脱敏的 `model.output.parse_failed` 和 `run.failed` 事件。
- 失败路径不会静默回退到 deterministic artifacts，也不会保存 page version；默认未开启真实 runtime 时仍保留 deterministic Builder，保证本地开发和测试稳定。
- 学习重点：模型生成代码后不能直接落库或展示，必须先经过结构、资源策略、安全和框架无关校验。

已实现的 Stage 21 Model Repair、Retry 和 Fallback v0：

- [2026-05-19-model-repair-retry-fallback-design.md](./superpowers/specs/2026-05-19-model-repair-retry-fallback-design.md)
- 当前实现计划：[2026-05-19-model-repair-retry-fallback.md](./superpowers/plans/2026-05-19-model-repair-retry-fallback.md)
- 这一阶段只在 `REAL_MODEL_RUNTIME=1` 的真实模型路径上增加 Planner / Builder one-shot repair、provider 临时错误 bounded retry 和 fallback route 安全 metadata。
- repair 由 API 拥有，因为 `LPBriefSchema` 和 `StaticArtifactsSchema` 是业务边界；`model-gateway` 只负责一次模型请求和 provider 错误表达。
- repair prompt 不包含首次 raw model output 或 raw artifact 内容；它只包含原始业务输入、schema guide 和 parse / policy failure 的安全摘要。
- Planner repair 成功后才保存 repaired `BriefRecord`；Builder repair 成功后才保存 repaired static artifacts 和 page version。repair 失败仍 fail closed，并保留 `model.output.parse_failed`、`model.output.repair_started`、`model.output.repair_failed` 和 `run.failed` 的可审计 timeline。
- Provider retry 由 `runtime-adapters` 负责，只重试 timeout、网络失败、429、5xx 和 provider response JSON invalid 这类可恢复错误；配置错误不会重试。
- fallback v0 只暴露 metadata 和事件，不自动调用 fallback provider，也不静默回退到 deterministic `sampleBrief` 或 deterministic artifacts。
- lifecycle view 把已修复完成的 run 视为 completed，同时保留 parse failure history；fallback availability 只作为失败 run 的恢复提示，不把失败 run 标成成功。
- 学习重点：模型可靠性增强不能削弱 fail-closed 和可审计性。parse failure、repair attempt、retry attempt 和 fallback availability 都应该作为 timeline 事实出现，而不是藏在 adapter 内部。

已实现的 Stage 32 Provider Streaming and Usage Metadata v0：

- [2026-05-22-provider-streaming-usage-design.md](./superpowers/specs/2026-05-22-provider-streaming-usage-design.md)
- 当前实现计划：[2026-05-22-provider-streaming-usage.md](./superpowers/plans/2026-05-22-provider-streaming-usage.md)
- 这一阶段给真实 provider 路径增加 bounded usage/call metadata：provider-reported 或 estimated usage、total tokens、duration、attempt、supportsStreaming 和 streamingEnabled。
- v0 明确区分 `supportsStreaming` 和 `streamingEnabled`：前者是 route/model capability，后者是本次调用方式。本阶段默认仍不使用 provider streaming 请求，避免扰动 LP structured output parse / repair。
- metadata 会进入 `model.completed` runtime/run event 和 Web timeline compact summary；raw provider response、prompt、raw model output、base URL、secret 和 artifact content 仍不能进入 event、context 或 UI。
- 学习重点：真实 provider 可观察性要先稳定事实边界，再做 token delta UI。否则很容易把 streaming chunk、业务输出、run event 和最终可恢复事实混成一套不可审计状态。

已实现的 Stage 22 Postgres Repository Foundation v0：

- [2026-05-19-postgres-repository-foundation-design.md](./superpowers/specs/2026-05-19-postgres-repository-foundation-design.md)
- 当前实现计划：[2026-05-19-postgres-repository-foundation.md](./superpowers/plans/2026-05-19-postgres-repository-foundation.md)
- foundation v0 已保留 `in-memory` / `JSON-file` 默认路径，并通过显式 factory 提供 Prisma/Postgres backend。
- Prisma schema 已覆盖 Agent runtime 可观察性闭环的核心 repository records：project/task/message、run timeline、tool observation、handoff、artifact workspace metadata。
- 共享 repository contract tests 现在同时约束 `in-memory`、`JSON-file` 和 fake Prisma backend；Prisma mapper tests 覆盖 Date / JSON / optional field 转换，opt-in Postgres integration test 默认跳过，只有显式 `POSTGRES_REPOSITORY_TEST=1` 和 `DATABASE_URL` 才连接数据库。
- 学习重点：repository backend 是 Agent 可观察性和恢复语义的基础设施；切换存储层时，service 层应继续依赖 stable contract，而不是把 Prisma 细节泄漏到 runtime、context assembler 或 Web timeline。
- 数据层迁移不能削弱 Agent 的可观察性和安全边界。更 durable 的 Postgres 只应该保存安全摘要和受控 artifact 数据，不应该让 raw model output、raw tool output、secret 或完整 artifact 内容扩散到 timeline/context。

已实现的 Stage 23 Web Opt-in Postgres Backend Wiring v0：

- [2026-05-20-web-opt-in-postgres-backend-wiring-design.md](./superpowers/specs/2026-05-20-web-opt-in-postgres-backend-wiring-design.md)
- 当前实现计划：[2026-05-20-web-opt-in-postgres-backend-wiring.md](./superpowers/plans/2026-05-20-web-opt-in-postgres-backend-wiring.md)
- 这一阶段不是 production rollout，而是让 Web/API runtime 在显式 `WORKBENCH_REPOSITORY_BACKEND=postgres` 下选择 Prisma-backed `WorkbenchRepositories`；默认 Web backend 仍是 `.lp-agent/workbench-state.json` JSON-file state。
- Agent storage backend selection 是 runtime boundary，不是普通配置开关。切换 durable backend 时，必须保证同一个用户可见工作流读写同一套事实来源，否则 run timeline、context memory、approval、tool observation 和 Web 页面状态会互相矛盾。
- Web-facing repository closure 防止 Postgres + JSON split-brain：Web 页面会读取 project members、deployments、skills、models、MCP config/approval 等状态，只迁移 project/task/run 这类 core state 不够。
- Postgres backend 选择必须 fail closed：缺少 `DATABASE_URL`、缺少 `WORKBENCH_POSTGRES_WORKSPACE_ID`、Prisma client 初始化失败或 backend 值非法时，不应静默回退到 JSON-file。
- 全局 async store 初始化失败时需要清理 rejected Promise cache；否则一次失败会污染后续修正配置后的请求。
- `WORKBENCH_POSTGRES_BOOTSTRAP=1` 只 upsert local organization/workspace prerequisites，不运行 production migrations、不创建 hosted auth，也不迁移既有 JSON-file state。

已实现的 Stage 24 Worker Job Postgres Backend v0：

- [2026-05-20-worker-job-postgres-backend-design.md](./superpowers/specs/2026-05-20-worker-job-postgres-backend-design.md)
- 当前实现计划：[2026-05-20-worker-job-postgres-backend.md](./superpowers/plans/2026-05-20-worker-job-postgres-backend.md)
- 这一阶段已把 worker queue 的 durable backend 从 JSON-file 扩展到显式 opt-in 的 Postgres：`WorkerJobRepository`、`WorkerJobPayloadRepository` 和 `WorkerLogRepository` 都纳入范围。
- worker queue backend selection 是独立 runtime boundary：`WORKER_REPOSITORY_BACKEND=postgres` 只迁移 worker job / payload / log storage，不改变 `WORKBENCH_REPOSITORY_BACKEND` 或 Web workbench state。
- 默认 worker queue 仍是 JSON-file；`WORKER_REPOSITORY_BACKEND=postgres` 缺少 `DATABASE_URL`、Prisma client 初始化失败或 backend 值非法时 fail closed，不回退 JSON-file。
- Web enqueue 和 `apps/agent-worker` 现在共用 `createWorkerQueueRuntime()` backend factory，避免 Web 写 JSON queue、worker 读 Postgres queue 这类 split-brain。
- `pnpm worker:dev` 默认运行一次 shared queue worker，未设置 backend 时读取 JSON-file queue；旧 deterministic worker demo 需要显式 `AGENT_WORKER_MODE=demo`，避免默认 Web enqueue 和 worker consume 路径分裂。
- worker job Postgres backend 的关键语义是 claim token 条件更新：claim、heartbeat、complete claimed、running cancellation 和 stale recovery 都防止两个 worker 执行同一个 job。
- safe persisted payload 可以进入 Postgres，但只能保存现有 `WorkerJobPayloadRecord` 的安全字段：`command`、bounded `args`、`envNames`、`workingDirectory`、`timeoutMs`；仍不能保存 env values、secret、raw stdout/stderr、artifact content 或足以恢复任意 shell execution 的 payload。
- `WorkerJobPayload` 本阶段不强制 FK 到 `WorkerJob`，因为当前 `enqueueSafe()` 为了 cleanup safety 先保存 payload、再保存 job；强 FK 会破坏现有 contract，除非同时重写 runtime transaction boundary。
- worker lifecycle log 进入 Postgres 后仍 bounded 和 sanitized，只保留 allowlisted payload keys，不能把 raw execution data 扩散到 audit log。

已实现的 Stage 25 Run Recovery UI v0：

- [2026-05-20-run-recovery-ui-design.md](./superpowers/specs/2026-05-20-run-recovery-ui-design.md)
- 当前实施计划：[2026-05-20-run-recovery-ui.md](./superpowers/plans/2026-05-20-run-recovery-ui.md)
- 这一阶段已把 Stage 18 的 `RunLifecycleView`、安全 `diagnosticSummary` 和 recovery action contract 接到 Web task inline recovery block。
- Web task state 现在包含 recovery views；Web 只传 `taskId`、`runId` 和 action intent，页面展示 API 派生状态，不展示 raw lifecycle payload。
- recovery server action 会在执行前重新读取 repository state 并重新派生 lifecycle，不信任浏览器提交的 action availability。
- 用户可见层只展示 role、state、terminal summary、安全诊断和推荐动作；不读取 raw worker payload、raw run event、raw model output、raw tool output、secret、完整 artifact 内容或本机路径。
- `resume_worker_finalization` 只处理 worker job 已 terminal 但 run/tool observation finalization 不完整的场景，并复用已有幂等 finalizer。
- `retry_run` 只做 safely reconstructable single-run retry：创建新的 retry attempt / run id，不覆盖原 failed run，不自动重跑完整 `Planner -> Builder -> Reviewer -> Deployer` chain。
- 同一 `lp_generation` task 允许多次 LP 尝试后，recovery 不能只依赖单一 task snapshot：Planner retry 应按失败 run 的 `startedAt` 回看本次最近 user message，但只有该 message 仍是当前最新 user message，且当前 snapshot 输出没有越过该 failed run 时才可执行；Builder / Reviewer / Deployer retry 应优先使用失败 run 自己的 `handoff.consumed` event 中的 `artifactRefs.briefId` / `artifactRefs.pageVersionId`，再 fallback 到可证明仍对应当前 failed run 的 snapshot 兼容旧数据。
- 同一 `lp_generation` task 继续修改时，Builder context 使用 task snapshot 中的 previous page version 显式传入 `contextPageVersionId`，从而注入上一版 artifact workspace metadata；不要依赖“项目最新 page version”推断，否则同项目其它版本会污染本次修改上下文。
- 输入无法从 repository 安全重建、目标输出会被覆盖、approval/blocker 语义不清或 side effect 不具备幂等性时，recovery action 必须 fail closed，并让 UI 展示 `inspect_manually` 或对应 guidance。
- `retry_run` 已明确对 unsupported side-effect contexts fail closed：`skillCommand:` / deployment 和 `mcpTool:` 这类命令或工具 run 不进入 Stage 25 可执行 retry 范围，recovery view 只给 `inspect_manually` 等 guidance。
- Web skill command forms 会携带当前 task scope；API 会校验 task 属于同一 project，并把 `taskId` 写入 run、run events 和 tool observation，让 worker finalization gaps 能从 task recovery UI 被发现和恢复。
- `skill_command` retry 默认不进入 Stage 25 可执行范围；带外部 side effect 的命令重试需要独立的 approval / idempotency / audit contract。
- 学习重点：recovery action contract 变成产品按钮时，必须在 server action 里重新派生当前 lifecycle，不信任浏览器提交的 action availability。可执行恢复动作不是“把失败 run 再跑一次”，而是受 ownership、input reconstruction、output conflict、approval 和 side-effect 边界约束的业务动作。

已实现的 Stage 26 Streaming Chat Transport and UI v0：

- [2026-05-20-streaming-chat-transport-ui-design.md](./superpowers/specs/2026-05-20-streaming-chat-transport-ui-design.md)
- 当前实施计划：[2026-05-20-streaming-chat-transport-ui.md](./superpowers/plans/2026-05-20-streaming-chat-transport-ui.md)
- 这一阶段已把普通聊天的实时反馈边界落到 Web/API：streaming route 先持久化 user message 和 placeholder assistant message，再用 NDJSON 输出 assistant delta、terminal status 和 safe error。
- 客户端 streaming state 是暂态 UI 层，不是新的事实来源；收到 terminal event 或刷新页面后，仍以 repository 中的 message / task state 为准。
- LP / project setup 没被塞进 streaming route，仍回退到既有 `submitPromptAction` server action，避免 project bootstrap、artifact workflow 和普通聊天运行语义互相污染。
- 普通聊天入口会显式传递 null task routing，让新输入脱离 stale task cookie，避免用户退出旧任务后仍被错误路由到旧 task。
- 学习重点：streaming 是 UI 反馈边界，不等于 provider token streaming 或 tool-call protocol。Stage 27 已把真实普通聊天 runtime 和 skill context 接入这条边界，但 stream 仍只输出安全事件，并在 terminal event 或刷新后回到 repository facts。

已实现的 Stage 4 Skill Command MVP：

- [2026-05-14-skill-command-execution-design.md](./superpowers/specs/2026-05-14-skill-command-execution-design.md)
- 当前实现计划：[2026-05-14-skill-command-execution.md](./superpowers/plans/2026-05-14-skill-command-execution.md)
- 这一步在 API/service 层打通了已发布 `deployment` skill 预声明 command 的受控执行，不开放任意 shell 输入。
- 执行入口会校验项目绑定、skill 发布状态、权限、一次性 approval、secret reference、模板变量和可选 page version 归属，再调用 `ToolCommandRunner`。
- `ToolCommandRunner` 是 adapter 边界；当前 MVP 在 API 进程内通过注入 runner 执行，默认 runner 拒绝执行，后续仍可迁移到 `apps/agent-worker`、队列、流式日志和 cancel。
- 命令结果会保存为脱敏 `ToolObservationRecord`，并写入脱敏的 `tool.started`、`tool.completed` 或 `tool.failed` run event；事件和 observation 不保存 raw secret、完整 stdout/stderr 或 artifact 内容。
- 这不是完整自动部署系统，也还没有部署 UI、worker 执行、MCP execution、流式日志、cancel/retry 或部署编排。

已实现的 Stage 4.1 Skill Command Web 模拟执行闭环：

- [2026-05-15-skill-command-web-loop-design.md](./superpowers/specs/2026-05-15-skill-command-web-loop-design.md)
- 当前实现计划：[2026-05-15-skill-command-web-loop.md](./superpowers/plans/2026-05-15-skill-command-web-loop.md)
- 这一步把 API/service command execution 边界接到了 Web 工作台：用户可以从项目绑定 skills 发现可执行 commands，进行一次性审批，通过 server action 触发模拟 runner，并在对话 timeline 中看到 `tool.started`、`tool.completed` 或 `tool.failed`。
- 这个闭环的意义是让 agent 工具过程从“后端能力”变成“可见、可审计、可恢复的产品流程”：skill command 发现、approval、server action、run events、observation 和 chat timeline 使用同一套受控边界。
- 第一版仍然是模拟执行 loop，不跑真实 shell，不做真实部署，不接真实 deployment adapter，不做 worker 队列，不做流式日志，也不做 cancel/retry。
- 后续真实 deployment adapter 应继续按 adapter/runner 方式迭代，把真实部署执行替换到 `ToolCommandRunner` 边界之后，而不是绕过 API 校验、approval、run events 或 observation。
- UI 只展示 allowlist metadata 和安全输出摘要；raw stdout/stderr、secret、完整 artifact 内容和未脱敏错误都不应该进入 timeline。
- 这一步的学习重点是区分“产品流程可用”和“真实工具执行”：Web 可以先打通发现、审批、调用、observation、timeline 的完整体验，同时继续保留以后切换真实 runner、MCP execution 和部署编排的边界。

本轮 Stage 4.1 最终验证命令：

```bash
pnpm exec vitest run packages/api/src/services.test.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts apps/web/src/lib/chat-workbench.test.ts apps/web/src/lib/i18n.test.ts
pnpm typecheck
pnpm build
```

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

已实现的 Skill Command 执行 MVP：

- [2026-05-14-skill-command-execution-design.md](./superpowers/specs/2026-05-14-skill-command-execution-design.md)
- 当前实现计划：[2026-05-14-skill-command-execution.md](./superpowers/plans/2026-05-14-skill-command-execution.md)
- 第一版已经在 API/service 层实现已发布 `deployment` skill 预声明 command 的受控执行，不开放任意 shell 输入。
- 每次 command 执行都需要一次性显式审批，通过 API 侧校验 skill 绑定、发布状态、权限、secret reference、模板变量和可选 page version 归属后再调用 runner。
- `ToolCommandRunner` 是 adapter 边界；当前 MVP 通过注入 runner 执行，默认 runner 拒绝执行，后续再迁移到 `apps/agent-worker`、队列、流式日志和 cancel。
- `ToolObservationRecord` 是后续 MCP/tool execution、部署 skill、文件操作共享的 observation 底座；当前事件和 observation 已做脱敏，不保存 raw secret、完整 stdout/stderr 或 artifact 内容。
- 这一步不是完整自动部署系统，也还没有自动部署 UI、worker 执行或 MCP execution，而是给未来部署 workflow 提供安全、可审计的 skill cmd 执行入口。
- 实现时要把“能执行命令”和“安全边界”分开看：manifest 只声明允许执行什么，API 负责校验绑定、发布状态、审批、权限、secret reference、模板变量和 page version 归属，runner 只拿到已经解析好的 argv/env/workingDirectory。
- 这一步已经形成 `ToolCommandRunner`、`ToolObservationRecord`、`tool.started/tool.completed/tool.failed` 的最小闭环，后续再逐步扩展到 MCP execution、worker 队列、流式日志、cancel/retry 和部署编排。

已实现的 Skill Command Web 模拟执行闭环：

- [2026-05-15-skill-command-web-loop-design.md](./superpowers/specs/2026-05-15-skill-command-web-loop-design.md)
- 当前实现计划：[2026-05-15-skill-command-web-loop.md](./superpowers/plans/2026-05-15-skill-command-web-loop.md)
- Web 里的 command 发现、一次性审批、模拟执行、run event 展示已经打通。
- 这个阶段没有引入真实 shell、真实部署、真实 deployment adapter、worker 队列、流式日志、cancel/retry 或 MCP execution。
- 这能让工具执行从“后端能力”变成“用户可见的 Agent 工具过程”，同时保持后续切换真实 runner 的架构边界。
- 工具输出必须拆分 raw output 和 metadata summary；UI 只展示 allowlist metadata 与安全摘要，raw stdout/stderr、secret 和完整 artifact 内容留在受控 observation/日志边界内。
- 命令执行必须持续受 approval、permission、secret redaction、scope、project/pageVersion 绑定约束；run event 要设计成可检索、可过滤、可压缩的数据，而不是只给 UI 看的一段文本。

### 阶段 5：压缩和检索

已实现的 Stage 5 Context Memory Retrieval v0：

- [2026-05-15-context-memory-retrieval-design.md](./superpowers/specs/2026-05-15-context-memory-retrieval-design.md)
- 当前实现计划：[2026-05-15-context-memory-retrieval.md](./superpowers/plans/2026-05-15-context-memory-retrieval.md)
- `ContextPack` 现在会注入 deterministic `ContextMemory`，把同 project 内的 message、run、tool observation 和 artifact metadata 生成受预算约束的摘要。
- 真实模型 runtime 和 deterministic runtime 都通过同一个 runtime/model context 边界接收 memory；deterministic output 仍保持稳定，方便本地开发和测试。
- memory trace 会记录注入数量、检索策略和省略原因，方便判断哪些历史进入了上下文、哪些因为预算或范围被跳过。
- v0 仍不做向量数据库、embedding、模型生成摘要、跨项目长期记忆、跨用户长期记忆、持久 summary repository、selected file snippets 或高级压缩。
- raw tool output、secret、完整 artifact 和 raw model text 都不能进入 memory；工具 observation 只能注入安全摘要、状态、退出码、错误名和 source id 等 allowlist metadata。

后续重点关注：

- 向量或混合检索。
- 持久摘要仓库和缓存失效策略。
- selected file snippets 的安全预算和源码脱敏规则。
- 更高级的压缩策略和长期记忆权限边界。

学习重点：

- 不是所有历史都有价值。
- 检索结果也要受权限和上下文预算控制。
- 摘要本身需要可更新、可追溯。

### 阶段 6：多 Agent 协作

已实现的 Agent Handoff State v0：

- [2026-05-15-agent-handoff-state-design.md](./superpowers/specs/2026-05-15-agent-handoff-state-design.md)
- 当前实现计划：[2026-05-15-agent-handoff-state.md](./superpowers/plans/2026-05-15-agent-handoff-state.md)
- 第一版只覆盖 LP 固定链路：Planner -> Builder -> Reviewer -> Deployer，不做开放式 agent swarm 或通用 DAG。
- handoff 是 repository 里的结构化状态，同时写入 `handoff.created`、`handoff.blocked`、`handoff.consumed` run event，供 timeline 和 Context Pack 使用。
- Reviewer 不通过时会写 `blocked` handoff，并阻止 Deployer run 创建；retry/resume、团队审批和 UI handoff 卡片后续再做。
- 学习重点是把“角色之间怎么交接”从隐含顺序变成可查询、可审计、可恢复的运行状态。

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

### 阶段 7：团队协作最小闭环

当前设计：

- [2026-05-17-collaboration-primitives-design.md](./superpowers/specs/2026-05-17-collaboration-primitives-design.md)
- 当前实现计划：[2026-05-17-collaboration-primitives.md](./superpowers/plans/2026-05-17-collaboration-primitives.md)
- Stage 7 v0 已实现本地 `local-web-user` identity helper、project owner membership 自动创建、workspace/project member repository、JSON-file 持久化和 Web 项目成员只读展示。
- 当前仍不做真实 auth、邀请、复杂 RBAC 或实时协作；membership 是产品状态，不是完整安全边界。
- 这一阶段先把本地用户身份、workspace/project member、项目 owner、审批 actor 和成员展示做成可持久、可审计的产品状态。
- 这不是完整 auth 系统：不做登录注册、OAuth、SSO、邀请邮件、计费席位、实时协作或完整 RBAC。
- Web V1 继续使用 `local-web-user` 这类确定性的本地身份，但身份要通过 helper/resolver 注入，后续才能替换成真实登录、桌面本地 profile 或公司 SSO。
- 项目创建时自动创建 owner membership，让“谁拥有这个项目”不再只是 UI 假设。
- MCP tool approval、skill command approval、未来 deployment approval 都应该通过统一 actor 来源写入审计字段，不能信任表单里提交的 `approvedByUserId`。
- 第一版成员信息默认不注入模型上下文；先稳定 durable state 和审计边界，再考虑 role-aware collaboration context。

学习重点：

- 本地身份不是认证，只是开发期 actor seam。
- membership 是产品状态，v0 还不是安全边界。
- 审批和工具执行必须记录 actor，后续才能做团队审计、权限和恢复。
- 团队协作应先做可见、可查、可测试的状态，不急着做实时多人编辑。

### 阶段 8：Worker / Sandbox Runtime Foundation

当前设计：

- [2026-05-17-worker-sandbox-runtime-design.md](./superpowers/specs/2026-05-17-worker-sandbox-runtime-design.md)
- 第一版采用 contract-first：新建 `packages/worker-runtime`，定义 `WorkerJob`、`SandboxPolicy`、`ExecutionAdapter`、内存 job runtime，并通过 worker-backed `ToolCommandRunner` 接入现有 API 边界。
- 这一阶段不开放真实 shell，不使用 `child_process`，不做 Docker/Firecracker 等强沙箱，不做 MCP execution，也不做 Web UI。
- 默认 policy 是 reject；simulate adapter 只用于 deterministic 测试和链路验证。
- Stage 8 的价值是让后续真实 deployment runner、MCP execution、文件操作、队列 worker、cancel/retry 和强 sandbox 都复用同一套 job/policy/observation 思路。

当前计划：

- [2026-05-17-worker-sandbox-runtime.md](./superpowers/plans/2026-05-17-worker-sandbox-runtime.md)

当前实现状态：

- Stage 8 v0 已实现 `@lp-agent/worker-runtime`。
- API 已提供显式注入的 `WorkerBackedToolCommandRunner`。
- 默认 API runner 仍 reject，Web 仍走原模拟 runner。
- 当前仍无真实 shell/MCP execution/OS 级 sandbox。
- 输出 summary 已做 byte bound 和已知 env value redaction，路径检查只是 v0 lexical precheck。

学习重点：

- worker job 是执行状态，不是聊天消息。
- sandbox policy 是产品和运行时约束，不等同于 OS 级安全隔离。
- 先有 contract 和可测试状态机，再接真实执行。
- 不要把 shell 执行藏在 API service 里；真实执行必须挂在 adapter 后面。
- 真实执行能力不应该和 job 状态机同时上线；先让 adapter 形状、policy 拒绝路径和 observation 映射稳定下来。

### 阶段 9：Worker Job Persistence Foundation

当前设计：

- [2026-05-17-worker-job-persistence-design.md](./superpowers/specs/2026-05-17-worker-job-persistence-design.md)
- 这一阶段把 worker job record 从 runtime 内部数组抽象成 `WorkerJobRepository`，并提供 in-memory 与 JSON-file 两种实现。
- 持久化的是安全的 `WorkerJobRecord`：状态、policy、input summary、bounded/redacted result summary 和时间戳；不持久化 raw args、raw env、secret、artifact content 或足够恢复执行的 payload。
- 重启后可以查看历史 worker job；但 queued job 因为缺少进程内 execution payload，不会被自动恢复执行，而是显式 fail-closed。
- 这一阶段仍不做真实 shell、MCP execution、agent-worker queue、Web UI 或 OS 级 sandbox。

当前计划：

- [2026-05-17-worker-job-persistence.md](./superpowers/plans/2026-05-17-worker-job-persistence.md)

当前实现状态：

- Stage 9 v0 已实现 `WorkerJobRepository`、`InMemoryWorkerJobRepository` 和 `JsonFileWorkerJobRepository`。
- `InMemoryWorkerRuntime` 已改为通过 repository 持久化安全 job record，raw args/env 仍只保留在进程内 payload map。
- JSON-file worker job persistence 只保存 bounded/redacted record，不保存执行 payload；重启后 queued job 会以 `worker_job_payload_unavailable` fail-closed。
- 同一 runtime 内 enqueue 和 runNext 已串行化，避免并发 id 分配冲突和重复 claim 同一个 queued job。

学习重点：

- job persistence 和 execution replay 是两个不同问题。
- 先持久化安全 record，再讨论队列和真实执行，能避免把 secret 和危险 payload 过早写进本地文件。
- repository 边界应属于 `worker-runtime`，不要把 worker 执行状态强绑到 Web workbench 的 `packages/db`。
- 重启恢复要 fail-closed；看得见状态比静默重跑更重要。

### 阶段 10：Worker Job Cancel / Interrupt Foundation

当前设计：

- [2026-05-17-worker-job-cancel-interrupt-design.md](./superpowers/specs/2026-05-17-worker-job-cancel-interrupt-design.md)
- 这一阶段先做 worker-runtime 和 API 层的取消/中断底座，不改 Web UI，不接真实 shell，不做 MCP execution，也不做 agent-worker queue。
- queued job 可以立即取消并落到 `cancelled`；running job 采用协作式取消，只记录 `cancelRequestedAt` 和可选 `cancelReason`，由 adapter 通过 cancellation context 感知后返回 cancelled。
- worker record 只增加最小取消元数据：`cancelRequestedAt`、`cancelledAt`、`cancelReason?`，不写 actor，用户身份和团队审计后续留给 API run event / collaboration 层。

当前计划：

- [2026-05-17-worker-job-cancel-interrupt.md](./superpowers/plans/2026-05-17-worker-job-cancel-interrupt.md)

当前实现状态：

- Stage 10 v0 已实现 `WorkerRuntime.cancelJob()`。
- queued worker job 可立即落到 `cancelled`，并持久化 `cancelRequestedAt`、`cancelledAt`、`completedAt` 和 bounded `cancelReason`。
- running worker job 采用协作式取消：runtime 记录 `cancelRequestedAt`，adapter 通过 `ExecutionContext.isCancellationRequested()` 感知取消请求。
- queued-to-running 竞态通过 per-job mutation lock 处理，避免取消请求被长时间运行的 adapter 阻塞。
- `WorkerBackedToolCommandRunner` 已能把 cancelled worker job 映射为 `ToolCommandRunResult.state === "cancelled"`；现有 skill command service 仍把非 completed 命令结果落为 failed run/tool observation。

学习重点：

- interrupt 不是强杀进程；在真实执行能力上线前，先把“请求取消”和“确实取消完成”分开建模。
- queued cancellation 和 running cooperative cancellation 是两种不同状态转换。
- 取消原因是用户输入，需要 bounded persistence，不能保存 secret、raw args/env 或 artifact 内容。
- API runner 可以返回 `cancelled`，但产品级 run timeline 的取消事件和 Web interrupt 按钮应作为后续阶段单独设计。

### 阶段 11：Worker Queue Handoff v0

当前设计：

- [2026-05-17-worker-queue-handoff-design.md](./superpowers/specs/2026-05-17-worker-queue-handoff-design.md)
- 这一阶段把 worker job 从 API 进程内同步执行推进到跨进程 handoff：API 或测试可以入队安全 worker job，`apps/agent-worker` 可以从共享 repository 领取并执行一个 job。
- 第一版只支持 `simulate` / `reject` 安全 payload；不持久化 raw env value、secret、artifact 内容，也不开放真实 shell。
- Stage 11 会引入 claim metadata 和 claim token，避免多个 worker 或过期 worker 重复完成同一个 job。

当前计划：

- [2026-05-18-worker-queue-handoff.md](./superpowers/plans/2026-05-18-worker-queue-handoff.md)

当前实现状态：

- Stage 11 v0 已实现安全 worker queue handoff：一个 runtime 可以入队 safe simulated worker job，另一个 runtime 或 `apps/agent-worker` 可以通过共享 repository claim 并完成该 job。
- safe worker payload 只持久化 bounded args、env names 和 command metadata，不持久化 raw env value、secret 或 artifact 内容。
- worker claim 会写入 `claimedByWorkerId` 和 `claimToken`；claimed job completion 必须匹配 claim token，避免 stale worker 覆盖状态。
- claimed job completion、queued cancellation 和 running cancellation 都通过 repository 条件更新维护状态机，避免 stale snapshot 覆盖 running 或 terminal job。
- `apps/agent-worker` 已提供 `runWorkerOnce()`，但仍不做 daemon polling、真实 shell、MCP execution、streaming logs 或 deployment skill worker execution。

学习重点：

- worker queue handoff 和真实执行是两个阶段。先解决 claim、payload、complete、cancel 的状态机，再讨论 shell、MCP 或部署。
- 跨进程执行必须有可持久的 payload，但 payload 不能为了“能跑”而保存 secret 或完整 artifact。
- running job 的取消在跨进程场景里仍应是协作式的：runtime 记录取消请求，worker adapter 主动检查 cancellation context。
- claim token 是防止 stale worker 覆盖状态的并发边界，不是用户身份或授权信息。

### 阶段 12：Web/API Interrupt Wiring v0

当前设计：

- [2026-05-18-web-api-interrupt-wiring-design.md](./superpowers/specs/2026-05-18-web-api-interrupt-wiring-design.md)
- 这一阶段把 Web 里的“打断/停止”按钮接到 API 和 worker cancel 底座上，但只覆盖当前会话任务，不做批量取消、不做部署、不做真实 shell signal，也不做 MCP execution。
- 用户点击停止后，前端先进入 optimistic `正在停止...` 状态；真正的持久状态仍以 repository 里的 task/run/worker event 为准。
- API 不接受客户端传入的 worker job id，而是根据当前 task 推导它关联的 run / worker job，避免用户从浏览器任意取消其它 job。

当前计划：

- [2026-05-18-web-api-interrupt-wiring.md](./superpowers/plans/2026-05-18-web-api-interrupt-wiring.md)

当前实现状态：

- Stage 12 v0 已实现当前任务 Web/API interrupt wiring：Web action 从当前 task cookie 读取任务，API 根据 task/run/worker link 推导取消目标，前端按钮支持 optimistic `正在停止...`，chat timeline 能区分 running、cancelled 和 failed。
- 这一阶段仍不做真实 shell signal、MCP execution、deployment execution、streaming logs、worker daemon 控制或批量取消。

学习重点：

- 产品里的 interrupt 不是底层 kill。第一版要把“用户请求停止”“系统正在停止”“实际已经取消”分开表达。
- optimistic UI 只能改善反馈速度，不能替代服务端状态；刷新后的事实必须来自持久化事件。
- 客户端只应该表达用户意图，例如“停止当前任务”，不要直接暴露 worker job id 这种内部执行标识。
- task / run / worker job 的关联可以先用安全 run event 表达，后续再正规化成数据库表，避免第一版直接引入过重调度系统。

### 阶段 13：Web Worker Queue Integration v0

当前设计：

- [2026-05-18-web-worker-queue-integration-design.md](./superpowers/specs/2026-05-18-web-worker-queue-integration-design.md)
- 这一阶段把现有 Web skill command loop 从“Web 内模拟执行”推进到“Web 入队、Worker 执行、Web 可观察”的本地闭环。
- 用户在 Skills 页面批准并入队一个 queueable deployment skill command；Web 再提供 `Run local worker once` / `运行一次本地 Worker` 操作，最多 claim 并执行一个安全 queued worker job。
- 第一版只支持 safe simulated worker payload，不持久化 raw env value、secret、完整 artifact 内容，也不做真实 shell、MCP execution、真实部署、daemon 或 streaming logs。

当前计划：

- [2026-05-18-web-worker-queue-integration.md](./superpowers/plans/2026-05-18-web-worker-queue-integration.md)

当前实现状态：

- Stage 13 v0 已把 Web deployment skill command 接到本地 safe worker queue：Web 负责批准并入队，API 写入 run/tool/worker link，`Run local worker once` / `运行一次本地 Worker` 最多执行一个同项目 queued job，并把结果 finalization 回 run 和 observation。
- 当前本地 Web 默认使用 JSON-file worker queue 文件，enqueue、interrupt 和 run-once 共用同一个 local worker runtime；run-once 已做 project-scoped claim，避免项目 A 误执行项目 B 的队列任务。
- 当前仍只支持 safe simulated worker payload，不做 daemon、真实 shell、MCP execution、真实部署、streaming logs、secret payload 或 durable artifact workspace replay。

学习重点：

- worker queue 的产品闭环要分成 enqueue、claim、execute、finalize 四段，而不是把所有事情塞进一次 Web request。
- 入队成功不等于任务完成；run/tool observation 需要先记录 queued/running，再由 worker 完成结果反向 finalization。
- safe payload 能证明跨进程 handoff，但不能为了方便执行而保存 secret、artifact 文件内容或不可控命令。
- Web 上的本地 worker 按钮是 daemon 前的过渡形态；后续真正 daemon、MCP execution、真实 sandbox 和 streaming logs 都应复用同一套 queue/finalizer 边界。

### 阶段 14：Durable Artifact Workspace v0

当前设计：

- [2026-05-18-durable-artifact-workspace-design.md](./superpowers/specs/2026-05-18-durable-artifact-workspace-design.md)
- 这一阶段把生成的 `index.html`、`styles.css`、`script.js` 从“只在 page version 里保存的内容”推进为“可持久引用的 artifact workspace”。
- workspace v0 会保存本地 JSON-file artifact workspace record、file record、manifest、hash、size 和安全 summary，让刷新或重启后仍能恢复静态 LP 产物。
- Context Pack 和未来 worker/deploy payload 默认只拿 workspace id、文件 manifest、hash、size、summary，不直接注入完整文件内容。
- 第一版仍不做真实部署、真实 shell、MCP execution、对象存储、Postgres blob、桌面本地目录映射或文件编辑 UI。

当前计划：

- [2026-05-18-durable-artifact-workspace.md](./superpowers/plans/2026-05-18-durable-artifact-workspace.md)

当前实现状态：

- Stage 14 v0 已实现本地 durable artifact workspace：`@lp-agent/artifacts` 提供 manifest/hash/summary 纯 helper，`@lp-agent/db` 持久化 workspace/file repository，API 在 page version 生成时创建 workspace 并发出 metadata-only 事件。
- Web/API snapshot 会优先从 workspace files 恢复静态 LP 产物；workspace 缺失、不完整或损坏时回退到 page version 内嵌 artifacts。
- Context Memory、Context Pack、runtime context 和 model request 只注入 workspace id、file manifest、hash、size、summary，不注入完整 HTML/CSS/JS 内容。
- reviewer/deployer 这类以明确 page version 为目标的 run，会把 runtime artifact workspace 绑定到目标 page version，而不是项目最新版本。

学习重点：

- artifact workspace 是“产物状态边界”，不是执行权限边界。
- 产物恢复必须校验 ownership：workspace 和 files 的 `projectId` / `pageVersionId` 不匹配时要 fail closed，不能 silent fallback 到错误内容。
- 在没有跨 repository 事务的 v0 中，写入顺序要避免危险引用：先保存 workspace/files，最后保存指向它们的 page version。
- 本地 JSON-file 载入 artifact file record 时也要重算 `sizeBytes` 和 `sha256`，避免损坏的 metadata 被当成可信 manifest 继续传播。
- worker 或部署系统以后应该拿 `artifactWorkspaceId` 和 file manifest，而不是拿 raw artifact 内容或本机绝对路径。
- Context Pack 默认注入 metadata，不注入全文；需要全文时应通过受控 artifact reader 按路径、大小、项目归属和权限读取。
- runtime adapter 和 model gateway 是模型请求边界，也要 whitelist artifact metadata 字段，不能把污染的 `content` 字段透传给模型。
- 本地 JSON-file content snapshot 是 Web MVP 的过渡实现，未来可以用同一 repository contract 换成对象存储、Postgres 元数据或桌面本地目录。

### 阶段 15：Artifact Reader and Static Diff v0

当前设计：

- [2026-05-18-artifact-reader-static-diff-design.md](./superpowers/specs/2026-05-18-artifact-reader-static-diff-design.md)
- 这一阶段给 Stage 14 的 durable artifact workspace 补一个受控读取边界：调用方必须提供 project、workspace、允许的静态 LP 路径和可选 page version，系统校验归属、路径 allowlist、文件完整性和大小限制后，才允许读取单个文件。
- 默认仍是 metadata-first：Context Pack、runtime context、model request、run event 和 worker payload 不应该默认携带完整 HTML/CSS/JS。
- v0 diff 只做 metadata-only 静态 diff，比较 `index.html`、`styles.css`、`script.js` 的 hash、size 和 summary，不做行级文本 diff，也不显示完整源码。
- 这一阶段仍不做 MCP execution、真实部署、真实 shell、桌面本地文件夹映射、文件编辑 UI、大文件 chunking 或二进制资产。

当前计划：

- [2026-05-18-artifact-reader-static-diff.md](./superpowers/plans/2026-05-18-artifact-reader-static-diff.md)

当前实现状态：

- Stage 15 v0 已实现受控 artifact reader：读取单个 workspace file 前会校验 project、workspace、page version、路径 allowlist、文件归属和 hash/size 完整性。
- Stage 15 v0 已实现 metadata-only static diff：比较两个 workspace 或两个 page version 的 `index.html`、`styles.css`、`script.js`，默认只返回 hash、size、summary 和 changed/added/removed/unchanged 状态。
- Context Pack 已支持显式 opt-in 的 bounded artifact snippets；默认不注入 snippets，runtime/model context 仍保持 metadata-only。

学习重点：

- artifact workspace 解决“产物在哪里”，artifact reader 解决“谁可以按什么规则读取产物”。
- diff 先从 metadata-only 开始，比一开始做源码级 diff 更适合 Agent MVP：它能支持 Reviewer、部署 skill、MCP 和桌面版的安全边界，又不会把完整文件到处传播。
- 未来 MCP/deployment/desktop 读取产物时，应该复用 reader 和 diff contract，而不是绕过 API 直接读 repository、JSON-file 或本机绝对路径。
- 需要把 preview/export 这种用户下载场景和 context/model/snippet 这种 Agent 上下文场景分开：前者可以恢复完整产物，后者必须受路径、归属和大小限制。
- 实现时要把 snippet 放在 Context Pack 的显式 opt-in 区域，不默认进入 runtime/model context；这样既能为 Reviewer/MCP 预留小片段读取能力，又能保持模型请求边界默认 metadata-only。

### 阶段 16：Artifact Metadata Exposure Boundary v0

当前设计：

- [2026-05-19-web-artifact-diff-cards-design.md](./superpowers/specs/2026-05-19-web-artifact-diff-cards-design.md)
- 这一阶段把 Stage 15 的 artifact reader / static diff 能力暴露到用户可见的 Agent 交付边界里，但学习重点不是 Web UI，而是“默认 metadata-only，显式读取 bounded snippet”这条安全边界。
- 默认只传播路径、状态、大小、短 hash 和 summary，不传播完整源码。
- 用户显式选择单个 canonical path 时，系统通过 artifact reader 读取最多 8KB snippet；非法 path、超限、workspace 缺失或文件损坏都只返回安全错误，不回显原始输入。
- 这一阶段仍不做 MCP execution、真实部署、真实 shell、桌面本地文件夹映射、文件编辑或 line-level diff。

当前计划：

- [2026-05-19-web-artifact-diff-cards.md](./superpowers/plans/2026-05-19-web-artifact-diff-cards.md)

当前实现状态：

- Agent 交付边界已能给出 artifact metadata diff，默认只展示路径、状态、大小、短 hash 和 summary。
- `artifactPath` 这类来自浏览器的输入会在服务端归一化后进入 Web store；重复参数取第一个值，非法 path 只返回通用不可用信息，不回显原始 query。
- 显式选择 `index.html`、`styles.css` 或 `script.js` 时，只通过 artifact reader 读取一个最多 8KB 的只读 snippet；超限内容只显示 size-limit 状态，不展示内容。

学习重点：

- preview/export 和 Agent snippet preview 是两个不同场景：前者服务用户下载完整产物，后者必须经过 reader 边界并受路径、归属和大小限制。
- metadata-only 默认策略可以让用户理解文件变化，同时避免把 artifact content 扩散到页面、日志、上下文或模型请求。
- 通过 URL query 触发 snippet preview 时，project/workspace/pageVersion 仍应由服务端会话和 repository 状态决定，不能信任浏览器传入这些归属字段。
- 初始版本没有 previous workspace 时，不应该伪造 diff；可以显示 `initial` 文件摘要，让用户知道当前产物状态。

### 阶段 18：Agent Run Lifecycle and Recovery v0

当前设计：

- [2026-05-19-agent-run-lifecycle-recovery-design.md](./superpowers/specs/2026-05-19-agent-run-lifecycle-recovery-design.md)
- 这一阶段给已有 run records、run events、worker jobs、tool observations 和 handoff records 补一个统一 lifecycle / recovery 派生层。
- 核心产物是 API 侧 `RunLifecycleView`：从 repository state 派生 `queued`、`running`、`waiting_for_approval`、`blocked`、`cancelling`、`cancelled`、`failed` 和 `completed`。
- 第一版不新增数据库表，不迁移 JSON-file state，也不把所有派生状态写回 `RunRecord`；它先让状态推断和失败诊断有一个单一、可测试的边界。
- recovery 只做 contract：`retry_run`、`resume_worker_finalization`、`request_approval`、`resolve_blocker`、`inspect_manually`。本阶段不做 Web retry 按钮、不自动重跑 agent chain，也不实现通用 scheduler。
- worker-backed skill command finalizer 要补幂等语义，让 local worker run-once、未来 daemon 和人工 resume finalization 可以安全重复调用。

当前计划：

- [2026-05-19-agent-run-lifecycle-recovery.md](./superpowers/plans/2026-05-19-agent-run-lifecycle-recovery.md)

当前实现状态：

- Stage 18 v0 已实现 API 侧 `RunLifecycleView`，从 run record、run event、worker job、tool observation 和 handoff 派生统一 lifecycle state。
- failed、blocked、missing worker、terminal event conflict 和 incomplete worker finalization 会返回安全 `diagnosticSummary` 与 recovery action contract。
- worker-backed skill command finalizer 已强化幂等性，重复 finalization 不重复写 terminal events，冲突 terminal state 会 fail closed。

学习重点：

- Agent run 状态不是单个字段能表达完整事实；它通常由 run record、event timeline、tool observation、worker job 和 handoff 一起决定。
- 派生 view 和持久化事实要分开。`RunRecord` 保存当前事实，`RunLifecycleView` 负责为 UI、context、daemon 和 future retry 提供一致解释。
- recovery action contract 先表达“可以做什么”，不要急着自动执行。失败原因、approval、blocked handoff、missing worker 和 terminal event 冲突需要不同恢复路径。
- 失败诊断必须是安全摘要，不能为了方便排查把 raw stdout/stderr、raw model text、secret、完整 artifact 或本机路径注入 UI、context memory 或模型请求。
- finalizer 幂等性是 worker daemon、MCP execution 和真实工具执行的前置条件；否则重复 claim、重启恢复或人工 resume 都可能制造重复 terminal events。

### 阶段 19：Worker Daemon、Heartbeat 和 Streaming Logs v0

当前设计：

- [2026-05-19-worker-daemon-heartbeat-logs-design.md](./superpowers/specs/2026-05-19-worker-daemon-heartbeat-logs-design.md)
- 实现计划：[2026-05-19-worker-daemon-heartbeat-logs.md](./superpowers/plans/2026-05-19-worker-daemon-heartbeat-logs.md)
- 这一阶段在 Stage 18 的 lifecycle / recovery 和 finalizer 幂等性基础上，给 worker queue 增加 daemon / polling loop、heartbeat metadata、stale claim recovery 和 bounded worker lifecycle logs。
- 路线采用 `runtime-first + Web 只读展示`：核心状态在 `packages/worker-runtime`，daemon 入口在 `apps/agent-worker`，Web 只展示 queue counts、heartbeat、stale summary 和 recent worker logs，不负责启停长期 daemon。
- daemon 配置 workbench repository 时应复用 Stage 18 的幂等 finalizer，把 terminal worker job 回写到 run/tool events；没配置时只更新 worker job 和 worker logs，不猜测 workbench state。
- Stage 19 的 “Streaming Logs” 是 bounded worker lifecycle log/event summary，不是 raw stdout/stderr 流。真实 stdout/stderr streaming 要等真实 runner 和更强 sandbox 边界之后再做。
- stale recovery 只自动处理 `payloadSource: "safe_persisted"` 的 running job。旧 worker 完成时必须继续受 claim token 保护，不能覆盖已经恢复或重排后的状态。
- 本阶段仍不做真实 shell、MCP execution、真实 deployment runner、生产 process manager 或 Web daemon controls。

当前实现状态：

- Stage 19 v0 已实现 worker daemon / polling loop、heartbeat metadata、stale safe claim recovery、bounded worker lifecycle logs 和 Web 只读 worker queue visibility。
- daemon 配置 workbench repository 时会复用幂等 finalizer 回写 terminal run/tool events；未配置时只更新 worker job 和 worker logs。
- Stage 19 的 logs 仍是 lifecycle summary，不是 raw stdout/stderr streaming。

学习重点：

- daemon liveness、job execution state 和用户可见 run lifecycle 是三个不同层次，不能混成一个字段。
- heartbeat 是 runtime liveness signal，不是授权或用户身份。
- stale recovery 要依赖 claim token 和条件更新，避免过期 worker 覆盖新结果。
- worker logs 必须默认 summary-only、bounded、allowlisted；不能为了可观察性把 secret、raw args、raw stdout/stderr、artifact content 或本机路径扩散到 UI、context 或模型请求。
- Web 的 worker visibility 应先做只读健康状态，让用户理解 queue/daemon 状态；长期 daemon process management 应留给专门阶段。

### 阶段 20：MCP Execution v0

当前设计：

- [2026-05-19-mcp-execution-v0-design.md](./superpowers/specs/2026-05-19-mcp-execution-v0-design.md)
- 实现计划：[2026-05-19-mcp-execution-v0.md](./superpowers/plans/2026-05-19-mcp-execution-v0.md)
- 这一阶段先做 read-only MCP tool execution，不接真实 MCP SDK、不做 write tools、不开放 filesystem / shell / Git / deployment side effects。
- API 应拥有执行用例：校验 project、connector、tool、role、permission、approval 和 read-only 边界，然后写入 run events 与 `ToolObservationRecord`。
- 默认 executor 必须是 deterministic local executor。真实 MCP server adapter、worker-backed MCP client 和 write-tool approval 留到后续阶段。
- MCP execution 结果必须是 bounded / redacted summary；raw output、raw arguments、secret、完整 artifact 内容和本机绝对路径不能进入 chat messages、model context 或 Web UI。

学习重点：

- MCP registry 只回答“哪些工具可见”，MCP execution 还必须回答“这次调用是否被授权、是否只读、如何审计、失败如何表达”。
- read-only 是第一版 MCP execution 的安全阀；写工具需要更强 approval、side-effect audit、rollback/retry 语义，不能和第一版混做。
- `ToolObservationRecord` 是工具执行事实边界，不是 raw output 仓库。保存摘要而不是原文，后续模型上下文再通过显式 summarization 读取。
- Stage 20 v0 证明了 MCP execution 不等同于“直接调用外部工具”：即使第一版 executor 是 deterministic local executor，也必须先经过 project/role/permission/approval/read-only 校验，再通过 run event 和 `ToolObservationRecord` 保存可审计、安全摘要。

## 5. 写代码时的维护原则

- 先做最小闭环，再做智能增强。
- 第一版可用优先级是 Web/API 普通问答、LP 固定链路工作流、Skill 上下文/命令和 streaming/no-refresh 体验；MCP、真实部署、auth/RBAC 和广义 write tools 不应抢在这个闭环前面。
- 业务入口依赖接口，不直接依赖具体 provider、MCP SDK、Git SDK 或 shell。
- 生成 LP 产物永远保持框架无关静态 HTML/CSS/JS。
- Skills 在当前阶段仍是 manifest、内容和规则数据；只有预声明的 deployment skill command 会在 API 校验和一次性审批后通过 `ToolCommandRunner` 边界执行。
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
- 如果某个阶段没有引入或改变 Agent 知识点、Agent 运行边界、上下文/工具/模型/记忆/协作机制，就不要写入本文件；这类内容应放在 README、roadmap、acceptance doc 或对应 spec/plan 中。
