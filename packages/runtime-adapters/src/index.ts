import { generateStaticArtifacts, type StaticArtifacts } from "@lp-agent/artifacts";
import type { LPBrief, ReviewFinding, RunState } from "@lp-agent/lp-schema";
import {
  InMemoryModelGateway,
  createDefaultModelPolicy,
  type AgentRole,
  type ModelResponse
} from "@lp-agent/model-gateway";

export interface RuntimeRunInput {
  prompt?: string;
  brief?: LPBrief;
}

export interface RuntimeRunRequest {
  runId: string;
  projectId: string;
  role: AgentRole;
  input: RuntimeRunInput;
}

export interface RuntimeEvent {
  type: "run.started" | "model.completed" | "artifact.created" | "review.completed" | "run.completed";
  message: string;
  runId?: string;
  role?: AgentRole;
  provider?: string;
  model?: string;
  artifactId?: string;
  state?: RunState;
}

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
  private readonly modelGateway: InMemoryModelGateway;

  constructor(modelGateway = new InMemoryModelGateway(createDefaultModelPolicy())) {
    this.modelGateway = modelGateway;
  }

  async run(request: RuntimeRunRequest): Promise<RuntimeRunResult> {
    const events: RuntimeEvent[] = [
      {
        type: "run.started",
        message: `${request.role} run started`,
        runId: request.runId,
        role: request.role
      }
    ];
    const modelResponse = await this.modelGateway.complete({
      role: request.role,
      projectId: request.projectId,
      prompt: toModelPrompt(request)
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

    const state: RunState = "completed";
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
  }
}

export type AgentRunInput = RuntimeRunInput;
export type AgentRunRequest = RuntimeRunRequest;
export type AgentRunEvent = RuntimeEvent;
export type AgentRunResult = RuntimeRunResult;

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

function reviewHeroCta(brief: LPBrief): ReviewFinding[] {
  const hero = brief.sections.find((section) => section.type === "hero");
  if (!hero || hero.cta) {
    return [];
  }

  return [
    {
      severity: "blocking",
      target: `section:${hero.id}`,
      explanation: "Hero section is missing a CTA.",
      suggestedFix: "Add a primary CTA to the hero section.",
      blocksDeployment: true
    }
  ];
}
