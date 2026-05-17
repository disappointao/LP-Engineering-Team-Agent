# Collaboration Primitives v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local-user identity, repository-backed workspace/project members, project owner creation, approval actor ownership, and minimal Web member visibility without building real auth or realtime collaboration.

**Architecture:** Extend the existing repository layer with member records and JSON-file persistence, then let `DemoWorkbenchService` own local collaboration behavior through a small `WorkbenchUserIdentity` boundary. The Web store passes a deterministic local identity into the service, page state exposes project member summaries, and server actions resolve actor ids from a local identity helper instead of trusting form values.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Next.js server actions, existing `@lp-agent/db`, `@lp-agent/api`, and `apps/web` local JSON-file workbench state.

---

## File Structure

- Modify `packages/db/src/workbench-repositories.ts`
  - Add `ProjectRole`, workspace/project member record types, repository interfaces, in-memory implementations, copy helpers, and `WorkbenchRepositories` fields.
- Modify `packages/db/src/json-file-workbench-repositories.ts`
  - Persist workspace/project members in local JSON state and default missing arrays to `[]`.
- Modify `packages/db/src/workbench-repositories.test.ts`
  - Cover in-memory member save, lookup, list, ordering, and defensive copies.
- Modify `packages/db/src/json-file-workbench-repositories.test.ts`
  - Cover JSON reopen and old-file compatibility for member arrays.
- Create `packages/api/src/collaboration.ts`
  - Define `WorkbenchUserIdentity`, default local user, identity normalization, membership id helpers, and member view conversion helpers.
- Modify `packages/api/src/index.ts`
  - Export collaboration types/helpers, accept `currentUser`, create owner membership in `createProject()`, add project member service methods, and keep approval paths actor-aware.
- Modify `packages/api/src/services.test.ts`
  - Cover owner membership creation, idempotence, project scoping, custom local identity, and deployment approval validation.
- Create `apps/web/src/lib/local-identity.ts`
  - Provide the Web local identity resolver used by store construction and server actions.
- Modify `apps/web/src/lib/workbench-store.ts`
  - Add current-user option, include `projectMembers` in page state, pass identity to API service, and keep skill command input actor-free at Web store boundary.
- Modify `apps/web/src/lib/workbench-store.test.ts`
  - Cover page-state member summaries, implicit LP project owner creation, custom current user, and skill command actor ownership.
- Modify `apps/web/src/app/actions.ts`
  - Replace action-local approval constants with `getLocalWorkbenchUser()` and ignore submitted actor ids.
- Modify `apps/web/src/app/actions.test.ts`
  - Cover MCP and skill command actions use local identity rather than submitted actor ids.
- Modify `apps/web/src/lib/i18n.ts`
  - Add localized collaboration/member labels and project role labels.
- Modify `apps/web/src/lib/i18n.test.ts`
  - Cover English and Chinese collaboration labels.
- Modify `apps/web/src/app/page.tsx`
  - Render a compact read-only project members block when a project is selected.
- Modify `apps/web/src/app/page.test.ts`
  - Cover project member rendering and localized role copy.
- Modify `docs/agent-development-learning.md`
  - Mark Stage 7 implementation as planned at the start and completed at the end.
- Modify `docs/superpowers/README.md`
  - Add this implementation plan to the reading order.

## Commit Discipline

Keep the two root-level `微信图片_*.png` files untracked and unstaged. Before every commit, run:

```bash
git status --short
```

Expected before each commit: only intended tracked files are staged, plus the two image files remain untracked and unstaged.

---

### Task 1: Add Member Repository Contracts and Persistence

**Files:**
- Modify: `packages/db/src/workbench-repositories.ts`
- Modify: `packages/db/src/json-file-workbench-repositories.ts`
- Modify: `packages/db/src/workbench-repositories.test.ts`
- Modify: `packages/db/src/json-file-workbench-repositories.test.ts`

- [ ] **Step 1: Write failing in-memory repository tests**

In `packages/db/src/workbench-repositories.test.ts`, update the type imports to include:

```ts
  type ProjectMemberRecord,
  type WorkspaceMemberRecord,
```

Add this test after `"lists projects in creation order and returns defensive copies"`:

```ts
  it("stores workspace and project members with scoped lookups and defensive copies", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const workspaceMember: WorkspaceMemberRecord = {
      id: "workspace_member_1",
      workspaceId: "workspace_1",
      userId: "user_1",
      role: "admin",
      displayName: "Ada Admin",
      createdAt,
      updatedAt: createdAt
    };
    const projectMember: ProjectMemberRecord = {
      id: "project_member_1",
      projectId: "project_1",
      userId: "user_1",
      role: "owner",
      displayName: "Ada Owner",
      createdAt,
      updatedAt: createdAt
    };
    const otherProjectMember: ProjectMemberRecord = {
      ...projectMember,
      id: "project_member_2",
      projectId: "project_2",
      role: "reviewer",
      displayName: "Ada Reviewer",
      createdAt: "2026-05-12T00:01:00.000Z",
      updatedAt: "2026-05-12T00:01:00.000Z"
    };

    await repositories.workspaceMembers.save(workspaceMember);
    await repositories.projectMembers.save(projectMember);
    await repositories.projectMembers.save(otherProjectMember);
    workspaceMember.displayName = "mutated";
    projectMember.displayName = "mutated";

    await expect(repositories.workspaceMembers.getByWorkspaceAndUser("workspace_1", "user_1"))
      .resolves.toEqual({
        id: "workspace_member_1",
        workspaceId: "workspace_1",
        userId: "user_1",
        role: "admin",
        displayName: "Ada Admin",
        createdAt,
        updatedAt: createdAt
      });
    await expect(repositories.projectMembers.getByProjectAndUser("project_1", "user_1"))
      .resolves.toEqual({
        id: "project_member_1",
        projectId: "project_1",
        userId: "user_1",
        role: "owner",
        displayName: "Ada Owner",
        createdAt,
        updatedAt: createdAt
      });

    const listed = await repositories.projectMembers.listForProject("project_1");
    listed[0]!.displayName = "changed after read";

    await expect(repositories.projectMembers.listForProject("project_1")).resolves.toEqual([
      {
        id: "project_member_1",
        projectId: "project_1",
        userId: "user_1",
        role: "owner",
        displayName: "Ada Owner",
        createdAt,
        updatedAt: createdAt
      }
    ]);
    await expect(repositories.projectMembers.listAll()).resolves.toEqual([
      expect.objectContaining({ id: "project_member_1", projectId: "project_1" }),
      expect.objectContaining({ id: "project_member_2", projectId: "project_2" })
    ]);
  });
```

- [ ] **Step 2: Write failing JSON-file repository tests**

In `packages/db/src/json-file-workbench-repositories.test.ts`, add this test after the project/task reopen test:

```ts
  it("reopens workspace and project members from disk", async () => {
    const filePath = await tempStateFile();
    const first = createJsonFileWorkbenchRepositories({ filePath });

    await first.workspaceMembers.save({
      id: "workspace_member_1",
      workspaceId: "workspace_1",
      userId: "user_1",
      role: "admin",
      displayName: "Ada Admin",
      createdAt,
      updatedAt: createdAt
    });
    await first.projectMembers.save({
      id: "project_member_1",
      projectId: "project_1",
      userId: "user_1",
      role: "owner",
      displayName: "Ada Owner",
      createdAt,
      updatedAt: createdAt
    });

    const second = createJsonFileWorkbenchRepositories({ filePath });

    await expect(second.workspaceMembers.listForWorkspace("workspace_1")).resolves.toEqual([
      {
        id: "workspace_member_1",
        workspaceId: "workspace_1",
        userId: "user_1",
        role: "admin",
        displayName: "Ada Admin",
        createdAt,
        updatedAt: createdAt
      }
    ]);
    await expect(second.projectMembers.listForProject("project_1")).resolves.toEqual([
      {
        id: "project_member_1",
        projectId: "project_1",
        userId: "user_1",
        role: "owner",
        displayName: "Ada Owner",
        createdAt,
        updatedAt: createdAt
      }
    ]);
  });
```

Add this compatibility test near the same location:

```ts
  it("defaults missing member arrays when reopening old local state files", async () => {
    const filePath = await tempStateFile();
    await writeFile(
      filePath,
      JSON.stringify({
        projects: [],
        briefs: [],
        pageVersions: [],
        deployments: [],
        tasks: [],
        messages: [],
        taskSnapshots: [],
        skills: [],
        skillVersions: [],
        skillBindings: [],
        modelProviders: [],
        modelRoutingPolicies: [],
        mcpConnectors: [],
        mcpToolApprovals: [],
        runs: [],
        runEvents: [],
        toolObservations: [],
        agentHandoffs: []
      }),
      "utf8"
    );

    const repositories = createJsonFileWorkbenchRepositories({ filePath });

    await expect(repositories.workspaceMembers.listAll()).resolves.toEqual([]);
    await expect(repositories.projectMembers.listAll()).resolves.toEqual([]);
  });
```

- [ ] **Step 3: Run DB tests and verify failure**

Run:

```bash
pnpm --filter @lp-agent/db test
```

Expected: FAIL because `workspaceMembers` and `projectMembers` do not exist on `WorkbenchRepositories`.

- [ ] **Step 4: Add repository types and in-memory implementations**

In `packages/db/src/workbench-repositories.ts`, update the `@lp-agent/lp-schema` import:

```ts
import type { LPBrief, ProjectRole, ReviewFinding } from "@lp-agent/lp-schema";
```

Add these record types near `ProjectRecord`:

```ts
export type { ProjectRole } from "@lp-agent/lp-schema";

export interface WorkspaceMemberRecord {
  id: string;
  workspaceId: string;
  userId: string;
  role: ProjectRole;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMemberRecord {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
}
```

Add these repository interfaces after `ProjectRepository`:

```ts
export interface WorkspaceMemberRepository {
  save(member: WorkspaceMemberRecord): Promise<void>;
  getById(memberId: string): Promise<WorkspaceMemberRecord | undefined>;
  getByWorkspaceAndUser(
    workspaceId: string,
    userId: string
  ): Promise<WorkspaceMemberRecord | undefined>;
  listForWorkspace(workspaceId: string): Promise<WorkspaceMemberRecord[]>;
  listAll(): Promise<WorkspaceMemberRecord[]>;
}

export interface ProjectMemberRepository {
  save(member: ProjectMemberRecord): Promise<void>;
  getById(memberId: string): Promise<ProjectMemberRecord | undefined>;
  getByProjectAndUser(projectId: string, userId: string): Promise<ProjectMemberRecord | undefined>;
  listForProject(projectId: string): Promise<ProjectMemberRecord[]>;
  listAll(): Promise<ProjectMemberRecord[]>;
}
```

Add these fields to `WorkbenchRepositories` and instantiate them in `InMemoryWorkbenchRepositories`:

```ts
  workspaceMembers: WorkspaceMemberRepository;
  projectMembers: ProjectMemberRepository;
```

```ts
  readonly workspaceMembers = new InMemoryWorkspaceMemberRepository();
  readonly projectMembers = new InMemoryProjectMemberRepository();
```

Add in-memory classes before `InMemoryProjectRepository`:

```ts
class InMemoryWorkspaceMemberRepository implements WorkspaceMemberRepository {
  private readonly members = new Map<string, WorkspaceMemberRecord>();

  async save(member: WorkspaceMemberRecord): Promise<void> {
    this.members.set(member.id, copyWorkspaceMember(member));
  }

  async getById(memberId: string): Promise<WorkspaceMemberRecord | undefined> {
    const member = this.members.get(memberId);
    return member ? copyWorkspaceMember(member) : undefined;
  }

  async getByWorkspaceAndUser(
    workspaceId: string,
    userId: string
  ): Promise<WorkspaceMemberRecord | undefined> {
    const member = [...this.members.values()].find(
      (candidate) => candidate.workspaceId === workspaceId && candidate.userId === userId
    );
    return member ? copyWorkspaceMember(member) : undefined;
  }

  async listForWorkspace(workspaceId: string): Promise<WorkspaceMemberRecord[]> {
    return this.sortedMembers((member) => member.workspaceId === workspaceId);
  }

  async listAll(): Promise<WorkspaceMemberRecord[]> {
    return this.sortedMembers(() => true);
  }

  private sortedMembers(
    matches: (member: WorkspaceMemberRecord) => boolean
  ): WorkspaceMemberRecord[] {
    return [...this.members.values()]
      .filter(matches)
      .sort(compareWorkspaceMembersByTimeline)
      .map(copyWorkspaceMember);
  }
}

class InMemoryProjectMemberRepository implements ProjectMemberRepository {
  private readonly members = new Map<string, ProjectMemberRecord>();

  async save(member: ProjectMemberRecord): Promise<void> {
    this.members.set(member.id, copyProjectMember(member));
  }

  async getById(memberId: string): Promise<ProjectMemberRecord | undefined> {
    const member = this.members.get(memberId);
    return member ? copyProjectMember(member) : undefined;
  }

  async getByProjectAndUser(
    projectId: string,
    userId: string
  ): Promise<ProjectMemberRecord | undefined> {
    const member = [...this.members.values()].find(
      (candidate) => candidate.projectId === projectId && candidate.userId === userId
    );
    return member ? copyProjectMember(member) : undefined;
  }

  async listForProject(projectId: string): Promise<ProjectMemberRecord[]> {
    return this.sortedMembers((member) => member.projectId === projectId);
  }

  async listAll(): Promise<ProjectMemberRecord[]> {
    return this.sortedMembers(() => true);
  }

  private sortedMembers(matches: (member: ProjectMemberRecord) => boolean): ProjectMemberRecord[] {
    return [...this.members.values()]
      .filter(matches)
      .sort(compareProjectMembersByTimeline)
      .map(copyProjectMember);
  }
}
```

Add copy and compare helpers:

```ts
function compareWorkspaceMembersByTimeline(
  a: WorkspaceMemberRecord,
  b: WorkspaceMemberRecord
): number {
  return (
    a.createdAt.localeCompare(b.createdAt) ||
    a.workspaceId.localeCompare(b.workspaceId) ||
    a.userId.localeCompare(b.userId) ||
    a.id.localeCompare(b.id)
  );
}

function compareProjectMembersByTimeline(
  a: ProjectMemberRecord,
  b: ProjectMemberRecord
): number {
  return (
    a.createdAt.localeCompare(b.createdAt) ||
    a.projectId.localeCompare(b.projectId) ||
    a.userId.localeCompare(b.userId) ||
    a.id.localeCompare(b.id)
  );
}

function copyWorkspaceMember(member: WorkspaceMemberRecord): WorkspaceMemberRecord {
  return { ...member };
}

function copyProjectMember(member: ProjectMemberRecord): ProjectMemberRecord {
  return { ...member };
}
```

- [ ] **Step 5: Add JSON-file member persistence**

In `packages/db/src/json-file-workbench-repositories.ts`, import the new types:

```ts
  type ProjectMemberRecord,
  type ProjectMemberRepository,
  type WorkspaceMemberRecord,
  type WorkspaceMemberRepository,
```

Add arrays to `JsonWorkbenchState`:

```ts
  workspaceMembers: WorkspaceMemberRecord[];
  projectMembers: ProjectMemberRecord[];
```

Add repository fields to `JsonFileWorkbenchRepositories`:

```ts
  readonly workspaceMembers: WorkspaceMemberRepository;
  readonly projectMembers: ProjectMemberRepository;
```

Instantiate them in the constructor:

```ts
    this.workspaceMembers = new JsonFileWorkspaceMemberRepository(filePath);
    this.projectMembers = new JsonFileProjectMemberRepository(filePath);
```

Add classes near other JSON repositories:

```ts
class JsonFileWorkspaceMemberRepository implements WorkspaceMemberRepository {
  constructor(private readonly filePath: string) {}

  async save(member: WorkspaceMemberRecord): Promise<void> {
    await updateJsonState(this.filePath, (state) => {
      state.workspaceMembers = upsertBy(
        state.workspaceMembers,
        copy(member),
        (record) => record.id === member.id
      );
    });
  }

  async getById(memberId: string): Promise<WorkspaceMemberRecord | undefined> {
    const state = await readJsonState(this.filePath);
    return copyOptional(state.workspaceMembers.find((member) => member.id === memberId));
  }

  async getByWorkspaceAndUser(
    workspaceId: string,
    userId: string
  ): Promise<WorkspaceMemberRecord | undefined> {
    const state = await readJsonState(this.filePath);
    return copyOptional(
      state.workspaceMembers.find(
        (member) => member.workspaceId === workspaceId && member.userId === userId
      )
    );
  }

  async listForWorkspace(workspaceId: string): Promise<WorkspaceMemberRecord[]> {
    return this.sortedMembers((member) => member.workspaceId === workspaceId);
  }

  async listAll(): Promise<WorkspaceMemberRecord[]> {
    return this.sortedMembers(() => true);
  }

  private async sortedMembers(
    matches: (member: WorkspaceMemberRecord) => boolean
  ): Promise<WorkspaceMemberRecord[]> {
    const state = await readJsonState(this.filePath);
    return state.workspaceMembers
      .filter(matches)
      .sort(compareWorkspaceMembersByTimeline)
      .map(copy);
  }
}

class JsonFileProjectMemberRepository implements ProjectMemberRepository {
  constructor(private readonly filePath: string) {}

  async save(member: ProjectMemberRecord): Promise<void> {
    await updateJsonState(this.filePath, (state) => {
      state.projectMembers = upsertBy(
        state.projectMembers,
        copy(member),
        (record) => record.id === member.id
      );
    });
  }

  async getById(memberId: string): Promise<ProjectMemberRecord | undefined> {
    const state = await readJsonState(this.filePath);
    return copyOptional(state.projectMembers.find((member) => member.id === memberId));
  }

  async getByProjectAndUser(
    projectId: string,
    userId: string
  ): Promise<ProjectMemberRecord | undefined> {
    const state = await readJsonState(this.filePath);
    return copyOptional(
      state.projectMembers.find(
        (member) => member.projectId === projectId && member.userId === userId
      )
    );
  }

  async listForProject(projectId: string): Promise<ProjectMemberRecord[]> {
    return this.sortedMembers((member) => member.projectId === projectId);
  }

  async listAll(): Promise<ProjectMemberRecord[]> {
    return this.sortedMembers(() => true);
  }

  private async sortedMembers(
    matches: (member: ProjectMemberRecord) => boolean
  ): Promise<ProjectMemberRecord[]> {
    const state = await readJsonState(this.filePath);
    return state.projectMembers
      .filter(matches)
      .sort(compareProjectMembersByTimeline)
      .map(copy);
  }
}
```

Add compare helpers mirroring the in-memory repository helpers. In `parseJsonState()`, default missing arrays:

```ts
    workspaceMembers: parsed.workspaceMembers ?? [],
    projectMembers: parsed.projectMembers ?? [],
```

In `createEmptyJsonState()`, add:

```ts
    workspaceMembers: [],
    projectMembers: [],
```

- [ ] **Step 6: Run DB tests and commit**

Run:

```bash
pnpm --filter @lp-agent/db test
git status --short
git add packages/db/src/workbench-repositories.ts packages/db/src/json-file-workbench-repositories.ts packages/db/src/workbench-repositories.test.ts packages/db/src/json-file-workbench-repositories.test.ts
git commit -m "add collaboration member repositories"
```

Expected: DB tests pass. Commit includes only DB repository and DB test files.

---

### Task 2: Add API Collaboration Identity and Project Membership

**Files:**
- Create: `packages/api/src/collaboration.ts`
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/services.test.ts`

- [ ] **Step 1: Write failing service tests**

In `packages/api/src/services.test.ts`, add these tests near the project creation tests:

```ts
  it("creates an owner project member for the current local user", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories });

    const project = await service.createProject({ name: "Spring sale" });

    await expect(service.listProjectMembers(project.id)).resolves.toEqual([
      {
        id: "project_member_project_1_local-web-user",
        projectId: "project_1",
        userId: "local-web-user",
        role: "owner",
        displayName: "Local user",
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      }
    ]);
  });

  it("uses the configured current user when creating project ownership", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({
      repositories,
      currentUser: {
        id: "user_ada",
        displayName: "Ada Lovelace"
      }
    });

    const project = await service.createProject({ name: "Ada project" });

    await expect(repositories.projectMembers.getByProjectAndUser(project.id, "user_ada"))
      .resolves.toMatchObject({
        projectId: project.id,
        userId: "user_ada",
        role: "owner",
        displayName: "Ada Lovelace"
      });
  });

  it("keeps owner membership creation idempotent for the same project and user", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories });
    const project = await service.createProject({ name: "Spring sale" });

    await service.ensureProjectOwnerMembership(project.id);
    await service.ensureProjectOwnerMembership(project.id);

    await expect(repositories.projectMembers.listForProject(project.id)).resolves.toHaveLength(1);
  });

  it("lists project members only for the requested project", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const service = new DemoWorkbenchService({ repositories });
    const first = await service.createProject({ name: "First" });
    const second = await service.createProject({ name: "Second" });

    await service.addProjectMember({
      projectId: first.id,
      userId: "reviewer_1",
      role: "reviewer",
      displayName: "Review User"
    });

    await expect(service.listProjectMembers(first.id)).resolves.toEqual([
      expect.objectContaining({ userId: "local-web-user", role: "owner" }),
      expect.objectContaining({ userId: "reviewer_1", role: "reviewer" })
    ]);
    await expect(service.listProjectMembers(second.id)).resolves.toEqual([
      expect.objectContaining({ userId: "local-web-user", role: "owner" })
    ]);
  });
```

Add this approval validation test near the existing deployment approval tests:

```ts
  it("rejects deployment approval with a blank reviewer user id", async () => {
    const { service, project, reviewedPageVersion } = await createReviewedPageVersion();

    await expect(
      service.approveAndCreateDeployment({
        projectId: project.id,
        pageVersionId: reviewedPageVersion.id,
        reviewerUserId: "   "
      })
    ).rejects.toThrow("Reviewer user ID is required.");
  });
```

- [ ] **Step 2: Run API tests and verify failure**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: FAIL because collaboration helper exports and service methods do not exist.

- [ ] **Step 3: Create API collaboration helper**

Create `packages/api/src/collaboration.ts`:

```ts
import type { ProjectMemberRecord, ProjectRole } from "@lp-agent/db";

export interface WorkbenchUserIdentity {
  id: string;
  displayName: string;
  email?: string;
}

export interface ProjectMemberView {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
}

export const defaultLocalWorkbenchUser: WorkbenchUserIdentity = {
  id: "local-web-user",
  displayName: "Local user"
};

export function normalizeWorkbenchUserIdentity(
  user: WorkbenchUserIdentity | undefined
): WorkbenchUserIdentity {
  const candidate = user ?? defaultLocalWorkbenchUser;
  const id = candidate.id.trim();
  const displayName = candidate.displayName.trim();
  if (id.length === 0) {
    throw new Error("workbench_user_id_required");
  }
  return {
    id,
    displayName: displayName.length > 0 ? displayName : id,
    ...(candidate.email?.trim() ? { email: candidate.email.trim() } : {})
  };
}

export function createProjectMemberId(projectId: string, userId: string): string {
  return `project_member_${toMembershipIdSegment(projectId)}_${toMembershipIdSegment(userId)}`;
}

export function createWorkspaceMemberId(workspaceId: string, userId: string): string {
  return `workspace_member_${toMembershipIdSegment(workspaceId)}_${toMembershipIdSegment(userId)}`;
}

export function toProjectMemberView(member: ProjectMemberRecord): ProjectMemberView {
  return {
    id: member.id,
    projectId: member.projectId,
    userId: member.userId,
    role: member.role,
    ...(member.displayName ? { displayName: member.displayName } : {}),
    createdAt: member.createdAt,
    updatedAt: member.updatedAt
  };
}

function toMembershipIdSegment(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_-]/g, "_");
  return normalized.length > 0 ? normalized : "unknown";
}
```

- [ ] **Step 4: Wire collaboration into `DemoWorkbenchService`**

In `packages/api/src/index.ts`, import new DB/API types:

```ts
  type ProjectMemberRecord,
  type ProjectRole,
```

```ts
import {
  createProjectMemberId,
  defaultLocalWorkbenchUser,
  normalizeWorkbenchUserIdentity,
  toProjectMemberView,
  type ProjectMemberView,
  type WorkbenchUserIdentity
} from "./collaboration";
```

Export the helper types:

```ts
export {
  createProjectMemberId,
  defaultLocalWorkbenchUser,
  normalizeWorkbenchUserIdentity,
  toProjectMemberView,
  type ProjectMemberView,
  type WorkbenchUserIdentity
} from "./collaboration";
```

Add `currentUser` to `DemoWorkbenchServiceOptions`:

```ts
  currentUser?: WorkbenchUserIdentity;
```

Add a private field:

```ts
  private readonly currentUser: WorkbenchUserIdentity;
```

Set it in the constructor:

```ts
    this.currentUser = normalizeWorkbenchUserIdentity(options.currentUser);
```

In `createProject()`, save owner membership inside the repository lock after project save:

```ts
      await this.repositories.projects.save(project);
      await this.ensureProjectOwnerMembership(project.id);
      return copyProject(project);
```

Add these public methods near `createProject()`:

```ts
  async ensureProjectOwnerMembership(
    projectId: string,
    user: WorkbenchUserIdentity = this.currentUser
  ): Promise<ProjectMemberView> {
    await this.getProjectOrThrow(projectId);
    const normalizedUser = normalizeWorkbenchUserIdentity(user);
    const existing = await this.repositories.projectMembers.getByProjectAndUser(
      projectId,
      normalizedUser.id
    );
    if (existing) {
      return toProjectMemberView(existing);
    }

    const timestamp = this.timestamp();
    const member: ProjectMemberRecord = {
      id: createProjectMemberId(projectId, normalizedUser.id),
      projectId,
      userId: normalizedUser.id,
      role: "owner",
      displayName: normalizedUser.displayName,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.repositories.projectMembers.save(member);
    return toProjectMemberView(member);
  }

  async addProjectMember(input: {
    projectId: string;
    userId: string;
    role: ProjectRole;
    displayName?: string;
  }): Promise<ProjectMemberView> {
    await this.getProjectOrThrow(input.projectId);
    const userId = input.userId.trim();
    if (userId.length === 0) {
      throw new Error("project_member_user_id_required");
    }
    const existing = await this.repositories.projectMembers.getByProjectAndUser(
      input.projectId,
      userId
    );
    const timestamp = this.timestamp();
    const member: ProjectMemberRecord = {
      id: existing?.id ?? createProjectMemberId(input.projectId, userId),
      projectId: input.projectId,
      userId,
      role: input.role,
      ...(input.displayName?.trim() ? { displayName: input.displayName.trim() } : {}),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    await this.repositories.projectMembers.save(member);
    return toProjectMemberView(member);
  }

  async listProjectMembers(projectId: string): Promise<ProjectMemberView[]> {
    await this.getProjectOrThrow(projectId);
    return (await this.repositories.projectMembers.listForProject(projectId)).map(
      toProjectMemberView
    );
  }
```

- [ ] **Step 5: Run API tests and commit**

Run:

```bash
pnpm --filter @lp-agent/api test
git status --short
git add packages/api/src/collaboration.ts packages/api/src/index.ts packages/api/src/services.test.ts
git commit -m "add local collaboration identity"
```

Expected: API tests pass. Commit includes only API files.

---

### Task 3: Add Web Store Identity and Member State

**Files:**
- Create: `apps/web/src/lib/local-identity.ts`
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`

- [ ] **Step 1: Create Web local identity helper**

Create `apps/web/src/lib/local-identity.ts`:

```ts
import {
  defaultLocalWorkbenchUser,
  type WorkbenchUserIdentity
} from "@lp-agent/api";

export function getLocalWorkbenchUser(): WorkbenchUserIdentity {
  return {
    ...defaultLocalWorkbenchUser
  };
}
```

- [ ] **Step 2: Write failing Web store tests**

In `apps/web/src/lib/workbench-store.test.ts`, add tests near project creation/page-state tests:

```ts
  it("adds project member summaries to page state", async () => {
    const store = createWebWorkbenchStore();
    const project = await store.createProject({ name: "Project" });

    const state = await store.getPageState({ projectId: project.id });

    expect(state.kind).toBe("empty");
    expect(state.projectMembers).toEqual([
      expect.objectContaining({
        projectId: project.id,
        userId: "local-web-user",
        role: "owner",
        displayName: "Local user"
      })
    ]);
  });

  it("uses configured current user for implicit LP project ownership", async () => {
    const store = createWebWorkbenchStore({
      currentUser: {
        id: "user_ada",
        displayName: "Ada Lovelace"
      }
    });

    const submitted = await store.submitTaskPrompt({
      prompt: "生成一个电商 LP 页面",
      implicitProjectName: "未命名 LP 项目"
    });
    if (!submitted.ok || !submitted.projectId) {
      throw new Error("Expected LP task submission to create a project.");
    }

    const state = await store.getPageState({ projectId: submitted.projectId });

    expect(state.projectMembers).toEqual([
      expect.objectContaining({
        projectId: submitted.projectId,
        userId: "user_ada",
        role: "owner",
        displayName: "Ada Lovelace"
      })
    ]);
  });
```

Update the existing skill command execution store test so `executeSkillCommand()` no longer passes `approvedByUserId`. After execution, add this expectation against the persisted run events:

```ts
    const events = await repositories.runEvents.listForProject(project.id);
    expect(JSON.stringify(events)).toContain("local-web-user");
```

- [ ] **Step 3: Run Web store tests and verify failure**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts
```

Expected: FAIL because page state does not contain `projectMembers` and store options do not accept `currentUser`.

- [ ] **Step 4: Update Web store types and state loading**

In `apps/web/src/lib/workbench-store.ts`, import collaboration types/helper:

```ts
  type ProjectMemberView,
  type WorkbenchUserIdentity,
```

```ts
import { getLocalWorkbenchUser } from "./local-identity";
```

Add:

```ts
export type ProjectMemberSummary = ProjectMemberView;
```

Remove `approvedByUserId` from `ExecuteSkillCommandFormInput`:

```ts
export interface ExecuteSkillCommandFormInput {
  projectId: string;
  skillVersionId: string;
  commandId: string;
  pageVersionId?: string;
}
```

Add `projectMembers` to both `WorkbenchPageState` variants:

```ts
      projectMembers: ProjectMemberSummary[];
```

Extend store options:

```ts
export interface WebWorkbenchStoreOptions {
  repositories?: WorkbenchRepositories;
  toolCommandRunner?: ToolCommandRunner;
  currentUser?: WorkbenchUserIdentity;
}
```

Before constructing the service:

```ts
  const currentUser = options.currentUser ?? getLocalWorkbenchUser();
```

Pass it to `DemoWorkbenchService`:

```ts
    currentUser,
```

Add helpers near `emptyMCPState()`:

```ts
  const emptyProjectMembers = (): ProjectMemberSummary[] => [];

  const loadProjectMembers = async (projectId?: string | null): Promise<ProjectMemberSummary[]> => {
    if (!projectId) {
      return emptyProjectMembers();
    }
    try {
      return await service.listProjectMembers(projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "project_not_found" || message === "Project not found.") {
        return emptyProjectMembers();
      }
      throw error;
    }
  };
```

In every `getPageState()` return object, add:

```ts
          projectMembers: await loadProjectMembers(requestedProject?.id),
```

or:

```ts
        projectMembers: await loadProjectMembers(activeProjectId),
```

In `executeSkillCommand(input)`, pass actor id from `currentUser`:

```ts
        const value = await service.executeProjectSkillCommand({
          ...input,
          approvedByUserId: currentUser.id
        });
```

- [ ] **Step 5: Run Web store tests and commit**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts
git status --short
git add apps/web/src/lib/local-identity.ts apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts
git commit -m "add web collaboration state"
```

Expected: Web store tests pass. Commit includes only Web store/local identity files.

---

### Task 4: Render Member Summaries and Use Local Actor in Actions

**Files:**
- Modify: `apps/web/src/app/actions.ts`
- Modify: `apps/web/src/app/actions.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Write failing i18n tests**

In `apps/web/src/lib/i18n.test.ts`, add assertions to the English and Chinese copy tests:

```ts
    expect(en.collaboration.title).toBe("Project members");
    expect(en.collaboration.localIdentity).toBe("Local identity");
    expect(en.collaboration.localUser).toBe("Local user");
    expect(en.collaboration.roleLabels.owner).toBe("Owner");
```

```ts
    expect(zh.collaboration.title).toBe("项目成员");
    expect(zh.collaboration.localIdentity).toBe("本地身份");
    expect(zh.collaboration.localUser).toBe("本地用户");
    expect(zh.collaboration.roleLabels.owner).toBe("负责人");
```

- [ ] **Step 2: Write failing action tests**

In `apps/web/src/app/actions.test.ts`, update the skill command action test to keep setting a malicious form actor:

```ts
    formData.set("approvedByUserId", "attacker");
```

Assert the store receives no submitted actor field if the action mock captures input, or assert it receives `approvedByUserId: "local-web-user"` only after the store boundary if the current mock is typed that way. Keep the existing expectation that stale submitted actor ids are ignored:

```ts
    expect(executeSkillCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        approvedByUserId: "local-web-user"
      })
    );
```

For MCP approval action tests, continue asserting the submitted project/tool fields are respected but submitted actor ids are ignored:

```ts
    formData.set("approvedByUserId", "attacker");
    expect(setMCPToolApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        approvedByUserId: "local-web-user"
      })
    );
```

- [ ] **Step 3: Write failing page rendering tests**

In `apps/web/src/app/page.test.ts`, update the mocked page state fixture to include:

```ts
projectMembers: [
  {
    id: "project_member_project_1_local-web-user",
    projectId: "project_1",
    userId: "local-web-user",
    role: "owner",
    displayName: "Local user",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z"
  }
],
```

Add an English rendering assertion:

```ts
expect(text).toContain("Project members");
expect(text).toContain("Local user");
expect(text).toContain("Owner");
```

Add a Chinese rendering assertion in the Chinese locale test:

```ts
expect(text).toContain("项目成员");
expect(text).toContain("本地用户");
expect(text).toContain("负责人");
```

- [ ] **Step 4: Run Web tests and verify failure**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts
```

Expected: FAIL because copy, action actor resolution, and member rendering are not implemented.

- [ ] **Step 5: Add collaboration copy**

In `apps/web/src/lib/i18n.ts`, add this to the copy type:

```ts
  collaboration: {
    title: string;
    localIdentity: string;
    localUser: string;
    empty: string;
    roleLabels: Record<"owner" | "admin" | "member" | "reviewer", string>;
  };
```

Add English copy:

```ts
    collaboration: {
      title: "Project members",
      localIdentity: "Local identity",
      localUser: "Local user",
      empty: "No members recorded for this project yet.",
      roleLabels: {
        owner: "Owner",
        admin: "Admin",
        member: "Member",
        reviewer: "Reviewer"
      }
    },
```

Add Chinese copy:

```ts
    collaboration: {
      title: "项目成员",
      localIdentity: "本地身份",
      localUser: "本地用户",
      empty: "当前项目还没有成员记录。",
      roleLabels: {
        owner: "负责人",
        admin: "管理员",
        member: "成员",
        reviewer: "审核员"
      }
    },
```

- [ ] **Step 6: Resolve actors from local identity in actions**

In `apps/web/src/app/actions.ts`, import the helper:

```ts
import { getLocalWorkbenchUser } from "../lib/local-identity";
```

Remove:

```ts
const localWebApprovalUserId = "local-web-user";
```

In `executeSkillCommandAction()`, resolve actor:

```ts
  const actor = getLocalWorkbenchUser();
```

Pass:

```ts
    approvedByUserId: actor.id
```

Add `approvedByUserId?: string` to `SetMCPToolApprovalFormInput` in `apps/web/src/lib/workbench-store.ts`, pass it through to `service.setProjectMCPToolApproval()`, and in `setMCPToolApprovalAction()` pass:

```ts
    approvedByUserId: getLocalWorkbenchUser().id
```

Do not read `approvedByUserId` from `formData`.

- [ ] **Step 7: Render project members in the page**

In `apps/web/src/app/page.tsx`, extend the existing `../lib/workbench-store` import with:

```ts
  type WorkbenchPageState
```

Add this helper below `getPageMCPState()`:

```tsx
function ProjectMembersBlock({
  members,
  copy
}: {
  members: WorkbenchPageState["projectMembers"];
  copy: ReturnType<typeof getWorkbenchCopy>["collaboration"];
}) {
  return (
    <section className="projectMembers" aria-label={copy.title}>
      <div className="panelSectionHeader">
        <span>{copy.title}</span>
      </div>
      {members.length === 0 ? (
        <p className="mutedText">{copy.empty}</p>
      ) : (
        <ul className="projectMemberList">
          {members.map((member) => (
            <li key={member.id} className="projectMemberItem">
              <span>{member.userId === "local-web-user" ? copy.localUser : member.displayName ?? member.userId}</span>
              <strong>{copy.roleLabels[member.role]}</strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

Render it once in the sidebar immediately after the projects section and before the tasks section:

```tsx
<ProjectMembersBlock members={pageState.projectMembers} copy={copy.collaboration} />
```

- [ ] **Step 8: Add CSS for compact member list**

In `apps/web/src/app/globals.css`, add styles near other sidebar/settings panel styles:

```css
.projectMembers {
  display: grid;
  gap: 10px;
}

.projectMemberList {
  display: grid;
  gap: 6px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.projectMemberItem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  color: var(--text-primary);
  font-size: 13px;
}

.projectMemberItem span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.projectMemberItem strong {
  color: var(--text-muted);
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 600;
}
```

- [ ] **Step 9: Run Web tests and commit**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts
git status --short
git add apps/web/src/app/actions.ts apps/web/src/app/actions.test.ts apps/web/src/lib/i18n.ts apps/web/src/lib/i18n.test.ts apps/web/src/app/page.tsx apps/web/src/app/page.test.ts apps/web/src/app/globals.css
git commit -m "show project collaboration members"
```

Expected: targeted Web tests pass. Commit includes only action, i18n, page, CSS, and their tests.

---

### Task 5: Documentation, Full Verification, and Final Review

**Files:**
- Modify: `docs/agent-development-learning.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Update learning document after implementation**

In `docs/agent-development-learning.md`, in Stage 7, change the current design-only list to include the implementation plan:

```md
- 当前实现计划：[2026-05-17-collaboration-primitives.md](./superpowers/plans/2026-05-17-collaboration-primitives.md)
```

After implementation is complete, add bullets stating:

```md
- Stage 7 v0 已实现本地 `local-web-user` identity helper、project owner membership 自动创建、workspace/project member repository、JSON-file 持久化和 Web 项目成员只读展示。
- 当前仍不做真实 auth、邀请、复杂 RBAC 或实时协作；membership 是产品状态，不是完整安全边界。
```

- [ ] **Step 2: Update Superpowers README reading order**

In `docs/superpowers/README.md`, after the Stage 7 design entry, add:

```md
43. `plans/2026-05-17-collaboration-primitives.md`
   - Stage 7 collaboration primitives implementation plan.
   - Read this after the collaboration primitives design when implementing local identity, member repositories, project owner creation, approval actor ownership, Web member state, and documentation updates.
```

- [ ] **Step 3: Run targeted verification**

Run:

```bash
pnpm --filter @lp-agent/db test
pnpm --filter @lp-agent/api test
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts apps/web/src/lib/i18n.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all commands pass.

- [ ] **Step 5: Commit documentation updates**

Run:

```bash
git status --short
git add docs/agent-development-learning.md docs/superpowers/README.md
git commit -m "document collaboration primitives completion"
```

Expected: commit includes only documentation updates.

- [ ] **Step 6: Request final review**

Use `superpowers:requesting-code-review` for the full Stage 7 implementation. Ask the reviewer to verify:

- member repositories are scoped and defensively copied,
- local identity is centralized and Web forms cannot spoof actor ids,
- project owner creation is idempotent,
- Web member rendering is read-only and localized,
- no real auth, invitation, deployment, or realtime scope slipped in,
- generated LP artifacts remain framework-free.

Address any review findings using `superpowers:receiving-code-review`, then rerun:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: final reviewer approves and verification passes.
