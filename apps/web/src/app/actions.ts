"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getWebWorkbenchStore,
  type InterruptFlowErrorCode,
  type MCPFlowErrorCode,
  type ModelFlowErrorCode,
  type ProjectFlowErrorCode,
  type RunRecoveryFlowErrorCode,
  type SkillCommandFlowErrorCode,
  type SkillCommandQueueFlowErrorCode,
  type SkillFlowErrorCode,
  type WorkerQueueFlowErrorCode
} from "../lib/workbench-store";
import {
  clearCurrentTaskId,
  getCurrentTaskId,
  getCurrentProjectId,
  setCurrentProjectId,
  setCurrentTaskId
} from "../lib/workbench-session";
import type {
  ModelManagementNotice,
  SkillManagementNotice
} from "./skills-models-management-view-model";

function redirectWithError(error: ProjectFlowErrorCode): never {
  redirect(`/?error=${encodeURIComponent(error)}`);
}

function redirectToInterruptError(error: InterruptFlowErrorCode): never {
  redirect(`/?interruptError=${encodeURIComponent(error)}`);
}

function redirectToRecoveryError(error: RunRecoveryFlowErrorCode): never {
  redirect(`/?recoveryError=${encodeURIComponent(error)}`);
}

function redirectToSkillsWithError(
  error: SkillFlowErrorCode | SkillCommandFlowErrorCode | SkillCommandQueueFlowErrorCode
): never {
  redirect(`/?view=skills&skillError=${encodeURIComponent(error)}`);
}

function redirectToSkillsWithWorkerError(error: WorkerQueueFlowErrorCode): never {
  redirect(`/?view=skills&workerError=${encodeURIComponent(error)}`);
}

function redirectToModelsWithError(error: ModelFlowErrorCode): never {
  redirect(`/?view=models&modelError=${encodeURIComponent(error)}`);
}

function redirectToSkillsWithNotice(notice: SkillManagementNotice): never {
  redirect(`/?view=skills&skillNotice=${encodeURIComponent(notice)}`);
}

function redirectToModelsWithNotice(notice: ModelManagementNotice): never {
  redirect(`/?view=models&modelNotice=${encodeURIComponent(notice)}`);
}

function redirectToMCPWithError(error: MCPFlowErrorCode): never {
  redirect(`/?view=mcp&mcpError=${encodeURIComponent(error)}`);
}

function parseAgentRole(
  rawValue: FormDataEntryValue | null
): "assistant" | "planner" | "builder" | "reviewer" | "deployer" {
  const value = String(rawValue ?? "");
  if (
    value === "assistant" ||
    value === "planner" ||
    value === "builder" ||
    value === "reviewer" ||
    value === "deployer"
  ) {
    return value;
  }
  redirectToModelsWithError("model_role_unsupported");
}

function parseRunRecoveryAction(
  rawValue: FormDataEntryValue | null
): "resume_worker_finalization" | "retry_run" {
  const value = String(rawValue ?? "");
  if (value === "resume_worker_finalization" || value === "retry_run") {
    return value;
  }
  redirectToRecoveryError("recovery_action_not_available");
}

const maxSkillContentBytes = 200000;
const binarySignatures = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
  [0x1f, 0x8b],
  [0x7f, 0x45, 0x4c, 0x46],
  [0x4d, 0x5a],
  [0xca, 0xfe, 0xba, 0xbe],
  [0xfe, 0xed, 0xfa, 0xce],
  [0xfe, 0xed, 0xfa, 0xcf],
  [0xcf, 0xfa, 0xed, 0xfe],
  [0xce, 0xfa, 0xed, 0xfe],
  [0x52, 0x61, 0x72, 0x21],
  [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]
];

function parseSkillContentType(rawValue: FormDataEntryValue | null): "text/markdown" | "text/plain" {
  const value = String(rawValue ?? "text/markdown");
  if (value === "text/markdown" || value === "text/plain") {
    return value;
  }
  redirectToSkillsWithError("unsupported_content_type");
}

function isUploadedSkillFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    "size" in value &&
    "text" in value &&
    typeof value.text === "function" &&
    value.size > 0
  );
}

function inferUploadedSkillContentType(file: File): "text/markdown" | "text/plain" {
  const name = file.name.toLowerCase();
  const mediaType = file.type.toLowerCase();
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";

  if (extension === ".md" || extension === ".markdown") {
    return "text/markdown";
  }
  if (extension === ".txt") {
    return "text/plain";
  }
  if (extension.length > 0) {
    redirectToSkillsWithError("unsupported_content_type");
  }
  if (mediaType === "text/markdown" || mediaType === "text/x-markdown") {
    return "text/markdown";
  }
  if (mediaType === "text/plain") {
    return "text/plain";
  }
  redirectToSkillsWithError("unsupported_content_type");
}

function hasSignature(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function isProbablyBinary(bytes: Uint8Array): boolean {
  const sample = bytes.slice(0, Math.min(bytes.length, 4096));
  if (binarySignatures.some((signature) => hasSignature(sample, signature))) {
    return true;
  }
  return sample.some((byte) => byte === 0);
}

function decodeSkillText(bytes: Uint8Array): string {
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
    if (/^#!.*\b(?:sh|bash|zsh|python|python3|node|deno|ruby|perl|php)\b/.test(firstLine)) {
      redirectToSkillsWithError("unsupported_content_type");
    }
    return content;
  } catch {
    redirectToSkillsWithError("unsupported_content_type");
  }
}

async function readSkillContent(formData: FormData): Promise<{
  content: string;
  contentType: "text/markdown" | "text/plain";
}> {
  const uploadedFile = formData.get("contentFile");
  if (isUploadedSkillFile(uploadedFile)) {
    if (uploadedFile.size > maxSkillContentBytes) {
      redirectToSkillsWithError("skill_content_too_large");
    }
    const contentType = inferUploadedSkillContentType(uploadedFile);
    const bytes = new Uint8Array(await uploadedFile.arrayBuffer());
    if (isProbablyBinary(bytes)) {
      redirectToSkillsWithError("unsupported_content_type");
    }
    return {
      content: decodeSkillText(bytes),
      contentType
    };
  }

  return {
    content: String(formData.get("content") ?? ""),
    contentType: parseSkillContentType(formData.get("contentType"))
  };
}

export async function createProjectAction(formData: FormData): Promise<void> {
  const store = await getWebWorkbenchStore();
  const name = String(formData.get("projectName") ?? "");

  try {
    const project = await store.createProject({ name });
    await setCurrentProjectId(project.id);
    revalidatePath("/");
  } catch (error) {
    const message = error instanceof Error ? error.message : "generation_failed";
    if (message === "project_name_required") {
      redirectWithError(message);
    }
    redirectWithError("generation_failed");
  }

  redirect("/");
}

export async function startNewTaskAction(_formData?: FormData): Promise<void> {
  await clearCurrentTaskId();
  revalidatePath("/");
  redirect("/");
}

export async function selectProjectAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (projectId.length === 0) {
    redirectWithError("project_not_found");
  }

  const store = await getWebWorkbenchStore();
  const pageState = await store.getPageState({ projectId });
  const selectedProject = pageState.projects.find((project) => project.id === projectId);
  if (!selectedProject) {
    redirectWithError("project_not_found");
  }

  await setCurrentProjectId(selectedProject.id);
  await clearCurrentTaskId();
  revalidatePath("/");
  redirect("/");
}

export async function selectTaskAction(formData: FormData): Promise<void> {
  const taskId = String(formData.get("taskId") ?? "").trim();
  if (taskId.length === 0) {
    redirectWithError("project_not_found");
  }

  const store = await getWebWorkbenchStore();
  const pageState = await store.getPageState({ taskId });
  if (pageState.kind !== "task_ready" || pageState.task.id !== taskId) {
    redirectWithError("project_not_found");
  }

  await setCurrentTaskId(pageState.task.id);
  if (pageState.task.projectId) {
    await setCurrentProjectId(pageState.task.projectId);
  }
  revalidatePath("/");
  redirect("/");
}

export async function submitPromptAction(formData: FormData): Promise<void> {
  const currentProjectId = await getCurrentProjectId();
  const currentTaskId = await getCurrentTaskId();
  const store = await getWebWorkbenchStore();
  const prompt = String(formData.get("prompt") ?? "");
  const formProjectId = String(formData.get("projectId") ?? "").trim();
  const formTaskId = String(formData.get("taskId") ?? "").trim();
  const implicitProjectName = String(
    formData.get("implicitProjectName") ?? "Untitled LP Project"
  );

  const result = await store.submitTaskPrompt({
    taskId: formTaskId || currentTaskId,
    projectId: formProjectId || currentProjectId,
    prompt,
    implicitProjectName
  });
  if (!result.ok) {
    if (result.taskId) {
      await setCurrentTaskId(result.taskId);
    }
    if (result.projectId) {
      await setCurrentProjectId(result.projectId);
    }
    redirectWithError(result.error);
  }

  await setCurrentTaskId(result.taskId);
  if (result.projectId) {
    await setCurrentProjectId(result.projectId);
  }
  revalidatePath("/");
  redirect("/");
}

export async function interruptCurrentTaskAction(_formData?: FormData): Promise<void> {
  const currentTaskId = await getCurrentTaskId();
  if (!currentTaskId) {
    redirectToInterruptError("task_not_found");
  }

  const store = await getWebWorkbenchStore();
  const result = await store.interruptCurrentTask({
    taskId: currentTaskId,
    reason: "User interrupted the task."
  });
  if (!result.ok) {
    redirectToInterruptError(result.error);
  }

  revalidatePath("/");
  redirect("/");
}

export async function executeRunRecoveryAction(formData: FormData): Promise<void> {
  const taskId = String(formData.get("taskId") ?? "").trim();
  const runId = String(formData.get("runId") ?? "").trim();
  const action = parseRunRecoveryAction(formData.get("action"));
  const store = await getWebWorkbenchStore();
  const result = await store.executeRunRecoveryAction({ taskId, runId, action });
  if (!result.ok) {
    redirectToRecoveryError(result.error);
  }

  revalidatePath("/");
  redirect("/");
}

export async function createSkillDraftAction(formData: FormData): Promise<void> {
  const skillContent = await readSkillContent(formData);
  const store = await getWebWorkbenchStore();
  const result = await store.createSkillDraft({
    manifestJson: String(formData.get("manifestJson") ?? ""),
    content: skillContent.content,
    contentType: skillContent.contentType
  });
  if (!result.ok) {
    redirectToSkillsWithError(result.error);
  }
  revalidatePath("/");
  redirectToSkillsWithNotice("draft_created");
}

export async function validateSkillVersionAction(formData: FormData): Promise<void> {
  const store = await getWebWorkbenchStore();
  const result = await store.validateSkillVersion(
    String(formData.get("skillVersionId") ?? "")
  );
  if (!result.ok) {
    redirectToSkillsWithError(result.error);
  }
  revalidatePath("/");
  redirectToSkillsWithNotice("validated");
}

export async function publishSkillVersionAction(formData: FormData): Promise<void> {
  const store = await getWebWorkbenchStore();
  const result = await store.publishSkillVersion(
    String(formData.get("skillVersionId") ?? "")
  );
  if (!result.ok) {
    redirectToSkillsWithError(result.error);
  }
  revalidatePath("/");
  redirectToSkillsWithNotice("published");
}

export async function bindSkillVersionAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const store = await getWebWorkbenchStore();
  const result = await store.bindSkillVersionToProject({
    projectId,
    skillVersionId: String(formData.get("skillVersionId") ?? "")
  });
  if (!result.ok) {
    redirectToSkillsWithError(result.error);
  }
  await setCurrentProjectId(projectId);
  revalidatePath("/");
  redirectToSkillsWithNotice("bound");
}

export async function setSkillBindingEnabledAction(formData: FormData): Promise<void> {
  const currentProjectId = await getCurrentProjectId();
  const projectId = currentProjectId ?? String(formData.get("projectId") ?? "");
  const store = await getWebWorkbenchStore();
  const result = await store.setProjectSkillBindingEnabled({
    projectId,
    bindingId: String(formData.get("bindingId") ?? ""),
    enabled: String(formData.get("enabled") ?? "false") === "true"
  });
  if (!result.ok) {
    redirectToSkillsWithError(result.error);
  }
  if (projectId) {
    await setCurrentProjectId(projectId);
  }
  revalidatePath("/");
  redirectToSkillsWithNotice(result.value.enabled ? "enabled" : "disabled");
}

export async function executeSkillCommandAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId) {
    redirectToSkillsWithError("project_not_found");
  }

  const pageVersionId = String(formData.get("pageVersionId") ?? "").trim();
  const taskId = String(formData.get("taskId") ?? "").trim();
  const store = await getWebWorkbenchStore();
  const result = await store.executeSkillCommand({
    projectId,
    skillVersionId: String(formData.get("skillVersionId") ?? "").trim(),
    commandId: String(formData.get("commandId") ?? "").trim(),
    ...(pageVersionId ? { pageVersionId } : {}),
    ...(taskId ? { taskId } : {})
  });
  if (!result.ok) {
    redirectToSkillsWithError(result.error);
  }

  await setCurrentProjectId(projectId);
  revalidatePath("/");
  redirectToSkillsWithNotice("command_queued");
}

export async function runLocalWorkerOnceAction(formData: FormData): Promise<void> {
  const currentProjectId = (await getCurrentProjectId())?.trim();
  const projectId = currentProjectId || String(formData.get("projectId") ?? "").trim();
  const store = await getWebWorkbenchStore();
  const result = await store.runLocalWorkerOnce(projectId ? { projectId } : {});
  if (!result.ok) {
    redirectToSkillsWithWorkerError(result.error);
  }
  if (projectId) {
    await setCurrentProjectId(projectId);
  }
  revalidatePath("/");
  redirectToSkillsWithNotice("worker_ran");
}

export async function createModelProviderAction(formData: FormData): Promise<void> {
  const currentProjectId = await getCurrentProjectId();
  const projectId = currentProjectId ?? String(formData.get("projectId") ?? "");
  if (!projectId) {
    redirectToModelsWithError("project_not_found");
  }
  const store = await getWebWorkbenchStore();
  const result = await store.createModelProvider({
    projectId,
    providerId: String(formData.get("providerId") ?? ""),
    name: String(formData.get("name") ?? ""),
    provider: String(formData.get("provider") ?? ""),
    api: String(formData.get("api") ?? ""),
    baseUrl: String(formData.get("baseUrl") ?? ""),
    apiKeyEnv: String(formData.get("apiKeyEnv") ?? ""),
    secretEnvName: String(formData.get("secretEnvName") ?? ""),
    modelId: String(formData.get("modelId") ?? "")
  });
  if (!result.ok) {
    redirectToModelsWithError(result.error);
  }
  await setCurrentProjectId(projectId);
  revalidatePath("/");
  redirectToModelsWithNotice("provider_created");
}

export async function setModelProviderEnabledAction(formData: FormData): Promise<void> {
  const currentProjectId = await getCurrentProjectId();
  const projectId = currentProjectId ?? String(formData.get("projectId") ?? "");
  if (!projectId) {
    redirectToModelsWithError("project_not_found");
  }
  const store = await getWebWorkbenchStore();
  const result = await store.setModelProviderEnabled({
    projectId,
    providerId: String(formData.get("providerId") ?? ""),
    enabled: String(formData.get("enabled") ?? "false") === "true"
  });
  if (!result.ok) {
    redirectToModelsWithError(result.error);
  }
  await setCurrentProjectId(projectId);
  revalidatePath("/");
  redirectToModelsWithNotice(result.value.enabled ? "provider_enabled" : "provider_disabled");
}

export async function upsertProjectModelRouteAction(formData: FormData): Promise<void> {
  const currentProjectId = await getCurrentProjectId();
  const projectId = currentProjectId ?? String(formData.get("projectId") ?? "");
  if (!projectId) {
    redirectToModelsWithError("project_not_found");
  }
  const role = parseAgentRole(formData.get("role"));
  const store = await getWebWorkbenchStore();
  const result = await store.upsertProjectModelRoute({
    projectId,
    role,
    providerId: String(formData.get("providerId") ?? ""),
    model: String(formData.get("model") ?? "")
  });
  if (!result.ok) {
    redirectToModelsWithError(result.error);
  }
  await setCurrentProjectId(projectId);
  revalidatePath("/");
  redirectToModelsWithNotice("route_saved");
}

export async function createMCPConnectorAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId) {
    redirectToMCPWithError("project_not_found");
  }
  const store = await getWebWorkbenchStore();
  const result = await store.createMCPConnector({
    projectId,
    definitionJson: String(formData.get("definitionJson") ?? "")
  });
  if (!result.ok) {
    redirectToMCPWithError(result.error);
  }
  await setCurrentProjectId(projectId);
  revalidatePath("/");
  redirect("/?view=mcp");
}

export async function setMCPConnectorEnabledAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId) {
    redirectToMCPWithError("project_not_found");
  }
  const store = await getWebWorkbenchStore();
  const result = await store.setMCPConnectorEnabled({
    projectId,
    connectorId: String(formData.get("connectorId") ?? ""),
    enabled: String(formData.get("enabled") ?? "false") === "true"
  });
  if (!result.ok) {
    redirectToMCPWithError(result.error);
  }
  await setCurrentProjectId(projectId);
  revalidatePath("/");
  redirect("/?view=mcp");
}

export async function setMCPToolApprovalAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId) {
    redirectToMCPWithError("project_not_found");
  }
  const store = await getWebWorkbenchStore();
  const result = await store.setMCPToolApproval({
    projectId,
    connectorId: String(formData.get("connectorId") ?? ""),
    toolName: String(formData.get("toolName") ?? ""),
    approved: String(formData.get("approved") ?? "false") === "true"
  });
  if (!result.ok) {
    redirectToMCPWithError(result.error);
  }
  await setCurrentProjectId(projectId);
  revalidatePath("/");
  redirect("/?view=mcp");
}

export async function executeMCPToolAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId) {
    redirectToMCPWithError("project_not_found");
  }
  const store = await getWebWorkbenchStore();
  const result = await store.executeMCPTool({
    projectId,
    connectorId: String(formData.get("connectorId") ?? ""),
    toolName: String(formData.get("toolName") ?? ""),
    role: String(formData.get("role") ?? ""),
    argumentsJson: "{}"
  });
  if (!result.ok) {
    redirectToMCPWithError(result.error);
  }
  await setCurrentProjectId(projectId);
  revalidatePath("/");
  redirect("/?view=mcp");
}
