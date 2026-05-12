# Development

## Prerequisites

- Node.js compatible with the workspace dependencies.
- pnpm.
- Optional Postgres instance for future DB-backed development.

## Commands

- `pnpm install` installs dependencies.
- `pnpm dev` starts the web workbench.
- `pnpm worker:dev` runs the deterministic worker demo.
- `pnpm test` runs package and app tests.
- `pnpm typecheck` runs TypeScript checks.
- `pnpm build` builds workspace targets that define a build script.
- `DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm --filter @lp-agent/db db:validate` validates the Prisma schema.

## Current MVP Behavior

The first implementation uses deterministic local services for model calls, runtime execution, MCP visibility, and Git deployment handoff. The boundaries match the v1 design so real providers can replace these implementations without changing the product flow.

Stage 2 starts by moving workbench records behind repository contracts in `@lp-agent/db`. The default local implementation is still in-memory for deterministic tests, but `@lp-agent/api` now depends on repository interfaces instead of private maps so Prisma/Postgres repositories can replace the in-memory implementation without changing Web or worker callers.

Generated LP output remains static HTML/CSS/JS. The Next.js app is only the workbench shell used to create, preview, review, and hand off those artifacts.
