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
  type SkillCommandExecutionResult,
  type SkillCommandQueueRuntime,
  type SkillBindingRecord,
  type SkillContentType,
  type SkillDraftResult,
  type SkillVersionRecord,
  type TaskInterruptView,
  type TaskInterruptWorkerRuntime,
  type ToolCommandRunner,
  type WorkerQueueSnapshot,
  normalizeWorkbenchUserIdentity,
  type WorkbenchUserIdentity,
  type WorkbenchSnapshot
} from "@lp-agent/api";
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
import { createDefaultModelPolicy } from "@lp-agent/model-gateway";
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
  | "generation_failed";

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
  | { ok: false; error: ProjectFlowErrorCode };

export type StreamingChatStartResult =
  | {
      ok: true;
      taskId: string;
      taskType: "general_chat";
      projectId?: string;
      userMessageId: string;
      assistantMessageId: string;
      assistantContent: string;
      chunks: string[];
    }
  | { ok: false; error: ProjectFlowErrorCode }
  | {
      ok: false;
      error: "fallback_required";
      taskType: Exclude<TaskType, "general_chat">;
    };

export type StreamingChatCompleteResult =
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
    };

export interface WebWorkbenchStore {
  createProject(input: CreateProjectFormInput): Promise<ProjectRecord>;
  listProjects(): Promise<ProjectRecord[]>;
  listTasks(): Promise<TaskRecord[]>;
  getPageState(input?: {
    projectId?: string | null;
    taskId?: string | null;
    artifactPath?: string | null;
  }): Promise<WorkbenchPageState>;
  submitTaskPrompt(input: {
    projectId?: string | null;
    prompt: string;
    implicitProjectName: string;
  }): Promise<SubmitTaskResult>;
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
  toolCommandRunner?: ToolCommandRunner;
  workerRuntime?: TaskInterruptWorkerRuntime;
  workerQueueRuntime?: SkillCommandQueueRuntime;
  workerJobRepository?: WorkerJobRepository;
  workerLogRepository?: WorkerLogRepository;
  workerId?: string;
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
    toolCommandRunner: options.toolCommandRunner ?? new SimulatedToolCommandRunner(),
    workerQueueRuntime
  });

  const listProjects = async () =>
    (await repositories.projects.listAll()).map((project) => ({ ...project }));

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

  function createEmptyVisibleToolsByRole(): ProjectMCPState["visibleToolsByRole"] {
    return {
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
      const runEvents = activeProjectId
        ? filterRunEventsForSnapshot(
            await repositories.runEvents.listForProject(activeProjectId),
            snapshotRef
          )
        : [];
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
        messages: await listMessages(task.id),
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
        artifactDiff
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

      const requestedProjectId = input.projectId ?? undefined;
      if (requestedProjectId && !(await repositories.projects.getById(requestedProjectId))) {
        return { ok: false, error: "project_not_found" };
      }

      const assistantContent = "I created a task thread and can continue from here.";
      const started = await startStreamingChatThread({
        repositories,
        taskId: input.taskId ?? undefined,
        title: deriveTaskTitle(prompt.value),
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
        chunks: chunkAssistantText(assistantContent, 12)
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
      if (!assistant) {
        return { ok: false, error: "generation_failed" };
      }
      await repositories.messages.save({
        ...assistant,
        content: input.content,
        createdAt: assistant.createdAt
      });
      return { ok: true };
    },

    async submitTaskPrompt(input) {
      const prompt = validatePromptInput(input.prompt);
      if (!prompt.ok) {
        return { ok: false, error: prompt.error };
      }

      const taskType = classifyTaskPrompt(prompt.value);
      const requestedProjectId = input.projectId ?? undefined;
      if (requestedProjectId && !(await repositories.projects.getById(requestedProjectId))) {
        return { ok: false, error: "project_not_found" };
      }

      try {
        let projectId = requestedProjectId;
        let taskSnapshot: WorkbenchSnapshot | undefined;

        if (!projectId && taskType === "lp_generation") {
          const project = await service.createProject({
            name: deriveImplicitProjectName(prompt.value, input.implicitProjectName)
          });
          projectId = project.id;
        }

        if (taskType === "lp_generation" && projectId) {
          const brief = await service.createBriefFromPrompt({
            projectId,
            prompt: prompt.value
          });
          const pageVersion = await service.generatePageVersion({
            projectId,
            briefId: brief.id
          });
          const reviewedPageVersion = await service.reviewPageVersion({
            projectId,
            pageVersionId: pageVersion.id
          });
          const project = await repositories.projects.getById(projectId);
          if (!project) {
            return { ok: false, error: "project_not_found" };
          }
          taskSnapshot = {
            project: { ...project },
            brief: { ...brief },
            currentPageVersion: { ...reviewedPageVersion }
          };
        }

        const task = await saveTaskThread({
          repositories,
          title: deriveTaskTitle(prompt.value),
          type: taskType,
          projectId,
          userMessage: prompt.value,
          assistantMessage:
            taskType === "lp_generation"
              ? "LP artifacts are ready for review."
              : "I created a task thread and can continue from here.",
          snapshot: taskSnapshot
            ? {
                projectId: taskSnapshot.project.id,
                briefId: taskSnapshot.brief?.id,
                pageVersionId: taskSnapshot.currentPageVersion?.id
              }
            : undefined
        });

        return {
          ok: true,
          taskId: task.id,
          taskType,
          projectId
        };
      } catch {
        return { ok: false, error: "generation_failed" };
      }
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
      id: nextSequentialId("message", existingMessages.map((record) => record.id)),
      taskId: task.id,
      role: "user",
      content: input.userMessage,
      createdAt: now
    };
    const assistantMessage: ChatMessageRecord = {
      id: nextSequentialId(
        "message",
        [...existingMessages.map((record) => record.id), userMessage.id]
      ),
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
    const existingTask = input.taskId
      ? await input.repositories.tasks.getById(input.taskId)
      : undefined;
    const task: TaskRecord =
      existingTask && existingTask.type === "general_chat"
        ? existingTask
        : {
            id: nextSequentialId("task", existingTasks.map((record) => record.id)),
            title: input.title,
            type: "general_chat",
            status: "complete",
            ...(input.projectId ? { projectId: input.projectId } : {}),
            createdAt: now
          };
    const userMessage: ChatMessageRecord = {
      id: nextSequentialId("message", existingMessages.map((record) => record.id)),
      taskId: task.id,
      role: "user",
      content: input.userMessage,
      createdAt: now
    };
    const assistantMessage: ChatMessageRecord = {
      id: nextSequentialId(
        "message",
        [...existingMessages.map((record) => record.id), userMessage.id]
      ),
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
