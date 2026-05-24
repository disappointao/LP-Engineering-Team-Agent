import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  expectNoVisibleTextLeaks,
  expectRunTimeline,
  expectStaticLpArtifacts,
  submitPrompt,
  writeJsonFileAtomic
} from "./helpers";

const e2eStateFile = resolve("test-results", "alpha-e2e-state", "workbench-state.json");

test("shows timeline recovery guidance without leaking raw diagnostics", async ({ page }) => {
  const prompt = "Generate a recovery timeline browser fixture LP";

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  await submitPrompt(page, prompt);
  await expectStaticLpArtifacts(page);
  await expectRunTimeline(page);

  const taskId = getLatestLpTaskId(prompt);
  injectFailedBuilderRun(taskId, "RECOVERY_BROWSER_SECRET", "/Users/ao/Desktop/recovery-secret");
  await page.reload();

  await expectRunTimeline(page);
  const recovery = page.getByLabel("Run recovery");
  await expect(recovery).toBeVisible();
  await expect(recovery.getByText("Builder", { exact: true })).toBeVisible();
  await expect(recovery.getByText("Run failed.", { exact: true })).toBeVisible();
  await expect(recovery.getByText("Actions", { exact: true })).toBeVisible();
  await expect(recovery.getByRole("button", { name: "Retry run" })).toBeVisible();
  await expectNoVisibleTextLeaks(page, [
    "RECOVERY_BROWSER_SECRET",
    "/Users/ao/Desktop/recovery-secret",
    "recovery-secret"
  ]);
});

function getLatestLpTaskId(prompt: string): string {
  const state = JSON.parse(readFileSync(e2eStateFile, "utf8")) as {
    tasks?: Array<Record<string, unknown>>;
  };
  const task = (state.tasks ?? [])
    .filter((record) => record.title === prompt && record.type === "lp_generation")
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
  if (!task || typeof task.id !== "string") {
    throw new Error(`Expected a persisted LP task for prompt: ${prompt}`);
  }
  return task.id;
}

function injectFailedBuilderRun(taskId: string, secret: string, localPath: string) {
  const state = JSON.parse(readFileSync(e2eStateFile, "utf8")) as {
    runs?: Array<Record<string, unknown>>;
    runEvents?: Array<Record<string, unknown>>;
  };
  const builderRun = state.runs?.find(
    (run) => run.role === "builder" && run.taskId === taskId
  );
  if (!builderRun || typeof builderRun.id !== "string") {
    throw new Error(`Expected a persisted builder run for task ${taskId} in the E2E state.`);
  }
  if (typeof builderRun.projectId !== "string" || typeof builderRun.taskId !== "string") {
    throw new Error("Expected the builder run to include projectId and taskId.");
  }

  builderRun.state = "failed";
  builderRun.completedAt = "2026-05-24T00:00:00.000Z";

  const runEvents = (state.runEvents ?? []).filter(
    (event) => event.runId !== builderRun.id || event.type !== "run.completed"
  );
  const sequence =
    runEvents
      .filter((event) => event.runId === builderRun.id)
      .map((event) => (typeof event.sequence === "number" ? event.sequence : 0))
      .sort((a, b) => b - a)[0] ?? 0;

  runEvents.push({
    id: "event_stage45_builder_failed",
    runId: builderRun.id,
    projectId: builderRun.projectId,
    taskId: builderRun.taskId,
    sequence: sequence + 1,
    type: "run.failed",
    message: "Run failed.",
    payload: {
      errorName: "stage45_browser_recovery_failure",
      rawDiagnostic: secret,
      localPath
    },
    createdAt: "2026-05-24T00:00:00.000Z"
  });
  state.runEvents = runEvents;

  writeJsonFileAtomic(e2eStateFile, state);
}
