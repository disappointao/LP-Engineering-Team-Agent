import { describe, expect, it } from "vitest";
import { InMemoryGitDeploymentAdapter } from "./index";
import type {
  DeploymentHandoff,
  DeploymentHandoffInput,
  GitDeploymentAdapter
} from "./index";

const artifact = {
  indexHtml: "<!doctype html><html><body>Landing page</body></html>",
  stylesCss: "body { margin: 0; }",
  scriptJs: "window.lpAgentReady = true;"
};

describe("git deployment adapter", () => {
  it("exports the deployment handoff contract used by orchestration packages", () => {
    const input: DeploymentHandoffInput = {
      projectId: "project_1",
      pageVersionId: "page_version_1",
      artifact,
      approved: true
    };
    const handoff: DeploymentHandoff = {
      id: "deployment_1",
      projectId: input.projectId,
      pageVersionId: input.pageVersionId,
      branch: "lp-agent/project_1/page_version_1",
      commitSha: "mock_commit_1",
      pullRequestUrl: "https://git.example.local/pr/deployment_1",
      files: ["index.html", "styles.css", "script.js"],
      status: "pr_opened"
    };

    expect(handoff.status).toBe("pr_opened");
  });

  it("rejects deployment handoff creation without approval", async () => {
    const adapter = new InMemoryGitDeploymentAdapter();

    await expect(
      adapter.createHandoff({
        projectId: "project_1",
        pageVersionId: "page_version_1",
        artifact,
        approved: false
      })
    ).rejects.toThrow("Deployment handoff requires approval.");
  });

  it("creates deterministic pull request handoff records for approved artifacts", async () => {
    const adapter: GitDeploymentAdapter = new InMemoryGitDeploymentAdapter();

    const first = await adapter.createHandoff({
      projectId: "project_1",
      pageVersionId: "page_version_1",
      artifact,
      approved: true
    });
    const second = await adapter.createHandoff({
      projectId: "project_2",
      pageVersionId: "page_version_2",
      artifact,
      approved: true
    });

    expect(first).toEqual({
      id: "deployment_1",
      projectId: "project_1",
      pageVersionId: "page_version_1",
      branch: "lp-agent/project_1/page_version_1",
      commitSha: "mock_commit_1",
      pullRequestUrl: "https://git.example.local/pr/deployment_1",
      files: ["index.html", "styles.css", "script.js"],
      status: "pr_opened"
    });
    expect(second).toEqual({
      id: "deployment_2",
      projectId: "project_2",
      pageVersionId: "page_version_2",
      branch: "lp-agent/project_2/page_version_2",
      commitSha: "mock_commit_2",
      pullRequestUrl: "https://git.example.local/pr/deployment_2",
      files: ["index.html", "styles.css", "script.js"],
      status: "pr_opened"
    });
  });
});
