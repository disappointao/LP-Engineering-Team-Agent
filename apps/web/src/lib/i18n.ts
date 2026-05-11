export type Locale = "en" | "zh-CN";

export interface ExportLabels {
  handoff: string;
  singleHtml: string;
  indexHtml: string;
  stylesCss: string;
  scriptJs: string;
  handoffNextAction: string;
}

export interface WorkbenchCopy {
  locale: Locale;
  localeName: string;
  metadata: {
    title: string;
    description: string;
  };
  nav: {
    label: string;
    workbench: string;
    skills: string;
    mcp: string;
    models: string;
    deployments: string;
  };
  sidebar: {
    team: string;
    modeLabel: string;
    mode: string;
    localeLabel: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    promptLabel: string;
    actionChips: string[];
  };
  status: {
    review: string;
    pending: string;
    passed: string;
    failed: string;
  };
  sections: {
    brief: string;
    preview: string;
    previewMode: string;
    pageSections: string;
    agentRun: string;
  };
  fields: {
    prompt: string;
    objective: string;
    audience: string;
    offer: string;
    primaryCta: string;
  };
  run: {
    planner: [string, string];
    builder: [string, string];
    reviewer: [string, string];
    reviewerFindings: string;
    deployer: [string, string];
  };
  demo: {
    projectName: string;
    prompt: string;
    objective: string;
    audience: string;
    offer: string;
    primaryCta: string;
  };
  exports: ExportLabels;
}

export function resolveLocaleFromAcceptLanguage(acceptLanguage?: string | null): Locale {
  if (!acceptLanguage) {
    return "en";
  }

  const preferences = acceptLanguage
    .split(",")
    .map((item) => {
      const [language = "", quality = "q=1"] = item.trim().split(";");
      const q = quality.trim().startsWith("q=")
        ? Number.parseFloat(quality.trim().slice(2))
        : 1;
      return {
        language: language.toLowerCase(),
        q: Number.isFinite(q) ? q : 0
      };
    })
    .filter((item) => item.language.length > 0)
    .sort((a, b) => b.q - a.q);

  for (const preference of preferences) {
    if (preference.language === "zh" || preference.language.startsWith("zh-")) {
      return "zh-CN";
    }

    if (preference.language === "en" || preference.language.startsWith("en-")) {
      return "en";
    }
  }

  return "en";
}

export function getWorkbenchCopy(locale: Locale): WorkbenchCopy {
  return copyByLocale[locale];
}

const copyByLocale: Record<Locale, WorkbenchCopy> = {
  en: {
    locale: "en",
    localeName: "English",
    metadata: {
      title: "LP Engineering Team Agent",
      description: "Static landing page generation workbench"
    },
    nav: {
      label: "Main navigation",
      workbench: "Workbench",
      skills: "Skills",
      mcp: "MCP",
      models: "Models",
      deployments: "Deployments"
    },
    sidebar: {
      team: "LP Engineering Team Agent",
      modeLabel: "Mode",
      mode: "Agent workspace",
      localeLabel: "Language"
    },
    hero: {
      eyebrow: "Ecommerce LP agent",
      title: "What LP should we build?",
      subtitle: "Brief, generate, review, and hand off framework-free landing pages with scoped skills and provider-ready runtime context.",
      promptLabel: "Current task",
      actionChips: ["Build LP", "Apply skill", "Check MCP", "Route model", "Export handoff"]
    },
    status: {
      review: "Review",
      pending: "pending",
      passed: "passed",
      failed: "failed"
    },
    sections: {
      brief: "Structured LP Brief",
      preview: "Preview",
      previewMode: "static iframe",
      pageSections: "Page Sections",
      agentRun: "Agent Run and Delivery"
    },
    fields: {
      prompt: "Prompt",
      objective: "Objective",
      audience: "Audience",
      offer: "Offer",
      primaryCta: "Primary CTA"
    },
    run: {
      planner: ["Planner", "Extracted the prompt into a structured LP brief."],
      builder: ["Builder", "Generated index.html, styles.css, and script.js."],
      reviewer: ["Reviewer", "No blocking findings."],
      reviewerFindings: "findings.",
      deployer: ["Deployer", "prepared for provider PR handoff."]
    },
    demo: {
      projectName: "Spring Campaign",
      prompt: "Create a lightweight spring sale landing page for returning ecommerce shoppers.",
      objective: "Convert paid traffic into spring campaign purchases.",
      audience: "Returning ecommerce customers who respond to limited-time offers.",
      offer: "Save 25% on curated spring essentials through Sunday.",
      primaryCta: "Shop the sale"
    },
    exports: {
      handoff: "Export PR Handoff",
      singleHtml: "Export Single HTML",
      indexHtml: "Export index.html",
      stylesCss: "Export styles.css",
      scriptJs: "Export script.js",
      handoffNextAction: "Apply these files to the target repository branch and open a provider PR."
    }
  },
  "zh-CN": {
    locale: "zh-CN",
    localeName: "中文",
    metadata: {
      title: "LP 工程团队智能体",
      description: "静态落地页生成工作台"
    },
    nav: {
      label: "主导航",
      workbench: "工作台",
      skills: "技能",
      mcp: "MCP",
      models: "模型",
      deployments: "部署"
    },
    sidebar: {
      team: "LP 工程团队智能体",
      modeLabel: "模式",
      mode: "智能体工作台",
      localeLabel: "语言"
    },
    hero: {
      eyebrow: "电商 LP 智能体",
      title: "我能帮你生成什么 LP？",
      subtitle: "从需求拆解、页面生成、审核到部署交接，生成物保持框架无关的静态 HTML/CSS/JS。",
      promptLabel: "当前任务",
      actionChips: ["生成 LP", "应用技能", "检查 MCP", "选择模型", "导出交接"]
    },
    status: {
      review: "审核",
      pending: "待审核",
      passed: "通过",
      failed: "未通过"
    },
    sections: {
      brief: "结构化 LP 需求",
      preview: "预览",
      previewMode: "静态 iframe",
      pageSections: "页面区块",
      agentRun: "智能体运行与交付"
    },
    fields: {
      prompt: "提示词",
      objective: "目标",
      audience: "受众",
      offer: "优惠",
      primaryCta: "主 CTA"
    },
    run: {
      planner: ["规划员", "已将提示词拆解为结构化 LP 需求。"],
      builder: ["构建员", "已生成 index.html、styles.css 和 script.js。"],
      reviewer: ["审核员", "没有阻塞发布的问题。"],
      reviewerFindings: "个问题。",
      deployer: ["部署员", "已准备好交给代码仓库 PR 流程。"]
    },
    demo: {
      projectName: "春季活动",
      prompt: "为回访电商用户生成一个轻量级春季促销落地页。",
      objective: "将付费流量转化为春季活动购买。",
      audience: "对限时优惠敏感的回访电商客户。",
      offer: "周日前精选春季好物 75 折。",
      primaryCta: "立即选购"
    },
    exports: {
      handoff: "导出 PR 交接",
      singleHtml: "导出单文件 HTML",
      indexHtml: "导出 index.html",
      stylesCss: "导出 styles.css",
      scriptJs: "导出 script.js",
      handoffNextAction: "将这些文件应用到目标仓库分支，并打开对应代码平台的 PR。"
    }
  }
};
