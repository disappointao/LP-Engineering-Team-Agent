import { expect, test } from "@playwright/test";
import {
  expectNoStaticArtifactPreview,
  expectOrdinaryChatThread,
  submitPrompt
} from "./helpers";

test("streams ordinary chat and preserves the completed thread", async ({ page }) => {
  const prompt = "Help me organize a homepage launch checklist";

  await page.goto("/");
  const streamResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/chat/stream") &&
      response.request().method() === "POST"
  );
  await submitPrompt(page, prompt);
  const streamResponse = await streamResponsePromise;

  expect(streamResponse.headers()["content-type"]).toContain("application/x-ndjson");
  await streamResponse.finished();
  await expectOrdinaryChatThread(page, prompt);
  await expectNoStaticArtifactPreview(page);

  await page.reload();
  await expectOrdinaryChatThread(page, prompt);
  await expectNoStaticArtifactPreview(page);
});
