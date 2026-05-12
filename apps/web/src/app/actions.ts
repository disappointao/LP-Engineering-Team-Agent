"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getWebWorkbenchStore, type ProjectFlowErrorCode } from "../lib/workbench-store";
import {
  getCurrentProjectId,
  setCurrentProjectId,
  setCurrentTaskId
} from "../lib/workbench-session";

function redirectWithError(error: ProjectFlowErrorCode): never {
  redirect(`/?error=${encodeURIComponent(error)}`);
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
