import { cookies } from "next/headers";

export const CURRENT_PROJECT_COOKIE = "lp-agent-current-project";

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
