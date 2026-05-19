import { describe, expect, it } from "vitest";
import {
  createInMemoryWorkbenchRepositories,
  type RunEventRecord,
  type RunRecord,
  type RunRecordState,
  type WorkbenchRepositories
} from "@lp-agent/db";
import {
  deriveRunLifecycleView,
  listRunLifecycleViewsForTask
} from "./run-lifecycle";
import { createAgentHandoffRecord } from "./agent-handoffs";
import type { WorkerJobRecord } from "@lp-agent/worker-runtime";

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
    ["running", "running", [], undefined],
    ["needs_approval", "waiting_for_approval", ["request_approval"], undefined],
    ["needs_input", "blocked", ["resolve_blocker"], "input_required"],
    ["failed", "failed", ["retry_run"], undefined],
    ["completed", "completed", [], undefined],
    ["cancelled", "cancelled", [], undefined]
  ] as const)(
    "maps run record state %s to lifecycle state %s",
    async (recordState, expectedState, recoveryActions, expectedDiagnosticCode) => {
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
          ...(expectedDiagnosticCode
            ? {
                diagnosticSummary: {
                  code: expectedDiagnosticCode
                }
              }
            : {}),
          recoveryActions
        }
      });
    }
  );

  it("lists lifecycle views for a task in saved run order", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveRun(repositories, {
      id: "run_planner_1",
      role: "planner",
      state: "completed",
      startedAt: "2026-05-19T00:00:00.000Z",
      completedAt: "2026-05-19T00:00:05.000Z"
    });
    await saveRun(repositories, {
      id: "run_builder_1",
      role: "builder",
      state: "failed",
      startedAt: "2026-05-19T00:00:10.000Z",
      completedAt: "2026-05-19T00:00:15.000Z"
    });
    await saveEvent(repositories, {
      runId: "run_planner_1",
      sequence: 1,
      type: "run.completed"
    });
    await saveEvent(repositories, {
      runId: "run_builder_1",
      sequence: 1,
      type: "run.failed"
    });

    const views = await listRunLifecycleViewsForTask({
      repositories,
      taskId: "task_1"
    });

    expect(views).toMatchObject([
      {
        runId: "run_planner_1",
        state: "completed",
        terminalEventType: "run.completed",
        recoveryActions: []
      },
      {
        runId: "run_builder_1",
        state: "failed",
        terminalEventType: "run.failed",
        recoveryActions: ["retry_run"]
      }
    ]);
  });

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

  it("sanitizes invalid model parse diagnostic codes without exposing raw output", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveRun(repositories, {
      state: "failed",
      completedAt: "2026-05-19T00:00:05.000Z"
    });
    await saveEvent(repositories, {
      sequence: 1,
      type: "model.output.parse_failed",
      message: "Planner output could not be parsed RAW_MODEL_OUTPUT_SECRET",
      payload: {
        reason: "bad code with spaces"
      }
    });
    await saveEvent(repositories, {
      sequence: 2,
      type: "run.failed",
      message: "Planner run failed RAW_MODEL_OUTPUT_SECRET"
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
          code: "unknown",
          message: "Model output could not be parsed safely.",
          source: "model_parse",
          eventType: "model.output.parse_failed"
        }
      }
    });
    expect(JSON.stringify(result)).not.toContain("RAW_MODEL_OUTPUT_SECRET");
  });
});

function workerJob(
  overrides: Partial<WorkerJobRecord> = {}
): WorkerJobRecord {
  return {
    id: "worker_job_1",
    projectId: "project_1",
    kind: "tool_command",
    state: "queued",
    payloadSource: "safe_persisted",
    policy: {
      mode: "simulate",
      allowedCommands: ["static-deploy"],
      timeoutMs: 30000,
      allowedEnvNames: ["LP_PROJECT_ID"],
      maxStdoutBytes: 1000,
      maxStderrBytes: 1000,
      network: "disabled"
    },
    inputSummary: {
      projectId: "project_1",
      kind: "tool_command",
      commandId: "publish_static",
      command: "static-deploy",
      argCount: 2,
      envNames: ["LP_PROJECT_ID"],
      timeoutMs: 30000
    },
    createdAt: "2026-05-19T00:00:01.000Z",
    ...overrides
  };
}

async function saveWorkerLink(repositories: WorkbenchRepositories): Promise<void> {
  await saveEvent(repositories, {
    sequence: 1,
    type: "worker.job.linked",
    payload: {
      taskId: "task_1",
      runId: "run_planner_1",
      workerJobId: "worker_job_1",
      observationId: "tool_observation_1"
    }
  });
}

describe("deriveRunLifecycleView worker and handoff states", () => {
  it.each([
    ["queued", "queued"],
    ["running", "running"]
  ] as const)(
    "derives linked worker job state %s",
    async (workerState, expectedState) => {
      const repositories = createInMemoryWorkbenchRepositories();
      await saveRun(repositories, { role: "deployer" });
      await saveWorkerLink(repositories);

      const result = await deriveRunLifecycleView({
        repositories,
        workerRuntime: {
          getJob: async () => workerJob({ state: workerState })
        },
        runId: "run_planner_1"
      });

      expect(result).toMatchObject({
        ok: true,
        view: {
          state: expectedState,
          linkedWorkerJobId: "worker_job_1",
          linkedObservationId: "tool_observation_1"
        }
      });
    }
  );

  it("derives cancelling when a linked running worker job has a cancellation request", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveRun(repositories, { role: "deployer" });
    await saveWorkerLink(repositories);

    const result = await deriveRunLifecycleView({
      repositories,
      workerRuntime: {
        getJob: async () =>
          workerJob({
            state: "running",
            cancelRequestedAt: "2026-05-19T00:00:03.000Z"
          })
      },
      runId: "run_planner_1"
    });

    expect(result).toMatchObject({
      ok: true,
      view: {
        state: "cancelling",
        recoveryActions: []
      }
    });
  });

  it("returns resume finalization for a terminal worker job without terminal run events", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveRun(repositories, { role: "deployer" });
    await saveWorkerLink(repositories);

    const result = await deriveRunLifecycleView({
      repositories,
      workerRuntime: {
        getJob: async () =>
          workerJob({
            state: "completed",
            completedAt: "2026-05-19T00:00:04.000Z",
            resultSummary: {
              state: "completed",
              exitCode: 0,
              stdout: "published",
              stderr: "",
              stdoutBytes: 9,
              stderrBytes: 0
            }
          })
      },
      runId: "run_planner_1"
    });

    expect(result).toMatchObject({
      ok: true,
      view: {
        state: "completed",
        recoveryActions: ["resume_worker_finalization"],
        diagnosticSummary: {
          code: "worker_finalization_incomplete",
          source: "lifecycle"
        }
      }
    });
    expect(JSON.stringify(result)).not.toContain("published");
  });

  it("reports a missing linked worker job without manufacturing success", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveRun(repositories, { role: "deployer" });
    await saveWorkerLink(repositories);

    const result = await deriveRunLifecycleView({
      repositories,
      workerRuntime: {
        getJob: async () => undefined
      },
      runId: "run_planner_1"
    });

    expect(result).toMatchObject({
      ok: true,
      view: {
        state: "failed",
        diagnosticSummary: {
          code: "worker_job_missing",
          source: "lifecycle"
        },
        recoveryActions: ["inspect_manually"]
      }
    });
  });

  it("reports unavailable linked worker job state when getJob throws", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveRun(repositories, { role: "deployer" });
    await saveWorkerLink(repositories);

    const result = await deriveRunLifecycleView({
      repositories,
      workerRuntime: {
        getJob: async () => {
          throw new Error("worker runtime unavailable");
        }
      },
      runId: "run_planner_1"
    });

    expect(result).toMatchObject({
      ok: true,
      view: {
        state: "failed",
        linkedWorkerJobId: "worker_job_1",
        linkedObservationId: "tool_observation_1",
        diagnosticSummary: {
          code: "worker_job_unavailable",
          source: "lifecycle",
          eventType: "worker.job.linked"
        },
        recoveryActions: ["inspect_manually"]
      }
    });
  });

  it("derives rejected linked worker jobs as failed without exposing raw output", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveRun(repositories, { role: "deployer" });
    await saveWorkerLink(repositories);

    const result = await deriveRunLifecycleView({
      repositories,
      workerRuntime: {
        getJob: async () =>
          workerJob({
            state: "rejected",
            completedAt: "2026-05-19T00:00:04.000Z",
            resultSummary: {
              state: "rejected",
              exitCode: 1,
              stdout: "raw stdout secret",
              stderr: "raw stderr secret",
              stdoutBytes: 17,
              stderrBytes: 17,
              errorName: "WorkerPolicyRejected"
            }
          })
      },
      runId: "run_planner_1"
    });

    expect(result).toMatchObject({
      ok: true,
      view: {
        state: "failed",
        diagnosticSummary: {
          code: "WorkerPolicyRejected",
          source: "worker_job"
        },
        recoveryActions: ["resume_worker_finalization"]
      }
    });
    expect(JSON.stringify(result)).not.toContain("raw stdout secret");
    expect(JSON.stringify(result)).not.toContain("raw stderr secret");
  });

  it("derives blocked from an inbound blocked handoff and redacts the blocking reason", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveRun(repositories, { role: "deployer" });
    await repositories.agentHandoffs.save(
      createAgentHandoffRecord({
        id: "handoff_1",
        projectId: "project_1",
        taskId: "task_1",
        fromRunId: "run_reviewer_1",
        fromRole: "reviewer",
        toRole: "deployer",
        state: "blocked",
        summary: "Reviewer blocked deployment",
        blockingReason: "Deployment blocked with OPENAI_API_KEY=sk-test-secret",
        now: () => new Date("2026-05-19T00:00:02.000Z")
      })
    );

    const result = await deriveRunLifecycleView({
      repositories,
      runId: "run_planner_1"
    });

    expect(result).toMatchObject({
      ok: true,
      view: {
        state: "blocked",
        blockedReason: "Deployment blocked with OPENAI_API_KEY=[REDACTED]",
        diagnosticSummary: {
          code: "handoff_blocked",
          source: "handoff"
        },
        recoveryActions: ["resolve_blocker"]
      }
    });
    expect(JSON.stringify(result)).not.toContain("sk-test-secret");
  });

  it("does not attach a task-scoped blocked handoff to a taskless run", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveRun(repositories, { role: "deployer", taskId: undefined });
    await repositories.agentHandoffs.save(
      createAgentHandoffRecord({
        id: "handoff_1",
        projectId: "project_1",
        taskId: "task_1",
        fromRunId: "run_reviewer_1",
        fromRole: "reviewer",
        toRole: "deployer",
        state: "blocked",
        summary: "Reviewer blocked deployment",
        blockingReason: "Deployment blocked",
        now: () => new Date("2026-05-19T00:00:02.000Z")
      })
    );

    const result = await deriveRunLifecycleView({
      repositories,
      runId: "run_planner_1"
    });

    expect(result).toMatchObject({
      ok: true,
      view: {
        state: "running",
        recoveryActions: []
      }
    });
  });
});

describe("deriveRunLifecycleView recovery safety", () => {
  it("marks conflicting terminal run events for manual inspection", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveRun(repositories, {
      state: "failed",
      completedAt: "2026-05-19T00:00:05.000Z"
    });
    await saveEvent(repositories, {
      sequence: 1,
      type: "run.completed",
      payload: { state: "completed" }
    });
    await saveEvent(repositories, {
      sequence: 2,
      type: "run.failed",
      payload: { state: "failed", errorName: "PlannerError" }
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
          code: "inconsistent_terminal_events",
          source: "lifecycle"
        },
        recoveryActions: ["inspect_manually"]
      }
    });
  });

  it("keeps run failed diagnostics short and generic when event messages contain sensitive data", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await saveRun(repositories, {
      state: "failed",
      completedAt: "2026-05-19T00:00:05.000Z"
    });
    await saveEvent(repositories, {
      type: "run.failed",
      message: "Planner failed with SECRET_TOKEN=secret-token and raw stack",
      payload: {
        state: "failed",
        errorName: "PlannerError"
      }
    });

    const result = await deriveRunLifecycleView({
      repositories,
      runId: "run_planner_1"
    });

    expect(result).toMatchObject({
      ok: true,
      view: {
        diagnosticSummary: {
          code: "run_failed",
          message: "Run failed.",
          errorName: "PlannerError"
        }
      }
    });
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(JSON.stringify(result)).not.toContain("SECRET_TOKEN");
  });

  it("lists lifecycle views for a task in started order", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.runs.save(runRecord({
      id: "run_builder_1",
      role: "builder",
      startedAt: "2026-05-19T00:00:02.000Z",
      state: "completed",
      completedAt: "2026-05-19T00:00:03.000Z"
    }));
    await repositories.runs.save(runRecord({
      id: "run_planner_1",
      role: "planner",
      startedAt: "2026-05-19T00:00:01.000Z",
      state: "completed",
      completedAt: "2026-05-19T00:00:02.000Z"
    }));
    await saveEvent(repositories, {
      runId: "run_builder_1",
      sequence: 1,
      type: "run.completed",
      payload: { state: "completed" }
    });
    await saveEvent(repositories, {
      runId: "run_planner_1",
      sequence: 1,
      type: "run.completed",
      payload: { state: "completed" }
    });

    const views = await listRunLifecycleViewsForTask({
      repositories,
      taskId: "task_1"
    });

    expect(views.map((view) => view.runId)).toEqual([
      "run_planner_1",
      "run_builder_1"
    ]);
    expect(views.map((view) => view.state)).toEqual(["completed", "completed"]);
  });
});
