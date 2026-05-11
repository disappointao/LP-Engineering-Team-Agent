import { describe, expect, it } from "vitest";
import type { StaticArtifacts } from "@lp-agent/artifacts";
import type { DeploymentHandoff, GitDeploymentAdapter } from "@lp-agent/git-deployment";
import { sampleBrief, type ReviewFinding } from "@lp-agent/lp-schema";
import type {
  AgentRuntimeAdapter,
  RuntimeRunRequest,
  RuntimeRunResult
} from "@lp-agent/runtime-adapters";
import {
  DemoWorkbenchService,
  createDemoWorkbenchService,
  type BriefRecord,
  type PageVersionRecord,
  type ProjectRecord,
  type WorkbenchSnapshot
} from "./index";

describe("demo workbench service", () => {
  it("exports record contracts used by API consumers", () => {
    const project: ProjectRecord = {
      id: "project_1",
      name: "Spring sale",
      repository: "git@example.com:acme/spring.git",
      createdAt: "2026-05-11T00:00:00.000Z"
    };
    const brief: BriefRecord = {
      id: "brief_1",
      projectId: project.id,
      prompt: "Build a sale page",
      brief: sampleBrief,
      createdAt: project.createdAt
    };
    const version: PageVersionRecord = {
      id: "version_1",
      projectId: project.id,
      briefId: brief.id,
      artifacts: completeArtifacts(),
      reviewStatus: "pending",
      findings: [],
      createdAt: project.createdAt
    };
    const snapshot: WorkbenchSnapshot = {
      project,
      brief,
      currentPageVersion: version
    };

    expect(snapshot.currentPageVersion?.id).toBe("version_1");
  });

  it("creates a project, prompt brief, page version, passing review, and deployment handoff", async () => {
    const service = createDemoWorkbenchService();

    const project = await service.createProject({
      name: "Spring sale",
      repository: "git@example.com:acme/spring.git"
    });
    const brief = await service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Build a concise ecommerce landing page."
    });
    const pageVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });
    const reviewed = await service.reviewPageVersion({
      projectId: project.id,
      pageVersionId: pageVersion.id
    });
    const deployment = await service.approveAndCreateDeployment({
      projectId: project.id,
      pageVersionId: pageVersion.id,
      reviewerUserId: "reviewer_1"
    });
    const snapshot = await service.getSnapshot(project.id);

    expect(project).toMatchObject({
      id: "project_1",
      name: "Spring sale",
      repository: "git@example.com:acme/spring.git"
    });
    expect(brief).toMatchObject({
      id: "brief_1",
      projectId: "project_1",
      prompt: "Build a concise ecommerce landing page.",
      brief: sampleBrief
    });
    expect(pageVersion).toMatchObject({
      id: "version_1",
      projectId: "project_1",
      briefId: "brief_1",
      reviewStatus: "pending",
      findings: []
    });
    expect(pageVersion.artifacts.indexHtml).toContain("Spring essentials, ready today");
    expect(reviewed.reviewStatus).toBe("passed");
    expect(reviewed.findings).toEqual([]);
    expect(deployment).toMatchObject({
      id: "deployment_1",
      projectId: "project_1",
      pageVersionId: "version_1",
      branch: "lp-agent/project_1/version_1",
      status: "pr_opened"
    });
    expect(snapshot).toMatchObject({
      project,
      brief,
      currentPageVersion: reviewed,
      deployment
    });
  });

  it("uses branch-safe generated IDs for deployment", async () => {
    const deploymentAdapter = new RecordingDeploymentAdapter();
    const service = new DemoWorkbenchService({
      deploymentAdapter,
      now: fixedClock()
    });

    const project = await service.createProject({ name: "Project", repository: "repo" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
    const version = await service.generatePageVersion({ projectId: project.id, briefId: brief.id });
    await service.reviewPageVersion({ projectId: project.id, pageVersionId: version.id });
    await service.approveAndCreateDeployment({
      projectId: project.id,
      pageVersionId: version.id,
      reviewerUserId: "reviewer_1"
    });

    expect(deploymentAdapter.inputs[0]).toMatchObject({
      projectId: "project_1",
      pageVersionId: "version_1",
      approved: true
    });
  });

  it("passes default skill, MCP, approval, and artifact workspace context into runtime runs", async () => {
    const builderRuntime = new RecordingRuntime({ state: "completed", artifacts: completeArtifacts() });
    const reviewerRuntime = new RecordingRuntime({ state: "completed", findings: [] });
    const service = new DemoWorkbenchService({
      builderRuntime,
      reviewerRuntime,
      now: fixedClock()
    });

    const project = await service.createProject({ name: "Project", repository: "repo" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
    const version = await service.generatePageVersion({ projectId: project.id, briefId: brief.id });
    await service.reviewPageVersion({ projectId: project.id, pageVersionId: version.id });

    expect(builderRuntime.requests[0]?.context).toMatchObject({
      skills: [
        {
          id: "skill_brand",
          scope: "project",
          permissions: ["brief:read", "artifact:write", "assets:read"]
        }
      ],
      mcpTools: [
        {
          connectorId: "connector_assets",
          name: "searchAssets",
          permission: "assets:read"
        }
      ],
      approval: {
        state: "not_required"
      },
      artifactWorkspace: {
        mode: "memory",
        writableFiles: ["index.html", "styles.css", "script.js"]
      }
    });
    expect(reviewerRuntime.requests[0]?.context?.mcpTools.map((tool) => tool.name)).toEqual([
      "searchAssets"
    ]);
  });

  it("fails page generation when the builder runtime fails", async () => {
    const service = new DemoWorkbenchService({
      builderRuntime: new StaticRuntime({ state: "failed", artifacts: undefined }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project", repository: "repo" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });

    await expect(
      service.generatePageVersion({ projectId: project.id, briefId: brief.id })
    ).rejects.toThrow("Builder run failed.");
  });

  it("requires builder artifacts before creating a page version", async () => {
    const service = new DemoWorkbenchService({
      builderRuntime: new StaticRuntime({ state: "completed", artifacts: undefined }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project", repository: "repo" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });

    await expect(
      service.generatePageVersion({ projectId: project.id, briefId: brief.id })
    ).rejects.toThrow("Builder run did not return artifacts.");
  });

  it("rejects incomplete builder artifacts before creating a page version", async () => {
    const service = new DemoWorkbenchService({
      builderRuntime: new StaticRuntime({
        state: "completed",
        artifacts: { ...completeArtifacts(), stylesCss: " " }
      }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project", repository: "repo" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });

    await expect(
      service.generatePageVersion({ projectId: project.id, briefId: brief.id })
    ).rejects.toThrow("Builder run returned incomplete artifacts.");
  });

  it("does not create a page version from a non-completed builder run", async () => {
    const service = new DemoWorkbenchService({
      builderRuntime: new StaticRuntime({ state: "needs_input", artifacts: completeArtifacts() }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project", repository: "repo" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });

    await expect(
      service.generatePageVersion({ projectId: project.id, briefId: brief.id })
    ).rejects.toThrow("Builder run did not complete.");
  });

  it("marks review failed when reviewer returns blocking findings and blocks deployment", async () => {
    const blockingFinding: ReviewFinding = {
      severity: "blocking",
      target: "section:section_hero",
      explanation: "Hero section is missing a CTA.",
      suggestedFix: "Add a CTA.",
      blocksDeployment: true
    };
    const service = new DemoWorkbenchService({
      reviewerRuntime: new StaticRuntime({
        state: "completed",
        findings: [blockingFinding]
      }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project", repository: "repo" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
    const version = await service.generatePageVersion({ projectId: project.id, briefId: brief.id });

    const reviewed = await service.reviewPageVersion({ projectId: project.id, pageVersionId: version.id });

    expect(reviewed.reviewStatus).toBe("failed");
    expect(reviewed.findings).toEqual([blockingFinding]);
    await expect(
      service.approveAndCreateDeployment({
        projectId: project.id,
        pageVersionId: version.id,
        reviewerUserId: "reviewer_1"
      })
    ).rejects.toThrow("Page version must pass review before deployment.");
  });

  it("does not treat a failed reviewer runtime as a passed review", async () => {
    const service = new DemoWorkbenchService({
      reviewerRuntime: new StaticRuntime({ state: "failed" }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project", repository: "repo" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
    const version = await service.generatePageVersion({ projectId: project.id, briefId: brief.id });

    await expect(
      service.reviewPageVersion({ projectId: project.id, pageVersionId: version.id })
    ).rejects.toThrow("Reviewer run failed.");
  });

  it("does not treat a non-completed reviewer runtime as a passed review", async () => {
    const service = new DemoWorkbenchService({
      reviewerRuntime: new StaticRuntime({ state: "needs_approval", findings: [] }),
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project", repository: "repo" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
    const version = await service.generatePageVersion({ projectId: project.id, briefId: brief.id });

    await expect(
      service.reviewPageVersion({ projectId: project.id, pageVersionId: version.id })
    ).rejects.toThrow("Reviewer run did not complete.");
  });

  it("does not let re-review invalidate a deployed page version", async () => {
    const laterBlockingFinding: ReviewFinding = {
      severity: "blocking",
      target: "section:section_hero",
      explanation: "Later review failed.",
      suggestedFix: "Do not mutate deployed review.",
      blocksDeployment: true
    };
    const reviewerRuntime = new MutableRuntime({ state: "completed", findings: [] });
    const service = new DemoWorkbenchService({
      reviewerRuntime,
      now: fixedClock()
    });
    const project = await service.createProject({ name: "Project", repository: "repo" });
    const brief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Prompt" });
    const version = await service.generatePageVersion({ projectId: project.id, briefId: brief.id });
    const reviewed = await service.reviewPageVersion({ projectId: project.id, pageVersionId: version.id });
    const deployment = await service.approveAndCreateDeployment({
      projectId: project.id,
      pageVersionId: version.id,
      reviewerUserId: "reviewer_1"
    });

    reviewerRuntime.result = { state: "completed", findings: [laterBlockingFinding] };
    const retryReview = await service.reviewPageVersion({ projectId: project.id, pageVersionId: version.id });
    const snapshot = await service.getSnapshot(project.id);

    expect(reviewed.reviewStatus).toBe("passed");
    expect(retryReview.reviewStatus).toBe("passed");
    expect(retryReview.findings).toEqual([]);
    expect(snapshot.currentPageVersion?.reviewStatus).toBe("passed");
    expect(snapshot.deployment).toEqual(deployment);
  });

  it("keeps the latest deployment visible when a newer page version is pending", async () => {
    const service = createDemoWorkbenchService();
    const project = await service.createProject({ name: "Project", repository: "repo" });
    const firstBrief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "First" });
    const firstVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: firstBrief.id
    });
    await service.reviewPageVersion({ projectId: project.id, pageVersionId: firstVersion.id });
    const deployment = await service.approveAndCreateDeployment({
      projectId: project.id,
      pageVersionId: firstVersion.id,
      reviewerUserId: "reviewer_1"
    });
    const secondBrief = await service.createBriefFromPrompt({ projectId: project.id, prompt: "Second" });
    const secondVersion = await service.generatePageVersion({
      projectId: project.id,
      briefId: secondBrief.id
    });

    const snapshot = await service.getSnapshot(project.id);

    expect(snapshot.currentPageVersion?.id).toBe(secondVersion.id);
    expect(snapshot.currentPageVersion?.reviewStatus).toBe("pending");
    expect(snapshot.deployment).toEqual(deployment);
  });

  it("rejects requests for unknown or mismatched records", async () => {
    const service = createDemoWorkbenchService();
    const firstProject = await service.createProject({ name: "First", repository: "repo-1" });
    const secondProject = await service.createProject({ name: "Second", repository: "repo-2" });
    const brief = await service.createBriefFromPrompt({ projectId: firstProject.id, prompt: "Prompt" });
    const version = await service.generatePageVersion({ projectId: firstProject.id, briefId: brief.id });

    await expect(service.createBriefFromPrompt({ projectId: "project_404", prompt: "Prompt" }))
      .rejects.toThrow("Project not found.");
    await expect(service.generatePageVersion({ projectId: secondProject.id, briefId: brief.id }))
      .rejects.toThrow("Brief not found for project.");
    await expect(service.reviewPageVersion({ projectId: secondProject.id, pageVersionId: version.id }))
      .rejects.toThrow("Page version not found for project.");
    await expect(service.getSnapshot("project_404")).rejects.toThrow("Project not found.");
  });
});

class StaticRuntime implements AgentRuntimeAdapter {
  constructor(private readonly result: Partial<RuntimeRunResult>) {}

  async run(request: RuntimeRunRequest): Promise<RuntimeRunResult> {
    return {
      runId: request.runId,
      projectId: request.projectId,
      role: request.role,
      state: this.result.state ?? "completed",
      events: [],
      artifacts: this.result.artifacts,
      findings: this.result.findings
    };
  }
}

class MutableRuntime implements AgentRuntimeAdapter {
  constructor(public result: Partial<RuntimeRunResult>) {}

  async run(request: RuntimeRunRequest): Promise<RuntimeRunResult> {
    return {
      runId: request.runId,
      projectId: request.projectId,
      role: request.role,
      state: this.result.state ?? "completed",
      events: [],
      artifacts: this.result.artifacts,
      findings: this.result.findings
    };
  }
}

class RecordingRuntime extends StaticRuntime {
  readonly requests: RuntimeRunRequest[] = [];

  override async run(request: RuntimeRunRequest): Promise<RuntimeRunResult> {
    this.requests.push(request);
    return super.run(request);
  }
}

class RecordingDeploymentAdapter implements GitDeploymentAdapter {
  readonly inputs: Array<{
    projectId: string;
    pageVersionId: string;
    artifacts: StaticArtifacts;
    approved: boolean;
  }> = [];

  async createHandoff(input: {
    projectId: string;
    pageVersionId: string;
    artifacts: StaticArtifacts;
    approved: boolean;
  }): Promise<DeploymentHandoff> {
    this.inputs.push(input);
    return {
      id: "deployment_1",
      projectId: input.projectId,
      pageVersionId: input.pageVersionId,
      branch: `lp-agent/${input.projectId}/${input.pageVersionId}`,
      commitSha: "mock_commit_1",
      pullRequestUrl: "https://git.example.local/pr/deployment_1",
      files: ["index.html", "styles.css", "script.js"],
      status: "pr_opened"
    };
  }
}

function completeArtifacts(): StaticArtifacts {
  return {
    indexHtml: "<!doctype html><html></html>",
    stylesCss: ":root {}",
    scriptJs: "window.lpAgent = true;"
  };
}

function fixedClock(): () => Date {
  return () => new Date("2026-05-11T00:00:00.000Z");
}
