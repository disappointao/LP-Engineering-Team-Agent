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

  it("ranks current task and keyword matched messages before older non-matches", async () => {
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
      id: "task_old",
      title: "Old build",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-01T00:00:00.000Z"
    });
    await repositories.messages.save({
      id: "message_match",
      taskId: "task_current",
      role: "assistant",
      content: "Use a spring sale offer with a strong returning customers CTA.",
      createdAt: "2026-05-14T00:01:00.000Z"
    });
    await repositories.messages.save({
      id: "message_old",
      taskId: "task_old",
      role: "assistant",
      content: "Draft a neutral page about winter inventory.",
      createdAt: "2026-05-01T00:01:00.000Z"
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
          audience: "Returning customers",
          offer: "Spring sale offer"
        }
      },
      now: () => new Date("2026-05-15T00:00:00.000Z")
    });

    expect(memory.messages[0]?.id).toBe("message_match");
    expect(memory.messages[0]?.score).toBeGreaterThan(memory.messages[1]?.score ?? 0);
  });
});
