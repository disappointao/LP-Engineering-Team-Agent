import { describe, expect, it } from "vitest";
import {
  createContractWorkerJobPayloadRecord,
  createContractWorkerJobRecord,
  createContractWorkerLogRecord,
  runWorkerJobPayloadRepositoryContractTests,
  runWorkerJobRepositoryContractTests,
  runWorkerLogRepositoryContractTests
} from "@lp-agent/worker-runtime/testing";
import {
  createPrismaWorkerJobPayloadRepository,
  createPrismaWorkerJobRepository,
  createPrismaWorkerLogRepository,
  type PrismaWorkerClient
} from "./prisma-worker-repositories";

type FakeRow = Record<string, unknown>;
type FakeWhere = Record<string, unknown>;
type FakeOrderBy = Array<Record<string, "asc" | "desc">>;

interface FakeFindManyArgs {
  where?: FakeWhere;
  orderBy?: FakeOrderBy;
  take?: number;
}

interface FakeDelegate {
  rows: FakeRow[];
  upsert(input: { where: FakeWhere; create: FakeRow; update: FakeRow }): Promise<FakeRow>;
  findUnique(input: { where: FakeWhere }): Promise<FakeRow | null>;
  findMany(input?: FakeFindManyArgs): Promise<FakeRow[]>;
  updateMany(input: { where: FakeWhere; data: FakeRow }): Promise<{ count: number }>;
  deleteMany(input?: { where?: FakeWhere }): Promise<{ count: number }>;
}

interface FakeDelegateOptions {
  beforeUpdateMany?: (context: {
    input: { where: FakeWhere; data: FakeRow };
    rows: FakeRow[];
  }) => void;
  failDeleteMany?: Error;
}

runWorkerJobRepositoryContractTests("prisma fake", () =>
  createPrismaWorkerJobRepository(createFakePrismaClient())
);

runWorkerJobPayloadRepositoryContractTests("prisma fake", () =>
  createPrismaWorkerJobPayloadRepository(createFakePrismaClient())
);

runWorkerLogRepositoryContractTests("prisma fake", () =>
  createPrismaWorkerLogRepository(createFakePrismaClient())
);

describe("createPrismaWorkerJobRepository", () => {
  it("prevents a stale claim token from completing a re-claimed stale job", async () => {
    const repository = createPrismaWorkerJobRepository(createFakePrismaClient());

    await repository.save(
      createContractWorkerJobRecord({
        id: "job-stale-token",
        payloadSource: "safe_persisted"
      })
    );
    const oldClaim = await repository.claimOldestQueued({
      payloadSource: "safe_persisted",
      startedAt: "2026-05-20T00:01:00.000Z",
      claimedByWorkerId: "worker-old",
      claimToken: "old-token"
    });
    expect(oldClaim?.claimToken).toBe("old-token");

    const recovered = await repository.recoverStale({
      staleBefore: "2026-05-20T00:02:01.000Z",
      recoveredAt: "2026-05-20T00:02:01.000Z",
      staleClaimTimeoutMs: 60_000,
      maxStaleRecoveryCount: 1
    });
    expect(recovered).toMatchObject([{ type: "requeued", jobId: "job-stale-token" }]);

    const newClaim = await repository.claimOldestQueued({
      payloadSource: "safe_persisted",
      startedAt: "2026-05-20T00:03:00.000Z",
      claimedByWorkerId: "worker-new",
      claimToken: "new-token"
    });
    expect(newClaim?.claimToken).toBe("new-token");

    await expect(
      repository.completeClaimed({
        jobId: "job-stale-token",
        claimToken: "old-token",
        state: "completed",
        resultSummary: {
          state: "completed",
          exitCode: 0,
          stdout: "",
          stderr: "",
          stdoutBytes: 0,
          stderrBytes: 0
        },
        completedAt: "2026-05-20T00:04:00.000Z"
      })
    ).resolves.toBeUndefined();
    await expect(repository.getById("job-stale-token")).resolves.toMatchObject({
      state: "running",
      claimedByWorkerId: "worker-new",
      claimToken: "new-token"
    });
  });

  it("treats missing payload source as process memory when claiming", async () => {
    const repository = createPrismaWorkerJobRepository(createFakePrismaClient());

    await repository.save(
      createContractWorkerJobRecord({
        id: "job-default-memory",
        payloadSource: undefined
      })
    );

    await expect(
      repository.claimOldestQueued({
        payloadSource: "process_memory",
        startedAt: "2026-05-20T00:01:00.000Z",
        claimedByWorkerId: "worker-1",
        claimToken: "claim-token-1"
      })
    ).resolves.toMatchObject({
      id: "job-default-memory",
      state: "running",
      payloadSource: "process_memory"
    });
  });

  it("does not recover a stale job that heartbeats before the conditional update", async () => {
    let injectedHeartbeat = false;
    const prisma = createFakePrismaClient({
      workerJob: {
        beforeUpdateMany({ input, rows }) {
          if (
            injectedHeartbeat ||
            input.data.state !== "queued" ||
            input.where.id !== "job-heartbeat-race"
          ) {
            return;
          }

          injectedHeartbeat = true;
          const row = rows.find((stored) => stored.id === "job-heartbeat-race");
          if (row) {
            row.heartbeatExpiresAt = new Date("2026-05-20T00:10:00.000Z");
            row.lastHeartbeatAt = new Date("2026-05-20T00:04:00.000Z");
          }
        }
      }
    });
    const repository = createPrismaWorkerJobRepository(prisma);

    await repository.save(
      createContractWorkerJobRecord({
        id: "job-heartbeat-race",
        state: "running",
        payloadSource: "safe_persisted",
        startedAt: "2026-05-20T00:01:00.000Z",
        claimedByWorkerId: "worker-1",
        claimToken: "claim-token-1",
        heartbeatExpiresAt: "2026-05-20T00:02:00.000Z"
      })
    );

    await expect(
      repository.recoverStale({
        staleBefore: "2026-05-20T00:03:00.000Z",
        recoveredAt: "2026-05-20T00:03:00.000Z",
        maxStaleRecoveryCount: 1
      })
    ).resolves.toEqual([]);
    await expect(repository.getById("job-heartbeat-race")).resolves.toMatchObject({
      state: "running",
      claimToken: "claim-token-1",
      lastHeartbeatAt: "2026-05-20T00:04:00.000Z",
      heartbeatExpiresAt: "2026-05-20T00:10:00.000Z"
    });
  });
});

describe("createPrismaWorkerJobPayloadRepository", () => {
  it("does not persist raw payload or env values outside the safe mapped fields", async () => {
    const prisma = createFakePrismaClient();
    const repository = createPrismaWorkerJobPayloadRepository(prisma);

    await repository.save({
      ...createContractWorkerJobPayloadRecord(),
      raw: "do not store",
      env: { DEPLOY_TOKEN: "secret" }
    } as unknown as Parameters<typeof repository.save>[0]);

    expect(prisma.workerJobPayload.rows).toHaveLength(1);
    expect(prisma.workerJobPayload.rows[0]).not.toHaveProperty("raw");
    expect(prisma.workerJobPayload.rows[0]).not.toHaveProperty("env");
    await expect(repository.getByJobId("worker-job-1")).resolves.not.toHaveProperty(
      "env"
    );
  });
});

describe("createPrismaWorkerLogRepository", () => {
  it("trims persisted logs to maxRecords best effort", async () => {
    const prisma = createFakePrismaClient();
    const repository = createPrismaWorkerLogRepository(prisma, { maxRecords: 2 });

    for (let index = 0; index < 3; index += 1) {
      await repository.append(
        createContractWorkerLogRecord({
          id: `log-${index}`,
          createdAt: `2026-05-20T00:00:0${index}.000Z`
        })
      );
    }

    expect(prisma.workerLog.rows.map((row) => row.id).sort()).toEqual([
      "log-1",
      "log-2"
    ]);
    await expect(repository.list({ limit: 10 })).resolves.toMatchObject([
      { id: "log-2" },
      { id: "log-1" }
    ]);
  });

  it("rejects append when maxRecords trim fails", async () => {
    const prisma = createFakePrismaClient({
      workerLog: {
        failDeleteMany: new Error("delete failed")
      }
    });
    const repository = createPrismaWorkerLogRepository(prisma, { maxRecords: 1 });

    await repository.append(
      createContractWorkerLogRecord({
        id: "log-1",
        createdAt: "2026-05-20T00:00:01.000Z"
      })
    );

    await expect(
      repository.append(
        createContractWorkerLogRecord({
          id: "log-2",
          createdAt: "2026-05-20T00:00:02.000Z"
        })
      )
    ).rejects.toThrow("delete failed");
  });
});

function createFakePrismaClient(options: {
  workerJob?: FakeDelegateOptions;
  workerJobPayload?: FakeDelegateOptions;
  workerLog?: FakeDelegateOptions;
} = {}): PrismaWorkerClient & {
  workerJob: FakeDelegate;
  workerJobPayload: FakeDelegate;
  workerLog: FakeDelegate;
} {
  return {
    workerJob: createFakeDelegate(options.workerJob),
    workerJobPayload: createFakeDelegate(options.workerJobPayload),
    workerLog: createFakeDelegate(options.workerLog)
  };
}

function createFakeDelegate(options: FakeDelegateOptions = {}): FakeDelegate {
  const delegate: FakeDelegate = {
    rows: [],

    async upsert(input) {
      const rowIndex = delegate.rows.findIndex((row) =>
        matchesWhere(row, input.where)
      );
      const row =
        rowIndex === -1
          ? cloneRow(input.create)
          : { ...delegate.rows[rowIndex], ...cloneRow(input.update) };

      if (rowIndex === -1) {
        delegate.rows.push(row);
      } else {
        delegate.rows[rowIndex] = row;
      }

      return cloneRow(row);
    },

    async findUnique(input) {
      const row = delegate.rows.find((stored) => matchesWhere(stored, input.where));
      return row ? cloneRow(row) : null;
    },

    async findMany(input = {}) {
      let rows = delegate.rows.filter((row) => matchesWhere(row, input.where ?? {}));
      rows = sortRows(rows, input.orderBy ?? []);
      return rows.slice(0, input.take ?? rows.length).map(cloneRow);
    },

    async updateMany(input) {
      let count = 0;
      options.beforeUpdateMany?.({ input, rows: delegate.rows });
      delegate.rows = delegate.rows.map((row) => {
        if (!matchesWhere(row, input.where)) {
          return row;
        }
        count += 1;
        return { ...row, ...cloneRow(input.data) };
      });
      return { count };
    },

    async deleteMany(input = {}) {
      if (options.failDeleteMany) {
        throw options.failDeleteMany;
      }
      const originalLength = delegate.rows.length;
      delegate.rows = delegate.rows.filter(
        (row) => !matchesWhere(row, input.where ?? {})
      );
      return { count: originalLength - delegate.rows.length };
    }
  };

  return delegate;
}

function matchesWhere(row: FakeRow, where: FakeWhere): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "AND" && Array.isArray(expected)) {
      return expected.every((condition) => matchesWhere(row, condition as FakeWhere));
    }
    if (key === "OR" && Array.isArray(expected)) {
      return expected.some((condition) => matchesWhere(row, condition as FakeWhere));
    }

    return matchesValue(row[key], expected);
  });
}

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (isRecord(expected)) {
    if ("equals" in expected) {
      return valuesEqual(actual, expected.equals);
    }
    if ("in" in expected && Array.isArray(expected.in)) {
      return expected.in.some((item) => valuesEqual(actual, item));
    }
    if ("lt" in expected) {
      return compareValues(actual, expected.lt) < 0;
    }
    if ("lte" in expected) {
      return compareValues(actual, expected.lte) <= 0;
    }
    if ("gt" in expected) {
      return compareValues(actual, expected.gt) > 0;
    }
    if ("gte" in expected) {
      return compareValues(actual, expected.gte) >= 0;
    }
  }

  return valuesEqual(actual, expected);
}

function sortRows(rows: FakeRow[], orderBy: FakeOrderBy): FakeRow[] {
  return [...rows].sort((left, right) => {
    for (const order of orderBy) {
      const [field, direction] = Object.entries(order)[0] ?? [];
      if (!field || !direction) {
        continue;
      }
      const compared = compareValues(left[field], right[field]);
      if (compared !== 0) {
        return direction === "asc" ? compared : -compared;
      }
    }
    return 0;
  });
}

function compareValues(left: unknown, right: unknown): number {
  const leftValue = comparableValue(left);
  const rightValue = comparableValue(right);
  if (leftValue < rightValue) {
    return -1;
  }
  if (leftValue > rightValue) {
    return 1;
  }
  return 0;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }
  return left === right;
}

function comparableValue(value: unknown): string | number {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "number") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function cloneRow<T>(row: T): T {
  if (row instanceof Date) {
    return new Date(row.getTime()) as T;
  }
  if (Array.isArray(row)) {
    return row.map((item) => cloneRow(item)) as T;
  }
  if (isRecord(row)) {
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, cloneRow(value)])
    ) as T;
  }
  return row;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
