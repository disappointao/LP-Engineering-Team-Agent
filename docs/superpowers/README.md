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
   - Stage 27 Real Chat Runtime and Skill Context v0 design（已实现，当前已完成）。
   - 在 Stage 26 implementation plan 和当前 roadmap 后阅读，用于理解已新增的普通聊天专用 `assistant` role、project-bound real chat runtime、skill context prompt 注入、Chat UI context summary，以及继续排除 LP chain、MCP execution、真实 shell/deployment 和 provider token streaming 的历史范围。

83. `plans/2026-05-21-real-chat-runtime-skill-context.md`
   - Stage 27 Real Chat Runtime and Skill Context v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 27 design 后阅读，用于理解已实现的 `assistant` role、assistant prompt builder、project-bound real chat runtime、safe context summary stream、Models UI route configuration、tests、review gates、最终验证和文档收尾历史；该 plan 已归档为完成态，不再作为当前执行 checklist。

84. `specs/2026-05-21-lp-agent-chain-end-to-end-design.md`
   - Stage 28 LP Agent Chain End-to-End v0 design（已实现，当前已完成）。
   - 在 Stage 27 implementation plan 和当前 roadmap 后阅读，用于把 Web 提交 LP 复杂任务时的固定 `Planner -> Builder -> Reviewer -> Deployer` 链路改成 task-first orchestration，确保真实 Planner/Builder structured output、durable artifact workspace、Reviewer blocked、Deployer handoff、失败 recovery 和后续修改都绑定到同一个 task。

85. `plans/2026-05-21-lp-agent-chain-end-to-end.md`
   - Stage 28 LP Agent Chain End-to-End v0 implementation plan（已实现后标记为完成）。
   - 在 Stage 28 design 后阅读，用于审计 task-first LP chain orchestration、同 task run 绑定、durable artifact workspace、Reviewer blocked / Deployer failure 边界、继续修改、测试和文档收尾。

86. `specs/2026-05-21-live-run-timeline-artifact-progress-design.md`
   - Stage 29 Live Run Timeline and Artifact Progress v0 design（已实现，当前已完成）。
   - 在 Stage 28 implementation plan 和当前 roadmap 后阅读，用于把 LP chain 的 run lifecycle、worker state、recovery views 和 artifact progress 变成 no-refresh Web task panel；v0 采用短轮询 task state refresh，不引入 SSE、raw stdout/stderr streaming、MCP streaming、实时多人协作或生产 observability stack。

87. `plans/2026-05-21-live-run-timeline-artifact-progress.md`
   - Stage 29 Live Run Timeline and Artifact Progress v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 29 design 后阅读，用于审计已实现的 safe task state refresh、live LP task submit route、client polling panel、artifact progress auto-refresh、smoke coverage / docs closeout；本计划仍排除 SSE、raw stdout/stderr streaming、MCP streaming、实时多人协作和生产 observability stack。

88. `specs/2026-05-22-skill-only-alpha-hardening-design.md`
   - Stage 30 Skill-Only Alpha Hardening v0 design（已实现，当前已完成）。
   - 在 Stage 29 implementation plan 和当前 roadmap 后阅读，用于把已跑通的 Web/API 第一版闭环收敛成 Skill-only local alpha：普通聊天 streaming、LP live task、artifact preview/export、Skill 创建/绑定/命令、真实 provider opt-in、fail-closed 提示和 alpha 验收；本阶段继续排除 MCP 新功能、Browser E2E、usage/cost reporting、production auth/RBAC、Postgres production rollout 和真实部署编排。

89. `plans/2026-05-22-skill-only-alpha-hardening.md`
   - Stage 30 Skill-Only Alpha Hardening v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 30 design 后阅读，用于审计已实现的 alpha boundary copy、页面提示、deterministic `pnpm alpha:check`、README onboarding、manual alpha checklist、文档 closeout 和最终验证。

90. `specs/2026-05-22-browser-e2e-acceptance-design.md`
   - Stage 31 Browser E2E Acceptance v0 design（已实现，当前已完成）。
   - 在 Stage 30 implementation plan 和当前 roadmap 后阅读，用于把 Skill-only local alpha 的普通聊天 streaming、LP live task、artifact preview/export/snippet、Skills / Models / MCP 边界和基础 recovery display 转成可重复的 deterministic browser acceptance；本阶段继续排除远端浏览器 farm、跨浏览器矩阵、真实 provider streaming/usage、MCP 新功能、真实 shell runner、auth/RBAC、生产 observability 和真实部署编排。

91. `plans/2026-05-22-browser-e2e-acceptance.md`
   - Stage 31 Browser E2E Acceptance v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 31 design 后阅读，用于审计 Playwright browser gate、isolated JSON state、ordinary chat streaming E2E、LP live task artifact E2E、Skills / Models / MCP boundary E2E、README/manual checklist/roadmap/docs closeout 和最终验证。

92. `specs/2026-05-22-provider-streaming-usage-design.md`
   - Stage 32 Provider Streaming and Usage Metadata v0 design（已实现，当前已完成）。
   - 在 Stage 31 implementation plan 和当前 roadmap 后阅读，用于给真实 provider 路径增加 provider-reported / estimated usage metadata、duration、attempt 和 streaming capability 可见性，同时继续排除真实 token delta UI、自动 fallback execution、tool-call protocol conversion、billing/quota、MCP 和生产 observability。

93. `plans/2026-05-22-provider-streaming-usage.md`
   - Stage 32 Provider Streaming and Usage Metadata v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 32 design 后阅读，用于按 TDD 实现 model gateway usage/call metadata、OpenAI-compatible / Anthropic-compatible adapter metadata、runtime/API safe event propagation、Web compact timeline summary、文档和最终验证。

94. `specs/2026-05-22-manual-alpha-ux-tightening-design.md`
   - Stage 33 Manual Alpha UX Tightening v0 design（已实现，当前已完成）。
   - 在 Stage 32 implementation plan 和当前 roadmap 后阅读，用于把手动 alpha 中最常见的 sidebar navigation、quick prompt、空状态和文案摩擦收紧成可操作的 Web 体验，同时继续排除 runtime protocol、MCP、真实 shell、真实部署、auth/RBAC 和 provider token delta streaming。

95. `plans/2026-05-22-manual-alpha-ux-tightening.md`
   - Stage 33 Manual Alpha UX Tightening v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 33 design 后阅读，用于实现 Web-only current project/task selection actions、sidebar form wiring、quick prompt form、空状态 copy、focused regression tests、manual alpha checklist 和 roadmap closeout。

96. `specs/2026-05-22-browser-failure-visual-regression-design.md`
   - Stage 34 Browser Failure Injection and Visual Regression v0 design（已实现，当前已完成）。
   - 在 Stage 33 implementation plan 和当前 roadmap 后阅读，用于把 deterministic Playwright alpha gate 扩展到 bounded failure injection、artifact failure、provider fail-closed、worker queue error 和轻量 layout visual contract，同时继续排除远端 browser farm、跨浏览器矩阵、真实 provider/MCP/Postgres/部署依赖和大型 UI redesign。

97. `plans/2026-05-22-browser-failure-visual-regression.md`
   - Stage 34 Browser Failure Injection and Visual Regression v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 34 design 后阅读，用于实现 browser failure injection specs、layout geometry visual contract、diagnostic screenshots、README/manual checklist/roadmap closeout 和最终验证。

98. `specs/2026-05-22-provider-token-delta-streaming-design.md`
   - Stage 35 Provider Token Delta Streaming v0 design（已实现，当前已完成）。
   - 在 Stage 34 implementation plan 和当前 roadmap 后阅读，用于把真实 provider token delta 接入普通聊天 `assistant` role，同时保持 LP Planner / Builder 的完整 buffer structured output parse / repair 边界。

99. `plans/2026-05-22-provider-token-delta-streaming.md`
   - Stage 35 Provider Token Delta Streaming v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 35 design 后阅读，用于按 TDD 实现 model gateway streaming contract、OpenAI-compatible / Anthropic-compatible fake-stream adapters、assistant chat streaming wiring、Agent 学习笔记和 roadmap closeout。

100. `specs/2026-05-22-real-provider-alpha-smoke-operator-docs-design.md`
   - Stage 36 Real Provider Alpha Smoke Matrix and Operator Docs v0 design（已实现，当前已完成）。
   - 在 Stage 35 implementation plan 和当前 roadmap 后阅读，用于理解真实 provider alpha smoke 的 operator-facing 边界：默认 gates 继续 deterministic/no-key，真实 provider 只通过 `REAL_MODEL_RUNTIME=1`、provider route 和本地 key 手动 opt in。

101. `plans/2026-05-22-real-provider-alpha-smoke-operator-docs.md`
   - Stage 36 Real Provider Alpha Smoke Matrix and Operator Docs v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 36 design 后阅读，用于审计 operator smoke 文档、fake-provider usage/fail-closed regression、README/manual checklist/Agent 学习笔记/roadmap closeout 和最终验证。

102. `specs/2026-05-23-skill-only-alpha-release-candidate-checklist-design.md`
   - Stage 37 Skill-only Alpha Release Candidate Checklist v0 design（已实现，当前已完成）。
   - 在 Stage 36 implementation plan 和当前 roadmap 后阅读，用于理解内部 alpha RC 的 go/no-go、试用脚本、反馈模板、triage 分类和已知限制边界；本阶段不改变 runtime 或 provider contract。

103. `plans/2026-05-23-skill-only-alpha-release-candidate-checklist.md`
   - Stage 37 Skill-only Alpha Release Candidate Checklist v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 37 design 后阅读，用于审计 RC checklist 文档、README/manual/provider smoke links、roadmap closeout 和最终验证。

104. `specs/2026-05-23-assistant-streaming-failure-ux-design.md`
   - Stage 38 Assistant Streaming Failure UX Hardening v0 design（已实现，当前已完成）。
   - 在 Stage 37 implementation plan 和当前 roadmap 后阅读，用于收紧普通聊天 `assistant` provider token streaming 的中途失败、空 terminal content、慢首 token、client cancel 和安全 Web failure copy；本阶段不改变 LP Planner / Builder complete-buffer structured output 边界。

105. `plans/2026-05-23-assistant-streaming-failure-ux.md`
   - Stage 38 Assistant Streaming Failure UX Hardening v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 38 design 后阅读，用于按 TDD 实现 typed chat stream errors、API/runtime failure classification、route terminal error mapping、localized Web failure copy、operator docs 和 roadmap closeout。

106. `specs/2026-05-23-lp-artifact-quality-prompt-hardening-design.md`
   - Stage 39 LP Artifact Quality Evaluation and Prompt Hardening v0 design（已实现，当前已完成）。
   - 在 Stage 38 implementation plan 和当前 roadmap 后阅读，用于建立 LP artifact quality rubric、prompt fixtures、人工评审记录和 Planner / Builder prompt hardening 边界；本阶段不改变三文件静态 artifact contract、artifact policy、provider adapter 或 preview/export。

107. `plans/2026-05-23-lp-artifact-quality-prompt-hardening.md`
   - Stage 39 LP Artifact Quality Evaluation and Prompt Hardening v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 39 design 后阅读，用于按 TDD 新增 LP artifact quality rubric、prompt fixtures、Planner / Builder prompt hardening、alpha docs 路由和 roadmap closeout。

108. `specs/2026-05-23-v1-polished-alpha-web-completion-design.md`
   - V1 Polished Alpha Web Completion design（已批准，当前作为 Stage 40-46 规划依据）。
   - 在 Stage 39 implementation plan 和当前 roadmap 后阅读，用于理解第一版 Web 范围扩展：保留 Stage 40 feedback intake，随后规划 Web surface pruning、dedicated artifact workspace、run timeline/recovery polish、Skills/Models client-side management、browser failure/visual regression expansion 和 V1 completion gate；MCP 管理和 Web 入口明确后置。

109. `plans/2026-05-23-alpha-feedback-intake-triage.md`
   - Stage 40 Alpha Feedback Intake and Triage Loop v0 implementation plan（已实现，当前已完成）。
   - 在 V1 polished alpha design 后阅读，用于审计 `docs/alpha-feedback-intake.md`、`docs/alpha-feedback-log.md`，以及 RC feedback template 到 Stage 41-46 / backlog 的批次化路由。

110. `plans/2026-05-23-web-surface-pruning-v1-navigation.md`
   - Stage 41 Web Surface Pruning and V1 Navigation v0 implementation plan（已实现，当前已完成）。
   - 在 V1 polished alpha design、Stage 40 feedback intake plan 和当前 roadmap 后阅读，用于审计已隐藏的 MCP tab/sidebar/top-level Web 入口、旧 `view=mcp` 安全降级，以及 V1 acceptance / browser boundary tests 更新。

111. `specs/2026-05-23-dedicated-artifact-workspace-design.md`
   - Stage 42 Dedicated Artifact Workspace v0 design（已批准，已实现）。
   - 在 Stage 41 implementation plan 和当前 roadmap 后阅读，用于理解 `view=artifacts` dedicated artifact workspace、file manifest、bounded snippet、preview/export、安全失败状态和 no-refresh task state refresh 边界。

112. `plans/2026-05-23-dedicated-artifact-workspace.md`
   - Stage 42 Dedicated Artifact Workspace v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 42 design 后阅读，用于按 TDD 实现 `view=artifacts` navigation、dedicated artifact workspace UI、browser acceptance、manual acceptance docs 和 roadmap closeout。

113. `specs/2026-05-23-run-timeline-recovery-ux-polish-design.md`
   - Stage 43 Run Timeline and Recovery UX Polish v0 design（已批准，已实现）。
   - 在 Stage 42 implementation plan 和当前 roadmap 后阅读，用于理解 Web-only timeline / recovery view-model polish：从现有 `LiveTaskStatePayload`、`RunLifecycleView` 和 safe run events 派生 Planner / Builder / Reviewer / Deployer lifecycle、repair/retry hints、handoff/recovery hierarchy 和 transient progress affordance；本阶段不改变 run event schema 或 recovery action contract。

114. `plans/2026-05-23-run-timeline-recovery-ux-polish.md`
   - Stage 43 Run Timeline and Recovery UX Polish v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 43 design 后阅读，用于审计已实现的 Web-only run timeline view model、localized active role summary、timeline/recovery rendering、browser acceptance 和 roadmap closeout。

115. `specs/2026-05-24-skills-models-client-management-design.md`
   - Stage 44 Skills and Models Client-side Management v0 design（已批准，已实现）。
   - 在 Stage 43 implementation plan 和当前 roadmap 后阅读，用于理解 Skills / Models 保留 Web surface 的 client-side 管理体验：lifecycle/status 分组、pending/success/error affordance、safe runtime summary、真实 provider opt-in 提示和 fail-closed diagnostics；本阶段不改变 Agent runtime、model gateway、skill command execution contract，也不恢复 MCP management。

116. `plans/2026-05-24-skills-models-client-management.md`
   - Stage 44 Skills and Models Client-side Management v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 44 design 后阅读，用于按 TDD 实现 i18n management copy、Web-only Skills / Models management view-model、server action notice redirects、page rendering、browser acceptance 和 docs closeout。

117. `specs/2026-05-24-browser-failure-visual-regression-expansion-design.md`
   - Stage 45 Browser Failure and Visual Regression Expansion v0 design（已实现，当前已完成）。
   - 在 Stage 44 implementation plan 和当前 roadmap 后阅读，用于扩展 deterministic `pnpm alpha:e2e`：覆盖 MCP hidden fallback、artifact workspace failure / snippet boundary、timeline/recovery diagnostics、Skills / Models fail-closed 和轻量 V1 visual contracts；本阶段不引入真实 provider、MCP、Postgres、真实部署、网络依赖、跨浏览器矩阵或 pixel-perfect screenshot baseline。

118. `plans/2026-05-24-browser-failure-visual-regression-expansion.md`
   - Stage 45 Browser Failure and Visual Regression Expansion v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 45 design 后阅读，用于按 TDD 扩展 Playwright helpers、artifact workspace boundaries、MCP / Skills / Models / recovery non-leakage、recovery timeline fixture、visual contracts、scoped / atomic E2E state fixtures、docs closeout 和最终验证。

119. `specs/2026-05-24-v1-polished-alpha-completion-gate-design.md`
   - Stage 46 V1 Polished Alpha Completion Gate v0 design（已实现，当前已完成）。
   - 在 Stage 45 implementation plan 和当前 roadmap 后阅读，用于收口 V1 polished alpha：运行完整 deterministic gates、记录人工 acceptance / 可选真实 provider smoke 状态、更新 RC decision record、known limitations、completion note、roadmap 和后续 backlog routing；本阶段不新增功能、不修 blocker、不改变默认 no-key gate。

120. `plans/2026-05-24-v1-polished-alpha-completion-gate.md`
   - Stage 46 V1 Polished Alpha Completion Gate v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 46 design 后阅读，用于创建 completion ledger、运行完整 deterministic gates、记录 honest manual / real provider smoke 状态、更新 RC docs、roadmap closeout 和后续 routing；完成记录见 `docs/v1-polished-alpha-completion.md`。

121. `specs/2026-05-24-internal-rc-trial-feedback-batch-design.md`
   - Stage 47 Internal RC Trial Feedback Batch v0 design（已实现，当前已完成）。
   - 在 Stage 46 completion gate 后阅读，用于理解 deterministic / no-key local operator trial、safe manual acceptance evidence、feedback batch、RC decision 和 Stage 48 / Stage 49 路由；本阶段不修 blocker、不扩大 V1 功能范围。完成记录见 `docs/v1-polished-alpha-operator-trial.md`。

122. `plans/2026-05-24-internal-rc-trial-feedback-batch.md`
   - Stage 47 Internal RC Trial Feedback Batch v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 47 design 后阅读，用于复核 operator trial evidence ledger、完整 deterministic gates、completion note / feedback log / roadmap closeout，以及无 blocker 后默认后续路由切到 Stage 49 的依据；trial evidence 见 `docs/v1-polished-alpha-operator-trial.md`。

123. `specs/2026-05-25-post-v1-backlog-prioritization-design.md`
   - Stage 49 Post-V1 Backlog Prioritization v0 design（已实现，当前已完成）。
   - 在 Stage 47 implementation plan 和当前 roadmap 后阅读，用于把 V1 polished alpha completion、operator trial evidence、feedback batch、known limitations 和较长 post-V1 backlog 转成可复核的优先级模型，并默认把 Stage 51 收窄为 MCP Management Surface v0 Spec Kickoff；本阶段不实现 runtime、Web、MCP、provider、deployment、auth、storage 或 browser platform 功能。

124. `plans/2026-05-25-post-v1-backlog-prioritization.md`
   - Stage 49 Post-V1 Backlog Prioritization v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 49 design 后阅读，用于创建 `docs/post-v1-backlog-prioritization.md` scoring ledger、更新 V1 completion / feedback routing、同步 roadmap 下一阶段队列，并验证 docs-only 阶段没有改变 runtime 默认 gate。

125. `specs/2026-05-25-mcp-management-surface-v0-design.md`
   - Stage 51 MCP Management Surface v0 design（已实现，当前已完成）。
   - 在 Stage 49 implementation plan 和当前 roadmap 后阅读，用于定义 post-V1 Web MCP management surface：project-scoped connector metadata、visible tools、approval summaries、deterministic/local health、safe read-only execution affordance、failure diagnostics 和 navigation re-entry；本阶段不实现 runtime、Web、backend、worker、MCP SDK、tool execution code，不接 remote MCP SDK/server adapter、write tools、MCP worker execution、secret storage、auth/RBAC、deployment/provider/browser platform，也不把 MCP 加回 V1 alpha。

126. `plans/2026-05-25-mcp-management-surface-v0.md`
   - Stage 51 MCP Management Surface v0 implementation plan（docs-only closeout plan；当前已完成）。
   - 在 Stage 51 design 后阅读，用于执行 docs-only closeout：复核 design commit `3319143`、写入本 implementation plan、同步 Superpowers README / roadmap，并为后续 completion note 和 Stage 54 default implementation route 保留清晰边界；本计划不修改 runtime、Web、backend、worker、MCP SDK、tool execution code 或 tests。完成记录见 `docs/mcp-management-surface-v0-kickoff.md`。

127. `plans/2026-05-25-mcp-management-surface-v0-implementation.md`
   - Stage 54 MCP Management Surface v0 implementation plan（当前执行依据）。
   - 在 Stage 51 design / docs-only closeout 后阅读，用于按 TDD 实现 post-V1 单一 Web MCP management view、safe view-model、navigation re-entry、server action raw-argument boundary、browser acceptance 和 docs closeout；本阶段不接 remote MCP SDK/server adapter、不做 write tools、MCP worker execution、secret storage、auth/RBAC、deployment/provider/browser platform，也不创建 raw MCP output / raw arguments 通道。

## 维护规则

每当 Superpowers workflow 创建、重命名、替换或实质更新 `docs/superpowers/specs/` 或 `docs/superpowers/plans/` 下的 spec/plan 时，必须在同一个变更中更新本索引。

索引更新必须保持：

- 阅读顺序准确。
- 每个 spec/plan 的简短目的准确。
- Stage 和 milestone 关系清楚。
- 被重命名或废弃的引用已移除，或明确标注为已被替代。

如果两个文档日期相同，以本索引作为阅读顺序的 source of truth。

新增或实质更新的 Superpowers specs/plans 默认使用中文；保留代码、命令、文件名、环境变量、API protocol、错误码和 schema/type 名称的英文原文。历史英文文档不需要为了翻译而单独修改，但在被继续使用并发生实质更新时应同步中文化。
