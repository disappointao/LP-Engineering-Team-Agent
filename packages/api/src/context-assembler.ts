import { z } from "zod";
import type { WorkbenchRepositories } from "@lp-agent/db";
import { LPBriefSchema } from "@lp-agent/lp-schema";
import { agentRoles, type AgentRole } from "@lp-agent/model-gateway";
import type {
  RuntimeRunContext,
  RuntimeRunInput
} from "@lp-agent/runtime-adapters";
import {
  RuntimeHandoffSummarySchema,
  assembleRuntimeHandoffs
} from "./agent-handoffs";
import { ContextMemorySchema, assembleContextMemory } from "./context-memory";
import type { DemoWorkbenchService } from "./index";

export const RuntimeSkillContextSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  scope: z.string().min(1),
  permissions: z.array(z.string().min(1)),
  entrypoints: z.array(z.string().min(1)),
  content: z.string(),
  contentType: z.enum(["text/markdown", "text/plain"])
});

export const RuntimeMCPToolContextSchema = z.object({
  connectorId: z.string().min(1),
  name: z.string().min(1),
  permission: z.string().min(1),
  requiresApproval: z.boolean()
});

const RuntimeApprovalContextSchema = z.object({
  state: z.enum(["not_required", "pending", "approved"]),
  approvedByUserId: z.string().min(1).optional()
});

const RuntimeArtifactWorkspaceSchema = z.object({
  mode: z.enum(["memory", "filesystem"]),
  basePath: z.string().min(1).optional(),
  writableFiles: z.array(z.string().min(1))
});

const ModelProviderApiSchema = z.enum(["mock", "openai-completions", "anthropic-messages"]);

const ModelRouteSchema = z.object({
  provider: z.string().min(1),
  providerName: z.string().min(1).optional(),
  api: ModelProviderApiSchema.optional(),
  model: z.string().min(1),
  baseUrlConfigured: z.boolean().optional(),
  apiKeyEnvConfigured: z.boolean().optional(),
  modelCapabilities: z
    .object({
      name: z.string().min(1).optional(),
      contextWindow: z.number().int().positive().optional(),
      maxTokens: z.number().int().positive().optional(),
      supportsTools: z.boolean().optional(),
      supportsStreaming: z.boolean().optional(),
      supportsImages: z.boolean().optional()
    })
    .optional()
});

const ModelRoutingPolicySchema = z.object({
  planner: ModelRouteSchema,
  builder: ModelRouteSchema,
  reviewer: ModelRouteSchema,
  deployer: ModelRouteSchema
});

export const RuntimeRunContextSchema: z.ZodType<RuntimeRunContext> = z.object({
  skills: z.array(RuntimeSkillContextSchema),
  mcpTools: z.array(RuntimeMCPToolContextSchema),
  approval: RuntimeApprovalContextSchema,
  artifactWorkspace: RuntimeArtifactWorkspaceSchema,
  memory: ContextMemorySchema.optional(),
  handoffs: z.array(RuntimeHandoffSummarySchema).optional(),
  modelRoutingPolicy: ModelRoutingPolicySchema.optional()
});

export const RuntimeRunInputSchema: z.ZodType<RuntimeRunInput, z.ZodTypeDef, unknown> = z.object({
  prompt: z.string().optional(),
  brief: LPBriefSchema.optional()
});

export const ContextPackSchema = z.object({
  projectId: z.string().min(1),
  taskId: z.string().optional(),
  role: z.enum(agentRoles),
  input: RuntimeRunInputSchema,
  runtimeContext: RuntimeRunContextSchema,
  trace: z.object({
    injected: z.array(z.string().min(1)),
    omitted: z.array(z.string().min(1))
  }),
  createdAt: z.string().datetime()
});

export type ContextPack = z.infer<typeof ContextPackSchema>;
export type ContextAssemblyTrace = ContextPack["trace"];

export interface AssembleContextPackInput {
  repositories: WorkbenchRepositories;
  service: Pick<DemoWorkbenchService, "createRuntimeContextForRole">;
  projectId: string;
  taskId?: string;
  role: AgentRole;
  input: RuntimeRunInput;
  now?: () => Date;
}

export async function assembleContextPack(input: AssembleContextPackInput): Promise<ContextPack> {
  const createdAt = (input.now ?? (() => new Date()))().toISOString();
  const runtimeContext = await input.service.createRuntimeContextForRole({
    projectId: input.projectId,
    role: input.role
  });
  const memory = await assembleContextMemory({
    repositories: input.repositories,
    projectId: input.projectId,
    taskId: input.taskId,
    role: input.role,
    input: input.input
  });
  const handoffContext = await assembleRuntimeHandoffsSafely({
    repositories: input.repositories,
    projectId: input.projectId,
    taskId: input.taskId,
    role: input.role
  });
  const runtimeContextWithMemory = {
    ...runtimeContext,
    memory,
    handoffs: handoffContext.handoffs
  };
  const contextPack: ContextPack = {
    projectId: input.projectId,
    taskId: input.taskId,
    role: input.role,
    input: cloneRuntimeInput(input.input),
    runtimeContext: runtimeContextWithMemory,
    trace: {
      injected: [
        `skills:${runtimeContext.skills.length}`,
        `mcpTools:${runtimeContext.mcpTools.length}`,
        runtimeContext.modelRoutingPolicy ? "modelRoutingPolicy:1" : "modelRoutingPolicy:0",
        runtimeContext.modelRoutingPolicy
          ? `modelProvider:${input.role}:${runtimeContext.modelRoutingPolicy[input.role].api ?? "legacy"}`
          : "modelProvider:0",
        `artifactWorkspace:${runtimeContext.artifactWorkspace.mode}`,
        `memory:messages:${memory.messages.length}`,
        `memory:runs:${memory.runs.length}`,
        `memory:tools:${memory.tools.length}`,
        `memory:artifacts:${memory.artifacts.length}`,
        `memory:strategy:${memory.retrieval.strategy}`,
        ...handoffContext.trace.injected
      ],
      omitted: [...memory.retrieval.omitted, ...handoffContext.trace.omitted]
    },
    createdAt
  };

  return ContextPackSchema.parse(contextPack);
}

function cloneRuntimeInput(input: RuntimeRunInput): RuntimeRunInput {
  return {
    ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
    ...(input.brief !== undefined ? { brief: structuredClone(input.brief) } : {})
  };
}

async function assembleRuntimeHandoffsSafely(input: {
  repositories: WorkbenchRepositories;
  projectId: string;
  taskId?: string;
  role: AgentRole;
}): Promise<Awaited<ReturnType<typeof assembleRuntimeHandoffs>>> {
  try {
    return await assembleRuntimeHandoffs(input);
  } catch {
    return {
      handoffs: [],
      trace: {
        injected: [],
        omitted: ["handoffs:error"]
      }
    };
  }
}
