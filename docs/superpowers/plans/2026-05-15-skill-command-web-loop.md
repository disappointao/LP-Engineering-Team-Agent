# Skill Command Web Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Web-facing simulated execution loop for project-bound deployment skill commands, including command discovery, one-shot approval, sanitized run events, and timeline display.

**Architecture:** Keep the existing API command execution method as the only execution path. The Web store injects a simulated `ToolCommandRunner`, derives sanitized command cards from bound project skills, and exposes a server action that sends a hardcoded local approval id. The Skills view launches commands, and the existing chat timeline renders sanitized `tool.*` run events.

**Tech Stack:** TypeScript, Next.js server actions, React server components, Vitest, local JSON-file repository state, existing `@lp-agent/api`, `@lp-agent/db`, `@lp-agent/skills`, and Web i18n/copy helpers.

---

## File Structure

- Modify `packages/api/src/index.ts`
  - Add metadata-only `outputSummary` to `tool.completed` and `tool.failed` run event payloads.
- Modify `packages/api/src/services.test.ts`
  - Assert command run events include output summary and still do not leak raw stdout, secrets, or artifact content.
- Create `apps/web/src/lib/simulated-tool-command-runner.ts`
  - Web-safe mock `ToolCommandRunner` implementation that never executes shell commands.
- Modify `apps/web/src/lib/workbench-store.ts`
  - Add command view model types, command discovery helper, Web command execution method, error mapping, and runner injection.
- Modify `apps/web/src/lib/workbench-store.test.ts`
  - Cover command discovery, simulated execution, failure mapping, and run event loading.
- Modify `apps/web/src/app/actions.ts`
  - Add `executeSkillCommandAction`.
- Modify `apps/web/src/app/actions.test.ts`
  - Cover the action's form parsing, approval id, redirect behavior, and error mapping.
- Modify `apps/web/src/lib/i18n.ts`
  - Add English and Chinese copy for command cards, simulated approval, and command errors.
- Modify `apps/web/src/app/page.tsx`
  - Render Skill Commands in the Skills view and parse command error query params.
- Modify `apps/web/src/app/page.test.ts`
  - Cover command card rendering, filtering, forms, localized copy, and raw output non-rendering.
- Modify `apps/web/src/lib/chat-workbench.ts`
  - Render deployer/tool events with useful sanitized metadata.
- Modify `apps/web/src/lib/chat-workbench.test.ts`
  - Cover `tool.started`, `tool.completed`, `tool.failed`, output summaries, and failed status labels.
- Modify `apps/web/src/app/globals.css`
  - Add compact command card styling consistent with existing Skills/MCP cards.
- Modify `docs/agent-development-learning.md`
  - Mark the implementation plan as the current Stage 4.1 plan, then mark completion after final verification.

## Commit Discipline

Keep the user's untracked image files out of every commit. Each task ends with a focused commit.

Before every commit, run:

```bash
git status --short
```

Expected: only intended tracked files are staged; the two root-level `微信图片_*.png` files remain untracked and unstaged.

---

### Task 1: Add Safe Output Summary to API Tool Events

**Files:**
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/services.test.ts`

- [ ] **Step 1: Write the failing API test**

In `packages/api/src/services.test.ts`, extend the existing `"executes an approved deployment skill command with artifact workspace"` test after `const serializedEvents = JSON.stringify(events);`.

Add these assertions:

```ts
const completedToolEvent = events.find((event) => event.type === "tool.completed");
expect(completedToolEvent?.payload).toMatchObject({
  outputSummary: "stdout: 30 chars\nstderr: 0 chars"
});
expect(serializedEvents).toContain("stdout: 30 chars");
expect(serializedEvents).toContain("stderr: 0 chars");
expect(serializedEvents).not.toContain("published secret-token");
expect(serializedEvents).not.toContain(artifactFragment);
```

In the failed runner test in the same file, add:

```ts
const failedToolEvent = events.find((event) => event.type === "tool.failed");
expect(failedToolEvent?.payload).toMatchObject({
  outputSummary: "stdout: 0 chars\nstderr: 0 chars",
  errorName: "deploy_failed"
});
```

- [ ] **Step 2: Run the API test and verify it fails**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: FAIL because `tool.completed` and `tool.failed` event payloads do not include `outputSummary`.

- [ ] **Step 3: Implement metadata-only event output summary**

In `packages/api/src/index.ts`, inside `executeProjectSkillCommand`, compute the summary once before `finalPayload`.

Replace the existing `finalPayload` block with this shape:

```ts
const outputSummary = summarizeSkillCommandOutput({
  runnerResult,
  secretValues
});
const finalPayload = {
  ...basePayload,
  observationId,
  outputSummary,
  ...(runnerResult.exitCode !== undefined ? { exitCode: runnerResult.exitCode } : {}),
  ...(sanitizedErrorName !== undefined ? { errorName: sanitizedErrorName } : {})
};
```

Then update the observation to reuse the same variable:

```ts
outputSummary,
```

This must replace the current inline call to `summarizeSkillCommandOutput` in the `ToolObservationRecord`.

- [ ] **Step 4: Run the API test and verify it passes**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/index.ts packages/api/src/services.test.ts
git commit -m "add skill command output event summaries"
```

---

### Task 2: Add Web Simulated Runner and Store Command Surface

**Files:**
- Create: `apps/web/src/lib/simulated-tool-command-runner.ts`
- Modify: `apps/web/src/lib/workbench-store.ts`
- Modify: `apps/web/src/lib/workbench-store.test.ts`

- [ ] **Step 1: Write failing store tests**

In `apps/web/src/lib/workbench-store.test.ts`, add this helper near `brandSkillManifestJson()`:

```ts
function deploymentSkillManifestJson(): string {
  return JSON.stringify({
    id: "skill_static_deploy",
    name: "Static deploy",
    version: "1.0.0",
    type: "deployment",
    scope: "project",
    description: "Simulates static LP publishing.",
    permissions: ["deploy:simulate"],
    requiredSecrets: [],
    entrypoints: ["deploy.md"],
    commands: [
      {
        id: "publish_static",
        name: "Publish static",
        description: "Simulate publishing generated static files.",
        permission: "deploy:simulate",
        requiresApproval: true,
        command: "static-deploy",
        args: ["--project", "{{projectId}}"],
        env: [{ name: "LP_PROJECT_ID", value: "{{projectId}}" }],
        timeoutMs: 30000
      }
    ],
    reviewState: "published"
  });
}
```

Add this test near the existing skill store tests:

```ts
it("discovers bound published deployment skill commands", async () => {
  const store = createWebWorkbenchStore();
  const project = await store.createProject({ name: "Project" });
  const draft = await store.createSkillDraft({
    manifestJson: deploymentSkillManifestJson(),
    content: "# Deploy",
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

  expect(state.skillCommands).toEqual([
    {
      skillId: "skill_static_deploy",
      skillName: "Static deploy",
      skillVersionId: published.value.id,
      commandId: "publish_static",
      commandName: "Publish static",
      description: "Simulate publishing generated static files.",
      permission: "deploy:simulate",
      requiresApproval: true
    }
  ]);
});
```

Add this test after it:

```ts
it("executes skill commands with the simulated Web runner", async () => {
  const repositories = createInMemoryWorkbenchRepositories();
  const store = createWebWorkbenchStore({ repositories });
  const project = await store.createProject({ name: "Project" });
  const draft = await store.createSkillDraft({
    manifestJson: deploymentSkillManifestJson(),
    content: "# Deploy",
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

  const result = await store.executeSkillCommand({
    projectId: project.id,
    skillVersionId: published.value.id,
    commandId: "publish_static",
    approvedByUserId: "local-web-user"
  });

  expect(result).toMatchObject({
    ok: true,
    value: {
      run: {
        role: "deployer",
        state: "completed"
      },
      observation: {
        state: "completed",
        outputSummary: "stdout: 47 chars\nstderr: 0 chars"
      }
    }
  });
  const events = await repositories.runEvents.listForProject(project.id);
  expect(events.map((event) => event.type)).toEqual([
    "run.started",
    "tool.started",
    "tool.completed",
    "run.completed"
  ]);
  expect(JSON.stringify(events)).toContain("stdout: 47 chars");
});
```

Add one error mapping test:

```ts
it("maps skill command execution validation errors to stable codes", async () => {
  const store = createWebWorkbenchStore();

  await expect(
    store.executeSkillCommand({
      projectId: "missing_project",
      skillVersionId: "missing_version",
      commandId: "publish_static",
      approvedByUserId: "local-web-user"
    })
  ).resolves.toEqual({
    ok: false,
    error: "project_not_found"
  });
});
```

- [ ] **Step 2: Run the store tests and verify they fail**

Run:

```bash
pnpm test -- apps/web/src/lib/workbench-store.test.ts
```

Expected: FAIL because `skillCommands`, `executeSkillCommand`, and `SimulatedToolCommandRunner` do not exist.

- [ ] **Step 3: Create the simulated runner**

Create `apps/web/src/lib/simulated-tool-command-runner.ts`:

```ts
import type {
  ToolCommandRunner,
  ToolCommandRunInput,
  ToolCommandRunResult
} from "@lp-agent/api";

export class SimulatedToolCommandRunner implements ToolCommandRunner {
  async run(input: ToolCommandRunInput): Promise<ToolCommandRunResult> {
    if (input.commandId.includes("fail")) {
      return {
        state: "failed",
        exitCode: 1,
        stdout: "",
        stderr: "Simulated command failure.",
        errorName: "simulated_command_failed"
      };
    }

    return {
      state: "completed",
      exitCode: 0,
      stdout: `Simulated ${input.commandId} for project ${input.projectId}.`,
      stderr: ""
    };
  }
}
```

- [ ] **Step 4: Add Web store types and command discovery**

In `apps/web/src/lib/workbench-store.ts`, extend the imports from `@lp-agent/api`:

```ts
  type SkillCommandExecutionResult,
  type ToolCommandRunner,
```

Import the runner:

```ts
import { SimulatedToolCommandRunner } from "./simulated-tool-command-runner";
```

Add command error and view model types after `SkillFlowErrorCode`:

```ts
export type SkillCommandFlowErrorCode =
  | "project_not_found"
  | "skill_command_not_found"
  | "skill_command_not_bound"
  | "skill_command_not_deployment"
  | "skill_command_not_published"
  | "skill_command_permission_denied"
  | "skill_command_approval_required"
  | "skill_command_page_version_not_found"
  | "skill_command_unknown_template_variable"
  | "skill_command_execution_failed";

export interface ProjectSkillCommandView {
  skillId: string;
  skillName: string;
  skillVersionId: string;
  commandId: string;
  commandName: string;
  description?: string;
  permission: string;
  requiresApproval: boolean;
}

export type SkillCommandActionResult =
  | { ok: true; value: SkillCommandExecutionResult }
  | { ok: false; error: SkillCommandFlowErrorCode };

export interface ExecuteSkillCommandFormInput {
  projectId: string;
  skillVersionId: string;
  commandId: string;
  pageVersionId?: string;
  approvedByUserId: string;
}
```

Add `skillCommands: ProjectSkillCommandView[]` to both `WorkbenchPageState` variants.

Add `executeSkillCommand(input: ExecuteSkillCommandFormInput): Promise<SkillCommandActionResult>;` to `WebWorkbenchStore`.

Extend `WebWorkbenchStoreOptions`:

```ts
export interface WebWorkbenchStoreOptions {
  repositories?: WorkbenchRepositories;
  toolCommandRunner?: ToolCommandRunner;
}
```

Create the service with an injected simulated runner:

```ts
const service = new DemoWorkbenchService({
  repositories,
  toolCommandRunner: options.toolCommandRunner ?? new SimulatedToolCommandRunner()
});
```

Add the discovery helper:

```ts
export function deriveProjectSkillCommands(
  skillState: ProjectSkillState
): ProjectSkillCommandView[] {
  return skillState.boundSkills.flatMap((boundSkill) => {
    const { skill, version, binding } = boundSkill;
    if (
      !binding.enabled ||
      version.reviewState !== "published" ||
      version.manifest.reviewState !== "published" ||
      version.manifest.type !== "deployment"
    ) {
      return [];
    }

    return (version.manifest.commands ?? []).map((command) => ({
      skillId: skill.id,
      skillName: skill.name,
      skillVersionId: version.id,
      commandId: command.id,
      commandName: command.name,
      ...(command.description ? { description: command.description } : {}),
      permission: command.permission,
      requiresApproval: command.requiresApproval
    }));
  });
}
```

Use this helper in `getPageState` after loading skills:

```ts
const skills = await loadSkillState(requestedProject?.id);
return {
  kind: "empty",
  projects: currentProjects,
  tasks: currentTasks,
  skills,
  skillCommands: deriveProjectSkillCommands(skills),
  models: await loadModelState(requestedProject?.id),
  mcp: await loadMCPState(requestedProject?.id)
};
```

Repeat the same pattern in the `task_ready` branch:

```ts
const skills = await loadSkillState(activeProjectId);
return {
  kind: "task_ready",
  projects: currentProjects,
  tasks: currentTasks,
  skills,
  skillCommands: deriveProjectSkillCommands(skills),
  models: await loadModelState(activeProjectId),
  mcp: await loadMCPState(activeProjectId),
  activeTaskId: task.id,
  task: { ...task },
  messages: await listMessages(task.id),
  runEvents,
  snapshot
};
```

- [ ] **Step 5: Add Web store command execution**

Inside the object returned by `createWebWorkbenchStore`, add:

```ts
async executeSkillCommand(input) {
  try {
    const value = await service.executeProjectSkillCommand(input);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: toSkillCommandFlowError(error) };
  }
},
```

Add this mapper near the existing error mappers:

```ts
function toSkillCommandFlowError(error: unknown): SkillCommandFlowErrorCode {
  const message = error instanceof Error ? error.message : "";
  if (
    message === "project_not_found" ||
    message === "skill_command_not_found" ||
    message === "skill_command_not_bound" ||
    message === "skill_command_not_deployment" ||
    message === "skill_command_not_published" ||
    message === "skill_command_permission_denied" ||
    message === "skill_command_approval_required" ||
    message === "skill_command_page_version_not_found" ||
    message === "skill_command_unknown_template_variable"
  ) {
    return message;
  }
  if (message === "Project not found.") {
    return "project_not_found";
  }
  return "skill_command_execution_failed";
}
```

- [ ] **Step 6: Include skill command run events in active project timelines**

Update `filterRunEventsForSnapshot` so command runs remain visible after execution:

```ts
return runEvents.filter(
  (event) => runIds.has(event.runId) || event.runId.startsWith("run_skill_command_")
);
```

- [ ] **Step 7: Run the store tests and verify they pass**

Run:

```bash
pnpm test -- apps/web/src/lib/workbench-store.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/simulated-tool-command-runner.ts apps/web/src/lib/workbench-store.ts apps/web/src/lib/workbench-store.test.ts
git commit -m "add web skill command store loop"
```

---

### Task 3: Add Server Action for One-Shot Approval

**Files:**
- Modify: `apps/web/src/app/actions.ts`
- Modify: `apps/web/src/app/actions.test.ts`

- [ ] **Step 1: Write failing action tests**

In `apps/web/src/app/actions.test.ts`, add `executeSkillCommand: vi.fn()` to the hoisted `mocks` object, reset it in `beforeEach`, and expose it from the mocked store.

Add this import:

```ts
  executeSkillCommandAction,
```

Add this helper near the existing form helpers:

```ts
function buildSkillCommandForm(input: Record<string, string> = {}): FormData {
  const formData = new FormData();
  formData.set("projectId", input.projectId ?? "project_2");
  formData.set("skillVersionId", input.skillVersionId ?? "skill_version_1");
  formData.set("commandId", input.commandId ?? "publish_static");
  formData.set("pageVersionId", input.pageVersionId ?? "version_1");
  return formData;
}
```

Add these tests:

```ts
it("executes a skill command with local one-shot approval", async () => {
  mocks.executeSkillCommand.mockResolvedValue({
    ok: true,
    value: {
      run: { id: "run_skill_command_1" },
      observation: { id: "tool_observation_1" }
    }
  });

  await expectRedirect(executeSkillCommandAction(buildSkillCommandForm()), "/?view=skills");

  expect(mocks.executeSkillCommand).toHaveBeenCalledWith({
    projectId: "project_2",
    skillVersionId: "skill_version_1",
    commandId: "publish_static",
    pageVersionId: "version_1",
    approvedByUserId: "local-web-user"
  });
  expect(mocks.setCurrentProjectId).toHaveBeenCalledWith("project_2");
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
});

it("omits blank page version ids when executing skill commands", async () => {
  mocks.executeSkillCommand.mockResolvedValue({
    ok: true,
    value: {
      run: { id: "run_skill_command_1" },
      observation: { id: "tool_observation_1" }
    }
  });

  await expectRedirect(
    executeSkillCommandAction(buildSkillCommandForm({ pageVersionId: "" })),
    "/?view=skills"
  );

  expect(mocks.executeSkillCommand).toHaveBeenCalledWith({
    projectId: "project_2",
    skillVersionId: "skill_version_1",
    commandId: "publish_static",
    approvedByUserId: "local-web-user"
  });
});

it("redirects skill command actions with stable command errors", async () => {
  mocks.executeSkillCommand.mockResolvedValue({
    ok: false,
    error: "skill_command_not_bound"
  });

  await expectRedirect(
    executeSkillCommandAction(buildSkillCommandForm()),
    "/?view=skills&skillError=skill_command_not_bound"
  );
});
```

- [ ] **Step 2: Run action tests and verify they fail**

Run:

```bash
pnpm test -- apps/web/src/app/actions.test.ts
```

Expected: FAIL because `executeSkillCommandAction` does not exist.

- [ ] **Step 3: Implement the server action**

In `apps/web/src/app/actions.ts`, add:

```ts
const localWebApprovalUserId = "local-web-user";
```

Add the action after `setSkillBindingEnabledAction`:

```ts
export async function executeSkillCommandAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId) {
    redirectToSkillsWithError("project_not_found");
  }

  const pageVersionId = String(formData.get("pageVersionId") ?? "").trim();
  const result = await getWebWorkbenchStore().executeSkillCommand({
    projectId,
    skillVersionId: String(formData.get("skillVersionId") ?? ""),
    commandId: String(formData.get("commandId") ?? ""),
    ...(pageVersionId ? { pageVersionId } : {}),
    approvedByUserId: localWebApprovalUserId
  });
  if (!result.ok) {
    redirectToSkillsWithError(result.error);
  }

  await setCurrentProjectId(projectId);
  revalidatePath("/");
  redirect("/?view=skills");
}
```

Extend the `SkillFlowErrorCode` union in `apps/web/src/lib/workbench-store.ts` to include `SkillCommandFlowErrorCode`:

```ts
export type SkillFlowErrorCode =
  | "invalid_manifest_json"
  | "manifest_validation_failed"
  | "unsupported_skill_scope"
  | "duplicate_skill_version"
  | "skill_binding_already_exists"
  | "unsupported_content_type"
  | "skill_content_required"
  | "skill_content_too_large"
  | "project_not_found"
  | "skill_version_not_found"
  | "skill_version_not_validated"
  | "skill_version_not_published"
  | "skill_binding_not_found"
  | "publish_not_allowed"
  | "skill_operation_failed"
  | SkillCommandFlowErrorCode;
```

- [ ] **Step 4: Run action tests and verify they pass**

Run:

```bash
pnpm test -- apps/web/src/app/actions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/actions.ts apps/web/src/app/actions.test.ts apps/web/src/lib/workbench-store.ts
git commit -m "add skill command approval action"
```

---

### Task 4: Render Skill Commands in the Skills View

**Files:**
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`

- [ ] **Step 1: Write failing page tests**

In `apps/web/src/app/page.test.ts`, add a bound deployment skill fixture or extend `projectSkillState("published")` in a new test by overriding the manifest:

```ts
const deploymentBoundSkill = {
  ...projectSkillState("published"),
  skill: {
    ...projectSkillState("published").skill,
    id: "skill_static_deploy",
    name: "Static deploy",
    type: "deployment"
  },
  version: {
    ...projectSkillState("published").version,
    id: "skill_version_deploy",
    skillId: "skill_static_deploy",
    manifest: {
      ...projectSkillState("published").version.manifest,
      id: "skill_static_deploy",
      name: "Static deploy",
      type: "deployment",
      permissions: ["deploy:simulate"],
      commands: [
        {
          id: "publish_static",
          name: "Publish static",
          description: "Simulate publishing generated static files.",
          permission: "deploy:simulate",
          requiresApproval: true,
          command: "static-deploy",
          args: ["--project", "{{projectId}}"]
        }
      ],
      reviewState: "published"
    }
  }
};
```

Add this test:

```ts
it("renders project skill command cards with simulated approval forms", async () => {
  pageMocks.currentProjectId = "project_1";
  pageMocks.pageState = {
    kind: "empty",
    projects: [
      {
        id: "project_1",
        name: "Spring Campaign",
        createdAt: "2026-05-12T08:00:00.000Z"
      }
    ],
    tasks: [],
    skills: {
      boundSkills: [deploymentBoundSkill],
      availableVersions: []
    },
    skillCommands: [
      {
        skillId: "skill_static_deploy",
        skillName: "Static deploy",
        skillVersionId: "skill_version_deploy",
        commandId: "publish_static",
        commandName: "Publish static",
        description: "Simulate publishing generated static files.",
        permission: "deploy:simulate",
        requiresApproval: true
      }
    ]
  };

  const page = await HomePage({
    searchParams: Promise.resolve({ view: "skills" })
  });
  const text = collectText(page);
  const forms = collectElements(page, "form");
  const inputs = collectElements(page, "input");

  expect(text).toContain("Skill Commands");
  expect(text).toContain("Approve and simulate");
  expect(text).toContain("Simulation only");
  expect(text).toContain("Publish static");
  expect(text).toContain("deploy:simulate");
  expect(forms.some((form) => form.props?.action === executeSkillCommandAction)).toBe(true);
  expect(inputs.some((input) => input.props?.name === "commandId" && input.props?.value === "publish_static")).toBe(true);
});
```

Add a Chinese copy test:

```ts
it("renders localized Chinese skill command copy", async () => {
  pageMocks.acceptLanguage = "zh-CN,zh;q=0.9";
  pageMocks.currentProjectId = "project_1";
  pageMocks.pageState = {
    kind: "empty",
    projects: [
      {
        id: "project_1",
        name: "春季活动",
        createdAt: "2026-05-12T08:00:00.000Z"
      }
    ],
    tasks: [],
    skills: {
      boundSkills: [deploymentBoundSkill],
      availableVersions: []
    },
    skillCommands: [
      {
        skillId: "skill_static_deploy",
        skillName: "Static deploy",
        skillVersionId: "skill_version_deploy",
        commandId: "publish_static",
        commandName: "Publish static",
        permission: "deploy:simulate",
        requiresApproval: true
      }
    ]
  };

  const page = await HomePage({
    searchParams: Promise.resolve({ view: "skills" })
  });
  const text = collectText(page);

  expect(text).toContain("技能命令");
  expect(text).toContain("批准并模拟执行");
  expect(text).toContain("仅模拟执行");
});
```

- [ ] **Step 2: Run page tests and verify they fail**

Run:

```bash
pnpm test -- apps/web/src/app/page.test.ts
```

Expected: FAIL because the command UI copy, action import, and rendering do not exist.

- [ ] **Step 3: Add copy fields**

In `apps/web/src/lib/i18n.ts`, add these fields to `WorkbenchCopy["skillsView"]`:

```ts
    commandsTitle: string;
    commandsSubtitle: string;
    commandPermissionLabel: string;
    commandApprovalRequired: string;
    commandApprovalNotRequired: string;
    commandSimulationLabel: string;
    approveAndSimulate: string;
    emptyCommands: string;
```

Add English values:

```ts
      commandsTitle: "Skill Commands",
      commandsSubtitle: "Run published deployment skill commands through a simulated Web runner.",
      commandPermissionLabel: "Permission",
      commandApprovalRequired: "One-shot approval required",
      commandApprovalNotRequired: "Approval still required in this Web version",
      commandSimulationLabel: "Simulation only",
      approveAndSimulate: "Approve and simulate",
      emptyCommands: "No executable deployment skill commands are bound to this project.",
```

Add Chinese values:

```ts
      commandsTitle: "技能命令",
      commandsSubtitle: "通过 Web 模拟运行器执行已发布部署技能声明的命令。",
      commandPermissionLabel: "权限",
      commandApprovalRequired: "需要一次性批准",
      commandApprovalNotRequired: "当前 Web 版本仍需要批准",
      commandSimulationLabel: "仅模拟执行",
      approveAndSimulate: "批准并模拟执行",
      emptyCommands: "当前项目暂无已绑定的可执行部署技能命令。",
```

Add command error messages to both `skillsView.errors` maps:

```ts
        skill_command_not_found: "The selected skill command is no longer available.",
        skill_command_not_bound: "Bind and enable the deployment skill before executing its command.",
        skill_command_not_deployment: "Only deployment skills can expose executable commands.",
        skill_command_not_published: "Publish the deployment skill before executing its command.",
        skill_command_permission_denied: "The project binding does not grant this command permission.",
        skill_command_approval_required: "Approve the command before execution.",
        skill_command_page_version_not_found: "The selected page version is no longer available.",
        skill_command_unknown_template_variable: "The command uses a template variable that is unavailable for this run.",
        skill_command_execution_failed: "The simulated command execution failed."
```

Chinese:

```ts
        skill_command_not_found: "当前技能命令已经不可用。",
        skill_command_not_bound: "请先绑定并启用部署技能，再执行它的命令。",
        skill_command_not_deployment: "只有部署技能可以暴露可执行命令。",
        skill_command_not_published: "请先发布部署技能，再执行它的命令。",
        skill_command_permission_denied: "当前项目绑定没有授予该命令权限。",
        skill_command_approval_required: "请先批准该命令再执行。",
        skill_command_page_version_not_found: "当前页面版本已经不可用。",
        skill_command_unknown_template_variable: "该命令使用了本次运行不可用的模板变量。",
        skill_command_execution_failed: "模拟命令执行失败。"
```

- [ ] **Step 4: Render command cards**

In `apps/web/src/app/page.tsx`, import the action:

```ts
  executeSkillCommandAction,
```

After `const activeSkillLabel = copy.skillsView.activeCount(activeSkillCount);`, add:

```ts
const currentPageVersionId =
  pageState.kind === "task_ready"
    ? pageState.snapshot?.currentPageVersion?.id
    : undefined;
```

After the bound skills section in the Skills view, add:

```tsx
<section className="skillsList skillCommandsList" aria-labelledby="skill-commands-title">
  <div className="skillCommandsHeader">
    <div>
      <h2 id="skill-commands-title">{copy.skillsView.commandsTitle}</h2>
      <p>{copy.skillsView.commandsSubtitle}</p>
    </div>
    <span>{copy.skillsView.commandSimulationLabel}</span>
  </div>
  {pageState.skillCommands.length > 0 ? (
    <div className="skillCommandGrid">
      {pageState.skillCommands.map((command) => (
        <div className="skillCommandCard" key={`${command.skillVersionId}:${command.commandId}`}>
          <div>
            <strong>{command.commandName}</strong>
            <span>{command.skillName}</span>
            {command.description ? <p>{command.description}</p> : null}
            <small>
              {copy.skillsView.commandPermissionLabel}: {command.permission}
            </small>
            <small>
              {command.requiresApproval
                ? copy.skillsView.commandApprovalRequired
                : copy.skillsView.commandApprovalNotRequired}
            </small>
          </div>
          <form action={executeSkillCommandAction}>
            <input name="projectId" type="hidden" value={activeProject.id} />
            <input name="skillVersionId" type="hidden" value={command.skillVersionId} />
            <input name="commandId" type="hidden" value={command.commandId} />
            <input name="pageVersionId" type="hidden" value={currentPageVersionId ?? ""} />
            <button type="submit">{copy.skillsView.approveAndSimulate}</button>
          </form>
        </div>
      ))}
    </div>
  ) : (
    <p>{copy.skillsView.emptyCommands}</p>
  )}
</section>
```

- [ ] **Step 5: Parse skill command errors on the page**

In `toSkillFlowError`, include these values:

```ts
    value === "skill_command_not_found" ||
    value === "skill_command_not_bound" ||
    value === "skill_command_not_deployment" ||
    value === "skill_command_not_published" ||
    value === "skill_command_permission_denied" ||
    value === "skill_command_approval_required" ||
    value === "skill_command_page_version_not_found" ||
    value === "skill_command_unknown_template_variable" ||
    value === "skill_command_execution_failed"
```

- [ ] **Step 6: Run page tests and verify they pass**

Run:

```bash
pnpm test -- apps/web/src/app/page.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/i18n.ts apps/web/src/app/page.tsx apps/web/src/app/page.test.ts
git commit -m "render skill command simulation controls"
```

---

### Task 5: Improve Tool Event Timeline Rendering

**Files:**
- Modify: `apps/web/src/lib/chat-workbench.ts`
- Modify: `apps/web/src/lib/chat-workbench.test.ts`

- [ ] **Step 1: Write failing timeline tests**

In `apps/web/src/lib/chat-workbench.test.ts`, add a test that passes command run events into `createChatWorkbenchThread`:

```ts
it("renders deployment skill command events with sanitized metadata", () => {
  const runEvents: RunEventRecord[] = [
    {
      id: "run_skill_command_1_event_1",
      runId: "run_skill_command_1",
      projectId: "project_1",
      sequence: 1,
      type: "tool.started",
      message: "Deployment skill command started.",
      payload: {
        role: "deployer",
        skillId: "skill_static_deploy",
        commandId: "publish_static"
      },
      createdAt: "2026-05-15T08:00:00.000Z"
    },
    {
      id: "run_skill_command_1_event_2",
      runId: "run_skill_command_1",
      projectId: "project_1",
      sequence: 2,
      type: "tool.completed",
      message: "Deployment skill command completed.",
      payload: {
        role: "deployer",
        commandId: "publish_static",
        exitCode: 0,
        outputSummary: "stdout: 47 chars\nstderr: 0 chars"
      },
      createdAt: "2026-05-15T08:00:01.000Z"
    }
  ];

  const thread = createChatWorkbenchThread({
    copy: getWorkbenchCopy("en"),
    prompt: "Create LP",
    objective: "Convert shoppers",
    pageVersion: pageVersionFixture(),
    downloadLinks: [],
    runEvents
  });

  expect(thread.toolEvents.map((event) => event.label)).toEqual(["Deployer", "Deployer"]);
  expect(thread.toolEvents[1]?.meta).toContain("tool.completed");
  expect(thread.toolEvents[1]?.meta).toContain("publish_static");
  expect(thread.toolEvents[1]?.meta).toContain("exit 0");
  expect(thread.toolEvents[1]?.meta).toContain("stdout: 47 chars");
  expect(thread.toolEvents[1]?.meta).not.toContain("secret-token");
});
```

Add a failed event test:

```ts
it("marks failed tool events with failed status copy", () => {
  const thread = createChatWorkbenchThread({
    copy: getWorkbenchCopy("en"),
    prompt: "Create LP",
    objective: "Convert shoppers",
    pageVersion: pageVersionFixture(),
    downloadLinks: [],
    runEvents: [
      {
        id: "run_skill_command_1_event_2",
        runId: "run_skill_command_1",
        projectId: "project_1",
        sequence: 2,
        type: "tool.failed",
        message: "Deployment skill command failed.",
        payload: {
          role: "deployer",
          commandId: "publish_static",
          exitCode: 1,
          errorName: "simulated_command_failed",
          outputSummary: "stdout: 0 chars\nstderr: 26 chars"
        },
        createdAt: "2026-05-15T08:00:01.000Z"
      }
    ]
  });

  expect(thread.toolEvents[0]).toMatchObject({
    role: "deployer",
    status: "failed",
    statusLabel: "failed"
  });
  expect(thread.toolEvents[0]?.meta).toContain("simulated_command_failed");
});
```

Use existing test fixtures if present. If the file does not have `pageVersionFixture()`, create a local helper that returns a valid `PageVersionRecord` with empty findings and complete static artifacts.

- [ ] **Step 2: Run timeline tests and verify they fail**

Run:

```bash
pnpm test -- apps/web/src/lib/chat-workbench.test.ts
```

Expected: FAIL because `deployer` is mapped to `assistant` and event metadata is only the raw event type.

- [ ] **Step 3: Implement deployer role and metadata formatting**

In `apps/web/src/lib/chat-workbench.ts`, change:

```ts
export type ChatToolRole = "planner" | "builder" | "reviewer" | "deployer" | "assistant";
export type ChatToolStatus = "complete" | "failed";
```

Update `toChatToolEvent`:

```ts
function toChatToolEvent(event: RunEventRecord, copy: WorkbenchCopy): ChatToolEvent {
  const role = toChatToolRole(event);
  const status: ChatToolStatus = event.type.endsWith(".failed") ? "failed" : "complete";
  return {
    id: `${event.runId}:${event.sequence}`,
    role,
    label: role === "assistant" ? copy.chat.generalToolLabel : copy.run[role][0],
    operation: event.message,
    status,
    statusLabel: status === "failed" ? copy.status.failed : copy.chat.toolStatusComplete,
    meta: formatRunEventMeta(event)
  };
}
```

Update role mapping:

```ts
function toChatToolRole(event: RunEventRecord): ChatToolRole {
  const role = event.payload.role;
  if (role === "planner" || role === "builder" || role === "reviewer" || role === "deployer") {
    return role;
  }
  if (event.type.startsWith("tool.")) {
    return "deployer";
  }
  return "assistant";
}
```

Add metadata helpers:

```ts
function formatRunEventMeta(event: RunEventRecord): string {
  const parts = [event.type];
  const commandId = toDisplayValue(event.payload.commandId);
  const exitCode = toDisplayValue(event.payload.exitCode);
  const errorName = toDisplayValue(event.payload.errorName);
  const outputSummary = toDisplayValue(event.payload.outputSummary);

  if (commandId) {
    parts.push(commandId);
  }
  if (exitCode) {
    parts.push(`exit ${exitCode}`);
  }
  if (errorName) {
    parts.push(errorName);
  }
  if (outputSummary) {
    parts.push(outputSummary);
  }
  return parts.join(" - ");
}

function toDisplayValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
}
```

- [ ] **Step 4: Run timeline tests and verify they pass**

Run:

```bash
pnpm test -- apps/web/src/lib/chat-workbench.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/chat-workbench.ts apps/web/src/lib/chat-workbench.test.ts
git commit -m "show skill command events in timeline"
```

---

### Task 6: Style Command Cards and Verify Full Web Slice

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/app/page.test.ts`

- [ ] **Step 1: Add page test coverage for non-rendered raw output**

In `apps/web/src/app/page.test.ts`, add a workbench test with `pageState.kind === "task_ready"` and `runEvents` containing:

```ts
{
  id: "run_skill_command_1_event_2",
  runId: "run_skill_command_1",
  projectId: "project_1",
  sequence: 2,
  type: "tool.completed",
  message: "Deployment skill command completed.",
  payload: {
    role: "deployer",
    commandId: "publish_static",
    exitCode: 0,
    outputSummary: "stdout: 47 chars\nstderr: 0 chars"
  },
  createdAt: "2026-05-15T08:00:01.000Z"
}
```

Assert:

```ts
expect(text).toContain("stdout: 47 chars");
expect(text).not.toContain("published secret-token");
expect(text).not.toContain("<html>");
```

- [ ] **Step 2: Run page tests and verify this coverage passes**

Run:

```bash
pnpm test -- apps/web/src/app/page.test.ts
```

Expected: PASS if Task 5 was implemented correctly.

- [ ] **Step 3: Add compact card styling**

In `apps/web/src/app/globals.css`, extend the shared button selector:

```css
.skillCommandCard button,
```

Add:

```css
.skillCommandsHeader {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.skillCommandsHeader p {
  margin: 5px 0 0;
  color: var(--muted);
  font-size: 0.86rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.skillCommandsHeader span {
  min-height: 26px;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--accent-line);
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  padding: 0 8px;
  font-size: 0.74rem;
  font-weight: 820;
  white-space: nowrap;
}

.skillCommandGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
}

.skillCommandCard {
  min-width: 0;
  display: grid;
  gap: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-raised);
  padding: 12px;
}

.skillCommandCard strong,
.skillCommandCard span,
.skillCommandCard p,
.skillCommandCard small {
  overflow-wrap: anywhere;
}

.skillCommandCard span,
.skillCommandCard small {
  display: block;
  margin-top: 3px;
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1.4;
}

.skillCommandCard p {
  margin: 8px 0;
  color: #3c4147;
  font-size: 0.86rem;
  line-height: 1.5;
}

.skillCommandCard form {
  display: flex;
  justify-content: flex-start;
}
```

Inside the `@media (max-width: 520px)` block, add `.skillCommandsHeader` to the flex-column group:

```css
  .skillCommandsHeader,
```

- [ ] **Step 4: Run Web-focused tests**

Run:

```bash
pnpm test -- apps/web/src/lib/workbench-store.test.ts apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts apps/web/src/lib/chat-workbench.test.ts apps/web/src/lib/i18n.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/globals.css apps/web/src/app/page.test.ts
git commit -m "style skill command web loop"
```

---

### Task 7: Update Learning Notes and Run Final Verification

**Files:**
- Modify: `docs/agent-development-learning.md`

- [ ] **Step 1: Update learning notes**

In `docs/agent-development-learning.md`, replace the Stage 4.1 paragraph that says the Web loop is the next step with a completed note:

```md
已实现的 Stage 4.1 Skill Command Web 模拟执行闭环：

- [2026-05-15-skill-command-web-loop-design.md](./superpowers/specs/2026-05-15-skill-command-web-loop-design.md)
- 当前实现计划：[2026-05-15-skill-command-web-loop.md](./superpowers/plans/2026-05-15-skill-command-web-loop.md)
- Web 工作台已经能展示当前项目已绑定、已发布的 deployment skill commands，并通过一次性批准触发模拟执行。
- Web V1 的 runner 是 `SimulatedToolCommandRunner`，不会执行真实 shell；默认 API runner 仍然 fail closed。
- 命令执行继续走 `executeProjectSkillCommand` 的服务校验路径，并把结果保存为脱敏 observation 和 `tool.started/tool.completed/tool.failed` run events。
- 对话 timeline 展示的是事件类型、command id、exit code、error name 和 metadata-only output summary，不展示 raw stdout/stderr、secret、env 或 artifact 内容。
- 这一步把工具执行从“后端能力”推进为“用户可见的 Agent 工具过程”，后续可以在同一边界下扩展真实 runner、worker 队列、流式日志、cancel/retry、部署编排和 MCP execution。
```

- [ ] **Step 2: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm --filter @lp-agent/db db:validate
```

Expected:

- `pnpm test`: all non-skipped tests pass.
- `pnpm typecheck`: all workspace projects pass.
- `db:validate`: Prisma schema is valid.

If Prisma fails with an `EPERM` cache error under `/Users/ao/.cache/prisma`, rerun only the Prisma command with escalated permissions because Prisma is touching its engine cache.

- [ ] **Step 3: Commit docs**

```bash
git add docs/agent-development-learning.md
git commit -m "document skill command web loop completion"
```

- [ ] **Step 4: Final status check**

Run:

```bash
git status --short
git log --oneline -8
```

Expected:

- Only the two root-level `微信图片_*.png` files remain untracked.
- Recent commits show the focused task commits from this plan.

---

## Final Review Checklist

- [ ] Web never runs shell commands.
- [ ] `DemoWorkbenchService` still defaults to `RejectingToolCommandRunner` when no runner is injected.
- [ ] Web store injects `SimulatedToolCommandRunner` explicitly.
- [ ] Command discovery only includes enabled, bound, published `deployment` skill commands.
- [ ] Server action uses `local-web-user` internally and does not trust a user-submitted approval id.
- [ ] Hidden form project/version/command/page ids are all revalidated by `executeProjectSkillCommand`.
- [ ] Timeline renders command events without raw stdout, raw stderr, env values, secrets, or artifact contents.
- [ ] Chinese and English command copy exist.
- [ ] `pnpm test`, `pnpm typecheck`, and Prisma schema validation pass.
