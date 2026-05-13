# Project Skills Management and Runtime Context Spec

## Purpose

Add the first real skills-management slice to the Web workbench.

Users should be able to create or upload project-level skills, validate them, publish them, bind them to a project, and have the agent runtime load those published project-bound skills during ordinary chat and LP generation tasks.

This slice keeps generated LP artifacts framework-free static HTML/CSS/JS. It also keeps direct deployment out of scope; deployment skills may be managed as data, but publishing one must not execute a command, Git write, shell script, or remote deploy.

## Current Baseline

The repository already has these foundations:

- `packages/skills` defines `SkillManifestSchema`, skill scopes, skill types, publish permission rules, and `canUseSkill`.
- `packages/db/prisma/schema.prisma` already includes `Skill`, `SkillVersion`, and `SkillBinding` models.
- `packages/api` currently injects a hardcoded `sampleTemplateSkill` into `DemoWorkbenchService` runtime context.
- `apps/web` already has a Manus-style conversation-first workbench and sidebar nav item for Skills.
- Local Web state is now repository-backed and can persist through `.lp-agent/workbench-state.json`.

The missing product slice is the actual user-facing skill lifecycle and the repository-backed runtime lookup.

## Goals

- Support project-level skills first.
- Let users create skills from:
  - pasted `manifest.json` content,
  - uploaded or pasted Markdown/text skill content.
- Enforce a simple lifecycle:
  - `draft`,
  - `validated`,
  - `published`.
- Allow only published skill versions to be bound and enabled for a project.
- Load enabled project-bound published skill versions into `RuntimeRunContext`.
- Replace the hardcoded sample skill in `packages/api` with repository-backed runtime skill resolution.
- Treat skill content as data, not executable code.
- Keep single-user local development simple by treating the current user as `owner`.
- Preserve later compatibility with workspace, organization, and global scopes.

## Non-Goals

- No real authentication or team role UI.
- No organization/workspace/global skill-management UI in this slice.
- No marketplace, remote registry, or package installation flow.
- No execution of JavaScript, Python, shell, or binary content from uploaded skills.
- No direct deployment feature.
- No production multi-tenant permission model.
- No realtime collaboration.

## Scope Decisions

### Skill Scope

The Web V1 exposes only project-level skill management.

The data model and repository interfaces should still use the existing `SkillScope` shape so workspace, organization, and global scopes can be added later without replacing the core contracts.

For this slice:

- UI-created skills must use `scope: "project"`.
- Project bindings use `targetKey = projectId`.
- If an imported manifest uses another scope, the Web flow should reject it with a clear validation error.

### Creation Entry

The first version supports paste and file upload:

- Manifest is entered as JSON text.
- Content can be pasted into a textarea or uploaded as a `.md` or `.txt` file.
- Content is stored as plain text.
- File size should be capped for local MVP safety; 200 KB is enough for the first version.

### Publish Flow

The review state is server-managed.

Uploaded manifests must still parse against `SkillManifestSchema`, but persisted drafts should start as `draft` even if the pasted manifest claims `validated` or `published`.

Whenever lifecycle actions change review state, both `SkillVersionRecord.reviewState` and the stored manifest's `reviewState` must be updated together so API code and runtime code never read conflicting states.

Lifecycle actions:

1. Create draft.
2. Validate draft.
3. Publish validated version.
4. Bind published version to current project.
5. Enable or disable the project binding.

Publishing should call `canPublishSkill` with the current local role. In this Web V1, the current role is fixed as `owner`.

### Runtime Integration

Published and enabled project-bound skills must enter the agent runtime context.

The runtime should no longer silently inject `sampleTemplateSkill`. If the product needs a demo skill, that skill should be seeded as repository data and displayed in the Skills UI like any other skill.

When no skills are bound, runtime context should contain an empty `skills` array and no skill-derived MCP permissions.

## Skill Validation Rules

Accepted inputs:

- JSON manifest that passes `SkillManifestSchema`.
- Markdown or plain text skill content.
- Skill types: `workflow`, `template`, `deployment`.
- Project scope only for this slice.

Rejected inputs:

- Invalid JSON.
- Manifest fields outside the strict schema.
- Empty `id`, `name`, `description`, or invalid semver `version`.
- Duplicate `skillId + version`.
- Non-project scopes in the Web V1.
- JavaScript, shell, Python, binary, archive, or executable files as skill content.
- Content over the local MVP size cap.

Deployment-skill behavior:

- A deployment skill may be created, validated, published, and bound.
- Publishing a deployment skill only makes it visible to the agent runtime.
- It must not run deployment commands.
- Future command or MCP execution must go through explicit approval and adapter boundaries.

## Repository Design

Extend `@lp-agent/db` repository contracts with skill repositories while keeping the current Prisma schema shape.

Recommended records:

```ts
export interface SkillRecord {
  id: string;
  name: string;
  type: SkillType;
  scope: SkillScope;
  createdAt: string;
}

export interface SkillVersionRecord {
  id: string;
  skillId: string;
  version: string;
  manifest: SkillManifest;
  content: string;
  reviewState: SkillManifest["reviewState"];
  createdAt: string;
}

export interface SkillBindingRecord {
  id: string;
  skillVersionId: string;
  scope: SkillScope;
  targetKey: string;
  projectId?: string;
  enabled: boolean;
  settings?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

Recommended repositories:

```ts
export interface SkillRepository {
  listAll(): Promise<SkillRecord[]>;
  getById(id: string): Promise<SkillRecord | undefined>;
  save(record: SkillRecord): Promise<void>;
}

export interface SkillVersionRepository {
  listAll(): Promise<SkillVersionRecord[]>;
  listForSkill(skillId: string): Promise<SkillVersionRecord[]>;
  getById(id: string): Promise<SkillVersionRecord | undefined>;
  getBySkillIdAndVersion(skillId: string, version: string): Promise<SkillVersionRecord | undefined>;
  save(record: SkillVersionRecord): Promise<void>;
}

export interface SkillBindingRepository {
  listAll(): Promise<SkillBindingRecord[]>;
  listForProject(projectId: string): Promise<SkillBindingRecord[]>;
  getById(id: string): Promise<SkillBindingRecord | undefined>;
  save(record: SkillBindingRecord): Promise<void>;
}
```

The in-memory and JSON-file repository adapters should both implement these contracts. Repository methods must return defensive copies.

## API Design

`packages/api` should own skill use cases and runtime resolution. Web server actions should call API methods instead of reaching directly into repositories.

Recommended service methods:

- `createSkillDraft(input)`
- `validateSkillVersion(input)`
- `publishSkillVersion(input)`
- `bindSkillVersionToProject(input)`
- `setProjectSkillBindingEnabled(input)`
- `listProjectSkillState(projectId)`
- `listRuntimeSkillsForProject(projectId)`

Runtime context creation should become async and project-aware:

```ts
createWorkbenchRuntimeContext({
  projectId,
  role,
  repositories,
  approvalState
})
```

The runtime context should include:

- published enabled project-bound skills,
- the text content needed by the runtime or model gateway,
- skill-derived permissions,
- MCP tools visible for those permissions.

Because current `RuntimeSkillContext` only carries metadata, this slice should extend it with plain text content fields such as:

```ts
content: string;
contentType: "text/markdown" | "text/plain";
```

## Web UX Design

The Web app should keep the existing conversation-first layout.

The Skills nav item opens a project skills management view in the main workspace. A separate route is not required for the first version, but a query-driven view such as `?view=skills` is acceptable if it keeps the current sidebar and shell.

The Skills view should show:

- active project context,
- skill creation form,
- manifest JSON textarea,
- content textarea or upload input,
- validation and publish actions,
- list of skill versions,
- review state badges,
- bind, unbind, enable, and disable actions for the current project,
- clear validation errors.

The Workbench conversation view should also expose a lightweight signal that skills are active, such as a small bound-skill count or skill chips in the runtime/process area.

All visible copy must go through the existing Chinese/English i18n layer and continue using request language detection.

## Error Handling

Use typed or stable error codes for Web actions so Chinese and English copy can be mapped cleanly.

Required errors:

- invalid manifest JSON,
- manifest schema validation failed,
- unsupported skill scope,
- duplicate skill version,
- unsupported content type,
- content too large,
- project not found,
- skill version not found,
- skill version not validated,
- skill version not published,
- binding already exists,
- publish not allowed.

Errors should be shown inline in the Skills view. Stack traces or raw Zod output should not be shown directly to users.

## Testing Requirements

Add focused tests for:

- skill draft creation normalizes review state to `draft`,
- invalid manifests and non-project scopes are rejected,
- duplicate `skillId + version` is rejected,
- validation moves a draft to `validated`,
- publishing uses `canPublishSkill` with local `owner` role,
- only published versions can be bound,
- disabled bindings do not enter runtime context,
- project-bound published skills enter builder and reviewer runtime contexts,
- no hardcoded sample skill is injected when the repository has no bound skills,
- JSON-file repositories persist skills, versions, and bindings across reopened repository instances.

Web tests should cover:

- Skills nav renders the management view,
- manifest/content validation errors are visible,
- a published bound skill is visible as active project context.

## Acceptance Criteria

- Users can create a project-level skill draft from pasted manifest JSON and text/Markdown content.
- Users can validate and publish that skill.
- Users can bind the published skill to the active project.
- Agent runtime context includes the published enabled project-bound skill and its content.
- Agent runtime context has no hidden default sample skill when no project skills are bound.
- Deployment skills can be managed but do not execute deployment actions.
- Generated LP output remains framework-free static HTML/CSS/JS.
- `pnpm test` passes.
- `pnpm typecheck` passes.
- `pnpm build` passes.
- `docs/superpowers/README.md` includes this spec in reading order.

## Future Follow-Ups

- Add workspace, organization, and global scope UI and resolution.
- Add real users, team roles, and approval workflows.
- Add skill version diff and review notes.
- Add marketplace or shared internal registry.
- Add command/MCP-backed deployment skill execution behind explicit approval.
- Add Prisma/Postgres implementations for hosted use.
- Reuse JSON-file skill repositories as a desktop-local storage adapter.
