# Structured LP Brief Model Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the real-runtime Planner `sampleBrief` placeholder with schema-validated `LPBriefSchema` parsing while preserving deterministic default behavior.

**Architecture:** Keep provider calls inside `packages/model-gateway` and keep LP business validation inside `packages/api`. `LocalAgentRuntimeAdapter` returns transient `modelOutputText` in memory, `runAgentStep` gets a finalizer hook so API post-processing can update terminal run state before events are persisted, and `DemoWorkbenchService.createBriefFromPrompt()` parses Planner output only when `REAL_MODEL_RUNTIME=1`.

**Tech Stack:** pnpm TypeScript monorepo, Vitest, Zod `LPBriefSchema`, existing `@lp-agent/runtime-adapters`, `@lp-agent/model-gateway`, and repository-backed workbench APIs.

---

## File Structure

- Create `packages/api/src/structured-lp-brief.ts`
  - Owns structured Planner prompt construction, strict JSON parsing, `LPBriefSchema` validation, parse error classification, and sanitized parse event payloads.
- Create `packages/api/src/structured-lp-brief.test.ts`
  - Parser and prompt unit tests. These do not touch network, repositories, or Web state.
- Modify `packages/api/package.json`
  - Includes `structured-lp-brief.test.ts` first, then later includes `run-orchestrator.test.ts` once that file exists.
- Modify `packages/runtime-adapters/src/index.ts`
  - Adds transient `modelOutputText?: string` to `RuntimeRunResult`.
  - Adds `model.output.parsed` and `model.output.parse_failed` runtime event variants.
  - Sets `modelOutputText` from `ModelResponse.text` without putting it into runtime events.
- Modify `packages/runtime-adapters/src/index.test.ts`
  - Verifies `modelOutputText` is available in the returned result and not persisted inside runtime events.
- Create `packages/api/src/run-orchestrator.test.ts`
  - Verifies the new API-owned finalizer can change a completed runtime result into a failed persisted run before terminal events are saved.
- Modify `packages/api/src/run-orchestrator.ts`
  - Adds a `finalizeResult` hook that runs after `runtime.run()` and before run state/events are persisted.
- Modify `packages/api/src/index.ts`
  - Tracks whether real runtime is enabled.
  - Wraps Planner prompt with the structured JSON contract only in real runtime mode.
  - Parses transient `modelOutputText` into `LPBrief`.
  - Persists parsed `BriefRecord.brief` on success.
  - Fails closed and persists sanitized parse failure events on invalid output.
- Modify `packages/api/src/services.test.ts`
  - Updates existing real-runtime fake-fetch tests to return valid JSON brief output and assert structured prompt contents.
  - Adds parse failure coverage.
- Modify `docs/superpowers/README.md`
  - Adds this implementation plan to the reading order.
- Modify `docs/agent-development-learning.md`
  - Adds the current implementation plan link under the structured LP Brief output design note.

---

## Task 1: Add Structured Brief Parser and Prompt Red Tests

**Files:**
- Create: `packages/api/src/structured-lp-brief.test.ts`
- Modify: `packages/api/package.json`

- [ ] **Step 1: Add the parser and prompt tests**

Create `packages/api/src/structured-lp-brief.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sampleBrief } from "@lp-agent/lp-schema";
import {
  PlannerLPBriefParseError,
  createStructuredLPBriefPlannerPrompt,
  parsePlannerLPBriefOutput,
  toLPBriefParseFailurePayload,
  toLPBriefParseSuccessPayload
} from "./structured-lp-brief";

describe("structured LP brief model output", () => {
  it("builds a strict JSON Planner prompt that preserves the user prompt", () => {
    const prompt = createStructuredLPBriefPlannerPrompt(
      "生成一个面向春季促销的电商 LP，突出限时优惠。"
    );

    expect(prompt).toContain("Return exactly one JSON object");
    expect(prompt).toContain("Do not wrap the JSON in Markdown fences");
    expect(prompt).toContain("LPBriefSchema");
    expect(prompt).toContain("Framework-free static HTML/CSS/JS");
    expect(prompt).toContain("生成一个面向春季促销的电商 LP，突出限时优惠。");
  });

  it("parses a complete LPBriefSchema JSON object", () => {
    const parsed = parsePlannerLPBriefOutput(JSON.stringify({
      ...sampleBrief,
      title: "Model Planned Landing Page",
      sections: sampleBrief.sections.map((section, index) => ({
        ...section,
        id: `model_section_${index + 1}`
      }))
    }));

    expect(parsed.title).toBe("Model Planned Landing Page");
    expect(parsed.sections).toHaveLength(sampleBrief.sections.length);
    expect(parsed.sections[0]?.id).toBe("model_section_1");
  });

  it("rejects empty output with a stable reason", () => {
    expect(() => parsePlannerLPBriefOutput("   ")).toThrow(PlannerLPBriefParseError);

    const error = captureParseError("   ");
    expect(error.reason).toBe("empty_output");
    expect(toLPBriefParseFailurePayload(error)).toEqual({
      role: "planner",
      schema: "LPBriefSchema",
      reason: "empty_output"
    });
  });

  it("rejects Markdown-fenced JSON in V0", () => {
    const error = captureParseError(`\`\`\`json\n${JSON.stringify(sampleBrief)}\n\`\`\``);

    expect(error.reason).toBe("invalid_json");
    expect(toLPBriefParseFailurePayload(error)).toEqual({
      role: "planner",
      schema: "LPBriefSchema",
      reason: "invalid_json"
    });
  });

  it("rejects invalid JSON without exposing raw output", () => {
    const error = captureParseError("{ not json } RAW_MODEL_OUTPUT_SECRET");
    const payload = toLPBriefParseFailurePayload(error);

    expect(error.reason).toBe("invalid_json");
    expect(JSON.stringify(payload)).not.toContain("RAW_MODEL_OUTPUT_SECRET");
  });

  it("rejects schema-invalid JSON and reports sanitized issue metadata", () => {
    const error = captureParseError(JSON.stringify({
      ...sampleBrief,
      sections: []
    }));

    expect(error.reason).toBe("schema_invalid");
    expect(toLPBriefParseFailurePayload(error)).toMatchObject({
      role: "planner",
      schema: "LPBriefSchema",
      reason: "schema_invalid",
      issueCount: 1,
      firstIssuePath: "sections",
      firstIssueCode: "too_small"
    });
  });

  it("creates a sanitized parse success payload", () => {
    expect(toLPBriefParseSuccessPayload(sampleBrief)).toEqual({
      role: "planner",
      schema: "LPBriefSchema",
      title: sampleBrief.title,
      sectionCount: sampleBrief.sections.length,
      productCount: sampleBrief.productData.length,
      hasAssets: false
    });
  });
});

function captureParseError(output: string): PlannerLPBriefParseError {
  try {
    parsePlannerLPBriefOutput(output);
  } catch (error) {
    if (error instanceof PlannerLPBriefParseError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected parse to fail");
}
```

- [ ] **Step 2: Include the new test in the API package script**

Modify `packages/api/package.json`:

```json
{
  "scripts": {
    "test": "vitest run src/structured-lp-brief.test.ts src/services.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

Keep the rest of the file unchanged.

- [ ] **Step 3: Run the parser test to verify it fails**

Run:

```bash
pnpm --filter @lp-agent/api exec vitest run src/structured-lp-brief.test.ts
```

Expected: FAIL because `./structured-lp-brief` does not exist yet.

- [ ] **Step 4: Commit the red tests**

```bash
git add packages/api/package.json packages/api/src/structured-lp-brief.test.ts
git commit -m "test structured lp brief parser"
```

---

## Task 2: Implement Structured Brief Parser and Prompt Helpers

**Files:**
- Create: `packages/api/src/structured-lp-brief.ts`
- Test: `packages/api/src/structured-lp-brief.test.ts`

- [ ] **Step 1: Add the parser and prompt helper implementation**

Create `packages/api/src/structured-lp-brief.ts`:

```ts
import { LPBriefSchema, type LPBrief } from "@lp-agent/lp-schema";

export type LPBriefParseFailureReason =
  | "empty_output"
  | "invalid_json"
  | "schema_invalid";

export interface LPBriefParseIssueSummary {
  issueCount?: number;
  firstIssuePath?: string;
  firstIssueCode?: string;
}

export class PlannerLPBriefParseError extends Error {
  readonly reason: LPBriefParseFailureReason;
  readonly issueSummary: LPBriefParseIssueSummary;

  constructor(
    reason: LPBriefParseFailureReason,
    issueSummary: LPBriefParseIssueSummary = {}
  ) {
    super(`Planner output could not be parsed as LP brief: ${reason}`);
    this.name = "PlannerLPBriefParseError";
    this.reason = reason;
    this.issueSummary = issueSummary;
  }
}

export function createStructuredLPBriefPlannerPrompt(userPrompt: string): string {
  const normalizedPrompt = userPrompt.trim();
  return [
    "You are the Planner for an LP Engineering Team Agent.",
    "Return exactly one JSON object that matches LPBriefSchema.",
    "Do not wrap the JSON in Markdown fences.",
    "Do not include prose before or after the JSON.",
    "The downstream Builder will generate Framework-free static HTML/CSS/JS from this brief.",
    "",
    "LPBriefSchema compact guide:",
    "- title: non-empty string",
    "- objective: non-empty string",
    "- audience: non-empty string",
    "- offer: non-empty string",
    "- brandProfile: { name, tone, colors: string[], typography }",
    "- tone: non-empty string",
    "- constraints: string[]",
    "- sections: non-empty array of { id, type, purpose, headline, body, media, cta, layoutHints, validationRules }",
    "- section.type is one of hero, benefits, product-grid, social-proof, faq, cta, custom",
    "- cta: { label, href, intent }",
    "- assets: array of { id, type, label, url, alt? }",
    "- productData: array of { id, name, description, price?, imageUrl? }",
    "- seo: { title, description, socialImage? }",
    "- tracking: { analyticsId?, events: string[] }",
    "- complianceNotes: string[]",
    "",
    "User request:",
    normalizedPrompt
  ].join("\n");
}

export function parsePlannerLPBriefOutput(output: string): LPBrief {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    throw new PlannerLPBriefParseError("empty_output");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(trimmed);
  } catch {
    throw new PlannerLPBriefParseError("invalid_json");
  }

  if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
    throw new PlannerLPBriefParseError("schema_invalid", {
      issueCount: 1,
      firstIssuePath: "",
      firstIssueCode: "invalid_type"
    });
  }

  const parsed = LPBriefSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    throw new PlannerLPBriefParseError("schema_invalid", {
      issueCount: parsed.error.issues.length,
      firstIssuePath: firstIssue?.path.join(".") ?? "",
      firstIssueCode: firstIssue?.code
    });
  }

  return parsed.data;
}

export function toLPBriefParseSuccessPayload(brief: LPBrief): Record<string, unknown> {
  return {
    role: "planner",
    schema: "LPBriefSchema",
    title: brief.title,
    sectionCount: brief.sections.length,
    productCount: brief.productData.length,
    hasAssets: brief.assets.length > 0
  };
}

export function toLPBriefParseFailurePayload(
  error: PlannerLPBriefParseError
): Record<string, unknown> {
  return {
    role: "planner",
    schema: "LPBriefSchema",
    reason: error.reason,
    ...(error.issueSummary.issueCount !== undefined
      ? { issueCount: error.issueSummary.issueCount }
      : {}),
    ...(error.issueSummary.firstIssuePath !== undefined
      ? { firstIssuePath: error.issueSummary.firstIssuePath }
      : {}),
    ...(error.issueSummary.firstIssueCode !== undefined
      ? { firstIssueCode: error.issueSummary.firstIssueCode }
      : {})
  };
}
```

- [ ] **Step 2: Run the parser test to verify it passes**

Run:

```bash
pnpm --filter @lp-agent/api exec vitest run src/structured-lp-brief.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run API typecheck**

Run:

```bash
pnpm --filter @lp-agent/api typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit the parser implementation**

```bash
git add packages/api/src/structured-lp-brief.ts
git commit -m "add structured lp brief parser"
```

---

## Task 3: Add Transient Runtime Model Output Text

**Files:**
- Modify: `packages/runtime-adapters/src/index.ts`
- Modify: `packages/runtime-adapters/src/index.test.ts`

- [ ] **Step 1: Add the runtime adapter red test**

Add this test in `packages/runtime-adapters/src/index.test.ts` after the contract export test:

```ts
  it("returns transient model output text without adding it to runtime events", async () => {
    const gateway: ModelGateway = {
      async complete(_request: ModelRequest): Promise<ModelResponse> {
        return {
          provider: "test-provider",
          model: "test-model",
          text: "RAW_MODEL_OUTPUT_SECRET",
          usage: { inputTokens: 1, outputTokens: 2 }
        };
      }
    };
    const adapter = new LocalAgentRuntimeAdapter(gateway);

    const result = await adapter.run({
      runId: "run_planner_1",
      projectId: "project_1",
      role: "planner",
      input: { prompt: "Plan" }
    });

    expect(result.state).toBe("completed");
    expect(result.modelOutputText).toBe("RAW_MODEL_OUTPUT_SECRET");
    expect(JSON.stringify(result.events)).not.toContain("RAW_MODEL_OUTPUT_SECRET");
  });
```

- [ ] **Step 2: Run the runtime-adapters test to verify it fails**

Run:

```bash
pnpm --filter @lp-agent/runtime-adapters exec vitest run src/index.test.ts
```

Expected: FAIL because `RuntimeRunResult` does not expose `modelOutputText`.

- [ ] **Step 3: Extend runtime result and event types**

Modify `packages/runtime-adapters/src/index.ts`.

Add these event variants to `RuntimeEvent`:

```ts
  | {
      type: "model.output.parsed";
      message: string;
      runId?: string;
      role?: AgentRole;
      schema: "LPBriefSchema";
      title: string;
      sectionCount: number;
      productCount: number;
      hasAssets: boolean;
    }
  | {
      type: "model.output.parse_failed";
      message: string;
      runId?: string;
      role?: AgentRole;
      schema: "LPBriefSchema";
      reason: "empty_output" | "invalid_json" | "schema_invalid";
      issueCount?: number;
      firstIssuePath?: string;
      firstIssueCode?: string;
    }
```

Add this field to `RuntimeRunResult`:

```ts
  modelOutputText?: string;
```

- [ ] **Step 4: Return transient model text from `LocalAgentRuntimeAdapter`**

In `packages/runtime-adapters/src/index.ts`, include `modelOutputText` in the success return object:

```ts
      return {
        runId: request.runId,
        projectId: request.projectId,
        role: request.role,
        state,
        events,
        modelOutputText: modelResponse.text,
        artifacts,
        findings
      };
```

Do not add `modelOutputText` to any runtime event.

- [ ] **Step 5: Run runtime adapter verification**

Run:

```bash
pnpm --filter @lp-agent/runtime-adapters test
pnpm --filter @lp-agent/runtime-adapters typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit runtime transient output**

```bash
git add packages/runtime-adapters/src/index.ts packages/runtime-adapters/src/index.test.ts
git commit -m "return transient model output text"
```

---

## Task 4: Add API Run Finalizer Hook Before Terminal Event Persistence

**Files:**
- Create: `packages/api/src/run-orchestrator.test.ts`
- Modify: `packages/api/package.json`
- Modify: `packages/api/src/run-orchestrator.ts`

- [ ] **Step 1: Add a red test for API post-processing before terminal persistence**

Create `packages/api/src/run-orchestrator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInMemoryWorkbenchRepositories } from "@lp-agent/db";
import { createDefaultRuntimeContext, type AgentRuntimeAdapter } from "@lp-agent/runtime-adapters";
import { runAgentStep } from "./run-orchestrator";

describe("run agent step finalization", () => {
  it("lets API post-processing change terminal run state before events persist", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    await repositories.projects.save({
      id: "project_1",
      name: "Project",
      createdAt: "2026-05-14T00:00:00.000Z"
    });
    const runtime: AgentRuntimeAdapter = {
      async run(request) {
        return {
          runId: request.runId,
          projectId: request.projectId,
          role: request.role,
          state: "completed",
          modelOutputText: "RAW_MODEL_OUTPUT_SECRET",
          events: [
            {
              type: "run.started",
              message: "planner run started",
              runId: request.runId,
              role: request.role
            },
            {
              type: "run.completed",
              message: "planner run completed",
              runId: request.runId,
              state: "completed"
            }
          ]
        };
      }
    };
    const service = {
      async createRuntimeContextForRole() {
        return createDefaultRuntimeContext();
      }
    };

    const result = await runAgentStep({
      repositories,
      service,
      runtime,
      runId: "run_planner_brief_1",
      projectId: "project_1",
      role: "planner",
      input: { prompt: "Plan" },
      now: () => new Date("2026-05-14T00:00:00.000Z"),
      finalizeResult({ result: runtimeResult }) {
        return {
          ...runtimeResult,
          state: "failed",
          events: [
            ...runtimeResult.events.filter((event) => event.type !== "run.completed"),
            {
              type: "model.output.parse_failed",
              message: "Planner output could not be parsed as LP brief",
              runId: runtimeResult.runId,
              role: "planner",
              schema: "LPBriefSchema",
              reason: "invalid_json"
            },
            {
              type: "run.failed",
              message: "Planner run failed.",
              runId: runtimeResult.runId,
              role: "planner",
              state: "failed",
              errorName: "PlannerLPBriefParseError"
            }
          ]
        };
      }
    });

    expect(result.run.state).toBe("failed");
    const events = await repositories.runEvents.listForProject("project_1");
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "model.output.parse_failed",
      "run.failed"
    ]);
    expect(JSON.stringify(events)).not.toContain("RAW_MODEL_OUTPUT_SECRET");
  });
});
```

- [ ] **Step 2: Ensure the API test script now includes `run-orchestrator.test.ts`**

If Task 1 already changed `packages/api/package.json`, keep this script:

```json
{
  "scripts": {
    "test": "vitest run src/structured-lp-brief.test.ts src/run-orchestrator.test.ts src/services.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

- [ ] **Step 3: Run the new run-orchestrator test to verify it fails**

Run:

```bash
pnpm --filter @lp-agent/api exec vitest run src/run-orchestrator.test.ts
```

Expected: FAIL because `runAgentStep` does not accept `finalizeResult`.

- [ ] **Step 4: Add the finalizer type and hook**

Modify `packages/api/src/run-orchestrator.ts`.

Add these interfaces near `RunAgentStepResult`:

```ts
export interface RunAgentStepFinalizeInput {
  result: RuntimeRunResult;
  contextPack: ContextPack;
}

export type RunAgentStepFinalizer = (
  input: RunAgentStepFinalizeInput
) => RuntimeRunResult | Promise<RuntimeRunResult>;
```

Add this optional property to `RunAgentStepInput`:

```ts
  finalizeResult?: RunAgentStepFinalizer;
```

After `runtime.run()` succeeds and before `completedAt` is calculated, replace:

```ts
  const completedAt = nextRepositoryTimestamp(input.repositories, now);
```

with:

```ts
  if (input.finalizeResult) {
    result = await input.finalizeResult({ result, contextPack });
  }

  const completedAt = nextRepositoryTimestamp(input.repositories, now);
```

- [ ] **Step 5: Run API orchestrator verification**

Run:

```bash
pnpm --filter @lp-agent/api exec vitest run src/run-orchestrator.test.ts
pnpm --filter @lp-agent/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit finalizer plumbing**

```bash
git add packages/api/package.json packages/api/src/run-orchestrator.ts packages/api/src/run-orchestrator.test.ts
git commit -m "add run finalizer hook"
```

---

## Task 5: Wire Structured Planner Brief Parsing Into API Service

**Files:**
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/services.test.ts`

- [ ] **Step 1: Add real-runtime parse success and parse failure tests**

In `packages/api/src/services.test.ts`, add imports:

```ts
import { sampleBrief } from "@lp-agent/lp-schema";
```

If `sampleBrief` is already imported in the file, reuse the existing import.

Update the existing `uses OpenAI-compatible provider-backed runtime when REAL_MODEL_RUNTIME is enabled` fake response content so it returns valid JSON brief text:

```ts
const modelBrief = {
  ...sampleBrief,
  title: "Model Planned Landing Page",
  objective: "Convert real model output into a validated LP brief.",
  sections: sampleBrief.sections.map((section, index) => ({
    ...section,
    id: `model_section_${index + 1}`
  }))
};
```

Use `JSON.stringify(modelBrief)` as the OpenAI-compatible response content:

```ts
message: { role: "assistant", content: JSON.stringify(modelBrief) }
```

Update the request body assertion from exact prompt equality to structured prompt assertions:

```ts
const requestBody = JSON.parse(String(fetchCalls[0]?.init?.body));
expect(requestBody.model).toBe("glm-5.1");
expect(requestBody.stream).toBe(false);
expect(requestBody.messages).toHaveLength(1);
expect(requestBody.messages[0]).toMatchObject({ role: "user" });
expect(requestBody.messages[0]?.content).toContain("Return exactly one JSON object");
expect(requestBody.messages[0]?.content).toContain("LPBriefSchema");
expect(requestBody.messages[0]?.content).toContain("Generate a landing page brief.");
```

Add these assertions after `brief.id`:

```ts
expect(brief.brief.title).toBe("Model Planned Landing Page");
expect(brief.brief.sections[0]?.id).toBe("model_section_1");
```

Add parse event assertions:

```ts
const parsedEvent = events.find((event) => event.type === "model.output.parsed");
expect(parsedEvent).toMatchObject({
  runId: "run_planner_brief_1",
  type: "model.output.parsed",
  message: "Planner output parsed as LP brief",
  payload: expect.objectContaining({
    role: "planner",
    schema: "LPBriefSchema",
    title: "Model Planned Landing Page",
    sectionCount: modelBrief.sections.length,
    productCount: modelBrief.productData.length,
    hasAssets: false
  })
});
expect(events.map((event) => event.type)).toContain("run.completed");
expect(JSON.stringify(events)).not.toContain(JSON.stringify(modelBrief));
```

Add a new test after the OpenAI-compatible success test:

```ts
  it("fails closed when real Planner output is not a valid LP brief", async () => {
    const repositories = createInMemoryWorkbenchRepositories();
    const fakeFetch: ModelFetch = async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl_test",
          model: "glm-5.1",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "```json\n{\"title\":\"RAW_MODEL_OUTPUT_SECRET\"}\n```"
              },
              finish_reason: "stop"
            }
          ],
          usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    const service = new DemoWorkbenchService({
      repositories,
      now: fixedClock(),
      env: {
        REAL_MODEL_RUNTIME: "1",
        OPENAI_COMPATIBLE_API_KEY: "sk-test-secret"
      },
      modelFetch: fakeFetch
    });
    const project = await service.createProject({ name: "Project" });
    const provider = await service.createModelProvider({
      projectId: project.id,
      providerId: "zhipu_openai",
      name: "智谱 OpenAI Compatible",
      provider: "custom",
      api: "openai-completions",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
      modelId: "glm-5.1"
    });
    await service.upsertProjectModelRoute({
      projectId: project.id,
      role: "planner",
      providerId: provider.id,
      model: "glm-5.1"
    });

    await expect(
      service.createBriefFromPrompt({
        projectId: project.id,
        prompt: "Generate a landing page brief."
      })
    ).rejects.toThrow("Planner run failed.");

    expect(await repositories.briefs.listForProject(project.id)).toEqual([]);
    const runs = await repositories.runs.listForProject(project.id);
    expect(runs).toEqual([
      expect.objectContaining({
        id: "run_planner_brief_1",
        state: "failed"
      })
    ]);
    const events = await repositories.runEvents.listForProject(project.id);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "runtime.context.loaded",
      "model.completed",
      "model.output.parse_failed",
      "run.failed"
    ]);
    const parseFailedEvent = events.find(
      (event) => event.type === "model.output.parse_failed"
    );
    expect(parseFailedEvent).toMatchObject({
      runId: "run_planner_brief_1",
      type: "model.output.parse_failed",
      message: "Planner output could not be parsed as LP brief",
      payload: expect.objectContaining({
        role: "planner",
        schema: "LPBriefSchema",
        reason: "invalid_json"
      })
    });
    expect(JSON.stringify(events)).not.toContain("RAW_MODEL_OUTPUT_SECRET");
    expect(JSON.stringify(events)).not.toContain("```json");
    expect(JSON.stringify(events)).not.toContain("OPENAI_COMPATIBLE_API_KEY");
    expect(JSON.stringify(events)).not.toContain("https://open.bigmodel.cn");
  });
```

- [ ] **Step 2: Run the API service tests to verify they fail**

Run:

```bash
pnpm --filter @lp-agent/api exec vitest run src/services.test.ts
```

Expected: FAIL because `createBriefFromPrompt()` still saves `sampleBrief` and does not parse `modelOutputText`.

- [ ] **Step 3: Import structured brief helpers in the API service**

Modify `packages/api/src/index.ts` imports:

```ts
import {
  PlannerLPBriefParseError,
  createStructuredLPBriefPlannerPrompt,
  parsePlannerLPBriefOutput,
  toLPBriefParseFailurePayload,
  toLPBriefParseSuccessPayload
} from "./structured-lp-brief";
```

- [ ] **Step 4: Track real-runtime structured Planner mode**

In `DemoWorkbenchService`, add a private field:

```ts
  private readonly structuredPlannerOutputEnabled: boolean;
```

In the constructor, after `runtimeFactoryInput` is created, add:

```ts
    const env = options.env ?? getProcessEnv();
    this.structuredPlannerOutputEnabled = env.REAL_MODEL_RUNTIME === "1";
```

Then update `runtimeFactoryInput` to use the same `env`:

```ts
    const runtimeFactoryInput = {
      repositories: this.repositories,
      env,
      fetch: options.modelFetch
    };
```

- [ ] **Step 5: Add API-local runtime event helpers**

Add these functions near `createLocalRuntimeAdapter()` in `packages/api/src/index.ts`:

```ts
function addEventBeforeRunCompleted(
  events: import("@lp-agent/runtime-adapters").RuntimeEvent[],
  event: import("@lp-agent/runtime-adapters").RuntimeEvent
): import("@lp-agent/runtime-adapters").RuntimeEvent[] {
  const completedIndex = events.findIndex((candidate) => candidate.type === "run.completed");
  if (completedIndex === -1) {
    return [...events, event];
  }
  return [
    ...events.slice(0, completedIndex),
    event,
    ...events.slice(completedIndex)
  ];
}

function failPlannerResultForParseError(input: {
  result: import("@lp-agent/runtime-adapters").RuntimeRunResult;
  error: PlannerLPBriefParseError;
}): import("@lp-agent/runtime-adapters").RuntimeRunResult {
  return {
    ...input.result,
    state: "failed",
    events: [
      ...input.result.events.filter((event) => event.type !== "run.completed"),
      {
        type: "model.output.parse_failed",
        message: "Planner output could not be parsed as LP brief",
        runId: input.result.runId,
        role: "planner",
        schema: "LPBriefSchema",
        ...toLPBriefParseFailurePayload(input.error)
      },
      {
        type: "run.failed",
        message: "Planner run failed.",
        runId: input.result.runId,
        role: "planner",
        state: "failed",
        errorName: input.error.name
      }
    ]
  };
}
```

If the implementation imports `RuntimeEvent` and `RuntimeRunResult` at the top of the file, use those type names instead of inline `import(...)` type references.

- [ ] **Step 6: Parse Planner output inside `createBriefFromPrompt()` finalizer**

In `createBriefFromPrompt()`, before `runAgentStep()`, add:

```ts
    let parsedPlannerBrief: LPBrief | undefined;
    const plannerPrompt = this.structuredPlannerOutputEnabled
      ? createStructuredLPBriefPlannerPrompt(input.prompt)
      : input.prompt;
```

Change the `runAgentStep()` input prompt:

```ts
        input: {
          prompt: plannerPrompt
        },
```

Add `finalizeResult` to the `runAgentStep()` call:

```ts
        finalizeResult: this.structuredPlannerOutputEnabled
          ? ({ result }) => {
              if (result.state !== "completed") {
                return result;
              }
              try {
                parsedPlannerBrief = parsePlannerLPBriefOutput(result.modelOutputText ?? "");
                return {
                  ...result,
                  events: addEventBeforeRunCompleted(result.events, {
                    type: "model.output.parsed",
                    message: "Planner output parsed as LP brief",
                    runId: result.runId,
                    role: "planner",
                    schema: "LPBriefSchema",
                    ...toLPBriefParseSuccessPayload(parsedPlannerBrief)
                  })
                };
              } catch (error) {
                if (error instanceof PlannerLPBriefParseError) {
                  return failPlannerResultForParseError({ result, error });
                }
                throw error;
              }
            }
          : undefined,
```

Update the saved `BriefRecord`:

```ts
          brief: copyBrief(parsedPlannerBrief ?? sampleBrief),
```

- [ ] **Step 7: Run API service verification**

Run:

```bash
pnpm --filter @lp-agent/api test
pnpm --filter @lp-agent/api typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit API structured Planner wiring**

```bash
git add packages/api/src/index.ts packages/api/src/services.test.ts
git commit -m "parse real planner output into lp brief"
```

---

## Task 6: Update Learning Docs and Run Final Verification

**Files:**
- Modify: `docs/superpowers/README.md`
- Modify: `docs/agent-development-learning.md`

- [ ] **Step 1: Ensure this implementation plan exists in the Superpowers index**

Ensure this item exists after the structured LP brief output design entry in `docs/superpowers/README.md`. Add it only if missing:

```md
31. `plans/2026-05-14-structured-lp-brief-model-output.md`
   - Stage 3 structured Planner LP brief output implementation plan.
   - Read this after the structured LP brief output design when implementing strict JSON Planner prompts, `LPBriefSchema` parsing, transient runtime model text, sanitized parse events, and fail-closed real-runtime behavior.
```

- [ ] **Step 2: Ensure the plan link exists in the learning document**

In `docs/agent-development-learning.md`, under `下一步结构化 LP Brief 输出设计：`, ensure this line exists. Add it only if missing:

```md
- 当前实现计划：[2026-05-14-structured-lp-brief-model-output.md](./superpowers/plans/2026-05-14-structured-lp-brief-model-output.md)
```

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm --filter @lp-agent/runtime-adapters test
pnpm --filter @lp-agent/api test
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all commands pass. The two real provider integration tests stay skipped unless `REAL_MODEL_PROVIDER_TEST=1` is present in the shell environment.

- [ ] **Step 4: Commit docs and plan index update if files changed**

```bash
git add docs/superpowers/README.md docs/agent-development-learning.md
git commit -m "document structured lp brief output plan"
```

If both files were already current and `git diff --cached --quiet` reports no staged docs changes, do not create an empty commit.

---

## Acceptance Checklist

- [ ] `parsePlannerLPBriefOutput()` accepts valid `LPBriefSchema` JSON and rejects empty, invalid, fenced, and schema-invalid output.
- [ ] `createStructuredLPBriefPlannerPrompt()` includes the original user prompt and strict JSON instructions.
- [ ] `RuntimeRunResult.modelOutputText` is returned in memory but never copied into runtime events.
- [ ] `runAgentStep()` supports API-owned finalization before terminal run state/events are persisted.
- [ ] Real-runtime Planner success saves the parsed model brief instead of `sampleBrief`.
- [ ] Real-runtime Planner parse failure saves no brief, marks the run failed, emits `model.output.parse_failed`, and does not persist `run.completed`.
- [ ] Default deterministic runtime still uses `sampleBrief`.
- [ ] Persisted events do not include raw model output, API keys, env var names, full base URLs, headers, or raw provider bodies.
- [ ] LP artifacts remain framework-free static HTML/CSS/JS.
- [ ] `docs/superpowers/README.md` and `docs/agent-development-learning.md` remain accurate for future agents.
