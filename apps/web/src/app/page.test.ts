import { describe, expect, it, vi } from "vitest";
import HomePage from "./page";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "accept-language": "en" }),
  cookies: async () => ({
    get: () => undefined
  })
}));

function collectText(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === "boolean") {
    return [];
  }

  if (typeof node === "string" || typeof node === "number") {
    return [String(node)];
  }

  if (Array.isArray(node)) {
    return node.flatMap(collectText);
  }

  if (typeof node === "object" && "props" in node) {
    const element = node as { props?: { children?: unknown } };
    return collectText(element.props?.children);
  }

  return [];
}

describe("HomePage project flow errors", () => {
  it("renders known project flow errors and ignores unknown values", async () => {
    const knownErrorPage = await HomePage({
      searchParams: Promise.resolve({ error: "project_name_required" })
    });
    const unknownErrorPage = await HomePage({
      searchParams: Promise.resolve({ error: "not_a_real_code" })
    });

    expect(collectText(knownErrorPage)).toContain("Enter a project name.");
    expect(collectText(unknownErrorPage)).not.toContain("Enter a project name.");
  });
});
