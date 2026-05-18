import React from "react";
import { headers } from "next/headers";
import {
  bindSkillVersionAction,
  createMCPConnectorAction,
  createProjectAction,
  executeSkillCommandAction,
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
  createGeneralTaskThread
} from "../lib/chat-workbench";
import { createArtifactDownloadLinks } from "../lib/export-links";
import { getWorkbenchCopy, resolveLocaleFromAcceptLanguage } from "../lib/i18n";
import {
  getWebWorkbenchStore,
  type InterruptFlowErrorCode,
  type MCPFlowErrorCode,
  type ModelFlowErrorCode,
  type ProjectMCPState,
  type ProjectFlowErrorCode,
  type SkillFlowErrorCode,
  type WebProjectModelState,
  type WorkbenchPageState
} from "../lib/workbench-store";
import { getCurrentProjectId, getCurrentTaskId } from "../lib/workbench-session";
import { InterruptSubmitButton } from "./interrupt-submit-button";

interface HomePageProps {
  searchParams?: Promise<{
    error?: string;
    skillError?: string;
    modelError?: string;
    mcpError?: string;
    interruptError?: string;
    view?: string;
  }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const requestHeaders = await headers();
  const copy = getWorkbenchCopy(
    resolveLocaleFromAcceptLanguage(requestHeaders.get("accept-language"))
  );
  const params = await searchParams;
  const activeView =
    params?.view === "skills"
      ? "skills"
      : params?.view === "mcp"
        ? "mcp"
        : params?.view === "models"
          ? "models"
          : "workbench";
  const errorCode = toProjectFlowError(params?.error);
  const skillError = toSkillFlowError(params?.skillError);
  const mcpError = toMCPFlowError(params?.mcpError);
  const modelError = toModelFlowError(params?.modelError);
  const interruptError = toInterruptFlowError(params?.interruptError);
  const currentProjectId = await getCurrentProjectId();
  const currentTaskId = await getCurrentTaskId();
  const pageState = await getWebWorkbenchStore().getPageState({
    projectId: currentProjectId,
    taskId: currentTaskId
  });
  const modelState = getPageModelState(pageState);
  const mcpState = getPageMCPState(pageState);
  const activeTask = pageState.kind === "task_ready" ? pageState.task : undefined;
  const activeProject =
    pageState.kind === "task_ready" && pageState.snapshot
      ? pageState.snapshot.project
      : pageState.projects.find((project) => project.id === currentProjectId) ??
        pageState.projects.find((project) => project.id === activeTask?.projectId);
  const errorMessage = errorCode ? copy.projectFlow.errors[errorCode] : undefined;
  const skillErrorMessage = skillError ? copy.skillsView.errors[skillError] : undefined;
  const mcpErrorMessage = mcpError ? copy.mcpView.errors[mcpError] : undefined;
  const modelErrorMessage = modelError
    ? copy.modelsView.errors[modelError]
    : modelState.resolutionError
      ? copy.modelsView.errors[modelState.resolutionError]
      : undefined;
  const interruptErrorMessage = interruptError
    ? copy.interruptFlow.errors[interruptError]
    : undefined;
  const roleOrder = ["planner", "builder", "reviewer", "deployer"] as const;
  const builderModelRoute = modelState.resolvedPolicy.builder;
  const builderModelLabel = copy.chat.builderModelRoute(
    `${builderModelRoute.provider}/${builderModelRoute.model}`
  );
  const activeSkillCount = pageState.skills.boundSkills.filter(
    (boundSkill) =>
      boundSkill.binding.enabled &&
      boundSkill.version.reviewState === "published" &&
      boundSkill.version.manifest.reviewState === "published"
  ).length;
  const boundSkillVersionIds = new Set(
    pageState.skills.boundSkills.map((boundSkill) => boundSkill.version.id)
  );
  const activeSkillLabel = copy.skillsView.activeCount(activeSkillCount);
  const currentPageVersionId =
    pageState.kind === "task_ready"
      ? pageState.snapshot?.currentPageVersion?.id
      : undefined;
  const skillCommands = pageState.skillCommands ?? [];
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
            runEvents: pageState.runEvents
          })
        : createGeneralTaskThread({
            copy,
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
          <button className="sidebarAction" type="button">{copy.sidebar.newTask}</button>
        </div>

        <nav className="navList" aria-label={copy.nav.label}>
          <a className={activeView === "workbench" ? "navItem navItemActive" : "navItem"} href="/">
            {copy.nav.workbench}
          </a>
          <a className={activeView === "skills" ? "navItem navItemActive" : "navItem"} href="/?view=skills">
            {copy.nav.skills}
          </a>
          <a className={activeView === "mcp" ? "navItem navItemActive" : "navItem"} href="/?view=mcp">
            {copy.nav.mcp}
          </a>
          <a className={activeView === "models" ? "navItem navItemActive" : "navItem"} href="/?view=models">
            {copy.nav.models}
          </a>
        </nav>

        <div className="sidebarSection">
          <div className="sidebarSectionTitle">{copy.sidebar.projectsLabel}</div>
          {pageState.projects.length > 0
            ? pageState.projects.map((project) => (
                <div
                  className={project.id === activeProject?.id ? "projectItem projectItemActive" : "projectItem"}
                  key={project.id}
                >
                  <strong>{project.name}</strong>
                </div>
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
                <button
                  className={task.id === activeTask?.id ? "taskItem taskItemActive" : "taskItem"}
                  type="button"
                  key={task.id}
                >
                  {task.title}
                </button>
              ))
            : copy.sidebar.taskTitles.map((taskTitle, index) => (
                <button
                  className={index === 0 ? "taskItem taskItemActive" : "taskItem"}
                  type="button"
                  key={taskTitle}
                >
                  {taskTitle}
                </button>
              ))}
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
          activeView === "skills"
            ? copy.nav.skills
            : activeView === "mcp"
              ? copy.nav.mcp
              : activeView === "models"
                ? copy.nav.models
                : copy.nav.workbench
        }
      >
        <header className="topBar">
          <div className="topBarTitle">
            <strong>{copy.chat.topbarModel}</strong>
            <span>{activeProject?.name ?? activeTask?.title ?? copy.sidebar.newTask}</span>
            {activeSkillCount > 0 ? (
              <span className="skillRuntimeChip">{activeSkillLabel}</span>
            ) : null}
            {activeView === "workbench" ? (
              <span className="modelRuntimeChip">{builderModelLabel}</span>
            ) : null}
          </div>
          <div className="topBarActions">
            <button type="button">{copy.chat.topbarShare}</button>
            <button type="button" className="trialButton">{copy.chat.topbarTrial}</button>
          </div>
        </header>

        <div className="conversationViewport">
          <div className="conversationStack">
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

                <div className="skillsProjectContext">
                  <span>{copy.skillsView.activeProjectLabel}</span>
                  <strong>{activeProject?.name ?? copy.skillsView.noProject}</strong>
                </div>

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
                      <button type="submit">{copy.skillsView.createDraft}</button>
                    </form>

                    <section className="skillsList" aria-labelledby="skill-versions-title">
                      <h2 id="skill-versions-title">{copy.skillsView.versionsTitle}</h2>
                      {pageState.skills.availableVersions.length > 0 ? (
                        pageState.skills.availableVersions.map((version) => (
                          <div className="skillRow" key={version.id}>
                            <div>
                              <strong>{version.manifest.name}</strong>
                              <span>
                                {version.version} ·{" "}
                                {copy.skillsView.statusLabels[version.reviewState]}
                              </span>
                            </div>
                            <div className="skillActions">
                              {version.reviewState === "draft" ? (
                                <form action={validateSkillVersionAction}>
                                  <input name="skillVersionId" type="hidden" value={version.id} />
                                  <button type="submit">{copy.skillsView.validate}</button>
                                </form>
                              ) : null}
                              {version.reviewState === "validated" ? (
                                <form action={publishSkillVersionAction}>
                                  <input name="skillVersionId" type="hidden" value={version.id} />
                                  <button type="submit">{copy.skillsView.publish}</button>
                                </form>
                              ) : null}
                              {version.reviewState === "published" && !boundSkillVersionIds.has(version.id) ? (
                                <form action={bindSkillVersionAction}>
                                  <input name="projectId" type="hidden" value={activeProject.id} />
                                  <input name="skillVersionId" type="hidden" value={version.id} />
                                  <button type="submit">{copy.skillsView.bind}</button>
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
                                <button type="submit">
                                  {boundSkill.binding.enabled
                                    ? copy.skillsView.disable
                                    : copy.skillsView.enable}
                                </button>
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
                        </div>
                        <span>{copy.skillsView.commandSimulationLabel}</span>
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
                                <button type="submit">
                                  {copy.skillsView.approveAndSimulate}
                                </button>
                              </form>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p>{copy.skillsView.emptyCommands}</p>
                      )}
                    </section>
                  </>
                ) : null}
              </section>
            ) : null}

            {activeView === "mcp" ? (
              <section className="mcpView" aria-labelledby="mcp-title">
                <header className="mcpHeader">
                  <div>
                    <h1 id="mcp-title">{copy.mcpView.title}</h1>
                    <p>{copy.mcpView.subtitle}</p>
                  </div>
                </header>

                {mcpErrorMessage ? (
                  <div className="formError" role="alert">{mcpErrorMessage}</div>
                ) : null}

                <div className="mcpProjectContext">
                  <span>{copy.mcpView.activeProjectLabel}</span>
                  <strong>{activeProject?.name ?? copy.mcpView.noProject}</strong>
                </div>

                {activeProject ? (
                  <>
                    <form action={createMCPConnectorAction} className="mcpEditor">
                      <h2>{copy.mcpView.createTitle}</h2>
                      <input name="projectId" type="hidden" value={activeProject.id} />
                      <label htmlFor="definitionJson">{copy.mcpView.definitionLabel}</label>
                      <textarea
                        id="definitionJson"
                        name="definitionJson"
                        placeholder={copy.mcpView.definitionPlaceholder}
                      />
                      <button type="submit">{copy.mcpView.createConnector}</button>
                    </form>

                    <section className="mcpList" aria-labelledby="mcp-connectors-title">
                      <h2 id="mcp-connectors-title">{copy.mcpView.connectorsTitle}</h2>
                      {mcpState.connectors.length > 0 ? (
                        mcpState.connectors.map((connector, connectorIndex) => {
                          const renderConnector = toRenderableMCPConnector(
                            connector,
                            connectorIndex,
                            copy.mcpView.invalidConnectorName
                          );
                          return (
                            <div className="mcpConnectorRow" key={renderConnector.id}>
                              <div>
                                <strong>{renderConnector.name}</strong>
                                <small>{renderConnector.id}</small>
                                <span>
                                  {renderConnector.enabled
                                    ? copy.mcpView.enabled
                                    : copy.mcpView.disabled}
                                </span>
                              </div>
                              <form action={setMCPConnectorEnabledAction}>
                                <input name="projectId" type="hidden" value={activeProject.id} />
                                <input name="connectorId" type="hidden" value={renderConnector.id} />
                                <input
                                  name="enabled"
                                  type="hidden"
                                  value={renderConnector.enabled ? "false" : "true"}
                                />
                                <button type="submit">
                                  {renderConnector.enabled
                                    ? copy.mcpView.disable
                                    : copy.mcpView.enable}
                                </button>
                              </form>
                              <div className="mcpToolGrid" aria-label={copy.mcpView.toolsTitle}>
                                {renderConnector.tools.map((tool) => {
                                  const approval = mcpState.approvals.find(
                                    (record) =>
                                      record.connectorId === renderConnector.id &&
                                      record.toolName === tool.name &&
                                      record.state === "approved"
                                  );
                                  return (
                                    <div className="mcpToolCard" key={tool.name}>
                                      <strong>{tool.name}</strong>
                                      <span>{copy.mcpView.permissionSummary(tool.permission)}</span>
                                      <small>
                                        {copy.mcpView.rolesSummary(
                                          toMCPRoleLabels(tool.roles, copy.mcpView.roleLabels)
                                        )}
                                      </small>
                                      <small>
                                        {tool.requiresApproval
                                          ? copy.mcpView.approvalRequired
                                          : copy.mcpView.approvalNotRequired}
                                      </small>
                                      {tool.requiresApproval ? (
                                        <form action={setMCPToolApprovalAction}>
                                          <input
                                            name="projectId"
                                            type="hidden"
                                            value={activeProject.id}
                                          />
                                          <input
                                            name="connectorId"
                                            type="hidden"
                                            value={renderConnector.id}
                                          />
                                          <input name="toolName" type="hidden" value={tool.name} />
                                          <input
                                            name="approved"
                                            type="hidden"
                                            value={approval ? "false" : "true"}
                                          />
                                          <button type="submit">
                                            {approval ? copy.mcpView.revoke : copy.mcpView.approve}
                                          </button>
                                        </form>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p>{copy.mcpView.emptyConnectors}</p>
                      )}
                    </section>

                    <section className="mcpList" aria-labelledby="mcp-visible-tools-title">
                      <h2 id="mcp-visible-tools-title">{copy.mcpView.visibleToolsTitle}</h2>
                      {roleOrder.map((role) => (
                        <div className="mcpVisibleRole" key={role}>
                          <strong>{copy.mcpView.roleLabels[role]}</strong>
                          {(mcpState.visibleToolsByRole[role] ?? []).length > 0 ? (
                            <span>
                              {mcpState.visibleToolsByRole[role]
                                .map((tool) => `${tool.connectorId}.${tool.name}`)
                                .join(", ")}
                            </span>
                          ) : (
                            <span>{copy.mcpView.emptyVisibleTools}</span>
                          )}
                        </div>
                      ))}
                    </section>
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
                  </div>
                </header>

                {modelErrorMessage ? (
                  <div className="formError" role="alert">{modelErrorMessage}</div>
                ) : null}

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
                      <small id="base-url-example">https://api.openai.com/v1</small>

                      <label htmlFor="apiKeyEnv">{copy.modelsView.apiKeyEnvLabel}</label>
                      <input
                        id="apiKeyEnv"
                        name="apiKeyEnv"
                        aria-describedby="api-key-env-example"
                      />
                      <small id="api-key-env-example">ANTHROPIC_API_KEY</small>

                      <label htmlFor="modelId">{copy.modelsView.providerModelIdLabel}</label>
                      <input id="modelId" name="modelId" aria-describedby="model-id-example" />
                      <small id="model-id-example">glm-5.1</small>

                      <button type="submit">{copy.modelsView.createProvider}</button>
                    </form>

                    <section className="modelsList" aria-labelledby="model-providers-title">
                      <h2 id="model-providers-title">{copy.modelsView.providersTitle}</h2>
                      {modelState.providers.length > 0 ? (
                        modelState.providers.map((provider) => (
                          <div className="modelRow" key={provider.id}>
                            <div>
                              <strong>{provider.name}</strong>
                              <span>
                                {copy.modelsView.providerTypes[provider.provider]} ·{" "}
                                {provider.config.api ?? "legacy"} ·{" "}
                                {provider.config.baseUrl
                                  ? copy.modelsView.baseUrlConfigured
                                  : copy.modelsView.fallbackLabel} ·{" "}
                                {provider.config.apiKeyEnv || provider.config.secretEnvName
                                  ? copy.modelsView.apiKeyEnvConfigured
                                  : copy.modelsView.fallbackLabel} ·{" "}
                                {provider.enabled
                                  ? copy.modelsView.enabled
                                  : copy.modelsView.disabled}
                              </span>
                            </div>
                            <form action={setModelProviderEnabledAction}>
                              <input name="projectId" type="hidden" value={activeProject.id} />
                              <input name="providerId" type="hidden" value={provider.id} />
                              <input
                                name="enabled"
                                type="hidden"
                                value={provider.enabled ? "false" : "true"}
                              />
                              <button type="submit">
                                {provider.enabled
                                  ? copy.modelsView.disable
                                  : copy.modelsView.enable}
                              </button>
                            </form>
                          </div>
                        ))
                      ) : (
                        <p>{copy.modelsView.fallbackLabel}</p>
                      )}
                    </section>

                    <section className="modelsList" aria-labelledby="model-routes-title">
                      <h2 id="model-routes-title">{copy.modelsView.routesTitle}</h2>
                      {roleOrder.map((role) => {
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
                            <button type="submit" disabled={enabledProviders.length === 0}>
                              {copy.modelsView.saveRoute}
                            </button>
                          </form>
                        );
                      })}
                    </section>

                    <section className="modelsList" aria-labelledby="resolved-routes-title">
                      <h2 id="resolved-routes-title">{copy.modelsView.resolvedTitle}</h2>
                      {roleOrder.map((role) => {
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

            {activeView === "workbench" && pageState.kind === "empty" ? (
              <section className="entryPanel" aria-labelledby="entry-title">
                <h1 id="entry-title">{copy.entry.title}</h1>
                {errorMessage ? <div className="formError" role="alert">{errorMessage}</div> : null}
                {interruptErrorMessage ? (
                  <div className="formError" role="alert">{interruptErrorMessage}</div>
                ) : null}
                <div className="entryComposerShell">
                  <p>{copy.entry.placeholder}</p>
                  <div className="entryChipRow">
                    {copy.entry.chips.map((chip) => (
                      <button type="button" key={chip}>{chip}</button>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}

            {activeView === "workbench" && chat ? (
              <>
                {errorMessage ? <div className="formError" role="alert">{errorMessage}</div> : null}
                {interruptErrorMessage ? (
                  <div className="formError" role="alert">{interruptErrorMessage}</div>
                ) : null}
                <div className="userTurn" aria-label={copy.chat.userLabel}>
                  <div className="messageBubble userMessage">{chat.userMessage}</div>
                </div>

                <article className="assistantTurn">
                  <div className="assistantIdentity">
                    <div className="assistantAvatar">LP</div>
                    <strong>{chat.assistantName}</strong>
                    <span>{chat.assistantBadge}</span>
                  </div>

                  <div className="assistantMessage">
                    <p>{chat.assistantIntro}</p>

                    <section className="processBlock" aria-label={copy.chat.toolsTitle}>
                      <div className="processHeader">
                        <strong>{copy.chat.toolsTitle}</strong>
                        <span>{chat.toolEvents.length}/{chat.toolEvents.length}</span>
                      </div>
                      <div className="toolTimeline">
                        {chat.toolEvents.map((event) => (
                          <div className="toolEvent" key={event.id}>
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

                    <p>{chat.assistantCompletion}</p>

                    {completedSnapshot ? (
                      <>
                        <section className="deliveryBlock" aria-label={copy.chat.artifactsTitle}>
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
                                <small>{artifact.bytes.toLocaleString(copy.locale)} bytes</small>
                              </a>
                            ))}
                          </div>
                        </section>

                        <section className="inlinePreview" aria-label={copy.chat.previewTitle}>
                          <div className="previewTitle">{copy.chat.previewTitle}</div>
                          <LPPreview artifacts={completedSnapshot.pageVersion.artifacts} />
                        </section>
                      </>
                    ) : null}
                  </div>
                </article>

                <section className="suggestionBlock" aria-label={copy.chat.suggestionsTitle}>
                  <div>{copy.chat.suggestionsTitle}</div>
                  {chat.suggestions.map((suggestion) => (
                    <button type="button" key={suggestion}>{suggestion}</button>
                  ))}
                </section>
              </>
            ) : null}
          </div>
        </div>

        {activeView === "workbench" ? (
          <form action={submitPromptAction} className="composerDock">
            <input name="projectId" type="hidden" value={activeProject?.id ?? ""} />
            <input name="implicitProjectName" type="hidden" value={copy.entry.implicitProjectName} />
            <div className="composer">
              <button
                type="button"
                aria-label={composer.addAttachmentLabel}
              >
                +
              </button>
              <input
                aria-label={copy.projectFlow.promptLabel}
                name="prompt"
                placeholder={pageState.kind === "empty" ? copy.entry.placeholder : composer.placeholder}
              />
              <span>{composer.runtimeChip}</span>
              <InterruptSubmitButton
                action={interruptCurrentTaskAction}
                available={pageState.kind === "task_ready" && pageState.interrupt.available}
                labels={{
                  idle: composer.interruptLabel,
                  stopping: copy.chat.interruptStoppingLabel,
                  unavailable: copy.chat.interruptUnavailableLabel
                }}
              />
              <button type="submit" className="sendButton">
                {composer.sendLabel}
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </main>
  );
}

function toProjectFlowError(value: string | undefined): ProjectFlowErrorCode | undefined {
  if (
    value === "project_name_required" ||
    value === "prompt_required" ||
    value === "project_not_found" ||
    value === "generation_failed"
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

function getPageModelState(pageState: { models?: WebProjectModelState }): WebProjectModelState {
  return pageState.models ?? {
    providers: [],
    routes: [],
    resolvedPolicy: {
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
      planner: [],
      builder: [],
      reviewer: [],
      deployer: []
    }
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

interface RenderableMCPTool {
  name: string;
  permission: string;
  roles: unknown;
  requiresApproval: boolean;
}

interface RenderableMCPConnector {
  id: string;
  name: string;
  enabled: boolean;
  tools: RenderableMCPTool[];
}

function toRenderableMCPConnector(
  connector: unknown,
  index: number,
  invalidConnectorName: string
): RenderableMCPConnector {
  const source = isRecord(connector) ? connector : {};
  const id = normalizeDisplayString(source.id) || `connector_invalid_${index + 1}`;
  const name = normalizeDisplayString(source.name) || invalidConnectorName;
  const tools = Array.isArray(source.tools)
    ? source.tools.map(toRenderableMCPTool).filter(isDefined)
    : [];
  return {
    id,
    name,
    enabled: source.enabled === true,
    tools
  };
}

function toRenderableMCPTool(tool: unknown, index: number): RenderableMCPTool | undefined {
  if (!isRecord(tool)) {
    return undefined;
  }
  const name = normalizeDisplayString(tool.name) || `tool_invalid_${index + 1}`;
  const permission = normalizeDisplayString(tool.permission) || "unknown";
  return {
    name,
    permission,
    roles: tool.roles,
    requiresApproval: tool.requiresApproval === true
  };
}

function toMCPRoleLabels(roles: unknown, roleLabels: Record<string, string>): string[] {
  if (!Array.isArray(roles)) {
    return [];
  }
  return roles.flatMap((role) => {
    if (typeof role !== "string") {
      return [];
    }
    const label = roleLabels[role];
    return label ? [label] : [];
  });
}

function normalizeDisplayString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
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
    value === "skill_command_page_version_not_found" ||
    value === "skill_command_unknown_template_variable" ||
    value === "skill_command_execution_failed"
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
    value === "mcp_operation_failed"
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
