import {
  createJsonFileWorkerJobPayloadRepository,
  createJsonFileWorkerJobRepository
} from "@lp-agent/worker-runtime";
import { runDemoWorkerJob, runWorkerOnce } from "./worker";

const jobsFilePath = process.env.WORKER_JOBS_FILE;
const payloadsFilePath = process.env.WORKER_PAYLOADS_FILE;
const workerId = process.env.WORKER_ID ?? "local-agent-worker";

if (jobsFilePath && payloadsFilePath) {
  const result = await runWorkerOnce({
    workerId,
    jobRepository: createJsonFileWorkerJobRepository({ filePath: jobsFilePath }),
    payloadRepository: createJsonFileWorkerJobPayloadRepository({
      filePath: payloadsFilePath
    })
  });

  console.log(
    JSON.stringify(
      {
        workerId,
        jobId: result?.id,
        state: result?.state
      },
      null,
      2
    )
  );
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
