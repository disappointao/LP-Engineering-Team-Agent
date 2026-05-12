# Web Flow Without Git or Automatic Deployment Spec

Date: 2026-05-12
Status: approved for implementation

## Summary

This amendment updates the lightweight real Web project flow for the first usable Web version. Project creation no longer asks for or stores a Git repository URL, and the Web prompt flow no longer auto-creates deployment or PR handoff records. The Web workbench should focus on creating a local project, generating static LP artifacts, reviewing them, previewing them, and making the static files downloadable.

Deployment remains a future capability. Users can later run deployment through deployment skills or a dedicated deployment feature once the product shape is clearer.

## Goals

- Create projects from a project name only.
- Remove repository URL input, repository validation, and repository display from the Web flow.
- Remove `ProjectRecord.repository` and `CreateProjectInput.repository` from the shared domain model.
- Keep project state process-local for this Web MVP.
- Keep prompt submission focused on brief generation, static artifact generation, and review.
- Do not automatically call deployment handoff creation from Web prompt submission.
- Render chat progress as planner, builder, and reviewer only.
- Render downloadable static artifacts and preview, but no PR handoff card.
- Hide deployment navigation from the current Web shell.
- Keep deployment packages, deployment skills, and explicit deployment APIs available as future extension points.

## Non-Goals

- Designing the final deployment workflow.
- Removing `packages/git-deployment`.
- Removing deployment skill governance or deployer roles from non-Web extension packages.
- Adding GitHub, GitLab, CI/CD, or hosting-provider integration.
- Adding persistent project storage.

## Product Flow

### Project Creation

The setup panel asks only for project name. Submitting the form validates that the project name is not blank, creates a process-local project, sets the current-project cookie, and redirects to the workbench.

The sidebar project list displays the project name only. It must not expose a repository field or repository placeholder.

### Prompt Submission

The composer submits the LP prompt for the cookie-backed current project. The Web store executes:

1. `createBriefFromPrompt`
2. `generatePageVersion`
3. `reviewPageVersion`

It must not call `approveAndCreateDeployment`.

### Completed State

The completed conversation renders when the snapshot has a brief and current page version. Deployment is not required. The tool timeline contains planner, builder, and reviewer rows.

The artifact cards include:

- `index.single.html`
- `index.html`
- `styles.css`
- `script.js`

The completed state includes the static LP preview. It does not include `deployment-handoff.json`, PR links, deployment branches, or deployer metadata.

## Error Handling

Current Web project-flow error codes are:

- `project_name_required`
- `prompt_required`
- `project_not_found`
- `generation_failed`

`repository_required` is removed.

## Compatibility

The deployment adapter and explicit `approveAndCreateDeployment` API can stay in the repo for future work and tests. They are no longer part of the default Web prompt flow.

Future deployment can be added as one of these separate slices:

- a deployment skill that exposes command execution for generated files,
- a provider-specific deployment flow,
- a Git/PR handoff flow,
- a company ecommerce release adapter.

## Testing Requirements

Tests must cover:

- project creation accepts project name only,
- repository input and repository validation are absent from Web behavior,
- Web prompt submission produces reviewed artifacts without deployment,
- chat tool order is planner, builder, reviewer,
- artifact cards exclude deployment handoff,
- deployment navigation is hidden from the Web shell,
- typecheck catches stale `repository` references after the domain model change.
