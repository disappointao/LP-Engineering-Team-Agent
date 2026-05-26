import { describe, expect, it } from "vitest";
import { parseChatMessageBlocks } from "./chat-message-content";

describe("chat message content parsing", () => {
  it("keeps paragraphs, lists, and fenced code blocks as distinct blocks", () => {
    expect(
      parseChatMessageBlocks(
        [
          "Here is a plan:",
          "",
          "- Define the audience",
          "- Write the offer",
          "",
          "```ts",
          "const cta = \"Shop now\";",
          "```"
        ].join("\n")
      )
    ).toEqual([
      {
        kind: "paragraph",
        text: "Here is a plan:"
      },
      {
        items: ["Define the audience", "Write the offer"],
        kind: "unordered-list"
      },
      {
        code: "const cta = \"Shop now\";",
        kind: "code",
        language: "ts"
      }
    ]);
  });
});
