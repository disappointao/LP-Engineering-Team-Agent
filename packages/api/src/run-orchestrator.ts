import { z } from "zod";
import type {
  RunEventRecord,
  RunRecord,
  WorkbenchRepositories
} from "@lp-agent/db";
import type {
  AgentRuntimeAdapter,
  RuntimeEvent,
  RuntimeRunResult
} from "@lp-agent/runtime-adapters";
import { assembleContextPack, type ContextPack } from "./context-assembler";
import type { DemoWorkbenchService } from "./index";

const repositoryTimestamps = new WeakMap<WorkbenchRepositories, string>();

export const RunEventRecordSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  projectId: z.string().min(1),
  taskId: z.string().optional(),
  sequence: z.number().int().min(1),
  type: z.string().min(1),
  message: z.string().min(1),
  payload: z.record(z.unknown()),
  createdAt: z.string().datetime()
});

export interface RunAgentStepInput {
  repositories: WorkbenchRepositories;
  service: Pick<DemoWorkbenchService, "createRuntimeContextForRole">;
  runtime: AgentRuntimeAdapter;
  runId: string;
  projectId: string;
  taskId?: string;
  role: "planner" | "builder" | "reviewer" | "deployer";
  input: ContextPack["input"];
  now?: () => Date;
  finalizeResult?: RunAgentStepFinalizer;
}

export interface RunAgentStepResult {
  run: RunRecord;
  events: RunEventRecord[];
  contextPack: ContextPack;
  result: RuntimeRunResult;
}

export interface RunAgentStepFinalizeInput {
  result: RuntimeRunResult;
  contextPack: ContextPack;
}

export type RunAgentStepFinalizer = (
  input: RunAgentStepFinalizeInput
) => RuntimeRunResult | Promise<RuntimeRunResult>;

export async function runAgentStep(input: RunAgentStepInput): Promise<RunAgentStepResult> {
  const now = input.now ?? (() => new Date());
  const startedAt = nextRepositoryTimestamp(input.repositories, now);
  const contextPack = await assembleContextPack({
    repositories: input.repositories,
    service: input.service,
    projectId: input.projectId,
    taskId: input.taskId,
    role: input.role,
    input: input.input,
    now
  });

  const startedRun: RunRecord = {
    id: input.runId,
    projectId: input.projectId,
    taskId: input.taskId,
    role: input.role,
    state: "running",
    startedAt,
    contextSummary: {
      injected: [...contextPack.trace.injected],
      omitted: [...contextPack.trace.omitted]
    }
  };
  await input.repositories.runs.save(startedRun);

  let result: RuntimeRunResult;
  try {
    result = await input.runtime.run({
      runId: input.runId,
      projectId: input.projectId,
      role: input.role,
      input: contextPack.input,
      context: contextPack.runtimeContext
    });
  } catch (error) {
    const completedAt = nextRepositoryTimestamp(input.repositories, now);
    const run: RunRecord = {
      ...startedRun,
      state: "failed",
      completedAt
    };
    await input.repositories.runs.save(run);
    await input.repositories.runEvents.save(
      toRunEventRecord({
        event: toThrownRunFailedEvent({
          error,
          runId: input.runId,
          role: input.role
        }),
        runId: input.runId,
        projectId: input.projectId,
        taskId: input.taskId,
        sequence: 1,
        createdAt: completedAt
      })
    );
    throw error;
  }
  if (input.finalizeResult) {
    result = await input.finalizeResult({ result, contextPack });
  }
  const completedAt = nextRepositoryTimestamp(input.repositories, now);
  const state = toRunRecordState(result.state);
  const run: RunRecord = {
    ...startedRun,
    state,
    ...(state === "running" ? {} : { completedAt })
  };
  await input.repositories.runs.save(run);

  const runtimeEvents = normalizeRuntimeEvents({
    events: result.events,
    runId: input.runId,
    role: input.role,
    state: result.state
  });
  const events = runtimeEvents.map((event, index) =>
    toRunEventRecord({
      event,
      runId: input.runId,
      projectId: input.projectId,
      taskId: input.taskId,
      sequence: index + 1,
      createdAt: completedAt
    })
  );
  for (const event of events) {
    await input.repositories.runEvents.save(event);
  }

  return {
    run,
    events,
    contextPack,
    result
  };
}

function toRunRecordState(state: RuntimeRunResult["state"]): RunRecord["state"] {
  if (state === "queued") {
    return "running";
  }
  return state;
}

function toThrownRunFailedEvent(input: {
  error: unknown;
  runId: string;
  role: RunAgentStepInput["role"];
}): RuntimeEvent {
  return {
    type: "run.failed",
    message: input.error instanceof Error && input.error.message.trim().length > 0
      ? input.error.message
      : "Runtime run failed.",
    runId: input.runId,
    role: input.role,
    state: "failed",
    errorName: input.error instanceof Error ? input.error.name : undefined
  };
}

function nextRepositoryTimestamp(
  repositories: WorkbenchRepositories,
  now: () => Date
): string {
  const current = now().getTime();
  const previous = repositoryTimestamps.get(repositories);
  const previousTime = previous ? Date.parse(previous) : Number.NEGATIVE_INFINITY;
  const timestamp = new Date(Math.max(current, previousTime + 1)).toISOString();
  repositoryTimestamps.set(repositories, timestamp);
  return timestamp;
}

function normalizeRuntimeEvents(input: {
  events: RuntimeEvent[];
  runId: string;
  role: RunAgentStepInput["role"];
  state: RuntimeRunResult["state"];
}): RuntimeEvent[] {
  if (input.state !== "failed" || input.events.some((event) => event.type === "run.failed")) {
    return input.events;
  }

  return [
    ...input.events,
    {
      type: "run.failed",
      message: `${input.role} run failed`,
      runId: input.runId,
      role: input.role,
      state: "failed"
    }
  ];
}

function toRunEventRecord(input: {
  event: RuntimeEvent;
  runId: string;
  projectId: string;
  taskId?: string;
  sequence: number;
  createdAt: string;
}): RunEventRecord {
  const payload = { ...input.event };
  delete (payload as { message?: string }).message;
  const record: RunEventRecord = {
    id: `${input.runId}_event_${input.sequence}`,
    runId: input.runId,
    projectId: input.projectId,
    taskId: input.taskId,
    sequence: input.sequence,
    type: input.event.type,
    message: input.event.message,
    payload,
    createdAt: input.createdAt
  };
  return RunEventRecordSchema.parse(record);
}
