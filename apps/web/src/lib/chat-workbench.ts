import type { PageVersionRecord, RunEventRecord } from "@lp-agent/api";
import type { ArtifactDownloadLink } from "./export-links";
import type { WorkbenchCopy } from "./i18n";

export type ChatToolRole = "planner" | "builder" | "reviewer" | "deployer" | "assistant";
export type ChatToolStatus = "complete" | "failed" | "running" | "cancelled";

export interface ChatToolEvent {
  id: string;
  role: ChatToolRole;
  label: string;
  operation: string;
  status: ChatToolStatus;
  statusLabel: string;
  meta: string;
}

export interface ChatArtifactCard extends ArtifactDownloadLink {
  id: string;
  kind: string;
}

export interface ChatComposerCopy {
  placeholder: string;
  addAttachmentLabel: string;
  runtimeChip: string;
  interruptLabel: string;
  sendLabel: string;
}

export interface ChatWorkbenchTurn {
  id: string;
  userMessage: string;
  assistantCompletion: string;
}

export interface ChatWorkbenchThread {
  userMessage: string;
  assistantName: string;
  assistantBadge: string;
  assistantIntro: string;
  assistantCompletion: string;
  turns: ChatWorkbenchTurn[];
  toolEvents: ChatToolEvent[];
  artifacts: ChatArtifactCard[];
  suggestions: string[];
  composer: ChatComposerCopy;
}

interface CreateChatWorkbenchThreadInput {
  copy: WorkbenchCopy;
  prompt: string;
  objective: string;
  pageVersion: PageVersionRecord;
  downloadLinks: ArtifactDownloadLink[];
  runEvents?: RunEventRecord[];
}

export function createChatWorkbenchThread({
  copy,
  prompt,
  objective,
  pageVersion,
  downloadLinks,
  runEvents = []
}: CreateChatWorkbenchThreadInput): ChatWorkbenchThread {
  const terminalRunStatuses = toTerminalRunStatuses(runEvents);
  const toolEvents: ChatToolEvent[] = runEvents.length > 0
    ? runEvents.map((event) => toChatToolEvent(event, copy, terminalRunStatuses))
    : createFallbackToolEvents({ copy, objective, pageVersion, downloadLinks });

  const artifacts: ChatArtifactCard[] = downloadLinks.map((link, index) => ({
    ...link,
    id: link.filename,
    kind: index === 0 ? copy.chat.artifactKinds.single : copy.chat.artifactKinds.static
  }));

  return {
    userMessage: prompt,
    assistantName: copy.chat.assistantName,
    assistantBadge: copy.chat.assistantBadge,
    assistantIntro: copy.chat.intro,
    assistantCompletion: copy.chat.completion,
    turns: [
      {
        id: "lp_generation",
        userMessage: prompt,
        assistantCompletion: copy.chat.completion
      }
    ],
    toolEvents,
    artifacts,
    suggestions: copy.chat.suggestions,
    composer: {
      placeholder: copy.chat.composerPlaceholder,
      addAttachmentLabel: copy.chat.addAttachmentLabel,
      runtimeChip: copy.chat.runtimeChip,
      interruptLabel: copy.chat.interruptLabel,
      sendLabel: copy.chat.sendLabel
    }
  };
}

function createFallbackToolEvents(input: {
  copy: WorkbenchCopy;
  objective: string;
  pageVersion: PageVersionRecord;
  downloadLinks: ArtifactDownloadLink[];
}): ChatToolEvent[] {
  const reviewStatus = input.copy.status[input.pageVersion.reviewStatus];
  const findingsCount = input.pageVersion.findings.length;
  return [
    {
      id: "planner",
      role: "planner",
      label: input.copy.run.planner[0],
      operation: input.copy.run.planner[1],
      status: "complete",
      statusLabel: input.copy.chat.toolStatusComplete,
      meta: `${input.copy.fields.objective}: ${input.objective}`
    },
    {
      id: "builder",
      role: "builder",
      label: input.copy.run.builder[0],
      operation: input.copy.run.builder[1],
      status: "complete",
      statusLabel: input.copy.chat.toolStatusComplete,
      meta: `${input.copy.chat.filesLabel}: ${input.downloadLinks.length}`
    },
    {
      id: "reviewer",
      role: "reviewer",
      label: input.copy.run.reviewer[0],
      operation: input.copy.run.reviewer[1],
      status: "complete",
      statusLabel: input.copy.chat.toolStatusComplete,
      meta: `${input.copy.status.review}: ${reviewStatus} - ${input.copy.chat.findingsLabel}: ${findingsCount}`
    }
  ];
}

function toChatToolEvent(
  event: RunEventRecord,
  copy: WorkbenchCopy,
  terminalRunStatuses: ReadonlyMap<string, ChatToolStatus>
): ChatToolEvent {
  const role = toChatToolRole(event);
  const status = toChatToolStatus(event, terminalRunStatuses);
  return {
    id: `${event.runId}:${event.sequence}`,
    role,
    label: role === "assistant" ? copy.chat.generalToolLabel : copy.run[role][0],
    operation: event.message,
    status,
    statusLabel: toStatusLabel(status, copy),
    meta: formatRunEventMeta(event)
  };
}

function toTerminalRunStatuses(events: RunEventRecord[]): Map<string, ChatToolStatus> {
  return new Map(
    events
      .filter(isTerminalRunEvent)
      .map((event) => [event.runId, toTerminalRunStatus(event)])
  );
}

function isTerminalRunEvent(event: RunEventRecord): boolean {
  return (
    event.type.endsWith(".completed") ||
    event.type.endsWith(".failed") ||
    event.type.endsWith(".cancelled") ||
    event.type === "task.interrupt.cancelled"
  );
}

function toChatToolStatus(
  event: RunEventRecord,
  terminalRunStatuses: ReadonlyMap<string, ChatToolStatus>
): ChatToolStatus {
  if (event.type.endsWith(".failed")) {
    return "failed";
  }
  if (event.type.endsWith(".cancelled") || event.type === "task.interrupt.cancelled") {
    return "cancelled";
  }
  if (event.type === "task.interrupt.requested") {
    return terminalRunStatuses.has(event.runId) ? "complete" : "running";
  }
  if (event.type === "worker.job.linked" || event.type === "tool.started") {
    return terminalRunStatuses.get(event.runId) ?? "running";
  }
  if (event.type.endsWith(".started")) {
    return terminalRunStatuses.has(event.runId) ? "complete" : "running";
  }
  return "complete";
}

function toTerminalRunStatus(event: RunEventRecord): ChatToolStatus {
  if (event.type.endsWith(".failed")) {
    return "failed";
  }
  if (event.type.endsWith(".cancelled") || event.type === "task.interrupt.cancelled") {
    return "cancelled";
  }
  return "complete";
}

function toStatusLabel(status: ChatToolStatus, copy: WorkbenchCopy): string {
  if (status === "failed") {
    return copy.status.failed;
  }
  if (status === "running") {
    return copy.chat.toolStatusRunning;
  }
  if (status === "cancelled") {
    return copy.chat.toolStatusCancelled;
  }
  return copy.chat.toolStatusComplete;
}

function toChatToolRole(event: RunEventRecord): ChatToolRole {
  const role = event.payload.role;
  if (role === "planner" || role === "builder" || role === "reviewer" || role === "deployer") {
    return role;
  }
  if (event.type.startsWith("tool.")) {
    return "deployer";
  }
  return "assistant";
}

function formatRunEventMeta(event: RunEventRecord): string {
  const parts = [event.type];
  if (event.type === "model.completed") {
    appendModelCompletedMeta(parts, event);
  }
  const commandId = toDisplayValue(event.payload.commandId);
  const workerJobId = toDisplayValue(event.payload.workerJobId);
  const exitCode = toDisplayValue(event.payload.exitCode);
  const errorName = toDisplayValue(event.payload.errorName);
  const outputSummary = toDisplayValue(event.payload.outputSummary);

  if (commandId) {
    parts.push(commandId);
  }
  if (workerJobId) {
    parts.push(workerJobId);
  }
  if (exitCode) {
    parts.push(`exit ${exitCode}`);
  }
  if (errorName) {
    parts.push(errorName);
  }
  if (outputSummary) {
    parts.push(outputSummary);
  }
  return parts.join(" - ");
}

function appendModelCompletedMeta(parts: string[], event: RunEventRecord): void {
  const provider = toDisplayValue(event.payload.provider);
  const model = toDisplayValue(event.payload.model);
  const api = toDisplayValue(event.payload.api);
  const usage = toUsagePayload(event.payload.usage);
  const attempt = toPositiveInteger(event.payload.attempt);
  const durationMs = toNonNegativeInteger(event.payload.durationMs);
  const supportsStreaming = toBoolean(event.payload.supportsStreaming);
  const streamingEnabled = toBoolean(event.payload.streamingEnabled);

  if (provider && model) {
    parts.push(`${provider}/${model}`);
  } else if (provider) {
    parts.push(provider);
  } else if (model) {
    parts.push(model);
  }
  if (api) {
    parts.push(api);
  }
  if (usage) {
    const tokenParts = [`in ${usage.inputTokens}`, `out ${usage.outputTokens}`];
    if (usage.totalTokens !== undefined) {
      tokenParts.push(`total ${usage.totalTokens}`);
    }
    parts.push(tokenParts.join(" / "));
    if (usage.source) {
      parts.push(formatUsageSource(usage.source));
    }
  }
  if (attempt !== undefined) {
    parts.push(`attempt ${attempt}`);
  }
  if (durationMs !== undefined) {
    parts.push(`${durationMs}ms`);
  }
  if (supportsStreaming !== undefined || streamingEnabled !== undefined) {
    parts.push(formatStreamingState({ supportsStreaming, streamingEnabled }));
  }
}

function toUsagePayload(value: unknown):
  | {
      inputTokens: number;
      outputTokens: number;
      totalTokens?: number;
      source?: string;
    }
  | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const usage = value as Record<string, unknown>;
  const inputTokens = toNonNegativeInteger(usage.inputTokens);
  const outputTokens = toNonNegativeInteger(usage.outputTokens);
  const totalTokens = toNonNegativeInteger(usage.totalTokens);
  const source = toDisplayValue(usage.source);
  if (inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }
  return {
    inputTokens,
    outputTokens,
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(source ? { source } : {})
  };
}

function formatUsageSource(source: string): string {
  return source === "provider_reported" ? "provider reported" : source;
}

function formatStreamingState({
  supportsStreaming,
  streamingEnabled
}: {
  supportsStreaming?: boolean;
  streamingEnabled?: boolean;
}): string {
  if (streamingEnabled) {
    return "streaming enabled";
  }
  if (supportsStreaming) {
    return "streaming supported, disabled";
  }
  return "streaming off";
}

function toDisplayValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
}

function toNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function toPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function createGeneralTaskThread({
  copy,
  userMessage,
  assistantMessage,
  messages
}: {
  copy: WorkbenchCopy;
  userMessage: string;
  assistantMessage: string;
  messages?: GeneralTaskMessage[];
}): ChatWorkbenchThread {
  const turns = createGeneralTaskTurns({
    assistantMessage,
    messages,
    userMessage
  });

  return {
    userMessage: turns[0]?.userMessage ?? userMessage,
    assistantName: copy.chat.assistantName,
    assistantBadge: copy.chat.assistantBadge,
    assistantIntro: copy.chat.generalIntro,
    assistantCompletion: turns[0]?.assistantCompletion ?? assistantMessage,
    turns,
    toolEvents: [
      {
        id: "assistant",
        role: "assistant",
        label: copy.chat.generalToolLabel,
        operation: copy.chat.generalToolOperation,
        status: "complete",
        statusLabel: copy.chat.toolStatusComplete,
        meta: copy.chat.generalToolMeta
      }
    ],
    artifacts: [],
    suggestions: copy.chat.generalSuggestions,
    composer: {
      placeholder: copy.chat.composerPlaceholder,
      addAttachmentLabel: copy.chat.addAttachmentLabel,
      runtimeChip: copy.chat.runtimeChip,
      interruptLabel: copy.chat.interruptLabel,
      sendLabel: copy.chat.sendLabel
    }
  };
}

interface GeneralTaskMessage {
  id: string;
  role: string;
  content: string;
}

function createGeneralTaskTurns({
  assistantMessage,
  messages,
  userMessage
}: {
  assistantMessage: string;
  messages?: GeneralTaskMessage[];
  userMessage: string;
}): ChatWorkbenchTurn[] {
  const turns: ChatWorkbenchTurn[] = [];
  let pendingUser: GeneralTaskMessage | undefined;

  for (const message of messages ?? []) {
    if (message.role === "user") {
      pendingUser = message;
      continue;
    }

    if (message.role === "assistant" && pendingUser) {
      turns.push({
        id: `${pendingUser.id}:${message.id}`,
        userMessage: pendingUser.content,
        assistantCompletion: message.content
      });
      pendingUser = undefined;
    }
  }

  if (turns.length > 0) {
    return turns;
  }

  return [
    {
      id: "general_chat",
      userMessage,
      assistantCompletion: assistantMessage
    }
  ];
}
