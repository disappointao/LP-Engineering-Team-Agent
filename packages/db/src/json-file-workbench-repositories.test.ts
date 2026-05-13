import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createJsonFileWorkbenchRepositories } from "./index";

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
      skillBindings: []
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
