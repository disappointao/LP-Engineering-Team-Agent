import { headers } from "next/headers";
import { LPPreview } from "../components/lp-preview";
import { createDemoWorkbenchSnapshot } from "../lib/demo-workbench";
import { createArtifactDownloadLinks, createDeploymentHandoffLink } from "../lib/export-links";
import { getWorkbenchCopy, resolveLocaleFromAcceptLanguage } from "../lib/i18n";

export default async function HomePage() {
  const requestHeaders = await headers();
  const copy = getWorkbenchCopy(
    resolveLocaleFromAcceptLanguage(requestHeaders.get("accept-language"))
  );
  const snapshot = await createDemoWorkbenchSnapshot();
  const { project, brief, pageVersion, deployment, singleFileHtml } = snapshot;
  const downloadLinks = createArtifactDownloadLinks(pageVersion.artifacts, copy.exports);
  const handoffLink = createDeploymentHandoffLink(deployment, copy.exports);
  const singleFileLink = downloadLinks[0];
  const threeFileLinks = downloadLinks.slice(1);
  const reviewStatus = copy.status[pageVersion.reviewStatus];
  const runItems = [
    copy.run.planner,
    copy.run.builder,
    [
      copy.run.reviewer[0],
      pageVersion.findings.length === 0
        ? copy.run.reviewer[1]
        : `${pageVersion.findings.length} ${copy.run.reviewerFindings}`
    ],
    [copy.run.deployer[0], `${deployment.branch} ${copy.run.deployer[1]}`]
  ];

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="brandBlock">
          <div className="brandMark">LP</div>
          <div>
            <div className="brand">{copy.sidebar.team}</div>
            <p>{copy.sidebar.mode}</p>
          </div>
        </div>
        <nav className="navList" aria-label={copy.nav.label}>
          <div className="navItem navItemActive">{copy.nav.workbench}</div>
          <div className="navItem">{copy.nav.skills}</div>
          <div className="navItem">{copy.nav.mcp}</div>
          <div className="navItem">{copy.nav.models}</div>
          <div className="navItem">{copy.nav.deployments}</div>
        </nav>
        <div className="sidebarMeta">
          <span>{copy.sidebar.modeLabel}</span>
          <strong>{copy.sidebar.mode}</strong>
          <span>{copy.sidebar.localeLabel}</span>
          <strong>{copy.localeName}</strong>
        </div>
      </aside>

      <section className="workspace">
        <header className="agentHero">
          <div className="heroTop">
            <div>
              <p className="eyebrow">{copy.hero.eyebrow}</p>
              <h1>{copy.hero.title}</h1>
            </div>
            <div className="statusPill">{copy.status.review}: {reviewStatus}</div>
          </div>
          <p className="heroSubtitle">{copy.hero.subtitle}</p>
          <div className="promptSurface">
            <span>{copy.hero.promptLabel}</span>
            <p>{copy.demo.prompt}</p>
            <div className="quickActions">
              {copy.hero.actionChips.map((chip) => (
                <button className="chip" type="button" key={chip}>{chip}</button>
              ))}
            </div>
          </div>
        </header>

        <div className="projectStrip">
          <div>
            <span>{project.repository}</span>
            <strong>{copy.demo.projectName}</strong>
          </div>
          <div>
            <span>{copy.sections.previewMode}</span>
            <strong>HTML / CSS / JS</strong>
          </div>
          <div>
            <span>{copy.nav.deployments}</span>
            <strong>{deployment.branch}</strong>
          </div>
        </div>

        <div className="workGrid">
          <section className="panel briefPanel">
            <h2>{copy.sections.brief}</h2>
            <div className="fieldList">
              <div className="field">
                <label>{copy.fields.prompt}</label>
                <div>{copy.demo.prompt}</div>
              </div>
              <div className="field">
                <label>{copy.fields.objective}</label>
                <div>{copy.demo.objective}</div>
              </div>
              <div className="field">
                <label>{copy.fields.audience}</label>
                <div>{copy.demo.audience}</div>
              </div>
              <div className="field">
                <label>{copy.fields.offer}</label>
                <div>{copy.demo.offer}</div>
              </div>
              <div className="field">
                <label>{copy.fields.primaryCta}</label>
                <div>{copy.demo.primaryCta} - {brief.brief.cta.href}</div>
              </div>
            </div>
          </section>

          <section className="panel previewPanel">
            <div className="panelHeader">
              <h2>{copy.sections.preview}</h2>
              <span>{copy.sections.previewMode}</span>
            </div>
            <LPPreview artifacts={pageVersion.artifacts} />
          </section>

          <section className="panel sectionsPanel">
            <h2>{copy.sections.pageSections}</h2>
            <div className="sectionList">
              {brief.brief.sections.map((section) => (
                <article className="sectionItem" key={section.id}>
                  <strong>{section.type}</strong>
                  <p>{section.headline}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="panel runPanel">
            <h2>{copy.sections.agentRun}</h2>
            <div className="runList">
              {runItems.map(([title, description]) => (
                <div className="runItem" key={title}>
                  <strong>{title}</strong>
                  <p>{description}</p>
                </div>
              ))}
            </div>
            <div className="actions">
              <a className="button" download={handoffLink.filename} href={handoffLink.href}>
                {handoffLink.label}
              </a>
              {threeFileLinks.map((link) => (
                <a
                  className="button buttonSecondary"
                  download={link.filename}
                  href={link.href}
                  key={link.filename}
                >
                  {link.label}
                </a>
              ))}
              {singleFileLink ? (
                <a
                  className="button buttonSecondary"
                  download={singleFileLink.filename}
                  href={singleFileLink.href}
                >
                  {singleFileLink.label} ({singleFileHtml.length} bytes)
                </a>
              ) : null}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
