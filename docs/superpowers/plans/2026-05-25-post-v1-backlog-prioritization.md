# Stage 49 Post-V1 Backlog Prioritization v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a docs-only Post-V1 backlog prioritization ledger that selects the next default slice after V1 polished alpha.

**Architecture:** Gather completion, operator trial, feedback, and roadmap evidence into one prioritization document. Use a small scoring model to pick a single default Stage 51 slice, then synchronize completion docs, roadmap, and Superpowers indexes so the next agent can continue from the roadmap without reconstructing history.

**Tech Stack:** Markdown documentation, git worktree isolation, `rg`, `pnpm alpha:check`, `pnpm smoke`, and `git diff --check`.

---

## File Structure

- Create: `docs/post-v1-backlog-prioritization.md`
  - Owns Stage 49 evidence inputs, scoring model, candidate ranking, selected Stage 51 default, and deferred routes.
- Modify: `docs/v1-polished-alpha-completion.md`
  - Updates accepted follow-ups and next routing after Stage 49 completes.
- Modify: `docs/alpha-feedback-log.md`
  - Records that the Stage 47 accepted follow-up has been processed by Stage 49 and routed to Stage 51 / Stage 48 / Stage 50.
- Modify: `docs/project-roadmap.md`
  - Moves Stage 49 from active recommendation to completed stage, refreshes current snapshot, and rewrites the 3-5 item next-stage queue.
- Modify: `docs/superpowers/specs/2026-05-25-post-v1-backlog-prioritization-design.md`
  - Marks the spec completed during closeout.
- Modify: `docs/superpowers/README.md`
  - Updates the Stage 49 design entry and adds this implementation plan entry.

## Worktree And Baseline

- [ ] **Step 1: Confirm current checkout state**

Run:

```bash
git status --short --branch
```

Expected: current branch is `main` and clean before creating the Stage 49 worktree.

- [ ] **Step 2: Detect existing worktree isolation**

Run:

```bash
git rev-parse --git-dir
```

Run:

```bash
git rev-parse --git-common-dir
```

Run:

```bash
git rev-parse --show-superproject-working-tree
```

Expected: the root checkout is not already a linked worktree and is not a submodule.

- [ ] **Step 3: Create the Stage 49 worktree**

Run:

```bash
git check-ignore -q .worktrees
```

Expected: exit code `0`.

Run:

```bash
git worktree add .worktrees/stage-49-post-v1-backlog-prioritization -b stage-49-post-v1-backlog-prioritization
```

Expected: a new worktree is created at `.worktrees/stage-49-post-v1-backlog-prioritization`.

- [ ] **Step 4: Install and verify baseline in the worktree**

Run from `.worktrees/stage-49-post-v1-backlog-prioritization`:

```bash
pnpm install
```

Expected: workspace dependencies are available without changing committed files.

Run:

```bash
pnpm alpha:check
```

Expected: deterministic alpha check passes.

Run:

```bash
pnpm smoke
```

Expected: smoke tests pass.

## Task 1: Create The Prioritization Ledger

**Files:**
- Create: `docs/post-v1-backlog-prioritization.md`

- [ ] **Step 1: Read the source evidence**

Run:

```bash
sed -n '1,220p' docs/v1-polished-alpha-completion.md
```

Run:

```bash
sed -n '1,220p' docs/v1-polished-alpha-operator-trial.md
```

Run:

```bash
sed -n '1,240p' docs/alpha-feedback-log.md
```

Run:

```bash
sed -n '1,120p' docs/project-roadmap.md
```

Run:

```bash
sed -n '816,940p' docs/project-roadmap.md
```

Expected: evidence confirms `go_for_internal_rc`, no open blockers, Stage 49 as current default route, Stage 48 conditional, Stage 50 optional, and Stage 51 waiting for selected slice.

- [ ] **Step 2: Create the prioritization document**

Create `docs/post-v1-backlog-prioritization.md` with this structure and content:

```markdown
# Post-V1 Backlog Prioritization

**Stage:** 49 - Post-V1 Backlog Prioritization v0
**Date:** 2026-05-25
**Status:** completed
**Decision:** default next slice is Stage 51 MCP Management Surface v0 Spec Kickoff.

This document is the current routing ledger for post-V1 backlog work after the V1 polished alpha completion gate and Stage 47 local operator trial. It records safe summaries only and does not include secrets, raw provider responses, raw tool output, full artifact contents, or local machine paths.

## Evidence Inputs

| Source | Evidence summary | Routing impact |
| --- | --- | --- |
| `docs/v1-polished-alpha-completion.md` | RC decision is `go_for_internal_rc`; deterministic gates and local operator trial passed; real provider opt-in smoke remains `not_run`; no open blockers are recorded. | No blocker batch is needed by default. Stage 48 remains conditional. |
| `docs/v1-polished-alpha-operator-trial.md` | Stage 47 local operator trial passed manual acceptance areas and found no blockers. | Proceed to post-V1 sorting instead of blocker repair. |
| `docs/alpha-feedback-log.md` | Stage 47 feedback batch recorded new items count `0`, blockers `none`, and accepted follow-up route to Stage 49. | Stage 49 can close the accepted follow-up by choosing the next slice. |
| `docs/project-roadmap.md` | Backlog groups include MCP management, browser platform, model gateway, worker/sandbox, context/memory, deployment, auth/storage, Web UI, and desktop. | Use the roadmap as the source of truth for candidate categories. |

## Prioritization Model

Each candidate is scored from 0 to 3 on five dimensions:

| Dimension | Meaning |
| --- | --- |
| User value | Directly improves a post-V1 internal user's visible or operable capability. |
| Risk reduction | Reduces release, runtime, configuration, safety, or validation risk. |
| Dependency unlock | Creates a reusable boundary for multiple later backlog items. |
| Implementation size | Fits a narrow spec / plan; 3 means small and controlled, 0 means too broad. |
| Validation clarity | Can be verified with deterministic tests, docs evidence, or browser acceptance. |

Conditional blocker work is not scored. If a real blocker is accepted later, Stage 48 takes precedence over backlog feature work.

## Candidate Scores

| Rank | Candidate | User value | Risk reduction | Dependency unlock | Implementation size | Validation clarity | Total | Route |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | MCP Management Surface v0 Spec Kickoff | 3 | 2 | 3 | 3 | 3 | 14 | Stage 51 default next slice |
| 2 | Browser Platform / Visual Baseline Planning v0 | 2 | 2 | 2 | 3 | 3 | 12 | Stage 50 optional planning |
| 3 | Real Deployment Runner Discovery v0 | 3 | 2 | 2 | 1 | 1 | 9 | Stage 52 later discovery candidate |
| 4 | Model Gateway Cost / Fallback Policy Discovery v0 | 2 | 2 | 2 | 1 | 2 | 9 | Stage 53 later discovery candidate |
| 5 | Auth / RBAC / Production Storage Foundation v0 | 2 | 3 | 3 | 0 | 1 | 9 | Deferred until product pull or production rollout planning |
| 6 | Worker / Sandbox Real Execution v0 | 2 | 3 | 2 | 0 | 1 | 8 | Deferred until a dedicated safety spec |
| 7 | Context / Memory Retrieval Expansion v0 | 1 | 1 | 2 | 2 | 2 | 8 | Deferred until a stronger product pull |
| 8 | Desktop Packaging v0 | 1 | 1 | 1 | 1 | 1 | 5 | Long-term backlog |

## Default Stage 51

Stage 51 should be **MCP Management Surface v0 Spec Kickoff**.

Scope for Stage 51:

- Define a safe Web MCP management surface for connector list, connector health, tool visibility, approval status, and read-only execution status.
- Preserve V1 non-leakage boundaries for connector metadata, tool arguments, tool output, local paths, secrets, and artifact content.
- Reuse existing MCP registry, approval, visible tools, local deterministic executor, run events, and `ToolObservationRecord` concepts.
- Specify route behavior for legacy `view=mcp`, hidden navigation recovery, and any restored Web entry points.
- Define deterministic tests and browser acceptance for management visibility, failure copy, and non-leakage.

Non-goals for Stage 51:

- Do not implement remote MCP SDK or external MCP server adapters.
- Do not add write tools.
- Do not enable MCP worker execution.
- Do not add production auth/RBAC or external secret storage.
- Do not change real provider or deployment runner behavior.

## Recommended Next-Stage Queue

1. Stage 51: MCP Management Surface v0 Spec Kickoff, default next product/platform slice.
2. Stage 48: RC Blocker Fix Batch v0, conditional only if a blocker is accepted later.
3. Stage 50: Browser Platform / Visual Baseline Planning v0, optional planning track.
4. Stage 52: Real Deployment Runner Discovery v0, later discovery candidate.
5. Stage 53: Model Gateway Cost / Fallback Policy Discovery v0, later discovery candidate.

## Deferred Routes

| Item | Route |
| --- | --- |
| Auth / RBAC / production storage foundation | Deferred until a production rollout or team collaboration pull exists. |
| Real shell runner and strong sandbox adapter | Deferred until a dedicated safety spec with explicit approval and isolation boundaries. |
| Object storage and artifact content migration | Deferred until production storage planning. |
| Context / memory retrieval expansion | Deferred until a product workflow requires stronger recall than deterministic same-project context. |
| Desktop packaging | Long-term backlog. |

## Verification

Stage 49 changed documentation only. Final verification used:

- `rg -n "Stage 49|Stage 51|Post-V1|MCP Management" docs/project-roadmap.md docs/post-v1-backlog-prioritization.md docs/v1-polished-alpha-completion.md`
- `rg -n "post-v1-backlog-prioritization" docs/superpowers/README.md`
- `git diff --check`
- `pnpm alpha:check`
- `pnpm smoke`
```

- [ ] **Step 3: Verify the ledger references**

Run:

```bash
rg -n "Stage 51|MCP Management|Real Deployment Runner|Model Gateway Cost" docs/post-v1-backlog-prioritization.md
```

Expected: the document contains the selected Stage 51 default and later routes.

- [ ] **Step 4: Commit Task 1**

Run:

```bash
git add docs/post-v1-backlog-prioritization.md
```

Run:

```bash
git commit -m "add post v1 backlog prioritization ledger"
```

Expected: one commit creates the prioritization ledger.

## Task 2: Sync Completion And Feedback Routing

**Files:**
- Modify: `docs/v1-polished-alpha-completion.md`
- Modify: `docs/alpha-feedback-log.md`

- [ ] **Step 1: Update completion follow-ups**

In `docs/v1-polished-alpha-completion.md`, replace the `## Accepted Follow-ups` list with:

```markdown
## Accepted Follow-ups

- Stage 47: Internal RC Trial Feedback Batch v0, completed with no blockers.
- Stage 49: Post-V1 Backlog Prioritization v0, completed by `docs/post-v1-backlog-prioritization.md`.
- Stage 51: MCP Management Surface v0 Spec Kickoff, default next product/platform slice.
- Stage 48: RC Blocker Fix Batch v0, conditional only if a blocker is accepted later.
- Stage 50: Browser Platform / Visual Baseline Planning v0, optional planning track.
```

In the `## RC Decision` section, replace the `Next routing decision` bullet with:

```markdown
- Next routing decision: Proceed to Stage 51 MCP Management Surface v0 Spec Kickoff by default; use Stage 48 only if a blocker is later found; keep Stage 50 as an optional browser platform / visual baseline planning track.
```

- [ ] **Step 2: Update feedback log routing**

Run:

```bash
rg -n "Stage 49|accepted follow-up|Accepted Follow|blockers" docs/alpha-feedback-log.md
```

Update the Stage 47 feedback batch so it states that the accepted follow-up route was processed by Stage 49 and now points to Stage 51 by default, Stage 48 conditionally, and Stage 50 optionally. Preserve the recorded `new items count 0` and `blockers none` facts.

- [ ] **Step 3: Verify completion and feedback consistency**

Run:

```bash
rg -n "Stage 49|Stage 51|Stage 48|Stage 50|go_for_internal_rc|blockers" docs/v1-polished-alpha-completion.md docs/alpha-feedback-log.md
```

Expected: completion docs no longer describe Stage 49 as the next unprocessed follow-up, and both docs still preserve `go_for_internal_rc` and no-blocker evidence.

- [ ] **Step 4: Commit Task 2**

Run:

```bash
git add docs/v1-polished-alpha-completion.md docs/alpha-feedback-log.md
```

Run:

```bash
git commit -m "sync post v1 completion routing"
```

Expected: one commit updates accepted follow-up routing without changing runtime code.

## Task 3: Close Roadmap And Superpowers Docs

**Files:**
- Modify: `docs/project-roadmap.md`
- Modify: `docs/superpowers/specs/2026-05-25-post-v1-backlog-prioritization-design.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Update roadmap status and queue**

In `docs/project-roadmap.md`:

- Set `最后更新：2026-05-25`.
- Add the current snapshot fact: `Post-V1 backlog prioritization v0：Stage 49 已完成 docs-only backlog scoring，默认下一阶段为 Stage 51 MCP Management Surface v0 Spec Kickoff；Stage 48 保持 blocker 条件触发，Stage 50 保持 browser platform / visual baseline 可选规划路径。`
- Move Stage 49 into completed stage records with:
  - status `已实现，当前已完成`
  - design link `docs/superpowers/specs/2026-05-25-post-v1-backlog-prioritization-design.md`
  - implementation plan link `docs/superpowers/plans/2026-05-25-post-v1-backlog-prioritization.md`
  - completion record `docs/post-v1-backlog-prioritization.md`
- Rewrite the recommended next-stage queue to exactly five entries:
  - Stage 51 MCP Management Surface v0 Spec Kickoff, default next stage.
  - Stage 48 RC Blocker Fix Batch v0, conditional only if accepted blockers appear.
  - Stage 50 Browser Platform / Visual Baseline Planning v0, optional planning track.
  - Stage 52 Real Deployment Runner Discovery v0, later discovery candidate.
  - Stage 53 Model Gateway Cost / Fallback Policy Discovery v0, later discovery candidate.
- Add a decision record: `2026-05-25 Stage 49 已完成 Post-V1 Backlog Prioritization v0：docs-only scoring ledger 选择 Stage 51 MCP Management Surface v0 Spec Kickoff 作为默认下一阶段；Stage 48 继续仅在 blocker 出现时启用，Stage 50 保持 optional browser platform planning，Stage 52 / Stage 53 分别保留 real deployment runner 和 model gateway cost / fallback discovery。`

- [ ] **Step 2: Update Superpowers spec and README**

In `docs/superpowers/specs/2026-05-25-post-v1-backlog-prioritization-design.md`, change:

```markdown
**状态：** 已批准，待实施计划。
```

to:

```markdown
**状态：** 已实现，当前已完成。
```

In `docs/superpowers/README.md`, update entry 123 status to completed and add entry 124:

```markdown
124. `plans/2026-05-25-post-v1-backlog-prioritization.md`
   - Stage 49 Post-V1 Backlog Prioritization v0 implementation plan（已实现，当前已完成）。
   - 在 Stage 49 design 后阅读，用于创建 `docs/post-v1-backlog-prioritization.md` scoring ledger、更新 V1 completion / feedback routing、同步 roadmap 下一阶段队列，并验证 docs-only 阶段没有改变 runtime 默认 gate。
```

- [ ] **Step 3: Run documentation consistency checks**

Run:

```bash
rg -n "Stage 49|Stage 51|MCP Management Surface|Post-V1 Backlog" docs/project-roadmap.md docs/post-v1-backlog-prioritization.md docs/v1-polished-alpha-completion.md docs/superpowers/README.md
```

Expected: Stage 49 is completed, Stage 51 is the default next stage, and the prioritization ledger is discoverable.

Run:

```bash
rg -n "post-v1-backlog-prioritization" docs/superpowers/README.md docs/project-roadmap.md
```

Expected: both README and roadmap reference the design, implementation plan, or completion ledger.

- [ ] **Step 4: Commit Task 3**

Run:

```bash
git add docs/project-roadmap.md docs/superpowers/specs/2026-05-25-post-v1-backlog-prioritization-design.md docs/superpowers/README.md
```

Run:

```bash
git commit -m "close post v1 backlog prioritization"
```

Expected: one commit closes roadmap and Superpowers docs.

## Final Verification And Merge

- [ ] **Step 1: Run final verification in the Stage 49 worktree**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

Run:

```bash
pnpm alpha:check
```

Expected: deterministic alpha check passes.

Run:

```bash
pnpm smoke
```

Expected: smoke tests pass.

- [ ] **Step 2: Request code review**

Use `superpowers:requesting-code-review` against the Stage 49 branch. The review must check:

- Stage 49 is docs-only and does not change runtime code.
- `docs/project-roadmap.md` has a completed Stage 49 record and a 3-5 item recommended next-stage queue.
- `docs/superpowers/README.md` includes both the Stage 49 design and plan.
- `docs/v1-polished-alpha-completion.md` and `docs/alpha-feedback-log.md` no longer leave Stage 49 as unprocessed.
- Verification commands passed or have concrete failure notes.

- [ ] **Step 3: Merge and clean up**

After review passes:

Run from the main checkout:

```bash
git merge stage-49-post-v1-backlog-prioritization
```

Expected: Stage 49 commits are merged to `main`.

Run:

```bash
git worktree remove .worktrees/stage-49-post-v1-backlog-prioritization
```

Expected: the Stage 49 worktree is removed.

Run:

```bash
git status --short --branch
```

Expected: `main` is clean and contains the merged Stage 49 commits.

## Self-Review Checklist

- [ ] The plan covers every goal in `docs/superpowers/specs/2026-05-25-post-v1-backlog-prioritization-design.md`.
- [ ] No task asks a worker to invent missing scoring criteria or next-stage routes.
- [ ] The plan keeps Stage 49 docs-only.
- [ ] The next-stage queue contains exactly five entries after closeout.
- [ ] Verification is proportional to a documentation-only stage and still checks deterministic alpha / smoke gates.
