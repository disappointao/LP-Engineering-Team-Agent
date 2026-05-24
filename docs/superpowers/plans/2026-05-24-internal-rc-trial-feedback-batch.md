# Internal RC Trial Feedback Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute and record the Stage 47 deterministic local operator trial feedback batch for the V1 polished alpha candidate.

**Architecture:** This is a documentation and validation stage. It creates a trial evidence note, runs full deterministic gates, records safe operator-trial summaries in the completion ledger and feedback log, and routes next work without changing runtime or product behavior.

**Tech Stack:** pnpm, Vitest, Playwright Chromium, TypeScript, Next.js build, Markdown docs.

---

## Files and Responsibilities

- Create: `docs/v1-polished-alpha-operator-trial.md`
  - Owns the Stage 47 trial batch evidence: operator mode, candidate commit, automated gates, manual acceptance evidence, feedback intake summary, blockers, follow-ups, rejected / out-of-scope items, and next routing.
- Modify: `docs/v1-polished-alpha-completion.md`
  - Updates the V1 completion ledger from `needs_operator_trial` to the correct post-trial decision if the trial completes.
- Modify: `docs/alpha-feedback-log.md`
  - Adds the Stage 47 feedback batch and any safe feedback items.
- Modify: `docs/project-roadmap.md`
  - Marks Stage 47 complete or blocked, updates recommended next-stage queue, and records the routing decision.
- Modify: `docs/superpowers/README.md`
  - Adds this implementation plan and later marks Stage 47 spec / plan complete.

## Execution Rules

- Work in an isolated worktree branch named `stage-47-internal-rc-trial-feedback-batch`.
- Do not modify runtime, Web UI, repository, provider, MCP, worker, artifact, or test implementation code unless this plan is explicitly amended.
- Default runtime is deterministic / no-key: `REAL_MODEL_RUNTIME=0`, `REAL_MODEL_PROVIDER_TEST=0`.
- Codex may be recorded as `Codex local operator` because the user delegated automatic continuation. Do not describe this as an external human trial.
- Optional real provider smoke remains `not_run` unless the operator explicitly requests and safely configures it. Do not ask for or record real keys.
- If a deterministic gate or operator-trial path fails, do not fix it in this stage. Record `no_go_blocked`, add safe feedback evidence, route Stage 48, and stop before marking Stage 47 complete.
- Keep evidence safe: command names, pass/fail, counts, bounded UI summaries, doc links, browser name, and commit SHA only. Do not paste secrets, raw provider responses, raw SSE frames, full artifact contents, local absolute paths, raw worker/tool payloads, raw stdout/stderr, or unsafe logs.
- Commit each task separately with a short lowercase imperative summary.

---

### Task 1: Create Operator Trial Evidence Ledger

**Files:**
- Create: `docs/v1-polished-alpha-operator-trial.md`

- [ ] **Step 1: Add the Stage 47 trial note skeleton**

Create `docs/v1-polished-alpha-operator-trial.md` with:

```md
# V1 Polished Alpha Operator Trial

**Stage:** 47 - Internal RC Trial Feedback Batch v0
**Date:** 2026-05-24
**Operator:** Codex local operator
**Runtime mode:** deterministic default (`REAL_MODEL_RUNTIME=0`, `REAL_MODEL_PROVIDER_TEST=0`)
**Trial commit:** `pending`
**Decision:** `in_progress`

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
| `pnpm alpha:check` | `not_run` | Pending Stage 47 execution. |
| `pnpm smoke` | `not_run` | Pending Stage 47 execution. |
| `pnpm alpha:e2e` | `not_run` | Pending Stage 47 execution. |
| `pnpm test` | `not_run` | Pending Stage 47 execution. |
| `pnpm typecheck` | `not_run` | Pending Stage 47 execution. |
| `pnpm build` | `not_run` | Pending Stage 47 execution. |
| `git diff --check` | `not_run` | Pending Stage 47 execution. |

## Manual Acceptance Evidence

Detailed checklist: `docs/web-v1-acceptance.md`.

| Area | Status | Evidence |
| --- | --- | --- |
| Ordinary chat | `not_run` | Pending Stage 47 local operator trial. |
| LP live task and run timeline | `not_run` | Pending Stage 47 local operator trial. |
| Artifact workspace | `not_run` | Pending Stage 47 local operator trial. |
| Skills | `not_run` | Pending Stage 47 local operator trial. |
| Models / MCP boundary | `not_run` | Pending Stage 47 local operator trial. |
| Failure display / non-leakage spot-check | `not_run` | Pending Stage 47 local operator trial. |

## Optional Real Provider Smoke

Detailed checklist: `docs/real-provider-alpha-smoke.md`.

| Smoke path | Status | Evidence |
| --- | --- | --- |
| Default no-key gate | `not_run` | Pending deterministic gate execution. |
| Real provider opt-in smoke | `not_run` | No operator-provided real provider environment for this trial. |

## Feedback Intake Summary

- New items count: `pending`
- Blockers: `pending`
- Accepted follow-ups: `pending`
- Rejected / out-of-scope items: `pending`

## Open Blockers

- Pending Stage 47 execution.

## Next Routing Decision

- Decision: `in_progress`
- Reasoning: Stage 47 local operator trial has not completed yet.
- Next route: Continue Stage 47 execution.
```

- [ ] **Step 2: Verify skeleton safety**

Run:

```bash
rg -n "TBD|TODO|replace_with|secret-value|raw provider|pending" docs/v1-polished-alpha-operator-trial.md
git diff --check
```

Expected: `rg` may match intentional `pending` placeholders and the safe-evidence phrase `raw provider`; there must be no `TBD`, `TODO`, `replace_with`, or fake secret values. `git diff --check` exits 0.

- [ ] **Step 3: Commit**

```bash
git add docs/v1-polished-alpha-operator-trial.md
git commit -m "add internal rc trial ledger"
```

---

### Task 2: Run Trial Gates and Record Results

**Files:**
- Modify: `docs/v1-polished-alpha-operator-trial.md`
- Modify: `docs/v1-polished-alpha-completion.md`

- [ ] **Step 1: Capture trial commit**

Run:

```bash
git rev-parse --short HEAD
```

Use this short SHA as `Trial commit` in `docs/v1-polished-alpha-operator-trial.md`.

- [ ] **Step 2: Run full deterministic gates**

Run these commands in order:

```bash
pnpm alpha:check
pnpm smoke
pnpm alpha:e2e
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected if the trial can proceed:

- `pnpm alpha:check`: 8 Vitest files and 144 tests passed.
- `pnpm smoke`: 1 Vitest file and 2 tests passed.
- `pnpm alpha:e2e`: 15 Playwright Chromium tests passed.
- `pnpm test`: all default Vitest tests pass; skipped provider integration tests are acceptable when safely reported.
- `pnpm typecheck`: workspace typecheck passes.
- `pnpm build`: workspace build passes.
- `git diff --check`: exits 0.

If any command fails, do not fix it. Record a safe failure summary in the trial note, set both trial note and completion note decision to `no_go_blocked`, route Stage 48, commit the no-go evidence, and stop.

- [ ] **Step 3: Update operator trial note for passed gates**

If all gates pass, update `docs/v1-polished-alpha-operator-trial.md`:

- Set `**Trial commit:**` to the captured SHA.
- Set `**Decision:**` to `go_for_internal_rc`.
- Mark each Automated Gate row `passed` with safe counts / summary.
- Mark Manual Acceptance Evidence rows `passed` with concise evidence:
  - Ordinary chat: `pnpm alpha:e2e` ordinary chat streaming path passed; local operator reviewed RC script coverage.
  - LP live task and run timeline: `pnpm alpha:e2e` LP live task and recovery timeline paths passed.
  - Artifact workspace: `pnpm alpha:e2e` artifact workspace happy path, invalid path, oversized snippet, preview/export paths passed.
  - Skills: `pnpm alpha:e2e` Skills management path and invalid manifest fail-closed path passed.
  - Models / MCP boundary: `pnpm alpha:e2e` Models management, provider fail-closed, invalid config, MCP hidden / legacy fallback paths passed.
  - Failure display / non-leakage spot-check: `pnpm alpha:e2e` bounded failure and non-leakage paths passed.
- Mark Default no-key gate `passed`.
- Keep Real provider opt-in smoke `not_run`.
- Set Feedback Intake Summary:
  - New items count: `0`
  - Blockers: `none`
  - Accepted follow-ups: `Stage 49 post-V1 backlog prioritization`
  - Rejected / out-of-scope items: `none in this trial`
- Set Open Blockers to `None recorded during Stage 47 local operator trial.`
- Set Next Routing Decision:
  - Decision: `go_for_internal_rc`
  - Reasoning: Full deterministic gates and local operator trial evidence passed with no blockers; real provider opt-in smoke was not run and remains optional.
  - Next route: Proceed to Stage 49 Post-V1 Backlog Prioritization v0; use Stage 48 only if a blocker is later found.

- [ ] **Step 4: Update completion note**

In `docs/v1-polished-alpha-completion.md`:

- Change `**Decision:**` to `go_for_internal_rc`.
- Add a Stage 47 line near the header:

```md
**Latest operator trial:** Stage 47 local operator trial at `docs/v1-polished-alpha-operator-trial.md`
```

- In Manual Acceptance, update all rows to `passed` and point to `docs/v1-polished-alpha-operator-trial.md`.
- Keep Optional Real Provider Smoke `Real provider opt-in smoke` as `not_run`.
- Update Open Blockers to say no blockers recorded during Stage 46 gate execution or Stage 47 local operator trial.
- Update RC Decision:

```md
- Decision: `go_for_internal_rc`
- Reasoning: Full deterministic gates and Stage 47 local operator trial evidence passed with no blockers. Real provider opt-in smoke was not run and remains optional.
- Next routing decision: Proceed to Stage 49 Post-V1 Backlog Prioritization v0; use Stage 48 only if a blocker is later found.
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
rg -n "go_for_internal_rc|no_go_blocked|not_run|Stage 47|Stage 48|Stage 49|Trial commit|v1-polished-alpha-operator-trial" docs/v1-polished-alpha-operator-trial.md docs/v1-polished-alpha-completion.md
git diff --check
```

Expected: trial and completion notes show `go_for_internal_rc`, Stage 49 routing, Stage 48 conditional routing, and real provider opt-in smoke still `not_run`. `git diff --check` exits 0.

Commit:

```bash
git add docs/v1-polished-alpha-operator-trial.md docs/v1-polished-alpha-completion.md
git commit -m "record internal rc trial results"
```

---

### Task 3: Record Feedback Batch and Close Roadmap

**Files:**
- Modify: `docs/alpha-feedback-log.md`
- Modify: `docs/project-roadmap.md`
- Modify: `docs/superpowers/README.md`
- Modify if needed: `docs/superpowers/specs/2026-05-24-internal-rc-trial-feedback-batch-design.md`
- Modify if needed: `docs/superpowers/plans/2026-05-24-internal-rc-trial-feedback-batch.md`

- [ ] **Step 1: Add feedback batch**

In `docs/alpha-feedback-log.md`, add a new batch above the 2026-05-23 planning batch:

```md
## Batch: 2026-05-24 Stage 47 internal RC trial feedback batch

- Batch id: `batch_2026_05_24_stage_47_internal_rc_trial`
- Date range: 2026-05-24
- Operator: Codex local operator
- Source trial: Stage 47 deterministic local operator trial
- Automated gates summary: `pnpm alpha:check`, `pnpm smoke`, `pnpm alpha:e2e`, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check` passed; see `docs/v1-polished-alpha-operator-trial.md`.
- Manual acceptance summary: ordinary chat, LP live task and run timeline, artifact workspace, Skills, Models / MCP boundary, and failure display / non-leakage passed via Stage 47 local operator trial evidence.
- Optional real provider smoke: `not_run`; no operator-provided real provider environment was used.
- New items count: 0
- Blockers: none
- Accepted follow-ups: Stage 49 Post-V1 Backlog Prioritization v0.
- Rejected/out-of-scope items: none in this trial.
- Next routing decision: proceed to Stage 49; use Stage 48 only if a blocker is later found.
```

Update `## Next Review` so its default next route is Stage 49 after Stage 47, with Stage 48 only for blockers.

- [ ] **Step 2: Update roadmap**

In `docs/project-roadmap.md`:

- Add Stage 47 to the current status snapshot.
- Update the V1 polished alpha target paragraph so Stage 47 is complete and default next route is Stage 49; Stage 48 remains conditional.
- Mark Stage 47 status as `已实现，当前已完成`.
- Add implementation summary bullets with links to `docs/v1-polished-alpha-operator-trial.md`, `docs/v1-polished-alpha-completion.md`, and `docs/alpha-feedback-log.md`.
- Move recommended next-stage queue to Stage 49, Stage 48 conditional, Stage 50 optional, and a sensible Stage 51 placeholder if needed to keep 3-5 near-term stages.
- Add a decision record:

```md
- 2026-05-24 Stage 47 已完成 Internal RC Trial Feedback Batch v0：deterministic local operator trial passed，未记录 blockers，completion note decision 更新为 `go_for_internal_rc`；默认下一路由为 Stage 49 Post-V1 Backlog Prioritization v0，Stage 48 仅在后续发现 blocker 时启用。
```

- [ ] **Step 3: Update Superpowers docs statuses**

In `docs/superpowers/README.md`:

- Add entry 122 for this plan if it is not already present.
- Mark entries 121 and 122 as `已实现，当前已完成` after Task 2 and Task 3 passed.
- Link the completion/trial evidence note where useful.

In the Stage 47 spec and plan files:

- Change status wording from pending/approved to implemented/currently complete after successful closeout.
- Do not rewrite unrelated content.

- [ ] **Step 4: Verify and commit**

Run:

```bash
rg -n "Stage 47|Stage 48|Stage 49|go_for_internal_rc|v1-polished-alpha-operator-trial|batch_2026_05_24_stage_47|当前推荐|待实施" docs/alpha-feedback-log.md docs/project-roadmap.md docs/superpowers/README.md docs/superpowers/specs/2026-05-24-internal-rc-trial-feedback-batch-design.md docs/superpowers/plans/2026-05-24-internal-rc-trial-feedback-batch.md docs/v1-polished-alpha-completion.md docs/v1-polished-alpha-operator-trial.md
git diff --check
```

Expected: Stage 47 is complete, Stage 49 is the default next route, Stage 48 remains conditional, no stale Stage 47 `当前推荐` / `待实施` remains except historical plan instructions if clearly not a status line. `git diff --check` exits 0.

Commit:

```bash
git add docs/alpha-feedback-log.md docs/project-roadmap.md docs/superpowers/README.md docs/superpowers/specs/2026-05-24-internal-rc-trial-feedback-batch-design.md docs/superpowers/plans/2026-05-24-internal-rc-trial-feedback-batch.md
git commit -m "close internal rc trial feedback"
```

---

## Final Verification

After all tasks and reviews:

```bash
pnpm alpha:check
pnpm smoke
pnpm alpha:e2e
pnpm test
pnpm typecheck
pnpm build
rg -n "go_for_internal_rc|Stage 47|Stage 48|Stage 49|v1-polished-alpha-operator-trial|batch_2026_05_24_stage_47|needs_operator_trial|no_go_blocked" README.md docs/alpha-release-candidate.md docs/web-v1-acceptance.md docs/v1-polished-alpha-completion.md docs/v1-polished-alpha-operator-trial.md docs/alpha-feedback-log.md docs/project-roadmap.md docs/superpowers/README.md
git diff --check
git status --short --branch
```

Expected:

- Full deterministic gates pass.
- `docs/v1-polished-alpha-completion.md` decision is `go_for_internal_rc` if no blocker was found.
- Real provider opt-in smoke remains `not_run` unless explicitly executed.
- Feedback log has the Stage 47 batch.
- Roadmap default next route is Stage 49, with Stage 48 conditional.
- Working tree is clean.

If any full gate fails, follow the blocker rule: record `no_go_blocked`, route Stage 48, and do not fix in Stage 47.
