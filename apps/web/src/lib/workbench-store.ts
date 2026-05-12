import {
  createDemoWorkbenchService,
  type ProjectRecord,
  type WorkbenchSnapshot
} from "@lp-agent/api";

export type ProjectFlowErrorCode =
  | "project_name_required"
  | "repository_required"
  | "prompt_required"
  | "project_not_found"
  | "generation_failed";

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProjectFlowErrorCode };

export interface CreateProjectFormInput {
  name: string;
  repository: string;
}

export type SubmitPromptResult =
  | { ok: true }
  | { ok: false; error: ProjectFlowErrorCode };

export type WorkbenchPageState =
  | {
      kind: "no_project";
      projects: ProjectRecord[];
    }
  | {
      kind: "project_ready";
      projects: ProjectRecord[];
      activeProjectId: string;
      snapshot: WorkbenchSnapshot;
    };

export interface WebWorkbenchStore {
  createProject(input: CreateProjectFormInput): Promise<ProjectRecord>;
  listProjects(): ProjectRecord[];
  getPageState(projectId?: string | null): Promise<WorkbenchPageState>;
  submitPrompt(input: { projectId: string; prompt: string }): Promise<SubmitPromptResult>;
}

export function validateProjectInput(input: CreateProjectFormInput): ValidationResult<CreateProjectFormInput> {
  const name = input.name.trim();
  const repository = input.repository.trim();

  if (name.length === 0) {
    return { ok: false, error: "project_name_required" };
  }
  if (repository.length === 0) {
    return { ok: false, error: "repository_required" };
  }

  return {
    ok: true,
    value: {
      name,
      repository
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

export function createWebWorkbenchStore(): WebWorkbenchStore {
  const service = createDemoWorkbenchService();
  const projects = new Map<string, ProjectRecord>();
  const projectOrder: string[] = [];

  const listProjects = () =>
    projectOrder
      .map((projectId) => projects.get(projectId))
      .filter((project): project is ProjectRecord => Boolean(project))
      .map((project) => ({ ...project }));

  return {
    async createProject(input) {
      const validation = validateProjectInput(input);
      if (!validation.ok) {
        throw new Error(validation.error);
      }

      const project = await service.createProject(validation.value);
      projects.set(project.id, project);
      projectOrder.push(project.id);
      return { ...project };
    },

    listProjects,

    async getPageState(projectId) {
      const currentProjects = listProjects();
      if (!projectId || !projects.has(projectId)) {
        return {
          kind: "no_project",
          projects: currentProjects
        };
      }

      const snapshot = await service.getSnapshot(projectId);
      return {
        kind: "project_ready",
        projects: currentProjects,
        activeProjectId: projectId,
        snapshot
      };
    },

    async submitPrompt(input) {
      const prompt = validatePromptInput(input.prompt);
      if (!prompt.ok) {
        return { ok: false, error: prompt.error };
      }

      if (!projects.has(input.projectId)) {
        return { ok: false, error: "project_not_found" };
      }

      try {
        const brief = await service.createBriefFromPrompt({
          projectId: input.projectId,
          prompt: prompt.value
        });
        const pageVersion = await service.generatePageVersion({
          projectId: input.projectId,
          briefId: brief.id
        });
        const reviewed = await service.reviewPageVersion({
          projectId: input.projectId,
          pageVersionId: pageVersion.id
        });
        await service.approveAndCreateDeployment({
          projectId: input.projectId,
          pageVersionId: reviewed.id,
          reviewerUserId: "local_web_user"
        });
        return { ok: true };
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
