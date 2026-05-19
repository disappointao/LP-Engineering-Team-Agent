# Web V1 Smoke and Acceptance Design

## Summary

Stage 17 turns the current Web V1 implementation into a locally usable,
repeatable, and documented internal trial build. It adds a first-class
repository README, a Web V1 acceptance checklist, and an automated deterministic
smoke test that verifies the core LP generation path without requiring a browser,
network access, real model keys, MCP execution, shell execution, or deployment.

This stage is deliberately a closure stage. It does not add a major new agent
capability. It makes the existing capabilities understandable and verifiable for
a developer who has not followed the whole build history.

## Background

The project now has:

- conversation-first Web workbench;
- project and task persistence through local repository contracts;
- deterministic LP generation and ordinary task flow;
- project skills, model routing, MCP registry, run events, worker queue, and
  interrupt foundations;
- durable artifact workspaces;
- controlled artifact reader and static diff helpers;
- Web artifact diff cards and explicit bounded snippet preview.

The remaining gap before an internal Web V1 trial is not one more complex
runtime feature. The gap is operational clarity:

- there is no repository-level `README.md`;
- `docs/development.md` is useful but not enough as a first entry point;
- there is no single Web V1 manual acceptance checklist;
- there is no dedicated smoke command that says whether the core local Web V1
  flow still works after a change;
- a new developer has to infer which features are deterministic, which require
  env opt-in, and which remain future work.

## Goals

1. Add a repo-root `README.md` as the first onboarding document.
2. Document local startup, environment setup, deterministic defaults, and real
   model opt-in boundaries.
3. Add a Web V1 manual acceptance checklist under `docs/`.
4. Add a deterministic automated smoke test for the Web V1 core flow.
5. Add a root `pnpm smoke` command that runs the smoke test.
6. Keep smoke tests free of real secrets, network calls, browser automation, and
   external services.
7. Update Superpowers and Agent learning documentation so future agents know
   where the Web V1 readiness gate lives.

## Non-Goals

Stage 17 does not add:

- Playwright or browser E2E infrastructure;
- real MCP tool execution;
- real shell execution;
- real deployment runner;
- worker daemon polling;
- desktop filesystem integration;
- UI redesign;
- new Web routes;
- real model provider calls in default smoke tests;
- `.env.local` generation containing secrets;
- production auth, hosting, or Postgres setup.

## User Outcomes

A new developer should be able to:

1. Open `README.md`.
2. Install dependencies with `pnpm install`.
3. Copy `.env.example` to `.env.local`.
4. Keep `REAL_MODEL_RUNTIME=0` and run the local deterministic stack.
5. Start the Web workbench with `pnpm dev`.
6. Run `pnpm smoke` to verify the Web V1 core path.
7. Follow `docs/web-v1-acceptance.md` to manually check the Web UI.
8. Understand which capabilities are intentionally not part of Web V1.

## Proposed Files

### `README.md`

The root README is the first entry point. It should cover:

- project purpose;
- monorepo structure;
- prerequisite versions in practical terms;
- dependency installation;
- `.env.local` setup from `.env.example`;
- deterministic default behavior;
- how `REAL_MODEL_RUNTIME` differs from `REAL_MODEL_PROVIDER_TEST`;
- common commands:
  - `pnpm dev`;
  - `pnpm worker:dev`;
  - `pnpm smoke`;
  - `pnpm test`;
  - `pnpm typecheck`;
  - `pnpm build`;
- current Web V1 capability list;
- current non-goals;
- where to read deeper design docs.

The README must not ask users to paste API keys into chat or commit secrets.
It should point users to local `.env.local` values only.

### `docs/web-v1-acceptance.md`

The acceptance checklist should be written for a human running the app locally.
It should include:

- setup checklist;
- deterministic smoke command;
- Web startup checklist;
- ordinary task flow;
- LP generation flow;
- generated artifact download and preview checks;
- artifact diff card checks;
- `artifactPath=styles.css` snippet preview check;
- Models view current boundary;
- Skills and safe command loop current boundary;
- MCP registry current boundary;
- interrupt/current task boundary;
- known non-goals.

The document should be concrete and checkbox-driven. It should tell the user
what result to expect, not just what button to click.

### `apps/web/src/lib/web-v1-smoke.test.ts`

The smoke test should use existing Web store/service APIs rather than browser
automation. It should verify the product-level local flow while staying
deterministic and fast.

Required smoke coverage:

1. Create a fresh Web workbench store.
2. Submit an LP prompt without an existing project.
3. Verify the task is classified as LP generation and creates or binds a local
   project.
4. Load page state for the created task.
5. Verify the page state is `task_ready`.
6. Verify a snapshot exists with:
   - project;
   - brief;
   - current page version;
   - static `indexHtml`, `stylesCss`, and `scriptJs` artifacts.
7. Verify generated LP artifacts remain static HTML/CSS/JS and do not contain
   framework project output assumptions such as React/Vue/Angular build traces.
8. Verify the current page version has an artifact workspace id.
9. Verify `artifactDiff.files` contains `index.html`, `styles.css`, and
   `script.js` metadata by default.
10. Verify default `artifactDiff` JSON does not contain raw HTML/CSS/JS artifact
    source.
11. Load page state again with `artifactPath: "styles.css"`.
12. Verify exactly one selected snippet is returned for `styles.css`, bounded by
    the default 8KB reader limit.
13. Verify ordinary task prompts do not produce artifact diff state.
14. Verify the smoke path runs with deterministic defaults and does not require
    real model env values.

The smoke test can use Vitest and existing in-memory/local helpers. It should not
start Next.js, open a browser, or require Playwright.

### `package.json`

Add:

```json
"smoke": "vitest run apps/web/src/lib/web-v1-smoke.test.ts"
```

The command should be intentionally narrow. It is a readiness smoke, not a
replacement for `pnpm test`.

### `docs/development.md`

Update this document only if needed to cross-link the new README, smoke command,
and acceptance checklist. Avoid duplicating the entire README.

### `docs/superpowers/README.md`

Add the Stage 17 spec and later plan in reading order.

### `docs/agent-development-learning.md`

Add Stage 17 notes explaining that a smoke gate is different from full E2E:

- smoke protects the deterministic local product path;
- manual acceptance covers browser-level behavior;
- real provider validation remains opt-in;
- MCP execution and deployment remain separate stages.

## Smoke Test Design

The smoke test should sit at the Web store boundary because that is the narrowest
layer that still exercises the current product flow:

```text
createWebWorkbenchStore()
  -> submitTaskPrompt(LP prompt)
  -> getPageState(task/project)
  -> verify snapshot, artifacts, run events, artifact workspace, artifact diff
  -> getPageState(artifactPath=styles.css)
  -> verify one bounded snippet
```

This avoids a brittle browser dependency while still exercising:

- Web project/task orchestration;
- API service integration;
- deterministic planner/builder/reviewer flow;
- artifact workspace creation;
- artifact reader/diff state;
- ordinary-task separation.

The test should avoid assertions tied to exact marketing copy or layout. It
should assert stable contracts and safety properties.

## Environment Documentation

README and acceptance docs should explain these defaults:

- `REAL_MODEL_RUNTIME=0` keeps Web/API deterministic.
- `REAL_MODEL_RUNTIME=1` enables provider-backed Web/API runtime only when model
  providers/routes and API key env values are configured.
- `REAL_MODEL_PROVIDER_TEST=1` enables real provider integration tests only. It
  does not enable Web/API real runtime.
- `.env.local` is local-only and must not be committed.
- `.env.example` contains variable names and safe example base URLs only.

The docs should include both Anthropic-compatible and OpenAI-compatible Zhipu
base URL examples already present in `.env.example`, but must frame them as local
configuration, not as required smoke prerequisites.

## Manual Acceptance Checklist Scope

The acceptance checklist should cover the following Web V1 user paths:

### Ordinary Task

- open Web workbench;
- submit a non-LP prompt;
- see a normal task conversation;
- confirm no LP artifact diff cards are shown.

### LP Generation

- submit an LP prompt;
- see planner/builder/reviewer style process;
- see generated artifact download cards;
- see inline preview;
- see artifact diff cards for the three static files;
- select a snippet preview;
- confirm snippet preview is bounded and read-only.

### Configuration Views

- verify Skills, Models, and MCP views are accessible;
- verify they describe local/project configuration state;
- verify MCP is registry/visibility only, not execution.

### Safety Boundaries

- confirm no UI suggests real deployment is automatic;
- confirm no UI asks for raw secrets;
- confirm generated LP artifact remains static HTML/CSS/JS.

## Error Handling and Safety

Smoke tests should fail closed:

- missing snapshot -> fail;
- missing artifact workspace -> fail;
- artifact diff source contains raw artifact content by default -> fail;
- selected snippet larger than 8KB returned as content -> fail;
- ordinary task produces artifact diff -> fail.

Docs should avoid promising production behavior. Web V1 is local and
deterministic by default.

## Testing Requirements

Stage 17 implementation should run:

```bash
pnpm smoke
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

The smoke test should pass without:

- `.env.local`;
- real API keys;
- network access;
- a running Next.js dev server;
- a browser.

## Acceptance Criteria

Stage 17 is complete when:

- root `README.md` exists and explains local startup clearly;
- `docs/web-v1-acceptance.md` exists and covers manual Web V1 acceptance;
- `pnpm smoke` exists and passes;
- smoke test covers LP generation, static artifacts, artifact workspace, artifact
  diff metadata, bounded snippet preview, and ordinary task non-artifact behavior;
- `pnpm test`, `pnpm typecheck`, and `pnpm build` pass;
- docs state that real models are opt-in and deployment/MCP execution remain
  future stages;
- Superpowers and Agent learning indexes are updated.

## Future Work

After Stage 17, likely next candidates are:

- Playwright browser E2E after the Web V1 flow stabilizes;
- MCP execution through the existing observation/tool boundary;
- real deployment runner design after deployment product requirements are clear;
- stronger sandbox/daemon runner;
- Web UI polish pass based on manual acceptance findings.
