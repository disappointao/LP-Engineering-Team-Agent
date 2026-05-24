import { expect, test } from "@playwright/test";
import { createProject, expectNoVisibleTextLeaks } from "./helpers";

test("detects visible form control value leaks", async ({ page }) => {
  await page.setContent(`
    <label>input leak<input value="FORM_CONTROL_LEAK_SECRET" /></label>
  `);

  await expect(
    expectNoVisibleTextLeaks(page, ["FORM_CONTROL_LEAK_SECRET"])
  ).rejects.toThrow();
});

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

test("shows skill manifest errors without exposing raw content or debug query values", async ({ page }) => {
  await createProject(page, "E2E Skill Failure Project");

  await page.goto(
    "/?view=skills&skillError=invalid_manifest_json&debug=RAW_SKILL_BROWSER_SECRET&content=RAW_SKILL_CONTENT_SECRET"
  );

  await expect(
    page.getByRole("heading", { exact: true, name: "Project skills" })
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Enter valid manifest JSON." })
  ).toBeVisible();
  await expectNoVisibleTextLeaks(page, [
    "RAW_SKILL_BROWSER_SECRET",
    "RAW_SKILL_CONTENT_SECRET"
  ]);
});

test("shows model configuration errors without exposing provider secrets", async ({ page }) => {
  await createProject(page, "E2E Model Config Failure Project");

  await page.goto(
    "/?view=models&modelError=model_provider_base_url_invalid&debug=https://secret-provider.example.test/v1&apiKeyEnv=STAGE45_API_KEY=RAW_SECRET"
  );

  await expect(
    page.getByRole("heading", { exact: true, name: "Project models" })
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Enter a valid provider base URL." })
  ).toBeVisible();
  await expectNoVisibleTextLeaks(page, [
    "https://secret-provider.example.test/v1",
    "STAGE45_API_KEY=RAW_SECRET",
    "RAW_SECRET"
  ]);
});

test("shows recovery errors without exposing raw diagnostics", async ({ page }) => {
  await page.goto(
    "/?recoveryError=retry_failed&debug=RAW_MODEL_OUTPUT_SECRET&path=/Users/ao/Desktop/secret&apiKeyEnv=OPENAI_API_KEY"
  );

  await expect(
    page.getByRole("alert").filter({ hasText: "Recovery action could not be completed." })
  ).toBeVisible();
  await expectNoVisibleTextLeaks(page, [
    "RAW_MODEL_OUTPUT_SECRET",
    "/Users/ao/Desktop/secret",
    "Desktop/secret",
    "OPENAI_API_KEY"
  ]);
});
