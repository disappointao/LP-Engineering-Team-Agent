# Stage 28：LP Agent Chain End-to-End v0 设计

## 背景

Stage 27 已把 project-bound 普通聊天升级为独立 `assistant` role 的真实模型 runtime，并复用了 Stage 26 的 Web/API streaming transport。用户对第一版可用的核心期望还剩另一半：网页提交“写 LP / 改 LP / 继续优化 LP”这类复杂任务后，能真正跑通固定 LP 工作流，并能在任务里看到 Planner、Builder、Reviewer、Deployer 的执行事实、产物和失败状态。

当前代码已有 `createBriefFromPrompt()`、`generatePageVersion()`、`reviewPageVersion()` 和 `approveAndCreateDeployment()` 这些服务方法，也已有 run events、handoff、artifact workspace、recovery UI 和 worker finalization 基座。但 Web `submitTaskPrompt()` 仍是先同步调用 Planner / Builder / Reviewer，再创建 task thread；这会导致失败时没有稳定 task anchor，run 和 task 的关联也不够完整。Stage 28 要把这些既有能力组织成一个可用的端到端 LP task workflow。

## 目标

- Web 提交 LP 复杂任务后，API 先创建或复用 `lp_generation` task，再用同一个 `taskId` 推进固定 `Planner -> Builder -> Reviewer -> Deployer` 链路。
- `REAL_MODEL_RUNTIME=1` 下 Planner / Builder 使用真实模型 structured output、parse、repair、retry 和 fallback metadata；Reviewer / Deployer v0 保持 deterministic / policy-driven。
- Builder 成功后写 durable artifact workspace 和新的 page version；Web preview/export 自动读取 workspace-backed artifact。
- Reviewer passed 时 Deployer 创建本地 deployment handoff record；Reviewer blocked 时写 blocked handoff，并阻止 Deployer run。
- 后续对话式修改能引用当前 project、task、page version、artifact metadata、bound skills 和 memory summary，生成新的 page version，而不是覆盖旧产物。
- Planner / Builder 失败、Reviewer blocked、Deployer failure、worker finalization gap 等状态继续通过 Stage 25 recovery UI 暴露。
- 默认测试和开发路径继续 deterministic；真实 provider 仍必须通过 `REAL_MODEL_RUNTIME=1` 显式 opt in。

## 非目标

- 不做通用 DAG scheduler；Stage 28 只覆盖固定 LP 链路。
- 不做 MCP execution、tool-call protocol conversion、MCP worker execution 或 write tools。
- 不开放真实 shell runner、真实 deployment runner、OS-level sandbox 或自动外部部署。
- 不做 provider token streaming、raw stdout/stderr streaming、usage/cost reporting 或真实 fallback provider execution。
- 不做 Stage 29 的 no-refresh live task delta、polling/SSE timeline 或 artifact progress streaming。
- 不做多人审批队列、auth/RBAC、object storage 或 Postgres production rollout。

## 当前代码边界

- `apps/web/src/lib/workbench-store.ts` 的 `submitTaskPrompt()` 现在先调用 `createBriefFromPrompt()`、`generatePageVersion()`、`reviewPageVersion()`，成功后才 `saveTaskThread()`。失败时只返回 `generation_failed`，没有可恢复的 task timeline。
- `DemoWorkbenchService.createBriefFromPrompt()` 已能运行 Planner，并在成功后写 `planner -> builder` handoff。
- `DemoWorkbenchService.generatePageVersion()` 已能运行 Builder，解析真实模型 static artifact JSON，写 artifact workspace / page version，并写 `builder -> reviewer` handoff。
- `DemoWorkbenchService.reviewPageVersion()` 已能运行 Reviewer，更新 review status，并写 `reviewer -> deployer` ready 或 blocked handoff。
- `DemoWorkbenchService.approveAndCreateDeployment()` 已能运行 Deployer，并创建本地 `DeploymentHandoff`；它不做真实外部部署。
- `runAgentStep()` 已支持 `taskId`，但当前 LP task 创建路径没有把 task id 传入每个 run。
- Web task timeline 当前主要通过 task snapshot 里的 brief/pageVersion 推导 run ids；如果 Planner 失败、Builder 失败或 snapshot 不完整，timeline 很难展示完整事实。
- Stage 25 recovery UI 已能根据 run events、worker jobs、tool observations 和 handoffs 派生 safe recovery view；Stage 28 应复用它，而不是新增一套失败显示协议。

## 推荐架构

### 1. 新增 task-first LP chain orchestration

在 Web/API store 层新增或重构一个 LP task orchestration helper，例如 `runLpAgentChainForTask()`。它的边界应该在 API/service 层，而不是散落在 page action 里。

职责：

- 校验 prompt、project 和当前 task ownership。
- 对新 LP 任务：必要时创建隐式 project，先创建 `lp_generation` task 和 user message，再运行 agent chain。
- 对已有 LP 任务的后续修改：复用当前 task / project，追加 user message，读取当前 snapshot 和 artifact metadata，创建新 brief / page version。
- 给 `createBriefFromPrompt()`、`generatePageVersion()`、`reviewPageVersion()`、`approveAndCreateDeployment()` 全部传入同一个 `taskId`。
- 每个阶段成功后增量更新 task snapshot：先保存 `projectId`，Planner 后补 `briefId`，Builder 后补 `pageVersionId`，Reviewer / Deployer 后保留最新 page version / deployment fact。
- 链路完成后写 assistant summary message，例如“LP artifacts are ready for review.”；失败时写安全失败 message，并保留已经产生的 run events / recovery views。

v0 可以继续在 server action request 内同步执行，不引入 background LP queue。长期后台化可以在固定链路稳定后再迁移到 worker scheduler。

### 2. 固定链路执行顺序

Stage 28 的固定顺序是：

1. `Planner`：从用户 prompt 和当前 task context 生成 `LPBriefSchema`。
2. `Builder`：消费 Planner handoff，生成框架无关 `index.html`、`styles.css`、`script.js`，并写 durable artifact workspace。
3. `Reviewer`：消费 Builder handoff，检查 launch blockers，更新 page version review status。
4. `Deployer`：仅当 Reviewer passed 且 handoff ready 时运行，创建本地 deployment handoff record。

Reviewer blocked 时不创建 Deployer run；blocked handoff 和 recovery view 成为用户可见解释。Deployer v0 不执行真实部署，只生成本地 handoff / export fact。

### 3. 真实模型边界

`REAL_MODEL_RUNTIME=1` 下：

- Planner 使用真实 model route，并继续执行 `LPBriefSchema` strict parsing、one-shot repair、provider retry 和 fallback metadata event。
- Builder 使用真实 model route，并继续执行 static artifact JSON parsing、artifact policy validation、one-shot repair、provider retry 和 fallback metadata event。
- Reviewer / Deployer 保持 deterministic runtime，避免第一版同时扩大结构化审核、审批和部署风险。

未开启 `REAL_MODEL_RUNTIME` 时，整条链路必须仍可 deterministic 运行，保证 `pnpm test`、`pnpm smoke` 和本地开发不依赖真实 provider。

### 4. 继续对话式修改

后续 LP 修改不应覆盖旧 page version。推荐行为：

- 如果当前 task 是 `lp_generation` 且有 project，用户继续输入“把首屏改成... / 增加 FAQ / 调整 CTA”等修改意图时，复用当前 task。
- 新 Planner prompt 读取当前 task messages、project skills、latest page version metadata、artifact workspace manifest、review summary 和 memory summary。
- Builder 创建新的 artifact workspace 和新的 page version。
- Web artifact preview/export 指向最新 page version；旧版本仍可通过 repository 和 diff helpers 被读取。

这一阶段只做 metadata-first context 和新版本生成，不做 line-level patch、artifact apply workflow 或真实文件系统 workspace。

### 5. Web task timeline 和 recovery

Stage 28 不做 live timeline，但刷新后必须事实完整：

- LP task state 应优先按 `taskId` 读取相关 runs / run events / handoffs / recovery views，而不是只依赖 snapshot 推导固定 run ids。
- snapshot 不完整时也要展示已存在的 run facts，例如 Planner failed 或 Builder failed。
- Builder 成功后的 `artifact.workspace.created` event、page version id、workspace id 和 manifest summary 应出现在 task timeline。
- Reviewer blocked 应显示 blocked handoff 和 recovery guidance。
- Deployer handoff created 后，export / handoff UI 读取同一个 deployment fact。

UI 仍只展示 safe summary，不展示 raw model output、raw provider response、raw artifact content、secret、raw tool output、raw worker payload 或本机路径。

### 6. 错误处理

Stage 28 失败策略：

- 任何阶段失败都保留 task、user message、已创建的 run 和已安全持久化的 events。
- 如果 Planner 失败，task snapshot 只有 project id；recovery view 解释 Planner parse/retry/provider failure。
- 如果 Builder 失败，task snapshot 至少有 brief id；不得保存不完整 page version 或 artifact workspace。
- 如果 Reviewer blocked，page version 保存为 `failed` review status，并写 blocked handoff；Deployer 不运行。
- 如果 Deployer 失败，只影响 deployment handoff，不回滚 page version。
- Web action 对用户只返回稳定错误码和安全 message；细节通过 run timeline / recovery view 解释。

## 测试策略

### API / service tests

- 新 LP task 在运行 Planner 前已经创建 task 和 user message，并把同一个 `taskId` 写入 Planner / Builder / Reviewer / Deployer runs。
- deterministic chain 完成后产生 brief、page version、artifact workspace、Reviewer handoff、Deployer handoff 和 assistant summary message。
- `REAL_MODEL_RUNTIME=1` fake provider 下 Planner / Builder 使用模型 structured output，Reviewer / Deployer 保持 deterministic。
- Planner failure 保留 task 和 failed Planner run，不保存 brief/page version，并返回安全 error。
- Builder parse/retry exhausted 不保存 page version / artifact workspace，并通过 recovery view 暴露。
- Reviewer blocked 不创建 Deployer run，并展示 blocked handoff。
- Deployer failure 不删除 page version。
- 后续修改复用 task/project，创建新 brief、新 page version 和新 artifact workspace。

### Web store / action tests

- `submitPromptAction` 对 LP prompt 进入 task-first orchestration，而不是先跑完链路再创建 task。
- LP chain 的 task state 刷新后能看到 role runs、run events、artifact workspace event、review status、deployment handoff 和 recovery view。
- partial snapshot 下仍能展示 failed Planner / Builder 的 timeline 和 recovery block。
- ordinary chat 继续走 Stage 26/27 streaming route，不被 LP chain orchestration 影响。
- projectless LP prompt 仍能创建隐式 project，并把 project id 绑定到 task。

### Runtime / context tests

- Planner / Builder context pack 包含 task id、project skills、memory summary、handoff summary 和 artifact workspace metadata，且不包含完整 artifact raw content。
- Builder 修改现有 LP 时能看到 latest page version metadata 和 bounded artifact manifest。
- Context Pack trace 能区分已注入 / 省略的 skills、memory、handoffs 和 artifact workspace。

### 回归验证

- `pnpm exec vitest run packages/api/src/services.test.ts packages/api/src/run-lifecycle.test.ts`
- `pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts`
- `pnpm exec vitest run apps/web/src/lib/web-v1-smoke.test.ts`
- `pnpm test`
- `pnpm typecheck`

## 验收标准

- 用户在 Web 输入“生成一个电商 LP”后，刷新页面能看到同一个 task 下的 Planner、Builder、Reviewer、Deployer 事实。
- `REAL_MODEL_RUNTIME=1` 且项目配置真实 Planner / Builder route 时，Planner / Builder 产出来自 provider-backed structured output。
- 未开启真实模型 runtime 时，deterministic LP chain 仍通过测试和 smoke。
- Builder 产物写入 durable artifact workspace，preview/export 读取 workspace-backed current page version。
- Reviewer blocked、Planner/Builder failure 和 Deployer failure 都有安全 timeline / recovery 表达。
- 继续输入修改要求会生成新的 page version，不覆盖旧 artifact workspace。
- MCP、真实 shell、真实外部部署和 live no-refresh timeline 没有被本阶段意外引入。
