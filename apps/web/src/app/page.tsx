import { headers } from "next/headers";
import { LPPreview } from "../components/lp-preview";
import { createChatWorkbenchThread } from "../lib/chat-workbench";
import { createDemoWorkbenchSnapshot } from "../lib/demo-workbench";
import { createArtifactDownloadLinks, createDeploymentHandoffLink } from "../lib/export-links";
import { getWorkbenchCopy, resolveLocaleFromAcceptLanguage } from "../lib/i18n";

export default async function HomePage() {
  const requestHeaders = await headers();
  const copy = getWorkbenchCopy(
    resolveLocaleFromAcceptLanguage(requestHeaders.get("accept-language"))
  );
  const snapshot = await createDemoWorkbenchSnapshot();
  const { project, pageVersion, deployment } = snapshot;
  const downloadLinks = createArtifactDownloadLinks(pageVersion.artifacts, copy.exports);
  const handoffLink = createDeploymentHandoffLink(deployment, copy.exports);
  const chat = createChatWorkbenchThread({
    copy,
    prompt: snapshot.brief.prompt,
    objective: copy.demo.objective,
    pageVersion,
    deployment,
    downloadLinks,
    handoffLink
  });

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
          <div className="projectItem">
            <span>{project.repository}</span>
            <strong>{copy.demo.projectName}</strong>
          </div>
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
            <span>{copy.demo.projectName}</span>
          </div>
          <div className="topBarActions">
            <button type="button">{copy.chat.topbarShare}</button>
            <button type="button" className="trialButton">{copy.chat.topbarTrial}</button>
          </div>
        </header>

        <div className="conversationViewport">
          <div className="conversationStack">
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
                  <LPPreview artifacts={pageVersion.artifacts} />
                </section>
              </div>
            </article>

            <section className="suggestionBlock" aria-label={copy.chat.suggestionsTitle}>
              <div>{copy.chat.suggestionsTitle}</div>
              {chat.suggestions.map((suggestion) => (
                <button type="button" key={suggestion}>{suggestion}</button>
              ))}
            </section>
          </div>
        </div>

        <form className="composerDock">
          <div className="composer">
            <button type="button" aria-label={chat.composer.addAttachmentLabel}>+</button>
            <input aria-label={chat.composer.placeholder} placeholder={chat.composer.placeholder} />
            <span>{chat.composer.runtimeChip}</span>
            <button type="button" className="interruptButton">{chat.composer.interruptLabel}</button>
            <button type="button" className="sendButton">{chat.composer.sendLabel}</button>
          </div>
        </form>
      </section>
    </main>
  );
}
