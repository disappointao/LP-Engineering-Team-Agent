import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { DeploymentHandoff } from "@lp-agent/git-deployment";
import type {
  BriefRecord,
  BriefRepository,
  DeploymentRepository,
  MCPConnectorRecord,
  MCPConnectorRepository,
  MCPToolApprovalRecord,
  MCPToolApprovalRepository,
  ModelProviderRecord,
  ModelProviderRepository,
  ModelRoutingPolicyRecord,
  ModelRoutingPolicyRepository,
  PageVersionRecord,
  PageVersionRepository,
  ProjectRecord,
  ProjectRepository,
  SkillBindingRecord,
  SkillBindingRepository,
  SkillRecord,
  SkillRepository,
  SkillVersionRecord,
  SkillVersionRepository,
  WorkbenchMessageRecord,
  WorkbenchMessageRepository,
  WorkbenchRepositories,
  WorkbenchTaskRecord,
  WorkbenchTaskRepository,
  WorkbenchTaskSnapshotRecord,
  WorkbenchTaskSnapshotRepository
} from "./workbench-repositories";

export interface JsonFileWorkbenchRepositoriesOptions {
  filePath: string;
}

interface JsonFileWorkbenchState {
  projects: ProjectRecord[];
  briefs: BriefRecord[];
  pageVersions: PageVersionRecord[];
  deployments: DeploymentHandoff[];
  tasks: WorkbenchTaskRecord[];
  messages: WorkbenchMessageRecord[];
  taskSnapshots: WorkbenchTaskSnapshotRecord[];
  skills: SkillRecord[];
  skillVersions: SkillVersionRecord[];
  skillBindings: SkillBindingRecord[];
  modelProviders: ModelProviderRecord[];
  modelRoutingPolicies: ModelRoutingPolicyRecord[];
  mcpConnectors: MCPConnectorRecord[];
  mcpToolApprovals: MCPToolApprovalRecord[];
}

const writeQueuesByFilePath = new Map<string, Promise<void>>();
const repositoriesByFilePath = new Map<string, WorkbenchRepositories>();

export function createJsonFileWorkbenchRepositories(
  options: JsonFileWorkbenchRepositoriesOptions
): WorkbenchRepositories {
  const filePath = resolve(options.filePath);
  const existingRepositories = repositoriesByFilePath.get(filePath);
  if (existingRepositories) {
    return existingRepositories;
  }

  const repositories = new JsonFileWorkbenchRepositories(filePath);
  repositoriesByFilePath.set(filePath, repositories);
  return repositories;
}

class JsonFileWorkbenchRepositories implements WorkbenchRepositories {
  readonly projects: ProjectRepository;
  readonly briefs: BriefRepository;
  readonly pageVersions: PageVersionRepository;
  readonly deployments: DeploymentRepository;
  readonly tasks: WorkbenchTaskRepository;
  readonly messages: WorkbenchMessageRepository;
  readonly taskSnapshots: WorkbenchTaskSnapshotRepository;
  readonly skills: SkillRepository;
  readonly skillVersions: SkillVersionRepository;
  readonly skillBindings: SkillBindingRepository;
  readonly modelProviders: ModelProviderRepository;
  readonly modelRoutingPolicies: ModelRoutingPolicyRepository;
  readonly mcpConnectors: MCPConnectorRepository;
  readonly mcpToolApprovals: MCPToolApprovalRepository;

  constructor(filePath: string) {
    this.projects = new JsonFileProjectRepository(filePath);
    this.briefs = new JsonFileBriefRepository(filePath);
    this.pageVersions = new JsonFilePageVersionRepository(filePath);
    this.deployments = new JsonFileDeploymentRepository(filePath);
    this.tasks = new JsonFileWorkbenchTaskRepository(filePath);
    this.messages = new JsonFileWorkbenchMessageRepository(filePath);
    this.taskSnapshots = new JsonFileWorkbenchTaskSnapshotRepository(filePath);
    this.skills = new JsonFileSkillRepository(filePath);
    this.skillVersions = new JsonFileSkillVersionRepository(filePath);
    this.skillBindings = new JsonFileSkillBindingRepository(filePath);
    this.modelProviders = new JsonFileModelProviderRepository(filePath);
    this.modelRoutingPolicies = new JsonFileModelRoutingPolicyRepository(filePath);
    this.mcpConnectors = new JsonFileMCPConnectorRepository(filePath);
    this.mcpToolApprovals = new JsonFileMCPToolApprovalRepository(filePath);
  }
}

class JsonFileSkillRepository implements SkillRepository {
  constructor(private readonly filePath: string) {}

  async save(skill: SkillRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.skills = upsertBy(state.skills, copy(skill), (record) => record.id === skill.id);
    });
  }

  async getById(skillId: string): Promise<SkillRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.skills.find((skill) => skill.id === skillId));
  }

  async listAll(): Promise<SkillRecord[]> {
    const state = await readState(this.filePath);
    return state.skills.map(copy);
  }
}

class JsonFileSkillVersionRepository implements SkillVersionRepository {
  constructor(private readonly filePath: string) {}

  async save(version: SkillVersionRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.skillVersions = upsertBy(
        state.skillVersions,
        copy(version),
        (record) => record.id === version.id
      );
    });
  }

  async getById(versionId: string): Promise<SkillVersionRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.skillVersions.find((version) => version.id === versionId));
  }

  async getBySkillIdAndVersion(
    skillId: string,
    version: string
  ): Promise<SkillVersionRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(
      state.skillVersions.find(
        (record) => record.skillId === skillId && record.version === version
      )
    );
  }

  async listForSkill(skillId: string): Promise<SkillVersionRecord[]> {
    const state = await readState(this.filePath);
    return state.skillVersions.filter((version) => version.skillId === skillId).map(copy);
  }

  async listAll(): Promise<SkillVersionRecord[]> {
    const state = await readState(this.filePath);
    return state.skillVersions.map(copy);
  }
}

class JsonFileSkillBindingRepository implements SkillBindingRepository {
  constructor(private readonly filePath: string) {}

  async save(binding: SkillBindingRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.skillBindings = upsertBy(
        state.skillBindings,
        copy(binding),
        (record) => record.id === binding.id
      );
    });
  }

  async getById(bindingId: string): Promise<SkillBindingRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.skillBindings.find((binding) => binding.id === bindingId));
  }

  async listForProject(projectId: string): Promise<SkillBindingRecord[]> {
    const state = await readState(this.filePath);
    return state.skillBindings.filter((binding) => binding.projectId === projectId).map(copy);
  }

  async listAll(): Promise<SkillBindingRecord[]> {
    const state = await readState(this.filePath);
    return state.skillBindings.map(copy);
  }
}

class JsonFileModelProviderRepository implements ModelProviderRepository {
  constructor(private readonly filePath: string) {}

  async save(provider: ModelProviderRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.modelProviders = upsertBy(
        state.modelProviders,
        copy(provider),
        (record) => record.id === provider.id
      );
    });
  }

  async getById(providerId: string): Promise<ModelProviderRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.modelProviders.find((provider) => provider.id === providerId));
  }

  async listForProject(projectId: string): Promise<ModelProviderRecord[]> {
    const state = await readState(this.filePath);
    return state.modelProviders
      .filter((provider) => provider.scope === "project" && provider.targetKey === projectId)
      .map(copy);
  }

  async listAll(): Promise<ModelProviderRecord[]> {
    const state = await readState(this.filePath);
    return state.modelProviders.map(copy);
  }
}

class JsonFileModelRoutingPolicyRepository implements ModelRoutingPolicyRepository {
  constructor(private readonly filePath: string) {}

  async save(policy: ModelRoutingPolicyRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.modelRoutingPolicies = upsertBy(
        state.modelRoutingPolicies,
        copy(policy),
        (record) => record.id === policy.id
      );
    });
  }

  async getById(policyId: string): Promise<ModelRoutingPolicyRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.modelRoutingPolicies.find((policy) => policy.id === policyId));
  }

  async getByProjectAndRole(
    projectId: string,
    role: ModelRoutingPolicyRecord["role"]
  ): Promise<ModelRoutingPolicyRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(
      state.modelRoutingPolicies.find(
        (policy) =>
          policy.scope === "project" && policy.targetKey === projectId && policy.role === role
      )
    );
  }

  async listForProject(projectId: string): Promise<ModelRoutingPolicyRecord[]> {
    const state = await readState(this.filePath);
    return state.modelRoutingPolicies
      .filter((policy) => policy.scope === "project" && policy.targetKey === projectId)
      .map(copy);
  }

  async listAll(): Promise<ModelRoutingPolicyRecord[]> {
    const state = await readState(this.filePath);
    return state.modelRoutingPolicies.map(copy);
  }
}

class JsonFileMCPConnectorRepository implements MCPConnectorRepository {
  constructor(private readonly filePath: string) {}

  async save(connector: MCPConnectorRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.mcpConnectors = upsertBy(
        state.mcpConnectors,
        copy(connector),
        (record) => record.id === connector.id
      );
    });
  }

  async getById(connectorId: string): Promise<MCPConnectorRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.mcpConnectors.find((connector) => connector.id === connectorId));
  }

  async listForProject(projectId: string): Promise<MCPConnectorRecord[]> {
    const state = await readState(this.filePath);
    return state.mcpConnectors
      .filter((connector) => connector.scope === "project" && connector.targetKey === projectId)
      .map(copy);
  }

  async listAll(): Promise<MCPConnectorRecord[]> {
    const state = await readState(this.filePath);
    return state.mcpConnectors.map(copy);
  }
}

class JsonFileMCPToolApprovalRepository implements MCPToolApprovalRepository {
  constructor(private readonly filePath: string) {}

  async save(approval: MCPToolApprovalRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.mcpToolApprovals = upsertBy(
        state.mcpToolApprovals,
        copy(approval),
        (record) => record.id === approval.id
      );
    });
  }

  async getByProjectConnectorAndTool(
    projectId: string,
    connectorId: string,
    toolName: string
  ): Promise<MCPToolApprovalRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(
      state.mcpToolApprovals.find(
        (approval) =>
          approval.projectId === projectId &&
          approval.connectorId === connectorId &&
          approval.toolName === toolName
      )
    );
  }

  async listForProject(projectId: string): Promise<MCPToolApprovalRecord[]> {
    const state = await readState(this.filePath);
    return state.mcpToolApprovals
      .filter((approval) => approval.projectId === projectId)
      .map(copy);
  }

  async listAll(): Promise<MCPToolApprovalRecord[]> {
    const state = await readState(this.filePath);
    return state.mcpToolApprovals.map(copy);
  }
}

class JsonFileProjectRepository implements ProjectRepository {
  constructor(private readonly filePath: string) {}

  async save(project: ProjectRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.projects = upsertBy(state.projects, copy(project), (record) => record.id === project.id);
    });
  }

  async getById(projectId: string): Promise<ProjectRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.projects.find((project) => project.id === projectId));
  }

  async listAll(): Promise<ProjectRecord[]> {
    const state = await readState(this.filePath);
    return state.projects.map(copy);
  }
}

class JsonFileBriefRepository implements BriefRepository {
  constructor(private readonly filePath: string) {}

  async save(brief: BriefRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.briefs = upsertBy(state.briefs, copy(brief), (record) => record.id === brief.id);
    });
  }

  async getById(briefId: string): Promise<BriefRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.briefs.find((brief) => brief.id === briefId));
  }

  async findLatestForProject(projectId: string): Promise<BriefRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.briefs.filter((brief) => brief.projectId === projectId).at(-1));
  }

  async listAll(): Promise<BriefRecord[]> {
    const state = await readState(this.filePath);
    return state.briefs.map(copy);
  }
}

class JsonFilePageVersionRepository implements PageVersionRepository {
  constructor(private readonly filePath: string) {}

  async save(pageVersion: PageVersionRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.pageVersions = upsertBy(
        state.pageVersions,
        copy(pageVersion),
        (record) => record.id === pageVersion.id
      );
    });
  }

  async getById(pageVersionId: string): Promise<PageVersionRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.pageVersions.find((pageVersion) => pageVersion.id === pageVersionId));
  }

  async findLatestForProject(projectId: string): Promise<PageVersionRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(
      state.pageVersions.filter((pageVersion) => pageVersion.projectId === projectId).at(-1)
    );
  }

  async listAll(): Promise<PageVersionRecord[]> {
    const state = await readState(this.filePath);
    return state.pageVersions.map(copy);
  }
}

class JsonFileDeploymentRepository implements DeploymentRepository {
  constructor(private readonly filePath: string) {}

  async save(deployment: DeploymentHandoff): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.deployments = upsertBy(
        state.deployments,
        copy(deployment),
        (record) => record.pageVersionId === deployment.pageVersionId
      );
    });
  }

  async getByPageVersionId(pageVersionId: string): Promise<DeploymentHandoff | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(
      state.deployments.find((deployment) => deployment.pageVersionId === pageVersionId)
    );
  }

  async findLatestForProject(projectId: string): Promise<DeploymentHandoff | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(
      state.deployments.filter((deployment) => deployment.projectId === projectId).at(-1)
    );
  }
}

class JsonFileWorkbenchTaskRepository implements WorkbenchTaskRepository {
  constructor(private readonly filePath: string) {}

  async save(task: WorkbenchTaskRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.tasks = upsertBy(state.tasks, copy(task), (record) => record.id === task.id);
    });
  }

  async getById(taskId: string): Promise<WorkbenchTaskRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.tasks.find((task) => task.id === taskId));
  }

  async listAll(): Promise<WorkbenchTaskRecord[]> {
    const state = await readState(this.filePath);
    return state.tasks.map(copy);
  }
}

class JsonFileWorkbenchMessageRepository implements WorkbenchMessageRepository {
  constructor(private readonly filePath: string) {}

  async save(message: WorkbenchMessageRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.messages = upsertBy(
        state.messages,
        copy(message),
        (record) => record.id === message.id
      );
    });
  }

  async listForTask(taskId: string): Promise<WorkbenchMessageRecord[]> {
    const state = await readState(this.filePath);
    return state.messages.filter((message) => message.taskId === taskId).map(copy);
  }

  async listAll(): Promise<WorkbenchMessageRecord[]> {
    const state = await readState(this.filePath);
    return state.messages.map(copy);
  }
}

class JsonFileWorkbenchTaskSnapshotRepository implements WorkbenchTaskSnapshotRepository {
  constructor(private readonly filePath: string) {}

  async save(snapshot: WorkbenchTaskSnapshotRecord): Promise<void> {
    await updateState(this.filePath, (state) => {
      state.taskSnapshots = upsertBy(
        state.taskSnapshots,
        copy(snapshot),
        (record) => record.taskId === snapshot.taskId
      );
    });
  }

  async getByTaskId(taskId: string): Promise<WorkbenchTaskSnapshotRecord | undefined> {
    const state = await readState(this.filePath);
    return copyOptional(state.taskSnapshots.find((snapshot) => snapshot.taskId === taskId));
  }
}

async function updateState(
  filePath: string,
  update: (state: JsonFileWorkbenchState) => void
): Promise<void> {
  await enqueueWrite(filePath, async () => {
    const state = await readState(filePath);
    update(state);
    await writeState(filePath, state);
  });
}

async function enqueueWrite(filePath: string, write: () => Promise<void>): Promise<void> {
  const previousWrite = writeQueuesByFilePath.get(filePath) ?? Promise.resolve();
  const nextWrite = previousWrite.catch(() => undefined).then(write);
  writeQueuesByFilePath.set(filePath, nextWrite);

  try {
    await nextWrite;
  } finally {
    if (writeQueuesByFilePath.get(filePath) === nextWrite) {
      writeQueuesByFilePath.delete(filePath);
    }
  }
}

async function readState(filePath: string): Promise<JsonFileWorkbenchState> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<JsonFileWorkbenchState>;
    return {
      projects: parsed.projects ?? [],
      briefs: parsed.briefs ?? [],
      pageVersions: parsed.pageVersions ?? [],
      deployments: parsed.deployments ?? [],
      tasks: parsed.tasks ?? [],
      messages: parsed.messages ?? [],
      taskSnapshots: parsed.taskSnapshots ?? [],
      skills: parsed.skills ?? [],
      skillVersions: parsed.skillVersions ?? [],
      skillBindings: parsed.skillBindings ?? [],
      modelProviders: parsed.modelProviders ?? [],
      modelRoutingPolicies: parsed.modelRoutingPolicies ?? [],
      mcpConnectors: parsed.mcpConnectors ?? [],
      mcpToolApprovals: parsed.mcpToolApprovals ?? []
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return emptyState();
    }
    throw error;
  }
}

async function writeState(filePath: string, state: JsonFileWorkbenchState): Promise<void> {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });
  const tempPath = join(directory, `.${process.pid}.${randomUUID()}.workbench-state.tmp`);
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function emptyState(): JsonFileWorkbenchState {
  return {
    projects: [],
    briefs: [],
    pageVersions: [],
    deployments: [],
    tasks: [],
    messages: [],
    taskSnapshots: [],
    skills: [],
    skillVersions: [],
    skillBindings: [],
    modelProviders: [],
    modelRoutingPolicies: [],
    mcpConnectors: [],
    mcpToolApprovals: []
  };
}

function upsertBy<T>(records: T[], record: T, matches: (candidate: T) => boolean): T[] {
  const next = [...records];
  const index = next.findIndex(matches);
  if (index === -1) {
    next.push(record);
  } else {
    next[index] = record;
  }
  return next;
}

function copy<T>(record: T): T {
  return structuredClone(record);
}

function copyOptional<T>(record: T | undefined): T | undefined {
  return record ? copy(record) : undefined;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
