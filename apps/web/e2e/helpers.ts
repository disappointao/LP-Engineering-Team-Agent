import { expect, type Page } from "@playwright/test";

export async function submitPrompt(page: Page, prompt: string) {
  await page.getByLabel("LP request").fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

export async function expectOrdinaryChatThread(page: Page, prompt: string) {
  await expect(page.getByLabel("You").getByText(prompt)).toBeVisible();
  await expect(
    page.getByText("I created a task thread and can continue from here.")
  ).toBeVisible();
  await expect(page.getByLabel("Agent process")).toBeVisible();
  await expect(page.getByText("Created a general task thread.")).toBeVisible();
}

export async function expectNoStaticArtifactPreview(page: Page) {
  await expect(page.getByLabel("Static LP preview")).toHaveCount(0);
  await expect(page.getByLabel("Generated files")).toHaveCount(0);
}
