import { describe, expect, it } from "vitest";
import {
  ArtifactSchema,
  LPBriefSchema,
  PageVersionSchema,
  RunStateSchema,
  sampleBrief
} from "./index";

describe("LP brief schema", () => {
  it("accepts a valid structured LP brief", () => {
    const parsed = LPBriefSchema.parse(sampleBrief);

    expect(parsed.title).toBe("Spring Sale Landing Page");
    expect(parsed.sections).toHaveLength(4);
    expect(parsed.sections[0]?.type).toBe("hero");
  });

  it("rejects a brief without sections", () => {
    expect(() =>
      LPBriefSchema.parse({
        ...sampleBrief,
        sections: []
      })
    ).toThrow();
  });

  it("validates page versions with static artifacts", () => {
    const artifact = ArtifactSchema.parse({
      id: "artifact_static_lp",
      kind: "three-file-static",
      files: {
        indexHtml: "index.html",
        stylesCss: "styles.css",
        scriptJs: "script.js"
      }
    });

    const version = PageVersionSchema.parse({
      id: "version_1",
      brief: sampleBrief,
      artifact,
      reviewStatus: "pending",
      createdAt: "2026-05-11T00:00:00.000Z"
    });

    expect(version.artifact.files.stylesCss).toBe("styles.css");
  });

  it("limits run states to explicit lifecycle values", () => {
    expect(RunStateSchema.parse("needs_approval")).toBe("needs_approval");
    expect(() => RunStateSchema.parse("waiting")).toThrow();
  });
});
