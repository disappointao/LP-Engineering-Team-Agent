import { bundleSingleFileHtml } from "@lp-agent/artifacts";
import { createDemoWorkbenchService } from "@lp-agent/api";

export const createDemoWorkbenchSnapshot = async () => {
  const service = createDemoWorkbenchService();
  const project = await service.createProject({
    name: "Spring Campaign",
    repository: "git@example.com:shop/spring-lp.git"
  });
  const brief = await service.createBriefFromPrompt({
    projectId: project.id,
    prompt: "Create a lightweight spring sale landing page for returning ecommerce shoppers."
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
    reviewerUserId: "user_reviewer"
  });

  return {
    project,
    brief,
    pageVersion: reviewed,
    deployment,
    singleFileHtml: bundleSingleFileHtml(reviewed.artifacts)
  };
};
