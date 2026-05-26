import {
  createArtifactWorkspaceManifest,
  createStaticArtifactWorkspaceFiles,
  staticArtifactsFromWorkspaceFiles,
  type ArtifactWorkspaceFileRecord,
  type ArtifactWorkspaceKind,
  type ArtifactWorkspaceManifest,
  type ArtifactWorkspaceRecord,
  type StaticArtifacts
} from "@lp-agent/artifacts";
import {
  createInMemoryWorkbenchRepositories,
  type BriefRecord,
  type MCPConnectorRecord,
  type MCPToolApprovalRecord,
  type ModelProviderRecord,
  type ModelProviderType,
  type ModelRoutingPolicyRecord,
  type PageVersionRecord,
  type ProjectMemberRecord,
  type ProjectRole,
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
  DeterministicMCPToolExecutor,
  computeVisibleTools,
  isReadOnlyMCPTool,
  normalizeMCPConnectorDefinition,
  summarizeMCPToolArguments,
  type ApprovalState,
  type AgentRole as MCPAgentRole,
  type MCPToolDefinition,
  type MCPToolApprovalState,
  type MCPToolExecutionResult,
  type MCPToolExecutor
} from "@lp-agent/mcp-gateway";
import {
  InMemoryModelGateway,
  ModelProviderConfigurationError,
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
  type RuntimeRunRequest,
  type RuntimeRunResult,
  type RuntimeStreamEvent
} from "@lp-agent/runtime-adapters";
import {
  SkillManifestSchema,
  canPublishSkill,
  canUseSkill,
  type SkillManifest
} from "@lp-agent/skills";
import {
  createSimulatedSandboxPolicy,
  type SafeWorkerJobInput,
  type SandboxPolicy
} from "@lp-agent/worker-runtime";
import {
  RunEventRecordSchema,
  nextRepositoryTimestamp,
  runAgentStep
} from "./run-orchestrator";
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
  createStructuredLPBriefRepairPrompt,
  parsePlannerLPBriefOutput,
  toLPBriefParseFailurePayload,
  toLPBriefParseSuccessPayload
} from "./structured-lp-brief";
import {
  BuilderStaticArtifactParseError,
  createStructuredStaticArtifactsBuilderPrompt,
  createStructuredStaticArtifactsRepairPrompt,
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
import type { SkillCommandQueueRuntime } from "./skill-command-worker-queue";
import {
  createAgentHandoffRecord,
  markInboundHandoffsConsumed,
  toHandoffRunEventDraft,
  type RunEventDraft
} from "./agent-handoffs";
import {
  createAssistantChatPrompt,
  createAssistantContextSummary,
  type AssistantContextSummary
} from "./assistant-chat";
import {
  diffPageVersionArtifactWorkspaces,
  diffRepositoryArtifactWorkspaces,
  readRepositoryArtifactWorkspaceFile,
  type DiffPageVersionArtifactWorkspacesInput,
  type DiffRepositoryArtifactWorkspacesInput,
  type ReadRepositoryArtifactWorkspaceFileInput
} from "./artifact-reader";
import {
  createProjectMemberId,
  defaultLocalWorkbenchUser,
  normalizeWorkbenchUserIdentity,
  toProjectMemberView,
  type ProjectMemberView,
  type WorkbenchUserIdentity
} from "./collaboration";
import { assembleContextPack } from "./context-assembler";
import {
  buildTaskFollowupSuggestionsPrompt,
  buildTaskInputIntentPrompt,
  normalizeTaskFollowupSuggestionsOutput,
  normalizeTaskInputIntentOutput,
  type TaskFollowupSuggestion,
  type TaskInputIntent
} from "./task-intent-routing";

export {
  ArtifactReaderError,
  diffPageVersionArtifactWorkspaces,
  diffRepositoryArtifactWorkspaces,
  readRepositoryArtifactWorkspaceFile,
  type ArtifactReaderErrorCode,
  type DiffPageVersionArtifactWorkspacesInput,
  type DiffRepositoryArtifactWorkspacesInput,
  type ReadRepositoryArtifactWorkspaceFileInput
} from "./artifact-reader";
export {
  AgentHandoffArtifactRefsSchema,
  AgentHandoffRecordSchema,
  RuntimeHandoffSummarySchema,
  assembleRuntimeHandoffs,
  createAgentHandoffRecord,
  markInboundHandoffsConsumed,
  sanitizeHandoffText,
  toHandoffRunEventDraft,
  toRuntimeHandoffSummary,
  type AssembleRuntimeHandoffsResult,
  type RunEventDraft
} from "./agent-handoffs";
export {
  createProjectMemberId,
  createWorkspaceMemberId,
  defaultLocalWorkbenchUser,
  normalizeWorkbenchUserIdentity,
  toProjectMemberView,
  type ProjectMemberView,
  type WorkbenchUserIdentity
} from "./collaboration";
export {
  WorkerBackedToolCommandRunner,
  createSandboxPolicyForToolCommand,
  type SandboxPolicyResolver
} from "./worker-backed-tool-command-runner";
export {
  deriveTaskInterruptView,
  interruptTask,
  linkWorkerJobToTask,
  type InterruptTaskResult,
  type TaskInterruptState,
  type TaskInterruptView,
  type TaskInterruptWorkerRuntime
} from "./task-interrupts";
export {
  TASK_INPUT_INTENT_CONFIDENCE_THRESHOLD,
  buildTaskFollowupSuggestionsPrompt,
  buildTaskInputIntentPrompt,
  normalizeTaskFollowupSuggestionsOutput,
  normalizeTaskInputIntentOutput,
  type TaskFollowupSuggestion,
  type TaskFollowupSuggestionIntent,
  type TaskInputIntent,
  type TaskInputIntentType
} from "./task-intent-routing";
export * from "./run-lifecycle";
export * from "./run-recovery";
export {
  createLocalWorkerQueueRuntime,
  createWorkerQueueSnapshot,
  finalizeWorkerBackedSkillCommand,
  runLocalWorkerOnceAndFinalize,
  type LocalWorkerQueueRuntime,
  type RunLocalWorkerOnceResult,
  type SkillCommandQueueRuntime,
  type WorkerHeartbeatStatus,
  type WorkerQueueSnapshot,
  type WorkerQueueSnapshotLog
} from "./skill-command-worker-queue";
export {
  createWorkerQueueRuntime,
  resolveWorkerRepositoryBackend,
  type CreateWorkerQueueRuntimeOptions,
  type WorkerQueueRuntimeEnv,
  type WorkerQueueRuntimeRepositoryFactoryResult,
  type WorkerQueueRuntimeRepositories,
  type WorkerRepositoryBackend
} from "./worker-queue-repository-factory";

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
  ProjectMemberRecord,
  ProjectRole,
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

export interface TaskIntentRecentMessage {
  role: string;
  content: string;
}

export interface TaskIntentArtifactSummaryFile {
  path: string;
  summary?: string;
}

export interface TaskIntentArtifactSummary {
  hasPreview: boolean;
  files: TaskIntentArtifactSummaryFile[];
}

export interface RouteTaskInputIntentInput {
  projectId: string;
  taskId?: string;
  prompt: string;
  currentTask?: {
    id: string;
    type: "general_chat" | "lp_generation" | "project_setup";
    projectId?: string;
    status: string;
  };
  recentMessages: TaskIntentRecentMessage[];
  artifactSummary?: TaskIntentArtifactSummary;
}

export interface GenerateTaskFollowupSuggestionsInput {
  projectId: string;
  taskId?: string;
  taskTitle: string;
  taskStatus: string;
  recentMessages: TaskIntentRecentMessage[];
  artifactSummary?: TaskIntentArtifactSummary;
}

export interface CreateProjectInput {
  name: string;
}

export interface CreateBriefFromPromptInput {
  projectId: string;
  prompt: string;
  taskId?: string;
  runId?: string;
}

export interface GeneratePageVersionInput {
  projectId: string;
  briefId: string;
  taskId?: string;
  runId?: string;
  contextPageVersionId?: string;
}

export interface GetSnapshotForRecordsInput {
  projectId: string;
  briefId?: string;
  pageVersionId?: string;
}

export interface ReviewPageVersionInput {
  projectId: string;
  pageVersionId: string;
  taskId?: string;
  runId?: string;
}

export interface ApproveAndCreateDeploymentInput {
  projectId: string;
  pageVersionId: string;
  reviewerUserId: string;
  taskId?: string;
  runId?: string;
  failIfDeploymentExists?: boolean;
}

export interface ExecuteProjectSkillCommandInput {
  projectId: string;
  skillVersionId: string;
  commandId: string;
  pageVersionId?: string;
  taskId?: string;
  approvedByUserId: string;
}

export interface EnqueueProjectSkillCommandInput extends ExecuteProjectSkillCommandInput {}

export interface SkillCommandExecutionResult {
  run: RunRecord;
  observation: ToolObservationRecord;
}

export interface QueuedSkillCommandExecutionResult extends SkillCommandExecutionResult {
  workerJobId: string;
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
  pageVersionId?: string;
  role: AgentRole;
}

export interface ProjectMCPState {
  connectors: MCPConnectorRecord[];
  approvals: MCPToolApprovalRecord[];
  visibleToolsByRole: Record<AgentRole, RuntimeRunContext["mcpTools"]>;
}

export interface ExecuteProjectMCPToolInput {
  projectId: string;
  connectorId: string;
  toolName: string;
  role: AgentRole;
  arguments?: Record<string, unknown>;
  taskId?: string;
  timeoutMs?: number;
}

export interface MCPToolExecutionFlowResult {
  run: RunRecord;
  observation: ToolObservationRecord;
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

export interface RunAssistantChatInput {
  projectId: string;
  taskId?: string;
  prompt: string;
  runId?: string;
}

export type RunAssistantChatResult =
  | {
      ok: true;
      content: string;
      runId: string;
      contextSummary: AssistantContextSummary;
    }
  | {
      ok: false;
      error: AssistantChatErrorCode;
      runId?: string;
      contextSummary?: AssistantContextSummary;
    };

export type RunAssistantChatStreamResult =
  | {
      ok: true;
      runId: string;
      content?: string;
      stream?: AsyncIterable<string>;
      cancelStream?: () => void;
      contextSummary: AssistantContextSummary;
    }
  | {
      ok: false;
      error: AssistantChatErrorCode;
      runId?: string;
      contextSummary?: AssistantContextSummary;
    };

export type AssistantChatErrorCode =
  | "project_not_found"
  | "generation_failed"
  | "provider_configuration_failed";

export type AssistantChatStreamFailureCode =
  | "provider_configuration_failed"
  | "stream_interrupted"
  | "empty_response"
  | "generation_failed";

export class AssistantChatStreamError extends Error {
  readonly code: AssistantChatStreamFailureCode;

  constructor(code: AssistantChatStreamFailureCode, message = "assistant stream failed") {
    super(message);
    this.name = "AssistantChatStreamError";
    this.code = code;
  }
}

interface AssistantStreamCancellation {
  readonly cancelled: Promise<void>;
  cancel(): void;
}

export type RuntimeEnvironment = Record<string, string | undefined>;

export interface DemoWorkbenchServiceOptions {
  repositories?: WorkbenchRepositories;
  assistantRuntime?: AgentRuntimeAdapter;
  plannerRuntime?: AgentRuntimeAdapter;
  builderRuntime?: AgentRuntimeAdapter;
  reviewerRuntime?: AgentRuntimeAdapter;
  deployerRuntime?: AgentRuntimeAdapter;
  deploymentAdapter?: GitDeploymentAdapter;
  toolCommandRunner?: ToolCommandRunner;
  workerQueueRuntime?: SkillCommandQueueRuntime;
  mcpToolExecutor?: MCPToolExecutor;
  env?: RuntimeEnvironment;
  modelFetch?: ModelFetch;
  currentUser?: WorkbenchUserIdentity;
  now?: () => Date;
}

export class DemoWorkbenchService {
  private readonly repositories: WorkbenchRepositories;
  private readonly assistantRuntime: AgentRuntimeAdapter;
  private readonly plannerRuntime: AgentRuntimeAdapter;
  private readonly builderRuntime: AgentRuntimeAdapter;
  private readonly reviewerRuntime: AgentRuntimeAdapter;
  private readonly deployerRuntime: AgentRuntimeAdapter;
  private readonly deploymentAdapter: GitDeploymentAdapter;
  private readonly toolCommandRunner: ToolCommandRunner;
  private readonly workerQueueRuntime?: SkillCommandQueueRuntime;
  private readonly mcpToolExecutor: MCPToolExecutor;
  private readonly env: RuntimeEnvironment;
  private readonly currentUser: WorkbenchUserIdentity;
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
    this.assistantRuntime = options.assistantRuntime ?? createLocalRuntimeAdapter(runtimeFactoryInput);
    this.plannerRuntime = options.plannerRuntime ?? createLocalRuntimeAdapter(runtimeFactoryInput);
    this.builderRuntime = options.builderRuntime ?? createLocalRuntimeAdapter(runtimeFactoryInput);
    this.reviewerRuntime = options.reviewerRuntime ?? createLocalRuntimeAdapter(runtimeFactoryInput);
    this.deployerRuntime = options.deployerRuntime ?? createLocalRuntimeAdapter(runtimeFactoryInput);
    this.deploymentAdapter = options.deploymentAdapter ?? new InMemoryGitDeploymentAdapter();
    this.toolCommandRunner = options.toolCommandRunner ?? new RejectingToolCommandRunner();
    this.workerQueueRuntime = options.workerQueueRuntime;
    this.mcpToolExecutor = options.mcpToolExecutor ?? new DeterministicMCPToolExecutor();
    this.currentUser = normalizeWorkbenchUserIdentity(options.currentUser);
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
      // v0 recovery path: if owner membership persistence fails after project save,
      // createProject rejects and idempotent ensureProjectOwnerMembership can repair it.
      await this.repositories.projects.save(project);
      await this.ensureProjectOwnerMembership(project.id);
      return copyProject(project);
    });
  }

  async ensureProjectOwnerMembership(
    projectId: string,
    user: WorkbenchUserIdentity = this.currentUser
  ): Promise<ProjectMemberView> {
    await this.getProjectOrThrow(projectId);
    const normalizedUser = normalizeWorkbenchUserIdentity(user);
    const existing = await this.repositories.projectMembers.getByProjectAndUser(
      projectId,
      normalizedUser.id
    );
    if (existing) {
      return toProjectMemberView(existing);
    }

    const timestamp = this.timestamp();
    const member: ProjectMemberRecord = {
      id: createProjectMemberId(projectId, normalizedUser.id),
      projectId,
      userId: normalizedUser.id,
      role: "owner",
      displayName: normalizedUser.displayName,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.repositories.projectMembers.save(member);
    return toProjectMemberView(member);
  }

  async addProjectMember(input: {
    projectId: string;
    userId: string;
    role: ProjectRole;
    displayName?: string;
  }): Promise<ProjectMemberView> {
    await this.getProjectOrThrow(input.projectId);
    const userId = input.userId.trim();
    if (userId.length === 0) {
      throw new Error("project_member_user_id_required");
    }
    const existing = await this.repositories.projectMembers.getByProjectAndUser(
      input.projectId,
      userId
    );
    const timestamp = this.timestamp();
    const member: ProjectMemberRecord = {
      id: existing?.id ?? createProjectMemberId(input.projectId, userId),
      projectId: input.projectId,
      userId,
      role: input.role,
      ...(input.displayName?.trim()
        ? { displayName: input.displayName.trim() }
        : existing?.displayName
          ? { displayName: existing.displayName }
          : {}),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    await this.repositories.projectMembers.save(member);
    return toProjectMemberView(member);
  }

  async listProjectMembers(projectId: string): Promise<ProjectMemberView[]> {
    await this.getProjectOrThrow(projectId);
    return (await this.repositories.projectMembers.listForProject(projectId)).map(
      toProjectMemberView
    );
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
      const { result, run, events } = await runAgentStep({
        repositories: this.repositories,
        service: this,
        runtime: this.plannerRuntime,
        runId: input.runId ?? `run_planner_${briefId}`,
        projectId: input.projectId,
        taskId: input.taskId,
        role: "planner",
        input: {
          prompt: plannerPrompt
        },
        now: this.now,
        finalizeResult: this.structuredPlannerOutputEnabled
          ? async ({ result, contextPack }) => {
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
                  const repaired = await repairPlannerResult({
                    runtime: this.plannerRuntime,
                    result,
                    projectId: input.projectId,
                    userPrompt: input.prompt,
                    context: contextPack.runtimeContext,
                    error
                  });
                  if (repaired.brief) {
                    parsedPlannerBrief = repaired.brief;
                  }
                  return repaired.result;
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

      const brief = await withRepositoryIdLock(this.repositories, async () => {
        const brief: BriefRecord = {
          id: briefId,
          projectId: input.projectId,
          prompt: input.prompt,
          brief: copyBrief(parsedPlannerBrief ?? sampleBrief),
          createdAt: this.timestamp()
        };
        await this.repositories.briefs.save(brief);
        return brief;
      });
      await this.saveHandoffForRun({
        runId: run.id,
        projectId: input.projectId,
        taskId: input.taskId,
        sequence: events.length + 1,
        fromRole: "planner",
        toRole: "builder",
        state: "ready",
        summary: "Planner produced LP brief",
        artifactRefs: {
          briefId: brief.id
        }
      });
      return copyBriefRecord(brief);
    } finally {
      releaseRepositoryId(this.repositories, briefId);
    }
  }

  async generatePageVersion(input: GeneratePageVersionInput): Promise<PageVersionRecord> {
    await this.getProjectOrThrow(input.projectId);
    const brief = await this.getBriefForProjectOrThrow(input.projectId, input.briefId);
    const contextPageVersionId = input.contextPageVersionId;
    if (contextPageVersionId) {
      await this.getPageVersionForProjectOrThrow(input.projectId, contextPageVersionId);
    }
    const pageVersionId = await reserveRepositoryId(this.repositories, "version", async () => {
      const [existingPageVersions, existingWorkspaces] = await Promise.all([
        this.repositories.pageVersions.listAll(),
        this.repositories.artifactWorkspaces.listAll()
      ]);
      return [
        ...existingPageVersions.map((record) => record.id),
        ...existingWorkspaces
          .map((record) => record.pageVersionId)
          .filter((id): id is string => id !== undefined)
      ];
    });
    let parsedBuilderArtifacts: StaticArtifacts | undefined;
    const builderPrompt = this.structuredBuilderOutputEnabled
      ? createStructuredStaticArtifactsBuilderPrompt(brief.brief)
      : brief.prompt;

    try {
      const { result, run, events } = await runAgentStep({
        repositories: this.repositories,
        service: this,
        runtime: this.builderRuntime,
        runId: input.runId ?? `run_builder_${pageVersionId}`,
        projectId: input.projectId,
        taskId: input.taskId,
        pageVersionId: contextPageVersionId,
        role: "builder",
        input: {
          brief: copyBrief(brief.brief),
          prompt: builderPrompt
        },
        beforeRuntime: () =>
          this.consumeReadyHandoffsForRun({
            projectId: input.projectId,
            taskId: input.taskId,
            role: "builder",
            artifactRefs: {
              briefId: brief.id
            }
          }),
        now: this.now,
        finalizeResult: this.structuredBuilderOutputEnabled
          ? async ({ result, contextPack }) => {
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
                  const repaired = await repairBuilderResult({
                    runtime: this.builderRuntime,
                    result,
                    projectId: input.projectId,
                    brief: brief.brief,
                    context: contextPack.runtimeContext,
                    error
                  });
                  if (repaired.artifacts) {
                    parsedBuilderArtifacts = repaired.artifacts;
                  }
                  return repaired.result;
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

      const artifactWorkspaceId = await reserveRepositoryId(
        this.repositories,
        "artifact_workspace",
        async () => {
          const existingWorkspaces = await this.repositories.artifactWorkspaces.listAll();
          return existingWorkspaces.map((record) => record.id);
        }
      );
      try {
        const createdAt = nextRepositoryTimestamp(this.repositories, this.now);
        const files = createStaticArtifactWorkspaceFiles({
          workspaceId: artifactWorkspaceId,
          projectId: input.projectId,
          pageVersionId,
          artifacts,
          createdAt
        });
        const workspace = {
          id: artifactWorkspaceId,
          projectId: input.projectId,
          pageVersionId,
          runId: run.id,
          kind: "static_lp" as const,
          state: "active" as const,
          createdAt,
          updatedAt: createdAt
        };
        const pageVersion: PageVersionRecord = {
          id: pageVersionId,
          projectId: input.projectId,
          briefId: brief.id,
          artifactWorkspaceId,
          artifacts: copyArtifacts(artifacts),
          reviewStatus: "pending",
          findings: [],
          createdAt
        };
        const workspaceManifest = createArtifactWorkspaceManifest({
          workspaceId: artifactWorkspaceId,
          projectId: input.projectId,
          pageVersionId,
          files
        });

        await withRepositoryIdLock(this.repositories, async () => {
          await this.repositories.artifactWorkspaces.save(workspace);
          for (const file of files) {
            await this.repositories.artifactWorkspaceFiles.save(file);
          }
          await this.repositories.pageVersions.save(pageVersion);
        });
        await this.saveArtifactWorkspaceCreatedEvent({
          runId: run.id,
          projectId: input.projectId,
          taskId: input.taskId,
          sequence: events.length + 1,
          kind: "static_lp",
          manifest: workspaceManifest
        });
        await this.saveHandoffForRun({
          runId: run.id,
          projectId: input.projectId,
          taskId: input.taskId,
          sequence: events.length + 2,
          fromRole: "builder",
          toRole: "reviewer",
          state: "ready",
          summary: "Builder produced static LP artifacts",
          artifactRefs: {
            briefId: brief.id,
            pageVersionId: pageVersion.id
          }
        });
        return copyPageVersion(pageVersion);
      } finally {
        releaseRepositoryId(this.repositories, artifactWorkspaceId);
      }
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

    const { result, run, events } = await runAgentStep({
      repositories: this.repositories,
      service: this,
      runtime: this.reviewerRuntime,
      runId: input.runId ?? `run_reviewer_${pageVersion.id}`,
      projectId: input.projectId,
      taskId: input.taskId,
      pageVersionId: pageVersion.id,
      role: "reviewer",
      input: {
        brief: copyBrief(brief.brief),
        prompt: "Review for launch blockers."
      },
      beforeRuntime: () =>
        this.consumeReadyHandoffsForRun({
          projectId: input.projectId,
          taskId: input.taskId,
          role: "reviewer",
          artifactRefs: {
            pageVersionId: pageVersion.id
          }
        }),
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
    const blockingFindings = findings.filter(
      (finding) => finding.blocksDeployment || finding.severity === "blocking"
    );
    await this.saveHandoffForRun({
      runId: run.id,
      projectId: input.projectId,
      taskId: input.taskId,
      sequence: events.length + 1,
      fromRole: "reviewer",
      toRole: "deployer",
      state: pageVersion.reviewStatus === "passed" ? "ready" : "blocked",
      summary: pageVersion.reviewStatus === "passed"
        ? "Reviewer passed page version"
        : "Reviewer blocked deployment",
      ...(blockingFindings.length > 0
        ? {
            blockingReason: blockingFindings
              .map((finding) => `${finding.target}: ${finding.explanation}`)
              .join("; ")
          }
        : {}),
      artifactRefs: {
        pageVersionId: pageVersion.id
      }
    });

    return copyPageVersion(pageVersion);
  }

  async approveAndCreateDeployment(input: ApproveAndCreateDeploymentInput): Promise<DeploymentHandoff> {
    await this.getProjectOrThrow(input.projectId);
    const pageVersion = await this.getPageVersionForProjectOrThrow(input.projectId, input.pageVersionId);
    if (input.reviewerUserId.trim().length === 0) {
      throw new Error("Reviewer user ID is required.");
    }
    await this.assertDeploymentHandoffReady({
      projectId: input.projectId,
      pageVersionId: pageVersion.id
    });
    if (pageVersion.reviewStatus !== "passed") {
      throw new Error("Page version must pass review before deployment.");
    }

    const existing = await this.repositories.deployments.getByPageVersionId(pageVersion.id);
    if (existing) {
      if (input.failIfDeploymentExists) {
        throw new Error("deployment_already_exists");
      }
      return copyDeployment(existing);
    }

    const { result } = await runAgentStep({
      repositories: this.repositories,
      service: this,
      runtime: this.deployerRuntime,
      runId: input.runId ?? `run_deployer_${pageVersion.id}`,
      projectId: input.projectId,
      taskId: input.taskId,
      pageVersionId: pageVersion.id,
      role: "deployer",
      input: {
        prompt: "Prepare deployment handoff."
      },
      beforeRuntime: () =>
        this.consumeReadyHandoffsForRun({
          projectId: input.projectId,
          taskId: input.taskId,
          role: "deployer",
          artifactRefs: {
            pageVersionId: pageVersion.id
          }
        }),
      now: this.now
    });

    if (result.state === "failed") {
      throw new Error("Deployer run failed.");
    }
    if (result.state !== "completed") {
      throw new Error("Deployer run did not complete.");
    }

    return withRepositoryIdLock(this.repositories, async () => {
      const existingAfterRun = await this.repositories.deployments.getByPageVersionId(pageVersion.id);
      if (existingAfterRun) {
        if (input.failIfDeploymentExists) {
          throw new Error("deployment_already_exists");
        }
        return copyDeployment(existingAfterRun);
      }

      const deployment = await this.deploymentAdapter.createHandoff({
        projectId: input.projectId,
        pageVersionId: pageVersion.id,
        approved: true,
        artifacts: copyArtifacts(pageVersion.artifacts)
      });
      await this.repositories.deployments.save(deployment);
      return copyDeployment(deployment);
    });
  }

  async executeProjectSkillCommand(
    input: ExecuteProjectSkillCommandInput
  ): Promise<SkillCommandExecutionResult> {
    await this.getProjectOrThrow(input.projectId);
    if (input.approvedByUserId.trim().length === 0) {
      throw new Error("skill_command_approval_required");
    }
    const taskId = await this.resolveOptionalTaskIdForProject(input.projectId, input.taskId);
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
        ...(taskId ? { taskId } : {}),
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
          ...(taskId ? { taskId } : {}),
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
        ...(taskId ? { taskId } : {}),
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

  async enqueueProjectSkillCommand(
    input: EnqueueProjectSkillCommandInput
  ): Promise<QueuedSkillCommandExecutionResult> {
    if (!this.workerQueueRuntime) {
      throw new Error("worker_runtime_not_configured");
    }
    await this.getProjectOrThrow(input.projectId);
    if (input.approvedByUserId.trim().length === 0) {
      throw new Error("skill_command_approval_required");
    }
    const taskId = await this.resolveOptionalTaskIdForProject(input.projectId, input.taskId);
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
    assertSkillCommandQueueable(command);

    const runId = await reserveRepositoryId(this.repositories, "run_skill_command", async () => {
      const existingRuns = await this.repositories.runs.listAll();
      return existingRuns.map((record) => record.id);
    });
    let observationId: string | undefined;

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

      const variables: CommandTemplateVariables = {
        projectId: input.projectId,
        skillId: version.skillId,
        skillVersionId: version.id,
        commandId: command.id,
        runId,
        ...(pageVersion ? { pageVersionId: pageVersion.id } : {})
      };
      const env = resolveSkillCommandEnvironment({
        manifest: version.manifest,
        command,
        runtimeEnv: this.env,
        variables
      });
      const args = command.args.map((arg) => resolveCommandTemplate(arg, variables));
      const envNames = Object.keys(env).sort();

      const startedAt = this.timestamp();
      const run: RunRecord = {
        id: runId,
        projectId: input.projectId,
        ...(taskId ? { taskId } : {}),
        role: "deployer",
        state: "running",
        startedAt,
        contextSummary: {
          injected: [
            `skillCommand:${version.skillId}:${command.id}`,
            "workerQueue:safe"
          ],
          omitted: []
        }
      };
      await this.repositories.runs.save(run);

      const observation: ToolObservationRecord = {
        id: observationId,
        runId,
        projectId: input.projectId,
        ...(taskId ? { taskId } : {}),
        toolName: `skill:${version.skillId}:${command.id}`,
        input: {
          skillId: version.skillId,
          skillVersionId: version.id,
          commandId: command.id,
          permission: command.permission,
          approvedByUserId: input.approvedByUserId,
          ...(pageVersion ? { pageVersionId: pageVersion.id } : {}),
          argCount: args.length,
          envNames
        },
        outputSummary: "",
        state: "running",
        createdAt: startedAt
      };
      await this.repositories.toolObservations.save(observation);

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
          ...(taskId ? { taskId } : {}),
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
      await saveEvent("tool.started", "Deployment skill command queued.", {
        ...basePayload,
        observationId
      });

      let workerJobId: string | undefined;
      try {
        const workerJob = await this.workerQueueRuntime.enqueueSafe(
          createSafeWorkerJobInput({
            projectId: input.projectId,
            commandId: command.id,
            command,
            args,
            envNames
          }),
          createQueueSandboxPolicy({
            command,
            envNames
          })
        );
        workerJobId = workerJob.id;
        await saveEvent("worker.job.linked", "Worker job linked to task.", {
          ...basePayload,
          ...(taskId ? { taskId } : {}),
          runId,
          workerJobId,
          observationId
        });
      } catch (error) {
        if (workerJobId) {
          await cancelQueuedWorkerJobBestEffort(
            this.workerQueueRuntime,
            workerJobId,
            "Worker job link failed."
          );
        }
        await markQueuedSkillCommandRunFailedBestEffort({
          repositories: this.repositories,
          run,
          observation,
          nextSequence: sequence,
          timestamp: () => this.timestamp(),
          basePayload,
          workerJobId,
          outputSummary: workerJobId
            ? "Worker job link failed."
            : "Worker job enqueue failed.",
          errorName: workerJobId
            ? "worker_job_link_failed"
            : "worker_job_enqueue_failed"
        });
        throw error;
      }

      return {
        run: copyRunRecord(run),
        observation: copyToolObservationRecord(observation),
        workerJobId
      };
    } finally {
      releaseRepositoryId(this.repositories, runId);
      if (observationId) {
        releaseRepositoryId(this.repositories, observationId);
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
      currentPageVersion: currentPageVersion
        ? await this.hydratePageVersionArtifacts(currentPageVersion)
        : undefined,
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
      currentPageVersion: currentPageVersion
        ? await this.hydratePageVersionArtifacts(currentPageVersion)
        : undefined,
      deployment: deployment ? copyDeployment(deployment) : undefined
    };
  }

  async readArtifactWorkspaceFile(
    input: Omit<ReadRepositoryArtifactWorkspaceFileInput, "repositories">
  ) {
    await this.getProjectOrThrow(input.projectId);
    return readRepositoryArtifactWorkspaceFile({
      ...input,
      repositories: this.repositories
    });
  }

  async diffArtifactWorkspaces(
    input: Omit<DiffRepositoryArtifactWorkspacesInput, "repositories">
  ) {
    await this.getProjectOrThrow(input.projectId);
    return diffRepositoryArtifactWorkspaces({
      ...input,
      repositories: this.repositories
    });
  }

  async diffPageVersionArtifactWorkspaces(
    input: Omit<DiffPageVersionArtifactWorkspacesInput, "repositories">
  ) {
    await this.getProjectOrThrow(input.projectId);
    return diffPageVersionArtifactWorkspaces({
      ...input,
      repositories: this.repositories
    });
  }

  private async hydratePageVersionArtifacts(
    pageVersion: PageVersionRecord
  ): Promise<PageVersionRecord> {
    const copiedPageVersion = copyPageVersion(pageVersion);
    if (!copiedPageVersion.artifactWorkspaceId) {
      return copiedPageVersion;
    }

    const workspace = await this.repositories.artifactWorkspaces.getById(
      copiedPageVersion.artifactWorkspaceId
    );
    if (!workspace) {
      return copiedPageVersion;
    }
    this.assertArtifactWorkspaceOwnership(workspace, copiedPageVersion);

    let files: ArtifactWorkspaceFileRecord[];
    try {
      files = await this.repositories.artifactWorkspaceFiles.listForWorkspace(workspace.id);
    } catch {
      return copiedPageVersion;
    }

    this.assertArtifactWorkspaceFileOwnership(files, workspace, copiedPageVersion);

    try {
      return {
        ...copiedPageVersion,
        artifacts: staticArtifactsFromWorkspaceFiles(files)
      };
    } catch {
      return copiedPageVersion;
    }
  }

  private assertArtifactWorkspaceOwnership(
    workspace: ArtifactWorkspaceRecord,
    pageVersion: PageVersionRecord
  ): void {
    if (
      workspace.projectId !== pageVersion.projectId ||
      workspace.pageVersionId !== pageVersion.id
    ) {
      throw new Error(
        `Artifact workspace ${workspace.id} does not belong to page version ${pageVersion.id}.`
      );
    }
  }

  private assertArtifactWorkspaceFileOwnership(
    files: ArtifactWorkspaceFileRecord[],
    workspace: ArtifactWorkspaceRecord,
    pageVersion: PageVersionRecord
  ): void {
    const mismatchedFile = files.find((file) =>
      file.workspaceId !== workspace.id ||
      file.projectId !== pageVersion.projectId ||
      file.pageVersionId !== pageVersion.id
    );
    if (mismatchedFile) {
      throw new Error(
        `Artifact workspace file ${mismatchedFile.path} does not belong to page version ${pageVersion.id}.`
      );
    }
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
        approvedByUserId: input.approved ? input.approvedByUserId ?? this.currentUser.id : undefined,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp
      };
      await this.repositories.mcpToolApprovals.save(approval);
      return copyMCPToolApprovalRecord(approval);
    });
  }

  async listProjectMCPState(projectId: string): Promise<ProjectMCPState> {
    await this.getProjectOrThrow(projectId);
    const visibleEntries: Array<readonly [AgentRole, RuntimeRunContext["mcpTools"]]> =
      await Promise.all(
        mcpRuntimeAgentRoles.map(
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
    visibleEntries.push(["assistant", []]);
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
    if (!isMCPRuntimeAgentRole(role)) {
      return [];
    }
    const skillVersions = await this.listRuntimeSkillsForProject(input.projectId);
    return this.resolveVisibleMCPTools({
      projectId: input.projectId,
      role,
      skillVersions
    });
  }

  async executeProjectMCPTool(
    input: ExecuteProjectMCPToolInput
  ): Promise<MCPToolExecutionFlowResult> {
    await this.getProjectOrThrow(input.projectId);
    const role = normalizeAgentRole(input.role);
    if (!isMCPRuntimeAgentRole(role)) {
      throw new Error("mcp_tool_not_visible");
    }
    const connectorRecord = await this.repositories.mcpConnectors.getById(input.connectorId);
    if (
      !connectorRecord ||
      !isProjectMCPConnectorForProject(connectorRecord, input.projectId)
    ) {
      throw new Error("mcp_connector_not_found");
    }
    if (connectorRecord.enabled !== true) {
      throw new Error("mcp_tool_not_visible");
    }

    const connector = normalizeRuntimeMCPConnector(connectorRecord);
    if (!connector) {
      throw new Error("mcp_tool_not_visible");
    }
    const tool = connector.tools.find((candidate) => candidate.name === input.toolName);
    if (!tool || !tool.roles.includes(role)) {
      throw new Error("mcp_tool_not_visible");
    }

    const skillVersions = await this.listRuntimeSkillsForProject(input.projectId);
    const grantedPermissions = new Set(
      skillVersions.flatMap((version) => version.manifest.permissions)
    );
    if (!grantedPermissions.has(tool.permission)) {
      throw new Error("mcp_tool_not_visible");
    }

    const approval = await this.repositories.mcpToolApprovals.getByProjectConnectorAndTool(
      input.projectId,
      connector.id,
      tool.name
    );
    if (tool.requiresApproval && approval?.state !== "approved") {
      throw new Error("mcp_tool_execution_approval_required");
    }
    if (!isReadOnlyMCPTool(tool)) {
      throw new Error("mcp_tool_execution_not_read_only");
    }

    const normalizedArguments = normalizeMCPToolExecutionArguments(input.arguments);
    const argumentSummary = summarizeMCPToolArguments(normalizedArguments);
    const argumentValues = collectMCPArgumentScalarValues(normalizedArguments);
    const sensitiveValues = [
      ...argumentValues.values,
      ...collectMCPSecretEnvValues(this.env)
    ].filter((value): value is string => typeof value === "string" && value.length > 0);
    const runId = await reserveRepositoryId(this.repositories, "run_mcp_tool", async () => {
      const existingRuns = await this.repositories.runs.listAll();
      return existingRuns.map((record) => record.id);
    });
    let observationId: string | undefined;

    try {
      observationId = await reserveRepositoryId(
        this.repositories,
        "tool_observation",
        async () => {
          const observations = await this.repositories.toolObservations.listAll();
          return observations.map((record) => record.id);
        }
      );
      const startedAt = this.timestamp();
      const run: RunRecord = {
        id: runId,
        projectId: input.projectId,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        role,
        state: "running",
        startedAt,
        contextSummary: {
          injected: [`mcpTool:${connector.id}:${tool.name}`],
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
          ...(input.taskId ? { taskId: input.taskId } : {}),
          sequence,
          type,
          message,
          payload,
          createdAt: this.timestamp()
        });
        sequence += 1;
      };
      const basePayload = {
        connectorId: connector.id,
        toolName: tool.name,
        role,
        permission: tool.permission,
        requiresApproval: tool.requiresApproval,
        approvedByUserId: approval?.approvedByUserId,
        argumentKeys: argumentSummary.argumentKeys,
        argumentCount: argumentSummary.argumentCount
      };
      await saveEvent("run.started", "MCP tool run started.", basePayload);
      await saveEvent("tool.started", "MCP tool started.", {
        ...basePayload,
        observationId
      });

      const executorResult = await this.runMCPToolSafely({
        projectId: input.projectId,
        connectorId: connector.id,
        toolName: tool.name,
        role,
        permission: tool.permission,
        arguments: normalizedArguments,
        timeoutMs: input.timeoutMs ?? 30000
      });
      const completedAt = this.timestamp();
      const observationState = toMCPToolObservationState(executorResult.state);
      const runState = toMCPRunState(executorResult.state);
      const outputSummary = sanitizeMCPOutputSummary(
        executorResult.outputSummary,
        sensitiveValues,
        argumentValues.complete,
        observationState
      );
      const errorName = sanitizeMCPExecutorErrorName(
        executorResult.errorName,
        sensitiveValues,
        argumentValues.complete,
        observationState
      );
      const durationMs = normalizeMCPDurationMs(executorResult.durationMs);
      const finalPayload = {
        ...basePayload,
        observationId,
        outputSummary,
        ...(errorName !== undefined ? { errorName } : {}),
        ...(durationMs !== undefined ? { durationMs } : {})
      };
      await saveEvent(
        observationState === "completed" ? "tool.completed" : "tool.failed",
        observationState === "completed" ? "MCP tool completed." : "MCP tool failed.",
        finalPayload
      );
      await saveEvent(
        runState === "completed" ? "run.completed" : "run.failed",
        runState === "completed" ? "MCP tool run completed." : "MCP tool run failed.",
        finalPayload
      );

      const observation: ToolObservationRecord = {
        id: observationId,
        runId,
        projectId: input.projectId,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        toolName: `mcp:${connector.id}:${tool.name}`,
        input: {
          connectorId: connector.id,
          toolName: tool.name,
          role,
          permission: tool.permission,
          requiresApproval: tool.requiresApproval,
          approvedByUserId: approval?.approvedByUserId,
          argumentKeys: argumentSummary.argumentKeys,
          argumentCount: argumentSummary.argumentCount
        },
        outputSummary,
        state: observationState,
        ...(errorName !== undefined ? { errorName } : {}),
        createdAt: startedAt,
        completedAt
      };
      await this.repositories.toolObservations.save(observation);

      const finalRun: RunRecord = {
        ...run,
        state: runState,
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
    }
  }

  async createRuntimeContextForRole(
    input: CreateRuntimeContextForRoleInput
  ): Promise<RuntimeRunContext> {
    await this.getProjectOrThrow(input.projectId);
    const role = normalizeAgentRole(input.role);
    return this.createRuntimeContext(input.projectId, role, input.pageVersionId);
  }

  async routeTaskInputIntent(input: RouteTaskInputIntentInput): Promise<TaskInputIntent> {
    let runId: string | undefined;
    try {
      const project = await this.getProjectOrThrow(input.projectId);
      const taskId = await this.resolveOptionalTaskIdForProject(project.id, input.taskId);
      const prompt = buildTaskInputIntentPrompt(toTaskInputIntentPromptInput(input, taskId));
      runId = await reserveRepositoryId(this.repositories, "run_task_intent", async () =>
        (await this.repositories.runs.listForProject(project.id)).map((run) => run.id)
      );

      const { result } = await runAgentStep({
        repositories: this.repositories,
        service: this,
        runtime: this.assistantRuntime,
        runId,
        projectId: project.id,
        taskId,
        role: "assistant",
        input: { prompt },
        now: this.now
      });

      return normalizeTaskInputIntentOutput(result.modelOutputText ?? "");
    } catch {
      return normalizeTaskInputIntentOutput("");
    } finally {
      if (runId) {
        releaseRepositoryId(this.repositories, runId);
      }
    }
  }

  async generateTaskFollowupSuggestions(
    input: GenerateTaskFollowupSuggestionsInput
  ): Promise<TaskFollowupSuggestion[]> {
    let runId: string | undefined;
    try {
      const project = await this.getProjectOrThrow(input.projectId);
      const taskId = await this.resolveOptionalTaskIdForProject(project.id, input.taskId);
      const prompt = buildTaskFollowupSuggestionsPrompt(
        toTaskFollowupSuggestionsPromptInput(input, taskId)
      );
      runId = await reserveRepositoryId(this.repositories, "run_task_followups", async () =>
        (await this.repositories.runs.listForProject(project.id)).map((run) => run.id)
      );

      const { result } = await runAgentStep({
        repositories: this.repositories,
        service: this,
        runtime: this.assistantRuntime,
        runId,
        projectId: project.id,
        taskId,
        role: "assistant",
        input: { prompt },
        now: this.now
      });

      return normalizeTaskFollowupSuggestionsOutput(result.modelOutputText ?? "");
    } catch {
      return [];
    } finally {
      if (runId) {
        releaseRepositoryId(this.repositories, runId);
      }
    }
  }

  async runAssistantChat(input: RunAssistantChatInput): Promise<RunAssistantChatResult> {
    let project: ProjectRecord;
    try {
      project = await this.getProjectOrThrow(input.projectId);
    } catch {
      return { ok: false, error: "project_not_found" };
    }

    let taskId: string | undefined;
    try {
      taskId = await this.resolveOptionalTaskIdForProject(project.id, input.taskId);
    } catch {
      return { ok: false, error: "project_not_found" };
    }

    let runId: string | undefined;
    let contextSummary: AssistantContextSummary | undefined;
    let createdRunId = false;

    try {
      const contextPack = await assembleContextPack({
        repositories: this.repositories,
        service: this,
        projectId: project.id,
        taskId,
        role: "assistant",
        input: { prompt: input.prompt },
        now: this.now
      });
      contextSummary = createAssistantContextSummary({
        project,
        runtimeMode: this.env.REAL_MODEL_RUNTIME === "1" ? "real" : "deterministic",
        skills: contextPack.runtimeContext.skills
      });
      if (input.runId !== undefined) {
        runId = input.runId;
      } else {
        runId = await reserveRepositoryId(this.repositories, "run_assistant", async () =>
          (await this.repositories.runs.listForProject(project.id)).map((run) => run.id)
        );
        createdRunId = true;
      }

      const { result } = await runAgentStep({
        repositories: this.repositories,
        service: this,
        runtime: this.assistantRuntime,
        runId,
        projectId: project.id,
        taskId,
        role: "assistant",
        input: {
          prompt: createAssistantChatPrompt({
            userPrompt: input.prompt,
            project,
            context: contextPack.runtimeContext,
            trace: contextPack.trace
          })
        },
        now: this.now
      });

      if (result.state !== "completed" || !result.modelOutputText?.trim()) {
        return createAssistantChatGenerationFailure(runId, contextSummary);
      }

      return {
        ok: true,
        content: result.modelOutputText,
        runId,
        contextSummary
      };
    } catch (error) {
      return createAssistantChatFailureForError(error, runId, contextSummary);
    } finally {
      if (createdRunId && runId) {
        releaseRepositoryId(this.repositories, runId);
      }
    }
  }

  async runAssistantChatStream(
    input: RunAssistantChatInput
  ): Promise<RunAssistantChatStreamResult> {
    let project: ProjectRecord;
    try {
      project = await this.getProjectOrThrow(input.projectId);
    } catch {
      return { ok: false, error: "project_not_found" };
    }

    let taskId: string | undefined;
    try {
      taskId = await this.resolveOptionalTaskIdForProject(project.id, input.taskId);
    } catch {
      return { ok: false, error: "project_not_found" };
    }

    let runId: string | undefined;
    let releaseRunId: (() => void) | undefined;
    let contextSummary: AssistantContextSummary | undefined;

    try {
      const contextPack = await assembleContextPack({
        repositories: this.repositories,
        service: this,
        projectId: project.id,
        taskId,
        role: "assistant",
        input: { prompt: input.prompt },
        now: this.now
      });
      contextSummary = createAssistantContextSummary({
        project,
        runtimeMode: this.env.REAL_MODEL_RUNTIME === "1" ? "real" : "deterministic",
        skills: contextPack.runtimeContext.skills
      });
      if (input.runId !== undefined) {
        runId = input.runId;
      } else {
        runId = await reserveRepositoryId(this.repositories, "run_assistant", async () =>
          (await this.repositories.runs.listForProject(project.id)).map((run) => run.id)
        );
        releaseRunId = () => releaseRepositoryId(this.repositories, runId!);
      }

      const assistantRoute = contextPack.runtimeContext.modelRoutingPolicy?.assistant;
      const canUseProviderStreaming =
        canStreamAssistantRoute(assistantRoute) &&
        typeof this.assistantRuntime.stream === "function";
      if (!canUseProviderStreaming) {
        const result = await this.runAssistantChat({
          ...input,
          taskId,
          runId
        });
        releaseRunId?.();
        releaseRunId = undefined;
        if (!result.ok) {
          return result;
        }
        return {
          ok: true,
          runId: result.runId,
          content: result.content,
          contextSummary: result.contextSummary
        };
      }

      const runtimeRequest: RuntimeRunRequest = {
        runId,
        projectId: project.id,
        ...(taskId ? { taskId } : {}),
        role: "assistant",
        input: {
          prompt: createAssistantChatPrompt({
            userPrompt: input.prompt,
            project,
            context: contextPack.runtimeContext,
            trace: contextPack.trace
          })
        },
        context: contextPack.runtimeContext
      };
      const cancellation = createAssistantStreamCancellation();
      const stream = this.streamAssistantChatDeltas({
        runtimeRequest,
        contextTrace: contextPack.trace,
        releaseRunId,
        cancellation
      });
      releaseRunId = undefined;
      return {
        ok: true,
        runId,
        stream,
        cancelStream: cancellation.cancel,
        contextSummary
      };
    } catch (error) {
      releaseRunId?.();
      return createAssistantChatFailureForError(error, runId, contextSummary);
    }
  }

  private async *streamAssistantChatDeltas(input: {
    runtimeRequest: RuntimeRunRequest;
    contextTrace: { injected: string[]; omitted: string[] };
    releaseRunId?: () => void;
    cancellation?: AssistantStreamCancellation;
  }): AsyncIterable<string> {
    const startedAt = nextRepositoryTimestamp(this.repositories, this.now);
    const startedRun: RunRecord = {
      id: input.runtimeRequest.runId,
      projectId: input.runtimeRequest.projectId,
      taskId: input.runtimeRequest.taskId,
      role: "assistant",
      state: "running",
      startedAt,
      contextSummary: {
        injected: [...input.contextTrace.injected],
        omitted: [...input.contextTrace.omitted]
      }
    };
    let terminalResult: RuntimeRunResult | undefined;
    let persistedTerminal = false;

    try {
      await this.repositories.runs.save(startedRun);
      const runtimeStream = this.assistantRuntime.stream!(input.runtimeRequest);
      const runtimeIterator = runtimeStream[Symbol.asyncIterator]();
      for (;;) {
        const read = await readAssistantRuntimeStreamEvent(runtimeIterator, input.cancellation);
        if (read.type === "cancelled") {
          if (runtimeIterator.return) {
            void Promise.resolve(runtimeIterator.return()).catch(() => undefined);
          }
          terminalResult = createAssistantStreamCancelledResult(input.runtimeRequest);
          await this.persistStreamingAssistantRun({
            startedRun,
            result: terminalResult
          });
          persistedTerminal = true;
          return;
        }
        if (read.type === "done") {
          break;
        }
        const event = read.event;
        if (event.type === "model.delta") {
          yield event.text;
        } else {
          terminalResult = event.result;
          break;
        }
      }
      if (!terminalResult) {
        terminalResult = createAssistantStreamFailedResult(
          input.runtimeRequest,
          "assistant_stream_interrupted"
        );
      }
      terminalResult = normalizeAssistantStreamingTerminalResult(terminalResult);
      await this.persistStreamingAssistantRun({
        startedRun,
        result: terminalResult
      });
      persistedTerminal = true;
      if (terminalResult.state !== "completed") {
        throw new AssistantChatStreamError(classifyAssistantStreamFailure(terminalResult));
      }
    } catch (error) {
      const failedResult = createAssistantStreamFailedResult(
        input.runtimeRequest,
        error instanceof AssistantChatStreamError
          ? `assistant_${error.code}`
          : "assistant_stream_interrupted"
      );
      if (!persistedTerminal) {
        await this.persistStreamingAssistantRun({
          startedRun,
          result: failedResult
        });
        persistedTerminal = true;
      }
      throw error instanceof AssistantChatStreamError
        ? error
        : new AssistantChatStreamError("stream_interrupted");
    } finally {
      if (!persistedTerminal) {
        try {
          await this.persistStreamingAssistantRun({
            startedRun,
            result: createAssistantStreamCancelledResult(input.runtimeRequest)
          });
        } catch {
          // Stream cancellation cleanup is best-effort and must not mask the original outcome.
        }
      }
      input.releaseRunId?.();
    }
  }

  private async persistStreamingAssistantRun(input: {
    startedRun: RunRecord;
    result: RuntimeRunResult;
  }): Promise<void> {
    const completedAt = nextRepositoryTimestamp(this.repositories, this.now);
    const state = toRunRecordState(input.result.state);
    const run: RunRecord = {
      ...input.startedRun,
      state,
      ...(state === "running" ? {} : { completedAt })
    };
    await this.repositories.runs.save(run);

    const runtimeEvents = normalizeStreamingRuntimeEvents({
      events: input.result.events,
      runId: input.startedRun.id,
      role: "assistant",
      state: input.result.state
    });
    for (const [index, event] of runtimeEvents.entries()) {
      await this.repositories.runEvents.save(
        toStreamingRunEventRecord({
          event,
          runId: input.startedRun.id,
          projectId: input.startedRun.projectId,
          taskId: input.startedRun.taskId,
          sequence: index + 1,
          createdAt: completedAt
        })
      );
    }
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
      assistant: { ...defaultPolicy.assistant },
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
      const fallbackConfig = normalizeModelFallbackConfig(route.fallback);
      const fallbackProvider = fallbackConfig
        ? await this.repositories.modelProviders.getById(fallbackConfig.providerId)
        : undefined;
      const fallbackMetadata =
        fallbackConfig &&
        fallbackProvider &&
        fallbackProvider.enabled &&
        isProjectModelProviderForProject(fallbackProvider, projectId)
          ? {
              provider: fallbackProvider.id,
              providerName: fallbackProvider.name,
              api: resolveProviderApi(fallbackProvider),
              model: fallbackConfig.model,
              baseUrlConfigured: Boolean(fallbackProvider.config.baseUrl),
              apiKeyEnvConfigured: Boolean(
                fallbackProvider.config.apiKeyEnv ?? fallbackProvider.config.secretEnvName
              )
            }
          : undefined;
      resolved[role] = {
        provider: provider.id,
        providerName: provider.name,
        api,
        model: route.model,
        baseUrlConfigured: Boolean(provider.config.baseUrl),
        apiKeyEnvConfigured: Boolean(provider.config.apiKeyEnv ?? provider.config.secretEnvName),
        ...(modelCapabilities ? { modelCapabilities } : {}),
        ...(fallbackMetadata ? { fallback: fallbackMetadata } : {})
      };
    }

    return resolved;
  }

  private async resolveVisibleMCPTools(input: {
    projectId: string;
    role: MCPRuntimeAgentRole;
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
        requiresApproval: tool.requiresApproval,
        ...(tool.readOnly !== undefined ? { readOnly: tool.readOnly } : {}),
        ...(tool.sideEffect ? { sideEffect: tool.sideEffect } : {})
      }))
    );
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private async saveArtifactWorkspaceCreatedEvent(input: {
    runId: string;
    projectId: string;
    taskId?: string;
    sequence: number;
    kind: ArtifactWorkspaceKind;
    manifest: ArtifactWorkspaceManifest;
  }): Promise<void> {
    await this.repositories.runEvents.save({
      id: `${input.runId}_event_${input.sequence}`,
      runId: input.runId,
      projectId: input.projectId,
      taskId: input.taskId,
      sequence: input.sequence,
      type: "artifact.workspace.created",
      message: "Artifact workspace created.",
      payload: {
        workspaceId: input.manifest.workspaceId,
        artifactWorkspaceId: input.manifest.workspaceId,
        pageVersionId: input.manifest.pageVersionId,
        kind: input.kind,
        files: input.manifest.files.map((file) => ({ ...file })),
        fileCount: input.manifest.files.length
      },
      createdAt: nextRepositoryTimestamp(this.repositories, this.now)
    });
  }

  private async saveHandoffForRun(input: {
    runId: string;
    projectId: string;
    taskId?: string;
    sequence: number;
    fromRole: AgentRole;
    toRole: AgentRole;
    state: "ready" | "blocked";
    summary: string;
    blockingReason?: string;
    artifactRefs?: {
      briefId?: string;
      pageVersionId?: string;
    };
  }): Promise<void> {
    const reservation = await this.reserveHandoffId();
    const handoffTimestamp = nextRepositoryTimestamp(this.repositories, this.now);
    const handoff = createAgentHandoffRecord({
      id: reservation.id,
      projectId: input.projectId,
      taskId: input.taskId,
      fromRunId: input.runId,
      fromRole: input.fromRole,
      toRole: input.toRole,
      state: input.state,
      summary: input.summary,
      blockingReason: input.blockingReason,
      artifactRefs: input.artifactRefs,
      now: () => new Date(handoffTimestamp)
    });
    try {
      await this.repositories.agentHandoffs.save(handoff);
      const event = toHandoffRunEventDraft(handoff);
      await this.repositories.runEvents.save({
        id: `${input.runId}_event_${input.sequence}`,
        runId: input.runId,
        projectId: input.projectId,
        taskId: input.taskId,
        sequence: input.sequence,
        type: event.type,
        message: event.message,
        payload: event.payload,
        createdAt: nextRepositoryTimestamp(this.repositories, this.now)
      });
    } finally {
      reservation.release();
    }
  }

  private async reserveHandoffId(): Promise<{ id: string; release: () => void }> {
    const id = await reserveRepositoryId(this.repositories, "handoff", async () => {
      const handoffs = await this.repositories.agentHandoffs.listAll();
      return handoffs.map((record) => record.id);
    });
    return {
      id,
      release: () => releaseRepositoryId(this.repositories, id)
    };
  }

  private async consumeReadyHandoffsForRun(input: {
    projectId: string;
    taskId?: string;
    role: AgentRole;
    artifactRefs?: {
      briefId?: string;
      pageVersionId?: string;
    };
  }): Promise<RunEventDraft[]> {
    return markInboundHandoffsConsumed({
      repositories: this.repositories,
      projectId: input.projectId,
      taskId: input.taskId,
      role: input.role,
      artifactRefs: input.artifactRefs,
      consumedAt: nextRepositoryTimestamp(this.repositories, this.now)
    });
  }

  private async assertDeploymentHandoffReady(input: {
    projectId: string;
    pageVersionId: string;
  }): Promise<void> {
    const inbound = await this.repositories.agentHandoffs.listInbound({
      projectId: input.projectId,
      toRole: "deployer"
    });
    const matching = inbound
      .filter((handoff) => handoff.artifactRefs?.pageVersionId === input.pageVersionId)
      .sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.createdAt.localeCompare(left.createdAt) ||
        left.id.localeCompare(right.id)
      );
    const latest = matching[0];
    if (latest?.state === "blocked") {
      throw new Error("agent_handoff_blocked");
    }
  }

  private async createRuntimeContext(
    projectId: string,
    role: AgentRole,
    pageVersionId?: string,
    approvalState: ApprovalState = "not_required"
  ): Promise<RuntimeRunContext> {
    const [skillVersions, modelRoutingPolicy, artifactWorkspace] = await Promise.all([
      this.listRuntimeSkillsForProject(projectId),
      this.resolveModelRoutingPolicyForProject(projectId),
      this.createRuntimeArtifactWorkspaceContext(projectId, pageVersionId)
    ]);
    const mcpTools = isMCPRuntimeAgentRole(role)
      ? await this.resolveVisibleMCPTools({ projectId, role, skillVersions })
      : [];
    return createWorkbenchRuntimeContext({
      role,
      approvalState,
      skillVersions,
      mcpTools,
      modelRoutingPolicy,
      artifactWorkspace
    });
  }

  private async createRuntimeArtifactWorkspaceContext(
    projectId: string,
    pageVersionId?: string
  ): Promise<RuntimeRunContext["artifactWorkspace"]> {
    const legacyWorkspace = createLegacyRuntimeArtifactWorkspace();
    const pageVersion = pageVersionId
      ? await this.getPageVersionForProjectOrThrow(projectId, pageVersionId)
      : await this.repositories.pageVersions.findLatestForProject(projectId);
    if (!pageVersion?.artifactWorkspaceId) {
      return legacyWorkspace;
    }

    const workspace = await this.repositories.artifactWorkspaces.getById(
      pageVersion.artifactWorkspaceId
    );
    if (!workspace) {
      return legacyWorkspace;
    }
    this.assertArtifactWorkspaceOwnership(workspace, pageVersion);

    let files: ArtifactWorkspaceFileRecord[];
    try {
      files = await this.repositories.artifactWorkspaceFiles.listForWorkspace(workspace.id);
    } catch {
      return legacyWorkspace;
    }

    this.assertArtifactWorkspaceFileOwnership(files, workspace, pageVersion);

    try {
      const manifest = createArtifactWorkspaceManifest({
        workspaceId: workspace.id,
        projectId: workspace.projectId,
        pageVersionId: workspace.pageVersionId,
        files
      });

      return {
        ...legacyWorkspace,
        workspaceId: manifest.workspaceId,
        files: manifest.files
      };
    } catch {
      return legacyWorkspace;
    }
  }

  private async getProjectOrThrow(projectId: string): Promise<ProjectRecord> {
    const project = await this.repositories.projects.getById(projectId);
    if (!project) {
      throw new Error("Project not found.");
    }
    return project;
  }

  private async resolveOptionalTaskIdForProject(
    projectId: string,
    taskId: string | undefined
  ): Promise<string | undefined> {
    const normalizedTaskId = taskId?.trim();
    if (!normalizedTaskId) {
      return undefined;
    }
    const task = await this.repositories.tasks.getById(normalizedTaskId);
    if (!task || task.projectId !== projectId) {
      throw new Error("project_not_found");
    }
    return normalizedTaskId;
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

  private async runMCPToolSafely(
    input: Parameters<MCPToolExecutor["execute"]>[0]
  ): Promise<MCPToolExecutionResult> {
    try {
      return await this.mcpToolExecutor.execute(input);
    } catch {
      return {
        state: "failed",
        outputSummary: "MCP executor failed.",
        errorName: "mcp_executor_error"
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
  ContextMemorySchema,
  ContextMemoryMessageSummarySchema,
  ContextMemoryRunSummarySchema,
  ContextMemoryToolSummarySchema,
  ContextMemoryArtifactSummarySchema,
  assembleContextMemory,
  toContextMemoryQuery,
  truncatePreview,
  type AssembleContextMemoryInput,
  type ContextMemory
} from "./context-memory";

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
  return {
    ...input.result,
    state: "failed",
    events: [
      ...input.result.events.filter((event) => event.type !== "run.completed"),
      toPlannerParseFailureEvent(input),
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

async function repairPlannerResult(input: {
  runtime: AgentRuntimeAdapter;
  result: RuntimeRunResult;
  projectId: string;
  userPrompt: string;
  context: RuntimeRunContext;
  error: PlannerLPBriefParseError;
}): Promise<{ result: RuntimeRunResult; brief?: LPBrief }> {
  const parseFailedEvent = toPlannerParseFailureEvent({
    result: input.result,
    error: input.error
  });
  const repairStarted = toPlannerRepairStartedEvent({
    result: input.result,
    error: input.error
  });
  const repairResult = await input.runtime.run({
    runId: input.result.runId,
    projectId: input.projectId,
    role: "planner",
    input: {
      prompt: createStructuredLPBriefRepairPrompt({
        userPrompt: input.userPrompt,
        failure: {
          reason: input.error.reason,
          ...input.error.issueSummary
        }
      })
    },
    context: input.context
  });
  const repairEvents = selectModelAttemptEvents(repairResult.events);
  try {
    const brief = parsePlannerLPBriefOutput(repairResult.modelOutputText ?? "");
    return {
      brief,
      result: {
        ...input.result,
        events: [
          ...input.result.events.filter((event) => event.type !== "run.completed"),
          parseFailedEvent,
          repairStarted,
          ...repairEvents,
          toPlannerRepairSuccessEvent({
            result: input.result,
            brief
          }),
          {
            type: "run.completed",
            message: "planner run completed",
            runId: input.result.runId,
            state: "completed"
          }
        ]
      }
    };
  } catch (error) {
    if (error instanceof PlannerLPBriefParseError) {
      return {
        result: failPlannerResultForRepairError({
          result: input.result,
          parseFailedEvent,
          repairStarted,
          repairEvents,
          error
        })
      };
    }
    throw error;
  }
}

function toPlannerParseFailureEvent(input: {
  result: RuntimeRunResult;
  error: PlannerLPBriefParseError;
}): RuntimeEvent {
  const issueSummary = input.error.issueSummary;
  return {
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
  };
}

function toPlannerRepairStartedEvent(input: {
  result: RuntimeRunResult;
  error: PlannerLPBriefParseError;
}): RuntimeEvent {
  return {
    type: "model.output.repair_started",
    message: "Planner output repair started",
    runId: input.result.runId,
    role: "planner",
    schema: "LPBriefSchema",
    reason: input.error.reason,
    ...input.error.issueSummary
  };
}

function toPlannerRepairSuccessEvent(input: {
  result: RuntimeRunResult;
  brief: LPBrief;
}): RuntimeEvent {
  return {
    ...toLPBriefParseSuccessPayload(input.brief),
    type: "model.output.repaired",
    message: "Planner output repaired as LP brief",
    runId: input.result.runId,
    role: "planner",
    schema: "LPBriefSchema",
    title: input.brief.title,
    sectionCount: input.brief.sections.length,
    productCount: input.brief.productData.length,
    hasAssets: input.brief.assets.length > 0
  };
}

function failPlannerResultForRepairError(input: {
  result: RuntimeRunResult;
  parseFailedEvent: RuntimeEvent;
  repairStarted: RuntimeEvent;
  repairEvents: RuntimeEvent[];
  error: PlannerLPBriefParseError;
}): RuntimeRunResult {
  const issueSummary = input.error.issueSummary;
  return {
    ...input.result,
    state: "failed",
    events: [
      ...input.result.events.filter((event) => event.type !== "run.completed"),
      input.parseFailedEvent,
      input.repairStarted,
      ...input.repairEvents,
      {
        ...toLPBriefParseFailurePayload(input.error),
        type: "model.output.repair_failed",
        message: "Planner output repair failed",
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
  return {
    ...input.result,
    state: "failed",
    artifacts: undefined,
    events: [
      ...input.result.events.filter(
        (event) => event.type !== "run.completed" && event.type !== "artifact.created"
      ),
      toBuilderParseFailureEvent(input),
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

async function repairBuilderResult(input: {
  runtime: AgentRuntimeAdapter;
  result: RuntimeRunResult;
  projectId: string;
  brief: LPBrief;
  context: RuntimeRunContext;
  error: BuilderStaticArtifactParseError;
}): Promise<{ result: RuntimeRunResult; artifacts?: StaticArtifacts }> {
  const parseFailedEvent = toBuilderParseFailureEvent({
    result: input.result,
    error: input.error
  });
  const repairStarted = toBuilderRepairStartedEvent({
    result: input.result,
    error: input.error
  });
  const repairResult = await input.runtime.run({
    runId: input.result.runId,
    projectId: input.projectId,
    role: "builder",
    input: {
      brief: copyBrief(input.brief),
      prompt: createStructuredStaticArtifactsRepairPrompt({
        brief: input.brief,
        failure: {
          reason: input.error.reason,
          ...(input.error.policyCode ? { policyCode: input.error.policyCode } : {}),
          ...input.error.issueSummary
        }
      })
    },
    context: input.context
  });
  const repairEvents = selectModelAttemptEvents(repairResult.events);
  try {
    const artifacts = parseBuilderStaticArtifactsOutput(repairResult.modelOutputText ?? "");
    return {
      artifacts,
      result: {
        ...input.result,
        artifacts,
        modelOutputText: repairResult.modelOutputText,
        events: [
          ...input.result.events.filter((event) => event.type !== "run.completed"),
          parseFailedEvent,
          repairStarted,
          ...repairEvents,
          toBuilderRepairSuccessEvent({
            result: input.result,
            artifacts
          }),
          {
            type: "run.completed",
            message: "builder run completed",
            runId: input.result.runId,
            state: "completed"
          }
        ]
      }
    };
  } catch (error) {
    if (error instanceof BuilderStaticArtifactParseError) {
      return {
        result: failBuilderResultForRepairError({
          result: input.result,
          parseFailedEvent,
          repairStarted,
          repairEvents,
          error
        })
      };
    }
    throw error;
  }
}

function toBuilderParseFailureEvent(input: {
  result: RuntimeRunResult;
  error: BuilderStaticArtifactParseError;
}): RuntimeEvent {
  const issueSummary = input.error.issueSummary;
  return {
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
  };
}

function toBuilderRepairStartedEvent(input: {
  result: RuntimeRunResult;
  error: BuilderStaticArtifactParseError;
}): RuntimeEvent {
  return {
    ...toStaticArtifactParseFailurePayload(input.error),
    type: "model.output.repair_started",
    message: "Builder output repair started",
    runId: input.result.runId,
    role: "builder",
    schema: "StaticArtifactsSchema",
    reason: input.error.reason,
    ...(input.error.policyCode ? { policyCode: input.error.policyCode } : {}),
    ...input.error.issueSummary
  };
}

function toBuilderRepairSuccessEvent(input: {
  result: RuntimeRunResult;
  artifacts: StaticArtifacts;
}): RuntimeEvent {
  const payload = toStaticArtifactParseSuccessPayload(input.artifacts);
  return {
    ...payload,
    type: "model.output.repaired",
    message: "Builder output repaired as static artifacts",
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

function failBuilderResultForRepairError(input: {
  result: RuntimeRunResult;
  parseFailedEvent: RuntimeEvent;
  repairStarted: RuntimeEvent;
  repairEvents: RuntimeEvent[];
  error: BuilderStaticArtifactParseError;
}): RuntimeRunResult {
  const issueSummary = input.error.issueSummary;
  return {
    ...input.result,
    state: "failed",
    artifacts: undefined,
    events: [
      ...input.result.events.filter((event) => event.type !== "run.completed"),
      input.parseFailedEvent,
      input.repairStarted,
      ...input.repairEvents,
      {
        ...toStaticArtifactParseFailurePayload(input.error),
        type: "model.output.repair_failed",
        message: "Builder output repair failed",
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

function selectModelAttemptEvents(events: RuntimeEvent[]): RuntimeEvent[] {
  return events.filter((event) =>
    [
      "model.retry.scheduled",
      "model.retry.exhausted",
      "model.completed",
      "model.fallback.available",
      "model.fallback.not_configured"
    ].includes(event.type)
  );
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
  artifactWorkspace: RuntimeRunContext["artifactWorkspace"];
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
    artifactWorkspace: cloneRuntimeArtifactWorkspace(input.artifactWorkspace),
    modelRoutingPolicy: input.modelRoutingPolicy
  };
}

function createLegacyRuntimeArtifactWorkspace(): RuntimeRunContext["artifactWorkspace"] {
  return {
    mode: "memory",
    writableFiles: ["index.html", "styles.css", "script.js"]
  };
}

function cloneRuntimeArtifactWorkspace(
  workspace: RuntimeRunContext["artifactWorkspace"]
): RuntimeRunContext["artifactWorkspace"] {
  return {
    mode: workspace.mode,
    ...(workspace.workspaceId ? { workspaceId: workspace.workspaceId } : {}),
    ...(workspace.basePath ? { basePath: workspace.basePath } : {}),
    writableFiles: [...workspace.writableFiles],
    ...(workspace.files ? { files: workspace.files.map((file) => ({ ...file })) } : {})
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

function normalizeModelFallbackConfig(
  value: Record<string, unknown> | undefined
): { providerId: string; model: string } | undefined {
  if (!value) {
    return undefined;
  }
  const providerId = typeof value.providerId === "string" ? value.providerId.trim() : "";
  const model = typeof value.model === "string" ? value.model.trim() : "";
  if (!providerId || !model) {
    return undefined;
  }
  return { providerId, model };
}

function normalizeAgentRole(role: unknown): AgentRole {
  if (agentRoles.includes(role as AgentRole)) {
    return role as AgentRole;
  }
  throw new Error("model_role_unsupported");
}

type MCPRuntimeAgentRole = Exclude<AgentRole, "assistant">;

const mcpRuntimeAgentRoles = Object.freeze([
  "planner",
  "builder",
  "reviewer",
  "deployer"
] as const) satisfies readonly MCPAgentRole[];

function isMCPRuntimeAgentRole(role: AgentRole): role is MCPRuntimeAgentRole {
  return role !== "assistant";
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

function normalizeMCPToolExecutionArguments(
  value: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error("mcp_tool_arguments_invalid");
  }
  return structuredClone(value);
}

function toMCPToolObservationState(
  state: MCPToolExecutionResult["state"]
): ToolObservationRecord["state"] {
  if (state === "completed" || state === "cancelled") {
    return state;
  }
  return "failed";
}

function toMCPRunState(state: MCPToolExecutionResult["state"]): RunRecord["state"] {
  if (state === "completed" || state === "cancelled") {
    return state;
  }
  return "failed";
}

function sanitizeMCPOutputSummary(
  value: string,
  sensitiveValues: string[],
  redactionComplete: boolean,
  state: ToolObservationRecord["state"]
): string {
  const fallback =
    state === "completed"
      ? "MCP tool completed."
      : state === "cancelled"
        ? "MCP tool cancelled."
        : "Read-only MCP tool failed.";
  if (!redactionComplete) {
    return fallback;
  }
  const normalized =
    typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : fallback;
  if (containsUnsafeMCPOutputSummary(normalized)) {
    return fallback;
  }
  const redacted = redactCommandOutput(normalized, sensitiveValues);
  const bounded =
    redacted.length <= 500 ? redacted : `${redacted.slice(0, 497)}...`;
  if (containsUnsafeMCPOutputSummary(bounded)) {
    return fallback;
  }
  return bounded;
}

function containsUnsafeMCPOutputSummary(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    /(^|[\s"'(])\/[^\s"'<>]+/.test(value) ||
    /(^|[\s"'(])(?:\.{1,2}\/)(?:[^\s/]+\/)*[^\s/]+/.test(value) ||
    /[A-Za-z]:[\\/][^\s"'<>]+/.test(value) ||
    /<!doctype\s+html/i.test(value) ||
    /<\s*\/?\s*[a-zA-Z][^>]*>/.test(value) ||
    /<\/?(?:html|head|body|script|style|main|section|article|div|span|p|a|img|link|meta|h[1-6]|ul|ol|li|button|form|input|label|header|footer|nav)\b/i.test(
      value
    ) ||
    /\bconsole\.(?:log|error|warn|info|debug)\s*\(/.test(value) ||
    /\b(?:function|const|let|var|class|import|export)\s+[A-Za-z_$]/.test(value) ||
    /(?:^|[\s;{}])\.[A-Za-z_-][A-Za-z0-9_-]*\s*\{[^}]*:[^}]*\}/.test(value) ||
    /(?:^|[\s;{}])#[A-Za-z_-][A-Za-z0-9_-]*\s*\{[^}]*:[^}]*\}/.test(value) ||
    /\b[A-Za-z-]+\s*:\s*[^;{}]+;/.test(value) ||
    normalized.includes("document.queryselector") ||
    normalized.includes("window.") ||
    normalized.includes("body {") ||
    normalized.includes(":root {")
  );
}

function collectMCPArgumentScalarValues(value: unknown): {
  values: string[];
  complete: boolean;
} {
  const maxDepth = 5;
  const maxValues = 100;
  const values: string[] = [];
  const seen = new Set<object>();
  const visit = (candidate: unknown, depth: number): boolean => {
    if (depth > maxDepth || values.length >= maxValues) {
      return false;
    }
    if (typeof candidate === "string") {
      if (candidate.length > 0) {
        values.push(candidate);
      }
      return true;
    }
    if (
      typeof candidate === "number" ||
      typeof candidate === "boolean" ||
      candidate === null
    ) {
      values.push(String(candidate));
      return true;
    }
    if (typeof candidate !== "object" || candidate === null) {
      return true;
    }
    if (seen.has(candidate)) {
      return false;
    }
    seen.add(candidate);
    const childValues = Array.isArray(candidate)
      ? candidate
      : Object.values(candidate as Record<string, unknown>);
    for (let index = 0; index < childValues.length; index += 1) {
      if (!visit(childValues[index], depth + 1)) {
        return false;
      }
      if (values.length >= maxValues && index < childValues.length - 1) {
        return false;
      }
    }
    return true;
  };
  return {
    values,
    complete: visit(value, 0)
  };
}

function collectMCPSecretEnvValues(env: RuntimeEnvironment): string[] {
  return Object.entries(env)
    .filter(([name]) => /(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY)/i.test(name))
    .map(([, value]) => value)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

function sanitizeMCPExecutorErrorName(
  errorName: string | undefined,
  sensitiveValues: string[],
  redactionComplete: boolean,
  state: ToolObservationRecord["state"]
): string | undefined {
  if (state !== "failed") {
    return undefined;
  }
  if (errorName === undefined || !redactionComplete) {
    return "mcp_executor_error";
  }
  const trimmed = errorName.trim();
  if (
    trimmed.length === 0 ||
    trimmed !== errorName ||
    trimmed.length > 80 ||
    /\s/.test(trimmed) ||
      !/^[A-Za-z0-9_.:-]+$/.test(trimmed)
  ) {
    return "mcp_executor_error";
  }
  if (redactCommandOutput(trimmed, sensitiveValues) !== trimmed) {
    return "mcp_executor_error";
  }
  return trimmed;
}

function normalizeMCPDurationMs(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.round(value);
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

function assertSkillCommandQueueable(
  command: NonNullable<SkillManifest["commands"]>[number]
): void {
  if ((command.env ?? []).some((binding) => binding.secretRef)) {
    throw new Error("skill_command_not_queueable");
  }
  if (command.workingDirectory) {
    throw new Error("skill_command_not_queueable");
  }
  const templateValues = collectSkillCommandTemplateValues(command).join("\n");
  if (
    templateValues.includes("artifactDir") ||
    templateValues.includes("artifact.indexHtmlPath") ||
    templateValues.includes("artifact.stylesCssPath") ||
    templateValues.includes("artifact.scriptJsPath")
  ) {
    throw new Error("skill_command_not_queueable");
  }
}

function createSafeWorkerJobInput(input: {
  projectId: string;
  commandId: string;
  command: NonNullable<SkillManifest["commands"]>[number];
  args: string[];
  envNames: string[];
}): SafeWorkerJobInput {
  return {
    projectId: input.projectId,
    kind: "tool_command",
    commandId: input.commandId,
    command: input.command.command,
    args: [...input.args],
    envNames: [...input.envNames].sort(),
    timeoutMs: resolveSkillCommandTimeout(input.command)
  };
}

function createQueueSandboxPolicy(input: {
  command: NonNullable<SkillManifest["commands"]>[number];
  envNames: string[];
}): SandboxPolicy {
  return createSimulatedSandboxPolicy({
    allowedCommands: [input.command.command],
    allowedEnvNames: [...input.envNames].sort(),
    timeoutMs: resolveSkillCommandTimeout(input.command),
    maxStdoutBytes: 300,
    maxStderrBytes: 300,
    network: "disabled"
  });
}

async function cancelQueuedWorkerJobBestEffort(
  workerRuntime: SkillCommandQueueRuntime,
  workerJobId: string,
  reason: string
): Promise<void> {
  const cancelableRuntime = workerRuntime as SkillCommandQueueRuntime & {
    cancelJob?: (id: string, reason?: string) => Promise<unknown>;
  };
  if (!cancelableRuntime.cancelJob) {
    return;
  }
  try {
    await cancelableRuntime.cancelJob(workerJobId, reason);
  } catch {
    // The run compensation below is the durable recovery path for the UI.
  }
}

async function markQueuedSkillCommandRunFailedBestEffort(input: {
  repositories: WorkbenchRepositories;
  run: RunRecord;
  observation: ToolObservationRecord;
  nextSequence: number;
  timestamp: () => string;
  basePayload: Record<string, unknown>;
  workerJobId?: string;
  outputSummary: string;
  errorName: string;
}): Promise<void> {
  try {
    const completedAt = input.timestamp();
    const terminalPayload = {
      ...input.basePayload,
      observationId: input.observation.id,
      ...(input.workerJobId ? { workerJobId: input.workerJobId } : {}),
      outputSummary: input.outputSummary,
      errorName: input.errorName
    };
    await input.repositories.toolObservations.save({
      ...input.observation,
      outputSummary: input.outputSummary,
      state: "failed",
      errorName: input.errorName,
      completedAt
    });
    await input.repositories.runEvents.save({
      id: `${input.run.id}_event_${input.nextSequence}`,
      runId: input.run.id,
      projectId: input.run.projectId,
      ...(input.run.taskId ? { taskId: input.run.taskId } : {}),
      sequence: input.nextSequence,
      type: "tool.failed",
      message: "Deployment skill command failed.",
      payload: terminalPayload,
      createdAt: completedAt
    });
    await input.repositories.runEvents.save({
      id: `${input.run.id}_event_${input.nextSequence + 1}`,
      runId: input.run.id,
      projectId: input.run.projectId,
      ...(input.run.taskId ? { taskId: input.run.taskId } : {}),
      sequence: input.nextSequence + 1,
      type: "run.failed",
      message: "Deployment skill command run failed.",
      payload: terminalPayload,
      createdAt: completedAt
    });
    await input.repositories.runs.save({
      ...input.run,
      state: "failed",
      completedAt
    });
  } catch {
    // Preserve the original enqueue/link rejection for callers.
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
  const readOnly = typeof tool.readOnly === "boolean" ? tool.readOnly : undefined;
  const sideEffect =
    tool.sideEffect === "read" || tool.sideEffect === "write"
      ? tool.sideEffect
      : undefined;
  return {
    name,
    ...(description ? { description } : {}),
    permission,
    roles,
    requiresApproval: tool.requiresApproval,
    ...(readOnly !== undefined ? { readOnly } : {}),
    ...(sideEffect ? { sideEffect } : {})
  };
}

function isMCPAgentRole(role: unknown): role is MCPRuntimeAgentRole {
  return mcpRuntimeAgentRoles.includes(role as MCPRuntimeAgentRole);
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

function createAssistantChatGenerationFailure(
  runId: string | undefined,
  contextSummary: AssistantContextSummary | undefined
): RunAssistantChatResult {
  return {
    ok: false,
    error: "generation_failed",
    ...(runId !== undefined ? { runId } : {}),
    ...(contextSummary !== undefined ? { contextSummary } : {})
  };
}

function toTaskInputIntentPromptInput(
  input: RouteTaskInputIntentInput,
  taskId: string | undefined
) {
  return {
    userPrompt: input.prompt,
    task: {
      id: input.currentTask?.id ?? taskId ?? "",
      type: input.currentTask?.type ?? "general_chat",
      status: input.currentTask?.status ?? "unknown",
      projectId: input.currentTask?.projectId ?? input.projectId
    },
    messages: input.recentMessages,
    artifacts: toTaskIntentPromptArtifacts(input.artifactSummary)
  };
}

function toTaskFollowupSuggestionsPromptInput(
  input: GenerateTaskFollowupSuggestionsInput,
  taskId: string | undefined
) {
  return {
    userPrompt: input.taskTitle,
    task: {
      id: taskId ?? "",
      type: "lp_generation",
      status: input.taskStatus,
      projectId: input.projectId
    },
    messages: input.recentMessages,
    artifacts: toTaskIntentPromptArtifacts(input.artifactSummary)
  };
}

function toTaskIntentPromptArtifacts(summary: TaskIntentArtifactSummary | undefined) {
  return (
    summary?.files.map((file) => ({
      filePath: file.path,
      summary: file.summary,
      hasPreview: summary.hasPreview
    })) ?? []
  );
}

function createAssistantChatFailureForError(
  error: unknown,
  runId: string | undefined,
  contextSummary: AssistantContextSummary | undefined
): RunAssistantChatResult {
  if (isProviderConfigurationFailure(error)) {
    return {
      ok: false,
      error: "provider_configuration_failed",
      ...(runId !== undefined ? { runId } : {}),
      ...(contextSummary !== undefined ? { contextSummary } : {})
    };
  }
  return createAssistantChatGenerationFailure(runId, contextSummary);
}

function isProviderConfigurationFailure(error: unknown): boolean {
  if (error instanceof ModelProviderConfigurationError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return assistantProviderConfigurationErrorCodes.has(error.message);
}

function createAssistantStreamCancellation(): AssistantStreamCancellation {
  let isCancelled = false;
  let resolveCancelled!: () => void;
  const cancelled = new Promise<void>((resolve) => {
    resolveCancelled = resolve;
  });
  return {
    cancelled,
    cancel() {
      if (isCancelled) {
        return;
      }
      isCancelled = true;
      resolveCancelled();
    }
  };
}

function createAssistantStreamFailedResult(
  request: RuntimeRunRequest,
  errorCode = "assistant_stream_failed"
): RuntimeRunResult {
  return {
    runId: request.runId,
    projectId: request.projectId,
    role: request.role,
    state: "failed",
    events: [
      {
        type: "run.failed",
        message: "assistant stream failed",
        runId: request.runId,
        role: request.role,
        state: "failed",
        errorCode
      }
    ]
  };
}

async function readAssistantRuntimeStreamEvent(
  iterator: AsyncIterator<RuntimeStreamEvent>,
  cancellation: AssistantStreamCancellation | undefined
): Promise<
  | { type: "event"; event: RuntimeStreamEvent }
  | { type: "done" }
  | { type: "cancelled" }
> {
  if (!cancellation) {
    const result = await iterator.next();
    return result.done ? { type: "done" } : { type: "event", event: result.value };
  }

  const read = await Promise.race([
    iterator.next().then((result) => ({ type: "next" as const, result })),
    cancellation.cancelled.then(() => ({ type: "cancelled" as const }))
  ]);
  if (read.type === "cancelled") {
    return { type: "cancelled" };
  }
  if (read.result.done) {
    return { type: "done" };
  }
  return { type: "event", event: read.result.value };
}

function createAssistantStreamCancelledResult(request: RuntimeRunRequest): RuntimeRunResult {
  return {
    runId: request.runId,
    projectId: request.projectId,
    role: request.role,
    state: "cancelled",
    events: [
      {
        type: "run.cancelled",
        message: "assistant stream cancelled",
        runId: request.runId,
        role: request.role,
        state: "cancelled"
      }
    ]
  };
}

function normalizeAssistantStreamingTerminalResult(result: RuntimeRunResult): RuntimeRunResult {
  if (result.state !== "completed" || result.modelOutputText?.trim()) {
    return result;
  }

  return {
    ...result,
    state: "failed",
    events: [
      ...result.events.filter((event) => event.type !== "run.completed"),
      {
        type: "run.failed",
        message: "assistant stream completed without usable text",
        runId: result.runId,
        role: result.role ?? "assistant",
        state: "failed",
        errorCode: "assistant_empty_response"
      }
    ],
    modelOutputText: undefined
  };
}

function classifyAssistantStreamFailure(
  result: RuntimeRunResult
): AssistantChatStreamFailureCode {
  const errorCode = [...result.events]
    .reverse()
    .map((event) => getRuntimeEventErrorCode(event))
    .find((code): code is string => typeof code === "string" && code.length > 0);

  if (errorCode === "assistant_empty_response") {
    return "empty_response";
  }
  if (errorCode && assistantProviderConfigurationErrorCodes.has(errorCode)) {
    return "provider_configuration_failed";
  }
  if (result.state === "failed") {
    return "stream_interrupted";
  }
  return "generation_failed";
}

const assistantProviderConfigurationErrorCodes = new Set([
  "model_id_required",
  "model_provider_api_key_env_missing",
  "model_provider_api_key_missing",
  "model_provider_base_url_missing",
  "model_provider_config_missing",
  "model_provider_disabled",
  "model_provider_fetch_unavailable",
  "model_provider_mock_route_disabled",
  "model_provider_protocol_mismatch",
  "model_route_not_configured",
  "model_route_provider_invalid"
]);

function getRuntimeEventErrorCode(event: RuntimeEvent): string | undefined {
  if (!("errorCode" in event) || typeof event.errorCode !== "string") {
    return undefined;
  }
  return event.errorCode;
}

function canStreamAssistantRoute(route: ModelRoute | undefined): boolean {
  if (!route) {
    return false;
  }
  if (route.modelCapabilities?.supportsStreaming === false) {
    return false;
  }
  return (
    route.modelCapabilities?.supportsStreaming === true ||
    route.api === "openai-completions" ||
    route.api === "anthropic-messages"
  );
}

function toRunRecordState(state: RuntimeRunResult["state"]): RunRecord["state"] {
  return state === "queued" ? "running" : state;
}

function normalizeStreamingRuntimeEvents(input: {
  events: RuntimeEvent[];
  runId: string;
  role: AgentRole;
  state: RuntimeRunResult["state"];
}): RuntimeEvent[] {
  if (input.state !== "failed" || input.events.some((event) => event.type === "run.failed")) {
    return input.events;
  }

  return [
    ...input.events,
    {
      type: "run.failed",
      message: `${input.role} run failed`,
      runId: input.runId,
      role: input.role,
      state: "failed"
    }
  ];
}

function toStreamingRunEventRecord(input: {
  event: RuntimeEvent;
  runId: string;
  projectId: string;
  taskId?: string;
  sequence: number;
  createdAt: string;
}): RunEventRecord {
  const payload = { ...input.event };
  delete (payload as { message?: string }).message;
  return RunEventRecordSchema.parse({
    id: `${input.runId}_event_${input.sequence}`,
    runId: input.runId,
    projectId: input.projectId,
    taskId: input.taskId,
    sequence: input.sequence,
    type: input.event.type,
    message: input.event.message,
    payload,
    createdAt: input.createdAt
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
