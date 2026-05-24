# Skills and Models Client-side Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the retained V1 Skills and Models Web management surfaces so local alpha users can understand lifecycle state, pending/success/error feedback, safe runtime metadata, and fail-closed provider routing without changing runtime contracts.

**Architecture:** Add a Web-only pure view-model in `apps/web/src/app/skills-models-management-view-model.ts` that derives display rows, summaries, notices, and safe diagnostics from existing repository-backed `ProjectSkillState`, `ProjectSkillCommandView`, and `WebProjectModelState`. Server actions keep all authorization and validation on the server, then redirect with short notice codes; `page.tsx` renders the view-model and remains grounded in repository facts after `revalidatePath("/")`.

**Tech Stack:** Next.js App Router server actions, React server component rendering, TypeScript pure helpers, existing Web i18n, Vitest, Playwright, pnpm workspace scripts.

---

## Scope Boundaries

Implement the approved Stage 44 spec:

- Skills: clearer draft / validated / published / bound / enabled lifecycle, safe runtime summary, pending/success/error affordance, command approval/queue hierarchy.
- Models: clearer provider config, enabled/disabled state, role route assignment, resolved runtime route summary, deterministic fallback and fail-closed diagnostics.
- Browser state is only an affordance. Repository facts remain the source of truth.
- Keep MCP management hidden and keep `/?view=mcp` safe fallback behavior.

Do not implement:

- MCP client-side management.
- Provider marketplace, billing/quota/cost ledger, automatic fallback provider execution, or team-level model approval.
- Runtime schema, Context Pack, model gateway, skill command runner, worker queue, or repository schema changes.
- Real provider key storage or secret display.

## File Structure

- Modify `apps/web/src/lib/i18n.ts`: add localized management copy, notices, pending labels, safe summaries, status labels, and diagnostics under existing `skillsView` and `modelsView`.
- Modify `apps/web/src/lib/i18n.test.ts`: assert new copy exists in English and Chinese.
- Create `apps/web/src/app/skills-models-management-view-model.ts`: pure derivation for Skills / Models rows, notices, summaries, and safe metadata.
- Create `apps/web/src/app/skills-models-management-view-model.test.ts`: unit tests for lifecycle derivation, role route status, notices, and non-leakage.
- Modify `apps/web/src/app/actions.ts`: redirect successful Skills / Models actions with `skillNotice` / `modelNotice`.
- Modify `apps/web/src/app/actions.test.ts`: assert notice redirects and unchanged error redirects.
- Modify `apps/web/src/app/page.tsx`: parse notice codes, build view models, render grouped Skills / Models UI, and keep current forms wired to existing server actions.
- Modify `apps/web/src/app/page.test.ts`: assert grouped UI, notices, safe summaries, action forms, and non-leakage.
- Modify `apps/web/src/app/globals.css`: style management summaries, lifecycle rows, notice banners, pending affordance, and route diagnostics.
- Modify `apps/web/e2e/helpers.ts`: add Skills / Models management helper flows.
- Add `apps/web/e2e/alpha-skills-models-management.spec.ts`: deterministic browser coverage for Stage 44 happy paths and non-leakage.
- Modify `docs/web-v1-acceptance.md`: add manual Stage 44 checks.
- Modify `docs/alpha-release-candidate.md`: update follow-up routing once Stage 44 is implemented.
- Modify `docs/project-roadmap.md`: mark Stage 44 complete, Stage 45 current, and keep Stage 46 plus a follow-up queue.
- Modify `docs/superpowers/README.md`: add this plan and mark current status.
- Modify `docs/agent-development-learning.md`: add the Stage 44 plan link and implementation status.

## Task 1: Localized Management Copy

**Files:**
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`

- [ ] **Step 1: Write failing i18n tests**

Add assertions inside `apps/web/src/lib/i18n.test.ts` near the existing Skills / Models copy tests:

```ts
it("has localized skills and models management copy", () => {
  const en = getWorkbenchCopy("en");
  const zh = getWorkbenchCopy("zh");

  expect(en.skillsView.management.runtimeSummaryTitle).toBe("Runtime context");
  expect(en.skillsView.management.notices.draft_created).toBe("Skill draft saved.");
  expect(en.skillsView.management.pending.createDraft).toBe("Saving draft...");
  expect(en.skillsView.management.lifecycleStages.enabled).toBe("Enabled");
  expect(en.skillsView.management.policyItems.join(" ")).toContain("Published and enabled");
  expect(zh.skillsView.management.runtimeSummaryTitle).toBe("运行上下文");
  expect(zh.skillsView.management.notices.command_queued).toBe("技能命令已入队。");

  expect(en.modelsView.management.projectSummaryTitle).toBe("Project model summary");
  expect(en.modelsView.management.notices.provider_created).toBe("Model provider saved.");
  expect(en.modelsView.management.routeStates.failClosed).toBe("Fail closed");
  expect(en.modelsView.management.safeMetadataNote).toContain("Secret values are never shown");
  expect(zh.modelsView.management.projectSummaryTitle).toBe("项目模型摘要");
  expect(zh.modelsView.management.notices.route_saved).toBe("模型路由已保存。");
});
```

- [ ] **Step 2: Run the i18n test to verify it fails**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts
```

Expected: FAIL with missing `management` properties on `skillsView` / `modelsView`.

- [ ] **Step 3: Extend the `WorkbenchCopy` interface**

In `apps/web/src/lib/i18n.ts`, extend `skillsView` with:

```ts
    management: {
      runtimeSummaryTitle: string;
      lifecycleTitle: string;
      createPolicyTitle: string;
      versionsSummaryTitle: string;
      bindingSummaryTitle: string;
      commandSummaryTitle: string;
      noRawContentNotice: string;
      runtimeSummary: (activeCount: number, commandCount: number) => string;
      lifecycleStages: Record<
        "draft" | "validated" | "published" | "bound" | "enabled" | "disabled",
        string
      >;
      nextActions: Record<
        "validate" | "publish" | "bind" | "enable" | "disable" | "none",
        string
      >;
      notices: Record<
        | "draft_created"
        | "validated"
        | "published"
        | "bound"
        | "enabled"
        | "disabled"
        | "command_queued"
        | "worker_ran",
        string
      >;
      pending: Record<
        | "createDraft"
        | "validate"
        | "publish"
        | "bind"
        | "enable"
        | "disable"
        | "queueCommand"
        | "runWorker",
        string
      >;
      policyItems: string[];
    };
```

Extend `modelsView` with:

```ts
    management: {
      projectSummaryTitle: string;
      providerSummaryTitle: string;
      routeSummaryTitle: string;
      resolvedSummaryTitle: string;
      safeMetadataNote: string;
      optInRuntimeNote: string;
      providerCount: (enabledCount: number, totalCount: number) => string;
      routeCount: (configuredCount: number, totalCount: number) => string;
      notices: Record<
        "provider_created" | "provider_enabled" | "provider_disabled" | "route_saved",
        string
      >;
      pending: Record<"createProvider" | "enable" | "disable" | "saveRoute", string>;
      providerStates: Record<"enabled" | "disabled", string>;
      routeStates: Record<"configured" | "fallback" | "failClosed", string>;
      metadataStates: Record<"configured" | "notConfigured", string>;
    };
```

- [ ] **Step 4: Add English copy**

In the English `skillsView` object, after `workerErrors`, add:

```ts
      management: {
        runtimeSummaryTitle: "Runtime context",
        lifecycleTitle: "Skill lifecycle",
        createPolicyTitle: "Draft input policy",
        versionsSummaryTitle: "Versions",
        bindingSummaryTitle: "Project bindings",
        commandSummaryTitle: "Deployment commands",
        noRawContentNotice: "Saved skill content is not echoed on this page.",
        runtimeSummary: (activeCount, commandCount) =>
          `${activeCount} active context ${activeCount === 1 ? "skill" : "skills"} · ${commandCount} queueable ${commandCount === 1 ? "command" : "commands"}`,
        lifecycleStages: {
          draft: "Draft",
          validated: "Validated",
          published: "Published",
          bound: "Bound",
          enabled: "Enabled",
          disabled: "Disabled"
        },
        nextActions: {
          validate: "Validate next",
          publish: "Publish next",
          bind: "Bind to project next",
          enable: "Enable for runtime",
          disable: "Disable from runtime",
          none: "No action available"
        },
        notices: {
          draft_created: "Skill draft saved.",
          validated: "Skill validated.",
          published: "Skill published.",
          bound: "Skill bound to the project.",
          enabled: "Skill enabled for runtime context.",
          disabled: "Skill disabled from runtime context.",
          command_queued: "Skill command queued.",
          worker_ran: "Local worker run completed."
        },
        pending: {
          createDraft: "Saving draft...",
          validate: "Validating...",
          publish: "Publishing...",
          bind: "Binding...",
          enable: "Enabling...",
          disable: "Disabling...",
          queueCommand: "Queuing...",
          runWorker: "Running worker..."
        },
        policyItems: [
          "Project-scoped manifest only.",
          "Markdown or plain text content under the local size cap.",
          "Published and enabled project-bound skills enter runtime context.",
          "Executable content and raw skill text are not shown after save."
        ]
      }
```

In the English `modelsView` object, after `errors`, add:

```ts
      management: {
        projectSummaryTitle: "Project model summary",
        providerSummaryTitle: "Provider configuration",
        routeSummaryTitle: "Role routing",
        resolvedSummaryTitle: "Resolved runtime routes",
        safeMetadataNote: "Secret values are never shown. The page stores provider metadata and environment variable names only.",
        optInRuntimeNote: "Real provider calls still require REAL_MODEL_RUNTIME=1 and configured environment variables.",
        providerCount: (enabledCount, totalCount) =>
          `${enabledCount} enabled of ${totalCount} ${totalCount === 1 ? "provider" : "providers"}`,
        routeCount: (configuredCount, totalCount) =>
          `${configuredCount} configured of ${totalCount} ${totalCount === 1 ? "route" : "routes"}`,
        notices: {
          provider_created: "Model provider saved.",
          provider_enabled: "Model provider enabled.",
          provider_disabled: "Model provider disabled.",
          route_saved: "Model route saved."
        },
        pending: {
          createProvider: "Saving provider...",
          enable: "Enabling...",
          disable: "Disabling...",
          saveRoute: "Saving route..."
        },
        providerStates: {
          enabled: "Enabled",
          disabled: "Disabled"
        },
        routeStates: {
          configured: "Configured",
          fallback: "Deterministic fallback",
          failClosed: "Fail closed"
        },
        metadataStates: {
          configured: "Configured",
          notConfigured: "Not configured"
        }
      }
```

- [ ] **Step 5: Add Chinese copy**

In the Chinese `skillsView` object, add the same `management` shape:

```ts
      management: {
        runtimeSummaryTitle: "运行上下文",
        lifecycleTitle: "技能生命周期",
        createPolicyTitle: "草稿输入规则",
        versionsSummaryTitle: "版本",
        bindingSummaryTitle: "项目绑定",
        commandSummaryTitle: "部署命令",
        noRawContentNotice: "已保存的技能正文不会在本页面回显。",
        runtimeSummary: (activeCount, commandCount) =>
          `${activeCount} 个启用上下文技能 · ${commandCount} 个可入队命令`,
        lifecycleStages: {
          draft: "草稿",
          validated: "已验证",
          published: "已发布",
          bound: "已绑定",
          enabled: "已启用",
          disabled: "已停用"
        },
        nextActions: {
          validate: "下一步验证",
          publish: "下一步发布",
          bind: "下一步绑定到项目",
          enable: "启用到运行上下文",
          disable: "从运行上下文停用",
          none: "暂无可用操作"
        },
        notices: {
          draft_created: "技能草稿已保存。",
          validated: "技能已验证。",
          published: "技能已发布。",
          bound: "技能已绑定到项目。",
          enabled: "技能已启用到运行上下文。",
          disabled: "技能已从运行上下文停用。",
          command_queued: "技能命令已入队。",
          worker_ran: "本地 Worker 运行已完成。"
        },
        pending: {
          createDraft: "正在保存草稿...",
          validate: "正在验证...",
          publish: "正在发布...",
          bind: "正在绑定...",
          enable: "正在启用...",
          disable: "正在停用...",
          queueCommand: "正在入队...",
          runWorker: "正在运行 Worker..."
        },
        policyItems: [
          "仅支持项目级 manifest。",
          "Markdown 或纯文本内容必须低于本地大小限制。",
          "已发布、已启用并绑定到项目的技能会进入运行上下文。",
          "可执行内容和技能正文保存后不会在页面回显。"
        ]
      }
```

In the Chinese `modelsView` object, add:

```ts
      management: {
        projectSummaryTitle: "项目模型摘要",
        providerSummaryTitle: "Provider 配置",
        routeSummaryTitle: "角色路由",
        resolvedSummaryTitle: "已解析运行路由",
        safeMetadataNote: "页面只保存 provider metadata 和环境变量名，不展示 secret 值。",
        optInRuntimeNote: "真实 provider 调用仍需要 REAL_MODEL_RUNTIME=1 和已配置的环境变量。",
        providerCount: (enabledCount, totalCount) =>
          `${totalCount} 个 provider 中 ${enabledCount} 个已启用`,
        routeCount: (configuredCount, totalCount) =>
          `${totalCount} 条路由中 ${configuredCount} 条已配置`,
        notices: {
          provider_created: "模型 provider 已保存。",
          provider_enabled: "模型 provider 已启用。",
          provider_disabled: "模型 provider 已停用。",
          route_saved: "模型路由已保存。"
        },
        pending: {
          createProvider: "正在保存 provider...",
          enable: "正在启用...",
          disable: "正在停用...",
          saveRoute: "正在保存路由..."
        },
        providerStates: {
          enabled: "已启用",
          disabled: "已停用"
        },
        routeStates: {
          configured: "已配置",
          fallback: "Deterministic fallback",
          failClosed: "Fail closed"
        },
        metadataStates: {
          configured: "已配置",
          notConfigured: "未配置"
        }
      }
```

- [ ] **Step 6: Run the i18n test to verify it passes**

Run:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/i18n.ts apps/web/src/lib/i18n.test.ts
git commit -m "add skills models management copy"
```

## Task 2: Pure Skills / Models Management View-model

**Files:**
- Create: `apps/web/src/app/skills-models-management-view-model.ts`
- Create: `apps/web/src/app/skills-models-management-view-model.test.ts`

- [ ] **Step 1: Write failing view-model tests**

Create `apps/web/src/app/skills-models-management-view-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getWorkbenchCopy } from "../lib/i18n";
import type { ProjectSkillCommandView, WebProjectModelState } from "../lib/workbench-store";
import {
  buildModelsManagementViewModel,
  buildSkillsManagementViewModel,
  modelManagementRoleOrder,
  toModelManagementNotice,
  toSkillManagementNotice
} from "./skills-models-management-view-model";

const copy = getWorkbenchCopy("en");

describe("skills management view model", () => {
  it("derives lifecycle rows, active runtime counts, and notice copy without raw skill content", () => {
    const model = buildSkillsManagementViewModel({
      copy,
      notice: "published",
      skillCommands: [
        {
          skillId: "skill_deploy",
          skillName: "Deploy",
          skillVersionId: "skill_version_deploy",
          commandId: "publish_static",
          commandName: "Publish static",
          permission: "deploy:simulate",
          requiresApproval: true
        }
      ],
      skillState: {
        availableVersions: [
          {
            id: "skill_version_draft",
            skillId: "skill_brand",
            version: "0.1.0",
            manifest: {
              id: "skill_brand",
              name: "Brand voice",
              version: "0.1.0",
              type: "template",
              scope: "project",
              description: "RAW_SKILL_SECRET should stay out",
              permissions: [],
              requiredSecrets: [],
              entrypoints: ["brand.md"],
              reviewState: "draft"
            },
            content: "RAW_SKILL_SECRET",
            contentType: "text/markdown",
            reviewState: "draft",
            createdAt: "2026-05-24T00:00:00.000Z"
          },
          {
            id: "skill_version_published",
            skillId: "skill_deploy",
            version: "1.0.0",
            manifest: {
              id: "skill_deploy",
              name: "Deploy",
              version: "1.0.0",
              type: "deployment",
              scope: "project",
              description: "Safe deployment metadata",
              permissions: ["deploy:simulate"],
              requiredSecrets: [],
              entrypoints: ["deploy.md"],
              reviewState: "published",
              commands: [
                {
                  id: "publish_static",
                  name: "Publish static",
                  permission: "deploy:simulate",
                  requiresApproval: true
                }
              ]
            },
            content: "RAW_DEPLOY_SECRET",
            contentType: "text/markdown",
            reviewState: "published",
            createdAt: "2026-05-24T00:01:00.000Z"
          }
        ],
        boundSkills: [
          {
            skill: {
              id: "skill_deploy",
              name: "Deploy",
              type: "deployment",
              scope: "project",
              createdAt: "2026-05-24T00:01:00.000Z"
            },
            version: {
              id: "skill_version_published",
              skillId: "skill_deploy",
              version: "1.0.0",
              manifest: {
                id: "skill_deploy",
                name: "Deploy",
                version: "1.0.0",
                type: "deployment",
                scope: "project",
                description: "Safe deployment metadata",
                permissions: ["deploy:simulate"],
                requiredSecrets: [],
                entrypoints: ["deploy.md"],
                reviewState: "published"
              },
              content: "RAW_DEPLOY_SECRET",
              contentType: "text/markdown",
              reviewState: "published",
              createdAt: "2026-05-24T00:01:00.000Z"
            },
            binding: {
              id: "binding_1",
              skillVersionId: "skill_version_published",
              scope: "project",
              targetKey: "project_1",
              projectId: "project_1",
              enabled: true,
              createdAt: "2026-05-24T00:02:00.000Z",
              updatedAt: "2026-05-24T00:02:00.000Z"
            }
          }
        ]
      }
    });

    expect(model.noticeMessage).toBe("Skill published.");
    expect(model.activeSkillCount).toBe(1);
    expect(model.commandCount).toBe(1);
    expect(model.versionRows.map((row) => [row.id, row.stage, row.nextAction])).toEqual([
      ["skill_version_draft", "draft", "validate"],
      ["skill_version_published", "enabled", "disable"]
    ]);
    expect(model.boundRows).toEqual([
      expect.objectContaining({
        bindingId: "binding_1",
        stage: "enabled",
        nextAction: "disable"
      })
    ]);
    expect(JSON.stringify(model)).not.toContain("RAW_SKILL_SECRET");
    expect(JSON.stringify(model)).not.toContain("RAW_DEPLOY_SECRET");
  });

  it("parses only allowlisted skill notice codes", () => {
    expect(toSkillManagementNotice("draft_created")).toBe("draft_created");
    expect(toSkillManagementNotice("RAW_SECRET")).toBeUndefined();
  });
});

describe("models management view model", () => {
  it("derives safe provider summaries and route states without leaking base URLs or secrets", () => {
    const state: WebProjectModelState = {
      providers: [
        {
          id: "provider_openai",
          scope: "project",
          targetKey: "project_1",
          name: "OpenAI",
          provider: "openai",
          config: {
            api: "openai-completions",
            baseUrl: "https://secret-provider.example.test/v1",
            apiKeyEnv: "OPENAI_API_KEY",
            models: [{ id: "gpt-5.4" }]
          },
          enabled: true,
          createdAt: "2026-05-24T00:00:00.000Z",
          updatedAt: "2026-05-24T00:00:00.000Z"
        },
        {
          id: "provider_disabled",
          scope: "project",
          targetKey: "project_1",
          name: "Disabled",
          provider: "custom",
          config: {
            api: "anthropic-messages",
            secretEnvName: "ANTHROPIC_API_KEY",
            models: [{ id: "claude-test" }]
          },
          enabled: false,
          createdAt: "2026-05-24T00:01:00.000Z",
          updatedAt: "2026-05-24T00:01:00.000Z"
        }
      ],
      routes: [
        {
          id: "route_planner",
          scope: "project",
          targetKey: "project_1",
          role: "planner",
          providerId: "provider_openai",
          model: "gpt-5.4",
          createdAt: "2026-05-24T00:02:00.000Z",
          updatedAt: "2026-05-24T00:02:00.000Z"
        }
      ],
      resolvedPolicy: {
        assistant: { provider: "mock-openai", model: "assistant-model" },
        planner: { provider: "provider_openai", model: "gpt-5.4" },
        builder: { provider: "mock-anthropic", model: "code-model" },
        reviewer: { provider: "mock-openai", model: "review-model" },
        deployer: { provider: "mock-local", model: "tool-model" }
      }
    };

    const model = buildModelsManagementViewModel({
      copy,
      modelState: state,
      notice: "route_saved"
    });

    expect(modelManagementRoleOrder).toEqual([
      "assistant",
      "planner",
      "builder",
      "reviewer",
      "deployer"
    ]);
    expect(model.noticeMessage).toBe("Model route saved.");
    expect(model.enabledProviderCount).toBe(1);
    expect(model.providerRows[0]).toEqual(
      expect.objectContaining({
        id: "provider_openai",
        apiLabel: "OpenAI Chat Completions compatible",
        baseUrlState: "Configured",
        secretState: "Configured",
        modelCount: 1,
        state: "enabled"
      })
    );
    expect(model.routeRows.find((row) => row.role === "planner")).toEqual(
      expect.objectContaining({
        state: "configured",
        providerId: "provider_openai",
        model: "gpt-5.4"
      })
    );
    expect(model.routeRows.find((row) => row.role === "builder")).toEqual(
      expect.objectContaining({
        state: "fallback",
        resolvedLabel: "mock-anthropic/code-model"
      })
    );
    expect(JSON.stringify(model)).not.toContain("secret-provider.example.test");
    expect(JSON.stringify(model)).not.toContain("OPENAI_API_KEY=");
  });

  it("marks routes that point at disabled or missing providers as fail closed", () => {
    const model = buildModelsManagementViewModel({
      copy,
      modelState: {
        providers: [
          {
            id: "provider_disabled",
            scope: "project",
            targetKey: "project_1",
            name: "Disabled",
            provider: "custom",
            config: { api: "openai-completions", models: [{ id: "gpt-5.4" }] },
            enabled: false,
            createdAt: "2026-05-24T00:00:00.000Z",
            updatedAt: "2026-05-24T00:00:00.000Z"
          }
        ],
        routes: [
          {
            id: "route_builder",
            scope: "project",
            targetKey: "project_1",
            role: "builder",
            providerId: "provider_disabled",
            model: "gpt-5.4",
            createdAt: "2026-05-24T00:01:00.000Z",
            updatedAt: "2026-05-24T00:01:00.000Z"
          },
          {
            id: "route_reviewer",
            scope: "project",
            targetKey: "project_1",
            role: "reviewer",
            providerId: "provider_missing",
            model: "review-model",
            createdAt: "2026-05-24T00:02:00.000Z",
            updatedAt: "2026-05-24T00:02:00.000Z"
          }
        ],
        resolvedPolicy: {
          assistant: { provider: "mock-openai", model: "assistant-model" },
          planner: { provider: "mock-openai", model: "planning-model" },
          builder: { provider: "mock-anthropic", model: "code-model" },
          reviewer: { provider: "mock-openai", model: "review-model" },
          deployer: { provider: "mock-local", model: "tool-model" }
        },
        resolutionError: "model_provider_disabled"
      }
    });

    expect(model.routeRows.find((row) => row.role === "builder")).toEqual(
      expect.objectContaining({ state: "failClosed", diagnosticCode: "model_provider_disabled" })
    );
    expect(model.routeRows.find((row) => row.role === "reviewer")).toEqual(
      expect.objectContaining({ state: "failClosed", diagnosticCode: "model_route_provider_invalid" })
    );
  });

  it("parses only allowlisted model notice codes", () => {
    expect(toModelManagementNotice("provider_created")).toBe("provider_created");
    expect(toModelManagementNotice("RAW_SECRET")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/app/skills-models-management-view-model.test.ts
```

Expected: FAIL because `apps/web/src/app/skills-models-management-view-model.ts` does not exist.

- [ ] **Step 3: Implement the pure view-model**

Create `apps/web/src/app/skills-models-management-view-model.ts`:

```ts
import type { AgentRole, ProjectSkillState } from "@lp-agent/api";
import type { WorkbenchCopy } from "../lib/i18n";
import type { ProjectSkillCommandView, WebProjectModelState } from "../lib/workbench-store";

export const skillManagementNoticeValues = [
  "draft_created",
  "validated",
  "published",
  "bound",
  "enabled",
  "disabled",
  "command_queued",
  "worker_ran"
] as const;

export type SkillManagementNotice = (typeof skillManagementNoticeValues)[number];

export const modelManagementNoticeValues = [
  "provider_created",
  "provider_enabled",
  "provider_disabled",
  "route_saved"
] as const;

export type ModelManagementNotice = (typeof modelManagementNoticeValues)[number];

export const modelManagementRoleOrder = [
  "assistant",
  "planner",
  "builder",
  "reviewer",
  "deployer"
] as const satisfies readonly AgentRole[];

export type SkillLifecycleStage =
  | "draft"
  | "validated"
  | "published"
  | "bound"
  | "enabled"
  | "disabled";

export type SkillNextAction = "validate" | "publish" | "bind" | "enable" | "disable" | "none";

export interface SkillManagementVersionRow {
  id: string;
  skillId: string;
  name: string;
  version: string;
  stage: SkillLifecycleStage;
  stageLabel: string;
  nextAction: SkillNextAction;
  nextActionLabel: string;
  bindingId?: string;
  enabled: boolean;
  type: string;
}

export interface SkillManagementCommandRow {
  key: string;
  skillName: string;
  commandName: string;
  permission: string;
  requiresApproval: boolean;
}

export interface SkillsManagementViewModel {
  noticeMessage?: string;
  activeSkillCount: number;
  commandCount: number;
  runtimeSummary: string;
  policyItems: string[];
  versionRows: SkillManagementVersionRow[];
  boundRows: SkillManagementVersionRow[];
  commandRows: SkillManagementCommandRow[];
}

export type ModelRouteState = "configured" | "fallback" | "failClosed";
export type ModelProviderState = "enabled" | "disabled";

export interface ModelManagementProviderRow {
  id: string;
  name: string;
  providerTypeLabel: string;
  apiLabel: string;
  baseUrlState: string;
  secretState: string;
  modelCount: number;
  state: ModelProviderState;
  stateLabel: string;
}

export interface ModelManagementRouteRow {
  role: AgentRole;
  roleLabel: string;
  state: ModelRouteState;
  stateLabel: string;
  providerId?: string;
  providerName?: string;
  model: string;
  resolvedLabel: string;
  diagnosticCode?: "model_provider_disabled" | "model_route_provider_invalid" | "model_id_required";
}

export interface ModelsManagementViewModel {
  noticeMessage?: string;
  enabledProviderCount: number;
  totalProviderCount: number;
  configuredRouteCount: number;
  totalRouteCount: number;
  providerSummary: string;
  routeSummary: string;
  providerRows: ModelManagementProviderRow[];
  routeRows: ModelManagementRouteRow[];
  safeMetadataNote: string;
  optInRuntimeNote: string;
}

export function toSkillManagementNotice(value?: string): SkillManagementNotice | undefined {
  return skillManagementNoticeValues.find((notice) => notice === value);
}

export function toModelManagementNotice(value?: string): ModelManagementNotice | undefined {
  return modelManagementNoticeValues.find((notice) => notice === value);
}

export function buildSkillsManagementViewModel(input: {
  copy: WorkbenchCopy;
  skillState: ProjectSkillState;
  skillCommands: ProjectSkillCommandView[];
  notice?: SkillManagementNotice;
}): SkillsManagementViewModel {
  const bindingByVersionId = new Map(
    input.skillState.boundSkills.map((boundSkill) => [
      boundSkill.version.id,
      boundSkill.binding
    ])
  );
  const activeSkillCount = input.skillState.boundSkills.filter(
    (boundSkill) =>
      boundSkill.binding.enabled &&
      boundSkill.version.reviewState === "published" &&
      boundSkill.version.manifest.reviewState === "published"
  ).length;

  const versionRows = input.skillState.availableVersions.map((version) => {
    const binding = bindingByVersionId.get(version.id);
    const stage = deriveSkillStage(version.reviewState, binding?.enabled);
    const nextAction = deriveSkillNextAction(version.reviewState, binding?.enabled, Boolean(binding));
    return {
      id: version.id,
      skillId: version.skillId,
      name: version.manifest.name,
      version: version.version,
      stage,
      stageLabel: input.copy.skillsView.management.lifecycleStages[stage],
      nextAction,
      nextActionLabel: input.copy.skillsView.management.nextActions[nextAction],
      ...(binding ? { bindingId: binding.id } : {}),
      enabled: binding?.enabled ?? false,
      type: version.manifest.type
    };
  });

  return {
    ...(input.notice
      ? { noticeMessage: input.copy.skillsView.management.notices[input.notice] }
      : {}),
    activeSkillCount,
    commandCount: input.skillCommands.length,
    runtimeSummary: input.copy.skillsView.management.runtimeSummary(
      activeSkillCount,
      input.skillCommands.length
    ),
    policyItems: [...input.copy.skillsView.management.policyItems],
    versionRows,
    boundRows: versionRows.filter((row) => Boolean(row.bindingId)),
    commandRows: input.skillCommands.map((command) => ({
      key: `${command.skillVersionId}:${command.commandId}`,
      skillName: command.skillName,
      commandName: command.commandName,
      permission: command.permission,
      requiresApproval: command.requiresApproval
    }))
  };
}

export function buildModelsManagementViewModel(input: {
  copy: WorkbenchCopy;
  modelState: WebProjectModelState;
  notice?: ModelManagementNotice;
}): ModelsManagementViewModel {
  const providerById = new Map(input.modelState.providers.map((provider) => [provider.id, provider]));
  const enabledProviderCount = input.modelState.providers.filter((provider) => provider.enabled).length;
  const configuredRouteCount = input.modelState.routes.filter((route) => route.model.trim().length > 0).length;

  return {
    ...(input.notice
      ? { noticeMessage: input.copy.modelsView.management.notices[input.notice] }
      : {}),
    enabledProviderCount,
    totalProviderCount: input.modelState.providers.length,
    configuredRouteCount,
    totalRouteCount: modelManagementRoleOrder.length,
    providerSummary: input.copy.modelsView.management.providerCount(
      enabledProviderCount,
      input.modelState.providers.length
    ),
    routeSummary: input.copy.modelsView.management.routeCount(
      configuredRouteCount,
      modelManagementRoleOrder.length
    ),
    providerRows: input.modelState.providers.map((provider) => {
      const api = provider.config.api ?? "mock";
      const state = provider.enabled ? "enabled" : "disabled";
      return {
        id: provider.id,
        name: provider.name,
        providerTypeLabel: input.copy.modelsView.providerTypes[provider.provider],
        apiLabel: input.copy.modelsView.providerApis[api],
        baseUrlState: provider.config.baseUrl
          ? input.copy.modelsView.management.metadataStates.configured
          : input.copy.modelsView.management.metadataStates.notConfigured,
        secretState: provider.config.apiKeyEnv || provider.config.secretEnvName
          ? input.copy.modelsView.management.metadataStates.configured
          : input.copy.modelsView.management.metadataStates.notConfigured,
        modelCount: provider.config.models?.length ?? 0,
        state,
        stateLabel: input.copy.modelsView.management.providerStates[state]
      };
    }),
    routeRows: modelManagementRoleOrder.map((role) => {
      const route = input.modelState.routes.find((candidate) => candidate.role === role);
      const resolved = input.modelState.resolvedPolicy[role];
      const provider = route ? providerById.get(route.providerId) : undefined;
      const diagnosticCode = deriveRouteDiagnostic(route, provider);
      const state: ModelRouteState = diagnosticCode ? "failClosed" : route ? "configured" : "fallback";
      return {
        role,
        roleLabel: input.copy.modelsView.roleLabels[role],
        state,
        stateLabel: input.copy.modelsView.management.routeStates[state],
        ...(route ? { providerId: route.providerId, model: route.model } : { model: resolved.model }),
        ...(provider ? { providerName: provider.name } : {}),
        resolvedLabel: `${resolved.provider}/${resolved.model}`,
        ...(diagnosticCode ? { diagnosticCode } : {})
      };
    }),
    safeMetadataNote: input.copy.modelsView.management.safeMetadataNote,
    optInRuntimeNote: input.copy.modelsView.management.optInRuntimeNote
  };
}

function deriveSkillStage(
  reviewState: string,
  bindingEnabled: boolean | undefined
): SkillLifecycleStage {
  if (bindingEnabled === true) {
    return "enabled";
  }
  if (bindingEnabled === false) {
    return "disabled";
  }
  if (reviewState === "draft" || reviewState === "validated" || reviewState === "published") {
    return reviewState;
  }
  return "published";
}

function deriveSkillNextAction(
  reviewState: string,
  bindingEnabled: boolean | undefined,
  isBound: boolean
): SkillNextAction {
  if (bindingEnabled === true) {
    return "disable";
  }
  if (bindingEnabled === false) {
    return "enable";
  }
  if (isBound) {
    return "none";
  }
  if (reviewState === "draft") {
    return "validate";
  }
  if (reviewState === "validated") {
    return "publish";
  }
  if (reviewState === "published") {
    return "bind";
  }
  return "none";
}

function deriveRouteDiagnostic(
  route: WebProjectModelState["routes"][number] | undefined,
  provider: WebProjectModelState["providers"][number] | undefined
): ModelManagementRouteRow["diagnosticCode"] {
  if (!route) {
    return undefined;
  }
  if (!provider) {
    return "model_route_provider_invalid";
  }
  if (!provider.enabled) {
    return "model_provider_disabled";
  }
  if (route.model.trim().length === 0) {
    return "model_id_required";
  }
  return undefined;
}
```

- [ ] **Step 4: Run the view-model test**

Run:

```bash
pnpm exec vitest run apps/web/src/app/skills-models-management-view-model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/skills-models-management-view-model.ts apps/web/src/app/skills-models-management-view-model.test.ts
git commit -m "derive skills models management views"
```

## Task 3: Server Action Success Notices

**Files:**
- Modify: `apps/web/src/app/actions.ts`
- Modify: `apps/web/src/app/actions.test.ts`

- [ ] **Step 1: Write failing action redirect tests**

In `apps/web/src/app/actions.test.ts`, update existing success redirect expectations:

```ts
await expectRedirect(createSkillDraftAction(formData), "/?view=skills&skillNotice=draft_created");
await expectRedirect(
  validateSkillVersionAction(buildSkillForm({ skillVersionId: "skill_version_1" })),
  "/?view=skills&skillNotice=validated"
);
await expectRedirect(
  publishSkillVersionAction(buildSkillForm({ skillVersionId: "skill_version_1" })),
  "/?view=skills&skillNotice=published"
);
await expectRedirect(
  bindSkillVersionAction(buildSkillForm({ projectId: "project_1", skillVersionId: "skill_version_1" })),
  "/?view=skills&skillNotice=bound"
);
await expectRedirect(executeSkillCommandAction(buildSkillCommandForm()), "/?view=skills&skillNotice=command_queued");
await expectRedirect(runLocalWorkerOnceAction(formData), "/?view=skills&skillNotice=worker_ran");
await expectRedirect(createModelProviderAction(formData), "/?view=models&modelNotice=provider_created");
await expectRedirect(setModelProviderEnabledAction(enableForm), "/?view=models&modelNotice=provider_enabled");
await expectRedirect(setModelProviderEnabledAction(disableForm), "/?view=models&modelNotice=provider_disabled");
await expectRedirect(upsertProjectModelRouteAction(formData), "/?view=models&modelNotice=route_saved");
```

Add one explicit enable/disable skill binding test near the existing binding tests:

```ts
it("redirects skill binding enable and disable actions with notice codes", async () => {
  await expectRedirect(
    setSkillBindingEnabledAction(
      buildSkillForm({
        projectId: "project_1",
        bindingId: "binding_1",
        enabled: "true"
      })
    ),
    "/?view=skills&skillNotice=enabled"
  );

  await expectRedirect(
    setSkillBindingEnabledAction(
      buildSkillForm({
        projectId: "project_1",
        bindingId: "binding_1",
        enabled: "false"
      })
    ),
    "/?view=skills&skillNotice=disabled"
  );
});
```

Keep existing error redirect tests unchanged; they should still expect `skillError`, `workerError`, or `modelError`.

- [ ] **Step 2: Run action tests to verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/app/actions.test.ts
```

Expected: FAIL because success redirects still go to `/?view=skills` or `/?view=models` without notice query params.

- [ ] **Step 3: Add notice redirect helpers**

In `apps/web/src/app/actions.ts`, import the notice types:

```ts
import type {
  ModelManagementNotice,
  SkillManagementNotice
} from "./skills-models-management-view-model";
```

Add helpers below the existing error redirect helpers:

```ts
function redirectToSkillsWithNotice(notice: SkillManagementNotice): never {
  redirect(`/?view=skills&skillNotice=${encodeURIComponent(notice)}`);
}

function redirectToModelsWithNotice(notice: ModelManagementNotice): never {
  redirect(`/?view=models&modelNotice=${encodeURIComponent(notice)}`);
}
```

- [ ] **Step 4: Update successful Skills action redirects**

Replace success redirects in `apps/web/src/app/actions.ts`:

```ts
redirectToSkillsWithNotice("draft_created");
redirectToSkillsWithNotice("validated");
redirectToSkillsWithNotice("published");
redirectToSkillsWithNotice("bound");
redirectToSkillsWithNotice(result.value.enabled ? "enabled" : "disabled");
redirectToSkillsWithNotice("command_queued");
redirectToSkillsWithNotice("worker_ran");
```

Apply them to `createSkillDraftAction`, `validateSkillVersionAction`, `publishSkillVersionAction`, `bindSkillVersionAction`, `setSkillBindingEnabledAction`, `executeSkillCommandAction`, and `runLocalWorkerOnceAction` respectively. Keep each existing `revalidatePath("/")` call before the redirect.

- [ ] **Step 5: Update successful Models action redirects**

Replace success redirects in `createModelProviderAction`, `setModelProviderEnabledAction`, and `upsertProjectModelRouteAction`:

```ts
redirectToModelsWithNotice("provider_created");
redirectToModelsWithNotice(result.value.enabled ? "provider_enabled" : "provider_disabled");
redirectToModelsWithNotice("route_saved");
```

- [ ] **Step 6: Run action tests**

Run:

```bash
pnpm exec vitest run apps/web/src/app/actions.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/actions.ts apps/web/src/app/actions.test.ts
git commit -m "add skills models action notices"
```

## Task 4: Render Skills / Models Management UI

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Write failing page rendering tests**

Add tests to `apps/web/src/app/page.test.ts` near the existing Skills / Models view tests:

```ts
it("renders skills management lifecycle, notices, and safe runtime summary", async () => {
  setActiveEmptyProjectState();
  pageMocks.pageState = {
    ...(pageMocks.pageState as Record<string, unknown>),
    skills: {
      availableVersions: [
        {
          id: "skill_version_draft",
          skillId: "skill_brand",
          version: "0.1.0",
          manifest: {
            id: "skill_brand",
            name: "Brand voice",
            version: "0.1.0",
            type: "template",
            scope: "project",
            description: "RAW_SKILL_CONTENT_SECRET",
            permissions: [],
            requiredSecrets: [],
            entrypoints: ["brand.md"],
            reviewState: "draft"
          },
          content: "RAW_SKILL_CONTENT_SECRET",
          contentType: "text/markdown",
          reviewState: "draft",
          createdAt: "2026-05-24T00:00:00.000Z"
        }
      ],
      boundSkills: []
    },
    skillCommands: []
  };

  const page = await HomePage({
    searchParams: Promise.resolve({ view: "skills", skillNotice: "draft_created" })
  });
  const text = collectText(page).join(" ");

  expect(text).toContain("Skill draft saved.");
  expect(text).toContain("Runtime context");
  expect(text).toContain("0 active context skills");
  expect(text).toContain("Skill lifecycle");
  expect(text).toContain("Draft");
  expect(text).toContain("Validate next");
  expect(text).toContain("Saved skill content is not echoed on this page.");
  expect(text).not.toContain("RAW_SKILL_CONTENT_SECRET");
});

it("renders models management summaries, route states, notices, and safe metadata", async () => {
  setActiveEmptyProjectState();
  pageMocks.pageState = {
    ...(pageMocks.pageState as Record<string, unknown>),
    models: {
      providers: [
        {
          id: "provider_openai",
          scope: "project",
          targetKey: "project_1",
          name: "OpenAI",
          provider: "openai",
          config: {
            api: "openai-completions",
            baseUrl: "https://secret-provider.example.test/v1",
            apiKeyEnv: "OPENAI_API_KEY",
            models: [{ id: "gpt-5.4" }]
          },
          enabled: true,
          createdAt: "2026-05-24T00:00:00.000Z",
          updatedAt: "2026-05-24T00:00:00.000Z"
        }
      ],
      routes: [
        {
          id: "route_planner",
          scope: "project",
          targetKey: "project_1",
          role: "planner",
          providerId: "provider_openai",
          model: "gpt-5.4",
          createdAt: "2026-05-24T00:01:00.000Z",
          updatedAt: "2026-05-24T00:01:00.000Z"
        }
      ],
      resolvedPolicy: {
        assistant: { provider: "mock-openai", model: "assistant-model" },
        planner: { provider: "provider_openai", model: "gpt-5.4" },
        builder: { provider: "mock-anthropic", model: "code-model" },
        reviewer: { provider: "mock-openai", model: "review-model" },
        deployer: { provider: "mock-local", model: "tool-model" }
      }
    }
  };

  const page = await HomePage({
    searchParams: Promise.resolve({ view: "models", modelNotice: "route_saved" })
  });
  const text = collectText(page).join(" ");

  expect(text).toContain("Model route saved.");
  expect(text).toContain("Project model summary");
  expect(text).toContain("1 enabled of 1 provider");
  expect(text).toContain("1 configured of 5 routes");
  expect(text).toContain("Provider configuration");
  expect(text).toContain("Role routing");
  expect(text).toContain("Resolved runtime routes");
  expect(text).toContain("Configured");
  expect(text).toContain("Deterministic fallback");
  expect(text).not.toContain("secret-provider.example.test");
  expect(text).not.toContain("OPENAI_API_KEY=");
});
```

- [ ] **Step 2: Run page tests to verify they fail**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts
```

Expected: FAIL because `page.tsx` does not parse notices or render management summaries.

- [ ] **Step 3: Build view models in `HomePage`**

In `apps/web/src/app/page.tsx`, import:

```ts
import {
  buildModelsManagementViewModel,
  buildSkillsManagementViewModel,
  modelManagementRoleOrder,
  toModelManagementNotice,
  toSkillManagementNotice
} from "./skills-models-management-view-model";
```

After parsing `workerError`, add:

```ts
  const skillNotice = toSkillManagementNotice(getFirstSearchParam(params?.skillNotice));
  const modelNotice = toModelManagementNotice(getFirstSearchParam(params?.modelNotice));
```

After `const workerHeartbeat = workerQueue.heartbeat;`, add:

```ts
  const skillsManagement = buildSkillsManagementViewModel({
    copy,
    skillState: pageState.skills,
    skillCommands,
    ...(skillNotice ? { notice: skillNotice } : {})
  });
  const modelsManagement = buildModelsManagementViewModel({
    copy,
    modelState,
    ...(modelNotice ? { notice: modelNotice } : {})
  });
```

Replace the local `roleOrder` constant usage for Models route rendering with `modelManagementRoleOrder`. Keep `roleOrder` only where existing code still needs it outside the Models UI; if no other usage remains, remove the local constant.

- [ ] **Step 4: Preserve notice query for artifact snippet links**

Extend `createArtifactPreviewSearchParams()` input with:

```ts
  modelNotice?: string;
  skillNotice?: string;
```

Set the values in the helper:

```ts
  if (skillNotice) {
    query.set("skillNotice", skillNotice);
  }
  if (modelNotice) {
    query.set("modelNotice", modelNotice);
  }
```

Pass `skillNotice` and `modelNotice` from `HomePage`.

- [ ] **Step 5: Render Skills management summaries**

In the `activeView === "skills"` branch, add notice and management sections after `skillErrorMessage`:

```tsx
                {skillsManagement.noticeMessage ? (
                  <div className="formNotice" role="status">{skillsManagement.noticeMessage}</div>
                ) : null}

                <section className="managementSummary" aria-labelledby="skills-runtime-summary-title">
                  <div>
                    <h2 id="skills-runtime-summary-title">
                      {copy.skillsView.management.runtimeSummaryTitle}
                    </h2>
                    <p>{skillsManagement.runtimeSummary}</p>
                  </div>
                  <ul>
                    {skillsManagement.policyItems.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
```

In the skill editor form, add the no-raw-content note before the submit button and pending text inside the button:

```tsx
                      <p className="formHint">{copy.skillsView.management.noRawContentNotice}</p>
                      <button type="submit" data-pending-label={copy.skillsView.management.pending.createDraft}>
                        {copy.skillsView.createDraft}
                      </button>
```

In each `version` row, use the corresponding view-model row:

```tsx
                            {(() => {
                              const row = skillsManagement.versionRows.find(
                                (candidate) => candidate.id === version.id
                              );
                              return row ? (
                                <small className="managementState">
                                  {row.stageLabel} · {row.nextActionLabel}
                                </small>
                              ) : null;
                            })()}
```

Update lifecycle action buttons with `data-pending-label`:

```tsx
<button type="submit" data-pending-label={copy.skillsView.management.pending.validate}>
  {copy.skillsView.validate}
</button>
```

Use `pending.publish`, `pending.bind`, `pending.enable`, `pending.disable`, `pending.queueCommand`, and `pending.runWorker` for the matching forms.

- [ ] **Step 6: Render Models management summaries**

In the `activeView === "models"` branch, add notice and summary blocks after `modelErrorMessage`:

```tsx
                {modelsManagement.noticeMessage ? (
                  <div className="formNotice" role="status">{modelsManagement.noticeMessage}</div>
                ) : null}

                <section className="managementSummary" aria-labelledby="models-summary-title">
                  <div>
                    <h2 id="models-summary-title">
                      {copy.modelsView.management.projectSummaryTitle}
                    </h2>
                    <p>{modelsManagement.providerSummary}</p>
                    <p>{modelsManagement.routeSummary}</p>
                  </div>
                  <ul>
                    <li>{modelsManagement.safeMetadataNote}</li>
                    <li>{modelsManagement.optInRuntimeNote}</li>
                  </ul>
                </section>
```

Update the provider create form button:

```tsx
<button type="submit" data-pending-label={copy.modelsView.management.pending.createProvider}>
  {copy.modelsView.createProvider}
</button>
```

For each provider row, use the view-model provider row to display safe metadata:

```tsx
                              {(() => {
                                const providerRow = modelsManagement.providerRows.find(
                                  (row) => row.id === provider.id
                                );
                                return providerRow ? (
                                  <span>
                                    {providerRow.providerTypeLabel} · {providerRow.apiLabel} ·{" "}
                                    {copy.modelsView.baseUrlLabel}: {providerRow.baseUrlState} ·{" "}
                                    {copy.modelsView.apiKeyEnvLabel}: {providerRow.secretState} ·{" "}
                                    {providerRow.stateLabel} · {providerRow.modelCount} models
                                  </span>
                                ) : null;
                              })()}
```

For each route form, use `modelsManagement.routeRows` and add the route state:

```tsx
                            {(() => {
                              const routeRow = modelsManagement.routeRows.find(
                                (row) => row.role === role
                              );
                              return routeRow ? (
                                <small className={`managementState routeState-${routeRow.state}`}>
                                  {routeRow.stateLabel} · {routeRow.resolvedLabel}
                                </small>
                              ) : null;
                            })()}
```

Add `data-pending-label={copy.modelsView.management.pending.saveRoute}` to route buttons and `pending.enable` / `pending.disable` to provider enable/disable buttons.

- [ ] **Step 7: Add CSS**

Append to the Skills / Models CSS area in `apps/web/src/app/globals.css`:

```css
.formNotice {
  min-width: 0;
  border: 1px solid #b8ddc2;
  border-radius: 8px;
  background: #eef8f1;
  color: #1f6f37;
  padding: 10px 12px;
  font-size: 0.86rem;
  font-weight: 760;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.managementSummary {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
  gap: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  padding: 14px 16px;
}

.managementSummary h2 {
  margin: 0;
  color: #25292e;
  font-size: 0.98rem;
  line-height: 1.25;
  letter-spacing: 0;
}

.managementSummary p,
.formHint {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 0.84rem;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.managementSummary ul {
  min-width: 0;
  display: grid;
  gap: 6px;
  margin: 0;
  padding-left: 18px;
  color: var(--muted);
  font-size: 0.82rem;
  line-height: 1.45;
}

.managementState {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  font-size: 0.76rem;
  font-weight: 760;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.routeState-failClosed {
  color: var(--danger);
}

.routeState-fallback {
  color: #8b5e16;
}

button[data-pending-label] {
  position: relative;
}

@media (max-width: 820px) {
  .managementSummary {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 8: Run focused page tests**

Run:

```bash
pnpm exec vitest run apps/web/src/app/page.test.ts apps/web/src/app/skills-models-management-view-model.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app/page.tsx apps/web/src/app/page.test.ts apps/web/src/app/globals.css
git commit -m "render skills models management polish"
```

## Task 5: Browser Acceptance for Stage 44

**Files:**
- Modify: `apps/web/e2e/helpers.ts`
- Add: `apps/web/e2e/alpha-skills-models-management.spec.ts`

- [ ] **Step 1: Add browser helpers**

Append to `apps/web/e2e/helpers.ts`:

```ts
export async function expectSkillsManagementSurface(page: Page) {
  await page.getByRole("link", { name: "Skills" }).click();
  await expect(page).toHaveURL(/[?&]view=skills(?:&|$)/);
  await expect(page.getByRole("heading", { name: "Project skills", exact: true })).toBeVisible();
  await expect(page.getByText("Runtime context", { exact: true })).toBeVisible();
  await expect(page.getByText("Skill lifecycle", { exact: true })).toBeVisible();
  await expect(page.getByText("Saved skill content is not echoed on this page.")).toBeVisible();
}

export async function expectModelsManagementSurface(page: Page) {
  await page.getByRole("link", { name: "Models" }).click();
  await expect(page).toHaveURL(/[?&]view=models(?:&|$)/);
  await expect(page.getByRole("heading", { name: "Project models", exact: true })).toBeVisible();
  await expect(page.getByText("Project model summary", { exact: true })).toBeVisible();
  await expect(page.getByText("Provider configuration", { exact: true })).toBeVisible();
  await expect(page.getByText("Role routing", { exact: true })).toBeVisible();
  await expect(page.getByText("Secret values are never shown")).toBeVisible();
}
```

- [ ] **Step 2: Write failing E2E spec**

Create `apps/web/e2e/alpha-skills-models-management.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import {
  createProject,
  expectModelsManagementSurface,
  expectSkillsManagementSurface
} from "./helpers";

test("manages skills and models with safe client-side feedback", async ({ page }) => {
  await createProject(page, "Stage 44 Management");

  await expectSkillsManagementSurface(page);
  await page.getByLabel("Manifest JSON").fill(
    JSON.stringify(
      {
        id: "skill_stage44",
        name: "Stage 44 Brand Voice",
        version: "0.1.0",
        type: "template",
        scope: "project",
        description: "Safe brand guidance.",
        permissions: ["brief:read"],
        requiredSecrets: [],
        entrypoints: ["brand.md"],
        reviewState: "draft"
      },
      null,
      2
    )
  );
  await page.getByLabel("Skill content").fill("RAW_SKILL_BROWSER_SECRET");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/[?&]skillNotice=draft_created(?:&|$)/);
  await expect(page.getByText("Skill draft saved.", { exact: true })).toBeVisible();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  await expect(page.getByText("Validate next", { exact: true })).toBeVisible();
  await expect(page.getByText("RAW_SKILL_BROWSER_SECRET")).toHaveCount(0);

  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page).toHaveURL(/[?&]skillNotice=validated(?:&|$)/);
  await expect(page.getByText("Skill validated.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page).toHaveURL(/[?&]skillNotice=published(?:&|$)/);
  await expect(page.getByText("Skill published.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Bind" }).click();
  await expect(page).toHaveURL(/[?&]skillNotice=bound(?:&|$)/);
  await expect(page.getByText("Skill bound to the project.", { exact: true })).toBeVisible();
  await expect(page.getByText("Enabled", { exact: true })).toBeVisible();

  await expectModelsManagementSurface(page);
  await page.getByLabel("Provider key").fill("provider_stage44");
  await page.getByLabel("Display name").fill("Stage 44 Provider");
  await page.getByLabel("Provider type").selectOption("custom");
  await page.getByLabel("API protocol").selectOption("openai-completions");
  await page.getByLabel("Base URL").fill("https://secret-provider.example.test/v1");
  await page.getByLabel("API key env var").fill("STAGE44_API_KEY");
  await page.getByLabel("Default model id").fill("stage-44-model");
  await page.getByRole("button", { name: "Create provider" }).click();
  await expect(page).toHaveURL(/[?&]modelNotice=provider_created(?:&|$)/);
  await expect(page.getByText("Model provider saved.", { exact: true })).toBeVisible();
  await expect(page.getByText("Stage 44 Provider", { exact: true })).toBeVisible();
  await expect(page.getByText("https://secret-provider.example.test/v1")).toHaveCount(0);
  await expect(page.getByText("STAGE44_API_KEY=")).toHaveCount(0);

  await page.getByLabel("Planner Model ID").fill("stage-44-model");
  await page
    .locator("form.modelRouteForm")
    .filter({ hasText: "Planner" })
    .getByRole("button", { name: "Save route" })
    .click();
  await expect(page).toHaveURL(/[?&]modelNotice=route_saved(?:&|$)/);
  await expect(page.getByText("Model route saved.", { exact: true })).toBeVisible();
  await expect(page.getByText("Configured", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Deterministic fallback", { exact: true }).first()).toBeVisible();
});
```

- [ ] **Step 3: Run the focused E2E spec to verify it fails before integration is complete**

If Task 4 is already implemented, this test may pass on the first run. If it fails, the failure should point to missing Stage 44 UI labels or selectors.

Run:

```bash
pnpm alpha:e2e -- apps/web/e2e/alpha-skills-models-management.spec.ts
```

Expected after Task 4: PASS.

- [ ] **Step 4: Run full browser acceptance**

Run:

```bash
pnpm alpha:e2e
```

Expected: PASS for the full deterministic Chromium suite.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/helpers.ts apps/web/e2e/alpha-skills-models-management.spec.ts
git commit -m "cover skills models management browser flow"
```

## Task 6: Documentation and Roadmap Closeout

**Files:**
- Modify: `docs/web-v1-acceptance.md`
- Modify: `docs/alpha-release-candidate.md`
- Modify: `docs/project-roadmap.md`
- Modify: `docs/superpowers/README.md`
- Modify: `docs/agent-development-learning.md`

- [ ] **Step 1: Update manual acceptance**

In `docs/web-v1-acceptance.md`, add a Stage 44 checklist section:

```md
### Stage 44：Skills / Models client-side management

- Skills 页面展示 `Runtime context`、lifecycle stage、成功 notice、错误 notice 和 command queue hierarchy。
- 创建 skill draft 后不会回显 raw skill content；validate、publish、bind、enable/disable 后回到 repository fact。
- Models 页面展示 provider summary、route summary、resolved runtime routes、real provider opt-in 提示和 fail-closed diagnostics。
- Provider summary 只显示 provider/model/API protocol/env var name 等 bounded metadata，不展示 secret 值、raw provider response 或完整 base URL。
- MCP management 仍隐藏；旧 `/?view=mcp` 仍安全降级到 Workbench。
```

- [ ] **Step 2: Update RC follow-up routing**

In `docs/alpha-release-candidate.md`, update the Stage 44 line under Follow-up Routing:

```md
- Stage 44（已完成）：Skills / Models client-side management，继续排除 MCP management。
- Stage 45（当前推荐）：Browser failure injection 和轻量视觉回归扩展。
```

- [ ] **Step 3: Update roadmap**

In `docs/project-roadmap.md`:

Change Stage 44 status to:

```md
**状态：** 已实现。
```

Add an implementation summary under Stage 44:

```md
**实现摘要：**

- Skills 页面现在展示 runtime context summary、lifecycle state、success notice、pending affordance、binding enabled/disabled state 和 command queue hierarchy。
- Models 页面现在展示 provider summary、route summary、resolved runtime routes、real provider opt-in note 和 fail-closed diagnostics。
- 新增 Web-only Skills / Models management view-model 和 browser acceptance；runtime schemas/contracts、real provider opt-in 默认关闭策略和 MCP hidden surface 不变。
```

Change Stage 45 status to:

```md
**状态：** 当前推荐。
```

Add a decision record:

```md
- 2026-05-24 Stage 44 已完成 Skills and Models Client-side Management v0：Web-only management view-model 已覆盖 Skills lifecycle、runtime context summary、command queue hierarchy、Models provider/route/resolved summaries、real provider opt-in 和 fail-closed diagnostics；默认下一路由为 Stage 45 Browser Failure and Visual Regression Expansion v0。
```

- [ ] **Step 4: Update Superpowers README**

In `docs/superpowers/README.md`, change the Stage 44 plan entry to implemented:

```md
116. `plans/2026-05-24-skills-models-client-management.md`
   - Stage 44 Skills and Models Client-side Management v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 44 design 后阅读，用于按 TDD 实现 i18n management copy、Web-only Skills / Models management view-model、server action notice redirects、page rendering、browser acceptance 和 docs closeout。
```

- [ ] **Step 5: Update Agent development learning**

In `docs/agent-development-learning.md`, update the Stage 44 section:

```md
当前计划：

- [2026-05-24-skills-models-client-management.md](./superpowers/plans/2026-05-24-skills-models-client-management.md)

当前实现状态：

- Stage 44 v0 已实现 Web-only Skills / Models client-side management view-model。
- Skills 页面从 repository-backed facts 派生 lifecycle、binding、runtime context summary 和 command queue hierarchy。
- Models 页面从 provider/route/resolved policy facts 派生 provider summary、role routing summary、real provider opt-in note 和 fail-closed diagnostics。
- Client-side pending / notice 只用于反馈，不改变 Agent fact source。
```

- [ ] **Step 6: Run documentation checks**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add docs/web-v1-acceptance.md docs/alpha-release-candidate.md docs/project-roadmap.md docs/superpowers/README.md docs/agent-development-learning.md
git commit -m "complete skills models management docs"
```

## Final Verification

- [ ] Run focused unit tests:

```bash
pnpm exec vitest run apps/web/src/lib/i18n.test.ts apps/web/src/app/skills-models-management-view-model.test.ts apps/web/src/app/actions.test.ts apps/web/src/app/page.test.ts
```

Expected: PASS.

- [ ] Run alpha check:

```bash
pnpm alpha:check
```

Expected: PASS.

- [ ] Run typecheck:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] Run full browser acceptance:

```bash
pnpm alpha:e2e
```

Expected: PASS.

- [ ] Run diff whitespace check:

```bash
git diff --check
```

Expected: no output.

- [ ] Confirm closeout facts:

```bash
git status --short --branch
```

Expected before merge/finish: only intentional branch-ahead state, no unstaged changes.

```bash
rg -n "Stage 44|Stage 45|Stage 46" docs/project-roadmap.md docs/superpowers/README.md docs/alpha-release-candidate.md docs/agent-development-learning.md
```

Expected: Stage 44 marked complete after implementation, Stage 45 current recommendation, Stage 46 still queued.

## Implementation Notes

- Start implementation from an isolated worktree using `superpowers:using-git-worktrees`.
- Follow TDD: write the failing test first, run it to observe the expected failure, implement minimal code, rerun focused tests, then commit.
- Use `superpowers:subagent-driven-development` for task-by-task implementation if available. Each task can be assigned to a fresh worker because the tasks are mostly independent after Task 1 and Task 2.
- Keep all generated LP artifacts static HTML/CSS/JS; Stage 44 does not touch artifact generation.
- Keep MCP hidden behavior intact. Existing `alpha-boundaries.spec.ts` and `page.test.ts` must continue to pass.
