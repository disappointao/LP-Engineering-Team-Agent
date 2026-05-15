import { z } from "zod";
import type { WorkbenchMessageRecord, WorkbenchRepositories } from "@lp-agent/db";
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
const RECENCY_SCORE_DIVISOR = 1_000_000_000_000_000;

const ContextMemoryFileSchema = z.object({
  name: z.enum(["index.html", "styles.css", "script.js"]),
  characterCount: z.number().int().min(0)
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
  title: z.string(),
  objective: z.string(),
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

  const messages = allMessages
    .filter((message) => projectTaskIds.has(message.taskId))
    .map((message) => ({
      id: message.id,
      taskId: message.taskId,
      role: message.role,
      preview: truncatePreview(message.content, limits.previewCharacters),
      createdAt: message.createdAt,
      score: scoreMessage(message, input.taskId, queryKeywords)
    }))
    .sort(compareScoredMessages)
    .slice(0, limits.messages);

  const boundedMessages = limitMessageCharacters(messages, limits.totalCharacters);
  const selected = boundedMessages.map((message) => `message:${message.id}`);
  const omitted = [
    ...(boundedMessages.length === 0 ? ["memory:messages:none"] : []),
    "memory:runs:none",
    "memory:tools:none",
    "memory:artifacts:none"
  ];

  const memory: ContextMemory = {
    messages: boundedMessages,
    runs: [],
    tools: [],
    artifacts: [],
    retrieval: {
      query,
      strategy: CONTEXT_MEMORY_STRATEGY,
      selected,
      omitted
    }
  };

  return ContextMemorySchema.parse(memory);
}

export function toContextMemoryQuery(input: {
  role: AgentRole;
  input: RuntimeRunInput;
}): string {
  return [
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
}

export function truncatePreview(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

function scoreMessage(
  message: WorkbenchMessageRecord,
  currentTaskId: string | undefined,
  queryKeywords: Set<string>
): number {
  const contentKeywords = toKeywords(message.content);
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
  left: z.infer<typeof ContextMemoryMessageSummarySchema>,
  right: z.infer<typeof ContextMemoryMessageSummarySchema>
): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (right.createdAt !== left.createdAt) {
    return right.createdAt.localeCompare(left.createdAt);
  }

  return left.id.localeCompare(right.id);
}

function toKeywords(value: string): Set<string> {
  const stopwords = new Set(["a", "an", "and", "for", "in", "into", "of", "the", "to", "with"]);
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

function limitMessageCharacters(
  messages: Array<z.infer<typeof ContextMemoryMessageSummarySchema>>,
  totalCharacters: number
): Array<z.infer<typeof ContextMemoryMessageSummarySchema>> {
  let usedCharacters = 0;
  const boundedMessages: Array<z.infer<typeof ContextMemoryMessageSummarySchema>> = [];

  for (const message of messages) {
    if (usedCharacters + message.preview.length > totalCharacters) {
      break;
    }

    boundedMessages.push(message);
    usedCharacters += message.preview.length;
  }

  return boundedMessages;
}
