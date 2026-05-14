import {
  ModelProviderConfigurationError,
  ModelProviderRequestError,
  ModelProviderResponseError,
  type ModelFetch
} from "./anthropic-messages";
import type {
  ModelProviderRuntimeConfig,
  ModelRequest,
  ModelResponse,
  ModelRoute
} from "./index";

export interface OpenAIChatCompletionsCompleteInput {
  request: ModelRequest;
  route: ModelRoute;
  providerConfig: ModelProviderRuntimeConfig;
  fetch?: ModelFetch;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  maxTokens?: number;
}

const defaultTimeoutMs = 30000;

export function toOpenAIChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
}

export async function completeOpenAIChatCompletions(
  input: OpenAIChatCompletionsCompleteInput
): Promise<ModelResponse> {
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

  const parsed = await performOpenAIChatCompletionsRequest({
    input,
    baseUrl,
    apiKey,
    fetch: fetchImpl
  });

  return {
    provider: input.route.provider,
    ...(input.route.providerName ? { providerName: input.route.providerName } : {}),
    api: "openai-completions",
    model: parsed.model ?? input.route.model,
    baseUrlConfigured: true,
    apiKeyEnvConfigured: true,
    ...(input.route.modelCapabilities
      ? { modelCapabilities: { ...input.route.modelCapabilities } }
      : {}),
    text: parsed.text,
    usage: {
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens
    }
  };
}

async function performOpenAIChatCompletionsRequest({
  input,
  baseUrl,
  apiKey,
  fetch
}: {
  input: OpenAIChatCompletionsCompleteInput;
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
        const response = await fetch(toOpenAIChatCompletionsUrl(baseUrl), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify(createRequestBody(input)),
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

        return parseOpenAIChatCompletionsResponse(payload, input.route.provider);
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

function createRequestBody(input: OpenAIChatCompletionsCompleteInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.route.model,
    messages: [{ role: "user", content: input.request.prompt }],
    stream: false
  };
  const maxTokens = resolveMaxTokens(input);
  if (maxTokens !== undefined) {
    body.max_tokens = maxTokens;
  }
  return body;
}

function resolveMaxTokens(input: OpenAIChatCompletionsCompleteInput): number | undefined {
  if (isPositiveInteger(input.maxTokens)) {
    return input.maxTokens;
  }
  const compatMaxTokens =
    input.providerConfig.compat?.maxTokens ?? input.providerConfig.compat?.max_tokens;
  return isPositiveInteger(compatMaxTokens) ? compatMaxTokens : undefined;
}

function createTimeoutError(providerId: string): ModelProviderRequestError {
  return new ModelProviderRequestError(
    "model_provider_request_timeout",
    `Model provider ${providerId} request timed out`
  );
}

function parseOpenAIChatCompletionsResponse(
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
    model?: unknown;
    choices?: unknown;
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  };

  if (!Array.isArray(candidate.choices) || candidate.choices.length === 0) {
    throwInvalidShape(providerId);
  }
  const firstChoice = candidate.choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    throwInvalidShape(providerId);
  }
  const message = (firstChoice as { message?: unknown }).message;
  if (!message || typeof message !== "object") {
    throwInvalidShape(providerId);
  }

  const text = parseMessageContent((message as { content?: unknown }).content);
  if (!text) {
    throwInvalidShape(providerId);
  }

  if (
    !candidate.usage ||
    !isValidUsageTokenCount(candidate.usage.prompt_tokens) ||
    !isValidUsageTokenCount(candidate.usage.completion_tokens)
  ) {
    throwInvalidShape(providerId);
  }

  return {
    text,
    ...(typeof candidate.model === "string" && candidate.model.length > 0
      ? { model: candidate.model }
      : {}),
    inputTokens: candidate.usage.prompt_tokens,
    outputTokens: candidate.usage.completion_tokens
  };
}

function parseMessageContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed ? content : undefined;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const text = content
    .flatMap((part) => {
      if (!part || typeof part !== "object") {
        return [];
      }
      const contentPart = part as { type?: unknown; text?: unknown };
      if (contentPart.type === "text" && typeof contentPart.text === "string") {
        return contentPart.text.trim().length > 0 ? [contentPart.text] : [];
      }
      return [];
    })
    .join("\n");
  return text.length > 0 ? text : undefined;
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

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function trimNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function getProcessEnv(): Record<string, string | undefined> {
  return typeof process === "undefined" ? {} : process.env;
}
