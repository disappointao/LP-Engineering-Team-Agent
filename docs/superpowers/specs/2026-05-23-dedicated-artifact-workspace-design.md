# Dedicated Artifact Workspace v0 Design

**日期：** 2026-05-23
**状态：** 已批准
**关联阶段：** Stage 42

## 背景

Stage 28-29 已经让 LP 复杂任务写入 durable artifact workspace，并在 Web 中通过 live task panel、artifact diff、bounded snippet、preview 和 export 暴露最小可见能力。Stage 41 已把 MCP Web surface 从 V1 中隐藏，V1 polished alpha 的下一步是把 artifact 从局部生成结果提升为明确的一等工作区。

当前问题不是 artifact runtime 缺失，而是用户在 Workbench 内只能把生成文件当成任务消息的一部分查看。V1 polished alpha 需要一个独立 Web surface，让内部用户能稳定查看当前 LP task / project 的文件 manifest、preview、bounded snippet、export 和安全失败状态。

## 用户决策

- 采用 `view=artifacts`，在现有 `HomePage` 内新增 dedicated artifact workspace view。
- 不新建 `/artifacts` 或 `/tasks/[id]/artifacts` route；本阶段继续复用当前 cookie-based project/task session。
- 工作区使用现有 repository facts、`getPageState`、artifact diff、controlled artifact reader 和 bounded snippet。
- 保持三文件静态 LP artifact contract：`index.html`、`styles.css`、`script.js`。

## 目标

Stage 42 完成后，V1 Web 应具备：

- 顶层导航中的 `Artifacts` 入口，和 Workbench、Skills、Models 并列。
- 当前 LP task 已有 artifact 时，`view=artifacts` 展示 dedicated artifact workspace。
- 工作区展示 file manifest、file state、size、short hash、summary、bounded snippet、static preview 和 export links。
- artifact key 或 task state 更新时，沿用现有 live polling / refresh 机制，无需用户手动刷新才能看到已完成 artifact。
- unknown path、path traversal、missing artifact workspace、artifact diff unavailable 和 snippet unavailable 均显示安全失败状态。
- UI 不回显危险 `artifactPath` query，不泄漏 full artifact content、secret、本机路径、raw provider response 或 raw tool output。

## 非目标

- 不做 line-level diff。
- 不做 patch / apply workflow。
- 不支持 binary asset、object storage、desktop filesystem workspace mapping 或 framework-specific artifact。
- 不改变 artifact policy、artifact export contract、`StaticArtifactsSchema` 或三文件静态 contract。
- 不把完整 artifact 内容放入默认 timeline、chat message、run event、model context 或 page state metadata。
- 不新建生产级文件浏览 API，也不引入 auth/RBAC。

## 信息架构

V1 顶层 Web navigation 变为：

- Workbench
- Artifacts
- Skills
- Models

`view=artifacts` 是独立 surface，但仍读取当前 session 中的 `currentProjectId` 和 `currentTaskId`。如果当前 task 不是 LP task、没有当前 task、或没有可用 page version，显示 dedicated artifact empty state，引导用户回到 Workbench 生成 LP，而不是展示伪数据。

旧 `view=mcp` 继续安全降级为 Workbench，不进入 Artifacts，也不展示 MCP state。

## UI 结构

Artifacts view 包含四个主要区域：

### 1. Workspace Header

显示当前 project / task 的安全摘要：

- project name
- task title
- page version id 的短摘要或 copy 中的 current version label
- artifact workspace id 的短摘要（如果存在）

Header 不展示本机路径、repository path、raw artifact source 或 provider details。

### 2. File Manifest

复用 `WebArtifactDiffState.files` 渲染 canonical file list：

- `index.html`
- `styles.css`
- `script.js`

每个文件展示：

- path
- state label：initial / added / removed / changed / unchanged
- size
- short hash
- summary
- snippet preview action

文件卡只使用 metadata，不包含 full HTML/CSS/JS 内容。

### 3. Snippet Panel

继续使用 query 参数 `artifactPath` 选择 snippet。可选值只允许 canonical artifact file path：

- `index.html`
- `styles.css`
- `script.js`

`artifactPath` 无效、越权、path traversal 或目标文件不可读时，UI 只显示通用 unavailable copy，不回显原始 query。Snippet 内容继续受 `ARTIFACT_WORKSPACE_DEFAULT_READ_MAX_BYTES` 限制，超过限制时显示 size-limit copy。

### 4. Preview and Export

当 `snapshot.currentPageVersion.artifacts` 存在时：

- 展示 `LPPreview` static preview。
- 展示 single HTML export 和三文件 export links。

Export 继续复用 `createArtifactDownloadLinks`，不改变 download filename、single HTML bundling 或 data URL contract。

## 数据流

Artifacts view 不引入新的 repository truth：

1. `HomePage` 解析 `view=artifacts` 和 `artifactPath`。
2. `getWebWorkbenchStore().getPageState({ projectId, taskId, artifactPath })` 读取当前 session facts。
3. `WorkbenchPageState.artifactDiff` 提供 metadata-only manifest、file status 和 bounded selected snippet。
4. `snapshot.currentPageVersion.artifacts` 只用于 `LPPreview` 和 export links，不进入 file manifest cards。
5. `LiveTaskPanel` 继续通过 `/api/tasks/[taskId]/state` 轮询 repository facts；当 artifact progress key 变化时刷新当前 view。

这保持现有安全边界：metadata list 和 bounded snippet 可出现在 Web state；完整 artifact source 只进入 preview/export 所需组件，不进入 timeline / chat / model context summary。

## 错误处理和安全

Artifacts view 使用 bounded、localized copy：

- No current artifact：显示空状态，不抛栈、不展示伪 artifact。
- `artifact_diff_unavailable`：显示 artifact workspace 暂不可用。
- `artifact_snippet_unavailable`：显示 snippet 暂不可用。
- oversized snippet：显示 8 KB preview limit 文案。
- invalid `artifactPath`：不展示原始 query value。

安全断言：

- 不展示 `../`、secret-like query token、raw absolute path。
- File manifest JSON / rendered text 不包含 full artifact sentinels，例如 `<!doctype html>`、完整 CSS body 或 `window.lpAgent`。
- Legacy `view=mcp` 不会被 artifact links 保留。

## 测试策略

### Focused Vitest

- `page.test.tsx` 覆盖 Artifacts nav、active state、empty state、workspace header、manifest、snippet、preview、export links 和 legacy MCP query stripping。
- `workbench-store.test.ts` 如发现当前 `artifactDiff` view model 不足，补最小 regression；优先复用现有 coverage。
- `i18n.test.ts` 覆盖新增英文/中文 copy。

### Browser Acceptance

扩展 deterministic `pnpm alpha:e2e`：

- LP live task 完成后进入 `view=artifacts`。
- 断言 manifest 三文件可见、preview 可见、export links 可见。
- 点击每个 snippet preview 后仍停留 Artifacts view。
- unknown / traversal `artifactPath` 显示安全 unavailable copy，且不泄漏 query sentinel。

### Final Verification

本阶段完成前运行：

- `pnpm exec vitest run apps/web/src/app/page.test.ts apps/web/src/lib/i18n.test.ts apps/web/src/lib/workbench-store.test.ts`
- `pnpm alpha:check`
- `pnpm typecheck`
- `pnpm alpha:e2e`
- `git diff --check`

如果 `pnpm alpha:e2e` 因本地 sandbox 不能绑定 dev server 失败，应使用已批准的命令权限或向用户请求提升权限后重跑。

## 文档更新

Stage 42 实现完成时必须同步：

- `docs/project-roadmap.md`：Stage 42 状态、当前状态快照、推荐下一阶段队列和决策记录。
- `docs/superpowers/README.md`：Stage 42 spec / plan 阅读顺序。
- `docs/web-v1-acceptance.md`：dedicated artifact workspace 手动验收项。
- `docs/alpha-release-candidate.md`：RC trial script / go-no-go 中的 artifact workspace 项。

本阶段不改变 Agent runtime、context assembly、model routing、MCP/tool execution、worker queue 或 multi-agent coordination 边界，因此默认不更新 `docs/agent-development-learning.md`；如果实现中改变这些边界，再同步更新。
