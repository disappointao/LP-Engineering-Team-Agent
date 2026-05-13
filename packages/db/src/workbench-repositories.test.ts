import { describe, expect, it } from "vitest";
import { sampleBrief } from "@lp-agent/lp-schema";
import {
  createInMemoryWorkbenchRepositories,
  type PageVersionRecord,
  type ProjectRecord,
  type SkillBindingRecord,
  type SkillRecord,
  type SkillVersionRecord
} from "./index";

const createdAt = "2026-05-12T00:00:00.000Z";

describe("in-memory workbench repositories", () => {
  it("persists projects and returns defensive copies", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const project: ProjectRecord = {
      id: "project_1",
      name: "Spring sale",
      createdAt
    };

    await repositories.projects.save(project);
    const saved = await repositories.projects.getById("project_1");
    project.name = "Mutated locally";

    expect(saved).toEqual({
      id: "project_1",
      name: "Spring sale",
      createdAt
    });
  });

  it("finds the latest brief, page version, and deployment for a project", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.projects.save({
      id: "project_1",
      name: "Spring sale",
      createdAt
    });
    await repositories.briefs.save({
      id: "brief_1",
      projectId: "project_1",
      prompt: "first prompt",
      brief: sampleBrief,
      createdAt
    });
    await repositories.briefs.save({
      id: "brief_2",
      projectId: "project_1",
      prompt: "second prompt",
      brief: { ...sampleBrief, title: "Second brief" },
      createdAt: "2026-05-12T00:01:00.000Z"
    });

    const pageVersion: PageVersionRecord = {
      id: "version_1",
      projectId: "project_1",
      briefId: "brief_2",
      artifacts: {
        indexHtml: "<!doctype html><html></html>",
        stylesCss: "body { margin: 0; }",
        scriptJs: "console.log('ready');"
      },
      reviewStatus: "passed",
      findings: [],
      createdAt: "2026-05-12T00:02:00.000Z"
    };
    await repositories.pageVersions.save(pageVersion);
    await repositories.deployments.save({
      id: "deployment_1",
      projectId: "project_1",
      pageVersionId: "version_1",
      branch: "lp-agent/project_1/version_1",
      commitSha: "mock_commit_1",
      pullRequestUrl: "https://git.example.local/pr/deployment_1",
      files: ["index.html", "styles.css", "script.js"],
      status: "pr_opened"
    });

    await expect(repositories.briefs.findLatestForProject("project_1")).resolves.toMatchObject({
      id: "brief_2",
      prompt: "second prompt"
    });
    await expect(repositories.pageVersions.findLatestForProject("project_1")).resolves.toMatchObject({
      id: "version_1",
      briefId: "brief_2"
    });
    await expect(repositories.deployments.findLatestForProject("project_1")).resolves.toMatchObject({
      id: "deployment_1",
      pageVersionId: "version_1"
    });
  });

  it("returns undefined when records are missing", async () => {
    const repositories = createInMemoryWorkbenchRepositories();

    await expect(repositories.projects.getById("missing")).resolves.toBeUndefined();
    await expect(repositories.briefs.getById("missing")).resolves.toBeUndefined();
    await expect(repositories.pageVersions.getById("missing")).resolves.toBeUndefined();
    await expect(repositories.deployments.getByPageVersionId("missing")).resolves.toBeUndefined();
  });

  it("lists projects in creation order and returns defensive copies", async () => {
    const repositories = createInMemoryWorkbenchRepositories();

    await repositories.projects.save({
      id: "project_1",
      name: "Spring sale",
      createdAt
    });
    await repositories.projects.save({
      id: "project_2",
      name: "Summer sale",
      createdAt: "2026-05-12T00:01:00.000Z"
    });

    const projects = await repositories.projects.listAll();
    const firstProject = projects[0];
    if (!firstProject) {
      throw new Error("Expected at least one project.");
    }
    firstProject.name = "Mutated locally";

    await expect(repositories.projects.listAll()).resolves.toEqual([
      {
        id: "project_1",
        name: "Spring sale",
        createdAt
      },
      {
        id: "project_2",
        name: "Summer sale",
        createdAt: "2026-05-12T00:01:00.000Z"
      }
    ]);
  });

  it("persists tasks, messages, and task snapshot references", async () => {
    const repositories = createInMemoryWorkbenchRepositories();

    await repositories.tasks.save({
      id: "task_1",
      title: "Create a landing page",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt
    });
    await repositories.messages.save({
      id: "message_1",
      taskId: "task_1",
      role: "user",
      content: "Create a landing page",
      createdAt
    });
    await repositories.messages.save({
      id: "message_2",
      taskId: "task_1",
      role: "assistant",
      content: "LP artifacts are ready for review.",
      createdAt: "2026-05-12T00:01:00.000Z"
    });
    await repositories.taskSnapshots.save({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_1",
      pageVersionId: "version_1",
      createdAt
    });

    await expect(repositories.tasks.getById("task_1")).resolves.toMatchObject({
      id: "task_1",
      type: "lp_generation",
      projectId: "project_1"
    });
    await expect(repositories.tasks.listAll()).resolves.toEqual([
      expect.objectContaining({
        id: "task_1",
        title: "Create a landing page"
      })
    ]);
    await expect(repositories.messages.listForTask("task_1")).resolves.toEqual([
      expect.objectContaining({
        id: "message_1",
        role: "user"
      }),
      expect.objectContaining({
        id: "message_2",
        role: "assistant"
      })
    ]);
    await expect(repositories.messages.listAll()).resolves.toHaveLength(2);
    await expect(repositories.taskSnapshots.getByTaskId("task_1")).resolves.toEqual({
      taskId: "task_1",
      projectId: "project_1",
      briefId: "brief_1",
      pageVersionId: "version_1",
      createdAt
    });
  });

  it("persists skills, versions, and bindings with defensive copies", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const skill: SkillRecord = {
      id: "skill_brand",
      name: "Brand LP",
      type: "template",
      scope: "project",
      createdAt
    };
    const version: SkillVersionRecord = {
      id: "skill_version_1",
      skillId: skill.id,
      version: "1.0.0",
      manifest: {
        id: skill.id,
        name: skill.name,
        version: "1.0.0",
        type: "template",
        scope: "project",
        description: "Brand LP sections.",
        permissions: ["brief:read", "artifact:write"],
        requiredSecrets: [],
        entrypoints: ["skills/brand.md"],
        reviewState: "published"
      },
      content: "# Brand LP\nUse concise ecommerce sections.",
      contentType: "text/markdown",
      reviewState: "published",
      createdAt
    };
    const binding: SkillBindingRecord = {
      id: "skill_binding_1",
      skillVersionId: version.id,
      scope: "project",
      targetKey: "project_1",
      projectId: "project_1",
      enabled: true,
      settings: {
        brand: {
          tone: "concise"
        }
      },
      createdAt,
      updatedAt: createdAt
    };

    await repositories.skills.save(skill);
    await repositories.skillVersions.save(version);
    await repositories.skillBindings.save(binding);

    const savedVersion = await repositories.skillVersions.getById(version.id);
    if (!savedVersion) {
      throw new Error("Expected saved skill version.");
    }
    savedVersion.manifest.permissions.push("mutated:permission");
    const savedBinding = await repositories.skillBindings.getById(binding.id);
    if (!savedBinding) {
      throw new Error("Expected saved skill binding.");
    }
    const savedBindingBrandSettings = savedBinding.settings?.brand;
    if (
      !savedBindingBrandSettings ||
      typeof savedBindingBrandSettings !== "object" ||
      Array.isArray(savedBindingBrandSettings)
    ) {
      throw new Error("Expected saved skill binding brand settings.");
    }
    savedBindingBrandSettings.tone = "mutated";

    await expect(repositories.skills.listAll()).resolves.toEqual([skill]);
    await expect(repositories.skillVersions.listForSkill(skill.id)).resolves.toEqual([version]);
    await expect(
      repositories.skillVersions.getBySkillIdAndVersion(skill.id, "1.0.0")
    ).resolves.toEqual(version);
    await expect(repositories.skillBindings.listForProject("project_1")).resolves.toEqual([
      binding
    ]);
    await expect(repositories.skillBindings.getById(binding.id)).resolves.toEqual(binding);
    await expect(repositories.skillVersions.getById(version.id)).resolves.toEqual(version);
  });
});
