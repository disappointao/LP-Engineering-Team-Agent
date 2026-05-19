// Manual opt-in:
// POSTGRES_REPOSITORY_TEST=1 DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" \
//   pnpm exec vitest run packages/db/src/prisma-workbench-repositories.integration.test.ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
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

  runCoreWorkbenchRepositoryContractTests({
    name: "prisma postgres",
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
} else {
  describe("prisma postgres repository integration", () => {
    it("is skipped unless explicitly enabled with a database URL", () => {
      expect(shouldRun).toBe(false);
    });
  });
}

interface SeedPrismaClient {
  organization: {
    upsert(args: unknown): Promise<unknown>;
  };
  workspace: {
    upsert(args: unknown): Promise<unknown>;
  };
  project: {
    upsert(args: unknown): Promise<unknown>;
  };
  lPBrief: {
    upsert(args: unknown): Promise<unknown>;
  };
  pageVersion: {
    upsert(args: unknown): Promise<unknown>;
  };
  run: {
    upsert(args: unknown): Promise<unknown>;
  };
}

async function seedContractPrerequisites(input: {
  prisma: SeedPrismaClient;
  organizationId: string;
  workspaceId: string;
}): Promise<void> {
  const { prisma, organizationId, workspaceId } = input;
  const createdAt = new Date("2026-05-14T00:00:00.000Z");

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
  await prisma.project.upsert({
    where: { id: "project_contract_1" },
    create: {
      id: "project_contract_1",
      workspaceId,
      name: "Spring sale",
      createdAt
    },
    update: {
      workspaceId,
      name: "Spring sale",
      createdAt
    }
  });
  await prisma.project.upsert({
    where: { id: "project_contract_distractor" },
    create: {
      id: "project_contract_distractor",
      workspaceId,
      name: "Distractor project",
      createdAt
    },
    update: {
      workspaceId,
      name: "Distractor project",
      createdAt
    }
  });
  await prisma.lPBrief.upsert({
    where: { id: "brief_contract_1" },
    create: {
      id: "brief_contract_1",
      projectId: "project_contract_1",
      title: "Spring Sale Landing Page",
      prompt: "Create a spring sale landing page.",
      data: {
        title: "Spring Sale Landing Page"
      },
      createdAt
    },
    update: {
      projectId: "project_contract_1",
      title: "Spring Sale Landing Page",
      prompt: "Create a spring sale landing page.",
      data: {
        title: "Spring Sale Landing Page"
      },
      createdAt
    }
  });
  await prisma.pageVersion.upsert({
    where: { id: "version_contract_1" },
    create: {
      id: "version_contract_1",
      projectId: "project_contract_1",
      briefId: "brief_contract_1",
      artifactData: {
        indexHtml: "<!doctype html><html><body><h1>Spring sale</h1></body></html>",
        stylesCss: "body { margin: 0; color: #17202a; }",
        scriptJs: "console.log('spring sale ready');"
      },
      artifactWorkspaceId: null,
      findings: [],
      reviewStatus: "passed",
      createdAt
    },
    update: {
      projectId: "project_contract_1",
      briefId: "brief_contract_1",
      artifactData: {
        indexHtml: "<!doctype html><html><body><h1>Spring sale</h1></body></html>",
        stylesCss: "body { margin: 0; color: #17202a; }",
        scriptJs: "console.log('spring sale ready');"
      },
      artifactWorkspaceId: null,
      findings: [],
      reviewStatus: "passed",
      createdAt
    }
  });

  for (const run of [
    {
      id: "run_contract_reviewer_1",
      projectId: "project_contract_1",
      taskId: "task_contract_1"
    },
    {
      id: "run_contract_reviewer_2",
      projectId: "project_contract_1",
      taskId: "task_contract_1"
    },
    {
      id: "run_contract_reviewer_3",
      projectId: "project_contract_distractor",
      taskId: "task_contract_distractor"
    }
  ]) {
    await prisma.run.upsert({
      where: { id: run.id },
      create: {
        id: run.id,
        projectId: run.projectId,
        taskId: run.taskId,
        role: "reviewer",
        state: "completed",
        startedAt: createdAt,
        completedAt: createdAt,
        contextSummary: {
          injected: [],
          omitted: []
        }
      },
      update: {
        projectId: run.projectId,
        taskId: run.taskId,
        role: "reviewer",
        state: "completed",
        startedAt: createdAt,
        completedAt: createdAt,
        contextSummary: {
          injected: [],
          omitted: []
        }
      }
    });
  }
}
