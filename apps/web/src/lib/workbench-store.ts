import {
  DemoWorkbenchService,
  type ProjectRecord,
  type ProjectSkillState,
  type SkillBindingRecord,
  type SkillContentType,
  type SkillDraftResult,
  type SkillVersionRecord,
  type WorkbenchSnapshot
} from "@lp-agent/api";
import {
  createInMemoryWorkbenchRepositories,
  createJsonFileWorkbenchRepositories,
  type WorkbenchMessageRecord,
  type WorkbenchMessageRole,
  type WorkbenchRepositories,
  type WorkbenchTaskRecord,
  type WorkbenchTaskStatus,
  type WorkbenchTaskType
} from "@lp-agent/db";

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
  | "unsupported_content_type"
  | "skill_content_required"
  | "skill_content_too_large"
  | "project_not_found"
  | "skill_version_not_found"
  | "skill_version_not_validated"
  | "skill_version_not_published"
  | "skill_binding_not_found"
  | "publish_not_allowed"
  | "skill_operation_failed";

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProjectFlowErrorCode };

export interface CreateProjectFormInput {
  name: string;
}

export type SkillActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SkillFlowErrorCode };

export interface CreateSkillDraftFormInput {
  manifestJson: string;
  content: string;
  contentType: SkillContentType;
}

export interface BindSkillVersionFormInput {
  projectId: string;
  skillVersionId: string;
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
    }
  | {
      kind: "task_ready";
      projects: ProjectRecord[];
      tasks: TaskRecord[];
      skills: ProjectSkillState;
      activeTaskId: string;
      task: TaskRecord;
      messages: ChatMessageRecord[];
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
    bindingId: string;
    enabled: boolean;
  }): Promise<SkillActionResult<SkillBindingRecord>>;
}

export interface WebWorkbenchStoreOptions {
  repositories?: WorkbenchRepositories;
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

export function createWebWorkbenchStore(options: WebWorkbenchStoreOptions = {}): WebWorkbenchStore {
  const repositories = options.repositories ?? createInMemoryWorkbenchRepositories();
  const service = new DemoWorkbenchService({ repositories });

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
        return {
          kind: "empty",
          projects: currentProjects,
          tasks: currentTasks,
          skills: await loadSkillState(requestedProject?.id)
        };
      }

      const activeProjectId = taskProject?.id ?? requestedProjectId;
      const snapshotRef = await repositories.taskSnapshots.getByTaskId(task.id);
      const snapshot = snapshotRef
        ? await service.getSnapshotForRecords({
            projectId: snapshotRef.projectId,
            briefId: snapshotRef.briefId,
            pageVersionId: snapshotRef.pageVersionId
          })
        : undefined;
      return {
        kind: "task_ready",
        projects: currentProjects,
        tasks: currentTasks,
        skills: await loadSkillState(activeProjectId),
        activeTaskId: task.id,
        task: { ...task },
        messages: await listMessages(task.id),
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
    }
  };
}

function toSkillFlowError(error: unknown): SkillFlowErrorCode {
  const message = error instanceof Error ? error.message : "";
  if (
    message === "invalid_manifest_json" ||
    message === "manifest_validation_failed" ||
    message === "unsupported_skill_scope" ||
    message === "duplicate_skill_version" ||
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
