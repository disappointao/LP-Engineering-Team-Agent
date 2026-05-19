# Repository Guidelines

## Project Structure & Module Organization

This repository is a pnpm TypeScript monorepo for the LP Engineering Team Agent MVP.

- `apps/web/` contains the Next.js workbench.
- `apps/agent-worker/` contains the deterministic worker demo.
- `packages/api/` orchestrates the in-memory workbench flow.
- `packages/lp-schema/`, `packages/artifacts/`, `packages/runtime-adapters/`, `packages/git-deployment/`, `packages/skills/`, `packages/mcp-gateway/`, and `packages/model-gateway/` contain focused domain packages.
- `packages/db/prisma/schema.prisma` defines the Postgres data model.
- `docs/` contains design notes, implementation plans, and contributor documentation.

Avoid committing machine-local editor state or generated build output. `.DS_Store`, `.idea`, `node_modules/`, `.next/`, `.superpowers/`, and local worktrees are ignored at the repository root.

## Build, Test, and Development Commands

- `pnpm install` - install workspace dependencies.
- `pnpm dev` - start the Next.js web workbench.
- `pnpm worker:dev` - run the demo agent-worker job.
- `pnpm test` - run all Vitest tests.
- `pnpm typecheck` - type-check all workspace packages and apps.
- `pnpm build` - build all packages and apps that expose a build script.
- `DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm --filter @lp-agent/db db:validate` - validate the Prisma schema without connecting to a live database.

## Coding Style & Naming Conventions

Follow TypeScript conventions already used in the workspace. Use 2-space indentation for JSON/YAML/Markdown and TypeScript/TSX files.

Use descriptive names. Prefer `kebab-case` for Markdown and config files (`contributor-guide.md`), `snake_case` for Python modules, and `camelCase` or `PascalCase` according to JavaScript/TypeScript conventions.

## Testing Guidelines

Vitest is configured at the workspace root. Package and app tests live beside source files as `*.test.ts`.

Use names that describe behavior, such as `services.test.ts` or `worker.test.ts`. Keep tests deterministic and avoid relying on local IDE settings or machine-specific paths.

## Commit & Pull Request Guidelines

The current Git history uses a short imperative commit style, for example: `add .gitignore to exclude .DS_Store and .idea files`. Continue using concise, lowercase, imperative summaries.

Pull requests should include a brief description, the reason for the change, commands run for verification, and screenshots or logs for user-facing behavior when relevant. Link related issues when available and call out any follow-up work clearly.

## Agent-Specific Instructions

Before editing, inspect the current tree and preserve unrelated user changes. Keep generated files focused and update this guide whenever new tooling, directories, or workflows become part of the repository. The generated LP artifact itself should remain framework-free static HTML/CSS/JS even though the workbench is a Next.js app.

When creating, renaming, replacing, or materially updating Superpowers specs or plans under `docs/superpowers/specs/` or `docs/superpowers/plans/`, update `docs/superpowers/README.md` in the same change so the reading order and document purpose remain accurate for future agents and developers.

When adding or materially changing agent runtime, run orchestration, context assembly, skills, model routing, MCP/tool execution, artifact workspace, multi-agent coordination, or related learning-relevant specs/plans, update `docs/agent-development-learning.md` in the same change so the Chinese Agent development notes stay current. Keep that file limited to Agent development concepts, difficulties, implementation tradeoffs, and project-specific Agent practices; do not add ordinary documentation-writing notes, startup instructions, smoke/acceptance-process notes, or pure Web UI changes unless they directly affect an Agent boundary.

When a stage is completed, a new stage is planned, or the recommended next-stage priority changes, update `docs/project-roadmap.md` in the same change. Future agents should read that roadmap before choosing the next stage instead of inferring priority only from the latest commit history.
