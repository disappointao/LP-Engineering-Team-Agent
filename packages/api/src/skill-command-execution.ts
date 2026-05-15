import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { StaticArtifacts } from "@lp-agent/artifacts";
import type { SkillCommandManifest, SkillManifest } from "@lp-agent/skills";

const TEMPLATE_PATTERN = /{{\s*([A-Za-z0-9_.]+)\s*}}/g;
const DEFAULT_TIMEOUT_MS = 60000;
const OUTPUT_SUMMARY_LIMIT = 300;

type RuntimeEnvironment = Record<string, string | undefined>;
export type CommandTemplateVariables = Record<string, string | undefined>;

export interface CommandWorkspace {
  rootDir: string;
  artifactDir: string;
  indexHtmlPath: string;
  stylesCssPath: string;
  scriptJsPath: string;
}

export function resolveCommandTemplate(
  value: string,
  variables: CommandTemplateVariables
): string {
  const resolvedValue = value.replace(TEMPLATE_PATTERN, (_, variableName: string) => {
    const resolved = variables[variableName];
    if (resolved === undefined) {
      throw new Error("skill_command_unknown_template_variable");
    }
    return resolved;
  });
  if (resolvedValue.includes("{{") || resolvedValue.includes("}}")) {
    throw new Error("skill_command_unknown_template_variable");
  }
  return resolvedValue;
}

export function resolveSkillCommandEnvironment(input: {
  manifest: SkillManifest;
  command: SkillCommandManifest;
  runtimeEnv: RuntimeEnvironment;
  variables: CommandTemplateVariables;
}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const binding of input.command.env ?? []) {
    if (binding.secretRef) {
      if (!input.manifest.requiredSecrets.includes(binding.secretRef)) {
        throw new Error("skill_command_secret_not_declared");
      }
      const value = input.runtimeEnv[binding.secretRef];
      if (!value) {
        throw new Error("skill_command_secret_missing");
      }
      env[binding.name] = value;
      continue;
    }
    if (binding.value !== undefined) {
      env[binding.name] = resolveCommandTemplate(binding.value, input.variables);
    }
  }
  return env;
}

export function resolveSkillCommandTimeout(command: SkillCommandManifest): number {
  return command.timeoutMs ?? DEFAULT_TIMEOUT_MS;
}

export async function materializeStaticArtifactsCommandWorkspace(input: {
  runId: string;
  artifacts: StaticArtifacts;
}): Promise<CommandWorkspace> {
  const rootDir = await mkdtemp(join(tmpdir(), "lp-agent-command-"));
  const artifactDir = join(rootDir, "artifacts");
  await mkdir(artifactDir, { recursive: true });
  const workspace: CommandWorkspace = {
    rootDir,
    artifactDir,
    indexHtmlPath: join(artifactDir, "index.html"),
    stylesCssPath: join(artifactDir, "styles.css"),
    scriptJsPath: join(artifactDir, "script.js")
  };
  await Promise.all([
    writeFile(workspace.indexHtmlPath, input.artifacts.indexHtml, "utf8"),
    writeFile(workspace.stylesCssPath, input.artifacts.stylesCss, "utf8"),
    writeFile(workspace.scriptJsPath, input.artifacts.scriptJs, "utf8")
  ]);
  return workspace;
}

export async function cleanupCommandWorkspace(workspace: CommandWorkspace): Promise<void> {
  await rm(workspace.rootDir, { recursive: true, force: true });
}

export function assertWorkingDirectoryAllowed(input: {
  workingDirectory?: string;
  workspace?: CommandWorkspace;
}): void {
  if (!input.workingDirectory) {
    return;
  }
  if (!input.workspace) {
    throw new Error("skill_command_working_directory_forbidden");
  }
  const root = `${resolve(input.workspace.rootDir)}/`;
  const workingDirectory = `${resolve(input.workingDirectory)}/`;
  if (!workingDirectory.startsWith(root)) {
    throw new Error("skill_command_working_directory_forbidden");
  }
}

export function redactCommandOutput(value: string, secretValues: string[]): string {
  return Array.from(new Set(secretValues))
    .filter((secret) => secret.length > 0)
    .sort((left, right) => right.length - left.length)
    .reduce((current, secret) => current.split(secret).join("[redacted]"), value);
}

export function summarizeCommandOutput(
  stdout: string,
  stderr: string,
  secretValues: string[]
): string {
  const merged = [stdout, stderr].filter((value) => value.trim().length > 0).join("\n");
  const redacted = redactCommandOutput(merged, secretValues);
  if (redacted.length <= OUTPUT_SUMMARY_LIMIT) {
    return redacted;
  }
  return `${redacted.slice(0, OUTPUT_SUMMARY_LIMIT - 3)}...`;
}

export function createArtifactTemplateVariables(input: {
  workspace?: CommandWorkspace;
  pageVersionId?: string;
}): CommandTemplateVariables {
  if (!input.workspace || !input.pageVersionId) {
    return {};
  }
  return {
    pageVersionId: input.pageVersionId,
    artifactDir: input.workspace.artifactDir,
    "artifact.indexHtmlPath": input.workspace.indexHtmlPath,
    "artifact.stylesCssPath": input.workspace.stylesCssPath,
    "artifact.scriptJsPath": input.workspace.scriptJsPath
  };
}
