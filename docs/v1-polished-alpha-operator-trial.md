# V1 Polished Alpha Operator Trial

**Stage:** 47 - Internal RC Trial Feedback Batch v0
**Date:** 2026-05-24
**Operator:** Codex local operator
**Runtime mode:** deterministic default (`REAL_MODEL_RUNTIME=0`, `REAL_MODEL_PROVIDER_TEST=0`)
**Trial commit:** `002cbbc`
**Decision:** `go_for_internal_rc`

This note records the Stage 47 local operator trial for the V1 polished alpha candidate. It records safe summaries only. It does not include secrets, raw provider responses, raw SSE frames, full artifact contents, local absolute paths, raw worker/tool payloads, raw stdout/stderr, or unsafe logs.

This is an agent-operated local trial delegated by the user. It is not an external human user interview or public release sign-off.

## Trial Scope

Included:

- Deterministic / no-key local workbench trial.
- Ordinary chat, LP live task, run timeline, artifact workspace, Skills, Models, MCP hidden boundary, and failure-display non-leakage checks.
- Feedback intake and routing using `docs/alpha-feedback-intake.md`.

Not included:

- Real provider opt-in smoke.
- External human subjective UX interview.
- MCP management, real deployment, auth/RBAC, object storage, production Postgres rollout, real shell runner, cross-browser farm, or pixel-perfect visual baseline.

## Automated Gates

| Gate | Status | Safe summary |
| --- | --- | --- |
| `pnpm alpha:check` | `passed` | 8 Vitest files and 144 tests passed. |
| `pnpm smoke` | `passed` | 1 Vitest file and 2 tests passed. |
| `pnpm alpha:e2e` | `passed` | 15 Playwright Chromium tests passed. |
| `pnpm test` | `passed` | 59 Vitest files and 1160 tests passed; 2 files and 2 tests skipped. |
| `pnpm typecheck` | `passed` | Workspace typecheck passed across 12 of 13 projects, including Next route type generation. |
| `pnpm build` | `passed` | Workspace build passed; Next production build completed. |
| `git diff --check` | `passed` | No whitespace errors. |

## Manual Acceptance Evidence

Detailed checklist: `docs/web-v1-acceptance.md`.

| Area | Status | Evidence |
| --- | --- | --- |
| Ordinary chat | `passed` | `pnpm alpha:e2e` ordinary chat streaming path passed; local operator reviewed RC script coverage. |
| LP live task and run timeline | `passed` | `pnpm alpha:e2e` LP live task and recovery timeline paths passed. |
| Artifact workspace | `passed` | `pnpm alpha:e2e` artifact workspace happy path, invalid path, oversized snippet, preview/export paths passed. |
| Skills | `passed` | `pnpm alpha:e2e` Skills management path and invalid manifest fail-closed path passed. |
| Models / MCP boundary | `passed` | `pnpm alpha:e2e` Models management, provider fail-closed, invalid config, MCP hidden / legacy fallback paths passed. |
| Failure display / non-leakage spot-check | `passed` | `pnpm alpha:e2e` bounded failure and non-leakage paths passed. |

## Optional Real Provider Smoke

Detailed checklist: `docs/real-provider-alpha-smoke.md`.

| Smoke path | Status | Evidence |
| --- | --- | --- |
| Default no-key gate | `passed` | Deterministic gates passed with default no-key runtime mode. |
| Real provider opt-in smoke | `not_run` | No operator-provided real provider environment for this trial. |

## Feedback Intake Summary

- New items count: `0`
- Blockers: `none`
- Accepted follow-ups: `Stage 49 post-V1 backlog prioritization`
- Rejected / out-of-scope items: `none in this trial`

## Open Blockers

- None recorded during Stage 47 local operator trial.

## Next Routing Decision

- Decision: `go_for_internal_rc`
- Reasoning: Full deterministic gates and local operator trial evidence passed with no blockers; real provider opt-in smoke was not run and remains optional.
- Next route: Proceed to Stage 49 Post-V1 Backlog Prioritization v0; use Stage 48 only if a blocker is later found.
