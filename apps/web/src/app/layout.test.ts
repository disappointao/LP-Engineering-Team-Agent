import { describe, expect, it, vi } from "vitest";

const layoutMocks = vi.hoisted(() => ({
  acceptLanguage: "zh-CN,zh;q=0.9"
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "accept-language": layoutMocks.acceptLanguage })
}));

import RootLayout from "./layout";

describe("RootLayout", () => {
  it("suppresses root html and body hydration warnings from browser extension attributes", async () => {
    const layout = await RootLayout({ children: "content" });
    const body = layout.props?.children;

    expect(layout.props?.lang).toBe("zh-CN");
    expect(layout.props?.suppressHydrationWarning).toBe(true);
    expect(body?.type).toBe("body");
    expect(body?.props?.suppressHydrationWarning).toBe(true);
  });
});
