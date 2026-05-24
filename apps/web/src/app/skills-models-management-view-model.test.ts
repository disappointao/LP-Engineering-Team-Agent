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
                  requiresApproval: true,
                  command: "publish-static",
                  args: []
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

  it("derives disabled, validated, and published unbound lifecycle actions", () => {
    const model = buildSkillsManagementViewModel({
      copy,
      skillCommands: [],
      skillState: {
        availableVersions: [
          {
            id: "skill_version_disabled",
            skillId: "skill_deploy",
            version: "1.0.0",
            manifest: {
              id: "skill_deploy",
              name: "Deploy",
              version: "1.0.0",
              type: "deployment",
              scope: "project",
              description: "Deployment metadata",
              permissions: [],
              requiredSecrets: [],
              entrypoints: ["deploy.md"],
              reviewState: "published"
            },
            content: "hidden",
            contentType: "text/markdown",
            reviewState: "published",
            createdAt: "2026-05-24T00:00:00.000Z"
          },
          {
            id: "skill_version_validated",
            skillId: "skill_brand",
            version: "0.2.0",
            manifest: {
              id: "skill_brand",
              name: "Brand",
              version: "0.2.0",
              type: "template",
              scope: "project",
              description: "Brand metadata",
              permissions: [],
              requiredSecrets: [],
              entrypoints: ["brand.md"],
              reviewState: "validated"
            },
            content: "hidden",
            contentType: "text/markdown",
            reviewState: "validated",
            createdAt: "2026-05-24T00:01:00.000Z"
          },
          {
            id: "skill_version_unbound",
            skillId: "skill_unbound",
            version: "1.0.0",
            manifest: {
              id: "skill_unbound",
              name: "Unbound",
              version: "1.0.0",
              type: "workflow",
              scope: "project",
              description: "Workflow metadata",
              permissions: [],
              requiredSecrets: [],
              entrypoints: ["workflow.md"],
              reviewState: "published"
            },
            content: "hidden",
            contentType: "text/markdown",
            reviewState: "published",
            createdAt: "2026-05-24T00:02:00.000Z"
          }
        ],
        boundSkills: [
          {
            skill: {
              id: "skill_deploy",
              name: "Deploy",
              type: "deployment",
              scope: "project",
              createdAt: "2026-05-24T00:00:00.000Z"
            },
            version: {
              id: "skill_version_disabled",
              skillId: "skill_deploy",
              version: "1.0.0",
              manifest: {
                id: "skill_deploy",
                name: "Deploy",
                version: "1.0.0",
                type: "deployment",
                scope: "project",
                description: "Deployment metadata",
                permissions: [],
                requiredSecrets: [],
                entrypoints: ["deploy.md"],
                reviewState: "published"
              },
              content: "hidden",
              contentType: "text/markdown",
              reviewState: "published",
              createdAt: "2026-05-24T00:00:00.000Z"
            },
            binding: {
              id: "binding_disabled",
              skillVersionId: "skill_version_disabled",
              scope: "project",
              targetKey: "project_1",
              projectId: "project_1",
              enabled: false,
              createdAt: "2026-05-24T00:03:00.000Z",
              updatedAt: "2026-05-24T00:03:00.000Z"
            }
          }
        ]
      }
    });

    expect(model.versionRows.map((row) => [row.id, row.stage, row.nextAction])).toEqual([
      ["skill_version_disabled", "disabled", "enable"],
      ["skill_version_validated", "validated", "publish"],
      ["skill_version_unbound", "published", "bind"]
    ]);
  });

  it("keeps deprecated, archived, and unknown lifecycle states non-actionable", () => {
    const model = buildSkillsManagementViewModel({
      copy,
      skillCommands: [],
      skillState: {
        availableVersions: [
          {
            id: "skill_version_deprecated",
            skillId: "skill_deprecated",
            version: "1.0.0",
            manifest: {
              id: "skill_deprecated",
              name: "Deprecated",
              version: "1.0.0",
              type: "template",
              scope: "project",
              description: "Deprecated metadata",
              permissions: [],
              requiredSecrets: [],
              entrypoints: ["deprecated.md"],
              reviewState: "deprecated"
            },
            content: "hidden",
            contentType: "text/markdown",
            reviewState: "deprecated",
            createdAt: "2026-05-24T00:00:00.000Z"
          },
          {
            id: "skill_version_archived",
            skillId: "skill_archived",
            version: "1.0.0",
            manifest: {
              id: "skill_archived",
              name: "Archived",
              version: "1.0.0",
              type: "template",
              scope: "project",
              description: "Archived metadata",
              permissions: [],
              requiredSecrets: [],
              entrypoints: ["archived.md"],
              reviewState: "archived"
            },
            content: "hidden",
            contentType: "text/markdown",
            reviewState: "archived",
            createdAt: "2026-05-24T00:01:00.000Z"
          },
          {
            id: "skill_version_unknown",
            skillId: "skill_unknown",
            version: "1.0.0",
            manifest: {
              id: "skill_unknown",
              name: "Unknown",
              version: "1.0.0",
              type: "template",
              scope: "project",
              description: "Unknown metadata",
              permissions: [],
              requiredSecrets: [],
              entrypoints: ["unknown.md"],
              reviewState: "needs_review" as never
            },
            content: "hidden",
            contentType: "text/markdown",
            reviewState: "needs_review" as never,
            createdAt: "2026-05-24T00:02:00.000Z"
          }
        ],
        boundSkills: []
      }
    });

    expect(model.versionRows.map((row) => [row.id, row.stage, row.nextAction])).toEqual([
      ["skill_version_deprecated", "inactive", "none"],
      ["skill_version_archived", "inactive", "none"],
      ["skill_version_unknown", "inactive", "none"]
    ]);
    expect(model.versionRows.map((row) => row.stageLabel)).toEqual([
      "Inactive",
      "Inactive",
      "Inactive"
    ]);
    expect(model.versionRows.map((row) => row.stage)).not.toContain("published");
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
    expect(model.providerRows[0]).not.toHaveProperty("secretEnvName");
    expect(JSON.stringify(model)).not.toContain("OPENAI_API_KEY");
    expect(JSON.stringify(model)).not.toContain("ANTHROPIC_API_KEY");
  });

  it("marks routes that point at disabled, missing, or blank-model providers as fail closed", () => {
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
          },
          {
            id: "provider_enabled",
            scope: "project",
            targetKey: "project_1",
            name: "Enabled",
            provider: "custom",
            config: { api: "openai-completions", models: [{ id: "gpt-5.4" }] },
            enabled: true,
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
          },
          {
            id: "route_deployer",
            scope: "project",
            targetKey: "project_1",
            role: "deployer",
            providerId: "provider_enabled",
            model: "   ",
            createdAt: "2026-05-24T00:03:00.000Z",
            updatedAt: "2026-05-24T00:03:00.000Z"
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
    expect(model.routeRows.find((row) => row.role === "deployer")).toEqual(
      expect.objectContaining({ state: "failClosed", diagnosticCode: "model_id_required" })
    );
  });

  it("parses only allowlisted model notice codes", () => {
    expect(toModelManagementNotice("provider_created")).toBe("provider_created");
    expect(toModelManagementNotice("RAW_SECRET")).toBeUndefined();
  });
});
