import type { LiveTaskStatePayload } from "../lib/workbench-store";

type TaskProgressRun = {
  runId?: string;
  role?: string;
  state?: string;
  startedAt?: string;
  completedAt?: string;
};

type TaskProgressArtifactProgress = {
  artifactWorkspaceId?: string;
  changedFileCount: number;
  fileCount: number;
  previewVersionKey?: string;
};

type TaskProgressRunEvent = LiveTaskStatePayload["runEvents"][number];
type TaskProgressSnapshot = LiveTaskStatePayload["snapshot"];

type TaskProgressPayload = Omit<
  Partial<LiveTaskStatePayload>,
  "artifactProgress" | "runEvents" | "runs" | "snapshot"
> & {
  artifactProgress?: TaskProgressArtifactProgress;
  runEvents?: TaskProgressRunEvent[];
  runs?: TaskProgressRun[];
  snapshot?: TaskProgressSnapshot;
};

export type TaskProgressStatus = "idle" | "running" | "complete" | "failed" | "stopping";
export type TaskNarrativeStatus = "pending" | "running" | "complete" | "failed";

export interface TaskProgressViewModel {
  activeStepIndex: number;
  currentLabel: string;
  progressLabel: string;
  resultLabel?: string;
  status: TaskProgressStatus;
  statusLabel: string;
}

export interface TaskNarrativeStepViewModel {
  id: string;
  title: string;
  body: string;
  status: TaskNarrativeStatus;
  statusLabel: string;
  chips: string[];
  details: TaskNarrativeDetailViewModel[];
  isCollapsed: boolean;
}

export interface TaskNarrativeDetailViewModel {
  id: string;
  title: string;
  description?: string;
  status: TaskNarrativeStatus;
}

export interface TaskNarrativeViewModel {
  activeStep?: TaskNarrativeStepViewModel;
  completedCount: number;
  steps: TaskNarrativeStepViewModel[];
  totalCount: number;
}

const taskSteps = [
  "初始化项目并理解需求",
  "规划页面结构和内容",
  "生成静态页面文件",
  "检查并准备交付"
] as const;
const fallbackTaskStep = taskSteps[0];

const taskNarrativeSteps = [
  {
    role: "planner",
    title: "理解需求并规划页面",
    pendingBody: "等待开始拆解目标、受众和核心卖点。",
    runningBody: "正在理解需求、拆分页面结构和核心卖点。",
    completeBody: "已形成页面目标、信息架构和交接上下文。"
  },
  {
    role: "builder",
    title: "生成静态 LP 文件",
    pendingBody: "等待接收规划结果并生成静态产物。",
    runningBody: "正在编写框架无关 HTML/CSS/JS。",
    completeBody: "已生成可预览的静态页面文件。"
  },
  {
    role: "reviewer",
    title: "检查页面质量",
    pendingBody: "等待生成完成后检查页面质量。",
    runningBody: "正在检查首屏、CTA、响应式和交付阻塞项。",
    completeBody: "页面质量检查已完成。"
  },
  {
    role: "deployer",
    title: "准备预览与交付",
    pendingBody: "等待质量检查通过后准备交付信息。",
    runningBody: "正在准备预览、导出和交付信息。",
    completeBody: "预览与导出已准备好。"
  }
] as const;

type TaskNarrativeRole = (typeof taskNarrativeSteps)[number]["role"];

const activeRunStates = new Set([
  "queued",
  "running",
  "waiting_for_approval",
  "cancelling"
]);
const failedRunStates = new Set(["failed", "blocked"]);

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
  const runs = payload?.runs ?? [];
  const activeRun = runs.find((run) => activeRunStates.has(String(run.state)));
  const failedRun = [...runs].reverse().find((run) => failedRunStates.has(String(run.state)));
  const hasArtifacts = Boolean(artifactProgress?.artifactWorkspaceId);
  const currentRun = activeRun ?? (hasArtifacts ? undefined : failedRun);
  const activeStepIndex = getActiveStepIndex({
    hasCurrentRun: Boolean(currentRun),
    hasArtifacts,
    isTerminal: payload?.isTerminal,
    role: currentRun?.role
  });
  const status = getTaskProgressStatus({
    activeRun,
    failedRun,
    hasArtifacts,
    isTerminal: payload?.isTerminal
  });

  return {
    activeStepIndex,
    currentLabel: taskSteps[activeStepIndex] ?? fallbackTaskStep,
    progressLabel: `${activeStepIndex + 1} / ${taskSteps.length}`,
    resultLabel:
      status === "complete" && artifactProgress?.artifactWorkspaceId
        ? "页面文件已准备好"
        : undefined,
    status,
    statusLabel: getTaskProgressStatusLabel(status)
  };
}

export function buildTaskNarrativeViewModel({
  taskType,
  payload
}: {
  taskType?: string;
  payload?: TaskProgressPayload;
}): TaskNarrativeViewModel | undefined {
  if (taskType !== "lp_generation" || !payload) {
    return undefined;
  }

  const artifactProgress = payload.artifactProgress;
  const runEvents = payload.runEvents ?? [];
  const runs = payload.runs ?? [];
  const hasActivity =
    runs.length > 0 ||
    runEvents.length > 0 ||
    Boolean(artifactProgress?.artifactWorkspaceId) ||
    Boolean(payload.snapshot?.currentPageVersion) ||
    Boolean(payload.snapshot?.deployment);

  if (!hasActivity) {
    return undefined;
  }

  const latestRunByRole = getLatestRunByNarrativeRole(runs);
  const activeNarrativeStepIndex = getActiveNarrativeStepIndex(latestRunByRole);
  const highestStartedStepIndex = getHighestStartedNarrativeStepIndex({
    artifactProgress,
    latestRunByRole,
    runEvents,
    snapshot: payload.snapshot
  });
  const steps = taskNarrativeSteps.map((step, index) => {
    const role = step.role;
    const roleEvents = runEvents.filter((event) => eventBelongsToRole(event, role));
    const status = getNarrativeStatus({
      artifactProgress,
      activeNarrativeStepIndex,
      highestStartedStepIndex,
      index,
      role,
      run: latestRunByRole.get(role),
      runEvents,
      snapshot: payload.snapshot
    });
    return {
      id: role,
      title: step.title,
      body: getNarrativeBody({
        roleEvents,
        status,
        step
      }),
      status,
      statusLabel: getNarrativeStatusLabel(status),
      chips: buildNarrativeChips({
        artifactProgress,
        role,
        runEvents,
        snapshot: payload.snapshot
      }),
      details: buildNarrativeDetails({
        artifactProgress,
        role,
        roleEvents,
        snapshot: payload.snapshot,
        status
      }),
      isCollapsed: status !== "running" && status !== "failed"
    };
  });

  return {
    activeStep: steps.find((step) => step.status === "running"),
    completedCount: steps.filter((step) => step.status === "complete").length,
    steps,
    totalCount: steps.length
  };
}

function getActiveStepIndex({
  hasCurrentRun,
  hasArtifacts,
  isTerminal,
  role
}: {
  hasCurrentRun: boolean;
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
  if (hasArtifacts || isTerminal || hasCurrentRun) {
    return 3;
  }
  return 0;
}

function getTaskProgressStatus({
  activeRun,
  failedRun,
  hasArtifacts,
  isTerminal
}: {
  activeRun?: TaskProgressRun;
  failedRun?: TaskProgressRun;
  hasArtifacts: boolean;
  isTerminal?: boolean;
}): TaskProgressStatus {
  if (activeRun?.state === "cancelling") {
    return "stopping";
  }
  if (activeRun) {
    return "running";
  }
  if (failedRun && !hasArtifacts) {
    return "failed";
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
    case "failed":
      return "失败";
    case "running":
      return "处理中";
    case "stopping":
      return "正在停止";
    case "idle":
      return "准备中";
  }
}

function getLatestRunByNarrativeRole(
  runs: TaskProgressRun[]
): Map<TaskNarrativeRole, TaskProgressRun> {
  const latestRunByRole = new Map<TaskNarrativeRole, TaskProgressRun>();
  for (const run of runs) {
    const role = toNarrativeRole(run.role);
    if (!role) {
      continue;
    }
    const existing = latestRunByRole.get(role);
    if (!existing || compareProgressRuns(run, existing) > 0) {
      latestRunByRole.set(role, run);
    }
  }
  return latestRunByRole;
}

function compareProgressRuns(left: TaskProgressRun, right: TaskProgressRun): number {
  return (
    (left.startedAt ?? "").localeCompare(right.startedAt ?? "") ||
    (left.completedAt ?? "").localeCompare(right.completedAt ?? "") ||
    (left.runId ?? "").localeCompare(right.runId ?? "")
  );
}

function getHighestStartedNarrativeStepIndex({
  artifactProgress,
  latestRunByRole,
  runEvents,
  snapshot
}: {
  artifactProgress?: TaskProgressArtifactProgress;
  latestRunByRole: Map<TaskNarrativeRole, TaskProgressRun>;
  runEvents: TaskProgressRunEvent[];
  snapshot?: TaskProgressSnapshot;
}): number {
  return taskNarrativeSteps.reduce((highestIndex, step, index) => {
    if (
      latestRunByRole.has(step.role) ||
      runEvents.some((event) => eventBelongsToRole(event, step.role)) ||
      hasNarrativeCompletionEvidence({
        artifactProgress,
        role: step.role,
        runEvents,
        snapshot
      })
    ) {
      return index;
    }
    return highestIndex;
  }, -1);
}

function getNarrativeStatus({
  artifactProgress,
  activeNarrativeStepIndex,
  highestStartedStepIndex,
  index,
  role,
  run,
  runEvents,
  snapshot
}: {
  artifactProgress?: TaskProgressArtifactProgress;
  activeNarrativeStepIndex: number;
  highestStartedStepIndex: number;
  index: number;
  role: TaskNarrativeRole;
  run?: TaskProgressRun;
  runEvents: TaskProgressRunEvent[];
  snapshot?: TaskProgressSnapshot;
}): TaskNarrativeStatus {
  if (run && activeRunStates.has(String(run.state))) {
    return "running";
  }
  if (activeNarrativeStepIndex >= 0) {
    if (index > activeNarrativeStepIndex) {
      return "pending";
    }
    if (index < activeNarrativeStepIndex) {
      return "complete";
    }
  }
  if (
    run &&
    failedRunStates.has(String(run.state)) &&
    !hasNarrativeCompletionEvidence({ artifactProgress, role, runEvents, snapshot })
  ) {
    return "failed";
  }
  if (
    run?.state === "completed" ||
    index < highestStartedStepIndex ||
    hasNarrativeCompletionEvidence({ artifactProgress, role, runEvents, snapshot })
  ) {
    return "complete";
  }
  return "pending";
}

function getActiveNarrativeStepIndex(
  latestRunByRole: Map<TaskNarrativeRole, TaskProgressRun>
): number {
  return taskNarrativeSteps.findIndex((step) => {
    const run = latestRunByRole.get(step.role);
    return run !== undefined && activeRunStates.has(String(run.state));
  });
}

function hasNarrativeCompletionEvidence({
  artifactProgress,
  role,
  runEvents,
  snapshot
}: {
  artifactProgress?: TaskProgressArtifactProgress;
  role: TaskNarrativeRole;
  runEvents: TaskProgressRunEvent[];
  snapshot?: TaskProgressSnapshot;
}): boolean {
  if (role === "builder" && Boolean(artifactProgress?.artifactWorkspaceId)) {
    return true;
  }
  if (role === "deployer" && Boolean(snapshot?.deployment)) {
    return true;
  }

  const completionEventsByRole: Record<TaskNarrativeRole, string[]> = {
    planner: ["model.output.parsed", "handoff.created"],
    builder: ["artifact.created", "artifact.workspace.created", "handoff.created"],
    reviewer: ["review.completed", "handoff.created"],
    deployer: ["run.completed"]
  };
  return hasRoleEventType(runEvents, role, completionEventsByRole[role]);
}

function getNarrativeBody({
  roleEvents,
  status,
  step
}: {
  roleEvents: TaskProgressRunEvent[];
  status: TaskNarrativeStatus;
  step: (typeof taskNarrativeSteps)[number];
}): string {
  switch (status) {
    case "complete":
      return step.completeBody;
    case "failed":
      return getNarrativeFailureBody(roleEvents);
    case "running": {
      if (
        hasRoleEvent(roleEvents, "model.stream.completed") ||
        hasRoleEvent(roleEvents, "model.completed")
      ) {
        return "模型响应已完成，正在校验输出并准备下一步。";
      }
      const latestProgress = getLatestStreamProgress(roleEvents);
      if (latestProgress?.chunkCount) {
        return "正在接收模型响应，安全进度会持续更新。";
      }
      if (hasRoleEvent(roleEvents, "model.stream.started")) {
        return "模型响应流已连接，正在等待内容。";
      }
      return step.runningBody;
    }
    case "pending":
      return step.pendingBody;
  }
}

function getNarrativeFailureBody(roleEvents: TaskProgressRunEvent[]): string {
  const errorCode = getLatestNarrativeErrorCode(roleEvents);
  switch (errorCode) {
    case "model_provider_request_timeout":
      return "模型响应超时，已停止生成。可以重试，或换用响应更快的模型。";
    case "model_provider_http_error":
      return "模型服务返回错误，已停止生成。可以稍后重试。";
    case "model_provider_api_key_missing":
      return "模型密钥缺失，已停止生成。请检查项目模型配置。";
    default:
      return "这一阶段失败，可稍后重试或继续恢复。";
  }
}

function getNarrativeStatusLabel(status: TaskNarrativeStatus): string {
  switch (status) {
    case "complete":
      return "完成";
    case "failed":
      return "失败";
    case "running":
      return "进行中";
    case "pending":
      return "等待中";
  }
}

function buildNarrativeChips({
  artifactProgress,
  role,
  runEvents,
  snapshot
}: {
  artifactProgress?: TaskProgressArtifactProgress;
  role: TaskNarrativeRole;
  runEvents: TaskProgressRunEvent[];
  snapshot?: TaskProgressSnapshot;
}): string[] {
  const roleEvents = runEvents.filter((event) => eventBelongsToRole(event, role));
  const chips: string[] = [];
  addChip(chips, roleEvents.some((event) => event.type === "runtime.context.loaded"), "上下文已装载");
  addChip(chips, roleEvents.some((event) => event.type === "handoff.consumed"), "接收上一步结果");
  addChip(chips, roleEvents.some((event) => event.type === "model.stream.started"), "模型流已连接");
  const latestStreamProgress = getLatestStreamProgress(roleEvents);
  addChip(
    chips,
    latestStreamProgress !== undefined &&
      !roleEvents.some((event) => event.type === "model.stream.completed"),
    "流式响应中"
  );
  addChip(chips, roleEvents.some((event) => event.type === "model.stream.completed"), "模型流已完成");
  addChip(chips, roleEvents.some((event) => event.type === "model.completed"), "模型已响应");
  addChip(chips, roleEvents.some((event) => event.type === "model.retry.scheduled"), "模型重试中");
  addChip(chips, hasNarrativeErrorCode(roleEvents, "model_provider_request_timeout"), "模型响应超时");
  addChip(chips, roleEvents.some((event) => event.type === "model.retry.exhausted"), "已重试");
  addChip(
    chips,
    roleEvents.some((event) => event.type === "model.output.repair_started"),
    "正在修复输出"
  );
  addChip(
    chips,
    roleEvents.some((event) => event.type === "model.output.repaired"),
    "输出已修复"
  );
  addChip(chips, roleEvents.some((event) => event.type === "handoff.created"), "已交接下一步");
  addChip(chips, roleEvents.some((event) => event.type === "review.completed"), "检查已完成");

  const fileCount = role === "builder"
    ? getNarrativeArtifactFileCount({ artifactProgress, roleEvents })
    : undefined;
  addChip(chips, fileCount !== undefined && fileCount > 0, `文件已生成：${fileCount ?? 0} 个`);
  addChip(chips, role === "deployer" && Boolean(snapshot?.deployment), "交付已准备");

  return chips.slice(0, 7);
}

function buildNarrativeDetails({
  artifactProgress,
  role,
  roleEvents,
  snapshot,
  status
}: {
  artifactProgress?: TaskProgressArtifactProgress;
  role: TaskNarrativeRole;
  roleEvents: TaskProgressRunEvent[];
  snapshot?: TaskProgressSnapshot;
  status: TaskNarrativeStatus;
}): TaskNarrativeDetailViewModel[] {
  const details: TaskNarrativeDetailViewModel[] = [];
  details.push({
    id: `${role}-context`,
    title: "装载任务上下文",
    status: getDetailStatus({
      complete: hasRoleEvent(roleEvents, "runtime.context.loaded"),
      status
    })
  });

  if (role !== "planner") {
    details.push({
      id: `${role}-handoff`,
      title: "接收上一阶段结果",
      status: getDetailStatus({
        complete: hasRoleEvent(roleEvents, "handoff.consumed"),
        status
      })
    });
  }

  const latestStreamProgress = getLatestStreamProgress(roleEvents);
  details.push({
    id: `${role}-stream`,
    title: "接收模型流式响应",
    ...(latestStreamProgress
      ? {
          description: hasRoleEvent(roleEvents, "model.stream.completed")
            ? "安全响应已接收完成。"
            : "正在持续接收安全响应。"
        }
      : {}),
    status: getDetailStatus({
      complete: hasRoleEvent(roleEvents, "model.stream.completed") ||
        hasRoleEvent(roleEvents, "model.completed"),
      running: hasRoleEvent(roleEvents, "model.stream.started") ||
        latestStreamProgress !== undefined,
      status
    })
  });

  details.push(...buildRoleSpecificNarrativeDetails({
    artifactProgress,
    role,
    roleEvents,
    snapshot,
    status
  }));

  return details;
}

function buildRoleSpecificNarrativeDetails({
  artifactProgress,
  role,
  roleEvents,
  snapshot,
  status
}: {
  artifactProgress?: TaskProgressArtifactProgress;
  role: TaskNarrativeRole;
  roleEvents: TaskProgressRunEvent[];
  snapshot?: TaskProgressSnapshot;
  status: TaskNarrativeStatus;
}): TaskNarrativeDetailViewModel[] {
  if (role === "planner") {
    return [
      {
        id: "planner-parse",
        title: "整理页面目标与卖点",
        status: getDetailStatus({
          complete: hasRoleEvent(roleEvents, "model.output.parsed") ||
            hasRoleEvent(roleEvents, "model.output.repaired"),
          running: hasRoleEvent(roleEvents, "model.completed"),
          status
        })
      },
      {
        id: "planner-handoff",
        title: "交接页面规划",
        status: getDetailStatus({
          complete: hasRoleEvent(roleEvents, "handoff.created"),
          running: hasRoleEvent(roleEvents, "model.output.parsed") ||
            hasRoleEvent(roleEvents, "model.output.repaired"),
          status
        })
      }
    ];
  }

  if (role === "builder") {
    const fileCount = getNarrativeArtifactFileCount({ artifactProgress, roleEvents });
    return [
      {
        id: "builder-validate",
        title: "校验静态文件结构",
        status: getDetailStatus({
          complete: hasRoleEvent(roleEvents, "model.output.parsed") ||
            hasRoleEvent(roleEvents, "model.output.repaired"),
          running: hasRoleEvent(roleEvents, "model.completed"),
          status
        })
      },
      {
        id: "builder-files",
        title: "写入静态页面文件",
        ...(fileCount ? { description: `已准备 ${fileCount} 个文件。` } : {}),
        status: getDetailStatus({
          complete: Boolean(artifactProgress?.artifactWorkspaceId) ||
            hasRoleEvent(roleEvents, "artifact.workspace.created"),
          running: hasRoleEvent(roleEvents, "model.output.parsed") ||
            hasRoleEvent(roleEvents, "model.output.repaired"),
          status
        })
      }
    ];
  }

  if (role === "reviewer") {
    return [
      {
        id: "reviewer-checks",
        title: "检查首屏、CTA 和响应式",
        status: getDetailStatus({
          complete: hasRoleEvent(roleEvents, "review.completed"),
          running: hasRoleEvent(roleEvents, "model.completed"),
          status
        })
      },
      {
        id: "reviewer-delivery-readiness",
        title: "确认交付是否可继续",
        status: getDetailStatus({
          complete: hasRoleEvent(roleEvents, "handoff.created"),
          running: hasRoleEvent(roleEvents, "review.completed"),
          status
        })
      }
    ];
  }

  return [
    {
      id: "deployer-preview",
      title: "准备预览和导出",
      status: getDetailStatus({
        complete: Boolean(snapshot?.deployment) || hasRoleEvent(roleEvents, "run.completed"),
        running: hasRoleEvent(roleEvents, "model.completed"),
        status
      })
    }
  ];
}

function getDetailStatus({
  complete,
  running = false,
  status
}: {
  complete: boolean;
  running?: boolean;
  status: TaskNarrativeStatus;
}): TaskNarrativeStatus {
  if (complete) {
    return "complete";
  }
  if (status === "failed") {
    return "failed";
  }
  if (running || status === "running") {
    return "running";
  }
  return "pending";
}

function getNarrativeArtifactFileCount({
  artifactProgress,
  roleEvents
}: {
  artifactProgress?: TaskProgressArtifactProgress;
  roleEvents: TaskProgressRunEvent[];
}): number | undefined {
  const eventCount = [...roleEvents]
    .reverse()
    .find((event) => event.type === "artifact.workspace.created" && event.payload?.fileCount)
    ?.payload?.fileCount;
  return eventCount ?? artifactProgress?.fileCount;
}

function getLatestNarrativeErrorCode(
  roleEvents: TaskProgressRunEvent[]
): string | undefined {
  return [...roleEvents]
    .reverse()
    .find((event) => typeof event.payload?.errorCode === "string")
    ?.payload?.errorCode;
}

function getLatestStreamProgress(
  roleEvents: TaskProgressRunEvent[]
): { chunkCount: number; receivedChars?: number } | undefined {
  const progress = [...roleEvents]
    .reverse()
    .find((event) => event.type === "model.stream.progress");
  const chunkCount = progress?.payload?.chunkCount;
  if (typeof chunkCount !== "number" || chunkCount < 1) {
    return undefined;
  }
  const receivedChars = progress?.payload?.receivedChars;
  return {
    chunkCount,
    ...(typeof receivedChars === "number" && receivedChars > 0 ? { receivedChars } : {})
  };
}

function hasRoleEvent(roleEvents: TaskProgressRunEvent[], type: string): boolean {
  return roleEvents.some((event) => event.type === type);
}

function hasNarrativeErrorCode(
  roleEvents: TaskProgressRunEvent[],
  errorCode: string
): boolean {
  return roleEvents.some((event) => event.payload?.errorCode === errorCode);
}

function addChip(chips: string[], condition: boolean, label: string): void {
  if (condition && !chips.includes(label)) {
    chips.push(label);
  }
}

function hasRoleEventType(
  events: TaskProgressRunEvent[],
  role: TaskNarrativeRole,
  eventTypes: string[]
): boolean {
  return events.some(
    (event) => eventTypes.includes(event.type) && eventBelongsToRole(event, role)
  );
}

function eventBelongsToRole(
  event: TaskProgressRunEvent,
  role: TaskNarrativeRole
): boolean {
  return event.payload?.role === role || event.runId.startsWith(`run_${role}_`);
}

function toNarrativeRole(role: string | undefined): TaskNarrativeRole | undefined {
  return taskNarrativeSteps.some((step) => step.role === role)
    ? (role as TaskNarrativeRole)
    : undefined;
}
