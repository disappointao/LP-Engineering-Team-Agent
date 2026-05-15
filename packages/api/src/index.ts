import type { StaticArtifacts } from "@lp-agent/artifacts";
import {
  createInMemoryWorkbenchRepositories,
  type BriefRecord,
  type MCPConnectorRecord,
  type MCPToolApprovalRecord,
  type ModelProviderRecord,
  type ModelProviderType,
  type ModelRoutingPolicyRecord,
  type PageVersionRecord,
  type ProjectRecord,
  type ReviewStatus,
  type RunEventRecord,
  type RunRecord,
  type SkillBindingRecord,
  type SkillContentType,
  type SkillRecord,
  type SkillVersionRecord,
  type ToolObservationRecord,
  type WorkbenchRepositories
} from "@lp-agent/db";
import {
  InMemoryGitDeploymentAdapter,
  type DeploymentHandoff,
  type GitDeploymentAdapter
} from "@lp-agent/git-deployment";
import { sampleBrief, type LPBrief, type ReviewFinding } from "@lp-agent/lp-schema";
import {
  computeVisibleTools,
  normalizeMCPConnectorDefinition,
  type ApprovalState,
  type MCPToolDefinition,
  type MCPToolApprovalState
} from "@lp-agent/mcp-gateway";
import {
  InMemoryModelGateway,
  ProviderBackedModelGateway,
  agentRoles,
  createDefaultModelPolicy,
  type AgentRole,
  type ModelFetch,
  type ModelProviderApi,
  type ModelProviderRuntimeConfig,
  type ModelProviderRuntimeRecord,
  type ModelProviderRuntimeResolver,
  type ModelRoute,
  type ModelRoutingPolicy
} from "@lp-agent/model-gateway";
import {
  LocalAgentRuntimeAdapter,
  type AgentRuntimeAdapter,
  type RuntimeEvent,
  type RuntimeRunContext,
  type RuntimeRunResult
} from "@lp-agent/runtime-adapters";
import {
  SkillManifestSchema,
  canPublishSkill,
  canUseSkill,
  type SkillManifest
} from "@lp-agent/skills";
import { runAgentStep } from "./run-orchestrator";
import {
  assertCommandTemplateVariablesKnown,
  assertWorkingDirectoryAllowed,
  cleanupCommandWorkspace,
  createArtifactTemplateVariables,
  materializeStaticArtifactsCommandWorkspace,
  redactCommandOutput,
  resolveCommandTemplate,
  resolveSkillCommandEnvironment,
  resolveSkillCommandTimeout,
  summarizeCommandOutput,
  type CommandTemplateVariables,
  type CommandWorkspace
} from "./skill-command-execution";
import {
  PlannerLPBriefParseError,
  createStructuredLPBriefPlannerPrompt,
  parsePlannerLPBriefOutput,
  toLPBriefParseFailurePayload,
  toLPBriefParseSuccessPayload
} from "./structured-lp-brief";
import {
  BuilderStaticArtifactParseError,
  createStructuredStaticArtifactsBuilderPrompt,
  parseBuilderStaticArtifactsOutput,
  toStaticArtifactParseFailurePayload,
  toStaticArtifactParseSuccessPayload
} from "./structured-static-artifacts";
import {
  RejectingToolCommandRunner,
  type ToolCommandRunner,
  type ToolCommandRunInput,
  type ToolCommandRunResult
} from "./tool-command-runner";

const repositoryIdLocks = new WeakMap<WorkbenchRepositories, Promise<void>>();
const repositoryIdReservations = new WeakMap<WorkbenchRepositories, Set<string>>();

export type {
  BriefRecord,
  MCPConnectorRecord,
  MCPToolApprovalRecord,
  ModelProviderRecord,
  ModelProviderType,
  ModelRoutingPolicyRecord,
  PageVersionRecord,
  ProjectRecord,
  ReviewStatus,
  RunEventRecord,
  RunRecord,
  SkillBindingRecord,
  SkillContentType,
  SkillRecord,
  SkillVersionRecord,
  ToolObservationRecord
} from "@lp-agent/db";
export type { AgentRole } from "@lp-agent/model-gateway";

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

export interface ExecuteProjectSkillCommandInput {
  projectId: string;
  skillVersionId: string;
  commandId: string;
  pageVersionId?: string;
  approvedByUserId: string;
}

export interface SkillCommandExecutionResult {
  run: RunRecord;
  observation: ToolObservationRecord;
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

export interface CreateProjectMCPConnectorInput {
  projectId: string;
  definitionJson: string;
}

export interface SetProjectMCPConnectorEnabledInput {
  projectId: string;
  connectorId: string;
  enabled: boolean;
}

export interface SetProjectMCPToolApprovalInput {
  projectId: string;
  connectorId: string;
  toolName: string;
  approved: boolean;
  approvedByUserId?: string;
}

export interface ListVisibleMCPToolsInput {
  projectId: string;
  role: AgentRole;
}

export interface CreateRuntimeContextForRoleInput {
  projectId: string;
  role: AgentRole;
}

export interface ProjectMCPState {
  connectors: MCPConnectorRecord[];
  approvals: MCPToolApprovalRecord[];
  visibleToolsByRole: Record<AgentRole, RuntimeRunContext["mcpTools"]>;
}

export interface CreateModelProviderInput {
  projectId: string;
  providerId: string;
  name: string;
  provider: ModelProviderType;
  api?: ModelProviderApi | string;
  baseUrl?: string;
  apiKeyEnv?: string;
  secretEnvName?: string;
  modelId?: string;
}

export interface SetModelProviderEnabledInput {
  projectId: string;
  providerId: string;
  enabled: boolean;
}

export interface UpsertProjectModelRouteInput {
  projectId: string;
  role: AgentRole;
  providerId: string;
  model: string;
}

export interface ProjectModelState {
  providers: ModelProviderRecord[];
  routes: ModelRoutingPolicyRecord[];
  resolvedPolicy: ModelRoutingPolicy;
}

export type RuntimeEnvironment = Record<string, string | undefined>;

export interface DemoWorkbenchServiceOptions {
  repositories?: WorkbenchRepositories;
  plannerRuntime?: AgentRuntimeAdapter;
  builderRuntime?: AgentRuntimeAdapter;
  reviewerRuntime?: AgentRuntimeAdapter;
  deployerRuntime?: AgentRuntimeAdapter;
  deploymentAdapter?: GitDeploymentAdapter;
  toolCommandRunner?: ToolCommandRunner;
  env?: RuntimeEnvironment;
  modelFetch?: ModelFetch;
  now?: () => Date;
}

export class DemoWorkbenchService {
  private readonly repositories: WorkbenchRepositories;
  private readonly plannerRuntime: AgentRuntimeAdapter;
  private readonly builderRuntime: AgentRuntimeAdapter;
  private readonly reviewerRuntime: AgentRuntimeAdapter;
  private readonly deployerRuntime: AgentRuntimeAdapter;
  private readonly deploymentAdapter: GitDeploymentAdapter;
  private readonly toolCommandRunner: ToolCommandRunner;
  private readonly env: RuntimeEnvironment;
  private readonly now: () => Date;
  private readonly structuredPlannerOutputEnabled: boolean;
  private readonly structuredBuilderOutputEnabled: boolean;

  constructor(options: DemoWorkbenchServiceOptions = {}) {
    this.repositories = options.repositories ?? createInMemoryWorkbenchRepositories();
    const env = options.env ?? getProcessEnv();
    this.env = env;
    const runtimeFactoryInput = {
      repositories: this.repositories,
      env,
      fetch: options.modelFetch
    };
    this.structuredPlannerOutputEnabled = env.REAL_MODEL_RUNTIME === "1";
    this.structuredBuilderOutputEnabled = env.REAL_MODEL_RUNTIME === "1";
    this.plannerRuntime = options.plannerRuntime ?? createLocalRuntimeAdapter(runtimeFactoryInput);
    this.builderRuntime = options.builderRuntime ?? createLocalRuntimeAdapter(runtimeFactoryInput);
    this.reviewerRuntime = options.reviewerRuntime ?? createLocalRuntimeAdapter(runtimeFactoryInput);
    this.deployerRuntime = options.deployerRuntime ?? createLocalRuntimeAdapter(runtimeFactoryInput);
    this.deploymentAdapter = options.deploymentAdapter ?? new InMemoryGitDeploymentAdapter();
    this.toolCommandRunner = options.toolCommandRunner ?? new RejectingToolCommandRunner();
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
    const briefId = await reserveRepositoryId(this.repositories, "brief", async () => {
      const existingBriefs = await this.repositories.briefs.listAll();
      return existingBriefs.map((record) => record.id);
    });
    let parsedPlannerBrief: LPBrief | undefined;
    const plannerPrompt = this.structuredPlannerOutputEnabled
      ? createStructuredLPBriefPlannerPrompt(input.prompt)
      : input.prompt;

    try {
      const { result } = await runAgentStep({
        repositories: this.repositories,
        service: this,
        runtime: this.plannerRuntime,
        runId: `run_planner_${briefId}`,
        projectId: input.projectId,
        role: "planner",
        input: {
          prompt: plannerPrompt
        },
        now: this.now,
        finalizeResult: this.structuredPlannerOutputEnabled
          ? ({ result }) => {
              if (result.state !== "completed") {
                return result;
              }
              try {
                parsedPlannerBrief = parsePlannerLPBriefOutput(result.modelOutputText ?? "");
                return {
                  ...result,
                  events: addEventBeforeRunCompleted(
                    result.events,
                    toPlannerParseSuccessEvent({
                      result,
                      brief: parsedPlannerBrief
                    })
                  )
                };
              } catch (error) {
                if (error instanceof PlannerLPBriefParseError) {
                  return failPlannerResultForParseError({ result, error });
                }
                throw error;
              }
            }
          : undefined
      });

      if (result.state === "failed") {
        throw new Error("Planner run failed.");
      }
      if (result.state !== "completed") {
        throw new Error("Planner run did not complete.");
      }

      return await withRepositoryIdLock(this.repositories, async () => {
        const brief: BriefRecord = {
          id: briefId,
          projectId: input.projectId,
          prompt: input.prompt,
          brief: copyBrief(parsedPlannerBrief ?? sampleBrief),
          createdAt: this.timestamp()
        };
        await this.repositories.briefs.save(brief);
        return copyBriefRecord(brief);
      });
    } finally {
      releaseRepositoryId(this.repositories, briefId);
    }
  }

  async generatePageVersion(input: GeneratePageVersionInput): Promise<PageVersionRecord> {
    await this.getProjectOrThrow(input.projectId);
    const brief = await this.getBriefForProjectOrThrow(input.projectId, input.briefId);
    const pageVersionId = await reserveRepositoryId(this.repositories, "version", async () => {
      const existingPageVersions = await this.repositories.pageVersions.listAll();
      return existingPageVersions.map((record) => record.id);
    });
    let parsedBuilderArtifacts: StaticArtifacts | undefined;
    const builderPrompt = this.structuredBuilderOutputEnabled
      ? createStructuredStaticArtifactsBuilderPrompt(brief.brief)
      : brief.prompt;

    try {
      const { result } = await runAgentStep({
        repositories: this.repositories,
        service: this,
        runtime: this.builderRuntime,
        runId: `run_builder_${pageVersionId}`,
        projectId: input.projectId,
        role: "builder",
        input: {
          brief: copyBrief(brief.brief),
          prompt: builderPrompt
        },
        now: this.now,
        finalizeResult: this.structuredBuilderOutputEnabled
          ? ({ result }) => {
              if (result.state !== "completed") {
                return result;
              }
              try {
                parsedBuilderArtifacts = parseBuilderStaticArtifactsOutput(
                  result.modelOutputText ?? ""
                );
                return {
                  ...result,
                  artifacts: parsedBuilderArtifacts,
                  events: addEventBeforeRunCompleted(
                    result.events,
                    toBuilderParseSuccessEvent({
                      result,
                      artifacts: parsedBuilderArtifacts
                    })
                  )
                };
              } catch (error) {
                if (error instanceof BuilderStaticArtifactParseError) {
                  return failBuilderResultForParseError({ result, error });
                }
                throw error;
              }
            }
          : undefined
      });

      if (result.state === "failed") {
        throw new Error("Builder run failed.");
      }
      if (result.state !== "completed") {
        throw new Error("Builder run did not complete.");
      }
      const artifacts = this.structuredBuilderOutputEnabled
        ? parsedBuilderArtifacts
        : result.artifacts;
      if (!artifacts) {
        throw new Error("Builder run did not return artifacts.");
      }
      if (!hasCompleteArtifacts(artifacts)) {
        throw new Error("Builder run returned incomplete artifacts.");
      }

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

    const { result } = await runAgentStep({
      repositories: this.repositories,
      service: this,
      runtime: this.reviewerRuntime,
      runId: `run_reviewer_${pageVersion.id}`,
      projectId: input.projectId,
      role: "reviewer",
      input: {
        brief: copyBrief(brief.brief),
        prompt: "Review for launch blockers."
      },
      now: this.now
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

    const { result } = await runAgentStep({
      repositories: this.repositories,
      service: this,
      runtime: this.deployerRuntime,
      runId: `run_deployer_${pageVersion.id}`,
      projectId: input.projectId,
      role: "deployer",
      input: {
        prompt: "Prepare deployment handoff."
      },
      now: this.now
    });

    if (result.state === "failed") {
      throw new Error("Deployer run failed.");
    }
    if (result.state !== "completed") {
      throw new Error("Deployer run did not complete.");
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

  async executeProjectSkillCommand(
    input: ExecuteProjectSkillCommandInput
  ): Promise<SkillCommandExecutionResult> {
    await this.getProjectOrThrow(input.projectId);
    if (input.approvedByUserId.trim().length === 0) {
      throw new Error("skill_command_approval_required");
    }
    const version = await this.getSkillVersionOrThrow(input.skillVersionId);
    const bindings = await this.repositories.skillBindings.listForProject(input.projectId);
    const binding = bindings.find(
      (candidate) =>
        isProjectSkillBindingForProject(candidate, input.projectId) &&
        candidate.skillVersionId === input.skillVersionId &&
        candidate.enabled
    );
    if (!binding) {
      throw new Error("skill_command_not_bound");
    }
    if (version.manifest.type !== "deployment") {
      throw new Error("skill_command_not_deployment");
    }
    if (version.reviewState !== "published" || version.manifest.reviewState !== "published") {
      throw new Error("skill_command_not_published");
    }

    const command = (version.manifest.commands ?? []).find(
      (candidate) => candidate.id === input.commandId
    );
    if (!command) {
      throw new Error("skill_command_not_found");
    }
    if (!version.manifest.permissions.includes(command.permission)) {
      throw new Error("skill_command_permission_denied");
    }
    assertSkillCommandSecretRefsDeclared(version.manifest, command);

    const pageVersion = input.pageVersionId
      ? await this.repositories.pageVersions.getById(input.pageVersionId)
      : undefined;
    if (input.pageVersionId && (!pageVersion || pageVersion.projectId !== input.projectId)) {
      throw new Error("skill_command_page_version_not_found");
    }

    const runId = await reserveRepositoryId(this.repositories, "run_skill_command", async () => {
      const existingRuns = await this.repositories.runs.listAll();
      return existingRuns.map((record) => record.id);
    });
    let observationId: string | undefined;
    let workspace: CommandWorkspace | undefined;

    try {
      preflightSkillCommandTemplates({
        command,
        hasPageVersion: Boolean(pageVersion)
      });
      observationId = await reserveRepositoryId(
        this.repositories,
        "tool_observation",
        async () => {
          const observations = await this.repositories.toolObservations.listAll();
          return observations.map((record) => record.id);
        }
      );

      if (pageVersion) {
        workspace = await materializeStaticArtifactsCommandWorkspace({
          runId,
          artifacts: pageVersion.artifacts
        });
      }

      const variables: CommandTemplateVariables = {
        projectId: input.projectId,
        skillId: version.skillId,
        skillVersionId: version.id,
        commandId: command.id,
        runId,
        ...createArtifactTemplateVariables({
          workspace,
          pageVersionId: pageVersion?.id
        })
      };
      const env = resolveSkillCommandEnvironment({
        manifest: version.manifest,
        command,
        runtimeEnv: this.env,
        variables
      });
      const args = command.args.map((arg) => resolveCommandTemplate(arg, variables));
      const workingDirectory = command.workingDirectory
        ? resolveCommandTemplate(command.workingDirectory, variables)
        : workspace?.artifactDir;
      assertWorkingDirectoryAllowed({ workingDirectory, workspace });

      const startedAt = this.timestamp();
      const run: RunRecord = {
        id: runId,
        projectId: input.projectId,
        role: "deployer",
        state: "running",
        startedAt,
        contextSummary: {
          injected: [`skillCommand:${version.skillId}:${command.id}`],
          omitted: []
        }
      };
      await this.repositories.runs.save(run);

      let sequence = 1;
      const saveEvent = async (
        type: string,
        message: string,
        payload: Record<string, unknown>
      ): Promise<void> => {
        await this.repositories.runEvents.save({
          id: `${runId}_event_${sequence}`,
          runId,
          projectId: input.projectId,
          sequence,
          type,
          message,
          payload,
          createdAt: this.timestamp()
        });
        sequence += 1;
      };
      const basePayload = {
        skillId: version.skillId,
        skillVersionId: version.id,
        commandId: command.id,
        permission: command.permission,
        approvedByUserId: input.approvedByUserId,
        ...(pageVersion ? { pageVersionId: pageVersion.id } : {})
      };
      await saveEvent("run.started", "Deployment skill command run started.", basePayload);
      await saveEvent("tool.started", "Deployment skill command started.", {
        ...basePayload,
        observationId
      });

      const commandRunInput: ToolCommandRunInput = {
        runId,
        projectId: input.projectId,
        skillId: version.skillId,
        skillVersionId: version.id,
        commandId: command.id,
        command: command.command,
        args,
        env,
        ...(workingDirectory ? { workingDirectory } : {}),
        timeoutMs: resolveSkillCommandTimeout(command)
      };
      const runnerResult = await this.runToolCommandSafely(commandRunInput);
      const completedAt = this.timestamp();
      const finalState = runnerResult.state === "completed" ? "completed" : "failed";
      const secretValues = (command.env ?? [])
        .flatMap((binding) => {
          if (!binding.secretRef) {
            return [];
          }
          const value = this.env[binding.secretRef];
          return value ? [value] : [];
        });
      const artifactValues = pageVersion
        ? [
            pageVersion.artifacts.indexHtml,
            pageVersion.artifacts.stylesCss,
            pageVersion.artifacts.scriptJs
          ]
        : [];
      const sensitiveValues = [...secretValues, ...artifactValues];
      const sanitizedErrorName = sanitizeRunnerErrorName(
        runnerResult.errorName,
        sensitiveValues,
        finalState
      );
      const outputSummary = summarizeSkillCommandOutput({
        runnerResult,
        secretValues
      });
      const finalPayload = {
        ...basePayload,
        observationId,
        outputSummary,
        ...(runnerResult.exitCode !== undefined ? { exitCode: runnerResult.exitCode } : {}),
        ...(sanitizedErrorName !== undefined ? { errorName: sanitizedErrorName } : {})
      };
      await saveEvent(
        finalState === "completed" ? "tool.completed" : "tool.failed",
        finalState === "completed"
          ? "Deployment skill command completed."
          : "Deployment skill command failed.",
        finalPayload
      );
      await saveEvent(
        finalState === "completed" ? "run.completed" : "run.failed",
        finalState === "completed"
          ? "Deployment skill command run completed."
          : "Deployment skill command run failed.",
        finalPayload
      );

      const observation: ToolObservationRecord = {
        id: observationId,
        runId,
        projectId: input.projectId,
        toolName: `skill:${version.skillId}:${command.id}`,
        input: {
          skillId: version.skillId,
          skillVersionId: version.id,
          commandId: command.id,
          permission: command.permission,
          approvedByUserId: input.approvedByUserId,
          ...(pageVersion ? { pageVersionId: pageVersion.id } : {}),
          argCount: args.length,
          envNames: Object.keys(env).sort()
        },
        outputSummary,
        state: finalState,
        ...(runnerResult.exitCode !== undefined ? { exitCode: runnerResult.exitCode } : {}),
        ...(sanitizedErrorName !== undefined ? { errorName: sanitizedErrorName } : {}),
        createdAt: startedAt,
        completedAt
      };
      await this.repositories.toolObservations.save(observation);

      const finalRun: RunRecord = {
        ...run,
        state: finalState,
        completedAt
      };
      await this.repositories.runs.save(finalRun);

      return {
        run: copyRunRecord(finalRun),
        observation: copyToolObservationRecord(observation)
      };
    } finally {
      releaseRepositoryId(this.repositories, runId);
      if (observationId) {
        releaseRepositoryId(this.repositories, observationId);
      }
      if (workspace) {
        await cleanupCommandWorkspace(workspace);
      }
    }
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

  async createProjectMCPConnector(
    input: CreateProjectMCPConnectorInput
  ): Promise<MCPConnectorRecord> {
    await this.getProjectOrThrow(input.projectId);
    const definition = parseMCPConnectorJson(input.definitionJson);

    return withRepositoryIdLock(this.repositories, async () => {
      if (await this.repositories.mcpConnectors.getById(definition.id)) {
        throw new Error("mcp_connector_already_exists");
      }
      const timestamp = this.timestamp();
      const connector: MCPConnectorRecord = {
        id: definition.id,
        scope: "project",
        targetKey: input.projectId,
        name: definition.name,
        description: definition.description,
        tools: definition.tools,
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      await this.repositories.mcpConnectors.save(connector);
      return copyMCPConnectorRecord(connector);
    });
  }

  async setProjectMCPConnectorEnabled(
    input: SetProjectMCPConnectorEnabledInput
  ): Promise<MCPConnectorRecord> {
    await this.getProjectOrThrow(input.projectId);
    const connector = await this.repositories.mcpConnectors.getById(input.connectorId);
    if (!connector || !isProjectMCPConnectorForProject(connector, input.projectId)) {
      throw new Error("mcp_connector_not_found");
    }
    const updated: MCPConnectorRecord = {
      ...connector,
      enabled: input.enabled,
      updatedAt: this.timestamp()
    };
    await this.repositories.mcpConnectors.save(updated);
    return copyMCPConnectorRecord(updated);
  }

  async setProjectMCPToolApproval(
    input: SetProjectMCPToolApprovalInput
  ): Promise<MCPToolApprovalRecord> {
    await this.getProjectOrThrow(input.projectId);
    const connector = await this.repositories.mcpConnectors.getById(input.connectorId);
    if (!connector || !isProjectMCPConnectorForProject(connector, input.projectId)) {
      throw new Error("mcp_connector_not_found");
    }
    const tool = connector.tools.find((candidate) => candidate.name === input.toolName);
    if (!tool) {
      throw new Error("mcp_tool_not_found");
    }
    if (!tool.requiresApproval) {
      throw new Error("mcp_tool_approval_not_required");
    }

    return withRepositoryIdLock(this.repositories, async () => {
      const existing = await this.repositories.mcpToolApprovals.getByProjectConnectorAndTool(
        input.projectId,
        connector.id,
        tool.name
      );
      const timestamp = this.timestamp();
      const approval: MCPToolApprovalRecord = {
        id:
          existing?.id ??
          nextSequentialId(
            "mcp_approval",
            (await this.repositories.mcpToolApprovals.listAll()).map((record) => record.id)
          ),
        projectId: input.projectId,
        connectorId: connector.id,
        toolName: tool.name,
        state: input.approved ? "approved" : "pending",
        approvedByUserId: input.approved ? input.approvedByUserId ?? "local-owner" : undefined,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp
      };
      await this.repositories.mcpToolApprovals.save(approval);
      return copyMCPToolApprovalRecord(approval);
    });
  }

  async listProjectMCPState(projectId: string): Promise<ProjectMCPState> {
    await this.getProjectOrThrow(projectId);
    const visibleEntries = await Promise.all(
      agentRoles.map(
        async (role) =>
          [
            role,
            await this.listVisibleMCPToolsForProject({
              projectId,
              role
            })
          ] as const
      )
    );
    return {
      connectors: (await this.repositories.mcpConnectors.listForProject(projectId)).map(
        copyMCPConnectorRecord
      ),
      approvals: (await this.repositories.mcpToolApprovals.listForProject(projectId)).map(
        copyMCPToolApprovalRecord
      ),
      visibleToolsByRole: Object.fromEntries(
        visibleEntries
      ) as ProjectMCPState["visibleToolsByRole"]
    };
  }

  async listVisibleMCPToolsForProject(
    input: ListVisibleMCPToolsInput
  ): Promise<RuntimeRunContext["mcpTools"]> {
    await this.getProjectOrThrow(input.projectId);
    const role = normalizeAgentRole(input.role);
    const skillVersions = await this.listRuntimeSkillsForProject(input.projectId);
    return this.resolveVisibleMCPTools({
      projectId: input.projectId,
      role,
      skillVersions
    });
  }

  async createRuntimeContextForRole(
    input: CreateRuntimeContextForRoleInput
  ): Promise<RuntimeRunContext> {
    await this.getProjectOrThrow(input.projectId);
    const role = normalizeAgentRole(input.role);
    return this.createRuntimeContext(input.projectId, role);
  }

  async createModelProvider(input: CreateModelProviderInput): Promise<ModelProviderRecord> {
    await this.getProjectOrThrow(input.projectId);
    const providerId = normalizeIdentifier(input.providerId, "model_provider_key_required");
    const name = normalizeNonEmpty(input.name, "model_provider_name_required");
    const provider = normalizeModelProviderType(input.provider);
    const config = normalizeModelProviderConfig({
      provider,
      api: input.api,
      baseUrl: input.baseUrl,
      apiKeyEnv: input.apiKeyEnv,
      secretEnvName: input.secretEnvName,
      modelId: input.modelId
    });

    return withRepositoryIdLock(this.repositories, async () => {
      if (await this.repositories.modelProviders.getById(providerId)) {
        throw new Error("model_provider_already_exists");
      }

      const timestamp = this.timestamp();
      const record: ModelProviderRecord = {
        id: providerId,
        scope: "project",
        targetKey: input.projectId,
        name,
        provider,
        config,
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      await this.repositories.modelProviders.save(record);
      return copyModelProviderRecord(record);
    });
  }

  async setModelProviderEnabled(
    input: SetModelProviderEnabledInput
  ): Promise<ModelProviderRecord> {
    await this.getProjectOrThrow(input.projectId);
    return withRepositoryIdLock(this.repositories, async () => {
      const provider = await this.repositories.modelProviders.getById(input.providerId);
      if (!provider || !isProjectModelProviderForProject(provider, input.projectId)) {
        throw new Error("model_provider_not_found");
      }
      if (!input.enabled) {
        const routes = await this.repositories.modelRoutingPolicies.listForProject(
          input.projectId
        );
        if (routes.some((route) => route.providerId === provider.id)) {
          throw new Error("model_provider_in_use");
        }
      }
      const updated: ModelProviderRecord = {
        ...provider,
        enabled: input.enabled,
        updatedAt: this.timestamp()
      };
      await this.repositories.modelProviders.save(updated);
      return copyModelProviderRecord(updated);
    });
  }

  async upsertProjectModelRoute(
    input: UpsertProjectModelRouteInput
  ): Promise<ModelRoutingPolicyRecord> {
    await this.getProjectOrThrow(input.projectId);
    const role = normalizeAgentRole(input.role);
    const model = normalizeNonEmpty(input.model, "model_id_required");
    const provider = await this.repositories.modelProviders.getById(input.providerId);
    if (!provider || !isProjectModelProviderForProject(provider, input.projectId)) {
      throw new Error("model_provider_not_found");
    }
    if (!provider.enabled) {
      throw new Error("model_provider_disabled");
    }

    return withRepositoryIdLock(this.repositories, async () => {
      const currentProvider = await this.repositories.modelProviders.getById(input.providerId);
      if (!currentProvider || !isProjectModelProviderForProject(currentProvider, input.projectId)) {
        throw new Error("model_provider_not_found");
      }
      if (!currentProvider.enabled) {
        throw new Error("model_provider_disabled");
      }

      const existing = await this.repositories.modelRoutingPolicies.getByProjectAndRole(
        input.projectId,
        role
      );
      const allRoutes = await this.repositories.modelRoutingPolicies.listAll();
      const timestamp = this.timestamp();
      const route: ModelRoutingPolicyRecord = {
        id:
          existing?.id ??
          nextSequentialId(
            "model_route",
            allRoutes.map((record) => record.id)
          ),
        scope: "project",
        targetKey: input.projectId,
        role,
        providerId: currentProvider.id,
        model,
        fallback: existing?.fallback ? structuredClone(existing.fallback) : undefined,
        settings: existing?.settings ? structuredClone(existing.settings) : undefined,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp
      };
      await this.repositories.modelRoutingPolicies.save(route);
      return copyModelRoutingPolicyRecord(route);
    });
  }

  async listProjectModelState(projectId: string): Promise<ProjectModelState> {
    await this.getProjectOrThrow(projectId);
    return {
      providers: (await this.repositories.modelProviders.listForProject(projectId)).map(
        copyModelProviderRecord
      ),
      routes: (await this.repositories.modelRoutingPolicies.listForProject(projectId)).map(
        copyModelRoutingPolicyRecord
      ),
      resolvedPolicy: await this.resolveModelRoutingPolicyForProject(projectId)
    };
  }

  async resolveModelRoutingPolicyForProject(projectId: string): Promise<ModelRoutingPolicy> {
    await this.getProjectOrThrow(projectId);
    const defaultPolicy = createDefaultModelPolicy();
    const projectRoutes = await this.repositories.modelRoutingPolicies.listForProject(projectId);
    const resolved: ModelRoutingPolicy = {
      planner: { ...defaultPolicy.planner },
      builder: { ...defaultPolicy.builder },
      reviewer: { ...defaultPolicy.reviewer },
      deployer: { ...defaultPolicy.deployer }
    };

    for (const route of projectRoutes) {
      const role = normalizeAgentRole(route.role);
      const provider = await this.repositories.modelProviders.getById(route.providerId);
      if (!provider || !isProjectModelProviderForProject(provider, projectId)) {
        throw new Error("model_route_provider_invalid");
      }
      if (!provider.enabled) {
        throw new Error("model_provider_disabled");
      }
      if (route.model.trim().length === 0) {
        throw new Error("model_id_required");
      }
      const api = resolveProviderApi(provider);
      const modelCapabilities = toRouteModelCapabilities(provider, route.model);
      resolved[role] = {
        provider: provider.id,
        providerName: provider.name,
        api,
        model: route.model,
        baseUrlConfigured: Boolean(provider.config.baseUrl),
        apiKeyEnvConfigured: Boolean(provider.config.apiKeyEnv ?? provider.config.secretEnvName),
        ...(modelCapabilities ? { modelCapabilities } : {})
      };
    }

    return resolved;
  }

  private async resolveVisibleMCPTools(input: {
    projectId: string;
    role: AgentRole;
    skillVersions: SkillVersionRecord[];
  }): Promise<RuntimeRunContext["mcpTools"]> {
    const grantedPermissions = [
      ...new Set(input.skillVersions.flatMap((version) => version.manifest.permissions))
    ];
    const connectors = (await this.repositories.mcpConnectors.listForProject(input.projectId))
      .filter((connector) => connector.enabled === true)
      .map(normalizeRuntimeMCPConnector)
      .filter(isDefined);
    const approvals = await this.repositories.mcpToolApprovals.listForProject(input.projectId);
    const approvalStates: MCPToolApprovalState[] = approvals.map((approval) => ({
      connectorId: approval.connectorId,
      toolName: approval.toolName,
      state: approval.state
    }));

    return connectors.flatMap((connector) =>
      computeVisibleTools({
        connectors: [connector],
        projectConnectorIds: [connector.id],
        skillPermissions: grantedPermissions,
        agentRole: input.role,
        approvalStates
      }).map((tool) => ({
        connectorId: connector.id,
        name: tool.name,
        permission: tool.permission,
        requiresApproval: tool.requiresApproval
      }))
    );
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
    const [mcpTools, modelRoutingPolicy] = await Promise.all([
      this.resolveVisibleMCPTools({ projectId, role, skillVersions }),
      this.resolveModelRoutingPolicyForProject(projectId)
    ]);
    return createWorkbenchRuntimeContext({
      role,
      approvalState,
      skillVersions,
      mcpTools,
      modelRoutingPolicy
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

  private async runToolCommandSafely(
    input: ToolCommandRunInput
  ): Promise<ToolCommandRunResult> {
    try {
      return await this.toolCommandRunner.run(input);
    } catch (error) {
      return {
        state: "failed",
        stdout: "",
        stderr: error instanceof Error ? error.message : "Tool command runner failed.",
        errorName:
          error instanceof Error && error.name
            ? error.name
            : "skill_command_runner_error"
      };
    }
  }
}

export function createDemoWorkbenchService(): DemoWorkbenchService {
  return new DemoWorkbenchService();
}

export {
  ContextPackSchema,
  assembleContextPack,
  type AssembleContextPackInput,
  type ContextAssemblyTrace,
  type ContextPack
} from "./context-assembler";

export {
  RunEventRecordSchema,
  runAgentStep,
  type RunAgentStepInput,
  type RunAgentStepResult
} from "./run-orchestrator";

export {
  RejectingToolCommandRunner,
  type ToolCommandRunner,
  type ToolCommandRunInput,
  type ToolCommandRunResult
} from "./tool-command-runner";

interface LocalRuntimeAdapterFactoryInput {
  repositories: WorkbenchRepositories;
  env?: RuntimeEnvironment;
  fetch?: ModelFetch;
}

function addEventBeforeRunCompleted(
  events: RuntimeEvent[],
  event: RuntimeEvent
): RuntimeEvent[] {
  const completedIndex = events.findIndex((candidate) => candidate.type === "run.completed");
  if (completedIndex === -1) {
    return [...events, event];
  }
  return [...events.slice(0, completedIndex), event, ...events.slice(completedIndex)];
}

function toPlannerParseSuccessEvent(input: {
  result: RuntimeRunResult;
  brief: LPBrief;
}): RuntimeEvent {
  return {
    ...toLPBriefParseSuccessPayload(input.brief),
    type: "model.output.parsed",
    message: "Planner output parsed as LP brief",
    runId: input.result.runId,
    role: "planner",
    schema: "LPBriefSchema",
    title: input.brief.title,
    sectionCount: input.brief.sections.length,
    productCount: input.brief.productData.length,
    hasAssets: input.brief.assets.length > 0
  };
}

function failPlannerResultForParseError(input: {
  result: RuntimeRunResult;
  error: PlannerLPBriefParseError;
}): RuntimeRunResult {
  const issueSummary = input.error.issueSummary;
  return {
    ...input.result,
    state: "failed",
    events: [
      ...input.result.events.filter((event) => event.type !== "run.completed"),
      {
        ...toLPBriefParseFailurePayload(input.error),
        type: "model.output.parse_failed",
        message: "Planner output could not be parsed as LP brief",
        runId: input.result.runId,
        role: "planner",
        schema: "LPBriefSchema",
        reason: input.error.reason,
        ...(issueSummary.issueCount !== undefined
          ? { issueCount: issueSummary.issueCount }
          : {}),
        ...(issueSummary.firstIssuePath !== undefined
          ? { firstIssuePath: issueSummary.firstIssuePath }
          : {}),
        ...(issueSummary.firstIssueCode !== undefined
          ? { firstIssueCode: issueSummary.firstIssueCode }
          : {})
      },
      {
        type: "run.failed",
        message: "Planner run failed.",
        runId: input.result.runId,
        role: "planner",
        state: "failed",
        errorName: input.error.name
      }
    ]
  };
}

function toBuilderParseSuccessEvent(input: {
  result: RuntimeRunResult;
  artifacts: StaticArtifacts;
}): RuntimeEvent {
  const payload = toStaticArtifactParseSuccessPayload(input.artifacts);
  return {
    ...payload,
    type: "model.output.parsed",
    message: "Builder output parsed as static artifacts",
    runId: input.result.runId,
    role: "builder",
    schema: "StaticArtifactsSchema",
    artifactKind: "three-file-static",
    htmlBytes: Number(payload.htmlBytes),
    cssBytes: Number(payload.cssBytes),
    jsBytes: Number(payload.jsBytes),
    hasExternalCss: Boolean(payload.hasExternalCss),
    hasExternalImages: Boolean(payload.hasExternalImages)
  };
}

function failBuilderResultForParseError(input: {
  result: RuntimeRunResult;
  error: BuilderStaticArtifactParseError;
}): RuntimeRunResult {
  const issueSummary = input.error.issueSummary;
  return {
    ...input.result,
    state: "failed",
    artifacts: undefined,
    events: [
      ...input.result.events.filter(
        (event) => event.type !== "run.completed" && event.type !== "artifact.created"
      ),
      {
        ...toStaticArtifactParseFailurePayload(input.error),
        type: "model.output.parse_failed",
        message: "Builder output could not be parsed as static artifacts",
        runId: input.result.runId,
        role: "builder",
        schema: "StaticArtifactsSchema",
        reason: input.error.reason,
        ...(input.error.policyCode ? { policyCode: input.error.policyCode } : {}),
        ...(issueSummary.issueCount !== undefined
          ? { issueCount: issueSummary.issueCount }
          : {}),
        ...(issueSummary.firstIssuePath !== undefined
          ? { firstIssuePath: issueSummary.firstIssuePath }
          : {}),
        ...(issueSummary.firstIssueCode !== undefined
          ? { firstIssueCode: issueSummary.firstIssueCode }
          : {})
      },
      {
        type: "run.failed",
        message: "Builder run failed.",
        runId: input.result.runId,
        role: "builder",
        state: "failed",
        errorName: input.error.name
      }
    ]
  };
}

function createLocalRuntimeAdapter(
  input?: LocalRuntimeAdapterFactoryInput
): LocalAgentRuntimeAdapter {
  const policy = createDefaultModelPolicy();
  const env = input?.env ?? getProcessEnv();

  if (env.REAL_MODEL_RUNTIME === "1" && input) {
    return new LocalAgentRuntimeAdapter(
      new ProviderBackedModelGateway({
        policy,
        providers: createRepositoryModelProviderResolver(input.repositories),
        ...(input.fetch ? { fetch: input.fetch } : {}),
        env,
        allowMockRoutes: false
      })
    );
  }

  return new LocalAgentRuntimeAdapter(new InMemoryModelGateway(policy));
}

function createRepositoryModelProviderResolver(
  repositories: WorkbenchRepositories
): ModelProviderRuntimeResolver {
  return {
    async getProvider(providerId: string): Promise<ModelProviderRuntimeRecord | undefined> {
      const provider = await repositories.modelProviders.getById(providerId);
      if (!provider) {
        return undefined;
      }

      return {
        id: provider.id,
        name: provider.name,
        enabled: provider.enabled,
        config: structuredClone(provider.config)
      };
    }
  };
}

function getProcessEnv(): RuntimeEnvironment {
  return typeof process === "undefined" ? {} : process.env;
}

function createWorkbenchRuntimeContext(input: {
  role: AgentRole;
  approvalState?: ApprovalState;
  skillVersions: SkillVersionRecord[];
  mcpTools: RuntimeRunContext["mcpTools"];
  modelRoutingPolicy: ModelRoutingPolicy;
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

  return {
    skills,
    mcpTools: input.mcpTools.map((tool) => ({ ...tool })),
    approval: {
      state: approvalState
    },
    artifactWorkspace: {
      mode: "memory",
      writableFiles: ["index.html", "styles.css", "script.js"]
    },
    modelRoutingPolicy: input.modelRoutingPolicy
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

function parseMCPConnectorJson(definitionJson: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(definitionJson);
  } catch {
    throw new Error("mcp_connector_json_invalid");
  }
  return normalizeMCPConnectorDefinition(parsed);
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

function normalizeIdentifier(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(errorCode);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error(errorCode);
  }
  return normalized;
}

function normalizeNonEmpty(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(errorCode);
  }
  return normalized;
}

function normalizeModelProviderType(provider: unknown): ModelProviderType {
  if (
    provider === "mock" ||
    provider === "openai" ||
    provider === "anthropic" ||
    provider === "internal" ||
    provider === "custom"
  ) {
    return provider;
  }
  throw new Error("model_provider_type_unsupported");
}

function normalizeModelProviderApi(
  provider: ModelProviderType,
  api: unknown
): ModelProviderApi {
  if (api === "mock" || api === "openai-completions" || api === "anthropic-messages") {
    return api;
  }
  if (typeof api === "string" && api.trim().length > 0) {
    throw new Error("model_provider_api_unsupported");
  }
  if (provider === "mock") {
    return "mock";
  }
  if (provider === "openai") {
    return "openai-completions";
  }
  if (provider === "anthropic") {
    return "anthropic-messages";
  }
  throw new Error("model_provider_api_required");
}

function normalizeEnvRef(value: string | undefined, errorCode: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(normalized)) {
    throw new Error(errorCode);
  }
  return normalized;
}

function normalizeOptionalUrl(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("invalid_protocol");
    }
    return normalized;
  } catch {
    throw new Error("model_provider_base_url_invalid");
  }
}

function normalizeOptionalModelId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizeModelProviderConfig(input: {
  provider: ModelProviderType;
  api?: ModelProviderApi | string;
  baseUrl?: string;
  apiKeyEnv?: string;
  secretEnvName?: string;
  modelId?: string;
}): ModelProviderRuntimeConfig {
  const api = normalizeModelProviderApi(input.provider, input.api);
  const baseUrl = normalizeOptionalUrl(input.baseUrl);
  const apiKeyEnvInput = input.apiKeyEnv?.trim() ? input.apiKeyEnv : input.secretEnvName;
  const apiKeyEnv = normalizeEnvRef(
    apiKeyEnvInput,
    "model_provider_api_key_env_invalid"
  );
  const modelId = normalizeOptionalModelId(input.modelId);

  return {
    api,
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    ...(modelId ? { models: [{ id: modelId }] } : {})
  };
}

function resolveProviderApi(provider: ModelProviderRecord): ModelProviderApi {
  if (provider.config.api) {
    return provider.config.api;
  }
  return normalizeModelProviderApi(provider.provider, undefined);
}

function findProviderModelConfig(
  provider: ModelProviderRecord,
  modelId: string
): NonNullable<ModelProviderRuntimeConfig["models"]>[number] | undefined {
  return provider.config.models?.find((model) => model.id === modelId);
}

function toRouteModelCapabilities(
  provider: ModelProviderRecord,
  modelId: string
): ModelRoute["modelCapabilities"] {
  const model = findProviderModelConfig(provider, modelId);
  if (!model) {
    return undefined;
  }
  const capabilities = {
    ...(model.name ? { name: model.name } : {}),
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
    ...(model.supportsTools !== undefined ? { supportsTools: model.supportsTools } : {}),
    ...(model.supportsStreaming !== undefined
      ? { supportsStreaming: model.supportsStreaming }
      : {}),
    ...(model.supportsImages !== undefined ? { supportsImages: model.supportsImages } : {})
  };
  return Object.keys(capabilities).length > 0 ? capabilities : undefined;
}

function normalizeAgentRole(role: unknown): AgentRole {
  if (agentRoles.includes(role as AgentRole)) {
    return role as AgentRole;
  }
  throw new Error("model_role_unsupported");
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

function copyModelProviderRecord(provider: ModelProviderRecord): ModelProviderRecord {
  return {
    ...provider,
    config: { ...provider.config }
  };
}

function copyModelRoutingPolicyRecord(
  policy: ModelRoutingPolicyRecord
): ModelRoutingPolicyRecord {
  const copy: ModelRoutingPolicyRecord = { ...policy };
  if (policy.fallback) {
    copy.fallback = structuredClone(policy.fallback);
  }
  if (policy.settings) {
    copy.settings = structuredClone(policy.settings);
  }
  return copy;
}

function copyMCPConnectorRecord(connector: MCPConnectorRecord): MCPConnectorRecord {
  const rawTools = Array.isArray((connector as { tools?: unknown }).tools)
    ? (connector as { tools: unknown[] }).tools
    : [];
  return {
    ...connector,
    tools: rawTools.flatMap((tool) => {
      const copiedTool = copyMCPToolDefinition(tool);
      return copiedTool ? [copiedTool] : [];
    })
  };
}

function copyMCPToolApprovalRecord(approval: MCPToolApprovalRecord): MCPToolApprovalRecord {
  return { ...approval };
}

function sanitizeRunnerErrorName(
  errorName: string | undefined,
  sensitiveValues: string[],
  state: ToolObservationRecord["state"]
): string | undefined {
  if (errorName === undefined) {
    return state === "failed" ? "skill_command_runner_error" : undefined;
  }
  const trimmed = errorName.trim();
  if (
    trimmed.length === 0 ||
    trimmed !== errorName ||
    trimmed.length > 80 ||
    /\s/.test(trimmed) ||
    !/^[A-Za-z0-9_.:-]+$/.test(trimmed)
  ) {
    return "skill_command_runner_error";
  }
  if (redactCommandOutput(trimmed, sensitiveValues) !== trimmed) {
    return "skill_command_runner_error";
  }
  return trimmed;
}

function assertSkillCommandSecretRefsDeclared(
  manifest: SkillManifest,
  command: NonNullable<SkillManifest["commands"]>[number]
): void {
  for (const binding of command.env ?? []) {
    if (binding.secretRef && !manifest.requiredSecrets.includes(binding.secretRef)) {
      throw new Error("skill_command_secret_not_declared");
    }
  }
}

function preflightSkillCommandTemplates(input: {
  command: NonNullable<SkillManifest["commands"]>[number];
  hasPageVersion: boolean;
}): void {
  const allowedVariables = [
    "projectId",
    "skillId",
    "skillVersionId",
    "commandId",
    "runId",
    ...(input.hasPageVersion
      ? [
          "pageVersionId",
          "artifactDir",
          "artifact.indexHtmlPath",
          "artifact.stylesCssPath",
          "artifact.scriptJsPath"
        ]
      : [])
  ];
  for (const value of collectSkillCommandTemplateValues(input.command)) {
    assertCommandTemplateVariablesKnown(value, allowedVariables);
  }
}

function collectSkillCommandTemplateValues(
  command: NonNullable<SkillManifest["commands"]>[number]
): string[] {
  return [
    ...command.args,
    ...(command.workingDirectory ? [command.workingDirectory] : []),
    ...(command.env ?? []).flatMap((binding) =>
      binding.value !== undefined ? [binding.value] : []
    )
  ];
}

function summarizeSkillCommandOutput(input: {
  runnerResult: ToolCommandRunResult;
  secretValues: string[];
}): string {
  return summarizeCommandOutput(
    `stdout: ${input.runnerResult.stdout.length} chars`,
    `stderr: ${input.runnerResult.stderr.length} chars`,
    input.secretValues
  );
}

function copyRunRecord(run: RunRecord): RunRecord {
  return {
    ...run,
    contextSummary: {
      injected: [...run.contextSummary.injected],
      omitted: [...run.contextSummary.omitted]
    }
  };
}

function copyToolObservationRecord(observation: ToolObservationRecord): ToolObservationRecord {
  return {
    ...observation,
    input: structuredClone(observation.input)
  };
}

function normalizeRuntimeMCPConnector(
  connector: MCPConnectorRecord
): MCPConnectorRecord | undefined {
  try {
    const definition = normalizeMCPConnectorDefinition({
      id: connector.id,
      name: connector.name,
      description: connector.description,
      tools: connector.tools
    });
    return {
      ...connector,
      name: definition.name,
      description: definition.description,
      tools: definition.tools
    };
  } catch {
    return undefined;
  }
}

function copyMCPToolDefinition(tool: unknown): MCPToolDefinition | undefined {
  if (!isRecord(tool)) {
    return undefined;
  }
  const name = normalizeOptionalString(tool.name);
  const permission = normalizeOptionalString(tool.permission);
  if (!name || !permission || typeof tool.requiresApproval !== "boolean") {
    return undefined;
  }
  const roles = Array.isArray(tool.roles)
    ? tool.roles.filter(isMCPAgentRole)
    : [];
  const description = normalizeOptionalString(tool.description);
  return {
    name,
    ...(description ? { description } : {}),
    permission,
    roles,
    requiresApproval: tool.requiresApproval
  };
}

function isMCPAgentRole(role: unknown): role is AgentRole {
  return agentRoles.includes(role as AgentRole);
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    entrypoints: [...manifest.entrypoints],
    commands: manifest.commands?.map((command) => ({
      ...command,
      args: [...command.args],
      env: command.env?.map((binding) => ({ ...binding }))
    }))
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

function isProjectModelProviderForProject(
  provider: ModelProviderRecord,
  projectId: string
): boolean {
  return provider.scope === "project" && provider.targetKey === projectId;
}

function isProjectMCPConnectorForProject(
  connector: MCPConnectorRecord,
  projectId: string
): boolean {
  return connector.scope === "project" && connector.targetKey === projectId;
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
