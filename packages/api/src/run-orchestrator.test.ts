import { describe, expect, it } from "vitest";
import { createInMemoryWorkbenchRepositories } from "@lp-agent/db";
import {
  createDefaultRuntimeContext,
  type AgentRuntimeAdapter
} from "@lp-agent/runtime-adapters";
import { runAgentStep } from "./run-orchestrator";

describe("run agent step finalization", () => {
  it("lets API post-processing change terminal run state before events persist", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.projects.save({
      id: "project_1",
      name: "Project",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    const runtime: AgentRuntimeAdapter = {
      async run(request) {
        return {
          runId: request.runId,
          projectId: request.projectId,
          role: request.role,
          state: "completed",
          modelOutputText: "RAW_MODEL_OUTPUT_SECRET",
          events: [
            {
              type: "run.started",
              message: "planner run started",
              runId: request.runId,
              role: request.role
            },
            {
              type: "run.completed",
              message: "planner run completed",
              runId: request.runId,
              state: "completed"
            }
          ]
        };
      }
    };
    const service = {
      async createRuntimeContextForRole() {
        return createDefaultRuntimeContext();
      }
    };

    const result = await runAgentStep({
      repositories,
      service,
      runtime,
      runId: "run_planner_brief_1",
      projectId: "project_1",
      role: "planner",
      input: { prompt: "Plan" },
      now: () => new Date("2026-05-14T00:00:00.000Z"),
      finalizeResult({ result: runtimeResult }) {
        return {
          ...runtimeResult,
          state: "failed",
          events: [
            ...runtimeResult.events.filter((event) => event.type !== "run.completed"),
            {
              type: "model.output.parse_failed",
              message: "Planner output could not be parsed as LP brief",
              runId: runtimeResult.runId,
              role: "planner",
              schema: "LPBriefSchema",
              reason: "invalid_json"
            },
            {
              type: "run.failed",
              message: "Planner run failed.",
              runId: runtimeResult.runId,
              role: "planner",
              state: "failed",
              errorName: "PlannerLPBriefParseError"
            }
          ]
        };
      }
    });

    expect(result.run.state).toBe("failed");
    const events = await repositories.runEvents.listForProject("project_1");
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "model.output.parse_failed",
      "run.failed"
    ]);
    expect(JSON.stringify(events)).not.toContain("RAW_MODEL_OUTPUT_SECRET");
  });
});
