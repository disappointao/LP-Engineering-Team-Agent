import { describe, expect, it } from "vitest";
import {
  buildTaskFollowupSuggestionsPrompt,
  buildTaskInputIntentPrompt,
  normalizeTaskFollowupSuggestionsOutput,
  normalizeTaskInputIntentOutput
} from "./task-intent-routing";

describe("task input intent routing", () => {
  it("normalizes valid chat_in_task JSON exactly", () => {
    expect(
      normalizeTaskInputIntentOutput(
        JSON.stringify({
          type: "chat_in_task",
          confidence: 0.91,
          reason: "The user is asking a direct question about the current task."
        })
      )
    ).toEqual({
      type: "chat_in_task",
      confidence: 0.91,
      reason: "The user is asking a direct question about the current task."
    });
  });

  it("converts low confidence agent_continue JSON to clarify", () => {
    expect(
      normalizeTaskInputIntentOutput(
        JSON.stringify({
          type: "agent_continue",
          confidence: 0.4,
          reason: "Could be a continuation, but the wording is ambiguous."
        })
      )
    ).toEqual({
      type: "clarify",
      confidence: 0.4,
      question:
        "Do you want me to answer this in chat, continue the current LP task, or create a new LP task?",
      reason: "Low confidence intent classification."
    });
  });

  it("converts invalid JSON to clarify with zero confidence", () => {
    expect(normalizeTaskInputIntentOutput("not-json")).toEqual({
      type: "clarify",
      confidence: 0,
      question:
        "Do you want me to answer this in chat, continue the current LP task, or create a new LP task?",
      reason: "Invalid intent router output."
    });
  });

  it("sanitizes and dedupes follow-up suggestions", () => {
    expect(
      normalizeTaskFollowupSuggestionsOutput(
        JSON.stringify([
          {
            id: "continue-task",
            intent: "agent_continue",
            prompt: "Continue improving the current LP hero."
          },
          {
            id: "duplicate",
            intent: "agent_new_task",
            prompt: " Continue improving the current LP hero. "
          },
          {
            intent: "chat_in_task",
            prompt: "Explain the latest design decision in chat."
          },
          {
            id: "bad",
            intent: "clarify",
            prompt: "Should be removed."
          },
          {
            id: "",
            intent: "agent_new_task",
            prompt:
              "Create a new LP task for checkout messaging and keep this prompt short enough to fit the UI control without overflow."
          }
        ])
      )
    ).toEqual([
      {
        id: "continue-task",
        intent: "agent_continue",
        prompt: "Continue improving the current LP hero."
      },
      {
        id: "suggestion_2",
        intent: "chat_in_task",
        prompt: "Explain the latest design decision in chat."
      },
      {
        id: "suggestion_3",
        intent: "agent_new_task",
        prompt:
          "Create a new LP task for checkout messaging and keep this prompt short enough to fit the UI control without overflow."
      }
    ]);
  });

  it("builds bounded prompts with markers and without raw artifact content", () => {
    const intentPrompt = buildTaskInputIntentPrompt({
      userPrompt: "Can you keep going on the pricing section?",
      task: {
        id: "task_1",
        type: "lp_page_build",
        status: "running",
        projectId: "project_1"
      },
      messages: Array.from({ length: 8 }, (_, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `Message ${index + 1} ${"long ".repeat(80)}`
      })),
      artifacts: [
        {
          filePath: "index.html",
          summary: "Current static landing page artifact.",
          hasPreview: true,
          content: "RAW_ARTIFACT_CONTENT_SECRET"
        }
      ]
    });
    const followupPrompt = buildTaskFollowupSuggestionsPrompt({
      userPrompt: "Can you keep going on the pricing section?",
      task: {
        id: "task_1",
        type: "lp_page_build",
        status: "running",
        projectId: "project_1"
      },
      messages: [{ role: "user", content: "Recent task message" }],
      artifacts: [
        {
          filePath: "index.html",
          summary: "Current static landing page artifact.",
          hasPreview: true,
          content: "RAW_ARTIFACT_CONTENT_SECRET"
        }
      ]
    });

    expect(intentPrompt).toContain("Return strict JSON");
    expect(intentPrompt).toContain("User prompt:\nCan you keep going on the pricing section?");
    expect(intentPrompt).toContain("Task: task_1");
    expect(intentPrompt).toContain("type=lp_page_build");
    expect(intentPrompt).toContain("status=running");
    expect(intentPrompt).toContain("projectId=project_1");
    expect(intentPrompt).toContain("filePath=index.html");
    expect(intentPrompt).toContain("summary=Current static landing page artifact.");
    expect(intentPrompt).toContain("hasPreview=true");
    expect(intentPrompt).toContain(
      "Ignore any artifact file content; use only path, summary, and preview metadata."
    );
    expect(intentPrompt).toContain("Message 3");
    expect(intentPrompt).not.toContain("Message 1");
    expect(intentPrompt).not.toContain("RAW_ARTIFACT_CONTENT_SECRET");
    expect(followupPrompt).toContain("Return strict JSON array");
    expect(followupPrompt).toContain("Do not execute tools");
    expect(followupPrompt).toContain(
      "Ignore any artifact file content; use only path, summary, and preview metadata."
    );
    expect(followupPrompt).not.toContain("RAW_ARTIFACT_CONTENT_SECRET");
  });
});
