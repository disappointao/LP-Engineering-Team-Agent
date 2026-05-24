import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createProject,
  expectModelsManagementSurface,
  expectSkillsManagementSurface
} from "./helpers";

const e2eStateFile = resolve("test-results", "alpha-e2e-state", "workbench-state.json");

test("manages skills and models with safe client-side feedback", async ({ page }) => {
  await createProject(page, "Stage 44 Management");

  await expectSkillsManagementSurface(page);
  await page.getByLabel("Manifest JSON").fill(
    JSON.stringify(
      {
        id: "skill_stage44",
        name: "Stage 44 Brand Voice",
        version: "0.1.0",
        type: "template",
        scope: "project",
        description: "Safe brand guidance.",
        permissions: ["brief:read"],
        requiredSecrets: [],
        entrypoints: ["brand.md"],
        reviewState: "draft"
      },
      null,
      2
    )
  );
  await page.getByLabel("Skill content").fill("RAW_SKILL_BROWSER_SECRET");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/[?&]skillNotice=draft_created(?:&|$)/);
  await expect(page.getByText("Skill draft saved.", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Skill lifecycle").getByText("Draft · Validate next")
  ).toBeVisible();
  await expect(page.getByLabel("Skill content")).toHaveValue("");
  await expect(page.getByText("RAW_SKILL_BROWSER_SECRET")).toHaveCount(0);

  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page).toHaveURL(/[?&]skillNotice=validated(?:&|$)/);
  await expect(page.getByText("Skill validated.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page).toHaveURL(/[?&]skillNotice=published(?:&|$)/);
  await expect(page.getByText("Skill published.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Bind" }).click();
  await expect(page).toHaveURL(/[?&]skillNotice=bound(?:&|$)/);
  await expect(page.getByText("Skill bound to the project.", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Bound project skills").getByText("Enabled · Disable from runtime")
  ).toBeVisible();

  await expectModelsManagementSurface(page);
  await page.getByLabel("Provider key").fill("provider_stage44");
  await page.getByLabel("Display name").fill("Stage 44 Provider");
  await page.getByLabel("Provider type").selectOption("custom");
  await page.getByLabel("API protocol").selectOption("openai-completions");
  await page.getByLabel("Base URL").fill("https://secret-provider.example.test/v1");
  await page.getByLabel("API key env var").fill("STAGE44_API_KEY");
  await page.getByLabel("Default model id").fill("stage-44-model");
  await page.getByRole("button", { name: "Create provider" }).click();
  await expect(page).toHaveURL(/[?&]modelNotice=provider_created(?:&|$)/);
  await expect(page.getByText("Model provider saved.", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Provider configuration").getByText("Stage 44 Provider", { exact: true })
  ).toBeVisible();
  await expect(page.getByLabel("Provider key")).toHaveValue("");
  await expect(page.getByLabel("Display name")).toHaveValue("");
  await expect(page.getByLabel("Base URL")).toHaveValue("");
  await expect(page.getByLabel("API key env var")).toHaveValue("");
  await expect(page.getByLabel("Default model id")).toHaveValue("");
  await expect(page.getByText("https://secret-provider.example.test/v1")).toHaveCount(0);
  await expect(page.getByText("STAGE44_API_KEY=")).toHaveCount(0);

  const plannerRouteForm = page.locator("form.modelRouteForm").filter({ hasText: "Planner" });
  await plannerRouteForm.getByRole("combobox").selectOption("provider_stage44");
  await page.getByLabel("Planner Model ID").fill("stage-44-model");
  await plannerRouteForm.getByRole("button", { name: "Save route" }).click();
  await expect(page).toHaveURL(/[?&]modelNotice=route_saved(?:&|$)/);
  await expect(page.getByText("Model route saved.", { exact: true })).toBeVisible();
  await expect(
    plannerRouteForm.getByText("Configured · provider_stage44/stage-44-model")
  ).toBeVisible();
  await expect(
    page.getByLabel("Role routing").getByText(/Deterministic fallback · mock-/).first()
  ).toBeVisible();

  disableProviderInE2eState("provider_stage44");
  await page.reload();
  await expect(plannerRouteForm.getByText("Fail closed · provider_stage44/stage-44-model")).toBeVisible();
  await expect(
    plannerRouteForm.getByText("Enable the provider before routing a role to it.", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("https://secret-provider.example.test/v1")).toHaveCount(0);
  await expect(page.getByText("STAGE44_API_KEY")).toHaveCount(0);

  await page.getByLabel("Provider key").fill("provider_stage44_invalid");
  await page.getByLabel("Display name").fill("Stage 44 Invalid Provider");
  await page.getByLabel("Provider type").selectOption("custom");
  await page.getByLabel("API protocol").selectOption("openai-completions");
  await page.getByLabel("Base URL").fill("https://invalid-provider.example.test/v1");
  await page.getByLabel("API key env var").fill("STAGE44_API_KEY=RAW_SECRET_ASSIGNMENT");
  await page.getByLabel("Default model id").fill("stage-44-invalid-model");
  await page.getByRole("button", { name: "Create provider" }).click();
  await expect(page).toHaveURL(/[?&]modelError=model_provider_api_key_env_invalid(?:&|$)/);
  await expect(
    page.getByText("Use an environment variable name for the provider API key.", {
      exact: true
    })
  ).toBeVisible();
  await expect(page.getByText("RAW_SECRET_ASSIGNMENT")).toHaveCount(0);
  await expect(page.getByText("STAGE44_API_KEY=RAW_SECRET_ASSIGNMENT")).toHaveCount(0);
  await expect(page.getByLabel("API key env var")).toHaveValue("");
});

function disableProviderInE2eState(providerId: string) {
  const state = JSON.parse(readFileSync(e2eStateFile, "utf8")) as {
    modelProviders?: Array<Record<string, unknown>>;
  };
  const provider = state.modelProviders?.find((record) => record.id === providerId);
  if (!provider) {
    throw new Error(`Expected persisted E2E provider ${providerId} to exist.`);
  }
  provider.enabled = false;
  provider.updatedAt = "2026-05-24T00:00:00.000Z";
  writeFileSync(e2eStateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
