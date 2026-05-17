import type { ProjectMemberRecord, ProjectRole } from "@lp-agent/db";

export interface WorkbenchUserIdentity {
  id: string;
  displayName: string;
  email?: string;
}

export interface ProjectMemberView {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
}

export const defaultLocalWorkbenchUser: WorkbenchUserIdentity = {
  id: "local-web-user",
  displayName: "Local user"
};

export function normalizeWorkbenchUserIdentity(
  user: WorkbenchUserIdentity | undefined
): WorkbenchUserIdentity {
  const candidate = user ?? defaultLocalWorkbenchUser;
  const id = candidate.id.trim();
  const displayName = candidate.displayName.trim();
  if (id.length === 0) {
    throw new Error("workbench_user_id_required");
  }
  return {
    id,
    displayName: displayName.length > 0 ? displayName : id,
    ...(candidate.email?.trim() ? { email: candidate.email.trim() } : {})
  };
}

export function createProjectMemberId(projectId: string, userId: string): string {
  return `project_member_${toMembershipIdSegment(projectId)}_${toMembershipIdSegment(userId)}`;
}

export function createWorkspaceMemberId(workspaceId: string, userId: string): string {
  return `workspace_member_${toMembershipIdSegment(workspaceId)}_${toMembershipIdSegment(userId)}`;
}

export function toProjectMemberView(member: ProjectMemberRecord): ProjectMemberView {
  return {
    id: member.id,
    projectId: member.projectId,
    userId: member.userId,
    role: member.role,
    ...(member.displayName ? { displayName: member.displayName } : {}),
    createdAt: member.createdAt,
    updatedAt: member.updatedAt
  };
}

function toMembershipIdSegment(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_-]/g, "_");
  return normalized.length > 0 ? normalized : "unknown";
}
