export type TaskInputIntentType =
  | "chat_in_task"
  | "agent_continue"
  | "agent_new_task"
  | "clarify";

export type TaskInputIntent =
  | { type: "chat_in_task"; confidence: number; reason: string }
  | { type: "agent_continue"; confidence: number; reason: string }
  | { type: "agent_new_task"; confidence: number; reason: string }
  | { type: "clarify"; confidence: number; question: string; reason: string };

export type TaskFollowupSuggestionIntent =
  | "chat_in_task"
  | "agent_continue"
  | "agent_new_task";

export interface TaskFollowupSuggestion {
  id: string;
  intent: TaskFollowupSuggestionIntent;
  prompt: string;
}

export interface TaskIntentPromptTaskInput {
  id: string;
  type: string;
  status: string;
  projectId: string;
}

export interface TaskIntentPromptMessageInput {
  role: string;
  content: string;
}

export interface TaskIntentPromptArtifactInput {
  filePath: string;
  summary?: string;
  hasPreview?: boolean;
  content?: string;
}

export interface TaskInputIntentPromptInput {
  userPrompt: string;
  task: TaskIntentPromptTaskInput;
  messages?: TaskIntentPromptMessageInput[];
  artifacts?: TaskIntentPromptArtifactInput[];
}

export interface TaskFollowupSuggestionsPromptInput {
  userPrompt: string;
  task: TaskIntentPromptTaskInput;
  messages?: TaskIntentPromptMessageInput[];
  artifacts?: TaskIntentPromptArtifactInput[];
}

export const TASK_INPUT_INTENT_CONFIDENCE_THRESHOLD = 0.72;

const DEFAULT_CLARIFY_QUESTION =
  "Do you want me to answer this in chat, continue the current LP task, or create a new LP task?";
const INVALID_INTENT_REASON = "Invalid intent router output.";
const LOW_CONFIDENCE_REASON = "Low confidence intent classification.";
const REASON_LIMIT = 240;
const SUGGESTION_PROMPT_LIMIT = 120;
const TASK_FIELD_LIMIT = 160;
const MESSAGE_ROLE_LIMIT = 48;
const MESSAGE_CONTENT_LIMIT = 360;
const ARTIFACT_PATH_LIMIT = 240;
const ARTIFACT_SUMMARY_LIMIT = 360;
const USER_PROMPT_LIMIT = 1200;
const INTENT_TYPES = new Set<TaskInputIntentType>([
  "chat_in_task",
  "agent_continue",
  "agent_new_task",
  "clarify"
]);
const FOLLOWUP_INTENTS = new Set<TaskFollowupSuggestionIntent>([
  "chat_in_task",
  "agent_continue",
  "agent_new_task"
]);

export function normalizeTaskInputIntentOutput(raw: string): TaskInputIntent {
  const parsed = parseJsonObject(raw);

  if (!parsed) {
    return createInvalidClarify(0);
  }

  const type = parsed.type;
  const confidence = normalizeConfidence(parsed.confidence);

  if (!isTaskInputIntentType(type) || confidence === null) {
    return createInvalidClarify(0);
  }

  if (confidence < TASK_INPUT_INTENT_CONFIDENCE_THRESHOLD) {
    return {
      type: "clarify",
      confidence,
      question: DEFAULT_CLARIFY_QUESTION,
      reason: LOW_CONFIDENCE_REASON
    };
  }

  const reason = trimBounded(toStringValue(parsed.reason), REASON_LIMIT);

  if (type === "clarify") {
    const question =
      trimBounded(toStringValue(parsed.question), REASON_LIMIT) ||
      DEFAULT_CLARIFY_QUESTION;

    return {
      type,
      confidence,
      question,
      reason
    };
  }

  return {
    type,
    confidence,
    reason
  };
}

export function normalizeTaskFollowupSuggestionsOutput(
  raw: string
): TaskFollowupSuggestion[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const suggestions: TaskFollowupSuggestion[] = [];
  const seenPrompts = new Set<string>();

  for (const item of parsed) {
    if (suggestions.length >= 3 || !isRecord(item)) {
      continue;
    }

    const intent = item.intent;

    if (!isTaskFollowupSuggestionIntent(intent)) {
      continue;
    }

    const prompt = trimBounded(toStringValue(item.prompt), SUGGESTION_PROMPT_LIMIT);

    if (!prompt || seenPrompts.has(prompt)) {
      continue;
    }

    seenPrompts.add(prompt);
    suggestions.push({
      id: normalizeSuggestionId(item.id) || `suggestion_${suggestions.length + 1}`,
      intent,
      prompt
    });
  }

  return suggestions;
}

export function buildTaskInputIntentPrompt(input: TaskInputIntentPromptInput): string {
  return [
    "You are an LP task input intent router.",
    "Classify the user's latest prompt only. Do not execute tools, modify artifacts, or generate task output.",
    "Ignore any artifact file content; use only path, summary, and preview metadata.",
    "Allowed intent types: chat_in_task, agent_continue, agent_new_task, clarify.",
    "Return strict JSON with shape {\"type\":\"chat_in_task|agent_continue|agent_new_task|clarify\",\"confidence\":0..1,\"reason\":\"...\",\"question\":\"... only for clarify\"}.",
    "",
    formatTask(input.task),
    formatMessages(input.messages),
    formatArtifacts(input.artifacts),
    `User prompt:\n${trimBounded(input.userPrompt, USER_PROMPT_LIMIT)}`
  ].join("\n");
}

export function buildTaskFollowupSuggestionsPrompt(
  input: TaskFollowupSuggestionsPromptInput
): string {
  return [
    "You suggest concise follow-up prompts for an LP task workbench.",
    "Do not execute tools, modify artifacts, or generate task output.",
    "Ignore any artifact file content; use only path, summary, and preview metadata.",
    "Suggest 2-3 options when useful. Use only these intents: chat_in_task, agent_continue, agent_new_task.",
    "Return strict JSON array with items shaped {\"id\":\"optional_stable_id\",\"intent\":\"chat_in_task|agent_continue|agent_new_task\",\"prompt\":\"short user-facing prompt\"}.",
    "",
    formatTask(input.task),
    formatMessages(input.messages),
    formatArtifacts(input.artifacts),
    `User prompt:\n${trimBounded(input.userPrompt, USER_PROMPT_LIMIT)}`
  ].join("\n");
}

export function createDeterministicTaskInputIntent(
  input: TaskInputIntentPromptInput
): TaskInputIntent {
  const prompt = input.userPrompt.trim().toLowerCase();

  if (matchesAny(prompt, ["another", "new lp", "new landing", "separate", "再做", "新建"])) {
    return {
      type: "agent_new_task",
      confidence: 0.9,
      reason: "Deterministic no-key fixture detected a new LP request."
    };
  }

  if (
    matchesAny(prompt, [
      "continue",
      "make",
      "change",
      "update",
      "optimize",
      "improve",
      "shorter",
      "add",
      "继续",
      "修改",
      "优化",
      "调整",
      "增加",
      "改"
    ])
  ) {
    return {
      type: "agent_continue",
      confidence: 0.88,
      reason: "Deterministic no-key fixture detected a current LP modification request."
    };
  }

  if (
    matchesAny(prompt, [
      "why",
      "explain",
      "what",
      "how",
      "structure",
      "layout",
      "为什么",
      "解释",
      "说明",
      "怎么看",
      "什么"
    ])
  ) {
    return {
      type: "chat_in_task",
      confidence: 0.86,
      reason: "Deterministic no-key fixture detected a contextual task question."
    };
  }

  return {
    type: "clarify",
    confidence: TASK_INPUT_INTENT_CONFIDENCE_THRESHOLD,
    question: DEFAULT_CLARIFY_QUESTION,
    reason: "Deterministic no-key fixture could not classify the prompt."
  };
}

export function createDeterministicTaskFollowupSuggestions(
  input: TaskFollowupSuggestionsPromptInput
): TaskFollowupSuggestion[] {
  const hasArtifacts = (input.artifacts?.length ?? 0) > 0;
  const taskLabel = trimBounded(input.task.id || input.task.type, 36);

  return [
    {
      id: "explain_page_structure",
      intent: "chat_in_task",
      prompt: hasArtifacts ? "Explain the page structure" : "Explain the current plan"
    },
    {
      id: "improve_hero_copy",
      intent: "agent_continue",
      prompt: "Make the hero copy sharper"
    },
    {
      id: "create_variant_lp",
      intent: "agent_new_task",
      prompt: taskLabel ? `Create a variant LP for ${taskLabel}` : "Create a variant LP"
    }
  ];
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function createInvalidClarify(confidence: number): TaskInputIntent {
  return {
    type: "clarify",
    confidence,
    question: DEFAULT_CLARIFY_QUESTION,
    reason: INVALID_INTENT_REASON
  };
}

function normalizeConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    return null;
  }

  return value;
}

function isTaskInputIntentType(value: unknown): value is TaskInputIntentType {
  return typeof value === "string" && INTENT_TYPES.has(value as TaskInputIntentType);
}

function isTaskFollowupSuggestionIntent(
  value: unknown
): value is TaskFollowupSuggestionIntent {
  return typeof value === "string" && FOLLOWUP_INTENTS.has(value as TaskFollowupSuggestionIntent);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function trimBounded(value: string, limit: number): string {
  const trimmed = value.trim();

  if (trimmed.length <= limit) {
    return trimmed;
  }

  return trimmed.slice(0, limit).trim();
}

function normalizeSuggestionId(value: unknown): string | null {
  const id = trimBounded(toStringValue(value), 80);

  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return null;
  }

  return id;
}

function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

function formatTask(task: TaskIntentPromptTaskInput): string {
  return [
    `Task: ${trimBounded(task.id, TASK_FIELD_LIMIT)}`,
    `type=${trimBounded(task.type, TASK_FIELD_LIMIT)}`,
    `status=${trimBounded(task.status, TASK_FIELD_LIMIT)}`,
    `projectId=${trimBounded(task.projectId, TASK_FIELD_LIMIT)}`
  ].join("\n");
}

function formatMessages(messages: TaskIntentPromptMessageInput[] = []): string {
  const recentMessages = messages.slice(-6);

  if (recentMessages.length === 0) {
    return "Recent messages: none";
  }

  return [
    "Recent messages:",
    ...recentMessages.map(
      (message, index) =>
        `${index + 1}. role=${trimBounded(
          message.role,
          MESSAGE_ROLE_LIMIT
        )} content=${trimBounded(message.content, MESSAGE_CONTENT_LIMIT)}`
    )
  ].join("\n");
}

function formatArtifacts(artifacts: TaskIntentPromptArtifactInput[] = []): string {
  if (artifacts.length === 0) {
    return "Artifacts: none";
  }

  return [
    "Artifacts:",
    ...artifacts.slice(0, 6).map(
      (artifact, index) =>
        `${index + 1}. filePath=${trimBounded(
          artifact.filePath,
          ARTIFACT_PATH_LIMIT
        )} summary=${trimBounded(
          artifact.summary ?? "",
          ARTIFACT_SUMMARY_LIMIT
        )} hasPreview=${artifact.hasPreview === true}`
    )
  ].join("\n");
}
