import {
  generateStaticArtifacts,
  type ArtifactWorkspaceManifestFile,
  type StaticArtifacts
} from "@lp-agent/artifacts";
import type { LPBrief, ReviewFinding, RunState } from "@lp-agent/lp-schema";
import {
  InMemoryModelGateway,
  ModelProviderConfigurationError,
  ModelProviderRequestError,
  ModelProviderResponseError,
  createDefaultModelPolicy,
  type AgentRole,
  type ModelAgentHandoffSummary,
  type ModelFallbackRouteMetadata,
  type ModelGateway,
  type ModelContextMemory,
  type ModelContextMemoryArtifactFile,
  type ModelRequest,
  type ModelRequestContext,
  type ModelRoutingPolicy,
  type ModelResponse
} from "@lp-agent/model-gateway";

export interface RuntimeRunInput {
  prompt?: string;
  brief?: LPBrief;
}

export type RuntimeApprovalState = "not_required" | "pending" | "approved";
export type RuntimeArtifactWorkspaceMode = "memory" | "filesystem";

export interface RuntimeSkillContext {
  id: string;
  name: string;
  version: string;
  scope: string;
  permissions: string[];
  entrypoints: string[];
  content: string;
  contentType: "text/markdown" | "text/plain";
}

export interface RuntimeMCPToolContext {
  connectorId: string;
  name: string;
  permission: string;
  requiresApproval: boolean;
  readOnly?: boolean;
  sideEffect?: "read" | "write";
}

export interface RuntimeApprovalContext {
  state: RuntimeApprovalState;
  approvedByUserId?: string;
}

export interface RuntimeArtifactWorkspace {
  mode: RuntimeArtifactWorkspaceMode;
  workspaceId?: string;
  basePath?: string;
  writableFiles: string[];
  files?: ArtifactWorkspaceManifestFile[];
}

export interface RuntimeAgentHandoffArtifactRefs {
  briefId?: string;
  pageVersionId?: string;
}

export interface RuntimeAgentHandoffSummary
  extends Omit<ModelAgentHandoffSummary, "artifactRefs"> {
  artifactRefs?: RuntimeAgentHandoffArtifactRefs;
}

export interface RuntimeRunContext {
  skills: RuntimeSkillContext[];
  mcpTools: RuntimeMCPToolContext[];
  approval: RuntimeApprovalContext;
  artifactWorkspace: RuntimeArtifactWorkspace;
  memory?: ModelContextMemory;
  handoffs?: RuntimeAgentHandoffSummary[];
  modelRoutingPolicy?: ModelRoutingPolicy;
}

export interface RuntimeRunRequest {
  runId: string;
  projectId: string;
  role: AgentRole;
  input: RuntimeRunInput;
  context?: RuntimeRunContext;
}

export type RuntimeEvent =
  | {
      type: "run.started";
      message: string;
      runId?: string;
      role?: AgentRole;
    }
  | {
      type: "model.completed";
      message: string;
      runId?: string;
      role?: AgentRole;
      provider: string;
      providerName?: string;
      api?: ModelResponse["api"];
      model: string;
      baseUrlConfigured?: boolean;
      apiKeyEnvConfigured?: boolean;
      modelCapabilities?: ModelResponse["modelCapabilities"];
      usage: ModelResponse["usage"];
    }
  | {
      type: "model.retry.scheduled";
      message: string;
      runId?: string;
      role?: AgentRole;
      attempt: number;
      maxAttempts: number;
      errorCode: string;
      retryable: boolean;
      status?: number;
    }
  | {
      type: "model.retry.exhausted";
      message: string;
      runId?: string;
      role?: AgentRole;
      attempts: number;
      errorCode: string;
      status?: number;
    }
  | {
      type: "model.fallback.available";
      message: string;
      runId?: string;
      role?: AgentRole;
      provider: string;
      providerName?: string;
      api?: ModelResponse["api"];
      model: string;
      baseUrlConfigured: boolean;
      apiKeyEnvConfigured: boolean;
    }
  | {
      type: "model.fallback.not_configured";
      message: string;
      runId?: string;
      role?: AgentRole;
    }
  | {
      type: "model.output.parsed";
      message: string;
      runId?: string;
      role?: AgentRole;
      schema: "LPBriefSchema";
      title: string;
      sectionCount: number;
      productCount: number;
      hasAssets: boolean;
    }
  | {
      type: "model.output.parsed";
      message: string;
      runId?: string;
      role?: AgentRole;
      schema: "StaticArtifactsSchema";
      artifactKind: "three-file-static";
      htmlBytes: number;
      cssBytes: number;
      jsBytes: number;
      hasExternalCss: boolean;
      hasExternalImages: boolean;
    }
  | {
      type: "model.output.parse_failed";
      message: string;
      runId?: string;
      role?: AgentRole;
      schema: "LPBriefSchema" | "StaticArtifactsSchema";
      reason: "empty_output" | "invalid_json" | "schema_invalid" | "policy_violation";
      policyCode?: string;
      issueCount?: number;
      firstIssuePath?: string;
      firstIssueCode?: string;
    }
  | {
      type: "runtime.context.loaded";
      message: string;
      runId?: string;
      role?: AgentRole;
      skillCount: number;
      toolCount: number;
      approvalState: RuntimeApprovalState;
    }
  | {
      type: "artifact.created";
      message: string;
      runId?: string;
      artifactId: string;
    }
  | {
      type: "review.completed";
      message: string;
      runId?: string;
    }
  | {
      type: "run.completed";
      message: string;
      runId?: string;
      state: "completed";
    }
  | {
      type: "run.failed";
      message: string;
      runId?: string;
      role?: AgentRole;
      state: "failed";
      errorName?: string;
      errorCode?: string;
    };

export interface RuntimeRunResult {
  runId: string;
  state: RunState;
  events: RuntimeEvent[];
  artifacts?: StaticArtifacts;
  findings?: ReviewFinding[];
  projectId?: string;
  role?: AgentRole;
  modelOutputText?: string;
}

export interface AgentRuntimeAdapter {
  run(request: RuntimeRunRequest): Promise<RuntimeRunResult>;
}

export class LocalAgentRuntimeAdapter implements AgentRuntimeAdapter {
  private readonly modelGateway: ModelGateway;

  constructor(modelGateway: ModelGateway = new InMemoryModelGateway(createDefaultModelPolicy())) {
    this.modelGateway = modelGateway;
  }

  async run(request: RuntimeRunRequest): Promise<RuntimeRunResult> {
    const context = request.context
      ? cloneRuntimeContext(request.context)
      : createDefaultRuntimeContext();
    const events: RuntimeEvent[] = [
      {
        type: "run.started",
        message: `${request.role} run started`,
        runId: request.runId,
        role: request.role
      }
    ];
    if (request.context) {
      events.push(toRuntimeContextLoadedEvent(request, context));
    }
    try {
      const modelRequest: ModelRequest = {
        role: request.role,
        projectId: request.projectId,
        prompt: toModelPrompt(request),
        context: toModelRequestContext(context),
        ...(context.modelRoutingPolicy ? { routingPolicy: context.modelRoutingPolicy } : {})
      };
      const modelResponse = await completeModelWithRetry({
        gateway: this.modelGateway,
        request: modelRequest,
        runRequest: request,
        events
      });
      events.push(toModelCompletedEvent(request, modelResponse));

      const artifacts = request.role === "builder" && request.input.brief
        ? generateStaticArtifacts(request.input.brief)
        : undefined;
      if (artifacts) {
        events.push({
          type: "artifact.created",
          message: "Static LP artifacts created",
          runId: request.runId,
          artifactId: `artifact_${request.runId}`
        });
      }

      const findings = request.role === "reviewer" && request.input.brief
        ? reviewHeroCta(request.input.brief)
        : undefined;
      if (findings) {
        events.push({
          type: "review.completed",
          message: "Reviewer checks completed",
          runId: request.runId
        });
      }

      const state = "completed";
      events.push({
        type: "run.completed",
        message: `${request.role} run completed`,
        runId: request.runId,
        state
      });

      return {
        runId: request.runId,
        projectId: request.projectId,
        role: request.role,
        state,
        events,
        artifacts,
        findings,
        modelOutputText: modelResponse.text
      };
    } catch (error) {
      if (isModelProviderError(error)) {
        const fallback = context.modelRoutingPolicy?.[request.role]?.fallback;
        events.push(
          fallback
            ? toFallbackAvailableEvent(request, fallback)
            : {
                type: "model.fallback.not_configured",
                message: `${request.role} model fallback not configured`,
                runId: request.runId,
                role: request.role
              }
        );
      }
      events.push(toRunFailedEvent(request, error));
      return {
        runId: request.runId,
        projectId: request.projectId,
        role: request.role,
        state: "failed",
        events
      };
    }
  }
}

export type AgentRunInput = RuntimeRunInput;
export type AgentRunRequest = RuntimeRunRequest;
export type AgentRunEvent = RuntimeEvent;
export type AgentRunResult = RuntimeRunResult;

export function createDefaultRuntimeContext(): RuntimeRunContext {
  return {
    skills: [],
    mcpTools: [],
    approval: {
      state: "not_required"
    },
    artifactWorkspace: {
      mode: "memory",
      writableFiles: ["index.html", "styles.css", "script.js"]
    }
  };
}

function toModelPrompt(request: RuntimeRunRequest): string {
  const prompt = request.input.prompt?.trim();
  if (prompt) {
    return prompt;
  }

  return request.input.brief
    ? JSON.stringify(request.input.brief)
    : `${request.role} run`;
}

function toModelCompletedEvent(request: RuntimeRunRequest, response: ModelResponse): RuntimeEvent {
  return {
    type: "model.completed",
    message: `${request.role} model call completed`,
    runId: request.runId,
    role: request.role,
    provider: response.provider,
    ...(response.providerName ? { providerName: response.providerName } : {}),
    ...(response.api ? { api: response.api } : {}),
    model: response.model,
    ...(response.baseUrlConfigured !== undefined
      ? { baseUrlConfigured: response.baseUrlConfigured }
      : {}),
    ...(response.apiKeyEnvConfigured !== undefined
      ? { apiKeyEnvConfigured: response.apiKeyEnvConfigured }
      : {}),
    ...(response.modelCapabilities
      ? { modelCapabilities: { ...response.modelCapabilities } }
      : {}),
    usage: { ...response.usage }
  };
}

const maxModelProviderAttempts = 2;

async function completeModelWithRetry(input: {
  gateway: ModelGateway;
  request: ModelRequest;
  runRequest: RuntimeRunRequest;
  events: RuntimeEvent[];
}): Promise<ModelResponse> {
  let attempt = 1;
  while (true) {
    try {
      return await input.gateway.complete(input.request);
    } catch (error) {
      const summary = summarizeProviderError(error);
      if (!summary.retryable || attempt >= maxModelProviderAttempts) {
        if (summary.retryable) {
          input.events.push({
            type: "model.retry.exhausted",
            message: `${input.runRequest.role} model retry exhausted`,
            runId: input.runRequest.runId,
            role: input.runRequest.role,
            attempts: attempt,
            errorCode: summary.errorCode,
            ...(summary.status !== undefined ? { status: summary.status } : {})
          });
        }
        throw error;
      }
      input.events.push({
        type: "model.retry.scheduled",
        message: `${input.runRequest.role} model retry scheduled`,
        runId: input.runRequest.runId,
        role: input.runRequest.role,
        attempt,
        maxAttempts: maxModelProviderAttempts,
        errorCode: summary.errorCode,
        retryable: true,
        ...(summary.status !== undefined ? { status: summary.status } : {})
      });
      attempt += 1;
    }
  }
}

function summarizeProviderError(error: unknown): {
  errorCode: string;
  retryable: boolean;
  status?: number;
} {
  if (error instanceof ModelProviderRequestError) {
    const retryable =
      error.code === "model_provider_request_timeout" ||
      error.code === "model_provider_request_failed" ||
      (error.code === "model_provider_http_error" &&
        (error.status === 429 || (error.status !== undefined && error.status >= 500)));
    return {
      errorCode: error.code,
      retryable,
      ...(error.status !== undefined ? { status: error.status } : {})
    };
  }
  if (error instanceof ModelProviderResponseError) {
    return {
      errorCode: error.code,
      retryable: error.code === "model_provider_response_json_invalid"
    };
  }
  if (error instanceof ModelProviderConfigurationError) {
    return { errorCode: error.code, retryable: false };
  }
  return { errorCode: "model_provider_unknown_error", retryable: false };
}

function toFallbackAvailableEvent(
  request: RuntimeRunRequest,
  fallback: ModelFallbackRouteMetadata
): RuntimeEvent {
  return {
    type: "model.fallback.available",
    message: `${request.role} model fallback available`,
    runId: request.runId,
    role: request.role,
    provider: fallback.provider,
    ...(fallback.providerName ? { providerName: fallback.providerName } : {}),
    ...(fallback.api ? { api: fallback.api } : {}),
    model: fallback.model,
    baseUrlConfigured: fallback.baseUrlConfigured,
    apiKeyEnvConfigured: fallback.apiKeyEnvConfigured
  };
}

function toRuntimeContextLoadedEvent(
  request: RuntimeRunRequest,
  context: RuntimeRunContext
): RuntimeEvent {
  return {
    type: "runtime.context.loaded",
    message: "Runtime capability context loaded",
    runId: request.runId,
    role: request.role,
    skillCount: context.skills.length,
    toolCount: context.mcpTools.length,
    approvalState: context.approval.state
  };
}

function toModelRequestContext(context: RuntimeRunContext): ModelRequestContext {
  return {
    skills: context.skills.map((skill) => ({
      ...skill,
      permissions: [...skill.permissions],
      entrypoints: [...skill.entrypoints]
    })),
    mcpTools: context.mcpTools.map((tool) => ({ ...tool })),
    approval: { ...context.approval },
    artifactWorkspace: cloneArtifactWorkspace(context.artifactWorkspace),
    ...(context.memory ? { memory: cloneRuntimeMemory(context.memory) } : {}),
    ...(context.handoffs ? { handoffs: cloneRuntimeHandoffs(context.handoffs) } : {})
  };
}

function toRunFailedEvent(request: RuntimeRunRequest, error: unknown): RuntimeEvent {
  const providerSummary = summarizeProviderError(error);
  const isProviderError = isModelProviderError(error);
  return {
    type: "run.failed",
    message: isProviderError
      ? `${request.role} model provider failed`
      : error instanceof Error
        ? error.message
        : "Runtime run failed.",
    runId: request.runId,
    role: request.role,
    state: "failed",
    errorName: error instanceof Error ? error.name : undefined,
    ...(isProviderError ? { errorCode: providerSummary.errorCode } : {})
  };
}

function isModelProviderError(error: unknown): boolean {
  return (
    error instanceof ModelProviderConfigurationError ||
    error instanceof ModelProviderRequestError ||
    error instanceof ModelProviderResponseError
  );
}

function reviewHeroCta(brief: LPBrief): ReviewFinding[] {
  return brief.sections
    .filter((section) => section.type === "hero" && !section.cta)
    .map((section): ReviewFinding => ({
      severity: "blocking",
      target: `section:${section.id}`,
      explanation: "Hero section is missing a CTA.",
      suggestedFix: "Add a primary CTA to the hero section.",
      blocksDeployment: true
    }));
}

function cloneRuntimeContext(context: RuntimeRunContext): RuntimeRunContext {
  return {
    skills: context.skills.map((skill) => ({
      ...skill,
      permissions: [...skill.permissions],
      entrypoints: [...skill.entrypoints]
    })),
    mcpTools: context.mcpTools.map((tool) => ({ ...tool })),
    approval: { ...context.approval },
    artifactWorkspace: cloneArtifactWorkspace(context.artifactWorkspace),
    ...(context.memory ? { memory: cloneRuntimeMemory(context.memory) } : {}),
    ...(context.handoffs ? { handoffs: cloneRuntimeHandoffs(context.handoffs) } : {}),
    ...(context.modelRoutingPolicy
      ? { modelRoutingPolicy: cloneModelRoutingPolicy(context.modelRoutingPolicy) }
      : {})
  };
}

function cloneArtifactWorkspace(
  workspace: RuntimeArtifactWorkspace
): RuntimeArtifactWorkspace {
  return {
    mode: workspace.mode,
    ...(workspace.workspaceId ? { workspaceId: workspace.workspaceId } : {}),
    ...(workspace.basePath ? { basePath: workspace.basePath } : {}),
    writableFiles: [...workspace.writableFiles],
    ...(workspace.files ? { files: workspace.files.map(cloneArtifactWorkspaceFile) } : {})
  };
}

function cloneArtifactWorkspaceFile(
  file: ArtifactWorkspaceManifestFile
): ArtifactWorkspaceManifestFile {
  return {
    path: file.path,
    kind: file.kind,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    summary: file.summary
  };
}

function cloneRuntimeHandoffs(
  handoffs: RuntimeAgentHandoffSummary[]
): RuntimeAgentHandoffSummary[] {
  return handoffs.map((handoff) => ({
    ...handoff,
    ...(handoff.artifactRefs ? { artifactRefs: { ...handoff.artifactRefs } } : {})
  }));
}

function cloneRuntimeMemory(memory: ModelContextMemory): ModelContextMemory {
  return {
    messages: memory.messages.map((message) => ({ ...message })),
    runs: memory.runs.map((run) => ({
      ...run,
      eventTypes: [...run.eventTypes]
    })),
    tools: memory.tools.map((tool) => ({ ...tool })),
    artifacts: memory.artifacts.map((artifact) => ({
      ...artifact,
      files: artifact.files.map(cloneRuntimeMemoryArtifactFile)
    })),
    retrieval: {
      ...memory.retrieval,
      selected: [...memory.retrieval.selected],
      omitted: [...memory.retrieval.omitted]
    }
  };
}

function cloneRuntimeMemoryArtifactFile(
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

function cloneModelRoutingPolicy(policy: ModelRoutingPolicy): ModelRoutingPolicy {
  return {
    planner: { ...policy.planner },
    builder: { ...policy.builder },
    reviewer: { ...policy.reviewer },
    deployer: { ...policy.deployer }
  };
}
