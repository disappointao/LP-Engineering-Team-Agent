import type { createDemoWorkbenchSnapshot } from "./demo-workbench";
import type { ArtifactDownloadLink } from "./export-links";
import type { WorkbenchCopy } from "./i18n";

type DemoWorkbenchSnapshot = Awaited<ReturnType<typeof createDemoWorkbenchSnapshot>>;

export type ChatToolRole = "planner" | "builder" | "reviewer" | "deployer";
export type ChatToolStatus = "complete";

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
  snapshot: DemoWorkbenchSnapshot;
  downloadLinks: ArtifactDownloadLink[];
  handoffLink: ArtifactDownloadLink;
}

export function createChatWorkbenchThread({
  copy,
  snapshot,
  downloadLinks,
  handoffLink
}: CreateChatWorkbenchThreadInput): ChatWorkbenchThread {
  const reviewStatus = copy.status[snapshot.pageVersion.reviewStatus];
  const findingsCount = snapshot.pageVersion.findings.length;
  const toolEvents: ChatToolEvent[] = [
    {
      id: "planner",
      role: "planner",
      label: copy.run.planner[0],
      operation: copy.run.planner[1],
      status: "complete",
      statusLabel: copy.chat.toolStatusComplete,
      meta: `${copy.fields.objective}: ${copy.demo.objective}`
    },
    {
      id: "builder",
      role: "builder",
      label: copy.run.builder[0],
      operation: copy.run.builder[1],
      status: "complete",
      statusLabel: copy.chat.toolStatusComplete,
      meta: `${copy.chat.filesLabel}: ${downloadLinks.length}`
    },
    {
      id: "reviewer",
      role: "reviewer",
      label: copy.run.reviewer[0],
      operation: copy.run.reviewer[1],
      status: "complete",
      statusLabel: copy.chat.toolStatusComplete,
      meta: `${copy.status.review}: ${reviewStatus} - ${copy.chat.findingsLabel}: ${findingsCount}`
    },
    {
      id: "deployer",
      role: "deployer",
      label: copy.run.deployer[0],
      operation: `${snapshot.deployment.branch} ${copy.run.deployer[1]}`,
      status: "complete",
      statusLabel: copy.chat.toolStatusComplete,
      meta: `${copy.chat.branchLabel}: ${snapshot.deployment.branch}`
    }
  ];

  const artifacts: ChatArtifactCard[] = [
    {
      ...handoffLink,
      id: "handoff",
      kind: copy.chat.artifactKinds.handoff
    },
    ...downloadLinks.map((link, index) => ({
      ...link,
      id: link.filename,
      kind: index === 0 ? copy.chat.artifactKinds.single : copy.chat.artifactKinds.static
    }))
  ];

  return {
    userMessage: copy.demo.prompt,
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
