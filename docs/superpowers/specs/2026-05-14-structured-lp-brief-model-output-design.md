# Structured LP Brief Model Output Design

Date: 2026-05-14

## Status

Approved direction: parse real Planner model output into a validated `LPBrief` before it enters the LP business flow.

This is the next Stage 3 slice after provider-neutral model config, real runtime wiring, and the `anthropic-messages` / `openai-completions` adapters. The goal is not to make the whole LP generation chain model-driven yet. The goal is to safely replace the current real-runtime `sampleBrief` placeholder for Planner output with a schema-validated brief.

## Context

The project now has:

- `packages/lp-schema` with `LPBriefSchema` and related Zod schemas.
- `packages/model-gateway` with real `anthropic-messages` and `openai-completions` adapters.
- `packages/api` runtime wiring behind `REAL_MODEL_RUNTIME=1`.
- `packages/runtime-adapters` that calls a `ModelGateway` and records sanitized `model.completed` events.
- `packages/artifacts` that can generate framework-free static HTML/CSS/JS from an `LPBrief`.

The remaining gap is that `DemoWorkbenchService.createBriefFromPrompt()` still persists `sampleBrief` after the Planner run completes. In real runtime mode, the model can already produce text, but that text is not parsed into business data.

## Goals

- In real runtime mode, make Planner output produce an actual `LPBrief`.
- Validate the model output with `LPBriefSchema` before saving a `BriefRecord`.
- Keep deterministic local/default behavior unchanged when `REAL_MODEL_RUNTIME` is not `1`.
- Keep raw provider text out of persisted run events, context packs, Web state, and snapshots.
- Make parse success and parse failure observable through sanitized run events.
- Fail closed when Planner output is not valid JSON or does not match `LPBriefSchema`.
- Preserve static artifact generation: Builder still receives an `LPBrief` and `packages/artifacts` still emits framework-free static HTML/CSS/JS.

## Non-Goals

- No repair loop in this slice.
- No Builder model-generated page draft.
- No Reviewer model-generated findings.
- No streaming or partial JSON parsing.
- No MCP/tool execution.
- No automatic deployment.
- No fallback to `sampleBrief` after a real model parse failure.
- No persistence of raw model output.
- No schema migration unless the implementation discovers a repository contract cannot express required sanitized events.

## Activation

Structured Planner output should be active only when the Web/API runtime is already in real model mode:

```bash
REAL_MODEL_RUNTIME=1
```

Default behavior remains deterministic:

- `REAL_MODEL_RUNTIME` unset or not `1`: keep using the current mock runtime and `sampleBrief`.
- `REAL_MODEL_RUNTIME=1`: Planner prompt asks for strict JSON, and API parses the returned model text into `LPBriefSchema`.

This keeps ordinary tests, demos, and local development stable.

## Boundary Decision

Parsing belongs in `packages/api`, not `packages/model-gateway`.

Reasoning:

- `model-gateway` should stay provider/protocol focused. It should not know LP domain schema.
- `runtime-adapters` should stay role/runtime focused. It should not own LP business validation.
- `packages/api` already owns workbench orchestration, repository writes, run records, and `BriefRecord` creation.

The implementation can add a small API-local parser module, for example:

```ts
parsePlannerLPBriefOutput(text: string): LPBrief
```

The parser should use `LPBriefSchema.safeParse()` and return typed `LPBrief` only after validation succeeds.

## Planner Prompt Contract

When structured Planner output is enabled, the Planner prompt should wrap the user's original prompt with an explicit JSON contract.

The prompt should require:

- output exactly one JSON object;
- no Markdown fences;
- no prose before or after JSON;
- fields matching `LPBriefSchema`;
- sections with stable ids, section types, copy, CTA, layout hints, and validation rules;
- static LP constraints, including framework-free HTML/CSS/JS downstream output;
- ecommerce/custom LP details from the user prompt when present.

V0 should include a compact schema guide instead of dynamically serializing the whole Zod schema. This keeps the prompt understandable and easier to review.

## Parse Contract

V0 parser behavior:

- Trim the returned model text.
- Reject empty output.
- Parse with `JSON.parse`.
- Reject non-object JSON.
- Validate with `LPBriefSchema.safeParse`.
- Return parsed `LPBrief` on success.

V0 should not extract JSON from surrounding prose. If the model adds Markdown fences or commentary, that is a prompt-following failure and should become a parse failure. A later repair loop can decide whether to attempt cleanup or ask the model to fix its output.

## Runtime Result Text

The API needs access to the Planner model text, but raw model text must not be persisted.

Add a transient result field to the runtime boundary:

```ts
interface RuntimeRunResult {
  modelOutputText?: string;
}
```

Rules:

- `LocalAgentRuntimeAdapter` sets `modelOutputText` from `ModelResponse.text` after a successful model call.
- `runAgentStep` and repository event writers must not copy `modelOutputText` into run events.
- Web state, task snapshots, and context packs must not include `modelOutputText`.
- Tests should assert that invalid raw output does not appear in persisted events.

This is intentionally smaller than a generic artifact/output system. Tool outputs and long-lived observations belong to the future tool observation store, not this Planner parse slice.

## Run Flow

When `REAL_MODEL_RUNTIME=1`:

1. Web/API receives an LP prompt as it does today.
2. `DemoWorkbenchService.createBriefFromPrompt()` reserves a `briefId`.
3. API builds the structured Planner prompt from the user prompt.
4. `runAgentStep()` assembles Context Pack v0 and runs the Planner.
5. Runtime calls the configured real model provider.
6. Runtime returns sanitized model metadata in events and transient `modelOutputText` in memory.
7. API parses `modelOutputText` with `LPBriefSchema`.
8. On parse success:
   - save `BriefRecord.brief` as the parsed brief;
   - append a sanitized `model.output.parsed` event;
   - keep the Planner run completed.
9. On parse failure:
   - do not save a `BriefRecord`;
   - mark the Planner run failed;
   - append a sanitized `model.output.parse_failed` event;
   - surface `Planner run failed.` to existing callers.

Implementation must keep terminal run state consistent. A Planner run must not have a final `run.completed` event if its structured output parse failed. Adjust `runAgentStep` or an equivalent API-owned orchestration helper so API post-processing runs before terminal run state/events are persisted.

## Sanitized Events

Parse success event:

```ts
{
  type: "model.output.parsed",
  message: "Planner output parsed as LP brief",
  payload: {
    role: "planner",
    schema: "LPBriefSchema",
    title: parsed.title,
    sectionCount: parsed.sections.length,
    productCount: parsed.productData.length,
    hasAssets: parsed.assets.length > 0
  }
}
```

Parse failure event:

```ts
{
  type: "model.output.parse_failed",
  message: "Planner output could not be parsed as LP brief",
  payload: {
    role: "planner",
    schema: "LPBriefSchema",
    reason: "invalid_json" | "schema_invalid" | "empty_output",
    issueCount?: number,
    firstIssuePath?: string,
    firstIssueCode?: string
  }
}
```

Do not include:

- raw model text;
- API key;
- env var name;
- full base URL;
- provider response body;
- request headers.

## Error Handling

Parse errors should be explicit and stable:

- empty output -> `empty_output`;
- `JSON.parse` failure -> `invalid_json`;
- non-object JSON or Zod failure -> `schema_invalid`.

The user-facing error can remain the existing broad message for this slice:

```text
Planner run failed.
```

The timeline should carry enough sanitized detail for a developer to understand whether the model failed to return JSON or returned schema-invalid JSON.

## Testing

Add focused tests before implementation:

- Parser accepts a complete `LPBriefSchema` JSON object.
- Parser rejects empty output.
- Parser rejects Markdown-fenced JSON in V0.
- Parser rejects invalid JSON.
- Parser rejects schema-invalid JSON and reports sanitized issue metadata.
- Real-runtime API fake-fetch test persists parsed brief instead of `sampleBrief`.
- Parse failure API fake-fetch test marks Planner run failed and does not save a brief.
- Persisted events never contain raw model output.
- Default deterministic runtime still uses `sampleBrief` and existing flows continue to pass.

Verification should include:

```bash
pnpm --filter @lp-agent/api test
pnpm --filter @lp-agent/runtime-adapters test
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

## Future Work

After this slice:

- Add a repair loop that asks the model to fix invalid JSON using sanitized schema issues.
- Add structured Builder page draft output.
- Add structured Reviewer findings.
- Add token/context budgeting for schema prompts.
- Add model output summaries if raw outputs become useful for debugging under an explicit debug mode.
