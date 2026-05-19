# LP Engineering Team Agent

LP Engineering Team Agent is a lightweight web workbench for creating and operating landing page tasks with an agent-style chat flow. The first version focuses on a local Web MVP: users can start from a large conversation entry, create or continue projects, run ordinary chat tasks, and generate framework-free static LP artifacts.

The generated landing page artifact is intentionally static HTML/CSS/JS. The workbench itself is a Next.js app, but generated LP output should not require React, Vue, Angular, Vite, Next.js, or a build step.

## Current Scope

- Web workbench with Manus-like sidebar, task list, chat-first entry, and task detail layout.
- Deterministic local flow for ordinary tasks and LP generation.
- Static artifact workspace for `index.html`, `styles.css`, and `script.js`.
- Artifact preview and bounded source snippet loading for selected files.
- Model gateway configuration surface for deterministic, Anthropic-style, and OpenAI-compatible providers.
- Skills, MCP, model routing, project memory, and agent runtime are represented as architecture surfaces and are being implemented in staged increments.

## Not In The First Web MVP

- Built-in production deployment flow.
- Real MCP tool execution from the web UI.
- Long-running sandboxed shell execution.
- Multi-agent runtime with durable context compression.
- Desktop app packaging.

These items are documented as later stages so the current code can stay small and testable.

## Requirements

- Node.js 20 or newer.
- pnpm 10, matching `packageManager` in `package.json`.

Install dependencies:

```bash
pnpm install
```

## Environment

Create a local environment file from the template:

```bash
cp .env.example .env.local
```

The default deterministic mode does not require model keys:

```env
REAL_MODEL_RUNTIME=0
REAL_MODEL_PROVIDER_TEST=0
```

For real provider testing, fill only the provider section you want to test. The OpenAI-compatible adapter uses:

```env
OPENAI_COMPATIBLE_BASE_URL=https://open.bigmodel.cn/api/paas/v4
OPENAI_COMPATIBLE_API_KEY=your_key_here
OPENAI_COMPATIBLE_DEFAULT_MODEL=glm-5.1
```

Real provider tests are opt-in and should not be needed for normal local smoke checks.

## Run Locally

Start the web workbench:

```bash
pnpm dev
```

Open the local URL printed by Next.js, usually:

```text
http://localhost:3000
```

Run the deterministic worker demo:

```bash
pnpm worker:dev
```

## Verify

Run the fast Web V1 smoke gate:

```bash
pnpm smoke
```

Run all tests:

```bash
pnpm test
```

Type-check all packages and apps:

```bash
pnpm typecheck
```

Build all packages and apps that expose a build script:

```bash
pnpm build
```

Validate the Prisma schema:

```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm --filter @lp-agent/db db:validate
```

## Manual Acceptance

Use the Web V1 checklist when reviewing the local app:

```text
docs/web-v1-acceptance.md
```

The smoke command verifies deterministic behavior quickly. The manual checklist verifies visible UX, language behavior, and feature boundaries that a unit test does not cover yet.

## Documentation Map

- `docs/development.md` - local development notes.
- `docs/web-v1-acceptance.md` - manual Web V1 acceptance checklist.
- `docs/agent-development-learning.md` - Chinese learning notes for Agent development concepts and project decisions.
- `docs/superpowers/README.md` - chronological Superpowers specs and plans.
- `docs/superpowers/specs/` - requirement and design specs.
- `docs/superpowers/plans/` - implementation plans.

## Development Rule

Generated LP code must remain framework-free static HTML/CSS/JS. Keep the workbench implementation and generated artifact format separate.
