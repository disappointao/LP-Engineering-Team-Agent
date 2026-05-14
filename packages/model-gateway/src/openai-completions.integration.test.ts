import { describe, expect, it } from "vitest";
import {
  ProviderBackedModelGateway,
  createDefaultModelPolicy,
  type ModelProviderRuntimeRecord,
  type ModelRoutingPolicy
} from "./index";

const shouldRun =
  process.env.REAL_MODEL_PROVIDER_TEST === "1" &&
  isNonEmptyString(process.env.OPENAI_COMPATIBLE_BASE_URL) &&
  isNonEmptyString(process.env.OPENAI_COMPATIBLE_API_KEY) &&
  isNonEmptyString(process.env.OPENAI_COMPATIBLE_DEFAULT_MODEL);

const describeIntegration = shouldRun ? describe : describe.skip;

const providerId = "openai-compatible";
const providerName = "OpenAI compatible";
const model = process.env.OPENAI_COMPATIBLE_DEFAULT_MODEL ?? "";

function createOpenAICompatibleProvider(): ModelProviderRuntimeRecord {
  return {
    id: providerId,
    name: providerName,
    enabled: true,
    config: {
      api: "openai-completions",
      baseUrl: process.env.OPENAI_COMPATIBLE_BASE_URL,
      apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
      models: [{ id: model }]
    }
  };
}

function createPolicy(): ModelRoutingPolicy {
  return {
    ...createDefaultModelPolicy(),
    planner: {
      provider: providerId,
      providerName,
      api: "openai-completions",
      model,
      baseUrlConfigured: true,
      apiKeyEnvConfigured: true
    }
  };
}

describeIntegration("openai compatible real provider integration", () => {
  it(
    "completes a planner smoke test through an OpenAI-compatible provider",
    async () => {
      const gateway = new ProviderBackedModelGateway({
        policy: createDefaultModelPolicy(),
        providers: {
          async getProvider(requestedProviderId) {
            return requestedProviderId === providerId
              ? createOpenAICompatibleProvider()
              : undefined;
          }
        },
        env: process.env,
        timeoutMs: 60000
      });

      const result = await gateway.complete({
        role: "planner",
        projectId: "openai_compatible_smoke",
        prompt: "用一句中文回复：OpenAI 兼容模型连通性测试成功。",
        routingPolicy: createPolicy()
      });

      expect(result.text.trim().length).toBeGreaterThan(0);
      expect(result.provider).toBe(providerId);
      expect(result.api).toBe("openai-completions");
      expect(result.model.trim().length).toBeGreaterThan(0);
      expect(result.usage.inputTokens).toBeGreaterThanOrEqual(0);
      expect(result.usage.outputTokens).toBeGreaterThanOrEqual(0);

      const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY ?? "";
      const resultJson = JSON.stringify(result);
      const auditJson = JSON.stringify(gateway.getAuditLog());

      expect(resultJson).not.toContain(apiKey);
      expect(auditJson).not.toContain(apiKey);
    },
    70000
  );
});

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
