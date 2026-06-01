import { describe, expect, it } from "vitest";
import type { StaticArtifacts } from "@lp-agent/artifacts";
import { sampleBrief } from "@lp-agent/lp-schema";
import type { WorkbenchRepositories } from "./workbench-repositories";

export interface RepositoryContractInput {
  name: string;
  createRepositories: () => Promise<WorkbenchRepositories> | WorkbenchRepositories;
  idPrefix?: string;
}

const createdAt = "2026-05-14T00:00:00.000Z";

const staticArtifacts: StaticArtifacts = {
  indexHtml: "<!doctype html><html><body><h1>Spring sale</h1></body></html>",
  stylesCss: "body { margin: 0; color: #17202a; }",
  scriptJs: "console.log('spring sale ready');"
};

export function runCoreWorkbenchRepositoryContractTests(input: RepositoryContractInput): void {
  describe(`${input.name} core workbench repository contract`, () => {
    const contractId = (id: string): string => `${input.idPrefix ?? ""}${id}`;
    const projectId = contractId("project_contract_1");
    const distractorProjectId = contractId("project_contract_distractor");
    const taskId = contractId("task_contract_1");
    const distractorTaskId = contractId("task_contract_distractor");
    const assistantMessageId = contractId("message_contract_2");
    const userMessageId = contractId("message_contract_1");
    const briefId = contractId("brief_contract_1");
    const pageVersionId = contractId("version_contract_1");
    const distractorPageVersionId = contractId("version_contract_distractor");
    const builderRunId = contractId("run_contract_builder_1");
    const distractorTaskBuilderRunId = contractId("run_contract_builder_distractor_task");
    const reviewerRunId = contractId("run_contract_reviewer_1");
    const reviewerDistractorRoleRunId = contractId("run_contract_reviewer_2");
    const reviewerDistractorScopeRunId = contractId("run_contract_reviewer_3");
    const firstRunEventId = contractId("run_event_contract_1");
    const secondRunEventId = contractId("run_event_contract_2");
    const toolObservationId = contractId("tool_observation_contract_1");
    const distractorTaskToolObservationId = contractId(
      "tool_observation_contract_distractor_task"
    );
    const handoffId = contractId("handoff_contract_1");
    const distractorRoleHandoffId = contractId("handoff_contract_distractor_role");
    const distractorScopeHandoffId = contractId("handoff_contract_distractor_scope");
    const artifactWorkspaceId = contractId("artifact_workspace_contract_1");
    const artifactWorkspaceFileId = contractId("artifact_workspace_contract_1_file_index_html");

    it("persists project, task, message, and task snapshot records", async () => {
      const repositories = await input.createRepositories();

      await repositories.projects.save({
        id: projectId,
        name: "Spring sale",
        createdAt
      });
      await repositories.tasks.save({
        id: taskId,
        title: "Create a landing page",
        type: "lp_generation",
        status: "complete",
        projectId,
        createdAt
      });
      await repositories.messages.save({
        id: assistantMessageId,
        taskId,
        role: "assistant",
        content: "LP artifacts are ready for review.",
        createdAt: "2026-05-14T00:02:00.000Z"
      });
      await repositories.messages.save({
        id: userMessageId,
        taskId,
        role: "user",
        content: "Create a landing page",
        createdAt: "2026-05-14T00:01:00.000Z"
      });
      await repositories.briefs.save({
        id: briefId,
        projectId,
        prompt: "Create a spring sale landing page.",
        brief: sampleBrief,
        createdAt: "2026-05-14T00:01:30.000Z"
      });
      await repositories.pageVersions.save({
        id: pageVersionId,
        projectId,
        briefId,
        artifacts: staticArtifacts,
        reviewStatus: "passed",
        findings: [],
        createdAt: "2026-05-14T00:02:30.000Z"
      });
      await repositories.taskSnapshots.save({
        taskId,
        projectId,
        briefId,
        pageVersionId,
        createdAt: "2026-05-14T00:03:00.000Z"
      });

      await expect(repositories.projects.getById(projectId)).resolves.toEqual({
        id: projectId,
        name: "Spring sale",
        createdAt
      });
      await expect(repositories.projects.listAll()).resolves.toEqual([
        {
          id: projectId,
          name: "Spring sale",
          createdAt
        }
      ]);
      await expect(repositories.tasks.getById(taskId)).resolves.toEqual({
        id: taskId,
        title: "Create a landing page",
        type: "lp_generation",
        status: "complete",
        projectId,
        createdAt
      });
      await expect(repositories.messages.listForTask(taskId)).resolves.toEqual([
        {
          id: userMessageId,
          taskId,
          role: "user",
          content: "Create a landing page",
          createdAt: "2026-05-14T00:01:00.000Z"
        },
        {
          id: assistantMessageId,
          taskId,
          role: "assistant",
          content: "LP artifacts are ready for review.",
          createdAt: "2026-05-14T00:02:00.000Z"
        }
      ]);
      await expect(repositories.taskSnapshots.getByTaskId(taskId)).resolves.toEqual({
        taskId,
        projectId,
        briefId,
        pageVersionId,
        createdAt: "2026-05-14T00:03:00.000Z"
      });
    });

    it("deletes task-scoped records without deleting sibling tasks", async () => {
      const repositories = await input.createRepositories();

      await repositories.projects.save({
        id: projectId,
        name: "Spring sale",
        createdAt
      });
      await repositories.tasks.save({
        id: taskId,
        title: "Task to delete",
        type: "general_chat",
        status: "complete",
        projectId,
        createdAt
      });
      await repositories.tasks.save({
        id: distractorTaskId,
        title: "Sibling task",
        type: "general_chat",
        status: "complete",
        projectId,
        createdAt
      });
      await repositories.messages.save({
        id: userMessageId,
        taskId,
        role: "user",
        content: "Delete me",
        createdAt
      });
      await repositories.taskSnapshots.save({
        taskId,
        projectId,
        createdAt
      });
      await repositories.runs.save({
        id: builderRunId,
        projectId,
        taskId,
        role: "assistant",
        state: "completed",
        startedAt: createdAt,
        completedAt: "2026-05-14T00:00:01.000Z",
        contextSummary: {
          injected: [],
          omitted: []
        }
      });
      await repositories.runEvents.save({
        id: firstRunEventId,
        runId: builderRunId,
        projectId,
        taskId,
        sequence: 1,
        type: "run.completed",
        message: "Run completed",
        payload: { type: "run.completed" },
        createdAt
      });

      await expect(repositories.deletion.deleteTask({ taskId })).resolves.toEqual({
        deletedTaskIds: [taskId]
      });

      await expect(repositories.tasks.getById(taskId)).resolves.toBeUndefined();
      await expect(repositories.tasks.getById(distractorTaskId)).resolves.toMatchObject({
        id: distractorTaskId
      });
      await expect(repositories.messages.listForTask(taskId)).resolves.toEqual([]);
      await expect(repositories.taskSnapshots.getByTaskId(taskId)).resolves.toBeUndefined();
      await expect(repositories.runs.listForTask(taskId)).resolves.toEqual([]);
      await expect(repositories.runEvents.listForTask(taskId)).resolves.toEqual([]);
    });

    it("deletes project-scoped records without deleting another project", async () => {
      const repositories = await input.createRepositories();

      await repositories.projects.save({
        id: projectId,
        name: "Project to delete",
        createdAt
      });
      await repositories.projects.save({
        id: distractorProjectId,
        name: "Project to keep",
        createdAt
      });
      await repositories.tasks.save({
        id: taskId,
        title: "Project task",
        type: "general_chat",
        status: "complete",
        projectId,
        createdAt
      });
      await repositories.tasks.save({
        id: distractorTaskId,
        title: "Other project task",
        type: "general_chat",
        status: "complete",
        projectId: distractorProjectId,
        createdAt
      });
      await repositories.messages.save({
        id: userMessageId,
        taskId,
        role: "user",
        content: "Delete project",
        createdAt
      });
      await repositories.projectMembers.save({
        id: contractId("project_member_contract_1"),
        projectId,
        userId: "local-user",
        role: "owner",
        createdAt,
        updatedAt: createdAt
      });

      await expect(repositories.deletion.deleteProject({ projectId })).resolves.toEqual({
        deletedTaskIds: [taskId]
      });

      await expect(repositories.projects.getById(projectId)).resolves.toBeUndefined();
      await expect(repositories.projects.getById(distractorProjectId)).resolves.toMatchObject({
        id: distractorProjectId
      });
      await expect(repositories.tasks.getById(taskId)).resolves.toBeUndefined();
      await expect(repositories.tasks.getById(distractorTaskId)).resolves.toMatchObject({
        id: distractorTaskId
      });
      await expect(repositories.messages.listForTask(taskId)).resolves.toEqual([]);
      await expect(repositories.projectMembers.listForProject(projectId)).resolves.toEqual([]);
    });

    it("persists run timeline, tool observations, and agent handoffs with scoped ordering", async () => {
      const repositories = await input.createRepositories();

      await repositories.projects.save({
        id: projectId,
        name: "Spring sale",
        createdAt
      });
      await repositories.projects.save({
        id: distractorProjectId,
        name: "Distractor project",
        createdAt
      });
      await repositories.runs.save({
        id: builderRunId,
        projectId,
        taskId,
        role: "builder",
        state: "completed",
        startedAt: createdAt,
        completedAt: "2026-05-14T00:03:00.000Z",
        contextSummary: {
          injected: ["brief", "skills"],
          omitted: []
        }
      });
      await repositories.runs.save({
        id: distractorTaskBuilderRunId,
        projectId,
        taskId: distractorTaskId,
        role: "builder",
        state: "completed",
        startedAt: "2026-05-14T00:00:30.000Z",
        completedAt: "2026-05-14T00:03:30.000Z",
        contextSummary: {
          injected: ["brief"],
          omitted: []
        }
      });
      await repositories.runs.save({
        id: reviewerRunId,
        projectId,
        role: "reviewer",
        state: "completed",
        startedAt: "2026-05-14T00:00:40.000Z",
        completedAt: "2026-05-14T00:00:41.000Z",
        contextSummary: {
          injected: [],
          omitted: []
        }
      });
      await repositories.runs.save({
        id: reviewerDistractorRoleRunId,
        projectId,
        role: "reviewer",
        state: "completed",
        startedAt: "2026-05-14T00:00:50.000Z",
        completedAt: "2026-05-14T00:00:51.000Z",
        contextSummary: {
          injected: [],
          omitted: []
        }
      });
      await repositories.runs.save({
        id: reviewerDistractorScopeRunId,
        projectId: distractorProjectId,
        role: "reviewer",
        state: "completed",
        startedAt: "2026-05-14T00:01:00.000Z",
        completedAt: "2026-05-14T00:01:01.000Z",
        contextSummary: {
          injected: [],
          omitted: []
        }
      });
      await repositories.runEvents.save({
        id: secondRunEventId,
        runId: builderRunId,
        projectId,
        taskId,
        sequence: 2,
        type: "model.completed",
        message: "builder model call completed",
        payload: {
          provider: "mock"
        },
        createdAt: "2026-05-14T00:02:00.000Z"
      });
      await repositories.runEvents.save({
        id: firstRunEventId,
        runId: builderRunId,
        projectId,
        taskId,
        sequence: 1,
        type: "run.started",
        message: "builder run started",
        payload: {
          role: "builder"
        },
        createdAt: "2026-05-14T00:01:00.000Z"
      });
      await repositories.toolObservations.save({
        id: toolObservationId,
        runId: builderRunId,
        projectId,
        taskId,
        toolName: "writeFile",
        input: {
          path: "index.html"
        },
        outputSummary: "Wrote index.html.",
        state: "completed",
        exitCode: 0,
        createdAt: "2026-05-14T00:02:30.000Z",
        completedAt: "2026-05-14T00:02:31.000Z"
      });
      await repositories.toolObservations.save({
        id: distractorTaskToolObservationId,
        runId: distractorTaskBuilderRunId,
        projectId,
        taskId: distractorTaskId,
        toolName: "writeFile",
        input: {
          path: "distractor.html"
        },
        outputSummary: "Wrote distractor.html.",
        state: "completed",
        exitCode: 0,
        createdAt: "2026-05-14T00:02:45.000Z",
        completedAt: "2026-05-14T00:02:46.000Z"
      });
      await repositories.agentHandoffs.save({
        id: handoffId,
        projectId,
        taskId,
        fromRunId: reviewerRunId,
        fromRole: "reviewer",
        toRole: "builder",
        state: "ready",
        summary: "Address review findings.",
        artifactRefs: {
          pageVersionId
        },
        createdAt: "2026-05-14T00:04:00.000Z",
        updatedAt: "2026-05-14T00:04:00.000Z"
      });
      await repositories.agentHandoffs.save({
        id: distractorRoleHandoffId,
        projectId,
        taskId,
        fromRunId: reviewerDistractorRoleRunId,
        fromRole: "reviewer",
        toRole: "planner",
        state: "ready",
        summary: "Planner should not appear in builder inbox.",
        artifactRefs: {
          pageVersionId
        },
        createdAt: "2026-05-14T00:04:30.000Z",
        updatedAt: "2026-05-14T00:04:30.000Z"
      });
      await repositories.agentHandoffs.save({
        id: distractorScopeHandoffId,
        projectId: distractorProjectId,
        taskId: distractorTaskId,
        fromRunId: reviewerDistractorScopeRunId,
        fromRole: "reviewer",
        toRole: "builder",
        state: "ready",
        summary: "Builder handoff for a different project and task.",
        artifactRefs: {
          pageVersionId: distractorPageVersionId
        },
        createdAt: "2026-05-14T00:04:45.000Z",
        updatedAt: "2026-05-14T00:04:45.000Z"
      });

      await expect(repositories.runs.listForTask(taskId)).resolves.toEqual([
        expect.objectContaining({
          id: builderRunId,
          projectId,
          taskId,
          role: "builder",
          state: "completed"
        })
      ]);
      await expect(repositories.runEvents.listForRun(builderRunId)).resolves.toEqual([
        expect.objectContaining({
          id: firstRunEventId,
          sequence: 1,
          type: "run.started"
        }),
        expect.objectContaining({
          id: secondRunEventId,
          sequence: 2,
          type: "model.completed"
        })
      ]);
      await expect(repositories.toolObservations.listForTask(taskId)).resolves.toEqual([
        expect.objectContaining({
          id: toolObservationId,
          projectId,
          taskId,
          toolName: "writeFile",
          state: "completed"
        })
      ]);
      await expect(
        repositories.agentHandoffs.listInbound({
          projectId,
          taskId,
          toRole: "builder"
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: handoffId,
          projectId,
          taskId,
          fromRole: "reviewer",
          toRole: "builder",
          state: "ready"
        })
      ]);
    });

    it("persists briefs, page versions, artifact workspaces, and artifact files", async () => {
      const repositories = await input.createRepositories();

      await repositories.projects.save({
        id: projectId,
        name: "Spring sale",
        createdAt
      });
      await repositories.briefs.save({
        id: briefId,
        projectId,
        prompt: "Create a spring sale landing page.",
        brief: sampleBrief,
        createdAt: "2026-05-14T00:01:00.000Z"
      });
      await repositories.pageVersions.save({
        id: pageVersionId,
        projectId,
        briefId,
        artifactWorkspaceId,
        artifacts: staticArtifacts,
        reviewStatus: "passed",
        findings: [],
        createdAt: "2026-05-14T00:02:00.000Z"
      });
      await repositories.artifactWorkspaces.save({
        id: artifactWorkspaceId,
        projectId,
        pageVersionId,
        runId: builderRunId,
        kind: "static_lp",
        state: "active",
        createdAt: "2026-05-14T00:02:30.000Z",
        updatedAt: "2026-05-14T00:02:30.000Z"
      });
      await repositories.artifactWorkspaceFiles.save({
        id: artifactWorkspaceFileId,
        workspaceId: artifactWorkspaceId,
        projectId,
        pageVersionId,
        path: "index.html",
        kind: "html",
        mimeType: "text/html",
        sizeBytes: Buffer.byteLength(staticArtifacts.indexHtml, "utf8"),
        sha256: "a8a9b67757f1ba55b5eeadf1fe967ff562cecae267b62018346f9a87ada73935",
        summary: "index file",
        content: staticArtifacts.indexHtml,
        createdAt: "2026-05-14T00:03:00.000Z",
        updatedAt: "2026-05-14T00:03:00.000Z"
      });

      await expect(repositories.briefs.findLatestForProject(projectId)).resolves.toEqual({
        id: briefId,
        projectId,
        prompt: "Create a spring sale landing page.",
        brief: sampleBrief,
        createdAt: "2026-05-14T00:01:00.000Z"
      });
      await expect(
        repositories.pageVersions.findLatestForProject(projectId)
      ).resolves.toEqual({
        id: pageVersionId,
        projectId,
        briefId,
        artifactWorkspaceId,
        artifacts: staticArtifacts,
        reviewStatus: "passed",
        findings: [],
        createdAt: "2026-05-14T00:02:00.000Z"
      });
      await expect(
        repositories.artifactWorkspaces.getForPageVersion(pageVersionId)
      ).resolves.toEqual({
        id: artifactWorkspaceId,
        projectId,
        pageVersionId,
        runId: builderRunId,
        kind: "static_lp",
        state: "active",
        createdAt: "2026-05-14T00:02:30.000Z",
        updatedAt: "2026-05-14T00:02:30.000Z"
      });
      await expect(
        repositories.artifactWorkspaceFiles.getByPath({
          workspaceId: artifactWorkspaceId,
          path: "index.html"
        })
      ).resolves.toEqual({
        id: artifactWorkspaceFileId,
        workspaceId: artifactWorkspaceId,
        projectId,
        pageVersionId,
        path: "index.html",
        kind: "html",
        mimeType: "text/html",
        sizeBytes: Buffer.byteLength(staticArtifacts.indexHtml, "utf8"),
        sha256: "a8a9b67757f1ba55b5eeadf1fe967ff562cecae267b62018346f9a87ada73935",
        summary: "index file",
        content: staticArtifacts.indexHtml,
        createdAt: "2026-05-14T00:03:00.000Z",
        updatedAt: "2026-05-14T00:03:00.000Z"
      });
    });
  });
}
