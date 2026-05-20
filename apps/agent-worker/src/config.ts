export type AgentWorkerMode = { mode: "demo" } | { mode: "queue" };

export type AgentWorkerModeEnv = Partial<Record<string, string | undefined>>;

export function resolveAgentWorkerMode(env: AgentWorkerModeEnv): AgentWorkerMode {
  const jobsFilePath = nonEmpty(env.WORKER_JOBS_FILE);
  const payloadsFilePath = nonEmpty(env.WORKER_PAYLOADS_FILE);
  const backend = nonEmpty(env.WORKER_REPOSITORY_BACKEND);

  if (jobsFilePath && !payloadsFilePath) {
    throw new Error("WORKER_PAYLOADS_FILE is required when WORKER_JOBS_FILE is set");
  }
  if (payloadsFilePath && !jobsFilePath) {
    throw new Error("WORKER_JOBS_FILE is required when WORKER_PAYLOADS_FILE is set");
  }
  if (jobsFilePath && payloadsFilePath) {
    return { mode: "queue" };
  }

  if (!backend) {
    return { mode: "demo" };
  }
  if (backend === "json" || backend === "memory" || backend === "postgres") {
    return { mode: "queue" };
  }

  throw new Error(`Unsupported WORKER_REPOSITORY_BACKEND: ${backend}`);
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
