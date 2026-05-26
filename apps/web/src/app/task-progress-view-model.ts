import type { LiveTaskStatePayload } from "../lib/workbench-store";

type TaskProgressRun = {
  role?: string;
  state?: string;
};

type TaskProgressArtifactProgress = {
  artifactWorkspaceId?: string;
  changedFileCount: number;
  fileCount: number;
  previewVersionKey?: string;
};

type TaskProgressPayload = Omit<
  Partial<LiveTaskStatePayload>,
  "artifactProgress" | "runs"
> & {
  artifactProgress?: TaskProgressArtifactProgress;
  runs?: TaskProgressRun[];
};

export type TaskProgressStatus = "idle" | "running" | "complete" | "stopping";

export interface TaskProgressViewModel {
  activeStepIndex: number;
  currentLabel: string;
  progressLabel: string;
  resultLabel?: string;
  status: TaskProgressStatus;
  statusLabel: string;
}

const taskSteps = [
  "初始化项目并理解需求",
  "规划页面结构和内容",
  "生成静态页面文件",
  "检查并准备交付"
] as const;
const fallbackTaskStep = taskSteps[0];

const activeRunStates = new Set([
  "queued",
  "running",
  "waiting_for_approval",
  "cancelling"
]);

export function buildTaskProgressViewModel({
  taskType,
  payload
}: {
  taskType?: string;
  payload?: TaskProgressPayload;
}): TaskProgressViewModel | undefined {
  if (taskType !== "lp_generation") {
    return undefined;
  }

  const artifactProgress = payload?.artifactProgress;
  const activeRun = payload?.runs?.find((run) => activeRunStates.has(String(run.state)));
  const activeStepIndex = getActiveStepIndex({
    activeRun: Boolean(activeRun),
    hasArtifacts: Boolean(artifactProgress?.artifactWorkspaceId),
    isTerminal: payload?.isTerminal,
    role: activeRun?.role
  });
  const status = getTaskProgressStatus({
    activeRun,
    hasArtifacts: Boolean(artifactProgress?.artifactWorkspaceId),
    isTerminal: payload?.isTerminal
  });

  return {
    activeStepIndex,
    currentLabel: taskSteps[activeStepIndex] ?? fallbackTaskStep,
    progressLabel: `${activeStepIndex + 1} / ${taskSteps.length}`,
    resultLabel: artifactProgress?.artifactWorkspaceId ? "页面文件已准备好" : undefined,
    status,
    statusLabel: getTaskProgressStatusLabel(status)
  };
}

function getActiveStepIndex({
  activeRun,
  hasArtifacts,
  isTerminal,
  role
}: {
  activeRun: boolean;
  hasArtifacts: boolean;
  isTerminal?: boolean;
  role?: string;
}): number {
  if (role === "builder") {
    return 2;
  }
  if (role === "planner") {
    return 1;
  }
  if (role === "reviewer" || role === "deployer") {
    return 3;
  }
  if (hasArtifacts || isTerminal || activeRun) {
    return 3;
  }
  return 0;
}

function getTaskProgressStatus({
  activeRun,
  hasArtifacts,
  isTerminal
}: {
  activeRun?: TaskProgressRun;
  hasArtifacts: boolean;
  isTerminal?: boolean;
}): TaskProgressStatus {
  if (activeRun?.state === "cancelling") {
    return "stopping";
  }
  if (activeRun) {
    return "running";
  }
  if (hasArtifacts || isTerminal) {
    return "complete";
  }
  return "idle";
}

function getTaskProgressStatusLabel(status: TaskProgressStatus): string {
  switch (status) {
    case "complete":
      return "已完成";
    case "running":
      return "处理中";
    case "stopping":
      return "正在停止";
    case "idle":
      return "准备中";
  }
}
