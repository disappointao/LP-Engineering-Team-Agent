import type { ProjectRecord } from "@lp-agent/db";
import type {
  RuntimeRunContext,
  RuntimeSkillContext
} from "@lp-agent/runtime-adapters";
import type { ContextAssemblyTrace } from "./context-assembler";

const maxSkillContentChars = 1200;
const maxMemoryMessages = 6;
const maxPromptChars = 12000;

export interface AssistantContextSummarySkill {
  id: string;
  name: string;
  version: string;
  content?: string;
}

export interface AssistantContextSummary {
  projectId: string;
  projectName: string;
  runtimeMode: "deterministic" | "real";
  skillCount: number;
  skills: Array<{ id: string; name: string; version: string }>;
}

export function createAssistantContextSummary(input: {
  project: Pick<ProjectRecord, "id" | "name">;
  runtimeMode: AssistantContextSummary["runtimeMode"];
  skills: AssistantContextSummarySkill[];
}): AssistantContextSummary {
  return {
    projectId: input.project.id,
    projectName: input.project.name,
    runtimeMode: input.runtimeMode,
    skillCount: input.skills.length,
    skills: input.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      version: skill.version
    }))
  };
}

export function createAssistantChatPrompt(input: {
  userPrompt: string;
  project: Pick<ProjectRecord, "id" | "name">;
  context: RuntimeRunContext;
  trace: ContextAssemblyTrace;
}): string {
  const contextSections = [
    "You are the ordinary chat assistant for LP Engineering Team Agent.",
    "Answer the user directly using the project context below.",
    "Do not claim that you executed MCP tools, shell commands, deployments, or artifact edits.",
    "If the user asks to create or modify an LP, explain the next step without inventing generated files.",
    `Project: ${input.project.name} (${input.project.id})`,
    formatSkills(input.context.skills),
    formatMemory(input.context),
    `Context trace: injected=${input.trace.injected.join(", ") || "none"}; omitted=${input.trace.omitted.join(", ") || "none"}`
  ];
  const userSection = formatBoundedUserMessage(input.userPrompt);
  const separator = "\n\n";
  const contextBudget = Math.max(0, maxPromptChars - userSection.length - separator.length);
  const boundedContext = contextSections.join(separator).slice(0, contextBudget);

  return boundedContext.length > 0
    ? [boundedContext, userSection].join(separator)
    : userSection;
}

function formatSkills(skills: RuntimeSkillContext[]): string {
  if (skills.length === 0) {
    return "Project skills: none";
  }

  return [
    "Project skills:",
    ...skills.map((skill) =>
      [
        `Skill: ${skill.name}@${skill.version}`,
        `Scope: ${skill.scope}`,
        `Entrypoints: ${skill.entrypoints.join(", ") || "none"}`,
        `Permissions: ${skill.permissions.join(", ") || "none"}`,
        `Content excerpt: ${skill.content.slice(0, maxSkillContentChars)}`
      ].join("\n")
    )
  ].join("\n\n");
}

function formatMemory(context: RuntimeRunContext): string {
  const memory = context.memory;
  if (!memory || memory.messages.length === 0) {
    return "Relevant memory: none";
  }

  return [
    "Relevant memory:",
    ...memory.messages
      .slice(0, maxMemoryMessages)
      .map((message) => `${message.role}: ${message.preview}`)
  ].join("\n");
}

function formatBoundedUserMessage(userPrompt: string): string {
  const label = "User message:\n";
  const promptBudget = Math.max(0, maxPromptChars - label.length);
  return `${label}${userPrompt.trim().slice(0, promptBudget)}`;
}
