import React from "react";
import { headers } from "next/headers";
import {
  bindSkillVersionAction,
  createProjectAction,
  createSkillDraftAction,
  publishSkillVersionAction,
  setSkillBindingEnabledAction,
  submitPromptAction,
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
  type ProjectFlowErrorCode,
  type SkillFlowErrorCode
} from "../lib/workbench-store";
import { getCurrentProjectId, getCurrentTaskId } from "../lib/workbench-session";

interface HomePageProps {
  searchParams?: Promise<{ error?: string; skillError?: string; view?: string }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const requestHeaders = await headers();
  const copy = getWorkbenchCopy(
    resolveLocaleFromAcceptLanguage(requestHeaders.get("accept-language"))
  );
  const params = await searchParams;
  const activeView = params?.view === "skills" ? "skills" : "workbench";
  const errorCode = toProjectFlowError(params?.error);
  const skillError = toSkillFlowError(params?.skillError);
  const currentProjectId = await getCurrentProjectId();
  const currentTaskId = await getCurrentTaskId();
  const pageState = await getWebWorkbenchStore().getPageState({
    projectId: currentProjectId,
    taskId: currentTaskId
  });
  const activeTask = pageState.kind === "task_ready" ? pageState.task : undefined;
  const activeProject =
    pageState.kind === "task_ready" && pageState.snapshot
      ? pageState.snapshot.project
      : pageState.projects.find((project) => project.id === currentProjectId);
  const errorMessage = errorCode ? copy.projectFlow.errors[errorCode] : undefined;
  const skillErrorMessage = skillError ? copy.skillsView.errors[skillError] : undefined;
  const activeSkillCount = pageState.skills.boundSkills.filter(
    (boundSkill) => boundSkill.binding.enabled
  ).length;
  const activeSkillLabel = copy.skillsView.activeCount(activeSkillCount);
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
            downloadLinks
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
          <div className="navItem">{copy.nav.mcp}</div>
          <div className="navItem">{copy.nav.models}</div>
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

      <section className="chatWorkspace" aria-label={copy.nav.workbench}>
        <header className="topBar">
          <div className="topBarTitle">
            <strong>{copy.chat.topbarModel}</strong>
            <span>{activeProject?.name ?? activeTask?.title ?? copy.sidebar.newTask}</span>
            {activeSkillCount > 0 ? (
              <span className="skillRuntimeChip">{activeSkillLabel}</span>
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
                            {version.version} · {copy.skillsView.statusLabels[version.reviewState]}
                          </span>
                        </div>
                        <div className="skillActions">
                          <form action={validateSkillVersionAction}>
                            <input name="skillVersionId" type="hidden" value={version.id} />
                            <button type="submit">{copy.skillsView.validate}</button>
                          </form>
                          <form action={publishSkillVersionAction}>
                            <input name="skillVersionId" type="hidden" value={version.id} />
                            <button type="submit">{copy.skillsView.publish}</button>
                          </form>
                          <form action={bindSkillVersionAction}>
                            <input name="projectId" type="hidden" value={activeProject?.id ?? ""} />
                            <input name="skillVersionId" type="hidden" value={version.id} />
                            <button type="submit">{copy.skillsView.bind}</button>
                          </form>
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
              </section>
            ) : null}

            {activeView === "workbench" && pageState.kind === "empty" ? (
              <section className="entryPanel" aria-labelledby="entry-title">
                <h1 id="entry-title">{copy.entry.title}</h1>
                {errorMessage ? <div className="formError" role="alert">{errorMessage}</div> : null}
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
            <button type="button" className="interruptButton">
              {composer.interruptLabel}
            </button>
            <button type="submit" className="sendButton">
              {composer.sendLabel}
            </button>
          </div>
        </form>
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

function toSkillFlowError(value: string | undefined): SkillFlowErrorCode | undefined {
  if (
    value === "invalid_manifest_json" ||
    value === "manifest_validation_failed" ||
    value === "unsupported_skill_scope" ||
    value === "duplicate_skill_version" ||
    value === "unsupported_content_type" ||
    value === "skill_content_required" ||
    value === "skill_content_too_large" ||
    value === "project_not_found" ||
    value === "skill_version_not_found" ||
    value === "skill_version_not_validated" ||
    value === "skill_version_not_published" ||
    value === "skill_binding_not_found" ||
    value === "publish_not_allowed" ||
    value === "skill_operation_failed"
  ) {
    return value;
  }
  return undefined;
}
