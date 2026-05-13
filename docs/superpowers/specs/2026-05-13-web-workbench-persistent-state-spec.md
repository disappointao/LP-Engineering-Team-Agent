# Web Workbench Persistent State Spec

## Purpose

Move the current Web workbench state out of `apps/web` process-local maps so task threads, messages, selected LP snapshots, and projects can be reopened after a local dev-server restart.

This is the next Stage 2 slice after the conversation-first entry. It keeps the current Manus-style Web UX and deterministic local LP generation, but replaces the Web-only state holder with repository-backed state that can later be swapped for Prisma/Postgres or a desktop-local persistence adapter.

## Current Baseline

The current Web app already supports:

- conversation-first entry from a large prompt composer,
- ordinary task threads,
- LP-generation task threads,
- implicit LP project creation,
- sidebar project and task lists,
- generated framework-free static LP artifacts,
- current project and current task cookies.

The remaining weakness is in `apps/web/src/lib/workbench-store.ts`:

- projects are mirrored in a local `Map`,
- tasks are kept in a local `Map`,
- messages are kept in a local `Map`,
- task-to-snapshot bindings are kept in a local `Map`,
- `getWebWorkbenchStore()` stores the whole Web store on `globalThis`.

That state survives page refreshes while the dev server process stays alive, but it is lost when the process restarts. It also makes future team collaboration, desktop state adapters, and real DB repositories harder because Web-specific data is not behind a stable repository interface.

## Goals

- Persist Web workbench records through repository interfaces:
  - projects,
  - briefs,
  - page versions,
  - deployments,
  - tasks,
  - task messages,
  - task snapshot bindings.
- Keep the first local implementation easy to run without requiring Postgres.
- Add a JSON-file repository adapter for local Web development so state survives Next.js dev-server restarts.
- Keep in-memory repositories available for deterministic unit tests.
- Keep generated LP output framework-free static HTML/CSS/JS.
- Preserve the current no-Git, no-deployment Web flow.
- Preserve Chinese/English locale behavior.
- Keep repository interfaces plain TypeScript objects, not React or Prisma models.

## Non-Goals

- No authentication, users, organization membership UI, or permissions UI.
- No realtime collaboration.
- No production-grade concurrent write handling.
- No direct deployment feature.
- No real model-provider integration.
- No MCP execution.
- No Prisma/Postgres implementation in this slice.

## Storage Strategy

Use `@lp-agent/db` as the persistence boundary.

This slice adds repository contracts and two implementations:

1. In-memory repositories for tests.
2. JSON-file repositories for local Web development.

The JSON-file adapter stores one serialized workbench state file under a gitignored local state directory. This is intentionally not the final hosted persistence design. It is a practical bridge that makes local Web V1 usable while keeping the same repository contracts that a later Prisma/Postgres implementation can satisfy.

The file-backed implementation should be treated as local-development and future desktop-friendly persistence. It should not be described as a production multi-user database.

## Data Model Additions

Add Web workbench records to `@lp-agent/db`.

```ts
export type WorkbenchTaskType = "general_chat" | "lp_generation" | "project_setup";
export type WorkbenchTaskStatus = "complete";
export type WorkbenchMessageRole = "user" | "assistant";

export interface WorkbenchTaskRecord {
  id: string;
  title: string;
  type: WorkbenchTaskType;
  status: WorkbenchTaskStatus;
  projectId?: string;
  createdAt: string;
}

export interface WorkbenchMessageRecord {
  id: string;
  taskId: string;
  role: WorkbenchMessageRole;
  content: string;
  createdAt: string;
}

export interface WorkbenchTaskSnapshotRecord {
  taskId: string;
  projectId: string;
  briefId?: string;
  pageVersionId?: string;
  createdAt: string;
}
```

The snapshot binding stores IDs, not a nested copy of the full snapshot. Page rendering reconstructs the snapshot from canonical project, brief, page-version, and deployment records.

## Repository Requirements

Extend the repository bundle in `@lp-agent/db`:

```ts
export interface WorkbenchRepositories {
  projects: ProjectRepository;
  briefs: BriefRepository;
  pageVersions: PageVersionRepository;
  deployments: DeploymentRepository;
  tasks: WorkbenchTaskRepository;
  messages: WorkbenchMessageRepository;
  taskSnapshots: WorkbenchTaskSnapshotRepository;
}
```

Repositories must return defensive copies. Mutating a returned object must not mutate the stored state.

Project, brief, page-version, task, and message repositories need list methods so services can:

- render sidebar lists,
- calculate deterministic next IDs after a local JSON reload,
- avoid overwriting previous records after a dev-server restart.

## API Requirements

`DemoWorkbenchService` should continue to own LP orchestration. It should receive the same repository bundle used by the Web workbench store.

Add a snapshot loader that can reconstruct a task-specific LP snapshot from explicit IDs. This avoids falling back to "latest project snapshot" when a project has multiple LP tasks.

The service must generate stable deterministic IDs in empty in-memory tests and avoid collisions when a file repository already contains previous records.

## Web Requirements

`apps/web/src/lib/workbench-store.ts` remains the Web-facing use-case facade, but it should stop owning durable state in local maps.

The Web store should:

- read projects from `repositories.projects.listAll()`,
- read tasks from `repositories.tasks.listAll()`,
- read active task messages from `repositories.messages.listForTask(taskId)`,
- read task-specific snapshot refs from `repositories.taskSnapshots.getByTaskId(taskId)`,
- create task and message records through repositories,
- create task snapshot refs through repositories after LP generation succeeds.

`getWebWorkbenchStore()` can still keep a singleton facade on `globalThis`, but the durable data must live in the repository adapter, not in Web-only maps.

## Local State File

The Web app should default to a local JSON file for development.

Recommended path:

```text
.lp-agent/workbench-state.json
```

The directory must be ignored by Git. The state file is machine-local and should not be committed.

## UX Copy

Update the local persistence copy in `apps/web/src/lib/i18n.ts`.

Current meaning:

- English: state is only kept while the dev server is running.
- Chinese: 状态只保存在当前 dev server 运行期间。

New meaning:

- English: state is saved locally on this machine for the Web MVP.
- Chinese: 状态会保存在这台电脑的本地开发状态文件中。

No visible navigation or layout redesign is required in this slice.

## Compatibility

This slice must preserve:

- current page tests for the conversation-first empty state,
- ordinary task submission,
- LP task submission with implicit project creation,
- task-specific LP snapshots,
- no repository URL field,
- no deployment UI,
- no React/Vue/Svelte/etc. in generated LP artifacts.

## Acceptance Criteria

- `pnpm test` passes.
- `pnpm typecheck` passes.
- `pnpm build` passes.
- `pnpm --filter @lp-agent/db test` covers in-memory and JSON-file repository behavior.
- `apps/web/src/lib/workbench-store.test.ts` proves a second Web store instance can reopen records written by the first when sharing a repository bundle.
- `apps/web/src/lib/workbench-store.test.ts` proves task-specific LP snapshots still reopen the correct brief/page version.
- `.lp-agent/` is ignored by Git.
- `docs/superpowers/README.md` includes this spec and its implementation plan in reading order.

## Future Follow-Ups

- Replace or supplement the JSON-file adapter with Prisma/Postgres repositories.
- Add workspace/project member state and role-aware repository queries.
- Persist run events for planner/builder/reviewer/deployer timelines.
- Add skills management on top of persistent scopes.
- Add model and MCP settings once persisted project scope is reliable.
