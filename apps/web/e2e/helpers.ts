import { expect, type Locator, type Page } from "@playwright/test";

export async function createProject(page: Page, projectName: string) {
  await page.goto("/");
  await page.getByLabel("Project name").fill(projectName);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByText(projectName, { exact: true }).first()).toBeVisible();
}

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

export async function expectWorkbenchLayoutContract(page: Page) {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const safeViewport = viewport ?? { height: 0, width: 0 };

  const sidebarBox = await getRequiredBox(page.locator("aside.sidebar"), "sidebar");
  const workspaceBox = await getRequiredBox(
    page.locator("section.chatWorkspace"),
    "workspace"
  );
  const composerBox = await getRequiredBox(page.locator("form.composerDock"), "composer");
  const promptBox = await getRequiredBox(page.getByLabel("LP request"), "prompt input");
  const sendBox = await getRequiredBox(page.getByRole("button", { name: "Send" }), "send button");

  expect(Math.round(sidebarBox.x)).toBe(0);
  expect(sidebarBox.width).toBeGreaterThanOrEqual(250);
  expect(sidebarBox.width).toBeLessThanOrEqual(270);
  expect(sidebarBox.height).toBeGreaterThanOrEqual(safeViewport.height - 1);

  expect(workspaceBox.x).toBeGreaterThanOrEqual(sidebarBox.x + sidebarBox.width - 1);
  expect(workspaceBox.width).toBeGreaterThan(600);
  expect(workspaceBox.height).toBeGreaterThanOrEqual(safeViewport.height - 1);

  expect(composerBox.x).toBeGreaterThanOrEqual(workspaceBox.x);
  expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(safeViewport.height + 1);
  expect(composerBox.y).toBeGreaterThan(safeViewport.height * 0.75);

  for (const childBox of [promptBox, sendBox]) {
    expect(childBox.x).toBeGreaterThanOrEqual(composerBox.x);
    expect(childBox.x + childBox.width).toBeLessThanOrEqual(
      composerBox.x + composerBox.width + 1
    );
    expect(childBox.y).toBeGreaterThanOrEqual(composerBox.y);
    expect(childBox.y + childBox.height).toBeLessThanOrEqual(
      composerBox.y + composerBox.height + 1
    );
  }

  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getRequiredBox(
  locator: Locator,
  label: string
): Promise<NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>> {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a bounding box`).not.toBeNull();
  return box!;
}
