# Project Skills Management and Runtime Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build project-level skill creation, validation, publishing, project binding, and runtime context loading for the Web MVP.

**Architecture:** Extend the existing repository bundle with skill, skill-version, and skill-binding repositories, then add API use cases that own skill lifecycle and runtime resolution. The Web layer stays a thin facade over `DemoWorkbenchService`, using server actions and the existing single-page Manus-style shell.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Next.js server actions, existing JSON-file local state, Zod skill manifest validation.

---

## File Structure

- Modify `packages/db/src/workbench-repositories.ts`
  - Add skill record types, repository contracts, in-memory implementations, copy helpers, and attach repositories to `WorkbenchRepositories`.
- Modify `packages/db/src/json-file-workbench-repositories.ts`
  - Persist `skills`, `skillVersions`, and `skillBindings` in `.lp-agent/workbench-state.json`.
- Modify `packages/db/src/workbench-repositories.test.ts`
  - Cover in-memory skill repositories and defensive copies.
- Modify `packages/db/src/json-file-workbench-repositories.test.ts`
  - Cover JSON-file reopening and readable state for skills.
- Modify `packages/runtime-adapters/src/index.ts`
  - Add text content fields to `RuntimeSkillContext`.
- Modify `packages/runtime-adapters/src/index.test.ts`
  - Update existing runtime context test expectations.
- Modify `packages/model-gateway/src/index.ts`
  - Preserve added runtime skill content when requests are cloned.
- Modify `packages/model-gateway/src/index.test.ts`
  - Update model-gateway context tests for content fields.
- Modify `packages/api/src/index.ts`
  - Add skill lifecycle service methods, project-aware runtime context resolution, and remove hidden sample skill injection.
- Modify `packages/api/src/services.test.ts`
  - Add API tests for lifecycle, binding, runtime context, and no hidden default skill.
- Modify `apps/web/src/lib/workbench-store.ts`
  - Add Web-facing skill state, validation helpers, lifecycle methods, and project-bound skill counts.
- Modify `apps/web/src/lib/workbench-store.test.ts`
  - Cover Web store skill lifecycle and active project state.
- Modify `apps/web/src/app/actions.ts`
  - Add server actions for skill draft creation, validation, publishing, binding, and binding enablement.
- Modify `apps/web/src/app/actions.test.ts`
  - Cover action calls and redirects/error mapping.
- Modify `apps/web/src/lib/i18n.ts`
  - Add Chinese/English copy for Skills view and error messages.
- Modify `apps/web/src/app/page.tsx`
  - Add query-driven `?view=skills` rendering while preserving the existing workbench view.
- Modify `apps/web/src/app/page.test.ts`
  - Cover Skills nav/view rendering and active bound skill signal.
- Modify `apps/web/src/app/globals.css`
  - Add Skills view styles consistent with current restrained workbench design.
- Modify `docs/superpowers/README.md`
  - Add this plan after the project skills spec.

## Task 1: Add Skill Repository Contracts and In-Memory Storage

**Files:**
- Modify: `packages/db/src/workbench-repositories.ts`
- Test: `packages/db/src/workbench-repositories.test.ts`

- [ ] **Step 1: Write failing in-memory repository tests**

Add these imports to `packages/db/src/workbench-repositories.test.ts`:

```ts
import type { SkillBindingRecord, SkillRecord, SkillVersionRecord } from "./index";
```

Add this test case:

```ts
it("persists skills, versions, and bindings with defensive copies", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const skill: SkillRecord = {
    id: "skill_brand",
    name: "Brand LP",
    type: "template",
    scope: "project",
    createdAt
  };
  const version: SkillVersionRecord = {
    id: "skill_version_1",
    skillId: skill.id,
    version: "1.0.0",
    manifest: {
      id: skill.id,
      name: skill.name,
      version: "1.0.0",
      type: "template",
      scope: "project",
      description: "Brand LP sections.",
      permissions: ["brief:read", "artifact:write"],
      requiredSecrets: [],
      entrypoints: ["skills/brand.md"],
      reviewState: "published"
    },
    content: "# Brand LP\nUse concise ecommerce sections.",
    contentType: "text/markdown",
    reviewState: "published",
    createdAt
  };
  const binding: SkillBindingRecord = {
    id: "skill_binding_1",
    skillVersionId: version.id,
    scope: "project",
    targetKey: "project_1",
    projectId: "project_1",
    enabled: true,
    createdAt,
    updatedAt: createdAt
  };

  await repositories.skills.save(skill);
  await repositories.skillVersions.save(version);
  await repositories.skillBindings.save(binding);

  const savedVersion = await repositories.skillVersions.getById(version.id);
  if (!savedVersion) {
    throw new Error("Expected saved skill version.");
  }
  savedVersion.manifest.permissions.push("mutated:permission");

  await expect(repositories.skills.listAll()).resolves.toEqual([skill]);
  await expect(repositories.skillVersions.listForSkill(skill.id)).resolves.toEqual([version]);
  await expect(
    repositories.skillVersions.getBySkillIdAndVersion(skill.id, "1.0.0")
  ).resolves.toEqual(version);
  await expect(repositories.skillBindings.listForProject("project_1")).resolves.toEqual([
    binding
  ]);
  await expect(repositories.skillVersions.getById(version.id)).resolves.toEqual(version);
});
```

- [ ] **Step 2: Run the focused DB repository test and verify it fails**

Run:

```bash
pnpm --filter @lp-agent/db test -- src/workbench-repositories.test.ts
```

Expected: FAIL because `SkillRecord`, `SkillVersionRecord`, `SkillBindingRecord`, and `repositories.skills` do not exist.

- [ ] **Step 3: Add skill record types and repository interfaces**

In `packages/db/src/workbench-repositories.ts`, add imports:

```ts
import type { SkillManifest, SkillScope, SkillType } from "@lp-agent/skills";
```

Add record types after `WorkbenchTaskSnapshotRecord`:

```ts
export type SkillContentType = "text/markdown" | "text/plain";

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
  contentType: SkillContentType;
  reviewState: SkillManifest["reviewState"];
  createdAt: string;
}

export interface SkillBindingRecord {
  id: string;
  skillVersionId: string;
  scope: SkillScope;
  targetKey: string;
  organizationId?: string;
  workspaceId?: string;
  projectId?: string;
  enabled: boolean;
  settings?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

Add repository interfaces before `WorkbenchRepositories`:

```ts
export interface SkillRepository {
  save(skill: SkillRecord): Promise<void>;
  getById(skillId: string): Promise<SkillRecord | undefined>;
  listAll(): Promise<SkillRecord[]>;
}

export interface SkillVersionRepository {
  save(version: SkillVersionRecord): Promise<void>;
  getById(versionId: string): Promise<SkillVersionRecord | undefined>;
  getBySkillIdAndVersion(
    skillId: string,
    version: string
  ): Promise<SkillVersionRecord | undefined>;
  listForSkill(skillId: string): Promise<SkillVersionRecord[]>;
  listAll(): Promise<SkillVersionRecord[]>;
}

export interface SkillBindingRepository {
  save(binding: SkillBindingRecord): Promise<void>;
  getById(bindingId: string): Promise<SkillBindingRecord | undefined>;
  listForProject(projectId: string): Promise<SkillBindingRecord[]>;
  listAll(): Promise<SkillBindingRecord[]>;
}
```

Extend `WorkbenchRepositories`:

```ts
  skills: SkillRepository;
  skillVersions: SkillVersionRepository;
  skillBindings: SkillBindingRepository;
```

- [ ] **Step 4: Implement in-memory skill repositories**

In `InMemoryWorkbenchRepositories`, add:

```ts
  readonly skills = new InMemorySkillRepository();
  readonly skillVersions = new InMemorySkillVersionRepository();
  readonly skillBindings = new InMemorySkillBindingRepository();
```

Add these classes before `InMemoryProjectRepository`:

```ts
class InMemorySkillRepository implements SkillRepository {
  private readonly skills = new Map<string, SkillRecord>();

  async save(skill: SkillRecord): Promise<void> {
    this.skills.set(skill.id, copySkill(skill));
  }

  async getById(skillId: string): Promise<SkillRecord | undefined> {
    const skill = this.skills.get(skillId);
    return skill ? copySkill(skill) : undefined;
  }

  async listAll(): Promise<SkillRecord[]> {
    return [...this.skills.values()].map(copySkill);
  }
}

class InMemorySkillVersionRepository implements SkillVersionRepository {
  private readonly versions = new Map<string, SkillVersionRecord>();

  async save(version: SkillVersionRecord): Promise<void> {
    this.versions.set(version.id, copySkillVersion(version));
  }

  async getById(versionId: string): Promise<SkillVersionRecord | undefined> {
    const version = this.versions.get(versionId);
    return version ? copySkillVersion(version) : undefined;
  }

  async getBySkillIdAndVersion(
    skillId: string,
    version: string
  ): Promise<SkillVersionRecord | undefined> {
    const record = [...this.versions.values()].find(
      (candidate) => candidate.skillId === skillId && candidate.version === version
    );
    return record ? copySkillVersion(record) : undefined;
  }

  async listForSkill(skillId: string): Promise<SkillVersionRecord[]> {
    return [...this.versions.values()]
      .filter((version) => version.skillId === skillId)
      .map(copySkillVersion);
  }

  async listAll(): Promise<SkillVersionRecord[]> {
    return [...this.versions.values()].map(copySkillVersion);
  }
}

class InMemorySkillBindingRepository implements SkillBindingRepository {
  private readonly bindings = new Map<string, SkillBindingRecord>();

  async save(binding: SkillBindingRecord): Promise<void> {
    this.bindings.set(binding.id, copySkillBinding(binding));
  }

  async getById(bindingId: string): Promise<SkillBindingRecord | undefined> {
    const binding = this.bindings.get(bindingId);
    return binding ? copySkillBinding(binding) : undefined;
  }

  async listForProject(projectId: string): Promise<SkillBindingRecord[]> {
    return [...this.bindings.values()]
      .filter((binding) => binding.projectId === projectId)
      .map(copySkillBinding);
  }

  async listAll(): Promise<SkillBindingRecord[]> {
    return [...this.bindings.values()].map(copySkillBinding);
  }
}
```

Add copy helpers near the existing copy helpers:

```ts
function copySkill(skill: SkillRecord): SkillRecord {
  return { ...skill };
}

function copySkillVersion(version: SkillVersionRecord): SkillVersionRecord {
  return {
    ...version,
    manifest: structuredClone(version.manifest)
  };
}

function copySkillBinding(binding: SkillBindingRecord): SkillBindingRecord {
  return {
    ...binding,
    settings: binding.settings ? structuredClone(binding.settings) : undefined
  };
}
```

- [ ] **Step 5: Run the focused DB repository test and verify it passes**

Run:

```bash
pnpm --filter @lp-agent/db test -- src/workbench-repositories.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add packages/db/src/workbench-repositories.ts packages/db/src/workbench-repositories.test.ts
git commit -m "add in-memory skill repositories"
```

## Task 2: Persist Skills in the JSON-File Repository

**Files:**
- Modify: `packages/db/src/json-file-workbench-repositories.ts`
- Test: `packages/db/src/json-file-workbench-repositories.test.ts`

- [ ] **Step 1: Write failing JSON-file persistence tests**

Add this test to `packages/db/src/json-file-workbench-repositories.test.ts`:

```ts
it("reopens skills, versions, and bindings from disk", async () => {
  const filePath = await tempStateFile();
  const first = createJsonFileWorkbenchRepositories({ filePath });

  await first.skills.save({
    id: "skill_brand",
    name: "Brand LP",
    type: "template",
    scope: "project",
    createdAt
  });
  await first.skillVersions.save({
    id: "skill_version_1",
    skillId: "skill_brand",
    version: "1.0.0",
    manifest: {
      id: "skill_brand",
      name: "Brand LP",
      version: "1.0.0",
      type: "template",
      scope: "project",
      description: "Brand LP sections.",
      permissions: ["brief:read", "artifact:write"],
      requiredSecrets: [],
      entrypoints: ["skills/brand.md"],
      reviewState: "published"
    },
    content: "# Brand LP",
    contentType: "text/markdown",
    reviewState: "published",
    createdAt
  });
  await first.skillBindings.save({
    id: "skill_binding_1",
    skillVersionId: "skill_version_1",
    scope: "project",
    targetKey: "project_1",
    projectId: "project_1",
    enabled: true,
    createdAt,
    updatedAt: createdAt
  });

  const second = createJsonFileWorkbenchRepositories({ filePath });

  await expect(second.skills.listAll()).resolves.toEqual([
    expect.objectContaining({ id: "skill_brand", name: "Brand LP" })
  ]);
  await expect(second.skillVersions.listForSkill("skill_brand")).resolves.toEqual([
    expect.objectContaining({ id: "skill_version_1", content: "# Brand LP" })
  ]);
  await expect(second.skillBindings.listForProject("project_1")).resolves.toEqual([
    expect.objectContaining({ id: "skill_binding_1", enabled: true })
  ]);
});
```

In the existing `"creates parent directories and writes readable JSON"` test, extend the `toMatchObject` assertion:

```ts
expect(JSON.parse(raw)).toMatchObject({
  projects: [
    {
      id: "project_1",
      name: "Spring sale"
    }
  ],
  tasks: [],
  messages: [],
  taskSnapshots: [],
  skills: [],
  skillVersions: [],
  skillBindings: []
});
```

- [ ] **Step 2: Run the focused JSON-file test and verify it fails**

Run:

```bash
pnpm --filter @lp-agent/db test -- src/json-file-workbench-repositories.test.ts
```

Expected: FAIL because JSON-file repositories do not expose skill repositories.

- [ ] **Step 3: Extend JSON state and imports**

In `packages/db/src/json-file-workbench-repositories.ts`, add these imported types:

```ts
  SkillBindingRecord,
  SkillBindingRepository,
  SkillRecord,
  SkillRepository,
  SkillVersionRecord,
  SkillVersionRepository,
```

Extend `JsonFileWorkbenchState`:

```ts
  skills: SkillRecord[];
  skillVersions: SkillVersionRecord[];
  skillBindings: SkillBindingRecord[];
```

Extend `readState` and `emptyState`:

```ts
      skills: parsed.skills ?? [],
      skillVersions: parsed.skillVersions ?? [],
      skillBindings: parsed.skillBindings ?? []
```

```ts
    skills: [],
    skillVersions: [],
    skillBindings: []
```

- [ ] **Step 4: Add JSON-file skill repository properties and classes**

In `JsonFileWorkbenchRepositories`, add properties and constructor assignments:

```ts
  readonly skills: SkillRepository;
  readonly skillVersions: SkillVersionRepository;
  readonly skillBindings: SkillBindingRepository;
```

```ts
    this.skills = new JsonFileSkillRepository(filePath);
    this.skillVersions = new JsonFileSkillVersionRepository(filePath);
    this.skillBindings = new JsonFileSkillBindingRepository(filePath);
```

Add these classes before `JsonFileProjectRepository`:

```ts
class JsonFileSkillRepository implements SkillRepository {
  constructor(private readonly filePath: string) {}

  async save(skill: SkillRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.skills = upsertBy(state.skills, copy(skill), (record) => record.id === skill.id);
    });
  }

  async getById(skillId: string): Promise<SkillRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.skills.find((skill) => skill.id === skillId));
  }

  async listAll(): Promise<SkillRecord[]> {
    const state = await readState(this.filePath);
    return state.skills.map(copy);
  }
}

class JsonFileSkillVersionRepository implements SkillVersionRepository {
  constructor(private readonly filePath: string) {}

  async save(version: SkillVersionRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.skillVersions = upsertBy(
        state.skillVersions,
        copy(version),
        (record) => record.id === version.id
      );
    });
  }

  async getById(versionId: string): Promise<SkillVersionRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.skillVersions.find((version) => version.id === versionId));
  }

  async getBySkillIdAndVersion(
    skillId: string,
    version: string
  ): Promise<SkillVersionRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(
      state.skillVersions.find(
        (record) => record.skillId === skillId && record.version === version
      )
    );
  }

  async listForSkill(skillId: string): Promise<SkillVersionRecord[]> {
    const state = await readState(this.filePath);
    return state.skillVersions.filter((version) => version.skillId === skillId).map(copy);
  }

  async listAll(): Promise<SkillVersionRecord[]> {
    const state = await readState(this.filePath);
    return state.skillVersions.map(copy);
  }
}

class JsonFileSkillBindingRepository implements SkillBindingRepository {
  constructor(private readonly filePath: string) {}

  async save(binding: SkillBindingRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.skillBindings = upsertBy(
        state.skillBindings,
        copy(binding),
        (record) => record.id === binding.id
      );
    });
  }

  async getById(bindingId: string): Promise<SkillBindingRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.skillBindings.find((binding) => binding.id === bindingId));
  }

  async listForProject(projectId: string): Promise<SkillBindingRecord[]> {
    const state = await readState(this.filePath);
    return state.skillBindings.filter((binding) => binding.projectId === projectId).map(copy);
  }

  async listAll(): Promise<SkillBindingRecord[]> {
    const state = await readState(this.filePath);
    return state.skillBindings.map(copy);
  }
}
```

- [ ] **Step 5: Run DB tests and verify they pass**

Run:

```bash
pnpm --filter @lp-agent/db test
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add packages/db/src/json-file-workbench-repositories.ts packages/db/src/json-file-workbench-repositories.test.ts
git commit -m "persist skills in local state"
```

## Task 3: Carry Skill Content Through Runtime and Model Context

**Files:**
- Modify: `packages/runtime-adapters/src/index.ts`
- Modify: `packages/runtime-adapters/src/index.test.ts`
- Modify: `packages/model-gateway/src/index.ts`
- Modify: `packages/model-gateway/src/index.test.ts`

- [ ] **Step 1: Write failing runtime context expectation**

In `packages/runtime-adapters/src/index.test.ts`, update the skill object in `"passes scoped skills, visible MCP tools, approval, and workspace context into model calls"` to include:

```ts
          content: "# Brand LP\nUse concise ecommerce sections.",
          contentType: "text/markdown"
```

Also add those two fields to the expected `gateway.requests[0]?.context` skill.

- [ ] **Step 2: Run runtime tests and verify they fail**

Run:

```bash
pnpm --filter @lp-agent/runtime-adapters test
```

Expected: FAIL because `RuntimeSkillContext` does not include `content` or `contentType`.

- [ ] **Step 3: Extend `RuntimeSkillContext`**

In `packages/runtime-adapters/src/index.ts`, change `RuntimeSkillContext` to:

```ts
export interface RuntimeSkillContext {
  id: string;
  name: string;
  version: string;
  scope: string;
  permissions: string[];
  entrypoints: string[];
  content: string;
  contentType: "text/markdown" | "text/plain";
}
```

Ensure existing context cloning still spreads `skill` and separately clones arrays:

```ts
skills: context.skills.map((skill) => ({
  ...skill,
  permissions: [...skill.permissions],
  entrypoints: [...skill.entrypoints]
}))
```

- [ ] **Step 4: Update model-gateway skill context types and tests**

In `packages/model-gateway/src/index.ts`, extend the model skill context interface with:

```ts
  content: string;
  contentType: "text/markdown" | "text/plain";
```

In `packages/model-gateway/src/index.test.ts`, add these fields to each test skill object:

```ts
            content: "# Brand LP",
            contentType: "text/markdown"
```

If a test has multiple skill objects, give each object a concrete `content` and `contentType` value.

- [ ] **Step 5: Run runtime and model-gateway tests**

Run:

```bash
pnpm --filter @lp-agent/runtime-adapters test
pnpm --filter @lp-agent/model-gateway test
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add packages/runtime-adapters/src/index.ts packages/runtime-adapters/src/index.test.ts packages/model-gateway/src/index.ts packages/model-gateway/src/index.test.ts
git commit -m "include skill content in runtime context"
```

## Task 4: Add API Skill Lifecycle and Project Runtime Resolution

**Files:**
- Modify: `packages/api/src/index.ts`
- Test: `packages/api/src/services.test.ts`

- [ ] **Step 1: Write failing API lifecycle tests**

Add imports in `packages/api/src/services.test.ts`:

```ts
import type { SkillManifest } from "@lp-agent/skills";
```

Add this helper near test helpers:

```ts
function brandSkillManifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    id: "skill_brand",
    name: "Brand LP",
    version: "1.0.0",
    type: "template",
    scope: "project",
    description: "Brand LP sections.",
    permissions: ["brief:read", "artifact:write", "assets:read"],
    requiredSecrets: [],
    entrypoints: ["skills/brand.md"],
    reviewState: "published",
    ...overrides
  };
}
```

Add these tests:

```ts
it("creates, validates, publishes, and binds a project skill", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const service = new DemoWorkbenchService({ repositories, now: fixedClock() });
  const project = await service.createProject({ name: "Project" });

  const draft = await service.createSkillDraft({
    manifestJson: JSON.stringify(brandSkillManifest()),
    content: "# Brand LP",
    contentType: "text/markdown"
  });
  const validated = await service.validateSkillVersion({ skillVersionId: draft.version.id });
  const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });
  const binding = await service.bindSkillVersionToProject({
    projectId: project.id,
    skillVersionId: published.id
  });
  const state = await service.listProjectSkillState(project.id);

  expect(draft.version.reviewState).toBe("draft");
  expect(draft.version.manifest.reviewState).toBe("draft");
  expect(validated.reviewState).toBe("validated");
  expect(validated.manifest.reviewState).toBe("validated");
  expect(published.reviewState).toBe("published");
  expect(published.manifest.reviewState).toBe("published");
  expect(binding).toMatchObject({
    skillVersionId: published.id,
    projectId: project.id,
    enabled: true
  });
  expect(state.boundSkills).toEqual([
    expect.objectContaining({
      skill: expect.objectContaining({ id: "skill_brand" }),
      version: expect.objectContaining({ reviewState: "published" }),
      binding: expect.objectContaining({ enabled: true })
    })
  ]);
});

it("rejects duplicate skill versions and non-project manifests", async () => {
  const service = new DemoWorkbenchService({ now: fixedClock() });
  await service.createSkillDraft({
    manifestJson: JSON.stringify(brandSkillManifest()),
    content: "# Brand LP",
    contentType: "text/markdown"
  });

  await expect(
    service.createSkillDraft({
      manifestJson: JSON.stringify(brandSkillManifest()),
      content: "# Brand LP again",
      contentType: "text/markdown"
    })
  ).rejects.toThrow("duplicate_skill_version");

  await expect(
    service.createSkillDraft({
      manifestJson: JSON.stringify(brandSkillManifest({ scope: "workspace" })),
      content: "# Workspace skill",
      contentType: "text/markdown"
    })
  ).rejects.toThrow("unsupported_skill_scope");

  await expect(
    service.createSkillDraft({
      manifestJson: JSON.stringify(brandSkillManifest({ version: "not-semver" })),
      content: "# Invalid skill",
      contentType: "text/markdown"
    })
  ).rejects.toThrow("manifest_validation_failed");
});

it("requires published skills before project binding", async () => {
  const service = new DemoWorkbenchService({ now: fixedClock() });
  const project = await service.createProject({ name: "Project" });
  const draft = await service.createSkillDraft({
    manifestJson: JSON.stringify(brandSkillManifest()),
    content: "# Brand LP",
    contentType: "text/markdown"
  });

  await expect(
    service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: draft.version.id
    })
  ).rejects.toThrow("skill_version_not_published");
});
```

- [ ] **Step 2: Replace the default runtime context test with repository-backed expectations**

In `packages/api/src/services.test.ts`, rename the current test `"passes default skill, MCP, approval, and artifact workspace context into runtime runs"` to `"passes project-bound published skills into runtime runs"`.

Before creating the brief, add:

```ts
    const draft = await service.createSkillDraft({
      manifestJson: JSON.stringify(brandSkillManifest()),
      content: "# Brand LP",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: draft.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });
```

Update expected runtime skill:

```ts
          id: "skill_brand",
          scope: "project",
          permissions: ["brief:read", "artifact:write", "assets:read"],
          content: "# Brand LP",
          contentType: "text/markdown"
```

Add a new test:

```ts
it("does not inject a hidden default skill when no project skills are bound", async () => {
  const builderRuntime = new RecordingRuntime({ state: "completed", artifacts: completeArtifacts() });
  const service = new DemoWorkbenchService({
    builderRuntime,
    now: fixedClock()
  });

  const project = await service.createProject({ name: "Project" });
  const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
  await service.generatePageVersion({ projectId: project.id, briefId: brief.id });

  expect(builderRuntime.requests[0]?.context?.skills).toEqual([]);
  expect(builderRuntime.requests[0]?.context?.mcpTools).toEqual([]);
});
```

- [ ] **Step 3: Run API tests and verify they fail**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: FAIL because the new service methods and runtime behavior do not exist.

- [ ] **Step 4: Add API input/result types**

In `packages/api/src/index.ts`, extend the DB import with:

```ts
  type SkillBindingRecord,
  type SkillContentType,
  type SkillRecord,
  type SkillVersionRecord,
```

Change the skills import to:

```ts
import {
  SkillManifestSchema,
  canPublishSkill,
  canUseSkill,
  type SkillManifest
} from "@lp-agent/skills";
```

Export DB record types:

```ts
  SkillBindingRecord,
  SkillContentType,
  SkillRecord,
  SkillVersionRecord,
```

Add interfaces near other input types:

```ts
export interface CreateSkillDraftInput {
  manifestJson: string;
  content: string;
  contentType: SkillContentType;
}

export interface SkillDraftResult {
  skill: SkillRecord;
  version: SkillVersionRecord;
}

export interface SkillVersionInput {
  skillVersionId: string;
}

export interface BindSkillVersionToProjectInput {
  projectId: string;
  skillVersionId: string;
}

export interface SetProjectSkillBindingEnabledInput {
  bindingId: string;
  enabled: boolean;
}

export interface ProjectBoundSkillState {
  skill: SkillRecord;
  version: SkillVersionRecord;
  binding: SkillBindingRecord;
}

export interface ProjectSkillState {
  boundSkills: ProjectBoundSkillState[];
  availableVersions: SkillVersionRecord[];
}
```

- [ ] **Step 5: Add lifecycle methods to `DemoWorkbenchService`**

Inside `DemoWorkbenchService`, add:

```ts
  async createSkillDraft(input: CreateSkillDraftInput): Promise<SkillDraftResult> {
    return withRepositoryIdLock(this.repositories, async () => {
      const manifest = parseProjectSkillManifest(input.manifestJson);
      const content = normalizeSkillContent(input.content);
      if (await this.repositories.skillVersions.getBySkillIdAndVersion(manifest.id, manifest.version)) {
        throw new Error("duplicate_skill_version");
      }

      const now = this.timestamp();
      const draftManifest: SkillManifest = {
        ...manifest,
        permissions: [...manifest.permissions],
        requiredSecrets: [...manifest.requiredSecrets],
        entrypoints: [...manifest.entrypoints],
        reviewState: "draft"
      };
      const skill: SkillRecord = {
        id: draftManifest.id,
        name: draftManifest.name,
        type: draftManifest.type,
        scope: draftManifest.scope,
        createdAt: now
      };
      const version: SkillVersionRecord = {
        id: nextSequentialId(
          "skill_version",
          (await this.repositories.skillVersions.listAll()).map((record) => record.id)
        ),
        skillId: draftManifest.id,
        version: draftManifest.version,
        manifest: draftManifest,
        content,
        contentType: input.contentType,
        reviewState: "draft",
        createdAt: now
      };

      await this.repositories.skills.save(skill);
      await this.repositories.skillVersions.save(version);
      return {
        skill: copySkillRecord(skill),
        version: copySkillVersionRecord(version)
      };
    });
  }

  async validateSkillVersion(input: SkillVersionInput): Promise<SkillVersionRecord> {
    const version = await this.getSkillVersionOrThrow(input.skillVersionId);
    const validated = updateSkillVersionReviewState(version, "validated");
    await this.repositories.skillVersions.save(validated);
    return copySkillVersionRecord(validated);
  }

  async publishSkillVersion(input: SkillVersionInput): Promise<SkillVersionRecord> {
    const version = await this.getSkillVersionOrThrow(input.skillVersionId);
    const decision = canPublishSkill("owner", version.manifest);
    if (!decision.allowed) {
      throw new Error("publish_not_allowed");
    }
    if (version.reviewState !== "validated" && version.reviewState !== "published") {
      throw new Error("skill_version_not_validated");
    }
    const published = updateSkillVersionReviewState(version, "published");
    await this.repositories.skillVersions.save(published);
    return copySkillVersionRecord(published);
  }

  async bindSkillVersionToProject(
    input: BindSkillVersionToProjectInput
  ): Promise<SkillBindingRecord> {
    return withRepositoryIdLock(this.repositories, async () => {
      await this.getProjectOrThrow(input.projectId);
      const version = await this.getSkillVersionOrThrow(input.skillVersionId);
      if (version.reviewState !== "published" || version.manifest.reviewState !== "published") {
        throw new Error("skill_version_not_published");
      }
      const existing = (await this.repositories.skillBindings.listForProject(input.projectId)).find(
        (binding) => binding.skillVersionId === version.id
      );
      if (existing) {
        return copySkillBindingRecord(existing);
      }
      const now = this.timestamp();
      const binding: SkillBindingRecord = {
        id: nextSequentialId(
          "skill_binding",
          (await this.repositories.skillBindings.listAll()).map((record) => record.id)
        ),
        skillVersionId: version.id,
        scope: "project",
        targetKey: input.projectId,
        projectId: input.projectId,
        enabled: true,
        createdAt: now,
        updatedAt: now
      };
      await this.repositories.skillBindings.save(binding);
      return copySkillBindingRecord(binding);
    });
  }

  async setProjectSkillBindingEnabled(
    input: SetProjectSkillBindingEnabledInput
  ): Promise<SkillBindingRecord> {
    const binding = await this.repositories.skillBindings.getById(input.bindingId);
    if (!binding) {
      throw new Error("skill_binding_not_found");
    }
    const updated = {
      ...binding,
      enabled: input.enabled,
      updatedAt: this.timestamp()
    };
    await this.repositories.skillBindings.save(updated);
    return copySkillBindingRecord(updated);
  }

  async listProjectSkillState(projectId: string): Promise<ProjectSkillState> {
    await this.getProjectOrThrow(projectId);
    const bindings = await this.repositories.skillBindings.listForProject(projectId);
    const boundSkills = await Promise.all(
      bindings.map(async (binding) => {
        const version = await this.repositories.skillVersions.getById(binding.skillVersionId);
        const skill = version ? await this.repositories.skills.getById(version.skillId) : undefined;
        return skill && version
          ? {
              skill,
              version,
              binding
            }
          : undefined;
      })
    );
    return {
      boundSkills: boundSkills.filter(isDefined).map(copyProjectBoundSkillState),
      availableVersions: (await this.repositories.skillVersions.listAll()).map(copySkillVersionRecord)
    };
  }

  async listRuntimeSkillsForProject(projectId: string): Promise<SkillVersionRecord[]> {
    await this.getProjectOrThrow(projectId);
    const bindings = await this.repositories.skillBindings.listForProject(projectId);
    const boundSkillIds = new Set<string>();
    const runtimeSkills: SkillVersionRecord[] = [];
    for (const binding of bindings) {
      if (!binding.enabled) {
        continue;
      }
      const version = await this.repositories.skillVersions.getById(binding.skillVersionId);
      if (!version || version.reviewState !== "published" || version.manifest.reviewState !== "published") {
        continue;
      }
      const grantedPermissions = [...version.manifest.permissions];
      if (
        canUseSkill({
          manifest: version.manifest,
          boundSkillIds: [version.manifest.id],
          grantedPermissions
        }) &&
        !boundSkillIds.has(version.manifest.id)
      ) {
        boundSkillIds.add(version.manifest.id);
        runtimeSkills.push(copySkillVersionRecord(version));
      }
    }
    return runtimeSkills;
  }
```

Add private helper:

```ts
  private async getSkillVersionOrThrow(skillVersionId: string): Promise<SkillVersionRecord> {
    const version = await this.repositories.skillVersions.getById(skillVersionId);
    if (!version) {
      throw new Error("skill_version_not_found");
    }
    return version;
  }

```

- [ ] **Step 6: Replace hardcoded runtime context resolution**

Change `generatePageVersion` runtime call to:

```ts
        context: await this.createRuntimeContext(input.projectId, "builder")
```

Change `reviewPageVersion` runtime call to:

```ts
      context: await this.createRuntimeContext(input.projectId, "reviewer")
```

Add private method:

```ts
  private async createRuntimeContext(
    projectId: string,
    role: "planner" | "builder" | "reviewer" | "deployer",
    approvalState: ApprovalState = "not_required"
  ): Promise<RuntimeRunContext> {
    const runtimeSkillVersions = await this.listRuntimeSkillsForProject(projectId);
    return createWorkbenchRuntimeContext({
      role,
      approvalState,
      skillVersions: runtimeSkillVersions
    });
  }
```

Replace the existing free function `createWorkbenchRuntimeContext` with:

```ts
function createWorkbenchRuntimeContext(input: {
  role: "planner" | "builder" | "reviewer" | "deployer";
  approvalState?: ApprovalState;
  skillVersions: SkillVersionRecord[];
}): RuntimeRunContext {
  const approvalState = input.approvalState ?? "not_required";
  const grantedPermissions = [
    ...new Set(input.skillVersions.flatMap((version) => version.manifest.permissions))
  ];
  const skills = input.skillVersions.map(toRuntimeSkill);
  const mcpTools = computeVisibleTools({
    connectors: [sampleConnector],
    projectConnectorIds: grantedPermissions.length > 0 ? [sampleConnector.id] : [],
    skillPermissions: grantedPermissions,
    agentRole: input.role,
    approvalState
  }).map((tool) => ({
    connectorId: sampleConnector.id,
    name: tool.name,
    permission: tool.permission,
    requiresApproval: tool.requiresApproval
  }));

  return {
    skills,
    mcpTools,
    approval: {
      state: approvalState
    },
    artifactWorkspace: {
      mode: "memory",
      writableFiles: ["index.html", "styles.css", "script.js"]
    }
  };
}
```

Delete `createDefaultWorkbenchSkill`.

Change `toRuntimeSkill`:

```ts
function toRuntimeSkill(version: SkillVersionRecord): RuntimeRunContext["skills"][number] {
  const skill = version.manifest;
  return {
    id: skill.id,
    name: skill.name,
    version: skill.version,
    scope: skill.scope,
    permissions: [...skill.permissions],
    entrypoints: [...skill.entrypoints],
    content: version.content,
    contentType: version.contentType
  };
}
```

- [ ] **Step 7: Add API helper functions**

Add helpers near existing copy helpers:

```ts
function parseProjectSkillManifest(manifestJson: string): SkillManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestJson);
  } catch {
    throw new Error("invalid_manifest_json");
  }
  let manifest: SkillManifest;
  try {
    manifest = SkillManifestSchema.parse(parsed);
  } catch {
    throw new Error("manifest_validation_failed");
  }
  if (manifest.scope !== "project") {
    throw new Error("unsupported_skill_scope");
  }
  return {
    ...manifest,
    permissions: [...manifest.permissions],
    requiredSecrets: [...manifest.requiredSecrets],
    entrypoints: [...manifest.entrypoints]
  };
}

function normalizeSkillContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new Error("skill_content_required");
  }
  if (Buffer.byteLength(trimmed, "utf8") > 200_000) {
    throw new Error("skill_content_too_large");
  }
  return trimmed;
}

function updateSkillVersionReviewState(
  version: SkillVersionRecord,
  reviewState: SkillManifest["reviewState"]
): SkillVersionRecord {
  return {
    ...version,
    reviewState,
    manifest: {
      ...version.manifest,
      permissions: [...version.manifest.permissions],
      requiredSecrets: [...version.manifest.requiredSecrets],
      entrypoints: [...version.manifest.entrypoints],
      reviewState
    }
  };
}

function copySkillRecord(skill: SkillRecord): SkillRecord {
  return { ...skill };
}

function copySkillVersionRecord(version: SkillVersionRecord): SkillVersionRecord {
  return {
    ...version,
    manifest: {
      ...version.manifest,
      permissions: [...version.manifest.permissions],
      requiredSecrets: [...version.manifest.requiredSecrets],
      entrypoints: [...version.manifest.entrypoints]
    }
  };
}

function copySkillBindingRecord(binding: SkillBindingRecord): SkillBindingRecord {
  return {
    ...binding,
    settings: binding.settings ? structuredClone(binding.settings) : undefined
  };
}

function copyProjectBoundSkillState(state: ProjectBoundSkillState): ProjectBoundSkillState {
  return {
    skill: copySkillRecord(state.skill),
    version: copySkillVersionRecord(state.version),
    binding: copySkillBindingRecord(state.binding)
  };
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
```

- [ ] **Step 8: Run API tests**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

Run:

```bash
git add packages/api/src/index.ts packages/api/src/services.test.ts
git commit -m "add project skill lifecycle service"
```

## Task 5: Add Web Store Skill State and Server Actions

**Files:**
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`
- Modify: `apps/web/src/app/actions.ts`
- Modify: `apps/web/src/app/actions.test.ts`

- [ ] **Step 1: Write failing Web store tests**

In `apps/web/src/lib/workbench-store.test.ts`, add a helper:

```ts
function brandSkillManifestJson(): string {
  return JSON.stringify({
    id: "skill_brand",
    name: "Brand LP",
    version: "1.0.0",
    type: "template",
    scope: "project",
    description: "Brand LP sections.",
    permissions: ["brief:read", "artifact:write", "assets:read"],
    requiredSecrets: [],
    entrypoints: ["skills/brand.md"],
    reviewState: "published"
  });
}
```

Add tests:

```ts
it("creates, validates, publishes, and binds skills through the web store", async () => {
  const store = createWebWorkbenchStore();
  const project = await store.createProject({ name: "Project" });

  const draft = await store.createSkillDraft({
    manifestJson: brandSkillManifestJson(),
    content: "# Brand LP",
    contentType: "text/markdown"
  });
  if (!draft.ok) {
    throw new Error(`Expected draft creation to succeed, got ${draft.error}.`);
  }
  const validated = await store.validateSkillVersion(draft.value.version.id);
  if (!validated.ok) {
    throw new Error(`Expected validation to succeed, got ${validated.error}.`);
  }
  const published = await store.publishSkillVersion(draft.value.version.id);
  if (!published.ok) {
    throw new Error(`Expected publishing to succeed, got ${published.error}.`);
  }
  const binding = await store.bindSkillVersionToProject({
    projectId: project.id,
    skillVersionId: published.value.id
  });
  if (!binding.ok) {
    throw new Error(`Expected binding to succeed, got ${binding.error}.`);
  }
  const state = await store.getPageState({ projectId: project.id });

  expect(validated.value.reviewState).toBe("validated");
  expect(binding.value.enabled).toBe(true);
  expect(state.skills.boundSkills).toEqual([
    expect.objectContaining({
      skill: expect.objectContaining({ id: "skill_brand" }),
      version: expect.objectContaining({ reviewState: "published" })
    })
  ]);
});

it("maps skill store validation errors to stable codes", async () => {
  const store = createWebWorkbenchStore();

  const result = await store.createSkillDraft({
    manifestJson: "{",
    content: "# Brand LP",
    contentType: "text/markdown"
  });

  expect(result).toEqual({
    ok: false,
    error: "invalid_manifest_json"
  });
});
```

- [ ] **Step 2: Run the Web store test and verify it fails**

Run:

```bash
pnpm test -- apps/web/src/lib/workbench-store.test.ts
```

Expected: FAIL because skill store methods and page-state skill data do not exist.

- [ ] **Step 3: Extend Web store types**

In `apps/web/src/lib/workbench-store.ts`, extend API imports:

```ts
  type ProjectSkillState,
  type SkillBindingRecord,
  type SkillContentType,
  type SkillDraftResult,
  type SkillVersionRecord,
```

Add error code type:

```ts
export type SkillFlowErrorCode =
  | "invalid_manifest_json"
  | "manifest_validation_failed"
  | "unsupported_skill_scope"
  | "duplicate_skill_version"
  | "unsupported_content_type"
  | "skill_content_required"
  | "skill_content_too_large"
  | "project_not_found"
  | "skill_version_not_found"
  | "skill_version_not_validated"
  | "skill_version_not_published"
  | "skill_binding_not_found"
  | "publish_not_allowed"
  | "skill_operation_failed";
```

Add result types:

```ts
export type SkillActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SkillFlowErrorCode };

export interface CreateSkillDraftFormInput {
  manifestJson: string;
  content: string;
  contentType: SkillContentType;
}

export interface BindSkillVersionFormInput {
  projectId: string;
  skillVersionId: string;
}
```

Add `skills: ProjectSkillState` to both `WorkbenchPageState` variants.

Extend `WebWorkbenchStore`:

```ts
  createSkillDraft(input: CreateSkillDraftFormInput): Promise<SkillActionResult<SkillDraftResult>>;
  validateSkillVersion(skillVersionId: string): Promise<SkillActionResult<SkillVersionRecord>>;
  publishSkillVersion(skillVersionId: string): Promise<SkillActionResult<SkillVersionRecord>>;
  bindSkillVersionToProject(
    input: BindSkillVersionFormInput
  ): Promise<SkillActionResult<SkillBindingRecord>>;
  setProjectSkillBindingEnabled(input: {
    bindingId: string;
    enabled: boolean;
  }): Promise<SkillActionResult<SkillBindingRecord>>;
```

- [ ] **Step 4: Implement Web store skill facade**

Inside `createWebWorkbenchStore`, add:

```ts
  const emptySkillState = (): ProjectSkillState => ({
    boundSkills: [],
    availableVersions: []
  });

  const loadSkillState = async (projectId?: string | null) =>
    projectId ? await service.listProjectSkillState(projectId) : emptySkillState();
```

In both `getPageState` return objects, include:

```ts
skills: await loadSkillState(activeProjectId)
```

Use `taskProject?.id ?? requestedProjectId` as `activeProjectId` in the task-ready path, and `requestedProjectId` in the empty path only when the project exists.

Add methods:

```ts
    async createSkillDraft(input) {
      try {
        const value = await service.createSkillDraft(input);
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toSkillFlowError(error) };
      }
    },

    async validateSkillVersion(skillVersionId) {
      try {
        const value = await service.validateSkillVersion({ skillVersionId });
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toSkillFlowError(error) };
      }
    },

    async publishSkillVersion(skillVersionId) {
      try {
        const value = await service.publishSkillVersion({ skillVersionId });
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toSkillFlowError(error) };
      }
    },

    async bindSkillVersionToProject(input) {
      try {
        const value = await service.bindSkillVersionToProject(input);
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toSkillFlowError(error) };
      }
    },

    async setProjectSkillBindingEnabled(input) {
      try {
        const value = await service.setProjectSkillBindingEnabled(input);
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toSkillFlowError(error) };
      }
    }
```

Add mapper:

```ts
function toSkillFlowError(error: unknown): SkillFlowErrorCode {
  const message = error instanceof Error ? error.message : "";
  if (
    message === "invalid_manifest_json" ||
    message === "manifest_validation_failed" ||
    message === "unsupported_skill_scope" ||
    message === "duplicate_skill_version" ||
    message === "unsupported_content_type" ||
    message === "skill_content_required" ||
    message === "skill_content_too_large" ||
    message === "project_not_found" ||
    message === "skill_version_not_found" ||
    message === "skill_version_not_validated" ||
    message === "skill_version_not_published" ||
    message === "skill_binding_not_found" ||
    message === "publish_not_allowed"
  ) {
    return message;
  }
  if (message.includes("ZodError") || message.includes("Invalid")) {
    return "manifest_validation_failed";
  }
  return "skill_operation_failed";
}
```

- [ ] **Step 5: Add server actions tests**

In `apps/web/src/app/actions.test.ts`, extend mocks:

```ts
  createSkillDraft: vi.fn(),
  validateSkillVersion: vi.fn(),
  publishSkillVersion: vi.fn(),
  bindSkillVersionToProject: vi.fn(),
  setProjectSkillBindingEnabled: vi.fn()
```

Expose them from the mocked store.

Add helper:

```ts
function buildSkillForm(input: Record<string, string> = {}): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(input)) {
    formData.set(key, value);
  }
  return formData;
}
```

Import new actions:

```ts
  bindSkillVersionAction,
  createSkillDraftAction,
  publishSkillVersionAction,
  setSkillBindingEnabledAction,
  validateSkillVersionAction
```

Add tests:

```ts
it("creates a skill draft and redirects to the skills view", async () => {
  mocks.createSkillDraft.mockResolvedValue({
    ok: true,
    value: {
      version: { id: "skill_version_1" }
    }
  });

  await expectRedirect(
    createSkillDraftAction(
      buildSkillForm({
        manifestJson: brandSkillManifestJson(),
        content: "# Brand LP",
        contentType: "text/markdown"
      })
    ),
    "/?view=skills"
  );

  expect(mocks.createSkillDraft).toHaveBeenCalledWith({
    manifestJson: brandSkillManifestJson(),
    content: "# Brand LP",
    contentType: "text/markdown"
  });
});

it("redirects skill errors with a stable query code", async () => {
  mocks.createSkillDraft.mockResolvedValue({
    ok: false,
    error: "invalid_manifest_json"
  });

  await expectRedirect(
    createSkillDraftAction(buildSkillForm({ manifestJson: "{", content: "# Brand LP" })),
    "/?view=skills&skillError=invalid_manifest_json"
  );
});
```

- [ ] **Step 6: Implement server actions**

In `apps/web/src/app/actions.ts`, extend imports with `SkillFlowErrorCode`.

Add helper:

```ts
function redirectToSkillsWithError(error: SkillFlowErrorCode): never {
  redirect(`/?view=skills&skillError=${encodeURIComponent(error)}`);
}
```

Add actions:

```ts
export async function createSkillDraftAction(formData: FormData): Promise<void> {
  const result = await getWebWorkbenchStore().createSkillDraft({
    manifestJson: String(formData.get("manifestJson") ?? ""),
    content: String(formData.get("content") ?? ""),
    contentType:
      String(formData.get("contentType") ?? "text/markdown") === "text/plain"
        ? "text/plain"
        : "text/markdown"
  });
  if (!result.ok) {
    redirectToSkillsWithError(result.error);
  }
  revalidatePath("/");
  redirect("/?view=skills");
}

export async function validateSkillVersionAction(formData: FormData): Promise<void> {
  const result = await getWebWorkbenchStore().validateSkillVersion(
    String(formData.get("skillVersionId") ?? "")
  );
  if (!result.ok) {
    redirectToSkillsWithError(result.error);
  }
  revalidatePath("/");
  redirect("/?view=skills");
}

export async function publishSkillVersionAction(formData: FormData): Promise<void> {
  const result = await getWebWorkbenchStore().publishSkillVersion(
    String(formData.get("skillVersionId") ?? "")
  );
  if (!result.ok) {
    redirectToSkillsWithError(result.error);
  }
  revalidatePath("/");
  redirect("/?view=skills");
}

export async function bindSkillVersionAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const result = await getWebWorkbenchStore().bindSkillVersionToProject({
    projectId,
    skillVersionId: String(formData.get("skillVersionId") ?? "")
  });
  if (!result.ok) {
    redirectToSkillsWithError(result.error);
  }
  await setCurrentProjectId(projectId);
  revalidatePath("/");
  redirect("/?view=skills");
}

export async function setSkillBindingEnabledAction(formData: FormData): Promise<void> {
  const result = await getWebWorkbenchStore().setProjectSkillBindingEnabled({
    bindingId: String(formData.get("bindingId") ?? ""),
    enabled: String(formData.get("enabled") ?? "false") === "true"
  });
  if (!result.ok) {
    redirectToSkillsWithError(result.error);
  }
  revalidatePath("/");
  redirect("/?view=skills");
}
```

- [ ] **Step 7: Run Web store and action tests**

Run:

```bash
pnpm test -- apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git add apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.ts apps/web/src/app/actions.test.ts
git commit -m "wire skill lifecycle into web store"
```

## Task 6: Add the Skills View UI and i18n Copy

**Files:**
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Write failing page tests**

In `apps/web/src/app/page.test.ts`, extend `pageMocks.pageState` fixtures to include:

```ts
skills: {
  boundSkills: [],
  availableVersions: []
}
```

Update every test fixture of `pageState` to include that shape.

Add tests:

```ts
it("renders the skills management view from the query parameter", async () => {
  const page = await HomePage({
    searchParams: Promise.resolve({ view: "skills" })
  });
  const text = collectText(page);
  const textJoined = text.join(" ");
  const textareas = collectElements(page, "textarea");

  expect(textJoined).toContain("Project skills");
  expect(textJoined).toContain("Manifest JSON");
  expect(textJoined).toContain("Skill content");
  expect(textareas.some((textarea) => textarea.props?.name === "manifestJson")).toBe(true);
  expect(textareas.some((textarea) => textarea.props?.name === "content")).toBe(true);
});

it("shows active bound project skills in the skills view", async () => {
  pageMocks.currentProjectId = "project_1";
  pageMocks.pageState = {
    kind: "empty",
    projects: [
      {
        id: "project_1",
        name: "Project",
        createdAt: "2026-05-13T00:00:00.000Z"
      }
    ],
    tasks: [],
    skills: {
      availableVersions: [],
      boundSkills: [
        {
          skill: {
            id: "skill_brand",
            name: "Brand LP",
            type: "template",
            scope: "project",
            createdAt: "2026-05-13T00:00:00.000Z"
          },
          version: {
            id: "skill_version_1",
            skillId: "skill_brand",
            version: "1.0.0",
            manifest: {
              id: "skill_brand",
              name: "Brand LP",
              version: "1.0.0",
              type: "template",
              scope: "project",
              description: "Brand LP sections.",
              permissions: ["brief:read"],
              requiredSecrets: [],
              entrypoints: ["skills/brand.md"],
              reviewState: "published"
            },
            content: "# Brand LP",
            contentType: "text/markdown",
            reviewState: "published",
            createdAt: "2026-05-13T00:00:00.000Z"
          },
          binding: {
            id: "skill_binding_1",
            skillVersionId: "skill_version_1",
            scope: "project",
            targetKey: "project_1",
            projectId: "project_1",
            enabled: true,
            createdAt: "2026-05-13T00:00:00.000Z",
            updatedAt: "2026-05-13T00:00:00.000Z"
          }
        }
      ]
    }
  };

  const page = await HomePage({
    searchParams: Promise.resolve({ view: "skills" })
  });
  const textJoined = collectText(page).join(" ");

  expect(textJoined).toContain("Brand LP");
  expect(textJoined).toContain("published");
  expect(textJoined).toContain("1 active skill");
});

it("shows the active bound skill count in the workbench shell", async () => {
  pageMocks.currentProjectId = "project_1";
  pageMocks.pageState = {
    kind: "empty",
    projects: [
      {
        id: "project_1",
        name: "Project",
        createdAt: "2026-05-13T00:00:00.000Z"
      }
    ],
    tasks: [],
    skills: {
      availableVersions: [],
      boundSkills: [
        {
          skill: {
            id: "skill_brand",
            name: "Brand LP",
            type: "template",
            scope: "project",
            createdAt: "2026-05-13T00:00:00.000Z"
          },
          version: {
            id: "skill_version_1",
            skillId: "skill_brand",
            version: "1.0.0",
            manifest: {
              id: "skill_brand",
              name: "Brand LP",
              version: "1.0.0",
              type: "template",
              scope: "project",
              description: "Brand LP sections.",
              permissions: ["brief:read"],
              requiredSecrets: [],
              entrypoints: ["skills/brand.md"],
              reviewState: "published"
            },
            content: "# Brand LP",
            contentType: "text/markdown",
            reviewState: "published",
            createdAt: "2026-05-13T00:00:00.000Z"
          },
          binding: {
            id: "skill_binding_1",
            skillVersionId: "skill_version_1",
            scope: "project",
            targetKey: "project_1",
            projectId: "project_1",
            enabled: true,
            createdAt: "2026-05-13T00:00:00.000Z",
            updatedAt: "2026-05-13T00:00:00.000Z"
          }
        }
      ]
    }
  };

  const page = await HomePage({
    searchParams: Promise.resolve({})
  });

  expect(collectText(page).join(" ")).toContain("1 active skill");
});
```

- [ ] **Step 2: Run page tests and verify they fail**

Run:

```bash
pnpm test -- apps/web/src/app/page.test.ts
```

Expected: FAIL because the Skills view and copy do not exist.

- [ ] **Step 3: Extend i18n copy**

In `apps/web/src/lib/i18n.ts`, import `SkillFlowErrorCode`:

```ts
import type { ProjectFlowErrorCode, SkillFlowErrorCode } from "./workbench-store";
```

Extend `WorkbenchCopy`:

```ts
  skillsView: {
    title: string;
    subtitle: string;
    activeProjectLabel: string;
    noProject: string;
    activeCount: (count: number) => string;
    createTitle: string;
    manifestLabel: string;
    manifestPlaceholder: string;
    contentLabel: string;
    contentPlaceholder: string;
    contentTypeLabel: string;
    markdown: string;
    plainText: string;
    createDraft: string;
    versionsTitle: string;
    boundTitle: string;
    validate: string;
    publish: string;
    bind: string;
    enable: string;
    disable: string;
    emptyVersions: string;
    emptyBound: string;
    statusLabels: Record<string, string>;
    errors: Record<SkillFlowErrorCode, string>;
  };
```

Add English copy:

```ts
    skillsView: {
      title: "Project skills",
      subtitle: "Create, validate, publish, and bind data-only skills for the active project.",
      activeProjectLabel: "Active project",
      noProject: "Create or select a project before binding skills.",
      activeCount: (count) => `${count} active ${count === 1 ? "skill" : "skills"}`,
      createTitle: "Create skill draft",
      manifestLabel: "Manifest JSON",
      manifestPlaceholder: "{\n  \"id\": \"skill_brand\",\n  \"name\": \"Brand LP\",\n  \"version\": \"1.0.0\",\n  \"type\": \"template\",\n  \"scope\": \"project\",\n  \"description\": \"Brand LP sections.\",\n  \"permissions\": [\"brief:read\", \"artifact:write\"],\n  \"requiredSecrets\": [],\n  \"entrypoints\": [\"skills/brand.md\"],\n  \"reviewState\": \"draft\"\n}",
      contentLabel: "Skill content",
      contentPlaceholder: "# Brand LP\nUse concise ecommerce landing page sections.",
      contentTypeLabel: "Content type",
      markdown: "Markdown",
      plainText: "Plain text",
      createDraft: "Create draft",
      versionsTitle: "Skill versions",
      boundTitle: "Bound to project",
      validate: "Validate",
      publish: "Publish",
      bind: "Bind",
      enable: "Enable",
      disable: "Disable",
      emptyVersions: "No skill versions yet.",
      emptyBound: "No skills bound to this project yet.",
      statusLabels: {
        draft: "draft",
        validated: "validated",
        published: "published",
        deprecated: "deprecated",
        archived: "archived"
      },
      errors: {
        invalid_manifest_json: "Manifest JSON is invalid.",
        manifest_validation_failed: "Manifest does not match the skill schema.",
        unsupported_skill_scope: "Only project-scoped skills are supported in this Web MVP.",
        duplicate_skill_version: "This skill id and version already exists.",
        unsupported_content_type: "Only Markdown and plain text skill content are supported.",
        skill_content_required: "Enter skill content.",
        skill_content_too_large: "Skill content is too large for the local MVP.",
        project_not_found: "The selected project is no longer available.",
        skill_version_not_found: "The selected skill version is no longer available.",
        skill_version_not_validated: "Validate the skill version before publishing.",
        skill_version_not_published: "Publish the skill version before binding it.",
        skill_binding_not_found: "The selected skill binding is no longer available.",
        publish_not_allowed: "This role cannot publish the skill.",
        skill_operation_failed: "The skill operation failed."
      }
    },
```

Add Chinese copy with the same keys:

```ts
    skillsView: {
      title: "项目技能",
      subtitle: "为当前项目创建、校验、发布并绑定数据型技能。",
      activeProjectLabel: "当前项目",
      noProject: "请先创建或选择项目，再绑定技能。",
      activeCount: (count) => `${count} 个启用技能`,
      createTitle: "创建技能草稿",
      manifestLabel: "Manifest JSON",
      manifestPlaceholder: "{\n  \"id\": \"skill_brand\",\n  \"name\": \"品牌 LP\",\n  \"version\": \"1.0.0\",\n  \"type\": \"template\",\n  \"scope\": \"project\",\n  \"description\": \"品牌 LP 区块规范。\",\n  \"permissions\": [\"brief:read\", \"artifact:write\"],\n  \"requiredSecrets\": [],\n  \"entrypoints\": [\"skills/brand.md\"],\n  \"reviewState\": \"draft\"\n}",
      contentLabel: "技能内容",
      contentPlaceholder: "# 品牌 LP\n使用简洁的电商落地页区块。",
      contentTypeLabel: "内容类型",
      markdown: "Markdown",
      plainText: "纯文本",
      createDraft: "创建草稿",
      versionsTitle: "技能版本",
      boundTitle: "已绑定到项目",
      validate: "校验",
      publish: "发布",
      bind: "绑定",
      enable: "启用",
      disable: "停用",
      emptyVersions: "还没有技能版本。",
      emptyBound: "当前项目还没有绑定技能。",
      statusLabels: {
        draft: "草稿",
        validated: "已校验",
        published: "已发布",
        deprecated: "已废弃",
        archived: "已归档"
      },
      errors: {
        invalid_manifest_json: "Manifest JSON 无效。",
        manifest_validation_failed: "Manifest 不符合技能 schema。",
        unsupported_skill_scope: "当前 Web MVP 仅支持项目级技能。",
        duplicate_skill_version: "这个 skill id 和版本已经存在。",
        unsupported_content_type: "技能内容仅支持 Markdown 和纯文本。",
        skill_content_required: "请输入技能内容。",
        skill_content_too_large: "技能内容超过本地 MVP 限制。",
        project_not_found: "当前项目已经不可用。",
        skill_version_not_found: "当前技能版本已经不可用。",
        skill_version_not_validated: "请先校验技能版本，再发布。",
        skill_version_not_published: "请先发布技能版本，再绑定。",
        skill_binding_not_found: "当前技能绑定已经不可用。",
        publish_not_allowed: "当前角色不能发布该技能。",
        skill_operation_failed: "技能操作失败。"
      }
    },
```

- [ ] **Step 4: Add Skills view rendering**

In `apps/web/src/app/page.tsx`, import the new actions:

```ts
  bindSkillVersionAction,
  createProjectAction,
  createSkillDraftAction,
  publishSkillVersionAction,
  setSkillBindingEnabledAction,
  submitPromptAction,
  validateSkillVersionAction
```

Extend the workbench-store type import:

```ts
import {
  getWebWorkbenchStore,
  type ProjectFlowErrorCode,
  type SkillFlowErrorCode
} from "../lib/workbench-store";
```

Extend props:

```ts
  searchParams?: Promise<{ error?: string; skillError?: string; view?: string }>;
```

Derive:

```ts
  const activeView = params?.view === "skills" ? "skills" : "workbench";
  const skillError = toSkillFlowError(params?.skillError);
  const skillErrorMessage = skillError ? copy.skillsView.errors[skillError] : undefined;
  const activeSkillCount = pageState.skills.boundSkills.filter(
    (item) => item.binding.enabled
  ).length;
  const activeSkillLabel = copy.skillsView.activeCount(activeSkillCount);
```

Change nav items to anchors:

```tsx
          <a className={activeView === "workbench" ? "navItem navItemActive" : "navItem"} href="/">
            {copy.nav.workbench}
          </a>
          <a
            className={activeView === "skills" ? "navItem navItemActive" : "navItem"}
            href="/?view=skills"
          >
            {copy.nav.skills}
          </a>
```

Add the active skill signal to the top bar after the current project/task title:

```tsx
            {activeSkillCount > 0 ? (
              <span className="skillRuntimeChip">{activeSkillLabel}</span>
            ) : null}
```

Inside `.conversationStack`, render Skills view first:

```tsx
            {activeView === "skills" ? (
              <section className="skillsView" aria-labelledby="skills-title">
                <div className="skillsHeader">
                  <div>
                    <h1 id="skills-title">{copy.skillsView.title}</h1>
                    <p>{copy.skillsView.subtitle}</p>
                  </div>
                  <span>{copy.skillsView.activeCount(activeSkillCount)}</span>
                </div>
                {skillErrorMessage ? <div className="formError" role="alert">{skillErrorMessage}</div> : null}
                <div className="skillsProjectContext">
                  <span>{copy.skillsView.activeProjectLabel}</span>
                  <strong>{activeProject?.name ?? copy.skillsView.noProject}</strong>
                </div>

                <form action={createSkillDraftAction} className="skillEditor">
                  <h2>{copy.skillsView.createTitle}</h2>
                  <label>
                    <span>{copy.skillsView.manifestLabel}</span>
                    <textarea name="manifestJson" placeholder={copy.skillsView.manifestPlaceholder} />
                  </label>
                  <label>
                    <span>{copy.skillsView.contentLabel}</span>
                    <textarea name="content" placeholder={copy.skillsView.contentPlaceholder} />
                  </label>
                  <label>
                    <span>{copy.skillsView.contentTypeLabel}</span>
                    <select name="contentType" defaultValue="text/markdown">
                      <option value="text/markdown">{copy.skillsView.markdown}</option>
                      <option value="text/plain">{copy.skillsView.plainText}</option>
                    </select>
                  </label>
                  <button type="submit">{copy.skillsView.createDraft}</button>
                </form>

                <section className="skillsList" aria-label={copy.skillsView.versionsTitle}>
                  <h2>{copy.skillsView.versionsTitle}</h2>
                  {pageState.skills.availableVersions.length === 0 ? (
                    <p>{copy.skillsView.emptyVersions}</p>
                  ) : (
                    pageState.skills.availableVersions.map((version) => (
                      <div className="skillRow" key={version.id}>
                        <div>
                          <strong>{version.manifest.name}</strong>
                          <span>{version.manifest.id} · {version.version} · {copy.skillsView.statusLabels[version.reviewState]}</span>
                        </div>
                        <div className="skillActions">
                          <form action={validateSkillVersionAction}>
                            <input name="skillVersionId" type="hidden" value={version.id} />
                            <button type="submit">{copy.skillsView.validate}</button>
                          </form>
                          <form action={publishSkillVersionAction}>
                            <input name="skillVersionId" type="hidden" value={version.id} />
                            <button type="submit">{copy.skillsView.publish}</button>
                          </form>
                          {activeProject ? (
                            <form action={bindSkillVersionAction}>
                              <input name="projectId" type="hidden" value={activeProject.id} />
                              <input name="skillVersionId" type="hidden" value={version.id} />
                              <button type="submit">{copy.skillsView.bind}</button>
                            </form>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </section>

                <section className="skillsList" aria-label={copy.skillsView.boundTitle}>
                  <h2>{copy.skillsView.boundTitle}</h2>
                  {pageState.skills.boundSkills.length === 0 ? (
                    <p>{copy.skillsView.emptyBound}</p>
                  ) : (
                    pageState.skills.boundSkills.map((item) => (
                      <div className="skillRow" key={item.binding.id}>
                        <div>
                          <strong>{item.skill.name}</strong>
                          <span>{item.version.version} · {copy.skillsView.statusLabels[item.version.reviewState]}</span>
                        </div>
                        <form action={setSkillBindingEnabledAction}>
                          <input name="bindingId" type="hidden" value={item.binding.id} />
                          <input name="enabled" type="hidden" value={String(!item.binding.enabled)} />
                          <button type="submit">
                            {item.binding.enabled ? copy.skillsView.disable : copy.skillsView.enable}
                          </button>
                        </form>
                      </div>
                    ))
                  )}
                </section>
              </section>
            ) : null}
```

Wrap the existing workbench empty/chat rendering in `activeView === "workbench"` checks so Skills view does not also render the conversation thread.

Add:

```ts
function toSkillFlowError(value: string | undefined): SkillFlowErrorCode | undefined {
  if (
    value === "invalid_manifest_json" ||
    value === "manifest_validation_failed" ||
    value === "unsupported_skill_scope" ||
    value === "duplicate_skill_version" ||
    value === "unsupported_content_type" ||
    value === "skill_content_required" ||
    value === "skill_content_too_large" ||
    value === "project_not_found" ||
    value === "skill_version_not_found" ||
    value === "skill_version_not_validated" ||
    value === "skill_version_not_published" ||
    value === "skill_binding_not_found" ||
    value === "publish_not_allowed" ||
    value === "skill_operation_failed"
  ) {
    return value;
  }
  return undefined;
}
```

- [ ] **Step 5: Add CSS for Skills view**

Append to `apps/web/src/app/globals.css`:

```css
.skillsView {
  display: grid;
  gap: 18px;
}

.skillsHeader {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.skillsHeader h1 {
  margin: 0;
  font-size: 1.65rem;
  line-height: 1.15;
}

.skillsHeader p {
  margin: 8px 0 0;
  color: var(--muted);
  line-height: 1.55;
}

.skillsHeader span,
.skillsProjectContext {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--muted);
  padding: 8px 10px;
  font-size: 0.82rem;
  font-weight: 760;
}

.skillsProjectContext {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.skillsProjectContext strong {
  color: var(--text);
}

.skillEditor,
.skillsList {
  display: grid;
  gap: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  padding: 16px;
}

.skillEditor h2,
.skillsList h2 {
  margin: 0;
  font-size: 1rem;
}

.skillEditor label {
  display: grid;
  gap: 7px;
  color: var(--muted);
  font-size: 0.82rem;
  font-weight: 760;
}

.skillEditor textarea,
.skillEditor select {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-raised);
  color: var(--text);
  padding: 10px;
  outline: 0;
}

.skillEditor textarea {
  min-height: 132px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.82rem;
  line-height: 1.5;
}

.skillEditor button,
.skillActions button,
.skillRow form button {
  min-height: 34px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-raised);
  color: var(--text);
  padding: 0 11px;
  font-size: 0.84rem;
  font-weight: 760;
}

.skillRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-top: 1px solid var(--line);
  padding-top: 12px;
}

.skillRow:first-of-type {
  border-top: 0;
  padding-top: 0;
}

.skillRow div {
  min-width: 0;
}

.skillRow strong,
.skillRow span {
  display: block;
  overflow-wrap: anywhere;
}

.skillRow span {
  margin-top: 4px;
  color: var(--muted);
  font-size: 0.78rem;
}

.skillActions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  flex: 0 0 auto;
}

.skillRuntimeChip {
  border: 1px solid var(--accent-line);
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  padding: 4px 8px;
  font-size: 0.74rem;
  font-weight: 800;
}
```

- [ ] **Step 6: Run page tests**

Run:

```bash
pnpm test -- apps/web/src/app/page.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

Run:

```bash
git add apps/web/src/lib/i18n.ts apps/web/src/app/page.tsx apps/web/src/app/page.test.ts apps/web/src/app/globals.css
git commit -m "add project skills view"
```

## Task 7: Full Verification and Polish

**Files:**
- Verify all changed files.
- Modify only files with test, typecheck, or build failures.

- [ ] **Step 1: Run package tests**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Manually inspect local Web flow**

Run:

```bash
pnpm dev
```

Expected: Next.js starts, usually at `http://localhost:3000`.

In the browser:

1. Open `/`.
2. Create a project.
3. Open `/?view=skills`.
4. Create a draft with the English or Chinese sample manifest from the placeholder.
5. Validate it.
6. Publish it.
7. Bind it to the project.
8. Submit an LP prompt in the Workbench.
9. Confirm the task still produces static HTML/CSS/JS artifacts.

- [ ] **Step 5: Check local state file shape**

Open `.lp-agent/workbench-state.json` after the manual flow.

Expected top-level arrays include:

```json
{
  "projects": [],
  "briefs": [],
  "pageVersions": [],
  "deployments": [],
  "tasks": [],
  "messages": [],
  "taskSnapshots": [],
  "skills": [],
  "skillVersions": [],
  "skillBindings": []
}
```

The arrays will contain records after manual use. Generated LP artifacts must remain HTML/CSS/JS strings, not React project files.

- [ ] **Step 6: Commit verification fixes if needed**

If any verification command required fixes, commit them:

```bash
git add packages/db/src/workbench-repositories.ts packages/db/src/workbench-repositories.test.ts packages/db/src/json-file-workbench-repositories.ts packages/db/src/json-file-workbench-repositories.test.ts packages/runtime-adapters/src/index.ts packages/runtime-adapters/src/index.test.ts packages/model-gateway/src/index.ts packages/model-gateway/src/index.test.ts packages/api/src/index.ts packages/api/src/services.test.ts apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.ts apps/web/src/app/actions.test.ts apps/web/src/lib/i18n.ts apps/web/src/app/page.tsx apps/web/src/app/page.test.ts apps/web/src/app/globals.css
git commit -m "fix project skills verification issues"
```

If no fixes were needed, do not create an empty commit.

## Final Acceptance Checklist

- [ ] Project-level skills can be created from manifest JSON and Markdown/plain text content.
- [ ] Draft creation normalizes `reviewState` to `draft`.
- [ ] Validation updates both record and manifest review state to `validated`.
- [ ] Publishing updates both record and manifest review state to `published`.
- [ ] Duplicate `skillId + version` is rejected.
- [ ] Non-project scopes are rejected in Web V1.
- [ ] Only published skill versions can be bound to a project.
- [ ] Disabled bindings do not enter runtime context.
- [ ] Project-bound published skills enter builder and reviewer runtime contexts with content.
- [ ] No hidden default sample skill is injected when no skills are bound.
- [ ] Skills UI works in Chinese and English copy.
- [ ] Generated LP output remains framework-free static HTML/CSS/JS.
- [ ] `pnpm test` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm build` passes.
