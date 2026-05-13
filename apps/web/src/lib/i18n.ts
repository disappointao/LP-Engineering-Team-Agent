import type { ProjectFlowErrorCode, SkillFlowErrorCode } from "./workbench-store";

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
    newTask: string;
    projectsLabel: string;
    tasksLabel: string;
    taskTitles: string[];
  };
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    promptLabel: string;
    actionChips: string[];
  };
  entry: {
    title: string;
    placeholder: string;
    chips: string[];
    implicitProjectName: string;
    createStaticLp: string;
  };
  projectFlow: {
    createTitle: string;
    createDescription: string;
    projectNameLabel: string;
    projectNamePlaceholder: string;
    createProject: string;
    localPersistenceNote: string;
    emptyTitle: string;
    emptyDescription: string;
    promptLabel: string;
    errors: Record<ProjectFlowErrorCode, string>;
  };
  skillsView: {
    title: string;
    subtitle: string;
    activeProjectLabel: string;
    noProject: string;
    activeCount: (count: number) => string;
    createTitle: string;
    manifestLabel: string;
    manifestPlaceholder: string;
    contentLabel: string;
    contentPlaceholder: string;
    contentTypeLabel: string;
    markdown: string;
    plainText: string;
    createDraft: string;
    versionsTitle: string;
    boundTitle: string;
    validate: string;
    publish: string;
    bind: string;
    enable: string;
    disable: string;
    emptyVersions: string;
    emptyBound: string;
    statusLabels: Record<"draft" | "validated" | "published" | "deprecated" | "archived", string>;
    errors: Record<SkillFlowErrorCode, string>;
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
  chat: {
    topbarModel: string;
    topbarShare: string;
    topbarTrial: string;
    assistantName: string;
    assistantBadge: string;
    userLabel: string;
    intro: string;
    generalIntro: string;
    generalToolLabel: string;
    generalToolOperation: string;
    generalToolMeta: string;
    completion: string;
    taskComplete: string;
    toolsTitle: string;
    artifactsTitle: string;
    suggestionsTitle: string;
    resultRating: string;
    allFilesLabel: string;
    previewTitle: string;
    composerPlaceholder: string;
    addAttachmentLabel: string;
    runtimeChip: string;
    interruptLabel: string;
    sendLabel: string;
    toolStatusComplete: string;
    branchLabel: string;
    findingsLabel: string;
    filesLabel: string;
    artifactKinds: {
      handoff: string;
      single: string;
      static: string;
    };
    suggestions: string[];
    generalSuggestions: string[];
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
      localeLabel: "Language",
      newTask: "New task",
      projectsLabel: "Project",
      tasksLabel: "All tasks",
      taskTitles: [
        "Generate a simple static HTML LP",
        "Create a personal blog landing page"
      ]
    },
    hero: {
      eyebrow: "Ecommerce LP agent",
      title: "What LP should we build?",
      subtitle: "Brief, generate, review, and hand off framework-free landing pages with scoped skills and provider-ready runtime context.",
      promptLabel: "Current task",
      actionChips: ["Build LP", "Apply skill", "Check MCP", "Route model", "Export handoff"]
    },
    entry: {
      title: "What can I help you build?",
      placeholder: "Assign a task or ask anything",
      chips: ["Create static LP", "Plan a campaign", "Create website", "Design", "More"],
      implicitProjectName: "Untitled LP Project",
      createStaticLp: "Create static LP"
    },
    projectFlow: {
      createTitle: "Create a project",
      createDescription: "Start with a local project, then ask the LP agent to generate static files.",
      projectNameLabel: "Project name",
      projectNamePlaceholder: "Spring Campaign",
      createProject: "Create project",
      localPersistenceNote: "Local Web MVP state is saved on this machine under .lp-agent/.",
      emptyTitle: "Project ready",
      emptyDescription: "Send an LP request to generate a brief, static artifacts, review, and downloadable files.",
      promptLabel: "LP request",
      errors: {
        project_name_required: "Enter a project name.",
        prompt_required: "Enter an LP request.",
        project_not_found: "The selected project is no longer available.",
        generation_failed: "The LP generation flow failed. Try again with a shorter request."
      }
    },
    skillsView: {
      title: "Project skills",
      subtitle: "Create, validate, publish, and bind data-only skills for the active project.",
      activeProjectLabel: "Active project",
      noProject: "No active project",
      activeCount: (count) => `${count} active ${count === 1 ? "skill" : "skills"}`,
      createTitle: "Create skill draft",
      manifestLabel: "Manifest JSON",
      manifestPlaceholder: JSON.stringify(
        {
          id: "skill_brand",
          name: "Acme Brand Landing Page Sections",
          version: "0.1.0",
          type: "template",
          scope: "project",
          description: "Adds brand tone and ecommerce LP constraints.",
          permissions: ["brief:read", "artifact:write"],
          requiredSecrets: [],
          entrypoints: ["templates/acme-lp.md"],
          reviewState: "draft"
        },
        null,
        2
      ),
      contentLabel: "Skill content",
      contentPlaceholder: "# Brand LP\n\nUse concise section copy and keep the output framework-free.",
      contentTypeLabel: "Content type",
      markdown: "Markdown",
      plainText: "Plain text",
      createDraft: "Create draft",
      versionsTitle: "Skill versions",
      boundTitle: "Bound project skills",
      validate: "Validate",
      publish: "Publish",
      bind: "Bind",
      enable: "Enable",
      disable: "Disable",
      emptyVersions: "No skill versions yet.",
      emptyBound: "No project skills bound yet.",
      statusLabels: {
        draft: "Draft",
        validated: "Validated",
        published: "Published",
        deprecated: "Deprecated",
        archived: "Archived"
      },
      errors: {
        invalid_manifest_json: "Enter valid manifest JSON.",
        manifest_validation_failed: "The skill manifest failed validation.",
        unsupported_skill_scope: "Only project-scoped skills are supported.",
        duplicate_skill_version: "That skill version already exists.",
        unsupported_content_type: "Choose a supported content type.",
        skill_content_required: "Enter skill content.",
        skill_content_too_large: "Skill content is too large.",
        project_not_found: "The selected project is no longer available.",
        skill_version_not_found: "The selected skill version is no longer available.",
        skill_version_not_validated: "Validate the skill version before publishing.",
        skill_version_not_published: "Publish the skill version before binding it.",
        skill_binding_not_found: "The selected skill binding is no longer available.",
        publish_not_allowed: "This skill version cannot be published yet.",
        skill_operation_failed: "The skill operation failed. Try again."
      }
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
    chat: {
      topbarModel: "LP Agent Lite",
      topbarShare: "Share",
      topbarTrial: "Start trial",
      assistantName: "LP Agent",
      assistantBadge: "Lite",
      userLabel: "You",
      intro: "I will turn this request into a framework-free landing page and show the agent steps as they run.",
      generalIntro: "I created a normal task thread. You can continue the conversation from here.",
      generalToolLabel: "Assistant",
      generalToolOperation: "Created a general task thread.",
      generalToolMeta: "No project required",
      completion: "The landing page is ready as static HTML/CSS/JS. You can download the single HTML file or the separated files.",
      taskComplete: "Task complete",
      toolsTitle: "Agent process",
      artifactsTitle: "Generated files",
      suggestionsTitle: "Suggested next prompts",
      resultRating: "How is this result?",
      allFilesLabel: "View all files in this task",
      previewTitle: "Static LP preview",
      composerPlaceholder: "Message LP Agent",
      addAttachmentLabel: "Add context",
      runtimeChip: "Cloud runtime",
      interruptLabel: "Interrupt",
      sendLabel: "Send",
      toolStatusComplete: "Complete",
      branchLabel: "Branch",
      findingsLabel: "Findings",
      filesLabel: "Files",
      artifactKinds: {
        handoff: "PR handoff",
        single: "single HTML",
        static: "static file"
      },
      suggestions: [
        "Add a contact form to this HTML page",
        "Adjust the copy for a premium ecommerce audience",
        "Tighten the mobile hero copy and CTA"
      ],
      generalSuggestions: [
        "Turn this into a checklist",
        "Make this more concise",
        "Create an LP from this idea"
      ]
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
      localeLabel: "语言",
      newTask: "新建任务",
      projectsLabel: "项目",
      tasksLabel: "所有任务",
      taskTitles: [
        "生成一个简单静态 HTML 落地页",
        "生成个人博客落地页"
      ]
    },
    hero: {
      eyebrow: "电商 LP 智能体",
      title: "我能帮你生成什么 LP？",
      subtitle: "从需求拆解、页面生成、审核到部署交接，生成物保持框架无关的静态 HTML/CSS/JS。",
      promptLabel: "当前任务",
      actionChips: ["生成 LP", "应用技能", "检查 MCP", "选择模型", "导出交接"]
    },
    entry: {
      title: "我能为你做什么？",
      placeholder: "分配一个任务或提问任何问题",
      chips: ["创建静态 LP", "策划活动", "创建网站", "设计", "更多"],
      implicitProjectName: "未命名 LP 项目",
      createStaticLp: "创建静态 LP"
    },
    projectFlow: {
      createTitle: "创建项目",
      createDescription: "先创建本地项目，然后让 LP Agent 生成静态文件。",
      projectNameLabel: "项目名称",
      projectNamePlaceholder: "春季活动",
      createProject: "创建项目",
      localPersistenceNote: "Web MVP 状态会保存在这台电脑的 .lp-agent/ 本地状态目录中。",
      emptyTitle: "项目已就绪",
      emptyDescription: "发送 LP 需求后会生成 brief、静态文件、审核结果和可下载文件。",
      promptLabel: "LP 需求",
      errors: {
        project_name_required: "请输入项目名称。",
        prompt_required: "请输入 LP 需求。",
        project_not_found: "当前项目已经不可用。",
        generation_failed: "LP 生成流程失败，请换一个更短的需求重试。"
      }
    },
    skillsView: {
      title: "项目技能",
      subtitle: "为当前项目创建、校验、发布并绑定仅包含数据的技能。",
      activeProjectLabel: "当前项目",
      noProject: "暂无当前项目",
      activeCount: (count) => `${count} 个启用技能`,
      createTitle: "创建技能草稿",
      manifestLabel: "Manifest JSON",
      manifestPlaceholder: JSON.stringify(
        {
          id: "skill_brand",
          name: "Acme 品牌落地页区块",
          version: "0.1.0",
          type: "template",
          scope: "project",
          description: "补充品牌语气和电商 LP 约束。",
          permissions: ["brief:read", "artifact:write"],
          requiredSecrets: [],
          entrypoints: ["templates/acme-lp.md"],
          reviewState: "draft"
        },
        null,
        2
      ),
      contentLabel: "技能内容",
      contentPlaceholder: "# 品牌 LP\n\n使用简洁区块文案，并保持输出不依赖框架。",
      contentTypeLabel: "内容类型",
      markdown: "Markdown",
      plainText: "纯文本",
      createDraft: "创建草稿",
      versionsTitle: "技能版本",
      boundTitle: "已绑定项目技能",
      validate: "校验",
      publish: "发布",
      bind: "绑定",
      enable: "启用",
      disable: "停用",
      emptyVersions: "暂无技能版本。",
      emptyBound: "暂无已绑定项目技能。",
      statusLabels: {
        draft: "草稿",
        validated: "已校验",
        published: "已发布",
        deprecated: "已废弃",
        archived: "已归档"
      },
      errors: {
        invalid_manifest_json: "请输入有效的 manifest JSON。",
        manifest_validation_failed: "技能 manifest 校验失败。",
        unsupported_skill_scope: "当前仅支持项目范围技能。",
        duplicate_skill_version: "该技能版本已经存在。",
        unsupported_content_type: "请选择支持的内容类型。",
        skill_content_required: "请输入技能内容。",
        skill_content_too_large: "技能内容过大。",
        project_not_found: "当前项目已经不可用。",
        skill_version_not_found: "当前技能版本已经不可用。",
        skill_version_not_validated: "请先校验技能版本再发布。",
        skill_version_not_published: "请先发布技能版本再绑定。",
        skill_binding_not_found: "当前技能绑定已经不可用。",
        publish_not_allowed: "该技能版本暂不能发布。",
        skill_operation_failed: "技能操作失败，请重试。"
      }
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
    chat: {
      topbarModel: "LP Agent Lite",
      topbarShare: "分享",
      topbarTrial: "开始免费试用",
      assistantName: "LP Agent",
      assistantBadge: "Lite",
      userLabel: "你",
      intro: "我会把这个需求转换成框架无关的落地页，并在对话里展示智能体执行过程。",
      generalIntro: "我已经创建了一个普通任务对话，你可以继续补充上下文。",
      generalToolLabel: "助手",
      generalToolOperation: "已创建普通任务对话。",
      generalToolMeta: "无需项目",
      completion: "落地页已经生成静态 HTML/CSS/JS。你可以下载单文件 HTML，也可以下载分离文件。",
      taskComplete: "任务已完成",
      toolsTitle: "智能体过程",
      artifactsTitle: "生成文件",
      suggestionsTitle: "推荐追问",
      resultRating: "这个结果怎么样？",
      allFilesLabel: "查看此任务中的所有文件",
      previewTitle: "静态 LP 预览",
      composerPlaceholder: "发送消息给 LP Agent",
      addAttachmentLabel: "添加上下文",
      runtimeChip: "云端运行时",
      interruptLabel: "打断",
      sendLabel: "发送",
      toolStatusComplete: "完成",
      branchLabel: "分支",
      findingsLabel: "问题",
      filesLabel: "文件",
      artifactKinds: {
        handoff: "PR 交接",
        single: "单文件 HTML",
        static: "静态文件"
      },
      suggestions: [
        "为这个 HTML 页面添加联系表单",
        "把文案调整成高客单价电商风格",
        "优化移动端首屏文案和 CTA"
      ],
      generalSuggestions: [
        "整理成执行清单",
        "把内容写得更简洁",
        "基于这个想法生成 LP"
      ]
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
