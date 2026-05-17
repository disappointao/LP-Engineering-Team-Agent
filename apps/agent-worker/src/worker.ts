import {
  createDemoWorkbenchService,
  type BriefRecord,
  type PageVersionRecord,
  type ProjectRecord
} from "@lp-agent/api";
import {
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter,
  type ExecutionAdapter,
  type WorkerJobPayloadRepository,
  type WorkerJobRecord,
  type WorkerJobRepository
} from "@lp-agent/worker-runtime";

type DemoWorkbenchService = ReturnType<typeof createDemoWorkbenchService>;

export interface DemoWorkerJobResult {
  project: ProjectRecord;
  brief: BriefRecord;
  pageVersion: PageVersionRecord;
  deployment: Awaited<ReturnType<DemoWorkbenchService["approveAndCreateDeployment"]>>;
}

export async function runDemoWorkerJob(): Promise<DemoWorkerJobResult> {
  const service = createDemoWorkbenchService();

  const project = await service.createProject({
    name: "Demo LP Project"
  });
  const brief = await service.createBriefFromPrompt({
    projectId: project.id,
    prompt: "Create a lightweight spring ecommerce landing page."
  });
  const pageVersion = await service.generatePageVersion({
    projectId: project.id,
    briefId: brief.id
  });
  const reviewed = await service.reviewPageVersion({
    projectId: project.id,
    pageVersionId: pageVersion.id
  });
  const deployment = await service.approveAndCreateDeployment({
    projectId: project.id,
    pageVersionId: reviewed.id,
    reviewerUserId: "demo_worker"
  });

  return { project, brief, pageVersion: reviewed, deployment };
}

export interface RunWorkerOnceInput {
  workerId: string;
  jobRepository: WorkerJobRepository;
  payloadRepository: WorkerJobPayloadRepository;
  adapter?: ExecutionAdapter;
  now?: () => Date;
  claimTokenFactory?: () => string;
}

export async function runWorkerOnce(
  input: RunWorkerOnceInput
): Promise<WorkerJobRecord | undefined> {
  const runtime = new InMemoryWorkerRuntime({
    repository: input.jobRepository,
    payloadRepository: input.payloadRepository,
    adapter: input.adapter ?? new SimulatedExecutionAdapter(),
    now: input.now,
    claimTokenFactory: input.claimTokenFactory
  });
  const claim = await runtime.claimOldestQueued({
    workerId: input.workerId
  });

  if (!claim) {
    return undefined;
  }

  return runtime.runClaimedJob(claim);
}
