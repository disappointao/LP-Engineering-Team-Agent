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
      taskSnapshots: []
    });
  });
});
