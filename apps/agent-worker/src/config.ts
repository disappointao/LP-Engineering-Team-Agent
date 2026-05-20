export type AgentWorkerMode = { mode: "demo" } | { mode: "queue" };

export type AgentWorkerModeEnv = Partial<Record<string, string | undefined>>;

export function resolveAgentWorkerMode(env: AgentWorkerModeEnv): AgentWorkerMode {
  const mode = nonEmpty(env.AGENT_WORKER_MODE);
  if (!mode || mode === "queue") {
    return { mode: "queue" };
  }
  if (mode === "demo") {
    return { mode: "demo" };
  }

  throw new Error(`Unsupported AGENT_WORKER_MODE: ${mode}`);
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
