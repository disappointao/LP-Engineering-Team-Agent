import { describe, expect, it } from "vitest";
import { createInMemoryWorkbenchRepositories } from "@lp-agent/db";
import {
  AgentHandoffRecordSchema,
  assembleRuntimeHandoffs,
  createAgentHandoffRecord,
  markInboundHandoffsConsumed,
  sanitizeHandoffText,
  toHandoffRunEventDraft
} from "./agent-handoffs";

describe("agent handoffs", () => {
  it("validates and sanitizes handoff records", () => {
    const handoff = createAgentHandoffRecord({
      id: "handoff_1",
      projectId: "project_1",
      taskId: "task_1",
      fromRunId: "run_reviewer_1",
      fromRole: "reviewer",
      toRole: "deployer",
      state: "blocked",
      summary: "Reviewer blocked deployment with OPENAI_API_KEY=sk-test-secret",
      blockingReason: "<html>secret-token</html>",
      artifactRefs: {
        pageVersionId: "version_1"
      },
      now: () => new Date("2026-05-15T08:00:00.000Z")
    });

    expect(AgentHandoffRecordSchema.parse(handoff)).toMatchObject({
      id: "handoff_1",
      state: "blocked",
      summary: expect.stringContaining("[REDACTED]"),
      blockingReason: expect.stringContaining("[artifact omitted]")
    });
    expect(JSON.stringify(handoff)).not.toContain("sk-test-secret");
    expect(JSON.stringify(handoff)).not.toContain("secret-token");
    expect(JSON.stringify(handoff)).not.toContain("<html>");
  });

  it("creates safe handoff event drafts", () => {
    const event = toHandoffRunEventDraft({
      id: "handoff_1",
      projectId: "project_1",
      taskId: "task_1",
      fromRunId: "run_planner_1",
      fromRole: "planner",
      toRole: "builder",
      state: "ready",
      summary: "Planner produced LP brief",
      artifactRefs: {
        briefId: "brief_1"
      },
      createdAt: "2026-05-15T08:00:00.000Z",
      updatedAt: "2026-05-15T08:00:00.000Z"
    });

    expect(event).toEqual({
      type: "handoff.created",
      message: "Agent handoff ready.",
      payload: {
        handoffId: "handoff_1",
        fromRunId: "run_planner_1",
        fromRole: "planner",
        toRole: "builder",
        state: "ready",
        summary: "Planner produced LP brief",
        artifactRefs: {
          briefId: "brief_1"
        }
      }
    });
  });

  it("selects role-relevant handoffs for runtime context", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.agentHandoffs.save(
      createAgentHandoffRecord({
        id: "handoff_inbound",
        projectId: "project_1",
        taskId: "task_1",
        fromRunId: "run_builder_1",
        fromRole: "builder",
        toRole: "reviewer",
        state: "ready",
        summary: "Builder produced static LP artifacts",
        artifactRefs: {
          pageVersionId: "version_1"
        },
        now: () => new Date("2026-05-15T08:00:00.000Z")
      })
    );
    await repositories.agentHandoffs.save(
      createAgentHandoffRecord({
        id: "handoff_other_project",
        projectId: "project_2",
        fromRunId: "run_builder_2",
        fromRole: "builder",
        toRole: "reviewer",
        state: "ready",
        summary: "Other project",
        now: () => new Date("2026-05-15T08:01:00.000Z")
      })
    );

    const result = await assembleRuntimeHandoffs({
      repositories,
      projectId: "project_1",
      taskId: "task_1",
      role: "reviewer",
      limit: 6
    });

    expect(result.handoffs).toEqual([
      expect.objectContaining({
        id: "handoff_inbound",
        fromRole: "builder",
        toRole: "reviewer",
        state: "ready"
      })
    ]);
    expect(result.trace.injected).toEqual(["handoffs:1"]);
    expect(result.trace.omitted).toEqual([]);
  });

  it("marks ready inbound handoffs consumed", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.agentHandoffs.save(
      createAgentHandoffRecord({
        id: "handoff_1",
        projectId: "project_1",
        taskId: "task_1",
        fromRunId: "run_planner_1",
        fromRole: "planner",
        toRole: "builder",
        state: "ready",
        summary: "Planner produced LP brief",
        artifactRefs: {
          briefId: "brief_1"
        },
        now: () => new Date("2026-05-15T08:00:00.000Z")
      })
    );

    const events = await markInboundHandoffsConsumed({
      repositories,
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      now: () => new Date("2026-05-15T08:01:00.000Z")
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "handoff.consumed",
        payload: expect.objectContaining({
          handoffId: "handoff_1",
          state: "consumed"
        })
      })
    ]);
    await expect(repositories.agentHandoffs.getById("handoff_1")).resolves.toEqual(
      expect.objectContaining({
        state: "consumed",
        updatedAt: "2026-05-15T08:01:00.000Z"
      })
    );
  });

  it("redacts common secret-like strings", () => {
    expect(sanitizeHandoffText("OPENAI_API_KEY=sk-test-secret and secret-token")).toBe(
      "OPENAI_API_KEY=[REDACTED] and [REDACTED]"
    );
  });
});
