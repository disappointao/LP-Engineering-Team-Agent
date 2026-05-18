import { createStaticArtifactWorkspaceFiles, type StaticArtifacts } from "@lp-agent/artifacts";
import { createInMemoryWorkbenchRepositories, type WorkbenchRepositories } from "@lp-agent/db";
import { sampleBrief } from "@lp-agent/lp-schema";
import { describe, expect, it } from "vitest";
import {
  ArtifactReaderError,
  type ArtifactReaderErrorCode,
  diffPageVersionArtifactWorkspaces,
  diffRepositoryArtifactWorkspaces,
  readRepositoryArtifactWorkspaceFile
} from "./artifact-reader";

const createdAt = "2026-05-18T00:00:00.000Z";

const baseArtifacts: StaticArtifacts = {
  indexHtml: "<!doctype html><html><body>SECRET_HTML</body></html>",
  stylesCss: "body { color: #123456; }",
  scriptJs: "console.log('ready');"
};

const changedArtifacts: StaticArtifacts = {
  ...baseArtifacts,
  stylesCss: "body { color: #abcdef; }"
};

const setupWorkspace = async (
  repositories: WorkbenchRepositories,
  input: {
    projectId?: string;
    workspaceId?: string;
    pageVersionId?: string;
    artifacts?: StaticArtifacts;
  } = {}
) => {
  const projectId = input.projectId ?? "project_1";
  const workspaceId = input.workspaceId ?? "artifact_workspace_1";
  const pageVersionId = input.pageVersionId ?? "version_1";
  await repositories.projects.save({
    id: projectId,
    name: "Project",
    createdAt
  });
  await repositories.briefs.save({
    id: `brief_${pageVersionId}`,
    projectId,
    prompt: "Build a static landing page.",
    brief: sampleBrief,
    createdAt
  });
  await repositories.pageVersions.save({
    id: pageVersionId,
    projectId,
    briefId: `brief_${pageVersionId}`,
    artifactWorkspaceId: workspaceId,
    artifacts: input.artifacts ?? baseArtifacts,
    reviewStatus: "pending",
    findings: [],
    createdAt
  });
  await repositories.artifactWorkspaces.save({
    id: workspaceId,
    projectId,
    pageVersionId,
    kind: "static_lp",
    state: "active",
    createdAt,
    updatedAt: createdAt
  });
  for (const file of createStaticArtifactWorkspaceFiles({
    workspaceId,
    projectId,
    pageVersionId,
    artifacts: input.artifacts ?? baseArtifacts,
    createdAt
  })) {
    await repositories.artifactWorkspaceFiles.save(file);
  }

  return { projectId, workspaceId, pageVersionId };
};

const expectArtifactReaderCode = async (
  action: Promise<unknown>,
  code: ArtifactReaderErrorCode
) => {
  await expect(action).rejects.toMatchObject({
    name: "ArtifactReaderError",
    code
  });
};

describe("repository artifact reader", () => {
  it("reads a workspace file after ownership checks", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const workspace = await setupWorkspace(repositories);

    const result = await readRepositoryArtifactWorkspaceFile({
      repositories,
      projectId: workspace.projectId,
      workspaceId: workspace.workspaceId,
      pageVersionId: workspace.pageVersionId,
      path: "styles.css",
      includeContent: true
    });

    expect(result).toMatchObject({
      workspaceId: workspace.workspaceId,
      projectId: workspace.projectId,
      pageVersionId: workspace.pageVersionId,
      file: {
        path: "styles.css",
        kind: "css",
        mimeType: "text/css"
      },
      content: baseArtifacts.stylesCss,
      truncated: false
    });
  });

  it("reads bounded content for every canonical static file", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const workspace = await setupWorkspace(repositories);

    const cases = [
      ["index.html", baseArtifacts.indexHtml],
      ["styles.css", baseArtifacts.stylesCss],
      ["script.js", baseArtifacts.scriptJs]
    ] as const;

    for (const [path, content] of cases) {
      const result = await readRepositoryArtifactWorkspaceFile({
        repositories,
        projectId: workspace.projectId,
        workspaceId: workspace.workspaceId,
        pageVersionId: workspace.pageVersionId,
        path,
        includeContent: true,
        maxBytes: content.length
      });

      expect(result.file.path).toBe(path);
      expect(result.content).toBe(content);
      expect(result.truncated).toBe(false);
    }
  });

  it("omits content from metadata-only reads by default", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const workspace = await setupWorkspace(repositories);

    const result = await readRepositoryArtifactWorkspaceFile({
      repositories,
      projectId: workspace.projectId,
      workspaceId: workspace.workspaceId,
      path: "index.html"
    });

    expect(result).not.toHaveProperty("content");
    expect(result).toMatchObject({
      truncated: false,
      omittedReason: "content_not_requested"
    });
    expect(JSON.stringify(result)).not.toContain("SECRET_HTML");
  });

  it("rejects path traversal before repository access", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const secretPath = "../index.html?token=LOCAL_PATH_SECRET";
    let workspaceLookups = 0;
    const originalGetById = repositories.artifactWorkspaces.getById.bind(
      repositories.artifactWorkspaces
    );
    repositories.artifactWorkspaces.getById = async (workspaceId) => {
      workspaceLookups += 1;
      return originalGetById(workspaceId);
    };

    await expectArtifactReaderCode(
      readRepositoryArtifactWorkspaceFile({
        repositories,
        projectId: "project_1",
        workspaceId: "artifact_workspace_1",
        path: secretPath
      }),
      "artifact_workspace_file_path_not_allowed"
    );
    await expect(
      readRepositoryArtifactWorkspaceFile({
        repositories,
        projectId: "project_1",
        workspaceId: "artifact_workspace_1",
        path: secretPath
      })
    ).rejects.not.toThrow(secretPath);
    expect(workspaceLookups).toBe(0);
  });

  it("rejects missing artifact workspaces", async () => {
    const repositories = createInMemoryWorkbenchRepositories();

    await expectArtifactReaderCode(
      readRepositoryArtifactWorkspaceFile({
        repositories,
        projectId: "project_1",
        workspaceId: "artifact_workspace_missing",
        path: "styles.css"
      }),
      "artifact_workspace_not_found"
    );
  });

  it("rejects missing artifact workspace files", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const workspace = await setupWorkspace(repositories);
    repositories.artifactWorkspaceFiles.getByPath = async () => undefined;

    await expectArtifactReaderCode(
      readRepositoryArtifactWorkspaceFile({
        repositories,
        projectId: workspace.projectId,
        workspaceId: workspace.workspaceId,
        path: "styles.css"
      }),
      "artifact_workspace_file_not_found"
    );
  });

  it("rejects invalid read byte limits as request errors", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const workspace = await setupWorkspace(repositories);

    await expectArtifactReaderCode(
      readRepositoryArtifactWorkspaceFile({
        repositories,
        projectId: workspace.projectId,
        workspaceId: workspace.workspaceId,
        path: "styles.css",
        includeContent: true,
        maxBytes: -1
      }),
      "artifact_workspace_read_limit_invalid"
    );
  });

  it("rejects project mismatches", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const workspace = await setupWorkspace(repositories);

    await expectArtifactReaderCode(
      readRepositoryArtifactWorkspaceFile({
        repositories,
        projectId: "project_2",
        workspaceId: workspace.workspaceId,
        path: "styles.css"
      }),
      "artifact_workspace_project_mismatch"
    );
  });

  it("rejects page version mismatches", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const workspace = await setupWorkspace(repositories);

    await expectArtifactReaderCode(
      readRepositoryArtifactWorkspaceFile({
        repositories,
        projectId: workspace.projectId,
        workspaceId: workspace.workspaceId,
        pageVersionId: "version_2",
        path: "styles.css"
      }),
      "artifact_workspace_page_version_mismatch"
    );
  });

  it("rejects corrupt file metadata", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const workspace = await setupWorkspace(repositories);
    const file = await repositories.artifactWorkspaceFiles.getByPath({
      workspaceId: workspace.workspaceId,
      path: "styles.css"
    });
    await repositories.artifactWorkspaceFiles.save({
      ...file!,
      sizeBytes: file!.sizeBytes + 1
    });

    await expectArtifactReaderCode(
      readRepositoryArtifactWorkspaceFile({
        repositories,
        projectId: workspace.projectId,
        workspaceId: workspace.workspaceId,
        path: "styles.css",
        includeContent: true
      }),
      "artifact_workspace_file_integrity_mismatch"
    );
  });

  it("returns metadata-only repository diffs with file states", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const from = await setupWorkspace(repositories, {
      workspaceId: "artifact_workspace_from",
      pageVersionId: "version_from"
    });
    const to = await setupWorkspace(repositories, {
      workspaceId: "artifact_workspace_to",
      pageVersionId: "version_to",
      artifacts: changedArtifacts
    });

    const diff = await diffRepositoryArtifactWorkspaces({
      repositories,
      projectId: from.projectId,
      fromWorkspaceId: from.workspaceId,
      toWorkspaceId: to.workspaceId
    });

    expect(diff.files.map((file) => [file.path, file.state])).toEqual([
      ["index.html", "unchanged"],
      ["styles.css", "changed"],
      ["script.js", "unchanged"]
    ]);
    expect(JSON.stringify(diff)).not.toContain(baseArtifacts.indexHtml);
    expect(JSON.stringify(diff)).not.toContain(changedArtifacts.stylesCss);
    expect(JSON.stringify(diff)).not.toContain("content");
  });

  it("rejects diff files with mismatched page versions", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const from = await setupWorkspace(repositories, {
      workspaceId: "artifact_workspace_from",
      pageVersionId: "version_from"
    });
    const to = await setupWorkspace(repositories, {
      workspaceId: "artifact_workspace_to",
      pageVersionId: "version_to",
      artifacts: changedArtifacts
    });
    const styles = await repositories.artifactWorkspaceFiles.getByPath({
      workspaceId: to.workspaceId,
      path: "styles.css"
    });
    await repositories.artifactWorkspaceFiles.save({
      ...styles!,
      pageVersionId: "version_wrong"
    });

    await expectArtifactReaderCode(
      diffRepositoryArtifactWorkspaces({
        repositories,
        projectId: from.projectId,
        fromWorkspaceId: from.workspaceId,
        toWorkspaceId: to.workspaceId
      }),
      "artifact_workspace_diff_not_available"
    );
  });

  it("resolves page version artifact workspaces for diffs", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const from = await setupWorkspace(repositories, {
      workspaceId: "artifact_workspace_from",
      pageVersionId: "version_from"
    });
    const to = await setupWorkspace(repositories, {
      workspaceId: "artifact_workspace_to",
      pageVersionId: "version_to",
      artifacts: changedArtifacts
    });

    const diff = await diffPageVersionArtifactWorkspaces({
      repositories,
      projectId: from.projectId,
      fromPageVersionId: from.pageVersionId,
      toPageVersionId: to.pageVersionId
    });

    expect(diff).toMatchObject({
      projectId: from.projectId,
      fromWorkspaceId: from.workspaceId,
      toWorkspaceId: to.workspaceId
    });
    expect(diff.files.find((file) => file.path === "styles.css")?.state).toBe("changed");
  });

  it("exposes ArtifactReaderError name and code", () => {
    const error = new ArtifactReaderError("artifact_workspace_not_found", "Workspace not found.");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ArtifactReaderError");
    expect(error.code).toBe("artifact_workspace_not_found");
  });
});
