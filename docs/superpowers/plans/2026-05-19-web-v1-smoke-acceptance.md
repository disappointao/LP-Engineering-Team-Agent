# Web V1 Smoke Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight Web V1 readiness gate: a deterministic smoke test, a root onboarding README, and a manual acceptance checklist that make the current web MVP easy to start, verify, and hand off before deeper Agent runtime work continues.

**Architecture:** Keep the smoke path inside the existing TypeScript monorepo and exercise the existing in-memory web workbench store. Do not add browser automation, deployment, real model calls, MCP execution, or new agent orchestration in this stage. The smoke test validates the existing static LP artifact flow, artifact diff/snippet behavior, and ordinary chat task separation.

**Tech Stack:** pnpm workspace, TypeScript, Vitest, Next.js web app, existing `@lp-agent/*` packages, Markdown documentation.

---

## Task 1: Add Deterministic Web V1 Smoke Test

**Files:**
- Create: `apps/web/src/lib/web-v1-smoke.test.ts`
- Modify: `package.json`

**Purpose:** Provide a fast command that verifies the Web V1 MVP flow without requiring a browser, API key, MCP server, Postgres, or deployment provider.

### Step 1: Create the smoke test

Create `apps/web/src/lib/web-v1-smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createWebWorkbenchStore } from "./workbench-store";

const forbiddenFrameworkMarkers = [
  "__next",
  "data-reactroot",
  "react-dom",
  "createRoot(",
  "ng-version",
  "@angular/core",
  "new Vue(",
  "createApp(",
  "vite/client",
  "svelte-"
];

describe("Web V1 smoke", () => {
  it("runs deterministic LP generation through artifact diff and bounded snippet flow", async () => {
    const store = createWebWorkbenchStore();

    const result = await store.submitTaskPrompt({
      prompt:
        "Create a landing page for a spring ecommerce sale with static HTML CSS JS output",
      implicitProjectName: "Smoke LP Project"
    });

    expect(result).toMatchObject({
      ok: true,
      taskType: "lp_generation"
    });

    if (!result.ok || !result.projectId) {
      throw new Error("expected LP smoke task to create a project");
    }

    const pageState = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId
    });

    expect(pageState.kind).toBe("task_ready");

    if (pageState.kind !== "task_ready") {
      throw new Error("expected LP smoke task page state to be ready");
    }

    expect(pageState.task.type).toBe("lp_generation");
    expect(pageState.snapshot?.project.id).toBe(result.projectId);

    const pageVersion = pageState.snapshot?.currentPageVersion;

    expect(pageVersion?.artifactWorkspaceId).toBeTruthy();
    expect(pageVersion?.previewUrl).toContain("/api/artifacts/");

    const artifacts = pageVersion?.artifacts;

    if (!artifacts) {
      throw new Error("expected LP smoke task to produce static artifacts");
    }

    expect(artifacts.indexHtml.toLowerCase()).toContain("<!doctype html");
    expect(artifacts.indexHtml).toContain("<html");
    expect(artifacts.stylesCss.length).toBeGreaterThan(0);
    expect(artifacts.scriptJs.length).toBeGreaterThan(0);

    const serializedArtifacts = JSON.stringify(artifacts).toLowerCase();

    for (const marker of forbiddenFrameworkMarkers) {
      expect(serializedArtifacts).not.toContain(marker.toLowerCase());
    }

    expect(pageState.artifactDiff?.files.map((file) => file.path)).toEqual([
      "index.html",
      "styles.css",
      "script.js"
    ]);
    expect(pageState.artifactDiff?.files.every((file) => file.canPreview)).toBe(
      true
    );

    const artifactDiffJson = JSON.stringify(pageState.artifactDiff);

    expect(artifactDiffJson).not.toContain("<!doctype html");
    expect(artifactDiffJson).not.toContain(":root");
    expect(artifactDiffJson).not.toContain("window.lpAgent");

    const snippetState = await store.getPageState({
      projectId: result.projectId,
      taskId: result.taskId,
      artifactPath: "styles.css"
    });

    expect(snippetState.kind).toBe("task_ready");

    if (snippetState.kind !== "task_ready") {
      throw new Error("expected LP smoke snippet state to be ready");
    }

    const snippet = snippetState.artifactDiff?.selectedSnippet;

    expect(snippet).toMatchObject({
      path: "styles.css",
      maxBytes: 8192
    });
    expect(snippet?.content).toContain(":root");

    const snippetContent = snippet?.content ? snippet.content : "";

    expect(snippetContent.length).toBeLessThanOrEqual(8192);
    expect(JSON.stringify(snippetState.artifactDiff?.files)).not.toContain(
      ":root"
    );
  });

  it("keeps ordinary tasks outside the LP artifact diff flow", async () => {
    const store = createWebWorkbenchStore();

    const result = await store.submitTaskPrompt({
      prompt: "Help me outline a homepage launch checklist.",
      implicitProjectName: "Smoke General Project"
    });

    expect(result).toMatchObject({
      ok: true,
      taskType: "general"
    });

    if (!result.ok) {
      throw new Error("expected ordinary smoke task to be accepted");
    }

    const pageState = await store.getPageState({
      taskId: result.taskId
    });

    expect(pageState.kind).toBe("task_ready");

    if (pageState.kind !== "task_ready") {
      throw new Error("expected ordinary smoke task page state to be ready");
    }

    expect(pageState.task.type).toBe("general");
    expect(pageState.snapshot).toBeUndefined();
    expect(pageState.artifactDiff).toBeUndefined();
  });
});
```

### Step 2: Run the targeted smoke test directly

Run:

```bash
pnpm exec vitest run apps/web/src/lib/web-v1-smoke.test.ts
```

Expected result:

```text
PASS apps/web/src/lib/web-v1-smoke.test.ts
```

If this fails because an expected field name differs, inspect `apps/web/src/lib/workbench-store.ts` and existing tests in `apps/web/src/lib/workbench-store.test.ts`, then adjust only this smoke test to match the real public store contract.

### Step 3: Add the root smoke script

Modify root `package.json` scripts:

```json
{
  "scripts": {
    "build": "pnpm -r --if-present build",
    "dev": "pnpm --filter @lp-agent/web dev",
    "smoke": "vitest run apps/web/src/lib/web-v1-smoke.test.ts",
    "worker:dev": "pnpm --filter @lp-agent/agent-worker dev",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "pnpm -r --if-present typecheck"
  }
}
```

Keep the existing script order close to the current file. Add only `smoke`.

### Step 4: Verify the new command

Run:

```bash
pnpm smoke
```

Expected result:

```text
PASS apps/web/src/lib/web-v1-smoke.test.ts
```

### Step 5: Commit this task

Run:

```bash
git status --short
git add package.json apps/web/src/lib/web-v1-smoke.test.ts
git commit -m "add web v1 smoke test"
```

---

## Task 2: Add Root README and Local Startup Path

**Files:**
- Create: `README.md`
- Modify: `docs/development.md`

**Purpose:** Give a new developer a single entry point for what the project is, how to run it, how to configure optional real model calls, and what is intentionally out of scope for the current MVP.

### Step 1: Create the root README

Create `README.md`:

```md
# LP Engineering Team Agent

LP Engineering Team Agent is a lightweight web workbench for creating and operating landing page tasks with an agent-style chat flow. The first version focuses on a local Web MVP: users can start from a large conversation entry, create or continue projects, run ordinary chat tasks, and generate framework-free static LP artifacts.

The generated landing page artifact is intentionally static HTML/CSS/JS. The workbench itself is a Next.js app, but generated LP output should not require React, Vue, Angular, Vite, Next.js, or a build step.

## Current Scope

- Web workbench with Manus-like sidebar, task list, chat-first entry, and task detail layout.
- Deterministic local flow for ordinary tasks and LP generation.
- Static artifact workspace for `index.html`, `styles.css`, and `script.js`.
- Artifact preview and bounded source snippet loading for selected files.
- Model gateway configuration surface for deterministic, Anthropic-style, and OpenAI-compatible providers.
- Skills, MCP, model routing, project memory, and agent runtime are represented as architecture surfaces and are being implemented in staged increments.

## Not In The First Web MVP

- Built-in production deployment flow.
- Real MCP tool execution from the web UI.
- Long-running sandboxed shell execution.
- Multi-agent runtime with durable context compression.
- Desktop app packaging.

These items are documented as later stages so the current code can stay small and testable.

## Requirements

- Node.js 20 or newer.
- pnpm 10, matching `packageManager` in `package.json`.

Install dependencies:

```bash
pnpm install
```

## Environment

Create a local environment file from the template:

```bash
cp .env.example .env.local
```

The default deterministic mode does not require model keys:

```env
REAL_MODEL_RUNTIME=0
REAL_MODEL_PROVIDER_TEST=0
```

For real provider testing, fill only the provider section you want to test. The OpenAI-compatible adapter uses:

```env
OPENAI_COMPATIBLE_BASE_URL=https://open.bigmodel.cn/api/paas/v4
OPENAI_COMPATIBLE_API_KEY=your_key_here
OPENAI_COMPATIBLE_DEFAULT_MODEL=glm-5.1
```

Real provider tests are opt-in and should not be needed for normal local smoke checks.

## Run Locally

Start the web workbench:

```bash
pnpm dev
```

Open the local URL printed by Next.js, usually:

```text
http://localhost:3000
```

Run the deterministic worker demo:

```bash
pnpm worker:dev
```

## Verify

Run the fast Web V1 smoke gate:

```bash
pnpm smoke
```

Run all tests:

```bash
pnpm test
```

Type-check all packages and apps:

```bash
pnpm typecheck
```

Build all packages and apps that expose a build script:

```bash
pnpm build
```

Validate the Prisma schema:

```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm --filter @lp-agent/db db:validate
```

## Manual Acceptance

Use the Web V1 checklist when reviewing the local app:

```text
docs/web-v1-acceptance.md
```

The smoke command verifies deterministic behavior quickly. The manual checklist verifies visible UX, language behavior, and feature boundaries that a unit test does not cover yet.

## Documentation Map

- `docs/development.md` - local development notes.
- `docs/web-v1-acceptance.md` - manual Web V1 acceptance checklist.
- `docs/agent-development-learning.md` - Chinese learning notes for Agent development concepts and project decisions.
- `docs/superpowers/README.md` - chronological Superpowers specs and plans.
- `docs/superpowers/specs/` - requirement and design specs.
- `docs/superpowers/plans/` - implementation plans.

## Development Rule

Generated LP code must remain framework-free static HTML/CSS/JS. Keep the workbench implementation and generated artifact format separate.
```

### Step 2: Add a README pointer to development docs

Append this section near the top of `docs/development.md`, after the opening project description or before command details:

```md
## Start Here

For a fresh local setup, use the root [README](../README.md) first. It lists install commands, environment setup, the Web V1 smoke command, and the manual acceptance checklist.

This file keeps deeper development notes that are useful after the basic app is running.
```

If `docs/development.md` already has a matching first-run section by the time this task is implemented, update that section instead of duplicating it.

### Step 3: Verify documentation references

Run:

```bash
rg -n "pnpm smoke|REAL_MODEL_RUNTIME|docs/web-v1-acceptance|Start Here" README.md docs/development.md
```

Expected result:

```text
README.md: contains pnpm smoke
README.md: contains REAL_MODEL_RUNTIME
README.md: contains docs/web-v1-acceptance.md
docs/development.md: contains Start Here
```

### Step 4: Commit this task

Run:

```bash
git status --short
git add README.md docs/development.md
git commit -m "add local startup documentation"
```

---

## Task 3: Add Manual Web V1 Acceptance Checklist

**Files:**
- Create: `docs/web-v1-acceptance.md`

**Purpose:** Document the human acceptance path for the current MVP, including visible UI behavior and explicit boundaries. This complements the deterministic smoke command.

### Step 1: Create the checklist

Create `docs/web-v1-acceptance.md`:

```md
# Web V1 Acceptance Checklist

Use this checklist before treating the current web workbench as a usable local MVP. The deterministic smoke command covers store-level behavior. This checklist covers visible web behavior and product boundaries.

## Preparation

- [ ] Dependencies are installed with `pnpm install`.
- [ ] `.env.local` exists. Deterministic local mode uses `REAL_MODEL_RUNTIME=0`.
- [ ] `pnpm smoke` passes.
- [ ] `pnpm dev` starts the web app and prints a local URL.

## First Screen

- [ ] The app opens to a Manus-like workbench layout with a fixed left navigation area and a large central conversation entry.
- [ ] The left navigation does not scroll with the main conversation content.
- [ ] A user can start with a normal chat prompt without first creating a project.
- [ ] A user can still create a project from the project entry flow.
- [ ] Chinese and English UI text follows the browser or environment language behavior documented for the current MVP.

## Ordinary Task Flow

- [ ] Submit a non-LP prompt, such as `帮我整理一个首页上线检查清单`.
- [ ] The task appears in the task list.
- [ ] The conversation detail opens in a chat-style layout.
- [ ] Tool or process rows, when present, render as progress/process information rather than final user content.
- [ ] The task can be interrupted or continued through the visible conversation control.
- [ ] No LP artifact preview is shown for a normal chat task.

## LP Generation Flow

- [ ] Submit an LP prompt, such as `生成一个春季电商活动的静态 HTML 落地页`.
- [ ] The task appears as an LP generation task.
- [ ] The result contains a static artifact workspace with `index.html`, `styles.css`, and `script.js`.
- [ ] The generated artifact can be previewed locally.
- [ ] The generated LP artifact does not require React, Vue, Angular, Next.js, Vite, or another frontend framework build step.
- [ ] The visible conversation explains artifact generation as process output and final result output separately.

## Artifact Diff And Source Snippets

- [ ] The artifact diff list shows file-level metadata for `index.html`, `styles.css`, and `script.js`.
- [ ] Large file contents are not embedded directly into the default task payload.
- [ ] Selecting `artifactPath=index.html` returns a bounded source snippet for `index.html`.
- [ ] Selecting `artifactPath=styles.css` returns a bounded source snippet for `styles.css`.
- [ ] Selecting `artifactPath=script.js` returns a bounded source snippet for `script.js`.
- [ ] Unknown artifact paths fail gracefully without breaking the task page.

## Skills, Models, And MCP Boundaries

- [ ] Skills are presented as managed workflow capabilities rather than ad hoc prompt text.
- [ ] The model configuration surface supports deterministic local mode and real provider configuration surfaces.
- [ ] Real model provider tests are opt-in and do not run during `pnpm smoke`.
- [ ] MCP capabilities are documented or represented as a gateway surface, but real MCP tool execution is not required for this Web V1 checklist.
- [ ] Deployment is not required for the current flow. Deployment can later be provided by skills or a dedicated deployment module.

## Regression Commands

- [ ] `pnpm smoke` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm build` passes.

## Known Later Work

- [ ] Browser automation acceptance tests are still future work.
- [ ] Real MCP execution from the web UI is still future work.
- [ ] Durable multi-agent context compression and retrieval are still future work.
- [ ] Built-in deployment orchestration is still future work.
- [ ] Desktop packaging is still future work.
```

### Step 2: Verify checklist coverage

Run:

```bash
rg -n "Ordinary Task Flow|LP Generation Flow|artifactPath|MCP|Deployment|pnpm smoke" docs/web-v1-acceptance.md
```

Expected result:

```text
docs/web-v1-acceptance.md: contains all searched acceptance anchors
```

### Step 3: Commit this task

Run:

```bash
git status --short
git add docs/web-v1-acceptance.md
git commit -m "add web v1 acceptance checklist"
```

---

## Task 4: Update Superpowers Index And Learning Notes

**Files:**
- Modify: `docs/superpowers/README.md`
- Modify: `docs/agent-development-learning.md`

**Purpose:** Keep future agents and developers aligned with the latest plan and the Agent-development learning trail.

### Step 1: Confirm the Superpowers plan entry exists

Ensure `docs/superpowers/README.md` includes this chronological entry after the Web V1 smoke acceptance design spec:

```md
63. `plans/2026-05-19-web-v1-smoke-acceptance.md`
   - Stage 17 Web V1 smoke and acceptance implementation plan.
   - Read this after the Stage 17 design when implementing or auditing the deterministic smoke command, startup README, and manual Web V1 acceptance checklist.
```

If the numeric position has changed because another document was added first, keep the chronological order and use the next correct number.

### Step 2: Update Chinese learning notes

Update the Stage 17 section in `docs/agent-development-learning.md` so it references both the spec and this plan. Add an implementation note after the smoke test exists:

```md
实现补充：

- `pnpm smoke` 是 Web V1 的快速本地健康检查，只走确定性 store/API 级流程，不依赖真实模型、MCP、浏览器或部署。
- 手动验收清单补齐可见 UX、语言行为、Skills/Models/MCP 边界、部署后置等人工判断项。
- 这种分层验收方式适合 Agent 项目早期：先让最小链路稳定，再逐步接入真实模型、工具执行、上下文压缩、检索和多 Agent 协作。
```

Do not remove existing learning notes about agent context, skills, rules, tool outputs, file system state, multi-agent coordination, retrieval, composition, and injection. This stage should reinforce that those deeper Agent topics are planned incrementally, not implemented all at once.

### Step 3: Verify documentation links

Run:

```bash
rg -n "Web V1 smoke and acceptance implementation plan|pnpm smoke|分层验收方式" docs/superpowers/README.md docs/agent-development-learning.md
```

Expected result:

```text
docs/superpowers/README.md: contains Web V1 smoke and acceptance implementation plan
docs/agent-development-learning.md: contains pnpm smoke
docs/agent-development-learning.md: contains 分层验收方式
```

### Step 4: Commit this task

Run:

```bash
git status --short
git add docs/superpowers/README.md docs/agent-development-learning.md
git commit -m "document web v1 smoke readiness"
```

---

## Task 5: Full Verification And Final Commit Check

**Files:**
- No planned source edits.

**Purpose:** Verify the stage as a complete readiness layer.

### Step 1: Run the focused smoke gate

Run:

```bash
pnpm smoke
```

Expected result:

```text
PASS apps/web/src/lib/web-v1-smoke.test.ts
```

### Step 2: Run the broader regression suite

Run:

```bash
pnpm test
```

Expected result:

```text
all Vitest tests pass
```

Run:

```bash
pnpm typecheck
```

Expected result:

```text
all workspace typecheck scripts pass
```

Run:

```bash
pnpm build
```

Expected result:

```text
all workspace build scripts pass
```

### Step 3: Check formatting-sensitive diff issues

Run:

```bash
git diff --check
```

Expected result:

```text
no whitespace errors
```

### Step 4: Confirm working tree state

Run:

```bash
git status --short
```

Expected result:

```text
no uncommitted changes
```

If verification requires a small fix, make the smallest scoped edit, rerun the failed verification command, then commit with a concise imperative message.

---

## Success Criteria

- `pnpm smoke` exists and runs only the deterministic Web V1 smoke test.
- Smoke coverage verifies LP generation, static artifact output, artifact diff metadata, bounded artifact snippets, and ordinary chat task separation.
- Root `README.md` gives a fresh developer enough information to install, configure, run, smoke test, and understand current boundaries.
- `docs/web-v1-acceptance.md` provides a manual checklist for visible Web V1 behavior.
- Superpowers index and Chinese learning notes reference this stage.
- `pnpm smoke`, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check` pass before completion.
