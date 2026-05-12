import type { StaticArtifacts } from "@lp-agent/artifacts";
import type { DeploymentHandoff } from "@lp-agent/git-deployment";
import type { LPBrief, ReviewFinding } from "@lp-agent/lp-schema";

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

export interface ProjectRepository {
  save(project: ProjectRecord): Promise<void>;
  getById(projectId: string): Promise<ProjectRecord | undefined>;
}

export interface BriefRepository {
  save(brief: BriefRecord): Promise<void>;
  getById(briefId: string): Promise<BriefRecord | undefined>;
  findLatestForProject(projectId: string): Promise<BriefRecord | undefined>;
}

export interface PageVersionRepository {
  save(pageVersion: PageVersionRecord): Promise<void>;
  getById(pageVersionId: string): Promise<PageVersionRecord | undefined>;
  findLatestForProject(projectId: string): Promise<PageVersionRecord | undefined>;
}

export interface DeploymentRepository {
  save(deployment: DeploymentHandoff): Promise<void>;
  getByPageVersionId(pageVersionId: string): Promise<DeploymentHandoff | undefined>;
  findLatestForProject(projectId: string): Promise<DeploymentHandoff | undefined>;
}

export interface WorkbenchRepositories {
  projects: ProjectRepository;
  briefs: BriefRepository;
  pageVersions: PageVersionRepository;
  deployments: DeploymentRepository;
}

export function createInMemoryWorkbenchRepositories(): WorkbenchRepositories {
  return new InMemoryWorkbenchRepositories();
}

class InMemoryWorkbenchRepositories implements WorkbenchRepositories {
  readonly projects = new InMemoryProjectRepository();
  readonly briefs = new InMemoryBriefRepository();
  readonly pageVersions = new InMemoryPageVersionRepository();
  readonly deployments = new InMemoryDeploymentRepository();
}

class InMemoryProjectRepository implements ProjectRepository {
  private readonly projects = new Map<string, ProjectRecord>();

  async save(project: ProjectRecord): Promise<void> {
    this.projects.set(project.id, copyProject(project));
  }

  async getById(projectId: string): Promise<ProjectRecord | undefined> {
    const project = this.projects.get(projectId);
    return project ? copyProject(project) : undefined;
  }
}

class InMemoryBriefRepository implements BriefRepository {
  private readonly briefs = new Map<string, BriefRecord>();

  async save(brief: BriefRecord): Promise<void> {
    this.briefs.set(brief.id, copyBriefRecord(brief));
  }

  async getById(briefId: string): Promise<BriefRecord | undefined> {
    const brief = this.briefs.get(briefId);
    return brief ? copyBriefRecord(brief) : undefined;
  }

  async findLatestForProject(projectId: string): Promise<BriefRecord | undefined> {
    const brief = [...this.briefs.values()]
      .filter((record) => record.projectId === projectId)
      .at(-1);
    return brief ? copyBriefRecord(brief) : undefined;
  }
}

class InMemoryPageVersionRepository implements PageVersionRepository {
  private readonly pageVersions = new Map<string, PageVersionRecord>();

  async save(pageVersion: PageVersionRecord): Promise<void> {
    this.pageVersions.set(pageVersion.id, copyPageVersion(pageVersion));
  }

  async getById(pageVersionId: string): Promise<PageVersionRecord | undefined> {
    const pageVersion = this.pageVersions.get(pageVersionId);
    return pageVersion ? copyPageVersion(pageVersion) : undefined;
  }

  async findLatestForProject(projectId: string): Promise<PageVersionRecord | undefined> {
    const pageVersion = [...this.pageVersions.values()]
      .filter((record) => record.projectId === projectId)
      .at(-1);
    return pageVersion ? copyPageVersion(pageVersion) : undefined;
  }
}

class InMemoryDeploymentRepository implements DeploymentRepository {
  private readonly deploymentsByPageVersion = new Map<string, DeploymentHandoff>();

  async save(deployment: DeploymentHandoff): Promise<void> {
    this.deploymentsByPageVersion.set(deployment.pageVersionId, copyDeployment(deployment));
  }

  async getByPageVersionId(pageVersionId: string): Promise<DeploymentHandoff | undefined> {
    const deployment = this.deploymentsByPageVersion.get(pageVersionId);
    return deployment ? copyDeployment(deployment) : undefined;
  }

  async findLatestForProject(projectId: string): Promise<DeploymentHandoff | undefined> {
    const deployment = [...this.deploymentsByPageVersion.values()]
      .filter((record) => record.projectId === projectId)
      .at(-1);
    return deployment ? copyDeployment(deployment) : undefined;
  }
}

function copyProject(project: ProjectRecord): ProjectRecord {
  return { ...project };
}

function copyBriefRecord(record: BriefRecord): BriefRecord {
  return {
    ...record,
    brief: structuredClone(record.brief)
  };
}

function copyPageVersion(pageVersion: PageVersionRecord): PageVersionRecord {
  return {
    ...pageVersion,
    artifacts: { ...pageVersion.artifacts },
    findings: pageVersion.findings.map((finding) => ({ ...finding }))
  };
}

function copyDeployment(deployment: DeploymentHandoff): DeploymentHandoff {
  return {
    ...deployment,
    files: [...deployment.files]
  };
}
