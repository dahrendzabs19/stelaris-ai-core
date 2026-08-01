// ============================================================================
// Stelaris AI — Ollama Provider Adapter
// ============================================================================
//
// This adapter implements the AIProvider interface for Ollama's HTTP API.
//
// Ollama API documentation:
//   - Chat:      POST /api/chat
//   - Embed:     POST /api/embed
//   - List tags: GET  /api/tags  (used for health checks)
//
// All Ollama-specific request/response formats are converted to and from
// the generic contracts defined in src/core/ai/types.ts.
// ============================================================================

import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  StreamEvent,
  EmbeddingRequest,
  EmbeddingResponse,
  HealthStatus,
  ProviderId,
  ModelId,
  ModelDescriptor,
  TokenUsage,
  FinishReason,
  Message,
} from "@/core/ai/types";

import type { Logger } from "@/core/logging/logger";
import { fetchWithRetry } from "@/infrastructure/http/fetch-with-retry";

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

export interface OllamaProviderConfig {
  /** Base URL of the Ollama server (e.g., "http://localhost:11434") */
  baseUrl: string;
  /** Timeout in milliseconds for all outbound HTTP requests */
  timeoutMs: number;
  /** Maximum number of retries for transient failures */
  retryCount: number;
}

// ----------------------------------------------------------------------------
// Ollama API Types (internal to this adapter)
// ----------------------------------------------------------------------------

interface OllamaMessage {
  role: string;
  content: string;
  images?: string[];
  tool_calls?: unknown[];
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    stop?: string[];
    num_predict?: number;
  };
}

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: OllamaMessage;
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaStreamPayload {
  model: string;
  created_at: string;
  message: { content: string };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaEmbedRequest {
  model: string;
  input: string | string[];
}

interface OllamaEmbedResponse {
  model: string;
  embeddings: number[][];
  total_duration?: number;
  prompt_eval_count?: number;
}

// ----------------------------------------------------------------------------
// Error Helpers
// ----------------------------------------------------------------------------

class OllamaAPIError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "OllamaAPIError";
  }
}

class OllamaConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaConfigurationError";
  }
}

// ----------------------------------------------------------------------------
// Model Mappings
// ----------------------------------------------------------------------------

function mapFinishReason(reason?: string): FinishReason | undefined {
  if (reason === "stop") return "stop";
  if (reason === "length") return "length";
  return undefined;
}

function toOllamaMessage(msg: Message): OllamaMessage {
  const text: string[] = [];
  const images: string[] = [];

  for (const part of msg.content) {
    switch (part.type) {
      case "text":
        text.push(part.text);
        break;
      case "image":
        if (part.source.type !== "base64") {
          throw new OllamaConfigurationError(
            "Ollama requires base64 image content; image URLs are not supported by this adapter",
          );
        }
        images.push(part.source.data);
        break;
      case "tool-call":
      case "tool-result":
        throw new OllamaConfigurationError(
          "Ollama tool-call content is not supported by this adapter yet",
        );
    }
  }

  return {
    role: msg.role,
    content: text.join(""),
    ...(images.length > 0 ? { images } : {}),
  };
}

function toTokenUsage(
  promptEvalCount?: number,
  evalCount?: number,
): TokenUsage {
  return {
    inputTokens: promptEvalCount as number,
    outputTokens: evalCount as number,
    totalTokens: ((promptEvalCount ?? 0) + (evalCount ?? 0)) as number,
  };
}

// ----------------------------------------------------------------------------
// Ollama Provider
// ----------------------------------------------------------------------------

export class OllamaProvider implements AIProvider {
  readonly id: ProviderId = "ollama" as ProviderId;
  readonly name = "Ollama";
  readonly models: ModelDescriptor[];

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private readonly log: Logger;

  constructor(config: OllamaProviderConfig, log: Logger) {
    if (!config.baseUrl) {
      throw new OllamaConfigurationError(
        "OllamaProvider requires a baseUrl in its configuration",
      );
    }

    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs;
    this.retryCount = config.retryCount;
    this.log = log;
    this.models = this.buildModels();
  }

  private buildModels(): ModelDescriptor[] {
    return [
      {
        id: "qwen3:8b" as ModelId,
        name: "Qwen 3 8B",
        provider: this.id,
        capabilities: {
          streaming: true,
          functionCalling: false,
          vision: false,
          embeddings: true,
          maxOutputTokens: 8192,
          maxContextLength: 32768,
        },
        costPer1KTokens: { input: 0, output: 0 },
        qualityScore: 0.6,
      },
      {
        id: "qwen2.5-coder:7b" as ModelId,
        name: "Qwen 2.5 Coder 7B",
        provider: this.id,
        capabilities: {
          streaming: true,
          functionCalling: false,
          vision: false,
          embeddings: true,
          maxOutputTokens: 8192,
          maxContextLength: 32768,
        },
        costPer1KTokens: { input: 0, output: 0 },
        qualityScore: 0.55,
      },
    ];
  }

  // --------------------------------------------------------------------------
  // Chat (Non-Streaming)
  // --------------------------------------------------------------------------

  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!request.model) {
      throw new OllamaConfigurationError(
        "OllamaProvider.chat() requires a model in the request",
      );
    }

    this.log.info("Ollama: chat request started", {
      provider: this.id,
      model: request.model,
    });

    const startTime = performance.now();

    const ollamaRequest: OllamaChatRequest = {
      model: request.model,
      messages: request.messages.map(toOllamaMessage),
      stream: false,
      options: {
        temperature: request.temperature,
        top_p: request.topP,
        stop: request.stop,
        num_predict: request.maxTokens,
      },
    };

    this.cleanUndefinedOptions(ollamaRequest);

    try {
      const response = await fetchWithRetry(
        `${this.baseUrl}/api/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ollamaRequest),
        },
        this.timeoutMs,
        this.retryCount,
        this.log,
        { provider: this.id, model: request.model },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new OllamaAPIError(
          `Ollama chat API returned status ${response.status}: ${body}`,
          response.status,
          body,
        );
      }

      const data: unknown = await response.json();

      if (!this.isOllamaChatResponse(data)) {
        throw new OllamaAPIError(
          "Ollama chat API returned an invalid response format",
        );
      }

      const latencyMs = Math.round(performance.now() - startTime);

      this.log.info("Ollama: chat request finished", {
        provider: this.id,
        model: request.model,
        latencyMs,
      });

      return {
        message: {
          role: "assistant",
          content: [{ type: "text", text: data.message.content }],
        },
        model: data.model as ModelId,
        usage: toTokenUsage(data.prompt_eval_count, data.eval_count),
        finishReason: mapFinishReason(data.done_reason) as FinishReason,
        provider: this.id,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startTime);

      if (error instanceof OllamaAPIError) {
        this.log.error("Ollama: API error", {
          provider: this.id,
          model: request.model,
          status: error.status,
          latencyMs,
        });
      } else {
        this.log.error("Ollama: network error or timeout", {
          provider: this.id,
          model: request.model,
          error: error instanceof Error ? error.name : "UnknownError",
          latencyMs,
        });
      }

      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Stream
  // --------------------------------------------------------------------------

  async *stream(request: ChatRequest): AsyncIterable<StreamEvent> {
    if (!request.model) {
      throw new OllamaConfigurationError(
        "OllamaProvider.stream() requires a model in the request",
      );
    }

    this.log.info("Ollama: stream request started", {
      provider: this.id,
      model: request.model,
    });

    const ollamaRequest: OllamaChatRequest = {
      model: request.model,
      messages: request.messages.map(toOllamaMessage),
      stream: true,
      options: {
        temperature: request.temperature,
        top_p: request.topP,
        stop: request.stop,
        num_predict: request.maxTokens,
      },
    };

    this.cleanUndefinedOptions(ollamaRequest);

    try {
      const response = await fetchWithRetry(
        `${this.baseUrl}/api/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ollamaRequest),
        },
        this.timeoutMs,
        this.retryCount,
        this.log,
        { provider: this.id, model: request.model },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new OllamaAPIError(
          `Ollama stream API returned status ${response.status}: ${body}`,
          response.status,
          body,
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new OllamaAPIError(
          "Ollama stream response body is not readable",
        );
      }

      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const events = this.parseStreamEvents(trimmed);
            for (const event of events) {
              yield event;
              if (event.type === "finish") return;
            }
          }
        }

        if (buffer.trim()) {
          const events = this.parseStreamEvents(buffer.trim());
          for (const event of events) {
            yield event;
          }
        }
      } finally {
        reader.releaseLock();
      }

      this.log.info("Ollama: stream request finished", {
        provider: this.id,
        model: request.model,
      });
    } catch (error) {
      this.log.error("Ollama: stream request failed", {
        provider: this.id,
        model: request.model,
        error: error instanceof Error ? error.name : "UnknownError",
      });

      yield {
        type: "error",
        model: request.model,
        provider: this.id,
        error: {
          message: error instanceof Error ? error.message : "Unknown Ollama stream error",
          code: error instanceof OllamaAPIError ? String(error.status ?? "api-error") : undefined,
        },
      };
    }
  }

  private parseStreamEvents(line: string): StreamEvent[] {
    try {
      const data: unknown = JSON.parse(line);
      if (!this.isOllamaStreamPayload(data)) return [];

      const events: StreamEvent[] = [];
      const content = data.message?.content;
      if (content) {
        events.push({
          type: "text-delta",
          delta: content,
          model: data.model as ModelId,
          provider: this.id,
        });
      }

      if (data.done) {
        events.push({
          type: "usage",
          usage: toTokenUsage(data.prompt_eval_count, data.eval_count),
          model: data.model as ModelId,
          provider: this.id,
        });
        events.push({
          type: "finish",
          finishReason: mapFinishReason(data.done_reason) ?? "stop",
          model: data.model as ModelId,
          provider: this.id,
        });
      }

      return events;
    } catch {
      return [];
    }
  }

  // --------------------------------------------------------------------------
  // Embed
  // --------------------------------------------------------------------------

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (!request.model) {
      throw new OllamaConfigurationError(
        "OllamaProvider.embed() requires a model in the request",
      );
    }

    this.log.info("Ollama: embed request started", {
      provider: this.id,
      model: request.model,
    });

    const startTime = performance.now();

    const ollamaRequest: OllamaEmbedRequest = {
      model: request.model,
      input: request.input,
    };

    try {
      const response = await fetchWithRetry(
        `${this.baseUrl}/api/embed`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ollamaRequest),
        },
        this.timeoutMs,
        this.retryCount,
        this.log,
        { provider: this.id, model: request.model },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new OllamaAPIError(
          `Ollama embed API returned status ${response.status}: ${body}`,
          response.status,
          body,
        );
      }

      const data: unknown = await response.json();

      if (!this.isOllamaEmbedResponse(data)) {
        throw new OllamaAPIError(
          "Ollama embed API returned an invalid response format",
        );
      }

      const latencyMs = Math.round(performance.now() - startTime);

      this.log.info("Ollama: embed request finished", {
        provider: this.id,
        model: request.model,
        latencyMs,
      });

      return {
        embeddings: data.embeddings,
        model: data.model as ModelId,
        usage: toTokenUsage(data.prompt_eval_count),
        provider: this.id,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startTime);

      this.log.error("Ollama: embed request failed", {
        provider: this.id,
        model: request.model,
        error: error instanceof Error ? error.name : "UnknownError",
        latencyMs,
      });

      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Health
  // --------------------------------------------------------------------------

  async health(): Promise<HealthStatus> {
    this.log.info("Ollama: health check started", { provider: this.id });

    const startTime = performance.now();

    try {
      const response = await fetchWithRetry(
        `${this.baseUrl}/api/tags`,
        { method: "GET" },
        this.timeoutMs,
        this.retryCount,
        this.log,
        { provider: this.id },
      );

      const latencyMs = Math.round(performance.now() - startTime);

      if (!response.ok) {
        this.log.warn("Ollama: health check unhealthy", {
          provider: this.id,
          status: response.status,
          latencyMs,
        });

        return {
          healthy: false,
          provider: this.id,
          lastChecked: Date.now(),
          error: `Ollama health check failed with status ${response.status}`,
          latencyMs,
        };
      }

      this.log.info("Ollama: health check healthy", {
        provider: this.id,
        latencyMs,
      });

      return {
        healthy: true,
        provider: this.id,
        lastChecked: Date.now(),
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startTime);

      this.log.warn("Ollama: health check error", {
        provider: this.id,
        error: error instanceof Error ? error.name : "UnknownError",
        latencyMs,
      });

      return {
        healthy: false,
        provider: this.id,
        lastChecked: Date.now(),
        error:
          error instanceof Error
            ? error.message
            : "Unknown error during health check",
        latencyMs,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  private cleanUndefinedOptions(request: OllamaChatRequest): void {
    if (request.options) {
      const opts = request.options as Record<string, unknown>;
      for (const key of Object.keys(opts)) {
        if (opts[key] === undefined) delete opts[key];
      }
      if (Object.keys(opts).length === 0) delete request.options;
    }
  }

  private isOllamaChatResponse(data: unknown): data is OllamaChatResponse {
    if (typeof data !== "object" || data === null) return false;
    const d = data as Record<string, unknown>;
    return (
      typeof d.model === "string" &&
      typeof d.message === "object" &&
      d.message !== null &&
      typeof (d.message as Record<string, unknown>).content === "string"
    );
  }

  private isOllamaStreamPayload(data: unknown): data is OllamaStreamPayload {
    if (typeof data !== "object" || data === null) return false;
    const d = data as Record<string, unknown>;
    return typeof d.model === "string" && typeof d.done === "boolean";
  }

  private isOllamaEmbedResponse(data: unknown): data is OllamaEmbedResponse {
    if (typeof data !== "object" || data === null) return false;
    const d = data as Record<string, unknown>;
    return (
      typeof d.model === "string" &&
      Array.isArray(d.embeddings) &&
      d.embeddings.every(
        (e: unknown) =>
          Array.isArray(e) && e.every((n: unknown) => typeof n === "number"),
      )
    );
  }
}
