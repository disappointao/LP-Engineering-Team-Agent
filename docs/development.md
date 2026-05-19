# Development

## Start Here

For a fresh local setup, use the root [README](../README.md) first. It lists install commands, environment setup, the Web V1 smoke command, and the manual acceptance checklist.

This file keeps deeper development notes that are useful after the basic app is running.

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

Stage 2 Milestone 6 persists deterministic planner, builder, reviewer, and deployer run records with ordered run events. Runtime calls now pass through a context assembly boundary before they reach the local runtime adapter. The first context pack includes project/task input, published project skills, visible MCP tools, model routing policy, approval state, and artifact workspace metadata; compression, retrieval, streaming, real tool execution, and real model providers remain future slices.

Generated LP output remains static HTML/CSS/JS. The Next.js app is only the workbench shell used to create, preview, review, and hand off those artifacts.
