import { expect, test } from "@playwright/test";
import {
  createProject,
  expectOrdinaryChatThread,
  expectStaticLpArtifacts,
  submitPrompt
} from "./helpers";

test("keeps ordinary chat free of recommended follow-up prompts", async ({ page }) => {
  const prompt = "Help me organize a launch messaging checklist";

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
  await expect(page.getByLabel("Suggested next prompts")).toHaveCount(0);
});

test("keeps route switches client-side and shows LP follow-up prompts", async ({ page }) => {
  const prompt = "Generate a spring ecommerce static HTML landing page";

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Share" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start trial" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add context" })).toHaveCount(0);
  await expect(page.locator(".entryComposerShell")).toHaveCount(0);

  const submitResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/tasks/submit") &&
      response.request().method() === "POST"
  );
  await submitPrompt(page, prompt);
  const submitResponse = await submitResponsePromise;

  expect(submitResponse.ok()).toBe(true);
  await expect(page.getByLabel("You").getByText(prompt, { exact: true })).toBeVisible();
  const suggestions = page.getByLabel("Suggested next prompts");
  await expect(suggestions).toBeVisible();

  const marker = await page.evaluate(() => {
    const markedWindow = window as typeof window & { __lpWorkbenchMarker?: string };
    markedWindow.__lpWorkbenchMarker = "route-marker";
    return markedWindow.__lpWorkbenchMarker;
  });

  await page.getByRole("link", { name: "Artifacts", exact: true }).click();
  await expect(page).toHaveURL(/[?&]view=artifacts(?:&|$)/);
  await expect(page.getByLabel("Artifact workspace")).toBeVisible();
  await expect(
    page.evaluate(() => (window as typeof window & { __lpWorkbenchMarker?: string }).__lpWorkbenchMarker)
  ).resolves.toBe(marker);

  await page.getByRole("link", { name: "Workbench", exact: true }).click();
  await expect(page).not.toHaveURL(/[?&]view=artifacts(?:&|$)/);
  await expect(
    page.evaluate(() => (window as typeof window & { __lpWorkbenchMarker?: string }).__lpWorkbenchMarker)
  ).resolves.toBe(marker);
});

test("keeps sidebar project and task switches client-side", async ({ page }) => {
  const firstProject = "Sidebar client project A";
  const secondProject = "Sidebar client project B";
  const firstPrompt = "Help me plan sidebar task one";
  const secondPrompt = "Help me plan sidebar task two";

  await createProject(page, firstProject);
  await createProject(page, secondProject);

  const projectMarker = await page.evaluate(() => {
    const markedWindow = window as typeof window & { __lpWorkbenchMarker?: string };
    markedWindow.__lpWorkbenchMarker = "project-switch-marker";
    return markedWindow.__lpWorkbenchMarker;
  });

  await page.getByRole("link", { name: firstProject, exact: true }).click();
  await expect(page.getByRole("link", { name: firstProject, exact: true })).toHaveAttribute(
    "aria-current",
    "page"
  );
  await expect(
    page.evaluate(() => (window as typeof window & { __lpWorkbenchMarker?: string }).__lpWorkbenchMarker)
  ).resolves.toBe(projectMarker);

  await page.getByRole("link", { name: secondProject, exact: true }).click();
  await expect(page.getByRole("link", { name: secondProject, exact: true })).toHaveAttribute(
    "aria-current",
    "page"
  );
  await expect(
    page.evaluate(() => (window as typeof window & { __lpWorkbenchMarker?: string }).__lpWorkbenchMarker)
  ).resolves.toBe(projectMarker);

  await page.getByLabel("LP request").fill(firstPrompt);
  await page.getByLabel("LP request").press("Enter");
  await expect(page.getByLabel("You").getByText(firstPrompt, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent process")).toHaveCount(0);
  await expect(page.getByLabel("Live task progress")).toHaveCount(0);

  await page.getByRole("link", { name: "New task", exact: true }).click();
  await page.getByLabel("LP request").fill(secondPrompt);
  await page.getByLabel("LP request").press("Enter");
  await expect(page.getByLabel("You").getByText(secondPrompt, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent process")).toHaveCount(0);
  await expect(page.getByLabel("Live task progress")).toHaveCount(0);

  const taskMarker = await page.evaluate(() => {
    const markedWindow = window as typeof window & { __lpWorkbenchMarker?: string };
    markedWindow.__lpWorkbenchMarker = "task-switch-marker";
    return markedWindow.__lpWorkbenchMarker;
  });

  await page.locator("a.taskItem", { hasText: firstPrompt }).click();
  await expect(page.getByLabel("You").getByText(firstPrompt, { exact: true })).toBeVisible();
  await expect(
    page.evaluate(() => (window as typeof window & { __lpWorkbenchMarker?: string }).__lpWorkbenchMarker)
  ).resolves.toBe(taskMarker);
});

test("deletes sidebar tasks and projects with confirmation", async ({ page }) => {
  const projectName = "Sidebar delete project";
  const prompt = "Help me plan a task that will be deleted";

  await createProject(page, projectName);
  await page.getByLabel("LP request").fill(prompt);
  await page.getByLabel("LP request").press("Enter");
  await expect(page.getByLabel("You").getByText(prompt, { exact: true })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: `Delete task ${prompt}` }).click();
  await expect(page.locator("a.taskItem", { hasText: prompt })).toHaveCount(0);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: `Delete project ${projectName}` }).click();
  await expect(page.getByRole("link", { name: projectName, exact: true })).toHaveCount(0);
});

test("routes LP chat-style follow-ups without showing latest-turn task progress", async ({ page }) => {
  const prompt = "Generate a browser contract static HTML landing page";
  const followUpPrompt = "Why did you choose this layout?";

  await page.goto("/");
  const submitResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/tasks/submit") &&
      response.request().method() === "POST"
  );
  await submitPrompt(page, prompt);
  const submitResponse = await submitResponsePromise;

  expect(submitResponse.ok()).toBe(true);
  await expect(page.getByLabel("You").getByText(prompt, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Live task progress")).toBeVisible();

  const followUpResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/tasks/submit") &&
      response.request().method() === "POST"
  );
  await submitPrompt(page, followUpPrompt);
  const followUpResponse = await followUpResponsePromise;

  expect(followUpResponse.ok()).toBe(true);
  await expect(page.getByLabel("You").getByText(followUpPrompt, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Live task progress")).toHaveCount(0);
  await expect(page.getByLabel("Agent process")).toHaveCount(0);
});

test("routes LP continue-style follow-ups with latest-turn task progress", async ({ page }) => {
  const prompt = "Generate a follow-up routing static HTML landing page";
  const followUpPrompt = "Continue by making the hero shorter and adding a pricing CTA";

  await page.goto("/");
  const submitResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/tasks/submit") &&
      response.request().method() === "POST"
  );
  await submitPrompt(page, prompt);
  const submitResponse = await submitResponsePromise;

  expect(submitResponse.ok()).toBe(true);
  await expect(page.getByLabel("You").getByText(prompt, { exact: true })).toBeVisible();
  await expectStaticLpArtifacts(page);

  const followUpResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/tasks/submit") &&
      response.request().method() === "POST"
  );
  await submitPrompt(page, followUpPrompt);
  const followUpResponse = await followUpResponsePromise;

  expect(followUpResponse.ok()).toBe(true);
  await expect(page.getByLabel("You").getByText(followUpPrompt, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Live task progress")).toBeVisible();
  await expect(page.getByLabel("Agent process")).toHaveCount(1);
});
