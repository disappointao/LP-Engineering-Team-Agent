import { bundleSingleFileHtml } from "@lp-agent/artifacts";
import { createDemoWorkbenchService } from "@lp-agent/api";

export const createDemoWorkbenchSnapshot = async () => {
  const service = createDemoWorkbenchService();
  const project = await service.createProject({
    name: "Spring Campaign"
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

  return {
    project,
    brief,
    pageVersion: reviewed,
    singleFileHtml: bundleSingleFileHtml(reviewed.artifacts)
  };
};
