import {
  createDemoWorkbenchService,
  type BriefRecord,
  type PageVersionRecord,
  type ProjectRecord
} from "@lp-agent/api";

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
    name: "Demo LP Project",
    repository: "git@example.com:shop/demo-lp.git"
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
