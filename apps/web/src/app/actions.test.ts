import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentProjectId: undefined as string | undefined,
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  createProject: vi.fn(),
  setCurrentProjectId: vi.fn(),
  submitPrompt: vi.fn()
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect
}));

vi.mock("../lib/workbench-session", () => ({
  getCurrentProjectId: vi.fn(async () => mocks.currentProjectId),
  setCurrentProjectId: mocks.setCurrentProjectId
}));

vi.mock("../lib/workbench-store", () => ({
  getWebWorkbenchStore: vi.fn(() => ({
    createProject: mocks.createProject,
    submitPrompt: mocks.submitPrompt
  }))
}));

import { createProjectAction, submitPromptAction } from "./actions";

function buildProjectForm(input: { projectName?: string } = {}): FormData {
  const formData = new FormData();
  formData.set("projectName", input.projectName ?? "Spring LP");
  return formData;
}

function buildPromptForm(input: { projectId?: string; prompt?: string } = {}): FormData {
  const formData = new FormData();
  if (input.projectId !== undefined) {
    formData.set("projectId", input.projectId);
  }
  formData.set("prompt", input.prompt ?? "Build a spring landing page.");
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
    mocks.submitPrompt.mockReset();
    mocks.submitPrompt.mockResolvedValue({ ok: true });
  });

  it("creates projects from the project name only", async () => {
    await expectRedirect(createProjectAction(buildProjectForm()), "/");

    expect(mocks.createProject).toHaveBeenCalledWith({
      name: "Spring LP"
    });
    expect(mocks.setCurrentProjectId).toHaveBeenCalledWith("project_3");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("rejects a mismatched hidden project id without submitting a prompt", async () => {
    await expectRedirect(
      submitPromptAction(buildPromptForm({ projectId: "project_1" })),
      "/?error=project_not_found"
    );

    expect(mocks.submitPrompt).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["matching", { projectId: "project_2" }],
    ["absent", {}]
  ])("uses the cookie project id when the hidden project id is %s", async (_label, input) => {
    await expectRedirect(submitPromptAction(buildPromptForm(input)), "/");

    expect(mocks.submitPrompt).toHaveBeenCalledWith({
      projectId: "project_2",
      prompt: "Build a spring landing page."
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("rejects submission when there is no cookie-backed current project id", async () => {
    mocks.currentProjectId = undefined;

    await expectRedirect(
      submitPromptAction(buildPromptForm({ projectId: "project_2" })),
      "/?error=project_not_found"
    );

    expect(mocks.submitPrompt).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
