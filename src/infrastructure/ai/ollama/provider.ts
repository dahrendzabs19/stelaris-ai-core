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
  StreamChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  HealthStatus,
  ProviderId,
  ModelId,
  AIModel,
  TokenUsage,
  FinishReason,
  ChatMessage,
} from "@/core/ai/types";

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

/**
 * Configuration options for the Ollama provider.
 *
 * The base URL is required — the provider must always know where the
 * Ollama server is running. No hardcoded defaults are used.
 */
export interface OllamaProviderConfig {
  /** Base URL of the Ollama server (e.g., "http://localhost:11434") */
  baseUrl: string;
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

interface OllamaStreamChunk {
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

interface OllamaTagsResponse {
  models: Array<{ name: string }>;
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

/**
 * Maps an Ollama finish reason to the generic FinishReason type.
 *
 * Preserves the original value from Ollama — the adapter translates,
 * it does not decide. If Ollama provides no finishReason, absence is
 * preserved rather than fabricating a default.
 */
function mapFinishReason(reason?: string): FinishReason | undefined {
  if (reason === "stop") return "stop";
  if (reason === "length") return "length";
  // Any other value (or absence) is passed through as undefined.
  // The adapter translates, it does not invent.
  return undefined;
}

/**
 * Converts a generic ChatMessage to an Ollama-specific message format.
 */
function toOllamaMessage(msg: ChatMessage): OllamaMessage {
  return {
    role: msg.role,
    content: msg.content,
  };
}

/**
 * Converts Ollama's token counts to the generic TokenUsage format.
 *
 * Preserves whatever Ollama provides. If the server omits token
 * counts, absence is preserved rather than fabricating zero values.
 */
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

/**
 * AI Provider adapter for Ollama.
 *
 * Communicates with the Ollama HTTP API using the native fetch API.
 * No external HTTP libraries are used.
 *
 * Usage:
 * ```ts
 * const ollama = new OllamaProvider({ baseUrl: "http://localhost:11434" });
 * const response = await ollama.chat({ messages: [...], model: "qwen3:8b" });
 * ```
 *
 * The base URL is read from configuration and is required.
 * The model must be supplied in every request — the provider does not
 * decide which model to use.
 */
export class OllamaProvider implements AIProvider {
  readonly id: ProviderId = "ollama" as ProviderId;
  readonly name = "Ollama";
  readonly models: AIModel[];

  private readonly baseUrl: string;

  /**
   * @param config - Configuration for the Ollama provider.
   *                 Requires `baseUrl` — no hardcoded default.
   */
  constructor(config: OllamaProviderConfig) {
    if (!config.baseUrl) {
      throw new OllamaConfigurationError(
        "OllamaProvider requires a baseUrl in its configuration",
      );
    }

    this.baseUrl = config.baseUrl.replace(/\/+$/, "");

    this.models = [
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

  /**
   * Send a chat completion request and receive the full response.
   *
   * Transformation flow:
   *   ChatRequest → OllamaChatRequest → POST /api/chat → OllamaChatResponse → ChatResponse
   *
   * Throws if no model is specified — the provider does not decide
   * which model to use.
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!request.model) {
      throw new OllamaConfigurationError(
        "OllamaProvider.chat() requires a model in the request",
      );
    }

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

    // Remove undefined options so Ollama uses its defaults
    this.cleanUndefinedOptions(ollamaRequest);

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ollamaRequest),
    });

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

    return {
      message: {
        role: "assistant",
        content: data.message.content,
      },
      model: data.model as ModelId,
      usage: toTokenUsage(data.prompt_eval_count, data.eval_count),
      finishReason: mapFinishReason(data.done_reason) as FinishReason,
      provider: this.id,
      latencyMs,
    };
  }

  // --------------------------------------------------------------------------
  // Stream
  // --------------------------------------------------------------------------

  /**
   * Send a chat completion request and receive a stream of chunks.
   *
   * Implementation:
   *   1. Send a POST to /api/chat with stream: true
   *   2. Read the response body as a byte stream
   *   3. Parse newline-delimited JSON (NDJSON)
   *   4. Yield a StreamChunk for each parsed line
   *   5. The final chunk (done: true) may include usage and finish reason
   *
   * Throws if no model is specified — the provider does not decide
   * which model to use.
   */
  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    if (!request.model) {
      throw new OllamaConfigurationError(
        "OllamaProvider.stream() requires a model in the request",
      );
    }

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

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ollamaRequest),
    });

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
        // Keep the last (potentially incomplete) line in the buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const chunk = this.parseStreamChunk(trimmed);
          if (chunk) {
            yield chunk;
            if (chunk.done) return;
          }
        }
      }

      // Process any remaining data in the buffer
      if (buffer.trim()) {
        const chunk = this.parseStreamChunk(buffer.trim());
        if (chunk && !chunk.done) {
          yield chunk;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Parse a single line of NDJSON from the Ollama stream.
   */
  private parseStreamChunk(line: string): StreamChunk | null {
    try {
      const data: unknown = JSON.parse(line);

      if (!this.isOllamaStreamChunk(data)) {
        return null;
      }

      const chunk: StreamChunk = {
        content: data.message?.content ?? "",
        model: data.model as ModelId,
        provider: this.id,
        done: data.done,
      };

      if (data.done) {
        chunk.usage = toTokenUsage(data.prompt_eval_count, data.eval_count);
        chunk.finishReason = mapFinishReason(
          data.done_reason,
        ) as FinishReason;
      }

      return chunk;
    } catch {
      // Skip lines that aren't valid JSON
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Embed
  // --------------------------------------------------------------------------

  /**
   * Generate embeddings for the given text(s).
   *
   * Transformation flow:
   *   EmbeddingRequest → OllamaEmbedRequest → POST /api/embed → OllamaEmbedResponse → EmbeddingResponse
   *
   * Throws if no model is specified — the provider does not decide
   * which model to use.
   */
  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (!request.model) {
      throw new OllamaConfigurationError(
        "OllamaProvider.embed() requires a model in the request",
      );
    }

    const startTime = performance.now();

    const ollamaRequest: OllamaEmbedRequest = {
      model: request.model,
      input: request.input,
    };

    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ollamaRequest),
    });

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

    return {
      embeddings: data.embeddings,
      model: data.model as ModelId,
      usage: toTokenUsage(data.prompt_eval_count),
      provider: this.id,
      latencyMs,
    };
  }

  // --------------------------------------------------------------------------
  // Health
  // --------------------------------------------------------------------------

  /**
   * Check the health of the Ollama server.
   *
   * Uses GET /api/tags to verify the server is responding.
   * This endpoint lists available models and is lightweight.
   */
  async health(): Promise<HealthStatus> {
    const startTime = performance.now();

    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
      });

      const latencyMs = Math.round(performance.now() - startTime);

      if (!response.ok) {
        return {
          healthy: false,
          provider: this.id,
          lastChecked: Date.now(),
          error: `Ollama health check failed with status ${response.status}`,
          latencyMs,
        };
      }

      return {
        healthy: true,
        provider: this.id,
        lastChecked: Date.now(),
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startTime);

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

  /**
   * Remove undefined option values so Ollama receives its defaults.
   */
  private cleanUndefinedOptions(request: OllamaChatRequest): void {
    if (request.options) {
      const opts = request.options as Record<string, unknown>;
      for (const key of Object.keys(opts)) {
        if (opts[key] === undefined) {
          delete opts[key];
        }
      }
      if (Object.keys(opts).length === 0) {
        delete request.options;
      }
    }
  }

  // --------------------------------------------------------------------------
  // Type Guards (runtime validation of Ollama API responses)
  // --------------------------------------------------------------------------

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

  private isOllamaStreamChunk(data: unknown): data is OllamaStreamChunk {
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