# Skill Command Web Loop Design

Date: 2026-05-15

## Status

Approved direction: add a Web-facing simulated execution loop for published project-bound `deployment` skill commands.

This is Stage 4.1 after the controlled Skill Command Execution MVP. The backend command execution boundary already exists, but users cannot yet discover, approve, execute, or inspect those command runs from the Web workbench. This slice should make the product loop visible while keeping execution safe: Web V1 uses a mock runner and does not execute local shell commands.

## Context

The project already has:

- published project skills with manifest validation, binding, and runtime context loading;
- optional `manifest.commands` for `deployment` skills;
- `DemoWorkbenchService.executeProjectSkillCommand`;
- `ToolCommandRunner` with a default fail-closed rejecting runner;
- `ToolObservationRecord`;
- sanitized `tool.started`, `tool.completed`, and `tool.failed` run events;
- repository-backed run event loading in the Web workbench;
- Manus-style chat/timeline rendering for run events.

The current gap is product usability. The API can execute an approved command through an injected runner, but the Web app has no command launcher, no one-shot approval UI, no server action for command execution, and no user-facing result loop.

## Goals

- Let users see executable commands from project-bound, published `deployment` skills.
- Require a clear one-shot approval action before every command execution.
- Execute commands through the existing API method and validation path.
- Use a simulated `ToolCommandRunner` in Web V1 so no real shell command is run.
- Persist and display sanitized tool run events in the conversation timeline.
- Keep observation summaries metadata-only and avoid raw stdout/stderr.
- Localize command UI and error text in Chinese and English.
- Keep this slice compatible with later real runners, worker queues, streaming logs, cancel/retry, and MCP execution.

## Non-Goals

- No real shell execution from the Web app.
- No automatic deployment workflow.
- No hosted deployment provider integration.
- No background worker queue.
- No streaming stdout/stderr.
- No cancel, interrupt, retry, or resume.
- No MCP protocol execution.
- No reusable approval policy.
- No user/team auth model beyond the current local Web identity placeholder.
- No command editing UI beyond existing skill manifest management.

## Product Flow

When a project has bound published `deployment` skills with declared commands, Web should expose those commands as a project-level tool surface.

The first version should be intentionally simple:

1. User opens a project in the Web workbench.
2. User sees a "Skill Commands" area for bound deployment skills.
3. Each command card shows skill name, command name, description, required permission, and simulated execution status.
4. User explicitly approves execution with a one-shot action.
5. Web submits `projectId`, `skillVersionId`, `commandId`, optional current `pageVersionId`, and a local approved user id.
6. API revalidates all hidden form values and project ownership before invoking the runner.
7. The mock runner returns a deterministic completed or failed result.
8. Web redirects back to the workbench and reloads run events.
9. The conversation timeline shows the command start and completion/failure events.

The UI must make simulation clear. Button and status copy should use language such as "Approve and simulate" / "批准并模拟执行" instead of "Deploy" or "Run in terminal".

## Web Placement

V1 should avoid creating a full deployment product area.

Recommended placement:

- Add a `Skill Commands` section inside the existing project Skills view when a project is active.
- Add only a compact summary in the main workbench if this can be done without crowding the conversation view.
- Use the existing run event timeline for execution history instead of a separate logs page.

The Skills view is the best first home because commands are declared by skills, and the user can reason about command scope, permissions, and publish/bind state in one place.

## Command Discovery

Web should derive executable commands from existing project skill state:

- include only bound skill versions;
- include only `manifest.type === "deployment"`;
- include only `manifest.review.state === "published"`;
- include only commands declared in `manifest.commands`;
- show disabled or explanatory empty states when no eligible command exists.

The UI may derive this from already loaded `ProjectBoundSkillState` data if enough manifest details are available. If not, add a store-level selector or service method such as `listProjectSkillCommands(projectId)` that returns a sanitized view model.

The command view model should not expose raw command lines, env values, or secret refs. It may expose:

- skill id;
- skill version id;
- skill display name;
- command id;
- command display name;
- description;
- permission;
- `requiresApproval`;
- whether the current project has a current page version available.

## One-Shot Approval

Every execution requires approval in V1.

The Web UI should use an explicit submit action, not an automatic background call. A form submission is acceptable for the first slice.

The approval identity can be a deterministic local placeholder such as `local-web-user` until real auth exists. This placeholder must be treated only as local approval metadata and not as a security identity.

Hidden fields are untrusted. The API service remains responsible for validating:

- project exists;
- skill version exists;
- skill is bound and enabled for the project;
- skill is a published deployment skill;
- command exists;
- command permission is permitted by binding;
- required secret refs are declared;
- optional page version belongs to the project;
- template variables resolve;
- `approvedByUserId` is present.

## Simulated Runner

Introduce a Web-safe mock runner, either in `packages/api` or in Web test/support code, that implements `ToolCommandRunner`.

Requirements:

- never imports or calls `child_process`;
- never interprets command strings with shell syntax;
- returns deterministic results based on `commandId` and/or test input;
- supports completed and failed outcomes for tests;
- returns bounded stdout/stderr strings so observation summaries can be verified;
- preserves the same `ToolCommandRunner` interface used by future real runners.

The default `DemoWorkbenchService` constructor should continue to fail closed when no runner is injected. The Web workbench may inject the simulated runner explicitly for this local MVP.

## Data Flow

```text
Web page state
  -> derive command cards from active project skill state
  -> user approves command
  -> executeSkillCommandAction(formData)
  -> WebWorkbenchStore.executeSkillCommand(input)
  -> DemoWorkbenchService.executeProjectSkillCommand(input)
  -> existing API validation
  -> simulated ToolCommandRunner.run(input)
  -> ToolObservationRecord saved
  -> run events saved
  -> redirect back to Web workbench
  -> page state reloads project run events
  -> chat timeline renders tool events
```

This flow should not add a second command execution path. Web must call the existing API/service method rather than duplicating validation in the action.

## Run Events and Timeline

The first Web timeline should render existing event records rather than inventing a separate execution log format.

For successful simulated execution:

- `tool.started`
- `tool.completed`
- `run.completed`

For failed simulated execution:

- `tool.started`
- `tool.failed`
- `run.failed`

The timeline should display:

- command label;
- skill label;
- event status;
- exit code when present;
- output summary such as stdout/stderr character counts;
- sanitized error name when present.

The timeline must not display:

- raw stdout;
- raw stderr;
- raw command string;
- env values;
- secret names when avoidable;
- artifact contents.

## Error Handling

Web action errors should redirect back to the relevant view with a localized error code.

Suggested first error codes:

- `project_not_found`
- `skill_command_not_found`
- `skill_command_not_bound`
- `skill_command_not_deployment`
- `skill_command_not_published`
- `skill_command_permission_denied`
- `skill_command_approval_required`
- `skill_command_page_version_not_found`
- `skill_command_unknown_template_variable`
- `skill_command_execution_failed`

The Web copy should explain that execution is simulated in this stage. Validation failures should be shown as command setup or approval errors, not as model failures.

## Security and Safety

The important safety property of this slice is that it proves the Web workflow without increasing command execution risk.

Rules:

- No Web code should execute shell commands.
- The simulated runner must not use `child_process`.
- API validation remains authoritative.
- The UI must not imply real deployment happened.
- Observation output remains metadata-only.
- Form fields are never trusted without service validation.
- Secrets remain unresolved in Web V1 unless a later implementation explicitly adds a secret provider.

This keeps the architecture ready for real execution while making the current behavior safe for local development.

## Internationalization

Add Chinese and English copy for:

- command section title;
- empty state;
- approval button;
- simulated execution label;
- success/failure status;
- localized error messages.

The page should continue to use the existing locale detection and `getWorkbenchCopy` flow.

## Testing Strategy

Unit and integration coverage should include:

- command discovery includes only bound published deployment skill commands;
- non-deployment skills do not render executable command actions;
- unpublished deployment skill commands are not executable from Web;
- Web action submits project id, skill version id, command id, optional page version id, and local approval id;
- action maps service validation errors to localized redirect codes;
- simulated runner is injected only through the Web workbench store/service factory;
- command execution creates sanitized run events visible in page state;
- chat timeline renders `tool.started`, `tool.completed`, and `tool.failed` records;
- no raw stdout/stderr appears in rendered HTML;
- Chinese and English copy both include the simulated execution wording.

Verification commands:

```bash
pnpm test
pnpm typecheck
```

## Acceptance Criteria

- A user can open the Web workbench for an active project and discover eligible skill commands.
- A user can explicitly approve a command and receive a simulated execution result.
- The command execution goes through `executeProjectSkillCommand`.
- The Web timeline shows sanitized tool progress and completion/failure events.
- The UI clearly states that execution is simulated.
- No real shell command can be executed by this slice.
- Existing tests and type checks pass.

## Future Extensions

Later slices can build on this without changing the user-facing workflow:

- dev-only real local runner behind an explicit environment switch;
- worker-backed command execution;
- streaming log artifacts;
- cancel/retry/resume;
- deployment provider adapters;
- MCP execution reusing `ToolObservationRecord`;
- team approval and role-based permissions;
- richer command parameter forms.
