import type { StaticArtifacts } from "@lp-agent/artifacts";

export interface DeploymentHandoffInput {
  projectId: string;
  pageVersionId: string;
  artifacts: StaticArtifacts;
  approved: boolean;
}

export interface DeploymentHandoff {
  id: string;
  projectId: string;
  pageVersionId: string;
  branch: string;
  commitSha: string;
  pullRequestUrl: string;
  files: ["index.html", "styles.css", "script.js"];
  status: "pr_opened";
}

export interface GitDeploymentAdapter {
  createHandoff(input: DeploymentHandoffInput): Promise<DeploymentHandoff>;
}

export class InMemoryGitDeploymentAdapter implements GitDeploymentAdapter {
  private sequence = 0;
  private readonly handoffs: DeploymentHandoff[] = [];

  async createHandoff(input: DeploymentHandoffInput): Promise<DeploymentHandoff> {
    if (!input.approved) {
      throw new Error("Deployment handoff requires approval.");
    }

    this.sequence += 1;
    const id = `deployment_${this.sequence}`;
    const handoff: DeploymentHandoff = {
      id,
      projectId: input.projectId,
      pageVersionId: input.pageVersionId,
      branch: `lp-agent/${input.projectId}/${input.pageVersionId}`,
      commitSha: `mock_commit_${this.sequence}`,
      pullRequestUrl: `https://git.example.local/pr/${id}`,
      files: ["index.html", "styles.css", "script.js"],
      status: "pr_opened"
    };

    this.handoffs.push(handoff);
    return handoff;
  }
}
