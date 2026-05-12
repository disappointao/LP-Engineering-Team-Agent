import { describe, expect, it } from "vitest";
import { runDemoWorkerJob } from "./worker";

describe("agent worker", () => {
  it("runs the demo workbench flow and returns reviewed deployment records", async () => {
    const result = await runDemoWorkerJob();

    expect(result.project).toMatchObject({
      id: "project_1",
      name: "Demo LP Project"
    });
    expect(result.brief).toMatchObject({
      id: "brief_1",
      projectId: "project_1",
      prompt: "Create a lightweight spring ecommerce landing page."
    });
    expect(result.pageVersion).toMatchObject({
      id: "version_1",
      projectId: "project_1",
      briefId: "brief_1",
      reviewStatus: "passed",
      findings: []
    });
    expect(result.deployment).toMatchObject({
      id: "deployment_1",
      projectId: "project_1",
      pageVersionId: "version_1",
      branch: "lp-agent/project_1/version_1",
      status: "pr_opened"
    });
    expect(result.deployment.pullRequestUrl).toBe("https://git.example.local/pr/deployment_1");
  });
});
