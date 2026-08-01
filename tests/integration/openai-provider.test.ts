import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { OpenAIProvider } from "@/infrastructure/ai/openai/provider";
import type { Logger } from "@/core/logging/logger";
import type { ModelId, StreamEvent } from "@/core/ai/types";

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createProvider() {
  return new OpenAIProvider(
    { apiKey: "sk-mock-key", timeoutMs: 5000, retryCount: 0 },
    createMockLogger(),
  );
}

describe("OpenAIProvider (integration)", () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = createProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("chat", () => {
    it("sends a chat request and maps the response", async () => {
      const mockResponse = {
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1700000000,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello from OpenAI!" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const response = await provider.chat({
        model: "gpt-4o" as ModelId,
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      });

      expect(response.message.content).toEqual([{ type: "text", text: "Hello from OpenAI!" }]);
      expect(response.model).toBe("gpt-4o");
      expect(response.usage.inputTokens).toBe(10);
      expect(response.usage.outputTokens).toBe(5);
      expect(response.finishReason).toBe("stop");
      expect(response.provider).toBe("openai");
    });

    it("maps tool_calls finish reason correctly", async () => {
      const mockResponse = {
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1700000000,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "" },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const response = await provider.chat({
        model: "gpt-4o" as ModelId,
        messages: [{ role: "user", content: [{ type: "text", text: "Call a tool" }] }],
      });

      expect(response.finishReason).toBe("tool-calls");
    });

    it("maps content_filter finish reason correctly", async () => {
      const mockResponse = {
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1700000000,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "" },
            finish_reason: "content_filter",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const response = await provider.chat({
        model: "gpt-4o" as ModelId,
        messages: [{ role: "user", content: [{ type: "text", text: "Bad content" }] }],
      });

      expect(response.finishReason).toBe("content-filter");
    });

    it("throws on API error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Unauthorized", { status: 401 }),
      );

      await expect(
        provider.chat({
          model: "gpt-4o" as ModelId,
          messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        }),
      ).rejects.toThrow(/OpenAI API returned status 401/);
    });

    it("throws when model is empty", async () => {
      await expect(
        provider.chat({
          model: "" as ModelId,
          messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        }),
      ).rejects.toThrow("OpenAIProvider.chat() requires a model");
    });
  });

  describe("stream", () => {
    it("yields canonical stream events from an SSE response", async () => {
      const sseData = [
        'data: {"id":"1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
        'data: {"id":"2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}',
        'data: {"id":"3","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
        "data: [DONE]",
      ].join("\n\n");

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseData));
          controller.close();
        },
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(stream, { status: 200 }),
      );

      const events: StreamEvent[] = [];
      for await (const event of provider.stream({
        model: "gpt-4o" as ModelId,
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      })) {
        events.push(event);
      }

      expect(events.filter((event) => event.type === "text-delta").map((event) => event.delta)).toEqual(["Hello", " world"]);
      expect(events.find((event) => event.type === "finish")).toMatchObject({ type: "finish", finishReason: "stop" });
    });

    it("emits an ErrorEvent on stream API error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Unauthorized", { status: 401 }),
      );

      const iterator = provider.stream({
        model: "gpt-4o" as ModelId,
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      });

      const events: StreamEvent[] = [];
      for await (const event of iterator) events.push(event);

      expect(events).toEqual([
        expect.objectContaining({
          type: "error",
          error: expect.objectContaining({ message: expect.stringMatching(/OpenAI stream API returned status 401/) }),
        }),
      ]);
    });
  });

  describe("embed", () => {
    it("sends an embed request and maps the response", async () => {
      const mockResponse = {
        object: "list",
        data: [
          { object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] },
          { object: "embedding", index: 1, embedding: [0.4, 0.5, 0.6] },
        ],
        model: "text-embedding-3-small",
        usage: { prompt_tokens: 5, total_tokens: 5 },
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const response = await provider.embed({
        model: "text-embedding-3-small" as ModelId,
        input: ["Hello", "World"],
      });

      expect(response.embeddings).toHaveLength(2);
      expect(response.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
      expect(response.embeddings[1]).toEqual([0.4, 0.5, 0.6]);
      expect(response.model).toBe("text-embedding-3-small");
      expect(response.usage.inputTokens).toBe(5);
    });

    it("throws on embed API error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Bad Request", { status: 400 }),
      );

      await expect(
        provider.embed({
          model: "text-embedding-3-small" as ModelId,
          input: "Hello",
        }),
      ).rejects.toThrow(/OpenAI API returned status 400/);
    });
  });

  describe("health", () => {
    it("returns healthy when API responds", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      );

      const status = await provider.health();

      expect(status.healthy).toBe(true);
      expect(status.provider).toBe("openai");
    });

    it("returns unhealthy on error", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Connection refused"));

      const status = await provider.health();

      expect(status.healthy).toBe(false);
      expect(status.provider).toBe("openai");
      expect(status.error).toBeDefined();
    });
  });
});
