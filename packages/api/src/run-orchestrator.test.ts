import { describe, expect, it, vi } from "vitest";
import { createInMemoryWorkbenchRepositories } from "@lp-agent/db";
import {
  createDefaultRuntimeContext,
  type AgentRuntimeAdapter,
  type RuntimeRunRequest,
  type RuntimeRunResult,
  type RuntimeStreamEvent
} from "@lp-agent/runtime-adapters";
import { runAgentStep } from "./run-orchestrator";

describe("run agent step finalization", () => {
  it("consumes runtime streams for agent steps without calling non-streaming run", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const runtime = new StreamingRuntime(["Planning ", "the page."], "Planning the page.");
    const service = createTestService();

    const result = await runAgentStep({
      repositories,
      service,
      runtime,
      runId: "run_planner_stream_1",
      projectId: "project_1",
      role: "planner",
      input: { prompt: "Plan an LP" },
      now: () => new Date("2026-05-21T00:00:00.000Z")
    });

    expect(runtime.requests).toEqual([
      expect.objectContaining({
        runId: "run_planner_stream_1",
        projectId: "project_1",
        role: "planner"
      })
    ]);
    expect(result.result.modelOutputText).toBe("Planning the page.");
    const events = await repositories.runEvents.listForRun("run_planner_stream_1");
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "model.stream.started",
      "model.stream.progress",
      "model.stream.completed",
      "model.completed",
      "run.completed"
    ]);
    expect(events.find((event) => event.type === "model.stream.progress")).toMatchObject({
      payload: {
        chunkCount: 1,
        receivedChars: 9,
        role: "planner"
      }
    });
    expect(JSON.stringify(events)).not.toContain("Planning ");
  });

  it("persists running state and run start before a streaming step completes", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const runtime = new DeferredStreamingRuntime("Builder completed.");
    const service = createTestService();

    const runningStep = runAgentStep({
      repositories,
      service,
      runtime,
      runId: "run_builder_stream_1",
      projectId: "project_1",
      role: "builder",
      input: { prompt: "Build the LP" },
      now: () => new Date("2026-05-21T00:00:00.000Z")
    });
    await runtime.waitUntilStreaming();

    await expect(repositories.runs.getById("run_builder_stream_1")).resolves.toEqual(
      expect.objectContaining({ state: "running" })
    );
    await expect(repositories.runEvents.listForRun("run_builder_stream_1")).resolves.toEqual([
      expect.objectContaining({
        sequence: 1,
        type: "run.started"
      }),
      expect.objectContaining({
        sequence: 2,
        type: "model.stream.started"
      }),
      expect.objectContaining({
        sequence: 3,
        type: "model.stream.progress",
        payload: expect.objectContaining({
          chunkCount: 1,
          receivedChars: 22
        })
      })
    ]);

    runtime.complete();
    await expect(runningStep).resolves.toMatchObject({
      result: {
        state: "completed",
        modelOutputText: "Builder completed."
      }
    });
  });

  it("persists assistant cancelled runs and cancellation events", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.projects.save({
      id: "project_1",
      name: "Project",
      createdAt: "2026-05-21T00:00:00.000Z"
    });
    const runtime: AgentRuntimeAdapter = {
      async run(request) {
        return {
          runId: request.runId,
          projectId: request.projectId,
          role: request.role,
          state: "cancelled",
          events: [
            {
              type: "run.started",
              message: "assistant run started",
              runId: request.runId,
              role: request.role
            },
            {
              type: "run.cancelled",
              message: "assistant run cancelled",
              runId: request.runId,
              role: request.role,
              state: "cancelled"
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
      runId: "run_assistant_task_1",
      projectId: "project_1",
      role: "assistant",
      input: { prompt: "Explain this project" },
      now: () => new Date("2026-05-21T00:00:00.000Z")
    });

    expect(result.run.state).toBe("cancelled");
    const events = await repositories.runEvents.listForRun("run_assistant_task_1");
    expect(events.map((event) => event.type)).toEqual(["run.started", "run.cancelled"]);
  });

  it("passes task id to the runtime request", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const runtime = new RecordingRuntime({ state: "completed" });
    const service = createTestService();

    await runAgentStep({
      repositories,
      service,
      runtime,
      runId: "run_builder_task_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      input: { prompt: "Build" },
      now: () => new Date("2026-05-21T00:00:00.000Z")
    });

    expect(runtime.requests).toEqual([
      expect.objectContaining({
        runId: "run_builder_task_1",
        projectId: "project_1",
        taskId: "task_1",
        role: "builder"
      })
    ]);
  });

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

  it("persists failed run state when API post-processing throws", async () => {
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

    await expect(
      runAgentStep({
        repositories,
        service,
        runtime,
        runId: "run_planner_brief_1",
        projectId: "project_1",
        role: "planner",
        input: { prompt: "Plan" },
        now: () => new Date("2026-05-14T00:00:00.000Z"),
        finalizeResult() {
          throw new Error("Planner finalizer crashed.");
        }
      })
    ).rejects.toThrow("Planner finalizer crashed.");

    const runs = await repositories.runs.listForProject("project_1");
    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run).toBeDefined();
    expect(run?.state).toBe("failed");
    expect(run?.completedAt).toBeDefined();

    const events = await repositories.runEvents.listForProject("project_1");
    expect(events.map((event) => event.type)).toEqual(["run.started", "run.failed"]);
    const failedEvent = events.find((event) => event.type === "run.failed");
    expect(failedEvent).toBeDefined();
    expect(failedEvent?.message).toBe("Planner finalizer crashed.");
    expect(JSON.stringify(events)).not.toContain("RAW_MODEL_OUTPUT_SECRET");
  });

  it("saves pre-runtime run events before invoking the runtime", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const runtime = new RecordingRuntime({ state: "completed" });
    const service = createTestService();

    await runAgentStep({
      repositories,
      service,
      runtime,
      runId: "run_builder_1",
      projectId: "project_1",
      role: "builder",
      input: {
        prompt: "Build"
      },
      beforeRuntime: async () => [
        {
          type: "handoff.consumed",
          message: "Agent handoff consumed.",
          payload: {
            handoffId: "handoff_1",
            fromRunId: "run_planner_1",
            fromRole: "planner",
            toRole: "builder",
            state: "consumed",
            summary: "Planner produced LP brief"
          }
        }
      ],
      now: () => new Date("2026-05-15T08:00:00.000Z")
    });

    expect(runtime.requests).toHaveLength(1);
    await expect(repositories.runEvents.listForRun("run_builder_1")).resolves.toEqual([
      expect.objectContaining({
        sequence: 1,
        type: "handoff.consumed"
      }),
      expect.objectContaining({
        sequence: 2,
        type: "run.started"
      }),
      expect.objectContaining({
        sequence: 3,
        type: "run.completed"
      })
    ]);
  });

  it("fails before runtime invocation when pre-runtime event creation fails", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const runtime = new RecordingRuntime({ state: "completed" });
    const service = createTestService();

    await expect(
      runAgentStep({
        repositories,
        service,
        runtime,
        runId: "run_builder_1",
        projectId: "project_1",
        role: "builder",
        input: {
          prompt: "Build"
        },
        beforeRuntime: async () => {
          throw new Error("handoff_consume_failed");
        },
        now: () => new Date("2026-05-15T08:00:00.000Z")
      })
    ).rejects.toThrow("handoff_consume_failed");

    expect(runtime.requests).toEqual([]);
    await expect(repositories.runs.getById("run_builder_1")).resolves.toEqual(
      expect.objectContaining({
        state: "failed"
      })
    );
  });

  it("does not run pre-runtime persistence when draft validation fails", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const runtime = new RecordingRuntime({ state: "completed" });
    const service = createTestService();
    const beforePersist = vi.fn(async () => undefined);

    await expect(
      runAgentStep({
        repositories,
        service,
        runtime,
        runId: "run_builder_1",
        projectId: "project_1",
        role: "builder",
        input: {
          prompt: "Build"
        },
        beforeRuntime: async () => [
          {
            type: "",
            message: "",
            payload: {},
            beforePersist
          }
        ],
        now: () => new Date("2026-05-15T08:00:00.000Z")
      })
    ).rejects.toThrow();

    expect(beforePersist).not.toHaveBeenCalled();
    expect(runtime.requests).toEqual([]);
    await expect(repositories.runEvents.listForRun("run_builder_1")).resolves.toEqual([
      expect.objectContaining({
        sequence: 1,
        type: "run.failed"
      })
    ]);
  });

  it("rolls back pre-runtime state when event persistence fails", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const runtime = new RecordingRuntime({ state: "completed" });
    const service = createTestService();
    const beforePersist = vi.fn(async () => undefined);
    const rollbackPersist = vi.fn(async () => undefined);
    const saveRunEvent = repositories.runEvents.save.bind(repositories.runEvents);
    repositories.runEvents.save = vi.fn(async (event) => {
      if (event.type === "handoff.consumed") {
        throw new Error("event_save_failed");
      }
      await saveRunEvent(event);
    });

    await expect(
      runAgentStep({
        repositories,
        service,
        runtime,
        runId: "run_builder_1",
        projectId: "project_1",
        role: "builder",
        input: {
          prompt: "Build"
        },
        beforeRuntime: async () => [
          {
            type: "handoff.consumed",
            message: "Agent handoff consumed.",
            payload: {
              handoffId: "handoff_1"
            },
            beforePersist,
            rollbackPersist
          }
        ],
        now: () => new Date("2026-05-15T08:00:00.000Z")
      })
    ).rejects.toThrow("event_save_failed");

    expect(beforePersist).toHaveBeenCalledTimes(1);
    expect(rollbackPersist).toHaveBeenCalledTimes(1);
    expect(runtime.requests).toEqual([]);
    await expect(repositories.runEvents.listForRun("run_builder_1")).resolves.toEqual([
      expect.objectContaining({
        sequence: 1,
        type: "run.failed"
      })
    ]);
  });
});

class RecordingRuntime implements AgentRuntimeAdapter {
  readonly requests: RuntimeRunRequest[] = [];

  constructor(private readonly result: Pick<RuntimeRunResult, "state">) {}

  async run(request: RuntimeRunRequest): Promise<RuntimeRunResult> {
    this.requests.push(structuredClone(request));
    return {
      runId: request.runId,
      projectId: request.projectId,
      role: request.role,
      state: this.result.state,
      events: [
        {
          type: "run.started",
          message: `${request.role} run started`,
          runId: request.runId,
          role: request.role
        },
        {
          type: "run.completed",
          message: `${request.role} run completed`,
          runId: request.runId,
          state: "completed"
        }
      ]
    };
  }
}

class StreamingRuntime implements AgentRuntimeAdapter {
  readonly requests: RuntimeRunRequest[] = [];

  constructor(
    private readonly deltas: string[],
    private readonly content: string
  ) {}

  async run(): Promise<RuntimeRunResult> {
    throw new Error("run_should_not_be_called_for_streaming");
  }

  async *stream(request: RuntimeRunRequest): AsyncIterable<RuntimeStreamEvent> {
    this.requests.push(structuredClone(request));
    for (const delta of this.deltas) {
      yield { type: "model.delta", text: delta };
    }
    yield {
      type: "completed",
      result: createCompletedRuntimeResult(request, this.content, true)
    };
  }
}

class DeferredStreamingRuntime implements AgentRuntimeAdapter {
  readonly requests: RuntimeRunRequest[] = [];
  private readonly streaming = createDeferred<void>();
  private readonly terminal = createDeferred<void>();

  constructor(private readonly content: string) {}

  async run(): Promise<RuntimeRunResult> {
    throw new Error("run_should_not_be_called_for_streaming");
  }

  async *stream(request: RuntimeRunRequest): AsyncIterable<RuntimeStreamEvent> {
    this.requests.push(structuredClone(request));
    this.streaming.resolve();
    yield { type: "model.delta", text: "Partial builder output" };
    await this.terminal.promise;
    yield {
      type: "completed",
      result: createCompletedRuntimeResult(request, this.content, true)
    };
  }

  async waitUntilStreaming(): Promise<void> {
    await this.streaming.promise;
  }

  complete(): void {
    this.terminal.resolve();
  }
}

function createCompletedRuntimeResult(
  request: RuntimeRunRequest,
  content: string,
  streamingEnabled = false
): RuntimeRunResult {
  return {
    runId: request.runId,
    projectId: request.projectId,
    role: request.role,
    state: "completed",
    modelOutputText: content,
    events: [
      {
        type: "run.started",
        message: `${request.role} run started`,
        runId: request.runId,
        role: request.role
      },
      {
        type: "model.completed",
        message: `${request.role} model call completed`,
        runId: request.runId,
        role: request.role,
        provider: "stream-provider",
        api: "openai-completions",
        model: "stream-model",
        usage: {
          inputTokens: 2,
          outputTokens: 3,
          totalTokens: 5,
          source: "provider_reported"
        },
        attempt: 1,
        durationMs: 9,
        supportsStreaming: true,
        streamingEnabled
      },
      {
        type: "run.completed",
        message: `${request.role} run completed`,
        runId: request.runId,
        state: "completed"
      }
    ]
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createTestService() {
  return {
    async createRuntimeContextForRole() {
      return createDefaultRuntimeContext();
    }
  };
}
