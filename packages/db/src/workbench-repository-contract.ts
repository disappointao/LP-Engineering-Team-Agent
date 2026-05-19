import { describe, expect, it } from "vitest";
import type { StaticArtifacts } from "@lp-agent/artifacts";
import { sampleBrief } from "@lp-agent/lp-schema";
import type { WorkbenchRepositories } from "./workbench-repositories";

export interface RepositoryContractInput {
  name: string;
  createRepositories: () => Promise<WorkbenchRepositories> | WorkbenchRepositories;
}

const createdAt = "2026-05-14T00:00:00.000Z";

const staticArtifacts: StaticArtifacts = {
  indexHtml: "<!doctype html><html><body><h1>Spring sale</h1></body></html>",
  stylesCss: "body { margin: 0; color: #17202a; }",
  scriptJs: "console.log('spring sale ready');"
};

export function runCoreWorkbenchRepositoryContractTests(input: RepositoryContractInput): void {
  describe(`${input.name} core workbench repository contract`, () => {
    it("persists project, task, message, and task snapshot records", async () => {
      const repositories = await input.createRepositories();

      await repositories.projects.save({
        id: "project_contract_1",
        name: "Spring sale",
        createdAt
      });
      await repositories.tasks.save({
        id: "task_contract_1",
        title: "Create a landing page",
        type: "lp_generation",
        status: "complete",
        projectId: "project_contract_1",
        createdAt
      });
      await repositories.messages.save({
        id: "message_contract_2",
        taskId: "task_contract_1",
        role: "assistant",
        content: "LP artifacts are ready for review.",
        createdAt: "2026-05-14T00:02:00.000Z"
      });
      await repositories.messages.save({
        id: "message_contract_1",
        taskId: "task_contract_1",
        role: "user",
        content: "Create a landing page",
        createdAt: "2026-05-14T00:01:00.000Z"
      });
      await repositories.taskSnapshots.save({
        taskId: "task_contract_1",
        projectId: "project_contract_1",
        briefId: "brief_contract_1",
        pageVersionId: "version_contract_1",
        createdAt: "2026-05-14T00:03:00.000Z"
      });

      await expect(repositories.projects.getById("project_contract_1")).resolves.toEqual({
        id: "project_contract_1",
        name: "Spring sale",
        createdAt
      });
      await expect(repositories.projects.listAll()).resolves.toEqual([
        {
          id: "project_contract_1",
          name: "Spring sale",
          createdAt
        }
      ]);
      await expect(repositories.tasks.getById("task_contract_1")).resolves.toEqual({
        id: "task_contract_1",
        title: "Create a landing page",
        type: "lp_generation",
        status: "complete",
        projectId: "project_contract_1",
        createdAt
      });
      await expect(repositories.messages.listForTask("task_contract_1")).resolves.toEqual([
        {
          id: "message_contract_1",
          taskId: "task_contract_1",
          role: "user",
          content: "Create a landing page",
          createdAt: "2026-05-14T00:01:00.000Z"
        },
        {
          id: "message_contract_2",
          taskId: "task_contract_1",
          role: "assistant",
          content: "LP artifacts are ready for review.",
          createdAt: "2026-05-14T00:02:00.000Z"
        }
      ]);
      await expect(repositories.taskSnapshots.getByTaskId("task_contract_1")).resolves.toEqual({
        taskId: "task_contract_1",
        projectId: "project_contract_1",
        briefId: "brief_contract_1",
        pageVersionId: "version_contract_1",
        createdAt: "2026-05-14T00:03:00.000Z"
      });
    });

    it("persists run timeline, tool observations, and agent handoffs with scoped ordering", async () => {
      const repositories = await input.createRepositories();

      await repositories.runs.save({
        id: "run_contract_builder_1",
        projectId: "project_contract_1",
        taskId: "task_contract_1",
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
        id: "run_contract_builder_distractor_task",
        projectId: "project_contract_1",
        taskId: "task_contract_distractor",
        role: "builder",
        state: "completed",
        startedAt: "2026-05-14T00:00:30.000Z",
        completedAt: "2026-05-14T00:03:30.000Z",
        contextSummary: {
          injected: ["brief"],
          omitted: []
        }
      });
      await repositories.runEvents.save({
        id: "run_event_contract_2",
        runId: "run_contract_builder_1",
        projectId: "project_contract_1",
        taskId: "task_contract_1",
        sequence: 2,
        type: "model.completed",
        message: "builder model call completed",
        payload: {
          provider: "mock"
        },
        createdAt: "2026-05-14T00:02:00.000Z"
      });
      await repositories.runEvents.save({
        id: "run_event_contract_1",
        runId: "run_contract_builder_1",
        projectId: "project_contract_1",
        taskId: "task_contract_1",
        sequence: 1,
        type: "run.started",
        message: "builder run started",
        payload: {
          role: "builder"
        },
        createdAt: "2026-05-14T00:01:00.000Z"
      });
      await repositories.toolObservations.save({
        id: "tool_observation_contract_1",
        runId: "run_contract_builder_1",
        projectId: "project_contract_1",
        taskId: "task_contract_1",
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
        id: "tool_observation_contract_distractor_task",
        runId: "run_contract_builder_distractor_task",
        projectId: "project_contract_1",
        taskId: "task_contract_distractor",
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
        id: "handoff_contract_1",
        projectId: "project_contract_1",
        taskId: "task_contract_1",
        fromRunId: "run_contract_reviewer_1",
        fromRole: "reviewer",
        toRole: "builder",
        state: "ready",
        summary: "Address review findings.",
        artifactRefs: {
          pageVersionId: "version_contract_1"
        },
        createdAt: "2026-05-14T00:04:00.000Z",
        updatedAt: "2026-05-14T00:04:00.000Z"
      });
      await repositories.agentHandoffs.save({
        id: "handoff_contract_distractor_role",
        projectId: "project_contract_1",
        taskId: "task_contract_1",
        fromRunId: "run_contract_reviewer_2",
        fromRole: "reviewer",
        toRole: "planner",
        state: "ready",
        summary: "Planner should not appear in builder inbox.",
        artifactRefs: {
          pageVersionId: "version_contract_1"
        },
        createdAt: "2026-05-14T00:04:30.000Z",
        updatedAt: "2026-05-14T00:04:30.000Z"
      });
      await repositories.agentHandoffs.save({
        id: "handoff_contract_distractor_scope",
        projectId: "project_contract_distractor",
        taskId: "task_contract_distractor",
        fromRunId: "run_contract_reviewer_3",
        fromRole: "reviewer",
        toRole: "builder",
        state: "ready",
        summary: "Builder handoff for a different project and task.",
        artifactRefs: {
          pageVersionId: "version_contract_distractor"
        },
        createdAt: "2026-05-14T00:04:45.000Z",
        updatedAt: "2026-05-14T00:04:45.000Z"
      });

      await expect(repositories.runs.listForTask("task_contract_1")).resolves.toEqual([
        expect.objectContaining({
          id: "run_contract_builder_1",
          projectId: "project_contract_1",
          taskId: "task_contract_1",
          role: "builder",
          state: "completed"
        })
      ]);
      await expect(repositories.runEvents.listForRun("run_contract_builder_1")).resolves.toEqual([
        expect.objectContaining({
          id: "run_event_contract_1",
          sequence: 1,
          type: "run.started"
        }),
        expect.objectContaining({
          id: "run_event_contract_2",
          sequence: 2,
          type: "model.completed"
        })
      ]);
      await expect(repositories.toolObservations.listForTask("task_contract_1")).resolves.toEqual([
        expect.objectContaining({
          id: "tool_observation_contract_1",
          projectId: "project_contract_1",
          taskId: "task_contract_1",
          toolName: "writeFile",
          state: "completed"
        })
      ]);
      await expect(
        repositories.agentHandoffs.listInbound({
          projectId: "project_contract_1",
          taskId: "task_contract_1",
          toRole: "builder"
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "handoff_contract_1",
          projectId: "project_contract_1",
          taskId: "task_contract_1",
          fromRole: "reviewer",
          toRole: "builder",
          state: "ready"
        })
      ]);
    });

    it("persists briefs, page versions, artifact workspaces, and artifact files", async () => {
      const repositories = await input.createRepositories();

      await repositories.projects.save({
        id: "project_contract_1",
        name: "Spring sale",
        createdAt
      });
      await repositories.briefs.save({
        id: "brief_contract_1",
        projectId: "project_contract_1",
        prompt: "Create a spring sale landing page.",
        brief: sampleBrief,
        createdAt: "2026-05-14T00:01:00.000Z"
      });
      await repositories.pageVersions.save({
        id: "version_contract_1",
        projectId: "project_contract_1",
        briefId: "brief_contract_1",
        artifactWorkspaceId: "artifact_workspace_contract_1",
        artifacts: staticArtifacts,
        reviewStatus: "passed",
        findings: [],
        createdAt: "2026-05-14T00:02:00.000Z"
      });
      await repositories.artifactWorkspaces.save({
        id: "artifact_workspace_contract_1",
        projectId: "project_contract_1",
        pageVersionId: "version_contract_1",
        runId: "run_contract_builder_1",
        kind: "static_lp",
        state: "active",
        createdAt: "2026-05-14T00:02:30.000Z",
        updatedAt: "2026-05-14T00:02:30.000Z"
      });
      await repositories.artifactWorkspaceFiles.save({
        id: "artifact_workspace_contract_1_file_index_html",
        workspaceId: "artifact_workspace_contract_1",
        projectId: "project_contract_1",
        pageVersionId: "version_contract_1",
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

      await expect(repositories.briefs.findLatestForProject("project_contract_1")).resolves.toEqual({
        id: "brief_contract_1",
        projectId: "project_contract_1",
        prompt: "Create a spring sale landing page.",
        brief: sampleBrief,
        createdAt: "2026-05-14T00:01:00.000Z"
      });
      await expect(
        repositories.pageVersions.findLatestForProject("project_contract_1")
      ).resolves.toEqual({
        id: "version_contract_1",
        projectId: "project_contract_1",
        briefId: "brief_contract_1",
        artifactWorkspaceId: "artifact_workspace_contract_1",
        artifacts: staticArtifacts,
        reviewStatus: "passed",
        findings: [],
        createdAt: "2026-05-14T00:02:00.000Z"
      });
      await expect(
        repositories.artifactWorkspaces.getForPageVersion("version_contract_1")
      ).resolves.toEqual({
        id: "artifact_workspace_contract_1",
        projectId: "project_contract_1",
        pageVersionId: "version_contract_1",
        runId: "run_contract_builder_1",
        kind: "static_lp",
        state: "active",
        createdAt: "2026-05-14T00:02:30.000Z",
        updatedAt: "2026-05-14T00:02:30.000Z"
      });
      await expect(
        repositories.artifactWorkspaceFiles.getByPath({
          workspaceId: "artifact_workspace_contract_1",
          path: "index.html"
        })
      ).resolves.toEqual({
        id: "artifact_workspace_contract_1_file_index_html",
        workspaceId: "artifact_workspace_contract_1",
        projectId: "project_contract_1",
        pageVersionId: "version_contract_1",
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
