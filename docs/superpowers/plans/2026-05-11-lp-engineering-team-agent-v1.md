# LP Engineering Team Agent V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first web MVP for LP Engineering Team Agent: a project workbench that turns prompt/file/link inputs into a structured LP brief, generates framework-free static HTML/CSS/JS artifacts, reviews them, and hands approved output to Git/CI.

**Architecture:** Use a TypeScript monorepo with a Next.js web app, an agent-worker app, and focused packages for schema, artifacts, skills, MCP, model routing, runtime adapters, Git deployment, DB schema, and API orchestration. The first vertical slice uses deterministic local implementations and mocks where external systems would otherwise be required, while preserving the interfaces needed for real model providers, MCP connectors, Postgres, and Git providers.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Zod, Next.js app router, Prisma schema for Postgres, Node worker process, static HTML/CSS/JS artifact generation.

---

## Scope Check

The approved design spans several subsystems. This plan implements them as one vertical MVP because each subsystem is needed for the user-facing loop to be testable: schema → artifacts → agent runtime → API orchestration → web workbench → deployment handoff. Deep external integrations remain represented by adapters and mocks in this plan so every task produces working software without requiring company CI credentials, real model API keys, or live MCP servers.

## File Structure

Create this monorepo layout:

```text
apps/
  agent-worker/
    package.json
    src/index.ts
    src/worker.ts
    src/worker.test.ts
  web/
    next.config.mjs
    package.json
    src/app/globals.css
    src/app/layout.tsx
    src/app/page.tsx
    src/components/lp-preview.tsx
    src/lib/demo-workbench.ts
packages/
  api/
    package.json
    src/index.ts
    src/services.test.ts
  artifacts/
    package.json
    src/index.ts
    src/index.test.ts
  db/
    package.json
    prisma/schema.prisma
  git-deployment/
    package.json
    src/index.ts
    src/index.test.ts
  lp-schema/
    package.json
    src/index.ts
    src/index.test.ts
  mcp-gateway/
    package.json
    src/index.ts
    src/index.test.ts
  model-gateway/
    package.json
    src/index.ts
    src/index.test.ts
  runtime-adapters/
    package.json
    src/index.ts
    src/index.test.ts
  skills/
    package.json
    src/index.ts
    src/index.test.ts
package.json
pnpm-workspace.yaml
tsconfig.base.json
vitest.config.ts
```

Dependency direction:

```text
web -> api, lp-schema
agent-worker -> api
api -> lp-schema, artifacts, skills, mcp-gateway, model-gateway, runtime-adapters, git-deployment
runtime-adapters -> lp-schema, artifacts, model-gateway
artifacts -> lp-schema
skills -> no local package dependencies
mcp-gateway -> no local package dependencies
model-gateway -> no local package dependencies
git-deployment -> lp-schema, artifacts
db -> no runtime dependency in this MVP
```

## Tasks

### Task 1: Workspace Tooling

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Write the root workspace files**

Create `package.json`:

```json
{
  "name": "lp-engineering-team-agent",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.0.0",
  "scripts": {
    "build": "pnpm -r --if-present build",
    "dev": "pnpm --filter @lp-agent/web dev",
    "worker:dev": "pnpm --filter @lp-agent/agent-worker dev",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "pnpm -r --if-present typecheck"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true
  }
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    passWithNoTests: true,
    environment: "node"
  }
});
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
pnpm install
```

Expected: dependencies install and `pnpm-lock.yaml` is created.

- [ ] **Step 3: Verify the empty workspace test command**

Run:

```bash
pnpm test
```

Expected: Vitest exits successfully with no test files or no executed tests.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.config.ts pnpm-lock.yaml
git commit -m "chore: scaffold typescript workspace"
```

### Task 2: LP Schema Package

**Files:**
- Create: `packages/lp-schema/package.json`
- Create: `packages/lp-schema/src/index.test.ts`
- Create: `packages/lp-schema/src/index.ts`

- [ ] **Step 1: Write the failing schema tests**

Create `packages/lp-schema/package.json`:

```json
{
  "name": "@lp-agent/lp-schema",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run src/index.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

Create `packages/lp-schema/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

Create `packages/lp-schema/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ArtifactSchema,
  LPBriefSchema,
  PageVersionSchema,
  RunStateSchema,
  sampleBrief
} from "./index";

describe("LP brief schema", () => {
  it("accepts a valid structured LP brief", () => {
    const parsed = LPBriefSchema.parse(sampleBrief);

    expect(parsed.title).toBe("Spring Sale Landing Page");
    expect(parsed.sections).toHaveLength(4);
    expect(parsed.sections[0]?.type).toBe("hero");
  });

  it("rejects a brief without sections", () => {
    expect(() =>
      LPBriefSchema.parse({
        ...sampleBrief,
        sections: []
      })
    ).toThrow();
  });

  it("validates page versions with static artifacts", () => {
    const artifact = ArtifactSchema.parse({
      id: "artifact_static_lp",
      kind: "three-file-static",
      files: {
        indexHtml: "index.html",
        stylesCss: "styles.css",
        scriptJs: "script.js"
      }
    });

    const version = PageVersionSchema.parse({
      id: "version_1",
      brief: sampleBrief,
      artifact,
      reviewStatus: "pending",
      createdAt: "2026-05-11T00:00:00.000Z"
    });

    expect(version.artifact.files.stylesCss).toBe("styles.css");
  });

  it("limits run states to explicit lifecycle values", () => {
    expect(RunStateSchema.parse("needs_approval")).toBe("needs_approval");
    expect(() => RunStateSchema.parse("waiting")).toThrow();
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @lp-agent/lp-schema test
```

Expected: FAIL because `packages/lp-schema/src/index.ts` does not exist.

- [ ] **Step 3: Implement the schema**

Create `packages/lp-schema/src/index.ts`:

```ts
import { z } from "zod";

export const ProjectRoleSchema = z.enum(["owner", "admin", "member", "reviewer"]);
export type ProjectRole = z.infer<typeof ProjectRoleSchema>;

export const AgentRoleSchema = z.enum(["planner", "builder", "reviewer", "deployer"]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const RunStateSchema = z.enum([
  "queued",
  "running",
  "needs_input",
  "needs_approval",
  "failed",
  "completed",
  "cancelled"
]);
export type RunState = z.infer<typeof RunStateSchema>;

export const CTAConfigSchema = z.object({
  label: z.string().min(1),
  href: z.string().min(1),
  intent: z.string().min(1)
});
export type CTAConfig = z.infer<typeof CTAConfigSchema>;

export const AssetRefSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["image", "video", "document", "link"]),
  label: z.string().min(1),
  url: z.string().min(1),
  alt: z.string().optional()
});
export type AssetRef = z.infer<typeof AssetRefSchema>;

export const LPSectionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["hero", "benefits", "product-grid", "social-proof", "faq", "cta", "custom"]),
  purpose: z.string().min(1),
  headline: z.string().min(1),
  body: z.string().min(1),
  media: z.array(AssetRefSchema).default([]),
  cta: CTAConfigSchema.optional(),
  layoutHints: z.array(z.string()).default([]),
  validationRules: z.array(z.string()).default([])
});
export type LPSection = z.infer<typeof LPSectionSchema>;

export const LPBriefSchema = z.object({
  title: z.string().min(1),
  objective: z.string().min(1),
  audience: z.string().min(1),
  offer: z.string().min(1),
  brandProfile: z.object({
    name: z.string().min(1),
    tone: z.string().min(1),
    colors: z.array(z.string().min(1)).min(1),
    typography: z.string().min(1)
  }),
  tone: z.string().min(1),
  constraints: z.array(z.string()).default([]),
  sections: z.array(LPSectionSchema).min(1),
  cta: CTAConfigSchema,
  assets: z.array(AssetRefSchema).default([]),
  productData: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string().min(1),
      price: z.string().optional(),
      imageUrl: z.string().optional()
    })
  ).default([]),
  seo: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    socialImage: z.string().optional()
  }),
  tracking: z.object({
    analyticsId: z.string().optional(),
    events: z.array(z.string()).default([])
  }).default({ events: [] }),
  complianceNotes: z.array(z.string()).default([])
});
export type LPBrief = z.infer<typeof LPBriefSchema>;

export const ArtifactSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["three-file-static", "single-file-html"]),
  files: z.object({
    indexHtml: z.string().min(1),
    stylesCss: z.string().min(1).optional(),
    scriptJs: z.string().min(1).optional()
  })
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const ReviewFindingSchema = z.object({
  severity: z.enum(["info", "warning", "blocking"]),
  target: z.string().min(1),
  explanation: z.string().min(1),
  suggestedFix: z.string().min(1),
  blocksDeployment: z.boolean()
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

export const PageVersionSchema = z.object({
  id: z.string().min(1),
  brief: LPBriefSchema,
  artifact: ArtifactSchema,
  reviewStatus: z.enum(["pending", "passed", "failed"]),
  findings: z.array(ReviewFindingSchema).default([]),
  createdAt: z.string().datetime()
});
export type PageVersion = z.infer<typeof PageVersionSchema>;

export const sampleBrief: LPBrief = {
  title: "Spring Sale Landing Page",
  objective: "Convert paid traffic into spring campaign purchases.",
  audience: "Returning ecommerce customers who respond to limited-time offers.",
  offer: "Save 25% on curated spring essentials through Sunday.",
  brandProfile: {
    name: "Acme Market",
    tone: "clear, energetic, and trustworthy",
    colors: ["#0f766e", "#f59e0b", "#111827"],
    typography: "system sans-serif"
  },
  tone: "confident and concise",
  constraints: ["Framework-free static output", "Mobile-first layout"],
  sections: [
    {
      id: "section_hero",
      type: "hero",
      purpose: "Explain the campaign and drive the primary CTA.",
      headline: "Spring essentials, ready today",
      body: "A focused seasonal offer for shoppers who want fast decisions and clear value.",
      media: [],
      cta: {
        label: "Shop the sale",
        href: "#products",
        intent: "primary conversion"
      },
      layoutHints: ["high contrast", "above-the-fold CTA"],
      validationRules: ["include one primary CTA"]
    },
    {
      id: "section_benefits",
      type: "benefits",
      purpose: "Summarize the value proposition.",
      headline: "Why shoppers come back",
      body: "Fast delivery, curated picks, and simple seasonal bundles.",
      media: [],
      layoutHints: ["three compact benefit cards"],
      validationRules: []
    },
    {
      id: "section_products",
      type: "product-grid",
      purpose: "Show representative products.",
      headline: "Featured spring picks",
      body: "A concise grid of products with clear labels and pricing.",
      media: [],
      layoutHints: ["responsive grid"],
      validationRules: ["use productData when present"]
    },
    {
      id: "section_cta",
      type: "cta",
      purpose: "Close with the offer and CTA.",
      headline: "The offer ends Sunday",
      body: "Lock in the spring sale while inventory is still available.",
      media: [],
      cta: {
        label: "Get 25% off",
        href: "#products",
        intent: "final conversion"
      },
      layoutHints: ["simple centered CTA"],
      validationRules: []
    }
  ],
  cta: {
    label: "Shop the sale",
    href: "#products",
    intent: "primary conversion"
  },
  assets: [],
  productData: [
    {
      id: "product_1",
      name: "Everyday Tote",
      description: "A durable carryall for spring errands.",
      price: "$48"
    }
  ],
  seo: {
    title: "Spring Sale | Acme Market",
    description: "Save 25% on curated spring essentials for a limited time."
  },
  tracking: {
    events: ["cta_click", "product_click"]
  },
  complianceNotes: ["Do not imply discounts continue beyond Sunday."]
};
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm install
pnpm --filter @lp-agent/lp-schema test
pnpm --filter @lp-agent/lp-schema typecheck
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml packages/lp-schema
git commit -m "feat: add lp brief schema"
```

### Task 3: Static Artifact Generation

**Files:**
- Create: `packages/artifacts/package.json`
- Create: `packages/artifacts/tsconfig.json`
- Create: `packages/artifacts/src/index.test.ts`
- Create: `packages/artifacts/src/index.ts`

- [ ] **Step 1: Write failing artifact tests**

Create `packages/artifacts/package.json`:

```json
{
  "name": "@lp-agent/artifacts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run src/index.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@lp-agent/lp-schema": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

Create `packages/artifacts/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

Create `packages/artifacts/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sampleBrief } from "@lp-agent/lp-schema";
import { bundleSingleFileHtml, generateStaticArtifacts } from "./index";

describe("static artifact generation", () => {
  it("generates a framework-free three-file LP artifact", () => {
    const artifact = generateStaticArtifacts(sampleBrief);

    expect(artifact.indexHtml).toContain("<main");
    expect(artifact.indexHtml).toContain("Spring essentials, ready today");
    expect(artifact.indexHtml).toContain('href="styles.css"');
    expect(artifact.indexHtml).toContain('src="script.js"');
    expect(artifact.stylesCss).toContain(":root");
    expect(artifact.stylesCss).toContain("@media");
    expect(artifact.scriptJs).toContain("data-track");
    expect(artifact.indexHtml).not.toContain("react");
    expect(artifact.indexHtml).not.toContain("__NEXT_DATA__");
  });

  it("escapes user-controlled text before writing HTML", () => {
    const artifact = generateStaticArtifacts({
      ...sampleBrief,
      title: "<script>alert(1)</script>",
      sections: [
        {
          ...sampleBrief.sections[0]!,
          headline: "<img src=x onerror=alert(1)>"
        }
      ]
    });

    expect(artifact.indexHtml).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(artifact.indexHtml).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("bundles CSS and JS into a single HTML document", () => {
    const artifact = generateStaticArtifacts(sampleBrief);
    const bundled = bundleSingleFileHtml(artifact);

    expect(bundled).toContain("<style>");
    expect(bundled).toContain("<script>");
    expect(bundled).not.toContain('href="styles.css"');
    expect(bundled).not.toContain('src="script.js"');
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @lp-agent/artifacts test
```

Expected: FAIL because `packages/artifacts/src/index.ts` does not exist.

- [ ] **Step 3: Implement artifact generation**

Create `packages/artifacts/src/index.ts`:

```ts
import type { LPBrief, LPSection } from "@lp-agent/lp-schema";

export interface StaticArtifacts {
  indexHtml: string;
  stylesCss: string;
  scriptJs: string;
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const toSectionHtml = (section: LPSection): string => {
  const cta = section.cta
    ? `<a class="button" href="${escapeHtml(section.cta.href)}" data-track="cta:${escapeHtml(section.id)}">${escapeHtml(section.cta.label)}</a>`
    : "";

  return [
    `<section class="lp-section lp-section-${escapeHtml(section.type)}" id="${escapeHtml(section.id)}">`,
    `  <div class="section-copy">`,
    `    <p class="eyebrow">${escapeHtml(section.purpose)}</p>`,
    `    <h2>${escapeHtml(section.headline)}</h2>`,
    `    <p>${escapeHtml(section.body)}</p>`,
    cta ? `    ${cta}` : "",
    `  </div>`,
    `</section>`
  ].filter(Boolean).join("\n");
};

const productGridHtml = (brief: LPBrief): string => {
  if (brief.productData.length === 0) {
    return "";
  }

  const cards = brief.productData.map((product) => [
    `<article class="product-card" data-track="product:${escapeHtml(product.id)}">`,
    product.imageUrl ? `  <img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}">` : "",
    `  <h3>${escapeHtml(product.name)}</h3>`,
    `  <p>${escapeHtml(product.description)}</p>`,
    product.price ? `  <strong>${escapeHtml(product.price)}</strong>` : "",
    `</article>`
  ].filter(Boolean).join("\n")).join("\n");

  return `<section class="lp-section product-grid" id="products">\n<h2>Featured products</h2>\n<div class="products">\n${cards}\n</div>\n</section>`;
};

export const generateStaticArtifacts = (brief: LPBrief): StaticArtifacts => {
  const primaryColor = brief.brandProfile.colors[0] ?? "#0f766e";
  const accentColor = brief.brandProfile.colors[1] ?? "#f59e0b";
  const textColor = brief.brandProfile.colors[2] ?? "#111827";
  const sectionHtml = brief.sections.map(toSectionHtml).join("\n\n");
  const products = productGridHtml(brief);

  const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(brief.seo.title)}</title>
  <meta name="description" content="${escapeHtml(brief.seo.description)}">
  ${brief.seo.socialImage ? `<meta property="og:image" content="${escapeHtml(brief.seo.socialImage)}">` : ""}
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="site-header">
    <strong>${escapeHtml(brief.brandProfile.name)}</strong>
    <a href="${escapeHtml(brief.cta.href)}" data-track="cta:header">${escapeHtml(brief.cta.label)}</a>
  </header>
  <main data-page-title="${escapeHtml(brief.title)}">
${sectionHtml}
${products}
  </main>
  <script src="script.js"></script>
</body>
</html>`;

  const stylesCss = `:root {
  --color-primary: ${primaryColor};
  --color-accent: ${accentColor};
  --color-text: ${textColor};
  --color-bg: #ffffff;
  --font-body: ${brief.brandProfile.typography};
}

* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--font-body), system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--color-text);
  background: var(--color-bg);
}
.site-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px clamp(20px, 5vw, 64px);
  background: rgba(255, 255, 255, 0.94);
  border-bottom: 1px solid #e5e7eb;
}
.site-header a,
.button {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 18px;
  border-radius: 6px;
  color: white;
  background: var(--color-primary);
  text-decoration: none;
  font-weight: 700;
}
.lp-section {
  padding: clamp(48px, 8vw, 96px) clamp(20px, 5vw, 72px);
  border-bottom: 1px solid #eef2f7;
}
.lp-section-hero {
  min-height: 72vh;
  display: grid;
  align-items: center;
  background: linear-gradient(135deg, #f8fafc, #ecfeff);
}
.section-copy {
  max-width: 760px;
}
.eyebrow {
  color: var(--color-primary);
  font-weight: 700;
  text-transform: uppercase;
  font-size: 0.78rem;
  letter-spacing: 0;
}
h2 {
  margin: 0 0 18px;
  font-size: clamp(2rem, 5vw, 4.5rem);
  line-height: 1;
}
p {
  max-width: 68ch;
  font-size: 1.08rem;
  line-height: 1.7;
}
.products {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}
.product-card {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 18px;
  background: #ffffff;
}
.product-card img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: 6px;
}
@media (max-width: 760px) {
  .site-header {
    gap: 12px;
    align-items: flex-start;
    flex-direction: column;
  }
  .products {
    grid-template-columns: 1fr;
  }
}`;

  const scriptJs = `document.querySelectorAll("[data-track]").forEach((element) => {
  element.addEventListener("click", () => {
    const eventName = element.getAttribute("data-track");
    window.dispatchEvent(new CustomEvent("lp-agent-track", { detail: { eventName } }));
  });
});`;

  return { indexHtml, stylesCss, scriptJs };
};

export const bundleSingleFileHtml = (artifact: StaticArtifacts): string =>
  artifact.indexHtml
    .replace('<link rel="stylesheet" href="styles.css">', `<style>\n${artifact.stylesCss}\n</style>`)
    .replace('  <script src="script.js"></script>', `  <script>\n${artifact.scriptJs}\n  </script>`);
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm install
pnpm --filter @lp-agent/artifacts test
pnpm --filter @lp-agent/artifacts typecheck
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml packages/artifacts
git commit -m "feat: generate static lp artifacts"
```

### Task 4: Skills Registry Rules

**Files:**
- Create: `packages/skills/package.json`
- Create: `packages/skills/tsconfig.json`
- Create: `packages/skills/src/index.test.ts`
- Create: `packages/skills/src/index.ts`

- [ ] **Step 1: Write failing skills tests**

Create `packages/skills/package.json`:

```json
{
  "name": "@lp-agent/skills",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run src/index.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

Create `packages/skills/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

Create `packages/skills/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  SkillManifestSchema,
  canPublishSkill,
  canUseSkill,
  sampleTemplateSkill
} from "./index";

describe("skills registry rules", () => {
  it("validates workflow and template skill manifests", () => {
    const parsed = SkillManifestSchema.parse(sampleTemplateSkill);

    expect(parsed.type).toBe("template");
    expect(parsed.scope).toBe("project");
  });

  it("lets members publish workflow and template skills", () => {
    expect(canPublishSkill("member", sampleTemplateSkill)).toEqual({
      allowed: true,
      reason: "member can publish template skills"
    });
  });

  it("requires admin review for deployment skills", () => {
    const result = canPublishSkill("member", {
      ...sampleTemplateSkill,
      type: "deployment",
      permissions: ["git:write", "ci:trigger"]
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("deployment skills require admin review");
  });

  it("allows admins to publish permissioned deployment skills", () => {
    const result = canPublishSkill("admin", {
      ...sampleTemplateSkill,
      type: "deployment",
      permissions: ["git:write", "ci:trigger"]
    });

    expect(result.allowed).toBe(true);
  });

  it("checks project skill bindings before use", () => {
    expect(
      canUseSkill({
        skillId: "skill_brand",
        boundSkillIds: ["skill_brand"],
        requiredPermissions: ["artifact:write"],
        grantedPermissions: ["artifact:write", "brief:read"]
      })
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @lp-agent/skills test
```

Expected: FAIL because `packages/skills/src/index.ts` does not exist.

- [ ] **Step 3: Implement skill validation and governance**

Create `packages/skills/src/index.ts`:

```ts
import { z } from "zod";

export const SkillTypeSchema = z.enum(["workflow", "template", "deployment"]);
export type SkillType = z.infer<typeof SkillTypeSchema>;

export const SkillScopeSchema = z.enum(["global", "organization", "workspace", "project"]);
export type SkillScope = z.infer<typeof SkillScopeSchema>;

export const SkillManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  type: SkillTypeSchema,
  scope: SkillScopeSchema,
  description: z.string().min(1),
  permissions: z.array(z.string()).default([]),
  requiredSecrets: z.array(z.string()).default([]),
  entrypoints: z.array(z.string()).default([]),
  reviewState: z.enum(["draft", "validated", "published", "deprecated", "archived"])
});
export type SkillManifest = z.infer<typeof SkillManifestSchema>;

export type SkillPublisherRole = "owner" | "admin" | "member" | "reviewer";

export interface PermissionDecision {
  allowed: boolean;
  reason: string;
}

export const sampleTemplateSkill: SkillManifest = {
  id: "skill_brand",
  name: "Acme Brand Landing Page Sections",
  version: "0.1.0",
  type: "template",
  scope: "project",
  description: "Adds brand tone, section patterns, and ecommerce LP constraints.",
  permissions: ["brief:read", "artifact:write"],
  requiredSecrets: [],
  entrypoints: ["templates/acme-lp.md"],
  reviewState: "validated"
};

export const canPublishSkill = (
  role: SkillPublisherRole,
  manifest: SkillManifest
): PermissionDecision => {
  SkillManifestSchema.parse(manifest);

  if (manifest.type === "deployment") {
    if (role === "owner" || role === "admin") {
      return { allowed: true, reason: `${role} can publish reviewed deployment skills` };
    }

    return { allowed: false, reason: "deployment skills require admin review" };
  }

  if (role === "owner" || role === "admin" || role === "member") {
    return { allowed: true, reason: `${role} can publish ${manifest.type} skills` };
  }

  return { allowed: false, reason: "reviewer cannot publish skills" };
};

export const canUseSkill = (input: {
  skillId: string;
  boundSkillIds: string[];
  requiredPermissions: string[];
  grantedPermissions: string[];
}): boolean => {
  const isBound = input.boundSkillIds.includes(input.skillId);
  const hasPermissions = input.requiredPermissions.every((permission) =>
    input.grantedPermissions.includes(permission)
  );

  return isBound && hasPermissions;
};
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm install
pnpm --filter @lp-agent/skills test
pnpm --filter @lp-agent/skills typecheck
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml packages/skills
git commit -m "feat: add skill governance rules"
```

### Task 5: MCP Gateway Policy

**Files:**
- Create: `packages/mcp-gateway/package.json`
- Create: `packages/mcp-gateway/tsconfig.json`
- Create: `packages/mcp-gateway/src/index.test.ts`
- Create: `packages/mcp-gateway/src/index.ts`

- [ ] **Step 1: Write failing MCP tests**

Create `packages/mcp-gateway/package.json`:

```json
{
  "name": "@lp-agent/mcp-gateway",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run src/index.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

Create `packages/mcp-gateway/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

Create `packages/mcp-gateway/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeVisibleTools, sampleConnector } from "./index";

describe("MCP gateway policy", () => {
  it("exposes only tools allowed for the agent role and project", () => {
    const tools = computeVisibleTools({
      connectors: [sampleConnector],
      projectConnectorIds: ["connector_assets"],
      skillPermissions: ["assets:read"],
      agentRole: "builder",
      approvalState: "not_required"
    });

    expect(tools.map((tool) => tool.name)).toEqual(["searchAssets"]);
  });

  it("hides deployment tools until approval is granted", () => {
    const tools = computeVisibleTools({
      connectors: [sampleConnector],
      projectConnectorIds: ["connector_assets"],
      skillPermissions: ["assets:read", "git:write"],
      agentRole: "deployer",
      approvalState: "pending"
    });

    expect(tools.map((tool) => tool.name)).toEqual([]);
  });

  it("shows deployment tools after approval", () => {
    const tools = computeVisibleTools({
      connectors: [sampleConnector],
      projectConnectorIds: ["connector_assets"],
      skillPermissions: ["git:write"],
      agentRole: "deployer",
      approvalState: "approved"
    });

    expect(tools.map((tool) => tool.name)).toEqual(["createPullRequest"]);
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @lp-agent/mcp-gateway test
```

Expected: FAIL because `packages/mcp-gateway/src/index.ts` does not exist.

- [ ] **Step 3: Implement MCP tool visibility**

Create `packages/mcp-gateway/src/index.ts`:

```ts
export type AgentRole = "planner" | "builder" | "reviewer" | "deployer";
export type ApprovalState = "not_required" | "pending" | "approved";

export interface MCPToolDefinition {
  name: string;
  permission: string;
  roles: AgentRole[];
  requiresApproval: boolean;
}

export interface MCPConnectorDefinition {
  id: string;
  name: string;
  tools: MCPToolDefinition[];
}

export interface VisibleToolInput {
  connectors: MCPConnectorDefinition[];
  projectConnectorIds: string[];
  skillPermissions: string[];
  agentRole: AgentRole;
  approvalState: ApprovalState;
}

export const sampleConnector: MCPConnectorDefinition = {
  id: "connector_assets",
  name: "Internal Assets and Git",
  tools: [
    {
      name: "searchAssets",
      permission: "assets:read",
      roles: ["planner", "builder", "reviewer"],
      requiresApproval: false
    },
    {
      name: "createPullRequest",
      permission: "git:write",
      roles: ["deployer"],
      requiresApproval: true
    }
  ]
};

export const computeVisibleTools = (input: VisibleToolInput): MCPToolDefinition[] =>
  input.connectors
    .filter((connector) => input.projectConnectorIds.includes(connector.id))
    .flatMap((connector) => connector.tools)
    .filter((tool) => tool.roles.includes(input.agentRole))
    .filter((tool) => input.skillPermissions.includes(tool.permission))
    .filter((tool) => !tool.requiresApproval || input.approvalState === "approved");
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/mcp-gateway test
pnpm --filter @lp-agent/mcp-gateway typecheck
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-gateway
git commit -m "feat: add scoped mcp gateway policy"
```

### Task 6: Model Gateway Routing

**Files:**
- Create: `packages/model-gateway/package.json`
- Create: `packages/model-gateway/tsconfig.json`
- Create: `packages/model-gateway/src/index.test.ts`
- Create: `packages/model-gateway/src/index.ts`

- [ ] **Step 1: Write failing model gateway tests**

Create `packages/model-gateway/package.json`:

```json
{
  "name": "@lp-agent/model-gateway",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run src/index.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

Create `packages/model-gateway/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

Create `packages/model-gateway/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryModelGateway, createDefaultModelPolicy } from "./index";

describe("model gateway", () => {
  it("routes agent roles through configured providers", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
    const result = await gateway.complete({
      role: "planner",
      prompt: "Create a landing page brief",
      projectId: "project_1"
    });

    expect(result.provider).toBe("mock-openai");
    expect(result.model).toBe("planning-model");
    expect(result.text).toContain("planner response");
  });

  it("records usage metadata for audit", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
    await gateway.complete({ role: "builder", prompt: "Generate HTML", projectId: "project_1" });

    expect(gateway.auditLog).toHaveLength(1);
    expect(gateway.auditLog[0]).toMatchObject({
      role: "builder",
      provider: "mock-anthropic",
      model: "code-model"
    });
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @lp-agent/model-gateway test
```

Expected: FAIL because `packages/model-gateway/src/index.ts` does not exist.

- [ ] **Step 3: Implement model routing**

Create `packages/model-gateway/src/index.ts`:

```ts
export type AgentRole = "planner" | "builder" | "reviewer" | "deployer";

export interface ModelRoute {
  provider: string;
  model: string;
}

export type ModelRoutingPolicy = Record<AgentRole, ModelRoute>;

export interface ModelRequest {
  role: AgentRole;
  prompt: string;
  projectId: string;
}

export interface ModelResponse {
  provider: string;
  model: string;
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface ModelAuditEntry extends ModelRoute {
  role: AgentRole;
  projectId: string;
  promptLength: number;
}

export const createDefaultModelPolicy = (): ModelRoutingPolicy => ({
  planner: { provider: "mock-openai", model: "planning-model" },
  builder: { provider: "mock-anthropic", model: "code-model" },
  reviewer: { provider: "mock-openai", model: "review-model" },
  deployer: { provider: "mock-local", model: "tool-model" }
});

export class InMemoryModelGateway {
  readonly auditLog: ModelAuditEntry[] = [];

  constructor(private readonly policy: ModelRoutingPolicy) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const route = this.policy[request.role];
    this.auditLog.push({
      role: request.role,
      projectId: request.projectId,
      provider: route.provider,
      model: route.model,
      promptLength: request.prompt.length
    });

    return {
      provider: route.provider,
      model: route.model,
      text: `${request.role} response from ${route.provider}/${route.model}`,
      usage: {
        inputTokens: Math.ceil(request.prompt.length / 4),
        outputTokens: 32
      }
    };
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/model-gateway test
pnpm --filter @lp-agent/model-gateway typecheck
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git add packages/model-gateway
git commit -m "feat: add model gateway routing"
```

### Task 7: Runtime Adapter and Local Agent Flow

**Files:**
- Create: `packages/runtime-adapters/package.json`
- Create: `packages/runtime-adapters/tsconfig.json`
- Create: `packages/runtime-adapters/src/index.test.ts`
- Create: `packages/runtime-adapters/src/index.ts`

- [ ] **Step 1: Write failing runtime tests**

Create `packages/runtime-adapters/package.json`:

```json
{
  "name": "@lp-agent/runtime-adapters",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run src/index.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@lp-agent/artifacts": "workspace:*",
    "@lp-agent/lp-schema": "workspace:*",
    "@lp-agent/model-gateway": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

Create `packages/runtime-adapters/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

Create `packages/runtime-adapters/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sampleBrief } from "@lp-agent/lp-schema";
import { InMemoryModelGateway, createDefaultModelPolicy } from "@lp-agent/model-gateway";
import { LocalAgentRuntimeAdapter } from "./index";

describe("local agent runtime adapter", () => {
  it("runs builder and returns static artifacts behind the adapter boundary", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
    const runtime = new LocalAgentRuntimeAdapter(gateway);

    const result = await runtime.run({
      runId: "run_builder_1",
      projectId: "project_1",
      role: "builder",
      input: { brief: sampleBrief }
    });

    expect(result.state).toBe("completed");
    expect(result.artifacts?.indexHtml).toContain("Spring essentials");
    expect(result.events.map((event) => event.type)).toEqual([
      "run.started",
      "model.completed",
      "artifact.created",
      "run.completed"
    ]);
  });

  it("runs reviewer and returns structured findings", async () => {
    const gateway = new InMemoryModelGateway(createDefaultModelPolicy());
    const runtime = new LocalAgentRuntimeAdapter(gateway);

    const result = await runtime.run({
      runId: "run_reviewer_1",
      projectId: "project_1",
      role: "reviewer",
      input: {
        brief: {
          ...sampleBrief,
          sections: [
            {
              ...sampleBrief.sections[0]!,
              cta: undefined
            }
          ]
        }
      }
    });

    expect(result.state).toBe("completed");
    expect(result.findings).toEqual([
      {
        severity: "blocking",
        target: "section:section_hero",
        explanation: "Hero section is missing a CTA.",
        suggestedFix: "Add a primary CTA to the hero section.",
        blocksDeployment: true
      }
    ]);
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @lp-agent/runtime-adapters test
```

Expected: FAIL because `packages/runtime-adapters/src/index.ts` does not exist.

- [ ] **Step 3: Implement the local runtime adapter**

Create `packages/runtime-adapters/src/index.ts`:

```ts
import { generateStaticArtifacts, type StaticArtifacts } from "@lp-agent/artifacts";
import type { LPBrief, ReviewFinding, RunState } from "@lp-agent/lp-schema";
import type { AgentRole, InMemoryModelGateway } from "@lp-agent/model-gateway";

export interface RuntimeEvent {
  type: "run.started" | "model.completed" | "artifact.created" | "review.completed" | "run.completed";
  message: string;
}

export interface RuntimeRunRequest {
  runId: string;
  projectId: string;
  role: AgentRole;
  input: {
    prompt?: string;
    brief?: LPBrief;
  };
}

export interface RuntimeRunResult {
  runId: string;
  state: RunState;
  events: RuntimeEvent[];
  artifacts?: StaticArtifacts;
  findings?: ReviewFinding[];
}

export interface AgentRuntimeAdapter {
  run(request: RuntimeRunRequest): Promise<RuntimeRunResult>;
}

const reviewBrief = (brief: LPBrief): ReviewFinding[] =>
  brief.sections
    .filter((section) => section.type === "hero" && !section.cta)
    .map((section): ReviewFinding => ({
      severity: "blocking",
      target: `section:${section.id}`,
      explanation: "Hero section is missing a CTA.",
      suggestedFix: "Add a primary CTA to the hero section.",
      blocksDeployment: true
    }));

export class LocalAgentRuntimeAdapter implements AgentRuntimeAdapter {
  constructor(private readonly modelGateway: InMemoryModelGateway) {}

  async run(request: RuntimeRunRequest): Promise<RuntimeRunResult> {
    const events: RuntimeEvent[] = [
      { type: "run.started", message: `${request.role} run started` }
    ];

    await this.modelGateway.complete({
      role: request.role,
      prompt: request.input.prompt ?? JSON.stringify(request.input.brief ?? {}),
      projectId: request.projectId
    });

    events.push({ type: "model.completed", message: `${request.role} model call completed` });

    if (request.role === "builder" && request.input.brief) {
      const artifacts = generateStaticArtifacts(request.input.brief);
      events.push({ type: "artifact.created", message: "Static LP artifacts created" });
      events.push({ type: "run.completed", message: "Builder run completed" });
      return { runId: request.runId, state: "completed", events, artifacts };
    }

    if (request.role === "reviewer" && request.input.brief) {
      const findings = reviewBrief(request.input.brief);
      events.push({ type: "review.completed", message: "Reviewer checks completed" });
      events.push({ type: "run.completed", message: "Reviewer run completed" });
      return { runId: request.runId, state: "completed", events, findings };
    }

    events.push({ type: "run.completed", message: `${request.role} run completed` });
    return { runId: request.runId, state: "completed", events };
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/runtime-adapters test
pnpm --filter @lp-agent/runtime-adapters typecheck
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime-adapters
git commit -m "feat: add local agent runtime adapter"
```

### Task 8: Git Deployment Adapter

**Files:**
- Create: `packages/git-deployment/package.json`
- Create: `packages/git-deployment/tsconfig.json`
- Create: `packages/git-deployment/src/index.test.ts`
- Create: `packages/git-deployment/src/index.ts`

- [ ] **Step 1: Write failing Git deployment tests**

Create `packages/git-deployment/package.json`:

```json
{
  "name": "@lp-agent/git-deployment",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run src/index.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@lp-agent/artifacts": "workspace:*",
    "@lp-agent/lp-schema": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

Create `packages/git-deployment/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

Create `packages/git-deployment/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sampleBrief } from "@lp-agent/lp-schema";
import { generateStaticArtifacts } from "@lp-agent/artifacts";
import { InMemoryGitDeploymentAdapter } from "./index";

describe("git deployment adapter", () => {
  it("rejects deployment handoff without approval", async () => {
    const adapter = new InMemoryGitDeploymentAdapter();

    await expect(
      adapter.createHandoff({
        projectId: "project_1",
        pageVersionId: "version_1",
        approved: false,
        artifacts: generateStaticArtifacts(sampleBrief)
      })
    ).rejects.toThrow("Deployment handoff requires approval.");
  });

  it("creates branch, commit, and pull request records", async () => {
    const adapter = new InMemoryGitDeploymentAdapter();
    const handoff = await adapter.createHandoff({
      projectId: "project_1",
      pageVersionId: "version_1",
      approved: true,
      artifacts: generateStaticArtifacts(sampleBrief)
    });

    expect(handoff.branch).toBe("lp-agent/project_1/version_1");
    expect(handoff.files).toEqual(["index.html", "styles.css", "script.js"]);
    expect(handoff.pullRequestUrl).toContain("https://git.example.local/pr/");
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @lp-agent/git-deployment test
```

Expected: FAIL because `packages/git-deployment/src/index.ts` does not exist.

- [ ] **Step 3: Implement the in-memory Git handoff adapter**

Create `packages/git-deployment/src/index.ts`:

```ts
import type { StaticArtifacts } from "@lp-agent/artifacts";

export interface DeploymentHandoffInput {
  projectId: string;
  pageVersionId: string;
  approved: boolean;
  artifacts: StaticArtifacts;
}

export interface DeploymentHandoff {
  id: string;
  branch: string;
  commitSha: string;
  pullRequestUrl: string;
  files: string[];
  status: "pr_opened";
}

export interface GitDeploymentAdapter {
  createHandoff(input: DeploymentHandoffInput): Promise<DeploymentHandoff>;
}

export class InMemoryGitDeploymentAdapter implements GitDeploymentAdapter {
  private sequence = 0;

  async createHandoff(input: DeploymentHandoffInput): Promise<DeploymentHandoff> {
    if (!input.approved) {
      throw new Error("Deployment handoff requires approval.");
    }

    this.sequence += 1;
    const id = `deployment_${this.sequence}`;
    const branch = `lp-agent/${input.projectId}/${input.pageVersionId}`;

    return {
      id,
      branch,
      commitSha: `mock_commit_${this.sequence}`,
      pullRequestUrl: `https://git.example.local/pr/${id}`,
      files: ["index.html", "styles.css", "script.js"],
      status: "pr_opened"
    };
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/git-deployment test
pnpm --filter @lp-agent/git-deployment typecheck
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git add packages/git-deployment
git commit -m "feat: add git deployment handoff adapter"
```

### Task 9: Postgres Schema Definition

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add the DB package and Prisma schema**

Create `packages/db/package.json`:

```json
{
  "name": "@lp-agent/db",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "db:validate": "prisma validate --schema prisma/schema.prisma"
  },
  "devDependencies": {
    "prisma": "^6.0.0"
  }
}
```

Create `packages/db/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum ProjectRole {
  owner
  admin
  member
  reviewer
}

enum SkillType {
  workflow
  template
  deployment
}

enum SkillScope {
  global
  organization
  workspace
  project
}

enum RunState {
  queued
  running
  needs_input
  needs_approval
  failed
  completed
  cancelled
}

model Organization {
  id         String      @id @default(cuid())
  name       String
  workspaces Workspace[]
  createdAt  DateTime    @default(now())
  updatedAt  DateTime    @updatedAt
}

model Workspace {
  id             String            @id @default(cuid())
  organizationId String
  name           String
  organization   Organization      @relation(fields: [organizationId], references: [id])
  members        WorkspaceMember[]
  projects       Project[]
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt
}

model WorkspaceMember {
  id          String      @id @default(cuid())
  workspaceId String
  userId      String
  role        ProjectRole
  workspace   Workspace   @relation(fields: [workspaceId], references: [id])
  createdAt   DateTime    @default(now())

  @@unique([workspaceId, userId])
}

model Project {
  id          String          @id @default(cuid())
  workspaceId String
  name        String
  repository  String?
  workspace   Workspace       @relation(fields: [workspaceId], references: [id])
  members     ProjectMember[]
  briefs      LPBrief[]
  versions    PageVersion[]
  runs        Run[]
  deployments Deployment[]
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
}

model ProjectMember {
  id        String      @id @default(cuid())
  projectId String
  userId    String
  role      ProjectRole
  project   Project     @relation(fields: [projectId], references: [id])
  createdAt DateTime    @default(now())

  @@unique([projectId, userId])
}

model LPBrief {
  id        String   @id @default(cuid())
  projectId String
  title     String
  data      Json
  project   Project  @relation(fields: [projectId], references: [id])
  versions  PageVersion[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model PageVersion {
  id           String       @id @default(cuid())
  projectId    String
  briefId      String
  artifactData Json
  reviewStatus String
  project      Project      @relation(fields: [projectId], references: [id])
  brief        LPBrief      @relation(fields: [briefId], references: [id])
  deployments  Deployment[]
  createdAt    DateTime     @default(now())
}

model Skill {
  id        String         @id
  name      String
  type      SkillType
  scope     SkillScope
  versions  SkillVersion[]
  createdAt DateTime       @default(now())
}

model SkillVersion {
  id         String   @id @default(cuid())
  skillId    String
  version    String
  manifest   Json
  content    String
  reviewState String
  skill      Skill    @relation(fields: [skillId], references: [id])
  createdAt  DateTime @default(now())
}

model Run {
  id        String   @id
  projectId String
  role      String
  state     RunState
  events    Json
  project   Project  @relation(fields: [projectId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Deployment {
  id            String      @id
  projectId     String
  pageVersionId String
  branch        String
  commitSha     String
  pullRequestUrl String
  status        String
  project       Project     @relation(fields: [projectId], references: [id])
  pageVersion   PageVersion @relation(fields: [pageVersionId], references: [id])
  createdAt     DateTime    @default(now())
}
```

- [ ] **Step 2: Validate schema**

Run:

```bash
pnpm install
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm --filter @lp-agent/db db:validate
```

Expected: Prisma validates the schema without requiring a database connection.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml packages/db
git commit -m "feat: define postgres data model"
```

### Task 10: API Orchestration Service

**Files:**
- Create: `packages/api/package.json`
- Create: `packages/api/tsconfig.json`
- Create: `packages/api/src/services.test.ts`
- Create: `packages/api/src/index.ts`

- [ ] **Step 1: Write failing API service tests**

Create `packages/api/package.json`:

```json
{
  "name": "@lp-agent/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run src/services.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@lp-agent/artifacts": "workspace:*",
    "@lp-agent/git-deployment": "workspace:*",
    "@lp-agent/lp-schema": "workspace:*",
    "@lp-agent/model-gateway": "workspace:*",
    "@lp-agent/runtime-adapters": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

Create `packages/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

Create `packages/api/src/services.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createDemoWorkbenchService } from "./index";

describe("demo workbench service", () => {
  it("runs the complete LP generation and deployment handoff loop", async () => {
    const service = createDemoWorkbenchService();
    const project = service.createProject({
      name: "Spring Campaign",
      repository: "git@example.com:shop/lp.git"
    });

    const brief = service.createBriefFromPrompt({
      projectId: project.id,
      prompt: "Create a spring sale LP for returning shoppers."
    });

    const version = await service.generatePageVersion({
      projectId: project.id,
      briefId: brief.id
    });

    const review = await service.reviewPageVersion({
      projectId: project.id,
      pageVersionId: version.id
    });

    const deployment = await service.approveAndCreateDeployment({
      projectId: project.id,
      pageVersionId: version.id,
      reviewerUserId: "user_reviewer"
    });

    expect(project.name).toBe("Spring Campaign");
    expect(brief.data.title).toBe("Spring Sale Landing Page");
    expect(version.artifacts.indexHtml).toContain("Spring essentials");
    expect(review.findings).toEqual([]);
    expect(deployment.status).toBe("pr_opened");
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @lp-agent/api test
```

Expected: FAIL because `packages/api/src/index.ts` does not exist.

- [ ] **Step 3: Implement in-memory orchestration**

Create `packages/api/src/index.ts`:

```ts
import { InMemoryGitDeploymentAdapter, type DeploymentHandoff } from "@lp-agent/git-deployment";
import { sampleBrief, type LPBrief, type ReviewFinding } from "@lp-agent/lp-schema";
import { InMemoryModelGateway, createDefaultModelPolicy } from "@lp-agent/model-gateway";
import { LocalAgentRuntimeAdapter } from "@lp-agent/runtime-adapters";
import type { StaticArtifacts } from "@lp-agent/artifacts";

export interface ProjectRecord {
  id: string;
  name: string;
  repository: string;
}

export interface BriefRecord {
  id: string;
  projectId: string;
  sourcePrompt: string;
  data: LPBrief;
}

export interface PageVersionRecord {
  id: string;
  projectId: string;
  briefId: string;
  artifacts: StaticArtifacts;
  reviewStatus: "pending" | "passed" | "failed";
  findings: ReviewFinding[];
}

export interface WorkbenchSnapshot {
  project: ProjectRecord;
  brief: BriefRecord;
  pageVersion: PageVersionRecord;
  deployment?: DeploymentHandoff;
}

export class DemoWorkbenchService {
  private projectSequence = 0;
  private briefSequence = 0;
  private versionSequence = 0;
  private readonly projects = new Map<string, ProjectRecord>();
  private readonly briefs = new Map<string, BriefRecord>();
  private readonly versions = new Map<string, PageVersionRecord>();
  private readonly runtime = new LocalAgentRuntimeAdapter(
    new InMemoryModelGateway(createDefaultModelPolicy())
  );
  private readonly deploymentAdapter = new InMemoryGitDeploymentAdapter();

  createProject(input: { name: string; repository: string }): ProjectRecord {
    this.projectSequence += 1;
    const project = {
      id: `project_${this.projectSequence}`,
      name: input.name,
      repository: input.repository
    };
    this.projects.set(project.id, project);
    return project;
  }

  createBriefFromPrompt(input: { projectId: string; prompt: string }): BriefRecord {
    this.assertProject(input.projectId);
    this.briefSequence += 1;
    const brief = {
      id: `brief_${this.briefSequence}`,
      projectId: input.projectId,
      sourcePrompt: input.prompt,
      data: sampleBrief
    };
    this.briefs.set(brief.id, brief);
    return brief;
  }

  async generatePageVersion(input: { projectId: string; briefId: string }): Promise<PageVersionRecord> {
    this.assertProject(input.projectId);
    const brief = this.assertBrief(input.briefId);
    const result = await this.runtime.run({
      runId: `run_builder_${input.briefId}`,
      projectId: input.projectId,
      role: "builder",
      input: { brief: brief.data }
    });

    if (!result.artifacts) {
      throw new Error("Builder run completed without artifacts.");
    }

    this.versionSequence += 1;
    const version: PageVersionRecord = {
      id: `version_${this.versionSequence}`,
      projectId: input.projectId,
      briefId: input.briefId,
      artifacts: result.artifacts,
      reviewStatus: "pending",
      findings: []
    };
    this.versions.set(version.id, version);
    return version;
  }

  async reviewPageVersion(input: { projectId: string; pageVersionId: string }): Promise<PageVersionRecord> {
    this.assertProject(input.projectId);
    const version = this.assertVersion(input.pageVersionId);
    const brief = this.assertBrief(version.briefId);
    const result = await this.runtime.run({
      runId: `run_reviewer_${version.id}`,
      projectId: input.projectId,
      role: "reviewer",
      input: { brief: brief.data }
    });

    const reviewed: PageVersionRecord = {
      ...version,
      reviewStatus: result.findings?.some((finding) => finding.blocksDeployment) ? "failed" : "passed",
      findings: result.findings ?? []
    };
    this.versions.set(reviewed.id, reviewed);
    return reviewed;
  }

  async approveAndCreateDeployment(input: {
    projectId: string;
    pageVersionId: string;
    reviewerUserId: string;
  }): Promise<DeploymentHandoff> {
    this.assertProject(input.projectId);
    const version = this.assertVersion(input.pageVersionId);

    if (version.reviewStatus !== "passed") {
      throw new Error("Page version must pass review before deployment handoff.");
    }

    return this.deploymentAdapter.createHandoff({
      projectId: input.projectId,
      pageVersionId: input.pageVersionId,
      approved: true,
      artifacts: version.artifacts
    });
  }

  getSnapshot(projectId: string): WorkbenchSnapshot {
    const project = this.assertProject(projectId);
    const brief = [...this.briefs.values()].find((item) => item.projectId === projectId);
    const pageVersion = [...this.versions.values()].find((item) => item.projectId === projectId);

    if (!brief || !pageVersion) {
      throw new Error("Project snapshot requires a brief and page version.");
    }

    return { project, brief, pageVersion };
  }

  private assertProject(projectId: string): ProjectRecord {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }

  private assertBrief(briefId: string): BriefRecord {
    const brief = this.briefs.get(briefId);
    if (!brief) {
      throw new Error(`Brief not found: ${briefId}`);
    }
    return brief;
  }

  private assertVersion(versionId: string): PageVersionRecord {
    const version = this.versions.get(versionId);
    if (!version) {
      throw new Error(`Page version not found: ${versionId}`);
    }
    return version;
  }
}

export const createDemoWorkbenchService = (): DemoWorkbenchService => new DemoWorkbenchService();
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm --filter @lp-agent/api test
pnpm --filter @lp-agent/api typecheck
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api
git commit -m "feat: orchestrate lp workbench flow"
```

### Task 11: Agent Worker App

**Files:**
- Create: `apps/agent-worker/package.json`
- Create: `apps/agent-worker/tsconfig.json`
- Create: `apps/agent-worker/src/worker.test.ts`
- Create: `apps/agent-worker/src/worker.ts`
- Create: `apps/agent-worker/src/index.ts`

- [ ] **Step 1: Write failing worker tests**

Create `apps/agent-worker/package.json`:

```json
{
  "name": "@lp-agent/agent-worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "test": "vitest run src/worker.test.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@lp-agent/api": "workspace:*",
    "tsx": "^4.19.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

Create `apps/agent-worker/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

Create `apps/agent-worker/src/worker.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runDemoWorkerJob } from "./worker";

describe("agent worker app", () => {
  it("runs a deterministic demo worker job", async () => {
    const result = await runDemoWorkerJob();

    expect(result.project.name).toBe("Demo LP Project");
    expect(result.pageVersion.reviewStatus).toBe("passed");
    expect(result.deployment.status).toBe("pr_opened");
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @lp-agent/agent-worker test
```

Expected: FAIL because `apps/agent-worker/src/worker.ts` does not exist.

- [ ] **Step 3: Implement the worker module and entrypoint**

Create `apps/agent-worker/src/worker.ts`:

```ts
import { createDemoWorkbenchService } from "@lp-agent/api";

export const runDemoWorkerJob = async () => {
  const service = createDemoWorkbenchService();
  const project = service.createProject({
    name: "Demo LP Project",
    repository: "git@example.com:shop/demo-lp.git"
  });
  const brief = service.createBriefFromPrompt({
    projectId: project.id,
    prompt: "Create a lightweight spring ecommerce landing page."
  });
  const pageVersion = await service.generatePageVersion({
    projectId: project.id,
    briefId: brief.id
  });
  const reviewed = await service.reviewPageVersion({
    projectId: project.id,
    pageVersionId: pageVersion.id
  });
  const deployment = await service.approveAndCreateDeployment({
    projectId: project.id,
    pageVersionId: reviewed.id,
    reviewerUserId: "user_reviewer"
  });

  return {
    project,
    brief,
    pageVersion: reviewed,
    deployment
  };
};
```

Create `apps/agent-worker/src/index.ts`:

```ts
import { runDemoWorkerJob } from "./worker";

const result = await runDemoWorkerJob();

console.log(JSON.stringify({
  project: result.project,
  briefId: result.brief.id,
  pageVersionId: result.pageVersion.id,
  deployment: result.deployment
}, null, 2));
```

- [ ] **Step 4: Run tests, typecheck, and worker dev command**

Run:

```bash
pnpm install
pnpm --filter @lp-agent/agent-worker test
pnpm --filter @lp-agent/agent-worker typecheck
pnpm worker:dev
```

Expected: tests pass, typecheck passes, and `pnpm worker:dev` prints JSON containing `pullRequestUrl`.

- [ ] **Step 5: Commit**

```bash
git add apps/agent-worker package.json pnpm-lock.yaml
git commit -m "feat: add demo agent worker"
```

### Task 12: Web Workbench App

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.mjs`
- Create: `apps/web/src/lib/demo-workbench.ts`
- Create: `apps/web/src/components/lp-preview.tsx`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Create the web package**

Create `apps/web/package.json`:

```json
{
  "name": "@lp-agent/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@lp-agent/api": "workspace:*",
    "@lp-agent/artifacts": "workspace:*",
    "@lp-agent/lp-schema": "workspace:*",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.0"
  }
}
```

Create `apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "allowJs": true,
    "noEmit": true,
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ]
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Create `apps/web/next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@lp-agent/api",
    "@lp-agent/artifacts",
    "@lp-agent/lp-schema"
  ]
};

export default nextConfig;
```

- [ ] **Step 2: Create demo data helper**

Create `apps/web/src/lib/demo-workbench.ts`:

```ts
import { bundleSingleFileHtml } from "@lp-agent/artifacts";
import { createDemoWorkbenchService } from "@lp-agent/api";

export const createDemoWorkbenchSnapshot = async () => {
  const service = createDemoWorkbenchService();
  const project = service.createProject({
    name: "Spring Campaign",
    repository: "git@example.com:shop/spring-lp.git"
  });
  const brief = service.createBriefFromPrompt({
    projectId: project.id,
    prompt: "Create a lightweight spring sale landing page for returning ecommerce shoppers."
  });
  const pageVersion = await service.generatePageVersion({
    projectId: project.id,
    briefId: brief.id
  });
  const reviewed = await service.reviewPageVersion({
    projectId: project.id,
    pageVersionId: pageVersion.id
  });
  const deployment = await service.approveAndCreateDeployment({
    projectId: project.id,
    pageVersionId: reviewed.id,
    reviewerUserId: "user_reviewer"
  });

  return {
    project,
    brief,
    pageVersion: reviewed,
    deployment,
    singleFileHtml: bundleSingleFileHtml(reviewed.artifacts)
  };
};
```

- [ ] **Step 3: Create LP preview component**

Create `apps/web/src/components/lp-preview.tsx`:

```tsx
import type { StaticArtifacts } from "@lp-agent/artifacts";

interface LPPreviewProps {
  artifacts: StaticArtifacts;
}

export function LPPreview({ artifacts }: LPPreviewProps) {
  const srcDoc = artifacts.indexHtml
    .replace('<link rel="stylesheet" href="styles.css">', `<style>${artifacts.stylesCss}</style>`)
    .replace('  <script src="script.js"></script>', `<script>${artifacts.scriptJs}</script>`);

  return (
    <iframe
      className="previewFrame"
      title="Generated landing page preview"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
    />
  );
}
```

- [ ] **Step 4: Create app layout and styles**

Create `apps/web/src/app/layout.tsx`:

```tsx
import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "LP Engineering Team Agent",
  description: "Static landing page generation workbench"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Create `apps/web/src/app/globals.css`:

```css
:root {
  --bg: #f8fafc;
  --panel: #ffffff;
  --border: #dbe3ef;
  --text: #111827;
  --muted: #64748b;
  --accent: #0f766e;
  --accent-2: #f59e0b;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 280px 1fr;
}

.sidebar {
  border-right: 1px solid var(--border);
  background: #ffffff;
  padding: 24px;
}

.brand {
  font-size: 1.05rem;
  font-weight: 800;
  margin-bottom: 28px;
}

.navList {
  display: grid;
  gap: 8px;
}

.navItem {
  border-radius: 6px;
  padding: 10px 12px;
  color: var(--muted);
}

.navItemActive {
  color: var(--text);
  background: #ecfeff;
  font-weight: 700;
}

.content {
  padding: 28px;
  display: grid;
  gap: 20px;
}

.topbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.titleGroup h1 {
  margin: 0;
  font-size: 1.9rem;
}

.titleGroup p {
  color: var(--muted);
  margin: 8px 0 0;
}

.statusPill {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 8px 12px;
  background: #ffffff;
  font-weight: 700;
}

.grid {
  display: grid;
  grid-template-columns: minmax(360px, 0.9fr) minmax(520px, 1.4fr);
  gap: 20px;
}

.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 18px;
}

.panel h2 {
  margin: 0 0 14px;
  font-size: 1rem;
}

.fieldList,
.sectionList,
.runList {
  display: grid;
  gap: 12px;
}

.field,
.sectionItem,
.runItem {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  background: #ffffff;
}

.field label {
  display: block;
  color: var(--muted);
  font-size: 0.76rem;
  font-weight: 800;
  margin-bottom: 6px;
  text-transform: uppercase;
}

.field div,
.sectionItem p,
.runItem p {
  margin: 0;
  line-height: 1.5;
}

.previewFrame {
  width: 100%;
  min-height: 720px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #ffffff;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.button {
  border: 0;
  border-radius: 6px;
  padding: 10px 14px;
  color: #ffffff;
  background: var(--accent);
  font-weight: 800;
}

.buttonSecondary {
  color: var(--text);
  background: #e2e8f0;
}

@media (max-width: 980px) {
  .shell {
    grid-template-columns: 1fr;
  }

  .sidebar {
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Create the dashboard page**

Create `apps/web/src/app/page.tsx`:

```tsx
import { LPPreview } from "../components/lp-preview";
import { createDemoWorkbenchSnapshot } from "../lib/demo-workbench";

export default async function HomePage() {
  const snapshot = await createDemoWorkbenchSnapshot();
  const { project, brief, pageVersion, deployment, singleFileHtml } = snapshot;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">LP Engineering Team Agent</div>
        <nav className="navList" aria-label="Main navigation">
          <div className="navItem navItemActive">Workbench</div>
          <div className="navItem">Skills</div>
          <div className="navItem">MCP</div>
          <div className="navItem">Models</div>
          <div className="navItem">Deployments</div>
        </nav>
      </aside>

      <section className="content">
        <div className="topbar">
          <div className="titleGroup">
            <h1>{project.name}</h1>
            <p>{project.repository}</p>
          </div>
          <div className="statusPill">Review: {pageVersion.reviewStatus}</div>
        </div>

        <div className="grid">
          <section className="panel">
            <h2>Structured LP Brief</h2>
            <div className="fieldList">
              <div className="field">
                <label>Prompt</label>
                <div>{brief.sourcePrompt}</div>
              </div>
              <div className="field">
                <label>Objective</label>
                <div>{brief.data.objective}</div>
              </div>
              <div className="field">
                <label>Audience</label>
                <div>{brief.data.audience}</div>
              </div>
              <div className="field">
                <label>Offer</label>
                <div>{brief.data.offer}</div>
              </div>
              <div className="field">
                <label>Primary CTA</label>
                <div>{brief.data.cta.label} → {brief.data.cta.href}</div>
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>Preview</h2>
            <LPPreview artifacts={pageVersion.artifacts} />
          </section>

          <section className="panel">
            <h2>Page Sections</h2>
            <div className="sectionList">
              {brief.data.sections.map((section) => (
                <article className="sectionItem" key={section.id}>
                  <strong>{section.type}</strong>
                  <p>{section.headline}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Agent Run and Delivery</h2>
            <div className="runList">
              <div className="runItem">
                <strong>Planner</strong>
                <p>Extracted prompt into structured LP brief.</p>
              </div>
              <div className="runItem">
                <strong>Builder</strong>
                <p>Generated index.html, styles.css, and script.js.</p>
              </div>
              <div className="runItem">
                <strong>Reviewer</strong>
                <p>{pageVersion.findings.length === 0 ? "No blocking findings." : `${pageVersion.findings.length} findings.`}</p>
              </div>
              <div className="runItem">
                <strong>Deployer</strong>
                <p>{deployment.branch} opened at {deployment.pullRequestUrl}</p>
              </div>
            </div>
            <div className="actions" style={{ marginTop: 14 }}>
              <button className="button">Approve PR Handoff</button>
              <button className="button buttonSecondary">Export Three Files</button>
              <button className="button buttonSecondary">Export Single HTML ({singleFileHtml.length} bytes)</button>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 6: Build and typecheck**

Run:

```bash
pnpm install
pnpm --filter @lp-agent/web typecheck
pnpm --filter @lp-agent/web build
```

Expected: Next.js typecheck and build pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web package.json pnpm-lock.yaml
git commit -m "feat: add lp workbench web app"
```

### Task 13: Full Verification and Contributor Docs

**Files:**
- Modify: `AGENTS.md`
- Create: `docs/development.md`

- [ ] **Step 1: Update contributor commands**

Modify `AGENTS.md` command section so it includes:

```md
- `pnpm install` - install workspace dependencies.
- `pnpm dev` - start the Next.js web workbench.
- `pnpm worker:dev` - run the demo agent-worker job.
- `pnpm test` - run all Vitest tests.
- `pnpm typecheck` - type-check all workspace packages and apps.
- `pnpm build` - build all packages and apps that expose a build script.
```

Create `docs/development.md`:

```md
# Development

## Prerequisites

- Node.js compatible with the workspace dependencies.
- pnpm.
- Optional Postgres instance for future DB-backed development.

## Commands

- `pnpm install` installs dependencies.
- `pnpm dev` starts the web workbench.
- `pnpm worker:dev` runs the deterministic worker demo.
- `pnpm test` runs package and app tests.
- `pnpm typecheck` runs TypeScript checks.
- `pnpm build` builds workspace targets that define a build script.

## Current MVP Behavior

The first implementation uses deterministic local services for model calls, runtime execution, MCP visibility, and Git deployment handoff. The boundaries match the v1 design so real providers can replace these implementations without changing the product flow.
```

- [ ] **Step 2: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
DATABASE_URL="postgresql://user:pass@localhost:5432/lp_agent" pnpm --filter @lp-agent/db db:validate
```

Expected: all commands pass.

- [ ] **Step 3: Start the web app for manual verification**

Run:

```bash
pnpm dev
```

Expected: Next.js prints a local URL, usually `http://localhost:3000`.

Open the app in the browser and verify:

- Sidebar shows Workbench, Skills, MCP, Models, and Deployments.
- Structured LP Brief panel shows prompt, objective, audience, offer, and CTA.
- Preview iframe renders a landing page with no React/Next artifact in the generated page source.
- Page Sections panel lists the generated sections.
- Agent Run and Delivery panel shows Planner, Builder, Reviewer, and Deployer.
- Export buttons are visible.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md docs/development.md
git commit -m "docs: add development commands"
```

### Task 14: Final Integration Check

**Files:**
- Read: `docs/superpowers/specs/2026-05-11-lp-engineering-team-agent-design.md`
- Read: `docs/superpowers/plans/2026-05-11-lp-engineering-team-agent-v1.md`
- Read: `git status --short`

- [ ] **Step 1: Confirm spec coverage**

Use this checklist:

```text
LP brief schema: packages/lp-schema
Static HTML/CSS/JS generation: packages/artifacts
Workflow/template/deployment skill governance: packages/skills
Scoped MCP access: packages/mcp-gateway
Multi-model routing: packages/model-gateway
AgentRuntimeAdapter boundary: packages/runtime-adapters
Git/CI handoff adapter: packages/git-deployment
Postgres data model: packages/db/prisma/schema.prisma
Web workbench: apps/web
Agent worker: apps/agent-worker
Full loop orchestration: packages/api
```

- [ ] **Step 2: Run final commands**

Run:

```bash
git status --short
pnpm test
pnpm typecheck
pnpm build
```

Expected:

- `git status --short` shows no uncommitted files before the final summary.
- `pnpm test` passes.
- `pnpm typecheck` passes.
- `pnpm build` passes.

- [ ] **Step 3: Record final implementation summary**

Prepare a final response with:

```md
Implemented the v1 vertical MVP for LP Engineering Team Agent.

Verification:
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

Key files:
- `apps/web`
- `apps/agent-worker`
- `packages/lp-schema`
- `packages/artifacts`
- `packages/api`
- `packages/runtime-adapters`
```

Do not claim a command passed unless the command was run and the output confirmed success.

## Self-Review Notes

This plan covers the approved spec by mapping every v1 acceptance criterion to a package or app task:

- Project creation and LP request: Task 10 API, Task 12 web.
- Structured LP brief: Task 2 schema, Task 10 API.
- Static artifacts: Task 3 artifacts.
- Preview and export path: Task 12 web, Task 3 single-file bundle.
- Reviewer findings: Task 7 runtime, Task 10 API.
- Deployment approval and Git handoff: Task 8 deployment, Task 10 API.
- Skills governance: Task 4 skills.
- Scoped MCP access: Task 5 MCP gateway.
- Model gateway: Task 6 model gateway.
- Runtime adapter: Task 7 runtime adapter.
- Postgres direction: Task 9 Prisma schema.
- Team/product documentation: Task 13 docs.

The first implementation uses deterministic local services where live external systems would add setup friction. The interfaces and tests still enforce the long-term boundaries from the design.
