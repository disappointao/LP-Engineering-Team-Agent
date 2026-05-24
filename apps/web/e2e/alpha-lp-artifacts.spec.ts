import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  expectDedicatedArtifactWorkspace,
  expectNoVisibleTextLeaks,
  expectRunTimeline,
  expectSnippetFor,
  expectStaticLpArtifacts,
  expectWorkspaceSnippetFor,
  submitPrompt,
  writeJsonFileAtomic
} from "./helpers";

const e2eStateFile = resolve("test-results", "alpha-e2e-state", "workbench-state.json");

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

  await expectRunTimeline(page);
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
  await expectNoVisibleTextLeaks(page, [
    "ARTIFACT_QUERY_SECRET",
    "../secret.css",
    "..%2Fsecret.css"
  ]);
  await expectStaticLpArtifacts(page);

  await page.goto("/?artifactPath=..%2Fsecret.css%3Ftoken%3DARTIFACT_QUERY_SECRET");
  await expect(page.getByText("Snippet is unavailable.", { exact: true })).toBeVisible();
  await expectNoVisibleTextLeaks(page, [
    "ARTIFACT_QUERY_SECRET",
    "../secret.css",
    "..%2Fsecret.css"
  ]);
  await expectStaticLpArtifacts(page);

  await page.goto("/?view=artifacts&artifactPath=unknown.txt");
  await expect(page.getByText("Snippet is unavailable.", { exact: true })).toBeVisible();
  await expectNoVisibleTextLeaks(page, [
    "ARTIFACT_QUERY_SECRET",
    "../secret.css",
    "..%2Fsecret.css"
  ]);
  await expect(page.getByLabel("Artifact workspace")).toBeVisible();

  await page.goto("/?view=artifacts&artifactPath=..%2Fsecret.css%3Ftoken%3DARTIFACT_QUERY_SECRET");
  await expect(page.getByText("Snippet is unavailable.", { exact: true })).toBeVisible();
  await expectNoVisibleTextLeaks(page, [
    "ARTIFACT_QUERY_SECRET",
    "../secret.css",
    "..%2Fsecret.css"
  ]);
  await expect(page.getByLabel("Artifact workspace")).toBeVisible();

  makeArtifactWorkspaceFileOversized(
    prompt,
    "styles.css",
    "OVERSIZED_BROWSER_SNIPPET_SECRET"
  );
  await page.goto("/?view=artifacts&artifactPath=styles.css");
  await expect(
    page.getByText("Content is over the 8 KB preview limit.", { exact: true })
  ).toBeVisible();
  await expectNoVisibleTextLeaks(page, ["OVERSIZED_BROWSER_SNIPPET_SECRET"]);
  await expect(page.getByLabel("Artifact workspace")).toBeVisible();
});

type E2EState = {
  artifactWorkspaceFiles?: Array<Record<string, unknown>>;
  messages?: Array<Record<string, unknown>>;
  pageVersions?: Array<Record<string, unknown>>;
  taskSnapshots?: Array<Record<string, unknown>>;
  tasks?: Array<Record<string, unknown>>;
};

function makeArtifactWorkspaceFileOversized(prompt: string, path: string, secret: string) {
  const state = JSON.parse(readFileSync(e2eStateFile, "utf8")) as E2EState;
  const taskId = getLatestLpTaskIdForPrompt(state, prompt);
  const workspaceId = getArtifactWorkspaceIdForTask(state, taskId);
  const file = state.artifactWorkspaceFiles?.find(
    (record) => record.workspaceId === workspaceId && record.path === path
  );
  if (!file) {
    throw new Error(
      `Expected persisted E2E artifact file ${path} in workspace ${workspaceId} to exist.`
    );
  }

  const content = `${secret}${"x".repeat(9000)}`;
  file.content = content;
  file.sizeBytes = Buffer.byteLength(content, "utf8");
  file.sha256 = createHash("sha256").update(content).digest("hex");
  file.updatedAt = "2026-05-24T00:00:00.000Z";
  writeJsonFileAtomic(e2eStateFile, state);
}

function getLatestLpTaskIdForPrompt(state: E2EState, prompt: string): string {
  const lpTaskIds = new Set(
    (state.tasks ?? [])
      .filter((record) => record.type === "lp_generation" && typeof record.id === "string")
      .map((record) => String(record.id))
  );
  const message = (state.messages ?? [])
    .filter(
      (record) =>
        record.role === "user" &&
        record.content === prompt &&
        typeof record.taskId === "string" &&
        lpTaskIds.has(record.taskId)
    )
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
  if (!message || typeof message.taskId !== "string") {
    throw new Error(`Expected a persisted LP user message for prompt: ${prompt}`);
  }
  return message.taskId;
}

function getArtifactWorkspaceIdForTask(state: E2EState, taskId: string): string {
  const snapshot = state.taskSnapshots?.find((record) => record.taskId === taskId);
  if (!snapshot || typeof snapshot.pageVersionId !== "string") {
    throw new Error(`Expected a persisted task snapshot for task ${taskId}.`);
  }

  const pageVersion = state.pageVersions?.find(
    (record) => record.id === snapshot.pageVersionId
  );
  if (!pageVersion || typeof pageVersion.artifactWorkspaceId !== "string") {
    throw new Error(
      `Expected page version ${snapshot.pageVersionId} to reference an artifact workspace.`
    );
  }

  return pageVersion.artifactWorkspaceId;
}
