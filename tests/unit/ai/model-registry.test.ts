import { describe, it, expect } from "vitest";
import { ModelRegistry, ModelAlreadyRegisteredError, ModelNotFoundError } from "@/core/ai/model-registry";
import type { ModelId, ProviderId } from "@/core/ai/types";

describe("ModelRegistry", () => {
  describe("register", () => {
    it("registers a model mapping", () => {
      const registry = new ModelRegistry();
      registry.register("gpt-4o" as ModelId, "openai" as ProviderId);

      expect(registry.has("gpt-4o" as ModelId)).toBe(true);
      expect(registry.size).toBe(1);
    });

    it("throws when registering a duplicate model", () => {
      const registry = new ModelRegistry();
      registry.register("gpt-4o" as ModelId, "openai" as ProviderId);

      expect(() => registry.register("gpt-4o" as ModelId, "ollama" as ProviderId)).toThrow(ModelAlreadyRegisteredError);
    });

    it("allows registering multiple different models", () => {
      const registry = new ModelRegistry();
      registry.register("gpt-4o" as ModelId, "openai" as ProviderId);
      registry.register("qwen3:8b" as ModelId, "ollama" as ProviderId);

      expect(registry.size).toBe(2);
    });
  });

  describe("getProvider", () => {
    it("returns the provider for a registered model", () => {
      const registry = new ModelRegistry();
      registry.register("gpt-4o" as ModelId, "openai" as ProviderId);

      const result = registry.getProvider("gpt-4o" as ModelId);

      expect(result).toBe("openai" as ProviderId);
    });

    it("throws when model is not registered", () => {
      const registry = new ModelRegistry();

      expect(() => registry.getProvider("unknown" as ModelId)).toThrow(ModelNotFoundError);
    });
  });

  describe("has", () => {
    it("returns true for registered model", () => {
      const registry = new ModelRegistry();
      registry.register("gpt-4o" as ModelId, "openai" as ProviderId);

      expect(registry.has("gpt-4o" as ModelId)).toBe(true);
    });

    it("returns false for unregistered model", () => {
      const registry = new ModelRegistry();

      expect(registry.has("unknown" as ModelId)).toBe(false);
    });
  });

  describe("list", () => {
    it("returns all registered mappings", () => {
      const registry = new ModelRegistry();
      registry.register("gpt-4o" as ModelId, "openai" as ProviderId);
      registry.register("qwen3:8b" as ModelId, "ollama" as ProviderId);

      const result = registry.list();

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({ modelId: "gpt-4o" as ModelId, providerId: "openai" as ProviderId });
      expect(result).toContainEqual({ modelId: "qwen3:8b" as ModelId, providerId: "ollama" as ProviderId });
    });

    it("returns empty array when no mappings", () => {
      const registry = new ModelRegistry();

      expect(registry.list()).toEqual([]);
    });
  });

  describe("remove", () => {
    it("removes a registered mapping", () => {
      const registry = new ModelRegistry();
      registry.register("gpt-4o" as ModelId, "openai" as ProviderId);

      registry.remove("gpt-4o" as ModelId);

      expect(registry.has("gpt-4o" as ModelId)).toBe(false);
      expect(registry.size).toBe(0);
    });

    it("throws when removing an unknown model", () => {
      const registry = new ModelRegistry();

      expect(() => registry.remove("unknown" as ModelId)).toThrow(ModelNotFoundError);
    });
  });

  describe("clear", () => {
    it("removes all mappings", () => {
      const registry = new ModelRegistry();
      registry.register("gpt-4o" as ModelId, "openai" as ProviderId);
      registry.register("qwen3:8b" as ModelId, "ollama" as ProviderId);

      registry.clear();

      expect(registry.size).toBe(0);
      expect(registry.list()).toEqual([]);
    });
  });

  describe("size", () => {
    it("returns 0 for empty registry", () => {
      const registry = new ModelRegistry();

      expect(registry.size).toBe(0);
    });

    it("returns correct count after registration", () => {
      const registry = new ModelRegistry();
      registry.register("a" as ModelId, "x" as ProviderId);
      registry.register("b" as ModelId, "y" as ProviderId);

      expect(registry.size).toBe(2);
    });
  });
});