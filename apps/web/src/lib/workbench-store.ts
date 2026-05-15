import {
  DemoWorkbenchService,
  type AgentRole,
  type MCPConnectorRecord,
  type MCPToolApprovalRecord,
  type ModelProviderRecord,
  type ModelProviderType,
  type ModelRoutingPolicyRecord,
  type ProjectMCPState,
  type ProjectModelState,
  type ProjectRecord,
  type ProjectSkillState,
  type RunEventRecord,
  type SkillCommandExecutionResult,
  type SkillBindingRecord,
  type SkillContentType,
  type SkillDraftResult,
  type SkillVersionRecord,
  type ToolCommandRunner,
  type WorkbenchSnapshot
} from "@lp-agent/api";
import {
  createInMemoryWorkbenchRepositories,
  createJsonFileWorkbenchRepositories,
  type WorkbenchMessageRecord,
  type WorkbenchMessageRole,
  type WorkbenchRepositories,
  type WorkbenchTaskSnapshotRecord,
  type WorkbenchTaskRecord,
  type WorkbenchTaskStatus,
  type WorkbenchTaskType
} from "@lp-agent/db";
import { createDefaultModelPolicy } from "@lp-agent/model-gateway";
import { SimulatedToolCommandRunner } from "./simulated-tool-command-runner";

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
  | SkillCommandFlowErrorCode;

export type SkillCommandFlowErrorCode =
  | "project_not_found"
  | "skill_command_not_found"
  | "skill_command_not_bound"
  | "skill_command_not_deployment"
  | "skill_command_not_published"
  | "skill_command_permission_denied"
  | "skill_command_approval_required"
  | "skill_command_page_version_not_found"
  | "skill_command_unknown_template_variable"
  | "skill_command_execution_failed";

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
  | "mcp_operation_failed";

export interface WebProjectModelState extends ProjectModelState {
  resolutionError?: ModelFlowErrorCode;
}

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
  | { ok: false; error: SkillCommandFlowErrorCode };

export type ModelActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ModelFlowErrorCode };

export type MCPActionResult<T> =
  | { ok: true; value: T }
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
  approvedByUserId: string;
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

export type TaskType = WorkbenchTaskType;
export type TaskStatus = WorkbenchTaskStatus;
export type ChatMessageRole = WorkbenchMessageRole;
export type TaskRecord = WorkbenchTaskRecord;
export type ChatMessageRecord = WorkbenchMessageRecord;

export type SubmitTaskResult =
  | {
      ok: true;
      taskId: string;
      taskType: TaskType;
      projectId?: string;
    }
  | { ok: false; error: ProjectFlowErrorCode };

export type WorkbenchPageState =
  | {
      kind: "empty";
      projects: ProjectRecord[];
      tasks: TaskRecord[];
      skills: ProjectSkillState;
      skillCommands: ProjectSkillCommandView[];
      models: WebProjectModelState;
      mcp: ProjectMCPState;
    }
  | {
      kind: "task_ready";
      projects: ProjectRecord[];
      tasks: TaskRecord[];
      skills: ProjectSkillState;
      skillCommands: ProjectSkillCommandView[];
      models: WebProjectModelState;
      mcp: ProjectMCPState;
      activeTaskId: string;
      task: TaskRecord;
      messages: ChatMessageRecord[];
      runEvents: RunEventRecord[];
      snapshot?: WorkbenchSnapshot;
    };

export interface WebWorkbenchStore {
  createProject(input: CreateProjectFormInput): Promise<ProjectRecord>;
  listProjects(): Promise<ProjectRecord[]>;
  listTasks(): Promise<TaskRecord[]>;
  getPageState(input?: {
    projectId?: string | null;
    taskId?: string | null;
  }): Promise<WorkbenchPageState>;
  submitTaskPrompt(input: {
    projectId?: string | null;
    prompt: string;
    implicitProjectName: string;
  }): Promise<SubmitTaskResult>;
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
}

export interface WebWorkbenchStoreOptions {
  repositories?: WorkbenchRepositories;
  toolCommandRunner?: ToolCommandRunner;
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
  const service = new DemoWorkbenchService({
    repositories,
    toolCommandRunner: options.toolCommandRunner ?? new SimulatedToolCommandRunner()
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
          tasks: currentTasks,
          skills,
          skillCommands: deriveProjectSkillCommands(skills),
          models: await loadModelState(requestedProject?.id),
          mcp: await loadMCPState(requestedProject?.id)
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
      const skills = await loadSkillState(activeProjectId);
      return {
        kind: "task_ready",
        projects: currentProjects,
        tasks: currentTasks,
        skills,
        skillCommands: deriveProjectSkillCommands(skills),
        models: await loadModelState(activeProjectId),
        mcp: await loadMCPState(activeProjectId),
        activeTaskId: task.id,
        task: { ...task },
        messages: await listMessages(task.id),
        runEvents,
        snapshot
      };
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
        const value = await service.executeProjectSkillCommand(input);
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toSkillCommandFlowError(error) };
      }
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
        const value = await service.setProjectMCPToolApproval(input);
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: toMCPFlowError(error) };
      }
    }
  };
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

function toSkillCommandFlowError(error: unknown): SkillCommandFlowErrorCode {
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
    message === "skill_command_unknown_template_variable"
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
    message === "mcp_tool_approval_not_required"
  ) {
    return message;
  }
  if (message === "Project not found.") {
    return "project_not_found";
  }
  return "mcp_operation_failed";
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
  __lpAgentWebWorkbenchStore?: WebWorkbenchStore;
};

function defaultWorkbenchStateFilePath(): string {
  return process.env.LP_AGENT_WORKBENCH_STATE_FILE ?? ".lp-agent/workbench-state.json";
}

export function getWebWorkbenchStore(): WebWorkbenchStore {
  globalStore.__lpAgentWebWorkbenchStore ??= createWebWorkbenchStore({
    repositories: createJsonFileWorkbenchRepositories({
      filePath: defaultWorkbenchStateFilePath()
    })
  });
  return globalStore.__lpAgentWebWorkbenchStore;
}
