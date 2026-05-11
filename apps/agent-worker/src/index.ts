import { runDemoWorkerJob } from "./worker";

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
