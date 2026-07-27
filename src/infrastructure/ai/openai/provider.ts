// ============================================================================
// Stelaris AI — OpenAI Provider Adapter
// ============================================================================
//
// This adapter implements the AIProvider interface for the OpenAI REST API.
//
// OpenAI API documentation:
//   - Chat Completions: POST /v1/chat/completions
//   - Embeddings:       POST /v1/embeddings
//   - List models:      GET  /v1/models  (used for health checks)
//
// All OpenAI-specific request/response formats are converted to and from
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

import type { OpenAIConfig } from "@/core/config/config";

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

/**
 * Extended configuration for the OpenAI provider.
 *
 * Extends the core OpenAIConfig with an optional custom base URL.
 * The API key is required — no hardcoded defaults.
 */
export interface OpenAIProviderConfig extends OpenAIConfig {
  /** Base URL of the OpenAI API (defaults to "https://api.openai.com/v1") */
  baseUrl?: string;
}

// ----------------------------------------------------------------------------
// OpenAI API Types (internal to this adapter)
// ----------------------------------------------------------------------------

interface OpenAIMessage {
  role: string;
  content: string;
  name?: string;
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  stream: boolean;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  max_tokens?: number;
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAIChoice {
  index: number;
  message: OpenAIMessage;
  finish_reason: string;
}

interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage: OpenAIUsage;
}

interface OpenAIStreamChoice {
  index: number;
  delta: {
    content?: string;
    role?: string;
  };
  finish_reason: string | null;
}

interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIStreamChoice[];
  usage?: OpenAIUsage;
}

interface OpenAIEmbedRequest {
  input: string | string[];
  model: string;
}

interface OpenAIEmbedData {
  object: string;
  index: number;
  embedding: number[];
}

interface OpenAIEmbedResponse {
  object: string;
  data: OpenAIEmbedData[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIModelListResponse {
  object: string;
  data: Array<{ id: string; object: string }>;
}

// ----------------------------------------------------------------------------
// Error Helpers
// ----------------------------------------------------------------------------

class OpenAIAPIError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "OpenAIAPIError";
  }
}

class OpenAIConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAIConfigurationError";
  }
}

// ----------------------------------------------------------------------------
// Model Mappings
// ----------------------------------------------------------------------------

/**
 * Maps an OpenAI finish reason to the generic FinishReason type.
 *
 * OpenAI uses underscore-separated reason strings; the generic type
 * uses hyphens. This function translates between the two formats.
 */
function mapFinishReason(reason: string | null | undefined): FinishReason {
  if (reason === "stop") return "stop";
  if (reason === "length") return "length";
  // OpenAI uses "tool_calls" (underscore), generic type uses "tool-calls" (hyphen)
  if (reason === "tool_calls") return "tool-calls";
  // OpenAI uses "content_filter" (underscore), generic type uses "content-filter" (hyphen)
  if (reason === "content_filter") return "content-filter";
  return "stop";
}

/**
 * Converts a generic ChatMessage to an OpenAI-specific message format.
 */
function toOpenAIMessage(msg: ChatMessage): OpenAIMessage {
  return {
    role: msg.role,
    content: msg.content,
    name: msg.name,
  };
}

/**
 * Converts OpenAI's token usage to the generic TokenUsage format.
 */
function toTokenUsage(usage: OpenAIUsage): TokenUsage {
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

// ----------------------------------------------------------------------------
// OpenAI Provider
// ----------------------------------------------------------------------------

/**
 * AI Provider adapter for OpenAI.
 *
 * Communicates with the OpenAI REST API using the native fetch API.
 * No SDK or external dependencies are used.
 *
 * Usage:
 * ```ts
 * const openai = new OpenAIProvider({ apiKey: "sk-..." });
 * const response = await openai.chat({
 *   model: "gpt-4o",
 *   messages: [{ role: "user", content: "Hello" }],
 * });
 * ```
 *
 * The API key and model must be supplied — no hardcoded defaults.
 */
export class OpenAIProvider implements AIProvider {
  readonly id: ProviderId = "openai" as ProviderId;
  readonly name = "OpenAI";
  readonly models: AIModel[];

  private readonly apiKey: string;
  private readonly baseUrl: string;

  /**
   * @param config - Configuration for the OpenAI provider.
   *                 Requires `apiKey` — no hardcoded defaults.
   */
  constructor(config: OpenAIProviderConfig) {
    if (!config.apiKey) {
      throw new OpenAIConfigurationError(
        "OpenAIProvider requires an apiKey in its configuration",
      );
    }

    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(
      /\/+$/,
      "",
    );

    this.models = [
      {
        id: "gpt-4o" as ModelId,
        name: "GPT-4o",
        provider: this.id,
        capabilities: {
          streaming: true,
          functionCalling: true,
          vision: true,
          embeddings: false,
          maxOutputTokens: 16384,
          maxContextLength: 128000,
        },
        costPer1KTokens: { input: 2.5, output: 10 },
        qualityScore: 0.95,
      },
      {
        id: "gpt-4o-mini" as ModelId,
        name: "GPT-4o Mini",
        provider: this.id,
        capabilities: {
          streaming: true,
          functionCalling: true,
          vision: true,
          embeddings: false,
          maxOutputTokens: 16384,
          maxContextLength: 128000,
        },
        costPer1KTokens: { input: 0.15, output: 0.6 },
        qualityScore: 0.85,
      },
      {
        id: "text-embedding-3-small" as ModelId,
        name: "Text Embedding 3 Small",
        provider: this.id,
        capabilities: {
          streaming: false,
          functionCalling: false,
          vision: false,
          embeddings: true,
          maxOutputTokens: 1,
          maxContextLength: 8191,
        },
        costPer1KTokens: { input: 0.02, output: 0 },
        qualityScore: 0.8,
      },
      {
        id: "text-embedding-3-large" as ModelId,
        name: "Text Embedding 3 Large",
        provider: this.id,
        capabilities: {
          streaming: false,
          functionCalling: false,
          vision: false,
          embeddings: true,
          maxOutputTokens: 1,
          maxContextLength: 8191,
        },
        costPer1KTokens: { input: 0.13, output: 0 },
        qualityScore: 0.9,
      },
    ];
  }

  // --------------------------------------------------------------------------
  // HTTP Helper
  // --------------------------------------------------------------------------

  /**
   * Make an authenticated request to the OpenAI API.
   */
  private async fetchOpenAI<T>(
    path: string,
    body: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new OpenAIAPIError(
        `OpenAI API returned status ${response.status}: ${text}`,
        response.status,
        text,
      );
    }

    return response.json() as Promise<T>;
  }

  // --------------------------------------------------------------------------
  // Chat (Non-Streaming)
  // --------------------------------------------------------------------------

  /**
   * Send a chat completion request and receive the full response.
   *
   * Transformation flow:
   *   ChatRequest → OpenAIChatRequest → POST /v1/chat/completions
   *   → OpenAIChatResponse → ChatResponse
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!request.model) {
      throw new OpenAIConfigurationError(
        "OpenAIProvider.chat() requires a model in the request",
      );
    }

    const startTime = performance.now();

    const openaiRequest: OpenAIChatRequest = {
      model: request.model,
      messages: request.messages.map(toOpenAIMessage),
      stream: false,
      temperature: request.temperature,
      top_p: request.topP,
      stop: request.stop,
      max_tokens: request.maxTokens,
    };

    const data = await this.fetchOpenAI<OpenAIChatResponse>(
      "/chat/completions",
      openaiRequest,
    );

    const latencyMs = Math.round(performance.now() - startTime);

    const choice = data.choices[0];

    return {
      message: {
        role: "assistant",
        content: choice.message.content,
      },
      model: data.model as ModelId,
      usage: toTokenUsage(data.usage),
      finishReason: mapFinishReason(choice.finish_reason),
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
   *   1. Send a POST to /v1/chat/completions with stream: true
   *   2. Read the response body as a byte stream
   *   3. Parse Server-Sent Events (SSE) — lines prefixed with "data: "
   *   4. Yield a StreamChunk for each parsed JSON payload
   *   5. The final chunk (usage/finish_reason) ends the stream
   */
  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    if (!request.model) {
      throw new OpenAIConfigurationError(
        "OpenAIProvider.stream() requires a model in the request",
      );
    }

    const openaiRequest: OpenAIChatRequest = {
      model: request.model,
      messages: request.messages.map(toOpenAIMessage),
      stream: true,
      temperature: request.temperature,
      top_p: request.topP,
      stop: request.stop,
      max_tokens: request.maxTokens,
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(openaiRequest),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new OpenAIAPIError(
        `OpenAI stream API returned status ${response.status}: ${text}`,
        response.status,
        text,
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new OpenAIAPIError(
        "OpenAI stream response body is not readable",
      );
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE events are delimited by double newlines
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line || !line.startsWith("data: ")) continue;

          const payload = line.slice(6);

          // OpenAI signals stream end with "data: [DONE]"
          if (payload === "[DONE]") {
            return;
          }

          const chunk = this.parseStreamChunk(payload);
          if (chunk) {
            yield chunk;
            if (chunk.done) return;
          }
        }
      }

      // Process any remaining data in the buffer
      if (buffer.trim()) {
        const line = buffer.trim();
        if (line.startsWith("data: ")) {
          const payload = line.slice(6);
          if (payload !== "[DONE]") {
            const chunk = this.parseStreamChunk(payload);
            if (chunk && !chunk.done) {
              yield chunk;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Parse a single SSE data payload from the OpenAI stream.
   */
  private parseStreamChunk(payload: string): StreamChunk | null {
    try {
      const data: unknown = JSON.parse(payload);

      if (!this.isOpenAIStreamChunk(data)) {
        return null;
      }

      const choice = data.choices[0];

      const chunk: StreamChunk = {
        content: choice?.delta?.content ?? "",
        model: data.model as ModelId,
        provider: this.id,
        done: false,
      };

      // The final chunk may optionally carry usage data.
      // If finish_reason is non-null, this is the last chunk.
      if (choice?.finish_reason) {
        chunk.done = true;
        chunk.finishReason = mapFinishReason(choice.finish_reason);

        if (data.usage) {
          chunk.usage = toTokenUsage(data.usage);
        }
      }

      return chunk;
    } catch {
      // Skip malformed JSON payloads
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
   *   EmbeddingRequest → OpenAIEmbedRequest → POST /v1/embeddings
   *   → OpenAIEmbedResponse → EmbeddingResponse
   */
  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (!request.model) {
      throw new OpenAIConfigurationError(
        "OpenAIProvider.embed() requires a model in the request",
      );
    }

    const startTime = performance.now();

    const openaiRequest: OpenAIEmbedRequest = {
      input: request.input,
      model: request.model,
    };

    const data = await this.fetchOpenAI<OpenAIEmbedResponse>(
      "/embeddings",
      openaiRequest,
    );

    const latencyMs = Math.round(performance.now() - startTime);

    // OpenAI returns embeddings ordered by index — sort to ensure correct order
    const sorted = [...data.data].sort((a, b) => a.index - b.index);

    return {
      embeddings: sorted.map((e) => e.embedding),
      model: data.model as ModelId,
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: 0,
        totalTokens: data.usage.total_tokens,
      },
      provider: this.id,
      latencyMs,
    };
  }

  // --------------------------------------------------------------------------
  // Health
  // --------------------------------------------------------------------------

  /**
   * Check the health of the OpenAI API.
   *
   * Uses GET /v1/models to verify the API key is valid and the API is
   * reachable. A successful response means credentials are valid.
   */
  async health(): Promise<HealthStatus> {
    const startTime = performance.now();

    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      const latencyMs = Math.round(performance.now() - startTime);

      if (!response.ok) {
        return {
          healthy: false,
          provider: this.id,
          lastChecked: Date.now(),
          error: `OpenAI health check failed with status ${response.status}`,
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
  // Type Guards (runtime validation of OpenAI API responses)
  // --------------------------------------------------------------------------

  private isOpenAIStreamChunk(data: unknown): data is OpenAIStreamChunk {
    if (typeof data !== "object" || data === null) return false;
    const d = data as Record<string, unknown>;
    return (
      typeof d.model === "string" &&
      Array.isArray(d.choices) &&
      d.choices.length > 0
    );
  }
}