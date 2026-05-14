# Skill Command Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first controlled command execution slice for published project-bound deployment skills.

**Architecture:** Deployment skill manifests declare an optional `commands` array. The API service validates project binding, publication state, permission, approval, template variables, optional page-version ownership, and secret references before invoking a `ToolCommandRunner` adapter. Command results are persisted as sanitized tool observations and ordered run events so the same execution model can support future MCP tools, deployment workflows, worker queues, and Web timelines.

**Tech Stack:** TypeScript, Zod, Vitest, pnpm workspaces, Prisma schema validation, existing in-memory and JSON-file repository contracts.

---

## File Map

- Modify `packages/skills/src/index.ts`
  - Add `SkillCommandManifestSchema`, `SkillCommandEnvBindingSchema`, and exported types.
  - Add optional `commands` support to `SkillManifestSchema`.

- Modify `packages/skills/src/index.test.ts`
  - Cover optional commands, valid deployment command manifests, invalid env bindings, and executable command validation.

- Modify `packages/db/src/workbench-repositories.ts`
  - Extend `ToolObservationRecord` with `exitCode?: number` and `completedAt?: string`.
  - Keep in-memory repository copy/sort behavior unchanged except for copying the new primitive fields.

- Modify `packages/db/src/workbench-repositories.test.ts`
  - Assert tool observations persist and defensively copy `exitCode` and `completedAt`.

- Modify `packages/db/src/json-file-workbench-repositories.test.ts`
  - Assert JSON-file repositories round-trip the new observation fields.

- Modify `packages/db/prisma/schema.prisma`
  - Add `ToolObservation` to the Postgres data model and relations to `Project` and `Run`.

- Create `packages/api/src/tool-command-runner.ts`
  - Define `ToolCommandRunner`, input/result contracts, and a safe rejecting default runner.

- Create `packages/api/src/skill-command-execution.ts`
  - Add pure helpers for template expansion, env resolution, redaction, output summaries, artifact workspace materialization, and path boundary checks.

- Create `packages/api/src/skill-command-execution.test.ts`
  - Unit-test helper behavior without touching the service orchestration.

- Modify `packages/api/package.json`
  - Include the new API helper test in the package test script.

- Modify `packages/api/src/index.ts`
  - Add `ExecuteProjectSkillCommandInput`, `SkillCommandExecutionResult`, service option injection for `ToolCommandRunner`, and `executeProjectSkillCommand`.
  - Export the runner contracts for API consumers and tests.

- Modify `packages/api/src/services.test.ts`
  - Cover success, runner failure, validation failures, artifact materialization, event sanitation, and observation sanitation.

- Modify `docs/superpowers/README.md`
  - Add this plan immediately after the skill command execution spec.

- Modify `docs/agent-development-learning.md`
  - Link the implementation plan in the Stage 4 learning section.

---

### Task 1: Extend Skill Manifests With Declared Commands

**Files:**
- Modify: `packages/skills/src/index.test.ts`
- Modify: `packages/skills/src/index.ts`

- [ ] **Step 1: Write failing schema tests**

Append these tests inside the existing `describe("skills registry rules", () => { ... })` block in `packages/skills/src/index.test.ts`:

```ts
  it("keeps commands optional for existing manifests", () => {
    const parsed = SkillManifestSchema.parse(sampleTemplateSkill);

    expect(parsed.commands).toBeUndefined();
  });

  it("validates deployment skill command manifests", () => {
    const parsed = SkillManifestSchema.parse({
      ...sampleTemplateSkill,
      id: "skill_static_deploy",
      name: "Static deploy",
      type: "deployment",
      reviewState: "validated",
      permissions: ["artifact:read", "deploy:static"],
      requiredSecrets: ["STATIC_DEPLOY_TOKEN"],
      commands: [
        {
          id: "publish_static",
          name: "Publish static artifacts",
          description: "Uploads the generated static LP files.",
          permission: "deploy:static",
          requiresApproval: true,
          command: "static-deploy",
          args: [
            "--project",
            "{{projectId}}",
            "--html",
            "{{artifact.indexHtmlPath}}"
          ],
          env: [
            { name: "STATIC_DEPLOY_TOKEN", secretRef: "STATIC_DEPLOY_TOKEN" },
            { name: "LP_PROJECT_ID", value: "{{projectId}}" }
          ],
          workingDirectory: "{{artifactDir}}",
          timeoutMs: 120000
        }
      ]
    });

    expect(parsed.commands?.[0]).toMatchObject({
      id: "publish_static",
      command: "static-deploy",
      permission: "deploy:static",
      requiresApproval: true
    });
  });

  it("rejects command env bindings that provide both value and secretRef", () => {
    expect(() =>
      SkillManifestSchema.parse({
        ...sampleTemplateSkill,
        type: "deployment",
        reviewState: "validated",
        permissions: ["deploy:static"],
        requiredSecrets: ["STATIC_DEPLOY_TOKEN"],
        commands: [
          {
            id: "publish_static",
            name: "Publish static artifacts",
            permission: "deploy:static",
            requiresApproval: true,
            command: "static-deploy",
            args: [],
            env: [
              {
                name: "STATIC_DEPLOY_TOKEN",
                value: "inline",
                secretRef: "STATIC_DEPLOY_TOKEN"
              }
            ]
          }
        ]
      })
    ).toThrow();
  });

  it("rejects shell-style command lines in command executable fields", () => {
    expect(() =>
      SkillManifestSchema.parse({
        ...sampleTemplateSkill,
        type: "deployment",
        reviewState: "validated",
        permissions: ["deploy:static"],
        commands: [
          {
            id: "publish_static",
            name: "Publish static artifacts",
            permission: "deploy:static",
            requiresApproval: true,
            command: "pnpm deploy",
            args: []
          }
        ]
      })
    ).toThrow();
  });
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @lp-agent/skills test
```

Expected: the new tests fail because `commands` is rejected by the strict manifest schema.

- [ ] **Step 3: Implement the schema extension**

Update `packages/skills/src/index.ts` so the top section becomes:

```ts
import { z } from "zod";

export const SkillTypeSchema = z.enum(["workflow", "template", "deployment"]);
export type SkillType = z.infer<typeof SkillTypeSchema>;

export const SkillScopeSchema = z.enum(["global", "organization", "workspace", "project"]);
export type SkillScope = z.infer<typeof SkillScopeSchema>;

export const SkillCommandEnvBindingSchema = z
  .object({
    name: z.string().min(1),
    value: z.string().optional(),
    secretRef: z.string().min(1).optional()
  })
  .strict()
  .superRefine((binding, ctx) => {
    const hasValue = binding.value !== undefined;
    const hasSecretRef = binding.secretRef !== undefined;
    if (hasValue === hasSecretRef) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "command env bindings must set exactly one of value or secretRef",
        path: ["value"]
      });
    }
  });
export type SkillCommandEnvBinding = z.infer<typeof SkillCommandEnvBindingSchema>;

export const SkillCommandManifestSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    permission: z.string().min(1),
    requiresApproval: z.boolean(),
    command: z.string().min(1).regex(/^[A-Za-z0-9._/-]+$/),
    args: z.array(z.string()),
    env: z.array(SkillCommandEnvBindingSchema).optional(),
    workingDirectory: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().max(300000).optional()
  })
  .strict();
export type SkillCommandManifest = z.infer<typeof SkillCommandManifestSchema>;

export const SkillManifestSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    type: SkillTypeSchema,
    scope: SkillScopeSchema,
    description: z.string().min(1),
    permissions: z.array(z.string().min(1)).default([]),
    requiredSecrets: z.array(z.string().min(1)).default([]),
    entrypoints: z.array(z.string().min(1)).default([]),
    commands: z.array(SkillCommandManifestSchema).optional(),
    reviewState: z.enum(["draft", "validated", "published", "deprecated", "archived"])
  })
  .strict();
export type SkillManifest = z.infer<typeof SkillManifestSchema>;
```

- [ ] **Step 4: Run the package tests**

Run:

```bash
pnpm --filter @lp-agent/skills test
pnpm --filter @lp-agent/skills typecheck
```

Expected: both commands pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/skills/src/index.ts packages/skills/src/index.test.ts
git commit -m "add skill command manifest schema"
```

---

### Task 2: Extend Tool Observation Persistence Metadata

**Files:**
- Modify: `packages/db/src/workbench-repositories.ts`
- Modify: `packages/db/src/workbench-repositories.test.ts`
- Modify: `packages/db/src/json-file-workbench-repositories.test.ts`
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Write failing in-memory repository expectations**

In `packages/db/src/workbench-repositories.test.ts`, update the `observation` object inside `persists runs, ordered events, and tool observations with defensive copies`:

```ts
    const observation: ToolObservationRecord = {
      id: "tool_observation_1",
      runId: run.id,
      projectId: run.projectId,
      taskId: run.taskId,
      toolName: "searchAssets",
      input: {
        query: "hero"
      },
      outputSummary: "Found three candidate hero images.",
      state: "completed",
      exitCode: 0,
      createdAt,
      completedAt: "2026-05-12T00:00:45.000Z"
    };
```

Update the final observation assertion in the same test:

```ts
    await expect(repositories.toolObservations.listForRun(run.id)).resolves.toEqual([
      expect.objectContaining({
        id: "tool_observation_1",
        input: {
          query: "hero"
        },
        state: "completed",
        exitCode: 0,
        completedAt: "2026-05-12T00:00:45.000Z"
      })
    ]);
```

- [ ] **Step 2: Write failing JSON-file repository expectations**

In `packages/db/src/json-file-workbench-repositories.test.ts`, find the test that persists runs/events/tool observations. Add the same `exitCode` and `completedAt` fields to its `ToolObservationRecord`, then assert the loaded observation contains:

```ts
expect.objectContaining({
  id: "tool_observation_1",
  state: "completed",
  exitCode: 0,
  completedAt: "2026-05-12T00:00:45.000Z"
})
```

- [ ] **Step 3: Run the failing db tests**

Run:

```bash
pnpm --filter @lp-agent/db test
```

Expected: TypeScript/Vitest fails because `ToolObservationRecord` does not accept `exitCode` and `completedAt`.

- [ ] **Step 4: Extend the repository contract**

In `packages/db/src/workbench-repositories.ts`, replace `ToolObservationRecord` with:

```ts
export interface ToolObservationRecord {
  id: string;
  runId: string;
  projectId: string;
  taskId?: string;
  toolName: string;
  input: Record<string, unknown>;
  outputSummary: string;
  state: ToolObservationState;
  exitCode?: number;
  errorName?: string;
  createdAt: string;
  completedAt?: string;
}
```

No additional copy helper change is needed because `exitCode` and `completedAt` are primitive fields and `copyToolObservation` already spreads the record before cloning `input`.

- [ ] **Step 5: Sync the Prisma model**

In `packages/db/prisma/schema.prisma`, add `toolObservations ToolObservation[]` to the `Project` model next to `runs Run[]`:

```prisma
  runs        Run[]
  toolObservations ToolObservation[]
  deployments Deployment[]
```

Add `toolObservations ToolObservation[]` to the `Run` model next to `events RunEvent[]`:

```prisma
  events    RunEvent[]
  toolObservations ToolObservation[]
```

Add this model after `RunEvent`:

```prisma
model ToolObservation {
  id            String   @id
  runId         String
  projectId     String
  taskId        String?
  toolName      String
  input         Json
  outputSummary String
  state         String
  exitCode      Int?
  errorName     String?
  project       Project  @relation(fields: [projectId], references: [id])
  run           Run      @relation(fields: [runId], references: [id])
  createdAt     DateTime @default(now())
  completedAt   DateTime?

  @@index([runId])
  @@index([projectId])
  @@index([taskId])
  @@index([state])
  @@index([createdAt])
}
```

- [ ] **Step 6: Run db tests, typecheck, and schema validation**

Run:

```bash
pnpm --filter @lp-agent/db test
pnpm --filter @lp-agent/db typecheck
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm --filter @lp-agent/db db:validate
```

Expected: tests and typecheck pass. Prisma validation should report that the schema is valid. If Codex sandbox blocks Prisma cache timestamp updates with `EPERM`, rerun the same validation command with user-approved escalation.

- [ ] **Step 7: Commit**

Run:

```bash
git add packages/db/src/workbench-repositories.ts packages/db/src/workbench-repositories.test.ts packages/db/src/json-file-workbench-repositories.test.ts packages/db/prisma/schema.prisma
git commit -m "extend tool observation metadata"
```

---

### Task 3: Add Command Runner and Pure Execution Helpers

**Files:**
- Create: `packages/api/src/tool-command-runner.ts`
- Create: `packages/api/src/skill-command-execution.ts`
- Create: `packages/api/src/skill-command-execution.test.ts`
- Modify: `packages/api/package.json`

- [ ] **Step 1: Add helper tests first**

Create `packages/api/src/skill-command-execution.test.ts`:

```ts
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { StaticArtifacts } from "@lp-agent/artifacts";
import type { SkillManifest } from "@lp-agent/skills";
import {
  cleanupCommandWorkspace,
  materializeStaticArtifactsCommandWorkspace,
  redactCommandOutput,
  resolveCommandTemplate,
  resolveSkillCommandEnvironment,
  summarizeCommandOutput
} from "./skill-command-execution";

describe("skill command execution helpers", () => {
  it("resolves known template variables and rejects unknown variables", () => {
    const variables = {
      projectId: "project_1",
      "artifact.indexHtmlPath": "/tmp/lp/index.html"
    };

    expect(resolveCommandTemplate("{{projectId}}:{{artifact.indexHtmlPath}}", variables)).toBe(
      "project_1:/tmp/lp/index.html"
    );
    expect(() => resolveCommandTemplate("{{missing}}", variables)).toThrow(
      "skill_command_unknown_template_variable"
    );
  });

  it("resolves static and secret-backed env bindings without persisting secret values", () => {
    const manifest: SkillManifest = {
      id: "skill_static_deploy",
      name: "Static deploy",
      version: "1.0.0",
      type: "deployment",
      scope: "project",
      description: "Deploys static LP artifacts.",
      permissions: ["deploy:static"],
      requiredSecrets: ["STATIC_DEPLOY_TOKEN"],
      entrypoints: [],
      reviewState: "published",
      commands: [
        {
          id: "publish_static",
          name: "Publish static artifacts",
          permission: "deploy:static",
          requiresApproval: true,
          command: "static-deploy",
          args: [],
          env: [
            { name: "LP_PROJECT_ID", value: "{{projectId}}" },
            { name: "STATIC_DEPLOY_TOKEN", secretRef: "STATIC_DEPLOY_TOKEN" }
          ]
        }
      ]
    };
    const command = manifest.commands![0]!;

    const env = resolveSkillCommandEnvironment({
      manifest,
      command,
      runtimeEnv: {
        STATIC_DEPLOY_TOKEN: "secret-token"
      },
      variables: {
        projectId: "project_1"
      }
    });

    expect(env).toEqual({
      LP_PROJECT_ID: "project_1",
      STATIC_DEPLOY_TOKEN: "secret-token"
    });
  });

  it("rejects secret refs that are absent from the skill manifest", () => {
    const manifest: SkillManifest = {
      id: "skill_static_deploy",
      name: "Static deploy",
      version: "1.0.0",
      type: "deployment",
      scope: "project",
      description: "Deploys static LP artifacts.",
      permissions: ["deploy:static"],
      requiredSecrets: [],
      entrypoints: [],
      reviewState: "published",
      commands: []
    };

    expect(() =>
      resolveSkillCommandEnvironment({
        manifest,
        command: {
          id: "publish_static",
          name: "Publish static artifacts",
          permission: "deploy:static",
          requiresApproval: true,
          command: "static-deploy",
          args: [],
          env: [{ name: "STATIC_DEPLOY_TOKEN", secretRef: "STATIC_DEPLOY_TOKEN" }]
        },
        runtimeEnv: {
          STATIC_DEPLOY_TOKEN: "secret-token"
        },
        variables: {}
      })
    ).toThrow("skill_command_secret_not_declared");
  });

  it("materializes static artifact files into a bounded workspace", async () => {
    const workspace = await materializeStaticArtifactsCommandWorkspace({
      runId: "run_skill_command_1",
      artifacts: completeArtifacts()
    });

    try {
      const filenames = await readdir(workspace.artifactDir);
      expect(filenames.sort()).toEqual([
        "index.html",
        "script.js",
        "styles.css"
      ]);
      await expect(readFile(workspace.indexHtmlPath, "utf8")).resolves.toContain(
        "<!doctype html>"
      );
      expect(workspace.indexHtmlPath).toBe(join(workspace.artifactDir, "index.html"));
      expect(workspace.stylesCssPath).toBe(join(workspace.artifactDir, "styles.css"));
      expect(workspace.scriptJsPath).toBe(join(workspace.artifactDir, "script.js"));
    } finally {
      await cleanupCommandWorkspace(workspace);
    }
  });

  it("redacts secrets and bounds command output summaries", async () => {
    const root = await mkdtemp(join(tmpdir(), "lp-agent-output-test-"));
    try {
      const redacted = redactCommandOutput("ok secret-token done", ["secret-token"]);
      expect(redacted).toBe("ok [redacted] done");
      expect(summarizeCommandOutput("a".repeat(500), "secret-token", ["secret-token"])).toBe(
        `${"a".repeat(300)}...`
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function completeArtifacts(): StaticArtifacts {
  return {
    indexHtml: "<!doctype html><html></html>",
    stylesCss: ":root {}",
    scriptJs: "window.lpAgent = true;"
  };
}
```

- [ ] **Step 2: Include the helper test in the API package test script**

Update `packages/api/package.json`:

```json
{
  "scripts": {
    "test": "vitest run src/structured-lp-brief.test.ts src/structured-static-artifacts.test.ts src/skill-command-execution.test.ts src/run-orchestrator.test.ts src/services.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

- [ ] **Step 3: Run the failing helper tests**

Run:

```bash
pnpm --filter @lp-agent/api test -- src/skill-command-execution.test.ts
```

Expected: the test fails because `skill-command-execution.ts` does not exist.

- [ ] **Step 4: Add the runner contract**

Create `packages/api/src/tool-command-runner.ts`:

```ts
export interface ToolCommandRunner {
  run(input: ToolCommandRunInput): Promise<ToolCommandRunResult>;
}

export interface ToolCommandRunInput {
  runId: string;
  projectId: string;
  skillId: string;
  skillVersionId: string;
  commandId: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  workingDirectory?: string;
  timeoutMs: number;
}

export interface ToolCommandRunResult {
  state: "completed" | "failed";
  exitCode?: number;
  stdout: string;
  stderr: string;
  errorName?: string;
}

export class RejectingToolCommandRunner implements ToolCommandRunner {
  async run(): Promise<ToolCommandRunResult> {
    return {
      state: "failed",
      exitCode: undefined,
      stdout: "",
      stderr: "",
      errorName: "tool_command_runner_not_configured"
    };
  }
}
```

- [ ] **Step 5: Implement pure execution helpers**

Create `packages/api/src/skill-command-execution.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { StaticArtifacts } from "@lp-agent/artifacts";
import type { SkillCommandManifest, SkillManifest } from "@lp-agent/skills";

const TEMPLATE_PATTERN = /{{\s*([A-Za-z0-9_.]+)\s*}}/g;
const DEFAULT_TIMEOUT_MS = 60000;
const OUTPUT_SUMMARY_LIMIT = 300;

type RuntimeEnvironment = Record<string, string | undefined>;
export type CommandTemplateVariables = Record<string, string | undefined>;

export interface CommandWorkspace {
  rootDir: string;
  artifactDir: string;
  indexHtmlPath: string;
  stylesCssPath: string;
  scriptJsPath: string;
}

export function resolveCommandTemplate(
  value: string,
  variables: CommandTemplateVariables
): string {
  return value.replace(TEMPLATE_PATTERN, (_, variableName: string) => {
    const resolved = variables[variableName];
    if (resolved === undefined) {
      throw new Error("skill_command_unknown_template_variable");
    }
    return resolved;
  });
}

export function resolveSkillCommandEnvironment(input: {
  manifest: SkillManifest;
  command: SkillCommandManifest;
  runtimeEnv: RuntimeEnvironment;
  variables: CommandTemplateVariables;
}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const binding of input.command.env ?? []) {
    if (binding.secretRef) {
      if (!input.manifest.requiredSecrets.includes(binding.secretRef)) {
        throw new Error("skill_command_secret_not_declared");
      }
      const value = input.runtimeEnv[binding.secretRef];
      if (!value) {
        throw new Error("skill_command_secret_missing");
      }
      env[binding.name] = value;
      continue;
    }
    if (binding.value !== undefined) {
      env[binding.name] = resolveCommandTemplate(binding.value, input.variables);
    }
  }
  return env;
}

export function resolveSkillCommandTimeout(command: SkillCommandManifest): number {
  return command.timeoutMs ?? DEFAULT_TIMEOUT_MS;
}

export async function materializeStaticArtifactsCommandWorkspace(input: {
  runId: string;
  artifacts: StaticArtifacts;
}): Promise<CommandWorkspace> {
  const rootDir = await mkdtemp(join(tmpdir(), "lp-agent-command-"));
  const artifactDir = join(rootDir, input.runId);
  await mkdir(artifactDir, { recursive: true });
  const workspace: CommandWorkspace = {
    rootDir,
    artifactDir,
    indexHtmlPath: join(artifactDir, "index.html"),
    stylesCssPath: join(artifactDir, "styles.css"),
    scriptJsPath: join(artifactDir, "script.js")
  };
  await Promise.all([
    writeFile(workspace.indexHtmlPath, input.artifacts.indexHtml, "utf8"),
    writeFile(workspace.stylesCssPath, input.artifacts.stylesCss, "utf8"),
    writeFile(workspace.scriptJsPath, input.artifacts.scriptJs, "utf8")
  ]);
  return workspace;
}

export async function cleanupCommandWorkspace(workspace: CommandWorkspace): Promise<void> {
  await rm(workspace.rootDir, { recursive: true, force: true });
}

export function assertWorkingDirectoryAllowed(input: {
  workingDirectory?: string;
  workspace?: CommandWorkspace;
}): void {
  if (!input.workingDirectory) {
    return;
  }
  if (!input.workspace) {
    throw new Error("skill_command_working_directory_forbidden");
  }
  const root = `${resolve(input.workspace.rootDir)}/`;
  const workingDirectory = `${resolve(input.workingDirectory)}/`;
  if (!workingDirectory.startsWith(root)) {
    throw new Error("skill_command_working_directory_forbidden");
  }
}

export function redactCommandOutput(value: string, secretValues: string[]): string {
  return secretValues
    .filter((secret) => secret.length > 0)
    .reduce((current, secret) => current.split(secret).join("[redacted]"), value);
}

export function summarizeCommandOutput(
  stdout: string,
  stderr: string,
  secretValues: string[]
): string {
  const merged = [stdout, stderr].filter((value) => value.trim().length > 0).join("\n");
  const redacted = redactCommandOutput(merged, secretValues);
  if (redacted.length <= OUTPUT_SUMMARY_LIMIT) {
    return redacted;
  }
  return `${redacted.slice(0, OUTPUT_SUMMARY_LIMIT)}...`;
}

export function createArtifactTemplateVariables(input: {
  workspace?: CommandWorkspace;
  pageVersionId?: string;
}): CommandTemplateVariables {
  if (!input.workspace || !input.pageVersionId) {
    return {};
  }
  return {
    pageVersionId: input.pageVersionId,
    artifactDir: input.workspace.artifactDir,
    "artifact.indexHtmlPath": input.workspace.indexHtmlPath,
    "artifact.stylesCssPath": input.workspace.stylesCssPath,
    "artifact.scriptJsPath": input.workspace.scriptJsPath
  };
}
```

- [ ] **Step 6: Run helper tests and API typecheck**

Run:

```bash
pnpm --filter @lp-agent/api test -- src/skill-command-execution.test.ts
pnpm --filter @lp-agent/api typecheck
```

Expected: helper tests and typecheck pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add packages/api/package.json packages/api/src/tool-command-runner.ts packages/api/src/skill-command-execution.ts packages/api/src/skill-command-execution.test.ts
git commit -m "add skill command execution helpers"
```

---

### Task 4: Add API Service Command Execution Orchestration

**Files:**
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/services.test.ts`

- [ ] **Step 1: Add service tests for successful command execution**

In `packages/api/src/services.test.ts`, add these imports:

```ts
import type {
  ToolCommandRunner,
  ToolCommandRunInput,
  ToolCommandRunResult
} from "./tool-command-runner";
```

Add this test inside the existing `describe("demo workbench service", () => { ... })` block:

```ts
  it("executes an approved project-bound deployment skill command with sanitized events", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const runner = new RecordingToolCommandRunner({
      state: "completed",
      exitCode: 0,
      stdout: "published secret-token <!doctype html>",
      stderr: ""
    });
    const service = new DemoWorkbenchService({
      repositories,
      toolCommandRunner: runner,
      env: {
        STATIC_DEPLOY_TOKEN: "secret-token"
      },
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
    const pageVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });
    const draft = await service.createSkillDraft({
      manifestJson: JSON.stringify(deploymentSkillManifest()),
      content: "# Static deployment",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: draft.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });

    const result = await service.executeProjectSkillCommand({
      projectId: project.id,
      skillVersionId: published.id,
      commandId: "publish_static",
      pageVersionId: pageVersion.id,
      approvedByUserId: "user_1"
    });

    expect(result.run).toMatchObject({
      id: "run_skill_command_1",
      projectId: project.id,
      role: "deployer",
      state: "completed"
    });
    expect(result.observation).toMatchObject({
      id: "tool_observation_1",
      runId: "run_skill_command_1",
      projectId: project.id,
      toolName: "skill:skill_static_deploy:publish_static",
      state: "completed",
      exitCode: 0
    });
    expect(runner.inputs).toHaveLength(1);
    expect(runner.inputs[0]).toMatchObject({
      runId: "run_skill_command_1",
      projectId: project.id,
      skillId: "skill_static_deploy",
      skillVersionId: published.id,
      commandId: "publish_static",
      command: "static-deploy",
      env: {
        STATIC_DEPLOY_TOKEN: "secret-token",
        LP_PROJECT_ID: project.id
      },
      timeoutMs: 120000
    });
    expect(runner.inputs[0]?.args).toEqual([
      "--project",
      project.id,
      "--html",
      expect.stringMatching(/index\.html$/)
    ]);
    expect(runner.inputs[0]?.workingDirectory).toEqual(expect.stringMatching(/run_skill_command_1$/));

    const events = await repositories.runEvents.listForProject(project.id);
    expect(events.map((event) => event.type)).toContain("tool.started");
    expect(events.map((event) => event.type)).toContain("tool.completed");
    expect(events.map((event) => event.type)).toContain("run.completed");
    expect(JSON.stringify(events)).not.toContain("secret-token");
    expect(JSON.stringify(events)).not.toContain("<!doctype html>");
    expect(JSON.stringify(result.observation)).not.toContain("secret-token");
    expect(JSON.stringify(result.observation)).not.toContain("<!doctype html>");
  });
```

- [ ] **Step 2: Add service tests for runner failure**

Add this test in the same `describe` block:

```ts
  it("records failed observations and run events when a skill command runner fails", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const runner = new RecordingToolCommandRunner({
      state: "failed",
      exitCode: 2,
      stdout: "",
      stderr: "permission denied",
      errorName: "command_failed"
    });
    const service = new DemoWorkbenchService({
      repositories,
      toolCommandRunner: runner,
      env: {
        STATIC_DEPLOY_TOKEN: "secret-token"
      },
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const draft = await service.createSkillDraft({
      manifestJson: JSON.stringify(deploymentSkillManifest({ commands: [commandWithoutArtifacts()] })),
      content: "# Static deployment",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: draft.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });

    const result = await service.executeProjectSkillCommand({
      projectId: project.id,
      skillVersionId: published.id,
      commandId: "publish_static",
      approvedByUserId: "user_1"
    });

    expect(result.run.state).toBe("failed");
    expect(result.observation).toMatchObject({
      state: "failed",
      exitCode: 2,
      errorName: "command_failed",
      outputSummary: "permission denied"
    });
    await expect(repositories.runEvents.listForProject(project.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool.failed" }),
        expect.objectContaining({ type: "run.failed" })
      ])
    );
  });
```

- [ ] **Step 3: Add service tests for validation failures**

Add this test in the same `describe` block:

```ts
  it("rejects invalid skill command execution requests before invoking the runner", async () => {
    const runner = new RecordingToolCommandRunner({
      state: "completed",
      exitCode: 0,
      stdout: "ok",
      stderr: ""
    });
    const service = new DemoWorkbenchService({
      toolCommandRunner: runner,
      env: {
        STATIC_DEPLOY_TOKEN: "secret-token"
      },
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const draft = await service.createSkillDraft({
      manifestJson: JSON.stringify(deploymentSkillManifest()),
      content: "# Static deployment",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: draft.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });

    await expect(
      service.executeProjectSkillCommand({
        projectId: project.id,
        skillVersionId: published.id,
        commandId: "publish_static",
        approvedByUserId: "user_1"
      })
    ).rejects.toThrow("skill_command_not_bound");

    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });

    await expect(
      service.executeProjectSkillCommand({
        projectId: project.id,
        skillVersionId: published.id,
        commandId: "missing",
        approvedByUserId: "user_1"
      })
    ).rejects.toThrow("skill_command_not_found");

    await expect(
      service.executeProjectSkillCommand({
        projectId: project.id,
        skillVersionId: published.id,
        commandId: "publish_static",
        approvedByUserId: " "
      })
    ).rejects.toThrow("skill_command_approval_required");

    expect(runner.inputs).toEqual([]);
  });
```

Add this test for permission, secret, and template validation:

```ts
  it("rejects missing permissions, undeclared secrets, and unknown templates before runner invocation", async () => {
    const runner = new RecordingToolCommandRunner({
      state: "completed",
      exitCode: 0,
      stdout: "ok",
      stderr: ""
    });

    const missingPermissionService = new DemoWorkbenchService({
      toolCommandRunner: runner,
      env: { STATIC_DEPLOY_TOKEN: "secret-token" },
      now: fixedClock()
    });
    const missingPermissionProject = await missingPermissionService.createProject({
      name: "Missing permission"
    });
    const missingPermissionDraft = await missingPermissionService.createSkillDraft({
      manifestJson: JSON.stringify(
        deploymentSkillManifest({
          permissions: ["artifact:read"]
        })
      ),
      content: "# Static deployment",
      contentType: "text/markdown"
    });
    await missingPermissionService.validateSkillVersion({
      skillVersionId: missingPermissionDraft.version.id
    });
    const missingPermissionPublished = await missingPermissionService.publishSkillVersion({
      skillVersionId: missingPermissionDraft.version.id
    });
    await missingPermissionService.bindSkillVersionToProject({
      projectId: missingPermissionProject.id,
      skillVersionId: missingPermissionPublished.id
    });
    await expect(
      missingPermissionService.executeProjectSkillCommand({
        projectId: missingPermissionProject.id,
        skillVersionId: missingPermissionPublished.id,
        commandId: "publish_static",
        approvedByUserId: "user_1"
      })
    ).rejects.toThrow("skill_command_permission_denied");

    const undeclaredSecretService = new DemoWorkbenchService({
      toolCommandRunner: runner,
      env: { STATIC_DEPLOY_TOKEN: "secret-token" },
      now: fixedClock()
    });
    const undeclaredSecretProject = await undeclaredSecretService.createProject({
      name: "Undeclared secret"
    });
    const undeclaredSecretDraft = await undeclaredSecretService.createSkillDraft({
      manifestJson: JSON.stringify(
        deploymentSkillManifest({
          requiredSecrets: []
        })
      ),
      content: "# Static deployment",
      contentType: "text/markdown"
    });
    await undeclaredSecretService.validateSkillVersion({
      skillVersionId: undeclaredSecretDraft.version.id
    });
    const undeclaredSecretPublished = await undeclaredSecretService.publishSkillVersion({
      skillVersionId: undeclaredSecretDraft.version.id
    });
    await undeclaredSecretService.bindSkillVersionToProject({
      projectId: undeclaredSecretProject.id,
      skillVersionId: undeclaredSecretPublished.id
    });
    await expect(
      undeclaredSecretService.executeProjectSkillCommand({
        projectId: undeclaredSecretProject.id,
        skillVersionId: undeclaredSecretPublished.id,
        commandId: "publish_static",
        approvedByUserId: "user_1"
      })
    ).rejects.toThrow("skill_command_secret_not_declared");

    const unknownTemplateService = new DemoWorkbenchService({
      toolCommandRunner: runner,
      env: { STATIC_DEPLOY_TOKEN: "secret-token" },
      now: fixedClock()
    });
    const unknownTemplateProject = await unknownTemplateService.createProject({
      name: "Unknown template"
    });
    const unknownTemplateDraft = await unknownTemplateService.createSkillDraft({
      manifestJson: JSON.stringify(
        deploymentSkillManifest({
          commands: [
            {
              ...commandWithoutArtifacts(),
              args: ["{{unknown}}"]
            }
          ]
        })
      ),
      content: "# Static deployment",
      contentType: "text/markdown"
    });
    await unknownTemplateService.validateSkillVersion({
      skillVersionId: unknownTemplateDraft.version.id
    });
    const unknownTemplatePublished = await unknownTemplateService.publishSkillVersion({
      skillVersionId: unknownTemplateDraft.version.id
    });
    await unknownTemplateService.bindSkillVersionToProject({
      projectId: unknownTemplateProject.id,
      skillVersionId: unknownTemplatePublished.id
    });
    await expect(
      unknownTemplateService.executeProjectSkillCommand({
        projectId: unknownTemplateProject.id,
        skillVersionId: unknownTemplatePublished.id,
        commandId: "publish_static",
        approvedByUserId: "user_1"
      })
    ).rejects.toThrow("skill_command_unknown_template_variable");

    expect(runner.inputs).toEqual([]);
  });
```

- [ ] **Step 4: Add test helpers**

At the bottom of `packages/api/src/services.test.ts`, after `RecordingDeploymentAdapter`, add:

```ts
class RecordingToolCommandRunner implements ToolCommandRunner {
  readonly inputs: ToolCommandRunInput[] = [];

  constructor(private readonly result: ToolCommandRunResult) {}

  async run(input: ToolCommandRunInput): Promise<ToolCommandRunResult> {
    this.inputs.push({
      ...input,
      args: [...input.args],
      env: { ...input.env }
    });
    return this.result;
  }
}
```

After `brandSkillManifest`, add:

```ts
function deploymentSkillManifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return brandSkillManifest({
    id: "skill_static_deploy",
    name: "Static deploy",
    type: "deployment",
    description: "Deploys static LP artifacts.",
    permissions: ["artifact:read", "deploy:static"],
    requiredSecrets: ["STATIC_DEPLOY_TOKEN"],
    entrypoints: ["skills/static-deploy.md"],
    reviewState: "published",
    commands: [
      {
        id: "publish_static",
        name: "Publish static artifacts",
        permission: "deploy:static",
        requiresApproval: true,
        command: "static-deploy",
        args: ["--project", "{{projectId}}", "--html", "{{artifact.indexHtmlPath}}"],
        env: [
          { name: "STATIC_DEPLOY_TOKEN", secretRef: "STATIC_DEPLOY_TOKEN" },
          { name: "LP_PROJECT_ID", value: "{{projectId}}" }
        ],
        workingDirectory: "{{artifactDir}}",
        timeoutMs: 120000
      }
    ],
    ...overrides
  });
}

function commandWithoutArtifacts(): NonNullable<SkillManifest["commands"]>[number] {
  return {
    id: "publish_static",
    name: "Publish static artifacts",
    permission: "deploy:static",
    requiresApproval: true,
    command: "static-deploy",
    args: ["--project", "{{projectId}}"],
    env: [
      { name: "STATIC_DEPLOY_TOKEN", secretRef: "STATIC_DEPLOY_TOKEN" },
      { name: "LP_PROJECT_ID", value: "{{projectId}}" }
    ],
    timeoutMs: 120000
  };
}
```

- [ ] **Step 5: Run the failing service tests**

Run:

```bash
pnpm --filter @lp-agent/api test -- src/services.test.ts
```

Expected: TypeScript/Vitest fails because `toolCommandRunner`, `executeProjectSkillCommand`, and runner exports do not exist.

- [ ] **Step 6: Add API input/result types and imports**

In `packages/api/src/index.ts`, add these imports:

```ts
import {
  cleanupCommandWorkspace,
  createArtifactTemplateVariables,
  assertWorkingDirectoryAllowed,
  materializeStaticArtifactsCommandWorkspace,
  resolveCommandTemplate,
  resolveSkillCommandEnvironment,
  resolveSkillCommandTimeout,
  summarizeCommandOutput,
  type CommandTemplateVariables,
  type CommandWorkspace
} from "./skill-command-execution";
import {
  RejectingToolCommandRunner,
  type ToolCommandRunner
} from "./tool-command-runner";
```

Add these interfaces near the other service input/result interfaces:

```ts
export interface ExecuteProjectSkillCommandInput {
  projectId: string;
  skillVersionId: string;
  commandId: string;
  pageVersionId?: string;
  approvedByUserId: string;
}

export interface SkillCommandExecutionResult {
  run: RunRecord;
  observation: ToolObservationRecord;
}
```

- [ ] **Step 7: Store env and runner dependencies in the service**

Extend `DemoWorkbenchServiceOptions`:

```ts
  toolCommandRunner?: ToolCommandRunner;
```

Add private fields to `DemoWorkbenchService`:

```ts
  private readonly toolCommandRunner: ToolCommandRunner;
  private readonly env: RuntimeEnvironment;
```

In the constructor, after `const env = options.env ?? getProcessEnv();`, assign:

```ts
    this.env = env;
```

After the deployment adapter assignment, assign:

```ts
    this.toolCommandRunner = options.toolCommandRunner ?? new RejectingToolCommandRunner();
```

- [ ] **Step 8: Implement `executeProjectSkillCommand`**

Add this method after `approveAndCreateDeployment` in `DemoWorkbenchService`:

```ts
  async executeProjectSkillCommand(
    input: ExecuteProjectSkillCommandInput
  ): Promise<SkillCommandExecutionResult> {
    await this.getProjectOrThrow(input.projectId);
    if (input.approvedByUserId.trim().length === 0) {
      throw new Error("skill_command_approval_required");
    }

    const version = await this.getSkillVersionOrThrow(input.skillVersionId);
    const binding = (await this.repositories.skillBindings.listForProject(input.projectId)).find(
      (candidate) =>
        isProjectSkillBindingForProject(candidate, input.projectId) &&
        candidate.skillVersionId === input.skillVersionId &&
        candidate.enabled
    );
    if (!binding) {
      throw new Error("skill_command_not_bound");
    }
    if (version.manifest.type !== "deployment") {
      throw new Error("skill_command_not_deployment");
    }
    if (version.reviewState !== "published" || version.manifest.reviewState !== "published") {
      throw new Error("skill_command_not_published");
    }

    const command = (version.manifest.commands ?? []).find(
      (candidate) => candidate.id === input.commandId
    );
    if (!command) {
      throw new Error("skill_command_not_found");
    }
    if (!version.manifest.permissions.includes(command.permission)) {
      throw new Error("skill_command_permission_denied");
    }

    const pageVersion = input.pageVersionId
      ? await this.getPageVersionForProjectOrThrow(input.projectId, input.pageVersionId).catch(() => {
          throw new Error("skill_command_page_version_not_found");
        })
      : undefined;

    const runId = await reserveRepositoryId(this.repositories, "run_skill_command", async () => {
      const runs = await this.repositories.runs.listAll();
      return runs.map((record) => record.id);
    });
    let workspace: CommandWorkspace | undefined;
    try {
      workspace = pageVersion
        ? await materializeStaticArtifactsCommandWorkspace({
            runId,
            artifacts: pageVersion.artifacts
          })
        : undefined;
      const variables: CommandTemplateVariables = {
        projectId: input.projectId,
        skillId: version.skillId,
        skillVersionId: version.id,
        commandId: command.id,
        runId,
        ...createArtifactTemplateVariables({
          workspace,
          pageVersionId: pageVersion?.id
        })
      };
      const args = command.args.map((arg) => resolveCommandTemplate(arg, variables));
      const env = resolveSkillCommandEnvironment({
        manifest: version.manifest,
        command,
        runtimeEnv: this.env,
        variables
      });
      const workingDirectory = command.workingDirectory
        ? resolveCommandTemplate(command.workingDirectory, variables)
        : workspace?.artifactDir;
      assertWorkingDirectoryAllowed({ workingDirectory, workspace });

      const startedAt = this.timestamp();
      const run: RunRecord = {
        id: runId,
        projectId: input.projectId,
        role: "deployer",
        state: "running",
        startedAt,
        contextSummary: {
          injected: [`skillCommand:${version.skillId}:${command.id}`],
          omitted: []
        }
      };
      await this.repositories.runs.save(run);

      let sequence = 0;
      const saveEvent = async (
        type: string,
        message: string,
        payload: Record<string, unknown>
      ) => {
        sequence += 1;
        await this.repositories.runEvents.save({
          id: `${runId}_event_${sequence}`,
          runId,
          projectId: input.projectId,
          sequence,
          type,
          message,
          payload,
          createdAt: this.timestamp()
        });
      };
      const safePayload = {
        skillId: version.skillId,
        skillVersionId: version.id,
        commandId: command.id,
        permission: command.permission,
        approvedByUserId: input.approvedByUserId
      };
      await saveEvent("run.started", "skill command run started", {
        role: "deployer",
        ...safePayload
      });
      await saveEvent("tool.started", "skill command started", safePayload);

      const runnerResult = await this.toolCommandRunner.run({
        runId,
        projectId: input.projectId,
        skillId: version.skillId,
        skillVersionId: version.id,
        commandId: command.id,
        command: command.command,
        args,
        env,
        workingDirectory,
        timeoutMs: resolveSkillCommandTimeout(command)
      });

      const completedAt = this.timestamp();
      const observationId = await reserveRepositoryId(
        this.repositories,
        "tool_observation",
        async () => {
          const observations = await this.repositories.toolObservations.listAll();
          return observations.map((record) => record.id);
        }
      );
      const secretValues = Object.values(env).filter((value) =>
        (command.env ?? []).some((binding) => binding.secretRef && env[binding.name] === value)
      );
      const observation: ToolObservationRecord = {
        id: observationId,
        runId,
        projectId: input.projectId,
        toolName: `skill:${version.skillId}:${command.id}`,
        input: {
          skillId: version.skillId,
          skillVersionId: version.id,
          commandId: command.id,
          permission: command.permission,
          approvedByUserId: input.approvedByUserId,
          pageVersionId: pageVersion?.id,
          argCount: args.length,
          envNames: Object.keys(env).sort()
        },
        outputSummary: summarizeCommandOutput(
          runnerResult.stdout,
          runnerResult.stderr,
          secretValues
        ),
        state: runnerResult.state,
        exitCode: runnerResult.exitCode,
        errorName: runnerResult.errorName,
        createdAt: startedAt,
        completedAt
      };
      await this.repositories.toolObservations.save(observation);
      releaseRepositoryId(this.repositories, observationId);

      await saveEvent(
        runnerResult.state === "completed" ? "tool.completed" : "tool.failed",
        runnerResult.state === "completed" ? "skill command completed" : "skill command failed",
        {
          ...safePayload,
          observationId,
          exitCode: runnerResult.exitCode,
          errorName: runnerResult.errorName
        }
      );

      const completedRun: RunRecord = {
        ...run,
        state: runnerResult.state === "completed" ? "completed" : "failed",
        completedAt
      };
      await this.repositories.runs.save(completedRun);
      await saveEvent(
        completedRun.state === "completed" ? "run.completed" : "run.failed",
        completedRun.state === "completed"
          ? "skill command run completed"
          : "skill command run failed",
        {
          role: "deployer",
          state: completedRun.state,
          ...safePayload,
          observationId,
          errorName: runnerResult.errorName
        }
      );

      return {
        run: copyRunRecord(completedRun),
        observation: copyToolObservationRecord(observation)
      };
    } finally {
      releaseRepositoryId(this.repositories, runId);
      if (workspace) {
        await cleanupCommandWorkspace(workspace);
      }
    }
  }
```

- [ ] **Step 9: Add service copy helpers**

Near the other copy helpers in `packages/api/src/index.ts`, add:

```ts
function copyRunRecord(run: RunRecord): RunRecord {
  return {
    ...run,
    contextSummary: {
      injected: [...run.contextSummary.injected],
      omitted: [...run.contextSummary.omitted]
    }
  };
}

function copyToolObservationRecord(observation: ToolObservationRecord): ToolObservationRecord {
  return {
    ...observation,
    input: structuredClone(observation.input)
  };
}
```

Update `copySkillManifest` to preserve command arrays:

```ts
function copySkillManifest(manifest: SkillManifest): SkillManifest {
  return {
    ...manifest,
    permissions: [...manifest.permissions],
    requiredSecrets: [...manifest.requiredSecrets],
    entrypoints: [...manifest.entrypoints],
    commands: manifest.commands?.map((command) => ({
      ...command,
      args: [...command.args],
      env: command.env?.map((binding) => ({ ...binding }))
    }))
  };
}
```

- [ ] **Step 10: Export runner contracts**

Add this export block near the existing `run-orchestrator` export block in `packages/api/src/index.ts`:

```ts
export {
  RejectingToolCommandRunner,
  type ToolCommandRunner,
  type ToolCommandRunInput,
  type ToolCommandRunResult
} from "./tool-command-runner";
```

- [ ] **Step 11: Run the API tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/api test -- src/skill-command-execution.test.ts src/services.test.ts
pnpm --filter @lp-agent/api typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 12: Commit**

Run:

```bash
git add packages/api/src/index.ts packages/api/src/services.test.ts
git commit -m "execute approved deployment skill commands"
```

---

### Task 5: Add Focused Negative Coverage for Skill Command Execution

**Files:**
- Modify: `packages/api/src/services.test.ts`

- [ ] **Step 1: Add non-deployment and unpublished-skill rejection tests**

Append these tests inside `describe("demo workbench service", () => { ... })`:

```ts
  it("rejects command execution for non-deployment skills", async () => {
    const runner = new RecordingToolCommandRunner({
      state: "completed",
      exitCode: 0,
      stdout: "ok",
      stderr: ""
    });
    const service = new DemoWorkbenchService({
      toolCommandRunner: runner,
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const draft = await service.createSkillDraft({
      manifestJson: JSON.stringify(
        brandSkillManifest({
          commands: [commandWithoutArtifacts()]
        })
      ),
      content: "# Template skill",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: draft.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: published.id
    });

    await expect(
      service.executeProjectSkillCommand({
        projectId: project.id,
        skillVersionId: published.id,
        commandId: "publish_static",
        approvedByUserId: "user_1"
      })
    ).rejects.toThrow("skill_command_not_deployment");
    expect(runner.inputs).toEqual([]);
  });

  it("rejects command execution for unpublished deployment skills", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const runner = new RecordingToolCommandRunner({
      state: "completed",
      exitCode: 0,
      stdout: "ok",
      stderr: ""
    });
    const service = new DemoWorkbenchService({
      repositories,
      toolCommandRunner: runner,
      env: { STATIC_DEPLOY_TOKEN: "secret-token" },
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project" });
    const draft = await service.createSkillDraft({
      manifestJson: JSON.stringify(deploymentSkillManifest()),
      content: "# Static deployment",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: draft.version.id });
    const validated = await repositories.skillVersions.getById(draft.version.id);
    if (!validated) {
      throw new Error("Expected validated skill version.");
    }
    await repositories.skillVersions.save({
      ...validated,
      reviewState: "published",
      manifest: {
        ...validated.manifest,
        reviewState: "published"
      }
    });
    await service.bindSkillVersionToProject({
      projectId: project.id,
      skillVersionId: draft.version.id
    });
    await repositories.skillVersions.save({
      ...validated,
      reviewState: "validated",
      manifest: {
        ...validated.manifest,
        reviewState: "validated"
      }
    });

    await expect(
      service.executeProjectSkillCommand({
        projectId: project.id,
        skillVersionId: draft.version.id,
        commandId: "publish_static",
        approvedByUserId: "user_1"
      })
    ).rejects.toThrow("skill_command_not_published");
    expect(runner.inputs).toEqual([]);
  });
```

- [ ] **Step 2: Add page-version ownership rejection test**

Append this test:

```ts
  it("rejects command execution when the page version belongs to another project", async () => {
    const runner = new RecordingToolCommandRunner({
      state: "completed",
      exitCode: 0,
      stdout: "ok",
      stderr: ""
    });
    const service = new DemoWorkbenchService({
      toolCommandRunner: runner,
      env: { STATIC_DEPLOY_TOKEN: "secret-token" },
      now: fixedClock()
    });
    const firstProject = await service.createProject({ name: "First" });
    const secondProject = await service.createProject({ name: "Second" });
    const brief = await service.createBriefFromPrompt({
      projectId: secondProject.id,
      prompt: "Prompt"
    });
    const secondProjectVersion = await service.generatePageVersion({
      projectId: secondProject.id,
      briefId: brief.id
    });
    const draft = await service.createSkillDraft({
      manifestJson: JSON.stringify(deploymentSkillManifest()),
      content: "# Static deployment",
      contentType: "text/markdown"
    });
    await service.validateSkillVersion({ skillVersionId: draft.version.id });
    const published = await service.publishSkillVersion({ skillVersionId: draft.version.id });
    await service.bindSkillVersionToProject({
      projectId: firstProject.id,
      skillVersionId: published.id
    });

    await expect(
      service.executeProjectSkillCommand({
        projectId: firstProject.id,
        skillVersionId: published.id,
        commandId: "publish_static",
        pageVersionId: secondProjectVersion.id,
        approvedByUserId: "user_1"
      })
    ).rejects.toThrow("skill_command_page_version_not_found");
    expect(runner.inputs).toEqual([]);
  });
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
pnpm --filter @lp-agent/api test -- src/services.test.ts
```

Expected: the new tests pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add packages/api/src/services.test.ts
git commit -m "cover skill command validation failures"
```

---

### Task 6: Update Documentation and Run Full Verification

**Files:**
- Modify: `docs/superpowers/README.md`
- Modify: `docs/agent-development-learning.md`

- [ ] **Step 1: Update Superpowers reading order**

In `docs/superpowers/README.md`, insert this entry after the current `34. specs/2026-05-14-skill-command-execution-design.md` entry:

```md
35. `plans/2026-05-14-skill-command-execution.md`
   - Stage 4 skill command execution implementation plan.
   - Read this after the skill command execution design when implementing controlled deployment skill command manifests, one-shot approval validation, command runner adapters, sanitized tool observations, and tool run events.
```

- [ ] **Step 2: Update Agent learning notes**

In `docs/agent-development-learning.md`, in the Stage 4 “下一步 Skill Command 执行 MVP 设计” list, add this bullet after the spec link:

```md
- 当前实现计划：[2026-05-14-skill-command-execution.md](./superpowers/plans/2026-05-14-skill-command-execution.md)
```

After the existing paragraph ending with “给未来部署 workflow 提供安全、可审计的 skill cmd 执行入口。”, add:

```md
- 实现时要把“能执行命令”和“安全边界”分开看：manifest 只声明允许执行什么，API 负责校验绑定、发布状态、审批、权限、secret reference、模板变量和 page version 归属，runner 只拿到已经解析好的 argv/env/workingDirectory。
- 这一步会先形成 `ToolCommandRunner`、`ToolObservationRecord`、`tool.started/tool.completed/tool.failed` 的最小闭环，再逐步扩展到 MCP execution、worker 队列、流式日志、cancel/retry 和部署编排。
```

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm --filter @lp-agent/db db:validate
```

Expected: all tests pass, all packages typecheck, and Prisma validates. If Prisma validation hits a sandbox-only cache permission error, rerun only the Prisma validation command with user-approved escalation.

- [ ] **Step 4: Inspect git status**

Run:

```bash
git status --short
```

Expected: only the documentation files from this task are unstaged. The two root-level untracked `.png` files, if still present, remain untracked and are not staged.

- [ ] **Step 5: Commit**

Run:

```bash
git add docs/superpowers/README.md docs/agent-development-learning.md
git commit -m "document skill command execution plan"
```

---

## Self-Review

- Spec coverage:
  - Manifest `commands`: Task 1.
  - One-shot approval and API execution boundary: Task 4.
  - Bound/published deployment skill checks: Tasks 4 and 5.
  - Permission, secretRef, template variable, and page-version checks: Tasks 3, 4, and 5.
  - `ToolCommandRunner` adapter: Task 3.
  - Artifact workspace materialization: Tasks 3 and 4.
  - Structured observations and event timeline: Tasks 2 and 4.
  - Sanitized stdout/stderr, secrets, and artifact content: Tasks 3 and 4.
  - Prisma/repository persistence: Task 2.
  - Documentation maintenance: Task 6.

- Placeholder scan:
  - No task relies on an unspecified implementation step.
  - Every code-bearing step includes concrete snippets and exact commands.

- Type consistency:
  - `SkillCommandManifest` lives in `@lp-agent/skills`.
  - `ToolCommandRunner` lives in `packages/api/src/tool-command-runner.ts`.
  - `ExecuteProjectSkillCommandInput` and `SkillCommandExecutionResult` are API service contracts.
  - `ToolObservationRecord` adds only optional primitive metadata, preserving existing repository callers.
