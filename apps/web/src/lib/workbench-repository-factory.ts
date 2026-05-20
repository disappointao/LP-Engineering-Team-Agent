import {
  createInMemoryWorkbenchRepositories,
  createJsonFileWorkbenchRepositories,
  createPrismaWorkbenchRepositories,
  type PrismaWorkbenchClient,
  type WorkbenchRepositories
} from "@lp-agent/db";

export type WorkbenchRepositoryBackend = "json" | "memory" | "postgres";

type WorkbenchRepositoryEnv = Record<string, string | undefined>;

type BootstrapDelegate = {
  upsert(input: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<unknown>;
};

type BootstrapPrismaWorkbenchClient = PrismaWorkbenchClient & {
  organization: BootstrapDelegate;
  workspace: BootstrapDelegate;
};

export interface CreateWebWorkbenchRepositoriesOptions {
  env?: WorkbenchRepositoryEnv;
  createMemoryRepositories?: () => WorkbenchRepositories;
  createJsonFileRepositories?: (options: { filePath: string }) => WorkbenchRepositories;
  loadPrismaClient?: () => Promise<PrismaWorkbenchClient>;
  createPrismaRepositories?: (options: {
    prisma: PrismaWorkbenchClient;
    workspaceId: string;
  }) => WorkbenchRepositories;
}

const DEFAULT_JSON_FILE_PATH = ".lp-agent/workbench-state.json";
const DEFAULT_POSTGRES_ORGANIZATION_ID = "org_local";
const DEFAULT_POSTGRES_ORGANIZATION_NAME = "Local Organization";
const DEFAULT_POSTGRES_WORKSPACE_NAME = "Local Workspace";

const prismaGlobal = globalThis as typeof globalThis & {
  __lpAgentWebWorkbenchPrismaClient?: PrismaWorkbenchClient;
};

export function resolveWorkbenchRepositoryBackend(
  env: WorkbenchRepositoryEnv
): WorkbenchRepositoryBackend {
  const backend = env.WORKBENCH_REPOSITORY_BACKEND ?? "json";
  if (backend === "json" || backend === "memory" || backend === "postgres") {
    return backend;
  }

  throw new Error(`Unsupported WORKBENCH_REPOSITORY_BACKEND: ${backend}`);
}

export async function createWebWorkbenchRepositories(
  options: CreateWebWorkbenchRepositoriesOptions = {}
): Promise<WorkbenchRepositories> {
  const env = options.env ?? process.env;
  const backend = resolveWorkbenchRepositoryBackend(env);

  if (backend === "memory") {
    return (options.createMemoryRepositories ?? createInMemoryWorkbenchRepositories)();
  }

  if (backend === "json") {
    return (options.createJsonFileRepositories ?? createJsonFileWorkbenchRepositories)({
      filePath: env.LP_AGENT_WORKBENCH_STATE_FILE ?? DEFAULT_JSON_FILE_PATH
    });
  }

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for WORKBENCH_REPOSITORY_BACKEND=postgres");
  }

  const workspaceId = env.WORKBENCH_POSTGRES_WORKSPACE_ID;
  if (!workspaceId) {
    throw new Error(
      "WORKBENCH_POSTGRES_WORKSPACE_ID is required for WORKBENCH_REPOSITORY_BACKEND=postgres"
    );
  }

  const prisma = await (options.loadPrismaClient ?? loadDefaultPrismaClient)();
  if (env.WORKBENCH_POSTGRES_BOOTSTRAP === "1") {
    await bootstrapPostgresWorkbench(prisma as BootstrapPrismaWorkbenchClient, env, workspaceId);
  }

  return (options.createPrismaRepositories ?? createPrismaWorkbenchRepositories)({
    prisma,
    workspaceId
  });
}

export async function loadDefaultPrismaClient(): Promise<PrismaWorkbenchClient> {
  if (prismaGlobal.__lpAgentWebWorkbenchPrismaClient) {
    return prismaGlobal.__lpAgentWebWorkbenchPrismaClient;
  }

  const importRuntimeModule = new Function("moduleName", "return import(moduleName)") as (
    moduleName: string
  ) => Promise<{
    PrismaClient: new () => PrismaWorkbenchClient;
  }>;
  const prismaModule = await importRuntimeModule("@prisma/client");
  prismaGlobal.__lpAgentWebWorkbenchPrismaClient = new prismaModule.PrismaClient();
  return prismaGlobal.__lpAgentWebWorkbenchPrismaClient;
}

async function bootstrapPostgresWorkbench(
  prisma: BootstrapPrismaWorkbenchClient,
  env: WorkbenchRepositoryEnv,
  workspaceId: string
): Promise<void> {
  const organizationId =
    env.WORKBENCH_POSTGRES_ORGANIZATION_ID ?? DEFAULT_POSTGRES_ORGANIZATION_ID;
  const organizationName =
    env.WORKBENCH_POSTGRES_ORGANIZATION_NAME ?? DEFAULT_POSTGRES_ORGANIZATION_NAME;
  const workspaceName = env.WORKBENCH_POSTGRES_WORKSPACE_NAME ?? DEFAULT_POSTGRES_WORKSPACE_NAME;

  await prisma.organization.upsert({
    where: { id: organizationId },
    create: { id: organizationId, name: organizationName },
    update: { name: organizationName }
  });
  await prisma.workspace.upsert({
    where: { id: workspaceId },
    create: { id: workspaceId, organizationId, name: workspaceName },
    update: { organizationId, name: workspaceName }
  });
}
