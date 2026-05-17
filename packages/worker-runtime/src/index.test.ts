import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  InMemoryWorkerJobRepository,
  InMemoryWorkerRuntime,
  RejectingExecutionAdapter,
  SimulatedExecutionAdapter,
  createRejectSandboxPolicy,
  createJsonFileWorkerJobRepository,
  createSimulatedSandboxPolicy,
  type ExecutionAdapter,
  type ExecutionInput,
  type SandboxPolicy,
  type WorkerJobRecord,
  type WorkerJobInput
} from "./index";

const baseInput = (overrides: Partial<WorkerJobInput> = {}): WorkerJobInput => ({
  projectId: "project_a",
  kind: "tool_command",
  command: "build",
  args: ["--fast"],
  env: {},
  timeoutMs: 1000,
  ...overrides
});

const simulatedPolicy = (overrides: Partial<SandboxPolicy> = {}): SandboxPolicy =>
  createSimulatedSandboxPolicy({
    allowedCommands: ["build", "test"],
    allowedEnvNames: [],
    ...overrides
  });

function workerJobRecord(overrides: Partial<WorkerJobRecord> = {}): WorkerJobRecord {
  return {
    id: "worker_job_1",
    projectId: "project_a",
    kind: "tool_command",
    state: "queued",
    policy: simulatedPolicy(),
    inputSummary: {
      projectId: "project_a",
      kind: "tool_command",
      commandId: "publish_static",
      command: "build",
      argCount: 1,
      envNames: [],
      timeoutMs: 1000
    },
    createdAt: "2026-05-17T00:00:00.000Z",
    ...overrides
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

describe("InMemoryWorkerRuntime", () => {
  it("persists completed runtime records through a JSON-file repository", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worker-runtime-"));
    const filePath = join(directory, "worker-jobs.json");

    try {
      const repository = createJsonFileWorkerJobRepository({ filePath });
      const runtime = new InMemoryWorkerRuntime({
        repository,
        adapter: new SimulatedExecutionAdapter()
      });

      const queued = await runtime.enqueue(baseInput(), simulatedPolicy());
      await runtime.runNext();

      const reopenedRepository = createJsonFileWorkerJobRepository({ filePath });
      const persisted = await reopenedRepository.getById(queued.id);

      expect(persisted).toMatchObject({
        id: queued.id,
        state: "completed",
        resultSummary: {
          state: "completed",
          stdout: "Simulated build for project project_a."
        }
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not resume JSON-persisted queued jobs without process-local payload", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worker-runtime-"));
    const filePath = join(directory, "worker-jobs.json");

    try {
      const firstRepository = createJsonFileWorkerJobRepository({ filePath });
      const firstRuntime = new InMemoryWorkerRuntime({
        repository: firstRepository,
        adapter: new SimulatedExecutionAdapter()
      });
      const queued = await firstRuntime.enqueue(baseInput(), simulatedPolicy());
      const adapter: ExecutionAdapter = {
        execute: vi.fn(async () => ({
          state: "completed" as const,
          exitCode: 0,
          stdout: "should not run",
          stderr: ""
        }))
      };
      const secondRepository = createJsonFileWorkerJobRepository({ filePath });
      const secondRuntime = new InMemoryWorkerRuntime({
        repository: secondRepository,
        adapter
      });

      const failed = await secondRuntime.runNext();

      expect(failed).toMatchObject({
        id: queued.id,
        state: "failed",
        errorName: "worker_job_payload_unavailable"
      });
      expect(adapter.execute).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists worker records through an injected repository", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const runtime = new InMemoryWorkerRuntime({
      repository,
      adapter: new SimulatedExecutionAdapter()
    });

    const queued = await runtime.enqueue(baseInput(), simulatedPolicy());
    const completed = await runtime.runNext();
    const persisted = await repository.getById(queued.id);

    expect(completed?.state).toBe("completed");
    expect(persisted).toMatchObject({
      id: queued.id,
      state: "completed",
      resultSummary: {
        state: "completed",
        stdout: "Simulated build for project project_a."
      }
    });
  });

  it("allocates the next id after existing repository records", async () => {
    const repository = new InMemoryWorkerJobRepository();
    await repository.save(workerJobRecord({ id: "worker_job_3" }));
    await repository.save(workerJobRecord({ id: "other_prefix_9" }));
    const runtime = new InMemoryWorkerRuntime({ repository });

    const queued = await runtime.enqueue(baseInput(), simulatedPolicy());

    expect(queued.id).toBe("worker_job_4");
  });

  it("ignores unsafe persisted id suffixes when allocating the next id", async () => {
    const repository = new InMemoryWorkerJobRepository();
    await repository.save(workerJobRecord({ id: "worker_job_3" }));
    await repository.save(
      workerJobRecord({
        id: "worker_job_999999999999999999999999999999999999999999999999999999"
      })
    );
    const runtime = new InMemoryWorkerRuntime({ repository });

    const queued = await runtime.enqueue(baseInput(), simulatedPolicy());

    expect(queued.id).toBe("worker_job_4");
  });

  it("allocates unique ids for parallel enqueues in one runtime instance", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const runtime = new InMemoryWorkerRuntime({ repository });

    const queued = await Promise.all([
      runtime.enqueue(baseInput(), simulatedPolicy()),
      runtime.enqueue(baseInput(), simulatedPolicy()),
      runtime.enqueue(baseInput(), simulatedPolicy())
    ]);
    const persisted = await repository.listAll();

    expect(queued.map((job) => job.id)).toEqual([
      "worker_job_1",
      "worker_job_2",
      "worker_job_3"
    ]);
    expect(persisted.map((job) => job.id)).toEqual([
      "worker_job_1",
      "worker_job_2",
      "worker_job_3"
    ]);
  });

  it("runs the oldest queued repository record before newer queued records", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const runtime = new InMemoryWorkerRuntime({
      repository,
      adapter: new SimulatedExecutionAdapter()
    });
    const newer = await runtime.enqueue(
      baseInput({ command: "test" }),
      simulatedPolicy()
    );
    const older = await runtime.enqueue(baseInput(), simulatedPolicy());
    await repository.save({
      ...older,
      createdAt: "2026-05-17T00:00:00.000Z"
    });

    const completed = await runtime.runNext();
    const persistedOlder = await repository.getById(older.id);
    const persistedNewer = await repository.getById(newer.id);

    expect(completed?.id).toBe(older.id);
    expect(persistedOlder?.state).toBe("completed");
    expect(persistedNewer?.state).toBe("queued");
  });

  it("serializes parallel runNext calls in one runtime instance", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const execution = deferred<Awaited<ReturnType<ExecutionAdapter["execute"]>>>();
    const adapter: ExecutionAdapter = {
      execute: vi.fn(() => execution.promise)
    };
    const runtime = new InMemoryWorkerRuntime({ repository, adapter });
    const queued = await runtime.enqueue(baseInput(), simulatedPolicy());

    const runResultsPromise = Promise.all([runtime.runNext(), runtime.runNext()]);
    await vi.waitFor(() => {
      expect(adapter.execute).toHaveBeenCalled();
    });
    execution.resolve({
      state: "completed",
      exitCode: 0,
      stdout: "ok",
      stderr: ""
    });

    const runResults = await runResultsPromise;
    const completedResults = runResults.filter((job) => job !== undefined);
    const persisted = await repository.getById(queued.id);

    expect(adapter.execute).toHaveBeenCalledTimes(1);
    expect(completedResults).toHaveLength(1);
    expect(completedResults[0]).toMatchObject({
      id: queued.id,
      state: "completed"
    });
    expect(runResults).toContain(undefined);
    expect(persisted?.state).toBe("completed");
  });

  it("fails persisted queued jobs when process-local payload is unavailable", async () => {
    const repository = new InMemoryWorkerJobRepository();
    const adapter: ExecutionAdapter = {
      execute: vi.fn(async () => ({
        state: "completed" as const,
        exitCode: 0,
        stdout: "should not run",
        stderr: ""
      }))
    };
    await repository.save(workerJobRecord());
    const runtime = new InMemoryWorkerRuntime({ repository, adapter });

    const failed = await runtime.runNext();
    const persisted = await repository.getById("worker_job_1");

    expect(failed).toMatchObject({
      id: "worker_job_1",
      state: "failed",
      errorName: "worker_job_payload_unavailable",
      resultSummary: {
        state: "failed",
        stderr: "Worker job execution payload is unavailable after restart.",
        errorName: "worker_job_payload_unavailable"
      }
    });
    expect(persisted?.errorName).toBe("worker_job_payload_unavailable");
    expect(persisted?.resultSummary?.errorName).toBe(
      "worker_job_payload_unavailable"
    );
    expect(persisted?.resultSummary?.stderr).toBe(
      "Worker job execution payload is unavailable after restart."
    );
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("enqueue creates deterministic worker job ids with an injectable prefix and clock", async () => {
    const runtime = new InMemoryWorkerRuntime({
      idPrefix: "worker_job",
      now: () => new Date("2026-05-17T12:00:00.000Z")
    });

    const first = await runtime.enqueue(baseInput());
    const second = await runtime.enqueue(baseInput({ command: "test" }));

    expect(first).toMatchObject({
      id: "worker_job_1",
      createdAt: "2026-05-17T12:00:00.000Z",
      inputSummary: {
        command: "build",
        argCount: 1
      }
    });
    expect(second.id).toBe("worker_job_2");
  });

  it("listJobsForProject is project scoped and ordered", async () => {
    const runtime = new InMemoryWorkerRuntime();
    await runtime.enqueue(baseInput({ projectId: "project_a", command: "build" }));
    await runtime.enqueue(baseInput({ projectId: "project_b", command: "test" }));
    await runtime.enqueue(baseInput({ projectId: "project_a", command: "test" }));

    const jobs = await runtime.listJobsForProject("project_a");

    expect(jobs.map((job) => job.id)).toEqual(["worker_job_1", "worker_job_3"]);
    expect(jobs.map((job) => job.inputSummary.command)).toEqual(["build", "test"]);
  });

  it("returned records are defensive copies and do not expose raw args", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter({
        stdoutByCommand: { build: "ok" }
      })
    });
    const queued = await runtime.enqueue(
      baseInput({
        args: ["original"],
        env: { TOKEN: "secret-value" }
      }),
      simulatedPolicy({ allowedEnvNames: ["TOKEN"] })
    );

    queued.inputSummary.envNames.push("MUTATED");
    queued.policy.allowedCommands.push("mutated");
    const beforeRun = await runtime.getJob(queued.id);
    beforeRun?.inputSummary.envNames.push("MUTATED_AGAIN");
    beforeRun?.policy.allowedEnvNames.push("MUTATED_POLICY");

    const completed = await runtime.runNext();
    completed?.inputSummary.envNames.push("AFTER_RUN");
    completed?.policy.allowedCommands.push("after-run");
    if (completed?.resultSummary) {
      completed.resultSummary.stdout = "mutated output";
    }

    const stored = await runtime.getJob(queued.id);

    expect(stored?.inputSummary).toMatchObject({
      argCount: 1,
      envNames: ["TOKEN"]
    });
    expect("args" in (stored?.inputSummary ?? {})).toBe(false);
    expect(stored?.policy.allowedCommands).toEqual(["build", "test"]);
    expect(stored?.policy.allowedEnvNames).toEqual(["TOKEN"]);
    expect(stored?.resultSummary?.stdout).toBe("ok");
  });

  it("runNext returns undefined when no queued job exists", async () => {
    const runtime = new InMemoryWorkerRuntime();

    await expect(runtime.runNext()).resolves.toBeUndefined();
  });

  it("policy rejects disallowed command before adapter execution", async () => {
    const adapter: ExecutionAdapter = {
      execute: vi.fn(async () => ({
        state: "completed" as const,
        exitCode: 0,
        stdout: "should not run",
        stderr: ""
      }))
    };
    const runtime = new InMemoryWorkerRuntime({ adapter });
    await runtime.enqueue(
      baseInput({ command: "deploy" }),
      simulatedPolicy({ allowedCommands: ["build"] })
    );

    const job = await runtime.runNext();

    expect(job?.state).toBe("rejected");
    expect(job?.errorName).toBe("sandbox_policy_command_not_allowed");
    expect(job?.resultSummary).toMatchObject({
      state: "rejected",
      errorName: "sandbox_policy_command_not_allowed"
    });
    expect(job?.resultSummary?.stderr).toContain("command not allowed");
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("policy rejects unsupported runtime sandbox modes before adapter execution", async () => {
    const adapter: ExecutionAdapter = {
      execute: vi.fn(async () => ({
        state: "completed" as const,
        exitCode: 0,
        stdout: "should not run",
        stderr: ""
      }))
    };
    const runtime = new InMemoryWorkerRuntime({ adapter });
    await runtime.enqueue(
      baseInput(),
      { ...simulatedPolicy(), mode: "real" as SandboxPolicy["mode"] }
    );

    const job = await runtime.runNext();

    expect(job?.state).toBe("rejected");
    expect(job?.errorName).toBe("sandbox_policy_mode_not_supported");
    expect(job?.resultSummary).toMatchObject({
      state: "rejected",
      errorName: "sandbox_policy_mode_not_supported"
    });
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("policy rejects unexpected env names without storing secret values", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter({
        stdoutByCommand: { build: "should not run" }
      })
    });
    const queued = await runtime.enqueue(
      baseInput({
        env: {
          ALLOWED: "allowed-value",
          SECRET_TOKEN: "super-secret"
        }
      }),
      simulatedPolicy({ allowedEnvNames: ["ALLOWED"] })
    );

    const job = await runtime.runNext();
    const serialized = JSON.stringify(await runtime.getJob(queued.id));

    expect(job?.state).toBe("rejected");
    expect(job?.errorName).toBe("sandbox_policy_env_not_allowed");
    expect(job?.inputSummary.envNames).toEqual(["ALLOWED", "SECRET_TOKEN"]);
    expect(job?.resultSummary?.stderr).toContain("env name not allowed");
    expect(serialized).toContain("SECRET_TOKEN");
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("allowed-value");
  });

  it("redacts known env values from stored output summaries", async () => {
    const adapterResult = {
      state: "completed" as const,
      exitCode: 0,
      stdout: "token secret-token and artifact <style>secret</style>",
      stderr: "stderr secret-token <style>secret</style>"
    };
    const runtime = new InMemoryWorkerRuntime({
      adapter: {
        execute: vi.fn(async () => adapterResult)
      }
    });
    const queued = await runtime.enqueue(
      baseInput({
        env: {
          TOKEN: "secret-token",
          ARTIFACT_FRAGMENT: "<style>secret</style>"
        }
      }),
      simulatedPolicy({
        allowedEnvNames: ["TOKEN", "ARTIFACT_FRAGMENT"],
        maxStdoutBytes: 200,
        maxStderrBytes: 200
      })
    );

    const job = await runtime.runNext();
    const serialized = JSON.stringify(await runtime.getJob(queued.id));

    expect(job?.state).toBe("completed");
    expect(job?.resultSummary?.stdout).toBe(
      "token [redacted] and artifact [redacted]"
    );
    expect(job?.resultSummary?.stderr).toBe("stderr [redacted] [redacted]");
    expect(job?.resultSummary?.stdoutBytes).toBe(
      Buffer.byteLength(adapterResult.stdout, "utf8")
    );
    expect(job?.resultSummary?.stderrBytes).toBe(
      Buffer.byteLength(adapterResult.stderr, "utf8")
    );
    expect(adapterResult.stdout).toContain("secret-token");
    expect(adapterResult.stderr).toContain("<style>secret</style>");
    expect(serialized).toContain("TOKEN");
    expect(serialized).toContain("ARTIFACT_FRAGMENT");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("<style>secret</style>");
  });

  it("policy rejects workingDirectory when the policy has no workingDirectoryRoot", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter()
    });
    await runtime.enqueue(
      baseInput({
        workingDirectory: "/tmp/project"
      }),
      simulatedPolicy()
    );

    const job = await runtime.runNext();

    expect(job?.state).toBe("rejected");
    expect(job?.errorName).toBe("sandbox_policy_working_directory_forbidden");
    expect(job?.resultSummary?.stderr).toContain("workingDirectory forbidden");
  });

  it("policy rejects workingDirectory outside workingDirectoryRoot", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter()
    });
    await runtime.enqueue(
      baseInput({
        workingDirectory: "/tmp/project-other"
      }),
      simulatedPolicy({
        workingDirectoryRoot: "/tmp/project"
      })
    );

    const job = await runtime.runNext();

    expect(job?.state).toBe("rejected");
    expect(job?.errorName).toBe("sandbox_policy_working_directory_forbidden");
    expect(job?.resultSummary?.stderr).toContain("workingDirectory outside root");
  });

  it("SimulatedExecutionAdapter completes with default stdout and bounded summaries", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter()
    });
    await runtime.enqueue(
      baseInput(),
      simulatedPolicy({
        maxStdoutBytes: 10
      })
    );

    const job = await runtime.runNext();

    expect(job?.state).toBe("completed");
    expect(job?.errorName).toBeUndefined();
    expect(job?.resultSummary).toMatchObject({
      state: "completed",
      exitCode: 0,
      stdout: "Simulated ",
      stderr: "",
      stdoutBytes: "Simulated build for project project_a.".length,
      stderrBytes: 0
    });
  });

  it("bounds multibyte stdout without exceeding max bytes", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter({
        stdoutByCommand: {
          build: "你好a"
        }
      })
    });
    await runtime.enqueue(
      baseInput(),
      simulatedPolicy({
        maxStdoutBytes: 5
      })
    );

    const job = await runtime.runNext();
    const stdout = job?.resultSummary?.stdout ?? "";

    expect(job?.state).toBe("completed");
    expect(stdout).toBe("你");
    expect(Buffer.byteLength(stdout, "utf8")).toBeLessThanOrEqual(5);
    expect(stdout).not.toContain("�");
    expect(job?.resultSummary?.stdoutBytes).toBe(Buffer.byteLength("你好a", "utf8"));
  });

  it("stores empty output summaries when output limits are zero", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter({
        stdoutByCommand: {
          build: "abcdef"
        },
        stderrByCommand: {
          build: "stderr"
        }
      })
    });
    await runtime.enqueue(
      baseInput(),
      simulatedPolicy({
        maxStdoutBytes: 0,
        maxStderrBytes: 0
      })
    );

    const job = await runtime.runNext();

    expect(job?.state).toBe("completed");
    expect(job?.resultSummary).toMatchObject({
      stdout: "",
      stderr: "",
      stdoutBytes: 6,
      stderrBytes: 6
    });
  });

  it.each([
    ["negative", { maxStdoutBytes: -1 }],
    ["non-integer", { maxStderrBytes: 1.5 }]
  ] as const)(
    "policy rejects %s output limits before adapter execution",
    async (_caseName, policyOverrides) => {
      const adapter: ExecutionAdapter = {
        execute: vi.fn(async () => ({
          state: "completed" as const,
          exitCode: 0,
          stdout: "should not run",
          stderr: ""
        }))
      };
      const runtime = new InMemoryWorkerRuntime({ adapter });
      await runtime.enqueue(baseInput(), simulatedPolicy(policyOverrides));

      const job = await runtime.runNext();

      expect(job?.state).toBe("rejected");
      expect(job?.errorName).toBe("sandbox_policy_output_limit_invalid");
      expect(job?.resultSummary?.errorName).toBe(
        "sandbox_policy_output_limit_invalid"
      );
      expect(adapter.execute).not.toHaveBeenCalled();
    }
  );

  it("SimulatedExecutionAdapter can fail configured commands with stable defaults", async () => {
    const runtime = new InMemoryWorkerRuntime({
      adapter: new SimulatedExecutionAdapter({
        failCommands: ["build"]
      })
    });
    await runtime.enqueue(baseInput(), simulatedPolicy());

    const job = await runtime.runNext();

    expect(job?.state).toBe("failed");
    expect(job?.errorName).toBe("simulated_command_failed");
    expect(job?.resultSummary).toMatchObject({
      state: "failed",
      exitCode: 1,
      stderr: "Simulated command failure.",
      errorName: "simulated_command_failed"
    });
  });

  it("RejectingExecutionAdapter returns rejected without real command execution", async () => {
    const adapter = new RejectingExecutionAdapter();
    const input: ExecutionInput = {
      jobId: "worker_job_1",
      projectId: "project_a",
      kind: "tool_command",
      command: "build",
      args: [],
      env: {},
      envNames: [],
      timeoutMs: 1000
    };
    const policy: SandboxPolicy = createRejectSandboxPolicy();

    await expect(adapter.execute(input, policy)).resolves.toMatchObject({
      state: "rejected",
      errorName: "execution_adapter_rejected",
      stderr: expect.stringContaining("real command execution is disabled")
    });
  });
});
