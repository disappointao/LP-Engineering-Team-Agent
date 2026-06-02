import type { ChatStreamErrorCode } from "./chat-stream";
import type {
  InterruptFlowErrorCode,
  MCPFlowErrorCode,
  ModelFlowErrorCode,
  ProjectFlowErrorCode,
  SkillFlowErrorCode,
  WorkerQueueFlowErrorCode
} from "./workbench-store";

export type Locale = "en" | "zh-CN";

type MCPManagementCopySummary = {
  connectorCount: number;
  enabledConnectorCount: number;
  visibleToolCount: number;
  executionEligibleToolCount: number;
};

type MCPManagementStatusCopyKey =
  | "configured"
  | "disabled"
  | "invalid_definition"
  | "approval_required"
  | "no_visible_tools"
  | "execution_not_available";

type MCPManagementApprovalStateCopyKey = "not_required" | "pending" | "approved";

type MCPManagementPendingCopyKey = "create" | "enable" | "disable" | "approval" | "execute";

export interface ExportLabels {
  handoff: string;
  singleHtml: string;
  separatedFiles: string;
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
    artifacts: string;
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
    emptyTasks: string;
    deleteProject: string;
    deleteTask: string;
    deletePending: string;
    deleteProjectAria: (name: string) => string;
    deleteTaskAria: (title: string) => string;
    deleteProjectConfirm: (name: string) => string;
    deleteTaskConfirm: (title: string) => string;
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
  interruptFlow: {
    errors: Record<InterruptFlowErrorCode, string>;
  };
  collaboration: {
    title: string;
    localIdentity: string;
    localUser: string;
    empty: string;
    roleLabels: Record<"owner" | "admin" | "member" | "reviewer", string>;
  };
  skillsView: {
    title: string;
    subtitle: string;
    alphaNotice: string;
    activeProjectLabel: string;
    noProject: string;
    activeCount: (count: number) => string;
    createTitle: string;
    manifestLabel: string;
    manifestPlaceholder: string;
    contentLabel: string;
    contentPlaceholder: string;
    contentFileLabel: string;
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
    commandsTitle: string;
    commandsSubtitle: string;
    commandPermissionLabel: string;
    commandApprovalRequired: string;
    commandApprovalNotRequired: string;
    commandSimulationLabel: string;
    commandQueueNotice: string;
    approveAndSimulate: string;
    approveAndQueue: string;
    commandQueueLabel: string;
    runLocalWorkerOnce: string;
    localWorkerIdle: string;
    workerQueueCounts: Record<
      "queued" | "running" | "stale" | "completed" | "failed" | "rejected" | "cancelled",
      string
    >;
    workerHeartbeatLabel: string;
    workerHeartbeatWorkerLabel: string;
    workerHeartbeatJobLabel: string;
    workerHeartbeatStatuses: Record<"active" | "idle" | "stale" | "unknown", string>;
    workerRecentLogsTitle: string;
    workerNoRecentLogs: string;
    emptyCommands: string;
    statusLabels: Record<"draft" | "validated" | "published" | "deprecated" | "archived", string>;
    errors: Record<SkillFlowErrorCode, string>;
    workerErrors: Record<WorkerQueueFlowErrorCode, string>;
    management: {
      runtimeSummaryTitle: string;
      lifecycleTitle: string;
      createPolicyTitle: string;
      versionsSummaryTitle: string;
      bindingSummaryTitle: string;
      commandSummaryTitle: string;
      noRawContentNotice: string;
      runtimeSummary: (activeCount: number, commandCount: number) => string;
      lifecycleStages: Record<
        "draft" | "validated" | "published" | "enabled" | "disabled" | "inactive",
        string
      >;
      nextActions: Record<
        "validate" | "publish" | "bind" | "enable" | "disable" | "none",
        string
      >;
      notices: Record<
        | "draft_created"
        | "validated"
        | "published"
        | "bound"
        | "enabled"
        | "disabled"
        | "command_queued"
        | "worker_ran",
        string
      >;
      pending: Record<
        | "createDraft"
        | "validate"
        | "publish"
        | "bind"
        | "enable"
        | "disable"
        | "queueCommand"
        | "runWorker",
        string
      >;
      policyItems: string[];
    };
  };
  mcpView: {
    title: string;
    subtitle: string;
    deferredNotice: string;
    activeProjectLabel: string;
    noProject: string;
    createTitle: string;
    definitionLabel: string;
    definitionPlaceholder: string;
    createConnector: string;
    connectorsTitle: string;
    toolsTitle: string;
    visibleToolsTitle: string;
    invalidConnectorName: string;
    enabled: string;
    disabled: string;
    enable: string;
    disable: string;
    approve: string;
    revoke: string;
    executeReadOnly: string;
    argumentsLabel: string;
    argumentsPlaceholder: string;
    writeToolUnavailable: string;
    approvalRequired: string;
    approvalNotRequired: string;
    permissionLabel: string;
    permissionSummary: (permission: string) => string;
    rolesLabel: string;
    rolesSummary: (roles: string[]) => string;
    emptyConnectors: string;
    emptyVisibleTools: string;
    roleLabels: Record<"assistant" | "planner" | "builder" | "reviewer" | "deployer", string>;
    management: {
      runtimeSummaryTitle: string;
      safeProjectionNotice: string;
      connectorDefinitionHint: string;
      summary: (summary: MCPManagementCopySummary) => string;
      runtimeSummary: (summary: MCPManagementCopySummary) => string;
      toolCount: (count: number) => string;
      policyItems: string[];
      statusLabels: Record<MCPManagementStatusCopyKey, string>;
      approvalStates: Record<MCPManagementApprovalStateCopyKey, string>;
      pending: Record<MCPManagementPendingCopyKey, string>;
    };
    errors: Record<MCPFlowErrorCode, string>;
  };
  modelsView: {
    title: string;
    subtitle: string;
    optInNotice: string;
    failClosedNotice: string;
    activeProjectLabel: string;
    noProject: string;
    providerCreateTitle: string;
    providerIdLabel: string;
    providerNameLabel: string;
    providerTypeLabel: string;
    providerApiLabel: string;
    baseUrlLabel: string;
    secretEnvNameLabel: string;
    apiKeyEnvLabel: string;
    providerModelIdLabel: string;
    baseUrlConfigured: string;
    apiKeyEnvConfigured: string;
    createProvider: string;
    providersTitle: string;
    routesTitle: string;
    resolvedTitle: string;
    enabled: string;
    disabled: string;
    enable: string;
    disable: string;
    modelLabel: string;
    saveRoute: string;
    fallbackLabel: string;
    roleLabels: Record<"assistant" | "planner" | "builder" | "reviewer" | "deployer", string>;
    providerTypes: Record<"mock" | "openai" | "anthropic" | "internal" | "custom", string>;
    providerApis: Record<"mock" | "openai-completions" | "anthropic-messages", string>;
    errors: Record<ModelFlowErrorCode, string>;
    management: {
      projectSummaryTitle: string;
      localRunChecklistTitle: string;
      localRunChecklistItems: Record<"realProvider" | "chatRoute" | "lpRoutes", string>;
      localRunChecklistStates: Record<"ready" | "blocked", string>;
      localRunChecklistDetails: Record<
        "realProvider" | "chatRoute" | "lpRoutes",
        Record<"ready" | "blocked", string>
      >;
      providerSummaryTitle: string;
      routeSummaryTitle: string;
      resolvedSummaryTitle: string;
      secretReferenceHint: string;
      safeMetadataNote: string;
      optInRuntimeNote: string;
      providerCount: (enabledCount: number, totalCount: number) => string;
      routeCount: (configuredCount: number, totalCount: number) => string;
      notices: Record<
        "provider_created" | "provider_enabled" | "provider_disabled" | "route_saved",
        string
      >;
      pending: Record<"createProvider" | "enable" | "disable" | "saveRoute", string>;
      providerStates: Record<"enabled" | "disabled", string>;
      routeStates: Record<"configured" | "fallback" | "failClosed", string>;
      metadataStates: Record<"configured" | "notConfigured", string>;
    };
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
    builderModelRoute: (route: string) => string;
    assistantModelRoute: (route: string) => string;
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
    artifactWorkspaceTitle: string;
    artifactWorkspaceSubtitle: string;
    artifactWorkspaceEmptyTitle: string;
    artifactWorkspaceEmptyDescription: string;
    artifactWorkspaceManifestTitle: string;
    artifactWorkspaceExportTitle: string;
    artifactWorkspaceOpenLabel: string;
    artifactPreviewDrawerOpenLabel: string;
    artifactPreviewDrawerCloseLabel: string;
    artifactPreviewWorkspaceOpenLabel: string;
    artifactPreviewWorkspaceInspectLabel: string;
    artifactPreviewWorkspaceInspectActiveLabel: string;
    artifactPreviewWorkspaceSelectedEmptyLabel: string;
    artifactPreviewWorkspaceSelectedLabel: string;
    artifactPreviewWorkspaceClearSelectionLabel: string;
    artifactWorkspaceUnavailableLabel: string;
    suggestionsTitle: string;
    resultRating: string;
    allFilesLabel: string;
    previewTitle: string;
    composerPlaceholder: string;
    addAttachmentLabel: string;
    runtimeChip: string;
    interruptLabel: string;
    interruptStoppingLabel: string;
    interruptUnavailableLabel: string;
    streamingStatusLabel: string;
    streamingErrorLabel: string;
    streamingErrorMessages: Record<ChatStreamErrorCode, string>;
    liveTaskTitle: string;
    liveTaskIdle: string;
    liveTaskRunning: string;
    liveTaskCompleted: string;
    liveTaskArtifactReady: string;
    liveTaskRefreshError: string;
    recoveryTitle: string;
    recoverySubtitle: string;
    recoveryStateLabels: Record<
      | "queued"
      | "running"
      | "waiting_for_approval"
      | "blocked"
      | "cancelling"
      | "cancelled"
      | "failed"
      | "completed",
      string
    >;
    recoveryActionLabels: Record<"resume_worker_finalization" | "retry_run", string>;
    recoveryGuidanceLabels: Record<
      "request_approval" | "resolve_blocker" | "inspect_manually",
      string
    >;
    recoveryErrorLabel: string;
    runTimelineTitle: string;
    runTimelineSubtitle: string;
    runTimelinePending: string;
    runTimelineActive: string;
    runTimelineActionGroupLabels: Record<"executable" | "guidance", string>;
    runTimelineMarkerLabels: Record<
      | "repair_started"
      | "repaired"
      | "repair_failed"
      | "retry_scheduled"
      | "retry_exhausted"
      | "retry_attempt"
      | "handoff_ready"
      | "handoff_consumed"
      | "handoff_blocked",
      string
    >;
    sendLabel: string;
    toolStatusRunning: string;
    toolStatusComplete: string;
    toolStatusCancelled: string;
    branchLabel: string;
    findingsLabel: string;
    filesLabel: string;
    artifactChangesTitle: string;
    artifactVersionInitial: string;
    artifactPreviousVersionLabel: string;
    artifactCurrentVersionLabel: string;
    artifactHashLabel: string;
    previewSnippetLabel: string;
    snippetPreviewTitle: string;
    snippetSizeLimitMessage: string;
    snippetUnavailableMessage: string;
    bytesLabel: (bytes: number) => string;
    artifactDiffStateLabels: Record<"initial" | "added" | "removed" | "changed" | "unchanged", string>;
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
      artifacts: "Artifacts",
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
      emptyTasks: "No tasks yet. Start from the composer or a quick prompt.",
      deleteProject: "Delete",
      deleteTask: "Delete",
      deletePending: "Deleting...",
      deleteProjectAria: (name) => `Delete project ${name}`,
      deleteTaskAria: (title) => `Delete task ${title}`,
      deleteProjectConfirm: (name) =>
        `Delete project "${name}" and all tasks in it? This cannot be undone.`,
      deleteTaskConfirm: (title) => `Delete task "${title}"? This cannot be undone.`
    },
    hero: {
      eyebrow: "Ecommerce LP agent",
      title: "What LP should we build?",
      subtitle: "Brief, generate, review, and hand off framework-free landing pages with scoped skills and provider-ready runtime context.",
      promptLabel: "Current task",
      actionChips: ["Build LP", "Apply skill", "Review artifacts", "Route model", "Export handoff"]
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
        generation_failed: "The LP generation flow failed. Try again with a shorter request.",
        provider_configuration_failed:
          "The model provider is not ready. Check the project model settings."
      }
    },
    interruptFlow: {
      errors: {
        task_not_found: "No current task to interrupt.",
        task_not_interruptible: "Nothing is running for this task.",
        interrupt_target_not_found: "The running task could not be found.",
        interrupt_failed: "Unable to interrupt this task."
      }
    },
    collaboration: {
      title: "Project members",
      localIdentity: "Local identity",
      localUser: "Local user",
      empty: "No members recorded for this project yet.",
      roleLabels: {
        owner: "Owner",
        admin: "Admin",
        member: "Member",
        reviewer: "Reviewer"
      }
    },
    skillsView: {
      title: "Project skills",
      subtitle: "Create, validate, publish, and bind data-only skills for the active project.",
      alphaNotice: "Skill-only alpha: published and bound skills are the primary extension path for chat and LP tasks.",
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
      contentFileLabel: "Upload .md or .txt",
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
      commandsTitle: "Skill Commands",
      commandsSubtitle: "Queue published deployment skill commands for the local worker.",
      commandPermissionLabel: "Permission",
      commandApprovalRequired: "One-shot approval required",
      commandApprovalNotRequired: "Approval still required in this Web version",
      commandSimulationLabel: "Simulation only",
      commandQueueNotice: "Commands use approval, the local worker queue, and safe observations; they do not run arbitrary shell commands or real deployment.",
      approveAndSimulate: "Approve and simulate",
      approveAndQueue: "Approve and queue",
      commandQueueLabel: "Local worker queue",
      runLocalWorkerOnce: "Run local worker once",
      localWorkerIdle: "Run the local worker to process queued jobs.",
      workerQueueCounts: {
        queued: "Queued",
        running: "Running",
        stale: "Stale",
        completed: "Completed",
        failed: "Failed",
        rejected: "Rejected",
        cancelled: "Cancelled"
      },
      workerHeartbeatLabel: "Heartbeat",
      workerHeartbeatWorkerLabel: "Worker",
      workerHeartbeatJobLabel: "Job",
      workerHeartbeatStatuses: {
        active: "Active",
        idle: "Idle",
        stale: "Stale",
        unknown: "Unknown"
      },
      workerRecentLogsTitle: "Recent worker logs",
      workerNoRecentLogs: "No recent worker logs.",
      emptyCommands: "No executable deployment skill commands are bound to this project.",
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
        skill_binding_already_exists: "That skill version is already bound to this project.",
        unsupported_content_type: "Choose a supported content type.",
        skill_content_required: "Enter skill content.",
        skill_content_too_large: "Skill content is too large.",
        project_not_found: "The selected project is no longer available.",
        skill_version_not_found: "The selected skill version is no longer available.",
        skill_version_not_validated: "Validate the skill version before publishing.",
        skill_version_not_published: "Publish the skill version before binding it.",
        skill_binding_not_found: "The selected skill binding is no longer available.",
        publish_not_allowed: "This skill version cannot be published yet.",
        skill_operation_failed: "The skill operation failed. Try again.",
        skill_command_not_found: "The selected skill command is no longer available.",
        skill_command_not_bound: "This skill command is not bound to the current project.",
        skill_command_not_deployment: "This skill command is not a deployment command.",
        skill_command_not_published: "Publish the skill before running this command.",
        skill_command_permission_denied: "This skill command is not allowed.",
        skill_command_approval_required: "Approve this skill command before running it.",
        skill_command_not_queueable: "This skill command cannot be queued.",
        skill_command_page_version_not_found: "The selected page version is no longer available.",
        skill_command_unknown_template_variable: "The skill command has an unknown template variable.",
        skill_command_execution_failed: "The skill command failed. Try again."
      },
      workerErrors: {
        worker_runtime_not_configured: "Local worker runtime is not configured. Worker queue is unavailable.",
        worker_job_execution_failed: "Local worker job execution failed.",
        worker_job_finalization_failed: "Worker result could not be finalized."
      },
      management: {
        runtimeSummaryTitle: "Runtime context",
        lifecycleTitle: "Skill lifecycle",
        createPolicyTitle: "Draft input policy",
        versionsSummaryTitle: "Versions",
        bindingSummaryTitle: "Project bindings",
        commandSummaryTitle: "Deployment commands",
        noRawContentNotice: "Saved skill content is not echoed on this page.",
        runtimeSummary: (activeCount, commandCount) =>
          `${activeCount} active context ${activeCount === 1 ? "skill" : "skills"} · ${commandCount} queueable ${commandCount === 1 ? "command" : "commands"}`,
        lifecycleStages: {
          draft: "Draft",
          validated: "Validated",
          published: "Published",
          enabled: "Enabled",
          disabled: "Disabled",
          inactive: "Inactive"
        },
        nextActions: {
          validate: "Validate next",
          publish: "Publish next",
          bind: "Bind to project next",
          enable: "Enable for runtime",
          disable: "Disable from runtime",
          none: "No action available"
        },
        notices: {
          draft_created: "Skill draft saved.",
          validated: "Skill validated.",
          published: "Skill published.",
          bound: "Skill bound to the project.",
          enabled: "Skill enabled for runtime context.",
          disabled: "Skill disabled from runtime context.",
          command_queued: "Skill command queued.",
          worker_ran: "Local worker run completed."
        },
        pending: {
          createDraft: "Saving draft...",
          validate: "Validating...",
          publish: "Publishing...",
          bind: "Binding...",
          enable: "Enabling...",
          disable: "Disabling...",
          queueCommand: "Queuing...",
          runWorker: "Running worker..."
        },
        policyItems: [
          "Project-scoped manifest only.",
          "Markdown or plain text content under the local size cap.",
          "Published and enabled project-bound skills enter runtime context.",
          "Executable content and raw skill text are not shown after save."
        ]
      }
    },
    mcpView: {
      title: "Project MCP",
      subtitle: "Register project connectors, review tool visibility, and run approved read-only checks from one bounded surface.",
      deferredNotice: "MCP management is available for bounded connector metadata, approvals, and read-only checks; chat and LP generation still work without connectors.",
      activeProjectLabel: "Active project",
      noProject: "No active project",
      createTitle: "Create connector",
      definitionLabel: "Connector JSON",
      definitionPlaceholder: JSON.stringify(
        {
          id: "connector_assets",
          name: "Internal Assets",
          description: "Read approved asset metadata.",
          tools: [
            {
              name: "searchAssets",
              description: "Search approved brand assets.",
              permission: "assets:read",
              roles: ["planner", "builder", "reviewer"],
              requiresApproval: false
            }
          ]
        },
        null,
        2
      ),
      createConnector: "Create connector",
      connectorsTitle: "Connectors",
      toolsTitle: "Tools",
      visibleToolsTitle: "Visible tools",
      invalidConnectorName: "Invalid connector",
      enabled: "Enabled",
      disabled: "Disabled",
      enable: "Enable",
      disable: "Disable",
      approve: "Approve",
      revoke: "Revoke",
      executeReadOnly: "Run read-only check",
      argumentsLabel: "Arguments JSON",
      argumentsPlaceholder: "{\"query\":\"spring sale\"}",
      writeToolUnavailable: "Write tools are blocked in this stage.",
      approvalRequired: "Approval required",
      approvalNotRequired: "No approval required",
      permissionLabel: "Permission",
      permissionSummary: (permission) => `Permission: ${permission}`,
      rolesLabel: "Roles",
      rolesSummary: (roles) => `Roles: ${roles.join(", ")}`,
      emptyConnectors: "No project MCP connectors yet.",
      emptyVisibleTools: "No visible tools for this role.",
      roleLabels: {
        assistant: "Assistant",
        planner: "Planner",
        builder: "Builder",
        reviewer: "Reviewer",
        deployer: "Deployer"
      },
      management: {
        runtimeSummaryTitle: "MCP runtime projection",
        safeProjectionNotice:
          "MCP management shows bounded connector and tool metadata. Raw outputs and raw arguments stay outside the Web surface.",
        connectorDefinitionHint:
          "Connector definitions should contain project-scoped metadata and tool policy only.",
        summary: (summary) =>
          `${summary.connectorCount} ${summary.connectorCount === 1 ? "connector" : "connectors"} · ${summary.visibleToolCount} ${summary.visibleToolCount === 1 ? "visible tool" : "visible tools"} · ${summary.executionEligibleToolCount} ${summary.executionEligibleToolCount === 1 ? "read-only check" : "read-only checks"}`,
        runtimeSummary: (summary) =>
          `${summary.enabledConnectorCount} ${summary.enabledConnectorCount === 1 ? "enabled connector is" : "enabled connectors are"} evaluated against current project skills, role permissions, approvals, and read-only policy.`,
        toolCount: (count) => `${count} ${count === 1 ? "tool" : "tools"}`,
        policyItems: [
          "Visible tools come from backend role, permission, approval, and connector state.",
          "Read-only checks submit no browser-provided raw argument JSON.",
          "Failures render stable diagnostics and fail closed."
        ],
        statusLabels: {
          configured: "Configured",
          disabled: "Disabled",
          invalid_definition: "Invalid definition",
          approval_required: "Approval required",
          no_visible_tools: "No visible tools",
          execution_not_available: "Execution unavailable"
        },
        approvalStates: {
          not_required: "No approval required",
          pending: "Pending approval",
          approved: "Approved"
        },
        pending: {
          create: "Saving connector...",
          enable: "Enabling...",
          disable: "Disabling...",
          approval: "Updating approval...",
          execute: "Running check..."
        }
      },
      errors: {
        project_not_found: "The selected project is no longer available.",
        mcp_connector_json_invalid: "Enter valid connector JSON.",
        mcp_connector_validation_failed: "Connector JSON must include id, name, and valid tools.",
        mcp_connector_scope_unsupported: "Only project-scoped connectors are supported in this version.",
        mcp_connector_already_exists: "A connector with this id already exists.",
        mcp_connector_not_found: "The connector was not found for this project.",
        mcp_tool_not_found: "The selected MCP tool was not found.",
        mcp_tool_approval_not_required: "This tool does not require approval.",
        mcp_tool_not_visible: "The selected MCP tool is not visible for this role.",
        mcp_tool_execution_not_read_only: "Only read-only MCP tools can run in this stage.",
        mcp_tool_execution_approval_required: "Approve this MCP tool before running it.",
        mcp_tool_execution_rejected: "The MCP executor rejected the tool run.",
        mcp_tool_execution_failed: "The MCP tool run failed.",
        mcp_tool_arguments_invalid: "Enter arguments as a JSON object.",
        mcp_executor_not_configured: "The MCP executor is not configured.",
        mcp_operation_failed: "The MCP operation failed."
      }
    },
    modelsView: {
      title: "Project models",
      subtitle: "Configure project-scoped model providers and role routes without storing raw secrets.",
      optInNotice: "Real providers are opt-in. Default alpha checks use deterministic routes and do not require API keys.",
      failClosedNotice: "If a provider or route is missing, the runtime fails closed instead of silently treating a real call as successful.",
      activeProjectLabel: "Active project",
      noProject: "No active project",
      providerCreateTitle: "Create model provider",
      providerIdLabel: "Provider key",
      providerNameLabel: "Display name",
      providerTypeLabel: "Provider type",
      providerApiLabel: "API protocol",
      baseUrlLabel: "Base URL",
      secretEnvNameLabel: "Secret env var",
      apiKeyEnvLabel: "API key env var",
      providerModelIdLabel: "Default model id",
      baseUrlConfigured: "Base URL configured",
      apiKeyEnvConfigured: "API key env configured",
      createProvider: "Create provider",
      providersTitle: "Providers",
      routesTitle: "Role routes",
      resolvedTitle: "Resolved routes",
      enabled: "Enabled",
      disabled: "Disabled",
      enable: "Enable",
      disable: "Disable",
      modelLabel: "Model ID",
      saveRoute: "Save route",
      fallbackLabel: "Fallback",
      roleLabels: {
        assistant: "Assistant",
        planner: "Planner",
        builder: "Builder",
        reviewer: "Reviewer",
        deployer: "Deployer"
      },
      providerTypes: {
        mock: "Mock",
        openai: "OpenAI",
        anthropic: "Anthropic",
        internal: "Internal",
        custom: "Custom"
      },
      providerApis: {
        mock: "Mock",
        "openai-completions": "OpenAI Chat Completions compatible",
        "anthropic-messages": "Anthropic Messages compatible"
      },
      errors: {
        project_not_found: "The selected project is no longer available.",
        model_provider_name_required: "Enter a provider display name.",
        model_provider_key_required: "Enter a provider key using letters, numbers, hyphens, or underscores.",
        model_provider_type_unsupported: "Choose a supported provider type.",
        model_provider_api_required: "Choose a provider API protocol.",
        model_provider_api_unsupported: "Choose a supported provider API protocol.",
        model_provider_base_url_invalid: "Enter a valid provider base URL.",
        model_provider_api_key_env_invalid: "Use an environment variable name for the provider API key.",
        model_provider_model_id_required: "Enter a provider model id.",
        model_provider_model_limit_invalid: "Configure at least one provider model.",
        model_provider_already_exists: "That provider key already exists.",
        model_provider_not_found: "The selected provider is no longer available.",
        model_provider_disabled: "Enable the provider before routing a role to it.",
        model_provider_in_use: "Remove project role routes before disabling this provider.",
        model_role_unsupported: "Choose a supported role.",
        model_id_required: "Enter a model id.",
        model_route_not_found: "The selected model route is no longer available.",
        model_route_provider_invalid: "The route points to an unavailable provider.",
        model_secret_reference_invalid: "Use an environment variable name, not a secret value.",
        model_routing_operation_failed: "The model routing operation failed. Try again."
      },
      management: {
        projectSummaryTitle: "Project model summary",
        localRunChecklistTitle: "Local real-provider run checklist",
        localRunChecklistItems: {
          realProvider: "Provider ready",
          chatRoute: "Chat ready",
          lpRoutes: "LP generation ready"
        },
        localRunChecklistStates: {
          ready: "Ready",
          blocked: "Not ready"
        },
        localRunChecklistDetails: {
          realProvider: {
            ready: "An enabled real provider has endpoint metadata, a secret reference, and at least one model.",
            blocked: "Add an enabled real provider with endpoint metadata, a secret reference, and at least one model."
          },
          chatRoute: {
            ready: "The assistant route points at a ready real provider.",
            blocked: "Route assistant to a ready real provider for local chat."
          },
          lpRoutes: {
            ready: "Planner and builder routes point at ready real providers; reviewer and deployer may stay deterministic.",
            blocked: "Route planner and builder to ready real providers for local LP runs."
          }
        },
        providerSummaryTitle: "Provider configuration",
        routeSummaryTitle: "Role routing",
        resolvedSummaryTitle: "Resolved runtime routes",
        secretReferenceHint: "Environment variable reference",
        safeMetadataNote:
          "Secret values are never shown. The page stores provider metadata and environment variable names only.",
        optInRuntimeNote:
          "Real provider calls still require REAL_MODEL_RUNTIME=1 and configured environment variables.",
        providerCount: (enabledCount, totalCount) =>
          `${enabledCount} enabled of ${totalCount} ${totalCount === 1 ? "provider" : "providers"}`,
        routeCount: (configuredCount, totalCount) =>
          `${configuredCount} configured of ${totalCount} ${totalCount === 1 ? "route" : "routes"}`,
        notices: {
          provider_created: "Model provider saved.",
          provider_enabled: "Model provider enabled.",
          provider_disabled: "Model provider disabled.",
          route_saved: "Model route saved."
        },
        pending: {
          createProvider: "Saving provider...",
          enable: "Enabling...",
          disable: "Disabling...",
          saveRoute: "Saving route..."
        },
        providerStates: {
          enabled: "Enabled",
          disabled: "Disabled"
        },
        routeStates: {
          configured: "Configured",
          fallback: "Deterministic fallback",
          failClosed: "Fail closed"
        },
        metadataStates: {
          configured: "Configured",
          notConfigured: "Not configured"
        }
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
      builderModelRoute: (route) => `Builder model: ${route}`,
      assistantModelRoute: (route) => `Assistant model: ${route}`,
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
      artifactsTitle: "Generated page",
      artifactWorkspaceTitle: "Artifact workspace",
      artifactWorkspaceSubtitle: "Inspect the current task's static LP files, preview, snippets, and exports.",
      artifactWorkspaceEmptyTitle: "No artifact workspace yet",
      artifactWorkspaceEmptyDescription: "Generate an LP task in the workbench to create static HTML, CSS, and JavaScript files.",
      artifactWorkspaceManifestTitle: "File manifest",
      artifactWorkspaceExportTitle: "Exports",
      artifactWorkspaceOpenLabel: "Open artifact workspace",
      artifactPreviewDrawerOpenLabel: "Preview and export",
      artifactPreviewDrawerCloseLabel: "Close preview",
      artifactPreviewWorkspaceOpenLabel: "Open preview",
      artifactPreviewWorkspaceInspectLabel: "Inspect elements",
      artifactPreviewWorkspaceInspectActiveLabel: "Inspecting",
      artifactPreviewWorkspaceSelectedEmptyLabel: "No element selected",
      artifactPreviewWorkspaceSelectedLabel: "Selected element",
      artifactPreviewWorkspaceClearSelectionLabel: "Clear selection",
      artifactWorkspaceUnavailableLabel: "Artifact workspace is unavailable.",
      suggestionsTitle: "Suggested next prompts",
      resultRating: "How is this result?",
      allFilesLabel: "View all files in this task",
      previewTitle: "Static LP preview",
      composerPlaceholder: "Message LP Agent",
      addAttachmentLabel: "Add context",
      runtimeChip: "Cloud runtime",
      interruptLabel: "Interrupt",
      interruptStoppingLabel: "Stopping...",
      interruptUnavailableLabel: "Nothing running",
      streamingStatusLabel: "Generating response",
      streamingErrorLabel: "The chat response could not be generated.",
      streamingErrorMessages: {
        prompt_required: "Enter a prompt before sending.",
        project_not_found: "The selected project is unavailable.",
        generation_failed: "The chat response could not be generated.",
        provider_configuration_failed: "Check the project model provider configuration before retrying.",
        provider_authentication_failed: "The model provider rejected authentication. Check the API key or permissions.",
        provider_billing_required:
          "The model provider rejected the request for billing or quota. Check provider usage or billing, then retry.",
        provider_rate_limited: "The model provider is rate limited. Wait a moment, then retry.",
        provider_unavailable: "The model provider is temporarily unavailable. Retry later.",
        provider_timeout: "The model provider timed out. Retry later.",
        provider_request_failed: "The model provider request failed. Check provider status, then retry.",
        provider_response_invalid: "The model provider returned a response format this app does not support yet.",
        stream_interrupted: "The provider stream stopped before the response completed.",
        empty_response: "The provider completed without usable assistant text.",
        persistence_failed: "The response was generated but could not be saved."
      },
      liveTaskTitle: "Live task progress",
      liveTaskIdle: "Waiting for task activity",
      liveTaskRunning: "Task is running",
      liveTaskCompleted: "Task facts are current",
      liveTaskArtifactReady: "Artifact workspace ready",
      liveTaskRefreshError: "Task progress could not be refreshed.",
      recoveryTitle: "Run recovery",
      recoverySubtitle: "Safe recovery options derived from the run lifecycle.",
      recoveryStateLabels: {
        queued: "Queued",
        running: "Running",
        waiting_for_approval: "Waiting approval",
        blocked: "Blocked",
        cancelling: "Stopping",
        cancelled: "Stopped",
        failed: "Failed",
        completed: "Completed"
      },
      recoveryActionLabels: {
        resume_worker_finalization: "Resume finalization",
        retry_run: "Retry run"
      },
      recoveryGuidanceLabels: {
        request_approval: "Request approval",
        resolve_blocker: "Resolve blocker",
        inspect_manually: "Inspect manually"
      },
      recoveryErrorLabel: "Recovery action could not be completed.",
      runTimelineTitle: "Run timeline",
      runTimelineSubtitle: "Planner to deployment handoff",
      runTimelinePending: "Not started",
      runTimelineActive: "Active",
      runTimelineActionGroupLabels: {
        executable: "Actions",
        guidance: "Guidance"
      },
      runTimelineMarkerLabels: {
        repair_started: "Repair started",
        repaired: "Repaired",
        repair_failed: "Repair failed",
        retry_scheduled: "Retry scheduled",
        retry_exhausted: "Retry exhausted",
        retry_attempt: "Retry attempt",
        handoff_ready: "Handoff ready",
        handoff_consumed: "Handoff consumed",
        handoff_blocked: "Handoff blocked"
      },
      sendLabel: "Send",
      toolStatusRunning: "Running",
      toolStatusComplete: "Complete",
      toolStatusCancelled: "Stopped",
      branchLabel: "Branch",
      findingsLabel: "Findings",
      filesLabel: "Files",
      artifactChangesTitle: "Artifact changes",
      artifactVersionInitial: "Initial version",
      artifactPreviousVersionLabel: "Previous",
      artifactCurrentVersionLabel: "Current",
      artifactHashLabel: "Hash",
      previewSnippetLabel: "Preview snippet",
      snippetPreviewTitle: "Snippet preview",
      snippetSizeLimitMessage: "Content is over the 8 KB preview limit.",
      snippetUnavailableMessage: "Snippet is unavailable.",
      bytesLabel: (bytes) => `${bytes.toLocaleString("en")} bytes`,
      artifactDiffStateLabels: {
        initial: "Initial",
        added: "Added",
        removed: "Removed",
        changed: "Changed",
        unchanged: "Unchanged"
      },
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
      separatedFiles: "Export HTML/CSS/JS ZIP",
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
      artifacts: "产物",
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
      emptyTasks: "还没有任务。可以从输入框或快捷提示开始。",
      deleteProject: "删除",
      deleteTask: "删除",
      deletePending: "删除中...",
      deleteProjectAria: (name) => `删除项目 ${name}`,
      deleteTaskAria: (title) => `删除任务 ${title}`,
      deleteProjectConfirm: (name) => `确定删除项目“${name}”以及其中所有任务吗？此操作不可撤销。`,
      deleteTaskConfirm: (title) => `确定删除任务“${title}”吗？此操作不可撤销。`
    },
    hero: {
      eyebrow: "电商 LP 智能体",
      title: "我能帮你生成什么 LP？",
      subtitle: "从需求拆解、页面生成、审核到部署交接，生成物保持框架无关的静态 HTML/CSS/JS。",
      promptLabel: "当前任务",
      actionChips: ["生成 LP", "应用技能", "检查产物", "选择模型", "导出交接"]
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
        generation_failed: "LP 生成流程失败，请换一个更短的需求重试。",
        provider_configuration_failed: "模型供应商尚未就绪，请检查项目模型设置。"
      }
    },
    interruptFlow: {
      errors: {
        task_not_found: "当前没有可打断的任务。",
        task_not_interruptible: "当前任务没有正在运行的内容。",
        interrupt_target_not_found: "没有找到正在运行的任务。",
        interrupt_failed: "无法打断当前任务。"
      }
    },
    collaboration: {
      title: "项目成员",
      localIdentity: "本地身份",
      localUser: "本地用户",
      empty: "当前项目还没有成员记录。",
      roleLabels: {
        owner: "负责人",
        admin: "管理员",
        member: "成员",
        reviewer: "审核员"
      }
    },
    skillsView: {
      title: "项目技能",
      subtitle: "为当前项目创建、校验、发布并绑定仅包含数据的技能。",
      alphaNotice: "Skill-only alpha：已发布并绑定的 Skill 是聊天和 LP 任务的主要扩展路径。",
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
      contentFileLabel: "上传 .md 或 .txt",
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
      commandsTitle: "技能命令",
      commandsSubtitle: "将已发布部署技能声明的命令加入本地 Worker 队列。",
      commandPermissionLabel: "权限",
      commandApprovalRequired: "需要一次性批准",
      commandApprovalNotRequired: "当前 Web 版本仍需要批准",
      commandSimulationLabel: "仅模拟执行",
      commandQueueNotice: "命令会经过批准、本地 Worker 队列和安全 observation；不会运行任意 shell 命令或真实部署。",
      approveAndSimulate: "批准并模拟执行",
      approveAndQueue: "批准并入队",
      commandQueueLabel: "本地 Worker 队列",
      runLocalWorkerOnce: "运行一次本地 Worker",
      localWorkerIdle: "运行本地 Worker 来处理排队任务。",
      workerQueueCounts: {
        queued: "排队中",
        running: "运行中",
        stale: "已过期",
        completed: "已完成",
        failed: "失败",
        rejected: "已拒绝",
        cancelled: "已取消"
      },
      workerHeartbeatLabel: "心跳",
      workerHeartbeatWorkerLabel: "Worker",
      workerHeartbeatJobLabel: "任务",
      workerHeartbeatStatuses: {
        active: "活跃",
        idle: "空闲",
        stale: "已过期",
        unknown: "未知"
      },
      workerRecentLogsTitle: "最近 Worker 日志",
      workerNoRecentLogs: "暂无 Worker 日志。",
      emptyCommands: "当前项目暂无已绑定的可执行部署技能命令。",
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
        skill_binding_already_exists: "该技能版本已经绑定到当前项目。",
        unsupported_content_type: "请选择支持的内容类型。",
        skill_content_required: "请输入技能内容。",
        skill_content_too_large: "技能内容过大。",
        project_not_found: "当前项目已经不可用。",
        skill_version_not_found: "当前技能版本已经不可用。",
        skill_version_not_validated: "请先校验技能版本再发布。",
        skill_version_not_published: "请先发布技能版本再绑定。",
        skill_binding_not_found: "当前技能绑定已经不可用。",
        publish_not_allowed: "该技能版本暂不能发布。",
        skill_operation_failed: "技能操作失败，请重试。",
        skill_command_not_found: "当前技能命令已经不可用。",
        skill_command_not_bound: "该技能命令未绑定到当前项目。",
        skill_command_not_deployment: "该技能命令不是部署命令。",
        skill_command_not_published: "请先发布技能再运行该命令。",
        skill_command_permission_denied: "该技能命令不允许执行。",
        skill_command_approval_required: "请先批准该技能命令再运行。",
        skill_command_not_queueable: "该技能命令无法加入队列。",
        skill_command_page_version_not_found: "当前页面版本已经不可用。",
        skill_command_unknown_template_variable: "该技能命令包含未知模板变量。",
        skill_command_execution_failed: "技能命令执行失败，请重试。"
      },
      workerErrors: {
        worker_runtime_not_configured: "本地 Worker runtime 未配置。",
        worker_job_execution_failed: "本地 Worker 任务执行失败。",
        worker_job_finalization_failed: "Worker 结果无法写回运行状态。"
      },
      management: {
        runtimeSummaryTitle: "运行上下文",
        lifecycleTitle: "技能生命周期",
        createPolicyTitle: "草稿输入规则",
        versionsSummaryTitle: "版本",
        bindingSummaryTitle: "项目绑定",
        commandSummaryTitle: "部署命令",
        noRawContentNotice: "已保存的技能正文不会在本页面回显。",
        runtimeSummary: (activeCount, commandCount) =>
          `${activeCount} 个启用上下文技能 · ${commandCount} 个可入队命令`,
        lifecycleStages: {
          draft: "草稿",
          validated: "已验证",
          published: "已发布",
          enabled: "已启用",
          disabled: "已停用",
          inactive: "已停用/归档"
        },
        nextActions: {
          validate: "下一步验证",
          publish: "下一步发布",
          bind: "下一步绑定到项目",
          enable: "启用到运行上下文",
          disable: "从运行上下文停用",
          none: "暂无可用操作"
        },
        notices: {
          draft_created: "技能草稿已保存。",
          validated: "技能已验证。",
          published: "技能已发布。",
          bound: "技能已绑定到项目。",
          enabled: "技能已启用到运行上下文。",
          disabled: "技能已从运行上下文停用。",
          command_queued: "技能命令已入队。",
          worker_ran: "本地 Worker 运行已完成。"
        },
        pending: {
          createDraft: "正在保存草稿...",
          validate: "正在验证...",
          publish: "正在发布...",
          bind: "正在绑定...",
          enable: "正在启用...",
          disable: "正在停用...",
          queueCommand: "正在入队...",
          runWorker: "正在运行 Worker..."
        },
        policyItems: [
          "仅支持项目级 manifest。",
          "Markdown 或纯文本内容必须低于本地大小限制。",
          "已发布、已启用并绑定到项目的技能会进入运行上下文。",
          "可执行内容和技能正文保存后不会在页面回显。"
        ]
      }
    },
    mcpView: {
      title: "项目 MCP",
      subtitle: "注册项目连接器，审查工具可见性，并在受限页面中执行已批准的只读检查。",
      deferredNotice: "MCP 管理页用于受限的连接器元数据、批准和只读检查；不配置连接器也可以继续聊天和生成 LP。",
      activeProjectLabel: "当前项目",
      noProject: "暂无当前项目",
      createTitle: "创建连接器",
      definitionLabel: "连接器 JSON",
      definitionPlaceholder: JSON.stringify(
        {
          id: "connector_assets",
          name: "内部素材",
          description: "读取已批准的素材元数据。",
          tools: [
            {
              name: "searchAssets",
              description: "搜索已批准的品牌素材。",
              permission: "assets:read",
              roles: ["planner", "builder", "reviewer"],
              requiresApproval: false
            }
          ]
        },
        null,
        2
      ),
      createConnector: "创建连接器",
      connectorsTitle: "连接器",
      toolsTitle: "工具",
      visibleToolsTitle: "可见工具",
      invalidConnectorName: "无效连接器",
      enabled: "已启用",
      disabled: "已停用",
      enable: "启用",
      disable: "停用",
      approve: "批准",
      revoke: "撤销",
      executeReadOnly: "执行只读检查",
      argumentsLabel: "参数 JSON",
      argumentsPlaceholder: "{\"query\":\"春季活动\"}",
      writeToolUnavailable: "当前阶段已阻止写工具。",
      approvalRequired: "需要批准",
      approvalNotRequired: "无需批准",
      permissionLabel: "权限",
      permissionSummary: (permission) => `权限：${permission}`,
      rolesLabel: "角色",
      rolesSummary: (roles) => `角色：${roles.join("、")}`,
      emptyConnectors: "暂无项目 MCP 连接器。",
      emptyVisibleTools: "该角色暂无可见工具。",
      roleLabels: {
        assistant: "聊天助手",
        planner: "规划员",
        builder: "构建员",
        reviewer: "审核员",
        deployer: "部署员"
      },
      management: {
        runtimeSummaryTitle: "MCP 运行时投影",
        safeProjectionNotice:
          "MCP 管理页只展示受限的连接器和工具元数据；原始输出和原始参数不会出现在 Web 页面中。",
        connectorDefinitionHint: "连接器定义应只包含项目范围元数据和工具策略。",
        summary: (summary) =>
          `${summary.connectorCount} 个连接器 · ${summary.visibleToolCount} 个可见工具 · ${summary.executionEligibleToolCount} 个只读检查`,
        runtimeSummary: (summary) =>
          `${summary.enabledConnectorCount} 个已启用连接器会根据当前项目技能、角色权限、批准状态和只读策略进入评估。`,
        toolCount: (count) => `${count} 个工具`,
        policyItems: [
          "可见工具由后端角色、权限、批准状态和连接器状态共同决定。",
          "只读检查不会提交浏览器侧原始参数 JSON。",
          "失败会显示稳定诊断，并以关闭保护方式处理。"
        ],
        statusLabels: {
          configured: "已配置",
          disabled: "已停用",
          invalid_definition: "定义无效",
          approval_required: "需要批准",
          no_visible_tools: "无可见工具",
          execution_not_available: "执行不可用"
        },
        approvalStates: {
          not_required: "无需批准",
          pending: "等待批准",
          approved: "已批准"
        },
        pending: {
          create: "正在保存连接器...",
          enable: "正在启用...",
          disable: "正在停用...",
          approval: "正在更新批准...",
          execute: "正在运行检查..."
        }
      },
      errors: {
        project_not_found: "当前项目已经不可用。",
        mcp_connector_json_invalid: "请输入有效的连接器 JSON。",
        mcp_connector_validation_failed: "连接器 JSON 必须包含 id、name 和有效工具。",
        mcp_connector_scope_unsupported: "当前版本仅支持项目范围连接器。",
        mcp_connector_already_exists: "该 id 的连接器已经存在。",
        mcp_connector_not_found: "当前项目中未找到该连接器。",
        mcp_tool_not_found: "未找到所选 MCP 工具。",
        mcp_tool_approval_not_required: "该工具不需要批准。",
        mcp_tool_not_visible: "当前角色不可见所选 MCP 工具。",
        mcp_tool_execution_not_read_only: "当前阶段只能执行只读 MCP 工具。",
        mcp_tool_execution_approval_required: "请先批准该 MCP 工具再执行。",
        mcp_tool_execution_rejected: "MCP executor 拒绝了本次工具运行。",
        mcp_tool_execution_failed: "MCP 工具运行失败。",
        mcp_tool_arguments_invalid: "请以 JSON object 格式输入参数。",
        mcp_executor_not_configured: "MCP executor 尚未配置。",
        mcp_operation_failed: "MCP 操作失败。"
      }
    },
    modelsView: {
      title: "项目模型",
      subtitle: "配置项目范围的模型供应商和角色路由，不保存原始密钥。",
      optInNotice: "真实 provider 需要显式 opt-in；默认 alpha 检查使用 deterministic 路由，不需要 API key。",
      failClosedNotice: "provider 或路由缺失时，runtime 会 fail closed，不会把真实调用静默当作成功。",
      activeProjectLabel: "当前项目",
      noProject: "暂无当前项目",
      providerCreateTitle: "创建模型供应商",
      providerIdLabel: "供应商键",
      providerNameLabel: "显示名称",
      providerTypeLabel: "供应商类型",
      providerApiLabel: "API 协议",
      baseUrlLabel: "Base URL",
      secretEnvNameLabel: "密钥环境变量",
      apiKeyEnvLabel: "API Key 环境变量",
      providerModelIdLabel: "默认模型 ID",
      baseUrlConfigured: "已配置 Base URL",
      apiKeyEnvConfigured: "已配置 API Key 环境变量",
      createProvider: "创建供应商",
      providersTitle: "供应商",
      routesTitle: "角色路由",
      resolvedTitle: "已解析路由",
      enabled: "已启用",
      disabled: "已停用",
      enable: "启用",
      disable: "停用",
      modelLabel: "模型 ID",
      saveRoute: "保存路由",
      fallbackLabel: "回退",
      roleLabels: {
        assistant: "聊天助手",
        planner: "规划员",
        builder: "构建员",
        reviewer: "审核员",
        deployer: "部署员"
      },
      providerTypes: {
        mock: "Mock",
        openai: "OpenAI",
        anthropic: "Anthropic",
        internal: "内部",
        custom: "自定义"
      },
      providerApis: {
        mock: "Mock",
        "openai-completions": "OpenAI Chat Completions 兼容",
        "anthropic-messages": "Anthropic Messages 兼容"
      },
      errors: {
        project_not_found: "当前项目已经不可用。",
        model_provider_name_required: "请输入供应商显示名称。",
        model_provider_key_required: "请输入由字母、数字、连字符或下划线组成的供应商键。",
        model_provider_type_unsupported: "请选择支持的供应商类型。",
        model_provider_api_required: "请选择供应商 API 协议。",
        model_provider_api_unsupported: "请选择支持的供应商 API 协议。",
        model_provider_base_url_invalid: "请输入有效的供应商基础 URL。",
        model_provider_api_key_env_invalid: "请使用环境变量名填写供应商 API 密钥。",
        model_provider_model_id_required: "请输入供应商模型 ID。",
        model_provider_model_limit_invalid: "请至少配置一个供应商模型。",
        model_provider_already_exists: "该供应商键已经存在。",
        model_provider_not_found: "当前供应商已经不可用。",
        model_provider_disabled: "请先启用供应商，再将角色路由到它。",
        model_provider_in_use: "请先移除项目角色路由，再停用该供应商。",
        model_role_unsupported: "请选择支持的角色。",
        model_id_required: "请输入模型 ID。",
        model_route_not_found: "当前模型路由已经不可用。",
        model_route_provider_invalid: "该路由指向不可用的供应商。",
        model_secret_reference_invalid: "请使用环境变量名，不要填写密钥值。",
        model_routing_operation_failed: "模型路由操作失败，请重试。"
      },
      management: {
        projectSummaryTitle: "项目模型摘要",
        localRunChecklistTitle: "本地真实 provider 运行检查",
        localRunChecklistItems: {
          realProvider: "Provider 就绪",
          chatRoute: "聊天就绪",
          lpRoutes: "LP 生成就绪"
        },
        localRunChecklistStates: {
          ready: "就绪",
          blocked: "未就绪"
        },
        localRunChecklistDetails: {
          realProvider: {
            ready: "已有启用的真实 provider，且包含 endpoint metadata、secret reference 和至少一个模型。",
            blocked: "请添加启用的真实 provider，并配置 endpoint metadata、secret reference 和至少一个模型。"
          },
          chatRoute: {
            ready: "assistant 路由已指向就绪的真实 provider。",
            blocked: "请将 assistant 路由到就绪的真实 provider，以启用本地聊天。"
          },
          lpRoutes: {
            ready: "planner 和 builder 路由已指向就绪的真实 provider；reviewer 和 deployer 可继续使用 deterministic 路由。",
            blocked: "请将 planner 和 builder 路由到就绪的真实 provider，以启用本地 LP 运行。"
          }
        },
        providerSummaryTitle: "Provider 配置",
        routeSummaryTitle: "角色路由",
        resolvedSummaryTitle: "已解析运行路由",
        secretReferenceHint: "环境变量引用",
        safeMetadataNote: "页面只保存 provider metadata 和环境变量名，不展示 secret 值。",
        optInRuntimeNote: "真实 provider 调用仍需要 REAL_MODEL_RUNTIME=1 和已配置的环境变量。",
        providerCount: (enabledCount, totalCount) =>
          `${totalCount} 个 provider 中 ${enabledCount} 个已启用`,
        routeCount: (configuredCount, totalCount) =>
          `${totalCount} 条路由中 ${configuredCount} 条已配置`,
        notices: {
          provider_created: "模型 provider 已保存。",
          provider_enabled: "模型 provider 已启用。",
          provider_disabled: "模型 provider 已停用。",
          route_saved: "模型路由已保存。"
        },
        pending: {
          createProvider: "正在保存 provider...",
          enable: "正在启用...",
          disable: "正在停用...",
          saveRoute: "正在保存路由..."
        },
        providerStates: {
          enabled: "已启用",
          disabled: "已停用"
        },
        routeStates: {
          configured: "已配置",
          fallback: "Deterministic fallback",
          failClosed: "Fail closed"
        },
        metadataStates: {
          configured: "已配置",
          notConfigured: "未配置"
        }
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
      builderModelRoute: (route) => `构建模型：${route}`,
      assistantModelRoute: (route) => `聊天模型：${route}`,
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
      artifactsTitle: "生成页面",
      artifactWorkspaceTitle: "产物工作区",
      artifactWorkspaceSubtitle: "查看当前任务的静态 LP 文件、预览、片段和导出。",
      artifactWorkspaceEmptyTitle: "还没有产物工作区",
      artifactWorkspaceEmptyDescription: "先在工作台生成一个 LP 任务，系统会创建静态 HTML、CSS 和 JavaScript 文件。",
      artifactWorkspaceManifestTitle: "文件清单",
      artifactWorkspaceExportTitle: "导出",
      artifactWorkspaceOpenLabel: "打开产物工作区",
      artifactPreviewDrawerOpenLabel: "预览与导出",
      artifactPreviewDrawerCloseLabel: "关闭预览",
      artifactPreviewWorkspaceOpenLabel: "打开预览",
      artifactPreviewWorkspaceInspectLabel: "查看元素",
      artifactPreviewWorkspaceInspectActiveLabel: "正在查看元素",
      artifactPreviewWorkspaceSelectedEmptyLabel: "还没有选中元素",
      artifactPreviewWorkspaceSelectedLabel: "已选中元素",
      artifactPreviewWorkspaceClearSelectionLabel: "清除选择",
      artifactWorkspaceUnavailableLabel: "产物工作区暂不可用。",
      suggestionsTitle: "推荐追问",
      resultRating: "这个结果怎么样？",
      allFilesLabel: "查看此任务中的所有文件",
      previewTitle: "静态 LP 预览",
      composerPlaceholder: "发送消息给 LP Agent",
      addAttachmentLabel: "添加上下文",
      runtimeChip: "云端运行时",
      interruptLabel: "打断",
      interruptStoppingLabel: "正在停止...",
      interruptUnavailableLabel: "当前没有可打断任务",
      streamingStatusLabel: "正在生成回复",
      streamingErrorLabel: "聊天回复生成失败。",
      streamingErrorMessages: {
        prompt_required: "请先输入提示词。",
        project_not_found: "当前项目不可用。",
        generation_failed: "聊天回复生成失败。",
        provider_configuration_failed: "请检查项目模型 provider 配置后重试。",
        provider_authentication_failed: "模型 provider 认证失败，请检查 API key 或权限。",
        provider_billing_required: "模型 provider 余额或计费状态异常，请充值或切换 provider 后重试。",
        provider_rate_limited: "模型 provider 请求过于频繁，请稍后重试。",
        provider_unavailable: "模型 provider 暂时不可用，请稍后重试。",
        provider_timeout: "模型 provider 响应超时，请稍后重试。",
        provider_request_failed: "模型 provider 请求失败，请检查 provider 状态后重试。",
        provider_response_invalid: "模型 provider 返回了暂不支持的响应格式。",
        stream_interrupted: "Provider stream 在回复完成前中断。",
        empty_response: "Provider 已结束，但没有返回可用的 assistant 文本。",
        persistence_failed: "回复已生成，但无法保存。"
      },
      liveTaskTitle: "实时任务进度",
      liveTaskIdle: "等待任务活动",
      liveTaskRunning: "任务正在运行",
      liveTaskCompleted: "任务事实已更新",
      liveTaskArtifactReady: "产物工作区已就绪",
      liveTaskRefreshError: "任务进度刷新失败。",
      recoveryTitle: "运行恢复",
      recoverySubtitle: "根据运行生命周期派生的安全恢复选项。",
      recoveryStateLabels: {
        queued: "排队中",
        running: "运行中",
        waiting_for_approval: "等待审批",
        blocked: "已阻塞",
        cancelling: "正在停止",
        cancelled: "已停止",
        failed: "失败",
        completed: "完成"
      },
      recoveryActionLabels: {
        resume_worker_finalization: "继续写回",
        retry_run: "重试运行"
      },
      recoveryGuidanceLabels: {
        request_approval: "请求审批",
        resolve_blocker: "解除阻塞",
        inspect_manually: "人工检查"
      },
      recoveryErrorLabel: "恢复动作未能完成。",
      runTimelineTitle: "运行时间线",
      runTimelineSubtitle: "从规划到部署交接",
      runTimelinePending: "未开始",
      runTimelineActive: "当前步骤",
      runTimelineActionGroupLabels: {
        executable: "可执行动作",
        guidance: "处理建议"
      },
      runTimelineMarkerLabels: {
        repair_started: "开始修复",
        repaired: "已修复",
        repair_failed: "修复失败",
        retry_scheduled: "已安排重试",
        retry_exhausted: "重试耗尽",
        retry_attempt: "重试尝试",
        handoff_ready: "交接就绪",
        handoff_consumed: "交接已消费",
        handoff_blocked: "交接阻塞"
      },
      sendLabel: "发送",
      toolStatusRunning: "运行中",
      toolStatusComplete: "完成",
      toolStatusCancelled: "已停止",
      branchLabel: "分支",
      findingsLabel: "问题",
      filesLabel: "文件",
      artifactChangesTitle: "文件变化",
      artifactVersionInitial: "初始版本",
      artifactPreviousVersionLabel: "上一版",
      artifactCurrentVersionLabel: "当前版",
      artifactHashLabel: "哈希",
      previewSnippetLabel: "预览片段",
      snippetPreviewTitle: "片段预览",
      snippetSizeLimitMessage: "内容超过 8 KB 预览限制。",
      snippetUnavailableMessage: "片段暂不可用。",
      bytesLabel: (bytes) => `${bytes.toLocaleString("zh-CN")} 字节`,
      artifactDiffStateLabels: {
        initial: "初始",
        added: "新增",
        removed: "已移除",
        changed: "已变更",
        unchanged: "未变更"
      },
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
      separatedFiles: "导出 HTML/CSS/JS 文件包",
      indexHtml: "导出 index.html",
      stylesCss: "导出 styles.css",
      scriptJs: "导出 script.js",
      handoffNextAction: "将这些文件应用到目标仓库分支，并打开对应代码平台的 PR。"
    }
  }
};
