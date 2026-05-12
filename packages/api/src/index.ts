import type { StaticArtifacts } from "@lp-agent/artifacts";
import {
  createInMemoryWorkbenchRepositories,
  type BriefRecord,
  type PageVersionRecord,
  type ProjectRecord,
  type ReviewStatus,
  type WorkbenchRepositories
} from "@lp-agent/db";
import {
  InMemoryGitDeploymentAdapter,
  type DeploymentHandoff,
  type GitDeploymentAdapter
} from "@lp-agent/git-deployment";
import { sampleBrief, type LPBrief, type ReviewFinding } from "@lp-agent/lp-schema";
import { computeVisibleTools, sampleConnector, type ApprovalState } from "@lp-agent/mcp-gateway";
import { InMemoryModelGateway, createDefaultModelPolicy } from "@lp-agent/model-gateway";
import {
  LocalAgentRuntimeAdapter,
  type AgentRuntimeAdapter,
  type RuntimeRunContext
} from "@lp-agent/runtime-adapters";
import { canUseSkill, sampleTemplateSkill, type SkillManifest } from "@lp-agent/skills";

export type {
  BriefRecord,
  PageVersionRecord,
  ProjectRecord,
  ReviewStatus
} from "@lp-agent/db";

export interface WorkbenchSnapshot {
  project: ProjectRecord;
  brief?: BriefRecord;
  currentPageVersion?: PageVersionRecord;
  deployment?: DeploymentHandoff;
}

export interface CreateProjectInput {
  name: string;
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
  repositories?: WorkbenchRepositories;
  builderRuntime?: AgentRuntimeAdapter;
  reviewerRuntime?: AgentRuntimeAdapter;
  deploymentAdapter?: GitDeploymentAdapter;
  now?: () => Date;
}

export class DemoWorkbenchService {
  private projectSequence = 0;
  private briefSequence = 0;
  private pageVersionSequence = 0;
  private readonly repositories: WorkbenchRepositories;
  private readonly builderRuntime: AgentRuntimeAdapter;
  private readonly reviewerRuntime: AgentRuntimeAdapter;
  private readonly deploymentAdapter: GitDeploymentAdapter;
  private readonly now: () => Date;

  constructor(options: DemoWorkbenchServiceOptions = {}) {
    this.repositories = options.repositories ?? createInMemoryWorkbenchRepositories();
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
      createdAt: this.timestamp()
    };
    await this.repositories.projects.save(project);
    return copyProject(project);
  }

  async createBriefFromPrompt(input: CreateBriefFromPromptInput): Promise<BriefRecord> {
    await this.getProjectOrThrow(input.projectId);

    this.briefSequence += 1;
    const brief: BriefRecord = {
      id: `brief_${this.briefSequence}`,
      projectId: input.projectId,
      prompt: input.prompt,
      brief: copyBrief(sampleBrief),
      createdAt: this.timestamp()
    };
    await this.repositories.briefs.save(brief);
    return copyBriefRecord(brief);
  }

  async generatePageVersion(input: GeneratePageVersionInput): Promise<PageVersionRecord> {
    await this.getProjectOrThrow(input.projectId);
    const brief = await this.getBriefForProjectOrThrow(input.projectId, input.briefId);
    const runId = `run_builder_${this.pageVersionSequence + 1}`;

    const result = await this.builderRuntime.run({
      runId,
      projectId: input.projectId,
      role: "builder",
      input: {
        brief: copyBrief(brief.brief),
        prompt: brief.prompt
      },
      context: createWorkbenchRuntimeContext("builder")
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
    await this.repositories.pageVersions.save(pageVersion);
    return copyPageVersion(pageVersion);
  }

  async reviewPageVersion(input: ReviewPageVersionInput): Promise<PageVersionRecord> {
    await this.getProjectOrThrow(input.projectId);
    const pageVersion = await this.getPageVersionForProjectOrThrow(input.projectId, input.pageVersionId);
    if (await this.repositories.deployments.getByPageVersionId(pageVersion.id)) {
      return copyPageVersion(pageVersion);
    }

    const brief = await this.getBriefForProjectOrThrow(input.projectId, pageVersion.briefId);

    const result = await this.reviewerRuntime.run({
      runId: `run_reviewer_${pageVersion.id}`,
      projectId: input.projectId,
      role: "reviewer",
      input: {
        brief: copyBrief(brief.brief),
        prompt: "Review for launch blockers."
      },
      context: createWorkbenchRuntimeContext("reviewer")
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
    await this.repositories.pageVersions.save(pageVersion);

    return copyPageVersion(pageVersion);
  }

  async approveAndCreateDeployment(input: ApproveAndCreateDeploymentInput): Promise<DeploymentHandoff> {
    await this.getProjectOrThrow(input.projectId);
    const pageVersion = await this.getPageVersionForProjectOrThrow(input.projectId, input.pageVersionId);
    if (input.reviewerUserId.trim().length === 0) {
      throw new Error("Reviewer user ID is required.");
    }
    if (pageVersion.reviewStatus !== "passed") {
      throw new Error("Page version must pass review before deployment.");
    }

    const existing = await this.repositories.deployments.getByPageVersionId(pageVersion.id);
    if (existing) {
      return copyDeployment(existing);
    }

    const deployment = await this.deploymentAdapter.createHandoff({
      projectId: input.projectId,
      pageVersionId: pageVersion.id,
      approved: true,
      artifacts: copyArtifacts(pageVersion.artifacts)
    });
    await this.repositories.deployments.save(deployment);
    return copyDeployment(deployment);
  }

  async getSnapshot(projectId: string): Promise<WorkbenchSnapshot> {
    const project = await this.getProjectOrThrow(projectId);
    const currentPageVersion = await this.repositories.pageVersions.findLatestForProject(projectId);
    const brief = currentPageVersion
      ? await this.repositories.briefs.getById(currentPageVersion.briefId)
      : await this.repositories.briefs.findLatestForProject(projectId);
    const deployment = await this.repositories.deployments.findLatestForProject(projectId);

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

  private async getProjectOrThrow(projectId: string): Promise<ProjectRecord> {
    const project = await this.repositories.projects.getById(projectId);
    if (!project) {
      throw new Error("Project not found.");
    }
    return project;
  }

  private async getBriefForProjectOrThrow(projectId: string, briefId: string): Promise<BriefRecord> {
    const brief = await this.repositories.briefs.getById(briefId);
    if (!brief || brief.projectId !== projectId) {
      throw new Error("Brief not found for project.");
    }
    return brief;
  }

  private async getPageVersionForProjectOrThrow(
    projectId: string,
    pageVersionId: string
  ): Promise<PageVersionRecord> {
    const pageVersion = await this.repositories.pageVersions.getById(pageVersionId);
    if (!pageVersion || pageVersion.projectId !== projectId) {
      throw new Error("Page version not found for project.");
    }
    return pageVersion;
  }
}

export function createDemoWorkbenchService(): DemoWorkbenchService {
  return new DemoWorkbenchService();
}

function createLocalRuntimeAdapter(): LocalAgentRuntimeAdapter {
  return new LocalAgentRuntimeAdapter(new InMemoryModelGateway(createDefaultModelPolicy()));
}

function createWorkbenchRuntimeContext(
  role: "planner" | "builder" | "reviewer" | "deployer",
  approvalState: ApprovalState = "not_required"
): RuntimeRunContext {
  const skill = createDefaultWorkbenchSkill();
  const grantedPermissions = [...skill.permissions];
  const skills = canUseSkill({
    manifest: skill,
    boundSkillIds: [skill.id],
    grantedPermissions
  })
    ? [toRuntimeSkill(skill)]
    : [];
  const mcpTools = computeVisibleTools({
    connectors: [sampleConnector],
    projectConnectorIds: [sampleConnector.id],
    skillPermissions: grantedPermissions,
    agentRole: role,
    approvalState
  }).map((tool) => ({
    connectorId: sampleConnector.id,
    name: tool.name,
    permission: tool.permission,
    requiresApproval: tool.requiresApproval
  }));

  return {
    skills,
    mcpTools,
    approval: {
      state: approvalState
    },
    artifactWorkspace: {
      mode: "memory",
      writableFiles: ["index.html", "styles.css", "script.js"]
    }
  };
}

function createDefaultWorkbenchSkill(): SkillManifest {
  return {
    ...sampleTemplateSkill,
    permissions: [...sampleTemplateSkill.permissions, "assets:read"]
  };
}

function toRuntimeSkill(skill: SkillManifest): RuntimeRunContext["skills"][number] {
  return {
    id: skill.id,
    name: skill.name,
    version: skill.version,
    scope: skill.scope,
    permissions: [...skill.permissions],
    entrypoints: [...skill.entrypoints]
  };
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
