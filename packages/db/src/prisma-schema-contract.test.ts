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
    const line = lines[index]!;
    blockLines.push(line);
    depth += (line.match(/\{/g) ?? []).length;
    depth -= (line.match(/\}/g) ?? []).length;

    if (index > startIndex && depth === 0) {
      return blockLines.join("\n");
    }
  }

  throw new Error(`Unclosed Prisma model ${modelName}`);
}

function modelLines(block: string): string[] {
  return block.split(/\r?\n/).map((line) => line.trim().replace(/\s+/g, " "));
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

  it("contains Stage 23 Web-facing repository fields and models", async () => {
    const schema = await readFile(schemaPath, "utf8");

    for (const model of [
      "MCPToolApproval",
      "ProjectMember",
      "SkillVersion",
      "MCPConnector"
    ]) {
      expect(schema).toContain(`model ${model} `);
    }

    for (const field of [
      "displayName",
      "updatedAt",
      "contentType",
      "description",
      "toolsJson",
      "approvedByUserId",
      "files"
    ]) {
      expect(schema).toContain(field);
    }

    expect(schema).toContain("@@unique([projectId, connectorId, toolName])");
  });

  it("defines the worker job postgres backend models", async () => {
    const schema = await readFile(schemaPath, "utf8");

    const workerJob = modelBlock(schema, "WorkerJob");
    expect(modelLines(workerJob)).toEqual(
      expect.arrayContaining([
        "id String @id",
        "projectId String",
        "kind String",
        "state String",
        "payloadSource String?",
        "policy Json",
        "inputSummary Json",
        "resultSummary Json?",
        "errorName String?",
        "createdAt DateTime",
        "startedAt DateTime?",
        "completedAt DateTime?",
        "cancelRequestedAt DateTime?",
        "cancelledAt DateTime?",
        "cancelReason String?",
        "claimedByWorkerId String?",
        "claimToken String?",
        "lastHeartbeatAt DateTime?",
        "heartbeatExpiresAt DateTime?",
        "staleRecoveredAt DateTime?",
        "staleRecoveryCount Int?",
        "lastWorkerLogAt DateTime?"
      ])
    );
    expect(workerJob).toContain("@@index([projectId, createdAt, id])");
    expect(workerJob).toContain("@@index([state, payloadSource, createdAt, id])");
    expect(workerJob).toContain("@@index([claimedByWorkerId])");
    expect(workerJob).toContain("@@index([heartbeatExpiresAt])");

    const payload = modelBlock(schema, "WorkerJobPayload");
    expect(modelLines(payload)).toEqual(
      expect.arrayContaining([
        "jobId String @id",
        "kind String",
        "projectId String",
        "commandId String?",
        "command String",
        "args Json",
        "envNames Json",
        "workingDirectory String?",
        "timeoutMs Int",
        "createdAt DateTime"
      ])
    );
    expect(payload).toContain("@@index([projectId, createdAt])");
    expect(payload).toContain("@@index([kind])");
    expect(payload).not.toContain("@relation");

    const log = modelBlock(schema, "WorkerLog");
    expect(modelLines(log)).toEqual(
      expect.arrayContaining([
        "id String @id",
        "type String",
        "message String",
        "workerId String?",
        "workerJobId String?",
        "projectId String?",
        "payload Json",
        "createdAt DateTime"
      ])
    );
    expect(log).toContain("@@index([projectId, createdAt, id])");
    expect(log).toContain("@@index([workerId, createdAt, id])");
    expect(log).toContain("@@index([workerJobId, createdAt, id])");
    expect(log).toContain("@@index([type, createdAt])");
  });
});
