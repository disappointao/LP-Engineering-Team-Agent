// Manual opt-in:
// POSTGRES_WORKER_REPOSITORY_TEST=1 DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm exec vitest run packages/db/src/prisma-worker-repositories.integration.test.ts
import { randomUUID } from "node:crypto";
import {
  InMemoryWorkerRuntime,
  SimulatedExecutionAdapter,
  createSimulatedSandboxPolicy
} from "@lp-agent/worker-runtime";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createPrismaWorkerJobPayloadRepository,
  createPrismaWorkerJobRepository,
  createPrismaWorkerLogRepository
} from "./prisma-worker-repositories";
import type { PrismaWorkerClient } from "./prisma-worker-repositories";

const shouldRun =
  process.env.POSTGRES_WORKER_REPOSITORY_TEST === "1" &&
  Boolean(process.env.DATABASE_URL);

if (shouldRun) {
  const { PrismaClient } = (await import("@prisma/client")) as unknown as {
    PrismaClient: new () => WorkerPrismaClient;
  };
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await prisma.workerLog.deleteMany({});
    await prisma.workerJobPayload.deleteMany({});
    await prisma.workerJob.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("prisma worker repositories integration", () => {
    it("persists a safe worker job through claim, heartbeat, completion, payload cleanup, and logs", async () => {
      const runId = randomUUID().replaceAll("-", "_");
      const projectId = `project_postgres_worker_${runId}`;
      const workerId = `worker_postgres_${runId}`;
      const jobRepository = createPrismaWorkerJobRepository(prisma);
      const payloadRepository = createPrismaWorkerJobPayloadRepository(prisma);
      const logRepository = createPrismaWorkerLogRepository(prisma, {
        maxRecords: 50
      });
      const runtime = new InMemoryWorkerRuntime({
        repository: jobRepository,
        payloadRepository,
        adapter: new SimulatedExecutionAdapter()
      });

      const queued = await runtime.enqueueSafe(
        {
          projectId,
          kind: "tool_command",
          commandId: "deploy_preview",
          command: "deploy-preview",
          args: ["--preview"],
          envNames: ["DEPLOY_TOKEN"],
          workingDirectory: "workspace",
          timeoutMs: 30000
        },
        createSimulatedSandboxPolicy({
          allowedCommands: ["deploy-preview"],
          allowedEnvNames: ["DEPLOY_TOKEN"]
        })
      );

      await expect(payloadRepository.getByJobId(queued.id)).resolves.toMatchObject({
        jobId: queued.id,
        projectId,
        command: "deploy-preview",
        args: ["--preview"],
        envNames: ["DEPLOY_TOKEN"]
      });

      const claim = await runtime.claimOldestQueued({ workerId });
      expect(claim).toMatchObject({
        record: {
          id: queued.id,
          state: "running",
          projectId,
          claimedByWorkerId: workerId
        }
      });

      const heartbeat = await runtime.heartbeatClaimedJob({
        jobId: queued.id,
        workerId,
        claimToken: claim!.claimToken,
        heartbeatTimeoutMs: 30000
      });
      expect(heartbeat).toMatchObject({
        id: queued.id,
        state: "running",
        claimedByWorkerId: workerId,
        claimToken: claim!.claimToken
      });
      expect(heartbeat?.lastHeartbeatAt).toEqual(expect.any(String));
      expect(heartbeat?.heartbeatExpiresAt).toEqual(expect.any(String));

      const completed = await runtime.runClaimedJob(claim!);
      expect(completed).toMatchObject({
        id: queued.id,
        state: "completed",
        projectId,
        resultSummary: {
          state: "completed",
          exitCode: 0
        }
      });
      await expect(jobRepository.getById(queued.id)).resolves.toMatchObject({
        id: queued.id,
        state: "completed",
        resultSummary: {
          stdout: `Simulated deploy-preview for project ${projectId}.`
        }
      });
      await expect(payloadRepository.getByJobId(queued.id)).resolves.toBeUndefined();

      await logRepository.append({
        id: `worker_log_${runId}`,
        type: "worker.job.completed",
        message: "Worker job completed in Postgres integration test.",
        workerId,
        workerJobId: queued.id,
        projectId,
        payload: {
          state: completed.state
        },
        createdAt: new Date().toISOString()
      });

      await expect(
        logRepository.list({ projectId, workerJobId: queued.id, limit: 10 })
      ).resolves.toEqual([
        expect.objectContaining({
          type: "worker.job.completed",
          workerId,
          workerJobId: queued.id,
          projectId,
          payload: {
            state: "completed"
          }
        })
      ]);
    });
  });
} else {
  describe("prisma worker repositories integration", () => {
    it("is skipped unless explicitly enabled with a database URL", () => {
      expect(shouldRun).toBe(false);
    });
  });
}

interface WorkerPrismaClient extends PrismaWorkerClient {
  $disconnect(): Promise<void>;
}
