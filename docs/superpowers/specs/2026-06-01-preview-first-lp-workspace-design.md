# Preview-first LP 工作区设计

## 背景

当前 LP task 的用户体验仍偏“产物交付”：Builder 返回 `StaticArtifacts` 后，页面会同时准备 preview、artifact workspace、文件 manifest、导出链接和抽屉式预览。这个模型适合最终交付，但不适合用户反复试生成、预览、点选某个元素并继续修改的工作流。

目标是把 LP task 从“先生成完整静态产物再展示”推进到“先看到页面、再在预览里调试和按需导出”。生成的 LP 仍然必须保持框架无关静态 HTML/CSS/JS；本阶段不引入 React/Vue artifact，也不引入真实部署。

## 用户目标

- 创建或继续 LP task 后，用户尽快看到模型生成的 LP 页面预览。
- 预览不是右侧 modal/drawer，而是工作台右侧的常驻预览空间；打开时中间对话区变窄，关闭后恢复。
- 导出功能放在右侧预览空间里，用户需要交付时再点击导出。
- 用户可以在预览页面里开启元素查看器，点选 DOM 元素。
- 点选后，聊天输入框显示已选元素上下文，后续提问会带上这个元素信息，方便模型精确修改。

## 阶段拆分

### Phase 1：Preview Workspace v0

本阶段交付浏览器可见的交互闭环：

- 用右侧 `LPPreviewWorkspace` 取代 workbench 内的 `ArtifactPreviewDrawer`。
- 右侧预览空间包含预览 iframe、元素查看器开关、选中元素摘要和导出区。
- 导出链接在 client 侧按需创建，主页面 server render 不再提前调用 `bundleSingleFileHtml` 准备抽屉导出数据。
- `LPPreview` 支持 inspect mode：给 iframe 的 `srcDoc` 注入同源安全脚本，允许 hover 高亮和 click 选择元素。
- 选择结果包含 bounded metadata：`selector`、`tagName`、`text`、`outerHTML` 截断片段。
- `StreamingWorkbench` composer 支持 `selectedElement` 隐藏字段和可见 chip；用户发送消息时一并提交。
- `createStreamingChatRequestBody` 和 native `submitPromptAction` 路径都携带 `selectedElement`。
- API / store 将 selected element 作为普通 prompt 的附加上下文，不把 iframe 内任意脚本或未截断 HTML 直接写入消息。

### Phase 2：Preview-first Backend Boundary

在 Phase 1 通过后继续处理生成链路：

- `generatePageVersion` 先保存可预览的 `PageVersionRecord.artifacts`，artifact workspace files 变成 lazy materialization。
- `artifactWorkspaceId` 可以延后创建；当用户打开 artifacts view、请求 snippet 或点击导出时再生成 workspace files。
- `LiveTaskStatePayload` 和 Web view model 以 `currentPageVersion.artifacts` 作为预览 ready 的首要信号，而不是必须等待 workspace manifest 完整。
- 保留现有 artifact policy validation，不能为了快预览绕过 static artifact 安全校验。

### Phase 3：Element-targeted LP Revision

在选中元素上下文稳定后，继续强化模型修改能力：

- Builder continuation prompt 显式接收 selected element metadata。
- 对 selected element 提问时默认走 `agent_continue`，普通说明或问答仍可由 intent router 判断为 `chat_in_task`。
- 后续可扩展 DOM 控制台：显示层级、CSS selector、computed style 摘要和可复制 selector。

## 关键设计

### 右侧预览空间

`LPPreviewWorkspace` 是 client component，包住 workbench 主内容和可选 preview panel。它维护：

- `isOpen`
- `inspectMode`
- `selectedElement`

打开时根容器添加展开态 class，让 `.conversationStack` 最大宽度收窄，右侧 panel 固定在 `chatWorkspace` 内部而不是覆盖整个浏览器。移动端降级为底部/全屏预览面板。

### 元素查看器

`LPPreview` 保持 iframe sandbox，但使用 `srcDoc` 注入极小脚本：

- hover 时给目标元素加 outline。
- click 时阻止默认行为，计算 selector 和 bounded HTML/text。
- 通过 `postMessage` 发给父页面。

父页面只接受同一个 iframe 的消息，并用 Zod/手写 guard 校验字段、长度和 tag。selector 不作为自动执行代码，只作为模型上下文和 UI 显示。

### Composer 上下文

composer 上方展示一个 selected element chip，例如：

`已选中 h1.hero-title · 夏季新品`

提交时同时发送：

```json
{
  "selectedElement": {
    "selector": "main .hero h1",
    "tagName": "h1",
    "text": "夏季新品",
    "outerHTML": "<h1 class=\"hero-title\">夏季新品</h1>"
  }
}
```

后端会把它转成 bounded prompt context：

`用户当前选中的 LP 元素：selector=... tag=h1 text=... html=...`

### 导出

Phase 1 仍使用当前三文件 `StaticArtifacts` 作为导出来源，但导出数据 URL 在 client component 里按需生成，避免 workbench 主渲染提前 bundle single HTML。Phase 2 再把 workspace 文件持久化改成 lazy。

## 非目标

- 不引入真实发布、部署或远端文件存储。
- 不把完整 artifact 源码直接显示在聊天区或 timeline。
- 不允许 iframe 内脚本调用父页面任意 API。
- 不做可视化拖拽编辑器。
- 不在本阶段实现自动 DOM diff patch 引擎；仍通过模型生成下一版 LP。

## 验收标准

- 完成 LP 后，聊天区出现“预览”入口，点击后右侧预览空间出现，中间聊天区域变窄。
- 右侧预览能显示当前 LP 页面，并提供导出入口。
- 开启元素查看器后，点击预览中的标题/按钮/区块，composer 显示选中元素。
- 发送“把这个标题改得更有高级感”等问题时，请求中包含 selected element 上下文。
- `pnpm alpha:e2e` 新增覆盖预览空间打开、元素选择和 composer context。
- 必须用真实模型跑一次普通对话中生成 LP、打开预览、选中元素、继续修改的流程。
