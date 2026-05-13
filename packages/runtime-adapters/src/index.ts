import { generateStaticArtifacts, type StaticArtifacts } from "@lp-agent/artifacts";
import type { LPBrief, ReviewFinding, RunState } from "@lp-agent/lp-schema";
import {
  InMemoryModelGateway,
  createDefaultModelPolicy,
  type AgentRole,
  type ModelGateway,
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
}

export interface RuntimeApprovalContext {
  state: RuntimeApprovalState;
  approvedByUserId?: string;
}

export interface RuntimeArtifactWorkspace {
  mode: RuntimeArtifactWorkspaceMode;
  basePath?: string;
  writableFiles: string[];
}

export interface RuntimeRunContext {
  skills: RuntimeSkillContext[];
  mcpTools: RuntimeMCPToolContext[];
  approval: RuntimeApprovalContext;
  artifactWorkspace: RuntimeArtifactWorkspace;
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
      model: string;
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
    };

export interface RuntimeRunResult {
  runId: string;
  state: RunState;
  events: RuntimeEvent[];
  artifacts?: StaticArtifacts;
  findings?: ReviewFinding[];
  projectId?: string;
  role?: AgentRole;
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
      const modelResponse = await this.modelGateway.complete({
        role: request.role,
        projectId: request.projectId,
        prompt: toModelPrompt(request),
        context: toModelRequestContext(context),
        ...(context.modelRoutingPolicy ? { routingPolicy: context.modelRoutingPolicy } : {})
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
        findings
      };
    } catch (error) {
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
    model: response.model
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
    artifactWorkspace: {
      ...context.artifactWorkspace,
      writableFiles: [...context.artifactWorkspace.writableFiles]
    }
  };
}

function toRunFailedEvent(request: RuntimeRunRequest, error: unknown): RuntimeEvent {
  return {
    type: "run.failed",
    message: error instanceof Error ? error.message : "Runtime run failed.",
    runId: request.runId,
    role: request.role,
    state: "failed",
    errorName: error instanceof Error ? error.name : undefined
  };
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
    artifactWorkspace: {
      ...context.artifactWorkspace,
      writableFiles: [...context.artifactWorkspace.writableFiles]
    },
    ...(context.modelRoutingPolicy
      ? { modelRoutingPolicy: cloneModelRoutingPolicy(context.modelRoutingPolicy) }
      : {})
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
