import { describe, expect, it } from "vitest";
import {
  ProviderBackedModelGateway,
  createDefaultModelPolicy,
  type ModelProviderRuntimeRecord,
  type ModelRoutingPolicy
} from "./index";

const shouldRun =
  process.env.REAL_MODEL_PROVIDER_TEST === "1" &&
  isNonEmptyString(process.env.ANTHROPIC_BASE_URL) &&
  isNonEmptyString(process.env.ANTHROPIC_API_KEY) &&
  isNonEmptyString(process.env.ANTHROPIC_DEFAULT_MODEL);

const describeIntegration = shouldRun ? describe : describe.skip;

const providerId = "anthropic-compatible";
const providerName = "Anthropic compatible";
const model = process.env.ANTHROPIC_DEFAULT_MODEL ?? "";

function createAnthropicCompatibleProvider(): ModelProviderRuntimeRecord {
  return {
    id: providerId,
    name: providerName,
    enabled: true,
    config: {
      api: "anthropic-messages",
      baseUrl: process.env.ANTHROPIC_BASE_URL,
      apiKeyEnv: "ANTHROPIC_API_KEY",
      models: [{ id: model }]
    }
  };
}

function createPolicy(): ModelRoutingPolicy {
  return {
    ...createDefaultModelPolicy(),
    builder: {
      provider: providerId,
      providerName,
      api: "anthropic-messages",
      model,
      baseUrlConfigured: true,
      apiKeyEnvConfigured: true
    }
  };
}

describeIntegration("anthropic messages real provider integration", () => {
  it(
    "completes a builder smoke test through an Anthropic-compatible provider",
    async () => {
      const gateway = new ProviderBackedModelGateway({
        policy: createDefaultModelPolicy(),
        providers: {
          async getProvider(requestedProviderId) {
            return requestedProviderId === providerId
              ? createAnthropicCompatibleProvider()
              : undefined;
          }
        },
        env: process.env,
        timeoutMs: 60000
      });

      const result = await gateway.complete({
        role: "builder",
        projectId: "real_provider_smoke",
        prompt: "用一句中文回复：模型连通性测试成功。",
        routingPolicy: createPolicy()
      });

      expect(result.text.trim().length).toBeGreaterThan(0);
      expect(result.provider).toBe(providerId);
      expect(result.api).toBe("anthropic-messages");
      expect(result.model.trim().length).toBeGreaterThan(0);
      expect(result.usage.inputTokens).toBeGreaterThanOrEqual(0);
      expect(result.usage.outputTokens).toBeGreaterThanOrEqual(0);

      const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
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
