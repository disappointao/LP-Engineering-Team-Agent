export type AgentRole = "planner" | "builder" | "reviewer" | "deployer";

export interface ModelRoute {
  provider: string;
  model: string;
}

export type ModelRoutingPolicy = Record<AgentRole, ModelRoute>;

export type ModelApprovalState = "not_required" | "pending" | "approved";
export type ArtifactWorkspaceMode = "memory" | "filesystem";

export interface ModelRequestContext {
  skillIds: string[];
  toolNames: string[];
  approvalState: ModelApprovalState;
  artifactWorkspaceMode: ArtifactWorkspaceMode;
}

export interface ModelRequest {
  role: AgentRole;
  prompt: string;
  projectId: string;
  context?: ModelRequestContext;
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
  context?: ModelRequestContext;
}

export interface ModelGateway {
  complete(request: ModelRequest): Promise<ModelResponse>;
}

const agentRoles: AgentRole[] = ["planner", "builder", "reviewer", "deployer"];

export const createDefaultModelPolicy = (): ModelRoutingPolicy => ({
  planner: { provider: "mock-openai", model: "planning-model" },
  builder: { provider: "mock-anthropic", model: "code-model" },
  reviewer: { provider: "mock-openai", model: "review-model" },
  deployer: { provider: "mock-local", model: "tool-model" }
});

export class ModelRouteNotConfiguredError extends Error {
  constructor(role: AgentRole) {
    super(`Model route not configured for role: ${role}`);
    this.name = "ModelRouteNotConfiguredError";
  }
}

export class InMemoryModelGateway implements ModelGateway {
  private readonly auditEntries: ModelAuditEntry[] = [];
  private readonly policy: Partial<ModelRoutingPolicy>;

  constructor(policy: ModelRoutingPolicy) {
    this.policy = clonePolicy(policy);
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const route = this.policy[request.role];
    if (!route) {
      throw new ModelRouteNotConfiguredError(request.role);
    }

    this.auditEntries.push({
      role: request.role,
      projectId: request.projectId,
      provider: route.provider,
      model: route.model,
      promptLength: request.prompt.length,
      context: request.context ? cloneModelRequestContext(request.context) : undefined
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

  getAuditLog(): readonly ModelAuditEntry[] {
    return this.auditEntries.map((entry) => ({
      ...entry,
      context: entry.context ? cloneModelRequestContext(entry.context) : undefined
    }));
  }
}

function cloneModelRequestContext(context: ModelRequestContext): ModelRequestContext {
  return {
    skillIds: [...context.skillIds],
    toolNames: [...context.toolNames],
    approvalState: context.approvalState,
    artifactWorkspaceMode: context.artifactWorkspaceMode
  };
}

function clonePolicy(policy: ModelRoutingPolicy): Partial<ModelRoutingPolicy> {
  return agentRoles.reduce<Partial<ModelRoutingPolicy>>((cloned, role) => {
    const route = policy[role];
    if (isModelRoute(route)) {
      cloned[role] = { provider: route.provider, model: route.model };
    }

    return cloned;
  }, {});
}

function isModelRoute(route: unknown): route is ModelRoute {
  if (!route || typeof route !== "object") {
    return false;
  }

  const candidate = route as Partial<ModelRoute>;
  return isNonEmptyString(candidate.provider) && isNonEmptyString(candidate.model);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
