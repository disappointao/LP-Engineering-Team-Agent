# Collaboration Primitives v0 Design

## Purpose

Stage 7 adds the first durable team-collaboration layer for the LP Engineering Team Agent. The goal is to make project membership, roles, local user identity, and approval/audit ownership explicit records that future agent runs, reviews, and deployment workflows can depend on.

This is not a hosted authentication system. Web V1 should keep using a local deterministic identity while the code introduces stable seams for a later real identity provider, desktop-local user profile, or company SSO integration.

## Current Baseline

The project already has:

- `ProjectRole` in `packages/lp-schema` and Prisma: `owner`, `admin`, `member`, `reviewer`.
- Prisma models for `Workspace`, `WorkspaceMember`, `Project`, and `ProjectMember`.
- Repository-backed local Web state through `@lp-agent/db` in-memory and JSON-file repositories.
- MCP tool approval records with `approvedByUserId`.
- Deployment approval entry points that accept `reviewerUserId`.
- Skill command execution that accepts `approvedByUserId` and writes sanitized tool events.
- Agent handoff state for the fixed Planner -> Builder -> Reviewer -> Deployer LP chain.

The missing piece is that Web/API local state does not yet treat users and project members as first-class records. Most flows use hardcoded local user ids or pass approval user ids without a durable membership model.

## Goals

1. Add local deterministic user identity as an explicit Web/API dependency.
2. Persist workspace and project member records in repository interfaces and JSON-file local state.
3. Automatically create a project owner member when a project is created from the Web/API flow.
4. Expose project member summaries to the Web workbench so users can see who belongs to the project and which role they have.
5. Attach approval/audit user ids to collaboration-aware service operations through a shared local identity path, not scattered string literals.
6. Keep the data model compatible with the existing Prisma `WorkspaceMember` and `ProjectMember` concepts.
7. Leave clean extension points for future real auth, invitations, team approvals, and role-aware authorization.

## Non-Goals

This stage does not build:

- Real login, signup, OAuth, SSO, sessions, or hosted multi-tenant auth.
- Invite emails, pending invitations, seat management, or billing.
- Realtime multiplayer editing or presence.
- A complete RBAC permission matrix.
- Organization/workspace management UI.
- Automatic production deployment.
- Full deployment approval workflow UI.
- Cross-project user preferences or long-term user memory.
- Generic multi-agent DAG collaboration.

## Product Behavior

### Local Identity

Web V1 should continue to run without login. The current user is resolved through a small local identity provider:

- user id: `local-web-user`
- display name: localized copy such as `Local user` / `本地用户`
- email: optional and local-only

This identity is used consistently when:

- creating projects,
- creating project owner membership,
- approving MCP tools,
- executing skill commands,
- approving or preparing deployment handoff paths where applicable.

The local identity must be injected through a narrow helper, not repeated as string literals across actions and services. Later auth can replace this helper without rewriting store or service calls.

### Membership Records

Stage 7 v0 introduces repository-level records:

- `WorkspaceMemberRecord`
- `ProjectMemberRecord`

Each record should include:

- stable `id`,
- `workspaceId` or `projectId`,
- `userId`,
- `role`,
- optional display metadata snapshot such as `displayName`,
- `createdAt`,
- `updatedAt` when mutation is supported.

The first implementation can focus on project members. Workspace members should still have repository contracts because Prisma already models them and future team scope depends on them.

### Project Creation

When a project is created from the normal Web/API flow:

1. The project is persisted.
2. The current local user is persisted as the project owner.
3. Re-creating membership for the same project/user is idempotent.
4. Project state returned to Web includes the owner member summary.

This is a collaboration primitive, not an authorization gate. Existing local flows should continue to work even before real auth exists.

### Member Management v0

The first Web surface should be minimal:

- show project members in the project/workspace side area or settings-like panel,
- show role labels in Chinese and English,
- show the current local user as owner,
- keep controls read-only unless a very small add-member local test helper is needed for development.

If add-member UI is included, it should only create local deterministic member records from a simple user id and role. It must not imply real invitations or account provisioning.

### Approval and Audit Ownership

Collaboration v0 should make approval actor ids consistent and visible:

- MCP tool approvals keep `approvedByUserId`.
- Skill command approval uses the local identity helper instead of hardcoded action-level constants.
- Deployment handoff approval paths keep accepting `reviewerUserId`, but real deployment remains deferred.
- Run events and tool events may include sanitized actor metadata only when it is already safe and useful. Raw user profile data should not be injected into events.

The goal is durable audit ownership, not a security model yet.

## Data Model

### Repository Types

Add repository types in `packages/db/src/workbench-repositories.ts`:

- `ProjectRole`
- `WorkspaceMemberRecord`
- `ProjectMemberRecord`
- `WorkspaceMemberRepository`
- `ProjectMemberRepository`

Repository methods should support:

- `save(record)`
- `getById(id)`
- `getByWorkspaceAndUser(workspaceId, userId)`
- `getByProjectAndUser(projectId, userId)`
- `listForWorkspace(workspaceId)`
- `listForProject(projectId)`
- `listAll()`

Records must be defensively copied, matching the rest of `@lp-agent/db`.

### JSON-File State

Extend `JsonWorkbenchState` with:

- `workspaceMembers: WorkspaceMemberRecord[]`
- `projectMembers: ProjectMemberRecord[]`

Existing JSON files should continue to load by defaulting missing arrays to `[]`.

### Prisma Alignment

The repository record fields should map cleanly to existing Prisma models, even if Prisma-backed repositories are not implemented in this slice:

- `WorkspaceMember.workspaceId`
- `WorkspaceMember.userId`
- `WorkspaceMember.role`
- `ProjectMember.projectId`
- `ProjectMember.userId`
- `ProjectMember.role`

If optional display metadata is stored in local JSON v0, it should be clearly local-only and not require a Prisma migration yet.

## API and Store Design

### Local Identity Boundary

Add a small Web/API helper for local identity. Suggested shape:

```ts
export interface WorkbenchUserIdentity {
  id: string;
  displayName: string;
  email?: string;
}
```

The Web store can accept `currentUser?: WorkbenchUserIdentity` and default to `local-web-user`.

### Service Methods

`DemoWorkbenchService` should gain minimal collaboration methods:

- `ensureProjectOwnerMembership(projectId, user)`
- `listProjectMembers(projectId)`
- optionally `addProjectMember(input)` for tests or local Web development

`createProject()` should call the owner membership helper when a current user is provided. If a caller uses the service without identity, deterministic tests may still pass by using the default local identity.

### Page State

Web page state should include:

```ts
projectMembers: Array<{
  id: string;
  userId: string;
  displayName?: string;
  role: "owner" | "admin" | "member" | "reviewer";
  createdAt: string;
}>
```

The page should render this as read-only collaboration context in the current project surface.

## Context Pack Interaction

Collaboration v0 should not inject full member lists into model context by default. That would increase prompt size without improving current LP generation quality.

It is acceptable to reserve a future `collaboration` field in runtime context later, but this stage should focus on durable state and Web/API audit ownership. If a minimal context summary is added, it must be:

- project-scoped,
- bounded,
- role-aware,
- schema-validated,
- limited to ids/roles/display names,
- omitted from deterministic runtime output.

## Security and Privacy Rules

- Local identity is not authentication.
- Membership records are product state, not a security boundary yet.
- Never trust submitted `approvedByUserId` from Web forms.
- Server actions should resolve the actor from the local identity helper.
- Do not store secrets, API keys, cookies, or raw auth tokens in member records.
- Do not inject emails or private user profile fields into model prompts by default.

## Testing Strategy

### DB Tests

Cover:

- in-memory workspace/project member save, lookup, list, and defensive copies,
- JSON-file reopen behavior,
- defaulting missing member arrays to empty arrays,
- idempotent same project/user membership upsert behavior if implemented.

### API Tests

Cover:

- project creation creates owner membership,
- listing project members is project-scoped,
- duplicate owner creation does not create duplicate members,
- approval actor ids use service/action identity rather than form-submitted ids.

### Web Tests

Cover:

- page state includes project member summaries,
- localized role labels render in English and Chinese,
- skill command and MCP approval actions still ignore submitted actor ids,
- existing LP generation, skills, MCP, and model flows continue to render.

### Verification Commands

Before completion:

```bash
pnpm --filter @lp-agent/db test
pnpm --filter @lp-agent/api test
pnpm exec vitest run apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts apps/web/src/lib/i18n.test.ts
pnpm test
pnpm typecheck
pnpm build
```

Run `git diff --check` before committing.

## Rollout and Compatibility

This stage should be backward-compatible with existing local JSON state. Existing local projects without members should load normally. The first page load or project mutation may create owner membership for the active local project if the implementation chooses to backfill, but silent broad migrations are not required for v0.

Generated LP artifacts remain framework-free static HTML/CSS/JS. Collaboration state belongs to the workbench and API, not to generated LP output.

## Future Work

After v0 is stable, later stages can add:

- real authenticated users,
- user profile repository,
- workspace/project invite workflow,
- role-aware permission checks for skill publishing, MCP approvals, and deployment approvals,
- reviewer assignment and approval queues,
- handoff UI cards with actor identity,
- collaboration summaries in Context Pack,
- realtime presence and comments,
- desktop-local user profile synchronization.
