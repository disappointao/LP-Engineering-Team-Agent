import { describe, expect, it } from "vitest";
import {
  createInMemoryWorkbenchRepositories,
  type RunEventRecord,
  type RunRecord,
  type RunRecordState,
  type WorkbenchRepositories
} from "@lp-agent/db";
import { deriveRunLifecycleView } from "./run-lifecycle";

function runRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run_planner_1",
    projectId: "project_1",
    taskId: "task_1",
    role: "planner",
    state: "running",
    startedAt: "2026-05-19T00:00:00.000Z",
    contextSummary: {
      injected: [],
      omitted: []
    },
    ...overrides
  };
}

async function saveRun(
  repositories: WorkbenchRepositories,
  overrides: Partial<RunRecord> = {}
): Promise<RunRecord> {
  const run = runRecord(overrides);
  await repositories.runs.save(run);
  return run;
}

async function saveEvent(
  repositories: WorkbenchRepositories,
  input: {
    runId?: string;
    type: string;
    message?: string;
    sequence?: number;
    payload?: Record<string, unknown>;
  }
): Promise<RunEventRecord> {
  const event: RunEventRecord = {
    id: `${input.runId ?? "run_planner_1"}_event_${input.sequence ?? 1}`,
    runId: input.runId ?? "run_planner_1",
    projectId: "project_1",
    taskId: "task_1",
    sequence: input.sequence ?? 1,
    type: input.type,
    message: input.message ?? input.type,
    payload: input.payload ?? {},
    createdAt: `2026-05-19T00:00:0${input.sequence ?? 1}.000Z`
  };
  await repositories.runEvents.save(event);
  return event;
}

describe("deriveRunLifecycleView core states", () => {
  it("returns run_not_found for a missing run", async () => {
    const repositories = createInMemoryWorkbenchRepositories();

    await expect(
      deriveRunLifecycleView({ repositories, runId: "missing_run" })
    ).resolves.toEqual({
      ok: false,
      error: "run_not_found"
    });
  });

  it.each([
    ["run.completed", "completed"],
    ["run.failed", "failed"],
    ["run.cancelled", "cancelled"]
  ] as const)(
    "derives %s as %s from terminal run events",
    async (eventType, expectedState) => {
      const repositories = createInMemoryWorkbenchRepositories();
      await saveRun(repositories, {
        state: expectedState as RunRecordState,
        completedAt: "2026-05-19T00:00:05.000Z"
      });
      await saveEvent(repositories, {
        type: eventType,
        message: `${eventType} message`
      });

      const result = await deriveRunLifecycleView({
        repositories,
        runId: "run_planner_1"
      });

      expect(result).toMatchObject({
        ok: true,
        view: {
          runId: "run_planner_1",
          state: expectedState,
          terminalEventType: eventType,
          recoveryActions: expectedState === "failed" ? ["retry_run"] : []
        }
      });
    }
  );

  it.each([
    ["running", "running", []],
    ["needs_approval", "waiting_for_approval", ["request_approval"]],
    ["needs_input", "blocked", ["resolve_blocker"]]
  ] as const)(
    "maps run record state %s to lifecycle state %s",
    async (recordState, expectedState, recoveryActions) => {
      const repositories = createInMemoryWorkbenchRepositories();
      await saveRun(repositories, { state: recordState });

      const result = await deriveRunLifecycleView({
        repositories,
        runId: "run_planner_1"
      });

      expect(result).toMatchObject({
        ok: true,
        view: {
          state: expectedState,
          runRecordState: recordState,
          recoveryActions
        }
      });
    }
  );

  it("uses model parse failure metadata as the failed diagnostic without exposing raw output", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveRun(repositories, {
      state: "failed",
      completedAt: "2026-05-19T00:00:05.000Z"
    });
    await saveEvent(repositories, {
      sequence: 1,
      type: "model.output.parse_failed",
      message: "Planner output could not be parsed as LP brief RAW_MODEL_OUTPUT_SECRET",
      payload: {
        schema: "LPBriefSchema",
        reason: "invalid_json"
      }
    });
    await saveEvent(repositories, {
      sequence: 2,
      type: "run.failed",
      message: "Planner run failed RAW_MODEL_OUTPUT_SECRET",
      payload: {
        state: "failed",
        errorName: "PlannerLPBriefParseError"
      }
    });

    const result = await deriveRunLifecycleView({
      repositories,
      runId: "run_planner_1"
    });

    expect(result).toMatchObject({
      ok: true,
      view: {
        state: "failed",
        diagnosticSummary: {
          code: "invalid_json",
          message: "Model output could not be parsed safely.",
          source: "model_parse",
          eventType: "model.output.parse_failed"
        }
      }
    });
    expect(JSON.stringify(result)).not.toContain("RAW_MODEL_OUTPUT_SECRET");
  });
});
