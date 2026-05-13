import { describe, expect, it } from "vitest";
import { getWorkbenchCopy, resolveLocaleFromAcceptLanguage } from "./i18n";

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
    expect(zh.projectFlow.createProject).toBe("创建项目");
    expect(zh.projectFlow.localPersistenceNote).toBe(
      "Web MVP 状态会保存在这台电脑的 .lp-agent/ 本地状态目录中。"
    );
    expect(zh.projectFlow.errors.prompt_required).toBe("请输入 LP 需求。");
    expect(zh.projectFlow.createDescription).not.toContain("仓库");
    expect(zh.chat.suggestions.join(" ")).not.toContain("部署");
    expect(en.hero.title).toBe("What LP should we build?");
    expect(en.entry.title).toBe("What can I help you build?");
    expect(en.entry.implicitProjectName).toBe("Untitled LP Project");
    expect(en.chat.composerPlaceholder).toBe("Message LP Agent");
    expect(en.projectFlow.createProject).toBe("Create project");
    expect(en.projectFlow.localPersistenceNote).toBe(
      "Local Web MVP state is saved on this machine under .lp-agent/."
    );
    expect(en.projectFlow.errors.prompt_required).toBe("Enter an LP request.");
    expect(en.projectFlow.createDescription).not.toContain("repository");
    expect(en.chat.suggestions.join(" ")).not.toContain("deployment");
  });
});
