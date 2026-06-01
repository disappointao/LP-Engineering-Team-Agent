import { describe, expect, it, vi } from "vitest";
import {
  ProviderBackedModelGateway,
  createDefaultModelPolicy,
  toOpenAIChatCompletionsUrl,
  type ModelFetch,
  type ModelProviderRuntimeRecord,
  type ModelRoutingPolicy,
  type ModelStreamEvent
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
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
        source: "provider_reported"
      },
      call: {
        attempt: 1,
        durationMs: expect.any(Number),
        supportsStreaming: false,
        streamingEnabled: false
      }
    });
    expect(result.call.durationMs).toBeGreaterThanOrEqual(0);
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

  it("streams bounded text deltas and terminal provider usage from SSE frames", async () => {
    let requestBody: unknown;
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider({
            models: [{ id: "glm-5.1", supportsStreaming: true }]
          });
        }
      },
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(
          [
            'data: {"model":"glm-5.1","choices":[{"index":0,"delta":{"content":"Hello"}}]}',
            "",
            'data: {"choices":[{"index":0,"delta":{"content":" there"}}]}',
            "",
            'data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":4,"total_tokens":13}}',
            "",
            "data: [DONE]",
            ""
          ].join("\n"),
          { status: 200, headers: { "content-type": "text/event-stream" } }
        );
      },
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" }
    });

    const events = await collectStream(
      gateway.stream({
        role: "planner",
        projectId: "project_1",
        prompt: "Plan",
        routingPolicy: {
          ...createPolicy(),
          planner: {
            ...createPolicy().planner,
            modelCapabilities: {
              supportsStreaming: true
            }
          }
        }
      })
    );

    expect(requestBody).toEqual({
      model: "glm-5.1",
      messages: [{ role: "user", content: "Plan" }],
      stream: true,
      stream_options: { include_usage: true }
    });
    expect(events.map((event) => event.type)).toEqual([
      "model.delta",
      "model.delta",
      "model.completed"
    ]);
    expect(events[0]).toEqual({ type: "model.delta", text: "Hello" });
    expect(events[1]).toEqual({ type: "model.delta", text: " there" });
    expect(events[2]).toMatchObject({
      type: "model.completed",
      response: {
        provider: "zhipu-openai",
        api: "openai-completions",
        model: "glm-5.1",
        text: "Hello there",
        usage: {
          inputTokens: 9,
          outputTokens: 4,
          totalTokens: 13,
          source: "provider_reported"
        },
        call: {
          supportsStreaming: true,
          streamingEnabled: true
        }
      }
    });
    expect(JSON.stringify(events)).not.toContain("sk-test-secret");
    expect(JSON.stringify(events)).not.toContain("data:");
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
                  'data: {"model":"glm-5.1","choices":[{"index":0,"delta":{"content":"Slow"}}]}',
                  "",
                  'data: {"choices":[{"index":0,"delta":{"content":" stream"}}]}',
                  "",
                  'data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":3,"total_tokens":7}}',
                  "",
                  "data: [DONE]",
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
            return createOpenAICompatibleProvider({
              models: [{ id: "glm-5.1", supportsStreaming: true }]
            });
          }
        },
        fetch: fakeFetch,
        env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" },
        timeoutMs: 100
      });

      const outcome = collectStream(
        gateway.stream({
          role: "planner",
          projectId: "project_1",
          prompt: "Plan slowly",
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
          text: "Slow stream",
          call: {
            streamingEnabled: true
          }
        }
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out stalled streaming response bodies after headers arrive", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider({
            models: [{ id: "glm-5.1", supportsStreaming: true }]
          });
        }
      },
      fetch: async () =>
        new Response(new ReadableStream<Uint8Array>({ start() {} }), {
          status: 200,
          headers: { "content-type": "text/event-stream" }
        }),
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" },
      streamTimeouts: {
        firstByteMs: 10,
        idleMs: 10,
        maxDurationMs: 100
      }
    });

    await expect(
      Promise.race([
        collectStream(
          gateway.stream({
            role: "planner",
            projectId: "project_1",
            prompt: "Plan",
            routingPolicy: createPolicy()
          })
        ),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error("test_timeout")), 250);
        })
      ])
    ).rejects.toMatchObject({
      name: "ModelProviderRequestError",
      code: "model_provider_request_timeout"
    });
  });

  it("falls back to estimated usage when OpenAI-compatible streams omit usage", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider({
            models: [{ id: "glm-5.1", supportsStreaming: true }]
          });
        }
      },
      fetch: async () =>
        new Response(
          [
            'data: {"model":"glm-5.1","choices":[{"index":0,"delta":{"content":"Estimated usage"}}]}',
            "",
            "data: [DONE]",
            ""
          ].join("\n"),
          { status: 200, headers: { "content-type": "text/event-stream" } }
        ),
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" }
    });

    const events = await collectStream(
      gateway.stream({
        role: "planner",
        projectId: "project_1",
        prompt: "Plan with no usage",
        routingPolicy: createPolicy()
      })
    );
    const completed = events.find((event) => event.type === "model.completed");

    expect(completed).toMatchObject({
      type: "model.completed",
      response: {
        text: "Estimated usage",
        usage: {
          inputTokens: 5,
          outputTokens: 4,
          totalTokens: 9,
          source: "estimated"
        }
      }
    });
  });

  it("fails closed on malformed OpenAI-compatible stream frames", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider();
        }
      },
      fetch: async () =>
        new Response("data: {not-json}\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" }
        }),
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" }
    });

    await expect(
      collectStream(
        gateway.stream({
          role: "planner",
          projectId: "project_1",
          prompt: "Plan",
          routingPolicy: createPolicy()
        })
      )
    ).rejects.toMatchObject({
      name: "ModelProviderResponseError",
      code: "model_provider_response_shape_invalid"
    });
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
    expect(result.usage).toEqual({
      inputTokens: 3,
      outputTokens: 2,
      totalTokens: 5,
      source: "provider_reported"
    });
  });

  it("fails on blank text content parts", async () => {
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
                  content: [{ type: "text", text: "   " }]
                }
              }
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        ),
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

  it.each([
    ["compat.maxTokens", { maxTokens: 384 }],
    ["compat.max_tokens", { max_tokens: 384 }]
  ])("includes max_tokens when configured through provider %s", async (_name, compat) => {
    let requestBody: unknown;
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider({ compat });
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
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-test-secret" }
    });

    await gateway.complete({
      role: "planner",
      projectId: "project_1",
      prompt: "Plan",
      routingPolicy: createPolicy()
    });

    expect(requestBody).toMatchObject({ max_tokens: 384 });
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

  it("fails without leaking fetch failure diagnostics", async () => {
    const gateway = new ProviderBackedModelGateway({
      policy: createDefaultModelPolicy(),
      providers: {
        async getProvider() {
          return createOpenAICompatibleProvider();
        }
      },
      fetch: async () => {
        throw new Error("network failed for sk-test-secret at https://open.bigmodel.cn");
      },
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
      code: "model_provider_request_failed"
    });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("sk-test-secret");
    expect((error as Error).message).not.toContain("https://open.bigmodel.cn");
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

async function collectStream(stream: AsyncIterable<ModelStreamEvent>): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}
