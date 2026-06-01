import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createProject,
  expectArtifactWorkspaceLayoutContract,
  expectDedicatedArtifactWorkspace,
  expectManagementLayoutContract,
  expectModelsManagementSurface,
  expectOnlyWorkbenchContentScrolls,
  expectSidebarBodyScrollsIndependently,
  expectSkillsManagementSurface,
  expectStaticLpArtifacts,
  expectWorkbenchLayoutContract,
  submitPrompt,
  writeJsonFileAtomic
} from "./helpers";

const e2eStateFile = resolve("test-results", "alpha-e2e-state", "workbench-state.json");

function seedScrollableSidebarFixture() {
  const state = JSON.parse(readFileSync(e2eStateFile, "utf8")) as {
    messages?: Array<Record<string, unknown>>;
    projects?: Array<Record<string, unknown>>;
    tasks?: Array<Record<string, unknown>>;
  };
  const projectId = "project_sidebar_scroll";
  const taskPrefix = "task_sidebar_scroll_";
  const createdAt = "2026-06-01T00:00:00.000Z";
  state.projects = (state.projects ?? []).filter((project) => project.id !== projectId);
  state.tasks = (state.tasks ?? []).filter(
    (task) => typeof task.id !== "string" || !task.id.startsWith(taskPrefix)
  );
  state.messages = (state.messages ?? []).filter(
    (message) => typeof message.taskId !== "string" || !message.taskId.startsWith(taskPrefix)
  );

  state.projects.push({
    id: projectId,
    name: "Sidebar scroll fixture",
    createdAt
  });
  for (let index = 0; index < 28; index += 1) {
    const taskId = `${taskPrefix}${index + 1}`;
    const title = `Sidebar scroll task ${String(index + 1).padStart(2, "0")}`;
    state.tasks.push({
      id: taskId,
      title,
      type: "general_chat",
      status: "complete",
      projectId,
      createdAt
    });
    state.messages.push({
      id: `message_${taskId}_user`,
      taskId,
      role: "user",
      content: title,
      createdAt
    });
    state.messages.push({
      id: `message_${taskId}_assistant`,
      taskId,
      role: "assistant",
      content: "Ready.",
      createdAt
    });
  }
  writeJsonFileAtomic(e2eStateFile, state);
  return {
    projectId,
    taskId: `${taskPrefix}1`
  };
}

test("keeps the empty workbench layout visually stable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "What can I help you build?" })).toBeVisible();
  await expectWorkbenchLayoutContract(page);

  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath("empty-workbench-layout.png")
  });
});

test("keeps the artifact workspace layout visually stable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  await submitPrompt(page, "Generate a compact browser visual regression LP");
  await expectStaticLpArtifacts(page);
  await expectDedicatedArtifactWorkspace(page);
  await expectArtifactWorkspaceLayoutContract(page);

  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath("artifact-workspace-layout.png")
  });

  await page.getByRole("link", { name: "Workbench", exact: true }).click();
  await expect(page.getByLabel("Generated files")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectOnlyWorkbenchContentScrolls(page);
  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath("artifact-workspace-mobile-scroll.png")
  });

  const sidebarFixture = seedScrollableSidebarFixture();
  await page.setViewportSize({ width: 1466, height: 900 });
  await page.goto(`/?projectId=${sidebarFixture.projectId}&taskId=${sidebarFixture.taskId}`);
  await expect(
    page.locator('a.taskItem[href$="taskId=task_sidebar_scroll_1"]')
  ).toBeVisible();
  await expectSidebarBodyScrollsIndependently(page);
  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath("artifact-workspace-desktop-sidebar-scroll.png")
  });
});

test("keeps the management surfaces visually stable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await createProject(page, "Stage 45 Visual Management");

  await expectSkillsManagementSurface(page);
  await expectManagementLayoutContract(page, "skills");
  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath("skills-management-layout.png")
  });

  await expectModelsManagementSurface(page);
  await expectManagementLayoutContract(page, "models");
  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath("models-management-layout.png")
  });
});
