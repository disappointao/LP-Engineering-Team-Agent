import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentProjectId: undefined as string | undefined,
  currentTaskId: undefined as string | undefined,
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  getWebWorkbenchStore: vi.fn(),
  createProject: vi.fn(),
  setCurrentProjectId: vi.fn(),
  setCurrentTaskId: vi.fn(),
  submitTaskPrompt: vi.fn(),
  interruptCurrentTask: vi.fn(),
  createSkillDraft: vi.fn(),
  validateSkillVersion: vi.fn(),
  publishSkillVersion: vi.fn(),
  bindSkillVersionToProject: vi.fn(),
  setProjectSkillBindingEnabled: vi.fn(),
  executeSkillCommand: vi.fn(),
  runLocalWorkerOnce: vi.fn(),
  createModelProvider: vi.fn(),
  setModelProviderEnabled: vi.fn(),
  upsertProjectModelRoute: vi.fn(),
  createMCPConnector: vi.fn(),
  setMCPConnectorEnabled: vi.fn(),
  setMCPToolApproval: vi.fn(),
  executeMCPTool: vi.fn(),
  executeRunRecoveryAction: vi.fn()
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect
}));

vi.mock("../lib/workbench-session", () => ({
  getCurrentProjectId: vi.fn(async () => mocks.currentProjectId),
  getCurrentTaskId: vi.fn(async () => mocks.currentTaskId),
  setCurrentProjectId: mocks.setCurrentProjectId,
  setCurrentTaskId: mocks.setCurrentTaskId
}));

vi.mock("../lib/workbench-store", () => ({
  getWebWorkbenchStore: mocks.getWebWorkbenchStore
}));

import {
  bindSkillVersionAction,
  createMCPConnectorAction,
  createModelProviderAction,
  createProjectAction,
  createSkillDraftAction,
  executeMCPToolAction,
  executeRunRecoveryAction,
  executeSkillCommandAction,
  interruptCurrentTaskAction,
  publishSkillVersionAction,
  runLocalWorkerOnceAction,
  setMCPConnectorEnabledAction,
  setMCPToolApprovalAction,
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

function buildSkillCommandForm(input: Record<string, string> = {}): FormData {
  const formData = new FormData();
  formData.set("projectId", input.projectId ?? "project_2");
  formData.set("skillVersionId", input.skillVersionId ?? "skill_version_1");
  formData.set("commandId", input.commandId ?? "publish_static");
  formData.set("pageVersionId", input.pageVersionId ?? "version_1");
  if (input.taskId !== undefined) {
    formData.set("taskId", input.taskId);
  }
  return formData;
}

function buildRecoveryForm(input: {
  taskId?: string;
  runId?: string;
  action?: string;
} = {}): FormData {
  const formData = new FormData();
  formData.set("taskId", input.taskId ?? "task_1");
  formData.set("runId", input.runId ?? "run_planner_failed");
  formData.set("action", input.action ?? "retry_run");
  return formData;
}

async function expectRedirect(promise: Promise<void>, url: string) {
  await expect(promise).rejects.toThrow(`NEXT_REDIRECT:${url}`);
  expect(mocks.redirect).toHaveBeenCalledWith(url);
}

describe("submitPromptAction", () => {
  beforeEach(() => {
    mocks.currentProjectId = "project_2";
    mocks.currentTaskId = "task_1";
    mocks.revalidatePath.mockClear();
    mocks.redirect.mockClear();
    mocks.getWebWorkbenchStore.mockReset();
    mocks.getWebWorkbenchStore.mockResolvedValue({
      createProject: mocks.createProject,
      submitTaskPrompt: mocks.submitTaskPrompt,
      interruptCurrentTask: mocks.interruptCurrentTask,
      createSkillDraft: mocks.createSkillDraft,
      validateSkillVersion: mocks.validateSkillVersion,
      publishSkillVersion: mocks.publishSkillVersion,
      bindSkillVersionToProject: mocks.bindSkillVersionToProject,
      setProjectSkillBindingEnabled: mocks.setProjectSkillBindingEnabled,
      executeSkillCommand: mocks.executeSkillCommand,
      runLocalWorkerOnce: mocks.runLocalWorkerOnce,
      createModelProvider: mocks.createModelProvider,
      setModelProviderEnabled: mocks.setModelProviderEnabled,
      upsertProjectModelRoute: mocks.upsertProjectModelRoute,
      createMCPConnector: mocks.createMCPConnector,
      setMCPConnectorEnabled: mocks.setMCPConnectorEnabled,
      setMCPToolApproval: mocks.setMCPToolApproval,
      executeMCPTool: mocks.executeMCPTool,
      executeRunRecoveryAction: mocks.executeRunRecoveryAction
    });
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
    mocks.interruptCurrentTask.mockReset();
    mocks.interruptCurrentTask.mockResolvedValue({
      ok: true,
      taskId: "task_1",
      state: "interrupt_requested"
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
    mocks.executeSkillCommand.mockReset();
    mocks.executeSkillCommand.mockResolvedValue({
      ok: true,
      value: {
        run: { id: "run_skill_command_1" },
        observation: { id: "tool_observation_1" }
      }
    });
    mocks.runLocalWorkerOnce.mockReset();
    mocks.runLocalWorkerOnce.mockResolvedValue({
      ok: true,
      state: "idle"
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
    mocks.createMCPConnector.mockReset();
    mocks.createMCPConnector.mockResolvedValue({
      ok: true,
      value: { id: "connector_assets" }
    });
    mocks.setMCPConnectorEnabled.mockReset();
    mocks.setMCPConnectorEnabled.mockResolvedValue({
      ok: true,
      value: { id: "connector_assets" }
    });
    mocks.setMCPToolApproval.mockReset();
    mocks.setMCPToolApproval.mockResolvedValue({
      ok: true,
      value: { id: "mcp_approval_1" }
    });
    mocks.executeMCPTool.mockReset();
    mocks.executeMCPTool.mockResolvedValue({
      ok: true,
      value: {
        run: { id: "run_mcp_tool_1" },
        observation: { id: "tool_observation_1" }
      }
    });
    mocks.executeRunRecoveryAction.mockReset();
    mocks.executeRunRecoveryAction.mockResolvedValue({
      ok: true,
      value: {
        action: "retry_run",
        runId: "run_planner_failed",
        newRunId: "run_planner_failed_retry_1",
        state: "completed"
      }
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
      taskId: "task_1",
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
      taskId: "task_1",
      projectId: "project_2",
      prompt: "Build a spring landing page.",
      implicitProjectName: "Untitled LP Project"
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("passes current task id to submitTaskPrompt", async () => {
    mocks.currentProjectId = "project_1";
    mocks.currentTaskId = "task_1";
    mocks.submitTaskPrompt.mockResolvedValue({
      ok: true,
      taskId: "task_1",
      taskType: "lp_generation",
      projectId: "project_1"
    });

    await expectRedirect(
      submitPromptAction(buildPromptForm({ prompt: "Make the CTA stronger" })),
      "/"
    );

    expect(mocks.submitTaskPrompt).toHaveBeenCalledWith({
      taskId: "task_1",
      projectId: "project_1",
      prompt: "Make the CTA stronger",
      implicitProjectName: "Untitled LP Project"
    });
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

  it("keeps the failed LP task selected when generation fails after task creation", async () => {
    mocks.currentProjectId = undefined;
    mocks.getWebWorkbenchStore.mockResolvedValue({
      submitTaskPrompt: vi.fn().mockResolvedValue({
        ok: false,
        error: "generation_failed",
        taskId: "task_1",
        taskType: "lp_generation",
        projectId: "project_1"
      })
    });

    await expectRedirect(
      submitPromptAction(buildPromptForm({ prompt: "Create an ecommerce LP in HTML." })),
      "/?error=generation_failed"
    );

    expect(mocks.setCurrentTaskId).toHaveBeenCalledWith("task_1");
    expect(mocks.setCurrentProjectId).toHaveBeenCalledWith("project_1");
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
      taskId: "task_1",
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

  it("interrupts the current task from the session cookie", async () => {
    const formData = new FormData();
    formData.set("workerJobId", "worker_job_from_client");

    await expectRedirect(interruptCurrentTaskAction(formData), "/");

    expect(mocks.interruptCurrentTask).toHaveBeenCalledWith({
      taskId: "task_1",
      reason: "User interrupted the task."
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("redirects interrupt requests without a current task", async () => {
    mocks.currentTaskId = undefined;

    await expectRedirect(
      interruptCurrentTaskAction(new FormData()),
      "/?interruptError=task_not_found"
    );

    expect(mocks.interruptCurrentTask).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("redirects interrupt store errors with a bounded query code", async () => {
    mocks.interruptCurrentTask.mockResolvedValue({
      ok: false,
      error: "interrupt_failed"
    });

    await expectRedirect(
      interruptCurrentTaskAction(new FormData()),
      "/?interruptError=interrupt_failed"
    );

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("executes a run recovery action and revalidates the workbench", async () => {
    mocks.executeRunRecoveryAction.mockResolvedValue({
      ok: true,
      value: {
        action: "retry_run",
        runId: "run_planner_failed",
        newRunId: "run_planner_failed_retry_1",
        state: "completed"
      }
    });

    await expectRedirect(executeRunRecoveryAction(buildRecoveryForm()), "/");

    expect(mocks.executeRunRecoveryAction).toHaveBeenCalledWith({
      taskId: "task_1",
      runId: "run_planner_failed",
      action: "retry_run"
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("executes resume worker finalization recovery actions", async () => {
    mocks.executeRunRecoveryAction.mockResolvedValue({
      ok: true,
      value: {
        action: "resume_worker_finalization",
        runId: "run_deployer_failed",
        state: "completed"
      }
    });

    await expectRedirect(
      executeRunRecoveryAction(
        buildRecoveryForm({
          runId: "run_deployer_failed",
          action: "resume_worker_finalization"
        })
      ),
      "/"
    );

    expect(mocks.executeRunRecoveryAction).toHaveBeenCalledWith({
      taskId: "task_1",
      runId: "run_deployer_failed",
      action: "resume_worker_finalization"
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("redirects recovery action failures with safe error codes", async () => {
    mocks.executeRunRecoveryAction.mockResolvedValue({
      ok: false,
      error: "retry_input_not_reconstructable"
    });

    await expectRedirect(
      executeRunRecoveryAction(buildRecoveryForm()),
      "/?recoveryError=retry_input_not_reconstructable"
    );

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("redirects unsupported recovery actions before calling the store", async () => {
    await expectRedirect(
      executeRunRecoveryAction(buildRecoveryForm({ action: "request_approval" })),
      "/?recoveryError=recovery_action_not_available"
    );

    expect(mocks.executeRunRecoveryAction).not.toHaveBeenCalled();
    expect(mocks.getWebWorkbenchStore).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
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

  it("executes a skill command with local one-shot approval", async () => {
    mocks.executeSkillCommand.mockResolvedValue({
      ok: true,
      value: {
        run: { id: "run_skill_command_1" },
        observation: { id: "tool_observation_1" }
      }
    });

    await expectRedirect(executeSkillCommandAction(buildSkillCommandForm()), "/?view=skills");

    expect(mocks.executeSkillCommand).toHaveBeenCalledWith({
      projectId: "project_2",
      skillVersionId: "skill_version_1",
      commandId: "publish_static",
      pageVersionId: "version_1"
    });
    expect(mocks.setCurrentProjectId).toHaveBeenCalledWith("project_2");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("omits blank page version ids when executing skill commands", async () => {
    mocks.executeSkillCommand.mockResolvedValue({
      ok: true,
      value: {
        run: { id: "run_skill_command_1" },
        observation: { id: "tool_observation_1" }
      }
    });

    await expectRedirect(
      executeSkillCommandAction(buildSkillCommandForm({ pageVersionId: "" })),
      "/?view=skills"
    );

    expect(mocks.executeSkillCommand).toHaveBeenCalledWith({
      projectId: "project_2",
      skillVersionId: "skill_version_1",
      commandId: "publish_static"
    });
  });

  it("passes nonblank task ids when executing skill commands", async () => {
    mocks.executeSkillCommand.mockResolvedValue({
      ok: true,
      value: {
        run: { id: "run_skill_command_1" },
        observation: { id: "tool_observation_1" }
      }
    });

    await expectRedirect(
      executeSkillCommandAction(buildSkillCommandForm({ taskId: " task_1 " })),
      "/?view=skills"
    );

    expect(mocks.executeSkillCommand).toHaveBeenCalledWith({
      projectId: "project_2",
      skillVersionId: "skill_version_1",
      commandId: "publish_static",
      pageVersionId: "version_1",
      taskId: "task_1"
    });
  });

  it("omits blank task ids when executing skill commands", async () => {
    mocks.executeSkillCommand.mockResolvedValue({
      ok: true,
      value: {
        run: { id: "run_skill_command_1" },
        observation: { id: "tool_observation_1" }
      }
    });

    await expectRedirect(
      executeSkillCommandAction(buildSkillCommandForm({ taskId: "   " })),
      "/?view=skills"
    );

    expect(mocks.executeSkillCommand).toHaveBeenCalledWith({
      projectId: "project_2",
      skillVersionId: "skill_version_1",
      commandId: "publish_static",
      pageVersionId: "version_1"
    });
  });

  it("ignores submitted approval user ids when executing skill commands", async () => {
    const formData = buildSkillCommandForm({
      skillVersionId: " skill_version_1 ",
      commandId: " publish_static "
    });
    formData.set("approvedByUserId", "attacker");

    await expectRedirect(executeSkillCommandAction(formData), "/?view=skills");

    expect(mocks.executeSkillCommand).toHaveBeenCalledWith({
      projectId: "project_2",
      skillVersionId: "skill_version_1",
      commandId: "publish_static",
      pageVersionId: "version_1"
    });
  });

  it("redirects blank skill command project ids without calling the store", async () => {
    await expectRedirect(
      executeSkillCommandAction(buildSkillCommandForm({ projectId: "   " })),
      "/?view=skills&skillError=project_not_found"
    );

    expect(mocks.executeSkillCommand).not.toHaveBeenCalled();
    expect(mocks.setCurrentProjectId).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("redirects skill command actions with stable command errors", async () => {
    mocks.executeSkillCommand.mockResolvedValue({
      ok: false,
      error: "skill_command_not_bound"
    });

    await expectRedirect(
      executeSkillCommandAction(buildSkillCommandForm()),
      "/?view=skills&skillError=skill_command_not_bound"
    );
  });

  it("runs one local worker pass and redirects to skills", async () => {
    mocks.currentProjectId = "project_1";
    mocks.runLocalWorkerOnce.mockResolvedValue({
      ok: true,
      state: "completed",
      workerJobId: "worker_job_1",
      runId: "run_skill_command_1"
    });

    const formData = new FormData();
    formData.set("projectId", "project_1");

    await expectRedirect(runLocalWorkerOnceAction(formData), "/?view=skills");

    expect(mocks.runLocalWorkerOnce).toHaveBeenCalledWith({ projectId: "project_1" });
  });

  it("uses the cookie project id when local worker hidden project id is mismatched", async () => {
    mocks.currentProjectId = "project_2";
    mocks.runLocalWorkerOnce.mockResolvedValue({
      ok: true,
      state: "completed",
      workerJobId: "worker_job_1",
      runId: "run_skill_command_1"
    });
    const formData = new FormData();
    formData.set("projectId", "project_1");

    await expectRedirect(runLocalWorkerOnceAction(formData), "/?view=skills");

    expect(mocks.runLocalWorkerOnce).toHaveBeenCalledWith({ projectId: "project_2" });
  });

  it("redirects local worker errors with stable codes", async () => {
    mocks.currentProjectId = "project_1";
    mocks.runLocalWorkerOnce.mockResolvedValue({
      ok: false,
      error: "worker_runtime_not_configured"
    });
    const formData = new FormData();
    formData.set("projectId", "project_1");

    await expectRedirect(
      runLocalWorkerOnceAction(formData),
      "/?view=skills&workerError=worker_runtime_not_configured"
    );
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
      api: "",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "",
      secretEnvName: "OPENAI_API_KEY",
      modelId: ""
    });
  });

  it("passes provider-neutral protocol fields when creating a model provider", async () => {
    mocks.currentProjectId = "project_1";
    mocks.createModelProvider.mockResolvedValue({
      ok: true,
      value: { id: "zhipu" }
    });

    await expectRedirect(
      createModelProviderAction(
        buildSkillForm({
          providerId: "zhipu",
          name: "智谱 GLM",
          provider: "custom",
          api: "anthropic-messages",
          baseUrl: "https://open.bigmodel.cn/api/anthropic",
          apiKeyEnv: "ANTHROPIC_API_KEY",
          modelId: "glm-5.1"
        })
      ),
      "/?view=models"
    );

    expect(mocks.createModelProvider).toHaveBeenCalledWith({
      projectId: "project_1",
      providerId: "zhipu",
      name: "智谱 GLM",
      provider: "custom",
      api: "anthropic-messages",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      secretEnvName: "",
      modelId: "glm-5.1"
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
      api: "",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "",
      secretEnvName: "OPENAI_API_KEY",
      modelId: ""
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

  it("upserts an assistant model route", async () => {
    mocks.currentProjectId = undefined;
    const formData = new FormData();
    formData.set("projectId", "project_1");
    formData.set("role", "assistant");
    formData.set("providerId", "provider_openai");
    formData.set("model", "gpt-5.4");

    await expectRedirect(upsertProjectModelRouteAction(formData), "/?view=models");

    expect(mocks.upsertProjectModelRoute).toHaveBeenCalledWith({
      projectId: "project_1",
      role: "assistant",
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

  it("redirects mcp connector creation errors to the mcp view", async () => {
    mocks.currentProjectId = undefined;
    mocks.createMCPConnector.mockResolvedValue({
      ok: false,
      error: "project_not_found"
    });
    const formData = new FormData();
    formData.set("projectId", "missing_project");
    formData.set("definitionJson", "{");

    await expectRedirect(
      createMCPConnectorAction(formData),
      "/?view=mcp&mcpError=project_not_found"
    );

    expect(mocks.createMCPConnector).toHaveBeenCalledWith({
      projectId: "missing_project",
      definitionJson: "{"
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("creates an mcp connector and redirects to the mcp view", async () => {
    mocks.currentProjectId = "project_1";
    const formData = new FormData();
    formData.set("projectId", "project_1");
    formData.set("definitionJson", JSON.stringify({
      id: "connector_assets",
      name: "Assets",
      tools: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["builder"],
          requiresApproval: false
        }
      ]
    }));

    await expectRedirect(createMCPConnectorAction(formData), "/?view=mcp");

    expect(mocks.createMCPConnector).toHaveBeenCalledWith({
      projectId: "project_1",
      definitionJson: String(formData.get("definitionJson"))
    });
    expect(mocks.setCurrentProjectId).toHaveBeenCalledWith("project_1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("does not create an mcp connector from a stale cookie when form project id is missing", async () => {
    mocks.currentProjectId = "project_2";
    const formData = new FormData();
    formData.set("definitionJson", JSON.stringify({
      id: "connector_assets",
      name: "Assets",
      tools: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["builder"],
          requiresApproval: false
        }
      ]
    }));

    await expectRedirect(
      createMCPConnectorAction(formData),
      "/?view=mcp&mcpError=project_not_found"
    );

    expect(mocks.createMCPConnector).not.toHaveBeenCalled();
    expect(mocks.setCurrentProjectId).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("creates an mcp connector from a hidden project id when no project cookie exists", async () => {
    mocks.currentProjectId = undefined;
    const formData = new FormData();
    formData.set("projectId", "project_1");
    formData.set("definitionJson", JSON.stringify({
      id: "connector_assets",
      name: "Assets",
      tools: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["builder"],
          requiresApproval: false
        }
      ]
    }));

    await expectRedirect(createMCPConnectorAction(formData), "/?view=mcp");

    expect(mocks.createMCPConnector).toHaveBeenCalledWith({
      projectId: "project_1",
      definitionJson: String(formData.get("definitionJson"))
    });
    expect(mocks.setCurrentProjectId).toHaveBeenCalledWith("project_1");
  });

  it("creates an mcp connector for the form project when the cookie differs", async () => {
    mocks.currentProjectId = "project_2";
    const formData = new FormData();
    formData.set("projectId", "project_1");
    formData.set("definitionJson", JSON.stringify({
      id: "connector_assets",
      name: "Assets",
      tools: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["builder"],
          requiresApproval: false
        }
      ]
    }));

    await expectRedirect(createMCPConnectorAction(formData), "/?view=mcp");

    expect(mocks.createMCPConnector).toHaveBeenCalledWith({
      projectId: "project_1",
      definitionJson: String(formData.get("definitionJson"))
    });
    expect(mocks.createMCPConnector).not.toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project_2" })
    );
    expect(mocks.setCurrentProjectId).toHaveBeenCalledWith("project_1");
  });

  it("sets an mcp connector enabled flag and redirects to the mcp view", async () => {
    mocks.currentProjectId = "project_1";

    await expectRedirect(
      setMCPConnectorEnabledAction(
        buildSkillForm({
          projectId: "project_1",
          connectorId: "connector_assets",
          enabled: "false"
        })
      ),
      "/?view=mcp"
    );

    expect(mocks.setMCPConnectorEnabled).toHaveBeenCalledWith({
      projectId: "project_1",
      connectorId: "connector_assets",
      enabled: false
    });
  });

  it("does not set an mcp connector enabled flag from a stale cookie when form project id is missing", async () => {
    mocks.currentProjectId = "project_2";

    await expectRedirect(
      setMCPConnectorEnabledAction(
        buildSkillForm({
          connectorId: "connector_assets",
          enabled: "false"
        })
      ),
      "/?view=mcp&mcpError=project_not_found"
    );

    expect(mocks.setMCPConnectorEnabled).not.toHaveBeenCalled();
    expect(mocks.setCurrentProjectId).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("sets an mcp connector enabled flag from a hidden project id when no project cookie exists", async () => {
    mocks.currentProjectId = undefined;

    await expectRedirect(
      setMCPConnectorEnabledAction(
        buildSkillForm({
          projectId: "project_1",
          connectorId: "connector_assets",
          enabled: "true"
        })
      ),
      "/?view=mcp"
    );

    expect(mocks.setMCPConnectorEnabled).toHaveBeenCalledWith({
      projectId: "project_1",
      connectorId: "connector_assets",
      enabled: true
    });
    expect(mocks.setCurrentProjectId).toHaveBeenCalledWith("project_1");
  });

  it("sets an mcp connector enabled flag for the form project when the cookie differs", async () => {
    mocks.currentProjectId = "project_2";

    await expectRedirect(
      setMCPConnectorEnabledAction(
        buildSkillForm({
          projectId: "project_1",
          connectorId: "connector_assets",
          enabled: "false"
        })
      ),
      "/?view=mcp"
    );

    expect(mocks.setMCPConnectorEnabled).toHaveBeenCalledWith({
      projectId: "project_1",
      connectorId: "connector_assets",
      enabled: false
    });
    expect(mocks.setMCPConnectorEnabled).not.toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project_2" })
    );
    expect(mocks.setCurrentProjectId).toHaveBeenCalledWith("project_1");
  });

  it("sets an mcp tool approval and redirects to the mcp view", async () => {
    mocks.currentProjectId = "project_1";
    const formData = buildSkillForm({
      projectId: "project_1",
      connectorId: "connector_assets",
      toolName: "searchAssets",
      approved: "true"
    });
    formData.set("approvedByUserId", "attacker");

    await expectRedirect(setMCPToolApprovalAction(formData), "/?view=mcp");

    expect(mocks.setMCPToolApproval).toHaveBeenCalledWith({
      projectId: "project_1",
      connectorId: "connector_assets",
      toolName: "searchAssets",
      approved: true
    });
  });

  it("does not set an mcp tool approval from a stale cookie when form project id is missing", async () => {
    mocks.currentProjectId = "project_2";

    await expectRedirect(
      setMCPToolApprovalAction(
        buildSkillForm({
          connectorId: "connector_assets",
          toolName: "searchAssets",
          approved: "true"
        })
      ),
      "/?view=mcp&mcpError=project_not_found"
    );

    expect(mocks.setMCPToolApproval).not.toHaveBeenCalled();
    expect(mocks.setCurrentProjectId).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("sets an mcp tool approval from a hidden project id when no project cookie exists", async () => {
    mocks.currentProjectId = undefined;

    await expectRedirect(
      setMCPToolApprovalAction(
        buildSkillForm({
          projectId: "project_1",
          connectorId: "connector_assets",
          toolName: "searchAssets",
          approved: "true"
        })
      ),
      "/?view=mcp"
    );

    expect(mocks.setMCPToolApproval).toHaveBeenCalledWith({
      projectId: "project_1",
      connectorId: "connector_assets",
      toolName: "searchAssets",
      approved: true
    });
    expect(mocks.setCurrentProjectId).toHaveBeenCalledWith("project_1");
  });

  it("sets an mcp tool approval for the form project when the cookie differs", async () => {
    mocks.currentProjectId = "project_2";

    await expectRedirect(
      setMCPToolApprovalAction(
        buildSkillForm({
          projectId: "project_1",
          connectorId: "connector_assets",
          toolName: "searchAssets",
          approved: "true"
        })
      ),
      "/?view=mcp"
    );

    expect(mocks.setMCPToolApproval).toHaveBeenCalledWith({
      projectId: "project_1",
      connectorId: "connector_assets",
      toolName: "searchAssets",
      approved: true
    });
    expect(mocks.setMCPToolApproval).not.toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project_2" })
    );
    expect(mocks.setCurrentProjectId).toHaveBeenCalledWith("project_1");
  });

  it("executes MCP tools from form data", async () => {
    mocks.executeMCPTool.mockResolvedValue({
      ok: true,
      value: {
        run: { id: "run_mcp_tool_1" },
        observation: { id: "tool_observation_1" }
      }
    });
    const formData = new FormData();
    formData.set("projectId", "project_1");
    formData.set("connectorId", "connector_assets");
    formData.set("toolName", "searchAssets");
    formData.set("role", "builder");
    formData.set("argumentsJson", "{\"query\":\"SECRET_PRODUCT\"}");

    await expectRedirect(executeMCPToolAction(formData), "/?view=mcp");

    expect(mocks.executeMCPTool).toHaveBeenCalledWith({
      projectId: "project_1",
      connectorId: "connector_assets",
      toolName: "searchAssets",
      role: "builder",
      argumentsJson: "{\"query\":\"SECRET_PRODUCT\"}"
    });
    expect(mocks.setCurrentProjectId).toHaveBeenCalledWith("project_1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("redirects MCP tool execution errors to the mcp view", async () => {
    mocks.executeMCPTool.mockResolvedValue({
      ok: false,
      error: "mcp_tool_arguments_invalid"
    });
    const formData = new FormData();
    formData.set("projectId", "project_1");
    formData.set("connectorId", "connector_assets");
    formData.set("toolName", "searchAssets");
    formData.set("role", "builder");
    formData.set("argumentsJson", "{\"query\":");

    await expectRedirect(
      executeMCPToolAction(formData),
      "/?view=mcp&mcpError=mcp_tool_arguments_invalid"
    );

    expect(mocks.executeMCPTool).toHaveBeenCalledWith({
      projectId: "project_1",
      connectorId: "connector_assets",
      toolName: "searchAssets",
      role: "builder",
      argumentsJson: "{\"query\":"
    });
    expect(mocks.setCurrentProjectId).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
