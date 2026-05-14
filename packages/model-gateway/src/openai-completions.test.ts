import { describe, expect, it } from "vitest";
import {
  ProviderBackedModelGateway,
  createDefaultModelPolicy,
  toOpenAIChatCompletionsUrl,
  type ModelFetch,
  type ModelProviderRuntimeRecord,
  type ModelRoutingPolicy
} from "./index";

function createOpenAICompatibleProvider(
  config: Partial<ModelProviderRuntimeRecord["config"]> = {}
) {
  return {
    id: "zhipu-openai",
    name: "智谱 OpenAI Compatible",
    enabled: true,
    config: {
      api: "openai-completions",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
      models: [{ id: "glm-5.1" }],
      ...config
    }
  } satisfies ModelProviderRuntimeRecord;
}

function createPolicy(): ModelRoutingPolicy {
  return {
    ...createDefaultModelPolicy(),
    planner: {
      provider: "zhipu-openai",
      providerName: "智谱 OpenAI Compatible",
      api: "openai-completions",
      model: "glm-5.1",
      baseUrlConfigured: true,
      apiKeyEnvConfigured: true
    }
  };
}

describe("openai compatible chat completions model gateway", () => {
  it("normalizes OpenAI Chat Completions endpoint URLs", () => {
    expect(toOpenAIChatCompletionsUrl("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
    expect(toOpenAIChatCompletionsUrl("https://api.openai.com/v1/")).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
    expect(toOpenAIChatCompletionsUrl("https://api.openai.com/v1/chat/completions")).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
    expect(toOpenAIChatCompletionsUrl("https://open.bigmodel.cn/api/paas/v4")).toBe(
      "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    );
    expect(toOpenAIChatCompletionsUrl("https://open.bigmodel.cn/api/paas/v4/")).toBe(
      "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    );
    expect(
      toOpenAIChatCompletionsUrl(
        "https://open.bigmodel.cn/api/paas/v4/chat/completions"
      )
    ).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
  });

  it("calls an OpenAI-compatible provider with a single-turn prompt", async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fakeFetch: ModelFetch = async (input, init) => {
      calls.push({ input, init });
      return new Response(
        JSON.stringify({
          id: "chatcmpl_test",
          model: "glm-5.1",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "OpenAI-compatible planner response" },
              finish_reason: "stop"
            }
          ],
          usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider(providerId) {
          return providerId === "zhipu-openai"
            ? createOpenAICompatibleProvider()
            : undefined;
        }
      },
      fetch: fakeFetch,
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" }
    });

    const result = await gateway.complete({
      role: "planner",
      projectId: "project_1",
      prompt: "Generate a landing page brief.",
      routingPolicy: createPolicy()
    });

    expect(result).toMatchObject({
      provider: "zhipu-openai",
      providerName: "智谱 OpenAI Compatible",
      api: "openai-completions",
      model: "glm-5.1",
      baseUrlConfigured: true,
      apiKeyEnvConfigured: true,
      text: "OpenAI-compatible planner response",
      usage: { inputTokens: 12, outputTokens: 8 }
    });
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe(
      "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer sk-test-secret"
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      model: "glm-5.1",
      messages: [{ role: "user", content: "Generate a landing page brief." }],
      stream: false
    });
    expect(JSON.stringify(result)).not.toContain("sk-test-secret");
    expect(JSON.stringify(result)).not.toContain("OPENAI_COMPATIBLE_API_KEY");
    expect(JSON.stringify(gateway.getAuditLog())).not.toContain("sk-test-secret");
    expect(JSON.stringify(gateway.getAuditLog())).not.toContain("OPENAI_COMPATIBLE_API_KEY");
    expect(JSON.stringify(gateway.getAuditLog())).not.toContain("https://open.bigmodel.cn");
  });

  it("concatenates text content parts from OpenAI-compatible responses", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider();
        }
      },
      fetch: async () =>
        new Response(
          JSON.stringify({
            model: "glm-5.1",
            choices: [
              {
                message: {
                  role: "assistant",
                  content: [
                    { type: "text", text: "Line one" },
                    { type: "text", text: "Line two" }
                  ]
                }
              }
            ],
            usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        ),
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" }
    });

    const result = await gateway.complete({
      role: "planner",
      projectId: "project_1",
      prompt: "Plan",
      routingPolicy: createPolicy()
    });

    expect(result.text).toBe("Line one\nLine two");
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
  });

  it("includes max_tokens when configured on the gateway", async () => {
    let requestBody: unknown;
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider();
        }
      },
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            model: "glm-5.1",
            choices: [{ message: { role: "assistant", content: "OK" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" },
      maxTokens: 256
    });

    await gateway.complete({
      role: "planner",
      projectId: "project_1",
      prompt: "Plan",
      routingPolicy: createPolicy()
    });

    expect(requestBody).toMatchObject({ max_tokens: 256 });
  });

  it("fails without a configured base URL", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider({ baseUrl: undefined });
        }
      },
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" }
    });

    await expect(
      gateway.complete({
        role: "planner",
        projectId: "project_1",
        prompt: "Plan",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderConfigurationError",
      code: "model_provider_base_url_missing"
    });
  });

  it("fails without an API key env reference", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider({ apiKeyEnv: undefined });
        }
      },
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" }
    });

    await expect(
      gateway.complete({
        role: "planner",
        projectId: "project_1",
        prompt: "Plan",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderConfigurationError",
      code: "model_provider_api_key_env_missing"
    });
  });

  it("fails without the resolved API key value", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider();
        }
      },
      env: {}
    });

    await expect(
      gateway.complete({
        role: "planner",
        projectId: "project_1",
        prompt: "Plan",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderConfigurationError",
      code: "model_provider_api_key_missing"
    });
  });

  it("fails without leaking provider response text on non-2xx responses", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider();
        }
      },
      fetch: async () => new Response("secret-ish provider diagnostic", { status: 429 }),
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" }
    });

    const error = await gateway
      .complete({
        role: "planner",
        projectId: "project_1",
        prompt: "Plan",
        routingPolicy: createPolicy()
      })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "ModelProviderRequestError",
      code: "model_provider_http_error",
      status: 429
    });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("secret-ish provider diagnostic");
  });

  it("fails on invalid JSON responses", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider();
        }
      },
      fetch: async () => new Response("not-json", { status: 200 }),
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" }
    });

    await expect(
      gateway.complete({
        role: "planner",
        projectId: "project_1",
        prompt: "Plan",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderResponseError",
      code: "model_provider_response_json_invalid"
    });
  });

  it("fails on unsupported response shapes", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider();
        }
      },
      fetch: async () =>
        new Response(JSON.stringify({ choices: [], usage: {} }), {
          status: 200,
          headers: { "content-type": "application/json" }
        }),
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" }
    });

    await expect(
      gateway.complete({
        role: "planner",
        projectId: "project_1",
        prompt: "Plan",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderResponseError",
      code: "model_provider_response_shape_invalid"
    });
  });

  it("fails on request timeout", async () => {
    let abortObserved = false;
    const fakeFetch: ModelFetch = async (_input, init) =>
      new Promise<Response>((_resolve) => {
        if (init?.signal?.aborted) {
          abortObserved = true;
          return;
        }
        init?.signal?.addEventListener(
          "abort",
          () => {
            abortObserved = true;
          },
          { once: true }
        );
      });

    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider();
        }
      },
      fetch: fakeFetch,
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" },
      timeoutMs: 1
    });

    await expect(
      gateway.complete({
        role: "planner",
        projectId: "project_1",
        prompt: "Plan",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderRequestError",
      code: "model_provider_request_timeout"
    });
    expect(abortObserved).toBe(true);
  });
});
