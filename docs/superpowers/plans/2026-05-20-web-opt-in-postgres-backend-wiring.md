# Web Opt-in Postgres Backend Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit `WORKBENCH_REPOSITORY_BACKEND=postgres` Web/API runtime path that uses Prisma/Postgres repositories without changing the default JSON-file backend.

**Architecture:** Keep `DemoWorkbenchService` and Web code dependent on `WorkbenchRepositories`. First extend Prisma schema/repositories to cover the Web-facing repository closure, then add an async Web repository factory that selects `json`, `memory`, or `postgres`, then wire `getWebWorkbenchStore()` through that factory and document the opt-in path.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Next.js server actions, Prisma schema validation, optional `@prisma/client`, existing `@lp-agent/db` repository contracts.

---

## File Structure

- Modify `packages/db/prisma/schema.prisma`
  - Add missing Stage 23 fields/models for Web-facing repositories.
- Modify `packages/db/src/prisma-schema-contract.test.ts`
  - Extend schema text coverage to Stage 23 fields and models.
- Modify `packages/db/src/prisma-workbench-mappers.ts`
  - Add pure mapper helpers for project members, deployments, skills, model routes, MCP connector state, and MCP approvals.
- Modify `packages/db/src/prisma-workbench-mappers.test.ts`
  - Add mapper round-trip coverage for Date, JSON, optional fields, connector tools, and deployment files.
- Modify `packages/db/src/prisma-workbench-repositories.ts`
  - Implement Stage 23 Prisma repositories and keep only non-Web repositories unsupported.
- Modify `packages/db/src/prisma-workbench-repositories.test.ts`
  - Add fake Prisma delegate coverage for the Web-facing repository closure.
- Modify `packages/db/src/prisma-workbench-repositories.integration.test.ts`
  - Add opt-in integration coverage for bootstrap prerequisites and Web-facing repositories.
- Create `apps/web/src/lib/workbench-repository-factory.ts`
  - Resolve backend config and create JSON, memory, or Postgres repositories.
- Create `apps/web/src/lib/workbench-repository-factory.test.ts`
  - Test default JSON behavior, fail-closed Postgres config, bootstrap, and factory selection.
- Modify `apps/web/src/lib/workbench-store.ts`
  - Make `getWebWorkbenchStore()` async and call the repository factory.
- Modify `apps/web/src/app/page.tsx`
  - Await the async store.
- Modify `apps/web/src/app/actions.ts`
  - Await the async store in every server action.
- Modify `apps/web/src/lib/workbench-store.test.ts`, `apps/web/src/lib/web-v1-smoke.test.ts`, and any other direct callers found by `rg "getWebWorkbenchStore\\(" apps/web/src`
  - Await the async store.
- Modify `README.md` and `docs/development.md`
  - Document Web Postgres opt-in env vars, bootstrap, validation, and default JSON fallback.
- Modify `docs/project-roadmap.md`
  - Mark Stage 23 as implemented and keep Stage 24-26 queue accurate.
- Modify `docs/agent-development-learning.md`
  - Move Stage 23 from design-only to implemented and capture backend selection learning points.
- Modify `docs/superpowers/README.md`
  - Add this implementation plan to the reading order.

---

### Task 1: Stage 23 Prisma Schema Contract

**Files:**
- Modify: `packages/db/src/prisma-schema-contract.test.ts`
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Extend the schema contract test**

In `packages/db/src/prisma-schema-contract.test.ts`, add a second test after the existing Stage 22 test:

```ts
it("contains Stage 23 Web-facing repository fields and models", async () => {
  const schema = await readFile(schemaPath, "utf8");

  for (const model of ["MCPToolApproval", "ProjectMember", "SkillVersion", "MCPConnector"]) {
    expect(schema).toContain(`model ${model} `);
  }

  for (const field of [
    "displayName",
    "updatedAt",
    "contentType",
    "description",
    "toolsJson",
    "approvedByUserId",
    "files"
  ]) {
    expect(schema).toContain(field);
  }

  expect(schema).toContain("@@unique([projectId, connectorId, toolName])");
});
```

- [ ] **Step 2: Run the schema contract test to verify it fails**

Run:

```bash
pnpm exec vitest run packages/db/src/prisma-schema-contract.test.ts
```

Expected: FAIL because `MCPToolApproval`, `contentType`, `toolsJson`, `approvedByUserId`, deployment `files`, and project member display/update fields are not all present yet.

- [ ] **Step 3: Align `schema.prisma` for Stage 23**

Edit `packages/db/prisma/schema.prisma`.

Add the relation to `model Project`:

```prisma
  mcpToolApprovals      MCPToolApproval[]
```

Update `model ProjectMember` to preserve repository fields:

```prisma
model ProjectMember {
  id          String      @id @default(cuid())
  projectId   String
  userId      String
  role        ProjectRole
  displayName String?
  project     Project     @relation(fields: [projectId], references: [id])
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  @@unique([projectId, userId])
  @@index([userId])
}
```

Update `model SkillVersion`:

```prisma
  contentType String           @default("text/markdown")
```

Update `model MCPConnector`:

```prisma
  description String?
  toolsJson   Json?
  approvals   MCPToolApproval[]
```

Add `model MCPToolApproval` after `model MCPTool`:

```prisma
model MCPToolApproval {
  id               String       @id
  projectId        String
  connectorId      String
  toolName         String
  state            String
  approvedByUserId String?
  project          Project      @relation(fields: [projectId], references: [id])
  connector        MCPConnector @relation(fields: [connectorId], references: [id])
  createdAt        DateTime
  updatedAt        DateTime

  @@unique([projectId, connectorId, toolName])
  @@index([projectId])
  @@index([connectorId])
  @@index([state])
}
```

Update `model Deployment`:

```prisma
  files          Json
```

- [ ] **Step 4: Run schema validation and the schema contract test**

Run:

```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm --filter @lp-agent/db db:validate
pnpm exec vitest run packages/db/src/prisma-schema-contract.test.ts
```

Expected: Prisma schema is valid; schema contract test passes.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/src/prisma-schema-contract.test.ts
git commit -m "align web postgres schema contract"
```

---

### Task 2: Stage 23 Prisma Mappers

**Files:**
- Modify: `packages/db/src/prisma-workbench-mappers.ts`
- Modify: `packages/db/src/prisma-workbench-mappers.test.ts`

- [ ] **Step 1: Write failing mapper tests**

In `packages/db/src/prisma-workbench-mappers.test.ts`, extend imports with the new mapper functions:

```ts
import {
  toPrismaMCPConnectorCreate,
  toPrismaMCPToolApprovalCreate,
  toPrismaModelProviderCreate,
  toPrismaModelRoutingPolicyCreate,
  toPrismaProjectMemberCreate,
  toPrismaSkillBindingCreate,
  toPrismaSkillCreate,
  toPrismaSkillVersionCreate,
  toRepositoryMCPConnector,
  toRepositoryMCPToolApproval,
  toRepositoryModelProvider,
  toRepositoryModelRoutingPolicy,
  toRepositoryProjectMember,
  toRepositorySkill,
  toRepositorySkillBinding,
  toRepositorySkillVersion
} from "./prisma-workbench-mappers";
```

Add tests:

```ts
it("maps project members with display name and updated timestamp", () => {
  const member = {
    id: "member_1",
    projectId: "project_1",
    userId: "user_1",
    role: "owner" as const,
    displayName: "Ada",
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:01:00.000Z"
  };

  expect(toPrismaProjectMemberCreate(member)).toEqual({
    id: "member_1",
    projectId: "project_1",
    userId: "user_1",
    role: "owner",
    displayName: "Ada",
    createdAt: new Date("2026-05-20T00:00:00.000Z"),
    updatedAt: new Date("2026-05-20T00:01:00.000Z")
  });
  expect(
    toRepositoryProjectMember({
      id: "member_1",
      projectId: "project_1",
      userId: "user_1",
      role: "owner",
      displayName: "Ada",
      createdAt: new Date("2026-05-20T00:00:00.000Z"),
      updatedAt: new Date("2026-05-20T00:01:00.000Z")
    })
  ).toEqual(member);
});

it("maps skill records and preserves content type", () => {
  const skill = {
    id: "skill_1",
    name: "Deploy",
    type: "deployment" as const,
    scope: "project" as const,
    createdAt: "2026-05-20T00:00:00.000Z"
  };
  const version = {
    id: "skill_version_1",
    skillId: "skill_1",
    version: "1.0.0",
    manifest: {
      id: "skill_1",
      name: "Deploy",
      version: "1.0.0",
      type: "deployment",
      scope: "project",
      reviewState: "published",
      commands: []
    },
    content: "# Deploy",
    contentType: "text/markdown" as const,
    reviewState: "published" as const,
    createdAt: "2026-05-20T00:00:00.000Z"
  };

  expect(toRepositorySkill(toPrismaSkillCreate(skill))).toEqual(skill);
  expect(toRepositorySkillVersion(toPrismaSkillVersionCreate(version))).toEqual(version);
});

it("maps model routes with fallback and settings JSON", () => {
  const provider = {
    id: "provider_1",
    scope: "project" as const,
    targetKey: "project_1",
    name: "Primary",
    provider: "custom" as const,
    config: {
      api: "openai-completions" as const,
      baseUrl: "https://models.example.test",
      apiKeyEnv: "MODEL_API_KEY",
      models: [{ id: "gpt-5.4" }]
    },
    enabled: true,
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:01:00.000Z"
  };
  const policy = {
    id: "route_1",
    scope: "project" as const,
    targetKey: "project_1",
    role: "builder" as const,
    providerId: "provider_1",
    model: "gpt-5.4",
    fallback: { providerId: "provider_2", model: "gpt-5.4-mini" },
    settings: { temperature: 0.2 },
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:01:00.000Z"
  };

  expect(toRepositoryModelProvider(toPrismaModelProviderCreate(provider))).toEqual(provider);
  expect(toRepositoryModelRoutingPolicy(toPrismaModelRoutingPolicyCreate(policy))).toEqual(policy);
});

it("maps MCP connector tools and approvals", () => {
  const connector = {
    id: "connector_1",
    scope: "project" as const,
    targetKey: "project_1",
    name: "Docs",
    description: "Read docs",
    tools: [
      {
        name: "search",
        description: "Search docs",
        permission: "read" as const,
        roles: ["planner" as const],
        requiresApproval: false
      }
    ],
    enabled: true,
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:01:00.000Z"
  };
  const approval = {
    id: "approval_1",
    projectId: "project_1",
    connectorId: "connector_1",
    toolName: "search",
    state: "approved" as const,
    approvedByUserId: "user_1",
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:01:00.000Z"
  };

  expect(toRepositoryMCPConnector(toPrismaMCPConnectorCreate(connector))).toEqual(connector);
  expect(toRepositoryMCPToolApproval(toPrismaMCPToolApprovalCreate(approval))).toEqual(approval);
});
```

- [ ] **Step 2: Run mapper tests to verify they fail**

Run:

```bash
pnpm exec vitest run packages/db/src/prisma-workbench-mappers.test.ts
```

Expected: FAIL because the new mapper functions do not exist.

- [ ] **Step 3: Add mapper types and functions**

In `packages/db/src/prisma-workbench-mappers.ts`, extend imports:

```ts
import type { DeploymentHandoff } from "@lp-agent/git-deployment";
import type {
  MCPConnectorRecord,
  MCPToolApprovalRecord,
  ModelProviderRecord,
  ModelRoutingPolicyRecord,
  ProjectMemberRecord,
  SkillBindingRecord,
  SkillRecord,
  SkillVersionRecord
} from "./workbench-repositories";
```

Add row/create interfaces for each new record, following the existing `PrismaRunRow` pattern:

```ts
export interface PrismaProjectMemberRow extends PrismaProjectMemberCreate {}
export interface PrismaProjectMemberCreate {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectMemberRecord["role"];
  displayName?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

Repeat this shape for:

- `PrismaSkillRow` / `PrismaSkillCreate`
- `PrismaSkillVersionRow` / `PrismaSkillVersionCreate`
- `PrismaSkillBindingRow` / `PrismaSkillBindingCreate`
- `PrismaModelProviderRow` / `PrismaModelProviderCreate`
- `PrismaModelRoutingPolicyRow` / `PrismaModelRoutingPolicyCreate`
- `PrismaMCPConnectorRow` / `PrismaMCPConnectorCreate`
- `PrismaMCPToolApprovalRow` / `PrismaMCPToolApprovalCreate`
- `PrismaDeploymentRow` / `PrismaDeploymentCreate`

Add mapper functions with these exact names:

```ts
export function toPrismaProjectMemberCreate(
  member: ProjectMemberRecord
): PrismaProjectMemberCreate {
  return {
    id: member.id,
    projectId: member.projectId,
    userId: member.userId,
    role: member.role,
    ...(member.displayName ? { displayName: member.displayName } : {}),
    createdAt: new Date(member.createdAt),
    updatedAt: new Date(member.updatedAt)
  };
}

export function toRepositoryProjectMember(row: PrismaProjectMemberRow): ProjectMemberRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    role: row.role,
    ...(row.displayName ? { displayName: row.displayName } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
```

For JSON fields, clone values before returning:

```ts
export function toPrismaModelProviderCreate(
  provider: ModelProviderRecord
): PrismaModelProviderCreate {
  return {
    id: provider.id,
    scope: provider.scope,
    targetKey: provider.targetKey,
    name: provider.name,
    provider: provider.provider,
    config: structuredClone(provider.config),
    enabled: provider.enabled,
    createdAt: new Date(provider.createdAt),
    updatedAt: new Date(provider.updatedAt)
  };
}
```

For `MCPConnectorRecord.tools`, store them in `toolsJson`:

```ts
export function toPrismaMCPConnectorCreate(
  connector: MCPConnectorRecord
): PrismaMCPConnectorCreate {
  return {
    id: connector.id,
    scope: connector.scope,
    targetKey: connector.targetKey,
    name: connector.name,
    ...(connector.description ? { description: connector.description } : {}),
    toolsJson: structuredClone(connector.tools),
    enabled: connector.enabled,
    createdAt: new Date(connector.createdAt),
    updatedAt: new Date(connector.updatedAt)
  };
}
```

For deployment files, preserve the constant tuple:

```ts
export function toRepositoryDeployment(row: PrismaDeploymentRow): DeploymentHandoff {
  return {
    id: row.id,
    projectId: row.projectId,
    pageVersionId: row.pageVersionId,
    branch: row.branch,
    commitSha: row.commitSha,
    pullRequestUrl: row.pullRequestUrl,
    files: ["index.html", "styles.css", "script.js"],
    status: row.status
  };
}
```

- [ ] **Step 4: Run mapper tests**

Run:

```bash
pnpm exec vitest run packages/db/src/prisma-workbench-mappers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/prisma-workbench-mappers.ts packages/db/src/prisma-workbench-mappers.test.ts
git commit -m "add web postgres repository mappers"
```

---

### Task 3: Web-Facing Prisma Repositories

**Files:**
- Modify: `packages/db/src/prisma-workbench-repositories.ts`
- Modify: `packages/db/src/prisma-workbench-repositories.test.ts`
- Modify: `packages/db/src/prisma-workbench-repositories.integration.test.ts`

- [ ] **Step 1: Write failing repository tests**

In `packages/db/src/prisma-workbench-repositories.test.ts`, add this test inside `describe("createPrismaWorkbenchRepositories", ...)`:

```ts
it("persists Web-facing project state repositories", async () => {
  const repositories = createPrismaWorkbenchRepositories({
    prisma: createFakePrismaClient(),
    workspaceId: "workspace_default"
  });

  await repositories.projects.save({
    id: "project_web",
    name: "Web project",
    createdAt
  });
  await repositories.projectMembers.save({
    id: "member_web",
    projectId: "project_web",
    userId: "local-web-user",
    role: "owner",
    displayName: "Local user",
    createdAt,
    updatedAt: "2026-05-14T00:01:00.000Z"
  });
  await repositories.skills.save({
    id: "skill_web",
    name: "Deploy",
    type: "deployment",
    scope: "project",
    createdAt
  });
  await repositories.skillVersions.save({
    id: "skill_version_web",
    skillId: "skill_web",
    version: "1.0.0",
    manifest: {
      id: "skill_web",
      name: "Deploy",
      version: "1.0.0",
      type: "deployment",
      scope: "project",
      reviewState: "published",
      commands: []
    },
    content: "# Deploy",
    contentType: "text/markdown",
    reviewState: "published",
    createdAt
  });
  await repositories.skillBindings.save({
    id: "skill_binding_web",
    skillVersionId: "skill_version_web",
    scope: "project",
    targetKey: "project_web",
    projectId: "project_web",
    enabled: true,
    settings: { mode: "safe" },
    createdAt,
    updatedAt: "2026-05-14T00:01:00.000Z"
  });
  await repositories.modelProviders.save({
    id: "provider_web",
    scope: "project",
    targetKey: "project_web",
    name: "Primary",
    provider: "custom",
    config: {
      api: "openai-completions",
      baseUrl: "https://models.example.test",
      apiKeyEnv: "MODEL_API_KEY",
      models: [{ id: "gpt-5.4" }]
    },
    enabled: true,
    createdAt,
    updatedAt: "2026-05-14T00:01:00.000Z"
  });
  await repositories.modelRoutingPolicies.save({
    id: "route_web",
    scope: "project",
    targetKey: "project_web",
    role: "builder",
    providerId: "provider_web",
    model: "gpt-5.4",
    fallback: { providerId: "provider_backup", model: "gpt-5.4-mini" },
    settings: { temperature: 0.2 },
    createdAt,
    updatedAt: "2026-05-14T00:01:00.000Z"
  });
  await repositories.mcpConnectors.save({
    id: "connector_web",
    scope: "project",
    targetKey: "project_web",
    name: "Docs",
    description: "Read docs",
    tools: [
      {
        name: "search",
        description: "Search docs",
        permission: "read",
        roles: ["planner"],
        requiresApproval: false
      }
    ],
    enabled: true,
    createdAt,
    updatedAt: "2026-05-14T00:01:00.000Z"
  });
  await repositories.mcpToolApprovals.save({
    id: "approval_web",
    projectId: "project_web",
    connectorId: "connector_web",
    toolName: "search",
    state: "approved",
    approvedByUserId: "local-web-user",
    createdAt,
    updatedAt: "2026-05-14T00:01:00.000Z"
  });

  await expect(repositories.projectMembers.listForProject("project_web")).resolves.toHaveLength(1);
  await expect(repositories.skillBindings.listForProject("project_web")).resolves.toHaveLength(1);
  await expect(repositories.modelProviders.listForProject("project_web")).resolves.toHaveLength(1);
  await expect(
    repositories.modelRoutingPolicies.getByProjectAndRole("project_web", "builder")
  ).resolves.toMatchObject({ id: "route_web", model: "gpt-5.4" });
  await expect(repositories.mcpConnectors.listForProject("project_web")).resolves.toHaveLength(1);
  await expect(repositories.mcpToolApprovals.listForProject("project_web")).resolves.toHaveLength(1);
});
```

Add this test to ensure Web-required repositories are no longer proxy failures:

```ts
it("only leaves workspaceMembers unsupported in the Stage 23 Web path", async () => {
  const repositories = createPrismaWorkbenchRepositories({
    prisma: createFakePrismaClient(),
    workspaceId: "workspace_default"
  });

  await expect(repositories.workspaceMembers.listAll()).rejects.toThrow(
    "Prisma repository workspaceMembers is not implemented"
  );
  await expect(repositories.projectMembers.listAll()).resolves.toEqual([]);
  await expect(repositories.deployments.findLatestForProject("project_missing")).resolves.toBeUndefined();
  await expect(repositories.skills.listAll()).resolves.toEqual([]);
  await expect(repositories.modelProviders.listAll()).resolves.toEqual([]);
  await expect(repositories.mcpConnectors.listAll()).resolves.toEqual([]);
});
```

- [ ] **Step 2: Run repository tests to verify they fail**

Run:

```bash
pnpm exec vitest run packages/db/src/prisma-workbench-repositories.test.ts
```

Expected: FAIL because Stage 23 repositories are still unsupported or fake client delegates are missing.

- [ ] **Step 3: Extend the Prisma client interface and fake client**

In `packages/db/src/prisma-workbench-repositories.ts`, extend `PrismaWorkbenchClient`:

```ts
  projectMember: PrismaDelegate;
  deployment: PrismaDelegate;
  skill: PrismaDelegate;
  skillVersion: PrismaDelegate;
  skillBinding: PrismaDelegate;
  modelProvider: PrismaDelegate;
  modelRoutingPolicy: PrismaDelegate;
  mCPConnector: PrismaDelegate;
  mCPToolApproval: PrismaDelegate;
```

In `packages/db/src/prisma-workbench-repositories.test.ts`, extend `createFakePrismaClient()`:

```ts
    projectMember: createFakeDelegate(),
    deployment: createFakeDelegate(),
    skill: createFakeDelegate(),
    skillVersion: createFakeDelegate(),
    skillBinding: createFakeDelegate(),
    modelProvider: createFakeDelegate(),
    modelRoutingPolicy: createFakeDelegate(),
    mCPConnector: createFakeDelegate(),
    mCPToolApproval: createFakeDelegate(),
```

- [ ] **Step 4: Implement repository factories**

In `createPrismaWorkbenchRepositories()`, replace unsupported entries:

```ts
    projectMembers: createProjectMemberRepository(options.prisma.projectMember),
    deployments: createDeploymentRepository(options.prisma.deployment),
    skills: createSkillRepository(options.prisma.skill),
    skillVersions: createSkillVersionRepository(options.prisma.skillVersion),
    skillBindings: createSkillBindingRepository(options.prisma.skillBinding),
    modelProviders: createModelProviderRepository(options.prisma.modelProvider),
    modelRoutingPolicies: createModelRoutingPolicyRepository(options.prisma.modelRoutingPolicy),
    mcpConnectors: createMCPConnectorRepository(options.prisma.mCPConnector),
    mcpToolApprovals: createMCPToolApprovalRepository(options.prisma.mCPToolApproval),
```

Implement each repository with the existing `upsert()`, `mapRows()`, and mapper helpers.

Use these selectors:

```ts
const ORDER_CREATED_ID_DESC: PrismaOrderBy = [{ createdAt: "desc" }, { id: "desc" }];
const ORDER_UPDATED_ID_ASC: PrismaOrderBy = [{ updatedAt: "asc" }, { id: "asc" }];
```

Examples:

```ts
function createProjectMemberRepository(delegate: PrismaDelegate): ProjectMemberRepository {
  return {
    async save(member) {
      await upsert(delegate, { id: member.id }, toPrismaProjectMemberCreate(member), [
        "id",
        "projectId",
        "userId"
      ]);
    },
    async getById(memberId) {
      return mapRow(await delegate.findUnique({ where: { id: memberId } }), (row) =>
        toRepositoryProjectMember(row as unknown as PrismaProjectMemberRow)
      );
    },
    async getByProjectAndUser(projectId, userId) {
      return mapRow(
        await delegate.findUnique({ where: { projectId_userId: { projectId, userId } } }),
        (row) => toRepositoryProjectMember(row as unknown as PrismaProjectMemberRow)
      );
    },
    async listForProject(projectId) {
      return mapRows(
        await delegate.findMany({ where: { projectId }, orderBy: ORDER_UPDATED_ID_ASC }),
        (row) => toRepositoryProjectMember(row as unknown as PrismaProjectMemberRow)
      );
    },
    async listAll() {
      return mapRows(await delegate.findMany({ orderBy: ORDER_UPDATED_ID_ASC }), (row) =>
        toRepositoryProjectMember(row as unknown as PrismaProjectMemberRow)
      );
    }
  };
}
```

For fake delegate compatibility, update `matchesWhere()` in the test file so nested unique selectors match:

```ts
if (isRecord(expected)) {
  return Object.entries(expected).every(
    ([nestedKey, nestedExpected]) => row[nestedKey] === nestedExpected
  );
}
```

- [ ] **Step 5: Extend the opt-in Postgres integration test**

In `packages/db/src/prisma-workbench-repositories.integration.test.ts`, add a second `it()` inside the `if (shouldRun)` branch:

```ts
it("persists Web-facing repository records with a real Prisma client", async () => {
  await seedContractPrerequisites({ prisma, organizationId, workspaceId });
  const { createPrismaWorkbenchRepositories } = await import(
    "./prisma-workbench-repositories"
  );
  const repositories = createPrismaWorkbenchRepositories({ prisma, workspaceId });
  const projectId = `${idPrefix}web_project`;

  await repositories.projects.save({
    id: projectId,
    name: "Web integration project",
    createdAt: new Date().toISOString()
  });
  await repositories.projectMembers.save({
    id: `${idPrefix}member`,
    projectId,
    userId: `${idPrefix}user`,
    role: "owner",
    displayName: "Integration User",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  await expect(repositories.projectMembers.listForProject(projectId)).resolves.toHaveLength(1);
});
```

- [ ] **Step 6: Run db tests**

Run:

```bash
pnpm --filter @lp-agent/db test
```

Expected: PASS. The real Postgres integration test remains skipped unless explicitly enabled.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/prisma-workbench-repositories.ts packages/db/src/prisma-workbench-repositories.test.ts packages/db/src/prisma-workbench-repositories.integration.test.ts
git commit -m "add web postgres repositories"
```

---

### Task 4: Web Repository Backend Factory

**Files:**
- Create: `apps/web/src/lib/workbench-repository-factory.ts`
- Create: `apps/web/src/lib/workbench-repository-factory.test.ts`

- [ ] **Step 1: Write failing factory tests**

Create `apps/web/src/lib/workbench-repository-factory.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createInMemoryWorkbenchRepositories } from "@lp-agent/db";
import {
  createWebWorkbenchRepositories,
  resolveWorkbenchRepositoryBackend
} from "./workbench-repository-factory";

describe("resolveWorkbenchRepositoryBackend", () => {
  it("defaults to json", () => {
    expect(resolveWorkbenchRepositoryBackend({})).toBe("json");
  });

  it("accepts json memory and postgres", () => {
    expect(resolveWorkbenchRepositoryBackend({ WORKBENCH_REPOSITORY_BACKEND: "json" })).toBe("json");
    expect(resolveWorkbenchRepositoryBackend({ WORKBENCH_REPOSITORY_BACKEND: "memory" })).toBe("memory");
    expect(resolveWorkbenchRepositoryBackend({ WORKBENCH_REPOSITORY_BACKEND: "postgres" })).toBe("postgres");
  });

  it("fails closed for unsupported backend values", () => {
    expect(() =>
      resolveWorkbenchRepositoryBackend({ WORKBENCH_REPOSITORY_BACKEND: "sqlite" })
    ).toThrow("Unsupported WORKBENCH_REPOSITORY_BACKEND");
  });
});

describe("createWebWorkbenchRepositories", () => {
  it("creates JSON-file repositories by default", async () => {
    const createJsonFileRepositories = vi.fn(() => createInMemoryWorkbenchRepositories());

    await createWebWorkbenchRepositories({
      env: {},
      createJsonFileRepositories
    });

    expect(createJsonFileRepositories).toHaveBeenCalledWith({
      filePath: ".lp-agent/workbench-state.json"
    });
  });

  it("creates memory repositories when explicitly requested", async () => {
    const createMemoryRepositories = vi.fn(() => createInMemoryWorkbenchRepositories());

    await createWebWorkbenchRepositories({
      env: { WORKBENCH_REPOSITORY_BACKEND: "memory" },
      createMemoryRepositories
    });

    expect(createMemoryRepositories).toHaveBeenCalledTimes(1);
  });

  it("fails closed for postgres without DATABASE_URL", async () => {
    await expect(
      createWebWorkbenchRepositories({
        env: {
          WORKBENCH_REPOSITORY_BACKEND: "postgres",
          WORKBENCH_POSTGRES_WORKSPACE_ID: "workspace_local"
        }
      })
    ).rejects.toThrow("DATABASE_URL is required");
  });

  it("fails closed for postgres without workspace id", async () => {
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
    const repositories = createInMemoryWorkbenchRepositories();
    const prisma = {
      organization: { upsert: vi.fn(async () => ({})) },
      workspace: { upsert: vi.fn(async () => ({})) }
    };
    const createPrismaRepositories = vi.fn(() => repositories);

    const result = await createWebWorkbenchRepositories({
      env: {
        WORKBENCH_REPOSITORY_BACKEND: "postgres",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/lp_agent",
        WORKBENCH_POSTGRES_WORKSPACE_ID: "workspace_local",
        WORKBENCH_POSTGRES_BOOTSTRAP: "1"
      },
      loadPrismaClient: async () => prisma,
      createPrismaRepositories
    });

    expect(result).toBe(repositories);
    expect(prisma.organization.upsert).toHaveBeenCalled();
    expect(prisma.workspace.upsert).toHaveBeenCalled();
    expect(createPrismaRepositories).toHaveBeenCalledWith({
      prisma,
      workspaceId: "workspace_local"
    });
  });
});
```

- [ ] **Step 2: Run factory tests to verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-repository-factory.test.ts
```

Expected: FAIL because the factory module does not exist.

- [ ] **Step 3: Implement the factory**

Create `apps/web/src/lib/workbench-repository-factory.ts`:

```ts
import {
  createInMemoryWorkbenchRepositories,
  createJsonFileWorkbenchRepositories,
  createPrismaWorkbenchRepositories,
  type PrismaWorkbenchClient,
  type WorkbenchRepositories
} from "@lp-agent/db";

export type WorkbenchRepositoryBackend = "json" | "memory" | "postgres";

type Env = Record<string, string | undefined>;

interface BootstrapPrismaClient {
  organization: {
    upsert(input: unknown): Promise<unknown>;
  };
  workspace: {
    upsert(input: unknown): Promise<unknown>;
  };
}

export interface CreateWebWorkbenchRepositoriesOptions {
  env?: Env;
  createJsonFileRepositories?: (input: { filePath: string }) => WorkbenchRepositories;
  createMemoryRepositories?: () => WorkbenchRepositories;
  createPrismaRepositories?: (input: {
    prisma: PrismaWorkbenchClient;
    workspaceId: string;
  }) => WorkbenchRepositories;
  loadPrismaClient?: () => Promise<PrismaWorkbenchClient & BootstrapPrismaClient>;
}

const globalPrisma = globalThis as typeof globalThis & {
  __lpAgentWebPrismaClient?: PrismaWorkbenchClient & BootstrapPrismaClient;
};

export function resolveWorkbenchRepositoryBackend(env: Env): WorkbenchRepositoryBackend {
  const raw = env.WORKBENCH_REPOSITORY_BACKEND ?? "json";
  if (raw === "json" || raw === "memory" || raw === "postgres") {
    return raw;
  }
  throw new Error(`Unsupported WORKBENCH_REPOSITORY_BACKEND: ${raw}`);
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
    const filePath = env.LP_AGENT_WORKBENCH_STATE_FILE ?? ".lp-agent/workbench-state.json";
    return (options.createJsonFileRepositories ?? createJsonFileWorkbenchRepositories)({
      filePath
    });
  }

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required when WORKBENCH_REPOSITORY_BACKEND=postgres");
  }
  const workspaceId = env.WORKBENCH_POSTGRES_WORKSPACE_ID;
  if (!workspaceId) {
    throw new Error(
      "WORKBENCH_POSTGRES_WORKSPACE_ID is required when WORKBENCH_REPOSITORY_BACKEND=postgres"
    );
  }

  const prisma = await (options.loadPrismaClient ?? loadDefaultPrismaClient)();
  if (env.WORKBENCH_POSTGRES_BOOTSTRAP === "1") {
    await bootstrapPostgresWorkspace({ prisma, env, workspaceId });
  }

  return (options.createPrismaRepositories ?? createPrismaWorkbenchRepositories)({
    prisma,
    workspaceId
  });
}

async function loadDefaultPrismaClient(): Promise<PrismaWorkbenchClient & BootstrapPrismaClient> {
  if (!globalPrisma.__lpAgentWebPrismaClient) {
    const { PrismaClient } = (await import("@prisma/client")) as unknown as {
      PrismaClient: new () => PrismaWorkbenchClient & BootstrapPrismaClient;
    };
    globalPrisma.__lpAgentWebPrismaClient = new PrismaClient();
  }
  return globalPrisma.__lpAgentWebPrismaClient;
}

async function bootstrapPostgresWorkspace(input: {
  prisma: BootstrapPrismaClient;
  env: Env;
  workspaceId: string;
}): Promise<void> {
  const organizationId = input.env.WORKBENCH_POSTGRES_ORGANIZATION_ID ?? "org_local";
  const organizationName = input.env.WORKBENCH_POSTGRES_ORGANIZATION_NAME ?? "Local Organization";
  const workspaceName = input.env.WORKBENCH_POSTGRES_WORKSPACE_NAME ?? "Local Workspace";

  await input.prisma.organization.upsert({
    where: { id: organizationId },
    create: { id: organizationId, name: organizationName },
    update: { name: organizationName }
  });
  await input.prisma.workspace.upsert({
    where: { id: input.workspaceId },
    create: { id: input.workspaceId, organizationId, name: workspaceName },
    update: { organizationId, name: workspaceName }
  });
}
```

- [ ] **Step 4: Run factory tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-repository-factory.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/workbench-repository-factory.ts apps/web/src/lib/workbench-repository-factory.test.ts
git commit -m "add web repository backend factory"
```

---

### Task 5: Async Web Store Wiring

**Files:**
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/actions.ts`
- Modify tests that call `getWebWorkbenchStore()`

- [ ] **Step 1: Write or update failing store wiring test**

In `apps/web/src/lib/workbench-store.test.ts`, find the test that calls `getWebWorkbenchStore()` and update it to await the store:

```ts
const store = await getWebWorkbenchStore();
```

Add this test near the existing global store tests:

```ts
it("creates the global store through the configured repository backend", async () => {
  vi.stubEnv("WORKBENCH_REPOSITORY_BACKEND", "memory");

  const store = await getWebWorkbenchStore();
  const project = await store.createProject({ name: "Memory backend project" });

  expect(project.name).toBe("Memory backend project");
});
```

Ensure the test file imports `vi` from Vitest if it does not already:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
```

- [ ] **Step 2: Run affected Web tests to verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/page.test.ts apps/web/src/app/actions.test.ts
```

Expected: FAIL because `getWebWorkbenchStore()` still returns a synchronous store and does not use the new factory.

- [ ] **Step 3: Make `getWebWorkbenchStore()` async**

In `apps/web/src/lib/workbench-store.ts`, add the import:

```ts
import { createWebWorkbenchRepositories } from "./workbench-repository-factory";
```

Change the global cache:

```ts
const globalStore = globalThis as typeof globalThis & {
  __lpAgentWebWorkbenchStore?: Promise<WebWorkbenchStore>;
};
```

Replace `getWebWorkbenchStore()`:

```ts
export function getWebWorkbenchStore(): Promise<WebWorkbenchStore> {
  if (!globalStore.__lpAgentWebWorkbenchStore) {
    globalStore.__lpAgentWebWorkbenchStore = createDefaultWebWorkbenchStore();
  }
  return globalStore.__lpAgentWebWorkbenchStore;
}

async function createDefaultWebWorkbenchStore(): Promise<WebWorkbenchStore> {
  const workerLogsFilePath = defaultWorkerLogsFilePath();
  const workerQueue = createLocalWorkerQueueRuntime({
    jobsFilePath: defaultWorkerJobsFilePath(),
    payloadsFilePath: defaultWorkerPayloadsFilePath(),
    ...(workerLogsFilePath !== undefined ? { logsFilePath: workerLogsFilePath } : {})
  });
  return createWebWorkbenchStore({
    repositories: await createWebWorkbenchRepositories(),
    workerQueueRuntime: workerQueue.runtime,
    workerRuntime: workerQueue.runtime,
    workerJobRepository: workerQueue.jobRepository,
    workerLogRepository: workerQueue.workerLogRepository,
    workerId: defaultWorkerId()
  });
}
```

Remove the direct `createJsonFileWorkbenchRepositories` import from `workbench-store.ts` if it is no longer used there.

- [ ] **Step 4: Await the store in page and server actions**

In `apps/web/src/app/page.tsx`:

```ts
  const pageState = await (await getWebWorkbenchStore()).getPageState({
    projectId: currentProjectId,
    taskId: currentTaskId,
    artifactPath
  });
```

In `apps/web/src/app/actions.ts`, replace each direct call:

```ts
const store = getWebWorkbenchStore();
```

with:

```ts
const store = await getWebWorkbenchStore();
```

For inline calls, use a local variable:

```ts
const store = await getWebWorkbenchStore();
const result = await store.interruptCurrentTask({
  taskId,
  reason: "User interrupted the task."
});
```

- [ ] **Step 5: Update tests and direct callers**

Run:

```bash
rg -n "getWebWorkbenchStore\\(" apps/web/src
```

For every test or app call site, ensure it awaits the Promise. The only remaining un-awaited occurrence should be the function definition itself.

- [ ] **Step 6: Run Web tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/lib/workbench-repository-factory.test.ts apps/web/src/app/page.test.ts apps/web/src/app/actions.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/app/page.tsx apps/web/src/app/actions.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/app/page.test.ts apps/web/src/app/actions.test.ts
git commit -m "wire web store repository backend selection"
```

---

### Task 6: Minimal Postgres-Backed Web Flow Coverage

**Files:**
- Modify: `apps/web/src/lib/workbench-repository-factory.test.ts`
- Modify: `packages/db/src/prisma-workbench-repositories.test.ts`

- [ ] **Step 1: Add fake-Postgres Web flow coverage**

In `apps/web/src/lib/workbench-repository-factory.test.ts`, add a test that uses the factory-created Prisma repository with a fake Prisma client:

```ts
it("supports a minimal Web flow through the postgres factory path", async () => {
  const repositories = createInMemoryWorkbenchRepositories();

  const result = await createWebWorkbenchRepositories({
    env: {
      WORKBENCH_REPOSITORY_BACKEND: "postgres",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/lp_agent",
      WORKBENCH_POSTGRES_WORKSPACE_ID: "workspace_local"
    },
    loadPrismaClient: async () =>
      ({
        organization: { upsert: vi.fn(async () => ({})) },
        workspace: { upsert: vi.fn(async () => ({})) }
      }) as never,
    createPrismaRepositories: () => repositories
  });

  await result.projects.save({
    id: "project_factory_flow",
    name: "Factory flow",
    createdAt: "2026-05-20T00:00:00.000Z"
  });
  await result.tasks.save({
    id: "task_factory_flow",
    title: "Create LP",
    type: "lp_generation",
    status: "complete",
    projectId: "project_factory_flow",
    createdAt: "2026-05-20T00:00:01.000Z"
  });

  await expect(result.projects.getById("project_factory_flow")).resolves.toMatchObject({
    name: "Factory flow"
  });
  await expect(result.tasks.getById("task_factory_flow")).resolves.toMatchObject({
    projectId: "project_factory_flow"
  });
});
```

- [ ] **Step 2: Add a Web closure regression to db repository tests**

In `packages/db/src/prisma-workbench-repositories.test.ts`, add:

```ts
it("loads empty Web side panels without unsupported repository failures", async () => {
  const repositories = createPrismaWorkbenchRepositories({
    prisma: createFakePrismaClient(),
    workspaceId: "workspace_default"
  });

  await repositories.projects.save({
    id: "project_side_panels",
    name: "Side panels",
    createdAt
  });

  await expect(repositories.projectMembers.listForProject("project_side_panels")).resolves.toEqual([]);
  await expect(repositories.skillBindings.listForProject("project_side_panels")).resolves.toEqual([]);
  await expect(repositories.modelProviders.listForProject("project_side_panels")).resolves.toEqual([]);
  await expect(repositories.modelRoutingPolicies.listForProject("project_side_panels")).resolves.toEqual([]);
  await expect(repositories.mcpConnectors.listForProject("project_side_panels")).resolves.toEqual([]);
  await expect(repositories.mcpToolApprovals.listForProject("project_side_panels")).resolves.toEqual([]);
});
```

- [ ] **Step 3: Run targeted tests**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-repository-factory.test.ts packages/db/src/prisma-workbench-repositories.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/workbench-repository-factory.test.ts packages/db/src/prisma-workbench-repositories.test.ts
git commit -m "cover web postgres backend flow"
```

---

### Task 7: Documentation and Roadmap Updates

**Files:**
- Modify: `README.md`
- Modify: `docs/development.md`
- Modify: `docs/project-roadmap.md`
- Modify: `docs/agent-development-learning.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Update development docs**

In `docs/development.md`, add a section after the existing Prisma validation command:

````md
### Web Postgres backend opt-in

The default Web workbench backend remains JSON-file state at `.lp-agent/workbench-state.json`.

To run the Web workbench against Postgres during local development:

```bash
pnpm --filter @lp-agent/db db:generate
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" \
WORKBENCH_REPOSITORY_BACKEND=postgres \
WORKBENCH_POSTGRES_WORKSPACE_ID=workspace_local \
WORKBENCH_POSTGRES_BOOTSTRAP=1 \
pnpm dev
```

`WORKBENCH_POSTGRES_BOOTSTRAP=1` only upserts local organization/workspace prerequisites. It does not run production migrations, create hosted auth, or migrate existing JSON-file state.

To return to the default local backend, unset `WORKBENCH_REPOSITORY_BACKEND` or set it to `json`.
````

- [ ] **Step 2: Update root README**

In `README.md`, near the Prisma validation section, add:

````md
Optional Web Postgres backend:

```bash
pnpm --filter @lp-agent/db db:generate
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" \
WORKBENCH_REPOSITORY_BACKEND=postgres \
WORKBENCH_POSTGRES_WORKSPACE_ID=workspace_local \
WORKBENCH_POSTGRES_BOOTSTRAP=1 \
pnpm dev
```

The default Web backend remains JSON-file state unless `WORKBENCH_REPOSITORY_BACKEND=postgres` is explicitly set.
````

- [ ] **Step 3: Update Superpowers README**

In `docs/superpowers/README.md`, add after item 74:

```md
75. `plans/2026-05-20-web-opt-in-postgres-backend-wiring.md`
   - Stage 23 Web Opt-in Postgres Backend Wiring v0 implementation plan。
   - 在 Stage 23 design 后阅读，用于按 TDD 补齐 Web-facing Prisma repository closure、实现 Web backend factory、异步接线 `getWebWorkbenchStore()`、补最小 Web Postgres flow 覆盖和文档收尾。
```

- [ ] **Step 4: Update roadmap**

In `docs/project-roadmap.md`, change Stage 23 status to:

```md
**状态：** implementation plan 已确认，待实现。
```

Add:

```md
**当前实施计划：** `docs/superpowers/plans/2026-05-20-web-opt-in-postgres-backend-wiring.md`。
```

- [ ] **Step 5: Update Agent learning notes**

In `docs/agent-development-learning.md`, update the Stage 23 section to include:

```md
- 当前实现计划：[2026-05-20-web-opt-in-postgres-backend-wiring.md](./superpowers/plans/2026-05-20-web-opt-in-postgres-backend-wiring.md)
```

- [ ] **Step 6: Run doc checks**

Run:

```bash
rg -n "2026-05-20-web-opt-in-postgres-backend-wiring" docs/superpowers/README.md docs/project-roadmap.md docs/agent-development-learning.md
git diff --check
```

Expected: plan is referenced in all three docs; no whitespace errors.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/development.md docs/project-roadmap.md docs/agent-development-learning.md docs/superpowers/README.md
git commit -m "document web postgres backend opt in"
```

---

### Task 8: Final Verification and Stage Completion

**Files:**
- Verify: whole workspace
- Modify if needed: `docs/project-roadmap.md`, `docs/agent-development-learning.md`, `docs/superpowers/README.md`

- [ ] **Step 1: Run full targeted verification**

Run:

```bash
pnpm --filter @lp-agent/db test
pnpm exec vitest run apps/web/src/lib/workbench-repository-factory.test.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/app/page.test.ts apps/web/src/app/actions.test.ts
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm --filter @lp-agent/db db:validate
pnpm typecheck
```

Expected: all commands pass. If Prisma commands fail with a sandbox error against `/Users/ao/.cache/prisma`, rerun the exact Prisma command with escalation and record that in the final notes.

- [ ] **Step 2: Optional real Postgres verification**

Only run when a local Postgres database is available:

```bash
POSTGRES_REPOSITORY_TEST=1 DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm exec vitest run packages/db/src/prisma-workbench-repositories.integration.test.ts
```

Expected: PASS. If no local database is available, leave this unrun and state that it was not available.

- [ ] **Step 3: Run stage completion checklist**

Check:

```bash
git status --short --branch
rg -n "Stage 23|Stage 24|Stage 25|Stage 26|推荐下一阶段队列" docs/project-roadmap.md
rg -n "2026-05-20-web-opt-in-postgres-backend-wiring" docs/superpowers/README.md docs/agent-development-learning.md
```

Expected:

- Worktree is clean after final commit.
- Stage 23 is marked implemented in roadmap after implementation is complete.
- Recommendation queue still contains Stage 24-26 and is not empty.
- Superpowers README and Agent learning notes point to the Stage 23 design and implementation plan.

- [ ] **Step 4: Final commit if docs changed during completion**

If Stage 23 status docs changed after verification, commit them:

```bash
git add docs/project-roadmap.md docs/agent-development-learning.md docs/superpowers/README.md
git commit -m "document web postgres backend completion"
```

Expected: final worktree is clean.
