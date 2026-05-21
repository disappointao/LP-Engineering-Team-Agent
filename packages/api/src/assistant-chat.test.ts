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

    expect(prompt).toContain("Project: Spring Campaign");
    expect(prompt).toContain("Skill: Brand Voice@1.0.0");
    expect(prompt).toContain("Earlier buyer question");
    expect(prompt).toContain("How should this LP speak to buyers?");
    expect(prompt.length).toBeLessThan(6000);
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
