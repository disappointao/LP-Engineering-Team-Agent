import { describe, expect, it } from "vitest";
import { createInMemoryWorkbenchRepositories } from "@lp-agent/db";
import { sampleBrief } from "@lp-agent/lp-schema";
import {
  assembleContextMemory,
  ContextMemorySchema,
  toContextMemoryQuery,
  truncatePreview
} from "./context-memory";

describe("context memory", () => {
  it("accepts deterministic memory shape with one message and empty runs/tools/artifacts", () => {
    expect(
      ContextMemorySchema.parse({
        projectId: "project_1",
        taskId: "task_1",
        role: "builder",
        strategy: "deterministic-keyword-v0",
        query: "builder Build a spring sale page",
        messages: [
          {
            id: "message_1",
            taskId: "task_1",
            role: "user",
            preview: "Build a spring sale page",
            createdAt: "2026-05-14T00:00:00.000Z",
            score: 17.25
          }
        ],
        runs: [],
        tools: [],
        artifacts: [],
        retrieval: {
          query: "builder Build a spring sale page",
          strategy: "deterministic-keyword-v0",
          selected: ["message:message_1"],
          omitted: ["memory:runs:none", "memory:tools:none", "memory:artifacts:none"]
        }
      })
    ).toMatchObject({
      messages: [expect.objectContaining({ id: "message_1" })],
      runs: [],
      tools: [],
      artifacts: []
    });
  });

  it("derives a context memory query from role, prompt, and brief fields", () => {
    expect(
      toContextMemoryQuery({
        role: "builder",
        input: {
          prompt: "Build a spring sale page",
          brief: {
            ...sampleBrief,
            objective: "Convert paid shoppers",
            audience: "Returning customers",
            offer: "Save 20%",
            primaryCta: "Shop now"
          } as typeof sampleBrief & { primaryCta: string }
        }
      })
    ).toBe(
      "builder Build a spring sale page Convert paid shoppers Returning customers Save 20% Shop now"
    );
  });

  it("truncates previews at the character limit", () => {
    expect(truncatePreview("abcdef", 4)).toBe("abcd");
    expect(truncatePreview("abc", 4)).toBe("abc");
  });

  it("retrieves only messages scoped to the same project and records empty omissions", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.tasks.save({
      id: "task_1",
      title: "Current build",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    await repositories.tasks.save({
      id: "task_2",
      title: "Other project",
      type: "lp_generation",
      status: "complete",
      projectId: "project_2",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    await repositories.messages.save({
      id: "message_1",
      taskId: "task_1",
      role: "user",
      content: "Build a spring sale page for returning customers.",
      createdAt: "2026-05-14T00:01:00.000Z"
    });
    await repositories.messages.save({
      id: "message_secret",
      taskId: "task_2",
      role: "assistant",
      content: "Other project secret-token",
      createdAt: "2026-05-14T00:02:00.000Z"
    });

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      input: {
        prompt: "Build a spring sale page",
        brief: sampleBrief
      },
      now: () => new Date("2026-05-15T00:00:00.000Z")
    });

    expect(memory.messages.map((message) => message.id)).toEqual(["message_1"]);
    expect(JSON.stringify(memory)).not.toContain("secret-token");
    expect(memory.retrieval.selected).toContain("message:message_1");
    expect(memory.retrieval.omitted).toEqual(
      expect.arrayContaining([
        "memory:runs:none",
        "memory:tools:none",
        "memory:artifacts:none"
      ])
    );
  });

  it("ranks current task non-matches before non-current non-matches", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.tasks.save({
      id: "task_current",
      title: "Current build",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    await repositories.tasks.save({
      id: "task_other",
      title: "Other build",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    await repositories.messages.save({
      id: "message_current",
      taskId: "task_current",
      role: "assistant",
      content: "Draft a neutral page about winter inventory.",
      createdAt: "2026-05-14T00:01:00.000Z"
    });
    await repositories.messages.save({
      id: "message_other",
      taskId: "task_other",
      role: "assistant",
      content: "Draft a neutral page about winter inventory.",
      createdAt: "2026-05-14T00:01:00.000Z"
    });

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      taskId: "task_current",
      role: "builder",
      input: {
        prompt: "Build a spring sale page"
      },
      now: () => new Date("2026-05-15T00:00:00.000Z")
    });

    expect(memory.messages[0]?.id).toBe("message_current");
    expect(memory.messages[0]?.score).toBeGreaterThan(memory.messages[1]?.score ?? 0);
  });

  it("ranks non-current keyword matches before non-current non-matches", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.tasks.save({
      id: "task_keyword",
      title: "Keyword build",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    await repositories.tasks.save({
      id: "task_neutral",
      title: "Neutral build",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    await repositories.messages.save({
      id: "message_keyword",
      taskId: "task_keyword",
      role: "assistant",
      content: "Use a spring sale offer with a strong CTA.",
      createdAt: "2026-05-14T00:01:00.000Z"
    });
    await repositories.messages.save({
      id: "message_neutral",
      taskId: "task_neutral",
      role: "assistant",
      content: "Draft a neutral page about winter inventory.",
      createdAt: "2026-05-14T00:01:00.000Z"
    });

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      taskId: "task_current",
      role: "builder",
      input: {
        prompt: "Build a spring sale page",
        brief: {
          ...sampleBrief,
          objective: "Convert paid shoppers",
          audience: "Returning customers"
        }
      },
      now: () => new Date("2026-05-15T00:00:00.000Z")
    });

    expect(memory.messages[0]?.id).toBe("message_keyword");
    expect(memory.messages[0]?.score).toBeGreaterThan(memory.messages[1]?.score ?? 0);
  });

  it("summarizes failed runs and tool observations without raw output", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.tasks.save({
      id: "task_1",
      title: "Deploy landing page",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    await repositories.runs.save({
      id: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "deployer",
      state: "failed",
      startedAt: "2026-05-14T00:01:00.000Z",
      completedAt: "2026-05-14T00:02:00.000Z",
      contextSummary: {
        injected: [],
        omitted: []
      }
    });
    await repositories.runEvents.save({
      id: "event_1",
      runId: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      sequence: 1,
      type: "run.failed",
      message: "Deployment failed.",
      payload: {
        rawOutput: "published secret-token <html>full artifact</html>"
      },
      createdAt: "2026-05-14T00:02:00.000Z"
    });
    await repositories.toolObservations.save({
      id: "tool_1",
      runId: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      toolName: "skill:deploy:publish",
      input: {
        rawOutput: "published secret-token <html>full artifact</html>"
      },
      outputSummary: "stdout: 47 chars\nstderr: 0 chars",
      state: "failed",
      exitCode: 1,
      errorName: "deploy_failed",
      createdAt: "2026-05-14T00:01:30.000Z",
      completedAt: "2026-05-14T00:02:00.000Z"
    });

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      taskId: "task_1",
      role: "deployer",
      input: {
        prompt: "Deploy the spring sale landing page"
      }
    });

    expect(memory.runs).toEqual([
      expect.objectContaining({
        id: "run_1",
        taskId: "task_1",
        role: "deployer",
        state: "failed",
        eventTypes: ["run.failed"]
      })
    ]);
    expect(memory.tools).toEqual([
      {
        id: "tool_1",
        runId: "run_1",
        taskId: "task_1",
        toolName: "skill:deploy:publish",
        state: "failed",
        outputSummary: "stdout: 47 chars\nstderr: 0 chars",
        exitCode: 1,
        errorName: "deploy_failed",
        createdAt: "2026-05-14T00:01:30.000Z",
        completedAt: "2026-05-14T00:02:00.000Z",
        score: expect.any(Number)
      }
    ]);
    const serialized = JSON.stringify(memory);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("<html>");
    expect(serialized).not.toContain("published");
  });

  it("summarizes artifacts as metadata without full source", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.briefs.save({
      id: "brief_1",
      projectId: "project_1",
      prompt: "Build a spring sale landing page",
      brief: {
        ...sampleBrief,
        title: "Spring Sale Landing Page",
        objective: "Convert paid traffic"
      },
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    await repositories.pageVersions.save({
      id: "page_version_1",
      projectId: "project_1",
      briefId: "brief_1",
      artifacts: {
        indexHtml: "<!doctype html><html><body>secret-token</body></html>",
        stylesCss: "body { color: red; }",
        scriptJs: "console.log('secret-token');"
      },
      reviewStatus: "passed",
      findings: [],
      createdAt: "2026-05-14T00:03:00.000Z"
    });

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      role: "builder",
      input: {
        prompt: "Build a spring sale page",
        brief: sampleBrief
      }
    });

    expect(memory.artifacts).toEqual([
      {
        pageVersionId: "page_version_1",
        briefId: "brief_1",
        title: "Spring Sale Landing Page",
        objective: "Convert paid traffic",
        files: [
          { name: "index.html", characterCount: 53 },
          { name: "styles.css", characterCount: 20 },
          { name: "script.js", characterCount: 28 }
        ],
        createdAt: "2026-05-14T00:03:00.000Z",
        score: expect.any(Number)
      }
    ]);
    const serialized = JSON.stringify(memory);
    expect(serialized).not.toContain("<!doctype html>");
    expect(serialized).not.toContain("console.log");
    expect(serialized).not.toContain("secret-token");
  });

  it("does not emit empty artifact title or objective when the linked brief is missing", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.pageVersions.save({
      id: "page_version_missing_brief",
      projectId: "project_1",
      briefId: "brief_missing",
      artifacts: {
        indexHtml: "<!doctype html><html><body>secret-token</body></html>",
        stylesCss: "body { color: red; }",
        scriptJs: "console.log('secret-token');"
      },
      reviewStatus: "passed",
      findings: [],
      createdAt: "2026-05-14T00:03:00.000Z"
    });

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      role: "builder",
      input: {
        prompt: "Build a spring sale page",
        brief: sampleBrief
      }
    });

    expect(memory.artifacts).toEqual([
      {
        pageVersionId: "page_version_missing_brief",
        briefId: "brief_missing",
        files: [
          { name: "index.html", characterCount: 53 },
          { name: "styles.css", characterCount: 20 },
          { name: "script.js", characterCount: 28 }
        ],
        createdAt: "2026-05-14T00:03:00.000Z",
        score: expect.any(Number)
      }
    ]);
    expect(memory.artifacts[0]).not.toHaveProperty("title");
    expect(memory.artifacts[0]).not.toHaveProperty("objective");
    const serialized = JSON.stringify(memory);
    expect(serialized).not.toContain("<!doctype html>");
    expect(serialized).not.toContain("color: red");
    expect(serialized).not.toContain("console.log");
    expect(serialized).not.toContain("secret-token");
  });

  it("records budget omissions when source records exceed limits", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.tasks.save({
      id: "task_1",
      title: "Current build",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    for (const id of ["message_1", "message_2", "message_3"]) {
      await repositories.messages.save({
        id,
        taskId: "task_1",
        role: "assistant",
        content: `Relevant spring sale note ${id}`,
        createdAt: `2026-05-14T00:0${id.at(-1)}:00.000Z`
      });
    }

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      input: {
        prompt: "Build a spring sale page"
      },
      limits: {
        messages: 1,
        runs: 0,
        tools: 0,
        artifacts: 0
      }
    });

    expect(memory.messages).toHaveLength(1);
    expect(memory.retrieval.omitted).toEqual(
      expect.arrayContaining([
        "memory:messages:budget_exceeded",
        "memory:runs:none",
        "memory:tools:none",
        "memory:artifacts:none"
      ])
    );
  });

  it("applies the total memory character budget after source selection", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.tasks.save({
      id: "task_1",
      title: "Current build",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    for (const id of ["message_1", "message_2", "message_3"]) {
      await repositories.messages.save({
        id,
        taskId: "task_1",
        role: "assistant",
        content: `Spring sale detail ${id} ${"x".repeat(240)}`,
        createdAt: `2026-05-14T00:0${id.at(-1)}:00.000Z`
      });
    }

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      input: {
        prompt: "Build a spring sale page"
      },
      limits: {
        messages: 3,
        totalCharacters: 520
      }
    });

    expect(memory.messages.length).toBeLessThan(3);
    expect(memory.retrieval.omitted).toContain("memory:total:budget_exceeded");
  });
});
