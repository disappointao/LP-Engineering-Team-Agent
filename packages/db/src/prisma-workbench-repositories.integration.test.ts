// Manual opt-in:
// pnpm --filter @lp-agent/db db:generate && \
// POSTGRES_REPOSITORY_TEST=1 DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" \
//   pnpm exec vitest run packages/db/src/prisma-workbench-repositories.integration.test.ts
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { runCoreWorkbenchRepositoryContractTests } from "./workbench-repository-contract";
import type { PrismaWorkbenchClient } from "./prisma-workbench-repositories";

const shouldRun =
  process.env.POSTGRES_REPOSITORY_TEST === "1" && Boolean(process.env.DATABASE_URL);

if (shouldRun) {
  const { PrismaClient } = (await import("@prisma/client")) as unknown as {
    PrismaClient: new () => PrismaWorkbenchClient & SeedPrismaClient;
  };
  const prisma = new PrismaClient();
  const organizationId = `org_${randomUUID()}`;
  const workspaceId = `workspace_${randomUUID()}`;
  const idPrefix = `contract_${randomUUID().replaceAll("-", "_")}_`;

  afterAll(async () => {
    await prisma.$disconnect();
  });

  runCoreWorkbenchRepositoryContractTests({
    name: "prisma postgres",
    idPrefix,
    async createRepositories() {
      await seedContractPrerequisites({
        prisma,
        organizationId,
        workspaceId
      });

      const { createPrismaWorkbenchRepositories } = await import(
        "./prisma-workbench-repositories"
      );

      return createPrismaWorkbenchRepositories({
        prisma,
        workspaceId
      });
    }
  });

  it("persists Web-facing repository records with a real Prisma client", async () => {
    await seedContractPrerequisites({
      prisma,
      organizationId,
      workspaceId
    });
    const { createPrismaWorkbenchRepositories } = await import(
      "./prisma-workbench-repositories"
    );
    const repositories = createPrismaWorkbenchRepositories({
      prisma,
      workspaceId
    });
    const projectId = `${idPrefix}web_project`;
    const timestamp = new Date().toISOString();

    await repositories.projects.save({
      id: projectId,
      name: "Web integration project",
      createdAt: timestamp
    });
    await repositories.projectMembers.save({
      id: `${idPrefix}member`,
      projectId,
      userId: `${idPrefix}user`,
      role: "owner",
      displayName: "Integration User",
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await expect(repositories.projectMembers.listForProject(projectId)).resolves.toHaveLength(1);
  });
} else {
  describe("prisma postgres repository integration", () => {
    it("is skipped unless explicitly enabled with a database URL", () => {
      expect(shouldRun).toBe(false);
    });
  });
}

interface SeedPrismaClient {
  $disconnect(): Promise<void>;
  organization: {
    upsert(args: unknown): Promise<unknown>;
  };
  workspace: {
    upsert(args: unknown): Promise<unknown>;
  };
}

async function seedContractPrerequisites(input: {
  prisma: SeedPrismaClient;
  organizationId: string;
  workspaceId: string;
}): Promise<void> {
  const { prisma, organizationId, workspaceId } = input;

  await prisma.organization.upsert({
    where: { id: organizationId },
    create: {
      id: organizationId,
      name: "Repository contract organization"
    },
    update: {
      name: "Repository contract organization"
    }
  });
  await prisma.workspace.upsert({
    where: { id: workspaceId },
    create: {
      id: workspaceId,
      organizationId,
      name: "Repository contract workspace"
    },
    update: {
      organizationId,
      name: "Repository contract workspace"
    }
  });
}
