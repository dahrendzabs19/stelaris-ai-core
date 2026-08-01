import { describe, it, expect } from "vitest";
import { AIRegistry, ProviderAlreadyRegisteredError, ProviderNotFoundError } from "@/core/ai/registry";
import type { AIProvider, ProviderId, ChatRequest, ChatResponse, StreamEvent, EmbeddingRequest, EmbeddingResponse, HealthStatus } from "@/core/ai/types";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function createMockProvider(id: string): AIProvider {
  return {
    id: id as ProviderId,
    name: `Provider ${id}`,
    models: [],
    chat: async (_request: ChatRequest): Promise<ChatResponse> => {
      throw new Error("Not implemented");
    },
    stream: async function* (_request: ChatRequest): AsyncIterable<StreamEvent> {
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

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("AIRegistry", () => {
  describe("register", () => {
    it("registers a provider", () => {
      const registry = new AIRegistry();
      const provider = createMockProvider("test-provider");

      registry.register(provider);

      expect(registry.has("test-provider" as ProviderId)).toBe(true);
      expect(registry.size).toBe(1);
    });

    it("throws when registering a duplicate provider", () => {
      const registry = new AIRegistry();
      const provider = createMockProvider("test-provider");

      registry.register(provider);

      expect(() => registry.register(provider)).toThrow(ProviderAlreadyRegisteredError);
    });

    it("allows registering multiple different providers", () => {
      const registry = new AIRegistry();
      registry.register(createMockProvider("provider-a"));
      registry.register(createMockProvider("provider-b"));

      expect(registry.size).toBe(2);
    });
  });

  describe("get", () => {
    it("returns a registered provider", () => {
      const registry = new AIRegistry();
      const provider = createMockProvider("test-provider");
      registry.register(provider);

      const result = registry.get("test-provider" as ProviderId);

      expect(result).toBe(provider);
    });

    it("throws when provider is not registered", () => {
      const registry = new AIRegistry();

      expect(() => registry.get("unknown" as ProviderId)).toThrow(ProviderNotFoundError);
    });
  });

  describe("unregister", () => {
    it("removes a registered provider", () => {
      const registry = new AIRegistry();
      registry.register(createMockProvider("test-provider"));

      registry.unregister("test-provider" as ProviderId);

      expect(registry.has("test-provider" as ProviderId)).toBe(false);
      expect(registry.size).toBe(0);
    });

    it("throws when unregistering an unknown provider", () => {
      const registry = new AIRegistry();

      expect(() => registry.unregister("unknown" as ProviderId)).toThrow(ProviderNotFoundError);
    });
  });

  describe("has", () => {
    it("returns true for registered provider", () => {
      const registry = new AIRegistry();
      registry.register(createMockProvider("test-provider"));

      expect(registry.has("test-provider" as ProviderId)).toBe(true);
    });

    it("returns false for unregistered provider", () => {
      const registry = new AIRegistry();

      expect(registry.has("unknown" as ProviderId)).toBe(false);
    });
  });

  describe("list", () => {
    it("returns all registered providers", () => {
      const registry = new AIRegistry();
      const a = createMockProvider("a");
      const b = createMockProvider("b");
      registry.register(a);
      registry.register(b);

      const result = registry.list();

      expect(result).toHaveLength(2);
      expect(result).toContain(a);
      expect(result).toContain(b);
    });

    it("returns a new array each time", () => {
      const registry = new AIRegistry();
      registry.register(createMockProvider("a"));

      const first = registry.list();
      const second = registry.list();

      expect(first).not.toBe(second);
    });

    it("returns empty array when no providers", () => {
      const registry = new AIRegistry();

      expect(registry.list()).toEqual([]);
    });
  });

  describe("size", () => {
    it("returns 0 for empty registry", () => {
      const registry = new AIRegistry();

      expect(registry.size).toBe(0);
    });

    it("returns correct count after registration", () => {
      const registry = new AIRegistry();
      registry.register(createMockProvider("a"));
      registry.register(createMockProvider("b"));

      expect(registry.size).toBe(2);
    });

    it("returns correct count after unregistration", () => {
      const registry = new AIRegistry();
      registry.register(createMockProvider("a"));
      registry.register(createMockProvider("b"));
      registry.unregister("a" as ProviderId);

      expect(registry.size).toBe(1);
    });
  });
});
