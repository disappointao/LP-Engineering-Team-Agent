import { renameSync, writeFileSync } from "node:fs";
import { expect, type Locator, type Page } from "@playwright/test";

type VisibleBox = {
  box: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;
  label: string;
};

export function writeJsonFileAtomic(filePath: string, value: unknown) {
  const tempFilePath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tempFilePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempFilePath, filePath);
}

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

export async function expectRunTimeline(page: Page) {
  const runTimeline = page.getByLabel("Run timeline");
  await expect(runTimeline).toBeVisible();
  await expect(runTimeline.getByText("Run timeline", { exact: true })).toBeVisible();
  await expect(runTimeline.getByText("Planner to deployment handoff", { exact: true })).toBeVisible();

  for (const role of ["Planner", "Builder", "Reviewer", "Deployer"]) {
    await expect(runTimeline.getByText(role, { exact: true })).toBeVisible();
  }

  const marker = runTimeline
    .locator(
      [
        '[data-marker="handoff_ready"]',
        '[data-marker="handoff_consumed"]',
        '[data-marker="handoff_blocked"]'
      ].join(", ")
    )
    .first();
  await expect(marker).toBeVisible();
  await expect(runTimeline.getByText(/Handoff ready|Handoff consumed|Handoff blocked/).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
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

export async function expectDedicatedArtifactWorkspace(page: Page) {
  const artifactsNav = page.getByRole("link", { name: "Artifacts", exact: true });
  await expect(artifactsNav).toBeVisible();
  await artifactsNav.click();
  await expect(page).toHaveURL(/[?&]view=artifacts(?:&|$)/);

  const workspace = page.getByLabel("Artifact workspace");
  await expect(workspace).toBeVisible();
  const manifest = workspace.getByLabel("File manifest");
  await expect(manifest).toBeVisible();
  await expect(manifest.getByText("File manifest", { exact: true })).toBeVisible();

  for (const filePath of ["index.html", "styles.css", "script.js"]) {
    await expect(manifest.getByText(filePath, { exact: true })).toBeVisible();
    await expect(
      manifest.getByRole("link", { name: `Preview snippet: ${filePath}` })
    ).toBeVisible();
  }

  await expect(workspace.getByLabel("Static LP preview")).toBeVisible();
  await expect(workspace.getByLabel("Exports")).toBeVisible();
  await expect(workspace.getByRole("link", { name: /index\.single\.html/ })).toBeVisible();
}

export async function expectWorkspaceSnippetFor(page: Page, filePath: string) {
  const workspace = page.getByLabel("Artifact workspace");
  await workspace.getByRole("link", { name: `Preview snippet: ${filePath}` }).click();
  await expect(page).toHaveURL(/[?&]view=artifacts(?:&|$)/);
  await expect(page).toHaveURL(
    new RegExp(`[?&]artifactPath=${escapeRegExp(encodeURIComponent(filePath))}(?:&|$)`)
  );
  const snippetHeader = workspace.getByLabel("Artifact changes").locator(".artifactSnippetHeader");
  await expect(snippetHeader.getByText("Snippet preview", { exact: true })).toBeVisible();
  await expect(snippetHeader.getByText(filePath, { exact: true })).toBeVisible();
}

export async function expectSkillsManagementSurface(page: Page) {
  await page.getByRole("link", { name: "Skills" }).click();
  await expect(page).toHaveURL(/[?&]view=skills(?:&|$)/);
  await expect(page.getByRole("heading", { name: "Project skills", exact: true })).toBeVisible();
  await expect(page.getByText("Runtime context", { exact: true })).toBeVisible();
  await expect(page.getByText("Skill lifecycle", { exact: true })).toBeVisible();
  await expect(page.getByText("Saved skill content is not echoed on this page.")).toBeVisible();
}

export async function expectModelsManagementSurface(page: Page) {
  await page.getByRole("link", { name: "Models" }).click();
  await expect(page).toHaveURL(/[?&]view=models(?:&|$)/);
  await expect(page.getByRole("heading", { name: "Project models", exact: true })).toBeVisible();
  await expect(page.getByText("Project model summary", { exact: true })).toBeVisible();
  await expect(page.getByText("Provider configuration", { exact: true })).toBeVisible();
  await expect(page.getByText("Role routing", { exact: true })).toBeVisible();
  await expect(page.getByText("Secret values are never shown")).toBeVisible();
}

export async function expectMCPManagementSurface(page: Page) {
  await page.getByRole("link", { name: "MCP", exact: true }).click();
  await expect(page).toHaveURL(/[?&]view=mcp(?:&|$)/);
  await expect(page.getByRole("heading", { name: "Project MCP", exact: true })).toBeVisible();
  await expect(page.getByText("MCP runtime projection", { exact: true })).toBeVisible();
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

  await expectNoHorizontalOverflow(page);
}

export async function expectArtifactWorkspaceLayoutContract(page: Page) {
  const workspace = page.getByLabel("Artifact workspace");
  const hero = workspace.locator(".artifactWorkspaceHero");
  const manifest = workspace.getByLabel("File manifest");
  const preview = workspace.getByLabel("Static LP preview");
  const exports = workspace.getByLabel("Exports");

  const workspaceBox = await getRequiredBox(workspace, "artifact workspace");
  const heroBox = await getRequiredBox(hero, "artifact workspace hero");
  const manifestBox = await getRequiredBox(manifest, "artifact manifest");
  const previewBox = await getRequiredBox(preview, "artifact preview");
  const exportBox = await getRequiredBox(exports, "artifact exports");

  for (const childBox of [heroBox, manifestBox, previewBox, exportBox]) {
    expect(childBox.x).toBeGreaterThanOrEqual(workspaceBox.x);
    expect(childBox.x + childBox.width).toBeLessThanOrEqual(workspaceBox.x + workspaceBox.width + 1);
    expect(childBox.width).toBeGreaterThan(280);
  }

  expect(heroBox.y).toBeLessThan(manifestBox.y);
  expect(manifestBox.y).toBeLessThan(previewBox.y);
  expect(previewBox.y).toBeLessThan(exportBox.y);
  await expectNoHorizontalOverflow(page);
}

export async function expectManagementLayoutContract(page: Page, surface: "skills" | "models") {
  const root = surface === "skills" ? page.locator("section.skillsView") : page.locator("section.modelsView");
  const header = root.locator(surface === "skills" ? ".skillsHeader" : ".modelsHeader");
  const summary = root.locator(".managementSummary");
  const primaryForm = surface === "skills" ? root.locator("form.skillEditor") : root.locator("form.modelEditor");

  const rootBox = await getRequiredBox(root, `${surface} management surface`);
  const checkedSections = [
    {
      box: await getRequiredBox(header, `${surface} management header`),
      label: `${surface} management header`
    },
    {
      box: await getRequiredBox(summary, `${surface} management summary`),
      label: `${surface} management summary`
    },
    {
      box: await getRequiredBox(primaryForm, `${surface} management form`),
      label: `${surface} management form`
    },
    ...(surface === "skills"
      ? [
          ...(await getVisibleBoxes(root.locator(".skillsList"), "skills management list")),
          ...(await getVisibleBoxes(root.locator(".localWorkerPanel"), "skills local worker panel"))
        ]
      : await getVisibleBoxes(root.locator(".modelsList"), "models management list"))
  ];

  let previousBottom = rootBox.y;
  for (const { box: childBox, label } of checkedSections) {
    expect(childBox.x).toBeGreaterThanOrEqual(rootBox.x);
    expect(childBox.x + childBox.width).toBeLessThanOrEqual(rootBox.x + rootBox.width + 1);
    expect(childBox.width).toBeGreaterThan(260);
    expect(childBox.y, `${label} should not overlap earlier sections`).toBeGreaterThanOrEqual(
      previousBottom - 1
    );
    previousBottom = Math.max(previousBottom, childBox.y + childBox.height);
  }

  await expectNoHorizontalOverflow(page);
}

export async function expectNoVisibleTextLeaks(page: Page, values: string[]) {
  for (const value of values) {
    await expect(page.getByText(value, { exact: false })).toHaveCount(0);
  }

  const formControlLeaks = await page
    .locator("input, textarea, select")
    .evaluateAll((controls, forbiddenValues) => {
      const leaks: Array<{ tagName: string; value: string }> = [];
      for (const control of controls) {
        const style = window.getComputedStyle(control);
        const box = control.getBoundingClientRect();
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          box.width === 0 ||
          box.height === 0
        ) {
          continue;
        }

        const visibleValues: string[] = [];
        if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
          visibleValues.push(control.value);
        }
        if (control instanceof HTMLSelectElement) {
          visibleValues.push(control.value);
          for (const option of Array.from(control.selectedOptions)) {
            visibleValues.push(option.value, option.textContent ?? "");
          }
        }

        for (const forbiddenValue of forbiddenValues as string[]) {
          if (visibleValues.some((visibleValue) => visibleValue.includes(forbiddenValue))) {
            leaks.push({
              tagName: control.tagName.toLowerCase(),
              value: forbiddenValue
            });
          }
        }
      }
      return leaks;
    }, values);
  expect(formControlLeaks).toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page) {
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

async function getVisibleBoxes(
  locator: Locator,
  label: string
): Promise<VisibleBox[]> {
  const boxes: VisibleBox[] = [];
  const count = await locator.count();

  for (let index = 0; index < count; index += 1) {
    const child = locator.nth(index);
    if (await child.isVisible()) {
      boxes.push({
        box: await getRequiredBox(child, `${label} ${index + 1}`),
        label: `${label} ${index + 1}`
      });
    }
  }

  return boxes;
}
