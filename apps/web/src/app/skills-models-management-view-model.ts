import type { AgentRole, ProjectSkillState } from "@lp-agent/api";
import type { WorkbenchCopy } from "../lib/i18n";
import type { ProjectSkillCommandView, WebProjectModelState } from "../lib/workbench-store";

export const skillManagementNoticeValues = [
  "draft_created",
  "validated",
  "published",
  "bound",
  "enabled",
  "disabled",
  "command_queued",
  "worker_ran"
] as const;

export type SkillManagementNotice = (typeof skillManagementNoticeValues)[number];

export const modelManagementNoticeValues = [
  "provider_created",
  "provider_enabled",
  "provider_disabled",
  "route_saved"
] as const;

export type ModelManagementNotice = (typeof modelManagementNoticeValues)[number];

export const modelManagementRoleOrder = [
  "assistant",
  "planner",
  "builder",
  "reviewer",
  "deployer"
] as const satisfies readonly AgentRole[];

export type SkillLifecycleStage =
  | "draft"
  | "validated"
  | "published"
  | "bound"
  | "enabled"
  | "disabled";

export type SkillNextAction =
  | "validate"
  | "publish"
  | "bind"
  | "enable"
  | "disable"
  | "none";

export interface SkillManagementVersionRow {
  id: string;
  skillId: string;
  skillName: string;
  version: string;
  type: string;
  scope: string;
  reviewState: string;
  manifestReviewState: string;
  createdAt: string;
  permissionCount: number;
  requiredSecretCount: number;
  entrypointCount: number;
  commandCount: number;
  bindingId?: string;
  bindingEnabled?: boolean;
  stage: SkillLifecycleStage;
  stageLabel: string;
  nextAction: SkillNextAction;
  nextActionLabel: string;
}

export interface SkillManagementCommandRow {
  skillId: string;
  skillName: string;
  skillVersionId: string;
  commandId: string;
  commandName: string;
  permission: string;
  requiresApproval: boolean;
  approvalLabel: string;
}

export interface SkillsManagementViewModel {
  notice?: SkillManagementNotice;
  noticeMessage?: string;
  activeSkillCount: number;
  commandCount: number;
  runtimeSummary: string;
  versionRows: SkillManagementVersionRow[];
  boundRows: SkillManagementVersionRow[];
  commandRows: SkillManagementCommandRow[];
}

export type ModelRouteState = "configured" | "fallback" | "failClosed";
export type ModelProviderState = "enabled" | "disabled";
export type ModelMetadataState = string;
export type ModelDiagnosticCode =
  | "model_provider_disabled"
  | "model_route_provider_invalid"
  | "model_id_required";

export interface ModelManagementProviderRow {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
  api: string;
  apiLabel: string;
  modelCount: number;
  modelIds: string[];
  state: ModelProviderState;
  stateLabel: string;
  baseUrlState: ModelMetadataState;
  secretState: ModelMetadataState;
  createdAt: string;
  updatedAt: string;
}

export interface ModelManagementRouteRow {
  role: AgentRole;
  roleLabel: string;
  routeId?: string;
  providerId?: string;
  providerName?: string;
  model?: string;
  state: ModelRouteState;
  stateLabel: string;
  resolvedLabel: string;
  diagnosticCode?: ModelDiagnosticCode;
  diagnosticMessage?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ModelsManagementViewModel {
  notice?: ModelManagementNotice;
  noticeMessage?: string;
  enabledProviderCount: number;
  totalProviderCount: number;
  configuredRouteCount: number;
  totalRouteCount: number;
  providerSummary: string;
  routeSummary: string;
  providerRows: ModelManagementProviderRow[];
  routeRows: ModelManagementRouteRow[];
}

export function toSkillManagementNotice(value?: string): SkillManagementNotice | undefined {
  return skillManagementNoticeValues.includes(value as SkillManagementNotice)
    ? (value as SkillManagementNotice)
    : undefined;
}

export function toModelManagementNotice(value?: string): ModelManagementNotice | undefined {
  return modelManagementNoticeValues.includes(value as ModelManagementNotice)
    ? (value as ModelManagementNotice)
    : undefined;
}

export function buildSkillsManagementViewModel(input: {
  copy: WorkbenchCopy;
  skillState: ProjectSkillState;
  skillCommands: ProjectSkillCommandView[];
  notice?: string;
}): SkillsManagementViewModel {
  const notice = toSkillManagementNotice(input.notice);
  const bindingsByVersionId = new Map(
    input.skillState.boundSkills.map((boundSkill) => [boundSkill.version.id, boundSkill])
  );
  const commandRows = input.skillCommands.map((command) => ({
    skillId: command.skillId,
    skillName: command.skillName,
    skillVersionId: command.skillVersionId,
    commandId: command.commandId,
    commandName: command.commandName,
    permission: command.permission,
    requiresApproval: command.requiresApproval,
    approvalLabel: command.requiresApproval
      ? input.copy.skillsView.commandApprovalRequired
      : input.copy.skillsView.commandApprovalNotRequired
  }));
  const versionRows = input.skillState.availableVersions.map((version) => {
    const boundSkill = bindingsByVersionId.get(version.id);
    return buildSkillVersionRow({ copy: input.copy, version, boundSkill });
  });
  const boundRows = input.skillState.boundSkills.map((boundSkill) =>
    buildSkillVersionRow({ copy: input.copy, version: boundSkill.version, boundSkill })
  );
  const activeSkillCount = input.skillState.boundSkills.filter(
    (boundSkill) =>
      boundSkill.binding.enabled &&
      boundSkill.version.reviewState === "published" &&
      boundSkill.version.manifest.reviewState === "published"
  ).length;

  return {
    notice,
    noticeMessage: notice ? input.copy.skillsView.management.notices[notice] : undefined,
    activeSkillCount,
    commandCount: commandRows.length,
    runtimeSummary: input.copy.skillsView.management.runtimeSummary(
      activeSkillCount,
      commandRows.length
    ),
    versionRows,
    boundRows,
    commandRows
  };
}

export function buildModelsManagementViewModel(input: {
  copy: WorkbenchCopy;
  modelState: WebProjectModelState;
  notice?: string;
}): ModelsManagementViewModel {
  const notice = toModelManagementNotice(input.notice);
  const providerRows: ModelManagementProviderRow[] = input.modelState.providers.map((provider) => {
    const baseUrlConfigured = Boolean(provider.config.baseUrl?.trim());
    const secretEnvName = provider.config.apiKeyEnv ?? provider.config.secretEnvName;
    const secretConfigured = Boolean(secretEnvName?.trim());
    const metadataStates = input.copy.modelsView.management.metadataStates;

    return {
      id: provider.id,
      name: provider.name,
      provider: provider.provider,
      providerLabel: input.copy.modelsView.providerTypes[provider.provider],
      api: provider.config.api,
      apiLabel: input.copy.modelsView.providerApis[provider.config.api],
      modelCount: provider.config.models?.length ?? 0,
      modelIds: provider.config.models?.map((model) => model.id) ?? [],
      state: provider.enabled ? "enabled" : "disabled",
      stateLabel: provider.enabled
        ? input.copy.modelsView.management.providerStates.enabled
        : input.copy.modelsView.management.providerStates.disabled,
      baseUrlState: baseUrlConfigured
        ? metadataStates.configured
        : metadataStates.notConfigured,
      secretState: secretConfigured ? metadataStates.configured : metadataStates.notConfigured,
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt
    };
  });
  const providersById = new Map(input.modelState.providers.map((provider) => [provider.id, provider]));
  const routesByRole = new Map(input.modelState.routes.map((route) => [route.role, route]));
  const routeRows: ModelManagementRouteRow[] = modelManagementRoleOrder.map((role) => {
    const route = routesByRole.get(role);
    const resolved = input.modelState.resolvedPolicy[role];
    const resolvedLabel = `${resolved.provider}/${resolved.model}`;
    const roleLabel = input.copy.modelsView.roleLabels[role];

    if (!route) {
      return {
        role,
        roleLabel,
        state: "fallback",
        stateLabel: input.copy.modelsView.management.routeStates.fallback,
        resolvedLabel
      };
    }

    const provider = providersById.get(route.providerId);
    const diagnosticCode = getRouteDiagnosticCode(route, provider);
    if (diagnosticCode) {
      return {
        role,
        roleLabel,
        routeId: route.id,
        providerId: route.providerId,
        providerName: provider?.name,
        model: route.model,
        state: "failClosed",
        stateLabel: input.copy.modelsView.management.routeStates.failClosed,
        resolvedLabel,
        diagnosticCode,
        diagnosticMessage: input.copy.modelsView.errors[diagnosticCode],
        createdAt: route.createdAt,
        updatedAt: route.updatedAt
      };
    }

    return {
      role,
      roleLabel,
      routeId: route.id,
      providerId: route.providerId,
      providerName: provider?.name,
      model: route.model,
      state: "configured",
      stateLabel: input.copy.modelsView.management.routeStates.configured,
      resolvedLabel,
      createdAt: route.createdAt,
      updatedAt: route.updatedAt
    };
  });
  const enabledProviderCount = input.modelState.providers.filter((provider) => provider.enabled).length;
  const configuredRouteCount = routeRows.filter((route) => route.state === "configured").length;

  return {
    notice,
    noticeMessage: notice ? input.copy.modelsView.management.notices[notice] : undefined,
    enabledProviderCount,
    totalProviderCount: input.modelState.providers.length,
    configuredRouteCount,
    totalRouteCount: modelManagementRoleOrder.length,
    providerSummary: input.copy.modelsView.management.providerCount(
      enabledProviderCount,
      input.modelState.providers.length
    ),
    routeSummary: input.copy.modelsView.management.routeCount(
      configuredRouteCount,
      modelManagementRoleOrder.length
    ),
    providerRows,
    routeRows
  };
}

function buildSkillVersionRow(input: {
  copy: WorkbenchCopy;
  version: ProjectSkillState["availableVersions"][number];
  boundSkill?: ProjectSkillState["boundSkills"][number];
}): SkillManagementVersionRow {
  const stage = getSkillLifecycleStage(input.version, input.boundSkill);
  const nextAction = getSkillNextAction(stage);

  return {
    id: input.version.id,
    skillId: input.version.skillId,
    skillName: input.version.manifest.name,
    version: input.version.version,
    type: input.version.manifest.type,
    scope: input.version.manifest.scope,
    reviewState: input.version.reviewState,
    manifestReviewState: input.version.manifest.reviewState,
    createdAt: input.version.createdAt,
    permissionCount: input.version.manifest.permissions.length,
    requiredSecretCount: input.version.manifest.requiredSecrets.length,
    entrypointCount: input.version.manifest.entrypoints.length,
    commandCount: input.version.manifest.commands?.length ?? 0,
    bindingId: input.boundSkill?.binding.id,
    bindingEnabled: input.boundSkill?.binding.enabled,
    stage,
    stageLabel: input.copy.skillsView.management.lifecycleStages[stage],
    nextAction,
    nextActionLabel: input.copy.skillsView.management.nextActions[nextAction]
  };
}

function getSkillLifecycleStage(
  version: ProjectSkillState["availableVersions"][number],
  boundSkill?: ProjectSkillState["boundSkills"][number]
): SkillLifecycleStage {
  if (version.reviewState === "draft" || version.manifest.reviewState === "draft") {
    return "draft";
  }
  if (version.reviewState === "validated" || version.manifest.reviewState === "validated") {
    return "validated";
  }
  if (version.reviewState === "published" && version.manifest.reviewState === "published") {
    if (!boundSkill) {
      return "published";
    }
    return boundSkill.binding.enabled ? "enabled" : "disabled";
  }

  return "published";
}

function getSkillNextAction(stage: SkillLifecycleStage): SkillNextAction {
  if (stage === "enabled") {
    return "disable";
  }
  if (stage === "disabled") {
    return "enable";
  }
  if (stage === "draft") {
    return "validate";
  }
  if (stage === "validated") {
    return "publish";
  }
  if (stage === "published") {
    return "bind";
  }
  return "none";
}

function getRouteDiagnosticCode(
  route: WebProjectModelState["routes"][number],
  provider: WebProjectModelState["providers"][number] | undefined
): ModelDiagnosticCode | undefined {
  if (!provider) {
    return "model_route_provider_invalid";
  }
  if (!provider.enabled) {
    return "model_provider_disabled";
  }
  if (!route.model.trim()) {
    return "model_id_required";
  }
  return undefined;
}
