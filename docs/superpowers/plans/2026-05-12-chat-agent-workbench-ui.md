# Chat Agent Workbench UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current dashboard-like Web workbench with a Manus/ChatGPT-style conversation interface with a fixed sidebar, visible tool-call progress, artifact cards, and an interrupt-ready composer.

**Architecture:** Keep the deterministic demo workflow unchanged. Add a pure `chat-workbench` view-model builder that converts the existing demo snapshot, export links, and localized copy into chat messages, tool events, artifact cards, and composer labels. The Next.js page only renders that model; CSS owns fixed app chrome, independent scrolling, and responsive conversation layout.

**Tech Stack:** Next.js 15, React 19 server components, TypeScript, Vitest, existing workspace packages.

---

## File Structure

- Create `apps/web/src/lib/chat-workbench.ts`
  - Builds deterministic chat UI data from the existing demo snapshot and localized copy.
  - Owns TypeScript interfaces for tool events, artifact cards, and chat thread data.

- Create `apps/web/src/lib/chat-workbench.test.ts`
  - Verifies localized prompt use, tool event order, artifact cards, and reviewer metadata.

- Modify `apps/web/src/lib/i18n.ts`
  - Adds sidebar task copy and chat/composer/tool labels in English and Chinese.
  - Keeps existing fields intact so current tests and exports still work.

- Modify `apps/web/src/lib/i18n.test.ts`
  - Adds a small assertion that chat/composer copy exists for both locales.

- Modify `apps/web/src/app/page.tsx`
  - Replaces the dashboard panels with the fixed-sidebar chat shell.
  - Uses `createChatWorkbenchThread()` instead of constructing all transcript data inline.

- Modify `apps/web/src/app/globals.css`
  - Replaces dashboard styles with fixed app shell, independent main scroll, chat turns, tool rows, file cards, preview thumbnail, suggestions, and composer.

- Modify `docs/superpowers/README.md`
  - Adds this plan under the UI spec so future agents can find the implementation order.

---

## Task 1: Add Chat View Model With Failing Tests

**Files:**
- Create: `apps/web/src/lib/chat-workbench.test.ts`
- Create: `apps/web/src/lib/chat-workbench.ts`
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`

- [ ] **Step 1: Write the failing chat-workbench test**

Create `apps/web/src/lib/chat-workbench.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { createDemoWorkbenchSnapshot } from "./demo-workbench";
import { createArtifactDownloadLinks, createDeploymentHandoffLink } from "./export-links";
import { createChatWorkbenchThread } from "./chat-workbench";
import { getWorkbenchCopy } from "./i18n";

describe("chat workbench view model", () => {
  it("uses localized copy and preserves the demo prompt as the user message", async () => {
    const copy = getWorkbenchCopy("zh-CN");
    const snapshot = await createDemoWorkbenchSnapshot();
    const downloadLinks = createArtifactDownloadLinks(snapshot.pageVersion.artifacts, copy.exports);
    const handoffLink = createDeploymentHandoffLink(snapshot.deployment, copy.exports);

    const thread = createChatWorkbenchThread({ copy, snapshot, downloadLinks, handoffLink });

    expect(thread.userMessage).toBe(copy.demo.prompt);
    expect(thread.assistantName).toBe(copy.chat.assistantName);
    expect(thread.composer.placeholder).toBe(copy.chat.composerPlaceholder);
  });

  it("returns deterministic planner builder reviewer deployer tool order", async () => {
    const copy = getWorkbenchCopy("en");
    const snapshot = await createDemoWorkbenchSnapshot();
    const downloadLinks = createArtifactDownloadLinks(snapshot.pageVersion.artifacts, copy.exports);
    const handoffLink = createDeploymentHandoffLink(snapshot.deployment, copy.exports);

    const thread = createChatWorkbenchThread({ copy, snapshot, downloadLinks, handoffLink });

    expect(thread.toolEvents.map((event) => event.role)).toEqual([
      "planner",
      "builder",
      "reviewer",
      "deployer"
    ]);
    expect(thread.toolEvents.every((event) => event.status === "complete")).toBe(true);
  });

  it("includes handoff single html and three static file artifact cards", async () => {
    const copy = getWorkbenchCopy("en");
    const snapshot = await createDemoWorkbenchSnapshot();
    const downloadLinks = createArtifactDownloadLinks(snapshot.pageVersion.artifacts, copy.exports);
    const handoffLink = createDeploymentHandoffLink(snapshot.deployment, copy.exports);

    const thread = createChatWorkbenchThread({ copy, snapshot, downloadLinks, handoffLink });

    expect(thread.artifacts.map((artifact) => artifact.filename)).toEqual([
      "deployment-handoff.json",
      "index.single.html",
      "index.html",
      "styles.css",
      "script.js"
    ]);
    expect(thread.artifacts[0]?.kind).toBe(copy.chat.artifactKinds.handoff);
    expect(thread.artifacts[1]?.kind).toBe(copy.chat.artifactKinds.single);
    expect(thread.artifacts.slice(2).every((artifact) => artifact.kind === copy.chat.artifactKinds.static)).toBe(true);
  });

  it("exposes reviewer metadata from review status and findings", async () => {
    const copy = getWorkbenchCopy("en");
    const snapshot = await createDemoWorkbenchSnapshot();
    const downloadLinks = createArtifactDownloadLinks(snapshot.pageVersion.artifacts, copy.exports);
    const handoffLink = createDeploymentHandoffLink(snapshot.deployment, copy.exports);

    const thread = createChatWorkbenchThread({ copy, snapshot, downloadLinks, handoffLink });
    const reviewer = thread.toolEvents.find((event) => event.role === "reviewer");

    expect(reviewer?.meta).toContain(copy.status.passed);
    expect(reviewer?.meta).toContain("0");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm test apps/web/src/lib/chat-workbench.test.ts
```

Expected: FAIL because `./chat-workbench` does not exist.

- [ ] **Step 3: Extend i18n copy**

In `apps/web/src/lib/i18n.ts`, extend `WorkbenchCopy.sidebar` with:

```ts
    newTask: string;
    projectsLabel: string;
    tasksLabel: string;
    taskTitles: string[];
```

Add a new `chat` object to `WorkbenchCopy`:

```ts
  chat: {
    topbarModel: string;
    topbarShare: string;
    topbarTrial: string;
    assistantName: string;
    assistantBadge: string;
    userLabel: string;
    intro: string;
    completion: string;
    taskComplete: string;
    toolsTitle: string;
    artifactsTitle: string;
    suggestionsTitle: string;
    resultRating: string;
    allFilesLabel: string;
    previewTitle: string;
    composerPlaceholder: string;
    addAttachmentLabel: string;
    runtimeChip: string;
    interruptLabel: string;
    sendLabel: string;
    toolStatusComplete: string;
    branchLabel: string;
    findingsLabel: string;
    filesLabel: string;
    artifactKinds: {
      handoff: string;
      single: string;
      static: string;
    };
    suggestions: string[];
  };
```

Add English copy:

```ts
    chat: {
      topbarModel: "LP Agent Lite",
      topbarShare: "Share",
      topbarTrial: "Start trial",
      assistantName: "LP Agent",
      assistantBadge: "Lite",
      userLabel: "You",
      intro: "I will turn this request into a framework-free landing page and show the agent steps as they run.",
      completion: "The landing page is ready as static HTML/CSS/JS. You can download the single HTML file or the separated files for repository handoff.",
      taskComplete: "Task complete",
      toolsTitle: "Agent process",
      artifactsTitle: "Generated files",
      suggestionsTitle: "Suggested next prompts",
      resultRating: "How is this result?",
      allFilesLabel: "View all files in this task",
      previewTitle: "Static LP preview",
      composerPlaceholder: "Message LP Agent",
      addAttachmentLabel: "Add context",
      runtimeChip: "Cloud runtime",
      interruptLabel: "Interrupt",
      sendLabel: "Send",
      toolStatusComplete: "Complete",
      branchLabel: "Branch",
      findingsLabel: "Findings",
      filesLabel: "Files",
      artifactKinds: {
        handoff: "PR handoff",
        single: "single HTML",
        static: "static file"
      },
      suggestions: [
        "Add a contact form to this HTML page",
        "Adjust the copy for a premium ecommerce audience",
        "Prepare this LP handoff for GitHub Pages"
      ]
    }
```

Add Chinese copy:

```ts
    chat: {
      topbarModel: "LP Agent Lite",
      topbarShare: "分享",
      topbarTrial: "开始免费试用",
      assistantName: "LP Agent",
      assistantBadge: "Lite",
      userLabel: "你",
      intro: "我会把这个需求转换成框架无关的落地页，并在对话里展示智能体执行过程。",
      completion: "落地页已经生成静态 HTML/CSS/JS。你可以下载单文件 HTML，也可以下载分离文件用于仓库交接。",
      taskComplete: "任务已完成",
      toolsTitle: "智能体过程",
      artifactsTitle: "生成文件",
      suggestionsTitle: "推荐追问",
      resultRating: "这个结果怎么样？",
      allFilesLabel: "查看此任务中的所有文件",
      previewTitle: "静态 LP 预览",
      composerPlaceholder: "发送消息给 LP Agent",
      addAttachmentLabel: "添加上下文",
      runtimeChip: "云端运行时",
      interruptLabel: "打断",
      sendLabel: "发送",
      toolStatusComplete: "完成",
      branchLabel: "分支",
      findingsLabel: "问题",
      filesLabel: "文件",
      artifactKinds: {
        handoff: "PR 交接",
        single: "单文件 HTML",
        static: "静态文件"
      },
      suggestions: [
        "为这个 HTML 页面添加联系表单",
        "把文案调整成高客单价电商风格",
        "准备将这个 LP 交接到 GitHub Pages"
      ]
    }
```

Also add these English sidebar fields:

```ts
      newTask: "New task",
      projectsLabel: "Project",
      tasksLabel: "All tasks",
      taskTitles: [
        "Generate a simple static HTML LP",
        "Create a personal blog landing page"
      ]
```

And these Chinese sidebar fields:

```ts
      newTask: "新建任务",
      projectsLabel: "项目",
      tasksLabel: "所有任务",
      taskTitles: [
        "生成一个简单静态 HTML 落地页",
        "生成个人博客落地页"
      ]
```

- [ ] **Step 4: Implement the chat-workbench builder**

Create `apps/web/src/lib/chat-workbench.ts` with:

```ts
import type { createDemoWorkbenchSnapshot } from "./demo-workbench";
import type { ArtifactDownloadLink } from "./export-links";
import type { WorkbenchCopy } from "./i18n";

type DemoWorkbenchSnapshot = Awaited<ReturnType<typeof createDemoWorkbenchSnapshot>>;

export type ChatToolRole = "planner" | "builder" | "reviewer" | "deployer";
export type ChatToolStatus = "complete";

export interface ChatToolEvent {
  id: string;
  role: ChatToolRole;
  label: string;
  operation: string;
  status: ChatToolStatus;
  statusLabel: string;
  meta: string;
}

export interface ChatArtifactCard extends ArtifactDownloadLink {
  id: string;
  kind: string;
}

export interface ChatComposerCopy {
  placeholder: string;
  addAttachmentLabel: string;
  runtimeChip: string;
  interruptLabel: string;
  sendLabel: string;
}

export interface ChatWorkbenchThread {
  userMessage: string;
  assistantName: string;
  assistantBadge: string;
  assistantIntro: string;
  assistantCompletion: string;
  toolEvents: ChatToolEvent[];
  artifacts: ChatArtifactCard[];
  suggestions: string[];
  composer: ChatComposerCopy;
}

interface CreateChatWorkbenchThreadInput {
  copy: WorkbenchCopy;
  snapshot: DemoWorkbenchSnapshot;
  downloadLinks: ArtifactDownloadLink[];
  handoffLink: ArtifactDownloadLink;
}

export function createChatWorkbenchThread({
  copy,
  snapshot,
  downloadLinks,
  handoffLink
}: CreateChatWorkbenchThreadInput): ChatWorkbenchThread {
  const reviewStatus = copy.status[snapshot.pageVersion.reviewStatus];
  const findingsCount = snapshot.pageVersion.findings.length;
  const toolEvents: ChatToolEvent[] = [
    {
      id: "planner",
      role: "planner",
      label: copy.run.planner[0],
      operation: copy.run.planner[1],
      status: "complete",
      statusLabel: copy.chat.toolStatusComplete,
      meta: `${copy.fields.objective}: ${copy.demo.objective}`
    },
    {
      id: "builder",
      role: "builder",
      label: copy.run.builder[0],
      operation: copy.run.builder[1],
      status: "complete",
      statusLabel: copy.chat.toolStatusComplete,
      meta: `${copy.chat.filesLabel}: ${downloadLinks.length}`
    },
    {
      id: "reviewer",
      role: "reviewer",
      label: copy.run.reviewer[0],
      operation: copy.run.reviewer[1],
      status: "complete",
      statusLabel: copy.chat.toolStatusComplete,
      meta: `${copy.status.review}: ${reviewStatus} · ${copy.chat.findingsLabel}: ${findingsCount}`
    },
    {
      id: "deployer",
      role: "deployer",
      label: copy.run.deployer[0],
      operation: `${snapshot.deployment.branch} ${copy.run.deployer[1]}`,
      status: "complete",
      statusLabel: copy.chat.toolStatusComplete,
      meta: `${copy.chat.branchLabel}: ${snapshot.deployment.branch}`
    }
  ];

  const artifacts: ChatArtifactCard[] = [
    {
      ...handoffLink,
      id: "handoff",
      kind: copy.chat.artifactKinds.handoff
    },
    ...downloadLinks.map((link, index) => ({
      ...link,
      id: link.filename,
      kind: index === 0 ? copy.chat.artifactKinds.single : copy.chat.artifactKinds.static
    }))
  ];

  return {
    userMessage: copy.demo.prompt,
    assistantName: copy.chat.assistantName,
    assistantBadge: copy.chat.assistantBadge,
    assistantIntro: copy.chat.intro,
    assistantCompletion: copy.chat.completion,
    toolEvents,
    artifacts,
    suggestions: copy.chat.suggestions,
    composer: {
      placeholder: copy.chat.composerPlaceholder,
      addAttachmentLabel: copy.chat.addAttachmentLabel,
      runtimeChip: copy.chat.runtimeChip,
      interruptLabel: copy.chat.interruptLabel,
      sendLabel: copy.chat.sendLabel
    }
  };
}
```

- [ ] **Step 5: Add i18n test coverage for chat copy**

Modify the last test in `apps/web/src/lib/i18n.test.ts` to include:

```ts
    expect(getWorkbenchCopy("zh-CN").chat.composerPlaceholder).toBe("发送消息给 LP Agent");
    expect(getWorkbenchCopy("en").chat.composerPlaceholder).toBe("Message LP Agent");
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm test apps/web/src/lib/chat-workbench.test.ts apps/web/src/lib/i18n.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add apps/web/src/lib/chat-workbench.ts apps/web/src/lib/chat-workbench.test.ts apps/web/src/lib/i18n.ts apps/web/src/lib/i18n.test.ts
git commit -m "feat: add chat workbench view model"
```

---

## Task 2: Render the Conversation-First Page

**Files:**
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Replace dashboard rendering with chat shell rendering**

Modify `apps/web/src/app/page.tsx` so it imports `createChatWorkbenchThread`:

```ts
import { createChatWorkbenchThread } from "../lib/chat-workbench";
```

Inside `HomePage`, after creating `downloadLinks` and `handoffLink`, add:

```ts
  const chat = createChatWorkbenchThread({ copy, snapshot, downloadLinks, handoffLink });
```

Replace the returned JSX with a full app shell containing:

```tsx
    <main className="appShell">
      <aside className="sidebar" aria-label={copy.nav.label}>
        <div className="sidebarTop">
          <div className="brandBlock">
            <div className="brandMark">LP</div>
            <div>
              <div className="brand">{copy.sidebar.team}</div>
              <p>{copy.sidebar.mode}</p>
            </div>
          </div>
          <button className="sidebarAction" type="button">{copy.sidebar.newTask}</button>
        </div>

        <nav className="navList" aria-label={copy.nav.label}>
          <div className="navItem navItemActive">{copy.nav.workbench}</div>
          <div className="navItem">{copy.nav.skills}</div>
          <div className="navItem">{copy.nav.mcp}</div>
          <div className="navItem">{copy.nav.models}</div>
          <div className="navItem">{copy.nav.deployments}</div>
        </nav>

        <div className="sidebarSection">
          <div className="sidebarSectionTitle">{copy.sidebar.projectsLabel}</div>
          <div className="projectItem">
            <span>{project.repository}</span>
            <strong>{copy.demo.projectName}</strong>
          </div>
        </div>

        <div className="sidebarSection sidebarTasks">
          <div className="sidebarSectionTitle">{copy.sidebar.tasksLabel}</div>
          {copy.sidebar.taskTitles.map((taskTitle, index) => (
            <button
              className={index === 0 ? "taskItem taskItemActive" : "taskItem"}
              type="button"
              key={taskTitle}
            >
              {taskTitle}
            </button>
          ))}
        </div>

        <div className="sidebarMeta">
          <span>{copy.sidebar.modeLabel}</span>
          <strong>{copy.sidebar.mode}</strong>
          <span>{copy.sidebar.localeLabel}</span>
          <strong>{copy.localeName}</strong>
        </div>
      </aside>

      <section className="chatWorkspace" aria-label={copy.nav.workbench}>
        <header className="topBar">
          <div>
            <strong>{copy.chat.topbarModel}</strong>
            <span>{copy.demo.projectName}</span>
          </div>
          <div className="topBarActions">
            <button type="button">{copy.chat.topbarShare}</button>
            <button type="button" className="trialButton">{copy.chat.topbarTrial}</button>
          </div>
        </header>

        <div className="conversationViewport">
          <div className="conversationStack">
            <div className="userTurn" aria-label={copy.chat.userLabel}>
              <div className="messageBubble userMessage">{chat.userMessage}</div>
            </div>

            <article className="assistantTurn">
              <div className="assistantIdentity">
                <div className="assistantAvatar">LP</div>
                <strong>{chat.assistantName}</strong>
                <span>{chat.assistantBadge}</span>
              </div>

              <div className="assistantMessage">
                <p>{chat.assistantIntro}</p>

                <section className="processBlock" aria-label={copy.chat.toolsTitle}>
                  <div className="processHeader">
                    <strong>{copy.chat.toolsTitle}</strong>
                    <span>{chat.toolEvents.length}/4</span>
                  </div>
                  <div className="toolTimeline">
                    {chat.toolEvents.map((event) => (
                      <div className="toolEvent" key={event.id}>
                        <div className="toolStatusDot" aria-hidden="true" />
                        <div>
                          <div className="toolEventTop">
                            <strong>{event.label}</strong>
                            <span>{event.statusLabel}</span>
                          </div>
                          <p>{event.operation}</p>
                          <small>{event.meta}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <p>{chat.assistantCompletion}</p>

                <section className="deliveryBlock" aria-label={copy.chat.artifactsTitle}>
                  <div className="deliveryHeader">
                    <strong>{copy.chat.taskComplete}</strong>
                    <span>{copy.chat.resultRating}</span>
                  </div>
                  <div className="artifactGrid">
                    {chat.artifacts.map((artifact) => (
                      <a className="artifactCard" download={artifact.filename} href={artifact.href} key={artifact.id}>
                        <span>{artifact.kind}</span>
                        <strong>{artifact.filename}</strong>
                        <small>{artifact.bytes.toLocaleString(copy.locale)} bytes</small>
                      </a>
                    ))}
                  </div>
                  <a className="allFilesCard" download={handoffLink.filename} href={handoffLink.href}>
                    {copy.chat.allFilesLabel}
                  </a>
                </section>

                <section className="inlinePreview" aria-label={copy.chat.previewTitle}>
                  <div className="previewTitle">{copy.chat.previewTitle}</div>
                  <LPPreview artifacts={pageVersion.artifacts} />
                </section>
              </div>
            </article>

            <section className="suggestionBlock" aria-label={copy.chat.suggestionsTitle}>
              <div>{copy.chat.suggestionsTitle}</div>
              {chat.suggestions.map((suggestion) => (
                <button type="button" key={suggestion}>{suggestion}</button>
              ))}
            </section>
          </div>
        </div>

        <form className="composerDock">
          <div className="composer">
            <button type="button" aria-label={chat.composer.addAttachmentLabel}>+</button>
            <input aria-label={chat.composer.placeholder} placeholder={chat.composer.placeholder} />
            <span>{chat.composer.runtimeChip}</span>
            <button type="button" className="interruptButton">{chat.composer.interruptLabel}</button>
            <button type="button" className="sendButton">{chat.composer.sendLabel}</button>
          </div>
        </form>
      </section>
    </main>
```

- [ ] **Step 2: Remove unused page variables**

After the JSX replacement, remove unused variables such as `singleFileLink`, `threeFileLinks`, `reviewStatus`, and `runItems` from `apps/web/src/app/page.tsx`.

- [ ] **Step 3: Type-check the page**

Run:

```bash
pnpm --filter @lp-agent/web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit Task 2**

Run:

```bash
git add apps/web/src/app/page.tsx
git commit -m "feat: render chat workbench shell"
```

---

## Task 3: Replace Dashboard CSS With Fixed Chat Layout

**Files:**
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Replace app shell and dashboard styles**

Replace dashboard-specific rules in `apps/web/src/app/globals.css` with styles for:

```css
html,
body {
  min-width: 320px;
  height: 100%;
  overflow: hidden;
}

.appShell {
  height: 100vh;
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  overflow: hidden;
}

.sidebar {
  height: 100vh;
  min-height: 0;
  overflow-y: auto;
}

.chatWorkspace {
  min-width: 0;
  height: 100vh;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.conversationViewport {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.composerDock {
  flex: 0 0 auto;
}
```

Also add rules for `.topBar`, `.conversationStack`, `.userTurn`, `.messageBubble`, `.assistantTurn`, `.assistantIdentity`, `.processBlock`, `.toolTimeline`, `.toolEvent`, `.deliveryBlock`, `.artifactGrid`, `.artifactCard`, `.inlinePreview`, `.suggestionBlock`, and `.composer`.

- [ ] **Step 2: Add responsive behavior**

Add a mobile media query:

```css
@media (max-width: 860px) {
  html,
  body {
    height: auto;
    overflow: auto;
  }

  .appShell {
    height: auto;
    min-height: 100vh;
    grid-template-columns: 1fr;
    overflow: visible;
  }

  .sidebar {
    height: auto;
    max-height: none;
    overflow: visible;
  }

  .chatWorkspace {
    height: auto;
    min-height: 78vh;
  }

  .conversationViewport {
    overflow: visible;
  }
}
```

- [ ] **Step 3: Run build to catch CSS/page integration issues**

Run:

```bash
pnpm --filter @lp-agent/web build
```

Expected: PASS.

- [ ] **Step 4: Commit Task 3**

Run:

```bash
git add apps/web/src/app/globals.css
git commit -m "style: redesign workbench as chat layout"
```

---

## Task 4: Verify and Document the UI Slice

**Files:**
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Confirm README includes this plan**

Ensure `docs/superpowers/README.md` lists:

```md
5. `plans/2026-05-12-chat-agent-workbench-ui.md`
   - Stage 2 Web UI implementation plan.
   - Read this after the chat UI spec when implementing or auditing the conversation-first Web workbench.
```

The previous persistent repositories plan should move to the next number.

- [ ] **Step 2: Run full tests**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Run full typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Run full build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 5: Start local dev server for visual inspection**

Run:

```bash
pnpm dev
```

Expected: Next.js dev server starts. Inspect the local URL and verify:

- Desktop sidebar remains fixed while the conversation body scrolls independently.
- Main content reads as a chat transcript, not a dashboard.
- Tool calls are visible inside the assistant turn.
- Artifact cards include handoff, single HTML, `index.html`, `styles.css`, and `script.js`.
- Composer includes add context, runtime chip, interrupt, and send controls.
- Narrow viewport remains usable and does not overlap text or controls.

- [ ] **Step 6: Commit README if it changed during implementation**

Run:

```bash
git add docs/superpowers/README.md
git commit -m "docs: index chat workbench ui plan"
```

Only commit if `docs/superpowers/README.md` has changes after the plan commit.

---

## Self-Review

- Spec coverage: fixed sidebar, chat transcript, tool-call display, artifact cards, interrupt affordance, bilingual copy, and static LP artifact language are covered by Tasks 1-4.
- Placeholder scan: no task uses TBD/TODO language or asks the implementer to invent missing behavior.
- Type consistency: `createChatWorkbenchThread`, `ChatToolEvent`, `ChatArtifactCard`, and `WorkbenchCopy.chat` are defined before use in page rendering.
