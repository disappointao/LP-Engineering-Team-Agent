import { expect, test } from "@playwright/test";
import { createProject } from "./helpers";

test("shows model provider fail-closed errors without leaking query details", async ({ page }) => {
  await createProject(page, "E2E Model Failure Project");

  await page.goto("/?view=models&modelError=model_provider_not_found&debug=OPENAI_API_KEY");

  await expect(
    page.getByRole("heading", { exact: true, name: "Project models" })
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({
      hasText: "The selected provider is no longer available."
    })
  ).toBeVisible();
  await expect(page.getByText("OPENAI_API_KEY")).toHaveCount(0);
});

test("shows worker queue errors without exposing raw worker details", async ({ page }) => {
  await createProject(page, "E2E Worker Failure Project");

  await page.goto("/?view=skills&workerError=worker_runtime_not_configured&debug=WORKER_LOG_SECRET");

  await expect(
    page.getByRole("heading", { exact: true, name: "Project skills" })
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({
      hasText: "Local worker runtime is not configured."
    })
  ).toBeVisible();
  await expect(page.getByText("WORKER_LOG_SECRET")).toHaveCount(0);
});
