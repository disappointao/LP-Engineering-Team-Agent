import { expect, test } from "@playwright/test";
import { expectWorkbenchLayoutContract } from "./helpers";

test("keeps the empty workbench layout visually stable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "What can I help you build?" })).toBeVisible();
  await expectWorkbenchLayoutContract(page);

  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath("empty-workbench-layout.png")
  });
});
