# V1 Polished Alpha Completion Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the Stage 46 V1 polished alpha completion gate record, run full deterministic validation, and update RC / roadmap docs with an evidence-based go/no-go decision.

**Architecture:** This is a documentation and validation closeout stage. It creates one completion note as the evidence ledger, updates release / acceptance / roadmap docs to point to that ledger, and records gate results without expanding product scope or fixing blockers inside this stage.

**Tech Stack:** pnpm, Vitest, Playwright Chromium, TypeScript, Next.js build, Markdown docs.

---

## Files and Responsibilities

- Create: `docs/v1-polished-alpha-completion.md`
  - Owns Stage 46 evidence ledger: automated gates, manual acceptance status, optional real provider smoke status, known limitations, blockers, follow-ups, RC decision, and next routing.
- Modify: `README.md`
  - Updates top-level alpha status and links the Stage 46 completion note.
- Modify: `docs/alpha-release-candidate.md`
  - Points RC operators to the Stage 46 completion note and expands automated gates to the full completion gate.
- Modify: `docs/web-v1-acceptance.md`
  - Clarifies that detailed manual acceptance remains here, while the latest Stage 46 evidence ledger is in the completion note.
- Modify: `docs/project-roadmap.md`
  - Marks Stage 46 design / plan / completion state, records next recommended queue, and keeps decision records current.
- Modify: `docs/superpowers/README.md`
  - Adds this implementation plan and keeps Stage 46 spec / plan reading order accurate.

## Execution Rules

- Work in an isolated worktree branch named `stage-46-v1-polished-alpha-completion-gate`.
- Do not modify runtime, Web UI, repository, provider, MCP, worker, artifact, or test implementation code unless this plan is explicitly amended.
- If a deterministic gate fails, do not fix it in this stage. Record `no_go_blocked`, capture the safe summary, route to Stage 48 RC Blocker Fix Batch v0, and stop before marking Stage 46 complete.
- Optional real provider smoke remains `not_run` unless the operator has explicitly configured safe local env and requested it. Do not ask for or record real keys.
- Keep evidence safe: command names, pass/fail, counts, bounded error category, and doc links only. Do not paste secrets, raw provider responses, raw SSE frames, full artifact contents, local absolute paths, raw worker/tool payloads, or raw stdout/stderr.
- Commit each task separately with a short lowercase imperative summary.

---

### Task 1: Create Completion Evidence Ledger

**Files:**
- Create: `docs/v1-polished-alpha-completion.md`

- [ ] **Step 1: Add the Stage 46 completion note skeleton**

Create `docs/v1-polished-alpha-completion.md` with:

```md
# V1 Polished Alpha Completion

**Stage:** 46 - V1 Polished Alpha Completion Gate v0
**Date:** 2026-05-24
**Runtime mode:** deterministic default (`REAL_MODEL_RUNTIME=0`, `REAL_MODEL_PROVIDER_TEST=0`)
**Decision:** `in_progress`

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
| `pnpm alpha:check` | `not_run` | Pending Stage 46 execution. |
| `pnpm smoke` | `not_run` | Pending Stage 46 execution. |
| `pnpm alpha:e2e` | `not_run` | Pending Stage 46 execution. |
| `pnpm test` | `not_run` | Pending Stage 46 execution. |
| `pnpm typecheck` | `not_run` | Pending Stage 46 execution. |
| `pnpm build` | `not_run` | Pending Stage 46 execution. |
| `git diff --check` | `not_run` | Pending Stage 46 execution. |

## Manual Acceptance

Detailed checklist: `docs/web-v1-acceptance.md`.

| Area | Status | Evidence |
| --- | --- | --- |
| Ordinary chat | `not_run` | No separate operator trial evidence in this completion note yet. |
| LP live task and run timeline | `not_run` | No separate operator trial evidence in this completion note yet. |
| Artifact workspace | `not_run` | No separate operator trial evidence in this completion note yet. |
| Skills | `not_run` | No separate operator trial evidence in this completion note yet. |
| Models / MCP boundary | `not_run` | No separate operator trial evidence in this completion note yet. |
| Failure display / non-leakage spot-check | `not_run` | Covered by deterministic browser gate when `pnpm alpha:e2e` passes; no separate manual spot-check evidence yet. |

## Optional Real Provider Smoke

Detailed checklist: `docs/real-provider-alpha-smoke.md`.

| Smoke path | Status | Evidence |
| --- | --- | --- |
| Default no-key gate | `not_run` | Pending deterministic gate execution. |
| Real provider opt-in smoke | `not_run` | No operator-provided real provider environment for this completion note. |

## Known Limitations Acknowledged

- MCP management and visible MCP Web entry remain post-V1 backlog.
- Real deployment, auth/RBAC, object storage, production Postgres rollout, billing/quota, true shell execution, hosted observability, and desktop packaging remain post-V1 backlog.
- Real provider smoke is opt-in and is not required for default deterministic gates.
- Cross-browser matrix, remote browser farm, and pixel-perfect screenshot baselines remain post-V1 backlog.

## Open Blockers

- None recorded before Stage 46 gate execution.

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

- Decision: `in_progress`
- Reasoning: Stage 46 gate has not completed yet.
- Next routing decision: Continue Stage 46 gate execution.
```

- [ ] **Step 2: Verify the new note has no unsafe placeholders**

Run:

```bash
rg -n "TBD|TODO|replace_with|secret-value|raw provider" docs/v1-polished-alpha-completion.md
git diff --check
```

Expected: `rg` may match the safe-evidence phrase `raw provider` in the safety rules; no `TBD`, `TODO`, or fake secret placeholders. `git diff --check` exits 0.

- [ ] **Step 3: Commit**

```bash
git add docs/v1-polished-alpha-completion.md
git commit -m "add v1 alpha completion ledger"
```

---

### Task 2: Link RC and Acceptance Docs

**Files:**
- Modify: `README.md`
- Modify: `docs/alpha-release-candidate.md`
- Modify: `docs/web-v1-acceptance.md`

- [ ] **Step 1: Update README alpha status**

In `README.md`, update the opening scope paragraph to state that the project is now being closed out as a V1 polished alpha RC candidate:

```md
当前第一版交付目标是 **V1 polished alpha local RC candidate**：用户可以从大对话入口开始普通问答，发起 LP 复杂任务，看到流式聊天、live task progress、run timeline / recovery guidance，使用 artifact workspace、Skills 和 Models，并通过 deterministic gates 验证第一版 Web surface。
```

In the validation section after `pnpm build`, add:

```md
查看当前 V1 polished alpha completion gate 结果：

```text
docs/v1-polished-alpha-completion.md
```
```

- [ ] **Step 2: Update release candidate gate docs**

In `docs/alpha-release-candidate.md`, add this paragraph after the intro:

```md
Stage 46 completion gate 的当前证据记录见 `docs/v1-polished-alpha-completion.md`。准备内部 RC 前，先看该文件的 automated gate、manual acceptance、optional real provider smoke、open blockers 和 RC decision，再按本文 trial script 执行新的 operator 试用。
```

In the `Automated deterministic gates` row, ensure the Go standard lists:

```text
`pnpm alpha:check`、`pnpm smoke`、`pnpm alpha:e2e`、`pnpm test`、`pnpm typecheck`、`pnpm build`
```

In the RC Decision Record template, add:

```md
  - pnpm test:
  - pnpm typecheck:
  - pnpm build:
  - git diff --check:
```

- [ ] **Step 3: Update manual acceptance intro**

In `docs/web-v1-acceptance.md`, add after the second paragraph:

```md
Stage 46 completion gate 的本轮执行结果记录在 `docs/v1-polished-alpha-completion.md`。本文件仍是人工验收的详细 checklist；completion note 只记录某一轮 gate / trial 的安全摘要和 go/no-go 状态。
```

- [ ] **Step 4: Verify doc links**

Run:

```bash
rg -n "v1-polished-alpha-completion|pnpm test|pnpm typecheck|pnpm build|git diff --check" README.md docs/alpha-release-candidate.md docs/web-v1-acceptance.md docs/v1-polished-alpha-completion.md
git diff --check
```

Expected: matches in the updated docs; `git diff --check` exits 0.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/alpha-release-candidate.md docs/web-v1-acceptance.md docs/v1-polished-alpha-completion.md
git commit -m "link v1 alpha completion gate"
```

---

### Task 3: Run and Record Full Deterministic Gates

**Files:**
- Modify: `docs/v1-polished-alpha-completion.md`

- [ ] **Step 1: Capture candidate commit**

Run:

```bash
git rev-parse --short HEAD
```

Expected: a short commit SHA. Use it in the completion note as `Gate commit`.

- [ ] **Step 2: Run alpha check**

Run:

```bash
pnpm alpha:check
```

Expected: PASS. If it fails, set the completion note decision to `no_go_blocked`, record a safe summary, route to Stage 48, and stop execution after committing the no-go note.

- [ ] **Step 3: Run smoke**

Run:

```bash
pnpm smoke
```

Expected: PASS. If it fails, use the same `no_go_blocked` handling.

- [ ] **Step 4: Run browser acceptance**

Run:

```bash
pnpm alpha:e2e
```

Expected: PASS. If local browser dependencies are missing, run `pnpm alpha:e2e:install` and rerun once. If browser gate still fails, use the same `no_go_blocked` handling.

- [ ] **Step 5: Run full Vitest suite**

Run:

```bash
pnpm test
```

Expected: PASS. If it fails, use the same `no_go_blocked` handling.

- [ ] **Step 6: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS. If it fails, use the same `no_go_blocked` handling.

- [ ] **Step 7: Run build**

Run:

```bash
pnpm build
```

Expected: PASS. If it fails, use the same `no_go_blocked` handling.

- [ ] **Step 8: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 9: Update completion note with gate summaries**

If all gates pass, update `docs/v1-polished-alpha-completion.md`:

- Set `**Decision:**` to `needs_operator_trial`.
- Add `**Gate commit:**` below runtime mode, using the short SHA returned in Step 1.
- Change each automated gate status to `passed`.
- Use safe summaries from command outputs, for example:
  - `8 Vitest files / 144 tests passed.`
  - `2 smoke tests passed.`
  - `15 Playwright Chromium tests passed.`
  - `Full Vitest suite passed.`
  - `All workspace typechecks passed.`
  - `Workspace build passed.`
  - `No whitespace errors.`
- Set optional default no-key gate status to `passed` if the deterministic gates passed without real provider env.
- Keep real provider opt-in smoke as `not_run` unless it was explicitly run.
- Keep manual acceptance rows as `not_run` unless a separate operator trial was actually performed.
- Set RC decision:

```md
- Decision: `needs_operator_trial`
- Reasoning: Full deterministic gates passed, no blockers were found, and no separate human operator trial or real provider smoke evidence was recorded in this completion note.
- Next routing decision: Proceed to Stage 47 Internal RC Trial Feedback Batch v0 for operator trial feedback; use Stage 48 only if blockers appear.
```

- [ ] **Step 10: Verify completion note**

Run:

```bash
rg -n "not_run|passed|needs_operator_trial|no_go_blocked|Gate commit|Open Blockers" docs/v1-polished-alpha-completion.md
git diff --check
```

Expected: note shows passed automated gates and honest `not_run` manual / real provider statuses; `git diff --check` exits 0.

- [ ] **Step 11: Commit**

```bash
git add docs/v1-polished-alpha-completion.md
git commit -m "record v1 alpha gate results"
```

---

### Task 4: Roadmap and Superpowers Closeout

**Files:**
- Modify: `docs/project-roadmap.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Mark Stage 46 plan in Superpowers README**

In `docs/superpowers/README.md`, after the Stage 46 spec entry, add:

```md
120. `plans/2026-05-24-v1-polished-alpha-completion-gate.md`
   - Stage 46 V1 Polished Alpha Completion Gate v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 46 design 后阅读，用于创建 completion ledger、运行完整 deterministic gates、记录 honest manual / real provider smoke 状态、更新 RC docs、roadmap closeout 和后续 routing；完成记录见 `docs/v1-polished-alpha-completion.md`。
```

- [ ] **Step 2: Update roadmap Stage 46 status and next queue**

In `docs/project-roadmap.md`:

- Confirm Stage 46 status is `已实现` after Task 3 passed all default gates.
- Add implementation summary bullets:
  - completion ledger created at `docs/v1-polished-alpha-completion.md`
  - full deterministic gates recorded
  - manual acceptance / real provider smoke statuses recorded honestly
  - next routing set to Stage 47 / Stage 48 / Stage 49
- Add plan link:

```md
**实施计划：** `docs/superpowers/plans/2026-05-24-v1-polished-alpha-completion-gate.md`。
```

- Replace the recommended next stage queue so it contains Stage 47, Stage 48, and Stage 49 with suggested scope and non-goals from the Stage 46 design.

- [ ] **Step 3: Add roadmap decision record**

At the top of `docs/project-roadmap.md` decision records, add:

```md
- 2026-05-24 Stage 46 已完成 V1 Polished Alpha Completion Gate v0：completion note 已记录完整 deterministic gates、manual acceptance 状态、optional real provider smoke 状态、known limitations、open blockers 和 next routing；默认下一路由为 Stage 47 Internal RC Trial Feedback Batch v0，若 Stage 46/47 出现 blocker 则进入 Stage 48 RC Blocker Fix Batch v0。
```

If Task 3 recorded `no_go_blocked`, replace this with a no-go decision record and route Stage 48 as current recommendation.

- [ ] **Step 4: Verify roadmap/index consistency**

Run:

```bash
rg -n "Stage 46|Stage 47|Stage 48|Stage 49|v1-polished-alpha-completion" docs/project-roadmap.md docs/superpowers/README.md docs/v1-polished-alpha-completion.md
git diff --check
```

Expected: Stage 46 is complete if gates passed; recommended next queue is not empty; `git diff --check` exits 0.

- [ ] **Step 5: Commit**

```bash
git add docs/project-roadmap.md docs/superpowers/README.md
git commit -m "close v1 alpha completion gate"
```

---

## Final Verification

- [ ] Run focused docs consistency check:

```bash
rg -n "v1-polished-alpha-completion|Stage 46|Stage 47|Stage 48|Stage 49|needs_operator_trial|go_for_internal_rc|no_go_blocked" README.md docs/alpha-release-candidate.md docs/web-v1-acceptance.md docs/project-roadmap.md docs/superpowers/README.md docs/v1-polished-alpha-completion.md
```

Expected: all Stage 46 and next routing references are consistent.

- [ ] Run deterministic checks after documentation closeout:

```bash
pnpm alpha:check
pnpm smoke
git diff --check
```

Expected: PASS / no output.

- [ ] Inspect final worktree status:

```bash
git status --short --branch
```

Expected: clean working tree on `stage-46-v1-polished-alpha-completion-gate`.

---

## Self-Review Notes

- Spec coverage: plan covers completion note, full deterministic gates, honest manual / real provider smoke state, RC docs, roadmap, Superpowers index, and next routing.
- Scope control: plan does not change runtime, UI, provider, MCP, worker, artifact, repository, or test implementation code.
- Blocker discipline: failing gates produce `no_go_blocked` documentation and Stage 48 routing instead of ad hoc fixes.
