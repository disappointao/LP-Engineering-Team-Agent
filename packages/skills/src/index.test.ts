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
      permissions: ["git:write", "ci:trigger"]
    });

    expect(result.allowed).toBe(true);
  });

  it("checks project skill bindings before use", () => {
    expect(
      canUseSkill({
        skillId: "skill_brand",
        boundSkillIds: ["skill_brand"],
        requiredPermissions: ["artifact:write"],
        grantedPermissions: ["artifact:write", "brief:read"]
      })
    ).toBe(true);
  });
});
