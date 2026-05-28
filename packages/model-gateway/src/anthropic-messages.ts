import type {
  ModelProviderRuntimeConfig,
  ModelProviderStreamTimeouts,
  ModelRequest,
  ModelResponse,
  ModelRoute,
  ModelStreamEvent,
  ModelUsageMetadata
} from "./index";
import {
  createModelProviderStreamTimeoutController,
  resolveModelProviderStreamTimeouts
} from "./stream-timeouts";

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

export interface AnthropicMessagesStreamInput extends AnthropicMessagesCompleteInput {
  streamTimeouts?: ModelProviderStreamTimeouts;
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
const defaultStreamTimeouts = {
  firstByteMs: 180_000,
  idleMs: 180_000,
  maxDurationMs: 900_000
};
const defaultMaxTokens = 1024;
const defaultAnthropicVersion = "2023-06-01";
const maxStreamDeltaChars = 4096;

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

export async function* streamAnthropicMessages(
  input: AnthropicMessagesStreamInput
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

  const timeoutController = createModelProviderStreamTimeoutController(
    resolveModelProviderStreamTimeouts(input.streamTimeouts, defaultStreamTimeouts)
  );

  try {
    const response = await fetchImpl(toAnthropicMessagesUrl(baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": input.anthropicVersion ?? defaultAnthropicVersion
      },
      body: JSON.stringify(createRequestBody(input, { streaming: true })),
      signal: timeoutController.signal
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
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    if (!isEventStreamResponse(response)) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        if (timeoutController.timedOut || timeoutController.signal.aborted) {
          throw createTimeoutError(input.route.provider);
        }
        throw new ModelProviderResponseError(
          "model_provider_response_json_invalid",
          `Model provider ${input.route.provider} returned invalid JSON`
        );
      }
      const parsed = parseAnthropicMessagesResponse(payload, input.route.provider);
      for (const bounded of chunkText(parsed.text, maxStreamDeltaChars)) {
        yield {
          type: "model.delta",
          text: bounded
        };
      }
      yield {
        type: "model.completed",
        response: {
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
        }
      };
      return;
    }

    for await (const data of readSSEDataFrames(response, input.route.provider, {
      onChunk: timeoutController.markProgress
    })) {
      const payload = parseStreamJson(data, input.route.provider);
      const parsed = parseAnthropicMessagesStreamFrame(payload, input.route.provider);
      if (parsed.model) {
        model = parsed.model;
      }
      if (parsed.inputTokens !== undefined) {
        inputTokens = parsed.inputTokens;
      }
      if (parsed.outputTokens !== undefined) {
        outputTokens = parsed.outputTokens;
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

    const usage =
      inputTokens !== undefined && outputTokens !== undefined
        ? {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            source: "provider_reported" as const
          }
        : estimateUsage(input.request.prompt, text);

    yield {
      type: "model.completed",
      response: {
        provider: input.route.provider,
        ...(input.route.providerName ? { providerName: input.route.providerName } : {}),
        api: "anthropic-messages",
        model: model ?? input.route.model,
        baseUrlConfigured: true,
        apiKeyEnvConfigured: true,
        ...(input.route.modelCapabilities
          ? { modelCapabilities: { ...input.route.modelCapabilities } }
          : {}),
        text,
        usage,
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
    if (timeoutController.timedOut || timeoutController.signal.aborted) {
      throw createTimeoutError(input.route.provider);
    }

    throw new ModelProviderRequestError(
      "model_provider_request_failed",
      `Model provider ${input.route.provider} request failed`
    );
  } finally {
    timeoutController.clear();
  }
}

function isEventStreamResponse(response: Response): boolean {
  return response.headers.get("content-type")?.toLowerCase().includes("text/event-stream") ?? false;
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

function createRequestBody(
  input: AnthropicMessagesCompleteInput,
  options: { streaming?: boolean } = {}
): Record<string, unknown> {
  return {
    model: input.route.model,
    max_tokens: input.maxTokens ?? defaultMaxTokens,
    messages: [{ role: "user", content: input.request.prompt }],
    ...(options.streaming ? { stream: true } : {})
  };
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

function parseAnthropicMessagesStreamFrame(
  payload: unknown,
  providerId: string
): {
  textDeltas: string[];
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
} {
  if (!payload || typeof payload !== "object") {
    throwInvalidShape(providerId);
  }

  const candidate = payload as {
    type?: unknown;
    delta?: unknown;
    message?: unknown;
    usage?: unknown;
  };
  const type = typeof candidate.type === "string" ? candidate.type : undefined;
  const textDeltas: string[] = [];
  let model: string | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  if (type === "content_block_delta") {
    if (!candidate.delta || typeof candidate.delta !== "object") {
      throwInvalidShape(providerId);
    }
    const delta = candidate.delta as { type?: unknown; text?: unknown };
    if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
      textDeltas.push(delta.text);
    }
  }

  if (type === "message_start") {
    if (!candidate.message || typeof candidate.message !== "object") {
      throwInvalidShape(providerId);
    }
    const message = candidate.message as {
      model?: unknown;
      usage?: { input_tokens?: unknown; output_tokens?: unknown };
    };
    if (typeof message.model === "string" && message.model.length > 0) {
      model = message.model;
    }
    if (message.usage) {
      if (
        !isValidUsageTokenCount(message.usage.input_tokens) ||
        !isValidUsageTokenCount(message.usage.output_tokens)
      ) {
        throwInvalidShape(providerId);
      }
      inputTokens = message.usage.input_tokens;
      outputTokens = message.usage.output_tokens;
    }
  }

  if (type === "message_delta" && candidate.usage !== undefined) {
    if (!candidate.usage || typeof candidate.usage !== "object") {
      throwInvalidShape(providerId);
    }
    const usage = candidate.usage as { output_tokens?: unknown };
    if (!isValidUsageTokenCount(usage.output_tokens)) {
      throwInvalidShape(providerId);
    }
    outputTokens = usage.output_tokens;
  }

  return {
    textDeltas,
    ...(model ? { model } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {})
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
  providerId: string,
  options: { onChunk?: () => void } = {}
): AsyncIterable<string> {
  let buffer = "";
  for await (const chunk of readResponseTextChunks(response, options)) {
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

async function* readResponseTextChunks(
  response: Response,
  options: { onChunk?: () => void } = {}
): AsyncIterable<string> {
  const body = response.body;
  if (!body || typeof body.getReader !== "function") {
    const text = await response.text();
    options.onChunk?.();
    yield text;
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
      options.onChunk?.();
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
