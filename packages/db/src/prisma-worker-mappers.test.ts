import { describe, expect, it } from "vitest";

import type {
  WorkerJobPayloadRecord,
  WorkerJobRecord,
  WorkerLogRecord
} from "@lp-agent/worker-runtime";

import {
  mapPrismaWorkerJobPayloadToRecord,
  mapPrismaWorkerJobToRecord,
  mapPrismaWorkerLogToRecord,
  mapWorkerJobPayloadRecordToPrisma,
  mapWorkerJobRecordToPrisma,
  mapWorkerLogRecordToPrisma
} from "./prisma-worker-mappers";

describe("prisma worker mappers", () => {
  it("round-trips worker job records with dates, json summaries, and optional fields", () => {
    const record: WorkerJobRecord = {
      id: "job-1",
      projectId: "project-1",
      kind: "tool_command",
      state: "running",
      payloadSource: "safe_persisted",
      policy: {
        mode: "simulate",
        allowedCommands: ["deploy preview"],
        timeoutMs: 30_000,
        allowedEnvNames: ["DEPLOY_TOKEN"],
        maxStdoutBytes: 2000,
        maxStderrBytes: 2000,
        network: "disabled"
      },
      inputSummary: {
        projectId: "project-1",
        kind: "tool_command",
        commandId: "deploy-preview",
        command: "deploy preview",
        argCount: 1,
        argsDigest: "digest",
        envNames: ["DEPLOY_TOKEN"],
        workingDirectory: "workspace",
        timeoutMs: 30_000
      },
      resultSummary: {
        state: "completed",
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        stdoutBytes: 2,
        stderrBytes: 0
      },
      errorName: undefined,
      createdAt: "2026-05-20T00:00:00.000Z",
      startedAt: "2026-05-20T00:00:01.000Z",
      completedAt: undefined,
      cancelRequestedAt: undefined,
      cancelledAt: undefined,
      cancelReason: undefined,
      claimedByWorkerId: "worker-1",
      claimToken: "claim-token",
      lastHeartbeatAt: "2026-05-20T00:00:02.000Z",
      heartbeatExpiresAt: "2026-05-20T00:05:02.000Z",
      staleRecoveredAt: undefined,
      staleRecoveryCount: 0,
      lastWorkerLogAt: undefined
    };

    const prisma = mapWorkerJobRecordToPrisma(record);

    expect(prisma.createdAt).toEqual(new Date("2026-05-20T00:00:00.000Z"));
    expect(prisma.startedAt).toEqual(new Date("2026-05-20T00:00:01.000Z"));
    expect(prisma.completedAt).toBeNull();
    expect(prisma.errorName).toBeNull();
    const expectedResultSummary = {
      ...record.resultSummary,
      stdout: "",
      stderr: ""
    };
    expect(prisma.resultSummary).toEqual(expectedResultSummary);
    expect(mapPrismaWorkerJobToRecord(prisma)).toEqual({
      ...record,
      resultSummary: expectedResultSummary
    });
  });

  it("sanitizes worker job result output before persistence", () => {
    const record: WorkerJobRecord = {
      id: "job-1",
      projectId: "project-1",
      kind: "tool_command",
      state: "completed",
      payloadSource: "safe_persisted",
      policy: {
        mode: "simulate",
        allowedCommands: ["deploy preview"],
        timeoutMs: 30_000,
        allowedEnvNames: [],
        maxStdoutBytes: 2000,
        maxStderrBytes: 2000,
        network: "disabled"
      },
      inputSummary: {
        projectId: "project-1",
        kind: "tool_command",
        command: "deploy preview",
        argCount: 0,
        envNames: [],
        timeoutMs: 30_000
      },
      resultSummary: {
        state: "completed",
        exitCode: 0,
        stdout: "raw stdout secret",
        stderr: "raw stderr secret",
        stdoutBytes: 17,
        stderrBytes: 17
      },
      createdAt: "2026-05-20T00:00:00.000Z",
      completedAt: "2026-05-20T00:00:01.000Z"
    };

    const prisma = mapWorkerJobRecordToPrisma(record);

    expect(prisma.resultSummary).toEqual({
      state: "completed",
      exitCode: 0,
      stdout: "",
      stderr: "",
      stdoutBytes: 17,
      stderrBytes: 17
    });
    expect(JSON.stringify(prisma)).not.toContain("raw stdout secret");
    expect(JSON.stringify(prisma)).not.toContain("raw stderr secret");
    expect(mapPrismaWorkerJobToRecord(prisma).resultSummary).toEqual(
      prisma.resultSummary
    );
  });

  it("round-trips safe payload records with canonical env names and no raw fields persisted", () => {
    const record: WorkerJobPayloadRecord & {
      env: Record<string, string>;
      rawStdout: string;
    } = {
      jobId: "worker-job-1",
      kind: "safe_simulated_tool_command",
      projectId: "project-1",
      commandId: "deploy-preview",
      command: "deploy preview",
      args: ["--preview"],
      envNames: ["Z_TOKEN", "A_TOKEN", "A_TOKEN"],
      workingDirectory: "workspace",
      timeoutMs: 30_000,
      createdAt: "2026-05-20T00:00:00.000Z",
      env: { A_TOKEN: "secret-value" },
      rawStdout: "must not persist"
    };

    const prisma = mapWorkerJobPayloadRecordToPrisma(record);

    expect(prisma.envNames).toEqual(["A_TOKEN", "Z_TOKEN"]);
    expect(prisma.createdAt).toEqual(new Date("2026-05-20T00:00:00.000Z"));
    expect(prisma).not.toHaveProperty("env");
    expect(prisma).not.toHaveProperty("rawStdout");
    expect(JSON.stringify(prisma)).not.toContain("secret-value");
    expect(mapPrismaWorkerJobPayloadToRecord(prisma)).toEqual({
      jobId: "worker-job-1",
      kind: "safe_simulated_tool_command",
      projectId: "project-1",
      commandId: "deploy-preview",
      command: "deploy preview",
      args: ["--preview"],
      envNames: ["A_TOKEN", "Z_TOKEN"],
      workingDirectory: "workspace",
      timeoutMs: 30_000,
      createdAt: "2026-05-20T00:00:00.000Z"
    });
  });

  it("rejects unsupported worker payload kinds before persistence", () => {
    expect(() =>
      mapWorkerJobPayloadRecordToPrisma({
        jobId: "worker-job-1",
        kind: "raw_tool_command",
        projectId: "project-1",
        command: "deploy preview",
        args: [],
        envNames: [],
        timeoutMs: 30_000,
        createdAt: "2026-05-20T00:00:00.000Z"
      } as unknown as WorkerJobPayloadRecord)
    ).toThrow("worker_job_payload_kind_not_supported");
  });

  it("sanitizes worker log payloads before persistence", () => {
    const record: WorkerLogRecord = {
      id: "log-1",
      type: "worker.job.completed",
      message: "completed",
      workerId: "worker-1",
      workerJobId: "job-1",
      projectId: "project-1",
      payload: {
        workerId: "worker-1",
        workerJobId: "job-1",
        projectId: "project-1",
        state: "completed",
        previousState: "running",
        nextState: "completed",
        staleRecoveryCount: 1,
        errorName: "none",
        exitCode: 0,
        outputSummary: { stdoutBytes: 2, stderrBytes: 0 },
        createdAt: "2026-05-20T00:00:00.000Z",
        rawStdout: "must not persist",
        rawStderr: "must not persist",
        secret: "must not persist"
      },
      createdAt: "2026-05-20T00:00:01.000Z"
    };

    const prisma = mapWorkerLogRecordToPrisma(record);

    expect(prisma.createdAt).toEqual(new Date("2026-05-20T00:00:01.000Z"));
    expect(prisma.payload).toEqual({
      workerId: "worker-1",
      workerJobId: "job-1",
      projectId: "project-1",
      state: "completed",
      previousState: "running",
      nextState: "completed",
      staleRecoveryCount: 1,
      errorName: "none",
      exitCode: 0,
      outputSummary: { stdoutBytes: 2, stderrBytes: 0 },
      createdAt: "2026-05-20T00:00:00.000Z"
    });
    expect(mapPrismaWorkerLogToRecord(prisma)).toEqual({
      ...record,
      payload: prisma.payload
    });
  });
});
