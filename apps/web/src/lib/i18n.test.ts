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
    expect(getWorkbenchCopy("zh-CN").nav.workbench).toBe("工作台");
    expect(getWorkbenchCopy("zh-CN").hero.title).toBe("我能帮你生成什么 LP？");
    expect(getWorkbenchCopy("zh-CN").entry.title).toBe("我能为你做什么？");
    expect(getWorkbenchCopy("zh-CN").entry.implicitProjectName).toBe("未命名 LP 项目");
    expect(getWorkbenchCopy("zh-CN").chat.composerPlaceholder).toBe("发送消息给 LP Agent");
    expect(getWorkbenchCopy("zh-CN").projectFlow.createProject).toBe("创建项目");
    expect(getWorkbenchCopy("zh-CN").projectFlow.errors.prompt_required).toBe("请输入 LP 需求。");
    expect(getWorkbenchCopy("zh-CN").projectFlow.createDescription).not.toContain("仓库");
    expect(getWorkbenchCopy("zh-CN").chat.suggestions.join(" ")).not.toContain("部署");
    expect(getWorkbenchCopy("en").hero.title).toBe("What LP should we build?");
    expect(getWorkbenchCopy("en").entry.title).toBe("What can I help you build?");
    expect(getWorkbenchCopy("en").entry.implicitProjectName).toBe("Untitled LP Project");
    expect(getWorkbenchCopy("en").chat.composerPlaceholder).toBe("Message LP Agent");
    expect(getWorkbenchCopy("en").projectFlow.createProject).toBe("Create project");
    expect(getWorkbenchCopy("en").projectFlow.errors.prompt_required).toBe("Enter an LP request.");
    expect(getWorkbenchCopy("en").projectFlow.createDescription).not.toContain("repository");
    expect(getWorkbenchCopy("en").chat.suggestions.join(" ")).not.toContain("deployment");
  });
});
