import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { StaticArtifacts } from "@lp-agent/artifacts";
import type { SkillManifest } from "@lp-agent/skills";
import {
  assertCommandTemplateVariablesKnown,
  assertWorkingDirectoryAllowed,
  cleanupCommandWorkspace,
  materializeStaticArtifactsCommandWorkspace,
  redactCommandOutput,
  resolveCommandTemplate,
  resolveSkillCommandEnvironment,
  summarizeCommandOutput
} from "./skill-command-execution";
import type { CommandWorkspace } from "./skill-command-execution";

describe("skill command execution helpers", () => {
  it("resolves known template variables and rejects unknown variables", () => {
    const variables = {
      projectId: "project_1",
      "artifact.indexHtmlPath": "/tmp/lp/index.html"
    };

    expect(resolveCommandTemplate("{{projectId}}:{{artifact.indexHtmlPath}}", variables)).toBe(
      "project_1:/tmp/lp/index.html"
    );
    expect(() => resolveCommandTemplate("{{missing}}", variables)).toThrow(
      "skill_command_unknown_template_variable"
    );
    expect(() => resolveCommandTemplate("{{artifact-path}}", variables)).toThrow(
      "skill_command_unknown_template_variable"
    );
  });

  it("preflights template variable names before resolving values", () => {
    const allowed = ["projectId", "artifact.indexHtmlPath"];

    expect(() =>
      assertCommandTemplateVariablesKnown("{{projectId}} {{artifact.indexHtmlPath}}", allowed)
    ).not.toThrow();
    expect(() => assertCommandTemplateVariablesKnown("{{missing}}", allowed)).toThrow(
      "skill_command_unknown_template_variable"
    );
    expect(() => assertCommandTemplateVariablesKnown("{{artifact-path}}", allowed)).toThrow(
      "skill_command_unknown_template_variable"
    );
    expect(() => assertCommandTemplateVariablesKnown("{{projectId}", allowed)).toThrow(
      "skill_command_unknown_template_variable"
    );
  });

  it("resolves static and secret-backed env bindings without persisting secret values", () => {
    const manifest: SkillManifest = {
      id: "skill_static_deploy",
      name: "Static deploy",
      version: "1.0.0",
      type: "deployment",
      scope: "project",
      description: "Deploys static LP artifacts.",
      permissions: ["deploy:static"],
      requiredSecrets: ["STATIC_DEPLOY_TOKEN"],
      entrypoints: [],
      reviewState: "published",
      commands: [
        {
          id: "publish_static",
          name: "Publish static artifacts",
          permission: "deploy:static",
          requiresApproval: true,
          command: "static-deploy",
          args: [],
          env: [
            { name: "LP_PROJECT_ID", value: "{{projectId}}" },
            { name: "STATIC_DEPLOY_TOKEN", secretRef: "STATIC_DEPLOY_TOKEN" }
          ]
        }
      ]
    };
    const command = manifest.commands![0]!;

    const env = resolveSkillCommandEnvironment({
      manifest,
      command,
      runtimeEnv: {
        STATIC_DEPLOY_TOKEN: "secret-token"
      },
      variables: {
        projectId: "project_1"
      }
    });

    expect(env).toEqual({
      LP_PROJECT_ID: "project_1",
      STATIC_DEPLOY_TOKEN: "secret-token"
    });
  });

  it("rejects secret refs that are absent from the skill manifest", () => {
    const manifest: SkillManifest = {
      id: "skill_static_deploy",
      name: "Static deploy",
      version: "1.0.0",
      type: "deployment",
      scope: "project",
      description: "Deploys static LP artifacts.",
      permissions: ["deploy:static"],
      requiredSecrets: [],
      entrypoints: [],
      reviewState: "published",
      commands: []
    };

    expect(() =>
      resolveSkillCommandEnvironment({
        manifest,
        command: {
          id: "publish_static",
          name: "Publish static artifacts",
          permission: "deploy:static",
          requiresApproval: true,
          command: "static-deploy",
          args: [],
          env: [{ name: "STATIC_DEPLOY_TOKEN", secretRef: "STATIC_DEPLOY_TOKEN" }]
        },
        runtimeEnv: {
          STATIC_DEPLOY_TOKEN: "secret-token"
        },
        variables: {}
      })
    ).toThrow("skill_command_secret_not_declared");
  });

  it("materializes static artifact files into a bounded workspace", async () => {
    const workspace = await materializeStaticArtifactsCommandWorkspace({
      runId: "run_skill_command_1",
      artifacts: completeArtifacts()
    });

    try {
      const filenames = await readdir(workspace.artifactDir);
      expect(filenames.sort()).toEqual([
        "index.html",
        "script.js",
        "styles.css"
      ]);
      await expect(readFile(workspace.indexHtmlPath, "utf8")).resolves.toContain(
        "<!doctype html>"
      );
      expect(workspace.indexHtmlPath).toBe(join(workspace.artifactDir, "index.html"));
      expect(workspace.stylesCssPath).toBe(join(workspace.artifactDir, "styles.css"));
      expect(workspace.scriptJsPath).toBe(join(workspace.artifactDir, "script.js"));
    } finally {
      await cleanupCommandWorkspace(workspace);
    }
  });

  it("keeps materialized artifacts inside the command workspace for unsafe run ids", async () => {
    const workspace = await materializeStaticArtifactsCommandWorkspace({
      runId: "../escaped",
      artifacts: completeArtifacts()
    });

    try {
      expectPathInside(workspace.rootDir, workspace.artifactDir);
      expectPathInside(workspace.artifactDir, workspace.indexHtmlPath);
      expectPathInside(workspace.artifactDir, workspace.stylesCssPath);
      expectPathInside(workspace.artifactDir, workspace.scriptJsPath);
    } finally {
      await cleanupCommandWorkspace(workspace);
    }
  });

  it("redacts longer overlapping secrets first", () => {
    expect(redactCommandOutput("abcdef abc", ["abc", "abcdef", "abc"])).toBe(
      "[redacted] [redacted]"
    );
  });

  it("redacts secrets and bounds command output summaries", () => {
    const redacted = redactCommandOutput("ok secret-token done", ["secret-token"]);
    expect(redacted).toBe("ok [redacted] done");
    const summary = summarizeCommandOutput("a".repeat(500), "secret-token", ["secret-token"]);
    expect(summary).toBe(`${"a".repeat(297)}...`);
    expect(summary).toHaveLength(300);
  });

  it("allows working directories inside the command workspace", () => {
    const workspace = testWorkspace("/tmp/root");

    expect(() =>
      assertWorkingDirectoryAllowed({ workingDirectory: workspace.rootDir, workspace })
    ).not.toThrow();
    expect(() =>
      assertWorkingDirectoryAllowed({
        workingDirectory: join(workspace.rootDir, "child"),
        workspace
      })
    ).not.toThrow();
  });

  it("rejects working directories outside the command workspace", () => {
    const workspace = testWorkspace("/tmp/root");

    expect(() =>
      assertWorkingDirectoryAllowed({ workingDirectory: "/tmp/root-other", workspace })
    ).toThrow("skill_command_working_directory_forbidden");
    expect(() =>
      assertWorkingDirectoryAllowed({ workingDirectory: "/tmp/root/../outside", workspace })
    ).toThrow("skill_command_working_directory_forbidden");
    expect(() =>
      assertWorkingDirectoryAllowed({ workingDirectory: workspace.rootDir })
    ).toThrow("skill_command_working_directory_forbidden");
  });
});

function completeArtifacts(): StaticArtifacts {
  return {
    indexHtml: "<!doctype html><html></html>",
    stylesCss: ":root {}",
    scriptJs: "window.lpAgent = true;"
  };
}

function testWorkspace(rootDir: string): CommandWorkspace {
  const artifactDir = join(rootDir, "artifacts");
  return {
    rootDir,
    artifactDir,
    indexHtmlPath: join(artifactDir, "index.html"),
    stylesCssPath: join(artifactDir, "styles.css"),
    scriptJsPath: join(artifactDir, "script.js")
  };
}

function expectPathInside(parent: string, child: string): void {
  expect(`${resolve(child)}/`.startsWith(`${resolve(parent)}/`)).toBe(true);
}
