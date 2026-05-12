"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getWebWorkbenchStore, type ProjectFlowErrorCode } from "../lib/workbench-store";
import { setCurrentProjectId } from "../lib/workbench-session";

function redirectWithError(error: ProjectFlowErrorCode): never {
  redirect(`/?error=${encodeURIComponent(error)}`);
}

export async function createProjectAction(formData: FormData): Promise<void> {
  const store = getWebWorkbenchStore();
  const name = String(formData.get("projectName") ?? "");
  const repository = String(formData.get("repository") ?? "");

  try {
    const project = await store.createProject({ name, repository });
    await setCurrentProjectId(project.id);
    revalidatePath("/");
  } catch (error) {
    const message = error instanceof Error ? error.message : "generation_failed";
    if (
      message === "project_name_required" ||
      message === "repository_required"
    ) {
      redirectWithError(message);
    }
    redirectWithError("generation_failed");
  }

  redirect("/");
}

export async function submitPromptAction(formData: FormData): Promise<void> {
  const store = getWebWorkbenchStore();
  const projectId = String(formData.get("projectId") ?? "");
  const prompt = String(formData.get("prompt") ?? "");

  const result = await store.submitPrompt({ projectId, prompt });
  if (!result.ok) {
    redirectWithError(result.error);
  }

  revalidatePath("/");
  redirect("/");
}
