import { describe, expect, it } from "vitest";
import {
  createAssistantChatPrompt,
  createAssistantContextSummary
} from "./assistant-chat";

describe("assistant chat prompt", () => {
  it("builds bounded prompt context from project skills and memory", () => {
    const prompt = createAssistantChatPrompt({
      userPrompt: "How should this LP speak to buyers?",
      project: { id: "project_1", name: "Spring Campaign" },
      context: {
        skills: [
          {
            id: "skill_brand",
            name: "Brand Voice",
            version: "1.0.0",
            scope: "project",
            permissions: ["brief:read"],
            entrypoints: ["voice.md"],
            content: "Use a concise, confident voice. ".repeat(80),
            contentType: "text/markdown"
          }
        ],
        mcpTools: [],
        approval: { state: "not_required" },
        artifactWorkspace: { mode: "memory", writableFiles: ["index.html"] },
        memory: {
          messages: [
            {
              id: "message_1",
              taskId: "task_1",
              role: "user",
              preview: "Earlier buyer question",
              createdAt: "2026-05-21T00:00:00.000Z",
              score: 10
            }
          ],
          runs: [],
          tools: [],
          artifacts: [],
          retrieval: {
            query: "How should this LP speak to buyers?",
            strategy: "deterministic_recent_project_context",
            selected: ["message_1"],
            omitted: []
          }
        }
      },
      trace: { injected: ["skills:1"], omitted: [] }
    });

    expect(prompt).toContain("Active workspace: Spring Campaign");
    expect(prompt).not.toContain("project_1");
    expect(prompt).toContain("Skill: Brand Voice@1.0.0");
    expect(prompt).toContain("Earlier buyer question");
    expect(prompt).toContain("How should this LP speak to buyers?");
    expect(prompt.length).toBeLessThan(6000);
  });

  it("keeps the user message when long skill context exceeds the prompt budget", () => {
    const userPrompt = "Please answer this exact buyer positioning question.";
    const prompt = createAssistantChatPrompt({
      userPrompt,
      project: { id: "project_1", name: "Spring Campaign" },
      context: {
        skills: Array.from({ length: 20 }, (_, index) => ({
          id: `skill_${index + 1}`,
          name: `Long Skill ${index + 1}`,
          version: "1.0.0",
          scope: "project",
          permissions: ["brief:read"],
          entrypoints: ["skill.md"],
          content: `Long context ${index + 1}. `.repeat(200),
          contentType: "text/markdown" as const
        })),
        mcpTools: [],
        approval: { state: "not_required" },
        artifactWorkspace: { mode: "memory", writableFiles: ["index.html"] }
      },
      trace: { injected: ["skills:20"], omitted: [] }
    });

    expect(prompt.length).toBeLessThanOrEqual(12000);
    expect(prompt).toContain(`User message:\n${userPrompt}`);
  });

  it("hides internal provider project labels from ordinary chat prompts", () => {
    const prompt = createAssistantChatPrompt({
      userPrompt: "你好，测试一下首页回复状态",
      project: { id: "project_4", name: "Local Real Provider" },
      context: {
        skills: [],
        mcpTools: [],
        approval: { state: "not_required" },
        artifactWorkspace: { mode: "memory", writableFiles: [] }
      },
      trace: { injected: [], omitted: [] }
    });

    expect(prompt).not.toContain("Local Real Provider");
    expect(prompt).not.toContain("project_4");
    expect(prompt).toContain("Active workspace: default user workspace");
    expect(prompt).toContain("must not be mentioned");
  });

  it("creates a safe context summary without raw skill content", () => {
    const summary = createAssistantContextSummary({
      project: { id: "project_1", name: "Spring Campaign" },
      runtimeMode: "real",
      skills: [
        {
          id: "skill_brand",
          name: "Brand Voice",
          version: "1.0.0",
          content: "RAW_SKILL_CONTENT_SECRET"
        }
      ]
    });

    expect(summary).toEqual({
      projectId: "project_1",
      projectName: "Spring Campaign",
      runtimeMode: "real",
      skillCount: 1,
      skills: [{ id: "skill_brand", name: "Brand Voice", version: "1.0.0" }]
    });
    expect(JSON.stringify(summary)).not.toContain("RAW_SKILL_CONTENT_SECRET");
  });
});
