# Superpowers 文档索引

本目录保存 Superpowers 生成的 specs 和 implementation plans。新同事接手项目或换电脑恢复上下文时，应按下面顺序阅读。

从现在开始，新增或实质更新的 Superpowers spec / plan 默认使用中文书写。历史英文文档不强制一次性翻译；当某个历史文档被实质更新、重写或继续作为当前阶段依据时，再顺手中文化。

## 阅读顺序

1. `specs/2026-05-11-lp-engineering-team-agent-design.md`
   - V1 产品和架构设计。
   - 先读它，理解项目目标、系统边界，以及为什么 monorepo 被拆成当前 apps 和 packages。

2. `plans/2026-05-11-lp-engineering-team-agent-v1.md`
   - V1 实施计划。
   - 如果需要理解当前 MVP 是怎么搭起来的，在 V1 design 后阅读。

3. `specs/2026-05-11-stage-2-agent-workflow-spec.md`
   - Stage 2 产品 spec。
   - 在 V1 design 后阅读。它假设当前 MVP 已存在，并定义下一阶段：持久项目、skills、模型路由、MCP、run timelines、agent context assembly、runtime schema validation、deployment handoff 和团队协作 primitives。

4. `specs/2026-05-12-chat-agent-workbench-ui-spec.md`
   - Stage 2 Web UI slice spec。
   - 做 Manus/ChatGPT 风格对话布局、固定侧边栏、工具调用过程展示、artifact cards 和 interrupt affordance 时阅读。

5. `plans/2026-05-12-chat-agent-workbench-ui.md`
   - Stage 2 Web UI implementation plan。
   - 实现或审计 conversation-first Web workbench 时阅读。

6. `plans/2026-05-12-stage-2-persistent-repositories.md`
   - Stage 2 Milestone 1 implementation plan。
   - 实现 Stage 2 第一片：repository contracts 和 repository-backed workbench state 时阅读。

7. `specs/2026-05-12-lightweight-real-web-project-flow-spec.md`
   - Stage 2 Milestone 2 lightweight Web flow spec。
   - 在 chat UI plan 和 repository plan 后阅读，用于把固定 demo snapshot 替换成项目创建、prompt 提交、cookie-backed current project state 和 process-local in-memory Web state。

8. `plans/2026-05-12-lightweight-real-web-project-flow.md`
   - Stage 2 Milestone 2 lightweight Web flow implementation plan。
   - 实现或审计项目创建、prompt 提交、cookie-backed current project selection 和 process-local Web state 时阅读。

9. `specs/2026-05-12-web-flow-no-git-no-deployment-spec.md`
   - Stage 2 Milestone 2 范围修订。
   - 在 lightweight Web flow spec/plan 后阅读。它覆盖早期 lightweight Web flow 文档中的 repository URL 和 automatic deployment 部分，适用于当前 Web V1。

10. `plans/2026-05-12-web-flow-no-git-no-deployment.md`
   - 移除当前 Web flow 中 Git repository capture 和 automatic deployment 的实施计划。
   - 实现或审计当前项目创建、prompt submission、review、static download 和 preview 行为时阅读。

11. `specs/2026-05-12-conversation-first-workbench-entry-spec.md`
   - Web entry model 修订。
   - 在 no-Git/no-deployment plan 后阅读。它覆盖 project-first Web entry，定义当前 Web V1 的 Manus-style large composer、ordinary task mode、optional project context 和 LP routing behavior。

12. `plans/2026-05-12-conversation-first-workbench-entry.md`
   - Conversation-first Web entry 实施计划。
   - 实现或审计 task model、deterministic routing、implicit LP project creation、general chat task rendering、large empty-state composer 和 sidebar task/project behavior 时阅读。

13. `specs/2026-05-13-web-workbench-persistent-state-spec.md`
   - Web workbench persistence 修订。
   - 在 conversation-first plan 后阅读，用于把 Web projects、task threads、messages 和 LP snapshot bindings 移出 process-local Web maps。

14. `plans/2026-05-13-web-workbench-persistent-state.md`
   - Repository-backed local Web workbench state 实施计划。
   - 实现或审计 local JSON-backed workbench state 和 repository-based Web task rendering 时阅读。

15. `specs/2026-05-13-project-skills-management-runtime-spec.md`
   - Stage 2 Skills Management MVP spec。
   - 在 persistent-state plan 后阅读，用于添加 project-level skill creation、validation、publishing、project binding 和 runtime context loading。

16. `plans/2026-05-13-project-skills-management-runtime.md`
   - Stage 2 Skills Management MVP 实施计划。
   - 实现 repository-backed skill lifecycle、project binding、runtime context loading 和 Web Skills view 时阅读。

17. `specs/2026-05-13-project-model-routing-config-spec.md`
   - Stage 2 Model Routing Configuration MVP spec。
   - 在 project skills plan 后阅读，用于添加 project-scoped model providers、planner/builder/reviewer/deployer route configuration、runtime route resolution 和 Models view behavior。

18. `plans/2026-05-13-project-model-routing-config.md`
   - Stage 2 Model Routing Configuration MVP 实施计划。
   - 实现 repository-backed project model providers、role route configuration、runtime route resolution 和 Web Models view 时阅读。

19. `specs/2026-05-13-project-mcp-connector-registry-spec.md`
   - Stage 2 MCP Connector Registry MVP spec。
   - 在 model routing plan 后阅读，用于添加 project-scoped MCP connector definitions、tool approval state、role/permission visibility filtering 和 runtime MCP context loading。

20. `plans/2026-05-13-project-mcp-connector-registry.md`
   - Stage 2 MCP Connector Registry MVP 实施计划。
   - 实现 repository-backed connector state、approval-aware visible tools、runtime context wiring 和 Web MCP view 时阅读。

21. `plans/2026-05-14-run-orchestration-context-assembly.md`
   - Stage 2 Milestone 6 implementation plan。
   - 在 MCP connector registry plan 后阅读，用于实现或审计 persisted run events、context pack assembly、runtime schema validation 和 Web timeline rendering。

22. `specs/2026-05-14-provider-neutral-model-config-design.md`
   - Stage 3 model provider configuration design。
   - 在 run orchestration/context assembly plan 后阅读，用于添加参考 pi-mono 但项目自有的 provider-neutral model configuration、API protocol selection、sanitized runtime provider metadata，以及真实 provider adapters 前的 mock-chain verification。

23. `plans/2026-05-14-provider-neutral-model-config.md`
   - Stage 3 provider-neutral model config implementation plan。
   - 实现 generic provider API protocol selection、non-secret provider config storage、sanitized runtime metadata、Web Models controls 和 mock-chain verification 时阅读。

24. `specs/2026-05-14-anthropic-messages-adapter-design.md`
   - Stage 3 第一个真实模型 provider adapter design。
   - 在 provider-neutral model config plan 后阅读，用于添加 `anthropic-messages` model-gateway adapter，覆盖智谱 Claude-compatible 和 Anthropic-compatible endpoints、fake-fetch tests、opt-in real provider verification 和 secret-safe response metadata。

25. `plans/2026-05-14-anthropic-messages-adapter.md`
   - Stage 3 第一个真实模型 provider adapter implementation plan。
   - 实现 fake-fetch unit tests、provider-backed model-gateway dispatch、opt-in real provider verification 和 secret-safe adapter behavior 时阅读。

26. `specs/2026-05-14-real-model-runtime-wiring-design.md`
   - Stage 3 real model runtime wiring design。
   - 在 Anthropic Messages adapter plan 后阅读，用于把 `ProviderBackedModelGateway` 接入 Web/API/runtime，并通过显式本地 opt-in 开关保护 deterministic defaults 和 static LP artifact generation。

27. `plans/2026-05-14-real-model-runtime-wiring.md`
   - Stage 3 real model runtime wiring implementation plan。
   - 实现或审计 API-owned runtime factory、repository-backed provider resolver、显式 `REAL_MODEL_RUNTIME=1` 开关、fake-fetch API tests 和 sanitized run event behavior 时阅读。

28. `specs/2026-05-14-openai-compatible-adapter-design.md`
   - Stage 3 OpenAI-compatible Chat Completions adapter design。
   - 在 real model runtime wiring plan 后阅读，用于添加通用 `openai-completions` model-gateway adapter，覆盖智谱 `paas/v4` 和其它 OpenAI-compatible providers。

29. `plans/2026-05-14-openai-compatible-adapter.md`
   - Stage 3 OpenAI-compatible Chat Completions adapter implementation plan。
   - 实现 fake-fetch tests、通用 `openai-completions` adapter、智谱 `paas/v4` smoke testing、runtime dispatch 和 Web/API runtime coverage 时阅读。

30. `specs/2026-05-14-structured-lp-brief-model-output-design.md`
   - Stage 3 structured Planner LP brief output design。
   - 在 OpenAI-compatible adapter plan 后阅读，用于把 real-runtime Planner 的 `sampleBrief` placeholder 替换成经过 `LPBriefSchema` 验证的解析，同时保持默认 deterministic behavior 和 static LP artifact generation。

31. `plans/2026-05-14-structured-lp-brief-model-output.md`
   - Stage 3 structured Planner LP brief output implementation plan。
   - 实现 strict JSON Planner prompts、`LPBriefSchema` parsing、transient runtime model text、sanitized parse events 和 fail-closed real-runtime behavior 时阅读。

32. `specs/2026-05-14-real-builder-static-artifacts-design.md`
   - Stage 3 real Builder static artifacts design。
   - 在 structured LP brief output plan 后阅读，用于把 deterministic real-runtime Builder artifacts 替换成模型生成且框架无关的 `index.html` / `styles.css` / `script.js`，并通过 strict JSON parsing 和 artifact policy validation 保护。

33. `plans/2026-05-14-real-builder-static-artifacts.md`
   - Stage 3 real Builder static artifacts implementation plan。
   - 实现 strict Builder artifact JSON prompts、static artifact parsing、framework/resource policy validation、sanitized Builder parse events 和 fail-closed real-runtime behavior 时阅读。

34. `specs/2026-05-14-skill-command-execution-design.md`
   - Stage 4 skill command execution design。
   - 在 real Builder static artifacts plan 后阅读，用于添加受控 deployment skill commands、one-shot approval、command runner adapters、structured tool observations 和 sanitized tool run events。

35. `plans/2026-05-14-skill-command-execution.md`
   - Stage 4 skill command execution implementation plan。
   - 实现 controlled deployment skill command manifests、one-shot approval validation、command runner adapters、sanitized tool observations 和 tool run events 时阅读。

36. `specs/2026-05-15-skill-command-web-loop-design.md`
   - Stage 4.1 skill command Web loop design。
   - 在 skill command execution plan 后阅读，用于添加 Web-facing simulated command launcher、one-shot approval UI、mock runner wiring 和 sanitized timeline display。

37. `plans/2026-05-15-skill-command-web-loop.md`
   - Stage 4.1 skill command Web loop implementation plan。
   - 实现 safe Web command discovery、one-shot approval action、simulated runner injection、sanitized event rendering 和 verification flow 时阅读。

38. `specs/2026-05-15-context-memory-retrieval-design.md`
   - Stage 5 context memory and deterministic retrieval design。
   - 在 skill command Web loop plan 后阅读，用于给 Context Pack 增加 bounded project-scoped message、run、tool observation 和 artifact summaries，不引入 vector search 或 model-generated summaries。

39. `plans/2026-05-15-context-memory-retrieval.md`
   - Stage 5 context memory and deterministic retrieval implementation plan。
   - 实现 model/runtime memory context contracts、API memory assembly、Context Pack injection、safety tests 和 documentation updates 时阅读。

40. `specs/2026-05-15-agent-handoff-state-design.md`
   - Stage 6 structured agent handoff state design。
   - 在 context memory plan 后阅读，用于添加固定 LP-chain Planner、Builder、Reviewer、Deployer handoff records、safe handoff run events、blocked deployment behavior 和 role-relevant Context Pack handoff summaries。

41. `plans/2026-05-15-agent-handoff-state.md`
   - Stage 6 structured agent handoff state implementation plan。
   - 实现 repository-backed handoffs、runtime/model context contracts、API handoff helpers、Context Pack injection、LP service flow wiring 和 verification 时阅读。

42. `specs/2026-05-17-collaboration-primitives-design.md`
   - Stage 7 collaboration primitives design。
   - 在 handoff state plan 后阅读，用于添加 local user identity、workspace/project member repositories、project owner creation、approval actor audit ownership，以及不引入 real auth 或 realtime collaboration 的最小 Web member visibility。

43. `plans/2026-05-17-collaboration-primitives.md`
   - Stage 7 collaboration primitives implementation plan。
   - 实现或审计 local identity、member repositories、project owner creation、approval actor ownership、Web member state 和 documentation updates 时阅读。

44. `specs/2026-05-17-worker-sandbox-runtime-design.md`
   - Stage 8 worker sandbox runtime foundation design。
   - 在 collaboration primitives plan 后阅读，用于添加 worker job contracts、sandbox policy、execution adapters 和 worker-backed `ToolCommandRunner` seam，同时不开放真实 shell execution。

45. `plans/2026-05-17-worker-sandbox-runtime.md`
   - Stage 8 worker sandbox runtime foundation implementation plan。
   - 实现或审计 `packages/worker-runtime`、sandbox policy validation、deterministic execution adapters 和 worker-backed `ToolCommandRunner` 时阅读。

46. `specs/2026-05-17-worker-job-persistence-design.md`
   - Stage 9 worker job persistence foundation design。
   - 在 worker sandbox runtime plan 后阅读，用于添加 worker job repositories、JSON-file worker job persistence、repository-backed runtime internals 和不执行真实任务的 safe restart behavior。

47. `plans/2026-05-17-worker-job-persistence.md`
   - Stage 9 worker job persistence foundation implementation plan。
   - 实现或审计 worker job repositories、repository-backed runtime internals、JSON-file persistence、restart-safe missing-payload behavior 和 API compatibility 时阅读。

48. `specs/2026-05-17-worker-job-cancel-interrupt-design.md`
   - Stage 10 worker job cancel and interrupt foundation design。
   - 在 worker job persistence plan 后阅读，用于添加 queued cancellation、cooperative running-job cancellation、adapter cancellation context、cancellation metadata persistence 和 API cancelled-result mapping，同时不启用真实 execution 或 Web interrupt wiring。

49. `plans/2026-05-17-worker-job-cancel-interrupt.md`
   - Stage 10 worker job cancel and interrupt foundation implementation plan。
   - 实现或审计 runtime cancellation state、cooperative adapter cancellation context、repository persistence of cancellation metadata 和 API cancelled-result mapping 时阅读。

50. `specs/2026-05-17-worker-queue-handoff-design.md`
   - Stage 11 worker queue handoff v0 design。
   - 在 worker job cancel implementation plan 后阅读，用于添加 safe persisted worker payloads、cross-process worker claim semantics 和 `apps/agent-worker` one-job execution path，同时不启用真实 shell execution、MCP execution 或 Web interrupt wiring。

51. `plans/2026-05-18-worker-queue-handoff.md`
   - Stage 11 worker queue handoff v0 implementation plan。
   - 实现或审计 safe persisted worker payloads、claim-token worker handoff、`apps/agent-worker` run-once execution，并验证没有引入真实 shell、MCP execution 或 Web interrupt wiring。

52. `specs/2026-05-18-web-api-interrupt-wiring-design.md`
   - Stage 12 Web/API interrupt wiring v0 design。
   - 在 worker queue handoff plan 后阅读，用于添加 current-task interrupt UI、optimistic stopping state、API cancellation routing、task/run/worker target association 和 cancellation timeline display，同时不做真实 shell signals、MCP execution、streaming logs、worker daemon control 或 bulk cancellation。

53. `plans/2026-05-18-web-api-interrupt-wiring.md`
   - Stage 12 Web/API interrupt wiring v0 implementation plan。
   - 实现或审计 current-task interrupt action、optimistic stopping UI、API task/run/worker cancellation routing 和 cancelled timeline rendering 时阅读。

54. `specs/2026-05-18-web-worker-queue-integration-design.md`
   - Stage 13 Web worker queue integration v0 design。
   - 在 Web/API interrupt plan 后阅读，用于添加 Web skill command queue path、local `Run local worker once` action、worker job finalization 回写 run/tool events，以及不启用 daemon workers、真实 shell execution、MCP execution、真实 deployment、streaming logs 或 secret/artifact payload persistence 的 safe queue visibility。

55. `plans/2026-05-18-web-worker-queue-integration.md`
   - Stage 13 Web worker queue integration v0 implementation plan。
   - 实现或审计 queued Web skill command execution、project-scoped local worker run-once action、worker result finalization、localized queue controls 和 safe worker queue configuration 时阅读。

56. `specs/2026-05-18-durable-artifact-workspace-design.md`
   - Stage 14 durable artifact workspace v0 design。
   - 在 Stage 13 plan 后阅读，用于添加 local persistent static LP artifact workspaces、file manifests、workspace-backed preview/export recovery 和 metadata-first context injection，同时不启用真实 deployment、shell execution、MCP execution、object storage 或 desktop filesystem workspaces。

57. `plans/2026-05-18-durable-artifact-workspace.md`
   - Stage 14 durable artifact workspace v0 implementation plan。
   - 实现或审计 artifact workspace helper types、local repository persistence、page-version workspace creation、workspace-backed artifact recovery、metadata-first context injection 和 documentation updates 时阅读。

58. `specs/2026-05-18-artifact-reader-static-diff-design.md`
   - Stage 15 artifact reader and static diff v0 design。
   - 在 Stage 14 plan 后阅读，用于添加 controlled artifact workspace file reads、bounded snippet behavior、metadata-only static diffs，以及 Reviewer、MCP、deployment、desktop workspace flows 的 future-safe read boundaries。

59. `plans/2026-05-18-artifact-reader-static-diff.md`
   - Stage 15 artifact reader and static diff v0 implementation plan。
   - 实现或审计 controlled artifact reads、repository-backed workspace diffing、bounded Context Pack snippets 和 runtime/model no-content guards 时阅读。

60. `specs/2026-05-19-web-artifact-diff-cards-design.md`
   - Stage 16 Web artifact diff cards v0 design。
   - 在 Stage 15 plan 后阅读，用于添加 conversation-embedded artifact metadata diff cards 和通过 artifact reader 边界显式读取的 8KB snippet previews。

61. `plans/2026-05-19-web-artifact-diff-cards.md`
   - Stage 16 Web artifact diff cards v0 implementation plan。
   - 实现或审计 conversation-embedded artifact metadata cards、same-page snippet query handling、localization 和 safety tests 时阅读。

62. `specs/2026-05-19-web-v1-smoke-acceptance-design.md`
   - Stage 17 Web V1 smoke and acceptance design。
   - 在 Stage 16 plan 后阅读，用于添加 README onboarding、deterministic smoke testing 和 manual Web V1 acceptance checklist，同时不添加 browser E2E、MCP execution、shell execution 或 deployment。

63. `plans/2026-05-19-web-v1-smoke-acceptance.md`
   - Stage 17 Web V1 smoke and acceptance implementation plan。
   - 在 Stage 17 design 后阅读，用于实现或审计 deterministic smoke command、startup README 和 manual Web V1 acceptance checklist。

64. `specs/2026-05-19-agent-run-lifecycle-recovery-design.md`
   - Stage 18 Agent Run Lifecycle and Recovery v0 design。
   - 在 Stage 17 plan 后阅读，用于添加 run lifecycle 派生、失败诊断、最小 recovery action contract 和 worker finalization 幂等语义，同时不引入 Web UI overhaul、worker daemon、MCP execution、真实 shell execution 或通用 DAG scheduler。

65. `plans/2026-05-19-agent-run-lifecycle-recovery.md`
   - Stage 18 Agent Run Lifecycle and Recovery v0 implementation plan。
   - 在 Stage 18 design 后阅读，用于按 TDD 实现 `RunLifecycleView` helper、worker/handoff 状态派生、diagnostic safety、task-level lifecycle listing、worker finalizer 幂等性和文档收尾。

66. `specs/2026-05-19-worker-daemon-heartbeat-logs-design.md`
   - Stage 19 Worker Daemon、Heartbeat 和 Streaming Logs v0 design。
   - 在 Stage 18 plan 后阅读，用于添加 worker daemon / polling loop、heartbeat metadata、stale claim recovery、bounded worker lifecycle logs 和 Web 只读 queue visibility，同时不引入真实 shell execution、MCP execution、deployment runner 或 Web daemon process management。

67. `plans/2026-05-19-worker-daemon-heartbeat-logs.md`
   - Stage 19 Worker Daemon、Heartbeat 和 Streaming Logs v0 implementation plan。
   - 在 Stage 19 design 后阅读，用于按 TDD 实现 worker heartbeat/stale recovery 状态机、bounded worker log repository、`apps/agent-worker` daemon loop、API worker queue snapshot、Web Skills 只读 worker visibility 和文档收尾。

68. `specs/2026-05-19-mcp-execution-v0-design.md`
   - Stage 20 MCP Execution v0 design。
   - 在 Stage 19 plan 后阅读，用于添加 read-only MCP tool execution contract、deterministic local executor、API run/tool observation 闭环和最小 Web/API 执行入口，同时不引入真实 MCP SDK、write tools、filesystem/shell access、raw output 注入或 streaming MCP output。

69. `plans/2026-05-19-mcp-execution-v0.md`
   - Stage 20 MCP Execution v0 implementation plan。
   - 在 Stage 20 design 后阅读，用于按 TDD 实现 read-only MCP executor contract、API-owned execution use case、安全 tool observation、Web 最小执行入口和文档收尾。

70. `specs/2026-05-19-model-repair-retry-fallback-design.md`
   - Stage 21 Model Repair、Retry 和 Fallback v0 design（已实现）。
   - 在 Stage 20 plan 后阅读，用于理解 Planner/Builder one-shot structured output repair、provider 临时错误 bounded retry 和 fallback route 安全 metadata，同时确认本阶段不做 streaming、tool-call conversion、自动 fallback execution 或 provider marketplace。

71. `plans/2026-05-19-model-repair-retry-fallback.md`
   - Stage 21 Model Repair、Retry 和 Fallback v0 implementation plan（已实现）。
   - 在 Stage 21 design 后阅读，用于审计 runtime provider retry、fallback metadata resolution、Planner/Builder one-shot repair、lifecycle diagnostics 和文档收尾的实现顺序。

72. `specs/2026-05-19-postgres-repository-foundation-design.md`
   - Stage 22 Postgres Repository Foundation v0 design（已实现 foundation v0）。
   - 在 Stage 21 plan 后阅读，用于把 Prisma schema 和当前核心 `WorkbenchRepositories` contract 对齐，并规划显式 opt-in 的 Prisma/Postgres repository adapter，同时不做完整 hosted auth、object storage、production rollout 或默认 Web backend 切换。

73. `plans/2026-05-19-postgres-repository-foundation.md`
   - Stage 22 Postgres Repository Foundation v0 implementation plan（已实现 foundation v0）。
   - 在 Stage 22 design 后阅读，用于按 TDD 对齐 Prisma schema、提取 shared repository contract tests、实现 Prisma mappers、显式 opt-in Prisma-backed repository adapter、opt-in Postgres integration test 和文档收尾。

74. `specs/2026-05-20-web-opt-in-postgres-backend-wiring-design.md`
   - Stage 23 Web Opt-in Postgres Backend Wiring v0 design（已实现）。
   - 在 Stage 22 plan 后阅读，用于把 Web/API runtime 从 JSON-file 默认路径扩展到显式 opt-in 的 Postgres backend，同时补齐 Web-facing Prisma repository closure，并继续排除 production migration、hosted auth/RBAC、object storage 和 worker queue Postgres backend。

75. `plans/2026-05-20-web-opt-in-postgres-backend-wiring.md`
   - Stage 23 Web Opt-in Postgres Backend Wiring v0 implementation plan（已实现）。
   - 在 Stage 23 design 后阅读，用于按 TDD 补齐 Web-facing Prisma repository closure、实现 Web backend factory、异步接线 `getWebWorkbenchStore()`、补最小 Web Postgres flow 覆盖和文档收尾。

76. `specs/2026-05-20-worker-job-postgres-backend-design.md`
   - Stage 24 Worker Job Postgres Backend v0 design（已实现）。
   - 在 Stage 23 plan 后阅读，用于把 worker job、safe persisted payload 和 bounded worker lifecycle log repository 扩展到显式 opt-in 的 Postgres backend，同时继续保留 JSON-file 默认路径、安全 payload 边界和不做真实 shell / production worker fleet 的限制。

77. `plans/2026-05-20-worker-job-postgres-backend.md`
   - Stage 24 Worker Job Postgres Backend v0 implementation plan（已实现）。
   - 在 Stage 24 design 后阅读，用于按 TDD 实现 Prisma worker job/payload/log schema、shared repository contracts、Prisma adapters、shared worker queue backend factory、Web/agent-worker opt-in wiring、integration coverage 和文档收尾。

78. `specs/2026-05-20-run-recovery-ui-design.md`
   - Stage 25 Run Recovery UI v0 design（已实现，当前已完成）。
   - 在 Stage 24 plan 后阅读，用于把已有 `RunLifecycleView`、安全 diagnostic summary 和 recovery action contract 接入 Web task inline recovery block，并规划 `resume_worker_finalization`、可控 `retry_run`、approval/blocker/manual inspect guidance，同时继续排除通用 DAG scheduler、自动完整 chain rerun、streaming UI 和团队审批队列。

79. `plans/2026-05-20-run-recovery-ui.md`
   - Stage 25 Run Recovery UI v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 25 design 后阅读，用于按 TDD 实现 API recovery helper、controlled single-run retry、Web store/server action wiring、inline recovery block、回归覆盖和文档收尾。

80. `specs/2026-05-20-streaming-chat-transport-ui-design.md`
   - Stage 26 Streaming Chat Transport and UI v0 design（已实现，当前已完成）。
   - 在 Stage 25 plan 和当前 roadmap 后阅读，用于理解已新增的普通聊天 streaming route / UI event contract、`submitPromptAction` fallback 边界，以及继续排除 LP agent chain、MCP/tool-call streaming、raw stdout/stderr streaming 和真实 provider token streaming 的历史范围。

81. `plans/2026-05-20-streaming-chat-transport-ui.md`
   - Stage 26 Streaming Chat Transport and UI v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 26 design 后阅读，用于理解已实现的 chat stream event contract、Web store streaming helper、NDJSON route、client streaming composer、fallback handling、tests 和文档收尾历史。

82. `specs/2026-05-21-real-chat-runtime-skill-context-design.md`
   - Stage 27 Real Chat Runtime and Skill Context v0 design（设计已确认）。
   - 在 Stage 26 implementation plan 和当前 roadmap 后阅读，用于新增普通聊天专用 `assistant` role、project-bound real chat runtime、skill context prompt 注入、Chat UI context summary，以及继续排除 LP chain、MCP execution、真实 shell/deployment 和 provider token streaming。

83. `plans/2026-05-21-real-chat-runtime-skill-context.md`
   - Stage 27 Real Chat Runtime and Skill Context v0 implementation plan（当前待执行）。
   - 在 Stage 27 design 后阅读，用于按 TDD 实现 `assistant` role、assistant prompt builder、project-bound real chat runtime、safe context summary stream、Models UI route configuration 和 verification。

## 维护规则

每当 Superpowers workflow 创建、重命名、替换或实质更新 `docs/superpowers/specs/` 或 `docs/superpowers/plans/` 下的 spec/plan 时，必须在同一个变更中更新本索引。

索引更新必须保持：

- 阅读顺序准确。
- 每个 spec/plan 的简短目的准确。
- Stage 和 milestone 关系清楚。
- 被重命名或废弃的引用已移除，或明确标注为已被替代。

如果两个文档日期相同，以本索引作为阅读顺序的 source of truth。

新增或实质更新的 Superpowers specs/plans 默认使用中文；保留代码、命令、文件名、环境变量、API protocol、错误码和 schema/type 名称的英文原文。历史英文文档不需要为了翻译而单独修改，但在被继续使用并发生实质更新时应同步中文化。
