# Conversation-First Workbench Entry Spec

Date: 2026-05-12
Status: draft for user review

## Summary

The Web workbench should open like a lightweight Manus-style agent workspace: a large central composer is the first meaningful surface, and the user can start by typing a normal task, a chat request, or an LP generation request. Creating a project remains available, but it is no longer the required first step.

This amends the current lightweight Web flow. The previous LP project flow remains valid after a task is routed into LP generation, but the entry model changes from project-first to conversation-first.

## Goals

- Make the first screen a large, centered conversation composer.
- Allow users to start ordinary tasks without creating a project.
- Allow users to start LP generation from the same composer.
- Keep explicit project creation available from the sidebar, similar to Manus project creation.
- Treat projects as optional task context, not as the product entry gate.
- Preserve the current no-Git and no-automatic-deployment decisions.
- Preserve framework-free LP output as static HTML/CSS/JS.
- Keep the sidebar split between navigation, projects, and recent/all tasks.

## Non-Goals

- Building a fully general autonomous agent runtime in this slice.
- Adding persistent database-backed chat history.
- Adding deployment, Git, PR, or hosting integration.
- Replacing the LP generation pipeline.
- Adding billing, account, notification, or marketplace features.

## Product Model

### Conversation-First Entry

When no task is active, the main panel renders a Manus-style empty state:

- a compact top bar,
- a large title such as `What can I help you build?`,
- a large composer card,
- quick action chips for common intents,
- no blocking project creation form.

The composer is enabled even when there is no active project.

### Task Types

The first prompt creates a task thread. The initial task type is inferred from the prompt and optional action chip:

- `general_chat`: ordinary questions, planning, writing, analysis, and non-LP tasks.
- `lp_generation`: landing page generation, HTML page creation, ecommerce LP tasks, and website/page tasks that should produce static artifacts.
- `project_setup`: explicit project creation or project organization requests.

The UI does not need to expose these internal names. They are implementation concepts for routing and tests.

### Project Context

Projects are optional context containers:

- A user can create a project from the sidebar before starting a task.
- A user can start a general task with no project.
- A user can start an LP task with no project; the system creates an implicit local project for the LP run.
- The implicit project name should be derived from the prompt when possible, otherwise use a localized fallback such as `Untitled LP Project` / `未命名 LP 项目`.
- The sidebar project list shows explicit and implicit projects by name.

This keeps the current in-memory project service usable without forcing the user through project setup first.

## UX Flow

### New Empty State

The current setup panel is replaced by a large central composer. The sidebar can still show an empty project section with a small create action, but the main panel should not make project creation the only available action.

Expected empty-state behavior:

1. User enters `帮我写一个双 11 活动方案`.
2. System creates a general task thread.
3. The conversation renders a user message and assistant response/process area.
4. No project is required.

Expected LP behavior:

1. User enters `生成一个电商春季促销 LP，输出单文件 HTML`.
2. System routes the task as LP generation.
3. If there is no active project, system creates an implicit local project.
4. Existing LP flow runs: brief, static artifacts, review.
5. Conversation renders tool progress, artifact cards, and static preview.

Expected explicit project behavior:

1. User clicks the sidebar project create action.
2. UI opens a compact project creation form or inline sidebar form.
3. User enters a project name.
4. Project becomes the active context for subsequent LP tasks.

### Sidebar

The sidebar remains fixed and should not scroll with the main conversation body. It should include:

- primary navigation,
- a projects section with create action,
- an all tasks/recent tasks section,
- local mode/language metadata for the MVP.

Task list items should not imply every task is an LP task. They can represent ordinary chat tasks and LP artifact tasks.

### Composer

The composer is the primary interaction surface. It should support:

- typing free-form text,
- submitting a task without active project,
- interrupt affordance when a task is running,
- quick action chips that guide intent without locking the user into a form.

For V1, attachments and cloud runtime controls can remain visual affordances if they already exist, but they do not need full backend behavior.

## Data and Runtime Behavior

### V1 In-Memory State

The current process-local store remains acceptable. It should evolve from only project snapshots to project plus task/thread state:

- `TaskRecord`: id, title, type, status, optional projectId, createdAt.
- `ChatMessageRecord`: id, taskId, role, content, createdAt.
- LP task state can continue to reuse `WorkbenchSnapshot` for brief/page version artifacts.

This can be implemented incrementally. The first implementation may keep simple in-memory arrays beside the existing project map.

### Routing

Routing should be deterministic for the MVP:

- LP keywords route to `lp_generation`: `lp`, `landing page`, `落地页`, `页面`, `html`, `官网`, `活动页`, `电商`.
- Explicit project words route to `project_setup`: `创建项目`, `new project`, `project`.
- Everything else routes to `general_chat`.

Future versions can move routing into model-gateway or a skill-driven planner.

### General Task Response

The first general task implementation can be deterministic and lightweight. It should create a chat thread and render a normal assistant response/process area, even if the response is not powered by a full model yet.

The important V1 behavior is that users can start a non-LP task from the main composer and see a conversation-style result.

## Compatibility With Earlier Specs

This spec supersedes the project-first entry described in:

- `specs/2026-05-12-lightweight-real-web-project-flow-spec.md`
- `specs/2026-05-12-web-flow-no-git-no-deployment-spec.md`

Only the entry requirement is superseded. The following earlier decisions remain active:

- no repository URL in Web V1,
- no automatic deployment in Web V1,
- LP artifacts are static HTML/CSS/JS,
- deployment remains a future skill or explicit workflow,
- current state can remain process-local for the MVP.

## Testing Requirements

Tests must cover:

- empty state renders a large enabled composer without requiring project creation,
- general task submission works with no project,
- LP task submission works with no project by creating an implicit local project,
- explicit project creation remains available,
- sidebar can display both projects and tasks,
- existing LP completion still renders planner, builder, reviewer, static downloads, and preview,
- repository and deployment UI remain absent from the default Web flow.

## Open Implementation Notes

- This is a product-shape amendment, not a final runtime architecture.
- The implementation plan should keep the first slice small: conversation-first empty state, deterministic task routing, implicit LP project creation, and basic general task rendering.
- Persistent task storage, real model-backed general chat, and desktop parity should be separate later specs.
