# Stage 31 Browser E2E Acceptance v0 Design

**日期：** 2026-05-22

**状态：** 设计已确认，待实施计划。

## 背景

Stage 29/30 已经把第一版可用闭环收敛到 Skill-only local alpha：普通聊天支持 Web/API streaming，LP 复杂任务通过 live task submit 和短轮询展示 progress，artifact preview/export/snippet 可用，Skills/Models/MCP 的 alpha 边界文案已经明确。

当前缺口是浏览器层验收仍依赖人工清单和 Vitest store/API 级 smoke。`pnpm alpha:check` 能快速证明 deterministic 核心逻辑可用，但不能证明用户在真实浏览器里可以完成输入、等待 streaming、看到 live task progress、打开 preview/export/snippet，或确认 Skills/Models/MCP 边界页面没有交互退化。

Stage 31 的目标是引入一个可重复、默认 deterministic、可在本地执行的 browser E2E acceptance gate。它应该补足“网页看起来和可操作起来是否真的可用”的证据，而不是扩大 runtime 能力。

## 目标

1. 新增 repo-native browser E2E command，例如 `pnpm alpha:e2e`。
2. 默认只覆盖 Chromium，避免一开始引入跨浏览器矩阵成本。
3. 使用 deterministic runtime，不需要真实 provider key、MCP server、Postgres、远端浏览器 farm 或真实部署。
4. 每次 E2E 使用隔离的 `LP_AGENT_WORKBENCH_STATE_FILE`，避免污染开发者本地 `.lp-agent/workbench-state.json`。
5. 覆盖第一版可用闭环的浏览器可见主路径：
   - 普通聊天 streaming；
   - LP live task fallback / progress / artifact；
   - artifact preview/export/snippet；
   - Skills / Models / MCP alpha boundary views；
   - 基础 recovery display 可见性。
6. 更新 README、manual acceptance checklist、roadmap、Superpowers 索引和 Agent 学习笔记，让 Stage 31 的验收入口清晰。

## 非目标

- 不做生产监控或 observability stack。
- 不引入远端浏览器 farm、跨浏览器矩阵或完整视觉回归平台。
- 不做 MCP execution、真实 MCP SDK、write tools 或 MCP worker execution。
- 不做 auth/RBAC、真实 shell runner、真实部署编排、Postgres production rollout 或 object storage migration。
- 不做真实 provider token streaming、usage/cost metadata 或 fallback provider execution；这些进入 Stage 32 或后续阶段。
- 不把 Browser E2E 作为 `pnpm alpha:check` 的一部分；`alpha:check` 继续保持快速 deterministic readiness gate。

## 方案比较

### 方案 A：Playwright browser gate

在 repo 中新增 Playwright 配置、浏览器测试目录和 `pnpm alpha:e2e`。测试启动 Next.js dev server，使用 Chromium，写独立 JSON state file，按用户可见行为断言。

优点：

- 最接近真实用户使用路径。
- Playwright 对等待网络、locator、下载、截图和 trace 支持成熟。
- 可以逐步扩展为 Stage 33 的 UX hardening 输入。

缺点：

- 新增依赖和浏览器安装成本。
- CI 或本地环境需要明确 browser install / missing browser 的失败提示。

### 方案 B：继续扩展 Vitest + React render tests

继续在 Vitest 中渲染 React 组件和 route handler，不引入真实浏览器。

优点：

- 依赖少，速度快。
- 已有测试结构熟悉。

缺点：

- 不能证明真实浏览器中的 submit、streaming fetch、router refresh、cookie session、download link 和 snippet navigation 能串起来。
- 和 Stage 31 的“browser E2E acceptance”目标不匹配。

### 方案 C：手动 checklist 强化

只增强 `docs/web-v1-acceptance.md`，不新增自动化 browser gate。

优点：

- 实施成本最低。
- 对真实 provider 手动路径仍有价值。

缺点：

- 无法阻止浏览器交互回归。
- 每次阶段收尾仍靠人工记忆，和 Stage 31 的可重复验收目标冲突。

## 选择

采用方案 A：新增 Playwright browser gate。方案 B 的组件/API 测试继续作为 `pnpm alpha:check` 的核心，方案 C 的 checklist 继续保留为人工验收补充。Stage 31 不要求所有 checklist 条目自动化，只把最能防回归的用户主路径变成可重复的 browser acceptance。

## 测试架构

新增 `apps/web/e2e/` 或等价目录，放置浏览器验收 specs。新增 root-level Playwright config，负责：

- 使用 `pnpm --filter @lp-agent/web dev` 或等价 Next.js dev server；
- 绑定可预测端口，避免和开发者已有 server 混用；
- 设置 deterministic 环境变量：
  - `REAL_MODEL_RUNTIME=0`
  - `REAL_MODEL_PROVIDER_TEST=0`
  - `WORKBENCH_REPOSITORY_BACKEND=json`
  - `LP_AGENT_WORKBENCH_STATE_FILE=<test-output>/workbench-state.json`
- 将 artifacts、trace、screenshots、downloads 写入 test output 目录；
- 默认只跑 Chromium。

如果 Playwright 浏览器二进制未安装，`pnpm alpha:e2e` 应 fail closed，并在 README 中说明需要执行对应 install 命令。默认 `pnpm install` 不应偷偷依赖网络执行 browser download。

## 浏览器路径

### 普通聊天 streaming

测试从空 state 打开首页，输入普通聊天 prompt，例如 `帮我整理一个首页上线检查清单`。

验收点：

- prompt 输入框可用；
- submit 后出现 streaming/loading 状态；
- assistant message 最终可见；
- 页面刷新或 router refresh 后 user / assistant conversation 保留；
- 不出现 LP artifact preview。

### LP live task

测试输入 LP prompt，例如 `生成一个春季电商活动的静态 HTML 落地页`。普通 chat stream 应返回 LP fallback，客户端调用 live task submit，然后页面通过 task state polling 展示 progress。

验收点：

- 不依赖手动刷新即可看到 live task panel；
- Planner / Builder / Reviewer / Deployer 相关 progress 或 run timeline 可见；
- terminal state 后 artifact summary 可见；
- 当前 page version 具有 `index.html`、`styles.css`、`script.js`；
- generated artifact 保持静态 HTML/CSS/JS，不出现 React/Vue/Angular/Next/Vite 构建依赖文案。

### Artifact preview/export/snippet

在 LP task 完成后继续验证 artifact 用户动作。

验收点：

- preview 区域可见；
- export/download links 可见，href 或下载行为指向 `index.html` / single HTML / source files 的安全输出；
- `Preview snippet` 可以切换 `artifactPath=index.html`、`styles.css`、`script.js`；
- snippet 是 bounded read-only source preview；
- 未知 artifact path 不破坏页面，显示 graceful state。

### Skills / Models / MCP 边界

测试通过 sidebar 打开 `Skills`、`Models`、`MCP` view。

验收点：

- Skills view 显示 Skill-only alpha 主路径说明；
- Skill command queue 显示 approval/queue/safe observation 边界；
- Models view 显示真实 provider opt-in 和 fail-closed 说明；
- MCP view 显示 MCP deferred 说明；
- 默认 alpha 不要求配置 provider key、MCP connector 或 Postgres。

### 基础 recovery display

Stage 31 不新增故障注入 runtime。基础 recovery display 只覆盖已有 deterministic 路径中能自然出现或通过安全 test fixture 构造的可见 recovery block。

如果当前产品路径没有稳定方式触发 recovery block，本阶段可以新增仅用于 browser acceptance 的 deterministic fixture route 或 seeded state helper，但它必须：

- 只在 test 环境启用；
- 不暴露 raw artifact content、secret、provider response、本机路径或 raw stdout/stderr；
- 不改变 production runtime protocol；
- 不成为普通用户入口。

如果实现阶段发现 test-only fixture 会显著增加风险，Stage 31 可把 recovery display 降级为“task page 中无 recovery 时不显示错误，已有 unit tests 覆盖 recovery action contract”，并把更强故障注入放入后续阶段。

## 稳定 locator 策略

优先使用可访问 locator：

- role / name；
- label；
- heading；
- visible text；
- URL query。

只有当用户可见文本不稳定或无法表达状态时，才新增少量 `data-testid`。新增 test id 必须服务于真实用户状态，不得把内部实现细节变成 E2E contract。

## 数据隔离

Browser E2E 必须使用独立 JSON-file state：

- 每个 test worker 或 test file 使用独立 temp path；
- test 完成后可以保留在 Playwright output 中便于排查；
- 不读取或写入开发者默认 `.lp-agent/workbench-state.json`；
- 不依赖固定 project/task id，除非由测试自己 seed 或从可见 UI/API 响应中读取。

Cookie session 由真实页面流程设置。测试可以清理 browser context，但不应直接伪造 production-only cookie 行为，除非在 test setup 中验证 session recovery。

## 错误处理和失败排查

`pnpm alpha:e2e` 失败时应留下足够证据：

- Playwright trace 或 screenshot；
- 当前 test 使用的 JSON state file；
- dev server stdout/stderr；
- 失败路径和 locator 名称。

README 和 checklist 需要说明常见失败：

- browser 未安装；
- 端口被占用；
- `LP_AGENT_WORKBENCH_STATE_FILE` 不可写；
- dev server build/type error；
- deterministic runtime 被环境变量误切到真实 provider。

## 文档更新

实现阶段需要更新：

- `package.json`：新增 `alpha:e2e`，如有必要新增 `alpha:e2e:install` 或文档化 Playwright install 命令。
- `README.md`：说明 browser E2E 与 `alpha:check` 的关系、运行方式、默认 deterministic 边界和故障排查。
- `docs/web-v1-acceptance.md`：把已自动化覆盖的条目标注为可由 `pnpm alpha:e2e` 覆盖，保留真实 provider smoke 作为手动可选项。
- `docs/project-roadmap.md`：Stage 31 状态、完成范围、后续 Stage 32/33 队列。
- `docs/superpowers/README.md`：新增 Stage 31 spec/plan 索引。
- `docs/agent-development-learning.md`：记录 browser E2E 对 Agent workflow 的意义和边界。

## 测试计划

设计阶段完成后，实施计划应按 TDD 拆分：

1. 先用 failing command/test 证明 `pnpm alpha:e2e` 尚不存在或 Playwright 配置缺失。
2. 新增最小 Playwright 配置和空/健康检查 spec，让命令能启动浏览器和 dev server。
3. 增加普通聊天 streaming E2E。
4. 增加 LP live task + artifact E2E。
5. 增加 Skills / Models / MCP boundary E2E。
6. 视当前状态决定是否增加安全 recovery fixture 或只保留基础显示断言。
7. 更新 docs 并跑完整验证。

最终验证至少包括：

```bash
pnpm alpha:e2e
pnpm alpha:check
pnpm smoke
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

## 验收标准

- `pnpm alpha:e2e` 存在，默认 deterministic，可在本地启动浏览器验收。
- E2E 不依赖真实 provider key、MCP server、Postgres、远端浏览器 farm 或真实部署。
- E2E state 隔离，不污染开发者默认 `.lp-agent/workbench-state.json`。
- 普通聊天 streaming 主路径有浏览器级覆盖。
- LP live task、artifact preview/export/snippet 主路径有浏览器级覆盖。
- Skills / Models / MCP alpha boundary views 有浏览器级覆盖。
- README/manual checklist/roadmap/Superpowers index/Agent learning 与当前事实一致。
- `pnpm alpha:check` 继续保持快速 deterministic gate，不被 browser E2E 拖慢。
