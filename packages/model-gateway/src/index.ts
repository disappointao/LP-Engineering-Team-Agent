import {
  ModelProviderConfigurationError,
  completeAnthropicMessages,
  type ModelFetch
} from "./anthropic-messages";

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

export {
  ModelProviderConfigurationError,
  ModelProviderRequestError,
  ModelProviderResponseError,
  completeAnthropicMessages,
  toAnthropicMessagesUrl,
  type AnthropicMessagesCompleteInput,
  type ModelFetch
} from "./anthropic-messages";

export interface ModelProviderRuntimeRecord {
  id: string;
  name?: string;
  enabled: boolean;
  config: ModelProviderRuntimeConfig;
}

export interface ModelProviderRuntimeResolver {
  getProvider(providerId: string): Promise<ModelProviderRuntimeRecord | undefined>;
}

export interface ProviderBackedModelGatewayOptions {
  policy: ModelRoutingPolicy;
  providers: ModelProviderRuntimeResolver;
  fetch?: ModelFetch;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  anthropicVersion?: string;
  maxTokens?: number;
  allowMockRoutes?: boolean;
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

    return createMockModelResponse(request, route);
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

export class ProviderBackedModelGateway implements ModelGateway {
  private readonly auditEntries: ModelAuditEntry[] = [];
  private readonly policy: Partial<ModelRoutingPolicy>;
  private readonly providers: ModelProviderRuntimeResolver;
  private readonly fetch?: ModelFetch;
  private readonly env?: Record<string, string | undefined>;
  private readonly timeoutMs?: number;
  private readonly anthropicVersion?: string;
  private readonly maxTokens?: number;
  private readonly allowMockRoutes: boolean;

  constructor(options: ProviderBackedModelGatewayOptions) {
    this.policy = clonePolicy(options.policy);
    this.providers = options.providers;
    this.fetch = options.fetch;
    this.env = options.env;
    this.timeoutMs = options.timeoutMs;
    this.anthropicVersion = options.anthropicVersion;
    this.maxTokens = options.maxTokens;
    this.allowMockRoutes = options.allowMockRoutes ?? true;
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

    if (isMockRoute(route)) {
      if (!this.allowMockRoutes) {
        throw new ModelProviderConfigurationError(
          "model_provider_mock_route_disabled",
          `Mock model route ${route.provider} cannot be used when real model runtime is enabled`
        );
      }
      return createMockModelResponse(request, route);
    }

    if (route.api === "openai-completions") {
      throwModelProviderProtocolNotImplemented(route.api);
    }

    const provider = await this.providers.getProvider(route.provider);
    if (!provider) {
      throw new ModelProviderConfigurationError(
        "model_provider_config_missing",
        `Model provider config not found for ${route.provider}`
      );
    }
    if (!provider.enabled) {
      throw new ModelProviderConfigurationError(
        "model_provider_disabled",
        `Model provider ${route.provider} is disabled`
      );
    }

    if (route.api && provider.config.api && route.api !== provider.config.api) {
      throw new ModelProviderConfigurationError(
        "model_provider_protocol_mismatch",
        `Model route protocol ${route.api} does not match provider ${route.provider} protocol ${provider.config.api}`
      );
    }

    const api = route.api ?? provider.config.api;
    const resolvedRoute: ModelRoute = {
      ...route,
      ...(provider.name && !route.providerName ? { providerName: provider.name } : {}),
      api,
      baseUrlConfigured: isNonEmptyString(provider.config.baseUrl),
      apiKeyEnvConfigured:
        isNonEmptyString(provider.config.apiKeyEnv) ||
        isNonEmptyString(provider.config.secretEnvName)
    };

    if (api === "anthropic-messages") {
      return completeAnthropicMessages({
        request,
        route: resolvedRoute,
        providerConfig: provider.config,
        fetch: this.fetch,
        env: this.env,
        timeoutMs: this.timeoutMs,
        anthropicVersion: this.anthropicVersion,
        maxTokens: this.maxTokens
      });
    }

    if (api === "openai-completions") {
      throwModelProviderProtocolNotImplemented(api);
    }

    return createMockModelResponse(request, resolvedRoute);
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

function createMockModelResponse(request: ModelRequest, route: ModelRoute): ModelResponse {
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

function isMockRoute(route: ModelRoute): boolean {
  return route.api === "mock" || (!route.api && route.provider.startsWith("mock-"));
}

function throwModelProviderProtocolNotImplemented(api: ModelProviderApi): never {
  throw new ModelProviderConfigurationError(
    "model_provider_protocol_not_implemented",
    `Model provider protocol ${api} is not implemented yet`
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
