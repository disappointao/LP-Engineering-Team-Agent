"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getWebWorkbenchStore,
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

const maxSkillContentBytes = 200000;

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
    return {
      content: await uploadedFile.text(),
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
