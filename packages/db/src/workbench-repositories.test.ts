import { describe, expect, it } from "vitest";
import { sampleBrief } from "@lp-agent/lp-schema";
import {
  createInMemoryWorkbenchRepositories,
  type PageVersionRecord,
  type ProjectRecord
} from "./index";

const createdAt = "2026-05-12T00:00:00.000Z";

describe("in-memory workbench repositories", () => {
  it("persists projects and returns defensive copies", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const project: ProjectRecord = {
      id: "project_1",
      name: "Spring sale",
      repository: "git@example.com:shop/spring.git",
      createdAt
    };

    await repositories.projects.save(project);
    const saved = await repositories.projects.getById("project_1");
    project.name = "Mutated locally";

    expect(saved).toEqual({
      id: "project_1",
      name: "Spring sale",
      repository: "git@example.com:shop/spring.git",
      createdAt
    });
  });

  it("finds the latest brief, page version, and deployment for a project", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.projects.save({
      id: "project_1",
      name: "Spring sale",
      repository: "git@example.com:shop/spring.git",
      createdAt
    });
    await repositories.briefs.save({
      id: "brief_1",
      projectId: "project_1",
      prompt: "first prompt",
      brief: sampleBrief,
      createdAt
    });
    await repositories.briefs.save({
      id: "brief_2",
      projectId: "project_1",
      prompt: "second prompt",
      brief: { ...sampleBrief, title: "Second brief" },
      createdAt: "2026-05-12T00:01:00.000Z"
    });

    const pageVersion: PageVersionRecord = {
      id: "version_1",
      projectId: "project_1",
      briefId: "brief_2",
      artifacts: {
        indexHtml: "<!doctype html><html></html>",
        stylesCss: "body { margin: 0; }",
        scriptJs: "console.log('ready');"
      },
      reviewStatus: "passed",
      findings: [],
      createdAt: "2026-05-12T00:02:00.000Z"
    };
    await repositories.pageVersions.save(pageVersion);
    await repositories.deployments.save({
      id: "deployment_1",
      projectId: "project_1",
      pageVersionId: "version_1",
      branch: "lp-agent/project_1/version_1",
      commitSha: "mock_commit_1",
      pullRequestUrl: "https://git.example.local/pr/deployment_1",
      files: ["index.html", "styles.css", "script.js"],
      status: "pr_opened"
    });

    await expect(repositories.briefs.findLatestForProject("project_1")).resolves.toMatchObject({
      id: "brief_2",
      prompt: "second prompt"
    });
    await expect(repositories.pageVersions.findLatestForProject("project_1")).resolves.toMatchObject({
      id: "version_1",
      briefId: "brief_2"
    });
    await expect(repositories.deployments.findLatestForProject("project_1")).resolves.toMatchObject({
      id: "deployment_1",
      pageVersionId: "version_1"
    });
  });

  it("returns undefined when records are missing", async () => {
    const repositories = createInMemoryWorkbenchRepositories();

    await expect(repositories.projects.getById("missing")).resolves.toBeUndefined();
    await expect(repositories.briefs.getById("missing")).resolves.toBeUndefined();
    await expect(repositories.pageVersions.getById("missing")).resolves.toBeUndefined();
    await expect(repositories.deployments.getByPageVersionId("missing")).resolves.toBeUndefined();
  });
});
