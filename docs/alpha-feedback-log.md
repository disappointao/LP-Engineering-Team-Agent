# Alpha Feedback Log

这份日志记录内部 V1 polished alpha feedback batch。所有条目必须遵守 `docs/alpha-feedback-intake.md` 的 safe evidence 规则。

`docs/alpha-feedback-intake.md` 的 Not allowed list 是本文件的权威安全边界。不要在本文件保存 secret/API key/env value、raw provider response、raw SSE frame、full artifact content、local absolute paths、raw worker payload、raw worker output、raw tool payload、raw tool output、raw stdout/stderr、private customer data 或 unsafe logs。

## Status Legend

| Status | Meaning |
| --- | --- |
| `new` | 已接收，尚未 triage。 |
| `accepted` | 已确认属于 V1 polished alpha 或当前阶段范围。 |
| `needs_repro` | 需要安全复现步骤或 bounded evidence。 |
| `needs_immediate_fix` | 阻塞当前 RC 或破坏安全边界。 |
| `routed` | 已进入明确 Stage 或 backlog。 |
| `rejected_out_of_scope` | 明确不属于 V1 polished alpha。 |
| `done` | 已由后续 commit 或文档更新关闭。 |

## Batch: 2026-05-23 V1 polished alpha planning batch

- Batch id: `batch_2026_05_23_v1_polished_alpha_planning`
- Date range: 2026-05-23
- Operator: local maintainer
- Source trial: planning discussion after Stage 39
- Automated gates summary: not run for this planning batch; Stage 39 final gates were already complete before this roadmap update.
- New items count: 6
- Blockers: none
- Next routing decision: keep Stage 40 feedback intake first, then route Web polish through Stage 41-46.

### AF-2026-05-23-001

- Summary: First-version Web scope should become V1 polished alpha instead of stopping at core local alpha.
- Category: `ux_friction`
- Severity: `high`
- Status: `routed`
- Steps: not applicable; planning decision captured from roadmap discussion.
- Expected: V1 scope and routing are explicit in roadmap/spec.
- Actual: planning item routed to Stage 40-46 V1 polished alpha completion scope.
- Environment:
  - Commit: `a446fad`
  - Date: 2026-05-23
  - Browser: not applicable
  - Runtime mode: not applicable
- Safe Evidence:
  - User decision: choose V1 polished alpha scope.
  - Related spec: `docs/superpowers/specs/2026-05-23-v1-polished-alpha-web-completion-design.md`
- Suggested Routing: Stage 40-46
- Decision: accepted. Roadmap should plan to V1 completion, not only the next single stage.

### AF-2026-05-23-002

- Summary: Keep feedback intake before Web polish work.
- Category: `docs_gap`
- Severity: `medium`
- Status: `routed`
- Steps: not applicable; planning decision captured from roadmap discussion.
- Expected: feedback intake and log routing are explicit before Web polish work.
- Actual: planning item routed to Stage 40 feedback intake/log process.
- Environment:
  - Commit: `a446fad`
  - Date: 2026-05-23
  - Browser: not applicable
  - Runtime mode: not applicable
- Safe Evidence:
  - User decision: choose feedback gate plus Web polish trains.
- Suggested Routing: Stage 40
- Decision: accepted. Stage 40 creates this intake/log process before UI implementation.

### AF-2026-05-23-003

- Summary: Hide MCP management and Web tab/sidebar/top-level entry from first-version Web.
- Category: `future_feature`
- Severity: `high`
- Status: `routed`
- Steps: not applicable; planning decision captured from roadmap discussion.
- Expected: MCP Web surface routing is explicit as hidden from V1 Web and moved to backlog where applicable.
- Actual: planning item routed to Stage 41 and backlog.
- Environment:
  - Commit: `a446fad`
  - Date: 2026-05-23
  - Browser: not applicable
  - Runtime mode: not applicable
- Safe Evidence:
  - User decision: MCP management and Web visible entry move to later work.
- Suggested Routing: Stage 41 and backlog
- Decision: accepted. Stage 41 hides MCP Web surface; MCP management remains backlog while existing backend MCP boundaries stay available for later stages.

### AF-2026-05-23-004

- Summary: Add a dedicated artifact workspace to first-version Web.
- Category: `artifact_quality_issue`
- Severity: `high`
- Status: `routed`
- Steps: not applicable; planning decision captured from roadmap discussion.
- Expected: dedicated artifact workspace routing is explicit in V1 polished alpha roadmap/spec.
- Actual: planning item routed to Stage 42.
- Environment:
  - Commit: `a446fad`
  - Date: 2026-05-23
  - Browser: not applicable
  - Runtime mode: not applicable
- Safe Evidence:
  - User decision: Dedicated artifact workspace should be part of V1 polished alpha.
- Suggested Routing: Stage 42
- Decision: accepted. Stage 42 owns artifact workspace page/view.

### AF-2026-05-23-005

- Summary: Improve run timeline, progress animation, handoff, and recovery UX before V1 completion.
- Category: `ux_friction`
- Severity: `high`
- Status: `routed`
- Steps: not applicable; planning decision captured from roadmap discussion.
- Expected: run timeline, progress, handoff, and recovery polish routing are explicit before V1 completion.
- Actual: planning item routed to Stage 43.
- Environment:
  - Commit: `a446fad`
  - Date: 2026-05-23
  - Browser: not applicable
  - Runtime mode: not applicable
- Safe Evidence:
  - User decision: advanced no-refresh workbench interaction and recovery UX enter V1.
- Suggested Routing: Stage 43
- Decision: accepted. Stage 43 owns timeline/recovery polish.

### AF-2026-05-23-006

- Summary: Include Skills and Models client-side management in V1, excluding MCP management.
- Category: `ux_friction`
- Severity: `medium`
- Status: `routed`
- Steps: not applicable; planning decision captured from roadmap discussion.
- Expected: Skills and Models management routing is explicit while MCP management remains later.
- Actual: planning item routed to Stage 44.
- Environment:
  - Commit: `a446fad`
  - Date: 2026-05-23
  - Browser: not applicable
  - Runtime mode: not applicable
- Safe Evidence:
  - User decision: Skills/Models management enters V1; MCP management remains later.
- Suggested Routing: Stage 44
- Decision: accepted. Stage 44 owns Skills/Models client-side management.

## Accepted Follow-ups

| Feedback id | Route | Follow-up |
| --- | --- | --- |
| AF-2026-05-23-001 | Stage 40-46 | Keep V1 polished alpha as first-version Web completion scope. |
| AF-2026-05-23-002 | Stage 40 | Create feedback intake/log process. |
| AF-2026-05-23-003 | Stage 41 | Hide MCP Web surface and route MCP management to backlog. |
| AF-2026-05-23-004 | Stage 42 | Build dedicated artifact workspace. |
| AF-2026-05-23-005 | Stage 43 | Polish run timeline and recovery UX. |
| AF-2026-05-23-006 | Stage 44 | Polish Skills/Models client-side management. |

## Rejected or Out of Scope

| Item | Reason | Route |
| --- | --- | --- |
| MCP management in V1 Web | User explicitly moved MCP management and visible Web entry to later work. | Backlog |
| Remote MCP SDK/write tools in V1 | Outside V1 polished alpha and requires separate worker/approval/sandbox design. | Backlog |
| Production auth/RBAC in V1 | Outside local single-user alpha. | Backlog |
| Billing/quota/cost ledger in V1 | Outside local single-user alpha. | Backlog |
| Real shell runner in V1 | Requires stronger sandbox and explicit execution policy. | Backlog |
| Hosted observability in V1 | Outside local deterministic alpha gates. | Backlog |

## Next Review

- Next batch trigger: after Stage 40 implementation or first internal V1 polished alpha trial.
- Required review inputs:
  - `docs/alpha-release-candidate.md` feedback template submissions.
  - Safe command summaries.
  - Browser acceptance output summaries.
  - Manual artifact quality rubric summaries when relevant.
- Default next route: Stage 41 Web Surface Pruning and V1 Navigation v0.
