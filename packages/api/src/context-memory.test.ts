import { describe, expect, it } from "vitest";
import { createStaticArtifactWorkspaceFiles } from "@lp-agent/artifacts";
import { createInMemoryWorkbenchRepositories } from "@lp-agent/db";
import { sampleBrief } from "@lp-agent/lp-schema";
import { ContextPackSchema } from "./context-assembler";
import {
  assembleContextMemory,
  ContextMemorySchema,
  toContextMemoryQuery,
  truncatePreview
} from "./context-memory";

describe("context memory", () => {
  it("accepts deterministic memory shape with one message and empty runs/tools/artifacts", () => {
    expect(
      ContextMemorySchema.parse({
        projectId: "project_1",
        taskId: "task_1",
        role: "builder",
        strategy: "deterministic-keyword-v0",
        query: "builder Build a spring sale page",
        messages: [
          {
            id: "message_1",
            taskId: "task_1",
            role: "user",
            preview: "Build a spring sale page",
            createdAt: "2026-05-14T00:00:00.000Z",
            score: 17.25
          }
        ],
        runs: [],
        tools: [],
        artifacts: [],
        retrieval: {
          query: "builder Build a spring sale page",
          strategy: "deterministic-keyword-v0",
          selected: ["message:message_1"],
          omitted: ["memory:runs:none", "memory:tools:none", "memory:artifacts:none"]
        }
      })
    ).toMatchObject({
      messages: [expect.objectContaining({ id: "message_1" })],
      runs: [],
      tools: [],
      artifacts: []
    });
  });

  it("derives a context memory query from role, prompt, and brief fields", () => {
    expect(
      toContextMemoryQuery({
        role: "builder",
        input: {
          prompt: "Build a spring sale page",
          brief: {
            ...sampleBrief,
            objective: "Convert paid shoppers",
            audience: "Returning customers",
            offer: "Save 20%",
            primaryCta: "Shop now"
          } as typeof sampleBrief & { primaryCta: string }
        }
      })
    ).toBe(
      "builder Build a spring sale page Convert paid shoppers Returning customers Save 20% Shop now"
    );
  });

  it("truncates previews at the character limit", () => {
    expect(truncatePreview("abcdef", 4)).toBe("abcd");
    expect(truncatePreview("abc", 4)).toBe("abc");
  });

  it("retrieves only messages scoped to the same project and records empty omissions", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.tasks.save({
      id: "task_1",
      title: "Current build",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    await repositories.tasks.save({
      id: "task_2",
      title: "Other project",
      type: "lp_generation",
      status: "complete",
      projectId: "project_2",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    await repositories.messages.save({
      id: "message_1",
      taskId: "task_1",
      role: "user",
      content: "Build a spring sale page for returning customers.",
      createdAt: "2026-05-14T00:01:00.000Z"
    });
    await repositories.messages.save({
      id: "message_secret",
      taskId: "task_2",
      role: "assistant",
      content: "Other project secret-token",
      createdAt: "2026-05-14T00:02:00.000Z"
    });

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      input: {
        prompt: "Build a spring sale page",
        brief: sampleBrief
      },
      now: () => new Date("2026-05-15T00:00:00.000Z")
    });

    expect(memory.messages.map((message) => message.id)).toEqual(["message_1"]);
    expect(JSON.stringify(memory)).not.toContain("secret-token");
    expect(memory.retrieval.selected).toContain("message:message_1");
    expect(memory.retrieval.omitted).toEqual(
      expect.arrayContaining([
        "memory:runs:none",
        "memory:tools:none",
        "memory:artifacts:none"
      ])
    );
  });

  it("redacts secret-like values from same-project message previews and current retrieval query", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.tasks.save({
      id: "task_1",
      title: "Current build",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    await repositories.messages.save({
      id: "message_1",
      taskId: "task_1",
      role: "user",
      content:
        "Build loyalty recovery page with secret-token token=secret-token OPENAI_API_KEY=plain-openai-value STATIC_DEPLOY_TOKEN=plain-static-value ZHIPU_API_KEY: plain-zhipu-value for winback buyers.",
      createdAt: "2026-05-14T00:01:00.000Z"
    });

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      input: {
        prompt:
          "Build loyalty recovery page using Bearer sk-test-secret and api_key=secret-token OPENAI_API_KEY=sk-test-secret STATIC_DEPLOY_TOKEN=query-static-value",
        brief: {
          ...sampleBrief,
          objective: "Win back buyers without password=secret-token ZHIPU_API_KEY: query-zhipu-value",
          audience: "Dormant loyalty shoppers"
        }
      },
      limits: {
        previewCharacters: 140
      }
    });

    const serialized = JSON.stringify(memory);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("sk-test-secret");
    expect(serialized).not.toContain("OPENAI_API_KEY=sk-test-secret");
    expect(serialized).not.toContain("STATIC_DEPLOY_TOKEN=query-static-value");
    expect(serialized).not.toContain("ZHIPU_API_KEY: query-zhipu-value");
    expect(serialized).not.toContain("plain-openai-value");
    expect(serialized).not.toContain("plain-static-value");
    expect(serialized).not.toContain("plain-zhipu-value");
    expect(serialized).not.toContain("query-static-value");
    expect(serialized).not.toContain("query-zhipu-value");
    expect(memory.messages[0]?.preview).toContain("[REDACTED]");
    expect(memory.messages[0]?.preview).toContain("loyalty");
    expect(memory.retrieval.query).toContain("[REDACTED]");
    expect(memory.retrieval.query).toContain("loyalty");
    expect(memory.retrieval.query).toContain("Win back buyers");
  });

  it("ranks current task non-matches before non-current non-matches", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.tasks.save({
      id: "task_current",
      title: "Current build",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    await repositories.tasks.save({
      id: "task_other",
      title: "Other build",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    await repositories.messages.save({
      id: "message_current",
      taskId: "task_current",
      role: "assistant",
      content: "Draft a neutral page about winter inventory.",
      createdAt: "2026-05-14T00:01:00.000Z"
    });
    await repositories.messages.save({
      id: "message_other",
      taskId: "task_other",
      role: "assistant",
      content: "Draft a neutral page about winter inventory.",
      createdAt: "2026-05-14T00:01:00.000Z"
    });

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      taskId: "task_current",
      role: "builder",
      input: {
        prompt: "Build a spring sale page"
      },
      now: () => new Date("2026-05-15T00:00:00.000Z")
    });

    expect(memory.messages[0]?.id).toBe("message_current");
    expect(memory.messages[0]?.score).toBeGreaterThan(memory.messages[1]?.score ?? 0);
  });

  it("ranks non-current keyword matches before non-current non-matches", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.tasks.save({
      id: "task_keyword",
      title: "Keyword build",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    await repositories.tasks.save({
      id: "task_neutral",
      title: "Neutral build",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    await repositories.messages.save({
      id: "message_keyword",
      taskId: "task_keyword",
      role: "assistant",
      content: "Use a spring sale offer with a strong CTA.",
      createdAt: "2026-05-14T00:01:00.000Z"
    });
    await repositories.messages.save({
      id: "message_neutral",
      taskId: "task_neutral",
      role: "assistant",
      content: "Draft a neutral page about winter inventory.",
      createdAt: "2026-05-14T00:01:00.000Z"
    });

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      taskId: "task_current",
      role: "builder",
      input: {
        prompt: "Build a spring sale page",
        brief: {
          ...sampleBrief,
          objective: "Convert paid shoppers",
          audience: "Returning customers"
        }
      },
      now: () => new Date("2026-05-15T00:00:00.000Z")
    });

    expect(memory.messages[0]?.id).toBe("message_keyword");
    expect(memory.messages[0]?.score).toBeGreaterThan(memory.messages[1]?.score ?? 0);
  });

  it("summarizes failed runs and tool observations without raw output", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.tasks.save({
      id: "task_1",
      title: "Deploy landing page",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    await repositories.runs.save({
      id: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "deployer",
      state: "failed",
      startedAt: "2026-05-14T00:01:00.000Z",
      completedAt: "2026-05-14T00:02:00.000Z",
      contextSummary: {
        injected: [],
        omitted: []
      }
    });
    await repositories.runEvents.save({
      id: "event_1",
      runId: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      sequence: 1,
      type: "run.failed",
      message: "Deployment failed.",
      payload: {
        rawOutput: "published secret-token <html>full artifact</html>"
      },
      createdAt: "2026-05-14T00:02:00.000Z"
    });
    await repositories.toolObservations.save({
      id: "tool_1",
      runId: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      toolName: "skill:deploy:publish",
      input: {
        rawOutput: "published secret-token <html>full artifact</html>"
      },
      outputSummary: "stdout: 47 chars\nstderr: 0 chars",
      state: "failed",
      exitCode: 1,
      errorName: "deploy_failed",
      createdAt: "2026-05-14T00:01:30.000Z",
      completedAt: "2026-05-14T00:02:00.000Z"
    });

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      taskId: "task_1",
      role: "deployer",
      input: {
        prompt: "Deploy the spring sale landing page"
      }
    });

    expect(memory.runs).toEqual([
      expect.objectContaining({
        id: "run_1",
        taskId: "task_1",
        role: "deployer",
        state: "failed",
        eventTypes: ["run.failed"]
      })
    ]);
    expect(memory.tools).toEqual([
      {
        id: "tool_1",
        runId: "run_1",
        taskId: "task_1",
        toolName: "skill:deploy:publish",
        state: "failed",
        outputSummary: "stdout: 47 chars\nstderr: 0 chars",
        exitCode: 1,
        errorName: "deploy_failed",
        createdAt: "2026-05-14T00:01:30.000Z",
        completedAt: "2026-05-14T00:02:00.000Z",
        score: expect.any(Number)
      }
    ]);
    const serialized = JSON.stringify(memory);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("<html>");
    expect(serialized).not.toContain("published");
  });

  it("redacts secret-like values from tool error names", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.tasks.save({
      id: "task_1",
      title: "Deploy landing page",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    await repositories.runs.save({
      id: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      role: "deployer",
      state: "failed",
      startedAt: "2026-05-14T00:01:00.000Z",
      completedAt: "2026-05-14T00:02:00.000Z",
      contextSummary: {
        injected: [],
        omitted: []
      }
    });
    await repositories.toolObservations.save({
      id: "tool_1",
      runId: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      toolName: "skill:deploy:publish",
      input: {},
      outputSummary: "stdout: 0 chars\nstderr: 0 chars",
      state: "failed",
      exitCode: 1,
      errorName: "OPENAI_API_KEY=sk-test-secret",
      createdAt: "2026-05-14T00:01:30.000Z",
      completedAt: "2026-05-14T00:02:00.000Z"
    });

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      taskId: "task_1",
      role: "deployer",
      input: {
        prompt: "Deploy the spring sale landing page"
      }
    });

    expect(memory.tools[0]?.errorName).toContain("[REDACTED]");
    const serialized = JSON.stringify(memory);
    expect(serialized).not.toContain("sk-test-secret");
    expect(serialized).not.toContain("OPENAI_API_KEY=sk-test-secret");
  });

  it("summarizes artifacts as metadata without full source", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.briefs.save({
      id: "brief_1",
      projectId: "project_1",
      prompt: "Build a spring sale landing page",
      brief: {
        ...sampleBrief,
        title: "Spring Sale Landing Page",
        objective: "Convert paid traffic"
      },
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    await repositories.pageVersions.save({
      id: "page_version_1",
      projectId: "project_1",
      briefId: "brief_1",
      artifacts: {
        indexHtml: "<!doctype html><html><body>secret-token</body></html>",
        stylesCss: "body { color: red; }",
        scriptJs: "console.log('secret-token');"
      },
      reviewStatus: "passed",
      findings: [],
      createdAt: "2026-05-14T00:03:00.000Z"
    });

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      role: "builder",
      input: {
        prompt: "Build a spring sale page",
        brief: sampleBrief
      }
    });

    expect(memory.artifacts).toEqual([
      {
        pageVersionId: "page_version_1",
        briefId: "brief_1",
        title: "Spring Sale Landing Page",
        objective: "Convert paid traffic",
        files: [
          { name: "index.html", characterCount: 53 },
          { name: "styles.css", characterCount: 20 },
          { name: "script.js", characterCount: 28 }
        ],
        createdAt: "2026-05-14T00:03:00.000Z",
        score: expect.any(Number)
      }
    ]);
    const serialized = JSON.stringify(memory);
    expect(serialized).not.toContain("<!doctype html>");
    expect(serialized).not.toContain("console.log");
    expect(serialized).not.toContain("secret-token");
  });

  it("summarizes workspace-backed artifacts with file metadata without raw content", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const workspaceArtifacts = {
      indexHtml:
        "<!doctype html><html><body>WORKSPACE_RAW_HTML_SECRET secret-token</body></html>",
      stylesCss: "body::before { content: 'WORKSPACE_RAW_CSS_SECRET'; }",
      scriptJs: "console.log('WORKSPACE_RAW_JS_SECRET');"
    };
    await repositories.briefs.save({
      id: "brief_1",
      projectId: "project_1",
      prompt: "Build a spring sale landing page",
      brief: {
        ...sampleBrief,
        title: "Spring Sale Landing Page",
        objective: "Convert paid traffic"
      },
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    await repositories.pageVersions.save({
      id: "page_version_1",
      projectId: "project_1",
      briefId: "brief_1",
      artifactWorkspaceId: "artifact_workspace_1",
      artifacts: {
        indexHtml: "<!doctype html><html><body>EMBEDDED_RAW_HTML_SECRET</body></html>",
        stylesCss: "body { color: red; }",
        scriptJs: "console.log('EMBEDDED_RAW_JS_SECRET');"
      },
      reviewStatus: "passed",
      findings: [],
      createdAt: "2026-05-14T00:03:00.000Z"
    });
    await repositories.artifactWorkspaces.save({
      id: "artifact_workspace_1",
      projectId: "project_1",
      pageVersionId: "page_version_1",
      kind: "static_lp",
      state: "active",
      createdAt: "2026-05-14T00:03:00.000Z",
      updatedAt: "2026-05-14T00:03:00.000Z"
    });
    const files = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_1",
      projectId: "project_1",
      pageVersionId: "page_version_1",
      artifacts: workspaceArtifacts,
      createdAt: "2026-05-14T00:03:00.000Z"
    });
    for (const file of files) {
      await repositories.artifactWorkspaceFiles.save(file);
    }

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      role: "builder",
      input: {
        prompt: "Build a spring sale page",
        brief: sampleBrief
      }
    });

    expect(memory.artifacts).toEqual([
      {
        pageVersionId: "page_version_1",
        briefId: "brief_1",
        artifactWorkspaceId: "artifact_workspace_1",
        title: "Spring Sale Landing Page",
        objective: "Convert paid traffic",
        files: files.map((file) => ({
          name: file.path,
          path: file.path,
          characterCount: file.content.length,
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
          summary: file.summary
        })),
        createdAt: "2026-05-14T00:03:00.000Z",
        score: expect.any(Number)
      }
    ]);
    const serialized = JSON.stringify(memory);
    expect(serialized).not.toContain("WORKSPACE_RAW_HTML_SECRET");
    expect(serialized).not.toContain("WORKSPACE_RAW_CSS_SECRET");
    expect(serialized).not.toContain("WORKSPACE_RAW_JS_SECRET");
    expect(serialized).not.toContain("EMBEDDED_RAW_HTML_SECRET");
    expect(serialized).not.toContain("EMBEDDED_RAW_JS_SECRET");
    expect(serialized).not.toContain("<!doctype html>");
    expect(serialized).not.toContain("console.log");
  });

  it("falls back to embedded artifact lengths when a referenced workspace is missing", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.pageVersions.save({
      id: "page_version_missing_workspace",
      projectId: "project_1",
      briefId: "brief_1",
      artifactWorkspaceId: "artifact_workspace_missing",
      artifacts: {
        indexHtml: "<!doctype html><html><body>secret-token</body></html>",
        stylesCss: "body { color: red; }",
        scriptJs: "console.log('secret-token');"
      },
      reviewStatus: "passed",
      findings: [],
      createdAt: "2026-05-14T00:03:00.000Z"
    });

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      role: "builder",
      input: {
        prompt: "Build a spring sale page"
      }
    });

    expect(memory.artifacts).toEqual([
      {
        pageVersionId: "page_version_missing_workspace",
        briefId: "brief_1",
        files: [
          { name: "index.html", characterCount: 53 },
          { name: "styles.css", characterCount: 20 },
          { name: "script.js", characterCount: 28 }
        ],
        createdAt: "2026-05-14T00:03:00.000Z",
        score: expect.any(Number)
      }
    ]);
    expect(memory.artifacts[0]).not.toHaveProperty("artifactWorkspaceId");
    expect(memory.artifacts[0]?.files[0]).not.toHaveProperty("sha256");
  });

  it("fails closed when the workspace owner does not match the page version", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.pageVersions.save({
      id: "page_version_wrong_workspace_owner",
      projectId: "project_1",
      briefId: "brief_1",
      artifactWorkspaceId: "artifact_workspace_wrong_owner",
      artifacts: {
        indexHtml: "<!doctype html><html><body>Embedded page</body></html>",
        stylesCss: "body { color: red; }",
        scriptJs: "console.log('embedded');"
      },
      reviewStatus: "passed",
      findings: [],
      createdAt: "2026-05-14T00:03:00.000Z"
    });
    await repositories.artifactWorkspaces.save({
      id: "artifact_workspace_wrong_owner",
      projectId: "project_2",
      pageVersionId: "page_version_wrong_workspace_owner",
      kind: "static_lp",
      state: "active",
      createdAt: "2026-05-14T00:03:00.000Z",
      updatedAt: "2026-05-14T00:03:00.000Z"
    });

    await expect(
      assembleContextMemory({
        repositories,
        projectId: "project_1",
        role: "builder",
        input: {
          prompt: "Build a spring sale page"
        }
      })
    ).rejects.toThrow(
      "Artifact workspace artifact_workspace_wrong_owner does not belong to page version page_version_wrong_workspace_owner."
    );
  });

  it("fails closed when workspace file ownership does not match the page version", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.pageVersions.save({
      id: "page_version_wrong_file_owner",
      projectId: "project_1",
      briefId: "brief_1",
      artifactWorkspaceId: "artifact_workspace_wrong_file_owner",
      artifacts: {
        indexHtml: "<!doctype html><html><body>Embedded page</body></html>",
        stylesCss: "body { color: red; }",
        scriptJs: "console.log('embedded');"
      },
      reviewStatus: "passed",
      findings: [],
      createdAt: "2026-05-14T00:03:00.000Z"
    });
    await repositories.artifactWorkspaces.save({
      id: "artifact_workspace_wrong_file_owner",
      projectId: "project_1",
      pageVersionId: "page_version_wrong_file_owner",
      kind: "static_lp",
      state: "active",
      createdAt: "2026-05-14T00:03:00.000Z",
      updatedAt: "2026-05-14T00:03:00.000Z"
    });
    const files = createStaticArtifactWorkspaceFiles({
      workspaceId: "artifact_workspace_wrong_file_owner",
      projectId: "project_1",
      pageVersionId: "page_version_other",
      artifacts: {
        indexHtml: "<!doctype html><html><body>Wrong file owner</body></html>",
        stylesCss: "body { color: blue; }",
        scriptJs: "console.log('wrong');"
      },
      createdAt: "2026-05-14T00:03:00.000Z"
    });
    for (const file of files) {
      await repositories.artifactWorkspaceFiles.save(file);
    }

    await expect(
      assembleContextMemory({
        repositories,
        projectId: "project_1",
        role: "builder",
        input: {
          prompt: "Build a spring sale page"
        }
      })
    ).rejects.toThrow(
      "Artifact workspace file index.html does not belong to page version page_version_wrong_file_owner."
    );
  });

  it("preserves artifact workspace metadata in context pack schema without raw content", () => {
    const parsed = ContextPackSchema.parse({
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      input: {
        prompt: "Build"
      },
      runtimeContext: {
        skills: [],
        mcpTools: [],
        approval: {
          state: "not_required"
        },
        artifactWorkspace: {
          mode: "filesystem",
          workspaceId: "artifact_workspace_1",
          basePath: "/tmp/lp-agent/project_1",
          writableFiles: ["index.html", "styles.css", "script.js"],
          files: [
            {
              path: "index.html",
              kind: "html",
              mimeType: "text/html",
              sizeBytes: 128,
              sha256: "hash-index",
              summary: "index.html static LP file",
              content: "RAW_RUNTIME_CONTEXT_SECRET"
            }
          ]
        }
      },
      trace: {
        injected: ["artifactWorkspace:filesystem"],
        omitted: []
      },
      createdAt: "2026-05-14T00:03:00.000Z"
    });

    expect(parsed.runtimeContext.artifactWorkspace).toEqual({
      mode: "filesystem",
      workspaceId: "artifact_workspace_1",
      basePath: "/tmp/lp-agent/project_1",
      writableFiles: ["index.html", "styles.css", "script.js"],
      files: [
        {
          path: "index.html",
          kind: "html",
          mimeType: "text/html",
          sizeBytes: 128,
          sha256: "hash-index",
          summary: "index.html static LP file"
        }
      ]
    });
    expect(JSON.stringify(parsed)).not.toContain("RAW_RUNTIME_CONTEXT_SECRET");
  });

  it("does not emit empty artifact title or objective when the linked brief is missing", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.pageVersions.save({
      id: "page_version_missing_brief",
      projectId: "project_1",
      briefId: "brief_missing",
      artifacts: {
        indexHtml: "<!doctype html><html><body>secret-token</body></html>",
        stylesCss: "body { color: red; }",
        scriptJs: "console.log('secret-token');"
      },
      reviewStatus: "passed",
      findings: [],
      createdAt: "2026-05-14T00:03:00.000Z"
    });

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      role: "builder",
      input: {
        prompt: "Build a spring sale page",
        brief: sampleBrief
      }
    });

    expect(memory.artifacts).toEqual([
      {
        pageVersionId: "page_version_missing_brief",
        briefId: "brief_missing",
        files: [
          { name: "index.html", characterCount: 53 },
          { name: "styles.css", characterCount: 20 },
          { name: "script.js", characterCount: 28 }
        ],
        createdAt: "2026-05-14T00:03:00.000Z",
        score: expect.any(Number)
      }
    ]);
    expect(memory.artifacts[0]).not.toHaveProperty("title");
    expect(memory.artifacts[0]).not.toHaveProperty("objective");
    const serialized = JSON.stringify(memory);
    expect(serialized).not.toContain("<!doctype html>");
    expect(serialized).not.toContain("color: red");
    expect(serialized).not.toContain("console.log");
    expect(serialized).not.toContain("secret-token");
  });

  it("records budget omissions when source records exceed limits", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.tasks.save({
      id: "task_1",
      title: "Current build",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    for (const id of ["message_1", "message_2", "message_3"]) {
      await repositories.messages.save({
        id,
        taskId: "task_1",
        role: "assistant",
        content: `Relevant spring sale note ${id}`,
        createdAt: `2026-05-14T00:0${id.at(-1)}:00.000Z`
      });
    }

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      input: {
        prompt: "Build a spring sale page"
      },
      limits: {
        messages: 1,
        runs: 0,
        tools: 0,
        artifacts: 0
      }
    });

    expect(memory.messages).toHaveLength(1);
    expect(memory.retrieval.omitted).toEqual(
      expect.arrayContaining([
        "memory:messages:budget_exceeded",
        "memory:runs:none",
        "memory:tools:none",
        "memory:artifacts:none"
      ])
    );
  });

  it("applies the total memory character budget after source selection", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.tasks.save({
      id: "task_1",
      title: "Current build",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    for (const id of ["message_1", "message_2", "message_3"]) {
      await repositories.messages.save({
        id,
        taskId: "task_1",
        role: "assistant",
        content: `Spring sale detail ${id} ${"x".repeat(240)}`,
        createdAt: `2026-05-14T00:0${id.at(-1)}:00.000Z`
      });
    }

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      input: {
        prompt: "Build a spring sale page"
      },
      limits: {
        messages: 3,
        totalCharacters: 520
      }
    });

    expect(memory.messages.length).toBeLessThan(3);
    expect(memory.retrieval.omitted).toContain("memory:total:budget_exceeded");
  });

  it("keeps serialized memory within total budget when the current prompt is large", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.tasks.save({
      id: "task_1",
      title: "Current build",
      type: "lp_generation",
      status: "complete",
      projectId: "project_1",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    for (const id of ["message_1", "message_2"]) {
      await repositories.messages.save({
        id,
        taskId: "task_1",
        role: "assistant",
        content: `Spring campaign note ${id} ${"x".repeat(120)}`,
        createdAt: `2026-05-14T00:0${id.at(-1)}:00.000Z`
      });
    }
    const fullQuery = toContextMemoryQuery({
      role: "builder",
      input: {
        prompt: `Build a spring sale page ${"customer ".repeat(500)}`
      }
    });
    const limit = 700;

    const memory = await assembleContextMemory({
      repositories,
      projectId: "project_1",
      taskId: "task_1",
      role: "builder",
      input: {
        prompt: `Build a spring sale page ${"customer ".repeat(500)}`
      },
      limits: {
        messages: 2,
        runs: 0,
        tools: 0,
        artifacts: 0,
        totalCharacters: limit
      }
    });

    expect(JSON.stringify(memory).length).toBeLessThanOrEqual(limit);
    expect(memory.retrieval.query.length).toBeLessThan(fullQuery.length);
    expect(memory.retrieval.selected).toEqual(
      memory.messages.map((message) => `message:${message.id}`)
    );
    expect(memory.retrieval.omitted).toContain("memory:total:budget_exceeded");
  });
});
