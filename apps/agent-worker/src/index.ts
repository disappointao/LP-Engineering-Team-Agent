import { finalizeWorkerBackedSkillCommand } from "@lp-agent/api";
import { createJsonFileWorkbenchRepositories } from "@lp-agent/db";
import {
  createJsonFileWorkerJobPayloadRepository,
  createJsonFileWorkerJobRepository,
  createJsonFileWorkerLogRepository,
  type WorkerJobRecord
} from "@lp-agent/worker-runtime";
import { runDemoWorkerJob, runWorkerDaemon, runWorkerOnce } from "./worker";

type WorkerMode = "once" | "daemon";

const jobsFilePath = process.env.WORKER_JOBS_FILE;
const payloadsFilePath = process.env.WORKER_PAYLOADS_FILE;
const logsFilePath = process.env.WORKER_LOGS_FILE;
const workbenchStateFilePath = process.env.LP_AGENT_WORKBENCH_STATE_FILE;
const workerMode = parseWorkerMode({
  workerMode: process.env.WORKER_MODE,
  workerDaemon: process.env.WORKER_DAEMON
});
const workerId = process.env.WORKER_ID ?? "local-agent-worker";

if (jobsFilePath && payloadsFilePath) {
  const heartbeatTimeoutMs = parseIntegerEnv("WORKER_HEARTBEAT_TIMEOUT_MS", "30000", {
    min: 1
  });
  const jobRepository = createJsonFileWorkerJobRepository({ filePath: jobsFilePath });
  const payloadRepository = createJsonFileWorkerJobPayloadRepository({
    filePath: payloadsFilePath
  });
  const workerLogRepository = logsFilePath
    ? createJsonFileWorkerLogRepository({ filePath: logsFilePath })
    : undefined;
  const workbenchRepositories = workbenchStateFilePath
    ? createJsonFileWorkbenchRepositories({ filePath: workbenchStateFilePath })
    : undefined;
  const finalizeWorkerJob = workbenchRepositories
    ? async (workerJob: WorkerJobRecord) => {
        const result = await finalizeWorkerBackedSkillCommand({
          repositories: workbenchRepositories,
          workerJob
        });
        if (!result.ok) {
          throw new Error(result.error);
        }
      }
    : undefined;

  if (workerMode === "daemon") {
    const daemonConfig = parseDaemonConfig(heartbeatTimeoutMs);
    const result = await runWorkerDaemon({
      workerId,
      jobRepository,
      payloadRepository,
      workerLogRepository,
      finalizeWorkerJob,
      ...daemonConfig
    });
    console.log(JSON.stringify({ workerId, mode: "daemon", result }, null, 2));
  } else {
    const result = await runWorkerOnce({
      workerId,
      jobRepository,
      payloadRepository,
      workerLogRepository,
      heartbeatTimeoutMs
    });
    console.log(
      JSON.stringify(
        { workerId, mode: "once", jobId: result?.id, state: result?.state },
        null,
        2
      )
    );
  }
} else {
  const { project, brief, pageVersion, deployment } = await runDemoWorkerJob();

  console.log(
    JSON.stringify(
      {
        project,
        briefId: brief.id,
        pageVersionId: pageVersion.id,
        deployment
      },
      null,
      2
    )
  );
}

function parseDaemonConfig(heartbeatTimeoutMs: number) {
  return {
    maxIterations: parseIntegerEnv("WORKER_DAEMON_MAX_ITERATIONS", "100", {
      min: 1
    }),
    pollIntervalMs: parseIntegerEnv("WORKER_POLL_INTERVAL_MS", "1000", {
      min: 1
    }),
    heartbeatTimeoutMs,
    staleClaimTimeoutMs: parseIntegerEnv("WORKER_STALE_CLAIM_TIMEOUT_MS", "60000", {
      min: 1
    }),
    maxStaleRecoveryCount: parseIntegerEnv("WORKER_MAX_STALE_RECOVERY_COUNT", "1", {
      min: 0
    })
  };
}

function parseWorkerMode(input: {
  workerMode?: string;
  workerDaemon?: string;
}): WorkerMode {
  const value = input.workerMode?.trim() ?? (input.workerDaemon === "1" ? "daemon" : "once");
  if (value === "once" || value === "daemon") {
    return value;
  }
  throw new Error("worker_mode_invalid: expected once or daemon");
}

function parseIntegerEnv(
  name: string,
  defaultValue: string,
  options: { min: number }
): number {
  const rawValue = process.env[name]?.trim() ?? defaultValue;
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${name}_invalid: expected integer >= ${options.min}`);
  }
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(value) || value < options.min) {
    throw new Error(`${name}_invalid: expected integer >= ${options.min}`);
  }
  return value;
}
