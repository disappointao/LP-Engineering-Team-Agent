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
    expect(zh.chat.builderModelRoute("provider_openai/gpt-5.4")).toBe(
      "构建模型：provider_openai/gpt-5.4"
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
    expect(en.entry.title).toBe("What can I help you build?");
    expect(en.entry.implicitProjectName).toBe("Untitled LP Project");
    expect(en.chat.composerPlaceholder).toBe("Message LP Agent");
    expect(en.chat.builderModelRoute("provider_openai/gpt-5.4")).toBe(
      "Builder model: provider_openai/gpt-5.4"
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
});
