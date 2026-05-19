import { describe, expect, it } from "vitest";
import type { StaticArtifacts } from "@lp-agent/artifacts";
import {
  createPrismaWorkbenchRepositories,
  createUnsupportedPrismaRepository
} from "./prisma-workbench-repositories";
import { runCoreWorkbenchRepositoryContractTests } from "./workbench-repository-contract";

type FakeRow = Record<string, unknown>;
type FakeWhere = Record<string, unknown>;
type FakeOrderBy = Array<Record<string, "asc" | "desc">>;

interface FakeFindManyArgs {
  where?: FakeWhere;
  orderBy?: FakeOrderBy;
  take?: number;
}

interface FakeDelegate {
  upsert(input: { where: FakeWhere; create: FakeRow; update: FakeRow }): Promise<FakeRow>;
  findUnique(input: { where: FakeWhere }): Promise<FakeRow | null>;
  findMany(input?: FakeFindManyArgs): Promise<FakeRow[]>;
}

runCoreWorkbenchRepositoryContractTests({
  name: "prisma fake",
  createRepositories: () =>
    createPrismaWorkbenchRepositories({
      prisma: createFakePrismaClient(),
      workspaceId: "workspace_default"
    })
});

const createdAt = "2026-05-14T00:00:00.000Z";

const staticArtifacts: StaticArtifacts = {
  indexHtml: "<!doctype html><html><body><h1>Spring sale</h1></body></html>",
  stylesCss: "body { margin: 0; color: #17202a; }",
  scriptJs: "console.log('spring sale ready');"
};

describe("createPrismaWorkbenchRepositories", () => {
  it("scopes project reads and saves to the repository workspace", async () => {
    const prisma = createFakePrismaClient();
    const workspaceA = createPrismaWorkbenchRepositories({
      prisma,
      workspaceId: "workspace_a"
    });
    const workspaceB = createPrismaWorkbenchRepositories({
      prisma,
      workspaceId: "workspace_b"
    });

    await workspaceA.projects.save({
      id: "project_shared",
      name: "Workspace A project",
      createdAt
    });

    await expect(workspaceB.projects.getById("project_shared")).resolves.toBeUndefined();
    await expect(
      workspaceB.projects.save({
        id: "project_shared",
        name: "Workspace B attempted mutation",
        createdAt: "2026-05-14T00:01:00.000Z"
      })
    ).rejects.toThrow("Prisma project project_shared belongs to a different workspace");
    await expect(workspaceA.projects.getById("project_shared")).resolves.toEqual({
      id: "project_shared",
      name: "Workspace A project",
      createdAt
    });
  });

  it("clears nullable repository fields when optional properties are omitted on save", async () => {
    const repositories = createPrismaWorkbenchRepositories({
      prisma: createFakePrismaClient(),
      workspaceId: "workspace_default"
    });

    await repositories.tasks.save({
      id: "task_nullable",
      title: "Task with project",
      type: "lp_generation",
      status: "complete",
      projectId: "project_nullable",
      createdAt
    });
    await repositories.taskSnapshots.save({
      taskId: "task_nullable",
      projectId: "project_nullable",
      briefId: "brief_nullable",
      pageVersionId: "version_nullable",
      createdAt
    });
    await repositories.runs.save({
      id: "run_nullable",
      projectId: "project_nullable",
      taskId: "task_nullable",
      role: "builder",
      state: "completed",
      startedAt: createdAt,
      completedAt: "2026-05-14T00:02:00.000Z",
      contextSummary: {
        injected: ["brief"],
        omitted: []
      }
    });
    await repositories.pageVersions.save({
      id: "version_nullable",
      projectId: "project_nullable",
      briefId: "brief_nullable",
      artifactWorkspaceId: "artifact_workspace_nullable",
      artifacts: staticArtifacts,
      reviewStatus: "passed",
      findings: [],
      createdAt
    });
    await repositories.artifactWorkspaces.save({
      id: "artifact_workspace_nullable",
      projectId: "project_nullable",
      pageVersionId: "version_nullable",
      runId: "run_nullable",
      kind: "static_lp",
      state: "active",
      createdAt,
      updatedAt: createdAt
    });
    await repositories.artifactWorkspaceFiles.save({
      id: "artifact_workspace_file_nullable",
      workspaceId: "artifact_workspace_nullable",
      projectId: "project_nullable",
      pageVersionId: "version_nullable",
      path: "index.html",
      kind: "html",
      mimeType: "text/html",
      sizeBytes: Buffer.byteLength(staticArtifacts.indexHtml, "utf8"),
      sha256: "a8a9b67757f1ba55b5eeadf1fe967ff562cecae267b62018346f9a87ada73935",
      summary: "index file",
      content: staticArtifacts.indexHtml,
      createdAt,
      updatedAt: createdAt
    });
    await repositories.toolObservations.save({
      id: "tool_observation_nullable",
      runId: "run_nullable",
      projectId: "project_nullable",
      taskId: "task_nullable",
      toolName: "writeFile",
      input: {
        path: "index.html"
      },
      outputSummary: "write failed",
      state: "failed",
      exitCode: 1,
      errorName: "WriteError",
      createdAt,
      completedAt: "2026-05-14T00:03:00.000Z"
    });
    await repositories.agentHandoffs.save({
      id: "handoff_nullable",
      projectId: "project_nullable",
      taskId: "task_nullable",
      fromRunId: "run_reviewer",
      fromRole: "reviewer",
      toRole: "builder",
      state: "blocked",
      summary: "Need a fix.",
      blockingReason: "Missing asset",
      artifactRefs: {
        briefId: "brief_nullable",
        pageVersionId: "version_nullable"
      },
      createdAt,
      updatedAt: createdAt
    });

    await repositories.tasks.save({
      id: "task_nullable",
      title: "Task without project",
      type: "lp_generation",
      status: "complete",
      createdAt
    });
    await repositories.taskSnapshots.save({
      taskId: "task_nullable",
      projectId: "project_nullable",
      createdAt
    });
    await repositories.runs.save({
      id: "run_nullable",
      projectId: "project_nullable",
      role: "builder",
      state: "running",
      startedAt: createdAt,
      contextSummary: {
        injected: [],
        omitted: ["brief"]
      }
    });
    await repositories.pageVersions.save({
      id: "version_nullable",
      projectId: "project_nullable",
      briefId: "brief_nullable",
      artifacts: staticArtifacts,
      reviewStatus: "pending",
      findings: [],
      createdAt
    });
    await repositories.artifactWorkspaces.save({
      id: "artifact_workspace_nullable",
      projectId: "project_nullable",
      kind: "static_lp",
      state: "active",
      createdAt,
      updatedAt: "2026-05-14T00:04:00.000Z"
    });
    await repositories.artifactWorkspaceFiles.save({
      id: "artifact_workspace_file_nullable",
      workspaceId: "artifact_workspace_nullable",
      projectId: "project_nullable",
      path: "index.html",
      kind: "html",
      mimeType: "text/html",
      sizeBytes: Buffer.byteLength(staticArtifacts.indexHtml, "utf8"),
      sha256: "a8a9b67757f1ba55b5eeadf1fe967ff562cecae267b62018346f9a87ada73935",
      summary: "index file",
      content: staticArtifacts.indexHtml,
      createdAt,
      updatedAt: "2026-05-14T00:04:00.000Z"
    });
    await repositories.toolObservations.save({
      id: "tool_observation_nullable",
      runId: "run_nullable",
      projectId: "project_nullable",
      toolName: "writeFile",
      input: {
        path: "index.html"
      },
      outputSummary: "write still running",
      state: "running",
      createdAt
    });
    await repositories.agentHandoffs.save({
      id: "handoff_nullable",
      projectId: "project_nullable",
      fromRunId: "run_reviewer",
      fromRole: "reviewer",
      toRole: "builder",
      state: "ready",
      summary: "Ready to continue.",
      createdAt,
      updatedAt: "2026-05-14T00:04:00.000Z"
    });

    await expect(repositories.tasks.getById("task_nullable")).resolves.toEqual({
      id: "task_nullable",
      title: "Task without project",
      type: "lp_generation",
      status: "complete",
      createdAt
    });
    await expect(repositories.taskSnapshots.getByTaskId("task_nullable")).resolves.toEqual({
      taskId: "task_nullable",
      projectId: "project_nullable",
      createdAt
    });
    await expect(repositories.runs.getById("run_nullable")).resolves.toEqual({
      id: "run_nullable",
      projectId: "project_nullable",
      role: "builder",
      state: "running",
      startedAt: createdAt,
      contextSummary: {
        injected: [],
        omitted: ["brief"]
      }
    });
    await expect(repositories.pageVersions.getById("version_nullable")).resolves.toEqual({
      id: "version_nullable",
      projectId: "project_nullable",
      briefId: "brief_nullable",
      artifacts: staticArtifacts,
      reviewStatus: "pending",
      findings: [],
      createdAt
    });
    await expect(
      repositories.artifactWorkspaces.getById("artifact_workspace_nullable")
    ).resolves.toEqual({
      id: "artifact_workspace_nullable",
      projectId: "project_nullable",
      kind: "static_lp",
      state: "active",
      createdAt,
      updatedAt: "2026-05-14T00:04:00.000Z"
    });
    await expect(
      repositories.artifactWorkspaceFiles.getByPath({
        workspaceId: "artifact_workspace_nullable",
        path: "index.html"
      })
    ).resolves.toEqual({
      id: "artifact_workspace_file_nullable",
      workspaceId: "artifact_workspace_nullable",
      projectId: "project_nullable",
      path: "index.html",
      kind: "html",
      mimeType: "text/html",
      sizeBytes: Buffer.byteLength(staticArtifacts.indexHtml, "utf8"),
      sha256: "a8a9b67757f1ba55b5eeadf1fe967ff562cecae267b62018346f9a87ada73935",
      summary: "index file",
      content: staticArtifacts.indexHtml,
      createdAt,
      updatedAt: "2026-05-14T00:04:00.000Z"
    });
    await expect(repositories.toolObservations.listAll()).resolves.toEqual([
      {
        id: "tool_observation_nullable",
        runId: "run_nullable",
        projectId: "project_nullable",
        toolName: "writeFile",
        input: {
          path: "index.html"
        },
        outputSummary: "write still running",
        state: "running",
        createdAt
      }
    ]);
    await expect(repositories.agentHandoffs.getById("handoff_nullable")).resolves.toEqual({
      id: "handoff_nullable",
      projectId: "project_nullable",
      fromRunId: "run_reviewer",
      fromRole: "reviewer",
      toRole: "builder",
      state: "ready",
      summary: "Ready to continue.",
      createdAt,
      updatedAt: "2026-05-14T00:04:00.000Z"
    });
  });
});

describe("createUnsupportedPrismaRepository", () => {
  it("fails fast with the Stage 22 unsupported repository message", async () => {
    const repository = createUnsupportedPrismaRepository<{ listAll(): Promise<unknown[]> }>(
      "skills"
    );

    await expect(repository.listAll()).rejects.toThrow(
      "Prisma repository skills is not implemented in Stage 22 foundation"
    );
  });
});

function createFakePrismaClient() {
  return {
    project: createFakeDelegate(),
    workbenchTask: createFakeDelegate(),
    workbenchMessage: createFakeDelegate(),
    workbenchTaskSnapshot: createFakeDelegate(),
    lPBrief: createFakeDelegate(),
    pageVersion: createFakeDelegate(),
    artifactWorkspace: createFakeDelegate(),
    artifactWorkspaceFile: createFakeDelegate(),
    run: createFakeDelegate(),
    runEvent: createFakeDelegate(),
    toolObservation: createFakeDelegate(),
    agentHandoff: createFakeDelegate()
  };
}

function createFakeDelegate(): FakeDelegate {
  const rows: FakeRow[] = [];

  return {
    async upsert(input) {
      const existingIndex = rows.findIndex((row) => matchesWhere(row, input.where));
      if (existingIndex >= 0) {
        const existing = rows[existingIndex];
        rows[existingIndex] = cloneRow({
          ...existing,
          ...input.update
        });
        return cloneRow(rows[existingIndex]);
      }

      const created = cloneRow(input.create);
      rows.push(created);
      return cloneRow(created);
    },

    async findUnique(input) {
      const row = rows.find((candidate) => matchesWhere(candidate, input.where));
      return row ? cloneRow(row) : null;
    },

    async findMany(input = {}) {
      const where = input.where ?? {};
      const orderBy = input.orderBy ?? [];
      const matchingRows = rows
        .filter((row) => matchesWhere(row, where))
        .sort((left, right) => compareRows(left, right, orderBy));
      const limitedRows =
        input.take === undefined ? matchingRows : matchingRows.slice(0, input.take);

      return limitedRows.map(cloneRow);
    }
  };
}

function matchesWhere(row: FakeRow, where: FakeWhere): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (isRecord(expected) && !(key in row)) {
      return Object.entries(expected).every(
        ([nestedKey, nestedExpected]) => row[nestedKey] === nestedExpected
      );
    }

    return row[key] === expected;
  });
}

function compareRows(left: FakeRow, right: FakeRow, orderBy: FakeOrderBy): number {
  for (const order of orderBy) {
    const entries = Object.entries(order);
    const [field, direction] = entries[0] ?? [];
    if (!field || !direction) {
      continue;
    }

    const compared = compareValues(left[field], right[field]);
    if (compared !== 0) {
      return direction === "asc" ? compared : -compared;
    }
  }

  return 0;
}

function compareValues(left: unknown, right: unknown): number {
  const normalizedLeft = normalizeComparableValue(left);
  const normalizedRight = normalizeComparableValue(right);

  if (normalizedLeft < normalizedRight) {
    return -1;
  }
  if (normalizedLeft > normalizedRight) {
    return 1;
  }
  return 0;
}

function normalizeComparableValue(value: unknown): number | string {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number" || typeof value === "string") {
    return value;
  }
  return "";
}

function cloneRow(row: FakeRow | undefined): FakeRow {
  return structuredClone(row ?? {});
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
