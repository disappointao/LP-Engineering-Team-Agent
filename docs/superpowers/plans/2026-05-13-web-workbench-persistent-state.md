# Web Workbench Persistent State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Web workbench projects, task threads, messages, and LP snapshot bindings from process-local Web maps into repository-backed local persistence.

**Architecture:** Extend `@lp-agent/db` with task/message/snapshot repository contracts, list methods, in-memory repositories, and a JSON-file repository adapter. Update `@lp-agent/api` to reconstruct task-specific snapshots from explicit IDs and to avoid ID collisions when repositories already contain records. Update `apps/web` so the Web store is a use-case facade over shared repositories instead of owning durable maps.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Next.js server actions, Node `fs/promises` for local JSON persistence, existing `@lp-agent/*` packages.

---

## Scope Check

This plan implements only local Web workbench persistence. It does not add Prisma/Postgres repositories, auth, realtime collaboration, skills UI, model settings UI, MCP settings UI, deployment UI, or real model calls.

The local JSON adapter is a bridge for Web V1 and future desktop-local state. It is not production multi-user storage.

## File Structure

Modify these files:

```text
.gitignore
apps/web/src/lib/i18n.test.ts
apps/web/src/lib/i18n.ts
apps/web/src/lib/workbench-store.test.ts
apps/web/src/lib/workbench-store.ts
docs/superpowers/README.md
packages/api/src/index.ts
packages/api/src/services.test.ts
packages/db/src/index.ts
packages/db/src/workbench-repositories.test.ts
packages/db/src/workbench-repositories.ts
```

Create these files:

```text
packages/db/src/json-file-workbench-repositories.test.ts
packages/db/src/json-file-workbench-repositories.ts
```

Responsibility boundaries:

- `packages/db/src/workbench-repositories.ts`: domain records, repository interfaces, in-memory implementation, defensive-copy helpers.
- `packages/db/src/json-file-workbench-repositories.ts`: local JSON-file implementation of the same repository interfaces.
- `packages/api/src/index.ts`: LP orchestration, deterministic ID allocation from repository contents, task-specific snapshot reconstruction.
- `apps/web/src/lib/workbench-store.ts`: Web use-case facade, prompt classification, current page state assembly, task/message creation.
- `apps/web/src/lib/i18n.ts`: localized copy only.

## Task 1: Extend DB Repository Contracts

**Files:**
- Modify: `packages/db/src/workbench-repositories.ts`
- Modify: `packages/db/src/workbench-repositories.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Add failing repository tests for list methods and Web task records**

Append these tests to `packages/db/src/workbench-repositories.test.ts`:

```ts
it("lists projects in creation order and returns defensive copies", async () => {
  const repositories = createInMemoryWorkbenchRepositories();

  await repositories.projects.save({
    id: "project_1",
    name: "Spring sale",
    createdAt
  });
  await repositories.projects.save({
    id: "project_2",
    name: "Summer sale",
    createdAt: "2026-05-12T00:01:00.000Z"
  });

  const projects = await repositories.projects.listAll();
  projects[0].name = "Mutated locally";

  await expect(repositories.projects.listAll()).resolves.toEqual([
    {
      id: "project_1",
      name: "Spring sale",
      createdAt
    },
    {
      id: "project_2",
      name: "Summer sale",
      createdAt: "2026-05-12T00:01:00.000Z"
    }
  ]);
});

it("persists tasks, messages, and task snapshot references", async () => {
  const repositories = createInMemoryWorkbenchRepositories();

  await repositories.tasks.save({
    id: "task_1",
    title: "Create a landing page",
    type: "lp_generation",
    status: "complete",
    projectId: "project_1",
    createdAt
  });
  await repositories.messages.save({
    id: "message_1",
    taskId: "task_1",
    role: "user",
    content: "Create a landing page",
    createdAt
  });
  await repositories.messages.save({
    id: "message_2",
    taskId: "task_1",
    role: "assistant",
    content: "LP artifacts are ready for review.",
    createdAt: "2026-05-12T00:01:00.000Z"
  });
  await repositories.taskSnapshots.save({
    taskId: "task_1",
    projectId: "project_1",
    briefId: "brief_1",
    pageVersionId: "version_1",
    createdAt
  });

  await expect(repositories.tasks.getById("task_1")).resolves.toMatchObject({
    id: "task_1",
    type: "lp_generation",
    projectId: "project_1"
  });
  await expect(repositories.tasks.listAll()).resolves.toEqual([
    expect.objectContaining({
      id: "task_1",
      title: "Create a landing page"
    })
  ]);
  await expect(repositories.messages.listForTask("task_1")).resolves.toEqual([
    expect.objectContaining({
      id: "message_1",
      role: "user"
    }),
    expect.objectContaining({
      id: "message_2",
      role: "assistant"
    })
  ]);
  await expect(repositories.messages.listAll()).resolves.toHaveLength(2);
  await expect(repositories.taskSnapshots.getByTaskId("task_1")).resolves.toEqual({
    taskId: "task_1",
    projectId: "project_1",
    briefId: "brief_1",
    pageVersionId: "version_1",
    createdAt
  });
});
```

- [ ] **Step 2: Run the DB tests and verify they fail**

Run:

```bash
pnpm --filter @lp-agent/db test
```

Expected: FAIL because `listAll`, `tasks`, `messages`, and `taskSnapshots` do not exist yet.

- [ ] **Step 3: Add task/message/snapshot types and repository interfaces**

In `packages/db/src/workbench-repositories.ts`, add these exports after `PageVersionRecord`:

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

Extend existing interfaces with list methods:

```ts
export interface ProjectRepository {
  save(project: ProjectRecord): Promise<void>;
  getById(projectId: string): Promise<ProjectRecord | undefined>;
  listAll(): Promise<ProjectRecord[]>;
}

export interface BriefRepository {
  save(brief: BriefRecord): Promise<void>;
  getById(briefId: string): Promise<BriefRecord | undefined>;
  findLatestForProject(projectId: string): Promise<BriefRecord | undefined>;
  listAll(): Promise<BriefRecord[]>;
}

export interface PageVersionRepository {
  save(pageVersion: PageVersionRecord): Promise<void>;
  getById(pageVersionId: string): Promise<PageVersionRecord | undefined>;
  findLatestForProject(projectId: string): Promise<PageVersionRecord | undefined>;
  listAll(): Promise<PageVersionRecord[]>;
}

export interface WorkbenchTaskRepository {
  save(task: WorkbenchTaskRecord): Promise<void>;
  getById(taskId: string): Promise<WorkbenchTaskRecord | undefined>;
  listAll(): Promise<WorkbenchTaskRecord[]>;
}

export interface WorkbenchMessageRepository {
  save(message: WorkbenchMessageRecord): Promise<void>;
  listForTask(taskId: string): Promise<WorkbenchMessageRecord[]>;
  listAll(): Promise<WorkbenchMessageRecord[]>;
}

export interface WorkbenchTaskSnapshotRepository {
  save(snapshot: WorkbenchTaskSnapshotRecord): Promise<void>;
  getByTaskId(taskId: string): Promise<WorkbenchTaskSnapshotRecord | undefined>;
}
```

Extend `WorkbenchRepositories`:

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

- [ ] **Step 4: Implement in-memory repositories**

Add the new repository instances to `InMemoryWorkbenchRepositories`:

```ts
class InMemoryWorkbenchRepositories implements WorkbenchRepositories {
  readonly projects = new InMemoryProjectRepository();
  readonly briefs = new InMemoryBriefRepository();
  readonly pageVersions = new InMemoryPageVersionRepository();
  readonly deployments = new InMemoryDeploymentRepository();
  readonly tasks = new InMemoryWorkbenchTaskRepository();
  readonly messages = new InMemoryWorkbenchMessageRepository();
  readonly taskSnapshots = new InMemoryWorkbenchTaskSnapshotRepository();
}
```

Add `listAll()` to the existing in-memory repositories:

```ts
async listAll(): Promise<ProjectRecord[]> {
  return [...this.projects.values()].map(copyProject);
}
```

```ts
async listAll(): Promise<BriefRecord[]> {
  return [...this.briefs.values()].map(copyBriefRecord);
}
```

```ts
async listAll(): Promise<PageVersionRecord[]> {
  return [...this.pageVersions.values()].map(copyPageVersion);
}
```

Add the new in-memory classes:

```ts
class InMemoryWorkbenchTaskRepository implements WorkbenchTaskRepository {
  private readonly tasks = new Map<string, WorkbenchTaskRecord>();

  async save(task: WorkbenchTaskRecord): Promise<void> {
    this.tasks.set(task.id, copyTask(task));
  }

  async getById(taskId: string): Promise<WorkbenchTaskRecord | undefined> {
    const task = this.tasks.get(taskId);
    return task ? copyTask(task) : undefined;
  }

  async listAll(): Promise<WorkbenchTaskRecord[]> {
    return [...this.tasks.values()].map(copyTask);
  }
}

class InMemoryWorkbenchMessageRepository implements WorkbenchMessageRepository {
  private readonly messages = new Map<string, WorkbenchMessageRecord>();

  async save(message: WorkbenchMessageRecord): Promise<void> {
    this.messages.set(message.id, copyMessage(message));
  }

  async listForTask(taskId: string): Promise<WorkbenchMessageRecord[]> {
    return [...this.messages.values()]
      .filter((message) => message.taskId === taskId)
      .map(copyMessage);
  }

  async listAll(): Promise<WorkbenchMessageRecord[]> {
    return [...this.messages.values()].map(copyMessage);
  }
}

class InMemoryWorkbenchTaskSnapshotRepository implements WorkbenchTaskSnapshotRepository {
  private readonly snapshots = new Map<string, WorkbenchTaskSnapshotRecord>();

  async save(snapshot: WorkbenchTaskSnapshotRecord): Promise<void> {
    this.snapshots.set(snapshot.taskId, copyTaskSnapshot(snapshot));
  }

  async getByTaskId(taskId: string): Promise<WorkbenchTaskSnapshotRecord | undefined> {
    const snapshot = this.snapshots.get(taskId);
    return snapshot ? copyTaskSnapshot(snapshot) : undefined;
  }
}
```

Add copy helpers:

```ts
function copyTask(task: WorkbenchTaskRecord): WorkbenchTaskRecord {
  return { ...task };
}

function copyMessage(message: WorkbenchMessageRecord): WorkbenchMessageRecord {
  return { ...message };
}

function copyTaskSnapshot(snapshot: WorkbenchTaskSnapshotRecord): WorkbenchTaskSnapshotRecord {
  return { ...snapshot };
}
```

- [ ] **Step 5: Run the DB tests**

Run:

```bash
pnpm --filter @lp-agent/db test
```

Expected: PASS.

- [ ] **Step 6: Commit the DB contract work**

Run:

```bash
git add packages/db/src/workbench-repositories.ts packages/db/src/workbench-repositories.test.ts packages/db/src/index.ts
git commit -m "feat: add workbench task repositories"
```

## Task 2: Add JSON-File Repository Adapter

**Files:**
- Create: `packages/db/src/json-file-workbench-repositories.ts`
- Create: `packages/db/src/json-file-workbench-repositories.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write failing JSON repository tests**

Create `packages/db/src/json-file-workbench-repositories.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createJsonFileWorkbenchRepositories } from "./index";

const createdAt = "2026-05-13T00:00:00.000Z";
const tempDirs: string[] = [];

async function tempStateFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lp-agent-db-"));
  tempDirs.push(directory);
  return join(directory, "workbench-state.json");
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true
      })
    )
  );
});

describe("json-file workbench repositories", () => {
  it("reopens projects, tasks, messages, and task snapshots from disk", async () => {
    const filePath = await tempStateFile();
    const first = createJsonFileWorkbenchRepositories({ filePath });

    await first.projects.save({
      id: "project_1",
      name: "Spring sale",
      createdAt
    });
    await first.tasks.save({
      id: "task_1",
      title: "Create LP",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt
    });
    await first.messages.save({
      id: "message_1",
      taskId: "task_1",
      role: "user",
      content: "Create LP",
      createdAt
    });
    await first.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_1",
      pageVersionId: "version_1",
      createdAt
    });

    const second = createJsonFileWorkbenchRepositories({ filePath });

    await expect(second.projects.listAll()).resolves.toEqual([
      {
        id: "project_1",
        name: "Spring sale",
        createdAt
      }
    ]);
    await expect(second.tasks.listAll()).resolves.toEqual([
      {
        id: "task_1",
        title: "Create LP",
        type: "lp_generation",
        status: "complete",
        projectId: "project_1",
        createdAt
      }
    ]);
    await expect(second.messages.listForTask("task_1")).resolves.toEqual([
      {
        id: "message_1",
        taskId: "task_1",
        role: "user",
        content: "Create LP",
        createdAt
      }
    ]);
    await expect(second.taskSnapshots.getByTaskId("task_1")).resolves.toEqual({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_1",
      pageVersionId: "version_1",
      createdAt
    });
  });

  it("creates parent directories and writes readable JSON", async () => {
    const filePath = await tempStateFile();
    const repositories = createJsonFileWorkbenchRepositories({ filePath });

    await repositories.projects.save({
      id: "project_1",
      name: "Spring sale",
      createdAt
    });

    const raw = await readFile(filePath, "utf8");
    expect(JSON.parse(raw)).toMatchObject({
      projects: [
        {
          id: "project_1",
          name: "Spring sale"
        }
      ],
      tasks: [],
      messages: [],
      taskSnapshots: []
    });
  });
});
```

- [ ] **Step 2: Run the JSON repository tests and verify they fail**

Run:

```bash
pnpm --filter @lp-agent/db test
```

Expected: FAIL because `createJsonFileWorkbenchRepositories` is not exported.

- [ ] **Step 3: Implement the JSON repository adapter**

Create `packages/db/src/json-file-workbench-repositories.ts`:

```ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DeploymentHandoff } from "@lp-agent/git-deployment";
import type {
  BriefRecord,
  PageVersionRecord,
  ProjectRecord,
  WorkbenchMessageRecord,
  WorkbenchRepositories,
  WorkbenchTaskRecord,
  WorkbenchTaskSnapshotRecord
} from "./workbench-repositories";

interface JsonWorkbenchState {
  projects: ProjectRecord[];
  briefs: BriefRecord[];
  pageVersions: PageVersionRecord[];
  deployments: DeploymentHandoff[];
  tasks: WorkbenchTaskRecord[];
  messages: WorkbenchMessageRecord[];
  taskSnapshots: WorkbenchTaskSnapshotRecord[];
}

export interface JsonFileWorkbenchRepositoriesOptions {
  filePath: string;
}

export function createJsonFileWorkbenchRepositories(
  options: JsonFileWorkbenchRepositoriesOptions
): WorkbenchRepositories {
  const store = new JsonStateStore(options.filePath);
  return {
    projects: {
      save: (project) => store.upsert("projects", project, (record) => record.id === project.id),
      getById: async (projectId) =>
        (await store.read()).projects.find((project) => project.id === projectId),
      listAll: async () => (await store.read()).projects
    },
    briefs: {
      save: (brief) => store.upsert("briefs", brief, (record) => record.id === brief.id),
      getById: async (briefId) => (await store.read()).briefs.find((brief) => brief.id === briefId),
      findLatestForProject: async (projectId) =>
        (await store.read()).briefs.filter((brief) => brief.projectId === projectId).at(-1),
      listAll: async () => (await store.read()).briefs
    },
    pageVersions: {
      save: (pageVersion) =>
        store.upsert("pageVersions", pageVersion, (record) => record.id === pageVersion.id),
      getById: async (pageVersionId) =>
        (await store.read()).pageVersions.find((pageVersion) => pageVersion.id === pageVersionId),
      findLatestForProject: async (projectId) =>
        (await store.read()).pageVersions.filter((pageVersion) => pageVersion.projectId === projectId).at(-1),
      listAll: async () => (await store.read()).pageVersions
    },
    deployments: {
      save: (deployment) =>
        store.upsert("deployments", deployment, (record) => record.pageVersionId === deployment.pageVersionId),
      getByPageVersionId: async (pageVersionId) =>
        (await store.read()).deployments.find((deployment) => deployment.pageVersionId === pageVersionId),
      findLatestForProject: async (projectId) =>
        (await store.read()).deployments.filter((deployment) => deployment.projectId === projectId).at(-1)
    },
    tasks: {
      save: (task) => store.upsert("tasks", task, (record) => record.id === task.id),
      getById: async (taskId) => (await store.read()).tasks.find((task) => task.id === taskId),
      listAll: async () => (await store.read()).tasks
    },
    messages: {
      save: (message) => store.upsert("messages", message, (record) => record.id === message.id),
      listForTask: async (taskId) =>
        (await store.read()).messages.filter((message) => message.taskId === taskId),
      listAll: async () => (await store.read()).messages
    },
    taskSnapshots: {
      save: (snapshot) =>
        store.upsert("taskSnapshots", snapshot, (record) => record.taskId === snapshot.taskId),
      getByTaskId: async (taskId) =>
        (await store.read()).taskSnapshots.find((snapshot) => snapshot.taskId === taskId)
    }
  };
}

class JsonStateStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<JsonWorkbenchState> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      if (isMissingFileError(error)) {
        return createEmptyState();
      }
      throw error;
    }
  }

  async upsert<K extends keyof JsonWorkbenchState>(
    key: K,
    value: JsonWorkbenchState[K][number],
    matches: (record: JsonWorkbenchState[K][number]) => boolean
  ): Promise<void> {
    const state = await this.read();
    const records = state[key];
    const nextRecords = records.some(matches)
      ? records.map((record) => (matches(record) ? value : record))
      : [...records, value];
    const nextState = {
      ...state,
      [key]: nextRecords
    };
    await this.write(nextState);
  }

  private async write(state: JsonWorkbenchState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.filePath);
  }
}

function normalizeState(value: unknown): JsonWorkbenchState {
  const state = typeof value === "object" && value !== null ? value as Partial<JsonWorkbenchState> : {};
  return {
    projects: Array.isArray(state.projects) ? state.projects : [],
    briefs: Array.isArray(state.briefs) ? state.briefs : [],
    pageVersions: Array.isArray(state.pageVersions) ? state.pageVersions : [],
    deployments: Array.isArray(state.deployments) ? state.deployments : [],
    tasks: Array.isArray(state.tasks) ? state.tasks : [],
    messages: Array.isArray(state.messages) ? state.messages : [],
    taskSnapshots: Array.isArray(state.taskSnapshots) ? state.taskSnapshots : []
  };
}

function createEmptyState(): JsonWorkbenchState {
  return {
    projects: [],
    briefs: [],
    pageVersions: [],
    deployments: [],
    tasks: [],
    messages: [],
    taskSnapshots: []
  };
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
```

- [ ] **Step 4: Export the JSON adapter**

Update `packages/db/src/index.ts`:

```ts
export * from "./workbench-repositories";
export * from "./json-file-workbench-repositories";
```

- [ ] **Step 5: Run DB tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/db test
pnpm --filter @lp-agent/db typecheck
```

Expected: both commands PASS.

- [ ] **Step 6: Commit the JSON repository adapter**

Run:

```bash
git add packages/db/src/index.ts packages/db/src/json-file-workbench-repositories.ts packages/db/src/json-file-workbench-repositories.test.ts
git commit -m "feat: add json workbench repositories"
```

## Task 3: Make API Snapshot Loading and IDs Repository-Aware

**Files:**
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/services.test.ts`

- [ ] **Step 1: Add failing API tests for reload-safe IDs and explicit snapshots**

Append these tests to `packages/api/src/services.test.ts`:

```ts
it("allocates the next project id from existing repository records", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  await repositories.projects.save({
    id: "project_7",
    name: "Existing project",
    createdAt: "2026-05-12T00:00:00.000Z"
  });

  const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
  const project = await service.createProject({ name: "Next project" });

  expect(project).toMatchObject({
    id: "project_8",
    name: "Next project"
  });
});

it("loads a snapshot from explicit brief and page version ids", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
  const project = await service.createProject({ name: "Project" });
  const firstBrief = await service.createBriefFromPrompt({
    projectId: project.id,
    prompt: "First LP"
  });
  const firstVersion = await service.generatePageVersion({
    projectId: project.id,
    briefId: firstBrief.id
  });
  const secondBrief = await service.createBriefFromPrompt({
    projectId: project.id,
    prompt: "Second LP"
  });
  await service.generatePageVersion({
    projectId: project.id,
    briefId: secondBrief.id
  });

  const snapshot = await service.getSnapshotForRecords({
    projectId: project.id,
    briefId: firstBrief.id,
    pageVersionId: firstVersion.id
  });

  expect(snapshot.brief?.prompt).toBe("First LP");
  expect(snapshot.currentPageVersion?.id).toBe(firstVersion.id);
});
```

- [ ] **Step 2: Run API tests and verify they fail**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: FAIL because project IDs still use private counters and `getSnapshotForRecords` does not exist.

- [ ] **Step 3: Replace private sequence counters with repository-derived IDs**

In `packages/api/src/index.ts`, remove these class fields:

```ts
private projectSequence = 0;
private briefSequence = 0;
private pageVersionSequence = 0;
```

Add this helper near the bottom of the file:

```ts
function nextSequentialId(prefix: string, existingIds: string[]): string {
  const nextNumber =
    existingIds.reduce((largest, id) => {
      const match = new RegExp(`^${prefix}_(\\d+)$`).exec(id);
      return match ? Math.max(largest, Number(match[1])) : largest;
    }, 0) + 1;
  return `${prefix}_${nextNumber}`;
}
```

Update `createProject`:

```ts
async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
  const existingProjects = await this.repositories.projects.listAll();
  const project: ProjectRecord = {
    id: nextSequentialId("project", existingProjects.map((record) => record.id)),
    name: input.name,
    createdAt: this.timestamp()
  };
  await this.repositories.projects.save(project);
  return copyProject(project);
}
```

Update `createBriefFromPrompt`:

```ts
async createBriefFromPrompt(input: CreateBriefFromPromptInput): Promise<BriefRecord> {
  await this.getProjectOrThrow(input.projectId);

  const existingBriefs = await this.repositories.briefs.listAll();
  const brief: BriefRecord = {
    id: nextSequentialId("brief", existingBriefs.map((record) => record.id)),
    projectId: input.projectId,
    prompt: input.prompt,
    brief: copyBrief(sampleBrief),
    createdAt: this.timestamp()
  };
  await this.repositories.briefs.save(brief);
  return copyBriefRecord(brief);
}
```

Update `generatePageVersion` before creating `runId`:

```ts
const existingPageVersions = await this.repositories.pageVersions.listAll();
const pageVersionId = nextSequentialId(
  "version",
  existingPageVersions.map((record) => record.id)
);
const runId = `run_builder_${pageVersionId.replace("version_", "")}`;
```

Then use `pageVersionId` in the record:

```ts
const pageVersion: PageVersionRecord = {
  id: pageVersionId,
  projectId: input.projectId,
  briefId: brief.id,
  artifacts: copyArtifacts(result.artifacts),
  reviewStatus: "pending",
  findings: [],
  createdAt: this.timestamp()
};
```

- [ ] **Step 4: Add explicit snapshot loading**

Add this input interface near `ReviewPageVersionInput`:

```ts
export interface GetSnapshotForRecordsInput {
  projectId: string;
  briefId?: string;
  pageVersionId?: string;
}
```

Add this method to `DemoWorkbenchService` after `getSnapshot`:

```ts
async getSnapshotForRecords(input: GetSnapshotForRecordsInput): Promise<WorkbenchSnapshot> {
  const project = await this.getProjectOrThrow(input.projectId);
  const currentPageVersion = input.pageVersionId
    ? await this.getPageVersionForProjectOrThrow(input.projectId, input.pageVersionId)
    : await this.repositories.pageVersions.findLatestForProject(input.projectId);
  const brief = input.briefId
    ? await this.getBriefForProjectOrThrow(input.projectId, input.briefId)
    : currentPageVersion
      ? await this.repositories.briefs.getById(currentPageVersion.briefId)
      : await this.repositories.briefs.findLatestForProject(input.projectId);
  const deployment = currentPageVersion
    ? await this.repositories.deployments.getByPageVersionId(currentPageVersion.id)
    : await this.repositories.deployments.findLatestForProject(input.projectId);

  return {
    project: copyProject(project),
    brief: brief ? copyBriefRecord(brief) : undefined,
    currentPageVersion: currentPageVersion ? copyPageVersion(currentPageVersion) : undefined,
    deployment: deployment ? copyDeployment(deployment) : undefined
  };
}
```

- [ ] **Step 5: Run API tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/api test
pnpm --filter @lp-agent/api typecheck
```

Expected: both commands PASS.

- [ ] **Step 6: Commit API repository-awareness**

Run:

```bash
git add packages/api/src/index.ts packages/api/src/services.test.ts
git commit -m "feat: load workbench snapshots by record ids"
```

## Task 4: Migrate the Web Store to Repositories

**Files:**
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`

- [ ] **Step 1: Add failing Web store tests for shared repositories**

Add imports to `apps/web/src/lib/workbench-store.test.ts`:

```ts
import { createInMemoryWorkbenchRepositories } from "@lp-agent/db";
```

Append this test:

```ts
it("reopens projects, tasks, messages, and LP snapshots from shared repositories", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const firstStore = createWebWorkbenchStore({ repositories });

  const result = await firstStore.submitTaskPrompt({
    prompt: "Create a spring ecommerce landing page.",
    implicitProjectName: "Untitled LP Project"
  });

  expect(result).toEqual({
    ok: true,
    taskId: "task_1",
    taskType: "lp_generation",
    projectId: "project_1"
  });

  const secondStore = createWebWorkbenchStore({ repositories });
  const pageState = await secondStore.getPageState({
    projectId: "project_1",
    taskId: "task_1"
  });

  expect(pageState.kind).toBe("task_ready");
  if (pageState.kind !== "task_ready") {
    throw new Error("Expected task-ready state.");
  }
  expect(pageState.projects.map((project) => project.id)).toEqual(["project_1"]);
  expect(pageState.tasks.map((task) => task.id)).toEqual(["task_1"]);
  expect(pageState.messages.map((message) => message.id)).toEqual(["message_1", "message_2"]);
  expect(pageState.snapshot?.brief?.prompt).toBe("Create a spring ecommerce landing page.");
  expect(pageState.snapshot?.currentPageVersion?.id).toBe("version_1");
});

it("allocates task and message ids from existing repository records", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  await repositories.tasks.save({
    id: "task_4",
    title: "Existing task",
    type: "general_chat",
    status: "complete",
    createdAt: "2026-05-13T00:00:00.000Z"
  });
  await repositories.messages.save({
    id: "message_9",
    taskId: "task_4",
    role: "user",
    content: "Existing message",
    createdAt: "2026-05-13T00:00:00.000Z"
  });

  const store = createWebWorkbenchStore({ repositories });
  const result = await store.submitTaskPrompt({
    prompt: "Help me write a campaign plan.",
    implicitProjectName: "Untitled LP Project"
  });

  expect(result).toEqual({
    ok: true,
    taskId: "task_5",
    taskType: "general_chat",
    projectId: undefined
  });
  const state = await store.getPageState({ taskId: "task_5" });
  expect(state.kind).toBe("task_ready");
  if (state.kind !== "task_ready") {
    throw new Error("Expected task-ready state.");
  }
  expect(state.messages.map((message) => message.id)).toEqual(["message_10", "message_11"]);
});
```

- [ ] **Step 2: Run Web store tests and verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts
```

Expected: FAIL because `createWebWorkbenchStore` does not accept repositories and still owns local maps.

- [ ] **Step 3: Update imports and public types**

In `apps/web/src/lib/workbench-store.ts`, update the `@lp-agent/api` import so the store can construct the service with shared repositories:

```ts
import {
  DemoWorkbenchService,
  type ProjectRecord,
  type WorkbenchSnapshot
} from "@lp-agent/api";
```

Then replace local task/message type declarations with imports from `@lp-agent/db`:

```ts
import {
  createInMemoryWorkbenchRepositories,
  createJsonFileWorkbenchRepositories,
  type WorkbenchMessageRecord as ChatMessageRecord,
  type WorkbenchMessageRole as ChatMessageRole,
  type WorkbenchRepositories,
  type WorkbenchTaskRecord as TaskRecord,
  type WorkbenchTaskStatus as TaskStatus,
  type WorkbenchTaskType as TaskType
} from "@lp-agent/db";
```

Keep these type exports for existing Web imports:

```ts
export type {
  ChatMessageRecord,
  ChatMessageRole,
  TaskRecord,
  TaskStatus,
  TaskType
};
```

Add options for the store factory:

```ts
export interface WebWorkbenchStoreOptions {
  repositories?: WorkbenchRepositories;
}
```

- [ ] **Step 4: Add ID and repository helpers**

Add these helpers above `createWebWorkbenchStore`:

```ts
function nextSequentialId(prefix: string, existingIds: string[]): string {
  const nextNumber =
    existingIds.reduce((largest, id) => {
      const match = new RegExp(`^${prefix}_(\\d+)$`).exec(id);
      return match ? Math.max(largest, Number(match[1])) : largest;
    }, 0) + 1;
  return `${prefix}_${nextNumber}`;
}

function copyProjects(projects: ProjectRecord[]): ProjectRecord[] {
  return projects.map((project) => ({ ...project }));
}

function copyTasks(tasks: TaskRecord[]): TaskRecord[] {
  return tasks.map((task) => ({ ...task }));
}

function copyMessages(messages: ChatMessageRecord[]): ChatMessageRecord[] {
  return messages.map((message) => ({ ...message }));
}
```

- [ ] **Step 5: Replace Web store maps with repository calls**

Change the factory signature and setup:

```ts
export function createWebWorkbenchStore(options: WebWorkbenchStoreOptions = {}): WebWorkbenchStore {
  const repositories = options.repositories ?? createInMemoryWorkbenchRepositories();
  const service = new DemoWorkbenchService({ repositories });
```

Remove these local variables:

```ts
const projects = new Map<string, ProjectRecord>();
const projectOrder: string[] = [];
const tasks = new Map<string, TaskRecord>();
const taskOrder: string[] = [];
const messages = new Map<string, ChatMessageRecord[]>();
const snapshotsByTask = new Map<string, WorkbenchSnapshot>();
let nextTaskNumber = 1;
let nextMessageNumber = 1;
```

Replace the local list helpers:

```ts
const listProjects = async () => copyProjects(await repositories.projects.listAll());
const listTasks = async () => copyTasks(await repositories.tasks.listAll());
const listMessages = async (taskId: string) =>
  copyMessages(await repositories.messages.listForTask(taskId));
```

Update the `WebWorkbenchStore` interface so list methods are async:

```ts
listProjects(): Promise<ProjectRecord[]>;
listTasks(): Promise<TaskRecord[]>;
```

Update the returned methods:

```ts
listProjects,
listTasks,
```

Update `createProject`:

```ts
async createProject(input) {
  const validation = validateProjectInput(input);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const project = await service.createProject(validation.value);
  return { ...project };
}
```

Update `getPageState`:

```ts
async getPageState(input) {
  const currentProjects = await listProjects();
  const currentTasks = await listTasks();
  const taskId = input?.taskId ?? null;
  const task = taskId ? await repositories.tasks.getById(taskId) : undefined;
  const requestedProjectId = input?.projectId ?? null;

  if (
    !task ||
    (task.projectId && !currentProjects.some((project) => project.id === task.projectId)) ||
    (task.projectId && requestedProjectId && requestedProjectId !== task.projectId)
  ) {
    return {
      kind: "empty",
      projects: currentProjects,
      tasks: currentTasks
    };
  }

  const snapshotRef = await repositories.taskSnapshots.getByTaskId(task.id);
  const snapshot = snapshotRef
    ? await service.getSnapshotForRecords({
        projectId: snapshotRef.projectId,
        briefId: snapshotRef.briefId,
        pageVersionId: snapshotRef.pageVersionId
      })
    : undefined;

  return {
    kind: "task_ready",
    projects: currentProjects,
    tasks: currentTasks,
    activeTaskId: task.id,
    task: { ...task },
    messages: await listMessages(task.id),
    snapshot
  };
}
```

Update `submitTaskPrompt` to use repository reads/writes:

```ts
async submitTaskPrompt(input) {
  const prompt = validatePromptInput(input.prompt);
  if (!prompt.ok) {
    return { ok: false, error: prompt.error };
  }

  const taskType = classifyTaskPrompt(prompt.value);
  const requestedProjectId = input.projectId ?? undefined;
  if (requestedProjectId && !(await repositories.projects.getById(requestedProjectId))) {
    return { ok: false, error: "project_not_found" };
  }

  try {
    let projectId = requestedProjectId;
    let snapshotRef:
      | {
          projectId: string;
          briefId: string;
          pageVersionId: string;
        }
      | undefined;

    if (!projectId && taskType === "lp_generation") {
      const project = await service.createProject({
        name: deriveImplicitProjectName(prompt.value, input.implicitProjectName)
      });
      projectId = project.id;
    }

    if (taskType === "lp_generation" && projectId) {
      const brief = await service.createBriefFromPrompt({
        projectId,
        prompt: prompt.value
      });
      const pageVersion = await service.generatePageVersion({
        projectId,
        briefId: brief.id
      });
      const reviewedPageVersion = await service.reviewPageVersion({
        projectId,
        pageVersionId: pageVersion.id
      });
      snapshotRef = {
        projectId,
        briefId: brief.id,
        pageVersionId: reviewedPageVersion.id
      };
    }

    const existingTasks = await repositories.tasks.listAll();
    const existingMessages = await repositories.messages.listAll();
    const task: TaskRecord = {
      id: nextSequentialId("task", existingTasks.map((record) => record.id)),
      title: deriveTaskTitle(prompt.value),
      type: taskType,
      status: "complete",
      projectId,
      createdAt: new Date().toISOString()
    };
    await repositories.tasks.save(task);

    const userMessageId = nextSequentialId("message", existingMessages.map((record) => record.id));
    await repositories.messages.save({
      id: userMessageId,
      taskId: task.id,
      role: "user",
      content: prompt.value,
      createdAt: new Date().toISOString()
    });
    await repositories.messages.save({
      id: nextSequentialId("message", [...existingMessages.map((record) => record.id), userMessageId]),
      taskId: task.id,
      role: "assistant",
      content:
        taskType === "lp_generation"
          ? "LP artifacts are ready for review."
          : "I created a task thread and can continue from here.",
      createdAt: new Date().toISOString()
    });

    if (snapshotRef) {
      await repositories.taskSnapshots.save({
        taskId: task.id,
        projectId: snapshotRef.projectId,
        briefId: snapshotRef.briefId,
        pageVersionId: snapshotRef.pageVersionId,
        createdAt: new Date().toISOString()
      });
    }

    return {
      ok: true,
      taskId: task.id,
      taskType,
      projectId
    };
  } catch {
    return { ok: false, error: "generation_failed" };
  }
}
```

- [ ] **Step 6: Add a JSON-backed default store**

At the bottom of `apps/web/src/lib/workbench-store.ts`, replace the global store setup with:

```ts
const DEFAULT_STATE_FILE = ".lp-agent/workbench-state.json";

const globalStore = globalThis as typeof globalThis & {
  __lpAgentWebWorkbenchStore?: WebWorkbenchStore;
  __lpAgentWebWorkbenchRepositories?: WorkbenchRepositories;
};

function getDefaultWorkbenchRepositories(): WorkbenchRepositories {
  globalStore.__lpAgentWebWorkbenchRepositories ??= createJsonFileWorkbenchRepositories({
    filePath: process.env.LP_AGENT_WORKBENCH_STATE_FILE ?? DEFAULT_STATE_FILE
  });
  return globalStore.__lpAgentWebWorkbenchRepositories;
}

export function getWebWorkbenchStore(): WebWorkbenchStore {
  globalStore.__lpAgentWebWorkbenchStore ??= createWebWorkbenchStore({
    repositories: getDefaultWorkbenchRepositories()
  });
  return globalStore.__lpAgentWebWorkbenchStore;
}
```

- [ ] **Step 7: Update tests for async list methods**

In `apps/web/src/lib/workbench-store.test.ts`, replace direct list calls:

```ts
expect(store.listProjects().map((project) => project.id)).toEqual([
  "project_1",
  "project_2"
]);
```

with:

```ts
await expect(store.listProjects()).resolves.toEqual([
  expect.objectContaining({ id: "project_1" }),
  expect.objectContaining({ id: "project_2" })
]);
```

Apply the same `await` pattern to every direct `listProjects()` or `listTasks()` call.

- [ ] **Step 8: Run Web store tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Web store migration**

Run:

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts
git commit -m "feat: persist web workbench state through repositories"
```

## Task 5: Update Local State Copy and Git Ignore

**Files:**
- Modify: `.gitignore`
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`

- [ ] **Step 1: Add failing i18n assertions for local file persistence copy**

In `apps/web/src/lib/i18n.test.ts`, update the localized labels test to assert the new local persistence text:

```ts
expect(en.projectFlow.localPersistenceNote).toBe(
  "Local Web MVP state is saved on this machine under .lp-agent/."
);
expect(zh.projectFlow.localPersistenceNote).toBe(
  "Web MVP 状态会保存在这台电脑的 .lp-agent/ 本地状态目录中。"
);
```

- [ ] **Step 2: Run i18n tests and verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts
```

Expected: FAIL because the copy still says state only lives for the dev-server process.

- [ ] **Step 3: Update localized copy**

In `apps/web/src/lib/i18n.ts`, set English copy:

```ts
localPersistenceNote: "Local Web MVP state is saved on this machine under .lp-agent/.",
```

Set Chinese copy:

```ts
localPersistenceNote: "Web MVP 状态会保存在这台电脑的 .lp-agent/ 本地状态目录中。",
```

- [ ] **Step 4: Ignore local state files**

Add this line to `.gitignore`:

```text
.lp-agent/
```

- [ ] **Step 5: Run i18n tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit copy and ignore updates**

Run:

```bash
git add .gitignore apps/web/src/lib/i18n.ts apps/web/src/lib/i18n.test.ts
git commit -m "chore: document local workbench state files"
```

## Task 6: Final Verification and Documentation

**Files:**
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Confirm Superpowers index includes this spec and plan**

In `docs/superpowers/README.md`, make sure the reading order includes:

```markdown
13. `specs/2026-05-13-web-workbench-persistent-state-spec.md`
    - Web workbench persistence amendment.
    - Read this after the conversation-first plan when moving Web projects, task threads, messages, and LP snapshot bindings out of process-local Web maps.

14. `plans/2026-05-13-web-workbench-persistent-state.md`
    - Implementation plan for repository-backed local Web workbench state.
    - Read this after the persistent-state spec when implementing or auditing local JSON-backed workbench state and repository-based Web task rendering.
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @lp-agent/db test
pnpm --filter @lp-agent/api test
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/lib/i18n.test.ts
```

Expected: all commands PASS.

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: all commands PASS.

- [ ] **Step 4: Check Git status**

Run:

```bash
git status --short
```

Expected: only intentional tracked changes are present. Existing unrelated untracked screenshot files may still be present and should not be added.

- [ ] **Step 5: Commit documentation and final state**

Run:

```bash
git add docs/superpowers/README.md docs/superpowers/specs/2026-05-13-web-workbench-persistent-state-spec.md docs/superpowers/plans/2026-05-13-web-workbench-persistent-state.md
git commit -m "docs: plan web workbench persistence"
```

If implementation commits already included the README update, skip this commit and keep the docs in the relevant implementation commit.

## Self-Review

- Spec coverage: the tasks cover repository contracts, local JSON persistence, reload-safe IDs, task-specific snapshots, Web store migration, localized copy, gitignore, documentation, and verification.
- Placeholder scan: the plan names exact files, exact record types, exact commands, expected outcomes, and concrete copy text.
- Type consistency: `WorkbenchTaskRecord`, `WorkbenchMessageRecord`, and `WorkbenchTaskSnapshotRecord` are defined in `@lp-agent/db`; Web imports alias them back to the existing Web-facing task/message type names.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-13-web-workbench-persistent-state.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, faster iteration.
2. **Inline Execution** - execute tasks in this session using `superpowers:executing-plans`, with checkpoints.
