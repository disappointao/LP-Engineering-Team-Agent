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

const ArtifactBaseSchema = z.object({
  id: z.string().min(1)
});

export const ArtifactSchema = z.discriminatedUnion("kind", [
  ArtifactBaseSchema.extend({
    kind: z.literal("three-file-static"),
    files: z.object({
      indexHtml: z.string().min(1),
      stylesCss: z.string().min(1),
      scriptJs: z.string().min(1)
    })
  }),
  ArtifactBaseSchema.extend({
    kind: z.literal("single-file-html"),
    files: z.object({
      indexHtml: z.string().min(1)
    })
  })
]);
export type Artifact = z.infer<typeof ArtifactSchema>;
export type ArtifactInput = z.input<typeof ArtifactSchema>;

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
export type LPBriefInput = z.input<typeof LPBriefSchema>;
export type PageVersionInput = z.input<typeof PageVersionSchema>;

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
