import { describe, expect, it } from "vitest";
import {
  getPromptSubmissionControlState,
  getStreamingSubmitDecision
} from "./streaming-workbench";

function collectEnabledPromptPayload({
  visiblePromptDisabled,
  hiddenPromptValue
}: {
  visiblePromptDisabled: boolean;
  hiddenPromptValue?: string;
}): string[] {
  return [
    {
      disabled: visiblePromptDisabled,
      name: "prompt",
      value: ""
    },
    hiddenPromptValue === undefined
      ? undefined
      : {
          disabled: false,
          name: "prompt",
          value: hiddenPromptValue
        }
  ]
    .filter(
      (control): control is { disabled: boolean; name: string; value: string } =>
        control !== undefined
    )
    .filter((control) => control.name === "prompt" && !control.disabled)
    .map((control) => control.value);
}

describe("streaming workbench prompt submission controls", () => {
  it("keeps an enabled prompt payload available for fallback submission while the visible prompt is disabled", () => {
    const controls = getPromptSubmissionControlState({
      fallbackPrompt: "Build a launch page",
      isStreaming: false
    });

    expect(controls.visiblePromptDisabled).toBe(true);
    expect(collectEnabledPromptPayload(controls)).toEqual(["Build a launch page"]);
  });

  it("does not add a duplicate hidden prompt during ordinary non-fallback submission", () => {
    const controls = getPromptSubmissionControlState({
      fallbackPrompt: undefined,
      isStreaming: false
    });

    expect(controls.visiblePromptDisabled).toBe(false);
    expect(controls.hiddenPromptValue).toBeUndefined();
    expect(collectEnabledPromptPayload(controls)).toEqual([""]);
  });
});

describe("streaming workbench submit interception", () => {
  it("intercepts blank ordinary chat submits without starting stream handling", () => {
    const decision = getStreamingSubmitDecision({
      promptValue: "   ",
      skipStreamingOnce: false
    });

    expect(decision).toEqual({
      allowNativeSubmit: false,
      preventDefault: true,
      streamPrompt: undefined
    });
  });
});
