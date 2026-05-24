# Stage 44 Skills and Models Client-side Management v0 设计

## 背景

V1 polished alpha 已经完成 Web surface pruning、dedicated artifact workspace、run timeline 和 recovery polish。当前第一版 Web surface 只保留 Workbench、Artifacts、Skills、Models；MCP management 继续后置。

Skills 是第一版主要扩展机制，Models 是真实 provider opt-in 的入口。仓库已经具备 Skills / Models 的核心 repository、API service、server action 和 Web view，但当前页面仍偏“表单集合”：用户很难从页面上判断某个 skill/version/binding 或 model/provider/route 当前处于什么阶段、刚刚提交的动作是否成功、失败应该如何修正，以及哪些配置会进入 runtime context。

Stage 44 只收紧 Skills / Models 的客户端管理体验。它不改变 Agent runtime schema、model gateway contract、skill command execution contract、real provider opt-in 默认关闭策略，也不恢复 MCP management 入口。

## 当前基线

已存在能力：

- `apps/web/src/app/page.tsx` 已在 `?view=skills` 和 `?view=models` 渲染 Skills / Models 管理视图。
- `apps/web/src/app/actions.ts` 已提供 `createSkillDraftAction`、`validateSkillVersionAction`、`publishSkillVersionAction`、`bindSkillVersionAction`、`setSkillBindingEnabledAction`、`executeSkillCommandAction`、`runLocalWorkerOnceAction`、`createModelProviderAction`、`setModelProviderEnabledAction` 和 `upsertProjectModelRouteAction`。
- `apps/web/src/lib/workbench-store.ts` 已把这些 action 映射到 `DemoWorkbenchService`，并返回 stable error codes。
- `packages/api` 已支持 repository-backed skill lifecycle、runtime skill lookup、model provider config、route assignment 和 model routing policy resolution。
- `apps/web/src/lib/i18n.ts` 已有中英文 Skills / Models 基础文案和错误文案。
- `pnpm alpha:e2e` 已覆盖 Skills / Models alpha boundary，但没有覆盖 Stage 44 之后的主路径管理体验。

当前问题：

- Skills 页面没有清楚表达 `draft -> validated -> published -> bound -> enabled` 的流程位置。
- Skill lifecycle action 完成后只靠重定向回页面，缺少可见的成功反馈和下一步引导。
- Skill binding 和 command approval/queue 的层级混在同一长页面里，用户不容易区分“上下文 skill”和“可执行 command”。
- Models 页面没有清楚区分 provider config、role routes、resolved runtime routes 和 fail-closed diagnostics。
- Provider `apiKeyEnv` / `secretEnvName`、API protocol、disabled provider、missing route、fallback mock 的安全语义不够直观。
- 页面上的客户端状态主要依赖全页刷新结果，缺少 pending affordance；但浏览器状态也不能成为事实来源。

## 目标

- 让 Skills 管理流程更清楚：draft、validate、publish、bind、enable/disable、command approval/queue 各自有可见状态和下一步动作。
- 让 Models 管理流程更清楚：provider config、enabled/disabled、role route assignment、resolved route、真实 provider opt-in、fail-closed reason 各自有可见状态。
- 增加 client-side pending / success / error affordance，但 action 完成后仍以 repository fact 重新渲染为准。
- 提供 bounded context summary：告诉用户哪些 skill/model metadata 会进入 runtime context，且不展示 raw skill content、secret、base URL 或 raw provider response。
- 保持 Web 表单和 server action 安全边界：浏览器提交的 action、projectId、providerId、skillVersionId、route role 仍需服务端重新验证。
- 将新增文案纳入 i18n，并补足 unit / browser acceptance 覆盖。

## 非目标

- 不做 MCP client-side management，不恢复 MCP tab / sidebar / top-level Web 入口。
- 不做 provider marketplace、billing/quota、cost ledger、automatic fallback provider execution 或团队级模型审批。
- 不改变 `REAL_MODEL_RUNTIME=1` 的显式 opt-in 策略；默认 deterministic/no-key path 不变。
- 不存储 API key 明文，不展示 secret 值，不从浏览器读取或验证真实 provider secret。
- 不改变 Agent runtime、Context Pack、model gateway、skill command runner、worker queue 或 repository schema。
- 不做实时多人协作、toast system、SSE、raw stdout/stderr streaming 或 production observability。

## 推荐方案

采用 **Web-only client management view-model + progressive form affordance**。

Stage 44 在 `apps/web` 内新增纯 view-model，把现有 `ProjectSkillState`、`ProjectModelState`、worker queue summary 和 stable error codes 派生成页面可读的管理状态。React 页面消费该 view-model，渲染分组状态、pending affordance、success feedback 和 bounded diagnostic copy。Server action 不信任浏览器状态；成功后继续 `revalidatePath("/")` 并回到 repository fact。

这个方案的优点：

- 变更范围与 Stage 44 对齐，主要是 Web/UI 和 i18n。
- 不牵动 runtime contracts，不影响 Stage 45 browser failure expansion 和 Stage 46 completion gate。
- 纯 view-model 可用 Vitest 覆盖安全规则、状态派生和 non-leakage。
- 后续如果要把 Skills / Models 拆成独立 route 或 client component，view-model 仍可复用。

不采用的方案：

- 不做 backend contract 扩展：当前 service/repository 已能表达 Stage 44 需要的事实，扩 schema 会扩大风险。
- 不把 Stage 44 拆成 Skills-only 和 Models-only 两阶段：V1 polished alpha 收口更需要一次性把两个保留 Web surface 打磨到可验收状态。

## UX 设计

### Skills 视图

Skills 页面分成四个明确区域：

1. Project context and runtime summary
   - 显示当前 project、active/bound skill count、enabled command count。
   - 明确说明只有 published + enabled + project-bound skill metadata 会进入 runtime context。
   - 不展示 skill raw content；content 只在创建表单里作为输入，提交后不回显。

2. Draft skill
   - 保留 manifest JSON、content textarea / file upload、content type。
   - 表单旁显示本地限制：project scope、plain text / markdown、size cap、no executable content。
   - 提交中按钮 disabled，并显示 pending label。
   - 成功后通过 query success code 展示 `Draft saved` / `草稿已保存`，再以 repository fact 展示版本。

3. Versions and bindings
   - 按 lifecycle stage 展示 `Draft`、`Validated`、`Published`、`Bound`、`Enabled/Disabled`。
   - 每行只显示当前合法下一步 action，例如 draft 显示 Validate，validated 显示 Publish，published 未绑定显示 Bind，bound 显示 Enable/Disable。
   - 已绑定版本显示 project binding 状态，避免用户以为 published 自动进入 runtime。

4. Commands and local worker
   - Deployment skill commands 和普通 context skills 分开。
   - Command card 明确显示 permission、requires approval、queue status entry point。
   - `Approve and queue` 是一次性本地批准，不代表全局信任。
   - Worker queue 仍是 local run-once / read-only health，不加入 daemon controls。

### Models 视图

Models 页面分成四个明确区域：

1. Project model summary
   - 显示当前 project、enabled provider count、configured route count、resolved route status。
   - 明确真实 provider 仍需要 `REAL_MODEL_RUNTIME=1` 和环境变量；页面只保存 secret reference，不保存 secret。

2. Provider config
   - 表单字段保留 provider id、display name、provider type、API protocol、base URL、api key env、model id。
   - Base URL 作为敏感-ish operational config 不在 summary 中完整展示；只展示 configured / not configured。
   - `apiKeyEnv` / `secretEnvName` 只显示 env var name，不显示 secret 值。
   - Provider 行展示 enabled/disabled、API protocol、model count、key reference configured 状态。

3. Role routes
   - 固定角色顺序为 `assistant`、`planner`、`builder`、`reviewer`、`deployer`。
   - 每个 route form 显示 provider select、model input 和 resolved status。
   - 没有 route 时显示 deterministic mock fallback；route 指向 missing/disabled provider 或 empty model 时显示 fail-closed diagnostic。

4. Resolved runtime routes
   - 只展示 provider id / model id / API protocol 等 bounded metadata。
   - 不展示 raw provider response、secret、完整 base URL 或请求 body。
   - 若存在 `resolutionError`，顶部显示 safe error copy，并在对应 route 附近标注。

## 状态和 URL 设计

继续使用 query-driven view：

- `/?view=skills`
- `/?view=models`

新增 query 参数只表达短期反馈，不作为事实来源：

- `skillNotice=draft_created|validated|published|bound|enabled|disabled|command_queued|worker_ran`
- `modelNotice=provider_created|provider_enabled|provider_disabled|route_saved`

已有错误 query 保持：

- `skillError=<stable skill error code>`
- `workerError=<stable worker error code>`
- `modelError=<stable model error code>`

页面读取 notice/error 后只渲染本地化反馈；真正状态仍来自 `store.getPageState()` 的 repository-backed `pageState.skills`、`pageState.models` 和 `pageState.workerQueue`。

## 安全边界

- 所有 action 继续在 server action / API service 里重新读取 repository state 并校验 project ownership、scope、provider、role、skill version、binding 和 command permission。
- Client-side pending state 只影响按钮和文案，不授权任何操作。
- Skills summary 不回显 raw skill content；command section 只展示 manifest 中安全 metadata。
- Models summary 不展示 secret、raw provider response、request body 或完整 base URL。
- Error copy 必须是 allowlisted code -> localized copy，不把 exception message 直接渲染到页面。
- Browser E2E 不依赖真实 provider、MCP、Postgres、真实 deployment 或网络服务。

## 测试策略

Unit tests：

- Skills view-model：lifecycle stage、bound/enabled status、allowed next actions、command count、safe runtime summary。
- Models view-model：provider summary、role route status、fallback mock、disabled/missing provider diagnostics、safe resolved metadata。
- i18n：新增 notice、pending、summary 和 diagnostics copy 的中英文覆盖。
- Page rendering：Skills / Models 分组、notice/error、action forms、non-leakage。
- Actions：成功后带 notice redirect；错误仍使用既有 error redirect。

Browser acceptance：

- Skills happy path：create draft -> validate -> publish -> bind -> disable/enable，确认 notice、stage、bound/enabled state 可见。
- Models happy path：create provider -> save planner/builder route -> disable provider，确认 resolved route、notice 和 fail-closed disabled provider copy 可见。
- Non-leakage：页面不展示 raw skill content、secret-like input、raw provider response 或完整 base URL。

验证命令：

- `pnpm exec vitest run apps/web/src/lib/i18n.test.ts apps/web/src/app/page.test.ts apps/web/src/app/actions.test.ts apps/web/src/lib/workbench-store.test.ts`
- `pnpm alpha:check`
- `pnpm typecheck`
- `pnpm alpha:e2e`
- `git diff --check`

## 文档更新

Stage 44 实现完成时同步更新：

- `docs/project-roadmap.md`：Stage 44 完成摘要、Stage 45 变为当前推荐、Stage 46 和后续队列保持非空。
- `docs/superpowers/README.md`：加入 Stage 44 spec / plan 阅读顺序。
- `docs/agent-development-learning.md`：记录 Skills / Models client-side management 的 Web-only boundary、repository fact source 和 secret-safe metadata 原则。
- `docs/web-v1-acceptance.md`、`docs/alpha-release-candidate.md`：加入 Stage 44 人工验收和 follow-up routing。

## 验收标准

- Skills 页面能让用户不读代码也判断一个 skill 是否已进入 runtime context。
- Models 页面能让用户不读文档也判断当前 role route 是否会走 deterministic mock fallback、真实 provider route，或 fail closed。
- 成功、pending、错误和下一步 action 文案清楚且本地化。
- 页面和测试不展示 raw skill content、secret、raw provider response、完整 base URL、本机路径或完整 artifact 内容。
- MCP management 仍隐藏；`/?view=mcp` 的 safe fallback 不被 Stage 44 破坏。
- 默认 deterministic gates 不需要真实 provider key 或网络。
