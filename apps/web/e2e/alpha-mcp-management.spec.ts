import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  createProject,
  expectMCPManagementSurface,
  expectNoVisibleTextLeaks,
  writeJsonFileAtomic
} from "./helpers";

type JsonRecord = Record<string, unknown>;

const e2eStateFile = resolve("test-results", "alpha-e2e-state", "workbench-state.json");
const projectName = "Stage 54 MCP Management";
const skillId = "skill_stage54_asset_reader";
const skillName = "Stage 54 Asset Reader";
const connectorId = "connector_stage54_assets";
const rawSkillContentSecret = "RAW_STAGE54_MCP_SKILL_SECRET";
const querySecret = "MCP_STAGE54_QUERY_SECRET";
const rawArgumentSecret = "MCP_STAGE54_RAW_ARGUMENT_SECRET";
const localAbsolutePath = "/Users/ao/Desktop/stage-54-secret-assets";

test.afterEach(() => {
  cleanupStage54MCPRecords();
});

test("manages MCP connectors with read-only execution and no raw argument leaks", async ({ page }) => {
  await createProject(page, projectName);
  await createBoundAssetsReadSkill(page);

  await expectMCPManagementSurface(page);
  await page.goto(
    `/?view=mcp&debug=${encodeURIComponent(querySecret)}` +
      `&toolArguments=${encodeURIComponent(
        JSON.stringify({ query: rawArgumentSecret, path: localAbsolutePath })
      )}` +
      `&path=${encodeURIComponent(localAbsolutePath)}`
  );
  await expect(page.getByRole("heading", { exact: true, name: "Project MCP" })).toBeVisible();
  await expect(page.getByText("MCP runtime projection", { exact: true })).toBeVisible();

  await page.getByLabel("Connector JSON").fill(
    JSON.stringify(
      {
        id: connectorId,
        name: "Stage 54 Assets",
        description: "Project asset catalog metadata.",
        tools: [
          {
            name: "searchAssets",
            description: "Search approved asset metadata.",
            permission: "assets:read",
            roles: ["planner", "builder", "reviewer"],
            requiresApproval: false,
            readOnly: true,
            sideEffect: "read"
          },
          {
            name: "deployAsset",
            description: "Deploy an asset to a managed target.",
            permission: "assets:write",
            roles: ["deployer"],
            requiresApproval: true,
            readOnly: false,
            sideEffect: "write"
          }
        ]
      },
      null,
      2
    )
  );
  await page.getByRole("button", { name: "Create connector" }).click();
  await expect(page).toHaveURL(/[?&]view=mcp(?:&|$)/);

  const connectorRow = page
    .getByLabel("Connectors")
    .locator(".mcpConnectorRow")
    .filter({ hasText: "Stage 54 Assets" })
    .first();
  await expect(connectorRow).toBeVisible();
  await expect(
    connectorRow.getByText("Project asset catalog metadata.", { exact: true })
  ).toBeVisible();
  await expect(connectorRow.getByText("Enabled", { exact: false }).first()).toBeVisible();
  await expect(connectorRow.getByText("Configured", { exact: false }).first()).toBeVisible();
  await expect(connectorRow.getByText("2 tools", { exact: false })).toBeVisible();

  const connectorTools = connectorRow.getByLabel("Tools");
  const searchAssetsTool = connectorTools
    .locator(".mcpToolCard")
    .filter({ hasText: "searchAssets" })
    .first();
  await expect(searchAssetsTool.getByText("searchAssets", { exact: true })).toBeVisible();
  await expect(searchAssetsTool.getByText("Permission: assets:read", { exact: true })).toBeVisible();
  await expect(
    searchAssetsTool.getByText("Roles: Planner, Builder, Reviewer", { exact: true })
  ).toBeVisible();

  const deployAssetTool = connectorTools
    .locator(".mcpToolCard")
    .filter({ hasText: "deployAsset" })
    .first();
  await expect(deployAssetTool.getByText("deployAsset", { exact: true })).toBeVisible();
  await expect(deployAssetTool.getByText("Permission: assets:write", { exact: true })).toBeVisible();
  await expect(deployAssetTool.getByText("Roles: Deployer", { exact: true })).toBeVisible();

  const visiblePlannerTool = page
    .getByLabel("Visible tools")
    .locator(".mcpVisibleRole")
    .filter({ hasText: "Planner" })
    .first()
    .locator(".mcpToolCard")
    .filter({ hasText: "searchAssets" })
    .first();
  await expect(visiblePlannerTool).toBeVisible();
  await expect(visiblePlannerTool.getByText(connectorId, { exact: true })).toBeVisible();
  await expect(
    visiblePlannerTool.getByRole("button", { name: "Run read-only check" }).first()
  ).toBeVisible();
  await expect(page.getByText("Run read-only check", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Tool arguments", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Arguments JSON", { exact: true })).toHaveCount(0);
  await expect(page.locator('textarea[name="argumentsJson"]')).toHaveCount(0);

  await visiblePlannerTool.getByRole("button", { name: "Run read-only check" }).first().click();
  await expect(page).toHaveURL(/[?&]view=mcp(?:&|$)/);
  await expect(page.getByRole("heading", { exact: true, name: "Project MCP" })).toBeVisible();

  await expectNoVisibleTextLeaks(page, [
    rawSkillContentSecret,
    querySecret,
    rawArgumentSecret,
    localAbsolutePath,
    "Desktop/stage-54-secret-assets"
  ]);
  await expect(page).not.toHaveURL(new RegExp(`${querySecret}|${rawArgumentSecret}`));
});

async function createBoundAssetsReadSkill(page: Page) {
  await page.getByRole("link", { exact: true, name: "Skills" }).click();
  await expect(page.getByRole("heading", { exact: true, name: "Project skills" })).toBeVisible();

  await page.getByLabel("Manifest JSON").fill(
    JSON.stringify(
      {
        id: skillId,
        name: skillName,
        version: "0.1.0",
        type: "template",
        scope: "project",
        description: "Grants read-only asset discovery to MCP tools.",
        permissions: ["assets:read"],
        requiredSecrets: [],
        entrypoints: ["assets.md"],
        reviewState: "draft"
      },
      null,
      2
    )
  );
  await page.getByLabel("Skill content").fill(rawSkillContentSecret);
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/[?&]skillNotice=draft_created(?:&|$)/);
  await expect(page.getByText("Skill draft saved.", { exact: true })).toBeVisible();
  await expectNoVisibleTextLeaks(page, [rawSkillContentSecret]);

  await getSkillVersionRow(page).getByRole("button", { name: "Validate" }).click();
  await expect(page).toHaveURL(/[?&]skillNotice=validated(?:&|$)/);
  await expect(page.getByText("Skill validated.", { exact: true })).toBeVisible();

  await getSkillVersionRow(page).getByRole("button", { name: "Publish" }).click();
  await expect(page).toHaveURL(/[?&]skillNotice=published(?:&|$)/);
  await expect(page.getByText("Skill published.", { exact: true })).toBeVisible();

  await getSkillVersionRow(page).getByRole("button", { name: "Bind" }).click();
  await expect(page).toHaveURL(/[?&]skillNotice=bound(?:&|$)/);
  await expect(page.getByText("Skill bound to the project.", { exact: true })).toBeVisible();
  await expect(
    page
      .getByLabel("Bound project skills")
      .locator(".skillRow")
      .filter({ hasText: skillName })
      .first()
  ).toBeVisible();
}

function getSkillVersionRow(page: Page) {
  return page
    .getByLabel("Skill lifecycle")
    .locator(".skillRow")
    .filter({ hasText: skillName })
    .first();
}

function cleanupStage54MCPRecords() {
  let state: Record<string, unknown>;
  try {
    state = JSON.parse(readFileSync(e2eStateFile, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  const projectIds = new Set(
    getRecords(state, "projects")
      .filter((record) => record.name === projectName)
      .map((record) => asString(record.id))
      .filter(Boolean)
  );
  const skillIds = new Set([skillId]);
  const skillVersionIds = new Set(
    getRecords(state, "skillVersions")
      .filter((record) => {
        const manifest = isRecord(record.manifest) ? record.manifest : {};
        return skillIds.has(asString(record.skillId)) || skillIds.has(asString(manifest.id));
      })
      .map((record) => asString(record.id))
      .filter(Boolean)
  );
  const connectorIds = new Set([connectorId]);
  const runIds = new Set(
    getRecords(state, "runs")
      .filter((record) => projectIds.has(asString(record.projectId)))
      .map((record) => asString(record.id))
      .filter(Boolean)
  );

  filterRecords(state, "projects", (record) => !projectIds.has(asString(record.id)));
  filterRecords(state, "projectMembers", (record) => !projectIds.has(asString(record.projectId)));
  filterRecords(state, "skills", (record) => !skillIds.has(asString(record.id)));
  filterRecords(
    state,
    "skillVersions",
    (record) =>
      !skillVersionIds.has(asString(record.id)) && !skillIds.has(asString(record.skillId))
  );
  filterRecords(
    state,
    "skillBindings",
    (record) =>
      !skillVersionIds.has(asString(record.skillVersionId)) &&
      !projectIds.has(asString(record.projectId)) &&
      !projectIds.has(asString(record.targetKey))
  );
  filterRecords(
    state,
    "mcpConnectors",
    (record) =>
      !connectorIds.has(asString(record.id)) &&
      !projectIds.has(asString(record.projectId)) &&
      !projectIds.has(asString(record.targetKey))
  );
  filterRecords(
    state,
    "mcpToolApprovals",
    (record) =>
      !connectorIds.has(asString(record.connectorId)) && !projectIds.has(asString(record.projectId))
  );
  filterRecords(
    state,
    "runs",
    (record) => !runIds.has(asString(record.id)) && !projectIds.has(asString(record.projectId))
  );
  filterRecords(
    state,
    "runEvents",
    (record) => !runIds.has(asString(record.runId)) && !projectIds.has(asString(record.projectId))
  );
  filterRecords(
    state,
    "toolObservations",
    (record) =>
      !runIds.has(asString(record.runId)) &&
      !projectIds.has(asString(record.projectId)) &&
      !asString(record.toolName).includes(connectorId)
  );

  writeJsonFileAtomic(e2eStateFile, state);
}

function filterRecords(
  state: Record<string, unknown>,
  key: string,
  predicate: (record: JsonRecord) => boolean
) {
  const value = state[key];
  if (!Array.isArray(value)) {
    return;
  }
  state[key] = value.filter((record): record is JsonRecord => isRecord(record) && predicate(record));
}

function getRecords(state: Record<string, unknown>, key: string): JsonRecord[] {
  const value = state[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
