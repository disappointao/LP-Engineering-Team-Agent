import { describe, expect, it } from "vitest";
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
