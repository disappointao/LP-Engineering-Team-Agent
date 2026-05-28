import { describe, expect, it, vi } from "vitest";
import {
  ProviderBackedModelGateway,
  createDefaultModelPolicy,
  toAnthropicMessagesUrl,
  type ModelFetch,
  type ModelProviderRuntimeRecord,
  type ModelRoutingPolicy,
  type ModelStreamEvent
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
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
        source: "provider_reported"
      },
      call: {
        attempt: 1,
        durationMs: expect.any(Number),
        supportsStreaming: true,
        streamingEnabled: false
      },
      modelCapabilities: {
        contextWindow: 200000,
        maxTokens: 128000,
        supportsTools: true,
        supportsStreaming: true
      }
    });
    expect(result.call.durationMs).toBeGreaterThanOrEqual(0);

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
    expect(JSON.stringify(gateway.getAuditLog())).toContain("\"api\":\"anthropic-messages\"");
    expect(JSON.stringify(gateway.getAuditLog())).not.toContain("https://open.bigmodel.cn");
    expect(JSON.stringify(gateway.getAuditLog())).not.toContain("ANTHROPIC_API_KEY");
    expect(JSON.stringify(gateway.getAuditLog())).not.toContain("sk-test-secret");
  });

  it("streams bounded text deltas and terminal provider usage from Anthropic SSE frames", async () => {
    let requestBody: unknown;
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createZhipuProvider();
        }
      },
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(
          [
            'event: message_start\ndata: {"type":"message_start","message":{"model":"glm-5.1","usage":{"input_tokens":7,"output_tokens":0}}}',
            "",
            'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}',
            "",
            'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"，LP"}}',
            "",
            'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":5}}',
            "",
            'event: message_stop\ndata: {"type":"message_stop"}',
            ""
          ].join("\n"),
          { status: 200, headers: { "content-type": "text/event-stream" } }
        );
      },
      env: { ANTHROPIC_API_KEY: "sk-test-secret" }
    });

    const events = await collectStream(
      gateway.stream({
        role: "builder",
        projectId: "project_1",
        prompt: "生成一个电商 LP",
        routingPolicy: createPolicy()
      })
    );

    expect(requestBody).toEqual({
      model: "glm-5.1",
      max_tokens: 1024,
      messages: [{ role: "user", content: "生成一个电商 LP" }],
      stream: true
    });
    expect(events.map((event) => event.type)).toEqual([
      "model.delta",
      "model.delta",
      "model.completed"
    ]);
    expect(events[0]).toEqual({ type: "model.delta", text: "你好" });
    expect(events[1]).toEqual({ type: "model.delta", text: "，LP" });
    expect(events[2]).toMatchObject({
      type: "model.completed",
      response: {
        provider: "zhipu",
        providerName: "智谱 GLM",
        api: "anthropic-messages",
        model: "glm-5.1",
        text: "你好，LP",
        usage: {
          inputTokens: 7,
          outputTokens: 5,
          totalTokens: 12,
          source: "provider_reported"
        },
        call: {
          supportsStreaming: true,
          streamingEnabled: true
        }
      }
    });
    expect(JSON.stringify(events)).not.toContain("sk-test-secret");
    expect(JSON.stringify(events)).not.toContain("event:");
  });

  it("allows streaming providers to respond slower than the non-stream request timeout", async () => {
    vi.useFakeTimers();
    try {
      let abortObserved = false;
      const fakeFetch: ModelFetch = async (_input, init) =>
        new Promise<Response>((resolve, reject) => {
          const rejectAbort = () => {
            abortObserved = true;
            reject(new DOMException("Aborted", "AbortError"));
          };
          if (init?.signal?.aborted) {
            rejectAbort();
            return;
          }
          init?.signal?.addEventListener("abort", rejectAbort, { once: true });
          setTimeout(() => {
            resolve(
              new Response(
                [
                  'event: message_start\ndata: {"type":"message_start","message":{"model":"glm-5.1","usage":{"input_tokens":4,"output_tokens":0}}}',
                  "",
                  'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"慢速"}}',
                  "",
                  'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"流式"}}',
                  "",
                  'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":3}}',
                  "",
                  'event: message_stop\ndata: {"type":"message_stop"}',
                  ""
                ].join("\n"),
                { status: 200, headers: { "content-type": "text/event-stream" } }
              )
            );
          }, 150);
        });

      const gateway = new ProviderBackedModelGateway({
        policy: createDefaultModelPolicy(),
        providers: {
          async getProvider() {
            return createZhipuProvider();
          }
        },
        fetch: fakeFetch,
        env: { ANTHROPIC_API_KEY: "sk-test-secret" },
        timeoutMs: 100
      });

      const outcome = collectStream(
        gateway.stream({
          role: "builder",
          projectId: "project_1",
          prompt: "慢速生成",
          routingPolicy: createPolicy()
        })
      ).then(
        (events) => ({ ok: true as const, events }),
        (error: unknown) => ({ ok: false as const, error })
      );

      await vi.advanceTimersByTimeAsync(150);
      const result = await outcome;

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw result.error;
      }
      expect(abortObserved).toBe(false);
      expect(result.events.at(-1)).toMatchObject({
        type: "model.completed",
        response: {
          text: "慢速流式",
          call: {
            streamingEnabled: true
          }
        }
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to estimated usage when Anthropic-compatible streams omit usage", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createZhipuProvider();
        }
      },
      fetch: async () =>
        new Response(
          [
            'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Estimated usage"}}',
            "",
            'event: message_stop\ndata: {"type":"message_stop"}',
            ""
          ].join("\n"),
          { status: 200, headers: { "content-type": "text/event-stream" } }
        ),
      env: { ANTHROPIC_API_KEY: "sk-test-secret" }
    });

    const events = await collectStream(
      gateway.stream({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
        routingPolicy: createPolicy()
      })
    );
    const completed = events.find((event) => event.type === "model.completed");

    expect(completed).toMatchObject({
      type: "model.completed",
      response: {
        text: "Estimated usage",
        usage: {
          inputTokens: 2,
          outputTokens: 4,
          totalTokens: 6,
          source: "estimated"
        }
      }
    });
  });

  it("fails closed on malformed Anthropic-compatible stream frames", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createZhipuProvider();
        }
      },
      fetch: async () =>
        new Response("event: content_block_delta\ndata: {not-json}\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" }
        }),
      env: { ANTHROPIC_API_KEY: "sk-test-secret" }
    });

    await expect(
      collectStream(
        gateway.stream({
          role: "builder",
          projectId: "project_1",
          prompt: "Generate",
          routingPolicy: createPolicy()
        })
      )
    ).rejects.toMatchObject({
      name: "ModelProviderResponseError",
      code: "model_provider_response_shape_invalid"
    });
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
      text: "planner response from mock-openai/planning-model",
      usage: {
        inputTokens: 1,
        outputTokens: 32,
        totalTokens: 33,
        source: "estimated"
      },
      call: {
        attempt: 1,
        durationMs: 0,
        supportsStreaming: false,
        streamingEnabled: false
      }
    });
  });

  it("times out when response body parsing exceeds the provider timeout", async () => {
    const response = new Response("", {
      status: 200,
      headers: { "content-type": "application/json" }
    });
    response.json = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        type: "message",
        model: "glm-5.1",
        content: [{ type: "text", text: "late body" }],
        usage: { input_tokens: 1, output_tokens: 1 }
      };
    };

    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createZhipuProvider();
        }
      },
      fetch: async () => response,
      env: { ANTHROPIC_API_KEY: "sk-test-secret" },
      timeoutMs: 1
    });

    await expect(
      gateway.complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderRequestError",
      code: "model_provider_request_timeout"
    });
  });

  it("fails closed when route and provider protocols differ", async () => {
    let fetchCalls = 0;
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createZhipuProvider({ api: "openai-completions" });
        }
      },
      fetch: async () => {
        fetchCalls += 1;
        return new Response(
          JSON.stringify({
            type: "message",
            model: "glm-5.1",
            content: [{ type: "text", text: "should not be called" }],
            usage: { input_tokens: 1, output_tokens: 1 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      env: { ANTHROPIC_API_KEY: "sk-test-secret" }
    });

    await expect(
      gateway.complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderConfigurationError",
      code: "model_provider_protocol_mismatch"
    });
    expect(fetchCalls).toBe(0);
  });

  it("fails when a real provider route has no provider config", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return undefined;
        }
      }
    });

    await expect(
      gateway.complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderConfigurationError",
      code: "model_provider_config_missing"
    });
  });

  it("fails when a provider is disabled", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return { ...createZhipuProvider(), enabled: false };
        }
      }
    });

    await expect(
      gateway.complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderConfigurationError",
      code: "model_provider_disabled"
    });
  });

  it("fails without a configured base URL", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createZhipuProvider({ baseUrl: undefined });
        }
      },
      env: { ANTHROPIC_API_KEY: "sk-test-secret" }
    });

    await expect(
      gateway.complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
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
          return createZhipuProvider({ apiKeyEnv: undefined });
        }
      },
      env: { ANTHROPIC_API_KEY: "sk-test-secret" }
    });

    await expect(
      gateway.complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
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
          return createZhipuProvider();
        }
      },
      env: {}
    });

    await expect(
      gateway.complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
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
          return createZhipuProvider();
        }
      },
      fetch: async () =>
        new Response("secret-ish provider diagnostic", {
          status: 429
        }),
      env: { ANTHROPIC_API_KEY: "sk-test-secret" }
    });

    const error = await gateway
      .complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
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
          return createZhipuProvider();
        }
      },
      fetch: async () => new Response("not-json", { status: 200 }),
      env: { ANTHROPIC_API_KEY: "sk-test-secret" }
    });

    await expect(
      gateway.complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
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
          return createZhipuProvider();
        }
      },
      fetch: async () =>
        new Response(JSON.stringify({ content: [], usage: {} }), {
          status: 200,
          headers: { "content-type": "application/json" }
        }),
      env: { ANTHROPIC_API_KEY: "sk-test-secret" }
    });

    await expect(
      gateway.complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
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
          return createZhipuProvider();
        }
      },
      fetch: fakeFetch,
      env: { ANTHROPIC_API_KEY: "sk-test-secret" },
      timeoutMs: 1
    });

    await expect(
      gateway.complete({
        role: "builder",
        projectId: "project_1",
        prompt: "Generate",
        routingPolicy: createPolicy()
      })
    ).rejects.toMatchObject({
      name: "ModelProviderRequestError",
      code: "model_provider_request_timeout"
    });
    expect(abortObserved).toBe(true);
  });
});

async function collectStream(stream: AsyncIterable<ModelStreamEvent>): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}
