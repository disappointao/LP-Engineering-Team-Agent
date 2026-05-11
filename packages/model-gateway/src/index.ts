export type AgentRole = "planner" | "builder" | "reviewer" | "deployer";

export interface ModelRoute {
  provider: string;
  model: string;
}

export type ModelRoutingPolicy = Record<AgentRole, ModelRoute>;

export interface ModelRequest {
  role: AgentRole;
  prompt: string;
  projectId: string;
}

export interface ModelResponse {
  provider: string;
  model: string;
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface ModelAuditEntry extends ModelRoute {
  role: AgentRole;
  projectId: string;
  promptLength: number;
}

export const createDefaultModelPolicy = (): ModelRoutingPolicy => ({
  planner: { provider: "mock-openai", model: "planning-model" },
  builder: { provider: "mock-anthropic", model: "code-model" },
  reviewer: { provider: "mock-openai", model: "review-model" },
  deployer: { provider: "mock-local", model: "tool-model" }
});

export class InMemoryModelGateway {
  readonly auditLog: ModelAuditEntry[] = [];

  constructor(private readonly policy: ModelRoutingPolicy) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const route = this.policy[request.role];
    this.auditLog.push({
      role: request.role,
      projectId: request.projectId,
      provider: route.provider,
      model: route.model,
      promptLength: request.prompt.length
    });

    return {
      provider: route.provider,
      model: route.model,
      text: `${request.role} response from ${route.provider}/${route.model}`,
      usage: {
        inputTokens: Math.ceil(request.prompt.length / 4),
        outputTokens: 32
      }
    };
  }
}
