# Provider Streaming and Usage Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-neutral usage metadata and streaming capability visibility for real model provider calls without changing deterministic defaults or LP structured output safety.

**Status:** Implemented.

**Architecture:** Extend `packages/model-gateway` response metadata, parse provider usage in OpenAI-compatible and Anthropic-compatible adapters, propagate bounded metadata through `runtime-adapters` `model.completed` events and API run event persistence, and render compact usage summary in the Web timeline. Stage 32 v0 exposes streaming support/call mode metadata only; it does not implement provider token delta streaming in the UI.

**Tech Stack:** pnpm workspace, TypeScript, Vitest, model-gateway provider adapters, runtime-adapters, API run events, Next.js Web formatter.

---

## File Structure

- Modify `packages/model-gateway/src/index.ts`: add usage/call metadata types and mock estimated metadata.
- Modify `packages/model-gateway/src/openai-completions.ts`: parse `total_tokens`, record duration, mark provider-reported usage and streaming state.
- Modify `packages/model-gateway/src/anthropic-messages.ts`: record duration, mark provider-reported usage and streaming state.
- Modify `packages/model-gateway/src/openai-completions.test.ts`: add usage metadata and streaming capability assertions.
- Modify `packages/model-gateway/src/anthropic-messages.test.ts`: add usage metadata and streaming capability assertions.
- Modify `packages/runtime-adapters/src/index.ts`: extend `model.completed` runtime event payload with bounded usage metadata.
- Modify `packages/runtime-adapters/src/index.test.ts`: assert runtime events carry usage metadata and remain secret-safe.
- Modify `packages/api/src/services.test.ts` or `packages/api/src/run-orchestrator.test.ts`: assert persisted run events contain bounded usage metadata only.
- Modify `apps/web/src/lib/chat-workbench.ts`: render compact model usage summary in timeline meta.
- Modify `apps/web/src/lib/chat-workbench.test.ts`: cover model usage summary formatting.
- Modify `README.md` or model runtime docs: document Stage 32 usage metadata and streaming capability boundary.
- Modify `docs/project-roadmap.md`: update Stage 32 state and next queue.
- Modify `docs/superpowers/README.md`: add Stage 32 spec/plan entries.
- Modify `docs/agent-development-learning.md`: record provider usage/streaming boundary.

---

### Task 1: Model Gateway Metadata Contract

**Files:**
- Modify: `packages/model-gateway/src/index.ts`
- Modify: `packages/model-gateway/src/openai-completions.test.ts`
- Modify: `packages/model-gateway/src/anthropic-messages.test.ts`

- [ ] **Step 1: Add failing metadata assertions**

Add test assertions for a completed response:

- `response.usage.inputTokens` and `response.usage.outputTokens` remain available.
- `response.usage.totalTokens` is available when provider reports it.
- `response.usage.source` is `provider_reported` for provider adapters.
- `response.call.attempt` is `1`.
- `response.call.durationMs` is a non-negative integer.
- `response.call.supportsStreaming` reflects route model capability.
- `response.call.streamingEnabled` is `false` in v0.

Expected: tests fail before the contract exists.

- [ ] **Step 2: Define response metadata types**

In `packages/model-gateway/src/index.ts`, add explicit types similar to:

```ts
export type ModelUsageSource = "provider_reported" | "estimated";

export interface ModelUsageMetadata {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  source: ModelUsageSource;
}

export interface ModelCallMetadata {
  attempt: number;
  durationMs: number;
  supportsStreaming: boolean;
  streamingEnabled: boolean;
}
```

Update `ModelResponse.usage` to use `ModelUsageMetadata`, and add `call: ModelCallMetadata`.

- [ ] **Step 3: Keep mock deterministic response compatible**

Update `createMockModelResponse()` so mock responses include:

- `usage.source: "estimated"`
- `usage.totalTokens` equal to input + output estimate
- `call.attempt: 1`
- `call.durationMs: 0`
- `call.supportsStreaming` from route capabilities
- `call.streamingEnabled: false`

- [ ] **Step 4: Run focused model-gateway tests**

Run:

```bash
pnpm --filter @lp-agent/model-gateway test
```

Expected: metadata contract tests fail only where provider adapters still need implementation, or pass after Task 2 if already implemented together.

---

### Task 2: Provider Adapter Usage Metadata

**Files:**
- Modify: `packages/model-gateway/src/openai-completions.ts`
- Modify: `packages/model-gateway/src/anthropic-messages.ts`
- Modify: `packages/model-gateway/src/openai-completions.test.ts`
- Modify: `packages/model-gateway/src/anthropic-messages.test.ts`

- [ ] **Step 1: Parse OpenAI-compatible total tokens**

Extend OpenAI response parsing to accept optional `usage.total_tokens`.

Rules:

- `prompt_tokens` and `completion_tokens` remain required.
- `total_tokens` is optional but must be finite and non-negative when present.
- If absent, compute total tokens from input + output.

- [ ] **Step 2: Add duration measurement**

In each adapter `complete*()` path, record a monotonic-ish timestamp before provider fetch and compute `durationMs` in a helper that returns a non-negative integer. Keep tests tolerant by checking number shape rather than exact duration.

- [ ] **Step 3: Build provider-reported usage metadata**

Return provider responses with:

- `usage.source: "provider_reported"`
- `usage.totalTokens`
- `call.attempt: 1`
- `call.durationMs`
- `call.supportsStreaming`
- `call.streamingEnabled: false`

- [ ] **Step 4: Preserve request body streaming behavior**

Keep OpenAI-compatible request body `stream: false`. For Anthropic-compatible requests, do not add streaming request fields in v0.

- [ ] **Step 5: Verify focused tests**

Run:

```bash
pnpm --filter @lp-agent/model-gateway test
```

Expected: all model-gateway tests pass.

---

### Task 3: Runtime And API Event Propagation

**Files:**
- Modify: `packages/runtime-adapters/src/index.ts`
- Modify: `packages/runtime-adapters/src/index.test.ts`
- Modify: `packages/api/src/services.test.ts` or `packages/api/src/run-orchestrator.test.ts`

- [ ] **Step 1: Add failing runtime event assertions**

Add or update tests so `model.completed` includes:

- `usage.inputTokens`
- `usage.outputTokens`
- `usage.totalTokens`
- `usage.source`
- `attempt`
- `durationMs`
- `supportsStreaming`
- `streamingEnabled`

Also assert serialized events do not contain API key values, base URL, raw provider response or raw model output.

- [ ] **Step 2: Extend RuntimeEvent model.completed type**

Update `RuntimeEvent` union and `toModelCompletedEvent()` to copy only bounded scalar fields from `ModelResponse`.

- [ ] **Step 3: Verify API persistence remains safe**

Because `run-orchestrator` shallow-copies runtime event payloads, add a regression test against persisted `RunEventRecord` to prove the payload contains the new usage summary and nothing sensitive.

- [ ] **Step 4: Run focused runtime/API tests**

Run:

```bash
pnpm --filter @lp-agent/runtime-adapters test
pnpm --filter @lp-agent/api test
```

Expected: runtime-adapters and API tests pass.

---

### Task 4: Web Timeline Usage Summary

**Files:**
- Modify: `apps/web/src/lib/chat-workbench.ts`
- Modify: `apps/web/src/lib/chat-workbench.test.ts`

- [ ] **Step 1: Add failing formatter test**

Add a `model.completed` run event fixture with provider/model/api/usage/call metadata. Assert `ChatToolEvent.meta` includes compact fields such as:

- `model.completed`
- provider/model
- protocol
- `in 10 / out 20 / total 30`
- `provider reported`
- duration
- streaming state

- [ ] **Step 2: Implement safe formatting helper**

Update `formatRunEventMeta()` so it adds usage summary only for `model.completed`, using allowlisted scalar values from `event.payload`.

Rules:

- Unknown/malformed values are skipped.
- Do not display base URL, API key env, prompt, raw output or raw provider response.
- Keep output compact; no new UI card.

- [ ] **Step 3: Run focused Web tests**

Run:

```bash
pnpm --filter @lp-agent/web test -- chat-workbench
```

Expected: Web formatter tests pass.

---

### Task 5: Documentation And Roadmap Closeout

**Files:**
- Modify: `README.md` or model runtime docs
- Modify: `docs/project-roadmap.md`
- Modify: `docs/superpowers/README.md`
- Modify: `docs/agent-development-learning.md`

- [ ] **Step 1: Document Stage 32 behavior**

Update user-facing docs to explain:

- usage metadata is visible in model timeline entries;
- provider token streaming delta UI is not implemented yet;
- deterministic path uses estimated usage;
- real provider smoke remains opt-in.

- [ ] **Step 2: Update roadmap**

Move Stage 32 from recommended next to completed once implementation and verification finish. Keep 3-5 next recommended stages, likely:

- Stage 33 Manual Alpha UX Tightening v0
- Stage 34 Browser Failure Injection and Visual Regression v0
- Stage 35 Provider Token Delta Streaming v0, only if Stage 32 proves the metadata boundary is stable

- [ ] **Step 3: Update Agent learning notes**

Record the distinction between provider-reported usage metadata, estimated deterministic usage, streaming support metadata and actual token delta streaming.

- [ ] **Step 4: Commit docs with implementation or closeout commit**

Commit documentation updates together with the implementation closeout if they reflect implemented behavior.

---

### Task 6: Final Verification

- [ ] **Step 1: Run alpha readiness gate**

```bash
pnpm alpha:check
```

- [ ] **Step 2: Run smoke tests**

```bash
pnpm smoke
```

- [ ] **Step 3: Run full test suite**

```bash
pnpm test
```

- [ ] **Step 4: Run typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: Run build**

```bash
pnpm build
```

- [ ] **Step 6: Check whitespace**

```bash
git diff --check
```

- [ ] **Step 7: Commit final implementation**

```bash
git add packages/model-gateway/src/index.ts packages/model-gateway/src/openai-completions.ts packages/model-gateway/src/anthropic-messages.ts packages/model-gateway/src/openai-completions.test.ts packages/model-gateway/src/anthropic-messages.test.ts packages/runtime-adapters/src/index.ts packages/runtime-adapters/src/index.test.ts packages/api/src/services.test.ts packages/api/src/run-orchestrator.test.ts apps/web/src/lib/chat-workbench.ts apps/web/src/lib/chat-workbench.test.ts README.md docs/project-roadmap.md docs/superpowers/README.md docs/agent-development-learning.md
git commit -m "add provider usage metadata"
```

Adjust the file list to actual touched files before committing.
