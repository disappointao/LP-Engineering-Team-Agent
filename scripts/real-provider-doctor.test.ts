import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDoctor } from "./real-provider-doctor.mjs";

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "real-provider-doctor-"));

  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("real-provider doctor", () => {
  it("uses .env.local by default and exits zero in checklist mode when configuration is missing", async () => {
    await withTempDir(async (cwd) => {
      await writeFile(join(cwd, ".env.local"), "REAL_MODEL_RUNTIME=0\n");

      const result = await runDoctor({ cwd, argv: [] });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(".env.local");
      expect(result.stdout).toContain("REAL_MODEL_RUNTIME is not enabled");
      expect(result.stdout).toContain("No ready real-provider profile");
    });
  });

  it("accepts --env-file and recommends ready OpenAI-compatible Web Models fields without printing secret or base URL values", async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, "provider.env"),
        [
          "REAL_MODEL_RUNTIME=1",
          "OPENAI_COMPATIBLE_BASE_URL=https://provider.example/v1",
          "OPENAI_COMPATIBLE_API_KEY=sk-test-secret",
          "OPENAI_COMPATIBLE_DEFAULT_MODEL=glm-test",
          ""
        ].join("\n")
      );

      const result = await runDoctor({
        cwd,
        argv: ["--env-file", "provider.env"]
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("provider.env");
      expect(result.stdout).toContain("OpenAI-compatible profile: ready");
      expect(result.stdout).toContain("api: openai-completions");
      expect(result.stdout).toContain(
        "baseUrl: copy from OPENAI_COMPATIBLE_BASE_URL"
      );
      expect(result.stdout).toContain("apiKeyEnv: OPENAI_COMPATIBLE_API_KEY");
      expect(result.stdout).toContain(
        "model: copy from OPENAI_COMPATIBLE_DEFAULT_MODEL"
      );
      expect(result.stdout).not.toContain("sk-test-secret");
      expect(result.stdout).not.toContain("https://provider.example/v1");
    });
  });

  it("recommends ready Anthropic-compatible Web Models fields without printing secret or base URL values", async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, ".env.local"),
        [
          "REAL_MODEL_RUNTIME=1",
          "ANTHROPIC_BASE_URL=https://anthropic.example",
          "ANTHROPIC_API_KEY=anthropic-secret",
          "ANTHROPIC_DEFAULT_MODEL=claude-test",
          ""
        ].join("\n")
      );

      const result = await runDoctor({ cwd, argv: [] });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Anthropic-compatible profile: ready");
      expect(result.stdout).toContain("api: anthropic-messages");
      expect(result.stdout).toContain("baseUrl: copy from ANTHROPIC_BASE_URL");
      expect(result.stdout).toContain("apiKeyEnv: ANTHROPIC_API_KEY");
      expect(result.stdout).toContain(
        "model: copy from ANTHROPIC_DEFAULT_MODEL"
      );
      expect(result.stdout).not.toContain("anthropic-secret");
      expect(result.stdout).not.toContain("https://anthropic.example");
    });
  });

  it("returns one in strict mode when runtime is disabled or no profile is ready", async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, ".env.local"),
        [
          "REAL_MODEL_RUNTIME=0",
          "OPENAI_COMPATIBLE_BASE_URL=https://provider.example/v1",
          "OPENAI_COMPATIBLE_API_KEY=sk-test-secret",
          "OPENAI_COMPATIBLE_DEFAULT_MODEL=glm-test",
          ""
        ].join("\n")
      );

      const disabledRuntime = await runDoctor({
        cwd,
        argv: ["--strict"]
      });

      await writeFile(join(cwd, ".env.local"), "REAL_MODEL_RUNTIME=1\n");

      const missingProfile = await runDoctor({
        cwd,
        argv: ["--strict"]
      });

      expect(disabledRuntime.exitCode).toBe(1);
      expect(missingProfile.exitCode).toBe(1);
    });
  });

  it("returns zero in strict mode when runtime is enabled and at least one profile is ready", async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, ".env.local"),
        [
          "REAL_MODEL_RUNTIME=1",
          "OPENAI_COMPATIBLE_BASE_URL=https://provider.example/v1",
          "OPENAI_COMPATIBLE_API_KEY=sk-test-secret",
          "OPENAI_COMPATIBLE_DEFAULT_MODEL=glm-test",
          ""
        ].join("\n")
      );

      const result = await runDoctor({
        cwd,
        argv: ["--strict"]
      });

      expect(result.exitCode).toBe(0);
    });
  });

  it("ignores a standalone argument separator before strict mode", async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, ".env.local"),
        [
          "REAL_MODEL_RUNTIME=1",
          "OPENAI_COMPATIBLE_BASE_URL=https://provider.example/v1",
          "OPENAI_COMPATIBLE_API_KEY=sk-test-secret",
          "OPENAI_COMPATIBLE_DEFAULT_MODEL=glm-test",
          ""
        ].join("\n")
      );

      const result = await runDoctor({
        cwd,
        argv: ["--", "--strict"]
      });

      expect(result.exitCode).toBe(0);
    });
  });
});

describe("package scripts", () => {
  it("exposes pnpm real-provider:doctor", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));

    expect(packageJson.scripts["real-provider:doctor"]).toBe(
      "node scripts/real-provider-doctor.mjs"
    );
  });
});
