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
  ModelRoute,
  ModelStreamEvent,
  ModelUsageMetadata
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

export interface OpenAIChatCompletionsStreamInput
  extends OpenAIChatCompletionsCompleteInput {}

const defaultTimeoutMs = 30000;
const maxStreamDeltaChars = 4096;

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
      outputTokens: parsed.outputTokens,
      totalTokens: parsed.totalTokens,
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

export async function* streamOpenAIChatCompletions(
  input: OpenAIChatCompletionsStreamInput
): AsyncIterable<ModelStreamEvent> {
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

  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(toOpenAIChatCompletionsUrl(baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(createRequestBody(input, { streaming: true })),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new ModelProviderRequestError(
        "model_provider_http_error",
        `Model provider ${input.route.provider} returned HTTP ${response.status}`,
        response.status
      );
    }

    let text = "";
    let model: string | undefined;
    let usage: ModelUsageMetadata | undefined;

    for await (const data of readSSEDataFrames(response, input.route.provider)) {
      if (data === "[DONE]") {
        continue;
      }
      const payload = parseStreamJson(data, input.route.provider);
      const parsed = parseOpenAIChatCompletionsStreamFrame(payload, input.route.provider);
      if (parsed.model) {
        model = parsed.model;
      }
      if (parsed.usage) {
        usage = parsed.usage;
      }
      for (const delta of parsed.textDeltas) {
        text += delta;
        for (const bounded of chunkText(delta, maxStreamDeltaChars)) {
          yield {
            type: "model.delta",
            text: bounded
          };
        }
      }
    }

    if (!text.trim()) {
      throwInvalidShape(input.route.provider);
    }

    yield {
      type: "model.completed",
      response: {
        provider: input.route.provider,
        ...(input.route.providerName ? { providerName: input.route.providerName } : {}),
        api: "openai-completions",
        model: model ?? input.route.model,
        baseUrlConfigured: true,
        apiKeyEnvConfigured: true,
        ...(input.route.modelCapabilities
          ? { modelCapabilities: { ...input.route.modelCapabilities } }
          : {}),
        text,
        usage: usage ?? estimateUsage(input.request.prompt, text),
        call: {
          attempt: 1,
          durationMs: elapsedMs(startedAtMs),
          supportsStreaming: input.route.modelCapabilities?.supportsStreaming === true,
          streamingEnabled: true
        }
      }
    };
  } catch (error) {
    if (
      error instanceof ModelProviderRequestError ||
      error instanceof ModelProviderResponseError
    ) {
      throw error;
    }
    if (timedOut || controller.signal.aborted) {
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
  totalTokens: number;
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

function createRequestBody(
  input: OpenAIChatCompletionsCompleteInput,
  options: { streaming?: boolean } = {}
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.route.model,
    messages: [{ role: "user", content: input.request.prompt }],
    stream: options.streaming === true
  };
  if (options.streaming) {
    body.stream_options = { include_usage: true };
  }
  const maxTokens = resolveMaxTokens(input);
  if (maxTokens !== undefined) {
    body.max_tokens = maxTokens;
  }
  return body;
}

function parseOpenAIChatCompletionsStreamFrame(
  payload: unknown,
  providerId: string
): {
  textDeltas: string[];
  model?: string;
  usage?: ModelUsageMetadata;
} {
  if (!payload || typeof payload !== "object") {
    throwInvalidShape(providerId);
  }

  const candidate = payload as {
    model?: unknown;
    choices?: unknown;
    usage?: unknown;
  };
  const textDeltas: string[] = [];
  if (candidate.choices !== undefined) {
    if (!Array.isArray(candidate.choices)) {
      throwInvalidShape(providerId);
    }
    for (const choice of candidate.choices) {
      if (!choice || typeof choice !== "object") {
        throwInvalidShape(providerId);
      }
      const delta = (choice as { delta?: unknown }).delta;
      if (delta === undefined) {
        continue;
      }
      if (!delta || typeof delta !== "object") {
        throwInvalidShape(providerId);
      }
      const content = (delta as { content?: unknown }).content;
      if (typeof content === "string" && content.length > 0) {
        textDeltas.push(content);
      }
    }
  }

  const usage = parseOpenAIUsage(candidate.usage, providerId);
  if (textDeltas.length === 0 && !usage) {
    return {
      ...(typeof candidate.model === "string" && candidate.model.length > 0
        ? { model: candidate.model }
        : {}),
      textDeltas
    };
  }

  return {
    ...(typeof candidate.model === "string" && candidate.model.length > 0
      ? { model: candidate.model }
      : {}),
    textDeltas,
    ...(usage ? { usage } : {})
  };
}

function parseOpenAIUsage(
  usage: unknown,
  providerId: string
): ModelUsageMetadata | undefined {
  if (usage === undefined || usage === null) {
    return undefined;
  }
  if (typeof usage !== "object") {
    throwInvalidShape(providerId);
  }
  const candidate = usage as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
  if (
    !isValidUsageTokenCount(candidate.prompt_tokens) ||
    !isValidUsageTokenCount(candidate.completion_tokens) ||
    (candidate.total_tokens !== undefined &&
      !isValidUsageTokenCount(candidate.total_tokens))
  ) {
    throwInvalidShape(providerId);
  }
  const totalTokens =
    candidate.total_tokens ?? candidate.prompt_tokens + candidate.completion_tokens;
  return {
    inputTokens: candidate.prompt_tokens,
    outputTokens: candidate.completion_tokens,
    totalTokens,
    source: "provider_reported"
  };
}

function parseStreamJson(data: string, providerId: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    throwInvalidShape(providerId);
  }
}

async function* readSSEDataFrames(
  response: Response,
  providerId: string
): AsyncIterable<string> {
  let buffer = "";
  for await (const chunk of readResponseTextChunks(response)) {
    buffer += chunk;
    for (;;) {
      const boundary = findSSEBoundary(buffer);
      if (!boundary) {
        break;
      }
      const rawFrame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.length);
      const data = extractSSEData(rawFrame);
      if (data) {
        yield data;
      }
    }
  }

  if (buffer.trim().length > 0) {
    const data = extractSSEData(buffer);
    if (!data) {
      throwInvalidShape(providerId);
    }
    yield data;
  }
}

async function* readResponseTextChunks(response: Response): AsyncIterable<string> {
  const body = response.body;
  if (!body || typeof body.getReader !== "function") {
    yield await response.text();
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const read = await reader.read();
      if (read.done) {
        break;
      }
      yield decoder.decode(read.value, { stream: true });
    }
    const flushed = decoder.decode();
    if (flushed) {
      yield flushed;
    }
  } finally {
    reader.releaseLock();
  }
}

function findSSEBoundary(buffer: string): { index: number; length: number } | undefined {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  const candidates = [
    ...(lf >= 0 ? [{ index: lf, length: 2 }] : []),
    ...(crlf >= 0 ? [{ index: crlf, length: 4 }] : [])
  ].sort((left, right) => left.index - right.index);
  return candidates[0];
}

function extractSSEData(rawFrame: string): string | undefined {
  const data = rawFrame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n")
    .trim();
  return data.length > 0 ? data : undefined;
}

function estimateUsage(prompt: string, text: string): ModelUsageMetadata {
  const inputTokens = Math.ceil(prompt.length / 4);
  const outputTokens = Math.ceil(text.length / 4);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    source: "estimated"
  };
}

function chunkText(text: string, size: number): string[] {
  if (text.length === 0) {
    return [];
  }
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
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
  totalTokens: number;
} {
  if (!payload || typeof payload !== "object") {
    throwInvalidShape(providerId);
  }

  const candidate = payload as {
    model?: unknown;
    choices?: unknown;
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      total_tokens?: unknown;
    };
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
    !isValidUsageTokenCount(candidate.usage.completion_tokens) ||
    (candidate.usage.total_tokens !== undefined &&
      !isValidUsageTokenCount(candidate.usage.total_tokens))
  ) {
    throwInvalidShape(providerId);
  }

  const totalTokens =
    candidate.usage.total_tokens ?? candidate.usage.prompt_tokens + candidate.usage.completion_tokens;

  return {
    text,
    ...(typeof candidate.model === "string" && candidate.model.length > 0
      ? { model: candidate.model }
      : {}),
    inputTokens: candidate.usage.prompt_tokens,
    outputTokens: candidate.usage.completion_tokens,
    totalTokens
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
