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
  submitTaskPrompt: vi.fn(),
  createSkillDraft: vi.fn(),
  validateSkillVersion: vi.fn(),
  publishSkillVersion: vi.fn(),
  bindSkillVersionToProject: vi.fn(),
  setProjectSkillBindingEnabled: vi.fn(),
  createModelProvider: vi.fn(),
  setModelProviderEnabled: vi.fn(),
  upsertProjectModelRoute: vi.fn()
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
    submitTaskPrompt: mocks.submitTaskPrompt,
    createSkillDraft: mocks.createSkillDraft,
    validateSkillVersion: mocks.validateSkillVersion,
    publishSkillVersion: mocks.publishSkillVersion,
    bindSkillVersionToProject: mocks.bindSkillVersionToProject,
    setProjectSkillBindingEnabled: mocks.setProjectSkillBindingEnabled,
    createModelProvider: mocks.createModelProvider,
    setModelProviderEnabled: mocks.setModelProviderEnabled,
    upsertProjectModelRoute: mocks.upsertProjectModelRoute
  }))
}));

import {
  bindSkillVersionAction,
  createModelProviderAction,
  createProjectAction,
  createSkillDraftAction,
  publishSkillVersionAction,
  setModelProviderEnabledAction,
  setSkillBindingEnabledAction,
  submitPromptAction,
  upsertProjectModelRouteAction,
  validateSkillVersionAction
} from "./actions";

function brandSkillManifestJson(): string {
  return JSON.stringify({
    id: "skill_brand",
    name: "Brand LP",
    version: "1.0.0",
    type: "template",
    scope: "project",
    description: "Brand LP sections.",
    permissions: ["brief:read", "artifact:write", "assets:read"],
    requiredSecrets: [],
    entrypoints: ["skills/brand.md"],
    reviewState: "published"
  });
}

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

function buildSkillForm(input: Record<string, string> = {}): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(input)) {
    formData.set(key, value);
  }
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
    mocks.createSkillDraft.mockReset();
    mocks.validateSkillVersion.mockReset();
    mocks.validateSkillVersion.mockResolvedValue({ ok: true, value: { id: "skill_version_1" } });
    mocks.publishSkillVersion.mockReset();
    mocks.publishSkillVersion.mockResolvedValue({ ok: true, value: { id: "skill_version_1" } });
    mocks.bindSkillVersionToProject.mockReset();
    mocks.bindSkillVersionToProject.mockResolvedValue({
      ok: true,
      value: { id: "skill_binding_1" }
    });
    mocks.setProjectSkillBindingEnabled.mockReset();
    mocks.setProjectSkillBindingEnabled.mockResolvedValue({
      ok: true,
      value: { id: "skill_binding_1" }
    });
    mocks.createModelProvider.mockReset();
    mocks.createModelProvider.mockResolvedValue({
      ok: true,
      value: { id: "provider_openai" }
    });
    mocks.setModelProviderEnabled.mockReset();
    mocks.setModelProviderEnabled.mockResolvedValue({
      ok: true,
      value: { id: "provider_openai" }
    });
    mocks.upsertProjectModelRoute.mockReset();
    mocks.upsertProjectModelRoute.mockResolvedValue({
      ok: true,
      value: { id: "model_route_1" }
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

  it("creates a skill draft and redirects to the skills view", async () => {
    mocks.createSkillDraft.mockResolvedValue({
      ok: true,
      value: {
        version: { id: "skill_version_1" }
      }
    });

    await expectRedirect(
      createSkillDraftAction(
        buildSkillForm({
          manifestJson: brandSkillManifestJson(),
          content: "# Brand LP",
          contentType: "text/markdown"
        })
      ),
      "/?view=skills"
    );

    expect(mocks.createSkillDraft).toHaveBeenCalledWith({
      manifestJson: brandSkillManifestJson(),
      content: "# Brand LP",
      contentType: "text/markdown"
    });
  });

  it("creates a skill draft from an uploaded markdown file", async () => {
    mocks.createSkillDraft.mockResolvedValue({
      ok: true,
      value: {
        version: { id: "skill_version_1" }
      }
    });
    const formData = buildSkillForm({
      manifestJson: brandSkillManifestJson(),
      content: "",
      contentType: "text/plain"
    });
    formData.set("contentFile", new File(["# Uploaded Brand LP"], "brand.md", {
      type: "text/markdown"
    }));

    await expectRedirect(createSkillDraftAction(formData), "/?view=skills");

    expect(mocks.createSkillDraft).toHaveBeenCalledWith({
      manifestJson: brandSkillManifestJson(),
      content: "# Uploaded Brand LP",
      contentType: "text/markdown"
    });
  });

  it("redirects skill errors with a stable query code", async () => {
    mocks.createSkillDraft.mockResolvedValue({
      ok: false,
      error: "invalid_manifest_json"
    });

    await expectRedirect(
      createSkillDraftAction(buildSkillForm({ manifestJson: "{", content: "# Brand LP" })),
      "/?view=skills&skillError=invalid_manifest_json"
    );
  });

  it("redirects invalid skill content types before calling the store", async () => {
    await expectRedirect(
      createSkillDraftAction(
        buildSkillForm({
          manifestJson: brandSkillManifestJson(),
          content: "# Brand LP",
          contentType: "application/json"
        })
      ),
      "/?view=skills&skillError=unsupported_content_type"
    );

    expect(mocks.createSkillDraft).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects unsupported uploaded skill files before calling the store", async () => {
    const formData = buildSkillForm({
      manifestJson: brandSkillManifestJson()
    });
    formData.set("contentFile", new File(["console.log('no');"], "skill.js", {
      type: "text/javascript"
    }));

    await expectRedirect(
      createSkillDraftAction(formData),
      "/?view=skills&skillError=unsupported_content_type"
    );

    expect(mocks.createSkillDraft).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects archive files renamed as markdown before calling the store", async () => {
    const formData = buildSkillForm({
      manifestJson: brandSkillManifestJson()
    });
    formData.set("contentFile", new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "skill.md", {
      type: "text/markdown"
    }));

    await expectRedirect(
      createSkillDraftAction(formData),
      "/?view=skills&skillError=unsupported_content_type"
    );

    expect(mocks.createSkillDraft).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects executable skill uploads before calling the store", async () => {
    const formData = buildSkillForm({
      manifestJson: brandSkillManifestJson()
    });
    formData.set("contentFile", new File(["#!/bin/sh\necho no"], "skill.txt", {
      type: "text/plain"
    }));

    await expectRedirect(
      createSkillDraftAction(formData),
      "/?view=skills&skillError=unsupported_content_type"
    );

    expect(mocks.createSkillDraft).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects oversized uploaded skill files before calling the store", async () => {
    const formData = buildSkillForm({
      manifestJson: brandSkillManifestJson()
    });
    formData.set("contentFile", new File(["a".repeat(200001)], "skill.md", {
      type: "text/markdown"
    }));

    await expectRedirect(
      createSkillDraftAction(formData),
      "/?view=skills&skillError=skill_content_too_large"
    );

    expect(mocks.createSkillDraft).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("validates a skill version and redirects to the skills view", async () => {
    await expectRedirect(
      validateSkillVersionAction(buildSkillForm({ skillVersionId: "skill_version_1" })),
      "/?view=skills"
    );

    expect(mocks.validateSkillVersion).toHaveBeenCalledWith("skill_version_1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("publishes a skill version and redirects to the skills view", async () => {
    await expectRedirect(
      publishSkillVersionAction(buildSkillForm({ skillVersionId: "skill_version_1" })),
      "/?view=skills"
    );

    expect(mocks.publishSkillVersion).toHaveBeenCalledWith("skill_version_1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("binds a skill version to a project and stores the current project", async () => {
    await expectRedirect(
      bindSkillVersionAction(
        buildSkillForm({
          projectId: "project_1",
          skillVersionId: "skill_version_1"
        })
      ),
      "/?view=skills"
    );

    expect(mocks.bindSkillVersionToProject).toHaveBeenCalledWith({
      projectId: "project_1",
      skillVersionId: "skill_version_1"
    });
    expect(mocks.setCurrentProjectId).toHaveBeenCalledWith("project_1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("redirects bind skill errors without changing project state", async () => {
    mocks.bindSkillVersionToProject.mockResolvedValue({
      ok: false,
      error: "skill_version_not_published"
    });

    await expectRedirect(
      bindSkillVersionAction(
        buildSkillForm({
          projectId: "project_1",
          skillVersionId: "skill_version_1"
        })
      ),
      "/?view=skills&skillError=skill_version_not_published"
    );

    expect(mocks.setCurrentProjectId).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("creates a model provider and redirects to the models view", async () => {
    mocks.currentProjectId = "project_1";
    mocks.createModelProvider.mockResolvedValue({
      ok: true,
      value: { id: "provider_openai" }
    });

    await expectRedirect(
      createModelProviderAction(
        buildSkillForm({
          providerId: "provider_openai",
          name: "OpenAI",
          provider: "openai",
          baseUrl: "https://api.openai.com/v1",
          secretEnvName: "OPENAI_API_KEY"
        })
      ),
      "/?view=models"
    );

    expect(mocks.createModelProvider).toHaveBeenCalledWith({
      projectId: "project_1",
      providerId: "provider_openai",
      name: "OpenAI",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      secretEnvName: "OPENAI_API_KEY"
    });
  });

  it("creates a model provider from a hidden project id when no project cookie exists", async () => {
    mocks.currentProjectId = undefined;
    mocks.createModelProvider.mockResolvedValue({
      ok: true,
      value: { id: "provider_openai" }
    });

    await expectRedirect(
      createModelProviderAction(
        buildSkillForm({
          projectId: "project_1",
          providerId: "provider_openai",
          name: "OpenAI",
          provider: "openai",
          baseUrl: "https://api.openai.com/v1",
          secretEnvName: "OPENAI_API_KEY"
        })
      ),
      "/?view=models"
    );

    expect(mocks.createModelProvider).toHaveBeenCalledWith({
      projectId: "project_1",
      providerId: "provider_openai",
      name: "OpenAI",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      secretEnvName: "OPENAI_API_KEY"
    });
    expect(mocks.setCurrentProjectId).toHaveBeenCalledWith("project_1");
  });

  it("sets a model provider enabled flag and redirects to the models view", async () => {
    mocks.currentProjectId = "project_1";
    mocks.setModelProviderEnabled.mockResolvedValue({
      ok: true,
      value: { id: "provider_openai" }
    });

    await expectRedirect(
      setModelProviderEnabledAction(
        buildSkillForm({
          providerId: "provider_openai",
          enabled: "true"
        })
      ),
      "/?view=models"
    );

    expect(mocks.setModelProviderEnabled).toHaveBeenCalledWith({
      projectId: "project_1",
      providerId: "provider_openai",
      enabled: true
    });
  });

  it("sets a model provider enabled flag from a hidden project id when no project cookie exists", async () => {
    mocks.currentProjectId = undefined;
    mocks.setModelProviderEnabled.mockResolvedValue({
      ok: true,
      value: { id: "provider_openai" }
    });

    await expectRedirect(
      setModelProviderEnabledAction(
        buildSkillForm({
          projectId: "project_1",
          providerId: "provider_openai",
          enabled: "false"
        })
      ),
      "/?view=models"
    );

    expect(mocks.setModelProviderEnabled).toHaveBeenCalledWith({
      projectId: "project_1",
      providerId: "provider_openai",
      enabled: false
    });
    expect(mocks.setCurrentProjectId).toHaveBeenCalledWith("project_1");
  });

  it("upserts a model route and redirects to the models view", async () => {
    mocks.currentProjectId = "project_1";
    mocks.upsertProjectModelRoute.mockResolvedValue({
      ok: true,
      value: { id: "model_route_1" }
    });

    await expectRedirect(
      upsertProjectModelRouteAction(
        buildSkillForm({
          role: "builder",
          providerId: "provider_openai",
          model: "gpt-5.4"
        })
      ),
      "/?view=models"
    );

    expect(mocks.upsertProjectModelRoute).toHaveBeenCalledWith({
      projectId: "project_1",
      role: "builder",
      providerId: "provider_openai",
      model: "gpt-5.4"
    });
  });

  it("upserts a model route from a hidden project id when no project cookie exists", async () => {
    mocks.currentProjectId = undefined;
    mocks.upsertProjectModelRoute.mockResolvedValue({
      ok: true,
      value: { id: "model_route_1" }
    });

    await expectRedirect(
      upsertProjectModelRouteAction(
        buildSkillForm({
          projectId: "project_1",
          role: "builder",
          providerId: "provider_openai",
          model: "gpt-5.4"
        })
      ),
      "/?view=models"
    );

    expect(mocks.upsertProjectModelRoute).toHaveBeenCalledWith({
      projectId: "project_1",
      role: "builder",
      providerId: "provider_openai",
      model: "gpt-5.4"
    });
    expect(mocks.setCurrentProjectId).toHaveBeenCalledWith("project_1");
  });

  it("redirects invalid model roles before calling the store", async () => {
    mocks.currentProjectId = "project_1";

    await expectRedirect(
      upsertProjectModelRouteAction(
        buildSkillForm({
          role: "writer",
          providerId: "provider_openai",
          model: "gpt-5.4"
        })
      ),
      "/?view=models&modelError=model_role_unsupported"
    );

    expect(mocks.upsertProjectModelRoute).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["true", true],
    ["false", false]
  ])("sets a skill binding enabled=%s and redirects to the skills view", async (rawValue, enabled) => {
    await expectRedirect(
      setSkillBindingEnabledAction(
        buildSkillForm({
          bindingId: "skill_binding_1",
          enabled: rawValue
        })
      ),
      "/?view=skills"
    );

    expect(mocks.setProjectSkillBindingEnabled).toHaveBeenCalledWith({
      projectId: "project_2",
      bindingId: "skill_binding_1",
      enabled
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });
});
