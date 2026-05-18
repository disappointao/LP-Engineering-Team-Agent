import {
  diffArtifactWorkspaceFiles,
  normalizeArtifactWorkspaceFilePath,
  readArtifactWorkspaceFileRecord,
  type ArtifactWorkspaceDiffResult,
  type ArtifactWorkspaceFilePath,
  type ArtifactWorkspaceFileReadResult,
  type ArtifactWorkspaceFileRecord,
  type ArtifactWorkspaceRecord
} from "@lp-agent/artifacts";
import type { PageVersionRecord, WorkbenchRepositories } from "@lp-agent/db";

export type ArtifactReaderErrorCode =
  | "artifact_workspace_not_found"
  | "artifact_workspace_project_mismatch"
  | "artifact_workspace_page_version_mismatch"
  | "artifact_workspace_file_not_found"
  | "artifact_workspace_file_project_mismatch"
  | "artifact_workspace_file_integrity_mismatch"
  | "artifact_workspace_file_path_not_allowed"
  | "artifact_workspace_read_limit_invalid"
  | "artifact_workspace_diff_not_available";

export class ArtifactReaderError extends Error {
  readonly code: ArtifactReaderErrorCode;

  constructor(code: ArtifactReaderErrorCode, message: string) {
    super(message);
    this.name = "ArtifactReaderError";
    this.code = code;
  }
}

export interface ReadRepositoryArtifactWorkspaceFileInput {
  repositories: WorkbenchRepositories;
  projectId: string;
  workspaceId: string;
  path: string;
  pageVersionId?: string;
  maxBytes?: number;
  includeContent?: boolean;
}

export interface DiffRepositoryArtifactWorkspacesInput {
  repositories: WorkbenchRepositories;
  projectId: string;
  fromWorkspaceId: string;
  toWorkspaceId: string;
  fromPageVersionId?: string;
  toPageVersionId?: string;
}

export interface DiffPageVersionArtifactWorkspacesInput {
  repositories: WorkbenchRepositories;
  projectId: string;
  fromPageVersionId: string;
  toPageVersionId: string;
}

export async function readRepositoryArtifactWorkspaceFile(
  input: ReadRepositoryArtifactWorkspaceFileInput
): Promise<ArtifactWorkspaceFileReadResult> {
  const path = normalizeReaderPath(input.path);
  const maxBytes = normalizeReadMaxBytes(input.maxBytes);
  const workspace = await getWorkspaceOrThrow(input.repositories, input.workspaceId);
  validateWorkspaceScope(workspace, input.projectId, input.pageVersionId);

  const file = await input.repositories.artifactWorkspaceFiles.getByPath({
    workspaceId: workspace.id,
    path
  });
  if (!file) {
    throw new ArtifactReaderError(
      "artifact_workspace_file_not_found",
      `Artifact workspace file not found: ${path}.`
    );
  }

  validateFileScope(file, workspace);

  try {
    return readArtifactWorkspaceFileRecord({
      file,
      includeContent: input.includeContent,
      maxBytes
    });
  } catch (error) {
    throw new ArtifactReaderError(
      "artifact_workspace_file_integrity_mismatch",
      error instanceof Error ? error.message : "Artifact workspace file integrity mismatch."
    );
  }
}

export async function diffRepositoryArtifactWorkspaces(
  input: DiffRepositoryArtifactWorkspacesInput
): Promise<ArtifactWorkspaceDiffResult> {
  const fromWorkspace = await getWorkspaceOrThrow(input.repositories, input.fromWorkspaceId);
  const toWorkspace = await getWorkspaceOrThrow(input.repositories, input.toWorkspaceId);
  validateWorkspaceScope(fromWorkspace, input.projectId, input.fromPageVersionId);
  validateWorkspaceScope(toWorkspace, input.projectId, input.toPageVersionId);

  let fromFiles: ArtifactWorkspaceFileRecord[];
  let toFiles: ArtifactWorkspaceFileRecord[];
  try {
    fromFiles = await input.repositories.artifactWorkspaceFiles.listForWorkspace(fromWorkspace.id);
    toFiles = await input.repositories.artifactWorkspaceFiles.listForWorkspace(toWorkspace.id);
    validateDiffFileScopes(fromFiles, fromWorkspace);
    validateDiffFileScopes(toFiles, toWorkspace);
    return diffArtifactWorkspaceFiles({
      projectId: input.projectId,
      fromWorkspaceId: fromWorkspace.id,
      toWorkspaceId: toWorkspace.id,
      fromFiles,
      toFiles
    });
  } catch (error) {
    throw new ArtifactReaderError(
      "artifact_workspace_diff_not_available",
      error instanceof Error ? error.message : "Artifact workspace diff is not available."
    );
  }
}

export async function diffPageVersionArtifactWorkspaces(
  input: DiffPageVersionArtifactWorkspacesInput
): Promise<ArtifactWorkspaceDiffResult> {
  const fromPageVersion = await getPageVersionForProjectOrThrow(
    input.repositories,
    input.projectId,
    input.fromPageVersionId
  );
  const toPageVersion = await getPageVersionForProjectOrThrow(
    input.repositories,
    input.projectId,
    input.toPageVersionId
  );

  if (!fromPageVersion.artifactWorkspaceId || !toPageVersion.artifactWorkspaceId) {
    throw new ArtifactReaderError(
      "artifact_workspace_diff_not_available",
      "Page version artifact workspace is not available."
    );
  }

  return diffRepositoryArtifactWorkspaces({
    repositories: input.repositories,
    projectId: input.projectId,
    fromWorkspaceId: fromPageVersion.artifactWorkspaceId,
    toWorkspaceId: toPageVersion.artifactWorkspaceId,
    fromPageVersionId: fromPageVersion.id,
    toPageVersionId: toPageVersion.id
  });
}

const normalizeReaderPath = (path: string): ArtifactWorkspaceFilePath => {
  try {
    return normalizeArtifactWorkspaceFilePath(path);
  } catch {
    throw new ArtifactReaderError(
      "artifact_workspace_file_path_not_allowed",
      "Artifact workspace file path is not allowed."
    );
  }
};

const normalizeReadMaxBytes = (maxBytes: number | undefined): number | undefined => {
  if (maxBytes === undefined) {
    return undefined;
  }

  if (!Number.isFinite(maxBytes) || maxBytes < 0 || !Number.isInteger(maxBytes)) {
    throw new ArtifactReaderError(
      "artifact_workspace_read_limit_invalid",
      "Artifact workspace read maxBytes must be a finite non-negative integer."
    );
  }

  return maxBytes;
};

const getWorkspaceOrThrow = async (
  repositories: WorkbenchRepositories,
  workspaceId: string
): Promise<ArtifactWorkspaceRecord> => {
  const workspace = await repositories.artifactWorkspaces.getById(workspaceId);
  if (!workspace) {
    throw new ArtifactReaderError(
      "artifact_workspace_not_found",
      `Artifact workspace not found: ${workspaceId}.`
    );
  }
  return workspace;
};

const validateWorkspaceScope = (
  workspace: ArtifactWorkspaceRecord,
  projectId: string,
  pageVersionId?: string
): void => {
  if (workspace.projectId !== projectId) {
    throw new ArtifactReaderError(
      "artifact_workspace_project_mismatch",
      "Artifact workspace does not belong to the requested project."
    );
  }
  if (pageVersionId !== undefined && workspace.pageVersionId !== pageVersionId) {
    throw new ArtifactReaderError(
      "artifact_workspace_page_version_mismatch",
      "Artifact workspace does not belong to the requested page version."
    );
  }
};

const validateFileScope = (
  file: ArtifactWorkspaceFileRecord,
  workspace: ArtifactWorkspaceRecord
): void => {
  if (file.workspaceId !== workspace.id) {
    throw new ArtifactReaderError(
      "artifact_workspace_file_integrity_mismatch",
      "Artifact workspace file does not belong to the requested workspace."
    );
  }
  if (file.projectId !== workspace.projectId) {
    throw new ArtifactReaderError(
      "artifact_workspace_file_project_mismatch",
      "Artifact workspace file does not belong to the workspace project."
    );
  }
  if (file.pageVersionId !== workspace.pageVersionId) {
    throw new ArtifactReaderError(
      "artifact_workspace_page_version_mismatch",
      "Artifact workspace file does not belong to the workspace page version."
    );
  }
};

const validateDiffFileScopes = (
  files: ArtifactWorkspaceFileRecord[],
  workspace: ArtifactWorkspaceRecord
): void => {
  for (const file of files) {
    validateFileScope(file, workspace);
  }
};

const getPageVersionForProjectOrThrow = async (
  repositories: WorkbenchRepositories,
  projectId: string,
  pageVersionId: string
): Promise<PageVersionRecord> => {
  const pageVersion = await repositories.pageVersions.getById(pageVersionId);
  if (!pageVersion || pageVersion.projectId !== projectId) {
    throw new ArtifactReaderError(
      "artifact_workspace_diff_not_available",
      `Page version artifact workspace is not available: ${pageVersionId}.`
    );
  }
  return pageVersion;
};
