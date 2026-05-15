import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createJsonFileWorkbenchRepositories,
  type RunEventRecord,
  type RunRecord,
  type ToolObservationRecord
} from "./index";

const createdAt = "2026-05-13T00:00:00.000Z";
const tempDirs: string[] = [];

async function tempStateFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lp-agent-db-"));
  tempDirs.push(directory);
  return join(directory, "workbench-state.json");
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true
      })
    )
  );
});

describe("json-file workbench repositories", () => {
  it("returns the same repository bundle for repeated calls with the same file path", async () => {
    const filePath = await tempStateFile();

    const first = createJsonFileWorkbenchRepositories({ filePath });
    const second = createJsonFileWorkbenchRepositories({ filePath });

    expect(second).toBe(first);
  });

  it("returns the same repository bundle for equivalent file path forms", async () => {
    const filePath = await tempStateFile();
    const equivalentFilePath = `${filePath.slice(0, -"workbench-state.json".length)}./workbench-state.json`;

    const first = createJsonFileWorkbenchRepositories({ filePath });
    const second = createJsonFileWorkbenchRepositories({ filePath: equivalentFilePath });

    expect(second).toBe(first);
  });

  it("reopens projects, tasks, messages, and task snapshots from disk", async () => {
    const filePath = await tempStateFile();
    const first = createJsonFileWorkbenchRepositories({ filePath });

    await first.projects.save({
      id: "project_1",
      name: "Spring sale",
      createdAt
    });
    await first.tasks.save({
      id: "task_1",
      title: "Create LP",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt
    });
    await first.messages.save({
      id: "message_1",
      taskId: "task_1",
      role: "user",
      content: "Create LP",
      createdAt
    });
    await first.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_1",
      pageVersionId: "version_1",
      createdAt
    });

    const second = createJsonFileWorkbenchRepositories({ filePath });

    await expect(second.projects.listAll()).resolves.toEqual([
      {
        id: "project_1",
        name: "Spring sale",
        createdAt
      }
    ]);
    await expect(second.tasks.listAll()).resolves.toEqual([
      {
        id: "task_1",
        title: "Create LP",
        type: "lp_generation",
        status: "complete",
        projectId: "project_1",
        createdAt
      }
    ]);
    await expect(second.messages.listForTask("task_1")).resolves.toEqual([
      {
        id: "message_1",
        taskId: "task_1",
        role: "user",
        content: "Create LP",
        createdAt
      }
    ]);
    await expect(second.taskSnapshots.getByTaskId("task_1")).resolves.toEqual({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_1",
      pageVersionId: "version_1",
      createdAt
    });
  });

  it("reopens skills, versions, and bindings from disk", async () => {
    const filePath = await tempStateFile();
    const first = createJsonFileWorkbenchRepositories({ filePath });

    await first.skills.save({
      id: "skill_brand",
      name: "Brand LP",
      type: "template",
      scope: "project",
      createdAt
    });
    await first.skillVersions.save({
      id: "skill_version_1",
      skillId: "skill_brand",
      version: "1.0.0",
      manifest: {
        id: "skill_brand",
        name: "Brand LP",
        version: "1.0.0",
        type: "template",
        scope: "project",
        description: "Brand LP sections.",
        permissions: ["brief:read", "artifact:write"],
        requiredSecrets: [],
        entrypoints: ["skills/brand.md"],
        reviewState: "published"
      },
      content: "# Brand LP",
      contentType: "text/markdown",
      reviewState: "published",
      createdAt
    });
    await first.skillBindings.save({
      id: "skill_binding_1",
      skillVersionId: "skill_version_1",
      scope: "project",
      targetKey: "project_1",
      projectId: "project_1",
      enabled: true,
      createdAt,
      updatedAt: createdAt
    });

    const second = createJsonFileWorkbenchRepositories({ filePath });

    await expect(second.skills.listAll()).resolves.toEqual([
      expect.objectContaining({ id: "skill_brand", name: "Brand LP" })
    ]);
    await expect(second.skillVersions.listForSkill("skill_brand")).resolves.toEqual([
      expect.objectContaining({ id: "skill_version_1", content: "# Brand LP" })
    ]);
    await expect(second.skillBindings.listForProject("project_1")).resolves.toEqual([
      expect.objectContaining({ id: "skill_binding_1", enabled: true })
    ]);
  });

  it("reopens model providers and routing policies from disk", async () => {
    const filePath = await tempStateFile();
    const first = createJsonFileWorkbenchRepositories({ filePath });

    await first.modelProviders.save({
      id: "provider_openai",
      scope: "project",
      targetKey: "project_1",
      name: "OpenAI",
      provider: "openai",
      config: {
        api: "openai-completions",
        baseUrl: "https://api.openai.com/v1",
        secretEnvName: "OPENAI_API_KEY"
      },
      enabled: true,
      createdAt,
      updatedAt: createdAt
    });
    await first.modelRoutingPolicies.save({
      id: "model_route_1",
      scope: "project",
      targetKey: "project_1",
      role: "builder",
      providerId: "provider_openai",
      model: "gpt-5.4",
      settings: { temperature: 0.2 },
      createdAt,
      updatedAt: createdAt
    });

    const second = createJsonFileWorkbenchRepositories({ filePath });

    await expect(second.modelProviders.listForProject("project_1")).resolves.toEqual([
      expect.objectContaining({
        id: "provider_openai",
        name: "OpenAI",
        config: {
          api: "openai-completions",
          baseUrl: "https://api.openai.com/v1",
          secretEnvName: "OPENAI_API_KEY"
        }
      })
    ]);
    await expect(
      second.modelRoutingPolicies.getByProjectAndRole("project_1", "builder")
    ).resolves.toEqual(
      expect.objectContaining({
        id: "model_route_1",
        role: "builder",
        providerId: "provider_openai",
        model: "gpt-5.4",
        settings: { temperature: 0.2 }
      })
    );
  });

  it("reopens provider-neutral model provider config from disk", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "lp-agent-db-"));
    tempDirs.push(tempDirectory);
    const filePath = join(tempDirectory, "provider-neutral-state.json");
    const first = createJsonFileWorkbenchRepositories({ filePath });
    await first.modelProviders.save({
      id: "zhipu",
      scope: "project",
      targetKey: "project_1",
      name: "智谱 GLM",
      provider: "custom",
      config: {
        api: "anthropic-messages",
        baseUrl: "https://open.bigmodel.cn/api/anthropic",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        models: [{ id: "glm-5.1", contextWindow: 200000 }]
      },
      enabled: true,
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z"
    });

    const second = createJsonFileWorkbenchRepositories({ filePath });
    await expect(second.modelProviders.getById("zhipu")).resolves.toMatchObject({
      config: {
        api: "anthropic-messages",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        models: [{ id: "glm-5.1", contextWindow: 200000 }]
      }
    });
  });

  it("persists mcp connectors and approvals across repository instances", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "lp-agent-db-"));
    tempDirs.push(tempDirectory);
    const filePath = join(tempDirectory, "mcp-workbench-state.json");
    const first = createJsonFileWorkbenchRepositories({ filePath });

    await first.mcpConnectors.save({
      id: "connector_assets",
      scope: "project",
      targetKey: "project_1",
      name: "Internal Assets",
      enabled: true,
      tools: [
        {
          name: "searchAssets",
          permission: "assets:read",
          roles: ["builder"],
          requiresApproval: false
        }
      ],
      createdAt,
      updatedAt: createdAt
    });
    await first.mcpToolApprovals.save({
      id: "mcp_approval_1",
      projectId: "project_1",
      connectorId: "connector_assets",
      toolName: "searchAssets",
      state: "approved",
      approvedByUserId: "local-owner",
      createdAt,
      updatedAt: createdAt
    });

    const copyFilePath = join(tempDirectory, "mcp-workbench-state-copy.json");
    const second = createJsonFileWorkbenchRepositories({
      filePath: copyFilePath
    });
    const raw = await readFile(filePath, "utf8");
    await writeFile(copyFilePath, raw, "utf8");

    await expect(second.mcpConnectors.listForProject("project_1")).resolves.toEqual([
      expect.objectContaining({ id: "connector_assets" })
    ]);
    await expect(second.mcpToolApprovals.listForProject("project_1")).resolves.toEqual([
      expect.objectContaining({ id: "mcp_approval_1", state: "approved" })
    ]);

    const connectors = await second.mcpConnectors.listForProject("project_1");
    connectors[0]!.tools[0]!.roles.push("reviewer");
    await expect(second.mcpConnectors.listForProject("project_1")).resolves.toEqual([
      expect.objectContaining({
        tools: [expect.objectContaining({ roles: ["builder"] })]
      })
    ]);
  });

  it("reopens runs, run events, and tool observations from disk", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "lp-agent-db-"));
    tempDirs.push(tempDirectory);
    const filePath = join(tempDirectory, "run-workbench-state.json");
    const first = createJsonFileWorkbenchRepositories({ filePath });
    const run: RunRecord = {
      id: "run_builder_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      state: "completed",
      startedAt: createdAt,
      completedAt: "2026-05-13T00:01:00.000Z",
      contextSummary: {
        injected: ["skills:1"],
        omitted: ["history:0"]
      }
    };
    const firstEvent: RunEventRecord = {
      id: "run_event_1",
      runId: run.id,
      projectId: run.projectId,
      taskId: run.taskId,
      sequence: 1,
      type: "run.started",
      message: "builder run started",
      payload: {
        role: "builder"
      },
      createdAt
    };
    const secondEvent: RunEventRecord = {
      id: "run_event_2",
      runId: run.id,
      projectId: run.projectId,
      taskId: run.taskId,
      sequence: 2,
      type: "model.completed",
      message: "builder model call completed",
      payload: {
        provider: "mock-anthropic"
      },
      createdAt: "2026-05-13T00:00:30.000Z"
    };
    const observation: ToolObservationRecord = {
      id: "tool_observation_1",
      runId: run.id,
      projectId: run.projectId,
      taskId: run.taskId,
      toolName: "searchAssets",
      input: {
        query: "hero"
      },
      outputSummary: "Found three candidate hero images.",
      state: "completed",
      exitCode: 0,
      createdAt,
      completedAt: "2026-05-12T00:00:45.000Z"
    };

    await first.runs.save(run);
    await first.runEvents.save(firstEvent);
    await first.runEvents.save(secondEvent);
    await first.toolObservations.save(observation);

    const copyFilePath = join(tempDirectory, "run-workbench-state-copy.json");
    const second = createJsonFileWorkbenchRepositories({
      filePath: copyFilePath
    });
    const raw = await readFile(filePath, "utf8");
    await writeFile(copyFilePath, raw, "utf8");

    await expect(second.runs.getById(run.id)).resolves.toEqual(run);
    await expect(second.runs.listForTask("task_1")).resolves.toEqual([run]);
    await expect(second.runEvents.listForRun(run.id)).resolves.toEqual([
      expect.objectContaining({
        id: "run_event_1",
        sequence: 1,
        type: "run.started",
        message: "builder run started",
        payload: {
          role: "builder"
        }
      }),
      expect.objectContaining({ id: "run_event_2", sequence: 2 })
    ]);
    await expect(second.toolObservations.listForRun(run.id)).resolves.toEqual([
      expect.objectContaining({
        id: "tool_observation_1",
        state: "completed",
        exitCode: 0,
        completedAt: "2026-05-12T00:00:45.000Z",
        input: {
          query: "hero"
        }
      })
    ]);
  });

  it("reopens agent handoffs from disk", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "lp-agent-db-"));
    tempDirs.push(tempRoot);
    const filePath = join(tempRoot, "handoffs.json");
    const first = createJsonFileWorkbenchRepositories({ filePath });
    await first.agentHandoffs.save({
      id: "handoff_1",
      projectId: "project_1",
      taskId: "task_1",
      fromRunId: "run_builder_1",
      fromRole: "builder",
      toRole: "reviewer",
      state: "ready",
      summary: "Builder produced static LP artifacts",
      artifactRefs: {
        briefId: "brief_1",
        pageVersionId: "version_1"
      },
      createdAt: "2026-05-15T08:00:00.000Z",
      updatedAt: "2026-05-15T08:00:00.000Z"
    });

    const aliasPath = join(tempRoot, "handoffs-alias.json");
    await symlink(filePath, aliasPath);
    const second = createJsonFileWorkbenchRepositories({ filePath: aliasPath });

    await expect(
      second.agentHandoffs.listInbound({
        projectId: "project_1",
        taskId: "task_1",
        toRole: "reviewer"
      })
    ).resolves.toEqual([
      {
        id: "handoff_1",
        projectId: "project_1",
        taskId: "task_1",
        fromRunId: "run_builder_1",
        fromRole: "builder",
        toRole: "reviewer",
        state: "ready",
        summary: "Builder produced static LP artifacts",
        artifactRefs: {
          briefId: "brief_1",
          pageVersionId: "version_1"
        },
        createdAt: "2026-05-15T08:00:00.000Z",
        updatedAt: "2026-05-15T08:00:00.000Z"
      }
    ]);
  });

  it("creates parent directories and writes readable JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "lp-agent-db-"));
    tempDirs.push(root);
    const filePath = join(root, "missing", "nested", "workbench-state.json");
    const repositories = createJsonFileWorkbenchRepositories({ filePath });

    await repositories.projects.save({
      id: "project_1",
      name: "Spring sale",
      createdAt
    });

    const raw = await readFile(filePath, "utf8");
    expect(JSON.parse(raw)).toMatchObject({
      projects: [
        {
          id: "project_1",
          name: "Spring sale"
        }
      ],
      tasks: [],
      messages: [],
      taskSnapshots: [],
      skills: [],
      skillVersions: [],
      skillBindings: [],
      modelProviders: [],
      modelRoutingPolicies: []
    });
  });

  it("preserves overlapping writes from multiple instances for the same file", async () => {
    const filePath = await tempStateFile();
    const first = createJsonFileWorkbenchRepositories({ filePath });
    const second = createJsonFileWorkbenchRepositories({ filePath });

    await Promise.all([
      first.projects.save({
        id: "project_1",
        name: "Spring sale",
        createdAt
      }),
      second.tasks.save({
        id: "task_1",
        title: "Create LP",
        type: "lp_generation",
        status: "complete",
        projectId: "project_1",
        createdAt
      })
    ]);

    const reopened = createJsonFileWorkbenchRepositories({ filePath });

    await expect(reopened.projects.listAll()).resolves.toEqual([
      {
        id: "project_1",
        name: "Spring sale",
        createdAt
      }
    ]);
    await expect(reopened.tasks.listAll()).resolves.toEqual([
      {
        id: "task_1",
        title: "Create LP",
        type: "lp_generation",
        status: "complete",
        projectId: "project_1",
        createdAt
      }
    ]);
  });
});
