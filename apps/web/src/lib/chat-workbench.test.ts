import { describe, expect, it } from "vitest";
import type { StaticArtifacts } from "@lp-agent/artifacts";
import type { PageVersionRecord, RunEventRecord } from "@lp-agent/api";
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

  it("renders deployment skill command events with sanitized metadata", () => {
    const runEvents: RunEventRecord[] = [
      {
        id: "run_skill_command_1_event_1",
        runId: "run_skill_command_1",
        projectId: "project_1",
        sequence: 1,
        type: "tool.started",
        message: "Deployment skill command started.",
        payload: {
          role: "deployer",
          skillId: "skill_static_deploy",
          commandId: "publish_static"
        },
        createdAt: "2026-05-15T08:00:00.000Z"
      },
      {
        id: "run_skill_command_1_event_2",
        runId: "run_skill_command_1",
        projectId: "project_1",
        sequence: 2,
        type: "tool.completed",
        message: "Deployment skill command completed.",
        payload: {
          role: "deployer",
          commandId: "publish_static",
          exitCode: 0,
          outputSummary: "stdout: 47 chars\nstderr: 0 chars",
          rawOutput: "secret-token",
          secretEnvValue: "secret-token"
        },
        createdAt: "2026-05-15T08:00:01.000Z"
      }
    ];

    const thread = createChatWorkbenchThread({
      copy: getWorkbenchCopy("en"),
      prompt: "Create LP",
      objective: "Convert shoppers",
      pageVersion: pageVersionFixture(),
      downloadLinks: [],
      runEvents
    });

    expect(thread.toolEvents.map((event) => event.label)).toEqual(["Deployer", "Deployer"]);
    expect(thread.toolEvents[1]?.meta).toBe(
      "tool.completed - publish_static - exit 0 - stdout: 47 chars\nstderr: 0 chars"
    );
    expect(thread.toolEvents[1]?.meta).not.toContain("secret-token");
  });

  it("defaults tool events without a payload role to the deployer timeline lane", () => {
    const thread = createChatWorkbenchThread({
      copy: getWorkbenchCopy("en"),
      prompt: "Create LP",
      objective: "Convert shoppers",
      pageVersion: pageVersionFixture(),
      downloadLinks: [],
      runEvents: [
        {
          id: "run_skill_command_1_event_1",
          runId: "run_skill_command_1",
          projectId: "project_1",
          sequence: 1,
          type: "tool.started",
          message: "Deployment skill command started.",
          payload: {
            commandId: "publish_static"
          },
          createdAt: "2026-05-15T08:00:00.000Z"
        }
      ]
    });

    expect(thread.toolEvents[0]).toMatchObject({
      role: "deployer",
      label: "Deployer",
      meta: "tool.started - publish_static"
    });
  });

  it("marks failed tool events with failed status copy", () => {
    const thread = createChatWorkbenchThread({
      copy: getWorkbenchCopy("en"),
      prompt: "Create LP",
      objective: "Convert shoppers",
      pageVersion: pageVersionFixture(),
      downloadLinks: [],
      runEvents: [
        {
          id: "run_skill_command_1_event_2",
          runId: "run_skill_command_1",
          projectId: "project_1",
          sequence: 2,
          type: "tool.failed",
          message: "Deployment skill command failed.",
          payload: {
            role: "deployer",
            commandId: "publish_static",
            exitCode: 1,
            errorName: "simulated_command_failed",
            outputSummary: "stdout: 0 chars\nstderr: 26 chars"
          },
          createdAt: "2026-05-15T08:00:01.000Z"
        }
      ]
    });

    expect(thread.toolEvents[0]).toMatchObject({
      role: "deployer",
      status: "failed",
      statusLabel: "failed"
    });
    expect(thread.toolEvents[0]?.meta).toContain("simulated_command_failed");
  });

  it("marks task interrupt requested events as running timeline state", () => {
    const thread = createChatWorkbenchThread({
      copy: getWorkbenchCopy("en"),
      prompt: "Create LP",
      objective: "Convert shoppers",
      pageVersion: pageVersionFixture(),
      downloadLinks: [],
      runEvents: [
        {
          id: "run_interrupt_1_event_2",
          runId: "run_interrupt_1",
          projectId: "project_1",
          taskId: "task_1",
          sequence: 2,
          type: "task.interrupt.requested",
          message: "Task interrupt requested.",
          payload: {
            role: "deployer",
            workerJobId: "worker_job_1"
          },
          createdAt: "2026-05-18T00:00:01.000Z"
        }
      ]
    });

    expect(thread.toolEvents[0]).toMatchObject({
      status: "running",
      statusLabel: "Running"
    });
  });

  it("marks interrupt requested events complete when the same run has a cancelled event", () => {
    const thread = createChatWorkbenchThread({
      copy: getWorkbenchCopy("en"),
      prompt: "Create LP",
      objective: "Convert shoppers",
      pageVersion: pageVersionFixture(),
      downloadLinks: [],
      runEvents: [
        {
          id: "run_interrupt_1_event_2",
          runId: "run_interrupt_1",
          projectId: "project_1",
          taskId: "task_1",
          sequence: 2,
          type: "task.interrupt.requested",
          message: "Task interrupt requested.",
          payload: {
            role: "deployer",
            workerJobId: "worker_job_1"
          },
          createdAt: "2026-05-18T00:00:01.000Z"
        },
        {
          id: "run_interrupt_1_event_3",
          runId: "run_interrupt_1",
          projectId: "project_1",
          taskId: "task_1",
          sequence: 3,
          type: "task.interrupt.cancelled",
          message: "Task interrupted.",
          payload: {
            role: "deployer",
            workerJobId: "worker_job_1"
          },
          createdAt: "2026-05-18T00:00:02.000Z"
        }
      ]
    });

    expect(thread.toolEvents[0]).toMatchObject({
      status: "complete",
      statusLabel: "Complete"
    });
    expect(thread.toolEvents[1]).toMatchObject({
      status: "cancelled",
      statusLabel: "Stopped"
    });
  });

  it("marks started events as complete when the run has a terminal event", () => {
    const thread = createChatWorkbenchThread({
      copy: getWorkbenchCopy("en"),
      prompt: "Create LP",
      objective: "Convert shoppers",
      pageVersion: pageVersionFixture(),
      downloadLinks: [],
      runEvents: [
        {
          id: "run_builder_1_event_1",
          runId: "run_builder_1",
          projectId: "project_1",
          sequence: 1,
          type: "run.started",
          message: "Builder run started.",
          payload: {
            role: "builder"
          },
          createdAt: "2026-05-18T00:00:01.000Z"
        },
        {
          id: "run_builder_1_event_2",
          runId: "run_builder_1",
          projectId: "project_1",
          sequence: 2,
          type: "run.completed",
          message: "Builder run completed.",
          payload: {
            role: "builder"
          },
          createdAt: "2026-05-18T00:00:02.000Z"
        }
      ]
    });

    expect(thread.toolEvents[0]).toMatchObject({
      status: "complete",
      statusLabel: "Complete"
    });
  });

  it("marks started events as running when the run has no terminal event", () => {
    const thread = createChatWorkbenchThread({
      copy: getWorkbenchCopy("en"),
      prompt: "Create LP",
      objective: "Convert shoppers",
      pageVersion: pageVersionFixture(),
      downloadLinks: [],
      runEvents: [
        {
          id: "run_builder_1_event_1",
          runId: "run_builder_1",
          projectId: "project_1",
          sequence: 1,
          type: "run.started",
          message: "Builder run started.",
          payload: {
            role: "builder"
          },
          createdAt: "2026-05-18T00:00:01.000Z"
        }
      ]
    });

    expect(thread.toolEvents[0]).toMatchObject({
      status: "running",
      statusLabel: "Running"
    });
  });

  it("marks cancelled tool and task events as cancelled timeline state", () => {
    const thread = createChatWorkbenchThread({
      copy: getWorkbenchCopy("en"),
      prompt: "Create LP",
      objective: "Convert shoppers",
      pageVersion: pageVersionFixture(),
      downloadLinks: [],
      runEvents: [
        {
          id: "run_interrupt_1_event_3",
          runId: "run_interrupt_1",
          projectId: "project_1",
          taskId: "task_1",
          sequence: 3,
          type: "task.interrupt.cancelled",
          message: "Task interrupted.",
          payload: {
            role: "deployer",
            workerJobId: "worker_job_1"
          },
          createdAt: "2026-05-18T00:00:02.000Z"
        },
        {
          id: "run_interrupt_1_event_4",
          runId: "run_interrupt_1",
          projectId: "project_1",
          taskId: "task_1",
          sequence: 4,
          type: "tool.cancelled",
          message: "Deployment skill command cancelled.",
          payload: {
            role: "deployer",
            commandId: "publish_static",
            errorName: "worker_job_cancelled",
            outputSummary: "stdout: 0 chars\nstderr: 21 chars"
          },
          createdAt: "2026-05-18T00:00:03.000Z"
        }
      ]
    });

    expect(thread.toolEvents.map((event) => event.status)).toEqual([
      "cancelled",
      "cancelled"
    ]);
    expect(thread.toolEvents.every((event) => event.statusLabel === "Stopped")).toBe(true);
  });

  it("marks completed queued worker timeline events complete after terminal event", () => {
    const thread = createChatWorkbenchThread({
      copy: getWorkbenchCopy("en"),
      prompt: "Create LP",
      objective: "Convert shoppers",
      pageVersion: pageVersionFixture(),
      downloadLinks: [],
      runEvents: [
        {
          id: "run_skill_command_1_event_1",
          runId: "run_skill_command_1",
          projectId: "project_1",
          sequence: 1,
          type: "tool.started",
          message: "Deployment skill command started.",
          payload: {
            role: "deployer",
            commandId: "publish_static"
          },
          createdAt: "2026-05-18T00:00:01.000Z"
        },
        {
          id: "run_skill_command_1_event_2",
          runId: "run_skill_command_1",
          projectId: "project_1",
          sequence: 2,
          type: "worker.job.linked",
          message: "Worker job linked.",
          payload: {
            role: "deployer",
            commandId: "publish_static",
            workerJobId: "worker_job_1"
          },
          createdAt: "2026-05-18T00:00:02.000Z"
        },
        {
          id: "run_skill_command_1_event_3",
          runId: "run_skill_command_1",
          projectId: "project_1",
          sequence: 3,
          type: "tool.completed",
          message: "Deployment skill command completed.",
          payload: {
            role: "deployer",
            commandId: "publish_static",
            workerJobId: "worker_job_1",
            exitCode: 0
          },
          createdAt: "2026-05-18T00:00:03.000Z"
        }
      ]
    });

    expect(thread.toolEvents.map((event) => event.status)).toEqual([
      "complete",
      "complete",
      "complete"
    ]);
    expect(thread.toolEvents.map((event) => event.meta)).toContain(
      "worker.job.linked - publish_static - worker_job_1"
    );
  });

  it("marks cancelled queued worker timeline events cancelled after terminal event", () => {
    const thread = createChatWorkbenchThread({
      copy: getWorkbenchCopy("en"),
      prompt: "Create LP",
      objective: "Convert shoppers",
      pageVersion: pageVersionFixture(),
      downloadLinks: [],
      runEvents: [
        {
          id: "run_skill_command_1_event_1",
          runId: "run_skill_command_1",
          projectId: "project_1",
          sequence: 1,
          type: "tool.started",
          message: "Deployment skill command started.",
          payload: {
            role: "deployer",
            commandId: "publish_static"
          },
          createdAt: "2026-05-18T00:00:01.000Z"
        },
        {
          id: "run_skill_command_1_event_2",
          runId: "run_skill_command_1",
          projectId: "project_1",
          sequence: 2,
          type: "worker.job.linked",
          message: "Worker job linked.",
          payload: {
            role: "deployer",
            commandId: "publish_static",
            workerJobId: "worker_job_1"
          },
          createdAt: "2026-05-18T00:00:02.000Z"
        },
        {
          id: "run_skill_command_1_event_3",
          runId: "run_skill_command_1",
          projectId: "project_1",
          sequence: 3,
          type: "tool.cancelled",
          message: "Deployment skill command cancelled.",
          payload: {
            role: "deployer",
            commandId: "publish_static",
            workerJobId: "worker_job_1"
          },
          createdAt: "2026-05-18T00:00:03.000Z"
        }
      ]
    });

    expect(thread.toolEvents.map((event) => event.status)).toEqual([
      "cancelled",
      "cancelled",
      "cancelled"
    ]);
    expect(thread.toolEvents.map((event) => event.meta)).toContain(
      "worker.job.linked - publish_static - worker_job_1"
    );
  });

  it("marks failed queued worker timeline events failed after terminal event", () => {
    const thread = createChatWorkbenchThread({
      copy: getWorkbenchCopy("en"),
      prompt: "Create LP",
      objective: "Convert shoppers",
      pageVersion: pageVersionFixture(),
      downloadLinks: [],
      runEvents: [
        {
          id: "run_skill_command_1_event_1",
          runId: "run_skill_command_1",
          projectId: "project_1",
          sequence: 1,
          type: "tool.started",
          message: "Deployment skill command started.",
          payload: {
            role: "deployer",
            commandId: "publish_static"
          },
          createdAt: "2026-05-18T00:00:01.000Z"
        },
        {
          id: "run_skill_command_1_event_2",
          runId: "run_skill_command_1",
          projectId: "project_1",
          sequence: 2,
          type: "worker.job.linked",
          message: "Worker job linked.",
          payload: {
            role: "deployer",
            commandId: "publish_static",
            workerJobId: "worker_job_1"
          },
          createdAt: "2026-05-18T00:00:02.000Z"
        },
        {
          id: "run_skill_command_1_event_3",
          runId: "run_skill_command_1",
          projectId: "project_1",
          sequence: 3,
          type: "tool.failed",
          message: "Deployment skill command failed.",
          payload: {
            role: "deployer",
            commandId: "publish_static",
            workerJobId: "worker_job_1",
            errorName: "worker_job_execution_failed"
          },
          createdAt: "2026-05-18T00:00:03.000Z"
        }
      ]
    });

    expect(thread.toolEvents.map((event) => event.status)).toEqual([
      "failed",
      "failed",
      "failed"
    ]);
    expect(thread.toolEvents.map((event) => event.meta)).toContain(
      "worker.job.linked - publish_static - worker_job_1"
    );
  });

  it("keeps active queued worker timeline events running without terminal event", () => {
    const thread = createChatWorkbenchThread({
      copy: getWorkbenchCopy("en"),
      prompt: "Create LP",
      objective: "Convert shoppers",
      pageVersion: pageVersionFixture(),
      downloadLinks: [],
      runEvents: [
        {
          id: "run_skill_command_1_event_1",
          runId: "run_skill_command_1",
          projectId: "project_1",
          sequence: 1,
          type: "tool.started",
          message: "Deployment skill command started.",
          payload: {
            role: "deployer",
            commandId: "publish_static"
          },
          createdAt: "2026-05-18T00:00:01.000Z"
        },
        {
          id: "run_skill_command_1_event_2",
          runId: "run_skill_command_1",
          projectId: "project_1",
          sequence: 2,
          type: "worker.job.linked",
          message: "Worker job linked.",
          payload: {
            role: "deployer",
            commandId: "publish_static",
            workerJobId: "worker_job_1"
          },
          createdAt: "2026-05-18T00:00:02.000Z"
        }
      ]
    });

    expect(thread.toolEvents.map((event) => event.status)).toEqual([
      "running",
      "running"
    ]);
    expect(thread.toolEvents.map((event) => event.meta)).toContain(
      "worker.job.linked - publish_static - worker_job_1"
    );
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

function pageVersionFixture(): PageVersionRecord {
  return {
    id: "version_1",
    projectId: "project_1",
    briefId: "brief_1",
    artifactWorkspaceId: "artifact_workspace_1",
    artifacts: completeArtifacts(),
    reviewStatus: "passed",
    findings: [],
    createdAt: "2026-05-15T08:00:00.000Z"
  };
}
