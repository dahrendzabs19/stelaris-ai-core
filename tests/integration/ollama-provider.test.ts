import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { OllamaProvider } from "@/infrastructure/ai/ollama/provider";
import type { Logger } from "@/core/logging/logger";
import type { ModelId } from "@/core/ai/types";

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const BASE_URL = "http://mock-ollama:11434";

function createProvider() {
  return new OllamaProvider(
    { baseUrl: BASE_URL, timeoutMs: 5000, retryCount: 0 },
    createMockLogger(),
  );
}

describe("OllamaProvider (integration)", () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    provider = createProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("chat", () => {
    it("sends a chat request and maps the response", async () => {
      const mockResponse = {
        model: "qwen3:8b",
        created_at: "2026-01-01T00:00:00Z",
        message: { role: "assistant", content: "Hello from Ollama!" },
        done: true,
        done_reason: "stop",
        prompt_eval_count: 10,
        eval_count: 5,
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const response = await provider.chat({
        model: "qwen3:8b" as ModelId,
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(response.message.content).toBe("Hello from Ollama!");
      expect(response.model).toBe("qwen3:8b");
      expect(response.usage.inputTokens).toBe(10);
      expect(response.usage.outputTokens).toBe(5);
      expect(response.finishReason).toBe("stop");
      expect(response.provider).toBe("ollama");
      expect(response.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("throws on API error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Internal Server Error", { status: 500 }),
      );

      await expect(
        provider.chat({
          model: "qwen3:8b" as ModelId,
          messages: [{ role: "user", content: "Hi" }],
        }),
      ).rejects.toThrow(/Ollama chat API returned status 500/);
    });

    it("throws on invalid response format", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ invalid: true }), { status: 200 }),
      );

      await expect(
        provider.chat({
          model: "qwen3:8b" as ModelId,
          messages: [{ role: "user", content: "Hi" }],
        }),
      ).rejects.toThrow("Ollama chat API returned an invalid response format");
    });

    it("throws when model is missing", async () => {
      await expect(
        provider.chat({
          messages: [{ role: "user", content: "Hi" }],
        }),
      ).rejects.toThrow("OllamaProvider.chat() requires a model");
    });
  });

  describe("stream", () => {
    it("yields stream chunks from NDJSON response", async () => {
      const ndjson = [
        JSON.stringify({ model: "qwen3:8b", message: { content: "Hello" }, done: false }),
        JSON.stringify({ model: "qwen3:8b", message: { content: " world" }, done: false }),
        JSON.stringify({
          model: "qwen3:8b",
          message: { content: "" },
          done: true,
          done_reason: "stop",
          prompt_eval_count: 10,
          eval_count: 5,
        }),
      ].join("\n");

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(ndjson));
          controller.close();
        },
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(stream, { status: 200 }),
      );

      const chunks: string[] = [];
      for await (const chunk of provider.stream({
        model: "qwen3:8b" as ModelId,
        messages: [{ role: "user", content: "Hi" }],
      })) {
        chunks.push(chunk.content);
        if (chunk.done) {
          expect(chunk.finishReason).toBe("stop");
          expect(chunk.usage?.inputTokens).toBe(10);
        }
      }

      expect(chunks).toEqual(["Hello", " world"]);
    });

    it("throws on stream API error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Bad Gateway", { status: 502 }),
      );

      const iterator = provider.stream({
        model: "qwen3:8b" as ModelId,
        messages: [{ role: "user", content: "Hi" }],
      });

      await expect(async () => {
        for await (const _chunk of iterator) {
          // Should throw
        }
      }).rejects.toThrow(/Ollama stream API returned status 502/);
    });
  });

  describe("embed", () => {
    it("sends an embed request and maps the response", async () => {
      const mockResponse = {
        model: "qwen3:8b",
        embeddings: [[0.1, 0.2, 0.3]],
        prompt_eval_count: 3,
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const response = await provider.embed({
        model: "qwen3:8b" as ModelId,
        input: "Hello",
      });

      expect(response.embeddings).toEqual([[0.1, 0.2, 0.3]]);
      expect(response.model).toBe("qwen3:8b");
      expect(response.usage.inputTokens).toBe(3);
    });

    it("throws on embed API error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Not Found", { status: 404 }),
      );

      await expect(
        provider.embed({
          model: "qwen3:8b" as ModelId,
          input: "Hello",
        }),
      ).rejects.toThrow(/Ollama embed API returned status 404/);
    });
  });

  describe("health", () => {
    it("returns healthy when API responds", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ models: [] }), { status: 200 }),
      );

      const status = await provider.health();

      expect(status.healthy).toBe(true);
      expect(status.provider).toBe("ollama");
    });

    it("returns unhealthy on error", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Connection refused"));

      const status = await provider.health();

      expect(status.healthy).toBe(false);
      expect(status.provider).toBe("ollama");
      expect(status.error).toBeDefined();
    });
  });
});