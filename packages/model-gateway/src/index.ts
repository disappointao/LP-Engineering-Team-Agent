import {
  ModelProviderConfigurationError,
  completeAnthropicMessages,
  type ModelFetch
} from "./anthropic-messages";
import { completeOpenAIChatCompletions } from "./openai-completions";

export type AgentRole = "assistant" | "planner" | "builder" | "reviewer" | "deployer";

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
export {
  completeOpenAIChatCompletions,
  toOpenAIChatCompletionsUrl,
  type OpenAIChatCompletionsCompleteInput
} from "./openai-completions";

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
  fallback?: ModelFallbackRouteMetadata;
}

export interface ModelFallbackRouteMetadata {
  provider: string;
  providerName?: string;
  api?: ModelProviderApi;
  model: string;
  baseUrlConfigured: boolean;
  apiKeyEnvConfigured: boolean;
}

export type ModelRoutingPolicy = Record<AgentRole, ModelRoute>;

export type ModelApprovalState = "not_required" | "pending" | "approved";
export type ArtifactWorkspaceMode = "memory" | "filesystem";
export type ModelArtifactWorkspaceFilePath = "index.html" | "styles.css" | "script.js";
export type ModelArtifactWorkspaceFileKind = "html" | "css" | "js";
export type ModelArtifactWorkspaceMimeType = "text/html" | "text/css" | "text/javascript";

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
  workspaceId?: string;
  basePath?: string;
  writableFiles: string[];
  files?: ModelArtifactWorkspaceFile[];
}

export interface ModelArtifactWorkspaceFile {
  path: ModelArtifactWorkspaceFilePath;
  kind: ModelArtifactWorkspaceFileKind;
  mimeType: ModelArtifactWorkspaceMimeType;
  sizeBytes: number;
  sha256: string;
  summary: string;
}

export interface ModelContextMemoryMessage {
  id: string;
  taskId: string;
  role: string;
  preview: string;
  createdAt: string;
  score: number;
}

export interface ModelContextMemoryRun {
  id: string;
  taskId?: string;
  role: string;
  state: string;
  eventTypes: string[];
  startedAt: string;
  completedAt?: string;
  score: number;
}

export interface ModelContextMemoryTool {
  id: string;
  runId: string;
  taskId?: string;
  toolName: string;
  state: string;
  outputSummary: string;
  exitCode?: number;
  errorName?: string;
  createdAt: string;
  completedAt?: string;
  score: number;
}

export interface ModelContextMemoryArtifactFile {
  name: string;
  path?: ModelArtifactWorkspaceFilePath;
  characterCount: number;
  sizeBytes?: number;
  sha256?: string;
  summary?: string;
}

export interface ModelContextMemoryArtifact {
  pageVersionId: string;
  briefId: string;
  artifactWorkspaceId?: string;
  title?: string;
  objective?: string;
  files: ModelContextMemoryArtifactFile[];
  createdAt: string;
  score: number;
}

export interface ModelContextMemoryRetrieval {
  query: string;
  strategy: string;
  selected: string[];
  omitted: string[];
}

export interface ModelContextMemory {
  messages: ModelContextMemoryMessage[];
  runs: ModelContextMemoryRun[];
  tools: ModelContextMemoryTool[];
  artifacts: ModelContextMemoryArtifact[];
  retrieval: ModelContextMemoryRetrieval;
}

export interface ModelAgentHandoffArtifactRefs {
  briefId?: string;
  pageVersionId?: string;
}

export interface ModelAgentHandoffSummary {
  id: string;
  fromRunId: string;
  fromRole: AgentRole;
  toRole: AgentRole;
  state: "ready" | "blocked" | "consumed";
  summary: string;
  blockingReason?: string;
  artifactRefs?: ModelAgentHandoffArtifactRefs;
  updatedAt: string;
}

export interface ModelRequestContext {
  skills: ModelSkillContext[];
  mcpTools: ModelMCPToolContext[];
  approval: ModelApprovalContext;
  artifactWorkspace: ModelArtifactWorkspaceContext;
  memory?: ModelContextMemory;
  handoffs?: ModelAgentHandoffSummary[];
}

export interface ModelRequest {
  role: AgentRole;
  prompt: string;
  projectId: string;
  context?: ModelRequestContext;
  routingPolicy?: ModelRoutingPolicy;
}

export type ModelUsageSource = "provider_reported" | "estimated";

export interface ModelUsageMetadata {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  source: ModelUsageSource;
}

export interface ModelCallMetadata {
  attempt: number;
  durationMs: number;
  supportsStreaming: boolean;
  streamingEnabled: boolean;
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
  usage: ModelUsageMetadata;
  call: ModelCallMetadata;
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
  "assistant",
  "planner",
  "builder",
  "reviewer",
  "deployer"
] as const) satisfies readonly AgentRole[];

export const createDefaultModelPolicy = (): ModelRoutingPolicy => ({
  assistant: { provider: "mock-openai", model: "assistant-model" },
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
    if (api === "mock" && !this.allowMockRoutes) {
      throw new ModelProviderConfigurationError(
        "model_provider_mock_route_disabled",
        `Mock model route ${route.provider} cannot be used when real model runtime is enabled`
      );
    }

    const providerModelCapabilities = route.modelCapabilities
      ? undefined
      : toRouteModelCapabilities(provider.config.models, route.model);
    const resolvedRoute: ModelRoute = {
      ...route,
      ...(provider.name && !route.providerName ? { providerName: provider.name } : {}),
      api,
      baseUrlConfigured: isNonEmptyString(provider.config.baseUrl),
      apiKeyEnvConfigured:
        isNonEmptyString(provider.config.apiKeyEnv) ||
        isNonEmptyString(provider.config.secretEnvName),
      ...(route.modelCapabilities
        ? { modelCapabilities: cloneModelCapabilities(route.modelCapabilities) }
        : providerModelCapabilities
          ? { modelCapabilities: providerModelCapabilities }
          : {})
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
      return completeOpenAIChatCompletions({
        request,
        route: resolvedRoute,
        providerConfig: provider.config,
        fetch: this.fetch,
        env: this.env,
        timeoutMs: this.timeoutMs,
        maxTokens: this.maxTokens
      });
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
  const inputTokens = Math.ceil(request.prompt.length / 4);
  const outputTokens = 32;
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
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      source: "estimated"
    },
    call: {
      attempt: 1,
      durationMs: 0,
      supportsStreaming: route.modelCapabilities?.supportsStreaming === true,
      streamingEnabled: false
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
    artifactWorkspace: cloneModelArtifactWorkspace(context.artifactWorkspace),
    ...(context.memory ? { memory: cloneModelContextMemory(context.memory) } : {}),
    ...(context.handoffs ? { handoffs: cloneModelAgentHandoffs(context.handoffs) } : {})
  };
}

function cloneModelArtifactWorkspace(
  workspace: ModelArtifactWorkspaceContext
): ModelArtifactWorkspaceContext {
  return {
    mode: workspace.mode,
    ...(workspace.workspaceId ? { workspaceId: workspace.workspaceId } : {}),
    ...(workspace.basePath ? { basePath: workspace.basePath } : {}),
    writableFiles: [...workspace.writableFiles],
    ...(workspace.files ? { files: workspace.files.map(cloneModelArtifactWorkspaceFile) } : {})
  };
}

function cloneModelArtifactWorkspaceFile(
  file: ModelArtifactWorkspaceFile
): ModelArtifactWorkspaceFile {
  return {
    path: file.path,
    kind: file.kind,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    summary: file.summary
  };
}

function cloneModelAgentHandoffs(
  handoffs: ModelAgentHandoffSummary[]
): ModelAgentHandoffSummary[] {
  return handoffs.map((handoff) => ({
    ...handoff,
    ...(handoff.artifactRefs ? { artifactRefs: { ...handoff.artifactRefs } } : {})
  }));
}

function cloneModelContextMemory(memory: ModelContextMemory): ModelContextMemory {
  return {
    messages: memory.messages.map((message) => ({ ...message })),
    runs: memory.runs.map((run) => ({
      ...run,
      eventTypes: [...run.eventTypes]
    })),
    tools: memory.tools.map((tool) => ({ ...tool })),
    artifacts: memory.artifacts.map((artifact) => ({
      ...artifact,
      files: artifact.files.map(cloneModelContextMemoryArtifactFile)
    })),
    retrieval: {
      ...memory.retrieval,
      selected: [...memory.retrieval.selected],
      omitted: [...memory.retrieval.omitted]
    }
  };
}

function cloneModelContextMemoryArtifactFile(
  file: ModelContextMemoryArtifactFile
): ModelContextMemoryArtifactFile {
  return {
    name: file.name,
    ...(file.path ? { path: file.path } : {}),
    characterCount: file.characterCount,
    ...(file.sizeBytes !== undefined ? { sizeBytes: file.sizeBytes } : {}),
    ...(file.sha256 ? { sha256: file.sha256 } : {}),
    ...(file.summary ? { summary: file.summary } : {})
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
      : {}),
    ...(route.fallback ? { fallback: { ...route.fallback } } : {})
  };
}

function cloneModelCapabilities(
  capabilities: NonNullable<ModelRoute["modelCapabilities"]>
): NonNullable<ModelRoute["modelCapabilities"]> {
  return { ...capabilities };
}

function toRouteModelCapabilities(
  models: ModelProviderModelConfig[] | undefined,
  modelId: string
): ModelRoute["modelCapabilities"] | undefined {
  const model = models?.find((candidate) => candidate.id === modelId);
  if (!model) {
    return undefined;
  }

  const capabilities: NonNullable<ModelRoute["modelCapabilities"]> = {
    ...(model.name ? { name: model.name } : {}),
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
    ...(model.supportsTools !== undefined ? { supportsTools: model.supportsTools } : {}),
    ...(model.supportsStreaming !== undefined
      ? { supportsStreaming: model.supportsStreaming }
      : {}),
    ...(model.supportsImages !== undefined ? { supportsImages: model.supportsImages } : {})
  };
  return Object.keys(capabilities).length > 0 ? capabilities : undefined;
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
