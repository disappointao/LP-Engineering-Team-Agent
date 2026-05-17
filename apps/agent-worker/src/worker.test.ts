import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter,
  createJsonFileWorkerJobPayloadRepository,
  createJsonFileWorkerJobRepository,
  createSimulatedSandboxPolicy,
  type SafeWorkerJobInput
} from "@lp-agent/worker-runtime";
import { describe, expect, it } from "vitest";
import { runDemoWorkerJob, runWorkerOnce } from "./worker";

describe("agent worker", () => {
  it("runs the demo workbench flow and returns reviewed deployment records", async () => {
    const result = await runDemoWorkerJob();

    expect(result.project).toMatchObject({
      id: "project_1",
      name: "Demo LP Project"
    });
    expect(result.brief).toMatchObject({
      id: "brief_1",
      projectId: "project_1",
      prompt: "Create a lightweight spring ecommerce landing page."
    });
    expect(result.pageVersion).toMatchObject({
      id: "version_1",
      projectId: "project_1",
      briefId: "brief_1",
      reviewStatus: "passed",
      findings: []
    });
    expect(result.deployment).toMatchObject({
      id: "deployment_1",
      projectId: "project_1",
      pageVersionId: "version_1",
      branch: "lp-agent/project_1/version_1",
      status: "pr_opened"
    });
    expect(result.deployment.pullRequestUrl).toBe("https://git.example.local/pr/deployment_1");
  });
});

describe("worker queue handoff", () => {
  it("returns undefined when no queued worker job exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-worker-"));
    try {
      const result = await runWorkerOnce({
        workerId: "worker_a",
        jobRepository: createJsonFileWorkerJobRepository({
          filePath: join(directory, "worker-jobs.json")
        }),
        payloadRepository: createJsonFileWorkerJobPayloadRepository({
          filePath: join(directory, "worker-job-payloads.json")
        })
      });

      expect(result).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("claims and completes one safe simulated worker job", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-worker-"));
    const jobsFilePath = join(directory, "worker-jobs.json");
    const payloadsFilePath = join(directory, "worker-job-payloads.json");
    try {
      const apiRuntime = new InMemoryWorkerRuntime({
        repository: createJsonFileWorkerJobRepository({ filePath: jobsFilePath }),
        payloadRepository: createJsonFileWorkerJobPayloadRepository({
          filePath: payloadsFilePath
        }),
        now: () => new Date("2026-05-18T00:00:00.000Z")
      });
      const queued = await apiRuntime.enqueueSafe(
        safeInput(),
        createSimulatedSandboxPolicy({
          allowedCommands: ["build"],
          allowedEnvNames: ["PUBLIC_FLAG"],
          timeoutMs: 1000
        })
      );

      const result = await runWorkerOnce({
        workerId: "worker_a",
        jobRepository: createJsonFileWorkerJobRepository({ filePath: jobsFilePath }),
        payloadRepository: createJsonFileWorkerJobPayloadRepository({
          filePath: payloadsFilePath
        }),
        adapter: new SimulatedExecutionAdapter(),
        claimTokenFactory: () => "claim_token_1",
        now: createClock([
          "2026-05-18T00:00:01.000Z",
          "2026-05-18T00:00:02.000Z"
        ])
      });
      const stored = await apiRuntime.getJob(queued.id);

      expect(result).toMatchObject({
        id: queued.id,
        state: "completed",
        claimedByWorkerId: "worker_a",
        resultSummary: {
          stdout: "Simulated build for project project_a."
        }
      });
      expect(stored).toEqual(result);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function safeInput(
  overrides: Partial<SafeWorkerJobInput> = {}
): SafeWorkerJobInput {
  return {
    projectId: "project_a",
    kind: "tool_command",
    command: "build",
    args: ["--fast"],
    envNames: ["PUBLIC_FLAG"],
    timeoutMs: 1000,
    ...overrides
  };
}

function createClock(values: string[]): () => Date {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)]!;
    index += 1;
    return new Date(value);
  };
}
