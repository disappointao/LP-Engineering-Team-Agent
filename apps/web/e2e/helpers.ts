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

export async function expectStaticLpArtifacts(page: Page) {
  const liveTaskProgress = page.getByLabel("Live task progress");
  await expect(liveTaskProgress).toBeVisible();
  await expect(
    liveTaskProgress.getByText("Artifact workspace ready", { exact: true })
  ).toBeVisible();

  const generatedFiles = page.getByLabel("Generated files");
  await expect(generatedFiles).toBeVisible();

  const artifactChanges = page.getByLabel("Artifact changes");
  await expect(artifactChanges).toBeVisible();

  for (const filePath of ["index.html", "styles.css", "script.js"]) {
    await expect(
      generatedFiles.getByRole("link", {
        name: new RegExp(`^static file\\s+${escapeRegExp(filePath)}\\s+`)
      })
    ).toBeVisible();
    await expect(artifactChanges.getByText(filePath, { exact: true })).toBeVisible();
  }

  await expect(page.getByLabel("Static LP preview")).toBeVisible();
}

export async function expectSnippetFor(page: Page, filePath: string) {
  const artifactChanges = page.getByLabel("Artifact changes");
  await artifactChanges
    .getByRole("link", { name: `Preview snippet: ${filePath}` })
    .click();

  await expect(page).toHaveURL(
    new RegExp(`[?&]artifactPath=${escapeRegExp(encodeURIComponent(filePath))}(?:&|$)`)
  );

  const snippetHeader = artifactChanges.locator(".artifactSnippetHeader");
  await expect(snippetHeader.getByText("Snippet preview", { exact: true })).toBeVisible();
  await expect(snippetHeader.getByText(filePath, { exact: true })).toBeVisible();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
