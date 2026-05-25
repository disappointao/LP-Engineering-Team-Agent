# Real Provider Local Run Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让本地 operator 通过 `.env.local` 和项目 `Models` route 更低摩擦地试跑真实 provider 普通聊天和 LP 生成，同时保持默认 no-key gates deterministic。

**Architecture:** 新增一个无网络、无 secret 输出的 Node preflight script 负责 `.env.local` 检查；Web `Models` view-model 从已有 project model state 派生本地运行 checklist；文档记录 optional real-provider smoke 状态和 Stage57 收口。Runtime/provider adapter contract 不变。

**Tech Stack:** Node.js ESM script, Vitest, Next.js Server Components, TypeScript view-model, existing Web i18n, Markdown docs.

---

## 文件结构

- Create: `.env.real-provider.example` - 本地真实 provider 模板，不含真实 key。
- Create: `scripts/real-provider-doctor.mjs` - 读取 env 文件并输出安全 preflight。
- Create: `scripts/real-provider-doctor.test.ts` - Vitest 覆盖 doctor 行为。
- Modify: `package.json` - 添加 `real-provider:doctor` script。
- Modify: `apps/web/src/app/skills-models-management-view-model.ts` - 派生 `localRunChecklist`。
- Modify: `apps/web/src/app/skills-models-management-view-model.test.ts` - 覆盖 checklist。
- Modify: `apps/web/src/app/page.tsx` - 渲染 Models checklist。
- Modify: `apps/web/src/app/page.test.ts` - 覆盖 checklist 可见文案。
- Modify: `apps/web/src/lib/i18n.ts` and `apps/web/src/lib/i18n.test.ts` - 新增中英文文案。
- Modify docs: `README.md`, `docs/real-provider-alpha-smoke.md`, `docs/web-v1-acceptance.md`, `docs/alpha-release-candidate.md`, `docs/project-roadmap.md`, `docs/agent-development-learning.md`, `docs/superpowers/README.md`.

## Task 1: Env Doctor

**Files:**
- Create: `.env.real-provider.example`
- Create: `scripts/real-provider-doctor.mjs`
- Create: `scripts/real-provider-doctor.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests**

Add `scripts/real-provider-doctor.test.ts` with cases for missing env, ready OpenAI-compatible env, ready Anthropic-compatible env, strict failure and secret redaction. Run:

```bash
pnpm exec vitest run scripts/real-provider-doctor.test.ts
```

Expected before implementation: fail because `scripts/real-provider-doctor.mjs` does not exist.

- [ ] **Step 2: Implement doctor**

Implement exported helpers `parseEnvText`, `inspectRealProviderEnv`, `formatDoctorReport`, and CLI `main`. The CLI must not print secret values and must not perform network requests.

- [ ] **Step 3: Add scripts and template**

Add package script:

```json
"real-provider:doctor": "node scripts/real-provider-doctor.mjs"
```

Create `.env.real-provider.example` with `REAL_MODEL_RUNTIME=1`, `REAL_MODEL_PROVIDER_TEST=0`, and empty key placeholders.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm exec vitest run scripts/real-provider-doctor.test.ts
pnpm real-provider:doctor
```

Expected: tests pass; doctor exits 0 in checklist mode and prints no key value.

## Task 2: Models Checklist

**Files:**
- Modify: `apps/web/src/app/skills-models-management-view-model.ts`
- Modify: `apps/web/src/app/skills-models-management-view-model.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/lib/i18n.test.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.ts`

- [ ] **Step 1: Write failing view-model and i18n tests**

Add tests expecting `localRunChecklist.readyForChat`, `readyForLp`, and localized checklist labels. Run:

```bash
pnpm exec vitest run apps/web/src/app/skills-models-management-view-model.test.ts apps/web/src/lib/i18n.test.ts
```

Expected before implementation: fail because checklist fields and copy are missing.

- [ ] **Step 2: Implement view-model checklist**

Add `ModelsLocalRunChecklist` to the view-model and compute readiness from enabled real providers plus configured `assistant`, `planner`, and `builder` routes.

- [ ] **Step 3: Render checklist**

Render a `managementSummary` section in Models view with env, provider, assistant, planner, builder and deterministic reviewer/deployer notes. Do not read server env from the page.

- [ ] **Step 4: Verify page tests**

Run:

```bash
pnpm exec vitest run apps/web/src/app/skills-models-management-view-model.test.ts apps/web/src/lib/i18n.test.ts apps/web/src/app/page.test.ts
```

Expected: focused Web tests pass.

## Task 3: Docs Closeout

**Files:**
- Modify: `README.md`
- Modify: `docs/real-provider-alpha-smoke.md`
- Modify: `docs/web-v1-acceptance.md`
- Modify: `docs/alpha-release-candidate.md`
- Modify: `docs/project-roadmap.md`
- Modify: `docs/agent-development-learning.md`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Update operator docs**

Document `cp .env.real-provider.example .env.local`, `pnpm real-provider:doctor`, optional `--strict`, and Web Models route setup.

- [ ] **Step 2: Update acceptance and RC state language**

Record that optional real provider smoke may be `not_run`, `skipped_no_keys`, `passed`, or `failed`; only declared real-provider RC goals require `passed`.

- [ ] **Step 3: Update roadmap and learning docs**

Add Stage57 as complete, preserve the next-stage queue, and add the Agent learning note that local provider preflight is not a readiness gate.

- [ ] **Step 4: Verify docs**

Run:

```bash
rg -n "Stage 57|real-provider:doctor|skipped_no_keys|\\.env\\.real-provider\\.example" README.md docs
git diff --check
```

Expected: all new references are discoverable and whitespace check passes.

## Task 4: Final Verification

**Files:** whole repo.

- [ ] **Step 1: Run focused tests**

```bash
pnpm exec vitest run scripts/real-provider-doctor.test.ts apps/web/src/app/skills-models-management-view-model.test.ts apps/web/src/lib/i18n.test.ts apps/web/src/app/page.test.ts
```

- [ ] **Step 2: Run stage gates**

```bash
pnpm alpha:check
pnpm smoke
pnpm typecheck
git diff --check
```

- [ ] **Step 3: Record result**

Update completion notes in `docs/project-roadmap.md` with exact verification status and any command that could not run.
