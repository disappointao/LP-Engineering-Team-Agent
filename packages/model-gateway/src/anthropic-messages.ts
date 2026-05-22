import type {
  ModelProviderRuntimeConfig,
  ModelRequest,
  ModelResponse,
  ModelRoute
} from "./index";

export type ModelFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface AnthropicMessagesCompleteInput {
  request: ModelRequest;
  route: ModelRoute;
  providerConfig: ModelProviderRuntimeConfig;
  fetch?: ModelFetch;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  anthropicVersion?: string;
  maxTokens?: number;
}

export class ModelProviderConfigurationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ModelProviderConfigurationError";
  }
}

export class ModelProviderRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "ModelProviderRequestError";
  }
}

export class ModelProviderResponseError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ModelProviderResponseError";
  }
}

const defaultTimeoutMs = 30000;
const defaultMaxTokens = 1024;
const defaultAnthropicVersion = "2023-06-01";

export function toAnthropicMessagesUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (normalized.endsWith("/v1/messages")) {
    return normalized;
  }
  if (normalized.endsWith("/v1")) {
    return `${normalized}/messages`;
  }

  return `${normalized}/v1/messages`;
}

export async function completeAnthropicMessages(
  input: AnthropicMessagesCompleteInput
): Promise<ModelResponse> {
  const startedAtMs = Date.now();
  const baseUrl = trimNonEmpty(input.providerConfig.baseUrl);
  if (!baseUrl) {
    throw new ModelProviderConfigurationError(
      "model_provider_base_url_missing",
      `Model provider ${input.route.provider} is missing baseUrl`
    );
  }

  const apiKeyEnv =
    trimNonEmpty(input.providerConfig.apiKeyEnv) ??
    trimNonEmpty(input.providerConfig.secretEnvName);
  if (!apiKeyEnv) {
    throw new ModelProviderConfigurationError(
      "model_provider_api_key_env_missing",
      `Model provider ${input.route.provider} is missing apiKeyEnv`
    );
  }

  const env = input.env ?? getProcessEnv();
  const apiKey = trimNonEmpty(env[apiKeyEnv]);
  if (!apiKey) {
    throw new ModelProviderConfigurationError(
      "model_provider_api_key_missing",
      `Environment variable for provider ${input.route.provider} is not configured`
    );
  }

  const fetchImpl = input.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new ModelProviderConfigurationError(
      "model_provider_fetch_unavailable",
      "No fetch implementation is available for model provider requests"
    );
  }

  const parsed = await performAnthropicMessagesRequest({
    input,
    baseUrl,
    apiKey,
    fetch: fetchImpl
  });

  return {
    provider: input.route.provider,
    ...(input.route.providerName ? { providerName: input.route.providerName } : {}),
    api: "anthropic-messages",
    model: parsed.model ?? input.route.model,
    baseUrlConfigured: true,
    apiKeyEnvConfigured: true,
    ...(input.route.modelCapabilities
      ? { modelCapabilities: { ...input.route.modelCapabilities } }
      : {}),
    text: parsed.text,
    usage: {
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      totalTokens: parsed.inputTokens + parsed.outputTokens,
      source: "provider_reported"
    },
    call: {
      attempt: 1,
      durationMs: elapsedMs(startedAtMs),
      supportsStreaming: input.route.modelCapabilities?.supportsStreaming === true,
      streamingEnabled: false
    }
  };
}

async function performAnthropicMessagesRequest({
  input,
  baseUrl,
  apiKey,
  fetch
}: {
  input: AnthropicMessagesCompleteInput;
  baseUrl: string;
  apiKey: string;
  fetch: ModelFetch;
}): Promise<{
  text: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(
        new ModelProviderRequestError(
          "model_provider_request_timeout",
          `Model provider ${input.route.provider} request timed out`
        )
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(toAnthropicMessagesUrl(baseUrl), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": input.anthropicVersion ?? defaultAnthropicVersion
          },
          body: JSON.stringify({
            model: input.route.model,
            max_tokens: input.maxTokens ?? defaultMaxTokens,
            messages: [{ role: "user", content: input.request.prompt }]
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new ModelProviderRequestError(
            "model_provider_http_error",
            `Model provider ${input.route.provider} returned HTTP ${response.status}`,
            response.status
          );
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          if (controller.signal.aborted) {
            throw createTimeoutError(input.route.provider);
          }
          throw new ModelProviderResponseError(
            "model_provider_response_json_invalid",
            `Model provider ${input.route.provider} returned invalid JSON`
          );
        }

        return parseAnthropicMessagesResponse(payload, input.route.provider);
      })(),
      timeoutPromise
    ]);
  } catch (error) {
    if (
      error instanceof ModelProviderRequestError ||
      error instanceof ModelProviderResponseError
    ) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw createTimeoutError(input.route.provider);
    }

    throw new ModelProviderRequestError(
      "model_provider_request_failed",
      `Model provider ${input.route.provider} request failed`
    );
  } finally {
    clearTimeout(timeout);
  }
}

function createTimeoutError(providerId: string): ModelProviderRequestError {
  return new ModelProviderRequestError(
    "model_provider_request_timeout",
    `Model provider ${providerId} request timed out`
  );
}

function parseAnthropicMessagesResponse(
  payload: unknown,
  providerId: string
): {
  text: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
} {
  if (!payload || typeof payload !== "object") {
    throwInvalidShape(providerId);
  }

  const candidate = payload as {
    content?: unknown;
    model?: unknown;
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
  };

  if (!Array.isArray(candidate.content)) {
    throwInvalidShape(providerId);
  }

  const text = candidate.content
    .flatMap((block) => {
      if (!block || typeof block !== "object") {
        return [];
      }

      const contentBlock = block as { type?: unknown; text?: unknown };
      if (contentBlock.type === "text" && typeof contentBlock.text === "string") {
        return contentBlock.text.length > 0 ? [contentBlock.text] : [];
      }

      return [];
    })
    .join("\n");

  if (!text) {
    throwInvalidShape(providerId);
  }

  if (
    !candidate.usage ||
    !isValidUsageTokenCount(candidate.usage.input_tokens) ||
    !isValidUsageTokenCount(candidate.usage.output_tokens)
  ) {
    throwInvalidShape(providerId);
  }

  return {
    text,
    ...(typeof candidate.model === "string" && candidate.model.length > 0
      ? { model: candidate.model }
      : {}),
    inputTokens: candidate.usage.input_tokens,
    outputTokens: candidate.usage.output_tokens
  };
}

function throwInvalidShape(providerId: string): never {
  throw new ModelProviderResponseError(
    "model_provider_response_shape_invalid",
    `Model provider ${providerId} returned an unsupported response shape`
  );
}

function isValidUsageTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function elapsedMs(startedAtMs: number): number {
  return Math.max(0, Math.round(Date.now() - startedAtMs));
}

function trimNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function getProcessEnv(): Record<string, string | undefined> {
  return typeof process === "undefined" ? {} : process.env;
}
