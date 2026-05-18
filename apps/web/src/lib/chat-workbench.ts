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

export interface ChatWorkbenchThread {
  userMessage: string;
  assistantName: string;
  assistantBadge: string;
  assistantIntro: string;
  assistantCompletion: string;
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
  const terminalRunIds = toTerminalRunIds(runEvents);
  const toolEvents: ChatToolEvent[] = runEvents.length > 0
    ? runEvents.map((event) => toChatToolEvent(event, copy, terminalRunIds))
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
  terminalRunIds: ReadonlySet<string>
): ChatToolEvent {
  const role = toChatToolRole(event);
  const status = toChatToolStatus(event, terminalRunIds);
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

function toTerminalRunIds(events: RunEventRecord[]): Set<string> {
  return new Set(events.filter(isTerminalRunEvent).map((event) => event.runId));
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
  terminalRunIds: ReadonlySet<string>
): ChatToolStatus {
  if (event.type.endsWith(".failed")) {
    return "failed";
  }
  if (event.type.endsWith(".cancelled") || event.type === "task.interrupt.cancelled") {
    return "cancelled";
  }
  if (event.type === "task.interrupt.requested") {
    return terminalRunIds.has(event.runId) ? "complete" : "running";
  }
  if (event.type === "worker.job.linked" || event.type === "tool.started") {
    return "running";
  }
  if (event.type.endsWith(".started")) {
    return terminalRunIds.has(event.runId) ? "complete" : "running";
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

function toDisplayValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
}

export function createGeneralTaskThread({
  copy,
  userMessage,
  assistantMessage
}: {
  copy: WorkbenchCopy;
  userMessage: string;
  assistantMessage: string;
}): ChatWorkbenchThread {
  return {
    userMessage,
    assistantName: copy.chat.assistantName,
    assistantBadge: copy.chat.assistantBadge,
    assistantIntro: copy.chat.generalIntro,
    assistantCompletion: assistantMessage,
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
