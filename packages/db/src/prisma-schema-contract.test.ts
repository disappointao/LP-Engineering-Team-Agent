import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const schemaPath = join(process.cwd(), "packages/db/prisma/schema.prisma");

describe("Prisma workbench schema contract", () => {
  it("contains Stage 22 workbench repository models and fields", async () => {
    const schema = await readFile(schemaPath, "utf8");

    for (const model of [
      "WorkbenchTask",
      "WorkbenchMessage",
      "WorkbenchTaskSnapshot",
      "ArtifactWorkspace",
      "ArtifactWorkspaceFile",
      "AgentHandoff"
    ]) {
      expect(schema).toContain(`model ${model} `);
    }

    for (const field of [
      "taskId",
      "startedAt",
      "completedAt",
      "contextSummary",
      "message",
      "artifactWorkspaceId",
      "findings",
      "prompt",
      "artifactRefs"
    ]) {
      expect(schema).toContain(field);
    }

    expect(schema).toContain("@@unique([runId, sequence])");
    expect(schema).toContain("@@unique([workspaceId, path])");
  });
});
