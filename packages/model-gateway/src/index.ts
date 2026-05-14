export type AgentRole = "planner" | "builder" | "reviewer" | "deployer";

export type ModelProviderApi = "mock" | "openai-completions" | "anthropic-messages";

export interface ModelProviderHeaderRef {
  env: string;
}

export interface ModelProviderModelConfig {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
  supportsImages?: boolean;
}

export interface ModelProviderRuntimeConfig {
  api: ModelProviderApi;
  baseUrl?: string;
  apiKeyEnv?: string;
  secretEnvName?: string;
  headers?: Record<string, ModelProviderHeaderRef>;
  models?: ModelProviderModelConfig[];
  compat?: Record<string, unknown>;
}

export interface ModelRoute {
  provider: string;
  providerName?: string;
  api?: ModelProviderApi;
  model: string;
  baseUrlConfigured?: boolean;
  apiKeyEnvConfigured?: boolean;
  modelCapabilities?: Omit<ModelProviderModelConfig, "id" | "name"> & {
    name?: string;
  };
}

export type ModelRoutingPolicy = Record<AgentRole, ModelRoute>;

export type ModelApprovalState = "not_required" | "pending" | "approved";
export type ArtifactWorkspaceMode = "memory" | "filesystem";

export interface ModelSkillContext {
  id: string;
  name: string;
  version: string;
  scope: string;
  permissions: string[];
  entrypoints: string[];
  content: string;
  contentType: "text/markdown" | "text/plain";
}

export interface ModelMCPToolContext {
  connectorId: string;
  name: string;
  permission: string;
  requiresApproval: boolean;
}

export interface ModelApprovalContext {
  state: ModelApprovalState;
  approvedByUserId?: string;
}

export interface ModelArtifactWorkspaceContext {
  mode: ArtifactWorkspaceMode;
  basePath?: string;
  writableFiles: string[];
}

export interface ModelRequestContext {
  skills: ModelSkillContext[];
  mcpTools: ModelMCPToolContext[];
  approval: ModelApprovalContext;
  artifactWorkspace: ModelArtifactWorkspaceContext;
}

export interface ModelRequest {
  role: AgentRole;
  prompt: string;
  projectId: string;
  context?: ModelRequestContext;
  routingPolicy?: ModelRoutingPolicy;
}

export interface ModelResponse {
  provider: string;
  providerName?: string;
  api?: ModelProviderApi;
  model: string;
  baseUrlConfigured?: boolean;
  apiKeyEnvConfigured?: boolean;
  modelCapabilities?: ModelRoute["modelCapabilities"];
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

export const agentRoles = Object.freeze([
  "planner",
  "builder",
  "reviewer",
  "deployer"
] as const) satisfies readonly AgentRole[];

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
    const policy = request.routingPolicy ? clonePolicy(request.routingPolicy) : this.policy;
    const route = policy[request.role];
    if (!route) {
      throw new ModelRouteNotConfiguredError(request.role);
    }

    this.auditEntries.push({
      role: request.role,
      projectId: request.projectId,
      ...cloneRoute(route),
      promptLength: request.prompt.length,
      context: request.context ? cloneModelRequestContext(request.context) : undefined
    });

    return {
      provider: route.provider,
      ...(route.providerName ? { providerName: route.providerName } : {}),
      ...(route.api ? { api: route.api } : {}),
      model: route.model,
      ...(route.baseUrlConfigured !== undefined
        ? { baseUrlConfigured: route.baseUrlConfigured }
        : {}),
      ...(route.apiKeyEnvConfigured !== undefined
        ? { apiKeyEnvConfigured: route.apiKeyEnvConfigured }
        : {}),
      ...(route.modelCapabilities
        ? { modelCapabilities: cloneModelCapabilities(route.modelCapabilities) }
        : {}),
      text: `${request.role} response from ${route.provider}/${route.model}`,
      usage: {
        inputTokens: Math.ceil(request.prompt.length / 4),
        outputTokens: 32
      }
    };
  }

  getAuditLog(): readonly ModelAuditEntry[] {
    return this.auditEntries.map((entry) => ({
      ...cloneRoute(entry),
      role: entry.role,
      projectId: entry.projectId,
      promptLength: entry.promptLength,
      context: entry.context ? cloneModelRequestContext(entry.context) : undefined
    }));
  }
}

function cloneModelRequestContext(context: ModelRequestContext): ModelRequestContext {
  return {
    skills: context.skills.map((skill) => ({
      ...skill,
      permissions: [...skill.permissions],
      entrypoints: [...skill.entrypoints]
    })),
    mcpTools: context.mcpTools.map((tool) => ({ ...tool })),
    approval: { ...context.approval },
    artifactWorkspace: {
      ...context.artifactWorkspace,
      writableFiles: [...context.artifactWorkspace.writableFiles]
    }
  };
}

function clonePolicy(policy: ModelRoutingPolicy): Partial<ModelRoutingPolicy> {
  return agentRoles.reduce<Partial<ModelRoutingPolicy>>((cloned, role) => {
    const route = policy[role];
    if (isModelRoute(route)) {
      cloned[role] = cloneRoute(route);
    }

    return cloned;
  }, {});
}

function cloneRoute(route: ModelRoute): ModelRoute {
  return {
    provider: route.provider,
    ...(route.providerName ? { providerName: route.providerName } : {}),
    ...(route.api ? { api: route.api } : {}),
    model: route.model,
    ...(route.baseUrlConfigured !== undefined
      ? { baseUrlConfigured: route.baseUrlConfigured }
      : {}),
    ...(route.apiKeyEnvConfigured !== undefined
      ? { apiKeyEnvConfigured: route.apiKeyEnvConfigured }
      : {}),
    ...(route.modelCapabilities
      ? { modelCapabilities: cloneModelCapabilities(route.modelCapabilities) }
      : {})
  };
}

function cloneModelCapabilities(
  capabilities: NonNullable<ModelRoute["modelCapabilities"]>
): NonNullable<ModelRoute["modelCapabilities"]> {
  return { ...capabilities };
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
