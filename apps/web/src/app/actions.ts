"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getWebWorkbenchStore,
  type MCPFlowErrorCode,
  type ModelFlowErrorCode,
  type ProjectFlowErrorCode,
  type SkillFlowErrorCode
} from "../lib/workbench-store";
import {
  getCurrentProjectId,
  setCurrentProjectId,
  setCurrentTaskId
} from "../lib/workbench-session";

function redirectWithError(error: ProjectFlowErrorCode): never {
  redirect(`/?error=${encodeURIComponent(error)}`);
}

function redirectToSkillsWithError(error: SkillFlowErrorCode): never {
  redirect(`/?view=skills&skillError=${encodeURIComponent(error)}`);
}

function redirectToModelsWithError(error: ModelFlowErrorCode): never {
  redirect(`/?view=models&modelError=${encodeURIComponent(error)}`);
}

function redirectToMCPWithError(error: MCPFlowErrorCode): never {
  redirect(`/?view=mcp&mcpError=${encodeURIComponent(error)}`);
}

function parseAgentRole(
  rawValue: FormDataEntryValue | null
): "planner" | "builder" | "reviewer" | "deployer" {
  const value = String(rawValue ?? "");
  if (value === "planner" || value === "builder" || value === "reviewer" || value === "deployer") {
    return value;
  }
  redirectToModelsWithError("model_role_unsupported");
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
  const store = getWebWorkbenchStore();
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

export async function submitPromptAction(formData: FormData): Promise<void> {
  const currentProjectId = await getCurrentProjectId();
  const store = getWebWorkbenchStore();
  const prompt = String(formData.get("prompt") ?? "");
  const implicitProjectName = String(
    formData.get("implicitProjectName") ?? "Untitled LP Project"
  );

  const result = await store.submitTaskPrompt({
    projectId: currentProjectId,
    prompt,
    implicitProjectName
  });
  if (!result.ok) {
    redirectWithError(result.error);
  }

  await setCurrentTaskId(result.taskId);
  if (result.projectId) {
    await setCurrentProjectId(result.projectId);
  }
  revalidatePath("/");
  redirect("/");
}

export async function createSkillDraftAction(formData: FormData): Promise<void> {
  const skillContent = await readSkillContent(formData);
  const result = await getWebWorkbenchStore().createSkillDraft({
    manifestJson: String(formData.get("manifestJson") ?? ""),
    content: skillContent.content,
    contentType: skillContent.contentType
  });
  if (!result.ok) {
    redirectToSkillsWithError(result.error);
  }
  revalidatePath("/");
  redirect("/?view=skills");
}

export async function validateSkillVersionAction(formData: FormData): Promise<void> {
  const result = await getWebWorkbenchStore().validateSkillVersion(
    String(formData.get("skillVersionId") ?? "")
  );
  if (!result.ok) {
    redirectToSkillsWithError(result.error);
  }
  revalidatePath("/");
  redirect("/?view=skills");
}

export async function publishSkillVersionAction(formData: FormData): Promise<void> {
  const result = await getWebWorkbenchStore().publishSkillVersion(
    String(formData.get("skillVersionId") ?? "")
  );
  if (!result.ok) {
    redirectToSkillsWithError(result.error);
  }
  revalidatePath("/");
  redirect("/?view=skills");
}

export async function bindSkillVersionAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const result = await getWebWorkbenchStore().bindSkillVersionToProject({
    projectId,
    skillVersionId: String(formData.get("skillVersionId") ?? "")
  });
  if (!result.ok) {
    redirectToSkillsWithError(result.error);
  }
  await setCurrentProjectId(projectId);
  revalidatePath("/");
  redirect("/?view=skills");
}

export async function setSkillBindingEnabledAction(formData: FormData): Promise<void> {
  const currentProjectId = await getCurrentProjectId();
  const projectId = currentProjectId ?? String(formData.get("projectId") ?? "");
  const result = await getWebWorkbenchStore().setProjectSkillBindingEnabled({
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
  redirect("/?view=skills");
}

export async function executeSkillCommandAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId) {
    redirectToSkillsWithError("project_not_found");
  }

  const pageVersionId = String(formData.get("pageVersionId") ?? "").trim();
  const result = await getWebWorkbenchStore().executeSkillCommand({
    projectId,
    skillVersionId: String(formData.get("skillVersionId") ?? "").trim(),
    commandId: String(formData.get("commandId") ?? "").trim(),
    ...(pageVersionId ? { pageVersionId } : {})
  });
  if (!result.ok) {
    redirectToSkillsWithError(result.error);
  }

  await setCurrentProjectId(projectId);
  revalidatePath("/");
  redirect("/?view=skills");
}

export async function createModelProviderAction(formData: FormData): Promise<void> {
  const currentProjectId = await getCurrentProjectId();
  const projectId = currentProjectId ?? String(formData.get("projectId") ?? "");
  if (!projectId) {
    redirectToModelsWithError("project_not_found");
  }
  const result = await getWebWorkbenchStore().createModelProvider({
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
  redirect("/?view=models");
}

export async function setModelProviderEnabledAction(formData: FormData): Promise<void> {
  const currentProjectId = await getCurrentProjectId();
  const projectId = currentProjectId ?? String(formData.get("projectId") ?? "");
  if (!projectId) {
    redirectToModelsWithError("project_not_found");
  }
  const result = await getWebWorkbenchStore().setModelProviderEnabled({
    projectId,
    providerId: String(formData.get("providerId") ?? ""),
    enabled: String(formData.get("enabled") ?? "false") === "true"
  });
  if (!result.ok) {
    redirectToModelsWithError(result.error);
  }
  await setCurrentProjectId(projectId);
  revalidatePath("/");
  redirect("/?view=models");
}

export async function upsertProjectModelRouteAction(formData: FormData): Promise<void> {
  const currentProjectId = await getCurrentProjectId();
  const projectId = currentProjectId ?? String(formData.get("projectId") ?? "");
  if (!projectId) {
    redirectToModelsWithError("project_not_found");
  }
  const role = parseAgentRole(formData.get("role"));
  const result = await getWebWorkbenchStore().upsertProjectModelRoute({
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
  redirect("/?view=models");
}

export async function createMCPConnectorAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId) {
    redirectToMCPWithError("project_not_found");
  }
  const result = await getWebWorkbenchStore().createMCPConnector({
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
  const result = await getWebWorkbenchStore().setMCPConnectorEnabled({
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
  const result = await getWebWorkbenchStore().setMCPToolApproval({
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
