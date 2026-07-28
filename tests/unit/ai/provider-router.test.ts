import { describe, it, expect, vi } from "vitest";
import { ProviderRouter, UnknownModelError, ProviderUnavailableError } from "@/core/ai/provider-router";
import { ModelRegistry } from "@/core/ai/model-registry";
import { AIRegistry } from "@/core/ai/registry";
import type { AIProvider, ProviderId, ModelId, ChatRequest, ChatResponse, StreamChunk, EmbeddingRequest, EmbeddingResponse, HealthStatus } from "@/core/ai/types";

function createMockProvider(id: string): AIProvider {
  return {
    id: id as ProviderId,
    name: `Provider ${id}`,
    models: [],
    chat: async (_request: ChatRequest): Promise<ChatResponse> => {
      return {
        message: { role: "assistant", content: "mock" },
        model: "mock" as ModelId,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        finishReason: "stop",
        provider: id as ProviderId,
        latencyMs: 0,
      };
    },
    stream: async function* (_request: ChatRequest): AsyncIterable<StreamChunk> {
      // No-op
    },
    embed: async (_request: EmbeddingRequest): Promise<EmbeddingResponse> => {
      throw new Error("Not implemented");
    },
    health: async (): Promise<HealthStatus> => {
      return { healthy: true, provider: id as ProviderId, lastChecked: Date.now(), latencyMs: 0 };
    },
  };
}

describe("ProviderRouter", () => {
  it("resolves a model to a provider", () => {
    const models = new ModelRegistry();
    const registry = new AIRegistry();
    const provider = createMockProvider("openai");
    registry.register(provider);
    models.register("gpt-4o" as ModelId, "openai" as ProviderId);

    const router = new ProviderRouter(models, registry);
    const result = router.resolve("gpt-4o" as ModelId);

    expect(result).toBe(provider);
  });

  it("throws UnknownModelError when model is not registered", () => {
    const models = new ModelRegistry();
    const registry = new AIRegistry();

    const router = new ProviderRouter(models, registry);

    expect(() => router.resolve("unknown" as ModelId)).toThrow(UnknownModelError);
  });

  it("throws ProviderUnavailableError when provider is not in AIRegistry", () => {
    const models = new ModelRegistry();
    const registry = new AIRegistry();
    models.register("gpt-4o" as ModelId, "openai" as ProviderId);

    const router = new ProviderRouter(models, registry);

    expect(() => router.resolve("gpt-4o" as ModelId)).toThrow(ProviderUnavailableError);
  });

  it("resolves different models to different providers", () => {
    const models = new ModelRegistry();
    const registry = new AIRegistry();
    const ollama = createMockProvider("ollama");
    const openai = createMockProvider("openai");
    registry.register(ollama);
    registry.register(openai);
    models.register("qwen3:8b" as ModelId, "ollama" as ProviderId);
    models.register("gpt-4o" as ModelId, "openai" as ProviderId);

    const router = new ProviderRouter(models, registry);

    expect(router.resolve("qwen3:8b" as ModelId)).toBe(ollama);
    expect(router.resolve("gpt-4o" as ModelId)).toBe(openai);
  });
});