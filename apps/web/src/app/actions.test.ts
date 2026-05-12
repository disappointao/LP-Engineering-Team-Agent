import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentProjectId: undefined as string | undefined,
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  createProject: vi.fn(),
  setCurrentProjectId: vi.fn(),
  setCurrentTaskId: vi.fn(),
  submitTaskPrompt: vi.fn()
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect
}));

vi.mock("../lib/workbench-session", () => ({
  getCurrentProjectId: vi.fn(async () => mocks.currentProjectId),
  setCurrentProjectId: mocks.setCurrentProjectId,
  setCurrentTaskId: mocks.setCurrentTaskId
}));

vi.mock("../lib/workbench-store", () => ({
  getWebWorkbenchStore: vi.fn(() => ({
    createProject: mocks.createProject,
    submitTaskPrompt: mocks.submitTaskPrompt
  }))
}));

import { createProjectAction, submitPromptAction } from "./actions";

function buildProjectForm(input: { projectName?: string } = {}): FormData {
  const formData = new FormData();
  formData.set("projectName", input.projectName ?? "Spring LP");
  return formData;
}

function buildPromptForm(input: {
  projectId?: string;
  prompt?: string;
  implicitProjectName?: string;
} = {}): FormData {
  const formData = new FormData();
  if (input.projectId !== undefined) {
    formData.set("projectId", input.projectId);
  }
  formData.set("prompt", input.prompt ?? "Build a spring landing page.");
  formData.set("implicitProjectName", input.implicitProjectName ?? "Untitled LP Project");
  return formData;
}

async function expectRedirect(promise: Promise<void>, url: string) {
  await expect(promise).rejects.toThrow(`NEXT_REDIRECT:${url}`);
  expect(mocks.redirect).toHaveBeenCalledWith(url);
}

describe("submitPromptAction", () => {
  beforeEach(() => {
    mocks.currentProjectId = "project_2";
    mocks.revalidatePath.mockClear();
    mocks.redirect.mockClear();
    mocks.createProject.mockReset();
    mocks.createProject.mockResolvedValue({ id: "project_3", name: "Spring LP", createdAt: "now" });
    mocks.setCurrentProjectId.mockClear();
    mocks.setCurrentTaskId.mockClear();
    mocks.submitTaskPrompt.mockReset();
    mocks.submitTaskPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_1",
      taskType: "lp_generation",
      projectId: "project_2"
    });
  });

  it("creates projects from the project name only", async () => {
    await expectRedirect(createProjectAction(buildProjectForm()), "/");

    expect(mocks.createProject).toHaveBeenCalledWith({
      name: "Spring LP"
    });
    expect(mocks.setCurrentProjectId).toHaveBeenCalledWith("project_3");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("uses the cookie project id when the hidden project id is mismatched", async () => {
    await expectRedirect(submitPromptAction(buildPromptForm({ projectId: "project_1" })), "/");

    expect(mocks.submitTaskPrompt).toHaveBeenCalledWith({
      projectId: "project_2",
      prompt: "Build a spring landing page.",
      implicitProjectName: "Untitled LP Project"
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it.each([
    ["matching", { projectId: "project_2" }],
    ["absent", {}]
  ])("uses the cookie project id when the hidden project id is %s", async (_label, input) => {
    await expectRedirect(submitPromptAction(buildPromptForm(input)), "/");

    expect(mocks.submitTaskPrompt).toHaveBeenCalledWith({
      projectId: "project_2",
      prompt: "Build a spring landing page.",
      implicitProjectName: "Untitled LP Project"
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("redirects with the store error when task submission fails", async () => {
    mocks.submitTaskPrompt.mockResolvedValue({
      ok: false,
      error: "prompt_required"
    });

    await expectRedirect(submitPromptAction(buildPromptForm({ prompt: "" })), "/?error=prompt_required");

    expect(mocks.setCurrentTaskId).not.toHaveBeenCalled();
    expect(mocks.setCurrentProjectId).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("submits a general task without a current project", async () => {
    mocks.currentProjectId = undefined;
    mocks.submitTaskPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_1",
      taskType: "general_chat",
      projectId: undefined
    });

    await expectRedirect(
      submitPromptAction(buildPromptForm({ prompt: "Help me write a campaign plan." })),
      "/"
    );

    expect(mocks.submitTaskPrompt).toHaveBeenCalledWith({
      projectId: undefined,
      prompt: "Help me write a campaign plan.",
      implicitProjectName: "Untitled LP Project"
    });
    expect(mocks.setCurrentTaskId).toHaveBeenCalledWith("task_1");
    expect(mocks.setCurrentProjectId).not.toHaveBeenCalled();
  });

  it("stores the implicit project id returned from an LP task", async () => {
    mocks.currentProjectId = undefined;
    mocks.submitTaskPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_2",
      taskType: "lp_generation",
      projectId: "project_1"
    });

    await expectRedirect(
      submitPromptAction(buildPromptForm({ prompt: "Create an ecommerce LP in HTML." })),
      "/"
    );

    expect(mocks.setCurrentTaskId).toHaveBeenCalledWith("task_2");
    expect(mocks.setCurrentProjectId).toHaveBeenCalledWith("project_1");
  });
});
