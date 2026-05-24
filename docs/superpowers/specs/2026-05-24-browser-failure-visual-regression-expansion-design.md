# Stage 45：Browser Failure and Visual Regression Expansion v0 设计

**状态：** 已实现。

**日期：** 2026-05-24

## 背景

Stage 31 已建立 deterministic Playwright browser acceptance，Stage 34 已加入第一批 failure injection 和轻量 layout visual contract。随后 Stage 41-44 把 V1 Web surface 收敛为 Workbench、Artifacts、Skills 和 Models，并补齐 Run timeline / Recovery polish、dedicated artifact workspace、Skills / Models client-side management。

Stage 45 的目标不是继续扩大产品功能，而是把 `pnpm alpha:e2e` 对这些新增 Web surface 的浏览器可见 contract 补齐。默认 gate 仍必须 deterministic、Chromium-only、本地 Next.js dev server、隔离 JSON state，并且不依赖真实 provider、MCP server、Postgres、真实部署或网络服务。

## 目标

- 扩展 browser failure injection，覆盖 Stage 41-44 新增主路径和安全失败状态。
- 用轻量 geometry / layout assertions 固定关键 V1 Web surface 的可见结构，继续保存 diagnostic screenshots。
- 强化 non-leakage 断言，确保 query debug values、secret env names、base URL、raw provider response、raw skill content、raw artifact full content 和本机路径不会进入浏览器可见 UI。
- 保持 `pnpm alpha:e2e` 作为独立 deterministic acceptance gate，不并入 `pnpm alpha:check`。
- 只在必要时做小的 Web 可测试性补丁；优先复用现有 UI、helpers、server actions 和 isolated state fixtures。

## 非目标

- 不引入 pixel-perfect screenshot baseline。
- 不引入远端 browser farm、跨浏览器矩阵或移动端完整矩阵。
- 不让默认 browser gate 依赖真实 provider、MCP、Postgres、真实部署、外网或真实 API key。
- 不测试 raw artifact full content、raw provider response、raw tool output 或 raw skill content。
- 不改变 Agent runtime、run event schema、recovery action contract、model gateway、skill command execution contract、artifact policy 或 repository schema。
- 不恢复 MCP management、MCP tab、sidebar MCP 入口或 top-level MCP Web surface。

## 设计

### 测试架构

Stage 45 继续复用根目录 `playwright.config.ts`：

- `testDir` 仍为 `apps/web/e2e`。
- `outputDir` 仍为 `test-results/alpha-e2e-artifacts`。
- `webServer` 继续启动本地 Next.js dev server。
- `LP_AGENT_WORKBENCH_STATE_FILE`、`WORKER_JOBS_FILE`、`WORKER_PAYLOADS_FILE` 和 `WORKER_LOGS_FILE` 继续指向 `test-results/alpha-e2e-state`。
- `REAL_MODEL_RUNTIME=0`、`REAL_MODEL_PROVIDER_TEST=0`、JSON repository backend 保持默认。

新增覆盖应优先落在现有 browser spec 上，只有当主题明确独立时才新增文件：

- `apps/web/e2e/alpha-boundaries.spec.ts`：扩展 MCP hidden / legacy route fallback。
- `apps/web/e2e/alpha-lp-artifacts.spec.ts`：扩展 artifact workspace failure / snippet boundary。
- `apps/web/e2e/alpha-failures.spec.ts`：扩展 timeline/recovery、Skills / Models fail-closed 和 non-leakage。
- `apps/web/e2e/alpha-visual.spec.ts`：扩展 V1 Web surface layout contracts 和 diagnostic screenshots。
- `apps/web/e2e/helpers.ts`：只放复用价值明确的 browser helpers。

### 覆盖范围

#### MCP hidden / legacy fallback

已隐藏的 MCP Web surface 需要继续保持安全降级：

- 主导航不显示 `MCP`。
- `/?view=mcp` 降级回 Workbench，不显示 `Project MCP`、connector form、tool approval form 或 read-only execution button。
- 带 query debug 值的 legacy MCP URL 不把 debug 内容渲染到页面。

这部分验证的是 V1 product surface 边界，不删除后端 MCP registry / execution 能力。

#### Artifact workspace failure / snippet boundary

Dedicated artifact workspace 已有 happy path。Stage 45 扩展失败和边界状态：

- `view=artifacts` 下 unknown `artifactPath` 显示安全 unavailable copy，并保持 workspace shell 可用。
- path traversal / query-secret 样式的 `artifactPath` 不回显原始路径或 secret-like token。
- oversized snippet 通过 deterministic fixture 或 isolated state mutation 制造，不通过真实文件系统或网络；UI 应显示 size-limit / unavailable copy，而不是 full artifact content。
- artifact workspace layout contract 检查 hero、manifest、preview 和 export 区域在 desktop viewport 内不重叠、不产生水平滚动。

实现时如果需要构造 oversized snippet，应只写入 Playwright isolated JSON state 或通过现有 deterministic LP flow 生成可控 artifact record。测试不得读取或断言 raw full artifact content。

#### Timeline / recovery diagnostics

Stage 43 已把 run timeline / recovery polish 做成 Web-only view-model。Stage 45 只验证浏览器可见 contract：

- LP live task 的 fixed role lifecycle、handoff marker、repair/retry guidance 至少在主路径中可见。
- recovery error query 继续显示 bounded copy，不泄漏 debug query、raw model output、provider secret、worker log detail 或本机路径。
- failure state UI 不应遮挡或破坏 composer、timeline 和 artifact summary 的关键布局。

Stage 45 不新增 recovery action，也不改变 retry/resume 语义。

#### Skills / Models management failure states

Stage 44 已覆盖 management happy path。Stage 45 扩展失败和视觉边界：

- Skills invalid manifest / worker queue error 显示 stable error copy，不回显 raw skill content 或 debug token。
- Models invalid provider config、missing provider、disabled provider route 和 invalid API key env 显示 fail-closed copy，不回显 secret env assignment、base URL 或 raw provider detail。
- Skills / Models surface 的 key sections 在 desktop viewport 内保持可扫描，不出现关键按钮或 alerts 被 composer/sidebar 遮挡。

这些测试只验证 UI 和 server action 的安全反馈，不改变 Skills / Models runtime behavior。

#### Lightweight visual contracts

Stage 45 继续使用 geometry assertions，而不是截图基线：

- Empty workbench layout contract 保留。
- 增加至少两个 V1 surface layout contracts：artifact workspace 和 management surface。
- 每个 visual contract 在 `testInfo.outputPath(...)` 保存 diagnostic screenshot，供失败排查使用。
- 断言重点是关键区域存在、相对位置合理、没有水平滚动、按钮/输入在父容器内，不检查像素级颜色或微小间距。

## 数据流和安全边界

Browser tests 只通过用户可见入口、server actions、API routes 或 isolated test state 操作数据。测试可以为了构造 fail-closed state 修改 `test-results/alpha-e2e-state/workbench-state.json`，但必须满足：

- 只修改 Playwright isolated state，不触碰用户本地 `.lp-agent` state。
- fixture mutation 必须小、可读、只服务于无法通过 UI 合法创建的 fail-closed 状态。
- fixture 不包含真实 secret、真实 provider URL、真实 API key 或本机绝对路径。
- 断言只检查 safe copy、stable labels、bounded metadata 和 non-leakage。

## 文档影响

Stage 45 implementation 完成时应同步：

- `README.md`：更新 `pnpm alpha:e2e` 覆盖描述。
- `docs/web-v1-acceptance.md`：更新自动 browser acceptance coverage。
- `docs/alpha-release-candidate.md`：更新 RC deterministic gate coverage。
- `docs/project-roadmap.md`：标记 Stage 45 完成并推荐 Stage 46。
- `docs/superpowers/README.md`：加入 Stage 45 spec/plan 阅读顺序。
- `docs/agent-development-learning.md`：记录 Stage 45 是 browser acceptance 扩展，不是 Agent runtime 扩展。

本设计 spec 创建时已同步 `docs/superpowers/README.md`、`docs/project-roadmap.md` 和 `docs/agent-development-learning.md`，因为它定义了新的阶段范围。

## 验收标准

- Stage 45 新增或扩展的 browser tests 覆盖 MCP hidden fallback、artifact workspace boundary、timeline/recovery diagnostics、Skills / Models fail-closed 和至少两个 V1 visual contracts。
- `pnpm alpha:e2e` 通过，且默认不需要真实 provider key、MCP server、Postgres、真实部署或网络服务。
- 相关 focused Playwright specs 可单独运行，便于定位失败。
- `pnpm alpha:check` 和 `pnpm typecheck` 不因测试扩展回退。
- `git diff --check` 通过。
- 文档与 roadmap 的 Stage 45 / Stage 46 状态一致。

## 风险和取舍

- Browser tests 会增加运行时间。Stage 45 只选择 V1 Web surface 的关键用户可见 contract，不把每个表单分支都搬进 E2E。
- Geometry assertions 比 screenshot baseline 更粗，但更适合当前仍在收口的 UI。像素级 baseline、跨浏览器矩阵和远端 browser farm 放到后续 backlog。
- Fixture mutation 能覆盖 UI 不允许合法创建的 fail-closed 状态，但必须保持 isolated、显式、可审计，避免把测试变成对 repository internals 的宽泛依赖。
