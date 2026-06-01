import { expect, test } from "@playwright/test";
import {
  createProject,
  expectArtifactWorkspaceLayoutContract,
  expectDedicatedArtifactWorkspace,
  expectManagementLayoutContract,
  expectModelsManagementSurface,
  expectOnlyWorkbenchContentScrolls,
  expectSkillsManagementSurface,
  expectStaticLpArtifacts,
  expectWorkbenchLayoutContract,
  submitPrompt
} from "./helpers";

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
