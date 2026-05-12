import React from "react";
import { headers } from "next/headers";
import { createProjectAction, submitPromptAction } from "./actions";
import { LPPreview } from "../components/lp-preview";
import { createChatWorkbenchThread } from "../lib/chat-workbench";
import { createArtifactDownloadLinks, createDeploymentHandoffLink } from "../lib/export-links";
import { getWorkbenchCopy, resolveLocaleFromAcceptLanguage } from "../lib/i18n";
import { getWebWorkbenchStore, type ProjectFlowErrorCode } from "../lib/workbench-store";
import { getCurrentProjectId } from "../lib/workbench-session";

interface HomePageProps {
  searchParams?: Promise<{ error?: string }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const requestHeaders = await headers();
  const copy = getWorkbenchCopy(
    resolveLocaleFromAcceptLanguage(requestHeaders.get("accept-language"))
  );
  const params = await searchParams;
  const errorCode = toProjectFlowError(params?.error);
  const currentProjectId = await getCurrentProjectId();
  const pageState = await getWebWorkbenchStore().getPageState(currentProjectId);
  const activeProject = pageState.kind === "project_ready" ? pageState.snapshot.project : undefined;
  const errorMessage = errorCode ? copy.projectFlow.errors[errorCode] : undefined;
  const completedSnapshot =
    pageState.kind === "project_ready" &&
    pageState.snapshot.brief &&
    pageState.snapshot.currentPageVersion &&
    pageState.snapshot.deployment
      ? {
          brief: pageState.snapshot.brief,
          pageVersion: pageState.snapshot.currentPageVersion,
          deployment: pageState.snapshot.deployment
        }
      : undefined;
  const downloadLinks = completedSnapshot
    ? createArtifactDownloadLinks(completedSnapshot.pageVersion.artifacts, copy.exports)
    : undefined;
  const handoffLink = completedSnapshot
    ? createDeploymentHandoffLink(completedSnapshot.deployment, copy.exports)
    : undefined;
  const chat = completedSnapshot && downloadLinks && handoffLink
    ? createChatWorkbenchThread({
        copy,
        prompt: completedSnapshot.brief.prompt,
        objective: completedSnapshot.brief.brief.objective,
        pageVersion: completedSnapshot.pageVersion,
        deployment: completedSnapshot.deployment,
        downloadLinks,
        handoffLink
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
          <div className="navItem navItemActive">{copy.nav.workbench}</div>
          <div className="navItem">{copy.nav.skills}</div>
          <div className="navItem">{copy.nav.mcp}</div>
          <div className="navItem">{copy.nav.models}</div>
          <div className="navItem">{copy.nav.deployments}</div>
        </nav>

        <div className="sidebarSection">
          <div className="sidebarSectionTitle">{copy.sidebar.projectsLabel}</div>
          {pageState.projects.length > 0 ? (
            pageState.projects.map((project) => (
              <div
                className={project.id === activeProject?.id ? "projectItem projectItemActive" : "projectItem"}
                key={project.id}
              >
                <span>{project.repository}</span>
                <strong>{project.name}</strong>
              </div>
            ))
          ) : (
            <div className="projectItem">
              <span>{copy.projectFlow.localPersistenceNote}</span>
              <strong>{copy.projectFlow.createTitle}</strong>
            </div>
          )}
        </div>

        <div className="sidebarSection sidebarTasks">
          <div className="sidebarSectionTitle">{copy.sidebar.tasksLabel}</div>
          {copy.sidebar.taskTitles.map((taskTitle, index) => (
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
            <span>{activeProject?.name ?? copy.projectFlow.createTitle}</span>
          </div>
          <div className="topBarActions">
            <button type="button">{copy.chat.topbarShare}</button>
            <button type="button" className="trialButton">{copy.chat.topbarTrial}</button>
          </div>
        </header>

        <div className="conversationViewport">
          <div className="conversationStack">
            {pageState.kind === "no_project" ? (
              <section className="setupPanel" aria-labelledby="project-setup-title">
                <div>
                  <h1 id="project-setup-title">{copy.projectFlow.createTitle}</h1>
                  <p>{copy.projectFlow.createDescription}</p>
                </div>
                {errorMessage ? <div className="formError" role="alert">{errorMessage}</div> : null}
                <form action={createProjectAction} className="projectForm">
                  <label htmlFor="projectName">{copy.projectFlow.projectNameLabel}</label>
                  <input
                    id="projectName"
                    name="projectName"
                    placeholder={copy.projectFlow.projectNamePlaceholder}
                  />
                  <label htmlFor="repository">{copy.projectFlow.repositoryLabel}</label>
                  <input
                    id="repository"
                    name="repository"
                    placeholder={copy.projectFlow.repositoryPlaceholder}
                  />
                  <button type="submit">{copy.projectFlow.createProject}</button>
                </form>
                <p className="localNote">{copy.projectFlow.localPersistenceNote}</p>
              </section>
            ) : null}

            {pageState.kind === "project_ready" && !completedSnapshot ? (
              <section className="emptyProjectState" aria-labelledby="empty-project-title">
                <div>
                  <h1 id="empty-project-title">{copy.projectFlow.emptyTitle}</h1>
                  <p>{copy.projectFlow.emptyDescription}</p>
                </div>
                {errorMessage ? <div className="formError" role="alert">{errorMessage}</div> : null}
              </section>
            ) : null}

            {chat && handoffLink && completedSnapshot ? (
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
                        <span>{chat.toolEvents.length}/4</span>
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
                      <a className="allFilesCard" download={handoffLink.filename} href={handoffLink.href}>
                        {copy.chat.allFilesLabel}
                      </a>
                    </section>

                    <section className="inlinePreview" aria-label={copy.chat.previewTitle}>
                      <div className="previewTitle">{copy.chat.previewTitle}</div>
                      <LPPreview artifacts={completedSnapshot.pageVersion.artifacts} />
                    </section>
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
          <div className={activeProject ? "composer" : "composer composerDisabled"}>
            <button
              disabled={!activeProject}
              type="button"
              aria-label={composer.addAttachmentLabel}
            >
              +
            </button>
            <input
              aria-label={copy.projectFlow.promptLabel}
              disabled={!activeProject}
              name="prompt"
              placeholder={composer.placeholder}
            />
            <span>{composer.runtimeChip}</span>
            <button disabled={!activeProject} type="button" className="interruptButton">
              {composer.interruptLabel}
            </button>
            <button disabled={!activeProject} type="submit" className="sendButton">
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
    value === "repository_required" ||
    value === "prompt_required" ||
    value === "project_not_found" ||
    value === "generation_failed"
  ) {
    return value;
  }
  return undefined;
}
