import { expect, test } from "@playwright/test";
import {
  expectNoStaticArtifactPreview,
  expectOrdinaryChatThread
} from "./helpers";

test("streams ordinary chat and preserves the completed thread", async ({ page }) => {
  const prompt = "Help me organize a homepage launch checklist";

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
  await expectNoStaticArtifactPreview(page);

  await page.reload();
  await expectOrdinaryChatThread(page, prompt);
  await expectNoStaticArtifactPreview(page);
});
