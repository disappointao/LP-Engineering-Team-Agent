import {
  DemoWorkbenchService,
  createWorkerQueueRuntime,
  createWorkerQueueSnapshot,
  deriveTaskInterruptView,
  executeRunRecoveryAction as executeApiRunRecoveryAction,
  interruptTask,
  listRunRecoveryViewsForTask,
  runLocalWorkerOnceAndFinalize,
  type AgentRole,
  type DemoWorkbenchServiceOptions,
  type InterruptTaskResult,
  type MCPConnectorRecord,
  type MCPToolApprovalRecord,
  type MCPToolExecutionFlowResult,
  type ModelProviderRecord,
  type ModelProviderType,
  type ModelRoutingPolicyRecord,
  type ProjectMCPState,
  type ProjectMemberView,
  type ProjectModelState,
  type ProjectRecord,
  type ProjectSkillState,
  type RunLifecycleView,
  type RunEventRecord,
  type RunLocalWorkerOnceResult,
  type RunRecoveryExecutionAction,
  type RunRecoveryExecutionErrorCode,
  type RunRecoveryExecutionResult,
  type RuntimeEnvironment,
  type SkillCommandExecutionResult,
  type SkillCommandQueueRuntime,
  type SkillBindingRecord,
  type SkillContentType,
  type SkillDraftResult,
  type SkillVersionRecord,
  type TaskFollowupSuggestion,
  type TaskInterruptView,
  type TaskIntentArtifactSummary,
  type TaskIntentRecentMessage,
  type TaskInputIntent,
  type TaskInterruptWorkerRuntime,
  type ToolCommandRunner,
  type WorkerQueueSnapshot,
  normalizeWorkbenchUserIdentity,
  type WorkbenchUserIdentity,
  type WorkbenchSnapshot
} from "@lp-agent/api";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ARTIFACT_WORKSPACE_DEFAULT_READ_MAX_BYTES,
  normalizeArtifactWorkspaceFilePath,
  type ArtifactWorkspaceDiffFile,
  type ArtifactWorkspaceFilePath
} from "@lp-agent/artifacts";
import {
  createInMemoryWorkbenchRepositories,
  type WorkbenchMessageRecord,
  type WorkbenchMessageRole,
  type WorkbenchRepositories,
  type WorkbenchTaskSnapshotRecord,
  type WorkbenchTaskRecord,
  type WorkbenchTaskStatus,
  type WorkbenchTaskType
} from "@lp-agent/db";
import { createDefaultModelPolicy, type ModelFetch } from "@lp-agent/model-gateway";
import type {
  WorkerJobRepository,
  WorkerLogRepository
} from "@lp-agent/worker-runtime";
import { chunkAssistantText } from "./chat-stream";
import { getLocalWorkbenchUser } from "./local-identity";
import { SimulatedToolCommandRunner } from "./simulated-tool-command-runner";
import { createWebWorkbenchRepositories } from "./workbench-repository-factory";

export type {
  MCPConnectorRecord,
  MCPToolApprovalRecord,
  ProjectMCPState
} from "@lp-agent/api";

export type ProjectFlowErrorCode =
  | "project_name_required"
  | "prompt_required"
  | "project_not_found"
  | "generation_failed"
  | "provider_configuration_failed";

export type InterruptFlowErrorCode =
  | "task_not_found"
  | "task_not_interruptible"
  | "interrupt_target_not_found"
  | "interrupt_failed";

export type TaskInterrupt = TaskInterruptView;
export type InterruptCurrentTaskResult = InterruptTaskResult;
export type RunRecoveryFlowErrorCode = RunRecoveryExecutionErrorCode;

export interface WorkbenchTaskRecoveryState {
  runs: RunLifecycleView[];
}

export type RunRecoveryActionResult =
  | { ok: true; value: RunRecoveryExecutionResult & { ok: true } }
  | { ok: false; error: RunRecoveryFlowErrorCode };

export type SkillFlowErrorCode =
  | "invalid_manifest_json"
  | "manifest_validation_failed"
  | "unsupported_skill_scope"
  | "duplicate_skill_version"
  | "skill_binding_already_exists"
  | "unsupported_content_type"
  | "skill_content_required"
  | "skill_content_too_large"
  | "project_not_found"
  | "skill_version_not_found"
  | "skill_version_not_validated"
  | "skill_version_not_published"
  | "skill_binding_not_found"
  | "publish_not_allowed"
  | "skill_operation_failed"
  | StableSkillCommandFlowErrorCode;

export type SkillCommandFlowErrorCode =
  | "project_not_found"
  | "skill_command_not_found"
  | "skill_command_not_bound"
  | "skill_command_not_deployment"
  | "skill_command_not_published"
  | "skill_command_permission_denied"
  | "skill_command_approval_required"
  | "skill_command_not_queueable"
  | "skill_command_page_version_not_found"
  | "skill_command_unknown_template_variable"
  | "skill_command_execution_failed";

export type SkillCommandQueueFlowErrorCode =
  | "worker_runtime_not_configured";

type SkillCommandExecutionFlowErrorCode =
  | SkillCommandFlowErrorCode
  | SkillCommandQueueFlowErrorCode;

type StableSkillCommandFlowErrorCode = SkillCommandFlowErrorCode;

export type WorkerQueueFlowErrorCode =
  | "worker_runtime_not_configured"
  | "worker_job_execution_failed"
  | "worker_job_finalization_failed";

export type ModelFlowErrorCode =
  | "project_not_found"
  | "model_provider_name_required"
  | "model_provider_key_required"
  | "model_provider_type_unsupported"
  | "model_provider_api_required"
  | "model_provider_api_unsupported"
  | "model_provider_base_url_invalid"
  | "model_provider_api_key_env_invalid"
  | "model_provider_model_id_required"
  | "model_provider_model_limit_invalid"
  | "model_provider_already_exists"
  | "model_provider_not_found"
  | "model_provider_disabled"
  | "model_provider_in_use"
  | "model_role_unsupported"
  | "model_id_required"
  | "model_route_not_found"
  | "model_route_provider_invalid"
  | "model_secret_reference_invalid"
  | "model_routing_operation_failed";

export type MCPFlowErrorCode =
  | "project_not_found"
  | "mcp_connector_json_invalid"
  | "mcp_connector_validation_failed"
  | "mcp_connector_scope_unsupported"
  | "mcp_connector_already_exists"
  | "mcp_connector_not_found"
  | "mcp_tool_not_found"
  | "mcp_tool_approval_not_required"
  | "mcp_tool_not_visible"
  | "mcp_tool_execution_not_read_only"
  | "mcp_tool_execution_approval_required"
  | "mcp_tool_execution_rejected"
  | "mcp_tool_execution_failed"
  | "mcp_tool_arguments_invalid"
  | "mcp_executor_not_configured"
  | "mcp_operation_failed";

export interface WebProjectModelState extends ProjectModelState {
  resolutionError?: ModelFlowErrorCode;
}

export type ProjectMemberSummary = ProjectMemberView;

export interface ProjectSkillCommandView {
  skillId: string;
  skillName: string;
  skillVersionId: string;
  commandId: string;
  commandName: string;
  description?: string;
  permission: string;
  requiresApproval: boolean;
}

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProjectFlowErrorCode };

export interface CreateProjectFormInput {
  name: string;
}

export type SkillActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SkillFlowErrorCode };

export type SkillCommandActionResult =
  | { ok: true; value: SkillCommandExecutionResult }
  | { ok: false; error: SkillCommandExecutionFlowErrorCode };

export type ModelActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ModelFlowErrorCode };

export type MCPActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MCPFlowErrorCode };

export type MCPExecutionActionResult =
  | { ok: true; value: MCPToolExecutionFlowResult }
  | { ok: false; error: MCPFlowErrorCode };

export interface CreateSkillDraftFormInput {
  manifestJson: string;
  content: string;
  contentType: SkillContentType;
}

export interface BindSkillVersionFormInput {
  projectId: string;
  skillVersionId: string;
}

export interface ExecuteSkillCommandFormInput {
  projectId: string;
  skillVersionId: string;
  commandId: string;
  pageVersionId?: string;
  taskId?: string;
}

export interface ExecuteRunRecoveryFormInput {
  taskId: string;
  runId: string;
  action: RunRecoveryExecutionAction;
}

export interface CreateModelProviderFormInput {
  projectId: string;
  providerId: string;
  name: string;
  provider: ModelProviderType | string;
  api?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  secretEnvName?: string;
  modelId?: string;
}

export interface UpsertProjectModelRouteFormInput {
  projectId: string;
  role: AgentRole | string;
  providerId: string;
  model: string;
}

export interface CreateMCPConnectorFormInput {
  projectId: string;
  definitionJson: string;
}

export interface SetMCPToolApprovalFormInput {
  projectId: string;
  connectorId: string;
  toolName: string;
  approved: boolean;
}

export interface ExecuteMCPToolFormInput {
  projectId: string;
  connectorId: string;
  toolName: string;
  role: AgentRole | string;
  argumentsJson?: string;
}

export type TaskType = WorkbenchTaskType;
export type TaskStatus = WorkbenchTaskStatus;
export type ChatMessageRole = WorkbenchMessageRole;
export type TaskRecord = WorkbenchTaskRecord;
export type ChatMessageRecord = WorkbenchMessageRecord;
type AgentRuntimeAdapter = NonNullable<DemoWorkbenchServiceOptions["assistantRuntime"]>;

export type WebArtifactDiffFileState =
  | "initial"
  | "added"
  | "removed"
  | "changed"
  | "unchanged";

export type WebArtifactSnippetOmittedReason =
  | "content_not_requested"
  | "size_limit_exceeded"
  | "unavailable";

export interface WebArtifactDiffFileView {
  path: ArtifactWorkspaceFilePath;
  state: WebArtifactDiffFileState;
  sizeBytes?: number;
  sha256?: string;
  shortSha256?: string;
  summary?: string;
  canPreview: boolean;
}

export interface WebArtifactSnippetView {
  path: ArtifactWorkspaceFilePath;
  sizeBytes?: number;
  sha256?: string;
  shortSha256?: string;
  content?: string;
  omittedReason?: WebArtifactSnippetOmittedReason;
  maxBytes: number;
}

export interface WebArtifactDiffState {
  projectId: string;
  pageVersionId: string;
  artifactWorkspaceId?: string;
  previousPageVersionId?: string;
  files: WebArtifactDiffFileView[];
  selectedSnippet?: WebArtifactSnippetView;
  errorCode?: "artifact_diff_unavailable" | "artifact_snippet_unavailable";
}

export type SubmitTaskResult =
  | {
      ok: true;
      taskId: string;
      taskType: TaskType;
      projectId?: string;
    }
  | {
      ok: false;
      error: ProjectFlowErrorCode;
      taskId?: string;
      taskType?: TaskType;
      projectId?: string;
    };

export type LiveTaskPromptStartResult =
  | {
      ok: true;
      taskId: string;
      taskType: TaskType;
      projectId?: string;
      completion: Promise<SubmitTaskResult>;
    }
  | { ok: false; error: ProjectFlowErrorCode };

export interface StreamingChatContextSummary {
  projectId?: string;
  projectName?: string;
  runtimeMode: "deterministic" | "real";
  skillCount: number;
  skills: Array<{ id: string; name: string; version: string }>;
}

export type StreamingChatStartResult =
  | {
      ok: true;
      taskId: string;
      taskType: "general_chat";
      projectId?: string;
      userMessageId: string;
      assistantMessageId: string;
      assistantContent: string;
      assistantStream?: AsyncIterable<string>;
      cancelAssistantStream?: () => void;
      contextSummary: StreamingChatContextSummary;
      chunks: string[];
    }
  | {
      ok: false;
      error: ProjectFlowErrorCode;
      taskId?: string;
      projectId?: string;
    }
  | {
      ok: false;
      error: "fallback_required";
      taskType: Exclude<TaskType, "general_chat">;
    };

export type StreamingChatCompleteResult =
  | { ok: true }
  | { ok: false; error: ProjectFlowErrorCode };

export type StreamingChatAbandonResult =
  | { ok: true }
  | { ok: false; error: ProjectFlowErrorCode };

export type WorkbenchPageState =
  | {
      kind: "empty";
      projects: ProjectRecord[];
      projectMembers: ProjectMemberSummary[];
      tasks: TaskRecord[];
      skills: ProjectSkillState;
      skillCommands: ProjectSkillCommandView[];
      models: WebProjectModelState;
      mcp: ProjectMCPState;
      workerQueue: WorkerQueueSnapshot;
    }
  | {
      kind: "task_ready";
      projects: ProjectRecord[];
      projectMembers: ProjectMemberSummary[];
      tasks: TaskRecord[];
      skills: ProjectSkillState;
      skillCommands: ProjectSkillCommandView[];
      models: WebProjectModelState;
      mcp: ProjectMCPState;
      workerQueue: WorkerQueueSnapshot;
      activeTaskId: string;
      task: TaskRecord;
      messages: ChatMessageRecord[];
      runEvents: RunEventRecord[];
      interrupt: TaskInterrupt;
      recovery: WorkbenchTaskRecoveryState;
      snapshot?: WorkbenchSnapshot;
      artifactDiff?: WebArtifactDiffState;
      taskFollowupSuggestions: TaskFollowupSuggestion[];
      taskFollowupSuggestionsReady?: boolean;
    };

type TaskReadyPageState = Extract<WorkbenchPageState, { kind: "task_ready" }>;
type TaskFollowupSuggestionCache = Map<string, TaskFollowupSuggestion[]>;

type LocalRealProviderProfile = {
  key: string;
  name: string;
  api: "openai-completions" | "anthropic-messages";
  baseUrl: string;
  apiKeyEnv: string;
  model: string;
};

const LOCAL_REAL_PROVIDER_PROJECT_NAME = "Local Real Provider";
const LOCAL_REAL_PROVIDER_ROUTE_ROLES: AgentRole[] = [
  "assistant",
  "planner",
  "builder",
  "reviewer",
  "deployer"
];

export type LiveTaskStateErrorCode = "task_not_found" | "project_not_found";

export interface LiveTaskArtifactProgress {
  pageVersionId: string;
  artifactWorkspaceId?: string;
  fileCount: number;
  changedFileCount: number;
  previewVersionKey: string;
}

export interface LiveTaskProject {
  id: string;
  name: string;
  createdAt: string;
}

export interface LiveTaskBrief {
  id: string;
  projectId: string;
  prompt: string;
  createdAt: string;
}

export interface LiveTaskPageVersion {
  id: string;
  projectId: string;
  briefId: string;
  artifactWorkspaceId?: string;
  reviewStatus: NonNullable<WorkbenchSnapshot["currentPageVersion"]>["reviewStatus"];
  findings: NonNullable<WorkbenchSnapshot["currentPageVersion"]>["findings"];
  createdAt: string;
}

export interface LiveTaskDeployment {
  id: string;
  projectId: string;
  pageVersionId: string;
  branch: string;
  commitSha: string;
  pullRequestUrl: string;
  files: string[];
  status: NonNullable<WorkbenchSnapshot["deployment"]>["status"];
}

export interface LiveTaskSnapshot {
  project: LiveTaskProject;
  brief?: LiveTaskBrief;
  currentPageVersion?: LiveTaskPageVersion;
  deployment?: LiveTaskDeployment;
}

export interface LiveTaskRunEventPayload {
  type?: string;
  runId?: string;
  role?: string;
  state?: string;
  provider?: string;
  model?: string;
  skillCount?: number;
  toolCount?: number;
  approvalState?: string;
  artifactId?: string;
  workspaceId?: string;
  artifactWorkspaceId?: string;
  pageVersionId?: string;
  kind?: string;
  fileCount?: number;
  handoffId?: string;
  fromRunId?: string;
  fromRole?: string;
  toRole?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  artifactRefs?: Record<string, string>;
  files?: Array<{
    path?: string;
    kind?: string;
    sizeBytes?: number;
    sha256?: string;
  }>;
}

type LiveTaskStringPayloadKey =
  | "type"
  | "runId"
  | "role"
  | "state"
  | "provider"
  | "model"
  | "approvalState"
  | "artifactId"
  | "workspaceId"
  | "artifactWorkspaceId"
  | "pageVersionId"
  | "kind"
  | "handoffId"
  | "fromRunId"
  | "fromRole"
  | "toRole";

type LiveTaskNumberPayloadKey = "skillCount" | "toolCount" | "fileCount";

export interface LiveTaskRunEvent {
  id: string;
  projectId: string;
  taskId?: string;
  runId: string;
  type: string;
  createdAt: string;
  payload?: LiveTaskRunEventPayload;
}

export interface LiveTaskArtifactSnippet {
  path: ArtifactWorkspaceFilePath;
  sizeBytes?: number;
  sha256?: string;
  shortSha256?: string;
  omittedReason?: WebArtifactSnippetOmittedReason;
  maxBytes: number;
}

export interface LiveTaskArtifactDiffFile {
  path: ArtifactWorkspaceFilePath;
  state: WebArtifactDiffFileState;
  sizeBytes?: number;
  sha256?: string;
  shortSha256?: string;
  summary?: string;
  canPreview: boolean;
}

export interface LiveTaskArtifactDiffState {
  projectId: string;
  pageVersionId: string;
  artifactWorkspaceId?: string;
  previousPageVersionId?: string;
  files: LiveTaskArtifactDiffFile[];
  selectedSnippet?: LiveTaskArtifactSnippet;
  errorCode?: WebArtifactDiffState["errorCode"];
}

export interface LiveTaskStatePayload {
  taskId: string;
  projectId?: string;
  taskType: TaskType;
  taskStatus: TaskStatus;
  stateVersion: string;
  isTerminal: boolean;
  nextPollMs: number;
  updatedAt: string;
  messages: ChatMessageRecord[];
  runs: RunLifecycleView[];
  runEvents: LiveTaskRunEvent[];
  recovery: WorkbenchTaskRecoveryState;
  workerQueue: WorkerQueueSnapshot;
  interrupt: TaskInterrupt;
  snapshot?: LiveTaskSnapshot;
  artifactDiff?: LiveTaskArtifactDiffState;
  artifactProgress?: LiveTaskArtifactProgress;
}

export type LiveTaskStateResult =
  | { ok: true; value: LiveTaskStatePayload }
  | { ok: false; error: LiveTaskStateErrorCode };

export interface WebWorkbenchStore {
  createProject(input: CreateProjectFormInput): Promise<ProjectRecord>;
  listProjects(): Promise<ProjectRecord[]>;
  listTasks(): Promise<TaskRecord[]>;
  getPageState(input?: {
    projectId?: string | null;
    taskId?: string | null;
    artifactPath?: string | null;
  }): Promise<WorkbenchPageState>;
  getLiveTaskState(input: {
    taskId: string;
    projectId?: string | null;
    artifactPath?: string | null;
  }): Promise<LiveTaskStateResult>;
  submitTaskPrompt(input: {
    taskId?: string | null;
    projectId?: string | null;
    prompt: string;
    implicitProjectName: string;
  }): Promise<SubmitTaskResult>;
  startLiveTaskPrompt(input: {
    taskId?: string | null;
    projectId?: string | null;
    prompt: string;
    implicitProjectName: string;
  }): Promise<LiveTaskPromptStartResult>;
  startStreamingChatPrompt(input: {
    projectId?: string | null;
    taskId?: string | null;
    prompt: string;
  }): Promise<StreamingChatStartResult>;
  completeStreamingChatPrompt(input: {
    taskId: string;
    messageId: string;
    content: string;
  }): Promise<StreamingChatCompleteResult>;
  abandonStreamingChatPrompt(input: {
    taskId: string;
    messageId: string;
    allowPersistedContent?: boolean;
    allowStale?: boolean;
  }): Promise<StreamingChatAbandonResult>;
  interruptCurrentTask(input: {
    taskId: string;
    reason?: string;
  }): Promise<InterruptCurrentTaskResult>;
  executeRunRecoveryAction(input: ExecuteRunRecoveryFormInput): Promise<RunRecoveryActionResult>;
  createSkillDraft(input: CreateSkillDraftFormInput): Promise<SkillActionResult<SkillDraftResult>>;
  validateSkillVersion(skillVersionId: string): Promise<SkillActionResult<SkillVersionRecord>>;
  publishSkillVersion(skillVersionId: string): Promise<SkillActionResult<SkillVersionRecord>>;
  bindSkillVersionToProject(
    input: BindSkillVersionFormInput
  ): Promise<SkillActionResult<SkillBindingRecord>>;
  setProjectSkillBindingEnabled(input: {
    projectId: string;
    bindingId: string;
    enabled: boolean;
  }): Promise<SkillActionResult<SkillBindingRecord>>;
  executeSkillCommand(input: ExecuteSkillCommandFormInput): Promise<SkillCommandActionResult>;
  runLocalWorkerOnce(input?: { projectId?: string }): Promise<RunLocalWorkerOnceResult>;
  createModelProvider(
    input: CreateModelProviderFormInput
  ): Promise<ModelActionResult<ModelProviderRecord>>;
  setModelProviderEnabled(input: {
    projectId: string;
    providerId: string;
    enabled: boolean;
  }): Promise<ModelActionResult<ModelProviderRecord>>;
  upsertProjectModelRoute(
    input: UpsertProjectModelRouteFormInput
  ): Promise<ModelActionResult<ModelRoutingPolicyRecord>>;
  createMCPConnector(
    input: CreateMCPConnectorFormInput
  ): Promise<MCPActionResult<MCPConnectorRecord>>;
  setMCPConnectorEnabled(input: {
    projectId: string;
    connectorId: string;
    enabled: boolean;
  }): Promise<MCPActionResult<MCPConnectorRecord>>;
  setMCPToolApproval(
    input: SetMCPToolApprovalFormInput
  ): Promise<MCPActionResult<MCPToolApprovalRecord>>;
  executeMCPTool(input: ExecuteMCPToolFormInput): Promise<MCPExecutionActionResult>;
}

export interface WebWorkbenchStoreOptions {
  repositories?: WorkbenchRepositories;
  assistantRuntime?: AgentRuntimeAdapter;
  plannerRuntime?: AgentRuntimeAdapter;
  builderRuntime?: AgentRuntimeAdapter;
  reviewerRuntime?: AgentRuntimeAdapter;
  deployerRuntime?: AgentRuntimeAdapter;
  toolCommandRunner?: ToolCommandRunner;
  workerRuntime?: TaskInterruptWorkerRuntime;
  workerQueueRuntime?: SkillCommandQueueRuntime;
  workerJobRepository?: WorkerJobRepository;
  workerLogRepository?: WorkerLogRepository;
  workerId?: string;
  env?: RuntimeEnvironment;
  modelFetch?: ModelFetch;
  currentUser?: WorkbenchUserIdentity;
}

export function validateProjectInput(input: CreateProjectFormInput): ValidationResult<CreateProjectFormInput> {
  const name = input.name.trim();

  if (name.length === 0) {
    return { ok: false, error: "project_name_required" };
  }

  return {
    ok: true,
    value: {
      name
    }
  };
}

export function validatePromptInput(prompt: string): ValidationResult<string> {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "prompt_required" };
  }
  return { ok: true, value: trimmed };
}

const lpKeywords = [
  "landing page",
  "落地页",
  "页面",
  "html",
  "官网",
  "活动页",
  "电商"
];

const projectKeywords = ["创建项目", "new project", "create project"];
const standaloneLpPattern = /\blp\b/;
const artifactPreviewPaths = ["index.html", "styles.css", "script.js"] as const;

export function classifyTaskPrompt(prompt: string): TaskType {
  const normalized = prompt.trim().toLowerCase();
  if (normalized.length === 0) {
    return "general_chat";
  }

  if (projectKeywords.some((keyword) => normalized.includes(keyword))) {
    return "project_setup";
  }

  if (
    standaloneLpPattern.test(normalized) ||
    lpKeywords.some((keyword) => normalized.includes(keyword))
  ) {
    return "lp_generation";
  }

  return "general_chat";
}

export function deriveTaskTitle(prompt: string): string {
  const title = prompt.trim().replace(/\s+/g, " ");
  return title.length > 48 ? `${title.slice(0, 48)}...` : title;
}

export function deriveImplicitProjectName(prompt: string, fallback: string): string {
  const title = deriveTaskTitle(prompt)
    .replace(/[,，。.!！?？].*$/, "")
    .trim();
  const trimmedFallback = fallback.trim();
  return title.length > 0
    ? title
    : trimmedFallback.length > 0
      ? trimmedFallback
      : "Untitled LP Project";
}

export function deriveProjectSkillCommands(
  skillState: ProjectSkillState
): ProjectSkillCommandView[] {
  return skillState.boundSkills.flatMap((boundSkill) => {
    const { skill, version, binding } = boundSkill;
    if (
      !binding.enabled ||
      version.reviewState !== "published" ||
      version.manifest.reviewState !== "published" ||
      version.manifest.type !== "deployment"
    ) {
      return [];
    }

    return (version.manifest.commands ?? []).map((command) => ({
      skillId: skill.id,
      skillName: skill.name,
      skillVersionId: version.id,
      commandId: command.id,
      commandName: command.name,
      ...(command.description ? { description: command.description } : {}),
      permission: command.permission,
      requiresApproval: command.requiresApproval
    }));
  });
}

export function createWebWorkbenchStore(options: WebWorkbenchStoreOptions = {}): WebWorkbenchStore {
  const repositories = options.repositories ?? createInMemoryWorkbenchRepositories();
  const runtimeEnv = options.env ?? resolveDefaultRuntimeEnvironment();
  const workerRuntime = options.workerRuntime;
  const workerQueueRuntime = options.workerQueueRuntime;
  const workerJobRepository = options.workerJobRepository;
  const workerLogRepository = options.workerLogRepository;
  const workerId = options.workerId ?? "local-web-worker";
  const currentUser = normalizeWorkbenchUserIdentity(
    options.currentUser ?? getLocalWorkbenchUser()
  );
  const service = new DemoWorkbenchService({
    repositories,
    currentUser,
    assistantRuntime: options.assistantRuntime,
    plannerRuntime: options.plannerRuntime,
    builderRuntime: options.builderRuntime,
    reviewerRuntime: options.reviewerRuntime,
    deployerRuntime: options.deployerRuntime,
    toolCommandRunner: options.toolCommandRunner ?? new SimulatedToolCommandRunner(),
    workerQueueRuntime,
    env: runtimeEnv,
    modelFetch: options.modelFetch
  });
  const taskFollowupSuggestionCache: TaskFollowupSuggestionCache = new Map();

  let localRealProviderProjectPromise: Promise<string | undefined> | undefined;
  const ensureLocalRealProviderProject = async () => {
    localRealProviderProjectPromise ??= ensureLocalRealProviderProjectForEnv({
      repositories,
      service,
      env: runtimeEnv
    }).catch((error: unknown) => {
      localRealProviderProjectPromise = undefined;
      throw error;
    });
    return localRealProviderProjectPromise;
  };
  const resolveProjectIdForPrompt = async (projectId?: string | null) =>
    projectId
      ? await ensureLocalRealProviderRoutesForProject({
          repositories,
          service,
          env: runtimeEnv,
          projectId
        })
      : await ensureLocalRealProviderProject();

  const listProjects = async () => {
    await ensureLocalRealProviderProject();
    return (await repositories.projects.listAll()).map((project) => ({ ...project }));
  };

  const listTasks = async () =>
    (await repositories.tasks.listAll()).map((task) => ({ ...task }));

  const listMessages = async (taskId: string) =>
    (await repositories.messages.listForTask(taskId)).map((message) => ({ ...message }));

  const emptySkillState = (): ProjectSkillState => ({
    boundSkills: [],
    availableVersions: []
  });

  const emptyModelState = (): WebProjectModelState => ({
    providers: [],
    routes: [],
    resolvedPolicy: createDefaultModelPolicy()
  });

  const emptyMCPState = (): ProjectMCPState => ({
    connectors: [],
    approvals: [],
    visibleToolsByRole: createEmptyVisibleToolsByRole()
  });

  const emptyProjectMembers = (): ProjectMemberSummary[] => [];

  const emptyWorkerQueueSnapshot = (projectId = ""): WorkerQueueSnapshot => ({
    projectId,
    counts: {
      queued: 0,
      running: 0,
      stale: 0,
      completed: 0,
      failed: 0,
      rejected: 0,
      cancelled: 0
    },
    heartbeat: {
      status: "unknown"
    },
    logs: []
  });

  function isLiveTaskTerminal(pageState: TaskReadyPageState): boolean {
    const runningRun = pageState.recovery.runs.some((run) =>
      ["queued", "running", "waiting_for_approval", "cancelling"].includes(run.state)
    );
    const activeWorkerCount =
      pageState.workerQueue.counts.queued + pageState.workerQueue.counts.running;
    if (runningRun || activeWorkerCount > 0) {
      return false;
    }

    if (pageState.task.type === "lp_generation") {
      const currentPageVersion = pageState.snapshot?.currentPageVersion;
      if (!currentPageVersion) {
        return true;
      }
      if (!pageState.taskFollowupSuggestionsReady) {
        return false;
      }
      if (currentPageVersion.reviewStatus === "pending") {
        return false;
      }
      if (currentPageVersion.reviewStatus === "passed" && !pageState.snapshot?.deployment) {
        return false;
      }
    }

    return true;
  }

  function buildLiveTaskStateVersion(pageState: TaskReadyPageState): string {
    const parts = [
      pageState.task.createdAt,
      pageState.messages.at(-1)?.id ?? "no-message",
      pageState.runEvents.at(-1)?.id ?? "no-event",
      pageState.snapshot?.currentPageVersion?.id ?? "no-page",
      pageState.artifactDiff?.artifactWorkspaceId ?? "no-workspace",
      pageState.snapshot?.deployment?.id ?? "no-deployment",
      pageState.taskFollowupSuggestionsReady ? "followups-ready" : "followups-pending",
      String(pageState.workerQueue.counts.queued),
      String(pageState.workerQueue.counts.running)
    ];
    return parts.join(":");
  }

  function buildArtifactProgress(
    artifactDiff: WebArtifactDiffState | undefined
  ): LiveTaskArtifactProgress | undefined {
    if (!artifactDiff) {
      return undefined;
    }
    const changedFileCount = artifactDiff.files.filter((file) => file.state !== "unchanged").length;
    return {
      pageVersionId: artifactDiff.pageVersionId,
      artifactWorkspaceId: artifactDiff.artifactWorkspaceId,
      fileCount: artifactDiff.files.length,
      changedFileCount,
      previewVersionKey: [
        artifactDiff.pageVersionId,
        artifactDiff.artifactWorkspaceId ?? "no-workspace",
        ...artifactDiff.files.map((file) => `${file.path}:${file.shortSha256 ?? "no-hash"}`)
      ].join("|")
    };
  }

  function buildLiveTaskSnapshot(
    snapshot: WorkbenchSnapshot | undefined
  ): LiveTaskSnapshot | undefined {
    if (!snapshot) {
      return undefined;
    }
    return {
      project: {
        id: snapshot.project.id,
        name: snapshot.project.name,
        createdAt: snapshot.project.createdAt
      },
      ...(snapshot.brief
        ? {
            brief: {
              id: snapshot.brief.id,
              projectId: snapshot.brief.projectId,
              prompt: snapshot.brief.prompt,
              createdAt: snapshot.brief.createdAt
            }
          }
        : {}),
      ...(snapshot.currentPageVersion
        ? {
            currentPageVersion: {
              id: snapshot.currentPageVersion.id,
              projectId: snapshot.currentPageVersion.projectId,
              briefId: snapshot.currentPageVersion.briefId,
              artifactWorkspaceId: snapshot.currentPageVersion.artifactWorkspaceId,
              reviewStatus: snapshot.currentPageVersion.reviewStatus,
              findings: snapshot.currentPageVersion.findings,
              createdAt: snapshot.currentPageVersion.createdAt
            }
          }
        : {}),
      ...(snapshot.deployment
        ? {
            deployment: {
              id: snapshot.deployment.id,
              projectId: snapshot.deployment.projectId,
              pageVersionId: snapshot.deployment.pageVersionId,
              branch: snapshot.deployment.branch,
              commitSha: snapshot.deployment.commitSha,
              pullRequestUrl: snapshot.deployment.pullRequestUrl,
              files: [...snapshot.deployment.files],
              status: snapshot.deployment.status
            }
          }
        : {})
    };
  }

  function addStringPayloadValue(
    target: LiveTaskRunEventPayload,
    source: Record<string, unknown>,
    key: LiveTaskStringPayloadKey
  ): void {
    const value = source[key];
    if (typeof value === "string" && isSafeLiveTaskPayloadToken(value)) {
      target[key] = value;
    }
  }

  function addNumberPayloadValue(
    target: LiveTaskRunEventPayload,
    source: Record<string, unknown>,
    key: LiveTaskNumberPayloadKey
  ): void {
    const value = source[key];
    if (typeof value === "number") {
      target[key] = value;
    }
  }

  function isSafeLiveTaskPayloadToken(value: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
  }

  function isSafeLiveTaskArtifactRefKey(
    key: string
  ): key is "briefId" | "pageVersionId" | "artifactWorkspaceId" {
    return key === "briefId" || key === "pageVersionId" || key === "artifactWorkspaceId";
  }

  function isSafeLiveTaskArtifactRefValue(value: string): boolean {
    return /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/.test(value);
  }

  function normalizeLiveTaskRunEventFilePath(value: unknown): ArtifactWorkspaceFilePath | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    try {
      return normalizeArtifactWorkspaceFilePath(value);
    } catch {
      return undefined;
    }
  }

  function sanitizeLiveTaskRunEventPayload(
    payload: Record<string, unknown>
  ): LiveTaskRunEventPayload | undefined {
    const safe: LiveTaskRunEventPayload = {};
    const stringKeys: LiveTaskStringPayloadKey[] = [
      "type",
      "runId",
      "role",
      "state",
      "provider",
      "model",
      "approvalState",
      "artifactId",
      "workspaceId",
      "artifactWorkspaceId",
      "pageVersionId",
      "kind",
      "handoffId",
      "fromRunId",
      "fromRole",
      "toRole"
    ];
    const numberKeys: LiveTaskNumberPayloadKey[] = ["skillCount", "toolCount", "fileCount"];

    for (const key of stringKeys) {
      addStringPayloadValue(safe, payload, key);
    }
    for (const key of numberKeys) {
      addNumberPayloadValue(safe, payload, key);
    }

    const usage = payload.usage;
    if (usage && typeof usage === "object" && !Array.isArray(usage)) {
      const usageRecord = usage as Record<string, unknown>;
      safe.usage = {
        ...(typeof usageRecord.inputTokens === "number"
          ? { inputTokens: usageRecord.inputTokens }
          : {}),
        ...(typeof usageRecord.outputTokens === "number"
          ? { outputTokens: usageRecord.outputTokens }
          : {})
      };
    }

    const artifactRefs = payload.artifactRefs;
    if (artifactRefs && typeof artifactRefs === "object" && !Array.isArray(artifactRefs)) {
      const refs = Object.entries(artifactRefs as Record<string, unknown>).filter(
        (entry): entry is ["briefId" | "pageVersionId" | "artifactWorkspaceId", string] =>
          isSafeLiveTaskArtifactRefKey(entry[0]) &&
          typeof entry[1] === "string" &&
          isSafeLiveTaskArtifactRefValue(entry[1])
      );
      if (refs.length > 0) {
        safe.artifactRefs = Object.fromEntries(refs);
      }
    }

    if (Array.isArray(payload.files)) {
      const files = payload.files
        .filter((file): file is Record<string, unknown> => Boolean(file) && typeof file === "object")
        .map((file) => {
          const path = normalizeLiveTaskRunEventFilePath(file.path);
          return {
            ...(path ? { path } : {}),
            ...(typeof file.kind === "string" && isSafeLiveTaskPayloadToken(file.kind)
              ? { kind: file.kind }
              : {}),
            ...(typeof file.sizeBytes === "number" ? { sizeBytes: file.sizeBytes } : {}),
            ...(typeof file.sha256 === "string" && /^[a-f0-9]{64}$/.test(file.sha256)
              ? { sha256: file.sha256 }
              : {})
          };
        })
        .filter((file) => Object.keys(file).length > 0);
      if (files.length > 0) {
        safe.files = files;
      }
    }

    return Object.keys(safe).length > 0 ? safe : undefined;
  }

  function sanitizeLiveTaskRunEvent(event: RunEventRecord): LiveTaskRunEvent {
    const payload = sanitizeLiveTaskRunEventPayload(event.payload);
    return {
      id: event.id,
      projectId: event.projectId,
      ...(event.taskId ? { taskId: event.taskId } : {}),
      runId: event.runId,
      type: event.type,
      createdAt: event.createdAt,
      ...(payload ? { payload } : {})
    };
  }

  function buildLiveArtifactSnippet(
    snippet: WebArtifactSnippetView | undefined
  ): LiveTaskArtifactSnippet | undefined {
    if (!snippet) {
      return undefined;
    }
    return {
      path: snippet.path,
      sizeBytes: snippet.sizeBytes,
      sha256: snippet.sha256,
      shortSha256: snippet.shortSha256,
      omittedReason: snippet.omittedReason,
      maxBytes: snippet.maxBytes
    };
  }

  function buildLiveArtifactDiff(
    artifactDiff: WebArtifactDiffState | undefined
  ): LiveTaskArtifactDiffState | undefined {
    if (!artifactDiff) {
      return undefined;
    }
    return {
      projectId: artifactDiff.projectId,
      pageVersionId: artifactDiff.pageVersionId,
      artifactWorkspaceId: artifactDiff.artifactWorkspaceId,
      previousPageVersionId: artifactDiff.previousPageVersionId,
      files: artifactDiff.files.map((file) => ({
        path: file.path,
        state: file.state,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        shortSha256: file.shortSha256,
        summary: file.summary,
        canPreview: file.canPreview
      })),
      ...(artifactDiff.selectedSnippet
        ? { selectedSnippet: buildLiveArtifactSnippet(artifactDiff.selectedSnippet) }
        : {}),
      errorCode: artifactDiff.errorCode
    };
  }

  function createEmptyVisibleToolsByRole(): ProjectMCPState["visibleToolsByRole"] {
    return {
      assistant: [],
      planner: [],
      builder: [],
      reviewer: [],
      deployer: []
    };
  }

  const loadSkillState = async (projectId?: string | null) => {
    if (!projectId) {
      return emptySkillState();
    }
    try {
      return await service.listProjectSkillState(projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "project_not_found" || message === "Project not found.") {
        return emptySkillState();
      }
      throw error;
    }
  };

  const loadModelState = async (projectId?: string | null): Promise<WebProjectModelState> => {
    if (!projectId) {
      return emptyModelState();
    }
    try {
      return await service.listProjectModelState(projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "project_not_found" || message === "Project not found.") {
        return emptyModelState();
      }
      const resolutionError = toModelFlowError(error);
      if (isRecoverableModelResolutionError(resolutionError)) {
        return {
          providers: await repositories.modelProviders.listForProject(projectId),
          routes: await repositories.modelRoutingPolicies.listForProject(projectId),
          resolvedPolicy: createDefaultModelPolicy(),
          resolutionError
        };
      }
      throw error;
    }
  };

  const loadMCPState = async (projectId?: string | null): Promise<ProjectMCPState> => {
    if (!projectId) {
      return emptyMCPState();
    }
    try {
      return await service.listProjectMCPState(projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "project_not_found" || message === "Project not found.") {
        return emptyMCPState();
      }
      throw error;
    }
  };

  const loadProjectMembers = async (projectId?: string | null): Promise<ProjectMemberSummary[]> => {
    if (!projectId) {
      return emptyProjectMembers();
    }
    try {
      return await service.listProjectMembers(projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "project_not_found" || message === "Project not found.") {
        return emptyProjectMembers();
      }
      throw error;
    }
  };

  const loadWorkerQueueSnapshot = async (
    projectId?: string | null
  ): Promise<WorkerQueueSnapshot> => {
    if (!projectId || !workerJobRepository) {
      return emptyWorkerQueueSnapshot(projectId ?? "");
    }
    try {
      return await createWorkerQueueSnapshot({
        jobRepository: workerJobRepository,
        workerLogRepository,
        projectId,
        recentLogLimit: 10
      });
    } catch {
      return emptyWorkerQueueSnapshot(projectId);
    }
  };

  return {
    async createProject(input) {
      const validation = validateProjectInput(input);
      if (!validation.ok) {
        throw new Error(validation.error);
      }

      const project = await service.createProject(validation.value);
      return { ...project };
    },

    listProjects,
    listTasks,

    async getPageState(input) {
      const currentProjects = await listProjects();
      const currentTasks = await listTasks();
      const taskId = input?.taskId ?? null;
      const task = taskId ? await repositories.tasks.getById(taskId) : undefined;
      const requestedProjectId = input?.projectId ?? null;
      const taskProject = task?.projectId
        ? await repositories.projects.getById(task.projectId)
        : undefined;

      if (
        !task ||
        (task.projectId && !taskProject) ||
        (task.projectId && requestedProjectId && requestedProjectId !== task.projectId)
      ) {
        const requestedProject = requestedProjectId
          ? await repositories.projects.getById(requestedProjectId)
          : undefined;
        const skills = await loadSkillState(requestedProject?.id);
        return {
          kind: "empty",
          projects: currentProjects,
          projectMembers: await loadProjectMembers(requestedProject?.id),
          tasks: currentTasks,
          skills,
          skillCommands: deriveProjectSkillCommands(skills),
          models: await loadModelState(requestedProject?.id),
          mcp: await loadMCPState(requestedProject?.id),
          workerQueue: await loadWorkerQueueSnapshot(requestedProject?.id)
        };
      }

      const activeProjectId = taskProject?.id ?? requestedProjectId;
      const snapshotRef = await repositories.taskSnapshots.getByTaskId(task.id);
      const taskRunEvents = await repositories.runEvents.listForTask(task.id);
      const snapshotRunEvents = activeProjectId
        ? filterRunEventsForSnapshot(
            await repositories.runEvents.listForProject(activeProjectId),
            snapshotRef
          )
        : [];
      const runEvents = mergeRunEventsForTaskView({
        taskRunEvents,
        snapshotRunEvents
      });
      const snapshot = snapshotRef
        ? await service.getSnapshotForRecords({
            projectId: snapshotRef.projectId,
            briefId: snapshotRef.briefId,
            pageVersionId: snapshotRef.pageVersionId
          })
        : undefined;
      const artifactDiff =
        task.type === "lp_generation" && snapshot?.currentPageVersion
          ? await buildWebArtifactDiffState({
              service,
              repositories,
              projectId: snapshot.project.id,
              currentPageVersion: snapshot.currentPageVersion,
              selectedPath: input?.artifactPath
            })
          : undefined;
      const messages = await listMessages(task.id);
      const taskFollowupSuggestionCacheKey =
        task.type === "lp_generation" && activeProjectId
          ? buildTaskFollowupSuggestionCacheKey({
              taskId: task.id,
              messages,
              snapshot
            })
          : undefined;
      const taskFollowupSuggestionsReady =
        taskFollowupSuggestionCacheKey === undefined ||
        taskFollowupSuggestionCache.has(taskFollowupSuggestionCacheKey);
      const taskFollowupSuggestions = taskFollowupSuggestionCacheKey
        ? taskFollowupSuggestionCache.get(taskFollowupSuggestionCacheKey) ?? []
        : [];
      const recovery = await listRunRecoveryViewsForTask({
        repositories,
        taskId: task.id,
        workerRuntime: workerQueueRuntime ?? workerRuntime
      });
      const skills = await loadSkillState(activeProjectId);
      return {
        kind: "task_ready",
        projects: currentProjects,
        projectMembers: await loadProjectMembers(activeProjectId),
        tasks: currentTasks,
        skills,
        skillCommands: deriveProjectSkillCommands(skills),
        models: await loadModelState(activeProjectId),
        mcp: await loadMCPState(activeProjectId),
        workerQueue: await loadWorkerQueueSnapshot(activeProjectId),
        activeTaskId: task.id,
        task: { ...task },
        messages,
        runEvents,
        interrupt: await deriveWebTaskInterruptView({
          repositories,
          workerRuntime,
          taskId: task.id
        }),
        recovery: {
          runs: recovery
        },
        snapshot,
        artifactDiff,
        taskFollowupSuggestions,
        taskFollowupSuggestionsReady
      };
    },

    async getLiveTaskState(input) {
      const pageState = await this.getPageState(input);
      if (pageState.kind !== "task_ready") {
        const task = await repositories.tasks.getById(input.taskId);
        return {
          ok: false,
          error: task ? "project_not_found" : "task_not_found"
        };
      }

      const isTerminal = isLiveTaskTerminal(pageState);
      return {
        ok: true,
        value: {
          taskId: pageState.task.id,
          ...(pageState.task.projectId ? { projectId: pageState.task.projectId } : {}),
          taskType: pageState.task.type,
          taskStatus: pageState.task.status,
          stateVersion: buildLiveTaskStateVersion(pageState),
          isTerminal,
          nextPollMs: isTerminal ? 0 : 1200,
          updatedAt: new Date().toISOString(),
          messages: pageState.messages,
          runs: pageState.recovery.runs,
          runEvents: pageState.runEvents.map(sanitizeLiveTaskRunEvent),
          recovery: pageState.recovery,
          workerQueue: pageState.workerQueue,
          interrupt: pageState.interrupt,
          snapshot: buildLiveTaskSnapshot(pageState.snapshot),
          artifactDiff: buildLiveArtifactDiff(pageState.artifactDiff),
          artifactProgress: pageState.taskFollowupSuggestionsReady
            ? buildArtifactProgress(pageState.artifactDiff)
            : undefined
        }
      };
    },

    async startStreamingChatPrompt(input) {
      const prompt = validatePromptInput(input.prompt);
      if (!prompt.ok) {
        return { ok: false, error: prompt.error };
      }

      const taskType = classifyTaskPrompt(prompt.value);
      if (taskType !== "general_chat") {
        return { ok: false, error: "fallback_required", taskType };
      }

      const requestedProjectId = await resolveProjectIdForPrompt(input.projectId);
      if (requestedProjectId && !(await repositories.projects.getById(requestedProjectId))) {
        return { ok: false, error: "project_not_found" };
      }

      const requestedTaskId = input.taskId ?? undefined;
      if (requestedTaskId) {
        const existingTask = await repositories.tasks.getById(requestedTaskId);
        if (
          !existingTask ||
          existingTask.type !== "general_chat" ||
          (existingTask.projectId ?? undefined) !== requestedProjectId
        ) {
          return { ok: false, error: "project_not_found" };
        }
      }

      const title = deriveTaskTitle(prompt.value);
      let streamTaskId = requestedTaskId;
      let assistantContent = "I created a task thread and can continue from here.";
      let assistantStream: AsyncIterable<string> | undefined;
      let cancelAssistantStream: (() => void) | undefined;
      let contextSummary: StreamingChatContextSummary = {
        runtimeMode: "deterministic",
        skillCount: 0,
        skills: []
      };
      if (requestedProjectId) {
        const chatTask = await ensureStreamingChatTask({
          repositories,
          taskId: requestedTaskId,
          title,
          projectId: requestedProjectId
        });
        streamTaskId = chatTask.id;
        const assistant = await service.runAssistantChatStream({
          projectId: requestedProjectId,
          taskId: streamTaskId,
          prompt: prompt.value
        });
        if (!assistant.ok) {
          await appendStreamingChatUserMessage({
            repositories,
            taskId: streamTaskId,
            content: prompt.value
          });
          return {
            ok: false,
            error: assistant.error,
            taskId: streamTaskId,
            projectId: requestedProjectId
          };
        }
        if (assistant.stream) {
          assistantContent = "";
          assistantStream = assistant.stream;
          cancelAssistantStream = assistant.cancelStream;
        } else {
          assistantContent = assistant.content ?? "";
        }
        contextSummary = assistant.contextSummary;
      }

      const started = await startStreamingChatThread({
        repositories,
        taskId: streamTaskId,
        title,
        projectId: requestedProjectId,
        userMessage: prompt.value,
        assistantMessage: ""
      });

      return {
        ok: true,
        taskId: started.task.id,
        taskType: "general_chat",
        ...(started.task.projectId ? { projectId: started.task.projectId } : {}),
        userMessageId: started.userMessage.id,
        assistantMessageId: started.assistantMessage.id,
        assistantContent,
        ...(assistantStream ? { assistantStream } : {}),
        ...(cancelAssistantStream ? { cancelAssistantStream } : {}),
        contextSummary,
        chunks: assistantStream ? [] : chunkAssistantText(assistantContent, 12)
      };
    },

    async completeStreamingChatPrompt(input) {
      const task = await repositories.tasks.getById(input.taskId);
      if (!task) {
        return { ok: false, error: "generation_failed" };
      }
      const messages = await repositories.messages.listForTask(input.taskId);
      const assistant = messages.find(
        (message) => message.id === input.messageId && message.role === "assistant"
      );
      const latestMessage = messages.at(-1);
      if (!assistant || assistant.content !== "" || latestMessage?.id !== assistant.id) {
        return { ok: false, error: "generation_failed" };
      }
      await repositories.messages.save({
        ...assistant,
        content: input.content,
        createdAt: assistant.createdAt
      });
      return { ok: true };
    },

    async abandonStreamingChatPrompt(input) {
      const task = await repositories.tasks.getById(input.taskId);
      if (!task) {
        return { ok: false, error: "generation_failed" };
      }

      return withRepositoryTaskLock(repositories, async () => {
        const messages = await repositories.messages.listForTask(input.taskId);
        const assistant = messages.find(
          (message) => message.id === input.messageId && message.role === "assistant"
        );
        const latestMessage = messages.at(-1);
        if (!assistant) {
          return { ok: false, error: "generation_failed" };
        }
        if (assistant.content !== "" && !input.allowPersistedContent) {
          return { ok: false, error: "generation_failed" };
        }
        if (
          assistant.content !== "" &&
          input.allowStale !== true &&
          latestMessage?.id !== assistant.id
        ) {
          return { ok: false, error: "generation_failed" };
        }
        retireRepositoryMessageId(repositories, assistant.id);
        await repositories.messages.deleteById(assistant.id);
        return { ok: true };
      });
    },

    async submitTaskPrompt(input) {
      const prompt = validatePromptInput(input.prompt);
      if (!prompt.ok) {
        return { ok: false, error: prompt.error };
      }

      const requestedProjectId = await resolveProjectIdForPrompt(input.projectId);
      if (requestedProjectId && !(await repositories.projects.getById(requestedProjectId))) {
        return { ok: false, error: "project_not_found" };
      }

      const requestedTaskId = input.taskId ?? undefined;
      if (requestedTaskId) {
        const existingTask = await repositories.tasks.getById(requestedTaskId);
        const continuationProjectId = requestedProjectId ?? existingTask?.projectId;
        if (
          existingTask?.type === "lp_generation" &&
          existingTask.projectId !== undefined &&
          existingTask.projectId === continuationProjectId
        ) {
          const routed = await routeExistingLpTaskPromptIntent({
            repositories,
            service,
            task: existingTask,
            projectId: continuationProjectId,
            prompt: prompt.value
          });
          if (routed.type === "chat_in_task") {
            return answerLpTaskChatInPlace({
              repositories,
              service,
              taskFollowupSuggestionCache,
              task: existingTask,
              projectId: continuationProjectId,
              prompt: prompt.value
            });
          }
          if (routed.type === "agent_new_task") {
            return runLpTaskPrompt({
              repositories,
              service,
              currentUser,
              taskFollowupSuggestionCache,
              requestedTaskId: undefined,
              requestedProjectId: continuationProjectId,
              prompt: prompt.value,
              implicitProjectName: input.implicitProjectName
            });
          }
          if (routed.type === "clarify") {
            return clarifyLpTaskInputInPlace({
              repositories,
              service,
              taskFollowupSuggestionCache,
              task: existingTask,
              projectId: continuationProjectId,
              prompt: prompt.value,
              question: routed.question
            });
          }
          return runLpTaskPrompt({
            repositories,
            service,
            currentUser,
            taskFollowupSuggestionCache,
            requestedTaskId,
            requestedProjectId: continuationProjectId,
            prompt: prompt.value,
            implicitProjectName: input.implicitProjectName
          });
        }
      }

      const taskType = classifyTaskPrompt(prompt.value);
      if (taskType === "lp_generation") {
        return runLpTaskPrompt({
          repositories,
          service,
          currentUser,
          taskFollowupSuggestionCache,
          requestedTaskId,
          requestedProjectId,
          prompt: prompt.value,
          implicitProjectName: input.implicitProjectName
        });
      }

      try {
        const task = await saveTaskThread({
          repositories,
          title: deriveTaskTitle(prompt.value),
          type: taskType,
          projectId: requestedProjectId,
          userMessage: prompt.value,
          assistantMessage: "I created a task thread and can continue from here."
        });

        return {
          ok: true,
          taskId: task.id,
          taskType,
          projectId: requestedProjectId
        };
      } catch {
        return { ok: false, error: "generation_failed" };
      }
    },

    async startLiveTaskPrompt(input) {
      const prompt = validatePromptInput(input.prompt);
      if (!prompt.ok) {
        return { ok: false, error: prompt.error };
      }

      const requestedProjectId = await resolveProjectIdForPrompt(input.projectId);
      if (requestedProjectId && !(await repositories.projects.getById(requestedProjectId))) {
        return { ok: false, error: "project_not_found" };
      }

      const requestedTaskId = input.taskId ?? undefined;
      if (requestedTaskId) {
        const existingTask = await repositories.tasks.getById(requestedTaskId);
        const continuationProjectId = requestedProjectId ?? existingTask?.projectId;
        if (
          existingTask?.type === "lp_generation" &&
          existingTask.projectId !== undefined &&
          existingTask.projectId === continuationProjectId
        ) {
          const routed = await routeExistingLpTaskPromptIntent({
            repositories,
            service,
            task: existingTask,
            projectId: continuationProjectId,
            prompt: prompt.value
          });
          if (routed.type === "chat_in_task") {
            const result = await answerLpTaskChatInPlace({
              repositories,
              service,
              taskFollowupSuggestionCache,
              task: existingTask,
              projectId: continuationProjectId,
              prompt: prompt.value
            });
            return {
              ok: true,
              taskId: existingTask.id,
              taskType: "lp_generation",
              projectId: continuationProjectId,
              completion: Promise.resolve(result)
            };
          }
          if (routed.type === "agent_new_task") {
            const prepared = await prepareLpTaskPrompt({
              repositories,
              service,
              requestedTaskId: undefined,
              requestedProjectId: continuationProjectId,
              prompt: prompt.value,
              implicitProjectName: input.implicitProjectName
            });
            const completion = completePreparedLpTaskPrompt({
              repositories,
              service,
              taskFollowupSuggestionCache,
              currentUser,
              task: prepared.task,
              projectId: prepared.projectId,
              prompt: prompt.value,
              previousPageVersionId: prepared.previousPageVersionId
            });
            completion.catch(() => undefined);
            return {
              ok: true,
              taskId: prepared.task.id,
              taskType: "lp_generation",
              projectId: prepared.projectId,
              completion
            };
          }
          if (routed.type === "clarify") {
            const result = await clarifyLpTaskInputInPlace({
              repositories,
              service,
              taskFollowupSuggestionCache,
              task: existingTask,
              projectId: continuationProjectId,
              prompt: prompt.value,
              question: routed.question
            });
            return {
              ok: true,
              taskId: existingTask.id,
              taskType: "lp_generation",
              projectId: continuationProjectId,
              completion: Promise.resolve(result)
            };
          }
          const prepared = await prepareLpTaskPrompt({
            repositories,
            service,
            requestedTaskId,
            requestedProjectId: continuationProjectId,
            prompt: prompt.value,
            implicitProjectName: input.implicitProjectName
          });
          const completion = completePreparedLpTaskPrompt({
            repositories,
            service,
            taskFollowupSuggestionCache,
            currentUser,
            task: prepared.task,
            projectId: prepared.projectId,
            prompt: prompt.value,
            previousPageVersionId: prepared.previousPageVersionId
          });
          completion.catch(() => undefined);
          return {
            ok: true,
            taskId: prepared.task.id,
            taskType: "lp_generation",
            projectId: prepared.projectId,
            completion
          };
        }
      }

      const taskType = classifyTaskPrompt(prompt.value);
      if (taskType !== "lp_generation") {
        return { ok: false, error: "generation_failed" };
      }

      const prepared = await prepareLpTaskPrompt({
        repositories,
        service,
        requestedTaskId,
        requestedProjectId,
        prompt: prompt.value,
        implicitProjectName: input.implicitProjectName
      });
      const completion = completePreparedLpTaskPrompt({
        repositories,
        service,
        taskFollowupSuggestionCache,
        currentUser,
        task: prepared.task,
        projectId: prepared.projectId,
        prompt: prompt.value,
        previousPageVersionId: prepared.previousPageVersionId
      });
      completion.catch(() => undefined);
      return {
        ok: true,
        taskId: prepared.task.id,
        taskType: "lp_generation",
        projectId: prepared.projectId,
        completion
      };
    },

    async interruptCurrentTask(input) {
      const task = await repositories.tasks.getById(input.taskId);
      if (!task) {
        return { ok: false, error: "task_not_found" };
      }
      if (!workerRuntime) {
        return { ok: false, error: "interrupt_target_not_found" };
      }
      return interruptTask({
        repositories,
        workerRuntime,
        taskId: input.taskId,
        reason: input.reason ?? "User interrupted the task."
      });
    },

    async executeRunRecoveryAction(input) {
      const result = await executeApiRunRecoveryAction({
        repositories,
        service,
        workerRuntime: workerQueueRuntime ?? workerRuntime,
        currentUserId: currentUser.id,
        taskId: input.taskId,
        runId: input.runId,
        action: input.action
      });
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      return { ok: true, value: result };
    },

    async createSkillDraft(input) {
      try {
        const value = await service.createSkillDraft(input);
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toSkillFlowError(error) };
      }
    },

    async validateSkillVersion(skillVersionId) {
      try {
        const value = await service.validateSkillVersion({ skillVersionId });
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toSkillFlowError(error) };
      }
    },

    async publishSkillVersion(skillVersionId) {
      try {
        const value = await service.publishSkillVersion({ skillVersionId });
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toSkillFlowError(error) };
      }
    },

    async bindSkillVersionToProject(input) {
      try {
        const value = await service.bindSkillVersionToProject(input);
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toSkillFlowError(error) };
      }
    },

    async setProjectSkillBindingEnabled(input) {
      try {
        const value = await service.setProjectSkillBindingEnabled(input);
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toSkillFlowError(error) };
      }
    },

    async executeSkillCommand(input) {
      try {
        const commandInput = {
          ...input,
          approvedByUserId: currentUser.id
        };
        const value = workerQueueRuntime
          ? await service.enqueueProjectSkillCommand(commandInput)
          : await service.executeProjectSkillCommand(commandInput);
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toSkillCommandFlowError(error) };
      }
    },

    async runLocalWorkerOnce(input = {}) {
      if (input.projectId) {
        try {
          await service.ensureProjectOwnerMembership(input.projectId, currentUser);
        } catch {
          return { ok: false, error: "worker_job_finalization_failed" };
        }
      }
      const result = await runLocalWorkerOnceAndFinalize({
        repositories,
        workerRuntime: workerQueueRuntime,
        workerLogRepository,
        workerId,
        ...(input.projectId ? { projectId: input.projectId } : {})
      });
      return result;
    },

    async createModelProvider(input) {
      try {
        const value = await service.createModelProvider({
          ...input,
          provider: input.provider as ModelProviderType
        });
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toModelFlowError(error) };
      }
    },

    async setModelProviderEnabled(input) {
      try {
        const value = await service.setModelProviderEnabled(input);
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toModelFlowError(error) };
      }
    },

    async upsertProjectModelRoute(input) {
      try {
        const value = await service.upsertProjectModelRoute({
          ...input,
          role: input.role as AgentRole
        });
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toModelFlowError(error) };
      }
    },

    async createMCPConnector(input) {
      try {
        const value = await service.createProjectMCPConnector(input);
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toMCPFlowError(error) };
      }
    },

    async setMCPConnectorEnabled(input) {
      try {
        const value = await service.setProjectMCPConnectorEnabled(input);
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toMCPFlowError(error) };
      }
    },

    async setMCPToolApproval(input) {
      try {
        const value = await service.setProjectMCPToolApproval({
          ...input,
          approvedByUserId: currentUser.id
        });
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toMCPFlowError(error) };
      }
    },

    async executeMCPTool(input) {
      const parsedArguments = parseMCPArgumentsJson(input.argumentsJson);
      if (!parsedArguments.ok) {
        return { ok: false, error: parsedArguments.error };
      }
      try {
        const value = await service.executeProjectMCPTool({
          projectId: input.projectId,
          connectorId: input.connectorId,
          toolName: input.toolName,
          role: input.role as AgentRole,
          arguments: parsedArguments.value
        });
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toMCPFlowError(error) };
      }
    }
  };
}

async function buildWebArtifactDiffState(input: {
  service: DemoWorkbenchService;
  repositories: WorkbenchRepositories;
  projectId: string;
  currentPageVersion: NonNullable<WorkbenchSnapshot["currentPageVersion"]>;
  selectedPath?: string | null;
}): Promise<WebArtifactDiffState | undefined> {
  const artifactWorkspaceId = input.currentPageVersion.artifactWorkspaceId;
  if (!artifactWorkspaceId) {
    return undefined;
  }

  const previousPageVersion = await findPreviousPageVersionForBrief({
    repositories: input.repositories,
    currentPageVersionId: input.currentPageVersion.id,
    projectId: input.projectId,
    briefId: input.currentPageVersion.briefId
  });
  const diffFiles = previousPageVersion
    ? await buildDiffFileViews({
        service: input.service,
        projectId: input.projectId,
        fromPageVersionId: previousPageVersion.id,
        toPageVersionId: input.currentPageVersion.id
      })
    : [];
  const usesPreviousDiff = previousPageVersion !== undefined && diffFiles.length > 0;
  const files = usesPreviousDiff
    ? diffFiles
    : await buildInitialFileViews({
        service: input.service,
        projectId: input.projectId,
        pageVersionId: input.currentPageVersion.id,
        artifactWorkspaceId
      });
  const base: WebArtifactDiffState = {
    projectId: input.projectId,
    pageVersionId: input.currentPageVersion.id,
    artifactWorkspaceId,
    ...(usesPreviousDiff ? { previousPageVersionId: previousPageVersion.id } : {}),
    files
  };

  const diffState =
    files.length > 0 ? base : { ...base, errorCode: "artifact_diff_unavailable" as const };
  const selectedPath = normalizeSelectedArtifactPath(input.selectedPath);

  if (selectedPath === undefined) {
    return diffState;
  }
  if (selectedPath === null) {
    return {
      ...diffState,
      errorCode: "artifact_snippet_unavailable"
    };
  }

  return {
    ...diffState,
    ...(await readSelectedArtifactSnippet({
      service: input.service,
      projectId: input.projectId,
      pageVersionId: input.currentPageVersion.id,
      artifactWorkspaceId,
      path: selectedPath
    }))
  };
}

function normalizeSelectedArtifactPath(
  path: string | null | undefined
): ArtifactWorkspaceFilePath | null | undefined {
  if (path === undefined || path === null || path.trim().length === 0) {
    return undefined;
  }
  try {
    return normalizeArtifactWorkspaceFilePath(path);
  } catch {
    return null;
  }
}

async function readSelectedArtifactSnippet(input: {
  service: DemoWorkbenchService;
  projectId: string;
  pageVersionId: string;
  artifactWorkspaceId: string;
  path: ArtifactWorkspaceFilePath;
}): Promise<Pick<WebArtifactDiffState, "selectedSnippet" | "errorCode">> {
  try {
    const result = await input.service.readArtifactWorkspaceFile({
      projectId: input.projectId,
      workspaceId: input.artifactWorkspaceId,
      pageVersionId: input.pageVersionId,
      path: input.path,
      includeContent: true,
      maxBytes: ARTIFACT_WORKSPACE_DEFAULT_READ_MAX_BYTES
    });
    return {
      selectedSnippet: {
        path: result.file.path,
        sizeBytes: result.file.sizeBytes,
        sha256: result.file.sha256,
        shortSha256: toShortSha256(result.file.sha256),
        ...(result.content !== undefined ? { content: result.content } : {}),
        omittedReason: result.omittedReason,
        maxBytes: ARTIFACT_WORKSPACE_DEFAULT_READ_MAX_BYTES
      }
    };
  } catch {
    return {
      selectedSnippet: {
        path: input.path,
        omittedReason: "unavailable",
        maxBytes: ARTIFACT_WORKSPACE_DEFAULT_READ_MAX_BYTES
      },
      errorCode: "artifact_snippet_unavailable"
    };
  }
}

async function buildInitialFileViews(input: {
  service: DemoWorkbenchService;
  projectId: string;
  pageVersionId: string;
  artifactWorkspaceId: string;
}): Promise<WebArtifactDiffFileView[]> {
  const files: WebArtifactDiffFileView[] = [];

  for (const path of artifactPreviewPaths) {
    try {
      const result = await input.service.readArtifactWorkspaceFile({
        projectId: input.projectId,
        workspaceId: input.artifactWorkspaceId,
        pageVersionId: input.pageVersionId,
        path
      });
      files.push({
        path,
        state: "initial",
        sizeBytes: result.file.sizeBytes,
        sha256: result.file.sha256,
        shortSha256: toShortSha256(result.file.sha256),
        summary: result.file.summary,
        canPreview: true
      });
    } catch {
      files.push({
        path,
        state: "initial",
        canPreview: false
      });
    }
  }

  return files;
}

async function buildDiffFileViews(input: {
  service: DemoWorkbenchService;
  projectId: string;
  fromPageVersionId: string;
  toPageVersionId: string;
}): Promise<WebArtifactDiffFileView[]> {
  try {
    const diff = await input.service.diffPageVersionArtifactWorkspaces({
      projectId: input.projectId,
      fromPageVersionId: input.fromPageVersionId,
      toPageVersionId: input.toPageVersionId
    });
    return diff.files.map(toWebArtifactDiffFileView);
  } catch {
    return [];
  }
}

function toWebArtifactDiffFileView(file: ArtifactWorkspaceDiffFile): WebArtifactDiffFileView {
  const endpoint = file.to !== undefined ? file.to : file.from;
  return {
    path: file.path,
    state: file.state,
    ...(endpoint?.sizeBytes !== undefined ? { sizeBytes: endpoint.sizeBytes } : {}),
    ...(endpoint?.sha256 ? { sha256: endpoint.sha256 } : {}),
    ...(endpoint?.sha256 ? { shortSha256: toShortSha256(endpoint.sha256) } : {}),
    ...(endpoint?.summary ? { summary: endpoint.summary } : {}),
    canPreview: file.to !== undefined
  };
}

async function findPreviousPageVersionForBrief(input: {
  repositories: WorkbenchRepositories;
  currentPageVersionId: string;
  projectId: string;
  briefId: string;
}) {
  const pageVersions = await input.repositories.pageVersions.listAll();
  const currentIndex = pageVersions.findIndex(
    (pageVersion) => pageVersion.id === input.currentPageVersionId
  );
  const candidates = (currentIndex >= 0 ? pageVersions.slice(0, currentIndex) : pageVersions)
    .filter(
      (pageVersion) =>
        pageVersion.projectId === input.projectId &&
        pageVersion.briefId === input.briefId &&
        pageVersion.id !== input.currentPageVersionId
    );
  return candidates.at(-1);
}

function toShortSha256(sha256: string): string {
  return sha256.slice(0, 12);
}

function filterRunEventsForSnapshot(
  runEvents: RunEventRecord[],
  snapshot?: WorkbenchTaskSnapshotRecord
): RunEventRecord[] {
  if (!snapshot) {
    return [];
  }

  const runIds = new Set<string>();
  if (snapshot.briefId) {
    runIds.add(`run_planner_${snapshot.briefId}`);
  }
  if (snapshot.pageVersionId) {
    runIds.add(`run_builder_${snapshot.pageVersionId}`);
    runIds.add(`run_reviewer_${snapshot.pageVersionId}`);
    runIds.add(`run_deployer_${snapshot.pageVersionId}`);
  }

  return runEvents.filter(
    (event) => runIds.has(event.runId) || isSkillCommandRunEventForSnapshot(event, snapshot)
  );
}

function mergeRunEventsForTaskView(input: {
  taskRunEvents: RunEventRecord[];
  snapshotRunEvents: RunEventRecord[];
}): RunEventRecord[] {
  const eventsById = new Map<string, RunEventRecord>();
  for (const event of input.taskRunEvents) {
    eventsById.set(event.id, event);
  }
  for (const event of input.snapshotRunEvents) {
    if (!eventsById.has(event.id)) {
      eventsById.set(event.id, event);
    }
  }

  return [...eventsById.values()].sort(compareRunEventsForTaskView);
}

function compareRunEventsForTaskView(a: RunEventRecord, b: RunEventRecord): number {
  return (
    a.createdAt.localeCompare(b.createdAt) ||
    a.runId.localeCompare(b.runId) ||
    a.sequence - b.sequence ||
    a.id.localeCompare(b.id)
  );
}

async function deriveWebTaskInterruptView(input: {
  repositories: WorkbenchRepositories;
  workerRuntime?: TaskInterruptWorkerRuntime;
  taskId: string;
}): Promise<TaskInterrupt> {
  if (!input.workerRuntime) {
    return {
      available: false,
      state: "not_interruptible",
      taskId: input.taskId
    };
  }
  return deriveTaskInterruptView({
    repositories: input.repositories,
    workerRuntime: input.workerRuntime,
    taskId: input.taskId
  });
}

function isSkillCommandRunEventForSnapshot(
  event: RunEventRecord,
  snapshot: WorkbenchTaskSnapshotRecord
): boolean {
  return (
    event.runId.startsWith("run_skill_command_") &&
    typeof event.payload.pageVersionId === "string" &&
    event.payload.pageVersionId === snapshot.pageVersionId
  );
}

function toSkillFlowError(error: unknown): SkillFlowErrorCode {
  const message = error instanceof Error ? error.message : "";
  if (
    message === "invalid_manifest_json" ||
    message === "manifest_validation_failed" ||
    message === "unsupported_skill_scope" ||
    message === "duplicate_skill_version" ||
    message === "skill_binding_already_exists" ||
    message === "unsupported_content_type" ||
    message === "skill_content_required" ||
    message === "skill_content_too_large" ||
    message === "project_not_found" ||
    message === "skill_version_not_found" ||
    message === "skill_version_not_validated" ||
    message === "skill_version_not_published" ||
    message === "skill_binding_not_found" ||
    message === "publish_not_allowed"
  ) {
    return message;
  }
  if (message === "Project not found.") {
    return "project_not_found";
  }
  if (message === "skill_version_not_publishable") {
    return "publish_not_allowed";
  }
  if (message.includes("ZodError") || message.includes("Invalid")) {
    return "manifest_validation_failed";
  }
  return "skill_operation_failed";
}

function toSkillCommandFlowError(error: unknown): SkillCommandExecutionFlowErrorCode {
  const message = error instanceof Error ? error.message : "";
  if (
    message === "project_not_found" ||
    message === "skill_command_not_found" ||
    message === "skill_command_not_bound" ||
    message === "skill_command_not_deployment" ||
    message === "skill_command_not_published" ||
    message === "skill_command_permission_denied" ||
    message === "skill_command_approval_required" ||
    message === "skill_command_page_version_not_found" ||
    message === "skill_command_unknown_template_variable" ||
    message === "skill_command_not_queueable" ||
    message === "worker_runtime_not_configured"
  ) {
    return message;
  }
  if (message === "Project not found.") {
    return "project_not_found";
  }
  return "skill_command_execution_failed";
}

function toModelFlowError(error: unknown): ModelFlowErrorCode {
  const message = error instanceof Error ? error.message : "";
  if (
    message === "project_not_found" ||
    message === "model_provider_name_required" ||
    message === "model_provider_key_required" ||
    message === "model_provider_type_unsupported" ||
    message === "model_provider_api_required" ||
    message === "model_provider_api_unsupported" ||
    message === "model_provider_base_url_invalid" ||
    message === "model_provider_api_key_env_invalid" ||
    message === "model_provider_model_id_required" ||
    message === "model_provider_model_limit_invalid" ||
    message === "model_provider_already_exists" ||
    message === "model_provider_not_found" ||
    message === "model_provider_disabled" ||
    message === "model_provider_in_use" ||
    message === "model_role_unsupported" ||
    message === "model_id_required" ||
    message === "model_route_not_found" ||
    message === "model_route_provider_invalid" ||
    message === "model_secret_reference_invalid"
  ) {
    return message;
  }
  if (message === "Project not found.") {
    return "project_not_found";
  }
  return "model_routing_operation_failed";
}

function toMCPFlowError(error: unknown): MCPFlowErrorCode {
  const message = error instanceof Error ? error.message : "";
  if (
    message === "project_not_found" ||
    message === "mcp_connector_json_invalid" ||
    message === "mcp_connector_validation_failed" ||
    message === "mcp_connector_scope_unsupported" ||
    message === "mcp_connector_already_exists" ||
    message === "mcp_connector_not_found" ||
    message === "mcp_tool_not_found" ||
    message === "mcp_tool_approval_not_required" ||
    message === "mcp_tool_not_visible" ||
    message === "mcp_tool_execution_not_read_only" ||
    message === "mcp_tool_execution_approval_required" ||
    message === "mcp_tool_execution_rejected" ||
    message === "mcp_tool_execution_failed" ||
    message === "mcp_tool_arguments_invalid" ||
    message === "mcp_executor_not_configured"
  ) {
    return message;
  }
  if (message === "Project not found.") {
    return "project_not_found";
  }
  return "mcp_operation_failed";
}

function parseMCPArgumentsJson(
  value: string | undefined
): { ok: true; value: Record<string, unknown> } | { ok: false; error: MCPFlowErrorCode } {
  const source = value?.trim() ?? "";
  if (source.length === 0) {
    return { ok: true, value: {} };
  }
  try {
    const parsed = JSON.parse(source) as unknown;
    if (!isRecord(parsed)) {
      return { ok: false, error: "mcp_tool_arguments_invalid" };
    }
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, error: "mcp_tool_arguments_invalid" };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecoverableModelResolutionError(
  error: ModelFlowErrorCode
): error is
  | "model_route_provider_invalid"
  | "model_provider_disabled"
  | "model_id_required"
  | "model_role_unsupported" {
  return (
    error === "model_route_provider_invalid" ||
    error === "model_provider_disabled" ||
    error === "model_id_required" ||
    error === "model_role_unsupported"
  );
}

const repositoryTaskLocks = new WeakMap<WorkbenchRepositories, Promise<void>>();
const repositoryRetiredMessageIds = new WeakMap<WorkbenchRepositories, Set<string>>();

function retireRepositoryMessageId(repositories: WorkbenchRepositories, messageId: string): void {
  let retiredIds = repositoryRetiredMessageIds.get(repositories);
  if (!retiredIds) {
    retiredIds = new Set<string>();
    repositoryRetiredMessageIds.set(repositories, retiredIds);
  }
  retiredIds.add(messageId);
}

function nextRepositoryMessageId(
  repositories: WorkbenchRepositories,
  existingMessages: ChatMessageRecord[]
): string {
  const retiredIds = repositoryRetiredMessageIds.get(repositories);
  return nextSequentialId("message", [
    ...existingMessages.map((record) => record.id),
    ...(retiredIds ? [...retiredIds] : [])
  ]);
}

async function createTaskThread(input: {
  repositories: WorkbenchRepositories;
  title: string;
  type: TaskType;
  projectId?: string;
  userMessage: string;
  now?: () => Date;
}): Promise<{ task: TaskRecord; userMessage: ChatMessageRecord }> {
  return withRepositoryTaskLock(input.repositories, async () => {
    const now = (input.now ?? (() => new Date()))().toISOString();
    const existingTasks = await input.repositories.tasks.listAll();
    const existingMessages = await input.repositories.messages.listAll();
    const task: TaskRecord = {
      id: nextSequentialId("task", existingTasks.map((record) => record.id)),
      title: input.title,
      type: input.type,
      status: "complete",
      projectId: input.projectId,
      createdAt: now
    };
    const userMessage: ChatMessageRecord = {
      id: nextRepositoryMessageId(input.repositories, existingMessages),
      taskId: task.id,
      role: "user",
      content: input.userMessage,
      createdAt: now
    };
    await input.repositories.tasks.save(task);
    await input.repositories.messages.save(userMessage);
    return { task: { ...task }, userMessage: { ...userMessage } };
  });
}

async function appendTaskMessage(input: {
  repositories: WorkbenchRepositories;
  taskId: string;
  role: WorkbenchMessageRole;
  content: string;
  now?: () => Date;
}): Promise<ChatMessageRecord> {
  return withRepositoryTaskLock(input.repositories, async () => {
    const now = (input.now ?? (() => new Date()))().toISOString();
    const existingMessages = await input.repositories.messages.listAll();
    const message: ChatMessageRecord = {
      id: nextRepositoryMessageId(input.repositories, existingMessages),
      taskId: input.taskId,
      role: input.role,
      content: input.content,
      createdAt: now
    };
    await input.repositories.messages.save(message);
    return { ...message };
  });
}

async function saveTaskSnapshot(input: {
  repositories: WorkbenchRepositories;
  taskId: string;
  projectId: string;
  briefId?: string;
  pageVersionId?: string | null;
  now?: () => Date;
}): Promise<void> {
  const existing = await input.repositories.taskSnapshots.getByTaskId(input.taskId);
  const hasPageVersionId = Object.prototype.hasOwnProperty.call(input, "pageVersionId");
  await input.repositories.taskSnapshots.save({
    taskId: input.taskId,
    projectId: input.projectId,
    briefId: input.briefId ?? existing?.briefId,
    pageVersionId: hasPageVersionId
      ? input.pageVersionId ?? undefined
      : existing?.pageVersionId,
    createdAt: existing?.createdAt ?? (input.now ?? (() => new Date()))().toISOString()
  });
}

async function runLpAgentChainForTask(input: {
  repositories: WorkbenchRepositories;
  service: DemoWorkbenchService;
  currentUser: WorkbenchUserIdentity;
  taskId: string;
  projectId: string;
  prompt: string;
  previousPageVersionId?: string;
  now?: () => Date;
}): Promise<{ briefId: string; pageVersionId: string }> {
  const brief = await input.service.createBriefFromPrompt({
    projectId: input.projectId,
    taskId: input.taskId,
    prompt: input.prompt
  });
  await saveTaskSnapshot({
    repositories: input.repositories,
    taskId: input.taskId,
    projectId: input.projectId,
    briefId: brief.id,
    pageVersionId: null,
    now: input.now
  });

  const pageVersion = await input.service.generatePageVersion({
    projectId: input.projectId,
    briefId: brief.id,
    taskId: input.taskId,
    contextPageVersionId: input.previousPageVersionId
  });
  await saveTaskSnapshot({
    repositories: input.repositories,
    taskId: input.taskId,
    projectId: input.projectId,
    briefId: brief.id,
    pageVersionId: pageVersion.id,
    now: input.now
  });

  const reviewedPageVersion = await input.service.reviewPageVersion({
    projectId: input.projectId,
    pageVersionId: pageVersion.id,
    taskId: input.taskId
  });
  if (reviewedPageVersion.reviewStatus === "passed") {
    await input.service.approveAndCreateDeployment({
      projectId: input.projectId,
      pageVersionId: reviewedPageVersion.id,
      taskId: input.taskId,
      reviewerUserId: input.currentUser.id
    });
  }

  return {
    briefId: brief.id,
    pageVersionId: reviewedPageVersion.id
  };
}

async function routeExistingLpTaskPromptIntent(input: {
  repositories: WorkbenchRepositories;
  service: DemoWorkbenchService;
  task: TaskRecord;
  projectId: string;
  prompt: string;
}): Promise<TaskInputIntent> {
  const snapshotRef = await input.repositories.taskSnapshots.getByTaskId(input.task.id);
  const snapshot = snapshotRef
    ? await input.service.getSnapshotForRecords({
        projectId: snapshotRef.projectId,
        briefId: snapshotRef.briefId,
        pageVersionId: snapshotRef.pageVersionId
      })
    : undefined;
  const artifactDiff = snapshot?.currentPageVersion
    ? await buildWebArtifactDiffState({
        service: input.service,
        repositories: input.repositories,
        projectId: snapshot.project.id,
        currentPageVersion: snapshot.currentPageVersion
      })
    : undefined;

  return input.service.routeTaskInputIntent({
    projectId: input.projectId,
    taskId: input.task.id,
    prompt: input.prompt,
    currentTask: {
      id: input.task.id,
      type: "lp_generation",
      projectId: input.projectId,
      status: input.task.status
    },
    recentMessages: await listRecentTaskIntentMessages(input.repositories, input.task.id),
    artifactSummary: buildTaskIntentArtifactSummary(artifactDiff, snapshot)
  });
}

async function answerLpTaskChatInPlace(input: {
  repositories: WorkbenchRepositories;
  service: DemoWorkbenchService;
  taskFollowupSuggestionCache: TaskFollowupSuggestionCache;
  task: TaskRecord;
  projectId: string;
  prompt: string;
}): Promise<SubmitTaskResult> {
  await appendTaskMessage({
    repositories: input.repositories,
    taskId: input.task.id,
    role: "user",
    content: input.prompt
  });
  const assistant = await input.service.runAssistantChat({
    projectId: input.projectId,
    taskId: input.task.id,
    prompt: input.prompt
  });
  await appendTaskMessage({
    repositories: input.repositories,
    taskId: input.task.id,
    role: "assistant",
    content: assistant.ok
      ? assistant.content
      : "I could not answer that in chat. Please try again or continue the LP task."
  });
  await refreshLpTaskFollowupSuggestionCache({
    repositories: input.repositories,
    service: input.service,
    taskFollowupSuggestionCache: input.taskFollowupSuggestionCache,
    task: input.task,
    projectId: input.projectId
  });
  if (!assistant.ok) {
    return {
      ok: false,
      error: assistant.error,
      taskId: input.task.id,
      taskType: "lp_generation",
      projectId: input.projectId
    };
  }
  return {
    ok: true,
    taskId: input.task.id,
    taskType: "lp_generation",
    projectId: input.projectId
  };
}

async function clarifyLpTaskInputInPlace(input: {
  repositories: WorkbenchRepositories;
  service: DemoWorkbenchService;
  taskFollowupSuggestionCache: TaskFollowupSuggestionCache;
  task: TaskRecord;
  projectId: string;
  prompt: string;
  question: string;
}): Promise<SubmitTaskResult> {
  await appendTaskMessage({
    repositories: input.repositories,
    taskId: input.task.id,
    role: "user",
    content: input.prompt
  });
  await appendTaskMessage({
    repositories: input.repositories,
    taskId: input.task.id,
    role: "assistant",
    content: input.question
  });
  await refreshLpTaskFollowupSuggestionCache({
    repositories: input.repositories,
    service: input.service,
    taskFollowupSuggestionCache: input.taskFollowupSuggestionCache,
    task: input.task,
    projectId: input.projectId
  });
  return {
    ok: true,
    taskId: input.task.id,
    taskType: "lp_generation",
    projectId: input.projectId
  };
}

async function refreshLpTaskFollowupSuggestionCache(input: {
  repositories: WorkbenchRepositories;
  service: DemoWorkbenchService;
  taskFollowupSuggestionCache: TaskFollowupSuggestionCache;
  task: TaskRecord;
  projectId: string;
}): Promise<void> {
  const snapshotRef = await input.repositories.taskSnapshots.getByTaskId(input.task.id);
  const snapshot = snapshotRef
    ? await input.service.getSnapshotForRecords({
        projectId: snapshotRef.projectId,
        briefId: snapshotRef.briefId,
        pageVersionId: snapshotRef.pageVersionId
      })
    : undefined;
  const artifactDiff = snapshot?.currentPageVersion
    ? await buildWebArtifactDiffState({
        service: input.service,
        repositories: input.repositories,
        projectId: snapshot.project.id,
        currentPageVersion: snapshot.currentPageVersion
      })
    : undefined;
  const messages = await input.repositories.messages.listForTask(input.task.id);
  const cacheKey = buildTaskFollowupSuggestionCacheKey({
    taskId: input.task.id,
    messages,
    snapshot
  });
  const suggestions = await generateLpTaskFollowupSuggestions({
    service: input.service,
    projectId: input.projectId,
    task: input.task,
    recentMessages: messages.slice(-6).map((message) => ({
      role: message.role,
      content: message.content
    })),
    artifactSummary: buildTaskIntentArtifactSummary(artifactDiff, snapshot)
  });
  input.taskFollowupSuggestionCache.set(cacheKey, suggestions);
}

async function generateLpTaskFollowupSuggestions(input: {
  service: DemoWorkbenchService;
  projectId: string;
  task: TaskRecord;
  recentMessages: TaskIntentRecentMessage[];
  artifactSummary: TaskIntentArtifactSummary;
}): Promise<TaskFollowupSuggestion[]> {
  try {
    return await input.service.generateTaskFollowupSuggestions({
      projectId: input.projectId,
      taskTitle: input.task.title,
      taskStatus: input.task.status,
      recentMessages: input.recentMessages,
      artifactSummary: input.artifactSummary
    });
  } catch {
    return [];
  }
}

async function listRecentTaskIntentMessages(
  repositories: WorkbenchRepositories,
  taskId: string
): Promise<TaskIntentRecentMessage[]> {
  const messages = await repositories.messages.listForTask(taskId);
  return messages.slice(-6).map((message) => ({
    role: message.role,
    content: message.content
  }));
}

function buildTaskIntentArtifactSummary(
  artifactDiff: WebArtifactDiffState | undefined,
  snapshot: WorkbenchSnapshot | undefined
): TaskIntentArtifactSummary {
  return {
    hasPreview: Boolean(snapshot?.currentPageVersion),
    files:
      artifactDiff?.files.map((file) => ({
        path: file.path,
        summary: file.summary
      })) ?? []
  };
}

function buildTaskFollowupSuggestionCacheKey(input: {
  taskId: string;
  messages: WorkbenchMessageRecord[];
  snapshot: WorkbenchSnapshot | undefined;
}): string {
  const latestMessageId = input.messages.at(-1)?.id ?? "no_message";
  const pageVersionId = input.snapshot?.currentPageVersion?.id ?? "no_page";
  const artifactWorkspaceId =
    input.snapshot?.currentPageVersion?.artifactWorkspaceId ?? "no_workspace";
  return [input.taskId, latestMessageId, pageVersionId, artifactWorkspaceId].join(":");
}

async function runLpTaskPrompt(input: {
  repositories: WorkbenchRepositories;
  service: DemoWorkbenchService;
  currentUser: WorkbenchUserIdentity;
  taskFollowupSuggestionCache: TaskFollowupSuggestionCache;
  requestedTaskId?: string;
  requestedProjectId?: string;
  prompt: string;
  implicitProjectName: string;
}): Promise<SubmitTaskResult> {
  const prepared = await prepareLpTaskPrompt({
    repositories: input.repositories,
    service: input.service,
    requestedTaskId: input.requestedTaskId,
    requestedProjectId: input.requestedProjectId,
    prompt: input.prompt,
    implicitProjectName: input.implicitProjectName
  });
  return completePreparedLpTaskPrompt({
    repositories: input.repositories,
    service: input.service,
    taskFollowupSuggestionCache: input.taskFollowupSuggestionCache,
    currentUser: input.currentUser,
    task: prepared.task,
    projectId: prepared.projectId,
    prompt: input.prompt,
    previousPageVersionId: prepared.previousPageVersionId
  });
}

async function prepareLpTaskPrompt(input: {
  repositories: WorkbenchRepositories;
  service: DemoWorkbenchService;
  requestedTaskId?: string;
  requestedProjectId?: string;
  prompt: string;
  implicitProjectName: string;
}): Promise<{
  task: TaskRecord;
  projectId: string;
  previousPageVersionId?: string;
}> {
  let projectId = input.requestedProjectId;
  if (!projectId) {
    const project = await input.service.createProject({
      name: deriveImplicitProjectName(input.prompt, input.implicitProjectName)
    });
    projectId = project.id;
  }

  const existingTask = input.requestedTaskId
    ? await input.repositories.tasks.getById(input.requestedTaskId)
    : undefined;
  const reusableTask =
    existingTask && existingTask.type === "lp_generation" && existingTask.projectId === projectId
      ? existingTask
      : undefined;
  const task = reusableTask
    ? { ...reusableTask }
    : (
        await createTaskThread({
          repositories: input.repositories,
          title: deriveTaskTitle(input.prompt),
          type: "lp_generation",
          projectId,
          userMessage: input.prompt
        })
      ).task;
  if (reusableTask) {
    await appendTaskMessage({
      repositories: input.repositories,
      taskId: reusableTask.id,
      role: "user",
      content: input.prompt
    });
  } else {
    await saveTaskSnapshot({
      repositories: input.repositories,
      taskId: task.id,
      projectId
    });
  }

  const previousSnapshot = await input.repositories.taskSnapshots.getByTaskId(task.id);
  const previousPageVersionId = previousSnapshot?.pageVersionId;

  return { task, projectId, previousPageVersionId };
}

async function completePreparedLpTaskPrompt(input: {
  repositories: WorkbenchRepositories;
  service: DemoWorkbenchService;
  taskFollowupSuggestionCache: TaskFollowupSuggestionCache;
  currentUser: WorkbenchUserIdentity;
  task: TaskRecord;
  projectId: string;
  prompt: string;
  previousPageVersionId?: string;
}): Promise<SubmitTaskResult> {
  try {
    const chain = await runLpAgentChainForTask({
      repositories: input.repositories,
      service: input.service,
      currentUser: input.currentUser,
      taskId: input.task.id,
      projectId: input.projectId,
      prompt: input.prompt,
      previousPageVersionId: input.previousPageVersionId
    });
    await saveTaskSnapshot({
      repositories: input.repositories,
      taskId: input.task.id,
      projectId: input.projectId,
      briefId: chain.briefId,
      pageVersionId: chain.pageVersionId
    });
    const pageVersion = await input.repositories.pageVersions.getById(chain.pageVersionId);
    const assistantSummary =
      pageVersion?.reviewStatus === "failed"
        ? "LP artifacts need review attention before deployment."
        : "LP artifacts are ready for review.";
    await appendTaskMessage({
      repositories: input.repositories,
      taskId: input.task.id,
      role: "assistant",
      content: assistantSummary
    });
    await refreshLpTaskFollowupSuggestionCache({
      repositories: input.repositories,
      service: input.service,
      taskFollowupSuggestionCache: input.taskFollowupSuggestionCache,
      task: input.task,
      projectId: input.projectId
    });
    return {
      ok: true,
      taskId: input.task.id,
      taskType: "lp_generation",
      projectId: input.projectId
    };
  } catch {
    const failureMessage = await resolveLpGenerationFailureMessage({
      repositories: input.repositories,
      taskId: input.task.id
    });
    await appendTaskMessage({
      repositories: input.repositories,
      taskId: input.task.id,
      role: "assistant",
      content: failureMessage
    });
    await refreshLpTaskFollowupSuggestionCache({
      repositories: input.repositories,
      service: input.service,
      taskFollowupSuggestionCache: input.taskFollowupSuggestionCache,
      task: input.task,
      projectId: input.projectId
    });
    return {
      ok: false,
      error: "generation_failed",
      taskId: input.task.id,
      taskType: "lp_generation",
      projectId: input.projectId
    };
  }
}

const lpGenerationFailureMessage =
  "LP generation failed. Open recovery details for the failed run.";
const lpGenerationModelTimeoutFailureMessage =
  "Model provider timed out while planning the LP. Retry the task, or increase LP_AGENT_MODEL_PROVIDER_TIMEOUT_MS in .env.local if the provider is slow.";

async function resolveLpGenerationFailureMessage(input: {
  repositories: WorkbenchRepositories;
  taskId: string;
}): Promise<string> {
  const events = await input.repositories.runEvents.listForTask(input.taskId);
  return events.some((event) => getRunEventErrorCode(event) === "model_provider_request_timeout")
    ? lpGenerationModelTimeoutFailureMessage
    : lpGenerationFailureMessage;
}

function getRunEventErrorCode(event: RunEventRecord): string | undefined {
  const errorCode = event.payload.errorCode;
  return typeof errorCode === "string" && errorCode.trim().length > 0 ? errorCode : undefined;
}

async function saveTaskThread(input: {
  repositories: WorkbenchRepositories;
  title: string;
  type: TaskType;
  projectId?: string;
  userMessage: string;
  assistantMessage: string;
  snapshot?: {
    projectId: string;
    briefId?: string;
    pageVersionId?: string;
  };
}): Promise<TaskRecord> {
  return withRepositoryTaskLock(input.repositories, async () => {
    const now = new Date().toISOString();
    const existingTasks = await input.repositories.tasks.listAll();
    const existingMessages = await input.repositories.messages.listAll();
    const task: TaskRecord = {
      id: nextSequentialId("task", existingTasks.map((record) => record.id)),
      title: input.title,
      type: input.type,
      status: "complete",
      projectId: input.projectId,
      createdAt: now
    };
    const userMessage: ChatMessageRecord = {
      id: nextRepositoryMessageId(input.repositories, existingMessages),
      taskId: task.id,
      role: "user",
      content: input.userMessage,
      createdAt: now
    };
    const assistantMessage: ChatMessageRecord = {
      id: nextRepositoryMessageId(input.repositories, [...existingMessages, userMessage]),
      taskId: task.id,
      role: "assistant",
      content: input.assistantMessage,
      createdAt: now
    };

    await input.repositories.tasks.save(task);
    await input.repositories.messages.save(userMessage);
    await input.repositories.messages.save(assistantMessage);
    if (input.snapshot) {
      await input.repositories.taskSnapshots.save({
        taskId: task.id,
        projectId: input.snapshot.projectId,
        briefId: input.snapshot.briefId,
        pageVersionId: input.snapshot.pageVersionId,
        createdAt: now
      });
    }

    return { ...task };
  });
}

async function startStreamingChatThread(input: {
  repositories: WorkbenchRepositories;
  taskId?: string;
  title: string;
  projectId?: string;
  userMessage: string;
  assistantMessage: string;
}): Promise<{
  task: TaskRecord;
  userMessage: ChatMessageRecord;
  assistantMessage: ChatMessageRecord;
}> {
  return withRepositoryTaskLock(input.repositories, async () => {
    const now = new Date().toISOString();
    const existingTasks = await input.repositories.tasks.listAll();
    const existingMessages = await input.repositories.messages.listAll();
    const task = getOrCreateStreamingChatTask({
      existingTasks,
      taskId: input.taskId,
      title: input.title,
      projectId: input.projectId,
      now
    });
    const userMessage: ChatMessageRecord = {
      id: nextRepositoryMessageId(input.repositories, existingMessages),
      taskId: task.id,
      role: "user",
      content: input.userMessage,
      createdAt: now
    };
    const assistantMessage: ChatMessageRecord = {
      id: nextRepositoryMessageId(input.repositories, [...existingMessages, userMessage]),
      taskId: task.id,
      role: "assistant",
      content: input.assistantMessage,
      createdAt: now
    };

    await input.repositories.tasks.save(task);
    await input.repositories.messages.save(userMessage);
    await input.repositories.messages.save(assistantMessage);

    return {
      task: { ...task },
      userMessage: { ...userMessage },
      assistantMessage: { ...assistantMessage }
    };
  });
}

async function ensureStreamingChatTask(input: {
  repositories: WorkbenchRepositories;
  taskId?: string;
  title: string;
  projectId?: string;
}): Promise<TaskRecord> {
  return withRepositoryTaskLock(input.repositories, async () => {
    const now = new Date().toISOString();
    const existingTasks = await input.repositories.tasks.listAll();
    const task = getOrCreateStreamingChatTask({
      existingTasks,
      taskId: input.taskId,
      title: input.title,
      projectId: input.projectId,
      now
    });

    await input.repositories.tasks.save(task);

    return { ...task };
  });
}

async function appendStreamingChatUserMessage(input: {
  repositories: WorkbenchRepositories;
  taskId: string;
  content: string;
}): Promise<ChatMessageRecord> {
  return withRepositoryTaskLock(input.repositories, async () => {
    const existingMessages = await input.repositories.messages.listAll();
    const message: ChatMessageRecord = {
      id: nextRepositoryMessageId(input.repositories, existingMessages),
      taskId: input.taskId,
      role: "user",
      content: input.content,
      createdAt: new Date().toISOString()
    };

    await input.repositories.messages.save(message);

    return { ...message };
  });
}

function getOrCreateStreamingChatTask(input: {
  existingTasks: TaskRecord[];
  taskId?: string;
  title: string;
  projectId?: string;
  now: string;
}): TaskRecord {
  const existingTask = input.taskId
    ? input.existingTasks.find((task) => task.id === input.taskId)
    : undefined;
  if (
    existingTask &&
    existingTask.type === "general_chat" &&
    (existingTask.projectId ?? undefined) === input.projectId
  ) {
    return existingTask;
  }

  return {
    id: nextSequentialId("task", input.existingTasks.map((record) => record.id)),
    title: input.title,
    type: "general_chat",
    status: "complete",
    ...(input.projectId ? { projectId: input.projectId } : {}),
    createdAt: input.now
  };
}

async function ensureLocalRealProviderProjectForEnv(input: {
  repositories: WorkbenchRepositories;
  service: DemoWorkbenchService;
  env: RuntimeEnvironment;
}): Promise<string | undefined> {
  if (!resolveLocalRealProviderProfile(input.env)) {
    return undefined;
  }

  const existingProjects = await input.repositories.projects.listAll();
  const project =
    existingProjects.find((candidate) => candidate.name === LOCAL_REAL_PROVIDER_PROJECT_NAME) ??
    (await input.service.createProject({ name: LOCAL_REAL_PROVIDER_PROJECT_NAME }));
  await input.service.ensureProjectOwnerMembership(project.id);

  return ensureLocalRealProviderRoutesForProject({
    ...input,
    projectId: project.id
  });
}

async function ensureLocalRealProviderRoutesForProject(input: {
  repositories: WorkbenchRepositories;
  service: DemoWorkbenchService;
  env: RuntimeEnvironment;
  projectId: string;
}): Promise<string | undefined> {
  const profile = resolveLocalRealProviderProfile(input.env);
  if (!profile || !(await input.repositories.projects.getById(input.projectId))) {
    return input.projectId;
  }

  await input.service.ensureProjectOwnerMembership(input.projectId);
  const providerId = buildLocalRealProviderId(profile, input.projectId);
  const existingProvider = await input.repositories.modelProviders.getById(providerId);
  if (existingProvider) {
    await input.repositories.modelProviders.save({
      ...existingProvider,
      scope: "project",
      targetKey: input.projectId,
      name: profile.name,
      provider: "custom",
      config: {
        api: profile.api,
        baseUrl: profile.baseUrl,
        apiKeyEnv: profile.apiKeyEnv,
        models: [{ id: profile.model }]
      },
      enabled: true,
      updatedAt: new Date().toISOString()
    });
  } else {
    await input.service.createModelProvider({
      projectId: input.projectId,
      providerId,
      name: profile.name,
      provider: "custom",
      api: profile.api,
      baseUrl: profile.baseUrl,
      apiKeyEnv: profile.apiKeyEnv,
      modelId: profile.model
    });
  }

  for (const role of LOCAL_REAL_PROVIDER_ROUTE_ROLES) {
    await input.service.upsertProjectModelRoute({
      projectId: input.projectId,
      role,
      providerId,
      model: profile.model
    });
  }

  return input.projectId;
}

function resolveLocalRealProviderProfile(
  env: RuntimeEnvironment
): LocalRealProviderProfile | undefined {
  if (env.REAL_MODEL_RUNTIME !== "1") {
    return undefined;
  }

  return (
    readOpenAICompatibleProfile(env) ??
    readAnthropicCompatibleProfile(env)
  );
}

function readOpenAICompatibleProfile(env: RuntimeEnvironment): LocalRealProviderProfile | undefined {
  const baseUrl = readEnvValue(env, "OPENAI_COMPATIBLE_BASE_URL");
  const apiKey = readEnvValue(env, "OPENAI_COMPATIBLE_API_KEY");
  const model = readEnvValue(env, "OPENAI_COMPATIBLE_DEFAULT_MODEL");
  if (!baseUrl || !apiKey || !model) {
    return undefined;
  }
  return {
    key: "openai_compatible",
    name: "Local OpenAI Compatible",
    api: "openai-completions",
    baseUrl,
    apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
    model
  };
}

function readAnthropicCompatibleProfile(
  env: RuntimeEnvironment
): LocalRealProviderProfile | undefined {
  const baseUrl = readEnvValue(env, "ANTHROPIC_BASE_URL");
  const apiKey = readEnvValue(env, "ANTHROPIC_API_KEY");
  const model = readEnvValue(env, "ANTHROPIC_DEFAULT_MODEL");
  if (!baseUrl || !apiKey || !model) {
    return undefined;
  }
  return {
    key: "anthropic_compatible",
    name: "Local Anthropic Compatible",
    api: "anthropic-messages",
    baseUrl,
    apiKeyEnv: "ANTHROPIC_API_KEY",
    model
  };
}

function readEnvValue(env: RuntimeEnvironment, key: string): string | undefined {
  const value = env[key]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function buildLocalRealProviderId(profile: LocalRealProviderProfile, projectId: string): string {
  return `local_real_provider_${profile.key}_${projectId.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

function resolveDefaultRuntimeEnvironment(): RuntimeEnvironment {
  if (process.env.NODE_ENV === "test") {
    return process.env;
  }

  return {
    ...readLocalEnvFile(resolve(process.cwd(), "../../.env.local")),
    ...readLocalEnvFile(resolve(process.cwd(), ".env.local")),
    ...process.env
  };
}

function readLocalEnvFile(filePath: string): RuntimeEnvironment {
  if (!existsSync(filePath)) {
    return {};
  }

  const env: RuntimeEnvironment = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    env[key] = unquoteEnvValue(rawValue);
  }
  return env;
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

async function withRepositoryTaskLock<T>(
  repositories: WorkbenchRepositories,
  operation: () => Promise<T>
): Promise<T> {
  const previous = repositoryTaskLocks.get(repositories) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  const lock = run.then(
    () => undefined,
    () => undefined
  );
  repositoryTaskLocks.set(repositories, lock);
  lock.finally(() => {
    if (repositoryTaskLocks.get(repositories) === lock) {
      repositoryTaskLocks.delete(repositories);
    }
  });
  return run;
}

function nextSequentialId(prefix: string, existingIds: string[]): string {
  const nextNumber =
    existingIds.reduce((largest, id) => {
      const match = new RegExp(`^${prefix}_(\\d+)$`).exec(id);
      return match ? Math.max(largest, Number(match[1])) : largest;
    }, 0) + 1;
  return `${prefix}_${nextNumber}`;
}

const globalStore = globalThis as typeof globalThis & {
  __lpAgentWebWorkbenchStore?: Promise<WebWorkbenchStore>;
};

function defaultWorkerId(): string {
  return process.env.WORKER_ID ?? "local-web-worker";
}

async function createDefaultWebWorkbenchStore(): Promise<WebWorkbenchStore> {
  const workerQueue = await createWorkerQueueRuntime();
  return createWebWorkbenchStore({
    repositories: await createWebWorkbenchRepositories(),
    workerQueueRuntime: workerQueue.runtime,
    workerRuntime: workerQueue.runtime,
    workerJobRepository: workerQueue.jobRepository,
    workerLogRepository: workerQueue.workerLogRepository,
    workerId: defaultWorkerId()
  });
}

export function getWebWorkbenchStore(): Promise<WebWorkbenchStore> {
  if (!globalStore.__lpAgentWebWorkbenchStore) {
    const storePromise = createDefaultWebWorkbenchStore().catch((error: unknown) => {
      if (globalStore.__lpAgentWebWorkbenchStore === storePromise) {
        delete globalStore.__lpAgentWebWorkbenchStore;
      }
      throw error;
    });
    globalStore.__lpAgentWebWorkbenchStore = storePromise;
  }
  return globalStore.__lpAgentWebWorkbenchStore;
}
