import { describe, expect, it } from "vitest";
import type {
  AgentHandoffRecord,
  ProjectRecord,
  RunEventRecord,
  RunRecord
} from "./workbench-repositories";
import {
  toPrismaAgentHandoffCreate,
  toPrismaProjectCreate,
  toPrismaRunCreate,
  toPrismaRunEventCreate,
  toRepositoryAgentHandoff,
  toRepositoryProject,
  toRepositoryRun,
  toRepositoryRunEvent,
  type PrismaProjectRow
} from "./prisma-workbench-mappers";

describe("prisma workbench mappers", () => {
  it("maps projects through a workspace id and converts createdAt dates", () => {
    const project: ProjectRecord = {
      id: "project_1",
      name: "Spring sale",
      createdAt: "2026-05-12T00:00:00.000Z"
    };

    expect(toPrismaProjectCreate(project, "workspace_1")).toEqual({
      id: "project_1",
      workspaceId: "workspace_1",
      name: "Spring sale",
      createdAt: new Date("2026-05-12T00:00:00.000Z")
    });

    const row: PrismaProjectRow = {
      id: "project_1",
      workspaceId: "workspace_1",
      name: "Spring sale",
      createdAt: new Date("2026-05-12T00:00:00.000Z")
    };

    expect(toRepositoryProject(row)).toEqual(project);
  });

  it("maps run context summaries without sharing arrays", () => {
    const run: RunRecord = {
      id: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "planner",
      state: "running",
      startedAt: "2026-05-12T00:00:00.000Z",
      completedAt: "2026-05-12T00:01:00.000Z",
      contextSummary: {
        injected: ["brief", "skills"],
        omitted: ["large_artifact"]
      }
    };

    const create = toPrismaRunCreate(run);
    run.contextSummary.injected.push("mutated");

    expect(create).toEqual({
      id: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "planner",
      state: "running",
      startedAt: new Date("2026-05-12T00:00:00.000Z"),
      completedAt: new Date("2026-05-12T00:01:00.000Z"),
      contextSummary: {
        injected: ["brief", "skills"],
        omitted: ["large_artifact"]
      }
    });
    expect(create.contextSummary.injected).not.toBe(run.contextSummary.injected);

    const mapped = toRepositoryRun({
      ...create,
      contextSummary: {
        injected: ["brief", "skills"],
        omitted: ["large_artifact"]
      }
    });
    const rowContext = {
      injected: ["brief"],
      omitted: ["large_artifact"]
    };
    const mappedFromRow = toRepositoryRun({
      ...create,
      contextSummary: rowContext
    });
    rowContext.injected.push("mutated");

    expect(mapped).toEqual({
      id: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "planner",
      state: "running",
      startedAt: "2026-05-12T00:00:00.000Z",
      completedAt: "2026-05-12T00:01:00.000Z",
      contextSummary: {
        injected: ["brief", "skills"],
        omitted: ["large_artifact"]
      }
    });
    expect(mappedFromRow.contextSummary).toEqual({
      injected: ["brief"],
      omitted: ["large_artifact"]
    });
    expect(toRepositoryRun({ ...create, contextSummary: "invalid" }).contextSummary).toEqual({
      injected: [],
      omitted: []
    });
  });

  it("maps run event payloads defensively", () => {
    const event: RunEventRecord = {
      id: "event_1",
      runId: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      sequence: 1,
      type: "message",
      message: "Started",
      payload: {
        nested: {
          step: "context"
        }
      },
      createdAt: "2026-05-12T00:00:00.000Z"
    };

    const create = toPrismaRunEventCreate(event);
    (event.payload.nested as { step: string }).step = "mutated";

    expect(create).toEqual({
      id: "event_1",
      runId: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      sequence: 1,
      type: "message",
      message: "Started",
      payload: {
        nested: {
          step: "context"
        }
      },
      createdAt: new Date("2026-05-12T00:00:00.000Z")
    });

    const mapped = toRepositoryRunEvent(create);
    (create.payload.nested as { step: string }).step = "mutated";

    expect(mapped).toEqual({
      id: "event_1",
      runId: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      sequence: 1,
      type: "message",
      message: "Started",
      payload: {
        nested: {
          step: "context"
        }
      },
      createdAt: "2026-05-12T00:00:00.000Z"
    });
    expect(toRepositoryRunEvent({ ...create, payload: "invalid" }).payload).toEqual({});
  });

  it("maps handoff artifact refs as optional JSON", () => {
    const handoff: AgentHandoffRecord = {
      id: "handoff_1",
      projectId: "project_1",
      taskId: "task_1",
      fromRunId: "run_1",
      fromRole: "planner",
      toRole: "builder",
      state: "blocked",
      summary: "Needs assets",
      blockingReason: "Missing product images",
      artifactRefs: {
        briefId: "brief_1",
        pageVersionId: "version_1"
      },
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:01:00.000Z"
    };

    const create = toPrismaAgentHandoffCreate(handoff);
    handoff.artifactRefs!.briefId = "mutated";

    expect(create).toEqual({
      id: "handoff_1",
      projectId: "project_1",
      taskId: "task_1",
      fromRunId: "run_1",
      fromRole: "planner",
      toRole: "builder",
      state: "blocked",
      summary: "Needs assets",
      blockingReason: "Missing product images",
      artifactRefs: {
        briefId: "brief_1",
        pageVersionId: "version_1"
      },
      createdAt: new Date("2026-05-12T00:00:00.000Z"),
      updatedAt: new Date("2026-05-12T00:01:00.000Z")
    });

    const mapped = toRepositoryAgentHandoff({
      ...create,
      taskId: null,
      blockingReason: null
    });
    (create.artifactRefs as { briefId: string }).briefId = "mutated";

    expect(mapped).toEqual({
      id: "handoff_1",
      projectId: "project_1",
      fromRunId: "run_1",
      fromRole: "planner",
      toRole: "builder",
      state: "blocked",
      summary: "Needs assets",
      artifactRefs: {
        briefId: "brief_1",
        pageVersionId: "version_1"
      },
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:01:00.000Z"
    });
    expect(
      toPrismaAgentHandoffCreate({
        ...handoff,
        taskId: undefined,
        blockingReason: undefined,
        artifactRefs: undefined
      })
    ).toEqual({
      id: "handoff_1",
      projectId: "project_1",
      fromRunId: "run_1",
      fromRole: "planner",
      toRole: "builder",
      state: "blocked",
      summary: "Needs assets",
      createdAt: new Date("2026-05-12T00:00:00.000Z"),
      updatedAt: new Date("2026-05-12T00:01:00.000Z")
    });
    expect(toRepositoryAgentHandoff({ ...create, artifactRefs: null })).not.toHaveProperty(
      "artifactRefs"
    );
    expect(toRepositoryAgentHandoff({ ...create, artifactRefs: "invalid" })).not.toHaveProperty(
      "artifactRefs"
    );
  });
});
