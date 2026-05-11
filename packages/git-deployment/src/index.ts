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
  private readonly handoffsByPageVersion = new Map<string, DeploymentHandoff>();

  async createHandoff(input: DeploymentHandoffInput): Promise<DeploymentHandoff> {
    if (!input.approved) {
      throw new Error("Deployment handoff requires approval.");
    }

    assertBranchSafeIdentifier(input.projectId);
    assertBranchSafeIdentifier(input.pageVersionId);
    assertCompleteStaticArtifacts(input.artifacts);

    const handoffKey = `${input.projectId}:${input.pageVersionId}`;
    const existing = this.handoffsByPageVersion.get(handoffKey);
    if (existing) {
      return copyHandoff(existing);
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
    this.handoffsByPageVersion.set(handoffKey, handoff);
    return copyHandoff(handoff);
  }
}

function assertBranchSafeIdentifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("Deployment handoff identifiers must be branch safe.");
  }
}

function assertCompleteStaticArtifacts(artifacts: unknown): asserts artifacts is StaticArtifacts {
  if (!artifacts || typeof artifacts !== "object") {
    throw new Error("Deployment handoff requires complete static artifacts.");
  }

  const candidate = artifacts as Partial<StaticArtifacts>;
  if (
    !isNonEmptyString(candidate.indexHtml) ||
    !isNonEmptyString(candidate.stylesCss) ||
    !isNonEmptyString(candidate.scriptJs)
  ) {
    throw new Error("Deployment handoff requires complete static artifacts.");
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function copyHandoff(handoff: DeploymentHandoff): DeploymentHandoff {
  return {
    ...handoff,
    files: [...handoff.files]
  };
}
