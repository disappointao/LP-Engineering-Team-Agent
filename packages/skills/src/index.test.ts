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
});
