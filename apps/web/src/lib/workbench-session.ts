import { cookies } from "next/headers";

export const CURRENT_PROJECT_COOKIE = "lp-agent-current-project";
export const CURRENT_TASK_COOKIE = "lp-agent-current-task";

export async function getCurrentProjectId(): Promise<string | undefined> {
  const cookieStore = await cookies();
  const value = cookieStore.get(CURRENT_PROJECT_COOKIE)?.value.trim();
  return value && value.length > 0 ? value : undefined;
}

export async function setCurrentProjectId(projectId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(CURRENT_PROJECT_COOKIE, projectId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/"
  });
}

export async function getCurrentTaskId(): Promise<string | undefined> {
  const cookieStore = await cookies();
  const value = cookieStore.get(CURRENT_TASK_COOKIE)?.value.trim();
  return value && value.length > 0 ? value : undefined;
}

export async function setCurrentTaskId(taskId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(CURRENT_TASK_COOKIE, taskId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/"
  });
}
