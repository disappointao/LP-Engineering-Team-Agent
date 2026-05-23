import { expect, test } from "@playwright/test";
import {
  expectDedicatedArtifactWorkspace,
  expectSnippetFor,
  expectStaticLpArtifacts,
  expectWorkspaceSnippetFor,
  submitPrompt
} from "./helpers";

test("runs an LP live task and exposes static artifacts", async ({ page }) => {
  const prompt = "Generate a spring ecommerce static HTML landing page";

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

  const agentProcess = page.getByLabel("Agent process");
  await expect(agentProcess).toBeVisible();
  for (const role of ["Planner", "Builder", "Reviewer", "Deployer"]) {
    await expect(page.getByText(role, { exact: true }).first()).toBeVisible();
  }

  await expectStaticLpArtifacts(page);
  await expectSnippetFor(page, "index.html");
  await expectSnippetFor(page, "styles.css");
  await expectSnippetFor(page, "script.js");

  await expectDedicatedArtifactWorkspace(page);
  await expectWorkspaceSnippetFor(page, "index.html");
  await expectWorkspaceSnippetFor(page, "styles.css");
  await expectWorkspaceSnippetFor(page, "script.js");

  await page.goto("/?artifactPath=unknown.txt");
  await expect(page.getByText("Snippet is unavailable.", { exact: true })).toBeVisible();
  await expectStaticLpArtifacts(page);

  await page.goto("/?artifactPath=..%2Fsecret.css%3Ftoken%3DARTIFACT_QUERY_SECRET");
  await expect(page.getByText("Snippet is unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByText("ARTIFACT_QUERY_SECRET")).toHaveCount(0);
  await expect(page.getByText("../secret.css")).toHaveCount(0);
  await expectStaticLpArtifacts(page);

  await page.goto("/?view=artifacts&artifactPath=unknown.txt");
  await expect(page.getByText("Snippet is unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Artifact workspace")).toBeVisible();

  await page.goto("/?view=artifacts&artifactPath=..%2Fsecret.css%3Ftoken%3DARTIFACT_QUERY_SECRET");
  await expect(page.getByText("Snippet is unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByText("ARTIFACT_QUERY_SECRET")).toHaveCount(0);
  await expect(page.getByText("../secret.css")).toHaveCount(0);
  await expect(page.getByLabel("Artifact workspace")).toBeVisible();
});
