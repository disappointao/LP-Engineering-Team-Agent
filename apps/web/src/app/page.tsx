import React from "react";
import { headers } from "next/headers";
import Link from "next/link";
import {
  bindSkillVersionAction,
  createMCPConnectorAction,
  createProjectAction,
  executeMCPToolAction,
  executeRunRecoveryAction,
  executeSkillCommandAction,
  runLocalWorkerOnceAction,
  createModelProviderAction,
  createSkillDraftAction,
  publishSkillVersionAction,
  interruptCurrentTaskAction,
  setMCPConnectorEnabledAction,
  setMCPToolApprovalAction,
  setModelProviderEnabledAction,
  setSkillBindingEnabledAction,
  submitPromptAction,
  upsertProjectModelRouteAction,
  validateSkillVersionAction
} from "./actions";
import { LPPreview } from "../components/lp-preview";
import {
  createChatWorkbenchThread,
  createGeneralTaskThread,
  type ChatToolEvent
} from "../lib/chat-workbench";
import {
  createArtifactDownloadLinks,
  type ArtifactDownloadLink
} from "../lib/export-links";
import { getWorkbenchCopy, resolveLocaleFromAcceptLanguage } from "../lib/i18n";
import {
  getWebWorkbenchStore,
  type InterruptFlowErrorCode,
  type MCPFlowErrorCode,
  type ModelFlowErrorCode,
  type ProjectMCPState,
  type ProjectFlowErrorCode,
  type RunRecoveryFlowErrorCode,
  type SkillFlowErrorCode,
  type WebArtifactDiffState,
  type WebProjectModelState,
  type WorkerQueueFlowErrorCode,
  type WorkbenchPageState
} from "../lib/workbench-store";
import { getCurrentProjectId, getCurrentTaskId } from "../lib/workbench-session";
import { LiveTaskPanel } from "./live-task-panel";
import { ManagementSubmitButton } from "./management-submit-button";
import { buildMCPManagementViewModel } from "./mcp-management-view-model";
import {
  buildRunTimelineViewModel,
  type RunTimelineStepView
} from "./run-timeline-view-model";
import {
  buildModelsManagementViewModel,
  buildSkillsManagementViewModel,
  type ModelManagementRouteRow,
  modelManagementRoleOrder,
  toModelManagementNotice,
  toSkillManagementNotice
} from "./skills-models-management-view-model";
import { AgentDetailsDisclosure } from "./agent-details-disclosure";
import { ChatMessageContent } from "./chat-message-content";
import { StreamingWorkbench } from "./streaming-workbench";

type PageSearchParamValue = string | string[] | undefined;
type PageSearchParams = Record<string, PageSearchParamValue>;

interface HomePageProps {
  searchParams?: Promise<PageSearchParams>;
}

type MCPManagementViewModel = ReturnType<typeof buildMCPManagementViewModel>;

function QuickPromptForm({
  className,
  implicitProjectName,
  prompt,
  projectId,
  taskId
}: {
  className: string;
  implicitProjectName: string;
  prompt: string;
  projectId?: string;
  taskId?: string;
}) {
  return (
    <form action={submitPromptAction} className={className}>
      <input name="prompt" type="hidden" value={prompt} />
      <input name="implicitProjectName" type="hidden" value={implicitProjectName} />
      {projectId ? <input name="projectId" type="hidden" value={projectId} /> : null}
      {taskId ? <input name="taskId" type="hidden" value={taskId} /> : null}
      <button type="submit">{prompt}</button>
    </form>
  );
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const requestHeaders = await headers();
  const copy = getWorkbenchCopy(
    resolveLocaleFromAcceptLanguage(requestHeaders.get("accept-language"))
  );
  const params = await searchParams;
  const view = getFirstSearchParam(params?.view);
  const artifactPath = getFirstSearchParam(params?.artifactPath);
  const activeView =
    view === "artifacts"
      ? "artifacts"
      : view === "skills"
        ? "skills"
        : view === "models"
          ? "models"
          : view === "mcp"
            ? "mcp"
            : "workbench";
  const errorCode = toProjectFlowError(getFirstSearchParam(params?.error));
  const skillError = toSkillFlowError(getFirstSearchParam(params?.skillError));
  const modelError = toModelFlowError(getFirstSearchParam(params?.modelError));
  const mcpError = toMCPFlowError(getFirstSearchParam(params?.mcpError));
  const interruptError = toInterruptFlowError(getFirstSearchParam(params?.interruptError));
  const recoveryError = toRunRecoveryFlowError(getFirstSearchParam(params?.recoveryError));
  const workerError = parseWorkerQueueError(getFirstSearchParam(params?.workerError));
  const skillNotice = toSkillManagementNotice(getFirstSearchParam(params?.skillNotice));
  const modelNotice = toModelManagementNotice(getFirstSearchParam(params?.modelNotice));
  const requestedProjectId = getFirstSearchParam(params?.projectId);
  const requestedTaskId = getFirstSearchParam(params?.taskId);
  const requestedNewTask = getFirstSearchParam(params?.newTask) === "1";
  const hasProjectParam = requestedProjectId !== undefined;
  const hasTaskParam = requestedTaskId !== undefined;
  const previewSearchParams = createArtifactPreviewSearchParams({
    activeView,
    errorCode,
    interruptError,
    modelError,
    modelNotice,
    recoveryError,
    skillNotice,
    skillError,
    workerError
  });
  const cookieProjectId = await getCurrentProjectId();
  const cookieTaskId = await getCurrentTaskId();
  const currentProjectId = requestedProjectId ?? cookieProjectId;
  const currentTaskId =
    requestedNewTask || (hasProjectParam && !hasTaskParam)
      ? undefined
      : requestedTaskId ?? cookieTaskId;
  const store = await getWebWorkbenchStore();
  const pageState = await store.getPageState({
    projectId: currentProjectId,
    taskId: currentTaskId,
    artifactPath
  });
  const modelState = getPageModelState(pageState);
  const mcpState = getPageMCPState(pageState);
  const mcpManagement = buildMCPManagementViewModel({ copy, mcpState });
  const activeTask = pageState.kind === "task_ready" ? pageState.task : undefined;
  const activeProject =
    pageState.kind === "task_ready" && pageState.snapshot
      ? pageState.snapshot.project
      : pageState.projects.find((project) => project.id === currentProjectId) ??
        pageState.projects.find((project) => project.id === activeTask?.projectId);
  const activeWorkbenchHref = createWorkbenchHref({
    projectId: activeProject?.id,
    taskId: activeTask?.id
  });
  const projectNameById = new Map(pageState.projects.map((project) => [project.id, project.name]));
  const errorMessage = errorCode ? copy.projectFlow.errors[errorCode] : undefined;
  const skillErrorMessage = skillError ? copy.skillsView.errors[skillError] : undefined;
  const workerErrorMessage = workerError
    ? copy.skillsView.workerErrors[workerError]
    : undefined;
  const mcpErrorMessage = mcpError ? copy.mcpView.errors[mcpError] : undefined;
  const modelErrorMessage = modelError
    ? copy.modelsView.errors[modelError]
    : modelState.resolutionError
      ? copy.modelsView.errors[modelState.resolutionError]
      : undefined;
  const interruptErrorMessage = interruptError
    ? copy.interruptFlow.errors[interruptError]
    : undefined;
  const recoveryErrorMessage = recoveryError ? copy.chat.recoveryErrorLabel : undefined;
  const assistantModelRoute = modelState.resolvedPolicy.assistant;
  const assistantModelLabel = copy.chat.assistantModelRoute(
    `${assistantModelRoute.provider}/${assistantModelRoute.model}`
  );
  const boundSkillVersionIds = new Set(
    pageState.skills.boundSkills.map((boundSkill) => boundSkill.version.id)
  );
  const currentPageVersionId =
    pageState.kind === "task_ready"
      ? pageState.snapshot?.currentPageVersion?.id
      : undefined;
  const skillCommands = pageState.skillCommands ?? [];
  const workerQueue = getPageWorkerQueueState(pageState);
  const workerQueueCountItems = (
    Object.keys(copy.skillsView.workerQueueCounts) as Array<
      keyof typeof copy.skillsView.workerQueueCounts
    >
  ).map((key) => ({
    key,
    label: copy.skillsView.workerQueueCounts[key],
    value: workerQueue.counts[key]
  }));
  const workerHeartbeat = workerQueue.heartbeat;
  const skillsManagement = buildSkillsManagementViewModel({
    copy,
    skillState: pageState.skills,
    skillCommands,
    ...(skillNotice ? { notice: skillNotice } : {})
  });
  const modelsManagement = buildModelsManagementViewModel({
    copy,
    modelState,
    ...(modelNotice ? { notice: modelNotice } : {})
  });
  const activeSkillLabel = copy.skillsView.activeCount(skillsManagement.activeSkillCount);
  const completedSnapshot =
    pageState.kind === "task_ready" &&
    activeTask?.type === "lp_generation" &&
    pageState.snapshot?.brief &&
    pageState.snapshot.currentPageVersion
      ? {
          brief: pageState.snapshot.brief,
          pageVersion: pageState.snapshot.currentPageVersion
        }
      : undefined;
  const downloadLinks = completedSnapshot
    ? createArtifactDownloadLinks(completedSnapshot.pageVersion.artifacts, copy.exports)
    : undefined;
  const chat =
    pageState.kind === "task_ready"
      ? completedSnapshot && downloadLinks
        ? createChatWorkbenchThread({
            copy,
            prompt: completedSnapshot.brief.prompt,
            objective: completedSnapshot.brief.brief.objective,
            pageVersion: completedSnapshot.pageVersion,
            downloadLinks,
            messages: pageState.messages,
            runEvents: pageState.runEvents
          })
        : createGeneralTaskThread({
            copy,
            messages: pageState.messages,
            userMessage:
              pageState.messages.find((message) => message.role === "user")?.content ??
              pageState.task.title,
            assistantMessage:
              pageState.messages.find((message) => message.role === "assistant")?.content ??
              copy.chat.generalToolOperation
          })
      : undefined;
  const composer = chat?.composer ?? {
    placeholder: copy.chat.composerPlaceholder,
    addAttachmentLabel: copy.chat.addAttachmentLabel,
    runtimeChip: copy.chat.runtimeChip,
    interruptLabel: copy.chat.interruptLabel,
    sendLabel: copy.chat.sendLabel
  };
  const streamingTaskId =
    pageState.kind === "task_ready" && pageState.task.type === "general_chat"
      ? pageState.task.id
      : undefined;
  const liveTaskId =
    pageState.kind === "task_ready" && pageState.task.type === "lp_generation"
      ? pageState.task.id
      : undefined;
  const initialPreviewVersionKey =
    pageState.kind === "task_ready" && pageState.artifactDiff
      ? [
          pageState.artifactDiff.pageVersionId,
          pageState.artifactDiff.artifactWorkspaceId ?? "no-workspace",
          ...pageState.artifactDiff.files.map(
            (file) => `${file.path}:${file.shortSha256 ?? "no-hash"}`
          )
        ].join("|")
      : undefined;
  const liveTaskCopy = {
    liveTaskArtifactReady: copy.chat.liveTaskArtifactReady,
    liveTaskCompleted: copy.chat.liveTaskCompleted,
    liveTaskIdle: copy.chat.liveTaskIdle,
    liveTaskRefreshError: copy.chat.liveTaskRefreshError,
    liveTaskRunning: copy.chat.liveTaskRunning,
    liveTaskTitle: copy.chat.liveTaskTitle,
    recoveryStateLabels: copy.chat.recoveryStateLabels,
    roleLabels: copy.modelsView.roleLabels
  };

  return (
    <main className="appShell">
      <aside className="sidebar" aria-label={copy.nav.label}>
        <div className="sidebarTop">
          <div className="brandBlock">
            <div className="brandMark">LP</div>
            <div>
              <div className="brand">{copy.sidebar.team}</div>
              <p>{copy.sidebar.mode}</p>
            </div>
          </div>
          <Link
            className="sidebarAction"
            href={createWorkbenchHref({ projectId: activeProject?.id, newTask: true })}
          >
            {copy.sidebar.newTask}
          </Link>
        </div>

        <nav className="navList" aria-label={copy.nav.label}>
          <Link
            aria-current={activeView === "workbench" ? "page" : undefined}
            className={activeView === "workbench" ? "navItem navItemActive" : "navItem"}
            href={activeWorkbenchHref}
          >
            {copy.nav.workbench}
          </Link>
          <Link
            aria-current={activeView === "artifacts" ? "page" : undefined}
            className={activeView === "artifacts" ? "navItem navItemActive" : "navItem"}
            href={createWorkbenchHref({
              projectId: activeProject?.id,
              taskId: activeTask?.id,
              view: "artifacts"
            })}
          >
            {copy.nav.artifacts}
          </Link>
          <Link
            aria-current={activeView === "skills" ? "page" : undefined}
            className={activeView === "skills" ? "navItem navItemActive" : "navItem"}
            href={createWorkbenchHref({
              projectId: activeProject?.id,
              taskId: activeTask?.id,
              view: "skills"
            })}
          >
            {copy.nav.skills}
          </Link>
          <Link
            aria-current={activeView === "models" ? "page" : undefined}
            className={activeView === "models" ? "navItem navItemActive" : "navItem"}
            href={createWorkbenchHref({
              projectId: activeProject?.id,
              taskId: activeTask?.id,
              view: "models"
            })}
          >
            {copy.nav.models}
          </Link>
          <Link
            aria-current={activeView === "mcp" ? "page" : undefined}
            className={activeView === "mcp" ? "navItem navItemActive" : "navItem"}
            href={createWorkbenchHref({
              projectId: activeProject?.id,
              taskId: activeTask?.id,
              view: "mcp"
            })}
          >
            {copy.nav.mcp}
          </Link>
        </nav>

        <div className="sidebarSection">
          <div className="sidebarSectionTitle">{copy.sidebar.projectsLabel}</div>
          {pageState.projects.length > 0
            ? pageState.projects.map((project) => (
                <Link
                  aria-current={project.id === activeProject?.id ? "page" : undefined}
                  className={
                    project.id === activeProject?.id
                      ? "projectItem projectItemActive projectSelectButton"
                      : "projectItem projectSelectButton"
                  }
                  href={createWorkbenchHref({ projectId: project.id })}
                  key={project.id}
                >
                  <strong>{project.name}</strong>
                </Link>
              ))
            : null}
          <div className="projectItem">
            <strong>{copy.projectFlow.createTitle}</strong>
            <form action={createProjectAction} className="sidebarProjectForm">
              <input
                aria-label={copy.projectFlow.projectNameLabel}
                name="projectName"
                placeholder={copy.projectFlow.projectNamePlaceholder}
              />
              <button type="submit">{copy.projectFlow.createProject}</button>
            </form>
          </div>
        </div>

        {activeProject
          ? ProjectMembersBlock({
              members: pageState.projectMembers ?? [],
              copy: copy.collaboration
            })
          : null}

        <div className="sidebarSection sidebarTasks">
          <div className="sidebarSectionTitle">{copy.sidebar.tasksLabel}</div>
          {pageState.tasks.length > 0
            ? pageState.tasks.map((task) => (
                <Link
                  aria-current={task.id === activeTask?.id ? "page" : undefined}
                  className={task.id === activeTask?.id ? "taskItem taskItemActive" : "taskItem"}
                  href={createWorkbenchHref({
                    projectId: task.projectId,
                    taskId: task.id
                  })}
                  key={task.id}
                >
                  <span className="taskTitle">{task.title}</span>
                  {task.projectId ? (
                    <span className="taskProjectLabel">
                      {projectNameById.get(task.projectId) ?? task.projectId}
                    </span>
                  ) : null}
                </Link>
              ))
            : <p className="sidebarEmptyState">{copy.sidebar.emptyTasks}</p>}
        </div>

        <div className="sidebarMeta">
          <span>{copy.sidebar.modeLabel}</span>
          <strong>{copy.sidebar.mode}</strong>
          <span>{copy.sidebar.localeLabel}</span>
          <strong>{copy.localeName}</strong>
        </div>
      </aside>

      <section
        className="chatWorkspace"
        aria-label={
          activeView === "artifacts"
            ? copy.nav.artifacts
            : activeView === "skills"
            ? copy.nav.skills
            : activeView === "models"
              ? copy.nav.models
              : activeView === "mcp"
                ? copy.nav.mcp
                : copy.nav.workbench
        }
      >
        <header className="topBar">
          <div className="topBarTitle">
            <strong>{copy.chat.topbarModel}</strong>
            <span>{activeProject?.name ?? activeTask?.title ?? copy.sidebar.newTask}</span>
            {skillsManagement.activeSkillCount > 0 ? (
              <span className="skillRuntimeChip">{activeSkillLabel}</span>
            ) : null}
            {activeView === "workbench" ? (
              <span className="modelRuntimeChip">{assistantModelLabel}</span>
            ) : null}
          </div>
        </header>

        {activeView !== "workbench" ? (
          <div className="conversationViewport">
            <div className="conversationStack">
              {activeView === "artifacts"
                ? ArtifactWorkspaceView({
                    completedSnapshot,
                    copy,
                    downloadLinks,
                    initialPreviewVersionKey,
                    liveTaskCopy,
                    pageState,
                    previewSearchParams
                  })
                : null}

              {activeView === "skills" ? (
                <section className="skillsView" aria-labelledby="skills-title">
                  <header className="skillsHeader">
                    <div>
                      <h1 id="skills-title">{copy.skillsView.title}</h1>
                      <p>{copy.skillsView.subtitle}</p>
                    </div>
                    <span>{activeSkillLabel}</span>
                  </header>

                {skillErrorMessage ? (
                  <div className="formError" role="alert">{skillErrorMessage}</div>
                ) : null}

                {skillsManagement.noticeMessage ? (
                  <div className="formNotice" role="status">{skillsManagement.noticeMessage}</div>
                ) : null}

                <section className="managementSummary" aria-labelledby="skills-runtime-summary-title">
                  <div>
                    <h2 id="skills-runtime-summary-title">
                      {copy.skillsView.management.runtimeSummaryTitle}
                    </h2>
                    <p>{skillsManagement.runtimeSummary}</p>
                  </div>
                  <ul>
                    {copy.skillsView.management.policyItems.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>

                <div className="skillsProjectContext">
                  <span>{copy.skillsView.activeProjectLabel}</span>
                  <strong>{activeProject?.name ?? copy.skillsView.noProject}</strong>
                </div>
                <p className="alphaBoundaryNote">{copy.skillsView.alphaNotice}</p>

                {activeProject ? (
                  <>
                    <form action={createSkillDraftAction} className="skillEditor">
                      <h2>{copy.skillsView.createTitle}</h2>
                      <label htmlFor="manifestJson">{copy.skillsView.manifestLabel}</label>
                      <textarea
                        id="manifestJson"
                        name="manifestJson"
                        placeholder={copy.skillsView.manifestPlaceholder}
                      />
                      <label htmlFor="content">{copy.skillsView.contentLabel}</label>
                      <textarea
                        id="content"
                        name="content"
                        placeholder={copy.skillsView.contentPlaceholder}
                      />
                      <label htmlFor="contentFile">{copy.skillsView.contentFileLabel}</label>
                      <input
                        id="contentFile"
                        name="contentFile"
                        type="file"
                        accept=".md,.markdown,.txt,text/markdown,text/plain"
                      />
                      <label htmlFor="contentType">{copy.skillsView.contentTypeLabel}</label>
                      <select id="contentType" name="contentType" defaultValue="text/markdown">
                        <option value="text/markdown">{copy.skillsView.markdown}</option>
                        <option value="text/plain">{copy.skillsView.plainText}</option>
                      </select>
                      <p className="formHint">{copy.skillsView.management.noRawContentNotice}</p>
                      <ManagementSubmitButton
                        pendingLabel={copy.skillsView.management.pending.createDraft}
                      >
                        {copy.skillsView.createDraft}
                      </ManagementSubmitButton>
                    </form>

                    <section className="skillsList" aria-labelledby="skill-versions-title">
                      <h2 id="skill-versions-title">{copy.skillsView.management.lifecycleTitle}</h2>
                      {pageState.skills.availableVersions.length > 0 ? (
                        pageState.skills.availableVersions.map((version) => (
                          <div className="skillRow" key={version.id}>
                            <div>
                              <strong>{version.manifest.name}</strong>
                              <span>
                                {version.version} ·{" "}
                                {copy.skillsView.statusLabels[version.reviewState]}
                              </span>
                              {(() => {
                                const row = skillsManagement.versionRows.find(
                                  (candidate) => candidate.id === version.id
                                );
                                return row ? (
                                  <small className="managementState">
                                    {row.stageLabel} · {row.nextActionLabel}
                                  </small>
                                ) : null;
                              })()}
                            </div>
                            <div className="skillActions">
                              {version.reviewState === "draft" ? (
                                <form action={validateSkillVersionAction}>
                                  <input name="skillVersionId" type="hidden" value={version.id} />
                                  <ManagementSubmitButton
                                    pendingLabel={copy.skillsView.management.pending.validate}
                                  >
                                    {copy.skillsView.validate}
                                  </ManagementSubmitButton>
                                </form>
                              ) : null}
                              {version.reviewState === "validated" ? (
                                <form action={publishSkillVersionAction}>
                                  <input name="skillVersionId" type="hidden" value={version.id} />
                                  <ManagementSubmitButton
                                    pendingLabel={copy.skillsView.management.pending.publish}
                                  >
                                    {copy.skillsView.publish}
                                  </ManagementSubmitButton>
                                </form>
                              ) : null}
                              {version.reviewState === "published" && !boundSkillVersionIds.has(version.id) ? (
                                <form action={bindSkillVersionAction}>
                                  <input name="projectId" type="hidden" value={activeProject.id} />
                                  <input name="skillVersionId" type="hidden" value={version.id} />
                                  <ManagementSubmitButton
                                    pendingLabel={copy.skillsView.management.pending.bind}
                                  >
                                    {copy.skillsView.bind}
                                  </ManagementSubmitButton>
                                </form>
                              ) : null}
                            </div>
                          </div>
                        ))
                      ) : (
                        <p>{copy.skillsView.emptyVersions}</p>
                      )}
                    </section>

                    <section className="skillsList" aria-labelledby="bound-skills-title">
                      <h2 id="bound-skills-title">{copy.skillsView.boundTitle}</h2>
                      {pageState.skills.boundSkills.length > 0 ? (
                        pageState.skills.boundSkills.map((boundSkill) => (
                          <div className="skillRow" key={boundSkill.binding.id}>
                            <div>
                              <strong>{boundSkill.skill.name}</strong>
                              <span>
                                {boundSkill.version.version} ·{" "}
                                {copy.skillsView.statusLabels[boundSkill.version.reviewState]}
                              </span>
                              {(() => {
                                const row = skillsManagement.boundRows.find(
                                  (candidate) => candidate.bindingId === boundSkill.binding.id
                                );
                                return row ? (
                                  <small className="managementState">
                                    {row.stageLabel} · {row.nextActionLabel}
                                  </small>
                                ) : null;
                              })()}
                            </div>
                            <div className="skillActions">
                              <form action={setSkillBindingEnabledAction}>
                                <input name="projectId" type="hidden" value={activeProject.id} />
                                <input name="bindingId" type="hidden" value={boundSkill.binding.id} />
                                <input
                                  name="enabled"
                                  type="hidden"
                                  value={boundSkill.binding.enabled ? "false" : "true"}
                                />
                                <ManagementSubmitButton
                                  pendingLabel={
                                    boundSkill.binding.enabled
                                      ? copy.skillsView.management.pending.disable
                                      : copy.skillsView.management.pending.enable
                                  }
                                >
                                  {boundSkill.binding.enabled
                                    ? copy.skillsView.disable
                                    : copy.skillsView.enable}
                                </ManagementSubmitButton>
                              </form>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p>{copy.skillsView.emptyBound}</p>
                      )}
                    </section>

                    <section className="skillsList skillCommandsList" aria-labelledby="skill-commands-title">
                      <div className="skillCommandsHeader">
                        <div>
                          <h2 id="skill-commands-title">{copy.skillsView.commandsTitle}</h2>
                          <p>{copy.skillsView.commandsSubtitle}</p>
                          <p className="alphaBoundaryNote">
                            {copy.skillsView.commandQueueNotice}
                          </p>
                        </div>
                        <span>{copy.skillsView.commandQueueLabel}</span>
                      </div>
                      {skillCommands.length > 0 ? (
                        <div className="skillCommandGrid">
                          {skillCommands.map((command) => (
                            <div
                              className="skillCommandCard"
                              key={`${command.skillVersionId}:${command.commandId}`}
                            >
                              <div>
                                <strong>{command.commandName}</strong>
                                <span>{command.skillName}</span>
                                {command.description ? <p>{command.description}</p> : null}
                                <small>
                                  {copy.skillsView.commandPermissionLabel}: {command.permission}
                                </small>
                                <small>
                                  {command.requiresApproval
                                    ? copy.skillsView.commandApprovalRequired
                                    : copy.skillsView.commandApprovalNotRequired}
                                </small>
                              </div>
                              <form action={executeSkillCommandAction}>
                                <input name="projectId" type="hidden" value={activeProject.id} />
                                <input
                                  name="skillVersionId"
                                  type="hidden"
                                  value={command.skillVersionId}
                                />
                                <input
                                  name="commandId"
                                  type="hidden"
                                  value={command.commandId}
                                />
                                <input
                                  name="pageVersionId"
                                  type="hidden"
                                  value={currentPageVersionId ?? ""}
                                />
                                {pageState.kind === "task_ready" ? (
                                  <input name="taskId" type="hidden" value={pageState.task.id} />
                                ) : null}
                                <ManagementSubmitButton
                                  pendingLabel={copy.skillsView.management.pending.queueCommand}
                                >
                                  {copy.skillsView.approveAndQueue}
                                </ManagementSubmitButton>
                              </form>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p>{copy.skillsView.emptyCommands}</p>
                      )}
                    </section>

                    <section className="localWorkerPanel" aria-labelledby="local-worker-title">
                      <div className="localWorkerHeader">
                        <div>
                          <h2 id="local-worker-title">{copy.skillsView.commandQueueLabel}</h2>
                          <p>{copy.skillsView.localWorkerIdle}</p>
                        </div>
                        <form action={runLocalWorkerOnceAction}>
                          <input type="hidden" name="projectId" value={activeProject.id} />
                          <ManagementSubmitButton
                            pendingLabel={copy.skillsView.management.pending.runWorker}
                          >
                            {copy.skillsView.runLocalWorkerOnce}
                          </ManagementSubmitButton>
                        </form>
                      </div>

                      <dl className="workerQueueCounts">
                        {workerQueueCountItems.map((item) => (
                          <div key={item.key}>
                            <dt>{item.label}</dt>
                            <dd>{item.value}</dd>
                          </div>
                        ))}
                      </dl>

                      <div className="workerHeartbeat">
                        <strong>{copy.skillsView.workerHeartbeatLabel}</strong>
                        <span data-status={workerHeartbeat.status}>
                          {copy.skillsView.workerHeartbeatStatuses[workerHeartbeat.status]}
                        </span>
                        {workerHeartbeat.workerId ? (
                          <small>
                            {copy.skillsView.workerHeartbeatWorkerLabel}: {workerHeartbeat.workerId}
                          </small>
                        ) : null}
                        {workerHeartbeat.workerJobId ? (
                          <small>
                            {copy.skillsView.workerHeartbeatJobLabel}: {workerHeartbeat.workerJobId}
                          </small>
                        ) : null}
                      </div>

                      <div className="workerRecentLogs">
                        <h3>{copy.skillsView.workerRecentLogsTitle}</h3>
                        {workerQueue.logs.length > 0 ? (
                          <ul>
                            {workerQueue.logs.map((log) => (
                              <li key={log.id}>
                                <span>{log.type}</span>
                                <small>
                                  {[log.workerId, log.workerJobId, log.createdAt]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </small>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>{copy.skillsView.workerNoRecentLogs}</p>
                        )}
                      </div>
                    </section>

                    {workerErrorMessage ? (
                      <p className="formError" role="alert">{workerErrorMessage}</p>
                    ) : null}
                  </>
                ) : null}
              </section>
            ) : null}

            {activeView === "models" ? (
              <section className="modelsView" aria-labelledby="models-title">
                <header className="modelsHeader">
                  <div>
                    <h1 id="models-title">{copy.modelsView.title}</h1>
                    <p>{copy.modelsView.subtitle}</p>
                    <p className="alphaBoundaryNote">{copy.modelsView.optInNotice}</p>
                    <p className="alphaBoundaryNote">{copy.modelsView.failClosedNotice}</p>
                  </div>
                </header>

                {modelErrorMessage ? (
                  <div className="formError" role="alert">{modelErrorMessage}</div>
                ) : null}

                {modelsManagement.noticeMessage ? (
                  <div className="formNotice" role="status">{modelsManagement.noticeMessage}</div>
                ) : null}

                <section className="managementSummary" aria-labelledby="models-summary-title">
                  <div>
                    <h2 id="models-summary-title">
                      {copy.modelsView.management.projectSummaryTitle}
                    </h2>
                    <p>{modelsManagement.providerSummary}</p>
                    <p>{modelsManagement.routeSummary}</p>
                  </div>
                  <ul>
                    <li>{copy.modelsView.management.safeMetadataNote}</li>
                    <li>{copy.modelsView.management.optInRuntimeNote}</li>
                  </ul>
                  <div className="modelLocalRunChecklist">
                    <h3>{modelsManagement.localRunChecklist.title}</h3>
                    <ul>
                      {modelsManagement.localRunChecklist.items.map((item) => (
                        <li key={item.key} data-ready={item.ready ? "true" : "false"}>
                          <strong>{item.label}</strong>
                          <span>{item.stateLabel}</span>
                          <small>{item.detail}</small>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>

                <div className="modelsProjectContext">
                  <span>{copy.modelsView.activeProjectLabel}</span>
                  <strong>{activeProject?.name ?? copy.modelsView.noProject}</strong>
                </div>

                {activeProject ? (
                  <>
                    <form action={createModelProviderAction} className="modelEditor">
                      <h2>{copy.modelsView.providerCreateTitle}</h2>
                      <input name="projectId" type="hidden" value={activeProject.id} />

                      <label htmlFor="providerId">{copy.modelsView.providerIdLabel}</label>
                      <input
                        id="providerId"
                        name="providerId"
                        aria-describedby="provider-id-example"
                      />
                      <small id="provider-id-example">provider_openai</small>

                      <label htmlFor="providerName">{copy.modelsView.providerNameLabel}</label>
                      <input
                        id="providerName"
                        name="name"
                        aria-describedby="provider-name-example"
                      />
                      <small id="provider-name-example">OpenAI</small>

                      <label htmlFor="provider">{copy.modelsView.providerTypeLabel}</label>
                      <select id="provider" name="provider" defaultValue="mock">
                        {(["mock", "openai", "anthropic", "internal", "custom"] as const).map(
                          (type) => (
                            <option value={type} key={type}>
                              {copy.modelsView.providerTypes[type]}
                            </option>
                          )
                        )}
                      </select>

                      <label htmlFor="api">{copy.modelsView.providerApiLabel}</label>
                      <select id="api" name="api" defaultValue="mock">
                        {(["mock", "openai-completions", "anthropic-messages"] as const).map(
                          (api) => (
                            <option value={api} key={api}>
                              {copy.modelsView.providerApis[api]}
                            </option>
                          )
                        )}
                      </select>

                      <label htmlFor="baseUrl">{copy.modelsView.baseUrlLabel}</label>
                      <input id="baseUrl" name="baseUrl" aria-describedby="base-url-example" />
                      <small id="base-url-example">Provider endpoint from docs</small>

                      <label htmlFor="apiKeyEnv">{copy.modelsView.apiKeyEnvLabel}</label>
                      <input
                        id="apiKeyEnv"
                        name="apiKeyEnv"
                        aria-describedby="api-key-env-example"
                      />
                      <small id="api-key-env-example">
                        {copy.modelsView.management.secretReferenceHint}
                      </small>

                      <label htmlFor="modelId">{copy.modelsView.providerModelIdLabel}</label>
                      <input id="modelId" name="modelId" aria-describedby="model-id-example" />
                      <small id="model-id-example">glm-5.1</small>

                      <ManagementSubmitButton
                        pendingLabel={copy.modelsView.management.pending.createProvider}
                      >
                        {copy.modelsView.createProvider}
                      </ManagementSubmitButton>
                    </form>

                    <section className="modelsList" aria-labelledby="model-providers-title">
                      <h2 id="model-providers-title">
                        {copy.modelsView.management.providerSummaryTitle}
                      </h2>
                      {modelState.providers.length > 0 ? (
                        modelState.providers.map((provider) => (
                          <div className="modelRow" key={provider.id}>
                            <div>
                              <strong>{provider.name}</strong>
                              {(() => {
                                const providerRow = modelsManagement.providerRows.find(
                                  (row) => row.id === provider.id
                                );
                                return providerRow ? (
                                  <span>
                                    {providerRow.providerLabel} · {providerRow.apiLabel} ·{" "}
                                    {providerRow.api} · {copy.modelsView.baseUrlLabel}:{" "}
                                    {providerRow.baseUrlState}
                                    {providerRow.baseUrlState ===
                                    copy.modelsView.management.metadataStates.configured
                                      ? ` (${copy.modelsView.baseUrlConfigured})`
                                      : ""}{" "}
                                    · {copy.modelsView.apiKeyEnvLabel}: {providerRow.secretState}
                                    {providerRow.secretState ===
                                    copy.modelsView.management.metadataStates.configured
                                      ? ` (${copy.modelsView.apiKeyEnvConfigured})`
                                      : ""}{" "}
                                    ·{" "}
                                    {providerRow.stateLabel} · {providerRow.modelCount} models
                                  </span>
                                ) : null;
                              })()}
                            </div>
                            <form action={setModelProviderEnabledAction}>
                              <input name="projectId" type="hidden" value={activeProject.id} />
                              <input name="providerId" type="hidden" value={provider.id} />
                              <input
                                name="enabled"
                                type="hidden"
                                value={provider.enabled ? "false" : "true"}
                              />
                              <ManagementSubmitButton
                                pendingLabel={
                                  provider.enabled
                                    ? copy.modelsView.management.pending.disable
                                    : copy.modelsView.management.pending.enable
                                }
                              >
                                {provider.enabled
                                  ? copy.modelsView.disable
                                  : copy.modelsView.enable}
                              </ManagementSubmitButton>
                            </form>
                          </div>
                        ))
                      ) : (
                        <p>{copy.modelsView.fallbackLabel}</p>
                      )}
                    </section>

                    <section className="modelsList" aria-labelledby="model-routes-title">
                      <h2 id="model-routes-title">
                        {copy.modelsView.management.routeSummaryTitle}
                      </h2>
                      {modelManagementRoleOrder.map((role) => {
                        const route = modelState.routes.find(
                          (modelRoute) => modelRoute.role === role
                        );
                        const resolvedRoute = modelState.resolvedPolicy[role];
                        const enabledProviders = modelState.providers.filter(
                          (provider) => provider.enabled
                        );
                        return (
                          <form
                            action={upsertProjectModelRouteAction}
                            className="modelRouteForm"
                            key={role}
                          >
                            <strong>{copy.modelsView.roleLabels[role]}</strong>
                            {(() => {
                              const routeRow = modelsManagement.routeRows.find(
                                (row) => row.role === role
                              );
                              return routeRow ? (
                                <small className={`managementState routeState-${routeRow.state}`}>
                                  <span>
                                    {routeRow.stateLabel} · {getModelRouteTargetLabel(routeRow)}
                                  </span>
                                  {routeRow.diagnosticMessage ? (
                                    <span className="routeDiagnostic">
                                      {routeRow.diagnosticMessage}
                                    </span>
                                  ) : null}
                                </small>
                              ) : null;
                            })()}
                            <input name="projectId" type="hidden" value={activeProject.id} />
                            <input name="role" type="hidden" value={role} />
                            <select
                              name="providerId"
                              defaultValue={route?.providerId ?? ""}
                              required
                            >
                              <option value="" disabled>
                                {copy.modelsView.fallbackLabel}
                              </option>
                              {enabledProviders.map((provider) => (
                                <option value={provider.id} key={provider.id}>
                                  {provider.name}
                                </option>
                              ))}
                            </select>
                            <input
                              aria-label={`${copy.modelsView.roleLabels[role]} ${copy.modelsView.modelLabel}`}
                              name="model"
                              defaultValue={route?.model ?? resolvedRoute.model}
                            />
                            <ManagementSubmitButton
                              disabled={enabledProviders.length === 0}
                              pendingLabel={copy.modelsView.management.pending.saveRoute}
                            >
                              {copy.modelsView.saveRoute}
                            </ManagementSubmitButton>
                          </form>
                        );
                      })}
                    </section>

                    <section className="modelsList" aria-labelledby="resolved-routes-title">
                      <h2 id="resolved-routes-title">
                        {copy.modelsView.management.resolvedSummaryTitle}
                      </h2>
                      {modelManagementRoleOrder.map((role) => {
                        const resolvedRoute = modelState.resolvedPolicy[role];
                        return (
                          <div className="modelRow" key={role}>
                            <strong>{copy.modelsView.roleLabels[role]}</strong>
                            <span>{`${resolvedRoute.provider}/${resolvedRoute.model}`}</span>
                          </div>
                        );
                      })}
                    </section>
                  </>
                ) : null}
              </section>
            ) : null}

            {activeView === "mcp"
              ? MCPManagementView({
                  activeProject,
                  copy,
                  errorMessage: mcpErrorMessage,
                  management: mcpManagement
                })
              : null}

            </div>
          </div>
        ) : (
          <StreamingWorkbench
            action={submitPromptAction}
            projectId={activeProject?.id}
            taskId={streamingTaskId}
            liveTaskId={liveTaskId}
            implicitProjectName={copy.entry.implicitProjectName}
            promptLabel={copy.projectFlow.promptLabel}
            placeholder={pageState.kind === "empty" ? copy.entry.placeholder : composer.placeholder}
            sendLabel={composer.sendLabel}
            streamingStatusLabel={copy.chat.streamingStatusLabel}
            streamingErrorLabel={copy.chat.streamingErrorLabel}
            streamingErrorMessages={copy.chat.streamingErrorMessages}
            interruptAction={interruptCurrentTaskAction}
            interruptState={pageState.kind === "task_ready"
              ? pageState.interrupt.state
              : "not_interruptible"}
            interruptLabels={{
              idle: composer.interruptLabel,
              stopping: copy.chat.interruptStoppingLabel
            }}
          >
                {pageState.kind === "empty" ? (
                  <section className="entryPanel" aria-labelledby="entry-title">
                    <h1 id="entry-title">{copy.entry.title}</h1>
                    {errorMessage ? <div className="formError" role="alert">{errorMessage}</div> : null}
                    {interruptErrorMessage ? (
                      <div className="formError" role="alert">{interruptErrorMessage}</div>
                    ) : null}
                    {recoveryErrorMessage ? (
                      <div className="formError" role="alert">{recoveryErrorMessage}</div>
                    ) : null}
                    <div className="entryChipRow">
                      {copy.entry.chips.map((chip) => (
                        <React.Fragment key={chip}>
                          {QuickPromptForm({
                            className: "entryChipForm",
                            implicitProjectName: copy.entry.implicitProjectName,
                            prompt: chip,
                            projectId: activeProject?.id
                          })}
                        </React.Fragment>
                      ))}
                    </div>
                  </section>
                ) : null}

                {chat ? (
                  <>
                    {errorMessage ? <div className="formError" role="alert">{errorMessage}</div> : null}
                    {interruptErrorMessage ? (
                      <div className="formError" role="alert">{interruptErrorMessage}</div>
                    ) : null}
                    {recoveryErrorMessage ? (
                      <div className="formError" role="alert">{recoveryErrorMessage}</div>
                    ) : null}
                    {chat.turns.map((turn, turnIndex) => {
                      const isLatestTurn = turnIndex === chat.turns.length - 1;
                      const shouldShowLpTaskDetails =
                        isLatestTurn &&
                        pageState.kind === "task_ready" &&
                        pageState.task.type === "lp_generation";
                      const hasRecoveryRows =
                        pageState.kind === "task_ready" &&
                        (pageState.recovery?.runs.length ?? 0) > 0;

                      return (
                        <React.Fragment key={turn.id}>
                          <div className="userTurn" aria-label={copy.chat.userLabel}>
                            <div className="messageBubble userMessage">
                              <ChatMessageContent content={turn.userMessage} />
                            </div>
                          </div>

                          <article className="assistantTurn">
                            <div className="assistantIdentity">
                              <div className="assistantAvatar">LP</div>
                              <strong>{chat.assistantName}</strong>
                              <span>{chat.assistantBadge}</span>
                            </div>

                            <div className="assistantMessage">
                              {chat.assistantIntro ? (
                                <ChatMessageContent content={chat.assistantIntro} />
                              ) : null}

                              <ChatMessageContent content={turn.assistantCompletion} />

                              {isLatestTurn && completedSnapshot ? (
                              <>
                                <section
                                  className="deliveryBlock"
                                  aria-label={copy.chat.artifactsTitle}
                                >
                                  <div className="deliveryHeader">
                                    <strong>{copy.chat.taskComplete}</strong>
                                    <span>{copy.chat.resultRating}</span>
                                  </div>
                                  <div className="artifactGrid">
                                    {chat.artifacts.map((artifact) => (
                                      <a
                                        className="artifactCard"
                                        download={artifact.filename}
                                        href={artifact.href}
                                        key={artifact.id}
                                      >
                                        <span>{artifact.kind}</span>
                                        <strong>{artifact.filename}</strong>
                                        <small>{copy.chat.bytesLabel(artifact.bytes)}</small>
                                      </a>
                                    ))}
                                    <a
                                      className="artifactCard"
                                      href={createWorkbenchHref({
                                        projectId: activeProject?.id,
                                        taskId: activeTask?.id,
                                        view: "artifacts"
                                      })}
                                    >
                                      <span>{copy.nav.artifacts}</span>
                                      <strong>{copy.chat.artifactWorkspaceOpenLabel}</strong>
                                      <small>{copy.chat.artifactWorkspaceSubtitle}</small>
                                    </a>
                                  </div>
                                  {pageState.kind === "task_ready" && pageState.artifactDiff ? (
                                    ArtifactDiffBlock({
                                      artifactDiff: pageState.artifactDiff,
                                      copy: copy.chat,
                                      previewSearchParams
                                    })
                                  ) : null}
                                </section>

                                <section
                                  className="inlinePreview"
                                  aria-label={copy.chat.previewTitle}
                                >
                                  <div className="previewTitle">{copy.chat.previewTitle}</div>
                                  <LPPreview artifacts={completedSnapshot.pageVersion.artifacts} />
                                </section>
                              </>
                            ) : null}

                              {isLatestTurn &&
                              pageState.kind === "task_ready" &&
                              pageState.task.type === "lp_generation" ? (
                                <LiveTaskPanel
                                  taskId={pageState.task.id}
                                  initialProjectId={pageState.task.projectId}
                                  initialPreviewVersionKey={initialPreviewVersionKey}
                                  copy={liveTaskCopy}
                                />
                              ) : null}

                              {shouldShowLpTaskDetails ? (
                                <AgentDetailsDisclosure
                                  countLabel={`${chat.toolEvents.length}/${chat.toolEvents.length}`}
                                  storageKey={`agent-details:${pageState.task.id}`}
                                  title={copy.chat.toolsTitle}
                                >
                                  {AgentProcessBlock({
                                    events: chat.toolEvents,
                                    title: copy.chat.toolsTitle,
                                    turnId: turn.id
                                  })}
                                  {RunTimelineBlock({ pageState, copy })}
                                  {hasRecoveryRows ? RecoveryBlock({ pageState, copy }) : null}
                                </AgentDetailsDisclosure>
                              ) : null}
                            </div>
                          </article>
                        </React.Fragment>
                      );
                    })}

                    <section className="suggestionBlock" aria-label={copy.chat.suggestionsTitle}>
                      <div>{copy.chat.suggestionsTitle}</div>
                      {chat.suggestions.map((suggestion) => (
                        <React.Fragment key={suggestion}>
                          {QuickPromptForm({
                            className: "suggestionPromptForm",
                            implicitProjectName: copy.entry.implicitProjectName,
                            prompt: suggestion,
                            projectId: activeProject?.id,
                            taskId: activeTask?.id
                          })}
                        </React.Fragment>
                      ))}
                    </section>
                  </>
                ) : null}
          </StreamingWorkbench>
        )}
      </section>
    </main>
  );
}

function toProjectFlowError(value: string | undefined): ProjectFlowErrorCode | undefined {
  if (
    value === "project_name_required" ||
    value === "prompt_required" ||
    value === "project_not_found" ||
    value === "generation_failed" ||
    value === "provider_configuration_failed"
  ) {
    return value;
  }
  return undefined;
}

function toMCPFlowError(value: string | undefined): MCPFlowErrorCode | undefined {
  if (
    value === "project_not_found" ||
    value === "mcp_connector_json_invalid" ||
    value === "mcp_connector_validation_failed" ||
    value === "mcp_connector_scope_unsupported" ||
    value === "mcp_connector_already_exists" ||
    value === "mcp_connector_not_found" ||
    value === "mcp_tool_not_found" ||
    value === "mcp_tool_approval_not_required" ||
    value === "mcp_tool_not_visible" ||
    value === "mcp_tool_execution_not_read_only" ||
    value === "mcp_tool_execution_approval_required" ||
    value === "mcp_tool_execution_rejected" ||
    value === "mcp_tool_execution_failed" ||
    value === "mcp_tool_arguments_invalid" ||
    value === "mcp_executor_not_configured" ||
    value === "mcp_operation_failed"
  ) {
    return value;
  }
  return undefined;
}

function toInterruptFlowError(value: string | undefined): InterruptFlowErrorCode | undefined {
  if (
    value === "task_not_found" ||
    value === "task_not_interruptible" ||
    value === "interrupt_target_not_found" ||
    value === "interrupt_failed"
  ) {
    return value;
  }
  return undefined;
}

function toRunRecoveryFlowError(value: string | undefined): RunRecoveryFlowErrorCode | undefined {
  if (
    value === "run_not_found" ||
    value === "task_not_found" ||
    value === "recovery_action_not_available" ||
    value === "worker_runtime_not_configured" ||
    value === "worker_job_not_found" ||
    value === "worker_job_not_terminal" ||
    value === "worker_finalization_failed" ||
    value === "retry_input_not_reconstructable" ||
    value === "retry_target_conflict" ||
    value === "retry_failed"
  ) {
    return value;
  }
  return undefined;
}

function parseWorkerQueueError(value: unknown): WorkerQueueFlowErrorCode | undefined {
  return value === "worker_runtime_not_configured" ||
    value === "worker_job_execution_failed" ||
    value === "worker_job_finalization_failed"
    ? value
    : undefined;
}

function getPageModelState(pageState: { models?: WebProjectModelState }): WebProjectModelState {
  return pageState.models ?? {
    providers: [],
    routes: [],
    resolvedPolicy: {
      assistant: { provider: "mock-openai", model: "assistant-model" },
      planner: { provider: "mock-openai", model: "planning-model" },
      builder: { provider: "mock-anthropic", model: "code-model" },
      reviewer: { provider: "mock-openai", model: "review-model" },
      deployer: { provider: "mock-local", model: "tool-model" }
    }
  };
}

function getPageMCPState(pageState: { mcp?: ProjectMCPState }): ProjectMCPState {
  return pageState.mcp ?? {
    connectors: [],
    approvals: [],
    visibleToolsByRole: {
      assistant: [],
      planner: [],
      builder: [],
      reviewer: [],
      deployer: []
    }
  };
}

function getPageWorkerQueueState(pageState: {
  workerQueue?: WorkbenchPageState["workerQueue"];
}): WorkbenchPageState["workerQueue"] {
  return pageState.workerQueue ?? {
    projectId: "",
    counts: {
      queued: 0,
      running: 0,
      stale: 0,
      completed: 0,
      failed: 0,
      rejected: 0,
      cancelled: 0
    },
    heartbeat: {
      status: "unknown"
    },
    logs: []
  };
}

function ProjectMembersBlock({
  members,
  copy
}: {
  members: WorkbenchPageState["projectMembers"];
  copy: ReturnType<typeof getWorkbenchCopy>["collaboration"];
}) {
  return (
    <section className="sidebarSection projectMembers" aria-label={copy.title}>
      <div className="sidebarSectionTitle">{copy.title}</div>
      {members.length === 0 ? (
        <p className="mutedText">{copy.empty}</p>
      ) : (
        <ul className="projectMemberList">
          {members.map((member) => (
            <li className="projectMemberItem" key={member.id}>
              <span>
                {member.userId === "local-web-user"
                  ? copy.localUser
                  : member.displayName ?? member.userId}
              </span>
              <strong>{copy.roleLabels[member.role]}</strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type TaskReadyWorkbenchPageState = Extract<WorkbenchPageState, { kind: "task_ready" }>;
type TaskReadyPageState = TaskReadyWorkbenchPageState;
type CompletedArtifactSnapshot = {
  brief: NonNullable<NonNullable<TaskReadyWorkbenchPageState["snapshot"]>["brief"]>;
  pageVersion: NonNullable<
    NonNullable<TaskReadyWorkbenchPageState["snapshot"]>["currentPageVersion"]
  >;
};

function AgentProcessBlock({
  events,
  title,
  turnId
}: {
  events: ChatToolEvent[];
  title: string;
  turnId: string;
}) {
  if (events.length === 0) {
    return null;
  }

  return (
    <section className="processBlock" aria-label={title}>
      <div className="processHeader">
        <strong>{title}</strong>
        <span>{events.length}/{events.length}</span>
      </div>
      <div className="toolTimeline">
        {events.map((event) => (
          <div
            className="toolEvent"
            data-status={event.status}
            key={`${turnId}:${event.id}`}
          >
            <div className="toolStatusDot" aria-hidden="true" />
            <div>
              <div className="toolEventTop">
                <strong>{event.label}</strong>
                <span>{event.statusLabel}</span>
              </div>
              <p>{event.operation}</p>
              <small>{event.meta}</small>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RunTimelineBlock({
  pageState,
  copy
}: {
  pageState: TaskReadyPageState;
  copy: ReturnType<typeof getWorkbenchCopy>;
}) {
  const recovery = pageState.recovery ?? { runs: [] };
  const timeline = buildRunTimelineViewModel({
    payload: {
      runs: recovery.runs,
      runEvents: pageState.runEvents ?? [],
      recovery
    },
    copy
  });

  return (
    <section className="runTimelineBlock" aria-label={timeline.title}>
      <div className="runTimelineHeader">
        <div>
          <strong>{timeline.title}</strong>
          <p>{timeline.subtitle}</p>
        </div>
        {timeline.activeStep ? (
          <span>
            {copy.chat.runTimelineActive}: {timeline.activeStep.label}
          </span>
        ) : null}
      </div>
      <div className="runTimelineSteps">
        {timeline.steps.map((step) => RunTimelineStep({ step }))}
      </div>
    </section>
  );
}

function RunTimelineStep({ step }: { step: RunTimelineStepView }) {
  return (
    <div className="runTimelineStep" data-status={step.status} key={step.role}>
      <div className="runTimelineDot" aria-hidden="true" />
      <div className="runTimelineBody">
        <div className="toolEventTop">
          <strong>{step.label}</strong>
          <span>{step.stateLabel}</span>
        </div>
        {step.diagnosticMessage ? <p>{step.diagnosticMessage}</p> : null}
        {step.lastEventLabel ? <small>{step.lastEventLabel}</small> : null}
        {step.diagnosticCode ? <small>{step.diagnosticCode}</small> : null}
        {step.markers.length > 0 ? (
          <div className="runTimelineMarkers">
            {step.markers.map((marker) => (
              <span data-marker={marker.kind} key={marker.kind}>
                {marker.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RecoveryBlock({
  pageState,
  copy
}: {
  pageState: TaskReadyPageState;
  copy: ReturnType<typeof getWorkbenchCopy>;
}) {
  const executableActions = new Set(["resume_worker_finalization", "retry_run"]);
  const guidanceActions = new Set(["request_approval", "resolve_blocker", "inspect_manually"]);

  return (
    <section className="recoveryBlock" aria-label={copy.chat.recoveryTitle}>
      <div className="recoveryHeader">
        <div>
          <strong>{copy.chat.recoveryTitle}</strong>
          <p>{copy.chat.recoverySubtitle}</p>
        </div>
        <span>{pageState.recovery.runs.length}</span>
      </div>
      <div className="recoveryList">
        {pageState.recovery.runs.map((run) => {
          const diagnosticMessage =
            run.diagnosticSummary?.message ?? run.terminalEventType ?? run.state;
          const diagnosticCode = run.diagnosticSummary?.code ?? run.runId;
          const executable = run.recoveryActions.filter((action) =>
            executableActions.has(action)
          ) as Array<keyof typeof copy.chat.recoveryActionLabels>;
          const guidance = run.recoveryActions.filter((action) =>
            guidanceActions.has(action)
          ) as Array<keyof typeof copy.chat.recoveryGuidanceLabels>;

          return (
            <div className="recoveryItem" key={run.runId}>
              <div className="toolEventTop">
                <strong>{copy.modelsView.roleLabels[run.role]}</strong>
                <span>{copy.chat.recoveryStateLabels[run.state]}</span>
              </div>
              <p>{diagnosticMessage}</p>
              <small>{diagnosticCode}</small>
              {executable.length > 0 ? (
                <div className="recoveryActionGroup">
                  <strong>{copy.chat.runTimelineActionGroupLabels.executable}</strong>
                  <div className="recoveryActions">
                    {executable.map((action) => (
                      <form action={executeRunRecoveryAction} key={action}>
                        <input name="taskId" type="hidden" value={pageState.task.id} />
                        <input name="runId" type="hidden" value={run.runId} />
                        <input name="action" type="hidden" value={action} />
                        <button type="submit">{copy.chat.recoveryActionLabels[action]}</button>
                      </form>
                    ))}
                  </div>
                </div>
              ) : null}
              {guidance.length > 0 ? (
                <div className="recoveryActionGroup">
                  <strong>{copy.chat.runTimelineActionGroupLabels.guidance}</strong>
                  <div className="recoveryGuidance">
                    {guidance.map((action) => (
                      <span key={action}>{copy.chat.recoveryGuidanceLabels[action]}</span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MCPManagementView({
  activeProject,
  copy,
  errorMessage,
  management
}: {
  activeProject: WorkbenchPageState["projects"][number] | undefined;
  copy: ReturnType<typeof getWorkbenchCopy>;
  errorMessage?: string;
  management: MCPManagementViewModel;
}) {
  const managementCopy = copy.mcpView.management;

  return (
    <section className="mcpView" aria-labelledby="mcp-title">
      <header className="mcpHeader">
        <div>
          <h1 id="mcp-title">{copy.mcpView.title}</h1>
          <p>{copy.mcpView.subtitle}</p>
          <p className="alphaBoundaryNote">{managementCopy.safeProjectionNotice}</p>
        </div>
        <span>{managementCopy.summary(management.summary)}</span>
      </header>

      {errorMessage ? <div className="formError" role="alert">{errorMessage}</div> : null}

      <section className="managementSummary" aria-labelledby="mcp-summary-title">
        <div>
          <h2 id="mcp-summary-title">{managementCopy.runtimeSummaryTitle}</h2>
          <p>{managementCopy.runtimeSummary(management.summary)}</p>
        </div>
        <ul>
          {managementCopy.policyItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <div className="mcpProjectContext">
        <span>{copy.mcpView.activeProjectLabel}</span>
        <strong>{activeProject?.name ?? copy.mcpView.noProject}</strong>
      </div>

      {activeProject ? (
        <>
          <form action={createMCPConnectorAction} className="mcpEditor">
            <input name="projectId" type="hidden" value={activeProject.id} />
            <h2>{copy.mcpView.createTitle}</h2>
            <label htmlFor="definitionJson">{copy.mcpView.definitionLabel}</label>
            <textarea
              id="definitionJson"
              name="definitionJson"
              placeholder={copy.mcpView.definitionPlaceholder}
            />
            <p className="formHint">{managementCopy.connectorDefinitionHint}</p>
            <ManagementSubmitButton pendingLabel={managementCopy.pending.create}>
              {copy.mcpView.createConnector}
            </ManagementSubmitButton>
          </form>

          <section className="mcpList" aria-labelledby="mcp-connectors-title">
            <h2 id="mcp-connectors-title">{copy.mcpView.connectorsTitle}</h2>
            {management.connectors.length > 0 ? (
              management.connectors.map((connector) => (
                <div className="mcpConnectorRow" key={connector.id}>
                  <div>
                    <strong>{connector.name}</strong>
                    {connector.description ? <p>{connector.description}</p> : null}
                    <span>
                      {connector.enabled ? copy.mcpView.enabled : copy.mcpView.disabled}
                      {" · "}
                      {connector.statusLabel}
                      {" · "}
                      {managementCopy.toolCount(connector.toolCount)}
                    </span>
                  </div>
                  <form action={setMCPConnectorEnabledAction}>
                    <input name="projectId" type="hidden" value={activeProject.id} />
                    <input name="connectorId" type="hidden" value={connector.id} />
                    <input
                      name="enabled"
                      type="hidden"
                      value={connector.enabled ? "false" : "true"}
                    />
                    <ManagementSubmitButton
                      pendingLabel={
                        connector.enabled
                          ? managementCopy.pending.disable
                          : managementCopy.pending.enable
                      }
                    >
                      {connector.enabled ? copy.mcpView.disable : copy.mcpView.enable}
                    </ManagementSubmitButton>
                  </form>
                  <div className="mcpToolGrid" aria-label={copy.mcpView.toolsTitle}>
                    {connector.tools.length > 0 ? (
                      connector.tools.map((tool) => (
                        <div className="mcpToolCard" key={`${connector.id}:${tool.name}`}>
                          <strong>{tool.name}</strong>
                          {tool.description ? <p>{tool.description}</p> : null}
                          <span>{copy.mcpView.permissionSummary(tool.permission)}</span>
                          <span>{copy.mcpView.rolesSummary(tool.roleLabels)}</span>
                          <span>
                            {tool.requiresApproval
                              ? copy.mcpView.approvalRequired
                              : copy.mcpView.approvalNotRequired}
                            {" · "}
                            {managementCopy.approvalStates[tool.approvalState]}
                          </span>
                          <small>{managementCopy.statusLabels[tool.status]}</small>
                          {tool.requiresApproval ? (
                            <form action={setMCPToolApprovalAction}>
                              <input name="projectId" type="hidden" value={activeProject.id} />
                              <input name="connectorId" type="hidden" value={connector.id} />
                              <input name="toolName" type="hidden" value={tool.name} />
                              <input
                                name="approved"
                                type="hidden"
                                value={tool.approvalState === "approved" ? "false" : "true"}
                              />
                              <ManagementSubmitButton
                                pendingLabel={managementCopy.pending.approval}
                              >
                                {tool.approvalState === "approved"
                                  ? copy.mcpView.revoke
                                  : copy.mcpView.approve}
                              </ManagementSubmitButton>
                            </form>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <p>{copy.mcpView.emptyVisibleTools}</p>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p>{copy.mcpView.emptyConnectors}</p>
            )}
          </section>

          <section className="mcpList" aria-labelledby="mcp-visible-tools-title">
            <h2 id="mcp-visible-tools-title">{copy.mcpView.visibleToolsTitle}</h2>
            {management.visibleToolGroups.map((group) => (
              <div className="mcpVisibleRole" key={group.role}>
                <strong>{group.label}</strong>
                {group.tools.length > 0 ? (
                  group.tools.map((tool) => (
                    <div
                      className="mcpToolCard"
                      key={`${group.role}:${tool.connectorId}:${tool.name}`}
                    >
                      <strong>{tool.name}</strong>
                      <span>{tool.connectorId}</span>
                      <span>{copy.mcpView.permissionSummary(tool.permission)}</span>
                      <small>{managementCopy.statusLabels[tool.status]}</small>
                      {tool.executionAvailable ? (
                        <form action={executeMCPToolAction} className="mcpExecutionForm">
                          <input name="projectId" type="hidden" value={activeProject.id} />
                          <input name="connectorId" type="hidden" value={tool.connectorId} />
                          <input name="toolName" type="hidden" value={tool.name} />
                          <input name="role" type="hidden" value={group.role} />
                          <input name="argumentsJson" type="hidden" value="{}" />
                          <ManagementSubmitButton pendingLabel={managementCopy.pending.execute}>
                            {copy.mcpView.executeReadOnly}
                          </ManagementSubmitButton>
                        </form>
                      ) : (
                        <small>{copy.mcpView.writeToolUnavailable}</small>
                      )}
                    </div>
                  ))
                ) : (
                  <span>{copy.mcpView.emptyVisibleTools}</span>
                )}
              </div>
            ))}
          </section>
        </>
      ) : null}
    </section>
  );
}

function ArtifactDiffBlock({
  artifactDiff,
  copy,
  previewSearchParams
}: {
  artifactDiff: WebArtifactDiffState;
  copy: ReturnType<typeof getWorkbenchCopy>["chat"];
  previewSearchParams: URLSearchParams;
}) {
  return (
    <section className="artifactDiffBlock" aria-label={copy.artifactChangesTitle}>
      <div className="artifactDiffHeader">
        <strong>{copy.artifactChangesTitle}</strong>
        <span>
          {artifactDiff.previousPageVersionId
            ? `${copy.artifactPreviousVersionLabel} -> ${copy.artifactCurrentVersionLabel}`
            : copy.artifactVersionInitial}
        </span>
      </div>
      <div className="artifactDiffGrid">
        {artifactDiff.files.map((file) => (
          <div className="artifactDiffCard" data-state={file.state} key={file.path}>
            <div className="artifactDiffTop">
              <strong>{file.path}</strong>
              <span>{copy.artifactDiffStateLabels[file.state]}</span>
            </div>
            <small>
              {file.sizeBytes !== undefined
                ? copy.bytesLabel(file.sizeBytes)
                : copy.snippetUnavailableMessage}
            </small>
            {file.shortSha256 ? (
              <small>
                {copy.artifactHashLabel}: {file.shortSha256}
              </small>
            ) : null}
            {file.summary ? <p>{file.summary}</p> : null}
            {file.canPreview ? (
              <a
                aria-label={`${copy.previewSnippetLabel}: ${file.path}`}
                href={createArtifactPreviewHref(previewSearchParams, file.path)}
              >
                {copy.previewSnippetLabel}
              </a>
            ) : null}
          </div>
        ))}
      </div>
      {artifactDiff.selectedSnippet ? (
        <div className="artifactSnippetPanel">
          <div className="artifactSnippetHeader">
            <strong>{copy.snippetPreviewTitle}</strong>
            <span>{artifactDiff.selectedSnippet.path}</span>
          </div>
          {artifactDiff.selectedSnippet.content !== undefined ? (
            <pre><code>{artifactDiff.selectedSnippet.content}</code></pre>
          ) : (
            <p>
              {artifactDiff.selectedSnippet.omittedReason === "size_limit_exceeded"
                ? copy.snippetSizeLimitMessage
                : copy.snippetUnavailableMessage}
            </p>
          )}
        </div>
      ) : artifactDiff.errorCode === "artifact_snippet_unavailable" ? (
        <p className="artifactSnippetNotice">{copy.snippetUnavailableMessage}</p>
      ) : null}
    </section>
  );
}

function ArtifactWorkspaceView({
  completedSnapshot,
  copy,
  downloadLinks,
  initialPreviewVersionKey,
  liveTaskCopy,
  pageState,
  previewSearchParams
}: {
  completedSnapshot: CompletedArtifactSnapshot | undefined;
  copy: ReturnType<typeof getWorkbenchCopy>;
  downloadLinks: ArtifactDownloadLink[] | undefined;
  initialPreviewVersionKey: string | undefined;
  liveTaskCopy: {
    liveTaskArtifactReady: string;
    liveTaskCompleted: string;
    liveTaskIdle: string;
    liveTaskRefreshError: string;
    liveTaskRunning: string;
    liveTaskTitle: string;
    recoveryStateLabels: ReturnType<typeof getWorkbenchCopy>["chat"]["recoveryStateLabels"];
    roleLabels: ReturnType<typeof getWorkbenchCopy>["modelsView"]["roleLabels"];
  };
  pageState: WorkbenchPageState;
  previewSearchParams: URLSearchParams;
}) {
  if (!completedSnapshot || pageState.kind !== "task_ready") {
    return (
      <section className="artifactWorkspaceView" aria-labelledby="artifact-workspace-title">
        <div className="artifactWorkspaceEmpty">
          <h1 id="artifact-workspace-title">{copy.chat.artifactWorkspaceEmptyTitle}</h1>
          <p>{copy.chat.artifactWorkspaceEmptyDescription}</p>
          <a className="artifactCard" href="/">
            <span>{copy.nav.workbench}</span>
            <strong>{copy.nav.workbench}</strong>
          </a>
        </div>
      </section>
    );
  }

  const artifactDiff = pageState.artifactDiff;
  const artifactWorkspaceUnavailable =
    !artifactDiff ||
    artifactDiff.files.length === 0 ||
    artifactDiff.errorCode === "artifact_diff_unavailable";
  const shouldRenderArtifactDiff =
    artifactDiff !== undefined &&
    (!artifactWorkspaceUnavailable || artifactDiff.errorCode === "artifact_snippet_unavailable");
  const workspaceId =
    artifactDiff?.artifactWorkspaceId ?? completedSnapshot.pageVersion.artifactWorkspaceId;

  return (
    <section className="artifactWorkspaceView" aria-labelledby="artifact-workspace-title">
      <header className="artifactWorkspaceHero">
        <div>
          <h1 id="artifact-workspace-title">{copy.chat.artifactWorkspaceTitle}</h1>
          <p>{copy.chat.artifactWorkspaceSubtitle}</p>
        </div>
        <dl className="artifactWorkspaceMeta">
          <div>
            <dt>Project</dt>
            <dd>{pageState.snapshot?.project.name ?? pageState.task.projectId}</dd>
          </div>
          <div>
            <dt>Task</dt>
            <dd>{pageState.task.title}</dd>
          </div>
          <div>
            <dt>Page version</dt>
            <dd>{completedSnapshot.pageVersion.id}</dd>
          </div>
          {workspaceId ? (
            <div>
              <dt>Artifact workspace</dt>
              <dd>{workspaceId}</dd>
            </div>
          ) : null}
        </dl>
      </header>

      <LiveTaskPanel
        taskId={pageState.task.id}
        initialProjectId={pageState.task.projectId}
        initialPreviewVersionKey={initialPreviewVersionKey}
        copy={liveTaskCopy}
      />

      <section
        className="artifactWorkspaceSection"
        aria-labelledby="artifact-workspace-manifest-title"
      >
        <header className="artifactWorkspaceSectionHeader">
          <h2 id="artifact-workspace-manifest-title">
            {copy.chat.artifactWorkspaceManifestTitle}
          </h2>
          {artifactDiff ? (
            <span>{copy.chat.filesLabel}: {artifactDiff.files.length}</span>
          ) : null}
        </header>
        {artifactWorkspaceUnavailable ? (
          <p className="artifactSnippetNotice">
            {copy.chat.artifactWorkspaceUnavailableLabel}
          </p>
        ) : null}
        {artifactDiff && shouldRenderArtifactDiff
          ? ArtifactDiffBlock({
              artifactDiff,
              copy: copy.chat,
              previewSearchParams
            })
          : null}
      </section>

      <section
        className="artifactWorkspaceSection inlinePreview"
        aria-label={copy.chat.previewTitle}
      >
        <div className="previewTitle">{copy.chat.previewTitle}</div>
        <LPPreview artifacts={completedSnapshot.pageVersion.artifacts} />
      </section>

      <section
        className="artifactWorkspaceSection"
        aria-labelledby="artifact-workspace-export-title"
      >
        <header className="artifactWorkspaceSectionHeader">
          <h2 id="artifact-workspace-export-title">
            {copy.chat.artifactWorkspaceExportTitle}
          </h2>
        </header>
        <div className="artifactGrid artifactWorkspaceExportGrid">
          {(downloadLinks ?? []).map((link) => (
            <a
              className="artifactCard"
              download={link.filename}
              href={link.href}
              key={link.filename}
            >
              <span>{link.label}</span>
              <strong>{link.filename}</strong>
              <small>{copy.chat.bytesLabel(link.bytes)}</small>
            </a>
          ))}
        </div>
      </section>
    </section>
  );
}

function getFirstSearchParam(value: PageSearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function createArtifactPreviewSearchParams({
  activeView,
  errorCode,
  interruptError,
  modelError,
  modelNotice,
  recoveryError,
  skillNotice,
  skillError,
  workerError
}: {
  activeView: "artifacts" | "skills" | "models" | "mcp" | "workbench";
  errorCode?: ProjectFlowErrorCode;
  interruptError?: InterruptFlowErrorCode;
  modelError?: ModelFlowErrorCode;
  modelNotice?: ReturnType<typeof toModelManagementNotice>;
  recoveryError?: RunRecoveryFlowErrorCode;
  skillNotice?: ReturnType<typeof toSkillManagementNotice>;
  skillError?: SkillFlowErrorCode;
  workerError?: WorkerQueueFlowErrorCode;
}): URLSearchParams {
  const query = new URLSearchParams();

  if (activeView !== "workbench") {
    query.set("view", activeView);
  }

  if (errorCode) {
    query.set("error", errorCode);
  }
  if (skillError) {
    query.set("skillError", skillError);
  }
  if (modelError) {
    query.set("modelError", modelError);
  }
  if (skillNotice) {
    query.set("skillNotice", skillNotice);
  }
  if (modelNotice) {
    query.set("modelNotice", modelNotice);
  }
  if (interruptError) {
    query.set("interruptError", interruptError);
  }
  if (recoveryError) {
    query.set("recoveryError", recoveryError);
  }
  if (workerError) {
    query.set("workerError", workerError);
  }

  return query;
}

function createArtifactPreviewHref(searchParams: URLSearchParams, artifactPath: string): string {
  const nextSearchParams = new URLSearchParams(searchParams);
  nextSearchParams.set("artifactPath", artifactPath);
  return `/?${nextSearchParams.toString()}`;
}

function createWorkbenchHref({
  newTask,
  projectId,
  taskId,
  view
}: {
  newTask?: boolean;
  projectId?: string;
  taskId?: string;
  view?: "artifacts" | "skills" | "models" | "mcp";
}): string {
  const query = new URLSearchParams();
  if (view) {
    query.set("view", view);
  }
  if (projectId) {
    query.set("projectId", projectId);
  }
  if (taskId) {
    query.set("taskId", taskId);
  }
  if (newTask) {
    query.set("newTask", "1");
  }
  const serialized = query.toString();
  return serialized.length > 0 ? `/?${serialized}` : "/";
}

function getModelRouteTargetLabel(routeRow: ModelManagementRouteRow): string {
  if (routeRow.state !== "failClosed") {
    return routeRow.resolvedLabel;
  }

  const configuredModel = routeRow.model?.trim();
  if (routeRow.providerId && configuredModel) {
    return `${routeRow.providerId}/${configuredModel}`;
  }
  if (routeRow.providerId) {
    return routeRow.providerId;
  }
  return routeRow.resolvedLabel;
}

function toSkillFlowError(value: string | undefined): SkillFlowErrorCode | undefined {
  if (
    value === "invalid_manifest_json" ||
    value === "manifest_validation_failed" ||
    value === "unsupported_skill_scope" ||
    value === "duplicate_skill_version" ||
    value === "skill_binding_already_exists" ||
    value === "unsupported_content_type" ||
    value === "skill_content_required" ||
    value === "skill_content_too_large" ||
    value === "project_not_found" ||
    value === "skill_version_not_found" ||
    value === "skill_version_not_validated" ||
    value === "skill_version_not_published" ||
    value === "skill_binding_not_found" ||
    value === "publish_not_allowed" ||
    value === "skill_operation_failed" ||
    value === "skill_command_not_found" ||
    value === "skill_command_not_bound" ||
    value === "skill_command_not_deployment" ||
    value === "skill_command_not_published" ||
    value === "skill_command_permission_denied" ||
    value === "skill_command_approval_required" ||
    value === "skill_command_not_queueable" ||
    value === "skill_command_page_version_not_found" ||
    value === "skill_command_unknown_template_variable" ||
    value === "skill_command_execution_failed"
  ) {
    return value;
  }
  return undefined;
}

function toModelFlowError(value: string | undefined): ModelFlowErrorCode | undefined {
  if (
    value === "project_not_found" ||
    value === "model_provider_name_required" ||
    value === "model_provider_key_required" ||
    value === "model_provider_type_unsupported" ||
    value === "model_provider_api_required" ||
    value === "model_provider_api_unsupported" ||
    value === "model_provider_base_url_invalid" ||
    value === "model_provider_api_key_env_invalid" ||
    value === "model_provider_model_id_required" ||
    value === "model_provider_model_limit_invalid" ||
    value === "model_provider_already_exists" ||
    value === "model_provider_not_found" ||
    value === "model_provider_disabled" ||
    value === "model_provider_in_use" ||
    value === "model_role_unsupported" ||
    value === "model_id_required" ||
    value === "model_route_not_found" ||
    value === "model_route_provider_invalid" ||
    value === "model_secret_reference_invalid" ||
    value === "model_routing_operation_failed"
  ) {
    return value;
  }
  return undefined;
}
