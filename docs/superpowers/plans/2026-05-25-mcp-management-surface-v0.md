# MCP Management Surface v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 Stage 51 MCP Management Surface v0 Spec Kickoff 的 docs-only closeout 准备，让 Stage 51 design、implementation plan、Superpowers index、roadmap 和后续 closeout 路由可被下一个 agent 直接执行和复核。

**Architecture:** Stage 51 是 docs-only kickoff，不修改 runtime、Web、backend、worker、MCP SDK 或 tool execution code。计划把已完成的 design commit、当前 plan 写入、Superpowers README / roadmap 同步和 completion closeout 拆成三个可提交任务，并明确 Stage 54 才是未来产品实现阶段。

**Tech Stack:** Markdown docs、Superpowers specs/plans、`rg`、`git diff --check`、git；保留现有 pnpm TypeScript monorepo、Next.js、`packages/api`、`packages/mcp-gateway`、`ToolObservationRecord` 等英文原文作为 Stage 54 future implementation context，不在 Stage 51 修改代码。

---

## 文件职责

- `docs/superpowers/specs/2026-05-25-mcp-management-surface-v0-design.md`
  - 已由 commit `3319143 plan mcp management surface kickoff` 写入 Stage 51 design，是本计划的上游输入。
- `docs/superpowers/plans/2026-05-25-mcp-management-surface-v0.md`
  - 本文件，记录 Stage 51 docs-only implementation plan、验证方法、提交粒度和后续 closeout 任务。
- `docs/superpowers/README.md`
  - Superpowers spec / plan 阅读索引；新增 Stage 51 plan 条目必须紧跟 Stage 51 design 条目。
- `docs/project-roadmap.md`
  - 记录 Stage 51 implementation plan 已写入，但 Stage 51 仍未标记 completed；推荐下一阶段队列继续保持 Stage 54 default、Stage 48 conditional、Stage 50 optional、Stage 52 / Stage 53 discovery。
- `docs/mcp-management-surface-v0-kickoff.md`
  - Task 3 建议创建的 completion note 或同等 completion ledger，用于 Stage 51 closeout；该文件不在 Task 1 或 Task 2 中创建。

## Scope Guard

Stage 51 任务只允许修改 docs。不要修改 `apps/web`、`packages/api`、`packages/mcp-gateway`、`packages/runtime-adapters`、`packages/model-gateway`、test code、runtime schema、server action 或 E2E fixture。

Stage 54 future implementation 可以在后续单独 stage 中触碰这些 code files / areas，但本计划只把它们作为上下文记录：

- `apps/web/src/app/page.tsx`
- `apps/web/src/lib/workbench-store.ts`
- `apps/web/src/app/actions.ts`
- `apps/web/src/lib/i18n.ts`
- `apps/web/src/app/page.test.ts`
- `apps/web/e2e/alpha-boundaries.spec.ts`
- `packages/api` 的现有 MCP service / repository wiring
- `packages/mcp-gateway` 的现有 registry / visible tools / approval contracts

---

### Task 1: Stage 51 Design Spec and Learning / Roadmap / README Index Baseline

**Files:**
- Verify: `docs/superpowers/specs/2026-05-25-mcp-management-surface-v0-design.md`
- Verify: `docs/agent-development-learning.md`
- Verify: `docs/project-roadmap.md`
- Verify: `docs/superpowers/README.md`

**Status:** 已由 commit `3319143 plan mcp management surface kickoff` 完成。执行本 task 的 agent 只做复核，不改代码；只有发现索引或 roadmap 与 commit `3319143` 事实不一致时，才做 docs-only 修正。

- [ ] **Step 1: Confirm the design commit is present**

Run: `git log --oneline --decorate -5`

Expected: output contains `3319143 plan mcp management surface kickoff` in the current branch history, or a descendant commit that includes the same design files.

- [ ] **Step 2: Verify Stage 51 design scope**

Run: `rg -n "Stage 51|MCP Management Surface|Stage 54|runtime|Web|backend|ToolObservationRecord" docs/superpowers/specs/2026-05-25-mcp-management-surface-v0-design.md`

Expected: output confirms the design is Stage 51, defines `MCP Management Surface v0`, references future Stage 54 implementation, reuses safe `ToolObservationRecord`, and states Stage 51 does not implement runtime / Web / backend / worker / MCP SDK / tool execution code.

- [ ] **Step 3: Verify Agent learning note is current**

Run: `rg -n "Stage 51|MCP Management Surface|ToolObservationRecord|raw MCP output" docs/agent-development-learning.md`

Expected: output includes a Stage 51 learning note that frames MCP Management Surface as a safe projection of existing MCP registry, read-only execution, and `ToolObservationRecord`, not runtime expansion or a raw output channel.

- [ ] **Step 4: Verify roadmap and Superpowers index include the design**

Run: `rg -n "Stage 51|MCP Management Surface|implementation planning|Stage 54" docs/project-roadmap.md docs/superpowers/README.md`

Expected: output shows the Stage 51 design is discoverable, Stage 51 is approved for implementation planning, Stage 51 is not yet completed, and Stage 54 remains the future implementation route.

- [ ] **Step 5: Commit only if baseline docs needed correction**

Run: `git diff -- docs/superpowers/specs/2026-05-25-mcp-management-surface-v0-design.md docs/agent-development-learning.md docs/project-roadmap.md docs/superpowers/README.md`

Expected: no diff for a pure verification pass. If corrections were required, commit only docs changes.

Commit message if corrections were needed: `align mcp management surface design docs`

---

### Task 2: Stage 51 Plan Document and Superpowers Index / Roadmap Sync

**Files:**
- Create: `docs/superpowers/plans/2026-05-25-mcp-management-surface-v0.md`
- Modify: `docs/superpowers/README.md`
- Modify: `docs/project-roadmap.md`

- [ ] **Step 1: Create the Stage 51 implementation plan**

Create `docs/superpowers/plans/2026-05-25-mcp-management-surface-v0.md` with this structure:

- Required `# MCP Management Surface v0 Implementation Plan` header.
- `Goal` states Stage 51 docs-only closeout preparation.
- `Architecture` states Stage 51 does not modify runtime/Web/backend/worker/MCP SDK/tool execution code.
- `Tech Stack` lists Markdown docs and verification commands, while preserving `ToolObservationRecord` and code path names as future Stage 54 context.
- Three tasks: Task 1 baseline verification, Task 2 current plan/index/roadmap sync, Task 3 Stage 51 completion closeout.

Expected: the plan is written in Chinese, uses checkbox syntax, contains exact files, steps, validation commands, expected output, and commit messages, and contains no placeholder markers.

- [ ] **Step 2: Add the plan to the Superpowers README index**

Modify `docs/superpowers/README.md` by inserting this entry immediately after `specs/2026-05-25-mcp-management-surface-v0-design.md`:

```markdown
126. `plans/2026-05-25-mcp-management-surface-v0.md`
   - Stage 51 MCP Management Surface v0 implementation plan（docs-only closeout plan；当前未标记完成）。
   - 在 Stage 51 design 后阅读，用于执行 docs-only closeout：复核 design commit `3319143`、写入本 implementation plan、同步 Superpowers README / roadmap，并为后续 completion note 和 Stage 54 default implementation route 保留清晰边界；本计划不修改 runtime、Web、backend、worker、MCP SDK、tool execution code 或 tests。
```

Expected: Stage 51 design remains item 125, this plan becomes item 126, and the entry states docs-only scope.

- [ ] **Step 3: Update the roadmap snapshot**

Modify `docs/project-roadmap.md` current snapshot text so it records:

- Stage 51 design has been written.
- Stage 51 implementation plan has been written at `docs/superpowers/plans/2026-05-25-mcp-management-surface-v0.md`.
- Stage 51 is still not marked completed.
- Stage 54 remains the default implementation route after Stage 51 closeout.

Expected: roadmap does not move Stage 51 into completed records yet.

- [ ] **Step 4: Update the Stage 51 recommended queue section**

In `docs/project-roadmap.md`, update `### Stage 51：MCP Management Surface v0 Spec Kickoff` so:

- `状态` says design and implementation plan are written, but closeout is still pending.
- `当前结论` includes the implementation plan path.
- `后续收尾` says the remaining closeout should create `docs/mcp-management-surface-v0-kickoff.md` or an equivalent completion note, then update roadmap completion state.
- The queue still recommends Stage 54 default, Stage 48 conditional, Stage 50 optional, Stage 52 / Stage 53 discovery.

Expected: Stage 51 remains in the recommended queue until closeout is done.

- [ ] **Step 5: Add a roadmap decision record**

Add a new `docs/project-roadmap.md` decision record:

```markdown
- 2026-05-25 Stage 51 MCP Management Surface v0 implementation plan 已写入：`docs/superpowers/plans/2026-05-25-mcp-management-surface-v0.md` 把 kickoff 收口为 docs-only closeout，明确当前任务只同步 plan、Superpowers README 和 roadmap，不修改 runtime/Web/backend/test code；Stage 51 仍未标记 completed，completion closeout 后再创建 `docs/mcp-management-surface-v0-kickoff.md` 或同等 completion note，并保持 Stage 54 default、Stage 48 conditional、Stage 50 optional、Stage 52 / Stage 53 discovery 队列。
```

Expected: the new record is above older Stage 51 / Stage 49 records so the newest decision appears first.

- [ ] **Step 6: Run required docs validation**

Run: `rg -n "Stage 51|Stage 54|MCP Management Surface|docs-only|ToolObservationRecord" docs/superpowers/plans/2026-05-25-mcp-management-surface-v0.md docs/project-roadmap.md docs/superpowers/README.md`

Expected: output includes the new plan, roadmap, and README index entries; it confirms docs-only scope, Stage 54 future route, and safe `ToolObservationRecord` references.

- [ ] **Step 7: Check whitespace**

Run: `git diff --check`

Expected: no trailing whitespace or whitespace errors.

- [ ] **Step 8: Commit Task 2**

Run: `git add docs/superpowers/plans/2026-05-25-mcp-management-surface-v0.md docs/superpowers/README.md docs/project-roadmap.md`

Expected: files are staged.

Run: `git commit -m "write mcp management surface plan"`

Expected: commit succeeds and creates a docs-only commit.

---

### Task 3: Stage 51 Completion Closeout

**Files:**
- Create: `docs/mcp-management-surface-v0-kickoff.md` or an equivalent Stage 51 completion note
- Modify: `docs/project-roadmap.md`
- Modify: `docs/superpowers/README.md` if the completion note should be discoverable from the Stage 51 reading path

- [ ] **Step 1: Re-read Stage 51 design and plan**

Run: `rg -n "Stage 51|Stage 54|Non-goals|Future Implementation Boundaries|Recommended Next Route|docs-only" docs/superpowers/specs/2026-05-25-mcp-management-surface-v0-design.md docs/superpowers/plans/2026-05-25-mcp-management-surface-v0.md`

Expected: output confirms Stage 51 is a docs-only kickoff and Stage 54 is the separate future product implementation stage.

- [ ] **Step 2: Create the Stage 51 completion note**

Create `docs/mcp-management-surface-v0-kickoff.md` or an equivalent completion note with these facts:

- Design commit: `3319143 plan mcp management surface kickoff`.
- Plan commit: the commit produced by Task 2.
- Stage 51 scope: docs-only MCP Management Surface v0 design / plan / closeout.
- Code changes: none to runtime, Web, backend, worker, MCP SDK, tool execution code, or tests.
- Validation evidence: include `rg -n "Stage 51|Stage 54|MCP Management Surface|docs-only|ToolObservationRecord" ...` and `git diff --check` results from Task 2, plus any closeout-specific docs checks.
- Recommended next-stage queue: Stage 54 default, Stage 48 conditional, Stage 50 optional, Stage 52 / Stage 53 discovery.

Expected: completion note is factual, dated, and does not claim Stage 54 implementation has started.

- [ ] **Step 3: Move Stage 51 into completed roadmap state**

Modify `docs/project-roadmap.md` so:

- Current snapshot says Stage 51 completed docs-only kickoff.
- Completed stages include Stage 51 with links to design, implementation plan, and completion note.
- Recommended next-stage queue no longer lists Stage 51 as pending.
- Recommended queue keeps 3-5 near-term stages: Stage 54 default, Stage 48 conditional, Stage 50 optional, Stage 52 / Stage 53 discovery.
- Decision records include the Stage 51 closeout commit and validation evidence.

Expected: roadmap is not left with an empty recommended queue and does not mark Stage 54 as completed.

- [ ] **Step 4: Update Superpowers index only if needed**

If the completion note is intended as part of the Stage 51 reading path, add a short reference in `docs/superpowers/README.md` under the Stage 51 plan entry. If the completion note is tracked only from roadmap, leave the Superpowers index unchanged.

Expected: the reading order remains unambiguous.

- [ ] **Step 5: Run closeout validation**

Run: `rg -n "Stage 51|Stage 54|MCP Management Surface|docs-only|ToolObservationRecord|completed" docs/mcp-management-surface-v0-kickoff.md docs/project-roadmap.md docs/superpowers/README.md`

Expected: output shows Stage 51 is completed only after the completion note exists, Stage 54 remains default future implementation, and docs-only scope is preserved.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 6: Commit Stage 51 closeout**

Run: `git add docs/mcp-management-surface-v0-kickoff.md docs/project-roadmap.md docs/superpowers/README.md`

Expected: Stage 51 closeout docs are staged.

Run: `git commit -m "complete mcp management surface kickoff"`

Expected: commit succeeds as a docs-only closeout commit.

---

## Plan Self-review

- Spec coverage: Task 1 verifies the existing Stage 51 design and learning / roadmap / README baseline; Task 2 writes this plan and synchronizes the required index / roadmap files; Task 3 describes the remaining completion closeout without marking Stage 51 complete early.
- Placeholder scan: this plan intentionally contains no unresolved placeholder markers.
- Scope check: Stage 51 steps only touch docs. Stage 54 code paths are listed only as future implementation context.
- Routing check: recommended queue remains Stage 54 default, Stage 48 conditional, Stage 50 optional, Stage 52 / Stage 53 discovery.
