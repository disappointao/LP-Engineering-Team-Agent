import { join } from "node:path";

import {
  InMemoryWorkerJobPayloadRepository,
  InMemoryWorkerJobRepository,
  InMemoryWorkerLogRepository,
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter,
  type WorkerJobPayloadRepository,
  type WorkerJobRepository,
  type WorkerLogRepository
} from "@lp-agent/worker-runtime";
import {
  createLocalWorkerQueueRuntime,
  type LocalWorkerQueueRuntime
} from "./skill-command-worker-queue";

export type WorkerRepositoryBackend = "json" | "memory" | "postgres";

export type WorkerQueueRuntimeEnv = Partial<Record<string, string | undefined>>;

export interface WorkerQueueRuntimeRepositories {
  jobRepository: WorkerJobRepository;
  payloadRepository: WorkerJobPayloadRepository;
  workerLogRepository: WorkerLogRepository;
}

export interface WorkerQueueRuntimeRepositoryFactoryResult {
  jobRepository: WorkerJobRepository;
  payloadRepository: WorkerJobPayloadRepository;
  workerLogRepository?: WorkerLogRepository;
  logRepository?: WorkerLogRepository;
}

export interface CreateWorkerQueueRuntimeOptions {
  env?: WorkerQueueRuntimeEnv;
  loadPrismaClient?: () => Promise<unknown>;
  createPrismaWorkerRepositories?: (
    client: unknown
  ) =>
    | WorkerQueueRuntimeRepositoryFactoryResult
    | Promise<WorkerQueueRuntimeRepositoryFactoryResult>;
  createLocalWorkerQueueRuntime?: (input: {
    jobsFilePath: string;
    payloadsFilePath: string;
    logsFilePath?: string;
  }) => LocalWorkerQueueRuntime;
}

let cachedPrismaClient: unknown;

export function resolveWorkerRepositoryBackend(
  env: WorkerQueueRuntimeEnv
): WorkerRepositoryBackend {
  const value = env.WORKER_REPOSITORY_BACKEND ?? "json";
  if (value === "json" || value === "memory" || value === "postgres") {
    return value;
  }

  throw new Error(`Unsupported WORKER_REPOSITORY_BACKEND: ${value}`);
}

export async function createWorkerQueueRuntime(
  options: CreateWorkerQueueRuntimeOptions = {}
): Promise<LocalWorkerQueueRuntime> {
  const env = options.env ?? process.env;
  const backend = resolveWorkerRepositoryBackend(env);

  if (backend === "json") {
    return (options.createLocalWorkerQueueRuntime ?? createLocalWorkerQueueRuntime)({
      jobsFilePath: env.WORKER_JOBS_FILE ?? join(".lp-agent", "worker-jobs.json"),
      payloadsFilePath:
        env.WORKER_PAYLOADS_FILE ?? join(".lp-agent", "worker-payloads.json"),
      logsFilePath: env.WORKER_LOGS_FILE
    });
  }

  if (backend === "memory") {
    return createRuntimeFromRepositories(createInMemoryWorkerRepositories());
  }

  if (!env.DATABASE_URL) {
    throw new Error("WORKER_REPOSITORY_BACKEND=postgres requires DATABASE_URL");
  }

  const prisma = await (options.loadPrismaClient ?? loadDefaultPrismaClient)();
  const repositories = await (options.createPrismaWorkerRepositories ??
    createDefaultPrismaWorkerRepositories)(prisma);
  return createRuntimeFromRepositories(repositories);
}

function createInMemoryWorkerRepositories(): WorkerQueueRuntimeRepositories {
  return {
    jobRepository: new InMemoryWorkerJobRepository(),
    payloadRepository: new InMemoryWorkerJobPayloadRepository(),
    workerLogRepository: new InMemoryWorkerLogRepository()
  };
}

function createRuntimeFromRepositories(
  repositories: WorkerQueueRuntimeRepositoryFactoryResult
): LocalWorkerQueueRuntime {
  const workerLogRepository =
    repositories.workerLogRepository ?? repositories.logRepository;
  if (!workerLogRepository) {
    throw new Error("worker_log_repository_required");
  }

  return {
    jobRepository: repositories.jobRepository,
    payloadRepository: repositories.payloadRepository,
    workerLogRepository,
    runtime: new InMemoryWorkerRuntime({
      repository: repositories.jobRepository,
      payloadRepository: repositories.payloadRepository,
      adapter: new SimulatedExecutionAdapter()
    })
  };
}

async function loadDefaultPrismaClient(): Promise<unknown> {
  if (cachedPrismaClient) {
    return cachedPrismaClient;
  }

  const importModule = new Function("specifier", "return import(specifier)") as <
    T
  >(
    specifier: string
  ) => Promise<T>;
  const prismaModule = await importModule<{
    PrismaClient: new () => unknown;
  }>("@prisma/client");
  cachedPrismaClient = new prismaModule.PrismaClient();
  return cachedPrismaClient;
}

async function createDefaultPrismaWorkerRepositories(
  client: unknown
): Promise<WorkerQueueRuntimeRepositories> {
  const db = await import("@lp-agent/db");
  return {
    jobRepository: db.createPrismaWorkerJobRepository(client as never),
    payloadRepository: db.createPrismaWorkerJobPayloadRepository(client as never),
    workerLogRepository: db.createPrismaWorkerLogRepository(client as never)
  };
}
