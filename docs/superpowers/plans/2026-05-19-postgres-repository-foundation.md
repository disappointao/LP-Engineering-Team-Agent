# Postgres Repository Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Prisma/Postgres repository foundation that matches the core `WorkbenchRepositories` contract without changing the default local JSON-file backend.

**Architecture:** Keep service/API code dependent on `WorkbenchRepositories`; add Prisma as a third backend inside `packages/db`. First align `schema.prisma`, then add shared contract tests, mapper tests, a Prisma-backed repository factory with explicit `workspaceId`, opt-in Postgres integration coverage, and documentation updates.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Prisma schema validation, optional `@prisma/client` integration tests, existing `@lp-agent/db` repository contracts.

---

## File Structure

- Modify `packages/db/prisma/schema.prisma`
  - Add missing workbench tables and align existing Prisma models with repository contract fields.
- Create `packages/db/src/prisma-schema-contract.test.ts`
  - Fast schema text test that fails when required Stage 22 models/fields disappear.
- Create `packages/db/src/workbench-repository-contract.ts`
  - Shared behavior tests for the Stage 22 repository subset.
- Modify `packages/db/src/workbench-repositories.test.ts`
  - Run shared contract tests against `createInMemoryWorkbenchRepositories()`.
- Modify `packages/db/src/json-file-workbench-repositories.test.ts`
  - Run shared contract tests against a temporary JSON-file repository.
- Create `packages/db/src/prisma-workbench-mappers.ts`
  - Pure mapper helpers between Prisma-shaped rows and repository records.
- Create `packages/db/src/prisma-workbench-mappers.test.ts`
  - Unit tests for JSON fields, dates, optional fields, artifact refs, ordering fields, and workspace mapping.
- Create `packages/db/src/prisma-workbench-repositories.ts`
  - Prisma/Postgres repository implementation and `createPrismaWorkbenchRepositories({ prisma, workspaceId })`.
- Create `packages/db/src/prisma-workbench-repositories.test.ts`
  - Repository tests with a fake Prisma client; no real database required.
- Create `packages/db/src/prisma-workbench-repositories.integration.test.ts`
  - Opt-in integration test skipped unless `POSTGRES_REPOSITORY_TEST=1` and `DATABASE_URL` are set.
- Modify `packages/db/src/index.ts`
  - Export Prisma repository factory and mapper types only after tests pass.
- Modify `packages/db/package.json` and `pnpm-lock.yaml` if `@prisma/client` is needed for opt-in integration tests.
- Modify `docs/project-roadmap.md`, `docs/agent-development-learning.md`, `docs/superpowers/README.md`
  - Mark Stage 22 plan as confirmed and keep reading order accurate.

---

### Task 1: Prisma Schema Contract and Schema Alignment

**Files:**
- Create: `packages/db/src/prisma-schema-contract.test.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Possibly modify: `packages/db/package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Write the failing schema contract test**

Create `packages/db/src/prisma-schema-contract.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const schemaPath = join(process.cwd(), "packages/db/prisma/schema.prisma");

describe("Prisma workbench schema contract", () => {
  it("contains Stage 22 workbench repository models and fields", async () => {
    const schema = await readFile(schemaPath, "utf8");

    for (const model of [
      "WorkbenchTask",
      "WorkbenchMessage",
      "WorkbenchTaskSnapshot",
      "ArtifactWorkspace",
      "ArtifactWorkspaceFile",
      "AgentHandoff"
    ]) {
      expect(schema).toContain(`model ${model} `);
    }

    for (const field of [
      "taskId",
      "startedAt",
      "completedAt",
      "contextSummary",
      "message",
      "artifactWorkspaceId",
      "findings",
      "prompt",
      "artifactRefs"
    ]) {
      expect(schema).toContain(field);
    }

    expect(schema).toContain("@@unique([runId, sequence])");
    expect(schema).toContain("@@unique([workspaceId, path])");
  });
});
```

- [ ] **Step 2: Run the schema contract test to verify it fails**

Run:

```bash
pnpm exec vitest run packages/db/src/prisma-schema-contract.test.ts
```

Expected: FAIL because `WorkbenchTask`, `WorkbenchMessage`, `WorkbenchTaskSnapshot`, `ArtifactWorkspace`, `ArtifactWorkspaceFile`, `AgentHandoff`, and several fields are missing from `schema.prisma`.

- [ ] **Step 3: Align Prisma schema with the Stage 22 contract**

Edit `packages/db/prisma/schema.prisma`.

Add these relations to `model Project`:

```prisma
  tasks                  WorkbenchTask[]
  messages               WorkbenchMessage[]
  taskSnapshots          WorkbenchTaskSnapshot[]
  runEvents              RunEvent[]
  artifactWorkspaces     ArtifactWorkspace[]
  artifactWorkspaceFiles ArtifactWorkspaceFile[]
  agentHandoffs          AgentHandoff[]
```

Update `model LPBrief` to include prompt:

```prisma
  prompt    String
  taskSnapshots WorkbenchTaskSnapshot[]
```

Update `model PageVersion` to include artifact workspace and findings:

```prisma
  artifactWorkspaceId String?
  findings            Json
  taskSnapshots       WorkbenchTaskSnapshot[]
  artifactWorkspaces  ArtifactWorkspace[]
  artifactWorkspaceFiles ArtifactWorkspaceFile[]
```

Replace the current `model Run` with:

```prisma
model Run {
  id               String     @id
  projectId        String
  taskId           String?
  role             String
  state            RunState
  startedAt        DateTime
  completedAt      DateTime?
  contextSummary   Json
  project          Project    @relation(fields: [projectId], references: [id])
  events           RunEvent[]
  toolObservations ToolObservation[]
  outboundHandoffs AgentHandoff[] @relation("AgentHandoffFromRun")
  createdAt        DateTime   @default(now())
  updatedAt        DateTime   @updatedAt

  @@index([projectId])
  @@index([taskId])
  @@index([state])
  @@index([startedAt])
}
```

Replace the current `model RunEvent` with:

```prisma
model RunEvent {
  id        String   @id
  runId     String
  projectId String
  taskId    String?
  sequence  Int
  type      String
  message   String
  payload   Json
  run       Run      @relation(fields: [runId], references: [id])
  project   Project  @relation(fields: [projectId], references: [id])
  createdAt DateTime

  @@unique([runId, sequence])
  @@index([runId, type])
  @@index([projectId])
  @@index([taskId])
  @@index([createdAt])
}
```

Add these models after `PageVersion`:

```prisma
model WorkbenchTask {
  id        String   @id
  title     String
  type      String
  status    String
  projectId String?
  project   Project? @relation(fields: [projectId], references: [id])
  messages  WorkbenchMessage[]
  snapshot  WorkbenchTaskSnapshot?
  createdAt DateTime

  @@index([projectId])
  @@index([createdAt])
}

model WorkbenchMessage {
  id        String   @id
  taskId    String
  projectId String?
  role      String
  content   String
  task      WorkbenchTask @relation(fields: [taskId], references: [id])
  project   Project? @relation(fields: [projectId], references: [id])
  createdAt DateTime

  @@index([taskId, createdAt])
  @@index([projectId])
}

model WorkbenchTaskSnapshot {
  taskId        String   @id
  projectId     String
  briefId       String?
  pageVersionId String?
  task          WorkbenchTask @relation(fields: [taskId], references: [id])
  project       Project @relation(fields: [projectId], references: [id])
  brief         LPBrief? @relation(fields: [briefId], references: [id])
  pageVersion   PageVersion? @relation(fields: [pageVersionId], references: [id])
  createdAt     DateTime

  @@index([projectId])
  @@index([briefId])
  @@index([pageVersionId])
}

model ArtifactWorkspace {
  id            String   @id
  projectId     String
  pageVersionId String?
  runId         String?
  kind          String
  state         String
  project       Project @relation(fields: [projectId], references: [id])
  pageVersion   PageVersion? @relation(fields: [pageVersionId], references: [id])
  files         ArtifactWorkspaceFile[]
  createdAt     DateTime
  updatedAt     DateTime

  @@index([projectId, createdAt])
  @@index([pageVersionId])
  @@index([runId])
}

model ArtifactWorkspaceFile {
  id            String   @id
  workspaceId   String
  projectId     String
  pageVersionId String?
  path          String
  kind          String
  mimeType      String
  sizeBytes     Int
  sha256        String
  summary       String
  content       String
  workspace     ArtifactWorkspace @relation(fields: [workspaceId], references: [id])
  project       Project @relation(fields: [projectId], references: [id])
  pageVersion   PageVersion? @relation(fields: [pageVersionId], references: [id])
  createdAt     DateTime
  updatedAt     DateTime

  @@unique([workspaceId, path])
  @@index([projectId])
  @@index([pageVersionId])
}
```

Add this model after `ToolObservation`:

```prisma
model AgentHandoff {
  id             String   @id
  projectId      String
  taskId         String?
  fromRunId      String
  fromRole       String
  toRole         String
  state          String
  summary        String
  blockingReason String?
  artifactRefs   Json?
  project        Project @relation(fields: [projectId], references: [id])
  fromRun        Run @relation("AgentHandoffFromRun", fields: [fromRunId], references: [id])
  createdAt      DateTime
  updatedAt      DateTime

  @@index([projectId, updatedAt])
  @@index([taskId])
  @@index([fromRunId])
  @@index([toRole])
  @@index([fromRole])
  @@index([state])
}
```

Update `model ToolObservation` so `createdAt` is not default-only and can preserve repository timestamps:

```prisma
  createdAt     DateTime
```

- [ ] **Step 4: Validate schema and test**

Run:

```bash
pnpm exec vitest run packages/db/src/prisma-schema-contract.test.ts
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm --filter @lp-agent/db db:validate
```

Expected: PASS. `prisma validate` must not require a live database connection.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/src/prisma-schema-contract.test.ts
git commit -m "align prisma workbench schema"
```

---

### Task 2: Shared Repository Contract Tests

**Files:**
- Create: `packages/db/src/workbench-repository-contract.ts`
- Modify: `packages/db/src/workbench-repositories.test.ts`
- Modify: `packages/db/src/json-file-workbench-repositories.test.ts`

- [ ] **Step 1: Create the shared contract helper**

Create `packages/db/src/workbench-repository-contract.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { StaticArtifacts } from "@lp-agent/artifacts";
import { sampleBrief } from "@lp-agent/lp-schema";
import type { WorkbenchRepositories } from "./workbench-repositories";

const createdAt = "2026-05-19T00:00:00.000Z";
const updatedAt = "2026-05-19T00:00:01.000Z";

export interface RepositoryContractInput {
  name: string;
  createRepositories: () => Promise<WorkbenchRepositories> | WorkbenchRepositories;
}

export function runCoreWorkbenchRepositoryContractTests(input: RepositoryContractInput): void {
  describe(`${input.name} core workbench repository contract`, () => {
    it("persists project, task, message, and task snapshot records", async () => {
      const repositories = await input.createRepositories();

      await repositories.projects.save({ id: "project_1", name: "Project", createdAt });
      await repositories.tasks.save({
        id: "task_1",
        title: "Create LP",
        type: "lp_generation",
        status: "complete",
        projectId: "project_1",
        createdAt
      });
      await repositories.messages.save({
        id: "message_2",
        taskId: "task_1",
        role: "assistant",
        content: "Done",
        createdAt: updatedAt
      });
      await repositories.messages.save({
        id: "message_1",
        taskId: "task_1",
        role: "user",
        content: "Build a page",
        createdAt
      });
      await repositories.taskSnapshots.save({
        taskId: "task_1",
        projectId: "project_1",
        briefId: "brief_1",
        pageVersionId: "version_1",
        createdAt
      });

      await expect(repositories.projects.getById("project_1")).resolves.toEqual({
        id: "project_1",
        name: "Project",
        createdAt
      });
      await expect(repositories.tasks.listAll()).resolves.toEqual([
        {
          id: "task_1",
          title: "Create LP",
          type: "lp_generation",
          status: "complete",
          projectId: "project_1",
          createdAt
        }
      ]);
      await expect(repositories.messages.listForTask("task_1")).resolves.toEqual([
        {
          id: "message_1",
          taskId: "task_1",
          role: "user",
          content: "Build a page",
          createdAt
        },
        {
          id: "message_2",
          taskId: "task_1",
          role: "assistant",
          content: "Done",
          createdAt: updatedAt
        }
      ]);
      await expect(repositories.taskSnapshots.getByTaskId("task_1")).resolves.toEqual({
        taskId: "task_1",
        projectId: "project_1",
        briefId: "brief_1",
        pageVersionId: "version_1",
        createdAt
      });
    });

    it("persists run timeline, tool observations, and handoffs with scoped ordering", async () => {
      const repositories = await input.createRepositories();

      await repositories.projects.save({ id: "project_1", name: "Project", createdAt });
      await repositories.runs.save({
        id: "run_1",
        projectId: "project_1",
        taskId: "task_1",
        role: "planner",
        state: "completed",
        startedAt: createdAt,
        completedAt: updatedAt,
        contextSummary: {
          injected: ["task.input"],
          omitted: ["secret.raw"]
        }
      });
      await repositories.runEvents.save({
        id: "run_1_event_2",
        runId: "run_1",
        projectId: "project_1",
        taskId: "task_1",
        sequence: 2,
        type: "run.completed",
        message: "planner completed",
        payload: { state: "completed" },
        createdAt: updatedAt
      });
      await repositories.runEvents.save({
        id: "run_1_event_1",
        runId: "run_1",
        projectId: "project_1",
        taskId: "task_1",
        sequence: 1,
        type: "run.started",
        message: "planner started",
        payload: { role: "planner" },
        createdAt
      });
      await repositories.toolObservations.save({
        id: "tool_observation_1",
        runId: "run_1",
        projectId: "project_1",
        taskId: "task_1",
        toolName: "mcp:read.catalog",
        input: { connectorId: "connector_1" },
        outputSummary: "Read 3 records.",
        state: "completed",
        exitCode: 0,
        createdAt,
        completedAt: updatedAt
      });
      await repositories.agentHandoffs.save({
        id: "handoff_1",
        projectId: "project_1",
        taskId: "task_1",
        fromRunId: "run_1",
        fromRole: "planner",
        toRole: "builder",
        state: "ready",
        summary: "Planner produced a brief.",
        artifactRefs: { briefId: "brief_1" },
        createdAt,
        updatedAt
      });

      await expect(repositories.runs.listForTask("task_1")).resolves.toEqual([
        {
          id: "run_1",
          projectId: "project_1",
          taskId: "task_1",
          role: "planner",
          state: "completed",
          startedAt: createdAt,
          completedAt: updatedAt,
          contextSummary: {
            injected: ["task.input"],
            omitted: ["secret.raw"]
          }
        }
      ]);
      await expect(repositories.runEvents.listForRun("run_1")).resolves.toEqual([
        expect.objectContaining({ id: "run_1_event_1", sequence: 1 }),
        expect.objectContaining({ id: "run_1_event_2", sequence: 2 })
      ]);
      await expect(repositories.toolObservations.listForTask("task_1")).resolves.toEqual([
        expect.objectContaining({ id: "tool_observation_1", state: "completed" })
      ]);
      await expect(
        repositories.agentHandoffs.listInbound({
          projectId: "project_1",
          taskId: "task_1",
          toRole: "builder"
        })
      ).resolves.toEqual([expect.objectContaining({ id: "handoff_1" })]);
    });

    it("persists briefs, page versions, artifact workspaces, and artifact files", async () => {
      const repositories = await input.createRepositories();
      const artifacts: StaticArtifacts = {
        indexHtml: "<!doctype html><html></html>",
        stylesCss: "body { margin: 0; }",
        scriptJs: "window.lpAgent = true;"
      };

      await repositories.projects.save({ id: "project_1", name: "Project", createdAt });
      await repositories.briefs.save({
        id: "brief_1",
        projectId: "project_1",
        prompt: "Create LP",
        brief: sampleBrief,
        createdAt
      });
      await repositories.pageVersions.save({
        id: "version_1",
        projectId: "project_1",
        briefId: "brief_1",
        artifactWorkspaceId: "workspace_1",
        artifacts,
        reviewStatus: "passed",
        findings: [],
        createdAt
      });
      await repositories.artifactWorkspaces.save({
        id: "workspace_1",
        projectId: "project_1",
        pageVersionId: "version_1",
        runId: "run_1",
        kind: "static_lp",
        state: "active",
        createdAt,
        updatedAt
      });
      await repositories.artifactWorkspaceFiles.save({
        id: "workspace_1_file_index_html",
        workspaceId: "workspace_1",
        projectId: "project_1",
        pageVersionId: "version_1",
        path: "index.html",
        kind: "html",
        mimeType: "text/html",
        sizeBytes: artifacts.indexHtml.length,
        sha256: "sha-index",
        summary: "index file",
        content: artifacts.indexHtml,
        createdAt,
        updatedAt
      });

      await expect(repositories.briefs.findLatestForProject("project_1")).resolves.toMatchObject({
        id: "brief_1",
        prompt: "Create LP"
      });
      await expect(repositories.pageVersions.findLatestForProject("project_1")).resolves.toMatchObject({
        id: "version_1",
        artifactWorkspaceId: "workspace_1",
        artifacts
      });
      await expect(repositories.artifactWorkspaces.getForPageVersion("version_1"))
        .resolves.toMatchObject({ id: "workspace_1", state: "active" });
      await expect(
        repositories.artifactWorkspaceFiles.getByPath({
          workspaceId: "workspace_1",
          path: "index.html"
        })
      ).resolves.toMatchObject({
        id: "workspace_1_file_index_html",
        content: artifacts.indexHtml
      });
    });
  });
}
```

- [ ] **Step 2: Wire the shared contract into in-memory tests**

At the top of `packages/db/src/workbench-repositories.test.ts`, add:

```ts
import { runCoreWorkbenchRepositoryContractTests } from "./workbench-repository-contract";
```

After the imports and before the existing `describe("in-memory workbench repositories", ...)`, add:

```ts
runCoreWorkbenchRepositoryContractTests({
  name: "in-memory",
  createRepositories: () => createInMemoryWorkbenchRepositories()
});
```

- [ ] **Step 3: Wire the shared contract into JSON-file tests**

At the top of `packages/db/src/json-file-workbench-repositories.test.ts`, add:

```ts
import { runCoreWorkbenchRepositoryContractTests } from "./workbench-repository-contract";
```

After `afterEach(...)`, add:

```ts
runCoreWorkbenchRepositoryContractTests({
  name: "json-file",
  createRepositories: async () =>
    createJsonFileWorkbenchRepositories({ filePath: await tempStateFile() })
});
```

- [ ] **Step 4: Run DB tests**

Run:

```bash
pnpm exec vitest run packages/db/src/workbench-repositories.test.ts packages/db/src/json-file-workbench-repositories.test.ts
```

Expected: PASS. Existing repositories should already satisfy this shared contract.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/workbench-repository-contract.ts packages/db/src/workbench-repositories.test.ts packages/db/src/json-file-workbench-repositories.test.ts
git commit -m "add core repository contract tests"
```

---

### Task 3: Prisma Mapper Unit Tests

**Files:**
- Create: `packages/db/src/prisma-workbench-mappers.test.ts`
- Create: `packages/db/src/prisma-workbench-mappers.ts`

- [ ] **Step 1: Write failing mapper tests**

Create `packages/db/src/prisma-workbench-mappers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  toPrismaAgentHandoffCreate,
  toPrismaProjectCreate,
  toPrismaRunCreate,
  toPrismaRunEventCreate,
  toRepositoryAgentHandoff,
  toRepositoryProject,
  toRepositoryRun,
  toRepositoryRunEvent
} from "./prisma-workbench-mappers";

describe("Prisma workbench mappers", () => {
  it("maps projects through a factory-level workspace id", () => {
    expect(
      toPrismaProjectCreate({
        record: {
          id: "project_1",
          name: "Project",
          createdAt: "2026-05-19T00:00:00.000Z"
        },
        workspaceId: "workspace_default"
      })
    ).toEqual({
      id: "project_1",
      name: "Project",
      workspaceId: "workspace_default",
      createdAt: new Date("2026-05-19T00:00:00.000Z")
    });

    expect(
      toRepositoryProject({
        id: "project_1",
        name: "Project",
        createdAt: new Date("2026-05-19T00:00:00.000Z")
      })
    ).toEqual({
      id: "project_1",
      name: "Project",
      createdAt: "2026-05-19T00:00:00.000Z"
    });
  });

  it("maps run context summary without sharing arrays", () => {
    const run = toRepositoryRun({
      id: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "planner",
      state: "completed",
      startedAt: new Date("2026-05-19T00:00:00.000Z"),
      completedAt: new Date("2026-05-19T00:00:01.000Z"),
      contextSummary: {
        injected: ["task.input"],
        omitted: ["secret.raw"]
      }
    });
    run.contextSummary.injected.push("mutated");

    expect(
      toPrismaRunCreate({
        id: "run_1",
        projectId: "project_1",
        taskId: "task_1",
        role: "planner",
        state: "completed",
        startedAt: "2026-05-19T00:00:00.000Z",
        completedAt: "2026-05-19T00:00:01.000Z",
        contextSummary: {
          injected: ["task.input"],
          omitted: ["secret.raw"]
        }
      }).contextSummary
    ).toEqual({
      injected: ["task.input"],
      omitted: ["secret.raw"]
    });
  });

  it("maps run event payloads defensively", () => {
    const event = toRepositoryRunEvent({
      id: "event_1",
      runId: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      sequence: 1,
      type: "model.output.parse_failed",
      message: "parse failed",
      payload: { reason: "invalid_json" },
      createdAt: new Date("2026-05-19T00:00:00.000Z")
    });
    event.payload.reason = "mutated";

    expect(
      toPrismaRunEventCreate({
        id: "event_1",
        runId: "run_1",
        projectId: "project_1",
        taskId: "task_1",
        sequence: 1,
        type: "model.output.parse_failed",
        message: "parse failed",
        payload: { reason: "invalid_json" },
        createdAt: "2026-05-19T00:00:00.000Z"
      }).payload
    ).toEqual({ reason: "invalid_json" });
  });

  it("maps handoff artifact refs as optional JSON", () => {
    expect(
      toPrismaAgentHandoffCreate({
        id: "handoff_1",
        projectId: "project_1",
        taskId: "task_1",
        fromRunId: "run_1",
        fromRole: "planner",
        toRole: "builder",
        state: "ready",
        summary: "Planner produced a brief.",
        artifactRefs: { briefId: "brief_1" },
        createdAt: "2026-05-19T00:00:00.000Z",
        updatedAt: "2026-05-19T00:00:01.000Z"
      }).artifactRefs
    ).toEqual({ briefId: "brief_1" });

    expect(
      toRepositoryAgentHandoff({
        id: "handoff_1",
        projectId: "project_1",
        taskId: "task_1",
        fromRunId: "run_1",
        fromRole: "planner",
        toRole: "builder",
        state: "ready",
        summary: "Planner produced a brief.",
        blockingReason: null,
        artifactRefs: { briefId: "brief_1" },
        createdAt: new Date("2026-05-19T00:00:00.000Z"),
        updatedAt: new Date("2026-05-19T00:00:01.000Z")
      })
    ).toEqual({
      id: "handoff_1",
      projectId: "project_1",
      taskId: "task_1",
      fromRunId: "run_1",
      fromRole: "planner",
      toRole: "builder",
      state: "ready",
      summary: "Planner produced a brief.",
      artifactRefs: { briefId: "brief_1" },
      createdAt: "2026-05-19T00:00:00.000Z",
      updatedAt: "2026-05-19T00:00:01.000Z"
    });
  });
});
```

- [ ] **Step 2: Run mapper tests to verify they fail**

Run:

```bash
pnpm exec vitest run packages/db/src/prisma-workbench-mappers.test.ts
```

Expected: FAIL because `prisma-workbench-mappers.ts` does not exist.

- [ ] **Step 3: Implement mapper helpers**

Create `packages/db/src/prisma-workbench-mappers.ts` with exported mapper functions used by the tests. Use plain row interfaces instead of importing `@prisma/client`:

```ts
import type {
  AgentHandoffRecord,
  ProjectRecord,
  RunEventRecord,
  RunRecord
} from "./workbench-repositories";

type JsonObject = Record<string, unknown>;

export interface PrismaProjectRow {
  id: string;
  name: string;
  createdAt: Date;
}

export function toPrismaProjectCreate(input: {
  record: ProjectRecord;
  workspaceId: string;
}): ProjectRecord & { workspaceId: string; createdAt: Date } {
  return {
    ...input.record,
    workspaceId: input.workspaceId,
    createdAt: new Date(input.record.createdAt)
  };
}

export function toRepositoryProject(row: PrismaProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString()
  };
}

export function toPrismaRunCreate(run: RunRecord): Omit<RunRecord, "startedAt" | "completedAt"> & {
  startedAt: Date;
  completedAt?: Date;
  contextSummary: JsonObject;
} {
  return {
    ...run,
    startedAt: new Date(run.startedAt),
    ...(run.completedAt ? { completedAt: new Date(run.completedAt) } : {}),
    contextSummary: structuredClone(run.contextSummary) as JsonObject
  };
}

export function toRepositoryRun(row: {
  id: string;
  projectId: string;
  taskId: string | null;
  role: RunRecord["role"];
  state: RunRecord["state"];
  startedAt: Date;
  completedAt: Date | null;
  contextSummary: unknown;
}): RunRecord {
  const contextSummary = isContextSummary(row.contextSummary)
    ? row.contextSummary
    : { injected: [], omitted: [] };
  return {
    id: row.id,
    projectId: row.projectId,
    ...(row.taskId ? { taskId: row.taskId } : {}),
    role: row.role,
    state: row.state,
    startedAt: row.startedAt.toISOString(),
    ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
    contextSummary: {
      injected: [...contextSummary.injected],
      omitted: [...contextSummary.omitted]
    }
  };
}

export function toPrismaRunEventCreate(
  event: RunEventRecord
): Omit<RunEventRecord, "createdAt"> & { createdAt: Date; payload: JsonObject } {
  return {
    ...event,
    createdAt: new Date(event.createdAt),
    payload: structuredClone(event.payload) as JsonObject
  };
}

export function toRepositoryRunEvent(row: {
  id: string;
  runId: string;
  projectId: string;
  taskId: string | null;
  sequence: number;
  type: string;
  message: string;
  payload: unknown;
  createdAt: Date;
}): RunEventRecord {
  return {
    id: row.id,
    runId: row.runId,
    projectId: row.projectId,
    ...(row.taskId ? { taskId: row.taskId } : {}),
    sequence: row.sequence,
    type: row.type,
    message: row.message,
    payload: isJsonObject(row.payload) ? structuredClone(row.payload) : {},
    createdAt: row.createdAt.toISOString()
  };
}

export function toPrismaAgentHandoffCreate(
  handoff: AgentHandoffRecord
): Omit<AgentHandoffRecord, "createdAt" | "updatedAt"> & {
  createdAt: Date;
  updatedAt: Date;
  artifactRefs?: JsonObject;
} {
  return {
    ...handoff,
    createdAt: new Date(handoff.createdAt),
    updatedAt: new Date(handoff.updatedAt),
    ...(handoff.artifactRefs
      ? { artifactRefs: structuredClone(handoff.artifactRefs) as JsonObject }
      : {})
  };
}

export function toRepositoryAgentHandoff(row: {
  id: string;
  projectId: string;
  taskId: string | null;
  fromRunId: string;
  fromRole: AgentHandoffRecord["fromRole"];
  toRole: AgentHandoffRecord["toRole"];
  state: AgentHandoffRecord["state"];
  summary: string;
  blockingReason: string | null;
  artifactRefs: unknown;
  createdAt: Date;
  updatedAt: Date;
}): AgentHandoffRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    ...(row.taskId ? { taskId: row.taskId } : {}),
    fromRunId: row.fromRunId,
    fromRole: row.fromRole,
    toRole: row.toRole,
    state: row.state,
    summary: row.summary,
    ...(row.blockingReason ? { blockingReason: row.blockingReason } : {}),
    ...(isJsonObject(row.artifactRefs)
      ? { artifactRefs: structuredClone(row.artifactRefs) as AgentHandoffRecord["artifactRefs"] }
      : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function isContextSummary(value: unknown): value is RunRecord["contextSummary"] {
  return (
    isJsonObject(value) &&
    Array.isArray(value.injected) &&
    value.injected.every((item) => typeof item === "string") &&
    Array.isArray(value.omitted) &&
    value.omitted.every((item) => typeof item === "string")
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
```

- [ ] **Step 4: Run mapper tests and typecheck**

Run:

```bash
pnpm exec vitest run packages/db/src/prisma-workbench-mappers.test.ts
pnpm --filter @lp-agent/db typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/prisma-workbench-mappers.ts packages/db/src/prisma-workbench-mappers.test.ts
git commit -m "add prisma workbench mappers"
```

---

### Task 4: Prisma Repository Factory and Core Runtime Repositories

**Files:**
- Create: `packages/db/src/prisma-workbench-repositories.ts`
- Create: `packages/db/src/prisma-workbench-repositories.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write failing Prisma repository tests for project/task/message/runtime records**

Create `packages/db/src/prisma-workbench-repositories.test.ts` with a fake Prisma client and contract coverage:

```ts
import { describe, expect, it } from "vitest";
import {
  createPrismaWorkbenchRepositories,
  createUnsupportedPrismaRepository
} from "./prisma-workbench-repositories";
import { runCoreWorkbenchRepositoryContractTests } from "./workbench-repository-contract";

runCoreWorkbenchRepositoryContractTests({
  name: "prisma fake",
  createRepositories: () =>
    createPrismaWorkbenchRepositories({
      prisma: createFakePrismaClient(),
      workspaceId: "workspace_default"
    })
});

describe("createPrismaWorkbenchRepositories", () => {
  it("fails fast for repositories outside the Stage 22 first batch", async () => {
    const repository = createUnsupportedPrismaRepository("skills");

    await expect(repository.listAll()).rejects.toThrow(
      "Prisma repository skills is not implemented in Stage 22 foundation"
    );
  });
});

function createFakePrismaClient() {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  const table = (name: string) => {
    const rows = tables.get(name) ?? new Map<string, Record<string, unknown>>();
    tables.set(name, rows);
    return rows;
  };
  const delegate = (name: string) => ({
    async upsert(input: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) {
      const rows = table(name);
      const existing = rows.get(input.where.id);
      rows.set(input.where.id, { ...(existing ?? {}), ...(existing ? input.update : input.create) });
      return rows.get(input.where.id);
    },
    async findUnique(input: { where: Record<string, unknown> }) {
      const rows = [...table(name).values()];
      return rows.find((row) =>
        Object.entries(input.where).every(([key, value]) => row[key] === value)
      ) ?? null;
    },
    async findMany(input: { where?: Record<string, unknown>; orderBy?: Array<Record<string, "asc" | "desc">> } = {}) {
      const rows = [...table(name).values()].filter((row) =>
        Object.entries(input.where ?? {}).every(([key, value]) => row[key] === value)
      );
      return rows.sort((left, right) => compareRows(left, right, input.orderBy ?? []));
    }
  });

  return {
    project: delegate("project"),
    workbenchTask: delegate("workbenchTask"),
    workbenchMessage: delegate("workbenchMessage"),
    workbenchTaskSnapshot: delegate("workbenchTaskSnapshot"),
    lPBrief: delegate("lPBrief"),
    pageVersion: delegate("pageVersion"),
    artifactWorkspace: delegate("artifactWorkspace"),
    artifactWorkspaceFile: delegate("artifactWorkspaceFile"),
    run: delegate("run"),
    runEvent: delegate("runEvent"),
    toolObservation: delegate("toolObservation"),
    agentHandoff: delegate("agentHandoff")
  };
}

function compareRows(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  orderBy: Array<Record<string, "asc" | "desc">>
): number {
  for (const order of orderBy) {
    const [[key, direction]] = Object.entries(order);
    const result = String(left[key] ?? "").localeCompare(String(right[key] ?? ""));
    if (result !== 0) {
      return direction === "desc" ? -result : result;
    }
  }
  return 0;
}
```

- [ ] **Step 2: Run Prisma repository tests to verify they fail**

Run:

```bash
pnpm exec vitest run packages/db/src/prisma-workbench-repositories.test.ts
```

Expected: FAIL because `prisma-workbench-repositories.ts` does not exist.

- [ ] **Step 3: Implement Prisma repository factory and unsupported stubs**

Create `packages/db/src/prisma-workbench-repositories.ts`.

Implementation requirements:

- Export `createPrismaWorkbenchRepositories({ prisma, workspaceId })`.
- Export `createUnsupportedPrismaRepository(name)`.
- Implement first-batch repositories:
  - `projects`
  - `tasks`
  - `messages`
  - `taskSnapshots`
  - `briefs`
  - `pageVersions`
  - `artifactWorkspaces`
  - `artifactWorkspaceFiles`
  - `runs`
  - `runEvents`
  - `toolObservations`
  - `agentHandoffs`
- Return fail-fast unsupported repositories for:
  - `workspaceMembers`
  - `projectMembers`
  - `deployments`
  - `skills`
  - `skillVersions`
  - `skillBindings`
  - `modelProviders`
  - `modelRoutingPolicies`
  - `mcpConnectors`
  - `mcpToolApprovals`

Use this delegate interface at the top of the file:

```ts
type PrismaWhere = Record<string, unknown>;
type PrismaOrderBy = Array<Record<string, "asc" | "desc">>;

interface PrismaDelegate {
  upsert(input: {
    where: PrismaWhere;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<unknown>;
  findUnique(input: { where: PrismaWhere }): Promise<unknown | null>;
  findMany(input?: {
    where?: PrismaWhere;
    orderBy?: PrismaOrderBy;
  }): Promise<unknown[]>;
}

export interface PrismaWorkbenchClient {
  project: PrismaDelegate;
  workbenchTask: PrismaDelegate;
  workbenchMessage: PrismaDelegate;
  workbenchTaskSnapshot: PrismaDelegate;
  lPBrief: PrismaDelegate;
  pageVersion: PrismaDelegate;
  artifactWorkspace: PrismaDelegate;
  artifactWorkspaceFile: PrismaDelegate;
  run: PrismaDelegate;
  runEvent: PrismaDelegate;
  toolObservation: PrismaDelegate;
  agentHandoff: PrismaDelegate;
}
```

Repository behavior table:

| Repository | Delegate | Save `where` | Required ordering |
| --- | --- | --- | --- |
| `projects` | `project` | `{ id }` | `listAll`: `createdAt asc`, `id asc` |
| `tasks` | `workbenchTask` | `{ id }` | `listAll`: `createdAt asc`, `id asc` |
| `messages` | `workbenchMessage` | `{ id }` | `listForTask`: `createdAt asc`, `id asc` |
| `taskSnapshots` | `workbenchTaskSnapshot` | `{ taskId }` | none |
| `runs` | `run` | `{ id }` | project/task/all: `startedAt asc`, `id asc` |
| `runEvents` | `runEvent` | `{ id }` | run: `sequence asc`, `createdAt asc`, `id asc`; project/task/all: `createdAt asc`, `runId asc`, `sequence asc`, `id asc` |
| `toolObservations` | `toolObservation` | `{ id }` | `createdAt asc`, `runId asc`, `id asc` |
| `agentHandoffs` | `agentHandoff` | `{ id }` | `updatedAt asc`, `createdAt asc`, `id asc` |

For unsupported repository helper, use this implementation:

```ts
export function createUnsupportedPrismaRepository(name: string): {
  [key: string]: () => Promise<never>;
} {
  return new Proxy(
    {},
    {
      get() {
        return async () => {
          throw new Error(`Prisma repository ${name} is not implemented in Stage 22 foundation`);
        };
      }
    }
  ) as { [key: string]: () => Promise<never> };
}
```

- [ ] **Step 4: Export the Prisma factory**

Modify `packages/db/src/index.ts`:

```ts
export * from "./workbench-repositories";
export * from "./json-file-workbench-repositories";
export * from "./prisma-workbench-repositories";
```

- [ ] **Step 5: Run Prisma repository tests**

Run:

```bash
pnpm exec vitest run packages/db/src/prisma-workbench-repositories.test.ts
pnpm --filter @lp-agent/db typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/prisma-workbench-repositories.ts packages/db/src/prisma-workbench-repositories.test.ts packages/db/src/index.ts
git commit -m "add prisma workbench repositories"
```

---

### Task 5: Opt-in Postgres Integration Test

**Files:**
- Create: `packages/db/src/prisma-workbench-repositories.integration.test.ts`
- Modify: `packages/db/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add `@prisma/client` only if missing**

Check:

```bash
rg -n "\"@prisma/client\"" packages/db/package.json pnpm-lock.yaml
```

If missing, run:

```bash
pnpm add @prisma/client@^6.0.0 --filter @lp-agent/db
```

Expected: `packages/db/package.json` gains a runtime dependency and `pnpm-lock.yaml` changes.

- [ ] **Step 2: Write opt-in integration test**

Create `packages/db/src/prisma-workbench-repositories.integration.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { runCoreWorkbenchRepositoryContractTests } from "./workbench-repository-contract";

const shouldRun = process.env.POSTGRES_REPOSITORY_TEST === "1" && Boolean(process.env.DATABASE_URL);

if (shouldRun) {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const workspaceId = `workspace_${randomUUID()}`;
  const organizationId = `organization_${randomUUID()}`;

  runCoreWorkbenchRepositoryContractTests({
    name: "prisma postgres",
    createRepositories: async () => {
      await prisma.organization.upsert({
        where: { id: organizationId },
        create: { id: organizationId, name: "Integration Org" },
        update: { name: "Integration Org" }
      });
      await prisma.workspace.upsert({
        where: { id: workspaceId },
        create: { id: workspaceId, organizationId, name: "Integration Workspace" },
        update: { name: "Integration Workspace" }
      });
      const { createPrismaWorkbenchRepositories } = await import("./prisma-workbench-repositories");
      return createPrismaWorkbenchRepositories({ prisma, workspaceId });
    }
  });
} else {
  describe("prisma postgres repository integration", () => {
    it("skips unless POSTGRES_REPOSITORY_TEST=1 and DATABASE_URL are configured", () => {
      expect(shouldRun).toBe(false);
    });
  });
}
```

- [ ] **Step 3: Run integration test in default skipped mode**

Run:

```bash
pnpm exec vitest run packages/db/src/prisma-workbench-repositories.integration.test.ts
```

Expected: PASS with the skip assertion test. It must not try to connect to a local database by default.

- [ ] **Step 4: Document manual opt-in command in test comments**

At the top of `packages/db/src/prisma-workbench-repositories.integration.test.ts`, add:

```ts
// Manual opt-in:
// POSTGRES_REPOSITORY_TEST=1 DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" \
//   pnpm exec vitest run packages/db/src/prisma-workbench-repositories.integration.test.ts
```

- [ ] **Step 5: Run DB package checks**

Run:

```bash
pnpm exec vitest run packages/db/src/prisma-workbench-repositories.integration.test.ts packages/db/src/prisma-workbench-repositories.test.ts packages/db/src/prisma-workbench-mappers.test.ts packages/db/src/prisma-schema-contract.test.ts
pnpm --filter @lp-agent/db typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/prisma-workbench-repositories.integration.test.ts packages/db/package.json pnpm-lock.yaml
git commit -m "add opt-in postgres repository integration test"
```

---

### Task 6: Documentation and Roadmap Completion

**Files:**
- Modify: `docs/project-roadmap.md`
- Modify: `docs/agent-development-learning.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Update roadmap Stage 22 status**

In `docs/project-roadmap.md`, update Stage 22 from:

```md
**状态：** design 已确认，待 implementation plan。
```

to:

```md
**状态：** 已实现 foundation v0。
```

Add an implementation plan line under the design line:

```md
**实施计划：** `docs/superpowers/plans/2026-05-19-postgres-repository-foundation.md`。
```

Update current status snapshot with:

```md
- Postgres repository foundation v0：Prisma schema 已对齐 Agent runtime 核心 repository contract，并提供显式 opt-in 的 Prisma-backed repository adapter。
```

Keep these in backlog:

```md
- Web opt-in Postgres backend wiring。
- Auth/RBAC on top of Postgres。
- Object storage / artifact file content migration。
- Prisma migrations and production deployment docs。
- Worker job repository Postgres backend。
```

- [ ] **Step 2: Update Superpowers README reading order**

In `docs/superpowers/README.md`, add after Stage 22 design:

```md
73. `plans/2026-05-19-postgres-repository-foundation.md`
   - Stage 22 Postgres Repository Foundation v0 implementation plan。
   - 在 Stage 22 design 后阅读，用于按 TDD 对齐 Prisma schema、提取 shared repository contract tests、实现 Prisma mappers、显式 opt-in Prisma-backed repository adapter、opt-in Postgres integration test 和文档收尾。
```

- [ ] **Step 3: Update Agent learning notes**

In `docs/agent-development-learning.md`, update the Stage 22 section to mention:

```md
- 当前实现计划：[2026-05-19-postgres-repository-foundation.md](./superpowers/plans/2026-05-19-postgres-repository-foundation.md)
- foundation v0 已保留 in-memory / JSON-file 默认路径，并通过显式 factory 提供 Prisma/Postgres backend。
- 学习重点：repository backend 是 Agent 可观察性和恢复语义的基础设施；切换存储层时，service 层应继续依赖 stable contract，而不是把 Prisma 细节泄漏到 runtime、context assembler 或 Web timeline。
```

- [ ] **Step 4: Run docs checks**

Run:

```bash
rg -n "2026-05-19-postgres-repository-foundation" docs/project-roadmap.md docs/superpowers/README.md docs/agent-development-learning.md
git diff --check
```

Expected: PASS. `rg` should show the design and plan references.

- [ ] **Step 5: Commit**

```bash
git add docs/project-roadmap.md docs/agent-development-learning.md docs/superpowers/README.md
git commit -m "document postgres repository foundation completion"
```

---

### Task 7: Final Verification

**Files:**
- No new source files beyond previous tasks.

- [ ] **Step 1: Run focused DB verification**

Run:

```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm --filter @lp-agent/db db:validate
pnpm --filter @lp-agent/db test
pnpm --filter @lp-agent/db typecheck
```

Expected: PASS. Integration test remains skipped unless explicitly opted in.

- [ ] **Step 2: Run full repository verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: PASS.

- [ ] **Step 3: Review final git state**

Run:

```bash
git status --short
git log --oneline -8
```

Expected: working tree clean after commits; recent commits include Stage 22 schema, contracts, mappers, Prisma repositories, integration test, and docs.

---

## Self-Review Checklist

- Spec coverage:
  - Prisma schema alignment: Task 1.
  - Explicit opt-in Prisma adapter: Tasks 4 and 5.
  - First-batch repository scope: Tasks 2, 4, and 5.
  - Safety and durable metadata boundaries: Tasks 2, 3, 4, and docs in Task 6.
  - No default Web backend switch: Task 6 and no Web files in implementation tasks.
- Placeholder scan:
  - No placeholder markers or unspecified follow-up implementation steps are required for Stage 22 foundation.
- Type consistency:
  - Factory name is consistently `createPrismaWorkbenchRepositories`.
  - Plan uses `workspaceId` as the explicit Prisma relation bridge.
  - Repository contract names match `packages/db/src/workbench-repositories.ts`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-19-postgres-repository-foundation.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
