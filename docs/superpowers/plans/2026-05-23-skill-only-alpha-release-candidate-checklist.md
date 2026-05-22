# Skill-only Alpha Release Candidate Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Skill-only local alpha release candidate checklist, feedback template, and roadmap closeout without changing runtime behavior.

**Architecture:** This is a documentation and release-process stage. `docs/alpha-release-candidate.md` becomes the go/no-go entrypoint, while existing `docs/web-v1-acceptance.md` and `docs/real-provider-alpha-smoke.md` remain the detailed validation checklists.

**Tech Stack:** Markdown documentation, existing pnpm/Vitest/Playwright validation gates.

---

### Task 1: Add Stage 37 Superpowers Documents

**Files:**
- Create: `docs/superpowers/specs/2026-05-23-skill-only-alpha-release-candidate-checklist-design.md`
- Create: `docs/superpowers/plans/2026-05-23-skill-only-alpha-release-candidate-checklist.md`
- Modify: `docs/superpowers/README.md`

- [ ] Add the Stage 37 design document describing goals, non-goals, RC document responsibilities, entrypoint consistency, roadmap updates, and acceptance criteria.
- [ ] Add this implementation plan with exact files, tasks, validation commands, and closeout expectations.
- [ ] Update `docs/superpowers/README.md` with entries 102 and 103 for the new design and plan.

### Task 2: Add Release Candidate Checklist

**Files:**
- Create: `docs/alpha-release-candidate.md`

- [ ] Add RC definition and scope: local, single-user, Skill-only, deterministic-first, real provider opt-in.
- [ ] Add go/no-go gates for environment, automated validation, manual acceptance, optional provider smoke, known limitations, and feedback readiness.
- [ ] Add a 60-90 minute operator trial script covering ordinary chat, LP task, artifacts, Skills, Models boundary, failure display, and optional real provider smoke.
- [ ] Add a feedback template that excludes secrets, raw provider responses, complete artifact contents, local paths, and raw worker/tool payloads.
- [ ] Add triage categories: `blocking_bug`, `ux_friction`, `provider_config_issue`, `artifact_quality_issue`, `docs_gap`, `future_feature`.
- [ ] Add follow-up routing to Stage 38, Stage 39, Stage 40, and backlog.

### Task 3: Link Existing Entrypoints

**Files:**
- Modify: `README.md`
- Modify: `docs/web-v1-acceptance.md`
- Modify: `docs/real-provider-alpha-smoke.md`

- [ ] Link `docs/alpha-release-candidate.md` from README manual acceptance and documentation map.
- [ ] Update `docs/web-v1-acceptance.md` intro to clarify that it is the detailed manual checklist, while RC go/no-go and feedback triage live in `docs/alpha-release-candidate.md`.
- [ ] Update `docs/real-provider-alpha-smoke.md` closeout to route provider smoke findings through the RC feedback template.

### Task 4: Close Roadmap

**Files:**
- Modify: `docs/project-roadmap.md`

- [ ] Update the last-updated date to 2026-05-23.
- [ ] Add Stage 37 to current status snapshot and completed stage record.
- [ ] Refresh first-version estimate and next priorities.
- [ ] Move recommended queue to Stage 38, Stage 39, and Stage 40.
- [ ] Add a Stage 37 decision record.

### Task 5: Validate and Merge

**Commands:**
- `pnpm alpha:check`
- `pnpm smoke`
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `pnpm alpha:e2e`
- `git diff --check`

- [ ] Run focused docs review with `rg` to ensure new links and stage names resolve.
- [ ] Run validation commands. If `pnpm alpha:e2e` is blocked by sandbox port permissions, rerun with approved escalation and record both outcomes.
- [ ] Commit with a concise imperative message.
- [ ] Merge the stage branch to `main` and remove the worktree.
