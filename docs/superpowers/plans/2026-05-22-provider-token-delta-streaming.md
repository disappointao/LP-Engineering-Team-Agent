# Provider Token Delta Streaming Implementation Plan

> **For agentic workers:** Follow this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-neutral token delta streaming for ordinary assistant chat while preserving buffered structured output for LP Planner / Builder.

**Status:** In progress.

**Architecture:** Keep `ModelGateway.complete()` as the stable full-buffer API. Add a streaming contract and provider adapter implementations that yield safe text deltas plus terminal metadata. Wire only project-bound ordinary chat to this stream path; keep LP chain and deterministic default behavior unchanged.

**Tech Stack:** pnpm workspace, TypeScript, model gateway adapters, runtime adapter/service layer, Next.js NDJSON route, Vitest fake-fetch tests.

---

## File Structure

- Modify `packages/model-gateway/src/index.ts`: provider-neutral stream event types, default/mock stream implementation, provider-backed dispatch.
- Modify `packages/model-gateway/src/openai-completions.ts`: OpenAI-compatible streaming request and SSE parser.
- Modify `packages/model-gateway/src/anthropic-messages.ts`: Anthropic-compatible streaming request and SSE parser.
- Modify model-gateway tests near existing adapter tests.
- Modify `packages/runtime-adapters/src/index.ts`: assistant-safe streaming adapter seam or helper, preserving `run()`.
- Modify `packages/api/src/index.ts`: assistant chat streaming service path and tests.
- Modify `apps/web/src/lib/workbench-store.ts`: expose async assistant stream without persisting chunks.
- Modify `apps/web/src/app/api/chat/stream/route.ts`: stream provider deltas, persist terminal full text.
- Modify affected Web/API tests.
- Modify `docs/agent-development-learning.md`.
- Modify `docs/project-roadmap.md`.
- Modify `docs/superpowers/README.md`.
- Add `docs/superpowers/specs/2026-05-22-provider-token-delta-streaming-design.md`.
- Add `docs/superpowers/plans/2026-05-22-provider-token-delta-streaming.md`.

---

## Task 1: Planning Docs

**Files:**
- Add `docs/superpowers/specs/2026-05-22-provider-token-delta-streaming-design.md`
- Add `docs/superpowers/plans/2026-05-22-provider-token-delta-streaming.md`
- Modify `docs/superpowers/README.md`
- Modify `docs/project-roadmap.md`

- [x] Add Stage 35 design spec with scope, non-goals, architecture, tests, and documentation requirements.
- [x] Add Stage 35 implementation plan.
- [x] Register both docs in `docs/superpowers/README.md`.
- [x] Mark Stage 35 as current in `docs/project-roadmap.md`.

## Task 2: Model Gateway Streaming Contract

**Files:**
- Modify `packages/model-gateway/src/index.ts`
- Modify model-gateway tests

- [ ] Add `ModelStreamEvent` / terminal response types with bounded delta and safe usage/call metadata.
- [ ] Add `ModelGateway.stream()` while preserving `complete()`.
- [ ] Add in-memory/mock streaming tests and implementation.
- [ ] Confirm existing complete-path tests still pass.

## Task 3: Provider Adapter Fake Streams

**Files:**
- Modify `packages/model-gateway/src/openai-completions.ts`
- Modify `packages/model-gateway/src/anthropic-messages.ts`
- Modify adapter tests

- [ ] Add OpenAI-compatible streaming fake-fetch tests before implementation.
- [ ] Implement OpenAI-compatible SSE parsing and terminal metadata.
- [ ] Add Anthropic-compatible streaming fake-fetch tests before implementation.
- [ ] Implement Anthropic-compatible SSE parsing and terminal metadata.
- [ ] Cover malformed frame and missing usage fallback behavior.

## Task 4: Assistant Chat Streaming Wiring

**Files:**
- Modify `packages/runtime-adapters/src/index.ts`
- Modify `packages/api/src/index.ts`
- Modify `apps/web/src/lib/workbench-store.ts`
- Modify `apps/web/src/app/api/chat/stream/route.ts`
- Modify affected tests

- [ ] Add assistant-only streaming seam in runtime/API without changing LP chain `run()` semantics.
- [ ] Make `startStreamingChatPrompt` return provider stream when available and existing buffered chunks otherwise.
- [ ] Make `/api/chat/stream` accumulate provider deltas, emit `assistant.delta`, then persist one terminal assistant message.
- [ ] Ensure provider streaming failure uses bounded safe error and does not leak raw provider event bodies.
- [ ] Confirm LP Planner / Builder tests still prove `complete()` path remains buffered.

## Task 5: Docs And Validation

**Files:**
- Modify `docs/agent-development-learning.md`
- Modify `docs/project-roadmap.md`
- Modify `docs/superpowers/plans/2026-05-22-provider-token-delta-streaming.md`

- [ ] Update Agent learning notes for provider token delta vs terminal facts.
- [ ] Mark plan steps complete with validation evidence.
- [ ] Mark Stage 35 implemented in roadmap and keep recommended next-stage queue at 3-5 items.
- [ ] Run final validation:

```bash
pnpm alpha:check
pnpm smoke
pnpm test
pnpm typecheck
pnpm build
pnpm alpha:e2e
git diff --check
```

## Task 6: Closeout

**Files:**
- Modify `docs/project-roadmap.md`
- Modify `docs/superpowers/specs/2026-05-22-provider-token-delta-streaming-design.md`
- Modify `docs/superpowers/plans/2026-05-22-provider-token-delta-streaming.md`

- [ ] Confirm no unrelated generated artifacts are staged.
- [ ] Commit, merge back to `main`, and clean up the worktree if verification passes.
- [ ] Final response includes scope, validation commands, merge/cleanup status, and recommended next queue.
