import { expect, test } from "@playwright/test";
import { expectMCPManagementSurface, expectNoVisibleTextLeaks } from "./helpers";

test("shows alpha boundary views", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Project name").fill("E2E Alpha Project");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByText("E2E Alpha Project", { exact: true }).first()).toBeVisible();

  const navigation = page.getByRole("navigation", { name: "Main navigation" });

  await navigation.getByRole("link", { name: "Skills" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "Project skills" })
  ).toBeVisible();
  await expect(
    page.getByText(
      "Skill-only alpha: published and bound skills are the primary extension path for chat and LP tasks.",
      { exact: true }
    )
  ).toBeVisible();
  await expect(
    page.getByText(
      "Commands use approval, the local worker queue, and safe observations; they do not run arbitrary shell commands or real deployment.",
      { exact: true }
    )
  ).toBeVisible();

  await navigation.getByRole("link", { name: "Models" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "Project models" })
  ).toBeVisible();
  await expect(
    page.getByText(
      "Real providers are opt-in. Default alpha checks use deterministic routes and do not require API keys.",
      { exact: true }
    )
  ).toBeVisible();
  await expect(
    page.getByText(
      "If a provider or route is missing, the runtime fails closed instead of silently treating a real call as successful.",
      { exact: true }
    )
  ).toBeVisible();

  await expect(navigation.getByRole("link", { name: "MCP" })).toBeVisible();
  await expectMCPManagementSurface(page);

  await page.goto(
    "/?view=mcp&debug=MCP_BROWSER_SECRET&connectorJson=MCP_CONNECTOR_SECRET&toolArguments=MCP_TOOL_SECRET"
  );
  await expect(page).toHaveURL(/[?&]view=mcp(?:&|$)/);
  await expect(page.getByRole("heading", { exact: true, name: "Project MCP" })).toBeVisible();
  await expect(page.getByText("MCP runtime projection", { exact: true })).toBeVisible();
  await expect(page.getByText("Connector JSON", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What can I help you build?" })).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "MCP" })
  ).toBeVisible();
  await expectNoVisibleTextLeaks(page, [
    "MCP_BROWSER_SECRET",
    "MCP_CONNECTOR_SECRET",
    "MCP_TOOL_SECRET"
  ]);
});
