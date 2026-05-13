import type { StaticArtifacts } from "@lp-agent/artifacts";
import type { DeploymentHandoff } from "@lp-agent/git-deployment";
import type { LPBrief, ReviewFinding } from "@lp-agent/lp-schema";

export interface ProjectRecord {
  id: string;
  name: string;
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

export type WorkbenchTaskType = "general_chat" | "lp_generation" | "project_setup";
export type WorkbenchTaskStatus = "complete";
export type WorkbenchMessageRole = "user" | "assistant";

export interface WorkbenchTaskRecord {
  id: string;
  title: string;
  type: WorkbenchTaskType;
  status: WorkbenchTaskStatus;
  projectId?: string;
  createdAt: string;
}

export interface WorkbenchMessageRecord {
  id: string;
  taskId: string;
  role: WorkbenchMessageRole;
  content: string;
  createdAt: string;
}

export interface WorkbenchTaskSnapshotRecord {
  taskId: string;
  projectId: string;
  briefId?: string;
  pageVersionId?: string;
  createdAt: string;
}

export interface ProjectRepository {
  save(project: ProjectRecord): Promise<void>;
  getById(projectId: string): Promise<ProjectRecord | undefined>;
  listAll(): Promise<ProjectRecord[]>;
}

export interface BriefRepository {
  save(brief: BriefRecord): Promise<void>;
  getById(briefId: string): Promise<BriefRecord | undefined>;
  findLatestForProject(projectId: string): Promise<BriefRecord | undefined>;
  listAll(): Promise<BriefRecord[]>;
}

export interface PageVersionRepository {
  save(pageVersion: PageVersionRecord): Promise<void>;
  getById(pageVersionId: string): Promise<PageVersionRecord | undefined>;
  findLatestForProject(projectId: string): Promise<PageVersionRecord | undefined>;
  listAll(): Promise<PageVersionRecord[]>;
}

export interface DeploymentRepository {
  save(deployment: DeploymentHandoff): Promise<void>;
  getByPageVersionId(pageVersionId: string): Promise<DeploymentHandoff | undefined>;
  findLatestForProject(projectId: string): Promise<DeploymentHandoff | undefined>;
}

export interface WorkbenchTaskRepository {
  save(task: WorkbenchTaskRecord): Promise<void>;
  getById(taskId: string): Promise<WorkbenchTaskRecord | undefined>;
  listAll(): Promise<WorkbenchTaskRecord[]>;
}

export interface WorkbenchMessageRepository {
  save(message: WorkbenchMessageRecord): Promise<void>;
  listForTask(taskId: string): Promise<WorkbenchMessageRecord[]>;
  listAll(): Promise<WorkbenchMessageRecord[]>;
}

export interface WorkbenchTaskSnapshotRepository {
  save(snapshot: WorkbenchTaskSnapshotRecord): Promise<void>;
  getByTaskId(taskId: string): Promise<WorkbenchTaskSnapshotRecord | undefined>;
}

export interface WorkbenchRepositories {
  projects: ProjectRepository;
  briefs: BriefRepository;
  pageVersions: PageVersionRepository;
  deployments: DeploymentRepository;
  tasks: WorkbenchTaskRepository;
  messages: WorkbenchMessageRepository;
  taskSnapshots: WorkbenchTaskSnapshotRepository;
}

export function createInMemoryWorkbenchRepositories(): WorkbenchRepositories {
  return new InMemoryWorkbenchRepositories();
}

class InMemoryWorkbenchRepositories implements WorkbenchRepositories {
  readonly projects = new InMemoryProjectRepository();
  readonly briefs = new InMemoryBriefRepository();
  readonly pageVersions = new InMemoryPageVersionRepository();
  readonly deployments = new InMemoryDeploymentRepository();
  readonly tasks = new InMemoryWorkbenchTaskRepository();
  readonly messages = new InMemoryWorkbenchMessageRepository();
  readonly taskSnapshots = new InMemoryWorkbenchTaskSnapshotRepository();
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

  async listAll(): Promise<ProjectRecord[]> {
    return [...this.projects.values()].map(copyProject);
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

  async listAll(): Promise<BriefRecord[]> {
    return [...this.briefs.values()].map(copyBriefRecord);
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

  async listAll(): Promise<PageVersionRecord[]> {
    return [...this.pageVersions.values()].map(copyPageVersion);
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

class InMemoryWorkbenchTaskRepository implements WorkbenchTaskRepository {
  private readonly tasks = new Map<string, WorkbenchTaskRecord>();

  async save(task: WorkbenchTaskRecord): Promise<void> {
    this.tasks.set(task.id, copyWorkbenchTask(task));
  }

  async getById(taskId: string): Promise<WorkbenchTaskRecord | undefined> {
    const task = this.tasks.get(taskId);
    return task ? copyWorkbenchTask(task) : undefined;
  }

  async listAll(): Promise<WorkbenchTaskRecord[]> {
    return [...this.tasks.values()].map(copyWorkbenchTask);
  }
}

class InMemoryWorkbenchMessageRepository implements WorkbenchMessageRepository {
  private readonly messages = new Map<string, WorkbenchMessageRecord>();

  async save(message: WorkbenchMessageRecord): Promise<void> {
    this.messages.set(message.id, copyWorkbenchMessage(message));
  }

  async listForTask(taskId: string): Promise<WorkbenchMessageRecord[]> {
    return [...this.messages.values()]
      .filter((message) => message.taskId === taskId)
      .map(copyWorkbenchMessage);
  }

  async listAll(): Promise<WorkbenchMessageRecord[]> {
    return [...this.messages.values()].map(copyWorkbenchMessage);
  }
}

class InMemoryWorkbenchTaskSnapshotRepository implements WorkbenchTaskSnapshotRepository {
  private readonly snapshotsByTask = new Map<string, WorkbenchTaskSnapshotRecord>();

  async save(snapshot: WorkbenchTaskSnapshotRecord): Promise<void> {
    this.snapshotsByTask.set(snapshot.taskId, copyWorkbenchTaskSnapshot(snapshot));
  }

  async getByTaskId(taskId: string): Promise<WorkbenchTaskSnapshotRecord | undefined> {
    const snapshot = this.snapshotsByTask.get(taskId);
    return snapshot ? copyWorkbenchTaskSnapshot(snapshot) : undefined;
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

function copyWorkbenchTask(task: WorkbenchTaskRecord): WorkbenchTaskRecord {
  return { ...task };
}

function copyWorkbenchMessage(message: WorkbenchMessageRecord): WorkbenchMessageRecord {
  return { ...message };
}

function copyWorkbenchTaskSnapshot(
  snapshot: WorkbenchTaskSnapshotRecord
): WorkbenchTaskSnapshotRecord {
  return { ...snapshot };
}
