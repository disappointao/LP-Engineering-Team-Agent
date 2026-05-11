import { z } from "zod";

export const SkillTypeSchema = z.enum(["workflow", "template", "deployment"]);
export type SkillType = z.infer<typeof SkillTypeSchema>;

export const SkillScopeSchema = z.enum(["global", "organization", "workspace", "project"]);
export type SkillScope = z.infer<typeof SkillScopeSchema>;

export const SkillManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  type: SkillTypeSchema,
  scope: SkillScopeSchema,
  description: z.string().min(1),
  permissions: z.array(z.string().min(1)).default([]),
  requiredSecrets: z.array(z.string().min(1)).default([]),
  entrypoints: z.array(z.string().min(1)).default([]),
  reviewState: z.enum(["draft", "validated", "published", "deprecated", "archived"])
}).strict();
export type SkillManifest = z.infer<typeof SkillManifestSchema>;

export type SkillPublisherRole = "owner" | "admin" | "member" | "reviewer";

export interface PermissionDecision {
  allowed: boolean;
  reason: string;
}

export const sampleTemplateSkill: SkillManifest = {
  id: "skill_brand",
  name: "Acme Brand Landing Page Sections",
  version: "0.1.0",
  type: "template",
  scope: "project",
  description: "Adds brand tone, section patterns, and ecommerce LP constraints.",
  permissions: ["brief:read", "artifact:write"],
  requiredSecrets: [],
  entrypoints: ["templates/acme-lp.md"],
  reviewState: "validated"
};

export const canPublishSkill = (
  role: SkillPublisherRole,
  manifest: SkillManifest
): PermissionDecision => {
  SkillManifestSchema.parse(manifest);

  if (manifest.type === "deployment") {
    if (manifest.reviewState !== "validated" && manifest.reviewState !== "published") {
      return { allowed: false, reason: "deployment skills must be validated before publishing" };
    }

    if (role === "owner" || role === "admin") {
      return { allowed: true, reason: `${role} can publish reviewed deployment skills` };
    }

    return { allowed: false, reason: "deployment skills require admin review" };
  }

  if (role === "owner" || role === "admin" || role === "member") {
    return { allowed: true, reason: `${role} can publish ${manifest.type} skills` };
  }

  return { allowed: false, reason: "reviewer cannot publish skills" };
};

export const canUseSkill = (input: {
  manifest: SkillManifest;
  boundSkillIds: string[];
  grantedPermissions: string[];
}): boolean => {
  const manifest = SkillManifestSchema.parse(input.manifest);
  if (manifest.reviewState === "archived") {
    return false;
  }

  if (
    manifest.type === "deployment" &&
    manifest.reviewState !== "validated" &&
    manifest.reviewState !== "published"
  ) {
    return false;
  }

  const isBound = input.boundSkillIds.includes(manifest.id);
  const hasPermissions = manifest.permissions.every((permission) =>
    input.grantedPermissions.includes(permission)
  );

  return isBound && hasPermissions;
};
