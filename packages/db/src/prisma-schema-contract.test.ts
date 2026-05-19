import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, "../prisma/schema.prisma");

function modelBlock(schema: string, modelName: string): string {
  const lines = schema.split(/\r?\n/);
  const startIndex = lines.findIndex((line) =>
    new RegExp(`^\\s*model\\s+${modelName}\\s*\\{\\s*$`).test(line)
  );

  if (startIndex === -1) {
    throw new Error(`Missing Prisma model ${modelName}`);
  }

  const blockLines: string[] = [];
  let depth = 0;

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    blockLines.push(line);
    depth += (line.match(/\{/g) ?? []).length;
    depth -= (line.match(/\}/g) ?? []).length;

    if (index > startIndex && depth === 0) {
      return blockLines.join("\n");
    }
  }

  throw new Error(`Unclosed Prisma model ${modelName}`);
}

describe("Prisma workbench schema contract", () => {
  it("contains Stage 22 workbench repository models", async () => {
    const schema = await readFile(schemaPath, "utf8");

    for (const model of [
      "WorkbenchTask",
      "WorkbenchMessage",
      "WorkbenchTaskSnapshot",
      "ArtifactWorkspace",
      "ArtifactWorkspaceFile",
      "AgentHandoff"
    ]) {
      expect(modelBlock(schema, model)).toContain(`model ${model}`);
    }
  });

  it("contains Stage 22 workbench repository fields in the intended models", async () => {
    const schema = await readFile(schemaPath, "utf8");

    const run = modelBlock(schema, "Run");
    for (const field of [
      "taskId",
      "startedAt",
      "completedAt",
      "contextSummary",
      "outboundHandoffs",
      "@@index([taskId])",
      "@@index([state])",
      "@@index([startedAt])"
    ]) {
      expect(run).toContain(field);
    }

    const runEvent = modelBlock(schema, "RunEvent");
    for (const field of [
      "projectId",
      "taskId",
      "message",
      "@@unique([runId, sequence])"
    ]) {
      expect(runEvent).toContain(field);
    }

    const brief = modelBlock(schema, "LPBrief");
    for (const field of ["prompt", "taskSnapshots"]) {
      expect(brief).toContain(field);
    }

    const pageVersion = modelBlock(schema, "PageVersion");
    for (const field of [
      "artifactWorkspaceId",
      "findings",
      "taskSnapshots",
      "artifactWorkspaces",
      "artifactWorkspaceFiles"
    ]) {
      expect(pageVersion).toContain(field);
    }

    const agentHandoff = modelBlock(schema, "AgentHandoff");
    for (const field of [
      "artifactRefs",
      "fromRun",
      '@relation("AgentHandoffFromRun"'
    ]) {
      expect(agentHandoff).toContain(field);
    }

    expect(modelBlock(schema, "ArtifactWorkspaceFile")).toContain(
      "@@unique([workspaceId, path])"
    );
  });
});
