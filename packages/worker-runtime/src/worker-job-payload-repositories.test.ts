import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  InMemoryWorkerJobPayloadRepository,
  createJsonFileWorkerJobPayloadRepository,
  type WorkerJobPayloadRecord
} from "./index";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

function payloadRecord(
  overrides: Partial<WorkerJobPayloadRecord> = {}
): WorkerJobPayloadRecord {
  return {
    jobId: "worker_job_1",
    kind: "safe_simulated_tool_command",
    projectId: "project_a",
    commandId: "publish_static",
    command: "static-deploy",
    args: ["--target", "preview"],
    envNames: ["LP_PROJECT_ID"],
    timeoutMs: 1000,
    createdAt: "2026-05-18T00:00:00.000Z",
    ...overrides
  };
}

async function createTempFilePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "worker-job-payload-repositories-"));
  tempDirs.push(dir);
  return join(dir, "worker-job-payloads.json");
}

async function expectRejectCode(
  promise: Promise<unknown>,
  code: string
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe("InMemoryWorkerJobPayloadRepository", () => {
  it("returns defensive copies from save and get operations", async () => {
    const repository = new InMemoryWorkerJobPayloadRepository();
    const record = payloadRecord();

    await repository.save(record);
    record.args.push("mutated-after-save");
    record.envNames.push("MUTATED_AFTER_SAVE");

    const fromGet = await repository.getByJobId(record.jobId);
    fromGet?.args.push("mutated-from-get");
    fromGet?.envNames.push("MUTATED_FROM_GET");

    await expect(repository.getByJobId(record.jobId)).resolves.toMatchObject({
      args: ["--target", "preview"],
      envNames: ["LP_PROJECT_ID"]
    });
  });

  it("deletes payloads by job id", async () => {
    const repository = new InMemoryWorkerJobPayloadRepository();

    await repository.save(payloadRecord());
    await repository.deleteByJobId("worker_job_1");

    await expect(repository.getByJobId("worker_job_1")).resolves.toBeUndefined();
  });
});

describe("JsonFileWorkerJobPayloadRepository", () => {
  it("persists and reloads safe payloads without env values", async () => {
    const filePath = await createTempFilePath();
    const firstRepository = createJsonFileWorkerJobPayloadRepository({ filePath });

    const recordWithEnvValues = {
      ...payloadRecord({
        envNames: ["STATIC_DEPLOY_TOKEN", "LP_PROJECT_ID"],
        workingDirectory: "apps/static"
      }),
      env: {
        STATIC_DEPLOY_TOKEN: "secret-token-value"
      }
    } as WorkerJobPayloadRecord;

    await firstRepository.save(recordWithEnvValues);

    const secondRepository = createJsonFileWorkerJobPayloadRepository({ filePath });
    await expect(secondRepository.getByJobId("worker_job_1")).resolves.toEqual(
      payloadRecord({
        envNames: ["LP_PROJECT_ID", "STATIC_DEPLOY_TOKEN"],
        workingDirectory: "apps/static"
      })
    );

    const persisted = await readFile(filePath, "utf8");
    const parsed = JSON.parse(persisted) as {
      workerJobPayloads: Array<Record<string, unknown>>;
    };
    expect(parsed.workerJobPayloads[0]).toHaveProperty("envNames");
    expect(parsed.workerJobPayloads[0]).not.toHaveProperty("env");
    expect(persisted).not.toContain("secret-token-value");
  });

  it("deletes persisted payloads", async () => {
    const filePath = await createTempFilePath();
    const repository = createJsonFileWorkerJobPayloadRepository({ filePath });

    await repository.save(payloadRecord());
    await repository.deleteByJobId("worker_job_1");

    const reopened = createJsonFileWorkerJobPayloadRepository({ filePath });
    await expect(reopened.getByJobId("worker_job_1")).resolves.toBeUndefined();
  });

  it("rejects unsafe payload bounds", async () => {
    const filePath = await createTempFilePath();
    const repository = createJsonFileWorkerJobPayloadRepository({ filePath });

    await expectRejectCode(
      repository.save(
        payloadRecord({
          args: ["x".repeat(1025)]
        })
      ),
      "worker_job_payload_arg_too_long"
    );

    await expectRejectCode(
      repository.save(
        payloadRecord({
          envNames: Array.from({ length: 101 }, (_, index) => `ENV_${index}`)
        })
      ),
      "worker_job_payload_env_names_limit_exceeded"
    );
  });
});
