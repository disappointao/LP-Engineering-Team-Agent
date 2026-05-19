import { finalizeWorkerBackedSkillCommand } from "@lp-agent/api";
import { createJsonFileWorkbenchRepositories } from "@lp-agent/db";
import {
  createJsonFileWorkerJobPayloadRepository,
  createJsonFileWorkerJobRepository,
  createJsonFileWorkerLogRepository,
  type WorkerJobRecord
} from "@lp-agent/worker-runtime";
import { runDemoWorkerJob, runWorkerDaemon, runWorkerOnce } from "./worker";

const jobsFilePath = process.env.WORKER_JOBS_FILE;
const payloadsFilePath = process.env.WORKER_PAYLOADS_FILE;
const logsFilePath = process.env.WORKER_LOGS_FILE;
const workbenchStateFilePath = process.env.LP_AGENT_WORKBENCH_STATE_FILE;
const workerMode = process.env.WORKER_MODE ?? (process.env.WORKER_DAEMON === "1" ? "daemon" : "once");
const workerId = process.env.WORKER_ID ?? "local-agent-worker";

if (jobsFilePath && payloadsFilePath) {
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
    const result = await runWorkerDaemon({
      workerId,
      jobRepository,
      payloadRepository,
      workerLogRepository,
      finalizeWorkerJob,
      maxIterations: Number.parseInt(process.env.WORKER_DAEMON_MAX_ITERATIONS ?? "100", 10),
      pollIntervalMs: Number.parseInt(process.env.WORKER_POLL_INTERVAL_MS ?? "1000", 10),
      heartbeatTimeoutMs: Number.parseInt(process.env.WORKER_HEARTBEAT_TIMEOUT_MS ?? "30000", 10),
      staleClaimTimeoutMs: Number.parseInt(process.env.WORKER_STALE_CLAIM_TIMEOUT_MS ?? "60000", 10),
      maxStaleRecoveryCount: Number.parseInt(process.env.WORKER_MAX_STALE_RECOVERY_COUNT ?? "1", 10)
    });
    console.log(JSON.stringify({ workerId, mode: "daemon", result }, null, 2));
  } else {
    const result = await runWorkerOnce({
      workerId,
      jobRepository,
      payloadRepository,
      workerLogRepository
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
