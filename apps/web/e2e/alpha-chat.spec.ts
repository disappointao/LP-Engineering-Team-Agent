import { expect, test } from "@playwright/test";
import {
  createProject,
  expectNoStaticArtifactPreview,
  expectOrdinaryChatThread
} from "./helpers";

test("streams ordinary chat and preserves the completed thread", async ({ page }) => {
  const prompt = "Help me organize a homepage launch checklist";

  await page.goto("/");
  const streamResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/chat/stream") &&
      response.request().method() === "POST"
  );
  await page.getByLabel("LP request").fill(prompt);
  await page.getByLabel("LP request").press("Enter");
  const streamResponse = await streamResponsePromise;

  expect(streamResponse.headers()["content-type"]).toContain("application/x-ndjson");
  await expectOrdinaryChatThread(page, prompt);
  await expectNoStaticArtifactPreview(page);

  await page.reload();
  await expectOrdinaryChatThread(page, prompt);
  await expectNoStaticArtifactPreview(page);
});

test("opens the newly submitted task from the new-task composer", async ({ page }) => {
  const prompt = "Help me draft a launch follow-up checklist";

  await createProject(page, "New task route project");
  await page.getByRole("link", { name: "New task", exact: true }).click();
  await expect(page).toHaveURL(/[?&]newTask=1(?:&|$)/);

  await page.getByLabel("LP request").fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await expect(page).toHaveURL(/[?&]taskId=task_\d+(?:&|$)/);
  await expect(page).not.toHaveURL(/[?&]newTask=1(?:&|$)/);
  await expect(page.getByLabel("You").getByText(prompt)).toBeVisible();
  await expect(
    page.getByText("assistant response from mock-openai/assistant-model", { exact: true })
  ).toBeVisible();
  await expectNoStaticArtifactPreview(page);
});
