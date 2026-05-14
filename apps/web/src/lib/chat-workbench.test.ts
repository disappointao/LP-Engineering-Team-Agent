import { describe, expect, it } from "vitest";
import type { StaticArtifacts } from "@lp-agent/artifacts";
import type { RunEventRecord } from "@lp-agent/api";
import { createDemoWorkbenchSnapshot } from "./demo-workbench";
import { createArtifactDownloadLinks } from "./export-links";
import { createChatWorkbenchThread, createGeneralTaskThread } from "./chat-workbench";
import { getWorkbenchCopy } from "./i18n";

describe("chat workbench view model", () => {
  it("creates a general task conversation without artifacts", () => {
    const copy = getWorkbenchCopy("en");
    const thread = createGeneralTaskThread({
      copy,
      userMessage: "Help me write a campaign plan.",
      assistantMessage: "I created a task thread and can continue from here."
    });

    expect(thread.userMessage).toBe("Help me write a campaign plan.");
    expect(thread.assistantIntro).toBe(copy.chat.generalIntro);
    expect(thread.assistantCompletion).toBe("I created a task thread and can continue from here.");
    expect(thread.toolEvents.map((event) => event.role)).toEqual(["assistant"]);
    expect(thread.artifacts).toEqual([]);
  });

  it("uses localized copy and preserves the brief prompt as the user message", async () => {
    const copy = getWorkbenchCopy("zh-CN");
    const snapshot = await createDemoWorkbenchSnapshot();
    const downloadLinks = createArtifactDownloadLinks(snapshot.pageVersion.artifacts, copy.exports);

    const thread = createChatWorkbenchThread({
      copy,
      prompt: snapshot.brief.prompt,
      objective: copy.demo.objective,
      pageVersion: snapshot.pageVersion,
      downloadLinks
    });

    expect(thread.userMessage).toBe(snapshot.brief.prompt);
    expect(thread.assistantName).toBe(copy.chat.assistantName);
    expect(thread.composer.placeholder).toBe(copy.chat.composerPlaceholder);
  });

  it("returns deterministic planner builder reviewer tool order", async () => {
    const copy = getWorkbenchCopy("en");
    const snapshot = await createDemoWorkbenchSnapshot();
    const downloadLinks = createArtifactDownloadLinks(snapshot.pageVersion.artifacts, copy.exports);

    const thread = createChatWorkbenchThread({
      copy,
      prompt: snapshot.brief.prompt,
      objective: copy.demo.objective,
      pageVersion: snapshot.pageVersion,
      downloadLinks
    });

    expect(thread.toolEvents.map((event) => event.role)).toEqual([
      "planner",
      "builder",
      "reviewer"
    ]);
    expect(thread.toolEvents.every((event) => event.status === "complete")).toBe(true);
  });

  it("uses persisted run events for the LP tool timeline when provided", () => {
    const copy = getWorkbenchCopy("en");
    const runEvents: RunEventRecord[] = [
      {
        id: "event_1",
        runId: "run_planner_brief_1",
        projectId: "project_1",
        sequence: 1,
        type: "run.started",
        message: "planner run started",
        payload: { role: "planner" },
        createdAt: "2026-05-14T00:00:00.000Z"
      },
      {
        id: "event_2",
        runId: "run_builder_version_1",
        projectId: "project_1",
        sequence: 1,
        type: "run.started",
        message: "builder run started",
        payload: { role: "builder" },
        createdAt: "2026-05-14T00:00:01.000Z"
      }
    ];

    const thread = createChatWorkbenchThread({
      copy,
      prompt: "Create LP",
      objective: "Convert",
      pageVersion: {
        id: "version_1",
        projectId: "project_1",
        briefId: "brief_1",
        artifacts: completeArtifacts(),
        reviewStatus: "passed",
        findings: [],
        createdAt: "2026-05-14T00:00:00.000Z"
      },
      downloadLinks: [],
      runEvents
    });

    expect(thread.toolEvents.map((event) => event.id)).toEqual([
      "run_planner_brief_1:1",
      "run_builder_version_1:1"
    ]);
    expect(thread.toolEvents[0]).toMatchObject({
      role: "planner",
      operation: "planner run started"
    });
  });

  it("includes single html and three static file artifact cards", async () => {
    const copy = getWorkbenchCopy("en");
    const snapshot = await createDemoWorkbenchSnapshot();
    const downloadLinks = createArtifactDownloadLinks(snapshot.pageVersion.artifacts, copy.exports);

    const thread = createChatWorkbenchThread({
      copy,
      prompt: snapshot.brief.prompt,
      objective: copy.demo.objective,
      pageVersion: snapshot.pageVersion,
      downloadLinks
    });

    expect(thread.artifacts.map((artifact) => artifact.filename)).toEqual([
      "index.single.html",
      "index.html",
      "styles.css",
      "script.js"
    ]);
    expect(thread.artifacts[0]?.kind).toBe(copy.chat.artifactKinds.single);
    expect(thread.artifacts.slice(1).every((artifact) => artifact.kind === copy.chat.artifactKinds.static)).toBe(true);
  });

  it("exposes reviewer metadata from review status and findings", async () => {
    const copy = getWorkbenchCopy("en");
    const snapshot = await createDemoWorkbenchSnapshot();
    const downloadLinks = createArtifactDownloadLinks(snapshot.pageVersion.artifacts, copy.exports);

    const thread = createChatWorkbenchThread({
      copy,
      prompt: snapshot.brief.prompt,
      objective: copy.demo.objective,
      pageVersion: snapshot.pageVersion,
      downloadLinks
    });
    const reviewer = thread.toolEvents.find((event) => event.role === "reviewer");

    expect(reviewer?.meta).toContain(copy.status.passed);
    expect(reviewer?.meta).toContain("0");
  });
});

function completeArtifacts(): StaticArtifacts {
  return {
    indexHtml: "<main>LP</main>",
    stylesCss: "body { margin: 0; }",
    scriptJs: "console.log('ready');"
  };
}
