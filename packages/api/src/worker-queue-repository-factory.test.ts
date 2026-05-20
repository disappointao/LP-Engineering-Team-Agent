import { join } from "node:path";

import {
  InMemoryWorkerJobPayloadRepository,
  InMemoryWorkerJobRepository,
  InMemoryWorkerLogRepository,
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter,
  createSimulatedSandboxPolicy
} from "@lp-agent/worker-runtime";
import { describe, expect, it, vi } from "vitest";
import type { LocalWorkerQueueRuntime } from "./skill-command-worker-queue";
import {
  createWorkerQueueRuntime,
  resolveWorkerRepositoryBackend
} from "./worker-queue-repository-factory";

describe("worker queue repository factory", () => {
  it("defaults to json backend", () => {
    expect(resolveWorkerRepositoryBackend({})).toBe("json");
    expect(resolveWorkerRepositoryBackend({ WORKER_REPOSITORY_BACKEND: "json" })).toBe(
      "json"
    );
  });

  it("accepts memory and postgres backend values", () => {
    expect(resolveWorkerRepositoryBackend({ WORKER_REPOSITORY_BACKEND: "memory" })).toBe(
      "memory"
    );
    expect(resolveWorkerRepositoryBackend({ WORKER_REPOSITORY_BACKEND: "postgres" })).toBe(
      "postgres"
    );
  });

  it("fails closed for unsupported backend values", () => {
    expect(() =>
      resolveWorkerRepositoryBackend({ WORKER_REPOSITORY_BACKEND: "sqlite" })
    ).toThrow(/Unsupported WORKER_REPOSITORY_BACKEND/);
  });

  it("creates default json runtime paths and honors env file paths", async () => {
    const createLocalWorkerQueueRuntime = vi.fn(
      (input: {
        jobsFilePath: string;
        payloadsFilePath: string;
        logsFilePath?: string;
      }): LocalWorkerQueueRuntime => {
        const repositories = createInMemoryWorkerRepositories();
        return {
          ...repositories,
          runtime: createRuntime(repositories)
        };
      }
    );

    await createWorkerQueueRuntime({ env: {}, createLocalWorkerQueueRuntime });

    expect(createLocalWorkerQueueRuntime).toHaveBeenCalledWith({
      jobsFilePath: join(".lp-agent", "worker-jobs.json"),
      payloadsFilePath: join(".lp-agent", "worker-payloads.json"),
      logsFilePath: undefined
    });

    await createWorkerQueueRuntime({
      env: {
        WORKER_JOBS_FILE: "tmp/jobs.json",
        WORKER_PAYLOADS_FILE: "tmp/payloads.json",
        WORKER_LOGS_FILE: "tmp/logs.json"
      },
      createLocalWorkerQueueRuntime
    });

    expect(createLocalWorkerQueueRuntime).toHaveBeenLastCalledWith({
      jobsFilePath: "tmp/jobs.json",
      payloadsFilePath: "tmp/payloads.json",
      logsFilePath: "tmp/logs.json"
    });
  });

  it("creates a memory runtime without file paths", async () => {
    const runtime = await createWorkerQueueRuntime({
      env: { WORKER_REPOSITORY_BACKEND: "memory" }
    });

    const queued = await runtime.runtime.enqueueSafe(
      {
        projectId: "project-1",
        kind: "tool_command",
        commandId: "deploy-preview",
        command: "deploy preview",
        args: [],
        envNames: [],
        timeoutMs: 30000
      },
      createSimulatedSandboxPolicy()
    );

    expect(queued.state).toBe("queued");
    await expect(runtime.payloadRepository.getByJobId(queued.id)).resolves.toMatchObject({
      jobId: queued.id,
      projectId: "project-1"
    });
  });

  it("fails closed for postgres without DATABASE_URL", async () => {
    await expect(
      createWorkerQueueRuntime({
        env: { WORKER_REPOSITORY_BACKEND: "postgres" },
        loadPrismaClient: vi.fn()
      })
    ).rejects.toThrow(/DATABASE_URL/);
  });

  it("uses injected postgres repositories without loading generated client in unit tests", async () => {
    const prisma = { prisma: true };
    const loadPrismaClient = vi.fn(async () => prisma);
    const createPrismaWorkerRepositories = vi.fn(() => createInMemoryWorkerRepositories());

    const runtime = await createWorkerQueueRuntime({
      env: {
        WORKER_REPOSITORY_BACKEND: "postgres",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/lp_agent"
      },
      loadPrismaClient,
      createPrismaWorkerRepositories
    });

    expect(loadPrismaClient).toHaveBeenCalledTimes(1);
    expect(createPrismaWorkerRepositories).toHaveBeenCalledWith(prisma);

    const queued = await runtime.runtime.enqueueSafe(
      {
        projectId: "project-1",
        kind: "tool_command",
        commandId: "postgres-runtime",
        command: "deploy preview",
        args: [],
        envNames: [],
        timeoutMs: 30000
      },
      createSimulatedSandboxPolicy()
    );

    expect(await runtime.jobRepository.getById(queued.id)).toMatchObject({
      id: queued.id,
      state: "queued"
    });
  });
});

function createInMemoryWorkerRepositories() {
  return {
    jobRepository: new InMemoryWorkerJobRepository(),
    payloadRepository: new InMemoryWorkerJobPayloadRepository(),
    workerLogRepository: new InMemoryWorkerLogRepository()
  };
}

function createRuntime(repositories: ReturnType<typeof createInMemoryWorkerRepositories>) {
  return new InMemoryWorkerRuntime({
    repository: repositories.jobRepository,
    payloadRepository: repositories.payloadRepository,
    adapter: new SimulatedExecutionAdapter()
  });
}
