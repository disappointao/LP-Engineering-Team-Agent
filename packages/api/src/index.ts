import type { StaticArtifacts } from "@lp-agent/artifacts";
import {
  InMemoryGitDeploymentAdapter,
  type DeploymentHandoff,
  type GitDeploymentAdapter
} from "@lp-agent/git-deployment";
import { sampleBrief, type LPBrief, type ReviewFinding } from "@lp-agent/lp-schema";
import { InMemoryModelGateway, createDefaultModelPolicy } from "@lp-agent/model-gateway";
import {
  LocalAgentRuntimeAdapter,
  type AgentRuntimeAdapter
} from "@lp-agent/runtime-adapters";

export interface ProjectRecord {
  id: string;
  name: string;
  repository: string;
  createdAt: string;
}

export interface BriefRecord {
  id: string;
  projectId: string;
  prompt: string;
  brief: LPBrief;
  createdAt: string;
}

export type ReviewStatus = "pending" | "passed" | "failed";

export interface PageVersionRecord {
  id: string;
  projectId: string;
  briefId: string;
  artifacts: StaticArtifacts;
  reviewStatus: ReviewStatus;
  findings: ReviewFinding[];
  createdAt: string;
}

export interface WorkbenchSnapshot {
  project: ProjectRecord;
  brief?: BriefRecord;
  currentPageVersion?: PageVersionRecord;
  deployment?: DeploymentHandoff;
}

export interface CreateProjectInput {
  name: string;
  repository: string;
}

export interface CreateBriefFromPromptInput {
  projectId: string;
  prompt: string;
}

export interface GeneratePageVersionInput {
  projectId: string;
  briefId: string;
}

export interface ReviewPageVersionInput {
  projectId: string;
  pageVersionId: string;
}

export interface ApproveAndCreateDeploymentInput {
  projectId: string;
  pageVersionId: string;
  reviewerUserId: string;
}

export interface DemoWorkbenchServiceOptions {
  builderRuntime?: AgentRuntimeAdapter;
  reviewerRuntime?: AgentRuntimeAdapter;
  deploymentAdapter?: GitDeploymentAdapter;
  now?: () => Date;
}

export class DemoWorkbenchService {
  private projectSequence = 0;
  private briefSequence = 0;
  private pageVersionSequence = 0;
  private readonly projects = new Map<string, ProjectRecord>();
  private readonly briefs = new Map<string, BriefRecord>();
  private readonly pageVersions = new Map<string, PageVersionRecord>();
  private readonly deploymentsByPageVersion = new Map<string, DeploymentHandoff>();
  private readonly builderRuntime: AgentRuntimeAdapter;
  private readonly reviewerRuntime: AgentRuntimeAdapter;
  private readonly deploymentAdapter: GitDeploymentAdapter;
  private readonly now: () => Date;

  constructor(options: DemoWorkbenchServiceOptions = {}) {
    this.builderRuntime = options.builderRuntime ?? createLocalRuntimeAdapter();
    this.reviewerRuntime = options.reviewerRuntime ?? createLocalRuntimeAdapter();
    this.deploymentAdapter = options.deploymentAdapter ?? new InMemoryGitDeploymentAdapter();
    this.now = options.now ?? (() => new Date());
  }

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    this.projectSequence += 1;
    const project: ProjectRecord = {
      id: `project_${this.projectSequence}`,
      name: input.name,
      repository: input.repository,
      createdAt: this.timestamp()
    };
    this.projects.set(project.id, project);
    return copyProject(project);
  }

  async createBriefFromPrompt(input: CreateBriefFromPromptInput): Promise<BriefRecord> {
    this.getProjectOrThrow(input.projectId);

    this.briefSequence += 1;
    const brief: BriefRecord = {
      id: `brief_${this.briefSequence}`,
      projectId: input.projectId,
      prompt: input.prompt,
      brief: copyBrief(sampleBrief),
      createdAt: this.timestamp()
    };
    this.briefs.set(brief.id, brief);
    return copyBriefRecord(brief);
  }

  async generatePageVersion(input: GeneratePageVersionInput): Promise<PageVersionRecord> {
    this.getProjectOrThrow(input.projectId);
    const brief = this.getBriefForProjectOrThrow(input.projectId, input.briefId);
    const runId = `run_builder_${this.pageVersionSequence + 1}`;

    const result = await this.builderRuntime.run({
      runId,
      projectId: input.projectId,
      role: "builder",
      input: {
        brief: copyBrief(brief.brief),
        prompt: brief.prompt
      }
    });

    if (result.state === "failed") {
      throw new Error("Builder run failed.");
    }
    if (result.state !== "completed") {
      throw new Error("Builder run did not complete.");
    }
    if (!result.artifacts) {
      throw new Error("Builder run did not return artifacts.");
    }
    if (!hasCompleteArtifacts(result.artifacts)) {
      throw new Error("Builder run returned incomplete artifacts.");
    }

    this.pageVersionSequence += 1;
    const pageVersion: PageVersionRecord = {
      id: `version_${this.pageVersionSequence}`,
      projectId: input.projectId,
      briefId: brief.id,
      artifacts: copyArtifacts(result.artifacts),
      reviewStatus: "pending",
      findings: [],
      createdAt: this.timestamp()
    };
    this.pageVersions.set(pageVersion.id, pageVersion);
    return copyPageVersion(pageVersion);
  }

  async reviewPageVersion(input: ReviewPageVersionInput): Promise<PageVersionRecord> {
    this.getProjectOrThrow(input.projectId);
    const pageVersion = this.getPageVersionForProjectOrThrow(input.projectId, input.pageVersionId);
    if (this.deploymentsByPageVersion.has(pageVersion.id)) {
      return copyPageVersion(pageVersion);
    }

    const brief = this.getBriefForProjectOrThrow(input.projectId, pageVersion.briefId);

    const result = await this.reviewerRuntime.run({
      runId: `run_reviewer_${pageVersion.id}`,
      projectId: input.projectId,
      role: "reviewer",
      input: {
        brief: copyBrief(brief.brief),
        prompt: "Review for launch blockers."
      }
    });

    if (result.state === "failed") {
      throw new Error("Reviewer run failed.");
    }
    if (result.state !== "completed") {
      throw new Error("Reviewer run did not complete.");
    }

    const findings = (result.findings ?? []).map(copyFinding);
    pageVersion.findings = findings;
    pageVersion.reviewStatus = findings.some((finding) => finding.blocksDeployment || finding.severity === "blocking")
      ? "failed"
      : "passed";

    return copyPageVersion(pageVersion);
  }

  async approveAndCreateDeployment(input: ApproveAndCreateDeploymentInput): Promise<DeploymentHandoff> {
    this.getProjectOrThrow(input.projectId);
    const pageVersion = this.getPageVersionForProjectOrThrow(input.projectId, input.pageVersionId);
    if (input.reviewerUserId.trim().length === 0) {
      throw new Error("Reviewer user ID is required.");
    }
    if (pageVersion.reviewStatus !== "passed") {
      throw new Error("Page version must pass review before deployment.");
    }

    const existing = this.deploymentsByPageVersion.get(pageVersion.id);
    if (existing) {
      return copyDeployment(existing);
    }

    const deployment = await this.deploymentAdapter.createHandoff({
      projectId: input.projectId,
      pageVersionId: pageVersion.id,
      approved: true,
      artifacts: copyArtifacts(pageVersion.artifacts)
    });
    this.deploymentsByPageVersion.set(pageVersion.id, deployment);
    return copyDeployment(deployment);
  }

  async getSnapshot(projectId: string): Promise<WorkbenchSnapshot> {
    const project = this.getProjectOrThrow(projectId);
    const currentPageVersion = this.findLatestPageVersion(projectId);
    const brief = currentPageVersion
      ? this.briefs.get(currentPageVersion.briefId)
      : this.findLatestBrief(projectId);
    const deployment = this.findLatestDeployment(projectId);

    return {
      project: copyProject(project),
      brief: brief ? copyBriefRecord(brief) : undefined,
      currentPageVersion: currentPageVersion ? copyPageVersion(currentPageVersion) : undefined,
      deployment: deployment ? copyDeployment(deployment) : undefined
    };
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private getProjectOrThrow(projectId: string): ProjectRecord {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error("Project not found.");
    }
    return project;
  }

  private getBriefForProjectOrThrow(projectId: string, briefId: string): BriefRecord {
    const brief = this.briefs.get(briefId);
    if (!brief || brief.projectId !== projectId) {
      throw new Error("Brief not found for project.");
    }
    return brief;
  }

  private getPageVersionForProjectOrThrow(projectId: string, pageVersionId: string): PageVersionRecord {
    const pageVersion = this.pageVersions.get(pageVersionId);
    if (!pageVersion || pageVersion.projectId !== projectId) {
      throw new Error("Page version not found for project.");
    }
    return pageVersion;
  }

  private findLatestBrief(projectId: string): BriefRecord | undefined {
    return [...this.briefs.values()]
      .filter((brief) => brief.projectId === projectId)
      .at(-1);
  }

  private findLatestPageVersion(projectId: string): PageVersionRecord | undefined {
    return [...this.pageVersions.values()]
      .filter((pageVersion) => pageVersion.projectId === projectId)
      .at(-1);
  }

  private findLatestDeployment(projectId: string): DeploymentHandoff | undefined {
    return [...this.deploymentsByPageVersion.values()]
      .filter((deployment) => deployment.projectId === projectId)
      .at(-1);
  }
}

export function createDemoWorkbenchService(): DemoWorkbenchService {
  return new DemoWorkbenchService();
}

function createLocalRuntimeAdapter(): LocalAgentRuntimeAdapter {
  return new LocalAgentRuntimeAdapter(new InMemoryModelGateway(createDefaultModelPolicy()));
}

function copyProject(project: ProjectRecord): ProjectRecord {
  return { ...project };
}

function copyBriefRecord(record: BriefRecord): BriefRecord {
  return {
    ...record,
    brief: copyBrief(record.brief)
  };
}

function copyBrief(brief: LPBrief): LPBrief {
  return structuredClone(brief);
}

function copyPageVersion(pageVersion: PageVersionRecord): PageVersionRecord {
  return {
    ...pageVersion,
    artifacts: copyArtifacts(pageVersion.artifacts),
    findings: pageVersion.findings.map(copyFinding)
  };
}

function copyArtifacts(artifacts: StaticArtifacts): StaticArtifacts {
  return { ...artifacts };
}

function hasCompleteArtifacts(artifacts: StaticArtifacts): boolean {
  return (
    isNonEmptyString(artifacts.indexHtml) &&
    isNonEmptyString(artifacts.stylesCss) &&
    isNonEmptyString(artifacts.scriptJs)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function copyFinding(finding: ReviewFinding): ReviewFinding {
  return { ...finding };
}

function copyDeployment(deployment: DeploymentHandoff): DeploymentHandoff {
  return {
    ...deployment,
    files: [...deployment.files]
  };
}
