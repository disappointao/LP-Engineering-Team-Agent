import { describe, expect, it } from "vitest";
import {
  SkillManifestSchema,
  canPublishSkill,
  canUseSkill,
  sampleTemplateSkill
} from "./index";

describe("skills registry rules", () => {
  it("validates workflow and template skill manifests", () => {
    const parsed = SkillManifestSchema.parse(sampleTemplateSkill);

    expect(parsed.type).toBe("template");
    expect(parsed.scope).toBe("project");
  });

  it("lets members publish workflow and template skills", () => {
    expect(canPublishSkill("member", sampleTemplateSkill)).toEqual({
      allowed: true,
      reason: "member can publish template skills"
    });
  });

  it("requires admin review for deployment skills", () => {
    const result = canPublishSkill("member", {
      ...sampleTemplateSkill,
      type: "deployment",
      permissions: ["git:write", "ci:trigger"]
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("deployment skills require admin review");
  });

  it("allows admins to publish permissioned deployment skills", () => {
    const result = canPublishSkill("admin", {
      ...sampleTemplateSkill,
      type: "deployment",
      reviewState: "validated",
      permissions: ["git:write", "ci:trigger"]
    });

    expect(result.allowed).toBe(true);
  });

  it("blocks deployment skill publication before validation", () => {
    const result = canPublishSkill("admin", {
      ...sampleTemplateSkill,
      type: "deployment",
      reviewState: "draft",
      permissions: ["git:write", "ci:trigger"]
    });

    expect(result).toEqual({
      allowed: false,
      reason: "deployment skills must be validated before publishing"
    });
  });

  it("checks project skill bindings before use", () => {
    expect(
      canUseSkill({
        manifest: sampleTemplateSkill,
        boundSkillIds: ["skill_brand"],
        grantedPermissions: ["artifact:write", "brief:read"]
      })
    ).toBe(true);
  });

  it("denies unbound skills and missing permissions", () => {
    expect(
      canUseSkill({
        manifest: sampleTemplateSkill,
        boundSkillIds: [],
        grantedPermissions: ["artifact:write", "brief:read"]
      })
    ).toBe(false);

    expect(
      canUseSkill({
        manifest: sampleTemplateSkill,
        boundSkillIds: ["skill_brand"],
        grantedPermissions: ["brief:read"]
      })
    ).toBe(false);
  });

  it("blocks unreviewed and retired deployment skills from use", () => {
    const deploymentSkill = {
      ...sampleTemplateSkill,
      id: "skill_deploy",
      type: "deployment" as const,
      permissions: ["git:write"]
    };

    for (const reviewState of ["draft", "deprecated", "archived"] as const) {
      expect(
        canUseSkill({
          manifest: {
            ...deploymentSkill,
            reviewState
          },
          boundSkillIds: ["skill_deploy"],
          grantedPermissions: ["git:write"]
        })
      ).toBe(false);
    }

    expect(
      canUseSkill({
        manifest: {
          ...deploymentSkill,
          reviewState: "validated"
        },
        boundSkillIds: ["skill_deploy"],
        grantedPermissions: ["git:write"]
      })
    ).toBe(true);
  });

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
});
