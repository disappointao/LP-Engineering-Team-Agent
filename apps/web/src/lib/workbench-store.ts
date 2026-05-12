import {
  createDemoWorkbenchService,
  type ProjectRecord,
  type WorkbenchSnapshot
} from "@lp-agent/api";

export type ProjectFlowErrorCode =
  | "project_name_required"
  | "prompt_required"
  | "project_not_found"
  | "generation_failed";

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProjectFlowErrorCode };

export interface CreateProjectFormInput {
  name: string;
}

export type TaskType = "general_chat" | "lp_generation" | "project_setup";
export type TaskStatus = "complete";
export type ChatMessageRole = "user" | "assistant";

export interface TaskRecord {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  projectId?: string;
  createdAt: string;
}

export interface ChatMessageRecord {
  id: string;
  taskId: string;
  role: ChatMessageRole;
  content: string;
  createdAt: string;
}

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
    }
  | {
      kind: "task_ready";
      projects: ProjectRecord[];
      tasks: TaskRecord[];
      activeTaskId: string;
      task: TaskRecord;
      messages: ChatMessageRecord[];
      snapshot?: WorkbenchSnapshot;
    };

export interface WebWorkbenchStore {
  createProject(input: CreateProjectFormInput): Promise<ProjectRecord>;
  listProjects(): ProjectRecord[];
  listTasks(): TaskRecord[];
  getPageState(input?: {
    projectId?: string | null;
    taskId?: string | null;
  }): Promise<WorkbenchPageState>;
  submitTaskPrompt(input: {
    projectId?: string | null;
    prompt: string;
    implicitProjectName: string;
  }): Promise<SubmitTaskResult>;
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
  "lp",
  "landing page",
  "落地页",
  "页面",
  "html",
  "官网",
  "活动页",
  "电商"
];

const projectKeywords = ["创建项目", "new project", "project"];

export function classifyTaskPrompt(prompt: string): TaskType {
  const normalized = prompt.trim().toLowerCase();
  if (normalized.length === 0) {
    return "general_chat";
  }

  if (projectKeywords.some((keyword) => normalized.includes(keyword))) {
    return "project_setup";
  }

  if (lpKeywords.some((keyword) => normalized.includes(keyword))) {
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
  return title.length > 0 ? title : fallback;
}

export function createWebWorkbenchStore(): WebWorkbenchStore {
  const service = createDemoWorkbenchService();
  const projects = new Map<string, ProjectRecord>();
  const projectOrder: string[] = [];
  const tasks = new Map<string, TaskRecord>();
  const taskOrder: string[] = [];
  const messages = new Map<string, ChatMessageRecord[]>();
  let nextTaskNumber = 1;
  let nextMessageNumber = 1;

  const listProjects = () =>
    projectOrder
      .map((projectId) => projects.get(projectId))
      .filter((project): project is ProjectRecord => Boolean(project))
      .map((project) => ({ ...project }));

  const listTasks = () =>
    taskOrder
      .map((taskId) => tasks.get(taskId))
      .filter((task): task is TaskRecord => Boolean(task))
      .map((task) => ({ ...task }));

  const listMessages = (taskId: string) =>
    (messages.get(taskId) ?? []).map((message) => ({ ...message }));

  const saveProject = (project: ProjectRecord) => {
    projects.set(project.id, project);
    projectOrder.push(project.id);
  };

  const saveTask = (input: {
    title: string;
    type: TaskType;
    projectId?: string;
  }): TaskRecord => {
    const task: TaskRecord = {
      id: `task_${nextTaskNumber++}`,
      title: input.title,
      type: input.type,
      status: "complete",
      projectId: input.projectId,
      createdAt: new Date().toISOString()
    };
    tasks.set(task.id, task);
    taskOrder.push(task.id);
    return task;
  };

  const saveMessage = (input: {
    taskId: string;
    role: ChatMessageRole;
    content: string;
  }) => {
    const message: ChatMessageRecord = {
      id: `message_${nextMessageNumber++}`,
      taskId: input.taskId,
      role: input.role,
      content: input.content,
      createdAt: new Date().toISOString()
    };
    messages.set(input.taskId, [...(messages.get(input.taskId) ?? []), message]);
    return message;
  };

  return {
    async createProject(input) {
      const validation = validateProjectInput(input);
      if (!validation.ok) {
        throw new Error(validation.error);
      }

      const project = await service.createProject(validation.value);
      saveProject(project);
      return { ...project };
    },

    listProjects,
    listTasks,

    async getPageState(input) {
      const currentProjects = listProjects();
      const currentTasks = listTasks();
      const taskId = input?.taskId ?? null;
      const task = taskId ? tasks.get(taskId) : undefined;
      const projectId = input?.projectId ?? task?.projectId ?? null;

      if (!task || (projectId && !projects.has(projectId))) {
        return {
          kind: "empty",
          projects: currentProjects,
          tasks: currentTasks
        };
      }

      const snapshot = task.projectId ? await service.getSnapshot(task.projectId) : undefined;
      return {
        kind: "task_ready",
        projects: currentProjects,
        tasks: currentTasks,
        activeTaskId: task.id,
        task: { ...task },
        messages: listMessages(task.id),
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
      if (requestedProjectId && !projects.has(requestedProjectId)) {
        return { ok: false, error: "project_not_found" };
      }

      try {
        let projectId = requestedProjectId;

        if (!projectId && taskType !== "general_chat") {
          const project = await service.createProject({
            name: deriveImplicitProjectName(prompt.value, input.implicitProjectName)
          });
          saveProject(project);
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
          await service.reviewPageVersion({
            projectId,
            pageVersionId: pageVersion.id
          });
        }

        const task = saveTask({
          title: deriveTaskTitle(prompt.value),
          type: taskType,
          projectId
        });
        saveMessage({
          taskId: task.id,
          role: "user",
          content: prompt.value
        });
        saveMessage({
          taskId: task.id,
          role: "assistant",
          content:
            taskType === "lp_generation"
              ? "LP artifacts are ready for review."
              : "I created a task thread and can continue from here."
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
    }
  };
}

const globalStore = globalThis as typeof globalThis & {
  __lpAgentWebWorkbenchStore?: WebWorkbenchStore;
};

export function getWebWorkbenchStore(): WebWorkbenchStore {
  globalStore.__lpAgentWebWorkbenchStore ??= createWebWorkbenchStore();
  return globalStore.__lpAgentWebWorkbenchStore;
}
