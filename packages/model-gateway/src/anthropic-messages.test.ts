import { describe, expect, it } from "vitest";
import {
  ProviderBackedModelGateway,
  createDefaultModelPolicy,
  toAnthropicMessagesUrl,
  type ModelFetch,
  type ModelProviderRuntimeRecord,
  type ModelRoutingPolicy
} from "./index";

function createZhipuProvider(config: Partial<ModelProviderRuntimeRecord["config"]> = {}) {
  return {
    id: "zhipu",
    name: "智谱 GLM",
    enabled: true,
    config: {
      api: "anthropic-messages",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      models: [
        {
          id: "glm-5.1",
          contextWindow: 200000,
          maxTokens: 128000,
          supportsTools: true,
          supportsStreaming: true
        }
      ],
      ...config
    }
  } satisfies ModelProviderRuntimeRecord;
}

function createPolicy(): ModelRoutingPolicy {
  return {
    ...createDefaultModelPolicy(),
    builder: {
      provider: "zhipu",
      providerName: "智谱 GLM",
      api: "anthropic-messages",
      model: "glm-5.1",
      baseUrlConfigured: true,
      apiKeyEnvConfigured: true,
      modelCapabilities: {
        contextWindow: 200000,
        maxTokens: 128000,
        supportsTools: true,
        supportsStreaming: true
      }
    }
  };
}

describe("anthropic messages model gateway", () => {
  it("normalizes Anthropic Messages endpoint URLs", () => {
    expect(toAnthropicMessagesUrl("https://open.bigmodel.cn/api/anthropic")).toBe(
      "https://open.bigmodel.cn/api/anthropic/v1/messages"
    );
    expect(toAnthropicMessagesUrl("https://api.anthropic.com/v1")).toBe(
      "https://api.anthropic.com/v1/messages"
    );
    expect(toAnthropicMessagesUrl("https://api.anthropic.com/v1/messages")).toBe(
      "https://api.anthropic.com/v1/messages"
    );
    expect(toAnthropicMessagesUrl("https://api.anthropic.com/v1/messages/")).toBe(
      "https://api.anthropic.com/v1/messages"
    );
  });

  it("calls an Anthropic-compatible provider with a single-turn prompt", async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fakeFetch: ModelFetch = async (input, init) => {
      calls.push({ input, init });
      return new Response(
        JSON.stringify({
          type: "message",
          model: "glm-5.1",
          content: [{ type: "text", text: "你好，LP 已准备生成。" }],
          usage: { input_tokens: 12, output_tokens: 8 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider(providerId) {
          return providerId === "zhipu" ? createZhipuProvider() : undefined;
        }
      },
      fetch: fakeFetch,
      env: { ANTHROPIC_API_KEY: "sk-test-secret" }
    });

    const result = await gateway.complete({
      role: "builder",
      projectId: "project_1",
      prompt: "生成一个电商 LP",
      routingPolicy: createPolicy()
    });

    expect(result).toMatchObject({
      provider: "zhipu",
      providerName: "智谱 GLM",
      api: "anthropic-messages",
      model: "glm-5.1",
      baseUrlConfigured: true,
      apiKeyEnvConfigured: true,
      text: "你好，LP 已准备生成。",
      usage: { inputTokens: 12, outputTokens: 8 },
      modelCapabilities: {
        contextWindow: 200000,
        maxTokens: 128000,
        supportsTools: true,
        supportsStreaming: true
      }
    });

    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe(
      "https://open.bigmodel.cn/api/anthropic/v1/messages"
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({
      "content-type": "application/json",
      "x-api-key": "sk-test-secret",
      "anthropic-version": "2023-06-01"
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      model: "glm-5.1",
      max_tokens: 1024,
      messages: [{ role: "user", content: "生成一个电商 LP" }]
    });
    expect(JSON.stringify(result)).not.toContain("sk-test-secret");
    expect(JSON.stringify(result)).not.toContain("ANTHROPIC_API_KEY");
    expect(JSON.stringify(gateway.getAuditLog())).not.toContain("sk-test-secret");
    expect(JSON.stringify(gateway.getAuditLog())).not.toContain("ANTHROPIC_API_KEY");
  });

  it("keeps mock routes deterministic without provider config", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return undefined;
        }
      }
    });

    const result = await gateway.complete({
      role: "planner",
      projectId: "project_1",
      prompt: "Plan"
    });

    expect(result).toMatchObject({
      provider: "mock-openai",
      model: "planning-model",
      text: "planner response from mock-openai/planning-model"
    });
  });
});
