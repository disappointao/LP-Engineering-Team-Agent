# Post-V1 Backlog Prioritization

**Stage:** 49 - Post-V1 Backlog Prioritization v0
**Date:** 2026-05-25
**Status:** completed
**Decision:** Default next slice is Stage 51 MCP Management Surface v0 Spec Kickoff.

This ledger converts the V1 polished alpha completion evidence, local operator trial, feedback log, and current roadmap queue into a narrow post-V1 routing decision. It is docs-only and does not change runtime, Web, MCP, provider, deployment, auth, storage, browser platform, or test implementation.

## Evidence Inputs

| Input | Evidence used | Routing implication |
| --- | --- | --- |
| `docs/v1-polished-alpha-completion.md` | Stage 46 records deterministic gates passed, manual acceptance passed, no open blockers, real provider opt-in smoke `not_run`, and RC decision `go_for_internal_rc`. Known limitations explicitly route MCP management, real deployment, auth/RBAC, provider cost/fallback, shell runner, object storage, visual baselines, and desktop packaging to post-V1 backlog. | Stage 48 remains conditional only; post-V1 selection should prioritize one backlog slice rather than reopening V1 completion. |
| `docs/v1-polished-alpha-operator-trial.md` | Stage 47 local operator trial passed ordinary chat, LP live task, artifact workspace, Skills, Models, MCP hidden boundary, and bounded failure / non-leakage checks. New feedback count was `0`; blockers were `none`. | No RC blocker batch is needed by default; backlog work can start from stable deterministic evidence. |
| `docs/alpha-feedback-log.md` | Stage 47 feedback batch records no new items, no blockers, Stage 49 as accepted follow-up, and Stage 48 only if a later blocker is found. Earlier V1 planning routed MCP management out of V1 and kept Skills / Models in V1. | MCP management is the highest-confidence deferred product surface because it was intentionally hidden, not rejected as unnecessary. |
| `docs/project-roadmap.md` | Current state says V1 polished alpha gate and operator trial are complete, Stage 49 is the default route, Stage 48 is conditional, Stage 50 is optional browser platform planning, and Stage 51 is a post-V1 spec placeholder. Backlog groups include MCP, Deployment, Collaboration / Auth, Web UI browser platform, Context / Memory / Retrieval, Artifact Workspace, and Desktop. | Stage 49 should choose a single default next slice, keep Stage 48 conditional, preserve Stage 50 as optional planning, and route later discovery candidates without mixing multiple systems into one stage. |

## Prioritization Model

Each candidate is scored from `0` to `3` in five dimensions. Higher total means a better next-stage candidate.

| Dimension | Score meaning |
| --- | --- |
| User value | Directly improves the next internal operator workflow or visible product capability. |
| Risk reduction | Retires a known uncertainty or safety boundary before larger implementation work. |
| Dependency unlock | Enables later stages to proceed with clearer contracts, data model, or UX boundaries. |
| Implementation size | Higher score means smaller and easier to keep narrow; lower score means broad or risky. |
| Validation clarity | Can be verified with deterministic, safe, low-flake evidence. |

## Candidate Scores

| Candidate | User value | Risk reduction | Dependency unlock | Implementation size | Validation clarity | Total | Route |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| MCP Management Surface v0 Spec Kickoff | 3 | 3 | 3 | 2 | 3 | 14 | Stage 51 default next slice |
| Browser Platform / Visual Baseline Planning v0 | 2 | 2 | 2 | 3 | 3 | 12 | Stage 50 optional planning |
| Real Deployment Runner Discovery v0 | 2 | 2 | 2 | 1 | 2 | 9 | Stage 52 later discovery candidate |
| Model Gateway Cost / Fallback Policy Discovery v0 | 2 | 2 | 2 | 1 | 2 | 9 | Stage 53 later discovery candidate |
| Auth / RBAC / Production Storage Foundation v0 | 2 | 3 | 2 | 0 | 2 | 9 | deferred |
| Worker / Sandbox Real Execution v0 | 2 | 3 | 2 | 0 | 1 | 8 | deferred |
| Context / Memory Retrieval Expansion v0 | 2 | 2 | 2 | 1 | 1 | 8 | deferred |
| Desktop Packaging v0 | 1 | 1 | 1 | 1 | 1 | 5 | long-term backlog |

## Default Stage 51

Stage 51 should become **MCP Management Surface v0 Spec Kickoff**.

Suggested scope:

- Define the post-V1 Web management surface for MCP connectors, visible tools, approval state, connector health, and safe read-only execution affordances.
- Preserve the V1 hidden-boundary decision while specifying how MCP re-enters navigation after V1.
- Clarify safe evidence rules for connector metadata, tool descriptions, approval state, tool observations, and failure diagnostics.
- Decide what must remain deterministic/local for v0 and what requires later real MCP SDK, remote server, write-tool, or worker execution stages.
- Produce a narrow Superpowers spec / plan that can be validated through docs review and later deterministic acceptance.

Non-goals:

- Do not implement runtime, Web UI, backend, worker, MCP SDK, or tool execution changes in Stage 51 kickoff itself.
- Do not add MCP write tools, remote MCP server adapter, worker execution, real shell runner, or production deployment behavior.
- Do not combine MCP management with provider fallback, real deployment runner, auth/RBAC, production storage, browser farm, or desktop packaging.
- Do not make MCP management part of V1 polished alpha retroactively.

## Recommended Next-Stage Queue

1. **Stage 51 - MCP Management Surface v0 Spec Kickoff:** default next slice; write the narrow MCP management spec and plan from this ledger.
2. **Stage 48 - RC Blocker Fix Batch v0:** conditional only; use if a later accepted RC blocker appears before or during Stage 51.
3. **Stage 50 - Browser Platform / Visual Baseline Planning v0:** optional planning path; keep separate from MCP management unless browser evidence becomes the immediate constraint.
4. **Stage 52 - Real Deployment Runner Discovery v0:** later discovery candidate; scope deployment adapter, approval, status polling, rollback, and environment records before implementation.
5. **Stage 53 - Model Gateway Cost / Fallback Policy Discovery v0:** later discovery candidate; scope cost ledger, fallback policy, provider capability, quota, and safe validation before implementation.

## Deferred Routes

| Deferred item | Route | Reason |
| --- | --- | --- |
| Auth / RBAC / Production Storage Foundation v0 | Deferred platform foundation | High risk and broad dependency surface; should follow clearer product and deployment priorities. |
| Worker / Sandbox Real Execution v0 | Deferred runtime foundation | Needs stronger execution policy, sandbox design, and safety evidence before real command execution. |
| Context / Memory Retrieval Expansion v0 | Deferred agent quality backlog | Valuable but less clear as the immediate post-V1 unlock than MCP management. |
| Desktop Packaging v0 | Long-term backlog | Depends on local filesystem workspace, runtime policy UI, packaging, and offline constraints. |
| Browser Platform / Visual Baseline Planning v0 | Optional planning | Worth planning, but not the default product slice unless visual/browser evidence becomes the limiting risk. |
| Real Deployment Runner Discovery v0 | Stage 52 later discovery candidate | Important post-V1 capability, but should be scoped separately from MCP management. |
| Model Gateway Cost / Fallback Policy Discovery v0 | Stage 53 later discovery candidate | Important provider governance work, but should remain separate from MCP management and deployment. |

## Verification

Docs-only final verification commands:

```bash
rg -n "Stage 51|MCP Management|Real Deployment Runner|Model Gateway Cost" docs/post-v1-backlog-prioritization.md
git diff --check
```
