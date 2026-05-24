# V1 Polished Alpha Completion

**Stage:** 46 - V1 Polished Alpha Completion Gate v0
**Date:** 2026-05-24
**Runtime mode:** deterministic default (`REAL_MODEL_RUNTIME=0`, `REAL_MODEL_PROVIDER_TEST=0`)
**Gate commit:** `071601b`
**Latest operator trial:** Stage 47 local operator trial at `docs/v1-polished-alpha-operator-trial.md`
**Decision:** `go_for_internal_rc`

This note is the current evidence ledger for the local single-user V1 polished alpha candidate. It records safe summaries only. It does not include secrets, raw provider responses, raw SSE frames, full artifact contents, local absolute paths, raw worker/tool payloads, or raw stdout/stderr.

## Candidate Scope

The candidate includes:

- Workbench / ordinary chat with deterministic default and real provider opt-in.
- LP task flow through `Planner -> Builder -> Reviewer -> Deployer`.
- Dedicated artifact workspace with manifest, preview, bounded snippets, export, and safe failure states.
- Skills and Models client-side management for the V1 Web surface.
- MCP Web management hidden from V1 navigation, with legacy `view=mcp` safe fallback.
- Browser acceptance for happy paths, bounded failures, non-leakage, and lightweight visual contracts.

The candidate does not include:

- MCP management, remote MCP SDK, write tools, or MCP worker execution.
- Real deployment runner, hosted auth/RBAC, billing/quota, object storage, or production Postgres rollout.
- Real shell runner, strong sandbox adapter, raw stdout/stderr streaming, cross-browser farm, or pixel-perfect visual baselines.

## Automated Deterministic Gates

| Gate | Status | Safe summary |
| --- | --- | --- |
| `pnpm alpha:check` | `passed` | 8 Vitest files and 144 tests passed. |
| `pnpm smoke` | `passed` | 1 Vitest file and 2 tests passed. |
| `pnpm alpha:e2e` | `passed` | 15 Playwright Chromium tests passed. |
| `pnpm test` | `passed` | 59 Vitest files and 1160 tests passed; 2 files and 2 tests skipped. |
| `pnpm typecheck` | `passed` | Workspace typecheck passed across 12 of 13 projects, including Next route type generation. |
| `pnpm build` | `passed` | Workspace build passed; Next production build completed. |
| `git diff --check` | `passed` | No whitespace errors. |

## Manual Acceptance

Detailed checklist: `docs/web-v1-acceptance.md`.

| Area | Status | Evidence |
| --- | --- | --- |
| Ordinary chat | `passed` | Stage 47 local operator trial evidence recorded in `docs/v1-polished-alpha-operator-trial.md`. |
| LP live task and run timeline | `passed` | Stage 47 local operator trial evidence recorded in `docs/v1-polished-alpha-operator-trial.md`. |
| Artifact workspace | `passed` | Stage 47 local operator trial evidence recorded in `docs/v1-polished-alpha-operator-trial.md`. |
| Skills | `passed` | Stage 47 local operator trial evidence recorded in `docs/v1-polished-alpha-operator-trial.md`. |
| Models / MCP boundary | `passed` | Stage 47 local operator trial evidence recorded in `docs/v1-polished-alpha-operator-trial.md`. |
| Failure display / non-leakage spot-check | `passed` | Stage 47 local operator trial evidence recorded in `docs/v1-polished-alpha-operator-trial.md`. |

## Optional Real Provider Smoke

Detailed checklist: `docs/real-provider-alpha-smoke.md`.

| Smoke path | Status | Evidence |
| --- | --- | --- |
| Default no-key gate | `passed` | Deterministic gates passed with default no-key runtime mode; no real provider environment evidence recorded. |
| Real provider opt-in smoke | `not_run` | No operator-provided real provider environment for this completion note. |

## Known Limitations Acknowledged

- MCP management and visible MCP Web entry remain post-V1 backlog.
- Real deployment, auth/RBAC, object storage, production Postgres rollout, billing/quota, true shell execution, hosted observability, and desktop packaging remain post-V1 backlog.
- Real provider smoke is opt-in and is not required for default deterministic gates.
- Cross-browser matrix, remote browser farm, and pixel-perfect screenshot baselines remain post-V1 backlog.

## Open Blockers

- No blockers recorded during Stage 46 gate execution or Stage 47 local operator trial.

## Accepted Follow-ups

- Stage 47: Internal RC Trial Feedback Batch v0.
- Stage 48: RC Blocker Fix Batch v0, only if Stage 46 or Stage 47 finds blockers.
- Stage 49: Post-V1 Backlog Prioritization v0.

## Rejected Or Out Of Scope For V1

| Item | Route |
| --- | --- |
| MCP management / write tools / remote MCP SDK | Backlog |
| Real deployment runner and hosted deployment workflow | Backlog |
| Production auth/RBAC and team approval queue | Backlog |
| Billing/quota/cost ledger and automatic fallback provider execution | Backlog |
| Real shell runner and strong sandbox adapter | Backlog |
| Object storage and artifact content migration | Backlog |
| Cross-browser farm and pixel-perfect visual baseline | Backlog |

## RC Decision

- Decision: `go_for_internal_rc`
- Reasoning: Full deterministic gates and Stage 47 local operator trial evidence passed with no blockers. Real provider opt-in smoke was not run and remains optional.
- Next routing decision: Proceed to Stage 49 Post-V1 Backlog Prioritization v0; use Stage 48 only if a blocker is later found.
