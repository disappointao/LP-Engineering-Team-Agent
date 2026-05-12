# Stage 2 Persistent Repositories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Stage 1 workbench service from private in-memory maps to explicit repository contracts and repository-backed storage while preserving the current deterministic MVP behavior.

**Architecture:** Put repository record types, interfaces, and the first in-memory implementation in `packages/db`; keep orchestration in `packages/api`. `DemoWorkbenchService` receives a repository bundle through dependency injection, so later Prisma/Postgres repositories can replace the in-memory bundle without changing Web or worker callers.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, existing Prisma schema, existing `@lp-agent/*` domain packages.

---

## Scope Check

The Stage 2 spec covers persistence, Web project flow, skills, model routing, MCP, runtime events, deployment handoff, and collaboration primitives. This plan implements only Milestone 1: persistent repository boundaries. It does not build the Web forms, skill upload UI, model settings UI, MCP registry UI, or real Git provider.

## File Structure

Create and modify these files:

```text
packages/db/
  package.json
  tsconfig.json
  src/
    index.ts
    workbench-repositories.ts
    workbench-repositories.test.ts
packages/api/
  package.json
  src/
    index.ts
    services.test.ts
docs/development.md
```

Dependency direction after this milestone:

```text
api -> db, artifacts, git-deployment, lp-schema, mcp-gateway, model-gateway, runtime-adapters, skills
db -> artifacts, git-deployment, lp-schema
```

`packages/db` must not import from `packages/api`. Repository record types live in `packages/db` and `packages/api` re-exports them for existing consumers.

## Repository Contract

Add one repository bundle that covers the current workbench records:

```ts
export interface WorkbenchRepositories {
  projects: ProjectRepository;
  briefs: BriefRepository;
  pageVersions: PageVersionRepository;
  deployments: DeploymentRepository;
}
```

The API service keeps generating deterministic IDs for now, matching existing tests:

- `project_1`
- `brief_1`
- `version_1`
- `deployment_1` comes from the current deployment adapter

The in-memory repository implementation persists records for the lifetime of the repository instance. That lets tests prove data survives across multiple `DemoWorkbenchService` instances when they share the same repository bundle.

## Tasks

### Task 1: DB Package Test and Typecheck Setup

**Files:**
- Modify: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/src/workbench-repositories.test.ts`

- [ ] **Step 1: Add db package scripts and dependencies**

Replace `packages/db/package.json` with:

```json
{
  "name": "@lp-agent/db",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "db:validate": "prisma validate --schema prisma/schema.prisma",
    "test": "vitest run src/**/*.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@lp-agent/artifacts": "workspace:*",
    "@lp-agent/git-deployment": "workspace:*",
    "@lp-agent/lp-schema": "workspace:*"
  },
  "devDependencies": {
    "prisma": "^6.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Add the db tsconfig**

Create `packages/db/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Add a temporary failing repository test**

Create `packages/db/src/workbench-repositories.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sampleBrief } from "@lp-agent/lp-schema";
import {
  createInMemoryWorkbenchRepositories,
  type PageVersionRecord,
  type ProjectRecord
} from "./index";

const createdAt = "2026-05-12T00:00:00.000Z";

describe("in-memory workbench repositories", () => {
  it("persists projects and returns defensive copies", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const project: ProjectRecord = {
      id: "project_1",
      name: "Spring sale",
      repository: "git@example.com:shop/spring.git",
      createdAt
    };

    await repositories.projects.save(project);
    const saved = await repositories.projects.getById("project_1");
    project.name = "Mutated locally";

    expect(saved).toEqual({
      id: "project_1",
      name: "Spring sale",
      repository: "git@example.com:shop/spring.git",
      createdAt
    });
  });

  it("finds the latest brief, page version, and deployment for a project", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.projects.save({
      id: "project_1",
      name: "Spring sale",
      repository: "git@example.com:shop/spring.git",
      createdAt
    });
    await repositories.briefs.save({
      id: "brief_1",
      projectId: "project_1",
      prompt: "first prompt",
      brief: sampleBrief,
      createdAt
    });
    await repositories.briefs.save({
      id: "brief_2",
      projectId: "project_1",
      prompt: "second prompt",
      brief: { ...sampleBrief, title: "Second brief" },
      createdAt: "2026-05-12T00:01:00.000Z"
    });

    const pageVersion: PageVersionRecord = {
      id: "version_1",
      projectId: "project_1",
      briefId: "brief_2",
      artifacts: {
        indexHtml: "<!doctype html><html></html>",
        stylesCss: "body { margin: 0; }",
        scriptJs: "console.log('ready');"
      },
      reviewStatus: "passed",
      findings: [],
      createdAt: "2026-05-12T00:02:00.000Z"
    };
    await repositories.pageVersions.save(pageVersion);
    await repositories.deployments.save({
      id: "deployment_1",
      projectId: "project_1",
      pageVersionId: "version_1",
      branch: "lp-agent/project_1/version_1",
      commitSha: "mock_commit_1",
      pullRequestUrl: "https://git.example.local/pr/deployment_1",
      files: ["index.html", "styles.css", "script.js"],
      status: "pr_opened"
    });

    await expect(repositories.briefs.findLatestForProject("project_1")).resolves.toMatchObject({
      id: "brief_2",
      prompt: "second prompt"
    });
    await expect(repositories.pageVersions.findLatestForProject("project_1")).resolves.toMatchObject({
      id: "version_1",
      briefId: "brief_2"
    });
    await expect(repositories.deployments.findLatestForProject("project_1")).resolves.toMatchObject({
      id: "deployment_1",
      pageVersionId: "version_1"
    });
  });

  it("returns undefined when records are missing", async () => {
    const repositories = createInMemoryWorkbenchRepositories();

    await expect(repositories.projects.getById("missing")).resolves.toBeUndefined();
    await expect(repositories.briefs.getById("missing")).resolves.toBeUndefined();
    await expect(repositories.pageVersions.getById("missing")).resolves.toBeUndefined();
    await expect(repositories.deployments.getByPageVersionId("missing")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 4: Add a temporary barrel export**

Create `packages/db/src/index.ts`:

```ts
export * from "./workbench-repositories";
```

- [ ] **Step 5: Run the new test to verify it fails**

Run:

```bash
pnpm --filter @lp-agent/db test
```

Expected: FAIL because `./workbench-repositories` does not exist.

### Task 2: In-Memory Workbench Repository Implementation

**Files:**
- Create: `packages/db/src/workbench-repositories.ts`
- Test: `packages/db/src/workbench-repositories.test.ts`

- [ ] **Step 1: Implement repository contracts and in-memory repositories**

Create `packages/db/src/workbench-repositories.ts`:

```ts
import type { StaticArtifacts } from "@lp-agent/artifacts";
import type { DeploymentHandoff } from "@lp-agent/git-deployment";
import type { LPBrief, ReviewFinding } from "@lp-agent/lp-schema";

export interface ProjectRecord {
  id: string;
  name: string;
  repository: string;
  createdAt: string;
}

export interface BriefRecord {
  id: string;
  projectId: string;
  prompt: string;
  brief: LPBrief;
  createdAt: string;
}

export type ReviewStatus = "pending" | "passed" | "failed";

export interface PageVersionRecord {
  id: string;
  projectId: string;
  briefId: string;
  artifacts: StaticArtifacts;
  reviewStatus: ReviewStatus;
  findings: ReviewFinding[];
  createdAt: string;
}

export interface ProjectRepository {
  save(project: ProjectRecord): Promise<void>;
  getById(projectId: string): Promise<ProjectRecord | undefined>;
}

export interface BriefRepository {
  save(brief: BriefRecord): Promise<void>;
  getById(briefId: string): Promise<BriefRecord | undefined>;
  findLatestForProject(projectId: string): Promise<BriefRecord | undefined>;
}

export interface PageVersionRepository {
  save(pageVersion: PageVersionRecord): Promise<void>;
  getById(pageVersionId: string): Promise<PageVersionRecord | undefined>;
  findLatestForProject(projectId: string): Promise<PageVersionRecord | undefined>;
}

export interface DeploymentRepository {
  save(deployment: DeploymentHandoff): Promise<void>;
  getByPageVersionId(pageVersionId: string): Promise<DeploymentHandoff | undefined>;
  findLatestForProject(projectId: string): Promise<DeploymentHandoff | undefined>;
}

export interface WorkbenchRepositories {
  projects: ProjectRepository;
  briefs: BriefRepository;
  pageVersions: PageVersionRepository;
  deployments: DeploymentRepository;
}

export function createInMemoryWorkbenchRepositories(): WorkbenchRepositories {
  return new InMemoryWorkbenchRepositories();
}

class InMemoryWorkbenchRepositories implements WorkbenchRepositories {
  readonly projects = new InMemoryProjectRepository();
  readonly briefs = new InMemoryBriefRepository();
  readonly pageVersions = new InMemoryPageVersionRepository();
  readonly deployments = new InMemoryDeploymentRepository();
}

class InMemoryProjectRepository implements ProjectRepository {
  private readonly projects = new Map<string, ProjectRecord>();

  async save(project: ProjectRecord): Promise<void> {
    this.projects.set(project.id, copyProject(project));
  }

  async getById(projectId: string): Promise<ProjectRecord | undefined> {
    const project = this.projects.get(projectId);
    return project ? copyProject(project) : undefined;
  }
}

class InMemoryBriefRepository implements BriefRepository {
  private readonly briefs = new Map<string, BriefRecord>();

  async save(brief: BriefRecord): Promise<void> {
    this.briefs.set(brief.id, copyBriefRecord(brief));
  }

  async getById(briefId: string): Promise<BriefRecord | undefined> {
    const brief = this.briefs.get(briefId);
    return brief ? copyBriefRecord(brief) : undefined;
  }

  async findLatestForProject(projectId: string): Promise<BriefRecord | undefined> {
    const brief = [...this.briefs.values()]
      .filter((record) => record.projectId === projectId)
      .at(-1);
    return brief ? copyBriefRecord(brief) : undefined;
  }
}

class InMemoryPageVersionRepository implements PageVersionRepository {
  private readonly pageVersions = new Map<string, PageVersionRecord>();

  async save(pageVersion: PageVersionRecord): Promise<void> {
    this.pageVersions.set(pageVersion.id, copyPageVersion(pageVersion));
  }

  async getById(pageVersionId: string): Promise<PageVersionRecord | undefined> {
    const pageVersion = this.pageVersions.get(pageVersionId);
    return pageVersion ? copyPageVersion(pageVersion) : undefined;
  }

  async findLatestForProject(projectId: string): Promise<PageVersionRecord | undefined> {
    const pageVersion = [...this.pageVersions.values()]
      .filter((record) => record.projectId === projectId)
      .at(-1);
    return pageVersion ? copyPageVersion(pageVersion) : undefined;
  }
}

class InMemoryDeploymentRepository implements DeploymentRepository {
  private readonly deploymentsByPageVersion = new Map<string, DeploymentHandoff>();

  async save(deployment: DeploymentHandoff): Promise<void> {
    this.deploymentsByPageVersion.set(deployment.pageVersionId, copyDeployment(deployment));
  }

  async getByPageVersionId(pageVersionId: string): Promise<DeploymentHandoff | undefined> {
    const deployment = this.deploymentsByPageVersion.get(pageVersionId);
    return deployment ? copyDeployment(deployment) : undefined;
  }

  async findLatestForProject(projectId: string): Promise<DeploymentHandoff | undefined> {
    const deployment = [...this.deploymentsByPageVersion.values()]
      .filter((record) => record.projectId === projectId)
      .at(-1);
    return deployment ? copyDeployment(deployment) : undefined;
  }
}

function copyProject(project: ProjectRecord): ProjectRecord {
  return { ...project };
}

function copyBriefRecord(record: BriefRecord): BriefRecord {
  return {
    ...record,
    brief: structuredClone(record.brief)
  };
}

function copyPageVersion(pageVersion: PageVersionRecord): PageVersionRecord {
  return {
    ...pageVersion,
    artifacts: { ...pageVersion.artifacts },
    findings: pageVersion.findings.map((finding) => ({ ...finding }))
  };
}

function copyDeployment(deployment: DeploymentHandoff): DeploymentHandoff {
  return {
    ...deployment,
    files: [...deployment.files]
  };
}
```

- [ ] **Step 2: Run the db repository tests**

Run:

```bash
pnpm --filter @lp-agent/db test
```

Expected: PASS for `packages/db/src/workbench-repositories.test.ts`.

- [ ] **Step 3: Typecheck the db package**

Run:

```bash
pnpm --filter @lp-agent/db typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit the db repository package work**

```bash
git add packages/db/package.json packages/db/tsconfig.json packages/db/src/index.ts packages/db/src/workbench-repositories.ts packages/db/src/workbench-repositories.test.ts pnpm-lock.yaml
git commit -m "feat: add workbench repositories"
```

### Task 3: API Service Repository Injection

**Files:**
- Modify: `packages/api/package.json`
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/services.test.ts`

- [ ] **Step 1: Add db dependency to the api package**

Modify `packages/api/package.json` dependencies to include `@lp-agent/db`:

```json
{
  "dependencies": {
    "@lp-agent/artifacts": "workspace:*",
    "@lp-agent/db": "workspace:*",
    "@lp-agent/git-deployment": "workspace:*",
    "@lp-agent/lp-schema": "workspace:*",
    "@lp-agent/mcp-gateway": "workspace:*",
    "@lp-agent/model-gateway": "workspace:*",
    "@lp-agent/runtime-adapters": "workspace:*",
    "@lp-agent/skills": "workspace:*"
  }
}
```

- [ ] **Step 2: Add a failing service test for shared repository persistence**

Add this test to `packages/api/src/services.test.ts` inside `describe("demo workbench service", () => { ... })`:

```ts
  it("can read records created by another service instance when repositories are shared", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const serviceA = new DemoWorkbenchService({ repositories, now: fixedClock() });
    const serviceB = new DemoWorkbenchService({ repositories, now: fixedClock() });

    const project = await serviceA.createProject({
      name: "Repository-backed project",
      repository: "git@example.com:shop/repo-backed.git"
    });
    const brief = await serviceA.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Build a repository-backed LP."
    });
    const pageVersion = await serviceA.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });

    const snapshot = await serviceB.getSnapshot(project.id);

    expect(snapshot).toMatchObject({
      project,
      brief,
      currentPageVersion: {
        id: pageVersion.id,
        projectId: project.id,
        briefId: brief.id,
        reviewStatus: "pending"
      }
    });
  });
```

Also add this import at the top of `packages/api/src/services.test.ts`:

```ts
import { createInMemoryWorkbenchRepositories } from "@lp-agent/db";
```

- [ ] **Step 3: Run the API test to verify it fails**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: FAIL because `DemoWorkbenchServiceOptions` does not yet accept `repositories`.

- [ ] **Step 4: Refactor API record imports and service options**

In `packages/api/src/index.ts`, import repository records and bundle:

```ts
import {
  createInMemoryWorkbenchRepositories,
  type BriefRecord,
  type PageVersionRecord,
  type ProjectRecord,
  type ReviewStatus,
  type WorkbenchRepositories
} from "@lp-agent/db";
```

Remove the local `ProjectRecord`, `BriefRecord`, `ReviewStatus`, and `PageVersionRecord` declarations from `packages/api/src/index.ts`.

Add the repository bundle to service options:

```ts
export interface DemoWorkbenchServiceOptions {
  repositories?: WorkbenchRepositories;
  builderRuntime?: AgentRuntimeAdapter;
  reviewerRuntime?: AgentRuntimeAdapter;
  deploymentAdapter?: GitDeploymentAdapter;
  now?: () => Date;
}
```

Add a private field:

```ts
private readonly repositories: WorkbenchRepositories;
```

Set it in the constructor:

```ts
this.repositories = options.repositories ?? createInMemoryWorkbenchRepositories();
```

- [ ] **Step 5: Replace internal maps with repository calls**

In `packages/api/src/index.ts`, remove these private fields:

```ts
private readonly projects = new Map<string, ProjectRecord>();
private readonly briefs = new Map<string, BriefRecord>();
private readonly pageVersions = new Map<string, PageVersionRecord>();
private readonly deploymentsByPageVersion = new Map<string, DeploymentHandoff>();
```

Update `createProject` to save via repository:

```ts
await this.repositories.projects.save(project);
return copyProject(project);
```

Update `createBriefFromPrompt` to save via repository:

```ts
await this.repositories.briefs.save(brief);
return copyBriefRecord(brief);
```

Update `generatePageVersion` to save via repository:

```ts
await this.repositories.pageVersions.save(pageVersion);
return copyPageVersion(pageVersion);
```

Update `approveAndCreateDeployment` to read and write through repository:

```ts
const existing = await this.repositories.deployments.getByPageVersionId(pageVersion.id);
if (existing) {
  return copyDeployment(existing);
}

const deployment = await this.deploymentAdapter.createHandoff({
  projectId: input.projectId,
  pageVersionId: pageVersion.id,
  approved: true,
  artifacts: copyArtifacts(pageVersion.artifacts)
});
await this.repositories.deployments.save(deployment);
return copyDeployment(deployment);
```

Update lookup helpers to be `async` and use repositories:

```ts
private async getProjectOrThrow(projectId: string): Promise<ProjectRecord> {
  const project = await this.repositories.projects.getById(projectId);
  if (!project) {
    throw new Error("Project not found.");
  }
  return project;
}

private async getBriefForProjectOrThrow(projectId: string, briefId: string): Promise<BriefRecord> {
  const brief = await this.repositories.briefs.getById(briefId);
  if (!brief || brief.projectId !== projectId) {
    throw new Error("Brief not found for project.");
  }
  return brief;
}

private async getPageVersionForProjectOrThrow(
  projectId: string,
  pageVersionId: string
): Promise<PageVersionRecord> {
  const pageVersion = await this.repositories.pageVersions.getById(pageVersionId);
  if (!pageVersion || pageVersion.projectId !== projectId) {
    throw new Error("Page version not found for project.");
  }
  return pageVersion;
}
```

Every caller of these helpers must use `await`, including `createBriefFromPrompt`, `generatePageVersion`, `reviewPageVersion`, `approveAndCreateDeployment`, and `getSnapshot`.

Update `getSnapshot` to use repository lookups:

```ts
async getSnapshot(projectId: string): Promise<WorkbenchSnapshot> {
  const project = await this.getProjectOrThrow(projectId);
  const currentPageVersion = await this.repositories.pageVersions.findLatestForProject(projectId);
  const brief = currentPageVersion
    ? await this.repositories.briefs.getById(currentPageVersion.briefId)
    : await this.repositories.briefs.findLatestForProject(projectId);
  const deployment = await this.repositories.deployments.findLatestForProject(projectId);

  return {
    project: copyProject(project),
    brief: brief ? copyBriefRecord(brief) : undefined,
    currentPageVersion: currentPageVersion ? copyPageVersion(currentPageVersion) : undefined,
    deployment: deployment ? copyDeployment(deployment) : undefined
  };
}
```

- [ ] **Step 6: Re-export repository record types from the API package**

Add this export to `packages/api/src/index.ts` so existing consumers can still import records from `@lp-agent/api`:

```ts
export type {
  BriefRecord,
  PageVersionRecord,
  ProjectRecord,
  ReviewStatus
} from "@lp-agent/db";
```

- [ ] **Step 7: Run the API tests**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: PASS, including the new shared repository persistence test.

- [ ] **Step 8: Run db and api typechecks**

Run:

```bash
pnpm --filter @lp-agent/db typecheck
pnpm --filter @lp-agent/api typecheck
```

Expected: both commands pass.

- [ ] **Step 9: Commit the API repository injection**

```bash
git add packages/api/package.json packages/api/src/index.ts packages/api/src/services.test.ts pnpm-lock.yaml
git commit -m "refactor: inject workbench repositories"
```

### Task 4: Documentation and Verification

**Files:**
- Modify: `docs/development.md`

- [ ] **Step 1: Document the repository-backed Stage 2 boundary**

Add this paragraph under `## Current MVP Behavior` in `docs/development.md`:

```md
Stage 2 starts by moving workbench records behind repository contracts in `@lp-agent/db`. The default local implementation is still in-memory for deterministic tests, but `@lp-agent/api` now depends on repository interfaces instead of private maps so Prisma/Postgres repositories can replace the in-memory implementation without changing Web or worker callers.
```

- [ ] **Step 2: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected:

- `pnpm test`: all test files pass.
- `pnpm typecheck`: all package typechecks pass.
- `pnpm build`: Next build passes.
- `git diff --check`: no whitespace errors.

- [ ] **Step 3: Commit documentation**

```bash
git add docs/development.md
git commit -m "docs: describe repository-backed workbench boundary"
```

## Completion Criteria

This milestone is complete when:

- `@lp-agent/db` exports repository record types and `createInMemoryWorkbenchRepositories`.
- `DemoWorkbenchService` can run with a caller-provided repository bundle.
- Existing API consumers can still import `ProjectRecord`, `BriefRecord`, `PageVersionRecord`, and `ReviewStatus` from `@lp-agent/api`.
- A test proves two service instances can share one repository bundle and read the same records.
- `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check` pass.
