import { expect, test } from "@playwright/test";
import { submitPrompt } from "./helpers";

test("keeps route switches client-side and shows LP follow-up prompts", async ({ page }) => {
  const prompt = "Generate a spring ecommerce static HTML landing page";
  const followUpPrompt = "Make the hero shorter and add a pricing CTA";

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

  const followUpResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/tasks/submit") &&
      response.request().method() === "POST"
  );
  await submitPrompt(page, followUpPrompt);
  const followUpResponse = await followUpResponsePromise;

  expect(followUpResponse.ok()).toBe(true);
  await expect(page.getByLabel("You").getByText(followUpPrompt, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent process")).toHaveCount(1);
});
