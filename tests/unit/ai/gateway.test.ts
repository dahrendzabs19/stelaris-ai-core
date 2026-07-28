import { describe, it, expect, vi } from "vitest";
import { AIGateway, GatewayError } from "@/core/ai/gateway";
import { ProviderRouter } from "@/core/ai/provider-router";
import { ModelRegistry } from "@/core/ai/model-registry";
import { AIRegistry } from "@/core/ai/registry";
import type { AIProvider, ProviderId, ModelId, ChatRequest, ChatResponse, StreamChunk, EmbeddingRequest, EmbeddingResponse, HealthStatus } from "@/core/ai/types";
import type { AppConfig } from "@/core/config/config";
import type { Logger } from "@/core/logging/logger";

// ----------------------------------------------------------------------------
// Mocks
// ----------------------------------------------------------------------------

function createMockAppConfig(): AppConfig {
  return {
    ai: {
      timeoutMs: 30000,
      retryCount: 2,
      ollama: { baseUrl: "http://localhost:11434" },
      openai: { apiKey: "sk-mock" },
      claude: {},
      gemini: {},
    },
  };
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createMockProvider(id: string): AIProvider {
  return {
    id: id as ProviderId,
    name: `Provider ${id}`,
    models: [],
    chat: vi.fn().mockResolvedValue({
      message: { role: "assistant", content: "Hello!" },
      model: "mock" as ModelId,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      finishReason: "stop" as const,
      provider: id as ProviderId,
      latencyMs: 100,
    }),
    stream: async function* (_request: ChatRequest): AsyncIterable<StreamChunk> {
      yield { content: "Hello", model: "mock" as ModelId, provider: id as ProviderId, done: false };
      yield { content: "!", model: "mock" as ModelId, provider: id as ProviderId, done: true, finishReason: "stop" };
    },
    embed: vi.fn().mockResolvedValue({
      embeddings: [[0.1, 0.2, 0.3]],
      model: "mock" as ModelId,
      usage: { inputTokens: 5, outputTokens: 0, totalTokens: 5 },
      provider: id as ProviderId,
      latencyMs: 50,
    }),
    health: vi.fn().mockResolvedValue({
      healthy: true,
      provider: id as ProviderId,
      lastChecked: Date.now(),
      latencyMs: 10,
    }),
  };
}

function createGateway(providerId: string, provider: AIProvider): AIGateway {
  const config = createMockAppConfig();
  const models = new ModelRegistry();
  const registry = new AIRegistry();
  registry.register(provider);
  models.register("mock-model" as ModelId, providerId as ProviderId);
  const router = new ProviderRouter(models, registry);
  const log = createMockLogger();
  return new AIGateway(config, router, log);
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("AIGateway", () => {
  describe("chat", () => {
    it("returns a chat response", async () => {
      const provider = createMockProvider("test-provider");
      const gateway = createGateway("test-provider", provider);

      const response = await gateway.chat({
        model: "mock-model" as ModelId,
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(response.message.content).toBe("Hello!");
      expect(response.provider).toBe("test-provider" as ProviderId);
      expect(response.usage.totalTokens).toBe(15);
    });

    it("throws GatewayError when provider chat fails", async () => {
      const provider = createMockProvider("test-provider");
      (provider.chat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("API error"));
      const gateway = createGateway("test-provider", provider);

      await expect(gateway.chat({
        model: "mock-model" as ModelId,
        messages: [{ role: "user", content: "Hi" }],
      })).rejects.toThrow(GatewayError);
    });
  });

  describe("stream", () => {
    it("yields stream chunks", async () => {
      const provider = createMockProvider("test-provider");
      const gateway = createGateway("test-provider", provider);

      const chunks: StreamChunk[] = [];
      for await (const chunk of gateway.stream({
        model: "mock-model" as ModelId,
        messages: [{ role: "user", content: "Hi" }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0].content).toBe("Hello");
      expect(chunks[1].done).toBe(true);
    });

    it("throws GatewayError when stream fails", async () => {
      const provider = createMockProvider("test-provider");
      provider.stream = async function* () {
        throw new Error("Stream error");
      };
      const gateway = createGateway("test-provider", provider);

      const iterator = gateway.stream({
        model: "mock-model" as ModelId,
        messages: [{ role: "user", content: "Hi" }],
      });

      await expect(async () => {
        for await (const _chunk of iterator) {
          // Should throw
        }
      }).rejects.toThrow(GatewayError);
    });
  });

  describe("embed", () => {
    it("returns an embedding response", async () => {
      const provider = createMockProvider("test-provider");
      const gateway = createGateway("test-provider", provider);

      const response = await gateway.embed({
        model: "mock-model" as ModelId,
        input: "Hello world",
      });

      expect(response.embeddings).toHaveLength(1);
      expect(response.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
    });

    it("throws GatewayError when embed fails", async () => {
      const provider = createMockProvider("test-provider");
      (provider.embed as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Embed error"));
      const gateway = createGateway("test-provider", provider);

      await expect(gateway.embed({
        model: "mock-model" as ModelId,
        input: "Hello",
      })).rejects.toThrow(GatewayError);
    });
  });

  describe("health", () => {
    it("returns health status for a model", async () => {
      const provider = createMockProvider("test-provider");
      const gateway = createGateway("test-provider", provider);

      const status = await gateway.health("mock-model");

      expect(status.healthy).toBe(true);
      expect(status.provider).toBe("test-provider" as ProviderId);
    });

    it("throws GatewayError when health check fails", async () => {
      const provider = createMockProvider("test-provider");
      (provider.health as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Health error"));
      const gateway = createGateway("test-provider", provider);

      await expect(gateway.health("mock-model")).rejects.toThrow(GatewayError);
    });
  });
});