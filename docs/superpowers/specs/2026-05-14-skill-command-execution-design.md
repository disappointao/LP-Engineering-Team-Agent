# Skill Command Execution Design

Date: 2026-05-14

## Status

Approved direction: add a controlled command execution MVP for published `deployment` skills. The first version executes only commands declared in the skill manifest, requires explicit approval for every execution, records structured tool observations, and writes sanitized run events.

This is the first Stage 4 tool execution slice after the Stage 3 real model runtime and structured Planner/Builder output work. It should establish the execution boundary that later MCP tools, deployment skills, file operations, and worker-backed runs can reuse.

## Context

The project already has:

- `packages/skills` with `SkillManifestSchema`, skill types, scopes, permissions, required secrets, entrypoints, and publish/use rules.
- `packages/api` with project skill draft/publish/binding flows and runtime context loading.
- `packages/db` repositories for runs, run events, and `ToolObservationRecord`.
- `packages/mcp-gateway` with tool visibility and approval filtering, but no real tool execution.
- `packages/runtime-adapters` with role contexts that include skills, visible MCP tools, approval state, and artifact workspace metadata.
- `docs/agent-development-learning.md` that identifies tool execution and tool observations as the next Agent development milestone.

The current gap is that skills can influence context, but they cannot expose a safe executable command interface. Deployment remains a handoff boundary rather than a command-capable skill workflow.

## Goals

- Let a published project-bound `deployment` skill declare executable commands in its manifest.
- Execute only predeclared commands; never allow arbitrary user-supplied shell input.
- Require explicit approval for every command execution in V1.
- Resolve command arguments from controlled variables, not free-form shell strings.
- Run commands through a `ToolCommandRunner` adapter so execution can move to `apps/agent-worker` later.
- Persist every command result as a structured tool observation.
- Write ordered run events for command start, completion, and failure.
- Keep raw secrets, raw environment values, and excessive stdout/stderr out of run event payloads.
- Preserve the existing MCP connector registry as a separate concern; this slice should not implement MCP protocol execution.

## Non-Goals

- No arbitrary shell terminal in Web/API.
- No MCP connector execution.
- No automatic deployment product workflow.
- No long-running background queue.
- No streaming stdout/stderr.
- No cancel/interrupt behavior.
- No real secret manager integration.
- No OS-level sandbox guarantee in the local runner.
- No project-wide reusable approval policy.
- No command execution from non-deployment skills.
- No Web command management UI beyond the service/API surface needed by later slices.

## Skill Manifest Extension

`SkillManifestSchema` should add an optional `commands` array. Existing manifests remain valid when `commands` is absent.

V1 command shape:

```ts
interface SkillCommandManifest {
  id: string;
  name: string;
  description?: string;
  permission: string;
  requiresApproval: boolean;
  command: string;
  args: string[];
  env?: SkillCommandEnvBinding[];
  workingDirectory?: string;
  timeoutMs?: number;
}

interface SkillCommandEnvBinding {
  name: string;
  value?: string;
  secretRef?: string;
}
```

Rules:

- `id`, `name`, `permission`, `command`, and `args` are required.
- `requiresApproval` is required for clarity, but V1 still requires approval on every execution even if the manifest sets it to `false`.
- `command` is an executable identifier, not a shell command line.
- `args` are an argv array after template expansion.
- Shell syntax such as pipes, redirects, command separators, and inline arbitrary script blocks are not interpreted by the command runner.
- Each env binding must set exactly one of `value` or `secretRef`.
- `secretRef` values must be listed in `manifest.requiredSecrets`.
- Secret values are resolved only at execution time and must never be persisted.

## Command Template Variables

V1 supports a small controlled template variable set:

- `{{projectId}}`
- `{{skillId}}`
- `{{skillVersionId}}`
- `{{commandId}}`
- `{{runId}}`
- `{{pageVersionId}}` when the command is tied to a page version
- `{{artifactDir}}` when artifacts are materialized to a temporary workspace
- `{{artifact.indexHtmlPath}}`
- `{{artifact.stylesCssPath}}`
- `{{artifact.scriptJsPath}}`

Unknown template variables should fail validation before execution.

When `pageVersionId` is provided, V1 must materialize that `PageVersionRecord` into a temporary command workspace containing:

- `index.html`
- `styles.css`
- `script.js`

The default working directory is the materialized artifact directory when a page version is present. Commands without `pageVersionId` do not receive artifact path variables. A command-specific `workingDirectory` may only reference controlled variables and must resolve inside the allowed command workspace.

## Execution API Boundary

Add an API service method with a shape equivalent to:

```ts
interface ExecuteProjectSkillCommandInput {
  projectId: string;
  skillVersionId: string;
  commandId: string;
  pageVersionId?: string;
  approvedByUserId: string;
}
```

V1 approval is one-shot:

- `approvedByUserId` is required.
- Approval does not create reusable permission.
- Every execution must pass a fresh approval identity.
- The approval identity is persisted in sanitized run event payload and/or observation metadata, but no reusable approval record is created in V1.

The service must validate:

- project exists;
- skill version exists;
- skill is bound to the project and enabled;
- manifest type is `deployment`;
- manifest review state is `published`;
- command exists in `manifest.commands`;
- command permission is included in the bound skill permissions;
- all command `secretRef` values are declared in `manifest.requiredSecrets`;
- `approvedByUserId` is present;
- optional page version belongs to the project;
- command template variables resolve without unknown values.

Failure should happen before runner invocation when validation fails.

## ToolCommandRunner Adapter

Introduce a small adapter boundary:

```ts
interface ToolCommandRunner {
  run(input: ToolCommandRunInput): Promise<ToolCommandRunResult>;
}

interface ToolCommandRunInput {
  runId: string;
  projectId: string;
  skillId: string;
  skillVersionId: string;
  commandId: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  workingDirectory?: string;
  timeoutMs: number;
}

interface ToolCommandRunResult {
  state: "completed" | "failed";
  exitCode?: number;
  stdout: string;
  stderr: string;
  errorName?: string;
}
```

The default test path should use a fake runner. A local runner may exist, but it must be explicitly allowlisted and should execute argv without shell interpolation.

The runner must not know about project binding, skill review state, approval state, or artifact ownership. Those are API service responsibilities.

## Observations

The existing `ToolObservationRecord` is the durable base for tool output. This slice should extend or populate it so each command run records:

- observation id;
- run id;
- project id;
- optional task id;
- tool name such as `skill:<skillId>:<commandId>`;
- sanitized input summary;
- output summary;
- state: `completed` or `failed`;
- exit code when available;
- error name when available;
- created/completed timestamps or enough timestamp metadata to reconstruct the timeline.

`stdout` and `stderr` should not be persisted raw in V1. Persist summaries with bounded length and redact secret values. Later slices can add log artifacts or streaming output.

## Run Events

V1 command execution creates a dedicated run with role `deployer` for each execution. Later workflow orchestration may attach command execution to a larger deployer run, but this slice should not do that.

Required event types:

- `tool.started`
- `tool.completed`
- `tool.failed`
- `run.completed`
- `run.failed`

Event payloads may include:

- skill id;
- skill version id;
- command id;
- permission;
- approved by user id;
- exit code;
- duration;
- observation id.

Event payloads must not include:

- raw secret values;
- full stdout/stderr;
- raw environment values;
- arbitrary shell command lines not represented by validated `command` + `args`;
- artifact file contents.

## Error Handling

Validation failures should not invoke the runner. Expected errors:

- `skill_command_not_found`;
- `skill_command_not_bound`;
- `skill_command_not_deployment`;
- `skill_command_not_published`;
- `skill_command_permission_denied`;
- `skill_command_approval_required`;
- `skill_command_secret_not_declared`;
- `skill_command_unknown_template_variable`;
- `skill_command_page_version_not_found`.

Runner failures should save a failed tool observation and a `tool.failed` event, then mark the run as failed.

Runner success should save a completed tool observation and a `tool.completed` event, then mark the run as completed.

## Security Rules

- Command execution must be opt-in through a published deployment skill.
- User-supplied arbitrary command strings are never accepted.
- V1 requires approval on every execution.
- Commands run through an adapter, not inline in business logic.
- Secrets are referenced by name and resolved at runtime only.
- Secret values are redacted from summaries and events.
- Artifact file contents are not copied into events.
- Local command execution is a development adapter, not a production sandbox.

## Future Evolution

- Move `ToolCommandRunner` execution from API process to `apps/agent-worker`.
- Add worker queue, long-running command state, retries, timeout handling, cancellation, and streaming logs.
- Add command-level and project-level approval policies after the one-shot approval model is proven.
- Add real secret manager integration and rotate away from direct environment lookups.
- Add log artifacts for stdout/stderr instead of storing raw logs in observations.
- Add MCP-backed command kinds that reuse the same observation and run event model.
- Add HTTP/API-backed command kinds for SaaS integrations.
- Add Web UI for command discovery, approval, execution, and observation timeline.
- Add deployment workflow orchestration that calls deployment skill commands as one step, rather than treating this slice as full automatic deployment.
- Add file workspace and diff injection so commands can operate on controlled file manifests instead of only materialized LP artifacts.

## Testing Requirements

- Existing skill manifests without `commands` still parse.
- Deployment skill manifest with valid commands parses.
- Non-deployment skill command execution is rejected.
- Unpublished deployment skill command execution is rejected.
- Unbound skill command execution is rejected.
- Missing approval identity is rejected.
- Missing permission is rejected.
- Undeclared secret reference is rejected.
- Unknown template variable is rejected.
- Fake runner success saves a completed observation and `tool.completed` event.
- Fake runner failure saves a failed observation and `tool.failed` event.
- Page-version command materializes the expected static artifact filenames.
- Events and observations do not leak raw secret values or full artifact content.
