import type { StaticArtifacts } from "@lp-agent/artifacts";
import {
  createInMemoryWorkbenchRepositories,
  type BriefRecord,
  type PageVersionRecord,
  type ProjectRecord,
  type ReviewStatus,
  type SkillBindingRecord,
  type SkillContentType,
  type SkillRecord,
  type SkillVersionRecord,
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
import {
  SkillManifestSchema,
  canPublishSkill,
  canUseSkill,
  type SkillManifest
} from "@lp-agent/skills";

const repositoryIdLocks = new WeakMap<WorkbenchRepositories, Promise<void>>();
const repositoryIdReservations = new WeakMap<WorkbenchRepositories, Set<string>>();

export type {
  BriefRecord,
  PageVersionRecord,
  ProjectRecord,
  ReviewStatus,
  SkillBindingRecord,
  SkillContentType,
  SkillRecord,
  SkillVersionRecord
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

export interface GetSnapshotForRecordsInput {
  projectId: string;
  briefId?: string;
  pageVersionId?: string;
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

export interface CreateSkillDraftInput {
  manifestJson: string;
  content: string;
  contentType: SkillContentType;
}

export interface SkillDraftResult {
  skill: SkillRecord;
  version: SkillVersionRecord;
}

export interface SkillVersionInput {
  skillVersionId: string;
}

export interface BindSkillVersionToProjectInput {
  projectId: string;
  skillVersionId: string;
}

export interface SetProjectSkillBindingEnabledInput {
  projectId: string;
  bindingId: string;
  enabled: boolean;
}

export interface ProjectBoundSkillState {
  skill: SkillRecord;
  version: SkillVersionRecord;
  binding: SkillBindingRecord;
}

export interface ProjectSkillState {
  boundSkills: ProjectBoundSkillState[];
  availableVersions: SkillVersionRecord[];
}

export interface DemoWorkbenchServiceOptions {
  repositories?: WorkbenchRepositories;
  builderRuntime?: AgentRuntimeAdapter;
  reviewerRuntime?: AgentRuntimeAdapter;
  deploymentAdapter?: GitDeploymentAdapter;
  now?: () => Date;
}

export class DemoWorkbenchService {
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
    return withRepositoryIdLock(this.repositories, async () => {
      const existingProjects = await this.repositories.projects.listAll();
      const project: ProjectRecord = {
        id: nextSequentialId("project", existingProjects.map((record) => record.id)),
        name: input.name,
        createdAt: this.timestamp()
      };
      await this.repositories.projects.save(project);
      return copyProject(project);
    });
  }

  async createBriefFromPrompt(input: CreateBriefFromPromptInput): Promise<BriefRecord> {
    await this.getProjectOrThrow(input.projectId);

    return withRepositoryIdLock(this.repositories, async () => {
      const existingBriefs = await this.repositories.briefs.listAll();
      const brief: BriefRecord = {
        id: nextSequentialId("brief", existingBriefs.map((record) => record.id)),
        projectId: input.projectId,
        prompt: input.prompt,
        brief: copyBrief(sampleBrief),
        createdAt: this.timestamp()
      };
      await this.repositories.briefs.save(brief);
      return copyBriefRecord(brief);
    });
  }

  async generatePageVersion(input: GeneratePageVersionInput): Promise<PageVersionRecord> {
    await this.getProjectOrThrow(input.projectId);
    const brief = await this.getBriefForProjectOrThrow(input.projectId, input.briefId);
    const pageVersionId = await reserveRepositoryId(this.repositories, "version", async () => {
      const existingPageVersions = await this.repositories.pageVersions.listAll();
      return existingPageVersions.map((record) => record.id);
    });

    try {
      const result = await this.builderRuntime.run({
        runId: `run_builder_${pageVersionId.replace(/^version_/, "")}`,
        projectId: input.projectId,
        role: "builder",
        input: {
          brief: copyBrief(brief.brief),
          prompt: brief.prompt
        },
        context: await this.createRuntimeContext(input.projectId, "builder")
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
      const artifacts = result.artifacts;

      return await withRepositoryIdLock(this.repositories, async () => {
        const pageVersion: PageVersionRecord = {
          id: pageVersionId,
          projectId: input.projectId,
          briefId: brief.id,
          artifacts: copyArtifacts(artifacts),
          reviewStatus: "pending",
          findings: [],
          createdAt: this.timestamp()
        };
        await this.repositories.pageVersions.save(pageVersion);
        return copyPageVersion(pageVersion);
      });
    } finally {
      releaseRepositoryId(this.repositories, pageVersionId);
    }
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
      context: await this.createRuntimeContext(input.projectId, "reviewer")
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

  async getSnapshotForRecords(input: GetSnapshotForRecordsInput): Promise<WorkbenchSnapshot> {
    const project = await this.getProjectOrThrow(input.projectId);
    let brief = input.briefId
      ? await this.getBriefForProjectOrThrow(input.projectId, input.briefId)
      : undefined;
    let currentPageVersion = input.pageVersionId
      ? await this.getPageVersionForProjectOrThrow(input.projectId, input.pageVersionId)
      : undefined;

    if (brief && currentPageVersion && currentPageVersion.briefId !== brief.id) {
      throw new Error("Page version does not belong to brief.");
    }

    if (brief && !currentPageVersion) {
      currentPageVersion = await this.findLatestPageVersionForBrief(input.projectId, brief.id);
    }
    if (!brief && currentPageVersion) {
      brief = await this.getBriefForProjectOrThrow(input.projectId, currentPageVersion.briefId);
    }
    if (!brief && !currentPageVersion) {
      currentPageVersion = await this.repositories.pageVersions.findLatestForProject(input.projectId);
      brief = currentPageVersion
        ? await this.repositories.briefs.getById(currentPageVersion.briefId)
        : await this.repositories.briefs.findLatestForProject(input.projectId);
    }

    const deployment = currentPageVersion
      ? await this.repositories.deployments.getByPageVersionId(currentPageVersion.id)
      : undefined;

    return {
      project: copyProject(project),
      brief: brief ? copyBriefRecord(brief) : undefined,
      currentPageVersion: currentPageVersion ? copyPageVersion(currentPageVersion) : undefined,
      deployment: deployment ? copyDeployment(deployment) : undefined
    };
  }

  async createSkillDraft(input: CreateSkillDraftInput): Promise<SkillDraftResult> {
    const manifest = parseProjectSkillManifest(input.manifestJson);
    const content = normalizeSkillContent(input.content);
    const contentType = normalizeSkillContentType(input.contentType);
    const existingVersion = await this.repositories.skillVersions.getBySkillIdAndVersion(
      manifest.id,
      manifest.version
    );
    if (existingVersion) {
      throw new Error("duplicate_skill_version");
    }

    return withRepositoryIdLock(this.repositories, async () => {
      const duplicate = await this.repositories.skillVersions.getBySkillIdAndVersion(
        manifest.id,
        manifest.version
      );
      if (duplicate) {
        throw new Error("duplicate_skill_version");
      }

      const existingVersions = await this.repositories.skillVersions.listAll();
      const existingSkill = await this.repositories.skills.getById(manifest.id);
      const skill: SkillRecord = {
        id: manifest.id,
        name: manifest.name,
        type: manifest.type,
        scope: manifest.scope,
        createdAt: existingSkill?.createdAt ?? this.timestamp()
      };
      const version: SkillVersionRecord = {
        id: nextSequentialId("skill_version", existingVersions.map((record) => record.id)),
        skillId: manifest.id,
        version: manifest.version,
        manifest: {
          ...manifest,
          reviewState: "draft"
        },
        content,
        contentType,
        reviewState: "draft",
        createdAt: this.timestamp()
      };

      await this.repositories.skills.save(skill);
      await this.repositories.skillVersions.save(version);

      return {
        skill: copySkillRecord(skill),
        version: copySkillVersionRecord(version)
      };
    });
  }

  async validateSkillVersion(input: SkillVersionInput): Promise<SkillVersionRecord> {
    const version = await this.getSkillVersionOrThrow(input.skillVersionId);
    if (version.reviewState === "validated" || version.reviewState === "published") {
      return copySkillVersionRecord(version);
    }
    if (version.reviewState !== "draft") {
      throw new Error("skill_operation_failed");
    }
    const updated = updateSkillVersionReviewState(version, "validated");
    await this.repositories.skillVersions.save(updated);
    return copySkillVersionRecord(updated);
  }

  async publishSkillVersion(input: SkillVersionInput): Promise<SkillVersionRecord> {
    const version = await this.getSkillVersionOrThrow(input.skillVersionId);
    if (version.reviewState !== "validated" && version.reviewState !== "published") {
      throw new Error("skill_version_not_validated");
    }
    const decision = canPublishSkill("owner", version.manifest);
    if (!decision.allowed) {
      throw new Error("skill_version_not_publishable");
    }

    const updated = updateSkillVersionReviewState(version, "published");
    await this.repositories.skillVersions.save(updated);
    return copySkillVersionRecord(updated);
  }

  async bindSkillVersionToProject(
    input: BindSkillVersionToProjectInput
  ): Promise<SkillBindingRecord> {
    await this.getProjectOrThrow(input.projectId);
    const version = await this.getSkillVersionOrThrow(input.skillVersionId);
    if (version.reviewState !== "published" || version.manifest.reviewState !== "published") {
      throw new Error("skill_version_not_published");
    }

    const existingBindings = await this.repositories.skillBindings.listForProject(input.projectId);
    const existing = existingBindings.find(
      (binding) =>
        isProjectSkillBindingForProject(binding, input.projectId) &&
        binding.skillVersionId === input.skillVersionId
    );
    if (existing) {
      throw new Error("skill_binding_already_exists");
    }

    return withRepositoryIdLock(this.repositories, async () => {
      const duplicateBindings = await this.repositories.skillBindings.listForProject(input.projectId);
      const duplicate = duplicateBindings.find(
        (binding) =>
          isProjectSkillBindingForProject(binding, input.projectId) &&
          binding.skillVersionId === input.skillVersionId
      );
      if (duplicate) {
        throw new Error("skill_binding_already_exists");
      }

      const allBindings = await this.repositories.skillBindings.listAll();
      const binding: SkillBindingRecord = {
        id: nextSequentialId("skill_binding", allBindings.map((record) => record.id)),
        skillVersionId: input.skillVersionId,
        scope: "project",
        targetKey: input.projectId,
        projectId: input.projectId,
        enabled: true,
        createdAt: this.timestamp(),
        updatedAt: this.timestamp()
      };
      await this.repositories.skillBindings.save(binding);
      return copySkillBindingRecord(binding);
    });
  }

  async setProjectSkillBindingEnabled(
    input: SetProjectSkillBindingEnabledInput
  ): Promise<SkillBindingRecord> {
    await this.getProjectOrThrow(input.projectId);
    const binding = await this.repositories.skillBindings.getById(input.bindingId);
    if (!binding || !isProjectSkillBindingForProject(binding, input.projectId)) {
      throw new Error("skill_binding_not_found");
    }

    const updated: SkillBindingRecord = {
      ...binding,
      enabled: input.enabled,
      updatedAt: this.timestamp()
    };
    await this.repositories.skillBindings.save(updated);
    return copySkillBindingRecord(updated);
  }

  async listProjectSkillState(projectId: string): Promise<ProjectSkillState> {
    await this.getProjectOrThrow(projectId);
    const bindings = (await this.repositories.skillBindings.listForProject(projectId)).filter(
      (binding) => isProjectSkillBindingForProject(binding, projectId)
    );
    const boundSkills = (
      await Promise.all(
        bindings.map(async (binding) => {
          const version = await this.repositories.skillVersions.getById(binding.skillVersionId);
          const skill = version ? await this.repositories.skills.getById(version.skillId) : undefined;
          if (!skill || !version) {
            return undefined;
          }
          return copyProjectBoundSkillState({ skill, version, binding });
        })
      )
    ).filter(isDefined);
    const availableVersions = (await this.repositories.skillVersions.listAll())
      .filter((version) => version.manifest.scope === "project")
      .map(copySkillVersionRecord);

    return {
      boundSkills,
      availableVersions
    };
  }

  async listRuntimeSkillsForProject(projectId: string): Promise<SkillVersionRecord[]> {
    await this.getProjectOrThrow(projectId);
    const bindings = await this.repositories.skillBindings.listForProject(projectId);
    const seenSkillIds = new Set<string>();
    const versions: SkillVersionRecord[] = [];

    for (const binding of bindings) {
      if (!isProjectSkillBindingForProject(binding, projectId) || !binding.enabled) {
        continue;
      }
      const version = await this.repositories.skillVersions.getById(binding.skillVersionId);
      if (
        !version ||
        version.reviewState !== "published" ||
        version.manifest.reviewState !== "published" ||
        seenSkillIds.has(version.manifest.id)
      ) {
        continue;
      }

      const grantedPermissions = [...version.manifest.permissions];
      if (
        canUseSkill({
          manifest: version.manifest,
          boundSkillIds: [version.manifest.id],
          grantedPermissions
        })
      ) {
        seenSkillIds.add(version.manifest.id);
        versions.push(copySkillVersionRecord(version));
      }
    }

    return versions;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private async createRuntimeContext(
    projectId: string,
    role: "planner" | "builder" | "reviewer" | "deployer",
    approvalState: ApprovalState = "not_required"
  ): Promise<RuntimeRunContext> {
    const skillVersions = await this.listRuntimeSkillsForProject(projectId);
    return createWorkbenchRuntimeContext({
      role,
      approvalState,
      skillVersions
    });
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

  private async getSkillVersionOrThrow(skillVersionId: string): Promise<SkillVersionRecord> {
    const version = await this.repositories.skillVersions.getById(skillVersionId);
    if (!version) {
      throw new Error("skill_version_not_found");
    }
    return version;
  }

  private async findLatestPageVersionForBrief(
    projectId: string,
    briefId: string
  ): Promise<PageVersionRecord | undefined> {
    const pageVersions = await this.repositories.pageVersions.listAll();
    return pageVersions
      .filter((record) => record.projectId === projectId && record.briefId === briefId)
      .at(-1);
  }
}

export function createDemoWorkbenchService(): DemoWorkbenchService {
  return new DemoWorkbenchService();
}

function createLocalRuntimeAdapter(): LocalAgentRuntimeAdapter {
  return new LocalAgentRuntimeAdapter(new InMemoryModelGateway(createDefaultModelPolicy()));
}

function createWorkbenchRuntimeContext(input: {
  role: "planner" | "builder" | "reviewer" | "deployer";
  approvalState?: ApprovalState;
  skillVersions: SkillVersionRecord[];
}): RuntimeRunContext {
  const approvalState = input.approvalState ?? "not_required";
  const grantedPermissions = [
    ...new Set(input.skillVersions.flatMap((version) => version.manifest.permissions))
  ];
  const boundSkillIds = input.skillVersions.map((version) => version.manifest.id);
  const skills = input.skillVersions
    .filter((version) =>
      canUseSkill({
        manifest: version.manifest,
        boundSkillIds,
        grantedPermissions
      })
    )
    .map(toRuntimeSkill);
  const mcpTools = computeVisibleTools({
    connectors: grantedPermissions.length > 0 ? [sampleConnector] : [],
    projectConnectorIds: grantedPermissions.length > 0 ? [sampleConnector.id] : [],
    skillPermissions: grantedPermissions,
    agentRole: input.role,
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

function toRuntimeSkill(version: SkillVersionRecord): RuntimeRunContext["skills"][number] {
  const manifest = version.manifest;
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    scope: manifest.scope,
    permissions: [...manifest.permissions],
    entrypoints: [...manifest.entrypoints],
    content: version.content,
    contentType: version.contentType
  };
}

function parseProjectSkillManifest(manifestJson: string): SkillManifest {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(manifestJson);
  } catch {
    throw new Error("invalid_manifest_json");
  }

  let manifest: SkillManifest;
  try {
    manifest = SkillManifestSchema.parse(parsedJson);
  } catch {
    throw new Error("manifest_validation_failed");
  }

  if (manifest.scope !== "project") {
    throw new Error("unsupported_skill_scope");
  }

  return copySkillManifest(manifest);
}

function normalizeSkillContent(content: string): string {
  const normalized = content.trim();
  if (normalized.length === 0) {
    throw new Error("skill_content_required");
  }
  if (new TextEncoder().encode(normalized).byteLength > 200000) {
    throw new Error("skill_content_too_large");
  }
  return normalized;
}

function normalizeSkillContentType(contentType: unknown): SkillContentType {
  if (contentType === "text/markdown" || contentType === "text/plain") {
    return contentType;
  }
  throw new Error("unsupported_content_type");
}

function updateSkillVersionReviewState(
  version: SkillVersionRecord,
  reviewState: SkillManifest["reviewState"]
): SkillVersionRecord {
  return {
    ...copySkillVersionRecord(version),
    reviewState,
    manifest: {
      ...copySkillManifest(version.manifest),
      reviewState
    }
  };
}

function copyProject(project: ProjectRecord): ProjectRecord {
  return { ...project };
}

function copySkillRecord(skill: SkillRecord): SkillRecord {
  return { ...skill };
}

function copySkillVersionRecord(version: SkillVersionRecord): SkillVersionRecord {
  return {
    ...version,
    manifest: copySkillManifest(version.manifest)
  };
}

function copySkillBindingRecord(binding: SkillBindingRecord): SkillBindingRecord {
  const copy: SkillBindingRecord = { ...binding };
  if (binding.settings) {
    copy.settings = structuredClone(binding.settings);
  }
  return copy;
}

function copyProjectBoundSkillState(state: ProjectBoundSkillState): ProjectBoundSkillState {
  return {
    skill: copySkillRecord(state.skill),
    version: copySkillVersionRecord(state.version),
    binding: copySkillBindingRecord(state.binding)
  };
}

function copySkillManifest(manifest: SkillManifest): SkillManifest {
  return {
    ...manifest,
    permissions: [...manifest.permissions],
    requiredSecrets: [...manifest.requiredSecrets],
    entrypoints: [...manifest.entrypoints]
  };
}

function isProjectSkillBinding(binding: SkillBindingRecord): boolean {
  return (
    binding.scope === "project" &&
    Boolean(binding.projectId) &&
    binding.targetKey === binding.projectId
  );
}

function isProjectSkillBindingForProject(
  binding: SkillBindingRecord,
  projectId: string
): boolean {
  return isProjectSkillBinding(binding) && binding.projectId === projectId;
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

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function nextSequentialId(prefix: string, existingIds: string[]): string {
  const nextNumber =
    existingIds.reduce((largest, id) => {
      const match = new RegExp(`^${prefix}_(\\d+)$`).exec(id);
      return match ? Math.max(largest, Number(match[1])) : largest;
    }, 0) + 1;
  return `${prefix}_${nextNumber}`;
}

async function withRepositoryIdLock<T>(
  repositories: WorkbenchRepositories,
  operation: () => Promise<T>
): Promise<T> {
  const previous = repositoryIdLocks.get(repositories) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  const lock = run.then(
    () => undefined,
    () => undefined
  );
  repositoryIdLocks.set(repositories, lock);
  lock.finally(() => {
    if (repositoryIdLocks.get(repositories) === lock) {
      repositoryIdLocks.delete(repositories);
    }
  });
  return run;
}

async function reserveRepositoryId(
  repositories: WorkbenchRepositories,
  prefix: string,
  listExistingIds: () => Promise<string[]>
): Promise<string> {
  return withRepositoryIdLock(repositories, async () => {
    const existingIds = await listExistingIds();
    let reservations = repositoryIdReservations.get(repositories);
    if (!reservations) {
      reservations = new Set<string>();
      repositoryIdReservations.set(repositories, reservations);
    }
    const id = nextSequentialId(prefix, [...existingIds, ...reservations]);
    reservations.add(id);
    return id;
  });
}

function releaseRepositoryId(repositories: WorkbenchRepositories, id: string): void {
  const reservations = repositoryIdReservations.get(repositories);
  if (!reservations) {
    return;
  }
  reservations.delete(id);
  if (reservations.size === 0) {
    repositoryIdReservations.delete(repositories);
  }
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
