import { describe, expect, it } from "vitest";
import { createDemoWorkbenchSnapshot } from "./demo-workbench";
import { createArtifactDownloadLinks, createDeploymentHandoffLink } from "./export-links";
import { createChatWorkbenchThread } from "./chat-workbench";
import { getWorkbenchCopy } from "./i18n";

describe("chat workbench view model", () => {
  it("uses localized copy and preserves the brief prompt as the user message", async () => {
    const copy = getWorkbenchCopy("zh-CN");
    const snapshot = await createDemoWorkbenchSnapshot();
    const downloadLinks = createArtifactDownloadLinks(snapshot.pageVersion.artifacts, copy.exports);
    const handoffLink = createDeploymentHandoffLink(snapshot.deployment, copy.exports);

    const thread = createChatWorkbenchThread({
      copy,
      prompt: snapshot.brief.prompt,
      objective: copy.demo.objective,
      pageVersion: snapshot.pageVersion,
      deployment: snapshot.deployment,
      downloadLinks,
      handoffLink
    });

    expect(thread.userMessage).toBe(snapshot.brief.prompt);
    expect(thread.assistantName).toBe(copy.chat.assistantName);
    expect(thread.composer.placeholder).toBe(copy.chat.composerPlaceholder);
  });

  it("returns deterministic planner builder reviewer deployer tool order", async () => {
    const copy = getWorkbenchCopy("en");
    const snapshot = await createDemoWorkbenchSnapshot();
    const downloadLinks = createArtifactDownloadLinks(snapshot.pageVersion.artifacts, copy.exports);
    const handoffLink = createDeploymentHandoffLink(snapshot.deployment, copy.exports);

    const thread = createChatWorkbenchThread({
      copy,
      prompt: snapshot.brief.prompt,
      objective: copy.demo.objective,
      pageVersion: snapshot.pageVersion,
      deployment: snapshot.deployment,
      downloadLinks,
      handoffLink
    });

    expect(thread.toolEvents.map((event) => event.role)).toEqual([
      "planner",
      "builder",
      "reviewer",
      "deployer"
    ]);
    expect(thread.toolEvents.every((event) => event.status === "complete")).toBe(true);
  });

  it("includes handoff single html and three static file artifact cards", async () => {
    const copy = getWorkbenchCopy("en");
    const snapshot = await createDemoWorkbenchSnapshot();
    const downloadLinks = createArtifactDownloadLinks(snapshot.pageVersion.artifacts, copy.exports);
    const handoffLink = createDeploymentHandoffLink(snapshot.deployment, copy.exports);

    const thread = createChatWorkbenchThread({
      copy,
      prompt: snapshot.brief.prompt,
      objective: copy.demo.objective,
      pageVersion: snapshot.pageVersion,
      deployment: snapshot.deployment,
      downloadLinks,
      handoffLink
    });

    expect(thread.artifacts.map((artifact) => artifact.filename)).toEqual([
      "deployment-handoff.json",
      "index.single.html",
      "index.html",
      "styles.css",
      "script.js"
    ]);
    expect(thread.artifacts[0]?.kind).toBe(copy.chat.artifactKinds.handoff);
    expect(thread.artifacts[1]?.kind).toBe(copy.chat.artifactKinds.single);
    expect(thread.artifacts.slice(2).every((artifact) => artifact.kind === copy.chat.artifactKinds.static)).toBe(true);
  });

  it("exposes reviewer metadata from review status and findings", async () => {
    const copy = getWorkbenchCopy("en");
    const snapshot = await createDemoWorkbenchSnapshot();
    const downloadLinks = createArtifactDownloadLinks(snapshot.pageVersion.artifacts, copy.exports);
    const handoffLink = createDeploymentHandoffLink(snapshot.deployment, copy.exports);

    const thread = createChatWorkbenchThread({
      copy,
      prompt: snapshot.brief.prompt,
      objective: copy.demo.objective,
      pageVersion: snapshot.pageVersion,
      deployment: snapshot.deployment,
      downloadLinks,
      handoffLink
    });
    const reviewer = thread.toolEvents.find((event) => event.role === "reviewer");

    expect(reviewer?.meta).toContain(copy.status.passed);
    expect(reviewer?.meta).toContain("0");
  });
});
