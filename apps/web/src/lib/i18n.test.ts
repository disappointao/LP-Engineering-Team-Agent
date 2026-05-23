import { describe, expect, it } from "vitest";
import { getWorkbenchCopy, resolveLocaleFromAcceptLanguage } from "./i18n";
import type { SkillCommandFlowErrorCode } from "./workbench-store";

const skillCommandErrorCodes: SkillCommandFlowErrorCode[] = [
  "skill_command_not_found",
  "skill_command_not_bound",
  "skill_command_not_deployment",
  "skill_command_not_published",
  "skill_command_permission_denied",
  "skill_command_approval_required",
  "skill_command_not_queueable",
  "skill_command_page_version_not_found",
  "skill_command_unknown_template_variable",
  "skill_command_execution_failed"
];

describe("web i18n", () => {
  it("chooses Chinese for zh language environments", () => {
    expect(resolveLocaleFromAcceptLanguage("zh-CN,zh;q=0.9,en;q=0.8")).toBe("zh-CN");
    expect(resolveLocaleFromAcceptLanguage("zh-TW,zh;q=0.8,en;q=0.5")).toBe("zh-CN");
  });

  it("chooses English for English-first environments and unsupported languages", () => {
    expect(resolveLocaleFromAcceptLanguage("en-US,en;q=0.9,zh;q=0.7")).toBe("en");
    expect(resolveLocaleFromAcceptLanguage("fr-FR,fr;q=0.9")).toBe("en");
    expect(resolveLocaleFromAcceptLanguage(undefined)).toBe("en");
  });

  it("exposes localized workbench labels", () => {
    const zh = getWorkbenchCopy("zh-CN");
    const en = getWorkbenchCopy("en");

    expect(zh.nav.workbench).toBe("工作台");
    expect(zh.hero.title).toBe("我能帮你生成什么 LP？");
    expect(zh.entry.title).toBe("我能为你做什么？");
    expect(zh.entry.implicitProjectName).toBe("未命名 LP 项目");
    expect(zh.chat.composerPlaceholder).toBe("发送消息给 LP Agent");
    expect(zh.chat.streamingStatusLabel).toBe("正在生成回复");
    expect(zh.chat.streamingErrorLabel).toBe("聊天回复生成失败。");
    expect(zh.chat.streamingErrorMessages).toEqual({
      prompt_required: "请先输入提示词。",
      project_not_found: "当前项目不可用。",
      generation_failed: "聊天回复生成失败。",
      provider_configuration_failed: "请检查项目模型 provider 配置后重试。",
      stream_interrupted: "Provider stream 在回复完成前中断。",
      empty_response: "Provider 已结束，但没有返回可用的 assistant 文本。",
      persistence_failed: "回复已生成，但无法保存。"
    });
    expect(zh.chat.builderModelRoute("provider_openai/gpt-5.4")).toBe(
      "构建模型：provider_openai/gpt-5.4"
    );
    expect(zh.chat.assistantModelRoute("provider_openai/gpt-5.4")).toBe(
      "聊天模型：provider_openai/gpt-5.4"
    );
    expect(zh.projectFlow.createProject).toBe("创建项目");
    expect(zh.projectFlow.localPersistenceNote).toBe(
      "Web MVP 状态会保存在这台电脑的 .lp-agent/ 本地状态目录中。"
    );
    expect(zh.projectFlow.errors.prompt_required).toBe("请输入 LP 需求。");
    expect(zh.interruptFlow.errors.task_not_found).toBe("当前没有可打断的任务。");
    expect(zh.chat.interruptStoppingLabel).toBe("正在停止...");
    expect(zh.chat.toolStatusCancelled).toBe("已停止");
    expect(zh.projectFlow.createDescription).not.toContain("仓库");
    expect(zh.chat.suggestions.join(" ")).not.toContain("部署");
    expect(zh.collaboration.title).toBe("项目成员");
    expect(zh.collaboration.localIdentity).toBe("本地身份");
    expect(zh.collaboration.localUser).toBe("本地用户");
    expect(zh.collaboration.roleLabels.owner).toBe("负责人");
    expect(en.hero.title).toBe("What LP should we build?");
    expect(en.hero.actionChips.join(" ").toLowerCase()).not.toContain("mcp");
    expect(zh.hero.actionChips.join(" ").toLowerCase()).not.toContain("mcp");
    expect(en.entry.title).toBe("What can I help you build?");
    expect(en.entry.implicitProjectName).toBe("Untitled LP Project");
    expect(en.chat.composerPlaceholder).toBe("Message LP Agent");
    expect(en.chat.streamingStatusLabel).toBe("Generating response");
    expect(en.chat.streamingErrorLabel).toBe("The chat response could not be generated.");
    expect(en.chat.streamingErrorMessages).toEqual({
      prompt_required: "Enter a prompt before sending.",
      project_not_found: "The selected project is unavailable.",
      generation_failed: "The chat response could not be generated.",
      provider_configuration_failed: "Check the project model provider configuration before retrying.",
      stream_interrupted: "The provider stream stopped before the response completed.",
      empty_response: "The provider completed without usable assistant text.",
      persistence_failed: "The response was generated but could not be saved."
    });
    expect(en.chat.builderModelRoute("provider_openai/gpt-5.4")).toBe(
      "Builder model: provider_openai/gpt-5.4"
    );
    expect(en.chat.assistantModelRoute("provider_openai/gpt-5.4")).toBe(
      "Assistant model: provider_openai/gpt-5.4"
    );
    expect(en.projectFlow.createProject).toBe("Create project");
    expect(en.projectFlow.localPersistenceNote).toBe(
      "Local Web MVP state is saved on this machine under .lp-agent/."
    );
    expect(en.projectFlow.errors.prompt_required).toBe("Enter an LP request.");
    expect(en.interruptFlow.errors.task_not_found).toBe("No current task to interrupt.");
    expect(en.chat.interruptStoppingLabel).toBe("Stopping...");
    expect(en.chat.toolStatusCancelled).toBe("Stopped");
    expect(en.projectFlow.createDescription).not.toContain("repository");
    expect(en.chat.suggestions.join(" ")).not.toContain("deployment");
    expect(en.collaboration.title).toBe("Project members");
    expect(en.collaboration.localIdentity).toBe("Local identity");
    expect(en.collaboration.localUser).toBe("Local user");
    expect(en.collaboration.roleLabels.owner).toBe("Owner");
    expect(en.mcpView.executeReadOnly).toBe("Run read-only check");
    expect(en.mcpView.argumentsLabel).toBe("Arguments JSON");
    expect(en.mcpView.errors.mcp_tool_execution_not_read_only).toBe(
      "Only read-only MCP tools can run in this stage."
    );
    expect(zh.mcpView.executeReadOnly).toBe("执行只读检查");
    expect(zh.mcpView.argumentsLabel).toBe("参数 JSON");
    expect(zh.mcpView.errors.mcp_tool_execution_not_read_only).toBe(
      "当前阶段只能执行只读 MCP 工具。"
    );
  });

  it("includes artifact diff and snippet labels in both locales", () => {
    const en = getWorkbenchCopy("en");
    const zh = getWorkbenchCopy("zh-CN");

    expect(en.chat.artifactChangesTitle).toBe("Artifact changes");
    expect(en.chat.artifactDiffStateLabels.changed).toBe("Changed");
    expect(en.chat.previewSnippetLabel).toBe("Preview snippet");
    expect(en.chat.snippetSizeLimitMessage).toContain("8 KB");
    expect(en.chat.bytesLabel(1280)).toBe("1,280 bytes");
    expect(zh.chat.artifactChangesTitle).toBe("文件变化");
    expect(zh.chat.artifactDiffStateLabels.initial).toBe("初始");
    expect(zh.chat.previewSnippetLabel).toBe("预览片段");
    expect(zh.chat.snippetUnavailableMessage).toBe("片段暂不可用。");
    expect(zh.chat.bytesLabel(1280)).toBe("1,280 字节");
  });

  it("includes dedicated artifact workspace copy in both locales", () => {
    const zh = getWorkbenchCopy("zh-CN");
    const en = getWorkbenchCopy("en");

    expect(en.nav.artifacts).toBe("Artifacts");
    expect(zh.nav.artifacts).toBe("产物");
    expect(en.chat.artifactWorkspaceTitle).toBe("Artifact workspace");
    expect(en.chat.artifactWorkspaceSubtitle).toBe(
      "Inspect the current task's static LP files, preview, snippets, and exports."
    );
    expect(en.chat.artifactWorkspaceEmptyTitle).toBe("No artifact workspace yet");
    expect(en.chat.artifactWorkspaceEmptyDescription).toBe(
      "Generate an LP task in the workbench to create static HTML, CSS, and JavaScript files."
    );
    expect(en.chat.artifactWorkspaceManifestTitle).toBe("File manifest");
    expect(en.chat.artifactWorkspaceExportTitle).toBe("Exports");
    expect(en.chat.artifactWorkspaceOpenLabel).toBe("Open artifact workspace");
    expect(en.chat.artifactWorkspaceUnavailableLabel).toBe("Artifact workspace is unavailable.");
    expect(zh.chat.artifactWorkspaceTitle).toBe("产物工作区");
    expect(zh.chat.artifactWorkspaceSubtitle).toBe("查看当前任务的静态 LP 文件、预览、片段和导出。");
    expect(zh.chat.artifactWorkspaceEmptyTitle).toBe("还没有产物工作区");
    expect(zh.chat.artifactWorkspaceEmptyDescription).toBe(
      "先在工作台生成一个 LP 任务，系统会创建静态 HTML、CSS 和 JavaScript 文件。"
    );
    expect(zh.chat.artifactWorkspaceManifestTitle).toBe("文件清单");
    expect(zh.chat.artifactWorkspaceExportTitle).toBe("导出");
    expect(zh.chat.artifactWorkspaceOpenLabel).toBe("打开产物工作区");
    expect(zh.chat.artifactWorkspaceUnavailableLabel).toBe("产物工作区暂不可用。");
  });

  it("exposes localized live task progress labels", () => {
    const en = getWorkbenchCopy("en");
    const zh = getWorkbenchCopy("zh-CN");

    expect(en.chat.liveTaskTitle).toBe("Live task progress");
    expect(en.chat.liveTaskRefreshError).toBe("Task progress could not be refreshed.");
    expect(zh.chat.liveTaskTitle).toBe("实时任务进度");
    expect(zh.chat.liveTaskRefreshError).toBe("任务进度刷新失败。");
  });

  it("has localized model provider protocol copy", () => {
    const zh = getWorkbenchCopy("zh-CN");
    const en = getWorkbenchCopy("en");

    expect(en.modelsView.providerApiLabel).toBe("API protocol");
    expect(en.modelsView.providerApis["anthropic-messages"]).toBe("Anthropic Messages compatible");
    expect(zh.modelsView.providerApiLabel).toBe("API 协议");
    expect(zh.modelsView.providerApis["openai-completions"]).toBe(
      "OpenAI Chat Completions 兼容"
    );
    expect(zh.modelsView.errors.model_provider_api_key_env_invalid).toContain("环境变量");
  });

  it("exposes localized skill command errors for both locales", () => {
    const zh = getWorkbenchCopy("zh-CN");
    const en = getWorkbenchCopy("en");

    for (const code of skillCommandErrorCodes) {
      expect(en.skillsView.errors[code]).toBeTruthy();
      expect(zh.skillsView.errors[code]).toBeTruthy();
    }
  });

  it("exposes localized worker queue copy for both locales", () => {
    const zh = getWorkbenchCopy("zh-CN");
    const en = getWorkbenchCopy("en");

    expect(en.skillsView.approveAndQueue).toBe("Approve and queue");
    expect(zh.skillsView.approveAndQueue).toBe("批准并入队");
    expect(en.skillsView.runLocalWorkerOnce).toBe("Run local worker once");
    expect(zh.skillsView.runLocalWorkerOnce).toBe("运行一次本地 Worker");
    expect(en.skillsView.localWorkerIdle).toBe("Run the local worker to process queued jobs.");
    expect(zh.skillsView.localWorkerIdle).toBe("运行本地 Worker 来处理排队任务。");
    expect(en.skillsView.workerQueueCounts.queued).toBe("Queued");
    expect(zh.skillsView.workerQueueCounts.running).toBe("运行中");
    expect(en.skillsView.workerHeartbeatLabel).toBe("Heartbeat");
    expect(zh.skillsView.workerHeartbeatLabel).toBe("心跳");
    expect(en.skillsView.workerHeartbeatStatuses.stale).toBe("Stale");
    expect(zh.skillsView.workerHeartbeatStatuses.unknown).toBe("未知");
    expect(en.skillsView.workerRecentLogsTitle).toBe("Recent worker logs");
    expect(zh.skillsView.workerNoRecentLogs).toBe("暂无 Worker 日志。");
    expect(en.skillsView.workerErrors.worker_runtime_not_configured).toContain("Worker");
    expect(zh.skillsView.workerErrors.worker_runtime_not_configured).toContain("Worker");
  });

  it("exposes localized skill-only alpha boundary copy", () => {
    const zh = getWorkbenchCopy("zh-CN");
    const en = getWorkbenchCopy("en");

    expect(en.skillsView.alphaNotice).toBe(
      "Skill-only alpha: published and bound skills are the primary extension path for chat and LP tasks."
    );
    expect(en.skillsView.commandQueueNotice).toBe(
      "Commands use approval, the local worker queue, and safe observations; they do not run arbitrary shell commands or real deployment."
    );
    expect(en.modelsView.optInNotice).toBe(
      "Real providers are opt-in. Default alpha checks use deterministic routes and do not require API keys."
    );
    expect(en.modelsView.failClosedNotice).toBe(
      "If a provider or route is missing, the runtime fails closed instead of silently treating a real call as successful."
    );
    expect(en.mcpView.deferredNotice).toBe(
      "MCP is deferred for this alpha. Chat and LP generation work without configuring connectors."
    );

    expect(zh.skillsView.alphaNotice).toBe(
      "Skill-only alpha：已发布并绑定的 Skill 是聊天和 LP 任务的主要扩展路径。"
    );
    expect(zh.skillsView.commandQueueNotice).toBe(
      "命令会经过批准、本地 Worker 队列和安全 observation；不会运行任意 shell 命令或真实部署。"
    );
    expect(zh.modelsView.optInNotice).toBe(
      "真实 provider 需要显式 opt-in；默认 alpha 检查使用 deterministic 路由，不需要 API key。"
    );
    expect(zh.modelsView.failClosedNotice).toBe(
      "provider 或路由缺失时，runtime 会 fail closed，不会把真实调用静默当作成功。"
    );
    expect(zh.mcpView.deferredNotice).toBe(
      "MCP 在本 alpha 中后置；不配置连接器也可以完成聊天和 LP 生成。"
    );
  });

  it("exposes localized run recovery copy for both locales", () => {
    const zh = getWorkbenchCopy("zh-CN");
    const en = getWorkbenchCopy("en");

    expect(en.chat.recoveryTitle).toBe("Run recovery");
    expect(en.chat.recoverySubtitle).toBe(
      "Safe recovery options derived from the run lifecycle."
    );
    expect(en.chat.recoveryStateLabels).toEqual({
      queued: "Queued",
      running: "Running",
      waiting_for_approval: "Waiting approval",
      blocked: "Blocked",
      cancelling: "Stopping",
      cancelled: "Stopped",
      failed: "Failed",
      completed: "Completed"
    });
    expect(en.chat.recoveryActionLabels).toEqual({
      resume_worker_finalization: "Resume finalization",
      retry_run: "Retry run"
    });
    expect(en.chat.recoveryGuidanceLabels).toEqual({
      request_approval: "Request approval",
      resolve_blocker: "Resolve blocker",
      inspect_manually: "Inspect manually"
    });
    expect(en.chat.recoveryErrorLabel).toBe("Recovery action could not be completed.");

    expect(zh.chat.recoveryTitle).toBe("运行恢复");
    expect(zh.chat.recoverySubtitle).toBe("根据运行生命周期派生的安全恢复选项。");
    expect(zh.chat.recoveryStateLabels).toEqual({
      queued: "排队中",
      running: "运行中",
      waiting_for_approval: "等待审批",
      blocked: "已阻塞",
      cancelling: "正在停止",
      cancelled: "已停止",
      failed: "失败",
      completed: "完成"
    });
    expect(zh.chat.recoveryActionLabels).toEqual({
      resume_worker_finalization: "继续写回",
      retry_run: "重试运行"
    });
    expect(zh.chat.recoveryGuidanceLabels).toEqual({
      request_approval: "请求审批",
      resolve_blocker: "解除阻塞",
      inspect_manually: "人工检查"
    });
    expect(zh.chat.recoveryErrorLabel).toBe("恢复动作未能完成。");
  });
});
