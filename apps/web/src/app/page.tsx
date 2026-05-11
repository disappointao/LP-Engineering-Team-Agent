import { LPPreview } from "../components/lp-preview";
import { createDemoWorkbenchSnapshot } from "../lib/demo-workbench";

export default async function HomePage() {
  const snapshot = await createDemoWorkbenchSnapshot();
  const { project, brief, pageVersion, deployment, singleFileHtml } = snapshot;
  const primaryCta = pageVersion.artifacts.indexHtml.includes("Shop the sale")
    ? "Shop the sale"
    : brief.brief.cta.label;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">LP Engineering Team Agent</div>
        <nav className="navList" aria-label="Main navigation">
          <div className="navItem navItemActive">Workbench</div>
          <div className="navItem">Skills</div>
          <div className="navItem">MCP</div>
          <div className="navItem">Models</div>
          <div className="navItem">Deployments</div>
        </nav>
      </aside>

      <section className="content">
        <div className="topbar">
          <div className="titleGroup">
            <h1>{project.name}</h1>
            <p>{project.repository}</p>
          </div>
          <div className="statusPill">Review: {pageVersion.reviewStatus}</div>
        </div>

        <div className="grid">
          <section className="panel briefPanel">
            <h2>Structured LP Brief</h2>
            <div className="fieldList">
              <div className="field">
                <label>Prompt</label>
                <div>{brief.prompt}</div>
              </div>
              <div className="field">
                <label>Objective</label>
                <div>{brief.brief.objective}</div>
              </div>
              <div className="field">
                <label>Audience</label>
                <div>{brief.brief.audience}</div>
              </div>
              <div className="field">
                <label>Offer</label>
                <div>{brief.brief.offer}</div>
              </div>
              <div className="field">
                <label>Primary CTA</label>
                <div>{primaryCta} - {brief.brief.cta.href}</div>
              </div>
            </div>
          </section>

          <section className="panel previewPanel">
            <div className="panelHeader">
              <h2>Preview</h2>
              <span>static iframe</span>
            </div>
            <LPPreview artifacts={pageVersion.artifacts} />
          </section>

          <section className="panel">
            <h2>Page Sections</h2>
            <div className="sectionList">
              {brief.brief.sections.map((section) => (
                <article className="sectionItem" key={section.id}>
                  <strong>{section.type}</strong>
                  <p>{section.headline}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Agent Run and Delivery</h2>
            <div className="runList">
              <div className="runItem">
                <strong>Planner</strong>
                <p>Extracted the prompt into a structured LP brief.</p>
              </div>
              <div className="runItem">
                <strong>Builder</strong>
                <p>Generated index.html, styles.css, and script.js.</p>
              </div>
              <div className="runItem">
                <strong>Reviewer</strong>
                <p>
                  {pageVersion.findings.length === 0
                    ? "No blocking findings."
                    : `${pageVersion.findings.length} findings.`}
                </p>
              </div>
              <div className="runItem">
                <strong>Deployer</strong>
                <p>{deployment.branch} opened at {deployment.pullRequestUrl}</p>
              </div>
            </div>
            <div className="actions">
              <button className="button" type="button">Approve PR Handoff</button>
              <button className="button buttonSecondary" type="button">Export Three Files</button>
              <button className="button buttonSecondary" type="button">
                Export Single HTML ({singleFileHtml.length} bytes)
              </button>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
