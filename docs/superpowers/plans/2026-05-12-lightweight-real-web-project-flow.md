# Lightweight Real Web Project Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed Web demo snapshot with a lightweight local project flow where users can create a project, submit an LP prompt, refresh the page, and keep the current project state for the running dev server process.

**Architecture:** Add a Web-only process-local store around `DemoWorkbenchService`, plus cookie-backed current project selection and server actions for form submissions. The existing chat page becomes state-driven: project creation state, empty project state, and completed run state. No Postgres, Prisma, auth, realtime jobs, or desktop persistence are introduced in this slice.

**Tech Stack:** Next.js 15 server components and server actions, React 19, TypeScript, Vitest, existing `@lp-agent/api`, `@lp-agent/db`, `@lp-agent/git-deployment`, and Web i18n/export helpers.

---

## File Structure

- Create `apps/web/src/lib/workbench-store.ts`
  - Owns the singleton process-local `DemoWorkbenchService`.
  - Creates projects, lists projects, loads current page state, and submits prompts.
  - Maps validation and generation failures to typed error codes.

- Create `apps/web/src/lib/workbench-store.test.ts`
  - Tests project creation/listing, prompt submission, snapshot restoration, stale project handling, and validation codes.

- Create `apps/web/src/lib/workbench-session.ts`
  - Owns the current project cookie name and Next cookie read/write helpers.

- Create `apps/web/src/app/actions.ts`
  - Adds `createProjectAction`, `submitPromptAction`, and optional `selectProjectAction`.
  - Calls the Web store, updates the current project cookie, and redirects with typed error query params when needed.

- Modify `apps/web/src/lib/chat-workbench.ts`
  - Removes the dependency on the fixed demo snapshot type.
  - Accepts prompt, page version, and deployment data from real page state.

- Modify `apps/web/src/lib/chat-workbench.test.ts`
  - Updates existing tests to use the new input shape.
  - Adds coverage that the user message comes from the submitted prompt.

- Modify `apps/web/src/lib/i18n.ts`
  - Adds `projectFlow` copy for project creation, empty state, local persistence note, and error labels.

- Modify `apps/web/src/lib/i18n.test.ts`
  - Verifies new project-flow copy exists in English and Chinese.

- Modify `apps/web/src/app/page.tsx`
  - Reads locale, current project cookie, and query error code.
  - Renders project creation, empty project, or completed conversation state.
  - Uses server-action forms.

- Modify `apps/web/src/app/globals.css`
  - Adds styles for project creation panel, empty state, form controls, and error messages inside the existing chat layout.

- Modify `docs/superpowers/README.md`
  - Adds this plan under the lightweight real Web project flow spec.

---

## Task 1: Web Store and Validation

**Files:**
- Create: `apps/web/src/lib/workbench-store.test.ts`
- Create: `apps/web/src/lib/workbench-store.ts`

- [ ] **Step 1: Write failing store tests**

Create `apps/web/src/lib/workbench-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createWebWorkbenchStore,
  validateProjectInput,
  validatePromptInput
} from "./workbench-store";

describe("web workbench store", () => {
  it("creates projects and exposes them in creation order", async () => {
    const store = createWebWorkbenchStore();

    const first = await store.createProject({
      name: "Spring LP",
      repository: "git@example.com:shop/spring.git"
    });
    const second = await store.createProject({
      name: "Summer LP",
      repository: "git@example.com:shop/summer.git"
    });

    expect(first).toMatchObject({
      id: "project_1",
      name: "Spring LP",
      repository: "git@example.com:shop/spring.git"
    });
    expect(store.listProjects().map((project) => project.id)).toEqual([
      "project_1",
      "project_2"
    ]);
    expect(second.id).toBe("project_2");
  });

  it("returns no-project page state when no current project id is present", async () => {
    const store = createWebWorkbenchStore();

    await expect(store.getPageState(undefined)).resolves.toEqual({
      kind: "no_project",
      projects: []
    });
  });

  it("returns no-project page state for a stale project id", async () => {
    const store = createWebWorkbenchStore();
    await store.createProject({
      name: "Spring LP",
      repository: "git@example.com:shop/spring.git"
    });

    await expect(store.getPageState("project_missing")).resolves.toEqual({
      kind: "no_project",
      projects: [
        expect.objectContaining({
          id: "project_1",
          name: "Spring LP"
        })
      ]
    });
  });

  it("submits a prompt and restores a completed snapshot", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({
      name: "Spring LP",
      repository: "git@example.com:shop/spring.git"
    });

    const result = await store.submitPrompt({
      projectId: project.id,
      prompt: "Create a spring ecommerce landing page."
    });
    const pageState = await store.getPageState(project.id);

    expect(result).toEqual({ ok: true });
    expect(pageState.kind).toBe("project_ready");
    if (pageState.kind !== "project_ready") {
      throw new Error("Expected project-ready state.");
    }
    expect(pageState.snapshot.project.id).toBe(project.id);
    expect(pageState.snapshot.brief?.prompt).toBe("Create a spring ecommerce landing page.");
    expect(pageState.snapshot.currentPageVersion?.reviewStatus).toBe("passed");
    expect(pageState.snapshot.deployment?.status).toBe("pr_opened");
  });

  it("validates project and prompt form values", () => {
    expect(validateProjectInput({ name: " ", repository: "repo" })).toEqual({
      ok: false,
      error: "project_name_required"
    });
    expect(validateProjectInput({ name: "LP", repository: " " })).toEqual({
      ok: false,
      error: "repository_required"
    });
    expect(validatePromptInput(" ")).toEqual({
      ok: false,
      error: "prompt_required"
    });
    expect(validateProjectInput({ name: " LP ", repository: " repo " })).toEqual({
      ok: true,
      value: {
        name: "LP",
        repository: "repo"
      }
    });
    expect(validatePromptInput(" Build a page ")).toEqual({
      ok: true,
      value: "Build a page"
    });
  });
});
```

- [ ] **Step 2: Run the failing store tests**

Run:

```bash
pnpm test apps/web/src/lib/workbench-store.test.ts
```

Expected: FAIL because `./workbench-store` does not exist.

- [ ] **Step 3: Implement the Web workbench store**

Create `apps/web/src/lib/workbench-store.ts`:

```ts
import {
  createDemoWorkbenchService,
  type ProjectRecord,
  type WorkbenchSnapshot
} from "@lp-agent/api";

export type ProjectFlowErrorCode =
  | "project_name_required"
  | "repository_required"
  | "prompt_required"
  | "project_not_found"
  | "generation_failed";

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProjectFlowErrorCode };

export interface CreateProjectFormInput {
  name: string;
  repository: string;
}

export type SubmitPromptResult =
  | { ok: true }
  | { ok: false; error: ProjectFlowErrorCode };

export type WorkbenchPageState =
  | {
      kind: "no_project";
      projects: ProjectRecord[];
    }
  | {
      kind: "project_ready";
      projects: ProjectRecord[];
      activeProjectId: string;
      snapshot: WorkbenchSnapshot;
    };

export interface WebWorkbenchStore {
  createProject(input: CreateProjectFormInput): Promise<ProjectRecord>;
  listProjects(): ProjectRecord[];
  getPageState(projectId?: string | null): Promise<WorkbenchPageState>;
  submitPrompt(input: { projectId: string; prompt: string }): Promise<SubmitPromptResult>;
}

export function validateProjectInput(input: CreateProjectFormInput): ValidationResult<CreateProjectFormInput> {
  const name = input.name.trim();
  const repository = input.repository.trim();

  if (name.length === 0) {
    return { ok: false, error: "project_name_required" };
  }
  if (repository.length === 0) {
    return { ok: false, error: "repository_required" };
  }

  return {
    ok: true,
    value: {
      name,
      repository
    }
  };
}

export function validatePromptInput(prompt: string): ValidationResult<string> {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "prompt_required" };
  }
  return { ok: true, value: trimmed };
}

export function createWebWorkbenchStore(): WebWorkbenchStore {
  const service = createDemoWorkbenchService();
  const projects = new Map<string, ProjectRecord>();
  const projectOrder: string[] = [];

  const listProjects = () =>
    projectOrder
      .map((projectId) => projects.get(projectId))
      .filter((project): project is ProjectRecord => Boolean(project))
      .map((project) => ({ ...project }));

  return {
    async createProject(input) {
      const validation = validateProjectInput(input);
      if (!validation.ok) {
        throw new Error(validation.error);
      }

      const project = await service.createProject(validation.value);
      projects.set(project.id, project);
      projectOrder.push(project.id);
      return { ...project };
    },

    listProjects,

    async getPageState(projectId) {
      const currentProjects = listProjects();
      if (!projectId || !projects.has(projectId)) {
        return {
          kind: "no_project",
          projects: currentProjects
        };
      }

      const snapshot = await service.getSnapshot(projectId);
      return {
        kind: "project_ready",
        projects: currentProjects,
        activeProjectId: projectId,
        snapshot
      };
    },

    async submitPrompt(input) {
      const prompt = validatePromptInput(input.prompt);
      if (!prompt.ok) {
        return { ok: false, error: prompt.error };
      }

      if (!projects.has(input.projectId)) {
        return { ok: false, error: "project_not_found" };
      }

      try {
        const brief = await service.createBriefFromPrompt({
          projectId: input.projectId,
          prompt: prompt.value
        });
        const pageVersion = await service.generatePageVersion({
          projectId: input.projectId,
          briefId: brief.id
        });
        const reviewed = await service.reviewPageVersion({
          projectId: input.projectId,
          pageVersionId: pageVersion.id
        });
        await service.approveAndCreateDeployment({
          projectId: input.projectId,
          pageVersionId: reviewed.id,
          reviewerUserId: "local_web_user"
        });
        return { ok: true };
      } catch {
        return { ok: false, error: "generation_failed" };
      }
    }
  };
}

const globalStore = globalThis as typeof globalThis & {
  __lpAgentWebWorkbenchStore?: WebWorkbenchStore;
};

export function getWebWorkbenchStore(): WebWorkbenchStore {
  globalStore.__lpAgentWebWorkbenchStore ??= createWebWorkbenchStore();
  return globalStore.__lpAgentWebWorkbenchStore;
}
```

- [ ] **Step 4: Run the store tests**

Run:

```bash
pnpm test apps/web/src/lib/workbench-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts
git commit -m "feat: add web workbench store"
```

---

## Task 2: Session Helpers, Actions, and Localized Copy

**Files:**
- Create: `apps/web/src/lib/workbench-session.ts`
- Create: `apps/web/src/app/actions.ts`
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`

- [ ] **Step 1: Add failing i18n assertions**

Modify `apps/web/src/lib/i18n.test.ts` in the existing localized labels test:

```ts
    expect(getWorkbenchCopy("zh-CN").projectFlow.createProject).toBe("创建项目");
    expect(getWorkbenchCopy("zh-CN").projectFlow.errors.prompt_required).toBe("请输入 LP 需求。");
    expect(getWorkbenchCopy("en").projectFlow.createProject).toBe("Create project");
    expect(getWorkbenchCopy("en").projectFlow.errors.prompt_required).toBe("Enter an LP request.");
```

- [ ] **Step 2: Run the failing i18n test**

Run:

```bash
pnpm test apps/web/src/lib/i18n.test.ts
```

Expected: FAIL because `projectFlow` does not exist.

- [ ] **Step 3: Extend i18n with project-flow copy**

Add this interface field to `WorkbenchCopy` in `apps/web/src/lib/i18n.ts`:

```ts
  projectFlow: {
    createTitle: string;
    createDescription: string;
    projectNameLabel: string;
    projectNamePlaceholder: string;
    repositoryLabel: string;
    repositoryPlaceholder: string;
    createProject: string;
    localPersistenceNote: string;
    emptyTitle: string;
    emptyDescription: string;
    promptLabel: string;
    errors: Record<import("./workbench-store").ProjectFlowErrorCode, string>;
  };
```

Add English copy:

```ts
    projectFlow: {
      createTitle: "Create a project",
      createDescription: "Start with a project and repository target, then ask the LP agent to generate static files.",
      projectNameLabel: "Project name",
      projectNamePlaceholder: "Spring Campaign",
      repositoryLabel: "Repository URL",
      repositoryPlaceholder: "git@example.com:shop/spring-lp.git",
      createProject: "Create project",
      localPersistenceNote: "Local MVP state is kept only while this dev server is running.",
      emptyTitle: "Project ready",
      emptyDescription: "Send an LP request to generate a brief, static artifacts, review, and handoff.",
      promptLabel: "LP request",
      errors: {
        project_name_required: "Enter a project name.",
        repository_required: "Enter a repository URL.",
        prompt_required: "Enter an LP request.",
        project_not_found: "The selected project is no longer available.",
        generation_failed: "The LP generation flow failed. Try again with a shorter request."
      }
    },
```

Add Chinese copy:

```ts
    projectFlow: {
      createTitle: "创建项目",
      createDescription: "先创建项目和仓库目标，然后让 LP Agent 生成静态文件。",
      projectNameLabel: "项目名称",
      projectNamePlaceholder: "春季活动",
      repositoryLabel: "仓库地址",
      repositoryPlaceholder: "git@example.com:shop/spring-lp.git",
      createProject: "创建项目",
      localPersistenceNote: "本地 MVP 状态只会保存在当前 dev server 运行期间。",
      emptyTitle: "项目已就绪",
      emptyDescription: "发送 LP 需求后会生成 brief、静态文件、审核结果和交接文件。",
      promptLabel: "LP 需求",
      errors: {
        project_name_required: "请输入项目名称。",
        repository_required: "请输入仓库地址。",
        prompt_required: "请输入 LP 需求。",
        project_not_found: "当前项目已经不可用。",
        generation_failed: "LP 生成流程失败，请换一个更短的需求重试。"
      }
    },
```

- [ ] **Step 4: Add session helper**

Create `apps/web/src/lib/workbench-session.ts`:

```ts
import { cookies } from "next/headers";

export const CURRENT_PROJECT_COOKIE = "lp-agent-current-project";

export async function getCurrentProjectId(): Promise<string | undefined> {
  const cookieStore = await cookies();
  const value = cookieStore.get(CURRENT_PROJECT_COOKIE)?.value.trim();
  return value && value.length > 0 ? value : undefined;
}

export async function setCurrentProjectId(projectId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(CURRENT_PROJECT_COOKIE, projectId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/"
  });
}
```

- [ ] **Step 5: Add server actions**

Create `apps/web/src/app/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getWebWorkbenchStore, type ProjectFlowErrorCode } from "../lib/workbench-store";
import { setCurrentProjectId } from "../lib/workbench-session";

function redirectWithError(error: ProjectFlowErrorCode): never {
  redirect(`/?error=${encodeURIComponent(error)}`);
}

export async function createProjectAction(formData: FormData): Promise<void> {
  const store = getWebWorkbenchStore();
  const name = String(formData.get("projectName") ?? "");
  const repository = String(formData.get("repository") ?? "");

  try {
    const project = await store.createProject({ name, repository });
    await setCurrentProjectId(project.id);
    revalidatePath("/");
  } catch (error) {
    const message = error instanceof Error ? error.message : "generation_failed";
    if (
      message === "project_name_required" ||
      message === "repository_required"
    ) {
      redirectWithError(message);
    }
    redirectWithError("generation_failed");
  }

  redirect("/");
}

export async function submitPromptAction(formData: FormData): Promise<void> {
  const store = getWebWorkbenchStore();
  const projectId = String(formData.get("projectId") ?? "");
  const prompt = String(formData.get("prompt") ?? "");

  const result = await store.submitPrompt({ projectId, prompt });
  if (!result.ok) {
    redirectWithError(result.error);
  }

  revalidatePath("/");
  redirect("/");
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm test apps/web/src/lib/i18n.test.ts apps/web/src/lib/workbench-store.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add apps/web/src/lib/workbench-session.ts apps/web/src/app/actions.ts apps/web/src/lib/i18n.ts apps/web/src/lib/i18n.test.ts
git commit -m "feat: add web project actions"
```

---

## Task 3: Refactor Chat View Model for Real Snapshots

**Files:**
- Modify: `apps/web/src/lib/chat-workbench.ts`
- Modify: `apps/web/src/lib/chat-workbench.test.ts`

- [ ] **Step 1: Write failing chat-workbench tests for real prompt input**

Modify `apps/web/src/lib/chat-workbench.test.ts` so each call passes:

```ts
    const thread = createChatWorkbenchThread({
      copy,
      prompt: snapshot.brief.prompt,
      objective: copy.demo.objective,
      pageVersion: snapshot.pageVersion,
      deployment: snapshot.deployment,
      downloadLinks,
      handoffLink
    });
```

Add this assertion to the first test:

```ts
    expect(thread.userMessage).toBe(snapshot.brief.prompt);
```

- [ ] **Step 2: Run the failing chat-workbench tests**

Run:

```bash
pnpm test apps/web/src/lib/chat-workbench.test.ts
```

Expected: FAIL because `createChatWorkbenchThread` still expects `snapshot`.

- [ ] **Step 3: Update chat-workbench input type**

Modify `apps/web/src/lib/chat-workbench.ts`:

```ts
import type { DeploymentHandoff } from "@lp-agent/git-deployment";
import type { PageVersionRecord } from "@lp-agent/api";
import type { ArtifactDownloadLink } from "./export-links";
import type { WorkbenchCopy } from "./i18n";
```

Replace `CreateChatWorkbenchThreadInput` with:

```ts
interface CreateChatWorkbenchThreadInput {
  copy: WorkbenchCopy;
  prompt: string;
  objective: string;
  pageVersion: PageVersionRecord;
  deployment: DeploymentHandoff;
  downloadLinks: ArtifactDownloadLink[];
  handoffLink: ArtifactDownloadLink;
}
```

Inside `createChatWorkbenchThread`, replace snapshot references:

```ts
  const reviewStatus = copy.status[pageVersion.reviewStatus];
  const findingsCount = pageVersion.findings.length;
```

Use:

```ts
      meta: `${copy.fields.objective}: ${objective}`
```

And:

```ts
      operation: `${deployment.branch} ${copy.run.deployer[1]}`,
      meta: `${copy.chat.branchLabel}: ${deployment.branch}`
```

Return:

```ts
    userMessage: prompt,
```

- [ ] **Step 4: Run chat-workbench tests**

Run:

```bash
pnpm test apps/web/src/lib/chat-workbench.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add apps/web/src/lib/chat-workbench.ts apps/web/src/lib/chat-workbench.test.ts
git commit -m "refactor: accept real workbench snapshots in chat view"
```

---

## Task 4: Render Real Project Flow in the Page

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Replace fixed demo snapshot loading**

Modify imports in `apps/web/src/app/page.tsx`:

```ts
import { createProjectAction, submitPromptAction } from "./actions";
import { getWebWorkbenchStore, type ProjectFlowErrorCode } from "../lib/workbench-store";
import { getCurrentProjectId } from "../lib/workbench-session";
```

Remove:

```ts
import { createDemoWorkbenchSnapshot } from "../lib/demo-workbench";
```

- [ ] **Step 2: Add search params and state loading**

Change the page signature:

```ts
interface HomePageProps {
  searchParams?: Promise<{
    error?: string;
  }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
```

Inside the component:

```ts
  const params = await searchParams;
  const errorCode = toProjectFlowError(params?.error);
  const currentProjectId = await getCurrentProjectId();
  const pageState = await getWebWorkbenchStore().getPageState(currentProjectId);
  const activeProject = pageState.kind === "project_ready" ? pageState.snapshot.project : undefined;
  const errorMessage = errorCode ? copy.projectFlow.errors[errorCode] : undefined;
```

Add helper at the bottom:

```ts
function toProjectFlowError(value: string | undefined): ProjectFlowErrorCode | undefined {
  if (
    value === "project_name_required" ||
    value === "repository_required" ||
    value === "prompt_required" ||
    value === "project_not_found" ||
    value === "generation_failed"
  ) {
    return value;
  }
  return undefined;
}
```

- [ ] **Step 3: Render project creation and empty states**

When `pageState.kind === "no_project"`, render a `.setupPanel` inside `.conversationStack`:

```tsx
<section className="setupPanel">
  <div>
    <h1>{copy.projectFlow.createTitle}</h1>
    <p>{copy.projectFlow.createDescription}</p>
  </div>
  {errorMessage ? <p className="formError">{errorMessage}</p> : null}
  <form action={createProjectAction} className="projectForm">
    <label>
      <span>{copy.projectFlow.projectNameLabel}</span>
      <input name="projectName" placeholder={copy.projectFlow.projectNamePlaceholder} />
    </label>
    <label>
      <span>{copy.projectFlow.repositoryLabel}</span>
      <input name="repository" placeholder={copy.projectFlow.repositoryPlaceholder} />
    </label>
    <button type="submit">{copy.projectFlow.createProject}</button>
  </form>
  <p className="localNote">{copy.projectFlow.localPersistenceNote}</p>
</section>
```

When `pageState.kind === "project_ready"` but there is no completed page version and deployment, render:

```tsx
<section className="emptyProjectState">
  <h1>{copy.projectFlow.emptyTitle}</h1>
  <p>{copy.projectFlow.emptyDescription}</p>
  {errorMessage ? <p className="formError">{errorMessage}</p> : null}
</section>
```

- [ ] **Step 4: Render completed state from real snapshot**

Only build artifact links and chat thread when:

```ts
const completedSnapshot = pageState.kind === "project_ready" &&
  pageState.snapshot.brief &&
  pageState.snapshot.currentPageVersion &&
  pageState.snapshot.deployment
  ? {
      brief: pageState.snapshot.brief,
      pageVersion: pageState.snapshot.currentPageVersion,
      deployment: pageState.snapshot.deployment
    }
  : undefined;
```

Use:

```ts
const downloadLinks = completedSnapshot
  ? createArtifactDownloadLinks(completedSnapshot.pageVersion.artifacts, copy.exports)
  : [];
const handoffLink = completedSnapshot
  ? createDeploymentHandoffLink(completedSnapshot.deployment, copy.exports)
  : undefined;
const chat = completedSnapshot && handoffLink
  ? createChatWorkbenchThread({
      copy,
      prompt: completedSnapshot.brief.prompt,
      objective: copy.demo.objective,
      pageVersion: completedSnapshot.pageVersion,
      deployment: completedSnapshot.deployment,
      downloadLinks,
      handoffLink
    })
  : undefined;
```

Render the existing assistant conversation only when `chat`, `handoffLink`, and `completedSnapshot` exist.

- [ ] **Step 5: Wire the composer form**

Replace the existing composer `<form>` with:

```tsx
<form action={submitPromptAction} className="composerDock">
  <div className="composer">
    <button type="button" aria-label={copy.chat.addAttachmentLabel}>+</button>
    <input type="hidden" name="projectId" value={activeProject?.id ?? ""} />
    <input
      aria-label={copy.projectFlow.promptLabel}
      disabled={!activeProject}
      name="prompt"
      placeholder={activeProject ? chat?.composer.placeholder ?? copy.chat.composerPlaceholder : copy.projectFlow.createTitle}
    />
    <span>{copy.chat.runtimeChip}</span>
    <button type="button" className="interruptButton">{copy.chat.interruptLabel}</button>
    <button type="submit" className="sendButton" disabled={!activeProject}>{copy.chat.sendLabel}</button>
  </div>
</form>
```

- [ ] **Step 6: Add form and empty-state CSS**

Add these rules to `apps/web/src/app/globals.css`:

```css
.setupPanel,
.emptyProjectState {
  display: grid;
  gap: 16px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  padding: 18px;
}

.setupPanel h1,
.emptyProjectState h1 {
  margin: 0;
  font-size: 1.1rem;
  line-height: 1.35;
}

.setupPanel p,
.emptyProjectState p {
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
  line-height: 1.55;
}

.projectForm {
  display: grid;
  gap: 12px;
}

.projectForm label {
  display: grid;
  gap: 6px;
}

.projectForm span {
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 800;
}

.projectForm input {
  min-height: 40px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-raised);
  color: var(--text);
  padding: 0 11px;
}

.projectForm button {
  min-height: 40px;
  border: 1px solid var(--accent);
  border-radius: 8px;
  background: var(--accent);
  color: #ffffff;
  font-weight: 800;
}

.formError {
  border: 1px solid #f2c8c1;
  border-radius: 8px;
  background: var(--danger-soft);
  color: var(--danger) !important;
  padding: 10px 12px;
}

.localNote {
  border-top: 1px solid var(--line);
  padding-top: 12px;
}

.composer input:disabled,
.composer button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
```

- [ ] **Step 7: Run Web typecheck**

Run:

```bash
pnpm --filter @lp-agent/web typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

Run:

```bash
git add apps/web/src/app/page.tsx apps/web/src/app/globals.css
git commit -m "feat: render real web project flow"
```

---

## Task 5: Final Verification

**Files:**
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Confirm README includes this plan**

Ensure `docs/superpowers/README.md` lists:

```md
8. `plans/2026-05-12-lightweight-real-web-project-flow.md`
   - Stage 2 Milestone 2 lightweight Web flow implementation plan.
   - Read this after the lightweight Web flow spec when implementing or auditing project creation, prompt submission, cookie-backed current project selection, and process-local Web state.
```

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

- [ ] **Step 5: Start local dev server**

Run:

```bash
pnpm dev
```

Expected: Next.js dev server starts at `http://localhost:3000` or the next available port.

- [ ] **Step 6: Manually verify Web flow**

In the browser:

1. Open the local URL.
2. Confirm the project creation panel appears when no current project exists.
3. Create a project with name `Spring LP` and repository `git@example.com:shop/spring.git`.
4. Confirm the page shows the empty project state and enabled composer.
5. Submit prompt `Create a spring ecommerce landing page.`.
6. Confirm the page shows the user prompt, tool process, artifact cards, and preview.
7. Refresh the page.
8. Confirm the same project and completed conversation remain visible.

- [ ] **Step 7: Commit README if needed**

Run:

```bash
git add docs/superpowers/README.md
git commit -m "docs: index lightweight web project flow plan"
```

Only commit if README changed after the plan commit.

---

## Self-Review

- Spec coverage: project creation, prompt submission, cookie current-project state, process-local store, empty state, completed state, typed errors, i18n, and verification are each covered by tasks.
- Placeholder scan: no task asks the implementer to invent missing behavior; validation codes, form field names, cookie name, commands, and commit messages are specified.
- Type consistency: `ProjectFlowErrorCode`, `WorkbenchPageState`, `createWebWorkbenchStore`, `getWebWorkbenchStore`, `createProjectAction`, and `submitPromptAction` are introduced before page usage.
