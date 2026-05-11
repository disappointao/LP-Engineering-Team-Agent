import { generateStaticArtifacts, type StaticArtifacts } from "@lp-agent/artifacts";
import type { LPBrief, ReviewFinding, RunState } from "@lp-agent/lp-schema";
import {
  InMemoryModelGateway,
  createDefaultModelPolicy,
  type AgentRole,
  type ModelResponse
} from "@lp-agent/model-gateway";

export interface AgentRunInput {
  prompt?: string;
  brief?: LPBrief;
}

export interface AgentRunRequest {
  runId: string;
  projectId: string;
  role: AgentRole;
  input: AgentRunInput;
}

export type AgentRunEvent =
  | {
      type: "run.started";
      runId: string;
      role: AgentRole;
    }
  | {
      type: "model.completed";
      runId: string;
      role: AgentRole;
      provider: string;
      model: string;
    }
  | {
      type: "artifact.created";
      runId: string;
      artifactId: string;
    }
  | {
      type: "run.completed";
      runId: string;
      state: RunState;
    };

export interface AgentRunResult {
  runId: string;
  projectId: string;
  role: AgentRole;
  state: RunState;
  events: AgentRunEvent[];
  artifact?: StaticArtifacts;
  findings: ReviewFinding[];
}

export interface AgentRuntimeAdapter {
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}

export class LocalAgentRuntimeAdapter implements AgentRuntimeAdapter {
  private readonly modelGateway: InMemoryModelGateway;

  constructor(modelGateway = new InMemoryModelGateway(createDefaultModelPolicy())) {
    this.modelGateway = modelGateway;
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const events: AgentRunEvent[] = [{ type: "run.started", runId: request.runId, role: request.role }];
    const modelResponse = await this.modelGateway.complete({
      role: request.role,
      projectId: request.projectId,
      prompt: toModelPrompt(request)
    });
    events.push(toModelCompletedEvent(request, modelResponse));

    const artifact = request.role === "builder" && request.input.brief
      ? generateStaticArtifacts(request.input.brief)
      : undefined;
    if (artifact) {
      events.push({
        type: "artifact.created",
        runId: request.runId,
        artifactId: `artifact_${request.runId}`
      });
    }

    const state: RunState = "completed";
    events.push({ type: "run.completed", runId: request.runId, state });

    return {
      runId: request.runId,
      projectId: request.projectId,
      role: request.role,
      state,
      events,
      artifact,
      findings: request.role === "reviewer" && request.input.brief
        ? reviewHeroCta(request.input.brief)
        : []
    };
  }
}

function toModelPrompt(request: AgentRunRequest): string {
  const prompt = request.input.prompt?.trim();
  if (prompt) {
    return prompt;
  }

  return request.input.brief
    ? `${request.role} run for ${request.input.brief.title}`
    : `${request.role} run`;
}

function toModelCompletedEvent(request: AgentRunRequest, response: ModelResponse): AgentRunEvent {
  return {
    type: "model.completed",
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
