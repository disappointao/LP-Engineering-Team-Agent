import { z } from "zod";
import {
  ARTIFACT_WORKSPACE_DEFAULT_READ_MAX_BYTES,
  type ArtifactWorkspaceFilePath
} from "@lp-agent/artifacts";
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
import {
  ArtifactReaderError,
  readRepositoryArtifactWorkspaceFile
} from "./artifact-reader";
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

const ArtifactWorkspaceFilePathSchema = z.enum(["index.html", "styles.css", "script.js"]);
const ArtifactWorkspaceFileKindSchema = z.enum(["html", "css", "js"]);
const ArtifactWorkspaceMimeTypeSchema = z.enum([
  "text/html",
  "text/css",
  "text/javascript"
]);
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

const RuntimeArtifactWorkspaceFileSchema = z.object({
  path: ArtifactWorkspaceFilePathSchema,
  kind: ArtifactWorkspaceFileKindSchema,
  mimeType: ArtifactWorkspaceMimeTypeSchema,
  sizeBytes: z.number().int().min(0),
  sha256: z.string().regex(SHA256_HEX_PATTERN),
  summary: z.string().min(1)
});

const RuntimeArtifactWorkspaceSchema = z.object({
  mode: z.enum(["memory", "filesystem"]),
  workspaceId: z.string().min(1).optional(),
  basePath: z.string().min(1).optional(),
  writableFiles: z.array(z.string().min(1)),
  files: z.array(RuntimeArtifactWorkspaceFileSchema).optional()
});

const ArtifactSnippetSchema = z.object({
  workspaceId: z.string().min(1),
  pageVersionId: z.string().min(1).optional(),
  path: ArtifactWorkspaceFilePathSchema,
  sizeBytes: z.number().int().min(0),
  sha256: z.string().regex(SHA256_HEX_PATTERN),
  content: z.string(),
  truncated: z.literal(false)
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
  artifactSnippets: z.array(ArtifactSnippetSchema).default([]),
  trace: z.object({
    injected: z.array(z.string().min(1)),
    omitted: z.array(z.string().min(1))
  }),
  createdAt: z.string().datetime()
});

export type ContextPack = z.infer<typeof ContextPackSchema>;
export type ContextAssemblyTrace = ContextPack["trace"];

export interface ArtifactSnippetRequest {
  workspaceId: string;
  pageVersionId?: string;
  path: ArtifactWorkspaceFilePath;
  maxBytes?: number;
}

export interface AssembleContextPackInput {
  repositories: WorkbenchRepositories;
  service: Pick<DemoWorkbenchService, "createRuntimeContextForRole">;
  projectId: string;
  taskId?: string;
  pageVersionId?: string;
  role: AgentRole;
  input: RuntimeRunInput;
  artifactSnippetRequests?: ArtifactSnippetRequest[];
  now?: () => Date;
}

export async function assembleContextPack(input: AssembleContextPackInput): Promise<ContextPack> {
  const createdAt = (input.now ?? (() => new Date()))().toISOString();
  const runtimeContext = await input.service.createRuntimeContextForRole({
    projectId: input.projectId,
    pageVersionId: input.pageVersionId,
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
  const artifactSnippetContext = await assembleArtifactSnippetsSafely({
    repositories: input.repositories,
    projectId: input.projectId,
    requests: input.artifactSnippetRequests ?? []
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
    artifactSnippets: artifactSnippetContext.snippets,
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
        `artifactSnippets:${artifactSnippetContext.snippets.length}`,
        ...handoffContext.trace.injected
      ],
      omitted: [
        ...memory.retrieval.omitted,
        ...handoffContext.trace.omitted,
        ...artifactSnippetContext.omitted
      ]
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

async function assembleArtifactSnippetsSafely(input: {
  repositories: WorkbenchRepositories;
  projectId: string;
  requests: ArtifactSnippetRequest[];
}): Promise<{
  snippets: ContextPack["artifactSnippets"];
  omitted: string[];
}> {
  const snippets: ContextPack["artifactSnippets"] = [];
  const omitted: string[] = [];
  const requests = input.requests.slice(0, 3);

  if (input.requests.length > requests.length) {
    omitted.push("artifactSnippet:requests:limit_exceeded");
  }

  for (const request of requests) {
    try {
      const result = await readRepositoryArtifactWorkspaceFile({
        repositories: input.repositories,
        projectId: input.projectId,
        workspaceId: request.workspaceId,
        pageVersionId: request.pageVersionId,
        path: request.path,
        includeContent: true,
        maxBytes: request.maxBytes ?? ARTIFACT_WORKSPACE_DEFAULT_READ_MAX_BYTES
      });

      if (result.content === undefined) {
        omitted.push(
          `artifactSnippet:${request.path}:${result.omittedReason ?? "content_omitted"}`
        );
        continue;
      }

      snippets.push({
        workspaceId: result.workspaceId,
        ...(result.pageVersionId !== undefined ? { pageVersionId: result.pageVersionId } : {}),
        path: result.file.path,
        sizeBytes: result.file.sizeBytes,
        sha256: result.file.sha256,
        content: result.content,
        truncated: false
      });
    } catch (error) {
      omitted.push(
        `artifactSnippet:${request.path}:${
          error instanceof ArtifactReaderError ? error.code : "error"
        }`
      );
    }
  }

  return {
    snippets,
    omitted
  };
}
