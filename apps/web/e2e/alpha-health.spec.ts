import { expect, test } from "@playwright/test";

test("loads the Skill-only alpha workbench shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "What can I help you build?" })).toBeVisible();

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Workbench" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Skills" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Models" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "MCP" })).toBeVisible();
});
