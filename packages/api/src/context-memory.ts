import { z } from "zod";
import {
  createArtifactWorkspaceManifest,
  type ArtifactWorkspaceFileRecord,
  type ArtifactWorkspaceRecord
} from "@lp-agent/artifacts";
import type {
  BriefRecord,
  PageVersionRecord,
  RunEventRecord,
  RunRecord,
  ToolObservationRecord,
  WorkbenchMessageRecord,
  WorkbenchRepositories
} from "@lp-agent/db";
import { agentRoles, type AgentRole, type ModelContextMemory } from "@lp-agent/model-gateway";
import type { RuntimeRunInput } from "@lp-agent/runtime-adapters";

export const CONTEXT_MEMORY_STRATEGY = "deterministic-keyword-v0" as const;

export interface ContextMemoryLimits {
  messages: number;
  runs: number;
  tools: number;
  artifacts: number;
  previewCharacters: number;
  totalCharacters: number;
}

export const DEFAULT_CONTEXT_MEMORY_LIMITS: ContextMemoryLimits = {
  messages: 6,
  runs: 6,
  tools: 6,
  artifacts: 2,
  previewCharacters: 240,
  totalCharacters: 4000
};

const CURRENT_TASK_SCORE = 100;
const KEYWORD_MATCH_SCORE = 10;
const FAILED_SCORE = 50;
const RECENCY_SCORE_DIVISOR = 1_000_000_000_000_000;
const CONTEXT_MEMORY_REDACTION = "[REDACTED]";
const TOTAL_BUDGET_EXCEEDED_REASON = "memory:total:budget_exceeded";
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

const StaticArtifactFilePathSchema = z.enum(["index.html", "styles.css", "script.js"]);

const ContextMemoryFileSchema = z.object({
  name: StaticArtifactFilePathSchema,
  path: StaticArtifactFilePathSchema.optional(),
  characterCount: z.number().int().min(0),
  sizeBytes: z.number().int().min(0).optional(),
  sha256: z.string().regex(SHA256_HEX_PATTERN).optional(),
  summary: z.string().min(1).optional()
});

export const ContextMemoryMessageSummarySchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  role: z.string().min(1),
  preview: z.string(),
  createdAt: z.string().datetime(),
  score: z.number().finite()
});

export const ContextMemoryRunSummarySchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1).optional(),
  role: z.enum(agentRoles),
  state: z.string().min(1),
  eventTypes: z.array(z.string().min(1)),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  score: z.number().finite()
});

export const ContextMemoryToolSummarySchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  taskId: z.string().min(1).optional(),
  toolName: z.string().min(1),
  state: z.string().min(1),
  outputSummary: z.string(),
  exitCode: z.number().int().optional(),
  errorName: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  score: z.number().finite()
});

export const ContextMemoryArtifactSummarySchema = z.object({
  pageVersionId: z.string().min(1),
  briefId: z.string().min(1),
  artifactWorkspaceId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  objective: z.string().min(1).optional(),
  files: z.array(ContextMemoryFileSchema),
  createdAt: z.string().datetime(),
  score: z.number().finite()
});

export const ContextMemorySchema: z.ZodType<ModelContextMemory> = z.object({
  messages: z.array(ContextMemoryMessageSummarySchema),
  runs: z.array(ContextMemoryRunSummarySchema),
  tools: z.array(ContextMemoryToolSummarySchema),
  artifacts: z.array(ContextMemoryArtifactSummarySchema),
  retrieval: z.object({
    query: z.string(),
    strategy: z.literal(CONTEXT_MEMORY_STRATEGY),
    selected: z.array(z.string().min(1)),
    omitted: z.array(z.string().min(1))
  })
});

export type ContextMemory = z.infer<typeof ContextMemorySchema>;
type ContextMemoryMessageSummary = z.infer<typeof ContextMemoryMessageSummarySchema>;
type ContextMemoryRunSummary = z.infer<typeof ContextMemoryRunSummarySchema>;
type ContextMemoryToolSummary = z.infer<typeof ContextMemoryToolSummarySchema>;
type ContextMemoryArtifactSummary = z.infer<typeof ContextMemoryArtifactSummarySchema>;
type ContextMemorySource = "messages" | "runs" | "tools" | "artifacts";
type ContextMemorySelectedSource = "message" | "run" | "tool" | "artifact";

export interface AssembleContextMemoryInput {
  repositories: WorkbenchRepositories;
  projectId: string;
  taskId?: string;
  role: AgentRole;
  input: RuntimeRunInput;
  limits?: Partial<ContextMemoryLimits>;
  now?: () => Date;
}

export async function assembleContextMemory(
  input: AssembleContextMemoryInput
): Promise<ContextMemory> {
  const limits = {
    ...DEFAULT_CONTEXT_MEMORY_LIMITS,
    ...input.limits
  };
  const query = toContextMemoryQuery({ role: input.role, input: input.input });
  const tasks = await input.repositories.tasks.listAll();
  const projectTaskIds = new Set(
    tasks.filter((task) => task.projectId === input.projectId).map((task) => task.id)
  );
  const allMessages = await input.repositories.messages.listAll();
  const queryKeywords = toKeywords(query);
  const runEvents = await input.repositories.runEvents.listForProject(input.projectId);
  const briefs = await input.repositories.briefs.listAll();
  const omitted: string[] = [];

  const messageSummaries = allMessages
    .filter((message) => projectTaskIds.has(message.taskId))
    .map((message) => {
      const sanitizedContent = sanitizeContextMemoryText(message.content);

      return {
        id: message.id,
        taskId: message.taskId,
        role: message.role,
        preview: truncatePreview(sanitizedContent, limits.previewCharacters),
        createdAt: message.createdAt,
        score: scoreMessage(message, input.taskId, queryKeywords, sanitizedContent)
      };
    })
    .sort(compareScoredMessages);
  const runSummaries = summarizeRuns({
    runs: await input.repositories.runs.listForProject(input.projectId),
    events: runEvents,
    currentTaskId: input.taskId
  });
  const toolSummaries = summarizeTools({
    observations: (await input.repositories.toolObservations.listAll()).filter(
      (observation) => observation.projectId === input.projectId
    ),
    currentTaskId: input.taskId
  });
  const artifactSummaries = await summarizeArtifacts({
    repositories: input.repositories,
    pageVersions: (await input.repositories.pageVersions.listAll()).filter(
      (pageVersion) => pageVersion.projectId === input.projectId
    ),
    briefs
  });

  const memory: ContextMemory = {
    messages: selectWithBudget({
      source: messageSummaries,
      sourceName: "messages",
      limit: limits.messages,
      omitted
    }),
    runs: selectWithBudget({
      source: runSummaries,
      sourceName: "runs",
      limit: limits.runs,
      omitted
    }),
    tools: selectWithBudget({
      source: toolSummaries,
      sourceName: "tools",
      limit: limits.tools,
      omitted
    }),
    artifacts: selectWithBudget({
      source: artifactSummaries,
      sourceName: "artifacts",
      limit: limits.artifacts,
      omitted
    }),
    retrieval: {
      query,
      strategy: CONTEXT_MEMORY_STRATEGY,
      selected: [],
      omitted
    }
  };
  memory.retrieval.selected = toSelectedSourceIds(memory);
  applyTotalCharacterBudget(memory, limits.totalCharacters);

  return ContextMemorySchema.parse(memory);
}

export function toContextMemoryQuery(input: {
  role: AgentRole;
  input: RuntimeRunInput;
}): string {
  const query = [
    input.role,
    input.input.prompt,
    input.input.brief?.objective,
    input.input.brief?.audience,
    input.input.brief?.offer,
    getPrimaryCta(input.input.brief)
  ]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .map((part) => part.trim())
    .join(" ");
  return sanitizeContextMemoryText(query);
}

export function truncatePreview(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

function scoreMessage(
  message: WorkbenchMessageRecord,
  currentTaskId: string | undefined,
  queryKeywords: Set<string>,
  content: string = message.content
): number {
  const contentKeywords = toKeywords(content);
  const keywordScore = [...queryKeywords].reduce(
    (score, keyword) => score + (contentKeywords.has(keyword) ? KEYWORD_MATCH_SCORE : 0),
    0
  );
  const currentTaskScore =
    currentTaskId !== undefined && message.taskId === currentTaskId ? CURRENT_TASK_SCORE : 0;
  const recencyTieBreak = Date.parse(message.createdAt) / RECENCY_SCORE_DIVISOR;

  return currentTaskScore + keywordScore + recencyTieBreak;
}

function compareScoredMessages(
  left: ContextMemoryMessageSummary,
  right: ContextMemoryMessageSummary
): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (right.createdAt !== left.createdAt) {
    return right.createdAt.localeCompare(left.createdAt);
  }

  return left.id.localeCompare(right.id);
}

function summarizeRuns(input: {
  runs: RunRecord[];
  events: RunEventRecord[];
  currentTaskId: string | undefined;
}): ContextMemoryRunSummary[] {
  return input.runs
    .map((run) => {
      const eventTypes = input.events
        .filter((event) => event.runId === run.id)
        .sort((left, right) => left.sequence - right.sequence)
        .map((event) => event.type);

      return {
        id: run.id,
        ...(run.taskId ? { taskId: run.taskId } : {}),
        role: run.role,
        state: run.state,
        eventTypes,
        startedAt: run.startedAt,
        ...(run.completedAt ? { completedAt: run.completedAt } : {}),
        score: scoreRun(run, input.currentTaskId)
      };
    })
    .sort(compareScoredRuns);
}

function scoreRun(run: RunRecord, currentTaskId: string | undefined): number {
  const currentTaskScore =
    currentTaskId !== undefined && run.taskId === currentTaskId ? CURRENT_TASK_SCORE : 0;
  const failedScore = run.state === "failed" ? FAILED_SCORE : 0;
  const recencyTieBreak = Date.parse(run.completedAt ?? run.startedAt) / RECENCY_SCORE_DIVISOR;

  return currentTaskScore + failedScore + recencyTieBreak;
}

function compareScoredRuns(left: ContextMemoryRunSummary, right: ContextMemoryRunSummary): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (right.startedAt !== left.startedAt) {
    return right.startedAt.localeCompare(left.startedAt);
  }

  return left.id.localeCompare(right.id);
}

function summarizeTools(input: {
  observations: ToolObservationRecord[];
  currentTaskId: string | undefined;
}): ContextMemoryToolSummary[] {
  return input.observations
    .map((observation) => {
      const errorName = toOptionalNonEmptyString(observation.errorName);

      return {
        id: observation.id,
        runId: observation.runId,
        ...(observation.taskId ? { taskId: observation.taskId } : {}),
        toolName: observation.toolName,
        state: observation.state,
        outputSummary: sanitizeContextMemoryText(observation.outputSummary),
        ...(observation.exitCode !== undefined ? { exitCode: observation.exitCode } : {}),
        ...(errorName ? { errorName } : {}),
        createdAt: observation.createdAt,
        ...(observation.completedAt ? { completedAt: observation.completedAt } : {}),
        score: scoreTool(observation, input.currentTaskId)
      };
    })
    .sort(compareScoredTools);
}

function scoreTool(
  observation: ToolObservationRecord,
  currentTaskId: string | undefined
): number {
  const currentTaskScore =
    currentTaskId !== undefined && observation.taskId === currentTaskId ? CURRENT_TASK_SCORE : 0;
  const failedScore = observation.state === "failed" ? FAILED_SCORE : 0;
  const recencyTieBreak =
    Date.parse(observation.completedAt ?? observation.createdAt) / RECENCY_SCORE_DIVISOR;

  return currentTaskScore + failedScore + recencyTieBreak;
}

function compareScoredTools(
  left: ContextMemoryToolSummary,
  right: ContextMemoryToolSummary
): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (right.createdAt !== left.createdAt) {
    return right.createdAt.localeCompare(left.createdAt);
  }

  return left.id.localeCompare(right.id);
}

async function summarizeArtifacts(input: {
  repositories: WorkbenchRepositories;
  pageVersions: PageVersionRecord[];
  briefs: BriefRecord[];
}): Promise<ContextMemoryArtifactSummary[]> {
  const briefsById = new Map(
    input.briefs.map((brief) => [`${brief.projectId}:${brief.id}`, brief] as const)
  );

  const summaries = await Promise.all(
    input.pageVersions.map(async (pageVersion) => {
      const brief = briefsById.get(`${pageVersion.projectId}:${pageVersion.briefId}`);
      const title = toOptionalNonEmptyString(brief?.brief.title);
      const objective = toOptionalNonEmptyString(brief?.brief.objective);
      const artifactFiles = await summarizeArtifactFiles(input.repositories, pageVersion);

      return {
        pageVersionId: pageVersion.id,
        briefId: pageVersion.briefId,
        ...(artifactFiles.artifactWorkspaceId
          ? { artifactWorkspaceId: artifactFiles.artifactWorkspaceId }
          : {}),
        ...(title ? { title } : {}),
        ...(objective ? { objective } : {}),
        files: artifactFiles.files,
        createdAt: pageVersion.createdAt,
        score: scoreArtifact(pageVersion)
      };
    })
  );

  return summaries.sort(compareScoredArtifacts);
}

async function summarizeArtifactFiles(
  repositories: WorkbenchRepositories,
  pageVersion: PageVersionRecord
): Promise<{
  artifactWorkspaceId?: string;
  files: ContextMemoryArtifactSummary["files"];
}> {
  if (!pageVersion.artifactWorkspaceId) {
    return {
      files: summarizeEmbeddedArtifactFiles(pageVersion)
    };
  }

  const workspace = await repositories.artifactWorkspaces.getById(
    pageVersion.artifactWorkspaceId
  );
  if (!workspace) {
    return {
      files: summarizeEmbeddedArtifactFiles(pageVersion)
    };
  }
  assertArtifactWorkspaceOwnership(workspace, pageVersion);

  let workspaceFiles: ArtifactWorkspaceFileRecord[];
  try {
    workspaceFiles = await repositories.artifactWorkspaceFiles.listForWorkspace(workspace.id);
  } catch {
    return {
      files: summarizeEmbeddedArtifactFiles(pageVersion)
    };
  }

  assertArtifactWorkspaceFileOwnership(workspaceFiles, workspace, pageVersion);

  try {
    const manifest = createArtifactWorkspaceManifest({
      workspaceId: workspace.id,
      projectId: workspace.projectId,
      pageVersionId: workspace.pageVersionId,
      files: workspaceFiles
    });
    const filesByPath = new Map(workspaceFiles.map((file) => [file.path, file] as const));

    return {
      artifactWorkspaceId: workspace.id,
      files: manifest.files.map((file) => ({
        name: file.path,
        path: file.path,
        characterCount: filesByPath.get(file.path)?.content.length ?? 0,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        summary: file.summary
      }))
    };
  } catch {
    return {
      files: summarizeEmbeddedArtifactFiles(pageVersion)
    };
  }
}

function summarizeEmbeddedArtifactFiles(
  pageVersion: PageVersionRecord
): ContextMemoryArtifactSummary["files"] {
  return [
    {
      name: "index.html",
      characterCount: pageVersion.artifacts.indexHtml.length
    },
    {
      name: "styles.css",
      characterCount: pageVersion.artifacts.stylesCss.length
    },
    {
      name: "script.js",
      characterCount: pageVersion.artifacts.scriptJs.length
    }
  ];
}

function assertArtifactWorkspaceOwnership(
  workspace: ArtifactWorkspaceRecord,
  pageVersion: PageVersionRecord
): void {
  if (workspace.projectId !== pageVersion.projectId || workspace.pageVersionId !== pageVersion.id) {
    throw new Error(
      `Artifact workspace ${workspace.id} does not belong to page version ${pageVersion.id}.`
    );
  }
}

function assertArtifactWorkspaceFileOwnership(
  files: ArtifactWorkspaceFileRecord[],
  workspace: ArtifactWorkspaceRecord,
  pageVersion: PageVersionRecord
): void {
  const mismatchedFile = files.find(
    (file) =>
      file.workspaceId !== workspace.id ||
      file.projectId !== pageVersion.projectId ||
      file.pageVersionId !== pageVersion.id
  );
  if (mismatchedFile) {
    throw new Error(
      `Artifact workspace file ${mismatchedFile.path} does not belong to page version ${pageVersion.id}.`
    );
  }
}

function scoreArtifact(pageVersion: PageVersionRecord): number {
  const failedScore = pageVersion.reviewStatus === "failed" ? FAILED_SCORE : 0;
  const recencyTieBreak = Date.parse(pageVersion.createdAt) / RECENCY_SCORE_DIVISOR;

  return failedScore + recencyTieBreak;
}

function compareScoredArtifacts(
  left: ContextMemoryArtifactSummary,
  right: ContextMemoryArtifactSummary
): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (right.createdAt !== left.createdAt) {
    return right.createdAt.localeCompare(left.createdAt);
  }

  return left.pageVersionId.localeCompare(right.pageVersionId);
}

function toKeywords(value: string): Set<string> {
  const stopwords = new Set([
    "a",
    "an",
    "and",
    "for",
    "in",
    "into",
    "of",
    "redacted",
    "the",
    "to",
    "with"
  ]);
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((word) => word.length > 1 && !stopwords.has(word))
  );
}

function getPrimaryCta(brief: RuntimeRunInput["brief"]): string | undefined {
  const primaryCta = (brief as ({ primaryCta?: unknown } & NonNullable<typeof brief>) | undefined)
    ?.primaryCta;
  return typeof primaryCta === "string" ? primaryCta : brief?.cta.label;
}

function toOptionalNonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value === undefined ? undefined : sanitizeContextMemoryText(value).trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeContextMemoryText(value: string): string {
  return value
    .replace(
      /\b((?:(?:[a-z][a-z0-9]*[_-])*(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|secret))\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      `$1${CONTEXT_MEMORY_REDACTION}`
    )
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}\b/giu, `$1${CONTEXT_MEMORY_REDACTION}`)
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/giu, CONTEXT_MEMORY_REDACTION)
    .replace(/\bsecret-token\b/giu, CONTEXT_MEMORY_REDACTION);
}

function selectWithBudget<T>(input: {
  source: T[];
  sourceName: ContextMemorySource;
  limit: number;
  omitted: string[];
}): T[] {
  if (input.source.length === 0) {
    input.omitted.push(`memory:${input.sourceName}:none`);
    return [];
  }

  const limit = Math.max(0, Math.floor(input.limit));
  const selected = input.source.slice(0, limit);
  if (selected.length < input.source.length) {
    input.omitted.push(`memory:${input.sourceName}:budget_exceeded`);
  }

  return selected;
}

function applyTotalCharacterBudget(memory: ContextMemory, totalCharacters: number): void {
  const budget = Math.max(0, Math.floor(totalCharacters));
  if (contextMemoryCharacterCount(memory) <= budget) {
    return;
  }

  markTotalBudgetExceeded(memory);
  const originalQuery = memory.retrieval.query;
  truncateQueryToBudget(memory, originalQuery, budget);
  if (contextMemoryCharacterCount(memory) <= budget) {
    return;
  }

  for (const sourceName of ["artifacts", "tools", "runs", "messages"] as const) {
    while (memory[sourceName].length > 0) {
      memory[sourceName].pop();
      refreshSelectedMemory(memory);
      truncateQueryToBudget(memory, originalQuery, budget);
      if (contextMemoryCharacterCount(memory) <= budget) {
        return;
      }
    }
  }
}

function markTotalBudgetExceeded(memory: ContextMemory): void {
  if (!memory.retrieval.omitted.includes(TOTAL_BUDGET_EXCEEDED_REASON)) {
    memory.retrieval.omitted.push(TOTAL_BUDGET_EXCEEDED_REASON);
  }
}

function truncateQueryToBudget(memory: ContextMemory, query: string, budget: number): void {
  memory.retrieval.query = query;
  if (contextMemoryCharacterCount(memory) <= budget) {
    return;
  }

  memory.retrieval.query = "";
  if (contextMemoryCharacterCount(memory) > budget) {
    return;
  }

  let low = 0;
  let high = query.length;
  let best = "";
  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2);
    const candidate = query.slice(0, midpoint);
    memory.retrieval.query = candidate;

    if (contextMemoryCharacterCount(memory) <= budget) {
      best = candidate;
      low = midpoint + 1;
    } else {
      high = midpoint - 1;
    }
  }

  memory.retrieval.query = best;
}

function contextMemoryCharacterCount(memory: ContextMemory): number {
  return JSON.stringify(memory).length;
}

function refreshSelectedMemory(memory: ContextMemory): void {
  memory.retrieval.selected = toSelectedSourceIds(memory);
}

function toSelectedSourceIds(
  memory: Pick<ContextMemory, "messages" | "runs" | "tools" | "artifacts">
): string[] {
  return [
    ...memory.messages.map((message) => selectedId("message", message.id)),
    ...memory.runs.map((run) => selectedId("run", run.id)),
    ...memory.tools.map((tool) => selectedId("tool", tool.id)),
    ...memory.artifacts.map((artifact) => selectedId("artifact", artifact.pageVersionId))
  ];
}

function selectedId(source: ContextMemorySelectedSource, id: string): string {
  return `${source}:${id}`;
}
