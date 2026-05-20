import { describe, expect, it, vi } from "vitest";
import type { PrismaWorkbenchClient, WorkbenchRepositories } from "@lp-agent/db";
import {
  createWebWorkbenchRepositories,
  resolveWorkbenchRepositoryBackend
} from "./workbench-repository-factory";

function fakeRepositories(): WorkbenchRepositories {
  return { projects: {} } as WorkbenchRepositories;
}

function fakePrismaClient(): PrismaWorkbenchClient & {
  organization: {
    upsert: ReturnType<typeof vi.fn>;
  };
  workspace: {
    upsert: ReturnType<typeof vi.fn>;
  };
} {
  return {
    organization: { upsert: vi.fn().mockResolvedValue({}) },
    workspace: { upsert: vi.fn().mockResolvedValue({}) }
  } as unknown as PrismaWorkbenchClient & {
    organization: {
      upsert: ReturnType<typeof vi.fn>;
    };
    workspace: {
      upsert: ReturnType<typeof vi.fn>;
    };
  };
}

describe("resolveWorkbenchRepositoryBackend", () => {
  it("defaults to json", () => {
    expect(resolveWorkbenchRepositoryBackend({})).toBe("json");
  });

  it("accepts supported backend values", () => {
    expect(resolveWorkbenchRepositoryBackend({ WORKBENCH_REPOSITORY_BACKEND: "json" })).toBe(
      "json"
    );
    expect(resolveWorkbenchRepositoryBackend({ WORKBENCH_REPOSITORY_BACKEND: "memory" })).toBe(
      "memory"
    );
    expect(resolveWorkbenchRepositoryBackend({ WORKBENCH_REPOSITORY_BACKEND: "postgres" })).toBe(
      "postgres"
    );
  });

  it("rejects unsupported backend values", () => {
    expect(() =>
      resolveWorkbenchRepositoryBackend({ WORKBENCH_REPOSITORY_BACKEND: "sqlite" })
    ).toThrow("Unsupported WORKBENCH_REPOSITORY_BACKEND");
  });
});

describe("createWebWorkbenchRepositories", () => {
  it("creates JSON-file repositories by default with the default state file", async () => {
    const repositories = fakeRepositories();
    const createJsonFileRepositories = vi.fn().mockReturnValue(repositories);

    await expect(
      createWebWorkbenchRepositories({
        env: {},
        createJsonFileRepositories
      })
    ).resolves.toBe(repositories);
    expect(createJsonFileRepositories).toHaveBeenCalledWith({
      filePath: ".lp-agent/workbench-state.json"
    });
  });

  it("uses memory repositories when WORKBENCH_REPOSITORY_BACKEND is memory", async () => {
    const repositories = fakeRepositories();
    const createMemoryRepositories = vi.fn().mockReturnValue(repositories);

    await expect(
      createWebWorkbenchRepositories({
        env: { WORKBENCH_REPOSITORY_BACKEND: "memory" },
        createMemoryRepositories
      })
    ).resolves.toBe(repositories);
    expect(createMemoryRepositories).toHaveBeenCalledTimes(1);
  });

  it("requires DATABASE_URL for postgres repositories", async () => {
    await expect(
      createWebWorkbenchRepositories({
        env: {
          WORKBENCH_REPOSITORY_BACKEND: "postgres",
          WORKBENCH_POSTGRES_WORKSPACE_ID: "workspace_local"
        }
      })
    ).rejects.toThrow("DATABASE_URL is required");
  });

  it("requires WORKBENCH_POSTGRES_WORKSPACE_ID for postgres repositories", async () => {
    await expect(
      createWebWorkbenchRepositories({
        env: {
          WORKBENCH_REPOSITORY_BACKEND: "postgres",
          DATABASE_URL: "postgresql://user:pass@localhost:5432/lp_agent"
        }
      })
    ).rejects.toThrow("WORKBENCH_POSTGRES_WORKSPACE_ID is required");
  });

  it("creates postgres repositories and bootstraps prerequisites when enabled", async () => {
    const repositories = fakeRepositories();
    const prisma = fakePrismaClient();
    const loadPrismaClient = vi.fn().mockResolvedValue(prisma);
    const createPrismaRepositories = vi.fn().mockReturnValue(repositories);

    await expect(
      createWebWorkbenchRepositories({
        env: {
          WORKBENCH_REPOSITORY_BACKEND: "postgres",
          DATABASE_URL: "postgresql://user:pass@localhost:5432/lp_agent",
          WORKBENCH_POSTGRES_WORKSPACE_ID: "workspace_local",
          WORKBENCH_POSTGRES_BOOTSTRAP: "1"
        },
        loadPrismaClient,
        createPrismaRepositories
      })
    ).resolves.toBe(repositories);

    expect(loadPrismaClient).toHaveBeenCalledTimes(1);
    expect(prisma.organization.upsert).toHaveBeenCalledWith({
      where: { id: "org_local" },
      create: { id: "org_local", name: "Local Organization" },
      update: { name: "Local Organization" }
    });
    expect(prisma.workspace.upsert).toHaveBeenCalledWith({
      where: { id: "workspace_local" },
      create: {
        id: "workspace_local",
        organizationId: "org_local",
        name: "Local Workspace"
      },
      update: {
        organizationId: "org_local",
        name: "Local Workspace"
      }
    });
    expect(createPrismaRepositories).toHaveBeenCalledWith({
      prisma,
      workspaceId: "workspace_local"
    });
  });
});
